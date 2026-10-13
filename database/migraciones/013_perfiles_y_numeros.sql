ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS apellidos text NOT NULL DEFAULT '';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS celular_personal text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_perfil text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='usuarios_celular_personal_formato') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_celular_personal_formato
      CHECK (celular_personal IS NULL OR celular_personal ~ '^\+[1-9][0-9]{6,14}$');
  END IF;
END $$;

-- El bloqueo impide altas concurrentes durante la asignación inicial.
LOCK TABLE solicitudes IN ACCESS EXCLUSIVE MODE;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS numero bigint;

WITH pendientes AS (
  SELECT id,negocio_id,
    row_number() OVER (PARTITION BY negocio_id ORDER BY creada_en,id) AS posicion
  FROM solicitudes WHERE numero IS NULL
), maximos AS (
  SELECT negocio_id,max(numero) AS ultimo FROM solicitudes
  WHERE numero IS NOT NULL GROUP BY negocio_id
)
UPDATE solicitudes s SET numero=coalesce(m.ultimo,0)+p.posicion
FROM pendientes p LEFT JOIN maximos m ON m.negocio_id=p.negocio_id
WHERE s.id=p.id;

CREATE TABLE IF NOT EXISTS contadores_solicitudes (
  negocio_id uuid PRIMARY KEY REFERENCES negocios(id),
  siguiente_numero bigint NOT NULL CHECK (siguiente_numero > 0)
);
INSERT INTO contadores_solicitudes(negocio_id,siguiente_numero)
SELECT negocio_id,max(numero)+1 FROM solicitudes GROUP BY negocio_id
ON CONFLICT (negocio_id) DO UPDATE SET
  siguiente_numero=greatest(contadores_solicitudes.siguiente_numero,excluded.siguiente_numero);

ALTER TABLE solicitudes ALTER COLUMN numero SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='solicitudes_numero_positivo') THEN
    ALTER TABLE solicitudes ADD CONSTRAINT solicitudes_numero_positivo CHECK (numero > 0);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS solicitudes_numero_negocio ON solicitudes(negocio_id,numero);

CREATE OR REPLACE FUNCTION asignar_numero_solicitud() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS NOT NULL THEN
    RAISE EXCEPTION 'El número correlativo lo asigna la base de datos';
  END IF;
  INSERT INTO contadores_solicitudes(negocio_id,siguiente_numero)
    VALUES (NEW.negocio_id,2)
    ON CONFLICT (negocio_id) DO UPDATE SET
      siguiente_numero=contadores_solicitudes.siguiente_numero+1
    RETURNING siguiente_numero-1 INTO NEW.numero;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='asignar_numero_solicitud_antes') THEN
    CREATE TRIGGER asignar_numero_solicitud_antes
      BEFORE INSERT ON solicitudes FOR EACH ROW EXECUTE FUNCTION asignar_numero_solicitud();
  END IF;
END $$;
