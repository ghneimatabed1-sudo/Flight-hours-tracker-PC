import { useMemo, useState } from "react";
import { Archive, Download, FolderArchive, FileJson } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { PageHead } from "@/components/Layout";
import { listArchives, downloadArchive, runArchiveCheck } from "@/lib/archive";

export default function Archives() {
  const { t, lang } = useI18n();
  const [tick, setTick] = useState(0);
  const items = useMemo(() => listArchives(), [tick]);

  const months = items.filter(i => i.kind === "month");
  const years = items.filter(i => i.kind === "year");

  const fmtPeriod = (p: string) => {
    if (p.length === 4) return p; // year
    const [y, m] = p.split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { year: "numeric", month: "long" });
  };

  const onCheckNow = () => {
    runArchiveCheck();
    setTick(x => x + 1);
  };

  return (
    <div>
      <PageHead
        title={t("archivesTitle")}
        subtitle={t("archivesSubtitle")}
        actions={
          <button onClick={onCheckNow}
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-secondary"
            data-testid="button-archive-check-now">
            {t("archivesCheckNow")}
          </button>
        }
      />

      <div className="grid gap-6 md:grid-cols-2 mt-4">
        <section className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <FolderArchive className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">{t("archivesYearly")}</h3>
            <span className="text-xs text-muted-foreground">({years.length})</span>
          </div>
          {years.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("archivesEmptyYearly")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {years.map(it => (
                <li key={it.key} className="flex items-center justify-between py-2 text-sm" data-testid={`row-archive-${it.period}`}>
                  <div>
                    <div className="font-medium">{fmtPeriod(it.period)}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("archivesTotals")
                        .replace("{s}", String(it.totals.sortieCount))
                        .replace("{p}", String(it.totals.pilotCount))
                        .replace("{h}", String(it.totals.flightHours))}
                    </div>
                  </div>
                  <button onClick={() => downloadArchive(it.period)}
                    className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1"
                    data-testid={`button-download-${it.period}`}>
                    <Download className="h-3.5 w-3.5" /> {t("archivesDownload")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Archive className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">{t("archivesMonthly")}</h3>
            <span className="text-xs text-muted-foreground">({months.length})</span>
          </div>
          {months.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("archivesEmptyMonthly")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {months.map(it => (
                <li key={it.key} className="flex items-center justify-between py-2 text-sm" data-testid={`row-archive-${it.period}`}>
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      <FileJson className="h-3.5 w-3.5 text-muted-foreground" />
                      {fmtPeriod(it.period)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("archivesTotals")
                        .replace("{s}", String(it.totals.sortieCount))
                        .replace("{p}", String(it.totals.pilotCount))
                        .replace("{h}", String(it.totals.flightHours))}
                    </div>
                  </div>
                  <button onClick={() => downloadArchive(it.period)}
                    className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1"
                    data-testid={`button-download-${it.period}`}>
                    <Download className="h-3.5 w-3.5" /> {t("archivesDownload")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="text-xs text-muted-foreground mt-4">{t("archivesNote")}</p>
    </div>
  );
}
