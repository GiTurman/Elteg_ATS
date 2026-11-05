import { useState, type ReactNode } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Clock, Pencil } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { EditCallDialog } from "@/components/calls/EditCallDialog";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { clientsQuery, dbx, teamsQuery } from "@/lib/entities";
import {
  formatDateTime,
  serviceTypeLabel,
  STATUS_FLOW,
  statusLabel,
  type CallStatus,
} from "@/lib/domain";
import { historyQuery, notesQuery, staffQuery } from "@/lib/queries";

const callQuery = (id: string) =>
  queryOptions({
    queryKey: ["service_call", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_calls")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const Route = createFileRoute("/_authenticated/calls/$callId")({
  head: () => ({
    meta: [{ title: "გამოძახება — ლიფტსერვისი" }],
  }),
  component: CallDetailPage,
});

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm">{value || "—"}</div>
    </div>
  );
}

function toInputValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function CallDetailPage() {
  const { callId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDispatcher, role, userId, profile } = useCurrentUser();

  const { data: call, isLoading } = useQuery(callQuery(callId));
  const { data: staff = [] } = useQuery(staffQuery);
  const { data: history = [] } = useQuery(historyQuery(callId));
  const { data: notes = [] } = useQuery(notesQuery(callId));
  const { data: teams = [] } = useQuery(teamsQuery);
  const { data: clients = [] } = useQuery(clientsQuery);

  const technicians = staff.filter((s) => s.roles.includes("technician"));
  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? "—";

  const callExtra = (call ?? {}) as {
    assigned_team_id?: string | null;
    client_id?: string | null;
  };
  const clientName = clients.find((c) => c.id === callExtra.client_id)?.name ?? null;

  const [assignee, setAssignee] = useState<string>("");
  const [team, setTeam] = useState<string>("");
  const [scheduled, setScheduled] = useState<string>("");
  const [note, setNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["service_call", callId] });
    queryClient.invalidateQueries({ queryKey: ["service_calls"] });
    queryClient.invalidateQueries({ queryKey: ["call_history", callId] });
  };

  const setStatus = useMutation({
    mutationFn: async (status: CallStatus) => {
      const { error } = await supabase.from("service_calls").update({ status }).eq("id", callId);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("სტატუსი განახლდა");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveAssignment = useMutation({
    mutationFn: async () => {
      const { error } = await dbx
        .from("service_calls")
        .update({
          assigned_to: assignee || null,
          assigned_team_id: team || null,
          scheduled_at: scheduled ? new Date(scheduled).toISOString() : null,
        })
        .eq("id", callId);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("მიბმა შენახულია");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addNote = useMutation({
    mutationFn: async () => {
      if (!note.trim()) return;
      const { error } = await supabase.from("call_notes").insert({
        call_id: callId,
        body: note.trim(),
        author_id: userId ?? null,
        author_name: profile?.full_name || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["call_notes", callId] });
      toast.success("კომენტარი დაემატა");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <AppShell title="გამოძახება">
        <p className="text-sm text-muted-foreground">იტვირთება…</p>
      </AppShell>
    );
  }

  if (!call) {
    return (
      <AppShell title="გამოძახება">
        <p className="text-sm text-muted-foreground">გამოძახება ვერ მოიძებნა.</p>
        <Button asChild variant="outline" className="mt-3">
          <Link to="/calls">
            <ArrowLeft className="size-4" /> სიაში დაბრუნება
          </Link>
        </Button>
      </AppShell>
    );
  }

  const currentIdx = STATUS_FLOW.indexOf(call.status);
  const nextStatus =
    currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIdx + 1] : null;
  const closed = call.status === "dakhuruli" || call.status === "gaukmebuli";
  const canEdit = isDispatcher || role === "technician";

  return (
    <AppShell
      title={`გამოძახება #${call.call_no}`}
      subtitle={call.site_name}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/calls">
            <ArrowLeft className="size-4" /> უკან
          </Link>
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 p-4">
              <PriorityBadge value={call.priority} />
              <StatusBadge value={call.status} />
              <SlaBadge call={call} />
              <span className="ml-auto text-xs text-muted-foreground">
                მიღების დრო: {formatDateTime(call.received_at)}
              </span>
            </CardContent>
          </Card>

          {isDispatcher && !callExtra.client_id && !call.object_id ? (
            <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
              <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <AlertCircle className="size-4 text-amber-600" />
                <span className="flex-1">
                  გამოძახება კლიენტზე/ობიექტზე არ არის მიბმული
                  {call.caller_number ? ` (დამრეკი: ${call.caller_number})` : ""}. შეავსეთ
                  მონაცემები.
                </span>
                <Button size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="size-3.5" /> შევსება
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">დეტალები</CardTitle>
              {isDispatcher ? (
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="size-3.5" /> რედაქტირება
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Field label="ობიექტი" value={call.site_name} />
              <Field label="დამრეკის ნომერი" value={call.caller_number} />
              <Field label="მისამართი" value={call.address} />
              <Field label="კლიენტი" value={clientName} />
              <Field label="ტიპი" value={serviceTypeLabel[call.service_type]} />
              <Field label="ლიფტის კოდი" value={call.elevator_code} />
              <Field label="ქარხნული ნომერი" value={call.serial_number} />
              <Field label="დამკვეთი" value={call.client_name} />
              <Field label="საკონტაქტო" value={call.client_phone} />
              <Field label="დაგეგმილი დრო" value={formatDateTime(call.scheduled_at)} />
              <Field label="SLA ვადა" value={formatDateTime(call.sla_due_at)} />
              <Field label="რეაგირება" value={formatDateTime(call.responded_at)} />
              <Field label="დასრულება" value={formatDateTime(call.completed_at)} />
              <div className="col-span-2">
                <Field label="აღწერა" value={call.description} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">სტატუსის ისტორია</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-md bg-muted p-1.5">
                      <Clock className="size-3.5 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{statusLabel[h.status]}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(h.changed_at)}
                      </div>
                    </div>
                  </li>
                ))}
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">ისტორია ცარიელია</p>
                ) : null}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">კომენტარები</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {notes.map((n) => (
                <div key={n.id} className="rounded-md border p-2.5">
                  <div className="text-sm">{n.body}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {n.author_name ? `${n.author_name} · ` : ""}
                    {formatDateTime(n.created_at)}
                  </div>
                </div>
              ))}
              {notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">კომენტარები არ არის</p>
              ) : null}
              {canEdit ? (
                <div className="flex gap-2">
                  <Textarea
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="დაამატეთ კომენტარი…"
                  />
                  <Button
                    onClick={() => addNote.mutate()}
                    disabled={addNote.isPending || !note.trim()}
                  >
                    დამატება
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">სტატუსის მართვა</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">
                მიმდინარე: <StatusBadge value={call.status} />
              </div>
              {canEdit && !closed ? (
                <>
                  {nextStatus ? (
                    <Button
                      className="w-full"
                      onClick={() => setStatus.mutate(nextStatus)}
                      disabled={setStatus.isPending}
                    >
                      შემდეგი: {statusLabel[nextStatus]}
                    </Button>
                  ) : null}
                  <div className="grid gap-1.5">
                    <Label className="text-xs">სტატუსის პირდაპირ შეცვლა</Label>
                    <Select
                      value={call.status}
                      onValueChange={(v) => setStatus.mutate(v as CallStatus)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_FLOW.map((s) => (
                          <SelectItem key={s} value={s}>
                            {statusLabel[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setStatus.mutate("gaukmebuli")}
                    disabled={setStatus.isPending}
                  >
                    გაუქმება
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {closed ? "გამოძახება დახურულია." : "სტატუსის შეცვლის უფლება არ გაქვთ."}
                </p>
              )}
            </CardContent>
          </Card>

          {isDispatcher ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">ტექნიკოსზე მიბმა და გრაფიკი</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">ტექნიკოსი</Label>
                  <Select value={assignee || call.assigned_to || ""} onValueChange={setAssignee}>
                    <SelectTrigger>
                      <SelectValue placeholder="აირჩიეთ ტექნიკოსი" />
                    </SelectTrigger>
                    <SelectContent>
                      {technicians.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">ჯგუფი</Label>
                  <Select value={team || callExtra.assigned_team_id || ""} onValueChange={setTeam}>
                    <SelectTrigger>
                      <SelectValue placeholder="აირჩიეთ ჯგუფი" />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">დაგეგმილი დრო</Label>
                  <Input
                    type="datetime-local"
                    value={scheduled || toInputValue(call.scheduled_at)}
                    onChange={(e) => setScheduled(e.target.value)}
                  />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  მიმდინარე: {nameOf(call.assigned_to)}
                </div>
                <Button
                  className="w-full"
                  onClick={() => saveAssignment.mutate()}
                  disabled={saveAssignment.isPending}
                >
                  შენახვა
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
      {isDispatcher ? (
        <EditCallDialog call={call} open={editOpen} onOpenChange={setEditOpen} />
      ) : null}
    </AppShell>
  );
}
