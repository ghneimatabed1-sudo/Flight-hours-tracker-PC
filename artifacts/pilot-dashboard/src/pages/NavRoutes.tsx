import { useEffect, useMemo, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { Plus, Trash2, Map, Save, Printer, ArrowUp, ArrowDown } from "lucide-react";

/**
 * Nav Routes — manual builder.
 *
 * Up to 20 routes. Each route has a name, an ordered list of up to
 * MAX_WAYPOINTS waypoints (just the waypoint name + leg time in minutes —
 * no lat/lon, no notes), and a derived total flight time computed by
 * summing per-leg minutes the operator types into each waypoint cell.
 *
 * Each waypoint is rendered as its own row (vertical list, never side
 * by side) so the briefer reads them top-to-bottom like a flight plan
 * leg sheet.
 *
 * Stored locally so any commander/ops officer can maintain their own
 * working set on this PC; printable for crew briefs. Lat/lon and notes
 * fields on legacy stored routes are silently ignored on render but
 * preserved in the JSON so older sheets aren't destroyed.
 *
 * Storage: rjaf.navRoutes.v1
 */

const STORAGE_KEY = "rjaf.navRoutes.v1";
const MAX_ROUTES = 20;
const MAX_WAYPOINTS = 15;

interface Waypoint {
  id: string;
  name: string;
  legMin: number;
  /** Legacy fields — preserved on disk for older saves but not rendered. */
  lat?: string;
  lon?: string;
  notes?: string;
}
interface NavRoute { id: string; name: string; aircraft: string; description: string; waypoints: Waypoint[]; }

function emptyWp(): Waypoint { return { id: crypto.randomUUID(), name: "", legMin: 0 }; }
function emptyRoute(): NavRoute { return { id: crypto.randomUUID(), name: "New Route", aircraft: "UH-60M", description: "", waypoints: [emptyWp(), emptyWp()] }; }

function load(): NavRoute[] {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch { /* */ }
  return [];
}

function fmtHours(mins: number): string {
  if (!mins) return "0:00";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export default function NavRoutes() {
  const { t } = useI18n();
  const [routes, setRoutes] = useState<NavRoute[]>(() => load());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const r = load(); return r[0]?.id ?? null;
  });
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(routes)); }, [routes]);

  const active = useMemo(() => routes.find(r => r.id === activeId) ?? null, [routes, activeId]);
  const totalMin = active ? active.waypoints.reduce((a, w) => a + (Number(w.legMin) || 0), 0) : 0;

  function addRoute() {
    if (routes.length >= MAX_ROUTES) {
      alert(`Maximum ${MAX_ROUTES} routes.`);
      return;
    }
    const r = emptyRoute();
    setRoutes(prev => [...prev, r]);
    setActiveId(r.id);
  }
  function removeRoute(id: string) {
    if (!confirm("Delete this route?")) return;
    setRoutes(prev => prev.filter(r => r.id !== id));
    if (activeId === id) setActiveId(routes.find(r => r.id !== id)?.id ?? null);
  }
  function updateRoute(id: string, patch: Partial<NavRoute>) {
    setRoutes(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }
  function updateWp(routeId: string, wpId: string, patch: Partial<Waypoint>) {
    setRoutes(prev => prev.map(r => r.id !== routeId ? r : ({
      ...r,
      waypoints: r.waypoints.map(w => w.id === wpId ? { ...w, ...patch } : w),
    })));
  }
  function addWp(routeId: string) {
    setRoutes(prev => prev.map(r => {
      if (r.id !== routeId) return r;
      if (r.waypoints.length >= MAX_WAYPOINTS) {
        alert(`Maximum ${MAX_WAYPOINTS} waypoints per route.`);
        return r;
      }
      return { ...r, waypoints: [...r.waypoints, emptyWp()] };
    }));
  }
  function removeWp(routeId: string, wpId: string) {
    setRoutes(prev => prev.map(r => r.id !== routeId ? r : ({ ...r, waypoints: r.waypoints.filter(w => w.id !== wpId) })));
  }
  // Reorder helpers — required by spec ("Editable (rename, reorder, change
  // hours, delete)"). We swap adjacent elements in-place rather than using
  // drag-and-drop so the UX is keyboard- and touch-friendly without a
  // dependency on a DnD library.
  function moveRoute(id: string, dir: -1 | 1) {
    setRoutes(prev => {
      const i = prev.findIndex(r => r.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function moveWp(routeId: string, wpId: string, dir: -1 | 1) {
    setRoutes(prev => prev.map(r => {
      if (r.id !== routeId) return r;
      const i = r.waypoints.findIndex(w => w.id === wpId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= r.waypoints.length) return r;
      const wps = r.waypoints.slice();
      [wps[i], wps[j]] = [wps[j], wps[i]];
      return { ...r, waypoints: wps };
    }));
  }
  function flashSaved() { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1200); }

  return (
    <div>
      <PageHead
        title={t("nav_navroutes")}
        subtitle={`Manual route builder · up to ${MAX_ROUTES} routes`}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button size="sm" variant="outline" onClick={() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(routes)); flashSaved(); }} data-testid="button-routes-save">
              <Save className="h-4 w-4 me-1" /> Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()} data-testid="button-routes-print">
              <Printer className="h-4 w-4 me-1" /> Print
            </Button>
            <Button size="sm" onClick={addRoute} disabled={routes.length >= MAX_ROUTES} data-testid="button-add-route">
              <Plus className="h-4 w-4 me-1" /> Add Route ({routes.length}/{MAX_ROUTES})
            </Button>
            {savedFlash && <span className="self-center text-xs text-emerald-500">Saved ✓</span>}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <Card className="!p-2">
          {routes.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              <Map className="h-10 w-10 mx-auto mb-2 text-amber-400" />
              No routes yet. Click "Add Route" to build one.
            </div>
          ) : (
            <ul className="space-y-1" data-testid="list-routes">
              {routes.map((r, idx) => {
                const mins = r.waypoints.reduce((a, w) => a + (Number(w.legMin) || 0), 0);
                return (
                  <li key={r.id}>
                    <div
                      className={`w-full px-2 py-2 rounded-md flex items-center gap-1 ${activeId === r.id ? "bg-primary/20 border border-primary/40" : "hover:bg-secondary/50"}`}
                    >
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); moveRoute(r.id, -1); }}
                          disabled={idx === 0}
                          className="p-0.5 rounded hover:bg-secondary disabled:opacity-30"
                          title="Move up"
                          data-testid={`button-route-up-${r.id}`}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); moveRoute(r.id, 1); }}
                          disabled={idx === routes.length - 1}
                          className="p-0.5 rounded hover:bg-secondary disabled:opacity-30"
                          title="Move down"
                          data-testid={`button-route-down-${r.id}`}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </div>
                      <button
                        onClick={() => setActiveId(r.id)}
                        className="flex-1 min-w-0 text-left"
                        data-testid={`button-route-${r.id}`}
                      >
                        <div className="text-sm font-semibold truncate">{r.name || "Untitled"}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {r.waypoints.length} WP · {fmtHours(mins)}
                        </div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeRoute(r.id); }}
                        className="p-1 rounded hover:bg-destructive/20 text-destructive shrink-0"
                        title="Delete"
                        data-testid={`button-delete-route-${r.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {active ? (
          <Card>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <label className="text-xs"><span className="text-muted-foreground">Route Name</span>
                <input
                  value={active.name}
                  onChange={e => updateRoute(active.id, { name: e.target.value })}
                  className="w-full mt-1 px-2 py-1.5 rounded bg-input border border-border text-sm font-semibold"
                  data-testid="input-route-name"
                />
              </label>
              <label className="text-xs"><span className="text-muted-foreground">Aircraft</span>
                <input
                  value={active.aircraft}
                  onChange={e => updateRoute(active.id, { aircraft: e.target.value })}
                  className="w-full mt-1 px-2 py-1.5 rounded bg-input border border-border text-sm"
                  data-testid="input-route-aircraft"
                />
              </label>
              <label className="text-xs"><span className="text-muted-foreground">Description</span>
                <input
                  value={active.description}
                  onChange={e => updateRoute(active.id, { description: e.target.value })}
                  className="w-full mt-1 px-2 py-1.5 rounded bg-input border border-border text-sm"
                  data-testid="input-route-description"
                />
              </label>
            </div>

            {/* Vertical leg list — one waypoint per row, just the name +
                leg time. No lat/lon, no notes. Up to MAX_WAYPOINTS rows. */}
            <div>
              <table className="w-full text-sm border-collapse">
                <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left w-10">#</th>
                    <th className="px-2 py-2 text-left">Waypoint</th>
                    <th className="px-2 py-2 text-right w-28">Leg (min)</th>
                    <th className="px-2 py-2 text-right print:hidden w-32">—</th>
                  </tr>
                </thead>
                <tbody>
                  {active.waypoints.map((w, i) => (
                    <tr key={w.id} className="border-t border-border">
                      <td className="px-2 py-1 text-center font-mono text-muted-foreground">{i + 1}</td>
                      <td className="px-1 py-1">
                        <input value={w.name} onChange={e => updateWp(active.id, w.id, { name: e.target.value })}
                          placeholder={i === 0 ? "Departure" : i === active.waypoints.length - 1 ? "Destination" : "Waypoint"}
                          className="w-full px-2 py-1 rounded bg-input border border-border text-sm" data-testid={`input-wp-name-${i}`} />
                      </td>
                      <td className="px-1 py-1 text-right">
                        <input type="number" min={0} value={w.legMin}
                          onChange={e => updateWp(active.id, w.id, { legMin: Number(e.target.value) || 0 })}
                          className="w-24 px-2 py-1 rounded bg-input border border-border text-sm font-mono text-right" data-testid={`input-wp-min-${i}`} />
                      </td>
                      <td className="px-2 py-1 text-right print:hidden whitespace-nowrap">
                        <button onClick={() => moveWp(active.id, w.id, -1)}
                          disabled={i === 0}
                          className="p-1 rounded hover:bg-secondary disabled:opacity-30" title="Move up"
                          data-testid={`button-wp-up-${i}`}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => moveWp(active.id, w.id, 1)}
                          disabled={i === active.waypoints.length - 1}
                          className="p-1 rounded hover:bg-secondary disabled:opacity-30" title="Move down"
                          data-testid={`button-wp-down-${i}`}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => removeWp(active.id, w.id)}
                          className="p-1 rounded hover:bg-destructive/20 text-destructive" title="Remove waypoint"
                          data-testid={`button-remove-wp-${i}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border">
                    <td colSpan={2} className="px-2 py-2 text-right font-semibold uppercase text-xs text-muted-foreground">
                      Total flight time
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-bold gold-text" data-testid="text-route-total">{fmtHours(totalMin)}</td>
                    <td className="print:hidden" />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-3 print:hidden flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => addWp(active.id)}
                disabled={active.waypoints.length >= MAX_WAYPOINTS}
                data-testid="button-add-wp"
              >
                <Plus className="h-4 w-4 me-1" /> Add Waypoint
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {active.waypoints.length} / {MAX_WAYPOINTS} waypoints
              </span>
            </div>
          </Card>
        ) : (
          <Card className="flex flex-col items-center justify-center min-h-[40vh] text-center">
            <Map className="h-12 w-12 text-amber-400 mb-2" />
            <div className="text-sm text-muted-foreground">Select a route from the left, or click <strong>Add Route</strong>.</div>
          </Card>
        )}
      </div>
    </div>
  );
}
