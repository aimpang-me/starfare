// node world/engine/test-local-gm.js : a planet-moon hop is one Hohmann, so the quote does not depend on direction.
const assert = require("assert"), E = require("./sol-page.js");
const DEP = 2461700.5;
let n = 0;
const ok = (name, f) => { f(); n++; console.log("ok", name); };
const hop = (a, b, ship) => E.planRide(a, b, { depFrom: DEP, ship });
// The published RTG tank holds 1085 kg. Jupiter to Io needs 1230.4 kg, so this quote raises the tank only to read the energy.
const rtgQuote = { ...E.SHIP_CLASSES.rtg, xenon_kg: 2000 };

// The pinned kWh is the planet-body GM on that ship. The system GM prices 164476 kWh on Jupiter and 86838 kWh on Saturn.
ok("Jupiter and Io quote the same energy either way, on the planet-body GM", () => {
  const held = hop("jupiter", "io", "rtg"), heldBack = hop("io", "jupiter", "rtg");
  const need = "RTG class xenon tank holds 1085 kg and this leg needs 1230.4 kg";
  assert.strictEqual(held.error, need);
  assert.strictEqual(heldBack.error, need);
  const out = hop("jupiter", "io", rtgQuote), back = hop("io", "jupiter", rtgQuote);
  assert.strictEqual(out.local, true);
  assert.strictEqual(back.local, true);
  assert.strictEqual(out.battery.energy_kwh, 164448);
  assert.strictEqual(back.battery.energy_kwh, 164448);
  assert.strictEqual(out.dv_total_kms, back.dv_total_kms);
  assert.strictEqual(out.tof_days, back.tof_days);
  assert.strictEqual(out.fare.total_usd, back.fare.total_usd);
});
ok("Saturn and Titan quote the same energy either way, on the planet-body GM", () => {
  const out = hop("saturn", "titan", "rtg"), back = hop("titan", "saturn", "rtg");
  assert.strictEqual(out.local, true);
  assert.strictEqual(back.local, true);
  assert.strictEqual(out.battery.energy_kwh, 86823);
  assert.strictEqual(back.battery.energy_kwh, 86823);
  assert.strictEqual(out.dv_total_kms, back.dv_total_kms);
  assert.strictEqual(out.tof_days, back.tof_days);
});
ok("pairs whose two GMs already match stay symmetric", () => {
  for (const [a, b, ship, kwh] of [["earth", "moon", "dawn", 21936], ["mars", "phobos", "dawn", 6584], ["neptune", "triton", "rtg", 47563], ["io", "ganymede", "rtg", 25731]]) {
    const out = hop(a, b, ship), back = hop(b, a, ship);
    assert.strictEqual(out.battery.energy_kwh, back.battery.energy_kwh, a + " " + b);
    assert.strictEqual(out.dv_total_kms, back.dv_total_kms, a + " " + b);
    assert.strictEqual(out.battery.energy_kwh, kwh, a);
  }
});
console.log(n + " checks passed");
