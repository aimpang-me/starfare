# Comms: the HQ channel (2026-10-20)

Comms is a panel on the home map where HQ talks to the player. Everything in it is simulated. Mock: https://claude.ai/artifact/3HgB5k8NqiGi9Zp4gh2mwg (passed by Alvin, 2026-10-20). Its messages use message style B, the ledger with tags (`/mnt/project-files/ui-design/message-style-b.md`): each row has a time, a word chip and the text, colour appears only in the chips, and no row has a coloured left strip.

## What the player sees
- **Connect agent** (top bar) opens Comms and a channel. HQ then shows a one-time code to give the agent: "Check in with Starfare HQ, code K7-4QM." A code works once and lasts 10 minutes. **New code** makes a fresh one, and **Set up the connector** opens the existing four-step checklist.
- **Agent connects.** When the agent calls `check_in` with the code, the log shows a System line ("Agent connected", with the MCP client name and version it reported) and then HQ's check-in row: name, model, thinking, skills and whether the player is signed in. The row carries a Self-reported chip. The connector can only see the client name and version, so model, thinking and skills are whatever the agent says about itself, and anything it leaves out reads "not given".
- **Following the agent.** After it checks in, every booking the agent takes appears under a group header. Each row is a take, plan, dispatch or checkpoint decision, with the agent's own note shown as `Why: "…"`. Consecutive refusals from the same tool collapse into one row that gives the count and the last reason. The newest status row for a booking says Flying (with **Follow on map** and **Open flight page**), Checkpoint (waiting for the agent) or Landed with its score. The score only shows once the live playback has landed.
- **The follow link.** The sign-in page's follow link (`/agent/<token>`, from PR #31) has a "Follow on the map in Comms" button that opens `/?follow=<token>`. Comms then follows that agent's bookings without a code.
- **Ask HQ.** The player types any game question. `src/comms.cjs` matches it to a topic and answers only from data the page already has: open routes (the booking desk, filtered by place or kind), the season clock, space weather and pad alerts, the fleet and "where is SF-07", flights in the air, the scoreboard, and what the player's own agent is doing. HQ uses no model and makes no network call, and every number it gives is copied from that data. Anything it doesn't recognise gets a list of what it can answer.

## Fairness
HQ never plans a booking or picks a ship, because that is the agent's job and it is what gets scored. Questions such as "which ship should take it", "the best route" or "plan the ride" get a refusal that contains no numbers. HQ only reads what the public home page already shows. Bench runs never appear in Comms, because `followView` drops tagged runs.

## Server
- `POST /comms/new` returns `{ channel, code, expires_ms }`. The channel id stays secret in the browser (`localStorage` `sf-comms`).
- `POST /comms/<channel>/code` returns a fresh code.
- `GET /comms/<channel>.json?after=<seq>` returns `{ linked, code, events, runs }`. The panel polls it every 4 s while the tab is visible.
- MCP tool `check_in { code, agent_name?, model?, thinking?, skills? }` (hosted only). It spends the code, writes the two events, and remembers the channel for the session, so later `take_hail` runs list there. When the player is signed in, the channel also follows that player's newest bookings across sessions.
- Storage: the `comms`, `comms_events` (newest 50 per channel) and `comms_runs` tables in StarfareHub.

## Not done
- Real Grok has not checked in yet. The local test used a scripted MCP client named `capture-script`.
- The ship radio (`sol-radio.js`, its own thread) is hooked in but not built. Comms calls `Radio.say(entry)` for entries that carry a `radio` line, but only when `window.Radio` exists and is on.
- The live site still runs the code from before #31. Comms only appears there after a deploy that Alvin approves.

## Checks (2026-10-20)
- `node --test test/comms.test.mjs`: 5 of 5 (HQ answers, advice refusals with no numbers, check-in clipping, the code flow in the Hub).
- `node test/e2e.mjs`: 44 of 45. The new Comms check passes (open a channel, a bad code fails, a lowercase code works once, `take_hail` lists on the channel, an unknown channel is 404). The one failure is the pre-existing unflyable pool hail ("xenon tank holds 82 kg and this leg needs 84.3 kg"), which fails the same way on #31 and main.
- Captures from a local `wrangler dev` with a scripted agent (simulated data): `docs/comms/2026-10-20/` (desktop 1440 and phone 390: connect code, flying agent, an asked question).
