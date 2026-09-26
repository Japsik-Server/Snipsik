import { createClient } from "@libsql/client";
import {
  assertSchemaCompatible,
  REQUIRED_SCHEMA_VERSION,
} from "./schemaCompatibility";
import {
  assertValidDatabaseUrl,
  firstConfiguredValue,
} from "./connectionConfig";

const url = firstConfiguredValue(
  process.env.DATABASE_URL,
  process.env.TURSO_DATABASE_URL,
);
if (!url)
  throw new Error(
    "DATABASE_URL or TURSO_DATABASE_URL is required for schema preflight",
  );

const validatedUrl = assertValidDatabaseUrl(url);
const client = createClient({
  url: validatedUrl,
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
