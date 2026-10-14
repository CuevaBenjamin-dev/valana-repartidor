-- Campos opcionales de la ficha de admisión de Boston. Los registros previos conservan NULL.
ALTER TABLE solicitudes_web ADD COLUMN nombres_estudiante text;
ALTER TABLE solicitudes_web ADD COLUMN apellido_paterno_estudiante text;
ALTER TABLE solicitudes_web ADD COLUMN apellido_materno_estudiante text;
ALTER TABLE solicitudes_web ADD COLUMN institucion_procedencia text;
ALTER TABLE solicitudes_web ADD COLUMN parentesco_apoderado text;
