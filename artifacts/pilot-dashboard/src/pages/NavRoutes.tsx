import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { Upload, FileDown, Map } from "lucide-react";

export default function NavRoutes() {
  const { t } = useI18n();
  return (
    <div>
      <PageHead title={t("nav_navroutes")} subtitle="Current nav routes PDF" actions={
        <button className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-1.5"><Upload className="h-4 w-4" /> Upload PDF</button>
      } />
      <Card className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Map className="h-16 w-16 text-amber-400 mb-3" />
        <div className="text-lg font-semibold gold-grad">Nav Routes — Current</div>
        <div className="text-sm text-muted-foreground mt-1">No PDF uploaded yet · uploaded files render here</div>
        <button className="mt-4 px-3 py-1.5 rounded-md bg-secondary border border-border text-sm inline-flex items-center gap-1.5"><FileDown className="h-4 w-4" /> Download last</button>
      </Card>
    </div>
  );
}
