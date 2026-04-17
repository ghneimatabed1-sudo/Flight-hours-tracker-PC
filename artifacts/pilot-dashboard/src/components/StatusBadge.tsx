import type { CurrencyStatus } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { statusClass } from "@/lib/format";

export function StatusBadge({ status }: { status: CurrencyStatus }) {
  const { t } = useI18n();
  const label = status === "current" ? t("current") : status === "warning" ? t("warning") : t("expired");
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${statusClass(status)}`}>
      {label}
    </span>
  );
}

export function CurrencyCell({ date }: { date: string }) {
  const { lang } = useI18n();
  const target = new Date(date).getTime();
  const diffDays = Math.floor((target - Date.now()) / 86400000);
  const status: CurrencyStatus = diffDays < 0 ? "expired" : diffDays <= 30 ? "warning" : "current";
  const formatted = new Date(date).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { year: "2-digit", month: "short", day: "2-digit" });
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium tabular-nums ${statusClass(status)}`}>
      {formatted}
    </span>
  );
}
