# Compact mobile flight details

User request: the flight inspector covers too much of the solar system on mobile. Make it compact and collapsible; no deployment. Follow-up to application integration `c05bc0b` on `codex/design-audit`.

At widths up to 760px, selecting a flight now opens a summary containing callsign, live status, route, Details and Close. The measured summary height is 84.19px at 320px, 360px and 390px widths. Full flight/manifest information is hidden until requested. Expanded details scroll within a 44vh/340px limit, and the disclosure header remains available to collapse them. Desktop keeps the full inspector.

The old mobile `.ov` rule used `!important` sizing that prevented the intended inspector height limit from applying. Removing those sizing overrides restores the component's own responsive constraints. Disclosure state survives updates and Follow rerenders, resets on a new selection, and restores appropriately across the mobile breakpoint. Hidden content is removed from keyboard navigation; Details exposes `aria-expanded`/`aria-controls` and supports Enter/Space. Focus on inspector actions is preserved when its HTML is refreshed. Arrival status updates both summary and expanded header.

This changes presentation only. Real booking IDs, manifests, live tracks, stored arcs, flight positions and clocks are unchanged. GSAP is used only for the revealed panel's short entrance and retains reduced-motion handling.

## Verification

**14 focused browser checks passed**, using the actual local Worker and existing connector records in the in-app browser. Includes compact default, expand/collapse, bounded scrolling, Follow rerender, keyboard Tab/Space/Enter, resizing, selection changes and dismissal. [Results and measured geometry](mobile-details-verification.json). One preliminary geometry observation was invalidated when the old selected flight was retired by live polling after a new verification run; the current selection was then checked successfully. This is recorded separately in the result, not counted as a passing check.

Screenshots: [390px compact](mobile-details-collapsed-390.png), [360px compact](mobile-details-collapsed-360.png), [expanded](mobile-details-expanded.png), [desktop](mobile-details-desktop-check.png). Mobile checks used viewport emulation rather than a physical phone. Browser error log was empty, three inline page scripts passed syntax parsing, and authored whitespace checks passed. The prior 145-unit/49-browser integration baseline was not rerun for this scoped presentation change.

The Design-owned local server was restarted after its previous process exited. Current process metadata is in `app-process.json`, retained for local review at http://127.0.0.1:8796/ with a 90-minute maximum lifetime. No deployment, remote merge/push, engine edit or Engineering checkout mutation was performed. Historical audit/prototype evidence remains intact.
