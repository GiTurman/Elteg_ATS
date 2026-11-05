// თანამშრომლების (ოპერატორების) დამატება და პაროლის აღდგენა — მხოლოდ მენეჯერისთვის.
// ავტორი: Giorgi Turmanidze "GT"
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ROLE = z.enum(["dispatcher", "technician", "manager"]);

/** 12-სიმბოლოიანი დროებითი პაროლი (ადვილად წასაკითხი სიმბოლოებით) */
function tempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function assertManager(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "manager")
    .maybeSingle();
  if (error) throw new Error("როლის შემოწმება ვერ მოხერხდა");
  if (!data) throw new Error("ეს მოქმედება მხოლოდ მენეჯერს შეუძლია");
  const { data: me } = await supabaseAdmin
    .from("profiles")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!me?.is_active) throw new Error("ანგარიში გათიშულია");
  return supabaseAdmin;
}

const createSchema = z.object({
  full_name: z.string().trim().min(2, "მიუთითეთ სახელი და გვარი").max(120),
  email: z.string().trim().toLowerCase().email("ელფოსტა არასწორია"),
  role: ROLE,
  extension: z
    .string()
    .trim()
    .regex(/^(|[1-9][0-9]{1,3})$/, "შიდა ნომერი — 2–4 ციფრი (არა 0-ით)")
    .optional()
    .default(""),
  phone: z.string().trim().max(32).optional().default(""),
});

export const createStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertManager(context.userId);

    if (data.extension) {
      const { data: taken } = await admin
        .from("profiles")
        .select("id")
        .eq("extension", data.extension)
        .maybeSingle();
      if (taken) throw new Error(`შიდა ნომერი ${data.extension} უკვე სხვა თანამშრომელს აქვს`);
    }

    const password = tempPassword();
    const { data: created, error } = await admin.auth.admin.createUser({
      email: data.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error || !created.user) {
      const msg = error?.message ?? "";
      if (/already|registered|exists/i.test(msg)) {
        throw new Error("ამ ელფოსტით მომხმარებელი უკვე არსებობს — როლი მიანიჭეთ სიიდან");
      }
      throw new Error(`ანგარიში ვერ შეიქმნა: ${msg}`);
    }
    const id = created.user.id;

    // პროფილს ტრიგერი ქმნის; ვავსებთ დამატებით ველებს (upsert — თუ ტრიგერი დაგვიანდა)
    const { error: pErr } = await admin.from("profiles").upsert({
      id,
      email: data.email,
      full_name: data.full_name,
      phone: data.phone || null,
      extension: data.extension || null,
      is_active: true,
    });
    if (pErr) throw new Error(`პროფილი ვერ შეინახა: ${pErr.message}`);

    await admin.from("user_roles").delete().eq("user_id", id);
    const { error: rErr } = await admin.from("user_roles").insert({ user_id: id, role: data.role });
    if (rErr) throw new Error(`როლი ვერ მიენიჭა: ${rErr.message}`);

    return { id, email: data.email, password };
  });

export const resetStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertManager(context.userId);
    if (data.userId === context.userId) {
      throw new Error("საკუთარი პაროლი შეცვალეთ ჩვეულებრივი გზით");
    }
    const password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(data.userId, { password });
    if (error) throw new Error(`პაროლი ვერ შეიცვალა: ${error.message}`);
    return { password };
  });
