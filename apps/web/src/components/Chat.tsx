'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Send, Smile } from 'lucide-react';
import NombreContacto from './NombreContacto';

export type MensajeChat={id:string;solicitud_id:string;contenido:string;fecha:string;direccion:'entrante'|'saliente';estado:string;error:string|null};

const nombresEstado:Record<string,string>={pendiente:'En cola',enviado:'Enviado',sent:'Enviado',delivered:'Entregado',read:'Leído',error:'Error',failed:'Error',omitido:'No enviado',recibido:'Recibido'};
const emojis={
  Caras:['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😍','🥰','😘','😋','😎','🤩','🥳','😏','😔','😢','😭','😮','😲','😴','🤔','🤗','🫶'],
  Gestos:['👋','🤚','✋','👌','🤌','👍','👎','👏','🙌','🙏','🤝','💪','✍️','👀','🗣️','👨‍👩‍👧','👩‍🎓','👨‍🎓'],
  Símbolos:['❤️','🧡','💛','💚','💙','💜','🤍','✨','⭐','🌟','🎉','🎊','🎓','📚','🏫','📅','⏰','📞','💬','✅','❌','❗','❓','☀️','🌈']
};

export default function Chat({mensajes,ventanaHasta,habilitado,activo,ahora,enviar,contacto,onRenombrar,mobileOpen,onMobileClose}:{
  mensajes:MensajeChat[];ventanaHasta:string;habilitado:boolean;activo:boolean;ahora:number;contacto:string;
  mobileOpen:boolean;onMobileClose:()=>void;onRenombrar:(nombre:string)=>Promise<void>;
  enviar:(texto:string,clave:string)=>Promise<void>;
}){
  const [texto,setTexto]=useState(''),[enviando,setEnviando]=useState(false),[error,setError]=useState('');
  const [emojiAbierto,setEmojiAbierto]=useState(false),[categoria,setCategoria]=useState<keyof typeof emojis>('Caras');
  const clave=useRef<string|null>(null),lista=useRef<HTMLDivElement|null>(null),volver=useRef<HTMLButtonElement|null>(null),estabaAbajo=useRef(true),envioEnCurso=useRef(false);
  const entrada=useRef<HTMLTextAreaElement|null>(null),selectorEmoji=useRef<HTMLDivElement|null>(null);
  const ventanaAbierta=Boolean(ventanaHasta && new Date(ventanaHasta).getTime()>ahora);
  useEffect(()=>{
    const caja=lista.current;
    if(caja && estabaAbajo.current)caja.scrollTop=caja.scrollHeight;
  },[mensajes]);
  useEffect(()=>{
    if(!mobileOpen)return;
    const frame=requestAnimationFrame(()=>{if(lista.current)lista.current.scrollTop=lista.current.scrollHeight;volver.current?.focus()});
    return()=>cancelAnimationFrame(frame);
  },[mobileOpen]);
  useEffect(()=>{
    if(!emojiAbierto)return;
    const cerrar=(e:PointerEvent)=>{if(e.target instanceof Node && !selectorEmoji.current?.contains(e.target))setEmojiAbierto(false)};
    const tecla=(e:KeyboardEvent)=>{if(e.key==='Escape')setEmojiAbierto(false)};
    document.addEventListener('pointerdown',cerrar);document.addEventListener('keydown',tecla);
    return()=>{document.removeEventListener('pointerdown',cerrar);document.removeEventListener('keydown',tecla)};
  },[emojiAbierto]);
  function insertarEmoji(emoji:string){
    const campo=entrada.current;
    if(!campo || texto.length+emoji.length>4000)return;
    const inicio=campo.selectionStart,fin=campo.selectionEnd;
    setTexto(texto.slice(0,inicio)+emoji+texto.slice(fin));clave.current=null;setError('');
    requestAnimationFrame(()=>{campo.focus();campo.setSelectionRange(inicio+emoji.length,inicio+emoji.length)});
  }
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
  return <section className="panel chat-panel" aria-label="Conversación de WhatsApp" role={mobileOpen?'dialog':undefined} aria-modal={mobileOpen||undefined} onKeyDown={e=>{if(e.key==='Escape'&&emojiAbierto){e.stopPropagation();setEmojiAbierto(false)}}}>
    <div className="panel-head chat-head"><button ref={volver} className="chat-mobile-back" type="button" onClick={onMobileClose} aria-label="Volver al detalle de la solicitud"><ArrowLeft size={20}/></button><div className="chat-head-title"><h2 className="chat-desktop-title">Conversación de WhatsApp</h2><NombreContacto nombre={contacto} onGuardar={onRenombrar} compacto/><p>Desde el número oficial de Boston</p></div><span className="chat-head-mark" aria-hidden="true">BBS</span></div>
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
      <div className="chat-compose-row"><div className="chat-input-wrap"><textarea ref={entrada} id="mensaje-chat" className="textarea" maxLength={4000} rows={2}
        value={texto} onChange={e=>{setTexto(e.target.value);clave.current=null;setError('')}}
        onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit()}}}
        disabled={!ventanaAbierta||!activo||!habilitado||enviando} placeholder="Escribe un mensaje para el contacto"/>
        <div ref={selectorEmoji} className="chat-emoji-wrap"><button className="chat-emoji-button" type="button" aria-label="Elegir emoji" aria-expanded={emojiAbierto} disabled={!ventanaAbierta||!activo||!habilitado||enviando} onClick={()=>setEmojiAbierto(v=>!v)}><Smile size={20}/></button>
          {emojiAbierto&&<div className="chat-emoji-picker" role="group" aria-label="Emojis para el mensaje"><div className="chat-emoji-tabs">{(Object.keys(emojis) as (keyof typeof emojis)[]).map(x=><button key={x} type="button" className={categoria===x?'active':''} onClick={()=>setCategoria(x)}>{x}</button>)}</div><div className="chat-emoji-grid">{emojis[categoria].map(x=><button key={x} type="button" aria-label={`Insertar ${x}`} onClick={()=>insertarEmoji(x)}>{x}</button>)}</div></div>}
        </div></div>
        <button className="btn primary" disabled={!texto.trim()||!ventanaAbierta||!activo||!habilitado||enviando} aria-label="Enviar mensaje"><Send size={17}/></button></div>
      <small>{texto.length}/4000</small>
    </form>
  </section>;
}
