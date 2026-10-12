export interface RemitenteMeta { from?:string|null; from_user_id?:string|null; }
export interface ContactoMeta { wa_id?:string|null; user_id?:string|null; profile?:{name?:string;username?:string}; }

export function identificarRemitente(m:RemitenteMeta,contactos:ContactoMeta[]=[]){
  const contacto=contactos.find(c=>(m.from_user_id && c.user_id===m.from_user_id) || (m.from && c.wa_id===m.from))
    || (contactos.length===1?contactos[0]:undefined);
  const origen=m.from?.trim() || '';
  const waId=contacto?.wa_id?.trim() || '';
  const telefono=/^[1-9][0-9]{6,14}$/.test(origen)?origen:/^[1-9][0-9]{6,14}$/.test(waId)?waId:undefined;
  const metaUserId=m.from_user_id?.trim() || contacto?.user_id?.trim() || (origen && !telefono?origen:undefined);
  return {telefono,metaUserId,nombre:contacto?.profile?.name,username:contacto?.profile?.username};
}

export function destinatarioMeta(telefono:string|null,metaUserId:string|null){
  if(telefono)return {to:telefono.replace(/^\+/,'')};
  if(metaUserId)return {recipient:metaUserId};
  throw new Error('Respuesta sin destinatario Meta');
}
