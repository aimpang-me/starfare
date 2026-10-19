// Measure the home map's orbit lines in the live scene against a running Worker (wrangler dev):
//   node probe-lines.mjs [base]        # base defaults to http://127.0.0.1:8787
// At the whole-system view and four focus views it reports, for each orbit and moon ring:
//   offPx      how far the body is drawn from its line, in pixels (fail above 1);
//   centre     the line's alpha over the body, rendering that line alone (fail above 0, the gap must hide it);
//   far        the line's alpha at its point farthest from the body (fail at 0, the line must draw);
//   fade       alpha just ahead of the body over alpha just behind it, past the gap (fail outside 0.3 to 0.55).
// It then moves the page clock through thousands of sky days and reports the Moon's distance from its ring as a share
// of the ring radius (fail above 0.5%). Exits 1 on any failure.
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

    line.visible = true;
    r.setRenderTarget(rt); r.clear(); r.render(scene, cam); r.setRenderTarget(null);
    const reach = u.gapR.value.y + 10;
    const walk = (step) => { for (let j = 1; j < N; j++) { const p = P[(k + step * j + N * N) % N]; if (dist(p, B) >= reach) return p; } return null; };
    const behind = walk(-1), ahead = walk(1);
    const far = P.filter(on).reduce((f, p) => (dist(p, B) > dist(f, B) ? p : f), B);
    const fade = behind && ahead && on(behind) && on(ahead) ? alphaAt(ahead) / alphaAt(behind) : null;
    line.visible = false;
    out.lines.push({
      id: line.userData.id, gapPx: +u.gapR.value.y.toFixed(1), offPx: +offPx.toFixed(2), offPct: +(100 * dw / R).toFixed(2),
      centre: +alphaAt(B).toFixed(3), far: dist(far, B) > reach ? +alphaAt(far).toFixed(3) : null, fade: fade == null ? null : +fade.toFixed(2)
    });
  }
  hidden.forEach((o) => { o.visible = true; });
  scene.background = bg; rt.dispose();
  return out;
}, label);

const focus = (id) => page.evaluate((id) => { const b = [...document.querySelectorAll("#planetNav [data-body]")].find((x) => x.dataset.body === id); if (b) b.click(); return !!b; }, id);
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
