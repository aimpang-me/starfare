# Starfare production stack (2026-10-18)

What we use to make everything Starfare needs, in three lanes: development, marketing (copy, images, motion, 3D, audio, social, launch) and shipping (release, deploy, monitoring). Surveyed on main `ff66fbc`. Nothing here was deployed or posted, and no Cloudflare setting was changed.

The rules in `CLAUDE.md` ("Rules from Alvin") apply to every generated asset: no Tesla, SpaceX, Grok or xAI logos ("Works with Grok" text only), everything simulated is labelled simulated, and no number appears in copy, video or voice unless a tool produced it.

## What is ready now

Status: **ready** means checked in this session. **limited** means it works with a stated limit. **blocked** means it needs Alvin (see "Clicks only Alvin can make").

### Development

| Tool | Makes | Status |
|---|---|---|
| Repo suites (`CLAUDE.md` "Tests") | engine hazards, reroute, connector unit, e2e, Python regression | ready: hazards 8/8 and regression 20/20 run here after the setup hook |
| `.claude/hooks/session-start.sh` (new) | installs connector `npm ci` and the Python regression packages in every new cloud session, so any thread can run the suites at once | ready: runs in about 15 s, skips `npm ci` when `node_modules` is in sync, and does nothing on a local machine |
| GitHub Actions `sol-regression.yml` | Python regression gate on every push | ready; the connector job (gap 1) is added alongside this file |
| Claude Code skills | `engineering:*` (code review, debug, system design, architecture, testing strategy, tech debt, deploy checklist), `run`, `simplify`, `security-review`, `code-review` | ready |
| `connector/sim.mjs`, `connector/bench/*` | simulated seasons by policy, benchmark suites and verification | ready |
| Grok Bot connector | sends prompts to named Grok bots and reads replies (`list_bots`, `send_to_bot`, `check_inbox`): a way to playtest the MCP connector with real Grok once it is deployed | ready, not yet used for Starfare |

### Copy and documents

| Tool | Makes | Status |
|---|---|---|
| `marketing:*` skills | campaign plan, content, drafts, email sequence, brand review, SEO audit, competitive brief, performance report | ready |
| `design:ux-copy`, `product-management:*` | in-product wording, specs, roadmap and stakeholder updates | ready |
| Claude Docs, Google Docs, Notion | shared docs (spec, press notes, launch plan) | ready (Notion and Google Docs connected) |

### Images and design

| Tool | Makes | Status |
|---|---|---|
| `tools/media/capture.mjs` (new) | stills of the real pages at social sizes: og 1200x630, square 1080x1080, story 1080x1920, desktop, phone. The sky, fleet and flights are the engine's own simulated state, so no mock data is needed | ready: home and `/bench` captured here with no console errors |
| Canva | designs, `generate-image`, resize to every social format, export PNG/PDF/MP4, brand templates | ready; no Starfare brand kit exists yet (gap 5) |
| `artifact-design`, `anthropic-skills:canvas-design`, `theme-factory`, `dataviz` | posters, one-pagers, charts drawn in code | ready |
| ImageMagick, Pillow | batch resize, crops, contact sheets | ready in the container |
| Figma | read designs, FigJam diagrams, `generate_image`, shaders | limited: Alvin's seat on "Alvin Impang's team" is **View** on the Starter plan, so editing files needs a Full seat. Weave models (image, video) are blocked until his Figma account is linked to Weave |
| Mobbin | UI references for the Design team | ready |

### Motion and video

| Tool | Makes | Status |
|---|---|---|
| `tools/media/capture.mjs --video N` (new) | real footage of the live 3D map: MP4 (H.264) and GIF at any of the sizes above, trimmed to start on a drawn map | ready: 5 s og clip made here; sample in the project files at `marketing/captures/` |
| ffmpeg | cuts, titles, concatenation, captions, audio mix | ready in the container |
| HyperFrames by HeyGen | animated HTML videos and motion graphics, rendered in the cloud to MP4/WebM/MOV | limited: connected, but `compose` and `render_video` refuse Claude Code sessions. Use it from a claude.ai chat, or add the local skills here with `npx skills add heygen-com/hyperframes` (HTML compositions in the repo, rendered locally) |
| Canva | short social videos from templates; `import-claude-motion-from-url` takes motion made here | ready |
| Plugins in the directory, not installed | **video-shotcraft** (Remotion product videos with shot recipes and SFX), **animation-studio** (code-drawn animated shorts with a synthesized soundtrack, 16:9 or 9:16 MP4) | optional: worth adding for the launch trailer |

### 3D

| Tool | Makes | Status |
|---|---|---|
| `design/assets/sol-art.js` (three.js r128) | the Starseeker ship, atmospheres, bloom, HUD icons, all built in code; planet maps from NASA, USGS and Solar System Scope (`design/assets/CREDITS.md`) | ready, and the house approach: no licence risk and no binary model files |
| Figma `create_shader` | GLSL shaders for space effects | limited by the View seat |
| Blender (headless, `pip install bpy`) | modelling and glTF export when a real mesh is needed (cabin interior, new ship classes) | available on request: PyPI is reachable from the container; not installed |
| Text-to-3D generation | none found in the connector directory | gap 9 |

### Audio

| Tool | Makes | Status |
|---|---|---|
| ElevenLabs (connected, restricted) | speech in many voices and languages, voice design, **sound effects up to 30 s with seamless loops** (cabin hum, engine rumble, comms chirps), audio effects (radio and phone filters for dispatcher lines), transcription | ready. Costs Alvin's ElevenLabs credits per generation |
| Web Audio synthesis | UI ticks, chirps, alarms with zero bytes, per `/mnt/project-files/audio/audio-brief.md` | ready (code) |
| Music | none: the restricted ElevenLabs connector refuses music | gap 8 |

### Social, email and analytics

| Need | Status |
|---|---|
| Scheduling posts (X, Bluesky, Threads, LinkedIn) | none connected; Typefully suggested (gap 6) |
| YouTube and short-form research | vidIQ is installed but its sign-in never finished |
| Email list and launch announcement | none; Resend suggested |
| Web analytics on the public site | none; PostHog suggested |

### Shipping

| Tool | Makes | Status |
|---|---|---|
| `connector/DEPLOY.md`, `npm run dry-run` | the deploy recipe and a dry-run bundle | ready; a real deploy still needs Alvin's go in the session |
| Cloudflare connector | reads Workers, KV, R2, D1 in Alvin's account (Workers list read here: `starfare`, the old `sol-connector` and 8 unrelated Workers) | ready, read-only use only |
| `engineering:deploy-checklist`, `anthropic-skills:pre-ship` | pre-deploy checks | ready |
| Error tracking, logs, uptime | none: `wrangler.jsonc` has no `observability` block and nothing reports errors | gaps 3 and 4 |
| Releases | no tags, no GitHub releases, no changelog; deploys are recorded only as Worker version ids in docs | gap 10 |

## Gaps, in the order to close them

1. **Connector suites in CI.** Until now only the Python regression ran on push. The PR that added this file applies `audit/connector-ci.patch`: a `connector` job runs `npm test` (unit and local e2e) on Ubuntu and Windows.
2. **Network for browser checks.** The cloud container's network policy refuses `cdnjs.cloudflare.com`, `cdn.jsdelivr.net` and `starfare.aimpang.workers.dev`. `capture.mjs` works around the first two by serving three r128 from npm (the same bytes, so SRI still matches). Live-site smoke tests need those hosts allowed in a cloud environment for this project.
3. **Worker observability.** Add `"observability": { "enabled": true }` to `connector/wrangler.jsonc` so Workers Logs keeps request logs and exceptions. It only takes effect on a deploy, so it waits for Alvin's go.
4. **Error tracking.** Sentry for Worker exceptions and page errors on the map and flight pages (suggested connector, so threads can read issues).
5. **Brand kit.** No Canva brand kit exists. Make one from Design F (`connector/src/site.html` tokens: colours, Rajdhani, JetBrains Mono, Inter) so every Canva design starts on brand. The Design team should first write Design F into `docs/DESIGN.md`, per its brief.
6. **Social and launch distribution.** Typefully for drafts and scheduling, Resend for the launch email list. Nothing is posted or sent without Alvin's word on that post.
7. **Favicon, social preview and meta tags.** None of the public pages has a favicon, `og:image` or `twitter:card`. `capture.mjs` makes the 1200x630 card; adding the tags to `site.html`, `flight.html` and `bench.html` is a page change that ships with the next deploy.
8. **Music.** Add the full ElevenLabs connector as a custom connector (`https://api.elevenlabs.io/v1/mcp`) if music or an ambient theme is wanted. The audio brief recommends no music for now.
9. **3D generation.** No text-to-3D connector exists in the directory. Recommendation: keep ships procedural in `sol-art.js`; use headless Blender for any mesh that code can't reasonably build; check Figma Weave's model list once it is linked.
10. **Release process.** Tag each deploy (`worker-<version-id>`) with a GitHub release that names the engine sha, suite cut and score version, and keep a `CHANGELOG.md`. A `staging` Wrangler environment (a separate `starfare-staging` Worker) would let threads check a build on Cloudflare before production; creating it is a Cloudflare change and needs Alvin's go.
11. **Trademark check on "Starseeker"** before launch (open item from the Art team).
12. **Launch kit.** Press page with captures and credits, the Day 7 video (decided for after the next deploy), landing copy reviewed with `marketing:brand-review`, and a short social calendar.

## Which team uses what

| Team thread | Main tools |
|---|---|
| Engineering | repo suites, setup hook, CI, `engineering:*`, Cloudflare (read), Sentry once connected |
| QA | suites, `sim.mjs`, Playwright, `capture.mjs` for screenshots at every size, Grok Bot for real-Grok playtests after a deploy |
| UI & Design | `design:*`, Figma (read; edit needs a Full seat), Mobbin, artifacts, Canva brand kit |
| Art | `sol-art.js`, canvas-design, Canva `generate-image`, ImageMagick, Blender on request |
| Audio | ElevenLabs SFX and voice, Web Audio synthesis, full ElevenLabs for music if wanted |
| Game Design | `sim.mjs`, bench stats, `product-management:*` |
| Marketing (no thread yet) | `marketing:*`, `capture.mjs`, HyperFrames, Canva, ffmpeg, Typefully, Resend, PostHog |

## Clicks only Alvin can make

- Allow `cdnjs.cloudflare.com`, `cdn.jsdelivr.net` and `starfare.aimpang.workers.dev` for this project's cloud sessions (Project settings, Cloud environment, Add cloud environment, Network access).
- Connect the suggested connectors he wants: Sentry, PostHog, Typefully, Resend; finish vidIQ's sign-in.
- Link Figma to Weave (app.weavy.ai, profile settings) and decide whether a Full Figma seat is worth it.
- Add the full ElevenLabs connector only if music is wanted.
- Give the go for the next deploy, which can carry the observability block, meta tags and the new benchmark key.
