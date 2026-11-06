// თანამშრომლების (ოპერატორების) დამატება და პაროლის აღდგენა — მხოლოდ მენეჯერისთვის.
// ავტორი: Giorgi Turmanidze "GT"
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ROLE = z.enum(["dispatcher", "technician", "manager", "admin"]);

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
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error("როლის შემოწმება ვერ მოხერხდა");
  if (!data) throw new Error("ეს მოქმედება მხოლოდ ადმინისტრატორს შეუძლია");
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

// ─── თანამშრომლის რედაქტირება (მენეჯერი) ───────────────────────────────
const updateSchema = z.object({
  userId: z.string().uuid(),
  full_name: z.string().trim().min(2, "მიუთითეთ სახელი და გვარი").max(120),
  email: z.string().trim().toLowerCase().email("ელფოსტა არასწორია"),
  role: z.union([ROLE, z.literal("none")]),
  extension: z
    .string()
    .trim()
    .regex(/^(|[1-9][0-9]{1,3})$/, "შიდა ნომერი — 2–4 ციფრი (არა 0-ით)")
    .default(""),
  phone: z.string().trim().max(32).default(""),
  is_active: z.boolean(),
});

/**
 * ერთი მოქმედებით: სახელი, ელფოსტა (შესვლის სახელიც), მობილური, შიდა ნომერი, როლი, სტატუსი.
 * დაცვა: საკუთარ თავს როლს/სტატუსს ვერ შეუცვლით; ბოლო აქტიურ მენეჯერს ვერ ჩამოაქვეითებთ.
 * გათიშვისას თანამშრომელი სისტემიდან მაშინვე გამოდის (ანგარიში იბლოკება).
 */
export const updateStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertManager(context.userId);
    const self = data.userId === context.userId;

    const [{ data: before }, { data: roleRows }] = await Promise.all([
      admin.from("profiles").select("*").eq("id", data.userId).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", data.userId),
    ]);
    if (!before) throw new Error("თანამშრომელი ვერ მოიძებნა");
    const oldRoles = (roleRows ?? []).map((r) => r.role as string);
    const oldRole = oldRoles.includes("admin")
      ? "admin"
      : oldRoles.includes("manager")
        ? "manager"
      : oldRoles.includes("dispatcher")
        ? "dispatcher"
        : oldRoles.includes("technician")
          ? "technician"
          : "none";

    if (self && (data.role !== oldRole || !data.is_active)) {
      throw new Error("საკუთარ როლს ან სტატუსს ვერ შეცვლით — სთხოვეთ სხვა ადმინისტრატორს");
    }
    if (oldRole === "admin" && (data.role !== "admin" || !data.is_active)) {
      const { data: mgrs } = await admin.from("user_roles").select("user_id").eq("role", "admin");
      const ids = (mgrs ?? []).map((m) => m.user_id).filter((id) => id !== data.userId);
      const { count } = ids.length
        ? await admin
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .in("id", ids)
            .eq("is_active", true)
        : { count: 0 };
      if (!count) throw new Error("სისტემაში მინიმუმ ერთი აქტიური ადმინისტრატორი უნდა დარჩეს");
    }
    if (data.extension && data.extension !== before.extension) {
      const { data: taken } = await admin
        .from("profiles")
        .select("id, full_name")
        .eq("extension", data.extension)
        .neq("id", data.userId)
        .maybeSingle();
      if (taken) throw new Error(`შიდა ნომერი ${data.extension} უკვე აქვს: ${taken.full_name}`);
    }

    // ელფოსტა = შესვლის სახელი → auth-შიც იცვლება
    if (data.email !== (before.email ?? "").toLowerCase()) {
      const { error } = await admin.auth.admin.updateUserById(data.userId, {
        email: data.email,
        email_confirm: true,
      });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) {
          throw new Error("ეს ელფოსტა უკვე სხვა ანგარიშს აქვს");
        }
        throw new Error(`ელფოსტა ვერ შეიცვალა: ${error.message}`);
      }
    }

    const { error: pErr } = await admin
      .from("profiles")
      .update({
        full_name: data.full_name,
        email: data.email,
        phone: data.phone || null,
        extension: data.extension || null,
        is_active: data.is_active,
      })
      .eq("id", data.userId);
    if (pErr) throw new Error(`პროფილი ვერ შეინახა: ${pErr.message}`);

    if (data.role !== oldRole) {
      const { error: dErr } = await admin.from("user_roles").delete().eq("user_id", data.userId);
      if (dErr) throw new Error(`როლი ვერ შეიცვალა: ${dErr.message}`);
      if (data.role !== "none") {
        const { error: rErr } = await admin
          .from("user_roles")
          .insert({ user_id: data.userId, role: data.role });
        if (rErr) {
          // ძველი როლის აღდგენა, რომ ანგარიში როლის გარეშე არ დარჩეს
          if (oldRole !== "none") {
            await admin.from("user_roles").insert({ user_id: data.userId, role: oldRole });
          }
          throw new Error(`როლი ვერ მიენიჭა: ${rErr.message}`);
        }
      }
    }

    // გათიშვა/ჩართვა → ანგარიშის დაბლოკვა/განბლოკვა (გათიშული ვეღარ შევა)
    if (data.is_active !== before.is_active) {
      const { error: bErr } = await admin.auth.admin.updateUserById(data.userId, {
        ban_duration: data.is_active ? "none" : "876000h",
      });
      if (bErr) console.error("[staff] ban toggle failed", bErr);
    }

    return { ok: true };
  });
