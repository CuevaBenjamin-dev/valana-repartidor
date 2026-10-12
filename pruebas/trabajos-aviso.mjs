import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const { Bd }=require('../apps/api/dist/bd.js');
const bd=new Bd();
const sufijo=randomUUID();
let negocioId;
try {
  negocioId=(await bd.consulta(`INSERT INTO negocios(nombre,meta_phone_number_id)
    VALUES('Prueba de aviso',$1) RETURNING id`,[`prueba-aviso-${sufijo}`])).rows[0].id;
  await bd.consulta(`INSERT INTO equipos(negocio_id,nombre) VALUES($1,'Equipo de prueba')`,[negocioId]);
  const inicio=Date.now();
  const id=(await bd.consulta(`INSERT INTO eventos_webhook(meta_mensaje_id,negocio_id,carga)
    VALUES($1,$2,$3) RETURNING id`,[`prueba-aviso-${sufijo}`,negocioId,
      JSON.stringify({id:`prueba-aviso-${sufijo}`,telefono:'0',tipo:'text',texto:''})])).rows[0].id;
  let procesado=false;
  while(Date.now()-inicio<8000) {
    const r=await bd.consulta('SELECT estado FROM eventos_webhook WHERE id=$1',[id]);
    if(r.rows[0]?.estado==='procesado'){procesado=true;break;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(procesado,'El trabajador no despertó tras NOTIFY en menos de 8 segundos');
  console.log(`Trabajador despertó y procesó un evento sintético en ${Date.now()-inicio} ms, sin enviar a Meta.`);
} finally {
  if(negocioId)await bd.transaccion(async c=>{
    await c.query('DELETE FROM eventos_webhook WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM jornadas WHERE equipo_id IN(SELECT id FROM equipos WHERE negocio_id=$1)',[negocioId]);
    await c.query('DELETE FROM equipos WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM negocios WHERE id=$1',[negocioId]);
  });
  await bd.onModuleDestroy();
}
