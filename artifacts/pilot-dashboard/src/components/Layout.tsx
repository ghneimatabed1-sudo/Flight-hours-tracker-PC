import { ReactNode, useEffect, useState, type HTMLAttributes } from "react";
import { Link, useLocation } from "wouter";
import { useI18n, type Key as TKey } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, ListChecks, PlusCircle, Users, BadgeCheck,
  Trophy, CalendarRange, PalmtreeIcon, UserX, Calendar, ClipboardList,
  ShieldAlert, FileText, Megaphone, Map, Tags, FileDown, Settings,
  Sun, Moon, Wifi, WifiOff, LogOut, Menu, History, Upload, HelpCircle,
  Archive,
  // These icons MUST be aliased (not imported under their original
  // names). Vite/Rollup's name-mangling step in production builds leaves
  // certain lucide-react identifiers — Inbox, Mail, Share2, UserPlus,
  // Users2, FileBarChart — un-renamed in the output, which then references
  // a global that doesn't exist at runtime → "ReferenceError: Inbox is
  // not defined" and the entire renderer fails to mount (black screen).
  // Aliasing forces the minifier to bind the import to the local name
  // properly. DO NOT REVERT to the bare import without verifying the
  // built bundle no longer contains the literal names.
  UserPlus as UserPlusIcon,
  Users2 as Users2Icon,
  FileBarChart as FileBarChartIcon,
} from "lucide-react";
import { SquadronScopePicker } from "@/components/SquadronScopePicker";
import IdentityStrip from "@/components/IdentityStrip";

type Item = { p: string; k: TKey; I: typeof LayoutDashboard };
const ITEMS: readonly Item[] = [
  { p: "/", k: "nav_dashboard", I: LayoutDashboard },
  { p: "/sortie-log", k: "nav_sortielog", I: ListChecks },
  { p: "/sortie-add", k: "nav_addsortie", I: PlusCircle },
  { p: "/external-pilots", k: "nav_externalpilots", I: UserPlusIcon },
  { p: "/roster", k: "nav_roster", I: Users },
  { p: "/currency", k: "nav_currency", I: BadgeCheck },
  { p: "/rankings", k: "nav_rankings", I: Trophy },
  { p: "/cycle", k: "nav_cycle", I: CalendarRange },
  { p: "/leaves", k: "nav_leaves", I: PalmtreeIcon },
  { p: "/unavailable", k: "nav_unavail", I: UserX },
  { p: "/duty", k: "nav_duty", I: Calendar },
  { p: "/risk", k: "nav_risk", I: ShieldAlert },
  { p: "/coordinating", k: "nav_coord", I: FileText },
  { p: "/notams", k: "nav_notams", I: Megaphone },
  { p: "/nav-routes", k: "nav_navroutes", I: Map },
  { p: "/units", k: "nav_units", I: Tags },
  { p: "/pdf", k: "nav_pdf", I: FileDown },
  { p: "/audit", k: "nav_audit", I: History },
  { p: "/import", k: "nav_import", I: Upload },
  { p: "/archives", k: "nav_archives", I: Archive },
  { p: "/ops-team", k: "nav_opsteam", I: Users2Icon },
  { p: "/monthly-report", k: "nav_monthly_report", I: FileBarChartIcon },
  { p: "/help", k: "nav_help", I: HelpCircle },
  { p: "/settings", k: "nav_settings", I: Settings },
] as const;

export default function Layout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const { user, logout, squadron } = useAuth();
  const [loc] = useLocation();
  const [open, setOpen] = useState(true);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  const linkLabel = online ? t("online") : t("offline");
  const linkCls = online
    ? "text-emerald-300 bg-emerald-500/10"
    : "text-rose-300 bg-rose-500/15";

  // Theme: dark (default — military) or light (daylight / briefing room).
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    const saved = window.localStorage.getItem("rjaf.theme");
    return saved === "light" ? "light" : "dark";
  });
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
    try { window.localStorage.setItem("rjaf.theme", theme); } catch { /* storage may be blocked */ }
  }, [theme]);

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
          {ITEMS.filter(({ p }) => {
            if (p === "/ops-team") {
              return user?.role === "ops";
            }
            if (p === "/monthly-report") {
              return user?.role === "ops";
            }
            return true;
          }).map(({ p, k, I }) => {
            const active = loc === p || (p !== "/" && loc.startsWith(p));
            return (
              <Link
                key={p}
                href={p}
                className={`relative flex items-center gap-3 px-3 py-2 mx-2 my-0.5 rounded-md text-sm row-hover ${active ? "bg-sidebar-accent text-sidebar-primary font-medium" : "text-sidebar-foreground"}`}
                data-testid={`nav-${p.replace(/^\//, "") || "home"}`}
              >
                <span className="relative shrink-0">
                  <I className="h-4 w-4" />
                </span>
                {open && <span className="truncate">{t(k)}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="p-2 border-t border-sidebar-border flex items-center gap-2">
          <button onClick={() => setOpen(o => !o)} className="p-2 rounded hover:bg-sidebar-accent" title="Toggle">
            <Menu className="h-4 w-4" />
          </button>
          <button
            onClick={logout}
            aria-label={t("logout")}
            className={`rounded hover:bg-sidebar-accent ${
              open ? "px-2 py-1.5 inline-flex items-center gap-2 text-xs border border-sidebar-border" : "p-2"
            }`}
            title={t("logout")}
            data-testid="button-sidebar-logout"
          >
            <LogOut className="h-4 w-4" />
            {open && <span>{t("logout")}</span>}
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
            <span
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md ${linkCls}`}
              data-testid="badge-link-state"
              data-state={online ? "green" : "red"}
              aria-label={`Connection ${linkLabel}`}
            >
              {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {linkLabel}
            </span>
            <SquadronScopePicker />
            <button onClick={() => setLang(lang === "en" ? "ar" : "en")} className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary">
              {lang === "en" ? t("arabic") : t("english")}
            </button>
            <button
              className="p-2 rounded-md hover:bg-secondary"
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              data-testid="button-theme-toggle"
              data-print-hide
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={logout}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary"
              title={t("logout")}
              data-testid="button-topbar-logout"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t("logout")}
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
        <IdentityStrip />
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

export function Card({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`panel p-4 ${className}`} {...rest}>
      {children}
    </div>
  );
}
