import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { BadRequestException } from '@nestjs/common';

const directorio=resolve(process.cwd(),'.local','fotos-perfil');
const formatos=new Set(['jpeg','png','webp','gif','avif','heif']);
const limite=3*1024*1024;

function ruta(nombre:string){
  if(!/^[0-9a-f-]{36}\.webp$/.test(nombre))throw new Error('Nombre de fotografía inválido');
  return resolve(directorio,nombre);
}

export async function prepararFoto(datos:unknown):Promise<Buffer>{
  if(!Buffer.isBuffer(datos) || datos.length===0)
    throw new BadRequestException('Selecciona una imagen válida');
  if(datos.length>limite)
    throw new BadRequestException('La fotografía debe pesar 3 MB o menos');
  try{
    const imagen=sharp(datos,{failOn:'error',limitInputPixels:16_000_000});
    const meta=await imagen.metadata();
    if(!meta.format || !formatos.has(meta.format) || !meta.width || !meta.height || meta.width>5000 || meta.height>5000)
      throw new Error('Formato o dimensiones inválidos');
    return await imagen.rotate().resize(512,512,{fit:'inside',withoutEnlargement:true})
      .webp({quality:82}).toBuffer();
  }catch{throw new BadRequestException('La imagen está dañada o su formato no se puede procesar. Prueba JPG, PNG o WebP')}
}

export async function guardarFoto(datos:Buffer):Promise<string>{
  await mkdir(directorio,{recursive:true,mode:0o700});
  const nombre=`${randomUUID()}.webp`;
  await writeFile(ruta(nombre),datos,{flag:'wx',mode:0o600});
  return nombre;
}

export async function leerFoto(nombre:string){return readFile(ruta(nombre))}
export async function eliminarFoto(nombre:string){await unlink(ruta(nombre)).catch(()=>undefined)}
