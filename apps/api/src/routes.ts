import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { OpenAPIObject } from '@nestjs/swagger'
type SchemaObject = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string]
import { z } from 'zod'
import { Store } from '../../../packages/infrastructure/src/store.js'
import { Auth } from '../../../packages/infrastructure/src/auth.js'
import type { Purpose } from '../../../packages/infrastructure/src/auth.js'
import { Twitch, integrationConfig } from '../../../packages/infrastructure/src/adapters/twitch.js'
import { Riot } from '../../../packages/infrastructure/src/adapters/riot.js'
import { normalize, verifyWebhook } from '../../../packages/infrastructure/src/adapters/eventsub.js'
import { DomainError, accountSchema, settingsSchema } from '../../../packages/features/src/model.js'
import { addReminder, cancelReminder } from '../../../packages/features/src/reminders.js'
import { configure, triviaDelivered } from '../../../packages/features/src/games-play.js'
import type { Pool } from 'pg'

const questionSchema = z.object({ text: z.string().trim().min(1).max(400), answers: z.array(z.string().trim().min(1).max(200)).min(1).max(20) }).strict()
const reminderSchema = z.object({ text: z.string().trim().min(1).max(350) }).strict()
const predictionRequest = z.object({ status: z.enum(['LOCKED', 'RESOLVED', 'CANCELED']), outcome: z.string().min(1).max(100).optional() }).strict()
const accountRequest = accountSchema.omit({ puuid: true })
function parse<T> (schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new DomainError('Solicitud inválida')
  return result.data
}
function header (r: FastifyRequest, name: string) { const v = r.headers[name]; return typeof v === 'string' ? v : undefined }
export function installRoutes (server: FastifyInstance, pool: Pool | undefined, channel: string, document: OpenAPIObject, gateway?: Twitch) {
  const store = pool ? new Store(pool, channel) : undefined
  const services = () => {
    if (!store) throw new DomainError('Base de datos no disponible', 503)
    const twitch = gateway ?? new Twitch(store, integrationConfig())
    return { store, twitch, auth: new Auth(store, twitch) }
  }
  const session = async (r: FastifyRequest, mutation = false) => {
    const ctx = services(); const user = await ctx.auth.session(r.cookies.lb_session)
    if (mutation) ctx.auth.csrf(user, header(r, 'origin'), header(r, 'x-csrf-token'))
    return { ...ctx, user, actor: { id: user.userId, name: user.name, admin: true }, audit: (action: string) => ({ userId: user.userId, action }) }
  }
  const cookieOptions = { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const }
  // Fastify encapsulation keeps provider/database error details out of responses.
  server.setErrorHandler((error, _req, reply) => {
    const e = error as Error & { statusCode?: number }
    const status = e instanceof DomainError ? e.status : e.statusCode === 400 ? 400 : 503
    reply.code(status).send({ message: e instanceof DomainError ? e.message : status === 400 ? 'Solicitud inválida' : 'Servicio no disponible' })
  })
  server.get('/api/auth/twitch', async (r, reply) => {
    const purpose = parse(z.object({ purpose: z.enum(['dashboard', 'broadcaster', 'bot']).default('dashboard') }), r.query).purpose as Purpose
    const { auth } = services()
    const result = await auth.start(purpose, r.cookies.lb_session)
    return reply.setCookie('lb_oauth', result.state, { ...cookieOptions, maxAge: 600 }).redirect(result.url)
  })
  server.get('/api/auth/twitch/callback', async (r, reply) => {
    const q = parse(z.object({ state: z.string().min(1).max(200), code: z.string().max(2000).default('') }), r.query)
    const { auth } = services()
    const id = await auth.callback(q.state, r.cookies.lb_oauth, q.code)
    reply.clearCookie('lb_oauth', cookieOptions)
    if (id) {
      if (r.cookies.lb_session) await auth.logout(r.cookies.lb_session)
      reply.setCookie('lb_session', id, { ...cookieOptions, maxAge: 28800 })
    }
    return reply.redirect('/')
  })
  server.get('/api/auth/me', async r => { const { user } = await session(r); return { ...user, channel } })
  server.post('/api/auth/logout', async (r, reply) => {
    const { auth } = await session(r, true)
    await auth.logout(r.cookies.lb_session!)
    return reply.clearCookie('lb_session', cookieOptions).code(204).send()
  })
  server.post('/api/eventsub', async (r, reply) => {
    const { store, twitch } = services()
    const raw = (r as FastifyRequest & { rawBody?: Buffer }).rawBody
    if (!raw) throw new DomainError('Se requiere cuerpo original')
    const webhook = verifyWebhook(raw, r.headers, twitch.config.eventSecret)
    const broadcasterId = await store.identity()
    if (!broadcasterId || webhook.body.subscription.condition.broadcaster_user_id !== broadcasterId) throw new DomainError('Evento de otro canal', 403)
    if (webhook.type === 'webhook_callback_verification') return reply.type('text/plain').send(webhook.body.challenge ?? '')
    if (webhook.type === 'revocation') await store.ingest({ id: webhook.id, type: 'twitch.authorization.revoked.v1', at: webhook.at, data: { subscription: webhook.body.subscription.id, reason: webhook.body.subscription.status ?? 'revoked' } })
    else {
      const bot = await store.pool.query<{ user_id: string }>("SELECT user_id FROM oauth_connections WHERE channel=$1 AND purpose='bot' ORDER BY updated_at DESC LIMIT 1", [channel])
      await store.ingest(normalize(webhook.id, webhook.body.subscription.type, webhook.body.event ?? {}, webhook.at, broadcasterId, { botId: bot.rows[0]?.user_id, ownerId: process.env.OWNER_TWITCH_USER_ID }))
    }
    return reply.code(204).send()
  })
  server.get('/api/admin/state', async r => {
    const { store } = await session(r)
    return { channel, broadcasterId: await store.identity(), state: await store.read() }
  })
  server.get('/api/admin/operations', async r => {
    const { store } = await session(r)
    const [audit, events, deliveries, connections, worker, failedJobs] = await Promise.all([store.audit(), store.events(), store.deliveries(), store.pool.query<{ purpose: string, user_id: string, updated_at: string }>('SELECT purpose,user_id,updated_at FROM oauth_connections WHERE channel=$1', [channel]), store.pool.query<{ value: unknown }>('SELECT value FROM runtime_metadata WHERE key=$1', [`worker:${channel}`]), store.failedJobs()])
    return { audit, events, deliveries, failedJobs, connections: connections.rows, worker: worker.rows[0]?.value ?? null }
  })
  server.put('/api/admin/settings', async r => {
    const { store, actor, audit } = await session(r, true)
    return store.change(s => configure(s, actor, r.body), audit('settings.update'))
  })
  server.put('/api/admin/account', async r => {
    const { store, audit } = await session(r, true)
    const value = parse(accountRequest, r.body)
    const account = await new Riot(process.env.RIOT_API_KEY ?? '').resolve(value.gameName, value.tagLine, value.platform, value.region)
    return store.change(s => {
      if (Object.values(s.games).some(g => !g.endedAt)) throw new DomainError('Esperá a que termine la partida antes de cambiar la cuenta', 409)
      s.account = account; s.tracking = 'unknown'; return account
    }, audit('account.update'))
  })
  server.post('/api/admin/reminders', async r => {
    const { store, actor, audit } = await session(r, true)
    const value = parse(reminderSchema, r.body)
    const id = randomUUID()
    return store.change(s => addReminder(s, actor, id, value.text, Date.now()), audit('reminders.create'))
  })
  server.delete<{ Params: { id: string } }>('/api/admin/reminders/:id', async r => {
    const { store, actor, audit } = await session(r, true)
    await store.change(s => cancelReminder(s, actor, r.params.id), audit(`reminders.cancel:${r.params.id}`))
    return { ok: true }
  })
  server.post('/api/admin/questions', async r => {
    const { store, audit } = await session(r, true)
    const q = parse(questionSchema, r.body); const id = randomUUID()
    return store.change(s => { s.questions[id] = { id, ...q, used: 0 }; return s.questions[id] }, audit('questions.create'))
  })
  server.put<{ Params: { id: string } }>('/api/admin/questions/:id', async r => {
    const { store, audit } = await session(r, true)
    const q = parse(questionSchema, r.body)
    const id = parse(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), r.params.id)
    return store.change(s => { s.questions[id] = { id, ...q, used: s.questions[id]?.used ?? 0 }; return s.questions[id] }, audit(`questions.save:${id}`))
  })
  server.delete<{ Params: { id: string } }>('/api/admin/questions/:id', async r => {
    const { store, audit } = await session(r, true)
    await store.change(s => {
      if (Object.values(s.rounds).some(round => round.questionId === r.params.id && ['pending', 'active'].includes(round.status))) throw new DomainError('Pregunta en uso', 409)
      delete s.questions[r.params.id]
    }, audit(`questions.delete:${r.params.id}`))
    return { ok: true }
  })
  server.post<{ Params: { id: string } }>('/api/admin/predictions/:id', async r => {
    const { store, audit } = await session(r, true)
    const req = parse(predictionRequest, r.body)
    return store.change(s => {
      const p = s.predictions[r.params.id]
      if (!p?.twitchId || ['RESOLVED', 'CANCELED'].includes(p.status)) throw new DomainError('Prediction no gestionable', 409)
      if (req.status === 'RESOLVED' && !p.outcomes?.some(o => o.id === req.outcome)) throw new DomainError('Opción ganadora inválida')
      p.requested = { status: req.status, ...(req.outcome ? { outcome: req.outcome } : {}) }; return p
    }, audit(`predictions.${req.status}:${r.params.id}`))
  })
  server.post<{ Params: { id: string } }>('/api/admin/predictions/:id/link', async r => {
    const { store, twitch, audit } = await session(r, true)
    const req = parse(z.object({ twitchId: z.string().min(1).max(100) }).strict(), r.body)
    const broadcasterId = await store.identity()
    const external = (await twitch.predictions(broadcasterId!).list()).find(p => p.id === req.twitchId)
    if (!external) throw new DomainError('Prediction no encontrada', 404)
    return store.change(s => {
      const p = s.predictions[r.params.id]
      if (!p || p.twitchId || !['creating', 'creation_unknown'].includes(p.status) || Object.values(s.predictions).some(p => p.twitchId === req.twitchId)) throw new DomainError('Vínculo inválido', 409)
      p.twitchId = external.id; p.status = external.status; p.outcomes = external.outcomes
      return p
    }, audit(`predictions.link:${r.params.id}:${req.twitchId}`))
  })
  server.post<{ Params: { id: string } }>('/api/admin/messages/:id/review', async r => {
    const { store, audit } = await session(r, true)
    const decision = parse(z.object({ decision: z.enum(['sent', 'retry']) }).strict(), r.body).decision
    return store.change(s => {
      const m = s.messages[r.params.id]
      if (!m || m.status !== 'unknown') throw new DomainError('Mensaje no está pendiente de revisión', 409)
      m.status = decision === 'sent' ? 'sent' : 'pending'
      if (decision === 'sent') triviaDelivered(s, m.id, Date.now())
      if (m.reminderId) s.reminders[m.reminderId]!.status = decision === 'sent' ? 'sent' : 'queued'
      return m
    }, audit(`messages.${decision}:${r.params.id}`))
  })
  // Expose request schemas through the same generated OpenAPI artifact used by UI.
  for (const [path, method, schema] of [['/api/admin/settings', 'put', settingsSchema], ['/api/admin/account', 'put', accountRequest], ['/api/admin/reminders', 'post', reminderSchema], ['/api/admin/questions/{id}', 'put', questionSchema], ['/api/admin/predictions/{id}', 'post', predictionRequest]] as const) {
    document.paths[path] ??= {}
    document.paths[path]![method] = { responses: { 200: { description: 'Operación completada' }, 401: { description: 'Sin sesión' }, 403: { description: 'Sin permisos o CSRF inválido' } }, requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(schema, { target: 'openapi-3.0' }) as SchemaObject } } }, ...(path.includes('{id}') ? { parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }] } : {}), security: [{ session: [] }] }
  }
  document.components ??= {}; document.components.securitySchemes = { session: { type: 'apiKey', in: 'cookie', name: 'lb_session' } }
}
