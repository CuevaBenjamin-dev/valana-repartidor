'use client';
import { useEffect, useRef, useState } from 'react';
import { Send, Smile } from 'lucide-react';

export type MensajeChat={id:string;solicitud_id:string;contenido:string;fecha:string;direccion:'entrante'|'saliente';estado:string;error:string|null};

const nombresEstado:Record<string,string>={pendiente:'En cola',enviado:'Enviado',sent:'Enviado',delivered:'Entregado',read:'Leído',error:'Error',failed:'Error',omitido:'No enviado',recibido:'Recibido'};
const emojis=['😊','🙂','👍','❤️','🎓','📚','✨','👋','🙌','✅','📅','🙏','😄','🎉','💬','📞'];

export default function Chat({mensajes,ventanaHasta,habilitado,activo,ahora,enviar}:{
  mensajes:MensajeChat[];ventanaHasta:string;habilitado:boolean;activo:boolean;ahora:number;
  enviar:(texto:string,clave:string)=>Promise<void>;
}){
  const [texto,setTexto]=useState(''),[enviando,setEnviando]=useState(false),[error,setError]=useState(''),[mostrarEmojis,setMostrarEmojis]=useState(false);
  const clave=useRef<string|null>(null),lista=useRef<HTMLDivElement|null>(null),campo=useRef<HTMLTextAreaElement|null>(null),estabaAbajo=useRef(true),envioEnCurso=useRef(false);
  const ventanaAbierta=Boolean(ventanaHasta && new Date(ventanaHasta).getTime()>ahora);
  useEffect(()=>{
    const caja=lista.current;
    if(caja && estabaAbajo.current)caja.scrollTop=caja.scrollHeight;
  },[mensajes]);
  async function enviarTexto(e:React.FormEvent){
    e.preventDefault();
    const contenido=texto.trim();
    if(!contenido || envioEnCurso.current || !ventanaAbierta || !activo || !habilitado)return;
    if(!clave.current)clave.current=crypto.randomUUID();
    envioEnCurso.current=true;
    setEnviando(true);setError('');
    try{await enviar(contenido,clave.current);setTexto('');clave.current=null;}
    catch(e){setError((e as Error).message)}
    finally{envioEnCurso.current=false;setEnviando(false)}
  }
  function insertarEmoji(emoji:string){
    const entrada=campo.current;
    const inicio=entrada?.selectionStart ?? texto.length,fin=entrada?.selectionEnd ?? texto.length;
    setTexto(texto.slice(0,inicio)+emoji+texto.slice(fin));clave.current=null;setError('');setMostrarEmojis(false);
    requestAnimationFrame(()=>{entrada?.focus();entrada?.setSelectionRange(inicio+emoji.length,inicio+emoji.length)});
  }
  return <section className="panel chat-panel" aria-label="Conversación de WhatsApp">
    <div className="panel-head"><div><h2>Conversación de WhatsApp</h2><p>Mensajes del contacto desde el número oficial de Boston</p></div></div>
    <div className="chat-messages" ref={lista} onScroll={e=>{const x=e.currentTarget;estabaAbajo.current=x.scrollHeight-x.scrollTop-x.clientHeight<90}}>
      {mensajes.length?mensajes.map(m=><div key={m.id} className={`chat-row ${m.direccion}`}>
        <div className="chat-bubble"><div className="chat-text">{m.contenido}</div>
          <div className="chat-meta"><time dateTime={m.fecha}>{new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(m.fecha))}</time>
            {m.direccion==='saliente'&&<span>{nombresEstado[m.estado]||m.estado}</span>}</div>
          {m.error&&['error','failed','omitido'].includes(m.estado)&&<div className="chat-error">{m.error}</div>}
        </div>
      </div>):<p className="chat-empty">Aún no hay mensajes en esta conversación.</p>}
    </div>
    <form className="chat-compose" onSubmit={e=>void enviarTexto(e)}>
      {!ventanaAbierta&&<p className="chat-window-warning">La ventana de atención de 24 horas terminó. Espera un nuevo mensaje del contacto para responder con texto libre.</p>}
      {!habilitado&&<p className="chat-window-warning">El envío de WhatsApp no está configurado.</p>}
      {error&&<p className="chat-error" role="alert">{error}</p>}
      <label className="form-label" htmlFor="mensaje-chat">Responder desde el número oficial</label>
      <div className="chat-compose-row"><textarea id="mensaje-chat" ref={campo} className="textarea" maxLength={4000} rows={2}
        value={texto} onChange={e=>{setTexto(e.target.value);clave.current=null;setError('')}}
        onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit()}}}
        disabled={!ventanaAbierta||!activo||!habilitado||enviando} placeholder="Escribe un mensaje para el contacto"/>
        <button className="btn chat-emoji-button" type="button" aria-label="Elegir emoji" aria-expanded={mostrarEmojis}
          disabled={!ventanaAbierta||!activo||!habilitado||enviando} onClick={()=>setMostrarEmojis(v=>!v)}><Smile size={18}/></button>
        <button className="btn primary" disabled={!texto.trim()||!ventanaAbierta||!activo||!habilitado||enviando} aria-label="Enviar mensaje"><Send size={17}/></button></div>
      {mostrarEmojis&&<div className="chat-emoji-picker" aria-label="Emojis disponibles">{emojis.map(emoji=><button key={emoji} type="button" aria-label={`Insertar ${emoji}`} onMouseDown={e=>e.preventDefault()} onClick={()=>insertarEmoji(emoji)}>{emoji}</button>)}</div>}
      <small>{texto.length}/4000</small>
    </form>
  </section>;
}
