import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { DomainError } from '../../features/src/model.js'
export const opaque = () => randomBytes(32).toString('base64url')
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export function equal (a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
function key (secret: string) {
  const buffer = Buffer.from(secret, 'base64')
  if (buffer.length !== 32) throw new DomainError('TOKEN_ENCRYPTION_KEY debe contener 32 bytes en base64', 503)
  return buffer
}
export function encrypt (value: unknown, secret: string) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64url')).join('.')
}
export function decrypt (value: string, secret: string): unknown {
  const [iv, tag, data] = value.split('.').map(v => Buffer.from(v, 'base64url'))
  if (!iv || !tag || !data) throw new Error('Invalid encrypted token')
  const cipher = createDecipheriv('aes-256-gcm', key(secret), iv); cipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString()) as unknown
}
