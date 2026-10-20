// Sandbox step 0, the spike (only with STARFARE_SPIKE "on"; the live Worker never sets it). It answers two questions before
// the sandbox is built (game-design SANDBOX-BUILD-PLAN step 0): does each Grok chat get its own MCP session when three
// chats share one connector, and does a long `wait` call come back to Grok before Grok gives up on it?
// A test world has three seats (EX, D1, D2), each with a code. join binds the calling MCP session to a seat, send posts
// a note to another seat, and wait long-polls until a note arrives or its seconds run out. Every call is logged on the
// world's page, /spike/<world>, with the MCP session that made it. No game data: nothing here is scored or simulated.
import { z } from "zod";

export const spikeOn = (env) => env.STARFARE_SPIKE === "on";
export const SPIKE_PATH = /^\/spike\/([0-9a-f]{32})(\.json)?$/; // a test world's page and its log
export const SEATS = ["EX", "D1", "D2"];
const SEAT_NAME = { EX: "executor", D1: "dispatcher 1", D2: "dispatcher 2" };
const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SEAT_CODE = /^(EX|D1|D2)-[A-HJ-NP-Z2-9]{5}$/;
const WORLD_MS = 12 * 3600 * 1000; // a test world's codes work this long
const WAIT_MAX_S = 600, WAIT_DEFAULT_S = 60, POLL_MS = 1000, PROGRESS_MS = 10000;
const EVENTS_MAX = 400;

const newWorld = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const newCode = (seat) => seat + "-" + [...crypto.getRandomValues(new Uint8Array(5))].map((x) => CODE_ABC[x % CODE_ABC.length]).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The hub's side: tables made on first use, so the live hub never gets them. Every method takes the hub's sql. */
export const spikeStore = {
  init(sql) {
    sql.exec("CREATE TABLE IF NOT EXISTS spike_seats (code TEXT PRIMARY KEY, world TEXT NOT NULL, seat TEXT NOT NULL, session TEXT, info TEXT, seen INTEGER NOT NULL DEFAULT 0, expires_ms INTEGER NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS spike_seats_by_world ON spike_seats (world)");
    sql.exec("CREATE TABLE IF NOT EXISTS spike_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, world TEXT NOT NULL, at_ms INTEGER NOT NULL, v TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS spike_events_by_world ON spike_events (world, seq)");
    sql.exec("CREATE TABLE IF NOT EXISTS spike_notes (seq INTEGER PRIMARY KEY AUTOINCREMENT, world TEXT NOT NULL, to_seat TEXT NOT NULL, from_seat TEXT NOT NULL, at_ms INTEGER NOT NULL, text TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS spike_notes_by_seat ON spike_notes (world, to_seat, seq)");
  },
  open(sql) {
    this.init(sql);
    const now = Date.now(), world = newWorld(), expires_ms = now + WORLD_MS;
    sql.exec("DELETE FROM spike_events WHERE world IN (SELECT world FROM spike_seats WHERE expires_ms < ?)", now);
    sql.exec("DELETE FROM spike_notes WHERE world IN (SELECT world FROM spike_seats WHERE expires_ms < ?)", now);
    sql.exec("DELETE FROM spike_seats WHERE expires_ms < ?", now);
    const codes = {};
    for (const seat of SEATS) {
      codes[seat] = newCode(seat);
      sql.exec("INSERT INTO spike_seats (code, world, seat, expires_ms) VALUES (?, ?, ?, ?)", codes[seat], world, seat, expires_ms);
    }
    this.event(sql, world, { kind: "opened" });
    return { world, codes, expires_ms };
  },
  event(sql, world, v) {
    sql.exec("INSERT INTO spike_events (world, at_ms, v) VALUES (?, ?, ?)", world, Date.now(), JSON.stringify(v));
    const n = sql.exec("SELECT COUNT(*) AS n FROM spike_events WHERE world = ?", world).one().n;
    if (n > EVENTS_MAX) sql.exec("DELETE FROM spike_events WHERE seq IN (SELECT seq FROM spike_events WHERE world = ? ORDER BY seq ASC LIMIT ?)", world, n - EVENTS_MAX);
  },
  /** The seat a session holds, by its code, or the seat this session joined. */
  seatOf(sql, session, code) {
    this.init(sql);
    const now = Date.now();
    if (code) {
      const c = String(code).trim().toUpperCase();
      const row = SEAT_CODE.test(c) ? sql.exec("SELECT world, seat, session, expires_ms FROM spike_seats WHERE code = ?", c).toArray()[0] : null;
      return row && row.expires_ms > now ? { ...row, by: "code" } : null;
    }
    const row = sql.exec("SELECT world, seat, session, expires_ms FROM spike_seats WHERE session = ? AND expires_ms > ? ORDER BY expires_ms DESC LIMIT 1", session, now).toArray()[0];
    return row ? { ...row, by: "session" } : null;
  },
  join(sql, code, session, info) {
    const s = this.seatOf(sql, session, code);
    if (!s) return { error: "That seat code is unknown or expired. Ask the player for the code their /spike page shows for your seat." };
    const others = sql.exec("SELECT seat FROM spike_seats WHERE world = ? AND session = ? AND seat <> ?", s.world, session, s.seat).toArray().map((r) => r.seat);
    sql.exec("UPDATE spike_seats SET session = ?, info = ? WHERE world = ? AND seat = ?", session, JSON.stringify(info), s.world, s.seat);
    this.event(sql, s.world, { kind: "join", seat: s.seat, session, client: info.client || null, agent_name: info.agent_name || null,
      moved_from: s.session && s.session !== session ? s.session : null, same_session_as: others });
    return { world: s.world, seat: s.seat, moved_from: s.session && s.session !== session ? s.session : null, same_session_as: others, seats: this.seats(sql, s.world) };
  },
  seats(sql, world) {
    return sql.exec("SELECT seat, session, info FROM spike_seats WHERE world = ? ORDER BY seat", world).toArray()
      .map((r) => ({ seat: r.seat, joined: !!r.session, session: r.session, ...(r.info ? JSON.parse(r.info) : {}) }));
  },
  send(sql, world, from, to, text, session, by) {
    sql.exec("INSERT INTO spike_notes (world, to_seat, from_seat, at_ms, text) VALUES (?, ?, ?, ?, ?)", world, to, from, Date.now(), text);
    this.event(sql, world, { kind: "send", seat: from, session, by, to, text });
  },
  /** Notes to a seat after seq, oldest first. */
  inbox(sql, world, seat, after) {
    return sql.exec("SELECT seq, from_seat, at_ms, text FROM spike_notes WHERE world = ? AND to_seat = ? AND seq > ? ORDER BY seq", world, seat, after | 0).toArray()
      .map((r) => ({ seq: r.seq, from: r.from_seat, at: new Date(r.at_ms).toISOString(), text: r.text }));
  },
  /** The newest note a seat's wait has returned, so the next wait only returns newer ones. */
  lastSeen(sql, world, seat) {
    const r = sql.exec("SELECT seen FROM spike_seats WHERE world = ? AND seat = ?", world, seat).toArray()[0];
    return r ? r.seen : 0;
  },
  seen(sql, world, seat, seq) { sql.exec("UPDATE spike_seats SET seen = MAX(seen, ?) WHERE world = ? AND seat = ?", seq, world, seat); },
  view(sql, world, after) {
    this.init(sql);
    const seats = this.seats(sql, world);
    if (!seats.length) return null;
    const events = sql.exec("SELECT seq, at_ms, v FROM spike_events WHERE world = ? AND seq > ? ORDER BY seq", world, after | 0).toArray()
      .map((r) => ({ seq: r.seq, at_ms: r.at_ms, ...JSON.parse(r.v) }));
    const codes = Object.fromEntries(sql.exec("SELECT seat, code FROM spike_seats WHERE world = ?", world).toArray().map((r) => [r.seat, r.code]));
    return { world, codes, seats, events };
  },
};

const seatArg = z.string().min(8).max(8).describe("your seat code, e.g. D1-4QM7K. Only needed if a call says this chat has no seat.").optional();

export const SPIKE_TOOLS = {
  join: {
    description: "Starfare sandbox test (no game, nothing is scored). Take a seat in the player's test world with the seat code they give you " +
      "(EX-... is the executor, D1-... and D2-... are dispatchers). Say who you are as you know it. Call it once, at the start.",
    inputSchema: {
      code: z.string().min(8).max(8).describe("the seat code the player gave you, e.g. EX-4QM7K"),
      agent_name: z.string().max(60).optional().describe("your name as the player knows you"),
      model: z.string().max(60).optional().describe("the model you run on, as you know it"),
    },
  },
  wait: {
    description: "Starfare sandbox test. Sit idle until another seat sends you a note or the seconds run out, then return what arrived. " +
      "Report elapsed_s and woke_by to the player exactly as returned. If this call fails or times out on your side, tell the player the seconds you asked for and what error you saw.",
    inputSchema: {
      seconds: z.number().int().min(1).max(WAIT_MAX_S).optional().describe(`how long to wait at most, 1-${WAIT_MAX_S} (default ${WAIT_DEFAULT_S})`),
      code: seatArg,
    },
  },
  send: {
    description: "Starfare sandbox test. Send a short note to another seat in your test world: EX (executor), D1 or D2 (dispatchers). It wakes that seat's wait.",
    inputSchema: {
      to: z.enum(["EX", "D1", "D2"]).describe("the seat to send to"),
      text: z.string().min(1).max(280).describe("the note"),
      code: seatArg,
    },
  },
};

export const SPIKE_INSTRUCTIONS = "\nSandbox test: if the player gives you a seat code like EX-4QM7K, D1-4QM7K or D2-4QM7K, call join with it, " +
  "then follow the player's steps with wait and send. These three tools are a connection test only: no game, nothing scored.";

/** The MCP side. agent is the StarfareMcp session; extra is the SDK's per-call extra (progress token, abort signal). */
export function spikeHandlers(hubOf) {
  const sessionOf = (agent) => agent.name || "unknown";
  const transportOf = (agent) => String(agent.name || "").split(":")[0] || "unknown";
  const noSeat = (agent) => ({ error: `This chat's connection (session ${short(sessionOf(agent))}) has no seat. Call join with your seat code, ` +
    "or pass code to this call. Tell the player you saw this message: it means Grok opened a new connection since join." });

  return {
    async join(agent, input) {
      const info = { agent_name: input.agent_name || null, model: input.model || null, client: clientOf(agent), transport: transportOf(agent) };
      const r = await hubOf(agent).spikeJoin(input.code, sessionOf(agent), info);
      if (r.error) return r;
      return { joined: true, seat: r.seat, role: SEAT_NAME[r.seat], session: short(sessionOf(agent)), transport: info.transport,
        ...(r.same_session_as.length ? { warning: "This connection already holds seat " + r.same_session_as.join(", ") + ": one Grok connection is serving more than one chat." } : {}),
        ...(r.moved_from ? { note: "This seat was held by session " + short(r.moved_from) + " and moved to this one." } : {}),
        seats: r.seats.map((s) => ({ seat: s.seat, joined: s.joined, session: s.session ? short(s.session) : null })) };
    },

    async send(agent, input) {
      const h = hubOf(agent), s = await h.spikeSeat(sessionOf(agent), input.code || null);
      if (!s) return noSeat(agent);
      if (input.to === s.seat) return { error: "That is your own seat. Send to one of the others." };
      await h.spikeSend(s.world, s.seat, input.to, String(input.text), sessionOf(agent), s.by);
      return { sent: true, from: s.seat, to: input.to };
    },

    async wait(agent, input, extra) {
      const h = hubOf(agent), s = await h.spikeSeat(sessionOf(agent), input.code || null);
      if (!s) return noSeat(agent);
      const seconds = input.seconds || WAIT_DEFAULT_S, t0 = Date.now(), end = t0 + seconds * 1000;
      const token = extra && extra._meta && extra._meta.progressToken;
      const signal = extra && extra.signal;
      const after = await h.spikeLastSeen(s.world, s.seat);
      await h.spikeEvent(s.world, { kind: "wait_start", seat: s.seat, session: sessionOf(agent), by: s.by, seconds, progress_token: token != null });
      let notes = [], lastProgress = t0, cancelled = false;
      while (Date.now() < end) {
        if (signal && signal.aborted) { cancelled = true; break; }
        notes = await h.spikeInbox(s.world, s.seat, after);
        if (notes.length) break;
        if (token != null && Date.now() - lastProgress >= PROGRESS_MS && extra.sendNotification) {
          lastProgress = Date.now();
          await extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: Math.round((Date.now() - t0) / 1000), total: seconds,
            message: "waiting for a note" } }).catch(() => {});
        }
        await sleep(Math.min(POLL_MS, Math.max(0, end - Date.now())));
      }
      const elapsed_s = Math.round((Date.now() - t0) / 100) / 10, woke_by = cancelled ? "cancelled" : notes.length ? "note" : "timeout";
      if (notes.length) await h.spikeSeen(s.world, s.seat, notes[notes.length - 1].seq);
      await h.spikeEvent(s.world, { kind: "wait_end", seat: s.seat, session: sessionOf(agent), seconds, elapsed_s, woke_by, notes: notes.length });
      return { seat: s.seat, asked_s: seconds, elapsed_s, woke_by, notes };
    },
  };
}

export const short = (session) => {
  const id = String(session).split(":").pop();
  return id.slice(0, 6) + "…" + id.slice(-4);
};
const clientOf = (agent) => {
  const v = agent.server && agent.server.server && agent.server.server.getClientVersion && agent.server.server.getClientVersion();
  return v ? String(v.name || "").slice(0, 60) + (v.version ? " " + String(v.version).slice(0, 20) : "") : null;
};


/** /spike and /spike/<world>: the test world, its seat codes, the message to paste into each Grok chat, and the live log. */
export function spikePage(origin, world) {
  const boot = JSON.stringify({ origin, world }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sandbox connection test</title><style>
:root{--bg:#0b0f17;--panel:#121a26;--line:#243246;--text:#dfe7f2;--muted:#8b9bb1;--ok:#5fd39a;--bad:#ff7a6b;--warn:#f2c35b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 64px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}
p{color:var(--muted);margin:6px 0}.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin:10px 0}
button{background:#2b6cdf;color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit;cursor:pointer}
button.copy{background:#26344a;padding:6px 10px;font-size:13px}code,pre{font:13px/1.45 ui-monospace,monospace}
pre{white-space:pre-wrap;margin:8px 0 0;background:#0b111b;border:1px solid var(--line);border-radius:8px;padding:10px}
.seat{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}.code{font-size:20px;letter-spacing:1px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.muted{color:var(--muted)}
.wrap{overflow-x:auto}
</style></head><body><main>
<h1>Sandbox connection test</h1>
<p>Checks two things before the sandbox is built: that three Grok chats on one connector each get their own connection, and that a long <code>wait</code> comes back to Grok. Nothing here is a game or scored.</p>
<div id="app"></div></main>
<script>
const B = ${boot};
const app = document.getElementById("app");
const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (s) => { if (!s) return "none"; const id = String(s).split(":").pop(); return id.slice(0, 6) + "…" + id.slice(-4); };
const NAME = { EX: "Executor", D1: "Dispatcher 1", D2: "Dispatcher 2" };
const STEPS = {
  D1: (c) => "Starfare sandbox connection test. Call the Starfare join tool with code " + c + ". Then call wait with seconds 60 and tell me exactly what it returned. Then call wait with seconds 240 and tell me exactly what it returned, or the error you saw.",
  D2: (c) => "Starfare sandbox connection test. Call the Starfare join tool with code " + c + ". Then call wait with seconds 600 and tell me exactly what it returned, or the error you saw.",
  EX: (c) => "Starfare sandbox connection test. Call the Starfare join tool with code " + c + ". Then call send with to D2 and text \\"wake up, D2\\". Then call wait with seconds 30 and tell me exactly what it returned.",
};
if (!B.world) {
  app.innerHTML = '<div class="panel"><p>Opens a test world with three seat codes. Codes work for 12 hours.</p><p><button id="new">New test world</button></p></div>';
  document.getElementById("new").onclick = async () => {
    const r = await fetch("/spike/new", { method: "POST" }).then((x) => x.json());
    if (r.world) location.href = "/spike/" + r.world; else alert(r.error || "Could not open a world");
  };
} else {
  let after = 0, events = [], seats = [], codes = {};
  const render = () => {
    const sess = {}; seats.forEach((s) => { if (s.session) (sess[s.session] = sess[s.session] || []).push(s.seat); });
    const joined = seats.filter((s) => s.joined).length, distinct = Object.keys(sess).length;
    const ends = events.filter((e) => e.kind === "wait_end"), starts = events.filter((e) => e.kind === "wait_start");
    const byCode = events.filter((e) => e.by === "code").length, moved = events.filter((e) => e.kind === "join" && e.moved_from).length;
    const longest = ends.filter((e) => e.woke_by === "timeout").reduce((m, e) => Math.max(m, e.elapsed_s), 0);
    const woke = ends.some((e) => e.woke_by === "note"), prog = starts.some((e) => e.progress_token);
    const open = starts.filter((s) => !ends.some((e) => e.seq > s.seq && e.seat === s.seat && e.session === s.session));
    const verdict = [
      ["Each chat has its own connection", joined < 3 ? ["muted", joined + " of 3 seats joined"] : distinct === 3 ? ["ok", "Yes: 3 seats, 3 connections"] : ["bad", "No: 3 seats on " + distinct + " connection(s)"]],
      ["Connection kept between calls", byCode || moved ? ["bad", "No: " + byCode + " call(s) needed the code, " + moved + " seat(s) moved"] : starts.length ? ["ok", "Yes so far"] : ["muted", "No calls yet"]],
      ["Longest wait run to its end on the server", longest ? ["ok", longest + " s"] : ["muted", "None yet"]],
      ["A note woke a waiting seat", woke ? ["ok", "Yes"] : ["muted", "Not yet"]],
      ["Grok asked for progress updates", starts.length ? (prog ? ["ok", "Yes (the server sends one every 10 s)"] : ["muted", "No"]) : ["muted", "No calls yet"]],
    ];
    app.innerHTML =
      '<h2>1. Paste one message into each Grok chat</h2><p>Use three separate Grok chats, each with the Starfare spike connector on. Start Dispatcher 1 and Dispatcher 2 first. Send the Executor message once Dispatcher 2 shows as waiting below.</p>' +
      ["D1", "D2", "EX"].map((k) => { const s = seats.find((x) => x.seat === k) || {}; return '<div class="panel"><div class="seat"><div><b>' + NAME[k] + '</b> <span class="code">' + h(codes[k]) + '</span></div><div>' +
        (s.joined ? '<span class="ok">joined</span> <span class="muted">connection ' + h(short(s.session)) + (s.client ? " · " + h(s.client) : "") + (s.transport ? " · " + h(s.transport) : "") + '</span>' : '<span class="muted">not joined</span>') +
        (open.some((o) => o.seat === k) ? ' <span class="warn">· waiting</span>' : "") +
        '</div></div><pre>' + h(STEPS[k](codes[k] || "")) + '</pre><p><button class="copy" data-k="' + k + '">Copy message</button></p></div>'; }).join("") +
      '<h2>2. What the server saw</h2><div class="panel wrap"><table>' + verdict.map((v) => '<tr><th>' + v[0] + '</th><td class="' + v[1][0] + '">' + h(v[1][1]) + '</td></tr>').join("") + '</table></div>' +
      '<p>The server can only see its own side. If a Grok chat reports an error or a timeout for a wait that shows as finished here, that wait was too long for Grok. Tell Claude what each chat said.</p>' +
      '<h2>3. Log</h2><div class="panel wrap"><table><tr><th>Time</th><th>Seat</th><th>What</th><th>Connection</th></tr>' +
      events.slice().reverse().map((e) => '<tr><td>' + new Date(e.at_ms).toLocaleTimeString() + '</td><td>' + h(e.seat || "") + '</td><td>' + h(line(e)) + '</td><td class="muted">' + h(e.session ? short(e.session) : "") + (e.by === "code" ? ' <span class="bad">(by code)</span>' : "") + '</td></tr>').join("") +
      '</table></div>';
    app.querySelectorAll("button.copy").forEach((b) => b.onclick = () => navigator.clipboard.writeText(STEPS[b.dataset.k](codes[b.dataset.k])).then(() => { b.textContent = "Copied"; setTimeout(() => b.textContent = "Copy message", 1500); }));
  };
  const line = (e) => e.kind === "opened" ? "Test world opened" :
    e.kind === "join" ? "Joined" + (e.agent_name ? " as " + e.agent_name : "") + (e.moved_from ? " (seat moved from connection " + short(e.moved_from) + ")" : "") + (e.same_session_as && e.same_session_as.length ? " (same connection as " + e.same_session_as.join(", ") + ")" : "") :
    e.kind === "send" ? "Sent to " + e.to + ": " + e.text :
    e.kind === "wait_start" ? "Wait started, up to " + e.seconds + " s" + (e.progress_token ? " (Grok asked for progress)" : "") :
    e.kind === "wait_end" ? "Wait returned after " + e.elapsed_s + " s of " + e.seconds + ": " + (e.woke_by === "note" ? "woken by a note" : e.woke_by) : e.kind;
  const poll = async () => {
    try {
      const r = await fetch("/spike/" + B.world + ".json?after=" + after).then((x) => x.json());
      if (r.error) { app.innerHTML = '<div class="panel bad">' + h(r.error) + '</div>'; return; }
      seats = r.seats; codes = r.codes; events = events.concat(r.events); if (r.events.length) after = r.events[r.events.length - 1].seq;
      render();
    } catch (e) {}
    setTimeout(poll, 2000);
  };
  poll();
}
</script></body></html>`;
}
