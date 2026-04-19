import { useMemo, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import {
  usePendingApprovals,
  useDecidePending,
  type PendingSortie,
} from "@/lib/cross-pc";
import { useToast } from "@/hooks/use-toast";
import { useCreateSortie, usePilots } from "@/lib/squadron-data";
import { fmtDateTimeDDMM } from "@/lib/format";
import { matchGuestPilot } from "@/lib/match-guest-pilot";
import { Inbox, Check, X, PauseCircle, Pencil } from "lucide-react";

// Pending Approvals — home-squadron ops officer reviews sorties that
// another (hosting) squadron logged for one of her pilots. Accept cascades
// through the local calc engine via useCreateSortie; reject / hold / edit
// propagate the decision back through the cross-PC layer.
export default function PendingApprovals() {
  const { user, squadron } = useAuth();
  const { toast } = useToast();
  // The local PC's "home squadron id" is the configured squadron's name —
  // good enough for the localStorage simulation. When the central server is
  // wired up this becomes a real squadron uuid.
  const homeSquadronId = squadron?.name ?? null;
  const pendingQ = usePendingApprovals(homeSquadronId);
  const decide = useDecidePending();
  const createSortie = useCreateSortie();
  const { data: PILOTS } = usePilots();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  // Per-row pilot mapping: the home ops officer must pick which local
  // roster pilot the guest entry should be credited to before the
  // cascade. Defaults to a fuzzy name match when one exists.
  const [pilotChoice, setPilotChoice] = useState<Record<string, string>>({});

  const pilotOpts = useMemo(
    () => PILOTS.map(p => ({
      value: p.id,
      // Show the military number alongside the name so the ops officer can
      // tell apart roster pilots that share a name (e.g. multiple "Ahmad
      // Khalil"s) at a glance from the dropdown.
      label: `${p.rank} ${p.name}${p.militaryNumber ? ` · #${p.militaryNumber}` : ""}`,
    })),
    [PILOTS],
  );
  const matchFor = (row: PendingSortie) =>
    matchGuestPilot(PILOTS, {
      name: row.guestPilotName,
      militaryNumber: row.guestPilotMilitaryNumber,
    });

  const decideAndCascade = async (row: PendingSortie, action: "accepted" | "rejected" | "deleted" | "edited", reason?: string) => {
    if (action === "accepted") {
      const pickId = pilotChoice[row.id] ?? matchFor(row)?.id ?? "";
      if (!pickId) {
        toast({
          title: "Pick a local pilot first",
          description: "Map the guest to one of your roster pilots so totals and currencies credit the right person.",
          variant: "destructive",
        });
        return;
      }
      // Stamp the resolved local pilot id onto the right seat so the
      // calc engine credits the correct totals/currencies/captain hours.
      const cascade = {
        ...row.sortie,
        pilotId: row.guestSeat === "pilot" ? pickId : row.sortie.pilotId,
        coPilotId: row.guestSeat === "coPilot" ? pickId : row.sortie.coPilotId,
        // Clear the external marker on the accepted local copy — the
        // hours now belong to a real local pilot.
        pilotExternal: row.guestSeat === "pilot" ? undefined : row.sortie.pilotExternal,
        coPilotExternal: row.guestSeat === "coPilot" ? undefined : row.sortie.coPilotExternal,
      };
      // Cascade through the local calc engine: writing the sortie locally
      // bumps totals, currencies, captain hours and the audit trail via
      // squadron-data.useCreateSortie's existing pipeline.
      await createSortie.mutateAsync(cascade);
    }
    await decide.mutateAsync({
      id: row.id,
      decision: action,
      decidedBy: user?.username ?? "ops",
      reason,
    });
    toast({ title: `Marked ${action}` });
  };

  return (
    <div>
      <PageHead
        title="Pending Approvals"
        subtitle={`Cross-squadron sorties awaiting your review · ${pendingQ.data.length} pending`}
      />
      {pendingQ.data.length === 0 ? (
        <Card>
          <div className="text-sm text-muted-foreground text-center py-10 inline-flex items-center gap-2 w-full justify-center">
            <Inbox className="h-4 w-4" /> No pending cross-squadron sorties.
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {pendingQ.data.map(row => {
            const open = expanded === row.id;
            const s = row.sortie;
            const time = (s.time ?? s.actual ?? 0).toFixed(1);
            return (
              <Card key={row.id} className="!p-0 overflow-hidden" data-testid={`pending-${row.id}`}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : row.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/30 text-left"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-amber-200 truncate">
                      {row.guestPilotName}
                      {row.guestPilotMilitaryNumber ? <span className="text-xs text-muted-foreground"> · #{row.guestPilotMilitaryNumber}</span> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      hosted by <span className="text-foreground">{row.hostingSquadronName}</span> · {s.date} · {s.acType} {s.acNumber} · {time}h {s.condition}
                    </div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30">PENDING</span>
                </button>
                {open && (
                  <div className="border-t border-border p-4 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <Field label="Sortie type" value={s.sortieType} />
                      <Field label="Mission / duty" value={s.msnDuty || s.name || "—"} />
                      <Field label="Condition" value={s.condition || "—"} />
                      <Field label="Time" value={`${time} hrs`} />
                      <Field label="Day" value={(s.day1 + s.day2 + s.dayDual).toFixed(1)} />
                      <Field label="Night" value={(s.night1 + s.night2 + s.nightDual).toFixed(1)} />
                      <Field label="NVG" value={(s.nvg ?? 0).toFixed(1)} />
                      <Field label="Submitted" value={fmtDateTimeDDMM(row.submittedAt)} />
                    </div>
                    {s.remarks && (
                      <div className="text-xs">
                        <div className="text-muted-foreground mb-1">Remarks</div>
                        <div className="bg-secondary/30 rounded p-2 whitespace-pre-wrap">{s.remarks}</div>
                      </div>
                    )}
                    <div className="border border-border rounded p-2 bg-secondary/20">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        Credit hours / currencies to local pilot
                      </div>
                      <select
                        value={pilotChoice[row.id] ?? matchFor(row)?.id ?? ""}
                        onChange={e => setPilotChoice(c => ({ ...c, [row.id]: e.target.value }))}
                        className="w-full px-2 py-1.5 rounded-md bg-input border border-border text-xs"
                        data-testid={`pilot-pick-${row.id}`}
                      >
                        <option value="">— pick a roster pilot —</option>
                        {pilotOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        onClick={() => decideAndCascade(row, "accepted")}
                        disabled={decide.isPending || createSortie.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 text-xs font-semibold hover:bg-emerald-500/30 disabled:opacity-50"
                        data-testid={`accept-${row.id}`}
                      >
                        <Check className="h-3.5 w-3.5" /> Accept · cascade hours & currency
                      </button>
                      <button
                        onClick={() => { setReasonFor(row.id); setReasonText(""); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-500/20 border border-rose-400/40 text-rose-100 text-xs font-semibold hover:bg-rose-500/30"
                        data-testid={`reject-${row.id}`}
                      >
                        <X className="h-3.5 w-3.5" /> Reject
                      </button>
                      <button
                        onClick={() => decide.mutateAsync({ id: row.id, decision: "edited", decidedBy: user?.username ?? "ops" }).then(() => toast({ title: "Returned to host with edits" }))}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary border border-border text-xs hover:bg-secondary/80"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit & return
                      </button>
                      <button
                        onClick={() => decideAndCascade(row, "deleted")}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary border border-border text-xs hover:bg-secondary/80"
                      >
                        <PauseCircle className="h-3.5 w-3.5" /> Drop
                      </button>
                    </div>
                    {reasonFor === row.id && (
                      <div className="border border-border rounded p-3 bg-rose-500/5">
                        <div className="text-xs text-rose-100 mb-1">Reason (sent back to {row.hostingSquadronName})</div>
                        <textarea
                          value={reasonText}
                          onChange={e => setReasonText(e.target.value)}
                          rows={2}
                          className="w-full text-xs bg-input border border-border rounded p-2"
                          placeholder="e.g. duplicate of sortie #1234"
                          data-testid={`reason-${row.id}`}
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => decideAndCascade(row, "rejected", reasonText.trim() || undefined).then(() => { setReasonFor(null); setReasonText(""); })}
                            className="px-3 py-1 rounded-md bg-rose-500/30 border border-rose-400/40 text-rose-100 text-xs font-semibold"
                          >Send rejection</button>
                          <button
                            onClick={() => { setReasonFor(null); setReasonText(""); }}
                            className="px-3 py-1 rounded-md bg-secondary border border-border text-xs"
                          >Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}
