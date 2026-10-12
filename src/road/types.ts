// Road network types (matches tools/build-network.mjs output).
export type Confidence = 'verified' | 'inferred' | 'generated';
export type XY = [number, number];

export interface LaneBoundary { left: XY[]; right: XY[]; }

export interface Lane {
  id: string;
  dir: 1 | -1; // +1 = along way node order, -1 = against
  index: number; // 0 = leftmost lane of travel direction
  offsetM: number;
  centreline: XY[];
  boundary: LaneBoundary;
}

export type MarkingType =
  | 'centre-dashed' | 'centre-double-solid'
  | 'lane-dash' | 'edge-solid'
  | 'stop-line' | 'yield-line' | 'yield-triangle'
  | 'arrow' | 'text';

export interface Marking {
  type: MarkingType;
  pts?: XY[];          // linear / polygon markings
  pos?: XY;            // point markings (arrow, text)
  headingDeg?: number; // math degrees (x=east, y=north, CCW+)
  moves?: string[];    // arrow: allowed manoeuvres
  text?: string;       // text: painted word
  confidence: Confidence;
  source: string;
}

export interface TurnConnection {
  from: string; to: string;
  fromSeg: string; toSeg: string; via: string;
  kind: 'left' | 'through' | 'right' | 'roundabout-entry' | 'roundabout-exit' | 'circulate';
  angleDeg: number;
  fromHx: number; fromHy: number; // approach heading at junction
  toHx: number; toHy: number;     // departure heading at junction
  confidence: Confidence;
  source: string;
}

export interface JunctionControl {
  laneId: string; segId: string; via: string;
  kind: 'stop' | 'yield' | 'yield-right';
  confidence: Confidence;
  source: string;
}

export interface Segment {
  id: string;
  osmWayId: number;
  name: string | null;
  highway: string;
  oneway: boolean;
  roundabout: boolean;
  speedKmh: number;
  speedConf: Confidence;
  laneWidthM: number;
  lanesPerDir: number;
  laneConf: Confidence;
  laneConfSource: string;
  geometryConf: Confidence;
  centreline: XY[];
  lanes: Lane[];
  markings: Marking[];
}

export interface Junction {
  id: string;
  nodeId: number;
  x: number;
  y: number;
  degree: number;
  wayIds: number[];
  connections: TurnConnection[];
  controls: JunctionControl[];
}

export interface Building { pts: XY[]; }
export interface Water { pts: XY[]; kind: string; }

export interface RoadNetwork {
  meta: {
    origin: { lat: number; lon: number };
    bbox: { south: number; west: number; north: number; east: number };
    builtAt: string;
    source: string;
    licence: string;
    phase: number;
  };
  segments: Segment[];
  junctions: Junction[];
  buildings: Building[];
  water: Water[];
}
