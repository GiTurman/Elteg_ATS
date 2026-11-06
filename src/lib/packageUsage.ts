// პაკეტის მიხედვით გამოძახებების თვიური კონტროლი (ლიმიტი / გამოყენებული / დარჩენილი).
// ავტორი: Giorgi Turmanidze "GT"
import { queryOptions } from "@tanstack/react-query";

import type { CallStatus, ServiceType } from "@/lib/domain";
import { dbx } from "@/lib/entities";

export type CallsMode = "limited" | "unlimited" | "working_hours" | "extra_charge";

export const CALLS_MODES: { value: CallsMode; label: string }[] = [
  { value: "limited", label: "ლიმიტირებული (თვეში N გამოძახება)" },
  { value: "unlimited", label: "ულიმიტო" },
  { value: "working_hours", label: "მხოლოდ სამუშაო დროს" },
  { value: "extra_charge", label: "ყოველი გამოძახება — დამატებითი ღირებულებით" },
];

export const callsModeShort: Record<CallsMode, string> = {
  limited: "ლიმიტი",
  unlimited: "ულიმიტო",
  working_hours: "მხოლოდ სამუშაო დროს",
  extra_charge: "დამატებითი ღირებულებით",
};

/** სამუშაო დღე: ორშ–პარ 10:00–19:00 (თბილისი) — მომსახურების პაკეტების პირობებით */
export const WORK_DAYS = [1, 2, 3, 4, 5];
export const WORK_FROM_H = 10;
export const WORK_TO_H = 19;
const TZ_OFFSET_H = 4; // Asia/Tbilisi, ზაფხულის დროის გარეშე

function tbilisi(d: Date) {
  const t = new Date(d.getTime() + TZ_OFFSET_H * 3600000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), day: t.getUTCDay(), h: t.getUTCHours() };
}

export function isWorkingTime(d: Date = new Date()): boolean {
  const t = tbilisi(d);
  return WORK_DAYS.includes(t.day) && t.h >= WORK_FROM_H && t.h < WORK_TO_H;
}

/** თვის საზღვრები თბილისის დროით: "2026-11" */
export function monthKey(d: Date = new Date()): string {
  const t = tbilisi(d);
  return `${t.y}-${String(t.m + 1).padStart(2, "0")}`;
}

export function monthRange(key: string): { fromIso: string; toIso: string } {
  const [y = 1970, m = 1] = key.split("-").map(Number);
  const from = Date.UTC(y, m - 1, 1) - TZ_OFFSET_H * 3600000;
  const to = Date.UTC(y, m, 1) - TZ_OFFSET_H * 3600000;
  return { fromIso: new Date(from).toISOString(), toIso: new Date(to).toISOString() };
}

export const MONTHS_GE = [
  "იანვარი",
  "თებერვალი",
  "მარტი",
  "აპრილი",
  "მაისი",
  "ივნისი",
  "ივლისი",
  "აგვისტო",
  "სექტემბერი",
  "ოქტომბერი",
  "ნოემბერი",
  "დეკემბერი",
];
export const monthLabel = (key: string) => {
  const [y = 1970, m = 1] = key.split("-").map(Number);
  return `${MONTHS_GE[m - 1]} ${y}`;
};

export type MonthCall = {
  id: string;
  call_no: number;
  client_id: string | null;
  object_id: string | null;
  service_type: ServiceType;
  status: CallStatus;
  received_at: string;
};

/** ლიმიტში ითვლება: ყველა გამოძახება, გარდა გეგმიური მომსახურებისა და გაუქმებულისა */
export const countsTowardLimit = (c: Pick<MonthCall, "service_type" | "status">) =>
  c.service_type !== "gegmiuri" && c.status !== "gaukmebuli";

export const monthCallsQuery = (key: string) =>
  queryOptions({
    queryKey: ["service_calls", "month", key],
    staleTime: 30_000,
    queryFn: async () => {
      const { fromIso, toIso } = monthRange(key);
      const out: MonthCall[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await dbx
          .from("service_calls")
          .select("id, call_no, client_id, object_id, service_type, status, received_at")
          .gte("received_at", fromIso)
          .lt("received_at", toIso)
          .order("received_at")
          .range(from, from + 999);
        if (error) throw error;
        out.push(...((data ?? []) as MonthCall[]));
        if (!data || data.length < 1000) break;
      }
      return out;
    },
  });

export type ClientLimitInfo = {
  calls_mode?: CallsMode | null;
  included_calls: number | null;
};

/** კლიენტის პირობა; თუ კლიენტზე მითითებული არ არის — პაკეტისა */
export function effectiveLimit(
  client: ClientLimitInfo,
  pkg?: { calls_mode?: CallsMode | null; included_calls?: number | null } | null,
): ClientLimitInfo {
  if (client.calls_mode || client.included_calls != null) return client;
  return { calls_mode: pkg?.calls_mode ?? null, included_calls: pkg?.included_calls ?? null };
}

export type Usage = {
  mode: CallsMode | null;
  limit: number | null;
  used: number;
  planned: number;
  remaining: number | null;
  over: number;
  /** ok | last (ბოლო დარჩა) | exhausted (ამოწურულია) | outside_hours | extra | unknown */
  state: "ok" | "last" | "exhausted" | "outside_hours" | "extra" | "unknown";
};

export function computeUsage(
  client: ClientLimitInfo,
  clientId: string,
  calls: MonthCall[],
  objectClient: Map<string, string | null>,
  now: Date = new Date(),
): Usage {
  const mine = calls.filter(
    (c) =>
      (c.client_id ?? (c.object_id ? (objectClient.get(c.object_id) ?? null) : null)) === clientId,
  );
  const used = mine.filter(countsTowardLimit).length;
  const planned = mine.filter((c) => c.service_type === "gegmiuri").length;
  const mode: CallsMode | null =
    client.calls_mode ?? (client.included_calls != null ? "limited" : null);
  const limit = mode === "limited" ? (client.included_calls ?? 0) : null;
  const remaining = limit != null ? Math.max(0, limit - used) : null;
  const over = limit != null ? Math.max(0, used - limit) : 0;
  let state: Usage["state"] = "ok";
  if (mode === null) state = "unknown";
  else if (mode === "extra_charge") state = "extra";
  else if (mode === "working_hours" && !isWorkingTime(now)) state = "outside_hours";
  else if (limit != null && used >= limit) state = "exhausted";
  else if (limit != null && limit - used === 1) state = "last";
  return { mode, limit, used, planned, remaining, over, state };
}
