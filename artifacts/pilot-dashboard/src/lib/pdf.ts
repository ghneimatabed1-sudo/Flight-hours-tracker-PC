import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
// @ts-expect-error - arabic-reshaper ships only a CommonJS factory with no types.
import ArabicReshaper from "arabic-reshaper";
import { PILOTS, SORTIES, type Pilot } from "./mock";

export type PdfLang = "en" | "ar";

interface SquadronInfo {
  name?: string;
  number?: string;
  base?: string;
}

// ---------- Localization helpers ----------

// Tiny lookup table so the PDF module stays self-contained and is not coupled
// to the React i18n provider (jsPDF is called from event handlers, not React).
const STR = {
  rjaf: { en: "Royal Jordanian Air Force", ar: "سلاح الجو الملكي الأردني" },
  squadron: { en: "Squadron", ar: "السرب" },
  reportDate: { en: "Report date", ar: "تاريخ التقرير" },
  authReport: { en: "Authorization Report", ar: "تقرير الصلاحيات" },
  authReportCont: { en: "Authorization Report (cont.)", ar: "تقرير الصلاحيات (تابع)" },
  pilotDataPage: { en: "Pilot Data Page", ar: "صفحة بيانات الطيار" },
  totalsPage: { en: "Total's Page · Monthly Squadron Totals", ar: "صفحة المجاميع · المجاميع الشهرية للسرب" },
  squadronSummary: { en: "Squadron Summary", ar: "ملخص السرب" },
  squadronSnapshot: { en: "Squadron Snapshot", ar: "لقطة السرب" },
  hoursSummary: { en: "Hours Summary", ar: "ملخص الساعات" },
  currencyExpiry: { en: "Currency Expiry", ar: "انتهاء صلاحية المؤهلات" },
  monthlyByPilot: { en: "Monthly Hours by Pilot", ar: "الساعات الشهرية لكل طيار" },
  asOf: { en: "As of", ar: "حتى تاريخ" },
  confidential: {
    en: "RJAF Squadron Ops · Confidential · Page",
    ar: "عمليات سرب القوات الجوية الملكية الأردنية · سري · صفحة",
  },
  of: { en: "of", ar: "من" },
  // Auth report
  col_num: { en: "#", ar: "#" },
  col_pilot: { en: "Pilot", ar: "الطيار" },
  col_unit: { en: "Unit", ar: "الوحدة" },
  col_dayAuth: { en: "Day Auth", ar: "صلاحية نهار" },
  col_nightAuth: { en: "Night Auth", ar: "صلاحية ليل" },
  col_nvgIrt: { en: "NVG / IRT", ar: "نظارة ليلية / IRT" },
  col_signature: { en: "Signature", ar: "التوقيع" },
  col_day: { en: "Day", ar: "نهار" },
  col_night: { en: "Night", ar: "ليل" },
  col_nvg: { en: "NVG", ar: "نظارة" },
  col_sim: { en: "Sim", ar: "محاكي" },
  col_captain: { en: "Captain", ar: "قائد" },
  col_flying: { en: "Flying", ar: "طيران" },
  col_bucket: { en: "Bucket", ar: "البند" },
  bucket_opening: { en: "Opening", ar: "افتتاح" },
  bucket_month: { en: "Month", ar: "الشهر" },
  bucket_total: { en: "Total", ar: "الإجمالي" },
  // Pilot data
  field_name: { en: "Name", ar: "الاسم" },
  field_arabic: { en: "Arabic", ar: "بالعربية" },
  field_id: { en: "Pilot ID", ar: "رقم الطيار" },
  field_unit: { en: "Unit", ar: "الوحدة" },
  field_phone: { en: "Phone", ar: "الهاتف" },
  field_address: { en: "Address", ar: "العنوان" },
  field_available: { en: "Available", ar: "متاح" },
  field_doctor: { en: "Doctor Note", ar: "ملاحظة الطبيب" },
  yes: { en: "Yes", ar: "نعم" },
  no: { en: "No", ar: "لا" },
  exp_day: { en: "Day", ar: "نهار" },
  exp_night: { en: "Night", ar: "ليل" },
  exp_irt: { en: "IRT", ar: "IRT" },
  exp_medical: { en: "Medical", ar: "طبي" },
  exp_sim: { en: "Sim", ar: "محاكي" },
  // Snapshot
  pilots_strength: { en: "Pilots on Strength", ar: "الطيارون في القوة" },
  pilots_available: { en: "Available Pilots", ar: "الطيارون المتاحون" },
  exp_soon: { en: "Currencies Expiring < 30d", ar: "مؤهلات منتهية خلال 30 يوماً" },
  sortie_count: { en: "Sorties (60-day window)", ar: "الطلعات (نافذة 60 يوماً)" },
  total_hours: { en: "Total Flight Hours (window)", ar: "إجمالي ساعات الطيران (النافذة)" },
  squadron_total: { en: "Squadron Total", ar: "إجمالي السرب" },
  cmdr_sig: { en: "Squadron Commander: ____________________________", ar: "قائد السرب: ____________________________" },
  ops_sig: { en: "Operations Officer:  ____________________________", ar: "ضابط العمليات: ____________________________" },
  date_label: { en: "Date", ar: "التاريخ" },
} as const;

function tr(key: keyof typeof STR, lang: PdfLang): string {
  return STR[key][lang];
}

// Reshape any string that contains Arabic letters into Unicode presentation
// forms (FB50–FEFF) so jsPDF — which lacks OpenType shaping — still draws
// connected letters correctly. ASCII-only strings are returned unchanged.
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F]/;
function shape(text: string | number | undefined | null): string {
  const s = text == null ? "" : String(text);
  if (!ARABIC_RE.test(s)) return s;
  try {
    return ArabicReshaper.convertArabic(s);
  } catch {
    return s;
  }
}

// ---------- Asset loading (emblem + Arabic font) ----------

let cachedEmblem: string | null = null;
async function loadEmblem(): Promise<string> {
  if (cachedEmblem) return cachedEmblem;
  const res = await fetch(`${import.meta.env.BASE_URL}brand/emblem.png`);
  const blob = await res.blob();
  cachedEmblem = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
  return cachedEmblem;
}

let cachedArabicFont: string | null = null;
async function loadArabicFontBase64(): Promise<string> {
  if (cachedArabicFont) return cachedArabicFont;
  const res = await fetch(`${import.meta.env.BASE_URL}fonts/NotoNaskhArabic-Regular.ttf`);
  const buf = await res.arrayBuffer();
  // Convert ArrayBuffer to base64 in chunks to avoid call-stack issues.
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  cachedArabicFont = btoa(bin);
  return cachedArabicFont;
}

const ARABIC_FONT_NAME = "NotoNaskhArabic";
async function setupDoc(lang: PdfLang): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  if (lang === "ar") {
    const b64 = await loadArabicFontBase64();
    doc.addFileToVFS(`${ARABIC_FONT_NAME}.ttf`, b64);
    doc.addFont(`${ARABIC_FONT_NAME}.ttf`, ARABIC_FONT_NAME, "normal");
    doc.setFont(ARABIC_FONT_NAME, "normal");
    doc.setR2L(true);
  }
  return doc;
}

const baseFont = (lang: PdfLang) => (lang === "ar" ? ARABIC_FONT_NAME : "helvetica");

function fmtDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function pilotName(p: Pilot, lang: PdfLang): string {
  if (lang === "ar") {
    // Keep the rank in English for readability when Arabic name is set;
    // some squadrons use the same Arabic rank text everywhere.
    return shape(p.arabicName || p.name);
  }
  return `${p.rank} ${p.name}`;
}

// ---------- Header / Footer ----------

function drawHeader(doc: jsPDF, sqdn: SquadronInfo, title: string, emblem: string, lang: PdfLang) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(212, 175, 55);
  doc.rect(0, 0, w, 26, "F");
  doc.setFillColor(20, 24, 32);
  doc.rect(0, 26, w, 2, "F");

  try {
    doc.addImage(emblem, "PNG", 8, 3, 20, 20);
  } catch { /* ignore */ }

  doc.setTextColor(20, 24, 32);
  doc.setFont(baseFont(lang), "normal");
  doc.setFontSize(13);
  doc.text(shape(tr("rjaf", lang)), 32, 11);
  doc.setFontSize(10);
  const sub = `${shape(sqdn.name || tr("squadron", lang))} · ${sqdn.number || "—"} · ${shape(sqdn.base || "—")}`;
  doc.text(sub, 32, 17);
  doc.setFontSize(8);
  doc.text(`${shape(tr("reportDate", lang))}: ${fmtDate()}`, 32, 22);

  doc.setTextColor(20, 24, 32);
  doc.setFont(baseFont(lang), "normal");
  doc.setFontSize(14);
  doc.text(shape(title), 8, 36);
  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.4);
  doc.line(8, 38, w - 8, 38);
}

function footer(doc: jsPDF, lang: PdfLang) {
  const pageCount = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont(baseFont(lang), "normal");
    doc.setFontSize(7);
    doc.setTextColor(100);
    const text = `${shape(tr("confidential", lang))} ${i} ${shape(tr("of", lang))} ${pageCount}`;
    doc.text(text, w / 2, h - 5, { align: "center" });
  }
}

function save(doc: jsPDF, filename: string) {
  doc.save(filename);
}

// Common autoTable styles per language so the Arabic font is applied to every
// table cell automatically.
function tableStyles(lang: PdfLang) {
  return {
    font: baseFont(lang),
    fontStyle: "normal" as const,
  };
}

// ---------- Authorization Report ----------
export async function exportAuthorizationReport(sqdn: SquadronInfo, lang: PdfLang = "en") {
  const emblem = await loadEmblem();
  const doc = await setupDoc(lang);
  drawHeader(doc, sqdn, tr("authReport", lang), emblem, lang);

  const rows = PILOTS.map((p) => [
    p.id,
    pilotName(p, lang),
    shape(p.unit),
    p.expiry.day,
    p.expiry.night,
    p.expiry.irt,
    "____________",
  ]);

  autoTable(doc, {
    startY: 42,
    head: [[
      tr("col_num", lang), shape(tr("col_pilot", lang)), shape(tr("col_unit", lang)),
      shape(tr("col_dayAuth", lang)), shape(tr("col_nightAuth", lang)),
      shape(tr("col_nvgIrt", lang)), shape(tr("col_signature", lang)),
    ]],
    body: rows,
    styles: { fontSize: 8, cellPadding: 1.6, ...tableStyles(lang) },
    headStyles: { fillColor: [20, 24, 32], textColor: [212, 175, 55], ...tableStyles(lang) },
    columnStyles: { 6: { cellWidth: 36 } },
    margin: { left: 8, right: 8 },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) drawHeader(doc, sqdn, tr("authReportCont", lang), emblem, lang);
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 200;
  doc.setFont(baseFont(lang), "normal");
  doc.setFontSize(9);
  doc.setTextColor(20, 24, 32);
  doc.text(shape(tr("cmdr_sig", lang)), 8, finalY + 14);
  doc.text(shape(tr("ops_sig", lang)), 8, finalY + 22);
  doc.text(`${shape(tr("date_label", lang))}: ${fmtDate()}`, 8, finalY + 30);

  footer(doc, lang);
  save(doc, `authorization-report-${lang}-${fmtDate()}.pdf`);
}

// ---------- Pilot Data Pages ----------
export async function exportPilotDataPages(sqdn: SquadronInfo, lang: PdfLang = "en") {
  const emblem = await loadEmblem();
  const doc = await setupDoc(lang);

  PILOTS.forEach((p, idx) => {
    if (idx > 0) doc.addPage();
    drawHeader(doc, sqdn, `${tr("pilotDataPage", lang)} · ${p.id}`, emblem, lang);

    autoTable(doc, {
      startY: 42,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 2, ...tableStyles(lang) },
      body: [
        [shape(tr("field_name", lang)), pilotName(p, lang), shape(tr("field_arabic", lang)), shape(p.arabicName)],
        [shape(tr("field_id", lang)), p.id, shape(tr("field_unit", lang)), shape(p.unit)],
        [shape(tr("field_phone", lang)), p.phone, shape(tr("field_address", lang)), shape(p.address)],
        [shape(tr("field_available", lang)), p.available ? shape(tr("yes", lang)) : shape(tr("no", lang)), shape(tr("field_doctor", lang)), shape(p.doctorNote || "—")],
      ],
      margin: { left: 8, right: 8 },
    });

    const y1 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
    doc.setFont(baseFont(lang), "normal");
    doc.setFontSize(10);
    doc.setTextColor(20, 24, 32);
    doc.text(shape(tr("hoursSummary", lang)), 8, y1);

    autoTable(doc, {
      startY: y1 + 2,
      head: [[
        shape(tr("col_bucket", lang)), shape(tr("col_day", lang)), shape(tr("col_night", lang)),
        shape(tr("col_nvg", lang)), shape(tr("col_sim", lang)), shape(tr("col_captain", lang)),
      ]],
      body: [
        [shape(tr("bucket_opening", lang)), p.openingDay.toFixed(1), p.openingNight.toFixed(1), p.openingNvg.toFixed(1), "—", "—"],
        [shape(tr("bucket_month", lang)), p.monthDay.toFixed(1), p.monthNight.toFixed(1), p.monthNvg.toFixed(1), p.monthSim.toFixed(1), p.monthCaptain.toFixed(1)],
        [shape(tr("bucket_total", lang)), p.totalDay.toFixed(1), p.totalNight.toFixed(1), p.totalNvg.toFixed(1), p.totalSim.toFixed(1), p.totalCaptain.toFixed(1)],
      ],
      styles: { fontSize: 9, cellPadding: 2, ...tableStyles(lang) },
      headStyles: { fillColor: [20, 24, 32], textColor: [212, 175, 55], ...tableStyles(lang) },
      margin: { left: 8, right: 8 },
    });

    const y2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
    doc.setFont(baseFont(lang), "normal");
    doc.text(shape(tr("currencyExpiry", lang)), 8, y2);
    autoTable(doc, {
      startY: y2 + 2,
      head: [[
        shape(tr("exp_day", lang)), shape(tr("exp_night", lang)), shape(tr("exp_irt", lang)),
        shape(tr("exp_medical", lang)), shape(tr("exp_sim", lang)),
      ]],
      body: [[p.expiry.day, p.expiry.night, p.expiry.irt, p.expiry.medical, p.expiry.sim]],
      styles: { fontSize: 9, cellPadding: 2, ...tableStyles(lang) },
      headStyles: { fillColor: [20, 24, 32], textColor: [212, 175, 55], ...tableStyles(lang) },
      margin: { left: 8, right: 8 },
    });
  });

  footer(doc, lang);
  save(doc, `pilot-data-pages-${lang}-${fmtDate()}.pdf`);
}

// ---------- Total's Page ----------
export async function exportTotalsPage(sqdn: SquadronInfo, lang: PdfLang = "en") {
  const emblem = await loadEmblem();
  const doc = await setupDoc(lang);
  drawHeader(doc, sqdn, tr("totalsPage", lang), emblem, lang);

  const rows = PILOTS.map((p) => [
    p.id,
    pilotName(p, lang),
    shape(p.unit),
    p.monthDay.toFixed(1),
    p.monthNight.toFixed(1),
    p.monthNvg.toFixed(1),
    p.monthSim.toFixed(1),
    p.monthCaptain.toFixed(1),
    (p.monthDay + p.monthNight + p.monthNvg).toFixed(1),
  ]);

  const sum = (k: keyof Pilot) => PILOTS.reduce((s, p) => s + (p[k] as number), 0);
  rows.push([
    "",
    shape(tr("squadron_total", lang)),
    "",
    sum("monthDay").toFixed(1),
    sum("monthNight").toFixed(1),
    sum("monthNvg").toFixed(1),
    sum("monthSim").toFixed(1),
    sum("monthCaptain").toFixed(1),
    (sum("monthDay") + sum("monthNight") + sum("monthNvg")).toFixed(1),
  ]);

  autoTable(doc, {
    startY: 42,
    head: [[
      tr("col_num", lang), shape(tr("col_pilot", lang)), shape(tr("col_unit", lang)),
      shape(tr("col_day", lang)), shape(tr("col_night", lang)), shape(tr("col_nvg", lang)),
      shape(tr("col_sim", lang)), shape(tr("col_captain", lang)), shape(tr("col_flying", lang)),
    ]],
    body: rows,
    styles: { fontSize: 8, cellPadding: 1.6, ...tableStyles(lang) },
    headStyles: { fillColor: [20, 24, 32], textColor: [212, 175, 55], ...tableStyles(lang) },
    didParseCell: (data) => {
      if (data.row.index === rows.length - 1) {
        data.cell.styles.fontStyle = "normal";
        data.cell.styles.fillColor = [240, 230, 200];
      }
    },
    margin: { left: 8, right: 8 },
  });

  footer(doc, lang);
  save(doc, `totals-page-${lang}-${fmtDate()}.pdf`);
}

// ---------- Squadron Summary ----------
export async function exportSquadronSummary(sqdn: SquadronInfo, lang: PdfLang = "en") {
  const emblem = await loadEmblem();
  const doc = await setupDoc(lang);

  // Cover page
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFillColor(20, 24, 32);
  doc.rect(0, 0, w, h, "F");
  doc.setFillColor(212, 175, 55);
  doc.rect(0, 0, w, 8, "F");
  doc.rect(0, h - 8, w, 8, "F");

  try {
    doc.addImage(emblem, "PNG", w / 2 - 30, 50, 60, 70);
  } catch { /* ignore */ }

  doc.setTextColor(212, 175, 55);
  doc.setFont(baseFont(lang), "normal");
  doc.setFontSize(22);
  doc.text(shape(tr("rjaf", lang)), w / 2, 140, { align: "center" });
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(shape(sqdn.name || tr("squadron", lang)), w / 2, 152, { align: "center" });
  doc.setFontSize(12);
  doc.text(`${sqdn.number || "—"} · ${shape(sqdn.base || "—")}`, w / 2, 162, { align: "center" });
  doc.setFontSize(18);
  doc.setTextColor(212, 175, 55);
  doc.text(shape(tr("squadronSummary", lang)), w / 2, 190, { align: "center" });
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(`${shape(tr("asOf", lang))} ${fmtDate()}`, w / 2, 200, { align: "center" });

  // Snapshot page
  doc.addPage();
  drawHeader(doc, sqdn, tr("squadronSnapshot", lang), emblem, lang);

  const totalPilots = PILOTS.length;
  const available = PILOTS.filter((p) => p.available).length;
  const expSoon = PILOTS.filter((p) => {
    const t = Math.min(
      ...Object.values(p.expiry).map((d) => new Date(d).getTime() - Date.now()),
    );
    return t < 30 * 86400000;
  }).length;
  const sortieCount = SORTIES.length;
  const totalHrs = SORTIES.reduce((s, x) => s + x.actual, 0);

  autoTable(doc, {
    startY: 44,
    theme: "grid",
    styles: { fontSize: 11, cellPadding: 3, ...tableStyles(lang) },
    body: [
      [shape(tr("pilots_strength", lang)), String(totalPilots)],
      [shape(tr("pilots_available", lang)), String(available)],
      [shape(tr("exp_soon", lang)), String(expSoon)],
      [shape(tr("sortie_count", lang)), String(sortieCount)],
      [shape(tr("total_hours", lang)), totalHrs.toFixed(1)],
    ],
    columnStyles: { 0: { cellWidth: 80 } },
    margin: { left: 8, right: 8 },
  });

  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  doc.setFont(baseFont(lang), "normal");
  doc.setFontSize(11);
  doc.setTextColor(20, 24, 32);
  doc.text(shape(tr("monthlyByPilot", lang)), 8, y);
  autoTable(doc, {
    startY: y + 2,
    head: [[
      shape(tr("col_pilot", lang)), shape(tr("col_day", lang)), shape(tr("col_night", lang)),
      shape(tr("col_nvg", lang)), shape(tr("col_sim", lang)),
    ]],
    body: PILOTS.map((p) => [
      pilotName(p, lang),
      p.monthDay.toFixed(1),
      p.monthNight.toFixed(1),
      p.monthNvg.toFixed(1),
      p.monthSim.toFixed(1),
    ]),
    styles: { fontSize: 9, cellPadding: 1.6, ...tableStyles(lang) },
    headStyles: { fillColor: [20, 24, 32], textColor: [212, 175, 55], ...tableStyles(lang) },
    margin: { left: 8, right: 8 },
  });

  footer(doc, lang);
  save(doc, `squadron-summary-${lang}-${fmtDate()}.pdf`);
}

export const PDF_EXPORTS = {
  authorization: exportAuthorizationReport,
  pilotData: exportPilotDataPages,
  totals: exportTotalsPage,
  summary: exportSquadronSummary,
} as const;
