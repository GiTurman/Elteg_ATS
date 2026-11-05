import { describe, expect, it } from "vitest";

import { computeUsage, isWorkingTime, monthKey, monthRange, type MonthCall } from "./packageUsage";

const call = (p: Partial<MonthCall>): MonthCall => ({
  id: Math.random().toString(),
  call_no: 1,
  client_id: "c1",
  object_id: null,
  service_type: "avaria",
  status: "akhali",
  received_at: "2026-11-05T10:00:00Z",
  ...p,
});

describe("package usage", () => {
  it("month range in Tbilisi time", () => {
    expect(monthRange("2026-11")).toEqual({
      fromIso: "2026-10-31T20:00:00.000Z",
      toIso: "2026-11-30T20:00:00.000Z",
    });
    expect(monthKey(new Date("2026-10-31T21:00:00Z"))).toBe("2026-11");
  });
  it("counts calls toward limit (no planned, no cancelled, via object)", () => {
    const objs = new Map([["o1", "c1"]]);
    const calls = [
      call({}),
      call({ client_id: null, object_id: "o1" }),
      call({ service_type: "gegmiuri" }),
      call({ status: "gaukmebuli" }),
      call({ client_id: "c2" }),
    ];
    const u = computeUsage({ calls_mode: "limited", included_calls: 3 }, "c1", calls, objs);
    expect(u).toMatchObject({ used: 2, planned: 1, limit: 3, remaining: 1, state: "last" });
    const x = computeUsage({ calls_mode: "limited", included_calls: 2 }, "c1", calls, objs);
    expect(x.state).toBe("exhausted");
    expect(
      computeUsage({ calls_mode: "unlimited", included_calls: null }, "c1", calls, objs).state,
    ).toBe("ok");
    expect(computeUsage({ included_calls: null }, "c1", calls, objs).state).toBe("unknown");
  });
  it("working hours Mon–Fri 09–18 Tbilisi", () => {
    expect(isWorkingTime(new Date("2026-11-05T06:00:00Z"))).toBe(true); // ხუთ 10:00
    expect(isWorkingTime(new Date("2026-11-05T15:00:00Z"))).toBe(false); // 19:00
    expect(isWorkingTime(new Date("2026-11-07T08:00:00Z"))).toBe(false); // შაბათი
  });
});
