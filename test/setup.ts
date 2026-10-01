/**
 * Preload guard for `bun test`, wired via `bunfig.toml`'s `[test] preload`.
 *
 * `bun test` auto-loads the local `.env` *before* this file runs, so a real
 * production `libsql://` URL can already be present in `process.env`. That value
 * must never reach `@/db`, which calls `createClient()` at module load: any test
 * file importing `@/db` would then open a connection to a real database.
 *
 * This guard runs before any `src/` module is imported, so the failure happens
 * at module-load time rather than surfacing later as a corrupted production
 * database. It is a second line of defence; `src/config.ts` independently forces
 * an inert URL under `NODE_ENV=test`.
 *
 * Only `DATABASE_URL` is checked. `TURSO_DATABASE_URL` is deliberately ignored:
 * `src/config.ts` never consults it in test mode, so it cannot reach a client,
 * and rejecting it would needlessly block valid runs for anyone with a real `.env`.
 *
 * It is deliberately dependency-free and import-free: this file lives under
 * `test/`, which tsconfig does not type-check, so it must not import from `@/`
 * or `src/` and must not rely on anything beyond `process.env`.
 */
function isInertDatabaseUrl(value: string): boolean {
  // Mirrors isInertTestDatabaseUrl() in src/config.ts. `file://host/path` is not
  // inert: the host component can resolve to a network location.
  const normalized = value.trim().toLowerCase()
  return normalized.startsWith('file:') && !normalized.startsWith('file://')
}

const raw = process.env.DATABASE_URL

if (raw !== undefined && raw.trim() !== '' && !isInertDatabaseUrl(raw)) {
  const scheme = /^([a-zA-Z0-9+.-]+):/.exec(raw.trim())?.[1] ?? '(none)'
  throw new Error(
    `[test/setup.ts] Refusing to run tests against a non-inert DATABASE_URL ` +
      `(scheme: ${scheme}). Tests must use a local SQLite database, i.e. a value ` +
      'starting with `file:`, such as "file::memory:" or "file:./test.db". This ' +
      'guard exists because `bun test` auto-loads your local .env and `@/db` ' +
      'opens a database connection at module load, so a remote URL here would ' +
      'let the test suite write to a real database.\n' +
      'Fix it by pointing the test run at a local database:\n' +
      '  DATABASE_URL="file::memory:" bun test\n' +
      'or remove the remote URL from your local .env.'
  )
}
