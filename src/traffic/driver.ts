// Driver brain: per-vehicle decisions at junctions. Pure functions.
// Irish priority rules: stop < yield < yield-right < uncontrolled(major).
// Left-hand traffic throughout.
import { idmAccel } from './idm.js';
import { LaneEvent, NetIndex, Vehicle, Indicator } from './types.js';

export function controlRank(kind: string | undefined): number {
  switch (kind) {
    case 'stop': return 0;
    case 'yield': return 1;
    case 'yield-right': return 2;
    case 'roundabout-entry': return 0;
    default: return 3; // uncontrolled approach = major road
  }
}

export interface OtherVeh {
  id: number; x: number; y: number; v: number; heading: number;
  eventJunction: string | null; // their upcoming event's junction (if near it)
  eta: number;                  // their ETA to that junction (s)
  rank: number;
  kind: string | undefined;
  waitStart: number | null;
  committed: boolean;
}

export interface DecisionCtx {
  time: number;
  myId: number;
  myKind: string | undefined;
  myRank: number;
  myEta: number;
  myWaitStart: number | null;
  myHeading: number;
  myX: number; myY: number;
  occupied: boolean;        // another vehicle inside the junction zone
  circulatingNear: boolean; // roundabout: circulating vehicle near entry
  others: OtherVeh[];       // vehicles approaching the same junction
}

// May I enter the junction now?
export function junctionDecision(ctx: DecisionCtx): 'go' | 'wait' {
  if (ctx.occupied) return 'wait';
  if (ctx.circulatingNear) return 'wait';
  const creeping = ctx.myWaitStart != null && ctx.time - ctx.myWaitStart > 10;
  const myHx = Math.cos(ctx.myHeading), myHy = Math.sin(ctx.myHeading);
  for (const o of ctx.others) {
    if (o.committed) return 'wait'; // they're going — stay clear
    if (creeping) {
      if (o.eta < 1.2) return 'wait';
      continue;
    }
    if (o.rank > ctx.myRank) return 'wait'; // they have priority
    if (o.rank === ctx.myRank) {
      // first to arrive goes; deterministic tiebreak on id
      if (o.waitStart != null && (ctx.myWaitStart == null || o.waitStart < ctx.myWaitStart - 0.5)) return 'wait';
      const bothMoving = o.waitStart == null && ctx.myWaitStart == null;
      if (bothMoving) {
        if (o.eta < ctx.myEta - 0.5) return 'wait';
        if (Math.abs(o.eta - ctx.myEta) <= 0.5 && o.id < ctx.myId) return 'wait';
      }
      // Irish give-way-to-the-right at equal priority
      if (ctx.myKind === 'yield-right' || o.kind === 'yield-right') {
        const dx = o.x - ctx.myX, dy = o.y - ctx.myY;
        const d = Math.hypot(dx, dy) || 1;
        const cross = myHx * (dy / d) - myHy * (dx / d); // <0 => other is to my right
        const dot = myHx * (dx / d) + myHy * (dy / d);
        if (cross < -0.25 && dot > -0.4 && o.eta <= ctx.myEta + 1.5) return 'wait';
      }
    }
  }
  return 'go';
}

// IDM accel treating a stop/yield line as a stationary obstacle.
// distToLine: front-bumper distance to the line (m).
export function stopLineAccel(v: number, v0: number, distToLine: number, maxAccel: number): number {
  return idmAccel(v, v0, Math.max(0.05, distToLine), v, { T: 1.0, s0: 0.6, a: maxAccel, b: 2.4 });
}

export function indicatorFor(v: Vehicle, ev: LaneEvent | null, _idx: NetIndex): Indicator {
  void _idx;
  if (v.changeTarget) return v.changeShift > 0 ? 'left' : 'right';
  if (ev && v.route.length > 1) {
    const step = v.route[1];
    if (step.via === ev.junctionId) {
      const out = ev.outs.find(o => o.to === step.laneId);
      if (out) {
        switch (out.kind) {
          case 'left': return 'left';
          case 'right': return 'right';
          case 'roundabout-entry': return 'right';
          case 'roundabout-exit': return 'left';
          case 'circulate': return 'right';
          default: return 'off';
        }
      }
    }
  }
  return 'off';
}
