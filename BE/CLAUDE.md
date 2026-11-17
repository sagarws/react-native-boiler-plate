# TrackVid-BE (NestJS + Fastify) — Claude Instructions

This folder (`react-native-boiler-plate/BE`) is the **new** TrackVid backend: a port of the Express app at
`/Users/apple/Documents/Sagar/Trackvid/TrackVid-BE` ("legacy") to NestJS on the Fastify adapter.

## This repo (read first)
- The git root is the parent folder `react-native-boiler-plate`. **All backend work happens inside `BE/`.**
  - `../FE/` is a sibling frontend folder. Don't touch it.
  - `../prompt.txt` belongs to an unrelated project (Veylix Next.js rebuild). Ignore it; don't follow it, edit it or delete it.
  - `../.env` is leftover React Native config containing Google Drive secrets. Don't read it, overwrite it or delete it.
- **Base branch: `nestjs`.** Create module branches from it (`migrate/<module>`) and merge them back into `nestjs` locally. Never commit to `main` or to the other branches (`veylix-react-ecommerce-admin-dashboard-template`, `dev`).
- The Nest app's config goes in `BE/.env.development.local` (gitignored by the root `.gitignore` pattern `.env.*`). Commit a `BE/.env.example` with key names only.
- Never print or commit secrets. The `origin` remote URL may contain a token, so never echo `git remote -v` output or `.git/config` into files, logs or reports.

## Start of every session
1. Read `PROGRESS.md`: current phase, next unfinished item, session log.
2. Read the parts of `MIGRATION_PLAN.md` that the work needs (always §3 compat checklist + §6 per-module procedure).
3. Before porting a module, read its legacy routes/controllers/middleware in the legacy repo, and check for new legacy commits on that module.

## End of every session
Update `PROGRESS.md` (statuses, notes, decisions log, session log with "next step") before stopping.

## Autonomy: work on your own, using the plan's recommendations
The user wants this migration to run with as little supervision as possible.
- **Don't ask; decide.** For any choice the plan already recommends, use that recommendation: NestJS + Fastify, code-sharing option A (git submodule at `BE/legacy`), module order from §5, compat solutions from §3. For a choice the plan doesn't cover, pick the option that keeps the API contract identical and is easiest to roll back. Record every decision in `PROGRESS.md` → Decisions log, with a one-line reason.
- **Keep going.** After finishing a module (contract tests green, `npm run build && npm test` green, committed on a feature branch), move to the next unfinished module in `PROGRESS.md` without waiting to be told.
- **Verify yourself.** Run the build, the tests and the contract harness yourself. Never report something as done without running them. If something fails, fix it and re-run. Escalate only after 3 failed attempts at the same problem.
- **Stop and ask only for:**
  1. any `git push` or PR creation (needs explicit permission each time),
  2. any change to the legacy repo (`/Users/apple/Documents/Sagar/Trackvid/TrackVid-BE`),
  3. anything that would touch prod data or a prod `.env` target,
  4. a real contract difference that can't be reproduced exactly (the client must decide),
  5. missing infrastructure (no local/staging Mongo or Redis, missing credentials),
  6. nginx / deployment / cutover steps (the user does these).
  When blocked on one of these, write the question in `PROGRESS.md` → Session log under "Blocked", then continue with any other module that isn't blocked.
- **Context:** after each module, update `PROGRESS.md` first, so a context reset or a new session loses nothing.

## Hard rules
- **The API contract must not change.** Same paths, methods, status codes, JSON body shapes, headers, and socket events as legacy. No renames, no removals, no "cleanups" during the port.
- **Do not import legacy worker, cron or socket-init files** into this app until Phase 6 / Phase 5 say so. Running them in both processes duplicates every job.
- No Fastify response schemas during the port (they strip fields).
- Legacy `CLAUDE.md` rules still apply here: auth tiers (`systemAdminAuth + adminOnly` for destructive/cross-company), name the index for every query, no platform `switch` outside `automationRouting.ts`, platform code in `platforms/<platform>/`.
- Never run write tests against prod. Check `.env` for prod targets first.
- Git: never commit on or push to `main`. Work on feature branches. Every push needs explicit permission in the current conversation.
- Do not modify the legacy repo except via a feature branch + PR the user approves (e.g. extracting a pure function from a service that takes `req`/`res`).
