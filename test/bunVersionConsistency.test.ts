import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readBunImageRefs,
  readBunImageTags,
  resolveBunImageTag,
  resolveBunVersion
} from '../scripts/bun-version.mjs'

const root = join(import.meta.dir, '..')
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
const verifyWorkflow = readFileSync(
  join(root, '.github/workflows/verify.yml'),
  'utf8'
)
const deployWorkflow = readFileSync(
  join(root, '.github/workflows/deploy.yml'),
  'utf8'
)

describe('Dockerfile Bun pin', () => {
  it('pins every stage to an exact version', () => {
    // A floating `oven/bun:1-alpine` would let a Bun minor bump reach the image
    // while CI stays green on the older version the workflow was pinned to.
    const tags = readBunImageTags(dockerfile)
    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags)
      expect(tag).toMatch(/^\d+\.\d+\.\d+(?:-[a-z0-9][a-z0-9.-]*)?$/)
  })

  it('builds and runs on the same Bun version', () => {
    expect(new Set(readBunImageTags(dockerfile)).size).toBe(1)
  })

  it('resolves the semver version CI installs', () => {
    expect(resolveBunVersion(dockerfile)).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('bun-version resolver', () => {
  it('extracts the version and the full tag', () => {
    const source = 'FROM oven/bun:1.4.2-alpine AS builder\n'
    expect(resolveBunVersion(source)).toBe('1.4.2')
    expect(resolveBunImageTag(source)).toBe('1.4.2-alpine')
  })

  it('matches lowercase `from` instructions case-insensitively', () => {
    const source = 'from oven/bun:1.4.2-alpine AS builder\n'
    expect(resolveBunVersion(source)).toBe('1.4.2')
    expect(resolveBunImageTag(source)).toBe('1.4.2-alpine')
  })

  it('handles a distro suffix other than alpine', () => {
    expect(resolveBunVersion('FROM oven/bun:1.4.2-slim AS runner\n')).toBe(
      '1.4.2'
    )
  })

  it('rejects a floating major/minor tag', () => {
    expect(() =>
      resolveBunVersion('FROM oven/bun:1-alpine AS builder\n')
    ).toThrow(/unpinned/)
    expect(() =>
      resolveBunVersion('FROM oven/bun:latest AS builder\n')
    ).toThrow(/unpinned/)
    expect(() =>
      resolveBunVersion('FROM oven/bun:1.4-alpine AS builder\n')
    ).toThrow(/unpinned/)
  })

  it('rejects stages that disagree on the version', () => {
    const source = [
      'FROM oven/bun:1.4.2-alpine AS builder',
      'FROM oven/bun:1.5.0-alpine AS runner'
    ].join('\n')
    expect(() => resolveBunVersion(source)).toThrow(/different oven\/bun tags/)
  })

  it('accepts both stages on one identical tag', () => {
    const source = [
      'FROM oven/bun:1.4.2-alpine AS builder',
      'FROM oven/bun:1.4.2-alpine AS runner'
    ].join('\n')
    expect(resolveBunVersion(source)).toBe('1.4.2')
  })

  it('rejects a Dockerfile with no oven/bun stage', () => {
    expect(() => resolveBunVersion('FROM node:22-alpine\n')).toThrow(
      /no `FROM oven\/bun/
    )
  })
})

describe('FROM flags and image digests', () => {
  const digest = `sha256:${'a'.repeat(64)}`
  const otherDigest = `sha256:${'b'.repeat(64)}`

  it('sees a stage whose FROM carries a --platform flag', () => {
    // `FROM --platform=linux/amd64 oven/bun:1.4.2-alpine` used to match nothing
    // at all, so the stage was invisible to both checks.
    const source =
      'FROM --platform=linux/amd64 oven/bun:1.4.2-alpine AS runner\n'
    expect(readBunImageTags(source)).toEqual(['1.4.2-alpine'])
    expect(resolveBunVersion(source)).toBe('1.4.2')
  })

  it('sees a stage whose FROM carries a space-separated flag', () => {
    const source =
      'FROM --platform $BUILDPLATFORM oven/bun:1.4.2-alpine AS runner\n'
    expect(readBunImageTags(source)).toEqual(['1.4.2-alpine'])
    expect(resolveBunVersion(source)).toBe('1.4.2')
  })

  it('skips several flags on one FROM', () => {
    const source =
      'FROM --platform=linux/arm64 --foo=bar oven/bun:1.4.2-alpine AS runner\n'
    expect(readBunImageTags(source)).toEqual(['1.4.2-alpine'])
  })

  it('resolves the same version with a flagged stage and a bare one', () => {
    const source = [
      'FROM oven/bun:1.4.2-alpine AS builder',
      'FROM --platform=linux/amd64 oven/bun:1.4.2-alpine AS runner'
    ].join('\n')
    expect(readBunImageTags(source)).toEqual(['1.4.2-alpine', '1.4.2-alpine'])
    expect(resolveBunVersion(source)).toBe('1.4.2')
  })

  it('catches version drift in a flagged stage', () => {
    // The reason flags have to be parsed: a flagged runner on a different Bun is
    // exactly the drift the gate exists to catch, and it passed silently.
    const source = [
      'FROM oven/bun:1.4.2-alpine AS builder',
      'FROM --platform=linux/amd64 oven/bun:1.5.0-alpine AS runner'
    ].join('\n')
    expect(() => resolveBunVersion(source)).toThrow(/different oven\/bun tags/)
  })

  it('still rejects an unpinned tag behind a flag', () => {
    expect(() =>
      resolveBunVersion('FROM --platform=linux/amd64 oven/bun:1-alpine\n')
    ).toThrow(/unpinned/)
  })

  it('rejects a bare oven/bun with no tag at all', () => {
    // Implicit :latest. Missing the line entirely would hide the unpinned stage.
    expect(readBunImageTags('FROM oven/bun AS runner\n')).toEqual([''])
    expect(() => resolveBunVersion('FROM oven/bun AS runner\n')).toThrow(
      /unpinned/
    )
  })

  it('does not match a different image that merely starts with oven/bun', () => {
    expect(readBunImageTags('FROM oven/bunfoo:1-alpine AS x\n')).toEqual([])
  })

  it('separates a digest from the tag instead of capturing it', () => {
    // R25 wants the digest pinned. Reading it as part of the tag fails
    // PINNED_TAG and would break verify/deploy the moment R25 lands.
    const source = `FROM oven/bun:1.4.2-alpine@${digest} AS builder\n`
    expect(readBunImageTags(source)).toEqual(['1.4.2-alpine'])
    expect(readBunImageRefs(source)).toEqual([{ tag: '1.4.2-alpine', digest }])
    expect(resolveBunVersion(source)).toBe('1.4.2')
    expect(resolveBunImageTag(source)).toBe('1.4.2-alpine')
  })

  it('resolves two stages pinned to one digest, one behind a flag', () => {
    const source = [
      `FROM oven/bun:1.4.2-alpine@${digest} AS builder`,
      `FROM --platform=linux/amd64 oven/bun:1.4.2-alpine@${digest} AS runner`
    ].join('\n')
    expect(resolveBunVersion(source)).toBe('1.4.2')
  })

  it('rejects a digest-pinned stage that drifts on version', () => {
    const source = [
      `FROM oven/bun:1.4.2-alpine@${digest} AS builder`,
      `FROM --platform=linux/amd64 oven/bun:1.5.0-alpine@${digest} AS runner`
    ].join('\n')
    expect(() => resolveBunVersion(source)).toThrow(/different oven\/bun tags/)
  })

  it('rejects stages pinned to different digests behind the same tag', () => {
    // Same exact version, two different images: still drift.
    const source = [
      `FROM oven/bun:1.4.2-alpine@${digest} AS builder`,
      `FROM oven/bun:1.4.2-alpine@${otherDigest} AS runner`
    ].join('\n')
    expect(() => resolveBunVersion(source)).toThrow(/different oven\/bun/)
  })

  it('rejects a half-pinned Dockerfile', () => {
    const source = [
      `FROM oven/bun:1.4.2-alpine@${digest} AS builder`,
      'FROM oven/bun:1.4.2-alpine AS runner'
    ].join('\n')
    expect(() => resolveBunVersion(source)).toThrow(/some oven\/bun stages/)
  })

  it('rejects a malformed digest instead of ignoring it', () => {
    // Otherwise a typo counts as "no digest" and the stage looks fine.
    const source = 'FROM oven/bun:1.4.2-alpine@sha256:deadbeef AS builder\n'
    expect(() => resolveBunVersion(source)).toThrow(/malformed/)
  })

  it('ensures all stages share the same digest invariant', () => {
    // The .mjs module has no declarations, so `ref` is an implicit any here.
    const refs: { tag: string; digest: string | null }[] =
      readBunImageRefs(dockerfile)
    const digests = new Set(refs.map(ref => ref.digest))
    expect(digests.size).toBe(1)
  })
})

describe('CI uses the Dockerfile version, not a duplicated literal', () => {
  it('does not hardcode a bun-version in verify.yml', () => {
    // The whole point is that there is exactly one place naming the version.
    // A literal here would be a second source of truth free to drift.
    expect(verifyWorkflow).not.toMatch(/^\s*bun-version:\s*[\d.]/m)
  })

  it('derives the version via the resolver step', () => {
    expect(verifyWorkflow).toMatch(/run: node scripts\/bun-version\.mjs/)
    expect(verifyWorkflow).toMatch(
      /bun-version: \$\{\{ steps\.bun-version\.outputs\.version \}\}/
    )
  })

  it('derives the base image in deploy.yml from the same source', () => {
    expect(deployWorkflow).not.toContain('oven/bun:1-alpine')
    expect(deployWorkflow).toMatch(
      /BASE_IMAGE=\$\(node scripts\/bun-version\.mjs --tag\)/
    )
  })

  it('the resolver step runs before Bun is installed', () => {
    const resolver = verifyWorkflow.indexOf('node scripts/bun-version.mjs')
    const setup = verifyWorkflow.indexOf('oven-sh/setup-bun@')
    expect(resolver).toBeGreaterThan(-1)
    expect(setup).toBeGreaterThan(-1)
    expect(resolver).toBeLessThan(setup)
  })
})

describe('CLI invocation and GITHUB_OUTPUT', () => {
  const runCli = (
    args: string[],
    env: Record<string, string | undefined> = {}
  ) => {
    return spawnSync('node', ['scripts/bun-version.mjs', ...args], {
      cwd: root,
      env: {
        ...process.env,
        ...env
      },
      encoding: 'utf8'
    })
  }

  it('prints the version without modifying GITHUB_OUTPUT if unset', () => {
    const res = runCli([], { GITHUB_OUTPUT: undefined })
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('appends version to GITHUB_OUTPUT when version is requested', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bun-version-test-'))
    const outputFile = join(tmp, 'output')
    writeFileSync(outputFile, '')
    try {
      const res = runCli([], { GITHUB_OUTPUT: outputFile })
      expect(res.status).toBe(0)
      const content = readFileSync(outputFile, 'utf8')
      expect(content).toMatch(/^version=\d+\.\d+\.\d+\n$/)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('does not write to GITHUB_OUTPUT when --tag is passed', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bun-version-test-'))
    const outputFile = join(tmp, 'output')
    writeFileSync(outputFile, '')
    try {
      const res = runCli(['--tag'], { GITHUB_OUTPUT: outputFile })
      expect(res.status).toBe(0)
      expect(res.stdout.trim()).toMatch(/^oven\/bun:\d+\.\d+\.\d+/)
      expect(readFileSync(outputFile, 'utf8')).toBe('')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('does not write to GITHUB_OUTPUT when --check is passed', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bun-version-test-'))
    const outputFile = join(tmp, 'output')
    writeFileSync(outputFile, '')
    try {
      const res = runCli(['--check'], { GITHUB_OUTPUT: outputFile })
      expect(res.status).toBe(0)
      expect(res.stdout).toBe('')
      expect(readFileSync(outputFile, 'utf8')).toBe('')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('fails if GITHUB_OUTPUT already has version key on version request', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bun-version-test-'))
    const outputFile = join(tmp, 'output')
    writeFileSync(outputFile, 'version=1.0.0\n')
    try {
      const res = runCli([], { GITHUB_OUTPUT: outputFile })
      expect(res.status).not.toBe(0)
      expect(res.stderr).toContain('already contains a `version` key')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('succeeds with --tag when GITHUB_OUTPUT already has version key', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bun-version-test-'))
    const outputFile = join(tmp, 'output')
    writeFileSync(outputFile, 'version=1.0.0\n')
    try {
      const res = runCli(['--tag'], { GITHUB_OUTPUT: outputFile })
      expect(res.status).toBe(0)
      expect(readFileSync(outputFile, 'utf8')).toBe('version=1.0.0\n')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('succeeds with --check when GITHUB_OUTPUT already has version key', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bun-version-test-'))
    const outputFile = join(tmp, 'output')
    writeFileSync(outputFile, 'version=1.0.0\n')
    try {
      const res = runCli(['--check'], { GITHUB_OUTPUT: outputFile })
      expect(res.status).toBe(0)
      expect(readFileSync(outputFile, 'utf8')).toBe('version=1.0.0\n')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
