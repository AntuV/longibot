import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PgBoss } from 'pg-boss'
import { eq } from 'drizzle-orm'
import { createDatabase } from '../../packages/infrastructure/src/database.js'
import { runtimeMetadata } from '../../packages/infrastructure/src/schema.js'
import { createApp } from '../../apps/api/src/app.js'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; use a disposable test database')
const { pool, db } = createDatabase(process.env.DATABASE_URL)
const schema = `test_${randomUUID().replaceAll('-', '')}`
let boss: PgBoss
beforeAll(async () => { boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema }); await boss.start() })
afterAll(async () => { await boss?.stop(); await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end() })

it('applies migrations and rolls back a transaction without persisting partial state', async () => {
  const key = randomUUID()
  await expect(db.transaction(async tx => {
    await tx.insert(runtimeMetadata).values({ key, value: { test: true } })
    throw new Error('rollback')
  })).rejects.toThrow('rollback')
  expect(await db.select().from(runtimeMetadata).where(eq(runtimeMetadata.key, key))).toEqual([])
})

it('enforces uniqueness and exclusion across independent PostgreSQL connections', async () => {
  const key = randomUUID()
  try {
    await db.insert(runtimeMetadata).values({ key, value: {} })
    await expect(db.insert(runtimeMetadata).values({ key, value: {} })).rejects.toThrow()
    const a = await pool.connect(); const b = await pool.connect()
    try {
      await a.query('BEGIN')
      await a.query('SELECT pg_advisory_xact_lock(74120937)')
      expect((await b.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock(74120937) AS locked')).rows[0]?.locked).toBe(false)
    } finally { await a.query('ROLLBACK'); a.release(); b.release() }
  } finally { await db.delete(runtimeMetadata).where(eq(runtimeMetadata.key, key)) }
})

it('retains a queued job across restart and processes it', async () => {
  await boss.createQueue('smoke')
  const id = await boss.send('smoke', { test: true })
  expect(id).toBeTruthy()
  await boss.stop()
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema })
  await boss.start()
  const delivered = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Job delivery timed out')), 15000)
    boss.work('smoke', async jobs => {
      try { expect(jobs[0]?.id).toBe(id); resolve() } catch (error) { reject(error) } finally { clearTimeout(timeout) }
    }).catch(reject)
  })
  await delivered
})

it('reports database readiness over the real HTTP adapter', async () => {
  const { app } = await createApp({ pool, logging: false, staticFiles: false })
  try {
    await app.init(); await app.getHttpAdapter().getInstance().ready()
    expect((await app.getHttpAdapter().getInstance().inject('/api/health/ready')).statusCode).toBe(200)
  } finally { await app.close() }
})
