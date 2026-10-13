import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { validarFormatoClave, verificarClaveComprometida } from './contrasenas';

afterEach(()=>vi.unstubAllGlobals());

describe('cambio de contraseña',()=>{
  it('aplica la misma política de seis caracteres a asesor y administrador',()=>{
    expect(()=>validarFormatoClave('Nueva!','Nueva!','asesor')).not.toThrow();
    expect(()=>validarFormatoClave('Nueva!','Nueva!','administrador')).not.toThrow();
    expect(()=>validarFormatoClave('UnaClaveSegura!2026','UnaClaveSegura!2026','administrador')).not.toThrow();
    expect(()=>validarFormatoClave('nueva!','nueva!','administrador')).toThrow();
    expect(()=>validarFormatoClave('Nueva!7','Diferente!7','asesor')).toThrow('no coinciden');
    expect(()=>validarFormatoClave('Password123!','Password123!','asesor')).toThrow('común');
  });
  it('rechaza una contraseña presente en filtraciones sin enviar la contraseña completa',async()=>{
    const clave='Nueva!7';
    const huella=createHash('sha1').update(clave).digest('hex').toUpperCase();
    const fetchFalso=vi.fn(async()=>new Response(`${huella.slice(5)}:42\r\n`,{status:200}));
    vi.stubGlobal('fetch',fetchFalso);
    await expect(verificarClaveComprometida(clave)).rejects.toThrow('filtraciones');
    expect(fetchFalso.mock.calls[0][0]).toBe(`https://api.pwnedpasswords.com/range/${huella.slice(0,5)}`);
  });
  it('impide aceptar contraseñas sin comprobar cuando el servicio falla',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:503})));
    await expect(verificarClaveComprometida('Nueva!7')).rejects.toThrow('No se pudo comprobar');
  });
});
