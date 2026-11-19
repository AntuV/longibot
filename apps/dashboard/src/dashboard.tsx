import { Fragment, useId, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import {
  Empty as EmptyState,
  EmptyDescription,
  EmptyHeader
} from '@/components/ui/empty'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from './api.js'
import type { User, Snapshot, Operations } from './api.js'
import type { Settings } from '../../../packages/features/src/model.js'

export const pages = [
  { path: '/', label: 'Resumen', component: Summary },
  { path: '/recordatorios', label: 'Recordatorios', component: Reminders },
  { path: '/predictions', label: 'Predictions', component: Predictions },
  { path: '/eventos', label: 'Eventos y acciones', component: Events },
  { path: '/features', label: 'Configuración', component: Features },
  { path: '/juegos', label: 'Trivia e historias', component: Games },
  { path: '/operacion', label: 'Operación', component: Operation }
]
export const eventLabels: Record<string, string> = {
  'twitch.redemption.created.v1': 'Canje de recompensa personalizada',
  'twitch.redemption.updated.v1':
    'Canje de recompensa actualizado (completado o rechazado)',
  'twitch.automatic_reward.redeemed.v1': 'Canje de recompensa automática',
  'twitch.bits.used.v1': 'Uso de Bits (incluye Power-ups)',
  'twitch.message.highlighted.v1': 'Mensaje destacado',
  'twitch.subscription.started.v1': 'Nueva suscripción',
  'twitch.subscription.message.v1': 'Resuscripción con mensaje',
  'twitch.subscriptions.gifted.v1': 'Suscripciones regaladas',
  'twitch.followed.v1': 'Nuevo seguidor'
}
const platforms = [
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
]
const regions = ['americas', 'europe', 'asia', 'sea']
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
        <h1 className='text-3xl font-semibold'>LongiBot</h1>
        <p role='status' className='text-muted-foreground'>
          Verificando sesión…
        </p>
      </main>
    )
  }
  if (user.isError) {
    return (
      <main className='login'>
        <Card>
          <CardHeader>
            <span className='eyebrow'>LongiBot · Centro de control</span>
            <CardTitle className='text-3xl'>
              <h1>Tu canal, en orden.</h1>
            </CardTitle>
            <CardDescription>
              Partidas, predictions y recordatorios en un solo lugar.
            </CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            <Button asChild size='lg' className='w-fit'>
              <a href='/api/auth/twitch'>Ingresar con Twitch</a>
            </Button>
            <p role='status' className='text-sm text-muted-foreground'>
              {user.error instanceof ApiError && user.error.status === 401
                ? 'Acceso para el streamer y moderadores actuales.'
                : user.error.message}
            </p>
          </CardContent>
        </Card>
      </main>
    )
  }
  return (
    <div className='shell'>
      <a className='skip' href='#contenido'>
        Ir al contenido
      </a>
      <aside>
        <Brand />
        <p className='eyebrow'>#{user.data.channel}</p>
        <nav aria-label='Administración'>
          {pages.map((p) => (
            <NavLink
              key={p.path}
              to={p.path}
              end={p.path === '/'}
              className={({ isActive }) =>
                cn(
                  buttonVariants({ variant: isActive ? 'secondary' : 'ghost' }),
                  'justify-start'
                )}
            >
              {p.label}
            </NavLink>
          ))}
        </nav>
        <Separator />
        <div className='identity'>
          <p className='font-medium'>{user.data.name}</p>
          <p className='text-sm text-muted-foreground'>
            {user.data.streamer ? 'Streamer' : 'Moderador'}
          </p>
        </div>
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
              <p role='status' className='text-muted-foreground'>
                Cargando canal…
              </p>
            )
          : snapshot.isError
            ? (
                <Alert variant='destructive'>
                  <AlertDescription>{snapshot.error.message}</AlertDescription>
                </Alert>
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
  variant = 'outline',
  children,
  onSuccess
}: {
  path: string
  method?: string
  data?: unknown
  csrf: string
  variant?: 'outline' | 'destructive' | 'default' | 'secondary'
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
    <span className='inline-flex flex-col gap-2'>
      <Button
        type='button'
        variant={variant}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {children}
      </Button>
      {mutation.isError
        ? (
            <span role='alert' className='text-sm text-destructive'>
              {mutation.error.message}
            </span>
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
    <Card className='form'>
      <form
        action={`/api/${path}`}
        method='post'
        aria-labelledby={`${id}-title`}
        onSubmit={submit}
        className='flex flex-col gap-(--card-spacing)'
      >
        <CardHeader>
          <CardTitle>
            <h2 id={`${id}-title`}>{title}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {fields.map((field) => {
              const control = `${id}-${field.name}`
              const help = field.help ? `${control}-help` : undefined
              return (
                <Field key={field.name}>
                  <FieldLabel htmlFor={control}>
                    {field.label}
                    {field.required !== false ? ' *' : ''}
                  </FieldLabel>
                  {field.multiline
                    ? (
                        <Textarea
                          id={control}
                          name={field.name}
                          defaultValue={field.value}
                          maxLength={field.max}
                          required={field.required !== false}
                          aria-describedby={help}
                          rows={4}
                        />
                      )
                    : (
                        <Input
                          id={control}
                          name={field.name}
                          type={field.type ?? 'text'}
                          defaultValue={field.value}
                          required={field.required !== false}
                          maxLength={
                            field.type === 'number' ? undefined : field.max
                          }
                          max={field.type === 'number' ? field.max : undefined}
                          min={field.min}
                          aria-describedby={help}
                        />
                      )}
                  {help
                    ? (
                        <FieldDescription id={help}>{field.help}</FieldDescription>
                      )
                    : null}
                </Field>
              )
            })}
            {children}
          </FieldGroup>
        </CardContent>
        <CardFooter className='flex-wrap gap-4'>
          <Button type='submit' size='lg' disabled={mutation.isPending}>
            {mutation.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
          <p
            role={mutation.isError ? 'alert' : 'status'}
            className={cn(
              'text-sm',
              mutation.isError ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {mutation.isError
              ? mutation.error.message
              : saved
                ? 'Cambios guardados.'
                : ''}
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
function Choice ({
  id,
  label,
  options,
  defaultValue
}: {
  id: string
  label: string
  options: { value: string, label: string }[]
  defaultValue: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select name={id} defaultValue={defaultValue}>
        <SelectTrigger id={id} className='w-full'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}
function Toggle ({
  name,
  label,
  checked
}: {
  name: string
  label: string
  checked: boolean
}) {
  return (
    <Field orientation='horizontal'>
      <Checkbox id={name} name={name} defaultChecked={checked} />
      <FieldLabel htmlFor={name} className='font-normal'>
        {label}
      </FieldLabel>
    </Field>
  )
}
function Brand () {
  return (
    <a className='brand' href='/'>
      <Avatar className='size-10'>
        <AvatarImage src='/api/branding/avatar' alt='' />
        <AvatarFallback>L</AvatarFallback>
      </Avatar>
      <span>LongiBot</span>
    </a>
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
    <header className='flex flex-col gap-2'>
      <p className='eyebrow'>Centro de control</p>
      <h1 className='text-3xl font-semibold tracking-tight'>{title}</h1>
      <p className='max-w-3xl text-muted-foreground'>{description}</p>
    </header>
  )
}
function Section ({
  title,
  children
}: {
  title: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>{children}</CardContent>
    </Card>
  )
}
function List ({ children }: { children: ReactNode[] }) {
  return (
    <div className='flex flex-col gap-4'>
      {children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 ? <Separator /> : null}
          {child}
        </Fragment>
      ))}
    </div>
  )
}
function Empty ({ children }: { children: ReactNode }) {
  return (
    <EmptyState>
      <EmptyHeader>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </EmptyState>
  )
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
        <Card>
          <CardHeader>
            <CardDescription>Canal</CardDescription>
            <CardTitle className='text-2xl'>
              <h2>{s.live ? 'En directo' : 'Sin directo'}</h2>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Partida</CardDescription>
            <CardTitle className='text-2xl'>
              <h2>
                {s.tracking === 'active'
                  ? 'En juego'
                  : s.tracking === 'unknown'
                    ? 'Por confirmar'
                    : 'Sin partida'}
              </h2>
            </CardTitle>
            <CardDescription>
              {active?.id ?? 'Esperando señal de Riot'}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Recordatorios pendientes</CardDescription>
            <CardTitle className='text-2xl'>
              <h2>
                {
                  Object.values(s.reminders).filter(
                    (r) => !['sent', 'canceled'].includes(r.status)
                  ).length
                }
              </h2>
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
      <Section title='Conexiones de Twitch'>
        <p className='text-muted-foreground'>
          El bot y el broadcaster se autorizan por separado. El consentimiento
          se guarda protegido en el servidor.
        </p>
        {user.streamer
          ? (
              <div className='flex flex-wrap gap-3'>
                <Button asChild variant='outline' size='lg'>
                  <a href='/api/auth/twitch?purpose=broadcaster'>
                    Conectar broadcaster
                  </a>
                </Button>
                <Button asChild variant='outline' size='lg'>
                  <a href='/api/auth/twitch?purpose=bot'>Conectar bot</a>
                </Button>
              </div>
            )
          : (
              <p>El streamer debe conectar ambas cuentas.</p>
            )}
      </Section>
      <Section title='Últimas partidas'>
        {Object.values(s.games)
          .reverse()
          .slice(0, 20)
          .map((g) => (
            <p key={g.id}>
              {g.id} · cola {g.queue} · {g.result ?? 'resultado pendiente'}
              {g.historic ? ' · recuperada' : ''}
            </p>
          ))}
      </Section>
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
      <Section title='Cola de entrega'>
        {Object.values(s.reminders).length
          ? (
              <List>
                {Object.values(s.reminders).map((r) => (
                  <article className='row' key={r.id}>
                    <div className='min-w-0'>
                      <strong>{r.text}</strong>
                      <p>
                        {r.author} · {date(r.createdAt)}
                      </p>
                      <p className='text-sm text-muted-foreground'>
                        {r.status} · {r.gameId ?? 'esperando asignación'} ·
                        intentos: {r.attempts}
                      </p>
                      <p className='text-sm text-muted-foreground'>ID: {r.id}</p>
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
                            variant='destructive'
                            csrf={user.csrf}
                          >
                            Cancelar recordatorio
                          </Action>
                        )
                      : null}
                  </article>
                ))}
              </List>
            )
          : (
              <Empty>No hay recordatorios todavía.</Empty>
            )}
      </Section>
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
      <Section title='Historial y controles'>
        {Object.values(s.predictions).length
          ? (
              <List>
                {Object.values(s.predictions)
                  .reverse()
                  .map((p) => (
                    <article key={p.gameId} className='flex flex-col gap-3'>
                      <h3 className='font-medium'>{p.gameId}</h3>
                      <p className='text-muted-foreground'>
                        {p.status} · {p.twitchId ?? 'sin ID de Twitch'}
                      </p>
                      {p.reason ? <p>{p.reason}</p> : null}
                      {p.twitchId && !['RESOLVED', 'CANCELED'].includes(p.status)
                        ? (
                            <div className='flex flex-wrap gap-3'>
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
                                variant='destructive'
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
                  ))}
              </List>
            )
          : (
              <Empty>La próxima partida elegible abrirá una prediction.</Empty>
            )}
      </Section>
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
        <Choice
          id='event'
          label='Evento'
          defaultValue='twitch.redemption.created.v1'
          options={Object.entries(eventLabels).map(([value, label]) => ({
            value,
            label
          }))}
        />
      </Form>
      <Section title='Reglas configuradas'>
        {s.settings.actions.length
          ? (
              <List>
                {s.settings.actions.map((rule) => (
                  <div className='row' key={rule.id}>
                    <div className='min-w-0'>
                      <strong>{rule.id}</strong>
                      <p className='text-muted-foreground'>
                        {eventLabels[rule.event] ?? rule.event} · {rule.text}
                      </p>
                    </div>
                    <Action
                      path='admin/settings'
                      method='PUT'
                      variant='destructive'
                      data={{
                        ...s.settings,
                        actions: s.settings.actions.filter(
                          (r) => r.id !== rule.id
                        )
                      }}
                      csrf={user.csrf}
                    >
                      Eliminar regla
                    </Action>
                  </div>
                ))}
              </List>
            )
          : (
              <Empty>
                No se ejecutan respuestas automáticas hasta agregar una regla.
              </Empty>
            )}
      </Section>
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
        title='Configuración'
        description='La configuración se valida y audita en el servidor. Deshabilitar un juego cancela sus rondas y mensajes pendientes.'
      />
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
        <Choice
          id='platform'
          label='Plataforma'
          defaultValue={s.account?.platform ?? 'la2'}
          options={platforms.map((p) => ({ value: p, label: p }))}
        />
        <Choice
          id='region'
          label='Routing regional'
          defaultValue={s.account?.region ?? 'americas'}
          options={regions.map((r) => ({ value: r, label: r }))}
        />
      </Form>
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
        <FieldSet>
          <FieldLegend>Activación</FieldLegend>
          <FieldGroup data-slot='checkbox-group'>
            {(
              [
                ['trivia', 'Trivia', settings.trivia.enabled],
                ['stories', 'Historias', settings.stories.enabled],
                ['predictions', 'Predictions', settings.predictions.enabled],
                ['tracking', 'Seguimiento Riot', settings.tracking.enabled],
                [
                  'live',
                  'Seguir solo durante directo',
                  settings.tracking.onlyLive
                ]
              ] as const
            ).map(([name, label, enabled]) => (
              <Toggle key={name} name={name} label={label} checked={enabled} />
            ))}
          </FieldGroup>
        </FieldSet>
        <Separator />
        <FieldSet>
          <FieldLegend>Predictions</FieldLegend>
          <FieldGroup>
            <Toggle
              name='auto'
              label='Resolver automáticamente; cancelar remakes'
              checked={settings.predictions.autoResolve}
            />
            {(
              [
                ['title', 'Pregunta', settings.predictions.title, 45],
                ['yes', 'Opción de victoria', settings.predictions.yes, 25],
                ['no', 'Opción de derrota', settings.predictions.no, 25]
              ] as const
            ).map(([name, label, value, max]) => (
              <Field key={name}>
                <FieldLabel htmlFor={name}>{label}</FieldLabel>
                <Input
                  id={name}
                  name={name}
                  defaultValue={value}
                  maxLength={max}
                  required
                />
              </Field>
            ))}
            <Numeric
              name='age'
              label='Antigüedad máxima al crear (segundos)'
              value={settings.predictions.maxAgeSeconds}
              min={1}
              max={300}
            />
          </FieldGroup>
        </FieldSet>
        <Separator />
        <FieldSet>
          <FieldLegend>Seguimiento y juegos</FieldLegend>
          <FieldGroup>
            <Numeric
              name='poll'
              label='Intervalo Riot (segundos)'
              value={settings.tracking.pollSeconds}
              min={30}
              max={60}
            />
            <Field>
              <FieldLabel htmlFor='queues'>
                Colas habilitadas (vacío: todas las detectables)
              </FieldLabel>
              <Input
                id='queues'
                name='queues'
                defaultValue={settings.tracking.queues.join(',')}
                pattern='[0-9, ]*'
              />
            </Field>
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
          </FieldGroup>
        </FieldSet>
        <FieldDescription>
          Las historias no aplican timeouts reales. Las victorias empiezan en
          cero.
        </FieldDescription>
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
    <Field>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input
        id={name}
        name={name}
        type='number'
        defaultValue={value}
        min={min}
        max={max}
        required
      />
    </Field>
  )
}
function Games () {
  const {
    user,
    snapshot: { state: s }
  } = useDashboard()
  const questions = Object.values(s.questions)
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
      <Section title='Banco de preguntas'>
        {questions.length
          ? (
              <List>
                {questions.map((q) => (
                  <Collapsible key={q.id} className='flex flex-col gap-3'>
                    <div className='row'>
                      <div className='min-w-0'>
                        <strong>{q.text}</strong>
                        <p className='text-muted-foreground'>
                          {q.answers.join(' · ')} · usada {q.used} veces
                        </p>
                      </div>
                      <div className='flex flex-wrap gap-3'>
                        <CollapsibleTrigger asChild>
                          <Button variant='outline'>Editar pregunta</Button>
                        </CollapsibleTrigger>
                        <Action
                          path={`admin/questions/${q.id}`}
                          method='DELETE'
                          variant='destructive'
                          csrf={user.csrf}
                        >
                          Eliminar pregunta
                        </Action>
                      </div>
                    </div>
                    <CollapsibleContent>
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
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </List>
            )
          : (
              <Empty>Todavía no hay preguntas en el banco.</Empty>
            )}
      </Section>
      <Section title='Victorias'>
        {Object.entries(s.wins).length
          ? (
              <Table>
                <TableCaption>Contadores por usuario y juego</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Trivia</TableHead>
                    <TableHead>Historias</TableHead>
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(s.wins).map(([id, w]) => (
                    <TableRow key={id}>
                      <TableHead scope='row'>{w.name}</TableHead>
                      <TableCell>{w.trivia}</TableCell>
                      <TableCell>{w.stories}</TableCell>
                      <TableCell>{w.trivia + w.stories}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          : (
              <Empty>Todavía no hay victorias.</Empty>
            )}
      </Section>
      <Section title='Últimas historias'>
        {Object.values(s.stories)
          .reverse()
          .slice(0, 20)
          .map((story) => (
            <p key={story.id}>
              {story.family} · {date(story.at)} · {story.winners.length}{' '}
              ganadores
            </p>
          ))}
      </Section>
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
  const uncertain = Object.values(s.messages).filter(
    (m) => m.status === 'unknown'
  )
  return (
    <>
      <Heading
        title='Operación y auditoría'
        description='Estado de conexiones, entregas y acciones administrativas. Los secretos permanecen en el servidor.'
      />
      <Section title='Worker y autorizaciones'>
        {ops.isPending
          ? (
              <p role='status' className='text-muted-foreground'>
                Cargando operación…
              </p>
            )
          : ops.isError
            ? (
                <Alert variant='destructive'>
                  <AlertDescription>{ops.error.message}</AlertDescription>
                </Alert>
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
                  <Separator />
                  <h3 className='font-medium'>Entregas pendientes</h3>
                  {ops.data.deliveries
                    .filter((d) => !d.completed_at)
                    .map((d) => (
                      <p key={`${d.event_id}:${d.consumer}`}>
                        {d.consumer} · {d.event_id} · intentos {d.attempts ?? 0}
                        {d.last_error ? ` · ${d.last_error}` : ''}
                      </p>
                    ))}
                  <Separator />
                  <h3 className='font-medium'>Jobs fallidos</h3>
                  {ops.data.failedJobs?.map((job) => (
                    <p key={job.id}>
                      {job.name} · {job.created_on} · intentos {job.retry_count}
                    </p>
                  ))}
                  <Separator />
                  <h3 className='font-medium'>Auditoría reciente</h3>
                  {ops.data.audit.map((a, i) => (
                    <p key={i}>
                      {a.at} · {a.user_id} · {a.action}
                    </p>
                  ))}
                  <Separator />
                  <h3 className='font-medium'>Eventos recibidos</h3>
                  {ops.data.events.map((e) => (
                    <p key={e.data.id}>
                      {e.data.type} · {e.received_at}
                    </p>
                  ))}
                </>
              )}
      </Section>
      <Section title='Entregas inciertas'>
        {uncertain.length
          ? (
              <List>
                {uncertain.map((m) => (
                  <article className='row' key={m.id}>
                    <p className='min-w-0'>{m.text}</p>
                    <div className='flex flex-wrap gap-3'>
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
              </List>
            )
          : (
              <Empty>No hay entregas pendientes de revisión.</Empty>
            )}
      </Section>
      <Section title='Errores recientes'>
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
      </Section>
    </>
  )
}
