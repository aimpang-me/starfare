// node world/lore/test-lore.js : checks for the flavour-text generator in sol-lore.js (docs/LORE.md).
const assert = require("assert"), fs = require("fs"), path = require("path");
const L = require("./sol-lore.js"), E = require("../engine/sol-page.js"), R = E.R;
let n = 0; const ok = (name, f) => { f(); n++; console.log("ok", name); };

const BANNED = /\b(dispatcher|agent|route|fares?|energy|score|fastest|cheapest|kwh|hurry|urgent|emergency|deadline|storms?|flares?|forecast|delay(ed)?|late|tesla|spacex|xai|grok|nasa|esa|cnsa|starship|starfarer|starfinder)\b/i;
const UNITS = /\b(hours?|days?|weeks?|months?|years?|minutes?|km|kg)\b/i;
const seasonal = [];
for (const season of ["1", "2", "3"]) for (let i = 0; i < 400; i++) seasonal.push(R.hailRow(season, i));
const all = R.HAILS.concat(seasonal);
const text = (o) => [o.headline, o.story, o.overheard].filter(Boolean).join(" ");

ok("place names agree with the engine's PLACES", () => {
  const P = Object.fromEntries(E.PLACES.map((p) => [p.id, p]));
  for (const id of Object.keys(L.PLACE)) {
    assert(P[id], id + " is not an engine place");
    assert.strictEqual(L.PLACE[id].name.replace(/^the /, ""), P[id].name, id);
    assert.strictEqual(L.PLACE[id].real, P[id].real, id + " real flag");
  }
  for (const h of all) assert(L.PLACE[h.from] && L.PLACE[h.to], h.id + " uses a place lore does not know");
});

ok("every booking gets a story, the same one every time", () => {
  for (const h of all) {
    const a = L.booking(h), b = L.booking(JSON.parse(JSON.stringify(h)));
    assert.deepStrictEqual(a, b, h.id);
    assert(a.story && a.headline, h.id);
    assert.strictEqual(a.tag, "Fictional");
    assert(a.story.includes(L.parseRider(h.rider).lead), h.id + " story names its lead passenger");
    assert(!/\{\w+\}/.test(text(a)), h.id + " left a slot unfilled: " + a.story);
  }
});

ok("stories use public booking fields only: rush or a seed field changes nothing", () => {
  for (const h of seasonal.slice(0, 200)) {
    const bare = { id: h.id, rider: h.rider, party: h.party, from: h.from, to: h.to, kind: h.kind };
    assert.deepStrictEqual(L.booking(Object.assign({}, bare, { rush: { at: h.from, x: 3 }, seed: "secret" })), L.booking(bare), h.id);
  }
});

ok("no numbers, units, weather, scoring or dispatcher words in booking stories", () => {
  for (const h of all) {
    const t = text(L.booking(h));
    assert(!/\d/.test(t), h.id + " has a digit: " + t);
    const bad = t.match(BANNED) || t.match(UNITS);
    assert(!bad, h.id + " has a banned word (" + (bad && bad[0]) + "): " + t);
  }
});

ok("the story agrees with the party size", () => {
  const solo = L._company[2].concat(L._company[3]);
  for (const h of all) {
    const o = L.booking(h);
    if (o.source === "catalog") continue;
    const lines = L._company[h.party].map((t) => t.replace("{lead}", L.parseRider(h.rider).lead));
    if (h.party === 1) assert(!solo.some((t) => o.story.includes(t.replace("{lead}", L.parseRider(h.rider).lead))), h.id);
    else if (o.source !== "feature:grandparent") assert(lines.some((t) => o.story.includes(t)), h.id + " party " + h.party + ": " + o.story);
  }
});

ok("there is variety: many distinct stories over a season", () => {
  const s = new Set(seasonal.slice(0, 400).map((h) => L.booking(h).story));
  assert(s.size > 300, "only " + s.size + " distinct stories in 400 bookings");
  const src = {}; for (const h of seasonal) { const k = L.booking(h).source.split(":")[0]; src[k] = (src[k] || 0) + 1; }
  assert(src.generated && src.feature, JSON.stringify(src));
});

ok("crew stories carry the booking's own party size and nothing else numeric", () => {
  const o = L.booking({ id: "liner-test", rider: "Noor, a technician", party: 100, from: "earth", to: "titan-dock", kind: "long" });
  assert.strictEqual(o.source, "crew");
  assert(o.story.includes("100") && o.story.includes("Noor"), o.story);
  assert(!/\d/.test(o.story.replace(/\b100\b/g, "")), o.story);
});

ok("moments exist for every recorded incident and checkpoint kind, and only for those", () => {
  const h = R.HAILS[3];
  for (const k of Object.keys(L.INCIDENT)) assert(L.moment(h, { incident: k, where: "titan" }, "run1|" + k), k);
  for (const k of Object.keys(L.CHECKPOINT)) assert(L.moment(h, { checkpoint: k, where: "titan" }, "run1|" + k), k);
  for (const m of L.MOMENTS) {
    const o = L.moment(h, { moment: m, where: "earth" }, "run1|" + m);
    assert(o && o.tag === "Fictional" && !/\d/.test(o.text) && !/\{\w+\}/.test(o.text), m);
  }
  assert.strictEqual(L.moment(h, { incident: "something_new", where: "earth" }, "x"), null);
  assert.deepStrictEqual(L.moment(h, { moment: "arrival", where: "earth" }, "r|9"), L.moment(h, { moment: "arrival", where: "earth" }, "r|9"));
});

ok("place notes are tagged by the engine's real flag; facts use only engine numbers", () => {
  for (const p of E.PLACES) {
    const note = L.placeNote(p.id);
    if (note) { assert.strictEqual(note.tag, p.real ? "Real" : "Fictional", p.id); assert(!/\d/.test(note.text), p.id); }
  }
  const P = Object.fromEntries(E.PLACES.map((p) => [p.id, p]));
  const phobos = L.placeFact(P.phobos, "Mars");
  assert.strictEqual(phobos.tag, "Real");
  assert(phobos.text.includes(String(Math.round(1 / P.phobos.period_days))), phobos.text);
  assert.strictEqual(L.placeFact(P["mars-base"], "Mars"), null);
});

ok("the engine bundle never includes lore, so lore edits cannot move the engine sha", () => {
  const bundle = fs.readFileSync(path.join(__dirname, "../engine/sol-page.js"), "utf8");
  assert(!bundle.includes("SOL_LORE") && !bundle.includes(L.VERSION));
  for (const f of fs.readdirSync(path.join(__dirname, "../engine")).filter((f) => /\.(js|mjs)$/.test(f)))
    assert(!/lore/.test(fs.readFileSync(path.join(__dirname, "../engine", f), "utf8").match(/require\([^)]*\)|import[^;]*from[^;]*/g)?.join(" ") || ""), f + " imports lore");
});

console.log(n + " checks passed");
