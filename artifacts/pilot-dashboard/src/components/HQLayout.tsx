import { Link, useLocation } from "wouter";
import { type ReactNode, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n, type Key } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Languages, ShieldCheck, Activity, KeyRound, Users, Plane, ListChecks, BarChart3, AlertTriangle, AlarmClock, Gauge, Lock, CalendarDays, ClipboardList, UserX, StickyNote, Mail, Share2 } from "lucide-react";
import { canUseMessages, canUseScheduleChain, registerLocalPC, purgeExpiredMessages, type PcTier } from "@/lib/cross-pc";
import emblem from "@assets/rjaf_emblem.png";
import { RecoveryCodesLowBanner } from "@/components/RecoveryCodesLowBanner";

interface NavItem {
  path: string;
  labelKey: Key;
  icon: ReactNode;
}

export function HQLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { t, lang, setLang, dir } = useI18n();
  const [location] = useLocation();

  // Cross-PC heartbeat for commander tiers. The id is tier-prefixed
  // (e.g. "WING:NWAC", "BASE:Marka") so wing/base PCs are distinct
  // entries in the registry and the schedule sharing chain can pick
  // them as forward targets without colliding with squadron PCs.
  useEffect(() => {
    if (!user || user.role !== "commander") return;
    const scope = user.scope;
    if (!scope) return;
    const tier: PcTier =
      scope === "wing" ? "wing"
      : scope === "base" ? "base"
      : scope === "squadron" ? "squadron"
      : "hq";
    const displayName = user.displayName || `${tier.toUpperCase()} CMD`;
    const id = tier === "squadron" ? displayName : `${tier.toUpperCase()}:${displayName}`;
    const tick = () => {
      registerLocalPC({ id, displayName, tier });
      purgeExpiredMessages();
    };
    tick();
    const handle = window.setInterval(tick, 30_000);
    return () => window.clearInterval(handle);
  }, [user?.role, user?.scope, user?.displayName]);

  if (!user) return <>{children}</>;

  const isAdmin = user.role === "super_admin";

  const items: NavItem[] = isAdmin
    ? [
        { path: "/admin", labelKey: "systemOverview", icon: <BarChart3 className="h-4 w-4" /> },
        { path: "/admin/keys", labelKey: "licenseKeys", icon: <KeyRound className="h-4 w-4" /> },
        { path: "/admin/commanders", labelKey: "commanders", icon: <Users className="h-4 w-4" /> },
        { path: "/admin/squadrons", labelKey: "squadrons", icon: <Plane className="h-4 w-4" /> },
        { path: "/admin/reminders", labelKey: "remindersSchedule", icon: <AlarmClock className="h-4 w-4" /> },
        { path: "/admin/audit", labelKey: "auditLog", icon: <ListChecks className="h-4 w-4" /> },
        { path: "/admin/security", labelKey: "nav_security", icon: <Lock className="h-4 w-4" /> },
      ]
    : [
        { path: "/dashboard", labelKey: "overview", icon: <BarChart3 className="h-4 w-4" /> },
        { path: "/dashboard/pilots", labelKey: "pilots", icon: <Users className="h-4 w-4" /> },
        { path: "/dashboard/alerts", labelKey: "alerts", icon: <AlertTriangle className="h-4 w-4" /> },
        { path: "/dashboard/currencies", labelKey: "currencies", icon: <Gauge className="h-4 w-4" /> },
        // Squadron-scope commanders can browse the sorties the ops officer
        // has entered, filterable by day. Intentionally hidden for HQ / base
        // / wing scope (they don't own a single squadron's local data store).
        ...(user.scope === "squadron"
          ? [
              { path: "/dashboard/flights", labelKey: "flightRecords" as Key, icon: <CalendarDays className="h-4 w-4" /> },
              { path: "/dashboard/flight-program", labelKey: "nav_flight_program" as Key, icon: <ClipboardList className="h-4 w-4" /> },
              { path: "/dashboard/simulator", labelKey: "simulator" as Key, icon: <Gauge className="h-4 w-4" /> },
            ]
          : []),
        // Squadron + Flight commanders get a read-only Unavailable list
        // (see who in the squadron is on leave / grounded). Wing / base /
        // HQ scope skip it — they don't drill into a single squadron's
        // operational availability from this surface.
        ...(user.scope === "squadron" || user.scope === "flight"
          ? [{ path: "/dashboard/unavailable", labelKey: "nav_unavail" as Key, icon: <UserX className="h-4 w-4" /> }]
          : []),
        // Sticky notes calendar is a per-PC scratchpad for every commander.
        { path: "/dashboard/sticky", labelKey: "nav_sticky" as Key, icon: <StickyNote className="h-4 w-4" /> },
        // Flight Schedule creation is squadron-level only. Flight / wing /
        // base / HQ-scope commanders don't own a specific squadron's daily
        // sheet so they don't get this page in their sidebar.
        ...(canUseScheduleChain(user.role, user.scope)
          ? [{ path: "/dashboard/schedule-chain", labelKey: "nav_schedule_chain" as Key, icon: <Share2 className="h-4 w-4" /> }]
          : []),
        ...(canUseMessages(user.role, user.scope)
          ? [{ path: "/dashboard/messages", labelKey: "nav_messages" as Key, icon: <Mail className="h-4 w-4" /> }]
          : []),
      ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground" dir={dir}>
      <header className="bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          <img src={emblem} alt="RJAF Emblem" className="h-10 w-10 object-contain" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-semibold truncate">{t("hqAppName")}</h1>
              {isAdmin ? (
                <Badge className="bg-amber-500 text-amber-950 hover:bg-amber-500">
                  <ShieldCheck className="h-3 w-3 me-1" />{t("superAdminPanel")}
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-sidebar-accent text-sidebar-accent-foreground">
                  <Activity className="h-3 w-3 me-1" />{t("commanderDashboard")}
                </Badge>
              )}
            </div>
            <p className="text-xs text-sidebar-foreground/70 truncate">
              {t("signedInAs")}: <span className="font-medium">{user.displayName}</span>
              {!isAdmin && user.scope && (
                <> · {t(("scope" + user.scope.charAt(0).toUpperCase() + user.scope.slice(1)) as Key)}</>
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            className="text-sidebar-foreground hover-elevate"
            data-testid="button-lang"
          >
            <Languages className="h-4 w-4 me-1" />{t("langToggle")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="text-sidebar-foreground hover-elevate"
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4 me-1" />{t("signOut")}
          </Button>
        </div>
        <div className="px-4 sm:px-6 pb-2 -mt-1 flex items-center justify-end">
          <span
            className="text-[10px] uppercase tracking-[0.18em] font-medium bg-gradient-to-r from-amber-300 via-amber-100 to-amber-300 bg-clip-text text-transparent select-none"
            data-testid="text-credit"
          >
            Developed by Capt. ABEDALQADER GHUNMAT
          </span>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row">
        <nav className="md:w-60 bg-sidebar border-b md:border-b-0 md:border-e border-sidebar-border">
          <ul className="flex md:flex-col overflow-x-auto md:overflow-visible p-2 gap-1">
            {items.map(item => {
              const isActive = location === item.path || (item.path !== "/admin" && item.path !== "/dashboard" && location.startsWith(item.path));
              const isExactRoot = (item.path === "/admin" || item.path === "/dashboard") && location === item.path;
              const active = isActive || isExactRoot;
              return (
                <li key={item.path}>
                  <Link
                    href={item.path}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap hover-elevate active-elevate-2 ${
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-sidebar-foreground/85"
                    }`}
                    data-testid={`nav-${item.path.split("/").pop()}`}
                  >
                    {item.icon}
                    <span>{t(item.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="flex-1 min-w-0 p-4 sm:p-6 space-y-4 overflow-y-auto">
          {isAdmin && <RecoveryCodesLowBanner />}
          {children}
        </main>
      </div>

      <footer className="border-t border-border bg-card px-4 py-2 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 items-center justify-between">
        <span>{t("classifiedFooter")}</span>
        <span>{t("sessionTimeout")}</span>
      </footer>
    </div>
  );
}
