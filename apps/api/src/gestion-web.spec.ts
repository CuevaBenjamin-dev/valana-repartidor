import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bd } from './bd';
let ConfiguracionController:typeof import('./gestion').ConfiguracionController;
beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL','postgres://localhost/test');
  vi.stubEnv('WEB_ORIGIN','https://valana.example.test');
  ConfiguracionController=(await import('./gestion')).ConfiguracionController;
});

const negocio='11111111-1111-4111-8111-111111111111';
const administrador='22222222-2222-4222-8222-222222222222';
const saliente='33333333-3333-4333-8333-333333333333';
const destino='44444444-4444-4444-8444-444444444444';
const solicitud='55555555-5555-4555-8555-555555555555';
const equipo='66666666-6666-4666-8666-666666666666';
const req={usuario:{id:administrador,negocio_id:negocio,rol:'administrador'}} as never;

describe('retiro de asesor con solicitudes web',()=>{
  it('reasigna la solicitud y avisa al nuevo asesor antes de desactivar la cuenta',async()=>{
    const sql:string[]=[];
    const c={query:vi.fn(async(q:string)=>{
      sql.push(q);
      if(q.includes('FROM usuarios') && q.includes('FOR UPDATE'))return {rows:[{id:saliente}],rowCount:1};
      if(q.includes('SELECT e.id FROM equipos'))return {rows:[{id:equipo}],rowCount:1};
      if(q.includes('FROM solicitudes_web') && q.includes('FOR UPDATE'))return {rows:[{id:solicitud,equipo_id:equipo}],rowCount:1};
      if(q.includes('SELECT u.id FROM usuarios'))return {rows:[{id:destino}],rowCount:1};
      return {rows:[],rowCount:0};
    })};
    const bd={transaccion:vi.fn(async(fn:(cliente:typeof c)=>Promise<unknown>)=>fn(c))} as unknown as Bd;
    await expect(new ConfiguracionController(bd).retirarAsesor(req,saliente)).resolves.toEqual({reasignadas:1});
    const actualizacion=sql.findIndex(q=>q.startsWith('UPDATE solicitudes_web SET asesor_id'));
    const aviso=sql.findIndex(q=>q.includes('INSERT INTO notificaciones_web'));
    const baja=sql.findIndex(q=>q.startsWith('UPDATE usuarios SET activo=false'));
    expect(actualizacion).toBeGreaterThanOrEqual(0);
    expect(aviso).toBeGreaterThan(actualizacion);
    expect(baja).toBeGreaterThan(aviso);
    expect(c.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE solicitudes_web SET asesor_id'),[solicitud,destino]);
  });
});
