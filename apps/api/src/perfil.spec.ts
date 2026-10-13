import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bd } from './bd';
import type { Repartidor } from './repartidor';

let Controller:typeof import('./api').PerfilController;
beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL','postgres://localhost/test');
  vi.stubEnv('WEB_ORIGIN','https://valana.example.test');
  vi.stubEnv('META_APP_SECRET','test');vi.stubEnv('META_VERIFY_TOKEN','test');
  vi.stubEnv('META_ACCESS_TOKEN','test');vi.stubEnv('META_PHONE_NUMBER_ID','123456');
  Controller=(await import('./api')).PerfilController;
});

describe('perfil propio',()=>{
  for(const rol of ['administrador','asesor'])it(`carga el perfil del ${rol} por su propia sesión`,async()=>{
    const id='11111111-1111-4111-8111-111111111111';
    const bd={consulta:vi.fn(async(_sql:string,valores:unknown[])=>({rows:[{
      id:valores[0],nombre:'Usuario',apellidos:'Valana',celular_personal:null,foto_perfil:null,rol
    }]}))} as unknown as Bd;
    const req={usuario:{id,rol}} as Parameters<InstanceType<typeof Controller>['perfil']>[0];
    const perfil=await new Controller(bd,{} as Repartidor).perfil(req);
    expect(perfil.id).toBe(id);expect(perfil.rol).toBe(rol);
    expect((bd.consulta as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual([id]);
  });
});
