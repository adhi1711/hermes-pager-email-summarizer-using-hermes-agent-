# HERMES PAGER — Implementation Plan

Single backend (Express 5 + SQLite) and single Hermes analysis engine shared by
two distinct frontends: the main **HERMES website** and the standalone **Pager**.

## Stage Status

- **Stage 0 — Routing fix:** COMPLETE. `/pager` renders via its own layout route
  (`PagerLayout` now renders `<Outlet />`); no main-site navigation.
- **Stage 1 — Backend correctness & security fixes:** COMPLETE (awaiting
  verification sign-off). Scope was limited to data-flow/security correctness;
  no UI work and no redesign.
  - C8 — `GET /api/connections` no longer returns decrypted refresh tokens.
  - C2/C5 — email field mapping fixed (`findById`/`getEmail` join
    `email_analysis`, return the frontend camelCase shape incl. `analyzedAt`,
    `errorCode`); Hermes prompt now receives real `senderName`/`subject`/`bodyText`.
  - C4 — `userSettings` normalized to camelCase end-to-end (pager deadline window
    no longer dropped).
  - C7 — Hermes request bounded by `HERMES_TIMEOUT_MS`; stale `processing`
    analyses auto-recover; partial analysis updates preserve prior successful
    results on re-analysis.
- **Stage 2 — Pager identity (compact device):** COMPLETE (awaiting sign-off).
  - Step 1 (backend snooze): added `pager_snoozes` table + `repositories/pagerSnoozes.js`,
    exported via `repositories/index.js`; added authenticated
    `POST /api/pager/:emailId/snooze` and `DELETE /api/pager/:emailId/snooze`;
    active snoozes excluded from the feed and eligible again on expiry; server-side
    ownership (404) + duration validation (400); duplicate snoozes upsert safely.
  - Step 2 (frontend wiring): `pagerApi.snooze/unsnooze`; `Pager.jsx` wires real
    snooze, preserves acknowledge/dismiss + open, shows loading/error feedback,
    refetches only after the API result.
  - Step 3 (UI): `PagerLayout.jsx` device chrome + compact pager interface
    (priority chips, sender, time, deadlines, Ack/Snooze/Open). No ASCII decoration.
- **Stage 3 — Website ASCII editorial design:** PENDING (separate stage; not started).
- **Stage 4 — Hermes verification:** PENDING (requires running gateway).
- **Stage 5 — Verification:** PENDING.

## Design Identities (corrected 2026-10-09)

The ASCII aesthetic belongs to the **main website**, NOT the Pager.

### HERMES website

ASCII-inspired, monochrome editorial/technical design language applied to:
landing, login/signup, dashboard, inbox, email detail, settings. Use purposeful
ASCII motifs, technical typography, grid lines, structured labels,
black/white/grayscale, and restrained Hermes Orange `#FF5A1F`. Feel like a
distinctive designed website — not a generic SaaS dashboard and not an entirely
fake terminal.

### HERMES Pager

A different visual identity. Resemble a compact digital messaging pager:
small-screen-inspired layout, concise message previews, prominent urgency
indicators, sender, timestamp, deadlines, and simple
acknowledge / snooze / open actions. Optimize for readability and quick
scanning. Do **not** apply heavy ASCII decoration or the website's editorial
layout to the Pager.

## Architecture Constraints

- Main website and Pager remain distinct interfaces.
- `/pager` uses its own standalone layout without main-website navigation.
- Both interfaces share the same backend, email data, and Hermes analysis engine.
- Do not duplicate business logic or break the Stage 0 routing fix.

## Notes / Deferred

- Stage 1 was implemented before the design correction; the correction affects
  only the design stage (2/3) and does not change Stage 1 backend work.
- Stage 2 added minimal, additive backend support for the Pager's snooze action
  (new table + two endpoints) so the UI action is genuine rather than simulated.
- Still pending: main-website ASCII identity (Stage 3) and frontend bugs F1–F12.
- Out of scope so far (later): C1/C3/C6, dead root `backend/server.js`, leftover
  auth debug logging, unused deps.
