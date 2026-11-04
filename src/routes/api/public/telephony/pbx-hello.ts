import { createFileRoute } from "@tanstack/react-router";

import { safeEqual } from "@/lib/telephony";

// POST /api/public/telephony/pbx-hello  { "wss_url": "wss://pbx.example.ge/ws" }
// სადგური გაშვებისას თავად აცნობებს აპს თავის WebRTC მისამართს —
// „ტელეფონია → სადგურის მისამართის“ ხელით ჩაწერა აღარ არის საჭირო.
// ავტორი: Giorgi Turmanidze "GT"

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export const Route = createFileRoute("/api/public/telephony/pbx-hello")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const provided =
          request.headers.get("x-webhook-token") ??
          new URL(request.url).searchParams.get("token") ??
          "";
        const { data: settings } = await db
          .from("telephony_settings")
          .select("webhook_token")
          .eq("id", 1)
          .maybeSingle();
        if (!settings?.webhook_token || !provided || !safeEqual(provided, settings.webhook_token)) {
          return json({ ok: false, error: "unauthorized" }, 401);
        }
        let body: { wss_url?: unknown };
        try {
          body = (await request.json()) as { wss_url?: unknown };
        } catch {
          return json({ ok: false, error: "invalid_json" }, 400);
        }
        const wss = typeof body.wss_url === "string" ? body.wss_url.trim() : "";
        if (!/^wss:\/\/[a-z0-9.-]+(:\d+)?\/ws$/i.test(wss)) {
          return json({ ok: false, error: "invalid_wss_url" }, 400);
        }
        const { error } = await db
          .from("telephony_settings")
          .update({ pbx_wss_url: wss, updated_at: new Date().toISOString() } as never)
          .eq("id", 1);
        if (error) return json({ ok: false, error: "server_error" }, 500);
        return json({ ok: true, pbx_wss_url: wss });
      },
    },
  },
});
