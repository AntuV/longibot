import { confirmGame, observeGame } from '../../features/src/games.js'
import { message, DomainError } from '../../features/src/model.js'
import { playStory, triviaTick, triviaDelivered } from '../../features/src/games-play.js'
import type { PredictionsPort, ExternalPrediction } from '../../features/src/predictions.js'
import type { Store } from './store.js'
import type { Riot } from './adapters/riot.js'
import type { Twitch } from './adapters/twitch.js'
import { matchResult } from './adapters/riot.js'
import { ProviderError } from './adapters/http.js'

export type StateStore = Pick<Store, 'read' | 'change' | 'emit' | 'deliver'>
const predictionWindow = 300

export class Runtime {
  constructor (readonly store: StateStore, readonly riot: Pick<Riot, 'result' | 'history' | 'poll' | 'lol'>, readonly twitch: Pick<Twitch, 'announce' | 'send' | 'user'>, readonly predictions: PredictionsPort, readonly broadcasterId: string) {}
  async error (feature: string, error: unknown, now: number) {
    await this.store.change(s => { s.errors.push({ feature, at: now, message: error instanceof DomainError || error instanceof ProviderError ? error.message : 'Falla de integración; revisar conexión' }); s.errors = s.errors.slice(-100) })
  }

  async poll (now: number) {
    const s = await this.store.read()
    if (!s.account || !s.settings.tracking.enabled || (s.settings.tracking.onlyLive && !s.live)) return
    try {
      // Reconcile stored unfinished games even when a later game is already active.
      for (const game of Object.values(s.games).filter(g => !g.endedAt || !g.result)) {
        const match = await this.riot.result(s.account, game.id)
        const result = match && matchResult(match, s.account.puuid)
        if (match) {
          await this.store.emit(state => {
            if (state.games[game.id]?.startedAt === null) state.games[game.id]!.startedAt = match.info.gameStartTimestamp
            return confirmGame(state, game.id, match.info.gameEndTimestamp ?? match.info.gameStartTimestamp + match.info.gameDuration * 1000, result ?? undefined)
          })
        }
      }
      // Recover games missed entirely during downtime, but do not emit new starts.
      const pending = Object.values(s.reminders).filter(r => ['awaiting_game_assignment', 'waiting_next_game'].includes(r.status))
      if (pending.length) {
        const ids = await this.riot.history(s.account, undefined, Math.min(...pending.map(r => r.createdAt)) - 4 * 3600_000)
        if (ids.length >= 20 && pending.some(r => r.status === 'waiting_next_game')) throw new DomainError('Historial incompleto para reconstruir la próxima partida; revisar recordatorios pendientes')
        for (const id of ids) {
          if (s.games[id]) continue
          const match = await this.riot.result(s.account, id)
          const result = match && matchResult(match, s.account.puuid)
          if (match) {
            await this.store.emit(state => {
              state.games[id] ??= { id, startedAt: match.info.gameStartTimestamp, queue: match.info.queueId, observedAt: now, historic: true }
              return confirmGame(state, id, match.info.gameEndTimestamp ?? match.info.gameStartTimestamp + match.info.gameDuration * 1000, result ?? undefined)
            })
          }
        }
        if (ids.length < 20) await this.store.emit(() => [{ id: `history:${now}`, type: 'tracking.reconciled.v1', at: now, data: { historyCompleteAfter: Math.min(...pending.map(r => r.createdAt)) } }])
      }
      const active = await this.riot.poll(s.account, now)
      // Filtering eligibility applies to predictions, not the shared game cycle.
      await this.store.emit(state => observeGame(state, active, now))
    } catch (e) {
      await this.store.change(state => { state.tracking = 'unknown' })
      await this.error('riot', e, now)
      throw e
    }
  }

  async reconcilePredictions (now: number) {
    const s = await this.store.read()
    if (!Object.values(s.predictions).some(p => !['skipped', 'RESOLVED', 'CANCELED', 'conflict'].includes(p.status))) return
    const external = await this.predictions.list()
    const save = (gameId: string, p: ExternalPrediction, announceOpening = false) => this.store.change(state => {
      const link = state.predictions[gameId]!
      link.twitchId = p.id; link.status = p.status; link.outcomes = p.outcomes
      if (announceOpening && p.status === 'ACTIVE') {
        const invite = message(state, `prediction:invite:${p.id}`, `¡Se abrió la predicción! ${p.title} Elegí tu opción con puntos del canal desde el chat.`, now)
        invite.predictionInvite = { gameId, expiresAt: p.createdAt + predictionWindow * 1000 }
      }
    })
    for (const prediction of Object.values(s.predictions)) {
      if (['skipped', 'conflict', 'RESOLVED', 'CANCELED'].includes(prediction.status)) continue
      const game = s.games[prediction.gameId]
      if (!game) continue
      if (prediction.status === 'creating') {
        await this.store.change(state => { const p = state.predictions[game.id]!; p.status = 'creation_unknown'; p.reason = 'Respuesta incierta: vincular ID desde administración; no reintentar creación' })
        continue
      }
      if (prediction.status === 'creation_unknown') continue
      if (prediction.status === 'pending') {
        const settings = s.settings.predictions
        let reason: string | undefined
        if (!settings.enabled) reason = 'Feature deshabilitada'
        else if (s.settings.tracking.queues.length && !s.settings.tracking.queues.includes(game.queue)) reason = 'Cola no habilitada'
        else if (game.endedAt || !game.startedAt || now - game.startedAt >= settings.maxAgeSeconds * 1000) reason = 'Partida finalizada o detección tardía'
        const conflict = external.some(p => ['ACTIVE', 'LOCKED'].includes(p.status))
        if (reason || conflict) {
          await this.store.change(state => { const p = state.predictions[game.id]!; p.status = conflict ? 'conflict' : 'skipped'; p.reason = reason ?? 'Existe otra prediction pendiente en Twitch' }); continue
        }
        await this.store.change(state => { const p = state.predictions[game.id]!; p.status = 'creating'; p.createdAt = now; p.creationOptions = [settings.yes, settings.no] })
        try {
          const created = await this.predictions.create(settings.title, [settings.yes, settings.no], predictionWindow)
          external.push(created)
          await save(game.id, created, true)
        } catch (e) {
          await this.store.change(state => { const p = state.predictions[game.id]!; p.status = e instanceof ProviderError && e.status >= 400 && e.status < 500 ? 'conflict' : 'creation_unknown'; p.reason = 'Revisar Twitch antes de volver a operar' })
          await this.error('predictions', e, now)
        }
        continue
      }
      const current = external.find(p => p.id === prediction.twitchId) ?? (prediction.twitchId ? await this.predictions.get?.(prediction.twitchId) : undefined)
      if (!current) { await this.error('predictions', new DomainError('Prediction no encontrada en Twitch; requiere revisión'), now); continue }
      await save(game.id, current)
      if (['RESOLVED', 'CANCELED'].includes(current.status)) { await this.store.change(state => { delete state.predictions[game.id]!.requested }); continue }
      let requested = prediction.requested
      if (!requested && game.endedAt) {
        if (game.result === 'remake') requested = { status: 'CANCELED' }
        else if (s.settings.predictions.autoResolve && (game.result === 'win' || game.result === 'loss')) {
          const outcome = current.outcomes[game.result === 'win' ? 0 : 1]?.id
          if (outcome) requested = { status: 'RESOLVED', outcome }
        } else if (current.status === 'ACTIVE') requested = { status: 'LOCKED' }
      }
      if (!requested) continue
      if (requested.status === 'RESOLVED' && !current.outcomes.some(o => o.id === requested?.outcome)) { await this.error('predictions', new DomainError('Opción ganadora inválida'), now); continue }
      // Always lock before resolution; five minutes do not imply settlement.
      if (current.status === 'ACTIVE' && requested.status === 'RESOLVED') await save(game.id, await this.predictions.update(current.id, 'LOCKED'))
      if (requested.status !== 'LOCKED' || current.status === 'ACTIVE') await save(game.id, await this.predictions.update(current.id, requested.status, requested.outcome))
      await this.store.change(state => { delete state.predictions[game.id]!.requested })
    }
  }

  async deliverMessages (now: number) {
    const state = await this.store.read()
    // A crash after claim means the remote outcome is unknown. Never blindly resend.
    for (const m of Object.values(state.messages).filter(m => m.status === 'sending')) await this.store.change(s => { s.messages[m.id]!.status = 'unknown'; if (m.reminderId && s.reminders[m.reminderId]) s.reminders[m.reminderId]!.status = 'delivery_unknown' })
    const next = Object.values(state.messages).filter(m => m.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)[0]
    if (!next) return
    const claimed = await this.store.change(s => {
      const m = s.messages[next.id]
      if (!m || m.status !== 'pending') return false
      if (m.feature && !s.settings[m.feature].enabled) { delete s.messages[m.id]; return false }
      if (m.predictionInvite) {
        const { gameId, expiresAt } = m.predictionInvite
        if (!s.settings.predictions.enabled || s.predictions[gameId]?.status !== 'ACTIVE' || now >= expiresAt) {
          delete s.messages[m.id]
          return false
        }
      }
      m.status = 'sending'; m.attempts++
      if (m.reminderId) { const r = s.reminders[m.reminderId]!; r.status = 'sending'; r.attempts++ }
      return true
    })
    if (!claimed) return
    try {
      const id = next.predictionInvite
        ? await this.twitch.announce(this.broadcasterId, next.text)
        : await this.twitch.send(this.broadcasterId, next.text, next.replyTo)
      await this.store.change(s => {
        const m = s.messages[next.id]!
        triviaDelivered(s, m.id, now)
        m.status = 'sent'
        if (id !== undefined) m.externalId = id
        if (m.reminderId) {
          const r = s.reminders[m.reminderId]!
          r.status = 'sent'
          if (id !== undefined) r.messageId = id
        }
      })
    } catch (e) {
      const status = e instanceof ProviderError || e instanceof DomainError ? e.status : undefined
      const rejectedInvite = next.predictionInvite && status !== undefined && status >= 400 && status < 500 && status !== 429
      if (rejectedInvite || (next.replyTo && (status === 400 || status === 404 || status === 422))) {
        await this.store.change(s => { delete s.messages[next.id] })
        await this.error('chat', e, now)
        return
      }
      const definite = (e instanceof ProviderError && e.status >= 400 && e.status < 500) || e instanceof DomainError
      await this.store.change(s => { const m = s.messages[next.id]!; m.status = definite ? 'pending' : 'unknown'; if (m.reminderId) s.reminders[m.reminderId]!.status = definite ? 'queued' : 'delivery_unknown' })
      await this.error('chat', e, now)
    }
  }

  async chatTasks (now: number) {
    const state = await this.store.read()
    for (const task of Object.values(state.chatTasks)) {
      const [command, ...args] = task.text.split(/\s+/)
      const isLol = command?.toLowerCase() === '!lol'
      try {
        const current = await this.store.read()
        if (isLol) {
          if ((current.cooldowns.lol ?? 0) > now && !task.actor.admin) throw new DomainError('Consulta LoL en cooldown (120 segundos)', 429)
          if (!current.account) throw new DomainError('Cuenta Riot no configurada')
          await this.store.change(s => { s.cooldowns.lol = now + 120_000 })
          const result = await this.riot.lol(current.account, args.join(' '))
          await this.store.change(s => message(s, task.id, result, now))
        } else if (current.settings.stories.enabled) {
          const guest = await this.twitch.user(args[0]!.replace(/^@/, ''))
          await this.store.change(s => {
            if (s.settings.stories.enabled) playStory(s, task.actor, { id: guest.id, name: guest.display_name, admin: false }, task.id, now, Math.random())
          })
        }
      } catch (e) {
        await this.store.change(s => {
          if (isLol || s.settings.stories.enabled) message(s, `error:${task.id}`, e instanceof DomainError ? e.message : 'No se pudo completar la consulta; intentá nuevamente.', now)
        })
      }
      await this.store.change(s => { delete s.chatTasks[task.id] })
    }
  }

  async tick (now: number) {
    await this.store.deliver()
    await this.store.change(s => triviaTick(s, now, Math.random()))
    // Independent consumers keep working when one external integration fails.
    for (const [name, action] of [['predictions', () => this.reconcilePredictions(now)], ['chat-tasks', () => this.chatTasks(now)], ['chat', () => this.deliverMessages(now)]] as const) {
      try { await action() } catch (e) { await this.error(name, e, now) }
    }
  }
}
