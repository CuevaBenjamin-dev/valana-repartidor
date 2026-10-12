ALTER TABLE solicitudes ADD COLUMN confirmacion_en timestamptz;

-- Las solicitudes existentes recibieron una respuesta antes de esta migración.
-- No se les vuelve a enviar una confirmación si se clasifican posteriormente.
UPDATE solicitudes s SET confirmacion_en=m.primera_respuesta
FROM (
  SELECT solicitud_id,min(creado_en) AS primera_respuesta
  FROM mensajes_salientes WHERE solicitud_id IS NOT NULL GROUP BY solicitud_id
) m WHERE s.id=m.solicitud_id;
