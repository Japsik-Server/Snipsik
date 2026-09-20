import { defineConfig } from "drizzle-kit";

const isGenerate = process.argv.includes("generate");
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.TURSO_DATABASE_URL ||
  (isGenerate ? "file::memory:" : undefined);

if (!dbUrl) {
  throw new Error(
    "DATABASE_URL or TURSO_DATABASE_URL environment variable is required to run drizzle-kit database commands.",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: dbUrl,
    authToken: process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN,
  },
});
