import { describe, expect, it } from 'vitest';
import { interpretarOpcion, normalizar, Opcion } from './menu';
const opciones:Opcion[]=[
  {id:'a',numero:1,identificador:'admisiones',nombre:'Admisiones',equipo_id:'e'},
  {id:'m',numero:3,identificador:'matriculas',nombre:'Matrículas',equipo_id:'e'}
];
describe('interpretación estricta del menú',()=>{
  it('acepta número, nombre y acentos normalizados',()=>{
    expect(interpretarOpcion('1',opciones)?.id).toBe('a');
    expect(interpretarOpcion('1. Admisiones',opciones)?.id).toBe('a');
    expect(interpretarOpcion('  matriculas ',opciones)?.id).toBe('m');
    expect(normalizar('  MATRÍCULAS  ')).toBe('matriculas');
  });
  it('rechaza número con nombre de otra opción y saludos',()=>{
    expect(interpretarOpcion('1. Matrículas',opciones)).toBeUndefined();
    expect(interpretarOpcion('Hola',opciones)).toBeUndefined();
    expect(interpretarOpcion('Admisiones por favor',opciones)).toBeUndefined();
  });
  it('acepta identificador estructurado exacto',()=>{
    expect(interpretarOpcion('',opciones,'matriculas')?.id).toBe('m');
    expect(interpretarOpcion('',opciones,'desconocido')).toBeUndefined();
  });
});
