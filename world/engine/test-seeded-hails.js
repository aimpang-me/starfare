// node world/engine/test-seeded-hails.js
const assert = require("assert"), E = require("./sol-page.js"), R = E.R;
let n = 0; const ok = (name, f) => { f(); n++; console.log("ok", name); };

const CATALOG = ["iss-crew", "phobos-commute", "jovian-hop", "titan-home", "ceres-shift"];
const banned = (s) => /\bcar\b|roadster/i.test(s) || /[-–—]/.test(s);

ok("the five catalog hails are unchanged and still resolve", () => {
  assert.deepEqual(R.HAILS.map((h) => h.id), CATALOG);
  CATALOG.forEach((id) => {
    assert.strictEqual(R.BY[id], R.HAILS.find((h) => h.id === id));
    assert.strictEqual(R.BY[id].party, 1);
  });
  assert.strictEqual(R.BY["iss-crew"].from, "iss");
  assert.strictEqual(R.BY["iss-crew"].to, "lunar-data-center");
  assert.strictEqual(R.BY["iss-crew"].kind, "quick");
  assert.deepEqual(R.BY["iss-crew"].rush, { at: "iss", x: 2 });
  assert.deepEqual(R.BY["jovian-hop"].rush, { at: "ganymede", x: 3, after: 2 });
  assert.strictEqual(R.BY["phobos-commute"].rush, undefined);
  assert.strictEqual(R.BY["titan-home"].kind, "long");
});

ok("the same season and index draw the same row, and another season does not", () => {
  const a = R.hailRow("4", 7), b = R.hailRow("4", 7), c = R.hailRow(4, 7);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.notStrictEqual(a, b);
  assert.strictEqual(a.id, "s4-7");
  const left = [], right = [];
  for (let i = 0; i < 40; i++) { left.push(R.hailRow("3", i)); right.push(R.hailRow("8", i)); }
  assert.notDeepEqual(left, right);
});

ok("every drawn row is a legal booking and its text stays clean", () => {
  let none = 0, shape = 0, after = 0;
  for (const season of ["1", "2"]) {
    for (let i = 0; i < 1000; i++) {
      const h = R.hailRow(season, i);
      assert.strictEqual(h.id, "s" + season + "-" + i);
      assert.ok(h.party >= 1 && h.party <= 3 && Number.isInteger(h.party), h.id + " party " + h.party);
      assert.notStrictEqual(h.from, h.to);
      assert.ok(R.nearCars(h).length > 0, h.id + " " + h.from + " to " + h.to);
      assert.strictEqual(h.kind, R.system(h.from) === R.system(h.to) ? "quick" : "long");
      assert.ok(!banned(h.title), h.title);
      assert.ok(!banned(h.blurb), h.blurb);
      assert.ok(!banned(h.rider), h.rider);
      assert.ok(h.blurb.includes("simulated"), h.blurb);
      assert.strictEqual(h.blurb.split(".").length, 2, h.blurb);
      if (!h.rush) none++;
      else if (h.rush.after == null) {
        shape++;
        assert.deepEqual(Object.keys(h.rush).sort(), ["at", "x"]);
        assert.ok(h.rush.x === 2 || h.rush.x === 3);
        assert.ok(h.rush.at === h.from || h.rush.at === h.to);
      } else {
        after++;
        assert.deepEqual(Object.keys(h.rush).sort(), ["after", "at", "x"]);
        assert.strictEqual(h.rush.after, 2);
        assert.ok(h.rush.x === 2 || h.rush.x === 3);
        assert.ok(h.rush.at === h.from || h.rush.at === h.to);
      }
    }
  }
  assert.ok(none > 0 && shape > 0 && after > 0, [none, shape, after].join(" "));
});

ok("admitting a drawn row does not replace a catalog hail", () => {
  const row = R.hailRow("6", 1);
  assert.strictEqual(R.admit(row).id, "s6-1");
  assert.strictEqual(R.BY["s6-1"].from, row.from);
  const catalog = R.BY["iss-crew"];
  assert.strictEqual(R.admit({ id: "iss-crew", title: "nope" }), catalog);
  assert.strictEqual(R.BY["iss-crew"].title, "ISS crew change");
});

console.log(n, "passed");
