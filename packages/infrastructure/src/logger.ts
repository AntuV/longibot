import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', 'password', 'token', 'access_token', 'refresh_token', 'client_secret', 'DATABASE_URL', 'SESSION_SECRET', 'TOKEN_ENCRYPTION_KEY'], censor: '[REDACTED]' }
})
