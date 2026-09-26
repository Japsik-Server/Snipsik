import { createClient } from "@libsql/client";
import {
  assertSchemaCompatible,
  REQUIRED_SCHEMA_VERSION,
} from "./schemaCompatibility";
import { ALLOWED_DB_PROTOCOLS, firstConfiguredValue } from "./connectionConfig";

const url = firstConfiguredValue(
  process.env.DATABASE_URL,
  process.env.TURSO_DATABASE_URL,
);
if (!url)
  throw new Error(
    "DATABASE_URL or TURSO_DATABASE_URL is required for schema preflight",
  );

const normalizedUrl = url.trim();

let parsed: URL;
try {
  parsed = new URL(normalizedUrl);
} catch {
  throw new Error("Invalid database URL: must be a valid absolute URL");
}

const protocol = parsed.protocol.toLowerCase();
if (
  (protocol !== "file:" && parsed.host.length === 0) ||
  (protocol === "file:" && parsed.pathname.length <= 1)
) {
  throw new Error("Invalid database URL: must be a valid absolute URL");
}

if (
  !ALLOWED_DB_PROTOCOLS.includes(
    protocol as (typeof ALLOWED_DB_PROTOCOLS)[number],
  )
) {
  throw new Error(
    `Invalid database URL: must start with one of ${ALLOWED_DB_PROTOCOLS.join(", ")}`,
  );
}
const client = createClient({
  url: normalizedUrl,
  authToken: firstConfiguredValue(
    process.env.DATABASE_AUTH_TOKEN,
    process.env.TURSO_AUTH_TOKEN,
  ),
});

try {
  await assertSchemaCompatible(client);
  console.log(`Schema v${REQUIRED_SCHEMA_VERSION} compatibility verified.`);
} finally {
  client.close();
}
