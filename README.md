# LongiBot

Bot de Twitch para un canal (`TWITCH_CHANNEL=longii_` por defecto), con dashboard para el streamer y moderadores actuales. Implementa las secciones vigentes 1–10 del [inventario funcional](docs/inventario-funcional.md). No contiene economía propia, apuestas propias, clips, TTS ni animé.

- EventSub firmado para chat, canjes, Bits/Power-ups, destacados, subs/regalos, follows, directo y predictions. Acciones de respuesta configurables desde el panel.
- Seguimiento LoL mediante Spectator-V5/Match-V5 y consulta `!lol <campeón>` de SoloQ con catálogo actualizado de Data Dragon.
- Prediction «¿Gana esta partida?» con Sí/No y recepción de 300 segundos. Resolución automática con resultado confirmado; remake confirmado cancela y reembolsa en Twitch. Respeta resoluciones manuales y conflictos.
- Recordatorios persistentes de mods: partida actual o próxima, recuperación tras caídas y revisión explícita de entregas inciertas.
- Trivia e historias apagadas inicialmente. Banco, rotación, rondas manuales/automáticas, cooldowns e historias individuales/dúo; premios exclusivamente en victorias por usuario. Sin timeouts reales.
- OAuth Twitch, sesiones opacas, revalidación de moderadores en cada solicitud administrativa, CSRF, tokens cifrados y auditoría.

## Desarrollo

Node **22.22.3**, npm **11.6.2**, PostgreSQL 17 y Docker Compose. Dependencias exactas en `package-lock.json`.

```sh
npm ci
cp .env.example .env
docker compose -f compose.dev.yaml up -d --wait
npm run build:server
npm run db:migrate
npm run dev
```

Dashboard: [localhost:5173](http://localhost:5173). API: [localhost:3000/api/health/live](http://localhost:3000/api/health/live). Vite usa proxy de `/api`; en producción Nest sirve el dashboard compilado bajo el mismo origen. Para OAuth en desarrollo registrar la URI del origen visible al navegador, por ejemplo `http://localhost:5173/api/auth/twitch/callback`, y usar ese mismo `APP_BASE_URL`.

Configurar la app Twitch, secreto EventSub, `TOKEN_ENCRYPTION_KEY` (32 bytes en base64) y clave Riot. Ingresar como streamer, conectar broadcaster y bot por separado, y guardar el Riot ID/plataforma/routing en Configuración. Los mods no pueden conectar identidades en nombre del streamer. El webhook requiere HTTPS público; en desarrollo se puede usar un túnel HTTPS y Twitch CLI con el mismo callback `/api/eventsub`.

```sh
openssl rand -base64 32
```

Guardar el resultado en `TOKEN_ENCRYPTION_KEY` del entorno, fuera de Git. Los tokens se cifran con AES-256-GCM; las sesiones usan identificadores aleatorios de 256 bits y solo se guarda su hash. No hay tokens en localStorage ni valores de secretos en el panel. `OWNER_TWITCH_USER_ID` es opcional y concede permisos de chat, sin acceso HTTP implícito.

## Verificación

```sh
npm run check
npm run db:check
DATABASE_URL=postgresql://longibot:longibot-local@localhost:5432/longibot npm run test:coverage
npx --no-install playwright install --with-deps chromium
npm run test:e2e
```

`check` ejecuta ESLint de JS/TS/TSX, tipos estrictos, unitarias/componentes, build y contratos OpenAPI. `test:coverage` agrega integración real con PostgreSQL: usar una base descartable migrada. El importador se prueba contra SQLite temporal y PostgreSQL; ejecutar `build:server` antes. Playwright necesita el dashboard compilado y arranca un servidor en el puerto 3107 (`E2E_PORT`/`E2E_BASE_URL` permiten override).

La cobertura incluye dominio, adaptadores, persistencia, OAuth, API, worker y componentes React. Solo se excluyen entradas de proceso/montaje, declaraciones de esquema Drizzle y código generado. El pipeline impone umbrales y publica los reportes. Ver [validación funcional y límites reales](docs/validacion-funcional.md).

## Arquitectura y extensión

- `apps/api`: Nest/Fastify, OAuth, API administrativa, webhook y SPA. Salud local independiente de Twitch/Riot.
- `apps/worker`: pg-boss, exclusión por canal, polling/reconciliación, entregas y retención.
- `apps/dashboard`: React, Router, TanStack Query y Tailwind; siete pantallas autenticadas.
- `packages/features`: reglas de negocio, comandos y consumidores registrados por módulo; flags y contratos compartidos del ciclo de partida.
- `packages/infrastructure`: PostgreSQL/Drizzle, cifrado, OAuth y adaptadores Twitch/Riot. Twurple administra los intercambios/refresh OAuth; HTTP Helix se encapsula detrás de puertos tipados.
- `packages/contracts`: OpenAPI y tipos generados. `npm run contracts:generate` actualiza los artefactos versionados.

Agregar una feature a la composición de `features` con comandos y consumidores propios. Predictions y recordatorios consumen el mismo ciclo; ninguno invoca al otro. Los eventos internos y externos usan un log durable común con entregas por consumidor. Estado y eventos salientes se confirman juntos, sin depender de un EventEmitter en memoria.

El agregado funcional de cada canal se guarda en `channel_state.data` como un documento versionado, serializado con advisory lock y transacción. Es una adaptación deliberada para la carga de un solo canal: permite confirmar estado y salidas atómicamente. Inbox, entregas/reintentos, sesiones, OAuth y auditoría son relacionales. Los módulos tienen sus datos separados dentro del agregado; no se han creado tablas económicas retiradas. Para una carga mayor se podrán extraer agregados a tablas sin cambiar los puertos de las features.

## Comandos

`!ayuda`, `!comandos` y `!lol <campeón>`. Los moderadores, el streamer y el propietario configurado pueden usar `!recordar <texto>`, `!recordar lista` y `!recordar quitar <id>`. Cuando se habilitan los módulos correspondientes, también están disponibles `!pregunta va` y `!pregunta saltear` para esos roles, y `!historia [@usuario]` para todo el chat. `!ayuda` y `!comandos` muestran los juegos habilitados. El bot ignora los comandos de juegos deshabilitados. La configuración se administra en el panel.

`!clip <título>` crea un clip del directo con la duración predeterminada de Twitch (30 segundos) y responde con el enlace público. Pueden usarlo el streamer y cualquier persona que siga el canal, desde el momento en que empieza a seguirlo. Ejemplo de uso en el chat `!clip La remontada imposible`. Si la cuenta del canal ya estaba conectada, el streamer debe reconectarla desde el panel para conceder el permiso `clips:edit`.

## Migración y operación

[Dokploy, backups, recuperación y checklist de conexión](docs/dokploy.md). [Importación selectiva del SQLite legado](docs/migracion.md). La base original no está en este checkout: no se importaron datos reales ni se reconstruyeron victorias antiguas.

Se revisaron y aplicaron las skills locales de Node, TypeScript, Fastify, Drizzle, OAuth, React, Neostandard y Modern Web Guidance. Se conserva tsc/tsx e imports `.js` para compatibilidad con Nest y el runtime compilado; no se reemplazó el stack existente por las alternativas genéricas de las skills. Drizzle Kit y su skill tienen revisión 15.

No se conectó un canal real, no se desplegó en Dokploy y no se publicaron cambios remotos. Las pruebas de OAuth/EventSub y acciones reales necesitan las credenciales y dominio de ese entorno.
