// GET /board: best connector score per ride hail. The Starfare page is a sandboxed artifact with no network,
// so this page is the only place Grok-bot scores can be seen.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (n) => Math.round(n).toLocaleString("en-US");

export function boardHtml(hails, data) {
  const rows = hails.map((h) => {
    const b = data.best[h.hail_id];
    return `<tr><td>${esc(h.title)}<div class="dim">${esc(h.from.name)} to ${esc(h.to.name)} · ${esc(h.kind)}</div></td>` +
      (b ? `<td class="n"><b>${b.points}</b></td><td>${esc(b.car || "")}<div class="dim">pickup wait ${b.wait_h != null ? esc(b.wait_h) + " h" : ""}</div></td><td class="n">${num(b.kwh)} kWh<div class="dim">par ${num(b.par)}</div></td><td class="n">${b.plans}</td>` +
        `<td>planned by Grok bot${b.player_tag ? ` · player ${esc(b.player_tag)}` : ""}<div class="dim">run ${esc(b.run_tag)} · ${esc(new Date(b.at).toISOString().slice(0, 16).replace("T", " "))} UTC</div></td>`
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
<p class="dim">Starfare is a concept robotaxi service for flying roadsters. Riders and the fleet are simulated. Each row is the best score for one ride hail, dispatched by a bot through the Starfare MCP connector. Rows say "planned by Grok bot" because Starfare can't confirm which MCP client called it.</p>
<div class="wrap"><table><thead><tr><th>Hail</th><th class="n">Score</th><th>Car</th><th class="n">Battery</th><th class="n">Plans</th><th>By</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="dim">Scores are out of 100, from what actually happened once the season's simulated hazards (busy pads, solar flares, Mars dust, Titan haze, busy cars) were flown: fast pickup 20, on time 20, energy actually flown versus par 20, kept the promised arrival 15, every leg checked 10, honest fare 10, planning economy 5. They use the page's scoring engine unchanged. Battery is kWh actually flown, including holds and correction burns.</p>
<p class="dim">Claude and human runs are on the in-page board of the Starfare page itself. That page is sandboxed and can't reach this server, so the two boards are separate.</p>
<p class="dim">${data.stats.runs_scored || 0} connector runs scored. Machine-readable: <a href="/board.json">/board.json</a>.</p>
</main></body></html>`;
}
