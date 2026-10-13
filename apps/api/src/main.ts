import 'reflect-metadata';
import { Module, Controller, Get } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Bd } from './bd';
import { config } from './config';
import { SesionesGuard, SesionController } from './auth';
import { Repartidor } from './repartidor';
import { MetaController, TrabajosMeta } from './meta';
import { PerfilController, SolicitudesController, NotificacionesController } from './api';
import { SupervisionController, ConfiguracionController } from './gestion';
import { ActualizacionEnVivo } from './vivo';

@Controller('salud')
class SaludController {
  constructor(private readonly bd:Bd) {}
  @Get() async salud() { await this.bd.consulta('SELECT 1'); return {estado:'ok'}; }
}
@Module({providers:[Bd,SesionesGuard,Repartidor,TrabajosMeta,ActualizacionEnVivo],controllers:[SaludController,SesionController,MetaController,PerfilController,SolicitudesController,NotificacionesController,SupervisionController,ConfiguracionController]})
class AppModule {}

async function iniciar() {
  const app=await NestFactory.create<NestExpressApplication>(AppModule,{rawBody:true});
  app.use(cookieParser());
  app.useBodyParser('raw',{type:['image/jpeg','image/png','image/webp'],limit:'2mb'});
  app.enableCors({origin:config.WEB_ORIGIN,credentials:true,methods:['GET','POST','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','X-CSRF-Token']});
  app.enableShutdownHooks();
  await app.listen(config.PORT,'0.0.0.0');
}
iniciar().catch(e=>{console.error(e);process.exitCode=1;});
