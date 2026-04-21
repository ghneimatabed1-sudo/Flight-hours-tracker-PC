import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import ErrorBoundary from "@/components/ErrorBoundary";

/**
 * Routing strategy:
 *
 * In Electron the app loads via `file:///C:/Program Files/.../index.html`.
 * The `pathname` of that URL is the absolute file path, NOT `/`. wouter's
 * default browser-location hook compares `window.location.pathname` against
 * route paths like "/admin/keys", so under file:// EVERY route falls
 * through to NotFound. (This was the v1.0.7/v1.0.8 "404 Page Not Found"
 * bug — sidebar rendered, but every link inside an <Switch> 404'd.)
 *
 * Hash-based routing sidesteps the problem entirely: URLs become
 * `index.html#/admin/keys` and only the part after `#` is used for matching.
 * That works identically whether we're served from file://, http://, or a
 * proxied path-prefix like /pilot-dashboard/.
 *
 * Hash routing is safe in dev too — the dev server URL just becomes
 * http://localhost:5173/#/something, and Vite still serves index.html.
 */
function isElectron(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "file:";
}
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { runArchiveCheck } from "@/lib/archive";
import { clearDemoSeed } from "@/lib/squadron-data";
import { Toaster } from "@/components/ui/toaster";
import { UndoToast } from "@/components/UndoToast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useIdleTimeout } from "@/lib/use-idle-timeout";
import Layout from "@/components/Layout";
import OpeningAnimation from "@/components/OpeningAnimation";
import { HQLayout } from "@/components/HQLayout";
import LoginGate from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import SortieLog from "@/pages/SortieLog";
import AddSortie from "@/pages/AddSortie";
import ExternalPilots from "@/pages/ExternalPilots";
import PendingApprovals from "@/pages/PendingApprovals";
import GuestBackfill from "@/pages/GuestBackfill";
import Messages from "@/pages/Messages";
import ScheduleChain from "@/pages/ScheduleChain";
import { registerLocalPC, purgeExpiredMessages, getLocalPcId, setLocalPcId, getDeviceSuffix, publishSquadronFlightGroup, getLatestSquadronFlightGroup, type PcTier } from "@/lib/cross-pc";
import Roster from "@/pages/Roster";
import PilotDetail from "@/pages/PilotDetail";
import Currency from "@/pages/Currency";
import ExpiredAfter from "@/pages/ExpiredAfter";
import Rankings from "@/pages/Rankings";
import Cycle from "@/pages/Cycle";
import Leaves from "@/pages/Leaves";
import Unavailable from "@/pages/Unavailable";
import DutyWeek from "@/pages/DutyWeek";
import Schedule from "@/pages/Schedule";
import Risk from "@/pages/Risk";
import Coordinating from "@/pages/Coordinating";
import NotamsPage from "@/pages/NotamsPage";
import NavRoutes from "@/pages/NavRoutes";
import Units from "@/pages/Units";
import PdfExports from "@/pages/PdfExports";
import Users from "@/pages/Users";
import AuditLog from "@/pages/AuditLog";
import HistoricalImport from "@/pages/HistoricalImport";
import SettingsPage from "@/pages/Settings";
import Help from "@/pages/Help";
import Reminders from "@/pages/Reminders";
import Archives from "@/pages/Archives";
import OpsTeam from "@/pages/OpsTeam";
import MonthlyReport from "@/pages/MonthlyReport";
import NotFound from "@/pages/not-found";
import AdminOverview from "@/pages/admin/Overview";
import LicenseKeys from "@/pages/admin/LicenseKeys";
import Commanders from "@/pages/admin/Commanders";
import AdminSquadrons from "@/pages/admin/Squadrons";
import AdminAuditLog from "@/pages/admin/AuditLog";
import AdminSecurity from "@/pages/admin/Security";
import RemindersSchedule from "@/pages/admin/RemindersSchedule";
import ReminderLog from "@/pages/admin/ReminderLog";
import CommanderOverview from "@/pages/dashboard/Overview";
import PilotsTable from "@/pages/dashboard/PilotsTable";
import DashboardPilotDetail from "@/pages/dashboard/PilotDetail";
import Alerts from "@/pages/dashboard/Alerts";
import PilotAlerts from "@/pages/dashboard/PilotAlerts";
import Simulator from "@/pages/dashboard/Simulator";
import FlightRecords from "@/pages/dashboard/FlightRecords";
import FlightProgram from "@/pages/FlightProgram";
import StickyNotes from "@/pages/StickyNotes";
import CommanderUnavailable from "@/pages/dashboard/UnavailableView";
import CommanderCurrencies from "@/pages/dashboard/Currencies";

function SquadronOpsRoutes() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/sortie-log" component={SortieLog} />
      <Route path="/sortie-add" component={AddSortie} />
      <Route path="/external-pilots" component={ExternalPilots} />
      <Route path="/pending/backfill" component={GuestBackfill} />
      <Route path="/pending" component={PendingApprovals} />
      <Route path="/schedule-chain" component={ScheduleChain} />
      <Route path="/messages" component={Messages} />
      <Route path="/roster" component={Roster} />
      <Route path="/pilot/:id" component={PilotDetail} />
      <Route path="/currency" component={Currency} />
      <Route path="/expired" component={ExpiredAfter} />
      <Route path="/rankings" component={Rankings} />
      <Route path="/cycle" component={Cycle} />
      <Route path="/leaves" component={Leaves} />
      <Route path="/unavailable" component={Unavailable} />
      <Route path="/duty" component={DutyWeek} />
      {/* Daily Missions (/schedule) was retired in the April 2026 field-use
          review. The route was previously kept mounted as a dead link to
          satisfy old bookmarks, but the reviewer flagged it as still
          accessible — so it now redirects to the Flight Program which
          replaced its workflow. */}
      <Route path="/schedule">{() => { window.location.replace("/flight-program"); return null; }}</Route>
      <Route path="/flight-program" component={FlightProgram} />
      <Route path="/risk" component={Risk} />
      <Route path="/coordinating" component={Coordinating} />
      <Route path="/notams" component={NotamsPage} />
      <Route path="/nav-routes" component={NavRoutes} />
      <Route path="/units" component={Units} />
      <Route path="/pdf" component={PdfExports} />
      <Route path="/users" component={Users} />
      <Route path="/audit" component={AuditLog} />
      <Route path="/reminders" component={Reminders} />
      <Route path="/import" component={HistoricalImport} />
      <Route path="/archives" component={Archives} />
      <Route path="/ops-team" component={OpsTeam} />
      <Route path="/monthly-report" component={MonthlyReport} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/help" component={Help} />
      {/* Catch-all: silently redirect to Dashboard instead of showing 404.
          This handles role transitions where the previous user (e.g.
          super_admin browsing /admin/keys) signs out and a different role
          (e.g. ops) signs in — the hash from the prior session is no
          longer valid in this route table, but landing on a 404 is a
          worse experience than landing on the home page. */}
      <Route><Redirect to="/" /></Route>
    </Switch>
  );
}

function AdminRoutes() {
  return (
    <Switch>
      <Route path="/"><Redirect to="/admin" /></Route>
      <Route path="/admin" component={AdminOverview} />
      <Route path="/admin/keys" component={LicenseKeys} />
      <Route path="/admin/commanders" component={Commanders} />
      <Route path="/admin/squadrons" component={AdminSquadrons} />
      <Route path="/admin/audit" component={AdminAuditLog} />
      <Route path="/admin/security" component={AdminSecurity} />
      <Route path="/admin/reminders" component={RemindersSchedule} />
      <Route path="/admin/reminders/log" component={ReminderLog} />
      {/* Settings page (auto-updater toggle + "Check for app update" button)
          is shared with SquadronOpsRoutes. The HQ sidebar links to /settings
          so super_admin users need this route mounted here too — without it
          the catch-all below was silently redirecting clicks back to
          /admin, making the Settings entry appear broken. */}
      <Route path="/settings" component={SettingsPage} />
      {/* See SquadronOpsRoutes catch-all: redirect home rather than 404. */}
      <Route><Redirect to="/admin" /></Route>
    </Switch>
  );
}

// Route-level guard for the read-only Unavailable list. Sidebar already
// hides the entry for HQ / wing / base scopes; this guard makes a direct
// URL hit (#/dashboard/unavailable) bounce back to the overview so the
// scope restriction can't be bypassed by typing the URL.
function CommanderUnavailableGate() {
  const { user } = useAuth();
  if (user?.scope !== "squadron" && user?.scope !== "flight") {
    return <Redirect to="/dashboard" />;
  }
  return <CommanderUnavailable />;
}

function CommanderRoutes() {
  return (
    <Switch>
      <Route path="/"><Redirect to="/dashboard" /></Route>
      <Route path="/dashboard" component={CommanderOverview} />
      <Route path="/dashboard/pilots" component={PilotsTable} />
      <Route path="/dashboard/squadron/:id" component={PilotsTable} />
      <Route path="/dashboard/pilot/:id" component={DashboardPilotDetail} />
      <Route path="/dashboard/alerts" component={Alerts} />
      <Route path="/dashboard/currencies" component={CommanderCurrencies} />
      <Route path="/dashboard/pilot-alerts" component={PilotAlerts} />
      <Route path="/dashboard/simulator" component={Simulator} />
      <Route path="/dashboard/flights" component={FlightRecords} />
      <Route path="/dashboard/flight-program" component={FlightProgram} />
      <Route path="/dashboard/unavailable" component={CommanderUnavailableGate} />
      <Route path="/dashboard/sticky" component={StickyNotes} />
      <Route path="/dashboard/schedule-chain" component={ScheduleChain} />
      <Route path="/dashboard/messages" component={Messages} />
      {/* Settings (auto-updater toggle + "Check for app update" button) is
          available to every commander scope so flight / wing / base / HQ
          PCs can pull the same updates as the ops PC without ever touching
          the Super Admin panel. Mounted under both /settings and
          /dashboard/settings so links from either layout resolve. */}
      <Route path="/dashboard/settings" component={SettingsPage} />
      <Route path="/settings" component={SettingsPage} />
      {/* See SquadronOpsRoutes catch-all: redirect home rather than 404. */}
      <Route><Redirect to="/dashboard" /></Route>
    </Switch>
  );
}

// 30 minutes of no input → automatic sign-out. Applies to every signed-in
// role (super admin, commander, ops). The hook is gated on `enabled` so it
// only runs while a user is actually signed in — no point arming a timer
// when the login gate is showing.
const IDLE_LOGOUT_MS = 30 * 60 * 1000;

function Shell() {
  const { licensed, configured, user, logout } = useAuth();

  useIdleTimeout(IDLE_LOGOUT_MS, () => {
    if (user) logout();
  }, !!user);

  if (!user) return <LoginGate />;

  if (user.role === "super_admin") {
    return <HQLayout><AdminRoutes /></HQLayout>;
  }
  if (user.role === "commander") {
    return <HQLayout><CommanderRoutes /></HQLayout>;
  }

  // Squadron Ops users still require local license + squadron config.
  if (!licensed || !configured) return <LoginGate />;

  return (
    <Layout>
      <ArchiveBootstrap />
      <SquadronOpsRoutes />
    </Layout>
  );
}

function ArchiveBootstrap() {
  const auth = useAuth();
  useEffect(() => { runArchiveCheck(); }, []);
  // Wipe any leftover demo/sample data (demo pilots + demo sorties) so the
  // squadron starts with an empty dataset for real operations. Demo records
  // were tagged with importedAt === "DEMO_SEED" specifically so this single
  // call can strip them without touching anything real.
  useEffect(() => { clearDemoSeed(); }, []);
  // Cross-PC registry heartbeat — single source of truth for "this PC is
  // online and reachable as id X at tier T". Runs for every signed-in role
  // except super_admin (admins don't represent a PC in the cross-PC mesh).
  // Pings every 30s so other PCs see us as online in their pickers/chains.
  //
  // The id MUST be stable across logins on this PC — other PCs forward
  // schedules / address messages to whichever id this PC was first
  // registered under, so changing it on every mount silently strands the
  // PC's inbound traffic at the old id. We therefore prefer the configured
  // squadron/wing/base code (set at setup time, not the free-form display
  // name), then the already-registered id, then fall back to the username.
  //
  // Tier is derived from role/scope:
  //   - commander + scope: flight | squadron | wing | base | hq
  //   - ops officer: squadron (Ops Pilot's PC lives at squadron tier)
  //
  // Purges expired private messages on the same cadence (cheap
  // localStorage sweep, capped at the user-configured retention window).
  const role = auth.user?.role;
  const scope = auth.user?.scope;
  const username = auth.user?.username;
  const displayNameRaw = auth.user?.displayName;
  const sqnName = auth.squadron?.name;
  const sqnBase = auth.squadron?.base;
  useEffect(() => {
    if (!role) return;
    if (role === "super_admin") return; // admins have no PC identity
    const tier: PcTier =
      role === "commander"
        ? (scope === "wing" ? "wing"
          : scope === "base" ? "base"
          : scope === "flight" ? "flight"
          : scope === "hq" ? "hq"
          : "squadron")
        : "squadron"; // ops officer
    const configuredCode = sqnName?.trim() || "";
    const existingId = getLocalPcId();
    // Squadron tier covers TWO physically distinct PCs in the same
    // squadron — the ops PC (role === "ops") and the squadron commander
    // PC (role === "commander", scope === "squadron"). They must NOT
    // share a registry id or their heartbeats overwrite each other and
    // the picker dropdowns only show one of them. The ops PC keeps the
    // canonical squadron-name id (so wing/base shares route here for
    // chain ops); the squadron commander PC gets a SQDNCMD: prefix so
    // it appears as its own selectable PC with its own device name and
    // its own online indicator.
    const isSqnCommander = role === "commander" && scope === "squadron";
    const tierPrefix = isSqnCommander
      ? "SQDNCMD:"
      : `${tier.toUpperCase()}:`;
    const isCanonicalSquadron = tier === "squadron" && !isSqnCommander;
    const existingMatchesTier = isCanonicalSquadron
      ? existingId !== "" && !existingId.includes(":")
      : existingId.startsWith(tierPrefix);
    // Persisted id always wins. This guarantees one physical PC keeps the
    // SAME registry id across restarts, account changes, and account
    // re-issues — no second row appearing in the picker, no orphaned
    // claim row in xpc_user_pcs, no flight binding breaking when an
    // operator updates their display name. The persistence happens at
    // the bottom of this block via setLocalPcId(id).
    let id: string;
    if (existingMatchesTier && existingId) {
      id = existingId;
    } else if (configuredCode || username) {
      // Logical base = squadron code if configured, else the auth
      // username. The canonical ops PC keeps the bare logical base — its
      // id IS the squadron's address that other PCs route to. Every
      // other tier (squadron commander, flight, wing, base, HQ) appends
      // a stable per-machine suffix so two PCs sharing the same account
      // (e.g. two flight commander offices) stay distinguishable in the
      // picker and never overwrite each other's registry row.
      const logicalBase = (configuredCode || username) as string;
      if (isCanonicalSquadron) {
        id = logicalBase;
      } else {
        id = `${tierPrefix}${logicalBase}#${getDeviceSuffix()}`;
      }
    } else {
      return; // no usable id yet — wait for next render
    }
    // Persist the resolved id so subsequent boots reuse it verbatim. The
    // condition prevents a needless write when the id is already cached.
    if (id !== existingId) setLocalPcId(id);
    const displayName =
      configuredCode || displayNameRaw || username || `${tier.toUpperCase()} PC`;
    // Default the PC's device label to the user's account display name
    // if the operator never set a custom one in Setup → Security. Without
    // this, every PC in a squadron showed just the squadron code (e.g.
    // "NO.8 · offline") in the recipient pickers and operators couldn't
    // tell which physical PC was which. The custom name in
    // `rjaf.pcDeviceName` still wins when present — we only fill the
    // empty case so this never overwrites an explicit operator choice.
    try {
      const currentDevName = (localStorage.getItem("rjaf.pcDeviceName") ?? "").trim();
      const fallback = (displayNameRaw || username || "").trim();
      if (!currentDevName && fallback) {
        localStorage.setItem("rjaf.pcDeviceName", fallback);
      }
    } catch { /* localStorage blocked — registry just shows the code */ }
    const tick = () => {
      registerLocalPC({ id, displayName, tier, base: sqnBase });
      purgeExpiredMessages();
      // Squadron commanders re-broadcast their flight-commander group on
      // every heartbeat so any flight PC coming online later picks up the
      // binding within 30s. Ops PCs (tier === "squadron" but
      // role === "ops") are excluded — only the actual squadron COMMANDER
      // owns the group definition. Empty lists skip the broadcast so we
      // don't publish a no-op event every 30s.
      try {
        const isSquadronCommander =
          role === "commander" && scope === "squadron";
        if (isSquadronCommander) {
          // Pull the latest admin-published group for this squadron and
          // adopt it locally so edits made from Super Admin → Squadrons
          // (another PC) converge here too. Without this, the commander
          // PC's next broadcast would overwrite the admin's change with
          // its own stale localStorage copy. The local copy wins only
          // when no remote group exists yet.
          void (async () => {
            try {
              const remote = await getLatestSquadronFlightGroup(id);
              if (remote) {
                localStorage.setItem(
                  "rjaf.linkedFlightPcIds",
                  JSON.stringify(remote.flightPcIds),
                );
              }
            } catch { /* offline ok */ }
            try {
              const raw = localStorage.getItem("rjaf.linkedFlightPcIds");
              const ids: string[] = raw ? JSON.parse(raw) : [];
              if (Array.isArray(ids) && ids.length > 0) {
                void publishSquadronFlightGroup(id, displayName, ids);
              }
            } catch { /* ignore */ }
          })();
        }
      } catch { /* ignore parse / storage errors */ }
    };
    tick();
    const handle = window.setInterval(tick, 30_000);
    return () => window.clearInterval(handle);
  }, [role, scope, username, displayNameRaw, sqnName, sqnBase]);
  return null;
}

function App() {
  // The OUTER ErrorBoundary catches crashes in any provider (QueryClient,
  // I18n, Auth, Tooltip) — without it a provider crash silently unmounts
  // the entire app and the user sees only the dark-navy body bg ("blue
  // empty screen"). The INNER ErrorBoundary (around the router) catches
  // page-level render crashes and resets on hashchange so navigating to
  // a different page recovers without a reload.
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <AuthProvider>
            <TooltipProvider>
              <ErrorBoundary>
                {isElectron() ? (
                  <WouterRouter hook={useHashLocation}>
                    <Shell />
                  </WouterRouter>
                ) : (
                  <WouterRouter>
                    <Shell />
                  </WouterRouter>
                )}
              </ErrorBoundary>
              <Toaster />
              <OpeningAnimation />
              <UndoToast />
            </TooltipProvider>
          </AuthProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
