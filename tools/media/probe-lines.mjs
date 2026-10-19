// Measure the home map's orbit lines in the live scene against a running Worker (wrangler dev):
//   node probe-lines.mjs [base]        # base defaults to http://127.0.0.1:8787
// At the whole-system view and four focus views it reports, for each orbit and moon ring:
//   offPx      how far the body is drawn from its line, in pixels (fail above 1);
//   centre     the line's alpha over the body, rendering that line alone (fail above 0, the gap must hide it);
//   far        the line's alpha at its point farthest from the body (fail at 0, the line must draw);
//   fade       alpha just ahead of the body over alpha just behind it, past the gap (fail outside 0.3 to 0.55);
//              ringPx, uBehind and uAhead give the ring's radius on screen and the trail phase at those two points.
// It then moves the page clock through thousands of sky days and reports the Moon's distance from its ring as a share
// of the ring radius (fail above 0.5%).
// Then it sets the page clock inside each cruise leg of each live flight: mid-leg at the whole-system view, and 5 real
// seconds before arrival at the destination's system. Over about 90 drawn frames it follows every route leg's middle
// point (fail if a leg holds still and then jumps more than 1.5 px) and the flown trail's tip against the nearest ship
// (fail above 1 px, or if no tip was ever measured).
// Exits 1 on any failure.
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8787";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  const real = Date.now.bind(Date);
  let skip = 0;
  Date.now = () => real() + skip;
  window.__skipMs = (ms) => { skip += ms; };
  addEventListener("load", () => {
    const up = THREE.OrthographicCamera.prototype.updateProjectionMatrix;
    THREE.OrthographicCamera.prototype.updateProjectionMatrix = function () { window.__cam = this; return up.apply(this, arguments); };
    const umw = THREE.Object3D.prototype.updateMatrixWorld;
    THREE.Object3D.prototype.updateMatrixWorld = function () { if (this.isScene) window.__scene = this; return umw.apply(this, arguments); };
  });
});
await page.goto(base + "/", { waitUntil: "load" });
await page.waitForTimeout(4500);

const measure = (label) => page.evaluate((label) => {
  const cam = window.__cam, scene = window.__scene;
  scene.updateMatrixWorld(true);
  const rings = [];
  scene.traverseVisible((o) => { if (o.isMesh && o.material.uniforms && o.material.uniforms.ahead && o.material.uniforms.ahead.value < 1) rings.push(o); });
  if (!rings.length) return { label, lines: [] };
  const U = rings[0].material.uniforms, size = U.res.value, dpr = U.dpr.value, W = size.x / dpr, H = size.y / dpr;
  const px =(v) => { const p = v.clone().project(cam); return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H]; };
  const on = (p) => p[0] >= 0 && p[0] < W && p[1] >= 0 && p[1] < H;
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const seg = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };

  const buf = new Uint8Array(4);
  const r =window.__probeR || (window.__probeR = new THREE.WebGLRenderer({ logarithmicDepthBuffer: true }));
  const rt = new THREE.WebGLRenderTarget(size.x, size.y);
  const hidden = [];
  scene.traverse((o) => { if ((o.isMesh || o.isLine || o.isPoints || o.isSprite) && o.visible) { hidden.push(o); o.visible = false; } });
  const bg = scene.background;
  scene.background = null; r.setClearColor(0x000000, 0);
  const alphaAt = (p) => {
    let m = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      r.readRenderTargetPixels(rt, Math.round(p[0] * dpr) + dx, Math.round((H - p[1]) * dpr) + dy, 1, 1, buf);
      m = Math.max(m, buf[3]);
    }
    return m / 255;
  };

  const out = { label, jd: +SF.sky().jd.toFixed(1), lines: [] };
  for (const line of rings) {
    const u = line.material.uniforms, at = line.geometry.attributes, n = line.geometry.instanceCount, centre = line.parent.position;
    const B = px(u.gapC.value);
    if (!on(B)) continue;
    const world = [];
    for (let i = 0; i < n; i++) world.push(new THREE.Vector3(at.a.getX(i), at.a.getY(i), at.a.getZ(i)).applyMatrix4(line.matrixWorld));
    world.push(new THREE.Vector3(at.b.getX(n - 1), at.b.getY(n - 1), at.b.getZ(n - 1)).applyMatrix4(line.matrixWorld));
    const P = world.map(px), N = P.length;
    let offPx = Infinity, k = 0;
    for (let i = 1; i < N; i++) offPx = Math.min(offPx, seg(B, P[i - 1], P[i]));
    for (let i = 1; i < N; i++) if (dist(P[i], B) < dist(P[k], B)) k = i;
    let dw = Infinity;
    const b = u.gapC.value;
    for (let i = 1; i < N; i++) {
      const s = world[i].clone().sub(world[i - 1]), t = Math.max(0, Math.min(1, b.clone().sub(world[i - 1]).dot(s) / s.lengthSq()));
      dw = Math.min(dw, b.distanceTo(world[i - 1].clone().addScaledVector(s, t)));
    }
    const R = world.reduce((s, w) => s + w.distanceTo(centre), 0) / N;

    // MAX blending reads each pixel's own shader alpha. Where two segments join, their quads overlap on the inside of
    // the bend, and normal blending would add the two there.
    const blend = [line.material.blending, line.material.blendEquation, line.material.blendEquationAlpha];
    Object.assign(line.material, { blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendEquationAlpha: THREE.MaxEquation });
    line.visible = true;
    r.setRenderTarget(rt); r.clear(); r.render(scene, cam); r.setRenderTarget(null);
    [line.material.blending, line.material.blendEquation, line.material.blendEquationAlpha] = blend;
    const reach = u.gapR.value.y + 10;
    const walk = (step) => { for (let j = 1; j < N; j++) { const i = (k + step * j + N * N) % N; if (dist(P[i], B) >= reach) return i; } return -1; };
    const ib = walk(-1), ia = walk(1), behind = P[ib], ahead = P[ia];
    const phase = (i) => (i < 0 ? null : +SolLines.phase(world[i].clone().sub(centre), u.body.value, u.nrm.value).toFixed(3));
    const C = px(centre), ringPx = P.reduce((s, p) => s + dist(p, C), 0) / N;
    const far = P.filter(on).reduce((f, p) => (dist(p, B) > dist(f, B) ? p : f), B);
    const fade = behind && ahead && on(behind) && on(ahead) ? alphaAt(ahead) / alphaAt(behind) : null;
    line.visible = false;
    out.lines.push({
      id: line.userData.id, gapPx: +u.gapR.value.y.toFixed(1), offPx: +offPx.toFixed(2), offPct: +(100 * dw / R).toFixed(2),
      centre: +alphaAt(B).toFixed(3), far: dist(far, B) > reach ? +alphaAt(far).toFixed(3) : null, fade: fade == null ? null : +fade.toFixed(2),
      ringPx: +ringPx.toFixed(1), uBehind: phase(ib), uAhead: phase(ia)
    });
  }
  hidden.forEach((o) => { o.visible = true; });
  scene.background = bg; rt.dispose();
  return out;
}, label);

// Samples once per drawn frame (the page caps its frame rate), from the scene's onBeforeRender.
const trackRoutes = (label, frames = 90) => page.evaluate(({ label, frames }) => new Promise((done) => {
  const cam = window.__cam, scene = window.__scene, prev = scene.onBeforeRender;
  const last = new Map(), still = new Set();
  const out = { label, frames: 0, legs: 0, maxStepPx: 0, stillJumps: 0, tips: 0, maxTipPx: 0 };
  let stamp = null;
  const finish = () => { scene.onBeforeRender = prev; out.maxStepPx = +out.maxStepPx.toFixed(2); out.maxTipPx = +out.maxTipPx.toFixed(2); done(out); };
  const guard = setTimeout(finish, 15000);
  scene.onBeforeRender = function () {
    prev.apply(this, arguments);
    if (document.timeline.currentTime === stamp) return;
    stamp = document.timeline.currentTime;
    const legs = [], ships = [];
    scene.traverseVisible((o) => {
      if (o.isMesh && o.material.defines && o.material.defines.ROUTE) legs.push(o);
      if (o.userData.headingSet) ships.push(o);
    });
    if (!legs.length) return;
    const R = legs[0].material.uniforms, W = R.res.value.x / R.dpr.value, H = R.res.value.y / R.dpr.value;
    const px = (v) => { const p = v.clone().project(cam); return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H]; };
    const on = (p) => p[0] >= 0 && p[0] < W && p[1] >= 0 && p[1] < H;
    const shipPx = ships.map((o) => px(o.getWorldPosition(new THREE.Vector3()))).filter(on);
    const end = (m, i, side) => {
      const at = m.geometry.attributes, u = m.material.uniforms, r = side ? at.rb : at.ra, q = side ? at.b : at.a;
      const f = r.getX(i);
      return { v: new THREE.Vector3(q.getX(i), q.getY(i), q.getZ(i)).add(u.e0.value.clone().lerp(u.e1.value, f)).applyMatrix4(m.matrixWorld), s: r.getY(i), f };
    };
    for (const m of legs) {
      const n = m.geometry.instanceCount, mid = px(end(m, n >> 1, 0).v), was = last.get(m);
      if (was) {
        const d = Math.hypot(mid[0] - was[0], mid[1] - was[1]);
        if (on(mid)) out.maxStepPx = Math.max(out.maxStepPx, d);
        if (still.has(m) && d > 1.5) out.stillJumps++;
        if (d < 0.01) still.add(m); else still.delete(m);
      }
      last.set(m, mid);
      const now = m.material.uniforms.now.value;
      for (let i = 0; i < n; i++) {
        const a = end(m, i, 0), b = end(m, i, 1);
        if (!(a.s <= now && now < b.s)) continue;
        const tip = px(a.v.lerp(b.v, (now - a.s) / (b.s - a.s)));
        if (!on(tip) || !shipPx.length) break;
        const gap = Math.min(...shipPx.map((p) => Math.hypot(p[0] - tip[0], p[1] - tip[1])));
        out.tips++;
        if (gap > out.maxTipPx) { out.maxTipPx = gap; out.worstTip = { tip: tip.map(Math.round), ships: shipPx.map((p) => p.map(Math.round)), f: +(a.f + (b.f - a.f) * (now - a.s) / (b.s - a.s)).toFixed(4) }; }
        break;
      }
    }
    out.legs = Math.max(out.legs, legs.length);
    if (++out.frames >= frames) { clearTimeout(guard); finish(); }
  };
}), { label, frames });
const routeChecks = (r) => {
  console.log(JSON.stringify(r));
  if (!r.legs) fails.push(`${r.label}: no route legs drawn`);
  if (r.stillJumps) fails.push(`${r.label}: ${r.stillJumps} route steps held still then jumped over 1.5 px`);
  if (r.maxTipPx > 1) fails.push(`${r.label}: trail tip ${r.maxTipPx} px from its ship`);
};

// "whole" is the whole-system view (the reset button); other ids are the planet buttons.
const focus = (id) => page.evaluate((id) => {
  const b = id === "whole" ? document.querySelector("#resetMap") : [...document.querySelectorAll("#planetNav [data-body]")].find((x) => x.dataset.body === id);
  if (b) b.click();
  return !!b;
}, id);
const skipDays = (d) => page.evaluate((d) => { const t = Date.now(), k = (SF.sky(t + 1e4).jd - SF.sky(t).jd) / 1e4; window.__skipMs(d / k); }, d);

const fails = [];
const report = (r, check) => { console.log(JSON.stringify(r)); for (const l of r.lines) for (const f of check(l)) fails.push(`${r.label} ${l.id}: ${f}`); };
const lineChecks = (l) => [
  l.offPx > 1 && `${l.offPx} px off its line`,
  l.centre > 0 && `alpha ${l.centre} over the body`,
  l.far === 0 && "does not draw",
  l.fade != null && (l.fade < 0.3 || l.fade > 0.55) && `fade ${l.fade}`
].filter(Boolean);
report(await measure("whole system"), lineChecks);
for (const id of ["earth", "mars", "jupiter", "saturn"]) {
  if (!(await focus(id))) { fails.push(`no focus button for ${id}`); continue; }
  await page.waitForTimeout(3500);
  report(await measure("focus " + id), lineChecks);
}

// Each target is a wall-clock time inside a recorded track, so the page replays that moment of the flight.
const targets = await page.evaluate(async () => {
  const nav = new Set([...document.querySelectorAll("#planetNav [data-body]")].map((b) => b.dataset.body));
  const { flights = [] } = await (await fetch("/live.json", { cache: "no-store" })).json();
  const out = [];
  for (const f of flights) {
    const msAt = (jd) => {
      const tr = f.track;
      for (let i = 1; i < tr.length; i++) if (jd <= tr[i][1]) return tr[i - 1][0] + (tr[i][0] - tr[i - 1][0]) * (jd - tr[i - 1][1]) / Math.max(1e-9, tr[i][1] - tr[i - 1][1]);
      return tr[tr.length - 1][0];
    };
    for (const L of f.legs) {
      const orb = L.orbit_jd || L.arr_jd;
      if (L.idle || !(orb > L.dep_jd)) continue;
      const a = msAt(L.dep_jd), b = msAt(orb), sys = SF.system(L.to), name = `${f.ship} ${L.from}>${L.to}`;
      out.push({ name: name + " mid-leg", view: "whole", ms: Math.max(a, (a + b) / 2 - 2000) });
      if (nav.has(sys)) out.push({ name: name + " arriving", view: sys, ms: Math.max(a, b - 5000) });
    }
  }
  return out;
});
let tips = 0;
for (const t of targets) {
  await focus(t.view);
  await page.waitForTimeout(3500);
  await page.evaluate((ms) => window.__skipMs(ms - Date.now()), t.ms);
  await page.waitForTimeout(500);
  const r = await trackRoutes(`routes, ${t.name}, view ${t.view}`);
  tips += r.tips;
  routeChecks(r);
}
if (!tips) fails.push("routes: no trail tip measured (no live flight in cruise on screen)");

await focus("earth");
await page.waitForTimeout(3500);
const room = await page.evaluate(() => SF.SEASON_END - SF.sky().jd);
let done = 0;
for (const d of [7, 30, 100, 1000, 3000]) {
  if (d > room - 10) { console.log(`skip to +${d} d: past the season end, not measured`); continue; }
  await skipDays(d - done); done = d;
  await page.waitForTimeout(600);
  const r = await measure(`earth focus +${d} sky days`);
  r.lines = r.lines.filter((l) => l.id === "moon");
  report(r, (l) => [l.offPct > 0.5 && `Moon ${l.offPct}% of its ring radius off`].filter(Boolean));
}
if (errors.length) fails.push("page errors: " + errors.slice(0, 3).join(" | "));
console.log(fails.length ? "FAIL\n" + fails.join("\n") : "PASS");
await browser.close();
process.exit(fails.length ? 1 : 0);
