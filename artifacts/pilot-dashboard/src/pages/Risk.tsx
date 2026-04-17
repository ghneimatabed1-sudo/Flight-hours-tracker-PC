import { useMemo, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";

const FACTORS_DAY = [
  { k: "wx", label: "Weather (vis/ceiling)", opts: [["VFR", 0], ["Marginal", 2], ["IFR", 4]] },
  { k: "crew", label: "Crew experience", opts: [["Senior", 0], ["Mixed", 2], ["Low time", 4]] },
  { k: "rest", label: "Crew rest", opts: [["≥10h", 0], ["8–10h", 1], ["<8h", 3]] },
  { k: "msn", label: "Mission complexity", opts: [["Routine", 0], ["Moderate", 2], ["Complex", 4]] },
  { k: "ac", label: "Aircraft status", opts: [["FMC", 0], ["PMC", 2], ["Limited", 4]] },
] as const;

const FACTORS_NVG = [
  ...FACTORS_DAY,
  { k: "lvl", label: "Illumination level", opts: [[">35%", 0], ["10–35%", 2], ["<10%", 4]] },
  { k: "ter", label: "Terrain", opts: [["Flat", 0], ["Rolling", 2], ["Mountainous", 4]] },
] as const;

function bandFor(score: number) {
  if (score <= 5) return { lbl: "LOW", cls: "text-emerald-300", bg: "bg-emerald-500/10" };
  if (score <= 12) return { lbl: "MEDIUM", cls: "text-amber-300", bg: "bg-amber-500/10" };
  return { lbl: "HIGH", cls: "text-rose-300", bg: "bg-rose-500/10" };
}

export default function Risk() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"day" | "nvg">("day");
  type Factor = { k: string; label: string; opts: readonly (readonly [string, number])[] };
  const factors: readonly Factor[] = tab === "day" ? (FACTORS_DAY as readonly Factor[]) : (FACTORS_NVG as readonly Factor[]);
  const [vals, setVals] = useState<Record<string, number>>({});
  const score = useMemo(() => factors.reduce((a, f) => a + (vals[f.k] ?? 0), 0), [factors, vals]);
  const band = bandFor(score);

  return (
    <div>
      <PageHead title={t("nav_risk")} subtitle="Auto-calculated · Day / Night / NVG" />
      <div className="flex gap-1 mb-3">
        {(["day", "nvg"] as const).map(k => (
          <button key={k} onClick={() => { setTab(k); setVals({}); }} className={`px-4 py-2 rounded-md text-sm ${tab === k ? "bg-card border border-border" : "text-muted-foreground"}`}>{k.toUpperCase()}</button>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 space-y-3">
          {factors.map(f => (
            <div key={f.k} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-4 text-sm">{f.label}</div>
              <div className="col-span-8 flex flex-wrap gap-2">
                {f.opts.map(([label, val]) => {
                  const sel = vals[f.k] === val;
                  return (
                    <button key={label as string} onClick={() => setVals(v => ({ ...v, [f.k]: val as number }))}
                      className={`px-3 py-1.5 rounded-md text-xs border ${sel ? "bg-primary text-primary-foreground border-primary" : "bg-secondary border-border"}`}>
                      {label} <span className="opacity-60">+{val}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Card>
        <Card className={`flex flex-col items-center justify-center text-center ${band.bg}`}>
          <div className="text-xs text-muted-foreground uppercase tracking-widest">Risk Score</div>
          <div className={`text-6xl font-bold font-mono ${band.cls}`}>{score}</div>
          <div className={`text-lg font-semibold mt-1 ${band.cls}`}>{band.lbl}</div>
          <div className="text-[11px] text-muted-foreground mt-3 max-w-xs">Auto-calculated from selected factors. Submit for commander approval through Coordinating Form.</div>
        </Card>
      </div>
    </div>
  );
}
