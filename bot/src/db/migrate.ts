import "dotenv/config";

import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Pool } from "pg";

import { closePool, createPool } from "./pool.js";

export async function runMigrations(pool: Pool, directory: string): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [
      name,
    ]);
    if (applied.rowCount) continue;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(join(directory, name), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("Variable d'environnement manquante : DATABASE_URL");
  }

  const pool = createPool(databaseUrl);
  try {
    await runMigrations(pool, resolve("migrations"));
    console.log("Migrations PostgreSQL appliquées.");
  } finally {
    await closePool(pool);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  await main();
}

export const migrationsDirectory = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);
