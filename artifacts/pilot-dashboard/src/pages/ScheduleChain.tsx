import { useMemo, useState } from "react";
import DateInput from "@/components/DateInput";
import { Card, PageHead } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import {
  useScheduleShares,
  useSubmitSchedule,
  useDecideSchedule,
  useAcceptScheduleEdit,
  useRegisteredPCs,
  diffSchedule,
  canUseScheduleChain,
  getLocalPcId,
  type ScheduleRow,
  type ScheduleShare,
  type ScheduleProgram,
  type ScheduleProgramRow,
} from "@/lib/cross-pc";
import { useToast } from "@/hooks/use-toast";
import { usePilots } from "@/lib/squadron-data";
import FlightScheduleSheet from "@/components/FlightScheduleSheet";
import { Send, Check, X, PauseCircle, Pencil, Plus, Printer, Trash2 } from "lucide-react";

// Mirror of the helper in pages/FlightProgram.tsx — flattens an
// ScheduleProgram into the compact row list the diff machinery uses.
function programToShareRows(p: ScheduleProgram): ScheduleRow[] {
  const rows: ScheduleProgramRow[] = [...p.dayRows, ...p.nightRows];
  return rows
    .filter(r => r.acType.trim() || r.pilot.trim() || r.msnDuty.trim() || r.toTime.trim())
    .map((r, i) => ({
      id:       `R-${i}`,
      ac:       `${r.acType}${r.dn ? ` ${r.dn}` : ""}`.trim(),
      config:   r.configuration,
      route:    r.route ?? "",
      crew:     [r.pilot, r.coPilot].filter(Boolean),
      mission:  r.msnDuty,
      takeoff:  r.toTime || r.atcTakeoff,
      land:     r.atcLanding,
      fuel:     r.fuel,
    }));
}

// Flight Schedule Sharing Chain — Squadron → Wing → Base. Each PC is named
// in the share dialog; tier order is enforced (no skipping). Edits default
// to going back to the originator. Diff is highlighted on screen and
// stripped on print via the .no-print-diff class (Tailwind print: prefix).

const blankRow = (): ScheduleRow => ({
  id: `R-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  ac: "", config: "", route: "", crew: [], mission: "", takeoff: "", land: "", fuel: "",
});

export default function ScheduleChain() {
  const { user, squadron } = useAuth();
  const { toast } = useToast();
  const allowed = canUseScheduleChain(user?.role, user?.scope);
  // v1.0.45: "flight" is now a first-class schedule-chain tier so a
  // Flight Commander PC can compose & submit a sortie schedule to the
  // parent Squadron, and receive shares back from the Squadron.
  const myTier: "flight" | "squadron" | "wing" | "base" =
    user?.scope === "flight" ? "flight"
    : user?.scope === "wing" ? "wing"
    : user?.scope === "base" ? "base"
    : "squadron";
  // Canonical PC id from registerLocalPC. Squadron tier uses the squadron
  // name; commander tiers use a tier-prefixed id (FLIGHT:..., WING:...,
  // BASE:...) so the chain reader (incoming filter) sees what the
  // upstream writer (forward target) addressed.
  const canonicalId = getLocalPcId();
  const fallbackId = myTier === "squadron"
    ? (squadron?.name ?? user?.username ?? "")
    : `${myTier.toUpperCase()}:${user?.displayName ?? user?.username ?? "CMD"}`;
  const myPcId = canonicalId || fallbackId || null;
  const myPcName = squadron?.name ?? user?.displayName ?? "Local PC";

  const sharesQ = useScheduleShares(myPcId);
  const registry = useRegisteredPCs();
  const submit = useSubmitSchedule();
  const decide = useDecideSchedule();
  const acceptEdits = useAcceptScheduleEdit();
  const pilotsQ = usePilots();
  const pilotOptions = useMemo(
    () => pilotsQ.data.map(p => ({ value: p.name, label: `${p.rank} ${p.name}` })),
    [pilotsQ.data],
  );

  const [draftRows, setDraftRows] = useState<ScheduleRow[]>([blankRow()]);
  const [draftDate, setDraftDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitTo, setSubmitTo] = useState("");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [forwardTo, setForwardTo] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  // Per-share local edit buffers — when an incoming share carries a
  // full program snapshot we let the reviewer edit it in place, then
  // Save & return ships the revised program back to the originator.
  const [editBuffer, setEditBuffer] = useState<Record<string, ScheduleProgram>>({});

  // Chain targets:
  //   Squadron tier → may compose to Wing (up-chain) OR to Flight
  //                    (down-chain, so a Flight Cmdr sees tomorrow's
  //                    programme in their inbox and can return edits).
  //   Wing tier     → forwards approved programmes to Base.
  //   Flight tier   → composes and submits back to Squadron.
  //   Base tier     → terminal.
  // Hide PCs that haven't reported in 30 days from the composer dropdowns
  // so the picker stays scannable at 100+ PC deployments where some rows
  // are retired or reimaged. Linked-flight bindings bypass this filter
  // (a freshly reimaged flight PC is never invisible to its squadron).
  const STALE_CUTOFF_MS = Date.now() - 30 * 86_400_000;
  const isFresh = (p: { lastSeen: string }) =>
    new Date(p.lastSeen).getTime() >= STALE_CUTOFF_MS;
  const sortByName = <T extends { deviceName?: string; squadronName: string }>(arr: T[]): T[] =>
    [...arr].sort((a, b) =>
      (a.deviceName || a.squadronName).localeCompare(b.deviceName || b.squadronName),
    );
  const wingPCs = useMemo(
    () => sortByName(registry.data.filter(p => !p.isSelf && p.tier === "wing" && isFresh(p))),
    [registry.data],
  );
  const basePCs = useMemo(
    () => sortByName(registry.data.filter(p => !p.isSelf && p.tier === "base" && isFresh(p))),
    [registry.data],
  );
  // Squadron commanders explicitly link specific flight commander PCs at
  // setup time. When that linkage exists on this PC, narrow the down-chain
  // composer list to just those — otherwise fall back to every registered
  // flight PC (legacy behaviour for pre-linkage installs).
  const linkedFlightPcIds = useMemo<string[]>(() => {
    try {
      const raw = localStorage.getItem("rjaf.linkedFlightPcIds");
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }, []);
  const flightPCs = useMemo(
    () => {
      // Linked flight PCs always show even if they've been quiet for 30
      // days — the binding is explicit and operators expect to see them.
      // Other flight PCs are filtered by the staleness cutoff so the list
      // stays manageable in 100+ PC environments.
      const all = registry.data.filter(p => !p.isSelf && p.tier === "flight");
      if (myTier === "squadron" && linkedFlightPcIds.length > 0) {
        return sortByName(all.filter(p => linkedFlightPcIds.includes(p.id)));
      }
      return sortByName(all.filter(isFresh));
    },
    [registry.data, myTier, linkedFlightPcIds],
  );
  const squadronPCs = useMemo(
    () => sortByName(registry.data.filter(p => !p.isSelf && p.tier === "squadron" && isFresh(p))),
    [registry.data],
  );
  // Which PCs may this tier address on the composer? Squadron composers
  // see both Wing (up-chain) and Flight (down-chain). Flight composers
  // see Squadron PCs.
  const composeTargets = useMemo(() => {
    if (myTier === "flight") return squadronPCs;
    if (myTier === "squadron") return [...wingPCs, ...flightPCs];
    return [];
  }, [myTier, squadronPCs, wingPCs, flightPCs]);

  if (!allowed) {
    return (
      <div>
        <PageHead title="Flight Schedule Sharing" />
        <Card>
          <div className="text-sm text-muted-foreground py-6 text-center">
            Schedule sharing is reserved for Flight Commander, Squadron, Wing and Base tiers.
          </div>
        </Card>
      </div>
    );
  }

  const updateRow = (id: string, patch: Partial<ScheduleRow>) =>
    setDraftRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  const removeRow = (id: string) => setDraftRows(rs => rs.filter(r => r.id !== id));

  const submitDraft = async () => {
    const target = registry.data.find(p => p.id === submitTo);
    if (!target) { toast({ title: "Pick a recipient PC", variant: "destructive" }); return; }
    const valid = draftRows.filter(r => r.ac.trim() || r.mission.trim());
    if (valid.length === 0) { toast({ title: "Add at least one row", variant: "destructive" }); return; }
    // IMPORTANT: pass the chosen target's actual tier so the recipient's
    // inbox filter (incoming where current_tier === their tier) lights up
    // the share. Previously this defaulted to "wing", which hid
    // squadron→flight shares from Flight Commanders.
    await submit.mutateAsync({
      date: draftDate,
      originSquadronId: myPcId ?? "self",
      originSquadronName: myPcName,
      rows: valid,
      targetPcId: target.id,
      targetPcName: target.squadronName,
      targetTier: target.tier as "flight" | "squadron" | "wing" | "base",
      submittedBy: user?.username ?? "ops",
    });
    toast({ title: `Schedule sent to ${target.squadronName}` });
    setDraftRows([blankRow()]);
    setSubmitTo("");
  };

  const incoming = sharesQ.data.filter(s => s.currentPcId === myPcId);
  const sent = sharesQ.data.filter(s => s.originSquadronId === myPcId && s.currentPcId !== myPcId);

  return (
    <div>
      <PageHead
        title="Flight Schedule Sharing"
        subtitle={`Chain: Flight ↔ Squadron → Wing → Base · this PC: ${myPcName} (${myTier})`}
      />

      {/* Compose new schedule — available to Squadron and Flight tiers.
          Squadron composers pick a Wing PC (up-chain) or a Flight PC
          (down-chain). Flight composers pick a Squadron PC. */}
      {(myTier === "squadron" || myTier === "flight") && (
        <Card className="mb-3">
          <div className="text-sm font-semibold mb-2">Compose & submit</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
            <div>
              <label className="text-[11px] text-muted-foreground">Date</label>
              <DateInput value={draftDate} onChange={setDraftDate} className="w-full mt-1 px-3 py-1.5 rounded-md bg-input border border-border text-sm" data-testid="input-draft-date" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] text-muted-foreground">
                {myTier === "flight"
                  ? "Send to (Squadron PC)"
                  : "Send to (Wing or Flight PC)"}
              </label>
              <select value={submitTo} onChange={e => setSubmitTo(e.target.value)} className="w-full mt-1 px-3 py-1.5 rounded-md bg-input border border-border text-sm" data-testid="select-target">
                <option value="">
                  {myTier === "flight"
                    ? "— pick a registered Squadron PC —"
                    : "— pick a registered Wing or Flight PC —"}
                </option>
                {composeTargets.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.deviceName || p.squadronName}
                    {p.tier === "flight" ? " · flight" : p.tier === "wing" && p.wing ? ` · ${p.wing}` : ""}
                    {p.online ? " · online" : " · offline"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-1 text-left">A/C</th><th className="px-1 text-left">Pilot</th><th className="px-1 text-left">Co-Pilot</th><th className="px-1 text-left">Config</th><th className="px-1 text-left">Route</th><th className="px-1 text-left">Mission</th><th className="px-1 text-left">Takeoff</th><th className="px-1 text-left">Land</th><th className="px-1 text-left">Fuel</th><th /></tr>
              </thead>
              <tbody>
                {draftRows.map(r => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-1"><input value={r.ac} onChange={e => updateRow(r.id, { ac: e.target.value })} className="w-20 px-1 py-1 bg-input border border-border rounded text-xs font-mono" /></td>
                    <td className="p-1"><input value={r.crew[0] ?? ""} onChange={e => updateRow(r.id, { crew: [e.target.value, r.crew[1] ?? ""].filter((v, i) => v || i === 0) })} className="w-32 px-1 py-1 bg-input border border-border rounded text-xs" placeholder="Pilot" data-testid="input-draft-pilot" /></td>
                    <td className="p-1"><input value={r.crew[1] ?? ""} onChange={e => updateRow(r.id, { crew: [r.crew[0] ?? "", e.target.value].filter((v, i) => v || i === 0) })} className="w-32 px-1 py-1 bg-input border border-border rounded text-xs" placeholder="Co-Pilot" data-testid="input-draft-copilot" /></td>
                    <td className="p-1"><input value={r.config} onChange={e => updateRow(r.id, { config: e.target.value })} className="w-24 px-1 py-1 bg-input border border-border rounded text-xs" /></td>
                    <td className="p-1"><input value={r.route ?? ""} onChange={e => updateRow(r.id, { route: e.target.value })} className="w-32 px-1 py-1 bg-input border border-border rounded text-xs" placeholder="OJAM-OJAQ" data-testid="input-draft-route" /></td>
                    <td className="p-1"><input value={r.mission} onChange={e => updateRow(r.id, { mission: e.target.value })} className="w-32 px-1 py-1 bg-input border border-border rounded text-xs" /></td>
                    <td className="p-1"><input value={r.takeoff} onChange={e => updateRow(r.id, { takeoff: e.target.value })} className="w-16 px-1 py-1 bg-input border border-border rounded text-xs font-mono" placeholder="0800" /></td>
                    <td className="p-1"><input value={r.land} onChange={e => updateRow(r.id, { land: e.target.value })} className="w-16 px-1 py-1 bg-input border border-border rounded text-xs font-mono" placeholder="0930" /></td>
                    <td className="p-1"><input value={r.fuel} onChange={e => updateRow(r.id, { fuel: e.target.value })} className="w-16 px-1 py-1 bg-input border border-border rounded text-xs font-mono" /></td>
                    <td className="p-1"><button onClick={() => removeRow(r.id)} className="p-1 text-muted-foreground hover:text-rose-300"><Trash2 className="h-3 w-3" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={() => setDraftRows(rs => [...rs, blankRow()])} className="px-3 py-1.5 rounded-md bg-secondary border border-border text-xs inline-flex items-center gap-1" data-testid="add-row">
              <Plus className="h-3 w-3" /> Add row
            </button>
            <button onClick={submitDraft} disabled={submit.isPending} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50" data-testid="button-submit-schedule">
              <Send className="h-3 w-3" /> {myTier === "flight" ? "Submit to Squadron" : "Submit"}
            </button>
          </div>
        </Card>
      )}

      {/* Wing/Base see which downstream squadron PCs are currently
          registered, so they know which units may originate shares. */}
      {(myTier === "wing" || myTier === "base") && (
        <Card className="mb-3">
          <div className="text-sm font-semibold mb-2">Registered Squadron PCs ({squadronPCs.length})</div>
          {squadronPCs.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">No squadron PC has registered yet.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {squadronPCs.map(p => (
                <span
                  key={p.id}
                  className="text-[11px] px-2 py-1 rounded bg-sky-500/15 text-sky-200 border border-sky-400/30"
                  data-testid={`sqn-pc-${p.id}`}
                  title={`Last seen ${new Date(p.lastSeen).toLocaleString()}`}
                >
                  {p.squadronName}
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Incoming for this PC */}
      <Card className="mb-3">
        <div className="text-sm font-semibold mb-2">Incoming · awaiting your action ({incoming.length})</div>
        {incoming.length === 0 ? (
          <div className="text-xs text-muted-foreground py-3">Nothing waiting.</div>
        ) : (
          <div className="space-y-2">
            {incoming.map(share => {
              const open = reviewing === share.id;
              return (
                <div key={share.id} className="border border-border rounded-md" data-testid={`incoming-${share.id}`}>
                  <button type="button" onClick={() => setReviewing(open ? null : share.id)} className="w-full px-3 py-2 flex items-center justify-between hover:bg-secondary/30 text-left">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-sky-500/20 text-sky-200 border border-sky-400/30 font-semibold whitespace-nowrap" data-testid={`origin-sqn-${share.id}`}>
                        {share.originSquadronName}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{share.date}</div>
                        <div className="text-[11px] text-muted-foreground">{share.rows.length} sortie{share.rows.length === 1 ? "" : "s"} · status {share.status}</div>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30">{share.currentTier}</span>
                  </button>
                  {open && (
                    <div className="border-t border-border p-3 space-y-3">
                      {share.program ? (
                        <FlightScheduleSheet
                          prog={editBuffer[share.id] ?? share.program}
                          onChange={editBuffer[share.id]
                            ? (next) => setEditBuffer(b => ({ ...b, [share.id]: next }))
                            : undefined}
                          pilotOptions={pilotOptions}
                          statusLabel={editBuffer[share.id] ? "EDITING" : share.status.toUpperCase()}
                          approvedAt={share.approvedAt}
                          approvedBy={share.approvedBy}
                        />
                      ) : (
                        <ScheduleTable share={share} />
                      )}
                      <div className="flex flex-wrap gap-2 items-end">
                        {/* Wing tier: when the wing commander approves a
                            squadron→wing share, the program is auto-
                            forwarded to a Base PC for read-only visibility.
                            The wing may pick which Base PC the share lands
                            on; default is the first registered base. */}
                        {share.currentTier === "wing" && myTier === "wing" && basePCs.length > 0 && (
                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">On approve, send to Base PC</label>
                            <select value={forwardTo || basePCs[0]?.id || ""} onChange={e => setForwardTo(e.target.value)} className="px-2 py-1 rounded bg-input border border-border text-xs" data-testid={`forward-target-${share.id}`}>
                              {basePCs.map(p => (
                                <option key={p.id} value={p.id}>{p.deviceName || p.squadronName}{p.online ? " · online" : " · offline"}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <input
                          value={decisionNote}
                          onChange={e => setDecisionNote(e.target.value)}
                          placeholder="Optional note"
                          className="flex-1 min-w-[10rem] px-2 py-1.5 bg-input border border-border rounded text-xs"
                        />
                        <button
                          onClick={async () => {
                            const approver = user?.username ?? "cmd";
                            // Wing approval auto-forwards the program to a
                            // Base PC so the base sees the approved sheet
                            // in their inbox without an extra click. We
                            // forward FIRST (which moves the share to the
                            // base tier) then approve, so the approval
                            // event lands at the right currentPcId.
                            if (myTier === "wing" && share.currentTier === "wing" && basePCs.length > 0) {
                              const baseId = forwardTo || basePCs[0].id;
                              const baseTarget = basePCs.find(p => p.id === baseId) ?? basePCs[0];
                              await decide.mutateAsync({
                                id: share.id, action: "forward", by: approver, tier: myTier,
                                forwardPcId: baseTarget.id, forwardPcName: baseTarget.squadronName,
                              });
                              await decide.mutateAsync({
                                id: share.id, action: "approve", by: approver, tier: "base",
                                note: decisionNote || undefined,
                              });
                              toast({ title: `Approved · sent to ${baseTarget.squadronName}` });
                            } else {
                              await decide.mutateAsync({ id: share.id, action: "approve", by: approver, tier: myTier, note: decisionNote || undefined });
                              toast({ title: "Approved" });
                            }
                            setDecisionNote("");
                          }}
                          className="px-3 py-1.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 text-xs font-semibold inline-flex items-center gap-1"
                          data-testid={`approve-${share.id}`}
                        >
                          <Check className="h-3 w-3" />
                          {myTier === "wing" && share.currentTier === "wing" && basePCs.length > 0
                            ? "Approve & send to Base"
                            : "Approve"}
                        </button>
                        <button
                          onClick={async () => {
                            await decide.mutateAsync({ id: share.id, action: "reject", by: user?.username ?? "ops", tier: myTier, note: decisionNote || undefined });
                            toast({ title: "Rejected" }); setDecisionNote("");
                          }}
                          className="px-3 py-1.5 rounded-md bg-rose-500/20 border border-rose-400/40 text-rose-100 text-xs font-semibold inline-flex items-center gap-1"
                          data-testid={`reject-${share.id}`}
                        >
                          <X className="h-3 w-3" /> Reject
                        </button>
                        <button
                          onClick={async () => {
                            await decide.mutateAsync({ id: share.id, action: "hold", by: user?.username ?? "ops", tier: myTier, note: decisionNote || undefined });
                            toast({ title: "Held" }); setDecisionNote("");
                          }}
                          className="px-3 py-1.5 rounded-md bg-secondary border border-border text-xs inline-flex items-center gap-1"
                        >
                          <PauseCircle className="h-3 w-3" /> Hold
                        </button>
                        {share.program ? (
                          editBuffer[share.id] ? (
                            <>
                              <button
                                onClick={async () => {
                                  const buf = editBuffer[share.id];
                                  await decide.mutateAsync({
                                    id: share.id,
                                    action: "edit",
                                    by: user?.username ?? "ops",
                                    tier: myTier,
                                    note: decisionNote || undefined,
                                    editedProgram: buf,
                                    editedRows: programToShareRows(buf),
                                  });
                                  setEditBuffer(b => { const { [share.id]: _, ...rest } = b; return rest; });
                                  setDecisionNote("");
                                  toast({ title: "Edits returned to originator" });
                                }}
                                className="px-3 py-1.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-100 text-xs font-semibold inline-flex items-center gap-1"
                                data-testid={`save-edit-${share.id}`}
                              >
                                <Pencil className="h-3 w-3" /> Save & return to originator
                              </button>
                              <button
                                onClick={() => setEditBuffer(b => { const { [share.id]: _, ...rest } = b; return rest; })}
                                className="px-3 py-1.5 rounded-md bg-secondary border border-border text-xs inline-flex items-center gap-1"
                              >
                                Cancel edit
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() =>
                                setEditBuffer(b => ({
                                  ...b,
                                  [share.id]: JSON.parse(JSON.stringify(share.program)) as ScheduleProgram,
                                }))
                              }
                              className="px-3 py-1.5 rounded-md bg-secondary border border-border text-xs inline-flex items-center gap-1"
                              data-testid={`edit-${share.id}`}
                            >
                              <Pencil className="h-3 w-3" /> Edit sheet
                            </button>
                          )
                        ) : (
                          <button
                            onClick={async () => {
                              await decide.mutateAsync({ id: share.id, action: "edit", by: user?.username ?? "ops", tier: myTier, note: decisionNote || undefined, editedRows: share.rows });
                              toast({ title: "Edits returned to originator" }); setDecisionNote("");
                            }}
                            className="px-3 py-1.5 rounded-md bg-secondary border border-border text-xs inline-flex items-center gap-1"
                          >
                            <Pencil className="h-3 w-3" /> Edit & return
                          </button>
                        )}
                        <button
                          onClick={() => window.print()}
                          className="px-3 py-1.5 rounded-md bg-secondary border border-border text-xs inline-flex items-center gap-1 no-print"
                          data-testid={`print-${share.id}`}
                        >
                          <Printer className="h-3 w-3" /> Print
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Sent / status */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Sent ({sent.length})</div>
          <button onClick={() => window.print()} className="text-xs px-2 py-1 rounded bg-secondary border border-border inline-flex items-center gap-1 no-print">
            <Printer className="h-3 w-3" /> Print
          </button>
        </div>
        {sent.length === 0 ? (
          <div className="text-xs text-muted-foreground py-3">No schedules sent yet.</div>
        ) : (
          <div className="space-y-2">
            {sent.map(share => (
              <div key={share.id} className="border border-border rounded-md p-3" data-testid={`sent-${share.id}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-semibold">{share.date}</div>
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-secondary border border-border">{share.status}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mb-2">
                  Now at: {share.currentPcName ?? "—"} ({share.currentTier})
                </div>
                {share.program ? (
                  <FlightScheduleSheet
                    prog={share.editedProgram ?? share.program}
                    pilotOptions={pilotOptions}
                    statusLabel={share.editedProgram ? "EDIT PROPOSED" : share.status.toUpperCase()}
                    approvedAt={share.approvedAt}
                    approvedBy={share.approvedBy}
                  />
                ) : (
                  <ScheduleTable share={share} />
                )}
                {(share.editedRows || share.editedProgram) && (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={async () => { await acceptEdits.mutateAsync({ id: share.id, by: user?.username ?? "ops" }); toast({ title: "Accepted edits" }); }}
                      className="px-3 py-1.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 text-xs font-semibold inline-flex items-center gap-1"
                      data-testid={`accept-edits-${share.id}`}
                    >
                      <Check className="h-3 w-3" /> Accept edits from {share.editedBy ?? "downstream"}
                    </button>
                  </div>
                )}
                <div className="mt-2 text-[10px] text-muted-foreground">
                  History: {share.history.map(h => `${h.tier}/${h.action}`).join(" → ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ScheduleTable({ share }: { share: ScheduleShare }) {
  // Diff against the baseline (last-accepted snapshot). On screen this
  // adds colored backgrounds; the print stylesheet (.no-print-diff in
  // index.css) drops the highlight so paper output is always clean.
  const diff = useMemo(
    () => diffSchedule(share.baselineRows, share.editedRows ?? share.rows),
    [share.baselineRows, share.rows, share.editedRows],
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-secondary/30">
          <tr>
            <th className="px-2 py-1 text-left">A/C</th>
            <th className="px-2 py-1 text-left">Pilot</th>
            <th className="px-2 py-1 text-left">Co-Pilot</th>
            <th className="px-2 py-1 text-left">Config</th>
            <th className="px-2 py-1 text-left">Route</th>
            <th className="px-2 py-1 text-left">Mission</th>
            <th className="px-2 py-1 text-right">Takeoff</th>
            <th className="px-2 py-1 text-right">Land</th>
            <th className="px-2 py-1 text-right">Fuel</th>
          </tr>
        </thead>
        <tbody>
          {diff.map(d => {
            const r = d.next ?? d.prev!;
            const cls =
              d.kind === "added" ? "no-print-diff bg-emerald-500/10"
              : d.kind === "removed" ? "no-print-diff bg-rose-500/10 line-through opacity-70"
              : d.kind === "changed" ? "no-print-diff bg-amber-500/10"
              : "";
            return (
              <tr key={r.id} className={`border-t border-border ${cls}`} data-testid={`diff-${d.kind}`}>
                <td className="px-2 py-1 font-mono">{r.ac}</td>
                <td className="px-2 py-1">{r.crew[0] ?? ""}</td>
                <td className="px-2 py-1">{r.crew[1] ?? ""}</td>
                <td className="px-2 py-1">{r.config}</td>
                <td className="px-2 py-1">{r.route ?? ""}</td>
                <td className="px-2 py-1">{r.mission}</td>
                <td className="px-2 py-1 text-right font-mono">{r.takeoff}</td>
                <td className="px-2 py-1 text-right font-mono">{r.land}</td>
                <td className="px-2 py-1 text-right font-mono">{r.fuel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
