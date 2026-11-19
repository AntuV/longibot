import type { State, Game, DomainEvent } from './model.js'

export function observeGame (s: State, game: Omit<Game, 'historic'> | null, now: number): DomainEvent[] {
  const events: DomainEvent[] = []
  if (game) {
    if (s.games[game.id]?.endedAt) {
      s.tracking = s.activeGame && !s.games[s.activeGame]?.endedAt ? 'active' : 'idle'
      return [{ id: `reconcile:${now}`, type: 'tracking.reconciled.v1', at: now, data: {} }]
    }
    s.tracking = 'active'
    s.activeGame = game.id
    if (s.games[game.id]?.startedAt === null && game.startedAt !== null) s.games[game.id]!.startedAt = game.startedAt
    if (!s.games[game.id]) {
      const historic = game.startedAt === null || now - game.startedAt >= 300_000
      s.games[game.id] = { ...game, historic }
      events.push({ id: `start:${game.id}`, type: 'game.started.v1', at: now, data: { gameId: game.id } })
    }
  } else {
    // Spectator absence alone cannot end an unconfirmed game.
    const unresolved = Object.values(s.games).find(g => !g.endedAt)
    s.tracking = unresolved ? 'unknown' : 'idle'
    if (!unresolved) delete s.activeGame
  }
  events.push({ id: `reconcile:${now}`, type: 'tracking.reconciled.v1', at: now, data: {} })
  return events
}
export function confirmGame (s: State, gameId: string, endedAt: number, result?: Game['result']): DomainEvent[] {
  const g = s.games[gameId]
  if (!g) return []
  const events: DomainEvent[] = []
  if (!g.endedAt) {
    g.endedAt = endedAt
    if (s.activeGame === gameId) { delete s.activeGame; s.tracking = 'idle' }
    events.push({ id: `game.ended.v1:${gameId}`, type: 'game.ended.v1', at: endedAt, data: { gameId } })
  }
  if (result && !g.result) {
    g.result = result
    events.push({ id: `game.result.confirmed.v1:${gameId}`, type: 'game.result.confirmed.v1', at: endedAt, data: { gameId, result } })
  }
  return events
}
