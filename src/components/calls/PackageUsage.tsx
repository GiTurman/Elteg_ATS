// კლიენტის პაკეტი და ამ თვის გამოძახებების ლიმიტი — ზარის/გამოძახების დროს.
// ავტორი: Giorgi Turmanidze "GT"
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { clientsQuery, tariffsQuery } from "@/lib/entities";
import {
  WORK_FROM_H,
  WORK_TO_H,
  computeUsage,
  monthCallsQuery,
  monthKey,
  monthLabel,
} from "@/lib/packageUsage";
import { objectsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function usePackageUsage(clientIdIn: string | null | undefined, objectId?: string | null) {
  const key = monthKey();
  const { data: clients = [] } = useQuery(clientsQuery);
  const { data: packages = [] } = useQuery(tariffsQuery);
  const { data: objects = [] } = useQuery(objectsQuery);
  const clientId =
    clientIdIn ||
    (objectId
      ? ((objects.find((o) => o.id === objectId) as { client_id?: string | null } | undefined)
          ?.client_id ?? null)
      : null);
  const { data: calls = [] } = useQuery({ ...monthCallsQuery(key), enabled: !!clientId });
  return useMemo(() => {
    if (!clientId) return null;
    const client = clients.find((c) => c.id === clientId);
    if (!client) return null;
    const pkg = packages.find((p) => p.id === client.package_id) ?? null;
    const objMap = new Map(
      objects.map((o) => [o.id, (o as { client_id?: string | null }).client_id ?? null]),
    );
    return { client, pkg, month: key, usage: computeUsage(client, clientId, calls, objMap) };
  }, [clientId, clients, packages, objects, calls, key]);
}

export function PackageUsage({
  clientId,
  objectId,
  className,
  compact = false,
}: {
  clientId: string | null | undefined;
  objectId?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const info = usePackageUsage(clientId, objectId);
  if (!info) return null;
  const { pkg, usage: u, month } = info;
  const sla = (pkg as { response_sla_hours?: number | null } | null)?.response_sla_hours;

  const tone =
    u.state === "exhausted" || u.state === "outside_hours"
      ? "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
      : u.state === "last" || u.state === "extra"
        ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        : u.state === "unknown"
          ? "border-dashed text-muted-foreground"
          : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200";

  let main = "";
  let warn = "";
  switch (u.mode) {
    case "limited":
      main = `ამ თვეში: ${u.used} / ${u.limit} · დარჩა ${u.remaining}`;
      if (u.state === "exhausted")
        warn =
          u.over > 0
            ? `ლიმიტი გადაჭარბებულია ${u.over}-ით — ახალი გამოძახება დამატებითი ღირებულებით`
            : "ლიმიტი ამოწურულია — ახალი გამოძახება დამატებითი ღირებულებით";
      else if (u.state === "last") warn = "დარჩა ბოლო გამოძახება";
      break;
    case "unlimited":
      main = `ულიმიტო · ამ თვეში: ${u.used}`;
      break;
    case "working_hours":
      main = `მხოლოდ სამუშაო დროს (ორშ–პარ ${WORK_FROM_H}:00–${WORK_TO_H}:00) · ამ თვეში: ${u.used}`;
      if (u.state === "outside_hours")
        warn = "ახლა არასამუშაო დროა — პაკეტით არ ფარავს (დამატებითი ღირებულებით / შეთანხმებით)";
      break;
    case "extra_charge":
      main = `ამ თვეში: ${u.used}`;
      warn = "ყოველი გამოძახება — დამატებითი ღირებულებით";
      break;
    default:
      main = `პაკეტის პირობები მითითებული არ არის · ამ თვეში: ${u.used}`;
  }

  return (
    <div className={cn("rounded-md border px-2.5 py-1.5 text-left text-xs", tone, className)}>
      <div className="font-semibold">
        {pkg ? `პაკეტი: ${pkg.name}` : "პაკეტი: —"}
        {sla ? ` · რეაგირება ${sla} სთ` : ""}
        {compact ? "" : ` · ${monthLabel(month)}`}
      </div>
      <div>{main}</div>
      {u.mode === "limited" && u.limit ? (
        <div className="mt-1 h-1.5 overflow-hidden rounded bg-black/10">
          <div
            className={cn(
              "h-full",
              u.state === "exhausted"
                ? "bg-red-600"
                : u.state === "last"
                  ? "bg-amber-500"
                  : "bg-emerald-600",
            )}
            style={{ width: `${Math.min(100, (u.used / u.limit) * 100)}%` }}
          />
        </div>
      ) : null}
      {warn ? <div className="mt-0.5 font-semibold">⚠ {warn}</div> : null}
      {!compact && u.planned ? (
        <div className="text-[11px] opacity-80">გეგმიური ვიზიტი ამ თვეში: {u.planned}</div>
      ) : null}
    </div>
  );
}
