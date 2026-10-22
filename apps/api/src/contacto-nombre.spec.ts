import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bd } from './bd';

const solicitud='11111111-1111-4111-8111-111111111111';
const contacto='22222222-2222-4222-8222-222222222222';
const usuario='33333333-3333-4333-8333-333333333333';
const negocio='44444444-4444-4444-8444-444444444444';
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

function preparar(autorizado=true,rol='asesor'){
  const consultas:{sql:string;valores:unknown[]}[]=[];
  const cliente={query:vi.fn(async(sql:string,valores:unknown[]=[])=>{
    consultas.push({sql,valores});
    if(sql.includes('FROM solicitudes s')&&sql.includes('FOR UPDATE OF s'))return {rows:autorizado?[{contacto_id:contacto}]:[],rowCount:autorizado?1:0};
    if(sql.startsWith('UPDATE contactos'))return {rows:[{nombre_confirmado:'María Flores'}],rowCount:1};
    return {rows:[],rowCount:0};
  })};
  const bd={transaccion:vi.fn(async(fn:(c:typeof cliente)=>Promise<unknown>)=>fn(cliente))} as unknown as Bd;
  const req={usuario:{id:usuario,negocio_id:negocio,rol}} as Parameters<InstanceType<typeof Controller>['renombrarContacto']>[0];
  return {controlador:new Controller(bd),req,consultas};
}

describe('nombre del contacto de una solicitud',()=>{
  it('guarda el nombre solo dentro del negocio y avisa a los participantes',async()=>{
    const {controlador,req,consultas}=preparar();
    await expect(controlador.renombrarContacto(req,solicitud,{nombre:'  María Flores  '})).resolves.toEqual({nombre:'María Flores'});
    expect(consultas[0].valores).toEqual([solicitud,usuario,negocio,'asesor']);
    expect(consultas.find(c=>c.sql.startsWith('UPDATE contactos'))?.valores).toEqual([contacto,'María Flores',negocio]);
    expect(consultas.some(c=>c.sql.includes("'renombrar_contacto'"))).toBe(true);
    expect(consultas.filter(c=>c.sql.includes('pg_notify'))).toHaveLength(2);
  });
  it('no altera el contacto si la solicitud no está asignada ni autorizada',async()=>{
    const {controlador,req,consultas}=preparar(false);
    await expect(controlador.renombrarContacto(req,solicitud,{nombre:'Otro nombre'})).rejects.toThrow('Solicitud no encontrada');
    expect(consultas.some(c=>c.sql.startsWith('UPDATE contactos'))).toBe(false);
  });
  it('permite al administrador y rechaza un nombre vacío',async()=>{
    const admin=preparar(true,'administrador');
    await expect(admin.controlador.renombrarContacto(admin.req,solicitud,{nombre:'María Flores'})).resolves.toEqual({nombre:'María Flores'});
    expect(admin.consultas[0].valores[3]).toBe('administrador');
    const asesor=preparar();
    await expect(asesor.controlador.renombrarContacto(asesor.req,solicitud,{nombre:'   '})).rejects.toThrow();
    expect(asesor.consultas).toHaveLength(0);
  });
});
