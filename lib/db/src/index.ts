import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
  for (const envPath of [".env", "../../.env", "../../../.env"]) {
    const full = resolve(process.cwd(), envPath);
    if (existsSync(full)) {
      try {
        process.loadEnvFile(full);
        if (process.env.DATABASE_URL) break;
      } catch {}
    }
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
