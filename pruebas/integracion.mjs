import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { Bd }=require('../apps/api/dist/bd.js');
const { Repartidor }=require('../apps/api/dist/repartidor.js');
const { SolicitudesController }=require('../apps/api/dist/api.js');
const bd=new Bd(),repartidor=new Repartidor(bd),sufijo=randomUUID().slice(0,8);
const solicitudesApi=new SolicitudesController(bd);
let negocioId,equipoId;
const telefono=n=>`+519${String(n).padStart(8,'0')}`;
async function mensaje(n,id,texto){await bd.transaccion(c=>repartidor.procesarMensaje(c,negocioId,{id:`prueba-${sufijo}-${n}-${id}`,telefono:telefono(n),tipo:'text',texto}));}
async function mensajePrivado(id,texto,extra={}){await bd.transaccion(c=>repartidor.procesarMensaje(c,negocioId,
  {id:`prueba-${sufijo}-privado-${id}`,metaUserId:`PE.${sufijo}privado`,username:'varasp7',tipo:'text',texto,...extra}));}
async function solicitudes(n){return (await bd.consulta(`SELECT s.id,s.estado,s.asesor_id,s.opcion_id,o.numero FROM solicitudes s JOIN contactos c ON c.id=s.contacto_id
  LEFT JOIN opciones_menu o ON o.id=s.opcion_id WHERE c.negocio_id=$1 AND c.telefono=$2 ORDER BY s.creada_en,s.id`,[negocioId,telefono(n)])).rows;}
async function cerrar(id){await bd.consulta(`UPDATE solicitudes SET estado='cerrada',cerrada_en=now() WHERE id=$1`,[id]);}
async function pasarVentana(id){await bd.consulta(`UPDATE solicitudes SET creada_en=now()-interval '61 seconds' WHERE id=$1`,[id]);}
async function salientes(n){return (await bd.consulta(`SELECT m.texto FROM mensajes_salientes m JOIN contactos c ON c.id=m.contacto_id
  WHERE c.negocio_id=$1 AND c.telefono=$2 ORDER BY m.creado_en,m.id`,[negocioId,telefono(n)])).rows;}
async function contador(){return (await bd.consulta(`SELECT SUM(solicitudes_reales)::int AS reales FROM contadores_jornada cj
  JOIN jornadas j ON j.id=cj.jornada_id WHERE j.equipo_id=$1`,[equipoId])).rows[0].reales || 0;}
async function limpiar(){if(!negocioId)return;await bd.transaccion(async c=>{
  await c.query(`DELETE FROM notificaciones WHERE solicitud_id IN(SELECT id FROM solicitudes WHERE negocio_id=$1)`,[negocioId]);
  await c.query(`DELETE FROM historial_asignaciones WHERE solicitud_id IN(SELECT id FROM solicitudes WHERE negocio_id=$1)`,[negocioId]);
  await c.query(`DELETE FROM notas_solicitud WHERE solicitud_id IN(SELECT id FROM solicitudes WHERE negocio_id=$1)`,[negocioId]);
  await c.query('DELETE FROM interacciones_entrantes WHERE negocio_id=$1',[negocioId]);
  await c.query('DELETE FROM mensajes_salientes WHERE negocio_id=$1',[negocioId]);
  await c.query('DELETE FROM registro_auditoria WHERE negocio_id=$1',[negocioId]);
  await c.query('DELETE FROM eventos_webhook WHERE negocio_id=$1',[negocioId]);
  await c.query('DELETE FROM solicitudes WHERE negocio_id=$1',[negocioId]);
  await c.query(`DELETE FROM contadores_jornada WHERE jornada_id IN(SELECT id FROM jornadas WHERE equipo_id=$1)`,[equipoId]);
  await c.query('DELETE FROM jornadas WHERE equipo_id=$1',[equipoId]);
  await c.query('DELETE FROM contactos WHERE negocio_id=$1',[negocioId]);
  await c.query('DELETE FROM opciones_menu WHERE negocio_id=$1',[negocioId]);
  await c.query('DELETE FROM miembros_equipo WHERE equipo_id=$1',[equipoId]);
  await c.query('DELETE FROM usuarios WHERE negocio_id=$1',[negocioId]);
  await c.query('DELETE FROM equipos WHERE id=$1',[equipoId]);
  await c.query('DELETE FROM negocios WHERE id=$1',[negocioId]);
});}
try{
  const n=await bd.consulta(`INSERT INTO negocios(nombre,meta_phone_number_id) VALUES('Pruebas Valana',$1) RETURNING id`,[`prueba-${sufijo}`]);negocioId=n.rows[0].id;
  await bd.consulta(`UPDATE negocios SET mensaje_menu='Saludos de prueba',
    mensaje_confirmacion='Confirmación personalizada',mensaje_fuera_horario='Fuera de horario prueba',
    mensaje_sin_asesor='Sin asesor prueba' WHERE id=$1`,[negocioId]);
  equipoId=(await bd.consulta(`INSERT INTO equipos(negocio_id,nombre) VALUES($1,'Equipo de pruebas') RETURNING id`,[negocioId])).rows[0].id;
  for(const [num,nombre] of [[1,'Admisiones'],[2,'Horarios']])await bd.consulta(`INSERT INTO opciones_menu(negocio_id,equipo_id,numero,identificador,nombre) VALUES($1,$2,$3,$4,$5)`,[negocioId,equipoId,num,nombre.toLowerCase(),nombre]);
  const asesores=[];
  for(let i=0;i<4;i++){
    const id=(await bd.consulta(`INSERT INTO usuarios(negocio_id,nombre,correo,clave_hash,rol,disponible,presencia_en)
      VALUES($1,$2,$3,'prueba','asesor',true,now()) RETURNING id`,[negocioId,`Asesor ${i}`,`prueba${i}-${sufijo}@local`])).rows[0].id;
    asesores.push(id);await bd.consulta('INSERT INTO miembros_equipo(equipo_id,usuario_id) VALUES($1,$2)',[equipoId,id]);
  }
  await mensaje(10,'hola','Hola');let general=await solicitudes(10);
  assert.equal(general.length,1,'Hola debe crear la solicitud de inmediato');
  assert.equal(general[0].opcion_id,null);
  assert.ok(asesores.includes(general[0].asesor_id),'Hola debe asignar con el reparto equitativo');
  const asesorGeneral=general[0].asesor_id;
  assert.equal(await contador(),1);
  assert.equal((await salientes(10)).length,1,'Una sola respuesta inicial por solicitud');
  assert.equal((await salientes(10))[0].texto,'Saludos de prueba\n\n1. Admisiones\n2. Horarios',
    'El primer texto libre recibe solo el menú configurado');
  await mensaje(10,'hola','Hola');assert.equal((await solicitudes(10)).length,1);assert.equal((await salientes(10)).length,1);
  await mensaje(10,'contexto','Necesito información');
  await mensaje(10,'clasificar','1');
  await mensaje(10,'otro-motivo-en-ventana','2');
  general=await solicitudes(10);
  assert.equal(general.length,1,'La ventana de 60 segundos agrupa las respuestas');
  assert.equal(general[0].numero,1,'Una segunda opción dentro de la ventana no sobrescribe el motivo');
  assert.equal(general[0].asesor_id,asesorGeneral);
  assert.equal(await contador(),1);
  assert.equal((await salientes(10)).length,2,'La primera opción válida recibe una confirmación');
  assert.equal((await salientes(10))[1].texto,'Confirmación personalizada');
  assert.equal(Number((await bd.consulta('SELECT COUNT(*)::int AS total FROM interacciones_entrantes WHERE solicitud_id=$1',[general[0].id])).rows[0].total),4);
  assert.equal(Number((await bd.consulta('SELECT COUNT(*)::int AS total FROM notificaciones WHERE solicitud_id=$1',[general[0].id])).rows[0].total),1,'La ventana no genera notificaciones repetidas');
  const solicitudGeneral=general[0].id;
  const reqAsesor={usuario:{id:asesorGeneral,negocio_id:negocioId,rol:'asesor'}};
  const reqAjeno={usuario:{id:asesores.find(id=>id!==asesorGeneral),negocio_id:negocioId,rol:'asesor'}};
  const ultimoInicial=(await bd.consulta(`SELECT id FROM interacciones_entrantes WHERE solicitud_id=$1
    ORDER BY recibida_en DESC,id DESC LIMIT 1`,[solicitudGeneral])).rows[0].id;
  assert.equal((await solicitudesApi.leerMensajes(reqAsesor,solicitudGeneral,{ultimo_mensaje_id:ultimoInicial})).actualizado,true);
  await assert.rejects(solicitudesApi.leerMensajes(reqAjeno,solicitudGeneral,{ultimo_mensaje_id:ultimoInicial}),
    e=>e.getStatus?.()===404,'Otro asesor no puede reconocer mensajes ajenos');
  await mensaje(10,'aviso-pendiente-1','Consulta adicional uno');
  const cursorViejo=(await bd.consulta(`SELECT id FROM interacciones_entrantes WHERE solicitud_id=$1
    ORDER BY recibida_en DESC,id DESC LIMIT 1`,[solicitudGeneral])).rows[0].id;
  await mensaje(10,'aviso-pendiente-2','Consulta adicional dos');
  const avisosMensaje=()=>bd.consulta(`SELECT id,leida_en FROM notificaciones
    WHERE solicitud_id=$1 AND usuario_id=$2 AND tipo='mensaje_recibido'`,[solicitudGeneral,asesorGeneral]);
  assert.equal((await avisosMensaje()).rows.length,1,'Varios mensajes sin ver conservan un solo aviso');
  assert.equal((await avisosMensaje()).rows[0].leida_en,null);
  assert.equal((await solicitudesApi.leerMensajes(reqAsesor,solicitudGeneral,{ultimo_mensaje_id:cursorViejo})).actualizado,false,
    'Una lectura desactualizada no debe ocultar un mensaje nuevo');
  assert.equal((await avisosMensaje()).rows[0].leida_en,null);
  const ultimoActual=(await bd.consulta(`SELECT id FROM interacciones_entrantes WHERE solicitud_id=$1
    ORDER BY recibida_en DESC,id DESC LIMIT 1`,[solicitudGeneral])).rows[0].id;
  assert.equal((await solicitudesApi.leerMensajes(reqAsesor,solicitudGeneral,{ultimo_mensaje_id:ultimoActual})).actualizado,true);
  assert.ok((await avisosMensaje()).rows[0].leida_en,'Abrir el detalle reconoce el aviso');
  await bd.consulta(`UPDATE solicitudes SET creada_en=now()-interval '11 minutes' WHERE id=$1`,[solicitudGeneral]);
  await mensaje(10,'aviso-nuevo-ciclo','Nueva consulta tras la lectura');
  assert.equal((await avisosMensaje()).rows.length,1,'Una nueva consulta reutiliza la misma fila de aviso');
  assert.equal((await avisosMensaje()).rows[0].leida_en,null,'El siguiente mensaje vuelve a quedar sin leer');
  await pasarVentana(general[0].id);
  await mensaje(10,'mismo-motivo','1');
  assert.equal((await solicitudes(10)).length,1);
  assert.equal((await salientes(10)).length,2);
  await mensaje(10,'motivo-nuevo','2');
  let s=await solicitudes(10);
  assert.equal(s.length,2,'Después de 60 segundos una opción nueva crea otra solicitud');
  assert.equal(s[1].asesor_id,general[0].asesor_id,'La segunda solicitud conserva el asesor');
  assert.equal((await salientes(10)).length,3,'Cada solicitud con opción recibe una sola confirmación');
  assert.equal(await contador(),2);
  await mensaje(10,'repetida-en-ventana','2');
  assert.equal((await salientes(10)).length,3);
  await pasarVentana(s[1].id);
  await mensaje(10,'repetida-posterior','2');
  assert.equal((await solicitudes(10)).length,2);
  assert.equal((await salientes(10)).length,3);
  await cerrar(s[0].id);await cerrar(s[1].id);
  await mensaje(10,'retorno','Hola');
  assert.equal((await solicitudes(10)).length,3,'Un saludo después del cierre crea una solicitud nueva');
  assert.equal((await salientes(10)).length,4);
  assert.equal((await salientes(10))[3].texto,'Saludos de prueba\n\n1. Admisiones\n2. Horarios');
  assert.ok(asesores.includes((await solicitudes(10))[2].asesor_id));
  assert.equal((await bd.consulta('SELECT motivo FROM historial_asignaciones WHERE solicitud_id=$1',[(await solicitudes(10))[2].id])).rows[0].motivo,'reparto');

  await mensaje(11,'hola-tardia','Hola');
  const tardia=(await solicitudes(11))[0];
  await pasarVentana(tardia.id);
  await mensaje(11,'clasificacion-tardia','2');
  assert.equal((await solicitudes(11)).length,1,'La primera clasificación tardía reutiliza la solicitud general');
  assert.equal((await solicitudes(11))[0].numero,2);
  assert.equal((await solicitudes(11))[0].asesor_id,tardia.asesor_id);
  assert.equal((await salientes(11)).length,2);
  assert.equal((await salientes(11))[1].texto,'Confirmación personalizada');
  await Promise.all([mensaje(12,'simultaneo-a','Hola'),mensaje(12,'simultaneo-b','Necesito información')]);
  assert.equal((await solicitudes(12)).length,1,'Mensajes simultáneos del mismo contacto se agrupan');
  assert.equal((await salientes(12)).length,1);

  await mensaje(13,'opcion-inicial','2');
  const solicitudConMotivo=(await solicitudes(13))[0];
  assert.equal((await salientes(13))[0].texto,'Confirmación personalizada',
    'Una opción en el primer mensaje recibe solo la confirmación configurada');
  await pasarVentana(solicitudConMotivo.id);
  await mensaje(13,'saludo-tardio','Hola, quiero más información');
  assert.equal((await solicitudes(13)).length,1,'Un saludo tardío conserva la solicitud y el asesor');
  assert.equal((await solicitudes(13))[0].asesor_id,solicitudConMotivo.asesor_id);
  assert.equal((await salientes(13)).length,1,'Una conversación asignada no recibe un menú tardío');
  await mensaje(13,'saludo-inmediato','Hola');
  assert.equal((await salientes(13)).length,1,'Los saludos consecutivos no disparan respuestas');
  assert.equal(Number((await bd.consulta(`SELECT COUNT(*)::int AS total FROM notificaciones WHERE solicitud_id=$1`,[solicitudConMotivo.id])).rows[0].total),1,'Los mensajes adicionales no crean avisos duplicados');

  await mensajePrivado('primero','Hola, quiero información');
  const privado=(await bd.consulta(`SELECT c.id,c.telefono,c.meta_user_id,c.username_whatsapp,s.id AS solicitud_id,s.asesor_id
    FROM contactos c JOIN solicitudes s ON s.contacto_id=c.id WHERE c.negocio_id=$1 AND c.meta_user_id=$2`,
    [negocioId,`PE.${sufijo}privado`])).rows;
  assert.equal(privado.length,1,'Un usuario privado crea solicitud sin teléfono');
  assert.equal(privado[0].telefono,null);
  assert.equal(privado[0].username_whatsapp,'varasp7');
  assert.ok(asesores.includes(privado[0].asesor_id));
  await mensajePrivado('segundo','Más detalles',{username:'otro_nombre'});
  assert.equal(Number((await bd.consulta(`SELECT COUNT(*)::int AS total FROM solicitudes WHERE contacto_id=$1`,[privado[0].id])).rows[0].total),1,
    'Cambiar nombre de usuario no duplica la solicitud');
  await mensaje(14,'telefono-primero','Hola');
  const contactoConNumero=(await bd.consulta(`SELECT id FROM contactos WHERE negocio_id=$1 AND telefono=$2`,
    [negocioId,telefono(14)])).rows[0].id;
  await mensajePrivado('vinculo','Hola',{telefono:telefono(14),metaUserId:`PE.${sufijo}numero`});
  const vinculo=(await bd.consulta(`SELECT id,meta_user_id FROM contactos WHERE id=$1`,[contactoConNumero])).rows[0];
  assert.equal(vinculo.meta_user_id,`PE.${sufijo}numero`,'El BSUID se vincula a un contacto telefónico existente');
  await mensajePrivado('solo-bsu','Más información',{metaUserId:`PE.${sufijo}numero`,telefono:null});
  assert.equal(Number((await bd.consulta(`SELECT COUNT(*)::int AS total FROM solicitudes WHERE contacto_id=$1`,[contactoConNumero])).rows[0].total),1);

  await mensaje(1,'primera','1');s=await solicitudes(1);assert.equal(s.length,1);assert.ok(asesores.includes(s[0].asesor_id));const asesorInicial=s[0].asesor_id;
  assert.equal((await salientes(1)).length,1);
  await mensaje(1,'primera','1');assert.equal((await solicitudes(1)).length,1);
  await mensaje(1,'repetida','1. Admisiones');assert.equal((await solicitudes(1)).length,1);assert.equal((await salientes(1)).length,1);
  await mensaje(1,'otra-en-ventana','2');assert.equal((await solicitudes(1)).length,1);
  await pasarVentana(s[0].id);
  await mensaje(1,'otra','2');s=await solicitudes(1);assert.equal(s.length,2);assert.equal(s[1].asesor_id,asesorInicial);
  await cerrar(s[0].id);await pasarVentana(s[1].id);
  await mensaje(1,'retorno','1');s=await solicitudes(1);assert.equal(s.length,3);assert.equal(s[2].asesor_id,asesorInicial);
  await mensaje(1,'contexto','Necesito saber los requisitos');
  for(let i=0;i<3;i++)await mensaje(1,`adicional-${i}`,`Pregunta adicional ${i}`);
  assert.equal((await solicitudes(1)).length,3);
  assert.equal(Number((await bd.consulta('SELECT COUNT(*)::int AS total FROM interacciones_entrantes WHERE solicitud_id=$1',[s[2].id])).rows[0].total),5);
  const salientesAntes=(await salientes(1)).length;
  await mensaje(1,'saludo','¡Hola!');
  assert.equal((await solicitudes(1)).length,3);
  assert.equal((await salientes(1)).length,salientesAntes,'El saludo adicional no repite respuestas automáticas');
  await cerrar(s[1].id);await cerrar(s[2].id);await mensaje(1,'nueva','1');assert.equal((await solicitudes(1)).length,4);
  const asesorAbierto=(await solicitudes(1)).at(-1).asesor_id;
  await bd.consulta('UPDATE usuarios SET disponible=false WHERE negocio_id=$1',[negocioId]);await mensaje(2,'sin-asesor','1');assert.equal((await solicitudes(2))[0].estado,'pendiente_asignacion');
  assert.equal((await salientes(2))[0].texto,'Sin asesor prueba');
  await bd.consulta('UPDATE usuarios SET disponible=true,presencia_en=now() WHERE id=$1',[asesores[0]]);assert.equal(await repartidor.asignarPendientes(equipoId),1);assert.equal((await solicitudes(2))[0].asesor_id,asesores[0]);
  await bd.consulta('UPDATE usuarios SET disponible=true,presencia_en=now() WHERE negocio_id=$1',[negocioId]);
  const jornada=(await bd.consulta('SELECT id FROM jornadas WHERE equipo_id=$1',[equipoId])).rows[0].id;
  await bd.consulta('UPDATE contadores_jornada SET contador_ajustado=2,elegible_anterior=true WHERE jornada_id=$1',[jornada]);
  await bd.consulta('UPDATE contadores_jornada SET contador_ajustado=1 WHERE jornada_id=$1 AND usuario_id=$2',[jornada,asesores[3]]);
  await mensaje(4,'menor-carga','1');assert.equal((await solicitudes(4))[0].asesor_id,asesores[3]);
  await bd.consulta(`UPDATE contadores_jornada SET contador_ajustado=5,elegible_anterior=true WHERE jornada_id=$1 AND usuario_id<>$2`,[jornada,asesores[3]]);
  await bd.consulta(`UPDATE contadores_jornada SET contador_ajustado=0,elegible_anterior=false,solicitudes_reales=0 WHERE jornada_id=$1 AND usuario_id=$2`,[jornada,asesores[3]]);
  await mensaje(3,'nivelacion','1');const nivel=(await bd.consulta('SELECT ajustes_nivelacion,contador_ajustado FROM contadores_jornada WHERE jornada_id=$1 AND usuario_id=$2',[jornada,asesores[3]])).rows[0];assert.equal(nivel.ajustes_nivelacion,5);assert.ok(nivel.contador_ajustado>=5);
  const realesAntes=await contador();
  await Promise.all(Array.from({length:8},(_,i)=>mensaje(100+i,`concurrente-${i}`,'1')));for(let i=0;i<8;i++)assert.equal((await solicitudes(100+i)).length,1);
  assert.equal(await contador(),realesAntes+8);
  const ayer=(await bd.consulta(`INSERT INTO jornadas(equipo_id,fecha_local) VALUES($1,(now() AT TIME ZONE 'America/Lima')::date-1) RETURNING id`,[equipoId])).rows[0].id;
  await bd.consulta('INSERT INTO contadores_jornada(jornada_id,usuario_id,solicitudes_reales,contador_ajustado) VALUES($1,$2,7,7)',[ayer,asesorAbierto]);
  await pasarVentana((await solicitudes(1)).at(-1).id);
  await mensaje(1,'otra-jornada','2');
  const abiertas=(await solicitudes(1)).filter(x=>x.estado!=='cerrada');
  assert.equal(abiertas.at(-1).asesor_id,asesorAbierto);
  assert.equal(Number((await bd.consulta('SELECT solicitudes_reales FROM contadores_jornada WHERE jornada_id=$1 AND usuario_id=$2',[ayer,asesorAbierto])).rows[0].solicitudes_reales),7);
  await bd.consulta(`UPDATE negocios SET dias_atencion='{}',hora_inicio='00:00',hora_fin='23:59' WHERE id=$1`,[negocioId]);
  await mensaje(15,'fuera-horario','Hola');
  assert.equal((await salientes(15))[0].texto,'Fuera de horario prueba');
  console.log('Integración aprobada: continuidad, repetición, mensajes adicionales, menor carga, cierre, pendiente, nivelación, jornadas y concurrencia.');
}finally{await limpiar();await bd.onModuleDestroy();}
