import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { ShieldCheck, Languages, KeyRound } from "lucide-react";

export default function LoginGate() {
  const { licensed, configured, activateLicense, configureSquadron, login, fingerprint, lockedUntil } = useAuth();
  const { t, lang, setLang } = useI18n();

  const [licenseKey, setLicenseKey] = useState("DEMO-RJAF-1234-5678");
  const [licError, setLicError] = useState<string | null>(null);

  const [name, setName] = useState("Royal Squadron");
  const [num, setNum] = useState("8");
  const [base, setBase] = useState("King Abdullah I AB");

  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const lockedRemaining = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0;

  const submitLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await activateLicense(licenseKey);
    if (!r.ok) setLicError(r.error || "Invalid");
  };
  const submitSetup = (e: React.FormEvent) => {
    e.preventDefault();
    configureSquadron({ name, number: num, base });
  };
  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await login(u, p);
    if (!r.ok) setErr(r.error === "locked" ? t("lockedOut") : t("badCreds"));
  };

  return (
    <div className="min-h-screen brand-bg flex items-center justify-center p-6">
      <div className="absolute top-4 right-4 rtl:left-4 rtl:right-auto">
        <button onClick={() => setLang(lang === "en" ? "ar" : "en")} className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1.5">
          <Languages className="h-3.5 w-3.5" />
          {lang === "en" ? t("arabic") : t("english")}
        </button>
      </div>

      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <img src="brand/emblem.png" className="h-20 w-20 object-contain mb-2" alt="RJAF Emblem" />
          <img src="brand/wings.png" className="h-10 object-contain mb-3 opacity-95" alt="Pilot Wings" />
          <div className="text-2xl font-semibold gold-grad text-center">{t("appName")}</div>
          <div className="text-xs text-muted-foreground text-center mt-1">{t("appTag")}</div>
        </div>

        <div className="panel p-6">
          {!licensed ? (
            <form onSubmit={submitLicense} className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-amber-400" />
                {t("licenseTitle")}
              </div>
              <p className="text-xs text-muted-foreground">{t("licensePrompt")}</p>
              <div>
                <label className="text-xs text-muted-foreground">{t("licenseKey")}</label>
                <input value={licenseKey} onChange={e => setLicenseKey(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border font-mono text-sm tracking-wider"
                  placeholder="RJAF-XXXX-XXXX-XXXX" />
              </div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <KeyRound className="h-3 w-3" /> {t("bindNotice")}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground break-all">FP: {fingerprint}</div>
              {licError && <div className="text-xs text-destructive">{licError}</div>}
              <button className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90">{t("activate")}</button>
            </form>
          ) : !configured ? (
            <form onSubmit={submitSetup} className="space-y-3">
              <div className="text-sm font-medium">{t("setupTitle")}</div>
              <p className="text-xs text-muted-foreground">{t("setupHint")}</p>
              <Field label={t("sqdnName")} value={name} onChange={setName} />
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("sqdnNumber")} value={num} onChange={setNum} />
                <Field label={t("base")} value={base} onChange={setBase} />
              </div>
              <button className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90">{t("save")}</button>
            </form>
          ) : (
            <form onSubmit={submitLogin} className="space-y-3">
              <div className="text-sm font-medium">{t("loginTitle")}</div>
              <Field label={t("username")} value={u} onChange={setU} />
              <Field label={t("password")} value={p} onChange={setP} type="password" />
              {lockedRemaining > 0
                ? <div className="text-xs text-amber-400">{t("lockedOut")} ({lockedRemaining}s)</div>
                : err && <div className="text-xs text-destructive">{err}</div>}
              <button disabled={lockedRemaining > 0} className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50">{t("signIn")}</button>
              <div className="text-[11px] text-muted-foreground text-center pt-1">Demo: any username + 4+ char password</div>
            </form>
          )}
        </div>

        <div className="text-[10px] text-center text-muted-foreground mt-4">
          © RJAF — Encrypted in transit (TLS) and at rest. Audit logged.
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm" />
    </div>
  );
}
