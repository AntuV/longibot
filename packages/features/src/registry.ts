import { randomUUID } from 'node:crypto'
import { DomainError, message } from './model.js'
import type { State, DomainEvent, Actor } from './model.js'
import { reminderCommand, remindersEvent } from './reminders.js'
import { predictionsEvent } from './predictions.js'
import { answerTrivia, triviaCommand, storyCommand } from './games-play.js'

import type { Command, CommandContext } from './commands.js'
export interface Feature { name: string, events: string[], handle: (s: State, e: DomainEvent) => void, commands?: Record<string, Command>, enabled?: (s: State) => boolean, disabledMessage?: string }
const all = ['*']
export const features: Feature[] = [
  { name: 'reminders', events: all, handle: remindersEvent, commands: { '!recordar': reminderCommand } },
  { name: 'predictions', events: ['game.started.v1', 'prediction.state.changed.v1'], handle: predictionsEvent },
  { name: 'trivia', events: [], handle: () => {}, enabled: s => s.settings.trivia.enabled, disabledMessage: 'Trivia deshabilitada', commands: { '!pregunta': triviaCommand } },
  { name: 'stories', events: [], handle: () => {}, enabled: s => s.settings.stories.enabled, disabledMessage: 'Historias deshabilitadas', commands: { '!historia': storyCommand } },
  {
    name: 'channel-events',
    events: all,
    handle: channelEvent,
    commands: {
      '!ayuda': ({ state: s, id, at }) => message(s, id, '!lol <campeón> · !recordar <texto|lista|quitar id> (mods) · !victorias · !pregunta (si está habilitada) · !historia (si está habilitada)', at),
      '!comandos': context => features.find(f => f.name === 'channel-events')!.commands!['!ayuda']!(context),
      '!victorias': ({ state: s, actor, id, at }) => { const wins = s.wins[actor.id]; message(s, id, `${actor.name}: trivia ${wins?.trivia ?? 0}, historias ${wins?.stories ?? 0}.`, at) },
      '!config': ({ state: s, id, at }) => message(s, id, 'La configuración se administra en el panel seguro.', at),
      '!lol': ({ state: s, id, at }) => message(s, id, 'Usá !lol <campeón>.', at)
    }
  }
]
export function consumers (type: string, registry = features) { return registry.filter(f => f.events.includes('*') || f.events.includes(type)) }
export function chat (s: State, actor: Actor, id: string, text: string, at: number, options: Partial<Pick<CommandContext, 'random' | 'guest' | 'replyTo'>> & { registry?: Feature[] } = {}) {
  if (!text.startsWith('!')) { answerTrivia(s, actor, text, at); return }
  const [root, ...args] = text.trim().split(/\s+/)
  try {
    const feature = (options.registry ?? features).find(f => f.commands?.[root?.toLowerCase() ?? ''])
    if (!feature) return
    if (feature.enabled && !feature.enabled(s)) throw new DomainError(feature.disabledMessage ?? 'Feature deshabilitada')
    feature.commands![root!.toLowerCase()]!({ state: s, actor, id, args, at, random: options.random ?? Math.random(), guest: options.guest, replyTo: options.replyTo })
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    message(s, `error:${id}`, error.message, at)
  }
}
export function registeredCommands (s: State, registry = features) { return registry.filter(f => !f.enabled || f.enabled(s)).flatMap(f => Object.keys(f.commands ?? {})) }

function channelEvent (s: State, e: DomainEvent) {
  if (e.type === 'stream.started.v1') s.live = true
  if (e.type === 'stream.ended.v1') s.live = false
  if (e.type === 'chat.message.received.v1') {
    if (e.data.self === true) return
    if (typeof e.data.userId !== 'string' || typeof e.data.text !== 'string') return
    const actor = { id: e.data.userId, name: String(e.data.userName), admin: e.data.admin === true }
    if (/^!(lol|historia)\s+/i.test(e.data.text)) s.chatTasks[e.id] ??= { id: e.id, actor, text: e.data.text, at: e.at }
    else chat(s, actor, e.id, e.data.text, e.at, { replyTo: typeof e.data.chatMessageId === 'string' ? e.data.chatMessageId : undefined })
  }
  // Gifted subscriptions are represented by the grouped gift event only.
  if (e.type === 'twitch.subscription.started.v1' && e.data.isGift === true) return
  // Automatic reward is primary for highlighting; chat is retained for commands only.
  for (const rule of s.settings.actions) {
    if (!rule.enabled || rule.event !== e.type || (rule.rewardId && rule.rewardId !== e.data.rewardId)) continue
    const name = typeof e.data.userName === 'string' ? e.data.userName : 'una persona anónima'
    message(s, `action:${e.id}:${rule.id}`, rule.text.replaceAll('{user}', name), e.at)
  }
}
export function event (type: string, data: Record<string, unknown>, at = Date.now(), id: string = randomUUID()): DomainEvent { return { id, type, data, at } }
