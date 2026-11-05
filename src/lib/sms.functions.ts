// SMS პარამეტრები (მენეჯერი) და სტატუსის შეტყობინება (დისპეჩერი/ტექნიკოსი).
// ავტორი: Giorgi Turmanidze "GT"
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function rolesOf(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: roles }, { data: me }] = await Promise.all([
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
    supabaseAdmin.from("profiles").select("is_active").eq("id", userId).maybeSingle(),
  ]);
  if (!me?.is_active) return [] as string[];
  return (roles ?? []).map((r) => r.role as string);
}

async function assertManager(userId: string) {
  if (!(await rolesOf(userId)).includes("manager")) {
    throw new Error("ეს მოქმედება მხოლოდ მენეჯერს შეუძლია");
  }
}

const STATUS = z.enum([
  "akhali",
  "mighebuli",
  "gzashi",
  "mimdinare",
  "shesrulebuli",
  "dakhuruli",
  "gaukmebuli",
]);

export const getSmsSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertManager(context.userId);
    const { loadSmsSettings } = await import("@/lib/sms.server");
    try {
      return { ready: true as const, settings: await loadSmsSettings() };
    } catch {
      return { ready: false as const, settings: null };
    }
  });

const saveSchema = z.object({
  enabled: z.boolean(),
  sender: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9.-]{0,11}$/, "გამგზავნი: მაქს. 11 ლათინური ასო/ციფრი, - ან ."),
  translit: z.boolean(),
  inbound_enabled: z.boolean(),
  inbound_template: z.string().max(1000),
  inbound_unknown_template: z.string().max(1000),
  dedupe_minutes: z.number().int().min(1).max(10080),
  status_templates: z.record(STATUS, z.string().max(1000)),
});

export const saveSmsSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saveSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("sms_settings" as never)
      .upsert({ id: 1, ...data, updated_at: new Date().toISOString() } as never);
    if (error) throw new Error(`ვერ შეინახა: ${error.message}`);
    return { ok: true };
  });

/** API გასაღები — მხოლოდ ჩაწერა (უკან არასოდეს ბრუნდება) */
export const setSmsApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ api_key: z.string().trim().max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("sms_secrets" as never)
      .upsert({ id: 1, api_key: data.api_key || null } as never);
    if (error) throw new Error(`ვერ შეინახა: ${error.message}`);
    return { ok: true };
  });

export const sendTestSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ to: z.string().trim().min(9).max(20), body: z.string().trim().min(1).max(1000) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);
    const { sendSms } = await import("@/lib/sms.server");
    const { smsMobile } = await import("@/lib/sms");
    if (!smsMobile(data.to)) throw new Error("SMS იგზავნება მხოლოდ ქართულ მობილურზე (5XX…)");
    const r = await sendSms({ to: data.to, body: data.body, kind: "test" });
    if (!r.ok)
      throw new Error(
        r.error === "not_configured"
          ? "მიუთითეთ API გასაღები და გამგზავნი"
          : (r.error ?? "ვერ გაიგზავნა"),
      );
    return r;
  });

/** სტატუსის შეცვლის/გამოძახების შექმნის შემდეგ — კლიენტს SMS (თუ ამ სტატუსზე შაბლონი ჩართულია) */
export const notifyCallStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ callId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const roles = await rolesOf(context.userId);
    const staff = roles.includes("dispatcher") || roles.includes("manager");
    if (!staff) {
      if (!roles.includes("technician")) return { ok: false, skipped: true };
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: c } = await supabaseAdmin
        .from("service_calls")
        .select("assigned_to")
        .eq("id", data.callId)
        .maybeSingle();
      if (c?.assigned_to !== context.userId) return { ok: false, skipped: true };
    }
    const { sendStatusSms } = await import("@/lib/sms.server");
    try {
      return await sendStatusSms(data.callId);
    } catch (e) {
      console.error("[sms] status notify failed", e);
      return { ok: false, error: "server_error" };
    }
  });
