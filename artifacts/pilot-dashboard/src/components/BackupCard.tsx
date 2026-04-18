import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Upload, Archive, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  exportBackup,
  decodeBackup,
  applyBackup,
  suggestBackupFilename,
  type BackupPayload,
} from "@/lib/backup";

// Minimal Backup & Restore card. Lives inside the Security admin page so
// the super-admin always finds it next to the other "recovery" tools. The
// UI is intentionally tiny — two buttons, two password prompts — so the
// ops officer can explain it to the squadron in one sentence: "Set a
// password, save the file, keep it safe".

type Phase =
  | { kind: "idle" }
  | { kind: "exporting" }
  | { kind: "exported"; filename: string }
  | { kind: "error"; message: string }
  | { kind: "picked"; file: File }
  | { kind: "decoding" }
  | { kind: "decoded"; payload: BackupPayload; file: File }
  | { kind: "applying" }
  | { kind: "applied" };

export function BackupCard() {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [exportPwd, setExportPwd] = useState("");
  const [exportPwd2, setExportPwd2] = useState("");
  const [restorePwd, setRestorePwd] = useState("");

  const resetExport = () => {
    setExportPwd("");
    setExportPwd2("");
  };

  const doExport = async () => {
    if (exportPwd.length < 6) {
      setPhase({ kind: "error", message: t("backup_pwd_too_short") });
      return;
    }
    if (exportPwd !== exportPwd2) {
      setPhase({ kind: "error", message: t("backup_pwd_mismatch") });
      return;
    }
    setPhase({ kind: "exporting" });
    try {
      const text = await exportBackup(exportPwd);
      const filename = suggestBackupFilename();
      const blob = new Blob([text], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      resetExport();
      setPhase({ kind: "exported", filename });
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message });
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setRestorePwd("");
    setPhase({ kind: "picked", file: f });
    // Allow re-selecting the same file a second time if the user cancels.
    e.target.value = "";
  };

  const doDecode = async () => {
    if (phase.kind !== "picked") return;
    if (!restorePwd) {
      setPhase({ kind: "error", message: t("backup_pwd_required") });
      return;
    }
    setPhase({ kind: "decoding" });
    try {
      const text = await phase.file.text();
      const payload = await decodeBackup(text, restorePwd);
      setPhase({ kind: "decoded", payload, file: phase.file });
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message });
    }
  };

  const doApply = async () => {
    if (phase.kind !== "decoded") return;
    setPhase({ kind: "applying" });
    try {
      applyBackup(phase.payload);
      setPhase({ kind: "applied" });
      // Give the toast a moment to read, then reload so every page re-reads
      // from the freshly populated localStorage + in-memory stores.
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message });
    }
  };

  const fmtBytes = (n: number) =>
    n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

  return (
    <Card data-testid="card-backup">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Archive className="h-4 w-4" /> {t("backup_title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("backup_blurb")}
        </p>

        {/* ── Export ─────────────────────────── */}
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
            <Download className="h-3.5 w-3.5" /> {t("backup_export_title")}
          </div>
          <p className="text-[11px] text-muted-foreground">{t("backup_export_help")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              type="password"
              value={exportPwd}
              onChange={e => setExportPwd(e.target.value)}
              placeholder={t("backup_pwd_placeholder")}
              data-testid="input-backup-password"
              autoComplete="new-password"
            />
            <Input
              type="password"
              value={exportPwd2}
              onChange={e => setExportPwd2(e.target.value)}
              placeholder={t("backup_pwd_confirm_placeholder")}
              data-testid="input-backup-password-confirm"
              autoComplete="new-password"
            />
          </div>
          <Button
            onClick={doExport}
            disabled={phase.kind === "exporting" || !exportPwd || !exportPwd2}
            size="sm"
            data-testid="button-export-backup"
          >
            {phase.kind === "exporting" ? (
              <><Loader2 className="h-3.5 w-3.5 me-2 animate-spin" />{t("backup_exporting")}</>
            ) : (
              <><Download className="h-3.5 w-3.5 me-2" />{t("backup_export_btn")}</>
            )}
          </Button>
        </div>

        {/* ── Restore ────────────────────────── */}
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
            <Upload className="h-3.5 w-3.5" /> {t("backup_restore_title")}
          </div>
          <p className="text-[11px] text-muted-foreground">{t("backup_restore_help")}</p>

          <input
            ref={fileRef}
            type="file"
            accept=".rjafbackup,application/octet-stream,text/plain"
            onChange={onPickFile}
            className="hidden"
            data-testid="input-backup-file"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              data-testid="button-pick-backup-file"
            >
              <Upload className="h-3.5 w-3.5 me-2" />{t("backup_pick_file")}
            </Button>
            {(phase.kind === "picked" || phase.kind === "decoded") && (
              <span className="text-[11px] text-muted-foreground font-mono" data-testid="text-picked-backup-file">
                {phase.file.name} · {fmtBytes(phase.file.size)}
              </span>
            )}
          </div>

          {phase.kind === "picked" && (
            <div className="space-y-2 pt-2 border-t border-border/60">
              <Input
                type="password"
                value={restorePwd}
                onChange={e => setRestorePwd(e.target.value)}
                placeholder={t("backup_pwd_placeholder")}
                data-testid="input-restore-password"
                autoComplete="current-password"
              />
              <Button size="sm" onClick={doDecode} disabled={!restorePwd} data-testid="button-decode-backup">
                {t("backup_verify")}
              </Button>
            </div>
          )}

          {phase.kind === "decoding" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("backup_decoding")}
            </div>
          )}

          {phase.kind === "decoded" && (
            <div className="space-y-2 pt-2 border-t border-border/60 text-xs">
              <div className="rounded-md bg-muted/60 p-2 font-mono leading-relaxed" data-testid="text-backup-summary">
                <div>{t("backup_created")}: {new Date(phase.payload.createdAt).toLocaleString()}</div>
                <div>{t("backup_squadron")}: {phase.payload.squadronId || "—"}</div>
                <div>{t("backup_device")}: {phase.payload.deviceName || "—"}</div>
                <div>
                  {t("backup_contents")}: {phase.payload.mock.pilots.length} pilots, {phase.payload.mock.sorties.length} sorties,{" "}
                  {Object.keys(phase.payload.storage).length} config keys
                </div>
              </div>
              <p className="text-[11px] text-amber-500 flex items-start gap-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{t("backup_apply_warn")}</span>
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={doApply} data-testid="button-apply-backup">
                  {t("backup_apply_btn")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPhase({ kind: "idle" })} data-testid="button-cancel-backup">
                  {t("cancel")}
                </Button>
              </div>
            </div>
          )}

          {phase.kind === "applying" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("backup_applying")}
            </div>
          )}

          {phase.kind === "applied" && (
            <div className="flex items-center gap-2 text-xs text-emerald-500" data-testid="text-backup-applied">
              <CheckCircle2 className="h-3.5 w-3.5" /> {t("backup_applied")}
            </div>
          )}
        </div>

        {phase.kind === "exported" && (
          <div className="flex items-center gap-2 text-xs text-emerald-500" data-testid="text-backup-exported">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("backup_exported")}: <span className="font-mono">{phase.filename}</span>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="flex items-start gap-2 text-xs text-destructive" data-testid="text-backup-error">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{phase.message}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
