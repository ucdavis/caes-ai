import { fileURLToPath } from "node:url";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import * as schema from "./schema.js";

export interface CaesAiDatabase {
  db: NodePgDatabase<typeof schema>;
  pool: pg.Pool;
}

export function createDatabase(connectionString: string): CaesAiDatabase {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  return {
    pool,
    db: drizzle(pool, { schema }),
  };
}

export async function migrateDatabase(database: CaesAiDatabase): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
  await migrate(database.db, { migrationsFolder });
}

export async function closeDatabase(database: CaesAiDatabase): Promise<void> {
  await database.pool.end();
}
