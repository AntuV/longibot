#!/bin/sh
set -eu
# Run only against the disposable Compose project provisioned by CI/tests.
docker compose up -d --wait --wait-timeout 120
docker compose exec -T api node scripts/healthcheck.mjs api
docker compose exec -T worker node scripts/healthcheck.mjs worker
docker compose exec -T api node -e 'if (process.getuid() === 0) process.exit(1)'
docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
INSERT INTO runtime_metadata (key, value) VALUES ('container-smoke', '{"persisted":true}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
SQL
# Seed actual feature state and durable deliveries, not only a health marker.
docker compose exec -T api node --input-type=module <<'JS'
import { createDatabase } from './dist/packages/infrastructure/src/database.js'
import { Store } from './dist/packages/infrastructure/src/store.js'
const { pool } = createDatabase(process.env.DATABASE_URL)
try {
  const store = new Store(pool, 'persistence-smoke')
  await store.initialize('smoke-broadcaster')
  await store.change(s => { s.reminders.smoke = { id: 'smoke', text: 'survive redeploy', author: 'smoke', createdAt: Date.now(), status: 'waiting_next_game', attempts: 0 } })
  await store.ingest({ id: 'smoke-event', type: 'stream.started.v1', at: Date.now(), data: {} })
} finally { await pool.end() }
JS
# SIGTERM must drain worker jobs, close connections and exit without SIGKILL.
docker compose stop api worker
worker_id=$(docker compose ps -aq worker)
api_id=$(docker compose ps -aq api)
[ "$(docker inspect --format '{{.State.ExitCode}}' "$worker_id")" = 0 ]
api_exit=$(docker inspect --format '{{.State.ExitCode}}' "$api_id")
[ "$api_exit" = 0 ] || [ "$api_exit" = 143 ]
# Recreate processes and the database container without deleting the volume.
docker compose down
docker compose up -d --wait --wait-timeout 120
docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM runtime_metadata WHERE key = 'container-smoke' AND value = '{"persisted":true}'::jsonb) THEN RAISE EXCEPTION 'Persistence check failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM channel_state WHERE channel='persistence-smoke' AND data #>> '{reminders,smoke,text}'='survive redeploy') THEN RAISE EXCEPTION 'Reminder persistence failed'; END IF;
END $$;
SQL
backup_file=$(mktemp /tmp/longibot-smoke.XXXXXX)
trap 'rm -f "$backup_file"' EXIT
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_file"
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" longibot_restore_smoke'
docker compose exec -T postgres sh -c 'pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d longibot_restore_smoke' < "$backup_file"
docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d longibot_restore_smoke' <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM runtime_metadata WHERE key = 'container-smoke' AND value = '{"persisted":true}'::jsonb) THEN RAISE EXCEPTION 'Restore check failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM channel_state WHERE channel='persistence-smoke' AND data #>> '{reminders,smoke,text}'='survive redeploy') THEN RAISE EXCEPTION 'Reminder restore failed'; END IF;
  IF (SELECT count(*) FROM event_deliveries WHERE channel='persistence-smoke' AND event_id='smoke-event') <> 2 THEN RAISE EXCEPTION 'Durable delivery restore failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job') THEN RAISE EXCEPTION 'Missing pg-boss backup'; END IF;
END $$;
SQL
docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" longibot_restore_smoke'
docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
DELETE FROM runtime_metadata WHERE key = 'container-smoke';
DELETE FROM event_deliveries WHERE channel='persistence-smoke';
DELETE FROM event_inbox WHERE channel='persistence-smoke';
DELETE FROM channel_state WHERE channel='persistence-smoke';
SQL
printf '%s\n' 'Container health, non-root runtime, persistence and backup/restore passed.'
