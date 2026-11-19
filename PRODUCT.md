# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Streamer (longii_)**: dueño del canal. Fuera del directo conecta las identidades de broadcaster y bot, carga la cuenta de Riot, prende o apaga módulos, arma las reglas de eventos y el banco de trivia. Durante el directo sigue de reojo partidas, predictions y recordatorios.
- **Moderadores actuales del canal**: entran con Twitch; los permisos se revalidan en cada solicitud. Usan el panel sobre todo en vivo, muchas veces **desde el celular**, para encolar recordatorios, revisar entregas, resolver predictions inciertas y lanzar rondas de trivia.

El uso se reparte por igual entre configurar fuera del directo y consultar u operar en vivo.

## Product Purpose

LongiBot es el bot de Twitch de un solo canal (`TWITCH_CHANNEL`, por defecto `longii_`) más su panel de administración. Responde comandos de chat, reacciona a eventos de Twitch (canjes, Bits/Power-ups, destacados, subs, regalos, follows, directo), sigue las partidas de League of Legends del streamer y automatiza alrededor de ellas: la prediction «¿Gana esta partida?» y los recordatorios de mods para el final de la partida. Trivia e historias existen, pero arrancan apagadas.

Funciona bien cuando el canal corre solo durante el directo: las predictions se abren y se resuelven sin intervención, los recordatorios llegan en el momento justo y, cuando algo queda incierto, el panel lo muestra con claridad para que alguien lo resuelva.

## Positioning

Es un bot hecho a medida para un canal y su comunidad, no un bot genérico multicanal. Se apoya en los mecanismos nativos de Twitch (puntos de canal, predictions) en lugar de una economía propia, y conecta el ciclo de la partida de LoL (Spectator-V5/Match-V5) con predictions y recordatorios, con resolución automática, reembolso por remake y respeto de las resoluciones manuales.

## Operating Context

- El directo es de League of Legends (SoloQ). El ritmo de trabajo lo marcan el inicio y el fin de cada partida.
- Pantallas del panel: Resumen, Recordatorios, Predictions, Eventos y acciones, Configuración, Trivia e historias, Operación (worker, autorizaciones, entregas inciertas, errores, auditoría).
- Comandos de chat: `!ayuda`, `!comandos`, `!lol <campeón>`, `!victorias`; para mods: `!recordar …`; con los módulos activos: `!pregunta va|saltear`, `!historia [@usuario]`.
- Despliegue con Docker en Dokploy; en producción Nest sirve el panel en el mismo origen que la API.

## Capabilities and Constraints

- Fuera de alcance, y no hay que reintroducirlos: economía propia (Gold Coins, saldos, transferencias), apuestas propias, clips, TTS y el módulo de animé.
- Los premios de trivia e historias se limitan a un contador de victorias por usuario. No hay timeouts reales.
- Seguridad: OAuth con Twitch, sesiones opacas, CSRF, tokens cifrados, auditoría. El panel nunca muestra el valor de un secreto y los mods no pueden conectar identidades en nombre del streamer.
- Hay estados inciertos legítimos (creación incierta de una prediction, entregas inciertas) que el panel tiene que exponer para que una persona los resuelva, en vez de ocultarlos.
- Terminología: «predictions» y «canjes» se usan tal cual en Twitch; «recordatorios», «entregas», «módulos».
- Alcance funcional vigente: `docs/inventario-funcional.md`, secciones 1–10.

## Brand Commitments

- **Avatar de longibot**: es la identidad del producto (logo y favicon, servido desde `/api/branding/avatar`). Se mantiene.
- **Voz rioplatense**: la UI y el bot hablan en español argentino, con voseo.
- **Espíritu de longii_**: el panel tiene que sentirse parte del canal. Rasgos confirmados: humor y memes, League of Legends, comunidad cercana y trato familiar con mods y chat, y el gusto por el animé (One Piece en particular). Ese gusto es parte de la identidad del canal, aunque el módulo de animé del bot se haya retirado.

## Evidence on Hand

- Avatar del bot vía `/api/branding/avatar`.
- Documentación: `docs/inventario-funcional.md`, `docs/validacion-funcional.md`, `docs/dokploy.md`, `docs/migracion.md`.
- No hay datos reales importados (la base legada no está en este checkout), ni capturas de un canal real conectado, ni testimonios. No hay que inventar métricas, victorias ni historial.

## Product Principles

1. **El directo manda**: lo que se necesita en vivo tiene que estar a mano y entenderse de un vistazo, también en el celular.
2. **Automático, con salida manual clara**: el bot resuelve solo, pero cualquier cosa incierta o en conflicto se muestra con claridad y se puede resolver a mano.
3. **Nativo de Twitch, sin inventar sistemas propios**: puntos y predictions son de Twitch; el bot no crea economías paralelas.
4. **De la comunidad, no corporativo**: cercano, con humor y con la identidad del canal, sin perder precisión operativa.
5. **Seguro por defecto**: permisos revalidados, secretos que nunca se muestran y acciones auditadas.

## Accessibility & Inclusion

- Los mods suelen operar desde el celular durante el directo: las acciones en vivo (recordatorios, predictions, entregas, trivia) tienen que funcionar bien en pantallas chicas y con objetivos táctiles cómodos.
- Base: WCAG 2.2 AA.
