import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bd } from './bd';

const id='11111111-1111-4111-8111-111111111111';
const contacto='22222222-2222-4222-8222-222222222222';
const asesor='33333333-3333-4333-8333-333333333333';
const clave='44444444-4444-4444-8444-444444444444';
let Controller:typeof import('./api').SolicitudesController;

beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL','postgres://test:test@localhost:5432/test');
  vi.stubEnv('WEB_ORIGIN','https://valana.example.test');
  vi.stubEnv('META_APP_SECRET','test');
  vi.stubEnv('META_VERIFY_TOKEN','test');
  vi.stubEnv('META_ACCESS_TOKEN','test');
  vi.stubEnv('META_PHONE_NUMBER_ID','123456');
  Controller=(await import('./api')).SolicitudesController;
},30000);

function preparar(ultima:Date,existente?:{id:string;contacto_id:string;autor_id:string;texto:string;estado:string},vigenteAsesor=asesor){
  const consultas:string[]=[];
  const c={query:vi.fn(async(sql:string)=>{
    consultas.push(sql);
    if(sql.includes('FROM contactos WHERE'))return {rows:[{ultima_interaccion_en:ultima}],rowCount:1};
    if(sql.includes('FROM solicitudes WHERE id='))return {rows:[{asesor_id:vigenteAsesor,estado:'pendiente'}],rowCount:1};
    if(sql.includes('FROM mensajes_salientes WHERE clave_idempotencia='))return {rows:existente?[existente]:[],rowCount:existente?1:0};
    if(sql.includes('INSERT INTO mensajes_salientes'))return {rows:[{id,estado:'pendiente'}],rowCount:1};
    throw new Error('Consulta inesperada');
  })};
  const bd={consulta:vi.fn(async(_sql:string,valores:unknown[])=>valores[1]===asesor
    ? {rows:[{id,negocio_id:id,equipo_id:id,contacto_id:contacto,asesor_id:asesor,estado:'pendiente'}],rowCount:1}
    : {rows:[],rowCount:0}),
    transaccion:vi.fn(async(fn:(cliente:typeof c)=>Promise<unknown>)=>fn(c))} as unknown as Bd;
  const req={usuario:{id:asesor,negocio_id:id,rol:'asesor'}} as Parameters<InstanceType<typeof Controller>['enviarMensaje']>[0];
  return {controlador:new Controller(bd),req,consultas};
}

describe('chat de WhatsApp',()=>{
  it('impide texto libre cuando terminó la ventana de 24 horas',async()=>{
    const {controlador,req,consultas}=preparar(new Date(Date.now()-25*60*60_000));
    await expect(controlador.enviarMensaje(req,id,{texto:'Hola',clave_idempotencia:clave})).rejects.toThrow('ventana');
    expect(consultas.some(x=>x.includes('INSERT INTO mensajes_salientes'))).toBe(false);
  });
  it('devuelve el mismo mensaje ante un reintento idempotente',async()=>{
    const {controlador,req,consultas}=preparar(new Date(),{id,contacto_id:contacto,autor_id:asesor,texto:'Hola',estado:'pendiente'});
    await expect(controlador.enviarMensaje(req,id,{texto:'Hola',clave_idempotencia:clave})).resolves.toEqual({id,estado:'pendiente'});
    expect(consultas.some(x=>x.includes('INSERT INTO mensajes_salientes'))).toBe(false);
  });
  it('encola un mensaje de asesor autorizado durante la ventana',async()=>{
    const {controlador,req,consultas}=preparar(new Date());
    await expect(controlador.enviarMensaje(req,id,{texto:'Hola',clave_idempotencia:clave})).resolves.toEqual({id,estado:'pendiente'});
    expect(consultas.filter(x=>x.includes('INSERT INTO mensajes_salientes'))).toHaveLength(1);
  });
  it('rechaza reutilizar la clave con otro contenido',async()=>{
    const {controlador,req}=preparar(new Date(),{id,contacto_id:contacto,autor_id:asesor,texto:'Distinto',estado:'pendiente'});
    await expect(controlador.enviarMensaje(req,id,{texto:'Hola',clave_idempotencia:clave})).rejects.toThrow('reutilizado');
  });
  it('impide acceder a la solicitud de otro asesor',async()=>{
    const {controlador,req,consultas}=preparar(new Date());
    req.usuario.id='55555555-5555-4555-8555-555555555555';
    await expect(controlador.enviarMensaje(req,id,{texto:'Hola',clave_idempotencia:clave})).rejects.toThrow('Solicitud no encontrada');
    expect(consultas).toHaveLength(0);
  });
  it('impide enviar si hubo una reasignación después de autorizar',async()=>{
    const {controlador,req,consultas}=preparar(new Date(),undefined,'55555555-5555-4555-8555-555555555555');
    await expect(controlador.enviarMensaje(req,id,{texto:'Hola',clave_idempotencia:clave})).rejects.toThrow('ya no está asignada');
    expect(consultas.some(x=>x.includes('INSERT INTO mensajes_salientes'))).toBe(false);
  });
});
