// App de niñeras (fase 1, 26/10/2026): invitación (crear la contraseña desde el link), login con
// el celular, instalar la app y activar los avisos. Textos de docs/fase1/textos.md, sección 3, en
// "tú". Flujo: decisiones.md 6.1.

const NINERA_CUENTA_URL = `${SUPABASE_URL}/functions/v1/ninera-cuenta`;
// Igual a MIN_PASSWORD en la Edge Function ninera-cuenta (cuenta.ts), que también lo controla.
const MIN_PASSWORD_NINERA = 8;
const TEXTO_SIN_CONEXION_CUENTA = 'No pudimos crear tu cuenta. Revisa tu conexión a internet y vuelve a intentar.';
// Error de la Edge Function (26/10/2026): el mismo texto que ERROR_INTERNO en cuenta.ts, por si la
// respuesta llega sin él. Nunca nombra a nadie del equipo: lo lee la niñera.
const TEXTO_ERROR_INTERNO_CUENTA = "No pudimos crear tu cuenta. Avisa al equipo de Parents' Break.";
const TEXTO_SIN_CONEXION_LOGIN = 'No pudimos entrar. Revisa tu conexión a internet y vuelve a intentar.';

/* ---- Invitación: /ninera/?i=<token> ---- */

// Con fetch y no con sbn.functions.invoke: el código de estado dice qué pasó (410 vencido, 403
// cuenta dada de baja...) y invoke lo esconde detrás de un error genérico. Sin conexión, status 0.
async function llamarNineraCuenta(cuerpo){
  try{
    const r = await fetch(NINERA_CUENTA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify(cuerpo),
    });
    let json = {};
    try{ json = (await r.json()) || {}; }catch(e){}
    return { status: r.status, json };
  }catch(e){
    return { status: 0, json: {} };
  }
}

// El link no sirve (vencido, no existe, cuenta dada de baja, celular mal): reintentar no cambia nada.
// Si no es nada de eso, null.
function textoLinkQueNoSirve({ status, json }){
  const error = json && json.error;
  if(error === 'vencido' || status === 410) return 'Este link venció. Solicítale uno nuevo al equipo por WhatsApp.';
  if(error === 'no_existe' || error === 'token' || status === 404) return 'Este link no es válido. Pídele uno nuevo al equipo por WhatsApp.';
  if(error === 'inactiva' || status === 403) return 'Tu cuenta no está activa. Escríbenos por WhatsApp.';
  if(error === 'celular_invalido' || status === 409) return 'Tu número de celular no es válido. Avísale al equipo para corregirlo.';
  return null;
}
// Falla que se puede reintentar (26/10/2026). Sin conexión (status 0) es la conexión; un 500 de la
// función trae su propio texto para la niñera (ERROR_INTERNO en cuenta.ts) y se muestra ese; si no
// lo trae (otro error del servidor), el mismo texto desde acá. Antes un 500 decía "revisa tu
// conexión", y la conexión andaba.
function textoFallaCuenta({ status, json }){
  if(!status) return TEXTO_SIN_CONEXION_CUENTA;
  const error = json && json.error;
  if(status === 500 && typeof error === 'string' && error.trim()) return error;
  return TEXTO_ERROR_INTERNO_CUENTA;
}
function textoErrorInvitacion(r){
  return textoLinkQueNoSirve(r) || textoFallaCuenta(r);
}

async function pantallaInvitacion(token){
  marcarRuta('#invitacion');
  mostrarCargaNinera();
  const r = await llamarNineraCuenta({ token });
  if(r.status !== 200 || typeof r.json.nombre !== 'string'){ pantallaErrorInvitacion(r); return; }
  const nombre = escaparHtml(r.json.nombre);
  // Link para cambiar la contraseña (la cuenta ya existe): otro título y otro texto. Textos
  // provisorios (27/10/2026), a confirmar por Paulina y Delfina.
  const titulo = r.json.es_reset ? 'Crea una contraseña nueva' : "Te invitamos a Parents' Break";
  const texto = r.json.es_reset
    ? `${nombre ? `${nombre}, con` : 'Con'} esta contraseña vas a entrar a la app de Parents' Break.`
    : `${nombre ? `${nombre}, desde ahora` : 'Desde ahora'} los pedidos te llegarán por aquí en vez de por WhatsApp.`;
  const celular = r.json.celular_mascarado
    ? `<p class="helper">Entrarás con tu celular ${escaparHtml(r.json.celular_mascarado)} y esta contraseña.</p>` : '';
  pintar(`<main class="pantalla">
    <img src="../logo.png" alt="Parents’ Break" class="pantalla-logo">
    <h1>${titulo}</h1>
    <p class="intro">${texto}</p>
    <div class="field">
      <label for="inv-pass">Crea una contraseña</label>
      <input type="password" id="inv-pass" autocomplete="new-password">
      <div class="helper">Mínimo 8 letras o números.</div>
    </div>
    <div class="field">
      <label for="inv-pass2">Repite la contraseña</label>
      <input type="password" id="inv-pass2" autocomplete="new-password">
    </div>
    ${celular}
    <div id="inv-error" class="error-form" role="alert"></div>
    <button class="btn primary ancho" id="inv-btn" onclick="conGuardado(this, ()=>crearCuentaDesdeInvitacion(${argJs(token)}))">Guardar contraseña</button>
  </main>`);
  document.getElementById('inv-pass2').addEventListener('keydown', e => { if(e.key === 'Enter') document.getElementById('inv-btn')?.click(); });
}

// Link que no sirve. Salvo la cuenta dada de baja, deja ir al login: quien ya creó su cuenta y
// vuelve a tocar el link del WhatsApp no queda trabada en "venció".
function pantallaErrorInvitacion(r){
  const texto = textoErrorInvitacion(r);
  const reintentar = !textoLinkQueNoSirve(r)
    ? '<button class="btn primary ancho" onclick="location.reload()">Reintentar</button>' : '';
  const entrar = (r.json && r.json.error === 'inactiva') || r.status === 403
    ? '' : '<button class="btn ghost ancho" onclick="salirDeInvitacion()">Entrar con mi celular</button>';
  pintarMensajeNinera(texto, reintentar + entrar);
}

function salirDeInvitacion(){
  history.replaceState(null, '', location.pathname);
  return arrancarSinInvitacion();
}

async function crearCuentaDesdeInvitacion(token){
  const pass = document.getElementById('inv-pass')?.value || '';
  const pass2 = document.getElementById('inv-pass2')?.value || '';
  const avisar = texto => { const el = document.getElementById('inv-error'); if(el) el.textContent = texto; };
  avisar('');
  if(pass.trim().length < MIN_PASSWORD_NINERA){ avisar('Mínimo 8 letras o números.'); return; }
  if(pass !== pass2){ avisar('Las contraseñas no coinciden.'); return; }
  const r = await llamarNineraCuenta({ token, password: pass });
  if(r.status !== 200 || !r.json.celular){
    if(r.json.error === 'password_corta'){ avisar('Mínimo 8 letras o números.'); return; }
    // Sin conexión o error del servidor: el formulario queda con lo escrito para reintentar.
    if(!textoLinkQueNoSirve(r)){ avisar(textoFallaCuenta(r)); return; }
    pantallaErrorInvitacion(r);
    return;
  }
  // La cuenta ya está: el link no sirve más y sale de la URL (al recargar no vuelve a la invitación).
  history.replaceState(null, '', location.pathname);
  let resultado;
  try{ resultado = await sbn.auth.signInWithPassword({ email: mailSinteticoNinera(r.json.celular), password: pass }); }
  catch(e){ resultado = { error: e }; }
  const { data, error } = resultado;
  if(error || !data || !data.session){
    console.error('[invitación] entrar después de crear la cuenta', error);
    pantallaLogin();
    mostrarErrorLogin(textoErrorLogin(error));
    return;
  }
  sesionNinera = data.session;
  await seguirConSesionNinera();
}

/* ---- Login con el celular (decisiones.md 5.2) ----
   La niñera escribe el celular como quiera; la app lo normaliza y entra con el mail sintético. */

function pantallaLogin(){
  marcarRuta('#login');
  pintar(`<main class="pantalla">
    <img src="../logo.png" alt="Parents’ Break" class="pantalla-logo">
    <h1>Entra a tu cuenta</h1>
    <div class="field">
      <label for="login-celular">Celular</label>
      <input type="tel" id="login-celular" autocomplete="username" inputmode="tel">
    </div>
    <div class="field">
      <label for="login-pass">Contraseña</label>
      <input type="password" id="login-pass" autocomplete="current-password">
    </div>
    <div id="login-error" class="error-form" role="alert"></div>
    <button class="btn primary ancho" id="login-btn" onclick="entrarNinera()">Entrar</button>
    <button type="button" class="link-boton" onclick="olvideContrasena()">¿Olvidaste tu contraseña?</button>
    <p id="login-olvide" class="helper" aria-live="polite"></p>
  </main>`);
  document.getElementById('login-pass').addEventListener('keydown', e => { if(e.key === 'Enter') entrarNinera(); });
}

function mostrarErrorLogin(texto){
  const el = document.getElementById('login-error');
  if(el) el.textContent = texto;
}
function textoErrorLogin(error){
  // 429: Supabase frena los logins seguidos desde el mismo lugar; no es la contraseña.
  if(error && error.status === 429) return 'Demasiados intentos. Espera un minuto y vuelve a intentar.';
  return esErrorDeRedAuth(error) ? TEXTO_SIN_CONEXION_LOGIN : 'El celular o la contraseña no son correctos';
}

// Maneja su botón por su cuenta, como el login del panel: deshabilitado y "Entrando…" mientras
// tanto (un segundo toque no hace nada), y vuelve a "Entrar" si no pudo.
async function entrarNinera(){
  const btn = document.getElementById('login-btn');
  if(!btn || btn.disabled) return;
  const celular = normalizarCelular(document.getElementById('login-celular').value);
  const password = document.getElementById('login-pass').value;
  mostrarErrorLogin('');
  if(!celular){ mostrarErrorLogin('Revisa el número de celular'); return; }
  if(!password){ mostrarErrorLogin('Escribe tu contraseña'); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Entrando…';
  let resultado;
  try{ resultado = await sbn.auth.signInWithPassword({ email: mailSinteticoNinera(celular), password }); }
  catch(e){ resultado = { error: e }; }
  const { data, error } = resultado;
  if(error || !data || !data.session){
    btn.disabled = false;
    btn.textContent = 'Entrar';
    mostrarErrorLogin(textoErrorLogin(error));
    return;
  }
  sesionNinera = data.session;
  await seguirConSesionNinera();
}

// Sin mails: la contraseña nueva se crea con un link que manda el equipo (el mismo de la invitación).
function olvideContrasena(){
  const el = document.getElementById('login-olvide');
  if(el) el.textContent = 'Pídele un link nuevo al equipo por WhatsApp.';
}

// Con su propia ruta: si quedaba la de antes (#login), cerrar sesión no volvía a pintar el login.
// También lo dice el chat si la dan de baja con el hilo abierto (chat.js, 30/10/2026).
const CUENTA_NO_ACTIVA = 'Tu cuenta no está activa. Escríbenos por WhatsApp.';

function pantallaCuentaInactiva(){
  marcarRuta('#inactiva');
  pintarMensajeNinera(CUENTA_NO_ACTIVA,
    '<button class="btn ghost ancho" onclick="conGuardado(this, ()=>cerrarSesionNinera())">Cerrar sesión</button>');
}

// scope 'local' (regla del panel, 21/10/2026): cierra solo este celular. Si no se pudo (sin
// conexión), supabase-js deja la sesión abierta: se avisa y no se muestra el login como si nada.
// Si se cerró, el login se pinta siempre, aunque el aviso de SIGNED_OUT ya lo haya hecho.
// Antes, los avisos de este celular (30/10/2026): ver quitarAvisosDeEsteCelular.
async function cerrarSesionNinera(){
  await quitarAvisosDeEsteCelular();
  let error = null;
  try{ ({ error } = await sbn.auth.signOut({ scope: 'local' })); }catch(e){ error = e; }
  if(error){
    console.error('[cerrar sesión]', error);
    toast('No pudimos cerrar la sesión. Revisa tu conexión a internet y vuelve a intentar.', 'bad');
    return;
  }
  sesionNinera = null;
  // Otra cuenta (o la misma) que entre después vuelve a ver la pantalla obligatoria de avisos.
  avisosSalteadosEstaVez = false;
  // Los avisos de pedidos cerrados que quedaban a la vista son de esa cuenta (pedido.js).
  avisosCierreNinera = new Map();
  cerrarModalNinera();
  pantallaLogin();
}

// Al cerrar sesión (revisión final de la etapa 3, 30/10/2026): con un celular compartido, la fila de
// push_subscriptions quedaba con el user_id de la primera niñera y la segunda no podía guardar la suya
// (la RLS no deja pisar una fila ajena): veía un error de conexión y le llegaban los avisos de la
// otra. Se borra la fila de este celular por endpoint (antes del signOut: sin sesión la RLS no deja),
// se desuscribe y se borra la marca de avisos guardados. Cada paso por su cuenta y nada frena el
// cierre de sesión: si el borrado falla, la desuscripción hace que el endpoint venza (410) y
// enviar-avisos borra la fila la próxima vez que intente mandarle algo.
async function quitarAvisosDeEsteCelular(){
  borrarLocalNinera('pb-ninera-push-guardado');
  if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  let sub = null;
  try{
    const reg = await navigator.serviceWorker.getRegistration(NINERA_URL_BASE);
    if(reg && reg.scope === NINERA_URL_BASE) sub = await reg.pushManager.getSubscription();
  }catch(e){ console.error('[cerrar sesión] suscripción', e); }
  if(!sub) return;
  try{
    const { error } = await sbn.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    if(error) console.error('[cerrar sesión] borrar la suscripción', error);
  }catch(e){ console.error('[cerrar sesión] borrar la suscripción', e); }
  try{ await sub.unsubscribe(); }catch(e){ console.error('[cerrar sesión] desuscribir', e); }
}

/* ---- Instalar la app ---- */

function esAppInstalada(){
  return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

// En el iPhone los avisos solo llegan con la app agregada a la pantalla de inicio. "Copiar el link"
// es para cuando el link se abrió dentro de WhatsApp y hay que pasarlo a Safari. La app instalada
// no comparte la sesión con Safari: ahí hay que volver a entrar (27/10/2026).
function pantallaInstalar(){
  marcarRuta('#instalar');
  pintar(`<main class="pantalla">
    <img src="../logo.png" alt="Parents’ Break" class="pantalla-logo">
    <h1>Instala la app para recibir los pedidos</h1>
    <ol class="pasos">
      <li>Abre este link en Safari o en tu navegador.</li>
      <li>Toca Compartir.</li>
      <li>Agregar a pantalla de inicio.</li>
      <li>Abre Parents' Break desde el ícono.</li>
    </ol>
    <p class="intro">Después de instalarla, entra con tu celular y la contraseña que creaste.</p>
    <button class="btn ghost ancho" onclick="copiarAlPortapapeles(${argJs(NINERA_URL_BASE)}, 'Link copiado.')">Copiar el link</button>
    <p class="helper">Con Android alcanza con tocar "Instalar" cuando aparezca.</p>
    <button class="btn primary ancho" onclick="continuarDespuesDeInstalar()">Ya la instalé</button>
  </main>`);
}

/* ---- Avisos (push) ----
   Cada puerta tiene su service worker y su suscripción: la de la niñera va en el registro de
   ninera/sw.js y se guarda con su user_id (decisiones.md 5.1 y 5.4). */

function avisosSoportados(){
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// El registro de ninera/sw.js (alcance ninera/), nunca el del panel. navigator.serviceWorker.ready
// devuelve el registro que corresponde a la página, y si este todavía no estaba registrado ese es
// el del panel (alcance: todo el sitio): la suscripción de la niñera habría quedado en el de admins.
async function registroAvisosNinera(){
  const reg = await navigator.serviceWorker.register('sw.js');
  if(reg.active) return reg;
  const sw = reg.installing || reg.waiting;
  if(sw){
    await new Promise(listo => {
      const tope = setTimeout(listo, 10000);
      sw.addEventListener('statechange', () => { if(sw.state === 'activated'){ clearTimeout(tope); listo(); } });
    });
  }
  return reg;
}

// Marca de este celular: la suscripción que quedó guardada en la base, y de qué cuenta.
function marcaAvisosNinera(endpoint){ return `${sesionNinera ? sesionNinera.user.id : ''}|${endpoint}`; }

// true si hay permiso, el registro de la app de niñeras tiene una suscripción y esa suscripción
// quedó guardada en la base desde este celular para esta cuenta. Si el guardado falló, o entró
// otra cuenta en el mismo celular, el inicio sigue diciendo que están apagados para reintentarlo.
async function avisosActivados(){
  if(!avisosSoportados() || Notification.permission !== 'granted') return false;
  try{
    const reg = await navigator.serviceWorker.getRegistration(NINERA_URL_BASE);
    if(!reg || reg.scope !== NINERA_URL_BASE) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub && leerLocalNinera('pb-ninera-push-guardado') === marcaAvisosNinera(sub.endpoint);
  }catch(e){ return false; }
}

// En memoria, no en localStorage (31/10/2026): "Seguir sin avisos" vale solo hasta cerrar o recargar la
// app. Cada vez que entra con los avisos apagados se le vuelve a pedir que los active.
let avisosSalteadosEstaVez = false;

function pantallaAvisos(){
  marcarRuta('#avisos');
  // Con el permiso ya bloqueado, pedirlo de nuevo no hace nada: va directo a los pasos de Ajustes.
  if(avisosSoportados() && Notification.permission === 'denied'){ pantallaAvisosBloqueados(); return; }
  // Los avisos son obligatorios al entrar (etapa 9, 31/10/2026): sin "Ahora no" ni salida a la vista.
  // El link "Seguir sin avisos" aparece recién si activarlos falló por otra cosa que el permiso
  // (conexión, base, suscripción): así una falla de red nunca la deja atrapada.
  pintar(`<main class="pantalla">
    <img src="../logo.png" alt="Parents’ Break" class="pantalla-logo">
    <h1>Activa los avisos</h1>
    <p class="intro">Te avisaremos cuando haya un pedido, cuando quedes seleccionada y antes de tu sitting. Sin avisos te vas a perder pedidos.</p>
    <button class="btn primary ancho" onclick="conGuardado(this, ()=>activarAvisosDesdePantalla())">Activar avisos</button>
    <div id="avisos-salida"></div>
  </main>`);
}

// Permiso bloqueado en el celular: los pasos para activarlos desde Ajustes (misma ruta #avisos).
function pantallaAvisosBloqueados(){
  marcarRuta('#avisos');
  pintar(`<main class="pantalla">
    <img src="../logo.png" alt="Parents’ Break" class="pantalla-logo">
    <h1>Los avisos están bloqueados</h1>
    <p class="intro">Para recibir tus pedidos, actívalos desde los Ajustes de tu celular.</p>
    <p class="intro"><strong>iPhone:</strong> Ajustes &gt; Notificaciones &gt; Parents' Break &gt; Permitir notificaciones.</p>
    <p class="intro"><strong>Android:</strong> mantén apretado el ícono de la app &gt; Información de la app &gt; Notificaciones &gt; actívalas.</p>
    <button class="btn primary ancho" onclick="conGuardado(this, ()=>reintentarAvisosNinera())">Ya los activé</button>
    <button type="button" class="link-boton" onclick="seguirSinAvisosNinera()">Seguir sin avisos</button>
  </main>`);
}

// "Activar avisos" de la pantalla: si salió bien sigue (perfil o inicio); si el permiso quedó
// bloqueado, los pasos; cualquier otra falla ya la explicó el aviso: se queda para reintentar y
// aparece la salida "Seguir sin avisos".
async function activarAvisosDesdePantalla(){
  const ok = await suscribirAvisosNinera();
  if(ok){
    toast('Avisos activados.');
    return continuarDespuesDeInstalar();
  }
  if(avisosSoportados() && Notification.permission === 'denied'){ pantallaAvisosBloqueados(); return; }
  const salida = document.getElementById('avisos-salida');
  if(salida) salida.innerHTML = '<button type="button" class="link-boton" onclick="seguirSinAvisosNinera()">Seguir sin avisos</button>';
}

// "Ya los activé": vuelve a probar. Si siguen apagados, el aviso lo dice y se queda en los pasos.
async function reintentarAvisosNinera(){
  const ok = await suscribirAvisosNinera();
  if(!ok) return;
  toast('Avisos activados.');
  return continuarDespuesDeInstalar();
}

function seguirSinAvisosNinera(){
  avisosSalteadosEstaVez = true;
  return continuarDespuesDeInstalar();
}

// Pide el permiso, suscribe este celular y guarda la suscripción. Después va a la pantalla
// `despues` (el inicio), haya andado o no: ahí se ve si quedaron apagados. Con el permiso ya
// bloqueado no hay nada que pedir: lleva a los pasos (#avisos).
async function activarAvisosNinera(despues){
  if(avisosSoportados() && Notification.permission === 'denied'){
    await irA('#avisos');
    return false;
  }
  const ok = await suscribirAvisosNinera();
  if(ok) toast('Avisos activados.');
  if(despues) await irA(despues);
  return ok;
}

async function suscribirAvisosNinera(){
  if(!avisosSoportados()){
    toast('Este celular no puede recibir avisos desde el navegador. Instala la app y ábrela desde el ícono.', 'bad');
    return false;
  }
  let permiso = 'default';
  try{ permiso = await Notification.requestPermission(); }catch(e){}
  if(permiso !== 'granted'){
    toast('Los avisos siguen apagados. Actívalos en Ajustes.', 'bad');
    return false;
  }
  try{
    const reg = await registroAvisosNinera();
    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    }
    const json = sub.toJSON();
    // No pasa por sbGuardar: su aviso de error está en voseo (es del panel). Mismo control: si la
    // base no lo guardó, no hay éxito.
    const { error } = await sbn.from('push_subscriptions').upsert({
      usuario: sesionNinera.user.email,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth_key: json.keys.auth,
      user_id: sesionNinera.user.id,
    }, { onConflict: 'endpoint' });
    if(error) throw error;
    guardarLocalNinera('pb-ninera-push-guardado', marcaAvisosNinera(json.endpoint));
    return true;
  }catch(e){
    console.error('[avisos]', e);
    toast('No pudimos activar los avisos. Revisa tu conexión a internet y vuelve a intentar.', 'bad');
    return false;
  }
}
