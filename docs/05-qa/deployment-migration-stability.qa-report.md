# QA Report: Deployment and Migration Stability

> **Date**: 2026-09-24
> **Feature**: R05, R16, R17

## Verified behavior

- Deployment readiness requires a live Discord connection, a successful DB probe, and `ready` state for all three policy caches. The container health check expires when that signal stops refreshing.
- The target image checks required schema version 1 against actual database tables and columns before the old container is stopped. Missing columns block deployment.
- The deployment script preserves the old container until the candidate reports healthy. A running but unready candidate times out and restores the old one.
- The container simulation covers SIGKILL after stopping the old container, after backup rename, after candidate rename, and after candidate start. Re-executing the script recovers and completes with exactly one running bot.
- The schema preflight uses the actual Bun output path, `dist/db/checkSchema.js`. A failed backup rename stops recovery before any second container start.
- Successful deployments remove the previous image and prune dangling images. A stalled DB probe times out after two seconds, and the readiness timestamp is replaced atomically.

## Local verification

- `NODE_ENV=test DISCORD_TOKEN=test DISCORD_CLIENT_ID=123 DATABASE_URL=file::memory: SINK_BASE_URL=https://sink.example SINK_API_TOKEN=test bun test test/deploymentReadiness.test.ts test/deploySimulation.test.ts` — 12 pass
- `NODE_ENV=test DISCORD_TOKEN=test DISCORD_CLIENT_ID=123 DATABASE_URL=file::memory: SINK_BASE_URL=https://sink.example SINK_API_TOKEN=test bun test` — 202 pass
- `bun run typecheck`
- `bun run build`
- `bun build src/db/checkSchema.ts src/healthcheck.ts --outdir /tmp/snipsik-pr42-build-check --target bun` — confirmed `db/checkSchema.js` output
- `bash -n scripts/deploy.sh`
- `git diff --check`

The container switch was exercised with a Docker command simulator. A live GCP VM, Turso, and Discord deployment cannot be exercised locally.

The bkit pre-release scanner reported one critical issue because this application does not contain a `bkit.config.json`. Its config scanner is designed for bkit projects (`lib/`, `hooks/`, and `servers/` JavaScript), not this TypeScript bot. The other four scanners reported zero issues; the application checks above passed.
