import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Download,
  PhoneCall,
  Siren,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSoftphone } from "@/components/softphone/SoftphoneProvider";
import { useNotifyStatus } from "@/hooks/useNotifyStatus";
import { useCurrentUser } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  callbackLabel,
  callLogsRangeQuery,
  callsFromNumberQuery,
  callStatusLabel,
  dayRangeIso,
  directionLabel,
  fmtSecs,
  pendingCallbacksQuery,
  toDateInput,
  type CallLog,
} from "@/lib/callcenter";
import { downloadCsv, formatDateTime } from "@/lib/domain";
import { clientsQuery, dbx } from "@/lib/entities";
import { objectsQuery, staffQuery } from "@/lib/queries";
import { normalizeGePhone } from "@/lib/telephony";
import { cn } from "@/lib/utils";
import { PackageUsage } from "@/components/calls/PackageUsage";

export const Route = createFileRoute("/_authenticated/call-history")({
  head: () => ({
    meta: [
      { title: "ზარების ისტორია — ლიფტსერვისი" },
      {
        name: "description",
        content: "ქოლ-ცენტრის ზარების ისტორია, ჩანაწერები და უკან დასარეკი ზარები.",
      },
    ],
  }),
  component: CallHistoryPage,
});

const PAGE_SIZE = 50;

function statusTone(status: string) {
  switch (status) {
    case "answered":
      return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300";
    case "missed":
    case "abandoned":
      return "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300";
    case "voicemail":
      return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300";
    case "ringing":
      return "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function StatusPill({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap text-[11px]", statusTone(status))}>
      {callStatusLabel[status] ?? status}
    </Badge>
  );
}

function DirectionIcon({ direction }: { direction: string | null }) {
  const Icon =
    direction === "outbound"
      ? ArrowUpRight
      : direction === "internal"
        ? ArrowLeftRight
        : ArrowDownLeft;
  return (
    <span title={directionLabel[direction ?? "inbound"]} className="inline-flex">
      <Icon
        className={cn(
          "size-4",
          direction === "outbound"
            ? "text-sky-600"
            : direction === "internal"
              ? "text-muted-foreground"
              : "text-emerald-600",
        )}
      />
    </span>
  );
}

function minutesSince(iso: string | null) {
  if (!iso) return 0;
  return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
}

function CallHistoryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isDispatcher, isTechnician, loading, userId } = useCurrentUser();

  const today = toDateInput(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [direction, setDirection] = useState("all");
  const [status, setStatus] = useState("all");
  const [operator, setOperator] = useState("all");
  const [cabinOnly, setCabinOnly] = useState(false);
  const [showTests, setShowTests] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<CallLog | null>(null);
  const [tab, setTab] = useState("history");
  useEffect(() => {
    if (window.location.hash === "#callbacks") setTab("callbacks");
  }, []);

  const { fromIso, toIso } = useMemo(() => dayRangeIso(from, to), [from, to]);
  const { data: logs = [], isLoading } = useQuery({
    ...callLogsRangeQuery(fromIso, toIso),
    enabled: isDispatcher,
  });
  const { data: pending = [] } = useQuery({ ...pendingCallbacksQuery, enabled: isDispatcher });
  const { data: clients = [] } = useQuery(clientsQuery);
  const { data: objects = [] } = useQuery(objectsQuery);
  const { data: staff = [] } = useQuery(staffQuery);

  // Realtime: ახალი/შეცვლილი ზარი მაშინვე ჩანს
  useEffect(() => {
    const channel = supabase
      .channel(`call_logs_history_live:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_logs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["call_logs"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  useEffect(
    () => setPage(0),
    [from, to, direction, status, operator, cabinOnly, showTests, search],
  );

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? null;
  const objectOf = (id: string | null) => objects.find((o) => o.id === id) ?? null;
  const operatorName = (id: string | null, ext: string | null) => {
    const s = staff.find((p) => p.id === id);
    if (s) return s.full_name || s.email || "—";
    return ext ? `შიდა ${ext}` : "—";
  };

  const filtered = useMemo(() => {
    const q = search.trim();
    const qNorm = normalizeGePhone(q);
    const qDigits = q.replace(/\D/g, "");
    return logs.filter((l) => {
      if (!showTests && l.status === "test") return false;
      if (direction !== "all" && l.direction !== direction) return false;
      if (status !== "all" && l.status !== status) return false;
      if (operator !== "all" && l.agent_profile_id !== operator) return false;
      if (cabinOnly && !l.is_cabin_call) return false;
      if (q) {
        if (qNorm) {
          if (l.caller_number_norm !== qNorm && normalizeGePhone(l.called_number) !== qNorm)
            return false;
        } else if (qDigits) {
          const hay = `${l.caller_number ?? ""} ${l.called_number ?? ""}`.replace(/\D/g, "");
          if (!hay.includes(qDigits)) return false;
        } else {
          const name = clientName(l.matched_client_id) ?? "";
          if (!name.toLowerCase().includes(q.toLowerCase())) return false;
        }
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, showTests, direction, status, operator, cabinOnly, search, clients]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const exportCsv = () => {
    downloadCsv(
      `zarebi_${from}_${to}.csv`,
      filtered.map((l) => ({
        "თარიღი/დრო": formatDateTime(l.started_at),
        მიმართულება: directionLabel[l.direction ?? "inbound"] ?? l.direction,
        ნომერი: l.direction === "outbound" ? l.called_number : l.caller_number,
        კლიენტი: clientName(l.matched_client_id) ?? "",
        ობიექტი: objectOf(l.matched_object_id)?.name ?? "",
        კაბინიდან: l.is_cabin_call ? "კი" : "",
        ოპერატორი: operatorName(l.agent_profile_id, l.agent_extension),
        სტატუსი: callStatusLabel[l.status] ?? l.status,
        "ლოდინი (წმ)": l.wait_seconds ?? "",
        "საუბარი (წმ)": l.talk_seconds ?? "",
        "უკან დარეკვა": callbackLabel[l.callback_status] ?? l.callback_status,
        ჩანაწერი: l.recording_url ?? "",
        შენიშვნა: l.notes ?? "",
        "ზარის ID": l.external_call_id,
      })),
    );
  };

  const setCallback = useMutation({
    mutationFn: async ({
      id,
      value,
      note,
    }: {
      id: string;
      value: "done" | "not_needed";
      note?: string;
    }) => {
      const patch: {
        callback_status: string;
        callback_by: string | null;
        callback_at: string;
        notes?: string;
      } = {
        callback_status: value,
        callback_by: userId ?? null,
        callback_at: new Date().toISOString(),
      };
      if (note && note.trim()) patch.notes = note.trim();
      const { error } = await supabase.from("call_logs").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["call_logs"] });
      toast.success(v.value === "done" ? "მონიშნულია: გადარეკილია" : "მონიშნულია: არ საჭიროებს");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const notifyStatus = useNotifyStatus();
  const createServiceCall = useMutation({
    mutationFn: async (l: CallLog) => {
      const obj = objectOf(l.matched_object_id);
      const client = clients.find((c) => c.id === l.matched_client_id);
      const cName = client?.name ?? null;
      const number = l.direction === "outbound" ? l.called_number : l.caller_number;
      const { data: call, error } = await dbx
        .from("service_calls")
        .insert({
          object_id: l.matched_object_id,
          client_id: l.matched_client_id,
          site_name: obj?.name ?? cName ?? "ქოლ-ცენტრი",
          address: obj?.address ?? client?.address ?? "—",
          elevator_code: obj?.elevator_code ?? null,
          service_type: l.is_cabin_call ? "chamokideba" : "avaria",
          priority: l.is_cabin_call ? "kritikuli" : "maghali",
          description: l.is_cabin_call
            ? `🚨 კაბინიდან ზარი — შესაძლოა ჩარჩენილი მგზავრი. ნომერი: ${number ?? "—"}`
            : `ზარების ისტორიიდან, ნომერი: ${number ?? "—"}`,
          client_name: cName,
          client_phone: number,
          caller_number: number,
          source: "hotline",
          created_by: userId ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      notifyStatus(call.id);
      const { error: upErr } = await supabase
        .from("call_logs")
        .update({ service_call_id: call.id })
        .eq("id", l.id);
      if (upErr) throw upErr;
      if (l.incoming_call_id) {
        await dbx
          .from("incoming_calls")
          .update({ status: "linked", service_call_id: call.id })
          .eq("id", l.incoming_call_id);
      }
      return call.id as string;
    },
    onSuccess: (callId) => {
      queryClient.invalidateQueries({ queryKey: ["call_logs"] });
      queryClient.invalidateQueries({ queryKey: ["service_calls"] });
      queryClient.invalidateQueries({ queryKey: ["incoming_calls"] });
      toast.success("გამოძახება შეიქმნა");
      navigate({ to: "/calls/$callId", params: { callId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!loading && (isTechnician || !isDispatcher)) {
    return (
      <AppShell title="ზარების ისტორია">
        <p className="py-8 text-center text-sm text-muted-foreground">
          ეს გვერდი ხელმისაწვდომია მხოლოდ დისპეჩერისა და მენეჯერისთვის.
        </p>
      </AppShell>
    );
  }

  const operators = staff.filter(
    (s) => s.roles.includes("dispatcher") || s.roles.includes("manager"),
  );

  return (
    <AppShell
      title="ზარების ისტორია"
      subtitle={`ნაჩვენებია ${filtered.length} ზარი · უკან დასარეკი: ${pending.length}`}
      actions={
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!filtered.length}>
          <Download className="size-3.5" /> CSV
        </Button>
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3">
          <TabsTrigger value="history">ისტორია</TabsTrigger>
          <TabsTrigger value="callbacks">
            უკან დასარეკი
            {pending.length ? (
              <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">
                {pending.length}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="space-y-3">
          <Card>
            <CardContent className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <div className="grid gap-1">
                <Label className="text-xs">დან</Label>
                <Input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value || today)}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">მდე</Label>
                <Input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value || today)}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">მიმართულება</Label>
                <Select value={direction} onValueChange={setDirection}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ყველა</SelectItem>
                    {Object.entries(directionLabel).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">სტატუსი</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ყველა</SelectItem>
                    {Object.entries(callStatusLabel).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">ოპერატორი</Label>
                <Select value={operator} onValueChange={setOperator}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ყველა</SelectItem>
                    {operators.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.full_name || o.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1 lg:col-span-2">
                <Label className="text-xs">ძებნა (ნომერი ან კლიენტი)</Label>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="599 12 34 56"
                />
              </div>
              <div className="flex flex-col justify-end gap-2 text-xs">
                <label className="flex items-center gap-2">
                  <Switch checked={cabinOnly} onCheckedChange={setCabinOnly} /> მხოლოდ კაბინიდან
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={showTests} onCheckedChange={setShowTests} /> ტესტ-ზარების ჩვენება
                </label>
              </div>
            </CardContent>
          </Card>

          <div className="overflow-x-auto rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>დრო</TableHead>
                  <TableHead className="w-8" />
                  <TableHead>ნომერი</TableHead>
                  <TableHead className="hidden md:table-cell">კლიენტი / ობიექტი</TableHead>
                  <TableHead className="hidden lg:table-cell">ოპერატორი</TableHead>
                  <TableHead>სტატუსი</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">ლოდინი</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">საუბარი</TableHead>
                  <TableHead className="hidden xl:table-cell">ჩანაწერი</TableHead>
                  <TableHead className="hidden md:table-cell">გამოძახება</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((l) => {
                  const obj = objectOf(l.matched_object_id);
                  const cName = clientName(l.matched_client_id);
                  const number = l.direction === "outbound" ? l.called_number : l.caller_number;
                  return (
                    <TableRow
                      key={l.id}
                      className={cn(
                        "cursor-pointer",
                        l.is_cabin_call && "bg-red-50 dark:bg-red-950/30",
                      )}
                      onClick={() => setSelected(l)}
                    >
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        {formatDateTime(l.started_at)}
                      </TableCell>
                      <TableCell>
                        <DirectionIcon direction={l.direction} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {number ?? "უცნობი"}
                        {l.is_cabin_call ? (
                          <Badge variant="destructive" className="ml-1.5 px-1 text-[10px]">
                            <Siren className="mr-0.5 size-3" /> კაბინა
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden max-w-[240px] truncate text-xs md:table-cell">
                        {cName ?? "—"}
                        {obj ? <span className="text-muted-foreground"> · {obj.name}</span> : null}
                      </TableCell>
                      <TableCell className="hidden text-xs lg:table-cell">
                        {operatorName(l.agent_profile_id, l.agent_extension)}
                      </TableCell>
                      <TableCell>
                        <StatusPill status={l.status} />
                      </TableCell>
                      <TableCell className="hidden text-right text-xs tabular-nums sm:table-cell">
                        {l.wait_seconds != null ? `${l.wait_seconds} წმ` : "—"}
                      </TableCell>
                      <TableCell className="hidden text-right text-xs tabular-nums sm:table-cell">
                        {fmtSecs(l.talk_seconds)}
                      </TableCell>
                      <TableCell
                        className="hidden xl:table-cell"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {l.recording_url ? (
                          <audio
                            controls
                            preload="none"
                            src={l.recording_url}
                            className="h-8 w-56"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="hidden text-xs md:table-cell"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {l.service_call_id ? (
                          <Link
                            to="/calls/$callId"
                            params={{ callId: l.service_call_id }}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            გახსნა
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {pageRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      {isLoading ? "იტვირთება…" : "ამ პერიოდში ზარები არ მოიძებნა"}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          {pageCount > 1 ? (
            <div className="flex items-center justify-end gap-2 text-xs">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                წინა
              </Button>
              <span className="tabular-nums">
                {page + 1} / {pageCount}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                შემდეგი
              </Button>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="callbacks" className="space-y-2">
          {pending.map((l) => (
            <CallbackRow
              key={l.id}
              log={l}
              clientName={clientName(l.matched_client_id)}
              objectName={objectOf(l.matched_object_id)?.name ?? null}
              busy={setCallback.isPending}
              onDone={(note) => setCallback.mutate({ id: l.id, value: "done", note })}
              onNotNeeded={() => setCallback.mutate({ id: l.id, value: "not_needed" })}
              onOpen={() => setSelected(l)}
            />
          ))}
          {pending.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              უკან დასარეკი ზარები არ არის 👍
            </p>
          ) : null}
        </TabsContent>
      </Tabs>

      <CallDetail
        log={selected}
        onClose={() => setSelected(null)}
        clientName={selected ? clientName(selected.matched_client_id) : null}
        objectName={selected ? (objectOf(selected.matched_object_id)?.name ?? null) : null}
        operatorName={
          selected ? operatorName(selected.agent_profile_id, selected.agent_extension) : ""
        }
        onCreateCall={(l) => createServiceCall.mutate(l)}
        creating={createServiceCall.isPending}
      />
    </AppShell>
  );
}

function CallbackRow({
  log,
  clientName,
  objectName,
  busy,
  onDone,
  onNotNeeded,
  onOpen,
}: {
  log: CallLog;
  clientName: string | null;
  objectName: string | null;
  busy: boolean;
  onDone: (note: string) => void;
  onNotNeeded: () => void;
  onOpen: () => void;
}) {
  const [note, setNote] = useState("");
  const phone = useSoftphone();
  const waited = minutesSince(log.ended_at ?? log.started_at);
  const late = waited > 15;
  return (
    <Card
      className={cn(
        late && "border-destructive/60",
        log.is_cabin_call && "bg-red-50 dark:bg-red-950/30",
      )}
    >
      <CardContent className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpen}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!log.caller_number}
              onClick={(e) => {
                e.stopPropagation();
                if (!log.caller_number) return;
                if (phone) phone.dial(log.caller_number);
                else window.location.href = `tel:${log.caller_number}`;
              }}
              title="დარეკვა"
              className="font-mono text-sm font-semibold text-primary hover:underline"
            >
              <PhoneCall className="mr-1 inline size-3.5" />
              {log.caller_number ?? "უცნობი ნომერი"}
            </button>
            <StatusPill status={log.status} />
            {log.is_cabin_call ? (
              <Badge variant="destructive" className="text-[10px]">
                🚨 კაბინიდან
              </Badge>
            ) : null}
            <span
              className={cn(
                "text-xs tabular-nums",
                late ? "font-semibold text-destructive" : "text-muted-foreground",
              )}
            >
              ელოდება {waited} წთ
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {clientName ?? "კლიენტი ვერ მოიძებნა"}
            {objectName ? ` · ${objectName}` : ""} · {formatDateTime(log.started_at)}
          </div>
        </div>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="შენიშვნა (არასავალდებულო)"
          className="h-8 text-xs lg:w-64"
        />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onDone(note)}>
            დავრეკე
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onNotNeeded}>
            არ საჭიროებს
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CallDetail({
  log,
  onClose,
  clientName,
  objectName,
  operatorName,
  onCreateCall,
  creating,
}: {
  log: CallLog | null;
  onClose: () => void;
  clientName: string | null;
  objectName: string | null;
  operatorName: string;
  onCreateCall: (l: CallLog) => void;
  creating: boolean;
}) {
  const queryClient = useQueryClient();
  const phone = useSoftphone();
  const [notes, setNotes] = useState("");
  useEffect(() => setNotes(log?.notes ?? ""), [log]);
  const { data: sameNumber = [] } = useQuery(callsFromNumberQuery(log?.caller_number_norm ?? null));

  const saveNotes = useMutation({
    mutationFn: async () => {
      if (!log) return;
      const { error } = await supabase
        .from("call_logs")
        .update({ notes: notes.trim() || null })
        .eq("id", log.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["call_logs"] });
      toast.success("შენიშვნა შენახულია");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows: [string, ReactNode][] = log
    ? [
        ["თარიღი/დრო", formatDateTime(log.started_at)],
        ["მიმართულება", directionLabel[log.direction ?? "inbound"] ?? log.direction],
        ["დამრეკი", log.caller_number ?? "—"],
        ["ჩვენი ხაზი", log.called_number ?? "—"],
        ["რიგი", log.queue_name ?? "—"],
        ["კლიენტი", clientName ?? "—"],
        ["ობიექტი", objectName ?? "—"],
        ["კაბინიდან", log.is_cabin_call ? "🚨 კი" : "არა"],
        ["ოპერატორი", operatorName],
        ["სტატუსი", <StatusPill key="s" status={log.status} />],
        ["ლოდინი", log.wait_seconds != null ? `${log.wait_seconds} წმ` : "—"],
        ["საუბარი", fmtSecs(log.talk_seconds)],
        ["პასუხი", formatDateTime(log.answered_at)],
        ["დასრულება", formatDateTime(log.ended_at)],
        [
          "უკან დარეკვა",
          `${callbackLabel[log.callback_status] ?? log.callback_status}${log.callback_at ? ` · ${formatDateTime(log.callback_at)}` : ""}`,
        ],
        [
          "ზარის ID",
          <span key="id" className="font-mono text-[11px]">
            {log.external_call_id}
          </span>,
        ],
      ]
    : [];

  return (
    <Sheet open={!!log} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>ზარის დეტალები</SheetTitle>
        </SheetHeader>
        {log ? (
          <div className="space-y-4 px-4 pb-6 text-sm">
            <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-xs">{v}</dd>
                </div>
              ))}
            </dl>

            <PackageUsage clientId={log.matched_client_id} objectId={log.matched_object_id} />

            {log.recording_url ? (
              <div className="grid gap-1">
                <Label className="text-xs">ჩანაწერი</Label>
                <audio controls preload="none" src={log.recording_url} className="w-full" />
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <Label className="text-xs">შენიშვნა</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              <Button
                size="sm"
                variant="outline"
                className="justify-self-start"
                onClick={() => saveNotes.mutate()}
                disabled={saveNotes.isPending}
              >
                შენახვა
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              {(log.direction === "outbound" ? log.called_number : log.caller_number) ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const n = (
                      log.direction === "outbound" ? log.called_number : log.caller_number
                    )!;
                    if (phone) phone.dial(n);
                    else window.location.href = `tel:${n}`;
                  }}
                >
                  <PhoneCall className="size-3.5" /> დარეკვა
                </Button>
              ) : null}
              {log.service_call_id ? (
                <Button asChild size="sm" variant="secondary">
                  <Link to="/calls/$callId" params={{ callId: log.service_call_id }}>
                    დაკავშირებული გამოძახების გახსნა
                  </Link>
                </Button>
              ) : (
                <Button size="sm" onClick={() => onCreateCall(log)} disabled={creating}>
                  {log.is_cabin_call ? "🚨 გამოძახების შექმნა (ჩამოკიდება)" : "გამოძახების შექმნა"}
                </Button>
              )}
            </div>

            {sameNumber.length > 1 ? (
              <div className="grid gap-1.5">
                <Label className="text-xs">ამ ნომრის სხვა ზარები</Label>
                <div className="divide-y rounded-md border">
                  {sameNumber
                    .filter((s) => s.id !== log.id)
                    .map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs"
                      >
                        <span className="tabular-nums">{formatDateTime(s.started_at)}</span>
                        <span>{directionLabel[s.direction ?? "inbound"]}</span>
                        <StatusPill status={s.status} />
                        <span className="tabular-nums">{fmtSecs(s.talk_seconds)}</span>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
