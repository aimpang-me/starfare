// sol-engine.js -- ROBOTAXI: SOL trip planner + n-body re-fly gate, ported from sol/code/*.py.
// Plain ES module, no dependencies; runs in a browser, a Web Worker and Node 22.
// Call init(ephemData) once with the object from ephem.json / ephem.js (bake_ephem.py) before anything else.
//
// Frames and units (same as code/ephem.py): heliocentric J2000 ECLIPTIC, km, km/s, TDB Julian dates.
// Ports, line for line where it matters:
//   kepler.py propagate          -> kepler()
//   lambert_izzo.py lambert      -> lambert()          (0 rev, and 1+ rev on both branches)
//   nbody.py Model/hyperbola_start/newton + scipy DOP853 (same tableau, error norm, step control)
//                                -> refly() internals
//   refly.py refly (200 km LEO start) and refly_leg (centre start)   -> refly(leg) modes "leo" / "centre"
//   trip.py search / titan_burn  -> planRide() + burn models;  models.py battery/fare -> battery(), fare()

// ------------------------------------------------------------------ constants (code/ephem.py)
export const J2000 = 2451545.0;
export const DAY = 86400.0;
export const AU_KM = 149597870.700;
export const MU_SUN = 1.32712440041279419e11;
// GM km^3/s^2, DE440 values exactly as ephem.py (system values for barycentres)
export const GM = { 10: 1.32712440041279419e11, 1: 22031.868551, 2: 324858.592000, 399: 398600.435507,
  301: 4902.800118, 3: 398600.435507 + 4902.800118, 4: 42828.375816, 5: 126712764.100000,
  6: 37940584.841800, 7: 5794556.400000, 8: 6836527.100580, 9: 975.500000 };
const EPS = 84381.448 / 3600.0 * Math.PI / 180;
const CE = Math.cos(EPS), SE = Math.sin(EPS);
const eq2ecl = (a) => [a[0], CE * a[1] + SE * a[2], -SE * a[1] + CE * a[2]];
const ecl2eq = (a) => [a[0], CE * a[1] - SE * a[2], SE * a[1] + CE * a[2]];

// ------------------------------------------------------------------ small vector helpers
const norm = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => a.map((x, i) => x - b[i]);
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a) => scl(a, 1 / norm(a));

// ------------------------------------------------------------------ ephemeris table (bake_ephem.py format)
let EPH = null;
export function init(data) {
  if (data && data.default) data = data.default;
  if (!data || data.format !== "sol-ephem-cheb-1") throw new Error("init(): not a sol-ephem-cheb-1 table");
  const A = data.alphabet, inv = new Int16Array(128).fill(-1);
  for (let i = 0; i < A.length; i++) inv[A.charCodeAt(i)] = i;
  const bodies = {};
  for (const [name, b] of Object.entries(data.bodies)) {
    const ncoef = b.nseg * 3 * (b.deg + 1);
    const c = new Float64Array(ncoef);
    let z = 0, sh = 1, k = 0; // z accumulates the zigzag value as a float (values can exceed 2^31)
    for (let i = 0; i < b.data.length; i++) {
      const d = inv[b.data.charCodeAt(i)];
      z += (d & 31) * sh; sh *= 32;
      if (!(d & 32)) {
        const v = (z % 2 === 0) ? z / 2 : -(z + 1) / 2;
        c[k++] = v * b.q_km; z = 0; sh = 1;
      }
    }
    if (k !== ncoef) throw new Error(`ephemeris ${name}: decoded ${k} of ${ncoef} coefficients`);
    const starts = new Float64Array(b.nseg), lens = new Float64Array(b.nseg);
    let t = data.jd_start;
    for (let s = 0; s < b.nseg; s++) {
      const L = b.split ? b.seg_days / 2 ** inv[b.split.charCodeAt(s)] : b.seg_days;
      starts[s] = t; lens[s] = L; t += L;
    }
    // times in SECONDS past J2000 for the evaluator: a JD near 2.46e6 only resolves ~40 us (Earth moves 1.2 m),
    // which made the DOP853 error estimate reject steps near Earth; seconds past J2000 resolve ~0.1 us.
    const startsS = starts.map((x) => (x - J2000) * DAY), lensS = lens.map((x) => x * DAY);
    bodies[name] = { deg: b.deg, n1: b.deg + 1, c, starts, lens, startsS, lensS, uniform: !b.split, seg: b.seg_days,
      segS: b.seg_days * DAY, t0S: (data.jd_start - J2000) * DAY, nseg: b.nseg };
  }
  EPH = { jd0: data.jd_start, jd1: data.jd_end, k: data.earth_k, bodies,
    T: new Float64Array(64), D: new Float64Array(64) };
  return { jd_start: data.jd_start, jd_end: data.jd_end, bodies: Object.keys(bodies) };
}
export const ephemRange = () => { need(); return [EPH.jd0, EPH.jd1]; };
function need() { if (!EPH) throw new Error("sol-engine: call init(ephemData) first"); }

function segIndex(b, ts) {
  if (b.uniform) {
    const s = Math.floor((ts - b.t0S) / b.segS);
    return s < 0 ? 0 : (s >= b.nseg ? b.nseg - 1 : s);
  }
  let lo = 0, hi = b.nseg - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b.startsS[m] <= ts) lo = m; else hi = m - 1; }
  return lo;
}
function checkJd(jd) {
  if (!(jd >= EPH.jd0 - 1e-9 && jd <= EPH.jd1 + 1e-9))
    throw new RangeError(`JD ${jd} outside the ephemeris table (${EPH.jd0} .. ${EPH.jd1})`);
}
// position (and velocity if vout) of one tabulated body at ts = seconds past J2000 TDB; out arrays at offset o
function chebEval(name, ts, pout, po, vout, vo) {
  const b = EPH.bodies[name];
  const s = segIndex(b, ts);
  const x = 2 * (ts - b.startsS[s]) / b.lensS[s] - 1;
  const T = EPH.T, n1 = b.n1;
  T[0] = 1; T[1] = x;
  for (let k = 2; k < n1; k++) T[k] = 2 * x * T[k - 1] - T[k - 2];
  const base = s * 3 * n1, c = b.c;
  for (let ax = 0; ax < 3; ax++) {
    let acc = 0; const o = base + ax * n1;
    for (let k = 0; k < n1; k++) acc += c[o + k] * T[k];
    pout[po + ax] = acc;
  }
  if (vout) {
    const D = EPH.D; D[0] = 0; D[1] = 1;
    for (let k = 2; k < n1; k++) D[k] = 2 * T[k - 1] + 2 * x * D[k - 1] - D[k - 2];
    const f = 2 / b.lensS[s];
    for (let ax = 0; ax < 3; ax++) {
      let acc = 0; const o = base + ax * n1;
      for (let k = 1; k < n1; k++) acc += c[o + k] * D[k];
      vout[vo + ax] = acc * f;
    }
  }
}
const TAB = { mercury: "mercury", venus: "venus", mars: "mars", jupiter: "jupiter", saturn: "saturn",
  uranus: "uranus", neptune: "neptune" };
const _p1 = new Float64Array(3), _v1 = new Float64Array(3), _p2 = new Float64Array(3), _v2 = new Float64Array(3);
// heliocentric state of an ephemeris body ("earth", "moon", planets, "emb", and the n-body small bodies
// "roadster@nbody" etc.)
export function ephState(name, jd) {
  need(); checkJd(jd);
  const ts = (jd - J2000) * DAY;
  if (name === "earth" || name === "moon") {
    chebEval("emb", ts, _p1, 0, _v1, 0); chebEval("moon_geo", ts, _p2, 0, _v2, 0);
    const k = name === "earth" ? -EPH.k : 1 - EPH.k;
    return { r: [_p1[0] + k * _p2[0], _p1[1] + k * _p2[1], _p1[2] + k * _p2[2]],
             v: [_v1[0] + k * _v2[0], _v1[1] + k * _v2[1], _v1[2] + k * _v2[2]] };
  }
  const tab = TAB[name] || (name.endsWith("@nbody") ? name.slice(0, -6) : name);
  if (!EPH.bodies[tab]) throw new Error(`no ephemeris body '${name}'`);
  chebEval(tab, ts, _p1, 0, _v1, 0);
  return { r: [_p1[0], _p1[1], _p1[2]], v: [_v1[0], _v1[1], _v1[2]] };
}

// ------------------------------------------------------------------ kepler.py (universal variables)
function stumpffC(z) {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / (-z);
  return 1 / 2 - z / 24 + z * z / 720 - z ** 3 / 40320;
}
function stumpffS(z) {
  if (z > 1e-6) { const sz = Math.sqrt(z); return (sz - Math.sin(sz)) / sz ** 3; }
  if (z < -1e-6) { const sz = Math.sqrt(-z); return (Math.sinh(sz) - sz) / sz ** 3; }
  return 1 / 6 - z / 120 + z * z / 5040 - z ** 3 / 362880;
}
export function kepler(mu, r0, v0, dt, tol = 1e-15, maxiter = 200) {
  const r0n = norm(r0), vr0 = dot(r0, v0) / r0n;
  const alpha = 2 / r0n - dot(v0, v0) / mu;
  const smu = Math.sqrt(mu);
  let chi;
  if (alpha > 1e-12) chi = smu * dt * alpha;
  else if (alpha < -1e-12) {
    const a = 1 / alpha, s = dt > 0 ? 1 : -1;
    const num = -2 * mu * alpha * dt;
    const den = dot(r0, v0) + s * Math.sqrt(-mu * a) * (1 - r0n * alpha);
    chi = num / den > 0 ? s * Math.sqrt(-a) * Math.log(num / den) : smu * dt / r0n;
  } else chi = smu * dt / r0n;
  const FdF = (x) => {
    const z = alpha * x * x, C = stumpffC(z), S = stumpffS(z);
    return [r0n * vr0 / smu * x * x * C + (1 - alpha * r0n) * x ** 3 * S + r0n * x - smu * dt,
            r0n * vr0 / smu * x * (1 - alpha * x * x * S) + (1 - alpha * r0n) * x * x * C + r0n];
  };
  if (dt === 0) return { r: [...r0], v: [...v0] };
  let lo = dt > 0 ? 0 : null, hi = dt > 0 ? null : 0;
  let probe = (chi !== 0 && Math.sign(chi) === Math.sign(dt)) ? chi : smu * dt / r0n;
  for (;;) {
    const Fp = FdF(probe)[0];
    if (dt > 0) { if (Fp < 0) { lo = probe; probe *= 2; } else { hi = probe; break; } }
    else { if (Fp > 0) { hi = probe; probe *= 2; } else { lo = probe; break; } }
  }
  chi = 0.5 * (lo + hi);
  let ok = false;
  for (let i = 0; i < maxiter; i++) {
    const [F, dF] = FdF(chi);
    if (F < 0) lo = chi; else hi = chi;
    let nw = chi - F / dF;
    if (!(lo < nw && nw < hi)) nw = 0.5 * (lo + hi);
    if (Math.abs(nw - chi) <= tol * Math.max(1, Math.abs(chi))) { chi = nw; ok = true; break; }
    chi = nw;
  }
  if (!ok) throw new Error("Kepler universal-variable iteration did not converge");
  const z = alpha * chi * chi, C = stumpffC(z), S = stumpffS(z);
  const f = 1 - chi * chi / r0n * C, g = dt - chi ** 3 / smu * S;
  const r = [f * r0[0] + g * v0[0], f * r0[1] + g * v0[1], f * r0[2] + g * v0[2]];
  const rn = norm(r);
  const fd = smu / (rn * r0n) * (alpha * chi ** 3 * S - chi), gd = 1 - chi * chi / rn * C;
  return { r, v: [fd * r0[0] + gd * v0[0], fd * r0[1] + gd * v0[1], fd * r0[2] + gd * v0[2]] };
}
// facade: 2-body around the Sun
export const propagate = (r, v, dt_s) => kepler(MU_SUN, r, v, dt_s);
export function periodDays({ r, v }) {
  const a = 1 / (2 / norm(r) - dot(v, v) / MU_SUN);
  if (!(a > 0)) return 60000;
  return Math.min(60000, 2 * Math.PI * Math.sqrt(a ** 3 / MU_SUN) / DAY);
}

// ------------------------------------------------------------------ lambert_izzo.py (Izzo 2015)
function hyp2f1b(x) {
  if (x >= 1) return Infinity;
  let res = 1, term = 1, i = 0;
  for (;;) {
    term = term * (3 + i) * (1 + i) / (2.5 + i) * x / (i + 1);
    const old = res; res += term;
    if (old === res) return res;
    i++;
  }
}
const computeY = (x, ll) => Math.sqrt(1 - ll * ll * (1 - x * x));
function computePsi(x, y, ll) {
  if (x >= -1 && x < 1) return Math.acos(Math.max(-1, Math.min(1, x * y + ll * (1 - x * x))));
  if (x > 1) return Math.asinh((y - x * ll) * Math.sqrt(x * x - 1));
  return 0;
}
function tofEqY(x, y, T0, ll, M) {
  let T_;
  if (M === 0 && Math.sqrt(0.6) < x && x < Math.sqrt(1.4)) {
    const eta = y - ll * x, S1 = (1 - ll - x * eta) * 0.5, Q = 4 / 3 * hyp2f1b(S1);
    T_ = (eta ** 3 * Q + 4 * ll * eta) * 0.5;
  } else {
    const psi = computePsi(x, y, ll);
    T_ = ((psi + M * Math.PI) / Math.sqrt(Math.abs(1 - x * x)) - x + ll * y) / (1 - x * x);
  }
  return T_ - T0;
}
const tofEq = (x, T0, ll, M) => tofEqY(x, computeY(x, ll), T0, ll, M);
const dT = (x, y, T, ll) => (3 * T * x - 2 + 2 * ll ** 3 * x / y) / (1 - x * x);
const d2T = (x, y, T, dT_, ll) => (3 * T + 5 * x * dT_ + 2 * (1 - ll * ll) * ll ** 3 / y ** 3) / (1 - x * x);
const d3T = (x, y, T, dT_, ddT, ll) => (7 * x * ddT + 8 * dT_ - 6 * (1 - ll * ll) * ll ** 5 * x / y ** 5) / (1 - x * x);
function halleyTmin(x0, T0, ll, tol, maxiter) {
  for (let i = 0; i < maxiter; i++) {
    const y = computeY(x0, ll), f1 = dT(x0, y, T0, ll), f2 = d2T(x0, y, T0, f1, ll);
    if (f2 === 0) throw new Error("Derivative was zero");
    const f3 = d3T(x0, y, T0, f1, f2, ll);
    const x = x0 - 2 * f1 * f2 / (2 * f2 * f2 - f1 * f3);
    if (Math.abs(x - x0) < tol) return x;
    x0 = x;
  }
  throw new Error("Tmin Halley iteration failed to converge");
}
function computeTmin(ll, M, maxiter, tol) {
  if (ll === 1) return [0, tofEq(0, 0, ll, M)];
  if (M === 0) return [Infinity, 0];
  const x = halleyTmin(0.1, tofEq(0.1, 0, ll, M), ll, tol, maxiter);
  return [x, tofEq(x, 0, ll, M)];
}
function initialGuess(T, ll, M, lowpath) {
  if (M === 0) {
    const T_0 = Math.acos(ll) + ll * Math.sqrt(1 - ll * ll), T_1 = 2 * (1 - ll ** 3) / 3;
    if (T >= T_0) return (T_0 / T) ** (2 / 3) - 1;
    if (T < T_1) return 2.5 * T_1 / T * (T_1 - T) / (1 - ll ** 5) + 1;
    return Math.exp(Math.log(2) * Math.log(T / T_0) / Math.log(T_1 / T_0)) - 1;
  }
  const a = ((M * Math.PI + Math.PI) / (8 * T)) ** (2 / 3), x0l = (a - 1) / (a + 1);
  const b = ((8 * T) / (M * Math.PI)) ** (2 / 3), x0r = (b - 1) / (b + 1);
  return lowpath ? Math.max(x0l, x0r) : Math.min(x0l, x0r);
}
function householder(x0, T0, ll, M, tol, maxiter) {
  for (let it = 0; it < maxiter; it++) {
    const y = computeY(x0, ll), fval = tofEqY(x0, y, T0, ll, M), T = fval + T0;
    const f1 = dT(x0, y, T, ll), f2 = d2T(x0, y, T, f1, ll), f3 = d3T(x0, y, T, f1, f2, ll);
    const x = x0 - fval * ((f1 * f1 - fval * f2 / 2) / (f1 * (f1 * f1 - fval * f2) + f3 * fval * fval / 6));
    if (Math.abs(x - x0) < tol) return [x, it + 1];
    x0 = x;
  }
  throw new Error("Householder iteration failed to converge");
}
function findXY(ll, T, M, maxiter, lowpath, tol) {
  if (!(Math.abs(ll) < 1)) throw new Error("degenerate geometry |lambda| = 1");
  if (!(T > 0)) throw new Error("non-positive time of flight");
  let Mmax = Math.floor(T / Math.PI), Tmin = null;
  const T00 = Math.acos(ll) + ll * Math.sqrt(1 - ll * ll);
  if (T < T00 + Mmax * Math.PI && Mmax > 0) {
    Tmin = computeTmin(ll, Mmax, maxiter, tol)[1];
    if (T < Tmin) { Mmax -= 1; Tmin = null; }
  }
  if (M > Mmax) throw new Error(`No feasible solution for M=${M} (M_max=${Mmax})`);
  const [x, iters] = householder(initialGuess(T, ll, M, lowpath), T, ll, M, tol, maxiter);
  return [x, computeY(x, ll), iters, M > 0 && M === Mmax && Tmin != null ? T / Tmin - 1 : null];
}
// lambert(r1, r2, tof [s], mu, revs = 0, lowpath = true) -> {v1, v2, angle_deg, iterations}; throws like the
// Python on infeasible/degenerate cases (lambertSafe returns null instead).
export function lambert(r1, r2, tof, mu = MU_SUN, revs = 0, lowpath = true, prograde = true, maxiter = 35, tol = 1e-13) {
  if (!(tof > 0 && mu > 0)) throw new Error("tof and mu must be positive");
  const c = [r2[0] - r1[0], r2[1] - r1[1], r2[2] - r1[2]];
  const cn = norm(c), r1n = norm(r1), r2n = norm(r2);
  const s = 0.5 * (r1n + r2n + cn);
  const ir1 = [r1[0] / r1n, r1[1] / r1n, r1[2] / r1n], ir2 = [r2[0] / r2n, r2[1] / r2n, r2[2] / r2n];
  const h = cross(ir1, ir2), hn = norm(h);
  if (hn < 1e-14) throw new Error("collinear position vectors: transfer plane undefined");
  const ih = [h[0] / hn, h[1] / hn, h[2] / hn];
  let ll = Math.sqrt(Math.max(0, 1 - Math.min(1, cn / s)));
  let it1, it2;
  if (ih[2] < 0) { ll = -ll; it1 = cross(ir1, ih); it2 = cross(ir2, ih); }   // ref_normal = +z
  else { it1 = cross(ih, ir1); it2 = cross(ih, ir2); }
  if (!prograde) { ll = -ll; it1 = scl(it1, -1); it2 = scl(it2, -1); }
  const T = Math.sqrt(2 * mu / s ** 3) * tof;
  const [x, y, iters, fold] = findXY(ll, T, revs, maxiter, lowpath, tol);
  const gamma = Math.sqrt(mu * s / 2), rho = (r1n - r2n) / cn, sigma = Math.sqrt(Math.max(0, 1 - rho * rho));
  const Vr1 = gamma * ((ll * y - x) - rho * (ll * y + x)) / r1n;
  const Vr2 = -gamma * ((ll * y - x) + rho * (ll * y + x)) / r2n;
  const Vt1 = gamma * sigma * (y + ll * x) / r1n, Vt2 = gamma * sigma * (y + ll * x) / r2n;
  const v1 = [0, 1, 2].map((k) => Vr1 * ir1[k] + Vt1 * it1[k]);
  const v2 = [0, 1, 2].map((k) => Vr2 * ir2[k] + Vt2 * it2[k]);
  const n = unit(cross(r1, v1));
  let ang = Math.atan2(dot(cross(ir1, ir2), n), dot(ir1, ir2)) * 180 / Math.PI;
  ang = ((ang % 360) + 360) % 360;
  return { v1, v2, angle_deg: ang, iterations: iters, x, y, fold };
}
export function lambertSafe(r1, r2, tof, mu, revs, lowpath) {
  try { return lambert(r1, r2, tof, mu, revs, lowpath); } catch (e) { return null; }
}

// ------------------------------------------------------------------ places: planets, moons, stations, small bodies
// Body constants: GM from ephem.py (system values, as the n-body uses); radii IAU mean/equatorial (approximate).
// Moons are circular orbits around their parent's centre in the parent's equatorial plane (IAU pole), phase
// arbitrary (argument of latitude 0 at J2000 from the ascending node on the ICRF equator).  Sources (JPL SSD
// planetary-satellite mean elements / physical parameters, rounded; APPROXIMATE, labelled as such):
//   Phobos   a 9,376 km      P 0.31891 d   GM 7.087e-4  R 11.1     (Mars)
//   Io       a 421,800 km    P 1.769138 d  GM 5959.9    R 1821.6   (Jupiter)
//   Europa   a 671,100 km    P 3.551181 d  GM 3202.7    R 1560.8   (Jupiter)
//   Ganymede a 1,070,400 km  P 7.154553 d  GM 9887.8    R 2631.2   (Jupiter)
//   Callisto a 1,882,700 km  P 16.689018 d GM 7179.3    R 2410.3   (Jupiter)
//   Enceladus a 238,040 km   P 1.370218 d  GM 7.211     R 252.1    (Saturn)
//   Titan    a 1,221,870 km  P 15.945 d    GM 8978.14   R 2574.7   (Saturn; a, GM, R exactly as trip.py / titan/)
//   Triton   a 354,759 km    P 5.876854 d  GM 1427.6    R 1353.4   (Neptune; RETROGRADE, put in Neptune's
//            equatorial plane reversed: the real orbit is inclined ~157 deg, i.e. ~23 deg off this plane)
//   Moon     DE421 (not a circular model); a 384,400 km is used only for the escape-through-Earth's-well burn.
// Parent GM for a moon's orbit = the planet's own GM as trip.py uses for Saturn (3.7931187e7); others from
// the same JPL table (Mars 42828.37, Jupiter 1.26686534e8, Neptune 6.836529e6, Earth 398600.435507).
// Parking altitudes are ASSUMPTIONS (Earth 200 km = quote.py/refly.py LEO; Titan 1,500 km = trip.py).
const D2R = Math.PI / 180;
const PLANET_MU = { earth: 398600.435507, mars: 42828.375816, jupiter: 1.26686534e8, saturn: 3.7931187e7,
  neptune: 6.836529e6, uranus: 5793939.3, ceres: 62.6284 };
// IAU pole (RA, Dec) in ICRF, degrees (IAU WGCCRE 2015, J2000 values, no precession)
const POLE = { mercury: [281.01, 61.42], venus: [272.76, 67.16], earth: [0, 90], mars: [317.68, 52.89],
  jupiter: [268.06, 64.50], saturn: [40.59, 83.54], uranus: [257.31, -15.18], neptune: [299.36, 43.46],
  moon: [266.86, 65.64], ceres: [291.42, 66.76], titan: [39.48, 83.43] };
export const PLACES = [
  // planets: helio from DE421; mu = ephem.py GM (system); burn from a circular parking orbit
  { id: "mercury", name: "Mercury", kind: "planet", parent: "sun", real: true, mu: GM[1], radius_km: 2440.5, park_alt_km: 200 },
  { id: "venus", name: "Venus", kind: "planet", parent: "sun", real: true, mu: GM[2], radius_km: 6051.8, park_alt_km: 250, atmosphere: true },
  { id: "earth", name: "Earth", kind: "planet", parent: "sun", real: true, mu: GM[399], radius_km: 6378.137, park_alt_km: 200, atmosphere: true },
  { id: "mars", name: "Mars", kind: "planet", parent: "sun", real: true, mu: GM[4], radius_km: 3396.19, park_alt_km: 200, atmosphere: true },
  { id: "jupiter", name: "Jupiter", kind: "planet", parent: "sun", real: true, mu: GM[5], radius_km: 71492, park_alt_km: 5000, atmosphere: true },
  { id: "saturn", name: "Saturn", kind: "planet", parent: "sun", real: true, mu: GM[6], radius_km: 60268, park_alt_km: 5000, atmosphere: true },
  { id: "uranus", name: "Uranus", kind: "planet", parent: "sun", real: true, mu: GM[7], radius_km: 25559, park_alt_km: 5000, atmosphere: true },
  { id: "neptune", name: "Neptune", kind: "planet", parent: "sun", real: true, mu: GM[8], radius_km: 24764, park_alt_km: 5000, atmosphere: true },
  // moons
  { id: "moon", name: "Moon", kind: "moon", parent: "earth", real: true, mu: GM[301], radius_km: 1737.4, park_alt_km: 100, orbit_km: 384400, period_days: 27.321661 },
  { id: "phobos", name: "Phobos", kind: "moon", parent: "mars", real: true, mu: 7.087e-4, radius_km: 11.1, park_alt_km: 10, orbit_km: 9376, period_days: 0.31891 },
  { id: "io", name: "Io", kind: "moon", parent: "jupiter", real: true, mu: 5959.9, radius_km: 1821.6, park_alt_km: 100, orbit_km: 421800, period_days: 1.769138 },
  { id: "europa", name: "Europa", kind: "moon", parent: "jupiter", real: true, mu: 3202.7, radius_km: 1560.8, park_alt_km: 100, orbit_km: 671100, period_days: 3.551181 },
  { id: "ganymede", name: "Ganymede", kind: "moon", parent: "jupiter", real: true, mu: 9887.8, radius_km: 2631.2, park_alt_km: 100, orbit_km: 1070400, period_days: 7.154553 },
  { id: "callisto", name: "Callisto", kind: "moon", parent: "jupiter", real: true, mu: 7179.3, radius_km: 2410.3, park_alt_km: 100, orbit_km: 1882700, period_days: 16.689018 },
  { id: "enceladus", name: "Enceladus", kind: "moon", parent: "saturn", real: true, mu: 7.211, radius_km: 252.1, park_alt_km: 50, orbit_km: 238040, period_days: 1.370218 },
  { id: "titan", name: "Titan", kind: "moon", parent: "saturn", real: true, mu: 8978.14, radius_km: 2574.7, park_alt_km: 1500, orbit_km: 1221870, period_days: 15.945, atmosphere: true },
  { id: "triton", name: "Triton", kind: "moon", parent: "neptune", real: true, mu: 1427.6, radius_km: 1353.4, park_alt_km: 100, orbit_km: 354759, period_days: 5.876854, retrograde: true },
  // small bodies: the planner and the re-fly both use the baked n-body orbit (refly.py's), not quote.py/trip.py's
  // 2-body Kepler, which is 11 million km off for Ceres by 2041.  Ceres has a gravity well; Bennu's (GM 4.9e-9)
  // and the Roadster's are ignored.
  { id: "roadster", name: "Tesla Roadster", kind: "small", parent: "sun", real: true, mu: 0, radius_km: 0.002, park_alt_km: 0 },
  { id: "bennu", name: "Bennu", kind: "small", parent: "sun", real: true, mu: 0, radius_km: 0.245, park_alt_km: 0 },
  { id: "ceres", name: "Ceres", kind: "small", parent: "sun", real: true, mu: 62.6284, radius_km: 469.7, park_alt_km: 200 },
  // stations: named circular parking orbits around a parent (plane matching is NOT priced)
  { id: "iss", name: "ISS", kind: "station", parent: "earth", real: true, radius_km: 6378.137, park_alt_km: 420, incl_deg: 51.6 },
  { id: "tiangong", name: "Tiangong", kind: "station", parent: "earth", real: true, radius_km: 6378.137, park_alt_km: 390, incl_deg: 41.5 },
  { id: "orbital-depot", name: "Orbital Depot", kind: "station", parent: "earth", real: false, radius_km: 6378.137, park_alt_km: 500, incl_deg: 0 },
  { id: "lunar-data-center", name: "Lunar Data Center", kind: "station", parent: "moon", real: false, radius_km: 1737.4, park_alt_km: 100, incl_deg: 0 },
  { id: "mars-base", name: "Mars Base", kind: "station", parent: "mars", real: false, radius_km: 3396.19, park_alt_km: 300, incl_deg: 0 },
  { id: "ceres-port", name: "Ceres Port", kind: "station", parent: "ceres", real: false, radius_km: 469.7, park_alt_km: 400, incl_deg: 0 },
  { id: "titan-dock", name: "Titan Dock", kind: "station", parent: "titan", real: false, radius_km: 2574.7, park_alt_km: 1500, incl_deg: 0 },
];
const P = Object.fromEntries(PLACES.map((p) => [p.id, p]));
const fmt = (n) => Math.round(n).toLocaleString("en-US");
for (const p of PLACES) {
  if (p.kind === "station") { p.mu = P[p.parent].mu; }
  p.sub = p.kind === "planet" ? `Planet · ${fmt(p.park_alt_km)} km parking orbit`
    : p.kind === "moon" ? `Moon of ${P[p.parent].name} · ${fmt(p.park_alt_km)} km orbit`
    : p.kind === "small" ? (p.mu ? `Dwarf planet · ${fmt(p.park_alt_km)} km orbit` : (p.id === "roadster" ? "Car in a solar orbit · no gravity well" : "Asteroid · gravity ignored"))
    : `${p.real ? "Station" : "Fictional station"} · ${fmt(p.park_alt_km)} km orbit of ${P[p.parent].name}${p.incl_deg ? `, ${p.incl_deg}°` : ""}`;
}
export function placesTable() {
  return PLACES.map(({ id, name, kind, parent, real, mu, radius_km, park_alt_km, orbit_km, period_days, incl_deg, sub }) =>
    ({ id, name, kind, parent, real, mu, radius_km, park_alt_km, ...(orbit_km ? { orbit_km, period_days, parent_mu: PLANET_MU[parent] } : {}),
       ...(incl_deg !== undefined ? { incl_deg } : {}), sub }));
}

// orbit-plane basis (P, Q) for a circular orbit about `parentId`: plane = parent's equator (IAU pole),
// inclined by incl_deg about the equator's ascending node on the ICRF equator; returned in ecliptic coords
function planeBasis(parentId, inclDeg = 0, retro = false) {
  const [ra, de] = POLE[parentId] || [0, 90];
  let pole = [Math.cos(de * D2R) * Math.cos(ra * D2R), Math.cos(de * D2R) * Math.sin(ra * D2R), Math.sin(de * D2R)];
  let node = cross([0, 0, 1], pole);
  node = norm(node) < 1e-9 ? [1, 0, 0] : unit(node);
  const inPlane = cross(pole, node);
  const i = inclDeg * D2R;
  let nrm = add(scl(pole, Math.cos(i)), scl(inPlane, -Math.sin(i)));
  if (retro) nrm = scl(nrm, -1);
  const Pv = node, Qv = cross(nrm, Pv);
  return [eq2ecl(Pv), eq2ecl(Qv)];
}
function circular(parentState, a, mu, periodDays, basis, jd) {
  const n = periodDays ? 2 * Math.PI / (periodDays * DAY) : Math.sqrt(mu / a ** 3);
  const u = n * (jd - J2000) * DAY;
  const [Pv, Qv] = basis, c = Math.cos(u), s = Math.sin(u);
  return { r: [0, 1, 2].map((k) => parentState.r[k] + a * (c * Pv[k] + s * Qv[k])),
           v: [0, 1, 2].map((k) => parentState.v[k] + n * a * (-s * Pv[k] + c * Qv[k])) };
}
let TARGETS = null;  // data/targets.json Horizons states (embedded copy, ecliptic J2000, TDB)
// state(body, jd) -> {r, v} heliocentric; small bodies are the n-body orbits in the table, as the re-fly flies them
export function state(body, jd) {
  need();
  const id = String(body).toLowerCase();
  const p = P[id];
  if (!p) throw new Error(`unknown body '${body}'`);
  if (p.kind === "planet" || id === "moon") return ephState(id, jd);
  if (p.kind === "small") return ephState(id, jd);
  const par = state(p.parent, jd);
  if (p.kind === "moon")
    return circular(par, p.orbit_km, PLANET_MU[p.parent], p.period_days, planeBasis(p.parent, 0, p.retrograde), jd);
  // station
  const a = P[p.parent].radius_km + p.park_alt_km;
  return circular(par, a, P[p.parent].mu, null, planeBasis(p.parent, p.incl_deg || 0), jd);
}
export const placeState = (id, jd) => state(id, jd);

// stateOf(origin, jd): origin = body id | {place: id} | {ship: {r, v, jd}} | {r, v, jd}; ships propagate 2-body
export function stateOf(origin, jd) {
  const o = normEndpoint(origin);
  if (o.ship) { checkJd(jd); return kepler(MU_SUN, o.ship.r, o.ship.v, (jd - o.ship.jd) * DAY); }
  return state(o.place, jd);
}
function normEndpoint(x) {
  if (typeof x === "string") return { place: x.toLowerCase() };
  if (x && x.place) return { place: String(x.place).toLowerCase() };
  if (x && x.ship) return { ship: x.ship };
  if (x && x.r && x.v && x.jd) return { ship: x };
  throw new Error("endpoint must be a place id, {place}, or {ship: {r, v, jd}}");
}

// ------------------------------------------------------------------ patched-conic endpoints
// chain: list of {around, r, mu_local?} from the innermost primary outwards; anchor = the Sun-orbiting body
// whose heliocentric state the Sun-centred leg starts/ends at.
function endpointModel(ep) {
  if (ep.ship) return { kind: "ship", anchor: null, label: "free spaceship", chain: [] };
  const p = P[ep.place];
  if (!p) throw new Error(`unknown place '${ep.place}'`);
  if (p.kind === "planet") return { kind: "planet", anchor: p.id, label: p.name, chain: [{ around: p.id, mu: p.mu, r: p.radius_km + p.park_alt_km }] };
  if (p.kind === "small") return { kind: "small", anchor: p.id, label: p.name,
    chain: p.mu ? [{ around: p.id, mu: p.mu, r: p.radius_km + p.park_alt_km }] : [] };
  if (p.kind === "moon") return { kind: "moon", anchor: p.parent, label: p.name, moon: p.id,
    chain: [{ around: p.id, mu: p.mu, r: p.radius_km + p.park_alt_km }, { around: p.parent, mu: PLANET_MU[p.parent], r: p.orbit_km }] };
  // station
  const par = P[p.parent];
  const inner = { around: par.id, mu: par.mu, r: par.radius_km + p.park_alt_km, station: p.id };
  if (par.kind === "moon") return { kind: "station", anchor: par.parent, label: p.name, moon: par.id,
    chain: [inner, { around: par.parent, mu: PLANET_MU[par.parent], r: par.orbit_km }] };
  return { kind: "station", anchor: par.id, label: p.name, chain: [inner] };
}
// burn (km/s) to leave the endpoint's orbit with heliocentric excess speed vinf (or, reversed, be captured)
// planet / station: sqrt(vinf^2 + 2mu/rp) - sqrt(mu/rp)              (refly.dv_dep for Earth at 200 km)
// moon / moon station: trip.py titan_burn generalised: escape the parent's well at the moon's orbit radius
//   (burn along the moon's motion), then the moon's own well from the parking orbit.
export function wellBurn(chain, vinf) {
  if (!chain.length) return vinf;
  if (chain.length === 1) {
    const { mu, r } = chain[0];
    return Math.sqrt(vinf * vinf + 2 * mu / r) - Math.sqrt(mu / r);
  }
  const [inner, outer] = chain;
  const vneed = Math.sqrt(vinf * vinf + 2 * outer.mu / outer.r);
  const vinfM = vneed - Math.sqrt(outer.mu / outer.r);
  return Math.sqrt(vinfM * vinfM + 2 * inner.mu / inner.r) - Math.sqrt(inner.mu / inner.r);
}
export const titanBurn = (vinf) => wellBurn(endpointModel({ place: "titan" }).chain, vinf);

// ------------------------------------------------------------------ models.py (stated, made-up-on-purpose)
export const MODELS = { CAR_DRY_KG: 1300.0, PACK_KWH: 200.0, EXHAUST_KMS: 30.0, THRUSTER_EFF: 0.60,
  USD_PER_KWH: 0.16, USD_PER_MIN: 0.35 };
export const ASSUMPTIONS = ["ship 1300 kg dry with a 200 kWh pack",
  "electric thruster: 30 km/s exhaust, 60% efficient, burns treated as instant",
  "fare = $0.16/kWh energy + $0.35/min time fee", "landing, aerobraking and life support are not priced"];
function pyRound(x, nd = 0) {  // Python round(): half to even, on the decimal repr like CPython's
  if (!isFinite(x)) return x;
  const m = 10 ** nd, y = x * m, f = Math.floor(y), d = y - f;
  let r;
  if (Math.abs(d - 0.5) < 1e-9 * Math.max(1, Math.abs(y))) r = (f % 2 === 0) ? f : f + 1;
  else r = Math.round(y);
  return r / m;
}
export function battery(dv_kms) {
  const { CAR_DRY_KG, EXHAUST_KMS, THRUSTER_EFF, PACK_KWH } = MODELS;
  const m_prop = CAR_DRY_KG * (Math.exp(dv_kms / EXHAUST_KMS) - 1);
  const kwh = 0.5 * m_prop * (EXHAUST_KMS * 1000) ** 2 / THRUSTER_EFF / 3.6e6;
  return { dv_kms: pyRound(dv_kms, 3), propellant_kg: pyRound(m_prop, 1), energy_kwh: pyRound(kwh),
           battery_pct: pyRound(100 * kwh / PACK_KWH), packs: pyRound(kwh / PACK_KWH, 2), energy_kwh_exact: kwh };
}
export function fare(kwh, days) {
  const { USD_PER_KWH, USD_PER_MIN } = MODELS;
  const usd = kwh * USD_PER_KWH + days * 1440 * USD_PER_MIN;
  return { energy_usd: pyRound(kwh * USD_PER_KWH, 2), time_usd: pyRound(days * 1440 * USD_PER_MIN, 2), total_usd: pyRound(usd, 2) };
}

// ------------------------------------------------------------------ dates
export function jdFromIso(s) {
  const [date, tm = ""] = s.split("T");
  let [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = tm ? tm.split(":").map(Number) : [0, 0];
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.trunc(365.25 * (y + 4716)) + Math.trunc(30.6001 * (m + 1)) + d + B - 1524.5 + (hh + mm / 60) / 24;
}
export function isoFromJd(jd, withTime = false) {
  let ms = Date.UTC(2000, 0, 1, 12) + (jd - J2000) * 86400000;
  if (withTime) { ms = Math.floor((ms + 30000) / 60000) * 60000; return new Date(ms).toISOString().slice(0, 16).replace("T", " "); }
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ planner
const BRANCHES = [[0, true], [1, true], [1, false]];
// A multi-rev leg within 2% of the Lambert minimum time sits on the fold, where the n-body
// re-fly's Newton step diverges (velocity goes as 1/sqrt(T - Tmin)). Ceres legs re-fly clean from
// 0.5%; Titan-Earth M=1 legs still fail 21% of probes at 2% and 27% at 1%, so the margin stays.
const FOLD_MARGIN = 0.02;
const hohmannDays = (a1, a2, mu = MU_SUN) => Math.PI * Math.sqrt(((a1 + a2) / 2) ** 3 / mu) / DAY;

// anchor state for the planner and the re-fly (ships: Kepler)
function anchorState(m, ep, jd) {
  if (ep.ship) { checkJd(jd); return kepler(MU_SUN, ep.ship.r, ep.ship.v, (jd - ep.ship.jd) * DAY); }
  return state(m.anchor, jd);
}

function localTransfer(o, d, mo, md, opt) {
  // both endpoints orbit the same primary somewhere in their chains -> Hohmann around it (phasing and plane
  // change not modelled).  Find the shared primary and each side's radius about it plus any outer-well burn.
  const side = (m) => m.chain.map((c, i) => ({ ...c, level: i }));
  let best = null;
  for (const a of side(mo)) for (const b of side(md)) if (a.around === b.around && !best) best = [a, b];
  if (!best) return null;
  const [a, b] = best, mu = a.mu, prim = a.around;
  if (prim !== "earth" && prim !== "moon" && !opt.allLocal)
    return { error: `local transfer around ${P[prim].name} is not supported (only the Earth-Moon system is)` };
  const r1 = a.r, r2 = b.r;
  const at = (r1 + r2) / 2, tof = Math.PI * Math.sqrt(at ** 3 / mu);
  const vt1 = Math.sqrt(mu * (2 / r1 - 1 / at)), vt2 = Math.sqrt(mu * (2 / r2 - 1 / at));
  const vc1 = Math.sqrt(mu / r1), vc2 = Math.sqrt(mu / r2);
  // at a moon's orbit radius the excess speed relative to the moon goes through the moon's own well
  const burnAt = (side, chain, vt, vc) => side.level === 0 ? Math.abs(vt - vc) : wellBurn([chain[0]], Math.abs(vt - vc));
  const dv_dep = burnAt(a, mo.chain, vt1, vc1), dv_arr = burnAt(b, md.chain, vt2, vc2);
  const dep_jd = opt.depFrom, arr_jd = dep_jd + tof / DAY;
  if (arr_jd > opt.arriveBy) return { error: `local transfer would arrive ${isoFromJd(arr_jd)}, after the limit ${isoFromJd(opt.arriveBy)}` };
  // draw: ellipse in the plane of the destination (Moon: its orbit plane), apse line through the Moon at arrival
  const prS = (jd) => state(prim, jd);
  let ref = null, plane = null;
  const moonEnd = [a, b].find((s) => s.level === 1) ? (mo.moon || md.moon) : null;
  if (moonEnd && prim === "earth") {
    const e = state("earth", arr_jd), m = state("moon", arr_jd);
    const rr = sub(m.r, e.r), vv = sub(m.v, e.v);
    ref = unit(rr); plane = unit(cross(rr, vv));
    if (a.level === 1) ref = scl(ref, -1);   // leaving the Moon: the arc starts there (apoapsis at departure)
  } else {
    const [Pv, Qv] = planeBasis(prim, 0);
    ref = Pv; plane = unit(cross(Pv, Qv));
  }
  const rp = Math.min(r1, r2), ra = Math.max(r1, r2), e = (ra - rp) / (ra + rp), pp = rp * (1 + e);
  const fromPeri = r1 <= r2;  // outbound: periapsis at departure
  const apseDir = fromPeri ? scl(ref, -1) : ref;  // ref points to the arrival point when going out
  const pts = [];
  const N = 48;
  const ecc2nu = (M) => { let E = M; for (let i = 0; i < 30; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)); };
  const qd = cross(plane, apseDir);
  for (let i = 0; i <= N; i++) {
    const f = i / N, jd = dep_jd + f * (arr_jd - dep_jd);
    const M = fromPeri ? Math.PI * f : Math.PI + Math.PI * f;
    const nu = ecc2nu(M), rr = pp / (1 + e * Math.cos(nu));
    const loc = add(scl(apseDir, rr * Math.cos(nu)), scl(qd, rr * Math.sin(nu)));
    pts.push(scl(add(prS(jd).r, loc), 1 / AU_KM));
  }
  return { local: true, primary: prim, r1_km: r1, r2_km: r2, dep_jd, arr_jd, tof_days: tof / DAY, dv_dep_kms: dv_dep, dv_arr_kms: dv_arr, arc_au: pts,
           method: `local Hohmann transfer around ${P[prim].name} (${fmt(r1)} km -> ${fmt(r2)} km radius); phasing wait and plane change not modelled; not re-flown: local transfer` };
}

// one evaluation of the Sun-centred leg
function legEval(ctx, d0, tof, M, low) {
  const sa = ctx.depState(d0), sb = ctx.arrState(d0 + tof);
  const L = lambertSafe(sa.r, sb.r, tof * DAY, MU_SUN, M, low);
  if (!L || (L.fold != null && L.fold < FOLD_MARGIN)) return null;
  if (ctx.skip180 && Math.abs(L.angle_deg - 180) < 1) return null;
  const vd = norm(sub(L.v1, sa.v)), va = norm(sub(L.v2, sb.v));
  if (vd * vd > ctx.maxC3) return null;
  const dvd = wellBurn(ctx.mo.chain, vd), dva = ctx.capture ? wellBurn(ctx.md.chain, va) : 0;
  return { d0, tof, M, low, vd, va, dvd, dva, dv: dvd + dva, L, r1: sa.r, v1: L.v1 };
}
function legCost(ctx, e) {
  if (!e) return Infinity;
  if (ctx.objective === "time" || ctx.objective === "tof") {
    const k = ctx.objective === "time" ? e.d0 + e.tof : e.tof;
    if (e.dv > ctx.maxBurn) return ctx.penal ? k + 1e3 * (e.dv - ctx.maxBurn) : Infinity;
    return k;
  }
  if (e.dv > ctx.maxBurn) return ctx.penal ? e.dv + ctx.delay * (e.d0 + e.tof - ctx.req) / 365.25 + 1e3 * (e.dv - ctx.maxBurn) : Infinity;
  return e.dv + ctx.delay * (e.d0 + e.tof - ctx.req) / 365.25;
}
const arange = (a, b, s) => { const n = Math.max(0, Math.ceil((b - a) / s)); return Array.from({ length: n }, (_, i) => a + i * s); };

// planRide(origin, dest, opts) -> best option (plain JSON) or {error}
// opts: depFrom (JD, required: the sky clock), depTo (default depFrom + 120), arriveBy (default ephemeris end),
//   objective "energy" (min burn + delayPenalty km/s per year from depFrom to arrival, as trip.py, default 0.1)
//   | "time" (earliest arrival with total burn <= maxBurnKms, default 15 as trip.py) | "tof" (shortest flight, as
//   quote.py --objective tof), maxC3 (departure v_inf^2 cap, as quote.py --max-c3),
//   maxTofDays / minTofDays (default from the Hohmann time), arrive: "capture" (default) | "none" (no arrival
//   burn priced: flyby, aerobrake or entry), revs (max revolutions, 0|1, default 1), skip180 (default true,
//   quote.py's |angle-180| < 1 deg filter), grid: {depStep, tofMin, tofMax, tofStep, inclusive} = exhaustive
//   grid like quote.py/trip.py with no refinement (for cross-checks), requestJd (fare clock, default depFrom).
export function planRide(origin, dest, opts = {}) {
  try { return planRideInner(origin, dest, opts); } catch (e) { return { error: String(e && e.message || e) }; }
}
function planRideInner(origin, dest, opts) {
  need();
  const t0 = nowMs();
  const o = normEndpoint(origin), d = normEndpoint(dest);
  const mo = endpointModel(o), md = endpointModel(d);
  if (o.place && d.place && o.place === d.place) return { error: "origin and destination are the same place" };
  const depFrom = opts.depFrom ?? (o.ship ? o.ship.jd : null);
  if (depFrom == null || !isFinite(depFrom)) return { error: "depFrom (JD) is required" };
  const depTo = opts.depTo ?? depFrom + 120;
  const arriveBy = Math.min(opts.arriveBy ?? EPH.jd1, EPH.jd1);
  if (depFrom < EPH.jd0) return { error: `depFrom ${isoFromJd(depFrom)} is before the ephemeris start ${isoFromJd(EPH.jd0)}` };
  if (depFrom >= arriveBy) return { error: `departure window starts ${isoFromJd(depFrom)}, at or after the arrival limit ${isoFromJd(arriveBy)} (ephemeris ends ${isoFromJd(EPH.jd1)})` };
  if (!(depTo >= depFrom)) return { error: "depTo is before depFrom" };
  const objective = opts.objective || "energy";
  const capture = (opts.arrive || "capture") === "capture";
  const req = opts.requestJd ?? depFrom;
  const notPriced = [...ASSUMPTIONS.slice(3), "launch from the surface to the parking orbit is not priced",
    "burns are impulsive and in the best direction"];
  for (const ep of [o, d]) {
    const p = ep.place && P[ep.place];
    if (p && p.kind === "station" && p.incl_deg) notPriced.push(`plane matching to ${p.name}'s ${p.incl_deg}° orbit is not priced`);
  }

  // ---- local transfers (same primary)
  if (!o.ship && !d.ship) {
    // same primary (e.g. ISS -> Orbital Depot, Moon -> Earth, Io -> Europa): local Hohmann, not re-flown.
    // allLocal: false restricts this to the Earth-Moon system.
    const lt = localTransfer(o, d, mo, md, { depFrom, arriveBy, allLocal: opts.allLocal ?? true });
    if (lt) {
      if (lt.error) return lt;
      notPriced.push("phasing (waiting for the target to line up) is not modelled: departs at the window start");
      return finish(lt, { o, d, mo, md, req, notPriced, objective, t0, capture, origin, dest });
    }
  }
  if (!mo.anchor && !md.anchor && d.ship) { /* ship to ship is fine */ }

  // ---- Sun-centred leg with patched-conic ends
  const depState = (jd) => anchorState(mo, o, jd), arrState = (jd) => anchorState(md, d, jd);
  const a1 = norm(depState(depFrom).r), a2 = norm(arrState(depFrom).r);
  const tH = hohmannDays(a1, a2);
  const g = opts.grid;
  const tmin = g ? g.tofMin : (opts.minTofDays ?? Math.max(5, 0.08 * tH));
  let tmax = g ? g.tofMax : (opts.maxTofDays ?? Math.min(2.5 * tH + 200, 40000));
  const ctx = { mo, md, depState, arrState, skip180: opts.skip180 ?? true, capture, objective, req,
    delay: opts.delayPenalty ?? 0.1, maxBurn: opts.maxBurnKms ?? (objective === "energy" ? Infinity : 15), penal: false,
    maxC3: opts.maxC3 ?? Infinity };
  const revs = opts.revs ?? 1;
  const branches = BRANCHES.filter(([M]) => M <= revs);
  let evals = 0;
  const feasibleArr = (d0, tof) => d0 + tof <= arriveBy + 1e-9;
  const ev = (d0, tof, M, low) => { evals++; return feasibleArr(d0, tof) ? legEval(ctx, d0, tof, M, low) : null; };

  let best = null;
  const cands = [];
  if (g) {
    // exhaustive grid exactly like the Python scans (np.arange semantics)
    const deps = arange(depFrom, depTo + (g.inclusive ? 0.01 : 0), g.depStep);
    const tofs = arange(tmin, tmax + (g.inclusive ? 0.1 : 0), g.tofStep);
    for (const d0 of deps) for (const tof of tofs) for (const [M, low] of branches) {
      const e = ev(d0, tof, M, low), k = legCost(ctx, e);
      if (k < Infinity && (!best || k < best.k)) best = { k, e };
    }
  } else {
    // coarse grid, then pattern-search refinement of the best local minima of every branch
    const W = depTo - depFrom;
    tmax = Math.min(tmax, arriveBy - depFrom);
    if (tmax <= tmin) return { error: `no time to arrive before ${isoFromJd(arriveBy)} (ephemeris ends ${isoFromJd(EPH.jd1)})` };
    const nd = W <= 0 ? 1 : Math.max(24, Math.min(120, Math.ceil(W / 2.5)));
    const nt = Math.max(60, Math.min(160, Math.ceil((tmax - tmin) / 6)));
    const dd = nd > 1 ? W / (nd - 1) : 0, dt = (tmax - tmin) / (nt - 1);
    const grids = branches.map(() => new Float64Array(nd * nt).fill(Infinity));
    for (let i = 0; i < nd; i++) {
      const d0 = depFrom + i * dd;
      for (let j = 0; j < nt; j++) {
        const tof = tmin + j * dt;
        branches.forEach(([M, low], b) => { grids[b][i * nt + j] = legCost(ctx, ev(d0, tof, M, low)); });
      }
    }
    for (let b = 0; b < branches.length; b++) {
      const G = grids[b];
      for (let i = 0; i < nd; i++) for (let j = 0; j < nt; j++) {
        const k = G[i * nt + j];
        if (!(k < Infinity)) continue;
        let isMin = true;
        for (let di = -1; di <= 1 && isMin; di++) for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nd || jj >= nt) continue;
          if (G[ii * nt + jj] < k) { isMin = false; break; }
        }
        if (isMin) cands.push({ k, b, d0: depFrom + i * dd, tof: tmin + j * dt });
      }
    }
    cands.sort((x, y) => x.k - y.k);
    ctx.penal = true;
    const refined = [];
    for (const c of cands.slice(0, opts.refineCount ?? 10)) {
      const [M, low] = branches[c.b];
      let x = c.d0, y = c.tof, fx = legCost(ctx, ev(x, y, M, low));
      let sx = Math.max(dd, 0.5), sy = dt;
      const inb = (a, t) => a >= depFrom - 1e-9 && a <= depTo + 1e-9 && t >= tmin && t <= tmax && feasibleArr(a, t);
      for (let it = 0; it < 400 && (sx > 1e-3 || sy > 1e-3); it++) {
        let moved = false;
        for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = W <= 0 ? x : x + ux * sx, ny = y + uy * sy;
          if (!inb(nx, ny)) continue;
          const f = legCost(ctx, ev(nx, ny, M, low));
          if (f < fx) { x = nx; y = ny; fx = f; moved = true; break; }
        }
        if (!moved) { sx /= 2; sy /= 2; }
      }
      ctx.penal = false;
      const e = ev(x, y, M, low), k = legCost(ctx, e);
      ctx.penal = true;
      if (k < Infinity) refined.push({ k, e });
      else { const e0 = ev(c.d0, c.tof, M, low), k0 = legCost({ ...ctx, penal: false }, e0); if (k0 < Infinity) refined.push({ k: k0, e: e0 }); }
    }
    ctx.penal = false;
    refined.sort((x, y) => x.k - y.k);
    best = refined[0] || null;
    // distinct alternatives (different branch or > 5 days apart in departure)
    const alts = [];
    for (const r of refined.slice(1)) {
      if (alts.length >= 3) break;
      if ([best, ...alts].every((q) => q.e.M !== r.e.M || q.e.low !== r.e.low || Math.abs(q.e.d0 - r.e.d0) > 5)) alts.push(r);
    }
    best && (best.alts = alts);
  }
  if (!best) {
    const why = objective === "time" && isFinite(ctx.maxBurn) ? ` with a total burn <= ${ctx.maxBurn} km/s` : "";
    return { error: `no ride found${why}: departures ${isoFromJd(depFrom)}..${isoFromJd(depTo)}, arriving by ${isoFromJd(arriveBy)}${arriveBy >= EPH.jd1 - 1e-9 ? " (ephemeris end)" : ""}, TOF ${tmin.toFixed(0)}-${tmax.toFixed(0)} d` };
  }
  const e = best.e;
  const N = 48, tofS = e.tof * DAY, pts = [];
  for (let i = 0; i <= N; i++) { const s = i === 0 ? { r: e.r1 } : kepler(MU_SUN, e.r1, e.v1, tofS * i / N); pts.push(scl(s.r, 1 / AU_KM)); }
  if (!capture) notPriced.push("no arrival burn priced: arrives at the destination's centre (flyby, aerobraking or entry)");
  if (md.kind === "planet" && P[md.anchor].atmosphere && !capture)
    notPriced.push(`entry speed at ${P[md.anchor].name} ${Math.sqrt(e.va ** 2 + 2 * P[md.anchor].mu / (P[md.anchor].radius_km + 120)).toFixed(2)} km/s (not a burn)`);
  const opt = { local: false, delay_penalty_kms_per_year: ctx.delay, dep_jd: e.d0, arr_jd: e.d0 + e.tof, tof_days: e.tof, revs: e.M, lowpath: e.low,
    vinf_dep_kms: e.vd, vinf_arr_kms: e.va, c3_dep_km2s2: e.vd * e.vd, dv_dep_kms: e.dvd, dv_arr_kms: e.dva,
    transfer_angle_deg: e.L.angle_deg, arc_au: pts, cost: best.k, lambert_evals: evals,
    method: `Sun-centred Lambert (Izzo, ${e.M} rev${e.M ? (e.low ? ", low branch" : ", high branch") : ""}) between ${mo.label}${mo.anchor && mo.anchor !== o.place ? ` (via ${P[mo.anchor].name})` : ""} and ${md.label}${md.anchor && md.anchor !== d.place ? ` (via ${P[md.anchor].name})` : ""}; patched-conic burns; DE421 table` };
  if (best.alts) opt.alternatives = best.alts.map(({ k, e: a }) => ({ dep_jd: a.d0, arr_jd: a.d0 + a.tof, tof_days: a.tof, revs: a.M, lowpath: a.low,
    dv_dep_kms: a.dvd, dv_arr_kms: a.dva, dv_total_kms: a.dv, cost: k }));
  return finish(opt, { o, d, mo, md, req, notPriced, objective, t0, capture, origin, dest });
}
function finish(opt, { o, d, req, notPriced, objective, t0, capture }) {
  opt.dv_total_kms = opt.dv_dep_kms + opt.dv_arr_kms;
  opt.battery = battery(opt.dv_total_kms);
  opt.battery.packs = pyRound(opt.battery.energy_kwh_exact / MODELS.PACK_KWH, 2);
  const days = opt.arr_jd - req;
  opt.fare = fare(opt.battery.energy_kwh, days);
  opt.door_to_door_days = days;
  opt.wait_days = opt.dep_jd - req;
  opt.depart = isoFromJd(opt.dep_jd, true);
  opt.arrive = isoFromJd(opt.arr_jd, true);
  opt.origin = o.ship ? { ship: o.ship } : { place: o.place };
  opt.dest = d.ship ? { ship: d.ship } : { place: d.place };
  opt.objective = objective;
  opt.arrive_mode = capture ? "capture" : "none";
  opt.not_priced = notPriced;
  opt.assumptions = [...ASSUMPTIONS.slice(0, 3),
    "patched conics: Sun-centred leg between the centres of the endpoints' Sun-orbiting bodies (a moon or station uses its planet)",
    "burns from/into circular parking orbits (PLACES park_alt_km); moon endpoints escape/capture through the parent's well at the moon's orbit radius, burning along the moon's motion (trip.py titan_burn, generalised)",
    "moon and station orbits are circular with approximate radii/periods and arbitrary phase",
    ...(objective === "energy" && !opt.local ? [`energy objective trades ${opt.delay_penalty_kms_per_year ?? 0.1} km/s of burn per year from the window start to arrival (trip.py)`] : []),
    "fare time = window start (request) to arrival"];
  opt.search_ms = nowMs() - t0;
  return opt;
}
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ------------------------------------------------------------------ n-body re-fly (nbody.py + refly.py)
// perturbers exactly as nbody.PERTURBERS: Mercury(1), Venus(2), Earth(399), Moon(301), Mars(4), Jupiter(5),
// Saturn(6), Uranus(7), Neptune(8) barycentres, GM from ephem.py
const PERT = [["mercury", 1], ["venus", 2], ["earth", 399], ["moon", 301], ["mars", 4], ["jupiter", 5],
  ["saturn", 6], ["uranus", 7], ["neptune", 8]];
const NAIF_OF = { mercury: 1, venus: 2, earth: 399, mars: 4, jupiter: 5, saturn: 6, uranus: 7, neptune: 8 };
export function makeModel(activeNaifs) {
  const act = PERT.filter(([, n]) => activeNaifs.includes(n));
  const names = act.map(([nm]) => nm), gms = act.map(([, n]) => GM[n]);
  const nb = names.length, pos = new Float64Array(nb * 3);
  const emb = new Float64Array(3), geo = new Float64Array(3);
  const needEM = names.includes("earth") || names.includes("moon");
  const k = EPH.k;
  let nfev = 0;
  function positions(t) {
    if (needEM) { chebEval("emb", t, emb, 0, null, 0); chebEval("moon_geo", t, geo, 0, null, 0); }
    for (let i = 0; i < nb; i++) {
      const nm = names[i];
      if (nm === "earth") for (let a = 0; a < 3; a++) pos[3 * i + a] = emb[a] - k * geo[a];
      else if (nm === "moon") for (let a = 0; a < 3; a++) pos[3 * i + a] = emb[a] + (1 - k) * geo[a];
      else chebEval(nm, t, pos, 3 * i, null, 0);
    }
  }
  function rhs(t, y, out) {
    nfev++;
    const x = y[0], yy = y[1], z = y[2];
    const rn = Math.sqrt(x * x + yy * yy + z * z), f = -MU_SUN / (rn * rn * rn);
    let ax = f * x, ay = f * yy, az = f * z;
    if (nb) {
      positions(t);
      for (let i = 0; i < nb; i++) {
        const px = pos[3 * i], py = pos[3 * i + 1], pz = pos[3 * i + 2];
        const dx = px - x, dy = py - yy, dz = pz - z;
        const dn = Math.sqrt(dx * dx + dy * dy + dz * dz), pn = Math.sqrt(px * px + py * py + pz * pz);
        const a1 = gms[i] / (dn * dn * dn), a2 = gms[i] / (pn * pn * pn);
        ax += a1 * dx - a2 * px; ay += a1 * dy - a2 * py; az += a1 * dz - a2 * pz;
      }
    }
    out[0] = y[3]; out[1] = y[4]; out[2] = y[5]; out[3] = ax; out[4] = ay; out[5] = az;
  }
  return { rhs, nfev: () => nfev, names };
}

// DOP853 coefficients: scipy.integrate._ivp.dop853_coefficients (Hairer's DOP853), printed with repr()
const DOP_C = [0.0,0.05260015195876773,0.0789002279381516,0.1183503419072274,0.2816496580927726,0.3333333333333333,0.25,0.3076923076923077,0.6512820512820513,0.6,0.8571428571428571,1.0];
const DOP_A = [[],
[0.05260015195876773],
[0.0197250569845379,0.0591751709536137],
[0.02958758547680685,0.0,0.08876275643042054],
[0.2413651341592667,0.0,-0.8845494793282861,0.924834003261792],
[0.037037037037037035,0.0,0.0,0.17082860872947386,0.12546768756682242],
[0.037109375,0.0,0.0,0.17025221101954405,0.06021653898045596,-0.017578125],
[0.03709200011850479,0.0,0.0,0.17038392571223998,0.10726203044637328,-0.015319437748624402,0.008273789163814023],
[0.6241109587160757,0.0,0.0,-3.3608926294469414,-0.868219346841726,27.59209969944671,20.154067550477894,-43.48988418106996],
[0.47766253643826434,0.0,0.0,-2.4881146199716677,-0.590290826836843,21.230051448181193,15.279233632882423,-33.28821096898486,-0.020331201708508627],
[-0.9371424300859873,0.0,0.0,5.186372428844064,1.0914373489967295,-8.149787010746927,-18.52006565999696,22.739487099350505,2.4936055526796523,-3.0467644718982196],
[2.273310147516538,0.0,0.0,-10.53449546673725,-2.0008720582248625,-17.9589318631188,27.94888452941996,-2.8589982771350235,-8.87285693353063,12.360567175794303,0.6433927460157636]];
const DOP_B = [0.054293734116568765,0.0,0.0,0.0,0.0,4.450312892752409,1.8915178993145003,-5.801203960010585,0.3111643669578199,-0.1521609496625161,0.20136540080403034,0.04471061572777259];
const DOP_E3 = [-0.18980075407240762,0.0,0.0,0.0,0.0,4.450312892752409,1.8915178993145003,-5.801203960010585,-0.4226823213237919,-0.1521609496625161,0.20136540080403034,0.02265179219836082,0.0];
const DOP_E5 = [0.01312004499419488,0.0,0.0,0.0,0.0,-1.2251564463762044,-0.4957589496572502,1.6643771824549864,-0.35032884874997366,0.3341791187130175,0.08192320648511571,-0.022355307863886294,0.0];
const _f64 = new Float64Array(1), _u64 = new BigUint64Array(_f64.buffer);
function nextafter(x, dir) {
  if (x === 0) return dir > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  _f64[0] = x;
  _u64[0] += ((x > 0) === (dir > 0)) ? 1n : -1n;
  return _f64[0];
}
// scipy solve_ivp(method="DOP853") port: same initial step, error norm and step-size control; returns y(t1)
export function dop853(rhs, t0, y0, t1, rtol, atol) {
  const n = y0.length, K = Array.from({ length: 13 }, () => new Float64Array(n));
  const y = Float64Array.from(y0), ynew = new Float64Array(n), tmp = new Float64Array(n), f = new Float64Array(n), f1 = new Float64Array(n);
  const direction = t1 !== t0 ? Math.sign(t1 - t0) : 1;
  const rms = (a) => { let s = 0; for (let i = 0; i < n; i++) s += a[i] * a[i]; return Math.sqrt(s / n); };
  rhs(t0, y, f);
  // select_initial_step (order = error_estimator_order = 7)
  let hAbs;
  {
    const interval = Math.abs(t1 - t0);
    if (interval === 0) return { y: Array.from(y), t: t0, nsteps: 0 };
    const sc = new Float64Array(n), a = new Float64Array(n), b = new Float64Array(n);
    for (let i = 0; i < n; i++) { sc[i] = atol[i] + Math.abs(y[i]) * rtol; a[i] = y[i] / sc[i]; b[i] = f[i] / sc[i]; }
    const d0 = rms(a), d1 = rms(b);
    let h0 = (d0 < 1e-5 || d1 < 1e-5) ? 1e-6 : 0.01 * d0 / d1;
    h0 = Math.min(h0, interval);
    for (let i = 0; i < n; i++) tmp[i] = y[i] + h0 * direction * f[i];
    rhs(t0 + h0 * direction, tmp, f1);
    for (let i = 0; i < n; i++) a[i] = (f1[i] - f[i]) / sc[i];
    const d2 = rms(a) / h0;
    const h1 = (d1 <= 1e-15 && d2 <= 1e-15) ? Math.max(1e-6, h0 * 1e-3) : (0.01 / Math.max(d1, d2)) ** (1 / 8);
    hAbs = Math.min(100 * h0, h1, interval);
  }
  const SAFETY = 0.9, MIN_FACTOR = 0.2, MAX_FACTOR = 10, EXP = -1 / 8;
  let t = t0, nsteps = 0, nrej = 0;
  while (direction * (t - t1) < 0) {
    const minStep = 10 * Math.abs(nextafter(t, direction) - t);
    let h_abs = hAbs < minStep ? minStep : hAbs;
    let accepted = false, rejected = false, tnew = t;
    while (!accepted) {
      if (h_abs < minStep) throw new Error("DOP853: step size too small");
      let h = h_abs * direction;
      tnew = t + h;
      if (direction * (tnew - t1) > 0) tnew = t1;
      h = tnew - t; h_abs = Math.abs(h);
      // rk_step
      K[0].set(f);
      for (let s = 1; s < 12; s++) {
        const a = DOP_A[s];
        for (let i = 0; i < n; i++) { let acc = 0; for (let j = 0; j < s; j++) acc += K[j][i] * a[j]; tmp[i] = y[i] + acc * h; }
        rhs(t + DOP_C[s] * h, tmp, K[s]);
      }
      for (let i = 0; i < n; i++) { let acc = 0; for (let j = 0; j < 12; j++) acc += K[j][i] * DOP_B[j]; ynew[i] = y[i] + h * acc; }
      rhs(t + h, ynew, K[12]);
      // error norm (DOP853._estimate_error_norm)
      let e5 = 0, e3 = 0;
      for (let i = 0; i < n; i++) {
        const sc = atol[i] + Math.max(Math.abs(y[i]), Math.abs(ynew[i])) * rtol;
        let s5 = 0, s3 = 0;
        for (let j = 0; j < 13; j++) { s5 += K[j][i] * DOP_E5[j]; s3 += K[j][i] * DOP_E3[j]; }
        s5 /= sc; s3 /= sc; e5 += s5 * s5; e3 += s3 * s3;
      }
      let err;
      if (e5 === 0 && e3 === 0) err = 0;
      else err = h_abs * e5 / Math.sqrt((e5 + 0.01 * e3) * n);
      if (err < 1) {
        let factor = err === 0 ? MAX_FACTOR : Math.min(MAX_FACTOR, SAFETY * err ** EXP);
        if (rejected) factor = Math.min(1, factor);
        h_abs *= factor; accepted = true;
      } else { h_abs *= Math.max(MIN_FACTOR, SAFETY * err ** EXP); rejected = true; nrej++; }
    }
    t = tnew; y.set(ynew); f.set(K[12]); hAbs = h_abs; nsteps++;
  }
  return { y: Array.from(y), t, nsteps, nrej };
}
const ATOL = [1e-6, 1e-6, 1e-6, 1e-12, 1e-12, 1e-12];

// nbody.hyperbola_start: perigee state of a geocentric departure hyperbola with outgoing asymptote vinf
export function hyperbolaStart(rE, vE, vinfVec, mu = GM[399], rp = 6378.137 + 200.0) {
  const vinf = norm(vinfVec), s = scl(vinfVec, 1 / vinf), sEq = ecl2eq(s);
  const z = [0, 0, 1], nEq0 = sub(z, scl(sEq, dot(z, sEq)));
  const n = eq2ecl(scl(nEq0, 1 / norm(nEq0)));
  const e = 1 + rp * vinf * vinf / mu, nuInf = Math.acos(-1 / e);
  const pHat = sub(scl(s, Math.cos(nuInf)), scl(cross(n, s), Math.sin(nuInf)));
  const wHat = cross(n, pHat), vp = Math.sqrt(vinf * vinf + 2 * mu / rp);
  return [...add(rE, scl(pHat, rp)), ...add(vE, scl(wHat, vp))];
}
function solve3(J, b) {  // Gaussian elimination with partial pivoting (numpy.linalg.solve uses LU too)
  const A = J.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < 3; r++) { const m = A[r][c] / A[c][c]; for (let k = c; k < 4; k++) A[r][k] -= m * A[c][k]; }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) { let s = A[r][3]; for (let k = r + 1; k < 3; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
// nbody.newton: damped Newton with a fresh central-difference Jacobian each iteration
function newton(fun, x0, h = 1e-4, tolKm = 1.0, maxIter = 20) {
  let x = [...x0], d = fun(x);
  const hist = [norm(d)];
  for (let it = 0; it < maxIter; it++) {
    if (hist[hist.length - 1] < tolKm) break;
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < 3; k++) {
      const xp = [...x], xm = [...x]; xp[k] += h; xm[k] -= h;
      const fp = fun(xp), fm = fun(xm);
      for (let r = 0; r < 3; r++) J[r][k] = (fp[r] - fm[r]) / (2 * h);
    }
    const step = solve3(J, d).map((v) => -v);
    let alpha = 1, xn, dn;
    for (;;) {
      xn = x.map((v, i) => v + alpha * step[i]); dn = fun(xn);
      if (norm(dn) < norm(d) || alpha < 1 / 256) break;
      alpha *= 0.5;
    }
    x = xn; d = dn; hist.push(norm(d));
  }
  return { x, d, hist };
}

// refly(leg): leg = a planRide option (or {origin, dest, dep_jd, tof_days, revs, lowpath, mode}).
// mode "leo"   (refly.py refly): start on a departure hyperbola from a circular Earth orbit (200 km for Earth,
//              the station's altitude for Earth stations), Earth+Moon gravity on, destination's own gravity off.
// mode "centre" (refly.py refly_leg, trip.py): start at the origin's centre, both endpoint planets' gravity off.
// Default: "leo" when the origin is Earth or an Earth-orbit station, else "centre".  Moons and moon stations use
// their parent planet's centre (as trip.py does for Titan); small bodies use the baked n-body orbit; ships 2-body.
// PASS = final miss < 1 km AND retarget correction < 500 m/s (refly.py MAX_RETARGET_MS).
export function refly(leg, opts = {}) {
  try { return reflyInner(leg, opts); } catch (e) { return { error: String(e && e.message || e), pass: false }; }
}
function reflyInner(leg, opts) {
  need();
  if (leg.local) return { local: true, pass: null, note: "not re-flown: local transfer" };
  const t0w = nowMs();
  const o = normEndpoint(leg.origin), d = normEndpoint(leg.dest);
  const mo = endpointModel(o), md = endpointModel(d);
  const dep = leg.dep_jd, tof = leg.tof_days, arr = dep + tof;
  checkJd(dep); checkJd(arr);
  const M = leg.revs || 0, low = leg.lowpath ?? true;
  const earthOrbit = !o.ship && mo.anchor === "earth" && mo.chain.length === 1;
  const mode = opts.mode || leg.mode || (earthOrbit ? "leo" : "centre");
  const tdep = (dep - J2000) * DAY, ta = (arr - J2000) * DAY;
  // DOP853 rtol for the miss propagations.  refly.py uses 1e-10; the cross-check (CHECK.md) shows that on 17-23
  // year legs the integration error at 1e-10 is tens of km and Newton stalls above the 1 km bar on noise (the day-2
  // Uranus REJECT), while 1e-12 converges on every leg tested at the same retarget.  Default 1e-12; pass
  // {rtol: 1e-10} for bit-for-bit parity with refly.py.
  const rtol = opts.rtol ?? 1e-12;
  const target = anchorState(md, d, arr).r;
  const dstNaif = !d.ship && NAIF_OF[md.anchor];
  let fun, x0, start, active, h = 1e-4;
  if (mode === "leo") {
    if (mo.anchor !== "earth") throw new Error("leo mode needs an Earth-orbit origin");
    const E = state("earth", dep);
    const L = lambert(E.r, target, tof * DAY, MU_SUN, M, low);
    x0 = sub(L.v1, E.v);
    const rp = mo.chain[0].r;
    active = PERT.map(([, n]) => n).filter((n) => n !== dstNaif);
    const model = makeModel(active);
    fun = (vinf) => { const ys = hyperbolaStart(E.r, E.v, vinf, GM[399], rp); const r = dop853(model.rhs, tdep, ys, ta, rtol, ATOL); return sub(r.y.slice(0, 3), target); };
    start = { r: E.r, v: E.v };
  } else {
    start = anchorState(mo, o, dep);
    const L = lambert(start.r, target, tof * DAY, MU_SUN, M, low);
    x0 = L.v1;
    const off = [!o.ship && NAIF_OF[mo.anchor], dstNaif].filter(Boolean);
    active = PERT.map(([, n]) => n).filter((n) => !off.includes(n));
    const model = makeModel(active);
    fun = (v) => { const r = dop853(model.rhs, tdep, [...start.r, ...v], ta, rtol, ATOL); return sub(r.y.slice(0, 3), target); };
  }
  let nprop = 0;
  const f = (x) => { nprop++; return fun(x); };
  const m0 = f(x0);
  const { x, d: dfin, hist } = newton(f, x0, h, 1.0, opts.maxIter ?? 20);
  const fin = norm(dfin), ret = norm(sub(x, x0)) * 1000;
  const out = { pass: fin < 1.0 && ret < 500, raw_miss_km: norm(m0), final_miss_km: fin, retarget_ms: ret,
    iterations: hist.length - 1, miss_history_km: hist, mode, rtol, propagations: nprop, seconds: (nowMs() - t0w) / 1000,
    perturbers: PERT.filter(([, n]) => active.includes(n)).map(([nm]) => nm),
    model: mode === "leo" ? `n-body Sun+8 planets+Moon (DE421 table), DOP853 rtol ${rtol}, from a circular Earth orbit, aimed at target centre (its gravity off)`
      : `n-body Sun+8 planets+Moon (DE421 table), DOP853 rtol ${rtol}; planet endpoints patched-conic (own gravity off)` };
  if (mode === "leo") { const c3 = dot(x, x); out.c3_corrected_km2s2 = c3; out.dv_dep_corrected_kms = Math.sqrt(c3 + 2 * GM[399] / mo.chain[0].r) - Math.sqrt(GM[399] / mo.chain[0].r); }
  else if (!o.ship) out.vinf_dep_corrected_kms = norm(sub(x, start.v));
  return out;
}
