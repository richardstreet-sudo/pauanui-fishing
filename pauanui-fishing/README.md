# Pauanui Fishing

7-day GO / MAYBE / NO-GO boat-fishing forecast for Pauanui. Static PWA – no build step, no API keys.

- Data: Open-Meteo Weather + Marine APIs. Rating logic: `core.js` (limits in `DEFAULTS`, editable in the app's ⚙︎ too).
- Tides: modelled from Open-Meteo sea level by default (approximate); paste LINZ predictions in ⚙︎ to override.
- Tests: `node tests.mjs`. Local preview: `python3 -m http.server`.

## Deploy
1. Create a GitHub repo, push this folder to `main`.
2. Settings → Pages → Source: **GitHub Actions**. The `Deploy to GitHub Pages` workflow publishes it.
3. On iPhone open `https://<user>.github.io/<repo>/` in **Safari** → Share → Add to Home Screen.

## Weekend alert (ntfy)
1. Install the ntfy app, subscribe to a hard-to-guess topic name.
2. Repo → Settings → Secrets → Actions → `NTFY_TOPIC` = that topic.
3. Test: Actions → *Weekend GO alert* → Run workflow (force on). Runs automatically Thursday 6pm NZ.
