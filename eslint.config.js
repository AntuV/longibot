import neostandard from 'neostandard'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'

export default [
  { ignores: ['node_modules/**', 'dist/**', '**/dist/**', '.agents/**', '.claude/**', '.codex/**', '.github/skills/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'packages/contracts/src/generated.ts', 'apps/dashboard/src/components/ui/**', 'apps/dashboard/src/lib/utils.ts'] },
  ...neostandard({ ts: true }),
  { files: ['apps/dashboard/src/**/*.{ts,tsx}'], plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y }, rules: { ...reactHooks.configs.recommended.rules, ...jsxA11y.configs.recommended.rules } }
]
