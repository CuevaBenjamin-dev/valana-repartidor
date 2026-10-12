export interface Opcion { id:string; numero:number; identificador:string; nombre:string; equipo_id:string; }
export function normalizar(texto:string):string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
}
export function interpretarOpcion(texto:string, opciones:Opcion[], identificador?:string):Opcion|undefined {
  if (identificador) return opciones.find(o=>o.identificador===identificador || o.id===identificador);
  const entrada=normalizar(texto);
  const numero=entrada.match(/^(\d+)\.?\s*(.*)$/);
  if (numero) {
    const opcion=opciones.find(o=>o.numero===Number(numero[1]));
    if (opcion && (!numero[2] || numero[2]===normalizar(opcion.nombre))) return opcion;
    return undefined;
  }
  return opciones.find(o=>normalizar(o.nombre)===entrada);
}
export function textoMenu(cabecera:string,opciones:Opcion[]):string {
  return `${cabecera}\n\n${opciones.map(o=>`${o.numero}. ${o.nombre}`).join('\n')}`;
}
