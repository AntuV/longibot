import type { paths } from './generated.js'

type HealthResponse = paths['/api/health/live']['get']['responses'][200]['content']['application/json']
export async function getHealth (signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health/live', { credentials: 'same-origin', ...(signal ? { signal } : {}) })
  if (!response.ok) throw new Error('No se pudo consultar el servicio')
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('status' in body) || body.status !== 'ok') throw new Error('Respuesta inválida del servicio')
  return { status: body.status }
}
