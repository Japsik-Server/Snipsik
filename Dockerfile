# Build Stage
FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
RUN bun build src/index.ts --outdir dist --target bun
RUN bun build src/db/checkSchema.ts src/healthcheck.ts --outdir dist --target bun

# Production Stage
FROM oven/bun:1-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile

COPY --from=builder /app/dist ./dist

USER bun
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=3 CMD ["bun", "run", "dist/healthcheck.js"]
CMD ["bun", "run", "dist/index.js"]
