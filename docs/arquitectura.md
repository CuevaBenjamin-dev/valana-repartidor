# Arquitectura y reglas de Valana V1

## Flujo

```text
WhatsApp Cloud API → túnel temporal → proxy_webhook → NestJS → PostgreSQL
                                                        ↓
                                             bandeja de eventos entrantes
                                                        ↓
                                  contacto → solicitud → reparto
                                              ↓
                                     menú orientativo
                                                        ↓
                               notificación al asesor + mensaje saliente

Navegador → Next.js estático → NestJS → PostgreSQL
```

El proxy solo publica el webhook. El navegador consume la API por la dirección pública configurada en `NEXT_PUBLIC_API_URL`. Next.js no contiene sesiones, autorización ni lógica de negocio del lado servidor. `next build` genera `apps/web/out`.

## Modelo relacional

| Área | Tablas | Función |
| --- | --- | --- |
| Organización | `negocios`, `equipos`, `usuarios`, `miembros_equipo` | Aislamiento por negocio y pertenencia a equipos |
| Entrada | `opciones_menu`, `contactos`, `interacciones_entrantes`, `eventos_webhook` | Menú, contacto único e idempotencia de Meta |
| Atención | `solicitudes`, `notas_solicitud`, `notificaciones` | Bandeja, gestión e historial |
| Reparto | `jornadas`, `contadores_jornada`, `historial_asignaciones` | Carga real, carga ajustada y auditoría |
| Salida y seguridad | `mensajes_salientes`, `sesiones`, `registro_auditoria` | Respuestas, autenticación y trazabilidad |

Las claves primarias son UUID. `contactos(negocio_id,telefono)` y `contactos(negocio_id,meta_user_id)` son únicos cuando el dato existe. El BSUID de Meta identifica a un usuario que oculta su teléfono; el nombre de usuario se conserva para mostrarlo, sin usarlo como clave. `eventos_webhook.meta_mensaje_id` e `interacciones_entrantes.meta_mensaje_id` son únicos. Un índice parcial impide dos solicitudes abiertas del mismo contacto, equipo y opción; otro impide dos solicitudes generales abiertas. `solicitudes.opcion_id` queda vacío hasta que se reconozca un motivo, y la interfaz muestra «Consulta general». Las fechas se guardan en `timestamptz`; `jornadas.fecha_local` se calcula con la zona horaria del negocio, inicialmente `America/Lima`.

## Reparto transaccional

El webhook confirma recepción solo después de guardar el evento. Un trabajador toma eventos pendientes de PostgreSQL, procesa uno por transacción y deja reintentos con demora creciente si falla. El reparto bloquea la fila del equipo con `FOR UPDATE`, luego el contacto y las solicitudes abiertas. Los contadores y el historial se confirman en el mismo `COMMIT` que la solicitud.

El contador real aumenta por cada oportunidad nueva asignada, tanto por sorteo como por continuidad. El contador ajustado incluye la carga real y los ajustes de nivelación. Cuando un asesor vuelve a ser elegible, se eleva su contador ajustado hasta el mínimo de sus pares elegibles sin tocar el real. Los empates mínimos usan `crypto.randomInt`. Una jornada nueva tiene filas de contador nuevas, mientras las solicitudes abiertas conservan su asesor.

Las solicitudes pendientes de asignación se procesan por orden de llegada. El heartbeat y el cambio de disponibilidad bloquean el equipo antes de volver elegible al asesor y procesar pendientes. La recepción de un nuevo mensaje también atiende los pendientes existentes antes de repartir uno nuevo.

El primer mensaje crea y distribuye la solicitud aunque sea solo «Hola». Si es texto libre, la respuesta automática es únicamente el encabezado de menú configurado y las opciones activas. Si contiene una opción válida, la respuesta es únicamente la confirmación configurada. Una opción posterior clasifica la solicitud general y envía esa confirmación una sola vez, sin reasignarla. Durante los primeros 60 segundos, los demás mensajes se agregan a la misma solicitud sin respuestas automáticas. Después de esa ventana, una opción repetida conserva la solicitud y una opción nueva puede crear otra con continuidad del mismo asesor. Al cerrar todas las solicitudes abiertas, la siguiente interacción vuelve al reparto equitativo.

Una conversación abierta y asignada no vuelve a generar el menú por saludos o texto libre. Los mensajes adicionales se conservan en el detalle en tiempo real. Si no hay horario de atención o asesores disponibles, se envía solamente el texto configurado para ese caso. Los ID de mensaje de Meta impiden procesar dos veces un mismo webhook; `confirmacion_en` impide confirmar dos veces la misma solicitud.

## Autorización

- `asesor`: solo su bandeja, sus solicitudes, notas y notificaciones. Puede leer el contexto histórico del mismo contacto dentro del equipo cuando recibe una solicitud nueva; no modifica notas antiguas.
- `supervisor`: ve las solicitudes de sus equipos y puede reasignar todas las abiertas del mismo contacto con motivo auditado.
- `administrador`: además gestiona configuración, opciones, usuarios y equipos del negocio.

La cookie de sesión es persistente y HttpOnly. La sesión dura hasta 365 días y se renueva con actividad cuando quedan menos de 330 días; cerrar sesión la revoca de inmediato. Es una duración práctica larga, sujeta a la política de cookies del navegador y a la revocación por el servidor. Las escrituras requieren cookie y cabecera CSRF iguales al hash de la sesión. Se usa Argon2id para las contraseñas. El login limita intentos por IP y correo en memoria del proceso local.

El panel abre en «Solicitudes», que incluye las cerradas y permite filtrar nuevas, sin atender, en atención y cerradas. Los asesores cambian disponibilidad en la barra superior; el administrador consulta la disponibilidad del equipo en su módulo. En el detalle, «Mensajes recibidos» ocupa la parte superior derecha y el historial del contacto aparece debajo. «Notificaciones» muestra asignaciones, un aviso persistente por solicitud con mensajes nuevos sin leer y anuncios del administrador. Si la asignación ya está sin leer, los mensajes posteriores no crean otro aviso. Al abrir el detalle visible, el navegador reconoce los mensajes hasta el último identificador cargado; un mensaje recibido durante esa lectura queda pendiente. Los avisos y el detalle se sincronizan por SSE sin sondeo periódico. Los anuncios se distribuyen solo a usuarios activos del mismo negocio y su envío queda auditado.

## API principal

| Recurso | Rutas |
| --- | --- |
| Sesión | `POST /sesion/iniciar`, `GET /sesion/actual`, `POST /sesion/cerrar` |
| Perfil | `GET /perfil`, `POST /perfil/heartbeat`, `POST /perfil/disponibilidad` |
| Solicitudes | `GET /solicitudes`, `GET /solicitudes/:id`, `POST /solicitudes/:id/leer`, `POST /solicitudes/:id/iniciar`, `POST /solicitudes/:id/notas`, `POST /solicitudes/:id/cerrar` |
| Notificaciones | `GET /notificaciones`, `POST /notificaciones/:id/leer`, `POST /notificaciones/anuncios` (administrador), `GET /notificaciones/eventos` (SSE) |
| Supervisión | `GET /supervision/resumen`, `POST /supervision/reasignar` |
| Configuración | `GET /configuracion`, `PATCH /configuracion/negocio`, `POST/PATCH /configuracion/opciones`, `POST/PATCH /configuracion/usuarios`, `PATCH /configuracion/equipos` |
| Integración | `GET/POST /webhooks/meta`, `GET /salud` |

PostgreSQL emite `NOTIFY` después del `COMMIT` cuando cambian una solicitud, una notificación, una interacción asociada o una presencia relevante. Una sola conexión `LISTEN` en NestJS distribuye avisos SSE al asesor afectado y a los supervisores del equipo. Los avisos de actualización no incluyen datos de negocio; el panel vuelve a consultar los datos mediante REST con autorización. No hay consultas periódicas a PostgreSQL por cada conexión SSE. El navegador sincroniza al abrir o restablecer SSE y ante avisos, con espera de reconexión de 5 segundos; si la primera apertura tarda más de 2 segundos, hace una única carga inicial. Un error HTTP fatal que deja `EventSource` cerrado activa una única reapertura diferida; los cortes ordinarios usan la reconexión nativa. El heartbeat de presencia permanece cada 45 segundos. El túnel de Cloudflare no transporta SSE.

## Desarrollo y futura producción

En desarrollo, Docker publica web y API solo en `127.0.0.1`. PostgreSQL permanece dentro de la red Docker. El túnel publica únicamente el proxy del webhook. Para producción futura: frontend estático en `https://valana.bostonbbs.com`, API en `https://api.bostonbbs.com`, webhook en `https://api.bostonbbs.com/webhooks/meta`, CORS explícito, cookies Secure, `COOKIE_DOMAIN=.bostonbbs.com` para CSRF, TLS y un proceso persistente para la API y PostgreSQL. Este proyecto no despliega esa configuración todavía.
