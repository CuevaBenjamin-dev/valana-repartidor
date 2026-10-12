import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { Bd }=require('../apps/api/dist/bd.js');
const bd=new Bd(),sufijo=randomUUID().slice(0,8),base='http://127.0.0.1:3001';
let negocioId,equipoId,solicitudId;
const conexiones=[];
const tokens=new Map();
const hash=x=>createHash('sha256').update(x).digest('hex');
async function sesion(usuarioId){
  const token=randomBytes(32).toString('base64url');
  tokens.set(usuarioId,token);
  await bd.consulta(`INSERT INTO sesiones(usuario_id,token_hash,csrf_hash,expira_en)
    VALUES($1,$2,$3,now()+interval '10 minutes')`,[usuarioId,hash(token),hash('prueba')]);
  const renovacion=await fetch(`${base}/sesion/actual`,{headers:{Cookie:`valana_sesion=${token}; valana_csrf=prueba`}});
  assert.equal(renovacion.status,200);
  assert.match(renovacion.headers.get('set-cookie') || '',/Max-Age=31536000/,'La sesión se conserva tras cerrar el navegador');
  const control=new AbortController();
  const r=await fetch(`${base}/notificaciones/eventos`,{headers:{Cookie:`valana_sesion=${token}`},signal:control.signal});
  assert.equal(r.status,200);
  const lector=r.body.getReader();
  const saludo=await lector.read();
  assert.match(new TextDecoder().decode(saludo.value),/retry: 5000\n: conectado/);
  conexiones.push(control);
  return lector;
}
async function evento(lector){
  let texto='';
  const limite=setTimeout(()=>{for(const control of conexiones)control.abort()},5000);
  try{
    while(!texto.includes('event: actualizar')){
      const r=await lector.read();if(r.done)throw new Error('SSE cerrado antes del aviso');
      texto+=new TextDecoder().decode(r.value);
    }
  }finally{clearTimeout(limite)}
}
try{
  negocioId=(await bd.consulta(`INSERT INTO negocios(nombre,meta_phone_number_id)
    VALUES('Prueba en vivo',$1) RETURNING id`,[`prueba-vivo-${sufijo}`])).rows[0].id;
  equipoId=(await bd.consulta(`INSERT INTO equipos(negocio_id,nombre) VALUES($1,'Equipo en vivo') RETURNING id`,[negocioId])).rows[0].id;
  await bd.consulta(`INSERT INTO opciones_menu(negocio_id,equipo_id,numero,identificador,nombre)
    VALUES($1,$2,1,'admisiones','Admisiones')`,[negocioId,equipoId]);
  const contactoId=(await bd.consulta(`INSERT INTO contactos(negocio_id,telefono) VALUES($1,'+51900000002') RETURNING id`,[negocioId])).rows[0].id;
  const usuarios=[];
  for(const rol of ['asesor','supervisor','asesor','administrador']){
    const id=(await bd.consulta(`INSERT INTO usuarios(negocio_id,nombre,correo,clave_hash,rol)
      VALUES($1,$2,$3,'prueba',$4) RETURNING id`,[negocioId,rol,`${rol}-${usuarios.length}-${sufijo}@local`,rol])).rows[0].id;
    usuarios.push(id);await bd.consulta('INSERT INTO miembros_equipo(equipo_id,usuario_id) VALUES($1,$2)',[equipoId,id]);
  }
  const asesor=await sesion(usuarios[0]);
  const supervisor=await sesion(usuarios[1]);
  const otroAsesor=await sesion(usuarios[2]);
  await sesion(usuarios[3]);
  solicitudId=(await bd.consulta(`INSERT INTO solicitudes(codigo,negocio_id,equipo_id,contacto_id,asesor_id,estado)
    VALUES($1,$2,$3,$4,$5,'pendiente') RETURNING id`,[`VIVO-${sufijo}`,negocioId,equipoId,contactoId,usuarios[0]])).rows[0].id;
  await evento(supervisor);
  await bd.consulta(`INSERT INTO notificaciones(usuario_id,solicitud_id,tipo,texto)
    VALUES($1,$2,'nueva_solicitud','Prueba de aviso en vivo')`,[usuarios[0],solicitudId]);
  await evento(asesor);
  await bd.transaccion(async c=>{
    for(let i=0;i<31;i++){
      const id=`vivo-${sufijo}-${i}`;
      await c.query(`INSERT INTO interacciones_entrantes(meta_mensaje_id,negocio_id,contacto_id,solicitud_id,tipo,texto)
        VALUES($1,$2,$3,NULL,'text',$4)`,[id,negocioId,contactoId,`Consulta posterior ${i}`]);
      await c.query(`UPDATE interacciones_entrantes SET solicitud_id=$2 WHERE meta_mensaje_id=$1`,[id,solicitudId]);
    }
  });
  await Promise.all([evento(asesor),evento(supervisor)]);
  const detalle=await fetch(`${base}/solicitudes/${solicitudId}`,{headers:{Cookie:`valana_sesion=${tokens.get(usuarios[0])}`}});
  assert.equal(detalle.status,200);
  const datos=await detalle.json();
  assert.equal(datos.interacciones.length,31,'El detalle debe mostrar todas las interacciones, incluso más de 30');
  assert.ok(datos.interacciones.some(x=>x.texto==='Consulta posterior 0'));
  assert.equal(datos.solicitud.opcion,'Consulta general');
  const bandeja=await fetch(`${base}/solicitudes`,{headers:{Cookie:`valana_sesion=${tokens.get(usuarios[0])}`}});
  assert.equal((await bandeja.json())[0].opcion,'Consulta general');
  const ajena=await fetch(`${base}/solicitudes/${solicitudId}`,{
    headers:{Cookie:`valana_sesion=${tokens.get(usuarios[2])}`}});
  assert.equal(ajena.status,404);
  await bd.consulta(`INSERT INTO notificaciones(usuario_id,solicitud_id,tipo,texto)
    VALUES($1,$2,'mensaje_recibido','Mensaje de prueba')`,[usuarios[0],solicitudId]);
  await evento(asesor);
  const avisoMensaje=await fetch(`${base}/notificaciones`,{headers:{Cookie:`valana_sesion=${tokens.get(usuarios[0])}`}});
  assert.ok((await avisoMensaje.json()).some(x=>x.tipo==='mensaje_recibido' && x.leida_en===null),
    'El asesor ve un aviso persistente de mensaje recibido');
  const avisosAjenos=await fetch(`${base}/notificaciones`,{headers:{Cookie:`valana_sesion=${tokens.get(usuarios[2])}`}});
  assert.ok(!(await avisosAjenos.json()).some(x=>x.tipo==='mensaje_recibido'),
    'Un asesor ajeno no puede consultar el aviso');
  const ultimo=(await bd.consulta(`SELECT id FROM interacciones_entrantes WHERE solicitud_id=$1
    ORDER BY recibida_en DESC,id DESC LIMIT 1`,[solicitudId])).rows[0].id;
  const lectura=await fetch(`${base}/solicitudes/${solicitudId}/leer`,{method:'POST',
    headers:{Cookie:`valana_sesion=${tokens.get(usuarios[0])}; valana_csrf=prueba`,
      'X-CSRF-Token':'prueba','Content-Type':'application/json'},
    body:JSON.stringify({ultimo_mensaje_id:ultimo})});
  assert.equal(lectura.status,200);
  assert.equal((await lectura.json()).actualizado,true);
  const leido=await bd.consulta(`SELECT leida_en FROM notificaciones WHERE usuario_id=$1 AND solicitud_id=$2
    AND tipo='mensaje_recibido'`,[usuarios[0],solicitudId]);
  assert.ok(leido.rows[0].leida_en,'El aviso se reconoce al ver el último mensaje');
  const segundoAviso=await Promise.race([otroAsesor.read().then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),350))]);
  assert.equal(segundoAviso,false,'Un asesor ajeno recibió un evento privado');
  const avisoProhibido=await fetch(`${base}/notificaciones/anuncios`,{method:'POST',
    headers:{Cookie:`valana_sesion=${tokens.get(usuarios[1])}; valana_csrf=prueba`,'X-CSRF-Token':'prueba','Content-Type':'application/json'},
    body:JSON.stringify({texto:'Anuncio no autorizado'})});
  assert.equal(avisoProhibido.status,403);
  const avisoEquipo=await fetch(`${base}/notificaciones/anuncios`,{method:'POST',
    headers:{Cookie:`valana_sesion=${tokens.get(usuarios[3])}; valana_csrf=prueba`,'X-CSRF-Token':'prueba','Content-Type':'application/json'},
    body:JSON.stringify({texto:'Reunión general del equipo'})});
  assert.equal(avisoEquipo.status,200);
  assert.equal((await avisoEquipo.json()).destinatarios,4);
  const anuncios=await bd.consulta(`SELECT usuario_id FROM notificaciones WHERE tipo='anuncio'
    AND usuario_id=ANY($1::uuid[])`,[usuarios]);
  assert.deepEqual(new Set(anuncios.rows.map(x=>x.usuario_id)),new Set(usuarios),'El anuncio llega a cada usuario activo');
  console.log('SSE aprobado: permisos por asesor, anuncios solo del administrador y sesión persistente.');
}finally{
  for(const control of conexiones)control.abort();
  if(negocioId)await bd.transaccion(async c=>{
    await c.query('DELETE FROM notificaciones WHERE solicitud_id=$1 OR usuario_id IN(SELECT id FROM usuarios WHERE negocio_id=$2)',[solicitudId,negocioId]);
    await c.query('DELETE FROM registro_auditoria WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM interacciones_entrantes WHERE solicitud_id=$1',[solicitudId]);
    await c.query('DELETE FROM sesiones WHERE usuario_id IN(SELECT id FROM usuarios WHERE negocio_id=$1)',[negocioId]);
    await c.query('DELETE FROM solicitudes WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM contactos WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM opciones_menu WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM miembros_equipo WHERE equipo_id=$1',[equipoId]);
    await c.query('DELETE FROM usuarios WHERE negocio_id=$1',[negocioId]);
    await c.query('DELETE FROM equipos WHERE id=$1',[equipoId]);
    await c.query('DELETE FROM negocios WHERE id=$1',[negocioId]);
  });
  await bd.onModuleDestroy();
}
