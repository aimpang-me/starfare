# Sandbox spike: three Grok chats, one connector

Step 0 of the sandbox build plan (`game-design/SANDBOX-BUILD-PLAN-2026-10-20.md` in the project files). Before the sandbox is built, it answers two questions with real Grok chats:

1. When three Grok chats use one connector, does each chat get its own MCP session? The sandbox binds a seat (executor, dispatcher 1, dispatcher 2) to a session, so this decides whether a seat can be remembered or every call must carry its code.
2. Does a long `wait` call come back to Grok, and how long can it be? The sandbox's agents sit idle in `wait` until something happens, so this decides how long one `wait` may hold.

Nothing here is a game: no hails, no scores, nothing simulated.

## What it adds

All of it is off unless the Worker's `STARFARE_SPIKE` var is `on`. The live Worker never sets it.

- Three MCP tools (`src/spike.js`): `join` takes a seat with its code, `send` posts a note to another seat, `wait` holds until a note arrives or its seconds (1 to 600) run out. A client that sends a progress token gets a progress notification every 10 s while it waits. A call from a session with no seat is refused with a message that says so, and `wait` and `send` then take the seat code as a fallback, which the log marks "by code".
- `/spike`: opens a test world with three seat codes (they work for 12 hours). `/spike/<world>`: the codes, the message to paste into each Grok chat, what the server saw so far, and the log. It polls `/spike/<world>.json`.
- State lives in the existing `StarfareHub` in three `spike_*` tables made on first use. No new Durable Object class and no migration.

## Test it locally

```
node build.mjs && node test/spike-e2e.mjs
```

It runs `wrangler dev` twice (spike off, then on) and checks: no tools or page when off; three clients on three sessions; a client with no seat is told so and can pass its code; a note wakes a waiting seat once; progress every 10 s; a 75 s wait runs past the SDK's 60 s default timeout; one client holding two seats is flagged; the log. About two minutes.

## Deploy it as its own Worker

Needs Alvin's go. It deploys a separate Worker named `starfare-spike` with its own Durable Objects, so the live `starfare` Worker, its runs and its board are untouched. From `connector/` on the spike branch:

```
npm ci
node build.mjs
node node_modules/wrangler/bin/wrangler.js deploy --name starfare-spike --var STARFARE_SPIKE:on
```

It prints the URL, for example `https://starfare-spike.aimpang.workers.dev`. OAuth is on, as on the live Worker, so Grok connects the same way.

## The test with Grok

1. At grok.com/connectors, add a connector named `Starfare spike` with the server URL `https://starfare-spike.aimpang.workers.dev/mcp`, and click Allow on the consent page.
2. Open `https://starfare-spike.aimpang.workers.dev/spike` and click New test world.
3. Open three new Grok chats, each with the Starfare spike connector on. The page shows one message per seat with its code and a Copy button.
4. Paste the Dispatcher 1 message into the first chat and the Dispatcher 2 message into the second.
5. When the page shows Dispatcher 2 as waiting, paste the Executor message into the third chat.
6. When all three chats have answered, send one more message in the Dispatcher 1 chat: `Call wait with seconds 5 and tell me what it returned.` This checks that the chat keeps its connection from one message to the next.
7. Copy what each chat said, or take a screenshot of each chat and of the page's "What the server saw" box, and send them to Claude.

What the answers decide:

- Three seats on three connections, and no call "by code": seats are bound to the session, as the plan assumes. If seats share a connection or need their code, every sandbox tool takes the seat code instead.
- A wait that finished on the server but errored in Grok shows Grok's limit. The sandbox's `wait` then holds for less than that and returns, and the agent calls it again.

## Remove it

When the test is done: `node node_modules/wrangler/bin/wrangler.js delete --name starfare-spike` (Alvin's go), and remove the connector in Grok.
