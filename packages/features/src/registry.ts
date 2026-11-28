import { randomUUID } from 'node:crypto'
import { DomainError, message } from './model.js'
import type { State, DomainEvent, Actor } from './model.js'
import { reminderCommand, remindersEvent } from './reminders.js'
import { predictionsEvent } from './predictions.js'
import { answerTrivia, triviaCommand, storyCommand } from './games-play.js'

import type { Command, CommandContext } from './commands.js'
export interface Feature { name: string, events: string[], handle: (s: State, e: DomainEvent) => void, commands?: Record<string, Command>, enabled?: (s: State) => boolean }
const all = ['*']
const helpCommand: Command = ({ state, id, at, replyTo }) => {
  const available = registeredCommands(state)
  const usage = ['!lol <campeón>', '!recordar <texto|lista|quitar id> (mods)', '!clip [título] (seguidores)']
  if (available.includes('!pregunta')) usage.push('!pregunta <va|saltear> (mods)')
  if (available.includes('!historia')) usage.push('!historia [@usuario]')
  message(state, id, usage.join(' · '), at, undefined, replyTo)
}
export const features: Feature[] = [
  {
    name: 'reminders',
    events: all,
    handle: remindersEvent,
    commands: {
      '!recordar': reminderCommand,
      '!recordatorio': reminderCommand,
      '!remind': reminderCommand
    }
  },
  { name: 'predictions', events: ['game.started.v1', 'prediction.state.changed.v1'], handle: predictionsEvent },
  { name: 'trivia', events: [], handle: () => {}, enabled: s => s.settings.trivia.enabled, commands: { '!pregunta': triviaCommand } },
  { name: 'stories', events: [], handle: () => {}, enabled: s => s.settings.stories.enabled, commands: { '!historia': storyCommand } },
  {
    name: 'channel-events',
    events: all,
    handle: channelEvent,
    commands: {
      '!ayuda': helpCommand,
      '!comandos': helpCommand,
      '!lol': ({ state: s, id, at, replyTo }) => message(s, id, 'Usá !lol <campeón>.', at, undefined, replyTo),
      '!clip': ({ state, actor, id, text, at, replyTo }) => {
        const title = text.slice('!clip'.length).trim()
        state.chatTasks[id] ??= { id, actor, text, at, replyTo, clip: title ? { title } : {} }
      }
    }
  }
]
export function consumers (type: string, registry = features) { return registry.filter(f => f.events.includes('*') || f.events.includes(type)) }
export function chat (s: State, actor: Actor, id: string, text: string, at: number, options: Partial<Pick<CommandContext, 'random' | 'guest' | 'replyTo'>> & { registry?: Feature[] } = {}) {
  if (!text.startsWith('!')) { answerTrivia(s, actor, text, at, options.replyTo); return }
  const [root, ...args] = text.trim().split(/\s+/)
  try {
    const feature = (options.registry ?? features).find(f => f.commands?.[root?.toLowerCase() ?? ''])
    if (!feature || (feature.enabled && !feature.enabled(s))) return
    feature.commands![root!.toLowerCase()]!({ state: s, actor, id, text, args, at, random: options.random ?? Math.random(), guest: options.guest, replyTo: options.replyTo })
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    message(s, `error:${id}`, error.message, at, undefined, options.replyTo)
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
    const replyTo = typeof e.data.chatMessageId === 'string' ? e.data.chatMessageId : undefined
    const deferredCommand = /^!(lol|historia)\s+\S/i.exec(e.data.text)?.[1]?.toLowerCase()
    if (deferredCommand) {
      if (deferredCommand === 'lol' || s.settings.stories.enabled) s.chatTasks[e.id] ??= { id: e.id, actor, text: e.data.text, at: e.at, replyTo }
    } else chat(s, actor, e.id, e.data.text, e.at, { replyTo })
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
