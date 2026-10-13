import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { BadRequestException } from '@nestjs/common';

const directorio=resolve(process.cwd(),'.local','fotos-perfil');
const tipos:Record<string,string>={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'};
const limite=2*1024*1024;

function ruta(nombre:string){
  if(!/^[0-9a-f-]{36}\.webp$/.test(nombre))throw new Error('Nombre de fotografía inválido');
  return resolve(directorio,nombre);
}

export async function prepararFoto(datos:unknown,tipo:string):Promise<Buffer>{
  if(!Buffer.isBuffer(datos) || datos.length===0 || datos.length>limite || !tipos[tipo])
    throw new BadRequestException('Elige una foto JPG, PNG o WebP de hasta 2 MB');
  try{
    const imagen=sharp(datos,{failOn:'error',limitInputPixels:16_000_000});
    const meta=await imagen.metadata();
    if(meta.format!==tipos[tipo] || !meta.width || !meta.height || meta.width>5000 || meta.height>5000)
      throw new Error('Formato o dimensiones inválidos');
    return await imagen.rotate().resize(512,512,{fit:'inside',withoutEnlargement:true})
      .webp({quality:82}).toBuffer();
  }catch{throw new BadRequestException('La fotografía no es una imagen válida')}
}

export async function guardarFoto(datos:Buffer):Promise<string>{
  await mkdir(directorio,{recursive:true,mode:0o700});
  const nombre=`${randomUUID()}.webp`;
  await writeFile(ruta(nombre),datos,{flag:'wx',mode:0o600});
  return nombre;
}

export async function leerFoto(nombre:string){return readFile(ruta(nombre))}
export async function eliminarFoto(nombre:string){await unlink(ruta(nombre)).catch(()=>undefined)}
