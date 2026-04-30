import { Link, useLocation } from "wouter";
import { type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n, type Key } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Languages, ShieldCheck, Activity, Users, Plane, ListChecks, BarChart3, AlertTriangle, Gauge, Lock, CalendarDays, UserX, StickyNote, Bell, KeyRound, Settings as SettingsIcon } from "lucide-react";
import IdentityStrip from "@/components/IdentityStrip";
import emblem from "@assets/rjaf_emblem.png";

interface NavItem {
  path: string;
  labelKey: Key;
  icon: ReactNode;
}

export function HQLayout({ children }: { children: ReactNode }) {
  const { user, logout, squadron: _squadron } = useAuth();
  void _squadron;
  const { t, lang, setLang, dir } = useI18n();
  const [location] = useLocation();

  if (!user) return <>{children}</>;

  const isAdmin = user.role === "super_admin";

  const items: NavItem[] = isAdmin
    ? [
        { path: "/admin", labelKey: "systemOverview", icon: <BarChart3 className="h-4 w-4" /> },
        { path: "/admin/squadrons", labelKey: "squadrons", icon: <Plane className="h-4 w-4" /> },
        { path: "/admin/audit", labelKey: "auditLog", icon: <ListChecks className="h-4 w-4" /> },
        { path: "/admin/security", labelKey: "nav_security", icon: <Lock className="h-4 w-4" /> },
        { path: "/admin/users", labelKey: "nav_users", icon: <Users className="h-4 w-4" /> },
        { path: "/admin/peer-tokens", labelKey: "nav_peer_tokens", icon: <KeyRound className="h-4 w-4" /> },
        { path: "/settings", labelKey: "nav_settings", icon: <SettingsIcon className="h-4 w-4" /> },
      ]
    : [
        { path: "/dashboard", labelKey: "overview", icon: <BarChart3 className="h-4 w-4" /> },
        { path: "/dashboard/pilots", labelKey: "pilots", icon: <Users className="h-4 w-4" /> },
        { path: "/dashboard/alerts", labelKey: "alerts", icon: <AlertTriangle className="h-4 w-4" /> },
        { path: "/dashboard/currencies", labelKey: "currencies", icon: <Gauge className="h-4 w-4" /> },
        ...(user.scope === "squadron"
          ? ([
              { path: "/dashboard/flights", labelKey: "flightRecords", icon: <CalendarDays className="h-4 w-4" /> },
              { path: "/dashboard/simulator", labelKey: "simulator", icon: <Gauge className="h-4 w-4" /> },
            ] satisfies NavItem[])
          : []),
        ...(user.scope === "flight"
          ? ([
              { path: "/dashboard/flights", labelKey: "flightRecords", icon: <CalendarDays className="h-4 w-4" /> },
              { path: "/dashboard/simulator", labelKey: "simulator", icon: <Gauge className="h-4 w-4" /> },
            ] satisfies NavItem[])
          : []),
        ...(user.scope === "squadron" || user.scope === "flight"
          ? ([{ path: "/dashboard/unavailable", labelKey: "nav_unavail", icon: <UserX className="h-4 w-4" /> }] satisfies NavItem[])
          : []),
        ...(user.scope === "squadron" || user.scope === "flight"
          ? ([{ path: "/dashboard/pilot-alerts", labelKey: "nav_pilot_alerts", icon: <Bell className="h-4 w-4" /> }] satisfies NavItem[])
          : []),
        { path: "/dashboard/sticky", labelKey: "nav_sticky", icon: <StickyNote className="h-4 w-4" /> },
        { path: "/dashboard/settings", labelKey: "nav_settings", icon: <SettingsIcon className="h-4 w-4" /> },
      ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground" dir={dir}>
      <header className="bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          <img src={emblem} alt="RJAF Emblem" className="h-10 w-10 object-contain" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-semibold truncate">
                {t("hqAppName")}
                <span
                  className="ms-2 text-[10px] font-normal text-sidebar-foreground/60 align-middle"
                  data-testid="title-bar-version"
                  title={`Build ${__APP_VERSION__ ?? "unknown"} · ${__GIT_SHORT_HASH__ ?? "nogit"}`}
                >
                  v{__APP_VERSION__ ?? "?"} · {__GIT_SHORT_HASH__ ?? "nogit"}
                </span>
              </h1>
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
                    className={`relative flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap hover-elevate active-elevate-2 ${
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-sidebar-foreground/85"
                    }`}
                    data-testid={`nav-${item.path.split("/").pop()}`}
                  >
                    <span className="relative shrink-0">
                      {item.icon}
                    </span>
                    <span>{t(item.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="flex-1 min-w-0 p-4 sm:p-6 space-y-4 overflow-y-auto">
          <IdentityStrip />
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
