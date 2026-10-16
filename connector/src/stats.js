// Bench statistics over starfare.results/1 files. No Node-only imports, so the CLI (bench/stats.mjs) and a hosted board share it.
// The unit is the task: a task's repeats are averaged first and resampled together (a cluster bootstrap), so an agent that
// played one task many times does not count as having played many tasks.

export const RESULTS_FORMAT = "starfare.results/1";
export const DRAWS = 2000;
export const SEED = 1;

/** mulberry32: a seeded uniform [0, 1) source, so every interval is reproducible. */
export function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** task_id -> that task's rows, in task_id order. */
export function byTask(rows) {
  const m = new Map();
  for (const r of [...rows].sort((a, b) => (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0))) {
    if (!m.has(r.task_id)) m.set(r.task_id, []);
    m.get(r.task_id).push(r);
  }
  return m;
}

const taskMeans = (rows) => new Map([...byTask(rows)].map(([id, rs]) => [id, mean(rs.map((r) => r.score.total))]));

function quantile(sorted, q) {
  const i = q * (sorted.length - 1), lo = Math.floor(i), hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** The mean of xs and the percentile 95% interval of that mean over draws resamples of xs, with replacement. */
function bootstrap(xs, { draws = DRAWS, seed = SEED } = {}) {
  if (!xs.length) return { mean: null, lo: null, hi: null };
  const rand = rngOf(seed), n = xs.length, means = new Float64Array(draws);
  for (let d = 0; d < draws; d++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[Math.floor(rand() * n)];
    means[d] = s / n;
  }
  means.sort();
  return { mean: mean(xs), lo: quantile(means, 0.025), hi: quantile(means, 0.975) };
}

/** The mean over per-task means, with a cluster bootstrap 95% interval (tasks resampled, repeats kept together). */
export function meanInterval(rows, opts) {
  const xs = [...taskMeans(rows).values()];
  return { tasks: xs.length, ...bootstrap(xs, opts) };
}

/** A minus B on the tasks both played: the mean per-task difference and its paired bootstrap 95% interval. */
export function pairedInterval(rowsA, rowsB, opts) {
  const a = taskMeans(rowsA), b = taskMeans(rowsB);
  const ds = [...a].filter(([id]) => b.has(id)).map(([id, m]) => m - b.get(id));
  const { mean: diff, lo, hi } = bootstrap(ds, opts);
  return { tasks: ds.length, diff, lo, hi };
}

/** n choose k as a float; 0 when k > n. */
function choose(n, k) {
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c;
}

/** tau-bench's unbiased pass^k: per task C(c, k) / C(n, k) with c of its n attempts succeeding, averaged over tasks.
 *  null when some task has fewer than k attempts. */
export function passK(rows, k, succeeded) {
  const tasks = [...byTask(rows).values()];
  if (!tasks.length || tasks.some((rs) => rs.length < k)) return null;
  return mean(tasks.map((rs) => choose(rs.filter(succeeded).length, k) / choose(rs.length, k)));
}

/** The pass^k success rule. A placeholder until Alvin picks one: the flight landed and scored at least naive's mean score on
 *  that task when naive rows are given, otherwise it landed. */
export function successRule(naiveRows) {
  const landed = (r) => r.score.phase === "arrived";
  if (!naiveRows) return { placeholder: true, text: "the flight landed", test: landed };
  const bar = taskMeans(naiveRows);
  return {
    placeholder: true,
    text: "the flight landed and scored at least naive's score on that task",
    test: (r) => {
      if (!bar.has(r.task_id)) throw new Error("the naive results have no row for task " + r.task_id);
      return landed(r) && r.score.total >= bar.get(r.task_id);
    },
  };
}

const RUN_KEYS = ["suite", "split", "engine_sha256", "score_version"];
const runOf = (f) => RUN_KEYS.map((k) => k + " " + f[k]).join(", ");

/** One table row per results file. Complete rows (every task, repeats attempts each) are ranked by mean, each with a paired
 *  interval against the next; the rest are listed apart with what they miss. tasks defaults to every task any file played. */
export function rankTable(files, { naive = null, tasks = null, draws = DRAWS, seed = SEED } = {}) {
  if (!files.length) throw new Error("no results files");
  for (const f of [...files, ...(naive ? [naive] : [])]) {
    if (!f || f.format !== RESULTS_FORMAT) throw new Error("not a " + RESULTS_FORMAT + " file");
    if (runOf(f) !== runOf(files[0])) throw new Error("results from different runs cannot share a table: " + runOf(files[0]) + " vs " + runOf(f));
  }
  const ids = tasks || [...byTask(files.flatMap((f) => f.rows)).keys()];
  const rule = successRule(naive && naive.rows);
  const opts = { draws, seed };
  const rows = files.map((f) => {
    const got = byTask(f.rows);
    const pass = [];
    for (let k = 1; k <= f.repeats; k++) pass.push(passK(f.rows, k, rule.test));
    return {
      agent: f.labels.agent, model: f.labels.model, repeats: f.repeats,
      tasks_played: got.size, tasks_total: ids.length,
      missing: ids.filter((id) => (got.get(id) || []).length < f.repeats),
      ...meanInterval(f.rows, opts), pass, rows: f.rows,
    };
  });
  const ranked = rows.filter((r) => !r.missing.length).sort((a, b) => b.mean - a.mean || (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0));
  const gaps = ranked.map((r, i) => (i + 1 < ranked.length ? pairedInterval(r.rows, ranked[i + 1].rows, opts) : null));
  const strip = ({ rows: _, ...r }) => r;
  return {
    suite: files[0].suite, split: files[0].split, engine_sha256: files[0].engine_sha256, score_version: files[0].score_version,
    draws, seed, rule: { placeholder: rule.placeholder, text: rule.text },
    k: Math.max(...files.map((f) => f.repeats)),
    ranked: ranked.map((r, i) => ({ ...strip(r), rank: i + 1, gap_to_next: gaps[i] })),
    unranked: rows.filter((r) => r.missing.length).map(strip),
  };
}
