import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { config } from "@/config";
import * as schema from "@/db/schema";
import { logger } from "@/utils/logger";

export const client = createClient({
  url: config.DATABASE_URL,
  authToken: config.DATABASE_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });

export async function testDbConnection(): Promise<boolean> {
  try {
    await client.execute("SELECT 1");
    logger.success("Database connection initialized successfully.");
    return true;
  } catch (error) {
    logger.error("Failed to connect to database:", error);
    return false;
  }
}
