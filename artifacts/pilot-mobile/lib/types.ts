export interface PilotProfile {
  id: string;
  militaryNumber: string;
  name: string;
  arabicName: string;
  rank: string;
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
}

export interface PilotSnapshot {
  profile: PilotProfile;
  sorties: SortieRecord[];
  fetchedAt: string;
}
