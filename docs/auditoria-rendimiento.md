# Auditoría técnica de rendimiento y confiabilidad — Valana Repartidor V1

**Fecha:** 12 de octubre de 2026 (America/Lima). **Entorno medido:** Docker local, PostgreSQL 18, una instancia de API y una web estática. No se enviaron mensajes de carga a Meta. Las pruebas crearon negocios, usuarios y números sintéticos aislados y retiraron sus filas al terminar.

## Resultado ejecutivo

El reparto y la cola persistente funcionaron con 4, 10 y 50 asesores simultáneos: todas las solicitudes se crearon una sola vez y la distribución de la prueba quedó en una por asesor. La conexión dedicada `LISTEN` recuperó sus tres canales en 3,0 segundos tras terminar su sesión PostgreSQL. El trabajador respondió a una señal en 113 ms; su revisión de 30 segundos recupera trabajos persistidos si se pierde una señal.

Se verificó una brecha en el cliente SSE: la primera apertura no sincronizaba los datos y una respuesta HTTP 503 podía dejar el `EventSource` cerrado sin recuperación nativa. Con aprobación del usuario, se corrigieron ambos casos, se fijó `retry: 5000` y se retiró el sondeo de respaldo de 60 segundos. El cliente ahora consulta al abrir/restablecer SSE y ante avisos; agrupa avisos cercanos y descarta resultados anteriores a una señal nueva. En una apertura normal hace **una** carga inicial; si SSE tarda más de 2 segundos, hace **una única** carga inicial de respaldo, sin repetición periódica. Un cierre HTTP fatal causa **una** reapertura diferida; los cortes ordinarios siguen a cargo de `EventSource`.

No se cambió la distribución comercial, el heartbeat de presencia, el esquema, los índices ni la infraestructura. No se activó limpieza automática.

## Hallazgos por componente

| Área | Evidencia del código y de la prueba | Estado / riesgo |
| --- | --- | --- |
| `LISTEN/NOTIFY` | `ActualizacionEnVivo` utiliza un `pg.Client` aparte del pool, escucha `valana_usuario`, `valana_equipo` y `valana_trabajos`, detecta `error`/`end`, cierra los SSE antiguos y reintenta a los 3 s. Tras `pg_terminate_backend`, reconectó en **3.033 ms** y recuperó los tres canales. | Correcto. `NOTIFY` es una señal transitoria: las solicitudes, notificaciones y trabajos son filas persistentes. Una señal perdida se recupera por REST al reconectar y por la revisión de cola. |
| SSE y permisos | Cada suscripción guarda su respuesta en conjuntos por usuario/equipo; `close` limpia el conjunto, temporizador de comentario de 25 s y vencimiento de sesión. Asesores solo se suscriben a su ID; supervisores/administradores a sus equipos. La señal lleva `{}`; los datos llegan por rutas REST que vuelven a verificar sesión, negocio, equipo y asesor. Una prueba con otro asesor recibió **404** al leer una solicitud ajena y **ninguna** señal privada. | Sin fuga observada en la prueba corta. `res.write` no trata explícitamente el retorno `false` de presión de escritura: un cliente extremadamente lento podría acumular pequeños avisos; vigilar antes de aumentar tráfico. Una sesión revocada mientras el SSE ya está abierto conserva el canal hasta el siguiente cierre/vencimiento, aunque no puede obtener datos por REST. |
| Recuperación SSE | Antes: primera apertura sin lectura de recuperación, sondeo de 60 s cuando caía SSE y HTTP 503 fatal. Después: sincronización en cada `onopen`, `retry: 5000`, reapertura manual solo si `readyState=CLOSED`, y sin sondeo periódico de datos. La primera apertura normal usa una sola lectura; una carga única a los 2 s cubre el arranque sin SSE. | Corregido y probado en navegador aislado. El heartbeat de presencia de 45 s y el comentario SSE de 25 s permanecen. |
| Presencia | `POST /perfil/heartbeat` cada 45 s **por pestaña**; umbral de elegibilidad de 120 s. Cuatro pestañas de asesores implican ~0,089 llamadas/s; 50 asesores con una pestaña, ~1,11 llamadas/s; 50 con tres, ~3,33 llamadas/s. | No se observó cuello de botella que justifique cambiarlo. Una pestaña suspendida en segundo plano más de 120 s puede figurar temporalmente desconectada; se restablece al reanudar su heartbeat. Se mantiene por la condición expresa de no tocarlo. |
| Trabajador | `valana_trabajos` llama a `despertar()` inmediatamente; `ocupado`/`repetir` impiden ciclos concurrentes en el proceso. Revisión con `setInterval` cada 30 s; bloques de hasta 20 entrantes y 10 salientes, `FOR UPDATE SKIP LOCKED`, retroceso exponencial y límite de 10 fallos. `docker top` mostró **un** proceso `node apps/api/dist/main.js`. | Señal a procesamiento: **113 ms**. Un evento sintético programado quedó procesado en 32,4 s en la prueba inicial y en 7,0 s en la posterior (esta segunda ejecución recibió otro despertar; no mide el límite del temporizador). No se enviaron salidas sintéticas a Meta. |
| Transacciones y reparto | Los eventos entrantes se guardan antes de confirmar el webhook. Procesamiento, solicitud, contador e historial se confirman juntos. Los bloqueos de equipo/filas serializan el reparto; la prueba concurrente mantuvo una asignación por asesor. | Correcto en 4/10/50. El envío saliente hace la llamada a Meta dentro de una transacción; si Meta acepta y el proceso cae antes del `COMMIT`, un reintento podría duplicar el mensaje externo. Es un riesgo de entrega externa que exige diseño y aprobación aparte. |
| Pool e índices | `pg.Pool` máximo 20, timeout de adquisición 5 s e inactividad 30 s, más un oyente dedicado. PostgreSQL permite 100 conexiones. Índices de cola, token de sesión y contadores existen y registran uso; no se demostró un índice faltante a esta escala. | En reposo se vieron 3 conexiones; en la prueba de 50, 22–23 incluyendo las conexiones del harness. Si se multiplican instancias API, sumar `20 × instancias + oyentes` antes de ampliar. |
| Autovacuum y disco | `autovacuum` está activo: después de la carga, `solicitudes` registraba 5 ejecuciones, `contadores_jornada` 7 y `sesiones` 2. La cola `NOTIFY` marcó 0 en todas las muestras. | Las páginas liberadas se reutilizan; `pg_database_size` no vuelve necesariamente al tamaño anterior. No se justifica una purga diaria. |

## Mediciones antes y después

### Carga sintética de distribución

Las consultas de esta tabla son **sentencias SQL del camino de distribución contadas por el harness**, no todas las consultas del servidor (REST, autorización y comprobaciones de salud quedan fuera). Se ejecutó una solicitud nueva por asesor, simultáneamente. El valor de SQL/s es `sentencias / duración del lote`, por lo que describe la ráfaga y no consumo continuo.

| Asesores | Antes: duración / p95 / SQL / SQL/s | Después: duración / p95 / SQL / SQL/s | Corrección de reparto y SSE posterior |
| ---: | --- | --- | --- |
| 4 | 464 ms / 463 ms / 128 / 276,1 | 526 ms / 526 ms / 128 / 243,2 | 4 solicitudes, 4 asesores, 0 errores; 3/3 SSE de asesores conectados y supervisor avisado. |
| 10 | 759 ms / 759 ms / 440 / 579,7 | 1.262 ms / 1.261 ms / 440 / 348,8 | 10 solicitudes, 10 asesores, 0 errores; 9/9 SSE y supervisor avisado. |
| 50 | 4.813 ms / 4.645 ms / 6.200 / 1.288,2 | **5.554 ms / 5.405 ms / 6.200 / 1.116,2** sin muestreo simultáneo | 50 solicitudes, 50 asesores, 0 errores; 49/49 SSE y supervisor avisado. |

La primera ejecución posterior de 50 asesores coincidió con muestreo intensivo de `docker stats` y tardó 7.307 ms (p95 7.117 ms); al repetirla sin ese muestreo tardó 5.554 ms. Las duraciones antes/después son muestras locales únicas bajo distinta carga del equipo y **no prueban una regresión ni una mejora porcentual**. El mismo número de 6.200 sentencias del camino de reparto y la misma corrección del resultado se mantuvieron. El crecimiento de 128 → 440 → 6.200 sentencias muestra que el coste de la ráfaga aumenta más que linealmente al incorporar asesores; conviene vigilar la latencia real antes de 50 usuarios activos, sin modificar ahora la lógica aprobada.

### Recursos, reposo y almacenamiento

| Métrica | Antes | Después / interpretación |
| --- | ---: | --- |
| Transacciones PostgreSQL en reposo | 16 en 35,583 s = **0,45/s** | 9 en 20 s = **0,45/s**. Incluye comprobaciones y actividad de otras sesiones; no equivale a SQL/s exacto. |
| Consultas SQL programadas en reposo por código | Trabajador: 2 `SELECT`/30 s ≈ **0,067/s**; salud API: 1 `SELECT 1`/10 s ≈ **0,1/s** | Igual. SSE abierto envía comentarios cada 25 s sin SQL. El heartbeat de cada pestaña añade consultas de sesión/presencia cada 45 s. Se eliminó el sondeo de datos SSE de 60 s en desconexión. |
| SQL/s de carga | Hasta 1.288,2 sentencias/s del harness en la ráfaga de 50 | 1.116,2 sentencias/s en la repetición de 50 sin muestreo. Es tasa instantánea del lote, no promedio de producción. |
| Backend API, RSS con 50 | Pico **110,20 MiB**, poscarga ~45,68 MiB | Pico **113,90 MiB**, poscarga ~39 MiB; no se observó crecimiento sostenido en la ventana corta. |
| PostgreSQL, RSS con 50 | Pico **97,59 MiB** | Pico **95,92 MiB**, poscarga ~34 MiB. |
| CPU de contenedor con 50 | Pico API 65,58 %; PG 70,31 % | Durante muestreo simultáneo, API 104,69 %; PG 106,62 %. Docker puede superar 100 % al usar más de un núcleo. Las muestras no son equivalentes en carga del host. |
| Base de datos | ~9,3 MiB iniciales; pico de 10.565.311 bytes durante 50 | Pico de 10.639.039 bytes en una ráfaga; 10.188.479 bytes tras limpieza/autovacuum. El espacio puede permanecer reservado para reutilización. |
| Volumen PostgreSQL / WAL físico | ~64,3 MiB / ~32 MiB | `du`: 66 MiB / 33 MiB. `pg_stat_wal.wal_bytes` era 23.770.159 bytes acumulados desde su reinicio estadístico, **no** tamaño actual en disco. Una ráfaga de 50 añadió ~1,25–1,67 MiB de WAL según la muestra. |
| Cola de `NOTIFY` / trabajos pendientes | 0 / 0 al inspeccionar | 0 / 0 tras las pruebas. |

`shared_preload_libraries` está vacío, por lo que **no está disponible `pg_stat_statements`**. No se puede afirmar una cifra exacta de sentencias SQL/s de toda la API en reposo sin habilitar instrumentación adicional. Se informan por separado transacciones/s observadas, consultas periódicas deducidas del código y sentencias de la carga contadas en el harness. No se cambió la configuración PostgreSQL para obtener esta auditoría.

## Pruebas de desconexión y regresión

- `npm test`: 1 archivo, **3/3** pruebas unitarias aprobadas.
- `pruebas/integracion.mjs`: continuidad, repetición, nivelación, jornadas y concurrencia aprobadas.
- `pruebas/en-vivo.mjs`: cabecera SSE `retry: 5000`, notificación al asesor correcto, señal de equipo al supervisor, y ausencia de señal privada para otro asesor; solicitud ajena devuelve **404**.
- `pruebas/trabajos-aviso.mjs`: trabajo sintético procesado en **113 ms** desde la señal, sin llamada real a Meta.
- `pruebas/auditoria-recuperacion.mjs`: terminación forzada del oyente PostgreSQL, reconexión y nueva suscripción en **3.033 ms**; aviso posterior recibido y trabajo persistente procesado.
- `pruebas/auditoria-carga.mjs` con 4/10/50: **0 errores**, reparto una vez por asesor, recuperación por REST de la notificación creada mientras el asesor estaba desconectado y señal recibida tras reconectar. Los mensajes salientes sintéticos permanecieron en estado pendiente durante la medición y se retiraron al limpiar el negocio de prueba.
- Navegador aislado con `pruebas/auditoria-sse-browser-init.js`: primer `onopen` produjo **una** lectura inicial; un evento elevó la consulta de solicitudes de 1 a 2; durante un corte no hubo nuevas lecturas, y al reabrir pasó a 3 y apareció la solicitud creada durante el corte. Diez avisos mientras una lectura estaba retrasada generaron solo una lectura de seguimiento (3 → 5) y el dato nuevo prevaleció. Un error fatal dejó el canal cerrado, causó una comprobación de sesión y abrió **un** nuevo canal tras ~5 s (5 → 6 consultas), con la solicitud nueva visible. En una segunda carga con SSE sin abrir, hubo una lectura única tras 2 s y ninguna nueva durante los siguientes 2,6 s. Diez avisos de una misma notificación dejaron **una** fila visible. La pestaña de prueba se cerró al terminar.

El navegador utilizó transporte y respuestas REST simuladas para probar la lógica del cliente sin tocar datos de producción; las pruebas de API/DB anteriores comprobaron el transporte y la autorización reales. La prueba de 50 fue corta y local: no establece capacidad garantizada para 50 asesores durante una jornada completa ni para varias instancias de API.

## Retención y próximos pasos

No se activó ninguna eliminación. **Conservar** contactos, solicitudes, interacciones, notas, historial de asignación, auditoría, mensajes salientes necesarios para trazabilidad, trabajos pendientes y `meta_mensaje_id` de entrada/salida para deduplicación. Borrar mensajes o solicitudes al día siguiente dañaría el historial comercial.

Las únicas candidatas técnicas a una política futura son sesiones expiradas/revocadas (24 filas, tabla de ~96 KiB en esta muestra) y la carga JSON de `eventos_webhook` ya procesados tras un plazo definido, manteniendo ID, estado, fecha y clave de deduplicación. `eventos_webhook` ocupaba ~64 KiB con cinco filas vivas al cierre. Una política exige antes plazo de conservación, respaldo y prueba de restauración. Las notificaciones leídas también son visibles al usuario; no se recomienda purgarlas sin política del negocio.

**Recomendaciones pendientes, sin aplicar:** medir latencia y tamaño de tablas durante uso real; vigilar la presión de escritura de SSE con clientes lentos; decidir si la revocación de sesión debe cerrar SSE de inmediato; estudiar la ventana de duplicación del envío externo a Meta; y, antes de escalar procesos API o a decenas de asesores con actividad sostenida, instrumentar consultas globales y revisar el límite de conexiones. Ninguna requiere Redis ni servicios adicionales para la escala medida hoy.

Referencias técnicas: [PostgreSQL `NOTIFY`](https://www.postgresql.org/docs/current/sql-notify.html), [estadísticas de PostgreSQL](https://www.postgresql.org/docs/current/monitoring-stats.html), [VACUUM](https://www.postgresql.org/docs/current/routine-vacuuming.html), [EventSource](https://html.spec.whatwg.org/multipage/server-sent-events.html).
