import { useEffect, useState } from "react";
import DateInput from "@/components/DateInput";
import MultiSegmentField, { splitQualificationSegments, joinQualificationSegments } from "@/components/MultiSegmentField";
import { RJAF_RANKS, lookupRankEn } from "@/lib/ranks";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { usePilots, useUpdatePilot, useCreatePilot, useDeletePilot, type Pilot } from "@/lib/squadron-data";
import { getCurrencyWindow } from "@/lib/currency-settings";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { fmtDateTimeDDMM } from "@/lib/format";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Search, Pencil, Trash2, X, Loader2, FileDown } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataUnavailableBanner } from "@/components/DataUnavailableBanner";

// Per-pilot phone-pair status sourced directly from `pilot_devices`.
//
// The dot is binary by design (per ops): GREEN means the pilot has at
// least one active (revoked_at = null) device row — i.e. their phone
// is paired right now. GRAY means no active pairing exists (never
// paired, or every pairing has been revoked). The freshness/last-seen
// nuance is intentionally NOT shown on the roster — that lives on the
// pilot detail page. Realtime + 30 s polling fallback keep the dot
// in sync without a manual refresh.
interface PairRow {
  pilot_id:  string;
  linked_at: string | null;
}
function usePilotPairing() {
  const qc = useQueryClient();
  const enabled = supabaseConfigured && !!supabase;
  const q = useQuery<Map<string, PairRow>>({
    queryKey: ["pilot-pairing"],
    enabled,
    // 30-second polling fallback so a flaky realtime channel never
    // leaves a paired phone showing gray for long.
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!supabase) return new Map();
      const { data, error } = await supabase
        .from("pilot_devices")
        .select("pilot_id, linked_at")
        .is("revoked_at", null);
      if (error || !Array.isArray(data)) return new Map();
      const m = new Map<string, PairRow>();
      for (const r of data as PairRow[]) {
        // Keep the most recent pairing per pilot (a pilot may have
        // re-paired multiple devices over time).
        const prev = m.get(r.pilot_id);
        if (!prev || (r.linked_at ?? "") > (prev.linked_at ?? "")) {
          m.set(r.pilot_id, r);
        }
      }
      return m;
    },
  });

  // Realtime subscription — refresh the cache whenever a pilot_devices
  // row is inserted, updated (e.g. revoked), or deleted. Cleaned up on
  // unmount so we never leave a zombie channel behind.
  useEffect(() => {
    if (!enabled || !supabase) return;
    const channel = supabase
      .channel("roster-pilot-devices")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pilot_devices" },
        () => { qc.invalidateQueries({ queryKey: ["pilot-pairing"] }); },
      )
      .subscribe();
    return () => { if (supabase) void supabase.removeChannel(channel); };
  }, [enabled, qc]);

  return q;
}
function pairDotInfo(row: PairRow | undefined):
  { color: string; label: string; tooltip: string } {
  if (!row) {
    return { color: "bg-zinc-500", label: "Not paired", tooltip: "Not paired" };
  }
  const when = row.linked_at ? fmtDateTimeDDMM(row.linked_at) : "—";
  return {
    color: "bg-emerald-500",
    label: "Paired",
    tooltip: `Paired ${when}`,
  };
}

export default function Roster() {
  const { t, rankOf } = useI18n();
  const [q, setQ] = useState("");
  const [importedOnly, setImportedOnly] = useState(false);
  const pilotsQ = usePilots();
  const { data: PILOTS, isLoading, isFetching } = pilotsQ;
  const syncQ = usePilotPairing();
  const updatePilot = useUpdatePilot();
  const createPilot = useCreatePilot();
  const deletePilot = useDeletePilot();
  const [editing, setEditing] = useState<Pilot | null>(null);
  const [adding, setAdding] = useState<Pilot | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Pilot | null>(null);
  const [err, setErr] = useState("");

  const blankPilot = (): Pilot => {
    const nextId = (() => {
      const nums = PILOTS.map(p => parseInt(p.id.replace(/\D/g, ""), 10)).filter(n => !isNaN(n));
      const max = nums.length ? Math.max(...nums) : 0;
      return `P${String(max + 1).padStart(3, "0")}`;
    })();
    return {
      id: nextId,
      name: "",
      arabicName: "",
      militaryNumber: "",
      rank: "",
      rankEn: "",
      phone: "",
      address: "",
      unit: "SQDN",
      openingDay: 0,
      openingNight: 0,
      openingNvg: 0,
      doctorNote: "",
      monthDay: 0,
      monthNight: 0,
      monthNvg: 0,
      monthSim: 0,
      monthCaptain: 0,
      totalDay: 0,
      totalNight: 0,
      totalNvg: 0,
      totalSim: 0,
      totalCaptain: 0,
      expiry: { day: "", night: "", nvg: "", irt: "", medical: "", sim: "" },
      available: true,
      qualifications: [],
      lastSimDate: "",
    };
  };

  const list = PILOTS
    .filter(p => !importedOnly || p.imported)
    .filter(p => !q || (p.name + p.arabicName + p.id).toLowerCase().includes(q.toLowerCase()));
  const importedCount = PILOTS.filter(p => p.imported).length;

  // Military number is the primary identifier the pilot types on their
  // phone to pair the mobile app. It MUST be non-empty and unique across
  // the squadron — duplicates would let two pilots collide on the same
  // login and the mobile pairing flow would be ambiguous. We enforce it
  // here on every create/edit. (A matching DB-level unique index ensures
  // multi-PC writes can't race past this guard either.)
  const validateMilitaryNumber = (next: Pilot): string | null => {
    const mil = (next.militaryNumber ?? "").trim();
    if (!mil) {
      return t("err_militaryNumberRequired");
    }
    const lower = mil.toLowerCase();
    const dup = PILOTS.find(
      x => x.id !== next.id && (x.militaryNumber ?? "").trim().toLowerCase() === lower,
    );
    if (dup) {
      return `${t("err_militaryNumberDuplicate")} (${rankOf(dup)} ${dup.name} · ${dup.id})`;
    }
    return null;
  };

  const onSave = async (next: Pilot) => {
    setErr("");
    const v = validateMilitaryNumber(next);
    if (v) { setErr(v); return; }
    try {
      await updatePilot.mutateAsync({ ...next, militaryNumber: (next.militaryNumber ?? "").trim() });
      setEditing(null);
    } catch (e) {
      setErr((e as Error).message || "Update failed");
    }
  };

  const onCreate = async (next: Pilot) => {
    setErr("");
    const v = validateMilitaryNumber(next);
    if (v) { setErr(v); return; }
    try {
      await createPilot.mutateAsync({ ...next, militaryNumber: (next.militaryNumber ?? "").trim() });
      setAdding(null);
    } catch (e) {
      setErr((e as Error).message || "Create failed");
    }
  };

  const onDelete = async () => {
    if (!confirmDelete) return;
    setErr("");
    try {
      await deletePilot.mutateAsync(confirmDelete.id);
      setConfirmDelete(null);
    } catch (e) {
      setErr((e as Error).message || "Delete failed");
    }
  };

  return (
    <div>
      <PageHead title={t("nav_roster")} subtitle={`${list.length} / ${PILOTS.length} pilots${isFetching && !isLoading ? " · " + t("syncing") : ""}`} actions={
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setImportedOnly(v => !v)}
            disabled={importedCount === 0}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border ${importedOnly ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-foreground border-border"} disabled:opacity-40 disabled:cursor-not-allowed`}
            title={importedCount === 0 ? t("noImportedYet") : ""}
            data-testid="toggle-imported-only"
          >
            <FileDown className="h-3.5 w-3.5" /> {t("importedOnly")} ({importedCount})
          </button>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("search")} className="pl-7 pr-2 py-1.5 rounded-md bg-input border border-border text-sm" />
          </div>
          <button
            onClick={() => setAdding(blankPilot())}
            data-testid="button-add-pilot"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> {t("add")}
          </button>
        </div>
      } />
      {err && <div className="mb-3 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">{err}</div>}
      <DataUnavailableBanner queries={[pilotsQ]} testId="banner-roster-unavailable" />
      {isLoading && PILOTS.length === 0 && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground" data-testid="loading-pilots">
          <Loader2 className="h-4 w-4 me-2 animate-spin" /> {t("loading")}
        </div>
      )}
      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-center w-6" title="Mobile sync indicator">●</th>
                <th className="px-3 py-2 text-left">{t("militaryNumber")}</th>
                <th className="px-3 py-2 text-left">{t("rank")}</th>
                <th className="px-3 py-2 text-left">{t("name")}</th>
                <th className="px-3 py-2 text-left">{t("arabicName")}</th>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-left">{t("phone")}</th>
                <th className="px-3 py-2 text-right">{t("openingDay")}</th>
                <th className="px-3 py-2 text-right">{t("openingNight")}</th>
                <th className="px-3 py-2 text-right">{t("openingNvg")}</th>
                <th className="px-3 py-2 text-left">{t("doctorNote")}</th>
                <th className="px-3 py-2 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={12} className="px-3 py-6 text-center text-xs text-muted-foreground" data-testid="empty-pilots">
                    {pilotsQ.isError ? "—" : t("no_records")}
                  </td>
                </tr>
              )}
              {list.map((p: Pilot) => {
                const dot = pairDotInfo(syncQ.data?.get(p.id));
                return (
                <tr key={p.id} className="border-t border-border row-hover">
                  <td className="px-2 py-2 text-center" data-testid={`sync-dot-${p.id}`}>
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${dot.color}`}
                      title={dot.tooltip}
                      aria-label={dot.label}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono">{p.militaryNumber || p.id}</td>
                  <td className="px-3 py-2">{rankOf(p)}</td>
                  <td className="px-3 py-2"><Link href={`/pilot/${p.id}`} className="hover:text-primary">{p.name}</Link></td>
                  <td className="px-3 py-2 text-right rtl:text-left">{p.arabicName}</td>
                  <td className="px-3 py-2"><span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary border border-border">{p.unit}</span></td>
                  <td className="px-3 py-2 font-mono">{p.phone}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.openingDay}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.openingNight}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.openingNvg}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{p.doctorNote || "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(p)} className="p-1.5 rounded hover:bg-secondary" title={t("edit")} data-testid={`button-edit-${p.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setConfirmDelete(p)} className="p-1.5 rounded hover:bg-destructive/20 text-destructive" title={t("delete")} data-testid={`button-delete-${p.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <PilotEditDialog
          pilot={editing}
          onClose={() => setEditing(null)}
          onSave={onSave}
          saving={updatePilot.isPending}
        />
      )}

      {adding && (
        <PilotEditDialog
          pilot={adding}
          onClose={() => setAdding(null)}
          onSave={onCreate}
          saving={createPilot.isPending}
          isNew
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t("delete") + " " + confirmDelete.name + "?"}
          message={`This will remove pilot ${confirmDelete.id} (${confirmDelete.name}). This action cannot be undone.`}
          confirmLabel={t("delete")}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={onDelete}
          busy={deletePilot.isPending}
          danger
        />
      )}
    </div>
  );
}

// ── Currency helpers ────────────────────────────────────────────────────────
// Given a "last flown" date (ISO string) and a validity window in days,
// compute the expiry date (also ISO string). Returns "" when the input is
// empty or unparseable.
function computeExpiry(lastFlownIso: string, windowDays: number): string {
  if (!lastFlownIso) return "";
  const [y, m, d] = lastFlownIso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + windowDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
// Reverse: given an expiry date, recover the approximate last-flown date so
// the form shows something sensible when editing an existing pilot.
function computeLastFlown(expiryIso: string, windowDays: number): string {
  if (!expiryIso) return "";
  const [y, m, d] = expiryIso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - windowDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Six "Last X flown" cells the operator agreed to lock the Add Pilot
// form to (Day / Night / NVG / Simulator + Instrument + Mission Qual).
// `irt` is the canonical key for the instrument check; `missionQual`
// is a new optional expiry slot persisted in the JSONB blob (see
// PilotExpiry in src/lib/mock.ts). Medical is still tracked elsewhere
// in the system but no longer edited from this form per task #108.
interface LastFlown { day: string; night: string; nvg: string; irt: string; missionQual: string; sim: string; }

function PilotEditDialog({ pilot, onClose, onSave, saving, isNew }: { pilot: Pilot; onClose: () => void; onSave: (p: Pilot) => void; saving: boolean; isNew?: boolean }) {
  const { t, rankOf } = useI18n();
  const [p, setP] = useState<Pilot>(pilot);
  // Qualification editor state — segmented input replaces the legacy
  // comma-separated text box. We keep it in local state so the operator
  // can add/remove boxes and toggle the separator without touching the
  // pilot record until save. The separator is purely a display choice;
  // the underlying tags array stays the same.
  const [qualSegments, setQualSegments] = useState<string[]>(() =>
    splitQualificationSegments(pilot.qualifications),
  );
  const [qualSep, setQualSep] = useState<"/" | "-">(pilot.qualificationSeparator ?? "/");
  const currencyWin = getCurrencyWindow();

  // lastFlown is the UI state — what the operator types. On save we convert
  // to expiry dates (lastFlown + window) before passing to onSave, so the
  // rest of the system (auto-bump, Currency page, Reminders) is unchanged.
  const [lastFlown, setLastFlown] = useState<LastFlown>(() => ({
    day:         computeLastFlown(pilot.expiry.day,                 currencyWin.day),
    night:       computeLastFlown(pilot.expiry.night,               currencyWin.night),
    nvg:         computeLastFlown(pilot.expiry.nvg,                 currencyWin.nvg),
    irt:         computeLastFlown(pilot.expiry.irt,                 currencyWin.instrument),
    missionQual: computeLastFlown(pilot.expiry.missionQual ?? "",   currencyWin.instrument),
    sim:         computeLastFlown(pilot.expiry.sim,                 currencyWin.day),
  }));

  // Functional updater — without this, rapid keystrokes can read a stale `p`
  // closure when React batches updates inside Electron's renderer, making
  // the field appear "frozen" after the first character. Reported by ops.
  const set = <K extends keyof Pilot>(k: K, v: Pilot[K]) => setP(prev => ({ ...prev, [k]: v }));

  const setLF = (k: keyof LastFlown, v: string) => setLastFlown(prev => ({ ...prev, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Convert last-flown dates → expiry dates using the configured windows.
    const expiry = {
      day:         computeExpiry(lastFlown.day,         currencyWin.day),
      night:       computeExpiry(lastFlown.night,       currencyWin.night),
      nvg:         computeExpiry(lastFlown.nvg,         currencyWin.nvg),
      irt:         computeExpiry(lastFlown.irt,         currencyWin.instrument),
      // Medical is no longer edited from this form (task #108 swapped
      // the slot for Mission Qual). Preserve whatever value the pilot
      // already had so currency/reminders stay accurate.
      medical:     pilot.expiry.medical ?? "",
      sim:         computeExpiry(lastFlown.sim,         currencyWin.day),
      missionQual: computeExpiry(lastFlown.missionQual, currencyWin.instrument),
    };
    // Fold the segmented qualification editor back into both shapes:
    // - `qualifications` (string[]) keeps every render site working.
    // - `qualification`  (joined string with the operator's chosen
    //   separator) is the canonical persisted value per task #108.
    // - `qualificationSeparator` round-trips the toggle choice.
    const qualifications = joinQualificationSegments(qualSegments);
    const qualification = qualifications.join(` ${qualSep} `);
    // The dedicated "Last Sim" currency input (one of the 6) doubles as
    // the commander-only `lastSimDate` field — keep them in sync on save
    // so the visibility-restricted view still has a value.
    const lastSimDate = lastFlown.sim || p.lastSimDate || "";
    onSave({ ...p, expiry, qualifications, qualification, qualificationSeparator: qualSep, lastSimDate });
  };
  return (
    // NOTE: no backdrop-blur. Chromium's backdrop-filter on Windows w/ HW
    // accel can intermittently swallow keyboard events from inputs sitting
    // *behind* it (the inputs render in their own compositor layer). Pure
    // black/60 is just as visible and never breaks input.
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose} data-testid="overlay-pilot-edit">
      <div className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="text-base font-semibold gold-grad">{isNew ? t("add") : t("edit")} — {p.id}</div>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3" data-testid="form-edit-pilot">
          <div className="grid grid-cols-2 gap-3">
            {isNew && (
              <Field label="ID" value={p.id} onChange={v => set("id", v)} testId="input-id" autoFocus />
            )}
            <Field label={t("callSign")} value={p.callSign || ""} onChange={v => set("callSign", v)} testId="input-callSign" autoFocus={!isNew} />
            <Field label={t("flightName")} value={p.flightName || ""} onChange={v => set("flightName", v)} testId="input-flightName" />
            <Field label={t("name")} value={p.name} onChange={v => set("name", v)} testId="input-name" />
            <Field label={t("arabicName")} value={p.arabicName} onChange={v => set("arabicName", v)} testId="input-arabicName" />
            <Field label={`${t("militaryNumber")} *`} value={p.militaryNumber || ""} onChange={v => set("militaryNumber", v)} testId="input-militaryNumber" required />
            <label className="block text-xs">
              <span className="text-muted-foreground">{t("rank")} (AR)</span>
              <input
                type="text"
                list="rjaf-rank-list-ar"
                // CRITICAL: bind to the canonical Arabic rank, not the
                // English render value. `rankOf(p)` resolves to the
                // English string in EN mode; using it here would cause
                // typing in this box to overwrite `p.rank` with English
                // text and corrupt the canonical Arabic rank column.
                value={p.rank}
                onChange={e => {
                  const next = e.target.value;
                  setP(prev => {
                    const auto = lookupRankEn(next);
                    // Only auto-fill English rank when (a) the AR rank
                    // resolves to a known English value, AND (b) the
                    // operator hasn't customised the English rank yet
                    // (or the previous English value was the auto-fill
                    // for the previous AR rank). Prevents wiping a
                    // manual override when the operator tabs through
                    // the form.
                    const prevAuto = lookupRankEn(prev.rank);
                    const englishLooksAuto = !prev.rankEn || prev.rankEn === prevAuto;
                    return {
                      ...prev,
                      rank: next,
                      rankEn: englishLooksAuto && auto ? auto : (prev.rankEn ?? ""),
                    };
                  });
                }}
                placeholder="رائد طيار"
                data-testid="input-rank"
                className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm"
              />
              <datalist id="rjaf-rank-list-ar">
                {RJAF_RANKS.map(r => (
                  <option key={r.ar} value={r.ar}>{r.en}</option>
                ))}
              </datalist>
            </label>
            <Field label={`${t("rank")} (EN)`} value={p.rankEn || ""} onChange={v => set("rankEn", v)} testId="input-rankEn" />
            <Field label={t("phone")} value={p.phone} onChange={v => set("phone", v)} testId="input-phone" />
            <label className="block text-xs col-span-2">
              <span className="text-muted-foreground">Unit</span>
              <select value={p.unit} onChange={e => set("unit", e.target.value as Pilot["unit"])} className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm" data-testid="select-unit">
                <option value="SQDN">SQDN</option>
                <option value="HQ Attached">HQ Attached</option>
                <option value="UH-60M">UH-60M</option>
                <option value="UH-60AIL">UH-60AIL</option>
                <option value="Both">Both</option>
                <option value="RCN">RCN</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <Field label={t("address")} value={p.address || ""} onChange={v => set("address", v)} testId="input-address" />
            <Field label={t("doctorNote")} value={p.doctorNote || ""} onChange={v => set("doctorNote", v)} testId="input-doctorNote" />
            <label className="block text-xs col-span-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("qualifications")}</span>
                <div className="inline-flex items-center gap-1 text-[10px]">
                  <span className="text-muted-foreground">Separator:</span>
                  <button
                    type="button"
                    onClick={() => setQualSep("/")}
                    aria-pressed={qualSep === "/"}
                    data-testid="qual-sep-slash"
                    className={`px-2 py-0.5 rounded font-mono border ${qualSep === "/" ? "bg-primary text-primary-foreground border-primary" : "bg-secondary border-border text-muted-foreground"}`}
                  >/</button>
                  <button
                    type="button"
                    onClick={() => setQualSep("-")}
                    aria-pressed={qualSep === "-"}
                    data-testid="qual-sep-dash"
                    className={`px-2 py-0.5 rounded font-mono border ${qualSep === "-" ? "bg-primary text-primary-foreground border-primary" : "bg-secondary border-border text-muted-foreground"}`}
                  >-</button>
                </div>
              </div>
              <div className="mt-1">
                <MultiSegmentField
                  value={qualSegments}
                  onChange={setQualSegments}
                  separator={qualSep}
                  testIdPrefix="input-qualification"
                  placeholder="AC"
                />
              </div>
              <span className="block mt-1 text-[10px] text-muted-foreground">{t("qualificationsHelp")}</span>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <NumField label={t("openingDay")} value={p.openingDay} onChange={v => set("openingDay", v)} testId="input-openingDay" />
            <NumField label={t("openingNight")} value={p.openingNight} onChange={v => set("openingNight", v)} testId="input-openingNight" />
            <NumField label={t("openingNvg")} value={p.openingNvg} onChange={v => set("openingNvg", v)} testId="input-openingNvg" />
          </div>
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
            <div className="col-span-3">
              <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Last Currency Flown</div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Enter the <strong>date the check/flight was last performed</strong>. The expiry is calculated automatically
                using the currency windows configured in Settings (Day: {currencyWin.day}d · Night: {currencyWin.night}d · NVG: {currencyWin.nvg}d · Sim: {currencyWin.day}d · Instrument: {currencyWin.instrument}d · Mission Qual: {currencyWin.instrument}d).
              </div>
            </div>
            {([ 
              { label: "Last Day flown",     k: "day"     as const, days: currencyWin.day        },
              { label: "Last Night flown",   k: "night"   as const, days: currencyWin.night      },
              { label: "Last NVG flown",     k: "nvg"     as const, days: currencyWin.nvg        },
              { label: "Last Simulator",     k: "sim"         as const, days: currencyWin.day        },
              { label: "Last Instrument",    k: "irt"         as const, days: currencyWin.instrument },
              { label: "Last Mission Qual",  k: "missionQual" as const, days: currencyWin.instrument },
            ] as { label: string; k: keyof LastFlown; days: number }[]).map(({ label, k, days }) => {
              const expiry = computeExpiry(lastFlown[k], days);
              return (
                <label key={k} className="block text-xs" data-testid={`field-currency-${k}`}>
                  <span className="text-muted-foreground">{label}</span>
                  <DateInput
                    value={lastFlown[k]}
                    onChange={(v) => setLF(k, v)}
                    data-testid={`input-lastFlown-${k}`}
                    className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm"
                  />
                  {expiry ? (
                    <span className="block mt-0.5 text-[10px] text-emerald-400">
                      → Expires: {fmtDate(expiry)} ({days}d window)
                    </span>
                  ) : (
                    <span className="block mt-0.5 text-[10px] text-muted-foreground/50">No date set</span>
                  )}
                </label>
              );
            })}
          </div>
          <div className="text-[11px] text-muted-foreground -mt-1">
            {t("lastSimDateHelp")} · <span className="italic">{t("lastSimDateVisibility")}</span>
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md bg-secondary border border-border text-sm">{t("cancel")}</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50" data-testid="button-save-pilot">
              {saving ? t("syncing") : t("save_changes")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", testId, autoFocus, required }: { label: string; value: string; onChange: (v: string) => void; type?: string; testId?: string; autoFocus?: boolean; required?: boolean }) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        data-testid={testId}
        autoComplete="off"
        autoFocus={autoFocus}
        required={required}
        className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm"
      />
    </label>
  );
}

function NumField({ label, value, onChange, testId }: { label: string; value: number; onChange: (v: number) => void; testId?: string }) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input type="number" step="0.1" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)} data-testid={testId} className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm font-mono" />
    </label>
  );
}

