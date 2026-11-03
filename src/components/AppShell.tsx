import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  CalendarDays,
  Contact,
  Headset,
  LayoutDashboard,
  LogOut,
  Menu,
  PhoneCall,
  PhoneIncoming,
  Tags,
  Users,
  UsersRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useAuth";
import { roleLabel } from "@/lib/domain";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "დაფა", icon: LayoutDashboard },
  { to: "/incoming", label: "ცხელი ხაზი", icon: PhoneIncoming },
  { to: "/calls", label: "გამოძახებები", icon: PhoneCall },
  { to: "/schedule", label: "გრაფიკი", icon: CalendarDays },
  { to: "/clients", label: "კლიენტები", icon: Contact },
  { to: "/objects", label: "ობიექტები", icon: Building2 },
  { to: "/tariffs", label: "ტარიფები", icon: Tags },
  { to: "/teams", label: "პირები/ჯგუფები", icon: UsersRound },
  { to: "/reports", label: "რეპორტები", icon: BarChart3 },
  { to: "/telephony", label: "ტელეფონია", icon: Headset },
  { to: "/users", label: "მომხმარებლები", icon: Users, managerOnly: true },
] as const;

const TECH_ALLOWED = ["/dashboard", "/calls", "/schedule"];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { isManager, isTechnician } = useCurrentUser();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {NAV.filter((i) => {
        if ("managerOnly" in i && i.managerOnly && !isManager) return false;
        if (isTechnician && !TECH_ALLOWED.includes(i.to)) return false;
        return true;
      }).map((item) => {
        const Icon = item.icon;
        const active = pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { profile, email, role } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const brand = (
    <div className="flex items-center gap-2 border-b px-4 py-3">
      <div className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
        ლფ
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">ლიფტსერვისი</div>
        <div className="text-[11px] text-muted-foreground">
          დისპეტჩერიზაციის სისტემა
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        {brand}
        <NavLinks />
        <div className="mt-auto border-t p-3">
          <div className="truncate text-sm font-medium">
            {profile?.full_name || email}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {roleLabel[role]}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={signOut}
          >
            <LogOut className="size-3.5" /> გასვლა
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="md:hidden">
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              {brand}
              <NavLinks onNavigate={() => setOpen(false)} />
              <div className="mt-auto border-t p-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={signOut}
                >
                  <LogOut className="size-3.5" /> გასვლა
                </Button>
              </div>
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">{title}</h1>
            {subtitle ? (
              <p className="truncate text-xs text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
        <main className="min-w-0 flex-1 p-3 md:p-5">{children}</main>
      </div>
    </div>
  );
}
