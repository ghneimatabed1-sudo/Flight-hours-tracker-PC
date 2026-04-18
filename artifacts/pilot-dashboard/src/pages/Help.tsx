import { Card, PageHead } from "@/components/Layout";
import { useI18n, type Key as TKey } from "@/lib/i18n";
import {
  KeyRound,
  Settings as SettingsIcon,
  LogIn,
  UserPlus,
  Upload,
  ListChecks,
  BadgeCheck,
  FileDown,
  Megaphone,
  Smartphone,
  Eye,
  ShieldOff,
  LifeBuoy,
  FileBarChart,
  Wand2,
  Printer,
  Save,
} from "lucide-react";

type Step = { titleKey: TKey; bodyKey: TKey; Icon: typeof KeyRound };

const FIRST_TIME: Step[] = [
  { titleKey: "help_first_1_t", bodyKey: "help_first_1_b", Icon: KeyRound },
  { titleKey: "help_first_2_t", bodyKey: "help_first_2_b", Icon: SettingsIcon },
  { titleKey: "help_first_3_t", bodyKey: "help_first_3_b", Icon: LogIn },
  { titleKey: "help_first_4_t", bodyKey: "help_first_4_b", Icon: UserPlus },
  { titleKey: "help_first_5_t", bodyKey: "help_first_5_b", Icon: Upload },
];

const DAILY: Step[] = [
  { titleKey: "help_daily_1_t", bodyKey: "help_daily_1_b", Icon: ListChecks },
  { titleKey: "help_daily_2_t", bodyKey: "help_daily_2_b", Icon: BadgeCheck },
  { titleKey: "help_daily_3_t", bodyKey: "help_daily_3_b", Icon: FileDown },
  { titleKey: "help_daily_4_t", bodyKey: "help_daily_4_b", Icon: Megaphone },
];

const PILOTS: Step[] = [
  { titleKey: "help_pilots_1_t", bodyKey: "help_pilots_1_b", Icon: Smartphone },
  { titleKey: "help_pilots_2_t", bodyKey: "help_pilots_2_b", Icon: Eye },
  { titleKey: "help_pilots_3_t", bodyKey: "help_pilots_3_b", Icon: ShieldOff },
];

const MONTHLY: Step[] = [
  { titleKey: "help_mr_1_t", bodyKey: "help_mr_1_b", Icon: FileBarChart },
  { titleKey: "help_mr_2_t", bodyKey: "help_mr_2_b", Icon: Wand2 },
  { titleKey: "help_mr_3_t", bodyKey: "help_mr_3_b", Icon: BadgeCheck },
  { titleKey: "help_mr_4_t", bodyKey: "help_mr_4_b", Icon: Save },
  { titleKey: "help_mr_5_t", bodyKey: "help_mr_5_b", Icon: Printer },
];

function Section({ title, steps }: { title: string; steps: Step[] }) {
  return (
    <Card className="space-y-3">
      <div className="text-sm font-semibold gold-grad uppercase tracking-wider">{title}</div>
      <div className="space-y-3">
        {steps.map(({ titleKey, bodyKey, Icon }) => (
          <Step key={titleKey} titleKey={titleKey} bodyKey={bodyKey} Icon={Icon} />
        ))}
      </div>
    </Card>
  );
}

function Step({ titleKey, bodyKey, Icon }: Step) {
  const { t } = useI18n();
  return (
    <div className="flex gap-3 items-start">
      <div className="shrink-0 h-9 w-9 rounded-md bg-secondary border border-border flex items-center justify-center">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{t(titleKey)}</div>
        <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{t(bodyKey)}</p>
      </div>
    </div>
  );
}

export default function Help() {
  const { t } = useI18n();
  return (
    <div>
      <PageHead title={t("help_title")} subtitle={t("help_subtitle")} />
      <div className="grid lg:grid-cols-2 gap-4">
        <Section title={t("help_section_first")} steps={FIRST_TIME} />
        <Section title={t("help_section_daily")} steps={DAILY} />
        <Section title={t("help_section_pilots")} steps={PILOTS} />
        <Section title={t("help_section_monthly")} steps={MONTHLY} />
        <Card className="space-y-3">
          <div className="text-sm font-semibold gold-grad uppercase tracking-wider">{t("help_section_support")}</div>
          <div className="flex gap-3 items-start">
            <div className="shrink-0 h-9 w-9 rounded-md bg-secondary border border-border flex items-center justify-center">
              <LifeBuoy className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="text-sm font-semibold">{t("help_support_t")}</div>
              <p className="text-xs text-muted-foreground leading-relaxed">{t("help_support_b")}</p>
              <div className="text-xs space-y-0.5 pt-1">
                <div><span className="text-muted-foreground">{t("creditsDeveloper")}: </span><span className="font-semibold">Capt. ABEDALQADER GHUNMAT</span></div>
                <div><span className="text-muted-foreground">{t("creditsPhone")}: </span><a href="tel:+9620775008345" className="text-primary hover:underline">0775008345</a></div>
                <div><span className="text-muted-foreground">{t("creditsEmail")}: </span><a href="mailto:ghneimatabed1@icloud.com" className="text-primary hover:underline">ghneimatabed1@icloud.com</a></div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
