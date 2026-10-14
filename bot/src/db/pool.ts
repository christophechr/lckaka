import { Pool } from "pg";

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

export async function closePool(pool: Pool): Promise<void> {
  await pool.end();
}
