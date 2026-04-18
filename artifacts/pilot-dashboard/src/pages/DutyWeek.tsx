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
        {savedFlash && <span className="text-xs text-emerald-600 font-medium">تم الحفظ ✓</span>}
      </div>

      <Card className="!p-6 print:!p-2 print:shadow-none print:border-none" >
        <div dir="rtl" className="font-arabic">
          <div className="text-center text-xs text-muted-foreground mb-1 print:text-black">بسم الله الرحمن الرحيم</div>
          <div className="text-center text-xl font-bold mb-2 print:text-black">مناوبات {sqnNameAr}</div>

          <div className="mx-auto mb-3 inline-flex items-center justify-center px-4 py-1 border border-foreground text-sm print:text-black w-full text-center">
            <span>خلال الفترة {fmtDate(startDate)} ولغاية {fmtDate(endDate)}</span>
          </div>

          <table className="w-full border-collapse text-sm print:text-[12px] print:text-black">
            <thead>
              <tr className="bg-secondary/40 print:bg-transparent">
                <th rowSpan={2} className="border border-foreground px-2 py-1 align-middle w-[14%]">اليوم والتاريخ</th>
                <th colSpan={3} className="border border-foreground px-2 py-1">وظيفة الطائر (١)</th>
                <th colSpan={3} className="border border-foreground px-2 py-1">وظيفة الطائر (٢)</th>
              </tr>
              <tr className="bg-secondary/30 print:bg-transparent">
                <th className="border border-foreground px-2 py-1">الرتبة</th>
                <th className="border border-foreground px-2 py-1">الاسم</th>
                <th className="border border-foreground px-2 py-1">رقم الهاتف</th>
                <th className="border border-foreground px-2 py-1">الرتبة</th>
                <th className="border border-foreground px-2 py-1">الاسم</th>
                <th className="border border-foreground px-2 py-1">رقم الهاتف</th>
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
              <div className="text-xs text-muted-foreground print:text-black mt-1">قائد سرب طيران قوة الفعل السريع/{sqnNameAr}</div>
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
