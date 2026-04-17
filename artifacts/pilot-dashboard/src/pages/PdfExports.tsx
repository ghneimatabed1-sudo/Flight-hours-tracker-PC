import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { FileDown, FileText } from "lucide-react";

const EXPORTS = [
  { title: "Authorization Report", desc: "Per-pilot day/night/NVG authorization with signatures." },
  { title: "Pilot Data Pages", desc: "Full per-pilot dossier — totals, currencies, address, doctor note." },
  { title: "Total's Page", desc: "Squadron grand totals, monthly breakdown." },
  { title: "Squadron Summary", desc: "Cover page with RJAF emblem · monthly snapshot." },
];

export default function PdfExports() {
  const { t } = useI18n();
  return (
    <div>
      <PageHead title={t("nav_pdf")} subtitle="All PDFs generated with RJAF emblem header" />
      <div className="grid md:grid-cols-2 gap-3">
        {EXPORTS.map(e => (
          <Card key={e.title} className="flex items-start gap-3">
            <FileText className="h-8 w-8 text-amber-400 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-semibold">{e.title}</div>
              <div className="text-xs text-muted-foreground">{e.desc}</div>
            </div>
            <button className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-1.5"><FileDown className="h-4 w-4" /> PDF</button>
          </Card>
        ))}
      </div>
    </div>
  );
}
