import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require=createRequire(import.meta.url);
const { Bd }=require('../apps/api/dist/bd.js');
const { ActualizacionEnVivo }=require('../apps/api/dist/vivo.js');
const bd=new Bd();
const vivo=new ActualizacionEnVivo();
const pausa=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sufijo=randomUUID().slice(0,8);
let negocioId;
let avisos=0;
try {
  vivo.alTrabajo(()=>avisos++);
  await vivo.onModuleInit();
  assert.ok(vivo.activo,'El oyente de prueba no conectó');
  const suscripciones=(await vivo.cliente.query('SELECT pg_listening_channels() AS canal')).rows.map(x=>x.canal);
  assert.deepEqual(suscripciones.sort(),['valana_equipo','valana_trabajos','valana_usuario']);
  await bd.consulta("SELECT pg_notify('valana_trabajos','')");
  for(let i=0;i<40 && avisos<1;i++)await pausa(50);
  assert.ok(avisos>=1,'No llegó el aviso inicial');
  const pid=vivo.cliente.processID;
  const inicio=performance.now();
  await bd.consulta('SELECT pg_terminate_backend($1)',[pid]);
  for(let i=0;i<160 && (!vivo.activo || vivo.cliente?.processID===pid);i++)await pausa(50);
  assert.ok(vivo.activo && vivo.cliente.processID!==pid,'El oyente no reconectó');
  const reconexionMs=Math.round(performance.now()-inicio);
  const nuevas=(await vivo.cliente.query('SELECT pg_listening_channels() AS canal')).rows.map(x=>x.canal);
  assert.deepEqual(nuevas.sort(),['valana_equipo','valana_trabajos','valana_usuario']);
  await bd.consulta("SELECT pg_notify('valana_trabajos','')");
  for(let i=0;i<40 && avisos<2;i++)await pausa(50);
  assert.ok(avisos>=2,'No llegaron avisos tras reconectar');

  negocioId=(await bd.consulta(`INSERT INTO negocios(nombre,meta_phone_number_id)
    VALUES('Auditoría de recuperación',$1) RETURNING id`,[`audit-recovery-${sufijo}`])).rows[0].id;
  await bd.consulta(`INSERT INTO equipos(negocio_id,nombre) VALUES($1,'Equipo de prueba')`,[negocioId]);
  const metaId=`audit-recovery-${sufijo}`;
  const creado=performance.now();
  const id=(await bd.consulta(`INSERT INTO eventos_webhook(meta_mensaje_id,negocio_id,carga,siguiente_intento_en)
    VALUES($1,$2,$3,now()+interval '5 seconds') RETURNING id`,
    [metaId,negocioId,JSON.stringify({id:metaId,telefono:'0',tipo:'text',texto:''})])).rows[0].id;
  let estado='pendiente';
  for(let i=0;i<760;i++){
    estado=(await bd.consulta('SELECT estado FROM eventos_webhook WHERE id=$1',[id])).rows[0]?.estado;
    if(estado==='procesado')break;
    await pausa(50);
  }
  assert.equal(estado,'procesado','El trabajo persistido no se recuperó en 38 segundos');
  console.log(JSON.stringify({reconexion_ms:reconexionMs,canales_restaurados:nuevas,
    avisos_tras_reconexion:avisos,trabajo_diferido_ms:Math.round(performance.now()-creado),
    trabajo_procesado:estado==='procesado'}));
} finally {
  await vivo.onModuleDestroy();
  if(negocioId)await bd.transaccion(async c=>{
    await c.query('DELETE FROM eventos_webhook WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM jornadas WHERE equipo_id IN(SELECT id FROM equipos WHERE negocio_id=$1)',[negocioId]);
    await c.query('DELETE FROM equipos WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM negocios WHERE id=$1',[negocioId]);
  });
  await bd.onModuleDestroy();
}
