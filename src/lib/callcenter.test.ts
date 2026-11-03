import { describe, expect, it } from "vitest";

import {
  byOperator,
  callsByHour,
  computeKpi,
  computeOnDuty,
  fmtSecs,
  type CallLog,
} from "./callcenter";

const base: CallLog = {
  id: "x",
  external_call_id: "x",
  direction: "inbound",
  caller_number: "+995599000001",
  caller_number_norm: "599000001",
  called_number: null,
  queue_name: null,
  agent_extension: null,
  agent_profile_id: null,
  status: "answered",
  started_at: "2026-11-03T08:00:00.000Z",
  answered_at: "2026-11-03T08:00:10.000Z",
  ended_at: "2026-11-03T08:02:00.000Z",
  wait_seconds: 10,
  talk_seconds: 110,
  recording_url: null,
  matched_client_id: null,
  matched_object_id: null,
  is_cabin_call: false,
  service_call_id: null,
  incoming_call_id: null,
  callback_status: "none",
  callback_by: null,
  callback_at: null,
  notes: null,
  raw: null,
  created_at: "2026-11-03T08:00:00.000Z",
  updated_at: "2026-11-03T08:00:00.000Z",
};

const log = (p: Partial<CallLog>): CallLog => ({ ...base, ...p, id: Math.random().toString(36) });

describe("computeKpi", () => {
  const logs = [
    log({ wait_seconds: 5, agent_profile_id: "a" }),
    log({ wait_seconds: 30, agent_profile_id: "a" }), // SLA-ს გარეთ
    log({
      status: "missed",
      answered_at: null,
      wait_seconds: 40,
      talk_seconds: null,
      callback_status: "pending",
    }),
    log({
      status: "abandoned",
      answered_at: null,
      talk_seconds: null,
      callback_status: "done",
      callback_at: "2026-11-03T08:12:00.000Z",
    }),
    log({ status: "test", is_cabin_call: true }),
    log({ status: "ringing", answered_at: null, ended_at: null }),
    log({ direction: "outbound", agent_profile_id: "a" }),
  ];
  const k = computeKpi(logs, 20);

  it("excludes test and ringing calls from offered", () => {
    expect(k.offered).toBe(4);
    expect(k.tests).toBe(1);
  });
  it("computes answer rate and SLA over offered", () => {
    expect(k.answered).toBe(2);
    expect(k.answerRate).toBe(50);
    expect(k.slaRate).toBe(25);
  });
  it("computes waits and callbacks", () => {
    expect(k.avgWait).toBe(17.5);
    expect(k.maxWait).toBe(30);
    expect(k.callbacksPending).toBe(1);
    expect(k.callbacksDone).toBe(1);
    expect(k.avgCallbackMinutes).toBe(10);
    expect(k.outbound).toBe(1);
  });
  it("aggregates by hour and operator", () => {
    const h = callsByHour(logs);
    const total = h.reduce((a, r) => a + r.answered + r.unanswered, 0);
    expect(total).toBe(4);
    const ops = byOperator(logs, (id) => id ?? "?");
    expect(ops[0]).toMatchObject({ name: "a", answered: 2, outbound: 1 });
  });
});

describe("computeOnDuty", () => {
  const profiles = [
    { id: "op", full_name: "ოპერატორი", extension: "101", phone: null, is_active: true },
    { id: "sup", full_name: "ხელმძღვანელი", extension: "100", phone: "599", is_active: true },
    { id: "tech", full_name: "ტექნიკოსი", extension: null, phone: "577", is_active: true },
    { id: "off", full_name: "გათიშული", extension: "103", phone: null, is_active: false },
  ];
  const shift = (profile_id: string, duty_role: string, s: string, e: string) => ({
    profile_id,
    duty_role,
    starts_at: s,
    ends_at: e,
  });
  const shifts = [
    shift("tech", "oncall_technician", "2026-11-03T16:00:00Z", "2026-11-04T04:00:00Z"),
    shift("sup", "supervisor", "2026-11-03T04:00:00Z", "2026-11-03T16:00:00Z"),
    shift("op", "operator", "2026-11-03T16:00:00Z", "2026-11-04T04:00:00Z"),
    shift("off", "operator", "2026-11-03T16:00:00Z", "2026-11-04T04:00:00Z"),
  ];

  it("orders operator → supervisor → on-call and skips inactive", () => {
    const night = computeOnDuty(shifts, profiles, new Date("2026-11-03T20:00:00Z"));
    expect(night.map((p) => p.profile_id)).toEqual(["op", "tech"]);
    const day = computeOnDuty(shifts, profiles, new Date("2026-11-03T10:00:00Z"));
    expect(day.map((p) => p.profile_id)).toEqual(["sup"]);
  });
  it("treats end as exclusive", () => {
    expect(
      computeOnDuty(shifts, profiles, new Date("2026-11-03T16:00:00Z")).map((p) => p.profile_id),
    ).toEqual(["op", "tech"]);
  });
});

describe("fmtSecs", () => {
  it("formats", () => {
    expect(fmtSecs(65)).toBe("1:05");
    expect(fmtSecs(3725)).toBe("1:02:05");
    expect(fmtSecs(null)).toBe("—");
  });
});
