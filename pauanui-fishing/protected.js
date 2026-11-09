// Protected marine areas near your fishing grounds (High Protection Areas, Seafloor Protection Areas, marine reserves).
// Boundaries: OpenStreetMap contributors (ODbL), which carries the DOC / LINZ designations, simplified to ~40 m.
// This is a guide, NOT an official boundary: always confirm with DOC / Fisheries NZ before fishing near one.

let AREAS = [];
export const setAreas = (a) => { AREAS = Array.isArray(a) ? a : []; };
export const getAreas = () => AREAS;

export const RULES_URL = 'https://www.mpi.govt.nz/fishing-aquaculture/recreational-fishing';
export const KIND_TEXT = {
  HPA: 'fishing is not allowed there',
  SPA: 'restricted – mapped as no-fishing, so check the rules',
  'Marine reserve': 'no fishing or taking',
};

// ring: array of [lat, lon]
function inRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segKm(lat, lon, a, b) {
  const k = Math.cos((lat * Math.PI) / 180) * 111.2;
  const ax = (a[1] - lon) * k, ay = (a[0] - lat) * 111.2, bx = (b[1] - lon) * k, by = (b[0] - lat) * 111.2;
  const dx = bx - ax, dy = by - ay;
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export const insideArea = (lat, lon, area) => area.rings.some((r) => inRing(lat, lon, r));
export function distanceKm(lat, lon, area) {
  let best = Infinity;
  for (const r of area.rings) for (let i = 1; i < r.length; i++) best = Math.min(best, segKm(lat, lon, r[i - 1], r[i]));
  return best;
}

/** Protected areas that contain the point, or lie within `withinKm` of it. */
export function protectedNear(lat, lon, withinKm = 0) {
  const out = [];
  for (const area of AREAS) {
    if (insideArea(lat, lon, area)) out.push({ area, inside: true, km: 0 });
    else if (withinKm > 0) {
      const d = distanceKm(lat, lon, area);
      if (d <= withinKm) out.push({ area, inside: false, km: d });
    }
  }
  return out.sort((a, b) => a.km - b.km);
}

export const insideProtected = (lat, lon) => protectedNear(lat, lon, 0)[0] || null;
