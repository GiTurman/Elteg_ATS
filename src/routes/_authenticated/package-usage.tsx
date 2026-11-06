// პაკეტების კონტროლი — კლიენტების გამოძახებები თვის ჭრილში (ლიმიტი / გამოყენებული / გადაჭარბება).
// ავტორი: Giorgi Turmanidze "GT"
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Download, Search } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/useAuth";
import { serviceTypeLabel, statusLabel } from "@/lib/domain";
import { clientsQuery, tariffsQuery } from "@/lib/entities";
import {
  callsModeShort,
  computeUsage,
  effectiveLimit,
  countsTowardLimit,
  monthCallsQuery,
  monthKey,
  monthLabel,
  type MonthCall,
  type Usage,
} from "@/lib/packageUsage";
import { objectsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/package-usage")({
  head: () => ({ meta: [{ title: "პაკეტების კონტროლი — ლიფტსერვისი" }] }),
  component: PackageUsagePage,
});

type Filter = "all" | "limited" | "exhausted" | "with_calls" | "unknown";

function lastMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15))));
  }
  return out;
}

function PackageUsagePage() {
  const { isTechnician } = useCurrentUser();
  const months = useMemo(() => lastMonths(12), []);
  const [month, setMonth] = useState(months[0]!);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const { data: clients = [] } = useQuery(clientsQuery);
  const { data: packages = [] } = useQuery(tariffsQuery);
  const { data: objects = [] } = useQuery(objectsQuery);
  const { data: calls = [], isLoading } = useQuery(monthCallsQuery(month));

  const rows = useMemo(() => {
    const objMap = new Map(
      objects.map((o) => [o.id, (o as { client_id?: string | null }).client_id ?? null]),
    );
    const byClient = new Map<string, MonthCall[]>();
    for (const c of calls) {
      const cid = c.client_id ?? (c.object_id ? (objMap.get(c.object_id) ?? null) : null);
      if (!cid) continue;
      byClient.set(cid, [...(byClient.get(cid) ?? []), c]);
    }
    // „არასამუშაო დრო“ ანგარიშში არ გვჭირდება — ვითვლით შუადღისთვის
    const noon = new Date("2026-01-07T08:00:00Z");
    return clients
      .filter((c) => c.is_active || byClient.has(c.id))
      .map((c) => {
        const list = byClient.get(c.id) ?? [];
        const pkg = packages.find((p) => p.id === c.package_id) ?? null;
        const usage: Usage = computeUsage(effectiveLimit(c, pkg), c.id, list, objMap, noon);
        return {
          client: c,
          pkg: packages.find((p) => p.id === c.package_id) ?? null,
          usage,
          list,
        };
      });
  }, [clients, packages, objects, calls]);

  const filtered = rows
    .filter((r) => {
      if (filter === "limited") return r.usage.mode === "limited";
      if (filter === "exhausted")
        return (
          r.usage.mode === "limited" && r.usage.used >= (r.usage.limit ?? 0) && r.usage.used > 0
        );
      if (filter === "with_calls") return r.usage.used + r.usage.planned > 0;
      if (filter === "unknown") return r.usage.mode === null;
      return true;
    })
    .filter((r) => !q.trim() || r.client.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort(
      (a, b) =>
        b.usage.over - a.usage.over ||
        b.usage.used - a.usage.used ||
        a.client.name.localeCompare(b.client.name, "ka"),
    );

  const totals = useMemo(() => {
    const counted = calls.filter(countsTowardLimit).length;
    const over = rows.reduce((s, r) => s + r.usage.over, 0);
    const exhausted = rows.filter(
      (r) => r.usage.mode === "limited" && r.usage.used > 0 && r.usage.used >= (r.usage.limit ?? 0),
    ).length;
    const unknown = rows.filter((r) => r.usage.mode === null).length;
    return { counted, over, exhausted, unknown };
  }, [rows, calls]);

  const exportCsv = () => {
    const head = [
      "კლიენტი",
      "პაკეტი",
      "რეჟიმი",
      "ლიმიტი",
      "გამოყენებული",
      "დარჩა",
      "გადაჭარბება",
      "გეგმიური ვიზიტი",
      "ფასი",
      "ვალუტა",
    ];
    const lines = filtered.map((r) => [
      r.client.name,
      r.pkg?.name ?? "",
      r.usage.mode ? callsModeShort[r.usage.mode] : "",
      r.usage.limit ?? "",
      r.usage.used,
      r.usage.remaining ?? "",
      r.usage.over,
      r.usage.planned,
      r.client.monthly_fee ?? "",
      r.client.currency ?? "",
    ]);
    const csv = [head, ...lines]
      .map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `პაკეტების_კონტროლი_${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (isTechnician) {
    return (
      <AppShell title="პაკეტების კონტროლი">
        <p className="py-8 text-center text-sm text-muted-foreground">
          ეს გვერდი ხელმისაწვდომია მხოლოდ დისპეჩერისა და მენეჯერისთვის.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="პაკეტების კონტროლი"
      subtitle="კლიენტების გამოძახებები თვის ჭრილში — პაკეტით გათვალისწინებული ლიმიტის მიხედვით"
      actions={
        <Button size="sm" variant="outline" onClick={exportCsv}>
          <Download className="size-3.5" /> CSV
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {monthLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ყველა კლიენტი</SelectItem>
            <SelectItem value="with_calls">გამოძახებით ამ თვეში</SelectItem>
            <SelectItem value="limited">მხოლოდ ლიმიტიანი</SelectItem>
            <SelectItem value="exhausted">ლიმიტი ამოწურული / გადაჭარბებული</SelectItem>
            <SelectItem value="unknown">პირობები მითითებული არ არის</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            placeholder="კლიენტის ძებნა"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          ["გამოძახება (ლიმიტში ითვლება)", totals.counted],
          ["ლიმიტი ამოწურული", totals.exhausted],
          ["ზედმეტი გამოძახება (ფასიანი)", totals.over],
          ["პირობები მითითებული არ არის", totals.unknown],
        ].map(([label, v]) => (
          <Card key={label as string}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-2xl font-semibold tabular-nums">{v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>კლიენტი</TableHead>
              <TableHead>პაკეტი</TableHead>
              <TableHead>რეჟიმი</TableHead>
              <TableHead className="text-right">ლიმიტი</TableHead>
              <TableHead className="text-right">გამოყენებული</TableHead>
              <TableHead className="text-right">დარჩა</TableHead>
              <TableHead className="text-right">გადაჭარბება</TableHead>
              <TableHead className="hidden text-right md:table-cell">გეგმიური</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const u = r.usage;
              const bad = u.mode === "limited" && u.used > 0 && u.used >= (u.limit ?? 0);
              const isOpen = open === r.client.id;
              return (
                <Fragment key={r.client.id}>
                  <TableRow
                    className={cn("cursor-pointer", u.over > 0 && "bg-red-50 dark:bg-red-950/30")}
                    onClick={() => setOpen(isOpen ? null : r.client.id)}
                  >
                    <TableCell>
                      {r.list.length ? (
                        isOpen ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-sm font-medium">
                      {r.client.name}
                    </TableCell>
                    <TableCell className="text-xs">{r.pkg?.name ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {u.mode ? (
                        callsModeShort[u.mode]
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{u.limit ?? "—"}</TableCell>
                    <TableCell
                      className={cn("text-right font-semibold tabular-nums", bad && "text-red-700")}
                    >
                      {u.used}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{u.remaining ?? "—"}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        u.over > 0 && "font-semibold text-red-700",
                      )}
                    >
                      {u.over || "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {u.planned || "—"}
                    </TableCell>
                  </TableRow>
                  {isOpen && r.list.length ? (
                    <TableRow>
                      <TableCell />
                      <TableCell colSpan={8} className="bg-muted/40">
                        <ul className="grid gap-1 text-xs">
                          {r.list.map((c) => (
                            <li key={c.id} className="flex flex-wrap gap-x-3">
                              <Link
                                to="/calls/$callId"
                                params={{ callId: c.id }}
                                className="font-mono text-primary underline"
                              >
                                №{c.call_no}
                              </Link>
                              <span>{new Date(c.received_at).toLocaleString("ka-GE")}</span>
                              <span>{serviceTypeLabel[c.service_type]}</span>
                              <span>{statusLabel[c.status]}</span>
                              {!countsTowardLimit(c) ? (
                                <span className="text-muted-foreground">(ლიმიტში არ ითვლება)</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  {isLoading ? "იტვირთება…" : "ჩანაწერები არ მოიძებნა"}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        ლიმიტში ითვლება ყველა გამოძახება, გარდა გეგმიური მომსახურებისა და გაუქმებულისა. თვე —
        თბილისის დროით. კლიენტის პირობების შეცვლა: „კლიენტები“ → კლიენტზე დაჭერა.
      </p>
    </AppShell>
  );
}
