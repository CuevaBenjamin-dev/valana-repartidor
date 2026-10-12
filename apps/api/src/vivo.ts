import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Response } from 'express';
import { Client } from 'pg';
import { config } from './config';

@Injectable()
export class ActualizacionEnVivo implements OnModuleInit, OnModuleDestroy {
  private readonly logger=new Logger(ActualizacionEnVivo.name);
  private readonly usuarios=new Map<string,Set<Response>>();
  private readonly equipos=new Map<string,Set<Response>>();
  private readonly trabajos=new Set<()=>void>();
  private cliente?:Client;
  private reintento?:NodeJS.Timeout;
  private cerrando=false;
  private avisoCaida=false;

  get activo() {return Boolean(this.cliente);}

  async onModuleInit() {await this.conectar();}

  private async conectar() {
    if(this.cerrando || this.cliente)return;
    const cliente=new Client({connectionString:config.DATABASE_URL});
    cliente.on('error',()=>this.perder(cliente));
    cliente.on('end',()=>this.perder(cliente));
    try {
      await cliente.connect();
      await cliente.query('LISTEN valana_usuario');
      await cliente.query('LISTEN valana_equipo');
      await cliente.query('LISTEN valana_trabajos');
      cliente.on('notification',mensaje=>{
        if(mensaje.channel==='valana_usuario')this.emitir(this.usuarios.get(mensaje.payload || ''));
        if(mensaje.channel==='valana_equipo')this.emitir(this.equipos.get(mensaje.payload || ''));
        if(mensaje.channel==='valana_trabajos')for(const despertar of this.trabajos)despertar();
      });
      this.cliente=cliente;
      if(this.avisoCaida)this.logger.log('Actualización en vivo reconectada a PostgreSQL');
      this.avisoCaida=false;
    } catch {
      await cliente.end().catch(()=>undefined);
      this.programarReintento();
    }
  }

  private perder(cliente:Client) {
    if(this.cliente!==cliente)return;
    this.cliente=undefined;
    for(const respuestas of [...this.usuarios.values(),...this.equipos.values()])for(const res of respuestas)res.end();
    this.usuarios.clear();this.equipos.clear();
    void cliente.end().catch(()=>undefined);
    this.programarReintento();
  }

  private programarReintento() {
    if(this.cerrando || this.reintento)return;
    if(!this.avisoCaida)this.logger.warn('Actualización en vivo desconectada; reintentando');
    this.avisoCaida=true;
    this.reintento=setTimeout(()=>{this.reintento=undefined;void this.conectar()},3000);
  }

  private emitir(respuestas?:Set<Response>) {
    if(!respuestas)return;
    for(const res of respuestas) {
      try {res.write('event: actualizar\ndata: {}\n\n');}
      catch {res.end();}
    }
  }

  alTrabajo(despertar:()=>void) {
    this.trabajos.add(despertar);
    return ()=>this.trabajos.delete(despertar);
  }

  suscribir(usuarioId:string,equipoIds:string[],res:Response,expiraEn:Date) {
    const agregar=(mapa:Map<string,Set<Response>>,id:string)=>{
      let grupo=mapa.get(id);
      if(!grupo){grupo=new Set();mapa.set(id,grupo);}
      grupo.add(res);
    };
    agregar(this.usuarios,usuarioId);
    for(const id of equipoIds)agregar(this.equipos,id);
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache, no-transform');
    res.setHeader('X-Accel-Buffering','no');
    res.setHeader('Connection','keep-alive');
    res.flushHeaders();
    res.write('retry: 5000\n: conectado\n\n');
    const latido=setInterval(()=>res.write(': vivo\n\n'),25000);
    const vencimiento=setTimeout(()=>res.end(),Math.max(0,Math.min(24*60*60_000,expiraEn.getTime()-Date.now())));
    const limpiar=()=>{
      clearInterval(latido);clearTimeout(vencimiento);
      for(const [mapa,ids] of [[this.usuarios,[usuarioId]],[this.equipos,equipoIds]] as const)
        for(const id of ids){const grupo=mapa.get(id);grupo?.delete(res);if(grupo?.size===0)mapa.delete(id);}
    };
    res.once('close',limpiar);
  }

  async onModuleDestroy() {
    this.cerrando=true;
    if(this.reintento)clearTimeout(this.reintento);
    for(const respuestas of [...this.usuarios.values(),...this.equipos.values()])for(const res of respuestas)res.end();
    this.usuarios.clear();this.equipos.clear();
    await this.cliente?.end().catch(()=>undefined);
  }
}
