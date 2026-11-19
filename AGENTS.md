# AGENTS.md

## Trampas

- Formularios del dashboard: cada label + control que se pase como `children` a `Form` va envuelto en `<div className='field'>` (o se arma con `fields` de `Form` / `Numeric`). Los controles sueltos quedan sin espaciado y pegados al campo o botón siguiente.
- E2E (`npm run test:e2e`) sirve el build `apps/dashboard/dist` y, fuera de CI, reutiliza cualquier servidor que ya escuche en el puerto 3107. Después de cambiar la UI correr `npm run build:dashboard` (y frenar un servidor viejo) antes, o los tests corren contra la UI anterior.
