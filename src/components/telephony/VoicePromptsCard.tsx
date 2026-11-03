// ხმოვანი შეტყობინებები — ტექსტი და მოსმენა
// ავტორი: Giorgi Turmanidze "GT"
// ფაილები: public/sounds/*.wav — იგივე ფაილებს უკრავს სადგური (pbx/docker-compose.yml → ../public/sounds)
import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const VOICE_PROMPTS = [
  {
    file: "recording-notice.wav",
    title: "ზარის აღებისთანავე",
    text: "გამარჯობა, თქვენ დაუკავშირდით კომპანია ელტეგს. საუბარი იწერება ხარისხის გაუმჯობესების მიზნით. თუ არ გსურთ საუბრის ჩაწერა, გთხოვთ, დაგვიკავშირდეთ ალტერნატიული საშუალებით.",
  },
  {
    file: "all-busy.wav",
    title: "თუ ვერავინ უპასუხა",
    text: "ამჟამად ყველა ოპერატორი დაკავებულია. თქვენი ზარი დაფიქსირდა და მალე დაგიკავშირდებით.",
  },
] as const;

type Status = "checking" | "ready" | "missing";

function PromptRow({ file, title, text }: (typeof VOICE_PROMPTS)[number]) {
  const src = `/sounds/${file}`;
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let alive = true;
    fetch(src, { method: "HEAD", cache: "no-store" })
      .then((r) => {
        const type = r.headers.get("content-type") ?? "";
        if (alive) setStatus(r.ok && !type.includes("text/html") ? "ready" : "missing");
      })
      .catch(() => alive && setStatus("missing"));
    return () => {
      alive = false;
    };
  }, [src]);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{title}</div>
        {status === "ready" && <Badge variant="secondary">ჩაწერილია</Badge>}
        {status === "missing" && <Badge variant="destructive">ხმოვანი ფაილი არ არის</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">„{text}“</p>
      {status === "ready" ? (
        <audio controls preload="none" src={src} className="w-full" />
      ) : (
        <p className="text-xs text-muted-foreground">
          ფაილი: <code>public/sounds/{file}</code>. სანამ ფაილი არ არის, სადგური ამ შეტყობინებას
          გამოტოვებს.
        </p>
      )}
    </div>
  );
}

export function VoicePromptsCard() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Volume2 className="h-4 w-4" /> ხმოვანი შეტყობინებები
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {VOICE_PROMPTS.map((p) => (
          <PromptRow key={p.file} {...p} />
        ))}
      </CardContent>
    </Card>
  );
}
