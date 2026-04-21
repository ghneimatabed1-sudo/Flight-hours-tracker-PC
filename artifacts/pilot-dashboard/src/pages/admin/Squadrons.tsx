// Squadrons admin page.
//
// HISTORY (v1.0.42): Prior versions rendered this page as a read-only list
// driven by the empty `mockData.squadrons` array. The result: a fresh
// install had no squadrons and no way to create one, so the License Keys
// generator's squadron dropdown stayed empty and the entire
// "activate other PCs" flow was blocked. This version adds Create / Edit /
// Delete / Enable-Disable, backed by the local squadron store.

import { useState, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { pilots } from "@/lib/mockData";
import {
  useSquadrons,
  addSquadron,
  updateSquadron,
  deleteSquadron,
  setSquadronEnabled,
} from "@/lib/squadron-store";
import {
  useRegisteredPCs,
  getLatestSquadronFlightGroup,
  publishSquadronFlightGroup,
} from "@/lib/cross-pc";
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
  const list = useSquadrons();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPcId, setEditingPcId] = useState<string>("");
  const [editingPcName, setEditingPcName] = useState<string>("");
  const [draft, setDraft] = useState<DraftSquadron>(EMPTY_DRAFT);
  const [err, setErr] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Linked flight commander PCs for the squadron being edited. Populated
  // from the latest xpc.squadron.flight.group.set audit_log event when
  // the edit dialog opens, and re-published when the admin saves.
  const [linkedFlightIds, setLinkedFlightIds] = useState<string[]>([]);
  const [loadingGroup, setLoadingGroup] = useState(false);
  const registeredPcs = useRegisteredPCs();
  // Every flight commander PC that registered itself under the name of
  // the squadron being edited. The admin picks from this set when
  // choosing who is in the squadron's commanding group.
  const flightPcsForSquadron = useMemo(() => {
    if (!editingId) return [];
    return registeredPcs.data.filter(
      p => p.tier === "flight" && p.squadronName === draft.name,
    );
  }, [registeredPcs.data, editingId, draft.name]);

  function openCreate() {
    setEditingId(null);
    setEditingPcId("");
    setEditingPcName("");
    setDraft(EMPTY_DRAFT);
    setLinkedFlightIds([]);
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
    setLinkedFlightIds([]);
    // The squadron commander PC's canonical id in the cross-PC registry
    // is its squadron name (see registerLocalPC → App.tsx). Use that as
    // the group key for both loading and publishing.
    const pcId = s.name;
    setEditingPcId(pcId);
    setEditingPcName(s.name);
    setDialogOpen(true);
    setLoadingGroup(true);
    void (async () => {
      const group = await getLatestSquadronFlightGroup(pcId);
      if (group) setLinkedFlightIds(group.flightPcIds);
      setLoadingGroup(false);
    })();
  }

  function save() {
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
      updateSquadron(editingId, {
        name: trimmedName,
        nameAr: draft.nameAr.trim() || trimmedName,
        code: trimmedCode,
        base: trimmedBase,
        baseAr: draft.baseAr.trim() || trimmedBase,
        wing: trimmedWing,
        wingAr: draft.wingAr.trim() || trimmedWing,
      });
      // Re-publish the squadron's flight-commander group with the
      // admin's current selection. The squadron commander PC's
      // heartbeat will converge on this new list within ~30s; flight
      // commander PCs whose id appears here will auto-bind to the
      // squadron commander on their next sign-in.
      if (editingPcId) {
        void publishSquadronFlightGroup(
          editingPcId,
          editingPcName || trimmedName,
          linkedFlightIds,
        );
      }
    } else {
      const res = addSquadron({
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

  function handleDelete(id: string) {
    // Two-click confirm pattern — consistent with Commanders / LicenseKeys UIs.
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      return;
    }
    deleteSquadron(id);
    setPendingDeleteId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Plane className="h-5 w-5" />{t("squadrons")}
        </h2>
        <Button onClick={openCreate} data-testid="button-add-squadron">
          <Plus className="h-4 w-4 me-2" />
          {lang === "ar" ? "إضافة سرب" : "Add Squadron"}
        </Button>
      </div>

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
                              onClick={() => setSquadronEnabled(s.id, !s.enabled)}
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
                  placeholder="e.g. King Abdullah II AB"
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
            {/* Flight commander group editor — only meaningful when editing
                an existing squadron (for new squadrons no flight PCs can
                have registered under its name yet). */}
            {editingId && (
              <div className="space-y-2 rounded-md border border-teal-300/40 bg-teal-50/60 dark:bg-teal-950/20 p-3">
                <Label className="text-sm font-medium text-teal-900 dark:text-teal-200">
                  {lang === "ar"
                    ? "قادة الطيران في هذا السرب"
                    : "Flight commanders in this squadron"}
                </Label>
                {loadingGroup ? (
                  <p className="text-[11px] text-muted-foreground">
                    {lang === "ar" ? "جارٍ التحميل…" : "Loading current group…"}
                  </p>
                ) : flightPcsForSquadron.length === 0 ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    {lang === "ar"
                      ? "لا يوجد قادة طيران مسجلون لهذا السرب بعد."
                      : "No flight commander PCs are registered under this squadron yet."}
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pe-1">
                    {flightPcsForSquadron.map(pc => {
                      const checked = linkedFlightIds.includes(pc.id);
                      return (
                        <label
                          key={pc.id}
                          className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-teal-100/40 dark:hover:bg-teal-900/20 cursor-pointer"
                          data-testid={`row-sqn-flight-${pc.id}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setLinkedFlightIds(prev =>
                                v ? Array.from(new Set([...prev, pc.id]))
                                  : prev.filter(x => x !== pc.id),
                              );
                            }}
                            data-testid={`checkbox-sqn-flight-${pc.id}`}
                          />
                          <span className="text-sm flex-1">
                            {pc.deviceName || pc.squadronName}
                          </span>
                          {pc.online && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">●</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
                <p className="text-[10px] text-teal-900/70 dark:text-teal-200/70">
                  {lang === "ar"
                    ? `المرتبطون: ${linkedFlightIds.length}. سيسري التغيير خلال ٣٠ ثانية من الحفظ على جميع أجهزة السرب.`
                    : `Linked: ${linkedFlightIds.length}. Changes propagate to every PC in the squadron within ~30s of saving.`}
                </p>
              </div>
            )}
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
