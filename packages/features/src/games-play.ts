import { DomainError, message, requireAdmin, settingsSchema, win } from './model.js'
import type { State, Actor, Settings } from './model.js'

export function configure (s: State, actor: Actor, value: unknown, now = Date.now()): Settings {
  requireAdmin(actor)
  const parsed = settingsSchema.safeParse(value)
  if (!parsed.success) throw new DomainError('Configuración inválida')
  const wasEnabled = s.settings.trivia.enabled
  s.settings = parsed.data
  if (!wasEnabled && s.settings.trivia.enabled) s.nextTriviaAt = now + s.settings.trivia.intervalMinutes * 60_000
  if (!s.settings.trivia.enabled) {
    for (const r of Object.values(s.rounds)) if (['pending', 'active'].includes(r.status)) r.status = 'skipped'
    delete s.triviaNoticeAt
  }
  for (const m of Object.values(s.messages)) if (m.feature && !s.settings[m.feature].enabled && m.status === 'pending') delete s.messages[m.id]
  return s.settings
}
export function startTrivia (s: State, actor: Actor, id: string, now: number, random: number) {
  requireAdmin(actor)
  if (!s.settings.trivia.enabled) throw new DomainError('Trivia deshabilitada')
  if (Object.values(s.rounds).some(r => ['pending', 'active'].includes(r.status))) throw new DomainError('Ya hay una ronda activa', 409)
  const bank = Object.values(s.questions)
  if (!bank.length) throw new DomainError('Banco de preguntas vacío')
  const min = Math.min(...bank.map(q => q.used))
  const options = bank.filter(q => q.used === min)
  const question = options[Math.min(options.length - 1, Math.floor(random * options.length))]!
  question.used++
  s.rounds[id] = { id, questionId: question.id, expiresAt: 0, status: 'pending' }
  message(s, `trivia:${id}`, question.text, now, 'trivia')
}
export function answerTrivia (s: State, actor: Actor, text: string, now: number) {
  if (!s.settings.trivia.enabled) return
  const round = Object.values(s.rounds).find(r => r.status === 'active' && r.expiresAt > now)
  const q = round && s.questions[round.questionId]
  if (!round || !q) return
  const normalized = text.trim().toLocaleLowerCase('es')
  if (!q.answers.some(a => normalized === a.trim().toLocaleLowerCase('es'))) return
  round.status = 'won'; round.winner = actor.id
  win(s, round.id, actor, 'trivia')
  message(s, `winner:${round.id}`, `${actor.name} ganó una victoria de trivia.`, now, 'trivia')
}
export function triviaTick (s: State, now: number, random: number) {
  if (!s.settings.trivia.enabled) return
  for (const r of Object.values(s.rounds)) if (r.status === 'active' && r.expiresAt <= now) { r.status = 'expired'; message(s, `expired:${r.id}`, 'Se acabó el tiempo de la trivia.', now, 'trivia') }
  if (!s.live || Object.values(s.rounds).some(r => ['pending', 'active'].includes(r.status))) return
  if (s.triviaNoticeAt && now >= s.triviaNoticeAt) {
    delete s.triviaNoticeAt
    try { startTrivia(s, { id: 'system', name: 'LongiBot', admin: true }, `auto:${now}`, now, random) } catch (error) { if (!(error instanceof DomainError)) throw error }
    s.nextTriviaAt = now + s.settings.trivia.intervalMinutes * 60_000
  } else if (!s.triviaNoticeAt && now >= s.nextTriviaAt) {
    s.triviaNoticeAt = now + [30_000, 60_000, 90_000][Math.min(2, Math.floor(random * 3))]!
    message(s, `notice:${now}`, '¡Se viene una trivia!', now, 'trivia')
  }
}
export function playStory (s: State, actor: Actor, guest: Actor | undefined, id: string, now: number, random: number) {
  if (!s.settings.stories.enabled) throw new DomainError('Historias deshabilitadas')
  if (s.stories[id]) return
  if (guest?.id === actor.id) throw new DomainError('Elegí otra persona como invitada')
  const keys = ['stories:global', `stories:actor:${actor.id}`, ...(guest ? [`stories:guest:${guest.id}`] : [])]
  if (keys.some(key => (s.cooldowns[key] ?? 0) > now)) throw new DomainError('Historia en cooldown', 429)
  const policy = s.settings.stories
  keys.forEach((key, i) => { s.cooldowns[key] = now + [policy.globalSeconds, policy.actorSeconds, policy.guestSeconds][i]! * 1000 })
  const family = random < 0.5 ? 'piratas' : 'ranked'
  const users = guest ? [actor, guest] : [actor]
  const winners = random < 0.5
    ? guest ? [users[random < 0.25 ? 0 : 1]!] : random < 0.25 ? [actor] : []
    : random < 0.75 ? users : []
  s.stories[id] = { id, users: users.map(u => u.id), family, winners: winners.map(u => u.id), at: now }
  for (const user of winners) win(s, id, user, 'stories')
  message(s, `story:${id}`, `${users.map(u => u.name).join(' y ')}: ${family === 'piratas' ? 'zarparon en busca del tesoro' : `jugaron una ranked ficticia en ${['Hierro', 'Bronce', 'Plata', 'Oro', 'Platino', 'Diamante', 'Master', 'GrandMaster', 'Challenger'][Math.min(8, Math.floor(random * 9))]}`}. ${winners.length ? `${winners.map(u => u.name).join(' y ')}: +1 victoria.` : 'Esta aventura terminó sin victoria.'}`, now, 'stories')
}

export const triviaCommand: import('./commands.js').Command = ({ state: s, actor, id, args, at, random }) => {
  requireAdmin(actor)
  const command = args.join(' ')
  if (command === 'saltear') {
    for (const r of Object.values(s.rounds)) if (['pending', 'active'].includes(r.status)) { r.status = 'skipped'; delete s.messages[`trivia:${r.id}`] }
    delete s.triviaNoticeAt
    s.nextTriviaAt = at + s.settings.trivia.intervalMinutes * 60_000
  } else if (command === 'va') startTrivia(s, actor, id, at, random)
  else throw new DomainError('Usá !pregunta va o !pregunta saltear')
}
export const storyCommand: import('./commands.js').Command = ({ state: s, actor, guest, id, at, random, args }) => {
  if (args.length && !guest) throw new DomainError('No se pudo identificar al invitado')
  playStory(s, actor, guest, id, at, random)
}

// Response time starts at the acknowledged chat delivery, not at job creation.
export function triviaDelivered (s: State, messageId: string, at: number) {
  if (!messageId.startsWith('trivia:') || !s.settings.trivia.enabled) return
  const round = s.rounds[messageId.slice('trivia:'.length)]
  if (round?.status === 'pending') { round.status = 'active'; round.expiresAt = at + s.settings.trivia.answerSeconds * 1000 }
}
