// ტელეფონის პანელი — ყველა გვერდზე, ქვედა მარჯვენა კუთხეში.
// ავტორი: Giorgi Turmanidze "GT"
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Grid3x3,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  Play,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { clientsQuery } from "@/lib/entities";
import { objectsQuery } from "@/lib/queries";
import { normalizeGePhone } from "@/lib/telephony";
import { cn } from "@/lib/utils";

import { useSoftphone } from "./SoftphoneProvider";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function useTicker(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** ნომრით კლიენტის/ობიექტის მოძებნა (კაბინის ნომრის ჩათვლით) */
function useCallerInfo(number: string | null) {
  const { data: clients = [] } = useQuery(clientsQuery);
  const { data: objects = [] } = useQuery(objectsQuery);
  return useMemo(() => {
    const n = normalizeGePhone(number);
    if (!n) return null;
    const cabin = clients.find((c) => normalizeGePhone(c.cabin_phone) === n);
    if (cabin) return { name: cabin.name, address: cabin.address, cabin: true };
    const c = clients.find((x) => normalizeGePhone(x.contact_phone_2) === n);
    if (c) return { name: c.name, address: c.address, cabin: false };
    const o = objects.find((x) => normalizeGePhone(x.client_phone) === n);
    if (o) return { name: o.client_name ?? o.name, address: o.address, cabin: false };
    return null;
  }, [number, clients, objects]);
}

export function SoftphonePanel() {
  const phone = useSoftphone();
  const [open, setOpen] = useState(false);
  const [dialNum, setDialNum] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const info = useCallerInfo(phone?.call?.number ?? null);
  useTicker(phone?.call?.phase === "active");

  useEffect(() => {
    if (phone?.call) setOpen(true);
  }, [phone?.call]);

  if (!phone) return null;
  const { status, statusDetail, online, setOnline, call } = phone;

  const dot =
    status === "ready"
      ? "bg-emerald-500"
      : status === "connecting"
        ? "bg-amber-400 animate-pulse"
        : status === "error"
          ? "bg-red-500"
          : "bg-muted-foreground/40";

  const ringing = call?.direction === "incoming" && call.phase === "ringing";

  return (
    <>
      {/* შემომავალი ზარი — სრული ეკრანის შეტყობინება */}
      {ringing ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div
            className={cn(
              "w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 text-center shadow-2xl",
              info?.cabin && "border-red-500 ring-4 ring-red-500/30",
            )}
          >
            <PhoneIncoming className="mx-auto size-10 animate-bounce text-emerald-600" />
            {info?.cabin ? (
              <div className="rounded-md bg-red-600 px-2 py-1 text-sm font-semibold text-white">
                🚨 კაბინიდან ზარი — შესაძლოა ჩარჩენილი მგზავრი
              </div>
            ) : null}
            <div>
              <div className="font-mono text-2xl font-semibold">{call.number}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {info
                  ? `${info.name}${info.address ? ` · ${info.address}` : ""}`
                  : "უცნობი აბონენტი"}
              </div>
            </div>
            <div className="flex justify-center gap-3">
              <Button
                size="lg"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={phone.answer}
              >
                <Phone className="size-4" /> პასუხი
              </Button>
              <Button size="lg" variant="destructive" onClick={phone.hangup}>
                <PhoneOff className="size-4" /> უარყოფა
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
        {open ? (
          <div className="w-72 space-y-3 rounded-xl border bg-card p-3 shadow-xl">
            <div className="flex items-center gap-2">
              <span className={cn("size-2.5 rounded-full", dot)} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">ტელეფონი</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {statusDetail || "—"}
                </div>
              </div>
              {status !== "unavailable" ? (
                <label className="flex items-center gap-1.5 text-[11px]">
                  ხაზზე
                  <Switch checked={online} onCheckedChange={setOnline} disabled={!!call} />
                </label>
              ) : null}
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => setOpen(false)}
                aria-label="დახურვა"
              >
                <X className="size-4" />
              </Button>
            </div>

            {call && call.phase !== "ringing" ? (
              <div className="space-y-3">
                <div
                  className={cn(
                    "rounded-lg p-3 text-center",
                    info?.cabin ? "bg-red-50 dark:bg-red-950/40" : "bg-muted",
                  )}
                >
                  <div className="text-[11px] text-muted-foreground">
                    {call.direction === "incoming" ? "შემომავალი" : "გამავალი"} ·{" "}
                    {call.phase === "active"
                      ? mmss(Date.now() - (call.answeredAt ?? Date.now()))
                      : call.phase === "ended"
                        ? "დასრულდა"
                        : "დაკავშირება…"}
                    {call.held ? " · დაყოვნებულია" : ""}
                  </div>
                  <div className="font-mono text-lg font-semibold">{call.number}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {info?.cabin ? "🚨 კაბინა · " : ""}
                    {info?.name ?? "უცნობი აბონენტი"}
                  </div>
                </div>
                {call.phase !== "ended" ? (
                  <>
                    <div className="grid grid-cols-4 gap-1.5">
                      <Button
                        size="sm"
                        variant={call.muted ? "default" : "outline"}
                        onClick={phone.toggleMute}
                        title="მიკროფონი"
                      >
                        {call.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant={call.held ? "default" : "outline"}
                        onClick={phone.toggleHold}
                        title="დაყოვნება"
                        disabled={call.phase !== "active"}
                      >
                        {call.held ? <Play className="size-4" /> : <Pause className="size-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant={showKeys ? "default" : "outline"}
                        onClick={() => setShowKeys((v) => !v)}
                        title="კლავიატურა"
                      >
                        <Grid3x3 className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={phone.hangup}
                        title="დასრულება"
                      >
                        <PhoneOff className="size-4" />
                      </Button>
                    </div>
                    {showKeys ? (
                      <div className="grid grid-cols-3 gap-1">
                        {KEYS.map((k) => (
                          <Button
                            key={k}
                            size="sm"
                            variant="outline"
                            onClick={() => phone.sendDtmf(k)}
                          >
                            {k}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                    {call.phase === "active" ? (
                      <form
                        className="flex gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          phone.transfer(transferTo);
                          setTransferTo("");
                        }}
                      >
                        <Input
                          className="h-8 font-mono text-xs"
                          placeholder="გადართვა: 100 ან 5xx…"
                          value={transferTo}
                          onChange={(e) => setTransferTo(e.target.value)}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          type="submit"
                          disabled={!transferTo.trim()}
                          title="გადართვა"
                        >
                          <ArrowRightLeft className="size-4" />
                        </Button>
                      </form>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  phone.dial(dialNum);
                }}
              >
                <Input
                  className="font-mono"
                  placeholder="ნომერი ან შიდა (101)"
                  value={dialNum}
                  onChange={(e) => setDialNum(e.target.value)}
                  inputMode="tel"
                />
                <div className="grid grid-cols-3 gap-1">
                  {KEYS.map((k) => (
                    <Button
                      key={k}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setDialNum((d) => d + k)}
                    >
                      {k}
                    </Button>
                  ))}
                </div>
                <Button
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  disabled={!dialNum.trim() || status !== "ready"}
                >
                  <PhoneCall className="size-4" /> დარეკვა
                </Button>
                {status !== "ready" ? (
                  <p className="text-center text-[11px] text-muted-foreground">
                    დასარეკად ჩართეთ „ხაზზე“
                  </p>
                ) : null}
              </form>
            )}
          </div>
        ) : null}

        <Button
          size="lg"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "h-12 rounded-full px-4 shadow-lg",
            call && call.phase !== "ended" ? "bg-emerald-600 hover:bg-emerald-700" : "",
          )}
          aria-label="ტელეფონი"
        >
          <span className={cn("mr-1 size-2.5 rounded-full ring-2 ring-white/60", dot)} />
          <Phone className="size-4" />
          {call && call.phase === "active" ? (
            <span className="ml-1 font-mono text-xs tabular-nums">
              {mmss(Date.now() - (call.answeredAt ?? Date.now()))}
            </span>
          ) : (
            <span className="ml-1 text-sm font-semibold">
              {status === "ready"
                ? "ტელეფონი"
                : status === "unavailable"
                  ? "ტელეფონი (გამორთ.)"
                  : "ტელეფონი"}
            </span>
          )}
        </Button>
      </div>
    </>
  );
}
