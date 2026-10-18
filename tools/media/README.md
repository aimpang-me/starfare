# Capture real application views

This package runs outside the Worker. It captures the actual simulated application; label exported media as simulated. It does not generate flight data or deploy anything.

From this folder, install the locked packages with `npm ci`, then install the browser with `npx playwright install chromium`. Linux may also need `npx playwright install-deps chromium`. MP4/GIF export additionally needs `ffmpeg` on PATH.

```powershell
node capture.mjs --page / --sizes desktop,phone
node capture.mjs --page / --sizes og --video 5
node capture.mjs --base http://127.0.0.1:8796 --page /bench --sizes phone
```

The default starts a loopback Worker with temporary local storage and OAuth off. `--base` uses an existing service, which remains owned by whoever started it. Never point captures at a live service without permission. Output and the provenance/error manifest go under ignored `out/`; inspect both before sharing media. No posting or publication is performed.

Owned Worker cleanup runs on startup failure, browser-launch failure, capture failure and normal completion, even if browser closing fails. It uses the shared Windows/POSIX process-tree helper and retries temporary-storage removal asynchronously. A storage-removal warning retains the exact directory for later inspection. SIGINT/SIGTERM request owned Worker cleanup; forced operating-system termination cannot run cleanup handlers. Verify process and port exit after interrupted runs.

During the Monday handoff, a real Worker was started with Chromium deliberately unavailable. The command failed as expected, left no owned Worker process, and removed its new temporary storage. The handoff receipt records the actual verification; this is not a claim about every browser/device or GPU.
