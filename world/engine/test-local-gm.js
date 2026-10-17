// node world/engine/test-local-gm.js : a planet-moon hop is one Hohmann, so the quote does not depend on direction.
const assert = require("assert"), E = require("./sol-page.js");
const DEP = 2461700.5;
let n = 0;
const ok = (name, f) => { f(); n++; console.log("ok", name); };
const hop = (a, b) => E.planRide(a, b, { depFrom: DEP });

// The pinned kWh is the moon-departure quote, which already uses the planet-body GM.
// The opposite direction used the system GM and priced a different energy.
ok("Jupiter and Io quote the same energy either way, on the planet-body GM", () => {
  const out = hop("jupiter", "io"), back = hop("io", "jupiter");
  assert.strictEqual(out.local, true);
  assert.strictEqual(back.local, true);
  assert.strictEqual(out.battery.energy_kwh, 232858);
  assert.strictEqual(back.battery.energy_kwh, 232858);
  assert.strictEqual(out.dv_total_kms, back.dv_total_kms);
  assert.strictEqual(out.tof_days, back.tof_days);
  assert.strictEqual(out.fare.total_usd, back.fare.total_usd);
});
ok("Saturn and Titan quote the same energy either way, on the planet-body GM", () => {
  const out = hop("saturn", "titan"), back = hop("titan", "saturn");
  assert.strictEqual(out.battery.energy_kwh, 132725);
  assert.strictEqual(back.battery.energy_kwh, 132725);
  assert.strictEqual(out.dv_total_kms, back.dv_total_kms);
  assert.strictEqual(out.tof_days, back.tof_days);
});
ok("pairs whose two GMs already match stay symmetric", () => {
  for (const [a, b, kwh] of [["earth", "moon", 38145], ["mars", "phobos", 11413], ["neptune", "triton", 76337], ["io", "ganymede", 42620]]) {
    const out = hop(a, b), back = hop(b, a);
    assert.strictEqual(out.battery.energy_kwh, back.battery.energy_kwh, a + " " + b);
    assert.strictEqual(out.dv_total_kms, back.dv_total_kms, a + " " + b);
    assert.strictEqual(out.battery.energy_kwh, kwh, a);
  }
});
console.log(n + " checks passed");
