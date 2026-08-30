import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "@/config";
import * as schema from "@/db/schema";
import { logger } from "@/utils/logger";

const queryClient = postgres(config.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {}, // silence notices
});

export const db = drizzle(queryClient, { schema });

export async function testDbConnection(): Promise<boolean> {
  try {
    await queryClient`SELECT 1`;
    logger.success("Database connection initialized successfully.");
    return true;
  } catch (error) {
    logger.error("Failed to connect to database:", error);
    return false;
  }
}
