import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { Bd } from './bd';

let Repartidor:typeof import('./repartidor').Repartidor;
beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL','postgres://localhost/test');
  vi.stubEnv('WEB_ORIGIN','https://valana.example.test');
  Repartidor=(await import('./repartidor')).Repartidor;
});

describe('participación en el reparto',()=>{
  it('incluye asesoras activas aunque no tengan disponibilidad manual ni conexión reciente',async()=>{
    const consultas:string[]=[];
    const c={query:vi.fn(async(sql:string)=>{
      consultas.push(sql);
      if(sql.startsWith('SELECT u.id FROM usuarios'))return {rows:[{id:'en-linea'},{id:'sin-conexion'}]};
      if(sql.startsWith('SELECT u.id,cj.contador_ajustado'))return {rows:[
        {id:'en-linea',contador_ajustado:2,elegible_anterior:true},
        {id:'sin-conexion',contador_ajustado:0,elegible_anterior:false}
      ]};
      return {rows:[]};
    })};
    const repartidor=new Repartidor({} as Bd);
    const participantes=await (repartidor as unknown as {elegibles:(c:PoolClient,e:string,j:string,h:boolean)=>Promise<{id:string;contador_ajustado:number}[]>})
      .elegibles(c as unknown as PoolClient,'equipo','jornada',true);

    expect(participantes.map(u=>u.id)).toEqual(['en-linea','sin-conexion']);
    expect(participantes[1].contador_ajustado).toBe(2);
    const seleccion=consultas.find(sql=>sql.startsWith('SELECT u.id,cj.contador_ajustado')) || '';
    expect(seleccion).toContain("u.rol='asesor' AND u.activo AND m.activo");
    expect(seleccion).not.toContain('u.disponible');
    expect(seleccion).not.toContain('u.presencia_en');
  });
});
