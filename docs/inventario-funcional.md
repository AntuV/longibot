# Inventario funcional y alcance objetivo de LongiBot

Actualizado: **18 de noviembre de 2026**. Relevamiento del código legado: `4bda75c`.

## Cómo leer este documento

Las secciones 1–10 definen el alcance vigente y la arquitectura propuesta para el refactor. Las decisiones funcionales provienen de las indicaciones del propietario; las políticas adicionales se identifican como propuestas o pendientes. El **anexo histórico** conserva íntegramente el inventario previo como referencia del código existente: sus funciones, premios, checklist y decisiones pendientes no constituyen el alcance futuro cuando contradicen estas secciones.

El relevamiento original fue documental. La implementación y su evidencia local están en [validacion-funcional.md](validacion-funcional.md). No se validaron credenciales, elegibilidad del canal ni flujos reales contra Twitch/Riot o Dokploy. `data.db` no está disponible. Las referencias oficiales se consultaron el 18 de noviembre de 2026.

## 1. Decisiones confirmadas y destino de las funciones

| Área | Decisión para el nuevo bot | Estado inicial objetivo |
|---|---|---|
| Chat y comandos | Conservar recepción, respuestas, reconexión y permisos explícitos | Habilitado |
| Economía propia | Eliminar Gold Coins, acumulación, saldos, ranking económico, transferencias y ajustes | Fuera de alcance |
| Puntos de canal | Integrarse con los puntos nativos de Twitch mediante canjes y predictions | Habilitado |
| Eventos de Twitch | Reaccionar a canjes, Bits, Power-ups, mensajes destacados, subs, regalos de subs y follows | Habilitado; acciones configurables |
| Apuestas propias | Eliminar motor, participaciones, reparto y comandos dinámicos | Reemplazado por predictions nativas |
| Predictions | Creación automática al comenzar cada partida; recepción durante 5 minutos | Habilitado, sujeto a disponibilidad de Twitch |
| League of Legends | Conservar consulta `!lol` adaptada a las APIs vigentes y agregar seguimiento de inicio/fin de partida | Habilitado |
| Recordatorios | Mods encolan ítems para el final de la partida actual o de la siguiente si no hay una activa | Habilitado |
| Trivia | Conservar banco, rondas manuales/automáticas, respuestas y rotación; contar victorias | **Deshabilitado** |
| Historias | Conservar juego individual/dúo y cooldowns; contar victorias | **Deshabilitado** |
| Premios de trivia/historias | Únicamente contador de victorias por usuario; sin pagos ni moneda | Disponible cuando se habiliten esos módulos |
| Clips | Quitar `!clip` y la integración de creación; otra herramienta cubre la función | Fuera de alcance |
| TTS | Quitar comando, audio, página, sockets y bloqueos específicos | Fuera de alcance |
| Animé | Quitar catálogo, progreso y comandos | Fuera de alcance |
| Configuración | Conservar configuración persistente validada y separar secretos | Habilitado |
| Dashboard administrativo | Login con Twitch y gestión por mods actuales y streamer del canal | Obligatorio |
| Canal objetivo | Variable de entorno `TWITCH_CHANNEL`, valor predeterminado `longii_` | Un canal por despliegue |
| Modularidad | Cada feature encapsula comandos, eventos, tareas, datos y configuración | Obligatorio |
| Operación | Docker y despliegue en servidor con Dokploy | Obligatorio |

Puntos de canal no implica recrear una economía dentro del bot. Twitch administra sus saldos, participación y distribución en predictions. El bot no tendrá comandos para consultar, transferir o acreditar saldos propios. La API pública de puntos se orienta a recompensas y canjes; no proporciona una operación general para regalar puntos a un espectador. [API de puntos de canal](https://dev.twitch.tv/docs/api/reference/channel-points).

## 2. Integración con eventos de Twitch

Usar **EventSub para la entrada y Helix para las acciones**, con un adaptador que traduzca los mensajes externos a contratos internos estables. En producción: webhooks HTTPS; en desarrollo se admite WebSocket. [Autenticación y transportes de chat](https://dev.twitch.tv/docs/chat/authenticating/).

| Entrada requerida | Suscripción / señal externa | Contrato interno propuesto |
|---|---|---|
| Mensajes y comandos | `channel.chat.message` | `chat.message.received.v1` |
| Canjes personalizados | `channel.channel_points_custom_reward_redemption.add` y `.update` | `twitch.redemption.created.v1` / `updated.v1` |
| Canjes automáticos | `channel.channel_points_automatic_reward_redemption.add`, versión 2 donde corresponda | `twitch.automatic_reward.redeemed.v1` |
| Bits, Cheers y Power-ups | `channel.bits.use` | `twitch.bits.used.v1` |
| Mensaje destacado | Canje automático y/o tipo `channel_points_highlighted` en el chat | `twitch.message.highlighted.v1` |
| Subs nuevas | `channel.subscribe` | `twitch.subscription.started.v1` |
| Mensaje de resuscripción | `channel.subscription.message` | `twitch.subscription.message.v1` |
| Regalos de subs | `channel.subscription.gift`; identificar también subs con `is_gift` | `twitch.subscriptions.gifted.v1` |
| Follow | `channel.follow`, versión 2 | `twitch.followed.v1` |
| Inicio / fin de directo | `stream.online` / `stream.offline` | `stream.started.v1` / `ended.v1` |
| Estado de predictions | `channel.prediction.begin`, `.progress`, `.lock`, `.end` | `prediction.state.changed.v1` |

Referencias: [eventos de canal](https://dev.twitch.tv/docs/eventsub/reference/channel), [eventos de puntos](https://dev.twitch.tv/docs/eventsub/reference/channel-points), [mensajes de chat](https://dev.twitch.tv/docs/eventsub/reference/chat), [catálogo EventSub](https://dev.twitch.tv/docs/eventsub/reference/).

### Reglas de procesamiento

- Bits y puntos de canal son mecanismos distintos. Normalizar el medio de pago y el subtipo, sin asumir que destacar un mensaje siempre cuesta Bits.
- `channel.bits.use` contempla Cheers y Power-ups, entre ellos `gigantify_an_emote`, `message_effect` y `celebration`. No cubre transacciones de Bits en extensiones ni emite por los Power-ups gratuitos usados por el propio streamer. [Channel Bits Use](https://dev.twitch.tv/docs/eventsub/reference/channel#channel-bits-use).
- Subs y regalos pueden generar señales relacionadas: separar el regalo agrupado de las altas individuales para evitar agradecer o ejecutar la misma acción dos veces. No atribuir identidad a eventos anónimos.
- Designar una fuente principal por acción. Deduplicar reentregas por ID del proveedor y correlacionar señales de chat/canjes/Bits cuando haya identificadores disponibles; no deduplicar solo por texto o nombre.
- Persistir el evento validado antes de confirmar recepción del webhook; ejecutar acciones fuera de la solicitud HTTP. Validar firma, antigüedad, challenges y revocaciones.
- Los handlers concretos serán configurables por evento/recompensa. Recibir un evento no supone agregar automáticamente overlays, sonidos o acciones no solicitadas.
- Gestionar fulfillment/reembolso únicamente cuando la API y la propiedad de la recompensa lo permitan; la app creadora tiene restricciones específicas de gestión. [Estados de canjes](https://dev.twitch.tv/docs/api/reference/channel-points#update-redemption-status).

### Autorización

Separar identidad del bot e identidad del broadcaster. Que el bot sea moderador no reemplaza el consentimiento OAuth del broadcaster para predictions. Pedir permisos según los módulos habilitados; no pedir scopes de clips o funciones eliminadas.

| Capacidad | Permisos a contemplar |
|---|---|
| Chat | `user:read:chat`, `user:write:chat`; `user:bot` y `channel:bot` según transporte y modalidad de autenticación |
| Predictions | `channel:manage:predictions` del broadcaster |
| Canjes | `channel:read:redemptions`; `channel:manage:redemptions` solo si se gestionan recompensas/estados |
| Bits / subs | `bits:read`, `channel:read:subscriptions` |
| Follows | `moderator:read:followers` y `moderator_user_id` autorizado |
| Timeouts de historias | `moderator:manage:banned_users` solo si se decide conservar y habilitar esa acción |

Persistir renovación de tokens y detectar autorización revocada. No publicar secretos mediante `!config`. [Scopes oficiales](https://dev.twitch.tv/docs/authentication/scopes/).

## 3. Seguimiento de partidas de League of Legends

Crear un módulo proveedor del ciclo de partida, independiente de predictions y recordatorios. Una cuenta seguida por canal como base propuesta; usar Riot ID, PUUID y routing regional/plataforma correcto. Conservar `!lol <campeón>` con el alcance legado de SoloQ, actualizando endpoints, catálogo y liberación de bloqueos. El seguimiento para automatizaciones no debe quedar limitado a cola 420 por reutilizar accidentalmente esa restricción del comando.

### Detección propuesta

- Backend en el servidor: polling de **Spectator-V5** para inicio/presencia de partida y **Match-V5** para confirmar resultados. La desaparición de Spectator no prueba por sí sola que la partida terminó ni quién ganó.
- Empezar con una frecuencia configurable de 30–60 segundos mientras corresponda el seguimiento; presupuestar todas las consultas por región y endpoint, con backoff y respeto a `Retry-After`.
- Persistir ID estable de partida, cuenta, cola, estado, inicio observado/real si se conoce, última comprobación y resultado. Emitir `game.started.v1`, `game.ended.v1` y, cuando corresponda, `game.result.confirmed.v1` sin duplicados lógicos.
- Reconciliar al arrancar: recuperar partidas que terminaron durante una caída sin tratar partidas históricas como nuevos comienzos. Ante estado desconocido, mantenerlo explícito; no asumir que no hay partida por un error de API.
- Un callback de torneo no resuelve el caso general de SoloQ: Riot documenta ese callback para partidas creadas con códigos de torneo.
- Un agente local es una alternativa futura para reducir latencia; no es requisito inicial. Las APIs del cliente son locales y League Client API no tiene garantía de soporte para terceros.

Referencias: [APIs de Riot](https://developer.riotgames.com/apis/), [identidad, torneos y cliente](https://developer.riotgames.com/docs/lol), [límites y claves](https://developer.riotgames.com/docs/portal).

El polling no garantiza reacción al segundo exacto del inicio o fin. Spectator tampoco garantiza cubrir todas las modalidades. **Pendiente funcional:** acordar qué colas/modalidades incluye «cada partida» y validar su cobertura antes de prometer automatización en ellas. La solución debe compartir la misma identidad y ciclo de partida entre todos los consumidores.

## 4. Predictions nativas automáticas

### Requisitos confirmados

- Sustituir completamente las apuestas propias por predictions de Twitch.
- Crear una prediction al comenzar cada partida seguida, con ventana de participación de **300 segundos**.
- Vincularla a la partida y al canal; persistir IDs de Twitch, opciones, estado y timestamps. Twitch es la fuente de verdad del estado externo y del reparto de puntos.
- Tras cerrar la recepción, la prediction queda pendiente de resolución: cinco minutos de participación no significa resolverla a los cinco minutos.
- **Confirmado durante la implementación:** resolver automáticamente con victoria/derrota verificada y cancelar/reembolsar la prediction ante remake confirmado; no elegir ganador con resultado ambiguo.

### Restricciones de integración verificadas

La API exige un token del broadcaster con `channel:manage:predictions`. Twitch permite una sola prediction pendiente por canal: una bloqueada sin resolver también impide abrir otra. Requiere elegibilidad del canal y puntos habilitados. La API acepta una ventana de 300 segundos. [Referencia de predictions](https://dev.twitch.tv/docs/api/reference/predictions), [guía de predictions](https://dev.twitch.tv/docs/api/predictions).

### Comportamiento propuesto para completar el diseño

- Prediction predeterminada «¿Gana esta partida?» con «Sí» / «No». Resolver automáticamente con resultado confirmado de la cuenta seguida. Pregunta y opciones fueron aceptadas como base; la resolución automática y la cancelación por remake fueron confirmadas expresamente durante la implementación.
- La ventana de 300 segundos se mide desde la creación aceptada por Twitch. Por polling puede comenzar después del inicio real; no se promete cubrir exactamente los primeros cinco minutos de juego.
- Si se descubre una partida ya avanzada, omitir creación automática cuando ya transcurrieron cinco minutos o no se puede establecer una antigüedad fiable. Registrar el motivo. El umbral es una política propuesta configurable.
- Si existe otra prediction, registrar conflicto y avisar a administración; no cancelar ni resolver una prediction ajena para abrir la propia.
- Si la partida termina antes de que cierre la recepción, bloquearla cuanto antes. Sin resultado verificable, no elegir un ganador; remakes/resultados ambiguos requieren cancelación o revisión, según política a definir.
- Mantener recuperación por API y eventos begin/lock/end para reconocer operaciones manuales. No sobrescribir una resolución manual ni volver a crear una prediction después de reiniciar.
- Serializar creación por canal y conciliar una respuesta HTTP incierta antes de reintentar: un timeout no demuestra que Twitch no la creó.
- Permitir control administrativo para bloquear, resolver o cancelar las predictions gestionadas, con auditoría. Sintaxis pendiente.

Política aplicada: remake confirmado por Riot cancela; victoria/derrota confirmada resuelve automáticamente; resultado ausente/ambiguo queda bloqueado o pendiente de revisión. Una resolución manual en Twitch tiene prioridad. La integración real debe validarse antes de producción.

## 5. Recordatorios al terminar una partida

### Requisitos confirmados

Mods pueden encolar texto que el bot recuerde al finalizar la partida actual. Si no hay partida activa, se recuerda al finalizar la siguiente. Los ítems deben sobrevivir a reinicios y desplegarse en el canal correspondiente.

### Contrato y operación propuestos

- Comando `!recordar <texto>` para mods, streamer y propietario. Subcomandos administrativos `!recordar lista` y `!recordar quitar <id>`; nombres propuestos y sujetos a validación contra colisiones.
- Con partida activa confirmada: fijar `target_game_id` al encolar. Sin partida activa: guardar `waiting_next_game` y asignar atómicamente a la próxima `game.started.v1`; no a cualquier resultado histórico descubierto después.
- Si el estado de juego es desconocido por una falla de Riot, conservar la intención y el timestamp, informar el estado pendiente y reconciliar si había una partida activa al encolar antes de asignar una futura.
- Al finalizar esa partida: enviar los ítems en orden de alta, con autor y límites de longitud/cadencia. Una derrota o remake confirmado también es un fin de partida para recordatorios; no depende de resolver la prediction.
- Estados propuestos: `waiting_next_game`, `awaiting_game_assignment`, `queued`, `sending`, `sent`, `canceled`, `delivery_unknown` y error recuperable. Registrar intentos y mensaje externo cuando esté disponible.
- Dos instancias no deben asignar o reclamar el mismo ítem simultáneamente. Persistir entrega pendiente y usar exclusión/idempotencia por ítem.
- Un fallo al enviar no elimina el recordatorio. Un envío aceptado pero sin confirmación local puede quedar incierto: no prometer entrega exactamente una vez ni reenviar a ciegas.
- Reinicios no descartan ítems de una partida finalizada durante la caída. Propuesta: entregarlos al recuperar la conexión, identificando que son pendientes de esa partida; no trasladarlos silenciosamente a otra.
- En el orden de eventos, usar hora e identidad de partida, no solo el orden de llegada: un fin tardío de la partida anterior no debe vaciar los ítems de la siguiente.

## 6. Trivia e historias: conservadas y apagadas

Flags independientes persistidos: `trivia.enabled = false` y `stories.enabled = false`. Apagado significa sin comandos jugables, rondas, jobs de juego ni acciones de moderación; se permite ayuda/administración con respuesta explícita de función deshabilitada. No basta con ocultar comandos. Al desactivar, cancelar/inutilizar tareas pendientes y verificar el flag nuevamente antes de ejecutar un efecto.

### Premios confirmados

**Solo contador de victorias por usuario.** No hay Gold Coins, pagos en puntos de canal, transferencias ni una moneda sustituta. Guardar contadores por juego para no mezclar qué se ganó; un total combinado puede derivarse. Incrementar una vez por resultado ganador y usuario mediante clave única de resultado. En una historia con dos ganadores, cada uno suma una victoria.

### Trivia a preservar al habilitarla

- Banco de preguntas y respuestas alternativas, selección aleatoria entre las menos usadas y rotación.
- Envío manual, omisión, respuestas por chat y ganador único por ronda.
- Base de tiempos del legado: intento automático cada 60 minutos durante directo, aviso de 30/60/90 segundos y cinco minutos de respuesta; configurables y persistentes.
- Primera respuesta válida suma una victoria. Sin respuesta no hay ganador. Controlar banco vacío y rondas concurrentes.

### Historias a preservar al habilitarlas

- Historias individuales/dúo, familias narrativas de piratas/tesoro y ranked ficticia; resultado aleatorio.
- Sustituir cada resultado que antes daba puntos por una victoria, sin ponderarlo por la liga ficticia.
- Cooldowns del legado como base configurable: cinco minutos globales, ocho horas para ejecutor y una hora para invitado.
- Los timeouts reales existentes requieren política explícita antes de habilitarse; conservar el módulo no implica activar automáticamente esa sanción. La regla de consentimiento del invitado también queda pendiente.

No hay historial disponible para reconstruir victorias antiguas. Los contadores nuevos comienzan en cero; no se convierten saldos en victorias.

## 7. Stack recomendado y adaptaciones

Esta es la recomendación técnica ajustada al alcance; las versiones concretas se fijarán con lockfile al implementar.

| Capa | Elección | Aplicación al alcance actual |
|---|---|---|
| Lenguaje/runtime | TypeScript estricto y Node.js LTS soportado | Contratos compartidos y procesos permanentes |
| Backend | NestJS + Fastify | Módulos, configuración validada, permisos, sesiones y endpoints EventSub |
| Dashboard | React + Vite, React Router, TanStack Query y Tailwind CSS | Administración autenticada con Twitch para mods y streamer |
| Persistencia | PostgreSQL | Partidas, recordatorios, predictions, contadores, deduplicación y tareas |
| Acceso a datos | Drizzle ORM + migraciones versionadas | Transacciones, restricciones e importación selectiva |
| Jobs y scheduler | pg-boss sobre PostgreSQL | Polling Riot, reconciliación, tareas diferidas y reintentos |
| Twitch | Adaptadores EventSub/Helix con Twurple | OAuth y suscripciones, aislados del dominio; validar cobertura del SDK para eventos nuevos y usar HTTP directo detrás del mismo adaptador si falta soporte |
| Riot | Cliente HTTP tipado propio detrás de un puerto | Routing, caché, presupuestos de solicitudes y normalización |
| Pruebas | Vitest + PostgreSQL real en integración | Duplicados, concurrencia, permisos, apagado de módulos y recuperación |
| Operación | Docker multi-stage + Compose para Dokploy | API/entrada, worker y PostgreSQL persistente |
| Logs | JSON estructurado a stdout, healthchecks y estado operativo persistido | Seguimiento de errores, permisos revocados y trabajos fallidos |

PostgreSQL sigue siendo útil aunque desaparezca la economía: los recordatorios, la asociación partida/prediction, los eventos y los jobs requieren consistencia. pg-boss evita introducir Redis inicialmente y permite colas persistentes y scheduling. [pg-boss](https://github.com/timgit/pg-boss), [transacciones de Drizzle](https://orm.drizzle.team/docs/transactions), [NestJS/Fastify](https://docs.nestjs.com/techniques/performance), [listeners Twurple](https://twurple.js.org/docs/getting-data/eventsub/listener-setup.html).

**Dashboard confirmado:** React y Vite forman parte del stack para el panel obligatorio. Socket.IO no es necesario: sincronización inicial mediante polling de la API; SSE queda como extensión. El panel autentica con Twitch y permite gestionar al streamer y a los mods actuales del canal. No hacen falta servicios de audio, almacenamiento de clips ni tablas de contabilidad. La definición técnica ampliada está en [stack-tecnologico.md](stack-tecnologico.md).

### Dashboard, acceso y canal configurado

- Canal objetivo desde `TWITCH_CHANNEL`, con valor predeterminado `longii_`. Resolver ID estable en backend; el dashboard muestra el canal efectivo y no puede modificarlo. Cambiar el canal requiere redeploy y reconciliación, conservando datos aislados por canal.
- Login Twitch con OAuth Authorization Code y sesión opaca en PostgreSQL, cookie HttpOnly/Secure y protección CSRF. Tokens únicamente en backend; no en localStorage.
- Acceso solo si el ID es el broadcaster configurado o Twitch confirma que el usuario es mod de ese canal. Usar `Get Moderated Channels` con `user:read:moderated_channels` y paginación para mods; comprobar por separado al streamer. El propietario técnico legado no obtiene acceso implícito al panel.
- Roles comprobados en backend, con revalidación y caché breve; revocar acceso cuando deja de ser mod. Completar login no basta para gestionar. [Moderación](https://dev.twitch.tv/docs/api/reference/moderation#get-moderated-channels).
- Mods y streamer gestionan recordatorios, predictions, acciones de eventos, módulos, banco de trivia, configuración funcional y consulta de contadores/estado/auditoría. Solo el streamer puede otorgar su propia autorización OAuth; el login de un mod no reemplaza ese consentimiento. Nadie ve secretos en el panel.
- Trivia e historias siguen apagadas al inicio. Poder administrar su banco/configuración no activa sus comandos o jobs.
- Las rutas, vistas y permisos del dashboard se registran por feature, sin acoplar implementaciones entre módulos.

## 8. Arquitectura modular y datos

### Límites y registro de features

Un monolito modular con dos entrypoints desplegables (`api` y `worker`), construidos desde el mismo código/imagen. No son microservicios independientes: comparten contratos y PostgreSQL. La composición registra los módulos habilitados; agregar una feature puede modificar ese registro, pero no exige editar handlers, reglas ni tablas privadas de otras features.

- **Núcleo:** registro de comandos, autorización por acción, configuración, flags, contratos versionados, reloj y puertos de persistencia/jobs/envío.
- **Adaptadores:** Twitch, Riot y PostgreSQL/pg-boss. Ninguna regla de juego debe depender directamente de los payloads del proveedor.
- **Features:** `channel-events`, `predictions`, `reminders`, `lol-query`, `trivia` y `stories`. Cada una aporta sus comandos, handlers, jobs, configuración y migraciones; flags de trivia/historias apagados.
- **Proveedor del ciclo de partida:** `game-tracking` publica hechos comunes. No conoce las features que los consumen. Predictions y recordatorios no se importan entre sí.
- **Extensión:** una feature implementa un contrato de registro y consume eventos/puertos públicos; no consulta repositorios privados de otra. Validar conflictos de comandos al arrancar.
- **Ejecución:** cada consumidor durable tiene su propia entrega/estado. Si falla predictions, recordatorios sigue procesando el fin de partida; un único job con consumidores competidores no sirve para difundir el evento a todos.
- **Transacción:** guardar cambios de dominio y evento/job de salida en una misma transacción, con outbox o integración transaccional con pg-boss. Un EventEmitter en memoria no reemplaza este mecanismo para acciones recuperables.

### Modelo mínimo propuesto

| Datos | Responsabilidad |
|---|---|
| `channels`, `users`, `oauth_connections`, `sessions` | IDs estables, autorizaciones, sesiones del dashboard y tokens protegidos |
| `feature_settings` | Configuración validada y habilitación por módulo/canal |
| `event_inbox`, `event_outbox`, `event_deliveries` | Recepción, publicación y entrega durable por consumidor |
| `tracked_accounts`, `games` | PUUID/routing, identidad de partida y ciclo confirmado |
| `prediction_links` | Relación única canal/partida/prediction y reconciliación |
| `reminders` | Texto, autor, destino, orden y estado de entrega |
| `trivia_questions`, `trivia_rounds`, `story_runs` | Estado propio de juegos preservados |
| `game_wins`, `win_results` | Contador por usuario/juego y resultado que evita dobles incrementos |
| `cooldowns`, `admin_audit` | Vencimientos necesarios y acciones administrativas |
| Esquema de pg-boss | Jobs, programación y reintentos |

Todas las claves funcionales deben incluir el canal cuando corresponda. Un canal por despliegue, elegido por `TWITCH_CHANNEL` con default `longii_`; el multicanal no es requisito inicial. No crear tablas activas de saldos, apuestas propias, TTS, clips ni animé.

## 9. Docker y Dokploy

### Entregables exigidos para la implementación

- `Dockerfile` multi-stage con instalación reproducible, runtime Node.js soportado, usuario sin privilegios y sin credenciales dentro de la imagen.
- `compose.yaml` para Dokploy con `api`, `worker` y PostgreSQL; misma imagen de aplicación con comandos distintos. PostgreSQL puede sustituirse por un servicio existente vía `DATABASE_URL`.
- Dominio HTTPS mediante el proxy de Dokploy para dashboard y API bajo el mismo origen, con rutas estables para OAuth/EventSub. El servicio API sirve también el dashboard compilado; worker y base en red interna.
- Volumen nombrado estable de PostgreSQL, backups y restauración documentados. Un redeploy no puede borrar eventos, tokens, recordatorios o jobs.
- Variables inyectadas explícitamente mediante `environment` o `env_file`; `.env.example` sin secretos. Guardar tokens renovables protegidos y persistir la clave de cifrado fuera de la DB y de la imagen.
- Migraciones como paso único coordinado antes de iniciar procesos compatibles; no ejecutarlas simultáneamente desde cada réplica.
- Health/readiness de API y señal de actividad del worker; reintentos de conexión, cierre ordenado con SIGTERM y recuperación de trabajos interrumpidos. Healthcheck debe detectar fallas locales sin reiniciar en bucle por una caída temporal de Riot/Twitch.
- Logs en stdout con secretos ocultos. Política de retención para eventos, intentos y trabajos.
- Inicialmente una instancia de cada proceso; aun así usar exclusión por canal/partida para soportar solapamientos de despliegue y no duplicar conexiones, predictions ni mensajes.

Dokploy soporta Compose, configuración explícita del entorno y volúmenes persistentes. La programación de negocio vive en el worker/pg-boss, sin depender de cron del host. [Dokploy Docker Compose](https://docs.dokploy.com/docs/core/docker-compose).

## 10. Migración, aceptación y decisiones restantes

### Tratamiento de datos legados

- Conservar copia de respaldo del SQLite original antes de importar; el archivo está ausente en este checkout.
- Importar banco de trivia y cooldowns relevantes. Resolver identidades Twitch antiguas por nombre sin inventar IDs ni fusionar usuarios ambiguos.
- No convertir Gold Coins en puntos de canal ni en victorias. Archivar saldos, apuestas/participaciones, animé y bloqueos TTS en el respaldo legado; no pasan al modelo activo.
- Las apuestas abiertas del sistema anterior requieren conciliación fuera del nuevo motor; no se transforman en participaciones de Twitch.
- Separar configuración funcional de credenciales; no importar secretos a una interfaz pública. Configuración de clips/TTS/animé y moneda queda retirada.
- No existen rondas/resultados históricos suficientes para reconstruir contadores: iniciar en cero.

### Criterios mínimos para dar por implementado el alcance

- [ ] Solo se registran comandos y handlers de features habilitadas; no quedan rutas activas de puntos propios, apuestas, clips, TTS o animé.
- [ ] Los eventos pedidos llegan por EventSub y cada handler configurable se prueba con duplicados, anonimato y eventos relacionados, sin efectos repetidos previsibles.
- [ ] Cada partida elegible dispara una sola prediction con ventana de 300 segundos; se verifican conflictos, detección tardía y reinicios sin duplicar creación.
- [ ] Se distingue bloqueo de resolución y se respeta la fuente de verdad de Twitch, incluidas acciones manuales.
- [ ] Recordatorios durante una partida se entregan al finalizar esa; en inactividad esperan el final de la siguiente. Se prueban reinicios, eventos fuera de orden, errores de Riot y envío incierto.
- [ ] Trivia e historias arrancan apagadas y no ejecutan efectos pendientes al deshabilitarse.
- [ ] Al habilitarlas, solo registran victorias; concurrencia/reintentos no duplican ganadores ni contadores.
- [ ] Una feature nueva se registra sin editar las implementaciones de features existentes; los contratos durables se entregan a todos sus consumidores.
- [ ] Dashboard obligatorio con login Twitch: streamer/mod gestionan; usuarios ajenos, sesiones inválidas y mods revocados no acceden a endpoints administrativos.
- [ ] `TWITCH_CHANNEL` toma `longii_` si está ausente, permite override válido y conserva aislamiento por canal; no puede alterarse desde el panel.
- [ ] Build y arranque con Compose, migración, webhook HTTPS, persistencia tras redeploy y restauración de backup validados; prueba real en Dokploy queda exigida antes de afirmar despliegue completo.

### Decisiones que todavía faltan

1. Colas/modalidades de LoL incluidas y si las automatizaciones operan solo durante directo. La consulta heredada `!lol` es SoloQ; eso no limita por sí mismo las nuevas automatizaciones.
2. Las bases de pregunta/opciones fueron aceptadas. La resolución automática y cancelación por remake quedaron confirmadas durante la implementación. Se aplican las reglas conservadoras de detección tardía, conflicto y resultado ambiguo de la sección 4; falta validarlas contra el canal real.
3. Acción concreta por cada canje, Bits, Power-up, sub, regalo y follow; premios de minijuegos ya definidos como contador de victorias.
4. Política de timeouts/consentimiento de historias antes de habilitarlas.
5. Confirmar sintaxis final, límites y mensajes de recordatorios; las reglas de asociación a partida ya están definidas por el propietario.
6. Confirmar entorno/dominio y credenciales, elegibilidad de predictions/puntos y clave Riot apropiada para uso continuo; las claves de desarrollo Riot expiran cada 24 horas.
7. Multicanal queda como ampliación opcional. El dashboard con Twitch para mods y streamer es un requisito confirmado, al igual que `TWITCH_CHANNEL` con default `longii_`.

Estas decisiones no impiden elegir el stack ni preparar los contratos modulares. Sí deben cerrarse antes de habilitar comportamientos cuya regla de negocio todavía sea ambigua.

---

## Anexo histórico: inventario del código existente antes de estas decisiones

**Referencia histórica únicamente.** El contenido siguiente conserva el relevamiento original y sus limitaciones. Las menciones a economía, premios en puntos, migración de saldos, paridad de clips/TTS/animé y decisiones sin resolver corresponden al alcance anterior, sustituido por las secciones 1–10.

### Inventario funcional de LongiBot

Fecha de relevamiento: 18 de noviembre de 2026. Código base: `4bda75c`.

#### Alcance y criterio

Inventario obtenido mediante lectura de todo el código del repositorio. No se ejecutó el bot, no se conectó a Twitch ni a Riot y no se dispone de `data.db`, credenciales ni datos de producción. «Conectada» significa que la función tiene una ruta de ejecución desde el bot; no certifica que funcione hoy contra los servicios externos.

Se distinguen funciones conectadas, implementaciones parciales y capacidades ausentes. Los defectos observados se documentan aparte para conservar la intención funcional durante el refactor, sin convertir errores en requisitos de compatibilidad.

#### 1. Resumen de capacidades

| Área | Funciones existentes | Estado en el código |
|---|---|---|
| Chat de Twitch | Conexión, reconexión, lectura de comandos, respuestas y acciones en chat | Conectada |
| Puntos propios | Acumulación por actividad, saldo, consultas a terceros, ranking, transferencias y ajustes administrativos | Conectada, con defectos en alta y movimientos |
| Apuestas | Dos opciones, montos o all-in, cierre, extensión, resolución, reparto e historial de la última apuesta | Conectada, con persistencia y recuperación parciales |
| Historias | Minijuego aleatorio individual o con otro usuario, premios y timeouts reales | Conectada |
| TTS | Texto del chat a voz en navegador, selector de voz, velocidad e historial local de mensajes | Conectada |
| Bloqueo del TTS | Botón de bloqueo y registro en base de datos | Parcial: el bloqueo no se aplica |
| Clips | Solicitud de creación de clip y publicación de su enlace | Conectada; integración externa sin validar |
| League of Legends | Información del jugador que usa un campeón en la ranked actual del streamer | Conectada; integración externa sin validar |
| Animé | Registro del capítulo actual por animé y consulta desde chat | Conectada |
| Trivia | Banco de preguntas, envío manual, omisión, selección aleatoria, respuestas y premios | Parcial: envío manual conectado; automatización y corrección desactivadas |
| Administración | Consulta, edición y recarga de configuración desde el chat del bot | Conectada |

Hay **9 comandos raíz** registrados: `lol`, `anime`, `puntos`, `clip`, `pregunta`, `apuesta`, `tts`, `historia` y `config`. Las apuestas agregan comandos dinámicos según sus opciones.

Fuente: [registro de comandos](longibot/commands.js), [arranque y eventos](longibot/bot.js).

#### 2. Usuarios y permisos

El código reconoce un único nivel de privilegio compartido por:

- Moderadores de Twitch (`user.mod`).
- El streamer, comparando el nombre de usuario con el canal configurado.
- El propietario técnico, comparando con `owner`.

En este documento se los llama **administradores**, aunque el código no separa esos tres roles. No hay permisos específicos para VIP, suscriptores o seguidores.

Los comandos se procesan tanto en el canal principal como en el canal del propio bot. En general responden y actúan sobre el canal principal; `!config` exige estar en el chat del bot. Los comandos no requieren que el streamer esté en vivo; esa condición se usa para la acumulación automática de puntos.

Fuente: [permisos y utilidades](longibot/common/utils.js), [conexión](longibot/client.js), [administración](longibot/commands/config.js).

#### 3. Inventario de comandos y reglas

##### 3.1. Economía y puntos

Moneda interna guardada en SQLite, denominada `Gold Coins` por defecto y configurable con `pointsname`. Es independiente de los puntos de canal de Twitch.

| Comando | Quién puede usarlo | Comportamiento |
|---|---|---|
| `!puntos` | Cualquiera | Consulta el saldo propio |
| `!puntos <usuario>` | Cualquiera | Consulta saldo ajeno; admite `@usuario` |
| `!puntos rank` | Cualquiera | Muestra posición y saldo propios |
| `!puntos top` | Cualquiera | Muestra los tres primeros, excluyendo al streamer |
| `!puntos top10` | Administradores para elegir cantidad | Permite indicar otra cantidad dentro de ese argumento; usuarios comunes siguen viendo tres |
| `!puntos agregar <usuario> <cantidad>` | Cualquiera, con reglas diferentes | Un usuario común transfiere desde su saldo; un administrador acredita sin descontarse |
| `!puntos quitar <usuario> <cantidad>` | Administradores para una quita normal | Resta saldo, con piso en cero |

Reglas automáticas:

- Se procesa cada mensaje de chat de un usuario distinto del bot.
- El primer mensaje registra una marca de tiempo en memoria, sin otorgar puntos.
- En mensajes posteriores se acredita **1 punto si pasaron más de 5 minutos** desde esa marca o desde la última acreditación.
- Requiere directo activo o `options.debug`. No premia presencia silenciosa ni calcula retroactivamente todo el tiempo transcurrido.
- En modo debug, tras el primer mensaje puede acreditar en cada mensaje.
- Guarda el nombre visible si el registro de puntos todavía no lo tiene.
- `!puntos` tiene cooldown de **10 segundos por usuario**, con excepción para administradores.
- El ranking personal incluye al streamer; el top lo excluye.

Limitaciones: no hay historial contable, motivos de ajustes ni reserva de saldo para apuestas. El alta automática de nuevos usuarios está defectuosa. Transferencias y ajustes requieren correcciones de atomicidad, signo y destino propio; ver sección 7.

Fuentes: [comandos de puntos](longibot/commands/puntos.js), [acreditación por mensajes](longibot/schedule/points.js), [consulta/alta de saldo](longibot/common/utils.js).

##### 3.2. Apuestas con puntos propios

Existe una única apuesta activa global, con exactamente dos opciones.

| Comando | Permiso | Comportamiento |
|---|---|---|
| `!apuesta <tema>` | Administradores | Crea una apuesta con opciones `si` / `no` |
| `!apuesta <opción1>/<opción2> <tema>` | Administradores | Crea una apuesta con opciones personalizadas de una palabra |
| `!apuesta` | Administradores | Anuncia la apuesta activa y cómo participar |
| `!<opción> <cantidad>` | Cualquiera con saldo | Participa; por ejemplo, `!si 50` |
| `!<opción> all` | Cualquiera con saldo | Apuesta el saldo completo; alias: `allin`, `all-in`, `todo` |
| `!apuesta extender <minutos>` | Administradores | Suma minutos al contador; alias `alargar` |
| `!apuesta cerrar` | Administradores | Cierra la recepción; alias `frenar`, `parar`, `stop` |
| `!apuesta <opción ganadora>` | Administradores | Resuelve y liquida la apuesta, incluso si la recepción seguía abierta |
| `!apuesta ultima` | Administradores | Muestra tema, ganador, participantes y montos de la última resuelta; alias `anterior` |

Reglas:

- Ventana inicial de participación de **5 minutos**.
- Un usuario puede participar una sola vez; no hay cambio de opción ni ampliación de monto.
- Exige cantidad positiva y saldo suficiente al inscribirse.
- El monto no se descuenta ni reserva al inscribirse.
- Al resolver, cada ganador conserva su saldo y recibe `floor(total apostado por perdedores × apuesta individual / total apostado por ganadores)`.
- Cada perdedor pierde hasta su saldo disponible en ese momento, con piso en cero.
- Sin ganadores, se descuentan igualmente los montos de los perdedores.
- Guarda apuesta, fecha, opciones, ganador y participaciones; intenta recuperar una apuesta sin resolver al arrancar.

No son predicciones nativas de Twitch. No existe cancelación con devolución, resumen de cuotas, consulta personal de participación ni edición de apuesta.

La recuperación tras reinicio no restaura correctamente el temporizador ni las extensiones/cierres manuales. Las opciones pueden colisionar con comandos o palabras administrativas existentes.

Fuentes: [apuestas](longibot/commands/apuesta.js), [resolución de opciones dinámicas](longibot/commands.js).

##### 3.3. Historias y minijuegos

| Comando | Permiso | Comportamiento |
|---|---|---|
| `!historia` | Cualquiera | Genera una historia individual aleatoria |
| `!historia <usuario>` | Cualquiera | Incluye a otro usuario; admite `@usuario` |

Hay dos familias de historias, elegidas aleatoriamente:

1. **Piratas/tesoro.** En solitario, premio de **25 puntos** o timeout. En dúo, uno recibe **25 puntos** y el otro un timeout.
2. **Ranked de LoL ficticia.** En solitario o dúo, resultado positivo con puntos según una liga aleatoria, o timeout; en el resultado negativo del dúo se intenta aplicar a ambos.

| Liga ficticia | Premio por usuario ganador |
|---|---:|
| Hierro | 1 |
| Bronce | 3 |
| Plata | 5 |
| Oro | 8 |
| Platino | 10 |
| Diamante | 15 |
| Master | 20 |
| GrandMaster | 25 |
| Challenger | 30 |

Los timeouts solicitados son de **5 minutos** y son acciones reales de moderación de Twitch; su éxito depende de los permisos del bot y del usuario objetivo. El resultado narrativo se publica como acción de chat.

Cooldowns: **5 minutos globales** en memoria; **8 horas por usuario que ejecuta** y **1 hora para el usuario invitado**, persistidos en SQLite. El invitado no presta consentimiento dentro del flujo y no se valida que esté presente. Los textos de premios usan `GC` fijo, aunque el nombre de moneda sea configurable.

Fuente: [historias](longibot/commands/historia.js).

##### 3.4. Texto a voz y página de control

`!tts <texto>` está disponible para cualquiera. El servidor transmite usuario, nombre visible y mensaje a todos los navegadores conectados mediante Socket.IO.

La página web incluye:

- Reproducción mediante `speechSynthesis` del navegador. El servidor no genera ni guarda audio.
- Selector de las voces disponibles en el dispositivo.
- Velocidad de **0,1 a 1,0**, mediante un control de 1 a 10.
- Persistencia de voz y velocidad en `localStorage`.
- Listado de mensajes recibidos, más nuevos primero, en memoria del navegador; aparece un mensaje de ejemplo inicial.
- Botón con confirmación para bloquear a un usuario del TTS.

Se sirve en el puerto fijo **3700** y el cliente conecta a `http://localhost:3700`. Se necesita seleccionar voz para que reproduzca y agregue mensajes al listado. Puede utilizarse como página auxiliar de audio, pero no hay integración específica con OBS.

**Bloqueo incompleto:** el botón guarda una fila en `blocks`, pero el envío TTS nunca consulta esa tabla. No hay desbloqueo, autenticación del panel, control de permisos para bloquear, límite de texto, costo en puntos, cooldown, pausa o botón para vaciar la cola. La reproducción utiliza la cola nativa del navegador.

Fuentes: [comando TTS](longibot/commands/tts.js), [servidor web](longibot/webserver.js), [lógica del navegador](longibot/website/main.js), [interfaz](longibot/website/index.html).

##### 3.5. Clips

`!clip`, restringido a administradores, solicita un clip del broadcaster configurado y publica `https://clips.twitch.tv/<id>`.

- Cooldown global de **45 segundos** después de una respuesta aceptada por el código.
- Usa el OAuth del bot y `bot.client_id`; requiere configuración y permisos adecuados en Twitch.
- No guarda catálogo, autor de la solicitud ni historial local de clips.
- No personaliza título ni permite buscar o reproducir clips previos.

Fuentes: [comando clip](longibot/commands/clip.js), [integración Twitch](longibot/twitch.js).

##### 3.6. League of Legends

`!lol <campeón>` consulta al participante que usa ese campeón en la partida actual de la cuenta configurada del streamer. Disponible para cualquiera.

Flujo implementado:

1. Busca la partida activa de `lol.account_id` en la región `lol.url`.
2. Acepta únicamente ranked Solo/Duo, cola `420`.
3. Resuelve el campeón por coincidencia parcial, sin distinguir mayúsculas, en un catálogo estático local; usa solamente el primer argumento.
4. Identifica al invocador participante que lo utiliza, sea aliado o rival.
5. Consulta hasta **20 partidas previas** de SoloQ con ese campeón y calcula victorias.
6. Obtiene tier, división, LP, victorias, derrotas y porcentaje de victorias de SoloQ.
7. Publica el resumen; contempla mensajes de partida inexistente, campeón ausente, historial inexistente o error de API.

Configura una sola cuenta y una región; contiene un mapa de 11 regiones. Impide búsquedas simultáneas y aplica un cooldown nominal de **120 segundos**, que los administradores pueden omitir; el texto dice «1 min». Ciertos retornos por error dejan bloqueos sin liberar.

El código usa endpoints Riot de varias familias `v4`, entre ellas Match y Summoner por nombre. No se verificó su compatibilidad actual ni la vigencia del catálogo; eso debe resolverse al planificar la nueva integración. No se consulta una cuenta arbitraria elegida por el espectador.

Fuentes: [consulta LoL](longibot/commands/lol.js), [catálogo de campeones](longibot/assets/champions.js).

##### 3.7. Seguimiento de animé

| Comando | Permiso | Comportamiento |
|---|---|---|
| `!anime <nombre>` | Cualquiera | Consulta el capítulo guardado |
| `!anime add <nombre>` | Administradores | Crea un animé con capítulo inicial 1 |
| `!anime set <nombre> <capítulo>` | Administradores | Actualiza su capítulo |

Consulta y búsqueda de duplicados sin distinguir mayúsculas. El nombre efectivo es un solo argumento: no se soportan títulos con espacios. No hay listado, eliminación, incremento automático, temporada ni integración con una plataforma de animé.

La validación de `set` es incompleta y su consulta de existencia no se espera con `await`, por lo que puede confirmar una actualización inexistente o aceptar un capítulo omitido.

Fuente: [animé](longibot/commands/anime.js).

##### 3.8. Trivia y preguntas

**Capacidad parcialmente desconectada**, que conviene incluir si se quiere recuperar lo que el bot tenía previsto hacer.

| Entrada | Permiso | Comportamiento implementado |
|---|---|---|
| `!pregunta va` | Administradores | Envía manualmente una pregunta sin aviso previo |
| `!pregunta saltear` | Administradores | Descarta la pregunta activa y cancela su timeout |
| Mensaje de chat con respuesta | Cualquiera | Existe lógica de validación y premio, pero no se invoca desde el chat |

Diseño implementado:

- Banco de preguntas en SQLite, con respuestas alternativas separadas por `;`.
- Selección aleatoria dentro de las menos enviadas, con contador `times_sent` para rotarlas.
- Programador cada **60 minutos**, condicionado por `surveys.running`.
- Aviso previo y espera aleatoria de **30, 60 o 90 segundos** para el modo automático.
- Tiempo de respuesta de **5 minutos**.
- Primera coincidencia gana **20 puntos**; comparación por inclusión de una respuesta dentro del mensaje, sin distinguir mayúsculas.
- Mensaje de expiración aleatorio si nadie responde.

Estado real: el módulo sí se carga indirectamente desde `commands/pregunta.js`, y por eso se registra su intervalo. Sin embargo, `surveys.running` queda en `false`: las asignaciones desde el estado del directo están comentadas. También está comentada la llamada a `checkAnswer` en el receptor de chat. Por lo tanto, puede enviarse una pregunta manual, pero la automatización, el reconocimiento de ganadores y la entrega de premios no están conectados.

No hay comandos ni panel para cargar, editar o eliminar preguntas. El banco vacío y la programación de preguntas pendientes requieren manejo adicional.

Fuentes: [comando pregunta](longibot/commands/pregunta.js), [motor de trivia](longibot/schedule/surveys.js), [conexión comentada en el bot](longibot/bot.js).

##### 3.9. Configuración administrativa

Los siguientes comandos requieren privilegios administrativos y ejecutarse en el chat del bot:

| Comando | Comportamiento |
|---|---|
| `!config` | Lista las claves de configuración |
| `!config get <clave>` | Publica el valor de una clave |
| `!config set <clave> <valor>` | Crea o actualiza una clave, persiste en SQLite y actualiza memoria |
| `!config update` | Recarga configuración desde SQLite |

El setter interpreta `true`, `false`, `null`, números enteros y texto con espacios. No tiene esquema de validación por clave. Recargar no reconstruye el cliente Twitch ya creado: cambiar canal o identidad no implica reconexión automática con esos valores.

Configuración inventariada:

- General: `options.debug`, `channel`, `owner`, `pointsname`.
- Bot: `bot.username`, `bot.client_id`, `bot.oauth_token`.
- Twitch API: `twitch.client_id`, `twitch.secret`, `twitch.broadcaster_id`.
- LoL: `lol.url`, `lol.api_key`, `lol.account_name`, `lol.account_id`. `lol.account_name` no se utiliza en la consulta actual.

El getter y la confirmación del setter publican valores sin ocultarlos, incluidas claves sensibles, en el chat del bot. Esa exposición es un defecto a corregir, no una capacidad a conservar.

Fuentes: [comando config](longibot/commands/config.js), [almacenamiento de configuración](longibot/config.js), [valores iniciales](longibot/db.js).

#### 4. Automatizaciones y estado temporal

| Proceso | Disparador o duración | Persistencia |
|---|---|---|
| Reconexión a chat | Gestionada por tmi.js | Configuración en SQLite; conexión en memoria |
| Detección de directo | Al iniciar y cada 5 minutos | Estado en memoria |
| Ganancia de puntos | Mensaje tras más de 5 minutos desde la marca previa | Saldo en SQLite; marcas en memoria |
| Cooldown de puntos | 10 segundos por usuario | Memoria |
| Recepción de apuestas | Contador inicial de 5 minutos | Apuesta y participaciones en SQLite; contador en memoria |
| Cooldown de clips | 45 segundos globales | Memoria |
| Consulta LoL | Búsqueda exclusiva y cooldown de 120 segundos | Memoria |
| Historia | 5 minutos globales, 8 horas por ejecutor y 1 hora por invitado | Global en memoria; individuales en SQLite |
| Trivia | 60 minutos entre intentos, aviso de 30–90 segundos, respuesta en 5 minutos | Banco/contador en SQLite; ronda y timers en memoria; automática desactivada |
| Preferencias de voz | Cambio desde el navegador | `localStorage` del navegador |

La detección de directo usa búsqueda de canales en Twitch y compara `display_name` contra el canal convertido a minúsculas sin normalizar ambos lados; puede producir falsos negativos por diferencias de capitalización.

#### 5. Datos a preservar para una migración

El archivo esperado es `data.db`, excluido de Git y ausente en este checkout. El esquema llega a versión **7**.

| Tabla | Datos | Tratamiento para el refactor |
|---|---|---|
| `points` | Usuario, nombre visible y saldo | Migrar saldos y resolver identidad estable de Twitch |
| `anime` | Nombre y capítulo | Migrar catálogo y progreso |
| `questions` | ID, pregunta, respuestas y veces enviada | Migrar banco y alternativas |
| `bets` | ID, tema, fecha, opciones y ganador | Migrar historial y conciliar apuestas abiertas |
| `bets_users` | Apuesta, usuario, opción y monto | Migrar participaciones |
| `cooldowns` | Usuario, comando y vencimiento | Conservar vencimientos relevantes |
| `blocks` | Usuario y comando | Revisar bloqueos existentes y aplicar la política corregida |
| `config` | Claves y valores JSON, incluidas credenciales | Separar secretos de configuración funcional |
| `schema_version` | Versión del esquema | Referencia técnica para el importador |

No existen registros persistentes de movimientos de puntos, narraciones de historias, solicitudes de clips, mensajes TTS ni resultados históricos de trivia. Las preferencias TTS están en cada navegador y no dentro de `data.db`.

Fuente: [esquema y migraciones](longibot/db.js).

#### 6. Componentes e integraciones actuales

- **Ejecución:** Node.js con CommonJS, un solo proceso iniciado mediante `node bot.js`.
- **Chat:** tmi.js; escucha `chat`, `join` y `part`, e ignora mensajes propios.
- **API Twitch:** OAuth con client credentials para consultar directo; token del bot para crear clips.
- **API Riot:** consulta de partida, invocador, historial y liga mediante `node-fetch`.
- **Persistencia:** SQLite y migraciones caseras al iniciar.
- **Web:** Express, HTTP y Socket.IO.
- **Interfaz:** AngularJS 1.8 y Angular Material, con dependencias de CDN; síntesis de voz local.
- **Temporización:** `setInterval` y `setTimeout` dentro del proceso.

Los eventos `join` y `part` intentan mantener una lista de usuarios, pero retornan cuando `self` es falso, de modo que no siguen a espectadores. Esa lista se pasa al resolver, aunque los comandos actuales no la utilizan.

El repositorio no incluye una suite de pruebas funcional: `npm test` es un placeholder que falla. El README describe una configuración JSON5 que ya no coincide con la configuración SQLite implementada. No hay despliegue, contenedor, panel general de administración, worker ni sistema de colas definidos en el repositorio.

Fuentes: [dependencias](longibot/package.json), [README](longibot/README.md), [cliente](longibot/client.js), [bot](longibot/bot.js), [webserver](longibot/webserver.js).

#### 7. Defectos que no deben convertirse en requisitos

Hallazgos de lectura de código, sin reproducción contra servicios externos:

| Prioridad propuesta | Hallazgo | Consecuencia para el refactor |
|---|---|---|
| Alta | `getPoints` crea usuario solamente si falla la consulta, no cuando no encuentra una fila | Implementar alta explícita: un usuario nuevo no acumula correctamente con el flujo actual |
| Alta | Transferencia al mismo usuario: se calcula el destino con saldo anterior y se escribe después del débito | Puede crear saldo; exigir destino distinto o definir operación neutra y transaccional |
| Alta | Cantidades con signo y validación numérica permisiva en puntos | Una quita negativa puede pasar como transferencia; definir enteros positivos y permisos por operación |
| Alta | Lecturas y escrituras de saldo independientes, sin transacciones ni libro de movimientos | Evitar pérdidas de actualización, débitos sin crédito y liquidaciones parciales o repetidas |
| Alta | Apuestas sin saldo reservado | El usuario puede gastar después de apostar; se pagan premios sobre montos que quizá no se pueden cobrar |
| Alta | Recuperación de apuesta sin recrear intervalo ni persistir vencimiento/cierre/extensiones | Puede quedar abierta indefinidamente o reabrirse al reiniciar; persistir estado y fecha límite |
| Alta | Evento de bloqueo web sin autenticación; TTS ignora `blocks` | Proteger la administración y aplicar el bloqueo antes de emitir |
| Alta | `!config` permite publicar secretos en chat | Sustituir por administración segura con valores sensibles ocultos |
| Alta | Trivia no llama al corrector ni habilita el estado automático | Reconectar explícitamente el ciclo completo si se conserva esta función |
| Media | LoL no libera todos sus bloqueos al terminar con error y programa el cooldown sólo al completar | Usar liberación garantizada y política de cooldown consistente |
| Media | Detección de directo compara capitalización inconsistente | Utilizar identificación inequívoca del canal y normalización coherente |
| Media | `!anime set` no espera la consulta y no exige correctamente capítulo | Validar existencia, argumentos y rango de capítulo |
| Media | Apuesta sin argumentos y sin apuesta activa accede a `undefined.toLowerCase()` | Responder con ayuda y validar argumentos antes de operar |
| Media | Opciones de apuesta pueden colisionar con comandos y acciones administrativas | Definir nombres reservados o una sintaxis de participación independiente |
| Media | Trivia sin preguntas y envíos pendientes no tienen control completo | Manejar banco vacío, exclusión de rondas y cancelación de tareas pendientes |
| Media | Inicialización de DB asíncrona sin espera explícita; reintento de config con `this.initialize()` en función flecha | Hacer el arranque secuencial y reportar errores recuperables |
| Baja | Lista de espectadores no mantenida y títulos de animé de una palabra | Corregir sólo si esos comportamientos forman parte del alcance futuro |

#### 8. Base de alcance para el refactor

##### Paridad funcional a conservar

- [ ] Conexión y reconexión a Twitch; recepción de comandos y respuestas.
- [ ] Roles de espectador, moderador, streamer y propietario, con permisos explícitos.
- [ ] Moneda configurable, acumulación por actividad, saldos, ranking, top, transferencias y ajustes.
- [ ] Apuestas binarias, opciones personalizadas, all-in, cierre, extensión, resolución y consulta de última apuesta.
- [ ] Historias individuales y dúo con premios, cooldowns y política definida para timeouts reales.
- [ ] TTS en navegador, selección de voz, velocidad, listado y preferencias.
- [ ] Bloqueo efectivo y desbloqueo del TTS.
- [ ] Creación de clips con control de acceso y cooldown.
- [ ] Consulta LoL equivalente, adaptada a la API vigente cuando se implemente.
- [ ] Catálogo de animé y capítulo actual.
- [ ] Trivia manual y automática, con respuestas, premio y rotación del banco, si se decide recuperar la función desconectada.
- [ ] Configuración persistente y migración de los datos existentes.

##### Mejoras propuestas: no son funciones actuales

Estas son candidatas para el alcance posterior, no decisiones ya tomadas:

1. **Consistencia y recuperación:** movimientos contables auditables, operaciones atómicas, reserva de apuestas, liquidación idempotente y tareas recuperables después de reinicios.
2. **Panel administrativo:** login con Twitch, permisos por acción, configuración validada, gestión de animé/trivia, movimientos, apuestas y bloqueos.
3. **Identidad:** IDs de Twitch en lugar de depender exclusivamente de nombres que pueden cambiar.
4. **Experiencia de chat:** `!ayuda`/`!comandos`, errores claros, alias explícitos, argumentos con espacios y límites de uso uniformes.
5. **Control del TTS:** pausa, salto, vaciado de cola, límite de longitud y moderación; evaluar costo o permisos según la dinámica del canal.
6. **Integraciones mantenibles:** separar clientes Twitch/Riot, renovar credenciales según corresponda, actualizar catálogo de campeones y manejar límites de API.
7. **Operación:** logs estructurados, métricas, salud del servicio, backups y pruebas de reglas económicas y recuperación.
8. **Expansión opcional:** comandos personalizados, mensajes programados, eventos de follows/subs/raids, canjes de puntos de canal, overlays o múltiples canales. Ninguna de estas capacidades aparece implementada aquí.

##### Decisiones pendientes para diseñar el nuevo sistema

- Un canal o servicio para múltiples canales.
- Puntos propios solamente o integración adicional con puntos de canal de Twitch.
- Si se conservan timeouts reales como resultado de historias y bajo qué política.
- Si trivia pasa a estar activa y quién administrará el banco.
- Si las apuestas reservan saldo, cómo se cancelan y cómo se trata el redondeo o la falta de ganadores.
- Si el TTS sigue usando voces del navegador o incorpora generación de audio en servidor.
- Qué ampliaciones entran en la primera entrega y cuáles quedan para después.
- Volumen previsto, entorno de despliegue y stack objetivo.

El inventario permite definir la paridad y una migración; no presupone todavía una elección de stack ni implementa el refactor.
