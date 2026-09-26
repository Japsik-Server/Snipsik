import { createClient } from "@libsql/client";
import {
  assertSchemaCompatible,
  REQUIRED_SCHEMA_VERSION,
} from "./schemaCompatibility";
import { firstConfiguredValue } from "./connectionConfig";

const url = firstConfiguredValue(
  process.env.DATABASE_URL,
  process.env.TURSO_DATABASE_URL,
);
if (!url)
  throw new Error(
    "DATABASE_URL or TURSO_DATABASE_URL is required for schema preflight",
  );
if (
  !url.startsWith("libsql:") &&
  !url.startsWith("file:") &&
  !url.startsWith("https:") &&
  !url.startsWith("http:") &&
  !url.startsWith("wss:") &&
  !url.startsWith("ws:")
) {
  throw new Error(
    "Invalid database URL: must start with libsql:, file:, or https:",
  );
}
const client = createClient({
  url,
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
