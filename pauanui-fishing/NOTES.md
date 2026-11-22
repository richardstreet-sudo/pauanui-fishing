# Pauanui Fishing – project notes and hand-over

Everything needed to carry on if the Claude chat is gone. To resume with a new Claude session, say:
"Read NOTES.md in pauanui-fishing and carry on" (and attach the folder).

## What it is
A phone-friendly web app (PWA, no build step, no accounts) that turns a free marine forecast into a plan for a **novice
angler fishing from a jetski (Sea-Doo Fish Pro) out of Pauanui, Coromandel**, plus Auckland Harbour.
- Live: https://richardstreet-sudo.github.io/pauanui-fishing/  ·  Repo: github.com/richardstreet-sudo/pauanui-fishing (public)
- Goal: help catch fish safely. First screen = best bet this week (when, where, what species/lure, what to take).
- Spots: Shoe / Slipper, Boat Cove (just off Waipapa Island), Aldermen, Auckland Harbour. Home point for distances = Pauanui (-37.02, 175.89).

## Files
- `index.html`, `style.css`, `app.js` – the UI and state. `sw.js` – offline cache (bump `pf-vN` when files change).
- `core.js` – forecast fetch (Open-Meteo weather + marine), GO/MAYBE/NO-GO rating, best window, tides, moon, species outlook.
- `knowledge.js` – the sourced data: species rules, tips, SOURCES (links to fishing.net.nz articles), COMBOS (rods/reels), MY_LURES, SEED_SPOTS, VHF sheet.
- `gear.js` – picks rod/reel combos for the day and checks lure weights against each rod's rating.
- `plan.js` – best bet, spot-by-day grid, fuel / be-back check.  `spots.js` – spot log, GPX import, shelter, matching.
- `protected.js` – protected-area warnings.  `tests.mjs` – run with `node tests.mjs` (or import in a browser).
- `data/` – LINZ tide tables (Tauranga + Auckland, 2026–2029), `maori.json` (2026–2028), `protected.json`.
- `scripts/` – `fetch_maori.py` (rebuild ratings), `fetch_protected.py` (rebuild protected areas), `notify.mjs` (Thursday alert, NOT set up yet).
- `vendor/leaflet/` – map library (self-hosted).

## How the main pieces work
- **Limits (yours):** wind < 10 kt, gusts < 15, sea < 0.8 m, no heavy rain (>= 2.5 mm/h). MAYBE = up to 25 % over. Aldermen is stricter: 8 / 12 / 0.6.
  Storms and fog force NO-GO. Best window = 2–4 consecutive hours, GO windows always beat MAYBE; dawn/dusk and tide turns score extra.
- **Tides:** LINZ Tauranga standard-port tables with LINZ secondary-port corrections (Tairua HW +7 / LW +18 min; Slipper Island HW -38 / LW -10;
  Auckland is a primary port). Falls back to the (approximate) Open-Meteo model if the tables are missing. Tables run to 2029.
- **Forecast limit:** weather runs 16 days, but sea/swell/tide only ~9 days; later days are marked ≈ (wind and rain only).
- **Fish scores:** seasons and rules paraphrased from fishing.net.nz articles (see SOURCES); the point weights are Claude's own and unvalidated.
  Moon/tide-turn effects are angler lore. The only real feedback loop is your own trip log (🐟 Fish / Blank on the first page).
- **Gear:** four combos named by reel (Kings AK3000A, Daiwa Saltist 6500H, Daiwa Saltist MQ 4000D, Shimano TranX 200HG). Lures are only suggested
  if their weight fits the rod's rating; over-rating lures are flagged; unknown weights say "unconfirmed". AK3000A has no lure rating on record.
- **Protected areas:** from OpenStreetMap (DOC designations). Slipper Island HPA, both Aldermen HPAs, Rangitoto/Motutapu HPA, The Noises HPA, etc.
  A guide only – confirm with DOC / Fisheries NZ. Spots inside one are never suggested.
- **Māori calendar:** ratings fetched from fishing.net.nz (copyright The Fishing Website – personal use; the repo is public).
- **Safety flags:** offshore wind, wind against ebb at the entrance, fog/storm, cold water (< 18 °C). Not switched on for the harbour.

## Updating the live site (the quirk)
GitHub Pages deploys with `.github/workflows/static.yml`; its `path:` is `./pauanui-fishing` (a subfolder). Easiest: on the repo's top-level page
choose **Add file → Upload files** and drag the whole `pauanui-fishing` folder in, commit, wait for the green tick, reload (twice on the phone).
Dragging only some files tends to put them at the top level where they are NOT published. Hold Shift on reload to bypass the cache.

## Data on the phone (localStorage keys) and backup
`pf.spots` (spots + trips), `pf.trips` (trips without GPS), `pf.settings` (only what you changed), `pf.caches` (forecasts), `pf.place`, `pf.seedV`.
**Back up regularly: 📍 → Export backup** (saves spots, trips and settings as a JSON file; Import restores it). Clearing Safari data erases it otherwise.

## Rebuilding data
- Tide tables beyond 2029: `https://static.charts.linz.govt.nz/tide-tables/maj-ports/csv/Tauranga%20YYYY.csv` (and Auckland) into `data/`, named `tauranga-YYYY.csv`.
  Corrections come from LINZ "NZNA Secondary ports" CSV (Tauranga block: Tairua 6412, Pauanui 6413 [approximate], Slipper 6412a).
- `python3 scripts/fetch_maori.py 2026 2028` · `python3 scripts/fetch_protected.py`

## Things not verified / open
- Protected-area boundaries (OSM) vs official DOC maps; NZ Fishing Rules app link (only the MPI recreational page was verified).
- Esri satellite tile terms for a public site; the Wet Maps iframe tab showed blank in testing (link out works).
- VHF channel numbers come from the user's own sheet – check with Coastguard.
- Seeded spot positions (The 32, Nick's Nest, North Pinnacles, Opoutere drop-off, The Barges) are from a research doc, not surveyed – confirm on the plotter.
  Doc marks that plotted wrongly were left out (South East Rock, Shoe Island Reef, Lens Pin, Sugar Loaf); Noises North and Tiri Channel are inside protected areas.
- The research doc's gear claims (300 g jigs on the 6500H, 50–80 lb braid) conflict with the user's rod ratings/spool labels – the user's numbers are used.
- `node tests.mjs` has only been run in a browser, never in Node. `scripts/notify.mjs` has never run.
- Lure weights unknown: Long John Slider, Double Trouble, The Joker, Beta Bug, Boss Squid, The Boss, Kabura, Coindrop (edit in ⚙︎ → Lures).

## To do / ideas
1. Thursday weekend-GO alert (ntfy): needs `.github/workflows/weekend-alert.yml` (in the folder) uploaded to the repo root's `.github/workflows/` and a repo secret `NTFY_TOPIC`.
2. Tairua bar-crossing advice (cross on the upper half of the flood; avoid ebb with easterly swell; abort if swell > 1.5 m) – only if the user launches over the bar.
3. Per-spot swell exposure; set ski range in ⚙︎ for the fuel check; confirm Boat Cove position.
4. After 10–20 logged trips, tune the species scoring from the user's own results.
