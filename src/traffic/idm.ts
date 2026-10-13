// Intelligent Driver Model (IDM) — car following.
// Treiber & Kesting. Pure function: (v, v0, gap, dv) -> acceleration (m/s^2).
// v: own speed, v0: desired speed, gap: bumper-to-bumper distance ahead,
// dv: approaching rate (v - v_leader), p: parameters.
export interface IdmParams {
  T: number;  // desired time headway (s)
  s0: number; // minimum gap (m)
  a: number;  // max acceleration (m/s^2)
  b: number;  // comfortable deceleration (m/s^2)
}

export const CAR_IDM: IdmParams = { T: 1.2, s0: 2.0, a: 1.4, b: 2.2 };
export const VAN_IDM: IdmParams = { T: 1.4, s0: 2.5, a: 0.9, b: 2.0 };

const MAX_DECEL = 8; // emergency clamp

export function idmAccel(v: number, v0: number, gap: number, dv: number, p: IdmParams): number {
  if (v0 <= 0.01) return -Math.min(MAX_DECEL, Math.max(0, v) * 2);
  if (!isFinite(gap) || gap > 400) {
    // free road
    return p.a * (1 - Math.pow(Math.max(0, v) / v0, 4));
  }
  const g = Math.max(0.05, gap);
  const sStar = p.s0 + Math.max(0, v) * p.T + (Math.max(0, v) * dv) / (2 * Math.sqrt(p.a * p.b));
  const acc = p.a * (1 - Math.pow(Math.max(0, v) / v0, 4) - (sStar / g) * (sStar / g));
  return Math.max(-MAX_DECEL, Math.min(p.a, acc));
}
