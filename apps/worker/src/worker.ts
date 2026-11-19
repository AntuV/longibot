import type { Pool } from 'pg'
import { Store } from '../../../packages/infrastructure/src/store.js'
import { Runtime } from '../../../packages/infrastructure/src/runtime.js'
import { Twitch, integrationConfig } from '../../../packages/infrastructure/src/adapters/twitch.js'
import { reconcileSubscriptions } from '../../../packages/infrastructure/src/adapters/eventsub.js'
import { Riot } from '../../../packages/infrastructure/src/adapters/riot.js'
import { ProviderError } from '../../../packages/infrastructure/src/adapters/http.js'
import { DomainError } from '../../../packages/features/src/model.js'
import { logger } from '../../../packages/infrastructure/src/logger.js'

export class Worker {
  readonly store: Store
  runtime: Runtime | undefined
  twitch: Twitch | undefined
  identityCheckedAt = 0
  identityRetryAt = 0
  constructor (readonly pool: Pool, readonly channel: string) { this.store = new Store(pool, channel) }
  async run (now = Date.now()) {
    const client = await this.pool.connect()
    const lock = `worker:${this.channel}`
    let locked = false
    try {
      const acquired = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [lock])
      locked = acquired.rows[0]?.locked === true
      if (!locked) return
      // Health reflects local queue/database progress, not remote availability.
      await this.pool.query('INSERT INTO runtime_metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()', [lock, { at: now }])
      const broadcasterId = await this.store.identity()
      if (!broadcasterId) return
      try {
        this.twitch ??= new Twitch(this.store, integrationConfig())
        this.runtime ??= new Runtime(this.store, new Riot(process.env.RIOT_API_KEY ?? ''), this.twitch, this.twitch.predictions(broadcasterId), broadcasterId)
      } catch { logger.warn('Integration credentials are incomplete'); return }
      if (now < this.identityRetryAt) return
      if (!this.identityCheckedAt || now - this.identityCheckedAt >= 3600_000) {
        try {
          const channel = await this.twitch.user(this.channel)
          if (channel.id !== broadcasterId) throw new DomainError('El ID del canal cambió; reconciliar identidad antes de ejecutar acciones', 409)
          this.identityCheckedAt = now
        } catch (error) {
          this.identityRetryAt = now + 60_000
          await this.runtime.error('channel', error, now)
          return
        }
      }
      let state = await this.store.read()
      if (now >= (state.cooldowns['subscriptions:next'] ?? 0)) {
        try {
          const broadcaster = await this.twitch.access('broadcaster', broadcasterId)
          await this.twitch.validate(broadcaster.token)
          const bot = await this.twitch.access('bot'); await this.twitch.validate(bot.token, bot.clientId)
          // Reconcile initial live state without waiting for a new online event.
          const live = await this.twitch.helix(`streams?user_id=${broadcasterId}`, await this.twitch.appAccess()) as { data?: unknown[] }
          await this.store.change(s => { s.live = Array.isArray(live.data) && live.data.length > 0 })
          await reconcileSubscriptions(this.twitch, broadcasterId)
          await this.store.change(s => { s.cooldowns['subscriptions:next'] = now + 3600_000 })
        } catch (e) {
          await this.runtime.error('subscriptions', e, now)
          await this.store.change(s => { s.cooldowns['subscriptions:next'] = now + 60_000 })
        }
      }
      if (now >= (state.cooldowns['riot:next'] ?? 0)) {
        let backoff = state.settings.tracking.pollSeconds * 1000
        try { await this.runtime.poll(now) } catch (e) { backoff = Math.max(backoff * 2, e instanceof ProviderError ? e.retryAfter : 0) }
        await this.store.change(s => { s.cooldowns['riot:next'] = now + backoff })
      }
      await this.runtime.tick(now)
      state = await this.store.read()
      if (now >= (state.cooldowns['retention:next'] ?? 0)) {
        await this.store.transaction(async c => {
          await c.query("DELETE FROM event_inbox i WHERE channel=$1 AND received_at<now()-interval '30 days' AND NOT EXISTS (SELECT 1 FROM event_deliveries d WHERE d.channel=i.channel AND d.event_id=i.id AND d.completed_at IS NULL)", [this.channel])
          await c.query('DELETE FROM event_deliveries d WHERE channel=$1 AND NOT EXISTS(SELECT 1 FROM event_inbox i WHERE i.channel=d.channel AND i.id=d.event_id)', [this.channel])
          await c.query('DELETE FROM sessions WHERE expires_at<now()')
          await c.query('DELETE FROM oauth_states WHERE expires_at<now()')
        })
        await this.store.change(s => {
          for (const [id, m] of Object.entries(s.messages)) if (m.status === 'sent' && now - m.createdAt > 30 * 86400_000) delete s.messages[id]
          s.cooldowns['retention:next'] = now + 86400_000
        })
      }
    } finally {
      try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]) } finally { client.release() }
    }
  }
}
