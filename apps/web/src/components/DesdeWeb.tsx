'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Inbox, Search, Send } from 'lucide-react';

export type SolicitudWeb={id:string;codigo:string;origen_tipo:'postulacion'|'contacto';origen_id:number;
  nombre:string;correo:string;telefono:string|null;estudiante:string|null;asunto:string|null;estado:string;creada_en:string;
  asignada_en:string|null;asesor:string|null;nueva:boolean};
type DetalleWeb={solicitud:SolicitudWeb & {idioma:string;medio_contacto:string|null;
  nombres_estudiante:string|null;apellido_paterno_estudiante:string|null;apellido_materno_estudiante:string|null;
  institucion_procedencia:string|null;parentesco_apoderado:string|null;
  edad_estudiante:number|null;grado:string|null;mensaje:string|null;cerrada_en:string|null};
  notas:{id:string;texto:string;autor:string;creada_en:string}[]};
type Consultar=<T>(ruta:string,opciones?:RequestInit)=>Promise<T>;
const fecha=(valor:string)=>new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',dateStyle:'medium',timeStyle:'short'}).format(new Date(valor));
const estado=(valor:string)=>({pendiente_asignacion:'Sin asignar',pendiente:'Nuevo',en_atencion:'En atención',cerrada:'Cerrada'} as Record<string,string>)[valor]||valor;
const grado=(valor:string|null)=>valor?.replace('_',' ').replace(/^./,c=>c.toUpperCase())||'—';

export default function DesdeWeb({solicitudes,consultar,onActualizar,abrirId,rol}:{solicitudes:SolicitudWeb[];
  consultar:Consultar;onActualizar:()=>Promise<unknown>;abrirId:string|null;rol:'asesor'|'administrador'}) {
  const [id,setId]=useState<string|null>(null),[detalle,setDetalle]=useState<DetalleWeb|null>(null);
  const [nota,setNota]=useState(''),[filtro,setFiltro]=useState('todas'),[busqueda,setBusqueda]=useState('');
  const [error,setError]=useState(''),[exito,setExito]=useState(''),[ocupado,setOcupado]=useState(false);
  const revision=useRef(0),lectura=useRef<string|null>(null);
  useEffect(()=>{if(abrirId)setId(abrirId)},[abrirId]);
  useEffect(()=>{
    const actual=++revision.current;
    if(!id){setDetalle(null);return}
    consultar<DetalleWeb>(`/desde-web/${id}`).then(d=>{if(actual===revision.current)setDetalle(d)})
      .catch(e=>{if(actual===revision.current)setError((e as Error).message)});
    return()=>{++revision.current};
  },[id,solicitudes,consultar]);
  useEffect(()=>{
    if(!id || rol!=='asesor' || !solicitudes.some(s=>s.id===id && s.nueva))return;
    const leer=()=>{
      if(document.visibilityState!=='visible' || !document.hasFocus() || lectura.current===id)return;
      lectura.current=id;
      void consultar(`/desde-web/${id}/leer`,{method:'POST',body:'{}'}).then(onActualizar)
        .catch(()=>{if(lectura.current===id)lectura.current=null});
    };
    leer();window.addEventListener('focus',leer);document.addEventListener('visibilitychange',leer);
    return()=>{window.removeEventListener('focus',leer);document.removeEventListener('visibilitychange',leer)};
  },[id,rol,solicitudes,consultar,onActualizar]);
  const lista=useMemo(()=>solicitudes.filter(s=>{
    if(filtro==='nuevo' && !['pendiente','pendiente_asignacion'].includes(s.estado))return false;
    if(!['todas','nuevo'].includes(filtro) && s.estado!==filtro)return false;
    const q=busqueda.toLowerCase();return !q||[s.codigo,s.nombre,s.estudiante||'',s.correo,s.telefono||'',s.asunto||'']
      .some(v=>v.toLowerCase().includes(q));
  }),[solicitudes,filtro,busqueda]);
  const operar=async(ruta:string,mensaje:string,cuerpo='{}')=>{
    if(!id)return;setOcupado(true);setError('');setExito('');
    try{
      await consultar(ruta,{method:'POST',body:cuerpo});
      const d=await consultar<DetalleWeb>(`/desde-web/${id}`);setDetalle(d);
      await onActualizar();setExito(mensaje);return true;
    }catch(e){setError((e as Error).message);return false}finally{setOcupado(false)}
  };
  return <>
    {error&&<div className="notice error">{error}</div>}{exito&&<div className="notice success">{exito}</div>}
    {!id?<>
      <div className="heading"><div><p className="eyebrow">FORMULARIOS DE BOSTON</p><h1>Desde Web</h1>
        <p className="muted">Admisiones y consultas enviadas desde bostonbbs.com.</p></div></div>
      <section className="panel"><div className="panel-head"><div><h2>Solicitudes web</h2><p>{lista.length} resultados</p></div></div>
          <div className="toolbar"><div className="search"><Search size={16}/><input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar por estudiante, apoderado, correo o código"/></div>
          <div className="filters">{[['todas','Todas'],['nuevo','Nuevo'],['en_atencion','En atención'],['cerrada','Cerradas']].map(([clave,texto])=><button key={clave} className={filtro===clave?'selected':''} onClick={()=>setFiltro(clave)}>{texto}</button>)}</div></div>
        {lista.length?<div className="table-wrap"><table><thead><tr><th>Solicitud</th><th>Contacto</th><th>Formulario</th><th>Ingreso</th><th>Estado</th><th>Asesor</th><th></th></tr></thead><tbody>
          {lista.map(s=><tr key={s.id}><td><button className="link-button" onClick={()=>setId(s.id)}>{s.codigo}</button>{s.nueva&&<span style={{color:'#de8c60',marginLeft:8}}>●</span>}</td>
            <td><strong>{s.origen_tipo==='postulacion'?(s.estudiante||s.nombre):s.nombre}</strong>
              <div style={{fontSize:11,color:'#9ba8b5',marginTop:4}}>{s.origen_tipo==='postulacion'?`Apoderado: ${s.nombre} · ${s.correo}`:s.correo}</div></td>
            <td>{s.origen_tipo==='postulacion'?'Admisión':'Contacto'}</td><td>{fecha(s.creada_en)}</td>
            <td><span className={`badge ${s.estado}`}>{estado(s.estado)}</span></td><td>{s.asesor||'—'}</td>
            <td><button className="btn small" onClick={()=>setId(s.id)}>Ver detalle</button></td></tr>)}</tbody></table></div>
          :<div className="empty"><Inbox size={28}/><h3>Sin solicitudes web</h3><p>Los próximos formularios aparecerán aquí.</p></div>}
      </section>
    </>:<>
      <button className="btn text" onClick={()=>{setId(null);setDetalle(null);setError('');setExito('')}} style={{marginBottom:15}}><ArrowLeft size={16}/>Volver a Desde Web</button>
      {!detalle || detalle.solicitud.id!==id?<div className="panel section">Cargando detalle…</div>:<>
        <div className="heading"><div><p className="eyebrow">SOLICITUD DESDE WEB</p><h1>{detalle.solicitud.codigo}</h1>
          <p className="muted">{detalle.solicitud.origen_tipo==='postulacion'?'Admisión':'Contacto'} · ingresó {fecha(detalle.solicitud.creada_en)}</p></div>
          <span className={`badge ${detalle.solicitud.estado}`}>{estado(detalle.solicitud.estado)}</span></div>
        <div className="split"><section className="panel"><div className="panel-head"><h2>Datos recibidos</h2></div><div className="section">
          <div className="field-grid"><div className="field"><small>{detalle.solicitud.origen_tipo==='postulacion'?'APODERADO':'NOMBRE'}</small><strong>{detalle.solicitud.nombre}</strong></div>
            <div className="field"><small>CORREO</small><strong>{detalle.solicitud.correo}</strong></div>
            <div className="field"><small>{detalle.solicitud.origen_tipo==='postulacion'?'CELULAR':'TELÉFONO'}</small><strong>{detalle.solicitud.telefono||'No proporcionado'}</strong></div>
            <div className="field"><small>ASESOR RESPONSABLE</small><strong>{detalle.solicitud.asesor||'Sin asignar'}</strong></div>
            <div className="field"><small>IDIOMA</small><strong>{detalle.solicitud.idioma.toUpperCase()}</strong></div>
            {detalle.solicitud.medio_contacto&&<div className="field"><small>MEDIO PREFERIDO</small><strong>{detalle.solicitud.medio_contacto}</strong></div>}
            {detalle.solicitud.estudiante&&<><div className="field"><small>ESTUDIANTE</small><strong>{detalle.solicitud.estudiante}</strong></div>
              {detalle.solicitud.nombres_estudiante&&<div className="field"><small>NOMBRES DEL ESTUDIANTE</small><strong>{detalle.solicitud.nombres_estudiante}</strong></div>}
              {detalle.solicitud.apellido_paterno_estudiante&&<div className="field"><small>APELLIDO PATERNO</small><strong>{detalle.solicitud.apellido_paterno_estudiante}</strong></div>}
              {detalle.solicitud.apellido_materno_estudiante&&<div className="field"><small>APELLIDO MATERNO</small><strong>{detalle.solicitud.apellido_materno_estudiante}</strong></div>}
              <div className="field"><small>EDAD Y GRADO</small><strong>{detalle.solicitud.edad_estudiante} años · {grado(detalle.solicitud.grado)}</strong></div></>}
            {detalle.solicitud.institucion_procedencia&&<div className="field"><small>INSTITUCIÓN DE PROCEDENCIA</small><strong>{detalle.solicitud.institucion_procedencia}</strong></div>}
            {detalle.solicitud.parentesco_apoderado&&<div className="field"><small>PARENTESCO DEL APODERADO</small><strong>{detalle.solicitud.parentesco_apoderado}</strong></div>}
            {detalle.solicitud.asunto&&<div className="field"><small>ASUNTO</small><strong>{detalle.solicitud.asunto}</strong></div>}</div>
          {detalle.solicitud.mensaje&&<div className="field" style={{marginTop:20}}><small>MENSAJE</small><p style={{whiteSpace:'pre-wrap'}}>{detalle.solicitud.mensaje}</p></div>}
        </div></section><section className="panel"><div className="panel-head"><h2>Gestión de la solicitud</h2></div><div className="section">
          {detalle.solicitud.estado==='pendiente'&&<button className="btn primary" disabled={ocupado} onClick={()=>void operar(`/desde-web/${id}/iniciar`,'Atención iniciada')}>Atender solicitud</button>}
          {detalle.solicitud.estado!=='cerrada'&&detalle.solicitud.estado!=='pendiente_asignacion'&&<>
            <label className="form-label" htmlFor="nota-web">Agregar nota de atención</label>
            <textarea id="nota-web" className="textarea note-area" value={nota} onChange={e=>setNota(e.target.value)} placeholder="Escribe el contexto de la gestión..."/>
            <div style={{marginTop:10}}><button className="btn primary" disabled={ocupado||!nota.trim()} onClick={()=>void operar(`/desde-web/${id}/notas`,'Nota guardada',JSON.stringify({texto:nota})).then(ok=>{if(ok)setNota('')})}><Send size={14}/>Guardar nota</button></div>
            <button className="btn warn small" style={{marginTop:18}} disabled={ocupado} onClick={()=>{if(window.confirm('¿Cerrar esta atención?'))void operar(`/desde-web/${id}/cerrar`,'Atención cerrada')}}><Check size={15}/>Cerrar atención</button>
          </>}
          {detalle.notas.length>0&&<div className="saved-notes"><h3>Notas guardadas</h3><div className="timeline">{detalle.notas.map(n=><div className="item" key={n.id}><strong>{n.autor}</strong><div>{n.texto}</div><small>{fecha(n.creada_en)}</small></div>)}</div></div>}
        </div></section></div>
      </>}
    </>}
  </>;
}
