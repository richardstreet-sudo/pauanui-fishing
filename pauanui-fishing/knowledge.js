// Fishing knowledge base: seasons, scoring weights, tips and gear, each tied to the fishing.net.nz article it was
// paraphrased from. Add a source, then reference its id. Scoring weights/cut-offs are ours; the rules come from the articles.
// Pure data + small predicate functions (no imports) so it works in the browser and in Node.

const A = 'https://www.fishing.net.nz/fishing-advice/fishing-hints-tips-and-how-to-articles/';
const art = (slug, title) => ({ title, url: `${A}${slug}/` });
const jet = (slug, title) => ({ title, url: `https://www.fishing.net.nz/complete-guides/jetski-fishing/${slug}/`, });

export const SOURCES = {
  autumn: art('inshore-fishing-in-autumn', 'Inshore fishing in autumn'),
  gurnardExpert: art('expert-tips-to-catch-gurnard', 'Expert tips: gurnard'),
  gurnardAll: art('catching-gurnard-all-you-need-to-know', 'Catching gurnard'),
  gurnardTarget: art('targeting-gurnard', 'Targeting gurnard'),
  snapperWhere: art('snapper-fishing-where-they-live-and-how-to-catch-them', 'Snapper: where they live'),
  workup: art('the-workup-bible-a-comprehensive-guide-to-fishing-workups', 'The workup bible'),
  winterTactics: art('winter-snapper-tactics', 'Winter snapper tactics'),
  winterTech: art('winter-snapper-fishing-techniques', 'Winter snapper techniques'),
  winterBasics: art('winter-snapper-basics', 'Winter snapper basics'),
  tough: art('tactics-for-tough-fishing', 'Tactics for tough fishing'),
  notBiting: art('tips-when-fish-arent-biting', 'When fish aren\'t biting'),
  colours: art('which-softbait-colours-are-best', 'Softbait colours'),
  trevally: art('catching-trevally-on-lures', 'Trevally on lures'),
  bite: art('how-fish-bite-lures', 'How fish bite lures'),
  kahawai: art('how-to-catch-kahawai3', 'How to catch kahawai'),
  spots: art('how-to-find-fishing-spots', 'How to find fishing spots'),
  kingBig: art('softbaiting-for-kingfish-with-big-baits', 'Kingfish: big softbaits'),
  deepSnapper: art('lure-fishing-for-snapper-in-deep-water', 'Deep-water snapper'),
  kingJig: art('jigging-for-kingfish-gear-and-techniques', 'Jigging for kingfish'),
  baitfish: art('catch-your-own-baitfish', 'Catch your own baitfish'),
  dory: art('targeting-john-dory', 'Targeting john dory'),
  spj: art('slow-pitch-jigging-techniques1', 'Slow-pitch jigging'),
  slowTroll: art('slow-trolling-for-kingfish', 'Slow trolling for kingfish'),
  poppers: art('catching-kingfish-on-poppers-and-stickbaits', 'Kingfish on poppers and stickbaits'),
  livebait: art('livebaiting-basics', 'Livebaiting basics'),
  november: art('fishing-in-november', 'Fishing in November'),
  fiveTips: art('catching-kingfish-five-top-tips', 'Kingfish: five top tips'),
  begLures: art('snapper-for-beginners-lures', 'Snapper on lures for beginners'),
  drop: art('snapper-on-lures-fishing-the-drop', 'Snapper: fishing the drop'),
  whereSnapper: art('where-to-find-snapper-in-the-hauraki-gulf', 'Where to find snapper in the Hauraki Gulf'),
  anchovy: art('fishing-the-hauraki-gulf-anchovy-run', 'Hauraki Gulf anchovy run'),
  reefs: art('fishing-reefs-and-foul-tips-and-tricks', 'Fishing reefs and foul'),
  lureBait: art('using-lures-to-catch-live-baits', 'Using lures to catch live bait'),
  kingLight: art('kingfish-on-light-tackle', 'Kingfish on light tackle'),
  crays: art('how-to-pot-for-crays-tips-from-the-experts', 'Potting for crays'),
  spawning: { title: 'How spawning affects fishing in NZ', url: 'https://www.fishing.net.nz/fishing-advice/general-articles/how-spawning-affects-fishing-in-nz/' },
  jetTech: jet('techniques', 'Jetski fishing: techniques'),
  jetFind: jet('finding-fish', 'Jetski fishing: finding fish'),
  jetTrip: jet('trip-planning', 'Jetski fishing: trip planning'),
  jetSafety: art('jetski-fishing-safety-tips', 'Jetski fishing safety'),
  jetLive: art('livebaiting-from-a-jetski', 'Livebaiting from a jetski'),
  biteTimes: { title: 'Bite times', url: 'https://www.fishing.net.nz/fishing-advice/bite-times/' },
  maori: { title: 'Māori fishing calendar (Billy Ho)', url: 'https://www.fishing.net.nz/fishing-advice/maori-fishing-calendar/' },
  coroReport: { title: 'Eastern Coromandel report (29/10/26)', url: 'https://www.fishing.net.nz/fishing-reports/saltwater-fishing-reports/eastern-coromandel-fishing-report-29-10-26/' },
  pgSnapper: { title: 'How to catch snapper', url: 'https://www.fishing.net.nz/how-to-catch/snapper/' },
  pgKing: { title: 'How to catch kingfish', url: 'https://www.fishing.net.nz/how-to-catch/kingfish/' },
  pgGurnard: { title: 'How to catch gurnard', url: 'https://www.fishing.net.nz/how-to-catch/gurnard/' },
  pgKahawai: { title: 'How to catch kahawai', url: 'https://www.fishing.net.nz/how-to-catch/kahawai/' },
  pgTrevally: { title: 'How to catch trevally', url: 'https://www.fishing.net.nz/how-to-catch/trevally/' },
  pgDory: { title: 'How to catch john dory', url: 'https://www.fishing.net.nz/how-to-catch/john-dory/' },
};

export const HABITATS = ['reef', 'pinnacle', 'foul', 'sand or mud', 'drop-off', 'channel', 'island point'];

const W = [6, 7, 8, 9, 10]; // winter to early spring

/**
 * Species. Scoring (all optional):
 *  months: [[months, pts], ...] first match wins, else monthDefault
 *  sst: [[min, max, pts], ...] first match wins (null = open ended)
 *  light: {low, mixed}; turn; spring; afterFull; clarity: {clear, tinged, stained, muddy}; clearing; overcast
 *  tips: [{months, text}] first match wins, else `tip`
 *  habitat: { tags: {habitat tag: pts}, depth: [min, max] m } – used to rank your tagged spots
 */
export const SPECIES = [
  {
    name: 'Snapper', goodAt: 7, fairAt: 4,
    quick: 'Slow-jig (inchiku/kabura 60–90 g) or a 4" soft plastic in pink or orange, near the bottom over sand or foul – and stay for the change of light.',
    season: 'Peak Oct–Dec (big fish inshore feeding up, then spawning in summer – schooling up at ~16–18°C, several times through the warm months); good Jan–May (autumn anchovy runs); from May–June most head to deeper water, but ~20–25% hold inshore in shallow foul.',
    months: [[[10, 11, 12], 3], [[1, 2, 3, 4, 5], 2], [[9], 1]], monthDefault: 0,
    sst: [[17, 22, 2], [15, 24, 1], [null, 13, -1]],
    light: { low: 2, mixed: 1 }, turn: 1, afterFull: -1,
    clarity: { clear: 0, tinged: 0, stained: -1, muddy: -2 }, clearing: 1,
    tips: [
      { months: [3, 4, 5], text: 'Autumn anchovy runs push snapper into the shallows: match the hatch with a 3–4" soft plastic or small jig, 3–8 m in low light. Bigger fish often come at the change of light.' },
      { months: [6, 7, 8], text: 'Winter: big fish sit in shallow foul (2–12 m) at dawn/dusk or under cloud; numbers in 15–25 m channels. Small tough baits (salted skipjack, jack mackerel) on a strayline, or slow 4" grub tails in natural greens/browns. Bites are short and gentle – be set up early.' },
      { months: [9, 10, 11, 12], text: 'Pre-spawn feed-up: snapper are close in, in schools, and bite hard. Easiest for a novice: slow-jig (inchiku/kabura 60–90 g) – drop to the bottom, wind 5–10 slow turns, wind faster if bitten, otherwise drop and repeat over open sand; a squid-strip tip helps. Workups: 100–150 g orange slider.' },
    ],
    tip: 'Softbaits, slow jigs or bait on reef edges and foul ground; quiet approach in the shallows; summer midday is tough, so fish dawn/dusk.',
    habitat: { tags: { foul: 2, reef: 2, 'drop-off': 1, channel: 1, 'sand or mud': 1 }, depth: [2, 60] },
    src: ['pgSnapper', 'spawning', 'snapperWhere', 'whereSnapper', 'winterBasics', 'winterTactics', 'november', 'begLures', 'anchovy'],
  },
  {
    name: 'Kingfish', goodAt: 5, fairAt: 3,
    quick: 'A stickbait or jig on the up-current edge of a reef or pin, early; live koheru or jack mackerel if you have the kit.',
    season: 'Best Dec–May; a good run of jigging around late Oct–Nov; fewer in winter. Sources differ on spawning – offshore in late winter/early spring, or around Dec–Jan – but agree it is well offshore and little is known.',
    months: [[[12, 1, 2, 3, 4, 5], 2], [[10, 11], 1]], monthDefault: 0,
    sst: [[19, null, 2], [17, null, 1]],
    light: { low: 1 }, turn: 1, spring: 1, afterFull: -1,
    clarity: { clear: 1, tinged: 0, stained: 0, muddy: -1 },
    tip: 'Reefs, pins and headlands exposed to tidal current, up-current side; very early start for topwater. From a ski, stickbaits fit better than poppers; darker patterns on bright clear days, orange/pink when dull. Big softbaits (9–12" paddle-tail deep, jerk-shad to cast) in pink & pearl, blue & pearl, silver & pearl or "fusilier" need 6–8 oz heads and heavy gear. Live bait: koheru is top; slow-troll koheru ~2–3 kt, jack mackerel 1–2 kt; count 3 s before setting the drag. Keep a jig vertical and move on from spots showing no fish.',
    habitat: { tags: { pinnacle: 2, reef: 2, 'island point': 2, 'drop-off': 1 } },
    src: ['pgKing', 'kingBig', 'kingJig', 'kingLight', 'spawning', 'poppers', 'slowTroll', 'fiveTips', 'jetLive', 'jetTech', 'coroReport'],
  },
  {
    name: 'Gurnard', goodAt: 4, fairAt: 2,
    quick: 'Drift a two-hook ledger or pink flasher rig with fish strips over sand or mud in moving water.',
    season: 'Prime Jun–Oct (gather to feed before spawning); spawn over a long spring–summer period, peaking early summer (Christmas catches can be almost all roe-laden females); dislike warm water.',
    months: [[W, 2]], monthDefault: 1,
    sst: [[null, 18, 1], [21, null, -1]],
    turn: 1, spring: 1,
    tip: 'Drift over sand or mud (10–50 m, up to ~100 m): two-hook ledger or pink flasher rig, recurve hooks, thumb-sized strips of skipjack/mullet or shellfish; or slow orange sliders. Run two rods (soft-bait + bait). Keep berley low in a weighted pot; moving water is best.',
    habitat: { tags: { 'sand or mud': 2, channel: 1 }, depth: [10, 50] },
    src: ['pgGurnard', 'spawning', 'gurnardAll', 'gurnardExpert', 'gurnardTarget'],
  },
  {
    name: 'Kahawai', goodAt: 4, fairAt: 3,
    quick: 'A small silver jig or soft plastic cast into birds and surface schools around the islands.',
    season: 'Year-round; best spring and autumn (around Easter) when chasing baitfish. Thought to spawn offshore in mid–late summer (ripe fish Jan–Apr).',
    months: [[[3, 4, 5, 9, 10, 11], 2]], monthDefault: 1,
    light: { low: 2, mixed: 1 }, clarity: { muddy: -1 },
    tip: 'Size matters: match what they are eating and drop to a smaller lure first, then change the retrieve (flat out, just under the surface, or stop and flutter). Silver flash works; use strong single hooks. Look for birds and surface schools around islands and headlands.',
    habitat: { tags: { 'island point': 2, reef: 1 } },
    src: ['pgKahawai', 'spawning', 'kahawai', 'anchovy'],
  },
  {
    name: 'Trevally', goodAt: 4, fairAt: 3,
    quick: 'Berley and light line with small baits or a 4" grub along the bottom.',
    season: 'Year-round; surface schools on krill/anchovies in warm months, on the bottom in autumn, up in harbours and estuaries in winter.',
    months: [[W, 2]], monthDefault: 1,
    light: { low: 2, mixed: 1 }, overcast: 1,
    tip: 'Line-shy: berley, light line. Softbait: 4" grub or 5" paddle-tail in natural colours along the bottom; on surface schools cast a tiny metal jig ahead of the school, never into it.',
    habitat: { tags: { foul: 2, 'island point': 1, reef: 1 } },
    src: ['pgTrevally', 'trevally'],
  },
  {
    name: 'John dory', goodAt: 2, fairAt: 1,
    quick: 'A slow soft plastic on shallow foul, or a live jack mackerel near a berley trail.',
    season: 'Best in winter and early spring (Jun–Sep); harder to find Dec–Apr (spawning).',
    months: [[[6, 7, 8, 9], 2]], monthDefault: 0, seasonOnly: true,
    tip: 'Slow soft-plastics (grub tails, light heads) on shallow foul, or a live jack mackerel (~100 mm) on a ledger rig near a berley trail. Net it – their mouths are thin.',
    habitat: { tags: { foul: 2, reef: 1 }, depth: [2, 30] },
    src: ['pgDory', 'dory', 'lureBait'],
  },
];

// ---- Tips for today. when(ctx) -> boolean. ctx: month, startH, rating, turnInWindow, moon, runoff, outlook, km, sst.
export const TIPS = [
  { id: 'spawn', when: (c) => c.month === 10 || c.month === 11 || c.month === 12 || c.month === 1,
    text: 'Spawning time: snapper school up at about 16–18°C, and big old fish lose much of their caution, so aggregations are easy to catch. Take a trophy if you like, but don\'t strip a spawning school – big fish carry far more eggs. Release gently (fish from deeper water often don\'t survive).',
    src: ['spawning', 'workup'] },
  { id: 'workup', when: (c) => c.month >= 9 && c.month <= 12,
    text: 'Workup season (peak late Oct–Nov): look for gannets/terns actively diving, dolphins and surface bait. Don\'t motor past raft-ups of birds – sound underneath. Go to where the action is: anglers 300–500 m away from a bait ball did poorly. Fish the down-current "exhaust"; snapper often follow the crumb trail after the surface action fizzles.',
    src: ['workup', 'jetFind', 'anchovy'] },
  { id: 'anchovy', when: (c) => c.month >= 2 && c.month <= 5,
    text: 'Anchovy-run season (strongest around March–April): tight bait balls pushed up by kahawai and skipjack, with snapper below. Match the hatch (3–4" plastic or small jig); the change of light can bring the bigger fish.',
    src: ['anchovy', 'autumn'] },
  { id: 'clearing', when: (c) => c.runoff.clearing,
    text: 'Water is clearing after rain: food gets flushed out, so shallow reef near river mouths and harbours can fire a couple of tidal flushes after the rain stops.',
    src: ['winterTactics', 'autumn'] },
  { id: 'turbid', when: (c) => (c.runoff.level === 'muddy' || c.runoff.level === 'stained') && !c.runoff.clearing,
    text: 'Turbid runoff water is poor for table fish near river mouths – it takes about three days (six tidal flushes) to settle. Try rocky coast away from freshwater, or brighter/high-contrast colours.',
    src: ['autumn', 'colours'] },
  { id: 'noRun', when: (c) => !c.farOut && c.hasWindow && !c.turnInWindow && c.rating !== 'NOGO',
    text: '"No run, no fun": there\'s no tide turn in your window. If you can, shift towards one – fish need current to spread scent. Bite times often line up with the run-up to low tide.',
    src: ['notBiting', 'biteTimes'] },
  { id: 'fullMoon', when: (c) => c.moon.afterFull,
    text: 'Around and just after a full moon fishing is often poor for snapper and kingfish, and jack mackerel are hard to catch for bait. Bright nights can also shorten the dawn bite.',
    src: ['pgSnapper', 'pgKing', 'jetLive'] },
  { id: 'maori', when: () => true,
    text: (c) => `Billy Ho's rule of thumb: better on an incoming tide when the moon is waning, and an outgoing tide when it is waxing. Today the moon is ${c.moon.age < 14.765 ? 'waxing, so he favours the outgoing tide' : 'waning, so he favours the incoming tide'}${c.billy?.stage ? `; your best window is on a ${c.billy.stage} tide – ${c.billy.match ? 'a match' : 'not a match'}` : ''}. His Māori fishing calendar rates each day Excellent / Good / Poor – check it for today's rating.`,
    src: ['maori'] },
  { id: 'midday', when: (c) => c.startH != null && c.startH >= 10 && c.startH <= 14,
    text: 'Your window is around midday, which is often the quietest time (especially for summer snapper). If you can, shift it towards dawn or dusk.',
    src: ['notBiting', 'jetFind'] },
  { id: 'winter', when: (c) => c.month >= 6 && c.month <= 8,
    text: 'Winter holdouts: most snapper have gone deeper, but big fish stay in shallow foul and high-current channels. Bite windows are short – plan around dawn/dusk, overcast and the right tide, and keep quiet in the shallows.',
    src: ['whereSnapper', 'winterBasics'] },
  { id: 'far', when: (c) => c.km > 10,
    text: (c) => `This spot is about ${Math.round(c.km)} km from Pauanui. The nearshore forecast can differ a lot offshore, and wind against tide is rougher than the wind number suggests. Fuel rule of thumb: a third out, a third back, a third spare.`,
    src: ['jetTrip', 'jetTech'] },
  { id: 'slow', when: (c) => c.outlook.every((s) => s.level !== 'Good'),
    text: 'No species reads "Good" today – go lighter on line and leader, add flash (lumo/UV beads), switch bait or keep one big bait out, and stay for the bite window. Nips and follows are normal; one bite often triggers more.',
    src: ['notBiting', 'bite'] },
];

// ---- Your rods and reels. Each combo is named by its reel. lureG = the rod's stated lure-weight rating in grams
// (null = no lure rating found, so weights can't be checked for it). From your own notes.
export const COMBOS = [
  { id: 'ak3000a', name: 'Kings AK3000A', reel: 'Kings AK3000A, spin, 3+ bearings',
    rod: 'Kings Traveller 7244L, 7\'2"', rodSpec: 'line 4–8 lb', lureG: null,
    braid: 'lime', spool: '6 lb/270 yd, 10 lb/185 yd, about 12 lb', role: 'light snapper',
    note: 'No lure-weight rating found for this rod. It is only suggested for light soft plastics and micro-jigs – check the blank before trusting a weight.' },
  { id: 'saltist6500h', name: 'Daiwa Saltist 6500H', reel: 'Daiwa Saltist 6500H, spin, 6.2:1, max drag about 33 lb',
    rod: 'Daiwa Saltist ST762H, 7\'6", 2-piece', rodSpec: 'lure 40–120 g, line 24 kg', lureG: [40, 120],
    braid: 'multicolour', spool: '25 lb/300 m, 30 lb/250 m', role: 'main kingfish',
    note: 'No separate vertical-jig rating found, so only the 40–120 g lure range is used.' },
  { id: 'saltistmq4000d', name: 'Daiwa Saltist MQ 4000D', reel: 'Daiwa Saltist MQ 4000D, spin',
    rod: 'Daiwa Saltist Bluewater 66BJS slow jigging rod (marked B66BJS), 6\'6"', rodSpec: 'lures 20–100 g, PE 1–2', lureG: [20, 100],
    braid: 'pale yellow', spool: '', role: 'main snapper', note: '' },
  { id: 'tranx200hg', name: 'Shimano TranX 200HG', reel: 'Shimano TranX 200HG, baitcaster',
    rod: 'Shimano Backbone Slow Pitch OH, 6\'3", 1-piece', rodSpec: '15–30 lb, 100–180 g', lureG: [100, 180],
    braid: 'purple/yellow', spool: '', role: 'heavier kingfish jigs', note: '' },
];

// Lures from your tackle box. g = null means the weight isn't confirmed (flagged, never paired automatically).
// Weights known so far: Deep V 170 g and Squidwings 200 g (your notes), Lil Squidwings 28 g and the micro jigs 20 g (your lure doc).
// Editable in ⚙︎ (one per line: name, grams – leave grams blank if unknown).
export const MY_LURES = [
  { name: 'Deep V', g: 170 },
  { name: 'Squidwings', g: 200 },
  { name: 'Lil Squidwings', g: 28 },
  { name: '20 g micro jigs', g: 20 },
  { name: 'Long John Slider', g: null },
  { name: 'Double Trouble', g: null },
  { name: 'The Joker', g: null },
  { name: 'Beta Bug', g: null },
  { name: 'Boss Squid', g: null },
  { name: 'The Boss', g: null },
  { name: 'Kabura', g: null },
  { name: 'Coindrop', g: null },
];

// How each lure is worked and when it earns its place (from your own lure notes).
export const LURE_INFO = {
  'Long John Slider': { kind: 'mechanical knife jig', how: 'fast lift-and-wind (a turn of the handle per lift); if you feel bumps but no hook-up, speed up', best: 'aggressive kingfish, deep water, fast drift' },
  'The Joker': { kind: 'long-fall jig', how: 'lift high, then drop the rod tip to the water so the line goes slack and it flutters on the fall; strike if the line stops falling', best: 'kingfish following but not biting, slower current' },
  'Double Trouble': { kind: 'two-way jig', how: 'leader on the narrow end = fast and darting; blunt end = big flutter on the drop, lift-pause-drop', best: 'unsure what the fish want; lazy kingfish or snapper' },
  'Deep V': { kind: 'keeled slow-pitch jig', how: 'lift and drop like The Boss but a bit faster; the keel cuts through current', best: 'deep water (40 m+) or strong tidal flow' },
  'Squidwings': { kind: 'big skirted squid lure', how: 'drop, crank up 5–10 m, rod in holder, or a slow lift-and-lower; not for fast jigging', best: 'big kingfish, passive fishing' },
  'Lil Squidwings': { kind: 'micro squid lure', how: 'cast and glide (lift slowly, wind down the slack), or crank up 2 m and rod in holder', best: 'snapper, kings in the shallows, gurnard over sand' },
  '20 g micro jigs': { kind: 'micro jigs', how: 'flutter: lift ~1 m then drop the tip, most bites on the fall; or a fast mini-mechanical retrieve for kahawai', best: 'snapper, trevally, kahawai, gurnard; throw into workups (about anchovy size)' },
  'Beta Bug': { kind: 'inchiku', how: 'slow grind (about a quarter to half a turn per second) or wind up 2 m and leave it in a rod holder', best: 'big snapper, gurnard, john dory' },
  'Boss Squid': { kind: 'slow-pitch jig with an inchiku skirt', how: 'slow-pitch: lift gently, drop to glide back; the skirt pulses on the drop', best: 'big snapper on the sounder, kingfish feeding on squid' },
  'The Boss': { kind: 'leaf slow-pitch jig', how: 'lift, then drop the rod tip for slack so it slides and flutters flat; watch the line', best: 'fussy fish in deeper water (30 m+)' },
  'Kabura': { kind: 'sliding-head slider', how: 'drop to the bottom and wind painfully slowly (a turn every 2–3 s); ignore the tap-tap and only lift when the rod loads', best: 'snapper and gurnard over sand or mud, any water clarity; good in a rod holder' },
  'Coindrop': { kind: 'flat micro leaf jig', how: 'shallow flutter on a semi-slack line, or short sharp lifts in deeper water', best: 'finicky snapper in low current or at slack tide' },
};

// Spots from your strategy doc whose positions I checked (not inside a protected area, and sensible for the place described).
// They are NOT surveyed marks: confirm on your plotter before relying on them. The doc's "derived" marks that plotted in the
// wrong place (South East Rock, Shoe Island Reef, Lens Pin, Sugar Loaf) and two inside protected areas (Noises North, Tiri Channel) are left out.
export const SEED_SPOTS = [
  { name: 'The 32', lat: -37.07532, lon: 176.02210, habitat: ['pinnacle', 'reef'], depth: 32, notes: 'Deep reef rising from ~70 m to 32 m, about 3.5 nm east of Slipper. Kingfish and snapper. 2.5 km from the Aldermen south protected area – watch your drift. Position from your strategy doc; confirm on the plotter.' },
  { name: "Nick's Nest", lat: -37.0750, lon: 176.0190, habitat: ['foul'], depth: null, notes: 'Productive foul near The 32 – snapper, softbait or kabura. Position from your strategy doc; confirm on the plotter.' },
  { name: 'North Pinnacles (Aldermen)', lat: -36.9375, lon: 176.1150, habitat: ['pinnacle', 'drop-off'], depth: 40, notes: 'Vertical rise from ~100 m to 40 m, big kingfish, heavy drag. Between the two Aldermen protected areas (2.7 km from the nearest) – check the map. Position from your strategy doc; confirm on the plotter.' },
  { name: 'Opoutere Beach drop-off', lat: -37.0714, lon: 175.8899, habitat: ['sand or mud', 'drop-off'], depth: null, notes: 'Sandbar drop-off, snapper and kahawai. Position from your strategy doc; confirm on the plotter.' },
  { name: 'The Barges (Rangitoto)', lat: -36.7854, lon: 174.8267, habitat: ['foul'], depth: null, notes: 'Old dredge-spoil ground with uneven bottom; winter snapper, drift with a kabura. Position from your strategy doc; confirm on the plotter.' },
];

// Your VHF quick-reference sheet. Check the channels against the current Coastguard list.
export const VHF = {
  channels: ['CH 16: distress and calling', 'CH 06 / 08: ship-to-ship (1 W power)'],
  areas: [
    { area: 'Auckland inner', coastguard: 64, weather: 19 },
    { area: 'Auckland outer', coastguard: 60, weather: 20 },
    { area: 'Pauanui', coastguard: 63, weather: 19 },
  ],
  mayday: [
    '"MAYDAY, MAYDAY, MAYDAY – this is [ski name / callsign]" (three times)',
    'POSITION: GPS or landmarks',
    'DISTRESS: e.g. engine failure / sinking',
    'PEOPLE: e.g. 2 persons on board wearing lifejackets',
    'VESSEL: e.g. yellow Sea-Doo',
    '"OVER" – then listen for a response, and repeat if there is none.',
  ],
};

// ---- Bait and terminal gear (rod choices come from COMBOS via gear.js). when(ctx) -> boolean.
export const GEAR = [
  { text: 'Slow-jigs usually get a squid-strip tip on the assist hook; drag no more than ~2 kg for micro-jigs.', when: (c) => c.fair('Snapper'), src: ['begLures'] },
  { text: 'Live-bait kit: sabiki rigs (with sinker, in several sizes), bucket with aerator or a plumbed bin, dip net, berley bag.', when: (c) => c.fair('Kingfish') || c.fair('John dory'), src: ['baitfish', 'jetLive', 'lureBait'] },
  { text: 'Gurnard: two-hook ledger or pink flasher rig with 2/0–5/0 recurve hooks, thumb-sized strips of skipjack/mullet, or an orange slider.', when: (c) => c.fair('Gurnard'), src: ['gurnardAll', 'tough'] },
  { text: 'Kahawai and trevally: light fluorocarbon trace, and a mini stickbait for surface schools.', when: (c) => c.fair('Kahawai') || c.fair('Trevally'), src: ['trevally', 'kahawai'] },
  { text: 'Pre-cut frozen baits from home (pilchard, skipjack); fresh jack mackerel for bigger predators.', when: () => true, src: ['jetTech'] },
];
