// Run in Node (`node tests.mjs`) or import in a browser console. No dependencies.
import { SOURCES, SPECIES, TIPS, GEAR } from './knowledge.js';
import { parseCoords, parseGpx, tideStage, similarity, spotsForToday, shelter, trySpots, wetmapsUrl, logStats } from './spots.js';
import { setAreas, protectedNear, insideProtected } from './protected.js';
import { tripCheck, shortWindow, turnsRedAt } from './plan.js';
import { billyHo, parseMaoriCalendar, parseLinzCsv, applyTideOffsets } from './core.js';
import { rateHour, buildDays, parseLinz, tidesFromModel, mergeTides, moonInfo, solunar, runoffFor, lureAdvice, speciesOutlook, diveOutlook, todaysTips, gearList, DEFAULTS } from './core.js';

const fails = [];
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(`${msg}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };

const ok = { wind: 6, gust: 9, wave: 0.4, rain: 0 };
eq(rateHour(ok).r, 'GO', 'calm = GO');
eq(rateHour({ ...ok, wind: 10 }).r, 'MAYBE', 'wind at limit = MAYBE');
eq(rateHour({ ...ok, gust: 19 }).r, 'NOGO', 'gust 19 = NOGO');
eq(rateHour({ ...ok, wave: 0.9 }).r, 'MAYBE', 'sea 0.9 = MAYBE');
eq(rateHour({ ...ok, wave: 1.0 }).r, 'NOGO', 'sea 1.0 = NOGO');
eq(rateHour({ ...ok, rain: 3 }).r, 'NOGO', 'heavy rain = NOGO');
eq(rateHour({ ...ok, rain: 1 }).r, 'MAYBE', 'light rain = MAYBE');
eq(rateHour({ ...ok, wave: null }).r, 'MAYBE', 'missing sea = MAYBE');

// Synthetic day: sunrise 06:00, sunset 19:00. Calm all day except 06:00-08:00 windy.
const date = '2026-11-14';
const hours = Array.from({ length: 24 }, (_, h) => ({
  t: `${date}T${String(h).padStart(2, '0')}:00`, date, h,
  wind: h >= 6 && h <= 7 ? 14 : 5, gust: h >= 6 && h <= 7 ? 20 : 8, rain: 0, wave: 0.4, sl: Math.sin(h / 12.42 * 2 * Math.PI),
}));
const fc = { hours, daily: { [date]: { sunrise: `${date}T06:00`, sunset: `${date}T19:00` } } };
let [d] = buildDays(fc, DEFAULTS, '2026-11-13T12:00');
eq([d.best.startH, d.best.endH, d.best.quality], [16, 20, 'GO'], 'dawn windy -> dusk window wins');
eq(d.rating, 'GO', 'day rating GO');

// Past hours are excluded.
d = buildDays(fc, DEFAULTS, '2026-11-14T18:30')[0];
eq(d.best.startH >= 18, true, 'past hours excluded');

// All windy -> NOGO, no window.
const bad = { ...fc, hours: hours.map((h) => ({ ...h, wind: 25, gust: 30 })) };
d = buildDays(bad, DEFAULTS, '2026-11-13T12:00')[0];
eq([d.best, d.rating], [null, 'NOGO'], 'all windy');

// LINZ parsing: several plausible layouts.
const a = parseLinz('Sat 14 Nov 2025\n03:12 0.4 09:20 2.1\n15:30 0.5 21:45 2.0');
eq(a.map((e) => [e.t, e.m, e.type]), [['2025-11-14T03:12', 0.4, 'L'], ['2025-11-14T09:20', 2.1, 'H'], ['2025-11-14T15:30', 0.5, 'L'], ['2025-11-14T21:45', 2.0, 'H']], 'linz layout A');
const b = parseLinz('14/11/2025, 3:12 AM, 0.4, 9:20 AM, 2.1\n14/11/2025, 3:30 PM, 0.5');
eq(b.map((e) => [e.t, e.m]), [['2025-11-14T03:12', 0.4], ['2025-11-14T09:20', 2.1], ['2025-11-14T15:30', 0.5]], 'linz layout B (am/pm)');
const c = parseLinz('2025-11-14,00:05,1.9\n2025-11-14,06:10,0.3');
eq(c.map((e) => [e.t, e.type]), [['2025-11-14T00:05', 'H'], ['2025-11-14T06:10', 'L']], 'linz layout C (iso)');

// Model tides: ~12.42h sine yields ~2 highs/day, timing close to truth.
const t = tidesFromModel(hours);
eq(t.filter((e) => e.type === 'H').length >= 1, true, 'model finds highs');
eq(mergeTides(t, a).filter((e) => e.src === 'LINZ').length, 4, 'merge keeps LINZ');

// Moon: full moon 2025-11-05 13:19 UTC (= 6 Nov NZ), new moon 2025-10-21 12:25 UTC (= 22 Oct NZ).
eq(moonInfo('2025-11-06').name, 'Full moon', 'full moon');
eq(moonInfo('2025-11-06').tide, 'spring', 'full moon = springs');
eq(moonInfo('2025-10-22').name, 'New moon', 'new moon');
eq(moonInfo('2025-11-13').tide, 'neap', 'quarter = neaps');
// At full moon the moon is overhead around local midnight/early hours, underfoot around midday.
const sol = solunar('2025-11-06', -37.02, 175.89);
const majors = sol.filter((p) => p.kind === 'major').map((p) => p.mid / 60);
eq(majors.some((m) => m >= 0 && m <= 3.5), true, 'full-moon transit near local night: ' + majors);
eq(majors.some((m) => m >= 11 && m <= 15), true, 'full-moon underfoot near midday: ' + majors);

// Tide-turn bonus breaks ties between otherwise equal GO windows (mid-day, no twilight effect).
{
  const dt = '2026-11-14';
  const hrs = Array.from({ length: 24 }, (_, h) => ({ t: `${dt}T${String(h).padStart(2, '0')}:00`, date: dt, h, wind: h >= 5 && h <= 9 ? 5 : 20, gust: h >= 5 && h <= 9 ? 8 : 30, rain: 0, wave: 0.4 }));
  const f2 = { hours: hrs, lat: -37.02, lon: 175.89, daily: { [dt]: { sunrise: `${dt}T06:00`, sunset: `${dt}T19:00` } } };
  // GO hours 5..9. Without tides: dawn bonus picks 5–9 (4h). With a tide at 08:30 the same window still wins; check hour flags.
  const w = buildDays(f2, DEFAULTS, '2026-11-13T12:00', [{ t: `${dt}T08:30`, type: 'H', m: 1, src: 'LINZ' }])[0];
  eq(w.hours.filter((h) => h.turn).map((h) => h.h), [7, 8, 9], 'turn flagged on hours whose centre is within 60 min of 08:30');
}

// Runoff: heavy rain yesterday -> muddy; dry spell -> clear.
{
  const mk = (rainAt) => Array.from({ length: 24 * 5 }, (_, i) => { const d = new Date(Date.UTC(2026, 10, 10) + i * 3600e3).toISOString(); return { t: d.slice(0, 16), date: d.slice(0, 10), h: +d.slice(11, 13), rain: rainAt(i) }; });
  eq(runoffFor(mk(() => 0), '2026-11-13').level, 'clear', 'dry = clear');
  eq(runoffFor(mk((i) => (i >= 40 && i < 50 ? 4 : 0)), '2026-11-13').clearing, true, 'rain 28-38h ago, none since = clearing');
  eq(runoffFor(mk((i) => (i >= 50 && i < 62 ? 4 : 0)), '2026-11-13').level, 'muddy', '48mm over ~a day = muddy');
  eq(runoffFor(mk((i) => (i === 40 ? 10 : 0)), '2026-11-13').level, 'tinged', 'old 10mm = tinged');
  const dayStub = (level, cloud) => ({ sr: 360, ss: 1140, runoff: { level, label: level, mm72: 0 }, best: null, hours: Array.from({ length: 24 }, (_, h) => ({ h, day: h >= 6 && h <= 18, cloud, wave: 0.3 })) });
  eq(lureAdvice(dayStub('muddy', 20)).main.includes('Lime tiger glow'), true, 'muddy -> lime tiger glow');
  eq(lureAdvice(dayStub('clear', 10)).main[0], 'Silver / grey pearl', 'clear bright -> silver pearl');
}

// Safety: storm/fog override, offshore flag, opposed wind-vs-ebb, pressure trend.
eq(rateHour({ ...ok, code: 95 }).r, 'NOGO', 'thunderstorm = NOGO');
eq(rateHour({ ...ok, vis: 800 }).r, 'NOGO', 'fog = NOGO');
{
  const dt = '2026-11-14';
  const mkh = (over) => Array.from({ length: 24 }, (_, h) => ({ t: `${dt}T${String(h).padStart(2, '0')}:00`, date: dt, h, wind: 7, gust: 9, rain: 0, wave: 0.4, p: 1015 - h * 0.5, wdir: 270, ...over }));
  const f3 = (over) => ({ hours: mkh(over), lat: -37.02, lon: 175.89, daily: { [dt]: { sunrise: `${dt}T08:00`, sunset: `${dt}T19:00` } } });
  let w = buildDays(f3({}), DEFAULTS, '2026-11-13T12:00', [])[0];
  eq(w.safety.some((x) => x.k === 'offshore'), true, 'westerly 7kt = offshore flag');
  eq(w.warn, true, 'warn set');
  w = buildDays(f3({ wdir: 100, wind: 9 }), DEFAULTS, '2026-11-13T12:00', [{ t: `${dt}T00:30`, type: 'H', m: 1, src: 'LINZ' }, { t: `${dt}T23:00`, type: 'L', m: 0, src: 'LINZ' }])[0];
  eq(w.safety.some((x) => x.k === 'opposed'), true, 'easterly over ebb flagged');
  w = buildDays(f3({ wdir: 100, wind: 9 }), DEFAULTS, '2026-11-13T12:00', [{ t: `${dt}T00:30`, type: 'L', m: 0, src: 'LINZ' }])[0];
  eq(w.safety.some((x) => x.k === 'opposed'), false, 'easterly over flood not flagged');
  eq(w.pressure.trend, 'falling fast', 'pressure -3hPa/6h -> ' + w.pressure.delta);
}

// Species: warm December dawn with a tide turn and some colour suits snapper; cold July suits kingfish poorly.
{
  const mkDay = (date, sst, turn) => ({ date, sr: 360, ss: 1140, runoff: { level: 'tinged', label: 'tinged', mm72: 8 }, moon: { tide: 'mid' }, pressure: { trend: 'falling' },
    best: { startH: 5, endH: 8 }, hours: Array.from({ length: 24 }, (_, h) => ({ h, day: h >= 5 && h <= 19, cloud: 30, wave: 0.3, sst: h === 12 ? sst : null, turn: turn && h === 6 ? { t: `${date}T06:20`, type: 'H' } : null })) });
  const by = (o, n) => o.find((x) => x.name === n);
  eq(by(speciesOutlook(mkDay('2026-12-10', 20, true)), 'Snapper').level, 'Good', 'snapper good in warm Dec dawn + turn');
  eq(by(speciesOutlook(mkDay('2026-07-10', 14, false)), 'Kingfish').level, 'Slow', 'kingfish slow in cold July');
  const full = mkDay('2026-12-10', 20, true); full.moon = { tide: 'spring', afterFull: true };
  eq(by(speciesOutlook(full), 'Snapper').score, by(speciesOutlook(mkDay('2026-12-10', 20, true)), 'Snapper').score - 1, 'full-moon penalty');
  eq(by(speciesOutlook(mkDay('2026-07-10', 14, false)), 'Gurnard').level !== 'Slow', true, 'gurnard fine in cold July');
  eq(speciesOutlook(mkDay('2026-12-10', 20, true)).length, 6, 'six species');
}

// Dive: calm, dry, clear midday = Great; muddy runoff caps it; big swell = Poor.
{
  const mk = (level, sea, sw) => ({ runoff: { level, label: level, mm72: 0 }, hours: Array.from({ length: 24 }, (_, h) => ({ h, day: h >= 6 && h <= 19, wave: sea, sw, wind: 5, gust: 8, rain: 0, flags: [], turn: h === 11 ? { t: '2026-11-14T11:10' } : null })) });
  eq(diveOutlook(mk('clear', 0.3, 0.3)).level, 'Great', 'calm clear = Great');
  eq(diveOutlook(mk('clear', 0.3, 0.3)).window.slack != null, true, 'slack noted');
  eq(diveOutlook(mk('stained', 0.3, 0.3)).level, 'OK', 'stained caps at OK');
  eq(diveOutlook(mk('muddy', 0.3, 0.3)).level, 'Poor', 'muddy = Poor');
  eq(diveOutlook(mk('clear', 1.2, 1.0)).level, 'Poor', 'big sea = Poor');
}
eq(DEFAULTS.places.length, 4, 'four default spots');
eq(DEFAULTS.places.find((p) => p.harbour).tide.port, 'auckland', 'harbour uses Auckland tide table');

// Knowledge base integrity: every cited source exists; tips/gear produce output.
{
  const ids = [...SPECIES.flatMap((s) => s.src), ...TIPS.flatMap((x) => x.src), ...GEAR.flatMap((x) => x.src)];
  eq(ids.filter((i) => !SOURCES[i]), [], 'all cited source ids exist');
  eq(Object.values(SOURCES).every((s) => s.url.startsWith('https://www.fishing.net.nz/')), true, 'source urls');
  const day = { date: '2026-11-14', sr: 360, ss: 1140, runoff: { level: 'clear', label: 'clear', mm72: 0, clearing: true }, moon: { age: 3, tide: 'mid', afterFull: false }, pressure: { trend: 'steady' },
    rating: 'GO', best: { startH: 5, endH: 8 }, loc: [-36.96, 176.086],
    hours: Array.from({ length: 24 }, (_, h) => ({ h, day: h >= 5 && h <= 19, cloud: 30, wave: 0.3, sst: h === 12 ? 18 : null, turn: null })) };
  const o = speciesOutlook(day);
  const tips = todaysTips(day, o);
  const ids2 = tips.map((x) => x.id);
  eq(ids2.includes('workup') && ids2.includes('spawn') && ids2.includes('clearing') && ids2.includes('noRun') && ids2.includes('far'), true, 'expected tips fire: ' + ids2);
  eq(ids2.includes('fullMoon'), false, 'no full-moon tip when not after full');
  eq(gearList(day, o).length >= 2, true, 'gear list');
}

// Spots: coordinates, GPX, tide stage, matching, shelter.
{
  const near = (p, la, lo) => p && Math.abs(p.lat - la) < 1e-3 && Math.abs(p.lon - lo) < 1e-3;
  eq(near(parseCoords('-37.0206, 175.8909'), -37.0206, 175.8909), true, 'decimal coords');
  eq(near(parseCoords("37°01.234'S 175°53.456'E"), -37.02057, 175.89093), true, 'garmin DDM coords');
  eq(near(parseCoords('37 01.234 S, 175 53.456 E'), -37.02057, 175.89093), true, 'DDM without symbols');
  eq(near(parseCoords("175°53'27\"E 37°01'14\"S"), -37.02056, 175.89083), true, 'DMS, lon first');
  eq(parseCoords('hello'), null, 'garbage rejected');
  const g = parseGpx('<gpx><wpt lat="-37.05" lon="175.94"><name><![CDATA[Slipper &amp; reef]]></name><desc>snapper</desc></wpt><wpt lon="176.0" lat="-36.97"><name>B</name></wpt></gpx>');
  eq(g.map((x) => [x.name, x.lat, x.lon]), [['Slipper & reef', -37.05, 175.94], ['B', -36.97, 176]], 'gpx waypoints');
  const td = [{ t: '2026-11-14T04:13', type: 'L' }, { t: '2026-11-14T10:33', type: 'H' }, { t: '2026-11-14T16:44', type: 'L' }];
  eq(tideStage(td, '2026-11-14T07:30'), 'flooding', 'flooding after low');
  eq(tideStage(td, '2026-11-14T13:00'), 'ebbing', 'ebbing after high');
  eq(tideStage(td, '2026-11-14T10:10'), 'high slack', 'slack near high');
  const a = { stage: 'ebbing', wdir: 250, wind: 8, light: 'dawn' };
  eq(similarity(a, { stage: 'ebbing', wdir: 280, wind: 11, light: 'day' }).score, 2, 'two factors match');
  const sp = [{ name: 'X', lat: -37.05, lon: 175.95, catches: [{ result: 'fish', species: 'Snapper', conds: a }] }, { name: 'Y', lat: -37, lon: 175.9, catches: [{ result: 'blank', conds: a }] }];
  eq(spotsForToday(sp, { stage: 'ebbing', wdir: 260, wind: 9, light: 'dawn' }).map((h) => h.spot.name), ['X'], 'only fished-before spot matched');
  const sh = shelter(225, 12, [{ name: 'NE reef', lat: -37.04, lon: 175.96 }, { name: 'SW reef', lat: -37.06, lon: 175.93 }]);
  eq([sh.leeDir, sh.fromDir], ['NE', 'SW'], 'SW wind -> lee NE');
  eq(sh.near.map((n) => [n.spot, n.where]), [['NE reef', 'sheltered (lee) side'], ['SW reef', 'exposed (windward) side']], 'spots vs Slipper shelter');
}

eq(wetmapsUrl(-37.0604, 176.0374, 11), 'https://wetmaps.co.nz/#11/-37.0604/176.0374', 'wetmaps deep link matches the site format');
// Billy Ho: waxing -> outgoing tide; waning -> incoming.
{
  const tdl = [{ t: '2026-11-14T04:13', type: 'L' }, { t: '2026-11-14T10:33', type: 'H' }, { t: '2026-11-14T16:44', type: 'L' }];
  const ebb = { startH: 12, endH: 15 }, flood = { startH: 6, endH: 9 };
  eq(billyHo('2026-11-14', ebb, tdl, { age: 3 }).match, true, 'waxing + ebb = match');
  eq(billyHo('2026-11-14', flood, tdl, { age: 3 }).match, false, 'waxing + flood = no match');
  eq(billyHo('2026-11-14', flood, tdl, { age: 20 }).match, true, 'waning + flood = match');
  eq(billyHo('2026-11-14', null, tdl, { age: 3 }).match, null, 'no window -> null');
}
eq(parseMaoriCalendar('Poor fishing on Sunday 1 November 2026\nExcellent fishing on Monday 2 November 2026 Good fishing on Monday 16 November 2026'), { '2026-11-01': 'Poor', '2026-11-02': 'Excellent', '2026-11-16': 'Good' }, 'maori calendar parse');
// Outlook days (no marine data): rated on wind/rain only, no dive rating.
{
  const dt = '2026-11-20';
  const hrs = Array.from({ length: 24 }, (_, h) => ({ t: `${dt}T${String(h).padStart(2, '0')}:00`, date: dt, h, wind: 5, gust: 8, rain: 0, wave: null, p: 1015 }));
  const w = buildDays({ hours: hrs, lat: -37.02, lon: 175.89, daily: { [dt]: { sunrise: `${dt}T06:00`, sunset: `${dt}T19:00` } } }, DEFAULTS, '2026-11-13T12:00', [])[0];
  eq([w.outlook, w.rating, w.dive.level], [true, 'GO', 'n/a'], 'outlook day: wind-only GO, no dive rating');
}
// LINZ yearly CSV + secondary-port corrections (Tauranga 14 Nov 2026 -> Tairua: HW +7 min, LW +18 min).
{
  const ev = parseLinzCsv('14,Sa,11,2026,04:58,0.4,11:24,1.8,17:29,0.5,23:31,1.7\n15,Su,11,2026,05:37,0.4,12:00,1.8,18:08,0.5,,');
  eq(ev.map((e) => e.t.slice(5) + e.type), ['11-14T04:58L', '11-14T11:24H', '11-14T17:29L', '11-14T23:31H', '11-15T05:37L', '11-15T12:00H', '11-15T18:08L'], 'LINZ CSV rows parsed with H/L');
  eq(applyTideOffsets(ev, { hw: 7, lw: 18, ratio: 1 }).slice(0, 2).map((e) => e.t.slice(11)), ['05:16', '11:31'], 'Tairua corrections');
}
{
  const ev = parseLinzCsv('14,Sa,11,2026,05:02,0.8,11:34,3.1,17:30,0.9,23:48,2.9');
  eq(applyTideOffsets(ev, { hw: 0, lw: 0, ratio: 1 }).map((e) => e.t.slice(11) + e.type), ['05:02L', '11:34H', '17:30L', '23:48H'], 'Auckland primary port, no correction');
}
// Protected areas (point-in-polygon) with a toy square, plus trip/fuel check and log stats.
{
  setAreas([{ name: 'Test HPA', kind: 'HPA', rings: [[[-37.0, 175.0], [-37.0, 175.1], [-37.1, 175.1], [-37.1, 175.0]]] }]);
  eq(!!insideProtected(-37.05, 175.05), true, 'inside protected square');
  eq(insideProtected(-36.9, 175.05), null, 'outside protected square');
  eq(protectedNear(-36.99, 175.05, 2).map((x) => x.inside), [false], 'near but outside within 2 km');
  setAreas([]);
  const d = { ss: 20 * 60 + 3 };
  eq(tripCheck(d, 5, 80), null, 'no trip check for near spots');
  eq(tripCheck(d, 19, 90).back, '19:03', 'be back an hour before sunset');
  eq(tripCheck(d, 19, 90).fuel.startsWith('fuel OK'), true, 'fuel ok when a third of range covers it');
  eq(tripCheck(d, 40, 90).fuel.startsWith('⚠'), true, 'fuel tight warning');
  eq(shortWindow({ startH: 5, endH: 9 }), '05–09', 'short window label');
  const ls = logStats([{ name: 'A', catches: [{ result: 'fish', conds: { stage: 'ebbing', light: 'dawn', wind: 6 } }, { result: 'blank', conds: { stage: 'ebbing', light: 'day', wind: 12 } }] }], [{ result: 'fish', conds: { stage: 'flooding', light: 'dawn', wind: 3 } }]);
  eq([ls.all, ls.fishTrips, ls.groups.Tide.ebbing.n, ls.groups.Light.dawn.fish], [3, 2, 2, 2], 'log stats tallies');
}
// Try-today ranking: kingfish suits a pinnacle on an island point; a sand spot suits gurnard; untagged spots are skipped.
{
  const outlook = [{ name: 'Kingfish', level: 'Fair' }, { name: 'Gurnard', level: 'Fair' }, { name: 'Snapper', level: 'Slow' }];
  const spots = [
    { id: 'a', name: 'Pin', lat: -37.04, lon: 175.96, habitat: ['pinnacle', 'island point'], depth: 40, catches: [] },
    { id: 'b', name: 'Sand', lat: -37.0, lon: 175.9, habitat: ['sand or mud'], depth: 25, catches: [] },
    { id: 'c', name: 'Untagged', lat: -37.0, lon: 175.9, catches: [] },
  ];
  const r = trySpots(spots, outlook, shelter(225, 12, spots), [], { lat: -37.02, lon: 175.89 });
  eq(r.map((x) => [x.spot.name, x.best.species]), [['Pin', 'Kingfish'], ['Sand', 'Gurnard']], 'ranked by habitat fit; untagged skipped');
  eq(r[0].notes.includes('sheltered side today'), true, 'lee note');
}

if (fails.length) { console.error('FAILED:\n' + fails.join('\n')); if (globalThis.process) process.exit(1); }
else console.log('all tests passed');
export const failures = fails;
