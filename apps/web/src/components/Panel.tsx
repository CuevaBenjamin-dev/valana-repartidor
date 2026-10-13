'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Inbox, Bell, CircleUserRound, UsersRound, Settings2, LogOut, Search, ArrowLeft, Copy, Check, Clock3, CheckCircle2, AlertCircle, Activity, RefreshCw, Send, ChevronRight } from 'lucide-react';
import Chat, { MensajeChat } from './Chat';
import PerfilModal, { DatosPerfil } from './PerfilModal';

const API=process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Rol='asesor'|'supervisor'|'administrador';
type Tab='solicitudes'|'notificaciones'|'disponibilidad'|'supervision'|'configuracion';
type Usuario={id:string;nombre:string;apellidos:string;foto_perfil:string|null;correo:string;rol:Rol;cambio_clave_obligatorio:boolean};
type Perfil=DatosPerfil & {id:string;correo:string;disponible:boolean;presencia_en:string|null};
type Solicitud={id:string;codigo:string;estado:string;creada_en:string;asignada_en?:string;contacto:string;telefono:string|null;identificador:string;opcion:string;asesor:string|null;nueva:boolean};
type Detalle={solicitud:Solicitud & {cerrada_en?:string;atencion_iniciada_en?:string;resultado_comercial?:string};notas:{id:string;texto:string;autor:string;creada_en:string}[];interacciones:{id:string;tipo:string;texto:string;recibida_en:string}[];mensajes:MensajeChat[];ventana_hasta:string;envio_configurado:boolean};
type Aviso={id:string;solicitud_id:string|null;tipo:string;texto:string;leida_en:string|null;creada_en:string;codigo:string|null;contacto:string|null;opcion:string|null};
type Resumen={estados:{estado:string;total:number}[];asesores:{id:string;nombre:string;correo:string;activo:boolean;disponible:boolean;presencia_en:string|null;elegible:boolean}[];contadores:{nombre:string;fecha_local:string;solicitudes_reales:number;contador_ajustado:number;ajustes_nivelacion:number;asignaciones_continuidad:number;asignaciones_reparto:number}[];asignaciones:{codigo:string;motivo:string;asesor:string;asesor_anterior:string|null;creada_en:string}[];auditoria:{accion:string;entidad:string;creada_en:string}[]};
type Configuracion={negocio:{id:string;nombre:string;zona_horaria:string;dias_atencion:number[]|null;hora_inicio:string|null;hora_fin:string|null;mensaje_menu:string;mensaje_confirmacion:string;mensaje_fuera_horario:string;mensaje_sin_asesor:string};equipos:{id:string;nombre:string;activo:boolean}[];opciones:{id:string;equipo_id:string;numero:number;identificador:string;nombre:string;activo:boolean}[];usuarios:{id:string;nombre:string;correo:string;rol:Rol;activo:boolean;disponible:boolean;presencia_en:string|null;retirado_en:string|null}[]};

function csrf(){return document.cookie.split('; ').find(v=>v.startsWith('valana_csrf='))?.split('=')[1] || ''}
function errorConexion(error:unknown):Error{
  return error instanceof TypeError?new Error('No se pudo conectar con la API de Valana. Revisa la conexión e inténtalo de nuevo.'):error as Error;
}
async function api<T>(ruta:string,opciones:RequestInit={}):Promise<T>{
  const metodo=opciones.method || 'GET';
  let respuesta:Response;
  try{respuesta=await fetch(`${API}${ruta}`,{...opciones,credentials:'include',headers:{'Content-Type':'application/json',...(metodo!=='GET'?{'X-CSRF-Token':csrf()}:{}),...opciones.headers}})}catch(e){throw errorConexion(e)}
  if(!respuesta.ok){const d=await respuesta.json().catch(()=>({}));throw new Error(typeof d.message==='string'?d.message:`Error ${respuesta.status}`)}
  return respuesta.json() as Promise<T>;
}
function fecha(v?:string){if(!v)return '—';return new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v))}
function estado(s:string){return ({pendiente_asignacion:'Nuevo · sin asignar',pendiente:'Nuevo',en_atencion:'En atención',cerrada:'Cerrada'} as Record<string,string>)[s] || s}
function Estado({valor}:{valor:string}){return <span className={`badge ${valor}`}>{estado(valor)}</span>}
function Cabecera({etiqueta,titulo,descripcion,accion}:{etiqueta:string;titulo:string;descripcion:string;accion?:React.ReactNode}){return <div className="heading"><div><p className="eyebrow">{etiqueta}</p><h1>{titulo}</h1><p className="muted">{descripcion}</p></div>{accion}</div>}
function Vacio({titulo,texto}:{titulo:string;texto:string}){return <div className="empty"><Inbox size={28}/><h3>{titulo}</h3><p>{texto}</p></div>}

export default function Panel(){
  const [usuario,setUsuario]=useState<Usuario|null>(null),[cargando,setCargando]=useState(true),[login,setLogin]=useState({correo:'',clave:''}),[error,setError]=useState(''),[exito,setExito]=useState('');
  const [cambioClave,setCambioClave]=useState({anterior:'',nueva:'',confirmacion:''});
  const [enVivo,setEnVivo]=useState(false),[ahora,setAhora]=useState(Date.now());
  const [tab,setTab]=useState<Tab>('solicitudes'),[solicitudes,setSolicitudes]=useState<Solicitud[]>([]),[avisos,setAvisos]=useState<Aviso[]>([]),[perfil,setPerfil]=useState<Perfil|null>(null),[perfilAbierto,setPerfilAbierto]=useState(false),[resumen,setResumen]=useState<Resumen|null>(null),[configuracion,setConfiguracion]=useState<Configuracion|null>(null);
  const [idDetalle,setIdDetalle]=useState<string|null>(null),[detalle,setDetalle]=useState<Detalle|null>(null),[nota,setNota]=useState(''),[filtro,setFiltro]=useState('todas'),[busqueda,setBusqueda]=useState(''),[procesando,setProcesando]=useState(false);
  const [filtroAvisos,setFiltroAvisos]=useState<'sin_leer'|'todas'>('sin_leer'),[anuncio,setAnuncio]=useState('');
  const detalleActual=useRef<string|null>(null);
  const ultimaLectura=useRef<string|null>(null),lecturaEnCurso=useRef<string|null>(null),ultimoMensajeVisible=useRef<string|null>(null);
  ultimoMensajeVisible.current=detalle?.interacciones[0]?.id || null;
  const revisionCarga=useRef(0),revisionConfiguracion=useRef(0),revisionSesion=useRef(0),revisionDetalle=useRef(0);
  const limpiar=()=>{setError('');setExito('')};
  const cargar=useCallback(async (u:Usuario,incluirConfiguracion=true)=>{
    const revision=++revisionCarga.current,sesion=revisionSesion.current;
    const configuracionRevision=incluirConfiguracion?++revisionConfiguracion.current:null;
    try{
      const [s,a,p,r,c]=await Promise.all([
        api<Solicitud[]>('/solicitudes?estado=todas'),api<Aviso[]>('/notificaciones'),api<Perfil>('/perfil'),
        u.rol!=='asesor'?api<Resumen>('/supervision/resumen'):Promise.resolve(null),
        u.rol==='administrador' && incluirConfiguracion?api<Configuracion>('/configuracion'):Promise.resolve(null)
      ]);
      if(c && sesion===revisionSesion.current && configuracionRevision===revisionConfiguracion.current)setConfiguracion(c);
      if(revision!==revisionCarga.current || sesion!==revisionSesion.current)return false;
      setSolicitudes(s);setAvisos(a);setPerfil(p);
      if(r)setResumen(r);
      return true;
    }catch(e){if(revision===revisionCarga.current && sesion===revisionSesion.current)setError((e as Error).message);return false}
  },[]);
  useEffect(()=>{api<{usuario:Usuario}>('/sesion/actual').then(r=>setUsuario(r.usuario)).catch(()=>undefined).finally(()=>setCargando(false))},[]);
  useEffect(()=>{if(!usuario || usuario.cambio_clave_obligatorio)return; const latido=()=>api('/perfil/heartbeat',{method:'POST',body:'{}'}).catch(()=>undefined); void latido();const t=setInterval(latido,45000);return()=>clearInterval(t)},[usuario]);
  useEffect(()=>{detalleActual.current=idDetalle},[idDetalle]);
  useEffect(()=>{if(!usuario || usuario.cambio_clave_obligatorio)return;const t=setInterval(()=>setAhora(Date.now()),30000);return()=>clearInterval(t)},[usuario]);
  useEffect(()=>{
    if(!usuario || usuario.cambio_clave_obligatorio)return;
    let cerrado=false,enVuelo=false,repetir=false,primeraCarga=false,inicioProgramado=false;
    let pendiente:ReturnType<typeof setTimeout>|undefined,reabrir:ReturnType<typeof setTimeout>|undefined,respaldoInicial:ReturnType<typeof setTimeout>|undefined,fuente:EventSource|undefined;
    const sincronizar=async()=>{
      if(cerrado || enVuelo)return;
      enVuelo=true;
      do {
        repetir=false;
        if(await cargar(usuario,!primeraCarga))primeraCarga=true;
        const id=detalleActual.current;
        if(id){
          const revision=++revisionDetalle.current;
          try{
            const d=await api<Detalle>(`/solicitudes/${id}`);
            if(!cerrado && revision===revisionDetalle.current && detalleActual.current===id && !repetir)setDetalle(d);
          }catch{ /* La carga principal conserva su propio aviso de error. */ }
        }
      } while(repetir && !cerrado);
      enVuelo=false;
    };
    const refrescar=()=>{
      if(cerrado)return;
      inicioProgramado=true;
      ++revisionCarga.current;
      if(enVuelo){repetir=true;return;}
      if(pendiente)return;
      pendiente=setTimeout(()=>{pendiente=undefined;void sincronizar()},120);
    };
    const agendarReapertura=()=>{
      if(cerrado || reabrir)return;
      reabrir=setTimeout(()=>{reabrir=undefined;abrirFuente()},5000);
    };
    const abrirFuente=()=>{
      if(cerrado)return;
      const actual=new EventSource(`${API}/notificaciones/eventos`,{withCredentials:true});
      fuente=actual;
      actual.onopen=()=>{if(cerrado)return;setEnVivo(true);refrescar()};
      actual.onerror=()=>{
        if(cerrado)return;
        setEnVivo(false);
        // EventSource reintenta solo cuando está CONNECTING. CLOSED indica un HTTP fatal.
        if(actual.readyState===EventSource.CLOSED){
          actual.close();
          void fetch(`${API}/sesion/actual`,{credentials:'include'}).then(res=>{
            if(cerrado)return;
            if(res.status===401){++revisionSesion.current;setUsuario(null);setSolicitudes([]);setAvisos([]);setPerfil(null);setResumen(null);setConfiguracion(null);setIdDetalle(null);setDetalle(null)}
            else agendarReapertura();
          }).catch(agendarReapertura);
        }
      };
      actual.addEventListener('actualizar',()=>refrescar());
    };
    abrirFuente();
    // Una única carga inicial si SSE no llega a abrir; no es un sondeo periódico.
    respaldoInicial=setTimeout(()=>{if(!inicioProgramado)refrescar()},2000);
    return()=>{
      cerrado=true;++revisionCarga.current;++revisionDetalle.current;
      fuente?.close();
      if(pendiente)clearTimeout(pendiente);
      if(reabrir)clearTimeout(reabrir);
      if(respaldoInicial)clearTimeout(respaldoInicial);
      setEnVivo(false);
    };
  },[usuario,cargar]);
  useEffect(()=>{
    ultimaLectura.current=null;
    if(!idDetalle){setDetalle(null);return;}
    const revision=++revisionDetalle.current;
    setDetalle(null);
    api<Detalle>(`/solicitudes/${idDetalle}`).then(d=>{if(revision===revisionDetalle.current)setDetalle(d)}).catch(e=>{if(revision===revisionDetalle.current)setError(e.message)});
    return()=>{++revisionDetalle.current};
  },[idDetalle]);
  useEffect(()=>{
    if(!usuario || usuario.rol!=='asesor' || tab!=='solicitudes' || !idDetalle || detalle?.solicitud.id!==idDetalle)return;
    const id=idDetalle,ultimo=detalle.interacciones[0]?.id || null,clave=`${id}:${ultimo||''}`;
    const reconocer=()=>{
      if(document.visibilityState!=='visible' || !document.hasFocus() || ultimaLectura.current===clave || lecturaEnCurso.current===clave)return;
      lecturaEnCurso.current=clave;
      void api<{ok:boolean;actualizado:boolean}>(`/solicitudes/${id}/leer`,{method:'POST',body:JSON.stringify({ultimo_mensaje_id:ultimo})})
        .then(r=>{
          if(!r.actualizado){
            void api<Detalle>(`/solicitudes/${id}`).then(d=>{if(detalleActual.current===id)setDetalle(d)}).catch(()=>undefined);
            return;
          }
          if(detalleActual.current!==id || ultimoMensajeVisible.current!==ultimo)return;
          ultimaLectura.current=clave;
          setAvisos(prev=>prev.map(a=>a.solicitud_id===id && !a.leida_en && a.tipo!=='anuncio'?{...a,leida_en:new Date().toISOString()}:a));
          setSolicitudes(prev=>prev.map(s=>s.id===id?{...s,nueva:false}:s));
        }).catch(()=>undefined).finally(()=>{if(lecturaEnCurso.current===clave)lecturaEnCurso.current=null});
    };
    reconocer();
    window.addEventListener('focus',reconocer);
    document.addEventListener('visibilitychange',reconocer);
    return()=>{window.removeEventListener('focus',reconocer);document.removeEventListener('visibilitychange',reconocer)};
  },[usuario,tab,idDetalle,detalle]);
  const abrir=(id:string)=>{limpiar();setIdDetalle(id);setTab('solicitudes')};
  const operar=async(fn:()=>Promise<unknown>,mensaje:string)=>{setProcesando(true);limpiar();try{await fn();setExito(mensaje);if(usuario)await cargar(usuario);if(idDetalle){const revision=++revisionDetalle.current;const d=await api<Detalle>(`/solicitudes/${idDetalle}`);if(revision===revisionDetalle.current && detalleActual.current===idDetalle)setDetalle(d)}}catch(e){setError((e as Error).message)}finally{setProcesando(false)}};
  const enviarChat=async(texto:string,clave:string)=>{
    const id=detalleActual.current;
    if(!id)throw new Error('La solicitud ya no está abierta');
    await api(`/solicitudes/${id}/mensajes`,{method:'POST',body:JSON.stringify({texto,clave_idempotencia:clave})});
    const revision=++revisionDetalle.current;
    const d=await api<Detalle>(`/solicitudes/${id}`);
    if(revision===revisionDetalle.current && detalleActual.current===id)setDetalle(d);
  };
  async function entrar(e:React.FormEvent){e.preventDefault();setProcesando(true);limpiar();try{const r=await api<{usuario:Usuario}>('/sesion/iniciar',{method:'POST',body:JSON.stringify(login)});++revisionSesion.current;setUsuario(r.usuario);if(r.usuario.cambio_clave_obligatorio)setCambioClave({anterior:login.clave,nueva:'',confirmacion:''});setLogin({correo:'',clave:''})}catch(e){setError((e as Error).message)}finally{setProcesando(false)}}
  function limpiarSesionLocal(){++revisionSesion.current;setUsuario(null);setSolicitudes([]);setAvisos([]);setPerfil(null);setPerfilAbierto(false);setResumen(null);setConfiguracion(null);setIdDetalle(null);setDetalle(null);setTab('solicitudes')}
  async function guardarClave(e:React.FormEvent){e.preventDefault();setProcesando(true);limpiar();try{await api('/sesion/cambiar-clave',{method:'POST',body:JSON.stringify(cambioClave)});setCambioClave({anterior:'',nueva:'',confirmacion:''});limpiarSesionLocal();setExito('Contraseña actualizada. Inicia sesión nuevamente.')}catch(e){setError((e as Error).message)}finally{setProcesando(false)}}
  async function salir(){try{await api('/sesion/cerrar',{method:'POST',body:'{}'})}finally{limpiarSesionLocal()}}
  async function guardarPerfil(datos:{nombre:string;apellidos:string;celular_personal:string|null}){
    const actualizado=await api<Perfil>('/perfil',{method:'PATCH',body:JSON.stringify(datos)});
    setPerfil(actualizado);setUsuario(u=>u?{...u,nombre:actualizado.nombre,apellidos:actualizado.apellidos,foto_perfil:actualizado.foto_perfil}:u);
  }
  async function subirFotoPerfil(archivo:File){
    let respuesta:Response;
    try{respuesta=await fetch(`${API}/perfil/foto`,{method:'POST',credentials:'include',headers:{'Content-Type':archivo.type||'application/octet-stream','X-CSRF-Token':csrf()},body:archivo})}
    catch(e){throw new Error('No se pudo subir la fotografía. Revisa la conexión y que el archivo pese 3 MB o menos.',{cause:e})}
    if(!respuesta.ok){const d=await respuesta.json().catch(()=>({}));throw new Error(typeof d.message==='string'?d.message:respuesta.status===413?'La fotografía supera el límite permitido de 3 MB':respuesta.status===401?'Tu sesión terminó. Inicia sesión de nuevo':`No se pudo subir la fotografía (HTTP ${respuesta.status})`)}
    const dato=await respuesta.json() as {foto_perfil:string};
    setPerfil(p=>p?{...p,foto_perfil:dato.foto_perfil}:p);setUsuario(u=>u?{...u,foto_perfil:dato.foto_perfil}:u);
  }
  async function quitarFotoPerfil(){const dato=await api<{foto_perfil:null}>('/perfil/foto',{method:'DELETE'});setPerfil(p=>p?{...p,foto_perfil:dato.foto_perfil}:p);setUsuario(u=>u?{...u,foto_perfil:null}:u)}
  async function cambiarClavePerfil(datos:{anterior:string;nueva:string;confirmacion:string}){await api('/sesion/cambiar-clave',{method:'POST',body:JSON.stringify(datos)});limpiarSesionLocal();setExito('Contraseña actualizada. Inicia sesión nuevamente.')}
  const cambiarDisponibilidad=async()=>{if(!perfil || procesando)return;setProcesando(true);limpiar();try{const disponible=!perfil.disponible;await api('/perfil/disponibilidad',{method:'POST',body:JSON.stringify({disponible})});setPerfil({...perfil,disponible});}catch(e){setError((e as Error).message)}finally{setProcesando(false)}};
  const leerAviso=async(a:Aviso)=>{if(a.solicitud_id){abrir(a.solicitud_id);return}if(!a.leida_en){try{await api(`/notificaciones/${a.id}/leer`,{method:'POST',body:'{}'});setAvisos(prev=>prev.map(x=>x.id===a.id?{...x,leida_en:new Date().toISOString()}:x))}catch(e){setError((e as Error).message)}}};
  const enviarAnuncio=async(e:React.FormEvent)=>{e.preventDefault();setProcesando(true);limpiar();try{await api('/notificaciones/anuncios',{method:'POST',body:JSON.stringify({texto:anuncio})});setAnuncio('');if(usuario)await cargar(usuario);setExito('Anuncio enviado al equipo.')}catch(err){setError((err as Error).message)}finally{setProcesando(false)}};
  const avisosVisibles=avisos.filter(a=>filtroAvisos==='todas'||!a.leida_en);
  const lista=useMemo(()=>solicitudes.filter(s=>{
    if(filtro==='nuevo' && !['pendiente','pendiente_asignacion'].includes(s.estado))return false;
    if(!['todas','nuevo'].includes(filtro) && s.estado!==filtro)return false;
    const q=busqueda.toLowerCase();return !q || [s.codigo,s.contacto,s.identificador].some(x=>x?.toLowerCase().includes(q));
  }),[solicitudes,filtro,busqueda]);
  if(cargando)return <div className="login-box"><span className="muted">Cargando Valana…</span></div>;
  if(!usuario)return <main className="login-page"><section className="login-art"><div className="bbs-logo login-logo" role="img" aria-label="Boston Bilingual School"/><div><p className="eyebrow" style={{color:'#f1ae88'}}>BOSTON BILINGUAL SCHOOL</p><h1>Cada consulta merece la atención correcta.</h1><p>Una bandeja clara para recibir, distribuir y dar seguimiento a cada solicitud de tu equipo comercial.</p></div><small>Valana Repartidor · Acceso privado</small></section><section className="login-box"><form className="login-form" onSubmit={entrar}><div className="bbs-logo form-logo" role="img" aria-label="Boston Bilingual School"/><p className="eyebrow">ACCESO AL PANEL</p><h2>Iniciar sesión</h2><p>Ingresa con las credenciales asignadas a tu cuenta.</p><div className="form-block"><label className="form-label">Correo electrónico</label><input className="form-input" type="email" autoComplete="username" required value={login.correo} onChange={e=>setLogin({...login,correo:e.target.value})} placeholder="tu.nombre@valana.local"/></div><div className="form-block"><label className="form-label">Contraseña</label><input className="form-input" type="password" autoComplete="current-password" required value={login.clave} onChange={e=>setLogin({...login,clave:e.target.value})} placeholder="Ingresa tu contraseña"/></div>{error&&<div className="notice error">{error}</div>}{exito&&<div className="notice success">{exito}</div>}<button className="btn primary" disabled={procesando}>{procesando?'Ingresando…':'Ingresar al panel'} <ChevronRight size={16}/></button></form></section></main>;
  if(usuario.cambio_clave_obligatorio)return <main className="login-page"><section className="login-art"><div className="bbs-logo login-logo" role="img" aria-label="Boston Bilingual School"/><div><h1>Protege tu cuenta antes de continuar.</h1><p>Tu contraseña es temporal. Cámbiala para acceder al panel.</p></div></section><section className="login-box"><form className="login-form" onSubmit={e=>void guardarClave(e)}><h2>Crear contraseña personal</h2><p>Usa al menos 6 caracteres, una mayúscula y un carácter especial.</p><div className="form-block"><label className="form-label">Contraseña temporal</label><input className="form-input" type="password" autoComplete="current-password" required value={cambioClave.anterior} onChange={e=>setCambioClave({...cambioClave,anterior:e.target.value})}/></div><div className="form-block"><label className="form-label">Nueva contraseña</label><input className="form-input" type="password" autoComplete="new-password" minLength={6} required value={cambioClave.nueva} onChange={e=>setCambioClave({...cambioClave,nueva:e.target.value})}/></div><div className="form-block"><label className="form-label">Confirmar nueva contraseña</label><input className="form-input" type="password" autoComplete="new-password" required value={cambioClave.confirmacion} onChange={e=>setCambioClave({...cambioClave,confirmacion:e.target.value})}/></div>{error&&<div className="notice error">{error}</div>}<button className="btn primary" disabled={procesando}>Guardar nueva contraseña</button><button className="btn" type="button" onClick={()=>void salir()}>Cerrar sesión</button></form></section></main>;
  const items:{id:Tab;nombre:string;Icon:typeof Inbox}[]=[{id:'solicitudes',nombre:'Solicitudes',Icon:Inbox},{id:'notificaciones',nombre:'Notificaciones',Icon:Bell},...(usuario.rol==='administrador'?[{id:'disponibilidad' as Tab,nombre:'Disponibilidad',Icon:CircleUserRound}]:[]),...(usuario.rol!=='asesor'?[{id:'supervision' as Tab,nombre:'Supervisión',Icon:UsersRound}]:[]),...(usuario.rol==='administrador'?[{id:'configuracion' as Tab,nombre:'Configuración',Icon:Settings2}]:[])];
  const navegar=(t:Tab)=>{setTab(t);setIdDetalle(null);limpiar();setFiltro('todas');setBusqueda('')};
  const tabla=(filas:Solicitud[])=>filas.length?<div className="table-wrap"><table><thead><tr><th>Solicitud</th><th>Contacto</th><th>Servicio</th><th>Ingreso</th><th>Estado</th><th>Asesor</th><th></th></tr></thead><tbody>{filas.map(s=><tr key={s.id}><td><button className="link-button" onClick={()=>abrir(s.id)}>{s.codigo}</button>{s.nueva&&<span style={{color:'#de8c60',marginLeft:8}}>●</span>}</td><td><strong>{s.contacto}</strong><div style={{fontSize:11,color:'#9ba8b5',marginTop:4}}>{s.identificador}</div></td><td>{s.opcion}</td><td>{fecha(s.creada_en)}</td><td><Estado valor={s.estado}/></td><td>{s.asesor||'—'}</td><td><button className="btn small" onClick={()=>abrir(s.id)}>Ver detalle</button></td></tr>)}</tbody></table></div>:<Vacio titulo="No hay solicitudes aquí" texto="Las solicitudes que coincidan con tu selección aparecerán en esta bandeja."/>;
  const nombreCompleto=[usuario.nombre,usuario.apellidos].filter(Boolean).join(' ');
  const fotoUrl=usuario.foto_perfil?`${API}/perfil/foto?v=${encodeURIComponent(usuario.foto_perfil)}`:null;
  return <div className="app"><aside className="sidebar"><div className="brand"><div className="bbs-logo sidebar-logo" role="img" aria-label="Boston Bilingual School"/><span className="brand-caption">VALANA · REPARTIDOR COMERCIAL</span></div><nav className="nav">{items.map(({id,nombre,Icon})=><button key={id} className={tab===id?'active':''} onClick={()=>navegar(id)}><Icon size={17}/>{nombre}{id==='notificaciones'&&avisos.filter(a=>!a.leida_en).length>0&&<span style={{marginLeft:'auto',background:'#e99873',color:'#1e3554',borderRadius:10,padding:'2px 6px',fontSize:10,fontWeight:800}}>{avisos.filter(a=>!a.leida_en).length}</span>}</button>)}</nav><div className="side-foot"><button className="profile-trigger" type="button" onClick={()=>setPerfilAbierto(true)} aria-label="Abrir mi perfil"><span className="avatar">{fotoUrl?<img src={fotoUrl} alt=""/>:usuario.nombre.slice(0,2).toUpperCase()}</span><span><span className="profile-name">{nombreCompleto}</span><span className="profile-role">{usuario.rol}</span></span></button><button onClick={()=>void salir()}><LogOut size={15}/>Cerrar sesión</button></div></aside><div className="main"><header className="topbar"><div><small>ESPACIO DE TRABAJO</small><strong>Boston Bilingual School</strong></div><div className="top-actions">{usuario.rol==='asesor'&&<button className={`availability-toggle ${perfil?.disponible?'on':'off'}`} type="button" aria-pressed={Boolean(perfil?.disponible)} disabled={procesando||!perfil} onClick={()=>void cambiarDisponibilidad()}>{perfil?.disponible?'● Disponible':'○ No disponible'}</button>}<span className="pill-live"><span className="dot"/>{enVivo?'Actualización en vivo':'Reconectando'}</span><button className="avatar top-avatar" type="button" onClick={()=>setPerfilAbierto(true)} aria-label="Abrir mi perfil">{fotoUrl?<img src={fotoUrl} alt=""/>:usuario.nombre.slice(0,2).toUpperCase()}</button></div></header><nav className="mobile-nav">{items.map(({id,nombre})=><button key={id} className={tab===id?'active':''} onClick={()=>navegar(id)}>{nombre}</button>)}<button onClick={()=>void salir()}>Salir</button></nav><main className="content">{error&&<div className="notice error">{error}</div>}{exito&&<div className="notice success">{exito}</div>}
    {tab==='solicitudes'&&!idDetalle&&<><Cabecera etiqueta="BANDEJA DE TRABAJO" titulo="Solicitudes" descripcion="Aquí están todas tus solicitudes, incluidas las atendidas y cerradas."/><section className="panel"><div className="panel-head"><div><h2>Todas las solicitudes</h2><p>{lista.length} resultados</p></div></div><div className="toolbar"><div className="search"><Search size={16}/><input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar por nombre, teléfono o código"/></div><div className="filters">{[['todas','Todas'],['nuevo','Nuevo'],['en_atencion','En atención'],['cerrada','Cerradas']].map(([id,n])=><button key={id} className={filtro===id?'selected':''} onClick={()=>setFiltro(id)}>{n}</button>)}</div></div>{tabla(lista)}</section></>}
    {idDetalle&&tab==='solicitudes'&&<><button className="btn text" onClick={()=>setIdDetalle(null)} style={{marginBottom:15}}><ArrowLeft size={16}/>Volver a solicitudes</button>{!detalle?<div className="panel section">Cargando detalle…</div>:<><Cabecera etiqueta="ATENCIÓN COMERCIAL" titulo={detalle.solicitud.codigo} descripcion={`Solicitud de ${detalle.solicitud.opcion} · ingresó ${fecha(detalle.solicitud.creada_en)}`} accion={<Estado valor={detalle.solicitud.estado}/>}/><div className="detail-grid"><div><section className="panel" style={{marginBottom:20}}><div className="panel-head"><h2>Datos del contacto</h2></div><div className="section"><div className="field-grid"><div className="field"><small>NOMBRE</small><strong>{detalle.solicitud.contacto}</strong></div><div className="field"><small>CONTACTO WHATSAPP</small><div className="row"><strong>{detalle.solicitud.identificador}</strong>{detalle.solicitud.identificador!=='Número privado'&&<button className="btn small" onClick={()=>{void navigator.clipboard.writeText(detalle.solicitud.identificador);setExito('Identificador copiado')}}><Copy size={13}/>Copiar</button>}</div></div><div className="field"><small>SERVICIO</small><strong>{detalle.solicitud.opcion}</strong></div><div className="field"><small>ASESOR RESPONSABLE</small><strong>{detalle.solicitud.asesor||'Sin asignar'}</strong></div></div></div></section><section className="panel management-panel" style={{marginBottom:20}}><div className="panel-head"><h2>Gestión de la solicitud</h2>{detalle.solicitud.estado!=='cerrada'&&detalle.solicitud.estado!=='pendiente_asignacion'&&<button className="btn warn small" disabled={procesando} onClick={()=>{if(window.confirm('¿Cerrar esta atención?'))void operar(()=>api(`/solicitudes/${idDetalle}/cerrar`,{method:'POST',body:'{}'}),'Atención cerrada')}}><Check size={15}/>Cerrar atención</button>}</div><div className="section">{detalle.solicitud.estado==='pendiente'&&<div style={{marginBottom:15}}><button className="btn primary" disabled={procesando} onClick={()=>void operar(()=>api(`/solicitudes/${idDetalle}/iniciar`,{method:'POST',body:'{}'}),'Atención iniciada')}>Atender solicitud</button></div>}{detalle.solicitud.estado!=='cerrada'&&detalle.solicitud.estado!=='pendiente_asignacion'&&<><label className="form-label">Agregar nota de atención</label><textarea className="textarea note-area" value={nota} onChange={e=>setNota(e.target.value)} placeholder="Escribe el contexto de la gestión..."/><div style={{marginTop:10}}><button className="btn primary" disabled={procesando||!nota.trim()} onClick={()=>void operar(async()=>{await api(`/solicitudes/${idDetalle}/notas`,{method:'POST',body:JSON.stringify({texto:nota})});setNota('')},'Nota guardada')}><Send size={14}/>Guardar nota</button></div></>}{detalle.notas.length>0&&<div className="saved-notes"><h3>Notas guardadas</h3><div className="timeline">{detalle.notas.map(n=><div className="item" key={n.id}><strong>{n.autor}</strong><div>{n.texto}</div><small>{fecha(n.creada_en)}</small></div>)}</div></div>}</div></section></div><div><Chat mensajes={detalle.mensajes} ventanaHasta={detalle.ventana_hasta} habilitado={detalle.envio_configurado} activo={detalle.solicitud.estado!=='cerrada' && detalle.solicitud.estado!=='pendiente_asignacion'} ahora={ahora} enviar={enviarChat}/></div></div></>}</>}
    {tab==='notificaciones'&&<><Cabecera etiqueta="AVISOS IMPORTANTES" titulo="Notificaciones" descripcion="Solicitudes nuevas, mensajes por revisar y anuncios del administrador."/>
      {usuario.rol==='administrador'&&<section className="panel announcement-panel"><div className="panel-head"><h2>Enviar anuncio al equipo</h2></div><form className="section" onSubmit={e=>void enviarAnuncio(e)}><label className="form-label" htmlFor="texto-anuncio">Mensaje para todos los usuarios activos</label><textarea id="texto-anuncio" className="textarea" minLength={4} maxLength={1000} required value={anuncio} onChange={e=>setAnuncio(e.target.value)} placeholder="Escribe el anuncio aquí..."/><button className="btn primary" disabled={procesando||anuncio.trim().length<4} style={{marginTop:12}}><Send size={14}/>Enviar anuncio</button></form></section>}
      <section className="panel"><div className="panel-head"><div><h2>Tu bandeja de avisos</h2><p>{avisos.filter(a=>!a.leida_en).length} sin leer</p></div><div className="filters"><button className={filtroAvisos==='sin_leer'?'selected':''} onClick={()=>setFiltroAvisos('sin_leer')}>Sin leer</button><button className={filtroAvisos==='todas'?'selected':''} onClick={()=>setFiltroAvisos('todas')}>Todas</button></div></div>
        {avisosVisibles.length?avisosVisibles.map(a=><div className={`notification notice-card ${!a.leida_en?'unread':''}`} key={a.id}><span className={`notice-icon ${a.tipo==='anuncio'?'announcement':''}`}>{a.tipo==='anuncio'?<Bell size={18}/>:<Inbox size={18}/>}</span><div className="notice-body"><strong>{a.tipo==='anuncio'?'Anuncio del administrador':a.tipo==='mensaje_recibido'?'Mensaje nuevo del contacto':a.tipo==='reasignacion'?'Solicitud reasignada':'Nueva solicitud asignada'}</strong>{a.tipo==='anuncio'?<p>{a.texto}</p>:<p>{a.contacto} · {a.opcion}<span className="notice-code">{a.codigo}</span></p>}<small>{fecha(a.creada_en)}{!a.leida_en?' · Sin leer':''}</small></div><button className="btn small" onClick={()=>void leerAviso(a)}>{a.solicitud_id?'Ver solicitud':'Marcar leída'}</button></div>):<Vacio titulo="No hay avisos en esta vista" texto={filtroAvisos==='sin_leer'?'Ya revisaste todos tus avisos.':'Las solicitudes, mensajes nuevos y anuncios aparecerán aquí.'}/>}</section></>}
    {tab==='disponibilidad'&&usuario.rol==='administrador'&&resumen&&<><Cabecera etiqueta="EQUIPO" titulo="Disponibilidad" descripcion="Asesores habilitados y conectados para recibir nuevas solicitudes."/><section className="panel"><div className="panel-head"><h2>Estado de los asesores</h2></div><div className="table-wrap"><table><thead><tr><th>Asesor</th><th>Disponibilidad</th><th>Conexión</th><th>Puede recibir</th></tr></thead><tbody>{resumen.asesores.map(a=><tr key={a.id}><td><strong>{a.nombre}</strong></td><td>{a.disponible?'Disponible':'No disponible'}</td><td>{a.presencia_en&&ahora-new Date(a.presencia_en).getTime()<120000?'Conectado':'Sin conexión'}</td><td>{a.elegible?'Sí':'No'}</td></tr>)}</tbody></table></div></section></>}
    {tab==='supervision'&&resumen&&<><Cabecera etiqueta="VISTA DE EQUIPO" titulo="Supervisión" descripcion="Estado del equipo, carga de trabajo y asignaciones." accion={<button className="btn" onClick={()=>void cargar(usuario)}><RefreshCw size={15}/>Actualizar</button>}/><div className="cards">{([['Nuevo',(resumen.estados.find(x=>x.estado==='pendiente')?.total||0)+(resumen.estados.find(x=>x.estado==='pendiente_asignacion')?.total||0),Clock3],['Sin asignar',resumen.estados.find(x=>x.estado==='pendiente_asignacion')?.total||0,AlertCircle],['En atención',resumen.estados.find(x=>x.estado==='en_atencion')?.total||0,Activity],['Cerradas',resumen.estados.find(x=>x.estado==='cerrada')?.total||0,CheckCircle2]] as [string,number,typeof Inbox][]).map(([nombre,total,Icon])=><div className="stat" key={nombre as string}><div className="stat-top">{nombre as string}<span className="icon"><Icon size={17}/></span></div><strong>{total as number}</strong></div>)}</div><div className="split"><section className="panel"><div className="panel-head"><h2>Asesores del equipo</h2></div><div className="table-wrap"><table><thead><tr><th>Asesor</th><th>Estado</th><th>Disponibilidad</th></tr></thead><tbody>{resumen.asesores.map(a=><tr key={a.id}><td><strong>{a.nombre}</strong></td><td>{a.activo && a.disponible && a.presencia_en && ahora-new Date(a.presencia_en).getTime()<120000?'Conectado':'Desconectado'}</td><td>{a.disponible?'Disponible':'No disponible'}</td></tr>)}</tbody></table></div></section><section className="panel"><div className="panel-head"><h2>Distribución de hoy</h2></div><div className="table-wrap"><table><thead><tr><th>Asesor</th><th>Reales</th><th>Ajustado</th><th>Nivelación</th></tr></thead><tbody>{resumen.contadores.map(c=><tr key={c.nombre}><td><strong>{c.nombre}</strong></td><td>{c.solicitudes_reales}</td><td>{c.contador_ajustado}</td><td>{c.ajustes_nivelacion}</td></tr>)}</tbody></table></div></section></div><section className="panel" style={{marginTop:20}}><div className="panel-head"><h2>Asignaciones recientes</h2></div><div className="table-wrap"><table><thead><tr><th>Solicitud</th><th>Asesor</th><th>Motivo</th><th>Fecha</th></tr></thead><tbody>{resumen.asignaciones.map((a,i)=><tr key={i}><td>{a.codigo}</td><td>{a.asesor}</td><td>{a.motivo}</td><td>{fecha(a.creada_en)}</td></tr>)}</tbody></table></div></section><Reasignar solicitudes={solicitudes.filter(s=>s.estado!=='cerrada')} asesores={resumen.asesores} onGuardar={async d=>{await operar(()=>api('/supervision/reasignar',{method:'POST',body:JSON.stringify(d)}),'Solicitudes del contacto reasignadas')}}/></>}
    {tab==='configuracion'&&configuracion&&<ConfiguracionVista config={configuracion} actualizar={async()=>{await cargar(usuario)}} guardar={async(ruta,body,method='PATCH')=>{await operar(()=>api(ruta,{method,body:JSON.stringify(body)}),'Configuración guardada')}}/>}
  </main></div>{perfilAbierto&&perfil&&<PerfilModal perfil={perfil} fotoUrl={fotoUrl} cerrar={()=>setPerfilAbierto(false)} guardar={guardarPerfil} subirFoto={subirFotoPerfil} quitarFoto={quitarFotoPerfil} cambiarClave={cambiarClavePerfil}/>}</div>;
}

function Reasignar({solicitudes,asesores,onGuardar}:{solicitudes:Solicitud[];asesores:Resumen['asesores'];onGuardar:(d:{solicitud_id:string;asesor_id:string;motivo:string})=>Promise<void>}){
  const [solicitud_id,setSolicitud]=useState(''),[asesor_id,setAsesor]=useState(''),[motivo,setMotivo]=useState('');
  return <section className="panel" style={{marginTop:20}}><div className="panel-head"><div><h2>Reasignación supervisada</h2><p>Se actualizarán todas las solicitudes abiertas del mismo contacto en el equipo.</p></div></div><form className="section" onSubmit={e=>{e.preventDefault();void onGuardar({solicitud_id,asesor_id,motivo})}}><div className="form-row"><div><label className="form-label">Solicitud</label><select className="form-select" required value={solicitud_id} onChange={e=>setSolicitud(e.target.value)}><option value="">Seleccionar solicitud</option>{solicitudes.map(s=><option key={s.id} value={s.id}>{s.codigo} · {s.contacto}</option>)}</select></div><div><label className="form-label">Nuevo asesor</label><select className="form-select" required value={asesor_id} onChange={e=>setAsesor(e.target.value)}><option value="">Seleccionar asesor</option>{asesores.map(a=><option key={a.id} value={a.id}>{a.nombre}</option>)}</select></div></div><div className="form-block"><label className="form-label">Motivo de la reasignación</label><input className="form-input" required minLength={8} value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="Explica brevemente el motivo"/></div><button className="btn primary">Reasignar</button></form></section>
}

function ConfiguracionVista({config,guardar,actualizar}:{config:Configuracion;guardar:(ruta:string,body:unknown,method?:'PATCH'|'POST')=>Promise<void>;actualizar:()=>Promise<void>}){
  const [negocio,setNegocio]=useState(config.negocio),[opciones,setOpciones]=useState(config.opciones);
  const [nuevo,setNuevo]=useState({nombre:'',correo:'',rol:'asesor' as Rol,clave:'',equipo_id:config.equipos[0]?.id||''});
  useEffect(()=>{setNegocio(config.negocio);setOpciones(config.opciones)},[config]);
  const dias=['L','M','M','J','V','S','D'];
  return <><Cabecera etiqueta="ADMINISTRACIÓN" titulo="Configuración" descripcion="Ajusta el menú, horarios y mensajes que recibe cada contacto."/><div className="config-grid"><section className="panel"><div className="panel-head"><h2>Horario de atención</h2></div><div className="section"><p className="muted">Si no defines días u horas, se considera atención continua.</p><div className="row" style={{margin:'18px 0'}}>{dias.map((d,i)=><label key={i} className="row" style={{fontSize:12}}><input className="check" type="checkbox" checked={negocio.dias_atencion?.includes(i+1)||false} onChange={e=>setNegocio({...negocio,dias_atencion:e.target.checked?[...new Set([...(negocio.dias_atencion||[]),i+1])].sort():negocio.dias_atencion?.filter(x=>x!==i+1)||[]})}/>{d}</label>)}</div><div className="form-row"><div><label className="form-label">Inicio</label><input className="form-input" type="time" value={negocio.hora_inicio?.slice(0,5)||''} onChange={e=>setNegocio({...negocio,hora_inicio:e.target.value||null})}/></div><div><label className="form-label">Cierre</label><input className="form-input" type="time" value={negocio.hora_fin?.slice(0,5)||''} onChange={e=>setNegocio({...negocio,hora_fin:e.target.value||null})}/></div></div><p className="muted">Zona horaria: {negocio.zona_horaria}</p></div></section><section className="panel"><div className="panel-head"><h2>Opciones del menú</h2></div><div className="section">{opciones.map(o=><div className="option-row" key={o.id}><div className="number">{o.numero}</div><input className="form-input" value={o.nombre} onChange={e=>setOpciones(opciones.map(x=>x.id===o.id?{...x,nombre:e.target.value}:x))}/><label className="row" style={{fontSize:12}}><input className="check" type="checkbox" checked={o.activo} onChange={e=>setOpciones(opciones.map(x=>x.id===o.id?{...x,activo:e.target.checked}:x))}/>Activa</label></div>)}<button className="btn" style={{marginTop:18}} onClick={()=>void Promise.all(opciones.map(o=>guardar(`/configuracion/opciones/${o.id}`,{numero:o.numero,nombre:o.nombre,identificador:o.identificador,activo:o.activo})))}>Guardar opciones</button></div></section></div><section className="panel" style={{marginTop:20}}><div className="panel-head"><h2>Mensajes automáticos</h2></div><div className="section"><div className="form-row"><div><label className="form-label">Encabezado del menú</label><textarea className="textarea" value={negocio.mensaje_menu} onChange={e=>setNegocio({...negocio,mensaje_menu:e.target.value})}/></div><div><label className="form-label">Confirmación</label><textarea className="textarea" value={negocio.mensaje_confirmacion} onChange={e=>setNegocio({...negocio,mensaje_confirmacion:e.target.value})}/></div><div><label className="form-label">Fuera de horario</label><textarea className="textarea" value={negocio.mensaje_fuera_horario} onChange={e=>setNegocio({...negocio,mensaje_fuera_horario:e.target.value})}/></div><div><label className="form-label">Sin asesores disponibles</label><textarea className="textarea" value={negocio.mensaje_sin_asesor} onChange={e=>setNegocio({...negocio,mensaje_sin_asesor:e.target.value})}/></div></div><button className="btn primary" onClick={()=>void guardar('/configuracion/negocio',{dias_atencion:negocio.dias_atencion?.length?negocio.dias_atencion:null,hora_inicio:negocio.hora_inicio?.slice(0,5)||null,hora_fin:negocio.hora_fin?.slice(0,5)||null,mensaje_menu:negocio.mensaje_menu,mensaje_confirmacion:negocio.mensaje_confirmacion,mensaje_fuera_horario:negocio.mensaje_fuera_horario,mensaje_sin_asesor:negocio.mensaje_sin_asesor})}>Guardar configuración</button></div></section><GestionAsesores config={config} actualizar={actualizar}/></>;
}

function GestionAsesores({config,actualizar}:{config:Configuracion;actualizar:()=>Promise<void>}){
  const [nuevo,setNuevo]=useState({nombre:'',correo:'',clave:'',equipo_id:config.equipos[0]?.id||''});
  const [editarId,setEditarId]=useState<string|null>(null),[edicion,setEdicion]=useState({nombre:'',correo:''});
  const [resetId,setResetId]=useState<string|null>(null),[resetClave,setResetClave]=useState('');
  const [ocupado,setOcupado]=useState(false),[error,setError]=useState(''),[exito,setExito]=useState('');
  const asesores=config.usuarios.filter(u=>u.rol==='asesor' && !u.retirado_en);
  async function accion(ruta:string,body:unknown,mensaje:string){
    setOcupado(true);setError('');setExito('');
    try{await api(ruta,{method:'POST',body:JSON.stringify(body)});await actualizar();setExito(mensaje);return true}
    catch(e){setError((e as Error).message);return false}
    finally{setOcupado(false)}
  }
  async function editar(u:Configuracion['usuarios'][number],datos:{nombre:string;correo:string;activo:boolean}){
    setOcupado(true);setError('');setExito('');
    try{await api(`/configuracion/usuarios/${u.id}`,{method:'PATCH',body:JSON.stringify(datos)});await actualizar();setEditarId(null);setExito('Asesor actualizado.')}
    catch(e){setError((e as Error).message)}finally{setOcupado(false)}
  }
  return <section className="panel" style={{marginTop:20}}>
    <div className="panel-head"><div><h2>Gestión de asesores</h2><p>Cuentas, disponibilidad y acceso al reparto</p></div></div>
    {error&&<div className="notice error" role="alert">{error}</div>}{exito&&<div className="notice success">{exito}</div>}
    <div className="table-wrap"><table><thead><tr><th>Asesor</th><th>Correo</th><th>Cuenta</th><th>Disponibilidad</th><th>Acciones</th></tr></thead><tbody>
      {asesores.map(u=><tr key={u.id}><td><strong>{u.nombre}</strong></td><td>{u.correo}</td><td>{u.activo?'Activa':'Inactiva'}</td><td>{u.activo&&u.disponible?'Disponible':'No disponible'}</td><td><div className="row">
        <button className="btn small" disabled={ocupado} onClick={()=>{setEditarId(u.id);setEdicion({nombre:u.nombre,correo:u.correo});setResetId(null)}}>Editar</button>
        <button className="btn small" disabled={ocupado} onClick={()=>void editar(u,{nombre:u.nombre,correo:u.correo,activo:!u.activo})}>{u.activo?'Desactivar':'Activar'}</button>
        {u.activo&&<button className="btn small" disabled={ocupado} onClick={()=>{setResetId(u.id);setResetClave('');setEditarId(null)}}>Restablecer clave</button>}
        {u.activo&&<button className="btn small warn" disabled={ocupado} onClick={()=>{if(window.confirm(`¿Retirar a ${u.nombre}? Se revocará su acceso y se reasignarán sus solicitudes abiertas.`))void accion(`/configuracion/asesores/${u.id}/retirar`,{},'Asesor retirado y solicitudes reasignadas.')}}>Retirar</button>}
      </div></td></tr>)}
    </tbody></table></div>
    {editarId&&<form className="section" onSubmit={e=>{e.preventDefault();const u=asesores.find(x=>x.id===editarId);if(u)void editar(u,{...edicion,activo:u.activo})}}><h3>Editar asesor</h3><div className="form-row"><div><label className="form-label">Nombre</label><input className="form-input" required minLength={2} value={edicion.nombre} onChange={e=>setEdicion({...edicion,nombre:e.target.value})}/></div><div><label className="form-label">Correo</label><input className="form-input" type="email" required value={edicion.correo} onChange={e=>setEdicion({...edicion,correo:e.target.value})}/></div></div><div className="row"><button className="btn primary" disabled={ocupado}>Guardar cambios</button><button className="btn" type="button" onClick={()=>setEditarId(null)}>Cancelar</button></div></form>}
    {resetId&&<form className="section" onSubmit={e=>{e.preventDefault();void accion(`/configuracion/asesores/${resetId}/restablecer-clave`,{clave:resetClave},'Contraseña temporal restablecida; las sesiones previas se revocaron.').then(ok=>{if(ok){setResetId(null);setResetClave('')}})}}><h3>Restablecer contraseña</h3><p className="muted">El asesor deberá crear una contraseña robusta al ingresar.</p><div className="form-row"><div><label className="form-label">Contraseña temporal</label><input className="form-input" type="password" minLength={8} maxLength={256} autoComplete="new-password" required value={resetClave} onChange={e=>setResetClave(e.target.value)}/></div></div><div className="row"><button className="btn primary" disabled={ocupado}>Restablecer</button><button className="btn" type="button" onClick={()=>setResetId(null)}>Cancelar</button></div></form>}
    <form className="section" onSubmit={e=>{e.preventDefault();void accion('/configuracion/usuarios',{...nuevo,rol:'asesor'},'Asesor creado. Deberá cambiar su contraseña temporal.').then(ok=>{if(ok)setNuevo({...nuevo,nombre:'',correo:'',clave:''})})}}><h3>Crear asesor</h3><div className="form-row"><div><label className="form-label">Nombre</label><input className="form-input" required minLength={2} value={nuevo.nombre} onChange={e=>setNuevo({...nuevo,nombre:e.target.value})}/></div><div><label className="form-label">Correo</label><input className="form-input" type="email" required value={nuevo.correo} onChange={e=>setNuevo({...nuevo,correo:e.target.value})}/></div><div><label className="form-label">Equipo</label><select className="form-select" required value={nuevo.equipo_id} onChange={e=>setNuevo({...nuevo,equipo_id:e.target.value})}>{config.equipos.filter(x=>x.activo).map(x=><option key={x.id} value={x.id}>{x.nombre}</option>)}</select></div><div><label className="form-label">Contraseña temporal</label><input className="form-input" type="password" minLength={8} maxLength={256} autoComplete="new-password" required value={nuevo.clave} onChange={e=>setNuevo({...nuevo,clave:e.target.value})}/></div></div><button className="btn primary" disabled={ocupado}>Crear asesor</button></form>
  </section>;
}
