# Valana Repartidor V1

Aplicación local para recibir consultas de WhatsApp Cloud API, distribuir solicitudes entre asesores y conservar su seguimiento. El backend usa NestJS y SQL parametrizado sobre PostgreSQL 18; el panel Next.js 16 se exporta a archivos estáticos.

## Requisitos

- Windows con Docker Desktop y WSL2 habilitados.
- Docker Compose v2.
- Para compilar o probar fuera de Docker: Node.js 24 y npm.

## Primer inicio en PowerShell

Ejecutar desde `C:\Valana-Pruebas\Valana Repartidor`:

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force .local | Out-Null
```

Editar `.env` con una contraseña aleatoria para PostgreSQL en `POSTGRES_PASSWORD` y la misma contraseña dentro de `DATABASE_URL`. Completar las variables privadas de Meta. `.env`, `.local` y los datos de PostgreSQL están excluidos de Git. No copiar credenciales a archivos de documentación ni a mensajes.

```powershell
docker compose up -d --build postgres api web proxy_webhook
docker compose ps
Invoke-RestMethod http://localhost:3001/salud
```

En el primer inicio, la API ejecuta las migraciones y una semilla idempotente. Las seis contraseñas aleatorias iniciales se guardan una sola vez en `.local\credenciales-iniciales.txt`. Abra ese archivo localmente y cambie las claves desde administración cuando corresponda. Los usuarios iniciales son cuatro asesores, un supervisor y un administrador; sus correos figuran en ese archivo. La semilla no carga datos reales de contactos.

- Panel: <http://localhost:3000>
- API: <http://localhost:3001>
- Salud: <http://localhost:3001/salud>
- Webhook local: <http://localhost:3001/webhooks/meta>

## Operación local

```powershell
docker compose ps
docker compose logs api --tail 100
docker compose restart api web
docker compose stop
docker compose up -d postgres api web proxy_webhook
```

`docker compose stop` conserva el volumen de PostgreSQL. No usar `docker compose down -v` si se necesitan los datos. Los servicios de otros proyectos Docker no se modifican.

## Túnel temporal para Meta

El túnel **no** se inicia por defecto. Cuando se necesite validar Meta:

```powershell
docker compose --profile webhook up -d tunel
docker compose logs tunel --tail 50
```

Busque la URL `https://...trycloudflare.com` en el log. En Meta, configure la URL de callback como `https://...trycloudflare.com/webhooks/meta` y use el valor privado de `META_VERIFY_TOKEN` de `.env`. El proxy también acepta `/webhook` para facilitar una migración desde la prueba anterior; solo expone GET/POST del webhook. La URL cambia cuando se reinicia el túnel. El túnel anterior del prototipo es independiente y no se modifica. El panel y SSE se comunican directamente con `localhost:3001`, no a través del túnel.

Para consultar la suscripción de la WABA y actualizarla mediante Graph API después de validar el nuevo túnel:

```powershell
node pruebas/meta-suscripcion.mjs ver
node pruebas/meta-suscripcion.mjs configurar https://SU-TUNEL.trycloudflare.com/webhooks/meta
```

La segunda orden cambia la URL de entrega de eventos de la WABA. No guarde esta URL temporal en `.env`.

Un túnel rápido puede dejar de funcionar aunque Docker aún muestre el contenedor como `Up`. Si el webhook no recibe eventos, recupere el túnel, valide la nueva URL y actualice Meta con una sola orden desde la raíz del proyecto:

```powershell
./pruebas/restablecer-tunel.ps1
```

El script no imprime secretos y comprueba GET, firma HMAC y callback antes de terminar. La URL de `trycloudflare.com` sigue siendo temporal y no tiene garantía de disponibilidad; para una operación continua futura se necesitará un túnel estable.

La actualización en vivo usa un oyente PostgreSQL `LISTEN/NOTIFY` por instancia de API y conexiones SSE por pestaña. El trabajador de Meta se despierta por aviso y revisa reintentos cada 30 segundos. Las medidas de consumo y la política de conservación están en [docs/consumo-y-retencion.md](docs/consumo-y-retencion.md).

Los tres secretos de Meta cumplen papeles distintos: `META_APP_SECRET` verifica la firma HMAC entrante; `META_VERIFY_TOKEN` valida la URL de callback; `META_ACCESS_TOKEN` autoriza envíos con Graph API. `META_GRAPH_API_VERSION` inicia en `v25.0` y es configurable. No registrar nuevamente el número oficial.

## Reglas de distribución

Una solicitud válida sin atención abierta se asigna al asesor elegible con menor contador ajustado de la jornada local (`America/Lima`). Los empates se resuelven con `crypto.randomInt`. El bloqueo de la fila del equipo serializa el reparto; luego se bloquea el contacto y se crean solicitud, contador, asignación y notificación en una transacción. Una segunda opción de un contacto con solicitudes abiertas sigue con el mismo asesor, aunque esté desconectado. La misma opción abierta reutiliza la solicitud. Al cerrarse todas, la siguiente solicitud vuelve al reparto. Las solicitudes sin asesor quedan pendientes y se procesan por orden de llegada al entrar un asesor elegible.

Un asesor es elegible si su cuenta y pertenencia están activas, se marcó Disponible, tiene heartbeat en los últimos dos minutos y el horario comercial lo permite. Al volver, su contador ajustado sube al mínimo de los asesores elegibles actuales, sin cambiar las solicitudes reales. Las jornadas nuevas conservan historial y solicitudes abiertas.

## Seguridad

Las sesiones usan cookies HttpOnly persistentes, con renovación por actividad y revocación al cerrar sesión. Las operaciones de escritura exigen el token CSRF de la cookie separada. Las contraseñas usan Argon2id. La API valida el rol, el negocio y la pertenencia al equipo; un asesor solo obtiene su bandeja y sus solicitudes. El webhook POST verifica `X-Hub-Signature-256` sobre el cuerpo original. La base impide contactos duplicados, mensajes Meta duplicados y solicitudes abiertas duplicadas para un contacto, equipo y opción. Los secretos no aparecen en la interfaz ni en los logs de aplicación.

Para preparar Hostinger más adelante, copiar `.env.production.example` a `/opt/valana-repartidor/.env.production`, completar sus valores privados fuera de Git y ejecutar desde `/opt/valana-repartidor` `docker compose --env-file /opt/valana-repartidor/.env.production up -d postgres api proxy_webhook`. `VALANA_ENV_FILE` hace que Compose y el contenedor API lean ese mismo archivo. `DATABASE_URL` debe usar el usuario, la contraseña y la base definidos para PostgreSQL; codificar los caracteres especiales de la contraseña en la URL. El frontend se publicará aparte en Cloudflare Pages. Esto no cambia el arranque local con `.env`.

Para el futuro frontend `https://valana.bostonbbs.com` con API `https://api.bostonbbs.com`, configurar `WEB_ORIGIN` con el origen del frontend, `NEXT_PUBLIC_API_URL` con la API HTTPS, `NODE_ENV=production` y `COOKIE_DOMAIN=.bostonbbs.com` para que el navegador pueda leer la cookie CSRF desde el frontend. La cookie de sesión permanece restringida al host de la API. No se ha realizado ningún despliegue ni cambio DNS.

## Pruebas y compilación

```powershell
npm ci
npm run test -w apps/api
npm run build -w apps/api
npm run build -w apps/web
docker compose exec -T api node pruebas/integracion.mjs
docker compose exec -T api node pruebas/flujo-api.mjs
docker compose exec -T api node pruebas/usuario-api.mjs
docker compose exec -T api node pruebas/en-vivo.mjs
docker compose exec -T api node pruebas/trabajos-aviso.mjs
node pruebas/webhook.mjs
node pruebas/api.mjs
node pruebas/meta-lectura.mjs
node pruebas/meta-suscripcion.mjs ver
```

La prueba de integración crea un negocio sintético separado, verifica reparto, continuidad, repetición, pendiente de asignación, nivelación y concurrencia, y elimina sus datos al terminar. La prueba del webhook usa un Phone Number ID ajeno para no generar mensajes salientes reales. Puede ejecutarse también contra la URL pública estableciendo temporalmente `WEBHOOK_TEST_URL`. La prueba de persistencia y el reinicio controlado están documentados en `docs/verificacion.md`. El panel está en `apps/web/out` tras `next build`.

La prueba completa con un teléfono externo requiere: conectar el túnel activo en Meta, escribir al número oficial, elegir una opción, comprobar la asignación y notificación en Valana, registrar una nota, cerrar y volver a escribir. La verificación observada se registra en `docs/verificacion.md`.

## Estructura

- `apps/api/src`: NestJS, autenticación, reparto, integración Meta y API REST.
- `apps/web/src`: panel responsive exportable.
- `database/migraciones`: esquema SQL versionado.
- `infraestructura/proxy`: proxy público limitado al webhook.
- `pruebas`: pruebas de integración y webhook.
- `.local`: credenciales iniciales privadas.

## Limitaciones conocidas

- Graph API no ofrece en este flujo una garantía de envío exactamente una vez. Si el proceso cae justo después de que Meta acepte un mensaje y antes de registrar su respuesta, el reintento podría duplicar la confirmación. Los envíos están registrados y los reintentos son limitados.
- Las opciones de menú se asocian a un equipo, pero la primera instalación opera con un solo equipo comercial por negocio.
- La URL de túnel temporal requiere actualización manual en Meta cuando cambie.
