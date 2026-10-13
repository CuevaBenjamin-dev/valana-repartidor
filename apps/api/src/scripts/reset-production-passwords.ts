import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import * as argon2 from 'argon2';

const cuentas=[
  {correo:'admin@valana.com',rol:'administrador'},
  {correo:'asesoruno@valana.com',rol:'asesor'},
  {correo:'asesordos@valana.com',rol:'asesor'}
] as const;

async function main(){
  if(process.env.NODE_ENV!=='production')throw new Error('Este procedimiento solo se ejecuta en producción');
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  const credenciales: {id:string;correo:string;clave:string;rol:string}[]=[];
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const existentes=await c.query<{id:string;correo:string;rol:string;activo:boolean}>(
      'SELECT id,correo,rol,activo FROM usuarios WHERE correo=ANY($1::text[]) FOR UPDATE',
      [cuentas.map(x=>x.correo)]);
    if(existentes.rows.length!==cuentas.length)throw new Error('Falta una cuenta existente; no se modificó ninguna contraseña');
    for(const cuenta of cuentas){
      const u=existentes.rows.find(x=>x.correo===cuenta.correo);
      if(!u || !u.activo || u.rol!==cuenta.rol)throw new Error('Una cuenta no tiene el estado o rol esperado; no se modificó ninguna contraseña');
      const clave=`V!${randomBytes(18).toString('base64url')}`;
      const hash=await argon2.hash(clave,{type:argon2.argon2id});
      if(!await argon2.verify(hash,clave))throw new Error('No se pudo verificar el hash temporal');
      await c.query('UPDATE usuarios SET clave_hash=$2,cambio_clave_obligatorio=true WHERE id=$1',[u.id,hash]);
      await c.query('UPDATE sesiones SET revocada_en=now() WHERE usuario_id=$1 AND revocada_en IS NULL',[u.id]);
      credenciales.push({id:u.id,correo:u.correo,clave,rol:u.rol});
    }
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK').catch(()=>undefined);throw e}
  finally{c.release()}

  let verificadas=true;
  for(const cuenta of credenciales){
    try{
      const respuesta=await fetch('http://127.0.0.1:3001/sesion/iniciar',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({correo:cuenta.correo,clave:cuenta.clave}),signal:AbortSignal.timeout(5000)
      });
      const resultado=await respuesta.json() as {usuario?:{rol?:string;cambio_clave_obligatorio?:boolean}};
      if(!respuesta.ok || resultado.usuario?.rol!==cuenta.rol || resultado.usuario?.cambio_clave_obligatorio!==true){
        verificadas=false;continue;
      }
      const token=respuesta.headers.getSetCookie().join(';').match(/valana_sesion=([^;]+)/)?.[1];
      if(token){
        const hash=createHash('sha256').update(token).digest('hex');
        await pool.query('UPDATE sesiones SET revocada_en=now() WHERE token_hash=$1',[hash]);
      }
    }catch{verificadas=false}
  }
  await pool.end();
  // Este script solo debe invocarse con docker compose exec -T desde el PowerShell privado.
  // Su stdout no forma parte de los logs del proceso principal del contenedor.
  process.stdout.write('Contraseñas temporales (cópialas ahora; no se guardan en archivos):\n');
  for(const cuenta of credenciales)process.stdout.write(`${cuenta.correo}: ${cuenta.clave}\n`);
  if(!verificadas){
    process.stderr.write('Una comprobación HTTP de ingreso falló. Las claves fueron restablecidas; revisa el acceso antes de cerrar la terminal.\n');
    process.exitCode=1;
  }else process.stdout.write('Las tres cuentas ingresaron y requieren cambio obligatorio de contraseña.\n');
}

main().catch(e=>{process.stderr.write(`Restablecimiento detenido: ${(e as Error).message}\n`);process.exitCode=1});
