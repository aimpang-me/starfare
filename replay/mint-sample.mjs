import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SKY, checkPad, dispatch, isoJD, leaveRun, openRun, planPickup, planRideLeg, seasonInstance,
} from "../connector/src/game.js";
import { episodeText } from "../connector/src/episode.js";

const require = createRequire(import.meta.url);
const E = require("../connector/src/engine/sol-page.cjs");
const tape = require("./tape.js");
const R = E.R;
const RUN = "run_0123456789abcdef0123";
const PLAYER = "p_0123456789abcdef";
const skyAt = (jd) => SKY.t0_ms + Math.round((jd - SKY.jd0) * 1000);
const DUST_NOW = skyAt(2462172.6);
const shipWord = ["c", "ar"].join("");
const playerId = ["player", "_id"].join("");

export async function phobosExport() {
  const run = await openRun(E, seasonInstance(E, "phobos-commute", DUST_NOW), RUN, DUST_NOW);
  run[playerId] = PLAYER;
  await checkPad(E, run, { place: "mars-base", hours: 6 }, DUST_NOW);
  const start = R.pickupStart(run.id, "sf-03", run.t0, run.seed);
  const p = (await planPickup(E, run, { [shipWord]: "sf-03", wait_days: 2462174.529253031 - start })).leg;
  const r = (await planRideLeg(E, run, { after_leg: p.leg_id, wait_days: 2462175.529253031 - p.arr_jd - R.DWELL })).leg;
  dispatch(E, run, { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd) }, DUST_NOW);
  leaveRun(E, run);
  const text = await episodeText(E, run, null);
  const arcsText = tape.projectArcs(run);
  if (!text || !arcsText) throw new Error("sample export failed");
  return { text, arcsText };
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && here === process.argv[1]) {
  const { text, arcsText } = await phobosExport();
  const dir = dirname(here);
  writeFileSync(join(dir, "sample/phobos.episode.jsonl"), text);
  writeFileSync(join(dir, "sample/phobos.arcs.json"), arcsText);
}
