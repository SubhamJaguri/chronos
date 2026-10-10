/**
 * Database entry point: the full schema plus a lazily created postgres-js
 * client for the application. Tests use their own driver (PGlite) against
 * the same schema and migrations.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export * from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let db: Database | null = null;

/** The application database handle. Requires DATABASE_URL to be set. */
export function getDb(): Database {
  if (db === null) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set; see .env.example");
    }
    db = drizzle(postgres(url), { schema });
  }
  return db;
}
