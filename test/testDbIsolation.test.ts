import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

/**
 * Regression tests for the `bun test` preload guard in `test/setup.ts`.
 *
 * The guard is what keeps R02 closed: `bun test` auto-loads the developer's
 * local `.env` before any `src/` module is imported, and `@/db` opens a
 * database client at module load. A real `libsql://` URL sitting in that `.env`
 * would therefore let an ordinary `bun test` write to a real database.
 *
 * Each case spawns a real `bun test` subprocess with a controlled environment,
 * because the guard runs at preload time in the *child* — importing `setup.ts`
 * in-process would not reproduce the ordering that makes this vulnerability
 * possible.
 */
const REPO_ROOT = join(import.meta.dir, '..')
const REMOTE = 'libsql://definitely-not-a-real-host.invalid'

/** A test file that needs neither a database nor a Discord token. */
const PROBE = 'test/mutex.test.ts'

/**
 * Upper bound on one child run.
 *
 * Without it, a child that hangs (rather than exits) leaves this suite waiting
 * forever, which is indistinguishable from a slow machine when watching CI.
 * These children spawn `bun test`, so 30s leaves ample headroom over the ~1s a
 * healthy probe takes while still bounding a genuine hang.
 */
const PROBE_TIMEOUT_MS = 30_000

interface RunResult {
  exitCode: number
  output: string
  /**
   * True when the child was killed by `PROBE_TIMEOUT_MS` rather than exiting
   * on its own.
   *
   * This is tracked separately from `exitCode` on purpose: a timed-out child is
   * killed with SIGTERM and so exits non-zero (143), which would otherwise
   * satisfy a `not.toBe(0)` guard assertion and let a *hang* masquerade as a
   * successful refusal.
   */
  timedOut: boolean
}

async function runProbe(env: Record<string, string>): Promise<RunResult> {
  const proc = Bun.spawn(['bun', 'test', '--no-env-file', PROBE], {
    cwd: REPO_ROOT,
    env: {
      ...globalThis.process.env,
      // Do not let the ambient .env decide what the child sees.
      DOTENV_CONFIG_PATH: '',
      ...env
    },
    stdout: 'pipe',
    stderr: 'pipe',
    // Bun.spawn kills the child with SIGTERM once this elapses, so the awaits
    // below always resolve instead of hanging.
    timeout: PROBE_TIMEOUT_MS
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])

  const exitCode = await proc.exited
  const timedOut = proc.signalCode === 'SIGTERM'

  return { exitCode, output: `${stdout}\n${stderr}`, timedOut }
}

describe('preload guard refuses a non-inert database URL', () => {
  it('refuses a remote DATABASE_URL even when NODE_ENV is development', async () => {
    // The original gap: the guard keyed test mode off `NODE_ENV === 'test'`,
    // and Bun does not overwrite an already-set NODE_ENV. A developer with
    // `NODE_ENV=development` in their .env got the production URL straight
    // through, because nothing forced test mode on.
    const { exitCode, output, timedOut } = await runProbe({
      NODE_ENV: 'development',
      DATABASE_URL: REMOTE,
      TURSO_DATABASE_URL: ''
    })

    expect(output).toContain('Refusing to run tests against a non-inert')
    expect(output).toContain('DATABASE_URL')
    // The message alone would still match if the guard were downgraded from
    // `throw` to a console warning, so assert the run was actually blocked.
    expect(exitCode).not.toBe(0)
    expect(timedOut).toBe(false)
  })

  it('refuses a remote DATABASE_URL when NODE_ENV is production', async () => {
    const { exitCode, output, timedOut } = await runProbe({
      NODE_ENV: 'production',
      DATABASE_URL: REMOTE,
      TURSO_DATABASE_URL: ''
    })

    expect(output).toContain('Refusing to run tests against a non-inert')
    expect(exitCode).not.toBe(0)
    expect(timedOut).toBe(false)
  })

  it('refuses a remote TURSO_DATABASE_URL when DATABASE_URL is absent', async () => {
    // `src/db/checkSchema.ts` and `drizzle.config.ts` read TURSO_DATABASE_URL
    // directly, bypassing `src/config.ts`, and checkSchema calls createClient()
    // at module load. A .env carrying only TURSO_DATABASE_URL previously had no
    // guard at all.
    const { exitCode, output, timedOut } = await runProbe({
      NODE_ENV: 'test',
      DATABASE_URL: '',
      TURSO_DATABASE_URL: REMOTE
    })

    expect(output).toContain('Refusing to run tests against a non-inert')
    expect(output).toContain('TURSO_DATABASE_URL')
    expect(exitCode).not.toBe(0)
    expect(timedOut).toBe(false)
  })

  it('refuses a remote TURSO_DATABASE_URL even under NODE_ENV=development', async () => {
    const { exitCode, output, timedOut } = await runProbe({
      NODE_ENV: 'development',
      DATABASE_URL: '',
      TURSO_DATABASE_URL: REMOTE
    })

    expect(output).toContain('Refusing to run tests against a non-inert')
    expect(output).toContain('TURSO_DATABASE_URL')
    expect(exitCode).not.toBe(0)
    expect(timedOut).toBe(false)
  })

  it('does not echo the secret-bearing URL back in the error', async () => {
    const dynamicToken = crypto.randomUUID()
    const { exitCode, output, timedOut } = await runProbe({
      NODE_ENV: 'test',
      DATABASE_URL: `libsql://example.com?authToken=${dynamicToken}`,
      TURSO_DATABASE_URL: ''
    })

    expect(output).toContain('Refusing to run tests')
    expect(output).not.toContain(dynamicToken)
    expect(output).not.toMatch(/[?&]authToken=[^&\s]+/)
    expect(exitCode).not.toBe(0)
    expect(timedOut).toBe(false)
  })
})

describe('preload guard still permits a valid inert run', () => {
  it('passes with file::memory: even when NODE_ENV says development', async () => {
    const { exitCode, output, timedOut } = await runProbe({
      NODE_ENV: 'development',
      DATABASE_URL: 'file::memory:',
      TURSO_DATABASE_URL: ''
    })

    expect(output).not.toContain('Refusing to run tests')
    expect(exitCode).toBe(0)
    expect(timedOut).toBe(false)
  })

  it('passes with a local file: path URL', async () => {
    const { exitCode, output, timedOut } = await runProbe({
      NODE_ENV: 'development',
      DATABASE_URL: 'file:./test.db',
      TURSO_DATABASE_URL: 'file:./test.db'
    })

    expect(output).not.toContain('Refusing to run tests')
    expect(exitCode).toBe(0)
    expect(timedOut).toBe(false)
  })
})
