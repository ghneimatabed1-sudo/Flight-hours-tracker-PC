// Mock dataset that mimics what the Supabase backend would return.
// All component code reads from these helpers so swapping in the real
// Supabase client is a single-file change.

export interface Pilot {
  id: string;
  name: string;
  arabicName: string;
  rank: string;
  phone: string;
  address: string;
  unit: "SQDN" | "HQ Attached" | "Other" | "UH-60M" | "UH-60AIL" | "Both" | "RCN";
  openingDay: number;
  openingNight: number;
  openingNvg: number;
  doctorNote?: string;
  monthDay: number;
  monthNight: number;
  monthNvg: number;
  monthSim: number;
  monthCaptain: number;
  totalDay: number;
  totalNight: number;
  totalNvg: number;
  totalSim: number;
  totalCaptain: number;
  expiry: {
    day: string;
    night: string;
    irt: string;
    medical: string;
    sim: string;
  };
  available: boolean;
}

export interface Sortie {
  id: string;
  date: string;
  acType: string;
  acNumber: string;
  pilotId: string;
  coPilotId: string;
  sortieType: string;
  name: string;
  day1: number;
  day2: number;
  dayDual: number;
  night1: number;
  night2: number;
  nightDual: number;
  nvg: number;
  sim: number;
  actual: number;
}

const RANKS = ["Maj", "Capt", "1st Lt", "Lt Col"];
const NAMES: [string, string][] = [
  ["Tariq Al-Masri", "طارق المصري"],
  ["Omar Haddad", "عمر حداد"],
  ["Khalid Saleh", "خالد صالح"],
  ["Yousef Nimer", "يوسف نمر"],
  ["Bashar Khoury", "بشار خوري"],
  ["Mahmoud Anani", "محمود عناني"],
  ["Faris Tabbaa", "فارس طباع"],
  ["Sami Bdeir", "سامي بدير"],
  ["Hani Qutaishat", "هاني قطيشات"],
  ["Ziad Murad", "زياد مراد"],
  ["Adnan Issa", "عدنان عيسى"],
  ["Nader Awwad", "نادر عواد"],
  ["Rami Tarawneh", "رامي طراونة"],
  ["Saleem Hijazi", "سليم حجازي"],
  ["Walid Sharaiha", "وليد شريحة"],
  ["Iyad Abu-Ghazaleh", "إياد أبو غزالة"],
];

const UNITS: Pilot["unit"][] = ["SQDN", "SQDN", "SQDN", "SQDN", "HQ Attached", "UH-60M", "UH-60AIL", "Both", "RCN", "Other"];

function daysFromNow(d: number): string {
  const t = new Date();
  t.setDate(t.getDate() + d);
  return t.toISOString().slice(0, 10);
}

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
const r = rand(42);

export const PILOTS: Pilot[] = NAMES.map((n, i) => {
  const md = +(20 + r() * 25).toFixed(1);
  const mn = +(8 + r() * 18).toFixed(1);
  const mv = +(5 + r() * 14).toFixed(1);
  const ms = +(0 + r() * 6).toFixed(1);
  const mc = +(md * 0.7).toFixed(1);
  return {
    id: "P" + String(i + 1).padStart(3, "0"),
    name: n[0],
    arabicName: n[1],
    rank: RANKS[i % RANKS.length],
    phone: "079" + String(1000000 + Math.floor(r() * 9_000_000)),
    address: "Amman",
    unit: UNITS[i % UNITS.length],
    openingDay: +(800 + r() * 1500).toFixed(1),
    openingNight: +(120 + r() * 400).toFixed(1),
    openingNvg: +(60 + r() * 250).toFixed(1),
    doctorNote: i % 7 === 0 ? "Cleared with annotation" : undefined,
    monthDay: md, monthNight: mn, monthNvg: mv, monthSim: ms, monthCaptain: mc,
    totalDay: +(800 + r() * 1500 + md * 4).toFixed(1),
    totalNight: +(120 + r() * 400 + mn * 4).toFixed(1),
    totalNvg: +(60 + r() * 250 + mv * 4).toFixed(1),
    totalSim: +(20 + r() * 60).toFixed(1),
    totalCaptain: +(500 + r() * 1200).toFixed(1),
    expiry: {
      day: daysFromNow(Math.floor(r() * 200) - 30),
      night: daysFromNow(Math.floor(r() * 180) - 20),
      irt: daysFromNow(Math.floor(r() * 220) - 10),
      medical: daysFromNow(Math.floor(r() * 320) - 40),
      sim: daysFromNow(Math.floor(r() * 200) - 25),
    },
    available: i % 11 !== 0,
  };
});

const AC_TYPES = ["UH-60M", "UH-60L", "UH-60AIL", "AS332"];
const SORTIE_TYPES = ["Training", "Mission", "Check Ride", "FCF", "Transport"];
const NAMES_FLT = ["NAV", "EMER", "GH", "IF", "NF", "MTF", "NVG", "MSN DAY", "MSN NVG", "EVAL"];

export const SORTIES: Sortie[] = Array.from({ length: 80 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(r() * 60));
  const isNvg = r() > 0.7;
  const isNight = !isNvg && r() > 0.6;
  const dur = +(0.8 + r() * 2.4).toFixed(1);
  const a = NAMES[Math.floor(r() * NAMES.length)];
  const b = NAMES[Math.floor(r() * NAMES.length)];
  return {
    id: "S" + String(10000 + i),
    date: d.toISOString().slice(0, 10),
    acType: AC_TYPES[Math.floor(r() * AC_TYPES.length)],
    acNumber: String(800 + Math.floor(r() * 70)),
    pilotId: "P" + String((NAMES.indexOf(a) + 1)).padStart(3, "0"),
    coPilotId: "P" + String((NAMES.indexOf(b) + 1)).padStart(3, "0"),
    sortieType: SORTIE_TYPES[Math.floor(r() * SORTIE_TYPES.length)],
    name: NAMES_FLT[Math.floor(r() * NAMES_FLT.length)],
    day1: !isNvg && !isNight ? dur : 0,
    day2: 0,
    dayDual: 0,
    night1: isNight ? dur : 0,
    night2: 0,
    nightDual: 0,
    nvg: isNvg ? dur : 0,
    sim: 0,
    actual: dur,
  };
});

export const NOTAMS = [
  { id: "N0001", date: daysFromNow(-1), text: "OJAM RWY 26L closed 0800-1200Z for inspection." },
  { id: "N0002", date: daysFromNow(-3), text: "TFR established WP-Charlie sector, FL080-FL120, all VFR ops require coordination." },
  { id: "N0003", date: daysFromNow(-6), text: "Marka tower frequency change to 118.10 effective 0001Z." },
];

export const DUTY_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu"].map((d, i) => ({
  day: d,
  mainDuty: PILOTS[i].name,
  standby: PILOTS[(i + 5) % PILOTS.length].name,
  rcm: PILOTS[(i + 9) % PILOTS.length].name,
}));

export const SIX_MONTH_TASKS = [
  "GH", "IF", "NF", "NVG", "MTF", "NAV", "NAV FOR", "EMER", "EVAL",
  "MSN DAY", "MSN NVG", "CRS DAY", "CRS NVG", "GP.C DAY", "CPC NVG",
];
