import { BadRequestException, Controller, Get, Post, Param, Body, Req, UseGuards, HttpCode, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Bd } from './bd';
import { SesionesGuard, SolicitudAutenticada, exigirRol } from './auth';
import { config } from './config';
import { FormularioWeb, Repartidor } from './repartidor';

const uuid=z.string().uuid();
const texto=(max:number)=>z.string().trim().min(1).max(max);
const base={id:z.number().int().positive(),fecha_creacion:z.string().regex(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/),idioma:z.enum(['es','en'])};
const formulario=z.discriminatedUnion('tipo',[
  z.object({...base,tipo:z.literal('postulacion'),nombre_estudiante:texto(120),edad_estudiante:z.number().int().min(5).max(18),
    grado:texto(24),nombre_apoderado:texto(120),telefono_apoderado:texto(25),correo_apoderado:z.email().max(254),
    medio_contacto:z.enum(['telefono','whatsapp','correo'])}).strict(),
  z.object({...base,tipo:z.literal('contacto'),nombre:texto(120),correo:z.email().max(254),telefono:z.string().max(25).nullable(),
    asunto:texto(150),mensaje:texto(3000)}).strict(),
]);

@Controller('integraciones/boston')
export class IntegracionBostonController {
  constructor(private readonly bd:Bd,private readonly repartidor:Repartidor) {}
  @Post('formularios') @HttpCode(200)
  async recibir(@Req() req:Request,@Body() datos:unknown) {
    const secreto=config.BOSTON_WEB_TOKEN;
    if(!secreto || secreto.length<32 || !config.META_PHONE_NUMBER_ID)
      throw new ServiceUnavailableException('Integración web no configurada');
    const recibido=req.header('authorization');
    const candidato=recibido?.startsWith('Bearer ')?recibido.slice(7):'';
    const esperado=createHash('sha256').update(secreto).digest();
    const actual=createHash('sha256').update(candidato).digest();
    if(!candidato || !timingSafeEqual(esperado,actual))throw new UnauthorizedException();
    const resultado=formulario.safeParse(datos);
    if(!resultado.success)throw new BadRequestException('Formulario inválido');
    const f=resultado.data;
    const creada=new Date(f.fecha_creacion.replace(' ','T')+'Z');
    if(Number.isNaN(creada.getTime()))throw new BadRequestException('Fecha inválida');
    const negocio=(await this.bd.consulta<{id:string}>(`SELECT id FROM negocios
      WHERE meta_phone_number_id=$1 AND activo=true`,[config.META_PHONE_NUMBER_ID])).rows[0];
    if(!negocio)throw new ServiceUnavailableException('Negocio no configurado');
    const normalizada:FormularioWeb=f.tipo==='postulacion'?{
      origen_tipo:'postulacion',origen_id:f.id,creada_en:creada,nombre:f.nombre_apoderado,correo:f.correo_apoderado,
      telefono:f.telefono_apoderado,idioma:f.idioma,medio_contacto:f.medio_contacto,estudiante:f.nombre_estudiante,
      edad_estudiante:f.edad_estudiante,grado:f.grado,asunto:null,mensaje:null
    }:{
      origen_tipo:'contacto',origen_id:f.id,creada_en:creada,nombre:f.nombre,correo:f.correo,
      telefono:f.telefono,idioma:f.idioma,medio_contacto:null,estudiante:null,edad_estudiante:null,grado:null,
      asunto:f.asunto,mensaje:f.mensaje
    };
    const guardada=await this.repartidor.registrarWeb(negocio.id,normalizada);
    return {ok:true,duplicado:guardada.duplicado};
  }
}

@Controller('desde-web') @UseGuards(SesionesGuard)
export class DesdeWebController {
  constructor(private readonly bd:Bd) {}
  private async autorizada(id:string,req:SolicitudAutenticada) {
    exigirRol(req.usuario,['administrador','asesor']);
    if(!uuid.safeParse(id).success)throw new BadRequestException('Identificador inválido');
    const r=await this.bd.consulta<{id:string;negocio_id:string;asesor_id:string|null;estado:string}>(`SELECT s.id,s.negocio_id,s.asesor_id,s.estado
      FROM solicitudes_web s JOIN miembros_equipo m ON m.equipo_id=s.equipo_id AND m.usuario_id=$2 AND m.activo
      WHERE s.id=$1 AND s.negocio_id=$3 AND ($4='administrador' OR s.asesor_id=$2)`,
      [id,req.usuario.id,req.usuario.negocio_id,req.usuario.rol]);
    if(!r.rowCount)throw new NotFoundException('Solicitud no encontrada');
    return r.rows[0];
  }
  @Get()
  async listar(@Req() req:SolicitudAutenticada) {
    exigirRol(req.usuario,['administrador','asesor']);
    return (await this.bd.consulta(`SELECT s.id,s.origen_tipo,s.origen_id,
      ('WEB-'||CASE WHEN s.origen_tipo='postulacion' THEN 'A-' ELSE 'C-' END||lpad(s.origen_id::text,4,'0')) AS codigo,
      s.nombre,s.correo,s.telefono,s.asunto,
      s.estado,s.creada_en,s.asignada_en,u.nombre AS asesor,
      EXISTS(SELECT 1 FROM notificaciones_web n WHERE n.solicitud_id=s.id AND n.usuario_id=$2 AND n.leida_en IS NULL) AS nueva
      FROM solicitudes_web s LEFT JOIN usuarios u ON u.id=s.asesor_id
      JOIN miembros_equipo m ON m.equipo_id=s.equipo_id AND m.usuario_id=$2 AND m.activo
      WHERE s.negocio_id=$1 AND ($3='administrador' OR s.asesor_id=$2)
      ORDER BY s.creada_en DESC,s.id DESC LIMIT 200`,[req.usuario.negocio_id,req.usuario.id,req.usuario.rol])).rows;
  }
  @Get(':id')
  async detalle(@Req() req:SolicitudAutenticada,@Param('id') id:string) {
    await this.autorizada(id,req);
    const [solicitud,notas]=await Promise.all([
      this.bd.consulta(`SELECT s.*,
        ('WEB-'||CASE WHEN s.origen_tipo='postulacion' THEN 'A-' ELSE 'C-' END||lpad(s.origen_id::text,4,'0')) AS codigo,
        u.nombre AS asesor FROM solicitudes_web s LEFT JOIN usuarios u ON u.id=s.asesor_id
        WHERE s.id=$1 AND ($2='administrador' OR s.asesor_id=$3)`,[id,req.usuario.rol,req.usuario.id]),
      this.bd.consulta(`SELECT n.id,n.texto,n.creada_en,u.nombre AS autor FROM notas_solicitud_web n
        JOIN usuarios u ON u.id=n.autor_id WHERE n.solicitud_id=$1 ORDER BY n.creada_en`,[id])
    ]);
    if(!solicitud.rowCount)throw new NotFoundException('Solicitud no encontrada');
    return {solicitud:solicitud.rows[0],notas:notas.rows};
  }
  @Post(':id/leer') @HttpCode(200)
  async leer(@Req() req:SolicitudAutenticada,@Param('id') id:string) {
    const s=await this.autorizada(id,req);
    if(s.asesor_id===req.usuario.id)await this.bd.consulta(`UPDATE notificaciones_web SET leida_en=now()
      WHERE usuario_id=$1 AND solicitud_id=$2 AND leida_en IS NULL`,[req.usuario.id,id]);
    return {ok:true};
  }
  @Post(':id/iniciar') @HttpCode(200)
  async iniciar(@Req() req:SolicitudAutenticada,@Param('id') id:string) {
    const s=await this.autorizada(id,req);
    if(s.estado!=='pendiente')throw new BadRequestException('La solicitud no está pendiente');
    await this.bd.transaccion(async c=>{
      const r=await c.query(`UPDATE solicitudes_web SET estado='en_atencion',atencion_iniciada_en=now()
        WHERE id=$1 AND negocio_id=$2 AND ($3='administrador' OR asesor_id=$4)
          AND estado='pendiente' RETURNING id`,[id,s.negocio_id,req.usuario.rol,req.usuario.id]);
      if(!r.rowCount)throw new BadRequestException('La solicitud ya cambió de estado');
      await c.query(`INSERT INTO registro_auditoria(negocio_id,usuario_id,entidad,entidad_id,accion)
        VALUES($1,$2,'solicitudes_web',$3,'iniciar_atencion')`,[s.negocio_id,req.usuario.id,id]);
    });
    return {ok:true};
  }
  @Post(':id/notas') @HttpCode(200)
  async nota(@Req() req:SolicitudAutenticada,@Param('id') id:string,@Body() datos:unknown) {
    await this.autorizada(id,req);
    const r=z.object({texto:z.string().trim().min(1).max(5000)}).strict().safeParse(datos);
    if(!r.success)throw new BadRequestException('Nota inválida');
    return this.bd.transaccion(async c=>{
      const s=await c.query<{estado:string}>(`SELECT estado FROM solicitudes_web
        WHERE id=$1 AND negocio_id=$2 AND ($3='administrador' OR asesor_id=$4) FOR UPDATE`,
        [id,req.usuario.negocio_id,req.usuario.rol,req.usuario.id]);
      if(!s.rowCount || s.rows[0].estado==='cerrada')throw new BadRequestException('La solicitud no está activa');
      const insertada=await c.query(`INSERT INTO notas_solicitud_web(solicitud_id,autor_id,texto)
        VALUES($1,$2,$3) RETURNING id,creada_en`,[id,req.usuario.id,r.data.texto]);
      return insertada.rows[0];
    });
  }
  @Post(':id/cerrar') @HttpCode(200)
  async cerrar(@Req() req:SolicitudAutenticada,@Param('id') id:string) {
    const s=await this.autorizada(id,req);
    if(s.estado==='pendiente_asignacion' || s.estado==='cerrada')throw new BadRequestException('No se puede cerrar esta solicitud');
    await this.bd.transaccion(async c=>{
      const r=await c.query(`UPDATE solicitudes_web SET estado='cerrada',cerrada_en=now()
        WHERE id=$1 AND negocio_id=$2 AND ($3='administrador' OR asesor_id=$4)
          AND estado IN ('pendiente','en_atencion') RETURNING id`,[id,s.negocio_id,req.usuario.rol,req.usuario.id]);
      if(!r.rowCount)throw new BadRequestException('La solicitud ya cambió de estado');
      await c.query(`INSERT INTO registro_auditoria(negocio_id,usuario_id,entidad,entidad_id,accion)
        VALUES($1,$2,'solicitudes_web',$3,'cerrar_atencion')`,[s.negocio_id,req.usuario.id,id]);
    });
    return {ok:true};
  }
}
