// Adapter between the real ops-officer roster (squadron-data.usePilots())
// and the shape the Commander dashboard pages expect (types.Pilot).
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
    nightCurrencyDate: real.expiry?.night ?? "",
    nvgCurrencyDate: real.expiry?.nvg ?? "",
    irtCurrencyDate: real.expiry?.irt ?? "",
    medicalCurrencyDate: real.expiry?.medical ?? "",
    qualifications: real.qualifications,
    lastSimDate: real.lastSimDate,
  };
}

export function useDashPilots(): DashPilot[] {
  const { user } = useAuth();
  const localQ = usePilots();
  const localRaw = localQ.data;
  const sqnId = resolveSquadronId(user);
  return useMemo(
    () => localRaw.map(p => adaptPilot(p, sqnId)),
    [localRaw, sqnId],
  );
}

// Guarantees the commander's authorized squadron is always represented in
// the list — even when `rjaf.squadrons` hasn't been populated on this PC
// yet.
export function useDashSquadrons(): Squadron[] {
  const { user, squadron } = useAuth();
  const list = useSquadrons();
  return useMemo(() => {
    const ids = user?.squadronIds ?? [];
    const out: Squadron[] = [...list];
    const ensure = (id: string) => {
      if (!id) return;
      if (out.some(s => s.id === id)) return;
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
    };
    for (const id of ids) ensure(id);
    return out;
  }, [list, user?.squadronIds, squadron?.name, squadron?.base]);
}
