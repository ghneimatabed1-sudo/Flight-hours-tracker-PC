import { useEffect, useRef, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { usePilots, useSorties } from "@/lib/squadron-data";
import { supabaseConfigured } from "@/lib/supabase";
import { FileDown, FileText, Loader2, Globe, AlertTriangle, Info } from "lucide-react";
import {
  exportAuthorizationReport,
  exportPilotDataPages,
  exportTotalsPage,
  exportSquadronSummary,
  type PdfLang,
} from "@/lib/pdf";

type ExportKey = "auth" | "data" | "totals" | "summary";

export default function PdfExports() {
  const { t, lang } = useI18n();
  const { squadron } = useAuth();
  const pilotsQ = usePilots();
  const sortiesQ = useSorties();
  const pilots = pilotsQ.data;
  const sorties = sortiesQ.data;
  // When Supabase is configured but a query fails, we must NOT generate a PDF
  // — the data layer no longer falls back to seed data, so a report would
  // either be empty or contain stale cached rows. Surface the failure and
  // disable the export buttons until the connection recovers.
  const isDemo = !supabaseConfigured;
  const dataUnavailable = !isDemo && (pilotsQ.isError || sortiesQ.isError);
  const dataLoading = !isDemo && (pilotsQ.isLoading || sortiesQ.isLoading);
  const fetchError = pilotsQ.error ?? sortiesQ.error;
  const [busy, setBusy] = useState<ExportKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The PDFs follow the app's current language by default but the operator
  // can override per-export — useful when an English commander needs an
  // Arabic copy for an external office, or vice versa. Once the operator
  // makes a manual choice we stop auto-syncing with the app language.
  const [pdfLang, setPdfLang] = useState<PdfLang>(lang);
  const overridden = useRef(false);
  useEffect(() => {
    if (!overridden.current) setPdfLang(lang);
  }, [lang]);
  const choose = (l: PdfLang) => { overridden.current = true; setPdfLang(l); };

  const EXPORTS: { key: ExportKey; title: string; desc: string }[] = [
    { key: "auth", title: t("pdf_auth_title"), desc: t("pdf_auth_desc") },
    { key: "data", title: t("pdf_data_title"), desc: t("pdf_data_desc") },
    { key: "totals", title: t("pdf_totals_title"), desc: t("pdf_totals_desc") },
    { key: "summary", title: t("pdf_summary_title"), desc: t("pdf_summary_desc") },
  ];

  const sqdn = {
    name: squadron?.name || "Squadron",
    number: squadron?.number || "",
    base: squadron?.base || "",
  };

  async function run(key: ExportKey) {
    if (dataUnavailable) {
      setError(t("pdf_data_unavailable"));
      return;
    }
    setBusy(key);
    setError(null);
    try {
      if (key === "auth") await exportAuthorizationReport(sqdn, pilots, pdfLang);
      else if (key === "data") await exportPilotDataPages(sqdn, pilots, pdfLang);
      else if (key === "totals") await exportTotalsPage(sqdn, pilots, pdfLang);
      else if (key === "summary") await exportSquadronSummary(sqdn, pilots, sorties, pdfLang);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate PDF");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHead title={t("nav_pdf")} subtitle={t("pdf_subtitle")} />
      <div className="mb-3 flex items-center gap-2 text-sm">
        <Globe className="h-4 w-4 text-amber-400" />
        <span className="text-muted-foreground">{t("pdf_language")}:</span>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => choose("en")}
            data-testid="button-pdflang-en"
            className={`px-3 py-1 text-xs ${pdfLang === "en" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
          >
            English
          </button>
          <button
            onClick={() => choose("ar")}
            data-testid="button-pdflang-ar"
            className={`px-3 py-1 text-xs ${pdfLang === "ar" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
          >
            العربية
          </button>
        </div>
      </div>
      {isDemo && (
        <div
          data-testid="banner-pdf-demo"
          className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 flex items-start gap-2"
        >
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t("pdf_demo_notice")}</span>
        </div>
      )}
      {dataUnavailable && (
        <div
          data-testid="banner-pdf-unavailable"
          className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300 flex items-start gap-2"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">{t("pdf_data_unavailable")}</div>
            {fetchError instanceof Error && (
              <div className="text-xs text-red-300/80 mt-0.5">{fetchError.message}</div>
            )}
          </div>
          <button
            onClick={() => { pilotsQ.refetch(); sortiesQ.refetch(); }}
            data-testid="button-pdf-retry"
            className="px-2 py-1 rounded-md border border-red-500/40 text-xs hover:bg-red-500/20"
          >
            {t("pdf_retry")}
          </button>
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {EXPORTS.map((e) => {
          const isBusy = busy === e.key;
          const disabled = busy !== null || dataUnavailable || dataLoading;
          return (
            <Card key={e.key} className="flex items-start gap-3">
              <FileText className="h-8 w-8 text-amber-400 shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-semibold">{e.title}</div>
                <div className="text-xs text-muted-foreground">{e.desc}</div>
              </div>
              <button
                onClick={() => run(e.key)}
                disabled={disabled}
                title={dataUnavailable ? t("pdf_data_unavailable") : undefined}
                data-testid={`button-pdf-${e.key}`}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                PDF
              </button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
