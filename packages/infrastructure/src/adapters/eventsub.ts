import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { DomainError } from '../../../features/src/model.js'
import type { DomainEvent } from '../../../features/src/model.js'
import { equal } from '../crypto.js'
import type { Twitch } from './twitch.js'

export const eventTypes: Record<string, string> = {
  'channel.chat.message': 'chat.message.received.v1',
  'channel.channel_points_custom_reward_redemption.add': 'twitch.redemption.created.v1',
  'channel.channel_points_custom_reward_redemption.update': 'twitch.redemption.updated.v1',
  'channel.channel_points_automatic_reward_redemption.add': 'twitch.automatic_reward.redeemed.v1',
  'channel.bits.use': 'twitch.bits.used.v1',
  'channel.subscribe': 'twitch.subscription.started.v1',
  'channel.subscription.message': 'twitch.subscription.message.v1',
  'channel.subscription.gift': 'twitch.subscriptions.gifted.v1',
  'channel.follow': 'twitch.followed.v1',
  'stream.online': 'stream.started.v1',
  'stream.offline': 'stream.ended.v1',
  ...Object.fromEntries(['begin', 'progress', 'lock', 'end'].map(s => [`channel.prediction.${s}`, 'prediction.state.changed.v1']))
}
const envelope = z.object({ subscription: z.object({ id: z.string(), type: z.string(), status: z.string().optional(), condition: z.object({ broadcaster_user_id: z.string().optional() }).passthrough() }), challenge: z.string().optional(), event: z.record(z.string(), z.unknown()).optional() })
export function verifyWebhook (raw: Buffer, headers: Record<string, string | string[] | undefined>, secret: string, now = Date.now()) {
  const get = (key: string) => typeof headers[key] === 'string' ? headers[key] as string : ''
  const id = get('twitch-eventsub-message-id'); const timestamp = get('twitch-eventsub-message-timestamp'); const signature = get('twitch-eventsub-message-signature'); const type = get('twitch-eventsub-message-type')
  const date = Date.parse(timestamp)
  if (!id || id.length > 200 || !Number.isFinite(date) || now - date > 600_000 || date - now > 60_000) throw new DomainError('Mensaje vencido o inválido', 403)
  const expected = `sha256=${createHmac('sha256', secret).update(id + timestamp).update(raw).digest('hex')}`
  if (!equal(expected, signature)) throw new DomainError('Firma inválida', 403)
  const data = envelope.safeParse(JSON.parse(raw.toString()) as unknown)
  if (!data.success) throw new DomainError('Evento inválido')
  if (!['notification', 'webhook_callback_verification', 'revocation'].includes(type)) throw new DomainError('Tipo de webhook inválido')
  return { id, at: date, type, body: data.data }
}
export function normalize (id: string, type: string, data: Record<string, unknown>, at: number, broadcasterId: string, identities: { botId?: string | undefined, ownerId?: string | undefined } = {}): DomainEvent {
  if (data.broadcaster_user_id !== broadcasterId) throw new DomainError('Evento de otro canal', 403)
  const internal = eventTypes[type]
  if (!internal) throw new DomainError('Evento no soportado')
  const anonymous = data.is_anonymous === true
  const userId = anonymous ? undefined : (data.chatter_user_id ?? data.user_id)
  const userName = anonymous ? undefined : (data.chatter_user_name ?? data.user_name)
  const message = z.object({ text: z.string() }).safeParse(data.message)
  const badges = z.array(z.object({ set_id: z.string() })).safeParse(data.badges)
  const reward = z.object({ id: z.string().optional(), type: z.string().optional() }).safeParse(data.reward)
  const admin = userId === broadcasterId || (identities.ownerId !== undefined && userId === identities.ownerId) || (badges.success && badges.data.some(b => b.set_id === 'moderator'))
  const status = type.endsWith('.end') ? data.status : type.endsWith('.lock') ? 'LOCKED' : 'ACTIVE'
  return { id, type: internal === 'twitch.automatic_reward.redeemed.v1' && reward.success && reward.data.type === 'send_highlighted_message' ? 'twitch.message.highlighted.v1' : internal, at, data: { provider: type, providerId: id, ...(typeof userId === 'string' ? { userId } : {}), ...(typeof userName === 'string' ? { userName } : {}), anonymous, admin, self: identities.botId !== undefined && userId === identities.botId, ...(message.success ? { text: message.data.text } : {}), ...(reward.success ? { rewardId: reward.data.id, rewardType: reward.data.type } : {}), isGift: data.is_gift === true, payment: type === 'channel.bits.use' ? 'bits' : type.includes('reward') ? 'channel_points' : null, subtype: data.type ?? null, ...(internal === 'prediction.state.changed.v1' ? { id: data.id, status: String(status).toUpperCase() } : {}), raw: data } }
}
export async function reconcileSubscriptions (twitch: Twitch, broadcasterId: string) {
  const bot = await twitch.access('bot')
  const desired = Object.keys(eventTypes).map(type => ({
    type,
    version: type === 'channel.follow' || type === 'channel.channel_points_automatic_reward_redemption.add' ? '2' : '1',
    condition: { broadcaster_user_id: broadcasterId, ...(type === 'channel.chat.message' ? { user_id: bot.userId } : {}), ...(type === 'channel.follow' ? { moderator_user_id: broadcasterId } : {}) },
    transport: { method: 'webhook', callback: `${twitch.config.baseUrl}/api/eventsub`, secret: twitch.config.eventSecret }
  }))
  const access = await twitch.appAccess()
  const existing: { type: string, version: string, status: string, condition: Record<string, string>, transport: { callback?: string | undefined } }[] = []
  let cursor = ''
  do {
    const page = z.object({ data: z.array(z.object({ type: z.string(), version: z.string(), status: z.string(), condition: z.record(z.string(), z.string()), transport: z.object({ callback: z.string().optional() }) })), pagination: z.object({ cursor: z.string().optional() }) }).parse(await twitch.helix(`eventsub/subscriptions${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`, access))
    existing.push(...page.data); cursor = page.pagination.cursor ?? ''
  } while (cursor)
  const failed: string[] = []
  for (const sub of desired) {
    if (existing.some(e => e.type === sub.type && e.version === sub.version && ['enabled', 'webhook_callback_verification_pending'].includes(e.status) && e.transport.callback === sub.transport.callback && Object.entries(sub.condition).every(([key, value]) => e.condition[key] === value))) continue
    try { await twitch.helix('eventsub/subscriptions', access, 'POST', sub) } catch { failed.push(sub.type) }
  }
  if (failed.length) throw new DomainError(`No se pudo suscribir ${failed.join(', ')}; revisar scopes y elegibilidad`, 503)
}
