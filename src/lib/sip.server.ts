// SIP პაროლები შიდა ნომრებისთვის: HMAC-SHA256(sip_secret, "ext:<ნომერი>") — სერვერზე მხოლოდ.
// ავტორი: Giorgi Turmanidze "GT"

export async function sipPasswordFor(secret: string, extension: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`ext:${extension}`));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

export async function loadSipSecret(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("pbx_secrets" as never)
    .select("sip_secret")
    .eq("id", 1)
    .maybeSingle();
  const secret = (data as { sip_secret?: string } | null)?.sip_secret;
  if (error || !secret) throw new Error("SIP საიდუმლო ვერ მოიძებნა");
  return secret;
}
