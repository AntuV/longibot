import { Fragment, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
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
import {
  Activity,
  AlarmClock,
  ArrowRight,
  Check,
  LogOut,
  Menu,
  MessageCircleQuestion,
  PanelsTopLeft,
  Settings as SettingsIcon,
  Target,
  TriangleAlert,
  X,
  Zap
} from 'lucide-react'
import { api, ApiError } from './api.js'
import type { User, Snapshot, Operations } from './api.js'
import type { Settings } from '../../../packages/features/src/model.js'
import {
  auditAction,
  connectionName,
  consumerName,
  duration,
  exactTime,
  gameResult,
  openReminder,
  platformName,
  plural,
  predictionStatus,
  predictionTone,
  queueName,
  regionName,
  reminderStatus,
  reminderTone,
  streamEventLabels,
  when
} from './copy.js'

export const pages: {
  path: string
  label: string
  short?: string
  icon: typeof Menu
  component: () => ReactNode
}[] = [
  { path: '/', label: 'Resumen', icon: PanelsTopLeft, component: Summary },
  { path: '/recordatorios', label: 'Recordatorios', short: 'Recordat.', icon: AlarmClock, component: Reminders },
  { path: '/predictions', label: 'Predictions', icon: Target, component: Predictions },
  { path: '/eventos', label: 'Eventos y acciones', icon: Zap, component: Events },
  { path: '/features', label: 'Configuración', icon: SettingsIcon, component: Features },
  { path: '/juegos', label: 'Trivia e historias', icon: MessageCircleQuestion, component: Games },
  { path: '/operacion', label: 'Operación', icon: Activity, component: Operation }
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
        <p role='status' className='text-muted-foreground'>
          Verificando sesión…
        </p>
      </main>
    )
  }
  if (user.isError) {
    return (
      <main className='login'>
        <section className='splash' data-calm='' data-quiet='' aria-labelledby='login-title'>
          <h1 id='login-title' className='text-4xl leading-tight'>
            Tu canal, en orden.
          </h1>
          <p className='text-muted-foreground'>
            LongiBot: partidas, predictions y recordatorios de #longii_ en un
            solo lugar.
          </p>
          <div className='actions flex flex-col gap-3'>
            <Button asChild size='lg' className='w-fit'>
              <a href='/api/auth/twitch'>Ingresar con Twitch</a>
            </Button>
            <p role='status' className='text-sm text-muted-foreground'>
              {user.error instanceof ApiError && user.error.status === 401
                ? 'Acceso para el streamer y moderadores actuales.'
                : user.error.message}
            </p>
          </div>
        </section>
      </main>
    )
  }
  const live = snapshot.data?.state.live
  const logout = (
    <Action
      path='auth/logout'
      method='POST'
      csrf={user.data.csrf}
      onSuccess={() => {
        client.clear()
        window.location.assign('/')
      }}
    >
      <LogOut aria-hidden='true' />
      Cerrar sesión
    </Action>
  )
  const identity = (
    <div className='identity'>
      <div>
        <p className='font-bold'>{user.data.name}</p>
        <p className='text-sm text-muted-foreground'>
          {user.data.streamer ? 'Streamer' : 'Moderador'} · #{user.data.channel}
        </p>
      </div>
      {logout}
    </div>
  )
  const onAir = (
    <span className='onair' data-live={live ? '' : undefined}>
      {live ? 'En vivo' : 'Sin directo'}
    </span>
  )
  return (
    <div className='shell'>
      <a className='skip' href='#contenido'>
        Ir al contenido
      </a>
      <aside className='rail'>
        <Brand />
        {onAir}
        <nav aria-label='Administración'>
          {pages.map((p) => (
            <NavLink key={p.path} to={p.path} end={p.path === '/'} className='navlink'>
              <p.icon aria-hidden='true' />
              {p.label}
            </NavLink>
          ))}
        </nav>
        {identity}
      </aside>
      <header className='topbar'>
        <Brand />
        {onAir}
      </header>
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
      <TabBar identity={identity} />
      <Announcer />
    </div>
  )
}
/** Phone navigation: the live destinations as tabs, everything else behind «Más». */
function TabBar ({ identity }: { identity: ReactNode }) {
  const location = useLocation()
  // The sheet belongs to the page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === location.pathname
  const sheet = useId()
  const extra = pages.slice(3)
  const inExtra = extra.some((p) => p.path === location.pathname)
  return (
    <>
      <nav id={sheet} className='more' aria-label='Más secciones' hidden={!open}>
        {extra.map((p) => (
          <NavLink key={p.path} to={p.path} className='navlink'>
            <p.icon aria-hidden='true' />
            {p.label}
          </NavLink>
        ))}
        {identity}
      </nav>
      <nav className='tabbar' aria-label='Secciones'>
        {pages.slice(0, 3).map((p) => (
          <NavLink key={p.path} to={p.path} end={p.path === '/'}>
            <p.icon aria-hidden='true' />
            {p.short ?? p.label}
          </NavLink>
        ))}
        <button
          type='button'
          aria-expanded={open}
          aria-controls={sheet}
          aria-current={inExtra && !open ? 'page' : undefined}
          onClick={() => setOpenOn(open ? null : location.pathname)}
        >
          <Menu aria-hidden='true' />
          Más
        </button>
      </nav>
    </>
  )
}
const announceEvent = 'longibot:announce'
/** Shows a short confirmation in the shell's live region, so a result survives the row that triggered it. */
export function announce (message: string) {
  window.dispatchEvent(new CustomEvent<string>(announceEvent, { detail: message }))
}
function Announcer () {
  const [message, setMessage] = useState('')
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const show = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail)
      clearTimeout(timer)
      timer = setTimeout(() => setMessage(''), 6000)
    }
    window.addEventListener(announceEvent, show)
    return () => {
      window.removeEventListener(announceEvent, show)
      clearTimeout(timer)
    }
  }, [])
  return (
    <p role='status' aria-live='polite' className='toast'>
      {message}
    </p>
  )
}
function Action ({
  path,
  method = 'POST',
  data,
  csrf,
  variant = 'outline',
  size = 'default',
  label,
  confirm,
  done,
  children,
  onSuccess
}: {
  path: string
  method?: string
  data?: unknown
  csrf: string
  variant?: 'outline' | 'destructive' | 'default' | 'secondary'
  size?: 'default' | 'lg'
  /** Accessible name when the visible text repeats across rows. */
  label?: string
  /** Irreversible actions ask once, inline, before sending. */
  confirm?: { message: ReactNode, action: string }
  /** Announced after success. */
  done?: string
  children: ReactNode
  onSuccess?: () => void
}) {
  const client = useQueryClient()
  const [asking, setAsking] = useState(false)
  const backRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  const mutation = useMutation({
    mutationFn: () => api(path, { method, data, csrf }),
    onSuccess: async () => {
      setAsking(false)
      if (done) announce(done)
      await client.invalidateQueries({ queryKey: ['state'] })
      onSuccess?.()
    }
  })
  useEffect(() => {
    if (asking) backRef.current?.focus()
    else if (returnFocus.current) {
      returnFocus.current = false
      triggerRef.current?.focus()
    }
  }, [asking])
  const cancel = () => {
    returnFocus.current = true
    mutation.reset()
    setAsking(false)
  }
  const escape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cancel()
  }
  const error = mutation.isError
    ? (
        <span role='alert' className='text-sm text-destructive'>
          {mutation.error.message}
        </span>
      )
    : null
  if (confirm && asking) {
    return (
      <div
        role='group'
        aria-label={label ?? (typeof children === 'string' ? children : undefined)}
        className='confirm'
      >
        <p className='text-sm'>{confirm.message}</p>
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            size='lg'
            disabled={mutation.isPending}
            onKeyDown={escape}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Enviando…' : confirm.action}
          </Button>
          <Button
            ref={backRef}
            type='button'
            variant='ghost'
            size='lg'
            disabled={mutation.isPending}
            onKeyDown={escape}
            onClick={cancel}
          >
            Volver
          </Button>
        </div>
        {error}
      </div>
    )
  }
  return (
    <span className='inline-flex flex-col gap-2'>
      <Button
        ref={triggerRef}
        type='button'
        variant={variant}
        size={size}
        aria-label={label}
        disabled={mutation.isPending}
        onClick={() => (confirm ? setAsking(true) : mutation.mutate())}
      >
        {children}
      </Button>
      {error}
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
  submitLabel = 'Guardar',
  done,
  bare = false,
  className,
  children
}: {
  title: string
  path: string
  method?: string
  csrf: string
  submitLabel?: string
  done?: string
  /** Renders inside an existing card instead of wrapping itself in one. */
  bare?: boolean
  className?: string
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
      if (done) announce(done)
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
  const Header = bare ? 'div' : CardHeader
  const Content = bare ? 'div' : CardContent
  const Footer = bare ? 'div' : CardFooter
  const form = (
    <form
      action={`/api/${path}`}
      method='post'
      aria-labelledby={`${id}-title`}
      onSubmit={submit}
      className={cn(
        'flex flex-col',
        bare ? 'gap-3' : 'gap-(--card-spacing)'
      )}
    >
      <Header>
        {bare
          ? (
              <h4 id={`${id}-title`} className='font-bold'>
                {title}
              </h4>
            )
          : (
              <CardTitle>
                <h2 id={`${id}-title`}>{title}</h2>
              </CardTitle>
            )}
      </Header>
      <Content>
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
      </Content>
      <Footer className='flex flex-wrap items-center gap-4'>
        <Button type='submit' size='lg' disabled={mutation.isPending}>
          {mutation.isPending ? 'Guardando…' : submitLabel}
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
      </Footer>
    </form>
  )
  return bare ? form : <Card className={cn('form', className)}>{form}</Card>
}
function Choice ({
  id,
  label,
  help,
  options,
  defaultValue
}: {
  id: string
  label: string
  help?: string
  options: { value: string, label: string }[]
  defaultValue: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select name={id} defaultValue={defaultValue}>
        <SelectTrigger
          id={id}
          className='w-full'
          aria-describedby={help ? `${id}-help` : undefined}
        >
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
      {help ? <FieldDescription id={`${id}-help`}>{help}</FieldDescription> : null}
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
  description,
  compact = false
}: {
  title: string
  description: string
  /** Shrinks to a one-line greeting on phones so the live panels lead. */
  compact?: boolean
}) {
  return (
    <header className={cn('page-head', compact && 'compact')}>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}
function Section ({
  title,
  className,
  aside,
  children
}: {
  title: string
  className?: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className={className}>
      <CardHeader className={aside ? 'row' : undefined}>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {aside}
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
interface Attention {
  key: string
  title: ReactNode
  detail: string
  to: string
  action: string
}
/** What needs a human right now, most urgent first. */
function attention (s: Snapshot['state'], now = Date.now()): Attention[] {
  const items: Attention[] = []
  for (const p of Object.values(s.predictions)) {
    if (p.status === 'creation_unknown' || p.status === 'conflict') {
      items.push({
        key: `p:${p.gameId}`,
        title: (
          <>
            Twitch no confirmó la <em>prediction</em>
          </>
        ),
        detail: `Partida ${p.gameId} · ${when(p.createdAt, now)}. Vinculala con su ID de Twitch.`,
        to: '/predictions',
        action: 'Vincular prediction'
      })
    }
  }
  for (const m of Object.values(s.messages)) {
    if (m.status === 'unknown') {
      items.push({
        key: `m:${m.id}`,
        title: (
          <>
            ¿Llegó al chat? <em>Revisalo</em>
          </>
        ),
        detail: `«${m.text.slice(0, 80)}» quedó sin confirmar.`,
        to: '/operacion',
        action: 'Revisar entrega'
      })
    }
  }
  const recent = s.errors.filter((e) => now - e.at < 30 * 60_000).at(-1)
  if (recent) {
    items.push({
      key: `e:${recent.at}`,
      title: (
        <>
          Falló <em>{consumerName(recent.feature)}</em>
        </>
      ),
      detail: `${recent.message} · ${when(recent.at, now)}.`,
      to: '/operacion',
      action: 'Ver errores'
    })
  }
  return items
}
function Splash ({ items }: { items: Attention[] }) {
  const [first, ...rest] = items
  if (!first) {
    return (
      <section className='splash span' data-calm='' aria-labelledby='splash-title'>
        <span className='tag'>
          <Check aria-hidden='true' className='size-4' />
          Todo en orden
        </span>
        <h2 id='splash-title'>Nada necesita atención</h2>
        <p className='text-muted-foreground'>
          Las predictions, entregas y conexiones andan solas. Si algo se traba,
          aparece acá primero.
        </p>
      </section>
    )
  }
  return (
    <section className='splash span' data-alert='' aria-labelledby='splash-title'>
      <span className='tag'>
        <TriangleAlert aria-hidden='true' className='size-4' />
        Necesita atención
      </span>
      <h2 id='splash-title'>{first.title}</h2>
      <p>{first.detail}</p>
      <div className='actions'>
        <Button asChild size='lg'>
          <NavLink to={first.to}>
            {first.action}
            <ArrowRight aria-hidden='true' />
          </NavLink>
        </Button>
      </div>
      {rest.length
        ? (
            <ul className='more-items'>
              {rest.map((item) => (
                <li key={item.key}>
                  <NavLink to={item.to}>{item.action}</NavLink>
                  <span className='detail text-muted-foreground'> · {item.detail}</span>
                </li>
              ))}
            </ul>
          )
        : null}
    </section>
  )
}
function Summary () {
  const {
    user,
    snapshot: { state: s, channel }
  } = useDashboard()
  const active = s.activeGame ? s.games[s.activeGame] : undefined
  const games = Object.values(s.games)
    .sort((a, b) => b.observedAt - a.observedAt)
    .slice(0, 12)
  const finished = games.filter((g) => g.result)
  const wins = finished.filter((g) => g.result === 'win').length
  const losses = finished.filter((g) => g.result === 'loss').length
  const remakes = finished.filter((g) => g.result === 'remake').length
  const live = Object.values(s.predictions)
    .filter((p) => p.twitchId && ['ACTIVE', 'LOCKED'].includes(p.status))
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  const queue = Object.values(s.reminders)
    .filter((r) => openReminder(r.status))
    .sort((a, b) => a.createdAt - b.createdAt)
  return (
    <>
      <Heading
        title={`Hola, ${user.name}`}
        description={`Panel de #${channel}. Se actualiza solo cada pocos segundos.`}
        compact
      />
      <div className='page-grid'>
        <Splash items={attention(s)} />
        <Section
          title={live ? s.settings.predictions.title : 'Partida'}
          className='span'
          aside={
            <span
              className='state'
              data-tone={
                s.tracking === 'active'
                  ? 'live'
                  : s.tracking === 'unknown'
                    ? 'pending'
                    : 'done'
              }
            >
              {s.tracking === 'active'
                ? 'En juego'
                : s.tracking === 'unknown'
                  ? 'Por confirmar'
                  : 'Sin partida'}
            </span>
          }
        >
          <p className='text-muted-foreground'>
            {active
              ? `${queueName(active.queue)} · empezó ${when(active.startedAt ?? active.observedAt)} · ${active.id}`
              : s.tracking === 'unknown'
                ? 'Esperando señal de Riot.'
                : 'Riot no detecta una partida.'}
          </p>
          {live
            ? (
                <PredictionItem
                  prediction={live}
                  title={s.settings.predictions.title}
                  csrf={user.csrf}
                  embedded
                />
              )
            : (
                <p>No hay una prediction abierta.</p>
              )}
        </Section>
        <Section title='Ficha de la noche' className='half'>
          {games.length
            ? (
                <>
                  <p className='tally' aria-label={`${wins} victorias, ${losses} derrotas`}>
                    {wins}–{losses}
                    {remakes
                      ? (
                          <span className='ms-2 align-middle text-sm font-bold text-muted-foreground'>
                            {plural(remakes, 'remake', 'remakes')}
                          </span>
                        )
                      : null}
                  </p>
                  <ol className='record' aria-label='Últimas partidas, de la más nueva a la más vieja'>
                    {games.map((g) => {
                      const result = g.result ?? (g.id === s.activeGame ? 'live' : 'none')
                      const label = gameResult(g.result, g.id === s.activeGame)
                      return (
                        <li key={g.id} data-result={result} title={`${label} · ${queueName(g.queue)} · ${when(g.endedAt ?? g.observedAt)}`}>
                          <span aria-hidden='true'>
                            {result === 'win' ? 'V' : result === 'loss' ? 'D' : result === 'remake' ? 'R' : '·'}
                          </span>
                          <span className='sr-only'>{label}</span>
                        </li>
                      )
                    })}
                  </ol>
                </>
              )
            : (
                <Empty>Todavía no se registraron partidas.</Empty>
              )}
        </Section>
        <Section
          title='Al final de la partida'
          className='half'
          aside={<span className='tally'>{queue.length}</span>}
        >
          {queue.length
            ? (
                <ul className='queue-list flex flex-col gap-2'>
                  {queue.slice(0, 3).map((r) => (
                    <li key={r.id} className='flex justify-between gap-3'>
                      <span className='min-w-0'>{r.text}</span>
                      <span className='shrink-0 text-sm text-muted-foreground'>{r.author}</span>
                    </li>
                  ))}
                </ul>
              )
            : (
                <p className='text-muted-foreground'>No hay recordatorios en cola.</p>
              )}
          <Button asChild variant='outline' className='w-fit'>
            <NavLink to='/recordatorios'>
              {queue.length ? 'Ver la cola' : 'Agregar recordatorio'}
            </NavLink>
          </Button>
        </Section>
        <Section title='Cuentas de Twitch' className='span'>
          <p className='text-muted-foreground'>
            La cuenta del canal y la del bot se conectan por separado. Los
            permisos quedan guardados en el servidor; el estado está en Operación.
          </p>
          {user.botManager
            ? (
                <div className='flex flex-wrap gap-3'>
                  {user.streamer && (
                    <Button asChild variant='outline'>
                      <a href='/api/auth/twitch?purpose=broadcaster'>
                        Conectar cuenta del canal
                      </a>
                    </Button>
                  )}
                  <Button asChild variant='outline'>
                    <a href='/api/auth/twitch?purpose=bot'>Conectar cuenta del bot</a>
                  </Button>
                </div>
              )
            : (
                <p>Solo el streamer puede conectar estas cuentas.</p>
              )}
          {user.botManager && !user.streamer && (
            <p className='text-sm text-muted-foreground'>
              La cuenta del canal la conecta el streamer. Para el bot, autorizá
              con la cuenta del bot, no con la tuya.
            </p>
          )}
        </Section>
      </div>
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
        description='El bot los manda al chat cuando termina la partida actual, o la siguiente si ahora no hay ninguna.'
      />
      <div className='page-grid'>
        <Form
          title='Nuevo recordatorio'
          path='admin/reminders'
          csrf={user.csrf}
          done='Recordatorio en cola.'
          submitLabel='Agregar recordatorio'
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
                  {Object.values(s.reminders)
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((r) => (
                      <article className='row' key={r.id}>
                        <div className='flex min-w-0 flex-col gap-1'>
                          <strong className='font-bold'>{r.text}</strong>
                          <p className='text-sm text-muted-foreground'>
                            {r.author} ·{' '}
                            <time title={exactTime(r.createdAt)}>
                              {when(r.createdAt)}
                            </time>
                          </p>
                          <p className='flex flex-wrap items-center gap-2 text-sm'>
                            <span className='state' data-tone={reminderTone(r.status)}>
                              {reminderStatus(r.status)}
                            </span>
                            {r.status === 'delivery_unknown'
                              ? <span>Revisalo en Operación.</span>
                              : null}
                            {r.attempts > 1
                              ? <span className='text-muted-foreground'>{plural(r.attempts, 'intento', 'intentos')}</span>
                              : null}
                          </p>
                          {openReminder(r.status)
                            ? (
                                <p className='text-sm text-muted-foreground'>
                                  Para quitarlo desde el chat:{' '}
                                  <code>!recordar quitar {r.id}</code>
                                </p>
                              )
                            : null}
                        </div>
                        {openReminder(r.status)
                          ? (
                              <Action
                                path={`admin/reminders/${encodeURIComponent(r.id)}`}
                                method='DELETE'
                                variant='destructive'
                                csrf={user.csrf}
                                label={`Cancelar recordatorio: ${r.text.slice(0, 60)}`}
                                confirm={{
                                  message: '¿Cancelar este recordatorio? No se va a enviar al chat.',
                                  action: 'Cancelar recordatorio'
                                }}
                                done='Recordatorio cancelado.'
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
                <Empty>
                  Todavía no hay recordatorios. Agregá uno o usá !recordar en el
                  chat.
                </Empty>
              )}
        </Section>
      </div>
    </>
  )
}
const closedPredictions = ['RESOLVED', 'CANCELED', 'skipped']
function Predictions () {
  const {
    user,
    snapshot: { state: s }
  } = useDashboard()
  const all = Object.values(s.predictions).sort(
    (a, b) => b.createdAt - a.createdAt
  )
  const open = all.filter((p) => !closedPredictions.includes(p.status))
  const closed = all.filter((p) => closedPredictions.includes(p.status))
  const title = s.settings.predictions.title
  return (
    <>
      <Heading
        title='Predictions'
        description='El chat tiene 5 minutos para participar. Con la resolución automática activa, una victoria o derrota confirmada la resuelve y un remake la cancela con reembolso.'
      />
      <div className='page-grid'>
        <Section title='Abiertas' className='span'>
          {open.length
            ? (
                <List>
                  {open.map((p) => (
                    <PredictionItem
                      key={p.gameId}
                      prediction={p}
                      title={title}
                      csrf={user.csrf}
                    />
                  ))}
                </List>
              )
            : (
                <Empty>La próxima partida elegible abrirá una prediction.</Empty>
              )}
        </Section>
        {closed.length
          ? (
              <Collapsible className='span'>
                <Card>
                  <CardHeader className='row'>
                    <CardTitle>
                      <h2>Historial</h2>
                    </CardTitle>
                    <CollapsibleTrigger asChild>
                      <Button variant='ghost'>
                        Ver {closed.length}{' '}
                        {closed.length === 1 ? 'cerrada' : 'cerradas'}
                      </Button>
                    </CollapsibleTrigger>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent>
                      <List>
                        {closed.map((p) => (
                          <PredictionItem
                            key={p.gameId}
                            prediction={p}
                            title={title}
                            csrf={user.csrf}
                          />
                        ))}
                      </List>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )
          : null}
      </div>
    </>
  )
}
const requestLabel = (
  p: Snapshot['state']['predictions'][string]
): string | undefined => {
  if (!p.requested) return undefined
  if (p.requested.status === 'LOCKED') return 'cerrar la participación'
  if (p.requested.status === 'CANCELED') return 'cancelar y reembolsar'
  const outcome = p.outcomes?.find((o) => o.id === p.requested?.outcome)
  return `resolver como «${outcome?.title ?? 'opción elegida'}»`
}
function PredictionItem ({
  prediction: p,
  title,
  csrf,
  embedded = false
}: {
  prediction: Snapshot['state']['predictions'][string]
  title: string
  csrf: string
  /** Inside a panel that already names the game. */
  embedded?: boolean
}) {
  const heading = useId()
  const path = `admin/predictions/${encodeURIComponent(p.gameId)}`
  const requested = requestLabel(p)
  // A pending resolve or refund is final; only a pending lock can still be overridden.
  const settling = p.requested && p.requested.status !== 'LOCKED'
  const manageable =
    Boolean(p.twitchId) && !['RESOLVED', 'CANCELED'].includes(p.status) && !settling
  const outcomeIcons = [Check, X]
  return (
    <article aria-labelledby={heading} className='flex flex-col gap-3'>
      <h3 id={heading} className={embedded ? 'sr-only' : 'font-bold'}>
        Prediction de la partida {p.gameId}
      </h3>
      <p className='flex flex-wrap items-center gap-2 text-sm'>
        <span className='state' data-tone={predictionTone(p.status)}>
          {predictionStatus(p.status)}
        </span>
        <time
          className='text-muted-foreground'
          title={exactTime(p.createdAt)}
        >
          {when(p.createdAt)}
        </time>
      </p>
      {p.reason && p.reason !== predictionStatus(p.status)
        ? (
            <p className='text-sm text-muted-foreground'>{p.reason}</p>
          )
        : null}
      {requested
        ? (
            <p className='text-sm'>
              Pedido enviado: {requested}. El bot lo aplica en Twitch en la
              próxima revisión.
            </p>
          )
        : null}
      {manageable
        ? (
            <>
              {p.outcomes?.length
                ? (
                    <div className='outcomes'>
                      {p.outcomes.map((o, i) => {
                        const Icon =
                          p.outcomes!.length === 2 ? outcomeIcons[i] : undefined
                        return (
                          <Action
                            key={o.id}
                            path={path}
                            data={{ status: 'RESOLVED', outcome: o.id }}
                            csrf={csrf}
                            size='lg'
                            label={`Resolver: ${o.title} (partida ${p.gameId})`}
                            confirm={{
                              message: `¿Resolver «${title}» como «${o.title}»? Twitch reparte los puntos entre quienes eligieron «${o.title}». No se puede deshacer.`,
                              action: `Resolver como «${o.title}»`
                            }}
                            done={`Pedido enviado: resolver ${p.gameId} como «${o.title}».`}
                          >
                            {Icon ? <Icon aria-hidden='true' /> : null}
                            Resolver: {o.title}
                          </Action>
                        )
                      })}
                    </div>
                  )
                : null}
              <div className='flex flex-wrap gap-3'>
                {p.status === 'ACTIVE' && p.requested?.status !== 'LOCKED'
                  ? (
                      <Action
                        path={path}
                        data={{ status: 'LOCKED' }}
                        csrf={csrf}
                        label={`Bloquear (partida ${p.gameId})`}
                        confirm={{
                          message:
                            '¿Cerrar la participación? Nadie más puede apostar y Twitch no permite reabrirla.',
                          action: 'Cerrar participación'
                        }}
                        done={`Pedido enviado: cerrar la participación de ${p.gameId}.`}
                      >
                        Bloquear
                      </Action>
                    )
                  : null}
                <Action
                  path={path}
                  data={{ status: 'CANCELED' }}
                  variant='destructive'
                  csrf={csrf}
                  label={`Cancelar y reembolsar (partida ${p.gameId})`}
                  confirm={{
                    message: `¿Cancelar «${title}» y devolver los puntos a todos? No se puede deshacer.`,
                    action: 'Cancelar y reembolsar'
                  }}
                  done={`Pedido enviado: cancelar ${p.gameId} y reembolsar.`}
                >
                  Cancelar y reembolsar
                </Action>
              </div>
            </>
          )
        : null}
      {p.status === 'creation_unknown'
        ? (
            <Form
              bare
              title='Vincular creación incierta'
              path={`${path}/link`}
              csrf={csrf}
              submitLabel='Vincular'
              done={`${p.gameId} quedó vinculada a la prediction de Twitch.`}
              fields={[
                {
                  name: 'twitchId',
                  label: 'ID de la prediction verificada en Twitch',
                  max: 100,
                  help: 'Confirmá en Twitch que la prediction exista y pegá su ID. El bot la busca entre las del canal antes de vincularla.'
                }
              ]}
            />
          )
        : null}
    </article>
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
        description='Lo que el bot contesta en el chat ante canjes, Bits, Power-ups, subs, regalos y follows. Usá {user} para mencionar a quien lo hizo.'
      />
      <div className='page-grid'>
        <Form
          title='Nueva respuesta de chat'
          path='admin/settings'
          method='PUT'
          csrf={user.csrf}
          submitLabel='Agregar respuesta'
          done='Respuesta guardada.'
          fields={[
            {
              name: 'id',
              label: 'Nombre de la regla',
              max: 100,
              help: 'Para reconocerla en la lista. Si usás un nombre que ya existe, reemplaza esa regla.'
            },
            { name: 'text', label: 'Respuesta', max: 400 },
            {
              name: 'rewardId',
              label: 'ID de recompensa (opcional)',
              required: false,
              max: 100,
              help: 'Solo para canjes: limita la respuesta a una recompensa. Vacío, responde a todas.'
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
                        <strong className='font-bold'>
                          {rule.id}
                          {rule.enabled ? '' : ' (pausada)'}
                        </strong>
                        <p className='text-sm text-muted-foreground'>
                          {eventLabels[rule.event] ?? rule.event}
                        </p>
                        <p>{rule.text}</p>
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
                        label={`Eliminar regla ${rule.id}`}
                        confirm={{
                          message: `¿Eliminar la regla «${rule.id}»? El bot deja de responder a ese evento.`,
                          action: 'Eliminar regla'
                        }}
                        done={`Regla «${rule.id}» eliminada.`}
                      >
                        Eliminar regla
                      </Action>
                    </div>
                  ))}
                </List>
              )
            : (
                <Empty>
                  El bot no responde a ningún evento todavía. Agregá la primera
                  respuesta.
                </Empty>
              )}
        </Section>
      </div>
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
        description='Cada cambio se valida en el servidor y queda registrado en Operación. Apagar trivia o historias cancela sus rondas y mensajes pendientes.'
      />
      <div className='page-grid'>
        <Form
          title='Cuenta de League of Legends'
          path='admin/account'
          method='PUT'
          csrf={user.csrf}
          submitLabel='Guardar cuenta'
          done='Cuenta de League of Legends guardada.'
          fields={[
            {
              name: 'gameName',
              label: 'Riot ID (nombre)',
              value: s.account?.gameName
            },
            {
              name: 'tagLine',
              label: 'Tag',
              value: s.account?.tagLine,
              help: 'Lo que va después del #, sin el #.'
            }
          ]}
          transform={(d) => ({ ...d, platform: d.platform, region: d.region })}
        >
          <Choice
            id='platform'
            label='Servidor'
            defaultValue={s.account?.platform ?? 'la2'}
            options={platforms.map((p) => ({
              value: p,
              label: `${platformName[p] ?? p} (${p})`
            }))}
          />
          <Choice
            id='region'
            label='Región de Riot'
            help='Para LAS, LAN, NA y Brasil es América.'
            defaultValue={s.account?.region ?? 'americas'}
            options={regions.map((r) => ({
              value: r,
              label: regionName[r] ?? r
            }))}
          />
        </Form>
        <Form
          title='Configuración de módulos'
          path='admin/settings'
          method='PUT'
          csrf={user.csrf}
          submitLabel='Guardar configuración'
          done='Configuración guardada.'
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
                  [
                    'tracking',
                    'Seguimiento de partidas (Riot)',
                    settings.tracking.enabled
                  ],
                  [
                    'live',
                    'Seguir partidas solo durante el directo',
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
                label='Abrirla solo si la partida empezó hace menos de (segundos)'
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
                label='Cada cuánto consultar a Riot (segundos)'
                value={settings.tracking.pollSeconds}
                min={30}
                max={60}
              />
              <Field>
                <FieldLabel htmlFor='queues'>Colas a seguir</FieldLabel>
                <Input
                  id='queues'
                  name='queues'
                  defaultValue={settings.tracking.queues.join(',')}
                  pattern='[0-9, ]*'
                  aria-describedby='queues-help'
                />
                <FieldDescription id='queues-help'>
                  Números de cola separados por coma, por ejemplo 420 (SoloQ) y
                  440 (Flex). Vacío: todas.
                </FieldDescription>
              </Field>
              <Numeric
                name='interval'
                label='Cada cuánto lanzar una pregunta (minutos)'
                unit='minutes'
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
                label='Espera entre historias en el canal (segundos)'
                value={settings.stories.globalSeconds}
                min={0}
                max={86400}
              />
              <Numeric
                name='actor'
                label='Espera para quien lanza una historia (segundos)'
                value={settings.stories.actorSeconds}
                min={0}
                max={86400}
              />
              <Numeric
                name='guest'
                label='Espera para quien es mencionado (segundos)'
                value={settings.stories.guestSeconds}
                min={0}
                max={86400}
              />
            </FieldGroup>
          </FieldSet>
          <FieldDescription>
            Las historias nunca aplican timeouts reales. Las victorias se cuentan
            desde cero.
          </FieldDescription>
        </Form>
      </div>
    </>
  )
}
function Numeric ({
  name,
  label,
  value,
  min,
  max,
  unit = 'seconds'
}: {
  name: string
  label: string
  value: number
  min: number
  max: number
  unit?: 'seconds' | 'minutes'
}) {
  const [current, setCurrent] = useState(String(value))
  const amount = Number(current)
  const valid = current !== '' && Number.isFinite(amount)
  const toSeconds = (n: number) => (unit === 'minutes' ? n * 60 : n)
  return (
    <Field>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input
        id={name}
        name={name}
        type='number'
        inputMode='numeric'
        className='numeric'
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        min={min}
        max={max}
        required
        aria-describedby={`${name}-help`}
      />
      <FieldDescription id={`${name}-help`}>
        {(valid ? `${duration(toSeconds(amount))}. ` : '') +
          (min === 0
            ? `Hasta ${duration(toSeconds(max))}; 0 es sin espera.`
            : `Entre ${duration(toSeconds(min))} y ${duration(toSeconds(max))}.`)}
      </FieldDescription>
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
        description='Cargar preguntas no prende los juegos: eso se hace en Configuración. Solo se cuentan victorias, sin moneda ni sanciones.'
      />
      <div className='page-grid'>
        <Form
          title='Nueva pregunta'
          path='admin/questions'
          csrf={user.csrf}
          submitLabel='Agregar pregunta'
          done='Pregunta agregada al banco.'
          fields={[
            { name: 'text', label: 'Pregunta', max: 400 },
            {
              name: 'answers',
              label: 'Respuestas válidas',
              max: 4000,
              help: 'Separalas con punto y coma (;). Cualquiera de ellas gana.'
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
                          <strong className='font-bold'>{q.text}</strong>
                          <p className='text-sm text-muted-foreground'>
                            {q.answers.join(' · ')} ·{' '}
                            {q.used
                              ? `usada ${plural(q.used, 'vez', 'veces')}`
                              : 'sin usar'}
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
                            label={`Eliminar pregunta: ${q.text.slice(0, 60)}`}
                            confirm={{
                              message: '¿Eliminar esta pregunta del banco? No se puede deshacer.',
                              action: 'Eliminar pregunta'
                            }}
                            done='Pregunta eliminada.'
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
                          submitLabel='Guardar cambios'
                          done='Pregunta actualizada.'
                          fields={[
                            {
                              name: 'text',
                              label: 'Pregunta',
                              value: q.text,
                              max: 400
                            },
                            {
                              name: 'answers',
                              label: 'Respuestas válidas',
                              value: q.answers.join(';'),
                              max: 4000,
                              help: 'Separalas con punto y coma (;).'
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
                  <TableCaption className='sr-only'>
                    Victorias por usuario y juego
                  </TableCaption>
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
          {Object.values(s.stories).length
            ? (
                Object.values(s.stories)
                  .sort((a, b) => b.at - a.at)
                  .slice(0, 20)
                  .map((story) => (
                    <p key={story.id}>
                      Historia «{story.family}» ·{' '}
                      <time title={exactTime(story.at)}>{when(story.at)}</time> ·{' '}
                      {story.winners.length
                        ? plural(story.winners.length, 'ganador', 'ganadores')
                        : 'sin ganadores'}
                    </p>
                  ))
              )
            : (
                <Empty>Todavía no hubo historias.</Empty>
              )}
        </Section>
      </div>
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
        title='Operación'
        description='Cómo anda el bot por dentro: conexiones, entregas y cambios recientes. Los secretos nunca salen del servidor.'
      />
      <div className='page-grid'>
        <Section title='Estado del bot'>
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
                      {ops.data.worker
                        ? (
                            <>
                              El proceso del bot respondió{' '}
                              <time title={exactTime(ops.data.worker.at)}>
                                {when(ops.data.worker.at)}
                              </time>
                              .
                            </>
                          )
                        : 'El proceso del bot no da señales.'}
                    </p>
                    {ops.data.connections.map((c) => (
                      <p key={`${c.purpose}:${c.user_id}`}>
                        {connectionName(c.purpose)} conectada ·{' '}
                        <time title={exactTime(c.updated_at)}>
                          {when(c.updated_at)}
                        </time>
                      </p>
                    ))}
                    <Separator />
                    <h3 className='subhead'>Entregas en curso</h3>
                    {ops.data.deliveries.some((d) => !d.completed_at)
                      ? (
                          ops.data.deliveries
                            .filter((d) => !d.completed_at)
                            .map((d) => (
                              <p key={`${d.event_id}:${d.consumer}`}>
                                {consumerName(d.consumer)} ·{' '}
                                {plural(d.attempts ?? 0, 'intento', 'intentos')}
                                {d.last_error
                                  ? ` · último error: ${d.last_error}`
                                  : ''}
                              </p>
                            ))
                        )
                      : (
                          <p className='text-muted-foreground'>Nada en curso.</p>
                        )}
                    <Separator />
                    <h3 className='subhead'>Tareas que fallaron</h3>
                    {ops.data.failedJobs?.length
                      ? (
                          ops.data.failedJobs.map((job) => (
                            <p key={job.id} className='flex flex-wrap items-center gap-2'>
                              <span className='state' data-tone='alert'>Falló</span>
                              <span>{job.name}</span>
                              <span className='text-sm text-muted-foreground'>
                                <time title={exactTime(job.created_on)}>
                                  {when(job.created_on)}
                                </time>
                                {` · ${plural(job.retry_count, 'reintento', 'reintentos')}`}
                              </span>
                            </p>
                          ))
                        )
                      : (
                          <p className='text-muted-foreground'>Ninguna.</p>
                        )}
                    <Separator />
                    <h3 className='subhead'>Últimos cambios</h3>
                    {ops.data.audit.map((a, i) => (
                      <p key={i}>
                        {auditAction(a.action)} · {a.user_id} ·{' '}
                        <time title={exactTime(a.at)}>{when(a.at)}</time>
                      </p>
                    ))}
                    <Separator />
                    <h3 className='subhead'>Eventos recibidos</h3>
                    {ops.data.events.map((e) => (
                      <p key={e.data.id}>
                        {eventLabels[e.data.type] ??
                        streamEventLabels[e.data.type] ??
                        e.data.type}{' '}
                        ·{' '}
                        <time title={exactTime(e.received_at)}>
                          {when(e.received_at)}
                        </time>
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
                      <div className='flex min-w-0 flex-col gap-1'>
                        <p>{m.text}</p>
                        <p className='text-sm text-muted-foreground'>
                          Revisá el chat: si el mensaje aparece, marcalo como
                          enviado; si no, reenvialo.
                        </p>
                      </div>
                      <div className='flex flex-wrap gap-3'>
                        <Action
                          path={`admin/messages/${encodeURIComponent(m.id)}/review`}
                          data={{ decision: 'sent' }}
                          csrf={user.csrf}
                          label={`Marcar como enviado: ${m.text.slice(0, 60)}`}
                          done='Entrega marcada como enviada.'
                        >
                          Marcar como enviado
                        </Action>
                        <Action
                          path={`admin/messages/${encodeURIComponent(m.id)}/review`}
                          data={{ decision: 'retry' }}
                          csrf={user.csrf}
                          label={`Reenviar al chat: ${m.text.slice(0, 60)}`}
                          done='El mensaje vuelve a la cola de envío.'
                        >
                          Reenviar al chat
                        </Action>
                      </div>
                    </article>
                  ))}
                </List>
              )
            : (
                <Empty>No hay mensajes con entrega sin confirmar.</Empty>
              )}
        </Section>
        <Section title='Errores recientes'>
          {s.errors.length
            ? (
                s.errors
                  .slice(-30)
                  .reverse()
                  .map((e, i) => (
                    <p key={i} className='flex flex-wrap items-center gap-2'>
                      <span className='state' data-tone='alert'>
                        {consumerName(e.feature)}
                      </span>
                      <span>{e.message}</span>
                      <time className='text-sm text-muted-foreground' title={exactTime(e.at)}>
                        {when(e.at)}
                      </time>
                    </p>
                  ))
              )
            : (
                <Empty>Sin errores recientes.</Empty>
              )}
        </Section>
      </div>
    </>
  )
}
