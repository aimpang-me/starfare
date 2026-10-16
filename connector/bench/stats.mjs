#!/usr/bin/env node
// A ranked table from one or more results.json files written by bench/run.mjs.
//   node bench/stats.mjs runs/naive.json runs/mine.json
//   node bench/stats.mjs runs/*.json --md runs/table.md            (also writes a Markdown table)
//   node bench/stats.mjs runs/*.json --suite src/suites/v1.json   (the suite's task list decides who is complete)
// The pass^k success rule compares with naive: --naive <file>, or the input whose agent label is "naive".
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rankTable } from "../src/stats.js";
import { tasksOf } from "../src/suite.js";
import { readSuite } from "./backend.mjs";

const f1 = (x) => (x == null ? "-" : x.toFixed(1));
const f2 = (x) => (x == null ? "-" : x.toFixed(2));
const signed = (x) => (x > 0 ? "+" : "") + x.toFixed(1);

function cells(t) {
  const head = ["rank", "agent", "model", "tasks", "mean", "95% interval", ...Array.from({ length: t.k }, (_, i) => "pass^" + (i + 1)), "gap to next"];
  const line = (r, rank) => [
    rank, r.agent, r.model, r.tasks_played + "/" + r.tasks_total, f1(r.mean), r.mean == null ? "-" : "[" + f1(r.lo) + ", " + f1(r.hi) + "]",
    ...Array.from({ length: t.k }, (_, i) => f2(r.pass[i])),
    r.gap_to_next ? signed(r.gap_to_next.diff) + " [" + f1(r.gap_to_next.lo) + ", " + f1(r.gap_to_next.hi) + "]" : "-",
  ];
  return [head, ...t.ranked.map((r) => line(r, String(r.rank))), ...t.unranked.map((r) => line(r, "unranked"))];
}

function notes(t) {
  const out = [
    "Scores are simulated. Agent and model labels are self-reported.",
    "mean: the mean over tasks of each task's mean score. 95% interval: cluster bootstrap over tasks (repeats kept together), " + t.draws + " draws, seed " + t.seed + ".",
    "pass^k: the chance that k fresh attempts at a task all succeed (tau-bench's unbiased estimator), averaged over tasks.",
    "Success" + (t.rule.fallback ? " (fallback: no naive results given)" : "") + ": " + t.rule.text + ".",
    "gap to next: this row minus the next ranked row, paired bootstrap over the tasks both played. An interval that spans 0 does not separate them.",
  ];
  if (t.unranked.length) out.push("Unranked rows are missing tasks or attempts and are not ranked:");
  for (const r of t.unranked) {
    const shown = r.missing.slice(0, 5).join(", ") + (r.missing.length > 5 ? " (+" + (r.missing.length - 5) + " more)" : "");
    out.push("  " + r.agent + " / " + r.model + " lacks " + r.repeats + " attempt" + (r.repeats === 1 ? "" : "s") + " at " + r.missing.length + " of " + r.tasks_total + " tasks: " + shown);
  }
  return out;
}

const title = (t) => "Starfare bench, suite " + t.suite + ", " + t.split + " split, score version " + t.score_version + ", engine " + t.engine_sha256.slice(0, 12);

export function renderText(t) {
  const rows = cells(t), widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return [title(t), "", ...rows.map((r) => r.map((s, c) => s.padEnd(widths[c])).join("  ").trimEnd()), "", ...notes(t)].join("\n") + "\n";
}

export function renderMarkdown(t) {
  const [head, ...body] = cells(t), row = (r) => "| " + r.join(" | ") + " |";
  return ["## " + title(t), "", row(head), row(head.map(() => "---")), ...body.map(row), "", ...notes(t).map((n) => (n.startsWith("  ") ? "- " + n.trim() : n + "\n"))].join("\n").trimEnd() + "\n";
}

/** argv -> { files, md, naive, suite, split, draws, seed }. */
function parse(argv) {
  const o = { files: [] }, known = ["md", "naive", "suite", "split", "draws", "seed"];
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)$/.exec(argv[i]);
    if (!m) { o.files.push(argv[i]); continue; }
    if (!known.includes(m[1])) throw new Error("unknown argument " + argv[i] + "; known: " + known.map((k) => "--" + k).join(" "));
    if (argv[i + 1] == null || argv[i + 1].startsWith("--")) throw new Error("--" + m[1] + " needs a value");
    o[m[1]] = argv[++i];
  }
  return o;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export function main(argv) {
  const a = parse(argv);
  if (!a.files.length) throw new Error("usage: node bench/stats.mjs <results.json>... [--md <out.md>] [--naive <results.json>] [--suite <suite.json> --split dev] [--draws n --seed n]");
  const files = a.files.map(readJson);
  const naives = files.filter((f) => f.labels && f.labels.agent === "naive");
  if (!a.naive && naives.length > 1) throw new Error("more than one input is labelled naive; pick one with --naive <file>");
  const naive = a.naive ? readJson(a.naive) : naives[0] || null;
  const tasks = a.suite ? tasksOf(readSuite(a.suite), a.split || files[0].split).map((t) => t.id) : null;
  const t = rankTable(files, { naive, tasks, ...(a.draws ? { draws: +a.draws } : {}), ...(a.seed ? { seed: +a.seed } : {}) });
  if (a.md) writeFileSync(a.md, renderMarkdown(t));
  return renderText(t) + (a.md ? "\nwrote " + a.md + "\n" : "");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.stdout.write(main(process.argv.slice(2)));
