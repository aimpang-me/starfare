# Next steps for whoever picks this up (2026-10-16)

Read `CLAUDE.md` first. Its "Rules from Alvin" section applies to everything below.

## Where things stand
- Design F is live. Main is at 4537087, pushed and deployed as Worker version ff7f8356 at https://starfare.aimpang.workers.dev/. It runs engine c5fdd816, and suite v1 is re-cut for that engine.
- Checked on the live site: there is no "Roadster" text, and all 21 planet and moon textures return 200.
- Tests on main: 69 of 69 unit, 41 of 41 e2e, 8 of 8 hazards and 8 of 8 reroute.

## Open follow-ups
- Update `CLAUDE.md` "Open items" and `docs/WEBSITES.md` to say Design F is live. They still describe mockup D as "on main, not deployed".
- `/engine.js` still contains `name: "Tesla Roadster"` in the engine's place list. The pages filter it out, but removing it means editing `world/engine/`, re-bundling, and re-cutting suite v1 because the engine sha changes. The re-cut needs the private bench key; never print or commit it.
- Log & Reports lists flight logs where the mockup shows a scoreboard receipt, because `/board.json` has no receipt feed yet.

## Leave alone unless Alvin says
- Branch `claude/nice-albattani-90f2cb` (2fbc7e7) is an engine change that would also need a suite re-cut.
- Old sessions and worktrees. Alvin declined archiving them.
- The old Worker `sol-connector`.
- The uncommitted `kit:` export line in `.claude/worktrees/focused-lovelace-afac7e/design/assets/sol-art.js`.
