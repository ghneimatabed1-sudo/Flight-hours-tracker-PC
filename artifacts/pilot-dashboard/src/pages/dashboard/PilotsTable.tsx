import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CurrencyCell, StatusBadge } from "@/components/StatusBadge";
import { pilots, squadrons } from "@/lib/mockData";
import { pilotWorstStatus, pilotWorstDate, fmtDate } from "@/lib/format";
import type { CurrencyStatus, Pilot } from "@/lib/types";
import { Search, ArrowUpDown, ChevronLeft, Download, Printer, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";

type SortKey = keyof Pick<Pilot, "callSign" | "fullName" | "monthlyHours" | "grandTotalHours" | "nvgTotalHours">;

export default function PilotsTable() {
  const { t, lang, dir } = useI18n();
  const { user } = useAuth();
  const [, params] = useRoute("/dashboard/squadron/:id");
  const focusedSqnId = params?.id;

  const [q, setQ] = useState("");
  const [sqnFilter, setSqnFilter] = useState<string>("__all");
  const [statusFilter, setStatusFilter] = useState<"all" | "current" | "warning" | "expired">("all");
  const [sortKey, setSortKey] = useState<SortKey>("callSign");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  if (!user) return null;
  const myIds = new Set(user.squadronIds);
  const mySqns = squadrons.filter(s => myIds.has(s.id));
  const focusedSqn = focusedSqnId ? squadrons.find(s => s.id === focusedSqnId) : null;
  const canExport = user.role === "commander";

  const list = useMemo(() => {
    let l = pilots.filter(p => myIds.has(p.squadronId));
    if (focusedSqnId) l = l.filter(p => p.squadronId === focusedSqnId);
    else if (sqnFilter !== "__all") l = l.filter(p => p.squadronId === sqnFilter);
    if (statusFilter !== "all") {
      l = l.filter(p => {
        const s = pilotWorstStatus(p);
        if (statusFilter === "expired") return s === "expired" || s === "critical";
        if (statusFilter === "warning") return s === "warning" || s === "expiringSoon";
        return s === "current";
      });
    }
    if (q.trim()) {
      const s = q.toLowerCase().trim();
      l = l.filter(p => p.fullName.toLowerCase().includes(s) || p.fullNameAr.includes(s) || p.callSign.toLowerCase().includes(s));
    }
    l = [...l].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return l;
  }, [q, sqnFilter, statusFilter, sortKey, sortDir, focusedSqnId, myIds]);

  function setSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("asc"); }
  }

  const reportTitle = focusedSqn
    ? `${t("pilotReport")} — ${lang === "ar" ? focusedSqn.nameAr : focusedSqn.name}`
    : sqnFilter !== "__all"
      ? (() => {
          const s = squadrons.find(x => x.id === sqnFilter);
          return s ? `${t("pilotReport")} — ${lang === "ar" ? s.nameAr : s.name}` : t("pilotReport");
        })()
      : `${t("pilotReport")} — ${t("allSquadrons")}`;

  function statusLabel(s: CurrencyStatus): string {
    if (s === "expired") return t("expired");
    if (s === "critical" || s === "expiringSoon") return t("expiringSoon");
    if (s === "warning") return t("warning");
    return t("current");
  }

  function exportCsv() {
    const headers = [
      t("callSign"), t("name"), t("squadron"),
      t("nvgTotal"), t("monthlyHours"), t("grandTotal"),
      t("dayCurrency"), t("nightCurrency"), t("irtCurrency"), t("medicalCurrency"),
      t("status"),
    ];
    const rows = list.map(p => {
      const sqn = squadrons.find(s => s.id === p.squadronId);
      return [
        p.callSign,
        lang === "ar" ? p.fullNameAr : p.fullName,
        sqn ? (lang === "ar" ? sqn.nameAr : sqn.code) : "",
        String(p.nvgTotalHours),
        p.monthlyHours.toFixed(1),
        String(p.grandTotalHours),
        p.dayCurrencyDate,
        p.nightCurrencyDate,
        p.irtCurrencyDate,
        p.medicalCurrencyDate,
        statusLabel(pilotWorstStatus(p)),
      ];
    });
    const escape = (v: string) => {
      const needs = /[",\n\r]/.test(v);
      const cleaned = v.replace(/"/g, '""');
      return needs ? `"${cleaned}"` : cleaned;
    };
    const csv = [headers, ...rows].map(r => r.map(escape).join(",")).join("\r\n");
    // Prepend BOM so Excel detects UTF-8 (important for Arabic names)
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    const scope = focusedSqn?.code ?? (sqnFilter !== "__all" ? squadrons.find(s => s.id === sqnFilter)?.code : null) ?? "all";
    a.href = url;
    a.download = `pilots-${scope}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportXlsx() {
    const headers = [
      t("callSign"), t("name"), t("squadron"),
      t("nvgTotal"), t("monthlyHours"), t("grandTotal"),
      t("dayCurrency"), t("nightCurrency"), t("irtCurrency"), t("medicalCurrency"),
      t("status"),
    ];
    const rows = list.map(p => {
      const sqn = squadrons.find(s => s.id === p.squadronId);
      return {
        [headers[0]]: p.callSign,
        [headers[1]]: lang === "ar" ? p.fullNameAr : p.fullName,
        [headers[2]]: sqn ? (lang === "ar" ? sqn.nameAr : sqn.code) : "",
        [headers[3]]: p.nvgTotalHours,
        [headers[4]]: Number(p.monthlyHours.toFixed(1)),
        [headers[5]]: p.grandTotalHours,
        [headers[6]]: p.dayCurrencyDate,
        [headers[7]]: p.nightCurrencyDate,
        [headers[8]]: p.irtCurrencyDate,
        [headers[9]]: p.medicalCurrencyDate,
        [headers[10]]: statusLabel(pilotWorstStatus(p)),
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    // Reasonable default column widths so Arabic names don't get clipped.
    ws["!cols"] = headers.map(h => ({ wch: Math.max(12, Math.min(28, h.length + 4)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pilots");
    const stamp = new Date().toISOString().slice(0, 10);
    const scope = focusedSqn?.code ?? (sqnFilter !== "__all" ? squadrons.find(s => s.id === sqnFilter)?.code : null) ?? "all";
    XLSX.writeFile(wb, `pilots-${scope}-${stamp}.xlsx`);
  }

  function printReport() {
    window.print();
  }

  const printedOnText = `${t("printedOn")}: ${fmtDate(new Date().toISOString(), lang)}`;

  return (
    <div className="space-y-4 print-area">
      <div className="flex items-center justify-between flex-wrap gap-2 no-print">
        <div>
          {focusedSqn && (
            <Link href="/dashboard/pilots" className="text-xs inline-flex items-center text-muted-foreground hover:text-foreground mb-1">
              <ChevronLeft className={`h-3 w-3 ${dir === "rtl" ? "rotate-180" : ""}`} />{t("back")}
            </Link>
          )}
          <h2 className="text-xl font-bold">
            {focusedSqn ? `${t("squadronView")}: ${lang === "ar" ? focusedSqn.nameAr : focusedSqn.name}` : t("pilots")}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{list.length} {t("pilots")}</span>
          {canExport && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={exportCsv} data-testid="button-export-csv">
                <Download className="h-3.5 w-3.5 me-1.5" />{t("exportCsv")}
              </Button>
              <Button size="sm" variant="outline" onClick={exportXlsx} data-testid="button-export-xlsx">
                <FileSpreadsheet className="h-3.5 w-3.5 me-1.5" />{t("exportXlsx")}
              </Button>
              <Button size="sm" variant="outline" onClick={printReport} data-testid="button-print">
                <Printer className="h-3.5 w-3.5 me-1.5" />{t("print")}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="print-only print-header">
        <h1>{reportTitle}</h1>
        <div className="meta">
          <div>{printedOnText}</div>
          <div>{list.length} {t("pilots")}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 no-print">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder={t("search")} className="ps-9" data-testid="input-search" />
        </div>
        {!focusedSqnId && (
          <Select value={sqnFilter} onValueChange={setSqnFilter}>
            <SelectTrigger className="w-48" data-testid="select-sqn-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("selectAll")}</SelectItem>
              {mySqns.map(s => (
                <SelectItem key={s.id} value={s.id}>{lang === "ar" ? s.nameAr : s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={statusFilter} onValueChange={(v: string) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-40" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            <SelectItem value="current">{t("current")}</SelectItem>
            <SelectItem value="warning">{t("expiringSoon")}</SelectItem>
            <SelectItem value="expired">{t("expired")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground text-xs uppercase">
                  <Th onClick={() => setSort("callSign")}>{t("callSign")}</Th>
                  <Th onClick={() => setSort("fullName")}>{t("name")}</Th>
                  <th className="text-start py-2 px-3">{t("squadron")}</th>
                  <Th onClick={() => setSort("nvgTotalHours")} align="end">{t("nvgTotal")}</Th>
                  <Th onClick={() => setSort("monthlyHours")} align="end">{t("monthlyHours")}</Th>
                  <Th onClick={() => setSort("grandTotalHours")} align="end">{t("grandTotal")}</Th>
                  <th className="text-center py-2 px-3">{t("dayCurrency")}</th>
                  <th className="text-center py-2 px-3">{t("nightCurrency")}</th>
                  <th className="text-center py-2 px-3">{t("irtCurrency")}</th>
                  <th className="text-center py-2 px-3">{t("medicalCurrency")}</th>
                  <th className="text-start py-2 px-3">{t("status")}</th>
                  <th className="py-2 px-3 no-print"></th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && (
                  <tr><td colSpan={12} className="py-8 text-center text-muted-foreground">{t("noResults")}</td></tr>
                )}
                {list.map(p => {
                  const sqn = squadrons.find(s => s.id === p.squadronId);
                  return (
                    <tr key={p.id} className="border-b border-border/60 hover:bg-accent/30" data-testid={`row-pilot-${p.id}`}>
                      <td className="py-2 px-3 font-mono text-xs">{p.callSign}</td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium">{lang === "ar" ? p.fullNameAr : p.fullName}</span>
                          {p.qualifications?.map(q => (
                            <span
                              key={q}
                              className="inline-flex items-center rounded border border-amber-400/40 bg-amber-400/10 px-1 py-0 text-[9px] font-semibold tracking-wider text-amber-600 dark:text-amber-300"
                              data-testid={`qual-${p.id}-${q}`}
                            >
                              {q}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-xs">{sqn ? (lang === "ar" ? sqn.nameAr : sqn.code) : ""}</td>
                      <td className="py-2 px-3 text-end tabular-nums">{p.nvgTotalHours}</td>
                      <td className="py-2 px-3 text-end tabular-nums">{p.monthlyHours.toFixed(1)}</td>
                      <td className="py-2 px-3 text-end tabular-nums font-medium">{p.grandTotalHours}</td>
                      <td className="py-2 px-3 text-center"><CurrencyCell date={p.dayCurrencyDate} /></td>
                      <td className="py-2 px-3 text-center"><CurrencyCell date={p.nightCurrencyDate} /></td>
                      <td className="py-2 px-3 text-center"><CurrencyCell date={p.irtCurrencyDate} /></td>
                      <td className="py-2 px-3 text-center"><CurrencyCell date={p.medicalCurrencyDate} /></td>
                      <td className="py-2 px-3"><StatusBadge status={pilotWorstStatus(p)} date={pilotWorstDate(p)} /></td>
                      <td className="py-2 px-3 text-end no-print">
                        <Link href={`/dashboard/pilot/${p.id}`}>
                          <Button size="sm" variant="outline" data-testid={`button-view-${p.id}`}>{t("viewDetails")}</Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Th({ children, onClick, align = "start" }: { children: React.ReactNode; onClick?: () => void; align?: "start" | "end" }) {
  return (
    <th className={`py-2 px-3 text-${align}`}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={onClick}>
        {children}
        {onClick && <ArrowUpDown className="h-3 w-3" />}
      </button>
    </th>
  );
}
