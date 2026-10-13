import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prepararFoto, guardarFoto, leerFoto, eliminarFoto } from './perfil-foto';

describe('fotografía de perfil',()=>{
  it('convierte formatos auténticos y conserva una foto reemplazada',async()=>{
    const base=sharp({create:{width:80,height:60,channels:4,background:'#123b8c'}});
    const formatos=[await base.clone().png().toBuffer(),await base.clone().jpeg().toBuffer(),
      await base.clone().webp().toBuffer(),await base.clone().gif().toBuffer(),await base.clone().avif().toBuffer()];
    for(const entrada of formatos){
      const foto=await prepararFoto(entrada);
      const meta=await sharp(foto).metadata();
      expect(meta.format).toBe('webp');expect(meta.width).toBe(80);expect(meta.height).toBe(60);
    }
    const primera=await guardarFoto(await prepararFoto(formatos[0]));
    const segunda=await guardarFoto(await prepararFoto(formatos[1]));
    try{expect(await leerFoto(primera)).toBeTruthy();expect((await sharp(await leerFoto(segunda)).metadata()).format).toBe('webp')}
    finally{await eliminarFoto(primera);await eliminarFoto(segunda)}
  });
  it('acepta una imagen real de más de 2 MB y rechaza más de 3 MB',async()=>{
    const entrada=await sharp(randomBytes(900*900*3),{raw:{width:900,height:900,channels:3}}).png().toBuffer();
    expect(entrada.length).toBeGreaterThan(2*1024*1024);
    expect(entrada.length).toBeLessThan(3*1024*1024);
    await expect(prepararFoto(entrada)).resolves.toBeTruthy();
    await expect(prepararFoto(Buffer.alloc(3*1024*1024+1))).rejects.toThrow('3 MB');
  });
  it('rechaza contenido que no sea una imagen',async()=>{
    await expect(prepararFoto(Buffer.from('no es una foto'))).rejects.toThrow('imagen está dañada');
  });
});
