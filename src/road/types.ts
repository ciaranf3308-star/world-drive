// Road network types (matches tools/build-network.mjs output).
export type Confidence = 'verified' | 'inferred' | 'generated';
export type XY = [number, number];

export interface Lane {
  id: string;
  dir: 1 | -1; // +1 = along way node order, -1 = against
  index: number; // 0 = leftmost lane of travel direction
  offsetM: number;
  centreline: XY[];
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
}

export interface Junction {
  id: string;
  nodeId: number;
  x: number;
  y: number;
  degree: number;
  wayIds: number[];
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
  };
  segments: Segment[];
  junctions: Junction[];
  buildings: Building[];
  water: Water[];
}
