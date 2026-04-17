import type { AuditEntry, LicenseKey, Pilot, Squadron, User } from "./types";

export const squadrons: Squadron[] = [
  { id: "sqn-1", name: "1st Fighter Squadron", nameAr: "السرب المقاتل الأول", code: "1FS", base: "Prince Hassan AB", baseAr: "قاعدة الأمير حسن", wing: "1st Wing", wingAr: "الجناح الأول", enabled: true, keyHolder: "Maj. Al-Khatib" },
  { id: "sqn-2", name: "2nd Attack Squadron", nameAr: "سرب الهجوم الثاني", code: "2AS", base: "Prince Hassan AB", baseAr: "قاعدة الأمير حسن", wing: "1st Wing", wingAr: "الجناح الأول", enabled: true, keyHolder: "Capt. Hijazi" },
  { id: "sqn-3", name: "7th Rotary Squadron", nameAr: "سرب الطوافات السابع", code: "7RS", base: "Marka AB", baseAr: "قاعدة ماركا", wing: "3rd Wing", wingAr: "الجناح الثالث", enabled: true, keyHolder: "Maj. Tarawneh" },
  { id: "sqn-4", name: "9th Transport Squadron", nameAr: "سرب النقل التاسع", code: "9TS", base: "King Abdullah II AB", baseAr: "قاعدة الملك عبدالله الثاني", wing: "5th Wing", wingAr: "الجناح الخامس", enabled: true, keyHolder: "Lt.Col. Masri" },
  { id: "sqn-5", name: "11th Training Squadron", nameAr: "سرب التدريب الحادي عشر", code: "11TS", base: "Mafraq AB", baseAr: "قاعدة المفرق", wing: "5th Wing", wingAr: "الجناح الخامس", enabled: false, keyHolder: null },
  { id: "sqn-6", name: "14th Recon Squadron", nameAr: "سرب الاستطلاع الرابع عشر", code: "14RS", base: "Marka AB", baseAr: "قاعدة ماركا", wing: "3rd Wing", wingAr: "الجناح الثالث", enabled: true, keyHolder: "Maj. Qudah" },
];

const ranks = [
  { en: "Capt.", ar: "نقيب" },
  { en: "Maj.", ar: "رائد" },
  { en: "Lt.Col.", ar: "مقدم" },
  { en: "Col.", ar: "عقيد" },
  { en: "Lt.", ar: "ملازم" },
  { en: "1Lt.", ar: "ملازم أول" },
];

const namesEn = ["Al-Khatib", "Hijazi", "Tarawneh", "Masri", "Qudah", "Sharif", "Mansour", "Habash", "Nimer", "Zoubi", "Khasawneh", "Bani Hani", "Khalifa", "Saad", "Hammad", "Daoud", "Issa", "Ayoub", "Salameh", "Najjar"];
const namesAr = ["الخطيب", "حجازي", "الطراونة", "المصري", "القضاة", "الشريف", "منصور", "حبش", "نمر", "الزعبي", "خصاونة", "بني هاني", "خليفة", "سعد", "حماد", "داود", "عيسى", "أيوب", "سلامة", "النجار"];

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function seededRand(seed: number) {
  let x = seed;
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}

export const pilots: Pilot[] = (() => {
  const out: Pilot[] = [];
  let pid = 1;
  for (const sqn of squadrons) {
    const count = sqn.enabled ? 12 + (pid % 6) : 0;
    const r = seededRand(pid * 31 + sqn.code.charCodeAt(0));
    for (let i = 0; i < count; i++) {
      const rk = ranks[Math.floor(r() * ranks.length)];
      const nIdx = Math.floor(r() * namesEn.length);
      const callSign = `${sqn.code}-${(i + 1).toString().padStart(2, "0")}`;
      const day = Math.floor(r() * 180) - 30;
      const night = Math.floor(r() * 180) - 30;
      const irt = Math.floor(r() * 180) - 30;
      const med = Math.floor(r() * 365) - 30;
      out.push({
        id: `pilot-${pid}`,
        callSign,
        rank: rk.en,
        rankAr: rk.ar,
        fullName: `${rk.en} ${namesEn[nIdx]}`,
        fullNameAr: `${rk.ar} ${namesAr[nIdx]}`,
        squadronId: sqn.id,
        monthlyHours: Math.round(r() * 35 * 10) / 10,
        grandTotalHours: 200 + Math.round(r() * 4500),
        nvgTotalHours: Math.round(r() * 800),
        dayCurrencyDate: dateOffset(day),
        nightCurrencyDate: dateOffset(night),
        irtCurrencyDate: dateOffset(irt),
        medicalCurrencyDate: dateOffset(med),
      });
      pid++;
    }
  }
  return out;
})();

export const licenseKeys: LicenseKey[] = [
  { id: "key-1", squadronId: "sqn-1", keyPreview: "EE-1FS-••••-A91X", status: "locked", issuedAt: "2025-11-04", expiresAt: "2026-11-04", lockedToDevice: "DESKTOP-OPS-1FS", lastSyncAt: "2026-04-16T09:14:00Z" },
  { id: "key-2", squadronId: "sqn-2", keyPreview: "EE-2AS-••••-K22M", status: "locked", issuedAt: "2025-12-11", expiresAt: "2028-12-11", lockedToDevice: "DESKTOP-OPS-2AS", lastSyncAt: "2026-04-15T18:02:00Z" },
  { id: "key-3", squadronId: "sqn-3", keyPreview: "EE-7RS-••••-Q77P", status: "active", issuedAt: "2026-02-20", expiresAt: "2026-08-20", lockedToDevice: null, lastSyncAt: null },
  { id: "key-4", squadronId: "sqn-4", keyPreview: "EE-9TS-••••-Z03B", status: "locked", issuedAt: "2026-01-08", expiresAt: "2027-01-08", lockedToDevice: "DESKTOP-OPS-9TS", lastSyncAt: "2026-04-14T11:55:00Z" },
  { id: "key-5", squadronId: "sqn-5", keyPreview: "EE-11TS-•••-D55F", status: "revoked", issuedAt: "2025-09-30", expiresAt: null, lockedToDevice: null, lastSyncAt: "2026-01-02T08:11:00Z" },
  { id: "key-6", squadronId: "sqn-6", keyPreview: "EE-14RS-•••-G18N", status: "locked", issuedAt: "2026-03-02", expiresAt: "2026-04-02", lockedToDevice: "DESKTOP-OPS-14RS", lastSyncAt: "2026-04-16T07:30:00Z" },
];

export const commanders: User[] = [
  { id: "u-c1", username: "commander1", displayName: "Lt.Col. Hassan", role: "commander", scope: "squadron", squadronIds: ["sqn-1"] },
  { id: "u-c2", username: "wing1", displayName: "Col. Awwad", role: "commander", scope: "wing", squadronIds: ["sqn-1", "sqn-2"] },
  { id: "u-c3", username: "base1", displayName: "Brig. Abu-Ghaida", role: "commander", scope: "base", squadronIds: ["sqn-3", "sqn-6"] },
  { id: "u-c4", username: "hq1", displayName: "Maj.Gen. Al-Otaibi", role: "commander", scope: "hq", squadronIds: squadrons.map(s => s.id) },
];

export const auditLog: AuditEntry[] = [
  { id: "a-1", timestamp: "2026-04-16T09:14:00Z", user: "ops_1FS", role: "ops_officer", action: "Sync flight log", target: "1FS / 4 pilots", ip: "10.4.12.18" },
  { id: "a-2", timestamp: "2026-04-16T08:51:00Z", user: "admin", role: "super_admin", action: "Generate license key", target: "7RS", ip: "10.0.1.4" },
  { id: "a-3", timestamp: "2026-04-15T22:10:00Z", user: "commander1", role: "commander", action: "View pilot detail", target: "1FS-04", ip: "10.5.22.91" },
  { id: "a-4", timestamp: "2026-04-15T20:02:00Z", user: "ops_2AS", role: "ops_officer", action: "Update monthly hours", target: "2AS-09", ip: "10.4.13.4" },
  { id: "a-5", timestamp: "2026-04-15T14:30:00Z", user: "admin", role: "super_admin", action: "Revoke license key", target: "11TS", ip: "10.0.1.4" },
  { id: "a-6", timestamp: "2026-04-15T11:08:00Z", user: "hq1", role: "commander", action: "Export overview report", target: "All squadrons", ip: "10.0.5.7" },
  { id: "a-7", timestamp: "2026-04-14T17:42:00Z", user: "admin", role: "super_admin", action: "Create commander account", target: "wing1", ip: "10.0.1.4" },
  { id: "a-8", timestamp: "2026-04-14T11:55:00Z", user: "ops_9TS", role: "ops_officer", action: "Sync currency dates", target: "9TS / 12 pilots", ip: "10.4.14.22" },
  { id: "a-9", timestamp: "2026-04-13T09:00:00Z", user: "base1", role: "commander", action: "Login", target: "—", ip: "10.5.22.10" },
  { id: "a-10", timestamp: "2026-04-12T16:22:00Z", user: "admin", role: "super_admin", action: "Login", target: "—", ip: "10.0.1.4" },
];

export const SUPER_ADMIN: User = {
  id: "u-admin",
  username: "admin",
  displayName: "System Owner",
  role: "super_admin",
  squadronIds: squadrons.map(s => s.id),
};
