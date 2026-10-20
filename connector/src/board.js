// GET /board: the current seasonal desk and scored legacy catalog references, also shown on the home scoreboard.
import { rowVersion } from "./game.js";
import { RUN_ID } from "./tools.js";
import { pointsText } from "./display.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tagHtml = (b) => {
  const tag = `tag ${esc(b.run_tag)}`;
  return typeof b.run_id === "string" && RUN_ID.test(b.run_id) ? `<a href="${esc("/flight/" + b.run_id)}">${tag}</a>` : tag;
};
const num = (n) => Math.round(n).toLocaleString("en-US");

export function boardHtml(hails, data) {
  const catalog = new Set((data.legacy_hails || []).map((h) => h.hail_id));
  const rows = hails.map((h) => {
    const b = data.best[h.hail_id];
    return `<tr><td>${esc(h.title)}<div class="dim">${esc(h.hail_id)}${catalog.has(h.hail_id) ? " · Catalog reference booking" : ""}</div><div class="dim">${esc(h.from.name)} to ${esc(h.to.name)} · ${esc(h.kind)}</div></td>` +
      (b ? `<td class="n"><b>${pointsText(b.points)}</b></td><td>${esc(b.car || "")}<div class="dim">pickup wait ${b.wait_h != null ? esc(b.wait_h) + " h" : ""}</div></td><td class="n">${num(b.kwh)} kWh<div class="dim">par ${num(b.par)}</div></td><td class="n">${b.plans}</td>` +
        `<td>planned by Grok bot${b.player_tag ? ` · player ${esc(b.player_tag)}` : ""}<div class="dim">${tagHtml(b)} · ${esc(new Date(b.at).toISOString().slice(0, 16).replace("T", " "))} UTC${rowVersion(b) !== data.score_version ? ` · scored with version ${esc(rowVersion(b))}` : ""}</div></td>`
        : `<td class="dim" colspan="5">no connector runs yet</td>`) + "</tr>";
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Starfare Dispatcher Board</title><style>
:root{--bg:#f7f7f5;--fg:#16181d;--dim:#5d6470;--line:#d9dbe0;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0c0f16;--fg:#e8ebf2;--dim:#9aa3b2;--line:#283041;--card:#121726}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:820px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}
.dim{color:var(--dim);font-size:13px}table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:16px 0}
th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:13px;color:var(--dim);font-weight:600}
.n{text-align:right;font-variant-numeric:tabular-nums}.wrap{overflow-x:auto}p{margin:8px 0}
</style></head><body><main>
<h1>Starfare dispatcher board</h1>
<p class="dim">Starfare is a concept robotaxi service for Starseeker ships. Riders and the fleet are simulated. Each row is the highest score for one ride hail, dispatched by a bot through the Starfare MCP connector. Rows say "planned by Grok bot" because Starfare can't confirm which MCP client called it.</p>
<div class="wrap"><table><thead><tr><th>Hail</th><th class="n">Score</th><th>Ship</th><th class="n">Battery</th><th class="n">Plans</th><th>By</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="dim">Scores are out of 100000, shown here in whole points. The weights are placeholders. They come from what actually happened once the season's simulated hazards (busy pads, solar flares, Mars dust, Titan haze, busy ships) were flown. Each part except cruise dose earns its full weight on the stated reference, and less as the ride moves off it. The falloff steepness of 6 is a simulated assumption. fast pickup 22000, on time 16000, energy versus par 31000, kept the promised arrival 14000, every leg checked 4000, honest fare 4000, planning economy 3000, departure window 3000, checkpoint recovery 3000, cruise dose 0. Battery is kWh actually flown, including holds and correction burns.</p>
<p class="dim">Season ${esc(data.season ?? "not recorded")}: ${esc(data.pool_size ?? hails.length)} seasonal bookings, the same pool returned by list_hails and shown on the home desk. Scored catalog reference bookings are labelled separately. The home scoreboard reads this same data.</p>
<p class="dim">${data.stats.runs_scored || 0} connector runs scored across all seasons. Machine-readable: <a href="/board.json">/board.json</a>.</p>
</main></body></html>`;
}
