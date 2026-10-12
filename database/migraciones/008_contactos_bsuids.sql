-- El teléfono puede ocultarse cuando el remitente usa un nombre de usuario.
-- El BSUID es el identificador estable del contacto en el negocio.
ALTER TABLE contactos ALTER COLUMN telefono DROP NOT NULL;
ALTER TABLE contactos ADD COLUMN meta_user_id text;
ALTER TABLE contactos ADD COLUMN username_whatsapp text;
ALTER TABLE contactos ADD CONSTRAINT contactos_identificador_meta
  CHECK (telefono IS NOT NULL OR meta_user_id IS NOT NULL);
CREATE UNIQUE INDEX contactos_negocio_meta_user_id
  ON contactos(negocio_id,meta_user_id) WHERE meta_user_id IS NOT NULL;
