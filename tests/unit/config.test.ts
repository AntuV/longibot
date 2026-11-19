import { describe, expect, it } from 'vitest'
import { readConfig } from '../../packages/core/src/config.js'

const base = { DATABASE_URL: 'postgresql://localhost/longibot' }
describe('environment', () => {
  it('defaults to longii_ only when omitted', () => { expect(readConfig(base).TWITCH_CHANNEL).toBe('longii_') })
  it('normalizes an explicit channel', () => { expect(readConfig({ ...base, TWITCH_CHANNEL: ' Another_123 ' }).TWITCH_CHANNEL).toBe('another_123') })
  it.each(['', ' ', 'bad-name', 'a'.repeat(26)])('rejects invalid channel %s', channel => { expect(() => readConfig({ ...base, TWITCH_CHANNEL: channel })).toThrow('TWITCH_CHANNEL') })
  it('parses bot manager logins, defaulting to antuv', () => {
    expect(readConfig(base).BOT_MANAGER_TWITCH_LOGINS).toEqual(['antuv'])
    expect(readConfig({ ...base, BOT_MANAGER_TWITCH_LOGINS: ' AntuV, otro_mod ,' }).BOT_MANAGER_TWITCH_LOGINS).toEqual(['antuv', 'otro_mod'])
    expect(() => readConfig({ ...base, BOT_MANAGER_TWITCH_LOGINS: 'bad-name' })).toThrow('BOT_MANAGER_TWITCH_LOGINS')
  })
  it('does not leak connection credentials in errors', () => { expect(() => readConfig({ DATABASE_URL: 'secret-value' })).toThrow(/^Invalid configuration: DATABASE_URL$/) })
  it('requires HTTPS in production', () => { expect(() => readConfig({ ...base, NODE_ENV: 'production' })).toThrow('HTTPS') })
})
it('validates a single HTTP origin and optional chat owner without accepting credential-bearing URLs', () => {
  expect(readConfig({ ...base, OWNER_TWITCH_USER_ID: '' }).OWNER_TWITCH_USER_ID).toBeUndefined()
  expect(readConfig({ ...base, OWNER_TWITCH_USER_ID: '123' }).OWNER_TWITCH_USER_ID).toBe('123')
  expect(() => readConfig({ ...base, OWNER_TWITCH_USER_ID: 'not-an-id' })).toThrow('OWNER_TWITCH_USER_ID')
  for (const APP_BASE_URL of ['ftp://example.com', 'https://u:p@example.com', 'https://example.com/path', 'https://example.com/?q=x', 'https://example.com/#x']) expect(() => readConfig({ ...base, APP_BASE_URL })).toThrow('APP_BASE_URL')
  expect(readConfig({ ...base, NODE_ENV: 'production', APP_BASE_URL: 'https://example.com' }).APP_BASE_URL).toBe('https://example.com')
})
