# TrackVid UI (Next.js + Veylix template) — Claude Instructions

This folder is the **new TrackVid web UI**: every TrackVid-FE screen rebuilt in Next.js 16 with the Veylix
template look. **UI only, not connected to any backend, separate from `../BE`.**

## Start of every session
1. Read `PROGRESS.txt` (counter, route statuses, decisions, log).
2. Read `MIGRATION_PLAN.md` §12 (autonomous rules) and whatever section the next step needs.
3. Continue with the next `PENDING` route. **Do not ask questions; decide and log the decision.**

## Sources (read only)
- Screens and behaviour: `/Users/apple/Documents/Sagar/Trackvid/TrackVid-FE/src`
- Look (CSS, markup, class names, icons): `/Users/apple/Documents/Sagar/Other/veylix-next/src`
  - Its files are `@ts-nocheck` conversions. Copy markup and class names, never the untyped code as is.
  - Next 16 has breaking changes. Check `/Users/apple/Documents/Sagar/Other/veylix-next/node_modules/next/dist/docs/` before using a Next API.

## Hard rules
- **No backend.** No axios, no `fetch` to an API, no SSE, no sockets. Data comes from `src/services/*-service.ts`
  (same function names and types as TrackVid-FE `src/api/*`) backed by `src/mocks/*`.
- **Never touch:** `../BE`, `../.env`, `../prompt.txt`, the TrackVid repos, the veylix-next folder.
- **No git commands that change anything** in the parent repo (no add, commit, checkout, stash, clean, reset).
  Another agent works on `../BE` in the same checkout.
- Strict TypeScript. No `any`, no `@ts-nocheck`, no `@ts-ignore`.
- No MUI, no emotion, no Tailwind, no other UI kit. Colours and spacing come from the template's CSS custom properties.
- Every `addEventListener`, `setInterval`, `setTimeout`, `URL.createObjectURL`, `AbortController` and subscription has cleanup.
- No `dangerouslySetInnerHTML` with unsanitized HTML (sanitize with DOMPurify).
- No silent `catch {}` without a comment saying why.
- Same URL paths as TrackVid-FE.

## Definition of migrated (per route)
Renders inside the shell with the template look · every sub-view, tab and dialog TrackVid has · loading, empty and
error states · mock services only · `npm run build` and `npm run lint` (0 warnings) pass.
Then update `PROGRESS.txt` (counter + status + log) **before** starting the next route.

## Stop condition
Only when every route in `PROGRESS.txt` is `MIGRATED` or `BLOCKED: <reason>` and the final report is written.
A step that fails 3 times → mark the route `BLOCKED`, move on.
