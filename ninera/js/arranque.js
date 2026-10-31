// App de niñeras (fase 1, 26/10/2026): arranque. Va siempre último en ninera/index.html (los
// archivos de cada etapa se cargan antes). Orden (decisiones.md 6.1): link de invitación → sesión
// → ¿es una niñera activa? → primer ingreso → instalar → avisos (una vez por celular) → inicio.

// La pantalla que pidió el link con que se abrió la app (30/10/2026): el push del chat abre
// ".../ninera/#chat". Se guarda antes de arrancar porque el login, instalar o los avisos cambian el
// hash; después de esas puertas se va ahí en vez del inicio, una sola vez.
let rutaPedidaAlAbrir = ['#chat', '#mis-avisos'].includes(location.hash) ? location.hash : null;
// Ya pasó todas las puertas de arriba con esta sesión: recién ahí un cambio de hash (un push con la
// app abierta, chat.js) puede llevarla a otra pantalla.
let puertasPasadasNinera = false;

async function bootNinera(){
  if(!sbn){
    mostrarErrorNinera('No pudimos abrir la app.', 'Revisa tu conexión a internet y vuelve a intentar.');
    return;
  }
  try{
    // Registrado desde ninera/, su alcance es ninera/ (el del panel cubre todo el sitio).
    if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    escucharSesionNinera();
    const token = new URLSearchParams(location.search).get('i');
    if(token){ await pantallaInvitacion(token); return; }
    await arrancarSinInvitacion();
  }catch(e){
    console.error('[arranque]', e);
    mostrarErrorNinera('No pudimos abrir la app.', 'Revisa tu conexión a internet y vuelve a intentar.');
  }
}

async function arrancarSinInvitacion(){
  // Sin sesión guardada en este celular, el login sale al instante.
  if(!leerSesionNineraGuardada()){ pantallaLogin(); return; }
  mostrarCargaNinera();
  const { data, error } = await sbn.auth.getSession();
  sesionNinera = (data && data.session) || null;
  if(!sesionNinera){
    // Sesión vencida que no se pudo renovar por falta de conexión: no es que no tenga cuenta.
    if(error && esErrorDeRedAuth(error)){ mostrarErrorCargaInicio(); return; }
    pantallaLogin();
    return;
  }
  await seguirConSesionNinera();
}

// Regla del panel (auth.js, 22/09 y 29/09/2026): no repintar ante eventos de auth que no cambian
// quién está adentro. INITIAL_SESSION llega con la misma sesión de getSession(), TOKEN_REFRESHED
// es la renovación silenciosa del token y SIGNED_IN también se repite al volver a la app: repintar
// ahí borraría lo que se esté escribiendo. Los logins de esta app pintan solos (entrarNinera,
// crearCuentaDesdeInvitacion). Solo la sesión cerrada (vencida o cerrada desde otro lado) vuelve
// al login.
let escuchandoSesionNinera = false;
function escucharSesionNinera(){
  if(escuchandoSesionNinera) return;
  escuchandoSesionNinera = true;
  sbn.auth.onAuthStateChange((evento, sesion) => {
    sesionNinera = sesion || null;
    if(evento !== 'SIGNED_OUT') return;
    puertasPasadasNinera = false;
    if(rutaActual() === '#login' || rutaActual() === '#invitacion') return;
    cerrarModalNinera();
    pantallaLogin();
  });
}

async function seguirConSesionNinera(){
  mostrarCargaNinera();
  let nineraId = null;
  try{
    const { data, error } = await sbn.rpc('ninera_actual');
    if(error) throw error;
    nineraId = data;
  }catch(e){
    console.error('[ninera_actual]', e);
    mostrarErrorCargaInicio();
    return;
  }
  // Dada de baja (activa = false) o sin ficha: la base no le muestra nada (decisiones.md 5.2).
  if(!nineraId){ pantallaCuentaInactiva(); return; }
  nineraIdSesion = nineraId;
  await activarAppNinera();
  if(!esAppInstalada()){ pantallaInstalar(); return; }
  await continuarDespuesDeInstalar();
}

// Primer ingreso (app_activada_en): desde ahí corre el plazo de la guía. La función de la base no
// pisa la fecha si ya estaba; igual se llama una sola vez por cuenta en cada celular. Si falla no
// frena la entrada: se vuelve a intentar la próxima vez.
async function activarAppNinera(){
  const uid = sesionNinera && sesionNinera.user.id;
  if(!uid || leerLocalNinera('pb-ninera-app-activada') === uid) return;
  try{
    const { error } = await sbn.rpc('ninera_activar_app');
    if(error) throw error;
    guardarLocalNinera('pb-ninera-app-activada', uid);
  }catch(e){
    console.error('[ninera_activar_app]', e);
  }
}

// Después de instalar (o si ya estaba instalada): la pantalla de avisos cada vez que entra con los avisos
// apagados (etapa 9, 31/10/2026; salvo "Seguir sin avisos" en esta apertura),
// el perfil si todavía no lo completó (etapa 2, 27/10/2026) y el inicio. Con la base sin la
// migración de la etapa 2, el inicio de siempre.
async function continuarDespuesDeInstalar(){
  if(avisosSoportados() && !avisosSalteadosEstaVez && !(await avisosActivados())){
    pantallaAvisos();
    return;
  }
  mostrarCargaNinera();
  let cargado;
  try{
    cargado = await cargarPerfilNinera();
  }catch(e){
    console.error('[ninera_mi_perfil]', e);
    mostrarErrorCargaInicio();
    return;
  }
  if(!cargado.sinMigrar && cargado.perfil && perfilIncompleto(cargado.perfil)){
    await pantallaPerfil('primera', cargado.perfil);
    return;
  }
  await abrirPrimeraPantallaNinera();
}

// El inicio, o la pantalla que pidió el link (rutaPedidaAlAbrir). También al terminar el perfil de
// la primera vez (perfil.js).
async function abrirPrimeraPantallaNinera(){
  puertasPasadasNinera = true;
  const pedida = rutaPedidaAlAbrir;
  rutaPedidaAlAbrir = null;
  if(pedida) return irA(pedida);
  return renderInicio();
}

bootNinera();
