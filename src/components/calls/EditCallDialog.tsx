// გამოძახების რედაქტირება — ზარიდან შექმნილი გამოძახების შევსება/გასწორება.
// ბაზაში დაურეგისტრირებელი ნომრისთვის: კლიენტის/ობიექტის არჩევა ან ახალი კლიენტის შექმნა.
// ავტორი: Giorgi Turmanidze "GT"
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PackageUsage } from "@/components/calls/PackageUsage";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  PRIORITIES,
  SERVICE_TYPES,
  type CallPriority,
  type ServiceCall,
  type ServiceType,
} from "@/lib/domain";
import { clientsQuery, dbx } from "@/lib/entities";
import { objectsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

type FormState = {
  clientId: string;
  objectId: string;
  siteName: string;
  address: string;
  elevatorCode: string;
  serialNumber: string;
  serviceType: ServiceType;
  priority: CallPriority;
  contactName: string;
  contactPhone: string;
  description: string;
  createClient: boolean;
};

const NONE = "";

function initialForm(call: ServiceCall): FormState {
  return {
    clientId: call.client_id ?? NONE,
    objectId: call.object_id ?? NONE,
    siteName: call.site_name ?? "",
    address: call.address === "—" ? "" : (call.address ?? ""),
    elevatorCode: call.elevator_code ?? "",
    serialNumber: call.serial_number ?? "",
    serviceType: call.service_type,
    priority: call.priority,
    contactName: call.client_name ?? "",
    contactPhone: call.client_phone ?? call.caller_number ?? "",
    description: call.description ?? "",
    createClient: false,
  };
}

const trimOrNull = (v: string) => (v.trim() ? v.trim() : null);

function SearchPicker<T extends { id: string; label: string; hint?: string | null }>({
  items,
  value,
  onChange,
  placeholder,
  emptyText,
}: {
  items: T[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="ძებნა…" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__ არ არის მითითებული"
                onSelect={() => {
                  onChange(NONE);
                  setOpen(false);
                }}
              >
                <Check className={cn("size-4", value === NONE ? "opacity-100" : "opacity-0")} />— არ
                არის მითითებული
              </CommandItem>
              {items.map((i) => (
                <CommandItem
                  key={i.id}
                  value={`${i.label} ${i.hint ?? ""} ${i.id}`}
                  onSelect={() => {
                    onChange(i.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value === i.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{i.label}</span>
                  {i.hint ? (
                    <span className="ml-auto truncate text-xs text-muted-foreground">{i.hint}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function EditCallDialog({
  call,
  open,
  onOpenChange,
}: {
  call: ServiceCall;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: clients = [] } = useQuery(clientsQuery);
  const { data: objects = [] } = useQuery(objectsQuery);
  const [form, setForm] = useState<FormState>(() => initialForm(call));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (open) setForm(initialForm(call));
  }, [open, call]);

  const clientItems = useMemo(
    () =>
      clients.map((c) => ({
        id: c.id,
        label: c.name,
        hint: [c.contact_phone_2, c.cabin_phone].filter(Boolean).join(" · ") || c.address,
      })),
    [clients],
  );

  const objectItems = useMemo(
    () =>
      objects
        .filter((o) => !form.clientId || o.client_id === form.clientId)
        .map((o) => ({ id: o.id, label: o.name, hint: o.elevator_code ?? o.address })),
    [objects, form.clientId],
  );

  function pickClient(id: string) {
    const client = clients.find((c) => c.id === id);
    setForm((f) => {
      const objectStillValid = objects.some(
        (o) => o.id === f.objectId && (!id || o.client_id === id),
      );
      return {
        ...f,
        clientId: id,
        objectId: objectStillValid ? f.objectId : NONE,
        createClient: false,
        address: f.address || client?.address || "",
        siteName:
          f.siteName && f.siteName !== "ცხელი ხაზი" && f.siteName !== "ქოლ-ცენტრი"
            ? f.siteName
            : (client?.name ?? f.siteName),
        contactName: f.contactName || client?.contact_person || "",
      };
    });
  }

  function pickObject(id: string) {
    const obj = objects.find((o) => o.id === id);
    if (!obj) return set("objectId", NONE);
    setForm((f) => ({
      ...f,
      objectId: id,
      clientId: f.clientId || obj.client_id || NONE,
      siteName: obj.name,
      address: obj.address ?? f.address,
      elevatorCode: obj.elevator_code ?? f.elevatorCode,
      serialNumber: obj.serial_number ?? f.serialNumber,
    }));
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!form.siteName.trim()) throw new Error("მიუთითეთ ობიექტის დასახელება");
      if (!form.address.trim()) throw new Error("მიუთითეთ მისამართი");

      let clientId = form.clientId || null;
      if (!clientId && form.createClient) {
        const { data: created, error } = await dbx
          .from("clients")
          .insert({
            name: trimOrNull(form.contactName) ?? form.siteName.trim(),
            contact_person: trimOrNull(form.contactName),
            contact_phone_2: trimOrNull(form.contactPhone),
            address: form.address.trim(),
            is_active: true,
            notes: `შექმნილია გამოძახებიდან #${call.call_no}`,
          })
          .select("id")
          .single();
        if (error) throw error;
        clientId = created.id as string;
      }
      const clientName =
        clients.find((c) => c.id === clientId)?.name ?? trimOrNull(form.contactName);

      const { error } = await dbx
        .from("service_calls")
        .update({
          client_id: clientId,
          object_id: form.objectId || null,
          site_name: form.siteName.trim(),
          address: form.address.trim(),
          elevator_code: trimOrNull(form.elevatorCode),
          serial_number: trimOrNull(form.serialNumber),
          service_type: form.serviceType,
          priority: form.priority,
          client_name: clientName,
          client_phone: trimOrNull(form.contactPhone),
          description: trimOrNull(form.description),
        })
        .eq("id", call.id);
      if (error) throw error;

      // ზარების ისტორიაში/ცხელ ხაზზეც გამოჩნდეს კლიენტი (შეცდომა არ აჩერებს შენახვას)
      const matched = { matched_client_id: clientId, matched_object_id: form.objectId || null };
      const results = await Promise.allSettled([
        supabase.from("call_logs").update(matched).eq("service_call_id", call.id),
        dbx.from("incoming_calls").update(matched).eq("service_call_id", call.id),
      ]);
      const linkFailed = results.some(
        (r) => r.status === "rejected" || (r.value as { error?: unknown }).error,
      );
      return { createdClient: !form.clientId && form.createClient, linkFailed };
    },
    onSuccess: ({ createdClient, linkFailed }) => {
      if (linkFailed)
        toast.warning("გამოძახება შენახულია, მაგრამ ზარის ისტორიაში კლიენტი ვერ მიება");
      for (const key of [
        "service_call",
        "service_calls",
        "clients",
        "call_logs",
        "incoming_calls",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(
        createdClient ? "შენახულია — ახალი კლიენტი დარეგისტრირდა" : "გამოძახება განახლდა",
      );
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>გამოძახების რედაქტირება #{call.call_no}</DialogTitle>
          <DialogDescription>
            შეავსეთ ან გაასწორეთ ზარიდან შექმნილი გამოძახების მონაცემები.
            {call.caller_number ? ` დამრეკი: ${call.caller_number}` : ""}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>კლიენტი</Label>
              <SearchPicker
                items={clientItems}
                value={form.clientId}
                onChange={pickClient}
                placeholder="აირჩიეთ კლიენტი…"
                emptyText="კლიენტი ვერ მოიძებნა"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>ობიექტი / ლიფტი</Label>
              <SearchPicker
                items={objectItems}
                value={form.objectId}
                onChange={pickObject}
                placeholder="აირჩიეთ ობიექტი…"
                emptyText="ობიექტი ვერ მოიძებნა"
              />
            </div>
          </div>

          <PackageUsage clientId={form.clientId || null} objectId={form.objectId || null} />

          {!form.clientId ? (
            <label className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm">
              <Checkbox
                checked={form.createClient}
                onCheckedChange={(v) => set("createClient", v === true)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">ახალი კლიენტის რეგისტრაცია</span>
                <span className="block text-xs text-muted-foreground">
                  ნომერი ბაზაში არ არის — შეინახება კლიენტად (სახელი, ტელეფონი, მისამართი), რომ
                  შემდეგ ზარზე ავტომატურად ამოიცნოს.
                </span>
              </span>
            </label>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ec-site">ობიექტის დასახელება *</Label>
              <Input
                id="ec-site"
                value={form.siteName}
                onChange={(e) => set("siteName", e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ec-addr">მისამართი *</Label>
              <Input
                id="ec-addr"
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ec-code">ლიფტის კოდი</Label>
              <Input
                id="ec-code"
                value={form.elevatorCode}
                onChange={(e) => set("elevatorCode", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ec-serial">ქარხნული ნომერი</Label>
              <Input
                id="ec-serial"
                value={form.serialNumber}
                onChange={(e) => set("serialNumber", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>მომსახურების ტიპი</Label>
              <Select
                value={form.serviceType}
                onValueChange={(v) => set("serviceType", v as ServiceType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>პრიორიტეტი</Label>
              <Select
                value={form.serviceType === "chamokideba" ? "kritikuli" : form.priority}
                onValueChange={(v) => set("priority", v as CallPriority)}
                disabled={form.serviceType === "chamokideba"}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ec-contact">საკონტაქტო პირი</Label>
              <Input
                id="ec-contact"
                value={form.contactName}
                onChange={(e) => set("contactName", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ec-phone">საკონტაქტო ტელეფონი</Label>
              <Input
                id="ec-phone"
                inputMode="tel"
                value={form.contactPhone}
                onChange={(e) => set("contactPhone", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ec-desc">აღწერა</Label>
            <Textarea
              id="ec-desc"
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              გაუქმება
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "ინახება…" : "შენახვა"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
