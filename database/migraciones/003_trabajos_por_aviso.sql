-- El aviso despierta al trabajador tras el COMMIT; las filas siguen siendo la cola duradera.
-- PostgreSQL agrupa avisos idénticos emitidos dentro de una misma transacción.
CREATE FUNCTION avisar_trabajo_meta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('valana_trabajos', '');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trabajo_entrante_nuevo
AFTER INSERT ON eventos_webhook
FOR EACH ROW EXECUTE FUNCTION avisar_trabajo_meta();

CREATE TRIGGER trabajo_saliente_nuevo
AFTER INSERT ON mensajes_salientes
FOR EACH ROW EXECUTE FUNCTION avisar_trabajo_meta();
