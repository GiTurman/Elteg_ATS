// ოპერატორის SIP ანგარიში ბრაუზერის ტელეფონისთვის — მხოლოდ საკუთარი, მხოლოდ თანამშრომლისთვის.
// ავტორი: Giorgi Turmanidze "GT"
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SipAccount =
  | {
      ok: true;
      wssUrl: string;
      extension: string;
      password: string;
      displayName: string;
      domain: string;
    }
  | { ok: false; reason: "no_pbx" | "no_extension" | "not_staff" };

export const getMySipAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SipAccount> => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { loadSipSecret, sipPasswordFor } = await import("@/lib/sip.server");

    const [{ data: roles }, { data: profile }, { data: settings }] = await Promise.all([
      db.from("user_roles").select("role").eq("user_id", context.userId),
      db
        .from("profiles")
        .select("full_name, extension, is_active")
        .eq("id", context.userId)
        .maybeSingle(),
      db.from("telephony_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    const isStaff = (roles ?? []).some((r) => r.role === "dispatcher" || r.role === "manager");
    if (!isStaff || !profile?.is_active) return { ok: false, reason: "not_staff" };
    const wss = (settings as { pbx_wss_url?: string | null } | null)?.pbx_wss_url?.trim();
    if (!wss) return { ok: false, reason: "no_pbx" };
    if (!profile.extension) return { ok: false, reason: "no_extension" };

    const secret = await loadSipSecret();
    return {
      ok: true,
      wssUrl: wss,
      domain: new URL(wss).hostname,
      extension: profile.extension,
      password: await sipPasswordFor(secret, profile.extension),
      displayName: profile.full_name || profile.extension,
    };
  });
