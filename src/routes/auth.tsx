import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "შესვლა — ლიფტსერვისი დისპეტჩერიზაცია" },
      {
        name: "description",
        content: "ლიფტებისა და ესკალატორების სერვისის დისპეტჩერიზაციის სისტემაში შესვლა.",
      },
      { property: "og:title", content: "შესვლა — ლიფტსერვისი" },
      {
        property: "og:description",
        content: "სერვისის გამოძახებების მართვის შიდა სისტემა.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate({ to: "/dashboard", replace: true });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        if (data.session) {
          navigate({ to: "/dashboard", replace: true });
        } else {
          toast.success(
            "მოთხოვნა გაგზავნილია. დაადასტურეთ ელფოსტა — წვდომას მენეჯერი გაგიაქტიურებთ.",
          );
          setMode("signin");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "დაფიქსირდა უცნობი შეცდომა");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            ლფ
          </div>
          <CardTitle className="text-lg">ლიფტსერვისი</CardTitle>
          <CardDescription>ლიფტებისა და ესკალატორების სერვისის დისპეტჩერიზაცია</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">შესვლა</TabsTrigger>
              <TabsTrigger value="signup">წვდომის მოთხოვნა</TabsTrigger>
            </TabsList>
          </Tabs>

          <form onSubmit={submit} className="mt-4 space-y-3">
            {mode === "signup" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name">სახელი და გვარი</Label>
                  <Input
                    id="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
              </>
            ) : null}
            {mode === "signup" ? (
              <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                ახალი ანგარიში სისტემაზე წვდომას მიიღებს მხოლოდ მას შემდეგ, რაც მენეჯერი მიანიჭებს
                როლს.
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="email">ელფოსტა</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">პაროლი</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {mode === "signin" ? "შესვლა" : "მოთხოვნის გაგზავნა"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
