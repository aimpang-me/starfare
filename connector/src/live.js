// Live playback of a season flight: its sky timeline mapped onto real time, so a dispatched Starseeker takes about a
// minute or two to fly and everyone watching /flight/<run_id> sees the same moment. Nothing is simulated again here:
// the track is read off the engine's ride (each seg's flew times) and stored on the run as [[wall_ms, jd], ...].
// No Workers APIs here, so it runs the same in a Durable Object and in plain Node.

/** The rule: about s_per_leg real seconds per planned leg, min_s to max_s for the whole flight. A wait on a pad or in orbit
 *  plays as wait_units of a leg however long it lasts, so a pickup hop of hours and a cruise of months both stay watchable. */
export const PLAYBACK = { s_per_leg: 40, min_s: 45, max_s: 120, wait_units: 0.25 };

/** The planned legs' playback rate: ms of real time per unit (a leg is 1 unit, a wait between legs wait_units). */
export function msPerUnit(legs) {
  const P = PLAYBACK, s = Math.min(P.max_s, Math.max(P.min_s, P.s_per_leg * legs.length));
  const waits = legs.filter((L, i) => i && L.dep_jd > legs[i - 1].arr_jd).length;
  return (s * 1000) / (legs.length + P.wait_units * waits);
}

/** The ride's sky timeline up to endJd as pieces [from_jd, to_jd, units]: each flight 1 unit, each wait wait_units. */
export function pieces(ride, endJd) {
  const out = [], W = PLAYBACK.wait_units;
  let at = null;
  const add = (a, b, u) => { if (b > a + 1e-9) out.push([a, b, u]); at = Math.max(at ?? b, b); };
  for (const S of ride.segs) {
    const f = S.flew;
    if (!f) continue;
    if (at != null) add(at, f.dep_jd, W);
    const orbit = f.orbit_jd ?? f.land_jd ?? f.left_jd ?? endJd;
    add(f.dep_jd, orbit, 1);
    add(orbit, f.land_jd ?? f.left_jd ?? endJd, W);
  }
  if (at != null && endJd > at) add(at, endJd, W);
  return out;
}

/** A new track: playback starts at nowMs from the first departure and runs to endJd. */
export function startTrack(ride, endJd, mpu, nowMs) {
  const p = pieces(ride, endJd);
  return extendTrack([[nowMs, p.length ? p[0][0] : endJd]], p, mpu, nowMs);
}

/** The track with the pieces after its last point appended. A track that ended at a checkpoint holds there until nowMs
 *  (the bot's answer), so what anyone already watched never moves. */
export function extendTrack(track, pcs, mpu, nowMs) {
  const out = track.slice(), [lastMs, fromJd] = out[out.length - 1];
  let ms = Math.max(nowMs, lastMs);
  if (ms > lastMs) out.push([ms, fromJd]);
  for (const [a, b, u] of pcs) {
    if (b <= fromJd + 1e-9) continue;
    const a2 = Math.max(a, fromJd), w = u === 1 && a2 > a ? (u * (b - a2)) / (b - a) : u;
    ms += w * mpu;
    out.push([Math.round(ms), b]);
  }
  return out;
}

/** Units of playback left from the open checkpoint on, if the ride flew the rest as planned. */
export function unitsLeft(ride) {
  const W = PLAYBACK.wait_units;
  return ride.segs.slice(ride.at.seg).reduce((a, S) => a + (S.flew && S.flew.orbit_jd != null ? W : 1 + W), 0);
}
