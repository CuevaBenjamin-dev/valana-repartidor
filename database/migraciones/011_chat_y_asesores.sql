ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cambio_clave_obligatorio boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS retirado_en timestamptz;

ALTER TABLE mensajes_salientes ADD COLUMN IF NOT EXISTS autor_id uuid REFERENCES usuarios(id);
ALTER TABLE mensajes_salientes ADD COLUMN IF NOT EXISTS clave_idempotencia uuid;
ALTER TABLE mensajes_salientes ADD COLUMN IF NOT EXISTS meta_estado text;
CREATE UNIQUE INDEX IF NOT EXISTS mensajes_salientes_idempotencia
  ON mensajes_salientes(clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;

CREATE OR REPLACE FUNCTION avisar_mensaje_saliente() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destino record;
BEGIN
  IF NEW.solicitud_id IS NOT NULL THEN
    SELECT equipo_id,asesor_id INTO destino FROM solicitudes WHERE id=NEW.solicitud_id;
    IF destino.equipo_id IS NOT NULL THEN
      PERFORM pg_notify('valana_equipo', destino.equipo_id::text);
      IF destino.asesor_id IS NOT NULL THEN
        PERFORM pg_notify('valana_usuario', destino.asesor_id::text);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mensaje_saliente_cambio
AFTER INSERT OR UPDATE OF estado,meta_estado,error_resumen ON mensajes_salientes
FOR EACH ROW EXECUTE FUNCTION avisar_mensaje_saliente();
