import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { isManagerRole, isStaffRole, primaryRole, type AppRole } from "@/lib/domain";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let mounted = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      setSession(s);
      setLoading(false);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        queryClient.invalidateQueries();
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  return { session, loading, user: session?.user ?? null };
}

export function useCurrentUser() {
  const { session, loading } = useSession();
  const userId = session?.user.id;

  const profileQuery = useQuery({
    queryKey: ["me", userId],
    enabled: !!userId,
    queryFn: async () => {
      const [{ data: profile }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId!).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId!),
      ]);
      return {
        profile,
        roles: (roles ?? []).map((r) => r.role as AppRole),
      };
    },
  });

  const roles = profileQuery.data?.roles ?? [];
  // როლის გარეშე მომხმარებელს წვდომა არ აქვს, სანამ მენეჯერი არ დაადასტურებს
  // გათიშული თანამშრომელიც ვერ ხედავს სისტემას
  const isPending =
    !!profileQuery.data &&
    (roles.length === 0 || profileQuery.data.profile?.is_active === false);
  const role: AppRole = primaryRole(roles);

  return {
    loading: loading || profileQuery.isLoading,
    session,
    userId,
    email: session?.user.email ?? "",
    profile: profileQuery.data?.profile ?? null,
    role,
    isPending,
    /** ადმინი: ტელეფონია, მომხმარებლები, SMS + ყველაფერი */
    isAdmin: !isPending && role === "admin",
    /** მენეჯერის უფლებები (მენეჯერი ან ადმინი) */
    isManager: !isPending && isManagerRole(role),
    isDispatcher: !isPending && isStaffRole(role),
    isTechnician: !isPending && role === "technician",
  };
}
