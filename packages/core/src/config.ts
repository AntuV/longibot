import { z } from 'zod'

const environment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url().refine(value => /^postgres(ql)?:/.test(value)),
  TWITCH_CHANNEL: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,25}$/).default('longii_'),
  BOT_TWITCH_LOGIN: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,25}$/).default('longibot'),
  // Moderators (by login) allowed to connect the bot account, besides the streamer.
  BOT_MANAGER_TWITCH_LOGINS: z.string().default('antuv').transform(value => value.split(',').map(login => login.trim().toLowerCase()).filter(Boolean)).pipe(z.array(z.string().regex(/^[a-z0-9_]{1,25}$/))),
  OWNER_TWITCH_USER_ID: z.preprocess(value => value === '' ? undefined : value, z.string().regex(/^\d+$/).optional()),
  APP_BASE_URL: z.url().refine(value => { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password }).default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
})

export function readConfig (env: NodeJS.ProcessEnv = process.env) {
  const result = environment.safeParse(env)
  // Do not include input values (connection URLs may contain credentials).
  if (!result.success) throw new Error(`Invalid configuration: ${[...new Set(result.error.issues.map(issue => issue.path.join('.')))].join(', ')}`)
  if (result.data.NODE_ENV === 'production' && !result.data.APP_BASE_URL.startsWith('https://')) throw new Error('APP_BASE_URL must use HTTPS in production')
  return result.data
}
