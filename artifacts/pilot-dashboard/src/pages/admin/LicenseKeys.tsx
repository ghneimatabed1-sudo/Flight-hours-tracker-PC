import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { squadrons } from "@/lib/mockData";
import type { LicenseKey, LicenseDuration } from "@/lib/types";
import { addDuration, addDays } from "@/lib/types";
import { listLicenseKeys, registerLicenseKey, updateLicenseKey, removeLicenseKey } from "@/lib/license-registry";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { KeyRound, Copy, Check, User as UserIcon } from "lucide-react";

function genKey(code: string): string {
  const rnd = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36).toUpperCase()).join("");
  return `EE-${code}-${rnd.slice(0, 4)}-${rnd.slice(4, 8)}-${rnd.slice(8, 12)}-${rnd.slice(12, 16)}`;
}

const DURATIONS: LicenseDuration[] = ["1d", "2d", "1m", "3m", "6m", "1y", "3y", "never"];
// Sentinel value used by the duration <Select> to mean "use the custom days
// input below". Kept outside the LicenseDuration type so it never leaks into
// addDuration() or the persisted record.
const CUSTOM_DURATION = "__custom__";

export default function LicenseKeys() {
  const { t, lang } = useI18n();
  const [keys, setKeys] = useState<LicenseKey[]>(() => listLicenseKeys());
  const [genFor, setGenFor] = useState<string>("");
  const [genUsername, setGenUsername] = useState<string>("");
  const [genDuration, setGenDuration] = useState<LicenseDuration | typeof CUSTOM_DURATION>("1y");
  const [genCustomDays, setGenCustomDays] = useState<string>("5");
  const [genOpen, setGenOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Resolve the picked duration (preset or custom) into an ISO expiry date.
  // Returns null for "never expires" or invalid custom input.
  function resolveExpiry(issuedAt: string): { expiresAt: string | null; valid: boolean } {
    if (genDuration === CUSTOM_DURATION) {
      const n = Number(genCustomDays);
      if (!Number.isFinite(n) || n <= 0) return { expiresAt: null, valid: false };
      return { expiresAt: addDays(issuedAt, n), valid: true };
    }
    return { expiresAt: addDuration(issuedAt, genDuration), valid: true };
  }

  function handleGenerate() {
    const sqn = squadrons.find(s => s.id === genFor);
    if (!sqn) return;
    const username = genUsername.trim();
    if (!username) return;
    const issuedAt = new Date().toISOString().slice(0, 10);
    const { expiresAt, valid } = resolveExpiry(issuedAt);
    if (!valid) return;
    const full = genKey(sqn.code);
    setNewKey(full);
    const newRecord: LicenseKey = {
      id: "key-" + Math.random().toString(36).slice(2, 8),
      squadronId: sqn.id,
      keyPreview: `EE-${sqn.code}-••••-${full.slice(-4)}`,
      status: "active",
      issuedAt,
      expiresAt,
      assignedUsername: username,
      lockedToDevice: null,
      lastSyncAt: null,
    };
    registerLicenseKey({ fullKey: full, meta: newRecord });
    setKeys(() => listLicenseKeys());
  }

  function isExpired(k: LicenseKey): boolean {
    return Boolean(k.expiresAt) && +new Date(k.expiresAt!) < Date.now();
  }

  function statusLabel(s: LicenseKey["status"]) {
    if (s === "active") return <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{t("active")}</span>;
    if (s === "revoked") return <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200">{t("revoked")}</span>;
    return <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200">{t("locked")}</span>;
  }

  function revoke(id: string) {
    updateLicenseKey(id, { status: "revoked" });
    setKeys(() => listLicenseKeys());
  }
  function release(id: string) {
    updateLicenseKey(id, { status: "active", lockedToDevice: null });
    setKeys(() => listLicenseKeys());
  }
  // Hard-delete: wipes the row from the registry entirely. Used after an
  // operator uninstalls and the super admin wants the entry gone — not just
  // revoked. Confirmation prompt prevents accidental clicks.
  function hardDelete(k: LicenseKey) {
    const sqn = squadrons.find(s => s.id === k.squadronId);
    const sqnName = sqn ? (lang === "ar" ? sqn.nameAr : sqn.name) : "—";
    const who = k.assignedUsername || "—";
    const msg = lang === "ar"
      ? `حذف نهائي للمفتاح المخصص لـ "${who}" (${sqnName})؟\n\nلن تتمكن من تفعيل هذا المفتاح مجدداً. سيتعين إصدار مفتاح جديد.`
      : `Permanently delete the key issued to "${who}" (${sqnName})?\n\nThis key string can never be activated again. A new key must be issued.`;
    if (!window.confirm(msg)) return;
    removeLicenseKey(k.id);
    setKeys(() => listLicenseKeys());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-bold flex items-center gap-2"><KeyRound className="h-5 w-5" />{t("licenseKeys")}</h2>
        <Button onClick={() => { setGenOpen(true); setNewKey(null); setGenFor(""); setGenUsername(""); setGenDuration("1y"); setGenCustomDays("5"); }} data-testid="button-generate">
          {t("generateKey")}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="text-start py-2 px-3">{t("squadron")}</th>
                  <th className="text-start py-2 px-3">{t("key")}</th>
                  <th className="text-start py-2 px-3">{t("assignedTo")}</th>
                  <th className="text-start py-2 px-3">{t("status")}</th>
                  <th className="text-start py-2 px-3">{t("issued")}</th>
                  <th className="text-start py-2 px-3">{t("expires")}</th>
                  <th className="text-start py-2 px-3">{t("device")}</th>
                  <th className="text-start py-2 px-3">{t("lastSync")}</th>
                  <th className="text-end py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => {
                  const sqn = squadrons.find(s => s.id === k.squadronId);
                  return (
                    <tr key={k.id} className="border-b border-border/60" data-testid={`row-key-${k.id}`}>
                      <td className="py-2 px-3 font-medium">{sqn ? (lang === "ar" ? sqn.nameAr : sqn.name) : "—"}</td>
                      <td className="py-2 px-3 font-mono text-xs">{k.keyPreview}</td>
                      <td className="py-2 px-3 text-xs" data-testid={`text-assigned-${k.id}`}>{k.assignedUsername || "—"}</td>
                      <td className="py-2 px-3">
                        {statusLabel(k.status)}
                        {isExpired(k) && k.status !== "revoked" ? (
                          <span className="ms-1 inline-flex rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" data-testid={`badge-expired-${k.id}`}>{t("expiredKey")}</span>
                        ) : null}
                      </td>
                      <td className="py-2 px-3 tabular-nums">{fmtDate(k.issuedAt, lang)}</td>
                      <td className="py-2 px-3 tabular-nums" data-testid={`text-expires-${k.id}`}>
                        {k.expiresAt ? fmtDate(k.expiresAt, lang) : <span className="text-muted-foreground">{t("neverExpires")}</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-xs">{k.lockedToDevice ?? "—"}</td>
                      <td className="py-2 px-3 tabular-nums">{k.lastSyncAt ? fmtDateTime(k.lastSyncAt, lang) : "—"}</td>
                      <td className="py-2 px-3 text-end space-x-2 rtl:space-x-reverse">
                        {k.status === "locked" && (
                          <Button size="sm" variant="outline" onClick={() => release(k.id)} data-testid={`button-release-${k.id}`}>{t("release")}</Button>
                        )}
                        {k.status !== "revoked" && (
                          <Button size="sm" variant="destructive" onClick={() => revoke(k.id)} data-testid={`button-revoke-${k.id}`}>{t("revoke")}</Button>
                        )}
                        <Button size="sm" variant="destructive" onClick={() => hardDelete(k)} data-testid={`button-delete-${k.id}`}>{t("delete")}</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newKey ? t("newKeyTitle") : t("generateKey")}</DialogTitle>
            {newKey && <DialogDescription>{t("newKeyHelp")}</DialogDescription>}
          </DialogHeader>
          {!newKey ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("squadron")}</label>
                <Select value={genFor} onValueChange={setGenFor}>
                  <SelectTrigger data-testid="select-squadron"><SelectValue placeholder={t("selectSquadron")} /></SelectTrigger>
                  <SelectContent>
                    {squadrons.map(s => (
                      <SelectItem key={s.id} value={s.id}>{lang === "ar" ? s.nameAr : s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <UserIcon className="h-3.5 w-3.5" /> {t("operatorUsername")}
                </label>
                <input
                  value={genUsername}
                  onChange={e => setGenUsername(e.target.value)}
                  placeholder={t("operatorUsernamePh")}
                  className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm"
                  data-testid="input-username"
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">{t("operatorUsernameHelp")}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("licenseDuration")}</label>
                <Select value={genDuration} onValueChange={(v) => setGenDuration(v as LicenseDuration | typeof CUSTOM_DURATION)}>
                  <SelectTrigger data-testid="select-duration"><SelectValue placeholder={t("selectDuration")} /></SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map(d => (
                      <SelectItem key={d} value={d} data-testid={`option-duration-${d}`}>{t(`duration_${d}` as const)}</SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_DURATION} data-testid="option-duration-custom">{t("duration_custom")}</SelectItem>
                  </SelectContent>
                </Select>
                {genDuration === CUSTOM_DURATION && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      step={1}
                      value={genCustomDays}
                      onChange={e => setGenCustomDays(e.target.value)}
                      className="w-24 px-3 py-2 rounded-md bg-input border border-border text-sm tabular-nums"
                      data-testid="input-custom-days"
                    />
                    <span className="text-xs text-muted-foreground">{t("days")}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground" data-testid="text-expiry-preview">
                  {(() => {
                    const today = new Date().toISOString().slice(0, 10);
                    const { expiresAt, valid } = resolveExpiry(today);
                    if (!valid) return t("invalidDuration");
                    if (!expiresAt) return t("neverExpires");
                    return `${t("expires")}: ${fmtDate(expiresAt, lang)}`;
                  })()}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                {t("issuedToLine").replace("{user}", genUsername)}
              </div>
              <div className="font-mono text-sm bg-muted p-3 rounded border break-all" data-testid="text-newkey">{newKey}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { navigator.clipboard.writeText(newKey); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                data-testid="button-copy"
              >
                {copied ? <Check className="h-4 w-4 me-1" /> : <Copy className="h-4 w-4 me-1" />}
                {copied ? t("copied") : t("copy")}
              </Button>
            </div>
          )}
          <DialogFooter>
            {!newKey ? (
              <>
                <Button variant="outline" onClick={() => setGenOpen(false)}>{t("cancel")}</Button>
                <Button
                  onClick={handleGenerate}
                  disabled={!genFor || !genUsername.trim() || (genDuration === CUSTOM_DURATION && !(Number(genCustomDays) > 0))}
                  data-testid="button-confirm-gen"
                >
                  {t("generateKey")}
                </Button>
              </>
            ) : (
              <Button onClick={() => setGenOpen(false)} data-testid="button-done">{t("done")}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
