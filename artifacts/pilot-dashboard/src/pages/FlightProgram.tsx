import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePilots } from "@/lib/squadron-data";
import { Button } from "@/components/ui/button";
import { Printer, Save, Settings, Plus, X } from "lucide-react";
import emblem from "@assets/rjaf_emblem.png";
import heloCobra from "@assets/fp_media/image1.jpg";
import heloBlackhawk from "@assets/fp_media/image2.jpg";
import heloLittleBird from "@assets/fp_media/image3.jpg";
import heloHeavy from "@assets/fp_media/image4.jpg";

type Mode = "DAY" | "NIGHT" | "NVG" | "DAY_AND_NVG" | "DAY_AND_NIGHT";

const MODES: { id: Mode; label: string }[] = [
  { id: "DAY", label: "DAY" },
  { id: "NIGHT", label: "NIGHT" },
  { id: "NVG", label: "NVG" },
  { id: "DAY_AND_NVG", label: "DAY & NVG" },
  { id: "DAY_AND_NIGHT", label: "DAY & NIGHT" },
];

// The helicopter silhouettes are the exact images embedded in the
// original RJAF flight schedule workbook (image1..4.jpg from the xlsx).

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
  airbase: string;
  squadron: string;
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

interface Defaults {
  airbase: string;
  squadron: string;
  fltCmdr: string;
  sqdnCmdr: string;
}

const STORAGE_PREFIX = "rjaf.flightProgram.";
const DEFAULTS_KEY = "rjaf.flightProgram.defaults";
const DEFAULT_AC_TYPE = "UH-60M";
const FACTORY_DEFAULTS: Defaults = {
  airbase: "KING ABDULLAH II AIRBASE",
  squadron: "NO.8 SQDN",
  fltCmdr: "",
  sqdnCmdr: "",
};

const loadDefaults = (): Defaults => {
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY);
    if (!raw) return { ...FACTORY_DEFAULTS };
    return { ...FACTORY_DEFAULTS, ...(JSON.parse(raw) as Partial<Defaults>) };
  } catch {
    return { ...FACTORY_DEFAULTS };
  }
};

const saveDefaults = (d: Defaults) => {
  localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d));
};

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

const emptyProgram = (date: string, defaults: Defaults): Program => ({
  date,
  mode: "DAY_AND_NVG",
  airbase: defaults.airbase,
  squadron: defaults.squadron,
  dayRows: [emptyRow("D")],
  nightRows: [emptyRow("NVG")],
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
  fltCmdr: defaults.fltCmdr,
  sqdnCmdr: defaults.sqdnCmdr,
});

const loadProgram = (date: string, defaults: Defaults): Program => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + date);
    if (!raw) return emptyProgram(date, defaults);
    const parsed = JSON.parse(raw) as Partial<Program>;
    return { ...emptyProgram(date, defaults), ...parsed };
  } catch {
    return emptyProgram(date, defaults);
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
  const [defaults, setDefaults] = useState<Defaults>(() => loadDefaults());
  const [date, setDate] = useState<string>(todayIso);
  const [prog, setProg] = useState<Program>(() => loadProgram(todayIso, loadDefaults()));
  const [savedFlash, setSavedFlash] = useState(false);
  const [showDefaults, setShowDefaults] = useState(false);

  // When the date changes, swap to the program for that date (or a fresh
  // one if none has been saved yet). This mirrors the Excel workflow where
  // each day is its own sheet.
  useEffect(() => {
    setProg(loadProgram(date, defaults));
  }, [date, defaults]);

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

  const addRow = (section: "dayRows" | "nightRows") => {
    setProg((pr) => ({
      ...pr,
      [section]: [...pr[section], emptyRow(section === "dayRows" ? "D" : defaultNightDn)],
    }));
  };

  const removeRow = (section: "dayRows" | "nightRows", idx: number) => {
    setProg((pr) => {
      const rows = pr[section].slice();
      rows.splice(idx, 1);
      return { ...pr, [section]: rows.length ? rows : [emptyRow(section === "dayRows" ? "D" : defaultNightDn)] };
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
        <Button size="sm" variant="outline" onClick={() => setShowDefaults((v) => !v)} data-testid="button-fp-defaults">
          <Settings className="h-3.5 w-3.5 me-1" />
          Defaults
        </Button>
      </div>

      {/* Defaults panel — values here are applied automatically to every
          new day's program so the user doesn't re-type them. Changing
          defaults does not retroactively alter previously-saved days. */}
      {showDefaults && (
        <div className="no-print border border-border rounded-md p-3 bg-secondary/30 grid md:grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-xs">Airbase (default)</span>
            <input
              value={defaults.airbase}
              onChange={(e) => setDefaults((d) => ({ ...d, airbase: e.target.value }))}
              className="px-2 py-1.5 rounded-md bg-input border border-border"
              data-testid="input-default-airbase"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-xs">Squadron (default)</span>
            <input
              value={defaults.squadron}
              onChange={(e) => setDefaults((d) => ({ ...d, squadron: e.target.value }))}
              className="px-2 py-1.5 rounded-md bg-input border border-border"
              data-testid="input-default-squadron"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-xs">FLT.CMDR (default)</span>
            <input
              value={defaults.fltCmdr}
              onChange={(e) => setDefaults((d) => ({ ...d, fltCmdr: e.target.value }))}
              className="px-2 py-1.5 rounded-md bg-input border border-border"
              data-testid="input-default-fltcmdr"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-xs">SQDN.CMDR (default)</span>
            <input
              value={defaults.sqdnCmdr}
              onChange={(e) => setDefaults((d) => ({ ...d, sqdnCmdr: e.target.value }))}
              className="px-2 py-1.5 rounded-md bg-input border border-border"
              data-testid="input-default-sqdncmdr"
            />
          </label>
          <div className="md:col-span-2 flex gap-2 items-center">
            <Button
              size="sm"
              onClick={() => {
                saveDefaults(defaults);
                // Also fill blanks on the current program from the new defaults.
                setProg((p) => ({
                  ...p,
                  airbase: p.airbase || defaults.airbase,
                  squadron: p.squadron || defaults.squadron,
                  fltCmdr: p.fltCmdr || defaults.fltCmdr,
                  sqdnCmdr: p.sqdnCmdr || defaults.sqdnCmdr,
                }));
                setShowDefaults(false);
              }}
              data-testid="button-save-defaults"
            >
              Save defaults
            </Button>
            <span className="text-xs text-muted-foreground">
              Applied to new days automatically. Existing days keep their values unless blank.
            </span>
          </div>
        </div>
      )}

      {/* Printable form. Kept as a single bordered sheet so it prints like
          the original Excel schedule. */}
      <div
        id="flight-program-sheet"
        className="bg-white text-black border border-black p-3 space-y-2 text-[11px] print:text-[10px] print:p-2"
        dir="ltr"
      >
        {/* Header — reproduces the original XLSX drawing pixel-for-pixel.
            Positions/sizes are exact percentages of the drawing bounding box
            (extracted from xl/drawings/drawing1.xml of the source template). */}
        <div className="text-center text-[10px] font-bold tracking-[0.4em]">CLASSIFIED</div>
        <div className="relative w-full" style={{ aspectRatio: "20363369 / 2438400" }}>
          {/* Blackhawk — far left */}
          <img
            src={heloBlackhawk}
            alt=""
            className="absolute object-contain"
            style={{ left: "0%", top: "28.12%", width: "14.69%", height: "67.41%" }}
          />
          {/* Heavy-lift — left of center */}
          <img
            src={heloHeavy}
            alt=""
            className="absolute object-contain"
            style={{ left: "20.23%", top: "9.37%", width: "17.10%", height: "90.62%" }}
          />
          {/* RJAF emblem — center */}
          <img
            src={emblem}
            alt=""
            className="absolute object-contain"
            style={{ left: "42.47%", top: "0%", width: "12.38%", height: "57.03%" }}
          />
          {/* Little Bird — right of center */}
          <img
            src={heloLittleBird}
            alt=""
            className="absolute object-contain"
            style={{ left: "65.00%", top: "28.68%", width: "12.37%", height: "53.35%" }}
          />
          {/* Cobra — far right, rotated ~-4° like the original */}
          <img
            src={heloCobra}
            alt=""
            className="absolute object-contain"
            style={{
              left: "80.72%",
              top: "17.35%",
              width: "19.28%",
              height: "47.25%",
              transform: "rotate(-4.05deg)",
              transformOrigin: "center",
            }}
          />
        </div>

        {/* Title text block — sits BELOW the helicopter row, like the original */}
        <div className="text-center leading-tight">
          <input
            value={prog.airbase}
            onChange={(e) => update("airbase", e.target.value)}
            className="text-sm font-bold bg-transparent text-center outline-none hover:bg-yellow-50 focus:bg-yellow-50 w-[28ch]"
            data-testid="input-airbase"
          />
          <input
            value={prog.squadron}
            onChange={(e) => update("squadron", e.target.value)}
            className="text-sm font-bold bg-transparent text-center outline-none hover:bg-yellow-50 focus:bg-yellow-50 w-[20ch] block mx-auto"
            data-testid="input-squadron"
          />
          <div className="text-base font-bold underline tracking-wider mt-0.5">FLIGHT SCHEDULE</div>
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
                    onRemove={prog.dayRows.length > 1 ? () => removeRow("dayRows", i) : undefined}
                  />
                ))}
                <tr className="no-print">
                  <td colSpan={14} className="border border-black bg-white text-left p-1">
                    <button
                      type="button"
                      onClick={() => addRow("dayRows")}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 hover:underline"
                      data-testid="button-add-day-row"
                    >
                      <Plus className="h-3 w-3" /> Add day row
                    </button>
                  </td>
                </tr>
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
                    onRemove={prog.nightRows.length > 1 ? () => removeRow("nightRows", i) : undefined}
                  />
                ))}
                <tr className="no-print">
                  <td colSpan={14} className="border border-black bg-white text-left p-1">
                    <button
                      type="button"
                      onClick={() => addRow("nightRows")}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 hover:underline"
                      data-testid="button-add-night-row"
                    >
                      <Plus className="h-3 w-3" /> Add {nightLabel.toLowerCase()} row
                    </button>
                  </td>
                </tr>
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
              className="w-full bg-transparent border-b border-black outline-none px-1 text-[11px] text-center"
              data-testid="input-flt-cmdr"
            />
          </div>
          <div className="col-span-4 pb-1">
            <div className="font-semibold text-[11px] mb-1">SQDN.CMDR</div>
            <input
              value={prog.sqdnCmdr}
              onChange={(e) => update("sqdnCmdr", e.target.value)}
              placeholder="LTC. BILAL ………………"
              className="w-full bg-transparent border-b border-black outline-none px-1 text-[11px] text-center"
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
        className={`w-full bg-transparent outline-none px-1 py-0.5 text-[10px] text-center ${mono ? "font-mono" : ""}`}
      />
    </td>
  );
}

function RowInputs({
  index,
  row,
  pilotOptions,
  onChange,
  onRemove,
}: {
  index: number;
  row: Row;
  pilotOptions: Array<{ value: string; label: string }>;
  onChange: (patch: Partial<Row>) => void;
  onRemove?: () => void;
}) {
  return (
    <tr className="group">
      <td className="border border-black text-center font-semibold bg-gray-50 relative">
        {index}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Delete row"
            className="no-print absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center"
            data-testid={`button-remove-row-${index}`}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </td>
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
