'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, KeyRound, Trash2, X } from 'lucide-react';

export type DatosPerfil={nombre:string;apellidos:string;celular_personal:string|null;foto_perfil:string|null;rol:string};
type Campos={nombre:string;apellidos:string;celular_personal:string};

export default function PerfilModal({perfil,fotoUrl,cerrar,guardar,subirFoto,quitarFoto,cambiarClave}:{
  perfil:DatosPerfil;fotoUrl:string|null;cerrar:()=>void;
  guardar:(datos:{nombre:string;apellidos:string;celular_personal:string|null})=>Promise<void>;
  subirFoto:(foto:File)=>Promise<void>;quitarFoto:()=>Promise<void>;
  cambiarClave:(datos:{anterior:string;nueva:string;confirmacion:string})=>Promise<void>;
}){
  const [campos,setCampos]=useState<Campos>({nombre:perfil.nombre,apellidos:perfil.apellidos||'',celular_personal:perfil.celular_personal||''});
  const [claves,setClaves]=useState({anterior:'',nueva:'',confirmacion:''});
  const [vistaClave,setVistaClave]=useState(false),[ocupado,setOcupado]=useState(false),[error,setError]=useState(''),[exito,setExito]=useState('');
  const archivo=useRef<HTMLInputElement|null>(null),primerCampo=useRef<HTMLInputElement|null>(null),cerrarActual=useRef(cerrar);
  cerrarActual.current=cerrar;
  useEffect(()=>{primerCampo.current?.focus();const cerrarTecla=(e:KeyboardEvent)=>{if(e.key==='Escape')cerrarActual.current()};window.addEventListener('keydown',cerrarTecla);return()=>window.removeEventListener('keydown',cerrarTecla)},[]);
  useEffect(()=>setCampos({nombre:perfil.nombre,apellidos:perfil.apellidos||'',celular_personal:perfil.celular_personal||''}),[perfil.nombre,perfil.apellidos,perfil.celular_personal]);
  const ejecutar=async(fn:()=>Promise<void>,mensaje:string)=>{
    setOcupado(true);setError('');setExito('');
    try{await fn();setExito(mensaje)}catch(e){setError((e as Error).message)}finally{setOcupado(false)}
  };
  const nombreCompleto=[perfil.nombre,perfil.apellidos].filter(Boolean).join(' ');
  return <div className="profile-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)cerrar()}}>
    <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="titulo-perfil">
      <div className="profile-head"><div className="profile-photo">{fotoUrl?<img src={fotoUrl} alt="Foto de perfil"/>:<span>{perfil.nombre.slice(0,2).toUpperCase()}</span>}</div>
        <div><h2 id="titulo-perfil">{nombreCompleto}</h2><p>{perfil.rol}</p></div>
        <button className="profile-close" type="button" aria-label="Cerrar perfil" onClick={cerrar}><X size={18}/></button>
      </div>
      <div className="profile-body">
        {error&&<div className="notice error" role="alert">{error}</div>}{exito&&<div className="notice success">{exito}</div>}
        {!vistaClave?<>
          <div className="profile-photo-actions"><input ref={archivo} type="file" accept="image/*,.heic,.heif" hidden
            onChange={e=>{const foto=e.currentTarget.files?.[0];if(!foto)return;e.currentTarget.value='';
              if(foto.size>3*1024*1024){setError('La fotografía debe pesar 3 MB o menos');return}
              void ejecutar(()=>subirFoto(foto),'Foto actualizada.')}}/>
            <button className="btn small" type="button" disabled={ocupado} onClick={()=>archivo.current?.click()}><Camera size={15}/>{fotoUrl?'Cambiar foto':'Subir foto'}</button>
            {fotoUrl&&<button className="btn small" type="button" disabled={ocupado} onClick={()=>void ejecutar(quitarFoto,'Foto eliminada.')}><Trash2 size={14}/>Eliminar foto</button>}
            <small>JPG, PNG, WebP, GIF, AVIF o HEIC/HEIF compatible · máximo 3 MB</small>
          </div>
          <form onSubmit={e=>{e.preventDefault();void ejecutar(()=>guardar({nombre:campos.nombre.trim(),apellidos:campos.apellidos.trim(),celular_personal:campos.celular_personal.trim()||null}),'Perfil actualizado.')}}>
            <div className="profile-fields"><label>Nombres<input ref={primerCampo} className="form-input" required minLength={2} maxLength={100} value={campos.nombre} onChange={e=>setCampos({...campos,nombre:e.target.value})}/></label>
              <label>Apellidos<input className="form-input" maxLength={100} value={campos.apellidos} onChange={e=>setCampos({...campos,apellidos:e.target.value})}/></label></div>
            <label className="profile-field">WhatsApp Business personal<input className="form-input" type="tel" inputMode="tel" pattern="\+[1-9][0-9]{6,14}" title="Formato internacional, por ejemplo +51987654321" value={campos.celular_personal} onChange={e=>setCampos({...campos,celular_personal:e.target.value})} placeholder="+51987654321"/></label>
            <p className="profile-help">Es un dato de contacto. Los mensajes del repartidor siguen saliendo del número oficial.</p>
            <div className="profile-footer"><button className="btn primary" disabled={ocupado}>Guardar cambios</button>
              <button className="btn" type="button" onClick={()=>{setError('');setExito('');setVistaClave(true)}}><KeyRound size={14}/>Cambiar contraseña</button></div>
          </form>
        </>:<form onSubmit={e=>{e.preventDefault();if(claves.nueva!==claves.confirmacion){setError('Las contraseñas nuevas no coinciden');return}void ejecutar(()=>cambiarClave(claves),'Contraseña actualizada. Inicia sesión nuevamente.')}}>
          <p className="profile-help">Mínimo 6 caracteres, una mayúscula y un carácter especial.</p>
          <label className="profile-field">Contraseña actual<input ref={primerCampo} className="form-input" type="password" autoComplete="current-password" required value={claves.anterior} onChange={e=>setClaves({...claves,anterior:e.target.value})}/></label>
          <label className="profile-field">Nueva contraseña<input className="form-input" type="password" autoComplete="new-password" minLength={6} required value={claves.nueva} onChange={e=>setClaves({...claves,nueva:e.target.value})}/></label>
          <label className="profile-field">Confirmar nueva contraseña<input className="form-input" type="password" autoComplete="new-password" required value={claves.confirmacion} onChange={e=>setClaves({...claves,confirmacion:e.target.value})}/></label>
          <div className="profile-footer"><button className="btn primary" disabled={ocupado}>Actualizar contraseña</button><button className="btn" type="button" onClick={()=>{setVistaClave(false);setError('');setClaves({anterior:'',nueva:'',confirmacion:''})}}>Volver al perfil</button></div>
        </form>}
      </div>
    </section>
  </div>;
}
