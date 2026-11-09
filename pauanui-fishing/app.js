import {
  DEFAULTS, fetchForecast, buildDays, tidesFromModel, parseLinz, parseLinzCsv, applyTideOffsets, mergeTides, nzNow,
  weekday, windowLabel, compass, dateOf, fmtMins, parseMaoriCalendar, lureAdvice, speciesOutlook, todaysTips, gearList,
} from './core.js';
import { SOURCES, SPECIES, HABITATS } from './knowledge.js';
import { setAreas, getAreas, protectedNear, insideProtected, KIND_TEXT, RULES_URL } from './protected.js';
import { bestBet, gridModel, targetFor, tripCheck, turnsRedAt } from './plan.js';
import { parseCoords, parseGpx, conditionsAt, spotsForToday, shelter, satelliteUrl, wetmapsUrl, km, trySpots, logStats, ISLANDS } from './spots.js';

const $ = (s) => document.querySelector(s);
const app = $('#app'), statusEl = $('#status'), h1 = $('#h1'), back = $('#back');
const STRIP_FROM = 4, STRIP_TO = 21; // hours shown in the week strip (inclusive)

// ---------- state ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
let settings = { ...DEFAULTS, ...load('pf.settings', {}) };
// Saved spots keep their own name/position but pick up newer defaults (e.g. tide corrections) by name.
settings.places = settings.places.map((p) => ({ ...(DEFAULTS.places.find((d) => d.name === p.name) || {}), ...p }));
let linzText = localStorage.getItem('pf.linz') || '';
let caches = load('pf.caches', {});
let placeIdx = Math.max(0, +(localStorage.getItem('pf.place') || 0));
const places = () => settings.places;
const cur = () => places()[Math.min(placeIdx, places().length - 1)];
const keyOf = (p) => `${p.lat},${p.lon}`;
let cache = caches[keyOf(cur())] || null;
let days = [], tides = [], showNight = false, weekIdx = 0;
let trips = load('pf.trips', []); // one-tap logs made without a GPS fix
let spots = load('pf.spots', []);
let maori = {}; // loaded from data/maori.json (fishing.net.nz Māori fishing calendar, 2026-2028)
async function loadProtected() {
  try { const r = await fetch('data/protected.json'); if (r.ok) { setAreas(await r.json()); render(); } } catch { /* offline: warnings just won't show */ }
}
async function loadMaori() {
  try { const r = await fetch('data/maori.json'); if (r.ok) { maori = await r.json(); render(); } } catch { /* offline: chips just don't show */ }
}
const MAORI_STARS = { Excellent: '★★★', Good: '★★', Poor: '★' };
const saveSpots = () => localStorage.setItem('pf.spots', JSON.stringify(spots));
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- data: every spot is loaded so the first screen can compare them ----------
const officialRaw = {}; // `${port}-${year}` -> LINZ events
const tideFor = (p) => p.tide || settings.tide;
const tideCorrection = () => tideFor(cur());
// Per-spot rules: stricter limits for far spots, and no open-coast wind flags inside the harbour.
const rulesFor = (p) => ({ ...settings, ...(p.limits || {}), ...(p.harbour ? { offshoreMinWind: 1e9, opposedMinWind: 1e9 } : {}) });
const homePt = () => ({ lat: settings.lat, lon: settings.lon });
const placeData = {}; // spot name -> { cache, tides, days }

async function ensureOfficial() {
  let added = false;
  for (const p of places()) {
    const fc = caches[keyOf(p)];
    if (!fc) continue;
    const port = tideFor(p).port || 'tauranga';
    for (const y of new Set(fc.hours.map((h) => h.date.slice(0, 4)))) {
      const key = `${port}-${y}`;
      if (officialRaw[key]) continue;
      try {
        const r = await fetch(`data/${key}.csv`);
        if (!r.ok) continue;
        officialRaw[key] = parseLinzCsv(await r.text()); added = true;
      } catch { /* offline first run: model tides still work */ }
    }
  }
  if (added) { recompute(); render(); }
}

function computePlace(p) {
  const fc = caches[keyOf(p)];
  if (!fc) return null;
  const corr = tideFor(p), port = corr.port || 'tauranga';
  const official = applyTideOffsets(Object.entries(officialRaw).filter(([k]) => k.startsWith(port + '-')).flatMap(([, v]) => v).sort((x, y) => (x.t < y.t ? -1 : 1)), corr);
  const td = mergeTides(mergeTides(tidesFromModel(fc.hours), official), parseLinz(linzText));
  return { cache: fc, tides: td, days: buildDays(fc, rulesFor(p), nzNow(), td).slice(0, 14) };
}

function recompute() {
  for (const p of places()) placeData[p.name] = computePlace(p);
  const c = placeData[cur().name];
  cache = c?.cache || null; tides = c?.tides || []; days = c?.days || [];
}

function setStatus(msg, err = false) { statusEl.textContent = msg; statusEl.className = err ? 'err' : ''; }
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
function statusLine() {
  if (!cache) return;
  const stale = Date.now() - cache.fetchedAt > 3 * 3600e3;
  setStatus(`${cur().name} · updated ${ago(cache.fetchedAt)}${stale ? ' – stale' : ''} · ${cur().lat}, ${cur().lon}`, stale && !navigator.onLine);
}

async function refresh(force = false) {
  const stale = (p) => { const c = caches[keyOf(p)]; return !c || force || Date.now() - c.fetchedAt >= 30 * 60e3; };
  for (const k of Object.keys(caches)) if (!places().some((p) => keyOf(p) === k)) delete caches[k]; // drop forecasts for removed spots
  const todo = places().filter(stale);
  recompute(); render(); statusLine();
  if (!todo.length) return;
  setStatus(`Loading ${todo.length > 1 ? todo.length + ' spots' : todo[0].name}…`);
  let failed = null;
  await Promise.all(todo.map(async (p) => { try { caches[keyOf(p)] = await fetchForecast(p.lat, p.lon); } catch (e) { failed = e; } }));
  localStorage.setItem('pf.caches', JSON.stringify(caches));
  recompute(); render(); statusLine();
  if (failed) setStatus(`Couldn't refresh everything (${failed.message}). Showing the latest data we have.`, true);
}

// ---------- formatting ----------
const n1 = (v) => (v == null ? '–' : (+v).toFixed(1));
const n0 = (v) => (v == null ? '–' : Math.round(v));
const srcLinks = (ids = []) => ids.map((id) => SOURCES[id]).filter(Boolean).map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.title}</a>`).join(' · ');
const lab = { GO: 'GO', MAYBE: 'MAYBE', NOGO: 'NO-GO' };
const arrow = (deg) => (deg == null ? '' : `<span style="display:inline-block;transform:rotate(${Math.round(deg + 180)}deg)" aria-hidden="true">↑</span>`);
const hhmm = (t) => t.slice(11, 16);
const range = (a, b, f = n0) => (a == null ? '–' : Math.abs(a - b) < (f === n0 ? 0.5 : 0.05) ? f(a) : `${f(a)}–${f(b)}`);
const cls = (v, lim, f) => (v == null ? '' : v >= lim * f ? 'x' : v >= lim ? 'w' : '');

const maoriChip = (d) => {
  const r = maori[d.date], ok = d.billy.match === true;
  if (!r && !ok) return '';
  return `<span class="mp mp-${r || 'none'}" title="Māori fishing calendar: ${r || 'not loaded'}${ok ? '; best window matches Billy Ho\'s tide rule' : ''}">🌙${r ? MAORI_STARS[r] : ''}${ok ? '✓' : ''}</span> `;
};

// ---------- first screen: answer first ----------
const nzDay = (date) => `${weekday(date)} ${+date.slice(8)}`;
const protectedHtml = (p) => {
  const near = protectedNear(p.lat, p.lon, 4);
  if (!near.length) return '';
  return `<div class="dsum warn"><div class="big"><b>⚠ Protected areas near ${esc(p.name)}</b></div>
    ${near.map((n) => `<div class="sub">• <b>${esc(n.area.name)}</b> – ${n.inside ? 'this spot\'s position is INSIDE it' : n.km.toFixed(1) + ' km from this spot\'s position'}. ${KIND_TEXT[n.area.kind]}.</div>`).join('')}
    <div class="sub dim">Boundaries come from OpenStreetMap and are only a guide – see them on the <a href="#map">map</a>, and check the official rules before fishing near one: <a href="${RULES_URL}" target="_blank" rel="noopener">Fisheries NZ recreational rules</a> (the free "NZ Fishing Rules" app has size and bag limits).</div></div>`;
};
const colourChips = (cs) => cs.map((c) => `<span class="chip">${c}</span>`).join('');

function betHtml(b, title) {
  if (!b) return '';
  const d = b.day, t = b.target;
  return `<div class="best">
    <div class="big"><b>${title}</b><span class="badge ${d.rating}">${lab[d.rating]}${d.warn ? ' ⚠' : ''}</span></div>
    <button class="bigline" data-pick="${esc(b.place.name)}|${d.date}">${nzDay(d.date)} · ${windowLabel(d.best)} · ${esc(b.place.name)} ›</button>
    ${t.top ? `<div class="sub"><b>Try:</b> ${t.top.name} (${t.top.level}) – ${t.quick}</div><div class="lures">${colourChips(b.colours)}</div>` : '<div class="sub"><b>Try:</b> nothing reads Good or Fair for fish – a low-expectation day.</div>'}
    <div class="sub">${b.redAt ? `Conditions go red at ${String(b.redAt).padStart(2, '0')}:00 – be off before then.` : `Plan to be off by ${String(d.best.endH % 24).padStart(2, '0')}:00.`}${b.trip ? ` About ${b.trip.km} km from Pauanui: be back by ${b.trip.back}; ${b.trip.fuel}.` : ''}</div>
    <ul class="why">${b.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    ${b.near.length ? `<div class="sub warnline">⚠ ${esc(b.place.name)} is near ${esc(b.near[0].area.name)} – check the map before choosing where to fish.</div>` : ''}
  </div>`;
}

function topCards() {
  // Compare only spots in the same area as the selected one (Coromandel vs Auckland are 90+ km apart).
  const entries = places().filter((p) => km(p, cur()) < 40).map((p) => ({ place: p, days: placeData[p.name]?.days || [], home: km(homePt(), p) })).filter((e) => e.days.length);
  if (!entries.length) return '';
  const { pick, alt } = bestBet(entries, settings, maori);
  const best = pick ? betHtml(pick, 'Best bet this week') : '<div class="best"><div class="big"><b>Best bet this week</b><span class="badge NOGO">NO-GO</span></div><div class="sub">No GO or MAYBE window at any spot in the next 7 days. Check <b>Next week</b> below, or the day rows for the closest calls.</div></div>';
  const altLine = alt ? `<button class="altline" data-pick="${esc(alt.place.name)}|${alt.day.date}">Next best: ${nzDay(alt.day.date)} · ${esc(alt.place.name)} · ${lab[alt.day.rating]} ${windowLabel(alt.day.best)} ›</button>` : '';
  // spot-by-day grid
  const g = gridModel(entries, 7);
  const head = g[0].cells.map((c) => `<span>${weekday(c.date).slice(0, 2)}<br>${+c.date.slice(8)}</span>`).join('');
  const rows = g.map((r) => `<div class="grow"><span class="gname">${esc(r.place.name)}</span>${r.cells.map((c) => `<button class="cell ${c.rating}${c.outlook ? ' est' : ''}" data-pick="${esc(r.place.name)}|${c.date}" title="${esc(r.place.name)} ${c.date}: ${lab[c.rating]}">${c.win || '·'}${c.warn ? '<sup>⚠</sup>' : ''}</button>`).join('')}</div>`).join('');
  const grid = `<div class="dsum"><div class="big"><b>${km(cur(), homePt()) < 40 ? 'Coromandel spots' : 'Spots here'}, all week</b><span class="dim">tap a cell</span></div><div class="grow ghead"><span class="gname"></span>${head}</div>${rows}<div class="sub dim">Cell = best window start–end hour. Faded cells (≈) are wind and rain only. Green GO, amber MAYBE, red NO-GO.</div></div>`;
  const species = [...SPECIES.map((s) => s.name), 'Other'].map((n) => `<option ${n === (localStorage.getItem('pf.lastSpecies') || 'Snapper') ? 'selected' : ''}>${n}</option>`).join('');
  const log = `<div class="logbar"><span>Fished today?</span><select id="lg-species">${species}</select><button data-log="fish" class="save">🐟 Fish</button><button data-log="blank">Blank</button></div>`;
  return `${best}${altLine}${grid}${log}${protectedHtml(cur())}`;
}

async function logTrip(result) {
  const species = result === 'fish' ? $('#lg-species')?.value || '' : '';
  localStorage.setItem('pf.lastSpecies', $('#lg-species')?.value || '');
  const when = nzNow();
  const rec = { t: when, result, species, lure: '', notes: '', conds: conditionsAt(cache, tides, when), place: cur().name };
  setStatus('Logging your trip…');
  const pos = await new Promise((res) => (navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => res(p.coords), () => res(null), { enableHighAccuracy: true, timeout: 8000 }) : res(null)));
  let msg;
  if (pos) {
    const here = { lat: pos.latitude, lon: pos.longitude };
    let s = spots.find((x) => km(x, here) < 0.4);
    if (!s) {
      s = { id: newId(), name: `New spot ${nzDay(when.slice(0, 10))}`, lat: +here.lat.toFixed(5), lon: +here.lon.toFixed(5), notes: 'Saved from a one-tap trip log – rename it in 📍', habitat: [], depth: null, catches: [], created: when };
      spots.push(s);
    }
    s.catches.push(rec); saveSpots();
    const pr = insideProtected(here.lat, here.lon);
    msg = `Logged ${result === 'fish' ? 'fish' : 'a blank'} at ${s.name}.${pr ? ` ⚠ That position is inside ${pr.area.name} – check the rules.` : ''}`;
  } else {
    trips.push(rec); localStorage.setItem('pf.trips', JSON.stringify(trips));
    msg = `Logged ${result === 'fish' ? 'fish' : 'a blank'} (no GPS fix, so no spot saved).`;
  }
  setStatus(msg, msg.includes('⚠'));
  render();
}

// ---------- week view ----------
function weekView() {
  if (!days.length) { app.innerHTML = '<div class="empty">No forecast yet.</div>'; return; }
  const cells = STRIP_TO - STRIP_FROM + 1;
  const axis = Array.from({ length: cells }, (_, i) => `<span>${(STRIP_FROM + i) % 4 === 0 ? STRIP_FROM + i : ''}</span>`).join('');
  if (weekIdx > 0 && days.length <= 7) weekIdx = 0;
  const shown = days.slice(weekIdx * 7, weekIdx * 7 + 7);
  const rows = shown.map((d) => {
    const strip = d.hours.filter((h) => h.h >= STRIP_FROM && h.h <= STRIP_TO).map((h) => {
      const inWin = d.best && h.h >= d.best.startH && h.h < d.best.endH;
      return `<i class="${h.r}${h.day ? '' : ' night'}${h.past ? ' past' : ''}${inWin ? ' win' : ''}" title="${hhmm(h.t)} ${lab[h.r]}"></i>`;
    }).join('');
    const s = d.stats;
    const wd = weekday(d.date), dn = +d.date.slice(8), mon = new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-NZ', { month: 'short', timeZone: 'UTC' });
    const badge = (d.outlook ? '≈ ' : '') + (d.best ? `${lab[d.rating]} ${windowLabel(d.best)}` : 'NO-GO') + (d.warn ? ' ⚠' : '');
    return `<button class="day${d.outlook ? ' est' : ''}" data-date="${d.date}">
      <div class="dhead"><span class="dname">${wd} ${dn}<small>↑${hhmm(d.sunrise)} ↓${hhmm(d.sunset)}</small></span><span>${maoriChip(d)}${d.dive.level === 'Great' ? '<span title="Great dive day">🤿</span> ' : ''}<span class="badge ${d.rating}">${badge}</span></span></div>
      <div class="strip" style="--n:${cells}">${strip}</div>
      <div class="stats">
        <span>Wind <b>${range(s.windMin, s.windMax)}</b> g<b>${n0(s.gustMax)}</b></span>
        <span>Sea <b>${range(s.seaMin, s.seaMax, n1)}</b></span>
        <span>Swell <b>${n1(s.swH)}</b> ${n0(s.swP)}s ${compass(s.swD)}</span>
        <span>Rain <b>${s.rainTotal < 0.05 ? '0' : n0(s.rainTotal)}</b></span>
      </div></button>`;
  }).join('');
  const wk = days.length > 7 ? `<div class="seg"><button data-week="0" class="${weekIdx === 0 ? 'on' : ''}">This week</button><button data-week="1" class="${weekIdx === 1 ? 'on' : ''}">Next week</button></div>` : '';
  const estNote = weekIdx === 1 ? '<div class="hint dim">≈ Outlook only: this far out the forecast has wind, gusts and rain but no sea, swell or tide data (it runs out after about 9 days), so ratings use wind and rain only and sea height is unknown. Treat as a rough guide and re-check closer to the day.</div>' : '';
  app.innerHTML = `${topCards()}${wk}${estNote}<div class="axis"><div class="strip" style="--n:${cells}">${axis}</div></div>${rows}
    <div class="legend"><i class="GO"></i>GO<i class="MAYBE"></i>Maybe<i class="NOGO"></i>No-go<i class="win"></i>best window · kt · m · mm, daylight ranges, swell at window</div>
    <div class="legend">🌙★★★ = Māori fishing calendar day rating (Excellent ★★★, Good ★★, Poor ★) · ✓ = best window is on the tide Billy Ho favours (waxing moon → outgoing, waning → incoming) · 🤿 = great dive day. ${Object.keys(maori).some((k) => k >= shown[0].date) ? '' : `Ratings not loaded (<a href="${SOURCES.maori.url}" target="_blank" rel="noopener">open calendar ↗</a>).`}</div>`;
}

// ---------- day view ----------
const dayTides = (date) => tides.filter((e) => dateOf(e.t) === date);
const det = (title, inner, open = false) => `<details class="dsum"${open ? ' open' : ''}><summary><b>${title}</b></summary>${inner}</details>`;
const lvlClass = (l) => (l === 'Good' || l === 'Great' ? 'GO' : l === 'Fair' || l === 'OK' ? 'MAYBE' : 'NOGO');

function dayView(date) {
  const i = days.findIndex((d) => d.date === date);
  if (i < 0) return weekView();
  const L = rulesFor(cur()), f = L.maybeFactor, d = days[i], s = d.stats;
  const tl = dayTides(date);
  const corr = tideCorrection();
  const src = tl.some((e) => e.src === 'LINZ') ? (linzText.trim() ? 'LINZ (pasted)' : (corr.hw === 0 && corr.lw === 0 ? `LINZ official, ${corr.name} (primary port)` : `LINZ official, ${corr.name} correction`)) : 'model (approx.)';
  const tideHtml = tl.length
    ? tl.map((e) => `<span><b>${e.type === 'H' ? 'High' : 'Low'}</b>${hhmm(e.t)} <span class="dim">${e.m.toFixed(1)}m</span></span>`).join('')
    : '<span class="dim">No tide data</span>';
  const moonTxt = `${d.moon.name} · ${Math.round(d.moon.illum * 100)}% · ${d.moon.tide === 'spring' ? 'spring tides (bigger run)' : d.moon.tide === 'neap' ? 'neap tides (smaller run)' : 'mid-range tides'}`;
  const lure = lureAdvice(d, settings);
  const outlook = speciesOutlook(d, settings);
  const tips = todaysTips(d, outlook, settings);
  const gear = gearList(d, outlook);
  const tg = targetFor(d, settings);
  const refH = d.hours.find((h) => h.h === (d.best?.startH ?? 8));
  const sh = refH ? shelter(refH.wdir, refH.wind, spots) : null;
  const swSh = refH && !cur().harbour && refH.sw >= 0.4 ? shelter(refH.swd, refH.sw, spots) : null;
  const here = { lat: cur().lat, lon: cur().lon };
  const nearIslands = ISLANDS.filter((x) => km(x, here) < 30).map((x) => x.name.replace(' Islands', '').replace(' Island', '')).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const fromHome = km(homePt(), here);
  const trip = fromHome <= 40 ? tripCheck(d, fromHome, settings.skiRangeKm) : null; // Pauanui-based fuel check only makes sense near Pauanui
  const redAt = turnsRedAt(d);
  const at = (h) => `${String(h.h).padStart(2, '0')}:00`;

  // Heads-up: safety, shelter, swell, protected areas – all in one place
  const heads = [];
  for (const x of d.safety) heads.push(x.text);
  if (d.cold) heads.push(d.cold);
  if (sh && !sh.light) heads.push(`Wind ${sh.fromDir} ${n0(refH.wind)} kt at ${at(refH)}: the <b>${sh.leeDir} side</b> of ${nearIslands || 'any island or headland'} is sheltered, the ${sh.fromDir} side exposed.`);
  else if (sh) heads.push('Light wind, so shelter matters little today.');
  if (swSh) heads.push(`Swell ${n1(refH.sw)} m from the ${swSh.fromDir} (${n0(refH.swp)} s): spots on the ${swSh.leeDir} side of an island are sheltered from it.`);
  for (const x of (sh?.near || [])) heads.push(`<b>${esc(x.spot)}</b> is on the ${x.where} of ${x.island} (wind).`);
  for (const x of (swSh?.near || [])) heads.push(`<b>${esc(x.spot)}</b> is on the ${x.where} of ${x.island} (swell).`);
  const prot = protectedNear(cur().lat, cur().lon, 4);
  for (const n of prot) heads.push(`⚠ ${esc(n.area.name)} is ${n.inside ? 'where this spot is' : n.km.toFixed(1) + ' km away'}: ${KIND_TEXT[n.area.kind]}. See the <a href="#map">map</a>.`);
  if (d.outlook) heads.push('≈ Outlook only: no sea, swell or tide data this far out. Rating uses wind and rain; check again closer to the day.');

  // Spots you've tagged, ranked (never inside a protected area)
  const blocked = (sp) => insideProtected(sp.lat, sp.lon);
  let yourSpotsCard = '';
  if (spots.length) {
    const cond = d.best ? conditionsAt(cache, tides, `${d.date}T${String(d.best.startH).padStart(2, '0')}:30`) : null;
    const hits = spotsForToday(spots, cond);
    const ranked = trySpots(spots, outlook, sh, hits, homePt(), blocked);
    const closed = spots.filter(blocked);
    yourSpotsCard = `<div class="dsum"><div class="big"><b>Your spots for this window</b><a href="#spots" class="dim">manage</a></div>
      ${cond ? `<div class="sub dim">Conditions at ${String(d.best.startH).padStart(2, '0')}:30 – tide ${cond.stage || '?'}, wind ${compass(cond.wdir)} ${n0(cond.wind)} kt, ${cond.light}</div>` : ''}
      ${ranked.length ? ranked.map((r) => `<div class="sub">• <b>${esc(r.spot.name)}</b>${r.best ? ` – ${r.best.species} (${r.best.level}): suits ${r.best.fit.join(', ')}` : ''}${r.notes.length ? '; ' + r.notes.join('; ') : ''}${r.km != null && r.km < 40 ? ` · ${Math.round(r.km)} km from Pauanui` : ''} · <a href="${satelliteUrl(r.spot.lat, r.spot.lon)}" target="_blank" rel="noopener">satellite</a> · <a href="${wetmapsUrl(r.spot.lat, r.spot.lon)}" target="_blank" rel="noopener">chart</a></div>`).join('')
        : '<div class="sub">Nothing to suggest yet. Tag your spots with habitat and depth (📍) and log trips, and this ranks them.</div>'}
      ${closed.length ? `<div class="sub warnline">⚠ Not suggested – inside a protected area: ${closed.map((c) => esc(c.name)).join(', ')}.</div>` : ''}</div>`;
  }

  const favs = (settings.favs || '').trim();
  const sst = d.hours.find((h) => h.h === 12)?.sst;
  const winHrs = d.best ? d.hours.filter((h) => h.h >= d.best.startH && h.h < d.best.endH) : [];
  const turns = [...new Map(winHrs.filter((h) => h.turn).map((h) => [h.turn.t, h.turn])).values()];
  const turnTxt = d.best ? (turns.length ? `Tide turn in window: ${turns.map((e) => `${e.type === 'H' ? 'high' : 'low'} ${hhmm(e.t)}`).join(', ')}` : 'No tide turn in window') : '';
  const solTxt = d.sol.map((p) => `${p.kind === 'major' ? '★ Major' : '☆ Minor'} ${fmtMins(((p.start % 1440) + 1440) % 1440)}–${fmtMins(((p.end % 1440) + 1440) % 1440)}`).join(' · ');

  const hs = d.hours.filter((h) => showNight || h.day);
  const body = hs.map((h) => {
    const inWin = d.best && h.h >= d.best.startH && h.h < d.best.endH;
    return `<tr class="${h.r}${h.day ? '' : ' night'}${h.past ? ' past' : ''}${inWin ? ' inwin' : ''}" title="${h.why.join('; ')}">
      <td>${hhmm(h.t)}${h.sol ? `<span class="dim" title="${h.sol} bite period">${h.sol === 'major' ? ' ★' : ' ☆'}</span>` : ''}</td>
      <td><span class="${cls(h.wind, L.windMax, f)}">${n0(h.wind)}</span>/<span class="${cls(h.gust, L.gustMax, f)}">${n0(h.gust)}</span> ${arrow(h.wdir)}<span class="dim">${compass(h.wdir)}</span>${h.flags.length ? `<span class="x" title="${h.flags.join(', ')}"> ⚠</span>` : ''}</td>
      <td class="${cls(h.wave, L.seaMax, f)}">${n1(h.wave)}</td>
      <td>${n1(h.sw)}<span class="dim"> ${n0(h.swp)}s ${arrow(h.swd)}${compass(h.swd)}</span></td>
      <td class="${h.rain >= L.rainHeavy ? 'x' : h.rain >= L.rainLight ? 'w' : ''}">${h.rain < 0.05 ? '·' : n1(h.rain)}</td>
      <td>${h.sl == null ? '–' : (h.sl >= 0 ? '+' : '') + h.sl.toFixed(1)}${h.turn ? `<span class="turn" title="tide turn ${hhmm(h.turn.t)}"> ${h.turn.type === 'H' ? '▲' : '▼'}</span>` : ''}</td></tr>`;
  }).join('');

  const speciesDetail = outlook.filter((x) => x.level !== 'Slow').concat(outlook.filter((x) => x.level === 'Slow')).map((x) => `<div class="sp"><div class="big"><span>${x.name}</span><span class="badge ${lvlClass(x.level)}">${x.level}</span></div><div class="sub">${x.tip}</div><div class="sub dim">Season: ${x.season}</div><div class="sub dim">${x.reasons.join(' · ') || 'nothing in its favour today'}</div><div class="src">${srcLinks(x.src)}</div></div>`).join('');

  const long = new Date(date + 'T12:00:00Z').toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  h1.textContent = long;
  app.innerHTML = `
    <div class="dsum">
      <div class="big"><span class="badge ${d.rating}" style="font-size:14px">${d.best ? `${lab[d.rating]} window ${windowLabel(d.best)}` : 'NO-GO all day'}</span>
        <span>↑${hhmm(d.sunrise)}  ↓${hhmm(d.sunset)}</span></div>
      <div class="tides">${tideHtml}</div>
      <div class="sub">Wind ${range(s.windMin, s.windMax)} g${n0(s.gustMax)} kt · sea ${range(s.seaMin, s.seaMax, n1)} m · rain ${s.rainTotal < 0.05 ? '0' : n1(s.rainTotal)} mm${turnTxt ? ' · ' + turnTxt.toLowerCase() : ''}</div>
      <div class="sub">🌙 Māori fishing calendar: <b>${maori[d.date] || 'n/a'}</b> · Billy Ho: ${d.billy.waxing ? 'waxing → outgoing tide' : 'waning → incoming tide'}${d.billy.stage ? `; window is on a ${d.billy.stage} tide ${d.billy.match ? '✓' : '(no match)'}` : ''}</div>
      <div class="sub dim">Tides: ${src}${src === 'model (approx.)' ? ' – LINZ tables not loaded yet' : ''}${cur().note ? ' · ' + esc(cur().note) : ''}</div>
    </div>
    <div class="dsum">
      <div class="big"><b>What to try</b></div>
      ${tg.top ? `<div class="sub"><b>${tg.top.name}</b> (${tg.top.level}) – ${tg.quick}</div>${tg.others.map((o) => `<div class="sub dim">Also ${o.level}: ${o.name}</div>`).join('')}` : '<div class="sub">No species reads Good or Fair for fish today – a low-expectation day.</div>'}
      <div class="lures">${colourChips(lure.main.slice(0, 3))}</div>
      <div class="sub dim">Colours for ${d.runoff.label.toLowerCase()} water${favs ? ` · your favourites: ${esc(favs)}` : ''}</div>
      ${d.best ? `<div class="sub">${redAt ? `Conditions go red at ${String(redAt).padStart(2, '0')}:00 – be off before then.` : `Plan to be off by ${String(d.best.endH % 24).padStart(2, '0')}:00.`}</div>` : ''}
      ${trip ? `<div class="sub">${trip.km} km from Pauanui: be back on the beach by <b>${trip.back}</b> (an hour before sunset); ${trip.fuel}.</div>` : ''}
    </div>
    ${heads.length ? `<div class="dsum warn"><div class="big"><b>Heads-up</b></div>${heads.map((x) => `<div class="sub">${x}</div>`).join('')}</div>` : ''}
    ${yourSpotsCard}
    <div class="dsum">
      <div class="big"><b>Tips for today</b><span class="dim">angler advice – moon and tide-turn effects are beliefs, not measurements</span></div>
      ${tips.slice(0, 3).map((t) => `<div class="sub tip">${t.text}<div class="src">${srcLinks(t.src)}</div></div>`).join('')}
    </div>
    ${det('More: fish activity by species', `${speciesDetail}<div class="sub dim">This is advice from fishing.net.nz articles, not a prediction: the seasons and rules come from them, the point weights are mine and nothing here has been checked against catches yet. Log your trips (🐟 on the first page) to test it.</div>`)}
    ${tips.length > 3 ? det('More: other tips', tips.slice(3).map((t) => `<div class="sub tip">${t.text}<div class="src">${srcLinks(t.src)}</div></div>`).join('')) : ''}
    ${det('More: water, lures and pressure', `<div class="big"><span class="badge clar-${d.runoff.level}">${d.runoff.label}</span></div>
      <div class="sub">Rain: ${d.runoff.mm24} mm in the 24 h before dawn · ${d.runoff.mm72} mm over 72 h${sst != null ? ` · sea ${sst.toFixed(1)}°C` : ''}</div>
      ${d.runoff.clearing ? '<div class="sub">Water is clearing after rain – food gets flushed out, so the shallows can fire as it clears.</div>' : ''}
      <div class="lures">${colourChips(lure.main)}</div><div class="sub">Also try: ${lure.alt.join(', ')}</div>
      ${d.pressure ? `<div class="sub">Pressure ${d.pressure.hpa} hPa, ${d.pressure.trend} (${d.pressure.delta > 0 ? '+' : ''}${d.pressure.delta} over 6 h) – ${d.pressure.text}.</div>` : ''}
      <div class="sub dim">Because: ${lure.why}. Rule of thumb.</div>`)}
    ${d.outlook ? '' : det('More: dive outlook', `<div class="big"><span class="badge ${lvlClass(d.dive.level)}">${d.dive.level}${d.dive.window ? ' ' + windowLabel(d.dive.window) : ''}</span></div><div class="sub">${d.dive.why.join(' · ')}</div><div class="sub dim">Conditions only – midday sun, small swell, little recent rain, ideally slack water. Dive to your training.</div>`)}
    ${det('More: what to take', gear.map((g) => `<div class="sub">• ${g.text}<div class="src">${srcLinks(g.src)}</div></div>`).join(''))}
    ${det('More: getting live bait', `<div class="sub">Jack mackerel, koheru, piper, blue mackerel, small kahawai and mullet are the usual baits; around 100 mm suits kingfish, john dory and big snapper.</div>
      <div class="sub">Sabiki: always a sinker on the end, bring fish in as soon as hooked, twitch gently and vary depth; drop to a smaller size if there are no bites. Luminous beads need a light to recharge.</div>
      <div class="sub">Berley (bread/rice with crushed pilchard, in a mesh bag) draws bait; with berley use tiny baited hooks held still. At night a light on the water pulls in bait and its food.</div>
      <div class="sub">Keeping bait alive: a big bucket or inflatable paddling pool with a small battery aerator; handle gently, don't overcrowd, keep a dip net. Piper last for hours on a small circle hook through the bill. Big kahawai suit a bridle rig with a circle hook.</div>
      <div class="sub">Pilchards need much finer gear (about size 16 hooks, 2 kg leader). Hook a lively bait for kingfish in the upper shoulder, and keep it lively.</div>`)}
    ${det('More: moon and bite periods', `<div class="sub">${moonTxt}</div><div class="sub">Bite periods (moon-based folklore, not part of the rating): ${solTxt || 'none'}. ★ major, ☆ minor, ▲▼ = hour near a tide turn.</div><div class="sub dim">Compare with fishing.net.nz's ${srcLinks(['biteTimes', 'maori'])}.</div>`)}
    <div class="nav"><button id="prev" ${i === 0 ? 'disabled' : ''}>‹ ${i ? weekday(days[i - 1].date) : ''}</button><button id="next" ${i === days.length - 1 ? 'disabled' : ''}>${i < days.length - 1 ? weekday(days[i + 1].date) : ''} ›</button></div>
    <table><thead><tr><th>Time</th><th>Wind/gust kt</th><th>Sea m</th><th>Swell m·s·dir</th><th>Rain</th><th>Tide</th></tr></thead><tbody>${body}</tbody></table>
    <label class="toggle"><input type="checkbox" id="night" style="width:auto" ${showNight ? 'checked' : ''}> Show night hours</label>
    <p class="hint dim">Amber = over your limit, red = beyond the MAYBE margin. Tap a row's time for why. Size and bag limits: <a href="${RULES_URL}" target="_blank" rel="noopener">Fisheries NZ rules</a> / the "NZ Fishing Rules" app.</p>`;
  $('#prev')?.addEventListener('click', () => go(days[i - 1].date));
  $('#next')?.addEventListener('click', () => go(days[i + 1].date));
  $('#night').addEventListener('change', (e) => { showNight = e.target.checked; render(); });
}

// ---------- map ----------
let leafletMap = null, leafletLoading = null, mapToken = 0;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  leafletLoading ||= new Promise((resolve, reject) => {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'vendor/leaflet/leaflet.css' });
    const js = Object.assign(document.createElement('script'), { src: 'vendor/leaflet/leaflet.js', onload: resolve, onerror: () => reject(new Error('map library failed to load')) });
    document.head.append(css, js);
  });
  return leafletLoading;
}
async function mapView() {
  const token = ++mapToken;
  if (leafletMap) { leafletMap.remove(); leafletMap = null; }
  app.innerHTML = '<div class="seg"><button id="m-sat" class="on">Satellite</button><button id="m-chart">LINZ chart (Wet Maps)</button></div><div id="map"></div><iframe id="chartframe" title="Wet Maps – LINZ charts" hidden></iframe><p class="hint dim">Needs a data connection – tiles won\'t load offshore, so use this for planning. Satellite shows reefs, kelp and wash as darker patches. <b style="color:#e5484d">Red areas are protected (no fishing)</b> – a guide from OpenStreetMap, confirm with DOC. Not for navigation: use your Garmin charts on the water.</p><p class="hint"><a href="https://wetmaps.co.nz/#10/-37.0100/175.9500" target="_blank" rel="noopener">Open LINZ charts in Wet Maps ↗</a> – a free NZ chart map by Gabe Young (also has Navionics, satellite, measuring). The chart tab above embeds it; if it stays blank on your phone, use this link instead. Tap Chart (Wet Maps) on any spot to open it centred there in a new tab.</p>';
  const showChart = (on) => {
    const f = $('#chartframe');
    if (on && !f.src) f.src = wetmapsUrl(-37.0, 175.97, 11);
    f.hidden = !on; $('#map').hidden = on;
    $('#m-chart').classList.toggle('on', on); $('#m-sat').classList.toggle('on', !on);
    if (!on && leafletMap) setTimeout(() => leafletMap.invalidateSize(), 50);
  };
  $('#m-sat').onclick = () => showChart(false);
  $('#m-chart').onclick = () => showChart(true);
  try { await loadLeaflet(); } catch (e) { $('#map').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!isMap() || token !== mapToken) return;
  const L = window.L;
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
  const sea = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, attribution: 'Seamarks © OpenSeaMap contributors' });
  leafletMap = L.map('map', { layers: [sat, sea] }).setView([-37.0, 175.95], 11);
  L.control.layers({ 'Satellite': sat, 'Map': osm }, { 'Sea marks': sea }, { collapsed: true }).addTo(leafletMap);
  const today = days[0];
  const refH = today?.hours.find((h) => h.h === (today.best?.startH ?? 8));
  const sh = refH ? shelter(refH.wdir, refH.wind, spots) : null;
  for (const p of settings.places) L.circleMarker([p.lat, p.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#12304e', fillOpacity: 1 }).bindTooltip(p.name, { permanent: false }).addTo(leafletMap);
  for (const isl of ISLANDS) {
    const arrowDeg = refH ? Math.round(refH.wdir + 180) : 0; // downwind
    const html = `<div class="islbl"><span style="display:inline-block;transform:rotate(${arrowDeg}deg)">↑</span> ${isl.name.replace(' Islands', '').replace(' Island', '')}${sh ? `<br><small>lee: ${sh.leeDir}</small>` : ''}</div>`;
    L.marker([isl.lat, isl.lon], { icon: L.divIcon({ html, className: '', iconSize: [90, 34], iconAnchor: [45, 17] }), interactive: false }).addTo(leafletMap);
  }
  let ranked = [];
  if (today && spots.length) {
    const outlook = speciesOutlook(today, settings);
    const cond = today.best ? conditionsAt(cache, tides, `${today.date}T${String(today.best.startH).padStart(2, '0')}:30`) : null;
    ranked = trySpots(spots, outlook, sh, spotsForToday(spots, cond), { lat: settings.lat, lon: settings.lon }).map((r) => r.spot.id);
  }
  const here = cur();
  const pts = [...settings.places, ...ISLANDS].filter((p) => km(p, here) < 40).map((p) => [p.lat, p.lon]);
  for (const s of spots) {
    const top = ranked.includes(s.id);
    pts.push([s.lat, s.lon]);
    L.circleMarker([s.lat, s.lon], { radius: top ? 9 : 6, color: '#fff', weight: 2, fillColor: top ? '#2fbf71' : '#8fa8bd', fillOpacity: 0.95 })
      .bindPopup(`<b>${esc(s.name)}</b><br>${(s.habitat || []).join(', ') || 'no habitat tags'}${s.depth ? ' · ' + s.depth + ' m' : ''}${top ? '<br>★ suggested today' : ''}<br><a href="${satelliteUrl(s.lat, s.lon)}" target="_blank" rel="noopener">Google satellite</a> · <a href="${wetmapsUrl(s.lat, s.lon)}" target="_blank" rel="noopener">Chart (Wet Maps)</a>`).addTo(leafletMap);
  }
  for (const ar of getAreas()) L.polygon(ar.rings, { color: '#e5484d', weight: 1.5, fillColor: '#e5484d', fillOpacity: 0.22 }).bindTooltip(`${ar.name} – ${KIND_TEXT[ar.kind]}`, { sticky: true }).addTo(leafletMap);
  leafletMap.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
}

// ---------- spots ----------
const habBoxes = (sel) => HABITATS.map((h) => `<label class="chk"><input type="checkbox" class="hab" value="${h}" ${sel.includes(h) ? 'checked' : ''}> ${h}</label>`).join('');
function spotsView() {
  const fmtT = (t) => new Date(t + ':00Z').toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false });
  const spOpts = [...SPECIES.map((s) => s.name), 'Other'].map((n) => `<option>${n}</option>`).join('');
  const cards = spots.map((s) => `
    <div class="dsum" data-id="${s.id}">
      <div class="big"><b>${esc(s.name)}</b><span class="dim">${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</span></div>
      ${(() => { const pr = protectedNear(s.lat, s.lon, 0.5)[0]; return pr ? `<div class="sub warnline">⚠ ${pr.inside ? 'Inside' : 'Within ' + Math.round(pr.km * 1000) + ' m of'} ${esc(pr.area.name)} – ${KIND_TEXT[pr.area.kind]}. Check before fishing here.</div>` : ''; })()}
      ${s.notes ? `<div class="sub">${esc(s.notes)}</div>` : ''}
      <div class="sub dim">${(s.habitat || []).length || s.depth ? `Habitat: ${(s.habitat || []).join(', ') || '–'}${s.depth ? ' · ' + s.depth + ' m' : ''}` : 'No habitat tags yet – add them below so it can be matched to species.'}</div>
      <div class="sub"><a href="${satelliteUrl(s.lat, s.lon)}" target="_blank" rel="noopener">Satellite</a> · <a href="${wetmapsUrl(s.lat, s.lon)}" target="_blank" rel="noopener">Chart (Wet Maps)</a> · <a href="#" data-act="del">Delete spot</a></div>
      ${(s.catches || []).slice().reverse().map((c) => `<div class="sub dim">• ${fmtT(c.t)} · ${c.result === 'fish' ? 'Fish' : 'Blank'}${c.species ? ' · ' + esc(c.species) : ''}${c.lure ? ' · ' + esc(c.lure) : ''}${c.notes ? ' · ' + esc(c.notes) : ''}${c.conds ? ` · tide ${c.conds.stage || '?'}, wind ${compass(c.conds.wdir)} ${n0(c.conds.wind)} kt, ${c.conds.light}` : ' · (conditions unavailable)'}</div>`).join('')}
      <details><summary class="dim">Habitat &amp; depth</summary>
        <div class="habs">${habBoxes(s.habitat || [])}</div>
        <label>Depth (m) <input type="number" class="h-depth" inputmode="decimal" value="${s.depth ?? ''}"></label>
        <button data-act="savehab" class="save">Save habitat</button>
      </details>
      <details><summary class="dim">Log a trip here</summary>
        <label>When <input type="datetime-local" class="c-when" value="${nzNow()}"></label>
        <label>Result <select class="c-result"><option value="fish">Fish</option><option value="blank">Blank</option></select></label>
        <label>Species <select class="c-species">${spOpts}</select></label>
        <label>Lure / bait <input class="c-lure" placeholder="e.g. 4&quot; pink grub"></label>
        <label>Notes <input class="c-notes" placeholder="size, depth…"></label>
        <button data-act="catch" class="save">Save trip</button>
      </details>
    </div>`).join('');
  const st = logStats(spots, trips);
  const statRows = Object.entries(st.groups).map(([g, obj]) => (Object.keys(obj).length ? `<div class="sub"><b>${g}:</b> ${Object.entries(obj).map(([k, v]) => `${k} ${v.fish}/${v.n}`).join(' · ')}</div>` : '')).join('');
  const statsCard = `<div class="dsum"><div class="big"><b>What your log says</b><span class="dim">${st.all} trips · ${st.fishTrips} with fish</span></div>${st.all ? statRows + `<div class="sub dim">${st.all < 10 ? 'Fewer than 10 trips – too few to trust yet. ' : ''}Numbers are trips with fish / all trips. Blanks count as much as fish.</div>` : '<div class="sub">No trips logged yet. Tap 🐟 Fish or Blank on the first page after each trip – blanks matter as much as fish.</div>'}</div>`;
  app.innerHTML = `
    ${statsCard}
    <div class="dsum">
      <div class="big"><b>Add a spot</b></div>
      <label>Name <input id="sp-name" placeholder="e.g. Slipper north reef"></label>
      <label>Position <input id="sp-pos" placeholder="37°01.234'S 175°53.456' E or -37.02, 175.89" style="width:190px"></label>
      <div class="sub dim">Habitat (optional):</div><div class="habs" id="sp-hab">${habBoxes([])}</div>
      <label>Depth (m) <input id="sp-depth" type="number" inputmode="decimal"></label>
      <div class="row"><button id="sp-gps">Use my location</button><button id="sp-add" class="save">Save spot</button></div>
      <div class="hint" id="sp-msg">Paste the position from your Garmin GPS / ActiveCaptain (degrees &amp; decimal minutes or decimal), or tap Use my location.</div>
      <div class="row"><label class="filebtn">Import GPX / backup<input type="file" id="sp-file" accept=".gpx,.json,text/xml,application/json" hidden></label><button id="sp-export">Export backup</button></div>
      <div class="hint">Stored on this phone only. Export a backup now and then – clearing Safari data erases it.</div>
    </div>
    ${cards || '<div class="empty">No spots yet.</div>'}`;
}
const spMsg = (t) => { const el = $('#sp-msg'); if (el) el.textContent = t; };
const newId = () => Math.random().toString(36).slice(2, 9);
const addSpot = (p) => {
  if (spots.some((s) => km(s, p) < 0.03 && s.name === p.name)) return false;
  spots.push({ id: newId(), name: p.name, lat: p.lat, lon: p.lon, notes: p.notes || '', habitat: p.habitat || [], depth: p.depth ?? null, catches: [], created: nzNow() });
  return true;
};
app.addEventListener('click', (e) => {
  if (!isSpots()) return;
  const act = e.target.dataset?.act, card = e.target.closest('[data-id]');
  if (e.target.id === 'sp-gps') {
    e.preventDefault(); spMsg('Getting location…');
    navigator.geolocation?.getCurrentPosition((p) => { $('#sp-pos').value = `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`; spMsg(`Location found (±${Math.round(p.coords.accuracy)} m).`); },
      (er) => spMsg(`Couldn't get location (${er.message}). Paste the position instead.`), { enableHighAccuracy: true, timeout: 15000 });
  } else if (e.target.id === 'sp-add') {
    const pos = parseCoords($('#sp-pos').value), name = $('#sp-name').value.trim();
    if (!pos) return spMsg("Couldn't read that position. Try -37.0206, 175.8909 or 37°01.234'S 175°53.456'E.");
    if (!name) return spMsg('Give the spot a name.');
    const prHit = insideProtected(pos.lat, pos.lon);
    addSpot({ ...pos, name, habitat: [...document.querySelectorAll('#sp-hab .hab:checked')].map((x) => x.value), depth: parseFloat($('#sp-depth').value) || null }); saveSpots(); spotsView(); spMsg(prHit ? `Saved – but ⚠ this position is inside ${prHit.area.name}: ${KIND_TEXT[prHit.area.kind]}.` : 'Saved.');
  } else if (e.target.id === 'sp-export') {
    const url = URL.createObjectURL(new Blob([JSON.stringify(spots, null, 1)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'pauanui-spots.json' }).click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else if (act === 'del' && card) {
    e.preventDefault();
    if (confirm('Delete this spot and its trips?')) { spots = spots.filter((s) => s.id !== card.dataset.id); saveSpots(); spotsView(); }
  } else if (act === 'savehab' && card) {
    const s = spots.find((x) => x.id === card.dataset.id);
    s.habitat = [...card.querySelectorAll('.hab:checked')].map((x) => x.value); s.depth = parseFloat(card.querySelector('.h-depth').value) || null;
    saveSpots(); spotsView();
  } else if (act === 'catch' && card) {
    const s = spots.find((x) => x.id === card.dataset.id), q = (c) => card.querySelector(c);
    const when = q('.c-when').value || nzNow();
    s.catches.push({ t: when.slice(0, 16), result: q('.c-result').value, species: q('.c-species').value, lure: q('.c-lure').value.trim(), notes: q('.c-notes').value.trim(), conds: conditionsAt(cache, tides, when.slice(0, 16)) });
    saveSpots(); spotsView();
  }
});
app.addEventListener('change', async (e) => {
  if (e.target.id !== 'sp-file') return;
  const f = e.target.files[0]; if (!f) return;
  const text = await f.text();
  let n = 0;
  try {
    if (/\.json$/i.test(f.name)) { for (const s of JSON.parse(text)) if (Number.isFinite(s.lat) && Number.isFinite(s.lon) && !spots.some((x) => x.id === s.id)) { spots.push({ ...s, id: s.id || newId(), catches: s.catches || [] }); n++; } }
    else for (const p of parseGpx(text)) if (addSpot(p)) n++;
  } catch { return spMsg("That file couldn't be read."); }
  saveSpots(); spotsView(); spMsg(`Imported ${n} spot${n === 1 ? '' : 's'}.`);
});

// ---------- routing ----------
const route = () => (location.hash.match(/^#d=(\d{4}-\d{2}-\d{2})$/) || [])[1] || null;
const isSpots = () => location.hash === '#spots';
const isMap = () => location.hash === '#map';
function go(date) { location.hash = date ? `#d=${date}` : ''; if (!date) history.replaceState(null, '', location.pathname + location.search); render(); }
function renderPlaces() {
  $('#places').innerHTML = places().map((p, i) => `<button data-i="${i}" class="${i === placeIdx ? 'on' : ''}">${p.name.replace(/[<&]/g, '')}</button>`).join('');
}
$('#places').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  placeIdx = +b.dataset.i; localStorage.setItem('pf.place', placeIdx);
  recompute(); render(); statusLine(); refresh(false);
});
function render() {
  renderPlaces();
  const r = route();
  back.hidden = !r && !isSpots() && !isMap();
  if (isMap()) { h1.textContent = 'Map'; mapView(); window.scrollTo(0, 0); }
  else if (isSpots()) { h1.textContent = 'My spots'; spotsView(); window.scrollTo(0, 0); }
  else if (r) { dayView(r); window.scrollTo(0, 0); }
  else { h1.textContent = 'Pauanui Fishing'; weekView(); }
}
addEventListener('hashchange', render);
back.addEventListener('click', () => { history.length > 1 && route() ? history.back() : go(null); });
app.addEventListener('click', (e) => {
  const w = e.target.closest('[data-week]'); if (w) { weekIdx = +w.dataset.week; render(); return; }
  const pk = e.target.closest('[data-pick]');
  if (pk) {
    const [n, date] = pk.dataset.pick.split('|'), i = places().findIndex((p) => p.name === n);
    if (i >= 0) { placeIdx = i; localStorage.setItem('pf.place', i); recompute(); statusLine(); }
    go(date); return;
  }
  const lg = e.target.closest('[data-log]'); if (lg) { logTrip(lg.dataset.log); return; }
  const b = e.target.closest('.day'); if (b) go(b.dataset.date);
});
$('#refresh').addEventListener('click', () => refresh(true));
$('#mapBtn').addEventListener('click', () => { location.hash = '#map'; });
$('#spotsBtn').addEventListener('click', () => { location.hash = '#spots'; });

// ---------- settings ----------
const dlg = $('#settings'), form = $('#sform');
function linzHint() {
  const ev = parseLinz(form.linz.value);
  if (!form.linz.value.trim()) return 'Using modelled tides.';
  if (!ev.length) return '⚠︎ No tide times recognised – need dates plus "time height" pairs.';
  return `Recognised ${ev.length} tides, ${ev[0].t.slice(0, 10)} → ${ev.at(-1).t.slice(0, 10)}.`;
}
$('#gear').addEventListener('click', () => {
  for (const k of ['windMax', 'gustMax', 'seaMax', 'rainHeavy', 'maybeFactor', 'skiRangeKm']) form[k].value = settings[k];
  form.places.value = places().map((p) => `${p.name}, ${p.lat}, ${p.lon}`).join('\n');
  form.linz.value = linzText;
  form.favs.value = settings.favs || '';
  $('#linzhint').textContent = linzHint();
  $('#gridhint').textContent = cache ? `${cur().name}: Open-Meteo grid cells used: weather ${cache.grid.wx.map((v) => v.toFixed(2))}, marine ${cache.grid.marine.map((v) => v.toFixed(2))}.` : '';
  dlg.showModal();
});
form.linz.addEventListener('input', () => { $('#linzhint').textContent = linzHint(); });
form.addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'save') return;
  const next = { ...settings };
  for (const k of ['windMax', 'gustMax', 'seaMax', 'rainHeavy', 'maybeFactor', 'skiRangeKm']) {
    const v = parseFloat(form[k].value);
    if (Number.isFinite(v)) next[k] = v;
  }
  const parsed = form.places.value.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((p) => p.length >= 3 && p[0] && Number.isFinite(+p[1]) && Number.isFinite(+p[2]))
    .map((p) => ({ name: p[0], lat: +p[1], lon: +p[2] }));
  const sameAsDefault = (ps) => JSON.stringify(ps.map((p) => [p.name, p.lat, p.lon])) === JSON.stringify(DEFAULTS.places.map((p) => [p.name, p.lat, p.lon]));
  if (parsed.length) next.places = sameAsDefault(parsed) ? DEFAULTS.places : parsed.map((p) => ({ ...(DEFAULTS.places.find((d) => d.name === p.name) || {}), ...p }));
  next.favs = form.favs.value;
  settings = next;
  placeIdx = Math.min(placeIdx, settings.places.length - 1);
  linzText = form.linz.value;
  // Store only what differs from the defaults, so later default improvements still reach this phone.
  localStorage.setItem('pf.settings', JSON.stringify(Object.fromEntries(Object.entries(settings).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(DEFAULTS[k])))));
  localStorage.setItem('pf.linz', linzText);
  refresh(false);
});
$('#reset').addEventListener('click', () => {
  settings = { ...DEFAULTS }; linzText = '';
  localStorage.removeItem('pf.settings'); localStorage.removeItem('pf.linz'); placeIdx = 0; localStorage.removeItem('pf.place');
  dlg.close(); refresh(true);
});

// ---------- boot ----------
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
recompute(); render(); statusLine();
refresh(false).then(ensureOfficial);

loadMaori();
loadProtected();
