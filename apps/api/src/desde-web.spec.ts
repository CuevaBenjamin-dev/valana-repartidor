import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bd } from './bd';
import type { Repartidor } from './repartidor';

const negocio='11111111-1111-4111-8111-111111111111';
const solicitud='22222222-2222-4222-8222-222222222222';
const usuario='33333333-3333-4333-8333-333333333333';
let Integracion:typeof import('./desde-web').IntegracionBostonController;
let Bandeja:typeof import('./desde-web').DesdeWebController;
beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL','postgres://localhost/test');
  vi.stubEnv('WEB_ORIGIN','https://valana.example.test');
  vi.stubEnv('META_PHONE_NUMBER_ID','123456');
  vi.stubEnv('BOSTON_WEB_TOKEN','test-secret-for-boston-worker-only-123456789');
  ({IntegracionBostonController:Integracion,DesdeWebController:Bandeja}=await import('./desde-web'));
},30000);

const contacto={tipo:'contacto',id:17,fecha_creacion:'2026-10-13 12:00:00',idioma:'es',
  nombre:'Persona Demo',correo:'demo@example.invalid',telefono:null,
  asunto:'Admisiones',mensaje:'Solicito información sobre vacantes'};

describe('integración privada de formularios',()=>{
  it('rechaza envíos sin credencial antes de consultar datos',async()=>{
    const bd={consulta:vi.fn()} as unknown as Bd;
    const repartidor={registrarWeb:vi.fn()} as unknown as Repartidor;
    await expect(new Integracion(bd,repartidor).recibir({header:()=>undefined} as never,contacto))
      .rejects.toThrow();
    expect(bd.consulta).not.toHaveBeenCalled();expect(repartidor.registrarWeb).not.toHaveBeenCalled();
  });
  it('entrega un formulario válido al reparto con su identificador único',async()=>{
    const bd={consulta:vi.fn().mockResolvedValue({rows:[{id:negocio}]})} as unknown as Bd;
    const repartidor={registrarWeb:vi.fn().mockResolvedValue({id:solicitud,duplicado:false})} as unknown as Repartidor;
    const respuesta=await new Integracion(bd,repartidor).recibir(
      {header:()=> 'Bearer test-secret-for-boston-worker-only-123456789'} as never,contacto);
    expect(respuesta).toEqual({ok:true,duplicado:false});
    expect(repartidor.registrarWeb).toHaveBeenCalledWith(negocio,expect.objectContaining({
      origen_tipo:'contacto',origen_id:17,nombre:'Persona Demo',mensaje:contacto.mensaje
    }));
  });
  it('rechaza campos no validados por el contrato',async()=>{
    const bd={consulta:vi.fn()} as unknown as Bd;
    const repartidor={registrarWeb:vi.fn()} as unknown as Repartidor;
    await expect(new Integracion(bd,repartidor).recibir(
      {header:()=> 'Bearer test-secret-for-boston-worker-only-123456789'} as never,
      {...contacto,turnstileToken:'no-debe-reenviarse'})).rejects.toThrow('Formulario inválido');
    expect(repartidor.registrarWeb).not.toHaveBeenCalled();
  });
});

describe('permisos de Desde Web',()=>{
  it('el asesor solo recibe las solicitudes que la consulta autoriza para su cuenta',async()=>{
    const bd={consulta:vi.fn().mockResolvedValue({rows:[]})} as unknown as Bd;
    const req={usuario:{id:usuario,negocio_id:negocio,rol:'asesor'}} as never;
    await expect(new Bandeja(bd).detalle(req,solicitud)).rejects.toThrow('Solicitud no encontrada');
    expect(bd.consulta).toHaveBeenCalledWith(expect.stringContaining('s.asesor_id=$2'),
      [solicitud,usuario,negocio,'asesor']);
  });
  it('el rol supervisor no puede abrir el módulo',async()=>{
    const bd={consulta:vi.fn()} as unknown as Bd;
    const req={usuario:{id:usuario,negocio_id:negocio,rol:'supervisor'}} as never;
    await expect(new Bandeja(bd).listar(req)).rejects.toThrow('Acceso denegado');
    expect(bd.consulta).not.toHaveBeenCalled();
  });
});
