import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const files = ['packages/contracts/openapi.json', 'packages/contracts/src/generated.ts']
const previous = files.map(file => readFileSync(file, 'utf8'))
execFileSync('npm', ['run', 'contracts:generate'], { stdio: 'inherit' })
if (files.some((file, index) => readFileSync(file, 'utf8') !== previous[index])) {
  console.error('API contract changed. Run npm run contracts:generate and commit the generated files.')
  process.exitCode = 1
}
