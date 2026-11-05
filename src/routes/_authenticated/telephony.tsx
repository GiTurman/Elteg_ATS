import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Eye, EyeOff, Loader2, PhoneCall, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { VoicePromptsCard } from "@/components/telephony/VoicePromptsCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentUser } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { clientsQuery } from "@/lib/entities";
import { staffQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/telephony")({
  head: () => ({
    meta: [
      { title: "ტელეფონია — ლიფტსერვისი" },
      {
        name: "description",
        content: "სატელეფონო სისტემის მიერთება, ვებჰუკის პარამეტრები და ზარის სიმულატორი.",
      },
    ],
  }),
  component: TelephonyPage,
});

const PUBLISHED_ORIGIN = "https://liftdispelteg.lovable.app";
const WEBHOOK_PATH = "/api/public/telephony/webhook";
const ON_DUTY_PATH = "/api/public/telephony/on-duty";

const settingsQuery = {
  queryKey: ["telephony_settings"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("telephony_settings")
      .select("id, answer_sla_seconds, main_number, pbx_wss_url, updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
};

// ტოკენი მხოლოდ მენეჯერს (RPC, ცხრილიდან პირდაპირ აღარ იკითხება)
const tokenQuery = {
  queryKey: ["telephony_settings", "token"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("get_telephony_token");
    if (!error) return data ?? "";
    // ბაზის 0006 განახლებამდე ფუნქცია ჯერ არ არსებობს — ძველი გზა
    const { data: row } = await supabase
      .from("telephony_settings")
      .select("webhook_token")
      .eq("id", 1)
      .maybeSingle();
    return row?.webhook_token ?? "";
  },
};

type Scenario = "answered" | "missed" | "abandoned" | "test" | "cabin";

const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: "answered", label: "ნაპასუხები" },
  { value: "missed", label: "გამოტოვებული" },
  { value: "abandoned", label: "მიტოვებული" },
  { value: "test", label: "ტესტი" },
  { value: "cabin", label: "კაბინიდან" },
];

const callStatusLabel: Record<string, string> = {
  ringing: "რეკავს",
  answered: "ნაპასუხები",
  missed: "გამოტოვებული",
  abandoned: "მიტოვებული",
  voicemail: "ხმოვანი ფოსტა",
  test: "ტესტი",
};
const callbackLabel: Record<string, string> = {
  none: "არ სჭირდება",
  pending: "გადასარეკია",
  done: "გადარეკილია",
  not_needed: "საჭირო არ არის",
};

const SAMPLE_PAYLOAD = `{
  "event": "call_started",
  "call_id": "1700000000.123",
  "direction": "inbound",
  "from": "+995599123456",
  "to": "0322000000",
  "queue": "hotline",
  "extension": "101",
  "timestamp": "2026-11-03T08:30:00Z",
  "duration": 95,
  "status": "answered",
  "recording_url": "https://pbx.example.com/rec/1700000000.123.mp3",
  "is_test": false
}`;

const FIELDS: { name: string; desc: string }[] = [
  {
    name: "event",
    desc: "მოვლენა (სავალდებულო): call_started — ზარი შემოვიდა; call_answered — ოპერატორმა უპასუხა; call_ended — ზარი დასრულდა; recording_ready — ჩანაწერი მზადაა.",
  },
  {
    name: "call_id",
    desc: "ზარის უნიკალური იდენტიფიკატორი სადგურში (სავალდებულო). ყველა მოვლენა ერთი ზარისთვის ერთი და იგივე უნდა იყოს.",
  },
  {
    name: "direction",
    desc: "მიმართულება: inbound (შემომავალი), outbound (გამავალი), internal (შიდა). ნაგულისხმევი — inbound.",
  },
  {
    name: "from",
    desc: "დამრეკის ნომერი ნებისმიერ ფორმატში (+995…, 0…, 5…). ავტომატურად ნორმალიზდება ბოლო 9 ციფრამდე.",
  },
  { name: "to", desc: "ნომერი, რომელზეც დარეკეს (ჩვენი ხაზი)." },
  { name: "queue", desc: "რიგის / ჯგუფის დასახელება." },
  {
    name: "extension",
    desc: "ოპერატორის შიდა ნომერი — მომხმარებლის პროფილის „შიდა ნომერთან“ დასაკავშირებლად.",
  },
  {
    name: "timestamp",
    desc: "მოვლენის დრო ISO 8601 ფორმატში. თუ არ არის — გამოიყენება მიღების დრო.",
  },
  {
    name: "duration",
    desc: "წამებში. call_ended-ზე: ნაპასუხები ზარისთვის — საუბრის ხანგრძლივობა, უპასუხოსთვის — ლოდინის ხანგრძლივობა.",
  },
  {
    name: "status",
    desc: "call_ended-ზე (არასავალდებულო): answered, missed, abandoned, voicemail.",
  },
  { name: "recording_url", desc: "ჩანაწერის ბმული (recording_ready-ზე ან call_ended-ზე)." },
  {
    name: "is_test",
    desc: "true — სატესტო ზარი: არ ჩაითვლება სტატისტიკაში და არ მოითხოვს გადარეკვას.",
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function TelephonyPage() {
  const queryClient = useQueryClient();
  const { isManager, loading } = useCurrentUser();
  const { data: settings } = useQuery({ ...settingsQuery, enabled: isManager });
  const { data: tokenValue = "" } = useQuery({ ...tokenQuery, enabled: isManager });
  const { data: clients = [] } = useQuery(clientsQuery);

  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const webhookUrl = origin ? `${origin}${WEBHOOK_PATH}` : "";

  const [showToken, setShowToken] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [sla, setSla] = useState("");
  useEffect(() => {
    if (settings) setSla(String(settings.answer_sla_seconds));
  }, [settings]);

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} დაკოპირდა`);
  };

  const rotate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("regenerate_telephony_token");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telephony_settings"] });
      setConfirmRotate(false);
      toast.success("ტოკენი განახლდა — განაახლეთ სადგურის პარამეტრებშიც");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveSla = useMutation({
    mutationFn: async () => {
      const n = Number(sla);
      if (!Number.isInteger(n) || n < 1 || n > 600)
        throw new Error("მიუთითეთ მთელი რიცხვი 1-დან 600-მდე");
      const { error } = await supabase
        .from("telephony_settings")
        .update({ answer_sla_seconds: n, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telephony_settings"] });
      toast.success("შენახულია");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!loading && !isManager) {
    return (
      <AppShell title="ტელეფონია">
        <p className="py-8 text-center text-sm text-muted-foreground">
          ეს გვერდი ხელმისაწვდომია მხოლოდ მენეჯერისთვის.
        </p>
      </AppShell>
    );
  }

  const token = tokenValue;
  const masked = token ? `${token.slice(0, 4)}${"•".repeat(28)}${token.slice(-4)}` : "—";

  return (
    <AppShell title="ტელეფონია" subtitle="სატელეფონო სადგურის (PBX) მიერთება">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">ვებჰუკის პარამეტრები</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1.5">
              <Label>ვებჰუკის მისამართი (POST)</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copy(webhookUrl, "მისამართი")}
                  aria-label="მისამართის კოპირება"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              {origin && origin !== PUBLISHED_ORIGIN ? (
                <p className="text-xs text-muted-foreground">
                  სადგურს მიაწოდეთ გამოქვეყნებული მისამართი:{" "}
                  <span className="font-mono">
                    {PUBLISHED_ORIGIN}
                    {WEBHOOK_PATH}
                  </span>
                </p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label>ტოკენი</Label>
              <div className="flex gap-2">
                <Input readOnly value={showToken ? token : masked} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowToken((s) => !s)}
                  aria-label={showToken ? "დამალვა" : "ჩვენება"}
                >
                  {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copy(token, "ტოკენი")}
                  disabled={!token}
                  aria-label="ტოკენის კოპირება"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                გადაეცით ჰედერში <span className="font-mono">X-Webhook-Token</span>
              </p>
              <div>
                <Button variant="outline" size="sm" onClick={() => setConfirmRotate(true)}>
                  <RefreshCw className="size-3.5" /> ტოკენის განახლება
                </Button>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>პასუხის SLA (წამი)</Label>
              <div className="flex gap-2 sm:max-w-xs">
                <Input
                  type="number"
                  min={1}
                  max={600}
                  value={sla}
                  onChange={(e) => setSla(e.target.value)}
                />
                <Button onClick={() => saveSla.mutate()} disabled={saveSla.isPending}>
                  შენახვა
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                რამდენ წამში უნდა უპასუხოს ოპერატორმა შემოსულ ზარს.
              </p>
            </div>
          </CardContent>
        </Card>

        <Simulator webhookUrl={webhookUrl} token={token} clients={clients} />

        <PbxCard origin={origin || PUBLISHED_ORIGIN} />

        <VoicePromptsCard />

        <OperatorsCard />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">მორიგეობის API (გადამისამართებისთვის)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>
              სადგურს შეუძლია ყოველი ზარის წინ ან პერიოდულად გამოითხოვოს, ვინ არის ახლა მორიგე
              „ცვლების“ გრაფიკის მიხედვით, და ზარი იმ რიგით გადაამისამართოს: ოპერატორი →
              ხელმძღვანელი → მორიგე ტექნიკოსის მობილური.
            </p>
            <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-[11px] text-foreground">{`GET ${(origin || PUBLISHED_ORIGIN) + ON_DUTY_PATH}?token=<ტოკენი>

{ "ok": true,
  "routing": [
    { "duty_role": "operator", "name": "…", "target": "101", "target_type": "extension" },
    { "duty_role": "supervisor", "name": "…", "target": "102", "target_type": "extension" },
    { "duty_role": "oncall_technician", "name": "…", "target": "+995599…", "target_type": "mobile" }
  ],
  "operators_on_duty": 1 }`}</pre>
            <p>
              თუ <span className="font-mono">routing</span> ცარიელია — გრაფიკში ამ დროს არავინ
              წერია; სადგურში დააყენეთ სარეზერვო ნომერი.
            </p>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              დოკუმენტაცია სატელეფონო სისტემის მომწოდებლისთვის
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                სადგურმა თითოეულ მოვლენაზე უნდა გამოგზავნოს JSON მოთხოვნა (POST, Content-Type:
                application/json) ზემოთ მითითებულ მისამართზე. მოვლენები შეიძლება მოვიდეს ნებისმიერი
                თანმიმდევრობით და განმეორებით — სისტემა ზარს აერთიანებს{" "}
                <span className="font-mono">call_id</span>-ით. უცნობი ველები იგნორირდება.
              </p>
              <dl className="space-y-2">
                {FIELDS.map((f) => (
                  <div key={f.name} className="grid grid-cols-[110px_1fr] gap-2">
                    <dt className="font-mono text-xs font-medium">{f.name}</dt>
                    <dd className="text-xs text-muted-foreground">{f.desc}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground">
                პასუხი: <span className="font-mono">{`{ "ok": true, "call_log_id": "…" }`}</span>.
                არასწორი ტოკენი — 401, არასწორი მონაცემი — 400.
              </p>
            </div>
            <div className="space-y-3">
              <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">
                {SAMPLE_PAYLOAD}
              </pre>
              <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">{`curl -X POST "${webhookUrl || PUBLISHED_ORIGIN + WEBHOOK_PATH}" \\
  -H "Content-Type: application/json" \\
  -H "X-Webhook-Token: <ტოკენი>" \\
  -d '{"event":"call_started","call_id":"t1","from":"+995599123456"}'`}</pre>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ტოკენის განახლება</AlertDialogTitle>
            <AlertDialogDescription>
              ძველი ტოკენი მაშინვე შეწყვეტს მუშაობას. სატელეფონო სადგურში ახალი ტოკენის ჩაწერამდე
              ზარები არ აისახება სისტემაში.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>გაუქმება</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                rotate.mutate();
              }}
              disabled={rotate.isPending}
            >
              განახლება
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

type LogLine = { step: string; ok: boolean; detail: string };

function Simulator({
  webhookUrl,
  token,
  clients,
}: {
  webhookUrl: string;
  token: string;
  clients: {
    id: string;
    name: string;
    cabin_phone: string | null;
    contact_phone_2: string | null;
  }[];
}) {
  const [from, setFrom] = useState("+995599123456");
  const [extension, setExtension] = useState("101");
  const [scenario, setScenario] = useState<Scenario>("answered");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [resultId, setResultId] = useState<string | null>(null);

  const phoneOptions = useMemo(() => {
    const opts: { value: string; label: string; cabin: boolean }[] = [];
    for (const c of clients) {
      if (c.cabin_phone)
        opts.push({
          value: c.cabin_phone,
          label: `${c.name} — კაბინა: ${c.cabin_phone}`,
          cabin: true,
        });
      if (c.contact_phone_2)
        opts.push({
          value: c.contact_phone_2,
          label: `${c.name} — ნომერი 2: ${c.contact_phone_2}`,
          cabin: false,
        });
    }
    return opts;
  }, [clients]);

  const { data: result } = useQuery({
    queryKey: ["call_log", resultId],
    enabled: !!resultId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_logs")
        .select("*, clients:matched_client_id(name)")
        .eq("id", resultId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  function onScenario(v: Scenario) {
    setScenario(v);
    if (v === "cabin") {
      const cabin = phoneOptions.find((o) => o.cabin);
      if (cabin) setFrom(cabin.value);
    }
  }

  async function run() {
    if (!webhookUrl || !token) return;
    setRunning(true);
    setLog([]);
    setResultId(null);
    const callId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const wait =
      scenario === "cabin" ? 5 : scenario === "missed" ? 30 : scenario === "abandoned" ? 18 : 12;
    const talk = scenario === "cabin" ? 60 : 95;
    const answered = scenario === "answered" || scenario === "cabin" || scenario === "test";
    const total = answered ? wait + talk : wait;
    const base = Date.now() - (total + 5) * 1000;
    const at = (s: number) => new Date(base + s * 1000).toISOString();
    const isTest = scenario === "test";
    const common = {
      call_id: callId,
      direction: "inbound",
      from,
      to: "0322000000",
      queue: "hotline",
      ...(isTest ? { is_test: true } : {}),
    };

    const events: { step: string; body: Record<string, unknown> }[] = [
      { step: "call_started", body: { ...common, event: "call_started", timestamp: at(0) } },
    ];
    if (answered) {
      events.push({
        step: "call_answered",
        body: { ...common, event: "call_answered", extension, timestamp: at(wait) },
      });
      events.push({
        step: "call_ended",
        body: {
          ...common,
          event: "call_ended",
          extension,
          status: "answered",
          duration: talk,
          timestamp: at(wait + talk),
        },
      });
      if (!isTest) {
        events.push({
          step: "recording_ready",
          body: {
            call_id: callId,
            event: "recording_ready",
            recording_url: `https://pbx.example.com/rec/${callId}.mp3`,
          },
        });
      }
    } else {
      events.push({
        step: "call_ended",
        body: {
          ...common,
          event: "call_ended",
          status: scenario,
          duration: wait,
          timestamp: at(wait),
        },
      });
    }

    let lastId: string | null = null;
    try {
      for (const [i, e] of events.entries()) {
        if (i > 0) await sleep(1200);
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Token": token },
          body: JSON.stringify(e.body),
        });
        const body = await res.json().catch(() => ({}));
        if (body?.call_log_id) lastId = body.call_log_id;
        setLog((l) => [
          ...l,
          { step: e.step, ok: res.ok, detail: `${res.status} ${JSON.stringify(body)}` },
        ]);
        if (!res.ok) break;
      }
      setResultId(lastId);
    } catch (err) {
      setLog((l) => [...l, { step: "შეცდომა", ok: false, detail: String(err) }]);
    } finally {
      setRunning(false);
    }
  }

  const clientName = (result as { clients?: { name: string } | null } | null)?.clients?.name;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">ზარის სიმულატორი</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          აგზავნის ნამდვილ მოვლენებს ვებჰუკზე ნამდვილი ტოკენით — ასე მთელი ჯაჭვი მოწმდება სადგურის
          გარეშე. შემომავალი ზარი გამოჩნდება „ცხელ ხაზზე“.
        </p>
        <div className="grid gap-1.5">
          <Label>დამრეკის ნომერი</Label>
          <Select
            value={phoneOptions.some((o) => o.value === from) ? from : ""}
            onValueChange={setFrom}
          >
            <SelectTrigger>
              <SelectValue placeholder="აირჩიეთ კლიენტის ნომერი" />
            </SelectTrigger>
            <SelectContent>
              {phoneOptions.map((o) => (
                <SelectItem key={`${o.label}`} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="ან ჩაწერეთ ნომერი"
            className="font-mono"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>ოპერატორის შიდა ნომერი</Label>
            <Input
              value={extension}
              onChange={(e) => setExtension(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>სცენარი</Label>
            <Select value={scenario} onValueChange={(v) => onScenario(v as Scenario)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENARIOS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={run} disabled={running || !token || !from.trim()}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <PhoneCall className="size-4" />}
          {running ? "მიმდინარეობს…" : "ზარის სიმულაცია"}
        </Button>

        {log.length ? (
          <div className="space-y-1 rounded-md border bg-muted/50 p-2">
            {log.map((l, i) => (
              <div key={i} className="flex gap-2 font-mono text-[11px]">
                <span className={l.ok ? "text-primary" : "text-destructive"}>
                  {l.ok ? "✓" : "✗"}
                </span>
                <span className="w-28 shrink-0">{l.step}</span>
                <span className="truncate text-muted-foreground">{l.detail}</span>
              </div>
            ))}
          </div>
        ) : null}

        {result ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border p-3 text-xs">
            <span className="text-muted-foreground">სტატუსი</span>
            <span>
              <Badge variant="secondary">{callStatusLabel[result.status] ?? result.status}</Badge>
            </span>
            <span className="text-muted-foreground">კლიენტი</span>
            <span>
              {clientName ?? "ვერ მოიძებნა"}
              {result.is_cabin_call ? " · 🚨 კაბინა" : ""}
            </span>
            <span className="text-muted-foreground">ლოდინი / საუბარი</span>
            <span className="tabular-nums">
              {result.wait_seconds ?? "—"} წმ / {result.talk_seconds ?? "—"} წმ
            </span>
            <span className="text-muted-foreground">გადარეკვა</span>
            <span>{callbackLabel[result.callback_status] ?? result.callback_status}</span>
            <span className="text-muted-foreground">ოპერატორი</span>
            <span>
              {result.agent_profile_id
                ? "დაკავშირებულია"
                : `შიდა ${result.agent_extension ?? "—"} (პროფილი ვერ მოიძებნა)`}
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OperatorsCard() {
  const queryClient = useQueryClient();
  const { data: staff = [] } = useQuery(staffQuery);
  const [draft, setDraft] = useState<Record<string, { extension: string; phone: string }>>({});

  useEffect(() => {
    setDraft(
      Object.fromEntries(
        staff.map((s) => [s.id, { extension: s.extension ?? "", phone: s.phone ?? "" }]),
      ),
    );
  }, [staff]);

  const save = useMutation({
    mutationFn: async (id: string) => {
      const d = draft[id];
      if (!d) return;
      const ext = d.extension.trim();
      if (ext && !/^[1-9][0-9]{1,3}$/.test(ext))
        throw new Error("შიდა ნომერი: 2–4 ციფრი (არა 0-ით)");
      const { error } = await supabase.rpc("set_operator_contact", {
        _profile_id: id,
        _extension: ext,
        _phone: d.phone.trim(),
      });
      if (error) {
        if (error.code === "23505")
          throw new Error(`შიდა ნომერი ${ext} უკვე სხვა თანამშრომელს აქვს`);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("შენახულია");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">ოპერატორები — შიდა ნომრები და მობილურები</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          შიდა ნომერი (extension) უნდა ემთხვეოდეს სადგურში მითითებულს — ამით ზარი უკავშირდება
          ოპერატორს. მობილური გამოიყენება მორიგე ტექნიკოსზე გადამისამართებისთვის.
        </p>
        {staff.map((s) => {
          const d = draft[s.id] ?? { extension: "", phone: "" };
          const changed = d.extension !== (s.extension ?? "") || d.phone !== (s.phone ?? "");
          return (
            <div key={s.id} className="grid grid-cols-[1fr_80px_130px_auto] items-center gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{s.full_name || s.email}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {s.roles.join(", ") || "როლის გარეშე"}
                </div>
              </div>
              <Input
                className="h-8 font-mono text-xs"
                placeholder="101"
                value={d.extension}
                onChange={(e) =>
                  setDraft((x) => ({ ...x, [s.id]: { ...d, extension: e.target.value } }))
                }
              />
              <Input
                className="h-8 font-mono text-xs"
                placeholder="+995 5xx xx xx xx"
                value={d.phone}
                onChange={(e) =>
                  setDraft((x) => ({ ...x, [s.id]: { ...d, phone: e.target.value } }))
                }
              />
              <Button
                size="sm"
                variant={changed ? "default" : "outline"}
                disabled={!changed || save.isPending}
                onClick={() => save.mutate(s.id)}
              >
                შენახვა
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function PbxCard({ origin }: { origin: string }) {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery(settingsQuery);
  const [wss, setWss] = useState("");
  const [main, setMain] = useState("");
  useEffect(() => {
    const s = settings as { pbx_wss_url?: string | null; main_number?: string | null } | null;
    setWss(s?.pbx_wss_url ?? "");
    setMain(s?.main_number ?? "");
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      const url = wss.trim();
      if (url && !/^wss:\/\/[a-z0-9.-]+(:\d+)?\/ws$/i.test(url)) {
        throw new Error("მისამართი უნდა იყოს ასეთი: wss://pbx.თქვენი-დომენი.ge/ws");
      }
      const { error } = await supabase
        .from("telephony_settings")
        .update({
          pbx_wss_url: url || null,
          main_number: main.replace(/[^0-9+]/g, "") || null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telephony_settings"] });
      toast.success("შენახულია — ოპერატორებმა განაახლონ გვერდი (F5)");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          სატელეფონო სადგური (Asterisk) — ბრაუზერის ტელეფონი
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-1.5">
          <Label>სადგურის WebRTC მისამართი</Label>
          <Input
            className="font-mono text-xs"
            placeholder="wss://pbx.example.ge/ws"
            value={wss}
            onChange={(e) => setWss(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>მთავარი ნომერი (გამავალ ზარზე გამოჩნდება)</Label>
          <Input
            className="font-mono text-xs"
            placeholder="0322077058"
            value={main}
            onChange={(e) => setMain(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          შენახვა
        </Button>
        <div className="space-y-1 rounded-md border bg-muted p-3 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">სადგურის .env ფაილისთვის:</p>
          <p className="font-mono">APP_URL={origin}</p>
          <p className="font-mono">WEBHOOK_TOKEN=&lt;ზემოთ მითითებული ტოკენი&gt;</p>
          <p>
            სადგური ყოველ წუთში თავად იღებს ოპერატორების სიას აქედან — ახალი ოპერატორის შიდა ნომერი
            ავტომატურად ხდება SIP ანგარიში. პაროლები არავის სჭირდება ხელით.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
