# Screenshot guide

All captures are from 17 October 2026. Dynamic sky dates and event counts vary. Full-page images can be opened at native size to inspect small text.

| Capture | Build / scenario | What it demonstrates |
|---|---|---|
| [Desktop operations](screenshots/main-desktop.png) | exact origin/main, 1440×1000 | Design F identity, empty-flight weight, lower activity panels |
| [Phone home](screenshots/main-phone.png) | exact main, 390×844 mobile/touch emulation | 980px layout shrunk to 0.398 scale; image width itself is layout width |
| [Small phone](screenshots/main-phone360.png) | exact main, 360×800 mobile/touch | Same viewport failure |
| [Tablet](screenshots/main-tablet.png) | exact main, 768×1024 mobile/touch | Same 980px layout |
| [Intended narrow layout](screenshots/A-main-phone-css-390.png) | exact main, 390 CSS-pixel desktop resize | Stacking works when breakpoint activates; feed buried |
| [Connect dialog](screenshots/main-connect-dialog.png) | exact main | Keyboard trace proves focus can escape behind this scrim |
| [Open bookings](screenshots/main-bookings.png) | exact main | Booking tab and engine preview structure |
| [Feed detail](screenshots/main-feed-detail.png) | exact main | DESK and SKY sources, small timestamps, Flight legend |
| [Live API error](screenshots/main-live-service-error.png) | exact main, browser-only 503 interception | Unavailable live service shown as no flights |
| [No WebGL](screenshots/main-no-webgl.png) | exact main, browser-only WebGL unavailable | Useful text fallback retained |
| [Reflow equivalent](screenshots/main-200pct-equivalent-reflow.png) | 720×500 desktop viewport | Layout equivalent to 1440px at 200%, not text-only zoom |
| [Board](screenshots/main-board.png) | exact main, empty local data | Light-by-default shell and stale copy |
| [Bench](screenshots/main-bench.png) | exact main, no session | Readable connection/practice instructions |
| [Method](screenshots/main-method.png) | exact main | Method and scoring disclosures |
| [Missing flight](screenshots/main-flight.png) | exact main, valid-format absent run | 404 recovery presentation |
| [Fixture flight desktop](screenshots/fixture-flight-desktop.png) | exact main + committed Phobos record via browser interception | Receipt/replay layout, clearly marked AUDIT FIXTURE |
| [Fixture flight phone](screenshots/fixture-flight-phone.png) | same fixture, 390×844 mobile/touch | Flight viewport works; long receipt/tables |
| [Deployed home](screenshots/A-home-desktop.png) | deployed, 1440×1000 | Production comparison; older engine |
| [Deployed phone](screenshots/A-home-phone-device.png) | deployed, mobile/touch | Missing viewport also affects production |
| [Deployed board](screenshots/A-board-desktop.png) | deployed | Older /100 scoring and absent linked run |
| [Deployed bench](screenshots/A-bench-desktop.png) | deployed | Existing practice onboarding |

Assessment B's evidence/b-*.png images use desktop-pointer resizing. Files named *-overlay.png document failed overlay injection, not successful overlays. Do not use them as proof that an overlay was rendered.

No live agent run was created. Public live data showed zero flights; no public board flight link was available. Fixture images are not production-run evidence.

