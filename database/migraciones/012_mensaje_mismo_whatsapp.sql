-- Ajusta únicamente frases anteriores que prometían respuesta desde otro número.
UPDATE negocios SET
  mensaje_confirmacion=replace(replace(mensaje_confirmacion,
    'Un asesor académico se comunicará contigo desde otro número de WhatsApp.',
    'Un asesor académico te responderá por este mismo WhatsApp.'),
    'Un asesor académico te escribirá pronto desde su WhatsApp.',
    'Un asesor académico te responderá por este mismo WhatsApp.'),
  mensaje_fuera_horario=replace(mensaje_fuera_horario,
    'Un asesor académico se comunicará contigo desde otro número de WhatsApp.',
    'Un asesor académico te responderá por este mismo WhatsApp.'),
  mensaje_sin_asesor=replace(mensaje_sin_asesor,
    'Un asesor académico se comunicará contigo desde otro número de WhatsApp.',
    'Un asesor académico te responderá por este mismo WhatsApp.')
WHERE mensaje_confirmacion LIKE '%otro número de WhatsApp%'
   OR mensaje_confirmacion LIKE '%desde su WhatsApp%'
   OR mensaje_fuera_horario LIKE '%otro número de WhatsApp%'
   OR mensaje_sin_asesor LIKE '%otro número de WhatsApp%';
