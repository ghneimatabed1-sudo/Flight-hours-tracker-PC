import { type ReactNode, useMemo, useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import {
  useRegisteredPCs,
  getFlightBinding,
  setFlightBinding,
  type FlightBinding,
} from "@/lib/cross-pc";
import { Button } from "@/components/ui/button";
import { Plane, Link2, RefreshCcw } from "lucide-react";

// Gate that the Flight Commander PC must pass through before any
// dashboard surface is reachable. It pins this PC to ONE specific
// Squadron Commander PC. Once chosen, every cross-PC surface (schedule
// sharing recipient picker, messages composer) automatically reshapes
// to address only that squadron commander — the operator never has to
// pick a recipient again. The binding lives in localStorage on this
// PC; the squadron commander needs no advance setup.
export function FlightBindingGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isFlight = user?.role === "commander" && user?.scope === "flight";
  const registry = useRegisteredPCs();
  const [binding, setBinding] = useState<FlightBinding | null>(() => getFlightBinding());
  const [pick, setPick] = useState<string>("");

  // Re-sync from localStorage whenever the gate mounts (e.g. after a
  // sign-out / sign-in cycle). The component instance can persist across
  // navigations so the explicit re-read keeps the UI honest.
  useEffect(() => {
    setBinding(getFlightBinding());
  }, [user?.username]);

  const squadronPCs = useMemo(
    () => registry.data
      .filter(p => !p.isSelf && p.tier === "squadron")
      .sort((a, b) => a.squadronName.localeCompare(b.squadronName)),
    [registry.data],
  );

  if (!isFlight) return <>{children}</>;
  if (binding) return <>{children}</>;

  const confirmPick = () => {
    const target = squadronPCs.find(p => p.id === pick);
    if (!target) return;
    const next: FlightBinding = { pcId: target.id, pcName: target.squadronName };
    setFlightBinding(next);
    setBinding(next);
  };

  return (
    <div className="max-w-2xl mx-auto mt-6 rounded-md border border-border bg-card p-6 space-y-4" data-testid="flight-binding-gate">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-emerald-500/15 text-emerald-500 p-2">
          <Plane className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="text-base font-semibold flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Bind this Flight Commander PC to a Squadron
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
            Choose the Squadron Commander PC this flight reports to. After
            you confirm, every cross-PC surface on this PC — schedule
            sharing, private messages — will automatically address only
            that squadron commander. You don't have to pick a recipient
            again. You can change the binding from the toolbar later.
          </p>
        </div>
      </div>

      <div className="rounded-md border border-border bg-background/40 p-3 space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Squadron Commander PCs detected
        </div>
        {registry.isLoading ? (
          <div className="text-sm text-muted-foreground py-3">Looking for Squadron Commander PCs…</div>
        ) : squadronPCs.length === 0 ? (
          <div className="text-sm text-muted-foreground py-3">
            No Squadron Commander PC has come online yet. Ask the squadron
            commander to sign in once on their PC, then refresh.
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={() => registry.refetch()} data-testid="button-binding-refresh">
                <RefreshCcw className="h-3.5 w-3.5 me-1" /> Refresh
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {squadronPCs.map(p => (
              <label
                key={p.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer border ${
                  pick === p.id
                    ? "border-emerald-500/60 bg-emerald-500/10"
                    : "border-transparent hover:bg-secondary/40"
                }`}
                data-testid={`option-bind-${p.id}`}
              >
                <input
                  type="radio"
                  name="bind-pick"
                  value={p.id}
                  checked={pick === p.id}
                  onChange={() => setPick(p.id)}
                />
                <span className="font-medium">{p.squadronName}</span>
                <span className="text-[11px] text-muted-foreground ms-auto">
                  {p.online ? <span className="text-emerald-500">● online</span> : <span>● offline</span>}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={confirmPick}
          disabled={!pick}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
          data-testid="button-confirm-binding"
        >
          Bind & continue
        </Button>
      </div>
    </div>
  );
}

// Small toolbar control letting a flight commander operator review and
// change the current binding (e.g. after a squadron rename). Mounts
// only on flight-scope PCs that already have a binding — first-run
// setup goes through FlightBindingGate above.
export function FlightBindingBadge() {
  const { user } = useAuth();
  const isFlight = user?.role === "commander" && user?.scope === "flight";
  const [binding, setBinding] = useState<FlightBinding | null>(() => getFlightBinding());
  if (!isFlight || !binding) return null;
  const change = () => {
    if (!confirm(`Unbind from "${binding.pcName}" and pick a different Squadron Commander PC?`)) return;
    setFlightBinding(null);
    setBinding(null);
    // Force a soft reload so the gate component re-mounts.
    window.location.reload();
  };
  return (
    <button
      onClick={change}
      className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-secondary/40 hover:bg-secondary"
      data-testid="badge-flight-binding"
      title="Click to change the bound Squadron Commander PC"
    >
      <Link2 className="h-3 w-3" /> Bound to: <span className="font-semibold">{binding.pcName}</span>
    </button>
  );
}
