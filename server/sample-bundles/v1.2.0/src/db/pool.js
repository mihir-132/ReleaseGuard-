import pg from 'pg';

const { Pool } = pg;

let pool;

/**
 * Return the singleton connection pool.
 * Uses DATABASE_POOL_SIZE from env (default: 10).
 * Connection pool settings were updated in v1.2.0.
 */
export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: parseInt(process.env.DATABASE_POOL_SIZE ?? '10', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle pool client', err);
    });
  }
  return pool;
}

/**
 * Execute a single parameterised query against the pool.
 * @param {string} text
 * @param {any[]} params
 */
export async function query(text, params) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
