import type { Twitch } from './adapters/twitch.js'

export interface Avatar { body: Buffer, type: string }

const maxBytes = 1_048_576

// Downloads the bot's Twitch profile picture once so the dashboard can serve it
// from its own origin (brand mark and favicon) without loosening the CSP.
export async function loadAvatar (twitch: Pick<Twitch, 'user'>, login: string, fetcher: typeof fetch = fetch): Promise<Avatar | undefined> {
  const user = await twitch.user(login)
  if (!user.profile_image_url) return undefined
  const url = new URL(user.profile_image_url)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.jtvnw.net')) return undefined
  const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) })
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || !type.startsWith('image/')) return undefined
  const body = Buffer.from(await response.arrayBuffer())
  return body.length > 0 && body.length <= maxBytes ? { body, type } : undefined
}
