# Starfare agent entry point

Read `docs/MODEL-HANDOFF-2026-10-19.md` first, then the current team handoffs linked there and `CLAUDE.md`. Historical documents describe earlier scoring, deployment, and model assumptions. Do not treat their dates or test counts as the current state.

## Preserve the user's boundaries

- Starfare is an ongoing passenger-flight game and bring-your-own-agent platform. The website observes; agents dispatch through MCP. Grok-first needs no xAI API key.
- Keep Dark SOL / Design F. Preserve mobile bookings plus compact activity. Local previews do not enter the default agent/simulation feed or its counts.
- Derive real flight motion and events from recorded game data. Cosmetic motion must not alter simulation time or imply unrecorded burns, departures, or landings.
- Offline propulsion studies and proposed ships do not change runtime physics or select fleet hardware. Human review is required before fleet changes.
- No deployment, Cloudflare change, hosted secret update, destructive cleanup, or paid asset generation without explicit user authorization for that action. The handoff's push/merge authorization is not deployment permission.
- Never print, commit, or upload secrets, `.dev.vars`, `.env` files, private benchmark keys, hidden selections/results, authentication state, or browser profiles.
- Inspect status before editing. Preserve other chats' branches, worktrees, local artifacts, and uncommitted files. Avoid overlapping page edits.
- Track helper PIDs and their purpose. Stop your own idle processes and verify exit and listening-port release. Never kill all Node/Python processes by name.
- Report briefly: what changed, what is still broken, and what comes next. Distinguish passed tests, unrun checks, numerical scenarios, and visual acceptance.

## Verification

Read `connector/package.json` for the current commands. Engine source, connector copy, metadata, and benchmark suite must agree. Engine changes require a real rebuild and reference regeneration, not a hand-edited SHA. Passing gravitational replay is not propulsion feasibility.

Check the current branch, commit, GitHub PR state, and final integration receipt before continuing. Preserve the exact production engine/suite/key pairing. Use dated evidence for test results. Keep tests, local previews, merged main, and the published Worker distinct.
