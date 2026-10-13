// Shared traffic-sim types. DOM-free.
import { XY, Lane, Segment, Junction, JunctionControl, TurnConnection } from '../road/types.js';

export interface IndexedLane {
  id: string;
  segId: string;
  dir: 1 | -1;
  index: number;
  offsetM: number;
  pts: XY[];
  cum: number[];
  length: number;
  speedMs: number;
  seg: Segment;
  lane: Lane;
}

// One decision point along a lane: a junction the lane passes through.
export interface LaneEvent {
  arc: number;                 // travel-arc of the junction on this lane
  junctionId: string;
  jx: number; jy: number;      // junction centre (world)
  control?: JunctionControl;   // priority control for this lane here
  outs: TurnConnection[];      // connections from this lane via this junction
  stopArc: number;             // arc at which to halt for the control
  entryKinds: Set<string>;     // kinds of outs (for roundabout-entry detection)
}

export interface NetIndex {
  lanes: Map<string, IndexedLane>;
  events: Map<string, LaneEvent[]>;   // laneId -> events sorted by arc
  adj: Map<string, TurnConnection[]>; // fromLaneId -> all connections
  junctionById: Map<string, Junction>;
  segById: Map<string, Segment>;
  roundaboutLanes: Set<string>;
  /** Junctions within 15m (same physical intersection, multiple OSM nodes). */
  nearJunctions: Map<string, string[]>;
}

export type VehicleClass = 'car' | 'van';
export type Indicator = 'left' | 'right' | 'off';

export interface RouteStep {
  laneId: string;
  via: string | null; // junction id for a turn, null for a lane-change step
}

export interface Vehicle {
  id: number;
  cls: VehicleClass;
  length: number;
  width: number;
  maxAccel: number;
  maxSpeed: number; // m/s
  colour: number;   // palette index
  laneId: string;
  s: number;        // arc position (m) from travel start
  v: number;        // m/s
  heading: number;  // math radians, x=east CCW+
  lat: number;      // lateral offset from lane centre (m), for lane-change blend
  x: number; y: number;
  route: RouteStep[]; // route[0].laneId === laneId (invariant)
  destLane: string;
  indicator: Indicator;
  brake: boolean;
  targetSpeed: number; // debug: current desired speed m/s
  committed: boolean;  // committed to crossing the upcoming junction
  waitStart: number | null; // sim time when forced stop at a control began
  changeTarget: string | null; // lane-change in progress -> target lane id
  changeT: number;             // 0..1 blend progress
  changeFromLat: number;       // lat at change start
  changeShift: number;         // total lateral shift for the change
  nextMobilT: number;          // next MOBIL evaluation time
  stoppedTime: number;         // continuous stationary time (s)
  dist: number;                // total distance travelled (m)
  evIdx: number;               // index into idx.events[laneId]: event being approached
  activeEv: string | null;     // junction id currently being handled (for commit reset)
}
