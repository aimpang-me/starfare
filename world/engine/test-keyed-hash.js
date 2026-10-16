// node world/engine/test-keyed-hash.js : the keyed hazard hash behind "k1:" seeds (SipHash-2-4) and the oracle export.
const assert = require("assert"), E = require("./sol-page.js"), R = E.R;
const END = 2461329.5 + 7000 - 1, t0 = 2461700.5;
let n = 0; const ok = (name, f) => { f(); n++; console.log("ok", name); };

// All 64 SipHash-2-4 reference vectors (vectors_sip64 in the reference implementation, github.com/veorq/SipHash,
// vectors.h): key bytes 00..0f, message i is the bytes 00..i-1, output as its 8 bytes in order. Row 15 is the
// worked example in the SipHash paper's appendix (0xa129ca6149be45e5 as a little-endian word).
const KEY = "000102030405060708090a0b0c0d0e0f";
const VECTORS = [
  "310e0edd47db6f72", "fd67dc93c539f874", "5a4fa9d909806c0d", "2d7efbd796666785", "b7877127e09427cf", "8da699cd64557618", "cee3fe586e46c9cb", "37d1018bf50002ab",
  "6224939a79f5f593", "b0e4a90bdf82009e", "f3b9dd94c5bb5d7a", "a7ad6b22462fb3f4", "fbe50e86bc8f1e75", "903d84c02756ea14", "eef27a8e90ca23f7", "e545be4961ca29a1",
  "db9bc2577fcc2a3f", "9447be2cf5e99a69", "9cd38d96f0b3c14b", "bd6179a71dc96dbb", "98eea21af25cd6be", "c7673b2eb0cbf2d0", "883ea3e395675393", "c8ce5ccd8c030ca8",
  "94af49f6c650adb8", "eab8858ade92e1bc", "f315bb5bb835d817", "adcf6b0763612e2f", "a5c91da7acaa4dde", "716595876650a2a6", "28ef495c53a387ad", "42c341d8fa92d832",
  "ce7cf2722f512771", "e37859f94623f3a7", "381205bb1ab0e012", "ae97a10fd434e015", "b4a31508beff4d31", "81396229f0907902", "4d0cf49ee5d4dcca", "5c73336a76d8bf9a",
  "d0a704536ba93e0e", "925958fcd6420cad", "a915c29bc8067318", "952b79f3bc0aa6d4", "f21df2e41d4535f9", "87577519048f53a9", "10a56cf5dfcd9adb", "eb75095ccd986cd0",
  "51a9cb9ecba312e6", "96afadfc2ce666c7", "72fe52975a4364ee", "5a1645b276d592a1", "b274cb8ebf87870a", "6f9bb4203de7b381", "eaecb2a30b22a87f", "9924a43cc1315724",
  "bd838d3aafbf8db7", "0b1a2a3265d51aea", "135079a3231ce660", "932b2846e4d70666", "e1915f5cb1eca46c", "f325965ca16d629f", "575ff28e60381be5", "724506eb4c328a95"];
ok("SipHash-2-4 matches all 64 reference vectors", () => {
  assert.strictEqual(VECTORS.length, 64);
  VECTORS.forEach((want, len) => {
    const msg = String.fromCharCode(...[...Array(len).keys()]);
    assert.strictEqual(R.siphash24(KEY, msg), want, "message length " + len);
  });
});
ok("the k1 key is read in full: flipping any one of the 128 bits changes the hash", () => {
  const msg = "flare|2461700", base = R.siphash24(KEY, msg), seen = new Set([base]);
  for (let bit = 0; bit < 128; bit++){
    const bytes = KEY.match(/../g).map((h) => parseInt(h, 16)); bytes[bit >> 3] ^= 1 << (bit & 7);
    const h = R.siphash24(bytes.map((b) => ("0" + b.toString(16)).slice(-2)).join(""), msg);
    assert(!seen.has(h), "bit " + bit + " did not change the hash"); seen.add(h);
  }
  assert.throws(() => R.siphash24("0011", msg));
});

const K1 = "k1:" + KEY, K1_FLIP = "k1:" + "8" + KEY.slice(1); // bit 7 of byte 0 flipped
ok("k1 seeds are deterministic, keyed, and sensitive to one key bit", () => {
  const H = R.hazards(K1), again = R.hazards(K1), F = R.hazards(K1_FLIP), D = R.hazards("1");
  assert.strictEqual(H, again);
  const days = [...Array(400).keys()].map((d) => 2461400 + d);
  const draws = (X) => days.map((d) => X.u("flare|" + d));
  assert.deepStrictEqual(draws(H), draws(R.hazards(K1)));
  assert.notDeepStrictEqual(draws(H), draws(F));
  assert.notDeepStrictEqual(draws(H), draws(D));
  assert(draws(H).every((x) => x >= 0 && x < 1) && draws(F).every((x) => x >= 0 && x < 1));
  // The draw is the top 53 bits of SipHash(key, label), so it is the reference hash and nothing else.
  const hex = R.siphash24(KEY, "flare|2461400"), le = hex.match(/../g).map((h) => parseInt(h, 16));
  const hi = (le[7] << 24 | le[6] << 16 | le[5] << 8 | le[4]) >>> 0, lo = (le[3] << 24 | le[2] << 16 | le[1] << 8 | le[0]) >>> 0;
  assert.strictEqual(H.u("flare|2461400"), (hi * 2097152 + (lo >>> 11)) / 9007199254740992);
});
ok("k1 seeds drive the hazard layer end to end: flares, pads, busy cars and terms", () => {
  const H = R.hazards(K1), o = [...Array(2000).keys()].map((d) => H.flareOdds(2461400 + d));
  assert(o.every((x) => x === 0.05 || (x >= 0.25 && x <= 0.6)) && o.some((x) => x > 0.25));
  for (let h = 0; h < 200; h++){ const k = Math.floor(t0 * 24) + h; assert(H.docked("iss", k, null, true) <= H.docked("iss", k, null)); }
  const T = R.terms("iss-crew", t0, END, K1), T2 = R.terms("iss-crew", t0, END, K1);
  assert.strictEqual(T.par.kwh, T2.par.kwh); assert.strictEqual(T.par.car, T2.par.car);
  const F = R.fly("iss-crew", T.par.car, T.par.legs, t0, K1); assert(F.arrive_jd >= T.par.legs[1].arr_jd - 1e-9);
  assert.strictEqual(R.start("iss-crew", T.par.car, T.par.legs, t0, K1, { ask_after_hours: null, end_jd: END }).ride.seed, K1);
});

// Captured from the engine before SipHash went in (capture-digit.js over sol-page.js at commit 6915eb5).
const DIGIT = {
  "1": { u: [["spell|91174", 0.5220884557347745], ["flare|2461700", 0.6210560239851475], ["pad|iss|59080812", 0.9697270367760211], ["busy|iss-crew|sf-01|59080812", 0.2223481081891805], ["dust-odds|246170", 0.6433779716026038]],
    flareOdds: [0.05, 0.28528415596423046, 0.5824947346415784], docked_iss: [0, 1, 1, 1, 1],
    pickupStart: [2461700.8556674197, 2461700.5, 2461700.5, 2461700.7999952873, 2461700.5, 2461700.908207495, 2461700.5], weatherAt_mars: null },
  "7": { u: [["spell|91174", 0.21030406327918172], ["flare|2461700", 0.2360147179570049], ["pad|iss|59080812", 0.29519137437455356], ["busy|iss-crew|sf-01|59080812", 0.5347785167396069], ["dust-odds|246170", 0.7685399034526199]],
    flareOdds: [0.05, 0.05, 0.4830356907047745], docked_iss: [0, 1, 2, 2, 2],
    pickupStart: [2461700.5, 2461700.5, 2461700.5, 2461700.5, 2461701.24522235, 2461700.5, 2461700.5], weatherAt_mars: null },
  "42": { u: [["spell|91174", 0.24057030002586544], ["flare|2461700", 0.8472479963675141], ["pad|iss|59080812", 0.3414591825567186], ["busy|iss-crew|sf-01|59080812", 0.07227767934091389], ["dust-odds|246170", 0.9349346240051091]],
    flareOdds: [0.05, 0.05, 0.05], docked_iss: [0, 0, 0, 0, 1],
    pickupStart: [2461701.399274979, 2461700.839161306, 2461700.5, 2461700.78964798, 2461700.827665639, 2461700.5, 2461700.5], weatherAt_mars: null },
  "2026": { u: [["spell|91174", 0.23980730981566012], ["flare|2461700", 0.18993298872373998], ["pad|iss|59080812", 0.43195567396469414], ["busy|iss-crew|sf-01|59080812", 0.2683004669379443], ["dust-odds|246170", 0.7841976294294]],
    flareOdds: [0.05, 0.05, 0.05], docked_iss: [1, 1, 2, 3, 3],
    pickupStart: [2461701.18297314, 2461700.5, 2461700.5, 2461700.5, 2461700.5, 2461700.5, 2461700.5], weatherAt_mars: null }
};
ok("digit seeds keep the FNV hazards byte for byte (values captured before the change)", () => {
  for (const seed of Object.keys(DIGIT)){
    const H = R.hazards(seed), want = DIGIT[seed];
    assert.deepStrictEqual(want.u.map(([k]) => [k, H.u(k)]), want.u, seed);
    assert.deepStrictEqual([2461700, 2461727, 2461754].map((d) => H.flareOdds(d)), want.flareOdds, seed);
    assert.deepStrictEqual([0, 1, 2, 3, 4].map((i) => H.docked("iss", Math.floor(t0 * 24) + i, null)), want.docked_iss, seed);
    assert.deepStrictEqual(R.FLEET.map((c) => R.pickupStart("iss-crew", c.id, t0, seed)), want.pickupStart, seed);
    assert.strictEqual(H.weatherAt("mars-base", t0 + 3), want.weatherAt_mars, seed);
  }
  // Near misses of the k1 form stay on the FNV path, so the format really is the only switch.
  for (const s of ["k1:" + KEY.slice(1), "k1:" + KEY + "0", "k2:" + KEY, "K1:" + KEY, KEY]) assert.notStrictEqual(R.hazards(s).u("flare|2461700"), R.hazards(K1).u("flare|2461700"), s);
});
ok("oracle is exported with the decisions and outcome behind the hindsight reference, and par is unchanged", () => {
  assert.strictEqual(typeof R.oracle, "function"); assert.strictEqual(typeof R.hindsight, "function"); assert.strictEqual(R.ORACLE_DEPTH, 3);
  let withOutcome = 0;
  for (let i = 0; i < 30; i++){
    const seed = String(i), T = R.terms("iss-crew", t0 + i * 3, END, seed), P = T.par;
    const O = R.oracle("iss-crew", P.car, P.legs, t0 + i * 3, seed, END);
    assert(O && Array.isArray(O.path) && Array.isArray(O.decisions), seed);
    assert.strictEqual(O.decisions.length, O.path.length);
    assert(O.outcome && typeof O.outcome.used_kwh === "number" && O.outcome.used_kwh === O.used_kwh && O.outcome.arrive_jd === O.arrive_jd, seed);
    if (O.decisions.length){ withOutcome++; assert(O.decisions.every((d) => d && typeof d === "object")); }
    // par keeps the oracle's answer when it took a decision (choices) and never beats it, so the export changed nothing par reads.
    assert(O.used_kwh <= P.kwh + 1e-9, seed);
    if (P.choices.length){ assert.strictEqual(O.used_kwh, P.kwh, seed); assert.deepStrictEqual(O.path, P.choices, seed); }
  }
  console.log("   oracle took a checkpoint decision on", withOutcome, "of 30 instances");
});
console.log(n, "passed");
