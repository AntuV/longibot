import { useId, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './api.js'
import type { User, Snapshot, Operations } from './api.js'
import type { Settings } from '../../../packages/features/src/model.js'

export const pages = [
  { path: '/', label: 'Resumen', component: Summary },
  { path: '/recordatorios', label: 'Recordatorios', component: Reminders },
  { path: '/predictions', label: 'Predictions', component: Predictions },
  { path: '/eventos', label: 'Eventos y acciones', component: Events },
  { path: '/features', label: 'Features', component: Features },
  { path: '/juegos', label: 'Trivia e historias', component: Games },
  { path: '/operacion', label: 'Operación', component: Operation }
]
interface Context {
  user: User
  snapshot: Snapshot
}
const useDashboard = () => useOutletContext<Context>()
const date = (time: number) =>
  new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(time)
export function Dashboard () {
  const client = useQueryClient()
  const user = useQuery({
    queryKey: ['user'],
    queryFn: ({ signal }) => api<User>('auth/me', { signal }),
    retry: false,
    refetchInterval: 30_000
  })
  const snapshot = useQuery({
    queryKey: ['state'],
    queryFn: ({ signal }) => api<Snapshot>('admin/state', { signal }),
    enabled: Boolean(user.data),
    refetchInterval: 5000,
    retry: false
  })
  if (user.isPending) {
    return (
      <main className='login'>
        <h1>LongiBot</h1>
        <p role='status'>Verificando sesión…</p>
      </main>
    )
  }
  if (user.isError) {
    return (
      <main className='login'>
        <span className='eyebrow'>LongiBot · Centro de control</span>
        <h1>Tu canal, en orden.</h1>
        <p>Partidas, predictions y recordatorios en un solo lugar.</p>
        <a className='button primary' href='/api/auth/twitch'>
          Ingresar con Twitch
        </a>
        <p role='status'>
          {user.error instanceof ApiError && user.error.status === 401
            ? 'Acceso para el streamer y moderadores actuales.'
            : user.error.message}
        </p>
      </main>
    )
  }
  return (
    <div className='shell'>
      <a className='skip' href='#contenido'>
        Ir al contenido
      </a>
      <aside>
        <a className='brand' href='/'>
          L<span>LongiBot</span>
        </a>
        <p className='eyebrow'>#{user.data.channel}</p>
        <nav aria-label='Administración'>
          {pages.map((p) => (
            <NavLink key={p.path} to={p.path} end={p.path === '/'}>
              {p.label}
            </NavLink>
          ))}
        </nav>
        <p className='identity'>
          {user.data.name}
          <small>{user.data.streamer ? 'Streamer' : 'Moderador'}</small>
        </p>
        <Action
          path='auth/logout'
          method='POST'
          csrf={user.data.csrf}
          onSuccess={() => {
            client.clear()
            window.location.assign('/')
          }}
        >
          Cerrar sesión
        </Action>
      </aside>
      <main id='contenido' tabIndex={-1}>
        {snapshot.isPending
          ? (
              <p role='status'>Cargando canal…</p>
            )
          : snapshot.isError
            ? (
                <p role='alert'>{snapshot.error.message}</p>
              )
            : (
                <Outlet
                  context={
              { user: user.data, snapshot: snapshot.data } satisfies Context
                  }
                />
              )}
      </main>
    </div>
  )
}
function Action ({
  path,
  method = 'POST',
  data,
  csrf,
  children,
  onSuccess
}: {
  path: string
  method?: string
  data?: unknown
  csrf: string
  children: ReactNode
  onSuccess?: () => void
}) {
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => api(path, { method, data, csrf }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['state'] })
      onSuccess?.()
    }
  })
  return (
    <span className='action'>
      <button
        type='button'
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {children}
      </button>
      {mutation.isError
        ? (
            <span role='alert'>{mutation.error.message}</span>
          )
        : null}
    </span>
  )
}
function Form ({
  title,
  path,
  method = 'POST',
  csrf,
  fields,
  transform = (d) => d,
  children
}: {
  title: string
  path: string
  method?: string
  csrf: string
  fields: {
    name: string
    label: string
    value?: string | number | undefined
    type?: string
    max?: number
    min?: number
    required?: boolean
    multiline?: boolean
    help?: string
  }[]
  transform?: (d: Record<string, string>) => unknown
  children?: ReactNode
}) {
  const id = useId()
  const client = useQueryClient()
  const [saved, setSaved] = useState(false)
  const mutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      api(path, { method, csrf, data: transform(data) }),
    onSuccess: async () => {
      setSaved(true)
      await client.invalidateQueries({ queryKey: ['state'] })
    }
  })
  function submit (e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaved(false)
    mutation.mutate(
      Object.fromEntries(new FormData(e.currentTarget)) as Record<
        string,
        string
      >
    )
  }
  return (
    <form
      action={`/api/${path}`}
      method='post'
      aria-labelledby={`${id}-title`}
      onSubmit={submit}
      className='card form'
    >
      <h2 id={`${id}-title`}>{title}</h2>
      {fields.map((field) => (
        <div className='field' key={field.name}>
          <label htmlFor={`${id}-${field.name}`}>
            {field.label}
            {field.required !== false ? ' *' : ''}
          </label>
          {field.multiline
            ? (
                <textarea
                  id={`${id}-${field.name}`}
                  name={field.name}
                  defaultValue={field.value}
                  maxLength={field.max}
                  required={field.required !== false}
                  aria-describedby={
                    field.help ? `${id}-${field.name}-help` : undefined
                  }
                  rows={4}
                />
              )
            : (
                <input
                  id={`${id}-${field.name}`}
                  name={field.name}
                  type={field.type ?? 'text'}
                  defaultValue={field.value}
                  required={field.required !== false}
                  maxLength={field.type === 'number' ? undefined : field.max}
                  max={field.type === 'number' ? field.max : undefined}
                  min={field.min}
                  aria-describedby={
                    field.help ? `${id}-${field.name}-help` : undefined
                  }
                />
              )}
          {field.help
            ? (
                <small id={`${id}-${field.name}-help`}>{field.help}</small>
              )
            : null}
        </div>
      ))}
      {children}
      <button className='primary' type='submit' disabled={mutation.isPending}>
        {mutation.isPending ? 'Guardando…' : 'Guardar'}
      </button>
      <p role={mutation.isError ? 'alert' : 'status'}>
        {mutation.isError
          ? mutation.error.message
          : saved
            ? 'Cambios guardados.'
            : ''}
      </p>
    </form>
  )
}
function Heading ({
  title,
  description
}: {
  title: string
  description: string
}) {
  return (
    <header>
      <p className='eyebrow'>Centro de control</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}
function Empty ({ children }: { children: ReactNode }) {
  return <p className='empty'>{children}</p>
}
function Summary () {
  const {
    user,
    snapshot: { state: s, channel }
  } = useDashboard()
  const active = s.activeGame ? s.games[s.activeGame] : undefined
  return (
    <>
      <Heading
        title={`Hola, ${user.name}`}
        description={`Administración de #${channel}. Las actualizaciones se reciben automáticamente.`}
      />
      <div className='stats'>
        <article className='card'>
          <small>Canal</small>
          <h2>{s.live ? 'En directo' : 'Sin directo'}</h2>
        </article>
        <article className='card'>
          <small>Partida</small>
          <h2>
            {s.tracking === 'active'
              ? 'En juego'
              : s.tracking === 'unknown'
                ? 'Por confirmar'
                : 'Sin partida'}
          </h2>
          <p>{active?.id ?? 'Esperando señal de Riot'}</p>
        </article>
        <article className='card'>
          <small>Recordatorios pendientes</small>
          <h2>
            {
              Object.values(s.reminders).filter(
                (r) => !['sent', 'canceled'].includes(r.status)
              ).length
            }
          </h2>
        </article>
      </div>
      <section className='card'>
        <h2>Conexiones de Twitch</h2>
        <p>
          El bot y el broadcaster se autorizan por separado. El consentimiento
          se guarda protegido en el servidor.
        </p>
        {user.streamer
          ? (
              <div className='buttons'>
                <a className='button' href='/api/auth/twitch?purpose=broadcaster'>
                  Conectar broadcaster
                </a>
                <a className='button' href='/api/auth/twitch?purpose=bot'>
                  Conectar bot
                </a>
              </div>
            )
          : (
              <p>El streamer debe conectar ambas cuentas.</p>
            )}
      </section>
      <Form
        title='Cuenta de League of Legends'
        path='admin/account'
        method='PUT'
        csrf={user.csrf}
        fields={[
          {
            name: 'gameName',
            label: 'Riot ID (nombre)',
            value: s.account?.gameName
          },
          { name: 'tagLine', label: 'Tag', value: s.account?.tagLine }
        ]}
        transform={(d) => ({ ...d, platform: d.platform, region: d.region })}
      >
        <label htmlFor='platform'>Plataforma</label>
        <select
          id='platform'
          name='platform'
          defaultValue={s.account?.platform ?? 'la2'}
        >
          {[
            'la1',
            'la2',
            'na1',
            'br1',
            'euw1',
            'eun1',
            'kr',
            'jp1',
            'oc1',
            'tr1',
            'ru',
            'ph2',
            'sg2',
            'th2',
            'tw2',
            'vn2'
          ].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <label htmlFor='region'>Routing regional</label>
        <select
          id='region'
          name='region'
          defaultValue={s.account?.region ?? 'americas'}
        >
          {['americas', 'europe', 'asia', 'sea'].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </Form>
      <section className='card'>
        <h2>Últimas partidas</h2>
        {Object.values(s.games)
          .reverse()
          .slice(0, 20)
          .map((g) => (
            <p key={g.id}>
              {g.id} · cola {g.queue} · {g.result ?? 'resultado pendiente'}
              {g.historic ? ' · recuperada' : ''}
            </p>
          ))}
      </section>
    </>
  )
}
function Reminders () {
  const {
    user,
    snapshot: { state: s }
  } = useDashboard()
  return (
    <>
      <Heading
        title='Recordatorios'
        description='Al terminar la partida actual, o la siguiente si no hay una activa.'
      />
      <Form
        title='Nuevo recordatorio'
        path='admin/reminders'
        csrf={user.csrf}
        fields={[
          {
            name: 'text',
            label: 'Texto del recordatorio',
            multiline: true,
            max: 350,
            help: 'Hasta 350 caracteres. También podés usar !recordar en el chat.'
          }
        ]}
      />
      <section className='card'>
        <h2>Cola de entrega</h2>
        {Object.values(s.reminders).length
          ? (
              Object.values(s.reminders).map((r) => (
                <article className='row' key={r.id}>
                  <div>
                    <strong>{r.text}</strong>
                    <p>
                      {r.author} · {date(r.createdAt)}
                    </p>
                    <small>
                      {r.status} · {r.gameId ?? 'esperando asignación'} · intentos:{' '}
                      {r.attempts}
                    </small>
                    <small>ID: {r.id}</small>
                  </div>
                  {[
                    'waiting_next_game',
                    'awaiting_game_assignment',
                    'queued'
                  ].includes(r.status)
                    ? (
                        <Action
                          path={`admin/reminders/${encodeURIComponent(r.id)}`}
                          method='DELETE'
                          csrf={user.csrf}
                        >
                          Cancelar recordatorio
                        </Action>
                      )
                    : null}
                </article>
              ))
            )
          : (
              <Empty>No hay recordatorios todavía.</Empty>
            )}
      </section>
    </>
  )
}
function Predictions () {
  const {
    user,
    snapshot: { state: s }
  } = useDashboard()
  return (
    <>
      <Heading
        title='Predictions'
        description='Participación durante 300 segundos. Victoria o derrota confirmada resuelve; remake confirmado cancela y devuelve los puntos en Twitch.'
      />
      <section className='card'>
        <h2>Historial y controles</h2>
        {Object.values(s.predictions).length
          ? (
              Object.values(s.predictions)
                .reverse()
                .map((p) => (
                  <article key={p.gameId} className='prediction'>
                    <h3>{p.gameId}</h3>
                    <p>
                      {p.status} · {p.twitchId ?? 'sin ID de Twitch'}
                    </p>
                    {p.reason ? <p>{p.reason}</p> : null}
                    {p.twitchId && !['RESOLVED', 'CANCELED'].includes(p.status)
                      ? (
                          <div className='buttons'>
                            <Action
                              path={`admin/predictions/${p.gameId}`}
                              data={{ status: 'LOCKED' }}
                              csrf={user.csrf}
                            >
                              Bloquear
                            </Action>
                            <Action
                              path={`admin/predictions/${p.gameId}`}
                              data={{ status: 'CANCELED' }}
                              csrf={user.csrf}
                            >
                              Cancelar prediction y reembolsar
                            </Action>
                            {p.outcomes?.map((o) => (
                              <Action
                                key={o.id}
                                path={`admin/predictions/${p.gameId}`}
                                data={{ status: 'RESOLVED', outcome: o.id }}
                                csrf={user.csrf}
                              >
                                Resolver: {o.title}
                              </Action>
                            ))}
                          </div>
                        )
                      : null}
                    {p.status === 'creation_unknown'
                      ? (
                          <Form
                            title='Vincular creación incierta'
                            path={`admin/predictions/${p.gameId}/link`}
                            csrf={user.csrf}
                            fields={[
                              {
                                name: 'twitchId',
                                label: 'ID de la prediction verificada en Twitch',
                                max: 100
                              }
                            ]}
                          />
                        )
                      : null}
                  </article>
                ))
            )
          : (
              <Empty>La próxima partida elegible abrirá una prediction.</Empty>
            )}
      </section>
    </>
  )
}
function Events () {
  const {
    user,
    snapshot: { state: s }
  } = useDashboard()
  return (
    <>
      <Heading
        title='Eventos y acciones'
        description='Reglas de respuesta para canjes, Bits, Power-ups, subs, regalos y follows. Usá {user} para mencionar al usuario.'
      />
      <Form
        title='Agregar respuesta de chat'
        path='admin/settings'
        method='PUT'
        csrf={user.csrf}
        fields={[
          { name: 'id', label: 'Identificador único de regla', max: 100 },
          { name: 'text', label: 'Respuesta', max: 400 },
          {
            name: 'rewardId',
            label: 'ID de recompensa (opcional)',
            required: false,
            max: 100
          }
        ]}
        transform={(d) => ({
          ...s.settings,
          actions: [
            ...s.settings.actions.filter((r) => r.id !== d.id),
            {
              id: d.id!,
              event: d.event!,
              text: d.text!,
              enabled: true,
              ...(d.rewardId ? { rewardId: d.rewardId } : {})
            }
          ]
        })}
      >
        <label htmlFor='event-type'>Evento</label>
        <select id='event-type' name='event'>
          {[
            'twitch.redemption.created.v1',
            'twitch.redemption.updated.v1',
            'twitch.automatic_reward.redeemed.v1',
            'twitch.bits.used.v1',
            'twitch.message.highlighted.v1',
            'twitch.subscription.started.v1',
            'twitch.subscription.message.v1',
            'twitch.subscriptions.gifted.v1',
            'twitch.followed.v1'
          ].map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
      </Form>
      <section className='card'>
        <h2>Reglas configuradas</h2>
        {s.settings.actions.length
          ? (
              s.settings.actions.map((rule) => (
                <div className='row' key={rule.id}>
                  <div>
                    <strong>{rule.id}</strong>
                    <p>
                      {rule.event} · {rule.text}
                    </p>
                  </div>
                  <Action
                    path='admin/settings'
                    method='PUT'
                    data={{
                      ...s.settings,
                      actions: s.settings.actions.filter((r) => r.id !== rule.id)
                    }}
                    csrf={user.csrf}
                  >
                    Eliminar regla
                  </Action>
                </div>
              ))
            )
          : (
              <Empty>
                No se ejecutan respuestas automáticas hasta agregar una regla.
              </Empty>
            )}
      </section>
    </>
  )
}
function Features () {
  const {
    user,
    snapshot: { state: s }
  } = useDashboard()
  const settings = s.settings
  return (
    <>
      <Heading
        title='Features'
        description='La configuración se valida y audita en el servidor. Deshabilitar un juego cancela sus rondas y mensajes pendientes.'
      />
      <Form
        title='Configuración de módulos'
        path='admin/settings'
        method='PUT'
        csrf={user.csrf}
        fields={[]}
        transform={(d) =>
          ({
            ...settings,
            trivia: {
              ...settings.trivia,
              enabled: d.trivia === 'on',
              intervalMinutes: Number(d.interval),
              answerSeconds: Number(d.answer)
            },
            stories: {
              ...settings.stories,
              enabled: d.stories === 'on',
              globalSeconds: Number(d.global),
              actorSeconds: Number(d.actor),
              guestSeconds: Number(d.guest)
            },
            predictions: {
              ...settings.predictions,
              enabled: d.predictions === 'on',
              autoResolve: d.auto === 'on',
              title: d.title ?? '',
              yes: d.yes ?? '',
              no: d.no ?? '',
              maxAgeSeconds: Number(d.age)
            },
            tracking: {
              ...settings.tracking,
              enabled: d.tracking === 'on',
              onlyLive: d.live === 'on',
              pollSeconds: Number(d.poll),
              queues: d.queues?.trim() ? d.queues.split(',').map(Number) : []
            }
          }) satisfies Settings}
      >
        <fieldset>
          <legend>Activación</legend>
          {[
            ['trivia', 'Trivia', settings.trivia.enabled],
            ['stories', 'Historias', settings.stories.enabled],
            ['predictions', 'Predictions', settings.predictions.enabled],
            [
              'auto',
              'Resolver automáticamente; cancelar remakes',
              settings.predictions.autoResolve
            ],
            ['tracking', 'Seguimiento Riot', settings.tracking.enabled],
            ['live', 'Seguir solo durante directo', settings.tracking.onlyLive]
          ].map(([name, label, enabled]) => (
            <div className='check' key={String(name)}>
              <input
                id={String(name)}
                name={String(name)}
                type='checkbox'
                defaultChecked={Boolean(enabled)}
              />
              <label htmlFor={String(name)}>{label}</label>
            </div>
          ))}
        </fieldset>
        <fieldset>
          <legend>Predictions</legend>
          {[
            ['title', 'Pregunta', settings.predictions.title, 45],
            ['yes', 'Opción de victoria', settings.predictions.yes, 25],
            ['no', 'Opción de derrota', settings.predictions.no, 25]
          ].map(([name, label, value, max]) => (
            <div className='field' key={name}>
              <label htmlFor={String(name)}>{label}</label>
              <input
                id={String(name)}
                name={String(name)}
                defaultValue={String(value)}
                maxLength={Number(max)}
                required
              />
            </div>
          ))}
          <Numeric
            name='age'
            label='Antigüedad máxima al crear (segundos)'
            value={settings.predictions.maxAgeSeconds}
            min={1}
            max={300}
          />
        </fieldset>
        <fieldset>
          <legend>Seguimiento y juegos</legend>
          <Numeric
            name='poll'
            label='Intervalo Riot (segundos)'
            value={settings.tracking.pollSeconds}
            min={30}
            max={60}
          />
          <label htmlFor='queues'>
            Colas habilitadas (vacío: todas las detectables)
          </label>
          <input
            id='queues'
            name='queues'
            defaultValue={settings.tracking.queues.join(',')}
            pattern='[0-9, ]*'
          />
          <Numeric
            name='interval'
            label='Intervalo de trivia (minutos)'
            value={settings.trivia.intervalMinutes}
            min={1}
            max={1440}
          />
          <Numeric
            name='answer'
            label='Tiempo para responder (segundos)'
            value={settings.trivia.answerSeconds}
            min={10}
            max={600}
          />
          <Numeric
            name='global'
            label='Cooldown global de historias (segundos)'
            value={settings.stories.globalSeconds}
            min={0}
            max={86400}
          />
          <Numeric
            name='actor'
            label='Cooldown del ejecutor (segundos)'
            value={settings.stories.actorSeconds}
            min={0}
            max={86400}
          />
          <Numeric
            name='guest'
            label='Cooldown del invitado (segundos)'
            value={settings.stories.guestSeconds}
            min={0}
            max={86400}
          />
        </fieldset>
        <p>
          Las historias no aplican timeouts reales. Las victorias empiezan en
          cero.
        </p>
      </Form>
    </>
  )
}
function Numeric ({
  name,
  label,
  value,
  min,
  max
}: {
  name: string
  label: string
  value: number
  min: number
  max: number
}) {
  return (
    <div className='field'>
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type='number'
        defaultValue={value}
        min={min}
        max={max}
        required
      />
    </div>
  )
}
function Games () {
  const {
    user,
    snapshot: { state: s }
  } = useDashboard()
  return (
    <>
      <Heading
        title='Trivia e historias'
        description='Administrar el banco no habilita los juegos. Solo se cuentan victorias, sin moneda ni sanciones.'
      />
      <Form
        title='Guardar pregunta'
        path='admin/questions'
        csrf={user.csrf}
        fields={[
          { name: 'text', label: 'Pregunta', max: 400 },
          {
            name: 'answers',
            label: 'Respuestas alternativas, separadas por punto y coma',
            max: 4000
          }
        ]}
        transform={(d) => ({
          text: d.text!,
          answers: d
            .answers!.split(';')
            .map((a) => a.trim())
            .filter(Boolean)
        })}
      />
      <section className='card'>
        <h2>Banco de preguntas</h2>
        {Object.values(s.questions).map((q) => (
          <div className='row' key={q.id}>
            <div>
              <strong>{q.text}</strong>
              <p>
                {q.answers.join(' · ')} · usada {q.used} veces
              </p>
              <details>
                <summary>Editar pregunta</summary>
                <Form
                  title='Editar pregunta'
                  path={`admin/questions/${q.id}`}
                  method='PUT'
                  csrf={user.csrf}
                  fields={[
                    {
                      name: 'text',
                      label: 'Pregunta',
                      value: q.text,
                      max: 400
                    },
                    {
                      name: 'answers',
                      label: 'Respuestas alternativas',
                      value: q.answers.join(';'),
                      max: 4000
                    }
                  ]}
                  transform={(d) => ({
                    text: d.text!,
                    answers: d
                      .answers!.split(';')
                      .map((a) => a.trim())
                      .filter(Boolean)
                  })}
                />
              </details>
            </div>
            <Action
              path={`admin/questions/${q.id}`}
              method='DELETE'
              csrf={user.csrf}
            >
              Eliminar pregunta
            </Action>
          </div>
        ))}
      </section>
      <section className='card'>
        <h2>Victorias</h2>
        {Object.entries(s.wins).length
          ? (
              <div className='table-wrap'>
                <table>
                  <caption>Contadores por usuario y juego</caption>
                  <thead>
                    <tr>
                      <th>Usuario</th>
                      <th>Trivia</th>
                      <th>Historias</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(s.wins).map(([id, w]) => (
                      <tr key={id}>
                        <th scope='row'>{w.name}</th>
                        <td>{w.trivia}</td>
                        <td>{w.stories}</td>
                        <td>{w.trivia + w.stories}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          : (
              <Empty>Todavía no hay victorias.</Empty>
            )}
      </section>
      <section className='card'>
        <h2>Últimas historias</h2>
        {Object.values(s.stories)
          .reverse()
          .slice(0, 20)
          .map((story) => (
            <p key={story.id}>
              {story.family} · {date(story.at)} · {story.winners.length}{' '}
              ganadores
            </p>
          ))}
      </section>
    </>
  )
}
function Operation () {
  const {
    user,
    snapshot: { state: s }
  } = useDashboard()
  const ops = useQuery({
    queryKey: ['operations'],
    queryFn: ({ signal }) => api<Operations>('admin/operations', { signal }),
    refetchInterval: 10_000
  })
  return (
    <>
      <Heading
        title='Operación y auditoría'
        description='Estado de conexiones, entregas y acciones administrativas. Los secretos permanecen en el servidor.'
      />
      <section className='card'>
        <h2>Worker y autorizaciones</h2>
        {ops.isPending
          ? (
              <p role='status'>Cargando operación…</p>
            )
          : ops.isError
            ? (
                <p role='alert'>{ops.error.message}</p>
              )
            : (
                <>
                  <p>
                    Último pulso:{' '}
                    {ops.data.worker ? date(ops.data.worker.at) : 'sin señal'}
                  </p>
                  {ops.data.connections.map((c) => (
                    <p key={`${c.purpose}:${c.user_id}`}>
                      {c.purpose} · usuario {c.user_id} · {c.updated_at}
                    </p>
                  ))}
                  <h3>Entregas pendientes</h3>
                  {ops.data.deliveries
                    .filter((d) => !d.completed_at)
                    .map((d) => (
                      <p key={`${d.event_id}:${d.consumer}`}>
                        {d.consumer} · {d.event_id} · intentos {d.attempts ?? 0}{d.last_error ? ` · ${d.last_error}` : ''}
                      </p>
                    ))}
                  <h3>Jobs fallidos</h3>{ops.data.failedJobs?.map(job => <p key={job.id}>{job.name} · {job.created_on} · intentos {job.retry_count}</p>)}<h3>Auditoría reciente</h3>
                  {ops.data.audit.map((a, i) => (
                    <p key={i}>
                      {a.at} · {a.user_id} · {a.action}
                    </p>
                  ))}
                  <h3>Eventos recibidos</h3>
                  {ops.data.events.map((e) => (
                    <p key={e.data.id}>
                      {e.data.type} · {e.received_at}
                    </p>
                  ))}
                </>
              )}
      </section>
      <section className='card'>
        <h2>Entregas inciertas</h2>
        {Object.values(s.messages)
          .filter((m) => m.status === 'unknown')
          .map((m) => (
            <article className='row' key={m.id}>
              <p>{m.text}</p>
              <div className='buttons'>
                <Action
                  path={`admin/messages/${encodeURIComponent(m.id)}/review`}
                  data={{ decision: 'sent' }}
                  csrf={user.csrf}
                >
                  Marcar como enviado
                </Action>
                <Action
                  path={`admin/messages/${encodeURIComponent(m.id)}/review`}
                  data={{ decision: 'retry' }}
                  csrf={user.csrf}
                >
                  Reenviar tras verificar
                </Action>
              </div>
            </article>
          ))}
      </section>
      <section className='card'>
        <h2>Errores recientes</h2>
        {s.errors.length
          ? (
              s.errors
                .slice(-30)
                .reverse()
                .map((e, i) => (
                  <p key={i}>
                    {date(e.at)} · {e.feature}: {e.message}
                  </p>
                ))
            )
          : (
              <Empty>Sin errores registrados.</Empty>
            )}
      </section>
    </>
  )
}
