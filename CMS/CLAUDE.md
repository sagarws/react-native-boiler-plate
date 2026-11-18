# TrackVid CMS — Veylix UI migration — Claude Instructions

This folder is a copy of the TrackVid CMS Electron app (`/Users/apple/Documents/Sagar/Trackvid/TrackVid-CMS`)
being re-dressed in the **Veylix template look** (`/Users/apple/Documents/Sagar/Other/veylix-next`).
**Only the UI changes. The technology (Electron, React, MUI, Emotion, Tailwind, electron-vite) and every
behaviour stay the same.**

## Start of every session
1. Read `PROGRESS.txt` (counter, unit statuses, decisions, log).
2. Read `MIGRATION_PLAN.md`: always §0, §3, §5, §6, §8, plus the section the next step needs.
3. If `CLAUDE.TRACKVID.md` does not exist yet, Phase 0 (C1) has not run; do it first.
4. Continue with the first `IN PROGRESS` or `PENDING` item. **Do not ask questions; decide and log the decision.**

## The app's own rules still apply
@CLAUDE.TRACKVID.md

**One override:** wherever `CLAUDE.TRACKVID.md` says Vercel's design language is the reference (UI/UX section,
`vercelTheme.ts`), read **Veylix** and `theme/veylixTheme.ts` instead. Every other rule in it is binding:
MUI + Tailwind only, no raw colours in components, vendored trees not edited, renderer never reaches Node or
Electron, no silent dependencies, no version bumps.

## Hard rules for this migration
- Change files under `electron/renderer/**` (plus `tests/*Theme*.test.ts`, `docs/veylix-tokens.md`, and the
  vendored Manrope font). `electron/main`, `electron/preload`, `shared/`, `packages/` and build config stay unchanged.
- **Never run real work:** no login, no automation, no claim, no backup, no email reply, no session capture.
  No `.env` with real values. Never target `api.trackvid.in`. UI checks use the preview, `npm run verify` and
  `npm run test:e2e`.
- **No git commands that change anything** (no add, commit, checkout, switch, stash, reset, clean, push). The parent
  repo is shared with an agent working on `../BE`.
- Never edit `../BE`, `../FE`, `../.env`, `../prompt.txt`, `/Users/apple/Documents/Sagar/Trackvid/*` or `veylix-next`.
- Take every visual value from the template CSS (recorded in `docs/veylix-tokens.md`); never from memory.

## Definition of migrated (per unit)
Template look in light and dark · behaviour unchanged · `npm run verify` green (or only baseline failures) ·
`PROGRESS.txt` counter + status + log updated **before** the next unit.

## Stop condition
Only when all 56 units are `MIGRATED` or `BLOCKED: <reason>`, Phase 3 is done, and the final report is written.
A step that fails 3 times → mark it `BLOCKED`, move on.
