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
 * an inert URL whenever `NODE_ENV === 'test'`.
 *
 * ## Test mode is established here, not merely read
 *
 * `src/config.ts` keys its inert-URL force on `process.env.NODE_ENV === 'test'`.
 * That check alone is defeatable: Bun does not overwrite an already-set
 * `NODE_ENV`, so a shell export or a `.env` line of `NODE_ENV=development`
 * leaves the production URL flowing straight through the test run. Verified
 * before this change:
 *   NODE_ENV=development DATABASE_URL="libsql://fake-host.invalid" bun -e ...
 *   RESOLVED: libsql://fake-host.invalid
 *
 * So rather than trusting the ambient value, this preload *pins* it to `test`
 * before anything else can read it. Every module loaded afterwards — including
 * the `src/config.ts` branch — then sees test mode as an invariant rather than
 * an ambient assumption, which makes the `config.ts` branch
 * unconditional-in-practice for anything run through `bun test`.
 *
 * ## Both connection variables are checked
 *
 * `DATABASE_URL` is not the only way to name a database. `src/db/checkSchema.ts`
 * and `drizzle.config.ts` read `process.env.DATABASE_URL` /
 * `process.env.TURSO_DATABASE_URL` *directly*, bypassing `src/config.ts`
 * entirely, and `checkSchema.ts` calls `createClient()` at module load. A `.env`
 * carrying only `TURSO_DATABASE_URL=libsql://…` would therefore reach a real
 * database with no guard in the way. Both variables get the same refusal.
 *
 * It is deliberately dependency-free and import-free: this file lives under
 * `test/`, which tsconfig does not type-check, so it must not import from `@/`
 * or `src/` and must not rely on anything beyond `process.env`.
 */

// Establish the invariant before anything reads it. See the note above.
process.env.NODE_ENV = 'test'

/** Mirrors isInertTestDatabaseUrl() in src/config.ts. */
function isInertDatabaseUrl(value: string): boolean {
  // `file://host/path` is not inert: the host component can resolve to a
  // network location.
  const normalized = value.trim().toLowerCase()
  return normalized.startsWith('file:') && !normalized.startsWith('file://')
}

/** How to describe a value without echoing a secret-bearing URL back out. */
function schemeOf(value: string): string {
  return /^([a-zA-Z0-9+.-]+):/.exec(value.trim())?.[1] ?? '(none)'
}

function refuse(variable: string, value: string): never {
  throw new Error(
    `[test/setup.ts] Refusing to run tests against a non-inert ${variable} ` +
      `(scheme: ${schemeOf(value)}). Tests must use a local SQLite database, i.e. ` +
      'a value starting with `file:`, such as "file::memory:" or "file:./test.db". ' +
      'This guard exists because `bun test` auto-loads your local .env and `@/db` ' +
      'opens a database connection at module load, so a remote URL here would ' +
      'let the test suite write to a real database.\n' +
      'Fix it by pointing the test run at a local database:\n' +
      '  DATABASE_URL="file::memory:" bun test\n' +
      `If the remote value lives only in ${variable} in your local .env, either ` +
      `blank it for the test run (${variable}= bun test) or point it at a local ` +
      'file as well.'
  )
}

/**
 * Both variables are checked. An unset or whitespace-only value is left alone:
 * `src/config.ts` supplies its own inert default when `DATABASE_URL` is absent,
 * and `checkSchema.ts` reports the "is required" error in that case, which is a
 * better diagnostic than this guard inventing one.
 */
for (const variable of ['DATABASE_URL', 'TURSO_DATABASE_URL']) {
  const raw = process.env[variable]
  if (raw !== undefined && raw.trim() !== '' && !isInertDatabaseUrl(raw)) {
    refuse(variable, raw)
  }
}
