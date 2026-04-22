/* ────────────────────────────────────────────────────────────────────
   FinalSchedules — read-only Wing-approved flight schedules rollup
   ────────────────────────────────────────────────────────────────────
   v1.1.64. The Base Cmdr and the HQ Cmdr never plan a flight schedule;
   they only see the FINAL flying programme that the Wing Commander
   has approved. The page is intentionally minimal:

   • One card per squadron, sorted by latest update first.
   • Each card shows the originating Squadron Commander's name (so the
     Base / HQ operator can see which Sqn Cmdr signed off on it) and
     the most recent approved schedules for that squadron.
   • Click a date row to open the full RJAF flight schedule paper
     (read-only, with the Wing approval banner across the top).

   No Approve / Reject / Edit / Delete — viewers only. The composer
   stays on the squadron PCs.
   ──────────────────────────────────────────────────────────────────── */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ClipboardCheck, FileText, Printer } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import {
  useScheduleShares,
  useRegisteredPCs,
  canViewFinalSchedules,
  getLocalPcId,
  squadronColor,
  type ScheduleShare,
} from "@/lib/cross-pc";
import { usePilots } from "@/lib/squadron-data";
import FlightScheduleSheet from "@/components/FlightScheduleSheet";
import { Button } from "@/components/ui/button";

export default function FinalSchedules() {
  const { lang } = useI18n();
  const { user } = useAuth();
  const dir = lang === "ar" ? "rtl" : "ltr";
  const allowed = canViewFinalSchedules(user?.role, user?.scope);

  // Pull every Wing-approved schedule across every squadron. The
  // visibility filter inside useScheduleShares enforces "Wing-signed
  // finals only" so drafts and Sqn-only approvals never appear here.
  const myPcId = getLocalPcId();
  const { data: shares = [] } = useScheduleShares(myPcId, { viewAllApproved: allowed });
  const registry = useRegisteredPCs();
  // usePilots returns a query object — we want the .data array (which
  // already defaults to []). Going through the query handle keeps the
  // FlightScheduleSheet's pilot picker labelled correctly when the
  // viewer expands an approved schedule.
  const { data: PILOTS } = usePilots();
  const pilotOptions = useMemo(
    () => PILOTS.map(p => ({ value: p.name, label: `${p.rank} ${p.name}` })),
    [PILOTS],
  );

  // Open-card state: which squadron card is expanded, and which
  // schedule (by share id) is showing the full paper. Only one paper
  // open at a time keeps the surface clean.
  const [openSquadron, setOpenSquadron] = useState<string | null>(null);
  const [openShareId,  setOpenShareId]  = useState<string | null>(null);

  if (!allowed) {
    return (
      <div className="p-6" dir={dir}>
        <div className="rounded-md border border-border bg-card p-6 max-w-xl">
          <div className="text-sm font-semibold mb-1">
            {lang === "ar" ? "البرامج النهائية" : "Final Flight Schedules"}
          </div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            {lang === "ar"
              ? "هذه الصفحة متاحة فقط لقائد القاعدة وقائد القيادة (HQ)."
              : "This page is available only to the Base Commander and HQ Commander."}
          </div>
        </div>
      </div>
    );
  }

  // Group every share by its origin squadron. We rely on
  // originSquadronId — that's the canonical PC id of the squadron
  // (e.g. "NO.8") that submitted the schedule. The paper-style shares
  // (with `program`) are the ones we display; the compact-row shares
  // are skipped so the Base / HQ surface stays consistent and clean.
  const grouped = useMemo(() => {
    const buckets = new Map<string, ScheduleShare[]>();
    for (const s of shares) {
      if (!s.program) continue; // paper sheets only
      const key = s.originSquadronId;
      const arr = buckets.get(key) ?? [];
      arr.push(s);
      buckets.set(key, arr);
    }
    // Sort each squadron's shares by approval time (latest first), then
    // sort the squadron list itself by the latest approval timestamp
    // so the most recently active squadron sits at the top.
    const out = Array.from(buckets.entries()).map(([sqnId, list]) => {
      list.sort((a, b) => (b.approvedAt ?? b.date).localeCompare(a.approvedAt ?? a.date));
      return { sqnId, sqnName: list[0].originSquadronName, latest: list[0].approvedAt ?? list[0].date, shares: list };
    });
    out.sort((a, b) => b.latest.localeCompare(a.latest));
    return out;
  }, [shares]);

  // Map squadron-id → the operator name of the Sqn Cmdr who pushed
  // the latest approved version up to Wing. We walk the history from
  // newest-first so a re-submission after edits / a rejected cycle
  // shows the person who actually owns the current Wing-approved
  // version, not whoever first started the chain weeks ago.
  const sqnCommanderFor = (s: ScheduleShare): string => {
    for (let i = s.history.length - 1; i >= 0; i--) {
      const h = s.history[i];
      if (h.action === "submitted" && h.tier === "squadron" && h.by) {
        return h.by;
      }
    }
    // Fallback to the registry display name for the squadron PC.
    const reg = registry.data.find(p => p.id === s.originSquadronId);
    return reg?.squadronName ?? s.originSquadronName;
  };

  return (
    <div className="p-4 space-y-3" dir={dir}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-emerald-400" />
            {lang === "ar" ? "البرامج النهائية المعتمدة" : "Final Approved Flight Schedules"}
          </h1>
          <div className="text-[11px] text-muted-foreground">
            {lang === "ar"
              ? "مرتّب حسب السرب · أحدث تحديث في الأعلى"
              : "Sorted by squadron · latest update first"}
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {grouped.length} {lang === "ar" ? "سرب" : grouped.length === 1 ? "squadron" : "squadrons"}
          {" · "}
          {shares.filter(s => s.program).length} {lang === "ar" ? "برنامج" : "schedules"}
        </div>
      </div>

      {grouped.length === 0 && (
        <div className="rounded-md border border-border bg-card p-6 text-center text-xs text-muted-foreground">
          {lang === "ar"
            ? "لا توجد برامج طيران معتمدة بعد. ستظهر هنا فور اعتماد قائد الجناح لأي برنامج."
            : "No Wing-approved flight schedules yet. As soon as the Wing Commander approves a schedule it will appear here."}
        </div>
      )}

      <div className="space-y-2">
        {grouped.map(({ sqnId, sqnName, latest, shares: sqnShares }) => {
          const expanded = openSquadron === sqnId;
          const cmdrName = sqnCommanderFor(sqnShares[0]);
          // v1.1.65 — colour each squadron card with its deterministic
          // palette: a 4px left stripe + a colour-matched name pill.
          // Same colours as the Wing-Cmdr inbox, so a Base / HQ
          // operator who's been talking to the wing about a squadron
          // recognises it instantly here.
          const pal = squadronColor(sqnId);
          return (
            <div
              key={sqnId}
              className="rounded-md border border-border bg-card overflow-hidden flex"
              data-testid={`final-sched-sqn-${sqnId}`}
            >
              <div className={`w-1 shrink-0 ${pal.stripe}`} aria-hidden="true" />
              <div className="flex-1 min-w-0">
              {/* Squadron header row — click to expand the schedule list. */}
              <button
                onClick={() => {
                  setOpenSquadron(expanded ? null : sqnId);
                  setOpenShareId(null);
                }}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover-elevate active-elevate-2 text-start"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {expanded
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border font-semibold ${pal.badge}`}>
                        {sqnName}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {lang === "ar" ? "قائد السرب: " : "Sqn Cmdr: "}
                      <span className="text-foreground/80">{cmdrName}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
                  <span className="tabular-nums">
                    {sqnShares.length} {lang === "ar" ? "برنامج" : sqnShares.length === 1 ? "schedule" : "schedules"}
                  </span>
                  <span className="tabular-nums hidden sm:inline">{prettyDate(latest)}</span>
                </div>
              </button>

              {expanded && (
                <div className="border-t border-border bg-background/30 divide-y divide-border">
                  {sqnShares.map(share => {
                    const open = openShareId === share.id;
                    return (
                      <div key={share.id}>
                        <button
                          onClick={() => setOpenShareId(open ? null : share.id)}
                          className="w-full flex items-center justify-between gap-3 px-5 py-2.5 hover-elevate text-start"
                          data-testid={`final-sched-share-${share.id}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="text-xs">
                              <div className="font-medium tabular-nums">{share.date}</div>
                              <div className="text-[10px] text-muted-foreground">
                                {lang === "ar" ? "اعتمد بواسطة قائد الجناح: " : "Wing approved by: "}
                                {share.approvedBy ?? "—"}
                                {share.approvedAt && (
                                  <> · {new Date(share.approvedAt).toLocaleString()}</>
                                )}
                              </div>
                            </div>
                          </div>
                          <span className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">
                            {open ? (lang === "ar" ? "إخفاء" : "Hide") : (lang === "ar" ? "عرض" : "View")}
                          </span>
                        </button>
                        {open && share.program && (
                          <div className="px-3 pb-3 pt-1 space-y-2">
                            <div className="flex items-center justify-end gap-2 no-print">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.print()}
                                data-testid={`final-sched-print-${share.id}`}
                              >
                                <Printer className="h-3.5 w-3.5 me-1" />
                                {lang === "ar" ? "طباعة" : "Print"}
                              </Button>
                            </div>
                            <FlightScheduleSheet
                              prog={share.program}
                              pilotOptions={pilotOptions}
                              approvedAt={share.approvedAt}
                              approvedBy={share.approvedBy}
                              statusLabel={lang === "ar" ? "نهائي معتمد" : "FINAL · APPROVED"}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function prettyDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}
