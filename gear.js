// What to take: picks your rod/reel combos for the day's situation and checks lure weights against each rod's rating.
// Pure logic (no DOM). Data lives in knowledge.js (COMBOS, MY_LURES).
import { COMBOS, MY_LURES } from './knowledge.js';

const byId = (id) => COMBOS.find((c) => c.id === id);
const range = (g) => (g[0] === g[1] ? `${g[0]} g` : `${g[0]}–${g[1]} g`);
export const ratingText = (c) => (c.lureG ? `${range(c.lureG)} rating` : 'no lure rating on record');

/** How a single lure weight sits against a combo's rod rating: fits | over | under | norating | unknown. */
export function fitOf(g, combo) {
  if (g == null || Number.isNaN(g)) return 'unknown';
  if (!combo.lureG) return 'norating';
  if (g > combo.lureG[1]) return 'over';
  if (g < combo.lureG[0]) return 'under';
  return 'fits';
}

/** A weight range (e.g. 60–90 g slow-jigs) against a combo. */
export function rangeFit(g, combo) {
  if (!combo.lureG) return { status: 'norating', text: `rod has ${ratingText(combo)} – keep to light soft plastics and micro-jigs and check the blank` };
  const [mn, mx] = combo.lureG, [lo, hi] = g;
  if (lo >= mn && hi <= mx) return { status: 'fits', text: `fits its ${range(combo.lureG)} rating` };
  if (hi < mn) return { status: 'under', text: `below its ${mn} g minimum – don't use here` };
  if (lo > mx) return { status: 'over', text: `over its ${mx} g maximum – don't use here` };
  const ok = [Math.max(lo, mn), Math.min(hi, mx)];
  const bits = [];
  if (lo < mn) bits.push(`${lo}–${mn - 1} g is below its ${mn} g minimum`);
  if (hi > mx) bits.push(`above ${mx} g is over its maximum`);
  return { status: 'partial', text: `only ${range(ok)} fits; ${bits.join(' and ')}` };
}

// Techniques and the lure weights the articles give them. pref = combos in order of preference.
const MODES = (o) => [
  { id: 'snapperJig', species: 'Snapper', title: 'Slow-jig snapper', lure: 'inchiku / kabura slow-jig', g: [60, 90], pref: ['saltistmq4000d'], when: o.ok('Snapper') },
  { id: 'workup', species: 'Snapper', title: 'Workup sliders', lure: 'orange slider', g: [100, 150], pref: ['tranx200hg', 'saltist6500h'], when: o.ok('Snapper') && o.month >= 9 && o.month <= 12 },
  { id: 'light', species: 'Snapper', title: 'Light soft plastics and micro-jigs', lure: '3–4" soft plastic or micro-jig', g: [7, 28], pref: ['ak3000a', 'saltistmq4000d'], when: o.ok('Snapper') || o.ok('Kahawai') || o.ok('Trevally') },
  { id: 'kingJig', species: 'Kingfish', title: 'Kingfish jigs and stickbaits', lure: 'jig (stickbait weight varies)', g: [40, 120], pref: ['saltist6500h'], when: o.ok('Kingfish') },
  { id: 'kingHeavy', species: 'Kingfish', title: 'Heavy kingfish jigs', lure: 'heavy jig', g: [100, 180], pref: ['tranx200hg'], when: o.lvl('Kingfish') === 'Good' || (o.ok('Kingfish') && o.spring) },
  { id: 'live', species: 'Kingfish', title: 'Live bait for kingfish', lure: 'live bait (koheru, jack mackerel)', g: null, pref: ['saltist6500h'], when: o.ok('Kingfish') },
  { id: 'gurnard', species: 'Gurnard', title: 'Gurnard drift', lure: 'ledger / flasher rig, small softbait', g: null, pref: ['ak3000a'], when: o.ok('Gurnard') },
];

/**
 * Recommend combos for today's situation.
 * outlook: speciesOutlook() result; lures: your tackle box (name + grams or null).
 */
export function gearPlan(day, outlook, lures = MY_LURES) {
  const lvl = (n) => outlook.find((s) => s.name === n)?.level;
  const o = {
    month: +day.date.slice(5, 7), spring: day.moon?.tide === 'spring', lvl,
    ok: (n) => lvl(n) === 'Good' || lvl(n) === 'Fair',
  };
  const score = (n) => outlook.find((s) => s.name === n)?.score ?? 0;
  const prio = (m) => score(m.species) + (m.id === 'kingHeavy' ? 0.5 : 0);
  const modes = MODES(o).filter((m) => m.when).sort((a, b) => prio(b) - prio(a));

  // Each mode goes to its first preferred combo that can actually carry it; the others are shown as alternatives.
  const take = new Map();
  for (const m of modes) {
    const opts = m.pref.map((id) => byId(id)).map((c) => ({ combo: c, fit: m.g ? rangeFit(m.g, c) : { status: 'fits', text: c.id === 'ak3000a' ? 'light braid and a sensitive tip suit it (line 4–8 lb)' : `its ${c.rodSpec.split(', ').pop()} is plenty` } }));
    const best = opts.find((x) => x.fit.status === 'fits') || opts.find((x) => x.fit.status === 'norating') || opts.find((x) => x.fit.status === 'partial') || opts[0];
    if (best.fit.status === 'over' || best.fit.status === 'under') continue; // never recommend a mode a rod can't carry
    if (!take.has(best.combo.id)) take.set(best.combo.id, { combo: best.combo, modes: [] });
    take.get(best.combo.id).modes.push({ id: m.id, title: m.title, lure: m.lure, g: m.g, fit: best.fit, alts: opts.filter((x) => x !== best).map((x) => ({ name: x.combo.name, text: x.fit.text, status: x.fit.status })) });
  }

  // Check every lure in your tackle box against every rated rod
  const rated = COMBOS.filter((c) => c.lureG);
  const lureCheck = lures.map((l) => {
    if (l.g == null) return { lure: l, level: 'warn', text: `⚠ ${l.name}: weight unconfirmed – weigh it or check the packet before pairing it with a rod.` };
    const fits = rated.filter((c) => fitOf(l.g, c) === 'fits'), over = rated.filter((c) => fitOf(l.g, c) === 'over'), under = rated.filter((c) => fitOf(l.g, c) === 'under');
    const heaviest = rated.reduce((a, c) => (c.lureG[1] > a.lureG[1] ? c : a));
    if (!fits.length && over.length === rated.length) return { lure: l, level: 'warn', text: `⚠ ${l.name} ${l.g} g exceeds every rated rod (the closest, ${heaviest.name}, tops out at ${heaviest.lureG[1]} g). Don't use it on these.` };
    const parts = [];
    if (fits.length) parts.push(`fits ${fits.map((c) => `${c.name} (${range(c.lureG)})`).join(' and ')}`);
    if (over.length) parts.push(`over the rating of ${over.map((c) => `${c.name} (max ${c.lureG[1]} g)`).join(' and ')}`);
    if (under.length) parts.push(`below the minimum of ${under.map((c) => `${c.name} (min ${c.lureG[0]} g)`).join(' and ')}`);
    return { lure: l, level: over.length || under.length ? 'warn' : 'ok', text: `${l.name} ${l.g} g: ${parts.join('; ')}.` };
  });

  const notes = [];
  if (o.spring && modes.some((m) => m.g)) notes.push('Spring tides mean more current: use the heavier end of each rod\'s lure range.');
  if (modes.some((m) => m.id === 'light')) notes.push(`${byId('ak3000a').name}: ${byId('ak3000a').note}`);
  if (take.has('saltist6500h') && byId('saltist6500h').note) notes.push(`${byId('saltist6500h').name}: ${byId('saltist6500h').note}`);

  const jigging = modes.some((m) => ['snapperJig', 'workup', 'kingJig', 'kingHeavy'].includes(m.id));
  return { take: [...take.values()], lureCheck: jigging ? lureCheck : [], notes, modes: modes.map((m) => m.id) };
}

/** Parse the settings textarea: one lure per line, "name, grams" (grams may be blank = unknown). */
export function parseLures(text) {
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.lastIndexOf(',');
    const name = (i < 0 ? l : l.slice(0, i)).trim();
    const g = i < 0 ? NaN : parseFloat(l.slice(i + 1));
    return { name, g: Number.isFinite(g) && g > 0 ? g : null };
  }).filter((l) => l.name);
}
