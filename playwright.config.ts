import { defineConfig, devices } from '@playwright/test'

const port = process.env.E2E_PORT ?? '3107'
const localUrl = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: process.env.E2E_BASE_URL ?? localUrl, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(process.env.E2E_BASE_URL ? {} : { webServer: { command: 'npm start', url: `${localUrl}/api/health/live`, reuseExistingServer: !process.env.CI, env: { PORT: port, NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost/longibot', APP_BASE_URL: localUrl } } })
})
