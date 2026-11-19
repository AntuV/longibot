import { describe, expect, it, vi } from 'vitest'
import { loadAvatar } from '../../packages/infrastructure/src/branding.js'

const user = (picture?: string) => ({ user: vi.fn().mockResolvedValue({ id: '1', login: 'longibot', display_name: 'LongiBot', profile_image_url: picture }) })
const image = (type = 'image/png', status = 200) => vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status, headers: { 'content-type': type } }))

describe('bot avatar', () => {
  it('downloads the Twitch profile picture of the configured login', async () => {
    const twitch = user('https://static-cdn.jtvnw.net/jtv_user_pictures/a.png'); const fetcher = image()
    expect(await loadAvatar(twitch, 'longibot', fetcher)).toEqual({ body: Buffer.from([1, 2, 3]), type: 'image/png' })
    expect(twitch.user).toHaveBeenCalledWith('longibot')
  })
  it('ignores missing, foreign or non-image pictures', async () => {
    expect(await loadAvatar(user(), 'longibot', image())).toBeUndefined()
    expect(await loadAvatar(user('https://evil.example/a.png'), 'longibot', image())).toBeUndefined()
    expect(await loadAvatar(user('https://static-cdn.jtvnw.net/a.png'), 'longibot', image('text/html'))).toBeUndefined()
    expect(await loadAvatar(user('https://static-cdn.jtvnw.net/a.png'), 'longibot', image('image/png', 404))).toBeUndefined()
  })
})
