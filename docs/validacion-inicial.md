# Validación de la inicialización

18 de noviembre de 2026. Pruebas locales; no se ejecutó GitHub Actions ni se desplegó en Dokploy.

| Verificación | Resultado |
| --- | --- |
| ESLint 9 / Neostandard, hooks y accesibilidad JSX | Aprobado, sin warnings |
| TypeScript estricto: backend, worker, contratos y dashboard | Aprobado |
| Vitest unitario | 9 tests aprobados |
| PostgreSQL real / Drizzle / pg-boss | 4 tests aprobados: rollback, unicidad, exclusión entre conexiones, job conservado tras reiniciar pg-boss y readiness |
| Migraciones | Generación/check aprobados; migración aplicada dos veces sin cambios adicionales |
| Build de servidor y dashboard | Aprobado |
| Contratos OpenAPI y cliente generado | Regeneración reproducible, sin divergencias |
| Playwright / Chromium | 2 tests aprobados: SPA compilada, API mismo origen, viewport móvil, deep link y 404 de API |
| Docker multi-stage | Build aprobado; instalación limpia con npm 11.6.2 y dependencias runtime separadas |
| Compose | API y worker saludables, migración previa y PostgreSQL sin puerto público |
| Usuario del runtime | UID distinto de cero verificado |
| SIGTERM | Worker salió con 0; API salió con código normal admitido (0/143), sin SIGKILL |
| Persistencia | Dato test conservado al eliminar/recrear contenedores sin borrar el volumen |
| Backup/restauración | pg_dump/pg_restore a base nueva; datos de control y esquema pg-boss verificados |
| Skills | 10 instalados; enlaces Claude Code válidos |
| Git | Mismo origin que el legado; historial conservado; longibot-old sin modificaciones |

El smoke test de contenedores está en `scripts/smoke-containers.sh` y forma parte del workflow. Usarlo solamente con un proyecto Compose descartable. Las bases de restauración y las filas de control se eliminaron al terminar.

No se implementaron ni validaron OAuth, sesiones administrativas, permisos Twitch, firmas EventSub, APIs Twitch/Riot ni reglas funcionales. No hay secretos reales configurados. La publicación GHCR solo se ejecutará al subir a main y pasar los jobs de tests/contenedores; no se hizo push ni despliegue.

## Modern Web Guidance

Consulté la guía `html` para la pantalla inicial. Apliqué idioma explícito, un único h1 y un main semántico, siguiendo «use semantic landmarks» para que la estructura pueda recorrerse con tecnologías de asistencia.
