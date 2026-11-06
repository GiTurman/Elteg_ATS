// SMS გაგზავნა smsoffice.ge-ით (მხოლოდ სერვერზე; API გასაღები ბრაუზერში არასოდეს ჩანს).
// ავტორი: Giorgi Turmanidze "GT"
import type { SupabaseClient } from "@supabase/supabase-js";

import { statusLabel, type CallStatus } from "@/lib/domain";
import {
  DEFAULT_SMS_SETTINGS,
  renderSms,
  smsMobile,
  translitGe,
  type SmsSettings,
} from "@/lib/sms";

// sms_* ცხრილები გენერირებულ ტიპებში ჯერ არ არის — ტიპის გარეშე კლიენტი
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

export async function loadSmsSettings(db?: Db): Promise<SmsSettings> {
  const c = db ?? (await admin());
  const [{ data: s }, { data: k }] = await Promise.all([
    c.from("sms_settings").select("*").eq("id", 1).maybeSingle(),
    c.from("sms_secrets").select("api_key").eq("id", 1).maybeSingle(),
  ]);
  return {
    ...DEFAULT_SMS_SETTINGS,
    ...((s ?? {}) as Partial<SmsSettings>),
    status_templates: {
      ...((s?.status_templates ??
        DEFAULT_SMS_SETTINGS.status_templates) as SmsSettings["status_templates"]),
    },
    has_api_key: !!(k as { api_key?: string } | null)?.api_key,
  };
}

type SendArgs = {
  to: string | null | undefined;
  body: string;
  kind: "inbound" | "status" | "test";
  service_call_id?: string | null;
  call_log_id?: string | null;
  status?: CallStatus | null;
  settings?: SmsSettings;
};

export type SendResult = { ok: boolean; error?: string; skipped?: boolean };

/** ერთი SMS + ჟურნალში ჩაწერა. შეცდომა გამონაკლისს არ აგდებს. */
export async function sendSms(args: SendArgs): Promise<SendResult> {
  const db = await admin();
  const settings = args.settings ?? (await loadSmsSettings(db));
  const to = smsMobile(args.to);
  const body = settings.translit ? translitGe(args.body) : args.body;
  const log = async (ok: boolean, error: string | null, code: number | null) => {
    await db.from("sms_log").insert({
      kind: args.kind,
      to_number: to ?? args.to ?? null,
      body,
      ok,
      error,
      provider_code: code,
      service_call_id: args.service_call_id ?? null,
      call_log_id: args.call_log_id ?? null,
      status: args.status ?? null,
    });
  };

  if (!to) return { ok: false, skipped: true, error: "not_mobile" };
  if (!body.trim()) return { ok: false, skipped: true, error: "empty" };
  if (!settings.enabled && args.kind !== "test")
    return { ok: false, skipped: true, error: "disabled" };

  const { data: k } = await db.from("sms_secrets").select("api_key").eq("id", 1).maybeSingle();
  const key = (k as { api_key?: string } | null)?.api_key;
  if (!key || !settings.sender) {
    await log(false, "API გასაღები ან გამგზავნის სახელი არ არის მითითებული", null);
    return { ok: false, error: "not_configured" };
  }

  try {
    const form = new URLSearchParams({
      key,
      destination: to,
      sender: settings.sender,
      content: body.slice(0, 1000),
      urgent: "true",
    });
    const res = await fetch("https://smsoffice.ge/api/v2/send/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(6000),
    });
    const j = (await res.json().catch(() => null)) as {
      Success?: boolean;
      Message?: string;
      ErrorCode?: number;
    } | null;
    const ok = !!j?.Success;
    const err = ok ? null : (j?.Message ?? `HTTP ${res.status}`);
    await log(ok, err, j?.ErrorCode ?? null);
    return ok ? { ok } : { ok, error: err ?? "error" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log(false, msg, null);
    return { ok: false, error: msg };
  }
}

async function packageVars(db: Db, clientId: string | null) {
  if (!clientId) return null;
  const { data: c } = await db
    .from("clients")
    .select(
      "name, package_id, tariff_packages:package_id(name, response_sla_hours, response_minutes_work, response_minutes_after, included_services)",
    )
    .eq("id", clientId)
    .maybeSingle();
  if (!c) return null;
  const p = (c as { tariff_packages?: unknown }).tariff_packages as {
    name?: string;
    response_sla_hours?: number | null;
    response_minutes_work?: number | null;
    response_minutes_after?: number | null;
    included_services?: string | null;
  } | null;
  return {
    client: (c as { name: string }).name,
    package: p?.name ?? null,
    response:
      p?.response_minutes_work != null
        ? `${p.response_minutes_work} წუთი`
        : p?.response_sla_hours != null
          ? `${p.response_sla_hours} საათი`
          : null,
    services: p?.included_services ?? null,
  };
}

async function hotline(db: Db) {
  const { data } = await db
    .from("telephony_settings")
    .select("main_number")
    .eq("id", 1)
    .maybeSingle();
  return (data as { main_number?: string | null } | null)?.main_number ?? null;
}

/** შემომავალ ზარზე: პაკეტი, რეაგირების დრო, მომსახურება (განმეორება — მხოლოდ dedupe_minutes-ის შემდეგ) */
export async function sendInboundInfoSms(opts: {
  callLogId: string;
  phone: string | null;
  clientId: string | null;
}): Promise<SendResult> {
  const db = await admin();
  const settings = await loadSmsSettings(db);
  if (!settings.enabled || !settings.inbound_enabled) return { ok: false, skipped: true };
  const to = smsMobile(opts.phone);
  if (!to) return { ok: false, skipped: true, error: "not_mobile" };

  const since = new Date(Date.now() - Math.max(1, settings.dedupe_minutes) * 60000).toISOString();
  const { count } = await db
    .from("sms_log")
    .select("id", { count: "exact", head: true })
    .eq("kind", "inbound")
    .eq("to_number", to)
    .eq("ok", true)
    .gte("created_at", since);
  if (count) return { ok: false, skipped: true, error: "dedupe" };

  const pv = await packageVars(db, opts.clientId);
  const tpl = pv?.package ? settings.inbound_template : settings.inbound_unknown_template;
  if (!tpl?.trim()) return { ok: false, skipped: true, error: "no_template" };
  const body = renderSms(tpl, { ...(pv ?? {}), hotline: await hotline(db) });
  return sendSms({ to, body, kind: "inbound", call_log_id: opts.callLogId, settings });
}

/** გამოძახების სტატუსის შეცვლისას (თითო სტატუსზე — ერთხელ) */
export async function sendStatusSms(callId: string): Promise<SendResult> {
  const db = await admin();
  const settings = await loadSmsSettings(db);
  if (!settings.enabled) return { ok: false, skipped: true };
  const { data: call } = await db
    .from("service_calls")
    .select(
      "id, call_no, status, address, site_name, client_id, client_phone, caller_number, priority, received_at, sla_due_at, assigned_to, objects:object_id(client_id)",
    )
    .eq("id", callId)
    .maybeSingle();
  if (!call) return { ok: false, error: "not_found" };
  const status = call.status as CallStatus;
  const tpl = settings.status_templates[status];
  if (!tpl?.trim()) return { ok: false, skipped: true, error: "no_template" };
  const to = smsMobile(call.client_phone) ?? smsMobile(call.caller_number);
  if (!to) return { ok: false, skipped: true, error: "not_mobile" };

  const { count } = await db
    .from("sms_log")
    .select("id", { count: "exact", head: true })
    .eq("kind", "status")
    .eq("service_call_id", callId)
    .eq("status", status)
    .eq("ok", true);
  if (count) return { ok: false, skipped: true, error: "already_sent" };

  const clientId =
    call.client_id ??
    (call as { objects?: { client_id?: string | null } | null }).objects?.client_id ??
    null;
  const pv = await packageVars(db, clientId);
  let tech: string | null = null;
  if (call.assigned_to) {
    const { data: t } = await db
      .from("profiles")
      .select("full_name")
      .eq("id", call.assigned_to)
      .maybeSingle();
    tech = (t as { full_name?: string } | null)?.full_name ?? null;
  }
  const slaHours =
    call.sla_due_at && call.received_at
      ? Math.round((Date.parse(call.sla_due_at) - Date.parse(call.received_at)) / 3600000)
      : null;
  const body = renderSms(tpl, {
    ...(pv ?? {}),
    response: pv?.response ?? (slaHours != null ? `${slaHours} საათი` : null),
    hotline: await hotline(db),
    call_no: call.call_no,
    status: statusLabel[status],
    address: call.address || call.site_name,
    technician: tech,
  });
  return sendSms({ to, body, kind: "status", service_call_id: callId, status, settings });
}
