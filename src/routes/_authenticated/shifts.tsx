import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2, UserCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useCurrentUser } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  computeOnDuty,
  dutyRoleLabel,
  shiftsRangeQuery,
  toDateInput,
  type DutyRole,
  type OperatorShift,
} from "@/lib/callcenter";
import { staffQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/shifts")({
  head: () => ({
    meta: [
      { title: "ცვლები და მორიგეობა — ლიფტსერვისი" },
      { name: "description", content: "ქოლ-ცენტრის ოპერატორების ცვლების გრაფიკი და მორიგეობა." },
    ],
  }),
  component: ShiftsPage,
});

const WEEKDAYS = ["ორშ", "სამ", "ოთხ", "ხუთ", "პარ", "შაბ", "კვი"];

const TEMPLATES = {
  day: { label: "დღის ცვლა 08:00–20:00", start: "08:00", end: "20:00" },
  night: { label: "ღამის ცვლა 20:00–08:00", start: "20:00", end: "08:00" },
  full: { label: "სადღეღამისო 08:00–08:00", start: "08:00", end: "08:00" },
  custom: { label: "სხვა დრო", start: "09:00", end: "18:00" },
} as const;
type TemplateKey = keyof typeof TEMPLATES;

const ROLE_TONE: Record<DutyRole, string> = {
  operator: "border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  supervisor:
    "border-violet-300 bg-violet-50 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  oncall_technician:
    "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // ორშაბათი = 0
  x.setDate(x.getDate() - dow);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("ka-GE", { hour: "2-digit", minute: "2-digit", hour12: false });

function ShiftsPage() {
  const queryClient = useQueryClient();
  const { isDispatcher, userId } = useCurrentUser();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [dialogDay, setDialogDay] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const fromIso = weekStart.toISOString();
  const toIso = addDays(weekStart, 7).toISOString();

  const { data: shifts = [] } = useQuery(shiftsRangeQuery(fromIso, toIso));
  const { data: nowShifts = [] } = useQuery(
    shiftsRangeQuery(new Date(now.getTime() - 1).toISOString(), now.toISOString()),
  );
  const { data: staff = [] } = useQuery(staffQuery);

  useEffect(() => {
    const channel = supabase
      .channel(`operator_shifts_live:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "operator_shifts" }, () => {
        queryClient.invalidateQueries({ queryKey: ["operator_shifts"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const onDuty = computeOnDuty(nowShifts, staff, now);
  const nameOf = (id: string) => {
    const s = staff.find((p) => p.id === id);
    return s?.full_name || s?.email || "—";
  };

  const removeShift = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("operator_shifts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operator_shifts"] });
      toast.success("ცვლა წაიშალა");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyPrevWeek = useMutation({
    mutationFn: async () => {
      const prevFrom = addDays(weekStart, -7).toISOString();
      const { data: prev, error } = await supabase
        .from("operator_shifts")
        .select("*")
        .gte("starts_at", prevFrom)
        .lt("starts_at", fromIso);
      if (error) throw error;
      if (!prev?.length) throw new Error("წინა კვირაში ცვლები არ არის");
      const existing = new Set(
        shifts.map((s) => `${s.profile_id}|${s.duty_role}|${Date.parse(s.starts_at)}`),
      );
      const week = 7 * 24 * 3600 * 1000;
      const rows = prev
        .map((s) => ({
          profile_id: s.profile_id,
          duty_role: s.duty_role,
          starts_at: new Date(Date.parse(s.starts_at) + week).toISOString(),
          ends_at: new Date(Date.parse(s.ends_at) + week).toISOString(),
          notes: s.notes,
          created_by: userId ?? null,
        }))
        .filter((r) => !existing.has(`${r.profile_id}|${r.duty_role}|${Date.parse(r.starts_at)}`));
      if (!rows.length) throw new Error("ეს ცვლები უკვე დამატებულია");
      const { error: insErr } = await supabase.from("operator_shifts").insert(rows);
      if (insErr) throw insErr;
      return rows.length;
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ["operator_shifts"] });
      toast.success(`დაკოპირდა ${n} ცვლა`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // გაფრთხილება: დღე-ღამის საათები ოპერატორის გარეშე
  const gaps = useMemo(() => {
    const out: string[] = [];
    const ops = shifts.filter((s) => s.duty_role === "operator");
    for (let h = 0; h < 7 * 24; h++) {
      const t = weekStart.getTime() + h * 3600_000 + 30 * 60_000;
      const covered = ops.some((s) => Date.parse(s.starts_at) <= t && Date.parse(s.ends_at) > t);
      if (!covered) {
        const d = new Date(t);
        out.push(`${WEEKDAYS[(d.getDay() + 6) % 7]} ${String(d.getHours()).padStart(2, "0")}:00`);
      }
    }
    return out;
  }, [shifts, weekStart]);

  const hoursByPerson = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of shifts) {
      const h = (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 3600_000;
      m.set(s.profile_id, (m.get(s.profile_id) ?? 0) + h);
    }
    return [...m.entries()].map(([id, h]) => ({
      id,
      name: nameOf(id),
      hours: Math.round(h * 10) / 10,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts, staff]);

  const weekLabel = `${days[0]!.toLocaleDateString("ka-GE", { day: "2-digit", month: "2-digit" })} – ${days[6]!.toLocaleDateString("ka-GE", { day: "2-digit", month: "2-digit", year: "numeric" })}`;

  return (
    <AppShell
      title="ცვლები და მორიგეობა"
      subtitle="ამ გრაფიკით განისაზღვრება ზარების გადამისამართების რიგი"
      actions={
        isDispatcher ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => copyPrevWeek.mutate()}
            disabled={copyPrevWeek.isPending}
          >
            <Copy className="size-3.5" /> წინა კვირის კოპირება
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <UserCheck className="size-4 text-emerald-600" /> ახლა მორიგეობს (გადამისამართების
              რიგით)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {onDuty.length ? (
              <ol className="flex flex-wrap gap-2">
                {onDuty.map((p, i) => (
                  <li
                    key={`${p.profile_id}-${p.duty_role}`}
                    className={cn("rounded-md border px-3 py-1.5 text-xs", ROLE_TONE[p.duty_role])}
                  >
                    <span className="font-semibold">
                      {i + 1}. {p.full_name || "—"}
                    </span>
                    <span className="opacity-80"> · {dutyRoleLabel[p.duty_role]}</span>
                    <span className="block font-mono opacity-80">
                      {p.extension ? `შიდა ${p.extension}` : "შიდა ნომერი არ არის"}
                      {p.phone ? ` · ${p.phone}` : ""} · {hhmm(p.shift_ends_at)}-მდე
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm font-medium text-destructive">
                ⚠ ამ მომენტში მორიგე არავინ არის — ზარი ვერ გადამისამართდება!
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label="წინა კვირა"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            მიმდინარე კვირა
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label="შემდეგი კვირა"
          >
            <ChevronRight className="size-4" />
          </Button>
          <span className="text-sm font-medium tabular-nums">{weekLabel}</span>
        </div>

        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d, i) => {
            const key = toDateInput(d);
            const dayShifts = shifts
              .filter((s) => toDateInput(new Date(s.starts_at)) === key)
              .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
            const isToday = key === toDateInput(new Date());
            return (
              <Card key={key} className={cn("min-h-40", isToday && "border-primary")}>
                <CardHeader className="flex-row items-center justify-between space-y-0 p-2 pb-1">
                  <div className="text-xs font-semibold">
                    {WEEKDAYS[i]}{" "}
                    <span className="font-normal text-muted-foreground">
                      {d.toLocaleDateString("ka-GE", { day: "2-digit", month: "2-digit" })}
                    </span>
                  </div>
                  {isDispatcher ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      onClick={() => setDialogDay(key)}
                      aria-label="ცვლის დამატება"
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-1 p-2 pt-0">
                  {dayShifts.map((s) => (
                    <ShiftChip
                      key={s.id}
                      shift={s}
                      name={nameOf(s.profile_id)}
                      canEdit={isDispatcher}
                      onDelete={() => removeShift.mutate(s.id)}
                    />
                  ))}
                  {dayShifts.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">—</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">კვირის საათები თანამშრომლების მიხედვით</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs">
              {hoursByPerson.length ? (
                hoursByPerson.map((r) => (
                  <div key={r.id} className="flex justify-between">
                    <span>{r.name}</span>
                    <span
                      className={cn("tabular-nums font-medium", r.hours > 48 && "text-destructive")}
                    >
                      {r.hours} სთ{r.hours > 48 ? " ⚠ 48 სთ-ზე მეტი" : ""}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">ამ კვირაში ცვლები არ არის.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">დაუფარავი საათები (ოპერატორის გარეშე)</CardTitle>
            </CardHeader>
            <CardContent className="text-xs">
              {gaps.length === 0 ? (
                <p className="font-medium text-emerald-700 dark:text-emerald-400">
                  ✓ კვირა 24/7 სრულად დაფარულია
                </p>
              ) : (
                <>
                  <p className="mb-1 font-medium text-destructive">
                    {gaps.length} საათი დაუფარავია
                  </p>
                  <p className="text-muted-foreground">
                    {gaps.slice(0, 40).join(", ")}
                    {gaps.length > 40 ? " …" : ""}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AddShiftDialog
        day={dialogDay}
        onClose={() => setDialogDay(null)}
        staff={staff}
        userId={userId ?? null}
      />
    </AppShell>
  );
}

function ShiftChip({
  shift,
  name,
  canEdit,
  onDelete,
}: {
  shift: OperatorShift;
  name: string;
  canEdit: boolean;
  onDelete: () => void;
}) {
  const role = shift.duty_role as DutyRole;
  return (
    <div
      className={cn(
        "group relative rounded border px-1.5 py-1 text-[11px] leading-tight",
        ROLE_TONE[role],
      )}
    >
      <div className="font-semibold">{name}</div>
      <div className="tabular-nums opacity-80">
        {hhmm(shift.starts_at)}–{hhmm(shift.ends_at)} · {dutyRoleLabel[role]}
      </div>
      {shift.notes ? <div className="truncate opacity-70">{shift.notes}</div> : null}
      {canEdit ? (
        <button
          type="button"
          onClick={onDelete}
          className="absolute right-1 top-1 hidden rounded p-0.5 hover:bg-black/10 group-hover:block"
          aria-label="წაშლა"
        >
          <Trash2 className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function AddShiftDialog({
  day,
  onClose,
  staff,
  userId,
}: {
  day: string | null;
  onClose: () => void;
  staff: { id: string; full_name: string; email: string | null; roles: string[] }[];
  userId: string | null;
}) {
  const queryClient = useQueryClient();
  const [profileId, setProfileId] = useState("");
  const [role, setRole] = useState<DutyRole>("operator");
  const [tpl, setTpl] = useState<TemplateKey>("day");
  const [start, setStart] = useState<string>(TEMPLATES.day.start);
  const [end, setEnd] = useState<string>(TEMPLATES.day.end);
  const [repeat, setRepeat] = useState("1");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setStart(TEMPLATES[tpl].start);
    setEnd(TEMPLATES[tpl].end);
  }, [tpl]);

  const people = staff.filter((s) =>
    role === "oncall_technician"
      ? s.roles.includes("technician")
      : s.roles.includes("dispatcher") || s.roles.includes("manager"),
  );
  const list = people.length ? people : staff;

  const save = useMutation({
    mutationFn: async () => {
      if (!day) return 0;
      if (!profileId) throw new Error("აირჩიეთ თანამშრომელი");
      const n = Math.min(Math.max(Number(repeat) || 1, 1), 31);
      const rows = [];
      for (let i = 0; i < n; i++) {
        const s = new Date(`${day}T${start}:00`);
        s.setDate(s.getDate() + i);
        const e = new Date(`${day}T${end}:00`);
        e.setDate(e.getDate() + i);
        if (e <= s) e.setDate(e.getDate() + 1); // ღამის ცვლა გადადის მეორე დღეზე
        rows.push({
          profile_id: profileId,
          duty_role: role,
          starts_at: s.toISOString(),
          ends_at: e.toISOString(),
          notes: notes.trim() || null,
          created_by: userId,
        });
      }
      const { error } = await supabase.from("operator_shifts").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ["operator_shifts"] });
      toast.success(`დაემატა ${n} ცვლა`);
      setNotes("");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!day} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ცვლის დამატება · {day}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>მორიგეობის ტიპი</Label>
            <Select
              value={role}
              onValueChange={(v) => {
                setRole(v as DutyRole);
                setProfileId("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(dutyRoleLabel) as DutyRole[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {dutyRoleLabel[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>თანამშრომელი</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger>
                <SelectValue placeholder="აირჩიეთ…" />
              </SelectTrigger>
              <SelectContent>
                {list.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>შაბლონი</Label>
            <Select value={tpl} onValueChange={(v) => setTpl(v as TemplateKey)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TEMPLATES) as TemplateKey[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {TEMPLATES[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>დაწყება</Label>
              <Input
                type="time"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  setTpl("custom");
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>დასრულება</Label>
              <Input
                type="time"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setTpl("custom");
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>დღეები ზედიზედ</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>შენიშვნა</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="არასავალდებულო"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            თუ დასრულების დრო დაწყებაზე ადრეა, ცვლა ავტომატურად გადადის მეორე დღეზე (მაგ.
            20:00–08:00).
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            გაუქმება
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            შენახვა
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
