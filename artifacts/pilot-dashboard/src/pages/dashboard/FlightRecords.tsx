import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { usePilots, useSorties } from "@/lib/squadron-data";
import { DataUnavailableBanner } from "@/components/DataUnavailableBanner";
import { fmtDate } from "@/lib/format";
import { CalendarDays, ChevronLeft, ChevronRight, Plane, Clock, Printer, Users } from "lucide-react";

// Squadron-commander read-only browser of the sorties entered by the ops
// officer on this squadron's PC. Reuses the same local squadron-data store
// the ops officer writes to, so the commander always sees what's been
// recorded without touching it. Per-day view by default (pick any date);
// daily totals summarize hours/sorties/pilots for quick briefings.
export default function FlightRecords() {
  const { t, lang } = useI18n();
  const pilotsQ = usePilots();
  const sortiesQ = useSorties();
  const PILOTS = pilotsQ.data;
  const SORTIES = sortiesQ.data;

  const todayIso = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState<string>(todayIso);

  const pilotMap = useMemo(
    () => Object.fromEntries(PILOTS.map((p) => [p.id, `${p.rank} ${p.name}`])),
    [PILOTS],
  );

  // All days that have at least one sortie — used to populate a compact
  // "recent days" shortcut list so the commander can jump directly to any
  // previous flying day without scrubbing the date picker day-by-day.
  const flightDays = useMemo(() => {
    const set = new Set(SORTIES.map((s) => s.date));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [SORTIES]);

  const rowsForDay = useMemo(
    () =>
      SORTIES.filter((s) => s.date === date).sort((a, b) =>
        (a.acNumber + a.name).localeCompare(b.acNumber + b.name),
      ),
    [SORTIES, date],
  );

  const stats = useMemo(() => {
    let hours = 0;
    let nvg = 0;
    const pilotsSet = new Set<string>();
    const acSet = new Set<string>();
    for (const s of rowsForDay) {
      hours += Number(s.actual) || 0;
      nvg += Number(s.nvg) || 0;
      if (s.pilotId) pilotsSet.add(s.pilotId);
      if (s.coPilotId) pilotsSet.add(s.coPilotId);
      if (s.acNumber) acSet.add(s.acNumber);
    }
    return {
      count: rowsForDay.length,
      hours,
      nvg,
      pilots: pilotsSet.size,
      aircraft: acSet.size,
    };
  }, [rowsForDay]);

  const shift = (days: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };

  const seatName = (id: string, ext?: { name: string; squadron: string }) => {
    if (ext) return `${ext.name}${ext.squadron ? ` (${ext.squadron})` : ""}`;
    return pilotMap[id] || "—";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-amber-500" />
          {t("flightRecords")}
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.print()}
          data-testid="button-print-flights"
          className="no-print"
        >
          <Printer className="h-3.5 w-3.5 me-1" />
          {t("print")}
        </Button>
      </div>

      <DataUnavailableBanner
        queries={[pilotsQ, sortiesQ]}
        testId="banner-flights-unavailable"
      />

      {/* Date picker + day navigation. Clicking a "recent day" pill jumps
          straight to that date; the arrows nudge one day at a time. */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => shift(-1)}
              data-testid="button-prev-day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayIso)}
              className="px-2 py-1.5 rounded-md bg-input border border-border text-sm tabular-nums"
              data-testid="input-flight-date"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => shift(1)}
              data-testid="button-next-day"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDate(todayIso)}
              data-testid="button-today"
            >
              {t("today")}
            </Button>
            <span className="text-sm text-muted-foreground ms-auto tabular-nums">
              {fmtDate(date, lang)}
            </span>
          </div>

          {flightDays.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground me-1">
                {t("recentFlyingDays")}
              </span>
              {flightDays.slice(0, 10).map((d) => {
                const active = d === date;
                return (
                  <button
                    key={d}
                    onClick={() => setDate(d)}
                    className={`text-xs px-2 py-1 rounded-md border transition ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary/40 border-border hover:bg-secondary"
                    }`}
                    data-testid={`chip-flight-day-${d}`}
                  >
                    <span className="tabular-nums">{d}</span>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Stat
          icon={<Plane className="h-4 w-4 text-amber-500" />}
          label={t("sortiesCount")}
          value={stats.count}
        />
        <Stat
          icon={<Clock className="h-4 w-4 text-emerald-500" />}
          label={t("totalHours")}
          value={stats.hours.toFixed(1)}
        />
        <Stat
          icon={<Clock className="h-4 w-4 text-rose-400" />}
          label={t("nvgHours")}
          value={stats.nvg.toFixed(1)}
        />
        <Stat
          icon={<Users className="h-4 w-4 text-sky-400" />}
          label={t("pilotsFlown")}
          value={stats.pilots}
        />
        <Stat
          icon={<Plane className="h-4 w-4 text-sky-400" />}
          label={t("aircraftUsed")}
          value={stats.aircraft}
        />
      </div>

      {/* Per-sortie cards. The four primary details (AC#, Pilot, Co-Pilot,
          Mission) are front and centre so the commander can scan the day
          at a glance. The full hour breakdown, condition tag and remarks
          live as a quieter footer beneath each card — still visible, but
          not fighting for attention. Read-only; no edit/delete. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("flightsOnDay").replace("{date}", fmtDate(date, lang))}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 space-y-2">
          {rowsForDay.length === 0 ? (
            <p
              className="p-4 text-sm text-muted-foreground text-center"
              data-testid="empty-flights"
            >
              {t("noFlightsDay")}
            </p>
          ) : (
            rowsForDay.map((s, idx) => (
              <div
                key={s.id}
                className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2"
                data-testid={`row-flight-${s.id}`}
              >
                {/* Primary row: the four things the commander wants to see. */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <Field
                    label={`#${idx + 1} · ${t("acNumber")}`}
                    value={s.acNumber || "—"}
                    mono
                    accent
                  />
                  <Field
                    label={t("pilot")}
                    value={seatName(s.pilotId, s.pilotExternal)}
                  />
                  <Field
                    label={t("coPilot")}
                    value={seatName(s.coPilotId, s.coPilotExternal)}
                  />
                  <Field
                    label={t("sortieName")}
                    value={s.name || "—"}
                  />
                </div>

                {/* Secondary meta: AC type, sortie type, primary condition. */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {s.acType && (
                    <span className="px-1.5 py-0.5 rounded bg-secondary/60 border border-border">
                      {s.acType}
                    </span>
                  )}
                  {s.sortieType && (
                    <span className="px-1.5 py-0.5 rounded bg-secondary/60 border border-border">
                      {s.sortieType}
                    </span>
                  )}
                  {s.condition && (
                    <span
                      className={`px-1.5 py-0.5 rounded border ${
                        s.condition === "NVG"
                          ? "bg-rose-500/10 border-rose-500/40 text-rose-200"
                          : s.condition === "Night"
                          ? "bg-indigo-500/10 border-indigo-500/40 text-indigo-200"
                          : "bg-amber-500/10 border-amber-500/40 text-amber-200"
                      }`}
                    >
                      {s.condition}
                    </span>
                  )}
                  <span className="ms-auto font-mono tabular-nums text-muted-foreground">
                    {t("actual")}: <span className="text-foreground font-semibold">{s.actual}h</span>
                  </span>
                </div>

                {/* Detailed hour breakdown — quieter, single line. */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground font-mono tabular-nums border-t border-border/60 pt-2">
                  <HourChip label="D1" v={s.day1} />
                  <HourChip label="D2" v={s.day2} />
                  <HourChip label="DD" v={s.dayDual} />
                  <HourChip label="N1" v={s.night1} />
                  <HourChip label="N2" v={s.night2} />
                  <HourChip label="ND" v={s.nightDual} />
                  <HourChip label="NVG" v={s.nvg} rose />
                  <HourChip label="Sim" v={s.sim} />
                </div>

                {s.remarks && (
                  <div className="text-xs text-muted-foreground italic border-t border-border/60 pt-2">
                    <span className="not-italic font-medium text-foreground/80">
                      {t("remarks")}:{" "}
                    </span>
                    {s.remarks}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-2">
        <div className="h-8 w-8 rounded-md bg-secondary/40 border border-border flex items-center justify-center">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">
            {label}
          </div>
          <div className="text-lg font-semibold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
        {label}
      </div>
      <div
        className={`text-sm font-semibold truncate ${
          mono ? "font-mono" : ""
        } ${accent ? "text-amber-200" : "text-foreground"}`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function HourChip({
  label,
  v,
  rose,
}: {
  label: string;
  v: number;
  rose?: boolean;
}) {
  const hasValue = !!v;
  return (
    <span className={hasValue ? (rose ? "text-rose-300" : "text-foreground") : "opacity-50"}>
      {label} <span className="font-semibold">{v || "—"}</span>
    </span>
  );
}
