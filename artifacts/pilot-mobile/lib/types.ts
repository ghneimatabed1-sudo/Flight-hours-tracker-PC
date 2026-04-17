export interface PilotProfile {
  id: string;
  militaryNumber: string;
  name: string;
  arabicName: string;
  rank: string;
  // Personal flight name / handle the pilot is known by within the squadron.
  // Purely a display field — shown as a subtitle on the home screen.
  flightName?: string;
  unit: string;
  squadron: string;
  phone?: string;
  openingDay: number;
  openingNight: number;
  openingNvg: number;
  openingCaptain: number;
  openingSim: number;
  expiry: {
    day: string;
    night: string;
    irt: string;
    medical: string;
    sim: string;
  };
}

export interface SortieRecord {
  id: string;
  date: string;
  acType: string;
  acNumber: string;
  sortieType: string;
  name: string;
  pilotIsCaptain: boolean;
  day: number;
  night: number;
  nvg: number;
  sim: number;
  total: number;
  condition?: "Day" | "Night" | "NVG";
  remarks?: string;
}

export interface PilotSnapshot {
  profile: PilotProfile;
  sorties: SortieRecord[];
  fetchedAt: string;
}
