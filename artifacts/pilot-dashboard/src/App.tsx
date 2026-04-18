import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";

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
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/lib/auth";
import Layout from "@/components/Layout";
import { HQLayout } from "@/components/HQLayout";
import LoginGate from "@/pages/Login";
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
import Currencies from "@/pages/dashboard/Currencies";
import Simulator from "@/pages/dashboard/Simulator";
import FlightRecords from "@/pages/dashboard/FlightRecords";
import FlightProgram from "@/pages/FlightProgram";

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
      <Route path="/schedule" component={Schedule} />
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
      {/* See SquadronOpsRoutes catch-all: redirect home rather than 404. */}
      <Route><Redirect to="/admin" /></Route>
    </Switch>
  );
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
      <Route path="/dashboard/currencies" component={Currencies} />
      <Route path="/dashboard/simulator" component={Simulator} />
      <Route path="/dashboard/flights" component={FlightRecords} />
      <Route path="/dashboard/flight-program" component={FlightProgram} />
      {/* See SquadronOpsRoutes catch-all: redirect home rather than 404. */}
      <Route><Redirect to="/dashboard" /></Route>
    </Switch>
  );
}

function Shell() {
  const { licensed, configured, user } = useAuth();

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
  useEffect(() => { runArchiveCheck(); }, []);
  // Wipe any leftover demo/sample data (demo pilots + demo sorties) so the
  // squadron starts with an empty dataset for real operations. Demo records
  // were tagged with importedAt === "DEMO_SEED" specifically so this single
  // call can strip them without touching anything real.
  useEffect(() => { clearDemoSeed(); }, []);
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthProvider>
          <TooltipProvider>
            {isElectron() ? (
              <WouterRouter hook={useHashLocation}>
                <Shell />
              </WouterRouter>
            ) : (
              <WouterRouter>
                <Shell />
              </WouterRouter>
            )}
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

export default App;
