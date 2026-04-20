// Adapter between the real ops-officer roster (squadron-data.usePilots())
// and the shape the Commander dashboard pages expect (types.Pilot).
//
// HISTORY (v1.0.45): Every Commander page — Overview, PilotsTable,
// Currencies, Alerts, PilotDetail, Simulator — imported the empty static
// `pilots` array from `mockData.ts`. Result: a commander signing in on
// the same PC the ops officer was using would see an empty roster, zero
// currencies, zero alerts — completely disconnected from reality. This
// module bridges the two shapes so commanders see the LIVE roster the
// ops officer just built.
//
// Real Pilot (squadron-data / mock.ts) uses `name`, `arabicName`,
// `expiry.{day,night,nvg,irt,medical}`, `monthDay/Night/Nvg`,
// `totalDay/Night/Nvg`. Dashboard Pilot (types.ts) uses `fullName`,
// `fullNameAr`, `dayCurrencyDate` etc. and a `squadronId` field that
// doesn't exist on the real type — this PC is bound to a single squadron
// so we stamp every pilot with the commander's authorized squadron ID.

import { useMemo } from "react";
import { useAuth } from "./auth";
import { usePilots, type Pilot as RealPilot } from "./squadron-data";
import { useSquadrons } from "./squadron-store";
import type { Pilot as DashPilot, Squadron } from "./types";

// Resolve which squadronId to stamp on every pilot for the signed-in
// commander. Priority:
//   1. The commander's first authorized squadron (from license / account).
//   2. The PC's bound squadron id (set at license activation).
//   3. "SQDN" — a stable sentinel used by the synthetic squadron fallback.
function resolveSquadronId(user: { squadronIds?: string[] } | null): string {
  const first = user?.squadronIds?.[0];
  if (first) return first;
  try {
    const bound = localStorage.getItem("rjaf.squadronId");
    if (bound) return bound;
  } catch { /* noop */ }
  return "SQDN";
}

export function adaptPilot(real: RealPilot, squadronId: string): DashPilot {
  const monthly =
    Number(real.monthDay ?? 0) +
    Number(real.monthNight ?? 0) +
    Number(real.monthNvg ?? 0);
  const grand =
    Number(real.totalDay ?? 0) +
    Number(real.totalNight ?? 0) +
    Number(real.totalNvg ?? 0);
  return {
    id: real.id,
    callSign: real.callSign ?? "",
    flightName: real.flightName,
    rank: real.rank ?? "",
    rankAr: real.rank ?? "",
    fullName: real.name ?? "",
    fullNameAr: real.arabicName || real.name || "",
    squadronId,
    monthlyHours: monthly,
    grandTotalHours: grand,
    nvgTotalHours: Number(real.totalNvg ?? 0),
    dayHours: Number(real.totalDay ?? 0),
    nightHours: Number(real.totalNight ?? 0),
    simHours: Number(real.totalSim ?? 0),
    captainHours: Number(real.totalCaptain ?? 0),
    instrumentHours: undefined,
    dayCurrencyDate: real.expiry?.day ?? "",
    // The Commander roster column labelled "NVG" historically read from
    // `nightCurrencyDate`. Since Night and NVG are separate currencies and
    // the column the commander actually cares about is NVG, we wire
    // nightCurrencyDate → expiry.nvg so the badge matches its label.
    nightCurrencyDate: real.expiry?.nvg ?? real.expiry?.night ?? "",
    irtCurrencyDate: real.expiry?.irt ?? "",
    medicalCurrencyDate: real.expiry?.medical ?? "",
    qualifications: real.qualifications,
    lastSimDate: real.lastSimDate,
  };
}

export function useDashPilots(): DashPilot[] {
  const { user } = useAuth();
  const q = usePilots();
  const raw = q.data;
  const sqnId = resolveSquadronId(user);
  return useMemo(() => raw.map(p => adaptPilot(p, sqnId)), [raw, sqnId]);
}

// Guarantees the commander's authorized squadron is always represented in
// the list — even when `rjaf.squadrons` hasn't been populated on this PC
// yet. Without this, `squadrons.filter(s => myIds.has(s.id))` comes back
// empty and the Overview page renders zero squadron cards.
export function useDashSquadrons(): Squadron[] {
  const { user, squadron } = useAuth();
  const list = useSquadrons();
  return useMemo(() => {
    const ids = user?.squadronIds ?? [];
    if (ids.length === 0) return list;
    const out: Squadron[] = [...list];
    for (const id of ids) {
      if (out.some(s => s.id === id)) continue;
      out.push({
        id,
        name: squadron?.name || id,
        nameAr: squadron?.name || id,
        code: id,
        base: squadron?.base || "",
        baseAr: squadron?.base || "",
        wing: "",
        wingAr: "",
        enabled: true,
        keyHolder: null,
      });
    }
    return out;
  }, [list, user?.squadronIds, squadron?.name, squadron?.base]);
}
