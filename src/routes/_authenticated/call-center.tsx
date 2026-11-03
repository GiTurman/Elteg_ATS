import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  byOperator,
  callLogsRangeQuery,
  callsByDay,
  callsByHour,
  computeKpi,
  dayRangeIso,
  fmtSecs,
  telephonySettingsQuery,
  toDateInput,
} from "@/lib/callcenter";
import { downloadCsv } from "@/lib/domain";
import { staffQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/call-center")({
  head: () => ({
    meta: [
      { title: "ქოლ-ცენტრის KPI — ლიფტსერვისი" },
      {
        name: "description",
        content: "ნაპასუხები ზარების %, ლოდინის დრო, გამოტოვებული ზარები და SLA.",
      },
    ],
  }),
  component: CallCenterKpiPage,
});

const COLORS = { answered: "#0f766e", unanswered: "#dc2626" };

function Kpi({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={cn(
            "mt-1 text-2xl font-semibold tabular-nums",
            tone === "good" && "text-emerald-700 dark:text-emerald-400",
            tone === "warn" && "text-amber-600",
            tone === "bad" && "text-destructive",
          )}
        >
          {value}
        </div>
        {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const toneFor = (v: number | null, good: number, warn: number) =>
  v == null ? "default" : v >= good ? "good" : v >= warn ? "warn" : "bad";

function CallCenterKpiPage() {
  const queryClient = useQueryClient();
  const { isDispatcher, isTechnician, loading } = useCurrentUser();
  const today = new Date();
  const [from, setFrom] = useState(toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(toDateInput(today));
  const { fromIso, toIso } = useMemo(() => dayRangeIso(from, to), [from, to]);

  const { data: logs = [], isLoading } = useQuery({
    ...callLogsRangeQuery(fromIso, toIso),
    enabled: isDispatcher,
  });
  const { data: settings } = useQuery({ ...telephonySettingsQuery, enabled: isDispatcher });
  const { data: staff = [] } = useQuery(staffQuery);
  const sla = settings?.answer_sla_seconds ?? 20;

  useEffect(() => {
    const channel = supabase
      .channel("call_logs_kpi_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "call_logs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["call_logs"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const kpi = useMemo(() => computeKpi(logs, sla), [logs, sla]);
  const hourly = useMemo(() => callsByHour(logs), [logs]);
  const daily = useMemo(() => callsByDay(logs), [logs]);
  const nameOf = (id: string | null, ext: string | null) => {
    const s = staff.find((p) => p.id === id);
    if (s) return s.full_name || s.email || "—";
    return ext ? `შიდა ${ext}` : "უცნობი";
  };
  const operators = useMemo(() => byOperator(logs, nameOf), [logs, staff]); // eslint-disable-line react-hooks/exhaustive-deps

  const preset = (days: number | "month") => {
    const t = new Date();
    if (days === "month") setFrom(toDateInput(new Date(t.getFullYear(), t.getMonth(), 1)));
    else {
      const f = new Date(t);
      f.setDate(f.getDate() - (days - 1));
      setFrom(toDateInput(f));
    }
    setTo(toDateInput(t));
  };

  const exportCsv = () =>
    downloadCsv(`kol-centri-kpi_${from}_${to}.csv`, [
      { მაჩვენებელი: "შემოსული ზარები (ტესტის გარეშე)", მნიშვნელობა: kpi.offered },
      { მაჩვენებელი: "ნაპასუხები", მნიშვნელობა: kpi.answered },
      { მაჩვენებელი: "ნაპასუხები %", მნიშვნელობა: pct(kpi.answerRate) },
      { მაჩვენებელი: `ნაპასუხები ${sla} წამში % (SLA)`, მნიშვნელობა: pct(kpi.slaRate) },
      { მაჩვენებელი: "გამოტოვებული", მნიშვნელობა: kpi.missed },
      { მაჩვენებელი: "მიტოვებული", მნიშვნელობა: kpi.abandoned },
      { მაჩვენებელი: "ხმოვანი ფოსტა", მნიშვნელობა: kpi.voicemail },
      { მაჩვენებელი: "საშუალო ლოდინი (წმ)", მნიშვნელობა: kpi.avgWait?.toFixed(1) ?? "" },
      { მაჩვენებელი: "მაქს. ლოდინი (წმ)", მნიშვნელობა: kpi.maxWait ?? "" },
      { მაჩვენებელი: "საშუალო საუბარი", მნიშვნელობა: fmtSecs(kpi.avgTalk) },
      { მაჩვენებელი: "გამავალი ზარები", მნიშვნელობა: kpi.outbound },
      { მაჩვენებელი: "კაბინიდან ზარები", მნიშვნელობა: kpi.cabin },
      { მაჩვენებელი: "ტესტ-ზარები", მნიშვნელობა: kpi.tests },
      { მაჩვენებელი: "დასარეკი (მოლოდინში)", მნიშვნელობა: kpi.callbacksPending },
      { მაჩვენებელი: "გადარეკილი", მნიშვნელობა: kpi.callbacksDone },
      {
        მაჩვენებელი: "გადარეკვის საშ. დრო (წთ)",
        მნიშვნელობა: kpi.avgCallbackMinutes?.toFixed(1) ?? "",
      },
      { მაჩვენებელი: "ავტორი", მნიშვნელობა: 'Giorgi Turmanidze "GT"' },
    ]);

  if (!loading && (isTechnician || !isDispatcher)) {
    return (
      <AppShell title="ქოლ-ცენტრის KPI">
        <p className="py-8 text-center text-sm text-muted-foreground">
          ეს გვერდი ხელმისაწვდომია მხოლოდ დისპეჩერისა და მენეჯერისთვის.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="ქოლ-ცენტრის KPI"
      subtitle={`SLA: პასუხი ${sla} წამში · ტესტ-ზარები გამორიცხულია`}
      actions={
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!logs.length}>
          <Download className="size-3.5" /> CSV
        </Button>
      }
    >
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-3">
            <div className="grid gap-1">
              <Label className="text-xs">დან</Label>
              <Input
                type="date"
                value={from}
                max={to}
                onChange={(e) => e.target.value && setFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">მდე</Label>
              <Input
                type="date"
                value={to}
                min={from}
                onChange={(e) => e.target.value && setTo(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => preset(1)}>
                დღეს
              </Button>
              <Button size="sm" variant="outline" onClick={() => preset(7)}>
                7 დღე
              </Button>
              <Button size="sm" variant="outline" onClick={() => preset(30)}>
                30 დღე
              </Button>
              <Button size="sm" variant="outline" onClick={() => preset("month")}>
                ეს თვე
              </Button>
            </div>
            {isLoading ? <span className="text-xs text-muted-foreground">იტვირთება…</span> : null}
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="ნაპასუხები %"
            value={pct(kpi.answerRate)}
            hint={`${kpi.answered} / ${kpi.offered} შემოსული`}
            tone={toneFor(kpi.answerRate, 95, 85)}
          />
          <Kpi
            label={`SLA — ნაპასუხები ${sla} წამში`}
            value={pct(kpi.slaRate)}
            hint="მიზანი: ≥ 80%"
            tone={toneFor(kpi.slaRate, 80, 65)}
          />
          <Kpi
            label="საშუალო ლოდინი"
            value={kpi.avgWait == null ? "—" : `${kpi.avgWait.toFixed(1)} წმ`}
            hint={`მაქს.: ${kpi.maxWait ?? "—"} წმ`}
            tone={kpi.avgWait == null ? "default" : kpi.avgWait <= sla ? "good" : "bad"}
          />
          <Kpi
            label="გამოტოვებული + მიტოვებული"
            value={String(kpi.missed + kpi.abandoned + kpi.voicemail)}
            hint={`გამოტ. ${kpi.missed} · მიტოვ. ${kpi.abandoned} · ხმ. ფოსტა ${kpi.voicemail}`}
            tone={kpi.missed + kpi.abandoned > 0 ? "bad" : "good"}
          />
          <Kpi label="საშუალო საუბარი" value={fmtSecs(kpi.avgTalk)} />
          <Kpi
            label="🚨 კაბინიდან ზარები"
            value={String(kpi.cabin)}
            hint={`ტესტ-ზარები: ${kpi.tests}`}
            tone={kpi.cabin ? "warn" : "default"}
          />
          <Kpi
            label="უკან დასარეკი (მოლოდინში)"
            value={String(kpi.callbacksPending)}
            hint={`გადარეკილი: ${kpi.callbacksDone}`}
            tone={kpi.callbacksPending ? "bad" : "good"}
          />
          <Kpi
            label="გადარეკვის საშ. დრო"
            value={kpi.avgCallbackMinutes == null ? "—" : `${kpi.avgCallbackMinutes.toFixed(0)} წთ`}
            hint={`გამავალი ზარები: ${kpi.outbound}`}
            tone={
              kpi.avgCallbackMinutes == null
                ? "default"
                : kpi.avgCallbackMinutes <= 15
                  ? "good"
                  : "warn"
            }
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">ზარები საათების მიხედვით (დატვირთვა)</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="answered" name="ნაპასუხები" stackId="a" fill={COLORS.answered} />
                  <Bar dataKey="unanswered" name="უპასუხო" stackId="a" fill={COLORS.unanswered} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">დღიური დინამიკა</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              {daily.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="answered" name="ნაპასუხები" stackId="a" fill={COLORS.answered} />
                    <Bar dataKey="unanswered" name="უპასუხო" stackId="a" fill={COLORS.unanswered} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  მონაცემები არ არის
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">ოპერატორების მიხედვით</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ოპერატორი</TableHead>
                  <TableHead className="text-right">ნაპასუხები</TableHead>
                  <TableHead className="text-right">გამავალი</TableHead>
                  <TableHead className="text-right">საშ. ლოდინი</TableHead>
                  <TableHead className="text-right">საუბრის ჯამი</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operators.map((o) => (
                  <TableRow key={o.name}>
                    <TableCell className="text-sm">{o.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.answered}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.outbound}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.avgWait == null ? "—" : `${o.avgWait.toFixed(1)} წმ`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtSecs(o.talk)}</TableCell>
                  </TableRow>
                ))}
                {operators.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      ამ პერიოდში ნაპასუხები ზარები არ არის
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-[11px] text-muted-foreground">
          ნაპასუხები % = ნაპასუხები / შემოსული · SLA % = {sla} წამში ნაპასუხები / ყველა შემოსული ·
          დეტალები —{" "}
          <Link to="/call-history" className="text-primary hover:underline">
            ზარების ისტორია
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
