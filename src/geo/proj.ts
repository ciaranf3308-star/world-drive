// Local tangent-plane frame (mirrors tools/lib/proj.mjs for browser use).
// True metres: x=east, y=north. Negligible distortion over game chunks.
const R = 6378137;
const D2R = Math.PI / 180;

export interface LocalFrame {
  toLocal(lat: number, lon: number): [number, number];
  toLatLon(x: number, y: number): [number, number];
}
export function makeFrame(lat0: number, lon0: number): LocalFrame {
  const kx = R * Math.cos(lat0 * D2R);
  const x0 = kx * lon0 * D2R;
  const y0 = R * lat0 * D2R;
  return {
    toLocal(lat: number, lon: number): [number, number] {
      return [kx * lon * D2R - x0, R * lat * D2R - y0];
    },
    toLatLon(x: number, y: number): [number, number] {
      const lon = ((x + x0) / kx) / D2R;
      const lat = ((y + y0) / R) / D2R;
      return [lat, lon];
    },
  };
}
