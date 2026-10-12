import { describe, expect, it } from 'vitest';
import { destinatarioMeta, identificarRemitente } from './meta-identidad';

describe('identidad de remitentes de WhatsApp',()=>{
  it('mantiene la ruta telefónica cuando Meta entrega número y BSUID',()=>{
    const r=identificarRemitente({from:'51923880101',from_user_id:'PE.123'},
      [{wa_id:'51923880101',user_id:'PE.123',profile:{name:'Cliente'}}]);
    expect(r).toMatchObject({telefono:'51923880101',metaUserId:'PE.123',nombre:'Cliente'});
    expect(destinatarioMeta(`+${r.telefono}`,r.metaUserId || null)).toEqual({to:'51923880101'});
  });
  it('admite un usuario con teléfono privado y conserva su nombre visible',()=>{
    const r=identificarRemitente({from:null,from_user_id:'PE.987'},
      [{user_id:'PE.987',profile:{name:'Amigo',username:'varasp7'}}]);
    expect(r).toMatchObject({telefono:undefined,metaUserId:'PE.987',username:'varasp7'});
    expect(destinatarioMeta(null,r.metaUserId || null)).toEqual({recipient:'PE.987'});
  });
  it('acepta campos de teléfono vacíos y BSUID como remitente',()=>{
    const r=identificarRemitente({from:'',from_user_id:'PE.987'},[{wa_id:'',user_id:'PE.987'}]);
    expect(r.telefono).toBeUndefined();
    expect(r.metaUserId).toBe('PE.987');
    expect(identificarRemitente({from:'PE.987'},[]).metaUserId).toBe('PE.987');
  });
});
