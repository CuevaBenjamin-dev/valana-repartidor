-- Formularios nuevos de Boston. Las solicitudes de WhatsApp conservan su modelo y mensajes.
CREATE TABLE solicitudes_web (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id uuid NOT NULL REFERENCES negocios(id),
  equipo_id uuid NOT NULL REFERENCES equipos(id),
  origen_tipo text NOT NULL CHECK (origen_tipo IN ('postulacion','contacto')),
  origen_id bigint NOT NULL CHECK (origen_id > 0),
  nombre text NOT NULL,
  correo text NOT NULL,
  telefono text,
  idioma text NOT NULL CHECK (idioma IN ('es','en')),
  medio_contacto text,
  estudiante text,
  edad_estudiante integer,
  grado text,
  asunto text,
  mensaje text,
  asesor_id uuid REFERENCES usuarios(id),
  estado text NOT NULL DEFAULT 'pendiente_asignacion'
    CHECK (estado IN ('pendiente_asignacion','pendiente','en_atencion','cerrada')),
  creada_en timestamptz NOT NULL,
  recibida_en timestamptz NOT NULL DEFAULT now(),
  asignada_en timestamptz,
  atencion_iniciada_en timestamptz,
  cerrada_en timestamptz,
  UNIQUE (origen_tipo,origen_id),
  CHECK ((estado='pendiente_asignacion' AND asesor_id IS NULL)
    OR (estado<>'pendiente_asignacion' AND asesor_id IS NOT NULL))
);
CREATE INDEX solicitudes_web_bandeja ON solicitudes_web(equipo_id,asesor_id,estado,creada_en DESC);
CREATE TABLE notas_solicitud_web (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id uuid NOT NULL REFERENCES solicitudes_web(id),
  autor_id uuid NOT NULL REFERENCES usuarios(id),
  texto text NOT NULL,
  creada_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notas_web_solicitud ON notas_solicitud_web(solicitud_id,creada_en);
CREATE TABLE notificaciones_web (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  solicitud_id uuid NOT NULL REFERENCES solicitudes_web(id),
  tipo text NOT NULL DEFAULT 'nueva_solicitud',
  leida_en timestamptz,
  creada_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE(usuario_id,solicitud_id,tipo)
);
CREATE INDEX notificaciones_web_usuario ON notificaciones_web(usuario_id,creada_en DESC);
CREATE FUNCTION avisar_solicitud_web_equipo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('valana_equipo', NEW.equipo_id::text);
  RETURN NEW;
END;
$$;
CREATE TRIGGER solicitud_web_equipo_cambio AFTER INSERT OR UPDATE OF estado,asesor_id
ON solicitudes_web FOR EACH ROW EXECUTE FUNCTION avisar_solicitud_web_equipo();
CREATE FUNCTION avisar_notificacion_web_usuario() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('valana_usuario', NEW.usuario_id::text);
  RETURN NEW;
END;
$$;
CREATE TRIGGER notificacion_web_usuario_cambio AFTER INSERT OR UPDATE OF leida_en
ON notificaciones_web FOR EACH ROW EXECUTE FUNCTION avisar_notificacion_web_usuario();
CREATE FUNCTION avisar_nota_web_equipo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destino uuid;
BEGIN
  SELECT equipo_id INTO destino FROM solicitudes_web WHERE id=NEW.solicitud_id;
  IF destino IS NOT NULL THEN PERFORM pg_notify('valana_equipo',destino::text); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nota_web_equipo_cambio AFTER INSERT ON notas_solicitud_web
FOR EACH ROW EXECUTE FUNCTION avisar_nota_web_equipo();
