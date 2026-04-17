import { useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { FileDown, FileText, Loader2 } from "lucide-react";
import {
  exportAuthorizationReport,
  exportPilotDataPages,
  exportTotalsPage,
  exportSquadronSummary,
} from "@/lib/pdf";

type ExportKey = "auth" | "data" | "totals" | "summary";

const EXPORTS: { key: ExportKey; title: string; desc: string }[] = [
  { key: "auth", title: "Authorization Report", desc: "Per-pilot day/night/NVG authorization with signatures." },
  { key: "data", title: "Pilot Data Pages", desc: "Full per-pilot dossier — totals, currencies, address, doctor note." },
  { key: "totals", title: "Total's Page", desc: "Squadron grand totals, monthly breakdown." },
  { key: "summary", title: "Squadron Summary", desc: "Cover page with RJAF emblem · monthly snapshot." },
];

export default function PdfExports() {
  const { t } = useI18n();
  const { squadron } = useAuth();
  const [busy, setBusy] = useState<ExportKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sqdn = {
    name: squadron?.name || "Squadron",
    number: squadron?.number || "",
    base: squadron?.base || "",
  };

  async function run(key: ExportKey) {
    setBusy(key);
    setError(null);
    try {
      if (key === "auth") await exportAuthorizationReport(sqdn);
      else if (key === "data") await exportPilotDataPages(sqdn);
      else if (key === "totals") await exportTotalsPage(sqdn);
      else if (key === "summary") await exportSquadronSummary(sqdn);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate PDF");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHead title={t("nav_pdf")} subtitle="All PDFs generated with RJAF emblem header" />
      {error && (
        <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {EXPORTS.map((e) => {
          const isBusy = busy === e.key;
          return (
            <Card key={e.key} className="flex items-start gap-3">
              <FileText className="h-8 w-8 text-amber-400 shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-semibold">{e.title}</div>
                <div className="text-xs text-muted-foreground">{e.desc}</div>
              </div>
              <button
                onClick={() => run(e.key)}
                disabled={busy !== null}
                data-testid={`button-pdf-${e.key}`}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-1.5 disabled:opacity-60"
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
