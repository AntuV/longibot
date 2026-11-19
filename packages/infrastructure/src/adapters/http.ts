export class ProviderError extends Error {
  constructor (readonly status: number, readonly retryAfter = 0) { super(`Provider request failed (${status})`) }
}
export class Http {
  private next = new Map<string, number>()
  constructor (readonly fetcher: typeof fetch = fetch, readonly now = Date.now) {}
  async request (url: string, init: RequestInit = {}): Promise<unknown> {
    const host = new URL(url).host
    const until = this.next.get(host) ?? 0
    if (this.now() < until) throw new ProviderError(429, until - this.now())
    let response: Response
    try { response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(10_000) }) } catch { throw new ProviderError(0) }
    if (!response.ok) {
      const raw = response.headers.get('retry-after')
      const retry = raw ? (Number.isFinite(Number(raw)) ? Number(raw) * 1000 : Date.parse(raw) - this.now()) : 0
      const reset = Number(response.headers.get('ratelimit-reset')) * 1000 - this.now()
      const backoff = response.status === 429 ? Math.max(1000, Number.isFinite(retry) ? retry : 0, Number.isFinite(reset) ? reset : 0) : 0
      if (backoff) this.next.set(host, this.now() + backoff)
      throw new ProviderError(response.status, backoff)
    }
    if (response.status === 204) return null
    return response.json() as Promise<unknown>
  }
}
