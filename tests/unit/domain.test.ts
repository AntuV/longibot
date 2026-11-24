import { describe, expect, it } from 'vitest'
import { initialState, DomainError, message, requireAdmin, settingsSchema, win } from '../../packages/features/src/model.js'
import { addReminder, cancelReminder, remindersEvent } from '../../packages/features/src/reminders.js'
import { observeGame, confirmGame } from '../../packages/features/src/games.js'
import { predictionsEvent } from '../../packages/features/src/predictions.js'
import { configure, startTrivia, answerTrivia, triviaTick, playStory, triviaDelivered } from '../../packages/features/src/games-play.js'
import { chat, consumers, event, features } from '../../packages/features/src/registry.js'

const mod = { id: '1', name: 'Mod', admin: true }
const viewer = { id: '2', name: 'Viewer', admin: false }
const guest = { id: '3', name: 'Guest', admin: false }
const now = 1_000_000
const game = { id: 'LA2_1', startedAt: now, observedAt: now, queue: 420 }
const gameEvent = (type: string, gameId = game.id) => ({ id: 'e', type, at: now, data: { gameId } })
function state () { const s = initialState(); s.tracking = 'idle'; return s }

describe('settings, permissions and identity', () => {
  it('defaults to disabled games, automatic predictions, all detectable queues, and no actions', () => {
    const s = state()
    expect(s.settings.trivia.enabled).toBe(false); expect(s.settings.stories.enabled).toBe(false)
    expect(s.settings.predictions.autoResolve).toBe(true); expect(s.settings.tracking.queues).toEqual([])
    expect(settingsSchema.safeParse({ channel: 'evil' }).success).toBe(false)
    expect(settingsSchema.safeParse({ predictions: { yes: 'same', no: 'same' } }).success).toBe(false)
    expect(settingsSchema.safeParse({ tracking: { pollSeconds: 1 } }).success).toBe(false)
    expect(() => requireAdmin(viewer)).toThrow(DomainError)
    expect(() => configure(s, viewer, {})).toThrow()
    expect(() => configure(s, mod, { unknown: true })).toThrow('Configuración inválida')
  })
  it('increments each game/result/user once, including two distinct story winners', () => {
    const s = state()
    for (let i = 0; i < 2; i++) for (const u of [mod, guest]) win(s, 'result', u, 'stories')
    win(s, 'result', mod, 'trivia')
    expect(s.wins['1']).toEqual({ name: 'Mod', trivia: 1, stories: 1 })
    expect(s.wins['3']?.stories).toBe(1)
    message(s, 'm', 'x'.repeat(900), now); message(s, 'm', 'replace', now)
    expect(s.messages.m?.text).toHaveLength(480)
  })
})
describe('game lifecycle', () => {
  it('starts once, distinguishes unknown presence, and confirms once', () => {
    const s = state()
    expect(observeGame(s, game, now)).toHaveLength(2)
    expect(observeGame(s, game, now + 1)).toHaveLength(1)
    observeGame(s, null, now + 2)
    expect(s.tracking).toBe('unknown'); expect(s.games[game.id]?.endedAt).toBeUndefined()
    expect(confirmGame(s, game.id, now + 3000, 'loss')).toHaveLength(2)
    expect(confirmGame(s, game.id, now + 3000, 'win')).toEqual([])
    expect(confirmGame(s, 'missing', now, 'win')).toEqual([])
    observeGame(s, null, now + 4000); expect(s.tracking).toBe('idle')
    expect(s.activeGame).toBeUndefined()
  })
  it('never treats old/unknown starts as fresh and preserves a later active game on late end', () => {
    const s = state()
    observeGame(s, { ...game, startedAt: null }, now)
    expect(s.games[game.id]?.historic).toBe(true)
    observeGame(s, { ...game, id: 'next', startedAt: now - 300_000 }, now)
    expect(s.games.next?.historic).toBe(true)
    confirmGame(s, game.id, now, 'remake')
    expect(s.activeGame).toBe('next')
  })
})
describe('durable reminders', () => {
  it('validates text, roles, limit, idempotence and assignment to the next fresh game', () => {
    const s = state()
    expect(() => addReminder(s, viewer, 'x', 'text', now)).toThrow()
    for (const text of ['', 'x'.repeat(351)]) expect(() => addReminder(s, mod, 'x', text, now)).toThrow()
    expect(addReminder(s, mod, 'r', '  hello  ', now).status).toBe('waiting_next_game')
    expect(addReminder(s, mod, 'r', 'other', now).text).toBe('hello')
    observeGame(s, game, now); remindersEvent(s, gameEvent('game.started.v1'))
    expect(s.reminders.r?.gameId).toBe(game.id)
    confirmGame(s, game.id, now + 2000, 'remake'); remindersEvent(s, gameEvent('game.ended.v1'))
    remindersEvent(s, gameEvent('game.ended.v1'))
    expect(Object.keys(s.messages)).toEqual(['reminder:r'])
    expect(s.messages['reminder:r']?.reminderId).toBe('r')
    for (let i = 1; i < 100; i++) addReminder(s, mod, String(i), 'hello', now)
    expect(() => addReminder(s, mod, 'overflow', 'hello', now)).toThrow('100')
  })
  it('binds current game and does not drain next-game reminders on late historical end', () => {
    const s = state(); observeGame(s, game, now)
    addReminder(s, mod, 'r', 'a', now + 1)
    expect(s.reminders.r?.gameId).toBe(game.id)
    observeGame(s, { ...game, id: 'next', startedAt: now + 100 }, now + 100)
    addReminder(s, mod, 'next', 'b', now + 101)
    confirmGame(s, game.id, now + 99, 'loss'); remindersEvent(s, gameEvent('game.ended.v1'))
    expect(s.messages['reminder:r']).toBeDefined(); expect(s.messages['reminder:next']).toBeUndefined()
  })
  it('reconciles unknown state by game time, recovers completed games, or waits for a future one', () => {
    const s = initialState()
    addReminder(s, mod, 'r', 'a', now + 500)
    expect(s.reminders.r?.status).toBe('awaiting_game_assignment')
    observeGame(s, game, now + 600); confirmGame(s, game.id, now + 1000, 'win')
    remindersEvent(s, gameEvent('tracking.reconciled.v1'))
    expect(s.reminders.r?.gameId).toBe(game.id); expect(s.messages['reminder:r']).toBeDefined()
    addReminder(s, mod, 'future', 'b', now + 1500)
    s.tracking = 'unknown'; addReminder(s, mod, 'unknown', 'c', now + 1500)
    remindersEvent(s, gameEvent('game.ended.v1')); expect(s.reminders.unknown?.status).toBe('awaiting_game_assignment')
    s.tracking = 'idle'; remindersEvent(s, gameEvent('tracking.reconciled.v1')); expect(s.reminders.unknown?.status).toBe('waiting_next_game')
    remindersEvent(s, gameEvent('game.started.v1', 'missing')); expect(s.reminders.future?.gameId).toBeUndefined()
    s.games.old = { ...game, id: 'old', historic: true }; remindersEvent(s, gameEvent('game.started.v1', 'old'))
    expect(s.reminders.future?.gameId).toBeUndefined()
    s.games.earlier = { ...game, id: 'earlier', historic: false }; remindersEvent(s, gameEvent('game.started.v1', 'earlier'))
    expect(s.reminders.future?.gameId).toBeUndefined()
  })
  it('cancels pending items, removes pending outputs, and refuses in-flight/unknown/sent cancellation', () => {
    const s = state(); addReminder(s, mod, 'r', 'a', now)
    expect(() => cancelReminder(s, viewer, 'r')).toThrow()
    expect(() => cancelReminder(s, mod, 'missing')).toThrow('inexistente')
    message(s, 'reminder:r', 'a', now); cancelReminder(s, mod, 'r')
    expect(s.reminders.r?.status).toBe('canceled'); expect(s.messages['reminder:r']).toBeUndefined()
    for (const status of ['sending', 'sent', 'delivery_unknown'] as const) { s.reminders.r!.status = status; expect(() => cancelReminder(s, mod, 'r')).toThrow('iniciada') }
  })
})
describe('prediction events', () => {
  it('creates a unique intent, refuses late/disabled/missing starts, and mirrors manual state', () => {
    const s = state()
    predictionsEvent(s, gameEvent('game.started.v1')); expect(s.predictions).toEqual({})
    observeGame(s, game, now); predictionsEvent(s, gameEvent('game.started.v1')); predictionsEvent(s, gameEvent('game.started.v1'))
    expect(Object.keys(s.predictions)).toHaveLength(1); expect(s.predictions[game.id]?.status).toBe('pending')
    s.predictions[game.id]!.twitchId = 't1'
    predictionsEvent(s, { ...gameEvent('prediction.state.changed.v1'), data: { id: 't1', status: 'RESOLVED' } })
    expect(s.predictions[game.id]?.status).toBe('RESOLVED')
    predictionsEvent(s, { ...gameEvent('prediction.state.changed.v1'), data: { id: 'unknown', status: 1 } })
    s.games.unknown = { ...game, id: 'unknown', startedAt: null, historic: false }
    predictionsEvent(s, gameEvent('game.started.v1', 'unknown')); expect(s.predictions.unknown?.status).toBe('skipped')
    s.games.future = { ...game, id: 'future', startedAt: now + 1, historic: false }
    predictionsEvent(s, gameEvent('game.started.v1', 'future')); expect(s.predictions.future?.status).toBe('skipped')
    s.settings.predictions.enabled = false; delete s.predictions[game.id]; predictionsEvent(s, gameEvent('game.started.v1')); expect(s.predictions[game.id]).toBeUndefined()
  })
})
describe('trivia and stories', () => {
  it('guards empty banks, permissions, concurrency, rotation and exact alternative answers', () => {
    const s = state()
    expect(() => startTrivia(s, mod, 'r', now, 0)).toThrow('deshabilitada')
    s.settings.trivia.enabled = true
    expect(() => startTrivia(s, viewer, 'r', now, 0)).toThrow()
    expect(() => startTrivia(s, mod, 'r', now, 0)).toThrow('vacío')
    s.questions.q = { id: 'q', text: 'Capital?', answers: ['Buenos Aires', 'CABA'], used: 0 }
    s.questions.q2 = { id: 'q2', text: 'Another?', answers: ['x'], used: 1 }
    startTrivia(s, mod, 'r', now, 0)
    expect(s.rounds.r?.status).toBe('pending'); triviaDelivered(s, 'trivia:r', now)
    expect(() => startTrivia(s, mod, 'another', now, 0)).toThrow('activa')
    answerTrivia(s, viewer, 'no caba no', now); expect(s.wins).toEqual({})
    answerTrivia(s, viewer, ' CABA ', now); answerTrivia(s, guest, 'caba', now)
    expect(s.wins['2']?.trivia).toBe(1); expect(s.wins['3']).toBeUndefined()
    startTrivia(s, mod, 'next', now, 0.99); triviaDelivered(s, 'trivia:next', now); expect(s.rounds.next?.questionId).toBe('q2')
    triviaTick(s, now + 301_000, 0); expect(s.rounds.next?.status).toBe('expired')
    answerTrivia(s, guest, 'x', now + 301_000)
    s.settings.trivia.enabled = false; answerTrivia(s, guest, 'x', now)
    expect(s.wins['3']).toBeUndefined()
  })
  it('schedules 30/60/90s notices only live, handles empty bank and cancels pending effects on disable', () => {
    for (const random of [0, 0.5, 0.99]) {
      const s = state(); s.settings.trivia.enabled = true
      triviaTick(s, now, random); expect(s.triviaNoticeAt).toBeUndefined()
      s.live = true; triviaTick(s, now, random)
      expect(s.triviaNoticeAt).toBe(now + [30_000, 60_000, 90_000][Math.floor(random * 3)]!)
      const due = s.triviaNoticeAt!; triviaTick(s, due, random)
      expect(s.nextTriviaAt).toBe(due + 3600_000)
      s.questions.q = { id: 'q', text: '?', answers: ['a'], used: 0 }
      startTrivia(s, mod, 'r', now, 0)
      s.triviaNoticeAt = now + 1
      configure(s, mod, { ...s.settings, trivia: { ...s.settings.trivia, enabled: false } })
      expect(s.rounds.r?.status).toBe('skipped'); expect(s.triviaNoticeAt).toBeUndefined()
      expect(Object.values(s.messages).filter(m => m.feature === 'trivia')).toHaveLength(0)
      triviaTick(s, due + 100, random)
    }
  })
  it('awards individual/duo winners once, enforces all cooldowns, and never moderates', () => {
    const s = state()
    expect(() => playStory(s, mod, undefined, 'r', now, 0)).toThrow('deshabilitadas')
    s.settings.stories.enabled = true
    expect(() => playStory(s, mod, mod, 'r', now, 0)).toThrow('otra persona')
    playStory(s, mod, guest, 'r', now, 0.6); playStory(s, mod, guest, 'r', now, 0.6)
    expect(s.wins['1']?.stories).toBe(1); expect(s.wins['3']?.stories).toBe(1)
    expect(() => playStory(s, viewer, undefined, 'r2', now + 1, 0)).toThrow('cooldown')
    expect(() => playStory(s, viewer, guest, 'r2', now + 301_000, 0)).toThrow('cooldown')
    expect(() => playStory(s, mod, undefined, 'r2', now + 3601_000, 0)).toThrow('cooldown')
    for (const [i, random] of [0.1, 0.3, 0.9].entries()) {
      s.cooldowns = {}; playStory(s, mod, undefined, `solo:${i}`, now, random)
    }
    expect(s.wins['1']?.stories).toBe(2)
    expect(Object.values(s.stories).map(r => r.family)).toContain('piratas')
  })
})
describe('feature composition and commands', () => {
  it('supports independent consumers without editing existing modules', () => {
    const registry = [...features, { name: 'extra', events: ['demo'], handle: () => {} }]
    expect(consumers('demo', registry).map(f => f.name)).toContain('extra')
    expect(event('demo', {}).type).toBe('demo')
    const s = state(); const channel = features.find(f => f.name === 'channel-events')!
    channel.handle(s, event('stream.started.v1', {})); expect(s.live).toBe(true)
    channel.handle(s, event('stream.ended.v1', {})); expect(s.live).toBe(false)
    channel.handle(s, event('chat.message.received.v1', {})); expect(s.messages).toEqual({})
    channel.handle(s, event('chat.message.received.v1', { userId: '2', userName: 'V', text: '!lol Ahri' }, now, 'lol'))
    channel.handle(s, event('chat.message.received.v1', { userId: '2', userName: 'V', text: '!historia' }, now, 'story'))
    expect(s.chatTasks.lol).toBeDefined(); expect(s.messages['error:story']?.text).toContain('deshabilitadas')
  })
  it('uses primary gift signals, rule IDs and anonymous identities without duplicate messages', () => {
    const s = state(); const handler = features.find(f => f.name === 'channel-events')!.handle
    s.settings.actions = [
      { id: 'gift', event: 'twitch.subscription.started.v1', text: '{user}', enabled: true },
      { id: 'rule', event: 'twitch.followed.v1', text: 'Gracias {user}', enabled: true },
      { id: 'disabled', event: 'twitch.followed.v1', text: 'no', enabled: false },
      { id: 'reward', event: 'twitch.redemption.created.v1', rewardId: 'r', text: 'r', enabled: true }
    ]
    handler(s, event('twitch.subscription.started.v1', { isGift: true }, now, 'gift'))
    handler(s, event('twitch.followed.v1', {}, now, 'anon')); handler(s, event('twitch.followed.v1', {}, now, 'anon'))
    handler(s, event('twitch.followed.v1', { userName: 'Alice' }, now, 'named'))
    handler(s, event('twitch.redemption.created.v1', { rewardId: 'wrong' }, now, 'wrong'))
    expect(Object.keys(s.messages)).toHaveLength(2); expect(s.messages['action:anon:rule']?.text).toContain('anónima')
  })
  it('routes commands, errors, disabled games and help without retired features', () => {
    const s = state()
    for (const [i, text] of ['!ayuda', '!comandos', '!recordar lista', '!recordar hello', '!recordar quitar missing', '!pregunta va', '!historia', '!historia @nobody', '!victorias', '!config get secret', '!anime', '!tts', '!clip', '!puntos', '!apuesta', 'ordinary'].entries()) chat(s, mod, String(i), text, now)
    expect(s.messages['2']?.text).toContain('Sin recordatorios')
    expect(s.reminders['3']?.text).toBe('hello')
    expect(s.messages['3']?.text).toBe('¡Recordatorio guardado!')
    chat(s, mod, 'list', '!recordar lista', now); expect(s.messages.list?.text).toContain('hello')
    chat(s, mod, 'cancel', '!recordar quitar 3', now); expect(s.reminders['3']?.status).toBe('canceled')
    chat(s, viewer, 'deny', '!recordar no', now); expect(s.messages['error:deny']?.text).toContain('moderador')
    expect(s.messages['8']?.text).toContain('trivia 0')
    expect(Object.values(s.messages).some(m => m.text.includes('secret'))).toBe(false)
    for (const id of ['10', '11', '12', '13', '14']) expect(s.messages[id]).toBeUndefined()
    s.settings.trivia.enabled = true; s.questions.q = { id: 'q', text: '?', answers: ['a'], used: 0 }
    chat(s, viewer, 'denytrivia', '!pregunta va', now)
    chat(s, mod, 'help', '!pregunta wrong', now)
    chat(s, mod, 'round', '!pregunta va', now)
    chat(s, mod, 'skip', '!pregunta saltear', now)
    expect(s.rounds.round?.status).toBe('skipped')
    s.settings.stories.enabled = true; chat(s, viewer, 'story', '!historia', now, { random: 0.2 })
    chat(s, viewer, 'wins', '!victorias', now); expect(s.messages.wins?.text).toContain('historias 1')
  })
})

it('registers commands by feature, gates disabled modules, isolates bot messages and preserves new command exceptions', async () => {
  const { registeredCommands } = await import('../../packages/features/src/registry.js')
  const s = state()
  expect(registeredCommands(s)).not.toContain('!historia')
  s.settings.stories.enabled = true; expect(registeredCommands(s)).toContain('!historia')
  const extra = { name: 'extra', events: [], handle: () => {}, commands: { '!extra': () => { throw new Error('programmer failure') } } }
  expect(() => chat(s, mod, 'extra', '!extra', now, { random: 0, registry: [...features, extra] })).toThrow('programmer failure')
  chat(s, mod, 'lolhelp', '!lol', now); expect(s.messages.lolhelp?.text).toContain('Usá')
  for (const f of features.filter(f => f.events.length === 0)) f.handle(s, event('unused', {}))
  features.find(f => f.name === 'channel-events')!.handle(s, event('chat.message.received.v1', { self: true, userId: 'bot', userName: 'Bot', text: '!ayuda' }, now, 'self'))
  expect(s.messages.self).toBeUndefined()
  expect(settingsSchema.safeParse({ actions: [{ id: 'same', event: 'x', text: 'x', enabled: true }, { id: 'same', event: 'x', text: 'x', enabled: true }] }).success).toBe(false)
  observeGame(s, game, now); confirmGame(s, game.id, now + 1)
  expect(observeGame(s, game, now + 2)).toHaveLength(1); expect(s.tracking).toBe('idle')
  observeGame(s, { ...game, id: 'next' }, now + 3); observeGame(s, game, now + 4)
  expect(s.activeGame).toBe('next'); expect(s.tracking).toBe('active')
  expect(confirmGame(s, game.id, now + 1, 'remake')).toHaveLength(1)
  s.cooldowns = {}; playStory(s, mod, guest, 'guest-win', now, 0.3); expect(s.wins[guest.id]?.stories).toBe(1)
})
