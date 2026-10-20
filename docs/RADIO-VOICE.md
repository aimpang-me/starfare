# Ship radio voice (2026-10-20)

Decided 2026-10-20 (Alvin, decision card): **both**. The stock phrasebook ships first; live voice for the agent's own words follows once the ElevenLabs account is on a paid plan.

Built so far: `design/assets/sol-radio.js` (player, radio filter, queue, off by default), `design/assets/audio/radio/` (19 ship lines, `lines.json`), the Radio button on the flight page, `connector/test/sol-radio.test.mjs`. The four HQ lines in `lines.json` `pending` are not generated yet (ElevenLabs rate-limited the account).

## Original plan

Goal: dispatch can listen to a ship's radio. Short callouts, emergencies and reroutes, spoken in a calm ElevenLabs voice through a spaceship-radio filter, voicing the agent's own reasoning. Sound stays off until the player turns it on.

## What gets spoken

One spoken line per agent-log entry that matters, never a read-out of the whole log. Sources, all from PR #31's `AgentLog` (`connector/src/agent-log.cjs`):

| Entry | Spoken? | Line comes from |
|---|---|---|
| take_hail, dispatch | yes | template: "Dispatch, Starseeker Kestrel. Booking accepted, departing now." |
| decide (hold, divert, replan, wait) | yes, as a reroute | `AgentLog.decision()` words + the agent's note |
| checkpoint waiting on the agent | yes, as an emergency | template, "Pan-pan" prefix, number-free |
| incident (dust storm, haze, flare, correction burn) | yes, as an emergency | template from the incident kind and place |
| arrive | yes | template: "Wheels down at Titan Dock. Passengers disembarking." |
| plan_*, check_pad, space_weather, list/get | no (too chatty) | only their note, if the agent left one, folded into the next spoken line |
| refused tool calls | no | stays text only |

**Making it concise.** Preferred: add an optional `radio` field to the agent's tool calls ("a radio callout for HQ, under 15 words"), so the agent writes its own short line. Fallback when it leaves none: the first sentence of its `note`, cut at about 140 characters. No second LLM call to summarise.

**Numbers.** Template lines speak no numbers. A number is only spoken if it is copied from the tool result for that entry. The agent's own words are voiced as its words and labelled as such.

**Label.** Every voiced entry in the log shows a small "Agent voice · generated (ElevenLabs) · simulated" tag; the player toggle reads "Ship radio (AI voice)". CREDITS.md gets a "Generated with ElevenLabs" row.

## Pre-generated or live

Recommendation: **live text-to-speech on the Worker, generated once per log entry and cached**, with Flash v2.5.
- The agent's reasoning is free text, so it can't be pre-recorded; templates alone would lose the "voice of the agent's reasoning" part.
- The Worker generates when the tool call lands (not when someone watches), stores the MP3 by text hash in KV or R2, and caps characters per day. Viewers only fetch the cached file, so a busy flight page costs nothing extra.
- The radio filter runs in the browser with Web Audio (band-pass, light drive, hiss, squelch clicks), so clips are stored clean and the filter costs nothing and can be tuned without regenerating.
- Open Sky (the claude.ai artifact) can't reach the Worker's audio, so it would get text only or a small inlined set of stock HQ lines.
- Needs, all on Alvin's go: an ElevenLabs API key as a Wrangler secret, a KV or R2 binding, and a deploy.

Alternative: pre-generated phrasebook only (about 40 stock lines, two takes each, about 7,200 credits once). Cheap and safe, but the agent's own reasoning would never be heard.

## Cost (from the connector's own estimates)

- v4: 1 credit per character (114 characters = 114 credits = $0.0114 at the connector's quoted rate). Flash v2.5: half that.
- Live, per flight: about 8 voiced lines × 100 characters = 800 characters, about 400 Flash credits (about $0.04). 1,000 flights a month ≈ 400,000 credits.
- Phrasebook once: about 3,600 characters × 2 takes on v4 ≈ 7,200 credits.
- Spent so far: two takes of one sample, 266 credits.

## Account warning

One sample (voice "James") failed with ElevenLabs saying Free Tier access is disabled after "unusual activity" and asking for a paid plan. The other voice worked. Any live use needs a paid plan anyway: as I understand ElevenLabs' terms, the free tier is non-commercial and needs attribution; confirm on the plan page.

## Samples

In the project files, `audio/radio-voice/`: `sample-launch-hold-radio.mp3` (filtered) and `sample-launch-hold-clean.mp3` (unfiltered), voice "Marilyn - Warm, Clear British", model v4, two takes each. Line: "Pan-pan, pan-pan. Dispatch, Starseeker Kestrel. Launch hold at Titan Dock. Passengers are secure. Standing by in orbit for your call." The filter here is ffmpeg standing in for the browser chain.

## Fit with the comms panel

The "Communications and chat log" thread owns the HQ comms panel. The voice plugs into it: each entry carries an optional `radio` object `{ text, level: routine | reroute | emergency, src: agent | hq | ship }`; a small `sol-radio.js` exposes `Radio.say(entry)` with its own off-by-default toggle, queue and filter. No second log.

Agreed with the comms thread (2026-10-20): entries are `{ id, src: hq|agent|you|system, t, text, radio? }`. The panel calls `Radio.say(entry)` for new entries with `radio`, only when `window.Radio` exists and `Radio.enabled()` is true. "you" and "system" lines are never voiced; for HQ answers only the fixed lead sentence is spoken, never the data rows.
