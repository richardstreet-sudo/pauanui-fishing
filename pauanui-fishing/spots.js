// Spot log logic (pure, no DOM): coordinates, GPX import, tide stage, "worked before" matching, island shelter.
import { toMs, minsOf, dateOf, moonInfo, tideStage } from './core.js';
export { tideStage };
import { SPECIES } from './knowledge.js';

export const ISLANDS = [
  { name: 'Shoe Island', lat: -36.993, lon: 175.906 },
  { name: 'Slipper Island', lat: -37.049, lon: 175.945 },
  { name: 'Waipapa Island', lat: -36.9305, lon: 175.8595 },
  { name: 'Aldermen Islands', lat: -36.964, lon: 176.086 },
  { name: 'Rangitoto Island', lat: -36.785, lon: 174.862 },
  { name: 'Motutapu Island', lat: -36.76, lon: 174.9 },
  { name: 'Motukorea', lat: -36.83, lon: 174.9 },
];

const ok = (lat, lon) => (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null);

/** Decimal ("-37.02, 175.89") or Garmin-style degrees-decimal-minutes ("37°01.234'S 175°53.456'E"); also deg-min-sec. */
export function parseCoords(input) {
  const s = String(input).trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  let m = s.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return ok(+m[1], +m[2]);
  const re = /(\d{1,3})\s*[°\s]\s*(\d{1,2}(?:\.\d+)?)\s*'?\s*(?:(\d{1,2}(?:\.\d+)?)\s*")?\s*([NSEW])/gi;
  const parts = [];
  while ((m = re.exec(s))) {
    const v = +m[1] + +m[2] / 60 + (m[3] ? +m[3] / 3600 : 0);
    const h = m[4].toUpperCase();
    parts.push({ h, v: h === 'S' || h === 'W' ? -v : v });
  }
  if (parts.length !== 2) return null;
  const lat = parts.find((p) => p.h === 'N' || p.h === 'S'), lon = parts.find((p) => p.h === 'E' || p.h === 'W');
  return lat && lon ? ok(lat.v, lon.v) : null;
}

/** Waypoints from a GPX file (Garmin / ActiveCaptain exports etc.). */
export function parseGpx(xml) {
  const out = [];
  const re = /<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/gi;
  let m;
  while ((m = re.exec(String(xml)))) {
    const lat = parseFloat((m[1].match(/\blat="([^"]+)"/i) || [])[1]);
    const lon = parseFloat((m[1].match(/\blon="([^"]+)"/i) || [])[1]);
    const nm = (m[2].match(/<name>([\s\S]*?)<\/name>/i) || [])[1] || 'Waypoint';
    const note = (m[2].match(/<(?:desc|cmt)>([\s\S]*?)<\/(?:desc|cmt)>/i) || [])[1] || '';
    const clean = (x) => x.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const p = ok(lat, lon);
    if (p) out.push({ ...p, name: clean(nm).slice(0, 60), notes: clean(note).slice(0, 200) });
  }
  return out;
}

export const km = (a, b) => {
  const dy = (a.lat - b.lat) * 111.2, dx = (a.lon - b.lon) * 111.2 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
};
export const bearing = (from, to) => {
  const dy = to.lat - from.lat, dx = (to.lon - from.lon) * Math.cos((from.lat * Math.PI) / 180);
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
};
export const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
/** Deep link into wetmaps.co.nz (LINZ charts): the site's own URLs look like #zoom/lat/lon. */
export const wetmapsUrl = (lat, lon, z = 14) => `https://wetmaps.co.nz/#${z}/${(+lat).toFixed(4)}/${(+lon).toFixed(4)}`;
export const satelliteUrl = (lat, lon) => `https://www.google.com/maps/@${lat},${lon},17z/data=!3m1!1e3`;

export function lightBand(mins, sr, ss) {
  if (Math.abs(mins - sr) <= 90) return 'dawn';
  if (Math.abs(mins - ss) <= 90) return 'dusk';
  return mins > sr && mins < ss ? 'day' : 'night';
}

/** Conditions at local time t ('YYYY-MM-DDTHH:MM') from a cached forecast; null if outside it. */
export function conditionsAt(fc, tides, t) {
  const hour = fc?.hours.find((h) => h.t.slice(0, 13) === t.slice(0, 13));
  const d = fc?.daily[dateOf(t)];
  if (!hour || !d) return null;
  const moon = moonInfo(dateOf(t));
  return {
    stage: tideStage(tides, t), wind: hour.wind, wdir: hour.wdir, gust: hour.gust, sea: hour.wave,
    light: lightBand(minsOf(t), minsOf(d.sunrise), minsOf(d.sunset)), moonTide: moon.tide, afterFull: moon.afterFull,
  };
}

/** Which of three factors match: tide stage, wind (direction within 60° and speed within 5 kt), light band. */
export function similarity(a, b) {
  const matches = [];
  if (a?.stage && a.stage === b?.stage) matches.push(`tide ${a.stage}`);
  if (a?.wdir != null && b?.wdir != null && angDiff(a.wdir, b.wdir) <= 60 && Math.abs((a.wind ?? 0) - (b.wind ?? 0)) <= 5) matches.push('similar wind');
  if (a?.light && a.light === b?.light) matches.push(a.light === 'dawn' || a.light === 'dusk' ? a.light + ' light' : a.light);
  return { score: matches.length, matches };
}

/** Logged spots that gave fish in similar conditions (>= 2 of 3 factors). */
export function spotsForToday(spots, cond) {
  if (!cond) return [];
  const out = [];
  for (const s of spots) {
    let best = null;
    for (const c of s.catches || []) {
      if (c.result !== 'fish' || !c.conds) continue;
      const sim = similarity(c.conds, cond);
      if (sim.score >= 2 && (!best || sim.score > best.score)) best = { ...sim, species: c.species };
    }
    if (best) out.push({ spot: s, ...best, fishTrips: (s.catches || []).filter((c) => c.result === 'fish').length, trips: (s.catches || []).length });
  }
  return out.sort((a, b) => b.score - a.score);
}

const DIRS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const dir8 = (deg) => DIRS8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Shelter from wind for the islands, and for saved spots near an island. */
export function shelter(windFrom, windKt, spots = []) {
  if (windFrom == null) return null;
  const lee = (windFrom + 180) % 360;
  const light = (windKt ?? 0) < 6;
  const near = [];
  for (const s of spots) {
    const isl = ISLANDS.map((i) => ({ i, d: km(i, s) })).sort((a, b) => a.d - b.d)[0];
    if (!isl || isl.d > 3) continue;
    const diff = angDiff(bearing(isl.i, s), lee);
    near.push({ spot: s.name, island: isl.i.name, where: diff <= 60 ? 'sheltered (lee) side' : diff >= 120 ? 'exposed (windward) side' : 'side-on to the wind' });
  }
  return { windFrom, windKt, leeDir: dir8(lee), fromDir: dir8(windFrom), light, near };
}

/**
 * Rank your tagged spots for today. For each spot take the best species that is Good/Fair today AND suits the
 * spot's habitat tags/depth (habitat fit comes from knowledge.js), then adjust for shelter and past success.
 */
export function trySpots(spots, outlook, sh, hits, home, blocked = () => false) {
  const lvlPts = { Good: 3, Fair: 1.5 };
  const out = [];
  for (const s of spots) {
    if (blocked(s)) continue; // never suggest a spot inside a protected area
    const tags = s.habitat || [];
    const hist = hits.find((h) => h.spot.id === s.id);
    const near = sh?.near.find((n) => n.spot === s.name);
    let best = null;
    for (const o of outlook) {
      if (!lvlPts[o.level]) continue;
      const hab = SPECIES.find((x) => x.name === o.name)?.habitat;
      if (!hab) continue;
      let pts = 0; const fit = [];
      for (const t of tags) if (hab.tags[t]) { pts += hab.tags[t]; fit.push(t); }
      const depthOk = s.depth != null && hab.depth && s.depth >= hab.depth[0] && s.depth <= hab.depth[1];
      if (depthOk) { pts += 1; fit.push(`${s.depth} m`); }
      if (!pts) continue;
      const score = lvlPts[o.level] + pts;
      if (!best || score > best.score) best = { score, species: o.name, level: o.level, fit, src: SPECIES.find((x) => x.name === o.name).src };
    }
    if (!best && !hist) continue;
    let score = best ? best.score : 0;
    const notes = [];
    if (near?.where.startsWith('sheltered')) { score += 1; notes.push('sheltered side today'); }
    else if (near?.where.startsWith('exposed') && !sh.light) { score -= 1; notes.push('exposed side today'); }
    if (hist) { score += hist.score * 1.5; notes.push(`fished well before in similar conditions (${hist.matches.join(', ')})`); }
    out.push({ spot: s, score, best, notes, km: home ? km(home, s) : null });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Tallies of your own trips (spot trips + loose trips) by tide stage, light and wind band – the feedback loop. */
export function logStats(spots, loose = []) {
  const trips = [...spots.flatMap((s) => (s.catches || []).map((c) => ({ ...c, spot: s.name }))), ...loose].filter((t) => t.conds);
  const groups = { 'Tide': {}, 'Light': {}, 'Wind': {} };
  const bump = (g, k, fish) => { if (!k) return; (groups[g][k] ||= { n: 0, fish: 0 }); groups[g][k].n++; if (fish) groups[g][k].fish++; };
  for (const t of trips) {
    const fish = t.result === 'fish';
    bump('Tide', t.conds.stage, fish);
    bump('Light', t.conds.light, fish);
    bump('Wind', t.conds.wind == null ? null : t.conds.wind < 5 ? 'under 5 kt' : t.conds.wind < 10 ? '5–10 kt' : 'over 10 kt', fish);
  }
  const all = trips.length, fishTrips = trips.filter((t) => t.result === 'fish').length;
  return { all, fishTrips, groups };
}
