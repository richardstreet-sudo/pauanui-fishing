// Pure logic shared by the web app and the GitHub Action (ES module, no DOM).
import { SPECIES, TIPS, GEAR } from './knowledge.js';

export const DEFAULTS = {
  lat: -37.02,
  lon: 175.89,
  // Spots you fish; each gets its own forecast. Open-Meteo's marine grid is ~8 km, so nearby spots can share cells.
  places: [
    { name: 'Shoe / Slipper', lat: -37.02, lon: 175.93 },
    { name: 'Boat Cove', lat: -36.93, lon: 175.86 }, // just off Waipapa Island (island centre; refine in settings)
    { name: 'Aldermen', lat: -36.96, lon: 176.086 },
  ],
  diveSea: 0.6,     // m – "great dive day" needs total sea at/below this
  diveSwell: 0.6,   // m
  windMax: 10,      // kt  – GO below this
  gustMax: 15,      // kt
  seaMax: 0.8,      // m total significant wave height
  rainLight: 0.5,   // mm/h – at/above this an hour is at best MAYBE
  rainHeavy: 2.5,   // mm/h – at/above this an hour is NO-GO
  maybeFactor: 1.25, // MAYBE if within 25% over a limit, else NO-GO
  minWin: 2,        // hours
  maxWin: 4,
  twilightMins: 90, // hours centred within this of sunrise/sunset get a bonus
  offshoreFrom: 210, // wind FROM this sector (deg) blows away from the beach (Pauanui beach faces east)
  offshoreTo: 330,
  offshoreMinWind: 6, // kt
  opposedMinWind: 8,  // kt, easterly wind over an ebb tide = steep chop at the entrance
  coldSea: 18,        // deg C – below this, wetsuit weather
  turnMins: 60,     // hours centred within this of a high/low tide get a (smaller) bonus
  turnBonus: 1,     // x1.5 on spring-tide days, x0.5 on neaps
};

const pad = (n) => String(n).padStart(2, '0');
export const dateOf = (t) => t.slice(0, 10);
export const minsOf = (t) => +t.slice(11, 13) * 60 + +t.slice(14, 16);
// Open-Meteo returns naive local strings ("2026-11-09T06:00"); treat as UTC ms purely for arithmetic.
export const toMs = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13) || 0, +t.slice(14, 16) || 0);
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 16);
export const fmtMins = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export function nzNow(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Auckland', hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function weekday(date, style = 'short') {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-NZ', { weekday: style, timeZone: 'UTC' });
}
export const dayOfWeek = (date) => new Date(date + 'T12:00:00Z').getUTCDay(); // 0=Sun … 6=Sat

// ---------- fetching ----------

async function getJson(url, f) {
  const r = await f(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).hostname}`);
  return r.json();
}

export async function fetchForecast(lat, lon, f = globalThis.fetch) {
  const tz = 'timezone=Pacific%2FAuckland&forecast_days=7';
  const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,precipitation_probability,cloud_cover,weather_code,visibility,pressure_msl&past_days=3` +
    `&daily=sunrise,sunset&wind_speed_unit=kn&${tz}`;
  const mrUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
    `&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_level_height_msl,sea_surface_temperature&${tz}`;
  const [wx, mr] = await Promise.all([getJson(wxUrl, f), getJson(mrUrl, f)]);

  const mIdx = new Map(mr.hourly.time.map((t, i) => [t, i]));
  const m = (key, t) => { const i = mIdx.get(t); const v = i === undefined ? null : mr.hourly[key][i]; return v ?? null; };
  const hours = wx.hourly.time.map((t, i) => ({
    t, date: dateOf(t), h: +t.slice(11, 13),
    wind: wx.hourly.wind_speed_10m[i], gust: wx.hourly.wind_gusts_10m[i], wdir: wx.hourly.wind_direction_10m[i],
    rain: wx.hourly.precipitation[i], pop: wx.hourly.precipitation_probability[i],
    wave: m('wave_height', t), wper: m('wave_period', t), wavedir: m('wave_direction', t),
    sw: m('swell_wave_height', t), swp: m('swell_wave_period', t), swd: m('swell_wave_direction', t),
    sl: m('sea_level_height_msl', t), sst: m('sea_surface_temperature', t), cloud: wx.hourly.cloud_cover[i],
    code: wx.hourly.weather_code[i], vis: wx.hourly.visibility[i], p: wx.hourly.pressure_msl[i],
  }));
  const daily = {};
  wx.daily.time.forEach((d, i) => { daily[d] = { sunrise: wx.daily.sunrise[i], sunset: wx.daily.sunset[i] }; });
  return {
    hours, daily, fetchedAt: Date.now(), lat, lon,
    grid: { wx: [wx.latitude, wx.longitude], marine: [mr.latitude, mr.longitude] },
  };
}

// ---------- rating ----------

export function rateHour(h, L = DEFAULTS) {
  const f = L.maybeFactor;
  const checks = [
    ['wind', h.wind, L.windMax], ['gust', h.gust, L.gustMax], ['sea', h.wave, L.seaMax],
  ];
  const why = [];
  let r = 'GO';
  for (const [name, v, lim] of checks) {
    if (v == null || Number.isNaN(v)) { if (r === 'GO') r = 'MAYBE'; why.push(`${name}: no data`); continue; }
    if (v >= lim * f) { r = 'NOGO'; why.push(`${name} ${v} ≥ ${+(lim * f).toFixed(2)}`); }
    else if (v >= lim) { if (r === 'GO') r = 'MAYBE'; why.push(`${name} ${v} ≥ ${lim}`); }
  }
  const rain = h.rain ?? 0;
  if (rain >= L.rainHeavy) { r = 'NOGO'; why.push(`rain ${rain} mm/h`); }
  else if (rain >= L.rainLight) { if (r === 'GO') r = 'MAYBE'; why.push(`rain ${rain} mm/h`); }
  if (h.code >= 95) { r = 'NOGO'; why.push('thunderstorm'); }
  if ((h.code >= 45 && h.code <= 48) || (h.vis != null && h.vis < 2000)) { r = 'NOGO'; why.push('fog / poor visibility'); }
  return { r, why };
}

const inSector = (d, a, b) => d != null && (a <= b ? d >= a && d <= b : d >= a || d <= b);
function tideState(tides, mid) {
  let last = null;
  for (const e of tides) { if (toMs(e.t) <= mid) last = e; else break; }
  return last ? (last.type === 'H' ? 'ebb' : 'flood') : null;
}
const spans = (hh) => {
  const out = []; let a = null, b = null;
  for (const h of hh) { if (a !== null && h.h === b) b = h.h + 1; else { if (a !== null) out.push([a, b]); a = h.h; b = h.h + 1; } }
  if (a !== null) out.push([a, b]);
  return out.map(([x, y]) => `${pad(x)}:00–${pad(y % 24)}:00`).join(', ');
};
const SAFETY_TEXT = {
  offshore: 'Offshore wind (blowing away from the beach) – a breakdown drifts you out:',
  opposed: 'Wind against the ebb tide – likely steep chop at the Tairua entrance/bar:',
  storm: 'Thunderstorm risk:',
  fog: 'Fog / poor visibility:',
};

function pressureNote(all, date, refH) {
  const i = all.findIndex((h) => h.date === date && h.h === refH);
  const p0 = all[i]?.p, p6 = all[i - 6]?.p;
  if (p0 == null || p6 == null) return null;
  const d = +(p0 - p6).toFixed(1);
  const trend = d <= -3 ? 'falling fast' : d <= -1 ? 'falling' : d >= 3 ? 'rising fast' : d >= 1 ? 'rising' : 'steady';
  const text = {
    'falling fast': 'a front is arriving – the bite is often good just before it, but check wind and rain',
    falling: 'often a good bite ahead of a change',
    rising: 'clearing after a change – can be slow for a few hours',
    'rising fast': 'clearing quickly after a front – can be slow, seas may still be lumpy',
    steady: p0 >= 1020 ? 'steady high pressure – bites can be slower, so stick to dawn and dusk' : 'steady pressure',
  }[trend];
  return { hpa: Math.round(p0), delta: d, trend, text };
}

function pickWindow(hs, L, sr, ss, allowMaybe, turnMult) {
  let best = null;
  for (let i = 0; i < hs.length; i++) {
    for (let len = L.minWin; len <= L.maxWin; len++) {
      let score = 0, valid = true, allGo = true;
      for (let k = 0; k < len; k++) {
        const h = hs[i + k];
        if (!h || !h.day || h.past || h.r === 'NOGO' || (!allowMaybe && h.r !== 'GO')) { valid = false; break; }
        if (h.r !== 'GO') allGo = false;
        score += h.r === 'GO' ? 3 : 1;
        const c = h.h * 60 + 30;
        if (Math.abs(c - sr) <= L.twilightMins || Math.abs(c - ss) <= L.twilightMins) score += 3;
        if (h.turn) score += L.turnBonus * turnMult;
      }
      if (valid && score > (best?.score ?? 0)) {
        best = { score, startH: hs[i].h, endH: hs[i + len - 1].h + 1, len, quality: allGo ? 'GO' : 'MAYBE' };
      }
    }
  }
  return best;
}

export function buildDays(fc, L = DEFAULTS, now = nzNow(), tides = []) {
  const nowHour = now.slice(0, 13);
  const byDate = new Map();
  for (const raw of fc.hours) {
    if (!byDate.has(raw.date)) byDate.set(raw.date, []);
    byDate.get(raw.date).push(raw);
  }
  const days = [];
  const today = now.slice(0, 10);
  for (const [date, list] of byDate) {
    const d = fc.daily[date];
    if (!d || date < today) continue; // past_days data is only used for runoff history
    const sr = minsOf(d.sunrise), ss = minsOf(d.sunset);
    const moon = moonInfo(date);
    const sol = solunar(date, fc.lat ?? L.lat, fc.lon ?? L.lon);
    const hs = list.map((raw) => {
      const { r, why } = rateHour(raw, L);
      const start = raw.h * 60;
      const mid = toMs(raw.t) + 30 * 60000;
      const turn = tides.find((e) => Math.abs(toMs(e.t) - mid) <= L.turnMins * 60000) || null;
      const sl = sol.find((p) => start < p.end && start + 60 > p.start);
      const flags = [];
      if (raw.wind >= L.offshoreMinWind && inSector(raw.wdir, L.offshoreFrom, L.offshoreTo)) flags.push('offshore');
      if (raw.wind >= L.opposedMinWind && inSector(raw.wdir, 45, 135) && tideState(tides, mid) === 'ebb') flags.push('opposed');
      if (raw.code >= 95) flags.push('storm');
      if ((raw.code >= 45 && raw.code <= 48) || (raw.vis != null && raw.vis < 2000)) flags.push('fog');
      return { ...raw, r, why, flags, day: start + 60 > sr - 30 && start < ss + 30, past: raw.t.slice(0, 13) < nowHour, turn, sol: sl ? sl.kind : null };
    });
    const runoff = runoffFor(fc.hours, date);
    const turnMult = moon.tide === 'spring' ? 1.5 : moon.tide === 'neap' ? 0.5 : 1;
    // GO windows always beat MAYBE windows; within a class the dawn/dusk bonus decides.
    const best = pickWindow(hs, L, sr, ss, false, turnMult) || pickWindow(hs, L, sr, ss, true, turnMult);
    const billy = billyHo(date, best, tides, moon);
    const scope = best ? hs.filter((h) => h.h >= best.startH && h.h < best.endH) : hs.filter((h) => h.day && !h.past);
    const safety = [];
    for (const k of ['offshore', 'opposed', 'storm', 'fog']) {
      const hh = scope.filter((h) => h.flags.includes(k));
      if (hh.length) safety.push({ k, text: `${SAFETY_TEXT[k]} ${spans(hh)}` });
    }
    const sst = hs.find((h) => h.h === 12)?.sst;
    const cold = sst != null && sst < L.coldSea ? `Sea ${sst.toFixed(1)}°C – wetsuit weather, falling in will be cold.` : null;
    const pressure = pressureNote(fc.hours, date, best ? best.startH : 8);
    const dl = hs.filter((h) => h.day);
    const nums = (k) => dl.map((h) => h[k]).filter((v) => v != null);
    const mx = (a) => (a.length ? Math.max(...a) : null);
    const mn = (a) => (a.length ? Math.min(...a) : null);
    const ref = (best && hs.find((h) => h.h === best.startH)) || dl[Math.floor(dl.length / 2)] || hs[9];
    const day = {
      date, sunrise: d.sunrise, sunset: d.sunset, sr, ss, hours: hs, best, moon, sol, runoff, billy, safety, loc: fc.lat != null ? [fc.lat, fc.lon] : null, cold, pressure, warn: safety.length > 0,
      rating: best ? best.quality : 'NOGO',
      stats: {
        windMin: mn(nums('wind')), windMax: mx(nums('wind')), gustMax: mx(nums('gust')),
        seaMin: mn(nums('wave')), seaMax: mx(nums('wave')),
        rainTotal: nums('rain').reduce((a, b) => a + b, 0), swH: ref?.sw, swP: ref?.swp, swD: ref?.swd,
        ref: ref?.h,
      },
    };
    day.dive = diveOutlook(day, L);
    days.push(day);
  }
  return days;
}

export const windowLabel = (b) => (b ? `${pad(b.startH)}:00–${pad(b.endH % 24)}:00` : '');

/**
 * Billy Ho's rule of thumb (fishing.net.nz Māori fishing calendar page): better on an incoming tide when the moon
 * is waning, and on an outgoing tide when it is waxing. We check the best window's tide stage against it.
 * His own day ratings (Excellent/Good/Poor) are not reproduced here – the app links to his calendar instead.
 */
export function billyHo(date, best, tides, moon) {
  const waxing = moon.age < 14.765;
  const want = waxing ? 'ebbing' : 'flooding';
  let stage = null;
  if (best) {
    const mid = Math.floor(((best.startH + best.endH) / 2) * 60);
    stage = tideStage(tides, `${date}T${pad(Math.floor(mid / 60))}:${pad(mid % 60)}`);
  }
  return { waxing, want, stage, match: stage == null ? null : stage === want };
}

const MON = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
/** Pasted text of the fishing.net.nz Māori fishing calendar page -> { 'YYYY-MM-DD': 'Excellent'|'Good'|'Poor' }. */
export function parseMaoriCalendar(text) {
  const out = {};
  const re = /\b(Excellent|Good|Poor)\s+fishing\s+on\s+[A-Za-z]+\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/gi;
  let m;
  while ((m = re.exec(String(text)))) {
    const mon = MON[m[3].toLowerCase()];
    if (mon) out[`${m[4]}-${pad(mon)}-${pad(+m[2])}`] = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  }
  return out;
}

// ---------- diving ----------

/**
 * Is it a good day to dive? Conditions only (not a safety judgement): small sea and swell, light wind, no rain,
 * clear-ish water (little recent runoff), high sun 09:00–16:00, and slack water in the window is a bonus.
 */
export function diveOutlook(day, L = DEFAULTS) {
  const f = L.maybeFactor;
  const okHour = (h, strict) => {
    if (!h.day || h.past || h.h < 9 || h.h > 15) return false;
    if (h.flags?.includes('storm') || h.flags?.includes('fog')) return false;
    const sea = strict ? L.diveSea : L.seaMax * f, swell = strict ? L.diveSwell : L.seaMax * f;
    return (h.wave ?? 0) <= sea && (h.sw ?? 0) <= swell && h.wind < (strict ? L.windMax : L.windMax * f)
      && h.gust < (strict ? L.gustMax : L.gustMax * f) && (h.rain ?? 0) < (strict ? L.rainLight : L.rainHeavy);
  };
  const pick = (strict) => {
    let best = null;
    for (let i = 0; i < day.hours.length; i++) {
      for (let len = L.minWin; len <= L.maxWin; len++) {
        const hs = day.hours.slice(i, i + len);
        if (hs.length < len || !hs.every((h) => okHour(h, strict))) break;
        const slack = hs.filter((h) => h.turn).length;
        const score = len * 2 + slack * 2;
        if (score > (best?.score ?? 0)) best = { score, startH: hs[0].h, endH: hs.at(-1).h + 1, slack: hs.find((h) => h.turn)?.turn ?? null };
      }
    }
    return best;
  };
  const clarity = day.runoff.level;
  const great = pick(true), ok = pick(false);
  let level = 'Poor', win = null;
  if (great && (clarity === 'clear' || clarity === 'tinged')) { level = 'Great'; win = great; }
  else if ((great || ok) && clarity !== 'muddy') { level = 'OK'; win = great || ok; }
  const hs = win ? day.hours.filter((h) => h.h >= win.startH && h.h < win.endH) : [];
  const mx = (k) => (hs.length ? Math.max(...hs.map((h) => h[k] ?? 0)) : null);
  const why = [`water ${day.runoff.label.toLowerCase()} (${day.runoff.mm72} mm rain, 3 days)`];
  if (win) why.unshift(`sea ≤${mx('wave').toFixed(1)} m, swell ≤${mx('sw').toFixed(1)} m, wind ≤${Math.round(mx('wind'))} kt`);
  else why.unshift('no calm, dry 2 h window between 09:00 and 16:00');
  if (win?.slack) why.push(`slack water about ${win.slack.t.slice(11, 16)}`);
  return { level, window: win, why };
}

// ---------- runoff / water clarity, lures ----------

/** Weighted rain over the 72 h before 06:00 on `date` (last 24 h x1, 24-48 h x0.6, 48-72 h x0.3). */
export function runoffFor(allHours, date) {
  const i0 = allHours.findIndex((h) => h.date === date && h.h === 6);
  if (i0 < 0) return { score: 0, level: 'clear', label: 'Clear', mm24: 0, mm72: 0, clearing: false };
  let score = 0, mm24 = 0, mm72 = 0;
  for (let k = 1; k <= 72; k++) {
    const v = allHours[i0 - k]?.rain ?? 0;
    score += v * (k <= 24 ? 1 : k <= 48 ? 0.6 : 0.3);
    mm72 += v; if (k <= 24) mm24 += v;
  }
  const level = score < 5 ? 'clear' : score < 15 ? 'tinged' : score < 40 ? 'stained' : 'muddy';
  const label = { clear: 'Clear', tinged: 'Slightly stained', stained: 'Stained', muddy: 'Muddy runoff' }[level];
  return { score: +score.toFixed(1), level, label, mm24: +mm24.toFixed(1), mm72: +mm72.toFixed(1), clearing: (level === 'stained' || level === 'muddy') && mm24 < 1 };
}

// Softbait colour picks from the fishing.net.nz "which softbait colours are best" top-10 (Mark Kitteridge) –
// pink/pearl, green, yellow/brown and bright orange all-rounders; silver/pearl for clear water and anchovies;
// glow/high-contrast (lime tiger, curried chicken) for murky or gloomy water.
const LURES = {
  clear: { bright: [['Silver / grey pearl', 'Pink & pearl', 'Green (motor oil)'], ['Blue & pearl (pilchard)', 'New penny (brown)']],
    mixed: [['Pink & pearl', 'Silver / pearl', 'Green (motor oil)'], ['Bright orange', 'Yellow & brown']],
    low: [['Pink & pearl', 'Bright orange', 'Nuclear chicken (red/green)'], ['Blue & pearl (pilchard)']] },
  tinged: { bright: [['Pink & pearl', 'Bright orange', 'Green (motor oil)'], ['Yellow & brown']],
    mixed: [['Pink & pearl', 'Bright orange', 'Green (motor oil)'], ['Yellow & brown']],
    low: [['Bright orange', 'Pink & pearl', 'Lime tiger glow'], ['Curried chicken (yellow/red)']] },
  stained: { bright: [['Bright orange', 'Lime tiger glow', 'Curried chicken (yellow/red)'], ['Pink (UV)', 'Nuclear chicken']],
    mixed: [['Bright orange', 'Lime tiger glow', 'Curried chicken (yellow/red)'], ['Pink (UV)', 'Nuclear chicken']],
    low: [['Lime tiger glow', 'Bright orange', 'Curried chicken (yellow/red)'], ['Nuclear chicken', 'Glow / lumo']] },
  muddy: { bright: [['Lime tiger glow', 'Bright orange', 'Curried chicken (yellow/red)'], ['Nuclear chicken']],
    mixed: [['Lime tiger glow', 'Bright orange', 'Curried chicken (yellow/red)'], ['Nuclear chicken', 'Glow / lumo']],
    low: [['Lime tiger glow', 'Glow / lumo', 'Bright orange'], ['Curried chicken (yellow/red)']] },
};

/** Rule-of-thumb lure colours from water clarity (recent rain), light (cloud, dawn/dusk) and chop. */
export function lureAdvice(day, L = DEFAULTS) {
  const hrs = day.best ? day.hours.filter((h) => h.h >= day.best.startH && h.h < day.best.endH) : day.hours.filter((h) => h.day);
  const clouds = hrs.map((h) => h.cloud).filter((v) => v != null);
  const cloud = clouds.length ? clouds.reduce((a, b) => a + b, 0) / clouds.length : 50;
  const twi = hrs.filter((h) => { const c = h.h * 60 + 30; return Math.abs(c - day.sr) <= L.twilightMins || Math.abs(c - day.ss) <= L.twilightMins; }).length;
  const light = cloud >= 75 || (hrs.length && twi * 2 >= hrs.length) ? 'low' : cloud < 40 ? 'bright' : 'mixed';
  const sea = Math.max(0, ...hrs.map((h) => h.wave ?? 0));
  const [main, alt] = LURES[day.runoff.level][light];
  const lightTxt = { low: 'low light (dawn/dusk or heavy cloud)', mixed: 'mixed light', bright: 'bright sun' }[light];
  const notes = [`${day.runoff.label.toLowerCase()} water (${day.runoff.mm72} mm rain in the 3 days before)`, `${lightTxt}, ~${Math.round(cloud)}% cloud`];
  if (sea >= 0.6) notes.push('some chop – go for more flash or a bigger profile');
  notes.push('pink works to ~30 m, add lumo deeper; going small (3–4")/silver or orange when anchovies are about');
  return { main, alt, light, cloud: Math.round(cloud), why: notes.join('; ') };
}

/**
 * Per-species "how fishy is it" read, driven by the sourced data in knowledge.js. Seasons and tide/light/moon/clarity
 * rules are paraphrased from fishing.net.nz articles; point weights and Good/Fair cut-offs are ours. A nudge, not a model.
 */
export function speciesOutlook(day, L = DEFAULTS) {
  const month = +day.date.slice(5, 7);
  const hrs = day.best ? day.hours.filter((h) => h.h >= day.best.startH && h.h < day.best.endH) : day.hours.filter((h) => h.day);
  const sst = day.hours.find((h) => h.h === 12)?.sst ?? null;
  const lure = lureAdvice(day, L);
  const light = lure.light;
  const turn = hrs.some((h) => h.turn);
  const spring = day.moon?.tide === 'spring';
  const afterFull = !!day.moon?.afterFull;
  const clarity = day.runoff.level;
  const tempWhy = `water ${sst == null ? '?' : sst.toFixed(1) + '°C'}`;
  return SPECIES.map((sp) => {
    const rules = [];
    const mp = (sp.months || []).find(([ms]) => ms.includes(month));
    rules.push([mp ? mp[1] : sp.monthDefault ?? 0, sp.seasonOnly ? 'season (conditions rules not in the guides)' : 'season']);
    if (sp.sst && sst != null) {
      const r = sp.sst.find(([lo, hi]) => (lo == null || sst >= lo) && (hi == null || sst <= hi));
      rules.push([r ? r[2] : 0, tempWhy]);
    }
    if (sp.light) rules.push([sp.light[light] ?? 0, 'light (dawn/dusk best)']);
    if (sp.turn) rules.push([turn ? sp.turn : 0, 'moving tide in window']);
    if (sp.spring) rules.push([spring ? sp.spring : 0, 'spring tides (more current)']);
    if (sp.afterFull) rules.push([afterFull ? sp.afterFull : 0, 'around/after full moon (often poor)']);
    if (sp.clarity) {
      const clearing = !!day.runoff.clearing;
      rules.push([(sp.clarity[clarity] ?? 0) + (clearing ? sp.clearing ?? 0 : 0), clearing && sp.clearing ? 'water clearing after rain (food flushed out)' : 'water clarity']);
    }
    if (sp.overcast) rules.push([lure.cloud >= 75 ? sp.overcast : 0, 'overcast']);
    let score = 0; const reasons = [];
    for (const [pts, why] of rules) if (pts) { score += pts; reasons.push(`${pts > 0 ? '+' : ''}${pts} ${why}`); }
    const tipRule = (sp.tips || []).find((t) => t.months.includes(month));
    return {
      name: sp.name, season: sp.season, tip: tipRule ? tipRule.text : sp.tip, score, reasons, src: sp.src,
      level: score >= sp.goodAt ? 'Good' : score >= sp.fairAt ? 'Fair' : 'Slow',
    };
  });
}

const kmBetween = (a, b) => {
  const dy = (a[0] - b[0]) * 111, dx = (a[1] - b[1]) * 111 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dx, dy);
};

/** Context-driven tips for the day (see TIPS in knowledge.js). */
export function todaysTips(day, outlook, L = DEFAULTS) {
  const home = { lat: L.lat, lon: L.lon }; // Pauanui, for distances
  const ctx = {
    month: +day.date.slice(5, 7), startH: day.best?.startH ?? null, hasWindow: !!day.best, rating: day.rating,
    turnInWindow: !!day.best && day.hours.some((h) => h.h >= day.best.startH && h.h < day.best.endH && h.turn),
    moon: day.moon, runoff: day.runoff, outlook, sst: day.hours.find((h) => h.h === 12)?.sst ?? null,
    km: day.loc && home ? kmBetween(day.loc, [home.lat, home.lon]) : 0, billy: day.billy,
  };
  return TIPS.filter((t) => t.when(ctx)).map((t) => ({ id: t.id, text: typeof t.text === 'function' ? t.text(ctx) : t.text, src: t.src }));
}

/** "What to take" suggestions from the species outlook and month. */
export function gearList(day, outlook) {
  const lvl = (n) => outlook.find((s) => s.name === n)?.level;
  const ctx = { month: +day.date.slice(5, 7), fair: (n) => lvl(n) === 'Good' || lvl(n) === 'Fair' };
  return GEAR.filter((g) => g.when(ctx)).map((g) => ({ text: g.text, src: g.src }));
}

// ---------- moon, solunar ----------

const SYN = 29.530588853;
const RAD = Math.PI / 180;

/** UTC ms for a naive Pacific/Auckland local time string. */
export function nzToUtcMs(t) {
  let g = toMs(t) - 13 * 3600e3;
  for (let k = 0; k < 2; k++) g += toMs(t) - toMs(nzNow(new Date(g)));
  return g;
}

export function moonInfo(date) {
  const jd = nzToUtcMs(date + 'T12:00') / 86400000 + 2440587.5;
  const age = (((jd - 2451550.1) % SYN) + SYN) % SYN;
  const dNew = Math.min(age, SYN - age), dFull = Math.abs(age - SYN / 2);
  const dQ1 = Math.abs(age - SYN / 4), dQ3 = Math.abs(age - (3 * SYN) / 4);
  const dSyz = Math.min(dNew, dFull), dQ = Math.min(dQ1, dQ3);
  const name = dNew < 1.5 ? 'New moon' : dFull < 1.5 ? 'Full moon' : dQ1 < 1.5 ? 'First quarter' : dQ3 < 1.5 ? 'Last quarter' : age < SYN / 2 ? 'Waxing' : 'Waning';
  return { age, name, afterFull: age >= SYN / 2 - 1.5 && age <= SYN / 2 + 3, tide: dSyz <= 2.5 ? 'spring' : dQ <= 2.5 ? 'neap' : 'mid', illum: (1 - Math.cos((2 * Math.PI * age) / SYN)) / 2 };
}

// Low-precision lunar altitude (SunCalc-style series; good to well under a degree).
function moonAlt(ms, lat, lon) {
  const d = ms / 86400000 - 0.5 + 2440588 - 2451545;
  const L = RAD * (218.316 + 13.176396 * d), M = RAD * (134.963 + 13.064993 * d), F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M), b = RAD * 5.128 * Math.sin(F), e = RAD * 23.4397;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const H = RAD * (280.16 + 360.9856235 * d) - RAD * -lon - ra;
  const phi = RAD * lat;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / RAD;
}

/**
 * Solunar periods for a local date (minutes since local midnight).
 * Majors: moon overhead/underfoot ±60 min. Minors: moonrise/moonset ±30 min.
 * Folklore-grade – shown for interest, never used in the GO rating.
 */
export function solunar(date, lat, lon) {
  const off = toMs(date + 'T12:00') - nzToUtcMs(date + 'T12:00');
  const t0 = toMs(date + 'T00:00') - off, step = 5, N = (24 * 60) / step;
  const a = Array.from({ length: N + 1 }, (_, i) => moonAlt(t0 + i * step * 60000, lat, lon));
  const out = [];
  const add = (kind, i, half) => out.push({ kind, mid: i * step, start: i * step - half, end: i * step + half });
  for (let i = 1; i < N; i++) {
    if ((a[i] > a[i - 1] && a[i] >= a[i + 1]) || (a[i] < a[i - 1] && a[i] <= a[i + 1])) add('major', i, 60);
    if ((a[i - 1] < 0 && a[i] >= 0) || (a[i - 1] >= 0 && a[i] < 0)) add('minor', i, 30);
  }
  return out.sort((x, y) => x.start - y.start);
}

/** 'high slack' | 'low slack' (within 45 min of a turn) | 'flooding' | 'ebbing' | null */
export function tideStage(tides, t) {
  const m = toMs(t);
  let prev = null, next = null;
  for (const e of tides) { if (toMs(e.t) <= m) prev = e; else { next = e; break; } }
  if (!prev && !next) return null;
  const nearest = [prev, next].filter(Boolean).sort((a, b) => Math.abs(toMs(a.t) - m) - Math.abs(toMs(b.t) - m))[0];
  if (Math.abs(toMs(nearest.t) - m) <= 45 * 60000) return nearest.type === 'H' ? 'high slack' : 'low slack';
  if (prev) return prev.type === 'H' ? 'ebbing' : 'flooding';
  return next.type === 'H' ? 'flooding' : 'ebbing';
}


// ---------- tides ----------

/** High/low events from Open-Meteo's modelled sea level (coarse; ±~30 min, ±~0.3 m). */
export function tidesFromModel(hours) {
  const s = hours.map((h) => h.sl);
  const out = [];
  for (let i = 1; i < s.length - 1; i++) {
    const a = s[i - 1], b = s[i], c = s[i + 1];
    if (a == null || b == null || c == null) continue;
    const isHigh = b > a && b >= c, isLow = b < a && b <= c;
    if (!isHigh && !isLow) continue;
    const den = a - 2 * b + c;
    const off = den === 0 ? 0 : (0.5 * (a - c)) / den;
    const j = off >= 0 ? i + 1 : i - 1;
    const t0 = toMs(hours[i].t), t1 = toMs(hours[j].t);
    out.push({
      t: fromMs(Math.round(t0 + Math.abs(off) * (t1 - t0))), type: isHigh ? 'H' : 'L',
      m: +(b - 0.25 * (a - c) * off).toFixed(2), src: 'model',
    });
  }
  return out;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Tolerant parser for pasted LINZ tide predictions (any text with dates followed by "time height" pairs). */
export function parseLinz(text) {
  const events = [];
  let cur = null;
  for (const line0 of String(text).split(/\r?\n/)) {
    let line = line0;
    let m;
    if ((m = line.match(/(\d{4})-(\d{2})-(\d{2})/))) {
      cur = `${m[1]}-${m[2]}-${m[3]}`; line = line.replace(m[0], ' ');
    } else if ((m = line.match(/(\d{1,2})[,\s\-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[,\s\-]+(\d{4})/i))) {
      cur = `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(+m[1])}`; line = line.replace(m[0], ' ');
    } else if ((m = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/))) {
      cur = `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`; line = line.replace(m[0], ' '); // NZ d/m/y
    }
    if (!cur) continue;
    const re = /(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?[^\d\-:]*?(-?\d+\.\d+)/gi;
    while ((m = re.exec(line))) {
      let hh = +m[1];
      if (m[3]) { const pm = m[3].toLowerCase() === 'p'; hh = (hh % 12) + (pm ? 12 : 0); }
      if (hh > 23 || +m[2] > 59) continue;
      events.push({ t: `${cur}T${pad(hh)}:${m[2]}`, m: parseFloat(m[4]), src: 'LINZ' });
    }
  }
  events.sort((a, b) => (a.t < b.t ? -1 : 1));
  events.forEach((e, i) => {
    const p = events[i - 1], n = events[i + 1];
    const higherThanPrev = !p || e.m > p.m, higherThanNext = !n || e.m > n.m;
    e.type = (p && n ? higherThanPrev && higherThanNext : p ? higherThanPrev : higherThanNext) ? 'H' : 'L';
  });
  return events;
}

/** LINZ events win for any date they cover; the model fills the rest. */
export function mergeTides(model, linz) {
  const covered = new Set(linz.map((e) => dateOf(e.t)));
  return [...linz, ...model.filter((e) => !covered.has(dateOf(e.t)))].sort((a, b) => (a.t < b.t ? -1 : 1));
}

export const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg) => (deg == null ? '–' : DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]);
