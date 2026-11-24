import { z } from 'zod'
import { exchangeCode, getAppToken, refreshUserToken } from '@twurple/auth'
import { DomainError } from '../../../features/src/model.js'
import type { ExternalPrediction, PredictionsPort } from '../../../features/src/predictions.js'
import { decrypt, encrypt } from '../crypto.js'
import { Store } from '../store.js'
import { Http } from './http.js'

const tokenSchema = z.object({ accessToken: z.string(), refreshToken: z.string().nullable(), expiresIn: z.number().nullable(), obtainmentTimestamp: z.number(), scope: z.array(z.string()) })
export type Token = z.infer<typeof tokenSchema>
const identitySchema = z.object({ client_id: z.string(), user_id: z.string(), login: z.string(), scopes: z.array(z.string()), expires_in: z.number() })
const userSchema = z.object({ id: z.string(), login: z.string(), display_name: z.string(), profile_image_url: z.string().optional() })
const predictionSchema = z.object({ id: z.string(), title: z.string(), status: z.string(), created_at: z.string(), outcomes: z.array(z.object({ id: z.string(), title: z.string() })) })
export interface IntegrationConfig { clientId: string, clientSecret: string, encryptionKey: string, eventSecret: string, baseUrl: string, redirectUri: string }
export function integrationConfig (env = process.env): IntegrationConfig {
  const clientId = env.TWITCH_CLIENT_ID; const clientSecret = env.TWITCH_CLIENT_SECRET; const encryptionKey = env.TOKEN_ENCRYPTION_KEY; const eventSecret = env.TWITCH_EVENTSUB_SECRET
  const baseUrl = env.APP_BASE_URL ?? 'http://localhost:3000'
  if (!clientId || !clientSecret || !encryptionKey || !eventSecret || !/^[\x20-\x7e]{10,100}$/.test(eventSecret)) throw new DomainError('Configurar credenciales de Twitch, cifrado y secreto EventSub', 503)
  if (Buffer.from(encryptionKey, 'base64').length !== 32) throw new DomainError('Clave de cifrado inválida', 503)
  const redirectUri = env.TWITCH_REDIRECT_URI || `${baseUrl}/api/auth/twitch/callback`
  if (new URL(redirectUri).origin !== new URL(baseUrl).origin) throw new DomainError('OAuth redirect debe usar el origen de la aplicación', 503)
  return { clientId, clientSecret, encryptionKey, eventSecret, baseUrl, redirectUri }
}
export class Twitch {
  private appToken: Token | undefined
  constructor (readonly store: Store, readonly config: IntegrationConfig, readonly http = new Http()) {}
  async appAccess () {
    if (!this.appToken || Date.now() >= this.appToken.obtainmentTimestamp + (this.appToken.expiresIn ?? 0) * 1000 - 60_000) this.appToken = await getAppToken(this.config.clientId, this.config.clientSecret)
    return this.appToken.accessToken
  }

  async helix (path: string, token: string, method = 'GET', body?: unknown) {
    return this.http.request(`https://api.twitch.tv/helix/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Client-Id': this.config.clientId, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  }

  async user (login: string) {
    const r = z.object({ data: z.array(userSchema) }).parse(await this.helix(`users?login=${encodeURIComponent(login)}`, await this.appAccess()))
    if (!r.data[0]) throw new DomainError('Usuario Twitch inexistente', 404)
    return r.data[0]
  }

  async validate (accessToken: string) {
    const data = identitySchema.parse(await this.http.request('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${accessToken}` } }))
    if (data.client_id !== this.config.clientId) throw new DomainError('Token de otra aplicación', 401)
    return data
  }

  async exchange (code: string) { return exchangeCode(this.config.clientId, this.config.clientSecret, code, this.config.redirectUri) }
  async save (purpose: string, userId: string, token: Token) {
    await this.store.pool.query('INSERT INTO oauth_connections(channel,purpose,user_id,encrypted) VALUES($1,$2,$3,$4) ON CONFLICT(channel,purpose,user_id) DO UPDATE SET encrypted=excluded.encrypted,updated_at=now()', [this.store.channel, purpose, userId, encrypt(token, this.config.encryptionKey)])
  }

  async access (purpose: string, userId?: string) {
    // Serialize rotating refresh tokens across API and worker instances.
    return this.store.transaction(async c => {
      const row = await c.query<{ user_id: string, encrypted: string }>(`
        SELECT user_id, encrypted FROM oauth_connections
        WHERE channel=$1 AND purpose=$2 AND ($3::text IS NULL OR user_id=$3)
          AND (purpose <> 'bot' OR user_id IS DISTINCT FROM (SELECT broadcaster_id FROM channel_state WHERE channel=$1))
        ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`, [this.store.channel, purpose, userId ?? null])
      if (!row.rows[0]) throw new DomainError(`Falta conectar ${purpose}`, 503)
      const record = row.rows[0]
      let token = tokenSchema.parse(decrypt(record.encrypted, this.config.encryptionKey))
      if (token.refreshToken && Date.now() >= token.obtainmentTimestamp + (token.expiresIn ?? 0) * 1000 - 60_000) {
        token = await refreshUserToken(this.config.clientId, this.config.clientSecret, token.refreshToken)
        await c.query('UPDATE oauth_connections SET encrypted=$4,updated_at=now() WHERE channel=$1 AND purpose=$2 AND user_id=$3', [this.store.channel, purpose, record.user_id, encrypt(token, this.config.encryptionKey)])
      }
      return { token: token.accessToken, userId: record.user_id }
    })
  }

  async authorized (userId: string, token: string, broadcasterId: string) {
    const identity = await this.validate(token)
    if (identity.user_id !== userId) return false
    if (userId === broadcasterId) return true
    let cursor = ''
    do {
      const result = z.object({ data: z.array(z.object({ broadcaster_id: z.string() })), pagination: z.object({ cursor: z.string().optional() }) }).parse(await this.helix(`moderation/channels?user_id=${encodeURIComponent(userId)}&first=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`, token))
      if (result.data.some(c => c.broadcaster_id === broadcasterId)) return true
      cursor = result.pagination.cursor ?? ''
    } while (cursor)
    return false
  }

  predictions (broadcasterId: string): PredictionsPort {
    const call = async (method: string, body?: unknown, id?: string): Promise<ExternalPrediction[]> => {
      const access = await this.access('broadcaster', broadcasterId)
      const result = z.object({ data: z.array(predictionSchema) }).parse(await this.helix(method === 'GET' ? `predictions?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=25${id ? `&id=${encodeURIComponent(id)}` : ''}` : 'predictions', access.token, method, body))
      return result.data.map(p => ({ id: p.id, title: p.title, status: p.status, createdAt: Date.parse(p.created_at), outcomes: p.outcomes }))
    }
    return {
      list: () => call('GET'),
      get: async id => (await call('GET', undefined, id))[0] ?? null,
      create: async (title, options, window) => (await call('POST', { broadcaster_id: broadcasterId, title, outcomes: options.map(title => ({ title })), prediction_window: window }))[0]!,
      update: async (id, status, outcome) => (await call('PATCH', { broadcaster_id: broadcasterId, id, status, ...(outcome ? { winning_outcome_id: outcome } : {}) }))[0]!
    }
  }

  async send (broadcasterId: string, message: string, replyTo?: string) {
    const access = await this.access('bot')
    const r = z.object({ data: z.array(z.object({ message_id: z.string(), is_sent: z.boolean() })) }).parse(await this.helix('chat/messages', access.token, 'POST', { broadcaster_id: broadcasterId, sender_id: access.userId, message, ...(replyTo ? { reply_parent_message_id: replyTo } : {}) }))
    if (!r.data[0]?.is_sent) throw new DomainError('Twitch rechazó el mensaje', 422)
    return r.data[0].message_id
  }
}
