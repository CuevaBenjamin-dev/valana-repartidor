import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bd } from './bd';

const negocio='11111111-1111-4111-8111-111111111111';
const equipo='22222222-2222-4222-8222-222222222222';
const solicitud='33333333-3333-4333-8333-333333333333';
const asesor='44444444-4444-4444-8444-444444444444';
const jornada='55555555-5555-4555-8555-555555555555';
let Repartidor:typeof import('./repartidor').Repartidor;
beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL','postgres://localhost/test');
  vi.stubEnv('WEB_ORIGIN','https://valana.example.test');
  Repartidor=(await import('./repartidor')).Repartidor;
},30000);

const formulario={origen_tipo:'contacto' as const,origen_id:9,creada_en:new Date(),nombre:'Persona Demo',
  correo:'demo@example.invalid',telefono:null,idioma:'es' as const,medio_contacto:null,
  estudiante:null,nombres_estudiante:null,apellido_paterno_estudiante:null,apellido_materno_estudiante:null,
  institucion_procedencia:null,parentesco_apoderado:null,
  edad_estudiante:null,grado:null,asunto:'Consulta',mensaje:'Información escolar'};

function preparar(duplicado=false){
  const consultas:string[]=[];
  let insertadas=0;
  const c={query:vi.fn(async(sql:string,_params?:unknown[])=>{
    consultas.push(sql);
    if(sql.includes('FROM equipos'))return {rows:[{id:equipo,negocio_id:negocio}],rowCount:1};
    if(sql.includes('SELECT id FROM solicitudes_web'))return {rows:duplicado?[{id:solicitud}]:[],rowCount:duplicado?1:0};
    if(sql.includes('INSERT INTO solicitudes_web'))return {rows:[{id:insertadas++===0?solicitud:'66666666-6666-4666-8666-666666666666'}],rowCount:1};
    return {rows:[],rowCount:1};
  })};
  const bd={transaccion:vi.fn(async(fn:(client:typeof c)=>Promise<unknown>)=>fn(c))} as unknown as Bd;
  const repartidor=new Repartidor(bd);
  if(!duplicado){
    vi.spyOn(repartidor as never,'negocio').mockResolvedValue({id:negocio,zona_horaria:'America/Lima',
      dias_atencion:null,hora_inicio:null,hora_fin:null} as never);
    vi.spyOn(repartidor as never,'jornada').mockResolvedValue(jornada as never);
    vi.spyOn(repartidor as never,'sortear').mockResolvedValue(asesor as never);
  }
  return {repartidor,consultas,c};
}

describe('formularios y reparto compartido',()=>{
  it('una nueva solicitud web incrementa el contador diario usado por WhatsApp',async()=>{
    const {repartidor,consultas}=preparar();
    await expect(repartidor.registrarWeb(negocio,formulario)).resolves.toEqual({id:solicitud,duplicado:false});
    expect(consultas.some(sql=>sql.includes('UPDATE contadores_jornada SET solicitudes_reales=solicitudes_reales+1'))).toBe(true);
    expect(consultas.some(sql=>sql.includes('INSERT INTO notificaciones_web'))).toBe(true);
    expect(consultas.some(sql=>sql.includes('INSERT INTO mensajes_salientes'))).toBe(false);
  });
  it('reintentar el mismo tipo e ID no vuelve a asignar ni contar',async()=>{
    const {repartidor,consultas}=preparar(true);
    await expect(repartidor.registrarWeb(negocio,formulario)).resolves.toEqual({id:solicitud,duplicado:true});
    expect(consultas.some(sql=>sql.includes('UPDATE contadores_jornada'))).toBe(false);
    expect(consultas.some(sql=>sql.includes('INSERT INTO notificaciones_web'))).toBe(false);
  });
  it('conserva los campos nuevos y crea dos postulaciones de estudiantes con el mismo apoderado',async()=>{
    const {repartidor,c}=preparar();
    const postulacion={...formulario,origen_tipo:'postulacion' as const,origen_id:21,
      estudiante:'Ana Pérez García',nombres_estudiante:'Ana',apellido_paterno_estudiante:'Pérez',
      apellido_materno_estudiante:'García',institucion_procedencia:'Colegio de ejemplo',
      parentesco_apoderado:'Padre',edad_estudiante:10,grado:'primaria_5',asunto:null,mensaje:null};
    await repartidor.registrarWeb(negocio,postulacion);
    await repartidor.registrarWeb(negocio,{...postulacion,origen_id:22,estudiante:'Luis Pérez García',nombres_estudiante:'Luis'});
    const inserciones=c.query.mock.calls.filter(([sql])=>sql.includes('INSERT INTO solicitudes_web'));
    expect(inserciones).toHaveLength(2);
    expect(inserciones.map(([,params])=>params?.[3])).toEqual([21,22]);
    expect(inserciones[0][0]).toContain('parentesco_apoderado');
    expect(inserciones[0][1]?.slice(9,15)).toEqual([
      'Ana Pérez García','Ana','Pérez','García','Colegio de ejemplo','Padre']);
    expect(c.query.mock.calls.filter(([sql])=>sql.includes('UPDATE contadores_jornada SET solicitudes_reales=solicitudes_reales+1'))).toHaveLength(2);
  });
});
