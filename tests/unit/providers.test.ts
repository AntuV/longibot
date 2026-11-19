import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encrypt, decrypt, equal, hash, opaque } from '../../packages/infrastructure/src/crypto.js'
import { Http } from '../../packages/infrastructure/src/adapters/http.js'
import { eventTypes, normalize, reconcileSubscriptions, verifyWebhook } from '../../packages/infrastructure/src/adapters/eventsub.js'
import { integrationConfig, Twitch } from '../../packages/infrastructure/src/adapters/twitch.js'
import { Riot, matchResult } from '../../packages/infrastructure/src/adapters/riot.js'
import type { Store } from '../../packages/infrastructure/src/store.js'

vi.mock('@twurple/auth', () => ({ getAppToken: vi.fn(async () => ({ accessToken: 'app', expiresIn: 3600, obtainmentTimestamp: Date.now(), scope: [], refreshToken: null })), exchangeCode: vi.fn(async () => ({ accessToken: 'user', refreshToken: 'refresh', expiresIn: 3600, obtainmentTimestamp: Date.now(), scope: [] })), refreshUserToken: vi.fn(async () => ({ accessToken: 'renewed', refreshToken: 'rotated', expiresIn: 3600, obtainmentTimestamp: Date.now(), scope: [] })) }))
const key = Buffer.alloc(32, 1).toString('base64')
const config = { clientId: 'client', clientSecret: 'secret', encryptionKey: key, eventSecret: 'very-long-secret', baseUrl: 'https://bot.example.com', redirectUri: 'https://bot.example.com/api/auth/twitch/callback' }
const account = { gameName: 'Name', tagLine: 'TAG', puuid: 'p', platform: 'la2' as const, region: 'americas' as const }
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const fetcher = () => vi.fn<typeof fetch>()
afterEach(() => vi.restoreAllMocks())
describe('tokens and config', () => {
  it('uses random opaque identifiers, authenticated encryption and constant-time comparisons', () => {
    const a = opaque(); expect(a).not.toBe(opaque()); expect(hash(a)).toHaveLength(64)
    const token = encrypt({ token: 'secret' }, key)
    expect(decrypt(token, key)).toEqual({ token: 'secret' }); expect(token).not.toContain('secret')
    expect(() => decrypt(token, Buffer.alloc(32, 2).toString('base64'))).toThrow()
    expect(() => decrypt('bad', key)).toThrow(); expect(() => encrypt({}, 'bad')).toThrow()
    expect(equal('a', 'a')).toBe(true); expect(equal('a', 'aa')).toBe(false); expect(equal('a', 'b')).toBe(false)
  })
  it('validates integration config without revealing secrets', () => {
    const env = { TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'secret', TWITCH_EVENTSUB_SECRET: 'long-secret', TOKEN_ENCRYPTION_KEY: key }
    expect(integrationConfig(env).baseUrl).toBe('http://localhost:3000')
    expect(integrationConfig(env).bot).toBeUndefined()
    expect(integrationConfig({ ...env, BOT_TWITCH_CLIENT_ID: ' ttg ', BOT_TWITCH_ACCESS_TOKEN: 'oauth:abc', BOT_TWITCH_REFRESH_TOKEN: 'ref' }).bot).toEqual({ clientId: 'ttg', accessToken: 'abc', refreshToken: 'ref' })
    expect(() => integrationConfig({})).toThrow('Configurar')
    expect(() => integrationConfig({ ...env, TWITCH_EVENTSUB_SECRET: 'a'.repeat(101) })).toThrow()
    expect(() => integrationConfig({ ...env, TOKEN_ENCRYPTION_KEY: 'bad' })).toThrow('cifrado')
    expect(() => integrationConfig({ ...env, TWITCH_REDIRECT_URI: 'https://evil.example' })).toThrow('origen')
    expect(integrationConfig({ ...env, APP_BASE_URL: 'https://ok.example', TWITCH_REDIRECT_URI: 'https://ok.example/callback' }).redirectUri).toContain('/callback')
  })
})
describe('HTTP resilience', () => {
  it('passes payloads, enforces timeouts and handles empty responses', async () => {
    const f = fetcher().mockResolvedValueOnce(json({ ok: true })).mockResolvedValueOnce(new Response(null, { status: 204 }))
    const http = new Http(f)
    expect(await http.request('https://example.com/a', { method: 'POST' })).toEqual({ ok: true })
    expect(f.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(await http.request('https://example.com/b')).toBeNull()
    f.mockRejectedValue(new Error('secret URL')); await expect(http.request('https://example.com/c')).rejects.toMatchObject({ status: 0, message: 'Provider request failed (0)' })
  })
  it('respects Retry-After seconds/date and Twitch rate-limit reset, scoped by host', async () => {
    let now = 1_000_000
    const f = fetcher().mockResolvedValueOnce(json({}, 429, { 'Retry-After': '2' })).mockResolvedValueOnce(json({ ok: true })).mockResolvedValueOnce(json({}, 429, { 'Retry-After': new Date(now + 10_000).toUTCString() })).mockResolvedValueOnce(json({}, 429, { 'Ratelimit-Reset': String((now + 20_000) / 1000) }))
    const http = new Http(f, () => now)
    await expect(http.request('https://a.example')).rejects.toMatchObject({ retryAfter: 2000 })
    await expect(http.request('https://a.example')).rejects.toMatchObject({ status: 429 }); expect(f).toHaveBeenCalledOnce()
    expect(await http.request('https://b.example')).toEqual({ ok: true })
    now += 2000; await expect(http.request('https://a.example')).rejects.toMatchObject({ retryAfter: 8000 })
    await expect(http.request('https://c.example')).rejects.toMatchObject({ retryAfter: 18000 })
    f.mockResolvedValue(json({}, 401)); await expect(http.request('https://d.example')).rejects.toMatchObject({ status: 401, retryAfter: 0 })
  })
})
describe('EventSub signatures and normalization', () => {
  it('validates byte-exact signed bodies, age, challenges, revocations and malformed inputs', () => {
    const now = Date.now(); const timestamp = new Date(now).toISOString(); const raw = Buffer.from(JSON.stringify({ subscription: { id: 's', type: 'stream.online', condition: { broadcaster_user_id: 'b' } }, challenge: 'challenge' }))
    const headers = { 'twitch-eventsub-message-id': 'id', 'twitch-eventsub-message-timestamp': timestamp, 'twitch-eventsub-message-type': 'webhook_callback_verification', 'twitch-eventsub-message-signature': `sha256=${createHmac('sha256', config.eventSecret).update('id' + timestamp).update(raw).digest('hex')}` }
    expect(verifyWebhook(raw, headers, config.eventSecret, now).body.challenge).toBe('challenge')
    expect(() => verifyWebhook(Buffer.from('tampered'), headers, config.eventSecret, now)).toThrow('Firma')
    expect(() => verifyWebhook(raw, headers, config.eventSecret, now + 600001)).toThrow('vencido')
    expect(() => verifyWebhook(raw, headers, config.eventSecret, now - 60001)).toThrow('vencido')
    expect(() => verifyWebhook(raw, { ...headers, 'twitch-eventsub-message-id': ['array'] }, config.eventSecret, now)).toThrow()
    expect(() => verifyWebhook(raw, { ...headers, 'twitch-eventsub-message-type': 'bad' }, config.eventSecret, now)).toThrow('Tipo')
    const invalid = Buffer.from('{}'); const sig = `sha256=${createHmac('sha256', config.eventSecret).update('id' + timestamp).update(invalid).digest('hex')}`
    expect(() => verifyWebhook(invalid, { ...headers, 'twitch-eventsub-message-signature': sig }, config.eventSecret, now)).toThrow('Evento inválido')
    expect(verifyWebhook(raw, { ...headers, 'twitch-eventsub-message-type': 'revocation' }, config.eventSecret, now).type).toBe('revocation')
  })
  it('maps every required signal, distinguishes payment methods and preserves anonymity', () => {
    for (const type of Object.keys(eventTypes)) {
      const e = normalize('id', type, { broadcaster_user_id: 'b' }, 0, 'b')
      expect(e.type).toBe(eventTypes[type]); expect(e.data.providerId).toBe('id')
    }
    const base = { broadcaster_user_id: 'b', user_id: 'u', user_name: 'User' }
    expect(normalize('id', 'channel.bits.use', { ...base, is_anonymous: true, type: 'cheer' }, 0, 'b').data).toMatchObject({ anonymous: true, payment: 'bits', subtype: 'cheer' })
    expect(normalize('id', 'channel.bits.use', { ...base, is_anonymous: true }, 0, 'b').data.userId).toBeUndefined()
    const chat = normalize('id', 'channel.chat.message', { ...base, chatter_user_id: 'u', chatter_user_name: 'U', message: { text: '!ayuda' }, badges: [{ set_id: 'moderator' }] }, 0, 'b')
    expect(chat.data).toMatchObject({ admin: true, text: '!ayuda', userId: 'u' })
    expect(normalize('id', 'channel.chat.message', { ...base, chatter_user_id: 'b' }, 0, 'b').data.admin).toBe(true)
    expect(normalize('id', 'channel.channel_points_automatic_reward_redemption.add', { ...base, reward: { id: 'r', type: 'highlighted_message' } }, 0, 'b').data).toMatchObject({ payment: 'channel_points', rewardId: 'r' })
    expect(normalize('id', 'channel.prediction.end', { ...base, id: 'p', status: 'resolved' }, 0, 'b').data.status).toBe('RESOLVED')
    expect(() => normalize('id', 'bad', base, 0, 'b')).toThrow('soportado')
    expect(() => normalize('id', 'stream.online', base, 0, 'other')).toThrow('otro canal')
  })
  it('reconciles required webhook subscriptions, pagination and already-registered entries', async () => {
    const twitch = new Twitch({} as Store, config)
    vi.spyOn(twitch, 'appAccess').mockResolvedValue('app')
    const helix = vi.spyOn(twitch, 'helix').mockResolvedValue({})
    helix.mockResolvedValueOnce({ data: [], pagination: { cursor: 'next' } }).mockResolvedValueOnce({ data: [{ type: 'stream.online', version: '1', condition: { broadcaster_user_id: 'b' }, status: 'enabled', transport: { callback: `${config.baseUrl}/api/eventsub` } }], pagination: {} })
    await reconcileSubscriptions(twitch, 'b')
    expect(helix).toHaveBeenCalledWith('eventsub/subscriptions?after=next', 'app')
    const subscriptions = helix.mock.calls.filter(c => c[2] === 'POST').map(c => c[3])
    expect(subscriptions).toHaveLength(Object.keys(eventTypes).length - 1)
    expect(subscriptions).toContainEqual(expect.objectContaining({ type: 'channel.chat.message', condition: { broadcaster_user_id: 'b', user_id: 'b' } }))
    expect(subscriptions).toContainEqual(expect.objectContaining({ type: 'channel.follow', version: '2', condition: { broadcaster_user_id: 'b', moderator_user_id: 'b' } }))
    helix.mockReset().mockResolvedValueOnce({ data: [], pagination: {} }).mockRejectedValue(new Error('missing consent'))
    await expect(reconcileSubscriptions(twitch, 'b')).rejects.toThrow('suscribir')
  })
})
describe('Twitch HTTP adapter', () => {
  it('handles app tokens, identity, validation, chat acknowledgements and prediction operations', async () => {
    const f = fetcher(); const twitch = new Twitch({} as Store, config, new Http(f))
    expect(await twitch.appAccess()).toBe('app'); expect(await twitch.appAccess()).toBe('app')
    f.mockResolvedValueOnce(json({ data: [{ id: 'u', login: 'user', display_name: 'User' }] }))
    expect((await twitch.user('user')).id).toBe('u')
    f.mockResolvedValueOnce(json({ data: [] })); await expect(twitch.user('missing')).rejects.toThrow('inexistente')
    f.mockResolvedValueOnce(json({ client_id: 'client', user_id: 'u', login: 'user', scopes: [], expires_in: 3600 }))
    expect((await twitch.validate('token')).user_id).toBe('u')
    f.mockResolvedValueOnce(json({ client_id: 'other', user_id: 'u', login: 'user', scopes: [], expires_in: 3600 })); await expect(twitch.validate('token')).rejects.toThrow('otra aplicación')
    expect((await twitch.exchange('code')).accessToken).toBe('user')
    vi.spyOn(twitch, 'access').mockResolvedValue({ token: 'token', userId: 'bot', clientId: 'ttg' })
    f.mockResolvedValueOnce(json({ data: [{ message_id: 'sent', is_sent: true }] })); expect(await twitch.send('b', 'hello')).toBe('sent')
    expect(new Headers(f.mock.lastCall?.[1]?.headers).get('Client-Id')).toBe('ttg')
    f.mockResolvedValueOnce(json({ client_id: 'ttg', user_id: 'bot', login: 'longibot', scopes: [], expires_in: 3600 })); expect((await twitch.validate('token', 'ttg')).login).toBe('longibot')
    f.mockResolvedValueOnce(json({ data: [{ message_id: '', is_sent: false }] })); await expect(twitch.send('b', 'hello')).rejects.toThrow('rechazó')
    const prediction = { id: 'p', title: 'Question?', status: 'ACTIVE', created_at: new Date().toISOString(), outcomes: [{ id: 'y', title: 'Yes' }, { id: 'n', title: 'No' }] }
    f.mockImplementation(async () => json({ data: [prediction] }))
    const port = twitch.predictions('b')
    expect((await port.list())[0]?.id).toBe('p'); await port.create('Question?', ['Yes', 'No'], 300); await port.update('p', 'RESOLVED', 'y'); await port.update('p', 'CANCELED')
    const post = f.mock.calls.find(c => c[1]?.method === 'POST' && String(c[0]).includes('predictions'))
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ prediction_window: 300, broadcaster_id: 'b' })
  })
  it('checks stable identity, streamer role and paginated moderator access, including revocation', async () => {
    const twitch = new Twitch({} as Store, config)
    const validate = vi.spyOn(twitch, 'validate').mockResolvedValue({ client_id: 'client', user_id: 'u', login: 'user', scopes: [], expires_in: 3600 })
    const helix = vi.spyOn(twitch, 'helix').mockResolvedValue({ data: [], pagination: {} })
    expect(await twitch.authorized('other', 'token', 'b')).toBe(false)
    expect(await twitch.authorized('u', 'token', 'u')).toBe(true)
    expect(await twitch.authorized('u', 'token', 'b')).toBe(false)
    helix.mockResolvedValueOnce({ data: [], pagination: { cursor: 'next' } }).mockResolvedValueOnce({ data: [{ broadcaster_id: 'b' }], pagination: {} })
    expect(await twitch.authorized('u', 'token', 'b')).toBe(true); expect(validate).toHaveBeenCalled()
  })
})
describe('Riot adapter', () => {
  it('uses PUUID, platform/region routes and explicit results, including short ambiguous games', async () => {
    const f = fetcher(); const riot = new Riot('key', new Http(f))
    f.mockResolvedValueOnce(json({ puuid: 'p', gameName: 'Name', tagLine: 'TAG' }))
    expect(await riot.resolve('Name', 'TAG', 'la2', 'americas')).toEqual(account)
    f.mockResolvedValueOnce(json({ gameId: 1, gameStartTime: 0, gameQueueConfigId: 450, participants: [] }))
    expect(await riot.poll(account, 1000)).toMatchObject({ id: 'LA2_1', startedAt: null, queue: 450 })
    f.mockResolvedValueOnce(json({ gameId: 1, gameStartTime: 100, gameQueueConfigId: 420, participants: [] }))
    expect((await riot.poll(account, 1000))?.startedAt).toBe(100)
    f.mockResolvedValueOnce(json({}, 404)); expect(await riot.poll(account, 1000)).toBeNull()
    f.mockResolvedValueOnce(json({}, 404)); expect(await riot.result(account, 'LA2_1')).toBeNull()
    f.mockResolvedValueOnce(json({}, 500)); await expect(riot.active(account)).rejects.toThrow()
    f.mockResolvedValueOnce(json({}, 500)); await expect(riot.result(account, 'LA2_1')).rejects.toThrow()
    f.mockResolvedValueOnce(json(['LA2_1'])); expect(await riot.history(account, 420, 1_000_000)).toEqual(['LA2_1'])
    expect(f.mock.calls.at(-1)?.[0]).toContain('americas.api.riotgames.com/lol/match/v5/matches/by-puuid/p/ids?count=20&queue=420&startTime=1000')
    const match = { metadata: { matchId: 'm' }, info: { queueId: 420, gameStartTimestamp: 100, gameDuration: 100, participants: [{ puuid: 'p', win: false, championId: 1, gameEndedInEarlySurrender: true }] } }
    expect(matchResult(match, 'other')).toBeNull(); expect(matchResult(match, 'p')).toBe('remake')
    match.info.participants[0]!.gameEndedInEarlySurrender = false; expect(matchResult(match, 'p')).toBeNull()
    match.info.gameDuration = 1200; expect(matchResult(match, 'p')).toBe('loss')
    match.info.participants[0]!.win = true; expect(matchResult(match, 'p')).toBe('win')
    f.mockResolvedValueOnce(json(match)); expect((await riot.result(account, 'm'))?.metadata.matchId).toBe('m')
  })
  it('limits budgets across endpoints and respects missing credentials', async () => {
    const f = fetcher().mockImplementation(async () => json([])); const riot = new Riot('key', new Http(f))
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    for (let i = 0; i < 18; i++) await riot.history(account)
    await expect(riot.history(account)).rejects.toMatchObject({ status: 429 })
    for (let n = 1; n <= 4; n++) { now.mockReturnValue(1000 + n * 2000); for (let i = 0; i < 18; i++) await riot.history(account) }
    now.mockReturnValue(20_000); await expect(riot.history(account)).rejects.toMatchObject({ status: 429 })
    now.mockReturnValue(200_000); await riot.history(account)
    await expect(new Riot('', new Http(f)).history(account)).rejects.toThrow('RIOT_API_KEY')
  })
  it('caches current champion catalog and handles every !lol validation branch', async () => {
    const f = fetcher().mockResolvedValueOnce(json(['1.0'])).mockResolvedValueOnce(json({ data: { Ahri: { id: 'Ahri', name: 'Ahri', key: '103' }, Akali: { id: 'Akali', name: 'Akali', key: '84' } } }))
    const riot = new Riot('key', new Http(f))
    expect(await riot.championCatalog()).toHaveProperty('Ahri'); await riot.championCatalog(); expect(f).toHaveBeenCalledTimes(2)
    expect(await riot.lol(account, '')).toContain('Usá')
    const active = vi.spyOn(riot, 'active').mockResolvedValue(null)
    expect(await riot.lol(account, 'Ahri')).toContain('SoloQ')
    active.mockResolvedValue({ gameId: 1, gameStartTime: 1, gameQueueConfigId: 420, participants: [] })
    expect(await riot.lol(account, 'a')).toContain('ambiguo'); expect(await riot.lol(account, 'Ahri')).toContain('no está')
    active.mockResolvedValue({ gameId: 1, gameStartTime: 1, gameQueueConfigId: 420, participants: [{ puuid: 'p2', championId: 103, riotId: 'Player#TAG' }] })
    vi.spyOn(riot, 'history').mockResolvedValue(['m1', 'm2'])
    const result = vi.spyOn(riot, 'result').mockResolvedValue({ metadata: { matchId: 'm' }, info: { gameStartTimestamp: 1, gameDuration: 600, queueId: 420, participants: [{ puuid: 'p2', championId: 103, win: true }] } })
    f.mockResolvedValueOnce(json([{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II', leaguePoints: 30, wins: 10, losses: 5 }]))
    expect(await riot.lol(account, 'Ahri')).toContain('2/2 victorias')
    result.mockResolvedValue(null); f.mockResolvedValueOnce(json([]))
    expect(await riot.lol(account, 'Ahri')).toContain('Sin historial')
    active.mockResolvedValue({ gameId: 1, gameStartTime: 1, gameQueueConfigId: 420, participants: [{ puuid: 'p2', championId: 103 }] }); f.mockResolvedValueOnce(json([]))
    expect(await riot.lol(account, 'Ahri')).toContain('Ahri: sin rango')
  })
})

it('uses the automatic redemption as the primary highlighted-message source and honors bot/owner identities', () => {
  const e = normalize('e', 'channel.channel_points_automatic_reward_redemption.add', { broadcaster_user_id: 'b', reward: { type: 'send_highlighted_message' } }, 0, 'b')
  expect(e.type).toBe('twitch.message.highlighted.v1')
  const bot = normalize('b', 'channel.chat.message', { broadcaster_user_id: 'b', chatter_user_id: 'bot' }, 0, 'b', { botId: 'bot' })
  expect(bot.data.self).toBe(true)
  const owner = normalize('o', 'channel.chat.message', { broadcaster_user_id: 'b', chatter_user_id: 'owner' }, 0, 'b', { ownerId: 'owner' })
  expect(owner.data.admin).toBe(true)
})
it('fetches old managed predictions by ID without relying on the latest page', async () => {
  const f = fetcher(); const twitch = new Twitch({} as Store, config, new Http(f))
  vi.spyOn(twitch, 'access').mockResolvedValue({ token: 'token', userId: 'b', clientId: 'client' })
  f.mockResolvedValueOnce(json({ data: [] }))
  expect(await twitch.predictions('b').get?.('old')).toBeNull()
  f.mockResolvedValueOnce(json({ data: [{ id: 'old', title: 'Q', created_at: new Date().toISOString(), status: 'RESOLVED', outcomes: [] }] }))
  expect((await twitch.predictions('b').get?.('old'))?.status).toBe('RESOLVED')
  expect(f.mock.calls.at(-1)?.[0]).toContain('&id=old')
})
it('validates platform routing before querying Riot', async () => {
  const riot = new Riot('key'); const request = vi.spyOn(riot, 'request').mockResolvedValue({ puuid: 'p', gameName: 'Name', tagLine: 'TAG' })
  for (const [platform, region] of [['kr', 'asia'], ['sg2', 'sea'], ['euw1', 'europe'], ['la2', 'americas']] as const) expect((await riot.resolve('Name', 'TAG', platform, region)).region).toBe(region)
  await expect(riot.resolve('Name', 'TAG', 'la2', 'europe')).rejects.toThrow('routing americas')
  expect(request).toHaveBeenCalledTimes(4)
})
