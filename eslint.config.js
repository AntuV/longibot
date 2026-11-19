import neostandard from 'neostandard'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'

export default [
  { ignores: ['node_modules/**', 'dist/**', '**/dist/**', '.agents/**', '.claude/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'packages/contracts/src/generated.ts'] },
  ...neostandard({ ts: true }),
  { files: ['apps/dashboard/src/**/*.{ts,tsx}'], plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y }, rules: { ...reactHooks.configs.recommended.rules, ...jsxA11y.configs.recommended.rules } }
]
