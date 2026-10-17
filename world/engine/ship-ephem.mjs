import { readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { placesTable } from "./sol-engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const ephemJs = join(here, "ephem.js");
const ephemJson = join(here, "ephem.json");

export function keepIds(places) {
  const ids = new Set(["emb", "moon_geo"]);
  for (const p of places) {
    if (p.kind === "planet" && p.id !== "earth") ids.add(p.id);
    else if (p.kind === "small") ids.add(p.id);
  }
  return ids;
}

export function projectEphemeris(baked, places) {
  const keep = keepIds(places);
  const bodies = {};
  for (const [id, body] of Object.entries(baked.bodies)) {
    if (keep.has(id)) bodies[id] = body;
  }
  const missing = [...keep].filter((id) => !Object.hasOwn(bodies, id));
  if (missing.length) throw new Error("ephemeris missing " + missing.join(","));
  return { ...baked, bodies };
}

export function assertProjected(baked, places) {
  const keep = keepIds(places);
  const got = new Set(Object.keys(baked.bodies));
  const extra = [...got].filter((id) => !keep.has(id)).sort();
  const missing = [...keep].filter((id) => !got.has(id)).sort();
  if (extra.length || missing.length) {
    throw new Error("ephemeris bodies and place catalog disagree: extra [" + extra.join(",") + "] missing [" + missing.join(",") + "]");
  }
}

export function exciseEphemerisText(jsonText, places) {
  const baked = JSON.parse(jsonText);
  const keep = keepIds(places);
  for (const id of keep) {
    if (!Object.hasOwn(baked.bodies, id)) throw new Error("ephemeris missing " + id);
  }
  const drop = new Set(Object.keys(baked.bodies).filter((id) => !keep.has(id)));
  if (drop.size === 0) return jsonText;
  const entries = readBodies(jsonText);
  const seen = new Set(entries.map((e) => e.key));
  for (const id of Object.keys(baked.bodies)) {
    if (!seen.has(id)) throw new Error("ephemeris scanner missed " + id);
  }
  const ranges = [];
  for (const e of entries) {
    if (!drop.has(e.key)) continue;
    let start = e.keyStart;
    let end = e.valueEnd;
    let k = start - 1;
    while (jsonText[k] === " " || jsonText[k] === "\n" || jsonText[k] === "\r" || jsonText[k] === "\t") k -= 1;
    if (jsonText[k] === ",") start = k;
    else {
      let m = end;
      while (jsonText[m] === " " || jsonText[m] === "\n" || jsonText[m] === "\r" || jsonText[m] === "\t") m += 1;
      if (jsonText[m] === ",") end = m + 1;
    }
    ranges.push([start, end]);
  }
  if (ranges.length !== drop.size) throw new Error("ephemeris scanner missed a dropped body");
  ranges.sort((a, b) => b[0] - a[0]);
  let text = jsonText;
  for (const [start, end] of ranges) text = text.slice(0, start) + text.slice(end);
  return text;
}

function readBodies(jsonText) {
  const marker = '"bodies":';
  const at = jsonText.indexOf(marker);
  if (at < 0) throw new Error("ephemeris text has no bodies object");
  let i = at + marker.length;
  if (jsonText[i] !== "{") throw new Error("ephemeris bodies is not an object");
  i += 1;
  const entries = [];
  while (i < jsonText.length) {
    if (jsonText[i] === "}") return entries;
    if (jsonText[i] === ",") { i += 1; continue; }
    if (jsonText[i] !== '"') throw new Error("ephemeris bodies key expected");
    const keyStart = i;
    const key = readJsonString(jsonText, i);
    i = key.end;
    if (jsonText[i] !== ":") throw new Error("ephemeris bodies colon expected");
    i += 1;
    i = skipJsonValue(jsonText, i);
    entries.push({ key: key.value, keyStart, valueEnd: i });
  }
  throw new Error("ephemeris bodies object did not end");
}

function readJsonString(text, i) {
  if (text[i] !== '"') throw new Error("expected string");
  let j = i + 1;
  let value = "";
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") {
      const n = text[j + 1];
      const map = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (n === "u") {
        value += String.fromCharCode(Number.parseInt(text.slice(j + 2, j + 6), 16));
        j += 6;
        continue;
      }
      if (!Object.hasOwn(map, n)) throw new Error("bad escape");
      value += map[n];
      j += 2;
      continue;
    }
    if (c === '"') return { value, end: j + 1 };
    value += c;
    j += 1;
  }
  throw new Error("unterminated string");
}

function skipJsonValue(text, i) {
  const c = text[i];
  if (c === '"') return readJsonString(text, i).end;
  if (c === "{" || c === "[") {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === "{" || ch === "[") depth += 1;
      else if (ch === "}" || ch === "]") {
        depth -= 1;
        if (depth === 0) return j + 1;
      }
    }
    throw new Error("unterminated value");
  }
  let j = i;
  while (j < text.length && text[j] !== "," && text[j] !== "}" && text[j] !== "]") j += 1;
  if (j === i) throw new Error("empty value");
  return j;
}

function jsonFromModule(text) {
  const at = text.indexOf("export default ");
  if (at < 0) throw new Error("ephem.js has no export default");
  let body = text.slice(at + "export default ".length);
  if (body.endsWith(";\n")) body = body.slice(0, -2);
  else if (body.endsWith(";")) body = body.slice(0, -1);
  return { header: text.slice(0, at), jsonText: body };
}

function projectText(jsonText, places) {
  const prefixAt = jsonText.indexOf('"bodies":');
  const excised = exciseEphemerisText(jsonText, places);
  if (prefixAt < 0 || !excised.startsWith(jsonText.slice(0, prefixAt))) throw new Error("ephemeris prefix changed");
  const before = JSON.parse(jsonText);
  const after = JSON.parse(excised);
  assertProjected(after, places);
  for (const id of keepIds(places)) {
    if (before.bodies[id].data !== after.bodies[id].data) throw new Error("kept ephemeris data changed for " + id);
  }
  return excised;
}

function readEphemeris() {
  const { jsonText } = jsonFromModule(readFileSync(ephemJs, "utf8"));
  const jsonFile = readFileSync(ephemJson, "utf8");
  if (jsonFile !== jsonText) throw new Error("ephem.js and ephem.json differ");
  return JSON.parse(jsonText);
}

function writeEphemeris() {
  const places = placesTable();
  const jsRaw = readFileSync(ephemJs, "utf8");
  const { header, jsonText } = jsonFromModule(jsRaw);
  const jsonFile = readFileSync(ephemJson, "utf8");
  const fromJs = projectText(jsonText, places);
  const fromFile = jsonFile === jsonText ? fromJs : projectText(jsonFile, places);
  if (fromJs !== fromFile) throw new Error("ephem.js and ephem.json differ");
  const nextJs = header + "export default " + fromJs + ";\n";
  if (fromFile === jsonFile && nextJs === jsRaw) {
    console.log("ephem unchanged");
    return;
  }
  const jsonTmp = ephemJson + ".tmp";
  const jsTmp = ephemJs + ".tmp";
  try {
    writeFileSync(jsonTmp, fromFile);
    writeFileSync(jsTmp, nextJs);
    if (readFileSync(jsonTmp, "utf8") !== fromFile || readFileSync(jsTmp, "utf8") !== nextJs) {
      throw new Error("ephem temp readback mismatch");
    }
    renameSync(jsonTmp, ephemJson);
    renameSync(jsTmp, ephemJs);
  } catch (err) {
    rmSync(jsonTmp, { force: true });
    rmSync(jsTmp, { force: true });
    throw err;
  }
  console.log("ephem wrote", fromFile.length, "json bytes");
}

function main() {
  const cmd = process.argv[2];
  if (cmd === "--small-ids") {
    for (const p of placesTable()) if (p.kind === "small") console.log(p.id);
    return;
  }
  if (cmd === "--check") {
    assertProjected(readEphemeris(), placesTable());
    return;
  }
  if (cmd === "--write") {
    writeEphemeris();
    return;
  }
  throw new Error("usage: node world/engine/ship-ephem.mjs --check | --write | --small-ids");
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
