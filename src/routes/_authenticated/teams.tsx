import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/useAuth";
import { primaryRole, roleLabel, type AppRole } from "@/lib/domain";
import { dbx, teamMembersQuery, teamsQuery } from "@/lib/entities";
import { staffQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/teams")({
  head: () => ({
    meta: [
      { title: "პირები და ჯგუფები — ლიფტსერვისი" },
      { name: "description", content: "გამოძახებებზე მომუშავე პირები და ჯგუფები." },
    ],
  }),
  component: TeamsPage,
});

function TeamsPage() {
  const queryClient = useQueryClient();
  const { isDispatcher } = useCurrentUser();
  const { data: staff = [] } = useQuery(staffQuery);
  const { data: teams = [] } = useQuery(teamsQuery);
  const { data: members = [] } = useQuery(teamMembersQuery);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", phone: "" });

  const nameOf = (id: string) =>
    staff.find((s) => s.id === id)?.full_name ?? "—";

  const createTeam = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("ჯგუფის სახელი სავალდებულოა");
      const { error } = await dbx.from("teams").insert({
        name: form.name.trim(),
        description: form.description || null,
        phone: form.phone || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setOpen(false);
      setForm({ name: "", description: "", phone: "" });
      toast.success("ჯგუფი დაემატა");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addMember = useMutation({
    mutationFn: async (params: { teamId: string; profileId: string }) => {
      const { error } = await dbx
        .from("team_members")
        .insert({ team_id: params.teamId, profile_id: params.profileId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
      toast.success("წევრი დაემატა");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await dbx.from("team_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
      toast.success("წევრი ამოღებულია");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="პირები და ჯგუფები" subtitle="გამოძახებებზე მომუშავე რესურსი">
      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">პირები</TabsTrigger>
          <TabsTrigger value="groups">ჯგუფები</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="mt-3">
          <div className="overflow-x-auto rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>სახელი, გვარი</TableHead>
                  <TableHead>ტელეფონი</TableHead>
                  <TableHead className="hidden sm:table-cell">ელფოსტა</TableHead>
                  <TableHead>როლი</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((p) => {
                  const role: AppRole = primaryRole(p.roles);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm font-medium">
                        {p.full_name || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.phone ?? "—"}
                      </TableCell>
                      <TableCell className="hidden text-xs sm:table-cell">
                        {p.email ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{roleLabel[role]}</TableCell>
                    </TableRow>
                  );
                })}
                {staff.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      პირები არ მოიძებნა
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="groups" className="mt-3 space-y-3">
          {isDispatcher ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> ჯგუფის დამატება
            </Button>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            {teams.map((t) => {
              const teamMembers = members.filter((m) => m.team_id === t.id);
              const available = staff.filter(
                (s) => !teamMembers.some((m) => m.profile_id === s.id),
              );
              return (
                <Card key={t.id}>
                  <CardHeader>
                    <CardTitle className="text-sm">{t.name}</CardTitle>
                    {t.description ? (
                      <p className="text-xs text-muted-foreground">
                        {t.description}
                        {t.phone ? ` · ${t.phone}` : ""}
                      </p>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {teamMembers.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between rounded-md border px-2.5 py-1.5"
                      >
                        <span className="text-sm">{nameOf(m.profile_id)}</span>
                        {isDispatcher ? (
                          <button
                            onClick={() => removeMember.mutate(m.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {teamMembers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        წევრები არ არის
                      </p>
                    ) : null}
                    {isDispatcher && available.length > 0 ? (
                      <Select
                        onValueChange={(v) =>
                          addMember.mutate({ teamId: t.id, profileId: v })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="+ წევრის დამატება" />
                        </SelectTrigger>
                        <SelectContent>
                          {available.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
            {teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">ჯგუფები არ არის.</p>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ახალი ჯგუფი</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>სახელი *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>აღწერა</Label>
              <Input
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label>ტელეფონი</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              გაუქმება
            </Button>
            <Button
              onClick={() => createTeam.mutate()}
              disabled={createTeam.isPending}
            >
              {createTeam.isPending ? "ინახება…" : "დამატება"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
