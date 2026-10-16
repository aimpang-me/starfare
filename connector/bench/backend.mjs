// The bench host for Node: the engine, suite files and argv flags. The host itself (BenchBackend, openTask) is Worker-safe
// and lives in src/bench-host.js, which the hosted connector also runs.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { loadSuite } from "../src/suite.js";

export { BENCH_NOTE, BenchBackend, openTask } from "../src/bench-host.js";

export const loadEngine = () => createRequire(import.meta.url)("../src/engine/sol-page.cjs");
export const readSuite = (path) => loadSuite(readFileSync(path, "utf8"));

/** --name value pairs from argv; a flag with no value is true. */
export function flags(argv, known) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (!m || !known.includes(m[1])) throw new Error("unknown argument " + argv[i] + "; known: " + known.map((k) => "--" + k).join(" "));
    o[m[1]] = argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return o;
}
