// Capture stills and clips of the real Starfare pages for marketing and QA: social cards, store-style shots, short
// map loops. Everything shown is the engine's own simulated sky, so captures need no mock data.
//
// By default it starts a local `wrangler dev` from connector/ (OAuth off, throwaway storage) and drives it with
// Playwright's Chromium. three r128 and its addons are answered from node_modules, because the cloud container's
// network policy refuses cdnjs and jsDelivr; the bytes are the npm release, so the pages' SRI hashes still match.
//
//   cd tools/media && npm install && node capture.mjs                       # / at og, square, story sizes
//   node capture.mjs --page /bench --sizes desktop,phone                     # other pages, other sizes
//   node capture.mjs --video 12 --sizes og                                   # 12 s clip -> .mp4 and .gif (ffmpeg)
//   node capture.mjs --base http://127.0.0.1:8787                            # use a Worker you already started
//   node capture.mjs --base ... --page /flight/<run_id> --seek 0.2,0.6      # paused replay stills at fractions of the replay
//   node capture.mjs --reduced                                               # emulate prefers-reduced-motion
//
// Output: tools/media/out/<stamp>/ (gitignored) with a manifest.json naming the engine sha, git commit and page
// console errors, so a published asset can be traced back to the build that drew it. Never points at production
// unless --base says so.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { stopWorkerProcess } from "../../connector/test/worker-process.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CONNECTOR = join(ROOT, "connector");
const THREE = join(HERE, "node_modules", "three");

const SIZES = {
  og: [1200, 630],        // link previews (Open Graph, X/Twitter large card)
  square: [1080, 1080],   // feed posts
  story: [1080, 1920],    // vertical: stories, Shorts, Reels
  desktop: [1440, 900],
  phone: [390, 844],
};

function args(argv) {
  const o = { pages: [], sizes: ["og", "square", "story"], video: 0, wait: 6000, base: null, gif: true, out: null, seek: [], reduced: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === "--page") o.pages.push(v());
    else if (a === "--sizes") o.sizes = v().split(",");
    else if (a === "--video") o.video = Number(v());
    else if (a === "--wait") o.wait = Number(v());
    else if (a === "--base") o.base = v().replace(/\/$/, "");
    else if (a === "--out") o.out = v();
    else if (a === "--no-gif") o.gif = false;
    else if (a === "--seek") o.seek = v().split(",").map(Number);
    else if (a === "--reduced") o.reduced = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.pages.length) o.pages = ["/"];
  if (o.seek.some((f) => !(f >= 0 && f <= 1))) throw new Error("--seek takes fractions of the replay between 0 and 1");
  if (o.seek.length && o.video) throw new Error("--seek makes stills; leave out --video");
  for (const s of o.sizes) if (!SIZES[s]) throw new Error(`unknown size ${s}; one of ${Object.keys(SIZES).join(", ")}`);
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });

async function startWorker() {
  if (!existsSync(join(CONNECTOR, "node_modules", "wrangler"))) throw new Error("connector/node_modules is missing: run `npm ci` in connector/ first");
  execFileSync(process.execPath, ["build.mjs"], { cwd: CONNECTOR, stdio: "ignore" });
  const port = await freePort(), persist = mkdtempSync(join(tmpdir(), "starfare-capture-")), log = [];
  let child, stopping;
  const interrupted = () => { void stop().then(() => process.exit(130), () => process.exit(1)); };
  const stop = () => stopping ||= (async () => {
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
    try { if (child) await stopWorkerProcess(child); }
    finally {
      try { await rm(persist, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (error) { console.warn(`Capture Worker stopped; temporary storage retained at ${persist}: ${error.code}`); }
    }
  })();
  try {
    child = spawn(process.execPath, [join(CONNECTOR, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--port", String(port), "--ip", "127.0.0.1",
      "--persist-to", persist, "--var", "STARFARE_OAUTH:off"], { cwd: CONNECTOR, detached: true, windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } });
    process.once("SIGINT", interrupted);
    process.once("SIGTERM", interrupted);
    child.stdout.on("data", (c) => log.push(String(c))); child.stderr.on("data", (c) => log.push(String(c)));
    let exited = false; child.on("exit", () => { exited = true; });
    let startupError; child.once("error", error => { startupError = error; });
    const base = `http://127.0.0.1:${port}`, deadline = Date.now() + 180_000;
    for (;;) {
      if (startupError) throw startupError;
      if (exited) throw new Error(`wrangler dev exited early:\n${log.join("").slice(-2000)}`);
      if (Date.now() > deadline) throw new Error(`wrangler dev not ready:\n${log.join("").slice(-2000)}`);
      try { await fetch(`${base}/`, { signal: AbortSignal.timeout(1000) }); break; } catch { await sleep(250); }
    }
    return { base, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

// cdnjs three.min.js and jsDelivr's three@0.128.0/<path> are both the npm package's files.
async function serveThreeLocally(context) {
  await context.route(/^https:\/\/(cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/|cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/)/, (route) => {
    const url = new URL(route.request().url());
    const rel = url.hostname === "cdnjs.cloudflare.com" ? "build/" + url.pathname.split("/").pop() : url.pathname.replace("/npm/three@0.128.0/", "");
    const file = join(THREE, rel);
    if (!file.startsWith(THREE) || !existsSync(file)) return route.fulfill({ status: 404, body: "not in three@0.128.0" });
    route.fulfill({ status: 200, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" }, body: readFileSync(file) });
  });
}

// Runs inside the page: pause through the play button, then move the replay scrubber as a viewer would.
function seekReplay(at) {
  const play = document.querySelector("#play"), range = document.querySelector("#srange");
  if (!play || !range) throw new Error("--seek needs a flight replay page");
  if (play.getAttribute("aria-label") === "Pause") play.click();
  range.value = String(Math.round(at * 1000));
  range.dispatchEvent(new Event("input"));
}
// Installed before page scripts: counts every WebGL draw, including post-processing passes, per frame that drew.
function countDraws() {
  const c = window.__draws = { calls: 0, triangles: 0, frames: 0, pending: 0 };
  const tris = (mode, count) => mode === 4 ? count / 3 : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean).map((k) => k.prototype)) {
    for (const [fn, ci, ii] of [["drawArrays", 2, -1], ["drawElements", 1, -1], ["drawArraysInstanced", 2, 3], ["drawElementsInstanced", 1, 4]]) {
      const real = P[fn];
      if (!real) continue;
      P[fn] = function (...a) { c.pending++; c.calls++; c.triangles += tris(a[0], a[ci]) * (ii < 0 ? 1 : a[ii]); return real.apply(this, a); };
    }
  }
  const tick = () => { if (c.pending) { c.frames++; c.pending = 0; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
async function drawStats() {
  const c = window.__draws, t0 = performance.now();
  Object.assign(c, { calls: 0, triangles: 0, frames: 0, pending: 0 });
  await new Promise((r) => setTimeout(r, 2000));
  const s = (performance.now() - t0) / 1000;
  return c.frames ? { calls: Math.round(c.calls / c.frames), triangles: Math.round(c.triangles / c.frames), fps: +(c.frames / s).toFixed(1) } : { calls: 0, triangles: 0, fps: 0 };
}

function slug(page) { return page === "/" ? "home" : page.replace(/^\//, "").replace(/[^\w-]+/g, "-"); }

function ffmpeg(argv) { execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...argv], { stdio: "inherit" }); }

async function main() {
  const o = args(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = o.out || join(HERE, "out", stamp);
  mkdirSync(out, { recursive: true });
  let worker, browser, base;
  const files = [], errors = [], stats = [];
  try {
    worker = o.base ? null : await startWorker();
    base = o.base || worker.base;
    browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
    for (const page of o.pages) {
      for (const size of o.sizes) {
        const [width, height] = SIZES[size];
        const record = o.video > 0;
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: o.reduced ? "reduce" : "no-preference",
          ...(record ? { recordVideo: { dir: out, size: { width, height } } } : {}) });
        await serveThreeLocally(context);
        await context.addInitScript(countDraws);
        const tab = await context.newPage();
        tab.on("console", (m) => { if (m.type() === "error") errors.push({ page, size, text: m.text() }); });
        tab.on("pageerror", (e) => errors.push({ page, size, text: String(e) }));
        await tab.goto(base + page, { waitUntil: "load" });
        await sleep(o.wait);
        const name = `${slug(page)}-${size}`;
        for (const at of o.seek.length ? o.seek : [null]) {
          const still = at == null ? name : `${name}-at${Math.round(at * 100)}`;
          if (at != null) { await tab.evaluate(seekReplay, at); await sleep(1500); }
          await tab.screenshot({ path: join(out, `${still}.png`) });
          files.push(`${still}.png`);
          stats.push({ page, size, at, ...await tab.evaluate(drawStats) });
        }
        if (record) await sleep(o.video * 1000);
        const video = record ? tab.video() : null;
        await context.close();
        if (video) {
          const webm = join(out, `${name}.webm`);
          renameSync(await video.path(), webm);
          // Drop the load-and-settle seconds so the clip starts on a drawn map.
          ffmpeg(["-ss", String(o.wait / 1000), "-i", webm, "-t", String(o.video), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", join(out, `${name}.mp4`)]);
          files.push(`${name}.mp4`);
          if (o.gif) {
            ffmpeg(["-i", join(out, `${name}.mp4`), "-vf", `fps=12,scale=${Math.min(width, 640)}:-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`, join(out, `${name}.gif`)]);
            files.push(`${name}.gif`);
          }
          rmSync(webm);
        }
      }
    }
  } finally {
    try { if (browser) await browser.close(); }
    finally { if (worker) await worker.stop(); }
  }
  let engine = null, commit = null, workingTreeDirty = null;
  try { engine = JSON.parse(readFileSync(join(CONNECTOR, "src", "engine", "meta.json"), "utf8")).sha256; } catch {}
  try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(); } catch {}
  try { workingTreeDirty = !!execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: ROOT }).toString().trim(); } catch {}
  const manifest = { made: new Date().toISOString(), base, commit, working_tree_dirty: workingTreeDirty, engine_sha256: engine, pages: o.pages, sizes: o.sizes,
    video_seconds: o.video, files, console_errors: errors, render_stats: stats,
    render_stats_note: "Per drawn frame over 2 s, post-processing passes included. fps is frames drawn per second under SwiftShader software rendering: a relative cost between captures, not a GPU frame rate.", reduced_motion: o.reduced,
    note: "Captured from the Starfare pages: the sky, fleet, bookings and flights are simulated. Label them so wherever they are posted." };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${files.length} files in ${out}${errors.length ? ` (${errors.length} console errors, see manifest.json)` : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
