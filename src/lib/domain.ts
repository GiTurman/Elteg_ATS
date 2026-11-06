import type { Database } from "@/integrations/supabase/types";

export type ServiceType = Database["public"]["Enums"]["service_type"];
export type CallPriority = Database["public"]["Enums"]["call_priority"];
export type CallStatus = Database["public"]["Enums"]["call_status"];
export type AppRole = Database["public"]["Enums"]["app_role"];
export type ServiceCall = Database["public"]["Tables"]["service_calls"]["Row"];
export type ObjectRow = Database["public"]["Tables"]["objects"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export const SERVICE_TYPES: { value: ServiceType; label: string }[] = [
  { value: "avaria", label: "ავარია" },
  { value: "gegmiuri", label: "გეგმიური სერვისი" },
  { value: "inspeqcia", label: "ინსპექცია" },
  { value: "chamokideba", label: "ჩამოკიდება" },
];

export const PRIORITIES: { value: CallPriority; label: string }[] = [
  { value: "kritikuli", label: "კრიტიკული" },
  { value: "maghali", label: "მაღალი" },
  { value: "sashualo", label: "საშუალო" },
  { value: "dabali", label: "დაბალი" },
];

export const STATUSES: { value: CallStatus; label: string }[] = [
  { value: "akhali", label: "ახალი" },
  { value: "mighebuli", label: "მიღებული" },
  { value: "gzashi", label: "გზაში" },
  { value: "mimdinare", label: "მიმდინარე" },
  { value: "shesrulebuli", label: "შესრულებული" },
  { value: "dakhuruli", label: "დახურული" },
  { value: "gaukmebuli", label: "გაუქმებული" },
];

export const STATUS_FLOW: CallStatus[] = [
  "akhali",
  "mighebuli",
  "gzashi",
  "mimdinare",
  "shesrulebuli",
  "dakhuruli",
];

export const ROLES: { value: AppRole; label: string }[] = [
  { value: "dispatcher", label: "დისპეჩერი" },
  { value: "technician", label: "ტექნიკოსი" },
  { value: "manager", label: "მენეჯერი" },
  { value: "admin", label: "ადმინისტრატორი" },
];

/** მთავარი როლი: ადმინი > მენეჯერი > დისპეჩერი > ტექნიკოსი */
export function primaryRole(roles: readonly string[]): AppRole {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("manager")) return "manager";
  if (roles.includes("dispatcher")) return "dispatcher";
  return "technician";
}
/** მენეჯერის უფლებები (ადმინსაც აქვს) */
export const isManagerRole = (r: AppRole) => r === "manager" || r === "admin";
/** ზარებს იღებს / დისპეჩერის უფლებები */
export const isStaffRole = (r: AppRole) => r === "dispatcher" || r === "manager" || r === "admin";

const toMap = <T extends string>(arr: { value: T; label: string }[]) =>
  Object.fromEntries(arr.map((i) => [i.value, i.label])) as Record<T, string>;

export const serviceTypeLabel = toMap(SERVICE_TYPES);
export const priorityLabel = toMap(PRIORITIES);
export const statusLabel = toMap(STATUSES);
export const roleLabel = toMap(ROLES);

export const SLA_HOURS: Record<CallPriority, number> = {
  kritikuli: 1,
  maghali: 4,
  sashualo: 24,
  dabali: 72,
};

export const OPEN_STATUSES: CallStatus[] = [
  "akhali",
  "mighebuli",
  "gzashi",
  "mimdinare",
];

export const isOpen = (s: CallStatus) => OPEN_STATUSES.includes(s);

export type SlaState = "ok" | "warning" | "breached" | "met" | "none";

export function slaState(call: ServiceCall, now = Date.now()): SlaState {
  if (!call.sla_due_at) return "none";
  if (call.status === "gaukmebuli") return "none";
  const due = new Date(call.sla_due_at).getTime();
  if (call.responded_at) {
    return new Date(call.responded_at).getTime() <= due ? "met" : "breached";
  }
  if (now > due) return "breached";
  const total = SLA_HOURS[call.priority] * 3600_000;
  return due - now < total * 0.25 ? "warning" : "ok";
}

export const slaLabel: Record<SlaState, string> = {
  ok: "ვადაში",
  warning: "რისკის ქვეშ",
  breached: "დარღვეული",
  met: "შესრულდა ვადაში",
  none: "—",
};

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ka-GE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ka-GE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDuration(ms: number) {
  if (!isFinite(ms) || ms <= 0) return "—";
  const h = Math.floor(ms / 3600_000);
  const m = Math.round((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}სთ ${m}წთ` : `${m}წთ`;
}

export function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    headers.map(esc).join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ].join("\n");
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const blob = new Blob(["\uFEFF" + toCsv(rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
