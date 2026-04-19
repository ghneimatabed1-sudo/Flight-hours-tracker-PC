import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import {
  useAlerts,
  useCreateAlert,
  useUpdateAlert,
  useDeleteAlert,
  type AlertRow,
} from "@/lib/squadron-data";
import { useToast } from "@/hooks/use-toast";
import { Plus, Bell, Pencil, Trash2, Check, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataUnavailableBanner } from "@/components/DataUnavailableBanner";

// Squadron and Flight commanders can issue these — they go straight to
// pilots' phones (Alerts tab). Wing / Base / HQ scope commanders, and the
// existing currency-warning page at /dashboard/alerts, are unrelated.
// Note: super_admin is intentionally excluded — admins are routed to the
// AdminRoutes tree which doesn't expose this page; the system-wide alert
// channel for admins is the existing reminders / audit surfaces.
function canWriteAlerts(role?: string, scope?: string): boolean {
  if (role !== "commander") return false;
  return scope === "squadron" || scope === "flight";
}

function formatStamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function PilotAlertsPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const canWrite = canWriteAlerts(user?.role, user?.scope);
  const authorLabel =
    user?.scope === "flight"
      ? "Flight Cmdr"
      : user?.scope === "squadron"
        ? "Squadron Cmdr"
        : (user?.displayName ?? user?.role ?? "Commander");

  const alertsQ = useAlerts();
  const { data: list } = alertsQ;
  const create = useCreateAlert();
  const update = useUpdateAlert();
  const remove = useDeleteAlert();

  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<AlertRow | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await create.mutateAsync({ text: text.trim(), author: authorLabel });
      setText("");
      toast({ title: "Alert published" });
    } catch { /* surfaced by global error toast */ }
  };

  const startEdit = (a: AlertRow) => {
    setEditingId(a.id);
    setEditText(a.text);
  };

  const saveEdit = async (a: AlertRow) => {
    try {
      await update.mutateAsync({ ...a, text: editText });
      setEditingId(null);
      toast({ title: t("savedTitle") });
    } catch { /* surfaced */ }
  };

  const onWithdraw = async () => {
    if (!confirmDelete) return;
    try {
      await remove.mutateAsync(confirmDelete);
      setConfirmDelete(null);
      toast({ title: "Alert withdrawn" });
    } catch { /* surfaced */ }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold gold-grad flex items-center gap-2">
          <Bell className="h-5 w-5" /> Pilot Alerts
        </h1>
        <p className="text-sm text-muted-foreground">
          {canWrite
            ? "Short messages broadcast to your pilots' phones. They auto-hide on each phone after the pilot's chosen retention window."
            : "Alerts published by squadron and flight commanders."}
        </p>
      </div>

      <DataUnavailableBanner queries={[alertsQ]} testId="banner-alerts-unavailable" />

      <div className={canWrite ? "grid lg:grid-cols-3 gap-4" : "space-y-2"}>
        <div className={canWrite ? "lg:col-span-2 space-y-2" : "space-y-2"}>
          {list.length === 0 && (
            <Card data-testid="empty-pilot-alerts">
              <CardContent className="py-6 text-center text-xs text-muted-foreground">
                {alertsQ.isError ? "—" : t("no_records")}
              </CardContent>
            </Card>
          )}
          {list.map(a => (
            <Card key={a.id}>
              <CardContent className="p-4 flex gap-3 items-start">
                <Bell className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {a.author || "—"} · {formatStamp(a.postedAt)}
                  </div>
                  {editingId === a.id ? (
                    <textarea
                      rows={3}
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      data-testid={`input-edit-alert-${a.id}`}
                      className="w-full mt-1 px-2 py-1.5 rounded-md bg-input border border-border text-sm"
                      dir="auto"
                    />
                  ) : (
                    <div className="text-sm whitespace-pre-wrap" dir="auto">{a.text}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!canWrite ? null : editingId === a.id ? (
                    <>
                      <button onClick={() => saveEdit(a)} disabled={update.isPending} className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-400" title="Save" data-testid={`button-save-alert-${a.id}`}>
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-1.5 rounded hover:bg-secondary" title="Cancel" data-testid={`button-cancel-edit-alert-${a.id}`}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(a)} className="p-1.5 rounded hover:bg-secondary" title={t("edit")} data-testid={`button-edit-alert-${a.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setConfirmDelete(a)} className="p-1.5 rounded hover:bg-destructive/20 text-destructive" title="Withdraw" data-testid={`button-withdraw-alert-${a.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {canWrite && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">New Alert</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={add} className="space-y-3">
                <textarea
                  rows={5}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Enter alert text… (e.g. weather brief moved to 0530Z)"
                  data-testid="input-new-alert"
                  dir="auto"
                  className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm"
                />
                <div className="text-[11px] text-muted-foreground">
                  Will appear as: <span className="font-mono">{authorLabel}</span>
                </div>
                <Button
                  type="submit"
                  disabled={create.isPending || !text.trim()}
                  data-testid="button-publish-alert"
                  className="w-full inline-flex items-center justify-center gap-1.5"
                >
                  <Plus className="h-4 w-4" /> Publish
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Withdraw alert?"
          message={`This alert will be permanently withdrawn:\n\n"${confirmDelete.text}"`}
          confirmLabel="Withdraw"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={onWithdraw}
          busy={remove.isPending}
          danger
        />
      )}
    </div>
  );
}
