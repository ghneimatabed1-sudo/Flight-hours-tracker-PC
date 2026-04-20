import { useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useCurrencyWindow, DEFAULT_CURRENCY_WINDOW } from "@/lib/currency-settings";
import { usePilots, useAllLinkedDevices, useRevokePilotDevices } from "@/lib/squadron-data";
import { Smartphone, ShieldOff, Loader2 } from "lucide-react";

function MobileDevicesCard() {
  const { user } = useAuth();
  const pilotsQ = usePilots();
  const devicesQ = useAllLinkedDevices();
  const revoke = useRevokePilotDevices();
  const [manualId, setManualId] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pilotById = Object.fromEntries((pilotsQ.data ?? []).map(p => [p.id, p]));
  const devices = devicesQ.data ?? [];

  const doRevoke = async (pilotId: string) => {
    if (!window.confirm(`Revoke mobile access for pilot ${pilotById[pilotId]?.name || pilotId}? The phone will be locked out immediately.`)) return;
    setRevoking(pilotId);
    try {
      const res = await revoke.mutateAsync({ pilotId, actor: user?.username });
      setNotice(`Revoked ${res.revoked} device(s) for ${pilotById[pilotId]?.name || pilotId}.`);
      setTimeout(() => setNotice(null), 4000);
    } catch (e) {
      setNotice(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRevoking(null);
    }
  };

  const doManualRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = manualId.trim();
    if (!id) return;
    await doRevoke(id);
    setManualId("");
  };

  const fmtDate = (iso: string) => {
    try { const d = new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; }
    catch { return iso; }
  };

  return (
    <Card className="lg:col-span-2 space-y-3">
      <div className="flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-primary" />
        <div className="text-sm font-semibold">Mobile Devices — Active Connections</div>
      </div>
      <p className="text-xs text-muted-foreground">
        All phones currently linked to this squadron's Hawk Eye mobile app. You can revoke access for any pilot here —
        even if that pilot has been removed from the roster.
        After revocation the phone is locked out immediately; the pilot will need a new pairing code to reconnect.
      </p>

      {devicesQ.isLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading devices…</div>}
      {!devicesQ.isLoading && devices.length === 0 && (
        <div className="text-xs text-muted-foreground py-2">No active mobile connections found.</div>
      )}

      {devices.length > 0 && (
        <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
          {devices.map(dev => {
            const pilot = pilotById[dev.pilotId];
            const isRevoking = revoking === dev.pilotId;
            return (
              <div key={dev.pilotId} className="flex items-center justify-between px-3 py-2.5 bg-card">
                <div>
                  <div className="text-sm font-medium">
                    {pilot ? `${pilot.rank} ${pilot.name}` : <span className="text-amber-300">Pilot not in roster</span>}
                    <span className="ms-2 text-xs text-muted-foreground font-mono">({dev.pilotId})</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Linked: {fmtDate(dev.linkedAt)} · Last seen: {fmtDate(dev.lastSeenAt)}
                  </div>
                </div>
                <button
                  onClick={() => doRevoke(dev.pilotId)}
                  disabled={isRevoking}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-destructive/15 text-rose-300 border border-destructive/40 hover:bg-destructive/25 disabled:opacity-50"
                  data-testid={`button-revoke-device-${dev.pilotId}`}
                >
                  {isRevoking ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldOff className="h-3 w-3" />}
                  Revoke
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual revoke for orphaned pilot IDs not in the device list yet */}
      <div className="pt-2 border-t border-border">
        <div className="text-xs text-muted-foreground mb-1.5 font-semibold">Revoke by Pilot ID (for removed or unlisted pilots)</div>
        <form onSubmit={doManualRevoke} className="flex gap-2">
          <input
            value={manualId}
            onChange={e => setManualId(e.target.value)}
            placeholder="e.g. P001"
            className="flex-1 px-3 py-1.5 rounded-md bg-input border border-border text-sm font-mono"
            data-testid="input-manual-revoke-pilot-id"
          />
          <button
            type="submit"
            disabled={!manualId.trim() || revoke.isPending}
            className="px-3 py-1.5 rounded-md text-sm bg-destructive/15 text-rose-300 border border-destructive/40 hover:bg-destructive/25 disabled:opacity-50"
            data-testid="button-manual-revoke"
          >
            <ShieldOff className="h-3.5 w-3.5 inline me-1" />Revoke
          </button>
        </form>
      </div>

      {notice && (
        <div className={`text-xs px-3 py-2 rounded-md border ${notice.startsWith("Error") ? "bg-destructive/10 text-rose-300 border-destructive/40" : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"}`}>
          {notice}
        </div>
      )}
    </Card>
  );
}

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
  const [curNight, setCurNight] = useState<string>(String(curWindow.night));
  const [curNvg, setCurNvg] = useState<string>(String(curWindow.nvg));
  const [curIrt, setCurIrt] = useState<string>(String(curWindow.instrument));
  const [curMed, setCurMed] = useState<string>(String(curWindow.medical));
  const [curSaved, setCurSaved] = useState(false);
  const parseOr = (raw: string, fallback: number) => {
    const v = parseInt(raw, 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const saveCurrencyWindow = (e: React.FormEvent) => {
    e.preventDefault();
    setCurWindow({
      day: parseOr(curDay, DEFAULT_CURRENCY_WINDOW.day),
      night: parseOr(curNight, DEFAULT_CURRENCY_WINDOW.night),
      nvg: parseOr(curNvg, DEFAULT_CURRENCY_WINDOW.nvg),
      instrument: parseOr(curIrt, DEFAULT_CURRENCY_WINDOW.instrument),
      medical: parseOr(curMed, DEFAULT_CURRENCY_WINDOW.medical),
    });
    setCurSaved(true);
    setTimeout(() => setCurSaved(false), 1500);
  };
  const resetCurrencyWindow = () => {
    setCurDay(String(DEFAULT_CURRENCY_WINDOW.day));
    setCurNight(String(DEFAULT_CURRENCY_WINDOW.night));
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 max-w-3xl">
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
                <span className="text-xs text-muted-foreground">{t("nightCurrencyDays")}</span>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={1}
                    max={1095}
                    value={curNight}
                    onChange={e => setCurNight(e.target.value)}
                    data-testid="input-currency-window-night"
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
                {" · "}Night <span className="font-mono">{curWindow.night}d</span>
                {" · "}NVG <span className="font-mono">{curWindow.nvg}d</span>
                {" · "}IRT <span className="font-mono">{curWindow.instrument}d</span>
                {" · "}Med <span className="font-mono">{curWindow.medical}d</span>
              </span>
            </div>
          </form>
        </Card>
        <MobileDevicesCard />
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
