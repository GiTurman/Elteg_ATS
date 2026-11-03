import { createFileRoute } from "@tanstack/react-router";

import {
  computeCallLogPatch,
  safeEqual,
  telephonyEventSchema,
  type CallLogState,
} from "@/lib/telephony";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export const Route = createFileRoute("/api/public/telephony/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin;

        // 1. Auth: X-Webhook-Token header or ?token=
        const url = new URL(request.url);
        const provided =
          request.headers.get("x-webhook-token") ?? url.searchParams.get("token") ?? "";
        const { data: settings, error: settingsErr } = await db
          .from("telephony_settings")
          .select("webhook_token")
          .eq("id", 1)
          .maybeSingle();
        if (settingsErr) {
          console.error("[telephony] settings read failed", settingsErr);
          return json({ ok: false, error: "server_error" }, 500);
        }
        if (!settings?.webhook_token || !provided || !safeEqual(provided, settings.webhook_token)) {
          return json({ ok: false, error: "unauthorized" }, 401);
        }

        // 2. Parse + validate
        let rawBody: Record<string, unknown>;
        try {
          const parsed = await request.json();
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          rawBody = parsed as Record<string, unknown>;
        } catch {
          return json({ ok: false, error: "invalid_json" }, 400);
        }
        const result = telephonyEventSchema.safeParse(rawBody);
        if (!result.success) {
          return json(
            { ok: false, error: "invalid_payload", issues: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
            400,
          );
        }
        const ev = result.data;

        try {
          // 3. Ensure the row exists (idempotent), then read current state
          const { error: insErr } = await db
            .from("call_logs")
            .upsert({ external_call_id: ev.call_id }, { onConflict: "external_call_id", ignoreDuplicates: true });
          if (insErr) throw insErr;
          const { data: row, error: selErr } = await db
            .from("call_logs")
            .select("*")
            .eq("external_call_id", ev.call_id)
            .single();
          if (selErr) throw selErr;

          const prev: CallLogState = {
            direction: row.direction,
            status: row.status,
            started_at: row.started_at,
            answered_at: row.answered_at,
            ended_at: row.ended_at,
            talk_seconds: row.talk_seconds,
            callback_status: row.callback_status,
            raw: row.raw,
          };
          const patch = computeCallLogPatch(prev, ev, rawBody, new Date().toISOString());

          const update: Record<string, unknown> = { ...patch };

          // 4. Match caller to client / object (once)
          let matchedClient = row.matched_client_id;
          let matchedObject = row.matched_object_id;
          let isCabin = row.is_cabin_call;
          if (!matchedClient && !matchedObject) {
            const numberToMatch =
              patch.direction === "outbound"
                ? (patch.called_number ?? row.called_number)
                : (patch.caller_number ?? row.caller_number);
            if (numberToMatch) {
              const { data: m, error: mErr } = await db.rpc("match_caller", { _phone: numberToMatch });
              if (mErr) console.error("[telephony] match failed", mErr);
              const hit = Array.isArray(m) ? m[0] : null;
              if (hit) {
                matchedClient = hit.client_id;
                matchedObject = hit.object_id;
                isCabin = hit.is_cabin;
                update["matched_client_id"] = matchedClient;
                update["matched_object_id"] = matchedObject;
                update["is_cabin_call"] = isCabin;
              }
            }
          }

          // 5. Resolve operator by extension
          if (ev.extension) {
            const { data: agent } = await db
              .from("profiles")
              .select("id")
              .eq("extension", ev.extension)
              .maybeSingle();
            if (agent) update["agent_profile_id"] = agent.id;
          }

          const { error: upErr } = await db.from("call_logs").update(update as never).eq("id", row.id);
          if (upErr) throw upErr;

          // 6. Hotline popup for inbound calls / dismiss for test calls
          if (patch.status === "test") {
            await db
              .from("incoming_calls")
              .update({ status: "dismissed" })
              .eq("call_log_id", row.id)
              .eq("status", "new");
          } else if (
            patch.direction === "inbound" &&
            !row.incoming_call_id &&
            ev.event !== "recording_ready"
          ) {
            const { data: inc, error: incErr } = await db
              .from("incoming_calls")
              .insert({
                caller_number: patch.caller_number ?? row.caller_number,
                matched_client_id: matchedClient,
                matched_object_id: matchedObject,
                is_cabin_call: isCabin,
                call_log_id: row.id,
                status: "new",
                raw: rawBody as never,
                received_at: patch.started_at ?? new Date().toISOString(),
              })
              .select("id")
              .single();
            if (incErr && incErr.code !== "23505") throw incErr;
            if (inc) {
              await db.from("call_logs").update({ incoming_call_id: inc.id }).eq("id", row.id);
            }
          }

          return json({ ok: true, call_log_id: row.id });
        } catch (e) {
          console.error("[telephony] webhook failed", e);
          return json({ ok: false, error: "server_error" }, 500);
        }
      },
    },
  },
});
