import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CalendarClock, PhoneCall, PhoneMissed, Wrench } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/badges";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/useAuth";
import {
  formatDateTime,
  isOpen,
  isSameDay,
  roleLabel,
  slaState,
  type ServiceCall,
} from "@/lib/domain";
import { pendingCallbacksQuery } from "@/lib/callcenter";
import { callsQuery, objectsQuery, staffQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "დაფა — ლიფტსერვისი" },
      { name: "description", content: "ოპერაციული მიმოხილვა და ბოლო გამოძახებები." },
      { property: "og:title", content: "დაფა — ლიფტსერვისი" },
      { property: "og:description", content: "ოპერაციული მიმოხილვა." },
    ],
  }),
  component: DashboardPage,
});

function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: typeof PhoneCall;
  tone?: "default" | "warning" | "danger";
}) {
  const toneCls =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning-foreground"
        : "text-primary";
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-md bg-muted p-2 ${toneCls}`}>
          <Icon className="size-4" />
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const { role, isTechnician, userId, profile } = useCurrentUser();
  const { data: calls = [] } = useQuery(callsQuery);
  const { data: objects = [] } = useQuery(objectsQuery);
  const { data: staff = [] } = useQuery(staffQuery);
  const { data: pendingCallbacks = [] } = useQuery({
    ...pendingCallbacksQuery,
    enabled: !isTechnician,
  });

  const mine: ServiceCall[] = isTechnician ? calls.filter((c) => c.assigned_to === userId) : calls;

  const open = mine.filter((c) => isOpen(c.status));
  const today = mine.filter(
    (c) => c.scheduled_at && isSameDay(new Date(c.scheduled_at), new Date()),
  );
  const atRisk = open.filter((c) => {
    const s = slaState(c);
    return s === "warning" || s === "breached";
  });
  const overdue = objects.filter((o) => o.next_due_date && new Date(o.next_due_date) < new Date());

  const recent = mine.slice(0, 8);
  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? "—";

  return (
    <AppShell
      title={`მოგესალმებით, ${profile?.full_name || "მომხმარებელო"}`}
      subtitle={`როლი: ${roleLabel[role]}`}
    >
      <div
        className={`grid gap-3 sm:grid-cols-2 ${isTechnician ? "xl:grid-cols-4" : "xl:grid-cols-5"}`}
      >
        <StatCard label="ღია გამოძახებები" value={open.length} icon={PhoneCall} />
        <StatCard label="დღეს დაგეგმილი" value={today.length} icon={CalendarClock} />
        <StatCard
          label="SLA რისკის ქვეშ"
          value={atRisk.length}
          icon={AlertTriangle}
          tone="danger"
        />
        <StatCard
          label="ვადაგადაცილებული პრევენცია"
          value={overdue.length}
          icon={Wrench}
          tone="warning"
        />
        {!isTechnician ? (
          <a
            href="/call-history#callbacks"
            className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StatCard
              label="გამოტოვებული — დასარეკი"
              value={pendingCallbacks.length}
              icon={PhoneMissed}
              tone={pendingCallbacks.length ? "danger" : "default"}
            />
          </a>
        ) : null}
      </div>

      <Card className="mt-4">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">ბოლო გამოძახებები</h2>
            <Link to="/calls" className="text-xs font-medium text-primary hover:underline">
              ყველას ნახვა
            </Link>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">#</TableHead>
                  <TableHead>ობიექტი</TableHead>
                  <TableHead className="hidden md:table-cell">ლიფტი</TableHead>
                  <TableHead>პრიორიტეტი</TableHead>
                  <TableHead>სტატუსი</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead className="hidden lg:table-cell">ტექნიკოსი</TableHead>
                  <TableHead className="hidden lg:table-cell">მიღების დრო</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((c) => (
                  <TableRow
                    key={c.id}
                    className={
                      slaState(c) === "breached" && isOpen(c.status)
                        ? "bg-destructive/5"
                        : undefined
                    }
                  >
                    <TableCell className="font-mono text-xs">{c.call_no}</TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="truncate text-sm font-medium">{c.site_name}</div>
                      <div className="truncate text-xs text-muted-foreground">{c.address}</div>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">
                      {c.elevator_code}
                    </TableCell>
                    <TableCell>
                      <PriorityBadge value={c.priority} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={c.status} />
                    </TableCell>
                    <TableCell>
                      <SlaBadge call={c} />
                    </TableCell>
                    <TableCell className="hidden text-xs lg:table-cell">
                      {nameOf(c.assigned_to)}
                    </TableCell>
                    <TableCell className="hidden text-xs whitespace-nowrap lg:table-cell">
                      {formatDateTime(c.received_at)}
                    </TableCell>
                  </TableRow>
                ))}
                {recent.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      გამოძახებები არ მოიძებნა
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
