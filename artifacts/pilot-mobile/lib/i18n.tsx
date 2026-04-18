import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";

import { loadPrefs, savePrefs } from "./storage";

export type Lang = "en" | "ar";

type Dict = Record<string, string>;

const EN: Dict = {
  app_name: "Pilot Logbook",
  link_title: "Link Your Profile",
  link_subtitle:
    "Enter your military number and the one-time code provided by your squadron operations officer.",
  link_militaryNumber: "Military Number",
  link_code: "Verification Code",
  link_submit: "Link Account",
  link_error_generic: "Could not link your profile.",
  link_error_not_found: "No pilot found with that military number.",
  link_error_bad_code: "Verification code is incorrect.",
  link_error_revoked: "Access has been revoked. Contact your operations officer.",
  link_demo_hint: "Tip: your military number and one-time code are issued by your squadron operations officer.",
  link_offline_warning: "Offline mode — not connected to the squadron operations server. Showing cached data only; new flights and currencies will not appear until connection is restored.",
  tab_home: "Home",
  tab_currency: "Currency",
  tab_log: "Flights",
  tab_settings: "Settings",
  home_greeting: "Welcome back",
  home_greet_morning: "Good morning",
  home_greet_afternoon: "Good afternoon",
  home_greet_evening: "Good evening",
  home_total_hours: "Total Hours",
  home_nvg_total: "NVG Total",
  home_month_hours: "This Month",
  home_captain: "Captain Hours",
  home_sortie_count: "Sorties this month",
  home_last_sync: "Last synced",
  home_refresh: "Refresh",
  home_offline: "Showing cached data",
  home_local: "Local",
  home_hrs: "Hrs",
  home_day: "Day",
  home_night: "Night",
  home_nvg: "NVG",
  home_sim: "Sim",
  home_h1: "1st Half",
  home_h2: "2nd Half",
  home_h1_hint: "Jan – Jun",
  home_h2_hint: "Jul – Dec",
  home_year: "This Year",
  home_breakdown_title: "Half-Year Breakdown",
  home_breakdown_hint: "Current calendar year",
  home_career_title: "Career Totals",
  home_career_hint: "Includes opening balances",
  home_col_day: "Day",
  home_col_night: "Night",
  home_col_nvg: "NVG",
  home_col_sim: "Sim",
  home_col_pic: "PIC",
  home_col_total: "Total",
  home_col_sorties: "Sorties",
  home_second_pilot: "Second Pilot",
  currency_title: "Currency",
  currency_days: "days",
  currency_expired: "Expired",
  currency_today: "Expires today",
  log_title: "Flight Log",
  log_empty: "No flights yet.",
  log_captain: "PIC",
  log_copilot: "Co",
  settings_profile: "Profile",
  settings_rank: "Rank",
  settings_unit: "Unit",
  settings_squadron: "Squadron",
  settings_military_number: "Military Number",
  settings_language: "Language",
  settings_backup: "Backup",
  settings_export_logbook: "Export my logbook",
  settings_export_logbook_hint: "Save or share a JSON copy of your profile and every sortie. Safe to keep on iCloud / Drive / email.",
  settings_export_failed: "Export failed",
  settings_logout: "Unlink this device",
  settings_logout_confirm: "Unlink this device? Cached data will be cleared.",
  settings_about: "About",
  settings_about_text:
    "Read-only viewer for your flight hours. All entries are made by your squadron operations officer.",
  settings_help: "Getting Started",
  help_step1_title: "1. Get your link code",
  help_step1_body: "Ask your squadron operations officer for your military number and a 6-digit verification code. Each code can be used once.",
  help_step2_title: "2. Link this device",
  help_step2_body: "Open the app and enter your military number and the code on the link screen. Your profile and history will sync from the squadron server.",
  help_step3_title: "3. Use the tabs",
  help_step3_body: "Home shows your totals and last sortie. Currency lists your day, night, NVG and medical expirations. Flights is your full logbook.",
  help_step4_title: "4. Stay in sync",
  help_step4_body: "The app refreshes automatically when you have a connection. Pull down on Home to refresh manually. If you see the offline notice, your data is from the last successful sync.",
  help_step5_title: "5. Need a change?",
  help_step5_body: "All edits — new sorties, currency renewals, leave — are entered by your squadron operations officer. Contact them for any correction.",
  help_step6_title: "Need help?",
  help_step6_body: "If you cannot link your device or your data looks wrong, contact the developer using the details below.",
  settings_credits: "Credits",
  credits_developer: "Developed by",
  credits_phone: "Phone",
  credits_email: "Email",
  credits_blurb: "For support, feedback, or questions about this app, please contact the developer.",
  cancel: "Cancel",
  confirm: "Confirm",
  not_set: "Not set",
  // Reminders
  currency_day: "Day",
  currency_night: "Night",
  currency_irt: "IRT",
  currency_medical: "Medical",
  currency_sim: "Simulator",
  reminders_title: "Reminders",
  reminders_settings_label: "Currency reminders",
  reminders_settings_hint: "Choose when each currency should remind you.",
  reminders_subtitle:
    "Pick how many days before each currency expires you want a push reminder. You can choose any combination of values per currency.",
  reminders_push_label: "Push notifications",
  reminders_push_on: "Enabled — you'll receive reminders.",
  reminders_push_off: "Off — turn on to receive reminders.",
  reminders_per_currency: "Per currency",
  reminders_chip_today: "On expiry",
  reminders_chip_day_suffix: "d",
  reminders_none: "No reminders set.",
  reminders_summary: "{n} reminder(s) set.",
  reminders_footnote:
    "Reminders fire once per expiry date. Tap a notification to jump to your Currency screen.",
  reminders_perm_title: "Notifications disabled",
  reminders_perm_body:
    "Allow notifications in your phone's settings to receive currency reminders.",
  reminders_open_settings: "Open Settings",
  reminders_unsupported:
    "Push notifications are not supported on this device.",
  reminders_no_project:
    "Push setup incomplete — contact your operations officer.",
  reminders_token_error: "Could not register for push notifications.",
  reminders_save_error: "Could not save your reminder settings.",
};

const AR: Dict = {
  app_name: "سجل الطيار",
  link_title: "ربط حسابك",
  link_subtitle:
    "أدخل رقمك العسكري ورمز التحقق لمرة واحدة الذي قدمه ضابط عمليات السرب.",
  link_militaryNumber: "الرقم العسكري",
  link_code: "رمز التحقق",
  link_submit: "ربط الحساب",
  link_error_generic: "تعذر ربط حسابك.",
  link_error_not_found: "لا يوجد طيار بهذا الرقم العسكري.",
  link_error_bad_code: "رمز التحقق غير صحيح.",
  link_error_revoked: "تم إلغاء الوصول. تواصل مع ضابط العمليات.",
  link_demo_hint: "ملاحظة: رقمك العسكري ورمز التحقق يصدرهما ضابط عمليات السرب.",
  link_offline_warning: "وضع عدم الاتصال — غير متصل بخادم عمليات السرب. يتم عرض البيانات المخزنة فقط؛ لن تظهر الطلعات والصلاحيات الجديدة حتى يُستعاد الاتصال.",
  tab_home: "الرئيسية",
  tab_currency: "الصلاحيات",
  tab_log: "الطلعات",
  tab_settings: "الإعدادات",
  home_greeting: "مرحباً بعودتك",
  home_greet_morning: "صباح الخير",
  home_greet_afternoon: "مساء الخير",
  home_greet_evening: "مساء الخير",
  home_total_hours: "مجموع الساعات",
  home_nvg_total: "مجموع NVG",
  home_month_hours: "هذا الشهر",
  home_captain: "ساعات قائد",
  home_sortie_count: "طلعات هذا الشهر",
  home_last_sync: "آخر مزامنة",
  home_refresh: "تحديث",
  home_offline: "عرض البيانات المخزنة",
  home_local: "محلي",
  home_hrs: "ساعة",
  home_day: "نهار",
  home_night: "ليل",
  home_nvg: "NVG",
  home_sim: "محاكاة",
  home_h1: "النصف الأول",
  home_h2: "النصف الثاني",
  home_h1_hint: "يناير – يونيو",
  home_h2_hint: "يوليو – ديسمبر",
  home_year: "هذه السنة",
  home_breakdown_title: "تفصيل نصف السنة",
  home_breakdown_hint: "السنة الميلادية الحالية",
  home_career_title: "الإجماليات الكلية",
  home_career_hint: "يشمل الرصيد الافتتاحي",
  home_col_day: "نهار",
  home_col_night: "ليل",
  home_col_nvg: "رؤية ليلية",
  home_col_sim: "محاكي",
  home_col_pic: "قائد",
  home_col_total: "المجموع",
  home_col_sorties: "طلعات",
  home_second_pilot: "مساعد طيار",
  currency_title: "الصلاحيات",
  currency_days: "يوم",
  currency_expired: "منتهي",
  currency_today: "ينتهي اليوم",
  log_title: "سجل الطلعات",
  log_empty: "لا توجد طلعات بعد.",
  log_captain: "قائد",
  log_copilot: "مساعد",
  settings_profile: "الملف الشخصي",
  settings_rank: "الرتبة",
  settings_unit: "الوحدة",
  settings_squadron: "السرب",
  settings_military_number: "الرقم العسكري",
  settings_language: "اللغة",
  settings_backup: "نسخة احتياطية",
  settings_export_logbook: "تصدير سجل الطلعات",
  settings_export_logbook_hint: "احفظ أو شارك نسخة JSON من ملفك الشخصي وكل طلعاتك. يمكن الاحتفاظ بها في iCloud أو Drive أو البريد.",
  settings_export_failed: "تعذّر التصدير",
  settings_logout: "إلغاء ربط هذا الجهاز",
  settings_logout_confirm: "إلغاء ربط هذا الجهاز؟ سيتم مسح البيانات المخزنة.",
  settings_about: "حول",
  settings_about_text:
    "عارض للقراءة فقط لساعات طيرانك. جميع الإدخالات يقوم بها ضابط عمليات السرب.",
  settings_help: "البدء السريع",
  help_step1_title: "١. احصل على رمز الربط",
  help_step1_body: "اطلب من ضابط عمليات السرب رقمك العسكري ورمز التحقق المكوّن من 6 خانات. كل رمز يُستخدم مرة واحدة فقط.",
  help_step2_title: "٢. اربط هذا الجهاز",
  help_step2_body: "افتح التطبيق وأدخل رقمك العسكري والرمز في شاشة الربط. سيتم مزامنة ملفك الشخصي وسجلك من خادم السرب.",
  help_step3_title: "٣. استخدم التبويبات",
  help_step3_body: "الرئيسية تعرض الإجماليات وآخر طلعة. الصلاحيات تعرض انتهاء النهار والليل وNVG والطبية. الطلعات سجلك الكامل.",
  help_step4_title: "٤. حافظ على المزامنة",
  help_step4_body: "يتحدّث التطبيق تلقائياً عند توفر الاتصال. اسحب للأسفل في الرئيسية لتحديث يدوي. عند ظهور إشعار عدم الاتصال، تكون البيانات من آخر مزامنة ناجحة.",
  help_step5_title: "٥. تحتاج تعديلاً؟",
  help_step5_body: "جميع التعديلات — الطلعات الجديدة وتجديد الصلاحيات والإجازات — يُدخلها ضابط عمليات السرب. تواصل معه لأي تصحيح.",
  help_step6_title: "بحاجة لمساعدة؟",
  help_step6_body: "إذا تعذّر ربط الجهاز أو ظهرت بيانات غير صحيحة، تواصل مع المطوّر عبر بيانات الاتصال أدناه.",
  settings_credits: "اعتمادات",
  credits_developer: "تطوير",
  credits_phone: "هاتف",
  credits_email: "بريد إلكتروني",
  credits_blurb: "للدعم أو الملاحظات أو الاستفسارات حول هذا التطبيق، يرجى التواصل مع المطوّر.",
  cancel: "إلغاء",
  confirm: "تأكيد",
  not_set: "غير محدد",
  // Reminders
  currency_day: "نهار",
  currency_night: "ليل",
  currency_irt: "IRT",
  currency_medical: "طبية",
  currency_sim: "محاكاة",
  reminders_title: "التذكيرات",
  reminders_settings_label: "تذكيرات الصلاحيات",
  reminders_settings_hint: "اختر متى يذكرك التطبيق بكل صلاحية.",
  reminders_subtitle:
    "حدد عدد الأيام قبل انتهاء كل صلاحية لتلقي تذكير. يمكنك اختيار أي مجموعة لكل صلاحية.",
  reminders_push_label: "الإشعارات",
  reminders_push_on: "مفعّلة — ستصلك التذكيرات.",
  reminders_push_off: "موقوفة — فعّلها لتلقي التذكيرات.",
  reminders_per_currency: "حسب الصلاحية",
  reminders_chip_today: "يوم الانتهاء",
  reminders_chip_day_suffix: "ي",
  reminders_none: "لا توجد تذكيرات.",
  reminders_summary: "{n} تذكير(ات).",
  reminders_footnote:
    "يُرسل كل تذكير مرة واحدة لكل تاريخ انتهاء. اضغط الإشعار للانتقال إلى شاشة الصلاحيات.",
  reminders_perm_title: "الإشعارات معطلة",
  reminders_perm_body:
    "اسمح بالإشعارات من إعدادات الجهاز لتلقي تذكيرات الصلاحيات.",
  reminders_open_settings: "فتح الإعدادات",
  reminders_unsupported:
    "الإشعارات الفورية غير مدعومة على هذا الجهاز.",
  reminders_no_project:
    "إعداد الإشعارات غير مكتمل — تواصل مع ضابط العمليات.",
  reminders_token_error: "تعذر تسجيل الإشعارات الفورية.",
  reminders_save_error: "تعذر حفظ إعدادات التذكيرات.",
};

const DICTS: Record<Lang, Dict> = { en: EN, ar: AR };

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: keyof typeof EN | string) => string;
  isRTL: boolean;
  ready: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadPrefs().then((p) => {
      setLangState(p.language);
      setReady(true);
    });
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    void savePrefs({ language: l });
  }, []);

  const t = useCallback(
    (key: string) => {
      const dict = DICTS[lang] ?? EN;
      return dict[key] ?? EN[key] ?? key;
    },
    [lang]
  );

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t, isRTL: lang === "ar", ready }),
    [lang, setLang, t, ready]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be used inside <I18nProvider>");
  return v;
}
