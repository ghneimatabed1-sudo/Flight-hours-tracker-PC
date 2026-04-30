import { useMemo, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import {
  useSquadronUsers,
  useCreateSquadronUser,
  useUpdateSquadronUser,
  useDeleteSquadronUser,
  type AppUserRole,
} from "@/lib/squadron-data";
import { useEnabledSquadrons } from "@/lib/squadron-store";
import type { Squadron } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, KeyRound } from "lucide-react";

const ROLE_OPTIONS: ReadonlyArray<{ value: AppUserRole; label: string }> = [
  { value: "deputy", label: "Deputy ops officer" },
  { value: "ops", label: "Ops officer" },
  { value: "commander_squadron", label: "Squadron commander" },
  { value: "commander_wing", label: "Wing commander" },
  { value: "commander_base", label: "Base commander" },
];

// Resolve a squadron id (or empty) into the wing_id / base_id pair the
// api-server's authorisation layer actually checks. We deliberately
// derive these from the squadron registry — never from a free-text
// input — so that wing- and base-tier commanders always carry the
// real authorisation IDs (matching `squadrons.wing_id` /
// `squadrons.base_id`) instead of display strings that would silently
// match nothing in the read-scope filter.
function scopeFromSquadron(
  squadrons: ReadonlyArray<Squadron>,
  squadronId: string,
): { squadronId: string | null; wingId: string | null; baseId: string | null } {
  if (!squadronId) return { squadronId: null, wingId: null, baseId: null };
  const sq = squadrons.find((s) => s.id === squadronId);
  if (!sq) return { squadronId, wingId: null, baseId: null };
  return {
    squadronId,
    wingId: sq.wingId ?? null,
    baseId: sq.baseId ?? null,
  };
}

function squadronLabel(s: Squadron): string {
  const wingTag = s.wing && s.wing !== "—" ? ` · ${s.wing}` : "";
  const baseTag = s.base ? ` · ${s.base}` : "";
  return `${s.code} · ${s.name}${wingTag}${baseTag}`;
}

export default function Users() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { data: list } = useSquadronUsers();
  const create = useCreateSquadronUser();
  const update = useUpdateSquadronUser();
  const remove = useDeleteSquadronUser();
  const squadrons = useEnabledSquadrons();

  const [u, setU] = useState("");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState<AppUserRole>("deputy");
  const [squadronId, setSquadronId] = useState<string>("");

  const squadronById = useMemo(() => {
    const m = new Map<string, Squadron>();
    for (const s of squadrons) m.set(s.id, s);
    return m;
  }, [squadrons]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!u) return;
    const scope = scopeFromSquadron(squadrons, squadronId);
    try {
      await create.mutateAsync({
        username: u,
        password: pw || `Tmp-${Date.now()}`,
        role,
        squadronId: scope.squadronId,
        wingId: scope.wingId,
        baseId: scope.baseId,
      });
      setU(""); setPw(""); setSquadronId("");
      toast({ title: t("userCreated") });
    } catch (e) {
      toast({ title: "Could not create user", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onResetPassword = async (id: string, username: string) => {
    const next = window.prompt(`New password for ${username} (min 8 chars):`, "");
    if (next == null) return;
    if (next.length < 8) {
      toast({ title: "Password too short", description: "Minimum 8 characters.", variant: "destructive" });
      return;
    }
    try {
      await update.mutateAsync({ id, password: next });
      toast({ title: "Password reset", description: username });
    } catch (err) {
      toast({ title: "Reset failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const onChangeRole = async (id: string, username: string, nextRole: AppUserRole) => {
    try {
      await update.mutateAsync({ id, role: nextRole });
      toast({ title: "Role updated", description: `${username} → ${nextRole.replace(/_/g, " ")}` });
    } catch (err) {
      toast({ title: "Role change failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const onReassignSquadron = async (id: string, username: string, nextSquadronId: string) => {
    const scope = scopeFromSquadron(squadrons, nextSquadronId);
    try {
      await update.mutateAsync({
        id,
        squadronId: scope.squadronId,
        wingId: scope.wingId,
        baseId: scope.baseId,
      });
      const human = nextSquadronId
        ? (squadronById.get(nextSquadronId)?.name ?? nextSquadronId)
        : "—";
      toast({ title: "Scope reassigned", description: `${username} → ${human}` });
    } catch (err) {
      toast({ title: "Reassign failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const onDelete = async (id: string, username: string) => {
    if (!window.confirm(`Delete user ${username}? This cannot be undone.`)) return;
    try {
      await remove.mutateAsync(id);
      toast({ title: "User deleted", description: username });
    } catch (err) {
      toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <div>
      <PageHead title={t("nav_users")} subtitle="Add ops/commander accounts · reset passwords · reassign scope · remove users" />
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 !p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Username</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Squadron</th>
                <th className="px-3 py-2 text-left">Wing / base</th>
                <th className="px-3 py-2 text-left">Created</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map(row => {
                const sq = row.squadronId ? squadronById.get(row.squadronId) : undefined;
                const wingDisp = sq?.wing && sq.wing !== "—" ? sq.wing : (row.wingId ?? "—");
                const baseDisp = sq?.base ? sq.base : (row.baseId ?? "—");
                const wingBaseLabel = `${wingDisp} / ${baseDisp}`;
                const editable = row.role !== "super_admin" && row.role !== "admin";
                return (
                  <tr key={row.id} className="border-t border-border row-hover">
                    <td className="px-3 py-2 font-mono">{row.username}</td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <select
                          value={row.role}
                          onChange={(e) => onChangeRole(row.id, row.username, e.target.value as AppUserRole)}
                          disabled={update.isPending}
                          className="px-2 py-1 rounded bg-input border border-border text-xs"
                          aria-label={`Role for ${row.username}`}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary border border-border uppercase">
                          {row.role.replace(/_/g, " ")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <select
                          value={row.squadronId ?? ""}
                          onChange={(e) => onReassignSquadron(row.id, row.username, e.target.value)}
                          disabled={update.isPending}
                          className="px-2 py-1 rounded bg-input border border-border text-xs max-w-[200px] truncate"
                          aria-label={`Squadron for ${row.username}`}
                        >
                          <option value="">— none —</option>
                          {squadrons.map((s) => (
                            <option key={s.id} value={s.id}>{squadronLabel(s)}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-muted-foreground font-mono">{sq?.name ?? row.squadronId ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{wingBaseLabel}</td>
                    <td className="px-3 py-2 font-mono">{row.created}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onResetPassword(row.id, row.username)}
                        disabled={update.isPending}
                        className="p-1.5 rounded hover:bg-secondary disabled:opacity-50"
                        title="Reset password"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => onDelete(row.id, row.username)}
                          disabled={remove.isPending}
                          className="p-1.5 rounded hover:bg-destructive/20 text-destructive disabled:opacity-50"
                          title="Delete user"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card>
          <form onSubmit={add} className="space-y-3">
            <div className="text-sm font-semibold">Add user</div>
            <label className="block text-xs">
              <span className="text-muted-foreground">Username</span>
              <input value={u} onChange={e=>setU(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm" />
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">Temporary password (min 8 chars)</span>
              <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Auto-generated if blank" className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm" />
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as AppUserRole)}
                className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">Squadron (auto-fills wing &amp; base)</span>
              <select
                value={squadronId}
                onChange={(e) => setSquadronId(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm"
              >
                <option value="">— none —</option>
                {squadrons.map((s) => (
                  <option key={s.id} value={s.id}>{squadronLabel(s)}</option>
                ))}
              </select>
            </label>
            {squadronId && (
              <p className="text-[11px] text-muted-foreground leading-snug">
                Wing / base inherited from this squadron — wing-tier and
                base-tier commanders share scope with every other squadron
                that has the same wing / base ID on the host PC.
              </p>
            )}
            <button
              disabled={create.isPending}
              className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Create user
            </button>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Only the host-PC <code>super_admin</code> and <code>admin</code> may
              create, edit, or delete user accounts. Every other role — ops,
              squadron / wing / base commanders — sees this page in read-only
              mode and the api-server enforces the same rule on the server side.
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
