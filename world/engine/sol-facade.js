// sol-facade.js -- the API the page (or its Web Worker) calls.  Everything in and out is plain JSON-able data.
// Imports the engine and the baked DE421 table (ephem.js, no network needed) and initialises once.
import * as E from "./sol-engine.js";
import EPHEM from "./ephem.js";
E.init(EPHEM);

export const MU_SUN = E.MU_SUN;
export const PLACES = E.placesTable();
export const EPHEM_RANGE = E.ephemRange();            // [jd_start, jd_end] (TDB)
export const sub = E.sub;
export const propagate = (r, v, dt_s) => E.propagate(r, v, dt_s);   // 2-body around the Sun
export const periodDays = (s) => E.periodDays(s);                   // capped at 60,000 d
export const placeState = (id, jd) => E.placeState(id, jd);         // {r:[km], v:[km/s]} heliocentric ecliptic J2000
export const stateOf = (origin, jd) => E.stateOf(origin, jd);
// planRide(origin {place}|{ship:{r,v,jd}}, toId, {depFrom, depTo (default depFrom+120), arriveBy, objective})
export const planRide = (origin, to, opts) => E.planRide(origin, typeof to === "string" ? { place: to } : to, opts);
// refly(option from planRide) -> {pass, raw_miss_km, final_miss_km, retarget_ms, iterations, ...} | {local:true}
export const refly = (option, opts) => E.refly(option, opts);
export { isoFromJd, jdFromIso, battery, fare } from "./sol-engine.js";
