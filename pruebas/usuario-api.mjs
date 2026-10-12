import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),{Pool}=require('../node_modules/pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const lineas=readFileSync(new URL('../.local/credenciales-iniciales.txt',import.meta.url),'utf8').split(/\r?\n/);
const clave=lineas.find(x=>x.startsWith('admin@valana.local: '))?.split(': ')[1];assert.ok(clave);
let usuarioId;
try{
  const login=await fetch('http://127.0.0.1:3001/sesion/iniciar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({correo:'admin@valana.local',clave})});assert.equal(login.status,200);
  const cookies=Object.fromEntries(login.headers.getSetCookie().map(x=>{const p=x.split(';')[0],i=p.indexOf('=');return [p.slice(0,i),p.slice(i+1)]}));
  const headers={Cookie:Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':cookies.valana_csrf,'Content-Type':'application/json'};
  const config=await (await fetch('http://127.0.0.1:3001/configuracion',{headers})).json();
  const correo=`temporal-${randomUUID().slice(0,8)}@valana.local`;
  const crear=await fetch('http://127.0.0.1:3001/configuracion/usuarios',{method:'POST',headers,body:JSON.stringify({nombre:'Asesor temporal de prueba',correo,rol:'asesor',clave:randomBytes(20).toString('base64url'),equipo_id:config.equipos[0].id})});
  assert.equal(crear.status,201);usuarioId=(await crear.json()).id;
  const editar=await fetch(`http://127.0.0.1:3001/configuracion/usuarios/${usuarioId}`,{method:'PATCH',headers,body:JSON.stringify({nombre:'Asesor temporal de prueba',activo:false})});assert.equal(editar.status,200);
  const r=await pool.query('SELECT activo FROM usuarios WHERE id=$1',[usuarioId]);assert.equal(r.rows[0].activo,false);
  await fetch('http://127.0.0.1:3001/sesion/cerrar',{method:'POST',headers,body:'{}'});
  console.log('Administración aprobada: creación de usuario con clave independiente y desactivación.');
}finally{
  if(usuarioId){await pool.query('DELETE FROM registro_auditoria WHERE entidad_id=$1',[usuarioId]);await pool.query('DELETE FROM miembros_equipo WHERE usuario_id=$1',[usuarioId]);await pool.query('DELETE FROM usuarios WHERE id=$1',[usuarioId]);}
  await pool.end();
}
