// Inyectar antes de cargar el panel en un contexto de navegador aislado.
// Simula únicamente el transporte; no toca datos reales ni envía mensajes a Meta.
(() => {
  const estado = {
    usuario: { id: 'asesor-auditoria', nombre: 'Asesor Auditoría', correo: 'audit@local', rol: 'asesor' },
    solicitudes: [],
    avisos: [],
    llamadas: {},
    fuentes: [],
    retrasarSolicitudes: 0,
  };
  const pausa = ms => new Promise(resolve => setTimeout(resolve, ms));
  const respuesta = valor => new Response(JSON.stringify(valor), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  window.fetch = async entrada => {
    const ruta = new URL(entrada instanceof Request ? entrada.url : String(entrada), location.href).pathname;
    estado.llamadas[ruta] = (estado.llamadas[ruta] || 0) + 1;
    if (ruta === '/sesion/actual') return respuesta({ usuario: estado.usuario });
    if (ruta === '/solicitudes') {
      const copia = structuredClone(estado.solicitudes);
      if (estado.retrasarSolicitudes) {
        const retraso = estado.retrasarSolicitudes;
        estado.retrasarSolicitudes = 0;
        await pausa(retraso);
      }
      return respuesta(copia);
    }
    if (ruta === '/notificaciones') return respuesta(structuredClone(estado.avisos));
    if (ruta === '/perfil') return respuesta({ disponible: true, presencia_en: new Date().toISOString() });
    return respuesta({ ok: true });
  };
  class FuenteFalsa extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    readyState = FuenteFalsa.CONNECTING;
    constructor() {
      super();
      estado.fuentes.push(this);
      if (!location.search.includes('sin-sse')) setTimeout(() => this.abrir(), 20);
    }
    abrir() {
      if (this.readyState === FuenteFalsa.CLOSED) return;
      this.readyState = FuenteFalsa.OPEN;
      this.onopen?.(new Event('open'));
    }
    cortar(fatal = false) {
      this.readyState = fatal ? FuenteFalsa.CLOSED : FuenteFalsa.CONNECTING;
      this.onerror?.(new Event('error'));
    }
    avisar() { this.dispatchEvent(new Event('actualizar')); }
    close() { this.readyState = FuenteFalsa.CLOSED; }
  }
  window.EventSource = FuenteFalsa;
  window.__auditoriaSse = estado;
})();
