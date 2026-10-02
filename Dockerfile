# Build Stage
# The Bun version in this file is the single source of truth for CI: the
# `verify` workflow resolves `bun-version` from here via scripts/bun-version.mjs
# rather than repeating it, so the gate always runs the same Bun that builds
# and runs this image. scripts/bun-version.mjs refuses to resolve a tag that is
# not an exact version, so this cannot silently drift back to a floating
# `oven/bun:1-alpine` and leave CI green on an older Bun. Keep both stages on
# the same tag. (The image digest is still unpinned — tracked as review item
# R25, deliberately out of scope here.)
FROM oven/bun:1.4.2-alpine AS builder
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
RUN bun build src/index.ts --outdir dist --target bun
RUN bun build src/db/checkSchema.ts src/healthcheck.ts --outdir dist --target bun

# Production Stage
FROM oven/bun:1.4.2-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile

COPY --from=builder /app/dist ./dist

USER bun
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=3 CMD ["bun", "run", "dist/healthcheck.js"]
CMD ["bun", "run", "dist/index.js"]
