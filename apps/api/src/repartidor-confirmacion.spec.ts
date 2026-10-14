import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { Bd } from './bd';

const negocio='11111111-1111-4111-8111-111111111111';
const equipo='22222222-2222-4222-8222-222222222222';
const contacto='33333333-3333-4333-8333-333333333333';
const solicitudId='44444444-4444-4444-8444-444444444444';
const asesor='55555555-5555-4555-8555-555555555555';
const confirmacion='Gracias por contactarnos. Un asesor académico te escribirá desde otro número de WhatsApp.';
let Repartidor:typeof import('./repartidor').Repartidor;

beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL','postgres://localhost/test');
  vi.stubEnv('WEB_ORIGIN','https://valana.example.test');
  Repartidor=(await import('./repartidor')).Repartidor;
});

function preparar(conSolicitud=false){
  const mensajes:string[]=[];
  const procesados=new Set<string>();
  const solicitud:{id:string;asesor_id:string|null;opcion_id:string|null;confirmacion_en:Date|null;creada_en:Date}|null=
    conSolicitud?{id:solicitudId,asesor_id:asesor,opcion_id:null,confirmacion_en:null,creada_en:new Date()}:null;
  const estado={solicitud};
  const c={query:vi.fn(async(sql:string,parametros:unknown[]=[])=>{
    if(sql.includes('SELECT * FROM negocios'))return {rows:[{id:negocio,zona_horaria:'America/Lima',
      dias_atencion:null,hora_inicio:null,hora_fin:null,mensaje_menu:'Bienvenido a Boston',
      mensaje_confirmacion:confirmacion,mensaje_fuera_horario:'Fuera de horario',
      mensaje_sin_asesor:'Sin asesores disponibles'}],rowCount:1};
    if(sql.includes('FROM equipos WHERE negocio_id='))return {rows:[{id:equipo}],rowCount:1};
    if(sql.includes('SELECT id,telefono,meta_user_id FROM contactos'))
      return {rows:[{id:contacto,telefono:'+51923880101',meta_user_id:null}],rowCount:1};
    if(sql.includes('UPDATE contactos SET'))return {rows:[{id:contacto}],rowCount:1};
    if(sql.includes('INSERT INTO interacciones_entrantes')){
      const id=String(parametros[0]);
      if(procesados.has(id))return {rows:[],rowCount:0};
      procesados.add(id);return {rows:[{id}],rowCount:1};
    }
    if(sql.includes('FROM opciones_menu'))return {rows:[
      {id:'opcion-1',numero:1,identificador:'admisiones',nombre:'Admisiones',equipo_id:equipo},
      {id:'opcion-3',numero:3,identificador:'matriculas',nombre:'Matrículas',equipo_id:equipo},
      {id:'opcion-4',numero:4,identificador:'otras',nombre:'Otras consultas',equipo_id:equipo}
    ],rowCount:3};
    if(sql.includes('AS en_ventana FROM solicitudes'))return {rows:estado.solicitud?
      [{...estado.solicitud,en_ventana:true}]:[],rowCount:estado.solicitud?1:0};
    if(sql.includes('INSERT INTO solicitudes(codigo')){
      estado.solicitud={id:solicitudId,asesor_id:null,opcion_id:parametros[4] as string|null,
        confirmacion_en:null,creada_en:new Date()};
      return {rows:[{id:solicitudId}],rowCount:1};
    }
    if(sql.includes('UPDATE solicitudes SET asesor_id='))estado.solicitud!.asesor_id=String(parametros[1]);
    if(sql.includes('UPDATE solicitudes SET opcion_id='))estado.solicitud!.opcion_id=String(parametros[1]);
    if(sql.includes('UPDATE solicitudes SET confirmacion_en=')){
      if(estado.solicitud!.confirmacion_en)return {rows:[],rowCount:0};
      estado.solicitud!.confirmacion_en=new Date();
      return {rows:[{id:solicitudId}],rowCount:1};
    }
    if(sql.includes('INSERT INTO mensajes_salientes'))mensajes.push(String(parametros[3]));
    return {rows:[],rowCount:1};
  })};
  const repartidor=new Repartidor({} as Bd);
  vi.spyOn(repartidor as never,'pendientesEnBloqueo').mockResolvedValue(0 as never);
  vi.spyOn(repartidor as never,'jornada').mockResolvedValue('jornada' as never);
  vi.spyOn(repartidor as never,'sortear').mockResolvedValue(asesor as never);
  const recibir=(id:string,texto:string)=>repartidor.procesarMensaje(c as unknown as PoolClient,negocio,
    {id,telefono:'51923880101',tipo:'text',texto});
  return {mensajes,estado,recibir,c};
}

describe('confirmación de una solicitud asignada',()=>{
  it('envía menú y después la confirmación configurada al primer texto libre',async()=>{
    const {mensajes,estado,recibir,c}=preparar();
    await recibir('meta-1','Buen día quisiera más información');
    expect(estado.solicitud?.asesor_id).toBe(asesor);
    expect(estado.solicitud?.opcion_id).toBeNull();
    expect(mensajes).toHaveLength(2);
    expect(mensajes[0]).toContain('3. Matrículas');
    expect(mensajes[1]).toBe(confirmacion);
    expect(c.query.mock.calls.filter(([sql])=>sql.includes('UPDATE solicitudes SET confirmacion_en='))).toHaveLength(1);
  });
  it('conserva «3 y 4» como mensaje adicional sin repetir confirmación ni reparto',async()=>{
    const {mensajes,estado,recibir,c}=preparar();
    await recibir('meta-1','Buen día quisiera más información');
    await recibir('meta-2','3 y 4');
    await recibir('meta-2','3 y 4'); // Reintento del mismo webhook.
    expect(estado.solicitud?.opcion_id).toBeNull();
    expect(mensajes.filter(x=>x===confirmacion)).toHaveLength(1);
    expect(c.query.mock.calls.filter(([sql])=>sql.includes('INSERT INTO solicitudes(codigo'))).toHaveLength(1);
  });
  it('confirma una solicitud anterior aún sin confirmar al recibir un texto libre',async()=>{
    const {mensajes,estado,recibir}=preparar(true);
    await recibir('meta-3','3 y 4');
    await recibir('meta-4','Hola');
    expect(estado.solicitud?.confirmacion_en).not.toBeNull();
    expect(mensajes).toEqual([confirmacion]);
  });
  it('mantiene la clasificación válida sin crear otra solicitud ni confirmar dos veces',async()=>{
    const {mensajes,estado,recibir,c}=preparar();
    await recibir('meta-5','Buen día quisiera más información');
    await recibir('meta-6','3');
    expect(estado.solicitud?.opcion_id).toBe('opcion-3');
    expect(mensajes.filter(x=>x===confirmacion)).toHaveLength(1);
    expect(c.query.mock.calls.filter(([sql])=>sql.includes('INSERT INTO solicitudes(codigo'))).toHaveLength(1);
  });
});
