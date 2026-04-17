import { useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { NOTAMS } from "@/lib/mock";
import { Plus, Megaphone } from "lucide-react";

export default function NotamsPage() {
  const { t } = useI18n();
  const [list, setList] = useState(NOTAMS);
  const [text, setText] = useState("");
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setList(x => [{ id: "N" + Date.now(), date: new Date().toISOString().slice(0,10), text }, ...x]);
    setText("");
  };
  return (
    <div>
      <PageHead title={t("nav_notams")} subtitle="Navigation notices by date" />
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-2">
          {list.map(n => (
            <Card key={n.id} className="flex gap-3 items-start">
              <Megaphone className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-[11px] text-muted-foreground font-mono">{n.id} · {n.date}</div>
                <div className="text-sm">{n.text}</div>
              </div>
            </Card>
          ))}
        </div>
        <Card>
          <form onSubmit={add} className="space-y-3">
            <div className="text-sm font-semibold">New NOTAM</div>
            <textarea rows={5} value={text} onChange={e=>setText(e.target.value)} placeholder="Enter NOTAM text…"
              className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm" />
            <button className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium inline-flex items-center justify-center gap-1.5"><Plus className="h-4 w-4" /> Publish</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
