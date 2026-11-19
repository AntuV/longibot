# Implementación y validación funcional

Fecha local: **18 de noviembre de 2026**. Alcance: secciones 1–10 de [inventario-funcional.md](inventario-funcional.md), con resolución automática y cancelación por remake confirmadas durante esta implementación. El scaffold y cambios previos sin commit se conservaron; `longibot-old` no se modificó.

## Resultado local

| Comprobación | Resultado |
|---|---|
| `npm run check` | ESLint sin warnings, TypeScript estricto, 79 unitarias/componentes, build de backend/dashboard y contratos sin deriva |
| `npm run test:coverage` con PostgreSQL 17 real | **104 pruebas**, 11 archivos, todas pasan |
| `npm run test:e2e` | **3 recorridos Chromium**, todos pasan; login público protegido, rutas, navegación, alta de recordatorio, móvil y escritorio |
| Drizzle | Migraciones generadas, aplicadas y reaplicadas; `db:check` OK |
| Docker | `npm ci` limpio y build multi-stage de API/worker/migrate OK; runtime sin privilegios |
| Compose | Arranque/healthchecks, SIGTERM, recreación sin borrar volumen y backup/restauración en base nueva OK |
| SQLite legado | Fixture temporal: preview, backup 0600, importación selectiva e idempotente y original sin cambios |
| Higiene | `git diff --check` del código propio y sintaxis shell OK; las skills de terceros se conservan sin reformatear; sin secretos nuevos ni modificaciones remotas |

La prueba de Compose usó el proyecto/volumen descartable `longibot-features-smoke-20261118`, separado del PostgreSQL de desarrollo y de otros servicios Docker. Persistió y restauró un recordatorio real del agregado funcional y dos entregas durables, además de pg-boss y metadatos. No se emplearon credenciales Twitch/Riot durante esa prueba.

## Cobertura V8

| Métrica | Cubierta | Umbral de CI |
|---|---:|---:|
| Líneas | **99,45%** (907/912) | 99% |
| Sentencias | **98,50%** (1319/1339) | 98% |
| Funciones | **98,44%** (317/322) | 98% |
| Ramas | **93,02%** (987/1061) | 92% |

Dominio de features, API, worker y adaptadores tienen 100% de líneas; el dashboard tiene 95,74% en conjunto. No se afirma 100% de ramas: quedan combinaciones de estados visuales/errores y defensas de infraestructura sin ejercitar.

Se instrumentan `apps/*/src` y `packages/*/src`, incluidos React, OAuth, adaptadores HTTP, transacciones y worker. Exclusiones explícitas: entradas de proceso/montaje (`main.ts`/`main.tsx`), declaraciones del esquema Drizzle y tipos generados. Las entradas se verifican ejecutando procesos/Playwright/contenedores; las migraciones se verifican en PostgreSQL. El script de importación se ejecuta como proceso contra SQLite/PostgreSQL, y sus reglas están instrumentadas en `features/legacy.ts`.

Reporte HTML local: `coverage/index.html`; resumen reproducible: `coverage/coverage-summary.json`. CI ejecuta la cobertura combinada tras migrar y publica los artefactos. Los tests locales no necesitan credenciales externas.

## Casos funcionales cubiertos

| Área | Evidencia automatizada |
|---|---|
| Canal/configuración | Default `longii_`, override normalizado, rechazo de valores inválidos y origen con path/credenciales, aislamiento por canal y rechazo de cambio de ID inesperado antes de efectos |
| OAuth/sesiones | State vinculado al navegador, un solo uso/expiración, scopes, rotación y hash de sesión, logout, cookies HttpOnly, revalidación de mods y denegación ante revocación/fallo |
| CSRF/permisos | Endpoints directos sin sesión, origen ajeno y CSRF faltante rechazados; solo streamer inicia conexión de bot/broadcaster; usuario ajeno no obtiene sesión administrativa |
| Tokens | Cifrado autenticado, rechazo de alteraciones, persistencia y exclusión de refresh concurrente con renovación del refresh token |
| EventSub | Firma sobre bytes originales, antigüedad/challenge/revocación, canal, duplicados concurrentes, anonimato, todas las señales solicitadas y fuente principal de destacados/regalos |
| Modularidad/durabilidad | Registro extensible de comandos y consumidores; cada consumidor recibe su entrega, transacción de estado/salida, rollback sin cambios parciales y reintento sin bloquear a otros consumidores |
| Partidas | Inicio único, Spectator ausente conserva desconocido, resultados confirmados, fin separado de ganador, reconciliación al reiniciar, resultado tardío y partida previa que termina después de observar la siguiente |
| Predictions | Una intención por partida, ventana de 300 segundos, conflictos con ajenas, colas/antigüedad/flags, respuesta incierta sin recreación, consulta por ID, bloqueo distinto de resolución y prioridad de estados terminales manuales |
| Resolución/remake | Victoria → primera opción; derrota → segunda; remake confirmado → cancelación en Twitch; juego corto ambiguo no inventa ganador ni remake |
| Recordatorios | Partida actual/próxima, estado desconocido al encolar, fin fuera de orden, caída durante partida y partida completa perdida durante caída; recuperación por timestamps sin nuevas predictions históricas |
| Entrega de chat | Claim persistido, orden, IDs externos, rechazo inequívoco recuperable, crash/respuesta incierta sin reenvío ciego, revisión administrativa y mensajes del propio bot ignorados |
| Trivia | Apagada por defecto, banco vacío, alternativas, rotación menos usadas, exclusión de rondas, primera respuesta ganadora, expiración, avisos 30/60/90s y reloj de respuesta desde envío confirmado |
| Historias | Apagadas por defecto, individual/dúo, piratas/ranked, cooldown global/ejecutor/invitado, ambos ganadores y resultados idempotentes sin moneda ni timeouts |
| Flags/victorias | Deshabilitar cancela rondas/tareas pendientes y vuelve a verificar el flag antes del efecto; una victoria por juego/resultado/usuario; importación no crea victorias antiguas |
| Dashboard | Siete pantallas, formularios y errores accesibles, operaciones/auditoría, banco CRUD, controles de prediction, flags, configuración Riot y revisión de entregas inciertas |
| Operación | Exclusión de workers, heartbeat local, reconciliación de suscripciones, presupuesto/backoff Riot, retención, cierre ordenado y backup/restauración |

Los tests de HTTP usan Fastify real, sesiones y estado PostgreSQL reales. Las respuestas de Twitch/Riot se simulan de forma controlada; el login y roles no dependen de flags de localStorage. Los tests de componentes y el recorrido administrativo del navegador simulan las respuestas HTTP, mientras la seguridad de esos endpoints se prueba aparte con PostgreSQL.

## Políticas y adaptaciones

- Predictions predeterminadas: «¿Gana esta partida?» / «Sí» / «No», 300 segundos, resolución automática habilitada. Un remake confirmado se cancela/reembolsa. Se conserva control administrativo y se respeta lo resuelto manualmente en Twitch.
- El seguimiento intenta todas las colas detectables; `!lol` conserva SoloQ. La lista de colas de configuración filtra la elegibilidad de predictions; todos los consumidores comparten identidad/ciclo de partida. `onlyLive=false` por defecto.
- No se abren predictions históricas ni tardías. Una creación incierta requiere vincular el ID verificado; no se deduce propiedad por coincidencia de texto.
- La historia consultada para reconstruir la primera partida siguiente debe ser completa. Si se trunca a 20 partidas y no puede probarse el destino, queda una alerta/revisión, sin asignación arbitraria. Los eventos tardíos se comparan por identidad y tiempo.
- Se conserva trivia/historias con flags apagados. No hay timeouts reales ni sanciones implícitas para el invitado. Cada ganador suma una victoria; no se conservó ninguna economía.
- El estado funcional usa un agregado JSON versionado por canal bajo transacción/exclusión. Inbox y outbox comparten el log durable; las entregas, intentos, sesiones, OAuth y auditoría son relacionales. El diseño y su motivo se explican en el README.
- Twurple se usa para OAuth/intercambio/refresh; Helix y EventSub están encapsulados en adaptadores HTTP tipados y normalizadores independientes del dominio.

## Skills aplicadas

Se revisaron las skills instaladas en `.agents/skills`, sin instalar paquetes de skills nuevos ni delegar trabajo a otros agentes.

| Skill | Aplicación |
|---|---|
| `node`, `typescript-magician` | Imports/type-only, tipos estrictos, errores sin secretos, liberación de conexiones y cierre ordenado |
| `fastify-best-practices` | Plugins encapsulados bajo Nest, schemas de entrada, límites de cuerpo, cookies/headers y pruebas con `inject` |
| `drizzle` | Revisión 15 vigente en Kit y skill; esquema, migraciones versionadas y verificación sobre PostgreSQL |
| `oauth` | Flujo Authorization Code de cliente confidencial Twitch, state de un solo uso, sesiones opacas, renovación y permisos por solicitud |
| `vercel-react-best-practices` | Consultas con TanStack Query, cancelación/deduplicación, datos mínimos por pantalla, componentes estables y mutaciones con invalidación |
| `linting-neostandard-eslint9` | Lint JS/TS/TSX y scripts, hooks React y accesibilidad; sin warnings permitidos |
| `modern-web-guidance` / `forms` | Formularios nativos con labels/fieldset, validación tras interacción, resultados anunciados, foco visible y controles de 48px; min-width de fieldsets corregido y validado en móvil |

Se mantuvo tsc/tsx y los imports `.js` del scaffold para compatibilidad con Nest y la imagen compilada, adaptando las recomendaciones genéricas de ejecución TypeScript de Node/Fastify.

## Validaciones externas pendientes

No hay `data.db` real, credenciales ni acceso a Dokploy en esta tarea. Por eso **no se afirma operación real del canal ni despliegue completo**. Antes de producción faltan OAuth/refresh/revocación reales, scopes y elegibilidad del canal, entrega EventSub HTTPS, chat/eventos reales, cobertura de las modalidades Riot, una prediction real con resolución/cancelación autorizadas, persistencia/restauración del entorno Dokploy y revisión de las identidades de la migración.

La base actual de reglas es implementable y verificable localmente; esa evidencia no reemplaza las pruebas externas. Instrucciones: [Dokploy](dokploy.md), [migración](migracion.md), [README](../README.md).

Referencias primarias consultadas: [firmas y recepción EventSub](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/), [validación OAuth](https://dev.twitch.tv/docs/authentication/validate-tokens/), [predictions Helix](https://dev.twitch.tv/docs/api/reference/predictions/), [canjes automáticos V2](https://dev.twitch.tv/docs/eventsub/reference/channel-points/), [aclaración de Riot sobre `gameEndedInEarlySurrender`](https://github.com/RiotGames/developer-relations/issues/818).
