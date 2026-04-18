import { useState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth, type PcRoleLock } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { squadrons } from "@/lib/mockData";
import type { LicenseKey, LicenseDuration } from "@/lib/types";
import { addDuration, addDays } from "@/lib/types";
import { listLicenseKeys, registerLicenseKey, updateLicenseKey, removeLicenseKey } from "@/lib/license-registry";
import { registerLicenseRemote, provisionCommanderRemote, storeSupabaseCreds, clearSupabaseCreds, supabaseConfigured } from "@/lib/supabase";
import { createCommander, deleteCommander, listCommanders, resetCommanderPassword, generateInitialPassword, type AccountRole, type CommanderRecord } from "@/lib/commander-store";
import type { CommanderScope } from "@/lib/types";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { KeyRound, Copy, Check, User as UserIcon, Wrench, Lock, Shuffle } from "lucide-react";

function genKey(code: string): string {
  const rnd = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36).toUpperCase()).join("");
  return `EE-${code}-${rnd.slice(0, 4)}-${rnd.slice(4, 8)}-${rnd.slice(8, 12)}-${rnd.slice(12, 16)}`;
}

const DURATIONS: LicenseDuration[] = ["1d", "2d", "1m", "3m", "6m", "1y", "3y", "never"];
// Sentinel value used by the duration <Select> to mean "use the custom days
// input below". Kept outside the LicenseDuration type so it never leaks into
// addDuration() or the persisted record.
const CUSTOM_DURATION = "__custom__";

export default function LicenseKeys() {
  const { t, lang } = useI18n();
  const auth = useAuth();
  const [keys, setKeys] = useState<LicenseKey[]>(() => listLicenseKeys());

  // Setup-dialog roles. We keep five UI choices but collapse the three
  // commander tiers into the same underlying PcRoleLock value ("commander"),
  // recording the tier separately in localStorage so the dashboard can render
  // tier-aware copy without churning the auth type.
  type SetupRoleUI =
    | "ops"
    | "flight_commander"
    | "squadron_commander"
    | "hq_commander"
    | "super_admin";
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupRole, setSetupRole] = useState<SetupRoleUI>("ops");
  const [setupSqnName, setSetupSqnName] = useState("");
  const [setupSqnNumber, setSetupSqnNumber] = useState("");
  const [setupSqnBase, setSetupSqnBase] = useState("");
  const [setupCommanderName, setSetupCommanderName] = useState("");
  const [setupDeviceName, setSetupDeviceName] = useState("");
  const [setupOpsUsername, setSetupOpsUsername] = useState("");
  const [setupAccountPassword, setSetupAccountPassword] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupErr, setSetupErr] = useState<string | null>(null);
  const [setupOk, setSetupOk] = useState<string | null>(null);
  const [setupCredentials, setSetupCredentials] = useState<{ username: string; password: string; roleLabel: string } | null>(null);
  const [credCopied, setCredCopied] = useState(false);
  // Duration this PC's setup will be valid for. Mirrors the Generate-Key
  // flow but is applied locally: for Ops PCs it's baked into the auto-minted
  // license, for commander/HQ PCs it's stored as `rjaf.localExpiresAt` and
  // enforced on every launch (the app refuses to start past that date).
  const [setupDuration, setSetupDuration] = useState<LicenseDuration | typeof CUSTOM_DURATION>("1y");
  const [setupCustomDays, setSetupCustomDays] = useState<string>("30");
  function resolveSetupExpiry(issuedAt: string): { expiresAt: string | null; valid: boolean } {
    if (setupDuration === CUSTOM_DURATION) {
      const n = Number(setupCustomDays);
      if (!Number.isFinite(n) || n <= 0) return { expiresAt: null, valid: false };
      return { expiresAt: addDays(issuedAt, n), valid: true };
    }
    return { expiresAt: addDuration(issuedAt, setupDuration), valid: true };
  }
  // "Change this device" — clears the local role lock, license binding,
  // squadron, fingerprint, and local user accounts so the Super Admin can
  // re-set this PC up for a different commander, role, or squadron without
  // reinstalling the app. The cloud is untouched (no data loss).
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeBusy, setChangeBusy] = useState(false);
  function performChangeDevice() {
    setChangeBusy(true);
    try {
      // License + role binding
      localStorage.removeItem("rjaf.licenseKey");
      localStorage.removeItem("rjaf.assignedRole");
      localStorage.removeItem("rjaf.authorizedSquadronIds");
      localStorage.removeItem("rjaf.localExpiresAt");
      localStorage.removeItem("rjaf.pcRoleLock");
      localStorage.removeItem("rjaf.squadron");
      localStorage.removeItem("rjaf.squadronId");
      localStorage.removeItem("rjaf.pcDeviceName");
      // Local user accounts on this PC
      localStorage.removeItem("rjaf.commanders");
      localStorage.removeItem("rjaf.commanderPwHashes");
      localStorage.removeItem("rjaf.opsAccount");
      localStorage.removeItem("rjaf.supabaseCreds");
    } finally {
      setChangeBusy(false);
      setChangeOpen(false);
      // Force a clean restart so AuthProvider reads the wiped state and
      // the operator lands back at the Sign-In / Activation screen.
      setTimeout(() => { window.location.reload(); }, 200);
    }
  }

  // Local accounts list (commanders + ops) shown inside the Setup dialog so
  // the Super Admin can delete a stale entry that's blocking re-creation,
  // or reset the password on a forgotten account — without leaving the page.
  const [localAccounts, setLocalAccounts] = useState<CommanderRecord[]>([]);
  const [resetCreds, setResetCreds] = useState<{ username: string; password: string } | null>(null);
  // Inline two-click delete confirmation. Tracks which row id is currently
  // armed for deletion. We deliberately do NOT use window.confirm() inside
  // the Setup dialog: the native popup steals focus from Radix's focus
  // trap, and when it closes the Delete button has already been unmounted,
  // leaving the dialog inert — user reported all inputs became unclickable.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Ref to the username input — after deleting/resetting an account we
  // explicitly move keyboard focus here so the dialog can never end up in
  // a state where every input feels "frozen". (Native <details> + Radix
  // Dialog focus traps + button unmounts conspired to break focus
  // recovery in earlier versions.)
  const usernameInputRef = useRef<HTMLInputElement | null>(null);
  function refreshLocalAccounts(): void {
    try { setLocalAccounts(listCommanders()); } catch { setLocalAccounts([]); }
  }
  function returnFocusToUsername(): void {
    // Wait for React to commit the DOM change before focusing — otherwise
    // we'd be focusing the OLD button that's about to unmount.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        usernameInputRef.current?.focus();
      });
    });
  }
  useEffect(() => {
    if (setupOpen) {
      refreshLocalAccounts();
    } else {
      setResetCreds(null);
      setPendingDeleteId(null);
    }
  }, [setupOpen]);

  function handleDeleteLocalAccount(rec: CommanderRecord) {
    // First click arms; second click within the same render confirms.
    if (pendingDeleteId !== rec.id) {
      setPendingDeleteId(rec.id);
      return;
    }
    // Hand focus to the username input BEFORE we mutate state, so the
    // dialog's focus trap can never end up pointing at the about-to-be-
    // unmounted Delete button. Then re-focus after the DOM commits, in
    // case React decides to bounce focus during reconciliation.
    usernameInputRef.current?.focus();
    deleteCommander(rec.id);
    try { clearSupabaseCreds(rec.username); } catch { /* swallow */ }
    setPendingDeleteId(null);
    setResetCreds(null);
    refreshLocalAccounts();
    returnFocusToUsername();
  }
  async function handleResetLocalAccount(rec: CommanderRecord) {
    const newPw = await resetCommanderPassword(rec.id);
    if (!newPw) return;
    setResetCreds({ username: rec.username, password: newPw });
    setPendingDeleteId(null);
    refreshLocalAccounts();
    returnFocusToUsername();
  }

  // Squadron data is only meaningful for roles that operate at squadron
  // scope. HQ Commander and Super Admin sit above squadrons, so the form
  // hides those fields for them.
  function roleNeedsSquadron(r: SetupRoleUI): boolean {
    return r === "ops" || r === "flight_commander" || r === "squadron_commander";
  }
  function roleToLock(r: SetupRoleUI): Exclude<PcRoleLock, null> {
    if (r === "ops") return "ops";
    if (r === "super_admin") return "super_admin";
    return "commander";
  }
  // Every role except super_admin needs an actual local user account so the
  // pilot/commander can sign in on this PC after restart. Super admin reuses
  // the baked-in admin credentials.
  function roleNeedsAccount(r: SetupRoleUI): boolean {
    return r !== "super_admin";
  }
  function roleAccountKind(r: SetupRoleUI): AccountRole {
    return r === "ops" ? "ops" : "commander";
  }
  function roleScope(r: SetupRoleUI): CommanderScope | undefined {
    if (r === "flight_commander") return "flight";
    if (r === "squadron_commander") return "squadron";
    if (r === "hq_commander") return "hq";
    return undefined;
  }
  function roleLabel(r: SetupRoleUI): string {
    if (r === "ops") return lang === "ar" ? "طيار عمليات" : "Ops Pilot";
    if (r === "flight_commander") return lang === "ar" ? "قائد طيران" : "Flight Commander";
    if (r === "squadron_commander") return lang === "ar" ? "قائد سرب" : "Squadron Commander";
    if (r === "hq_commander") return lang === "ar" ? "قائد القيادة" : "HQ Commander";
    return lang === "ar" ? "مدير عام" : "Super Admin";
  }
  function usernamePlaceholder(r: SetupRoleUI): string {
    if (r === "ops") return lang === "ar" ? "مثال: pilot.alkhatib" : "e.g. pilot.alkhatib";
    if (r === "flight_commander") return lang === "ar" ? "مثال: flt.alali" : "e.g. flt.alali";
    if (r === "squadron_commander") return lang === "ar" ? "مثال: sqn.alali" : "e.g. sqn.alali";
    return lang === "ar" ? "مثال: hq.alali" : "e.g. hq.alali";
  }

  function openSetup() {
    setSetupOpen(true);
    setSetupErr(null);
    setSetupOk(null);
    setSetupCredentials(null);
    setCredCopied(false);
    // If the active license carried a Super-Admin-assigned role, force the
    // setup dialog to that role; the operator can't widen their own tier.
    const assigned = localStorage.getItem("rjaf.assignedRole") as SetupRoleUI | null;
    setSetupRole(assigned && ["ops","flight_commander","squadron_commander","hq_commander","super_admin"].includes(assigned) ? assigned : "ops");
    setSetupSqnName(auth.squadron?.name ?? "");
    setSetupSqnNumber(auth.squadron?.number ?? "");
    setSetupSqnBase(auth.squadron?.base ?? "");
    setSetupCommanderName("");
    setSetupDeviceName(auth.pcDeviceName ?? "");
    setSetupOpsUsername("");
    setSetupAccountPassword("");
  }
  // True when the current license-key record assigned a role from the admin
  // page. We use this to disable the role selector inside the Setup dialog.
  const roleLockedByLicense = typeof window !== "undefined" && !!localStorage.getItem("rjaf.assignedRole");

  async function applySetup() {
    setSetupErr(null);
    setSetupBusy(true);
    try {
      const sqnName = setupSqnName.trim();
      const sqnNumber = setupSqnNumber.trim();
      const sqnBase = setupSqnBase.trim();
      const commanderName = setupCommanderName.trim();
      const needsSqn = roleNeedsSquadron(setupRole);
      if (needsSqn && (!sqnName || !sqnNumber || !sqnBase)) {
        setSetupErr(lang === "ar" ? "أكمل اسم السرب ورقمه والقاعدة." : "Fill squadron name, number, and base.");
        return;
      }
      const accountUsername = setupOpsUsername.trim().toLowerCase();
      if (roleNeedsAccount(setupRole) && !accountUsername) {
        setSetupErr(lang === "ar" ? "اسم المستخدم مطلوب." : "Username is required for this role.");
        return;
      }
      if (accountUsername === "admin") {
        setSetupErr(lang === "ar" ? "الاسم \"admin\" محجوز للمدير العام." : "Username 'admin' is reserved for the Super Admin.");
        return;
      }
      if (roleNeedsAccount(setupRole) && setupAccountPassword && setupAccountPassword.length < 4) {
        setSetupErr(lang === "ar" ? "كلمة المرور يجب أن تكون 4 أحرف على الأقل." : "Password must be at least 4 characters.");
        return;
      }
      if ((setupRole === "squadron_commander" || setupRole === "flight_commander") && !commanderName) {
        setSetupErr(lang === "ar" ? "أدخل اسم القائد." : "Enter the commander's name.");
        return;
      }

      // Block setup until the per-PC fingerprint has actually resolved —
      // otherwise the auto-activated license gets bound to "FP-PENDING" and
      // refuses to validate again next launch when the real fingerprint
      // appears.
      if (!auth.fingerprint || auth.fingerprint === "FP-PENDING") {
        setSetupErr(lang === "ar"
          ? "جارٍ تجهيز معرف الجهاز. أعد المحاولة بعد لحظات."
          : "Device fingerprint still initializing. Try again in a moment.");
        return;
      }

      // CRITICAL ORDER OF OPERATIONS for setup:
      //   1. Create the local user account (so the pilot/commander can sign in
      //      after restart). Without this step the PC ends up role-locked but
      //      with no usable account — the user's biggest fear.
      //   2. For Ops PCs only: mint + activate the local license.
      //   3. Persist squadron / device / role lock.
      // Each step short-circuits on failure to avoid half-applied state.
      let createdPassword: string | null = null;
      if (roleNeedsAccount(setupRole)) {
        // Use the explicitly-typed password if provided; otherwise generate a
        // strong one and surface it to the super admin to hand off.
        const chosen = setupAccountPassword.trim();
        const initialPassword = chosen || generateInitialPassword();

        const create = await createCommander({
          username: accountUsername,
          displayName: commanderName || accountUsername,
          role: roleAccountKind(setupRole),
          scope: roleScope(setupRole),
          squadronIds: [],
        });
        if (!create.ok || !create.record) {
          if (create.error === "duplicate_username") {
            setSetupErr(lang === "ar" ? "اسم المستخدم موجود مسبقاً على هذا الجهاز." : "That username already exists on this PC.");
          } else if (create.error === "reserved_username") {
            setSetupErr(lang === "ar" ? "الاسم \"admin\" محجوز." : "Username 'admin' is reserved.");
          } else {
            setSetupErr(create.error ?? "Failed to create account.");
          }
          return;
        }
        // Replace the auto-generated password with whichever one we'll display
        // to the admin. createCommander always writes a hash for its OWN
        // internally-generated password, which is NOT the same string as
        // `initialPassword` here — so without this overwrite, the credentials
        // popup would show a password that doesn't actually unlock the account.
        // We overwrite unconditionally (whether the admin typed a password or
        // we auto-generated one) to guarantee popup-shown == stored-hash.
        {
          const hashes = JSON.parse(localStorage.getItem("rjaf.commanderPwHashes") || "{}");
          const enc = new TextEncoder().encode(initialPassword);
          const buf = await crypto.subtle.digest("SHA-256", enc);
          hashes[create.record.id] = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
          localStorage.setItem("rjaf.commanderPwHashes", JSON.stringify(hashes));
        }
        createdPassword = initialPassword;

        // For commander roles, also provision a Supabase auth user so the
        // commander can read squadron data on every PC they sign into. Ops
        // accounts are handled later in the ops-only branch (via
        // register-license, which provisions the auth user atomically).
        // Failing this step does NOT abort setup — local sign-in still
        // works; only cross-PC data sync is degraded.
        if (supabaseConfigured && setupRole !== "ops" && roleAccountKind(setupRole) === "commander") {
          const tierForSb: "hq" | "squadron" | "flight" =
            setupRole === "hq_commander" ? "hq"
            : setupRole === "flight_commander" ? "flight"
            : "squadron";
          try {
            const prov = await provisionCommanderRemote({
              username: accountUsername,
              displayName: commanderName || accountUsername,
              role: "commander",
              tier: tierForSb,
              squadronNumber: tierForSb === "hq" ? "" : sqnNumber,
              squadronName: tierForSb === "hq" ? "" : sqnName,
              squadronBase: tierForSb === "hq" ? "" : sqnBase,
            });
            if (prov.ok && prov.supabaseEmail && prov.supabasePassword) {
              storeSupabaseCreds(accountUsername, prov.supabaseEmail, prov.supabasePassword);
            } else {
              console.warn("[provision-commander]", prov.error ?? "unknown");
            }
          } catch (err) {
            console.warn("[provision-commander] threw", err);
          }
        }
      }

      if (setupRole === "ops") {
        const sqnCode = sqnNumber.replace(/[^0-9A-Z]/gi, "").toUpperCase().slice(0, 4) || "SQN";
        const issuedAt = new Date().toISOString().slice(0, 10);
        const setupExpiry = resolveSetupExpiry(issuedAt);
        if (!setupExpiry.valid) {
          setSetupErr(lang === "ar" ? "أدخل مدة صحيحة." : "Enter a valid duration.");
          return;
        }
        const expiresAt = setupExpiry.expiresAt;
        const fullKey = genKey(sqnCode);
        const rec: LicenseKey = {
          id: "key-" + Math.random().toString(36).slice(2, 8),
          squadronId: "local-" + sqnCode,
          keyPreview: `EE-${sqnCode}-••••-${fullKey.slice(-4)}`,
          status: "active",
          issuedAt,
          expiresAt,
          assignedUsername: accountUsername,
          lockedToDevice: null,
          lastSyncAt: null,
        };
        registerLicenseKey({ fullKey, meta: rec });
        setKeys(() => listLicenseKeys());
        // In Supabase mode the key MUST exist server-side before
        // activateLicense (which calls validate-license) is invoked, otherwise
        // the server returns "unknown_key" and the brand-new install is bricked.
        if (supabaseConfigured) {
          const reg = await registerLicenseRemote({
            key: fullKey,
            username: accountUsername,
            displayName: commanderName || accountUsername,
            squadronNumber: sqnNumber,
            squadronName: sqnName,
            squadronBase: sqnBase,
            expiresAt: expiresAt ?? null,
          });
          if (!reg.ok) {
            setSetupErr(
              lang === "ar"
                ? `تعذر تسجيل المفتاح في الخادم: ${reg.error ?? ""}`
                : `Could not register license with server: ${reg.error ?? ""}`,
            );
            return;
          }
          // Persist Supabase creds for THIS local username so subsequent
          // sign-ins can also sign into Supabase and obtain a JWT carrying
          // squadron_id + role. Without this every operational-table read
          // is filtered out by RLS — i.e. zero data sync between PCs.
          if (reg.supabaseEmail && reg.supabasePassword) {
            storeSupabaseCreds(accountUsername, reg.supabaseEmail, reg.supabasePassword);
          }
        }
        const res = await auth.activateLicense(fullKey, accountUsername);
        if (!res.ok) {
          setSetupErr(res.error ?? "License activation failed. Role lock NOT applied.");
          return;
        }
      }

      // Squadron is only persisted when the role actually operates within
      // a squadron. HQ Commander / Super Admin keep whatever was already set.
      if (needsSqn) {
        auth.configureSquadron({ name: sqnName, number: sqnNumber, base: sqnBase });
      }
      // Persist commander tier separately so the dashboard can show the right
      // label ("Squadron Commander" vs "Flight Commander" vs "HQ Commander")
      // without expanding the PcRoleLock enum.
      const tier =
        setupRole === "hq_commander" ? "hq" :
        setupRole === "squadron_commander" ? "squadron" :
        setupRole === "flight_commander" ? "flight" : "";
      if (tier) localStorage.setItem("rjaf.commanderTier", tier);
      else localStorage.removeItem("rjaf.commanderTier");
      if (commanderName) localStorage.setItem("rjaf.commanderName", commanderName);
      auth.setPcDeviceName(setupDeviceName.trim());
      auth.setPcRoleLock(roleToLock(setupRole));

      if (createdPassword && roleNeedsAccount(setupRole)) {
        setSetupCredentials({
          username: accountUsername,
          password: createdPassword,
          roleLabel: roleLabel(setupRole),
        });
      }
      // For non-Ops roles, persist the chosen expiry locally so the launch
      // gate can lock the PC out when the period ends. (Ops PCs already
      // have it baked into the auto-minted license above.)
      if (setupRole !== "ops" && setupRole !== "super_admin") {
        const issuedAt = new Date().toISOString().slice(0, 10);
        const setupExpiry = resolveSetupExpiry(issuedAt);
        if (!setupExpiry.valid) {
          setSetupErr(lang === "ar" ? "أدخل مدة صحيحة." : "Enter a valid duration.");
          return;
        }
        if (setupExpiry.expiresAt) {
          localStorage.setItem("rjaf.localExpiresAt", setupExpiry.expiresAt);
        } else {
          localStorage.removeItem("rjaf.localExpiresAt");
        }
      }
      setSetupOk(
        lang === "ar"
          ? "تم إعداد هذا الجهاز. أعد التشغيل لتطبيق الدور الجديد."
          : "Device set up. Restart the app to apply the new role.",
      );
    } finally {
      setSetupBusy(false);
    }
  }
  const [genFor, setGenFor] = useState<string>("");
  const [genUsername, setGenUsername] = useState<string>("");
  const [genDuration, setGenDuration] = useState<LicenseDuration | typeof CUSTOM_DURATION>("1y");
  const [genCustomDays, setGenCustomDays] = useState<string>("5");
  // Pre-assigned role tier for the PC this key will activate. Only the
  // Super Admin chooses this here; the field operator can't override it
  // during Setup. Defaults to "ops" (the most common case — squadron
  // operations PC).
  const [genRole, setGenRole] = useState<"ops" | "flight_commander" | "squadron_commander" | "hq_commander">("ops");
  // Authorized squadrons for commander tiers. Empty for ops (the PC's own
  // squadron is implicit) and HQ (sees all). For Flight/Squadron Commander
  // PCs, the Super Admin ticks exactly which squadrons that commander is
  // allowed to monitor — and only those.
  const [genAuthSqns, setGenAuthSqns] = useState<string[]>([]);
  const [genOpen, setGenOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function toggleGenAuthSqn(id: string) {
    setGenAuthSqns(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  // Resolve the picked duration (preset or custom) into an ISO expiry date.
  // Returns null for "never expires" or invalid custom input.
  function resolveExpiry(issuedAt: string): { expiresAt: string | null; valid: boolean } {
    if (genDuration === CUSTOM_DURATION) {
      const n = Number(genCustomDays);
      if (!Number.isFinite(n) || n <= 0) return { expiresAt: null, valid: false };
      return { expiresAt: addDays(issuedAt, n), valid: true };
    }
    return { expiresAt: addDuration(issuedAt, genDuration), valid: true };
  }

  function handleGenerate() {
    const sqn = squadrons.find(s => s.id === genFor);
    if (!sqn) return;
    const username = genUsername.trim();
    if (!username) return;
    const issuedAt = new Date().toISOString().slice(0, 10);
    const { expiresAt, valid } = resolveExpiry(issuedAt);
    if (!valid) return;
    const full = genKey(sqn.code);
    setNewKey(full);
    // For commander tiers (squadron / flight) the Super Admin must tick at
    // least one authorized squadron; the home squadron (`sqn`) is auto-added
    // so the commander can always see the squadron the PC belongs to.
    const isCommanderTier = genRole === "squadron_commander" || genRole === "flight_commander";
    const authSqns = isCommanderTier
      ? Array.from(new Set([sqn.id, ...genAuthSqns]))
      : undefined;
    const newRecord: LicenseKey = {
      id: "key-" + Math.random().toString(36).slice(2, 8),
      squadronId: sqn.id,
      keyPreview: `EE-${sqn.code}-••••-${full.slice(-4)}`,
      status: "active",
      issuedAt,
      expiresAt,
      assignedUsername: username,
      lockedToDevice: null,
      lastSyncAt: null,
      assignedRole: genRole,
      authorizedSquadronIds: authSqns,
    };
    registerLicenseKey({ fullKey: full, meta: newRecord });
    setKeys(() => listLicenseKeys());
    // Mirror the new key into Supabase so any other PC that activates it
    // can be validated by the central server.
    if (supabaseConfigured) {
      void (async () => {
        const r = await registerLicenseRemote({
          key: full,
          username,
          displayName: username,
          squadronNumber: sqn.code,
          squadronName: sqn.name,
          squadronBase: sqn.base,
          expiresAt,
        });
        if (r.ok && r.supabaseEmail && r.supabasePassword) {
          storeSupabaseCreds(username, r.supabaseEmail, r.supabasePassword);
        }
      })();
    }
  }

  function isExpired(k: LicenseKey): boolean {
    return Boolean(k.expiresAt) && +new Date(k.expiresAt!) < Date.now();
  }

  function statusLabel(s: LicenseKey["status"]) {
    if (s === "active") return <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{t("active")}</span>;
    if (s === "revoked") return <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200">{t("revoked")}</span>;
    return <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200">{t("locked")}</span>;
  }

  function revoke(id: string) {
    updateLicenseKey(id, { status: "revoked" });
    setKeys(() => listLicenseKeys());
  }
  function release(id: string) {
    updateLicenseKey(id, { status: "active", lockedToDevice: null });
    setKeys(() => listLicenseKeys());
  }
  // Hard-delete: wipes the row from the registry entirely. Used after an
  // operator uninstalls and the super admin wants the entry gone — not just
  // revoked. Confirmation prompt prevents accidental clicks.
  function hardDelete(k: LicenseKey) {
    const sqn = squadrons.find(s => s.id === k.squadronId);
    const sqnName = sqn ? (lang === "ar" ? sqn.nameAr : sqn.name) : "—";
    const who = k.assignedUsername || "—";
    const msg = lang === "ar"
      ? `حذف نهائي للمفتاح المخصص لـ "${who}" (${sqnName})؟\n\nلن تتمكن من تفعيل هذا المفتاح مجدداً. سيتعين إصدار مفتاح جديد.`
      : `Permanently delete the key issued to "${who}" (${sqnName})?\n\nThis key string can never be activated again. A new key must be issued.`;
    if (!window.confirm(msg)) return;
    removeLicenseKey(k.id);
    setKeys(() => listLicenseKeys());
  }

  // Per-PC authorized-squadron editor. Reads + writes the same localStorage
  // key that the License-Key flow seeds (`rjaf.authorizedSquadronIds`) and
  // mirrors the change into the registry record so the PC's history stays
  // consistent. Only visible when this PC is licensed as a commander tier.
  const assignedRoleHere = (typeof window !== "undefined" ? localStorage.getItem("rjaf.assignedRole") : null) as
    | "ops" | "flight_commander" | "squadron_commander" | "hq_commander" | "super_admin" | null;
  const showLiveAuthEditor =
    assignedRoleHere === "squadron_commander" ||
    assignedRoleHere === "flight_commander" ||
    assignedRoleHere === "hq_commander";
  const [liveAuth, setLiveAuth] = useState<string[]>(() => {
    try { const raw = localStorage.getItem("rjaf.authorizedSquadronIds"); return raw ? JSON.parse(raw) : []; }
    catch { return []; }
  });
  const [liveAuthSavedFlash, setLiveAuthSavedFlash] = useState(false);
  function toggleLiveAuth(id: string) {
    setLiveAuth(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }
  function saveLiveAuth() {
    const homeSqnNumber = auth.squadron?.number ?? "";
    const homeSqnId = squadrons.find(s => s.code === homeSqnNumber || s.id === `local-${homeSqnNumber}`)?.id;
    // Always keep the home squadron in the list so the commander can never
    // accidentally lose visibility on the squadron their PC physically lives at.
    const final = homeSqnId
      ? Array.from(new Set([homeSqnId, ...liveAuth]))
      : Array.from(new Set(liveAuth));
    localStorage.setItem("rjaf.authorizedSquadronIds", JSON.stringify(final));
    // Mirror the new list back onto the registered LicenseKey for this PC so
    // re-activating won't snap back to the original list issued months ago.
    const activeKey = localStorage.getItem("rjaf.licenseKey");
    if (activeKey) {
      const matching = keys.find(k => (k as unknown as { _fullKey?: string })._fullKey?.toUpperCase() === activeKey.toUpperCase());
      if (matching) updateLicenseKey(matching.id, { authorizedSquadronIds: final });
      setKeys(() => listLicenseKeys());
    }
    setLiveAuth(final);
    setLiveAuthSavedFlash(true);
    setTimeout(() => setLiveAuthSavedFlash(false), 1800);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-bold flex items-center gap-2"><KeyRound className="h-5 w-5" />{t("licenseKeys")}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={openSetup} data-testid="button-setup-device">
            <Wrench className="h-4 w-4 me-1" />
            {lang === "ar" ? "إعداد هذا الجهاز" : "Set up this device"}
          </Button>
          <Button variant="outline" onClick={() => setChangeOpen(true)} data-testid="button-change-device" title={lang === "ar" ? "نقل/تغيير جهاز قائد" : "Move or repurpose this commander PC"}>
            <Wrench className="h-4 w-4 me-1" />
            {lang === "ar" ? "تغيير هذا الجهاز" : "Change this device"}
          </Button>
          <Button onClick={() => { setGenOpen(true); setNewKey(null); setGenFor(""); setGenUsername(""); setGenDuration("1y"); setGenCustomDays("5"); setGenRole("ops"); setGenAuthSqns([]); }} data-testid="button-generate">
            {t("generateKey")}
          </Button>
        </div>
      </div>

      {showLiveAuthEditor && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-sm font-bold">
                  {lang === "ar" ? "الأسراب التي يراقبها هذا الجهاز" : "Squadrons this PC monitors"}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  {lang === "ar"
                    ? "أضف أو احذف أسراب هذا الجهاز هنا. يحفظ التغيير محليًا فورًا — لا حاجة لإعادة إصدار المفتاح."
                    : "Add or remove squadrons for this PC here. Saved locally on this device — no key reissue needed."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {liveAuthSavedFlash && <span className="text-xs text-emerald-600 font-medium">{lang === "ar" ? "تم الحفظ ✓" : "Saved ✓"}</span>}
                <Button size="sm" onClick={saveLiveAuth} data-testid="button-save-live-auth">
                  {lang === "ar" ? "حفظ" : "Save"}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 max-h-56 overflow-y-auto border border-border rounded p-2">
              {squadrons.map(s => {
                const homeNumber = auth.squadron?.number ?? "";
                const isHome = s.code === homeNumber || s.id === `local-${homeNumber}`;
                const checked = isHome || liveAuth.includes(s.id);
                return (
                  <label key={s.id} className={`flex items-center gap-2 text-xs cursor-pointer ${isHome ? "opacity-70" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isHome}
                      onChange={() => toggleLiveAuth(s.id)}
                      data-testid={`check-liveauth-${s.id}`}
                    />
                    <span>{lang === "ar" ? s.nameAr : s.name}{isHome ? (lang === "ar" ? " (أم)" : " (home)") : ""}</span>
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="text-start py-2 px-3">{t("squadron")}</th>
                  <th className="text-start py-2 px-3">{t("key")}</th>
                  <th className="text-start py-2 px-3">{t("assignedTo")}</th>
                  <th className="text-start py-2 px-3">{t("status")}</th>
                  <th className="text-start py-2 px-3">{t("issued")}</th>
                  <th className="text-start py-2 px-3">{t("expires")}</th>
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
                      <td className="py-2 px-3 text-xs" data-testid={`text-assigned-${k.id}`}>{k.assignedUsername || "—"}</td>
                      <td className="py-2 px-3">
                        {statusLabel(k.status)}
                        {isExpired(k) && k.status !== "revoked" ? (
                          <span className="ms-1 inline-flex rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" data-testid={`badge-expired-${k.id}`}>{t("expiredKey")}</span>
                        ) : null}
                      </td>
                      <td className="py-2 px-3 tabular-nums">{fmtDate(k.issuedAt, lang)}</td>
                      <td className="py-2 px-3 tabular-nums" data-testid={`text-expires-${k.id}`}>
                        {k.expiresAt ? fmtDate(k.expiresAt, lang) : <span className="text-muted-foreground">{t("neverExpires")}</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-xs">{k.lockedToDevice ?? "—"}</td>
                      <td className="py-2 px-3 tabular-nums">{k.lastSyncAt ? fmtDateTime(k.lastSyncAt, lang) : "—"}</td>
                      <td className="py-2 px-3 text-end space-x-2 rtl:space-x-reverse">
                        {k.status === "locked" && (
                          <Button size="sm" variant="outline" onClick={() => release(k.id)} data-testid={`button-release-${k.id}`}>{t("release")}</Button>
                        )}
                        {k.status !== "revoked" && (
                          <Button size="sm" variant="destructive" onClick={() => revoke(k.id)} data-testid={`button-revoke-${k.id}`}>{t("revoke")}</Button>
                        )}
                        <Button size="sm" variant="destructive" onClick={() => hardDelete(k)} data-testid={`button-delete-${k.id}`}>{t("delete")}</Button>
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
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{lang === "ar" ? "السرب الأم لهذا الجهاز" : "Home squadron of this PC"}</label>
                <Select value={genFor} onValueChange={setGenFor}>
                  <SelectTrigger data-testid="select-squadron"><SelectValue placeholder={t("selectSquadron")} /></SelectTrigger>
                  <SelectContent>
                    {squadrons.map(s => (
                      <SelectItem key={s.id} value={s.id}>{lang === "ar" ? s.nameAr : s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{lang === "ar" ? "دور هذا الجهاز" : "Role for this PC"}</label>
                <Select value={genRole} onValueChange={(v) => { setGenRole(v as typeof genRole); setGenAuthSqns([]); }}>
                  <SelectTrigger data-testid="select-gen-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ops">{lang === "ar" ? "طيار عمليات" : "Ops Pilot"}</SelectItem>
                    <SelectItem value="flight_commander">{lang === "ar" ? "قائد طيران" : "Flight Commander"}</SelectItem>
                    <SelectItem value="squadron_commander">{lang === "ar" ? "قائد سرب" : "Squadron Commander"}</SelectItem>
                    <SelectItem value="hq_commander">{lang === "ar" ? "قائد القيادة" : "Head Quarter Commander"}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {lang === "ar"
                    ? "هذا الدور يُقفل على الجهاز عند التفعيل ولا يمكن للمشغّل تغييره."
                    : "This role is locked on the PC at activation; the operator cannot change it."}
                </p>
              </div>

              {(genRole === "squadron_commander" || genRole === "flight_commander") && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {lang === "ar" ? "الأسراب المخوّل بمراقبتها" : "Authorized squadrons (which this commander can monitor)"}
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    {lang === "ar"
                      ? "اختر الأسراب التي يستطيع هذا الجهاز عرض بياناتها فقط. يُضاف السرب الأم تلقائيًا."
                      : "Pick exactly the squadrons this PC may view. The home squadron is added automatically."}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto border border-border rounded p-2">
                    {squadrons.map(s => {
                      const isHome = s.id === genFor;
                      const checked = isHome || genAuthSqns.includes(s.id);
                      return (
                        <label key={s.id} className={`flex items-center gap-2 text-xs cursor-pointer ${isHome ? "opacity-70" : ""}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isHome}
                            onChange={() => toggleGenAuthSqn(s.id)}
                            data-testid={`check-genauth-${s.id}`}
                          />
                          <span>{lang === "ar" ? s.nameAr : s.name}{isHome ? (lang === "ar" ? " (أم)" : " (home)") : ""}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {genRole === "hq_commander" && (
                <p className="text-[11px] text-muted-foreground border border-border rounded p-2">
                  {lang === "ar"
                    ? "قائد القيادة يرى كل الأسراب تلقائيًا — لا حاجة لاختيار."
                    : "HQ Commander sees every squadron automatically — no selection needed."}
                </p>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <UserIcon className="h-3.5 w-3.5" /> {t("operatorUsername")}
                </label>
                <input
                  value={genUsername}
                  onChange={e => setGenUsername(e.target.value)}
                  placeholder={t("operatorUsernamePh")}
                  className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm"
                  data-testid="input-username"
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">{t("operatorUsernameHelp")}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("licenseDuration")}</label>
                <Select value={genDuration} onValueChange={(v) => setGenDuration(v as LicenseDuration | typeof CUSTOM_DURATION)}>
                  <SelectTrigger data-testid="select-duration"><SelectValue placeholder={t("selectDuration")} /></SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map(d => (
                      <SelectItem key={d} value={d} data-testid={`option-duration-${d}`}>{t(`duration_${d}` as const)}</SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_DURATION} data-testid="option-duration-custom">{t("duration_custom")}</SelectItem>
                  </SelectContent>
                </Select>
                {genDuration === CUSTOM_DURATION && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      step={1}
                      value={genCustomDays}
                      onChange={e => setGenCustomDays(e.target.value)}
                      className="w-24 px-3 py-2 rounded-md bg-input border border-border text-sm tabular-nums"
                      data-testid="input-custom-days"
                    />
                    <span className="text-xs text-muted-foreground">{t("days")}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground" data-testid="text-expiry-preview">
                  {(() => {
                    const today = new Date().toISOString().slice(0, 10);
                    const { expiresAt, valid } = resolveExpiry(today);
                    if (!valid) return t("invalidDuration");
                    if (!expiresAt) return t("neverExpires");
                    return `${t("expires")}: ${fmtDate(expiresAt, lang)}`;
                  })()}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                {t("issuedToLine").replace("{user}", genUsername)}
              </div>
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
                <Button
                  onClick={handleGenerate}
                  disabled={!genFor || !genUsername.trim() || (genDuration === CUSTOM_DURATION && !(Number(genCustomDays) > 0))}
                  data-testid="button-confirm-gen"
                >
                  {t("generateKey")}
                </Button>
              </>
            ) : (
              <Button onClick={() => setGenOpen(false)} data-testid="button-done">{t("done")}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{lang === "ar" ? "إعداد هذا الجهاز" : "Set up this device"}</DialogTitle>
            <DialogDescription>
              {lang === "ar"
                ? "اضبط دور هذا الجهاز واسم السرب باستخدام نموذج واحد. ينطبق فوراً ويستمر بعد إعادة التشغيل."
                : "Set this PC's role, squadron, and (for Ops PCs) auto-mint and activate a license — all in one form."}
            </DialogDescription>
          </DialogHeader>

          {setupOk ? (
            <div className="space-y-3">
              <div className="rounded border border-emerald-300 bg-emerald-50 dark:bg-emerald-950 p-3 text-sm text-emerald-900 dark:text-emerald-100">
                {setupOk}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Existing local accounts on THIS PC. Lets the Super Admin
                  delete a stale entry that's blocking re-creation (the
                  "username already exists" trap), or reset a forgotten
                  password — without leaving the Setup dialog. */}
              {localAccounts.length > 0 && (
                <div className="rounded border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 p-2">
                  <div className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-2">
                    {lang === "ar"
                      ? `الحسابات المحلية الموجودة (${localAccounts.length})`
                      : `Existing local accounts on this PC (${localAccounts.length})`}
                  </div>
                  <div className="space-y-1.5">
                    {localAccounts.map((rec) => (
                      <div key={rec.id} className="flex items-center justify-between gap-2 rounded bg-white dark:bg-black/30 p-1.5 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono font-bold truncate" data-testid={`text-localacct-${rec.username}`}>{rec.username}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{rec.role} · {rec.displayName}</div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => handleResetLocalAccount(rec)}
                          data-testid={`button-localacct-reset-${rec.username}`}
                        >
                          {lang === "ar" ? "إعادة كلمة السر" : "Reset PW"}
                        </Button>
                        <Button
                          size="sm"
                          variant={pendingDeleteId === rec.id ? "destructive" : "outline"}
                          className="h-7 px-2 text-[11px]"
                          onClick={() => handleDeleteLocalAccount(rec)}
                          data-testid={`button-localacct-delete-${rec.username}`}
                        >
                          {pendingDeleteId === rec.id
                            ? (lang === "ar" ? "تأكيد الحذف؟" : "Confirm?")
                            : (lang === "ar" ? "حذف" : "Delete")}
                        </Button>
                      </div>
                    ))}
                  {/* (close inner spacer) */}</div>
                  {resetCreds && (
                      <div className="mt-2 rounded border border-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 p-2 text-[11px] text-emerald-900 dark:text-emerald-100">
                        <div className="font-bold mb-1">
                          {lang === "ar" ? "كلمة المرور الجديدة (تظهر مرة واحدة):" : "New password (shown once):"}
                        </div>
                        <div className="font-mono">
                          <span className="text-muted-foreground">User:</span> <span className="font-bold">{resetCreds.username}</span>
                          {"  "}
                          <span className="text-muted-foreground">Pass:</span> <span className="font-bold tracking-wider">{resetCreds.password}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-1 h-6 px-2 text-[10px]"
                          onClick={() => navigator.clipboard.writeText(`${resetCreds.username} / ${resetCreds.password}`)}
                          data-testid="button-localacct-copy-reset"
                        >
                          {lang === "ar" ? "نسخ" : "Copy"}
                        </Button>
                      </div>
                    )}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">{lang === "ar" ? "دور هذا الجهاز" : "Role for this PC"}</label>
                <Select value={setupRole} onValueChange={(v) => setSetupRole(v as SetupRoleUI)} disabled={roleLockedByLicense}>
                  <SelectTrigger data-testid="select-setup-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ops">{lang === "ar" ? "طيار عمليات (Ops)" : "Ops Pilot"}</SelectItem>
                    <SelectItem value="flight_commander">{lang === "ar" ? "قائد طيران" : "Flight Commander"}</SelectItem>
                    <SelectItem value="squadron_commander">{lang === "ar" ? "قائد سرب" : "Squadron Commander"}</SelectItem>
                    <SelectItem value="hq_commander">{lang === "ar" ? "قائد القيادة" : "Head Quarter Commander"}</SelectItem>
                    <SelectItem value="super_admin">{lang === "ar" ? "مدير عام" : "Super Admin"}</SelectItem>
                  </SelectContent>
                </Select>
                {roleLockedByLicense && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    {lang === "ar"
                      ? "تم قفل الدور من قبل المدير العام عند إصدار المفتاح."
                      : "Role was locked by the Super Admin when this key was issued."}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {!roleNeedsSquadron(setupRole)
                    ? (lang === "ar"
                        ? "هذا الدور يعمل فوق مستوى السرب — معلومات السرب اختيارية."
                        : "This role sits above squadron level — squadron info is optional.")
                    : (lang === "ar"
                        ? "املأ تفاصيل السرب أدناه."
                        : "Fill in the squadron details below.")}
                </p>
              </div>

              {(setupRole === "squadron_commander" || setupRole === "flight_commander" || setupRole === "hq_commander") && (
                <div className="space-y-1">
                  <label className="text-sm font-medium">
                    {lang === "ar" ? "اسم القائد" : "Commander name"}
                    {(setupRole === "squadron_commander" || setupRole === "flight_commander") && (
                      <span className="text-red-500 ms-1">*</span>
                    )}
                  </label>
                  <input
                    value={setupCommanderName}
                    onChange={e => setSetupCommanderName(e.target.value)}
                    placeholder={lang === "ar" ? "مثال: المقدم محمد العلي" : "e.g. Lt.Col. Mohammed Al-Ali"}
                    className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm"
                    data-testid="input-setup-commander-name"
                  />
                </div>
              )}

              {roleNeedsSquadron(setupRole) && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-sm font-medium">{lang === "ar" ? "اسم السرب" : "Squadron name"}</label>
                      <input
                        value={setupSqnName}
                        onChange={e => setSetupSqnName(e.target.value)}
                        placeholder={lang === "ar" ? "مثال: السرب الأول" : "e.g. 1st Squadron"}
                        className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm"
                        data-testid="input-setup-sqn-name"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">{lang === "ar" ? "الرقم" : "Number"}</label>
                      <input
                        value={setupSqnNumber}
                        onChange={e => setSetupSqnNumber(e.target.value)}
                        placeholder="1"
                        className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm"
                        data-testid="input-setup-sqn-number"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium">{lang === "ar" ? "القاعدة" : "Base"}</label>
                    <input
                      value={setupSqnBase}
                      onChange={e => setSetupSqnBase(e.target.value)}
                      placeholder={lang === "ar" ? "مثال: قاعدة الملك حسين" : "e.g. King Hussein Air Base"}
                      className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm"
                      data-testid="input-setup-sqn-base"
                    />
                  </div>
                </>
              )}

              <div className="space-y-1">
                <label className="text-sm font-medium">{lang === "ar" ? "اسم الجهاز (اختياري)" : "Device name (optional)"}</label>
                <input
                  value={setupDeviceName}
                  onChange={e => setSetupDeviceName(e.target.value)}
                  placeholder={lang === "ar" ? "مثال: جهاز غرفة العمليات 3" : "e.g. Cockpit-3"}
                  className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm"
                  data-testid="input-setup-device-name"
                />
              </div>

              {/* Duration this PC will stay licensed for. After it expires, the
                  PC locks until a Super Admin re-issues / re-runs setup. */}
              <div className="space-y-2 rounded-md border border-blue-300/40 bg-blue-50/60 dark:bg-blue-950/30 p-3">
                <label className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  {lang === "ar" ? "مدة صلاحية هذا الجهاز" : "How long this PC stays valid"}
                </label>
                <Select value={setupDuration} onValueChange={(v) => setSetupDuration(v as LicenseDuration | typeof CUSTOM_DURATION)}>
                  <SelectTrigger data-testid="select-setup-duration"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map(d => (
                      <SelectItem key={d} value={d} data-testid={`option-setup-duration-${d}`}>{t(`duration_${d}` as const)}</SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_DURATION} data-testid="option-setup-duration-custom">{t("duration_custom")}</SelectItem>
                  </SelectContent>
                </Select>
                {setupDuration === CUSTOM_DURATION && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      step={1}
                      value={setupCustomDays}
                      onChange={e => setSetupCustomDays(e.target.value)}
                      className="w-24 px-3 py-2 rounded-md bg-input border border-border text-sm tabular-nums"
                      data-testid="input-setup-custom-days"
                    />
                    <span className="text-xs text-muted-foreground">{t("days")}</span>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground" data-testid="text-setup-expiry-preview">
                  {(() => {
                    const today = new Date().toISOString().slice(0, 10);
                    const { expiresAt, valid } = resolveSetupExpiry(today);
                    if (!valid) return lang === "ar" ? "مدة غير صحيحة" : "Invalid duration";
                    if (!expiresAt) return lang === "ar" ? "بدون انتهاء" : "Never expires";
                    return (lang === "ar" ? "ينتهي في: " : "Expires: ") + fmtDate(expiresAt, lang);
                  })()}
                </p>
                <p className="text-[10px] text-blue-900/70 dark:text-blue-200/70">
                  {lang === "ar"
                    ? "بعد انتهاء المدة سيتم قفل هذا الجهاز حتى يقوم المدير العام بإعداده من جديد."
                    : "When this period ends, the PC locks until a Super Admin re-runs setup."}
                </p>
              </div>

              {roleNeedsAccount(setupRole) && (
                <div className="space-y-3 rounded-md border border-amber-300/40 bg-amber-50/60 dark:bg-amber-950/30 p-3">
                  <div className="text-[12px] font-semibold text-amber-900 dark:text-amber-200">
                    {lang === "ar"
                      ? `حساب الدخول لـ${roleLabel(setupRole)}`
                      : `Sign-in account for ${roleLabel(setupRole)}`}
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium flex items-center gap-1.5">
                      <UserIcon className="h-3.5 w-3.5" />
                      {lang === "ar" ? "اسم المستخدم" : "Username"}
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      ref={usernameInputRef}
                      value={setupOpsUsername}
                      onChange={e => setSetupOpsUsername(e.target.value)}
                      placeholder={usernamePlaceholder(setupRole)}
                      className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm"
                      data-testid="input-setup-ops-user"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5" />
                      {lang === "ar" ? "كلمة المرور (اختياري)" : "Password (optional)"}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={setupAccountPassword}
                        onChange={e => setSetupAccountPassword(e.target.value)}
                        placeholder={lang === "ar" ? "اتركها فارغة لإنشاء كلمة مرور تلقائياً" : "Leave empty to auto-generate"}
                        className="flex-1 px-3 py-2 rounded-md bg-input border border-border text-sm font-mono"
                        data-testid="input-setup-account-pass"
                        autoComplete="off"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSetupAccountPassword(generateInitialPassword())}
                        data-testid="button-setup-pass-gen"
                        title={lang === "ar" ? "إنشاء كلمة مرور" : "Generate password"}
                      >
                        <Shuffle className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {lang === "ar"
                        ? "اختر كلمة مرور أو دعها فارغة وسيتم إنشاء واحدة وعرضها بعد الإعداد."
                        : "Pick a password or leave it blank — one will be generated and shown after setup."}
                    </p>
                  </div>
                  {setupRole === "ops" && (
                    <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80">
                      {lang === "ar"
                        ? "سيتم أيضاً إنشاء مفتاح ترخيص محلي وتفعيله تلقائياً لهذا المستخدم."
                        : "A local license key will also be auto-generated and activated for this user."}
                    </p>
                  )}
                </div>
              )}

              {setupOk && setupCredentials && (
                <div className="space-y-2 rounded-md border-2 border-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 p-3" data-testid="panel-setup-credentials">
                  <div className="text-sm font-bold text-emerald-900 dark:text-emerald-100 flex items-center gap-1.5">
                    <KeyRound className="h-4 w-4" />
                    {lang === "ar" ? "احفظ هذه البيانات الآن" : "Save these credentials NOW"}
                  </div>
                  <div className="text-[11px] text-emerald-900/80 dark:text-emerald-100/80">
                    {lang === "ar"
                      ? "لن يتم عرض كلمة المرور مرة أخرى. سلّمها لـ" + setupCredentials.roleLabel + "."
                      : `Password will not be shown again. Hand it to the ${setupCredentials.roleLabel}.`}
                  </div>
                  <div className="grid grid-cols-[80px_1fr] gap-1 text-sm font-mono bg-white dark:bg-black/40 rounded p-2">
                    <div className="text-muted-foreground">User:</div>
                    <div className="font-bold" data-testid="text-cred-user">{setupCredentials.username}</div>
                    <div className="text-muted-foreground">Pass:</div>
                    <div className="font-bold tracking-wider" data-testid="text-cred-pass">{setupCredentials.password}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(`${setupCredentials.username} / ${setupCredentials.password}`);
                      setCredCopied(true);
                      setTimeout(() => setCredCopied(false), 2000);
                    }}
                    data-testid="button-copy-creds"
                  >
                    {credCopied
                      ? <><Check className="h-3.5 w-3.5 me-1" />{lang === "ar" ? "تم النسخ" : "Copied"}</>
                      : <><Copy className="h-3.5 w-3.5 me-1" />{lang === "ar" ? "نسخ" : "Copy"}</>}
                  </Button>
                </div>
              )}

              {setupErr && (
                <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950 p-2 text-xs text-red-900 dark:text-red-100">
                  {setupErr}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {setupOk ? (
              <Button
                onClick={() => {
                  // Hard-reload so the new role lock and account take effect.
                  // In Electron this restarts the renderer with the new auth
                  // context; in the browser it bypasses any stale React state.
                  window.location.reload();
                }}
                data-testid="button-setup-reopen"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                {lang === "ar" ? "إعادة تشغيل التطبيق الآن" : "Reopen App Now"}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setSetupOpen(false)} disabled={setupBusy}>{t("cancel")}</Button>
                <Button onClick={applySetup} disabled={setupBusy} data-testid="button-setup-apply">
                  {setupBusy
                    ? (lang === "ar" ? "جارٍ الإعداد…" : "Setting up…")
                    : (lang === "ar" ? "تطبيق" : "Apply")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* "Change this device" — wipes the local PC binding so the Super Admin
          can re-set this PC up for a different person/role/squadron, or
          repurpose the same PC after a commander handover. The CLOUD is
          untouched, so no flight data is lost. */}
      <Dialog open={changeOpen} onOpenChange={setChangeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{lang === "ar" ? "تغيير هذا الجهاز" : "Change this device"}</DialogTitle>
            <DialogDescription>
              {lang === "ar"
                ? "سيتم مسح ربط هذا الجهاز بالقائد/السرب/الرخصة الحاليين، ومسح الحسابات المحلية، ليبدأ الإعداد من جديد. لن يتم حذف أي بيانات طيران من السحابة."
                : "This will clear this PC's link to the current commander, squadron, license and local sign-in accounts so you can set it up fresh. NO flight data is deleted from the cloud — only this PC's local bindings are reset."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="font-medium">{lang === "ar" ? "متى تستخدم هذا الخيار:" : "When to use this:"}</p>
            <ul className="list-disc ms-5 space-y-1 text-[12.5px] text-muted-foreground">
              <li>{lang === "ar" ? "قائد سلَّم جهازه وستعيد تخصيصه لقائد آخر." : "A commander hands their PC back and you're reassigning it to someone else."}</li>
              <li>{lang === "ar" ? "نفس الجهاز سيغيّر دوره (مثلاً من Ops إلى قائد سرب)." : "Same PC needs a new role (e.g. Ops → Squadron Commander)."}</li>
              <li>{lang === "ar" ? "نقل إعداد إلى جهاز جديد لنفس القائد بعد ربط الجهاز الجديد." : "Migrating setup to a brand-new PC after binding the new device."}</li>
            </ul>
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2 text-[12px]">
              {lang === "ar"
                ? "بعد التأكيد سيتم إعادة تشغيل التطبيق تلقائياً، وستحتاج لإصدار مفتاح جديد أو تشغيل (إعداد هذا الجهاز) من جديد."
                : "After confirming, the app reloads automatically. You'll then either issue a new license key or run \"Set up this device\" again."}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeOpen(false)} data-testid="button-change-cancel">
              {lang === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button variant="destructive" disabled={changeBusy} onClick={performChangeDevice} data-testid="button-change-confirm">
              {changeBusy
                ? (lang === "ar" ? "جارٍ المسح..." : "Resetting...")
                : (lang === "ar" ? "نعم، اعد ضبط هذا الجهاز" : "Yes, reset this PC")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Forced-reload overlay. After a successful setup the new role lock,
          account, and squadron config only take effect once the auth context
          re-initializes. We block every other interaction with a full-screen
          modal whose only action is "Reopen App Now" — this prevents the
          super admin from continuing to navigate in stale state and reaching
          a confusing half-applied view. The overlay sits OUTSIDE the Dialog
          so closing the dialog can't dismiss it. */}
      {setupOk && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          data-testid="overlay-force-reopen"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.preventDefault()}
        >
          <div className="max-w-md w-[92%] rounded-xl border-2 border-emerald-500 bg-card shadow-2xl p-6 space-y-4 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center">
              <Check className="h-7 w-7 text-emerald-500" />
            </div>
            <div className="text-lg font-bold gold-grad">
              {lang === "ar" ? "تم إعداد الجهاز" : "Device Configured"}
            </div>
            <div className="text-sm text-muted-foreground">
              {lang === "ar"
                ? "تم تطبيق إعدادات الدور الجديد. لا يمكن متابعة استخدام التطبيق بدون إعادة التشغيل لتفعيل الدور الجديد وتسجيل الدخول."
                : "The new role configuration has been saved. You cannot continue until you reopen the app — this loads the new role lock and lets the assigned user sign in."}
            </div>
            {setupCredentials && (
              <div className="text-xs bg-secondary border border-border rounded p-2 text-left font-mono">
                <div><span className="text-muted-foreground">User:</span> <span className="font-bold">{setupCredentials.username}</span></div>
                <div><span className="text-muted-foreground">Pass:</span> <span className="font-bold tracking-wider">{setupCredentials.password}</span></div>
              </div>
            )}
            <Button
              onClick={() => window.location.reload()}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-6 text-base"
              data-testid="button-overlay-reopen"
            >
              {lang === "ar" ? "إعادة تشغيل التطبيق الآن" : "Reopen App Now"}
            </Button>
            <div className="text-[10px] text-muted-foreground">
              {lang === "ar"
                ? "لن يعمل أي زر آخر حتى تضغط هنا."
                : "No other action will work until you click above."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
