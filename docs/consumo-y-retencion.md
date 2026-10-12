# Consumo y conservación de datos

## Actualización en vivo

- PostgreSQL emite `NOTIFY` solo cuando cambia una solicitud, nota, notificación, presencia relevante o entra trabajo de Meta. La carga del aviso contiene un identificador o está vacía.
- La API mantiene una conexión `LISTEN` para toda la instancia y distribuye los avisos a las conexiones SSE de las sesiones autorizadas. El comentario SSE cada 25 segundos mantiene la conexión abierta y no ejecuta una consulta SQL.
- El panel consulta sus datos al abrir o restablecer SSE y al recibir un aviso. Si la primera apertura tarda más de 2 segundos, realiza una única carga inicial para que la pantalla no quede vacía. Agrupa los avisos cercanos y descarta respuestas anteriores a un aviso nuevo. No hay sondeo periódico de datos; `EventSource` usa una espera de reconexión de 5 segundos. Solo si un error HTTP deja `EventSource` en estado `CLOSED`, el panel crea un nuevo canal tras 5 segundos. Cada pestaña abierta envía su heartbeat de presencia cada 45 segundos.
- El trabajador de Meta se despierta con `NOTIFY` cuando se inserta un evento entrante o un mensaje saliente. Revisa las colas cada 30 segundos para reintentos programados, recuperación tras una desconexión y avisos perdidos. Sin trabajo, esto equivale a dos comprobaciones de cola por ciclo, unas 5.760 al día; antes eran unas 86.400 al día. Son consultas al PostgreSQL local, no a Upstash ni a Meta.
- Los registros de `eventos_webhook` y `mensajes_salientes` son la cola duradera. Un `NOTIFY` no sustituye esos registros: si la API está apagada, puede continuar al arrancar. La entrega en vivo es una señal para volver a consultar; no es el historial.

## Almacenamiento

`LISTEN/NOTIFY` utiliza una cola temporal interna de PostgreSQL. Sus avisos no son registros de conversación ni filas que requieran una limpieza diaria. Sí crecen las tablas de negocio al recibir mensajes: `interacciones_entrantes`, `mensajes_salientes`, `solicitudes`, `notas_solicitud`, `historial_asignaciones` y `registro_auditoria`. `eventos_webhook` guarda además la carga técnica recibida y el identificador de Meta para evitar procesar duplicados. `sesiones` guarda sesiones de acceso, incluso después de que expiran, hasta que exista una política de limpieza.

No borrar automáticamente conversaciones, solicitudes, notas, asignaciones ni auditoría al día siguiente. La pantalla de detalle e historial depende de esos datos. Una política de retención futura puede eliminar sesiones expiradas y compactar cargas técnicas de `eventos_webhook` ya procesadas, conservando el identificador de Meta para deduplicación. Antes de activar una política para notificaciones leídas o mensajes salientes hay que fijar el plazo de conservación del negocio y verificar los respaldos.

## Medición local

```sql
SELECT pg_notification_queue_usage();
SELECT pg_size_pretty(pg_database_size(current_database()));
SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC;
```

El tamaño incluye páginas e índices, no solo el texto de las filas. Una lectura puntual no predice el consumo futuro: revisar la tendencia semanal y la cantidad de sesiones/pestañas activas antes de ajustar frecuencia o retención.
El volumen de PostgreSQL también incluye WAL y archivos del sistema; por eso `pg_database_size` es menor que el espacio total que ocupa el volumen Docker.
