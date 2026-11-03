import { createFileRoute } from "@tanstack/react-router";

import { computeOnDuty } from "@/lib/callcenter";
import { safeEqual } from "@/lib/telephony";

// GET /api/public/telephony/on-duty?token=...
// სატელეფონო სადგურისთვის: ვინ არის ახლა მორიგე და რა რიგით გადავამისამართოთ.
// ავტორი: Giorgi Turmanidze "GT"

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export const Route = createFileRoute("/api/public/telephony/on-duty")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

        const url = new URL(request.url);
        const provided =
          request.headers.get("x-webhook-token") ?? url.searchParams.get("token") ?? "";
        const { data: settings } = await db
          .from("telephony_settings")
          .select("webhook_token")
          .eq("id", 1)
          .maybeSingle();
        if (!settings?.webhook_token || !provided || !safeEqual(provided, settings.webhook_token)) {
          return json({ ok: false, error: "unauthorized" }, 401);
        }

        const atParam = url.searchParams.get("at");
        const at = atParam && !Number.isNaN(Date.parse(atParam)) ? new Date(atParam) : new Date();
        const iso = at.toISOString();

        const [{ data: shifts, error: sErr }, { data: profiles, error: pErr }] = await Promise.all([
          db
            .from("operator_shifts")
            .select("profile_id, duty_role, starts_at, ends_at")
            .lte("starts_at", iso)
            .gt("ends_at", iso),
          db.from("profiles").select("id, full_name, extension, phone, is_active"),
        ]);
        if (sErr || pErr) {
          console.error("[telephony] on-duty failed", sErr ?? pErr);
          return json({ ok: false, error: "server_error" }, 500);
        }

        const people = computeOnDuty(shifts ?? [], profiles ?? [], at);
        // routing: ჯერ ოპერატორის შიდა ნომერი, შემდეგ ხელმძღვანელი, ბოლოს მორიგე ტექნიკოსის მობილური
        const routing = people
          .map((p) => ({
            duty_role: p.duty_role,
            name: p.full_name,
            target:
              p.duty_role === "oncall_technician"
                ? (p.phone ?? p.extension)
                : (p.extension ?? p.phone),
            target_type:
              p.duty_role === "oncall_technician"
                ? p.phone
                  ? "mobile"
                  : "extension"
                : p.extension
                  ? "extension"
                  : "mobile",
          }))
          .filter((r) => !!r.target);

        // format=dial — Asterisk-ისთვის მზა Dial() სტრიქონი (ოპერატორები გამოტოვებულია —
        // ისინი უკვე რიგშია): PJSIP/100&PJSIP/599123456@trunk
        if (url.searchParams.get("format") === "dial") {
          const parts = routing
            .filter((r) => r.duty_role !== "operator")
            .map((r) => {
              const t = String(r.target).replace(/[^0-9+]/g, "");
              if (!t) return null;
              return r.target_type === "extension" ? `PJSIP/${t}` : `PJSIP/${t}@trunk`;
            })
            .filter((x): x is string => !!x);
          return new Response([...new Set(parts)].join("&"), {
            status: 200,
            headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
          });
        }

        return json({
          ok: true,
          at: iso,
          on_duty: people,
          routing,
          operators_on_duty: people.filter((p) => p.duty_role === "operator").length,
        });
      },
    },
  },
});
