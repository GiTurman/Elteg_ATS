import { createFileRoute } from "@tanstack/react-router";

import { loadSipSecret, sipPasswordFor } from "@/lib/sip.server";
import { safeEqual } from "@/lib/telephony";

// GET /api/public/telephony/pbx-config?token=...
// სადგური (Asterisk) ყოველ წუთში ითხოვს: ვის აქვს შიდა ნომერი და რა პაროლით.
// აპში ოპერატორის დამატება = სადგურზე SIP ანგარიშის ავტომატური შექმნა.
// ავტორი: Giorgi Turmanidze "GT"

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export const Route = createFileRoute("/api/public/telephony/pbx-config")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const url = new URL(request.url);
        const provided =
          request.headers.get("x-webhook-token") ?? url.searchParams.get("token") ?? "";
        const { data: settings } = await db
          .from("telephony_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle();
        if (!settings?.webhook_token || !provided || !safeEqual(provided, settings.webhook_token)) {
          return json({ ok: false, error: "unauthorized" }, 401);
        }

        const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
          db
            .from("profiles")
            .select("id, full_name, extension, is_active")
            .not("extension", "is", null),
          db.from("user_roles").select("user_id, role"),
        ]);
        if (pErr || rErr) return json({ ok: false, error: "server_error" }, 500);

        const secret = await loadSipSecret();
        const users = [];
        for (const p of profiles ?? []) {
          if (!p.extension || !/^[0-9]{2,6}$/.test(p.extension)) continue;
          const userRoles = (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role);
          if (!p.is_active || userRoles.length === 0) continue;
          users.push({
            extension: p.extension,
            name: (p.full_name || p.extension).replace(/["\\\r\n;]/g, " ").slice(0, 60),
            role: userRoles.includes("manager")
              ? "manager"
              : userRoles.includes("dispatcher")
                ? "dispatcher"
                : "technician",
            password: await sipPasswordFor(secret, p.extension),
          });
        }
        users.sort((a, b) => a.extension.localeCompare(b.extension));
        const s = settings as { main_number?: string | null; answer_sla_seconds?: number };
        return json({
          ok: true,
          main_number: s.main_number ?? null,
          answer_sla_seconds: s.answer_sla_seconds ?? 20,
          users,
        });
      },
    },
  },
});
