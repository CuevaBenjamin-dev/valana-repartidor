import { Controller, Get, Post, Query, Req, Res, ForbiddenException, Injectable, OnModuleInit, OnModuleDestroy, Logger, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Bd } from './bd';
import { config } from './config';
import { Repartidor } from './repartidor';
import { ActualizacionEnVivo } from './vivo';
import { ContactoMeta, destinatarioMeta, identificarRemitente } from './meta-identidad';

interface MetaMensaje { id?:string; from?:string|null; from_user_id?:string; timestamp?:string; type?:string; text?:{body?:string}; interactive?:{type?:string;list_reply?:{id?:string;title?:string};button_reply?:{id?:string;title?:string}}; button?:{payload?:string;text?:string}; }
interface MetaCambio { value?: { metadata?:{phone_number_id?:string}; contacts?:ContactoMeta[]; messages?:MetaMensaje[]; statuses?:unknown[] } }
interface MetaCarga { object?:string; entry?:{changes?:MetaCambio[]}[] }

@Controller('webhooks/meta')
export class MetaController {
  private readonly logger=new Logger(MetaController.name);
  constructor(private readonly bd:Bd) {}
  @Get()
  verificar(@Query() q:Record<string,string>,@Res() res:Response) {
    if (!config.META_VERIFY_TOKEN) throw new ServiceUnavailableException('Webhook sin configurar');
    if (q['hub.mode']==='subscribe' && q['hub.verify_token']===config.META_VERIFY_TOKEN && /^\d+$/.test(q['hub.challenge']||''))
      return res.status(200).type('text/plain').send(q['hub.challenge']);
    throw new ForbiddenException('Verificación inválida');
  }
  @Post() @HttpCode(200)
  async recibir(@Req() req:Request & {rawBody?:Buffer}) {
    if (!config.META_APP_SECRET || !req.rawBody) throw new ServiceUnavailableException('Webhook sin configurar');
    const firma=req.header('x-hub-signature-256') || '';
    const esperada=`sha256=${createHmac('sha256',config.META_APP_SECRET).update(req.rawBody).digest('hex')}`;
    const x=Buffer.from(firma),y=Buffer.from(esperada);
    if (x.length!==y.length || !timingSafeEqual(x,y)) throw new ForbiddenException('Firma inválida');
    const cuerpo=req.body as MetaCarga;
    if (cuerpo?.object!=='whatsapp_business_account' || !Array.isArray(cuerpo.entry)) return {ok:true};
    for (const entrada of cuerpo.entry) for (const cambio of entrada.changes || []) {
      const v=cambio.value;
      if (v?.metadata?.phone_number_id!==config.META_PHONE_NUMBER_ID) {
        if(v?.messages?.length)this.logger.warn(`Mensajes ignorados: destino no coincide (${v.messages.length})`);
        continue;
      }
      if(!v?.messages?.length && v?.statuses?.length)this.logger.log(`Webhook de estados sin mensajes entrantes (${v.statuses.length})`);
      const negocio=await this.bd.consulta<{id:string}>('SELECT id FROM negocios WHERE meta_phone_number_id=$1',[config.META_PHONE_NUMBER_ID]);
      if (!negocio.rowCount) {if(v?.messages?.length)this.logger.warn('Mensajes ignorados: negocio no configurado');continue;}
      for (const m of v?.messages || []) {
        if (!m.id) {this.logger.warn('Mensaje ignorado: falta ID');continue;}
        const {telefono,metaUserId,nombre,username}=identificarRemitente(m,v?.contacts);
        if (!telefono && !metaUserId) {this.logger.warn('Mensaje ignorado: falta identificador del remitente');continue;}
        const identificador=m.interactive?.list_reply?.id || m.interactive?.button_reply?.id;
        const texto=m.text?.body || m.interactive?.list_reply?.title || m.interactive?.button_reply?.title || m.button?.text || '';
        const carga={id:m.id,telefono,metaUserId,nombre,username,metaTimestamp:m.timestamp,
          tipo:m.type || 'desconocido',texto,identificador};
        await this.bd.consulta(`INSERT INTO eventos_webhook(meta_mensaje_id,negocio_id,carga) VALUES($1,$2,$3)
          ON CONFLICT(meta_mensaje_id) DO NOTHING`,[m.id,negocio.rows[0].id,JSON.stringify(carga)]);
      }
    }
    return {ok:true};
  }
}

@Injectable()
export class TrabajosMeta implements OnModuleInit, OnModuleDestroy {
  private timer?:NodeJS.Timeout;
  private proximo?:NodeJS.Timeout;
  private dejarDeEscuchar?:()=>void;
  private ocupado=false;
  private repetir=false;
  private readonly logger=new Logger(TrabajosMeta.name);
  constructor(private readonly bd:Bd,private readonly repartidor:Repartidor,private readonly vivo:ActualizacionEnVivo) {}
  onModuleInit() {
    this.dejarDeEscuchar=this.vivo.alTrabajo(()=>this.despertar());
    // Revisa los reintentos programados y recupera avisos perdidos durante una desconexión.
    this.timer=setInterval(()=>this.despertar(),30000);
    this.despertar();
  }
  onModuleDestroy() {
    if(this.timer)clearInterval(this.timer);
    if(this.proximo)clearTimeout(this.proximo);
    this.dejarDeEscuchar?.();
  }
  private despertar() {
    if(this.ocupado){this.repetir=true;return;}
    if(this.proximo)return;
    this.proximo=setTimeout(()=>{this.proximo=undefined;void this.ciclo()},0);
  }
  private async ciclo() {
    if(this.ocupado){this.repetir=true;return;}
    this.ocupado=true;
    let hayMas=false;
    try { hayMas=(await this.entrantes()) || hayMas; hayMas=(await this.salientes()) || hayMas; }
    catch { this.logger.error('Fallo en procesamiento de eventos de Meta'); }
    finally {
      this.ocupado=false;
      if(this.repetir || hayMas){this.repetir=false;this.despertar();}
    }
  }
  private async entrantes() {
    for(let i=0;i<20;i++) {
      let id:string|undefined;
      try {
        const resultado=await this.bd.transaccion(async c=>{
          const r=await c.query<{id:string;negocio_id:string;carga:{id:string;telefono?:string;metaUserId?:string;username?:string;nombre?:string;tipo:string;texto:string;identificador?:string}}>(`SELECT id,negocio_id,carga
            FROM eventos_webhook WHERE estado='pendiente' AND siguiente_intento_en<=now()
            ORDER BY recibido_en LIMIT 1 FOR UPDATE SKIP LOCKED`);
          if(!r.rowCount)return false;
          id=r.rows[0].id;
          await this.repartidor.procesarMensaje(c,r.rows[0].negocio_id,r.rows[0].carga);
          await c.query(`UPDATE eventos_webhook SET estado='procesado',procesado_en=now() WHERE id=$1`,[id]);
          return true;
        });
        if(!resultado)break;
      } catch {
        if(id) await this.bd.consulta(`UPDATE eventos_webhook SET intentos=intentos+1,
          siguiente_intento_en=now()+make_interval(secs=>LEAST(3600,power(2,LEAST(intentos,10))::integer)),
          estado=CASE WHEN intentos>=9 THEN 'error' ELSE 'pendiente' END,
          error_resumen='Error de procesamiento' WHERE id=$1`,[id]);
        this.logger.error('No se pudo procesar un mensaje entrante');
      }
      if(i===19)return true;
    }
    return false;
  }
  private async salientes() {
    if(!config.META_ACCESS_TOKEN || !config.META_PHONE_NUMBER_ID)return false;
    for(let i=0;i<10;i++) {
      let id:string|undefined;
      try {
        const hubo=await this.bd.transaccion(async c=>{
          const r=await c.query<{id:string;texto:string;telefono:string|null;meta_user_id:string|null;ultima_interaccion_en:Date}>(`SELECT m.id,m.texto,c.telefono,c.meta_user_id,c.ultima_interaccion_en
            FROM mensajes_salientes m JOIN contactos c ON c.id=m.contacto_id JOIN negocios n ON n.id=m.negocio_id
            WHERE m.estado='pendiente' AND m.siguiente_intento_en<=now() AND n.meta_phone_number_id=$1
            ORDER BY m.creado_en LIMIT 1 FOR UPDATE OF m SKIP LOCKED`,[config.META_PHONE_NUMBER_ID]);
          if(!r.rowCount)return false;
          const m=r.rows[0]; id=m.id;
          if(Date.now()-new Date(m.ultima_interaccion_en).getTime()>24*60*60_000) {
            await c.query(`UPDATE mensajes_salientes SET estado='omitido',error_resumen='Fuera de ventana de atención' WHERE id=$1`,[id]);return true;
          }
          const respuesta=await fetch(`https://graph.facebook.com/${config.META_GRAPH_API_VERSION}/${config.META_PHONE_NUMBER_ID}/messages`,{
            method:'POST',signal:AbortSignal.timeout(10000),
            headers:{Authorization:`Bearer ${config.META_ACCESS_TOKEN}`,'Content-Type':'application/json'},
            body:JSON.stringify({messaging_product:'whatsapp',...destinatarioMeta(m.telefono,m.meta_user_id),
              type:'text',text:{body:m.texto}})
          });
          if(!respuesta.ok) throw new Error(`Meta HTTP ${respuesta.status}`);
          const data=await respuesta.json() as {messages?:{id?:string}[]};
          await c.query(`UPDATE mensajes_salientes SET estado='enviado',enviado_en=now(),meta_mensaje_id=$2 WHERE id=$1`,[id,data.messages?.[0]?.id || null]);
          return true;
        });
        if(!hubo)break;
      } catch {
        if(id) await this.bd.consulta(`UPDATE mensajes_salientes SET intentos=intentos+1,
          siguiente_intento_en=now()+make_interval(secs=>LEAST(3600,power(2,LEAST(intentos,10))::integer)),
          estado=CASE WHEN intentos>=9 THEN 'error' ELSE 'pendiente' END,
          error_resumen='Error de envío' WHERE id=$1`,[id]);
        this.logger.error('No se pudo enviar una respuesta a Meta');
      }
      if(i===9)return true;
    }
    return false;
  }
}
