import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { formatDate } from "@/lib/domain";
import { objectsQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/objects")({
  head: () => ({
    meta: [
      { title: "ობიექტები — ლიფტსერვისი" },
      {
        name: "description",
        content: "ლიფტების რეესტრი და პრევენციული მოვლის გრაფიკი.",
      },
    ],
  }),
  component: ObjectsPage,
});

type Filter = "all" | "overdue" | "soon";

const emptyObject = {
  name: "",
  address: "",
  elevator_code: "",
  serial_number: "",
  manufacturer: "",
  client_name: "",
  client_phone: "",
  maintenance_interval_months: "1",
  next_due_date: "",
};

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function ObjectsPage() {
  const queryClient = useQueryClient();
  const { isDispatcher } = useCurrentUser();
  const { data: objects = [] } = useQuery(objectsQuery);

  const [filter, setFilter] = useState<Filter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyObject });

  const today = new Date();
  const soonLimit = new Date();
  soonLimit.setDate(soonLimit.getDate() + 7);

  const rows = useMemo(() => {
    return objects.filter((o) => {
      if (filter === "all") return true;
      if (!o.next_due_date) return false;
      const due = new Date(o.next_due_date);
      if (filter === "overdue") return due < today;
      return due >= today && due <= soonLimit;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, filter]);

  const overdueCount = objects.filter(
    (o) => o.next_due_date && new Date(o.next_due_date) < today,
  ).length;

  const createObject = useMutation({
    mutationFn: async () => {
      if (!form.name.trim() || !form.address.trim() || !form.elevator_code.trim()) {
        throw new Error("დასახელება, მისამართი და ლიფტის კოდი სავალდებულოა");
      }
      const payload: TablesInsert<"objects"> = {
        name: form.name.trim(),
        address: form.address.trim(),
        elevator_code: form.elevator_code.trim(),
        serial_number: form.serial_number || null,
        manufacturer: form.manufacturer || null,
        client_name: form.client_name || null,
        client_phone: form.client_phone || null,
        maintenance_interval_months:
          Number(form.maintenance_interval_months) || 1,
        next_due_date: form.next_due_date || null,
      };
      const { error } = await supabase.from("objects").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["objects"] });
      setDialogOpen(false);
      setForm({ ...emptyObject });
      toast.success("ობიექტი დაემატა");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markDone = useMutation({
    mutationFn: async (params: { id: string; interval: number }) => {
      const now = new Date();
      const next = addMonths(now, params.interval || 1);
      const { error } = await supabase
        .from("objects")
        .update({
          last_maintenance_date: now.toISOString().slice(0, 10),
          next_due_date: next.toISOString().slice(0, 10),
        })
        .eq("id", params.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["objects"] });
      toast.success("პრევენცია ჩაიწერა");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell
      title="ობიექტები და პრევენცია"
      subtitle={`სულ: ${objects.length} · ვადაგადაცილებული: ${overdueCount}`}
      actions={
        isDispatcher ? (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" /> ობიექტის დამატება
          </Button>
        ) : null
      }
    >
      <div className="mb-3">
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ყველა ობიექტი</SelectItem>
            <SelectItem value="overdue">ვადაგადაცილებული</SelectItem>
            <SelectItem value="soon">მალე მოსახდენი (7 დღე)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ობიექტი</TableHead>
              <TableHead className="hidden md:table-cell">ლიფტი</TableHead>
              <TableHead className="hidden lg:table-cell">დანადგარი / შენიშვნა</TableHead>
              <TableHead>ინტერვალი</TableHead>
              <TableHead className="hidden sm:table-cell">ბოლო მოვლა</TableHead>
              <TableHead>შემდეგი</TableHead>
              {isDispatcher ? <TableHead className="w-24"></TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((o) => {
              const overdue =
                o.next_due_date && new Date(o.next_due_date) < today;
              return (
                <TableRow
                  key={o.id}
                  className={overdue ? "bg-destructive/5" : undefined}
                >
                  <TableCell className="max-w-[240px]">
                    <div className="truncate text-sm font-medium">{o.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {o.address}
                    </div>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">
                    {o.elevator_code}
                  </TableCell>
                  <TableCell className="hidden max-w-[260px] truncate text-xs lg:table-cell">
                    {o.notes ?? o.manufacturer ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {o.maintenance_interval_months} თვე
                  </TableCell>
                  <TableCell className="hidden text-xs sm:table-cell">
                    {formatDate(o.last_maintenance_date)}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span
                      className={
                        overdue ? "font-medium text-destructive" : undefined
                      }
                    >
                      {formatDate(o.next_due_date)}
                    </span>
                  </TableCell>
                  {isDispatcher ? (
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          markDone.mutate({
                            id: o.id,
                            interval: o.maintenance_interval_months,
                          })
                        }
                        disabled={markDone.isPending}
                      >
                        შესრულდა
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isDispatcher ? 7 : 6}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  ობიექტები არ მოიძებნა
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ობიექტის დამატება</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>დასახელება *</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label>მისამართი *</Label>
              <Input
                value={form.address}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>ლიფტის კოდი *</Label>
                <Input
                  value={form.elevator_code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, elevator_code: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>ქარხნული ნომერი</Label>
                <Input
                  value={form.serial_number}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, serial_number: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>მწარმოებელი</Label>
                <Input
                  value={form.manufacturer}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, manufacturer: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>ინტერვალი (თვე)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.maintenance_interval_months}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      maintenance_interval_months: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>დამკვეთი</Label>
                <Input
                  value={form.client_name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, client_name: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>საკონტაქტო</Label>
                <Input
                  value={form.client_phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, client_phone: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>შემდეგი პრევენციის თარიღი</Label>
              <Input
                type="date"
                value={form.next_due_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, next_due_date: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              გაუქმება
            </Button>
            <Button
              onClick={() => createObject.mutate()}
              disabled={createObject.isPending}
            >
              {createObject.isPending ? "ინახება…" : "დამატება"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
