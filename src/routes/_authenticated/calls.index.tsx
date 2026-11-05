import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNotifyStatus } from "@/hooks/useNotifyStatus";
import { useCurrentUser } from "@/hooks/useAuth";
import { clientsQuery, dbx, teamsQuery } from "@/lib/entities";
import {
  formatDateTime,
  isOpen,
  PRIORITIES,
  SERVICE_TYPES,
  serviceTypeLabel,
  slaState,
  STATUSES,
  type CallPriority,
  type CallStatus,
  type ServiceCall,
  type ServiceType,
} from "@/lib/domain";
import { callsQuery, objectsQuery, staffQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/calls/")({
  head: () => ({
    meta: [
      { title: "გამოძახებები — ლიფტსერვისი" },
      {
        name: "description",
        content: "სერვისის გამოძახებების მიღება, ფილტრი და მართვა.",
      },
    ],
  }),
  component: CallsPage,
});

type NewCall = {
  object_id: string;
  client_id: string;
  assigned_team_id: string;
  site_name: string;
  address: string;
  elevator_code: string;
  serial_number: string;
  service_type: ServiceType;
  priority: CallPriority;
  description: string;
  client_name: string;
  client_phone: string;
};

const emptyCall: NewCall = {
  object_id: "",
  client_id: "",
  assigned_team_id: "",
  site_name: "",
  address: "",
  elevator_code: "",
  serial_number: "",
  service_type: "avaria",
  priority: "sashualo",
  description: "",
  client_name: "",
  client_phone: "",
};

function CallsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDispatcher, isTechnician, userId } = useCurrentUser();

  const { data: calls = [] } = useQuery(callsQuery);
  const { data: objects = [] } = useQuery(objectsQuery);
  const { data: staff = [] } = useQuery(staffQuery);
  const { data: clients = [] } = useQuery(clientsQuery);
  const { data: teams = [] } = useQuery(teamsQuery);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CallStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<CallPriority | "all">("all");
  const [typeFilter, setTypeFilter] = useState<ServiceType | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<NewCall>(emptyCall);

  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? "—";

  const visible = isTechnician ? calls.filter((c) => c.assigned_to === userId) : calls;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visible.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (priorityFilter !== "all" && c.priority !== priorityFilter) return false;
      if (typeFilter !== "all" && c.service_type !== typeFilter) return false;
      if (q) {
        const hay =
          `${c.call_no} ${c.site_name} ${c.address} ${c.elevator_code ?? ""} ${c.client_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [visible, search, statusFilter, priorityFilter, typeFilter]);

  const notifyStatus = useNotifyStatus();
  const createCall = useMutation({
    mutationFn: async (values: NewCall) => {
      if (!values.site_name.trim() || !values.address.trim()) {
        throw new Error("ობიექტი და მისამართი სავალდებულოა");
      }
      const payload = {
        object_id: values.object_id || null,
        client_id: values.client_id || null,
        assigned_team_id: values.assigned_team_id || null,
        site_name: values.site_name.trim(),
        address: values.address.trim(),
        elevator_code: values.elevator_code || null,
        serial_number: values.serial_number || null,
        service_type: values.service_type,
        priority: values.priority,
        description: values.description || null,
        client_name: values.client_name || null,
        client_phone: values.client_phone || null,
        source: "manual",
        created_by: userId ?? null,
      };
      const { data: created, error } = await dbx
        .from("service_calls")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      if (created?.id) notifyStatus(created.id as string);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service_calls"] });
      setDialogOpen(false);
      setForm(emptyCall);
      toast.success("გამოძახება დარეგისტრირდა");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function pickObject(id: string) {
    const o = objects.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      object_id: id,
      site_name: o?.name ?? f.site_name,
      address: o?.address ?? f.address,
      elevator_code: o?.elevator_code ?? f.elevator_code,
      serial_number: o?.serial_number ?? f.serial_number,
      client_name: o?.client_name ?? f.client_name,
      client_phone: o?.client_phone ?? f.client_phone,
    }));
  }

  function pickClient(id: string) {
    const c = clients.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      client_id: id,
      client_name: c?.name ?? f.client_name,
      client_phone: c?.cabin_phone ?? f.client_phone,
      address: c?.address ?? f.address,
    }));
  }

  const chamokideba = form.service_type === "chamokideba";

  return (
    <AppShell
      title="გამოძახებები"
      subtitle={`სულ: ${filtered.length}`}
      actions={
        isDispatcher ? (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" /> ახალი გამოძახება
          </Button>
        ) : null
      }
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ძებნა (ობიექტი, მისამართი, ლიფტი)"
            className="pl-8"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as CallStatus | "all")}
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="სტატუსი" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ყველა სტატუსი</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={priorityFilter}
          onValueChange={(v) => setPriorityFilter(v as CallPriority | "all")}
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="პრიორიტეტი" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ყველა პრიორიტეტი</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as ServiceType | "all")}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="ტიპი" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ყველა ტიპი</SelectItem>
            {SERVICE_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead>ობიექტი</TableHead>
              <TableHead className="hidden md:table-cell">ტიპი</TableHead>
              <TableHead>პრიორიტეტი</TableHead>
              <TableHead>სტატუსი</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead className="hidden lg:table-cell">ტექნიკოსი</TableHead>
              <TableHead className="hidden lg:table-cell">მიღების დრო</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c: ServiceCall) => (
              <TableRow
                key={c.id}
                className={
                  "cursor-pointer " +
                  (slaState(c) === "breached" && isOpen(c.status) ? "bg-destructive/5" : "")
                }
                onClick={() =>
                  navigate({
                    to: "/calls/$callId",
                    params: { callId: c.id },
                  })
                }
              >
                <TableCell className="font-mono text-xs">{c.call_no}</TableCell>
                <TableCell className="max-w-[220px]">
                  <div className="truncate text-sm font-medium">{c.site_name}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.address}</div>
                </TableCell>
                <TableCell className="hidden text-xs md:table-cell">
                  {serviceTypeLabel[c.service_type]}
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
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  გამოძახებები არ მოიძებნა
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ახალი გამოძახება</DialogTitle>
            <DialogDescription>
              შეავსეთ გამოძახების დეტალები. „ჩამოკიდება“ ავტომატურად ხდება კრიტიკული.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>ობიექტი (სიიდან)</Label>
              <Select value={form.object_id} onValueChange={pickObject}>
                <SelectTrigger>
                  <SelectValue placeholder="აირჩიეთ ობიექტი (ან შეავსეთ ხელით)" />
                </SelectTrigger>
                <SelectContent>
                  {objects.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>კლიენტი (სიიდან)</Label>
              <Select value={form.client_id} onValueChange={pickClient}>
                <SelectTrigger>
                  <SelectValue placeholder="აირჩიეთ კლიენტი" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>ობიექტის დასახელება *</Label>
              <Input
                value={form.site_name}
                onChange={(e) => setForm((f) => ({ ...f, site_name: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>მისამართი *</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>ლიფტის კოდი</Label>
                <Input
                  value={form.elevator_code}
                  onChange={(e) => setForm((f) => ({ ...f, elevator_code: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>ქარხნული ნომერი</Label>
                <Input
                  value={form.serial_number}
                  onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>მომსახურების ტიპი</Label>
                <Select
                  value={form.service_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, service_type: v as ServiceType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>პრიორიტეტი</Label>
                <Select
                  value={chamokideba ? "kritikuli" : form.priority}
                  disabled={chamokideba}
                  onValueChange={(v) => setForm((f) => ({ ...f, priority: v as CallPriority }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>ჯგუფის მიბმა (არასავალდებულო)</Label>
              <Select
                value={form.assigned_team_id}
                onValueChange={(v) => setForm((f) => ({ ...f, assigned_team_id: v }))}
              >
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
              <Label>აღწერა</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>დამკვეთი</Label>
                <Input
                  value={form.client_name}
                  onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>საკონტაქტო</Label>
                <Input
                  value={form.client_phone}
                  onChange={(e) => setForm((f) => ({ ...f, client_phone: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              გაუქმება
            </Button>
            <Button onClick={() => createCall.mutate(form)} disabled={createCall.isPending}>
              {createCall.isPending ? "ინახება…" : "რეგისტრაცია"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
