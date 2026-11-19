import { createApp } from './app.js'
import { readConfig } from '../../../packages/core/src/config.js'
import { createDatabase } from '../../../packages/infrastructure/src/database.js'
import { logger } from '../../../packages/infrastructure/src/logger.js'

const { pool } = createDatabase(readConfig().DATABASE_URL)
pool.on('error', () => logger.error('PostgreSQL pool error'))
const { app, config } = await createApp({ pool, onClose: async () => { await pool.end() } })
await app.listen(config.PORT, '0.0.0.0')
