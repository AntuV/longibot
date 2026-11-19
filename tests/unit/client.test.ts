import { afterEach, expect, it, vi } from 'vitest'
import { getHealth } from '../../packages/contracts/src/client.js'
afterEach(() => vi.unstubAllGlobals())
it('uses same-origin health requests, optional cancellation and strict validation', async () => {
  const f = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ status: 'ok' })).mockResolvedValueOnce(Response.json({ status: 'ok' }))
  vi.stubGlobal('fetch', f)
  expect(await getHealth()).toEqual({ status: 'ok' })
  const signal = new AbortController().signal; expect(await getHealth(signal)).toEqual({ status: 'ok' }); expect(f.mock.calls[1]?.[1]?.signal).toBe(signal)
  f.mockResolvedValueOnce(Response.json({}, { status: 503 })); await expect(getHealth()).rejects.toThrow('consultar')
  for (const value of [null, 'bad', {}, { status: 'bad' }]) { f.mockResolvedValueOnce(Response.json(value)); await expect(getHealth()).rejects.toThrow('inválida') }
})
