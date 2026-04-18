import { useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useCurrencyWindow, DEFAULT_CURRENCY_WINDOW } from "@/lib/currency-settings";

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const { squadron, configureSquadron, fingerprint, releaseLicense } = useAuth();
  const [name, setName] = useState(squadron?.name || "");
  const [num, setNum] = useState(squadron?.number || "");
  const [base, setBase] = useState(squadron?.base || "");
  const [saved, setSaved] = useState(false);
  const save = (e: React.FormEvent) => { e.preventDefault(); configureSquadron({ name, number: num, base }); setSaved(true); setTimeout(() => setSaved(false), 1500); };

  const [curWindow, setCurWindow] = useCurrencyWindow();
  const [curDay, setCurDay] = useState<string>(String(curWindow.day));
  const [curNvg, setCurNvg] = useState<string>(String(curWindow.nvg));
  const [curIrt, setCurIrt] = useState<string>(String(curWindow.instrument));
  const [curMed, setCurMed] = useState<string>(String(curWindow.medical));
  const [curSaved, setCurSaved] = useState(false);
  const saveCurrencyWindow = (e: React.FormEvent) => {
    e.preventDefault();
    const d = parseInt(curDay, 10);
    const n = parseInt(curNvg, 10);
    const i = parseInt(curIrt, 10);
    const m = parseInt(curMed, 10);
    setCurWindow({
      day: Number.isFinite(d) && d > 0 ? d : DEFAULT_CURRENCY_WINDOW.day,
      nvg: Number.isFinite(n) && n > 0 ? n : DEFAULT_CURRENCY_WINDOW.nvg,
      instrument: Number.isFinite(i) && i > 0 ? i : DEFAULT_CURRENCY_WINDOW.instrument,
      medical: Number.isFinite(m) && m > 0 ? m : DEFAULT_CURRENCY_WINDOW.medical,
    });
    setCurSaved(true);
    setTimeout(() => setCurSaved(false), 1500);
  };
  const resetCurrencyWindow = () => {
    setCurDay(String(DEFAULT_CURRENCY_WINDOW.day));
    setCurNvg(String(DEFAULT_CURRENCY_WINDOW.nvg));
    setCurIrt(String(DEFAULT_CURRENCY_WINDOW.instrument));
    setCurMed(String(DEFAULT_CURRENCY_WINDOW.medical));
    setCurWindow({ ...DEFAULT_CURRENCY_WINDOW });
    setCurSaved(true);
    setTimeout(() => setCurSaved(false), 1500);
  };

  return (
    <div>
      <PageHead title={t("nav_settings")} />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <form onSubmit={save} className="space-y-3">
            <div className="text-sm font-semibold">{t("setupTitle")}</div>
            <Field label={t("sqdnName")} value={name} onChange={setName} />
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("sqdnNumber")} value={num} onChange={setNum} />
              <Field label={t("base")} value={base} onChange={setBase} />
            </div>
            <button className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium">{t("save_changes")}</button>
            {saved && <span className="text-emerald-300 text-sm ml-2">✔ Saved</span>}
          </form>
        </Card>
        <Card className="space-y-3">
          <div className="text-sm font-semibold">{t("language")}</div>
          <div className="flex gap-2">
            <button onClick={()=>setLang("en")} className={`px-3 py-1.5 rounded-md text-sm ${lang==="en" ? "bg-primary text-primary-foreground" : "bg-secondary border border-border"}`}>{t("english")}</button>
            <button onClick={()=>setLang("ar")} className={`px-3 py-1.5 rounded-md text-sm ${lang==="ar" ? "bg-primary text-primary-foreground" : "bg-secondary border border-border"}`}>{t("arabic")}</button>
          </div>
          <hr className="border-border" />
          <div className="text-sm font-semibold">License & Hardware</div>
          <div className="text-xs text-muted-foreground">PC fingerprint (locked):</div>
          <div className="font-mono text-xs break-all bg-secondary p-2 rounded border border-border">{fingerprint}</div>
          <button onClick={releaseLicense} className="px-3 py-1.5 rounded-md text-sm bg-destructive/20 text-destructive border border-destructive/40">Release license</button>
          <hr className="border-border" />
          <div className="text-sm font-semibold">Auto-Update</div>
          <p className="text-xs text-muted-foreground">When a new version is released, the desktop app updates itself silently. Currently on v1.0.0.</p>
          <button className="px-3 py-1.5 rounded-md text-sm bg-secondary border border-border">Check for updates</button>
        </Card>
        <Card className="lg:col-span-2 space-y-3">
          <form onSubmit={saveCurrencyWindow} className="space-y-3">
            <div className="text-sm font-semibold">{t("currencyWindowTitle")}</div>
            <p className="text-xs text-muted-foreground">{t("currencyWindowBlurb")}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl">
              <label className="block">
                <span className="text-xs text-muted-foreground">{t("dayCurrencyDays")}</span>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={1}
                    max={1095}
                    value={curDay}
                    onChange={e => setCurDay(e.target.value)}
                    data-testid="input-currency-window-day"
                    className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm font-mono"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{t("days")}</span>
                </div>
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">{t("nvgCurrencyDays")}</span>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={1}
                    max={1095}
                    value={curNvg}
                    onChange={e => setCurNvg(e.target.value)}
                    data-testid="input-currency-window-nvg"
                    className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm font-mono"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{t("days")}</span>
                </div>
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">{t("instrumentCurrencyDays")}</span>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={1}
                    max={1095}
                    value={curIrt}
                    onChange={e => setCurIrt(e.target.value)}
                    data-testid="input-currency-window-instrument"
                    className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm font-mono"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{t("days")}</span>
                </div>
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">{t("medicalCurrencyDays")}</span>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={1}
                    max={1095}
                    value={curMed}
                    onChange={e => setCurMed(e.target.value)}
                    data-testid="input-currency-window-medical"
                    className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm font-mono"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{t("days")}</span>
                </div>
              </label>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="submit" className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm" data-testid="button-save-currency-window">{t("save_changes")}</button>
              <button type="button" onClick={resetCurrencyWindow} className="px-4 py-2 rounded-md bg-secondary border border-border text-sm" data-testid="button-reset-currency-window">{t("resetDefaults")}</button>
              {curSaved && <span className="text-emerald-300 text-sm">✔</span>}
              <span className="text-[11px] text-muted-foreground ms-auto">
                {t("currentWindow")}:
                {" "}Day <span className="font-mono">{curWindow.day}d</span>
                {" · "}NVG <span className="font-mono">{curWindow.nvg}d</span>
                {" · "}IRT <span className="font-mono">{curWindow.instrument}d</span>
                {" · "}Med <span className="font-mono">{curWindow.medical}d</span>
              </span>
            </div>
          </form>
        </Card>
        <Card className="lg:col-span-2 flex items-center gap-5">
          <img src="brand/wings.png" className="h-16 object-contain shrink-0 opacity-95" alt="Pilot Wings" />
          <div className="space-y-1.5 flex-1">
            <div className="text-sm font-semibold gold-grad">{t("creditsTitle")}</div>
            <div className="text-sm">{t("creditsDeveloper")}: <span className="font-semibold">Capt. ABEDALQADER GHUNMAT</span></div>
            <div className="text-sm">{t("creditsPhone")}: <a href="tel:+9620775008345" className="text-primary hover:underline">0775008345</a></div>
            <div className="text-sm">{t("creditsEmail")}: <a href="mailto:ghneimatabed1@icloud.com" className="text-primary hover:underline">ghneimatabed1@icloud.com</a></div>
            <p className="text-xs text-muted-foreground pt-1">{t("creditsBlurb")}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input value={value} onChange={e=>onChange(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm" />
    </label>
  );
}
