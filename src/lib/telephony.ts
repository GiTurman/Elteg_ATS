import { z } from "zod";

/** Georgian phone normalization — mirrors SQL public.normalize_ge_phone. */
export function normalizeGePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("995")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  if (d.length < 9) return null;
  return d.slice(-9);
}

export const TELEPHONY_EVENTS = [
  "call_started",
  "call_answered",
  "call_ended",
  "recording_ready",
] as const;

const optStr = (max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().max(max))
    .optional()
    .nullable()
    .transform((v) => (v ? v : undefined));

export const telephonyEventSchema = z.object({
  event: z.enum(TELEPHONY_EVENTS),
  call_id: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().min(1).max(200)),
  direction: z.enum(["inbound", "outbound", "internal"]).optional().nullable().catch(undefined),
  from: optStr(64),
  to: optStr(64),
  queue: optStr(128),
  extension: optStr(32),
  timestamp: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined)),
  duration: z.coerce.number().int().min(0).max(86400).optional().nullable().catch(undefined),
  status: z
    .enum(["answered", "missed", "abandoned", "voicemail"])
    .optional()
    .nullable()
    .catch(undefined),
  recording_url: optStr(2048),
  is_test: z.boolean().optional().nullable().catch(undefined),
});

export type TelephonyEvent = z.infer<typeof telephonyEventSchema>;

export type CallLogStatus = "ringing" | "answered" | "missed" | "abandoned" | "voicemail" | "test";
export type CallbackStatus = "none" | "pending" | "done" | "not_needed";

export type CallLogState = {
  direction: string | null;
  status: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  talk_seconds: number | null;
  callback_status: string;
  raw: unknown;
};

export type CallLogPatch = {
  direction?: "inbound" | "outbound" | "internal";
  caller_number?: string;
  called_number?: string;
  queue_name?: string;
  agent_extension?: string;
  recording_url?: string;
  status: CallLogStatus;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  wait_seconds: number | null;
  talk_seconds: number | null;
  callback_status: CallbackStatus;
  raw: Record<string, unknown>;
};

const UNANSWERED = ["missed", "abandoned", "voicemail"] as const;

const secsBetween = (a: string | null, b: string | null) =>
  a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null;

const shift = (iso: string, seconds: number) =>
  new Date(Date.parse(iso) + seconds * 1000).toISOString();

/**
 * Applies one telephony event to the current call-log state.
 * Pure and idempotent: replaying the same event gives the same row, and events
 * may arrive in any order.
 */
export function computeCallLogPatch(
  prev: CallLogState | null,
  ev: TelephonyEvent,
  rawBody: Record<string, unknown>,
  nowIso: string,
): CallLogPatch {
  const ts = ev.timestamp ?? nowIso;
  const prevRaw = (prev?.raw ?? null) as Record<string, unknown> | null;
  const isTest = ev.is_test === true || prev?.status === "test" || prevRaw?.["is_test"] === true;

  const direction = (ev.direction ??
    (prev?.direction as CallLogPatch["direction"]) ??
    "inbound") as NonNullable<CallLogPatch["direction"]>;

  let started = prev?.started_at ?? null;
  let answered = prev?.answered_at ?? null;
  let ended = prev?.ended_at ?? null;
  let status = (prev?.status ?? "ringing") as CallLogStatus;
  let callback = (prev?.callback_status ?? "none") as CallbackStatus;
  let talk = prev?.talk_seconds ?? null;

  switch (ev.event) {
    case "call_started":
      if (!started || Date.parse(ts) < Date.parse(started)) started = ts;
      break;
    case "call_answered":
      if (!answered) answered = ts;
      if (status !== "test") status = "answered";
      break;
    case "call_ended":
      // განმეორებითი call_ended დროის გარეშე ended_at-ს აღარ ცვლის (იდემპოტენტური)
      ended = ev.timestamp ?? ended ?? nowIso;
      if (ev.status === "answered" && !answered) {
        answered = ev.duration != null ? shift(ts, -ev.duration) : ts;
      }
      if (!started) {
        started = answered ?? (ev.duration != null ? shift(ts, -ev.duration) : ts);
      }
      break;
    case "recording_ready":
      break;
  }
  if (!started && answered) started = answered;

  const isAnswered = answered != null;

  if (ended) {
    if (isTest) {
      status = "test";
      callback = "not_needed";
    } else if (isAnswered) {
      status = "answered";
      if (ev.event === "call_ended" && ev.duration != null) talk = ev.duration;
      else if (talk == null) talk = secsBetween(answered, ended);
      if (callback === "pending") callback = "none";
    } else {
      if (ev.event === "call_ended") {
        status = ev.status && ev.status !== "answered" ? ev.status : "missed";
      } else if (!(UNANSWERED as readonly string[]).includes(status)) {
        status = "missed";
      }
      if (direction === "inbound" && callback === "none") callback = "pending";
    }
  }

  const wait = isAnswered
    ? secsBetween(started, answered)
    : ended
      ? secsBetween(started, ended)
      : null;

  const patch: CallLogPatch = {
    direction,
    status,
    started_at: started,
    answered_at: answered,
    ended_at: ended,
    wait_seconds: wait,
    talk_seconds: isAnswered ? talk : null,
    callback_status: callback,
    raw: isTest ? { ...rawBody, is_test: true } : rawBody,
  };
  if (ev.from) patch.caller_number = ev.from;
  if (ev.to) patch.called_number = ev.to;
  if (ev.queue) patch.queue_name = ev.queue;
  if (ev.extension) patch.agent_extension = ev.extension;
  if (ev.recording_url) patch.recording_url = ev.recording_url;
  return patch;
}

/** Constant-time string comparison for the webhook token. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
