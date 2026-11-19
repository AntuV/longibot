import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readConfig } from '../packages/core/src/config.js'
import { createDatabase } from '../packages/infrastructure/src/database.js'
import { logger } from '../packages/infrastructure/src/logger.js'

const { pool } = createDatabase(readConfig().DATABASE_URL)
const client = await pool.connect()
try {
  await client.query('SELECT pg_advisory_lock(74120936)')
  await migrate(drizzle({ client }), { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
  logger.info('Migrations complete')
} finally {
  try { await client.query('SELECT pg_advisory_unlock(74120936)') } finally { client.release(); await pool.end() }
}
