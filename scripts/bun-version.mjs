/**
 * Single source of truth for the Bun version used by both CI and the image.
 *
 * The Dockerfile decides what Bun actually builds and runs in production. If
 * `verify.yml` typechecks, tests and builds on a different Bun, the new
 * pull_request gate can go green while `bun run build` or the runtime fails
 * inside the image — the gate would not be covering the thing it was added to
 * cover. So CI resolves its Bun version from the Dockerfile instead of
 * repeating it, and this script refuses to resolve anything unpinned.
 *
 * This pins the version today; a floating digest is tracked separately (review
 * item R25). The parser already understands `@sha256:` refs and separates the
 * digest from the tag, so R25 can pin the digest by editing the Dockerfile alone
 * — no change to this script, and in particular no new failure mode for CI.
 *
 * CLI:
 *   node scripts/bun-version.mjs           # print the resolved version
 *   node scripts/bun-version.mjs --tag     # print the full pinned image tag
 *   node scripts/bun-version.mjs --check   # only validate, print nothing
 *
 * When `$GITHUB_OUTPUT` is set and the version is requested (neither `--tag`
 * nor `--check` passed), `version=<v>` is appended to it so a workflow step can
 * feed `${{ steps.<id>.outputs.version }}` into `setup-bun`.
 */

import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A tag is acceptable only if it names an exact version: `1.4.2-alpine`. */
const PINNED_TAG = /^(\d+\.\d+\.\d+)(?:-[a-z0-9][a-z0-9.-]*)?$/

/**
 * A `FROM oven/bun:<tag>[@<digest>]` instruction.
 *
 * Flags are part of the grammar, not an exotic case: `FROM --platform=linux/amd64
 * oven/bun:1.4.2-alpine AS runner` is a real stage. Matching `oven/bun` right
 * after `FROM` would make that stage invisible, so a runner on a different Bun
 * would slip past both the unpinned check and the same-version check — the exact
 * drift this script exists to catch, with the gate green.
 *
 * The tag group is optional so a bare `FROM oven/bun` (implicitly `:latest`) is
 * still captured and reported as unpinned instead of disappearing. `\b` after
 * `bun` keeps `oven/bunfoo` from matching.
 */
const FROM_BUN_IMAGE =
  /^from\s+(?:--[\w.-]+(?:=\S+|\s+\S+)?\s+)*oven\/bun\b(?::(\S+))?/i

/**
 * Splits an image reference into its tag and optional digest. The digest is
 * separated here, never treated as part of the tag: review item R25 pins it,
 * and `oven/bun:1.4.2-alpine@sha256:...` must not read as an unpinned tag —
 * that would break the verify/deploy pipeline the moment R25 lands.
 */
const IMAGE_REF = /^([^@\s]+)(?:@(\S+))?$/

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/

/**
 * Collects every `FROM oven/bun` stage as `{ tag, digest }`, skipping flags and
 * splitting any trailing digest off the tag. `digest` is the raw text after
 * `@`, or `null`; its shape is validated by `resolveBunImageTag`.
 */
export function readBunImageRefs(source) {
  const refs = []
  for (const line of source.split('\n')) {
    const match = FROM_BUN_IMAGE.exec(line.trim())
    if (!match) continue
    const ref = IMAGE_REF.exec(match[1] ?? '')
    // An empty tag means `FROM oven/bun`, i.e. implicit :latest.
    refs.push({ tag: ref?.[1] ?? '', digest: ref?.[2] ?? null })
  }
  return refs
}

/** The tag of every `FROM oven/bun` stage, with any digest stripped. */
export function readBunImageTags(source) {
  return readBunImageRefs(source).map(ref => ref.tag)
}

/**
 * The pinned tag shared by every stage, e.g. `1.4.2-alpine`. Throws if any stage
 * is unpinned or the stages disagree.
 *
 * A digest does not change the returned tag: once R25 lands the ref reads
 * `oven/bun:1.4.2-alpine@sha256:...`, and the tag must still name an exact
 * version so CI and the image cannot drift. Requiring the stages to agree on the
 * digest too is right, but reporting that needs both fields side by side, so
 * `assertConsistentDigests` does it separately.
 */
export function resolveBunImageTag(source) {
  const refs = readBunImageRefs(source)
  if (refs.length === 0)
    throw new Error('no `FROM oven/bun:<tag>` instruction found in Dockerfile')

  const unpinned = [
    ...new Set(refs.map(ref => ref.tag).filter(tag => !PINNED_TAG.test(tag)))
  ]
  if (unpinned.length > 0)
    throw new Error(
      `Dockerfile uses unpinned oven/bun tag(s): ${unpinned.join(', ')}. ` +
        'Pin every stage to an exact version (e.g. oven/bun:1.4.2-alpine) so CI and the ' +
        'shipped image cannot drift apart silently.'
    )

  assertConsistentDigests(refs)

  const distinct = [...new Set(refs.map(ref => ref.tag))]
  if (distinct.length > 1)
    throw new Error(
      `Dockerfile stages use different oven/bun tags: ${distinct.join(', ')}. ` +
        'All stages must build and run on the same Bun version.'
    )

  return distinct[0]
}

/**
 * Stages must be pinned the same way: all digests or none, and all to the same
 * digest. Half the build pinned and half not means only part of it is
 * reproducible; two different digests behind one exact tag means that tag
 * resolves to two different images depending on the stage.
 *
 * A malformed digest is rejected rather than ignored, so a typo cannot quietly
 * count as "no digest". All of this is inert while the image is unpinned, which
 * is what lets it be added now and still be correct when R25 lands.
 */
function assertConsistentDigests(refs) {
  const malformed = [
    ...new Set(
      refs
        .map(ref => ref.digest)
        .filter(d => d !== null && !SHA256_DIGEST.test(d))
    )
  ]
  if (malformed.length > 0)
    throw new Error(
      `Dockerfile has a malformed oven/bun digest: ${malformed.join(', ')}. ` +
        'A digest must look like @sha256:<64 hex characters>.'
    )

  const withDigest = refs.filter(ref => ref.digest !== null)
  if (withDigest.length === 0) return

  if (withDigest.length !== refs.length)
    throw new Error(
      'Dockerfile pins some oven/bun stages to a digest and others to a tag only. ' +
        'Pin every stage, or none, so the whole build is reproducible the same way.'
    )

  const distinct = [...new Set(withDigest.map(ref => ref.digest))]
  if (distinct.length > 1)
    throw new Error(
      `Dockerfile stages use different oven/bun digests: ${distinct.join(', ')}. ` +
        'All stages must build and run on the same image.'
    )
}

/** Just the semver part, e.g. `1.4.2`. Throws if the tag is not pinned. */
export function resolveBunVersion(source) {
  const tag = resolveBunImageTag(source)
  // resolveBunImageTag already proved this matches PINNED_TAG.
  return PINNED_TAG.exec(tag)[1]
}

export function resolveBunImageFullRef(source) {
  const refs = readBunImageRefs(source)
  const tag = resolveBunImageTag(source)
  const digest = refs[0]?.digest
  return digest ? `oven/bun:${tag}@${digest}` : `oven/bun:${tag}`
}

function main() {
  const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8')
  const version = resolveBunVersion(dockerfile)

  if (!process.argv.includes('--check'))
    console.log(
      process.argv.includes('--tag')
        ? resolveBunImageFullRef(dockerfile)
        : version
    )

  const outputs = process.env.GITHUB_OUTPUT
  const wantsVersion =
    !process.argv.includes('--tag') && !process.argv.includes('--check')
  if (outputs && wantsVersion) {
    if (/^version=/m.test(readFileSync(outputs, 'utf8')))
      throw new Error('GITHUB_OUTPUT already contains a `version` key')
    appendFileSync(outputs, `version=${version}\n`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(
      `bun-version: ${error instanceof Error ? error.message : error}`
    )
    process.exit(1)
  }
}
