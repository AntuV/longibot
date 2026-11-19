import { afterEach, expect, it } from 'vitest'
import { createApp } from '../../apps/api/src/app.js'

process.env.DATABASE_URL = 'postgresql://localhost/longibot'
let instance: Awaited<ReturnType<typeof createApp>> | undefined
afterEach(async () => { await instance?.app.close() })
it('exposes liveness, fails readiness without a DB, and has no business routes', async () => {
  instance = await createApp({ logging: false, staticFiles: false })
  await instance.app.init()
  await instance.app.getHttpAdapter().getInstance().ready()
  const server = instance.app.getHttpAdapter().getInstance()
  expect((await server.inject('/api/health/live')).json()).toEqual({ status: 'ok' })
  expect((await server.inject('/api/health/ready')).statusCode).toBe(503)
  expect((await server.inject('/api/admin')).statusCode).toBe(404)
  expect((await server.inject('/api/health/live')).headers['x-content-type-options']).toBe('nosniff')
})
it('handles unavailable integrations and invokes a shutdown hook registered before boot', async () => {
  let closed = false
  instance = await createApp({ logging: false, onClose: async () => { closed = true } })
  const server = instance.app.getHttpAdapter().getInstance()
  expect((await server.inject('/api/auth/twitch')).statusCode).toBe(503)
  expect((await server.inject('/api/auth/me')).statusCode).toBe(503)
  expect((await server.inject('/api/admin/state')).statusCode).toBe(503)
  await instance.app.close(); instance = undefined
  expect(closed).toBe(true)
})
