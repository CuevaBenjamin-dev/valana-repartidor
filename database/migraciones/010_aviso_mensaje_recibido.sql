-- Un aviso reutilizable por asesor y solicitud evita una fila por cada mensaje.
CREATE UNIQUE INDEX notificaciones_mensaje_recibido_unico
ON notificaciones(usuario_id,solicitud_id)
WHERE tipo='mensaje_recibido';
