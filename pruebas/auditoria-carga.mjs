import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require=createRequire(import.meta.url);
const { Bd }=require('../apps/api/dist/bd.js');
const { Repartidor }=require('../apps/api/dist/repartidor.js');
const bd=new Bd();
const repartidor=new Repartidor(bd);
const total=Number(process.argv[2]);
if(![4,10,50].includes(total))throw new Error('Use 4, 10 o 50 asesores');
const sufijo=randomUUID().slice(0,8);
const prefijo=`audit-${sufijo}`;
const base='http://127.0.0.1:3001';
const pausa=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=x=>createHash('sha256').update(x).digest('hex');
const percentil=(valores,p)=>valores.length?Math.round([...valores].sort((a,b)=>a-b)[Math.ceil(valores.length*p)-1]):null;
let negocioId,equipoId;
const conexiones=[];
let sqlDatos=0,contando=false;
const consultaOriginal=bd.consulta.bind(bd);
const transaccionOriginal=bd.transaccion.bind(bd);
bd.consulta=(...args)=>{if(contando)sqlDatos++;return consultaOriginal(...args)};
bd.transaccion=fn=>transaccionOriginal(async c=>{
  const queryOriginal=c.query;
  c.query=function(...args){if(contando)sqlDatos++;return queryOriginal.apply(this,args)};
  try{return await fn(c)}finally{c.query=queryOriginal}
});

async function estadoServidor(){
  const r=await consultaOriginal(`SELECT d.xact_commit,d.xact_rollback,d.numbackends,
    pg_database_size(current_database()) AS base_bytes,
    (SELECT wal_bytes FROM pg_stat_wal) AS wal_bytes,
    pg_notification_queue_usage() AS cola FROM pg_stat_database d WHERE d.datname=current_database()`);
  return r.rows[0];
}

async function sesion(usuarioId){
  const token=randomBytes(24).toString('base64url');
  await bd.consulta(`INSERT INTO sesiones(usuario_id,token_hash,csrf_hash,expira_en)
    VALUES($1,$2,$3,now()+interval '15 minutes')`,[usuarioId,hash(token),hash('auditoria')]);
  return token;
}

async function abrirSse(token){
  const control=new AbortController();
  const respuesta=await fetch(`${base}/notificaciones/eventos`,{
    headers:{Cookie:`valana_sesion=${token}`},signal:control.signal
  });
  assert.equal(respuesta.status,200);
  const lector=respuesta.body.getReader();
  const conexion={control,eventos:0,primero:null};
  conexiones.push(conexion);
  void (async()=>{
    let acumulado='';
    try {
      while(true){
        const {done,value}=await lector.read();
        if(done)break;
        acumulado+=new TextDecoder().decode(value);
        let fin;
        while((fin=acumulado.indexOf('\n\n'))>=0){
          const bloque=acumulado.slice(0,fin);acumulado=acumulado.slice(fin+2);
          if(bloque.includes('event: actualizar')){
            conexion.eventos++;
            conexion.primero??=performance.now();
          }
        }
      }
    }catch(e){if(!control.signal.aborted)conexion.error=String(e)}
  })();
  return conexion;
}

async function limpiar(){
  for(const conexion of conexiones)conexion.control.abort();
  if(!negocioId)return;
  await bd.transaccion(async c=>{
    await c.query('DELETE FROM notificaciones WHERE solicitud_id IN(SELECT id FROM solicitudes WHERE negocio_id=$1)',[negocioId]);
    await c.query('DELETE FROM sesiones WHERE usuario_id IN(SELECT id FROM usuarios WHERE negocio_id=$1)',[negocioId]);
    await c.query('DELETE FROM historial_asignaciones WHERE solicitud_id IN(SELECT id FROM solicitudes WHERE negocio_id=$1)',[negocioId]);
    await c.query('DELETE FROM interacciones_entrantes WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM mensajes_salientes WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM registro_auditoria WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM eventos_webhook WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM solicitudes WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM contadores_jornada WHERE jornada_id IN(SELECT id FROM jornadas WHERE equipo_id=$1)',[equipoId]);
    await c.query('DELETE FROM jornadas WHERE equipo_id=$1',[equipoId]);
    await c.query('DELETE FROM contactos WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM opciones_menu WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM miembros_equipo WHERE equipo_id=$1',[equipoId]);
    await c.query('DELETE FROM usuarios WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM equipos WHERE id=$1',[equipoId]);
    await c.query('DELETE FROM negocios WHERE id=$1',[negocioId]);
  });
}

try {
  negocioId=(await bd.consulta(`INSERT INTO negocios(nombre,meta_phone_number_id)
    VALUES($1,$2) RETURNING id`,[`Auditoría ${sufijo}`,prefijo])).rows[0].id;
  equipoId=(await bd.consulta(`INSERT INTO equipos(negocio_id,nombre)
    VALUES($1,'Equipo sintético') RETURNING id`,[negocioId])).rows[0].id;
  await bd.consulta(`INSERT INTO opciones_menu(negocio_id,equipo_id,numero,identificador,nombre)
    VALUES($1,$2,1,'auditoria','Auditoría')`,[negocioId,equipoId]);
  const asesores=[];
  for(let i=0;i<total;i++){
    const id=(await bd.consulta(`INSERT INTO usuarios(negocio_id,nombre,correo,clave_hash,rol,disponible,presencia_en)
      VALUES($1,$2,$3,'sintetico','asesor',true,now()) RETURNING id`,
      [negocioId,`Asesor ${i}`,`${prefijo}-${i}@local`])).rows[0].id;
    asesores.push({id,token:await sesion(id)});
    await bd.consulta('INSERT INTO miembros_equipo(equipo_id,usuario_id) VALUES($1,$2)',[equipoId,id]);
  }
  const supervisorId=(await bd.consulta(`INSERT INTO usuarios(negocio_id,nombre,correo,clave_hash,rol)
    VALUES($1,'Supervisor sintético',$2,'sintetico','supervisor') RETURNING id`,
    [negocioId,`${prefijo}-supervisor@local`])).rows[0].id;
  await bd.consulta('INSERT INTO miembros_equipo(equipo_id,usuario_id) VALUES($1,$2)',[equipoId,supervisorId]);
  const supervisor=await abrirSse(await sesion(supervisorId));
  const asesoresSse=[];
  for(let i=1;i<total;i++)asesoresSse.push(await abrirSse(asesores[i].token));
  const noAutorizado=await fetch(`${base}/notificaciones/eventos`);
  assert.equal(noAutorizado.status,401);
  await bd.consulta('UPDATE usuarios SET presencia_en=now() WHERE negocio_id=$1',[negocioId]);
  const previo=await estadoServidor();
  sqlDatos=0;contando=true;
  const inicio=performance.now();
  const resultados=await Promise.allSettled(Array.from({length:total},(_,i)=>{
    const comienzo=performance.now();
    return bd.transaccion(c=>repartidor.procesarMensaje(c,negocioId,{
      id:`${prefijo}-mensaje-${i}`,telefono:`519${String(i+10000000).padStart(8,'0')}`,tipo:'text',texto:'1'
    })).then(()=>performance.now()-comienzo);
  }));
  const duracion=performance.now()-inicio;
  contando=false;
  const latencias=resultados.filter(x=>x.status==='fulfilled').map(x=>x.value);
  const errores=resultados.filter(x=>x.status==='rejected').map(x=>String(x.reason?.message||x.reason));
  const resumen=(await bd.consulta(`SELECT count(*)::int AS solicitudes,count(DISTINCT contacto_id)::int AS contactos,
    count(DISTINCT asesor_id)::int AS asesores_distintos FROM solicitudes WHERE negocio_id=$1`,[negocioId])).rows[0];
  const asignaciones=(await bd.consulta(`SELECT asesor_id,count(*)::int AS total FROM solicitudes
    WHERE negocio_id=$1 GROUP BY asesor_id`,[negocioId])).rows;
  const salientes=(await bd.consulta(`SELECT estado,count(*)::int AS total FROM mensajes_salientes
    WHERE negocio_id=$1 GROUP BY estado`,[negocioId])).rows;
  const primerAsesor=(await bd.consulta(`SELECT id FROM solicitudes WHERE negocio_id=$1 AND asesor_id=$2`,
    [negocioId,asesores[0].id])).rows[0];
  const recuperacion=await fetch(`${base}/notificaciones`,{
    headers:{Cookie:`valana_sesion=${asesores[0].token}`}});
  assert.equal(recuperacion.status,200);
  const avisos=await recuperacion.json();
  let reconexion=false;
  if(primerAsesor){
    const conectado=await abrirSse(asesores[0].token);
    await bd.consulta(`INSERT INTO notificaciones(usuario_id,solicitud_id,tipo,texto)
      VALUES($1,$2,'auditoria','Reconexión sintética')`,[asesores[0].id,primerAsesor.id]);
    const espera=Date.now()+5000;
    while(!conectado.eventos && Date.now()<espera)await pausa(50);
    reconexion=conectado.eventos>0;
  }
  const espera=Date.now()+5000;
  while((supervisor.eventos<Number(resumen.solicitudes) || asesoresSse.some(x=>x.eventos<1)) && Date.now()<espera)await pausa(50);
  await pausa(1100);
  const posterior=await estadoServidor();
  const resultado={asesores:total,duracion_ms:Math.round(duracion),sql_datos_harness:sqlDatos,
    sql_datos_por_segundo:Math.round(sqlDatos/(duracion/1000)*10)/10,
    transacciones_servidor_delta:Number(posterior.xact_commit)-Number(previo.xact_commit)+Number(posterior.xact_rollback)-Number(previo.xact_rollback),
    latencia_ms:{p50:percentil(latencias,.5),p95:percentil(latencias,.95),max:percentil(latencias,1)},
    completadas:latencias.length,errores,solicitudes:resumen.solicitudes,contactos:resumen.contactos,
    asesores_distintos:resumen.asesores_distintos,reparto_min:Math.min(...asignaciones.map(x=>x.total)),
    reparto_max:Math.max(...asignaciones.map(x=>x.total)),
    sse:{supervisor_eventos:supervisor.eventos,asesores_con_evento:asesoresSse.filter(x=>x.eventos>0).length,
      asesores_conectados:asesoresSse.length,recuperacion_rest_avisos:avisos.length,reconexion},
    salientes,conexiones_postgres:posterior.numbackends,
    base_bytes_antes:Number(previo.base_bytes),base_bytes_despues:Number(posterior.base_bytes),
    wal_bytes_delta:Number(posterior.wal_bytes)-Number(previo.wal_bytes),cola_notify:posterior.cola};
  console.log(JSON.stringify(resultado));
  assert.equal(errores.length,0,'Hubo fallos en solicitudes sintéticas concurrentes');
  assert.equal(resumen.solicitudes,total,'Número de solicitudes incorrecto');
  assert.equal(resumen.contactos,total,'Se duplicó un contacto');
  assert.equal(resumen.asesores_distintos,total,'El reparto no cubrió a todos los asesores elegibles');
  assert.ok(asignaciones.every(x=>x.total===1),'Carga desigual con una solicitud por asesor');
  assert.equal(salientes.find(x=>x.estado==='pendiente')?.total,total,'Salidas sintéticas inesperadas');
  assert.ok(avisos.length>=1,'No se recuperó una notificación tras reconectar');
  assert.ok(reconexion,'El SSE no recibió el evento después de reconectar');
  assert.ok(supervisor.eventos>=total,'El supervisor no recibió todas las señales del equipo');
  assert.ok(asesoresSse.every(x=>x.eventos>=1),'Un asesor no recibió su señal');
} finally {
  contando=false;
  await limpiar();
  await bd.onModuleDestroy();
}
