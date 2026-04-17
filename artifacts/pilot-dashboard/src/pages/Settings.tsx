import { useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const { squadron, configureSquadron, fingerprint, releaseLicense } = useAuth();
  const [name, setName] = useState(squadron?.name || "");
  const [num, setNum] = useState(squadron?.number || "");
  const [base, setBase] = useState(squadron?.base || "");
  const [saved, setSaved] = useState(false);
  const save = (e: React.FormEvent) => { e.preventDefault(); configureSquadron({ name, number: num, base }); setSaved(true); setTimeout(() => setSaved(false), 1500); };

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
