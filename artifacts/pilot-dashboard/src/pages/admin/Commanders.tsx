import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { squadrons } from "@/lib/mockData";
import {
  listCommanders,
  createCommander,
  deleteCommander,
  resetCommanderPassword,
  type CommanderRecord,
  type AccountRole,
} from "@/lib/commander-store";
import type { CommanderScope } from "@/lib/types";
import { Users, Plus, Trash2, KeyRound, Copy, Info } from "lucide-react";

const scopeKeys: Record<CommanderScope, "scopeSquadron" | "scopeFlight" | "scopeWing" | "scopeBase" | "scopeHQ"> = {
  squadron: "scopeSquadron",
  flight: "scopeFlight",
  wing: "scopeWing",
  base: "scopeBase",
  hq: "scopeHQ",
};

// A "tier" is a single selector that combines role + scope for the UI.
// Internally the store still holds role ∈ {commander, ops} and a
// CommanderScope, but the Super Admin only ever picks one tier here.
type Tier = "hq" | "base" | "wing" | "squadron" | "flight" | "ops";

function tierToRoleScope(tier: Tier): { role: AccountRole; scope?: CommanderScope } {
  if (tier === "ops") return { role: "ops" };
  return { role: "commander", scope: tier as CommanderScope };
}

export default function Commanders() {
  const { t, lang } = useI18n();
  const [list, setList] = useState<CommanderRecord[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  // A single selector whose options mirror the scope names plus "Ops Officer".
  // Translates to (role, scope) internally when creating the account.
  const [tier, setTier] = useState<Tier>("squadron");
  const [createError, setCreateError] = useState<string | null>(null);

  // One-time plaintext password shown right after create or reset. Kept in
  // memory only; closing the dialog clears it so it never lives anywhere
  // persistent.
  const [credsShow, setCredsShow] = useState<{ username: string; password: string } | null>(null);

  useEffect(() => {
    setList(listCommanders());
  }, []);

  function refresh() {
    setList(listCommanders());
  }

  async function create() {
    setCreateError(null);
    if (!username.trim()) { setCreateError(t("missingUsername")); return; }
    if (!name.trim()) { setCreateError(t("missingName")); return; }
    const { role, scope } = tierToRoleScope(tier);
    // Per Super Admin policy, squadron-monitoring scope is NEVER set here —
    // it is controlled exclusively by the license key issued from the PC
    // Management page. HQ commanders implicitly see every squadron; everyone
    // else inherits visibility from the license key when their PC activates.
    const sqnIds: string[] = role === "commander" && scope === "hq"
      ? squadrons.map(s => s.id)
      : [];
    const res = await createCommander({
      username: username.trim(),
      displayName: name.trim(),
      role,
      scope,
      squadronIds: sqnIds,
    });
    if (!res.ok || !res.record || !res.initialPassword) {
      const map: Record<string, string> = {
        missing_username: t("missingUsername"),
        reserved_username: t("reservedUsername"),
        duplicate_username: t("duplicateUsername"),
      };
      setCreateError(map[res.error ?? ""] ?? res.error ?? "Error");
      return;
    }
    refresh();
    setCreateOpen(false);
    setName(""); setUsername(""); setTier("squadron");
    setCredsShow({ username: res.record.username, password: res.initialPassword });
  }

  function del(id: string) {
    if (!confirm(t("confirmDeleteAccount"))) return;
    deleteCommander(id);
    refresh();
  }

  async function reset(id: string) {
    const rec = list.find(c => c.id === id);
    if (!rec) return;
    const newPwd = await resetCommanderPassword(id);
    if (!newPwd) return;
    setCredsShow({ username: rec.username, password: newPwd });
  }

  async function copyToClipboard(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* no-op */ }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2"><Users className="h-5 w-5" />{t("accessAccounts")}</h2>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-create"><Plus className="h-4 w-4 me-1" />{t("createAccount")}</Button>
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 border border-border rounded p-3">
        <Info className="h-4 w-4 mt-0.5 text-amber-400 shrink-0" />
        <span>{t("accessAccountsHint")}</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="text-start py-2 px-3">{t("name")}</th>
                  <th className="text-start py-2 px-3">{t("username")}</th>
                  <th className="text-start py-2 px-3">{t("accountRole")}</th>
                  <th className="text-start py-2 px-3">{t("scope")}</th>
                  <th className="text-end py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      {t("noAccountsYet")}
                    </td>
                  </tr>
                ) : list.map(u => (
                  <tr key={u.id} className="border-b border-border/60" data-testid={`row-cmdr-${u.id}`}>
                    <td className="py-2 px-3 font-medium">{u.displayName}</td>
                    <td className="py-2 px-3 font-mono text-xs">{u.username}</td>
                    <td className="py-2 px-3">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs ${u.role === "ops" ? "bg-amber-400/20 text-amber-300" : "bg-primary/20 text-primary"}`}>
                        {u.role === "ops" ? t("roleOps") : t("roleCommander")}
                      </span>
                    </td>
                    <td className="py-2 px-3">{u.scope ? t(scopeKeys[u.scope]) : "—"}</td>
                    <td className="py-2 px-3 text-end space-x-2 rtl:space-x-reverse whitespace-nowrap">
                      <Button size="sm" variant="outline" onClick={() => reset(u.id)} data-testid={`button-reset-${u.id}`}>
                        <KeyRound className="h-3 w-3 me-1" />{t("resetPassword")}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => del(u.id)} data-testid={`button-delete-${u.id}`}>
                        <Trash2 className="h-3 w-3 me-1" />{t("delete")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) setCreateError(null); setCreateOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t("createAccount")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="c-name">{t("name")}</Label>
              <Input id="c-name" value={name} onChange={e => setName(e.target.value)} data-testid="input-cname" />
            </div>
            <div>
              <Label htmlFor="c-user">{t("username")}</Label>
              <Input id="c-user" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} data-testid="input-cuser" />
            </div>
            <div>
              <Label>{t("accountRole")}</Label>
              <Select value={tier} onValueChange={(v: string) => setTier(v as Tier)}>
                <SelectTrigger data-testid="select-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hq">{t("scopeHQ")}</SelectItem>
                  <SelectItem value="base">{t("scopeBase")}</SelectItem>
                  <SelectItem value="wing">{t("scopeWing")}</SelectItem>
                  <SelectItem value="squadron">{t("scopeSquadron")}</SelectItem>
                  <SelectItem value="flight">{t("scopeFlight")}</SelectItem>
                  <SelectItem value="ops">{t("roleOps")}</SelectItem>
                </SelectContent>
              </Select>
              {tier === "hq" && (
                <p className="text-xs text-muted-foreground mt-1">{t("hqScopeHint")}</p>
              )}
              {tier === "ops" && (
                <p className="text-xs text-muted-foreground mt-1">{t("opsRoleHint")}</p>
              )}
            </div>
            {tier !== "hq" && tier !== "ops" && (
              <div className="text-xs text-amber-600 dark:text-amber-300 border border-amber-500/40 bg-amber-500/10 rounded p-2.5 leading-relaxed">
                {lang === "ar"
                  ? "ملاحظة: الأسراب التي يستطيع هذا القائد مراقبتها تُحدَّد فقط من \"إدارة الأجهزة\" عند إصدار مفتاح الترخيص للجهاز. لا يمكن إضافتها أو إزالتها من هنا."
                  : "Note: Which squadrons this commander can monitor is set only from PC Management when issuing the license key for that PC. It cannot be added or removed here."}
              </div>
            )}
            {createError && (
              <div className="text-sm text-destructive border border-destructive/40 bg-destructive/10 rounded p-2" data-testid="text-create-error">
                {createError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("cancel")}</Button>
            <Button onClick={create} data-testid="button-save-cmdr">{t("createAccount")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={credsShow !== null} onOpenChange={o => !o && setCredsShow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("accountCredentialsTitle")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t("commanderCredentialsHint")}</p>
          <div className="space-y-2 pt-2">
            <div>
              <Label className="text-xs">{t("username")}</Label>
              <div className="flex items-center gap-2">
                <div className="font-mono text-sm bg-muted p-2 rounded border flex-1" data-testid="text-new-username">{credsShow?.username}</div>
                <Button size="sm" variant="outline" onClick={() => credsShow && copyToClipboard(credsShow.username)}><Copy className="h-3 w-3" /></Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">{t("password")}</Label>
              <div className="flex items-center gap-2">
                <div className="font-mono text-lg bg-muted p-2 rounded border flex-1 text-center tracking-wider" data-testid="text-new-pwd">{credsShow?.password}</div>
                <Button size="sm" variant="outline" onClick={() => credsShow && copyToClipboard(credsShow.password)}><Copy className="h-3 w-3" /></Button>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground pt-2">{t("commanderCredentialsWarn")}</p>
          <DialogFooter>
            <Button onClick={() => setCredsShow(null)}>{t("done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
