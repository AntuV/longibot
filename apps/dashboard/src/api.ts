import type { State } from '../../../packages/features/src/model.js'
export interface User { userId: string, name: string, csrf: string, admin: true, streamer: boolean, botManager: boolean, channel: string }
export interface Snapshot { channel: string, broadcasterId: string, state: State }
export interface Operations { failedJobs?: { id: string, name: string, retry_count: number, created_on: string }[], audit: { user_id: string, action: string, at: string }[], events: { data: { id: string, type: string, at: number }, received_at: string }[], deliveries: { event_id: string, consumer: string, completed_at: string | null, attempts?: number, last_error?: string | null }[], connections: { purpose: string, user_id: string, updated_at: string }[], worker: { at: number } | null }
export class ApiError extends Error { constructor (readonly status: number, text: string) { super(text) } }
export async function api<T> (path: string, options: { method?: string, data?: unknown, csrf?: string, signal?: AbortSignal } = {}): Promise<T> {
  const result = await fetch(`/api/${path}`, { credentials: 'same-origin', method: options.method ?? 'GET', headers: { 'Content-Type': 'application/json', ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}) }, ...(options.data !== undefined ? { body: JSON.stringify(options.data) } : {}), ...(options.signal ? { signal: options.signal } : {}) })
  if (!result.ok) { const error = await result.json().catch(() => ({})) as { message?: string }; throw new ApiError(result.status, error.message ?? 'No se pudo completar la operación') }
  return result.status === 204 ? undefined as T : result.json() as Promise<T>
}
