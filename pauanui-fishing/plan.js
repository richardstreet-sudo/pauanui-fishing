// "What should I do?" logic: best bet across spots and days, the spot-by-day grid, and the far-spot trip check.
import { windowLabel, fmtMins, speciesOutlook, lureAdvice } from './core.js';
import { SPECIES } from './knowledge.js';
import { protectedNear } from './protected.js';

const LVL = { Good: 3, Fair: 1.5, Slow: 0 };
const MAORI = { Excellent: 1.5, Good: 0.5, Poor: -0.5 };
const hh = (h) => `${String(h % 24).padStart(2, '0')}:00`;

/** Lower-case "05–09"-style label for grid cells. */
export const shortWindow = (b) => (b ? `${String(b.startH).padStart(2, '0')}–${String(b.endH % 24).padStart(2, '0')}` : '');

/** When conditions first turn red after the window starts (or null). */
export function turnsRedAt(day) {
  if (!day.best) return null;
  const h = day.hours.find((x) => x.h > day.best.startH && x.day && x.r === 'NOGO');
  return h ? h.h : null;
}

/** Far-spot trip check: be-back time (sunset - 1 h) and the rule-of-thirds fuel check against a ski range. */
export function tripCheck(day, kmFromHome, skiRangeKm) {
  if (!(kmFromHome > 10)) return null;
  const back = fmtMins(Math.max(0, day.ss - 60));
  const need = Math.round(kmFromHome * 1.3); // allow for drift, detours and chop
  let fuel;
  if (skiRangeKm > 0) {
    const ok = need <= skiRangeKm / 3;
    fuel = ok ? `fuel OK by the rule of thirds (about ${need} km each way allowing for drift; a third of your ${skiRangeKm} km range is ${Math.round(skiRangeKm / 3)} km)`
      : `⚠ fuel is tight: about ${need} km each way, but a third of your ${skiRangeKm} km range is only ${Math.round(skiRangeKm / 3)} km`;
  } else fuel = 'set your ski\'s full-tank range in ⚙︎ for a fuel check (rule of thirds: a third out, a third back, a third spare)';
  return { back, fuel, km: Math.round(kmFromHome) };
}

/** Best species to target today and how (from knowledge.js `quick`). */
export function targetFor(day, settings) {
  const out = speciesOutlook(day, settings).filter((s) => s.level !== 'Slow').sort((a, b) => b.score - a.score);
  const top = out[0] || null;
  return { top, others: out.slice(1, 3), slow: speciesOutlook(day, settings).filter((s) => s.level === 'Slow').map((s) => s.name), quick: top ? SPECIES.find((s) => s.name === top.name).quick : null };
}

/**
 * entries: [{ place, days, home }]  (days from buildDays for that place, rated with that place's limits)
 * Returns { pick, alt } where each is { place, day, score, reasons, protectedWarn }.
 */
export function bestBet(entries, settings, maori = {}, today = null) {
  const cands = [];
  for (const e of entries) {
    const near = protectedNear(e.place.lat, e.place.lon, 4);
    if (near.some((n) => n.inside)) continue; // never suggest a spot centred inside a protected area
    for (const [i, d] of e.days.slice(0, 7).entries()) {
      if (!d.best || d.rating === 'NOGO') continue;
      const out = speciesOutlook(d, settings);
      const lvl = Math.max(0, ...out.map((s) => LVL[s.level]));
      let score = (d.rating === 'GO' ? 6 : 2) + d.best.score * 0.2 + lvl + (MAORI[maori[d.date]] ?? 0) + (d.billy.match ? 0.5 : 0)
        - (d.warn ? 1.5 : 0) - (d.outlook ? 3 : 0) - i * 0.15 - (near.length ? 0.5 : 0);
      cands.push({ place: e.place, day: d, score, near, out, home: e.home });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const pick = cands[0] || null;
  const alt = pick ? cands.find((c) => c.place.name !== pick.place.name || c.day.date !== pick.day.date) : null;
  const detail = (c) => {
    if (!c) return null;
    const d = c.day, s = d.stats, b = d.best;
    const reasons = [`${d.rating === 'GO' ? 'GO' : 'MAYBE'} window ${windowLabel(b)}: wind ${Math.round(s.windMin)}–${Math.round(s.windMax)} kt, gusts to ${Math.round(s.gustMax)}${s.seaMax != null ? `, sea ${s.seaMax.toFixed(1)} m` : ''}`];
    const ts = d.hours.filter((h) => h.h >= b.startH && h.h < b.endH && h.turn).map((h) => h.turn)[0];
    const top2 = c.out.filter((o) => o.level !== 'Slow').sort((a, b2) => b2.score - a.score).slice(0, 2).map((o) => `${o.name} ${o.level}`);
    if (top2.length) reasons.push(`Fish: ${top2.join(', ')}`);
    if (ts) reasons.push(`Tide turn (${ts.type === 'H' ? 'high' : 'low'}) at ${ts.t.slice(11, 16)} in the window`);
    else if (maori[d.date] === 'Excellent') reasons.push('Māori fishing calendar: Excellent');
    else if (d.billy.match) reasons.push('Tide matches Billy Ho\'s rule');
    const t = targetFor(d, settings);
    const lure = lureAdvice(d, settings);
    return {
      place: c.place, day: d, score: c.score, reasons: reasons.slice(0, 3), target: t,
      colours: lure.main.slice(0, 2), redAt: turnsRedAt(d), near: c.near, trip: c.home <= 40 ? tripCheck(d, c.home, settings.skiRangeKm) : null,
    };
  };
  return { pick: detail(pick), alt: detail(alt) };
}

/** Rows for the spot-by-day grid. */
export function gridModel(entries, n = 7) {
  return entries.map((e) => ({
    place: e.place,
    cells: e.days.slice(0, n).map((d) => ({ date: d.date, rating: d.rating, win: shortWindow(d.best), outlook: d.outlook, warn: d.warn })),
  }));
}
export { hh };
