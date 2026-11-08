// Thursday-evening weekend check. Sends an ntfy push if Sat or Sun has a GO window.
// Env: NTFY_TOPIC (required unless DRY_RUN), NTFY_SERVER (default https://ntfy.sh), APP_URL (tap target), FORCE=1 (skip Thursday-6pm gate), DRY_RUN=1.
import { DEFAULTS, fetchForecast, buildDays, tidesFromModel, nzNow, dayOfWeek, weekday, windowLabel } from '../core.js';

const env = process.env;
const now = nzNow();
const nzDow = dayOfWeek(now.slice(0, 10));
const nzHour = +now.slice(11, 13);

// Two cron entries cover NZST/NZDT; only the one that lands on 6pm NZ time proceeds.
if (!env.FORCE && !(nzDow === 4 && nzHour === 18)) {
  console.log(`NZ time is ${now} (not Thursday 18:xx) – skipping.`);
  process.exit(0);
}

const go = [];
for (const p of DEFAULTS.places) {
  const fc = await fetchForecast(p.lat, p.lon);
  const tides = tidesFromModel(fc.hours);
  const days = buildDays(fc, DEFAULTS, now, tides).filter((d) => [0, 6].includes(dayOfWeek(d.date)) && d.date > now.slice(0, 10));
  for (const d of days) {
    console.log(p.name, d.date, d.rating, windowLabel(d.best));
    if (d.rating === 'GO') go.push({ ...d, place: p.name });
  }
}
if (!go.length) { console.log('No GO window on Sat/Sun at any spot – no notification.'); process.exit(0); }

const r1 = (v) => (v == null ? '–' : Math.round(v));
const body = go.map((d) => {
  const s = d.stats;
  return `${weekday(d.date)} ${+d.date.slice(8)} ${d.place}: GO ${windowLabel(d.best)} | wind ${r1(s.windMin)}-${r1(s.windMax)} g${r1(s.gustMax)} kt | sea ${s.seaMax?.toFixed(1)} m | swell ${s.swH?.toFixed(1)} m`;
}).join('\n');

if (env.DRY_RUN) { console.log('DRY RUN – would send:\n' + body); process.exit(0); }
if (!env.NTFY_TOPIC) { console.error('NTFY_TOPIC is not set'); process.exit(1); }

const res = await fetch(`${env.NTFY_SERVER || 'https://ntfy.sh'}/${encodeURIComponent(env.NTFY_TOPIC)}`, {
  method: 'POST',
  headers: {
    Title: 'Pauanui: GO window this weekend',
    Tags: 'fishing_pole_and_fish',
    Priority: '3',
    ...(env.APP_URL ? { Click: env.APP_URL } : {}),
  },
  body,
});
if (!res.ok) { console.error(`ntfy responded ${res.status}`); process.exit(1); }
console.log('Notification sent.');
