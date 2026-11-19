// Human, rioplatense labels for the values the API returns as codes.
// Unknown codes fall back to the raw value so new states stay visible.

const pick = (table: Record<string, string>, code: string) => table[code] ?? code

export const reminderStatus = (code: string) =>
  pick(
    {
      waiting_next_game: 'Espera la próxima partida',
      awaiting_game_assignment: 'Esperando asignarle partida',
      queued: 'En cola para el final de la partida',
      sending: 'Enviando al chat',
      sent: 'Enviado',
      canceled: 'Cancelado',
      delivery_unknown: 'Sin confirmar si llegó'
    },
    code
  )
export const openReminder = (code: string) =>
  ['waiting_next_game', 'awaiting_game_assignment', 'queued'].includes(code)

export const predictionStatus = (code: string) =>
  pick(
    {
      pending: 'Por crear',
      creating: 'Creando en Twitch',
      creation_unknown: 'Twitch no confirmó la creación',
      conflict: 'En conflicto con Twitch',
      skipped: 'Salteada',
      ACTIVE: 'Abierta: el chat puede participar',
      LOCKED: 'Participación cerrada',
      RESOLVED: 'Resuelta',
      CANCELED: 'Cancelada y reembolsada'
    },
    code
  )

export const gameResult = (result: string | undefined, active: boolean) =>
  result === 'win'
    ? 'Victoria'
    : result === 'loss'
      ? 'Derrota'
      : result === 'remake'
        ? 'Remake'
        : active
          ? 'En juego'
          : 'Sin resultado'

export const queueName = (queue: number) =>
  pick(
    {
      0: 'Personalizada',
      400: 'Normal (draft)',
      420: 'SoloQ',
      430: 'Normal (a ciegas)',
      440: 'Flex',
      450: 'ARAM',
      490: 'Partida rápida',
      700: 'Clash',
      900: 'URF',
      1700: 'Arena',
      1900: 'URF'
    },
    String(queue)
  ).replace(/^(\d+)$/, 'Cola $1')

export const platformName: Record<string, string> = {
  la1: 'LAN',
  la2: 'LAS',
  na1: 'NA',
  br1: 'Brasil',
  euw1: 'EUW',
  eun1: 'EUNE',
  kr: 'Corea',
  jp1: 'Japón',
  oc1: 'Oceanía',
  tr1: 'Turquía',
  ru: 'Rusia',
  ph2: 'Filipinas',
  sg2: 'Singapur',
  th2: 'Tailandia',
  tw2: 'Taiwán',
  vn2: 'Vietnam'
}
export const regionName: Record<string, string> = {
  americas: 'América',
  europe: 'Europa',
  asia: 'Asia',
  sea: 'Sudeste asiático'
}

export const connectionName = (purpose: string) =>
  pick({ broadcaster: 'Cuenta del canal', bot: 'Cuenta del bot' }, purpose)

export const consumerName = (consumer: string) =>
  pick(
    {
      reminders: 'Recordatorios',
      predictions: 'Predictions',
      trivia: 'Trivia',
      stories: 'Historias',
      'channel-events': 'Respuestas automáticas',
      riot: 'Riot',
      twitch: 'Twitch'
    },
    consumer
  )

export const streamEventLabels: Record<string, string> = {
  'stream.started.v1': 'Empezó el directo',
  'stream.ended.v1': 'Terminó el directo',
  'chat.message.received.v1': 'Mensaje de chat',
  'prediction.state.changed.v1': 'Cambio en una prediction',
  'game.started.v1': 'Empezó una partida',
  'game.ended.v1': 'Terminó una partida'
}

export function auditAction (action: string) {
  const [kind = '', target = ''] = action.split(':')
  const table: Record<string, string> = {
    'account.update': 'Cambió la cuenta de League of Legends',
    'settings.update': 'Cambió la configuración',
    'reminders.create': 'Agregó un recordatorio',
    'reminders.cancel': 'Canceló un recordatorio',
    'questions.create': 'Agregó una pregunta',
    'questions.save': 'Editó una pregunta',
    'questions.delete': 'Eliminó una pregunta',
    'predictions.LOCKED': 'Cerró la participación de',
    'predictions.RESOLVED': 'Resolvió',
    'predictions.CANCELED': 'Canceló y reembolsó',
    'predictions.link': 'Vinculó',
    'messages.sent': 'Marcó como enviada una entrega',
    'messages.retry': 'Reencoló una entrega'
  }
  const label = table[kind]
  if (!label) return action
  return kind.startsWith('predictions.') ? `${label} la prediction ${target}` : label
}

const relative = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' })
const absolute = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short'
})
/** Milliseconds from a timestamp or an ISO string; NaN when unparseable. */
export const toTime = (value: number | string) =>
  typeof value === 'number' ? value : Date.parse(value)
export function when (value: number | string, now = Date.now()) {
  const time = toTime(value)
  if (Number.isNaN(time)) return String(value)
  const seconds = Math.round((time - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return 'recién'
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour')
  if (abs < 7 * 86400) return relative.format(Math.round(seconds / 86400), 'day')
  return absolute.format(time)
}
export const exactTime = (value: number | string) => {
  const time = toTime(value)
  return Number.isNaN(time) ? String(value) : absolute.format(time)
}

/** "8 h", "1 h 30 min", "45 s"; zero reads as "sin espera". */
export function duration (seconds: number) {
  if (!seconds) return 'sin espera'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h ? `${h} h` : '', m ? `${m} min` : '', s ? `${s} s` : '']
    .filter(Boolean)
    .join(' ')
}

export const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`

export type Tone = 'live' | 'pending' | 'alert' | 'done'
/** Visual tone of a state: solid live, dashed pending, red alert, quiet done. */
export const reminderTone = (code: string): Tone =>
  code === 'delivery_unknown'
    ? 'alert'
    : code === 'sending'
      ? 'live'
      : ['sent', 'canceled'].includes(code)
          ? 'done'
          : 'pending'
export const predictionTone = (code: string): Tone =>
  code === 'ACTIVE'
    ? 'live'
    : ['creation_unknown', 'conflict'].includes(code)
        ? 'alert'
        : ['RESOLVED', 'CANCELED', 'skipped'].includes(code)
            ? 'done'
            : 'pending'
