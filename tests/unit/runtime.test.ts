import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Runtime } from '../../packages/infrastructure/src/runtime.js'
import type { StateStore } from '../../packages/infrastructure/src/runtime.js'
import { initialState, DomainError, message } from '../../packages/features/src/model.js'
import type { DomainEvent, State } from '../../packages/features/src/model.js'
import { consumers } from '../../packages/features/src/registry.js'
import { observeGame } from '../../packages/features/src/games.js'
import { addReminder } from '../../packages/features/src/reminders.js'
import type { Riot } from '../../packages/infrastructure/src/adapters/riot.js'
import type { Twitch } from '../../packages/infrastructure/src/adapters/twitch.js'
import type { ExternalPrediction, PredictionsPort } from '../../packages/features/src/predictions.js'
import { ProviderError } from '../../packages/infrastructure/src/adapters/http.js'
import { normalize } from '../../packages/infrastructure/src/adapters/eventsub.js'
const now = 1_000_000
const actor = { id: 'u', name: 'Mod', admin: true }
const game = { id: 'LA2_1', startedAt: now - 1000, observedAt: now, queue: 420 }
const account = { gameName: 'Name', tagLine: 'TAG', puuid: 'p', platform: 'la2' as const, region: 'americas' as const }
const external: ExternalPrediction = { id: 't', title: '¿Gana esta partida?', status: 'ACTIVE', createdAt: now, outcomes: [{ id: 'yes', title: 'Sí' }, { id: 'no', title: 'No' }] }
const result = (overrides: Partial<{ gameDuration: number, gameEndTimestamp: number | undefined, gameStartTimestamp: number, queueId: number, participants: { puuid: string, win: boolean, championId: number, gameEndedInEarlySurrender?: boolean }[] }> = {}) => ({ metadata: { matchId: game.id }, info: { gameDuration: 600, gameStartTimestamp: game.startedAt, gameEndTimestamp: now + 599_000, queueId: 420, participants: [{ puuid: 'p', win: true, championId: 1 }], ...overrides } })
class Memory implements StateStore {
  state = initialState()
  async read () { return structuredClone(this.state) }
  async change<T> (fn: (s: State) => T) { return fn(this.state) }
  async emit (fn: (s: State) => DomainEvent[]) { const events = fn(this.state); for (const e of events) for (const consumer of consumers(e.type)) consumer.handle(this.state, e) }
  async deliver () {}
}
let store: Memory
let riot: { result: ReturnType<typeof vi.fn<Riot['result']>>, history: ReturnType<typeof vi.fn<Riot['history']>>, poll: ReturnType<typeof vi.fn<Riot['poll']>>, lol: ReturnType<typeof vi.fn<Riot['lol']>> }
let twitch: { [K in 'announce' | 'send' | 'user' | 'createClip' | 'clipUrl']: ReturnType<typeof vi.fn<Twitch[K]>> }
let predictions: PredictionsPort & { list: ReturnType<typeof vi.fn<PredictionsPort['list']>>, create: ReturnType<typeof vi.fn<PredictionsPort['create']>>, update: ReturnType<typeof vi.fn<PredictionsPort['update']>> }
let runtime: Runtime
beforeEach(() => {
  store = new Memory()
  riot = { result: vi.fn().mockResolvedValue(null), poll: vi.fn().mockResolvedValue(null), history: vi.fn().mockResolvedValue([]), lol: vi.fn().mockResolvedValue('LoL result') }
  twitch = {
    announce: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue('message-id'),
    user: vi.fn().mockResolvedValue({ id: 'guest', display_name: 'Guest', login: 'guest' }),
    createClip: vi.fn().mockResolvedValue('example'),
    clipUrl: vi.fn().mockResolvedValue(undefined)
  }
  predictions = { list: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue(external), update: vi.fn().mockImplementation(async (_id, status) => ({ ...external, status })) }
  runtime = new Runtime(store, riot, twitch, predictions, 'b')
})
async function start () { store.state.account = account; await store.emit(s => observeGame(s, game, now)) }
const command = (id: string, text: string, admin = true) => store.emit(() => [{
  id,
  type: 'chat.message.received.v1',
  at: now,
  data: { userId: actor.id, userName: actor.name, admin, text, chatMessageId: `chat-${id}` }
}])

describe('!clip', () => {
  it('replies when Twitch says the requester does not follow the channel', async () => {
    twitch.createClip.mockResolvedValueOnce(undefined)
    await command('non-follower', '!clip Una jugada')
    await runtime.chatTasks(now)
    expect(store.state.messages['non-follower']).toMatchObject({ text: 'Para usar !clip tenés que seguir el canal.', replyTo: 'chat-non-follower' })
    expect(twitch.createClip).toHaveBeenCalledExactlyOnceWith('b', 'Una jugada', actor.id)
    expect(store.state.chatTasks).toEqual({})
  })

  it('requests the stream title for a bare command and replies to the original message', async () => {
    await command('untitled', '!clip   ')
    await runtime.tick(now)
    expect(twitch.createClip).toHaveBeenCalledExactlyOnceWith('b', undefined, actor.id)
    twitch.clipUrl.mockResolvedValueOnce('https://clips.twitch.tv/example')
    await runtime.tick(now + 2000)
    expect(twitch.send).toHaveBeenCalledExactlyOnceWith('b', '¡Clip creado! https://clips.twitch.tv/example', 'chat-untitled')
  })

  it('preserves the title and posts only the confirmed public URL as a reply', async () => {
    const url = 'https://clips.twitch.tv/example'
    await command('clip', '!CLIP  ¡Qué  jugada! & GG  ', false)
    await runtime.tick(now)
    expect(twitch.createClip).toHaveBeenCalledExactlyOnceWith('b', '¡Qué  jugada! & GG', actor.id)
    await runtime.tick(now + 2000)
    expect(twitch.clipUrl).toHaveBeenCalledWith('example')
    expect(twitch.send).not.toHaveBeenCalled()
    twitch.clipUrl.mockResolvedValueOnce(url)
    await runtime.tick(now + 4000)
    expect(twitch.send).toHaveBeenCalledExactlyOnceWith('b', `¡Clip creado! ${url}`, 'chat-clip')
    expect(twitch.createClip).toHaveBeenCalledTimes(1)
    expect(store.state.chatTasks).toEqual({})
  })

  it('ends unconfirmed requests without resubmitting the creation', async () => {
    await command('clip', '!clip Una jugada')
    await runtime.chatTasks(now)
    await runtime.chatTasks(now + 60_000)
    expect(twitch.createClip).toHaveBeenCalledTimes(1)
    expect(store.state.messages.clip?.text).toContain('No pude confirmar')
    expect(store.state.chatTasks).toEqual({})
  })

  it('skips stale commands and never resubmits a clip interrupted during creation', async () => {
    await command('interrupted', '!clip Una jugada')
    store.state.chatTasks.interrupted!.clip!.submitted = { at: now }
    await command('stale', '!clip Una jugada')
    await runtime.chatTasks(now + 30_000)
    expect(twitch.createClip).not.toHaveBeenCalled()
    expect(store.state.messages.interrupted?.text).toContain('No pude confirmar')
    expect(store.state.messages.stale?.text).toContain('llegó tarde')
    expect(store.state.chatTasks).toEqual({})
  })
})
describe('Riot polling and downtime reconciliation', () => {
  it('respects tracking flags and only-live settings', async () => {
    await runtime.poll(now); expect(riot.poll).not.toHaveBeenCalled()
    store.state.account = account; store.state.settings.tracking.enabled = false
    await runtime.poll(now); expect(riot.poll).not.toHaveBeenCalled()
    store.state.settings.tracking.enabled = true; store.state.settings.tracking.onlyLive = true
    await runtime.poll(now); expect(riot.poll).not.toHaveBeenCalled()
    store.state.live = true; await runtime.poll(now); expect(riot.poll).toHaveBeenCalledOnce()
  })
  it('confirms wins, losses and remakes only from Match and never ends on spectator absence', async () => {
    await start(); await runtime.poll(now)
    expect(store.state.tracking).toBe('unknown'); expect(store.state.games[game.id]?.endedAt).toBeUndefined()
    riot.result.mockResolvedValue(result({ participants: [{ puuid: 'other', win: true, championId: 1 }] }))
    await runtime.poll(now); expect(store.state.games[game.id]?.endedAt).toBeDefined(); expect(store.state.games[game.id]?.result).toBeUndefined()
    riot.result.mockResolvedValue(result({ gameEndTimestamp: undefined, participants: [{ puuid: 'p', win: false, championId: 1 }] }))
    await runtime.poll(now); expect(store.state.games[game.id]?.result).toBe('loss')
    expect(store.state.games[game.id]?.endedAt).toBe(game.startedAt + 600_000)
  })
  it('recovers a completed historical game for an unknown reminder without creating a prediction', async () => {
    store.state.account = account
    addReminder(store.state, actor, 'r', 'remember', now)
    riot.history.mockResolvedValue([game.id]); riot.result.mockResolvedValue(result())
    await runtime.poll(now + 700_000)
    expect(store.state.games[game.id]?.historic).toBe(true)
    expect(store.state.reminders.r?.gameId).toBe(game.id)
    expect(store.state.messages['reminder:r']).toBeDefined()
    expect(store.state.predictions).toEqual({})
    await runtime.poll(now + 700_001)
    expect(riot.history).toHaveBeenCalledOnce()
  })
  it('does not assign incomplete history or silently select a new game when Riot fails', async () => {
    store.state.account = account; addReminder(store.state, actor, 'r', 'a', now)
    riot.history.mockResolvedValue(['missing', 'ambiguous']); riot.result.mockResolvedValueOnce(null).mockResolvedValueOnce(result({ gameDuration: 10 }))
    await runtime.poll(now); expect(store.state.reminders.r?.status).toBe('queued'); expect(store.state.messages['reminder:r']).toBeDefined(); expect(store.state.predictions).toEqual({})
    riot.poll.mockRejectedValue(new ProviderError(429, 10_000))
    await expect(runtime.poll(now)).rejects.toThrow()
    expect(store.state.tracking).toBe('unknown'); expect(store.state.errors.at(-1)?.feature).toBe('riot')
  })
})
describe('prediction operations and recovery', () => {
  it('creates once with exactly 300s and does not resolve merely because five minutes elapsed', async () => {
    await start(); await runtime.reconcilePredictions(now)
    expect(predictions.create).toHaveBeenCalledWith('¿Gana esta partida?', ['Sí', 'No'], 300)
    predictions.list.mockResolvedValue([external]); await runtime.reconcilePredictions(now + 301_000)
    expect(predictions.create).toHaveBeenCalledOnce(); expect(predictions.update).not.toHaveBeenCalled()
  })
  it('announces an opened prediction once, including after reconciliation', async () => {
    await start()
    await runtime.tick(now)
    expect(twitch.announce).toHaveBeenCalledWith('b', '¡Se abrió la predicción! ¿Gana esta partida? Elegí tu opción con puntos del canal desde el chat.')
    expect(store.state.messages['prediction:invite:t']?.status).toBe('sent')
    predictions.list.mockResolvedValue([external])
    await runtime.tick(now + 2000)
    expect(twitch.announce).toHaveBeenCalledOnce()
    expect(twitch.send).not.toHaveBeenCalled()
  })
  it.each(['expired', 'locked'])('drops an invitation when the prediction is %s before delivery', async reason => {
    await start()
    await runtime.reconcilePredictions(now)
    if (reason === 'locked') store.state.predictions[game.id]!.status = 'LOCKED'
    await runtime.deliverMessages(reason === 'expired' ? now + 300_000 : now)
    expect(twitch.announce).not.toHaveBeenCalled()
    expect(store.state.messages['prediction:invite:t']).toBeUndefined()
  })
  it.each(['win', 'loss', 'remake'] as const)('automatically settles %s after confirmed game end', async outcome => {
    await start(); await runtime.reconcilePredictions(now)
    store.state.games[game.id]!.endedAt = now + 10_000; store.state.games[game.id]!.result = outcome
    predictions.list.mockResolvedValue([external]); await runtime.reconcilePredictions(now + 10_000)
    if (outcome === 'remake') expect(predictions.update).toHaveBeenCalledWith('t', 'CANCELED', undefined)
    else {
      expect(predictions.update).toHaveBeenNthCalledWith(1, 't', 'LOCKED')
      expect(predictions.update).toHaveBeenLastCalledWith('t', 'RESOLVED', outcome === 'win' ? 'yes' : 'no')
    }
  })
  it('preserves manual outcomes, closes unresolved games, and accepts audited manual requests', async () => {
    await start(); await runtime.reconcilePredictions(now)
    predictions.list.mockResolvedValue([{ ...external, status: 'RESOLVED' }]); await runtime.reconcilePredictions(now)
    expect(predictions.update).not.toHaveBeenCalled(); expect(store.state.predictions[game.id]?.status).toBe('RESOLVED')
    store.state.predictions[game.id]!.status = 'ACTIVE'; predictions.list.mockResolvedValue([external])
    store.state.games[game.id]!.endedAt = now + 1
    await runtime.reconcilePredictions(now); expect(predictions.update).toHaveBeenLastCalledWith('t', 'LOCKED', undefined)
    store.state.predictions[game.id]!.requested = { status: 'RESOLVED', outcome: 'no' }
    predictions.list.mockResolvedValue([{ ...external, status: 'LOCKED' }]); await runtime.reconcilePredictions(now)
    expect(predictions.update).toHaveBeenLastCalledWith('t', 'RESOLVED', 'no')
  })
  it('fails closed for late starts, excluded queues, disabled feature, unknown age and existing predictions', async () => {
    for (const scenario of ['late', 'queue', 'disabled', 'unknown', 'ended', 'conflict']) {
      store.state = initialState(); predictions.list.mockResolvedValue([]); await start()
      if (scenario === 'queue') store.state.settings.tracking.queues = [450]
      if (scenario === 'disabled') store.state.settings.predictions.enabled = false
      if (scenario === 'unknown') store.state.games[game.id]!.startedAt = null
      if (scenario === 'ended') store.state.games[game.id]!.endedAt = now
      if (scenario === 'conflict') predictions.list.mockResolvedValue([external])
      await runtime.reconcilePredictions(scenario === 'late' ? now + 300_000 : now)
      expect(['skipped', 'conflict']).toContain(store.state.predictions[game.id]?.status)
    }
    expect(predictions.create).not.toHaveBeenCalled()
  })
  it('does not recreate after uncertain response or restart, and records definitive API conflicts', async () => {
    await start(); predictions.create.mockRejectedValue(new ProviderError(0))
    await runtime.reconcilePredictions(now); expect(store.state.predictions[game.id]?.status).toBe('creation_unknown')
    predictions.list.mockResolvedValue([external]); await runtime.reconcilePredictions(now)
    expect(predictions.create).toHaveBeenCalledOnce()
    expect(store.state.messages).toEqual({})
    store.state.predictions[game.id]!.status = 'creating'; await runtime.reconcilePredictions(now)
    expect(store.state.predictions[game.id]?.status).toBe('creation_unknown')
    store.state.predictions[game.id]!.status = 'pending'; predictions.list.mockResolvedValue([]); predictions.create.mockRejectedValue(new ProviderError(409))
    await runtime.reconcilePredictions(now); expect(store.state.predictions[game.id]?.status).toBe('conflict')
  })
  it('does not overwrite foreign or missing predictions and rejects invalid winners', async () => {
    await start(); await runtime.reconcilePredictions(now)
    predictions.list.mockResolvedValue([]); await runtime.reconcilePredictions(now); expect(store.state.errors.at(-1)?.message).toContain('no encontrada')
    predictions.list.mockResolvedValue([external]); store.state.predictions[game.id]!.requested = { status: 'RESOLVED', outcome: 'foreign' }
    await runtime.reconcilePredictions(now); expect(predictions.update).not.toHaveBeenCalled()
    expect(store.state.errors.at(-1)?.message).toContain('inválida')
    delete store.state.games[game.id]; await runtime.reconcilePredictions(now); expect(predictions.update).not.toHaveBeenCalled()
  })
})
describe('chat delivery', () => {
  it.each([
    ['!ayuda', '!clip [título]'],
    ['!lol  ', 'Usá !lol <campeón>.'],
    ['!recordar lista', 'Sin recordatorios pendientes.'],
    ['!recordar quitar missing', 'Recordatorio inexistente']
  ])('replies to %s in the original thread', async (text, response) => {
    await command('request', text)
    await runtime.tick(now)
    expect(twitch.send).toHaveBeenCalledExactlyOnceWith('b', expect.stringContaining(response), 'chat-request')
  })

  it('allows a new trivia round when Twitch rejects the question reply', async () => {
    store.state.settings.trivia.enabled = true
    store.state.questions.q = { id: 'q', text: 'Question?', answers: ['a'], used: 0 }
    await command('old', '!pregunta va')
    twitch.send.mockRejectedValueOnce(new ProviderError(404))
    await runtime.deliverMessages(now)
    expect(store.state.rounds.old?.status).toBe('skipped')
    await command('new', '!pregunta va')
    await runtime.deliverMessages(now)
    expect(twitch.send).toHaveBeenLastCalledWith('b', 'Question?', 'chat-new')
    expect(store.state.rounds.new?.status).toBe('active')
  })

  it('replies to the original Twitch message when saving a reminder', async () => {
    const command = normalize('event-id', 'channel.chat.message', {
      broadcaster_user_id: 'b',
      chatter_user_id: 'b',
      chatter_user_name: 'Streamer',
      message_id: 'chat-id',
      message: { text: '!recordar revisar el partido' }
    }, now, 'b')
    await store.emit(() => [command])
    await runtime.deliverMessages(now)
    expect(twitch.send).toHaveBeenCalledWith('b', '¡Recordatorio guardado!', 'chat-id')
    expect(store.state.reminders['event-id']?.text).toBe('revisar el partido')
  })
  it('lets later chat messages through if Twitch rejects a reply to a missing message', async () => {
    message(store.state, 'reply', '¡Recordatorio guardado!', now, undefined, 'deleted-chat-id')
    message(store.state, 'next', 'Siguiente mensaje', now + 1)
    twitch.send.mockRejectedValueOnce(new ProviderError(404))
    await runtime.deliverMessages(now)
    await runtime.deliverMessages(now)
    expect(store.state.messages.reply).toBeUndefined()
    expect(twitch.send).toHaveBeenLastCalledWith('b', 'Siguiente mensaje', undefined)
  })
  it('persists claims and remote IDs, sends in chronological order and marks reminder sent', async () => {
    store.state.tracking = 'idle'; addReminder(store.state, actor, 'r', 'a', now)
    message(store.state, 'b', 'second', now + 2); message(store.state, 'a', 'first', now)
    store.state.messages.a!.reminderId = 'r'
    await runtime.deliverMessages(now)
    expect(twitch.send).toHaveBeenCalledWith('b', 'first', undefined)
    expect(store.state.messages.a?.externalId).toBe('message-id'); expect(store.state.reminders.r?.status).toBe('sent')
    await runtime.deliverMessages(now); expect(twitch.send).toHaveBeenLastCalledWith('b', 'second', undefined)
  })
  it('marks crashed/uncertain effects as unknown without retrying, while definite rejections stay pending', async () => {
    store.state.tracking = 'idle'; addReminder(store.state, actor, 'r', 'a', now)
    message(store.state, 'm', 'a', now); store.state.messages.m!.reminderId = 'r'
    twitch.send.mockRejectedValue(new ProviderError(429, 1000)); await runtime.deliverMessages(now)
    expect(store.state.messages.m?.status).toBe('pending'); expect(store.state.reminders.r?.status).toBe('queued')
    twitch.send.mockRejectedValue(new Error('network')); await runtime.deliverMessages(now)
    expect(store.state.messages.m?.status).toBe('unknown'); expect(store.state.reminders.r?.status).toBe('delivery_unknown')
    await runtime.deliverMessages(now); expect(twitch.send).toHaveBeenCalledTimes(2)
    store.state.messages.m!.status = 'sending'; await runtime.deliverMessages(now)
    expect(store.state.messages.m?.status).toBe('unknown'); expect(twitch.send).toHaveBeenCalledTimes(2)
  })
  it('checks feature flags again before sending pending game effects', async () => {
    message(store.state, 'm', 'disabled', now, 'trivia')
    await runtime.deliverMessages(now); expect(twitch.send).not.toHaveBeenCalled(); expect(store.state.messages.m).toBeUndefined()
    message(store.state, 'story', 'disabled', now, 'stories'); await runtime.deliverMessages(now); expect(twitch.send).not.toHaveBeenCalled()
  })
  it('isolates failed consumers and retains sanitized, bounded errors', async () => {
    await start(); predictions.list.mockRejectedValue(new Error('secret token'))
    message(store.state, 'm', 'message', now); await runtime.tick(now)
    expect(twitch.send).toHaveBeenCalled(); expect(store.state.errors[0]?.message).not.toContain('secret')
    store.state.errors = Array.from({ length: 100 }, () => ({ feature: 'x', at: now, message: 'x' }))
    await runtime.error('last', new DomainError('known'), now); expect(store.state.errors).toHaveLength(100)
  })
})
describe('external chat queries', () => {
  it('handles LoL cooldown, missing account, errors and successful replies without permanent locks', async () => {
    await command('missing', '!lol ahri', false); await runtime.chatTasks(now)
    expect(store.state.messages['error:missing']).toMatchObject({ text: expect.stringContaining('configurada'), replyTo: 'chat-missing' })
    store.state.account = account; await command('ok', '!lol ahri', false); await runtime.chatTasks(now)
    expect(riot.lol).toHaveBeenCalledOnce()
    expect(store.state.messages.ok).toMatchObject({ text: 'LoL result', replyTo: 'chat-ok' })
    await command('cooldown', '!lol ahri', false); await runtime.chatTasks(now)
    expect(store.state.messages['error:cooldown']).toMatchObject({ text: expect.stringContaining('cooldown'), replyTo: 'chat-cooldown' })
    riot.lol.mockRejectedValue(new Error('secret')); await command('error', '!lol ahri'); await runtime.chatTasks(now)
    expect(store.state.messages['error:error']).toMatchObject({ text: 'No se pudo completar la consulta; intentá nuevamente.', replyTo: 'chat-error' })
    expect(store.state.chatTasks).toEqual({})
    riot.lol.mockResolvedValue('recovered'); await command('recover', '!lol ahri', false); await runtime.chatTasks(now + 121_000)
    expect(store.state.messages.recover).toMatchObject({ text: 'recovered', replyTo: 'chat-recover' })
  })
  it('resolves guest identities and respects disabled stories before calling Twitch', async () => {
    store.state.chatTasks.story = { id: 'story', actor, text: '!historia @guest', at: now }
    await runtime.chatTasks(now); expect(twitch.user).not.toHaveBeenCalled()
    expect(store.state.messages).toEqual({})
    expect(store.state.chatTasks).toEqual({})
    store.state.settings.stories.enabled = true; await command('story2', '!historia @guest')
    await runtime.chatTasks(now); expect(twitch.user).toHaveBeenCalledWith('guest'); expect(store.state.stories.story2?.users).toEqual(['u', 'guest'])
    expect(store.state.messages['story:story2']?.replyTo).toBe('chat-story2')
  })
})
it('starts the trivia answer window only after acknowledged delivery and applies LoL cooldown within one batch', async () => {
  const { startTrivia, answerTrivia, triviaDelivered } = await import('../../packages/features/src/games-play.js')
  store.state.settings.trivia.enabled = true; store.state.questions.q = { id: 'q', text: 'Question?', answers: ['a'], used: 0 }
  startTrivia(store.state, actor, 'round', now, 0)
  answerTrivia(store.state, actor, 'a', now); expect(store.state.wins).toEqual({})
  await runtime.deliverMessages(now + 100_000)
  expect(store.state.rounds.round?.expiresAt).toBe(now + 400_000)
  answerTrivia(store.state, actor, 'a', now + 100_001); expect(store.state.wins.u?.trivia).toBe(1)
  triviaDelivered(store.state, 'other-message', now)
  store.state.settings.trivia.enabled = false; triviaDelivered(store.state, 'trivia:missing', now)
  store.state.account = account
  for (const id of ['first', 'second']) store.state.chatTasks[id] = { id, actor: { ...actor, admin: false }, text: '!lol Ahri', at: now }
  await runtime.chatTasks(now)
  expect(riot.lol).toHaveBeenCalledOnce(); expect(store.state.messages['error:second']?.text).toContain('cooldown')
})
it('recovers the first next game missed entirely during downtime without creating historical predictions', async () => {
  store.state.tracking = 'idle'; store.state.account = account
  addReminder(store.state, actor, 'next', 'after the next game', now)
  riot.history.mockResolvedValue(['later', 'first', 'before'])
  riot.result.mockImplementation(async (_account, id) => result({ gameStartTimestamp: id === 'before' ? now - 10000 : id === 'first' ? now + 1000 : now + 2000, gameEndTimestamp: now + 3000 }))
  await runtime.poll(now + 10_000)
  expect(store.state.reminders.next?.gameId).toBe('first'); expect(store.state.messages['reminder:next']).toBeDefined()
  expect(store.state.predictions).toEqual({})
})
it('keeps the next-game intention explicit when history is truncated and backfills an unknown start time from Match', async () => {
  store.state.tracking = 'idle'; store.state.account = account
  addReminder(store.state, actor, 'next', 'a', now)
  riot.history.mockResolvedValue(Array.from({ length: 20 }, (_, i) => String(i)))
  await expect(runtime.poll(now)).rejects.toThrow('Historial incompleto')
  expect(store.state.reminders.next?.gameId).toBeUndefined(); expect(riot.poll).not.toHaveBeenCalled()
  delete store.state.reminders.next
  store.state.tracking = 'unknown'; addReminder(store.state, actor, 'unknown', 'b', now)
  store.state.games[game.id] = { ...game, startedAt: null, historic: true }
  riot.history.mockResolvedValue([]); riot.result.mockResolvedValue(result())
  await runtime.poll(now + 10_000)
  expect(store.state.reminders.unknown?.gameId).toBe(game.id)
})
