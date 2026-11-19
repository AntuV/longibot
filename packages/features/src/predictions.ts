import type { State, DomainEvent } from './model.js'
export function predictionsEvent (s: State, e: DomainEvent) {
  if (e.type === 'game.started.v1' && typeof e.data.gameId === 'string') {
    const game = s.games[e.data.gameId]
    if (!game || s.predictions[game.id] || !s.settings.predictions.enabled) return
    const age = game.startedAt === null ? Infinity : e.at - game.startedAt
    const skipped = game.historic || age < 0 || age >= s.settings.predictions.maxAgeSeconds * 1000
    s.predictions[game.id] = { gameId: game.id, createdAt: e.at, status: skipped ? 'skipped' : 'pending', ...(skipped ? { reason: 'Partida avanzada o antigüedad desconocida' } : {}) }
  }
  if (e.type === 'prediction.state.changed.v1' && typeof e.data.id === 'string') {
    const prediction = Object.values(s.predictions).find(p => p.twitchId === e.data.id)
    if (prediction && typeof e.data.status === 'string') prediction.status = e.data.status
  }
}
export interface ExternalPrediction { id: string, title: string, status: string, createdAt: number, outcomes: { id: string, title: string }[] }
export interface PredictionsPort {
  get?: (id: string) => Promise<ExternalPrediction | null>
  list: () => Promise<ExternalPrediction[]>
  create: (title: string, options: [string, string], window: 300) => Promise<ExternalPrediction>
  update: (id: string, status: 'LOCKED' | 'RESOLVED' | 'CANCELED', outcome?: string) => Promise<ExternalPrediction>
}
