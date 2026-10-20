// Screenshots the home map at each fictional station and a few docks, to check the variety models on the real page.
// Serves three r128 from node_modules (the container can't reach the CDNs).  node variety-shots.mjs http://localhost:8799 OUT
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] || "http://localhost:8799", OUT = process.argv[3] || "out/variety";
mkdirSync(OUT, { recursive: true });
const NM = new URL("./node_modules/three/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const js = { contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } };
await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ body: readFileSync(join(NM, "build/three.min.js")), ...js }));
await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/(.+)$/, (r) => r.fulfill({ body: readFileSync(join(NM, r.request().url().match(/three@0\.128\.0\/(.+)$/)[1])), ...js }));
const errs = [], ZOOM = +(process.argv[5] || 8);
page.on("pageerror", (e) => errs.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.type() + ": " + m.text().slice(0, 300)); });
page.on("response", (r) => { if (r.status() >= 400) errs.push(r.status() + " " + r.url()); });
if (process.argv[4] === "preview") {
  // tools/models/variety-preview.html, served beside the page's own assets
  await page.route(/\/assets\/variety-preview\.html/, (r) => r.fulfill({ body: readFileSync(new URL("../models/variety-preview.html", import.meta.url)), contentType: "text/html" }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE + "/assets/variety-preview.html#still", { waitUntil: "load" });
  await page.waitForTimeout(15000);
  await page.screenshot({ path: join(OUT, "preview.png"), fullPage: true });
  console.log(JSON.stringify(errs.slice(0, 30), null, 1));
  await browser.close();
  process.exit(0);
}
await page.goto(BASE + "/?quality=high", { waitUntil: "load" });
await page.waitForTimeout(9000);
await page.screenshot({ path: join(OUT, "00-home.png") });
for (const id of (process.argv[4] || "orbital-depot,lunar-data-center,mars-base,ceres-port,titan-dock,phobos,earth,europa").split(",")) {
  // The page's own jump: a click on a parked-ship row (data-park) in the ships list.
  await page.evaluate((id) => { const b = document.createElement("button"); b.dataset.park = id; document.querySelector("#skList").appendChild(b); b.click(); b.remove(); }, id);
  await page.waitForFunction(() => /Jumping/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => !/Jumping/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, id + ".png") });
  for (let i = 0; i < ZOOM; i++) { await page.locator("#zoomIn").click(); await page.waitForTimeout(900); }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(OUT, id + "-zoom.png") });
}
console.log(JSON.stringify(errs.slice(0, 30), null, 1));
await browser.close();
