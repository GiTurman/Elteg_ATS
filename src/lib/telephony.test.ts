import { describe, expect, it } from "vitest";

import {
  computeCallLogPatch,
  normalizeGePhone,
  telephonyEventSchema,
  type CallLogState,
} from "./telephony";

const NOW = "2026-11-03T10:00:00.000Z";
const ev = (body: Record<string, unknown>) => telephonyEventSchema.parse(body);

function run(events: Record<string, unknown>[]) {
  let state: CallLogState | null = null;
  for (const body of events) {
    const p = computeCallLogPatch(state, ev(body), body, NOW);
    state = {
      direction: p.direction ?? null,
      status: p.status,
      started_at: p.started_at,
      answered_at: p.answered_at,
      ended_at: p.ended_at,
      talk_seconds: p.talk_seconds,
      callback_status: p.callback_status,
      raw: p.raw,
    };
    Object.assign(state, { wait_seconds: p.wait_seconds });
  }
  return state as CallLogState & { wait_seconds: number | null };
}

describe("normalizeGePhone", () => {
  it("drops +995 and keeps 9 digits", () => {
    expect(normalizeGePhone("+995 599 12-34-56")).toBe("599123456");
  });
  it("drops leading 0", () => {
    expect(normalizeGePhone("0322123456")).toBe("322123456");
  });
  it("returns null for fewer than 9 digits", () => {
    expect(normalizeGePhone("101")).toBeNull();
  });
});

describe("computeCallLogPatch", () => {
  it("answered call: wait = answered − started, talk = duration", () => {
    const s = run([
      { event: "call_started", call_id: "a", direction: "inbound", timestamp: "2026-11-03T09:00:00Z" },
      { event: "call_answered", call_id: "a", timestamp: "2026-11-03T09:00:12Z" },
      { event: "call_ended", call_id: "a", timestamp: "2026-11-03T09:01:47Z", duration: 95 },
    ]);
    expect(s.status).toBe("answered");
    expect(s.wait_seconds).toBe(12);
    expect(s.talk_seconds).toBe(95);
    expect(s.callback_status).toBe("none");
  });

  it("unanswered inbound call becomes missed with a pending callback", () => {
    const s = run([
      { event: "call_started", call_id: "b", direction: "inbound", timestamp: "2026-11-03T09:00:00Z" },
      { event: "call_ended", call_id: "b", timestamp: "2026-11-03T09:00:30Z" },
    ]);
    expect(s.status).toBe("missed");
    expect(s.wait_seconds).toBe(30);
    expect(s.callback_status).toBe("pending");
  });

  it("abandoned status from payload is kept", () => {
    const s = run([
      { event: "call_started", call_id: "c", direction: "inbound", timestamp: "2026-11-03T09:00:00Z" },
      { event: "call_ended", call_id: "c", status: "abandoned", timestamp: "2026-11-03T09:00:18Z" },
    ]);
    expect(s.status).toBe("abandoned");
    expect(s.callback_status).toBe("pending");
  });

  it("unanswered outbound call gets no callback", () => {
    const s = run([
      { event: "call_started", call_id: "d", direction: "outbound", timestamp: "2026-11-03T09:00:00Z" },
      { event: "call_ended", call_id: "d", timestamp: "2026-11-03T09:00:20Z" },
    ]);
    expect(s.callback_status).toBe("none");
  });

  it("test call ends as test with callback not needed", () => {
    const s = run([
      { event: "call_started", call_id: "e", is_test: true, timestamp: "2026-11-03T09:00:00Z" },
      { event: "call_ended", call_id: "e", timestamp: "2026-11-03T09:00:10Z" },
    ]);
    expect(s.status).toBe("test");
    expect(s.callback_status).toBe("not_needed");
  });

  it("call_ended without call_started still yields a correct row", () => {
    const s = run([
      { event: "call_ended", call_id: "f", direction: "inbound", timestamp: "2026-11-03T09:00:40Z", duration: 40 },
    ]);
    expect(s.status).toBe("missed");
    expect(s.started_at).toBe("2026-11-03T09:00:00.000Z");
    expect(s.wait_seconds).toBe(40);
    expect(s.callback_status).toBe("pending");
  });

  it("late call_answered after call_ended turns missed into answered", () => {
    const s = run([
      { event: "call_started", call_id: "g", direction: "inbound", timestamp: "2026-11-03T09:00:00Z" },
      { event: "call_ended", call_id: "g", timestamp: "2026-11-03T09:01:00Z" },
      { event: "call_answered", call_id: "g", timestamp: "2026-11-03T09:00:10Z" },
    ]);
    expect(s.status).toBe("answered");
    expect(s.wait_seconds).toBe(10);
    expect(s.talk_seconds).toBe(50);
    expect(s.callback_status).toBe("none");
  });

  it("replaying the same event is idempotent", () => {
    const e = { event: "call_started", call_id: "h", timestamp: "2026-11-03T09:00:00Z" };
    const s = run([e, e]);
    expect(s.started_at).toBe("2026-11-03T09:00:00.000Z");
    expect(s.status).toBe("ringing");
  });
});
