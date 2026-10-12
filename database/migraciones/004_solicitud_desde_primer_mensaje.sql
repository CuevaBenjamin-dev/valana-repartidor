-- Una solicitud sin opción reconocida conserva su clasificación pendiente.
ALTER TABLE solicitudes ALTER COLUMN opcion_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS solicitudes_generales_abiertas_unicas
ON solicitudes(contacto_id,equipo_id)
WHERE estado <> 'cerrada' AND opcion_id IS NULL;

-- El contenido viaja por REST con permisos; PostgreSQL solo avisa a los destinatarios.
CREATE FUNCTION avisar_interaccion_solicitud() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destino record;
BEGIN
  SELECT equipo_id,asesor_id INTO destino FROM solicitudes WHERE id=NEW.solicitud_id;
  IF destino.equipo_id IS NOT NULL THEN
    PERFORM pg_notify('valana_equipo', destino.equipo_id::text);
    IF destino.asesor_id IS NOT NULL THEN
      PERFORM pg_notify('valana_usuario', destino.asesor_id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER interaccion_solicitud_cambio
AFTER UPDATE OF solicitud_id ON interacciones_entrantes
FOR EACH ROW WHEN (NEW.solicitud_id IS NOT NULL AND NEW.solicitud_id IS DISTINCT FROM OLD.solicitud_id)
EXECUTE FUNCTION avisar_interaccion_solicitud();
