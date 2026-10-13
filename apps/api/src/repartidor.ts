import { Injectable } from '@nestjs/common';
import { randomInt, randomBytes } from 'node:crypto';
import { PoolClient } from 'pg';
import { Bd } from './bd';
import { interpretarOpcion, Opcion, textoMenu } from './menu';

interface Negocio { id:string; zona_horaria:string; dias_atencion:number[]|null; hora_inicio:string|null; hora_fin:string|null; mensaje_menu:string; mensaje_confirmacion:string; mensaje_fuera_horario:string; mensaje_sin_asesor:string; }
interface SolicitudAbierta { id:string; asesor_id:string|null; opcion_id:string|null; creada_en:Date; en_ventana:boolean; }
interface Mensaje { id:string; telefono?:string|null; metaUserId?:string|null; username?:string|null; nombre?:string; tipo:string; texto:string; identificador?:string; metaTimestamp?:string; }
export interface FormularioWeb { origen_tipo:'postulacion'|'contacto'; origen_id:number; creada_en:Date;
  nombre:string;correo:string;telefono:string|null;idioma:'es'|'en';medio_contacto:string|null;
  estudiante:string|null;edad_estudiante:number|null;grado:string|null;asunto:string|null;mensaje:string|null; }

@Injectable()
export class Repartidor {
  constructor(private readonly bd:Bd) {}
  private async negocio(c:PoolClient,id:string):Promise<Negocio> {
    const r=await c.query<Negocio>('SELECT * FROM negocios WHERE id=$1 AND activo=true',[id]);
    if (!r.rowCount) throw new Error('Negocio no encontrado');
    return r.rows[0];
  }
  private async jornada(c:PoolClient,equipoId:string,zona:string):Promise<string> {
    const r=await c.query<{id:string}>(`INSERT INTO jornadas(equipo_id,fecha_local) VALUES($1,(now() AT TIME ZONE $2)::date)
      ON CONFLICT(equipo_id,fecha_local) DO UPDATE SET fecha_local=EXCLUDED.fecha_local RETURNING id`,[equipoId,zona]);
    return r.rows[0].id;
  }
  private enHorario(negocio:Negocio):boolean {
    if (!negocio.dias_atencion || !negocio.hora_inicio || !negocio.hora_fin) return true;
    const partes=new Intl.DateTimeFormat('en-US',{timeZone:negocio.zona_horaria,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
    const dia=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(partes.find(p=>p.type==='weekday')?.value || '')+1;
    const hora=`${partes.find(p=>p.type==='hour')?.value}:${partes.find(p=>p.type==='minute')?.value}`;
    return negocio.dias_atencion.includes(dia) && hora>=negocio.hora_inicio.slice(0,5) && hora<negocio.hora_fin.slice(0,5);
  }
  private async elegibles(c:PoolClient,equipoId:string,jornadaId:string,horario:boolean):Promise<{id:string;contador_ajustado:number;elegible_anterior:boolean}[]> {
    const base=await c.query<{id:string}>(`SELECT u.id FROM usuarios u JOIN miembros_equipo m ON m.usuario_id=u.id
      WHERE m.equipo_id=$1 AND u.rol='asesor' AND u.activo AND m.activo`,[equipoId]);
    for (const u of base.rows) await c.query(`INSERT INTO contadores_jornada(jornada_id,usuario_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[jornadaId,u.id]);
    const r=await c.query<{id:string;contador_ajustado:number;elegible_anterior:boolean}>(`SELECT u.id,cj.contador_ajustado,cj.elegible_anterior
      FROM usuarios u JOIN miembros_equipo m ON m.usuario_id=u.id
      JOIN contadores_jornada cj ON cj.usuario_id=u.id AND cj.jornada_id=$2
      WHERE m.equipo_id=$1 AND u.rol='asesor' AND u.activo AND m.activo
      AND u.disponible AND u.presencia_en>now()-interval '2 minutes' ORDER BY u.id`,[equipoId,jornadaId]);
    const participantes=horario?r.rows:[];
    const actuales=participantes.filter(x=>x.elegible_anterior);
    const minimo=actuales.length?Math.min(...actuales.map(x=>x.contador_ajustado)):0;
    await c.query(`UPDATE contadores_jornada SET elegible_anterior=false WHERE jornada_id=$1`,[jornadaId]);
    for (const u of participantes) {
      const ajuste=u.elegible_anterior?0:Math.max(0,minimo-u.contador_ajustado);
      await c.query(`UPDATE contadores_jornada SET contador_ajustado=contador_ajustado+$3,
        ajustes_nivelacion=ajustes_nivelacion+$3,elegible_anterior=true WHERE jornada_id=$1 AND usuario_id=$2`,[jornadaId,u.id,ajuste]);
      u.contador_ajustado+=ajuste;
    }
    return participantes;
  }
  private async asignar(c:PoolClient,solicitudId:string,asesorId:string,jornadaId:string,motivo:'reparto'|'continuidad'|'manual',anterior:string|null=null,actor:string|null=null) {
    await c.query(`INSERT INTO contadores_jornada(jornada_id,usuario_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[jornadaId,asesorId]);
    await c.query(`UPDATE solicitudes SET asesor_id=$2,estado='pendiente',asignada_en=now() WHERE id=$1`,[solicitudId,asesorId]);
    await c.query(`INSERT INTO historial_asignaciones(solicitud_id,asesor_anterior_id,asesor_nuevo_id,usuario_actor_id,motivo,jornada_id)
      VALUES($1,$2,$3,$4,$5,$6)`,[solicitudId,anterior,asesorId,actor,motivo,jornadaId]);
    if (motivo!=='manual') await c.query(`UPDATE contadores_jornada SET solicitudes_reales=solicitudes_reales+1,
      contador_ajustado=contador_ajustado+1,asignaciones_continuidad=asignaciones_continuidad+$3,
      asignaciones_reparto=asignaciones_reparto+$4 WHERE jornada_id=$1 AND usuario_id=$2`,
      [jornadaId,asesorId,motivo==='continuidad'?1:0,motivo==='reparto'?1:0]);
    await c.query(`INSERT INTO notificaciones(usuario_id,solicitud_id,tipo,texto)
      VALUES($1,$2,$3,$4)`,[asesorId,solicitudId,motivo==='continuidad'?'continuidad':'nueva_solicitud','Tienes una nueva solicitud asignada.']);
  }
  private async asignarWeb(c:PoolClient,solicitudId:string,asesorId:string,jornadaId:string) {
    await c.query(`UPDATE solicitudes_web SET asesor_id=$2,estado='pendiente',asignada_en=now() WHERE id=$1`,[solicitudId,asesorId]);
    await c.query(`UPDATE contadores_jornada SET solicitudes_reales=solicitudes_reales+1,
      contador_ajustado=contador_ajustado+1,asignaciones_reparto=asignaciones_reparto+1
      WHERE jornada_id=$1 AND usuario_id=$2`,[jornadaId,asesorId]);
    await c.query(`INSERT INTO notificaciones_web(usuario_id,solicitud_id) VALUES($1,$2)
      ON CONFLICT(usuario_id,solicitud_id,tipo) DO NOTHING`,[asesorId,solicitudId]);
    await c.query(`INSERT INTO registro_auditoria(negocio_id,entidad,entidad_id,accion,detalle)
      SELECT negocio_id,'solicitudes_web',id,'asignada',jsonb_build_object('asesor_id',$2::uuid)
      FROM solicitudes_web WHERE id=$1`,[solicitudId,asesorId]);
  }
  private async sortear(c:PoolClient,equipoId:string,jornadaId:string,horario:boolean):Promise<string|null> {
    const todos=await this.elegibles(c,equipoId,jornadaId,horario);
    if (!todos.length) return null;
    const minimo=Math.min(...todos.map(x=>x.contador_ajustado));
    const empatados=todos.filter(x=>x.contador_ajustado===minimo);
    return empatados[randomInt(empatados.length)].id;
  }
  private async salida(c:PoolClient,negocioId:string,contactoId:string,texto:string,solicitudId:string|null=null) {
    await c.query(`INSERT INTO mensajes_salientes(negocio_id,contacto_id,solicitud_id,texto) VALUES($1,$2,$3,$4)`,[negocioId,contactoId,solicitudId,texto]);
  }
  private async confirmar(c:PoolClient,negocio:Negocio,contactoId:string,solicitudId:string) {
    const pendiente=await c.query(`UPDATE solicitudes SET confirmacion_en=now()
      WHERE id=$1 AND confirmacion_en IS NULL RETURNING id`,[solicitudId]);
    if(pendiente.rowCount)await this.salida(c,negocio.id,contactoId,negocio.mensaje_confirmacion,solicitudId);
  }
  private async avisarMensaje(c:PoolClient,solicitudId:string,asesorId:string) {
    await c.query(`INSERT INTO notificaciones(usuario_id,solicitud_id,tipo,texto)
      SELECT $1,$2,'mensaje_recibido','El contacto envió un nuevo mensaje al número oficial.'
      WHERE NOT EXISTS (
        SELECT 1 FROM notificaciones WHERE usuario_id=$1 AND solicitud_id=$2
          AND tipo IN ('nueva_solicitud','continuidad','reasignacion') AND leida_en IS NULL
      )
      ON CONFLICT (usuario_id,solicitud_id) WHERE tipo='mensaje_recibido'
      DO UPDATE SET leida_en=NULL,creada_en=EXCLUDED.creada_en
      WHERE notificaciones.leida_en IS NOT NULL`,[asesorId,solicitudId]);
  }
  async procesarMensaje(c:PoolClient,negocioId:string,m:Mensaje):Promise<void> {
    const negocio=await this.negocio(c,negocioId);
    const equipo=(await c.query<{id:string}>(`SELECT id FROM equipos WHERE negocio_id=$1 AND activo=true ORDER BY creado_en LIMIT 1 FOR UPDATE`,[negocioId])).rows[0];
    if (!equipo) throw new Error('Equipo no configurado');
    await this.pendientesEnBloqueo(c,{id:equipo.id,negocio_id:negocioId});
    const digitos=m.telefono?.replace(/\D/g,'') || '';
    const telefono=/^[1-9][0-9]{6,14}$/.test(digitos)?`+${digitos}`:null;
    const metaUserId=m.metaUserId?.trim() || null;
    if (!telefono && !metaUserId) throw new Error('Mensaje sin identificador de contacto');
    if (metaUserId && (metaUserId.length>160 || /[\s\x00-\x1f]/.test(metaUserId))) throw new Error('Identificador Meta inválido');
    const username=m.username?.trim().replace(/^@/,'').slice(0,80) || null;
    const segundos=m.metaTimestamp && /^\d{10}$/.test(m.metaTimestamp)?Number(m.metaTimestamp):NaN;
    const instante=Number.isFinite(segundos) && segundos*1000<=Date.now()
      ? new Date(segundos*1000) : new Date();
    const encontrados=await c.query<{id:string;telefono:string|null;meta_user_id:string|null}>(`SELECT id,telefono,meta_user_id FROM contactos
      WHERE negocio_id=$1 AND (($2::text IS NOT NULL AND meta_user_id=$2) OR ($3::text IS NOT NULL AND telefono=$3))
      FOR UPDATE`,[negocioId,metaUserId,telefono]);
    if (encontrados.rows.length>1) throw new Error('Identificadores Meta vinculados a contactos distintos');
    const contacto=encontrados.rows[0]
      ? (await c.query<{id:string}>(`UPDATE contactos SET telefono=COALESCE(telefono,$2),
          meta_user_id=COALESCE(meta_user_id,$3),nombre_whatsapp=COALESCE($4,nombre_whatsapp),
          username_whatsapp=COALESCE($5,username_whatsapp),ultima_interaccion_en=GREATEST(ultima_interaccion_en,$6)
          WHERE id=$1 RETURNING id`,[encontrados.rows[0].id,telefono,metaUserId,m.nombre || null,username,instante])).rows[0]
      : (await c.query<{id:string}>(`INSERT INTO contactos(negocio_id,telefono,meta_user_id,nombre_whatsapp,username_whatsapp,ultima_interaccion_en)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[negocioId,telefono,metaUserId,m.nombre || null,username,instante])).rows[0];
    const insertado=await c.query<{id:string}>(`INSERT INTO interacciones_entrantes(meta_mensaje_id,negocio_id,contacto_id,tipo,texto)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(meta_mensaje_id) DO NOTHING RETURNING id`,[m.id,negocioId,contacto.id,m.tipo,m.texto.slice(0,4000)]);
    if (!insertado.rowCount) return;
    const opciones=(await c.query<Opcion>(`SELECT id,numero,identificador,nombre,equipo_id FROM opciones_menu
      WHERE equipo_id=$1 AND activo=true ORDER BY numero`,[equipo.id])).rows;
    const opcion=interpretarOpcion(m.texto,opciones,m.identificador);
    const abiertas=(await c.query<SolicitudAbierta>(`SELECT id,asesor_id,opcion_id,creada_en,
      creada_en>=now()-interval '60 seconds' AS en_ventana FROM solicitudes
      WHERE contacto_id=$1 AND equipo_id=$2 AND estado<>'cerrada' ORDER BY creada_en DESC FOR UPDATE`,[contacto.id,equipo.id])).rows;
    const reciente=abiertas[0];
    const general=abiertas.find(s=>s.opcion_id===null);
    const repetida=opcion?abiertas.find(s=>s.opcion_id===opcion.id):undefined;
    const reutilizada=reciente?.en_ventana?reciente:opcion?(general || repetida):reciente;
    if (reutilizada) {
      if (opcion && reutilizada.opcion_id===null) {
        await c.query('UPDATE solicitudes SET opcion_id=$2 WHERE id=$1 AND opcion_id IS NULL',[reutilizada.id,opcion.id]);
        if(reutilizada.asesor_id && this.enHorario(negocio))await this.confirmar(c,negocio,contacto.id,reutilizada.id);
      }
      await c.query('UPDATE interacciones_entrantes SET solicitud_id=$2 WHERE id=$1',[insertado.rows[0].id,reutilizada.id]);
      if(reutilizada.asesor_id)await this.avisarMensaje(c,reutilizada.id,reutilizada.asesor_id);
      return;
    }
    const responsable=abiertas.find(s=>s.asesor_id)?.asesor_id || null;
    const codigo=`VAL-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const solicitudId=(await c.query<{id:string}>(`INSERT INTO solicitudes(codigo,negocio_id,equipo_id,contacto_id,opcion_id,estado)
      VALUES($1,$2,$3,$4,$5,'pendiente_asignacion') RETURNING id`,[codigo,negocioId,equipo.id,contacto.id,opcion?.id || null])).rows[0].id;
    await c.query('UPDATE interacciones_entrantes SET solicitud_id=$2 WHERE id=$1',[insertado.rows[0].id,solicitudId]);
    const jornadaId=await this.jornada(c,equipo.id,negocio.zona_horaria);
    const horario=this.enHorario(negocio);
    let asignada=false;
    if (responsable) {
      await this.elegibles(c,equipo.id,jornadaId,horario);
      await this.asignar(c,solicitudId,responsable,jornadaId,'continuidad');
      asignada=true;
    } else if (!abiertas.length) {
      const ganador=await this.sortear(c,equipo.id,jornadaId,horario);
      if (ganador) {await this.asignar(c,solicitudId,ganador,jornadaId,'reparto');asignada=true;}
    }
    await c.query(`INSERT INTO registro_auditoria(negocio_id,entidad,entidad_id,accion)
      VALUES($1,'solicitudes',$2,'creada')`,[negocioId,solicitudId]);
    if(!horario)await this.salida(c,negocioId,contacto.id,negocio.mensaje_fuera_horario,solicitudId);
    else if(!asignada)await this.salida(c,negocioId,contacto.id,negocio.mensaje_sin_asesor,solicitudId);
    else if(opcion)await this.confirmar(c,negocio,contacto.id,solicitudId);
    else await this.salida(c,negocioId,contacto.id,textoMenu(negocio.mensaje_menu,opciones),solicitudId);
  }
  private async pendientesEnBloqueo(c:PoolClient,equipo:{id:string;negocio_id:string}):Promise<number> {
      const negocio=await this.negocio(c,equipo.negocio_id);
      const jornadaId=await this.jornada(c,equipo.id,negocio.zona_horaria);
      let asignadas=0;
      const whatsapp=(await c.query<{id:string;contacto_id:string;creada_en:Date}>(`SELECT id,contacto_id,creada_en
        FROM solicitudes WHERE equipo_id=$1 AND estado='pendiente_asignacion'
        ORDER BY creada_en,id FOR UPDATE`,[equipo.id])).rows.map(x=>({...x,origen:'whatsapp' as const}));
      const web=(await c.query<{id:string;creada_en:Date}>(`SELECT id,creada_en FROM solicitudes_web
        WHERE equipo_id=$1 AND estado='pendiente_asignacion' ORDER BY creada_en,id FOR UPDATE`,[equipo.id]))
        .rows.map(x=>({...x,origen:'web' as const}));
      const pendientes=[...whatsapp,...web].sort((a,b)=>
        new Date(a.creada_en).getTime()-new Date(b.creada_en).getTime() || a.id.localeCompare(b.id));
      for (const pendiente of pendientes) {
        if(pendiente.origen==='web'){
          const asesor=await this.sortear(c,equipo.id,jornadaId,this.enHorario(negocio));
          if(!asesor)break;
          await this.asignarWeb(c,pendiente.id,asesor,jornadaId);
        }else{
          const continuidad=(await c.query<{asesor_id:string}>(`SELECT asesor_id FROM solicitudes WHERE contacto_id=$1 AND equipo_id=$2
            AND estado<>'cerrada' AND asesor_id IS NOT NULL ORDER BY creada_en LIMIT 1`,[pendiente.contacto_id,equipo.id])).rows[0]?.asesor_id;
          const asesor=continuidad || await this.sortear(c,equipo.id,jornadaId,this.enHorario(negocio));
          if (!asesor) break;
          await this.asignar(c,pendiente.id,asesor,jornadaId,continuidad?'continuidad':'reparto');
        }
        asignadas++;
      }
      return asignadas;
  }
  async asignarPendientes(equipoId:string):Promise<number> {
    return this.bd.transaccion(async c=>{
      const equipo=(await c.query<{id:string;negocio_id:string}>(`SELECT id,negocio_id FROM equipos WHERE id=$1 FOR UPDATE`,[equipoId])).rows[0];
      return equipo?this.pendientesEnBloqueo(c,equipo):0;
    });
  }
  async registrarWeb(negocioId:string,formulario:FormularioWeb):Promise<{id:string;duplicado:boolean}> {
    return this.bd.transaccion(async c=>{
      const equipo=(await c.query<{id:string;negocio_id:string}>(`SELECT id,negocio_id FROM equipos
        WHERE negocio_id=$1 AND activo=true ORDER BY creado_en LIMIT 1 FOR UPDATE`,[negocioId])).rows[0];
      if(!equipo)throw new Error('Equipo no configurado');
      const existente=(await c.query<{id:string}>(`SELECT id FROM solicitudes_web
        WHERE origen_tipo=$1 AND origen_id=$2`,[formulario.origen_tipo,formulario.origen_id])).rows[0];
      if(existente)return {id:existente.id,duplicado:true};
      await this.pendientesEnBloqueo(c,equipo);
      const creada=(await c.query<{id:string}>(`INSERT INTO solicitudes_web
        (negocio_id,equipo_id,origen_tipo,origen_id,nombre,correo,telefono,idioma,medio_contacto,
         estudiante,edad_estudiante,grado,asunto,mensaje,creada_en)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT(origen_tipo,origen_id) DO NOTHING RETURNING id`,[
          equipo.negocio_id,equipo.id,formulario.origen_tipo,formulario.origen_id,formulario.nombre,
          formulario.correo,formulario.telefono,formulario.idioma,formulario.medio_contacto,
          formulario.estudiante,formulario.edad_estudiante,formulario.grado,formulario.asunto,
          formulario.mensaje,formulario.creada_en
        ])).rows[0];
      if(!creada){
        const repetida=(await c.query<{id:string}>(`SELECT id FROM solicitudes_web
          WHERE origen_tipo=$1 AND origen_id=$2`,[formulario.origen_tipo,formulario.origen_id])).rows[0];
        return {id:repetida.id,duplicado:true};
      }
      const negocio=await this.negocio(c,equipo.negocio_id);
      const jornadaId=await this.jornada(c,equipo.id,negocio.zona_horaria);
      const ganador=await this.sortear(c,equipo.id,jornadaId,this.enHorario(negocio));
      if(ganador)await this.asignarWeb(c,creada.id,ganador,jornadaId);
      await c.query(`INSERT INTO registro_auditoria(negocio_id,entidad,entidad_id,accion,detalle)
        VALUES($1,'solicitudes_web',$2,'creada',jsonb_build_object('origen',$3::text))`,
        [equipo.negocio_id,creada.id,formulario.origen_tipo]);
      return {id:creada.id,duplicado:false};
    });
  }
  async actualizarPresencia(usuarioId:string,disponible?:boolean):Promise<void> {
    const previo=(await this.bd.consulta<{disponible:boolean;presencia_en:Date|null}>(
      'SELECT disponible,presencia_en FROM usuarios WHERE id=$1',[usuarioId])).rows[0];
    if(!previo)return;
    const cambioManual=disponible!==undefined && disponible!==previo.disponible;
    const regreso=(disponible??previo.disponible) && (!previo.presencia_en || Date.now()-new Date(previo.presencia_en).getTime()>120000);
    if(!cambioManual && !regreso){
      await this.bd.consulta('UPDATE usuarios SET presencia_en=now() WHERE id=$1',[usuarioId]);
      return;
    }
    const equipos=(await this.bd.consulta<{equipo_id:string}>(`SELECT equipo_id FROM miembros_equipo WHERE usuario_id=$1 AND activo ORDER BY equipo_id`,[usuarioId])).rows;
    await this.bd.transaccion(async c=>{
      const bloqueados=[] as {id:string;negocio_id:string}[];
      for(const e of equipos){const equipo=(await c.query<{id:string;negocio_id:string}>(`SELECT id,negocio_id FROM equipos WHERE id=$1 FOR UPDATE`,[e.equipo_id])).rows[0];if(equipo)bloqueados.push(equipo);}
      await c.query(`UPDATE usuarios SET presencia_en=now(),disponible=COALESCE($2,disponible) WHERE id=$1`,[usuarioId,disponible??null]);
      for(const equipo of bloqueados)await this.pendientesEnBloqueo(c,equipo);
    });
  }
}
