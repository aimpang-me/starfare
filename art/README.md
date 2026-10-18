# Starfare art transfer

Start with [the Art handoff](handoff-2026-10-19/README.md). It distinguishes original paintings, local procedural models, historical tests, and the blocked Higgsfield generation.

Git contains the sanitized source scripts, specs, prompts, manifests, small review HTML/JSON files, four original concept paintings, and the isolated Kestrel upload reference. `handoff-2026-10-19/git-entries.json` lists the selected archive entries. Large GLBs, sprites, textures, screenshots, and embedded offline previews are in the complete sanitized archive. No completed Higgsfield-generated GLB exists in this package.

## Restore the complete asset pack

Download `art-artifacts-sanitized.zip` from the repository's draft handoff release tagged `handoff-2026-10-19`. Authentication to the private repository is required. The final model handoff links the release.

```powershell
gh release download handoff-2026-10-19 --repo aimpang-me/starfare --pattern art-artifacts-sanitized.zip --dir <empty-download-folder>
Get-FileHash -Algorithm SHA256 -LiteralPath <downloaded-archive>
```

Expected SHA-256: `9bcc14890c71146b770e268b37e8222bfd1f6b16a8a0c3993328df2499b8f590`.

The archive has 297 verified entries and is 262,796,036 bytes. Extract into a new directory first. Its paths start with `2026-10-17/` and `handoff-2026-10-19/`. Inspect and compare before copying into an existing `art/` directory; do not overwrite local edits blindly. Review each version's README before running its renderer or rebuilding models.

All 319 original source files remain at `C:\Users\PC-AIMPANG\Documents\ChatGPT\Starfare\art\2026-10-17`. The archive includes 293 source assets and four handoff files. It excludes 26 files: duplicate legacy ZIPs, account/discovery data, raw process logs and ownership records, and generated application snapshots. Reasons and source hashes are recorded in the artifact manifest. Excluded originals are preserved locally. Sanitized report copies can differ from originals; the manifest records both hashes.

The `.gitattributes` rule preserves art bytes instead of normalizing transferred text. The archive is the complete transfer source, and `release-entries.json` records the asset-entry hashes. The original SHA256SUMS file also names the local archive and handoff metadata. Keep the ZIP outside Git.

No fleet asset selection, production GPU budget, final visual acceptance, deployment, or paid generation is implied by archiving these files.
