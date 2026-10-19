// Check the home map's overlays against a running Worker (wrangler dev) in Playwright's Chromium:
//   node check-layout.mjs [base]        # base defaults to http://127.0.0.1:8787
// At phone and desktop sizes it checks that the time readout (#hud), the planet dock (#planetNav) and the map controls
// (.mc-map-controls) do not overlap, on phones with the bookings sheet open and folded, and that after a few real seconds the default map clock is still the live sky
// clock and the readout says so. Exits 1 on any failure.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const THREE = join(dirname(fileURLToPath(import.meta.url)), "node_modules", "three");
const SIZES = { phone: [390, 844], small: [360, 780], desktop: [1440, 900] };
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const fails = [], PARTS = ["#hud", "#planetNav", ".mc-map-controls"];
// Runs in the page: the bounding box of each overlay, or null when it is missing or not drawn.
function measure() {
  return ["#hud", "#planetNav", ".mc-map-controls"].map((s) => { const e = document.querySelector(s), b = e && e.getBoundingClientRect(); return b && b.width && b.height ? { s, top: b.top, bottom: b.bottom, left: b.left, right: b.right } : null; });
}
function overlaps(name, all) {
  if (all.some((b) => !b)) fails.push(`${name}: missing ${PARTS.filter((s, i) => !all[i]).join(", ")}`);
  const boxes = all.filter(Boolean);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j], x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (x > 0 && y > 0) fails.push(`${name}: ${a.s} overlaps ${b.s} by ${Math.round(x)} x ${Math.round(y)} px`);
  }
}

for (const [name, [width, height]] of Object.entries(SIZES)) {
  const context = await browser.newContext({ viewport: { width, height } });
  // The container's network refuses the CDNs; the npm release is byte-identical, so the pages' SRI hashes match.
  await context.route(/^https:\/\/(cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/|cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/)/, (route) => {
    const url = new URL(route.request().url());
    const file = join(THREE, url.hostname === "cdnjs.cloudflare.com" ? "build/" + url.pathname.split("/").pop() : url.pathname.replace("/npm/three@0.128.0/", ""));
    if (!file.startsWith(THREE) || !existsSync(file)) return route.fulfill({ status: 404, body: "not in three@0.128.0" });
    route.fulfill({ status: 200, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" }, body: readFileSync(file) });
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/");
  await page.waitForTimeout(6000);
  const r = { boxes: await page.evaluate(measure), hud: await page.textContent("#hud"), sky: await page.textContent("#clkS") };
  // The strip's map clock (#clk) read 5 real seconds apart gives the map's pace in sky days per second.
  const clk = async () => [Date.now(), Date.parse((await page.textContent("#clk")).replace(" UTC", "").replace(" ", "T") + "Z")];
  const [a0, m0] = await clk(); await page.waitForTimeout(5000); const [a1, m1] = await clk();
  r.pace = (m1 - m0) / 864e5 / ((a1 - a0) / 1000);
  const boxes = r.boxes.filter(Boolean);
  overlaps(name, r.boxes);
  // Phones can fold the bookings sheet down to its tabs; the overlays move with it.
  if (width <= 760) {
    await page.click(".mc-sheet-collapse"); await page.waitForTimeout(800);
    overlaps(name + " (sheet folded)", await page.evaluate(measure));
  }
  if (!(r.pace > 0.8 && r.pace < 1.2)) fails.push(`${name}: the map clock runs ${r.pace.toFixed(2)} sky days a second at the default speed; the sky runs 1`);
  if (/^Sky date/.test(r.sky)) fails.push(`${name}: the strip shows a separate sky date, so the map is not on the live sky`);
  if (!/^Live sky/.test(r.hud)) fails.push(`${name}: readout says "${r.hud.slice(0, 40)}", not Live sky`);
  if (errors.length) fails.push(`${name}: page errors ${errors.join(" | ").slice(0, 300)}`);
  console.log(name, JSON.stringify(boxes.map((b) => [b.s, Math.round(b.top), Math.round(b.bottom), Math.round(b.left), Math.round(b.right)])), "pace:", r.pace.toFixed(2), "hud:", r.hud);
  await context.close();
}
await browser.close();
for (const f of fails) console.log("FAIL", f);
console.log(fails.length ? `${fails.length} failed` : "all passed");
process.exit(fails.length ? 1 : 0);
