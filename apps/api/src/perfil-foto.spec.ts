import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prepararFoto } from './perfil-foto';

describe('fotografía de perfil',()=>{
  it('verifica y convierte una imagen auténtica a WebP compacto',async()=>{
    const png=await sharp({create:{width:80,height:60,channels:4,background:'#123b8c'}}).png().toBuffer();
    const foto=await prepararFoto(png,'image/png');
    const meta=await sharp(foto).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(80);
    expect(meta.height).toBe(60);
  });
  it('rechaza un archivo falso y una discrepancia entre contenido y MIME',async()=>{
    await expect(prepararFoto(Buffer.from('no es una foto'),'image/png')).rejects.toThrow('no es una imagen válida');
    const png=await sharp({create:{width:1,height:1,channels:3,background:'#fff'}}).png().toBuffer();
    await expect(prepararFoto(png,'image/jpeg')).rejects.toThrow('no es una imagen válida');
  });
});
