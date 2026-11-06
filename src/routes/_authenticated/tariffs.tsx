// ტარიფები — მომსახურების პაკეტები, ფასთა სიები, პირობები (რედაქტირება: მენეჯერი/ადმინი).
// ავტორი: Giorgi Turmanidze "GT"
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Pencil, Plus, X } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/hooks/useAuth";
import { clientsQuery, dbx, formatPrice, tariffsQuery, type TariffPackage } from "@/lib/entities";
import { CALLS_MODES, callsModeShort, type CallsMode } from "@/lib/packageUsage";

export const Route = createFileRoute("/_authenticated/tariffs")({
  head: () => ({
    meta: [
      { title: "ტარიფები — ლიფტსერვისი" },
      { name: "description", content: "მომსახურების პაკეტები და ფასები." },
    ],
  }),
  component: TariffsPage,
});

const empty = {
  name: "",
  code: "",
  price_list: "",
  price_monthly: "0",
  currency: "USD",
  calls_mode: "" as CallsMode | "",
  included_calls: "",
  planned_visits: "1",
  after_hours_service: false,
  response_minutes_work: "",
  response_minutes_after: "",
  entrapment_response: "24/7, 30–40 წუთი",
  included_services: "",
  description: "",
  is_active: true,
};

const num = (v: string) => (v.trim() === "" ? null : Number(v));

function callsText(p: TariffPackage) {
  if (p.calls_mode === "limited") return `${p.included_calls ?? 0} თვეში`;
  return p.calls_mode ? callsModeShort[p.calls_mode] : "—";
}

function TariffsPage() {
  const queryClient = useQueryClient();
  const { isManager } = useCurrentUser();
  const { data: packages = [] } = useQuery(tariffsQuery);
  const { data: clients = [] } = useQuery(clientsQuery);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...empty });

  const clientCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clients) if (c.package_id) m.set(c.package_id, (m.get(c.package_id) ?? 0) + 1);
    return m;
  }, [clients]);

  // ფასთა სიები (სტანდარტული შეთავაზებები) და ინდივიდუალური პაკეტები
  const groups = useMemo(() => {
    const lists = new Map<string, TariffPackage[]>();
    const other: TariffPackage[] = [];
    for (const p of packages) {
      if (!p.is_active && !isManager) continue;
      if (p.price_list) lists.set(p.price_list, [...(lists.get(p.price_list) ?? []), p]);
      else other.push(p);
    }
    return { lists: [...lists.entries()], other };
  }, [packages, isManager]);

  const openNew = () => {
    setEditingId(null);
    setForm({ ...empty });
    setOpen(true);
  };
  const openEdit = (p: TariffPackage) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      code: p.code ?? "",
      price_list: p.price_list ?? "",
      price_monthly: String(p.price_monthly ?? 0),
      currency: p.currency ?? "GEL",
      calls_mode: p.calls_mode ?? "",
      included_calls: p.included_calls != null ? String(p.included_calls) : "",
      planned_visits: p.planned_visits != null ? String(p.planned_visits) : "",
      after_hours_service: !!p.after_hours_service,
      response_minutes_work: p.response_minutes_work != null ? String(p.response_minutes_work) : "",
      response_minutes_after:
        p.response_minutes_after != null ? String(p.response_minutes_after) : "",
      entrapment_response: p.entrapment_response ?? "",
      included_services: p.included_services ?? "",
      description: p.description ?? "",
      is_active: p.is_active,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("პაკეტის სახელი სავალდებულოა");
      if (form.calls_mode === "limited" && num(form.included_calls) == null)
        throw new Error("მიუთითეთ გამოძახებების რაოდენობა თვეში");
      const work = num(form.response_minutes_work);
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        price_list: form.price_list.trim() || null,
        price_monthly: Number(form.price_monthly) || 0,
        currency: form.currency,
        calls_mode: form.calls_mode || null,
        included_calls: form.calls_mode === "limited" ? num(form.included_calls) : null,
        planned_visits: num(form.planned_visits),
        after_hours_service: form.after_hours_service,
        response_minutes_work: work,
        response_minutes_after: num(form.response_minutes_after),
        // ძველი ველი (SLA საათებში) — თავსებადობისთვის
        response_sla_hours: work != null ? Math.max(1, Math.ceil(work / 60)) : null,
        entrapment_response: form.entrapment_response.trim() || null,
        included_services: form.included_services.trim() || null,
        description: form.description.trim() || null,
        is_active: form.is_active,
      };
      const { error } = editingId
        ? await dbx.from("tariff_packages").update(payload).eq("id", editingId)
        : await dbx.from("tariff_packages").insert({ ...payload, sort_order: packages.length + 1 });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariff_packages"] });
      setOpen(false);
      toast.success(editingId ? "პაკეტი განახლდა" : "პაკეტი დაემატა");
      setEditingId(null);
      setForm({ ...empty });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows: { label: string; render: (p: TariffPackage) => React.ReactNode }[] = [
    {
      label: "ფასი / თვე (დღგ-ს ჩათვლით, 1 ლიფტი)",
      render: (p) => (
        <span className="font-semibold tabular-nums">
          {formatPrice(p.price_monthly, p.currency)}
        </span>
      ),
    },
    {
      label: "გეგმური სერვისი",
      render: (p) =>
        `${p.planned_visits ?? 1}-ჯერ თვეში · ${p.after_hours_service ? "სამუშაო და არასამუშაო დრო" : "სამუშაო დღე"}`,
    },
    {
      label: "ავარიული გამოძახება",
      render: (p) => (p.after_hours_service ? "სამუშაო დღე; არასამუშაო დრო" : "სამუშაო დღე"),
    },
    {
      label: "რეაგირება გაუმართაობისას — სამუშაო დღე",
      render: (p) => (p.response_minutes_work != null ? `${p.response_minutes_work} წუთი` : "—"),
    },
    {
      label: "რეაგირება გაუმართაობისას — არასამუშაო დრო",
      render: (p) =>
        p.response_minutes_after != null ? (
          `${p.response_minutes_after} წუთი`
        ) : (
          <span className="text-red-700">არ შედის</span>
        ),
    },
    { label: "ადამიანის გაჭედვა", render: (p) => p.entrapment_response ?? "—" },
    { label: "გამოძახებები თვეში", render: (p) => <b>{callsText(p)}</b> },
    { label: "კლიენტები ამ პაკეტით", render: (p) => clientCount.get(p.id) ?? 0 },
  ];

  return (
    <AppShell
      title="ტარიფები"
      subtitle="მომსახურების პაკეტები · ფასები დღგ-ს ჩათვლით, ერთ სამგზავრო ლიფტზე"
      actions={
        isManager ? (
          <Button size="sm" onClick={openNew}>
            <Plus className="size-4" /> პაკეტის დამატება
          </Button>
        ) : null
      }
    >
      <div className="space-y-6">
        {groups.lists.map(([list, pkgs]) => (
          <section key={list}>
            <h2 className="mb-2 text-sm font-semibold">{list}</h2>
            <div className="overflow-x-auto rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[220px]">პირობა</TableHead>
                    {pkgs.map((p) => (
                      <TableHead key={p.id} className="min-w-[150px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className={p.is_active ? "" : "line-through"}>{p.name}</span>
                          {isManager ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              onClick={() => openEdit(p)}
                              aria-label="რედაქტირება"
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.label}>
                      <TableCell className="text-xs text-muted-foreground">{r.label}</TableCell>
                      {pkgs.map((p) => (
                        <TableCell key={p.id} className="text-sm">
                          {r.render(p)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="text-xs text-muted-foreground">
                      გეგმური სერვისის შემოწმების აქტი · მალცვეთადი ნაწილების შეცვლა
                    </TableCell>
                    {pkgs.map((p) => (
                      <TableCell key={p.id}>
                        <Check className="size-4 text-emerald-600" />
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>
        ))}

        {groups.other.length ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold">ინდივიდუალური ხელშეკრულებები</h2>
            <div className="overflow-x-auto rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>პაკეტი</TableHead>
                    <TableHead>ფასი</TableHead>
                    <TableHead>გამოძახებები</TableHead>
                    <TableHead>რას მოიცავს</TableHead>
                    <TableHead className="text-right">კლიენტი</TableHead>
                    {isManager ? <TableHead className="w-10" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.other.map((p) => (
                    <TableRow key={p.id} className={p.is_active ? "" : "opacity-50"}>
                      <TableCell className="text-sm font-medium">
                        {p.name}
                        {!p.is_active ? (
                          <span className="ml-1 inline-flex items-center text-xs text-muted-foreground">
                            <X className="size-3" /> გამორთულია
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm">ხელშეკრულებით</TableCell>
                      <TableCell className="text-sm">{callsText(p)}</TableCell>
                      <TableCell className="max-w-md text-xs text-muted-foreground">
                        {p.included_services ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {clientCount.get(p.id) ?? 0}
                      </TableCell>
                      {isManager ? (
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            onClick={() => openEdit(p)}
                            aria-label="რედაქტირება"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              ინდივიდუალური ხელშეკრულების ფასი და გამოძახებების რაოდენობა მიეთითება თავად კლიენტზე
              („კლიენტები“ → კლიენტზე დაჭერა).
            </p>
          </section>
        ) : null}

        <div className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <b>სამუშაო დღე</b> — ორშაბათი–პარასკევი 10:00–19:00 (გარდა უქმე დღეებისა).{" "}
          <b>არასამუშაო დრო:</b> ორშ–პარ 19:00–22:00; შაბათ–კვირა 10:00–22:00; სადღესასწაულო დღეები
          10:00–18:00 (აღდგომის გარდა).
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "პაკეტის რედაქტირება" : "ახალი პაკეტი"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>სახელი *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="მაგ. სტანდარტი (100$)"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>ფასთა სია</Label>
                <Input
                  value={form.price_list}
                  onChange={(e) => setForm((f) => ({ ...f, price_list: e.target.value }))}
                  placeholder="მაგ. ფასთა სია 1 (ცარიელი = ინდივიდუალური)"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 grid gap-1.5">
                <Label>ფასი / თვე (დღგ-ს ჩათვლით)</Label>
                <Input
                  type="number"
                  value={form.price_monthly}
                  onChange={(e) => setForm((f) => ({ ...f, price_monthly: e.target.value }))}
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
                    <SelectItem value="USD">USD ($)</SelectItem>
                    <SelectItem value="GEL">GEL (₾)</SelectItem>
                    <SelectItem value="EUR">EUR (€)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>გამოძახებები</Label>
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
              <div className="grid gap-1.5">
                <Label>გამოძახება თვეში</Label>
                <Input
                  type="number"
                  min={0}
                  disabled={form.calls_mode !== "limited"}
                  value={form.included_calls}
                  onChange={(e) => setForm((f) => ({ ...f, included_calls: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label>რეაგირება, სამ. დღე (წთ)</Label>
                <Input
                  type="number"
                  value={form.response_minutes_work}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, response_minutes_work: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>არასამ. დრო (წთ)</Label>
                <Input
                  type="number"
                  placeholder="ცარიელი = არ შედის"
                  value={form.response_minutes_after}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, response_minutes_after: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>გეგმური / თვე</Label>
                <Input
                  type="number"
                  value={form.planned_visits}
                  onChange={(e) => setForm((f) => ({ ...f, planned_visits: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>ადამიანის გაჭედვა — რეაგირება</Label>
              <Input
                value={form.entrapment_response}
                onChange={(e) => setForm((f) => ({ ...f, entrapment_response: e.target.value }))}
              />
            </div>
            <label className="flex items-center justify-between rounded-md border p-2.5 text-sm">
              გეგმური სერვისი და ავარიული გამოძახება არასამუშაო დროსაც
              <Switch
                checked={form.after_hours_service}
                onCheckedChange={(v) => setForm((f) => ({ ...f, after_hours_service: v }))}
              />
            </label>
            <div className="grid gap-1.5">
              <Label>რას მოიცავს (SMS-შიც ეგზავნება)</Label>
              <Textarea
                rows={3}
                value={form.included_services}
                onChange={(e) => setForm((f) => ({ ...f, included_services: e.target.value }))}
              />
            </div>
            <label className="flex items-center justify-between rounded-md border p-2.5 text-sm">
              აქტიური (ჩანს კლიენტის არჩევისას)
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              გაუქმება
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "ინახება…" : editingId ? "შენახვა" : "დამატება"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
