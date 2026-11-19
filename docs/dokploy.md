# Instalación y operación en Dokploy

## Instalación

1. Crear servicio Docker Compose con este repositorio y `compose.yaml`. Configurar build de una única imagen de aplicación (API, worker y migrate usan `APP_IMAGE`, por defecto `longibot:local`). Mantener una instancia de API y worker inicialmente.
2. Configurar entorno explícito en Dokploy. `NODE_ENV=production`, `APP_BASE_URL=https://bot.example.com`, `POSTGRES_PASSWORD` aleatoria y `DATABASE_URL=postgresql://longibot:<password-url-encoded>@postgres:5432/longibot`. Usuario/base deben coincidir con `POSTGRES_USER`/`POSTGRES_DB`. `.env.example` es solo desarrollo: no copiar su contraseña a producción.
3. Definir `POSTGRES_VOLUME_NAME=longibot-postgres` y conservarlo entre redeploys. Cada entorno debe usar un nombre diferente. PostgreSQL no expone puertos de host. `backend` permite salida a Internet para Twitch/Riot, pero no tiene puertos entrantes publicados.
4. Asignar dominio al servicio `api`, puerto de contenedor 3000, HTTPS en el proxy de Dokploy. El dashboard y `/api` comparten origen. Worker no recibe tráfico público. No ejecutar esta imagen mediante Vite.
5. Compose espera PostgreSQL sano y luego ejecuta `migrate` antes de iniciar API/worker. El runner usa un advisory lock de PostgreSQL para serializar migraciones. pg-boss administra su esquema al arrancar. No ejecutar múltiples releases incompatibles simultáneamente.
6. Registrar la aplicación en Twitch con `TWITCH_REDIRECT_URI=https://bot.example.com/api/auth/twitch/callback`. Configurar `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_EVENTSUB_SECRET` ASCII de 10–100 caracteres, `TOKEN_ENCRYPTION_KEY` de 32 bytes en base64 y `RIOT_API_KEY`. La cuenta del bot se configura por entorno: en https://twitchtokengenerator.com, logueado como la cuenta del bot y con el scope `user:write:chat`, generar el token y copiar `BOT_TWITCH_ACCESS_TOKEN`, `BOT_TWITCH_REFRESH_TOKEN` y `BOT_TWITCH_CLIENT_ID`. El worker los valida, los renueva solo y guarda la versión renovada cifrada; cambiar las variables reemplaza la cuenta guardada. `APP_BASE_URL` debe ser el origen HTTPS, sin path/query/credenciales.
7. Verificar healthchecks y `/api/health/ready`. Ingresar con Twitch como streamer, conectar la cuenta del canal en Resumen (incluye `user:read:chat`: el chat se lee con la identidad del canal). El worker valida las identidades/tokens y crea/reconcilia las suscripciones hacia `/api/eventsub`; el dominio debe recibir HTTPS público en 443 sin redirecciones del callback.
8. Guardar Riot ID, plataforma y routing regional. Verificar el canal resuelto, directo, primera partida, predictions de 300 segundos y recordatorios. El worker verifica al arrancar y cada hora que el login siga correspondiendo al ID fijado; si cambió, detiene efectos hasta reconciliarlo explícitamente.
9. Mantener trivia e historias apagadas hasta revisar su banco/configuración. Las historias no ejecutan timeouts reales. Las predictions se resuelven automáticamente con victoria/derrota confirmada y se cancelan ante remake confirmado; resultados ambiguos quedan para revisión.

En local, para probar la topología de producción sin proxy, agregar temporalmente un override que publique solo API en `127.0.0.1:3000:3000`; `APP_BASE_URL` sigue siendo una URL HTTPS documental en el smoke test. No se está validando TLS de Dokploy de esta forma.

## Actualizaciones y migraciones

Respaldar la base antes del cambio. Revisar SQL generado y compatibilidad con los procesos anteriores. Fijar commit/tag de la imagen y desplegar. No cambiar el nombre del volumen, no usar `docker compose down -v`, no borrar datos para corregir una migración. Las migraciones son forward-only; un rollback de imagen solo es seguro si el esquema es compatible. Para migraciones incompatibles, detener procesos, respaldar, migrar y arrancar coordinadamente.

GitHub Actions solo corre las pruebas; no publica imágenes. Construir la imagen desde Git en Dokploy. No conectar auto-deploy directamente al push si se requiere esperar los checks de GitHub.

Los logs se escriben en stdout en JSON. Configurar rotación/retención en Docker/Dokploy para evitar crecimiento ilimitado. Los healthchecks no consultan Twitch/Riot: una caída externa no provoca reinicios locales. Se retienen eventos completados y mensajes enviados 30 días; eventos pendientes, resultados de victorias, juegos y auditoría se conservan para recuperación/deduplicación. Los jobs completados/fallidos de pg-boss tienen retención de 24 horas; el panel muestra errores y entregas por consumidor con intentos/reintentos. Configurar backups diarios y retención externa conforme a la operación del canal.

## Secrets

Inyectar secretos reales desde Dokploy, nunca mediante build args ni dentro de la imagen. Preservar `TOKEN_ENCRYPTION_KEY` separada de PostgreSQL y con backup cifrado externo antes de guardar tokens renovables. No publicar DB URLs, claves o tokens en logs. `TWITCH_CHANNEL` es configuración de despliegue: cambiarlo requiere reiniciar y conectar explícitamente las identidades del nuevo canal. No trasladar tokens ni datos entre canales.

## Backup y restauración

Ejecutar desde el proyecto Compose correcto. El dump incluye datos y esquema, incluyendo pg-boss y migraciones. Guardar en almacenamiento externo cifrado con política de retención; respaldar secretos por separado.

```sh
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > longibot.dump
```

Ensayar siempre en una base **nueva y vacía**, sin API/worker apuntando a ella. No ejecutar restore encima de producción como prueba.

```sh
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" longibot_restore_test'
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d longibot_restore_test --no-owner --no-privileges --exit-on-error' < longibot.dump
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d longibot_restore_test -c "SELECT count(*) FROM runtime_metadata"'
```

Comparar conteos, datos de control y esquema de migraciones en origen/restaurada. Probar inicio y lectura de una instancia aislada sin credenciales externas; los jobs restaurados requieren reconciliar efectos inciertos antes de activar integraciones. Eliminar la base de ensayo únicamente al terminar. Recuperación real: detener procesos, restaurar en una DB nueva, verificar, cambiar `DATABASE_URL`, reponer clave de cifrado y arrancar una instancia coordinada de cada proceso.

Las pruebas locales de infraestructura no acreditan operación en Dokploy ni OAuth/EventSub/acciones Twitch/Riot. Se deben completar en el dominio/credenciales reales antes de dar por validado el despliegue.


## Incertidumbre y recuperación

El bot no promete entrega exactamente una vez a una API externa. Un recordatorio cuyo envío terminó sin respuesta queda en `delivery_unknown`; en Operación, verificar el chat y marcarlo enviado o autorizar el reenvío. Un rechazo inequívoco de Twitch conserva el mensaje pendiente. Nunca borrar filas para forzar reintentos.

Una creación de prediction con respuesta incierta queda en `creation_unknown`: verificar la prediction existente en Twitch y vincular su ID desde el panel. No se crea otra a ciegas. Las operaciones posteriores consultan Twitch, incluso por ID si el vínculo ya no figura en la última página, y respetan estados terminales manuales. Los conflictos con predictions ajenas no las cancelan.

Spectator ausente no confirma fin. Match-V5 confirma fin y resultado separadamente: un fin confirmado entrega recordatorios aunque el ganador sea desconocido. `gameEndedInEarlySurrender` identifica un remake; el bot cancela la prediction y Twitch gestiona el reembolso. Una partida corta sin esa señal no se convierte automáticamente en remake ni en ganador.

Los recordatorios conservan intención y timestamp cuando Riot falla. Se recuperan la partida activa y partidas terminadas durante una caída; los resultados históricos no abren predictions nuevas. Para elegir la primera partida después de encolar se exige historia completa en la ventana consultada. Si hay 20 o más partidas y no puede probarse cuál era la próxima, el bot conserva el ítem y registra la necesidad de revisión: no asigna arbitrariamente una más reciente. Cancelar/volver a encolar desde el panel solo tras revisar el destino deseado.

Cada consumidor tiene su propia entrega transaccional, con backoff de 30 segundos ante fallo de reducción. Las integraciones usan presupuestos/límites y `Retry-After`; una falla de predictions no impide recordatorios. Los envíos se espacian mediante el pulso de worker (un mensaje cada aproximadamente 2 segundos). Mantener inicialmente una réplica de cada proceso; la exclusión en PostgreSQL protege solapamientos de despliegues.

## Comprobación real de aceptación

Antes de habilitar producción: login streamer/mod, rechazo de un tercero y mod revocado; renovación/revocación OAuth; challenge y reentrega EventSub con HTTPS; Bits, canjes, destacados, subs/regalos/follows; inicio y fin real de las modalidades elegidas; prediction única, bloqueo y resolución automática, remake/cancelación y cambios manuales; recordatorios actuales/siguientes y recuperación tras reinicio. Verificar elegibilidad del canal y scopes otorgados. Registrar esa evidencia en la validación del entorno; los fixtures automatizados no certifican acceso a servicios reales.
