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

interface RunResult {
  exitCode: number
  output: string
}

async function runProbe(env: Record<string, string>): Promise<RunResult> {
  const proc = Bun.spawn(['bun', 'test', PROBE], {
    cwd: REPO_ROOT,
    env: {
      ...globalThis.process.env,
      // Do not let the ambient .env decide what the child sees.
      DOTENV_CONFIG_PATH: '',
      ...env
    },
    stdout: 'pipe',
    stderr: 'pipe'
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])

  return { exitCode: await proc.exited, output: `${stdout}\n${stderr}` }
}

describe('preload guard refuses a non-inert database URL', () => {
  it('refuses a remote DATABASE_URL even when NODE_ENV is development', async () => {
    // The original gap: the guard keyed test mode off `NODE_ENV === 'test'`,
    // and Bun does not overwrite an already-set NODE_ENV. A developer with
    // `NODE_ENV=development` in their .env got the production URL straight
    // through, because nothing forced test mode on.
    const { output } = await runProbe({
      NODE_ENV: 'development',
      DATABASE_URL: REMOTE,
      TURSO_DATABASE_URL: ''
    })

    expect(output).toContain('Refusing to run tests against a non-inert')
    expect(output).toContain('DATABASE_URL')
  })

  it('refuses a remote DATABASE_URL when NODE_ENV is production', async () => {
    const { output } = await runProbe({
      NODE_ENV: 'production',
      DATABASE_URL: REMOTE,
      TURSO_DATABASE_URL: ''
    })

    expect(output).toContain('Refusing to run tests against a non-inert')
  })

  it('refuses a remote TURSO_DATABASE_URL when DATABASE_URL is absent', async () => {
    // `src/db/checkSchema.ts` and `drizzle.config.ts` read TURSO_DATABASE_URL
    // directly, bypassing `src/config.ts`, and checkSchema calls createClient()
    // at module load. A .env carrying only TURSO_DATABASE_URL previously had no
    // guard at all.
    const { output } = await runProbe({
      NODE_ENV: 'test',
      DATABASE_URL: '',
      TURSO_DATABASE_URL: REMOTE
    })

    expect(output).toContain('Refusing to run tests against a non-inert')
    expect(output).toContain('TURSO_DATABASE_URL')
  })

  it('refuses a remote TURSO_DATABASE_URL even under NODE_ENV=development', async () => {
    const { output } = await runProbe({
      NODE_ENV: 'development',
      DATABASE_URL: '',
      TURSO_DATABASE_URL: REMOTE
    })

    expect(output).toContain('Refusing to run tests against a non-inert')
    expect(output).toContain('TURSO_DATABASE_URL')
  })

  it('does not echo the secret-bearing URL back in the error', async () => {
    const { output } = await runProbe({
      NODE_ENV: 'test',
      DATABASE_URL: `libsql://my-db-org.turso.io?authToken=super-secret-token`,
      TURSO_DATABASE_URL: ''
    })

    expect(output).toContain('Refusing to run tests')
    expect(output).not.toContain('super-secret-token')
  })
})

describe('preload guard still permits a valid inert run', () => {
  it('passes with file::memory: even when NODE_ENV says development', async () => {
    const { exitCode, output } = await runProbe({
      NODE_ENV: 'development',
      DATABASE_URL: 'file::memory:',
      TURSO_DATABASE_URL: ''
    })

    expect(output).not.toContain('Refusing to run tests')
    expect(exitCode).toBe(0)
  })

  it('passes with a local file: URL', async () => {
    const { exitCode, output } = await runProbe({
      NODE_ENV: 'development',
      DATABASE_URL: 'file::memory:',
      TURSO_DATABASE_URL: 'file::memory:'
    })

    expect(output).not.toContain('Refusing to run tests')
    expect(exitCode).toBe(0)
  })
})
