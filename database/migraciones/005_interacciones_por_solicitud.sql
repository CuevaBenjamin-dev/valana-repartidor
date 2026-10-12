CREATE INDEX IF NOT EXISTS interacciones_solicitud
ON interacciones_entrantes(solicitud_id,recibida_en DESC,id DESC)
WHERE solicitud_id IS NOT NULL;
