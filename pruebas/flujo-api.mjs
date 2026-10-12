import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),{Pool}=require('../node_modules/pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const credenciales=Object.fromEntries(readFileSync(new URL('../.local/credenciales-iniciales.txt',import.meta.url),'utf8').split(/\r?\n/).filter(x=>x.includes(': ')).map(x=>{const i=x.indexOf(': ');return [x.slice(0,i),x.slice(i+2)]}));
const base='http://127.0.0.1:3001';
let contactoId,solicitudId;
async function sesion(correo){
  const r=await fetch(`${base}/sesion/iniciar`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({correo,clave:credenciales[correo]})});assert.equal(r.status,200);
  const cookies=Object.fromEntries(r.headers.getSetCookie().map(x=>{const par=x.split(';')[0],i=par.indexOf('=');return [par.slice(0,i),par.slice(i+1)]}));
  return {cookie:Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '),csrf:cookies.valana_csrf};
}
async function llamar(ruta,s,method='GET',body){return fetch(`${base}${ruta}`,{method,headers:{Cookie:s.cookie,'X-CSRF-Token':s.csrf,'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body||{})});}
try{
  const baseDatos=(await pool.query(`SELECT n.id AS negocio_id,e.id AS equipo_id,o.id AS opcion_id,u.id AS asesor_id
    FROM negocios n JOIN equipos e ON e.negocio_id=n.id JOIN opciones_menu o ON o.equipo_id=e.id AND o.numero=1
    JOIN usuarios u ON u.negocio_id=n.id AND u.correo='ana@valana.local' WHERE n.meta_phone_number_id=$1 LIMIT 1`,[process.env.META_PHONE_NUMBER_ID])).rows[0];assert.ok(baseDatos);
  const telefono=`+519${String(Date.now()).slice(-8)}`;
  contactoId=(await pool.query(`INSERT INTO contactos(negocio_id,telefono,nombre_whatsapp) VALUES($1,$2,'Contacto de prueba') RETURNING id`,[baseDatos.negocio_id,telefono])).rows[0].id;
  solicitudId=(await pool.query(`INSERT INTO solicitudes(codigo,negocio_id,equipo_id,contacto_id,opcion_id,asesor_id,estado,asignada_en)
    VALUES($1,$2,$3,$4,$5,$6,'pendiente',now()) RETURNING id`,[`TEST-${randomUUID().slice(0,8)}`,baseDatos.negocio_id,baseDatos.equipo_id,contactoId,baseDatos.opcion_id,baseDatos.asesor_id])).rows[0].id;
  const ana=await sesion('ana@valana.local'),bruno=await sesion('bruno@valana.local'),supervisor=await sesion('supervisor@valana.local');
  assert.equal((await llamar(`/solicitudes/${solicitudId}`,bruno)).status,404);
  assert.equal((await llamar(`/solicitudes/${solicitudId}/notas`,bruno,'POST',{texto:'No autorizado'})).status,404);
  assert.equal((await llamar(`/solicitudes/${solicitudId}`,supervisor)).status,200);
  assert.equal((await llamar(`/solicitudes/${solicitudId}/iniciar`,ana,'POST')).status,200);
  assert.equal((await llamar(`/solicitudes/${solicitudId}/notas`,ana,'POST',{texto:'Gestión de prueba'})).status,200);
  const detalle=await (await llamar(`/solicitudes/${solicitudId}`,ana)).json();assert.equal(detalle.notas.length,1);
  assert.equal((await llamar(`/solicitudes/${solicitudId}/cerrar`,ana,'POST')).status,200);
  const cerrado=await (await llamar(`/solicitudes/${solicitudId}`,ana)).json();assert.equal(cerrado.solicitud.estado,'cerrada');assert.equal(cerrado.notas.length,1);
  for(const s of [ana,bruno,supervisor])await llamar('/sesion/cerrar',s,'POST');
  console.log('Flujo API aprobado: autorización, inicio, nota, cierre e historial.');
}finally{
  if(solicitudId){await pool.query('DELETE FROM registro_auditoria WHERE entidad_id=$1',[solicitudId]);await pool.query('DELETE FROM notas_solicitud WHERE solicitud_id=$1',[solicitudId]);await pool.query('DELETE FROM solicitudes WHERE id=$1',[solicitudId]);}
  if(contactoId)await pool.query('DELETE FROM contactos WHERE id=$1',[contactoId]);
  await pool.end();
}
