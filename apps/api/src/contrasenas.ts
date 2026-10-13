import { createHash } from 'node:crypto';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

const comunes=new Set([
  'password','password1','password123','password123!','qwerty','qwerty123','qwerty123!',
  '123456','12345678','123456789','1234567890','123456a!','admin123!','boston123!',
  'valana123!','changeme','welcome1!','contraseña123!'
]);

export function validarFormatoClave(nueva:string,confirmacion:string,rol:string){
  if(nueva!==confirmacion)throw new ForbiddenException('Las contraseñas nuevas no coinciden');
  if(nueva.length>1024)throw new ForbiddenException('La contraseña es demasiado larga');
  if(rol==='asesor'){
    if(nueva.length<6 || !/[A-Z]/.test(nueva) || !/[^\p{L}\p{N}]/u.test(nueva))
      throw new ForbiddenException('Usa al menos 6 caracteres, una mayúscula y un carácter especial');
  }else if(nueva.length<14 || !/[a-z]/.test(nueva) || !/[A-Z]/.test(nueva) || !/\d/.test(nueva) || !/[^\p{L}\p{N}]/u.test(nueva)){
    throw new ForbiddenException('Usa al menos 14 caracteres, mayúscula, minúscula, número y símbolo');
  }
  if(comunes.has(nueva.trim().toLowerCase()))throw new ForbiddenException('Esta contraseña es demasiado común');
}

export async function verificarClaveComprometida(nueva:string){
  const huella=createHash('sha1').update(nueva,'utf8').digest('hex').toUpperCase();
  try{
    const respuesta=await fetch(`https://api.pwnedpasswords.com/range/${huella.slice(0,5)}`,{
      headers:{'User-Agent':'Valana-Repartidor/1.0','Add-Padding':'true'},signal:AbortSignal.timeout(3500)
    });
    if(!respuesta.ok)throw new Error('Servicio no disponible');
    const sufijo=huella.slice(5);
    const comprometida=(await respuesta.text()).split('\n').some(line=>{
      const [hash,veces]=line.trim().split(':');
      return hash===sufijo && Number(veces)>0;
    });
    if(comprometida)throw new ForbiddenException('Esta contraseña aparece en filtraciones conocidas; elige otra');
  }catch(e){
    if(e instanceof ForbiddenException)throw e;
    throw new ServiceUnavailableException('No se pudo comprobar la seguridad de la contraseña; intenta nuevamente');
  }
}
