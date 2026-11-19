# AGENTS.md

## Trampas

- shadcn/ui (`apps/dashboard`): agregar componentes con `npx shadcn@latest add <componente> -c apps/dashboard`. El CLI instala dependencias en `apps/dashboard/package.json`; moverlas al `package.json` raíz (versiones exactas) y volver a correr `npm install`. `src/components/ui/**` es código vendorizado: no editarlo a mano salvo necesidad, está excluido de ESLint y de cobertura.
- `shadcn init` falla con "No Tailwind CSS configuration found" porque Tailwind está en el `package.json` raíz. `components.json` ya existe; no hace falta volver a inicializar.
- E2E (`npm run test:e2e`) sirve el build `apps/dashboard/dist` y, fuera de CI, reutiliza cualquier servidor que ya escuche en el puerto 3107. Después de cambiar la UI correr `npm run build:dashboard` (y frenar un servidor viejo) antes, o los tests corren contra la UI anterior.
