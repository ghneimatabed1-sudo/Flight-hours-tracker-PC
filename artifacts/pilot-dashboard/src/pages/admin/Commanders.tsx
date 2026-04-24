import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSquadrons } from "@/lib/squadron-store";
import {
  listCommanders,
  createCommander,
  deleteCommander,
  resetCommanderPassword,
  type CommanderRecord,
  type AccountRole,
} from "@/lib/commander-store";
import type { CommanderScope } from "@/lib/types";
import {
  useRegisteredPCs,
  getAdminFlightBindingFor,
  setAdminFlightBindingFor,
} from "@/lib/cross-pc";
import { Users, Plus, Trash2, KeyRound, Copy, Info, Link2 } from "lucide-react";

const scopeKeys: Record<CommanderScope, "scopeSquadron" | "scopeFlight" | "scopeWing" | "scopeBase" | "scopeHq"> = {
  squadron: "scopeSquadron",
  flight: "scopeFlight",
  wing: "scopeWing",
  base: "scopeBase",
  hq: "scopeHq",
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
  const squadrons = useSquadrons();
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
                    <td className="py-2 px-3">
                      {u.scope ? t(scopeKeys[u.scope]) : "—"}
                      {u.role === "commander" && u.scope === "flight" && (
                        <FlightBindingPicker username={u.username} />
                      )}
                    </td>
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
                  <SelectItem value="hq">{t("scopeHq")}</SelectItem>
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

// Flight↔Squadron commander binding picker. April 2026: moved here from the
// per-PC FlightBindingGate so HQ can pre-bind any flight commander to a
// Squadron PC. The chosen pcId is stored in a localStorage map keyed by
// commander username; on that commander's next sign-in the gate auto-
// applies the override and skips the manual picker. The flight commander
// can still override locally after binding (e.g. mid-deployment).
//
// v1.1.23 (Apr 2026): Picker now binds to the **Squadron Ops PC** (the
// canonical PC the squadron commander operates from). The squadron
// commander identity itself auto-resolves from that ops PC's registry
// row — operators no longer pick a person, they pick the workstation,
// and HQ sees who is currently sitting at it (deviceName label). This
// stays in sync automatically: when a different commander signs into
// the ops PC and updates the device label, the resolved name shown
// here refreshes on the next registry poll without anyone re-binding.
function FlightBindingPicker({ username }: { username: string }) {
  const reg = useRegisteredPCs();
  const [current, setCurrent] = useState(() => getAdminFlightBindingFor(username));
  const squadronPCs = reg.data
    .filter(p => p.tier === "squadron")
    .sort((a, b) => a.squadronName.localeCompare(b.squadronName));

  // Live look-up of the currently-bound ops PC so the displayed
  // squadron commander label (deviceName) reflects whoever is sitting
  // at that workstation right now — not the cached label captured at
  // bind time. Falls back to the cached pcName if the ops PC is offline
  // or has been removed from the registry.
  const boundLive = current
    ? squadronPCs.find(p => p.id === current.pcId) ?? null
    : null;
  const liveCommanderLabel =
    boundLive?.deviceName?.trim() || boundLive?.squadronName || current?.pcName || "";

  // Radix Select v2 forbids empty SelectItem values, so the "unbound"
  // sentinel is a non-empty string and we map it back to null on apply.
  const UNBOUND_SENTINEL = "__unbound__";
  const apply = (pcId: string) => {
    if (!pcId || pcId === UNBOUND_SENTINEL) {
      setAdminFlightBindingFor(username, null);
      setCurrent(null);
      return;
    }
    const target = squadronPCs.find(p => p.id === pcId);
    if (!target) return;
    const next = { pcId: target.id, pcName: target.squadronName };
    setAdminFlightBindingFor(username, next);
    setCurrent(next);
  };

  return (
    <div className="mt-1.5 flex flex-col gap-1 text-[11px]" data-testid={`fbinding-${username}`}>
      <div className="flex items-center gap-1.5">
        <Link2 className="h-3 w-3 text-muted-foreground" />
        <Select value={current?.pcId ?? UNBOUND_SENTINEL} onValueChange={apply}>
          <SelectTrigger className="h-7 text-xs w-72" data-testid={`select-fbinding-${username}`}>
            <SelectValue placeholder="Bind to Squadron Ops PC…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNBOUND_SENTINEL}>— Unbound —</SelectItem>
            {squadronPCs.map(p => {
              // Each row shows the squadron AND the current commander
              // label sitting at that ops PC, so HQ knows exactly who
              // they're attaching the flight commander to.
              const cdr = p.deviceName?.trim();
              return (
                <SelectItem key={p.id} value={p.id}>
                  {p.squadronName}
                  {cdr ? ` · Sqn Cdr: ${cdr}` : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      {current && (
        <div className="pl-4.5 text-muted-foreground" data-testid={`fbinding-resolved-${username}`}>
          → Ops PC: <span className="text-foreground">{current.pcName}</span>
          {liveCommanderLabel && liveCommanderLabel !== current.pcName ? (
            <> · Sqn Cdr: <span className="text-foreground">{liveCommanderLabel}</span></>
          ) : null}
        </div>
      )}
    </div>
  );
}
