import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDatabase } from '../../packages/infrastructure/src/database.js'
import { Store } from '../../packages/infrastructure/src/store.js'
import { Twitch } from '../../packages/infrastructure/src/adapters/twitch.js'
import { Auth, scopes } from '../../packages/infrastructure/src/auth.js'
import { hash, encrypt, decrypt } from '../../packages/infrastructure/src/crypto.js'
import { initialState } from '../../packages/features/src/model.js'
import { observeGame, confirmGame } from '../../packages/features/src/games.js'
import { addReminder } from '../../packages/features/src/reminders.js'
import { createApp } from '../../apps/api/src/app.js'
import * as eventsub from '../../packages/infrastructure/src/adapters/eventsub.js'
import { Riot } from '../../packages/infrastructure/src/adapters/riot.js'
import { Runtime } from '../../packages/infrastructure/src/runtime.js'
import { ProviderError } from '../../packages/infrastructure/src/adapters/http.js'
import { Worker } from '../../apps/worker/src/worker.js'
import { features } from '../../packages/features/src/registry.js'
import { createHmac } from 'node:crypto'

vi.mock('@twurple/auth', () => ({ getAppToken: vi.fn(), exchangeCode: vi.fn(), refreshUserToken: vi.fn(async () => ({ accessToken: 'renewed', refreshToken: 'rotated', expiresIn: 3600, obtainmentTimestamp: Date.now(), scope: [] })) }))
if (!process.env.DATABASE_URL) throw new Error('Use a disposable PostgreSQL database')
const { pool } = createDatabase(process.env.DATABASE_URL)
const channel = `test_${randomUUID().slice(0, 8)}`
const store = new Store(pool, channel)
const key = Buffer.alloc(32, 1).toString('base64')
const config = { clientId: 'client', clientSecret: 'secret', encryptionKey: key, eventSecret: 'long-event-secret', baseUrl: 'https://bot.example.com', redirectUri: 'https://bot.example.com/api/auth/twitch/callback' }
const token = { accessToken: 'user', refreshToken: 'refresh', expiresIn: 3600, obtainmentTimestamp: Date.now(), scope: [] }
const identity = { client_id: 'client', user_id: 'b', login: 'streamer', scopes: [...scopes.dashboard, ...scopes.broadcaster, ...scopes.bot], expires_in: 3600 }
const twitch = new Twitch(store, config)
vi.spyOn(twitch, 'user').mockResolvedValue({ id: 'b', login: channel, display_name: 'Streamer' })
vi.spyOn(twitch, 'access').mockResolvedValue({ token: 'user', userId: 'b' })
const validate = vi.spyOn(twitch, 'validate').mockImplementation(async () => ({ ...identity }))
const authorized = vi.spyOn(twitch, 'authorized').mockResolvedValue(true)
vi.spyOn(twitch, 'exchange').mockResolvedValue(token)
const auth = new Auth(store, twitch)
let app: Awaited<ReturnType<typeof createApp>>['app']
let cookie: string
let csrf: string
const now = Date.now()
const actor = { id: 'b', name: 'Streamer', admin: true }
beforeAll(async () => {
  await store.initialize('b')
  process.env.TWITCH_CHANNEL = channel
  const instance = await createApp({ pool, logging: false, staticFiles: false, twitch })
  app = instance.app; await app.init(); await app.getHttpAdapter().getInstance().ready()
  const started = await auth.start('dashboard')
  const id = (await auth.callback(started.state, started.state, 'code'))!
  cookie = `lb_session=${id}`; csrf = (await auth.session(id)).csrf
})
afterAll(async () => {
  await app?.close()
  for (const table of ['event_deliveries', 'event_inbox', 'sessions', 'oauth_states', 'oauth_connections', 'admin_audit', 'channel_state']) await pool.query(`DELETE FROM ${table} WHERE channel=$1`, [channel])
  await pool.query('DELETE FROM runtime_metadata WHERE key=$1', [`worker:${channel}`])
  await pool.end()
})
const inject = (url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', payload?: Record<string, unknown> | string, headers: Record<string, string> = {}) => app.getHttpAdapter().getInstance().inject({ url, method, headers: { cookie, origin: config.baseUrl, 'x-csrf-token': csrf, ...headers }, ...(payload !== undefined ? { payload } : {}) })

describe('PostgreSQL durable state', () => {
  it('keeps stable channel identity and rolls back domain state and outputs atomically', async () => {
    await store.initialize('b'); await expect(store.initialize('other')).rejects.toThrow('ID')
    await expect(store.change(s => { s.live = true; throw new Error('rollback') })).rejects.toThrow('rollback')
    expect((await store.read()).live).toBe(false)
    const other = new Store(pool, 'missing')
    expect(await other.identity()).toBeUndefined(); expect(await other.read()).toEqual(initialState())
    await expect(other.change(() => {})).rejects.toThrow('conectado'); await expect(other.emit(() => [])).rejects.toThrow('conectado')
  })
  it('deduplicates concurrent ingress and fans out to every consumer across restart', async () => {
    const e = { id: 'duplicate', type: 'stream.started.v1', at: now, data: {} }
    const results = await Promise.all(Array.from({ length: 8 }, () => store.ingest(e)))
    expect(results.filter(Boolean)).toHaveLength(1)
    const restarted = new Store(pool, channel)
    await Promise.all([store.deliver(), restarted.deliver()])
    expect((await store.read()).live).toBe(true)
    const deliveries = await store.deliveries()
    expect(deliveries.filter(d => d.event_id === 'duplicate')).toHaveLength(2)
    expect(deliveries.filter(d => d.event_id === 'duplicate').every(d => d.completed_at)).toBe(true)
    expect((await store.events()).some(e => e.data.id === 'duplicate')).toBe(true)
  })
  it('retries failed consumers separately without committing partial state or starving others', async () => {
    const handler = features.find(f => f.name === 'reminders')!
    const spy = vi.spyOn(handler, 'handle').mockImplementationOnce(s => { s.live = true; throw new Error('failed partial reduction') })
    await store.change(s => { s.live = false })
    await store.ingest({ id: 'consumer-failure', type: 'custom.event.v1', at: now, data: {} })
    await store.deliver()
    const rows = (await store.deliveries()).filter(d => d.event_id === 'consumer-failure')
    expect(rows.find(r => r.consumer === 'channel-events')?.completed_at).toBeTruthy()
    expect(rows.find(r => r.consumer === 'reminders')?.last_error).toBe('Consumer failed')
    expect((await store.read()).live).toBe(false)
    spy.mockRestore()
    await pool.query("UPDATE event_deliveries SET next_attempt_at=now() WHERE channel=$1 AND event_id='consumer-failure'", [channel])
    await store.deliver()
    expect((await store.deliveries()).find(d => d.event_id === 'consumer-failure' && d.consumer === 'reminders')?.attempts).toBe(2)
  })
  it('serializes assignments and win-producing commands without losing concurrent changes', async () => {
    await store.change(s => { s.tracking = 'idle'; s.settings.stories.enabled = true })
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.change(s => addReminder(s, actor, `r${i}`, `Text ${i}`, now))))
    await store.emit(s => observeGame(s, { id: 'LA2_1', startedAt: now + 10, observedAt: now + 10, queue: 420 }, now + 10))
    await store.deliver()
    const s = await store.read(); expect(Object.values(s.reminders).every(r => r.gameId === 'LA2_1')).toBe(true)
    await store.emit(s => confirmGame(s, 'LA2_1', now + 100, 'win'))
    await new Store(pool, channel).deliver()
    expect(Object.keys((await store.read()).messages).filter(id => id.startsWith('reminder:'))).toHaveLength(20)
  })
  it('reconciles an unknown enqueue before a newly observed game even when consumers run after polling', async () => {
    const isolated = new Store(pool, `recovery_${randomUUID().slice(0, 8)}`)
    await isolated.initialize('b')
    const riot = new Riot('key')
    vi.spyOn(riot, 'history').mockResolvedValue([])
    vi.spyOn(riot, 'poll').mockResolvedValue({ id: 'NEW_1', startedAt: now + 100, observedAt: now + 200, queue: 450 })
    vi.spyOn(riot, 'result').mockResolvedValue(null)
    const runtime = new Runtime(isolated, riot, twitch, { list: async () => [], create: vi.fn(), update: vi.fn() }, 'b')
    try {
      await isolated.change(s => { s.account = { gameName: 'Name', tagLine: 'TAG', platform: 'la2', region: 'americas', puuid: 'p' }; addReminder(s, actor, 'unknown', 'next game', now) })
      await runtime.poll(now + 200)
      expect((await isolated.read()).reminders.unknown?.status).toBe('awaiting_game_assignment')
      await isolated.deliver()
      expect((await isolated.read()).reminders.unknown?.gameId).toBe('NEW_1')
    } finally {
      for (const table of ['event_deliveries', 'event_inbox', 'channel_state']) await pool.query(`DELETE FROM ${table} WHERE channel=$1`, [isolated.channel])
    }
  })
  it('does not expose or mix data when the deployment changes channels', async () => {
    const other = new Store(pool, `other_${randomUUID().slice(0, 8)}`)
    try {
      await other.initialize('other-id')
      expect((await other.read()).reminders).toEqual({}); expect(await other.events()).toEqual([])
      await expect(new Auth(other, twitch).session(cookie.split('=')[1])).rejects.toThrow('inválida')
    } finally { await pool.query('DELETE FROM channel_state WHERE channel=$1', [other.channel]) }
  })
  it('persists encrypted rotating credentials under exclusion and separates identities', async () => {
    const real = new Twitch(store, config)
    const expiring = { ...token, obtainmentTimestamp: 0, expiresIn: 0 }
    await real.save('refresh-test', 'u', expiring)
    const results = await Promise.all([real.access('refresh-test', 'u'), real.access('refresh-test', 'u')])
    expect(results).toEqual([{ userId: 'u', token: 'renewed' }, { userId: 'u', token: 'renewed' }])
    const row = await pool.query<{ encrypted: string }>('SELECT encrypted FROM oauth_connections WHERE channel=$1 AND purpose=$2', [channel, 'refresh-test'])
    expect(row.rows[0]?.encrypted).not.toContain('rotated'); expect(decrypt(row.rows[0]!.encrypted, key)).toMatchObject({ refreshToken: 'rotated' })
    await real.save('no-refresh', 'u', { ...expiring, refreshToken: null })
    expect((await real.access('no-refresh')).token).toBe('user')
    await expect(real.access('missing')).rejects.toThrow('Falta conectar')
    await pool.query('UPDATE oauth_connections SET encrypted=$3 WHERE channel=$1 AND purpose=$2', [channel, 'no-refresh', encrypt({ bad: true }, key)])
    await expect(real.access('no-refresh')).rejects.toThrow()
  })
})
describe('OAuth, roles and session security', () => {
  it('binds one-time state to the browser and rejects replay, expiry and denied consent', async () => {
    const a = await auth.start('dashboard')
    expect(new URL(a.url).searchParams.get('scope')).toBe('user:read:moderated_channels')
    await expect(auth.callback(a.state, undefined, 'code')).rejects.toThrow('state')
    await expect(auth.callback(a.state, 'bad', 'code')).rejects.toThrow('state')
    const id = await auth.callback(a.state, a.state, 'code'); expect(id).toBeTruthy()
    await expect(auth.callback(a.state, a.state, 'code')).rejects.toThrow('reutilizado')
    const denied = await auth.start('dashboard'); await expect(auth.callback(denied.state, denied.state, '')).rejects.toThrow('cancelada')
    const expired = await auth.start('dashboard'); await pool.query('UPDATE oauth_states SET expires_at=now()-interval \'1 second\' WHERE id=$1', [hash(expired.state)])
    await expect(auth.callback(expired.state, expired.state, 'code')).rejects.toThrow('vencido')
    await expect(auth.session(undefined)).rejects.toThrow('Iniciá')
    if (id) await auth.logout(id)
  })
  it('requires complete scopes and rejects outsiders or revoked mods on every administrative request', async () => {
    const a = await auth.start('dashboard'); validate.mockResolvedValueOnce({ ...identity, scopes: [] })
    await expect(auth.callback(a.state, a.state, 'code')).rejects.toThrow('permisos')
    const b = await auth.start('dashboard'); authorized.mockResolvedValueOnce(false)
    await expect(auth.callback(b.state, b.state, 'code')).rejects.toThrow('reservado')
    const c = await auth.start('dashboard'); const id = (await auth.callback(c.state, c.state, 'code'))!
    authorized.mockResolvedValueOnce(false); await expect(auth.session(id)).rejects.toThrow('verificar')
    await expect(auth.session(id)).rejects.toThrow('inválida')
  })
  it('limits new states, separates bot/broadcaster consent and requires the streamer to initiate', async () => {
    const current = cookie.split('=')[1]!
    await expect(auth.start('bot')).rejects.toThrow()
    // A valid mod cannot connect the broadcaster or bot identities.
    await pool.query('INSERT INTO sessions(id,channel,user_id,name,csrf,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval \'1 hour\')', [hash('mod-session'), channel, 'mod', 'Mod', 'csrf'])
    await expect(auth.start('broadcaster', 'mod-session')).rejects.toThrow('streamer')
    const a = await auth.start('broadcaster', current); validate.mockResolvedValueOnce({ ...identity, user_id: 'mod' })
    await expect(auth.callback(a.state, a.state, 'code')).rejects.toThrow('streamer')
    const b = await auth.start('broadcaster', current); expect(await auth.callback(b.state, b.state, 'code')).toBeUndefined()
    const c = await auth.start('bot', current); expect(await auth.callback(c.state, c.state, 'code')).toBeUndefined()
    await pool.query('INSERT INTO oauth_states(id,channel,purpose,expires_at) SELECT md5(i::text),$1,\'dashboard\',now()+interval \'1 minute\' FROM generate_series(1,100) i', [channel])
    await expect(auth.start('dashboard')).rejects.toThrow('Demasiados')
    await pool.query('DELETE FROM oauth_states WHERE channel=$1', [channel])
  })
})
describe('administrative HTTP routes', () => {
  it('rejects unauthenticated routes, invalid CSRF, invalid JSON and unknown routes', async () => {
    expect((await inject('/api/admin/state', 'GET', undefined, { cookie: '' })).statusCode).toBe(401)
    expect((await inject('/api/admin/settings', 'PUT', {}, { 'x-csrf-token': '' })).statusCode).toBe(403)
    expect((await inject('/api/admin/settings', 'PUT', {}, { origin: 'https://evil.example' })).statusCode).toBe(403)
    expect((await inject('/api/admin/reminders', 'POST', { text: '' })).statusCode).toBe(400)
    expect((await inject('/api/admin/reminders', 'POST', '{bad', { 'content-type': 'application/json' })).statusCode).toBe(400)
    expect((await inject('/api/admin/account', 'PUT', {})).statusCode).toBe(400)
    expect((await inject('/api/unknown')).statusCode).toBe(404)
    const response = await inject('/api/auth/me'); expect(response.json()).toMatchObject({ name: 'streamer', channel, streamer: true })
  })
  it('manages reminders, configuration, question CRUD, audit and operations without leaking secrets', async () => {
    const response = await inject('/api/admin/reminders', 'POST', { text: 'dashboard reminder' }); expect(response.statusCode).toBe(200)
    const reminder = response.json() as { id: string }
    expect((await inject(`/api/admin/reminders/${reminder.id}`, 'DELETE')).statusCode).toBe(200)
    expect((await inject('/api/admin/reminders/missing', 'DELETE')).statusCode).toBe(404)
    const settings = initialState().settings; expect((await inject('/api/admin/settings', 'PUT', settings)).statusCode).toBe(200)
    expect((await inject('/api/admin/settings', 'PUT', { ...settings, channel: 'other' })).statusCode).toBe(400)
    const q = { text: 'Question?', answers: ['answer', 'alternative'] }
    expect((await inject('/api/admin/questions', 'POST', q)).statusCode).toBe(200)
    expect((await inject('/api/admin/questions/q', 'PUT', q)).statusCode).toBe(200)
    expect((await inject('/api/admin/questions/bad%20id', 'PUT', q)).statusCode).toBe(400)
    await store.change(s => { s.rounds.r = { id: 'r', questionId: 'q', expiresAt: now + 1000, status: 'active' } })
    expect((await inject('/api/admin/questions/q', 'DELETE')).statusCode).toBe(409)
    await store.change(s => { s.rounds.r!.status = 'skipped' }); expect((await inject('/api/admin/questions/q', 'DELETE')).statusCode).toBe(200)
    const state = await inject('/api/admin/state'); expect(state.json().channel).toBe(channel)
    const operations = await inject('/api/admin/operations'); expect(operations.statusCode).toBe(200)
    expect(operations.body).not.toContain('refreshToken'); expect(operations.body).not.toContain('secret')
    expect((await store.audit()).length).toBeGreaterThan(0)
  })
  it('queues managed prediction operations and rejects foreign outcomes and final states', async () => {
    await store.change(s => { s.predictions.test = { gameId: 'test', status: 'ACTIVE', twitchId: 't', createdAt: now, outcomes: [{ id: 'yes', title: 'Sí' }] } })
    expect((await inject('/api/admin/predictions/missing', 'POST', { status: 'LOCKED' })).statusCode).toBe(409)
    expect((await inject('/api/admin/predictions/test', 'POST', { status: 'RESOLVED', outcome: 'foreign' })).statusCode).toBe(400)
    expect((await inject('/api/admin/predictions/test', 'POST', { status: 'RESOLVED', outcome: 'yes' })).statusCode).toBe(200)
    expect((await inject('/api/admin/predictions/test', 'POST', { status: 'LOCKED' })).statusCode).toBe(200)
    expect((await inject('/api/admin/predictions/test', 'POST', { status: 'CANCELED' })).statusCode).toBe(200)
    await store.change(s => { s.predictions.test!.status = 'RESOLVED' })
    expect((await inject('/api/admin/predictions/test', 'POST', { status: 'LOCKED' })).statusCode).toBe(409)
    await store.change(s => { s.messages.uncertain = { id: 'uncertain', text: 'x', status: 'unknown', createdAt: now, attempts: 1, reminderId: 'r0' } })
    expect((await inject('/api/admin/messages/uncertain/review', 'POST', { decision: 'retry' })).statusCode).toBe(200)
    expect((await inject('/api/admin/messages/uncertain/review', 'POST', { decision: 'sent' })).statusCode).toBe(409)
    await store.change(s => { s.messages.uncertain!.status = 'unknown' })
    expect((await inject('/api/admin/messages/uncertain/review', 'POST', { decision: 'sent' })).statusCode).toBe(200)
  })
  it('links an uncertain creation only through explicit admin verification', async () => {
    const port = { list: vi.fn(async () => [{ id: 'remote', title: 'Q', status: 'LOCKED', createdAt: now, outcomes: [] }]), create: vi.fn(), update: vi.fn() }
    vi.spyOn(twitch, 'predictions').mockReturnValue(port)
    await store.change(s => { s.predictions.unknown = { gameId: 'unknown', createdAt: now, status: 'creation_unknown' } })
    expect((await inject('/api/admin/predictions/unknown/link', 'POST', { twitchId: 'missing' })).statusCode).toBe(404)
    expect((await inject('/api/admin/predictions/unknown/link', 'POST', { twitchId: 'remote' })).statusCode).toBe(200)
    expect((await inject('/api/admin/predictions/unknown/link', 'POST', { twitchId: 'remote' })).statusCode).toBe(409)
  })
  it('resolves Riot IDs server-side and refuses changing accounts during a game', async () => {
    const account = { gameName: 'Name', tagLine: 'TAG', platform: 'la2' as const, region: 'americas' as const, puuid: 'p' }
    const resolve = vi.spyOn(Riot.prototype, 'resolve').mockResolvedValue(account)
    expect((await inject('/api/admin/account', 'PUT', account)).statusCode).toBe(400) // PUUID cannot be supplied by a client.
    const request = { gameName: 'Name', tagLine: 'TAG', platform: 'la2', region: 'americas' }
    await store.change(s => { s.games.active = { id: 'active', startedAt: now, observedAt: now, queue: 420, historic: false } })
    expect((await inject('/api/admin/account', 'PUT', request)).statusCode).toBe(409)
    await store.change(s => { s.games.active!.endedAt = now + 1 })
    expect((await inject('/api/admin/account', 'PUT', request)).statusCode).toBe(200)
    resolve.mockRestore()
  })
  it('validates signed challenges and persists events before acknowledging notifications', async () => {
    const timestamp = new Date().toISOString()
    const signed = (id: string, type: string, data: unknown) => {
      const payload = JSON.stringify(data)
      const signature = `sha256=${createHmac('sha256', config.eventSecret).update(id + timestamp).update(payload).digest('hex')}`
      return inject('/api/eventsub', 'POST', payload, { 'content-type': 'application/json', 'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': timestamp, 'twitch-eventsub-message-type': type, 'twitch-eventsub-message-signature': signature })
    }
    const subscription = { id: 's', type: 'stream.online', condition: { broadcaster_user_id: 'b' } }
    const challenge = await signed('challenge', 'webhook_callback_verification', { subscription, challenge: 'challenge' })
    expect(challenge.statusCode).toBe(200); expect(challenge.body).toBe('challenge')
    const notify = { subscription, event: { broadcaster_user_id: 'b' } }
    expect((await signed('notify', 'notification', notify)).statusCode).toBe(204)
    expect((await signed('notify', 'notification', notify)).statusCode).toBe(204)
    expect((await signed('revoked', 'revocation', { subscription: { ...subscription, status: 'authorization_revoked' } })).statusCode).toBe(204)
    expect((await signed('foreign', 'notification', { subscription: { ...subscription, condition: { broadcaster_user_id: 'other' } } })).statusCode).toBe(403)
    expect((await inject('/api/eventsub', 'POST', notify)).statusCode).toBe(403)
    expect((await store.events()).filter(e => e.data.id === 'notify')).toHaveLength(1)
  })
  it('sets HttpOnly browser-bound cookies and rotates/logout sessions through HTTP', async () => {
    const start = await inject('/api/auth/twitch'); expect(start.statusCode).toBe(302)
    const state = new URL(start.headers.location!).searchParams.get('state')!
    const callback = await inject(`/api/auth/twitch/callback?state=${state}&code=code`, 'GET', undefined, { cookie: `lb_oauth=${state}; ${cookie}` })
    expect(callback.statusCode).toBe(302); expect(String(callback.headers['set-cookie'])).toContain('HttpOnly')
    const next = String(callback.headers['set-cookie']).match(/lb_session=([^;]+)/)![1]!
    cookie = `lb_session=${next}`; csrf = (await auth.session(next)).csrf
    expect((await inject('/api/auth/logout', 'POST')).statusCode).toBe(204)
    expect((await inject('/api/admin/state')).statusCode).toBe(401)
    // Restore a session for any later tests.
    const restore = await auth.start('dashboard'); const id = (await auth.callback(restore.state, restore.state, 'code'))!
    cookie = `lb_session=${id}`; csrf = (await auth.session(id)).csrf
  })
})
describe('worker exclusion and local health', () => {
  it('keeps overlapping instances from running the same channel concurrently', async () => {
    const client = await pool.connect()
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [`worker:${channel}`])
      const worker = new Worker(pool, channel); await worker.run(); expect(worker.runtime).toBeUndefined()
    } finally { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`worker:${channel}`]); client.release() }
    const worker = new Worker(pool, channel)
    await worker.run(); expect(worker.runtime).toBeUndefined() // credentials intentionally absent
    expect((await pool.query('SELECT value FROM runtime_metadata WHERE key=$1', [`worker:${channel}`])).rowCount).toBe(1)
  })
  it('runs local work, reconciliation, backoff and retention independently of external failures', async () => {
    const worker = new Worker(pool, channel)
    worker.twitch = twitch
    const runtime = new Runtime(store, new Riot('key'), twitch, { list: async () => [], create: vi.fn(), update: vi.fn() }, 'b')
    worker.runtime = runtime
    const tick = vi.spyOn(runtime, 'tick').mockResolvedValue()
    const poll = vi.spyOn(runtime, 'poll').mockResolvedValue()
    const subs = vi.spyOn(eventsub, 'reconcileSubscriptions').mockResolvedValue()
    const helix = vi.spyOn(twitch, 'helix').mockResolvedValue({ data: [{}] })
    const appAccess = vi.spyOn(twitch, 'appAccess').mockResolvedValue('app')
    const old = now - 40 * 86400_000
    await store.change(s => {
      s.cooldowns = {}
      s.messages.old = { id: 'old', text: 'sent', status: 'sent', attempts: 1, createdAt: old }
      s.messages.keep = { id: 'keep', text: 'unknown', status: 'unknown', attempts: 1, createdAt: old }
    })
    await store.ingest({ id: 'old-event', type: 'stream.ended.v1', at: old, data: {} }); await store.deliver()
    await pool.query("UPDATE event_inbox SET received_at=now()-interval '40 days' WHERE channel=$1 AND id='old-event'", [channel])
    await worker.run(now)
    expect(tick).toHaveBeenCalled(); expect(poll).toHaveBeenCalled(); expect(subs).toHaveBeenCalled()
    expect((await store.read()).messages.old).toBeUndefined(); expect((await store.read()).messages.keep).toBeDefined()
    expect((await store.events()).find(e => e.data.id === 'old-event')).toBeUndefined()
    await worker.run(now + 1); expect(poll).toHaveBeenCalledTimes(1); expect(subs).toHaveBeenCalledTimes(1)
    await store.change(s => { s.cooldowns['subscriptions:next'] = 0; s.cooldowns['riot:next'] = 0 })
    helix.mockResolvedValue({ data: [] }); subs.mockRejectedValueOnce(new Error('failure')); poll.mockRejectedValueOnce(new ProviderError(429, 120_000))
    await worker.run(now + 1000)
    const state = await store.read()
    expect(state.cooldowns['riot:next']).toBe(now + 121_000); expect(state.cooldowns['subscriptions:next']).toBe(now + 61_000)
    expect(state.errors.some(e => e.feature === 'subscriptions')).toBe(true)
    await store.change(s => { s.cooldowns['riot:next'] = 0 }); poll.mockRejectedValueOnce(new Error('network')); await worker.run(now + 2000)
    expect((await store.read()).cooldowns['riot:next']).toBe(now + 92_000)
    helix.mockRestore(); appAccess.mockRestore(); subs.mockRestore()
    const missing = new Worker(pool, 'no-channel'); await missing.run(); expect(missing.runtime).toBeUndefined()
    await pool.query('DELETE FROM runtime_metadata WHERE key=$1', ['worker:no-channel'])
  })
  it('fails closed before effects when the configured login resolves to another broadcaster ID', async () => {
    const worker = new Worker(pool, channel); worker.twitch = twitch
    worker.runtime = new Runtime(store, new Riot('key'), twitch, { list: async () => [], create: vi.fn(), update: vi.fn() }, 'b')
    const tick = vi.spyOn(worker.runtime, 'tick').mockResolvedValue()
    const lookup = vi.mocked(twitch.user)
    lookup.mockResolvedValueOnce({ id: 'different', login: channel, display_name: 'Other' })
    await worker.run(now)
    expect(tick).not.toHaveBeenCalled(); expect((await store.read()).errors.at(-1)?.feature).toBe('channel')
    await worker.run(now + 1); expect(tick).not.toHaveBeenCalled()
  })
})
