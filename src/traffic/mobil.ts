// MOBIL lane-changing model (Kesting et al.). Pure decision function.
// Only the incentive/safety math lives here; gap measurement is the caller's job.
export interface MobilParams {
  politeness: number; // p ~ 0.2-0.3
  threshold: number;   // incentive threshold (m/s^2)
  safeDecel: number;   // max imposed braking on new follower (m/s^2)
}

export const MOBIL_DEFAULT: MobilParams = { politeness: 0.25, threshold: 0.3, safeDecel: 3.0 };

export interface MobilInputs {
  myAccel: number;       // my accel if I stay
  myNewAccel: number;    // my accel if I change
  oldFollowerAccel: number;    // follower behind me now: accel with me present
  oldFollowerNewAccel: number; // same follower: accel if I leave
  newFollowerAccel: number;    // follower on target lane: accel now
  newFollowerNewAccel: number; // same follower: accel with me as its leader
}

export function mobilDecision(inp: MobilInputs, p: MobilParams): { change: boolean; incentive: number } {
  const incentive =
    (inp.myNewAccel - inp.myAccel) +
    p.politeness * ((inp.newFollowerNewAccel - inp.newFollowerAccel) + (inp.oldFollowerNewAccel - inp.oldFollowerAccel));
  const safe = inp.newFollowerNewAccel >= -p.safeDecel;
  return { change: safe && incentive > p.threshold, incentive };
}
