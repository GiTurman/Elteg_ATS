// ბრაუზერის ტელეფონი (WebRTC / JsSIP): შემომავალი ზარის მიღება, დარეკვა, გადართვა.
// ავტორი: Giorgi Turmanidze "GT"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import type { RTCSession } from "jssip/lib/RTCSession";
import type { UA } from "jssip/lib/UA";

import { getMySipAccount, type SipAccount } from "@/lib/softphone.functions";

export type PhoneStatus =
  | "off" // ოპერატორმა ხაზი გამორთო
  | "unavailable" // სადგური/შიდა ნომერი არ არის მითითებული
  | "connecting"
  | "ready"
  | "error";

export type CallState = {
  direction: "incoming" | "outgoing";
  number: string;
  displayName: string | null;
  phase: "ringing" | "connecting" | "active" | "ended";
  startedAt: number;
  answeredAt: number | null;
  muted: boolean;
  held: boolean;
};

type Ctx = {
  status: PhoneStatus;
  statusDetail: string;
  account: Extract<SipAccount, { ok: true }> | null;
  online: boolean;
  setOnline: (v: boolean) => void;
  call: CallState | null;
  dial: (number: string) => void;
  answer: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  transfer: (target: string) => void;
  sendDtmf: (tone: string) => void;
};

const SoftphoneContext = createContext<Ctx | null>(null);

export function useSoftphone() {
  return useContext(SoftphoneContext);
}

const ICE = [{ urls: "stun:stun.l.google.com:19302" }];
const ONLINE_KEY = "softphone_online";

/** ზარის ხმა (WebAudio, ფაილის გარეშე) */
function createRinger() {
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const beep = () => {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [freq, start] of [
      [880, 0],
      [660, 0.25],
    ] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + start);
      g.gain.exponentialRampToValueAtTime(0.25, t + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(t + start);
      o.stop(t + start + 0.25);
    }
  };
  return {
    start() {
      try {
        ctx ??= new AudioContext();
        void ctx.resume();
        beep();
        timer ??= setInterval(beep, 1500);
      } catch {
        /* ხმა მიუწვდომელია */
      }
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

function cleanNumber(n: string) {
  return n.replace(/[^0-9+*#]/g, "");
}

export function SoftphoneProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const fetchAccount = useServerFn(getMySipAccount);
  const [account, setAccount] = useState<Extract<SipAccount, { ok: true }> | null>(null);
  const [status, setStatus] = useState<PhoneStatus>("off");
  const [statusDetail, setStatusDetail] = useState("");
  const [online, setOnlineState] = useState(false);
  const [call, setCall] = useState<CallState | null>(null);

  const uaRef = useRef<UA | null>(null);
  const sessionRef = useRef<RTCSession | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringerRef = useRef<ReturnType<typeof createRinger> | null>(null);

  // ოპერატორის არჩევანი (ხაზზე ვარ / არა) ბრაუზერში ინახება
  useEffect(() => {
    try {
      setOnlineState(localStorage.getItem(ONLINE_KEY) === "1");
    } catch {
      /* private mode */
    }
  }, []);
  const setOnline = useCallback((v: boolean) => {
    setOnlineState(v);
    try {
      localStorage.setItem(ONLINE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  // SIP ანგარიში სერვერიდან
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchAccount()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setAccount(res);
        } else {
          setAccount(null);
          setStatus("unavailable");
          setStatusDetail(
            res.reason === "no_pbx"
              ? "სადგური ჯერ არ არის მიერთებული (ტელეფონია → სადგურის მისამართი)"
              : res.reason === "no_extension"
                ? "თქვენ არ გაქვთ შიდა ნომერი — მიმართეთ მენეჯერს"
                : "ტელეფონი ხელმისაწვდომია მხოლოდ ოპერატორებისთვის",
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          setStatusDetail("SIP ანგარიშის მიღება ვერ მოხერხდა");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, fetchAccount]);

  const attachRemoteAudio = useCallback((session: RTCSession) => {
    const pc = session.connection;
    if (!pc) return;
    const play = (stream: MediaStream) => {
      if (!audioRef.current) return;
      audioRef.current.srcObject = stream;
      void audioRef.current.play().catch(() => undefined);
    };
    pc.addEventListener("track", (e: RTCTrackEvent) => {
      if (e.streams[0]) play(e.streams[0]);
    });
    const receivers = pc.getReceivers?.() ?? [];
    if (receivers.length) {
      const stream = new MediaStream();
      receivers.forEach((r) => r.track && stream.addTrack(r.track));
      play(stream);
    }
  }, []);

  const bindSession = useCallback(
    (
      session: RTCSession,
      direction: "incoming" | "outgoing",
      number: string,
      displayName: string | null,
    ) => {
      // უკვე მიმდინარე ზარის დროს ახალი შემომავალი — დაკავებულია
      if (sessionRef.current && direction === "incoming") {
        session.terminate({ status_code: 486, reason_phrase: "Busy Here" });
        return;
      }
      sessionRef.current = session;
      setCall({
        direction,
        number,
        displayName,
        phase: direction === "incoming" ? "ringing" : "connecting",
        startedAt: Date.now(),
        answeredAt: null,
        muted: false,
        held: false,
      });
      if (direction === "incoming") ringerRef.current?.start();

      session.on("peerconnection", () => attachRemoteAudio(session));
      if (session.connection) attachRemoteAudio(session);

      session.on("accepted", () => {
        ringerRef.current?.stop();
        setCall((c) => (c ? { ...c, phase: "active", answeredAt: Date.now() } : c));
      });
      session.on("confirmed", () => attachRemoteAudio(session));
      const end = () => {
        ringerRef.current?.stop();
        if (sessionRef.current === session) sessionRef.current = null;
        setCall((c) => (c ? { ...c, phase: "ended" } : c));
        setTimeout(() => setCall((c) => (c?.phase === "ended" ? null : c)), 2500);
      };
      session.on("ended", end);
      session.on("failed", end);
      session.on("hold", () => setCall((c) => (c ? { ...c, held: true } : c)));
      session.on("unhold", () => setCall((c) => (c ? { ...c, held: false } : c)));
    },
    [attachRemoteAudio],
  );

  // SIP კავშირი
  useEffect(() => {
    if (!enabled || !account) return;
    if (!online) {
      setStatus("off");
      setStatusDetail("ხაზი გამორთულია");
      return;
    }
    let stopped = false;
    ringerRef.current ??= createRinger();
    setStatus("connecting");
    setStatusDetail("სადგურთან დაკავშირება…");

    void import("jssip")
      .then((mod) => {
        if (stopped) return;
        const JsSIP = mod.default ?? mod;
        JsSIP.debug.disable();
        const socket = new JsSIP.WebSocketInterface(account.wssUrl);
        const ua = new JsSIP.UA({
          sockets: [socket],
          uri: `sip:${account.extension}@${account.domain}`,
          password: account.password,
          display_name: account.displayName,
          register: true,
          session_timers: false,
          user_agent: "GT-ATS Softphone",
        });
        uaRef.current = ua;
        ua.on("registered", () => {
          setStatus("ready");
          setStatusDetail(`ხაზზე · შიდა ${account.extension}`);
        });
        ua.on("unregistered", () => {
          if (!stopped) {
            setStatus("connecting");
            setStatusDetail("კავშირი აღდგება…");
          }
        });
        ua.on("registrationFailed", (e: { cause?: string }) => {
          setStatus("error");
          setStatusDetail(`რეგისტრაცია ვერ მოხერხდა${e.cause ? `: ${e.cause}` : ""}`);
        });
        ua.on("disconnected", () => {
          if (!stopped) {
            setStatus("connecting");
            setStatusDetail("სადგურთან კავშირი გაწყდა — ხელახლა ვუკავშირდებით…");
          }
        });
        ua.on("newRTCSession", (data: { session: RTCSession; originator: "local" | "remote" }) => {
          if (data.originator !== "remote") return;
          const s = data.session;
          const num = s.remote_identity?.uri?.user ?? "უცნობი";
          bindSession(s, "incoming", num, s.remote_identity?.display_name || null);
        });
        ua.start();
      })
      .catch((e: unknown) => {
        console.error("[softphone] JsSIP load failed", e);
        setStatus("error");
        setStatusDetail("ტელეფონის მოდული ვერ ჩაიტვირთა — განაახლეთ გვერდი (F5)");
      });

    return () => {
      stopped = true;
      ringerRef.current?.stop();
      try {
        sessionRef.current?.terminate();
      } catch {
        /* already ended */
      }
      sessionRef.current = null;
      try {
        uaRef.current?.stop();
      } catch {
        /* ignore */
      }
      uaRef.current = null;
    };
  }, [enabled, account, online, bindSession]);

  // ფანჯრის დახურვისას ზარი დასრულდეს
  useEffect(() => {
    const onUnload = () => {
      try {
        sessionRef.current?.terminate();
        uaRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const dial = useCallback(
    (raw: string) => {
      const number = cleanNumber(raw);
      const ua = uaRef.current;
      if (!number) return;
      if (!ua || status !== "ready") {
        window.location.href = `tel:${number}`;
        return;
      }
      if (sessionRef.current) return;
      const session = ua.call(`sip:${number}@${account!.domain}`, {
        mediaConstraints: { audio: true, video: false },
        pcConfig: { iceServers: ICE },
      });
      bindSession(session, "outgoing", number, null);
    },
    [status, account, bindSession],
  );

  const answer = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    ringerRef.current?.stop();
    setCall((c) => (c ? { ...c, phase: "connecting" } : c));
    s.answer({
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: ICE },
    });
  }, []);

  const hangup = useCallback(() => {
    ringerRef.current?.stop();
    try {
      sessionRef.current?.terminate();
    } catch {
      setCall(null);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const muted = s.isMuted().audio;
    if (muted) s.unmute({ audio: true });
    else s.mute({ audio: true });
    setCall((c) => (c ? { ...c, muted: !muted } : c));
  }, []);

  const toggleHold = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    if (s.isOnHold().local) s.unhold();
    else s.hold();
  }, []);

  const transfer = useCallback(
    (target: string) => {
      const s = sessionRef.current;
      const t = cleanNumber(target);
      if (!s || !t || !account) return;
      s.refer(`sip:${t}@${account.domain}`);
    },
    [account],
  );

  const sendDtmf = useCallback((tone: string) => {
    try {
      sessionRef.current?.sendDTMF(tone);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      status: enabled ? status : "unavailable",
      statusDetail,
      account,
      online,
      setOnline,
      call,
      dial,
      answer,
      hangup,
      toggleMute,
      toggleHold,
      transfer,
      sendDtmf,
    }),
    [
      enabled,
      status,
      statusDetail,
      account,
      online,
      setOnline,
      call,
      dial,
      answer,
      hangup,
      toggleMute,
      toggleHold,
      transfer,
      sendDtmf,
    ],
  );

  return (
    <SoftphoneContext.Provider value={value}>
      {children}
      <audio ref={audioRef} autoPlay hidden />
    </SoftphoneContext.Provider>
  );
}
