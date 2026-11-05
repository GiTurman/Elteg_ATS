import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, KeyRound, Pencil, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
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
import { Switch } from "@/components/ui/switch";
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
import { roleLabel, type AppRole } from "@/lib/domain";
import { staffQuery, type StaffMember } from "@/lib/queries";
import { createStaffUser, resetStaffPassword, updateStaffUser } from "@/lib/staff.functions";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({
    meta: [{ title: "მომხმარებლები — ლიფტსერვისი" }],
  }),
  component: UsersPage,
});

type Credentials = { title: string; email: string; password: string };

function UsersPage() {
  const queryClient = useQueryClient();
  const { isManager, loading, userId } = useCurrentUser();
  const { data: staff = [] } = useQuery(staffQuery);
  const [addOpen, setAddOpen] = useState(false);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const resetFn = useServerFn(resetStaffPassword);

  const [editing, setEditing] = useState<StaffMember | null>(null);

  const resetPassword = useMutation({
    mutationFn: async (u: { id: string; email: string | null; full_name: string }) => {
      const res = await resetFn({ data: { userId: u.id } });
      return { ...res, email: u.email ?? "", name: u.full_name };
    },
    onSuccess: (r) =>
      setCreds({
        title: `ახალი პაროლი — ${r.name || r.email}`,
        email: r.email,
        password: r.password,
      }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!loading && !isManager) {
    return (
      <AppShell title="მომხმარებლები">
        <p className="py-8 text-center text-sm text-muted-foreground">
          ეს გვერდი ხელმისაწვდომია მხოლოდ მენეჯერისთვის.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="მომხმარებლები"
      subtitle="თანამშრომლების დამატება, როლები და წვდომა"
      actions={
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus className="size-3.5" /> ოპერატორის დამატება
        </Button>
      }
    >
      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>სახელი</TableHead>
              <TableHead className="hidden sm:table-cell">ელფოსტა</TableHead>
              <TableHead className="hidden md:table-cell">მობილური</TableHead>
              <TableHead className="hidden md:table-cell">შიდა ნომ.</TableHead>
              <TableHead>როლი</TableHead>
              <TableHead>სტატუსი</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((u) => {
              const current: AppRole | "" = u.roles.includes("manager")
                ? "manager"
                : u.roles.includes("dispatcher")
                  ? "dispatcher"
                  : u.roles.includes("technician")
                    ? "technician"
                    : "";
              return (
                <TableRow key={u.id}>
                  <TableCell className="text-sm font-medium">{u.full_name || "—"}</TableCell>
                  <TableCell className="hidden text-xs sm:table-cell">{u.email ?? "—"}</TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">
                    {u.phone ?? "—"}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">
                    {u.extension ?? "—"}
                  </TableCell>
                  <TableCell>
                    {current ? (
                      <span className="text-xs">{roleLabel[current]}</span>
                    ) : (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        ⏳ დასადასტურებელი
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`text-xs ${u.is_active ? "text-emerald-700" : "text-muted-foreground"}`}
                    >
                      {u.is_active ? "აქტიური" : "გათიშული"}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Button
                      size="icon"
                      variant="ghost"
                      title="რედაქტირება"
                      aria-label="რედაქტირება"
                      onClick={() => setEditing(u)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    {u.id !== userId ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="პაროლის აღდგენა"
                        aria-label="პაროლის აღდგენა"
                        disabled={resetPassword.isPending}
                        onClick={() => resetPassword.mutate(u)}
                      >
                        <KeyRound className="size-4" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
            {staff.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  მომხმარებლები არ მოიძებნა
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        რედაქტირება — ✏️ ღილაკით (სახელი, ელფოსტა, მობილური, შიდა ნომერი, როლი და ფუნქციები,
        სტატუსი). ვინც შესვლის გვერდიდან „წვდომის მოთხოვნას“ გამოგზავნის, აქ გამოჩნდება როგორც „⏳
        დასადასტურებელი“ — როლის მინიჭებამდე სისტემას ვერ ხედავს.
      </p>

      <AddStaffDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(c) => {
          setAddOpen(false);
          setCreds(c);
        }}
      />
      <CredentialsDialog creds={creds} onClose={() => setCreds(null)} />
      <EditStaffDialog
        member={editing}
        isSelf={editing?.id === userId}
        onClose={() => setEditing(null)}
      />
    </AppShell>
  );
}

function AddStaffDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Credentials) => void;
}) {
  const queryClient = useQueryClient();
  const createFn = useServerFn(createStaffUser);
  const empty = {
    full_name: "",
    email: "",
    role: "dispatcher" as AppRole,
    extension: "",
    phone: "",
  };
  const [form, setForm] = useState(empty);
  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => createFn({ data: form }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      toast.success("თანამშრომელი დაემატა");
      onCreated({
        title: `ანგარიში შეიქმნა — ${form.full_name}`,
        email: r.email,
        password: r.password,
      });
      setForm(empty);
    },
    onError: (e: Error) => {
      let msg = e.message;
      try {
        const parsed = JSON.parse(msg) as Array<{ message?: string }>;
        if (Array.isArray(parsed) && parsed[0]?.message) msg = parsed[0].message;
      } catch {
        /* plain message */
      }
      toast.error(msg);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ოპერატორის / თანამშრომლის დამატება</DialogTitle>
          <DialogDescription>
            ანგარიში შეიქმნება დროებითი პაროლით, რომელსაც შემდეგ ფანჯარაში ნახავთ.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="sf-name">სახელი და გვარი *</Label>
            <Input
              id="sf-name"
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sf-email">ელფოსტა (შესვლის სახელი) *</Label>
            <Input
              id="sf-email"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label>როლი *</Label>
            <Select value={form.role} onValueChange={(v) => set("role", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dispatcher">ოპერატორი / დისპეჩერი</SelectItem>
                <SelectItem value="technician">ტექნიკოსი</SelectItem>
                <SelectItem value="manager">მენეჯერი (ხელმძღვანელი)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sf-ext">შიდა ნომერი</Label>
              <Input
                id="sf-ext"
                inputMode="numeric"
                placeholder="101"
                value={form.extension}
                onChange={(e) => set("extension", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sf-phone">მობილური</Label>
              <Input
                id="sf-phone"
                placeholder="+995 5xx xx xx xx"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              გაუქმება
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "იქმნება…" : "დამატება"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CredentialsDialog({ creds, onClose }: { creds: Credentials | null; onClose: () => void }) {
  const text = creds
    ? `ლიფტსერვისი — შესვლა\nმისამართი: ${typeof window !== "undefined" ? window.location.origin : ""}/auth\nელფოსტა: ${creds.email}\nდროებითი პაროლი: ${creds.password}`
    : "";
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    toast.success("დაკოპირდა");
  };
  return (
    <Dialog open={!!creds} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{creds?.title}</DialogTitle>
          <DialogDescription>
            გადაეცით თანამშრომელს პირადად. პაროლი მეორედ აღარ გამოჩნდება — საჭიროებისას გამოიყენეთ
            „პაროლის აღდგენა“ (🔑).
          </DialogDescription>
        </DialogHeader>
        <pre className="whitespace-pre-wrap rounded-md border bg-muted p-3 font-mono text-xs">
          {text}
        </pre>
        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            <Copy className="size-3.5" /> კოპირება
          </Button>
          <Button onClick={onClose}>დახურვა</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** რას აკეთებს თითოეული როლი სისტემაში (რედაქტირების ფანჯარაში ჩანს) */
const ROLE_FUNCTIONS: { label: string; roles: AppRole[] }[] = [
  { label: "ზარების მიღება აპიდან (ტელეფონი)", roles: ["dispatcher", "manager"] },
  { label: "გამავალი ზარი / გადარეკვა", roles: ["dispatcher", "manager"] },
  { label: "გამოძახებების შექმნა და რედაქტირება", roles: ["dispatcher", "manager"] },
  { label: "ტექნიკოსის დანიშვნა, გრაფიკი", roles: ["dispatcher", "manager"] },
  { label: "კლიენტები და ობიექტები", roles: ["dispatcher", "manager"] },
  { label: "ზარების ისტორია, ჩანაწერები, KPI", roles: ["dispatcher", "manager"] },
  { label: "ცვლების გრაფიკი", roles: ["dispatcher", "manager"] },
  { label: "საკუთარი გამოძახებები და სტატუსის შეცვლა", roles: ["technician"] },
  { label: "მომხმარებლების მართვა", roles: ["manager"] },
  { label: "ტელეფონიის / სადგურის პარამეტრები", roles: ["manager"] },
  { label: "გამოძახების წაშლა", roles: ["manager"] },
];

const ROLE_OPTIONS: { value: AppRole | "none"; label: string; hint: string }[] = [
  { value: "dispatcher", label: "ოპერატორი / დისპეჩერი", hint: "ზარებს პირველი იღებს" },
  {
    value: "manager",
    label: "მენეჯერი (ხელმძღვანელი)",
    hint: "ზარი მოდის, თუ ოპერატორი თავისუფალი არ არის",
  },
  { value: "technician", label: "ტექნიკოსი", hint: "ხედავს მხოლოდ თავის გამოძახებებს" },
  { value: "none", label: "როლის გარეშე (წვდომა შეჩერებულია)", hint: "სისტემას ვერ ხედავს" },
];

function EditStaffDialog({
  member,
  isSelf,
  onClose,
}: {
  member: StaffMember | null;
  isSelf: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const updateFn = useServerFn(updateStaffUser);
  const roleOf = (m: StaffMember): AppRole | "none" =>
    m.roles.includes("manager")
      ? "manager"
      : m.roles.includes("dispatcher")
        ? "dispatcher"
        : m.roles.includes("technician")
          ? "technician"
          : "none";
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    extension: "",
    role: "none" as AppRole | "none",
    is_active: true,
  });
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (member && loadedId !== member.id) {
    setLoadedId(member.id);
    setForm({
      full_name: member.full_name ?? "",
      email: member.email ?? "",
      phone: member.phone ?? "",
      extension: member.extension ?? "",
      role: roleOf(member),
      is_active: member.is_active,
    });
  }
  const close = () => {
    setLoadedId(null);
    onClose();
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!member) return;
      await updateFn({ data: { userId: member.id, ...form } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("მონაცემები განახლდა");
      close();
    },
    onError: (e: Error) => {
      let msg = e.message;
      try {
        const parsed = JSON.parse(msg) as Array<{ message?: string }>;
        if (Array.isArray(parsed) && parsed[0]?.message) msg = parsed[0].message;
      } catch {
        /* plain message */
      }
      toast.error(msg);
    },
  });

  const roleChanged = member ? form.role !== roleOf(member) : false;
  const callRole = form.role === "dispatcher" || form.role === "manager";

  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>თანამშრომლის რედაქტირება</DialogTitle>
          <DialogDescription>
            ცვლილება ძალაში შედის შენახვისთანავე. თანამშრომელმა გვერდი განაახლოს (F5).
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="ed-name">სახელი და გვარი *</Label>
            <Input
              id="ed-name"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-email">ელფოსტა (შესვლის სახელი) *</Label>
            <Input
              id="ed-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              შეცვლის შემდეგ თანამშრომელი ახალი ელფოსტით შედის (პაროლი იგივე რჩება).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ed-ext">შიდა ნომერი</Label>
              <Input
                id="ed-ext"
                inputMode="numeric"
                placeholder="101"
                value={form.extension}
                onChange={(e) => setForm((f) => ({ ...f, extension: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ed-phone">მობილური</Label>
              <Input
                id="ed-phone"
                placeholder="+995 5xx xx xx xx"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
          </div>
          {callRole && !form.extension.trim() ? (
            <p className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-800">
              შიდა ნომრის გარეშე ეს თანამშრომელი აპიდან ზარებს ვერ მიიღებს და ვერ დარეკავს.
            </p>
          ) : null}

          <div className="grid gap-1.5">
            <Label>როლი</Label>
            <Select
              value={form.role}
              onValueChange={(v) => setForm((f) => ({ ...f, role: v as AppRole | "none" }))}
              disabled={isSelf}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {ROLE_OPTIONS.find((r) => r.value === form.role)?.hint}
              {isSelf ? " · საკუთარ როლს ვერ შეცვლით" : ""}
            </p>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 text-xs font-semibold">
              ფუნქციები{roleChanged ? " (ახალი როლით)" : ""}
            </div>
            <ul className="grid gap-1 text-xs sm:grid-cols-2">
              {ROLE_FUNCTIONS.map((fn) => {
                const on = form.role !== "none" && fn.roles.includes(form.role as AppRole);
                return (
                  <li
                    key={fn.label}
                    className={`flex items-start gap-1.5 ${on ? "" : "text-muted-foreground/60"}`}
                  >
                    {on ? (
                      <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                    ) : (
                      <X className="mt-0.5 size-3.5 shrink-0" />
                    )}
                    {fn.label}
                  </li>
                );
              })}
            </ul>
          </div>

          <label className="flex items-center justify-between rounded-md border p-3 text-sm">
            <span>
              აქტიური
              <span className="block text-[11px] text-muted-foreground">
                გათიშვისას სისტემაში ვეღარ შევა და ზარები აღარ მიუვა
              </span>
            </span>
            <Switch
              checked={form.is_active}
              onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              disabled={isSelf}
            />
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              გაუქმება
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "ინახება…" : "შენახვა"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
