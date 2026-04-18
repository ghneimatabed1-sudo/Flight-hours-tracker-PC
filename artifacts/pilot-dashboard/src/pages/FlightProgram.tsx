import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePilots } from "@/lib/squadron-data";
import { Button } from "@/components/ui/button";
import { Printer, Save } from "lucide-react";
import emblem from "@assets/rjaf_emblem.png";

type Mode = "DAY" | "NIGHT" | "NVG" | "DAY_AND_NVG" | "DAY_AND_NIGHT";

const MODES: { id: Mode; label: string }[] = [
  { id: "DAY", label: "DAY" },
  { id: "NIGHT", label: "NIGHT" },
  { id: "NVG", label: "NVG" },
  { id: "DAY_AND_NVG", label: "DAY & NVG" },
  { id: "DAY_AND_NIGHT", label: "DAY & NIGHT" },
];

// Simple side-profile Black Hawk silhouette used 5× across the header,
// matching the printed RJAF schedule template.
function Helo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 60" className={className} fill="currentColor" aria-hidden>
      {/* main rotor bar */}
      <rect x="20" y="4" width="160" height="2" rx="1" />
      <rect x="98" y="6" width="4" height="8" />
      {/* fuselage */}
      <path d="M30 30 Q40 18 95 18 L140 18 Q158 18 165 26 L178 28 L178 34 L165 36 Q158 42 140 42 L60 42 Q40 42 30 36 Z" />
      {/* tail boom */}
      <rect x="165" y="29" width="25" height="4" />
      {/* tail fin */}
      <path d="M185 20 L195 30 L185 34 Z" />
      {/* tail rotor */}
      <rect x="192" y="22" width="1.5" height="16" />
      {/* landing gear / stub wings */}
      <rect x="70" y="42" width="3" height="8" />
      <rect x="120" y="42" width="3" height="8" />
      <rect x="55" y="50" width="80" height="2" />
      {/* cockpit window */}
      <path d="M42 28 Q48 22 62 22 L70 22 L70 30 L44 30 Z" fill="white" opacity="0.25" />
    </svg>
  );
}

interface Row {
  dn: string;
  acType: string;
  toTime: string;
  pilot: string;
  coPilot: string;
  crewMen: string;
  msnDuty: string;
  duration: string;
  fuel: string;
  configuration: string;
  remarks: string;
  atcTakeoff: string;
  atcLanding: string;
}

interface AcNeed {
  main: string;
  stby: string;
}

interface Program {
  date: string;
  mode: Mode;
  dayRows: Row[];
  nightRows: Row[];
  mainBriefer: string;
  briefTime: string;
  dayOps: string;
  nightOps: string;
  lecture: string;
  capte: string;
  nightBrief: string;
  reportingTime: string;
  acNeededDay: AcNeed;
  acNeededNight: AcNeed;
  fltCmdr: string;
  sqdnCmdr: string;
}

const STORAGE_PREFIX = "rjaf.flightProgram.";
const DEFAULT_AC_TYPE = "UH-60M";

const emptyRow = (dn: string): Row => ({
  dn,
  acType: DEFAULT_AC_TYPE,
  toTime: "",
  pilot: "",
  coPilot: "",
  crewMen: "",
  msnDuty: "",
  duration: "",
  fuel: "",
  configuration: "",
  remarks: "",
  atcTakeoff: "",
  atcLanding: "",
});

const emptyProgram = (date: string): Program => ({
  date,
  mode: "DAY_AND_NVG",
  dayRows: Array.from({ length: 6 }, () => emptyRow("D")),
  nightRows: Array.from({ length: 6 }, () => emptyRow("NVG")),
  mainBriefer: "",
  briefTime: "0815",
  dayOps: "",
  nightOps: "",
  lecture: "",
  capte: "",
  nightBrief: "",
  reportingTime: "",
  acNeededDay: { main: "", stby: "" },
  acNeededNight: { main: "", stby: "" },
  fltCmdr: "",
  sqdnCmdr: "",
});

const loadProgram = (date: string): Program => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + date);
    if (!raw) return emptyProgram(date);
    const parsed = JSON.parse(raw) as Partial<Program>;
    return { ...emptyProgram(date), ...parsed };
  } catch {
    return emptyProgram(date);
  }
};

const saveProgram = (p: Program) => {
  localStorage.setItem(STORAGE_PREFIX + p.date, JSON.stringify(p));
};

const dayOfWeek = (iso: string, lang: string): string => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(lang === "ar" ? "ar" : "en-US", { weekday: "long" });
};

export default function FlightProgram() {
  const { t, lang, dir } = useI18n();
  const pilotsQ = usePilots();
  const PILOTS = pilotsQ.data;

  const todayIso = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState<string>(todayIso);
  const [prog, setProg] = useState<Program>(() => loadProgram(todayIso));
  const [savedFlash, setSavedFlash] = useState(false);

  // When the date changes, swap to the program for that date (or a fresh
  // one if none has been saved yet). This mirrors the Excel workflow where
  // each day is its own sheet.
  useEffect(() => {
    setProg(loadProgram(date));
  }, [date]);

  const pilotOptions = useMemo(
    () =>
      PILOTS.map((p) => ({
        value: p.name,
        label: `${p.rank} ${p.name}`,
      })),
    [PILOTS],
  );

  const updateRow = (section: "dayRows" | "nightRows", idx: number, patch: Partial<Row>) => {
    setProg((pr) => {
      const rows = pr[section].slice();
      rows[idx] = { ...rows[idx], ...patch };
      return { ...pr, [section]: rows };
    });
  };

  const update = <K extends keyof Program>(k: K, v: Program[K]) => {
    setProg((pr) => ({ ...pr, [k]: v }));
  };

  const doSave = () => {
    saveProgram(prog);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  };

  const showDay =
    prog.mode === "DAY" ||
    prog.mode === "DAY_AND_NVG" ||
    prog.mode === "DAY_AND_NIGHT";
  const showNight =
    prog.mode === "NIGHT" ||
    prog.mode === "NVG" ||
    prog.mode === "DAY_AND_NVG" ||
    prog.mode === "DAY_AND_NIGHT";
  // NIGHT section label tracks the mode: "NVG" when the night block is
  // NVG-only, "NIGHT" otherwise (matches the two Excel tabs: DAY&NVG / DAY).
  const nightLabel =
    prog.mode === "NVG" || prog.mode === "DAY_AND_NVG" ? "NVG" : "NIGHT";
  const defaultNightDn = nightLabel === "NVG" ? "NVG" : "N";

  return (
    <div className="space-y-3" dir={dir}>
      {/* Toolbar — hidden on print. */}
      <div className="no-print flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value || todayIso)}
          className="px-2 py-1.5 rounded-md bg-input border border-border text-sm tabular-nums"
          data-testid="input-fp-date"
        />
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => update("mode", m.id)}
              className={`px-3 py-1.5 text-xs font-medium ${
                prog.mode === m.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/40 hover:bg-secondary"
              }`}
              data-testid={`button-mode-${m.id}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={doSave} data-testid="button-save-program">
          <Save className="h-3.5 w-3.5 me-1" />
          {savedFlash ? t("saved") : t("save")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.print()} data-testid="button-print-program">
          <Printer className="h-3.5 w-3.5 me-1" />
          {t("print")}
        </Button>
      </div>

      {/* Printable form. Kept as a single bordered sheet so it prints like
          the original Excel schedule. */}
      <div
        id="flight-program-sheet"
        className="bg-white text-black border border-black p-3 space-y-2 text-[11px] print:text-[10px] print:p-2"
        dir="ltr"
      >
        {/* Header — matches the printed RJAF template exactly:
            CLASSIFIED banner on top, 5 helicopter silhouettes row,
            then three stacked title lines with the emblem to the left. */}
        <div className="text-center text-[10px] font-bold tracking-[0.4em]">CLASSIFIED</div>
        <div className="flex items-center justify-between text-black px-2 -my-1">
          <Helo className="h-5 w-16" />
          <Helo className="h-5 w-16" />
          <Helo className="h-5 w-16" />
          <Helo className="h-5 w-16" />
          <Helo className="h-5 w-16" />
        </div>
        <div className="flex items-center justify-center gap-4">
          <img src={emblem} alt="" className="h-16 w-16 object-contain" />
          <div className="text-center leading-tight">
            <div className="text-sm font-bold">KING ABDULLAH II AIRBASE</div>
            <div className="text-sm font-bold">NO.8 SQDN</div>
            <div className="text-base font-bold underline tracking-wider mt-0.5">FLIGHT SCHEDULE</div>
          </div>
        </div>

        {/* Day + Date row */}
        <div className="flex items-center justify-between border-t border-b border-black py-1 px-1">
          <div className="font-semibold">
            DAY : <span className="font-normal">{dayOfWeek(date, lang) || "________"}</span>
          </div>
          <div className="font-semibold">
            DATE : <span className="font-normal font-mono">{date || "00-00-0000"}</span>
          </div>
        </div>

        {/* Main table. One <table> spans DAY + NIGHT sections with
            band headers between them — matches the Excel layout. */}
        <table className="w-full border-collapse border border-black">
          <thead className="bg-gray-200">
            <tr>
              <Th w="3%" rowSpan={2}>NO</Th>
              <Th w="5%" rowSpan={2}>D/N</Th>
              <Th w="7%" rowSpan={2}>A/C TYPE</Th>
              <Th w="6%" rowSpan={2}>T/O TIME</Th>
              <Th colSpan={3}>CREW</Th>
              <Th w="11%" rowSpan={2}>MSN \ DUTY</Th>
              <Th w="5%" rowSpan={2}>DUR.</Th>
              <Th w="5%" rowSpan={2}>FUEL</Th>
              <Th w="12%" rowSpan={2}>CONFIGURATION</Th>
              <Th w="11%" rowSpan={2}>REMARKS</Th>
              <Th colSpan={2}>ATC USE</Th>
            </tr>
            <tr>
              <Th w="9%">PILOT</Th>
              <Th w="9%">CO-PILOT</Th>
              <Th w="8%">CREW-MEN</Th>
              <Th w="5%">TAKE OFF</Th>
              <Th w="5%">LANDING</Th>
            </tr>
          </thead>
          <tbody>
            {showDay && (
              <>
                <tr>
                  <td colSpan={14} className="border border-black bg-gray-100 text-center font-bold py-0.5">
                    DAY
                  </td>
                </tr>
                {prog.dayRows.map((r, i) => (
                  <RowInputs
                    key={`d${i}`}
                    index={i + 1}
                    row={r}
                    pilotOptions={pilotOptions}
                    onChange={(patch) => updateRow("dayRows", i, patch)}
                  />
                ))}
              </>
            )}

            {showNight && (
              <>
                <tr>
                  <td colSpan={14} className="border border-black bg-gray-100 text-center font-bold py-0.5">
                    {nightLabel}
                  </td>
                </tr>
                {prog.nightRows.map((r, i) => (
                  <RowInputs
                    key={`n${i}`}
                    index={i + 1}
                    row={{ ...r, dn: r.dn || defaultNightDn }}
                    pilotOptions={pilotOptions}
                    onChange={(patch) => updateRow("nightRows", i, patch)}
                  />
                ))}
              </>
            )}
          </tbody>
        </table>

        {/* Briefing row */}
        <table className="w-full border-collapse border border-black">
          <thead className="bg-gray-200">
            <tr>
              <Th>MAIN BRIEFER</Th>
              <Th>BRIEF TIME</Th>
              <Th>DAY OPS</Th>
              <Th>NIGHT OPS</Th>
              <Th>LECTURE</Th>
              <Th>CAPTE</Th>
              <Th>NIGHT BRIEF</Th>
              <Th>REPORTING TIME</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <CellInput value={prog.mainBriefer} onChange={(v) => update("mainBriefer", v)} />
              <CellInput value={prog.briefTime} onChange={(v) => update("briefTime", v)} />
              <CellInput value={prog.dayOps} onChange={(v) => update("dayOps", v)} />
              <CellInput value={prog.nightOps} onChange={(v) => update("nightOps", v)} />
              <CellInput value={prog.lecture} onChange={(v) => update("lecture", v)} />
              <CellInput value={prog.capte} onChange={(v) => update("capte", v)} />
              <CellInput value={prog.nightBrief} onChange={(v) => update("nightBrief", v)} />
              <CellInput value={prog.reportingTime} onChange={(v) => update("reportingTime", v)} />
            </tr>
          </tbody>
        </table>

        {/* Bottom strip — A/C NEEDED table on the left, FLT.CMDR and
            SQDN.CMDR inline to its right, matching rows 31-34 of the
            original worksheet. */}
        <div className="grid grid-cols-12 gap-3 items-end">
          <table className="col-span-4 border-collapse border border-black text-[10px]">
            <thead className="bg-gray-200">
              <tr>
                <Th rowSpan={2}>A/C NEEDED</Th>
                <Th colSpan={2}>UH-60M</Th>
              </tr>
              <tr>
                <Th>MAIN</Th>
                <Th>STBY</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-black bg-gray-100 text-center font-semibold">DAY</td>
                <CellInput value={prog.acNeededDay.main} onChange={(v) => update("acNeededDay", { ...prog.acNeededDay, main: v })} />
                <CellInput value={prog.acNeededDay.stby} onChange={(v) => update("acNeededDay", { ...prog.acNeededDay, stby: v })} />
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 text-center font-semibold">NIGHT</td>
                <CellInput value={prog.acNeededNight.main} onChange={(v) => update("acNeededNight", { ...prog.acNeededNight, main: v })} />
                <CellInput value={prog.acNeededNight.stby} onChange={(v) => update("acNeededNight", { ...prog.acNeededNight, stby: v })} />
              </tr>
            </tbody>
          </table>

          <div className="col-span-4 pb-1">
            <div className="font-semibold text-[11px] mb-1">FLT.CMDR</div>
            <input
              value={prog.fltCmdr}
              onChange={(e) => update("fltCmdr", e.target.value)}
              placeholder="LTC AUDEH …………."
              className="w-full bg-transparent border-b border-black outline-none px-1 text-[11px]"
              data-testid="input-flt-cmdr"
            />
          </div>
          <div className="col-span-4 pb-1">
            <div className="font-semibold text-[11px] mb-1">SQDN.CMDR</div>
            <input
              value={prog.sqdnCmdr}
              onChange={(e) => update("sqdnCmdr", e.target.value)}
              placeholder="LTC. BILAL ………………"
              className="w-full bg-transparent border-b border-black outline-none px-1 text-[11px]"
              data-testid="input-sqdn-cmdr"
            />
          </div>
        </div>

        <div className="text-center text-[10px] font-bold tracking-[0.4em] pt-1">CLASSIFIED</div>
      </div>

      {/* Print styles: hide everything outside the sheet, expand to page. */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          body * { visibility: hidden; }
          #flight-program-sheet, #flight-program-sheet * { visibility: visible; }
          #flight-program-sheet { position: absolute; inset: 0; width: 100%; border: none; }
          .no-print { display: none !important; }
          input, select { border: none !important; }
        }
      `}</style>
    </div>
  );
}

function Th({
  children,
  colSpan,
  rowSpan,
  w,
}: {
  children: React.ReactNode;
  colSpan?: number;
  rowSpan?: number;
  w?: string;
}) {
  return (
    <th
      colSpan={colSpan}
      rowSpan={rowSpan}
      style={w ? { width: w } : undefined}
      className="border border-black font-semibold text-[10px] px-1 py-0.5"
    >
      {children}
    </th>
  );
}

function CellInput({
  value,
  onChange,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <td className="border border-black p-0">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-transparent outline-none px-1 py-0.5 text-[10px] ${mono ? "font-mono" : ""}`}
      />
    </td>
  );
}

function RowInputs({
  index,
  row,
  pilotOptions,
  onChange,
}: {
  index: number;
  row: Row;
  pilotOptions: Array<{ value: string; label: string }>;
  onChange: (patch: Partial<Row>) => void;
}) {
  return (
    <tr>
      <td className="border border-black text-center font-semibold bg-gray-50">{index}</td>
      <CellInput value={row.dn} onChange={(v) => onChange({ dn: v })} mono />
      <CellInput value={row.acType} onChange={(v) => onChange({ acType: v })} />
      <CellInput value={row.toTime} onChange={(v) => onChange({ toTime: v })} mono />
      <td className="border border-black p-0">
        <input
          list="fp-pilots"
          value={row.pilot}
          onChange={(e) => onChange({ pilot: e.target.value })}
          className="w-full bg-transparent outline-none px-1 py-0.5 text-[10px]"
        />
      </td>
      <td className="border border-black p-0">
        <input
          list="fp-pilots"
          value={row.coPilot}
          onChange={(e) => onChange({ coPilot: e.target.value })}
          className="w-full bg-transparent outline-none px-1 py-0.5 text-[10px]"
        />
      </td>
      <CellInput value={row.crewMen} onChange={(v) => onChange({ crewMen: v })} />
      <CellInput value={row.msnDuty} onChange={(v) => onChange({ msnDuty: v })} />
      <CellInput value={row.duration} onChange={(v) => onChange({ duration: v })} mono />
      <CellInput value={row.fuel} onChange={(v) => onChange({ fuel: v })} mono />
      <CellInput value={row.configuration} onChange={(v) => onChange({ configuration: v })} />
      <CellInput value={row.remarks} onChange={(v) => onChange({ remarks: v })} />
      <CellInput value={row.atcTakeoff} onChange={(v) => onChange({ atcTakeoff: v })} mono />
      <CellInput value={row.atcLanding} onChange={(v) => onChange({ atcLanding: v })} mono />
      <datalist id="fp-pilots">
        {pilotOptions.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </datalist>
    </tr>
  );
}
