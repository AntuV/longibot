// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dashboard, pages } from '../../apps/dashboard/src/dashboard.js'
import { api, ApiError } from '../../apps/dashboard/src/api.js'
import { initialState } from '../../packages/features/src/model.js'
import type { State } from '../../packages/features/src/model.js'

// jsdom lacks ResizeObserver, which Radix primitives (Checkbox, Select) use for sizing.
globalThis.ResizeObserver ??= class { observe () {} unobserve () {} disconnect () {} }
let state: State
let streamer: boolean
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>
const requests: { path: string, method: string, body: unknown }[] = []
const user = { userId: 'b', name: 'Streamer', csrf: 'csrf', admin: true, streamer: true, channel: 'longii_' }
let clients: QueryClient[] = []
function mount (path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route element={<Dashboard />}>{pages.map(p => <Route key={p.path} path={p.path} element={<p.component />} />)}</Route></Routes></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => {
  state = initialState(); streamer = true; requests.length = 0
  fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = String(url); const method = init?.method ?? 'GET'
    if (method !== 'GET') { requests.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null }); return Response.json({ ok: true }) }
    if (path.endsWith('auth/me')) return Response.json({ ...user, streamer })
    if (path.endsWith('admin/state')) return Response.json({ channel: 'longii_', broadcasterId: 'b', state })
    return Response.json({ audit: [{ user_id: 'b', action: 'settings.update', at: 'today' }], events: [{ data: { id: 'e', type: 'stream.started.v1', at: 0 }, received_at: 'today' }], deliveries: [{ event_id: 'e', consumer: 'reminders', completed_at: null }], connections: [{ purpose: 'bot', user_id: 'bot', updated_at: 'today' }], worker: { at: 1_000_000 } })
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { cleanup(); clients.forEach(c => c.clear()); clients = []; vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('dashboard authentication and loading', () => {
  it('offers OAuth to unauthenticated users without exposing administration', async () => {
    fetcher.mockResolvedValue(Response.json({ message: 'Iniciá sesión' }, { status: 401 }))
    mount(); expect(await screen.findByRole('heading', { name: 'Tu canal, en orden.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ingresar con Twitch' }).getAttribute('href')).toBe('/api/auth/twitch')
    expect(screen.queryByRole('navigation')).toBeNull(); expect(screen.getByRole('status').textContent).toContain('moderadores')
  })
  it('displays revoked permissions and transient service failures', async () => {
    fetcher.mockResolvedValue(Response.json({ message: 'Permiso revocado' }, { status: 403 }))
    mount(); expect(await screen.findByText('Permiso revocado')).toBeTruthy()
  })
  it('shows initial loading, state loading and state errors', async () => {
    fetcher.mockImplementation(async path => {
      if (String(path).endsWith('auth/me')) return Response.json(user)
      return Response.json({ message: 'Base no disponible' }, { status: 503 })
    })
    mount(); expect(screen.getByText('Verificando sesión…')).toBeTruthy()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Base no disponible')
  })
})
describe('administration screens', () => {
  it('shows the summary, live/game states and broadcaster connections, and submits Riot ID routing', async () => {
    state.live = true; state.tracking = 'active'; state.activeGame = 'LA2_1'; state.games.LA2_1 = { id: 'LA2_1', startedAt: 1, observedAt: 2, queue: 420, historic: true, result: 'win' }
    mount(); expect(await screen.findByRole('heading', { name: 'Hola, Streamer' })).toBeTruthy()
    expect(screen.getAllByText('En vivo').length).toBeGreaterThan(0); expect(screen.getByText('En juego')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Nada necesita atención' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Conectar cuenta del bot' })).toBeTruthy()
    cleanup(); mount('/features')
    const form = await screen.findByRole('form', { name: 'Cuenta de League of Legends' })
    fireEvent.change(within(form).getByLabelText('Riot ID (nombre) *'), { target: { value: 'Name' } })
    fireEvent.change(within(form).getByLabelText('Tag *'), { target: { value: 'TAG' } })
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cuenta' }))
    await waitFor(() => expect(requests[0]).toMatchObject({ path: '/api/admin/account', method: 'PUT', body: { gameName: 'Name', tagLine: 'TAG', platform: 'la2', region: 'americas' } }))
    expect(await screen.findByText('Cambios guardados.')).toBeTruthy()
  })
  it('leads the summary with what needs a human and links straight to it', async () => {
    state.predictions.u = { gameId: 'LA2_9', status: 'creation_unknown', createdAt: Date.now() }
    state.messages.m = { id: 'm', text: 'Hola chat', status: 'unknown', attempts: 1, createdAt: 1 }
    mount(); expect(await screen.findByRole('heading', { name: 'Twitch no confirmó la prediction' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Vincular prediction' }).getAttribute('href')).toBe('/predictions')
    expect(screen.getByRole('link', { name: 'Revisar entrega' }).getAttribute('href')).toBe('/operacion')
  })
  it('keeps secondary sections behind «Más» on the phone tab bar', async () => {
    mount(); await screen.findByRole('heading', { name: 'Hola, Streamer' })
    const more = screen.getByRole('button', { name: 'Más' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Más secciones' })).getByRole('link', { name: 'Operación' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Operación' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Más', hidden: true }).getAttribute('aria-expanded')).toBe('false')
  })
  it('shows mod access and idle state without broadcaster-only links', async () => {
    streamer = false; state.tracking = 'idle'; state.account = { gameName: 'Saved', tagLine: 'TAG', platform: 'euw1', region: 'europe', puuid: 'p' }
    mount(); expect(await screen.findByText('Sin partida')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Conectar cuenta del canal' })).toBeNull()
    cleanup(); mount('/features')
    expect(await screen.findByLabelText('Riot ID (nombre) *')).toHaveProperty('value', 'Saved')
  })
  it('adds and cancels reminders, preserving remote assignment/status details', async () => {
    state.reminders.r = { id: 'r', text: 'Existing', author: 'Mod', status: 'queued', createdAt: 1, gameId: 'LA2_1', attempts: 0 }
    mount('/recordatorios'); const input = await screen.findByLabelText('Texto del recordatorio *')
    fireEvent.change(input, { target: { value: 'New reminder' } })
    await userEvent.click(screen.getByRole('button', { name: 'Agregar recordatorio' }))
    await waitFor(() => expect(requests[0]?.body).toEqual({ text: 'New reminder' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar recordatorio: Existing' }))
    await userEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(requests).toHaveLength(1)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar recordatorio: Existing' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar recordatorio: Existing' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar recordatorio' }))
    await waitFor(() => expect(requests[1]).toMatchObject({ path: '/api/admin/reminders/r', method: 'DELETE' }))
    expect(await screen.findByText('Recordatorio cancelado.')).toBeTruthy()
  })
  it('renders empty reminder and prediction states', async () => {
    mount('/recordatorios'); expect(await screen.findByText('Todavía no hay recordatorios', { exact: false })).toBeTruthy()
    cleanup(); mount('/predictions'); expect(await screen.findByText('La próxima partida elegible abrirá una prediction.')).toBeTruthy()
  })
  it('operates only managed predictions and exposes explicit uncertain-creation linking', async () => {
    state.predictions.g = { gameId: 'g', status: 'ACTIVE', twitchId: 't', outcomes: [{ id: 'yes', title: 'Sí' }, { id: 'no', title: 'No' }], createdAt: 1 }
    state.predictions.u = { gameId: 'u', status: 'creation_unknown', createdAt: 1, reason: 'Revisar Twitch' }
    state.predictions.final = { gameId: 'final', status: 'CANCELED', twitchId: 'c', createdAt: 1 }
    mount('/predictions'); await screen.findByRole('button', { name: 'Bloquear (partida g)' })
    // Closed predictions live in the collapsed history and never offer controls.
    expect(screen.queryByRole('button', { name: 'Cancelar y reembolsar (partida final)' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ver 1 cerrada' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear (partida g)' })); await userEvent.click(screen.getByRole('button', { name: 'Cerrar participación' }))
    await userEvent.click(screen.getByRole('button', { name: 'Resolver: Sí (partida g)' }))
    expect(screen.getByRole('group', { name: 'Resolver: Sí (partida g)' }).textContent).toContain('No se puede deshacer')
    await userEvent.click(screen.getByRole('button', { name: 'Resolver como «Sí»' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar y reembolsar (partida g)' })); await userEvent.click(screen.getByRole('button', { name: 'Cancelar y reembolsar' }))
    fireEvent.change(screen.getByLabelText('ID de la prediction verificada en Twitch *'), { target: { value: 'remote' } })
    await userEvent.click(screen.getByRole('button', { name: 'Vincular' }))
    await waitFor(() => expect(requests).toHaveLength(4))
    expect(requests.map(r => r.body)).toEqual([{ status: 'LOCKED' }, { status: 'RESOLVED', outcome: 'yes' }, { status: 'CANCELED' }, { twitchId: 'remote' }])
  })
  it('hides prediction controls while a resolve or refund is already on its way to Twitch', async () => {
    state.predictions.g = { gameId: 'g', status: 'LOCKED', twitchId: 't', outcomes: [{ id: 'yes', title: 'Sí' }, { id: 'no', title: 'No' }], createdAt: 1, requested: { status: 'RESOLVED', outcome: 'no' } }
    mount('/predictions'); expect(await screen.findByText('Pedido enviado: resolver como «No».', { exact: false })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Resolver: Sí (partida g)' })).toBeNull()
  })
  it('adds/replaces reward-specific event rules and removes them explicitly', async () => {
    state.settings.actions = [{ id: 'old', event: 'twitch.followed.v1', text: 'Thanks', enabled: true }]
    mount('/eventos'); await screen.findByRole('heading', { name: 'Eventos y acciones' })
    fireEvent.change(screen.getByLabelText('Nombre de la regla *'), { target: { value: 'new' } })
    fireEvent.change(screen.getByLabelText('Respuesta *'), { target: { value: 'Hello {user}' } })
    fireEvent.change(screen.getByLabelText('ID de recompensa (opcional)'), { target: { value: 'reward' } })
    await userEvent.click(screen.getByRole('button', { name: 'Agregar respuesta' }))
    await waitFor(() => expect(requests[0]?.body).toMatchObject({ actions: [state.settings.actions[0], { id: 'new', rewardId: 'reward', text: 'Hello {user}', enabled: true }] }))
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar regla old' })); await userEvent.click(screen.getByRole('button', { name: 'Eliminar regla' }))
    await waitFor(() => expect(requests[1]?.body).toMatchObject({ actions: [] }))
  })
  it('saves enabled flags, automatic resolution, queue policy and persistent game timings', async () => {
    mount('/features'); await screen.findByLabelText('Trivia')
    await userEvent.click(screen.getByLabelText('Trivia')); await userEvent.click(screen.getByLabelText('Historias'))
    fireEvent.change(screen.getByLabelText('Colas a seguir'), { target: { value: '420,450' } })
    await userEvent.click(within(screen.getByRole('form', { name: 'Configuración de módulos' })).getByRole('button', { name: 'Guardar configuración' }))
    await waitFor(() => expect(requests[0]?.body).toMatchObject({ trivia: { enabled: true }, stories: { enabled: true }, predictions: { autoResolve: true, title: '¿Gana esta partida?' }, tracking: { queues: [420, 450] } }))
  })
  it('manages the question bank without enabling games and presents per-game win totals', async () => {
    state.questions.q = { id: 'q', text: 'Question?', answers: ['a', 'b'], used: 2 }; state.wins.u = { name: 'Winner', trivia: 2, stories: 3 }; state.stories.r = { id: 'r', family: 'piratas', users: ['u'], winners: ['u'], at: 1 }
    mount('/juegos'); const form = await screen.findByRole('form', { name: 'Nueva pregunta' })
    fireEvent.change(within(form).getByLabelText('Pregunta *'), { target: { value: 'New question?' } })
    fireEvent.change(within(form).getByLabelText('Respuestas válidas *'), { target: { value: 'x; y;;' } })
    await userEvent.click(within(form).getByRole('button', { name: 'Agregar pregunta' }))
    await waitFor(() => expect(requests[0]?.body).toEqual({ text: 'New question?', answers: ['x', 'y'] }))
    expect(screen.getByRole('table').textContent).toContain('Winner235')
    await userEvent.click(screen.getByRole('button', { name: 'Editar pregunta' }))
    const edit = screen.getByRole('form', { name: 'Editar pregunta' })
    await userEvent.click(within(edit).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(requests[1]?.path).toBe('/api/admin/questions/q'))
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar pregunta: Question?' })); await userEvent.click(screen.getByRole('button', { name: 'Eliminar pregunta' }))
    await waitFor(() => expect(requests[2]?.method).toBe('DELETE'))
  })
  it('shows operation errors, durable consumers, audit, event history and uncertain-message review', async () => {
    state.messages.u = { id: 'u', text: 'Uncertain message', status: 'unknown', attempts: 1, createdAt: 1 }; state.errors.push({ at: 1, feature: 'riot', message: 'API unavailable' })
    mount('/operacion'); expect(await screen.findByText('Cambió la configuración', { exact: false })).toBeTruthy()
    expect(screen.getByText('Empezó el directo', { exact: false })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como enviado: Uncertain message' })); await userEvent.click(screen.getByRole('button', { name: 'Reenviar al chat: Uncertain message' }))
    await waitFor(() => expect(requests.map(r => r.body)).toEqual([{ decision: 'sent' }, { decision: 'retry' }]))
  })
  it('announces mutation errors without discarding the form', async () => {
    mount('/recordatorios'); const input = await screen.findByLabelText('Texto del recordatorio *')
    fetcher.mockImplementation(async (_url, init) => init?.method === 'POST' ? Response.json({ message: 'Se perdió la conexión' }, { status: 503 }) : Response.json(user))
    fireEvent.change(input, { target: { value: 'Keep this' } }); await userEvent.click(screen.getByRole('button', { name: 'Agregar recordatorio' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Se perdió la conexión')
    expect(input).toHaveProperty('value', 'Keep this')
  })
})
it('handles empty success and malformed error responses without publishing server internals', async () => {
  fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }))
  expect(await api('auth/logout', { method: 'POST', csrf: 'csrf' })).toBeUndefined()
  fetcher.mockResolvedValueOnce(new Response('not JSON', { status: 500 }))
  await expect(api('anything')).rejects.toBeInstanceOf(ApiError)
})
describe('redesigned shell and live summary', () => {
  it('summarises the night: live prediction, record with remakes, queue and recent errors', async () => {
    const now = Date.now()
    state.live = true; state.tracking = 'active'; state.activeGame = 'g3'
    state.games = {
      g1: { id: 'g1', startedAt: 1, observedAt: now - 3_000_000, endedAt: now - 2_000_000, queue: 420, historic: false, result: 'win' },
      g2: { id: 'g2', startedAt: 1, observedAt: now - 2_000_000, endedAt: now - 1_000_000, queue: 420, historic: false, result: 'remake' },
      g4: { id: 'g4', startedAt: 1, observedAt: now - 1_500_000, endedAt: now - 1_200_000, queue: 440, historic: false, result: 'loss' },
      g3: { id: 'g3', startedAt: now - 600_000, observedAt: now - 600_000, queue: 420, historic: false }
    }
    state.predictions = {
      old: { gameId: 'old', status: 'ACTIVE', twitchId: 'o', outcomes: [{ id: 'y', title: 'Sí' }, { id: 'n', title: 'No' }], createdAt: now - 900_000 },
      g3: { gameId: 'g3', status: 'ACTIVE', twitchId: 't', outcomes: [{ id: 'y', title: 'Sí' }, { id: 'n', title: 'No' }], createdAt: now - 500_000 }
    }
    state.reminders = {
      a: { id: 'a', text: 'Segundo', author: 'Mod', status: 'queued', createdAt: now - 1000, attempts: 0 },
      b: { id: 'b', text: 'Primero', author: 'Mod', status: 'waiting_next_game', createdAt: now - 5000, attempts: 0 },
      c: { id: 'c', text: 'Listo', author: 'Mod', status: 'sent', createdAt: now - 9000, attempts: 1 }
    }
    state.errors = [{ at: now - 60_000, feature: 'riot', message: 'Spectator-V5 respondió 503' }]
    mount(); expect(await screen.findByRole('heading', { name: 'Falló Riot' })).toBeTruthy()
    expect(screen.getByText('1–1', { exact: false })).toBeTruthy(); expect(screen.getByText('1 remake')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resolver: Sí (partida g3)' })).toBeTruthy()
    const queue = screen.getByRole('heading', { name: 'Al final de la partida' }).closest('[data-slot="card"]') as HTMLElement
    expect(within(queue).getAllByRole('listitem').map(li => li.textContent)).toEqual(['PrimeroMod', 'SegundoMod'])
    cleanup(); mount('/recordatorios'); await screen.findByText('Primero')
    const texts = screen.getAllByText(/^(Primero|Segundo|Listo)$/).map(e => e.textContent)
    expect(texts).toEqual(['Segundo', 'Primero', 'Listo'])
  })
  it('cancels an inline confirmation with Escape and returns focus to the trigger', async () => {
    state.reminders.r = { id: 'r', text: 'Existing', author: 'Mod', status: 'queued', createdAt: 1, attempts: 0 }
    mount('/recordatorios'); await userEvent.click(await screen.findByRole('button', { name: 'Cancelar recordatorio: Existing' }))
    expect(screen.getByRole('button', { name: 'Volver' })).toBe(document.activeElement)
    await userEvent.keyboard('{Escape}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar recordatorio: Existing' }))
    expect(requests).toHaveLength(0)
  })
  it('hides the shell announcement after a few seconds', async () => {
    state.reminders.r = { id: 'r', text: 'Existing', author: 'Mod', status: 'queued', createdAt: 1, attempts: 0 }
    mount('/recordatorios'); await userEvent.click(await screen.findByRole('button', { name: 'Cancelar recordatorio: Existing' }))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await userEvent.click(screen.getByRole('button', { name: 'Cancelar recordatorio' }))
      expect(await screen.findByText('Recordatorio cancelado.')).toBeTruthy()
      await vi.advanceTimersByTimeAsync(6500)
      await waitFor(() => expect(screen.queryByText('Recordatorio cancelado.')).toBeNull())
    } finally { vi.useRealTimers() }
  })
  it('logs out from the shell and reloads the app', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    mount(); await screen.findByRole('heading', { name: 'Hola, Streamer' })
    await userEvent.click(screen.getAllByRole('button', { name: 'Cerrar sesión' })[0]!)
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    expect(requests[0]).toMatchObject({ path: '/api/auth/logout', method: 'POST' })
  })
  it('toggles the «Más» sheet closed again from the tab bar', async () => {
    mount(); await screen.findByRole('heading', { name: 'Hola, Streamer' })
    const more = screen.getByRole('button', { name: 'Más' })
    await userEvent.click(more); await userEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('false')
  })
  it('explains numeric settings in human units while typing', async () => {
    mount('/features'); const actor = await screen.findByLabelText('Espera para quien lanza una historia (segundos)')
    expect(screen.getByText('8 h. Hasta 24 h; 0 es sin espera.')).toBeTruthy()
    fireEvent.change(actor, { target: { value: '5400' } })
    expect(screen.getByText('1 h 30 min. Hasta 24 h; 0 es sin espera.')).toBeTruthy()
    fireEvent.change(actor, { target: { value: '' } })
    expect(screen.getByText('Hasta 24 h; 0 es sin espera.')).toBeTruthy()
  })
  it('orders stories newest first and lists failed jobs in operation', async () => {
    state.stories = { s1: { id: 's1', family: 'piratas', users: ['u'], winners: [], at: 1 }, s2: { id: 's2', family: 'duo', users: ['u', 'v'], winners: ['u'], at: 2 } }
    mount('/juegos'); await screen.findByText('Historia «duo»', { exact: false })
    expect(screen.getAllByText(/^Historia «/).map(e => e.textContent?.slice(0, 15))).toEqual(['Historia «duo» ', 'Historia «pirat'])
    cleanup()
    fetcher.mockImplementation(async (url) => {
      const path = String(url)
      if (path.endsWith('auth/me')) return Response.json(user)
      if (path.endsWith('admin/state')) return Response.json({ channel: 'longii_', broadcasterId: 'b', state })
      return Response.json({ audit: [], events: [], deliveries: [], connections: [], worker: null, failedJobs: [{ id: 'j', name: 'deliver-message', retry_count: 3, created_on: new Date().toISOString() }] })
    })
    mount('/operacion'); expect(await screen.findByText('deliver-message', { exact: false })).toBeTruthy()
    expect(screen.getByText('3 reintentos', { exact: false })).toBeTruthy(); expect(screen.getByText('El proceso del bot no da señales.')).toBeTruthy()
  })
})
