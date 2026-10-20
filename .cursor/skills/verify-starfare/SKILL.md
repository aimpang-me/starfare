---
name: verify-starfare
description: Prove Starfare with the engine hazard and reroute checks, the connector unit tests, the connector e2e, the sol-regression suite, and a read-only check of the public site. Use when asked to verify Starfare, prove it works, or before saying a Starfare change is done.
---

# Verify Starfare

Prove the checkout and the public site with the commands below. Quote each command's own output. Do not invent a count, a score, or a sha.

This folder is the whole skill. The live check is `check-live.mjs` next to this file.

## Launch

The hazard check, the reroute check, the connector unit tests, and sol-regression are single commands. They do not leave a server running.

The connector e2e starts `wrangler dev` on `127.0.0.1` and stops that process. Ready means a log line `wrangler dev up at http://127.0.0.1:` and a port. Do not deploy. Do not change Cloudflare. Do not point wrangler at the public host.

The public site is already at `https://starfare.aimpang.workers.dev/`. The live check only reads it.

## Doctor

From the repo root, run:

```
node .cursor/skills/verify-starfare/check-live.mjs
```

Run this first when the question is whether the public site matches this checkout. The script sends a User-Agent header. A client that omits that header gets HTTP 403 and the body `error code: 1010`. That 403 is the client, not a down site. Retry with the script.

The script exits 0 only when the last line is `0 failed`.

## Drive

Run these from the repo root. A failure in one command does not skip the others. The e2e command needs the connector install and build from the unit step. If that step fails, say the e2e was not run, and why.

### Hazards

```
node world/engine/test-hazards.js
```

Pass is a final line `8 passed` and exit 0.

This proves the simulated hazard checks in `world/engine/test-hazards.js`. It does not prove rendering. It does not prove a real MCP ride via OAuth. It does not prove the deploy version.

### Reroute

```
node world/engine/test-reroute.js
```

Pass is a final line `8 passed` and exit 0. The run also prints one hindsight line. Quote that line. The file does not use that count as its pass gate.

This proves the checkpoint checks in `world/engine/test-reroute.js`. It does not prove rendering. It does not prove a real MCP ride via OAuth. It does not prove the deploy version.

### Connector unit tests

```
cd connector && npm ci && node build.mjs && node --test test/*.test.mjs
```

`npm ci` can print `EBADENGINE` warnings. Those warnings are not a failure. Pass is exit 0 and a TAP footer with `# fail 0`, `# skipped 0`, `# cancelled 0`, and `# pass` equal to `# tests`. Quote the `engine copied:` line from `node build.mjs`.

This proves the Node tests matched by `connector/test/*.test.mjs`. It does not prove rendering. It does not prove a real MCP ride via OAuth. It does not prove the deploy version. It does not prove `wrangler dev`.

### Connector e2e

```
cd connector && node test/e2e.mjs
```

Pass is exit 0 and a final line of the form `N of N checks passed`, with both numbers taken from that run and equal to each other. Also quote the `off:` line and the `on:` line above it.

The test runs OAuth off, then OAuth on, against the `wrangler dev` it started. If a long haul is refused at the end of the 7000 second season, rerun the same command. `CLAUDE.md` calls that window about the last 7 real minutes. `connector/test/e2e.mjs` calls it the last minute of the season. Do not treat one season-end refusal as a product bug until a second run fails the same way.

The OAuth on phase uses a throwaway bench key inside the test. Do not print environment variables or tokens.

This proves local `wrangler dev`, including a 401 when local `/mcp` has no token. It does not prove rendering of the public site. It does not prove a real MCP ride via OAuth on `https://starfare.aimpang.workers.dev/`. It does not prove the deploy version.

### sol-regression

Install the packages named in `.github/workflows/sol-regression.yml` when they are missing. Do not commit them.

```
pip install numpy scipy jplephem skyfield-data
python3 day3/run_regression.py
```

GitHub Actions calls `python`. Use `python` when it exists, and `python3` when it does not. Do not pass `--update`. That flag rewrites goldens. Do not pass `--plant` on a proof run. That flag is a self-test that must go red.

Pass is a final line `20/20 cases pass` and exit 0.

This proves planner drift, provenance, and the n-body gate for the cases in `day3/cases.json`. It does not prove rendering. It does not prove a real MCP ride via OAuth. It does not prove the deploy version. It does not prove the ride-hail engine checks.

### Public site

```
node .cursor/skills/verify-starfare/check-live.mjs
```

Pass is exit 0 and a last line `0 failed`. The expected engine prefix is the first 16 hex characters of `sha256` in `connector/src/engine/meta.json`. The script reads that file. Do not type the prefix from memory.

Quote the script's PASS lines. Flight counts and board ids change between runs. Do not reuse an older run's ids or `now_ms`.

The script does not prove rendering. It does not prove a real MCP ride via OAuth. It does not prove the deploy version. A matching prefix means the home page's engine query matches this checkout's `meta.json`. It does not mean the Worker build, the HTML, or the other routes are this commit.

Do not request `/rides/` or `/flight/` with an id you made up. Do not send a token to `/mcp`. Do not call a tool that starts a ride.

## Evidence

Put the proof in the report. For each command, copy the summary line and the exit code from that run. Copy the live script's PASS lines and its three limit lines.

A report that only says the checks passed is incomplete. End the report with these three sentences.

These checks do not prove rendering.

These checks do not prove a real MCP ride via OAuth.

These checks do not prove the deploy version.

## Cleanup

The e2e test stops the `wrangler dev` process it started. If you interrupt it, stop the pid bound to the printed `127.0.0.1` port. Do not kill every `node` process, and do not kill every `wrangler` process.

Do not commit `connector/node_modules`, `connector/public`, command logs, or secrets.

The proof stays in the report. Cleanup does not delete the report.

## Shipped text

Apply these rules to any text you ship, including the report.

Label simulated riders, fleet, weather, traffic, and fares as simulated. Planet positions are real. They come from NASA JPL DE421.

Every number comes from a tool, a command, a response, or a file you opened on this run.

No Tesla, SpaceX, Grok, or xAI logos. The words Works with Grok are text, not a logo.

Do not mention Roadster. Do not say car.

Do not use an em dash or an en dash.

## Recorded run

These lines are from one run on 2026-10-17 against main `ab0b4c9`. They are a record of that run. A later proof quotes its own terminal. It does not copy this section into the report as if it had just been run.

- Hazards printed `8 passed` and exited 0.
- Reroute printed `hindsight lowered par on 10 of 100 hails`, then `8 passed`, and exited 0.
- `node build.mjs` printed `engine copied: 533482 bytes, sha256 c5fdd816d464827c…, sky {"t0_ms":1792108800000,"jd0":2461329.5,"len_days":7000}`.
- Connector unit tests printed `# tests 69`, `# pass 69`, `# fail 0`, `# skipped 0`, `# cancelled 0`, and exited 0. Node was v22.14.0. `npm ci` printed `EBADENGINE` warnings and still exited 0.
- Connector e2e printed `off: 24 of 24 checks passed`, `on: 17 of 17 checks passed`, and `41 of 41 checks passed`, and exited 0.
- sol-regression printed `20/20 cases pass` and exited 0. The binary was `python3`.
- The public home page referenced `/engine.js?v=c5fdd816d464827c`. That prefix is the first 16 hex characters of `sha256` in `connector/src/engine/meta.json`. `GET /engine.js` returned 533482 bytes, the same as `bytes` in that file. `GET /live.json` returned `simulated` true, `flights` length 0, and `now_ms` 1792214276247. `GET /board.json` returned label `planned by Grok bot`, best ids `ceres-shift`, `phobos-commute`, and `titan-home`, and stats keys `leg_miss`, `runs_scored`, and `terms_miss`. `POST /mcp` with no token returned 401 and `www-authenticate: Bearer realm="OAuth", resource_metadata="https://starfare.aimpang.workers.dev/.well-known/oauth-protected-resource/mcp"`. `GET /`, `/board`, `/bench`, `/live.json`, `/board.json`, and `/engine.js` returned 200.

## Upkeep

When the engine sha or a test command changes, re-run the commands and update this folder. The later upkeep pass is `/maintain-verification-skill`. That pass edits this folder only, not product code.
