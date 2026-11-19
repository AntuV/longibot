# Stack tecnológico de LongiBot

Fecha: **18 de noviembre de 2026**. Alcance funcional: [inventario-funcional.md](inventario-funcional.md), secciones vigentes; el anexo describe el legado.

Diseño del stack. La implementación y sus adaptaciones/evidencia local se detallan en [validacion-funcional.md](validacion-funcional.md). El despliegue en Dokploy y las integraciones reales todavía necesitan validación del entorno.

## 1. Requisitos que gobiernan la elección

- Bot de Twitch para un canal configurado por entorno: **`TWITCH_CHANNEL=longii_` por defecto**.
- Dashboard obligatorio, autenticado con Twitch y gestionable por el streamer y los moderadores actuales de ese canal.
- Eventos de chat, canjes, Bits/Power-ups, subs, regalos y follows.
- Seguimiento de partidas de LoL, predictions automáticas de cinco minutos y recordatorios al finalizar la partida correspondiente.
- Trivia e historias conservadas pero apagadas al inicio; premios limitados a contadores de victorias.
- Features independientes y extensibles; tareas y estado recuperables después de reinicios.
- Docker y despliegue en Dokploy. Sin economía propia, apuestas propias, clips, TTS ni animé.

## 2. Stack elegido para el diseño

| Capa | Tecnología | Responsabilidad |
|---|---|---|
| Lenguaje | TypeScript estricto | Backend, worker, dashboard y contratos compartidos |
| Runtime | Node.js LTS soportado | API y procesos permanentes |
| Backend | NestJS + Fastify | HTTP, OAuth, permisos, módulos y entrada EventSub |
| Dashboard | React + Vite | SPA de administración obligatoria |
| Navegación y datos | React Router + TanStack Query | Rutas, caché, formularios y sincronización con la API |
| Estilos | Tailwind CSS | Interfaz administrativa consistente |
| Base de datos | PostgreSQL | Estado funcional, sesiones, tokens, eventos y auditoría |
| Acceso a datos | Drizzle ORM + migraciones versionadas | Consultas tipadas, transacciones y restricciones |
| Jobs | pg-boss sobre PostgreSQL | Scheduler persistente, ejecución diferida y reintentos |
| Twitch | EventSub + Helix mediante adaptadores Twurple | Chat, eventos, OAuth y acciones nativas |
| Riot | Cliente HTTP tipado propio | Spectator/Match, identidad PUUID y control de límites |
| Contratos HTTP | OpenAPI del backend + cliente tipado generado | Evitar divergencias entre dashboard y API |
| Logs | JSON estructurado a stdout, con redacción de secretos | Operación desde Dokploy y trazabilidad |
| Pruebas | Vitest, integración con PostgreSQL y Playwright | Dominio, persistencia, OAuth/permisos y recorridos del dashboard |
| Distribución | Docker multi-stage + Docker Compose | Despliegue reproducible en Dokploy |

Fijar versiones estables compatibles y lockfile al implementar. No se necesita Redis inicialmente: PostgreSQL aloja la persistencia y pg-boss. Socket.IO no es necesario; usar polling configurable con TanStack Query para el estado operativo inicial. Si se necesita actualización inmediata, incorporar SSE autenticado detrás de un contrato de notificaciones sin cambiar las features.

Referencias técnicas: [NestJS/Fastify](https://docs.nestjs.com/techniques/performance), [Drizzle](https://orm.drizzle.team/docs/transactions), [pg-boss](https://github.com/timgit/pg-boss), [Twurple](https://twurple.js.org/docs/getting-data/eventsub/listener-setup.html).

## 3. Dashboard y autenticación

### Identidad y sesión

1. El navegador inicia login de Twitch en el backend.
2. El backend usa OAuth Authorization Code, valida `state` de un solo uso vinculado a la sesión y canjea el código desde el servidor con redirect URI registrada.
3. Obtiene y valida la identidad por ID de Twitch; verifica acceso al canal configurado.
4. Crea una sesión opaca almacenada en PostgreSQL. El navegador recibe solo una cookie `HttpOnly`, `Secure` en producción y `SameSite=Lax`; los tokens de Twitch permanecen en el backend.
5. Logout, expiración o revocación invalidan la sesión. Validar tokens al iniciar y al menos cada hora, además de reaccionar a respuestas 401.

Proteger mutaciones contra CSRF y verificar permisos en cada endpoint; ocultar un botón no concede ni revoca autorización. Servir dashboard y API bajo el mismo dominio para simplificar cookies y política de origen. No almacenar tokens en `localStorage`.

Referencia: [OAuth Authorization Code](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow), [validación de tokens](https://dev.twitch.tv/docs/authentication/validate-tokens/).

### Autorización del streamer y los mods

- **Streamer:** `user.id` coincide con el ID estable resuelto para `TWITCH_CHANNEL`.
- **Moderador:** comprobar con su token y `user:read:moderated_channels` que el canal figura en `Get Moderated Channels`, recorriendo páginas si es necesario. Este endpoint no incluye el canal propio, por lo que la comprobación del streamer es independiente.
- **Resto:** denegar acceso administrativo, aunque haya completado correctamente el login.
- Revalidar el rol en operaciones administrativas con caché breve propuesta de hasta 60 segundos; ante caducidad sin poder verificarlo, denegar la mutación. La pérdida de moderación no debe conservar acceso indefinidamente.
- El propietario técnico legado no tiene acceso implícito al dashboard: debe ser streamer o mod del canal. Los roles del chat no se aceptan como prueba de acceso HTTP.

Referencia: [Get Moderated Channels](https://dev.twitch.tv/docs/api/reference/moderation#get-moderated-channels).

| Operación | Streamer | Mod actual |
|---|---|---|
| Ver estado, partidas, eventos y tareas | Sí | Sí |
| Gestionar recordatorios y predictions del bot | Sí | Sí |
| Configurar acciones de eventos y features | Sí | Sí |
| Gestionar banco de trivia y consultar victorias | Sí | Sí |
| Habilitar trivia/historias cuando su política esté definida | Sí | Sí |
| Conectar/reautorizar la cuenta broadcaster | Sí, autorizando su propia cuenta | No puede autorizar en nombre del streamer |
| Leer valores de secretos o cambiar canal desde el dashboard | No | No |

Las operaciones de un mod sobre predictions se ejecutan desde el backend con la autorización ya otorgada por el broadcaster. El login del mod no concede los scopes del streamer. Separar conexiones OAuth de usuario del dashboard, broadcaster y bot; solicitar únicamente los scopes de cada función.

### Pantallas incluidas

- **Resumen:** canal, directo, partida, prediction y salud de integraciones/worker.
- **Recordatorios:** alta, listado, cancelación y estado de entrega; compartir casos de uso con el comando del chat.
- **Predictions:** vínculo a partida, estado, historial y controles operativos definidos en el inventario.
- **Eventos y acciones:** canjes, Bits/Power-ups, subs/regalos/follows, reglas configurables y errores de procesamiento.
- **Features:** estado habilitado/deshabilitado y configuración validada. Trivia/historias apagadas por defecto.
- **Trivia e historias:** banco de preguntas, parámetros y contadores por usuario; administrar datos no activa los juegos.
- **Operación y auditoría:** trabajos fallidos, intentos, acciones de administradores y estado de autorizaciones, sin exponer tokens.

## 4. Canal y configuración por entorno

`TWITCH_CHANNEL` es la fuente de verdad del canal objetivo y su valor predeterminado es `longii_`. El backend normaliza espacios y mayúsculas, valida el login y resuelve su ID usando Twitch. Un valor vacío o inválido explícito debe producir un error de configuración; no seleccionar otro canal silenciosamente.

El frontend obtiene el canal y sus capacidades de la API; no usa una variable `VITE_*` como autoridad. El canal no se cambia mediante chat, dashboard ni parámetros de una solicitud. Un despliegue administra un canal; multicanal queda fuera del alcance inicial.

Guardar relaciones y permisos por ID estable. Cambiar la variable requiere reinicio/redeploy y reconciliar suscripciones/autorizaciones para el nuevo canal, manteniendo los datos anteriores aislados y sin trasladar recordatorios o tokens entre canales. Si un login resuelve inesperadamente a otro ID, requerir reconciliación explícita antes de ejecutar acciones.

Ejemplo documental para el futuro `.env.example`:

```dotenv
NODE_ENV=production
PORT=3000
TWITCH_CHANNEL=longii_
APP_BASE_URL=https://bot.example.com
TWITCH_REDIRECT_URI=https://bot.example.com/api/auth/twitch/callback
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_EVENTSUB_SECRET=
DATABASE_URL=
TOKEN_ENCRYPTION_KEY=
RIOT_API_KEY=
LOG_LEVEL=info
```

Los valores vacíos son placeholders, no una configuración operativa. Secrets reales se inyectan desde Dokploy; no se suben al repositorio. Tokens renovables se guardan cifrados en PostgreSQL; conservar la clave de cifrado fuera de esa base y de la imagen. Configuración funcional de features en DB con esquema y auditoría; flags iniciales `trivia.enabled=false`, `stories.enabled=false`.

## 5. Modularidad y procesos

Monolito modular en un único repositorio, con `apps/api`, `apps/worker` y `apps/dashboard`; bibliotecas internas para contratos, infraestructura y features. Una imagen de aplicación sirve API/dashboard compilado o inicia worker según su comando. La estructura es una propuesta de implementación, no carpetas existentes.

- **Núcleo:** comandos, autorización, configuración, flags, reloj y puertos públicos.
- **Adaptadores:** Twitch, Riot, PostgreSQL/pg-boss y sesiones.
- **Features:** eventos de canal, seguimiento de partidas, consulta LoL, predictions, recordatorios, trivia e historias.
- Cada feature registra comandos, handlers, jobs, endpoints, esquema de configuración y contribuciones al dashboard mediante contratos explícitos.
- El dashboard tiene un registro de navegación/rutas por feature y un cliente HTTP común. Agregar un módulo permite modificar la composición, sin editar la implementación de módulos ajenos.
- Predictions y recordatorios consumen el mismo ciclo de partida; no se llaman ni se importan entre sí.
- Persistir eventos y entregas por consumidor; guardar estado y salida transaccionalmente. Un bus en memoria no garantiza recuperación ni difusión durable.
- El worker ejecuta polling, reconciliación y tareas; la API recibe webhooks, administra sesiones y atiende el dashboard. No mantener la aplicación dependiente de una pestaña abierta.

## 6. Persistencia y efectos externos

PostgreSQL guarda usuarios/IDs, sesiones y conexiones OAuth, configuración, cuentas Riot y partidas, vínculos a predictions, recordatorios, rondas/preguntas, contadores de victorias, cooldowns y auditoría; también inbox/outbox y entregas por consumidor. pg-boss usa su esquema de colas.

Requerir claves únicas de evento/resultado, transacciones y exclusión por canal/partida. Los contadores suman una vez por resultado ganador y usuario. La ausencia de economía elimina saldos y libro contable, pero no la necesidad de operaciones consistentes.

Los recordatorios sobreviven al reinicio y se atan a la partida actual o la próxima según el inventario. Las predictions usan puntos nativos de Twitch y ventana de 300 segundos; la resolución depende de la política todavía pendiente. Reconciliar respuestas externas inciertas antes de reintentar: no prometer entrega exactamente una vez a Twitch.

Riot se consulta desde servidor con Spectator-V5/Match-V5, presupuesto de solicitudes y recuperación tras caídas. El polling introduce latencia y requiere validar las modalidades soportadas. Los límites funcionales y políticas propuestas permanecen en el [inventario](inventario-funcional.md).

## 7. Docker y despliegue en Dokploy

Topología inicial:

| Servicio | Exposición | Persistencia |
|---|---|---|
| `api` | HTTPS mediante dominio/proxy Dokploy; dashboard `/`, API `/api`, callback OAuth y webhook EventSub | Sesiones/configuración en PostgreSQL |
| `worker` | Sin puerto público | Jobs y estado en PostgreSQL |
| `postgres` | Red privada; sin puerto de host público | Volumen nombrado estable y backups |
| Migraciones | Paso único coordinado antes del arranque compatible | Esquema versionado |

Entregables: Dockerfile multi-stage, `compose.yaml`, `.dockerignore`, `.env.example` y guía de instalación/actualización/restauración en Dokploy. El build compila dashboard y backend; el runtime no necesita Vite dev server. Usar usuario sin privilegios, dependencias reproducibles, inyección explícita de variables, healthchecks/readiness, señal de actividad del worker y cierre por SIGTERM.

Conservar PostgreSQL y su clave de cifrado entre redeploys. Coordinar migraciones y trabajos ante solapamientos de instancias. No duplicar schedulers de negocio con cron del host. Backups y restauración deben probarse antes de afirmar que la operación está lista.

Referencia: [Dokploy Docker Compose](https://docs.dokploy.com/docs/core/docker-compose).

## 8. Validación exigida para la implementación

- Tests de reglas de partida, asignación de recordatorios, contadores, flags, deduplicación y cambios manuales de predictions.
- Integración real con PostgreSQL para transacciones, exclusión, jobs y recuperación; no validar estos comportamientos solo con mocks.
- Pruebas del dashboard con streamer, mod, usuario ajeno, rol revocado, sesión vencida y CSRF. Verificar que los endpoints también rechacen accesos directos no autorizados.
- Verificar `TWITCH_CHANNEL` omitida → `longii_`, override válido, valor inválido y aislamiento al cambiar canal.
- Build y arranque de contenedores, migraciones, persistencia tras redeploy y restauración.
- Prueba real de OAuth, webhook HTTPS y acciones autorizadas contra Twitch/Riot en Dokploy; no sustituirla por pruebas unitarias.

El documento fija la arquitectura y las tecnologías. Las políticas funcionales aún pendientes del inventario deben resolverse antes de activar los comportamientos afectados.
