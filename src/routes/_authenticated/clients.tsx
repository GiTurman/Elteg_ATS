import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/useAuth";
import { clientsQuery, dbx, tariffsQuery, type Client } from "@/lib/entities";
import { CALLS_MODES, callsModeShort, type CallsMode } from "@/lib/packageUsage";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({
    meta: [
      { title: "კლიენტები — ლიფტსერვისი" },
      { name: "description", content: "კლიენტების ბაზა და საკონტაქტო მონაცემები." },
    ],
  }),
  component: ClientsPage,
});

const empty = {
  name: "",
  tax_id: "",
  cabin_phone: "",
  contact_phone_2: "",
  contact_person: "",
  email: "",
  address: "",
  package_id: "",
  monthly_fee: "",
  currency: "GEL",
  calls_mode: "" as CallsMode | "",
  included_calls: "",
};

function ClientsPage() {
  const queryClient = useQueryClient();
  const { isDispatcher } = useCurrentUser();
  const { data: clients = [] } = useQuery(clientsQuery);
  const { data: packages = [] } = useQuery(tariffsQuery);

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [editingId, setEditingId] = useState<string | null>(null);

  const openNew = () => {
    setEditingId(null);
    setForm({ ...empty });
    setOpen(true);
  };
  const openEdit = (c: Client) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      tax_id: c.tax_id ?? "",
      cabin_phone: c.cabin_phone ?? "",
      contact_phone_2: c.contact_phone_2 ?? "",
      contact_person: c.contact_person ?? "",
      email: c.email ?? "",
      address: c.address ?? "",
      package_id: c.package_id ?? "",
      monthly_fee: c.monthly_fee != null ? String(c.monthly_fee) : "",
      currency: c.currency ?? "GEL",
      calls_mode: c.calls_mode ?? (c.included_calls != null ? "limited" : ""),
      included_calls: c.included_calls != null ? String(c.included_calls) : "",
    });
    setOpen(true);
  };

  const pkgName = (id: string | null) =>
    packages.find((p) => p.id === id)?.name ?? "—";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      `${c.name} ${c.cabin_phone ?? ""} ${c.contact_phone_2 ?? ""} ${c.contact_person ?? ""} ${c.tax_id ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [clients, search]);

  const create = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("დასახელება სავალდებულოა");
      const limit = form.included_calls.trim() ? Number(form.included_calls) : null;
      if (form.calls_mode === "limited" && (limit == null || !Number.isInteger(limit) || limit < 0))
        throw new Error("მიუთითეთ თვეში გამოძახებების რაოდენობა");
      const payload = {
        name: form.name.trim(),
        tax_id: form.tax_id || null,
        cabin_phone: form.cabin_phone || null,
        contact_phone_2: form.contact_phone_2 || null,
        contact_person: form.contact_person || null,
        email: form.email || null,
        address: form.address || null,
        package_id: form.package_id || null,
        monthly_fee: form.monthly_fee ? Number(form.monthly_fee) : null,
        currency: form.currency || null,
        calls_mode: form.calls_mode || null,
        included_calls: form.calls_mode === "limited" ? limit : null,
      };
      const write = (p: Record<string, unknown>) =>
        editingId
          ? dbx.from("clients").update(p).eq("id", editingId)
          : dbx.from("clients").insert(p);
      let { error } = await write(payload);
      // ბაზის 0008 განახლებამდე calls_mode სვეტი ჯერ არ არსებობს
      if (error && /calls_mode/.test(error.message)) {
        const { calls_mode: _omit, ...rest } = payload;
        void _omit;
        ({ error } = await write({
          ...rest,
          included_calls: form.included_calls.trim() ? Number(form.included_calls) : null,
        }));
      }
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setOpen(false);
      toast.success(editingId ? "კლიენტი განახლდა" : "კლიენტი დაემატა");
      setForm({ ...empty });
      setEditingId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell
      title="კლიენტები"
      subtitle={`სულ: ${clients.length}`}
      actions={
        isDispatcher ? (
          <Button size="sm" onClick={openNew}>
            <Plus className="size-4" /> კლიენტის დამატება
          </Button>
        ) : null
      }
    >
      <div className="relative mb-3 sm:max-w-xs">
        <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ძებნა (სახელი, ტელეფონი)"
          className="pl-8"
        />
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>დასახელება</TableHead>
              <TableHead>ნომერი 1 (კაბინა)</TableHead>
              <TableHead className="hidden xl:table-cell">ნომერი 2</TableHead>
              <TableHead className="hidden lg:table-cell">პაკეტი</TableHead>
              <TableHead>ფასი</TableHead>
              <TableHead className="hidden md:table-cell">დანადგარი</TableHead>
              <TableHead className="hidden lg:table-cell">გამოძახება/თვე</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow
                key={c.id}
                className={isDispatcher ? "cursor-pointer" : undefined}
                onClick={isDispatcher ? () => openEdit(c) : undefined}
              >
                <TableCell className="max-w-[220px]">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.address ?? ""}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {c.cabin_phone ?? "—"}
                </TableCell>
                <TableCell className="hidden font-mono text-xs xl:table-cell">
                  {c.contact_phone_2 ?? "—"}
                </TableCell>
                <TableCell className="hidden text-xs lg:table-cell">
                  {pkgName(c.package_id)}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap tabular-nums">
                  {c.monthly_fee != null
                    ? `${c.monthly_fee} ${c.currency ?? ""}`.trim()
                    : "—"}
                </TableCell>
                <TableCell className="hidden text-xs md:table-cell">
                  {c.device_count ?? "—"}
                </TableCell>
                <TableCell className="hidden text-xs lg:table-cell">
                  {c.calls_mode === "limited" || (!c.calls_mode && c.included_calls != null)
                    ? `${c.included_calls ?? 0}`
                    : c.calls_mode
                      ? callsModeShort[c.calls_mode]
                      : "—"}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  კლიენტები არ მოიძებნა
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "კლიენტის რედაქტირება" : "ახალი კლიენტი"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>დასახელება *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>ნომერი 1 (კაბინა)</Label>
                <Input
                  value={form.cabin_phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cabin_phone: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>ნომერი 2 (დამატებითი)</Label>
                <Input
                  value={form.contact_phone_2}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, contact_phone_2: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>საკონტაქტო პირი</Label>
                <Input
                  value={form.contact_person}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, contact_person: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>ს/კ ან ID</Label>
                <Input
                  value={form.tax_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, tax_id: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>ელფოსტა</Label>
                <Input
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>პაკეტი</Label>
                <Select
                  value={form.package_id}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, package_id: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="აირჩიეთ" />
                  </SelectTrigger>
                  <SelectContent>
                    {packages.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>ყოველთვიური ფასი</Label>
                <Input
                  type="number"
                  value={form.monthly_fee}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, monthly_fee: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>ვალუტა</Label>
                <Select
                  value={form.currency}
                  onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GEL">GEL (₾)</SelectItem>
                    <SelectItem value="USD">USD ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>გამოძახებები პაკეტით</Label>
                <Select
                  value={form.calls_mode || "none"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, calls_mode: v === "none" ? "" : (v as CallsMode) }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">არ არის მითითებული</SelectItem>
                    {CALLS_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.calls_mode === "limited" ? (
                <div className="grid gap-1.5">
                  <Label>გამოძახება თვეში *</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.included_calls}
                    onChange={(e) => setForm((f) => ({ ...f, included_calls: e.target.value }))}
                  />
                </div>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label>მისამართი</Label>
              <Input
                value={form.address}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              გაუქმება
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "ინახება…" : editingId ? "შენახვა" : "დამატება"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
