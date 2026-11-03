import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, LogOut } from "lucide-react";

import { SoftphonePanel } from "@/components/softphone/SoftphonePanel";
import { SoftphoneProvider } from "@/components/softphone/SoftphoneProvider";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedGate,
});

/** როლის გარეშე მომხმარებელი ვერ ხედავს სისტემას, სანამ მენეჯერი არ დაადასტურებს. */
function AuthenticatedGate() {
  const { isPending, loading, email, isDispatcher } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        იტვირთება…
      </div>
    );
  }

  if (isPending) {
    const signOut = async () => {
      queryClient.clear();
      await supabase.auth.signOut();
      navigate({ to: "/auth", replace: true });
    };
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
        <div className="w-full max-w-sm space-y-3 rounded-lg border bg-card p-6 text-center">
          <Clock className="mx-auto size-8 text-primary" />
          <h1 className="text-base font-semibold">
            თქვენი ანგარიში ელოდება ადმინისტრატორის დადასტურებას
          </h1>
          <p className="text-sm text-muted-foreground">
            {email} — როგორც კი მენეჯერი მიანიჭებს როლს, სისტემა ხელმისაწვდომი გახდება.
          </p>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="size-3.5" /> გასვლა
          </Button>
        </div>
      </div>
    );
  }

  // ტელეფონის პანელი ცოცხლობს გვერდებს შორის გადასვლისას (Outlet-ის გარეთ)
  return (
    <SoftphoneProvider enabled={isDispatcher}>
      <Outlet />
      {isDispatcher ? <SoftphonePanel /> : null}
    </SoftphoneProvider>
  );
}
