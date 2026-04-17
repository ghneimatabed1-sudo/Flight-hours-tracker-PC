import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PILOTS, SORTIES, type Pilot } from "./mock";

interface SquadronInfo {
  name?: string;
  number?: string;
  base?: string;
}

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

function fmtDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function drawHeader(doc: jsPDF, sqdn: SquadronInfo, title: string, emblem: string) {
  const w = doc.internal.pageSize.getWidth();
  // Gold band
  doc.setFillColor(212, 175, 55);
  doc.rect(0, 0, w, 26, "F");
  doc.setFillColor(20, 24, 32);
  doc.rect(0, 26, w, 2, "F");

  // Emblem
  try {
    doc.addImage(emblem, "PNG", 8, 3, 20, 20);
  } catch {
    /* ignore */
  }

  doc.setTextColor(20, 24, 32);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Royal Jordanian Air Force", 32, 11);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const sub = `${sqdn.name || "Squadron"} · ${sqdn.number || "—"} SQDN · ${sqdn.base || "—"}`;
  doc.text(sub, 32, 17);
  doc.setFontSize(8);
  doc.text(`Report date: ${fmtDate()}`, 32, 22);

  // Title row
  doc.setTextColor(20, 24, 32);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, 8, 36);
  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.4);
  doc.line(8, 38, w - 8, 38);
}

function footer(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(100);
    doc.text(`RJAF Squadron Ops · Confidential · Page ${i} of ${pageCount}`, w / 2, h - 5, { align: "center" });
  }
}

function save(doc: jsPDF, filename: string) {
  doc.save(filename);
}

// ---------- Authorization Report ----------
export async function exportAuthorizationReport(sqdn: SquadronInfo) {
  const emblem = await loadEmblem();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  drawHeader(doc, sqdn, "Authorization Report", emblem);

  const rows = PILOTS.map((p) => [
    p.id,
    `${p.rank} ${p.name}`,
    p.unit,
    p.expiry.day,
    p.expiry.night,
    p.expiry.irt,
    "____________",
  ]);

  autoTable(doc, {
    startY: 42,
    head: [["#", "Pilot", "Unit", "Day Auth", "Night Auth", "NVG / IRT", "Signature"]],
    body: rows,
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [20, 24, 32], textColor: [212, 175, 55] },
    columnStyles: { 6: { cellWidth: 36 } },
    margin: { left: 8, right: 8 },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) drawHeader(doc, sqdn, "Authorization Report (cont.)", emblem);
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 200;
  doc.setFontSize(9);
  doc.setTextColor(20, 24, 32);
  doc.text("Squadron Commander: ____________________________", 8, finalY + 14);
  doc.text("Operations Officer:  ____________________________", 8, finalY + 22);
  doc.text(`Date: ${fmtDate()}`, 8, finalY + 30);

  footer(doc);
  save(doc, `authorization-report-${fmtDate()}.pdf`);
}

// ---------- Pilot Data Pages ----------
export async function exportPilotDataPages(sqdn: SquadronInfo) {
  const emblem = await loadEmblem();
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  PILOTS.forEach((p, idx) => {
    if (idx > 0) doc.addPage();
    drawHeader(doc, sqdn, `Pilot Data Page · ${p.id}`, emblem);

    autoTable(doc, {
      startY: 42,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 2 },
      body: [
        ["Name", `${p.rank} ${p.name}`, "Arabic", p.arabicName],
        ["Pilot ID", p.id, "Unit", p.unit],
        ["Phone", p.phone, "Address", p.address],
        ["Available", p.available ? "Yes" : "No", "Doctor Note", p.doctorNote || "—"],
      ],
      margin: { left: 8, right: 8 },
    });

    const y1 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(20, 24, 32);
    doc.text("Hours Summary", 8, y1);

    autoTable(doc, {
      startY: y1 + 2,
      head: [["Bucket", "Day", "Night", "NVG", "Sim", "Captain"]],
      body: [
        ["Opening", p.openingDay.toFixed(1), p.openingNight.toFixed(1), p.openingNvg.toFixed(1), "—", "—"],
        ["Month", p.monthDay.toFixed(1), p.monthNight.toFixed(1), p.monthNvg.toFixed(1), p.monthSim.toFixed(1), p.monthCaptain.toFixed(1)],
        ["Total", p.totalDay.toFixed(1), p.totalNight.toFixed(1), p.totalNvg.toFixed(1), p.totalSim.toFixed(1), p.totalCaptain.toFixed(1)],
      ],
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [20, 24, 32], textColor: [212, 175, 55] },
      margin: { left: 8, right: 8 },
    });

    const y2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
    doc.setFont("helvetica", "bold");
    doc.text("Currency Expiry", 8, y2);
    autoTable(doc, {
      startY: y2 + 2,
      head: [["Day", "Night", "IRT", "Medical", "Sim"]],
      body: [[p.expiry.day, p.expiry.night, p.expiry.irt, p.expiry.medical, p.expiry.sim]],
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [20, 24, 32], textColor: [212, 175, 55] },
      margin: { left: 8, right: 8 },
    });
  });

  footer(doc);
  save(doc, `pilot-data-pages-${fmtDate()}.pdf`);
}

// ---------- Total's Page ----------
export async function exportTotalsPage(sqdn: SquadronInfo) {
  const emblem = await loadEmblem();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  drawHeader(doc, sqdn, "Total's Page · Monthly Squadron Totals", emblem);

  const rows = PILOTS.map((p: Pilot) => [
    p.id,
    `${p.rank} ${p.name}`,
    p.unit,
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
    "Squadron Total",
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
    head: [["#", "Pilot", "Unit", "Day", "Night", "NVG", "Sim", "Captain", "Flying"]],
    body: rows,
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [20, 24, 32], textColor: [212, 175, 55] },
    didParseCell: (data) => {
      if (data.row.index === rows.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [240, 230, 200];
      }
    },
    margin: { left: 8, right: 8 },
  });

  footer(doc);
  save(doc, `totals-page-${fmtDate()}.pdf`);
}

// ---------- Squadron Summary ----------
export async function exportSquadronSummary(sqdn: SquadronInfo) {
  const emblem = await loadEmblem();
  const doc = new jsPDF({ unit: "mm", format: "a4" });

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
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Royal Jordanian Air Force", w / 2, 140, { align: "center" });
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(sqdn.name || "Squadron", w / 2, 152, { align: "center" });
  doc.setFontSize(12);
  doc.text(`${sqdn.number || "—"} SQDN · ${sqdn.base || "—"}`, w / 2, 162, { align: "center" });
  doc.setFontSize(18);
  doc.setTextColor(212, 175, 55);
  doc.text("Squadron Summary", w / 2, 190, { align: "center" });
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(`As of ${fmtDate()}`, w / 2, 200, { align: "center" });

  // Snapshot page
  doc.addPage();
  drawHeader(doc, sqdn, "Squadron Snapshot", emblem);

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
    styles: { fontSize: 11, cellPadding: 3 },
    body: [
      ["Pilots on Strength", String(totalPilots)],
      ["Available Pilots", String(available)],
      ["Currencies Expiring < 30d", String(expSoon)],
      ["Sorties (60-day window)", String(sortieCount)],
      ["Total Flight Hours (window)", totalHrs.toFixed(1)],
    ],
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 80 } },
    margin: { left: 8, right: 8 },
  });

  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 24, 32);
  doc.text("Monthly Hours by Pilot", 8, y);
  autoTable(doc, {
    startY: y + 2,
    head: [["Pilot", "Day", "Night", "NVG", "Sim"]],
    body: PILOTS.map((p) => [
      `${p.rank} ${p.name}`,
      p.monthDay.toFixed(1),
      p.monthNight.toFixed(1),
      p.monthNvg.toFixed(1),
      p.monthSim.toFixed(1),
    ]),
    styles: { fontSize: 9, cellPadding: 1.6 },
    headStyles: { fillColor: [20, 24, 32], textColor: [212, 175, 55] },
    margin: { left: 8, right: 8 },
  });

  footer(doc);
  save(doc, `squadron-summary-${fmtDate()}.pdf`);
}

export const PDF_EXPORTS = {
  authorization: exportAuthorizationReport,
  pilotData: exportPilotDataPages,
  totals: exportTotalsPage,
  summary: exportSquadronSummary,
} as const;
