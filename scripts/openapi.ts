import { writeFile } from 'node:fs/promises'
import { createApp } from '../apps/api/src/app.js'

process.env.DATABASE_URL ??= 'postgresql://localhost/longibot'
const { app, document } = await createApp({ logging: false, staticFiles: false })
try {
  await writeFile('packages/contracts/openapi.json', JSON.stringify(document, null, 2) + '\n')
} finally { await app.close() }
