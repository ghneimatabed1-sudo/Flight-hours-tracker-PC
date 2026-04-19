// Resolve which roster pilot a guest sortie should credit. Names collide
// constantly across the RJAF (multiple "Ahmad Khalil"s, etc.) so we always
// prefer the military number when the hosting squadron supplied one. Name
// matching stays as a last-ditch fallback for legacy guest entries that
// were submitted before military numbers were captured on the mobile app.

export interface GuestMatchCandidate {
  id: string;
  name: string;
  rank?: string;
  militaryNumber?: string;
}

const normName = (s: string) =>
  s.toLowerCase().replace(/[^a-z\u0600-\u06ff]+/g, "");

const normMil = (s: string | undefined | null) =>
  (s ?? "").toString().trim().toLowerCase().replace(/^0+/, "");

export function matchGuestPilot<P extends GuestMatchCandidate>(
  pilots: readonly P[],
  guest: { name: string; militaryNumber?: string },
): P | undefined {
  const milKey = normMil(guest.militaryNumber);
  if (milKey) {
    const byMil = pilots.find(p => normMil(p.militaryNumber) === milKey);
    if (byMil) return byMil;
    // Military number was supplied but no roster pilot matches it. Don't
    // silently fall back to a name guess — that's exactly the wrong-credit
    // bug we're trying to prevent. The ops officer will be forced to pick
    // manually from the dropdown, which is the safe outcome.
    return undefined;
  }
  const n = normName(guest.name);
  if (!n) return undefined;
  return pilots.find(p =>
    normName(`${p.rank ?? ""} ${p.name}`).includes(n) || n.includes(normName(p.name)),
  );
}
