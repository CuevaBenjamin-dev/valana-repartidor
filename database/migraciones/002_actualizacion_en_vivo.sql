-- PostgreSQL entrega las notificaciones solo después del COMMIT.
-- La carga contiene únicamente identificadores; los datos se consultan con autorización REST.
CREATE FUNCTION avisar_notificacion_usuario() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('valana_usuario', NEW.usuario_id::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER notificacion_usuario_cambio
AFTER INSERT OR UPDATE OF leida_en ON notificaciones
FOR EACH ROW EXECUTE FUNCTION avisar_notificacion_usuario();

CREATE FUNCTION avisar_solicitud_equipo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('valana_equipo', NEW.equipo_id::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER solicitud_equipo_cambio
AFTER INSERT OR UPDATE OF estado, asesor_id, asignada_en, cerrada_en ON solicitudes
FOR EACH ROW EXECUTE FUNCTION avisar_solicitud_equipo();

CREATE FUNCTION avisar_nota_equipo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destino uuid;
BEGIN
  SELECT equipo_id INTO destino FROM solicitudes WHERE id=NEW.solicitud_id;
  IF destino IS NOT NULL THEN PERFORM pg_notify('valana_equipo', destino::text); END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nota_equipo_cambio
AFTER INSERT ON notas_solicitud
FOR EACH ROW EXECUTE FUNCTION avisar_nota_equipo();

CREATE FUNCTION avisar_presencia_equipo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE miembro record;
BEGIN
  IF NEW.disponible IS DISTINCT FROM OLD.disponible
    OR NEW.activo IS DISTINCT FROM OLD.activo
    OR (NEW.presencia_en IS NOT NULL AND (OLD.presencia_en IS NULL OR OLD.presencia_en < now()-interval '2 minutes')) THEN
    FOR miembro IN SELECT equipo_id FROM miembros_equipo WHERE usuario_id=NEW.id AND activo LOOP
      PERFORM pg_notify('valana_equipo', miembro.equipo_id::text);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER presencia_equipo_cambio
AFTER UPDATE OF disponible, activo, presencia_en ON usuarios
FOR EACH ROW EXECUTE FUNCTION avisar_presencia_equipo();
