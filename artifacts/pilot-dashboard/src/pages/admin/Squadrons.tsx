// Squadrons admin page.
//
// HISTORY (v1.0.42): Prior versions rendered this page as a read-only list
// driven by the empty `mockData.squadrons` array. The result: a fresh
// install had no squadrons and no way to create one, so the License Keys
// generator's squadron dropdown stayed empty and the entire
// "activate other PCs" flow was blocked. This version adds Create / Edit /
// Delete / Enable-Disable, backed by the local squadron store.

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { pilots } from "@/lib/mockData";
import {
  useSquadrons,
  addSquadron,
  updateSquadron,
  deleteSquadron,
  setSquadronEnabled,
  refreshSquadronsFromDb,
} from "@/lib/squadron-store";
import { isLanSessionLoginEnabled } from "@/lib/internal-migration";
import type { Squadron } from "@/lib/types";
import { Plane, Plus, Pencil, Trash2 } from "lucide-react";

type DraftSquadron = {
  name: string;
  nameAr: string;
  code: string;
  base: string;
  baseAr: string;
  wing: string;
  wingAr: string;
};

const EMPTY_DRAFT: DraftSquadron = {
  name: "", nameAr: "", code: "", base: "", baseAr: "", wing: "", wingAr: "",
};

export default function Squadrons() {
  const { t, lang } = useI18n();
  const lanMode = isLanSessionLoginEnabled();
  const list = useSquadrons();
  useEffect(() => {
    void refreshSquadronsFromDb().catch(() => {
      // Fallback to local cache when offline or lacking DB access.
    });
  }, []);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftSquadron>(EMPTY_DRAFT);
  const [err, setErr] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  function openCreate() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setErr(null);
    setDialogOpen(true);
  }

  function openEdit(s: Squadron) {
    setEditingId(s.id);
    setDraft({
      name: s.name, nameAr: s.nameAr, code: s.code,
      base: s.base, baseAr: s.baseAr, wing: s.wing, wingAr: s.wingAr,
    });
    setErr(null);
    setDialogOpen(true);
  }

  async function save() {
    setErr(null);
    const trimmedName = draft.name.trim();
    const trimmedCode = draft.code.trim().toUpperCase();
    const trimmedBase = draft.base.trim();
    const trimmedWing = draft.wing.trim();
    if (!trimmedName || !trimmedCode || !trimmedBase || !trimmedWing) {
      setErr(lang === "ar" ? "أكمل جميع الحقول المطلوبة." : "Fill all required fields.");
      return;
    }
    if (editingId) {
      // Uniqueness guard when editing: only conflict if another row owns the code.
      if (list.some(s => s.id !== editingId && s.code.toUpperCase() === trimmedCode)) {
        setErr(lang === "ar" ? "رمز السرب مستخدم مسبقاً." : "Squadron code already exists.");
        return;
      }
      const ok = await updateSquadron(editingId, {
        name: trimmedName,
        nameAr: draft.nameAr.trim() || trimmedName,
        code: trimmedCode,
        base: trimmedBase,
        baseAr: draft.baseAr.trim() || trimmedBase,
        wing: trimmedWing,
        wingAr: draft.wingAr.trim() || trimmedWing,
      });
      if (!ok) {
        setErr(lang === "ar" ? "تعذّر تحديث السرب." : "Could not update squadron.");
        return;
      }
    } else {
      const res = await addSquadron({
        name: trimmedName,
        nameAr: draft.nameAr.trim(),
        code: trimmedCode,
        base: trimmedBase,
        baseAr: draft.baseAr.trim(),
        wing: trimmedWing,
        wingAr: draft.wingAr.trim(),
      });
      if (!res.ok) {
        if (res.error === "duplicate_code") {
          setErr(lang === "ar" ? "رمز السرب مستخدم مسبقاً." : "Squadron code already exists.");
        } else {
          setErr(lang === "ar" ? "تعذّر الحفظ." : "Could not save squadron.");
        }
        return;
      }
    }
    setDialogOpen(false);
  }

  async function handleDelete(id: string) {
    // Two-click confirm pattern — consistent with Commanders / LicenseKeys UIs.
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      return;
    }
    const ok = await deleteSquadron(id);
    if (!ok) {
      setErr(lang === "ar" ? "تعذّر حذف السرب." : "Could not delete squadron.");
      return;
    }
    setPendingDeleteId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Plane className="h-5 w-5" />{t("squadrons")}
        </h2>
        <div className="flex items-center gap-2">
          <Button onClick={openCreate} data-testid="button-add-squadron">
            <Plus className="h-4 w-4 me-2" />
            {lang === "ar" ? "إضافة سرب" : "Add Squadron"}
          </Button>
        </div>
      </div>

      {lanMode && (
        <Card>
          <CardContent className="py-3 text-xs text-sky-100 border border-sky-700/40 bg-sky-900/20 rounded-md">
            {t("squadronsLanModeNote")}
          </CardContent>
        </Card>
      )}

      {list.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {lang === "ar"
              ? "لا توجد أسراب بعد. اضغط \"إضافة سرب\" لإنشاء أول سرب."
              : "No squadrons yet. Click \"Add Squadron\" to create the first one."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                    <th className="text-start py-2 px-3">{t("squadron")}</th>
                    <th className="text-start py-2 px-3">{t("base")}</th>
                    <th className="text-start py-2 px-3">{t("wing")}</th>
                    <th className="text-end py-2 px-3">{t("pilotCount")}</th>
                    <th className="text-start py-2 px-3">{t("status")}</th>
                    <th className="text-end py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(s => {
                    const count = pilots.filter(p => p.squadronId === s.id).length;
                    return (
                      <tr key={s.id} className="border-b border-border/60" data-testid={`row-sqn-${s.id}`}>
                        <td className="py-2 px-3 font-medium">
                          {lang === "ar" ? s.nameAr : s.name}
                          <span className="text-muted-foreground text-xs"> ({s.code})</span>
                        </td>
                        <td className="py-2 px-3">{lang === "ar" ? s.baseAr : s.base}</td>
                        <td className="py-2 px-3">{lang === "ar" ? s.wingAr : s.wing}</td>
                        <td className="py-2 px-3 text-end tabular-nums">{count}</td>
                        <td className="py-2 px-3">
                          <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${s.enabled
                            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                            : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                            {s.enabled ? t("enabled") : t("disabled")}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-end">
                          <div className="inline-flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                const ok = await setSquadronEnabled(s.id, !s.enabled);
                                if (!ok) {
                                  setErr(lang === "ar" ? "تعذّر تحديث حالة السرب." : "Could not update squadron status.");
                                }
                              }}
                              data-testid={`button-toggle-${s.id}`}
                            >
                              {s.enabled ? t("disable") : t("enable")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEdit(s)}
                              data-testid={`button-edit-${s.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant={pendingDeleteId === s.id ? "destructive" : "outline"}
                              onClick={() => handleDelete(s.id)}
                              data-testid={`button-delete-${s.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {pendingDeleteId === s.id && (
                                <span className="ms-1 text-xs">
                                  {lang === "ar" ? "تأكيد" : "Confirm"}
                                </span>
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? (lang === "ar" ? "تعديل السرب" : "Edit Squadron")
                : (lang === "ar" ? "إضافة سرب جديد" : "Add New Squadron")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{lang === "ar" ? "اسم السرب (EN)" : "Squadron name (EN)"}</Label>
                <Input
                  value={draft.name}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. 7 Squadron"
                  data-testid="input-sqn-name"
                />
              </div>
              <div>
                <Label>{lang === "ar" ? "اسم السرب (AR)" : "Squadron name (AR)"}</Label>
                <Input
                  value={draft.nameAr}
                  onChange={e => setDraft(d => ({ ...d, nameAr: e.target.value }))}
                  placeholder="مثال: السرب ٧"
                  dir="rtl"
                  data-testid="input-sqn-name-ar"
                />
              </div>
            </div>
            <div>
              <Label>{lang === "ar" ? "الرمز" : "Code"}</Label>
              <Input
                value={draft.code}
                onChange={e => setDraft(d => ({ ...d, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. 7SQN"
                maxLength={12}
                data-testid="input-sqn-code"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{lang === "ar" ? "القاعدة (EN)" : "Base (EN)"}</Label>
                <Input
                  value={draft.base}
                  onChange={e => setDraft(d => ({ ...d, base: e.target.value }))}
                  placeholder="e.g. Main Air Base"
                  data-testid="input-sqn-base"
                />
              </div>
              <div>
                <Label>{lang === "ar" ? "القاعدة (AR)" : "Base (AR)"}</Label>
                <Input
                  value={draft.baseAr}
                  onChange={e => setDraft(d => ({ ...d, baseAr: e.target.value }))}
                  dir="rtl"
                  data-testid="input-sqn-base-ar"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{lang === "ar" ? "الجناح (EN)" : "Wing (EN)"}</Label>
                <Input
                  value={draft.wing}
                  onChange={e => setDraft(d => ({ ...d, wing: e.target.value }))}
                  placeholder="e.g. Rotary Wing"
                  data-testid="input-sqn-wing"
                />
              </div>
              <div>
                <Label>{lang === "ar" ? "الجناح (AR)" : "Wing (AR)"}</Label>
                <Input
                  value={draft.wingAr}
                  onChange={e => setDraft(d => ({ ...d, wingAr: e.target.value }))}
                  dir="rtl"
                  data-testid="input-sqn-wing-ar"
                />
              </div>
            </div>
            {err && <div className="text-sm text-destructive">{err}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {lang === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={save} data-testid="button-save-squadron">
              {lang === "ar" ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
