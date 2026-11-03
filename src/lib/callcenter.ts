// ქოლ-ცენტრის საერთო ლოგიკა: ზარების ისტორია, უკან დარეკვა, ცვლები, KPI.
// ავტორი: Giorgi Turmanidze "GT"
import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type CallLog = Database["public"]["Tables"]["call_logs"]["Row"];
export type OperatorShift = Database["public"]["Tables"]["operator_shifts"]["Row"];
export type DutyRole = "operator" | "supervisor" | "oncall_technician";

export const callStatusLabel: Record<string, string> = {
  ringing: "რეკავს",
  answered: "ნაპასუხები",
  missed: "გამოტოვებული",
  abandoned: "მიტოვებული",
  voicemail: "ხმოვანი ფოსტა",
  test: "ტესტი",
};

export const directionLabel: Record<string, string> = {
  inbound: "შემომავალი",
  outbound: "გამავალი",
  internal: "შიდა",
};

export const callbackLabel: Record<string, string> = {
  none: "—",
  pending: "დასარეკია",
  done: "გადარეკილია",
  not_needed: "არ საჭიროებს",
};

export const dutyRoleLabel: Record<DutyRole, string> = {
  operator: "ოპერატორი",
  supervisor: "ხელმძღვანელი",
  oncall_technician: "მორიგე ტექნიკოსი",
};

export const UNANSWERED_STATUSES = ["missed", "abandoned", "voicemail"];

/** წამები → "m:ss" ან "h:mm:ss" */
export function fmtSecs(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return "—";
  const v = Math.max(0, Math.round(s));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = v % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** YYYY-MM-DD ლოკალური დროით */
export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** [from 00:00, to 24:00) ლოკალური თარიღების დიაპაზონი ISO-ში */
export function dayRangeIso(from: string, to: string): { fromIso: string; toIso: string } {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  t.setDate(t.getDate() + 1);
  return { fromIso: f.toISOString(), toIso: t.toISOString() };
}

export const callLogsRangeQuery = (fromIso: string, toIso: string) =>
  queryOptions({
    queryKey: ["call_logs", "range", fromIso, toIso],
    queryFn: async () => {
      const PAGE = 1000;
      const out: CallLog[] = [];
      for (let offset = 0; offset < 50_000; offset += PAGE) {
        const { data, error } = await supabase
          .from("call_logs")
          .select("*")
          .gte("started_at", fromIso)
          .lt("started_at", toIso)
          .order("started_at", { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        out.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      return out;
    },
  });

export const pendingCallbacksQuery = queryOptions({
  queryKey: ["call_logs", "pending_callbacks"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("call_logs")
      .select("*")
      .eq("callback_status", "pending")
      .order("started_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    return data ?? [];
  },
});

export const callsFromNumberQuery = (norm: string | null) =>
  queryOptions({
    queryKey: ["call_logs", "by_number", norm],
    enabled: !!norm,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_logs")
        .select("*")
        .eq("caller_number_norm", norm!)
        .order("started_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

export const shiftsRangeQuery = (fromIso: string, toIso: string) =>
  queryOptions({
    queryKey: ["operator_shifts", fromIso, toIso],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operator_shifts")
        .select("*")
        .lt("starts_at", toIso)
        .gt("ends_at", fromIso)
        .order("starts_at");
      if (error) throw error;
      return data ?? [];
    },
  });

export const telephonySettingsQuery = queryOptions({
  queryKey: ["telephony_settings"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("telephony_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
});

// ---------------------------------------------------------------- მორიგეობა

export type DutyPerson = {
  profile_id: string;
  full_name: string;
  duty_role: DutyRole;
  extension: string | null;
  phone: string | null;
  shift_ends_at: string;
};

type ProfileLite = {
  id: string;
  full_name: string;
  extension: string | null;
  phone: string | null;
  is_active: boolean;
};

const DUTY_ORDER: DutyRole[] = ["operator", "supervisor", "oncall_technician"];

/**
 * ვინ არის მორიგე მოცემულ მომენტში — გადამისამართების რიგით:
 * ოპერატორ(ებ)ი → ხელმძღვანელი → მორიგე ტექნიკოსი.
 */
export function computeOnDuty(
  shifts: Pick<OperatorShift, "profile_id" | "duty_role" | "starts_at" | "ends_at">[],
  profiles: ProfileLite[],
  at: Date = new Date(),
): DutyPerson[] {
  const t = at.getTime();
  const seen = new Set<string>();
  const people: DutyPerson[] = [];
  for (const s of shifts) {
    if (Date.parse(s.starts_at) > t || Date.parse(s.ends_at) <= t) continue;
    const key = `${s.profile_id}:${s.duty_role}`;
    if (seen.has(key)) continue;
    const p = profiles.find((x) => x.id === s.profile_id);
    if (!p || !p.is_active) continue;
    seen.add(key);
    people.push({
      profile_id: p.id,
      full_name: p.full_name,
      duty_role: s.duty_role as DutyRole,
      extension: p.extension,
      phone: p.phone,
      shift_ends_at: s.ends_at,
    });
  }
  return people.sort((a, b) => DUTY_ORDER.indexOf(a.duty_role) - DUTY_ORDER.indexOf(b.duty_role));
}

// ---------------------------------------------------------------------- KPI

export type CallCenterKpi = {
  offered: number; // შემოსული (ტესტის გარეშე)
  answered: number;
  missed: number;
  abandoned: number;
  voicemail: number;
  answerRate: number | null; // %
  slaRate: number | null; // % ნაპასუხები N წამში / შემოსული
  avgWait: number | null; // წმ, ნაპასუხებზე
  maxWait: number | null;
  avgTalk: number | null;
  outbound: number;
  cabin: number;
  tests: number;
  callbacksPending: number;
  callbacksDone: number;
  avgCallbackMinutes: number | null;
};

const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

export function computeKpi(logs: CallLog[], slaSeconds: number): CallCenterKpi {
  const inbound = logs.filter((l) => l.direction === "inbound");
  const tests = inbound.filter((l) => l.status === "test").length;
  const finished = inbound.filter((l) => l.status !== "test" && l.status !== "ringing");
  const answered = finished.filter((l) => l.status === "answered");
  const waits = answered.map((l) => l.wait_seconds).filter((v): v is number => v != null);
  const talks = answered.map((l) => l.talk_seconds).filter((v): v is number => v != null);
  const withinSla = answered.filter((l) => (l.wait_seconds ?? 0) <= slaSeconds).length;
  const cbDone = finished.filter((l) => l.callback_status === "done");
  const cbMins = cbDone
    .map((l) =>
      l.callback_at && (l.ended_at ?? l.started_at)
        ? (Date.parse(l.callback_at) - Date.parse((l.ended_at ?? l.started_at)!)) / 60000
        : null,
    )
    .filter((v): v is number => v != null && v >= 0);
  const pct = (a: number, b: number) => (b ? (a / b) * 100 : null);

  return {
    offered: finished.length,
    answered: answered.length,
    missed: finished.filter((l) => l.status === "missed").length,
    abandoned: finished.filter((l) => l.status === "abandoned").length,
    voicemail: finished.filter((l) => l.status === "voicemail").length,
    answerRate: pct(answered.length, finished.length),
    slaRate: pct(withinSla, finished.length),
    avgWait: avg(waits),
    maxWait: waits.length ? Math.max(...waits) : null,
    avgTalk: avg(talks),
    outbound: logs.filter((l) => l.direction === "outbound").length,
    cabin: finished.filter((l) => l.is_cabin_call).length,
    tests,
    callbacksPending: finished.filter((l) => l.callback_status === "pending").length,
    callbacksDone: cbDone.length,
    avgCallbackMinutes: avg(cbMins),
  };
}

/** შემოსული ზარები საათების მიხედვით (0–23) */
export function callsByHour(logs: CallLog[]) {
  const rows = Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, "0")}:00`,
    answered: 0,
    unanswered: 0,
  }));
  for (const l of logs) {
    if (l.direction !== "inbound" || !l.started_at) continue;
    if (l.status === "test" || l.status === "ringing") continue;
    const h = new Date(l.started_at).getHours();
    if (l.status === "answered") rows[h]!.answered++;
    else rows[h]!.unanswered++;
  }
  return rows;
}

/** ყოველდღიური დინამიკა */
export function callsByDay(logs: CallLog[]) {
  const map = new Map<string, { day: string; answered: number; unanswered: number }>();
  for (const l of logs) {
    if (l.direction !== "inbound" || !l.started_at) continue;
    if (l.status === "test" || l.status === "ringing") continue;
    const day = toDateInput(new Date(l.started_at));
    const r = map.get(day) ?? { day, answered: 0, unanswered: 0 };
    if (l.status === "answered") r.answered++;
    else r.unanswered++;
    map.set(day, r);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** ოპერატორების მიხედვით */
export function byOperator(
  logs: CallLog[],
  nameOf: (id: string | null, ext: string | null) => string,
) {
  const map = new Map<
    string,
    { name: string; answered: number; outbound: number; talk: number; waits: number[] }
  >();
  for (const l of logs) {
    if (l.status === "test") continue;
    const isAns = l.direction === "inbound" && l.status === "answered";
    const isOut = l.direction === "outbound";
    if (!isAns && !isOut) continue;
    const key = l.agent_profile_id ?? `ext:${l.agent_extension ?? "?"}`;
    const r = map.get(key) ?? {
      name: nameOf(l.agent_profile_id, l.agent_extension),
      answered: 0,
      outbound: 0,
      talk: 0,
      waits: [],
    };
    if (isAns) {
      r.answered++;
      if (l.wait_seconds != null) r.waits.push(l.wait_seconds);
    }
    if (isOut) r.outbound++;
    r.talk += l.talk_seconds ?? 0;
    map.set(key, r);
  }
  return [...map.values()]
    .map((r) => ({
      name: r.name,
      answered: r.answered,
      outbound: r.outbound,
      talk: r.talk,
      avgWait: avg(r.waits),
    }))
    .sort((a, b) => b.answered - a.answered);
}
