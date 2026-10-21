import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { required } from "@/src/lib/env";

export type Database = NodePgDatabase<typeof schema>;
export type Executor = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;
const globalDb = globalThis as unknown as { sewamatesPool?: Pool };
export function getDb(): Database {
  const pool = (globalDb.sewamatesPool ??= new Pool({
    connectionString: required("DATABASE_URL"),
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  }));
  return drizzle(pool, { schema });
}
