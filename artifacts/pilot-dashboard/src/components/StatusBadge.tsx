import type { CurrencyStatus } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { statusClass, currencyStatus } from "@/lib/format";

function statusLabelKey(s: CurrencyStatus): "current" | "warning" | "expiringSoon" | "expired" {
  if (s === "expired") return "expired";
  if (s === "critical" || s === "expiringSoon") return "expiringSoon";
  if (s === "warning") return "warning";
  return "current";
}

export function StatusBadge({ status }: { status: CurrencyStatus }) {
  const { t } = useI18n();
  const label = t(statusLabelKey(status));
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${statusClass(status)}`}>
      {label}
    </span>
  );
}

export function CurrencyCell({ date }: { date: string }) {
  const { lang } = useI18n();
  const status = currencyStatus(date);
  const formatted = new Date(date).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { year: "2-digit", month: "short", day: "2-digit" });
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium tabular-nums ${statusClass(status)}`}>
      {formatted}
    </span>
  );
}
