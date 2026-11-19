import type { Pool, PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import { DomainError, initialState } from '../../features/src/model.js'
import type { State, DomainEvent } from '../../features/src/model.js'
import { consumers } from '../../features/src/registry.js'

export class Store {
  constructor (readonly pool: Pool, readonly channel: string) {}
  async transaction<T> (fn: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [this.channel])
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async initialize (broadcasterId: string) {
    await this.pool.query('INSERT INTO channel_state(channel,broadcaster_id,data) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [this.channel, broadcasterId, initialState()])
    const row = await this.identity()
    if (row !== broadcasterId) throw new DomainError('El ID del canal cambió; se requiere reconciliación explícita', 409)
  }

  async identity () {
    const r = await this.pool.query<{ broadcaster_id: string }>('SELECT broadcaster_id FROM channel_state WHERE channel=$1', [this.channel])
    return r.rows[0]?.broadcaster_id
  }

  async read (): Promise<State> {
    const r = await this.pool.query<{ data: State }>('SELECT data FROM channel_state WHERE channel=$1', [this.channel])
    return r.rows[0]?.data ?? initialState()
  }

  async change<T> (fn: (s: State) => T, audit?: { userId: string, action: string }) {
    return this.transaction(async c => {
      const r = await c.query<{ data: State }>('SELECT data FROM channel_state WHERE channel=$1 FOR UPDATE', [this.channel])
      if (!r.rows[0]) throw new DomainError('Canal todavía no conectado', 503)
      const s = r.rows[0].data
      const result = fn(s)
      await c.query('UPDATE channel_state SET data=$2,updated_at=now() WHERE channel=$1', [this.channel, s])
      if (audit) await c.query('INSERT INTO admin_audit(id,channel,user_id,action) VALUES ($1,$2,$3,$4)', [randomUUID(), this.channel, audit.userId, audit.action])
      return result
    })
  }

  async insertEvent (c: PoolClient, e: DomainEvent) {
    const row = await c.query('INSERT INTO event_inbox(channel,id,data) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id', [this.channel, e.id, e])
    if (!row.rowCount) return false
    for (const f of consumers(e.type)) await c.query('INSERT INTO event_deliveries(channel,event_id,consumer) VALUES ($1,$2,$3)', [this.channel, e.id, f.name])
    return true
  }

  async ingest (e: DomainEvent) { return this.transaction(c => this.insertEvent(c, e)) }
  async emit (fn: (s: State) => DomainEvent[]) {
    return this.transaction(async c => {
      const r = await c.query<{ data: State }>('SELECT data FROM channel_state WHERE channel=$1 FOR UPDATE', [this.channel])
      if (!r.rows[0]) throw new DomainError('Canal todavía no conectado', 503)
      const state = r.rows[0].data
      for (const e of fn(state)) await this.insertEvent(c, e)
      await c.query('UPDATE channel_state SET data=$2,updated_at=now() WHERE channel=$1', [this.channel, state])
    })
  }

  async deliver (limit = 100) {
    for (let i = 0; i < limit; i++) {
      const found = await this.transaction(async c => {
        const r = await c.query<{ event_id: string, consumer: string, data: DomainEvent }>('SELECT d.event_id,d.consumer,i.data FROM event_deliveries d JOIN event_inbox i ON i.channel=d.channel AND i.id=d.event_id WHERE d.channel=$1 AND d.completed_at IS NULL AND d.next_attempt_at<=now() ORDER BY i.received_at,i.id,d.consumer LIMIT 1 FOR UPDATE OF d SKIP LOCKED', [this.channel])
        const row = r.rows[0]
        if (!row) return false
        const state = await c.query<{ data: State }>('SELECT data FROM channel_state WHERE channel=$1 FOR UPDATE', [this.channel])
        if (!state.rows[0]) return false
        const feature = consumers(row.data.type).find(f => f.name === row.consumer)
        try {
          if (!feature) throw new Error('Consumer unavailable')
          feature.handle(state.rows[0].data, row.data)
        } catch {
          // Discard the in-memory partial reduction; other consumers keep progressing.
          await c.query("UPDATE event_deliveries SET attempts=attempts+1,last_error='Consumer failed',next_attempt_at=now()+interval '30 seconds' WHERE channel=$1 AND event_id=$2 AND consumer=$3", [this.channel, row.event_id, row.consumer])
          return true
        }
        await c.query('UPDATE channel_state SET data=$2,updated_at=now() WHERE channel=$1', [this.channel, state.rows[0].data])
        await c.query('UPDATE event_deliveries SET completed_at=now(),attempts=attempts+1,last_error=NULL WHERE channel=$1 AND event_id=$2 AND consumer=$3', [this.channel, row.event_id, row.consumer])
        return true
      })
      if (!found) break
    }
  }

  async audit () { return (await this.pool.query('SELECT user_id, action, at FROM admin_audit WHERE channel=$1 ORDER BY at DESC LIMIT 100', [this.channel])).rows as { user_id: string, action: string, at: string }[] }
  async events () { return (await this.pool.query<{ data: DomainEvent, received_at: string }>('SELECT data,received_at FROM event_inbox WHERE channel=$1 ORDER BY received_at DESC LIMIT 100', [this.channel])).rows }
  async deliveries () { return (await this.pool.query('SELECT event_id, consumer, completed_at,attempts,last_error,next_attempt_at FROM event_deliveries WHERE channel=$1 ORDER BY completed_at DESC NULLS FIRST LIMIT 100', [this.channel])).rows as { event_id: string, consumer: string, completed_at: string | null, attempts: number, last_error: string | null, next_attempt_at: string }[] }
  async failedJobs () {
    const exists = await this.pool.query<{ relation: string | null }>("SELECT to_regclass('pgboss.job') AS relation")
    if (!exists.rows[0]?.relation) return []
    return (await this.pool.query<{ id: string, name: string, state: string, retry_count: number, created_on: string }>("SELECT id,name,state,retry_count,created_on FROM pgboss.job WHERE name=$1 AND state='failed' ORDER BY created_on DESC LIMIT 100", [`channel-tick-${this.channel}`])).rows
  }
}
