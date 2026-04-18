import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { useI18n, type Key as TKey } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, ListChecks, PlusCircle, Users, BadgeCheck, AlertOctagon,
  Trophy, CalendarRange, PalmtreeIcon, UserX, Calendar, ClipboardList,
  ShieldAlert, FileText, Megaphone, Map, Tags, FileDown, UserCog, Settings,
  Sun, Moon, Wifi, WifiOff, LogOut, Menu, History, Upload, HelpCircle, Archive, Bell, UserPlus,
} from "lucide-react";
import { LiveDataIndicator } from "@/components/LiveDataIndicator";

type Item = { p: string; k: TKey; I: typeof LayoutDashboard };
const ITEMS: readonly Item[] = [
  { p: "/", k: "nav_dashboard", I: LayoutDashboard },
  { p: "/sortie-log", k: "nav_sortielog", I: ListChecks },
  { p: "/sortie-add", k: "nav_addsortie", I: PlusCircle },
  { p: "/external-pilots", k: "nav_externalpilots", I: UserPlus },
  { p: "/roster", k: "nav_roster", I: Users },
  { p: "/currency", k: "nav_currency", I: BadgeCheck },
  { p: "/expired", k: "nav_expired", I: AlertOctagon },
  { p: "/rankings", k: "nav_rankings", I: Trophy },
  { p: "/cycle", k: "nav_cycle", I: CalendarRange },
  { p: "/leaves", k: "nav_leaves", I: PalmtreeIcon },
  { p: "/unavailable", k: "nav_unavail", I: UserX },
  { p: "/duty", k: "nav_duty", I: Calendar },
  { p: "/schedule", k: "nav_schedule", I: ClipboardList },
  { p: "/flight-program", k: "nav_flight_program", I: ClipboardList },
  { p: "/risk", k: "nav_risk", I: ShieldAlert },
  { p: "/coordinating", k: "nav_coord", I: FileText },
  { p: "/notams", k: "nav_notams", I: Megaphone },
  { p: "/nav-routes", k: "nav_navroutes", I: Map },
  { p: "/units", k: "nav_units", I: Tags },
  { p: "/pdf", k: "nav_pdf", I: FileDown },
  { p: "/users", k: "nav_users", I: UserCog },
  { p: "/reminders", k: "nav_reminders", I: Bell },
  { p: "/audit", k: "nav_audit", I: History },
  { p: "/import", k: "nav_import", I: Upload },
  { p: "/archives", k: "nav_archives", I: Archive },
  { p: "/help", k: "nav_help", I: HelpCircle },
  { p: "/settings", k: "nav_settings", I: Settings },
] as const;

export default function Layout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const { user, logout, squadron } = useAuth();
  const [loc] = useLocation();
  const [open, setOpen] = useState(true);
  const [online] = useState(navigator.onLine);

  return (
    <div className="min-h-screen brand-bg flex">
      {/* Sidebar */}
      <aside className={`${open ? "w-64" : "w-16"} transition-all duration-200 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0`}>
        <div className="h-16 flex items-center gap-2 px-3 border-b border-sidebar-border">
          <img src="brand/emblem.png" className="h-9 w-9 object-contain" alt="RJAF" />
          {open && (
            <div className="leading-tight">
              <div className="text-[11px] tracking-widest text-muted-foreground">RJAF</div>
              <div className="text-sm font-semibold gold-grad">{squadron?.name || "Squadron Ops"}</div>
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {ITEMS.map(({ p, k, I }) => {
            const active = loc === p || (p !== "/" && loc.startsWith(p));
            return (
              <Link key={p} href={p} className={`flex items-center gap-3 px-3 py-2 mx-2 my-0.5 rounded-md text-sm row-hover ${active ? "bg-sidebar-accent text-sidebar-primary font-medium" : "text-sidebar-foreground"}`}>
                <I className="h-4 w-4 shrink-0" />
                {open && <span className="truncate">{t(k)}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="p-2 border-t border-sidebar-border flex items-center gap-2">
          <button onClick={() => setOpen(o => !o)} className="p-2 rounded hover:bg-sidebar-accent" title="Toggle">
            <Menu className="h-4 w-4" />
          </button>
          {open && <span className="text-[10px] text-muted-foreground">v1.0.0</span>}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-16 flex items-center justify-between px-4 border-b border-border bg-card/40 backdrop-blur">
          <div className="flex items-center gap-3 min-w-0">
            <img src="brand/emblem.png" className="h-10 object-contain" alt="RJAF" />
            <div className="leading-tight min-w-0">
              <div className="title-line truncate">
                {squadron ? `${squadron.number} SQDN · ${squadron.base}` : "Squadron Operations"}
              </div>
              <div className="text-sm font-semibold truncate">{t("appTag")}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md ${online ? "text-emerald-300 bg-emerald-500/10" : "text-amber-300 bg-amber-500/10"}`}>
              {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {online ? t("online") : t("offline")}
            </span>
            <LiveDataIndicator />
            <button onClick={() => setLang(lang === "en" ? "ar" : "en")} className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary">
              {lang === "en" ? t("arabic") : t("english")}
            </button>
            <button className="p-2 rounded-md hover:bg-secondary" title="Theme (always dark)">
              <Moon className="h-4 w-4" />
              <Sun className="hidden" />
            </button>
            <div className="hidden md:flex items-center gap-2 ml-2 pl-3 border-l border-border">
              <div className="text-right rtl:text-left leading-tight" data-testid="text-signed-in-as">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("signedInAs")}</div>
                <div className="text-sm font-medium">{user?.displayName}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{user?.role}</div>
              </div>
              <button onClick={logout} className="p-2 rounded-md hover:bg-secondary" title={t("logout")}>
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  );
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
      <div>
        <h1 className="text-xl font-semibold gold-grad">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel p-4 ${className}`}>{children}</div>;
}
