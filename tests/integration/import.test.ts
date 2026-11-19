import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { expect, it } from 'vitest'
import { createDatabase } from '../../packages/infrastructure/src/database.js'
import { Store } from '../../packages/infrastructure/src/store.js'

it('backs up SQLite privately, previews and imports selectively/idempotently without touching the source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'longibot-import-'))
  const source = join(dir, 'data.db'); const map = join(dir, 'identities.json')
  const sqlite = new DatabaseSync(source)
  sqlite.exec('CREATE TABLE questions(id INT,question TEXT,answers TEXT,times_sent INT); CREATE TABLE cooldowns(username TEXT,command TEXT,expiration TEXT); CREATE TABLE config(key TEXT,value TEXT);')
  sqlite.prepare('INSERT INTO questions VALUES(?,?,?,?)').run(1, 'Question?', 'a;b', 3)
  sqlite.prepare('INSERT INTO cooldowns VALUES(?,?,?)').run('user', 'historia', new Date(Date.now() + 3600000).toISOString())
  sqlite.prepare('INSERT INTO config VALUES(?,?)').run('token', 'legacy-secret')
  sqlite.close(); await writeFile(map, '{"user":"123"}')
  const before = await readFile(source)
  const { pool } = createDatabase(process.env.DATABASE_URL!)
  const channel = `import_${Date.now()}`; const store = new Store(pool, channel)
  const run = (args: string[]) => promisify(execFile)(process.execPath, ['--experimental-sqlite', 'dist/scripts/import-legacy.js', ...args], { env: { ...process.env, TWITCH_CHANNEL: channel, NODE_ENV: 'test' } })
  try {
    await store.initialize('b')
    const dry = await run([source, map]); expect(dry.stdout).toContain('"apply":false'); expect((await store.read()).questions).toEqual({})
    await run([source, map, '--apply']); await run([source, map, '--apply'])
    const s = await store.read(); expect(Object.keys(s.questions)).toEqual(['legacy_1']); expect(s.questions.legacy_1?.used).toBe(3); expect(s.wins).toEqual({})
    expect(JSON.stringify(s)).not.toContain('legacy-secret'); expect(s.cooldowns['stories:actor:123']).toBeGreaterThan(Date.now())
    expect(await readFile(source)).toEqual(before)
    const backups = (await readdir(dir)).filter(f => f.includes('backup'))
    expect(backups).toHaveLength(2)
    for (const file of backups) { expect((await stat(join(dir, file))).mode & 0o777).toBe(0o600); const copy = new DatabaseSync(join(dir, file), { readOnly: true }); try { expect(copy.prepare('SELECT value FROM config').get()?.value).toBe('legacy-secret') } finally { copy.close() } }
    await expect(run([])).rejects.toThrow('Uso:')
  } finally { await pool.query('DELETE FROM channel_state WHERE channel=$1', [channel]); await pool.query('DELETE FROM admin_audit WHERE channel=$1', [channel]); await pool.end(); await rm(dir, { recursive: true, force: true }) }
})
