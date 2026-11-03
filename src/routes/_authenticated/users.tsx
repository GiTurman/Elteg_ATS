import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
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
import { supabase } from "@/integrations/supabase/client";
import { ROLES, roleLabel, type AppRole } from "@/lib/domain";
import { staffQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({
    meta: [{ title: "მომხმარებლები — ლიფტსერვისი" }],
  }),
  component: UsersPage,
});

function UsersPage() {
  const queryClient = useQueryClient();
  const { data: staff = [] } = useQuery(staffQuery);

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

  return (
    <AppShell
      title="მომხმარებლები"
      subtitle="როლების მართვა. ახალი მომხმარებელი აგზავნის წვდომის მოთხოვნას შესვლის გვერდიდან — წვდომას იღებს მხოლოდ როლის მინიჭების შემდეგ."
    >
      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>სახელი</TableHead>
              <TableHead className="hidden sm:table-cell">ელფოსტა</TableHead>
              <TableHead className="hidden md:table-cell">ტელეფონი</TableHead>
              <TableHead>როლი</TableHead>
              <TableHead>სტატუსი</TableHead>
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
                  <TableCell className="hidden text-xs md:table-cell">{u.phone ?? "—"}</TableCell>
                  <TableCell>
                    <Select
                      value={current}
                      onValueChange={(v) => setRole.mutate({ userId: u.id, role: v as AppRole })}
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
                </TableRow>
              );
            })}
            {staff.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  მომხმარებლები არ მოიძებნა
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}
