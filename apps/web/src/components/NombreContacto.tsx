'use client';
import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';

export default function NombreContacto({nombre,onGuardar,compacto=false}:{
  nombre:string;onGuardar:(nombre:string)=>Promise<void>;compacto?:boolean;
}){
  const [editando,setEditando]=useState(false),[valor,setValor]=useState(''),[guardando,setGuardando]=useState(false),[error,setError]=useState('');
  function abrir(){setValor(nombre);setError('');setEditando(true)}
  function cancelar(){setEditando(false);setError('')}
  async function guardar(e:React.FormEvent){
    e.preventDefault();
    const limpio=valor.trim();
    if(!limpio || limpio.length>120){setError('Escribe un nombre de 1 a 120 caracteres.');return}
    if(limpio===nombre){cancelar();return}
    setGuardando(true);setError('');
    try{await onGuardar(limpio);setEditando(false)}catch(e){setError((e as Error).message)}finally{setGuardando(false)}
  }
  return <div className={`contact-name-editor ${compacto?'compact':''}`}>
    {editando?<form className="contact-name-form" onSubmit={e=>void guardar(e)}>
      <input className="form-input" aria-label="Nombre del contacto" autoFocus maxLength={120} value={valor}
        onChange={e=>setValor(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();cancelar()}}} disabled={guardando}/>
      <button className="contact-name-action save" type="submit" disabled={guardando||!valor.trim()} aria-label="Guardar nombre"><Check size={16}/></button>
      <button className="contact-name-action" type="button" onClick={cancelar} disabled={guardando} aria-label="Cancelar edición"><X size={16}/></button>
    </form>:<div className="contact-name-display"><strong title={nombre}>{nombre}</strong><button className="contact-name-action" type="button" onClick={abrir} aria-label="Editar nombre del contacto" title="Editar nombre"><Pencil size={15}/></button></div>}
    {error&&<small className="contact-name-error" role="alert">{error}</small>}
  </div>;
}
