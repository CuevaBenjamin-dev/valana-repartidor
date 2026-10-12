import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { Bd }=require('../apps/api/dist/bd.js');
const { Repartidor }=require('../apps/api/dist/repartidor.js');
const bd=new Bd(),repartidor=new Repartidor(bd);
const marcador='/app/.local/persistencia-prueba.json';
const etapa=process.argv[2];
if(!['preparar','verificar'].includes(etapa))throw new Error('Indique preparar o verificar');
try {
  if(etapa==='preparar') {
    const sufijo=randomUUID().slice(0,8);
    const negocioId=(await bd.consulta(`INSERT INTO negocios(nombre,meta_phone_number_id) VALUES('Prueba de persistencia',$1) RETURNING id`,[`prueba-persistencia-${sufijo}`])).rows[0].id;
    const equipoId=(await bd.consulta(`INSERT INTO equipos(negocio_id,nombre) VALUES($1,'Equipo de persistencia') RETURNING id`,[negocioId])).rows[0].id;
    await bd.consulta(`INSERT INTO opciones_menu(negocio_id,equipo_id,numero,identificador,nombre) VALUES($1,$2,1,'admisiones','Admisiones')`,[negocioId,equipoId]);
    const asesorId=(await bd.consulta(`INSERT INTO usuarios(negocio_id,nombre,correo,clave_hash,rol,disponible,presencia_en)
      VALUES($1,'Asesor de persistencia',$2,'prueba','asesor',true,now()) RETURNING id`,[negocioId,`persistencia-${sufijo}@local`])).rows[0].id;
    await bd.consulta('INSERT INTO miembros_equipo(equipo_id,usuario_id) VALUES($1,$2)',[equipoId,asesorId]);
    await bd.transaccion(c=>repartidor.procesarMensaje(c,negocioId,{id:`persistencia-${sufijo}`,telefono:'51900000001',tipo:'text',texto:'1'}));
    const solicitud=(await bd.consulta('SELECT id FROM solicitudes WHERE negocio_id=$1',[negocioId])).rows[0];
    assert.ok(solicitud);
    await bd.consulta(`INSERT INTO notas_solicitud(solicitud_id,autor_id,texto) VALUES($1,$2,'Nota de comprobación de persistencia')`,[solicitud.id,asesorId]);
    writeFileSync(marcador,JSON.stringify({negocioId,equipoId,asesorId,solicitudId:solicitud.id}));
    console.log('Datos sintéticos de persistencia preparados. Reinicie PostgreSQL y API; después ejecute verificar.');
  } else {
    const {negocioId,equipoId,asesorId,solicitudId}=JSON.parse(readFileSync(marcador,'utf8'));
    const r=await bd.consulta(`SELECT s.id,s.estado,s.asesor_id,c.telefono,n.texto,cj.solicitudes_reales,cj.contador_ajustado
      FROM solicitudes s JOIN contactos c ON c.id=s.contacto_id
      JOIN notas_solicitud n ON n.solicitud_id=s.id JOIN jornadas j ON j.equipo_id=s.equipo_id
      JOIN contadores_jornada cj ON cj.jornada_id=j.id AND cj.usuario_id=s.asesor_id
      WHERE s.id=$1 AND s.negocio_id=$2`,[solicitudId,negocioId]);
    assert.equal(r.rowCount,1);assert.equal(r.rows[0].asesor_id,asesorId);
    assert.equal(r.rows[0].estado,'pendiente');assert.equal(r.rows[0].telefono,'+51900000001');
    assert.equal(r.rows[0].texto,'Nota de comprobación de persistencia');
    assert.equal(r.rows[0].solicitudes_reales,1);assert.equal(r.rows[0].contador_ajustado,1);
    await bd.transaccion(async c=>{
      for(const tabla of ['notificaciones','historial_asignaciones','notas_solicitud'])await c.query(`DELETE FROM ${tabla} WHERE solicitud_id=$1`,[solicitudId]);
      await c.query('DELETE FROM interacciones_entrantes WHERE negocio_id=$1',[negocioId]);
      await c.query('DELETE FROM mensajes_salientes WHERE negocio_id=$1',[negocioId]);
      await c.query('DELETE FROM registro_auditoria WHERE negocio_id=$1',[negocioId]);
      await c.query('DELETE FROM solicitudes WHERE negocio_id=$1',[negocioId]);
      await c.query('DELETE FROM contadores_jornada WHERE usuario_id=$1',[asesorId]);
      await c.query('DELETE FROM jornadas WHERE equipo_id=$1',[equipoId]);
      await c.query('DELETE FROM contactos WHERE negocio_id=$1',[negocioId]);
      await c.query('DELETE FROM opciones_menu WHERE negocio_id=$1',[negocioId]);
      await c.query('DELETE FROM miembros_equipo WHERE equipo_id=$1',[equipoId]);
      await c.query('DELETE FROM usuarios WHERE negocio_id=$1',[negocioId]);
      await c.query('DELETE FROM equipos WHERE id=$1',[equipoId]);
      await c.query('DELETE FROM negocios WHERE id=$1',[negocioId]);
    });
    unlinkSync(marcador);
    console.log('Persistencia aprobada: usuario, contacto, solicitud, nota, jornada y contadores sobrevivieron al reinicio. Datos de prueba eliminados.');
  }
} finally {await bd.onModuleDestroy();}
