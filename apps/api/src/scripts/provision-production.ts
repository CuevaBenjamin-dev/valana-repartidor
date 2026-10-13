import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import * as argon2 from 'argon2';
import { z } from 'zod';

const entrada=z.object({
  admin:z.object({nombre:z.string().min(2),correo:z.email(),clave:z.string().min(8)}),
  asesores:z.array(z.object({nombre:z.string().min(2),correo:z.email(),clave:z.string().min(8)})).length(2),
});
type Cuenta=z.infer<typeof entrada>['admin'];
const ruta='/app/.local/production-accounts.json';
const fase=process.argv[2];
if(!['admin','finalizar'].includes(fase||''))throw new Error('Fase inválida');
const datos=entrada.parse(JSON.parse(readFileSync(ruta,'utf8')));
const pool=new Pool({connectionString:process.env.DATABASE_URL});

async function verificarIngreso(cuenta:Cuenta,rol:'administrador'|'asesor'){
  const respuesta=await fetch('http://127.0.0.1:3001/sesion/iniciar',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({correo:cuenta.correo,clave:cuenta.clave}),signal:AbortSignal.timeout(10000),
  });
  const cuerpo=await respuesta.json() as {usuario?:{id:string;rol:string;cambio_clave_obligatorio:boolean}};
  if(!respuesta.ok || cuerpo.usuario?.rol!==rol || !cuerpo.usuario.cambio_clave_obligatorio)
    throw new Error('La cuenta nueva no pudo iniciar sesión con cambio obligatorio');
  await pool.query('UPDATE sesiones SET revocada_en=now() WHERE usuario_id=$1 AND revocada_en IS NULL',[cuerpo.usuario.id]);
  return cuerpo.usuario.id;
}

async function guardarCuenta(cuenta:Cuenta,rol:'administrador'|'asesor',negocioId:string,equipoId:string){
  const hash=await argon2.hash(cuenta.clave,{type:argon2.argon2id});
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const r=await c.query<{id:string}>(`INSERT INTO usuarios
      (negocio_id,nombre,correo,clave_hash,rol,activo,disponible,cambio_clave_obligatorio)
      VALUES($1,$2,$3,$4,$5,true,false,true)
      ON CONFLICT(negocio_id,correo) DO UPDATE SET nombre=EXCLUDED.nombre,clave_hash=EXCLUDED.clave_hash,
        rol=EXCLUDED.rol,activo=true,disponible=false,cambio_clave_obligatorio=true,retirado_en=NULL
      RETURNING id`,[negocioId,cuenta.nombre,cuenta.correo.toLowerCase(),hash,rol]);
    await c.query(`INSERT INTO miembros_equipo(equipo_id,usuario_id) VALUES($1,$2)
      ON CONFLICT(equipo_id,usuario_id) DO UPDATE SET activo=true`,[equipoId,r.rows[0].id]);
    await c.query('UPDATE sesiones SET revocada_en=now() WHERE usuario_id=$1 AND revocada_en IS NULL',[r.rows[0].id]);
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}

async function main(){
  const negocio=(await pool.query<{id:string}>(`SELECT id FROM negocios WHERE meta_phone_number_id=$1 AND activo`,
    [process.env.META_PHONE_NUMBER_ID])).rows[0];
  if(!negocio)throw new Error('Negocio de Meta no encontrado');
  const equipo=(await pool.query<{id:string}>(`SELECT id FROM equipos WHERE negocio_id=$1 AND activo ORDER BY creado_en LIMIT 1`,
    [negocio.id])).rows[0];
  if(!equipo)throw new Error('Equipo comercial no encontrado');
  if(fase==='admin'){
    await guardarCuenta(datos.admin,'administrador',negocio.id,equipo.id);
    const id=await verificarIngreso(datos.admin,'administrador');
    await pool.query(`INSERT INTO registro_auditoria(negocio_id,usuario_id,entidad,entidad_id,accion)
      VALUES($1,$2,'usuarios',$2,'admin_produccion_verificado')`,[negocio.id,id]);
    process.stdout.write('Administrador de producción creado y acceso verificado.\n');
    return;
  }
  const pruebaAdmin=await pool.query(`SELECT 1 FROM registro_auditoria a JOIN usuarios u ON u.id=a.entidad_id
    WHERE a.negocio_id=$1 AND a.accion='admin_produccion_verificado' AND u.correo=$2 AND u.activo LIMIT 1`,
    [negocio.id,datos.admin.correo.toLowerCase()]);
  if(!pruebaAdmin.rowCount)throw new Error('Falta verificación de acceso del administrador nuevo');
  for(const cuenta of datos.asesores){
    await guardarCuenta(cuenta,'asesor',negocio.id,equipo.id);
    await verificarIngreso(cuenta,'asesor');
  }
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    await c.query('SELECT id FROM equipos WHERE id=$1 FOR UPDATE',[equipo.id]);
    const nuevos=(await c.query<{id:string;correo:string}>(`SELECT id,correo FROM usuarios WHERE negocio_id=$1
      AND correo=ANY($2::text[]) AND rol='asesor' AND activo ORDER BY correo`,
      [negocio.id,datos.asesores.map(x=>x.correo.toLowerCase())])).rows;
    if(nuevos.length!==2)throw new Error('No se encontraron ambos asesores nuevos');
    const anteriores=(await c.query<{id:string}>(`SELECT id FROM usuarios WHERE negocio_id=$1
      AND correo LIKE '%@valana.local' FOR UPDATE`,[negocio.id])).rows;
    const ids=anteriores.map(x=>x.id);
    const grupos=ids.length?(await c.query<{contacto_id:string;equipo_id:string}>(`SELECT DISTINCT contacto_id,equipo_id
      FROM solicitudes WHERE asesor_id=ANY($1::uuid[]) AND estado<>'cerrada' ORDER BY equipo_id,contacto_id`,[ids])).rows:[];
    let reasignadas=0;
    for(const g of grupos){
      if(g.equipo_id!==equipo.id)throw new Error('Hay solicitudes en otro equipo; no se reasignan automáticamente');
      await c.query('SELECT id FROM contactos WHERE id=$1 FOR UPDATE',[g.contacto_id]);
      const destino=(await c.query<{id:string}>(`SELECT u.id FROM usuarios u
        WHERE u.id=ANY($1::uuid[]) ORDER BY
          CASE WHEN EXISTS(SELECT 1 FROM solicitudes s WHERE s.asesor_id=u.id
            AND s.contacto_id=$2 AND s.equipo_id=$3 AND s.estado<>'cerrada') THEN 0 ELSE 1 END,
          (SELECT count(*) FROM solicitudes s WHERE s.asesor_id=u.id AND s.estado<>'cerrada'),u.id LIMIT 1`,
        [nuevos.map(x=>x.id),g.contacto_id,g.equipo_id])).rows[0];
      const solicitudes=(await c.query<{id:string;asesor_id:string}>(`SELECT id,asesor_id FROM solicitudes
        WHERE contacto_id=$1 AND equipo_id=$2 AND asesor_id=ANY($3::uuid[]) AND estado<>'cerrada' FOR UPDATE`,
        [g.contacto_id,g.equipo_id,ids])).rows;
      for(const solicitud of solicitudes){
        await c.query('UPDATE solicitudes SET asesor_id=$2 WHERE id=$1',[solicitud.id,destino.id]);
        await c.query(`INSERT INTO historial_asignaciones
          (solicitud_id,asesor_anterior_id,asesor_nuevo_id,motivo)
          VALUES($1,$2,$3,'retiro_cuentas_prueba')`,[solicitud.id,solicitud.asesor_id,destino.id]);
        await c.query(`INSERT INTO notificaciones(usuario_id,solicitud_id,tipo,texto)
          VALUES($1,$2,'reasignacion','Se te reasignó una solicitud.')`,[destino.id,solicitud.id]);
        reasignadas++;
      }
    }
    if(ids.length){
      await c.query(`UPDATE usuarios SET activo=false,disponible=false,retirado_en=now() WHERE id=ANY($1::uuid[])`,[ids]);
      await c.query('UPDATE miembros_equipo SET activo=false WHERE usuario_id=ANY($1::uuid[])',[ids]);
      await c.query('UPDATE sesiones SET revocada_en=now() WHERE usuario_id=ANY($1::uuid[]) AND revocada_en IS NULL',[ids]);
    }
    const abandonadas=await c.query(`SELECT 1 FROM solicitudes WHERE asesor_id=ANY($1::uuid[])
      AND estado<>'cerrada' LIMIT 1`,[ids]);
    if(abandonadas.rowCount)throw new Error('Quedaron solicitudes abiertas en cuentas retiradas');
    await c.query('COMMIT');
    process.stdout.write(`Provisión verificada: 2 asesores nuevos, ${ids.length} cuentas de prueba retiradas, ${reasignadas} solicitudes reasignadas.\n`);
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
main().catch(e=>{process.stderr.write(`Error de provisión: ${e instanceof Error?e.message:'desconocido'}\n`);process.exitCode=1})
  .finally(()=>pool.end());
