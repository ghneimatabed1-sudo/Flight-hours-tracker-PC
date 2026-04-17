import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";

export type Lang = "en" | "ar";

const dict = {
  en: {
    appName: "RJAF Squadron Ops",
    appTag: "Royal Jordanian Air Force — Squadron Management System",
    licenseTitle: "License Activation",
    licensePrompt: "Enter the license key issued by the Super Admin.",
    licenseKey: "License Key",
    activate: "Activate",
    bindNotice: "This key will be locked to this PC's hardware fingerprint.",
    loginTitle: "Operations Officer Login",
    username: "Username",
    password: "Password",
    signIn: "Sign In",
    badCreds: "Invalid credentials.",
    lockedOut: "Account temporarily locked. Try again later.",
    logout: "Logout",
    setupTitle: "Squadron Setup",
    setupHint: "Configure this installation. You can change these later in Settings.",
    sqdnName: "Squadron Name",
    sqdnNumber: "Squadron Number",
    base: "Base",
    save: "Save",
    cancel: "Cancel",
    language: "Language",
    arabic: "العربية",
    english: "English",
    online: "Online",
    offline: "Offline (queued)",
    syncing: "Syncing…",

    // Nav
    nav_dashboard: "Dashboard",
    nav_sortielog: "Squadron Sortie Log",
    nav_addsortie: "Add Sortie",
    nav_roster: "Pilot Roster",
    nav_currency: "Currency Views",
    nav_expired: "Expired After Report",
    nav_rankings: "Rankings & Totals",
    nav_cycle: "6-Month Cycle",
    nav_leaves: "Leaves",
    nav_unavail: "Unavailable Pilots",
    nav_duty: "Duty Week",
    nav_schedule: "Flight Schedule",
    nav_risk: "Risk Assessment",
    nav_coord: "Coordinating Form",
    nav_notams: "NOTAMs",
    nav_navroutes: "Nav Routes",
    nav_units: "Pilot Unit Manager",
    nav_pdf: "PDF Exports",
    nav_users: "User Manager",
    nav_settings: "Settings",
    nav_audit: "Audit Log",

    // Dashboard
    monthlyTotals: "Monthly Squadron Totals",
    expiringAlert: "Expiring / Expired Currencies",
    dayHrs: "Day Hours",
    nightHrs: "Night Hours",
    nvgHrs: "NVG Hours",
    simHrs: "Sim Hours",
    sortiesMonth: "Sorties This Month",
    pilotsAvail: "Pilots Available",
    addSortie: "Add Sortie",
    viewAll: "View All",

    // Sortie
    date: "Date",
    acType: "A/C Type",
    acNumber: "A/C No",
    pilot: "Pilot",
    coPilot: "Co-Pilot",
    sortieType: "Sortie Type",
    sortieName: "Sortie / Flight Name",
    day1: "Day 1st PLT",
    day2: "Day 2nd PLT",
    dayDual: "Day Dual",
    night1: "Night 1st PLT",
    night2: "Night 2nd PLT",
    nightDual: "Night Dual",
    nvg: "NVG",
    sim: "Sim",
    actual: "Actual",
    submit: "Submit Sortie",

    // Roster fields
    name: "Name",
    arabicName: "Arabic Name",
    rank: "Rank",
    phone: "Phone",
    address: "Address",
    openingDay: "Opening Day Hrs",
    openingNight: "Opening Night Hrs",
    openingNvg: "Opening NVG Hrs",
    doctorNote: "Doctor Note",
    add: "Add",
    edit: "Edit",
    delete: "Delete",
    actions: "Actions",
    status: "Status",
    expiry: "Expiry",
    expiresIn: "Expires in",
    days: "days",
    expired: "EXPIRED",

    // Common
    search: "Search…",
    filter: "Filter",
    all: "All",
    sqdn: "SQDN",
    attached: "Attached",
    none: "—",
    save_changes: "Save Changes",
    confirm: "Confirm",

    bigPlaceholder: "Production data syncs from Supabase. Mock data shown for demo.",
  },
  ar: {
    appName: "عمليات السرب — القوات الجوية الملكية الأردنية",
    appTag: "نظام إدارة السرب — القوات الجوية الملكية الأردنية",
    licenseTitle: "تفعيل الترخيص",
    licensePrompt: "أدخل مفتاح الترخيص الصادر من المشرف العام.",
    licenseKey: "مفتاح الترخيص",
    activate: "تفعيل",
    bindNotice: "سيتم ربط هذا المفتاح ببصمة جهاز هذا الحاسوب.",
    loginTitle: "تسجيل دخول ضابط العمليات",
    username: "اسم المستخدم",
    password: "كلمة المرور",
    signIn: "دخول",
    badCreds: "بيانات اعتماد غير صحيحة.",
    lockedOut: "تم قفل الحساب مؤقتاً. حاول لاحقاً.",
    logout: "خروج",
    setupTitle: "إعداد السرب",
    setupHint: "قم بإعداد هذا التثبيت. يمكنك تغييره لاحقاً من الإعدادات.",
    sqdnName: "اسم السرب",
    sqdnNumber: "رقم السرب",
    base: "القاعدة",
    save: "حفظ",
    cancel: "إلغاء",
    language: "اللغة",
    arabic: "العربية",
    english: "English",
    online: "متصل",
    offline: "غير متصل (في الانتظار)",
    syncing: "جاري المزامنة…",

    nav_dashboard: "لوحة المعلومات",
    nav_sortielog: "سجل طلعات السرب",
    nav_addsortie: "إضافة طلعة",
    nav_roster: "قائمة الطيارين",
    nav_currency: "صلاحيات الطيران",
    nav_expired: "تقرير المنتهية الصلاحية",
    nav_rankings: "الترتيب والإجماليات",
    nav_cycle: "دورة الستة أشهر",
    nav_leaves: "الإجازات",
    nav_unavail: "الطيارون غير المتاحين",
    nav_duty: "أسبوع المناوبة",
    nav_schedule: "جدول الطيران",
    nav_risk: "تقييم المخاطر",
    nav_coord: "نموذج التنسيق",
    nav_notams: "نوتامات",
    nav_navroutes: "مسارات الملاحة",
    nav_units: "تصنيف الطيارين",
    nav_pdf: "تصدير PDF",
    nav_users: "إدارة المستخدمين",
    nav_settings: "الإعدادات",
    nav_audit: "سجل التدقيق",

    monthlyTotals: "إجماليات السرب الشهرية",
    expiringAlert: "صلاحيات منتهية / تنتهي قريباً",
    dayHrs: "ساعات نهارية",
    nightHrs: "ساعات ليلية",
    nvgHrs: "ساعات NVG",
    simHrs: "ساعات Sim",
    sortiesMonth: "طلعات هذا الشهر",
    pilotsAvail: "الطيارون المتاحون",
    addSortie: "إضافة طلعة",
    viewAll: "عرض الكل",

    date: "التاريخ",
    acType: "نوع الطائرة",
    acNumber: "رقم الطائرة",
    pilot: "الطيار",
    coPilot: "الطيار المساعد",
    sortieType: "نوع الطلعة",
    sortieName: "اسم الطلعة / المهمة",
    day1: "نهار طيار أول",
    day2: "نهار طيار ثاني",
    dayDual: "نهار مزدوج",
    night1: "ليلي طيار أول",
    night2: "ليلي طيار ثاني",
    nightDual: "ليلي مزدوج",
    nvg: "NVG",
    sim: "محاكي",
    actual: "فعلي",
    submit: "تسجيل الطلعة",

    name: "الاسم",
    arabicName: "الاسم بالعربية",
    rank: "الرتبة",
    phone: "الهاتف",
    address: "العنوان",
    openingDay: "رصيد افتتاحي نهاري",
    openingNight: "رصيد افتتاحي ليلي",
    openingNvg: "رصيد افتتاحي NVG",
    doctorNote: "ملاحظة الطبيب",
    add: "إضافة",
    edit: "تعديل",
    delete: "حذف",
    actions: "إجراءات",
    status: "الحالة",
    expiry: "تاريخ الانتهاء",
    expiresIn: "تنتهي خلال",
    days: "أيام",
    expired: "منتهية",

    search: "بحث…",
    filter: "تصفية",
    all: "الكل",
    sqdn: "السرب",
    attached: "ملحق",
    none: "—",
    save_changes: "حفظ التعديلات",
    confirm: "تأكيد",

    bigPlaceholder: "تتم مزامنة البيانات من Supabase. البيانات المعروضة للعرض التوضيحي.",
  },
} as const;

type Dict = typeof dict.en;
export type Key = keyof Dict;

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
  dir: "ltr" | "rtl";
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem("rjaf.lang") as Lang) || "en");
  const setLang = (l: Lang) => { localStorage.setItem("rjaf.lang", l); setLangState(l); };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const value = useMemo<I18nCtx>(() => ({
    lang,
    setLang,
    dir: lang === "ar" ? "rtl" : "ltr",
    t: (k: Key) => (dict[lang] as Dict)[k] ?? (dict.en[k] as string) ?? String(k),
  }), [lang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be inside I18nProvider");
  return v;
}
