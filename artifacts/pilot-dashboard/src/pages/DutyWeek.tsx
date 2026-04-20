import { useEffect, useMemo, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { usePilots } from "@/lib/squadron-data";
import { Printer, Save, RotateCcw } from "lucide-react";

const AR_DAYS = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

const AR_DIGITS = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
function toArabicDigits(s: string | number): string {
  return String(s).replace(/[0-9]/g, d => AR_DIGITS[parseInt(d, 10)]);
}

const AR_NUMBER_NAMES: Record<string, string> = {
  "1": "الأول", "2": "الثاني", "3": "الثالث", "4": "الرابع", "5": "الخامس",
  "6": "السادس", "7": "السابع", "8": "الثامن", "9": "التاسع", "10": "العاشر",
  "11": "الحادي عشر", "12": "الثاني عشر",
};

interface DutyRow { rank1: string; name1: string; phone1: string; rank2: string; name2: string; phone2: string; }
const EMPTY_ROW: DutyRow = { rank1: "", name1: "", phone1: "", rank2: "", name2: "", phone2: "" };

const RANK_OPTIONS = [
  "ملازم طيار",
  "ملازم/١ طيار",
  "نقيب طيار",
  "رائد طيار",
  "مقدم طيار",
  "عقيد طيار",
];

function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmtDate(d: Date): string {
  // YYYY/M/D in Arabic-Indic digits to match the paper sheet exactly.
  return toArabicDigits(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`);
}
// Default to the upcoming Sunday so the first row of the roster lines up
// with the squadron's working week (Sun–Sat is the JOAF convention).
function nextSunday(): Date {
  const today = new Date();
  const dow = today.getDay(); // 0 = Sunday
  const offset = dow === 0 ? 0 : 7 - dow;
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
}

export default function DutyWeek() {
  const auth = useAuth();
  const { data: pilots } = usePilots();

  const sqnNumber = auth.squadron?.number ?? "8";
  const sqnNameAr = useMemo(() => {
    const num = String(sqnNumber).trim();
    return `السرب ${AR_NUMBER_NAMES[num] ?? toArabicDigits(num)}`;
  }, [sqnNumber]);

  const [start, setStart] = useState<string>(() => isoDay(nextSunday()));
  const startDate = useMemo(() => new Date(start + "T00:00:00"), [start]);
  const endDate = useMemo(() => addDays(startDate, 6), [startDate]);

  const storageKey = `rjaf.dutyRoster.${sqnNumber}.${start}`;
  const [rows, setRows] = useState<DutyRow[]>(() => Array.from({ length: 7 }, () => ({ ...EMPTY_ROW })));
  const [commanderName, setCommanderName] = useState<string>(() => localStorage.getItem("rjaf.dutyRoster.commanderName") ?? "");
  const [commanderRank, setCommanderRank] = useState<string>(() => localStorage.getItem("rjaf.dutyRoster.commanderRank") ?? "المقدم الركن الطيار");
  // Every text label on the printed sheet is editable so each squadron can
  // tailor the roster to its own conventions (e.g. rename "وظيفة الطائر (١)"
  // to "المداوم الأول" / "احتياط" / etc.). Stored per-squadron so two
  // squadrons sharing the dashboard never overwrite each other.
  const labelKey = `rjaf.dutyRoster.labels.${sqnNumber}`;
  type Labels = {
    bismillah: string;
    title: string;        // مناوبات السرب الثامن
    periodPrefix: string; // خلال الفترة
    periodLink: string;   // ولغاية
    pos1Header: string;   // وظيفة الطائر (١)
    pos2Header: string;   // وظيفة الطائر (٢)
    rankCol: string;      // الرتبة
    nameCol: string;      // الاسم
    phoneCol: string;     // رقم الهاتف
    dateCol: string;      // اليوم والتاريخ
    cmdrCaption: string;  // قائد سرب طيران قوة الفعل السريع/السرب الثامن
  };
  const defaultLabels = (): Labels => ({
    bismillah: "بسم الله الرحمن الرحيم",
    title: `مناوبات ${sqnNameAr}`,
    periodPrefix: "خلال الفترة",
    periodLink: "ولغاية",
    pos1Header: "وظيفة الطائر (١)",
    pos2Header: "وظيفة الطائر (٢)",
    rankCol: "الرتبة",
    nameCol: "الاسم",
    phoneCol: "رقم الهاتف",
    dateCol: "اليوم والتاريخ",
    cmdrCaption: `قائد سرب طيران قوة الفعل السريع/${sqnNameAr}`,
  });
  const [labels, setLabels] = useState<Labels>(defaultLabels);
  useEffect(() => {
    const raw = localStorage.getItem(labelKey);
    if (raw) {
      try { setLabels({ ...defaultLabels(), ...JSON.parse(raw) }); return; } catch { /* fall through */ }
    }
    setLabels(defaultLabels());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelKey, sqnNameAr]);
  function setLabel<K extends keyof Labels>(k: K, v: Labels[K]) {
    setLabels(prev => ({ ...prev, [k]: v }));
  }
  function resetLabels() {
    if (!confirm("استعادة كل التسميات الافتراضية؟")) return;
    const d = defaultLabels();
    setLabels(d);
    localStorage.setItem(labelKey, JSON.stringify(d));
  }
  const [savedFlash, setSavedFlash] = useState(false);

  // Reload the roster whenever the user switches the start date or moves to
  // another squadron's PC. Each (squadron, week) tuple has its own slot in
  // localStorage so different commanders never overwrite each other.
  useEffect(() => {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      try { setRows(JSON.parse(raw)); return; } catch { /* fall through */ }
    }
    setRows(Array.from({ length: 7 }, () => ({ ...EMPTY_ROW })));
  }, [storageKey]);

  function updateRow(i: number, patch: Partial<DutyRow>) {
    setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  // When a name is typed/picked, look up the matching pilot from the live
  // roster and prefill their rank + phone so the user doesn't have to retype
  // it. They can still edit either field afterwards.
  function autofillFromRoster(slot: 1 | 2, i: number, name: string) {
    const trimmed = name.trim();
    const match = pilots.find(p => p.arabicName?.trim() === trimmed || p.name?.trim() === trimmed);
    if (!match) {
      if (slot === 1) updateRow(i, { name1: name });
      else updateRow(i, { name2: name });
      return;
    }
    if (slot === 1) updateRow(i, { name1: match.arabicName || match.name, rank1: match.rank || "", phone1: match.phone || "" });
    else updateRow(i, { name2: match.arabicName || match.name, rank2: match.rank || "", phone2: match.phone || "" });
  }

  function save() {
    localStorage.setItem(storageKey, JSON.stringify(rows));
    localStorage.setItem("rjaf.dutyRoster.commanderName", commanderName);
    localStorage.setItem("rjaf.dutyRoster.commanderRank", commanderRank);
    localStorage.setItem(labelKey, JSON.stringify(labels));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  function clearAll() {
    if (!confirm("مسح كل المداومين لهذا الأسبوع؟")) return;
    setRows(Array.from({ length: 7 }, () => ({ ...EMPTY_ROW })));
  }

  function printRoster() { window.print(); }

  return (
    <div>
      <PageHead title="مناوبات السرب" subtitle="جدول المناوبة الأسبوعي — قابل للطباعة والتعديل" />

      <div className="flex flex-wrap items-center gap-2 mb-3 print:hidden">
        <label className="text-sm font-medium">تاريخ البداية:</label>
        <input
          type="date"
          value={start}
          onChange={e => setStart(e.target.value)}
          className="px-2 py-1 rounded border border-border bg-input text-sm"
          data-testid="input-duty-start"
        />
        <Button size="sm" onClick={save} data-testid="button-duty-save">
          <Save className="h-3.5 w-3.5 me-1" /> حفظ
        </Button>
        <Button size="sm" variant="outline" onClick={printRoster} data-testid="button-duty-print">
          <Printer className="h-3.5 w-3.5 me-1" /> طباعة
        </Button>
        <Button size="sm" variant="outline" onClick={clearAll} data-testid="button-duty-clear">
          <RotateCcw className="h-3.5 w-3.5 me-1" /> تفريغ
        </Button>
        <Button size="sm" variant="ghost" onClick={resetLabels} data-testid="button-duty-reset-labels" title="استعادة كل التسميات الافتراضية">
          استعادة التسميات
        </Button>
        {savedFlash && <span className="text-xs text-emerald-600 font-medium">تم الحفظ ✓</span>}
      </div>

      <Card className="!p-6 print:!p-2 print:shadow-none print:border-none" >
        <div dir="rtl" className="font-arabic">
          <input
            value={labels.bismillah}
            onChange={e => setLabel("bismillah", e.target.value)}
            className="block mx-auto text-center text-xs text-muted-foreground mb-1 bg-transparent w-full max-w-md border-0 outline-none focus:bg-secondary/30 rounded px-1 print:text-black"
            data-testid="input-label-bismillah"
          />
          <input
            value={labels.title}
            onChange={e => setLabel("title", e.target.value)}
            className="block mx-auto text-center text-xl font-bold mb-2 bg-transparent w-full max-w-xl border-0 outline-none focus:bg-secondary/30 rounded px-1 print:text-black"
            data-testid="input-label-title"
          />

          <div className="mx-auto mb-3 inline-flex items-center justify-center gap-1 px-4 py-1 border border-foreground text-sm print:text-black w-full text-center">
            <input
              value={labels.periodPrefix}
              onChange={e => setLabel("periodPrefix", e.target.value)}
              className="bg-transparent border-0 outline-none focus:bg-secondary/30 rounded px-1 text-center w-[110px]"
              data-testid="input-label-periodPrefix"
            />
            <span>{fmtDate(startDate)}</span>
            <input
              value={labels.periodLink}
              onChange={e => setLabel("periodLink", e.target.value)}
              className="bg-transparent border-0 outline-none focus:bg-secondary/30 rounded px-1 text-center w-[70px]"
              data-testid="input-label-periodLink"
            />
            <span>{fmtDate(endDate)}</span>
          </div>

          <table className="w-full border-collapse text-sm print:text-[12px] print:text-black">
            <thead>
              <tr className="bg-secondary/40 print:bg-transparent">
                <th rowSpan={2} className="border border-foreground px-2 py-1 align-middle w-[14%]">
                  <input value={labels.dateCol} onChange={e => setLabel("dateCol", e.target.value)}
                    className="w-full bg-transparent border-0 outline-none focus:bg-secondary/30 rounded px-1 text-center font-bold print:text-black"
                    data-testid="input-label-dateCol" />
                </th>
                <th colSpan={3} className="border border-foreground px-2 py-1">
                  <input value={labels.pos1Header} onChange={e => setLabel("pos1Header", e.target.value)}
                    className="w-full bg-transparent border-0 outline-none focus:bg-secondary/30 rounded px-1 text-center font-bold print:text-black"
                    data-testid="input-label-pos1Header" />
                </th>
                <th colSpan={3} className="border border-foreground px-2 py-1">
                  <input value={labels.pos2Header} onChange={e => setLabel("pos2Header", e.target.value)}
                    className="w-full bg-transparent border-0 outline-none focus:bg-secondary/30 rounded px-1 text-center font-bold print:text-black"
                    data-testid="input-label-pos2Header" />
                </th>
              </tr>
              <tr className="bg-secondary/30 print:bg-transparent">
                <th className="border border-foreground px-2 py-1"><input value={labels.rankCol} onChange={e => setLabel("rankCol", e.target.value)} className="w-full bg-transparent border-0 outline-none focus:bg-secondary/30 rounded px-1 text-center font-bold print:text-black" data-testid="input-label-rankCol-1" /></th>
                <th className="border border-foreground px-2 py-1"><input value={labels.nameCol} onChange={e => setLabel("nameCol", e.target.value)} className="w-full bg-transparent border-0 outline-none focus:bg-secondary/30 rounded px-1 text-center font-bold print:text-black" data-testid="input-label-nameCol-1" /></th>
                <th className="border border-foreground px-2 py-1"><input value={labels.phoneCol} onChange={e => setLabel("phoneCol", e.target.value)} className="w-full bg-transparent border-0 outline-none focus:bg-secondary/30 rounded px-1 text-center font-bold print:text-black" data-testid="input-label-phoneCol-1" /></th>
                <th className="border border-foreground px-2 py-1 text-center font-bold">{labels.rankCol}</th>
                <th className="border border-foreground px-2 py-1 text-center font-bold">{labels.nameCol}</th>
                <th className="border border-foreground px-2 py-1 text-center font-bold">{labels.phoneCol}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const d = addDays(startDate, i);
                return (
                  <tr key={i}>
                    <td className="border border-foreground px-2 py-1 text-center align-middle font-semibold whitespace-nowrap">
                      <div>{AR_DAYS[d.getDay()]}</div>
                      <div className="text-[11px] font-normal">{fmtDate(d)}</div>
                    </td>
                    {/* Position 1 */}
                    <td className="border border-foreground p-0">
                      <input list="rjaf-rank-list" value={r.rank1} onChange={e => updateRow(i, { rank1: e.target.value })}
                        className="w-full px-2 py-1 bg-transparent text-sm text-center print:text-black" data-testid={`input-rank1-${i}`} />
                    </td>
                    <td className="border border-foreground p-0">
                      <input list="rjaf-pilot-list" value={r.name1} onChange={e => autofillFromRoster(1, i, e.target.value)}
                        className="w-full px-2 py-1 bg-transparent text-sm text-center print:text-black" data-testid={`input-name1-${i}`} />
                    </td>
                    <td className="border border-foreground p-0">
                      <input value={r.phone1} onChange={e => updateRow(i, { phone1: e.target.value })}
                        className="w-full px-2 py-1 bg-transparent text-sm text-center font-mono print:text-black" data-testid={`input-phone1-${i}`} />
                    </td>
                    {/* Position 2 */}
                    <td className="border border-foreground p-0">
                      <input list="rjaf-rank-list" value={r.rank2} onChange={e => updateRow(i, { rank2: e.target.value })}
                        className="w-full px-2 py-1 bg-transparent text-sm text-center print:text-black" data-testid={`input-rank2-${i}`} />
                    </td>
                    <td className="border border-foreground p-0">
                      <input list="rjaf-pilot-list" value={r.name2} onChange={e => autofillFromRoster(2, i, e.target.value)}
                        className="w-full px-2 py-1 bg-transparent text-sm text-center print:text-black" data-testid={`input-name2-${i}`} />
                    </td>
                    <td className="border border-foreground p-0">
                      <input value={r.phone2} onChange={e => updateRow(i, { phone2: e.target.value })}
                        className="w-full px-2 py-1 bg-transparent text-sm text-center font-mono print:text-black" data-testid={`input-phone2-${i}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <datalist id="rjaf-rank-list">
            {RANK_OPTIONS.map(r => <option key={r} value={r} />)}
          </datalist>
          <datalist id="rjaf-pilot-list">
            {pilots.map(p => (
              <option key={p.id} value={p.arabicName || p.name}>{p.rank} · {p.phone}</option>
            ))}
          </datalist>

          <div className="mt-10 text-sm print:text-black">
            <div className="flex flex-col items-start">
              <input
                value={commanderRank}
                onChange={e => setCommanderRank(e.target.value)}
                className="bg-transparent border-b border-dotted border-foreground/40 text-sm font-semibold w-[260px] print:border-none"
                data-testid="input-cmdr-rank"
              />
              <input
                value={labels.cmdrCaption}
                onChange={e => setLabel("cmdrCaption", e.target.value)}
                className="bg-transparent border-0 outline-none focus:bg-secondary/30 rounded px-1 text-xs text-muted-foreground print:text-black mt-1 w-[420px] print:border-none"
                data-testid="input-label-cmdrCaption"
              />
              <input
                value={commanderName}
                onChange={e => setCommanderName(e.target.value)}
                placeholder="الاسم الكامل لقائد السرب"
                className="bg-transparent border-b border-dotted border-foreground/40 text-sm w-[260px] mt-1 print:border-none"
                data-testid="input-cmdr-name"
              />
            </div>
          </div>
        </div>
      </Card>

      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>
    </div>
  );
}
