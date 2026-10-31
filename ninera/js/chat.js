// App de niñeras (fase 1, etapa 3, 30/10/2026): el chat con el equipo de Parents' Break (#chat) y la
// lista de avisos (#mis-avisos). La niñera escribe y marca leído solo por sus funciones de la base
// (ninera_enviar_mensaje, ninera_marcar_chat_leido, ninera_marcar_avisos_leidos) y lee solo su hilo
// y sus avisos (RLS). Los mensajes nuevos llegan por Realtime sin repintar lo que está escribiendo.
// Textos en "tú" (docs/fase1/textos.md 1 y 6). Nunca montos ni pagos.

const FALLA_ENVIAR_MENSAJE = 'No pudimos enviar tu mensaje. Revisa tu conexión a internet y vuelve a intentar.';
// La base no guarda más de 2.000 caracteres (mensaje_largo). El campo ya no deja escribir más; esto
// queda para lo que igual llegue (no es un problema de conexión).
const MENSAJE_MUY_LARGO = 'Tu mensaje es muy largo. Escríbelo en partes más cortas.';
const FALLA_CARGAR_CHAT = 'No pudimos cargar los mensajes. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_CARGAR_AVISOS = 'No pudimos cargar tus avisos. Revisa tu conexión a internet y vuelve a intentar.';

// Base sin la migración de la etapa 3 (chat_mensajes y avisos no existen): null mientras no se sabe,
// true sin la migración (el inicio no muestra Mensajes ni Avisos y #chat va al inicio), false con ella.
let chatNineraSinMigrar = null;

// La tabla no existe (404 PGRST205 de PostgREST): la base todavía no tiene la migración.
function esTablaSinMigrarNinera(error){
  return !!error && (error.code === 'PGRST205' || error.status === 404);
}

// "HH:MM" si es de hoy; si no, "dd/mm HH:MM". Siempre en Montevideo, aunque el celular tenga otra
// zona horaria (como fechaCortaNinera, perfil.js).
function momentoCortoNinera(ts, hoyISO = todayISO()){
  const d = ts ? new Date(ts) : null;
  if(!d || isNaN(d)) return '';
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const p = t => (partes.find(x => x.type === t)?.value || '');
  const hora = `${p('hour')}:${p('minute')}`;
  return `${p('year')}-${p('month')}-${p('day')}` === hoyISO ? hora : `${p('day')}/${p('month')} ${hora}`;
}

/* ---- Inicio: "Mensajes" y "Avisos" ----
   Debajo de los próximos sittings, con lo que falta leer. La primera vez se pintan escondidos hasta
   saber si la base tiene la migración (así no aparecen y desaparecen); después ya se sabe. */
function htmlAccesosInicio(){
  if(chatNineraSinMigrar) return '';
  return `<nav id="inicio-accesos" class="accesos" aria-label="Mensajes y avisos"${chatNineraSinMigrar === false ? '' : ' hidden'}>
    <button type="button" class="acceso" id="acceso-mensajes" onclick="irA('#chat')">Mensajes</button>
    <button type="button" class="acceso" id="acceso-avisos" onclick="irA('#mis-avisos')">Avisos</button>
  </nav>`;
}

// Cuántos sin leer: solo los ids de lo que falta leer (son pocos; más de 99 se muestra "99+"). Sin
// reintentos: es solo el número, y sin conexión los botones tienen que salir igual, enseguida.
// Devuelve el número, 'sin_migrar' o null si no se pudo (ahí los botones salen sin número).
async function contarSinLeerNinera(consulta){
  try{
    const { data, error } = await consulta.limit(100).retry(false);
    if(error) return esTablaSinMigrarNinera(error) ? 'sin_migrar' : null;
    return Array.isArray(data) ? data.length : null;
  }catch(e){ return null; }
}

// Los avisos del chat no se cuentan en "Avisos": cada mensaje del equipo también deja un aviso, y ya
// está en el número de "Mensajes" (se contaría dos veces).
async function cargarContadoresInicio(){
  if(chatNineraSinMigrar || !document.getElementById('inicio-accesos')) return;
  let chat = sbn.from('chat_mensajes').select('id').eq('de', 'admin').is('leido_ninera_en', null);
  let avisos = sbn.from('avisos').select('id').is('leido_en', null).neq('tipo', 'chat');
  if(nineraIdSesion){ chat = chat.eq('ninera_id', nineraIdSesion); avisos = avisos.eq('para_ninera_id', nineraIdSesion); }
  const [sinLeerChat, sinLeerAvisos] = await Promise.all([contarSinLeerNinera(chat), contarSinLeerNinera(avisos)]);
  // Puede haber cambiado de pantalla mientras contaba: se busca de nuevo.
  const nav = document.getElementById('inicio-accesos');
  if(sinLeerChat === 'sin_migrar' || sinLeerAvisos === 'sin_migrar'){
    chatNineraSinMigrar = true;
    if(nav) nav.remove();
    return;
  }
  if(sinLeerChat !== null || sinLeerAvisos !== null) chatNineraSinMigrar = false;
  if(!nav) return;
  nav.hidden = false;
  pintarContadorNinera('acceso-mensajes', sinLeerChat);
  pintarContadorNinera('acceso-avisos', sinLeerAvisos);
}

function pintarContadorNinera(id, n){
  const btn = document.getElementById(id);
  if(!btn) return;
  btn.querySelectorAll('.contador, .solo-lector').forEach(x => x.remove());
  if(n > 0) btn.insertAdjacentHTML('beforeend', `<span class="contador">${n > 99 ? '99+' : n}</span><span class="solo-lector"> sin leer</span>`);
}

/* ---- Chat (#chat) ----
   El hilo se lee directo (la RLS deja solo el suyo) y los nuevos llegan por el canal 'chat-ninera'.
   Cada apertura tiene su número: lo que termina de cargar después de salir (o de volver a entrar)
   no toca la pantalla nueva. Un mensaje se agrega una sola vez (por id), en su lugar por la hora:
   el que ella manda puede llegar por la respuesta de la RPC y por Realtime, en cualquier orden. */
let aperturaChatNinera = 0;
let idsChatNinera = new Set();
let canalChatNinera = null;
let cierreCanalChatNinera = Promise.resolve();
// Llegó algo del equipo con la app en segundo plano: no lo vio, se marca leído al volver al frente.
let chatPorMarcarNinera = false;

async function pantallaChatNinera(){
  if(chatNineraSinMigrar) return renderInicio();
  marcarRuta('#chat');
  pintar(`<main class="pantalla pantalla-chat">
    <div class="chat-cabecera">
      <button type="button" class="link-boton volver" onclick="irA('#inicio')">Volver</button>
      <h1>Equipo de Parents' Break</h1>
      <p class="helper">Contáctate con una operadora de Parents' Break.</p>
    </div>
    <div id="chat-hilo" class="chat-hilo" role="log" aria-live="polite"><p class="vacio chat-provisorio">Cargando…</p></div>
    <div class="chat-escribir">
      <p class="error-form" id="chat-error" role="alert"></p>
      <div class="chat-fila">
        <textarea id="chat-texto" rows="2" maxlength="2000" placeholder="Escribe tu mensaje" aria-label="Tu mensaje"></textarea>
        <button class="btn primary" onclick="conGuardado(this, ()=>enviarMensajeNinera())">Enviar</button>
      </div>
    </div>
  </main>`);
  // Después de pintar: pintar() ya cerró lo de la apertura anterior.
  const apertura = ++aperturaChatNinera;
  idsChatNinera = new Set();
  alSalirDePantallaNinera = cerrarCanalChatNinera;
  // El canal antes que la lectura: lo que llegue mientras carga no se pierde (el id evita repetirlo).
  abrirCanalChatNinera(apertura);
  await cargarHiloChatNinera(apertura);
}

// La niñera de esta apertura sigue en el chat: el hilo a pintar, o null.
function hiloChatVigente(apertura){
  return apertura === aperturaChatNinera ? document.getElementById('chat-hilo') : null;
}

// Los últimos 200 mensajes. silencioso: al volver a la app (Realtime pudo perder algo mientras el
// celular dormía) suma lo que falte sin mostrar "Cargando…" ni errores.
async function cargarHiloChatNinera(apertura, { silencioso = false } = {}){
  let filas;
  try{
    let consulta = sbn.from('chat_mensajes').select('id, de, autor, texto, creado_en').order('creado_en', { ascending: false }).limit(200);
    if(nineraIdSesion) consulta = consulta.eq('ninera_id', nineraIdSesion);
    const { data, error } = await consulta;
    if(error) throw error;
    filas = (data || []).slice().reverse();
  }catch(e){
    if(esTablaSinMigrarNinera(e)){
      chatNineraSinMigrar = true;
      if(hiloChatVigente(apertura)) await renderInicio();
      return;
    }
    console.error('[chat] al cargar el hilo', e);
    const hilo = hiloChatVigente(apertura);
    if(hilo && !silencioso){
      hilo.querySelectorAll('.chat-provisorio').forEach(x => x.remove());
      hilo.insertAdjacentHTML('afterbegin', `<div class="chat-falla"><p class="vacio">${escaparHtml(FALLA_CARGAR_CHAT)}</p>
        <button type="button" class="btn ghost ancho reintentar" onclick="reintentarHiloChatNinera()">Reintentar</button></div>`);
    }
    return;
  }
  chatNineraSinMigrar = false;
  const hilo = hiloChatVigente(apertura);
  if(!hilo) return;
  hilo.querySelectorAll('.chat-falla').forEach(x => x.remove());
  const nuevos = agregarMensajesChatNinera(filas, { bajar: !silencioso });
  if(!hilo.querySelector('.chat-msg')){
    hilo.querySelectorAll('.chat-provisorio').forEach(x => x.remove());
    hilo.insertAdjacentHTML('afterbegin', '<p class="vacio chat-provisorio">Todavía no hay mensajes.</p>');
  }
  // Recién cuando los vio: si no cargó, siguen sin leer.
  if(!silencioso || nuevos || chatPorMarcarNinera){
    chatPorMarcarNinera = false;
    marcarChatLeidoNinera();
  }
}

function reintentarHiloChatNinera(){
  const hilo = hiloChatVigente(aperturaChatNinera);
  if(!hilo) return;
  hilo.querySelectorAll('.chat-falla').forEach(x => x.remove());
  if(!hilo.querySelector('.chat-msg')) hilo.insertAdjacentHTML('afterbegin', '<p class="vacio chat-provisorio">Cargando…</p>');
  return cargarHiloChatNinera(aperturaChatNinera);
}

// Un mensaje: los suyos a la derecha; los del equipo a la izquierda con quién escribió. El texto
// tal cual, escapado; los renglones los respeta el CSS (white-space: pre-wrap), sin <br> armados.
function htmlMensajeChatNinera(m){
  const mio = m.de === 'ninera';
  return `<div class="chat-msg ${mio ? 'mio' : 'equipo'}" data-t="${Date.parse(m.creado_en) || 0}">${
    mio ? '' : `<span class="chat-autor">${escaparHtml(m.autor || "Parents' Break")}</span>`
  }<span class="chat-texto">${escaparHtml(m.texto)}</span><span class="chat-hora">${escaparHtml(momentoCortoNinera(m.creado_en))}</span></div>`;
}

// Suma al hilo los que todavía no están, cada uno en su lugar por la hora, sin tocar el campo de
// texto. Baja al último si se pide (al abrir, al mandar) o si ya estaba abajo; si subió a leer algo
// viejo, no la mueve. Devuelve cuántos sumó.
function agregarMensajesChatNinera(filas, { bajar = false } = {}){
  const hilo = document.getElementById('chat-hilo');
  if(!hilo) return 0;
  const estabaAbajo = hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight < 80;
  let nuevos = 0;
  for(const m of filas){
    if(!m || !m.id || idsChatNinera.has(m.id)) continue;
    idsChatNinera.add(m.id);
    const molde = document.createElement('div');
    molde.innerHTML = htmlMensajeChatNinera(m);
    const el = molde.firstElementChild;
    const t = Number(el.dataset.t);
    const siguiente = Array.from(hilo.querySelectorAll('.chat-msg')).find(x => Number(x.dataset.t) > t);
    hilo.insertBefore(el, siguiente || null);
    nuevos++;
  }
  if(nuevos){
    hilo.querySelectorAll('.chat-provisorio').forEach(x => x.remove());
    if(bajar || estabaAbajo) hilo.scrollTop = hilo.scrollHeight;
  }
  return nuevos;
}

// Sin el id de su ficha (no debería pasar después de entrar) no hay filtro: sin Realtime, el hilo se
// pone al día al volver a la app.
async function abrirCanalChatNinera(apertura){
  const id = nineraIdSesion;
  if(!id) return;
  // Si recién salió, se espera a que el canal anterior termine de cerrarse: con el mismo nombre,
  // supabase-js devolvería el que se está yendo.
  await cierreCanalChatNinera;
  if(apertura !== aperturaChatNinera) return;
  canalChatNinera = sbn.channel('chat-ninera')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensajes', filter: `ninera_id=eq.${id}` }, payload => {
      if(apertura !== aperturaChatNinera) return;
      const m = payload && payload.new;
      // Uno del equipo con el hilo abierto y la app a la vista: ya lo vio. En segundo plano no (con la
      // pantalla apagada el número de "Mensajes" tiene que seguir): se marca al volver.
      if(!agregarMensajesChatNinera([m]) || m.de !== 'admin') return;
      if(document.visibilityState === 'visible') marcarChatLeidoNinera();
      else chatPorMarcarNinera = true;
    })
    .subscribe();
}

// Al salir del chat (alSalirDePantallaNinera, base.js): se quita el canal y lo que siga cargando de
// esta apertura ya no pinta nada.
function cerrarCanalChatNinera(){
  aperturaChatNinera++;
  chatPorMarcarNinera = false;
  const canal = canalChatNinera;
  canalChatNinera = null;
  if(canal) cierreCanalChatNinera = sbn.removeChannel(canal).catch(e => console.error('[chat] al quitar el canal', e));
}

// Al volver a la app con el chat abierto: en el iPhone la conexión de Realtime se corta con la
// pantalla apagada, y lo que llegó mientras tanto no vino por el canal.
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible' && hiloChatVigente(aperturaChatNinera)) cargarHiloChatNinera(aperturaChatNinera, { silencioso: true });
});

// Un push con la app ya abierta (30/10/2026): en el iPhone, la app instalada puede reusar la ventana
// y solo cambiar el hash a #chat, sin volver a cargar. Se sigue solo si ya pasó todas las puertas
// del arranque (login, cuenta activa, instalar, avisos, perfil de la primera vez) y está en el
// inicio, el chat o los avisos; si no, el hash vuelve a decir la pantalla que está a la vista.
// marcarRuta() usa replaceState, que no dispara este evento.
window.addEventListener('hashchange', ev => {
  const pedida = location.hash;
  if(pedida !== '#chat' && pedida !== '#mis-avisos') return;
  const anterior = new URL(ev.oldURL).hash;
  if(puertasPasadasNinera && nineraIdSesion && ['#inicio', '#chat', '#mis-avisos'].includes(anterior)) irA(pedida);
  else marcarRuta(anterior);
});

// Si falla no se avisa: lo único que pasa es que el número de "Mensajes" sigue hasta la próxima vez.
async function marcarChatLeidoNinera(){
  try{
    const { error } = await sbn.rpc('ninera_marcar_chat_leido');
    if(error) throw error;
  }catch(e){
    console.error('[chat] al marcar leído', e);
  }
}

// Manda lo escrito tal cual (la base saca los blancos de alrededor). Si falla, el aviso arriba del
// campo y el texto queda para reintentar; nunca un mensaje en el hilo que no se guardó.
async function enviarMensajeNinera(){
  const campo = document.getElementById('chat-texto');
  const aviso = document.getElementById('chat-error');
  if(!campo || !aviso) return;
  const texto = campo.value;
  aviso.textContent = '';
  if(!texto.trim()){ campo.focus(); return; }
  let fila;
  try{
    const { data, error } = await sbn.rpc('ninera_enviar_mensaje', { p_texto: texto });
    if(error) throw error;
    fila = Array.isArray(data) ? data[0] : data;
    if(!fila || !fila.id) throw new Error('la base no devolvió el mensaje');
  }catch(e){
    const motivo = (e && e.message) || '';
    // Solo blancos que el navegador no ve como tales: no hay nada que mandar.
    if(/mensaje_vacio/.test(motivo)) return;
    // La dieron de baja con el chat abierto (30/10/2026): reintentar no sirve, que lo sepa.
    if(/no_autorizada/.test(motivo)){ aviso.textContent = CUENTA_NO_ACTIVA; return; }
    console.error('[chat] al enviar', e);
    aviso.textContent = /mensaje_largo/.test(motivo) ? MENSAJE_MUY_LARGO : FALLA_ENVIAR_MENSAJE;
    return;
  }
  agregarMensajesChatNinera([fila], { bajar: true });
  // Lo que escribió mientras se mandaba queda: se saca solo lo que ya salió.
  if(campo.value.startsWith(texto)) campo.value = campo.value.slice(texto.length).replace(/^\s+/, '');
}

/* ---- Avisos (#mis-avisos) ----
   Los últimos 50, el más nuevo arriba. Uno con link de la app (empieza con #) se toca para ir ahí;
   cualquier otro link no se sigue. Al abrir se marcan leídos (después de mostrarlos: los que no
   había leído se ven distintos esa vez). */
async function pantallaAvisosNinera(){
  if(chatNineraSinMigrar) return renderInicio();
  marcarRuta('#mis-avisos');
  pintar(`<main class="pantalla">
    <button type="button" class="link-boton volver" onclick="irA('#inicio')">Volver</button>
    <h1>Avisos</h1>
    <div id="avisos-lista" class="avisos-lista" aria-live="polite"><p class="vacio">Cargando…</p></div>
  </main>`);
  await cargarAvisosNinera();
}

async function cargarAvisosNinera(){
  const lista = document.getElementById('avisos-lista');
  if(!lista) return;
  lista.innerHTML = '<p class="vacio">Cargando…</p>';
  let filas;
  try{
    let consulta = sbn.from('avisos').select('id, titulo, cuerpo, url, creado_en, leido_en').order('creado_en', { ascending: false }).limit(50);
    if(nineraIdSesion) consulta = consulta.eq('para_ninera_id', nineraIdSesion);
    const { data, error } = await consulta;
    if(error) throw error;
    filas = data || [];
  }catch(e){
    if(esTablaSinMigrarNinera(e)){
      chatNineraSinMigrar = true;
      if(lista.isConnected) await renderInicio();
      return;
    }
    console.error('[avisos] al cargar', e);
    if(lista.isConnected) lista.innerHTML = `<p class="vacio">${escaparHtml(FALLA_CARGAR_AVISOS)}</p>
      <button type="button" class="btn ghost ancho reintentar" onclick="cargarAvisosNinera()">Reintentar</button>`;
    return;
  }
  chatNineraSinMigrar = false;
  // Puede haber cambiado de pantalla mientras cargaba.
  if(!lista.isConnected) return;
  lista.innerHTML = filas.length ? filas.map(htmlAvisoNinera).join('') : '<p class="vacio">No tienes avisos.</p>';
  if(filas.some(a => !a.leido_en)) marcarAvisosLeidosNinera();
}

function htmlAvisoNinera(a){
  const clase = `aviso-item${a.leido_en ? '' : ' sin-leer'}`;
  const contenido = `<span class="aviso-titulo">${escaparHtml(a.titulo)}</span>${
    a.cuerpo ? `<span class="aviso-cuerpo">${escaparHtml(a.cuerpo)}</span>` : ''
  }<span class="aviso-fecha">${escaparHtml(momentoCortoNinera(a.creado_en))}</span>`;
  // Solo una pantalla de la app: irA ignora lo que no conoce, y un link de afuera no se abre.
  if(typeof a.url === 'string' && a.url.startsWith('#')) return `<button type="button" class="${clase}" onclick="irA(${argJs(a.url)})">${contenido}</button>`;
  return `<div class="${clase}">${contenido}</div>`;
}

async function marcarAvisosLeidosNinera(){
  try{
    const { error } = await sbn.rpc('ninera_marcar_avisos_leidos');
    if(error) throw error;
  }catch(e){
    console.error('[avisos] al marcar leídos', e);
  }
}
