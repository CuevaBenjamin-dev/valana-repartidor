import { BadRequestException, Controller, Get, Post, Patch, Param, Body, Req, UseGuards, NotFoundException, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { Bd } from './bd';
import { SesionesGuard, SolicitudAutenticada, exigirRol } from './auth';
const uuid=z.string().uuid();
function parsear<T>(esquema:z.ZodType<T>,valor:unknown):T {const r=esquema.safeParse(valor);if(!r.success)throw new BadRequestException(r.error.flatten());return r.data;}

@Controller('supervision') @UseGuards(SesionesGuard)
export class SupervisionController {
  constructor(private readonly bd:Bd) {}
  @Get('resumen')
  async resumen(@Req() req:SolicitudAutenticada) {
    exigirRol(req.usuario,['supervisor','administrador']);
    const [estados,asesores,contadores,asignaciones,auditoria]=await Promise.all([
      this.bd.consulta(`SELECT s.estado,COUNT(*)::int AS total FROM solicitudes s JOIN miembros_equipo me ON me.equipo_id=s.equipo_id AND me.usuario_id=$1 AND me.activo
        WHERE s.negocio_id=$2 GROUP BY s.estado`,[req.usuario.id,req.usuario.negocio_id]),
      this.bd.consulta(`SELECT u.id,u.nombre,u.correo,u.activo,u.disponible,u.presencia_en,
        (u.disponible AND u.presencia_en>now()-interval '2 minutes' AND u.activo) AS elegible
        FROM usuarios u JOIN miembros_equipo me ON me.usuario_id=u.id AND me.activo
        WHERE me.equipo_id IN(SELECT equipo_id FROM miembros_equipo WHERE usuario_id=$1 AND activo) AND u.rol='asesor' ORDER BY u.nombre`,[req.usuario.id]),
      this.bd.consulta(`SELECT u.nombre,j.fecha_local,c.solicitudes_reales,c.contador_ajustado,c.ajustes_nivelacion,
        c.asignaciones_continuidad,c.asignaciones_reparto
        FROM contadores_jornada c JOIN usuarios u ON u.id=c.usuario_id JOIN jornadas j ON j.id=c.jornada_id
        WHERE j.equipo_id IN(SELECT equipo_id FROM miembros_equipo WHERE usuario_id=$1 AND activo)
        AND j.fecha_local=(now() AT TIME ZONE 'America/Lima')::date ORDER BY u.nombre`,[req.usuario.id]),
      this.bd.consulta(`SELECT h.creada_en,h.motivo,s.codigo,u.nombre AS asesor,a.nombre AS asesor_anterior
        FROM historial_asignaciones h JOIN solicitudes s ON s.id=h.solicitud_id
        JOIN usuarios u ON u.id=h.asesor_nuevo_id LEFT JOIN usuarios a ON a.id=h.asesor_anterior_id
        WHERE s.equipo_id IN(SELECT equipo_id FROM miembros_equipo WHERE usuario_id=$1 AND activo)
        ORDER BY h.creada_en DESC LIMIT 30`,[req.usuario.id]),
      this.bd.consulta(`SELECT accion,entidad,creada_en FROM registro_auditoria WHERE negocio_id=$1 ORDER BY creada_en DESC LIMIT 30`,[req.usuario.negocio_id])
    ]);
    return {estados:estados.rows,asesores:asesores.rows,contadores:contadores.rows,asignaciones:asignaciones.rows,auditoria:auditoria.rows};
  }
  @Post('reasignar') @HttpCode(200)
  async reasignar(@Req() req:SolicitudAutenticada,@Body() datos:unknown) {
    exigirRol(req.usuario,['supervisor','administrador']);
    const {solicitud_id,asesor_id,motivo}=parsear(z.object({solicitud_id:uuid,asesor_id:uuid,motivo:z.string().trim().min(8).max(500)}),datos);
    return this.bd.transaccion(async c=>{
      const s=(await c.query<{contacto_id:string;equipo_id:string;negocio_id:string}>(`SELECT s.contacto_id,s.equipo_id,s.negocio_id FROM solicitudes s
        JOIN miembros_equipo m ON m.equipo_id=s.equipo_id AND m.usuario_id=$2 AND m.activo
        WHERE s.id=$1 AND s.negocio_id=$3`,[solicitud_id,req.usuario.id,req.usuario.negocio_id])).rows[0];
      if(!s)throw new NotFoundException();
      await c.query('SELECT id FROM equipos WHERE id=$1 FOR UPDATE',[s.equipo_id]);
      await c.query('SELECT id FROM contactos WHERE id=$1 FOR UPDATE',[s.contacto_id]);
      const destino=await c.query(`SELECT 1 FROM usuarios u JOIN miembros_equipo m ON m.usuario_id=u.id
        WHERE u.id=$1 AND m.equipo_id=$2 AND u.rol='asesor' AND u.activo AND m.activo`,[asesor_id,s.equipo_id]);
      if(!destino.rowCount)throw new BadRequestException('Asesor no elegible para el equipo');
      const abiertas=(await c.query<{id:string;asesor_id:string|null}>(`SELECT id,asesor_id FROM solicitudes
        WHERE contacto_id=$1 AND equipo_id=$2 AND estado<>'cerrada' ORDER BY creada_en FOR UPDATE`,[s.contacto_id,s.equipo_id])).rows;
      for(const abierta of abiertas) {
        if(abierta.asesor_id===asesor_id)continue;
        await c.query(`UPDATE solicitudes SET asesor_id=$2,estado=CASE WHEN estado='pendiente_asignacion' THEN 'pendiente' ELSE estado END,
          asignada_en=COALESCE(asignada_en,now()) WHERE id=$1`,[abierta.id,asesor_id]);
        await c.query(`INSERT INTO historial_asignaciones(solicitud_id,asesor_anterior_id,asesor_nuevo_id,usuario_actor_id,motivo)
          VALUES($1,$2,$3,$4,'manual')`,[abierta.id,abierta.asesor_id,asesor_id,req.usuario.id]);
        await c.query(`INSERT INTO registro_auditoria(negocio_id,usuario_id,entidad,entidad_id,accion,detalle)
          VALUES($1,$2,'solicitudes',$3,'reasignacion_manual',$4)`,[s.negocio_id,req.usuario.id,abierta.id,JSON.stringify({motivo,asesor_anterior_id:abierta.asesor_id,asesor_nuevo_id:asesor_id})]);
        await c.query(`INSERT INTO notificaciones(usuario_id,solicitud_id,tipo,texto)
          VALUES($1,$2,'reasignacion','Se te reasignó una solicitud.')`,[asesor_id,abierta.id]);
      }
      return {reasignadas:abiertas.filter(a=>a.asesor_id!==asesor_id).length};
    });
  }
}

@Controller('configuracion') @UseGuards(SesionesGuard)
export class ConfiguracionController {
  constructor(private readonly bd:Bd) {}
  @Get()
  async obtener(@Req() req:SolicitudAutenticada) {
    exigirRol(req.usuario,['administrador']);
    const [negocio,equipos,opciones,usuarios]=await Promise.all([
      this.bd.consulta(`SELECT id,nombre,zona_horaria,dias_atencion,hora_inicio,hora_fin,mensaje_menu,
        mensaje_confirmacion,mensaje_fuera_horario,mensaje_sin_asesor FROM negocios WHERE id=$1`,[req.usuario.negocio_id]),
      this.bd.consulta('SELECT id,nombre,activo FROM equipos WHERE negocio_id=$1 ORDER BY nombre',[req.usuario.negocio_id]),
      this.bd.consulta('SELECT id,equipo_id,numero,identificador,nombre,activo FROM opciones_menu WHERE negocio_id=$1 ORDER BY numero',[req.usuario.negocio_id]),
      this.bd.consulta('SELECT id,nombre,correo,rol,activo FROM usuarios WHERE negocio_id=$1 ORDER BY nombre',[req.usuario.negocio_id])
    ]);
    return {negocio:negocio.rows[0],equipos:equipos.rows,opciones:opciones.rows,usuarios:usuarios.rows};
  }
  @Patch('negocio')
  async negocio(@Req() req:SolicitudAutenticada,@Body() datos:unknown) {
    exigirRol(req.usuario,['administrador']);
    const d=parsear(z.object({dias_atencion:z.array(z.number().int().min(1).max(7)).nullable(),hora_inicio:z.string().regex(/^\d\d:\d\d$/).nullable(),hora_fin:z.string().regex(/^\d\d:\d\d$/).nullable(),mensaje_menu:z.string().trim().min(10).max(1000),mensaje_confirmacion:z.string().trim().min(10).max(1000),mensaje_fuera_horario:z.string().trim().min(10).max(1000),mensaje_sin_asesor:z.string().trim().min(10).max(1000)}),datos);
    if((d.hora_inicio && !d.hora_fin)||(!d.hora_inicio && d.hora_fin)||d.hora_inicio && d.hora_fin && d.hora_inicio>=d.hora_fin)throw new BadRequestException('Horario inválido');
    await this.bd.consulta(`UPDATE negocios SET dias_atencion=$2,hora_inicio=$3,hora_fin=$4,mensaje_menu=$5,
      mensaje_confirmacion=$6,mensaje_fuera_horario=$7,mensaje_sin_asesor=$8 WHERE id=$1`,
      [req.usuario.negocio_id,d.dias_atencion,d.hora_inicio,d.hora_fin,d.mensaje_menu,d.mensaje_confirmacion,d.mensaje_fuera_horario,d.mensaje_sin_asesor]);
    return {ok:true};
  }
  @Patch('opciones/:id')
  async opcion(@Req() req:SolicitudAutenticada,@Param('id') id:string,@Body() datos:unknown) {
    exigirRol(req.usuario,['administrador']); parsear(uuid,id);
    const d=parsear(z.object({numero:z.number().int().positive(),nombre:z.string().trim().min(2).max(100),identificador:z.string().regex(/^[a-z0-9_]{2,60}$/),activo:z.boolean()}),datos);
    const r=await this.bd.consulta(`UPDATE opciones_menu SET numero=$3,nombre=$4,identificador=$5,activo=$6
      WHERE id=$1 AND negocio_id=$2 RETURNING id`,[id,req.usuario.negocio_id,d.numero,d.nombre,d.identificador,d.activo]);
    if(!r.rowCount)throw new NotFoundException(); return {ok:true};
  }
  @Post('opciones')
  async crearOpcion(@Req() req:SolicitudAutenticada,@Body() datos:unknown) {
    exigirRol(req.usuario,['administrador']);
    const d=parsear(z.object({equipo_id:uuid,numero:z.number().int().positive(),nombre:z.string().trim().min(2).max(100),identificador:z.string().regex(/^[a-z0-9_]{2,60}$/)}),datos);
    const equipo=await this.bd.consulta('SELECT id FROM equipos WHERE id=$1 AND negocio_id=$2',[d.equipo_id,req.usuario.negocio_id]);
    if(!equipo.rowCount)throw new NotFoundException();
    const r=await this.bd.consulta(`INSERT INTO opciones_menu(negocio_id,equipo_id,numero,nombre,identificador)
      VALUES($1,$2,$3,$4,$5) RETURNING id`,[req.usuario.negocio_id,d.equipo_id,d.numero,d.nombre,d.identificador]);return r.rows[0];
  }
  @Patch('usuarios/:id')
  async usuario(@Req() req:SolicitudAutenticada,@Param('id') id:string,@Body() datos:unknown) {
    exigirRol(req.usuario,['administrador']); parsear(uuid,id);
    const d=parsear(z.object({nombre:z.string().trim().min(2).max(120),activo:z.boolean(),clave:z.string().min(14).max(256).optional()}),datos);
    if(id===req.usuario.id && !d.activo)throw new BadRequestException('No puedes desactivar tu propia cuenta');
    const hash=d.clave?await argon2.hash(d.clave,{type:argon2.argon2id}):null;
    const r=await this.bd.consulta(`UPDATE usuarios SET nombre=$3,activo=$4,clave_hash=COALESCE($5,clave_hash)
      WHERE id=$1 AND negocio_id=$2 RETURNING id`,[id,req.usuario.negocio_id,d.nombre,d.activo,hash]);
    if(!r.rowCount)throw new NotFoundException();return {ok:true};
  }
  @Post('usuarios')
  async crearUsuario(@Req() req:SolicitudAutenticada,@Body() datos:unknown) {
    exigirRol(req.usuario,['administrador']);
    const d=parsear(z.object({nombre:z.string().trim().min(2).max(120),correo:z.email().transform(x=>x.toLowerCase()),rol:z.enum(['asesor','supervisor','administrador']),clave:z.string().min(14).max(256),equipo_id:uuid}),datos);
    const claveHash=await argon2.hash(d.clave,{type:argon2.argon2id});
    return this.bd.transaccion(async c=>{
      const equipo=await c.query('SELECT id FROM equipos WHERE id=$1 AND negocio_id=$2 AND activo FOR UPDATE',[d.equipo_id,req.usuario.negocio_id]);
      if(!equipo.rowCount)throw new NotFoundException('Equipo no encontrado');
      const usuario=(await c.query<{id:string}>(`INSERT INTO usuarios(negocio_id,nombre,correo,clave_hash,rol) VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [req.usuario.negocio_id,d.nombre,d.correo,claveHash,d.rol])).rows[0];
      await c.query('INSERT INTO miembros_equipo(equipo_id,usuario_id) VALUES($1,$2)',[d.equipo_id,usuario.id]);
      await c.query(`INSERT INTO registro_auditoria(negocio_id,usuario_id,entidad,entidad_id,accion)
        VALUES($1,$2,'usuarios',$3,'crear_usuario')`,[req.usuario.negocio_id,req.usuario.id,usuario.id]);
      return {id:usuario.id};
    });
  }
  @Patch('equipos/:id')
  async equipo(@Req() req:SolicitudAutenticada,@Param('id') id:string,@Body() datos:unknown) {
    exigirRol(req.usuario,['administrador']);parsear(uuid,id);
    const d=parsear(z.object({nombre:z.string().trim().min(2).max(120),activo:z.boolean()}),datos);
    const r=await this.bd.consulta(`UPDATE equipos SET nombre=$3,activo=$4 WHERE id=$1 AND negocio_id=$2 RETURNING id`,[id,req.usuario.negocio_id,d.nombre,d.activo]);
    if(!r.rowCount)throw new NotFoundException();return {ok:true};
  }
}
