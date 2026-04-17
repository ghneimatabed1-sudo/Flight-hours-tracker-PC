import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { ShieldCheck, Languages, KeyRound, Smartphone, Phone, Mail } from "lucide-react";
import QRCode from "qrcode";

export default function LoginGate() {
  const {
    licensed, configured, activateLicense, configureSquadron, login, fingerprint,
    lockedUntil, user, pendingAdmin, verifyAdminTotp, cancelAdminTotp,
    pendingRecoveryCodes, ackRecoveryCodes,
  } = useAuth();
  const { t, lang, setLang } = useI18n();

  const [licenseKey, setLicenseKey] = useState("");
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
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCopied, setRecoveryCopied] = useState(false);

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

  useEffect(() => { setCode(""); setCodeErr(null); setRecoveryMode(false); }, [pendingAdmin?.mode]);

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
  const copyRecoveryCodes = async () => {
    if (!pendingRecoveryCodes) return;
    try {
      await navigator.clipboard.writeText(pendingRecoveryCodes.join("\n"));
      setRecoveryCopied(true);
      window.setTimeout(() => setRecoveryCopied(false), 2000);
    } catch { /* no-op */ }
  };
  const downloadRecoveryCodes = () => {
    if (!pendingRecoveryCodes) return;
    const header = "RJAF Pilot Dashboard — Super Admin recovery codes\n" +
      "Generated: " + new Date().toISOString() + "\n" +
      "Keep these somewhere safe. Each one works only once.\n\n";
    const blob = new Blob([header + pendingRecoveryCodes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rjaf-admin-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
          {pendingRecoveryCodes ? (
            <div className="space-y-3" data-testid="panel-recovery-codes">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="h-4 w-4 text-amber-400" />
                {t("recoveryCodesTitle")}
              </div>
              <p className="text-xs text-muted-foreground">{t("recoveryCodesHint")}</p>
              <div
                data-testid="list-recovery-codes"
                className="grid grid-cols-2 gap-2 p-3 rounded-md bg-input border border-border font-mono text-sm tracking-wider select-all"
              >
                {pendingRecoveryCodes.map((c, i) => (
                  <div key={i} className="py-0.5" data-testid={`text-recovery-code-${i}`}>{c}</div>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="button-copy-recovery-codes"
                  onClick={copyRecoveryCodes}
                  className="flex-1 py-1.5 rounded-md border border-border hover:bg-secondary text-xs"
                >
                  {recoveryCopied ? t("copied") : t("copy")}
                </button>
                <button
                  type="button"
                  data-testid="button-download-recovery-codes"
                  onClick={downloadRecoveryCodes}
                  className="flex-1 py-1.5 rounded-md border border-border hover:bg-secondary text-xs"
                >
                  {t("download")}
                </button>
              </div>
              <p className="text-[11px] text-amber-400">{t("recoveryCodesWarn")}</p>
              <button
                type="button"
                data-testid="button-ack-recovery-codes"
                onClick={() => { setRecoveryCopied(false); ackRecoveryCodes(); }}
                className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90"
              >
                {t("recoveryCodesAck")}
              </button>
            </div>
          ) : pendingAdmin ? (
            <form onSubmit={submitTotp} className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Smartphone className="h-4 w-4 text-amber-400" />
                {pendingAdmin.mode === "enroll"
                  ? t("twoFactorEnrollTitle")
                  : recoveryMode ? t("recoveryVerifyTitle") : t("twoFactorVerifyTitle")}
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
                <p className="text-xs text-muted-foreground">
                  {recoveryMode ? t("recoveryVerifyHint") : t("twoFactorVerifyHint")}
                </p>
              )}
              <div>
                <label htmlFor="totp-code" className="text-xs text-muted-foreground">
                  {recoveryMode ? t("recoveryCodeLabel") : t("twoFactorCode")}
                </label>
                {recoveryMode ? (
                  <input
                    id="totp-code"
                    data-testid="input-recovery-code"
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={9}
                    value={code}
                    onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-7-]/g, "").slice(0, 9))}
                    className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-center font-mono text-base tracking-[0.3em] uppercase"
                    placeholder="XXXX-XXXX"
                  />
                ) : (
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
                )}
              </div>
              {lockedRemaining > 0
                ? <div className="text-xs text-amber-400">{t("lockedOut")} ({lockedRemaining}s)</div>
                : codeErr && <div className="text-xs text-destructive">{codeErr}</div>}
              <button
                type="submit"
                data-testid="button-verify-totp"
                disabled={
                  lockedRemaining > 0 ||
                  (recoveryMode
                    ? code.replace(/-/g, "").length !== 8
                    : code.length !== 6)
                }
                className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50"
              >
                {pendingAdmin.mode === "enroll"
                  ? t("twoFactorEnrollBtn")
                  : recoveryMode ? t("recoveryVerifyBtn") : t("twoFactorVerifyBtn")}
              </button>
              {pendingAdmin.mode === "verify" && (
                <button
                  type="button"
                  data-testid="button-toggle-recovery"
                  onClick={() => { setRecoveryMode(r => !r); setCode(""); setCodeErr(null); }}
                  className="w-full text-[11px] text-amber-400 hover:text-amber-300 underline"
                >
                  {recoveryMode ? t("recoveryUseTotp") : t("recoveryLostDevice")}
                </button>
              )}
              <button
                type="button"
                onClick={() => { cancelAdminTotp(); setCode(""); setCodeErr(null); setRecoveryMode(false); }}
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

        {/* Contact strip — subtle, centered, visible on every login screen
            so anyone without a license key can find the developer. */}
        <div className="mt-6 flex flex-col items-center gap-2.5">
          <div className="flex items-center gap-3 w-full">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-border" />
            <div className="text-[10px] uppercase tracking-[0.2em] gold-grad font-semibold">
              {t("creditsTitle")}
            </div>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-border" />
          </div>

          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("creditsDeveloper")}
            </div>
            <div className="text-sm font-semibold text-foreground tracking-wide mt-0.5">
              Capt. ABEDALQADER GHUNMAT
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            <a
              href="tel:+9620775008345"
              data-testid="link-credits-phone"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-secondary/40 hover:bg-secondary hover:border-amber-400/40 transition text-[11px] font-medium text-foreground"
            >
              <Phone className="h-3 w-3 text-amber-400" />
              +962 77 500 8345
            </a>
            <a
              href="mailto:ghneimatabed1@icloud.com"
              data-testid="link-credits-email"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-secondary/40 hover:bg-secondary hover:border-amber-400/40 transition text-[11px] font-medium text-foreground"
            >
              <Mail className="h-3 w-3 text-amber-400" />
              ghneimatabed1@icloud.com
            </a>
          </div>

          <p className="text-[10px] text-muted-foreground text-center leading-snug max-w-xs px-2">
            {t("creditsBlurb")}
          </p>
        </div>

        <div className="text-[10px] text-center text-muted-foreground mt-5">
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
