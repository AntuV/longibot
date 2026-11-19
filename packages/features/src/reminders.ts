import { DomainError, requireAdmin, message } from './model.js'
import type { State, Actor, DomainEvent } from './model.js'

export function addReminder (s: State, actor: Actor, id: string, text: string, now: number) {
  requireAdmin(actor)
  text = text.trim()
  if (!text || text.length > 350) throw new DomainError('El recordatorio requiere entre 1 y 350 caracteres')
  if (s.reminders[id]) return s.reminders[id]!
  if (Object.values(s.reminders).filter(r => !['sent', 'canceled'].includes(r.status)).length >= 100) throw new DomainError('Hay 100 recordatorios pendientes')
  const gameId = s.tracking === 'active' ? s.activeGame : undefined
  const reminder = { id, text, author: actor.name, createdAt: now, attempts: 0, status: gameId ? 'queued' as const : s.tracking === 'unknown' ? 'awaiting_game_assignment' as const : 'waiting_next_game' as const, ...(gameId ? { gameId } : {}) }
  s.reminders[id] = reminder
  return reminder
}
export function cancelReminder (s: State, actor: Actor, id: string) {
  requireAdmin(actor)
  const r = s.reminders[id]
  if (!r) throw new DomainError('Recordatorio inexistente', 404)
  if (['sending', 'sent', 'delivery_unknown'].includes(r.status)) throw new DomainError('La entrega ya fue iniciada; revisar su estado', 409)
  r.status = 'canceled'
  const m = s.messages[`reminder:${id}`]
  if (m) delete s.messages[m.id]
}
export function remindersEvent (s: State, e: DomainEvent) {
  if (e.type === 'game.started.v1' || e.type === 'tracking.reconciled.v1') {
    for (const r of Object.values(s.reminders)) {
      if (r.status === 'awaiting_game_assignment') {
        const game = Object.values(s.games).filter(g => g.startedAt !== null && g.startedAt <= r.createdAt && (!g.endedAt || g.endedAt >= r.createdAt)).sort((a, b) => b.observedAt - a.observedAt)[0]
        if (game) { r.gameId = game.id; r.status = 'queued' } else if (s.tracking === 'idle' || (typeof e.data.historyCompleteAfter === 'number' && e.data.historyCompleteAfter <= r.createdAt)) r.status = 'waiting_next_game'
      }
      if (r.status === 'waiting_next_game' && typeof e.data.historyCompleteAfter === 'number' && e.data.historyCompleteAfter <= r.createdAt) {
        const next = Object.values(s.games).filter(g => g.startedAt !== null && g.startedAt >= r.createdAt && g.startedAt <= e.at).sort((a, b) => a.startedAt! - b.startedAt!)[0]
        if (next) { r.gameId = next.id; r.status = 'queued' }
      }
      if (r.status === 'waiting_next_game' && e.type === 'game.started.v1' && typeof e.data.gameId === 'string') {
        const game = s.games[e.data.gameId]
        if (game && (game.startedAt ?? game.observedAt) >= r.createdAt) { r.gameId = game.id; r.status = 'queued' }
      }
    }
  }
  // Also recover ended games after assignment/restart; never select by arrival order.
  for (const r of Object.values(s.reminders).sort((a, b) => a.createdAt - b.createdAt)) {
    if (r.status === 'queued' && r.gameId && s.games[r.gameId]?.endedAt) {
      message(s, `reminder:${r.id}`, `Recordatorio de ${r.author}: ${r.text}`, r.createdAt)
      s.messages[`reminder:${r.id}`]!.reminderId = r.id
    }
  }
}

export const reminderCommand: import('./commands.js').Command = ({ state: s, actor, id, args, at }) => {
  requireAdmin(actor)
  if (args[0] === 'lista') message(s, id, Object.values(s.reminders).filter(r => !['sent', 'canceled'].includes(r.status)).map(r => `${r.id}: ${r.text} [${r.status}]`).join(' | ') || 'Sin recordatorios pendientes.', at)
  else if (args[0] === 'quitar') { cancelReminder(s, actor, args[1] ?? ''); message(s, id, 'Recordatorio cancelado.', at) } else { const r = addReminder(s, actor, id, args.join(' '), at); message(s, id, `Recordatorio ${r.id} guardado (${r.status}).`, at) }
}
