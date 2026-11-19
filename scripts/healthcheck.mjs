import { readFile } from 'node:fs/promises'

try {
  if (process.argv[2] === 'worker') {
    const heartbeat = Number(await readFile(process.env.WORKER_HEARTBEAT_PATH ?? '/tmp/longibot-worker-heartbeat', 'utf8'))
    if (!Number.isFinite(heartbeat) || Date.now() - heartbeat > 30000) process.exitCode = 1
  } else {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/api/health/ready`, { signal: AbortSignal.timeout(4000) })
    if (!response.ok) process.exitCode = 1
  }
} catch { process.exitCode = 1 }
