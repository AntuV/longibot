import { DatabaseSync, backup } from 'node:sqlite'
import { open, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { readConfig } from '../packages/core/src/config.js'
import { createDatabase } from '../packages/infrastructure/src/database.js'
import { Store } from '../packages/infrastructure/src/store.js'
import { applyLegacy, planLegacy } from '../packages/features/src/legacy.js'

const [source, mapping, ...flags] = process.argv.slice(2)
if (!source || !mapping || flags.some(f => f !== '--apply')) throw new Error('Uso: npm run import:legacy -- /ruta/data.db /ruta/identidades.json [--apply]. Identidades: {"login":"ID Twitch verificado"}')
const file = resolve(source)
const db = new DatabaseSync(file, { readOnly: true })
try {
  const identities = z.record(z.string().regex(/^[a-z0-9_]{1,25}$/), z.string().regex(/^\d+$/)).parse(JSON.parse(await readFile(mapping, 'utf8')))
  const questions = db.prepare('SELECT id,question,answers,times_sent FROM questions').all()
  const cooldowns = db.prepare('SELECT username,command,expiration FROM cooldowns WHERE command IN (\'historia\',\'historia-duo\')').all()
  const plan = planLegacy({ questions, cooldowns }, identities, Date.now())
  console.log(JSON.stringify({ apply: flags.includes('--apply'), questions: plan.questions.length, cooldowns: plan.cooldowns.length, unresolved: plan.unresolved, rejected: plan.rejected }))
  if (flags.includes('--apply')) {
    // The native backup API captures a consistent full SQLite image, including WAL.
    const backupPath = `${file}.backup-${Date.now()}.sqlite`
    await (await open(backupPath, 'wx', 0o600)).close()
    await backup(db, backupPath)
    const config = readConfig(); const { pool } = createDatabase(config.DATABASE_URL)
    try { await new Store(pool, config.TWITCH_CHANNEL).change(s => applyLegacy(s, plan), { userId: 'migration', action: 'legacy.import' }) } finally { await pool.end() }
    console.log('Importación completada; conservar backup SQLite y reconciliar identidades no resueltas.')
  }
} finally { db.close() }
