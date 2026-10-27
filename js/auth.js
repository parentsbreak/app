/* ================= AUTH ================= */
let session = null;
let modoRecuperacion = false;
// Mientras esta bandera está en true, renderRoot() no pinta ni el login ni la app — se está
// mostrando alguna pantalla obligatoria de la cadena post-login (cambio de contraseña
// forzado y/o Face ID/Touch ID), aunque ya haya una sesión válida de por medio.
let faceidPendiente = false;
// IMPORTANTE: además de la bandera de arriba (que solo vive en memoria y se pierde al
// recargar), esto mismo se guarda en localStorage bajo esta clave. Sin esto, cerrar la
// pestaña/app ANTES de terminar el paso obligatorio y volver a abrirla esquivaba el paso
// por completo — la sesión de Supabase ya queda guardada y válida desde el login con
// contraseña, así que solo una bandera en memoria no alcanza para bloquear nada de verdad.
// Se guarda ni bien arranca la cadena de pasos obligatorios, y se borra recién cuando el
// último paso pendiente (cambio de contraseña y/o Face ID) termina de verdad.
const LS_POST_LOGIN_PENDIENTE = 'pb_post_login_pendiente';
// true cuando se entró por el link de "acceso temporal por mail" (ver más abajo) — esa
// sesión NO pasa por el paso obligatorio de Face ID/Touch ID a propósito (es justamente el
// camino para cuando no tenés tu dispositivo con Face ID a mano), así que se cierra sola al
// salir de la pestaña, para no dejar un acceso permanente en un dispositivo prestado/ajeno.
let esAccesoTemporal = false;
// Face ID / Touch ID vía Passkeys (WebAuthn): funciona en cualquier navegador/dispositivo
// moderno que lo soporte (iPhone con Face ID incluido). No manda ninguna foto/biometría a
// ningún servidor — la verificación queda 100% en el dispositivo, Supabase solo recibe la
// confirmación firmada de que pasó.
const PASSKEY_SOPORTADO = typeof window !== 'undefined' && !!window.PublicKeyCredential;
function marcarPostLoginPendiente(){ faceidPendiente = true; try{ localStorage.setItem(LS_POST_LOGIN_PENDIENTE,'1'); }catch(e){} }
function limpiarPostLoginPendiente(){ faceidPendiente = false; try{ localStorage.removeItem(LS_POST_LOGIN_PENDIENTE); }catch(e){} }
async function boot(){
  if(!sb){
    mostrarErrorArranque('No se pudo conectar con el sistema',
      'No cargó la librería de conexión con la base (supabase-js). Revisá que haya internet y tocá Reintentar. Si sigue pasando, avisale a Diego.');
    return;
  }
  try{
    await arrancar();
  }catch(e){
    console.error('[boot]', e);
    // Si la app ya se pintó con la sesión guardada, no se tapa: el error queda en la consola.
    if(document.getElementById('pantalla-carga') || !document.getElementById('modcontent')){
      mostrarErrorArranque('No se pudo abrir el sistema', 'Puede ser la conexión. Tocá Reintentar; si sigue pasando, avisale a Diego.');
    }
  }
}
async function arrancar(){
  if(new URLSearchParams(window.location.search).get('acceso') === 'temporal'){
    esAccesoTemporal = true;
    window.addEventListener('beforeunload', ()=>{ sb.auth.signOut({ scope: 'local' }); });
    // Limpiamos el ?acceso=temporal de la URL visible, sin recargar la página.
    window.history.replaceState({}, '', window.location.pathname);
  }
  // Arranque rápido: si en este dispositivo ya hay una sesión guardada, se pinta la app al
  // toque con esa sesión, sin esperar a getSession(). Cuando la app estuvo más de una hora sin
  // abrirse, getSession() primero renueva el token contra Supabase (0,8 s de promedio, hasta
  // 1,4 s, medido en los logs del 29/09/2026) y durante todo ese rato la pantalla quedaba en
  // blanco. Las consultas que dispara la app ya pintada esperan solas a que termine esa
  // renovación (supabase-js las encola), así que no salen con un token vencido. Si al final
  // la sesión resulta no ser válida, más abajo se pasa al login como siempre.
  let pendienteGuardadoAntes = false;
  try{ pendienteGuardadoAntes = localStorage.getItem(LS_POST_LOGIN_PENDIENTE) === '1'; }catch(e){}
  const hayTokensEnUrl = /access_token=|type=recovery|[?&]code=/.test(window.location.hash + window.location.search);
  const sesionGuardada = (esAccesoTemporal || pendienteGuardadoAntes || hayTokensEnUrl) ? null : leerSesionGuardada();
  if(sesionGuardada){ session = sesionGuardada; renderRoot(); }
  const { data } = await sb.auth.getSession();
  session = data.session;
  const yaPintadaConEstaSesion = !!(sesionGuardada && session && session.user?.id === sesionGuardada.user?.id);
  sb.auth.onAuthStateChange((event, s) => {
    // Sesión cerrada (vencida, o cerrada desde otro dispositivo): lo que se estaba escribiendo
    // queda en su borrador antes de pasar al login, y se ofrece al volver a entrar (21/10/2026).
    if(event === 'SIGNED_OUT'){ guardarBorradoresPendientes(); marcarSinCambios('entrevista'); }
    const mismaSesionQueAntes = !!(session && s && session.user?.id === s.user?.id);
    session = s;
    // INITIAL_SESSION llega apenas se suscribe este listener, con la MISMA sesión que ya
    // trajo getSession() arriba -- y boot() ya pinta la app con esa sesión (renderRoot más
    // abajo). Antes se volvía a pintar todo: cada apertura de la app cargaba Hoy dos veces
    // (todas las consultas duplicadas, visto en los logs de Supabase el 29/09/2026).
    if(event === 'INITIAL_SESSION') return;
    // Supabase también re-emite SIGNED_IN al volver a la pestaña/app con la sesión ya
    // abierta. No es un login nuevo: repintar ahí mandaba de vuelta a Hoy y borraba lo que
    // se estuviera escribiendo. Solo un SIGNED_IN sin sesión previa (login real) repinta.
    if(event === 'SIGNED_IN' && mismaSesionQueAntes) return;
    // TOKEN_REFRESHED es una renovación silenciosa del token de sesión que pasa sola cada
    // tanto, incluso con la app en foco y en uso -- no cambia qué hay que mostrar en pantalla,
    // así que no se vuelve a pintar nada. Antes SÍ disparaba renderRoot() -> renderApp(), que
    // reescribe toda la app desde cero -- si pasaba mientras alguien completaba un formulario
    // largo (ej. una entrevista), se perdía todo lo tipeado sin ningún aviso. Segunda causa
    // real de pérdida de datos encontrada el 22/09/2026 (junto con el refresh forzado de
    // visibilitychange en bootstrap.js, ya sacado).
    if(event === 'TOKEN_REFRESHED') return;
    if(event === 'SIGNED_IN'){
      moduloActivo = null; // cada login nuevo arranca limpio en "Hoy"
      if(esAccesoTemporal) toast('Entraste con acceso temporal — esta sesión se cierra sola al cerrar esta pestaña.');
    }
    if(event === 'PASSWORD_RECOVERY') modoRecuperacion = true; // vino de un link de "olvidé mi contraseña"
    renderRoot();
  });
  // Si ya hay sesión válida (persistida de un login anterior) Y todavía quedó marcado como
  // pendiente un paso obligatorio sin terminar, retomamos ahí en vez de mostrar la app.
  let pendienteGuardado = false;
  try{ pendienteGuardado = localStorage.getItem(LS_POST_LOGIN_PENDIENTE) === '1'; }catch(e){}
  if(session && pendienteGuardado){
    faceidPendiente = true;
    await continuarPostLogin();
  } else if(!yaPintadaConEstaSesion){
    renderRoot(); // no había sesión guardada, o la guardada ya no sirve -> login
  }
}
// Lee la sesión que supabase-js guarda en localStorage (misma clave que usa la librería:
// sb-<ref del proyecto>-auth-token). Solo se usa para decidir qué pintar primero; la sesión
// real y vigente la sigue manejando supabase-js.
function leerSesionGuardada(){
  try{
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if(!raw) return null;
    const s = JSON.parse(raw);
    return (s && s.user && s.refresh_token) ? s : null;
  }catch(e){ return null; }
}
function renderRoot(){
  if(faceidPendiente) return; // ya se está mostrando la pantalla obligatoria, no la pisamos
  if(modoRecuperacion){ renderNuevaContrasena(); return; }
  if(!session){ renderLogin(); return; }
  renderApp();
}
function renderLogin(){
  document.getElementById('app').innerHTML = `
    <div class="loginstage">
      <div class="loginbrand">
        <div class="blob blob-a"></div>
        <div class="blob blob-b"></div>
        <img src="logo.png" alt="Parents’ Break" class="loginbrand-logo">
        <h1>El día a día de tu equipo, en un solo lugar.</h1>
        <p>Candidatas, entrevistas, niñeras activas y tarifas por familia — todo conectado, sin planillas sueltas.</p>
      </div>
      <div class="loginformside">
        <div class="loginwrap">
          <h2>Bienvenida de vuelta</h2>
          <div class="helper">Entrá con tu cuenta de equipo. Se pide Face ID/Touch ID siempre, aunque uses contraseña.</div>
          ${avisoMudanzaLoginHtml()}
          ${PASSKEY_SOPORTADO ? `
          <button class="btn" type="button" id="passkeybtn" style="width:100%;margin-bottom:14px;" onclick="entrarConPasskey()">
            <span id="passkeybtn-label">Entrar con Face ID / Touch ID</span>
          </button>
          <div style="display:flex;align-items:center;gap:10px;margin:2px 0 16px;">
            <div style="flex:1;height:1px;background:var(--line);"></div>
            <span class="helper" style="margin:0;">o con mail y contraseña</span>
            <div style="flex:1;height:1px;background:var(--line);"></div>
          </div>` : ''}
          <div class="field">
            <label>Mail</label>
            <div class="inputicon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg>
              <input type="email" id="login-mail">
            </div>
          </div>
          <div class="field">
            <label>Contraseña</label>
            <div class="inputicon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/></svg>
              <input type="password" id="login-pass">
            </div>
          </div>
          <div style="text-align:right;margin:-8px 0 16px;">
            <a href="#" onclick="event.preventDefault();abrirRecuperarPassword();" style="font-size:12.5px;color:var(--accent);">¿Olvidaste tu contraseña?</a>
            · <a href="#" onclick="event.preventDefault();abrirAccesoTemporal();" style="font-size:12.5px;color:var(--accent);">¿No tenés tu Face ID a mano?</a>
          </div>
          <label class="chk" style="margin-bottom:16px;"><input type="checkbox" id="login-recordar" checked> Recordarme en este dispositivo</label>
          <button class="btn primary" id="loginbtn" style="width:100%;" onclick="login()"><span id="loginbtn-label">Entrar</span></button>
          <div id="loginwarn"></div>
        </div>
      </div>
    </div>`;
  document.getElementById('login-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') login(); });
}
async function login(){
  const email = document.getElementById('login-mail').value.trim();
  const password = document.getElementById('login-pass').value;
  const recordar = document.getElementById('login-recordar').checked;
  const btn = document.getElementById('loginbtn');
  btn.disabled = true;
  document.getElementById('loginbtn-label').innerHTML = `<span class="spinner"></span> Entrando…`;
  // Se levanta la bandera ANTES de terminar el login para que, apenas Supabase dispare el
  // evento SIGNED_IN, renderRoot() no llegue a mostrar la app ni una fracción de segundo
  // antes de terminar la cadena de pasos obligatorios de abajo. Se guarda también en
  // localStorage (ver marcarPostLoginPendiente) para que sobreviva si cierran la pestaña
  // antes de terminar ese paso — si no, era posible saltearse Face ID cerrando y reabriendo.
  marcarPostLoginPendiente();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if(error){
    limpiarPostLoginPendiente();
    btn.disabled = false;
    document.getElementById('loginbtn-label').textContent = 'Entrar';
    document.getElementById('loginwarn').innerHTML = `<div class="warnbox">${error.message==='Invalid login credentials' ? 'Mail o contraseña incorrectos.' : escaparHtml(error.message)}</div>`;
    return;
  }
  if(await frenarCuentaSinAccesoAlPanel()) return;
  // scope 'local' (21/10/2026): solo este dispositivo. Sin eso supabase-js cierra la sesión de
  // esa cuenta en TODOS lados, y cerrar esta pestaña sacaba del sistema a la compu donde se
  // estaba haciendo una entrevista (que se perdía al pasar al login).
  if(!recordar){ window.addEventListener('beforeunload', ()=>{ sb.auth.signOut({ scope: 'local' }); }); }
  // Mientras se revisa Face ID / contraseña pendiente (va a la base), el logo con la ruedita.
  mostrarPantallaCarga('Entrando…');
  await continuarPostLogin();
}
// Cuentas de niñera en el panel (26/10/2026, fase 1): desde que las niñeras tienen usuario, una
// puede escribir su celular y contraseña acá. La RLS ya no le deja ver nada, pero quedaba en una
// pantalla vacía: se le cierra la sesión (solo este dispositivo) y se le dice que entre por su app.
// Solo frena con una respuesta clara de la base (es_usuaria_autorizada = false): si la consulta
// falla o devuelve otra cosa, se sigue como siempre, para no dejar afuera a una admin por un
// problema de conexión. Devuelve true si frenó el login.
async function frenarCuentaSinAccesoAlPanel(){
  const { data: autorizada, error } = await sb.rpc('es_usuaria_autorizada');
  if(error || autorizada !== false) return false;
  const { data: nineraId, error: errNinera } = await sb.rpc('ninera_actual');
  const esNinera = !errNinera && !!nineraId;
  // faceidPendiente sigue prendida durante el signOut: así el SIGNED_OUT no repinta el login
  // (y borra el aviso) antes de tiempo.
  await sb.auth.signOut({ scope: 'local' });
  limpiarPostLoginPendiente();
  if(!document.getElementById('loginwarn')) renderLogin();
  const btn = document.getElementById('loginbtn');
  btn.disabled = false;
  document.getElementById('loginbtn-label').textContent = 'Entrar';
  document.getElementById('loginwarn').innerHTML = esNinera
    ? `<div class="warnbox">Esta cuenta es de niñera. Entrá por la app de niñeras: <a href="ninera/">abrir la app</a></div>`
    : `<div class="warnbox">Esta cuenta no tiene acceso. Avisale a Diego.</div>`;
  return true;
}
// Cadena de pasos obligatorios después de un login con contraseña exitoso: primero cambio
// de contraseña forzado (si esa cuenta lo tiene pendiente), después Face ID/Touch ID (si el
// navegador lo soporta). Se llama de nuevo al terminar cada paso, hasta que no quede ninguno.
async function continuarPostLogin(){
  if(session?.user?.user_metadata?.debe_cambiar_password){
    renderCambioPasswordObligatorio();
    return;
  }
  if(PASSKEY_SOPORTADO){ await exigirConfirmacionBiometrica(); return; }
  limpiarPostLoginPendiente();
  renderRoot();
}
async function entrarConPasskey(){
  const btn = document.getElementById('passkeybtn');
  if(btn){ btn.disabled = true; document.getElementById('passkeybtn-label').innerHTML = `<span class="spinner"></span> Verificando…`; }
  const { error } = await sb.auth.signInWithPasskey();
  if(!error && !session) mostrarPantallaCarga('Entrando…'); // hasta que Supabase avise del login y se pinte la app
  if(error){
    if(btn){ btn.disabled = false; document.getElementById('passkeybtn-label').textContent = 'Entrar con Face ID / Touch ID'; }
    const warn = document.getElementById('loginwarn');
    if(warn) warn.innerHTML = `<div class="warnbox">No se pudo entrar con Face ID / Touch ID en este dispositivo — entrá con mail y contraseña de abajo (te va a volver a pedir la confirmación igual).</div>`;
    return;
  }
  // Face ID ya cumple el requisito de biometría, pero si esta cuenta tiene pendiente un
  // cambio de contraseña forzado (ver login()), igual se lo pedimos antes de entrar.
  if(session?.user?.user_metadata?.debe_cambiar_password){
    marcarPostLoginPendiente();
    renderCambioPasswordObligatorio();
  }
}
// Se llama siempre después de un login con contraseña exitoso (si el navegador soporta
// passkeys). Contraseña sola ya NO alcanza para entrar — decisión explícita de Diego.
async function exigirConfirmacionBiometrica(){
  const { data: passkeys } = await sb.auth.passkey.list();
  if(!passkeys || !passkeys.length){
    // Esta cuenta no tiene ninguna Face ID/Touch ID activada todavía, en ningún
    // dispositivo — se activa ahora mismo, de forma obligatoria.
    renderPantallaBiometrica('registrar');
  } else {
    // Ya existe al menos una passkey para la cuenta (acá o en otro dispositivo) —
    // se exige confirmarla en ESTE dispositivo antes de entrar.
    renderPantallaBiometrica('confirmar');
  }
}
function renderPantallaBiometrica(modo){
  document.getElementById('app').innerHTML = `
    <div class="loginstage">
      <div class="loginbrand">
        <div class="blob blob-a"></div>
        <div class="blob blob-b"></div>
        <img src="logo.png" alt="Parents’ Break" class="loginbrand-logo">
        <h1>Un paso más.</h1>
        <p>${modo==='registrar' ? 'Confirmá tu identidad con Face ID o Touch ID para terminar de entrar. Solo hace falta la primera vez en cada dispositivo.' : 'Confirmá con Face ID o Touch ID para terminar de entrar en este dispositivo.'}</p>
      </div>
      <div class="loginformside">
        <div class="loginwrap" style="text-align:center;">
          <h2>${modo==='registrar' ? 'Activar Face ID / Touch ID' : 'Confirmá que sos vos'}</h2>
          <div class="helper" style="margin-bottom:20px;">${modo==='registrar' ? 'Tu cuenta todavía no tiene ninguna activada — es obligatorio para poder entrar.' : 'Tu cuenta ya tiene Face ID/Touch ID activado — confirmalo en este dispositivo.'}</div>
          <button class="btn primary" id="bio-btn" style="width:100%;margin-bottom:12px;" onclick="${modo==='registrar' ? 'confirmarRegistroBiometria()' : 'confirmarLoginBiometria()'}">
            <span id="bio-btn-label">${modo==='registrar' ? 'Activar ahora' : 'Confirmar con Face ID / Touch ID'}</span>
          </button>
          <button class="btn ghost" style="width:100%;" onclick="cancelarBiometria()">Cancelar y volver al login</button>
          <div id="bio-warn"></div>
        </div>
      </div>
    </div>`;
}
async function confirmarRegistroBiometria(){
  const btn = document.getElementById('bio-btn');
  btn.disabled = true;
  document.getElementById('bio-btn-label').innerHTML = `<span class="spinner"></span> Confirmando…`;
  const { error } = await sb.auth.registerPasskey();
  if(error){
    btn.disabled = false;
    document.getElementById('bio-btn-label').textContent = 'Activar ahora';
    document.getElementById('bio-warn').innerHTML = `<div class="warnbox">${escaparHtml(error.message)} — probá de nuevo.</div>`;
    return;
  }
  toast('Face ID / Touch ID activado.');
  limpiarPostLoginPendiente();
  renderRoot();
}
async function confirmarLoginBiometria(){
  const btn = document.getElementById('bio-btn');
  btn.disabled = true;
  document.getElementById('bio-btn-label').innerHTML = `<span class="spinner"></span> Confirmando…`;
  const { error } = await sb.auth.signInWithPasskey();
  if(error){
    btn.disabled = false;
    document.getElementById('bio-btn-label').textContent = 'Confirmar con Face ID / Touch ID';
    // IMPORTANTE, no tocar: acá NO se ofrece registrar una passkey nueva aunque este
    // dispositivo en particular no tenga ninguna guardada. Si se ofreciera, alcanzaría con
    // robar el mail y la contraseña para activar una cara/huella cualquiera y entrar del
    // todo — justo lo que esto tiene que evitar. Agregar un dispositivo nuevo solo se puede
    // hacer desde adentro de la app (menú → "Face ID / Touch ID"), con una sesión que ya
    // pasó por esta misma pantalla en otro dispositivo.
    const noHayEnEsteDispositivo = /not.?found|no.?credential/i.test(error.message||'');
    document.getElementById('bio-warn').innerHTML = noHayEnEsteDispositivo
      ? `<div class="warnbox">Este dispositivo no tiene Face ID/Touch ID activado para tu cuenta todavía. Tocá "Cancelar y volver al login" de abajo y usá "¿No tenés tu Face ID a mano?" para entrar por mail — una vez adentro, activala acá mismo desde "Face ID / Touch ID" en el menú. (O si tenés a mano el otro dispositivo donde ya la activaste, entrá ahí y hacé lo mismo desde ese lado.)</div>`
      : `<div class="warnbox">${escaparHtml(error.message)} — probá de nuevo.</div>`;
    return;
  }
  limpiarPostLoginPendiente();
  renderRoot();
}
function cancelarBiometria(){
  limpiarPostLoginPendiente();
  sb.auth.signOut({ scope: 'local' }); // solo este dispositivo (ver login)
}
async function registrarPasskeyDispositivo(){
  const { error } = await sb.auth.registerPasskey();
  cerrarModal();
  if(error){ toast('No se pudo activar: '+error.message, 'bad'); return; }
  toast('Face ID / Touch ID activado en este dispositivo.');
}
async function gestionarPasskeys(){
  abrirModal(`<h2 style="margin:0 0 10px;">Face ID / Touch ID</h2><div id="passkeys-list"><div class="empty"><span class="spinner dark"></span> Cargando…</div></div>`);
  const { data: passkeys, error } = await sb.auth.passkey.list();
  const cont = document.getElementById('passkeys-list');
  if(!cont) return; // se cerró el modal mientras cargaba
  if(error){ cont.innerHTML = errBox(error); return; }
  cont.innerHTML = `
    <div class="helper" style="margin-bottom:12px;">Dispositivos con Face ID/Touch ID activado para tu cuenta. Borrá los que ya no uses (por ejemplo, un celular viejo).</div>
    ${!passkeys || !passkeys.length ? '<div class="empty">Todavía no activaste ninguno.</div>' : passkeys.map(p=>`
      <div class="agendarow" style="border-bottom:1px solid var(--line);padding:8px 0;align-items:center;">
        <div style="flex:1;">
          <div>${escaparHtml(p.friendly_name || 'Dispositivo')}</div>
          <div class="helper" style="margin:0;">Activado ${new Date(p.created_at).toLocaleDateString('es-UY',{day:'2-digit',month:'short',year:'numeric'})}</div>
        </div>
        <button class="smallbtn" style="color:var(--bad);border-color:var(--bad);" onclick="conGuardado(this, ()=>eliminarPasskey(${argJs(p.id)}))">Borrar</button>
      </div>`).join('')}
    <button class="btn" type="button" style="width:100%;margin-top:14px;" onclick="conGuardado(this, ()=>registrarPasskeyDispositivo())">+ Activar en este dispositivo</button>`;
}
async function eliminarPasskey(id){
  if(!(await confirmarAccion('¿Borrar este Face ID/Touch ID? Ese dispositivo va a tener que entrar con contraseña.'))) return;
  const { error } = await sb.auth.passkey.delete({ passkeyId: id });
  if(error){ toast('No se pudo borrar: '+error.message, 'bad'); return; }
  toast('Borrado.');
  gestionarPasskeys();
}
/* ---- Recuperar contraseña ---- */
function abrirRecuperarPassword(){
  const emailPrellenado = document.getElementById('login-mail')?.value.trim() || '';
  abrirModal(`
    <h2 style="margin:0 0 10px;">Recuperar contraseña</h2>
    <div class="helper" style="margin-bottom:14px;">Si ese mail está registrado en el sistema, le va a llegar un link para elegir una contraseña nueva.</div>
    <div class="field"><label>Mail</label><input type="email" id="rec-mail" value="${escaparHtml(emailPrellenado)}"></div>
    <div id="rec-warn"></div>
    <div class="confirmbtns" style="margin-top:16px;">
      <button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primary" id="rec-btn" onclick="enviarRecuperacion()"><span id="rec-btn-label">Enviar link</span></button>
    </div>`);
}
async function enviarRecuperacion(){
  const email = document.getElementById('rec-mail').value.trim();
  if(!email){ document.getElementById('rec-warn').innerHTML = `<div class="warnbox">Escribí un mail.</div>`; return; }
  const btn = document.getElementById('rec-btn');
  btn.disabled = true;
  document.getElementById('rec-btn-label').innerHTML = `<span class="spinner"></span> Enviando…`;
  // Ojo: no avisamos acá si el mail existe o no en el sistema — Supabase responde igual en
  // los dos casos a propósito, así nadie puede usar este formulario para descubrir qué mails
  // están registrados en la cuenta.
  await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split('#')[0].split('?')[0] });
  cerrarModal();
  toast('Si ese mail está registrado, le va a llegar un link para elegir una contraseña nueva. Revisá también la carpeta de spam.');
}
/* ---- Acceso temporal por mail (para cuando no tenés tu Face ID a mano) ---- */
function abrirAccesoTemporal(){
  const emailPrellenado = document.getElementById('login-mail')?.value.trim() || '';
  abrirModal(`
    <h2 style="margin:0 0 10px;">Acceso temporal por mail</h2>
    <div class="helper" style="margin-bottom:14px;">Para cuando no tenés a mano el dispositivo con tu Face ID/Touch ID. Te mandamos un link a tu mail — al abrirlo, entrás directo, sin contraseña. Esa sesión se cierra sola al cerrar la pestaña, así que no queda un acceso permanente activado en un dispositivo prestado.</div>
    <div class="field"><label>Mail</label><input type="email" id="temp-mail" value="${escaparHtml(emailPrellenado)}"></div>
    <div id="temp-warn"></div>
    <div class="confirmbtns" style="margin-top:16px;">
      <button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primary" id="temp-btn" onclick="enviarAccesoTemporal()"><span id="temp-btn-label">Enviar link</span></button>
    </div>`);
}
async function enviarAccesoTemporal(){
  const email = document.getElementById('temp-mail').value.trim();
  if(!email){ document.getElementById('temp-warn').innerHTML = `<div class="warnbox">Escribí un mail.</div>`; return; }
  const btn = document.getElementById('temp-btn');
  btn.disabled = true;
  document.getElementById('temp-btn-label').innerHTML = `<span class="spinner"></span> Enviando…`;
  const redirectUrl = window.location.href.split('#')[0].split('?')[0] + '?acceso=temporal';
  // shouldCreateUser: false es clave acá — si no, cualquiera podría escribir un mail
  // cualquiera y crearse una cuenta nueva sola con este formulario. Con esto, solo funciona
  // para mails que YA son una cuenta existente del equipo.
  // No miramos "error" antes de avisar — mismo criterio que en recuperar contraseña: la
  // respuesta tiene que ser igual exista o no ese mail en el sistema, para que este
  // formulario no sirva para averiguar qué mails están registrados.
  await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl, shouldCreateUser: false } });
  cerrarModal();
  toast('Si ese mail está registrado, le va a llegar un link de acceso temporal. Revisá también la carpeta de spam.');
}
// Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo — mismo criterio para
// cualquier contraseña nueva del sistema (cambio obligatorio, recuperación, etc.).
function passwordEsFuerte(p){
  return p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);
}
function renderCambioPasswordObligatorio(){
  document.getElementById('app').innerHTML = `
    <div class="loginstage">
      <div class="loginbrand">
        <div class="blob blob-a"></div>
        <div class="blob blob-b"></div>
        <img src="logo.png" alt="Parents’ Break" class="loginbrand-logo">
        <h1>Un paso más.</h1>
        <p>Por seguridad, la primera vez que entrás tenés que cambiar la contraseña genérica por una propia. Después de esto no te lo vuelve a pedir.</p>
      </div>
      <div class="loginformside">
        <div class="loginwrap">
          <h2>Elegí tu contraseña definitiva</h2>
          <div class="helper">Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo.</div>
          <div class="field">
            <label>Contraseña nueva</label>
            <div class="inputicon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/></svg>
              <input type="password" id="op-pass1">
            </div>
          </div>
          <div class="field">
            <label>Repetila</label>
            <div class="inputicon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/></svg>
              <input type="password" id="op-pass2">
            </div>
          </div>
          <button class="btn primary" id="op-btn" style="width:100%;" onclick="confirmarCambioPasswordObligatorio()"><span id="op-btn-label">Guardar y continuar</span></button>
          <div id="op-warn"></div>
        </div>
      </div>
    </div>`;
}
async function confirmarCambioPasswordObligatorio(){
  const p1 = document.getElementById('op-pass1').value;
  const p2 = document.getElementById('op-pass2').value;
  const warn = document.getElementById('op-warn');
  if(!passwordEsFuerte(p1)){ warn.innerHTML = `<div class="warnbox">Tiene que tener al menos 8 caracteres, con mayúscula, minúscula, número y símbolo.</div>`; return; }
  if(p1 !== p2){ warn.innerHTML = `<div class="warnbox">Las dos contraseñas no coinciden.</div>`; return; }
  const btn = document.getElementById('op-btn');
  btn.disabled = true;
  document.getElementById('op-btn-label').innerHTML = `<span class="spinner"></span> Guardando…`;
  // data:{debe_cambiar_password:false} se combina con el resto del user_metadata que ya
  // tenía (como nombre_mostrar) — no lo pisa.
  const { error } = await sb.auth.updateUser({ password: p1, data: { debe_cambiar_password: false } });
  if(error){
    btn.disabled = false;
    document.getElementById('op-btn-label').textContent = 'Guardar y continuar';
    warn.innerHTML = `<div class="warnbox">${escaparHtml(error.message)}</div>`;
    return;
  }
  toast('Contraseña actualizada.');
  await continuarPostLogin(); // sigue con Face ID si corresponde, o entra directo
}
function renderNuevaContrasena(){
  document.getElementById('app').innerHTML = `
    <div class="loginstage">
      <div class="loginbrand">
        <div class="blob blob-a"></div>
        <div class="blob blob-b"></div>
        <img src="logo.png" alt="Parents’ Break" class="loginbrand-logo">
        <h1>El día a día de tu equipo, en un solo lugar.</h1>
        <p>Candidatas, entrevistas, niñeras activas y tarifas por familia — todo conectado, sin planillas sueltas.</p>
      </div>
      <div class="loginformside">
        <div class="loginwrap">
          <h2>Elegí una contraseña nueva</h2>
          <div class="helper">Se aplica a tu cuenta ahora mismo, no hace falta la contraseña vieja.</div>
          <div class="field">
            <label>Contraseña nueva</label>
            <div class="inputicon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/></svg>
              <input type="password" id="np-pass1">
            </div>
          </div>
          <div class="field">
            <label>Repetila</label>
            <div class="inputicon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/></svg>
              <input type="password" id="np-pass2">
            </div>
          </div>
          <button class="btn primary" id="np-btn" style="width:100%;" onclick="guardarNuevaContrasena()"><span id="np-btn-label">Guardar contraseña</span></button>
          <div id="np-warn"></div>
        </div>
      </div>
    </div>`;
}
async function guardarNuevaContrasena(){
  const p1 = document.getElementById('np-pass1').value;
  const p2 = document.getElementById('np-pass2').value;
  const warn = document.getElementById('np-warn');
  if(!passwordEsFuerte(p1)){ warn.innerHTML = `<div class="warnbox">Tiene que tener al menos 8 caracteres, con mayúscula, minúscula, número y símbolo.</div>`; return; }
  if(p1 !== p2){ warn.innerHTML = `<div class="warnbox">Las dos contraseñas no coinciden.</div>`; return; }
  const btn = document.getElementById('np-btn');
  btn.disabled = true;
  document.getElementById('np-btn-label').innerHTML = `<span class="spinner"></span> Guardando…`;
  const { error } = await sb.auth.updateUser({ password: p1 });
  if(error){
    btn.disabled = false;
    document.getElementById('np-btn-label').textContent = 'Guardar contraseña';
    warn.innerHTML = `<div class="warnbox">${escaparHtml(error.message)}</div>`;
    return;
  }
  modoRecuperacion = false;
  toast('Contraseña actualizada.');
  renderRoot();
}
// Cerrar sesión cierra solo este dispositivo (21/10/2026): antes cerraba la cuenta en todos lados
// y cortaba lo que se estuviera haciendo en otra compu o en el celular.
async function logout(){ limpiarPostLoginPendiente(); await sb.auth.signOut({ scope: 'local' }); }

