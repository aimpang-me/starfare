// Loads the Starfare engine (src/engine/sol-page.cjs, a byte-for-byte copy of sol/world/engine/sol-page.js made by
// build.mjs) on first use. A dynamic import keeps its ~0.25 s parse-and-init out of every isolate's startup.
let ready = null;
export function engine() {
  ready ??= import("./engine/sol-page.cjs").then((mod) => mod.default ?? mod);
  return ready;
}
