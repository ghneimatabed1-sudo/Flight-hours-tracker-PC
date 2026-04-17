import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { licenseKeys as initialKeys, squadrons } from "@/lib/mockData";
import type { LicenseKey } from "@/lib/types";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { KeyRound, Copy, Check } from "lucide-react";

function genKey(code: string): string {
  const rnd = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36).toUpperCase()).join("");
  return `EE-${code}-${rnd.slice(0, 4)}-${rnd.slice(4, 8)}-${rnd.slice(8, 12)}-${rnd.slice(12, 16)}`;
}

export default function LicenseKeys() {
  const { t, lang } = useI18n();
  const [keys, setKeys] = useState<LicenseKey[]>(initialKeys);
  const [genFor, setGenFor] = useState<string>("");
  const [genOpen, setGenOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleGenerate() {
    const sqn = squadrons.find(s => s.id === genFor);
    if (!sqn) return;
    const full = genKey(sqn.code);
    setNewKey(full);
    const newRecord: LicenseKey = {
      id: "key-" + Math.random().toString(36).slice(2, 8),
      squadronId: sqn.id,
      keyPreview: `EE-${sqn.code}-••••-${full.slice(-4)}`,
      status: "active",
      issuedAt: new Date().toISOString().slice(0, 10),
      lockedToDevice: null,
      lastSyncAt: null,
    };
    setKeys(k => [newRecord, ...k]);
  }

  function statusLabel(s: LicenseKey["status"]) {
    if (s === "active") return <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{t("active")}</span>;
    if (s === "revoked") return <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200">{t("revoked")}</span>;
    return <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200">{t("locked")}</span>;
  }

  function revoke(id: string) {
    setKeys(ks => ks.map(k => k.id === id ? { ...k, status: "revoked" } : k));
  }
  function release(id: string) {
    setKeys(ks => ks.map(k => k.id === id ? { ...k, status: "active", lockedToDevice: null } : k));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-bold flex items-center gap-2"><KeyRound className="h-5 w-5" />{t("licenseKeys")}</h2>
        <Button onClick={() => { setGenOpen(true); setNewKey(null); setGenFor(""); }} data-testid="button-generate">
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
                  <th className="text-start py-2 px-3">{t("status")}</th>
                  <th className="text-start py-2 px-3">{t("issued")}</th>
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
                      <td className="py-2 px-3">{statusLabel(k.status)}</td>
                      <td className="py-2 px-3 tabular-nums">{fmtDate(k.issuedAt, lang)}</td>
                      <td className="py-2 px-3 font-mono text-xs">{k.lockedToDevice ?? "—"}</td>
                      <td className="py-2 px-3 tabular-nums">{k.lastSyncAt ? fmtDateTime(k.lastSyncAt, lang) : "—"}</td>
                      <td className="py-2 px-3 text-end space-x-2 rtl:space-x-reverse">
                        {k.status === "locked" && (
                          <Button size="sm" variant="outline" onClick={() => release(k.id)} data-testid={`button-release-${k.id}`}>{t("release")}</Button>
                        )}
                        {k.status !== "revoked" && (
                          <Button size="sm" variant="destructive" onClick={() => revoke(k.id)} data-testid={`button-revoke-${k.id}`}>{t("revoke")}</Button>
                        )}
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
            <div className="space-y-3">
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
          ) : (
            <div className="space-y-3">
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
                <Button onClick={handleGenerate} disabled={!genFor} data-testid="button-confirm-gen">{t("generateKey")}</Button>
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
