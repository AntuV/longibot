import { defineConfig } from 'vitest/config'
import { coverage } from './vitest.config.js'
export default defineConfig({ oxc: { jsx: { runtime: 'automatic' } }, test: { include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.ts'], environment: 'node', fileParallelism: false, testTimeout: 30000, hookTimeout: 30000, coverage: { ...coverage, enabled: true, thresholds: { statements: 98, lines: 99, functions: 98, branches: 92 } } } })
