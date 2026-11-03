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
import { clientsQuery, dbx, tariffsQuery } from "@/lib/entities";

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
};

function ClientsPage() {
  const queryClient = useQueryClient();
  const { isDispatcher } = useCurrentUser();
  const { data: clients = [] } = useQuery(clientsQuery);
  const { data: packages = [] } = useQuery(tariffsQuery);

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...empty });

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
      const { error } = await dbx.from("clients").insert({
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
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setOpen(false);
      setForm({ ...empty });
      toast.success("კლიენტი დაემატა");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell
      title="კლიენტები"
      subtitle={`სულ: ${clients.length}`}
      actions={
        isDispatcher ? (
          <Button size="sm" onClick={() => setOpen(true)}>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.id}>
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
              </TableRow>
            ))}
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
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
            <DialogTitle>ახალი კლიენტი</DialogTitle>
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
              {create.isPending ? "ინახება…" : "დამატება"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
