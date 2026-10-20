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

/** The season ranking: each signed-in player's mean over every attempt, abandons and open bookings as 0. */
export function standingsHtml(st) {
  if (!st) return "";
  const rows = st.ranked.map((p) => `<tr><td class="n">${p.rank}</td><td>player ${esc(p.player_tag)}</td><td class="n"><b>${pointsText(p.mean)}</b></td>` +
    `<td class="n">${p.attempts}</td><td class="n">${p.arrived}</td><td class="n">${p.best != null ? pointsText(p.best) : ""}</td></tr>`).join("");
  const wait = st.unranked ? ` ${st.unranked} more player${st.unranked === 1 ? " has" : "s have"} fewer than ${st.min_attempts} attempts and ${st.unranked === 1 ? "is" : "are"} not ranked yet.` : "";
  return `<h2>Season standings</h2>
<p class="dim">Ranked by the mean score over every attempt this season. A booking counts as an attempt from its first plan or forecast, and one that hasn't arrived (dropped, or still open) counts 0, so taking only the good draws doesn't pay. Signed-in players with at least ${st.min_attempts} attempts are ranked.${wait}</p>
${rows ? `<div class="wrap"><table><thead><tr><th class="n">Rank</th><th>Player</th><th class="n">Mean</th><th class="n">Attempts</th><th class="n">Arrived</th><th class="n">Best</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="dim">No player has ${st.min_attempts} attempts this season yet.</p>`}
<h2>Best flight per booking</h2>`;
}

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
main{max-width:820px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:24px 0 4px}
.dim{color:var(--dim);font-size:13px}table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:16px 0}
th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:13px;color:var(--dim);font-weight:600}
.n{text-align:right;font-variant-numeric:tabular-nums}.wrap{overflow-x:auto}p{margin:8px 0}
</style></head><body><main>
<h1>Starfare dispatcher board</h1>
<p class="dim">Starfare is a concept robotaxi service for Starseeker ships. Riders and the fleet are simulated. The season standings rank players by their mean over every attempt. Below them, each row is the highest score for one ride hail, dispatched by a bot through the Starfare MCP connector. Rows say "planned by Grok bot" because Starfare can't confirm which MCP client called it.</p>
${standingsHtml(data.standings)}
<div class="wrap"><table><thead><tr><th>Hail</th><th class="n">Score</th><th>Ship</th><th class="n">Battery</th><th class="n">Plans</th><th>By</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="dim">Scores are out of 100000, shown here in whole points. The weights are placeholders. They come from what actually happened once the season's simulated hazards (busy pads, solar flares, Mars dust, Titan haze, busy ships) were flown. Each part except cruise dose earns its full weight on the stated reference, and less as the ride moves off it. The falloff steepness of 6 is a simulated assumption. fast pickup 22000, on time 16000, energy versus par 31000, kept the promised arrival 14000, every leg checked 4000, honest fare 4000, planning economy 3000, departure window 3000, checkpoint recovery 3000, cruise dose 0. Battery is kWh actually flown, including holds and correction burns.</p>
<p class="dim">Season ${esc(data.season ?? "not recorded")}: ${esc(data.pool_size ?? hails.length)} seasonal bookings, the same pool returned by list_hails and shown on the home desk. Scored catalog reference bookings are labelled separately. The home scoreboard reads this same data.</p>
<p class="dim">${data.stats.runs_scored || 0} connector runs scored across all seasons. Machine-readable: <a href="/board.json">/board.json</a>.</p>
</main></body></html>`;
}
