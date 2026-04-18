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

      {/* Per-sortie detail table. Read-only — no edit/delete buttons: the
          commander reviews what was entered, they don't modify it. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("flightsOnDay").replace("{date}", fmtDate(date, lang))}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rowsForDay.length === 0 ? (
            <p
              className="p-4 text-sm text-muted-foreground"
              data-testid="empty-flights"
            >
              {t("noFlightsDay")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <Th>{t("acType")}</Th>
                    <Th>{t("acNumber")}</Th>
                    <Th>{t("pilot")}</Th>
                    <Th>{t("coPilot")}</Th>
                    <Th>{t("sortieType")}</Th>
                    <Th>{t("sortieName")}</Th>
                    <Th>{t("condition")}</Th>
                    <Th right>D1</Th>
                    <Th right>D2</Th>
                    <Th right>DD</Th>
                    <Th right>N1</Th>
                    <Th right>N2</Th>
                    <Th right>ND</Th>
                    <Th right cls="text-rose-300">NVG</Th>
                    <Th right>Sim</Th>
                    <Th right>{t("actual")}</Th>
                    <Th>{t("remarks")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rowsForDay.map((s) => (
                    <tr
                      key={s.id}
                      className="border-t border-border row-hover"
                      data-testid={`row-flight-${s.id}`}
                    >
                      <Td>{s.acType}</Td>
                      <Td mono>{s.acNumber}</Td>
                      <Td>{seatName(s.pilotId, s.pilotExternal)}</Td>
                      <Td>{seatName(s.coPilotId, s.coPilotExternal)}</Td>
                      <Td>{s.sortieType}</Td>
                      <Td>{s.name}</Td>
                      <Td>{s.condition ?? "—"}</Td>
                      <Td mono right>{s.day1 || "—"}</Td>
                      <Td mono right>{s.day2 || "—"}</Td>
                      <Td mono right>{s.dayDual || "—"}</Td>
                      <Td mono right>{s.night1 || "—"}</Td>
                      <Td mono right>{s.night2 || "—"}</Td>
                      <Td mono right>{s.nightDual || "—"}</Td>
                      <Td mono right cls={s.nvg ? "text-rose-300" : ""}>
                        {s.nvg || "—"}
                      </Td>
                      <Td mono right>{s.sim || "—"}</Td>
                      <Td mono right>{s.actual}</Td>
                      <Td cls="max-w-[240px] truncate" title={s.remarks || ""}>
                        {s.remarks || "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

function Th({
  children,
  right,
  cls = "",
}: {
  children: React.ReactNode;
  right?: boolean;
  cls?: string;
}) {
  return (
    <th
      className={`px-3 py-2 ${right ? "text-right" : "text-left"} font-medium ${cls}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
  right,
  cls = "",
  title,
}: {
  children: React.ReactNode;
  mono?: boolean;
  right?: boolean;
  cls?: string;
  title?: string;
}) {
  return (
    <td
      className={`px-3 py-2 ${mono ? "font-mono" : ""} ${right ? "text-right" : ""} ${cls}`}
      title={title}
    >
      {children}
    </td>
  );
}
