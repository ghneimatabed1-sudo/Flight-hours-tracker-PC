import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { commanders as initial, squadrons } from "@/lib/mockData";
import type { CommanderScope, User } from "@/lib/types";
import { Users, Plus, Trash2, KeyRound } from "lucide-react";

const scopeKeys: Record<CommanderScope, "scopeSquadron" | "scopeFlight" | "scopeWing" | "scopeBase" | "scopeHQ"> = {
  squadron: "scopeSquadron",
  flight: "scopeFlight",
  wing: "scopeWing",
  base: "scopeBase",
  hq: "scopeHQ",
};

export default function Commanders() {
  const { t, lang } = useI18n();
  const [list, setList] = useState<User[]>(initial);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [scope, setScope] = useState<CommanderScope>("squadron");
  const [selSqns, setSelSqns] = useState<string[]>([]);
  const [resetForId, setResetForId] = useState<string | null>(null);
  const [newPwd, setNewPwd] = useState<string | null>(null);

  function toggleSqn(id: string) {
    setSelSqns(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  function create() {
    if (!name || !username || selSqns.length === 0) return;
    const u: User = {
      id: "u-" + Math.random().toString(36).slice(2, 7),
      username: username.toLowerCase().trim(),
      displayName: name,
      role: "commander",
      scope,
      squadronIds: selSqns,
    };
    setList(l => [...l, u]);
    setOpen(false);
    setName(""); setUsername(""); setScope("squadron"); setSelSqns([]);
  }

  function del(id: string) {
    setList(l => l.filter(u => u.id !== id));
  }

  function reset(id: string) {
    setResetForId(id);
    setNewPwd(Math.random().toString(36).slice(2, 12).toUpperCase());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2"><Users className="h-5 w-5" />{t("commanders")}</h2>
        <Button onClick={() => setOpen(true)} data-testid="button-create"><Plus className="h-4 w-4 me-1" />{t("createCommander")}</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="text-start py-2 px-3">{t("name")}</th>
                  <th className="text-start py-2 px-3">{t("username")}</th>
                  <th className="text-start py-2 px-3">{t("scope")}</th>
                  <th className="text-start py-2 px-3">{t("authorizedSquadrons")}</th>
                  <th className="text-end py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(u => (
                  <tr key={u.id} className="border-b border-border/60" data-testid={`row-cmdr-${u.id}`}>
                    <td className="py-2 px-3 font-medium">{u.displayName}</td>
                    <td className="py-2 px-3 font-mono text-xs">{u.username}</td>
                    <td className="py-2 px-3">{u.scope ? t(scopeKeys[u.scope]) : "—"}</td>
                    <td className="py-2 px-3 text-xs">
                      {(u.squadronIds ?? []).map(id => {
                        const s = squadrons.find(x => x.id === id);
                        return s ? <span key={id} className="inline-block me-1 mb-1 rounded bg-secondary px-2 py-0.5">{s.code}</span> : null;
                      })}
                    </td>
                    <td className="py-2 px-3 text-end space-x-2 rtl:space-x-reverse whitespace-nowrap">
                      <Button size="sm" variant="outline" onClick={() => u.id && reset(u.id)} data-testid={`button-reset-${u.id}`}>
                        <KeyRound className="h-3 w-3 me-1" />{t("resetPassword")}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => u.id && del(u.id)} data-testid={`button-delete-${u.id}`}>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t("createCommander")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="c-name">{t("name")}</Label>
              <Input id="c-name" value={name} onChange={e => setName(e.target.value)} data-testid="input-cname" />
            </div>
            <div>
              <Label htmlFor="c-user">{t("username")}</Label>
              <Input id="c-user" value={username} onChange={e => setUsername(e.target.value)} data-testid="input-cuser" />
            </div>
            <div>
              <Label>{t("scope")}</Label>
              <Select value={scope} onValueChange={(v: string) => setScope(v as CommanderScope)}>
                <SelectTrigger data-testid="select-scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hq">{t("scopeHQ")}</SelectItem>
                  <SelectItem value="base">{t("scopeBase")}</SelectItem>
                  <SelectItem value="wing">{t("scopeWing")}</SelectItem>
                  <SelectItem value="squadron">{t("scopeSquadron")}</SelectItem>
                  <SelectItem value="flight">{t("scopeFlight")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("authorizedSquadrons")}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1 max-h-48 overflow-y-auto border rounded p-2">
                {squadrons.map(s => (
                  <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={selSqns.includes(s.id)} onCheckedChange={() => toggleSqn(s.id)} data-testid={`check-sqn-${s.id}`} />
                    <span>{lang === "ar" ? s.nameAr : s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button onClick={create} data-testid="button-save-cmdr">{t("createCommander")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetForId !== null} onOpenChange={o => !o && setResetForId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("resetPassword")}</DialogTitle></DialogHeader>
          <div className="font-mono text-lg bg-muted p-3 rounded border text-center" data-testid="text-newpwd">{newPwd}</div>
          <p className="text-xs text-muted-foreground">{t("newKeyHelp")}</p>
          <DialogFooter>
            <Button onClick={() => setResetForId(null)}>{t("done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
