import { writeFile, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { PgBoss } from 'pg-boss'
import { readConfig } from '../../../packages/core/src/config.js'
import { createDatabase } from '../../../packages/infrastructure/src/database.js'
import { logger } from '../../../packages/infrastructure/src/logger.js'
import { Worker } from './worker.js'

const config = readConfig()
const { pool } = createDatabase(config.DATABASE_URL)
const heartbeatPath = process.env.WORKER_HEARTBEAT_PATH ?? '/tmp/longibot-worker-heartbeat'
const boss = new PgBoss({ connectionString: config.DATABASE_URL })
const queueName = `channel-tick-${config.TWITCH_CHANNEL}`
const worker = new Worker(pool, config.TWITCH_CHANNEL)
const shutdown = new AbortController()
pool.on('error', () => logger.error('PostgreSQL pool error'))
boss.on('error', () => { logger.error('Job queue error') })
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { shutdown.abort() })
try {
  await boss.start()
  await boss.createQueue(queueName, { retryLimit: 3, retryDelay: 5, expireInSeconds: 120, retentionSeconds: 86400, deleteAfterSeconds: 86400 })
  await boss.work<{ channel: string }>(queueName, { pollingIntervalSeconds: 1 }, async jobs => {
    for (const job of jobs) if (job.data.channel === config.TWITCH_CHANNEL) { await worker.run(); await writeFile(heartbeatPath, String(Date.now())) }
  })
  logger.info('Worker started')
  while (!shutdown.signal.aborted) {
    await boss.send(queueName, { channel: config.TWITCH_CHANNEL }, { singletonKey: config.TWITCH_CHANNEL, singletonSeconds: 2 })
    await delay(1000, undefined, { signal: shutdown.signal }).catch(() => {})
  }
} finally {
  await boss.stop({ graceful: true, timeout: 15000 })
  await rm(heartbeatPath, { force: true })
  await pool.end()
  logger.info('Worker stopped')
}
