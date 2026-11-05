// SMS შეტყობინებები კლიენტებს — პარამეტრები, შაბლონები, ტესტი, ჟურნალი (მენეჯერი).
// ავტორი: Giorgi Turmanidze "GT"
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, KeyRound, Send, XCircle } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { STATUSES, statusLabel, type CallStatus } from "@/lib/domain";
import {
  DEFAULT_SMS_SETTINGS,
  SMS_SAMPLE_VARS,
  SMS_VARS,
  renderSms,
  smsSegments,
  translitGe,
  type SmsSettings,
} from "@/lib/sms";
import { getSmsSettings, saveSmsSettings, sendTestSms, setSmsApiKey } from "@/lib/sms.functions";

export const Route = createFileRoute("/_authenticated/sms")({
  head: () => ({ meta: [{ title: "SMS შეტყობინებები — ლიფტსერვისი" }] }),
  component: SmsPage,
});

type LogRow = {
  id: string;
  created_at: string;
  kind: "inbound" | "status" | "test";
  to_number: string | null;
  body: string;
  ok: boolean;
  error: string | null;
  status: CallStatus | null;
};

const KIND_LABEL: Record<LogRow["kind"], string> = {
  inbound: "შემომავალი ზარი",
  status: "სტატუსი",
  test: "ტესტი",
};

function Preview({ tpl, translit }: { tpl: string; translit: boolean }) {
  const raw = renderSms(tpl, SMS_SAMPLE_VARS);
  const text = translit ? translitGe(raw) : raw;
  const seg = smsSegments(text);
  if (!tpl.trim()) return null;
  return (
    <div className="rounded-md bg-muted p-2 text-xs">
      <div className="whitespace-pre-wrap">{text}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {seg.chars} სიმბოლო · {seg.segments} SMS{seg.unicode ? " (ქართული შრიფტი)" : ""}
      </div>
    </div>
  );
}

function SmsPage() {
  const queryClient = useQueryClient();
  const { isManager, loading } = useCurrentUser();
  const getFn = useServerFn(getSmsSettings);
  const saveFn = useServerFn(saveSmsSettings);
  const keyFn = useServerFn(setSmsApiKey);
  const testFn = useServerFn(sendTestSms);

  const { data: loaded } = useQuery({
    queryKey: ["sms_settings"],
    enabled: isManager,
    queryFn: () => getFn(),
  });
  const { data: log = [] } = useQuery({
    queryKey: ["sms_log"],
    enabled: isManager,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sms_log" as never)
        .select("id, created_at, kind, to_number, body, ok, error, status")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return [] as LogRow[];
      return (data ?? []) as unknown as LogRow[];
    },
  });

  const [form, setForm] = useState<SmsSettings>(DEFAULT_SMS_SETTINGS);
  const [apiKey, setApiKey] = useState("");
  const [testTo, setTestTo] = useState("");
  useEffect(() => {
    if (loaded?.settings) setForm(loaded.settings);
  }, [loaded]);
  const set = <K extends keyof SmsSettings>(k: K, v: SmsSettings[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setStatusTpl = (st: CallStatus, v: string) =>
    setForm((f) => ({ ...f, status_templates: { ...f.status_templates, [st]: v } }));

  const errMsg = (e: Error) => {
    let msg = e.message;
    try {
      const parsed = JSON.parse(msg) as Array<{ message?: string }>;
      if (Array.isArray(parsed) && parsed[0]?.message) msg = parsed[0].message;
    } catch {
      /* plain */
    }
    toast.error(msg);
  };

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          enabled: form.enabled,
          sender: form.sender,
          translit: form.translit,
          inbound_enabled: form.inbound_enabled,
          inbound_template: form.inbound_template,
          inbound_unknown_template: form.inbound_unknown_template,
          dedupe_minutes: Number(form.dedupe_minutes) || 60,
          status_templates: Object.fromEntries(
            Object.entries(form.status_templates).map(([k, v]) => [k, v ?? ""]),
          ) as Record<CallStatus, string>,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sms_settings"] });
      toast.success("შენახულია");
    },
    onError: errMsg,
  });
  const saveKey = useMutation({
    mutationFn: () => keyFn({ data: { api_key: apiKey } }),
    onSuccess: () => {
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: ["sms_settings"] });
      toast.success("API გასაღები შენახულია");
    },
    onError: errMsg,
  });
  const test = useMutation({
    mutationFn: () =>
      testFn({
        data: {
          to: testTo,
          body: renderSms(form.inbound_template || "სატესტო შეტყობინება", SMS_SAMPLE_VARS),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sms_log"] });
      toast.success("სატესტო SMS გაიგზავნა");
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ["sms_log"] });
      errMsg(e);
    },
  });

  if (!loading && !isManager) {
    return (
      <AppShell title="SMS შეტყობინებები">
        <p className="py-8 text-center text-sm text-muted-foreground">
          ეს გვერდი ხელმისაწვდომია მხოლოდ მენეჯერისთვის.
        </p>
      </AppShell>
    );
  }

  const notReady = loaded && !loaded.ready;

  return (
    <AppShell
      title="SMS შეტყობინებები"
      subtitle="კლიენტს: შემომავალ ზარზე — პაკეტი და რეაგირების დრო; გამოძახების სტატუსის ცვლილება"
      actions={
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !!notReady}>
          შენახვა
        </Button>
      }
    >
      {notReady ? (
        <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          ბაზა ჯერ არ არის განახლებული SMS-ისთვის — პარამეტრების შენახვა შესაძლებელი იქნება
          განახლების შემდეგ.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">SMS სერვისი (smsoffice.ge)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span>
                SMS-ების გაგზავნა ჩართულია
                <span className="block text-[11px] text-muted-foreground">
                  გამორთვისას არცერთი შეტყობინება არ გაიგზავნება
                </span>
              </span>
              <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
            </label>

            <div className="grid gap-1.5">
              <Label htmlFor="sms-key" className="flex items-center gap-1.5">
                <KeyRound className="size-3.5" /> API გასაღები
                {form.has_api_key ? (
                  <span className="text-[11px] font-normal text-emerald-700">✓ შენახულია</span>
                ) : (
                  <span className="text-[11px] font-normal text-amber-700">არ არის მითითებული</span>
                )}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="sms-key"
                  type="password"
                  autoComplete="off"
                  placeholder={form.has_api_key ? "ახლის ჩასაწერად ჩასვით აქ" : "ჩასვით გასაღები"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => saveKey.mutate()}
                  disabled={!apiKey.trim() || saveKey.isPending || !!notReady}
                >
                  შენახვა
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                smsoffice.ge → პროფილი → ინტეგრაცია. გასაღები ინახება სერვერზე და აქ აღარ ჩანს.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="sms-sender">გამგზავნის სახელი</Label>
              <Input
                id="sms-sender"
                maxLength={11}
                placeholder="მაგ. LiftService"
                value={form.sender}
                onChange={(e) => set("sender", e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                მაქს. 11 ლათინური ასო/ციფრი — უნდა იყოს დარეგისტრირებული smsoffice-ზე.
              </p>
            </div>

            <label className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span>
                ლათინური ასოებით გაგზავნა
                <span className="block text-[11px] text-muted-foreground">
                  ქართული: 70 სიმბოლო = 1 SMS; ლათინური: 160 — 2-3-ჯერ იაფია
                </span>
              </span>
              <Switch checked={form.translit} onCheckedChange={(v) => set("translit", v)} />
            </label>

            <div className="grid gap-1.5">
              <Label htmlFor="sms-test">სატესტო SMS</Label>
              <div className="flex gap-2">
                <Input
                  id="sms-test"
                  inputMode="tel"
                  placeholder="5XX XX XX XX"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => test.mutate()}
                  disabled={!testTo.trim() || test.isPending || !!notReady}
                >
                  <Send className="size-3.5" /> გაგზავნა
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">შემომავალ ზარზე — პაკეტის ინფორმაცია</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center justify-between text-sm">
              ჩართულია
              <Switch
                checked={form.inbound_enabled}
                onCheckedChange={(v) => set("inbound_enabled", v)}
              />
            </label>
            <div className="grid gap-1.5">
              <Label>რეგისტრირებული კლიენტი (პაკეტით)</Label>
              <Textarea
                rows={3}
                value={form.inbound_template}
                onChange={(e) => set("inbound_template", e.target.value)}
              />
              <Preview tpl={form.inbound_template} translit={form.translit} />
            </div>
            <div className="grid gap-1.5">
              <Label>უცნობი ნომერი / პაკეტის გარეშე (ცარიელი = არ იგზავნება)</Label>
              <Textarea
                rows={2}
                placeholder="მაგ. თქვენი ზარი მიღებულია. ცხელი ხაზი: {hotline}"
                value={form.inbound_unknown_template}
                onChange={(e) => set("inbound_unknown_template", e.target.value)}
              />
              <Preview tpl={form.inbound_unknown_template} translit={form.translit} />
            </div>
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="sms-dedupe">ერთ ნომერზე განმეორება არაუადრეს (წუთი)</Label>
              <Input
                id="sms-dedupe"
                type="number"
                min={1}
                value={form.dedupe_minutes}
                onChange={(e) => set("dedupe_minutes", Number(e.target.value))}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              SMS იგზავნება მხოლოდ მობილურზე (5XX…). ქალაქის/კაბინის ნომერზე — არა.
            </p>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">გამოძახების სტატუსის ცვლილება</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              ჩართეთ სასურველი სტატუსები. SMS მიდის გამოძახებაში მითითებულ საკონტაქტო ნომერზე (ან
              დამრეკის ნომერზე); თითო სტატუსზე — ერთხელ.
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              {STATUSES.map((st) => {
                const tpl = form.status_templates[st.value] ?? "";
                const on = tpl.trim().length > 0;
                return (
                  <div key={st.value} className="space-y-1.5 rounded-md border p-3">
                    <div className="flex items-center justify-between text-sm font-medium">
                      {statusLabel[st.value]}
                      <Switch
                        checked={on}
                        onCheckedChange={(v) =>
                          setStatusTpl(
                            st.value,
                            v
                              ? DEFAULT_SMS_SETTINGS.status_templates[st.value] ||
                                  `გამოძახება №{call_no}: სტატუსი — {status}.`
                              : "",
                          )
                        }
                      />
                    </div>
                    {on ? (
                      <>
                        <Textarea
                          rows={2}
                          value={tpl}
                          onChange={(e) => setStatusTpl(st.value, e.target.value)}
                        />
                        <Preview tpl={tpl} translit={form.translit} />
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="rounded-md bg-muted/60 p-3 text-xs">
              <div className="mb-1 font-semibold">ჩასასმელი ველები</div>
              <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-3">
                {SMS_VARS.map((v) => (
                  <div key={v.key}>
                    <span className="font-mono">{`{${v.key}}`}</span> — {v.desc}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">გაგზავნილი SMS-ები (ბოლო 100)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>დრო</TableHead>
                  <TableHead>ტიპი</TableHead>
                  <TableHead>ნომერი</TableHead>
                  <TableHead>ტექსტი</TableHead>
                  <TableHead>შედეგი</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(r.created_at).toLocaleString("ka-GE")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {KIND_LABEL[r.kind]}
                      {r.status ? ` · ${statusLabel[r.status]}` : ""}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.to_number ?? "—"}</TableCell>
                    <TableCell className="max-w-md text-xs">{r.body}</TableCell>
                    <TableCell className="text-xs">
                      {r.ok ? (
                        <span className="flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="size-3.5" /> გაიგზავნა
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-700">
                          <XCircle className="size-3.5" /> {r.error ?? "შეცდომა"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {log.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      ჯერ არცერთი SMS არ გაგზავნილა
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
