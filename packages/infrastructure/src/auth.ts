import { DomainError } from '../../features/src/model.js'
import { opaque, hash, equal } from './crypto.js'
import type { Store } from './store.js'
import type { Twitch } from './adapters/twitch.js'

export const scopes = {
  dashboard: ['user:read:moderated_channels'],
  broadcaster: ['channel:manage:predictions', 'channel:read:redemptions', 'bits:read', 'channel:read:subscriptions', 'moderator:read:followers', 'channel:bot', 'user:read:chat']
} as const
export type Purpose = keyof typeof scopes
export interface Session { userId: string, name: string, csrf: string, admin: true, streamer: boolean }
export type AuthTwitch = Pick<Twitch, 'config' | 'user' | 'exchange' | 'validate' | 'save' | 'access' | 'authorized'>
export class Auth {
  constructor (readonly store: Store, readonly twitch: AuthTwitch) {}
  async start (purpose: Purpose, sessionId?: string) {
    if (purpose !== 'dashboard') {
      const session = await this.session(sessionId)
      if (!session.streamer) throw new DomainError('Solo el streamer puede conectar identidades', 403)
    }
    const user = await this.twitch.user(this.store.channel)
    await this.store.initialize(user.id)
    const count = await this.store.pool.query<{ count: string }>('SELECT count(*) FROM oauth_states WHERE channel=$1 AND expires_at>now()', [this.store.channel])
    if (Number(count.rows[0]?.count) >= 100) throw new DomainError('Demasiados intentos de login; esperá unos minutos', 429)
    const state = opaque()
    await this.store.pool.query('INSERT INTO oauth_states(id,channel,purpose,expires_at) VALUES($1,$2,$3,now()+interval \'10 minutes\')', [hash(state), this.store.channel, purpose])
    const params = new URLSearchParams({ client_id: this.twitch.config.clientId, redirect_uri: this.twitch.config.redirectUri, response_type: 'code', scope: scopes[purpose].join(' '), state, force_verify: 'true' })
    return { state, url: `https://id.twitch.tv/oauth2/authorize?${params}` }
  }

  async callback (state: string, binding: string | undefined, code: string) {
    if (!binding || !equal(state, binding)) throw new DomainError('OAuth state inválido', 403)
    const row = await this.store.pool.query<{ purpose: Purpose }>('DELETE FROM oauth_states WHERE id=$1 AND channel=$2 AND expires_at>now() RETURNING purpose', [hash(state), this.store.channel])
    const purpose = row.rows[0]?.purpose
    if (!purpose) throw new DomainError('OAuth state vencido o reutilizado', 403)
    if (!code) throw new DomainError('Autorización cancelada')
    const token = await this.twitch.exchange(code)
    const identity = await this.twitch.validate(token.accessToken)
    if (!scopes[purpose].every(scope => identity.scopes.includes(scope))) throw new DomainError('Faltan permisos OAuth requeridos', 403)
    const broadcasterId = await this.store.identity()
    if (!broadcasterId) throw new DomainError('Canal no conectado', 503)
    if (purpose === 'broadcaster' && identity.user_id !== broadcasterId) throw new DomainError('Autorizar con la cuenta del streamer', 403)
    if (purpose === 'dashboard' && !await this.twitch.authorized(identity.user_id, token.accessToken, broadcasterId)) throw new DomainError('Acceso reservado a streamer y moderadores actuales', 403)
    await this.twitch.save(purpose, identity.user_id, token)
    if (purpose !== 'dashboard') return undefined
    const id = opaque(); const csrf = opaque()
    await this.store.pool.query('INSERT INTO sessions(id,channel,user_id,name,csrf,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval \'8 hours\')', [hash(id), this.store.channel, identity.user_id, identity.login, csrf])
    return id
  }

  async session (id: string | undefined): Promise<Session> {
    if (!id) throw new DomainError('Iniciá sesión con Twitch', 401)
    const row = await this.store.pool.query<{ user_id: string, name: string, csrf: string }>('SELECT user_id,name,csrf FROM sessions WHERE id=$1 AND channel=$2 AND expires_at>now()', [hash(id), this.store.channel])
    const session = row.rows[0]
    if (!session) throw new DomainError('Sesión inválida o vencida', 401)
    const broadcasterId = await this.store.identity()
    try {
      const access = await this.twitch.access('dashboard', session.user_id)
      if (!broadcasterId || !await this.twitch.authorized(session.user_id, access.token, broadcasterId)) throw new DomainError('Permiso de moderador revocado', 403)
    } catch {
      await this.logout(id)
      throw new DomainError('No se pudo verificar el acceso actual; volvé a iniciar sesión', 403)
    }
    return { userId: session.user_id, name: session.name, csrf: session.csrf, admin: true, streamer: session.user_id === broadcasterId }
  }

  csrf (session: Session, origin: string | undefined, csrf: string | undefined) {
    if (origin !== new URL(this.twitch.config.baseUrl).origin || !csrf || !equal(session.csrf, csrf)) throw new DomainError('Validación CSRF fallida', 403)
  }

  async logout (id: string) { await this.store.pool.query('DELETE FROM sessions WHERE id=$1 AND channel=$2', [hash(id), this.store.channel]) }
}
