import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { ShieldCheck, Languages, KeyRound, Smartphone } from "lucide-react";
import QRCode from "qrcode";

export default function LoginGate() {
  const {
    licensed, configured, activateLicense, configureSquadron, login, fingerprint,
    lockedUntil, user, pendingAdmin, verifyAdminTotp, cancelAdminTotp,
  } = useAuth();
  const { t, lang, setLang } = useI18n();

  const [licenseKey, setLicenseKey] = useState("DEMO-RJAF-1234-5678");
  const [licUsername, setLicUsername] = useState("");
  const [licError, setLicError] = useState<string | null>(null);

  const [name, setName] = useState("Royal Squadron");
  const [num, setNum] = useState("8");
  const [base, setBase] = useState("King Abdullah I AB");

  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // HQ users (super admin / commanders) bypass license + squadron setup.
  const [hqMode, setHqMode] = useState(false);

  const lockedRemaining = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0;

  useEffect(() => {
    if (!pendingAdmin) { setQrDataUrl(null); return; }
    let cancelled = false;
    QRCode.toDataURL(pendingAdmin.otpauth, { margin: 1, width: 192, color: { dark: "#0b0b0b", light: "#ffffffff" } })
      .then(url => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [pendingAdmin]);

  useEffect(() => { setCode(""); setCodeErr(null); }, [pendingAdmin?.mode]);

  const submitLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    setLicError(null);
    const r = await activateLicense(licenseKey, licUsername);
    if (!r.ok) setLicError(r.error || "Invalid");
  };
  const submitSetup = (e: React.FormEvent) => {
    e.preventDefault();
    configureSquadron({ name, number: num, base });
  };
  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const r = await login(u, p);
    if (!r.ok && !r.requires2fa) {
      setErr(r.error === "locked" ? t("lockedOut") : t("badCreds"));
    }
  };
  const submitTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeErr(null);
    const r = await verifyAdminTotp(code);
    if (!r.ok) {
      setCodeErr(r.error === "locked" ? t("lockedOut") : t("twoFactorBad"));
    }
  };

  const showLogin = hqMode || (licensed && configured && !user);

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
          <img src="brand/emblem.png" className="h-24 w-24 object-contain mb-3" alt="RJAF Emblem" />
          <div className="text-2xl font-semibold gold-grad text-center">{t("appName")}</div>
          <div className="text-xs text-muted-foreground text-center mt-1">{t("appTag")}</div>
        </div>

        <div className="panel p-6">
          {pendingAdmin ? (
            <form onSubmit={submitTotp} className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Smartphone className="h-4 w-4 text-amber-400" />
                {pendingAdmin.mode === "enroll" ? t("twoFactorEnrollTitle") : t("twoFactorVerifyTitle")}
              </div>
              {pendingAdmin.mode === "enroll" && (
                <>
                  <p className="text-xs text-muted-foreground">{t("twoFactorEnrollHint")}</p>
                  <div className="flex justify-center bg-white p-3 rounded-md">
                    {qrDataUrl
                      ? <img src={qrDataUrl} alt="2FA QR" className="h-44 w-44" data-testid="img-totp-qr" />
                      : <div className="h-44 w-44 animate-pulse bg-muted rounded" />}
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{t("twoFactorSecret")}</label>
                    <div data-testid="text-totp-secret" className="mt-1 px-3 py-2 rounded-md bg-input border border-border font-mono text-xs tracking-wider break-all select-all">
                      {pendingAdmin.secret}
                    </div>
                  </div>
                </>
              )}
              {pendingAdmin.mode === "verify" && (
                <p className="text-xs text-muted-foreground">{t("twoFactorVerifyHint")}</p>
              )}
              <div>
                <label htmlFor="totp-code" className="text-xs text-muted-foreground">{t("twoFactorCode")}</label>
                <input
                  id="totp-code"
                  data-testid="input-totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-center font-mono text-lg tracking-[0.4em]"
                  placeholder="000000"
                />
              </div>
              {lockedRemaining > 0
                ? <div className="text-xs text-amber-400">{t("lockedOut")} ({lockedRemaining}s)</div>
                : codeErr && <div className="text-xs text-destructive">{codeErr}</div>}
              <button
                type="submit"
                data-testid="button-verify-totp"
                disabled={lockedRemaining > 0 || code.length !== 6}
                className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50"
              >
                {pendingAdmin.mode === "enroll" ? t("twoFactorEnrollBtn") : t("twoFactorVerifyBtn")}
              </button>
              <button
                type="button"
                onClick={() => { cancelAdminTotp(); setCode(""); setCodeErr(null); }}
                className="w-full text-[11px] text-muted-foreground hover:text-foreground underline"
              >
                ← {t("cancel")}
              </button>
            </form>
          ) : showLogin ? (
            <form onSubmit={submitLogin} className="space-y-3">
              <div className="text-sm font-medium">{t("loginTitle")}</div>
              <Field label={t("username")} value={u} onChange={setU} />
              <Field label={t("password")} value={p} onChange={setP} type="password" />
              {lockedRemaining > 0
                ? <div className="text-xs text-amber-400">{t("lockedOut")} ({lockedRemaining}s)</div>
                : err && <div className="text-xs text-destructive">{err}</div>}
              <button data-testid="button-signin" disabled={lockedRemaining > 0} className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50">{t("signIn")}</button>
              <div className="text-[11px] text-muted-foreground text-center pt-1">
                {t("loginHelp")}
              </div>
              {hqMode && !licensed && (
                <button type="button" onClick={() => setHqMode(false)} className="w-full text-[11px] text-muted-foreground hover:text-foreground underline">
                  ← {t("licenseTitle")}
                </button>
              )}
            </form>
          ) : !licensed ? (
            <form onSubmit={submitLicense} className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-amber-400" />
                {t("licenseTitle")}
              </div>
              <p className="text-xs text-muted-foreground">{t("licensePrompt")}</p>
              <div>
                <label htmlFor="lic-user" className="text-xs text-muted-foreground">{t("operatorUsername")}</label>
                <input
                  id="lic-user"
                  data-testid="input-license-username"
                  value={licUsername}
                  onChange={e => setLicUsername(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm"
                  placeholder={t("operatorUsernamePh")}
                  autoComplete="username"
                />
              </div>
              <div>
                <label htmlFor="lic-key" className="text-xs text-muted-foreground">{t("licenseKey")}</label>
                <input
                  id="lic-key"
                  data-testid="input-license-key"
                  value={licenseKey}
                  onChange={e => setLicenseKey(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border font-mono text-sm tracking-wider"
                  placeholder="EE-XXX-XXXX-XXXX-XXXX-XXXX"
                />
              </div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <KeyRound className="h-3 w-3" /> {t("bindNotice")}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground break-all">FP: {fingerprint}</div>
              {licError && <div className="text-xs text-destructive">{licError}</div>}
              <button className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90">{t("activate")}</button>
              <button type="button" onClick={() => setHqMode(true)} className="w-full text-xs text-amber-400 hover:text-amber-300 pt-1">
                {t("superAdminPanel")} / {t("commanderDashboard")} →
              </button>
            </form>
          ) : (
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
  const id = `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const dt = label.toLowerCase().includes("user") ? "input-username" : label.toLowerCase().includes("pass") ? "input-password" : undefined;
  return (
    <div>
      <label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>
      <input id={id} data-testid={dt} type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm" />
    </div>
  );
}
