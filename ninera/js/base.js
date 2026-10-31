// App de niñeras (fase 1, 26/10/2026): cliente de Supabase con su propia sesión, navegación por
// hash, pantalla de carga, errores y el modal. Lo usan cuenta.js, inicio.js y arranque.js.
// Los textos de esta app van en "tú" (docs/fase1/textos.md), no en voseo como el panel.

// Cliente propio con OTRA clave de sesión ('sb-ninera-auth'). Las dos puertas comparten origen y
// localStorage: sin esto, la socia que tiene cuenta de admin y de niñera abriría una con la sesión
// de la otra (decisiones.md 5.1). Solo la clave publicable: lo que ve cada niñera lo decide la
// base. Si supabase-js no cargó, sbn queda en null y bootNinera lo avisa (como el panel).
const sbn = window.supabase ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage, storageKey: 'sb-ninera-auth' },
}) : null;
let sesionNinera = null;
// El id de su ficha, de ninera_actual() al entrar (arranque.js): el chat filtra su canal de Realtime
// con eso (30/10/2026), sin otra consulta.
let nineraIdSesion = null;

// La carpeta de la app (…/ninera/), resuelta desde donde se abrió: en GitHub Pages vive dentro del
// subpath del repo. Es el link para abrir en Safari y el alcance de su service worker.
const NINERA_URL_BASE = new URL('./', location.href).href;

// localStorage puede no estar (modo privado, datos borrados): nada de lo que se guarda acá es
// imprescindible, así que si falla se sigue sin eso.
function leerLocalNinera(clave){ try{ return localStorage.getItem(clave); }catch(e){ return null; } }
function guardarLocalNinera(clave, valor){ try{ localStorage.setItem(clave, valor); }catch(e){} }
function borrarLocalNinera(clave){ try{ localStorage.removeItem(clave); }catch(e){} }

// Lee la sesión que supabase-js guarda bajo 'sb-ninera-auth', con el mismo criterio que
// leerSesionGuardada() del panel (auth.js). Solo sirve para decidir qué pintar primero: sin
// sesión guardada, el login sale al instante, sin esperar a supabase-js.
function leerSesionNineraGuardada(){
  try{
    const raw = localStorage.getItem('sb-ninera-auth');
    if(!raw) return null;
    const s = JSON.parse(raw);
    return (s && s.user && s.refresh_token) ? s : null;
  }catch(e){ return null; }
}

// Lo que la pantalla abierta deja para hacer cuando se va de ella (30/10/2026): el chat quita su canal
// de Realtime. Pasa por acá porque toda pantalla se pinta con pintar(), también el login si la
// sesión se cierra o el error que no deja seguir.
let alSalirDePantallaNinera = null;
function pintar(html){
  if(alSalirDePantallaNinera){
    const salir = alSalirDePantallaNinera;
    alSalirDePantallaNinera = null;
    try{ salir(); }catch(e){ console.error('[pantalla] al salir', e); }
  }
  const app = document.getElementById('app');
  if(app) app.innerHTML = html;
}

// La misma pantalla de carga de index.html (el símbolo latiendo). Si ya está, solo cambia el texto.
function mostrarCargaNinera(msg = 'Cargando…'){
  if(!document.getElementById('pantalla-carga')){
    pintar(`<div class="pantallacarga" id="pantalla-carga" role="status" aria-live="polite">
      <img src="../logo-simbolo.png" alt="Parents’ Break" class="pantallacarga-simbolo simbolo-latido">
      <div class="pantallacarga-msg" id="pantallacarga-msg"></div>
    </div>`);
  }
  const el = document.getElementById('pantallacarga-msg');
  if(el) el.textContent = msg;
}

// Error que no deja seguir: el título y el detalle, y "Reintentar" vuelve a cargar todo. Con su
// propia ruta (#error), como cada pantalla.
function mostrarErrorNinera(titulo, detalle){
  marcarRuta('#error');
  pintar(`<div class="pantallacarga" id="pantalla-error" role="alert">
    <img src="../logo.png" alt="Parents’ Break" class="pantallacarga-logo">
    <div class="pantallacarga-msg"><b>${escaparHtml(titulo)}</b> ${escaparHtml(detalle)}</div>
    <button class="btn primary" onclick="location.reload()">Reintentar</button>
  </div>`);
}

// Pantalla con un solo mensaje (link vencido, cuenta no activa) y los botones que correspondan.
function pintarMensajeNinera(texto, acciones = ''){
  pintar(`<main class="pantalla pantalla-mensaje">
    <img src="../logo.png" alt="Parents’ Break" class="pantalla-logo">
    <p class="mensaje" role="alert">${escaparHtml(texto)}</p>
    ${acciones}
  </main>`);
}

/* ---- Navegación por hash: #inicio, #login, #invitacion, #instalar, #avisos, #perfil, #chat, #mis-avisos, #temporada, #inactiva, #error ----
   La URL dice en qué pantalla está. Se cambia con replaceState, sin sumar pasos al historial:
   "Atrás" en el celular no tiene que volver a una pantalla vieja (el login después de entrar). */
function marcarRuta(hash){
  if(location.hash !== hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
}
function rutaActual(){ return location.hash; }
function irA(hash){
  // #avisos es la pantalla para activar los avisos del celular; #mis-avisos, la lista (etapa 3).
  const pantallas = { '#inicio': renderInicio, '#login': pantallaLogin, '#instalar': pantallaInstalar, '#avisos': pantallaAvisos, '#perfil': abrirMiPerfil,
    '#chat': pantallaChatNinera, '#mis-avisos': pantallaAvisosNinera, '#temporada': pantallaTemporadaNinera };
  return pantallas[hash] ? pantallas[hash]() : undefined;
}

// Un error de auth que no es "datos mal" (sin conexión, servidor caído): supabase-js lo devuelve
// sin status o con 5xx (AuthRetryableFetchError).
function esErrorDeRedAuth(error){
  return !error || !error.status || error.status >= 500 || error.name === 'AuthRetryableFetchError';
}

/* ---- Modal mínimo (copiar a mano, Mi cuenta) ----
   copiarAlPortapapeles (js/comun.js) lo usa cuando el navegador no deja copiar. Mismo aspecto que
   el del panel (confirmoverlay / confirmbox), sin borradores: acá no hay formularios largos. */
function abrirModalNinera(html){
  cerrarModalNinera();
  const overlay = document.createElement('div');
  overlay.className = 'confirmoverlay';
  overlay.id = 'modal-ninera';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `<div class="confirmbox"><button type="button" class="modal-close" onclick="cerrarModalNinera()" aria-label="Cerrar">×</button>${html}</div>`;
  overlay.addEventListener('click', e => { if(e.target === overlay) cerrarModalNinera(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
}
function cerrarModalNinera(){
  const overlay = document.getElementById('modal-ninera');
  if(overlay) overlay.remove();
}
