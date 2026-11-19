# Importación selectiva del legado

El importador abre SQLite en modo de solo lectura. El modo predeterminado es preview; `--apply` crea primero un backup consistente mediante la API nativa de SQLite, con permisos 0600, e importa en una transacción PostgreSQL auditada. Conserva también los datos WAL en ese respaldo.

1. Detener el bot anterior y preservar el archivo original con sus archivos de journal/WAL si existen. No reemplazarlo por una base vacía.
2. Compilar el nuevo backend, aplicar migraciones y conectar el canal mediante OAuth para establecer su ID.
3. Preparar un archivo de identidades verificadas. Ejemplo: `{"login_antiguo":"123456789"}`. Verificar cada identidad con Twitch; no asociar por semejanza de nombres ni fusionar usuarios ambiguos. Un nombre antiguo puede haber cambiado de dueño: omitirlo si no hay evidencia suficiente.
4. Ejecutar preview y revisar el conteo de rechazados y la lista de identidades sin resolver.

```sh
npm run build:server
npm run import:legacy -- /ruta/data.db /ruta/identidades.json
npm run import:legacy -- /ruta/data.db /ruta/identidades.json --apply
```

En la imagen de producción se puede ejecutar `node --experimental-sqlite dist/scripts/import-legacy.js ...` con los archivos montados y el mismo entorno de la app. El backup se crea junto al original: el directorio debe permitir escritura. Proteger esos archivos y guardarlos fuera de Git y de la imagen.

Se importan preguntas/respuestas alternativas/contador de uso y cooldowns de `historia`/`historia-duo` aún vigentes con IDs verificados. Los IDs de preguntas usan prefijo `legacy_`; reejecutar no duplica ni sobrescribe preguntas editadas y nunca acorta un cooldown vigente. No se habilitan juegos por importar.

No se leen ni se importan config/secretos, saldos, apuestas/participaciones, animé o bloqueos TTS. Se conservan en el backup histórico. Las apuestas abiertas antiguas se concilian fuera del nuevo motor. Los contadores de victorias empiezan en cero.

Las filas inválidas se cuentan como rechazadas; cooldowns vencidos se omiten. Las identidades sin resolver no reciben IDs ficticios. El importador no transforma Gold Coins en puntos de canal o victorias.
