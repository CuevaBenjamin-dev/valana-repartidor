const zona='America/Lima';

export default function FechaIngreso({valor,etiqueta=false}:{valor:string;etiqueta?:boolean}){
  const fecha=new Date(valor);
  if(Number.isNaN(fecha.getTime()))return <span>—</span>;
  const dia=new Intl.DateTimeFormat('es-PE',{timeZone:zona,dateStyle:etiqueta?'long':'medium'}).format(fecha);
  const hora=new Intl.DateTimeFormat('es-PE',{timeZone:zona,timeStyle:'short'}).format(fecha);
  return <time className={`fecha-ingreso ${etiqueta?'con-etiqueta':''}`} dateTime={valor}>
    {etiqueta&&<span className="fecha-ingreso-etiqueta">Ingresó</span>}
    <strong>{dia}</strong><span>{hora}</span>
  </time>;
}
