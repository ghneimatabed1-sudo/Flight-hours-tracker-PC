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
  link_demo_hint: "Demo: military number P001, code 123456.",
  link_offline_warning: "Working offline — Supabase is not configured. Demo data only.",
  tab_home: "Home",
  tab_currency: "Currency",
  tab_log: "Flights",
  tab_settings: "Settings",
  home_greeting: "Welcome back",
  home_total_hours: "Total Hours",
  home_nvg_total: "NVG Total",
  home_month_hours: "This Month",
  home_captain: "Captain Hours",
  home_sortie_count: "Sorties this month",
  home_last_sync: "Last synced",
  home_refresh: "Refresh",
  home_offline: "Showing cached data",
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
  settings_logout: "Unlink this device",
  settings_logout_confirm: "Unlink this device? Cached data will be cleared.",
  settings_about: "About",
  settings_about_text:
    "Read-only viewer for your flight hours. All entries are made by your squadron operations officer.",
  cancel: "Cancel",
  confirm: "Confirm",
  not_set: "Not set",
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
  link_demo_hint: "تجريبي: الرقم العسكري P001، الرمز 123456.",
  link_offline_warning: "العمل دون اتصال — لم يتم تكوين Supabase. بيانات تجريبية فقط.",
  tab_home: "الرئيسية",
  tab_currency: "الصلاحيات",
  tab_log: "الطلعات",
  tab_settings: "الإعدادات",
  home_greeting: "مرحباً بعودتك",
  home_total_hours: "مجموع الساعات",
  home_nvg_total: "مجموع NVG",
  home_month_hours: "هذا الشهر",
  home_captain: "ساعات قائد",
  home_sortie_count: "طلعات هذا الشهر",
  home_last_sync: "آخر مزامنة",
  home_refresh: "تحديث",
  home_offline: "عرض البيانات المخزنة",
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
  settings_logout: "إلغاء ربط هذا الجهاز",
  settings_logout_confirm: "إلغاء ربط هذا الجهاز؟ سيتم مسح البيانات المخزنة.",
  settings_about: "حول",
  settings_about_text:
    "عارض للقراءة فقط لساعات طيرانك. جميع الإدخالات يقوم بها ضابط عمليات السرب.",
  cancel: "إلغاء",
  confirm: "تأكيد",
  not_set: "غير محدد",
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
