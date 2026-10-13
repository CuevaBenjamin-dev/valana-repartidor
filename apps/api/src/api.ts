import { BadRequestException, ConflictException, Controller, Get, Post, Patch, Param, Body, Query, Req, Res, UseGuards, NotFoundException, ForbiddenException, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { Bd } from './bd';
import { SesionesGuard, SolicitudAutenticada, exigirRol } from './auth';
import { Repartidor } from './repartidor';
import { ActualizacionEnVivo } from './vivo';
import { metaConfigurado } from './config';

const uuid=z.string().uuid();
function validar<T>(esquema:z.ZodType<T>,datos:unknown):T { const r=esquema.safeParse(datos); if(!r.success)throw new BadRequestException(r.error.flatten()); return r.data; }

@Controller('perfil') @UseGuards(SesionesGuard)
export class PerfilController {
  constructor(private readonly bd:Bd,private readonly repartidor:Repartidor) {}
  @Get()
  async perfil(@Req() req:SolicitudAutenticada) {
    const r=await this.bd.consulta(`SELECT id,nombre,correo,rol,disponible,presencia_en FROM usuarios WHERE id=$1`,[req.usuario.id]);
    return r.rows[0];
  }
  @Post('heartbeat') @HttpCode(200)
  async heartbeat(@Req() req:SolicitudAutenticada) {
    if(req.usuario.rol==='asesor')await this.repartidor.actualizarPresencia(req.usuario.id);
    else await this.bd.consulta('UPDATE usuarios SET presencia_en=now() WHERE id=$1',[req.usuario.id]);
    return {ok:true};
  }
  @Post('disponibilidad') @HttpCode(200)
  async disponibilidad(@Req() req:SolicitudAutenticada,@Body() datos:unknown) {
    exigirRol(req.usuario,['asesor']);
    const {disponible}=validar(z.object({disponible:z.boolean()}),datos);
    await this.repartidor.actualizarPresencia(req.usuario.id,disponible);
    return {disponible};
  }
}

@Controller('solicitudes') @UseGuards(SesionesGuard)
export class SolicitudesController {
  constructor(private readonly bd:Bd) {}
  private async autorizada(id:string,req:SolicitudAutenticada,soloEscritura=false) {
    const r=await this.bd.consulta<{id:string;negocio_id:string;equipo_id:string;contacto_id:string;asesor_id:string|null;estado:string}>(`SELECT s.id,s.negocio_id,s.equipo_id,s.contacto_id,s.asesor_id,s.estado
      FROM solicitudes s JOIN miembros_equipo me ON me.equipo_id=s.equipo_id AND me.usuario_id=$2 AND me.activo
      WHERE s.id=$1 AND s.negocio_id=$3 AND (s.asesor_id=$2 OR ($4=false AND $5 IN ('supervisor','administrador'))
      OR ($4=true AND $5 IN ('supervisor','administrador')))`,[id,req.usuario.id,req.usuario.negocio_id,soloEscritura,req.usuario.rol]);
    if(!r.rowCount)throw new NotFoundException('Solicitud no encontrada');
    if(soloEscritura && req.usuario.rol==='asesor' && r.rows[0].asesor_id!==req.usuario.id)throw new ForbiddenException();
    return r.rows[0];
  }
  @Get()
  async listar(@Req() req:SolicitudAutenticada,@Query('estado') estado?:string,@Query('buscar') buscar?:string) {
    const estados=['pendiente_asignacion','pendiente','en_atencion','cerrada'];
    if(estado && estado!=='todas' && !estados.includes(estado))throw new BadRequestException('Estado inválido');
    const r=await this.bd.consulta(`SELECT s.id,s.codigo,s.estado,s.creada_en,s.asignada_en,
      c.telefono,COALESCE(c.telefono,'@'||c.username_whatsapp,'Número privado') AS identificador,
      COALESCE(c.nombre_confirmado,c.nombre_whatsapp,'@'||c.username_whatsapp,'Sin confirmar') AS contacto,
      COALESCE(o.nombre,'Consulta general') AS opcion,u.nombre AS asesor,
      EXISTS(SELECT 1 FROM notificaciones n WHERE n.solicitud_id=s.id AND n.usuario_id=$2
        AND n.tipo IN ('nueva_solicitud','continuidad','reasignacion','mensaje_recibido') AND n.leida_en IS NULL) AS nueva
      FROM solicitudes s JOIN contactos c ON c.id=s.contacto_id LEFT JOIN opciones_menu o ON o.id=s.opcion_id
      LEFT JOIN usuarios u ON u.id=s.asesor_id
      JOIN miembros_equipo me ON me.equipo_id=s.equipo_id AND me.usuario_id=$2 AND me.activo
      WHERE s.negocio_id=$1 AND ($3 IN ('supervisor','administrador') OR s.asesor_id=$2)
      AND ($4::text IS NULL OR $4='todas' OR s.estado=$4)
      AND ($5::text IS NULL OR s.codigo ILIKE '%'||$5||'%' OR c.telefono ILIKE '%'||$5||'%'
        OR c.nombre_whatsapp ILIKE '%'||$5||'%' OR c.username_whatsapp ILIKE '%'||$5||'%')
      ORDER BY s.creada_en DESC LIMIT 200`,[req.usuario.negocio_id,req.usuario.id,req.usuario.rol,estado||null,buscar?.slice(0,80)||null]);
    return r.rows;
  }
  @Get(':id')
  async detalle(@Req() req:SolicitudAutenticada,@Param('id') id:string) {
    validar(uuid,id); const s=await this.autorizada(id,req);
    const [principal,notas,interacciones,mensajes]=await Promise.all([
      this.bd.consulta(`SELECT s.*,c.telefono,COALESCE(c.telefono,'@'||c.username_whatsapp,'Número privado') AS identificador,
        COALESCE(c.nombre_confirmado,c.nombre_whatsapp,'@'||c.username_whatsapp,'Sin confirmar') AS contacto,
        COALESCE(o.nombre,'Consulta general') AS opcion,u.nombre AS asesor FROM solicitudes s JOIN contactos c ON c.id=s.contacto_id
        LEFT JOIN opciones_menu o ON o.id=s.opcion_id LEFT JOIN usuarios u ON u.id=s.asesor_id WHERE s.id=$1`,[id]),
      this.bd.consulta(`SELECT n.id,n.texto,n.creada_en,u.nombre AS autor FROM notas_solicitud n JOIN usuarios u ON u.id=n.autor_id WHERE n.solicitud_id=$1 ORDER BY n.creada_en`,[id]),
      this.bd.consulta(`SELECT id,tipo,texto,recibida_en FROM interacciones_entrantes WHERE solicitud_id=$1 ORDER BY recibida_en DESC,id DESC`,[id]),
      this.bd.consulta(`SELECT * FROM (
        SELECT i.id,i.solicitud_id,i.texto,COALESCE(NULLIF(i.texto,''),'Mensaje recibido') AS contenido,
          i.recibida_en AS fecha,'entrante'::text AS direccion,'recibido'::text AS estado,NULL::text AS error
        FROM interacciones_entrantes i JOIN solicitudes h ON h.id=i.solicitud_id
        WHERE i.contacto_id=$1 AND h.contacto_id=$1 AND h.equipo_id=$2 AND h.negocio_id=$3
          AND ($4::text<>'asesor' OR h.asesor_id=$5)
        UNION ALL
        SELECT m.id,m.solicitud_id,m.texto,m.texto AS contenido,m.creado_en AS fecha,
          'saliente'::text AS direccion,COALESCE(m.meta_estado,m.estado) AS estado,m.error_resumen AS error
        FROM mensajes_salientes m JOIN solicitudes h ON h.id=m.solicitud_id
        WHERE m.contacto_id=$1 AND h.contacto_id=$1 AND h.equipo_id=$2 AND h.negocio_id=$3
          AND ($4::text<>'asesor' OR h.asesor_id=$5)
      ) conversacion ORDER BY fecha DESC,id DESC LIMIT 300`,[s.contacto_id,s.equipo_id,s.negocio_id,req.usuario.rol,req.usuario.id])
    ]);
    const ventanaHasta=(await this.bd.consulta<{ventana_hasta:Date}>(
      `SELECT ultima_interaccion_en+interval '24 hours' AS ventana_hasta FROM contactos WHERE id=$1`,[s.contacto_id])).rows[0]?.ventana_hasta;
    return {solicitud:principal.rows[0],notas:notas.rows,interacciones:interacciones.rows,
      mensajes:mensajes.rows.reverse(),ventana_hasta:ventanaHasta,envio_configurado:metaConfigurado};
  }
  @Post(':id/mensajes') @HttpCode(200)
  async enviarMensaje(@Req() req:SolicitudAutenticada,@Param('id') id:string,@Body() datos:unknown) {
    validar(uuid,id);
    if(!metaConfigurado)throw new ServiceUnavailableException('WhatsApp no está configurado');
    const {texto,clave_idempotencia}=validar(z.object({texto:z.string().trim().min(1).max(4000),clave_idempotencia:uuid}),datos);
    const s=await this.autorizada(id,req,true);
    if(s.estado==='cerrada' || s.estado==='pendiente_asignacion')throw new BadRequestException('La solicitud no está activa');
    return this.bd.transaccion(async c=>{
      const contacto=(await c.query<{ultima_interaccion_en:Date}>(
        'SELECT ultima_interaccion_en FROM contactos WHERE id=$1 AND negocio_id=$2 FOR UPDATE',[s.contacto_id,s.negocio_id])).rows[0];
      const vigente=(await c.query<{asesor_id:string|null;estado:string}>(
        'SELECT asesor_id,estado FROM solicitudes WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!vigente || vigente.estado==='cerrada' || (req.usuario.rol==='asesor' && vigente.asesor_id!==req.usuario.id))
        throw new ForbiddenException('La solicitud ya no está asignada a tu cuenta');
      const existente=await c.query<{id:string;contacto_id:string;autor_id:string;texto:string;estado:string}>(
        'SELECT id,contacto_id,autor_id,texto,estado FROM mensajes_salientes WHERE clave_idempotencia=$1',[clave_idempotencia]);
      if(existente.rowCount){
        const m=existente.rows[0];
        if(m.contacto_id!==s.contacto_id || m.autor_id!==req.usuario.id || m.texto!==texto)
          throw new ConflictException('Identificador de envío reutilizado');
        return {id:m.id,estado:m.estado};
      }
      if(!contacto || Date.now()-new Date(contacto.ultima_interaccion_en).getTime()>=24*60*60_000)
        throw new BadRequestException('La ventana de atención de WhatsApp terminó');
      const r=await c.query<{id:string;estado:string}>(`INSERT INTO mensajes_salientes
        (negocio_id,contacto_id,solicitud_id,texto,autor_id,clave_idempotencia)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL DO NOTHING RETURNING id,estado`,
        [s.negocio_id,s.contacto_id,id,texto,req.usuario.id,clave_idempotencia]);
      if(!r.rowCount)throw new ConflictException('Identificador de envío reutilizado');
      return r.rows[0];
    });
  }
  @Post(':id/leer') @HttpCode(200)
  async leerMensajes(@Req() req:SolicitudAutenticada,@Param('id') id:string,@Body() datos:unknown) {
    validar(uuid,id);
    const s=await this.autorizada(id,req);
    const {ultimo_mensaje_id}=validar(z.object({ultimo_mensaje_id:uuid.nullable()}),datos);
    if(s.asesor_id!==req.usuario.id)return {ok:true,actualizado:false};
    return this.bd.transaccion(async c=>{
      // El cursor evita marcar leído un mensaje que llegó entre la carga y este POST.
      const bloqueada=await c.query<{asesor_id:string|null}>(
        'SELECT asesor_id FROM solicitudes WHERE id=$1 FOR UPDATE',[id]);
      if(bloqueada.rows[0]?.asesor_id!==req.usuario.id)return {ok:true,actualizado:false};
      const ultimo=(await c.query<{id:string}>(`SELECT id FROM interacciones_entrantes
        WHERE solicitud_id=$1 ORDER BY recibida_en DESC,id DESC LIMIT 1`,[id])).rows[0]?.id || null;
      if(ultimo!==ultimo_mensaje_id)return {ok:true,actualizado:false};
      await c.query(`UPDATE notificaciones SET leida_en=now()
        WHERE usuario_id=$1 AND solicitud_id=$2 AND leida_en IS NULL
          AND tipo IN ('nueva_solicitud','continuidad','reasignacion','mensaje_recibido')`,[req.usuario.id,id]);
      return {ok:true,actualizado:true};
    });
  }
  @Post(':id/iniciar') @HttpCode(200)
  async iniciar(@Req() req:SolicitudAutenticada,@Param('id') id:string) {
    validar(uuid,id); const s=await this.autorizada(id,req,true);
    if(s.estado!=='pendiente')throw new BadRequestException('La solicitud no está pendiente');
    await this.bd.transaccion(async c=>{
      await c.query(`UPDATE solicitudes SET estado='en_atencion',atencion_iniciada_en=now() WHERE id=$1 AND estado='pendiente'`,[id]);
      await c.query(`INSERT INTO registro_auditoria(negocio_id,usuario_id,entidad,entidad_id,accion) VALUES($1,$2,'solicitudes',$3,'iniciar_atencion')`,[s.negocio_id,req.usuario.id,id]);
    }); return {ok:true};
  }
  @Post(':id/notas') @HttpCode(200)
  async nota(@Req() req:SolicitudAutenticada,@Param('id') id:string,@Body() datos:unknown) {
    validar(uuid,id); const s=await this.autorizada(id,req,true);
    if(s.estado==='cerrada')throw new BadRequestException('La solicitud está cerrada');
    const {texto}=validar(z.object({texto:z.string().trim().min(1).max(5000)}),datos);
    const r=await this.bd.consulta('INSERT INTO notas_solicitud(solicitud_id,autor_id,texto) VALUES($1,$2,$3) RETURNING id,creada_en',[id,req.usuario.id,texto]);
    return r.rows[0];
  }
  @Post(':id/cerrar') @HttpCode(200)
  async cerrar(@Req() req:SolicitudAutenticada,@Param('id') id:string,@Body() datos:unknown) {
    validar(uuid,id); const s=await this.autorizada(id,req,true);
    if(s.estado==='cerrada' || s.estado==='pendiente_asignacion')throw new BadRequestException('No se puede cerrar esta solicitud');
    const {resultado_comercial}=validar(z.object({resultado_comercial:z.string().trim().max(120).nullable().optional()}),datos||{});
    await this.bd.transaccion(async c=>{
      await c.query(`UPDATE solicitudes SET estado='cerrada',cerrada_en=now(),resultado_comercial=$2 WHERE id=$1 AND estado<>'cerrada'`,[id,resultado_comercial||null]);
      await c.query(`INSERT INTO registro_auditoria(negocio_id,usuario_id,entidad,entidad_id,accion) VALUES($1,$2,'solicitudes',$3,'cerrar_atencion')`,[s.negocio_id,req.usuario.id,id]);
    }); return {ok:true};
  }
}

@Controller('notificaciones') @UseGuards(SesionesGuard)
export class NotificacionesController {
  constructor(private readonly bd:Bd,private readonly vivo:ActualizacionEnVivo) {}
  @Get()
  async listar(@Req() req:SolicitudAutenticada) {
    return (await this.bd.consulta(`SELECT n.id,n.solicitud_id,n.tipo,n.texto,n.leida_en,n.creada_en,s.codigo,
      COALESCE(c.nombre_confirmado,c.nombre_whatsapp,'@'||c.username_whatsapp,'Sin confirmar') AS contacto,
      COALESCE(o.nombre,'Consulta general') AS opcion
      FROM notificaciones n LEFT JOIN solicitudes s ON s.id=n.solicitud_id
      LEFT JOIN contactos c ON c.id=s.contacto_id LEFT JOIN opciones_menu o ON o.id=s.opcion_id
      WHERE n.usuario_id=$1 AND n.tipo IN ('nueva_solicitud','continuidad','reasignacion','mensaje_recibido','anuncio')
        AND (n.solicitud_id IS NULL OR s.asesor_id=$1)
      ORDER BY (n.leida_en IS NULL) DESC,n.creada_en DESC LIMIT 100`,[req.usuario.id])).rows;
  }
  @Post('anuncios') @HttpCode(200)
  async anunciar(@Req() req:SolicitudAutenticada,@Body() datos:unknown) {
    exigirRol(req.usuario,['administrador']);
    const {texto}=validar(z.object({texto:z.string().trim().min(4).max(1000)}),datos);
    return this.bd.transaccion(async c=>{
      const enviados=await c.query(`INSERT INTO notificaciones(usuario_id,solicitud_id,tipo,texto)
        SELECT id,NULL,'anuncio',$2 FROM usuarios WHERE negocio_id=$1 AND activo`,[req.usuario.negocio_id,texto]);
      await c.query(`INSERT INTO registro_auditoria(negocio_id,usuario_id,entidad,entidad_id,accion,detalle)
        VALUES($1,$2,'anuncio',gen_random_uuid(),'enviado',jsonb_build_object('destinatarios',$3::integer))`,
        [req.usuario.negocio_id,req.usuario.id,enviados.rowCount || 0]);
      return {destinatarios:enviados.rowCount || 0};
    });
  }
  @Post(':id/leer') @HttpCode(200)
  async leer(@Req() req:SolicitudAutenticada,@Param('id') id:string) {
    validar(uuid,id);
    await this.bd.consulta('UPDATE notificaciones SET leida_en=COALESCE(leida_en,now()) WHERE id=$1 AND usuario_id=$2',[id,req.usuario.id]);
    return {ok:true};
  }
  @Get('eventos')
  async eventos(@Req() req:SolicitudAutenticada,@Res() res:Response) {
    if(!this.vivo.activo)return res.status(503).json({message:'Actualización en vivo reconectando'});
    const equipos=req.usuario.rol==='asesor'?[]:(await this.bd.consulta<{equipo_id:string}>(
      'SELECT equipo_id FROM miembros_equipo WHERE usuario_id=$1 AND activo',[req.usuario.id])).rows.map(x=>x.equipo_id);
    this.vivo.suscribir(req.usuario.id,equipos,res,req.sesion_expira_en);
  }
}
