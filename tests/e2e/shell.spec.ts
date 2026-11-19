import { expect, test } from '@playwright/test'
import { initialState } from '../../packages/features/src/model.js'

test('serves the compiled login and protects administration on the same origin', async ({ page, request }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('LongiBot')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu canal, en orden.')
  await expect(page.getByRole('link', { name: 'Ingresar con Twitch' })).toHaveAttribute('href', '/api/auth/twitch')
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  expect((await request.get('/api/admin/state')).ok()).toBe(false)
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('deep links use the SPA while unknown API routes stay 404', async ({ page, request }) => {
  await page.goto('/missing')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Página no encontrada')
  expect((await request.get('/api/missing')).status()).toBe(404)
})

test('navigates every administrative screen, submits a reminder and works on mobile', async ({ page }) => {
  const state = initialState()
  const user = { userId: 'b', name: 'Streamer', csrf: 'csrf', streamer: true, botManager: true, admin: true, channel: 'longii_' }
  const writes: unknown[] = []
  await page.route('**/api/auth/me', route => route.fulfill({ json: user }))
  await page.route('**/api/admin/state', route => route.fulfill({ json: { channel: 'longii_', broadcasterId: 'b', state } }))
  await page.route('**/api/admin/operations', route => route.fulfill({ json: { audit: [], events: [], deliveries: [], connections: [], failedJobs: [], worker: null } }))
  await page.route('**/api/admin/reminders', async route => {
    expect(route.request().headers()['x-csrf-token']).toBe('csrf')
    const body = route.request().postDataJSON() as { text: string }; writes.push(body)
    state.reminders.r = { id: 'r', text: body.text, author: 'Streamer', createdAt: Date.now(), status: 'waiting_next_game', attempts: 0 }
    await route.fulfill({ json: state.reminders.r })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Hola, Streamer' })).toBeVisible()
  await page.getByRole('link', { name: 'Recordatorios', exact: true }).click()
  await page.getByLabel('Texto del recordatorio').fill('Revisar la próxima partida')
  await page.getByRole('button', { name: 'Agregar recordatorio', exact: true }).click()
  await expect(page.getByText('Cambios guardados.')).toBeVisible()
  await expect(page.getByText('Revisar la próxima partida', { exact: true })).toBeVisible()
  expect(writes).toEqual([{ text: 'Revisar la próxima partida' }])
  for (const name of ['Predictions', 'Eventos y acciones', 'Configuración', 'Trivia e historias', 'Operación']) {
    await page.getByRole('link', { name, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'Más' }).click()
  await page.getByRole('link', { name: 'Configuración', exact: true }).click()
  await expect(page.getByLabel('Resolver automáticamente; cancelar remakes')).toBeChecked()
  await expect(page.getByLabel('Trivia', { exact: true })).not.toBeChecked()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.getByRole('link', { name: 'Resumen', exact: true }).click()
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true })
})
