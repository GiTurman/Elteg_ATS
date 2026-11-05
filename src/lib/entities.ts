import { queryOptions } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

// ახალი ცხრილები ჯერ არ არის generated types.ts-ში, ამიტომ ვიყენებთ
// მსუბუქად ტიპიზებულ კლიენტს (dbx) მხოლოდ ამ ცხრილებისთვის.
export const dbx = supabase as unknown as SupabaseClient;

export type TariffPackage = {
  id: string;
  name: string;
  code: string | null;
  price_monthly: number;
  response_sla_hours: number | null;
  included_services: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export type Client = {
  id: string;
  name: string;
  tax_id: string | null;
  cabin_phone: string | null;
  contact_phone_2: string | null;
  contact_person: string | null;
  email: string | null;
  address: string | null;
  package_id: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  monthly_fee: number | null;
  currency: string | null;
  included_calls: number | null;
  /** გამოძახებების რეჟიმი (0008 მიგრაცია) */
  calls_mode?: "limited" | "unlimited" | "working_hours" | "extra_charge" | null;
  device_count: string | null;
  service_note: string | null;
};

export type Team = {
  id: string;
  name: string;
  description: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
};

export type TeamMember = {
  id: string;
  team_id: string;
  profile_id: string;
};

export type IncomingCall = {
  id: string;
  caller_number: string | null;
  matched_client_id: string | null;
  matched_object_id: string | null;
  service_call_id: string | null;
  status: string;
  raw: Record<string, unknown> | null;
  received_at: string;
  is_cabin_call: boolean;
  call_log_id: string | null;
};

export const tariffsQuery = queryOptions({
  queryKey: ["tariff_packages"],
  queryFn: async () => {
    const { data, error } = await dbx
      .from("tariff_packages")
      .select("*")
      .order("sort_order");
    if (error) throw error;
    return (data ?? []) as TariffPackage[];
  },
});

export const clientsQuery = queryOptions({
  queryKey: ["clients"],
  queryFn: async () => {
    const { data, error } = await dbx.from("clients").select("*").order("name");
    if (error) throw error;
    return (data ?? []) as Client[];
  },
});

export const teamsQuery = queryOptions({
  queryKey: ["teams"],
  queryFn: async () => {
    const { data, error } = await dbx.from("teams").select("*").order("name");
    if (error) throw error;
    return (data ?? []) as Team[];
  },
});

export const teamMembersQuery = queryOptions({
  queryKey: ["team_members"],
  queryFn: async () => {
    const { data, error } = await dbx.from("team_members").select("*");
    if (error) throw error;
    return (data ?? []) as TeamMember[];
  },
});

export const incomingCallsQuery = queryOptions({
  queryKey: ["incoming_calls"],
  queryFn: async () => {
    const { data, error } = await dbx
      .from("incoming_calls")
      .select("*")
      .order("received_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as IncomingCall[];
  },
});

export function formatGel(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toFixed(0)} ₾`;
}
