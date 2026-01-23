import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg, { Pool, PoolConfig } from 'pg';
import * as schema from './schema';



if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL is missing');
}

export const IS_DEBUG_MODE = process.env.DISABLE_DB_CIRCUIT_BREAKER === 'true';
export const IS_DEV = process.env.NODE_ENV !== 'production' || IS_DEBUG_MODE;
const defaultTimeout = IS_DEV ? 5000 : 5000;

export const poolConfig: PoolConfig = {
  connectionString: process.env.POSTGRES_URL,
  max: IS_DEBUG_MODE ? 20 : 10,
  min: 0,
  connectionTimeoutMillis: IS_DEV ? 5000 : 5000,
  idleTimeoutMillis: defaultTimeout,

  statement_timeout: defaultTimeout,
  query_timeout: defaultTimeout,
};

let internalPool: Pool | null;


export function initializeDatabase(pool: Pool) {
  if (db) return db;
  internalPool = pool;
  db = drizzle(pool, { schema });
  return db;
}

export function getPool(): Pool {
  if (!internalPool) {
    if (!process.env.POSTGRES_URL) {
      throw new Error('POSTGRES_URL is missing');
    }
    internalPool = new Pool(poolConfig);

    // Global error handler for the pool to prevent process crashes
    internalPool.on('error', (error) => {
      console.error({ error }, 'Unexpected error on idle client');
    });
  }
  return internalPool;
}

export async function closeDb() {
  if (internalPool) {
    await internalPool.end();
    internalPool = null;
    console.info("Postgres pool closed successfully.");
  }
}

export let db: NodePgDatabase<typeof schema>;
export { schema };
