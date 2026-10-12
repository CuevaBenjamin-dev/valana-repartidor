CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS negocios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text NOT NULL,
  zona_horaria text NOT NULL DEFAULT 'America/Lima', activo boolean NOT NULL DEFAULT true,
  dias_atencion integer[] NULL, hora_inicio time NULL, hora_fin time NULL,
  mensaje_menu text NOT NULL DEFAULT '¡Hola! Bienvenido a Boston Bilingual School. ¿Sobre qué tema deseas recibir información?',
  mensaje_confirmacion text NOT NULL DEFAULT 'Gracias por comunicarte con Boston Bilingual School. Hemos recibido tu solicitud. En un momento, uno de nuestros asesores se pondrá en contacto contigo.',
  mensaje_fuera_horario text NOT NULL DEFAULT 'Gracias por comunicarte con Boston Bilingual School. Hemos recibido tu consulta. Nuestro equipo te responderá durante el próximo horario de atención.',
  mensaje_sin_asesor text NOT NULL DEFAULT 'Hemos recibido tu solicitud. Un asesor se pondrá en contacto contigo cuando esté disponible.',
  meta_phone_number_id text UNIQUE, creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS equipos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), negocio_id uuid NOT NULL REFERENCES negocios(id),
  nombre text NOT NULL, activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(), UNIQUE(negocio_id,nombre)
);
CREATE TABLE IF NOT EXISTS usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), negocio_id uuid NOT NULL REFERENCES negocios(id),
  nombre text NOT NULL, correo text NOT NULL, clave_hash text NOT NULL,
  rol text NOT NULL CHECK(rol IN ('asesor','supervisor','administrador')),
  activo boolean NOT NULL DEFAULT true, disponible boolean NOT NULL DEFAULT false,
  presencia_en timestamptz, creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE(negocio_id,correo)
);
CREATE TABLE IF NOT EXISTS miembros_equipo (
  equipo_id uuid NOT NULL REFERENCES equipos(id), usuario_id uuid NOT NULL REFERENCES usuarios(id),
  activo boolean NOT NULL DEFAULT true, PRIMARY KEY(equipo_id,usuario_id)
);
CREATE TABLE IF NOT EXISTS opciones_menu (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), negocio_id uuid NOT NULL REFERENCES negocios(id),
  equipo_id uuid NOT NULL REFERENCES equipos(id), numero integer NOT NULL CHECK(numero > 0),
  identificador text NOT NULL, nombre text NOT NULL, activo boolean NOT NULL DEFAULT true,
  UNIQUE(equipo_id,numero), UNIQUE(equipo_id,identificador)
);
CREATE TABLE IF NOT EXISTS contactos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), negocio_id uuid NOT NULL REFERENCES negocios(id),
  telefono text NOT NULL CHECK(telefono ~ '^\+[1-9][0-9]{6,14}$'),
  nombre_whatsapp text, nombre_confirmado text,
  primer_contacto_en timestamptz NOT NULL DEFAULT now(), ultima_interaccion_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE(negocio_id,telefono)
);
CREATE TABLE IF NOT EXISTS jornadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), equipo_id uuid NOT NULL REFERENCES equipos(id),
  fecha_local date NOT NULL, creada_en timestamptz NOT NULL DEFAULT now(), UNIQUE(equipo_id,fecha_local)
);
CREATE TABLE IF NOT EXISTS contadores_jornada (
  jornada_id uuid NOT NULL REFERENCES jornadas(id), usuario_id uuid NOT NULL REFERENCES usuarios(id),
  solicitudes_reales integer NOT NULL DEFAULT 0, contador_ajustado integer NOT NULL DEFAULT 0,
  ajustes_nivelacion integer NOT NULL DEFAULT 0, asignaciones_continuidad integer NOT NULL DEFAULT 0,
  asignaciones_reparto integer NOT NULL DEFAULT 0, elegible_anterior boolean NOT NULL DEFAULT false,
  PRIMARY KEY(jornada_id,usuario_id),
  CHECK(solicitudes_reales >= 0 AND contador_ajustado >= 0 AND ajustes_nivelacion >= 0)
);
CREATE TABLE IF NOT EXISTS solicitudes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL UNIQUE,
  negocio_id uuid NOT NULL REFERENCES negocios(id), equipo_id uuid NOT NULL REFERENCES equipos(id),
  contacto_id uuid NOT NULL REFERENCES contactos(id), opcion_id uuid NOT NULL REFERENCES opciones_menu(id),
  asesor_id uuid REFERENCES usuarios(id),
  estado text NOT NULL CHECK(estado IN ('pendiente_asignacion','pendiente','en_atencion','cerrada')),
  resultado_comercial text,
  creada_en timestamptz NOT NULL DEFAULT now(), asignada_en timestamptz,
  atencion_iniciada_en timestamptz, cerrada_en timestamptz,
  CHECK ((estado = 'pendiente_asignacion' AND asesor_id IS NULL) OR (estado <> 'pendiente_asignacion' AND asesor_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS solicitudes_abiertas_unicas ON solicitudes(contacto_id,equipo_id,opcion_id) WHERE estado <> 'cerrada';
CREATE INDEX IF NOT EXISTS solicitudes_bandeja ON solicitudes(equipo_id,asesor_id,estado,creada_en DESC);
CREATE INDEX IF NOT EXISTS solicitudes_contacto ON solicitudes(contacto_id,equipo_id,creada_en DESC);
CREATE TABLE IF NOT EXISTS notas_solicitud (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), solicitud_id uuid NOT NULL REFERENCES solicitudes(id),
  autor_id uuid NOT NULL REFERENCES usuarios(id), texto text NOT NULL,
  creada_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS interacciones_entrantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), meta_mensaje_id text NOT NULL UNIQUE,
  negocio_id uuid NOT NULL REFERENCES negocios(id), contacto_id uuid NOT NULL REFERENCES contactos(id),
  solicitud_id uuid REFERENCES solicitudes(id), tipo text NOT NULL, texto text,
  recibida_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interacciones_contacto ON interacciones_entrantes(contacto_id,recibida_en DESC);
CREATE TABLE IF NOT EXISTS notificaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), usuario_id uuid NOT NULL REFERENCES usuarios(id),
  solicitud_id uuid NOT NULL REFERENCES solicitudes(id), tipo text NOT NULL,
  texto text NOT NULL, leida_en timestamptz, creada_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notificaciones_usuario ON notificaciones(usuario_id,creada_en DESC);
CREATE TABLE IF NOT EXISTS historial_asignaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), solicitud_id uuid NOT NULL REFERENCES solicitudes(id),
  asesor_anterior_id uuid REFERENCES usuarios(id), asesor_nuevo_id uuid NOT NULL REFERENCES usuarios(id),
  usuario_actor_id uuid REFERENCES usuarios(id), motivo text NOT NULL,
  jornada_id uuid REFERENCES jornadas(id), creada_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS eventos_webhook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), meta_mensaje_id text NOT NULL UNIQUE,
  negocio_id uuid NOT NULL REFERENCES negocios(id), carga jsonb NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','procesado','error')),
  intentos integer NOT NULL DEFAULT 0, siguiente_intento_en timestamptz NOT NULL DEFAULT now(),
  error_resumen text, recibido_en timestamptz NOT NULL DEFAULT now(), procesado_en timestamptz
);
CREATE INDEX IF NOT EXISTS eventos_pendientes ON eventos_webhook(estado,siguiente_intento_en);
CREATE TABLE IF NOT EXISTS mensajes_salientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), negocio_id uuid NOT NULL REFERENCES negocios(id),
  contacto_id uuid NOT NULL REFERENCES contactos(id), solicitud_id uuid REFERENCES solicitudes(id),
  texto text NOT NULL, estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','enviado','error','omitido')),
  intentos integer NOT NULL DEFAULT 0, siguiente_intento_en timestamptz NOT NULL DEFAULT now(),
  meta_mensaje_id text, error_resumen text, creado_en timestamptz NOT NULL DEFAULT now(), enviado_en timestamptz
);
CREATE INDEX IF NOT EXISTS mensajes_pendientes ON mensajes_salientes(estado,siguiente_intento_en);
CREATE TABLE IF NOT EXISTS sesiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), usuario_id uuid NOT NULL REFERENCES usuarios(id),
  token_hash text NOT NULL UNIQUE, csrf_hash text NOT NULL,
  expira_en timestamptz NOT NULL, creada_en timestamptz NOT NULL DEFAULT now(), revocada_en timestamptz
);
CREATE INDEX IF NOT EXISTS sesiones_usuario ON sesiones(usuario_id,expira_en);
CREATE TABLE IF NOT EXISTS registro_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), negocio_id uuid NOT NULL REFERENCES negocios(id),
  usuario_id uuid REFERENCES usuarios(id), entidad text NOT NULL, entidad_id uuid NOT NULL,
  accion text NOT NULL, detalle jsonb NOT NULL DEFAULT '{}', creada_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auditoria_negocio ON registro_auditoria(negocio_id,creada_en DESC);
