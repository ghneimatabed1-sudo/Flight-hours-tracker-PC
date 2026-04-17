import { useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { useNotams, useCreateNotam, useUpdateNotam, useDeleteNotam, type NotamRow } from "@/lib/squadron-data";
import { useToast } from "@/hooks/use-toast";
import { Plus, Megaphone, Pencil, Trash2, Check, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataUnavailableBanner } from "@/components/DataUnavailableBanner";

export default function NotamsPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const notamsQ = useNotams();
  const { data: list } = notamsQ;
  const create = useCreateNotam();
  const update = useUpdateNotam();
  const remove = useDeleteNotam();
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<NotamRow | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await create.mutateAsync(text);
      setText("");
      toast({ title: t("notamPublished") });
    } catch { /* surfaced by global error toast */ }
  };

  const startEdit = (n: NotamRow) => {
    setEditingId(n.id);
    setEditText(n.text);
  };

  const saveEdit = async (n: NotamRow) => {
    try {
      await update.mutateAsync({ ...n, text: editText });
      setEditingId(null);
      toast({ title: t("savedTitle") });
    } catch { /* surfaced */ }
  };

  const onWithdraw = async () => {
    if (!confirmDelete) return;
    try {
      await remove.mutateAsync(confirmDelete);
      setConfirmDelete(null);
      toast({ title: t("notamWithdrawn") });
    } catch { /* surfaced */ }
  };

  return (
    <div>
      <PageHead title={t("nav_notams")} subtitle="Navigation notices by date" />
      <DataUnavailableBanner queries={[notamsQ]} testId="banner-notams-unavailable" />
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-2">
          {list.length === 0 && (
            <Card data-testid="empty-notams" className="text-center text-xs text-muted-foreground py-6">
              {notamsQ.isError ? "—" : t("no_records")}
            </Card>
          )}
          {list.map(n => (
            <Card key={n.id} className="flex gap-3 items-start">
              <Megaphone className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-muted-foreground font-mono">{n.id} · {n.date}</div>
                {editingId === n.id ? (
                  <textarea
                    rows={3}
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    data-testid={`input-edit-notam-${n.id}`}
                    className="w-full mt-1 px-2 py-1.5 rounded-md bg-input border border-border text-sm"
                  />
                ) : (
                  <div className="text-sm">{n.text}</div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {editingId === n.id ? (
                  <>
                    <button onClick={() => saveEdit(n)} disabled={update.isPending} className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-400" title="Save" data-testid={`button-save-notam-${n.id}`}>
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-1.5 rounded hover:bg-secondary" title="Cancel" data-testid={`button-cancel-edit-${n.id}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => startEdit(n)} className="p-1.5 rounded hover:bg-secondary" title={t("edit")} data-testid={`button-edit-notam-${n.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setConfirmDelete(n)} className="p-1.5 rounded hover:bg-destructive/20 text-destructive" title="Withdraw" data-testid={`button-withdraw-notam-${n.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
        <Card>
          <form onSubmit={add} className="space-y-3">
            <div className="text-sm font-semibold">New NOTAM</div>
            <textarea rows={5} value={text} onChange={e=>setText(e.target.value)} placeholder="Enter NOTAM text…"
              data-testid="input-new-notam"
              className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm" />
            <button data-testid="button-publish-notam" disabled={create.isPending} className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50"><Plus className="h-4 w-4" /> Publish</button>
          </form>
        </Card>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Withdraw ${confirmDelete.id}?`}
          message={`This NOTAM will be permanently withdrawn:\n\n"${confirmDelete.text}"`}
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
