import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'

export function createDatabase (connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, query_timeout: 5000 })
  return { pool, db: drizzle({ client: pool }) }
}
