import { z } from 'zod'

export const settingsSchema = z.object({
  trivia: z.object({ enabled: z.boolean().default(false), intervalMinutes: z.number().int().min(1).max(1440).default(60), answerSeconds: z.number().int().min(10).max(600).default(300) }).default({ enabled: false, intervalMinutes: 60, answerSeconds: 300 }),
  stories: z.object({ enabled: z.boolean().default(false), globalSeconds: z.number().int().min(0).max(86400).default(300), actorSeconds: z.number().int().min(0).max(86400).default(28800), guestSeconds: z.number().int().min(0).max(86400).default(3600) }).default({ enabled: false, globalSeconds: 300, actorSeconds: 28800, guestSeconds: 3600 }),
  predictions: z.object({ enabled: z.boolean().default(true), autoResolve: z.boolean().default(true), title: z.string().trim().min(1).max(45).default('¿Gana esta partida?'), yes: z.string().trim().min(1).max(25).default('Sí'), no: z.string().trim().min(1).max(25).default('No'), maxAgeSeconds: z.number().int().min(1).max(300).default(300) }).refine(s => s.yes !== s.no, 'Las opciones deben ser diferentes').default({ enabled: true, autoResolve: true, title: '¿Gana esta partida?', yes: 'Sí', no: 'No', maxAgeSeconds: 300 }),
  tracking: z.object({ enabled: z.boolean().default(true), onlyLive: z.boolean().default(false), pollSeconds: z.number().int().min(30).max(60).default(45), queues: z.array(z.number().int().nonnegative()).max(100).default([]) }).default({ enabled: true, onlyLive: false, pollSeconds: 45, queues: [] }),
  actions: z.array(z.object({ id: z.string().min(1).max(100), event: z.string().min(1).max(100), rewardId: z.string().max(100).optional(), enabled: z.boolean(), text: z.string().trim().min(1).max(400) }).strict()).max(100).refine(actions => new Set(actions.map(a => a.id)).size === actions.length, 'IDs de reglas duplicados').default([])
}).strict()
export type Settings = z.infer<typeof settingsSchema>
export const accountSchema = z.object({ gameName: z.string().trim().min(1).max(64), tagLine: z.string().trim().min(1).max(16), puuid: z.string().min(1).max(128), platform: z.enum(['la1', 'la2', 'na1', 'br1', 'euw1', 'eun1', 'kr', 'jp1', 'oc1', 'tr1', 'ru', 'ph2', 'sg2', 'th2', 'tw2', 'vn2']), region: z.enum(['americas', 'europe', 'asia', 'sea']) }).strict()
export type Account = z.infer<typeof accountSchema>
export interface Actor { id: string, name: string, admin: boolean }
export interface DomainEvent { id: string, type: string, at: number, data: Record<string, unknown> }
export interface Game { id: string, startedAt: number | null, observedAt: number, endedAt?: number, queue: number, result?: 'win' | 'loss' | 'remake', historic: boolean }
export interface Reminder { id: string, text: string, author: string, createdAt: number, gameId?: string, status: 'waiting_next_game' | 'awaiting_game_assignment' | 'queued' | 'sending' | 'sent' | 'canceled' | 'delivery_unknown', attempts: number, messageId?: string }
export interface Prediction { gameId: string, status: string, twitchId?: string, outcomes?: { id: string, title: string }[], createdAt: number, reason?: string, requested?: { status: 'LOCKED' | 'RESOLVED' | 'CANCELED', outcome?: string }, creationOptions?: [string, string] }
export interface Question { id: string, text: string, answers: string[], used: number }
export interface Round { id: string, questionId: string, expiresAt: number, status: 'pending' | 'active' | 'won' | 'expired' | 'skipped', winner?: string }
export interface Message { id: string, text: string, status: 'pending' | 'sending' | 'sent' | 'unknown', createdAt: number, attempts: number, reminderId?: string, feature?: 'trivia' | 'stories', externalId?: string, replyTo?: string, predictionInvite?: { gameId: string, expiresAt: number } }
export interface ClipRequest { title?: string, replyTo?: string | undefined, submitted?: { at: number, clipId?: string } }
export interface ChatTask { id: string, actor: Actor, text: string, at: number, replyTo?: string | undefined, clip?: ClipRequest }
export interface State {
  version: 1
  settings: Settings
  account?: Account
  live: boolean
  tracking: 'unknown' | 'idle' | 'active'
  activeGame?: string
  games: Record<string, Game>
  reminders: Record<string, Reminder>
  predictions: Record<string, Prediction>
  questions: Record<string, Question>
  rounds: Record<string, Round>
  stories: Record<string, { id: string, users: string[], family: string, winners: string[], at: number }>
  wins: Record<string, { trivia: number, stories: number, name: string }>
  winResults: string[]
  cooldowns: Record<string, number>
  chatTasks: Record<string, ChatTask>
  messages: Record<string, Message>
  nextTriviaAt: number
  triviaNoticeAt?: number
  errors: { at: number, feature: string, message: string }[]
}
export function initialState (): State {
  return { version: 1, settings: settingsSchema.parse({}), live: false, tracking: 'unknown', games: {}, reminders: {}, predictions: {}, questions: {}, rounds: {}, stories: {}, wins: {}, winResults: [], cooldowns: {}, messages: {}, chatTasks: {}, nextTriviaAt: 0, errors: [] }
}
export class DomainError extends Error {
  constructor (message: string, readonly status = 400) { super(message) }
}
export function requireAdmin (actor: Actor) { if (!actor.admin) throw new DomainError('Se requiere moderador o streamer', 403) }
export function message (state: State, id: string, text: string, at: number, feature?: 'trivia' | 'stories', replyTo?: string) {
  state.messages[id] ??= { id, text: text.slice(0, 480), createdAt: at, attempts: 0, status: 'pending', ...(feature ? { feature } : {}), ...(replyTo ? { replyTo } : {}) }
  return state.messages[id]
}
export function win (state: State, resultId: string, actor: Actor, game: 'trivia' | 'stories') {
  const key = `${game}:${resultId}:${actor.id}`
  if (state.winResults.includes(key)) return
  state.winResults.push(key)
  state.wins[actor.id] ??= { trivia: 0, stories: 0, name: actor.name }
  state.wins[actor.id]![game]++
}
