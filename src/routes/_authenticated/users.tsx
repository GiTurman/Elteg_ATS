import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Copy, KeyRound, UserPlus } from "lucide-react";
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
import { ROLES, roleLabel, type AppRole } from "@/lib/domain";
import { staffQuery } from "@/lib/queries";
import { createStaffUser, resetStaffPassword } from "@/lib/staff.functions";

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

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (delErr) throw delErr;
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("როლი განახლდა");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: active })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      toast.success("სტატუსი განახლდა");
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
              <TableHead className="w-10" />
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
                    <Select
                      value={current}
                      onValueChange={(v) => setRole.mutate({ userId: u.id, role: v as AppRole })}
                      disabled={u.id === userId}
                    >
                      <SelectTrigger
                        className={`h-8 w-40 text-xs ${current ? "" : "border-amber-400 text-amber-700"}`}
                      >
                        <SelectValue placeholder="⏳ დასადასტურებელი" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {roleLabel[r.value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={u.is_active ? "outline" : "default"}
                      disabled={u.id === userId}
                      onClick={() =>
                        toggleActive.mutate({
                          userId: u.id,
                          active: !u.is_active,
                        })
                      }
                    >
                      {u.is_active ? "აქტიური" : "გათიშული"}
                    </Button>
                  </TableCell>
                  <TableCell>
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
        ვინც შესვლის გვერდიდან „წვდომის მოთხოვნას“ გამოგზავნის, აქ გამოჩნდება როგორც „⏳
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
