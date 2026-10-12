import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ruta=new URL('../.local/credenciales-iniciales.txt',import.meta.url);
const claves=Object.fromEntries(readFileSync(ruta,'utf8').split(/\r?\n/).filter(x=>x.includes(': ')).map(x=>{const i=x.indexOf(': ');return [x.slice(0,i),x.slice(i+2)]}));
const base='http://localhost:3001';
async function iniciar(correo){
  const r=await fetch(`${base}/sesion/iniciar`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({correo,clave:claves[correo]})});
  assert.equal(r.status,200);
  const cookies=Object.fromEntries(r.headers.getSetCookie().map(x=>{const par=x.split(';')[0],i=par.indexOf('=');return [par.slice(0,i),par.slice(i+1)]}));
  return {cookie:Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '),csrf:cookies.valana_csrf};
}
async function pedir(ruta,s,metodo='GET',conCsrf=true){return fetch(`${base}${ruta}`,{method:metodo,headers:{Cookie:s.cookie,...(metodo!=='GET'&&conCsrf?{'X-CSRF-Token':s.csrf}:{}),'Content-Type':'application/json'},body:metodo==='GET'?undefined:'{}'});}
const admin=await iniciar('admin@valana.local');
assert.equal((await pedir('/sesion/actual',admin)).status,200);
assert.equal((await pedir('/configuracion',admin)).status,200);
assert.equal((await pedir('/perfil/heartbeat',admin,'POST',false)).status,403);
assert.equal((await pedir('/sesion/cerrar',admin,'POST')).status,200);
assert.equal((await pedir('/sesion/actual',admin)).status,401);
const asesor=await iniciar('ana@valana.local');
assert.equal((await pedir('/solicitudes',asesor)).status,200);
assert.equal((await pedir('/supervision/resumen',asesor)).status,403);
assert.equal((await pedir('/configuracion',asesor)).status,403);
await pedir('/sesion/cerrar',asesor,'POST');
console.log('API aprobada: login, sesión, CSRF, permisos de asesor/administrador y cierre de sesión.');
