import { defineConfig } from 'vitest/config'
export const coverage = {
  provider: 'v8' as const,
  include: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
  exclude: ['**/generated.ts', '**/main.ts', '**/main.tsx', '**/schema.ts'],
  reporter: ['text', 'html', 'json-summary'] as ('text' | 'html' | 'json-summary')[]
}
export default defineConfig({ oxc: { jsx: { runtime: 'automatic' } }, test: { include: ['tests/unit/**/*.test.{ts,tsx}'], environment: 'node', coverage } })
