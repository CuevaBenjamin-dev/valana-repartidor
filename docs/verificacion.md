# Verificación local

Fecha: 11 de octubre de 2026 (`America/Lima`).

| Comprobación | Resultado |
| --- | --- |
| PostgreSQL 18, API NestJS, web estática, proxy y túnel | Arrancados en Docker Compose |
| Migraciones SQL y semilla | `001_inicial.sql` y `002_actualizacion_en_vivo.sql` aplicadas; 6 usuarios y 4 opciones |
| Persistencia tras reiniciar PostgreSQL y API | Confirmada con usuario, contacto, solicitud, nota, jornada y contadores sintéticos; datos de prueba eliminados |
| Compilación TypeScript de API | Aprobada |
| `next build` con `output: 'export'` | Aprobada; `apps/web/out` generado |
| Pruebas unitarias de menú | 3 aprobadas |
| Integración de reparto | Continuidad, repetición, mensajes adicionales, menor carga, cierre, pendiente, nivelación, jornadas y concurrencia aprobadas |
| Flujo REST | Autorización, inicio, nota, cierre e historial aprobados |
| Administración | Creación de usuario con contraseña independiente y desactivación aprobadas |
| Seguridad REST | Login, sesión, CSRF, roles y logout aprobados |
| Webhook local | Challenge correcto, firma inválida rechazada y otro número ignorado |
| Acceso a Meta | Token y Phone Number ID verificados con lectura de Graph API |
| Túnel | Se detectó que el túnel rápido anterior había expirado con `Unauthorized: Tunnel not found` aunque el contenedor siguiera `Up`. Se creó uno nuevo, se probó GET/POST público y se actualizó la callback de Meta. El comando de recuperación quedó en `pruebas/restablecer-tunel.ps1` |
| Proxy tras recrear la API | Challenge público correcto después de reconstruir y recrear `api` |
| Callback WABA | Meta aceptó el override y una lectura posterior confirmó la nueva URL temporal |
| Auditoría de dependencias | 0 vulnerabilidades conocidas al ejecutar `npm audit` |
| Colas tras las pruebas | 0 eventos entrantes y 0 mensajes salientes pendientes o en error |
| Actualización en vivo | `LISTEN/NOTIFY` de PostgreSQL y SSE probados con cuenta asesora y supervisora; sin sondeo SQL por cliente. El usuario confirmó que Bruno y administración vieron automáticamente la nueva solicitud sin pulsar `Actualizar` |
| Meta real | Menú y primera confirmación recibidos en el teléfono externo según confirmó el usuario; solicitud de Admisiones asignada a Lucía, nota guardada y atención cerrada. Tras el cierre llegaron `hola` y `4`: se creó Otras consultas como solicitud independiente, asignada por nuevo reparto a Bruno; Meta aceptó la segunda confirmación |

El usuario confirmó la recepción del primer menú y la primera confirmación en el teléfono externo. La nueva selección después del cierre quedó verificada en PostgreSQL y Graph API, y el usuario confirmó que las sesiones de Bruno y administración se actualizaron automáticamente. Las pestañas que ya estaban abiertas antes de reconstruir `web` requirieron una sola recarga para cargar la versión nueva.

Durante la verificación se detectó que el proxy conservaba la IP antigua de `api` tras recrear el contenedor y que omitía los parámetros del challenge. Se corrigió con resolución DNS de Docker y reenvío explícito de los parámetros. Ambas rutas se comprobaron por HTTPS desde el túnel después de recrear la API.

## Comandos de repetición

```powershell
npm run test -w apps/api
npm run build -w apps/api
npm run build -w apps/web
docker compose exec -T api node pruebas/integracion.mjs
docker compose exec -T api node pruebas/persistencia.mjs preparar
docker compose restart postgres
docker compose restart api
docker compose exec -T api node pruebas/persistencia.mjs verificar
docker compose exec -T api node pruebas/flujo-api.mjs
docker compose exec -T api node pruebas/usuario-api.mjs
docker compose exec -T api node pruebas/en-vivo.mjs
node pruebas/api.mjs
node pruebas/webhook.mjs
$env:WEBHOOK_TEST_URL='https://URL-ACTUAL.trycloudflare.com/webhooks/meta'
node pruebas/webhook.mjs
Remove-Item Env:WEBHOOK_TEST_URL
node pruebas/meta-lectura.mjs
node pruebas/meta-suscripcion.mjs ver
./pruebas/restablecer-tunel.ps1
docker compose ps
```
