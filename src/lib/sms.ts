// SMS შეტყობინებები — შაბლონები, ნომრები, ტრანსლიტერაცია (კლიენტსა და სერვერზე საერთო).
// ავტორი: Giorgi Turmanidze "GT"
import { normalizeGePhone } from "@/lib/telephony";
import type { CallStatus } from "@/lib/domain";

/** SMS მიიღება მხოლოდ მობილურზე: 5XXXXXXXX → 9955XXXXXXXX (smsoffice-ის ფორმატი) */
export function smsMobile(phone: string | null | undefined): string | null {
  const n = normalizeGePhone(phone);
  return n && n.startsWith("5") ? `995${n}` : null;
}

export const SMS_VARS: { key: string; desc: string }[] = [
  { key: "client", desc: "კლიენტის დასახელება" },
  { key: "package", desc: "პაკეტის დასახელება" },
  { key: "response", desc: "რეაგირების დრო (საათი)" },
  { key: "services", desc: "პაკეტში შემავალი მომსახურება" },
  { key: "hotline", desc: "ცხელი ხაზის ნომერი" },
  { key: "call_no", desc: "გამოძახების ნომერი" },
  { key: "status", desc: "გამოძახების სტატუსი" },
  { key: "address", desc: "ობიექტის მისამართი" },
  { key: "technician", desc: "ტექნიკოსის სახელი" },
];

/** {client} → მნიშვნელობა; ცარიელი მნიშვნელობა → "" და ზედმეტი ჰარები/პუნქტუაცია იწმინდება */
export function renderSms(tpl: string, vars: Record<string, string | number | null | undefined>) {
  return tpl
    .replace(/\{([a-z_]+)\}/g, (_, k: string) => {
      const v = vars[k];
      return v == null ? "" : String(v);
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([.,!?:;])/g, "$1")
    .replace(/([.,:;])\1+/g, "$1")
    .trim();
}

const GEO_LAT: Record<string, string> = {
  ა: "a",
  ბ: "b",
  გ: "g",
  დ: "d",
  ე: "e",
  ვ: "v",
  ზ: "z",
  თ: "t",
  ი: "i",
  კ: "k",
  ლ: "l",
  მ: "m",
  ნ: "n",
  ო: "o",
  პ: "p",
  ჟ: "zh",
  რ: "r",
  ს: "s",
  ტ: "t",
  უ: "u",
  ფ: "f",
  ქ: "q",
  ღ: "gh",
  ყ: "y",
  შ: "sh",
  ჩ: "ch",
  ც: "ts",
  ძ: "dz",
  წ: "w",
  ჭ: "ch",
  ხ: "kh",
  ჯ: "j",
  ჰ: "h",
  "„": '"',
  "“": '"',
  "”": '"',
  "—": "-",
  "–": "-",
  "№": "N",
};

/** ქართული → ლათინური (SMS 160 სიმბოლო 70-ის ნაცვლად — 2-3-ჯერ იაფი) */
export function translitGe(text: string): string {
  return Array.from(text, (ch) => GEO_LAT[ch] ?? ch).join("");
}

/** SMS ნაწილების რაოდენობა (GSM: 160/153, Unicode: 70/67) */
export function smsSegments(text: string): { chars: number; segments: number; unicode: boolean } {
  const unicode = /[^\x20-\x7E\n\r]/.test(text);
  const chars = Array.from(text).length;
  const [one, multi] = unicode ? [70, 67] : [160, 153];
  const segments = chars === 0 ? 0 : chars <= one ? 1 : Math.ceil(chars / multi);
  return { chars, segments, unicode };
}

export type SmsSettings = {
  enabled: boolean;
  sender: string;
  translit: boolean;
  inbound_enabled: boolean;
  inbound_template: string;
  inbound_unknown_template: string;
  dedupe_minutes: number;
  status_templates: Partial<Record<CallStatus, string>>;
  has_api_key?: boolean;
};

export const DEFAULT_SMS_SETTINGS: SmsSettings = {
  enabled: false,
  sender: "",
  translit: false,
  inbound_enabled: true,
  inbound_template:
    "{client}, თქვენ სარგებლობთ „{package}“ პაკეტით. რეაგირების დრო — {response} სთ. მომსახურება: {services}. ცხელი ხაზი: {hotline}",
  inbound_unknown_template: "",
  dedupe_minutes: 60,
  status_templates: {
    akhali: "გამოძახება №{call_no} მიღებულია. რეაგირების დრო — {response} სთ.",
    gzashi: "გამოძახება №{call_no}: ტექნიკოსი {technician} გზაშია — {address}.",
    shesrulebuli: "გამოძახება №{call_no} შესრულებულია. გმადლობთ!",
  },
};

export const SMS_SAMPLE_VARS = {
  client: "შპს მაგალითი",
  package: "პრემიუმი",
  response: 2,
  services: "24/7 ავარიული გამოძახება, თვიური მომსახურება",
  hotline: "0322077058",
  call_no: 1024,
  status: "გზაში",
  address: "ჭავჭავაძის გამზ. 1",
  technician: "გიორგი",
};
