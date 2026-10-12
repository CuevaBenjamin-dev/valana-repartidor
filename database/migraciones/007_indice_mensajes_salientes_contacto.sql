CREATE INDEX IF NOT EXISTS idx_mensajes_salientes_contacto_fecha
  ON mensajes_salientes(contacto_id, creado_en DESC);
