import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
export const resolve = { alias: { '@': fileURLToPath(new URL('./apps/dashboard/src', import.meta.url)) } }
export const coverage = {
  provider: 'v8' as const,
  include: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
  // components/ui is vendored shadcn/ui source, regenerated through its CLI.
  exclude: ['**/generated.ts', '**/main.ts', '**/main.tsx', '**/schema.ts', 'apps/dashboard/src/components/ui/**', 'apps/dashboard/src/lib/utils.ts'],
  reporter: ['text', 'html', 'json-summary'] as ('text' | 'html' | 'json-summary')[]
}
export default defineConfig({ resolve, oxc: { jsx: { runtime: 'automatic' } }, test: { include: ['tests/unit/**/*.test.{ts,tsx}'], environment: 'node', coverage } })
