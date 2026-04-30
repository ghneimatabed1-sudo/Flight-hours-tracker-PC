import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation as useWouterLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import ErrorBoundary from "@/components/ErrorBoundary";

/**
 * Routing strategy:
 *
 * In Electron the app loads via `file:///C:/Program Files/.../index.html`.
 * The `pathname` of that URL is the absolute file path, NOT `/`. wouter's
 * default browser-location hook compares `window.location.pathname` against
 * route paths like "/admin/keys", so under file:// EVERY route falls
 * through to NotFound. Hash routing sidesteps this problem.
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
import { isLanSessionLoginEnabled } from "@/lib/internal-migration";
import { useIdleTimeout } from "@/lib/use-idle-timeout";
import Layout from "@/components/Layout";
import OpeningAnimation from "@/components/OpeningAnimation";
import { HQLayout } from "@/components/HQLayout";
import LoginGate from "@/pages/Login";
import FirstLaunch from "@/pages/FirstLaunch";
import JoinSetup from "@/pages/JoinSetup";
import WaitingForApproval from "@/pages/WaitingForApproval";
import SuperAdminSetup from "@/pages/SuperAdminSetup";
import { clearPendingRequest, getPendingRequest } from "@/lib/unit-join";
import Dashboard from "@/pages/Dashboard";
import SortieLog from "@/pages/SortieLog";
import AddSortie from "@/pages/AddSortie";
import ExternalPilots from "@/pages/ExternalPilots";
import Roster from "@/pages/Roster";
import PilotDetail from "@/pages/PilotDetail";
import Currency from "@/pages/Currency";
import ExpiredAfter from "@/pages/ExpiredAfter";
import Rankings from "@/pages/Rankings";
import Cycle from "@/pages/Cycle";
import Leaves from "@/pages/Leaves";
import Unavailable from "@/pages/Unavailable";
import DutyWeek from "@/pages/DutyWeek";
import Risk from "@/pages/Risk";
import Coordinating from "@/pages/Coordinating";
import NotamsPage from "@/pages/NotamsPage";
import NavRoutes from "@/pages/NavRoutes";
import Units from "@/pages/Units";
import PdfExports from "@/pages/PdfExports";
import AuditLog from "@/pages/AuditLog";
import HistoricalImport from "@/pages/HistoricalImport";
import SettingsPage from "@/pages/Settings";
import Help from "@/pages/Help";
import Archives from "@/pages/Archives";
import OpsTeam from "@/pages/OpsTeam";
import MonthlyReport from "@/pages/MonthlyReport";
import MonthlyReportDefaults from "@/pages/MonthlyReportDefaults";
import NotFound from "@/pages/not-found";
import AdminOverview from "@/pages/admin/Overview";
import AdminSquadrons from "@/pages/admin/Squadrons";
import AdminAuditLog from "@/pages/admin/AuditLog";
import AdminSecurity from "@/pages/admin/Security";
import AdminUsers from "@/pages/admin/Users";
import AdminPeerTokens from "@/pages/admin/PeerTokens";
import CommanderOverview from "@/pages/dashboard/Overview";
import PilotsTable from "@/pages/dashboard/PilotsTable";
import DashboardPilotDetail from "@/pages/dashboard/PilotDetail";
import Alerts from "@/pages/dashboard/Alerts";
import PilotAlerts from "@/pages/dashboard/PilotAlerts";
import Simulator from "@/pages/dashboard/Simulator";
import FlightRecords from "@/pages/dashboard/FlightRecords";
import StickyNotes from "@/pages/StickyNotes";
import CommanderUnavailable from "@/pages/dashboard/UnavailableView";
import CommanderCurrencies from "@/pages/dashboard/Currencies";
import { InstallProfileProvider, useInstallProfile, isAggregatorProfile } from "@/lib/install-profile";
import AggregatorOverview from "@/pages/aggregate/Overview";
import AggregatePilots from "@/pages/aggregate/Pilots";
import AggregateSorties from "@/pages/aggregate/Sorties";
import AggregateCurrencies from "@/pages/aggregate/Currencies";
import AggregateLeaves from "@/pages/aggregate/Leaves";
import AggregateUnavailable from "@/pages/aggregate/Unavailable";
import AggregateNotams from "@/pages/aggregate/Notams";
import AggregateReadiness from "@/pages/aggregate/Readiness";
import PeerSquadrons from "@/pages/admin/PeerSquadrons";

function SquadronOpsRoutes() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/sortie-log" component={SortieLog} />
      <Route path="/sortie-add" component={AddSortie} />
      <Route path="/external-pilots" component={ExternalPilots} />
      <Route path="/roster" component={Roster} />
      <Route path="/pilot/:id" component={PilotDetail} />
      <Route path="/currency" component={Currency} />
      <Route path="/expired" component={ExpiredAfter} />
      <Route path="/rankings" component={Rankings} />
      <Route path="/cycle" component={Cycle} />
      <Route path="/leaves" component={Leaves} />
      <Route path="/unavailable" component={Unavailable} />
      <Route path="/duty" component={DutyWeek} />
      <Route path="/risk" component={Risk} />
      <Route path="/coordinating" component={Coordinating} />
      <Route path="/notams" component={NotamsPage} />
      <Route path="/nav-routes" component={NavRoutes} />
      <Route path="/units" component={Units} />
      <Route path="/pdf" component={PdfExports} />
      <Route path="/audit" component={AuditLog} />
      <Route path="/import" component={HistoricalImport} />
      <Route path="/archives" component={Archives} />
      <Route path="/ops-team" component={OpsTeam} />
      <Route path="/monthly-report/defaults" component={MonthlyReportDefaults} />
      <Route path="/monthly-report" component={MonthlyReport} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/help" component={Help} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AdminRoutes() {
  return (
    <Switch>
      <Route path="/"><Redirect to="/admin" /></Route>
      <Route path="/admin" component={AdminOverview} />
      <Route path="/admin/squadrons" component={AdminSquadrons} />
      <Route path="/admin/audit" component={AdminAuditLog} />
      <Route path="/admin/security" component={AdminSecurity} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/peer-tokens" component={AdminPeerTokens} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
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
      <Route path="/dashboard/unavailable" component={CommanderUnavailableGate} />
      <Route path="/dashboard/sticky" component={StickyNotes} />
      <Route path="/alerts"><Redirect to="/dashboard/alerts" /></Route>
      <Route path="/simulator"><Redirect to="/dashboard/simulator" /></Route>
      <Route path="/sticky"><Redirect to="/dashboard/sticky" /></Route>
      <Route path="/dashboard/settings" component={SettingsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

// Aggregator-mode (Wing/Base PC) routes. Mounted in place of
// AdminRoutes / CommanderRoutes whenever `installProfile` resolves to
// `aggregator-wing` or `aggregator-base`. Every path here renders a
// fan-out read view — there are no write routes (this PC owns no
// squadron data). Super-admin operators additionally get the Peer
// Squadrons admin page so they can edit the local address book.
function AggregatorRoutes() {
  return (
    <Switch>
      <Route path="/"><Redirect to="/aggregate" /></Route>
      <Route path="/aggregate" component={AggregatorOverview} />
      <Route path="/aggregate/pilots" component={AggregatePilots} />
      <Route path="/aggregate/sorties" component={AggregateSorties} />
      <Route path="/aggregate/currencies" component={AggregateCurrencies} />
      <Route path="/aggregate/leaves" component={AggregateLeaves} />
      <Route path="/aggregate/unavailable" component={AggregateUnavailable} />
      <Route path="/aggregate/notams" component={AggregateNotams} />
      <Route path="/aggregate/readiness" component={AggregateReadiness} />
      <Route path="/admin/peer-squadrons" component={PeerSquadrons} />
      <Route path="/admin/audit" component={AdminAuditLog} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
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
  const [location] = useWouterLocation();
  const { profile } = useInstallProfile();

  useIdleTimeout(IDLE_LOGOUT_MS, () => {
    if (user) logout();
  }, !!user);

  if (!user) {
    if (isLanSessionLoginEnabled()) {
      if (getPendingRequest()) clearPendingRequest();
      return <LoginGate />;
    }
    if (location.startsWith("/join/setup")) return <JoinSetup />;
    if (location.startsWith("/join/waiting")) return <WaitingForApproval />;
    if (location.startsWith("/setup/super-admin")) return <SuperAdminSetup />;
    if (location.startsWith("/login")) return <LoginGate />;
    if (getPendingRequest()) return <WaitingForApproval />;
    return <FirstLaunch />;
  }

  if (isAggregatorProfile(profile)) {
    // On a Wing/Base PC every signed-in operator (super_admin or
    // commander) gets the aggregator shell. Squadron-tier ops users
    // who somehow log into an aggregator PC also land here — there
    // is no SquadronOpsRoutes view available because no local
    // squadron data exists on this box.
    return <HQLayout><AggregatorRoutes /></HQLayout>;
  }
  if (user.role === "super_admin") {
    return <HQLayout><AdminRoutes /></HQLayout>;
  }
  if (user.role === "commander") {
    return <HQLayout><CommanderRoutes /></HQLayout>;
  }

  // Squadron Ops users still require local license + squadron config.
  if (!configured) return <LoginGate />;
  if (!isLanSessionLoginEnabled() && !licensed) return <LoginGate />;

  return (
    <Layout>
      <ArchiveBootstrap />
      <SquadronOpsRoutes />
    </Layout>
  );
}

function ArchiveBootstrap() {
  useEffect(() => { runArchiveCheck(); }, []);
  // Wipe any leftover demo/sample data so the squadron starts with an
  // empty dataset for real operations.
  useEffect(() => { clearDemoSeed(); }, []);
  return null;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <InstallProfileProvider>
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
          </InstallProfileProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
