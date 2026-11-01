/* ================= APP SHELL ================= */
const ICONS = {
  salir: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  rrhh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>`,
  familias: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9h12v-9"/></svg>`,
  sittings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 16v-3l2-4h12l2 4v3"/><path d="M4 16h16"/><circle cx="8" cy="17.5" r="1.4"/><circle cx="16" cy="17.5" r="1.4"/></svg>`,
  finanzas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20V10M11 20V4M18 20v-7"/></svg>`,
  marketing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 10v4h3l7 4V6l-7 4H4z"/><path d="M18 9a4 4 0 010 6"/></svg>`,
  legal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/></svg>`,
  ninieras: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="7.5" r="3.2"/><path d="M6 20c0-3.4 2.7-5.7 6-5.7s6 2.3 6 5.7"/><path d="M9 20v-3M15 20v-3"/></svg>`,
  hoy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9h12v-9"/></svg>`,
  agenda: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M8 3v4M16 3v4"/></svg>`,
  moneyIn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 17l5-5 4 4 7-8"/><path d="M15 8h5v5"/></svg>`,
  moneyOut: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7l5 5 4-4 7 8"/><path d="M15 16h5v-5"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13"/></svg>`,
  juguetes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="10" width="7" height="7" rx="1.2"/><circle cx="16.5" cy="13.5" r="3.5"/><path d="M9 10V7a2 2 0 1 1 2 2H9z"/></svg>`,
  intermediaciones: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h16M4 12h10M4 17h16"/><circle cx="18" cy="12" r="2.2"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 4 2 20h20L12 4Z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg>`,
};
ICONS.notificaciones = ICONS.bell;
const MODULOS = [
  {key:'agenda', label:'Agenda', desc:'Solicitudes de familias, asignación de niñeras y calendario del día.'},
  {key:'rrhh', label:'Postulantes', desc:'Candidatas y entrevistas — el pipeline completo, de punta a punta.'},
  {key:'ninieras', label:'Niñeras', desc:'Tu equipo activo, con filtro por nombre y zona.'},
  {key:'familias', label:'Familias', desc:'Familias, tarifas por niñera y márgenes.'},
  {key:'sittings', label:'Sittings & traslados', desc:'Registro diario de sittings y traslados.'},
  {key:'intermediaciones', label:'Intermediaciones', desc:'Colocaciones vía Agencia Enrique y eventos empresariales.'},
  {key:'finanzas', label:'Finanzas', desc:'Ingresos, pagos a niñeras y gastos generales — con datos reales.'},
  {key:'marketing', label:'Marketing', desc:'Calendario de fechas especiales y contenido.'},
  {key:'legal', label:'Contratos', desc:'Contratos de niñeras y traslados.'},
  {key:'juguetes', label:'Juguetes', desc:'Inventario de juguetes y en qué casa está cada uno.'},
  {key:'notificaciones', label:'Notificaciones', desc:'Elegí qué avisos te llegan como push al celular, además de la campanita.'},
];
let moduloActivo = null;
let rrhhTab = 'intake';
let dashPendientesHoy = [];

function nombreUsuario(){
  // El nombre a mostrar vive en user_metadata.nombre_mostrar (Supabase Auth), no en el
  // código público — antes había un mapa mail->nombre hardcodeado acá, que exponía los
  // mails personales de Pau y Delfi en el repo público. Si algún día se agrega una cuenta
  // nueva sin este campo cargado, cae al nombre derivado del mail como antes.
  const meta = session?.user?.user_metadata || {};
  if(meta.nombre_mostrar) return meta.nombre_mostrar;
  const email = session?.user?.email || '';
  const local = (email.split('@')[0] || '').replace(/[^a-zA-Z]/g,'');
  return local ? local.charAt(0).toUpperCase()+local.slice(1) : '?';
}
function renderApp(){
  document.getElementById('app').innerHTML = `
    <div class="mobile-topbar">
      <button class="mobile-menubtn" onclick="toggleSidebarMobile()" aria-label="Abrir menú">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
      </button>
      <img src="logo.png" alt="Parents’ Break — ir a Hoy" class="mobile-topbar-logo" role="button" tabindex="0" onclick="setModulo(null)" onkeydown="if(event.key==='Enter'||event.key===' '){setModulo(null);}">
      <div class="mobile-topbar-user">
        <span class="mobile-topbar-name">${escaparHtml(nombreUsuario())}</span>
      </div>
      <button class="notif-btn" onclick="event.stopPropagation();toggleNotifPanel()" aria-label="Notificaciones" title="Notificaciones">
        ${ICONS.bell}<span class="notif-badge">0</span>
      </button>
    </div>
    <div class="sidebar-backdrop" id="sidebar-backdrop" onclick="toggleSidebarMobile(false)"></div>
    <div class="appshell">
      <aside class="sidebar" id="sidebar"></aside>
      <main id="modcontent" class="mainarea"></main>
    </div>
    <div id="modfooter"></div>
    <div class="notif-panel" id="notif-panel"></div>
  `;
  // Si venimos de tocar una notificación push (sw.js abre "?ir=agenda"), arrancamos
  // directo en ese módulo en vez de Hoy, y limpiamos el parámetro de la URL.
  const params = new URLSearchParams(window.location.search);
  const irParam = params.get('ir');
  // El push del chat a las admins (30/10/2026) trae "?ir=ninieras&ninera=<id>": además del módulo,
  // abre la ficha de esa niñera en el chat apenas carga la lista.
  const nineraParam = irParam==='ninieras' ? params.get('ninera') : null;
  // El push de "Pedidos de la app" trae "?ir=agenda&solicitud=<id>": abre el modal de esa solicitud.
  const solicitudParam = irParam==='agenda' ? params.get('solicitud') : null;
  if(irParam){
    window.history.replaceState({}, '', window.location.pathname);
    moduloActivo = irParam;
  }
  // Quedó una entrevista sin guardar hace poco (se recargó la página, se cerró la sesión): se
  // abre directo ahí, con el aviso para seguirla (21/10/2026).
  if(moduloActivo===null && hayBorradorEntrevistaReciente()){ moduloActivo = 'rrhh'; rrhhTab = 'entrevista'; }
  if(!zonaGruposCache) cargarZonaGrupos(); // las zonas se usan en casi todas las pantallas: se piden una sola vez al entrar
  const cargaModulo = renderModulo();
  cubrirHastaQueCargue(cargaModulo);
  if(nineraParam) abrirChatDeNinera(nineraParam, { cambiarModulo:false });
  if(solicitudParam) Promise.resolve(cargaModulo).then(()=>abrirSolicitudDeLink(solicitudParam));
  cargarNotificaciones();
  suscribirNotifRealtime();
}
function toggleSidebarMobile(force){
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebar-backdrop');
  const abrir = typeof force === 'boolean' ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', abrir);
  bd.classList.toggle('show', abrir);
}
function setModulo(k){ moduloActivo=k; const p = renderModulo(); toggleSidebarMobile(false); indicarCargaModulo(p); return p; }
function renderSidebar(){
  const activeTop = (moduloActivo===null || moduloActivo==='hoy') ? 'hoy' : (MODULOS.some(m=>m.key===moduloActivo) ? moduloActivo : null);
  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-logo-wrap">
      <img src="logo.png" alt="Parents’ Break — ir a Hoy" class="sidebar-logo" role="button" tabindex="0" style="cursor:pointer;" onclick="setModulo(null)" onkeydown="if(event.key==='Enter'||event.key===' '){setModulo(null);}">
      <button class="notif-btn desktop" onclick="event.stopPropagation();toggleNotifPanel()" aria-label="Notificaciones" title="Notificaciones">
        ${ICONS.bell}<span class="notif-badge">0</span>
      </button>
    </div>
    <nav class="sidebar-nav">
      <button class="navitem ${activeTop==='hoy'?'active':''}" onclick="setModulo(null)" title="Hoy">
        <div class="navitem-ic">${ICONS.hoy}</div><div class="navitem-label">Hoy</div>
      </button>
      ${MODULOS.map(m=>`
        <button class="navitem ${activeTop===m.key?'active':''}" onclick="setModulo(${argJs(m.key)})" title="${m.label}">
          <div class="navitem-ic">${ICONS[m.key]}</div><div class="navitem-label">${m.label}</div>
          ${m.key==='agenda' ? `<span id="agenda-navdot"></span>` : ''}
          ${m.key==='finanzas' ? `<span id="finanzas-navdot"></span>` : ''}
          ${m.key==='notificaciones' ? `<span id="notif-navdot"></span>` : ''}
        </button>`).join('')}
    </nav>
    <div class="sidebar-foot">
      ${escaparHtml(nombreUsuario())}<br>
      ${PASSKEY_SOPORTADO ? `<button onclick="gestionarPasskeys()">Face ID / Touch ID</button> · ` : ''}<button onclick="logout()">Cerrar sesión</button>
    </div>
  `;
  actualizarAgendaBadge();
  actualizarFinanzasBadge();
  renderNotifBell();
  actualizarNotifNavdot();
  ajustarSidebarNav();
}
async function actualizarFinanzasBadge(){
  const dot = document.getElementById('finanzas-navdot');
  if(!dot) return;
  const [{data:cfg}, {data:pend}, {data:pendEventos}] = await Promise.all([
    AVISO_EXTRACTO_ACTIVO ? sb.from('app_config').select('actualizado_at').eq('id','ultima_conciliacion_cobros').maybeSingle() : { data: null },
    sb.from('sittings_traslados').select('id').eq('pagado', false).gt('pago_ninera', 0).lte('fecha', todayISO()).limit(1),
    sb.from('intermediaciones_eventos_ninieras').select('evento_id').eq('pagado', false).gt('pago', 0),
  ]);
  // Niñeras de eventos sin pagar (21/10/2026): avisan igual que un sitting, desde el día del evento.
  let eventoSinPagar = false;
  if(pendEventos && pendEventos.length){
    const { data } = await sb.from('intermediaciones_eventos').select('id').in('id', [...new Set(pendEventos.map(p=>p.evento_id))]).lte('fecha', todayISO()).limit(1);
    eventoSinPagar = !!(data && data.length);
  }
  const diasSinExtracto = cfg?.actualizado_at ? (Date.now() - new Date(cfg.actualizado_at).getTime()) / 86400000 : Infinity;
  const hayAviso = (AVISO_EXTRACTO_ACTIVO && diasSinExtracto > 7) || (pend && pend.length > 0) || eventoSinPagar;
  dot.innerHTML = hayAviso ? '<span class="navdot"></span>' : '';
}

const DIAS_LABEL = {L:'Lun',M:'Mar',X:'Mié',J:'Jue',V:'Vie',S:'Sáb',D:'Dom'};
const DIAS_CORTO = {L:'Lu',M:'Ma',X:'Mi',J:'Ju',V:'Vi',S:'Sa',D:'Do'};
function diaHoy(){ return diaSemanaDeISO(todayISO()); }
function fechaHoyLarga(){
  const f = new Intl.DateTimeFormat('es-UY', {weekday:'long', day:'numeric', month:'long', timeZone:ZONA_NEGOCIO}).format(new Date());
  return f.charAt(0).toUpperCase() + f.slice(1);
}

let dashChart = null;
function mananaISO(){ return sumarDiasISO(todayISO(), 1); }
function diasAtras(n){ return sumarDiasISO(todayISO(), -n); }
const PENDIENTE_DIAS_ATRAS = 14; // hasta cuántos días hacia atrás se avisa si algo previsto quedó sin registrar
function rangoFechas(desdeISO, hastaISO){
  const dias = [];
  for(let d = desdeISO; d <= hastaISO; d = sumarDiasISO(d, 1)) dias.push(d);
  return dias;
}
/* Mudanza a parentsbreak.github.io/app (27/10/2026): la app cambió de dirección y el ícono viejo
   del celular dejó de abrirla; además localStorage es por origen, así que en la dirección nueva no
   hay sesión ni passkey. La primera vez que se abre acá, el login y Hoy explican qué hacer
   (reinstalar el ícono, entrar con mail y contraseña, Face ID y avisos de nuevo). "Entendido" deja
   la marca en el dispositivo y no se muestra más. Se saca en un PR aparte un mes después de la
   mudanza (Pendientes de CLAUDE.md). */
const HOST_MUDANZA = 'parentsbreak.github.io';
const DIRECCION_MUDANZA = 'parentsbreak.github.io/app';
const LS_MUDANZA_VISTA = 'pb_mudanza_vista';
// Pura, para poder probarla: host es location.hostname y visto lo que hay en localStorage bajo
// LS_MUDANZA_VISTA (null si no está). Solo avisa en la dirección nueva: en localhost (tests) y en
// la vieja no cambia nada.
function hayQueAvisarMudanza(host, visto){ return host === HOST_MUDANZA && !visto; }
function avisoMudanzaPendiente(){
  let visto = null;
  try{ visto = localStorage.getItem(LS_MUDANZA_VISTA); }catch(e){}
  return hayQueAvisarMudanza(location.hostname, visto);
}
// Arriba del formulario del login (auth.js, renderLogin). Sin botón: la marca se deja desde Hoy.
function avisoMudanzaLoginHtml(){
  if(!avisoMudanzaPendiente()) return '';
  return `<div class="warnbox" id="aviso-mudanza-login" style="margin:0 0 16px;"><b>La app se mudó</b><br>Ahora vive en esta dirección: ${escaparHtml(DIRECCION_MUDANZA)}. Entrá con tu mail y contraseña; después te va a pedir activar Face ID de nuevo. Al entrar aparecen los pasos para reinstalar el ícono.</div>`;
}
// Arriba de todo en Hoy, hasta tocar "Entendido".
function avisoMudanzaHoyHtml(){
  if(!avisoMudanzaPendiente()) return '';
  return `<div class="card" id="aviso-mudanza">
      <h2>La app se mudó: reinstalá el ícono</h2>
      <ol style="margin:0 0 16px;padding-left:22px;line-height:1.6;">
        <li>Borrá el ícono viejo de Parents’ Break del celular.</li>
        <li>Abrí ${escaparHtml(DIRECCION_MUDANZA)} en Safari (en Android, en Chrome).</li>
        <li>Tocá Compartir y después Agregar a pantalla de inicio.</li>
        <li>Abrí la app desde el ícono nuevo y entrá con tu mail y contraseña.</li>
        <li>En el menú, Notificaciones, y tocá Activar notificaciones push.</li>
      </ol>
      <button class="btn primary" onclick="cerrarAvisoMudanza()">Entendido</button>
    </div>`;
}
// No escribe en la base (la marca vive en el dispositivo): por eso no pasa por conGuardado.
function cerrarAvisoMudanza(){
  try{ localStorage.setItem(LS_MUDANZA_VISTA, '1'); }catch(e){}
  const caja = document.getElementById('aviso-mudanza');
  if(caja) caja.remove();
}
async function renderDashboard(cont){
  cont.innerHTML = `
    ${avisoMudanzaHoyHtml()}
    <div class="homeintro"><div class="eyebrow">Parents’ Break</div><h1>Hoy · ${fechaHoyLarga()}</h1>
    </div>
    <div class="statrow" id="statrow">
      <div class="statcard" style="cursor:pointer;" onclick="setModulo('rrhh')"><div class="statnum">—</div><div class="statlabel">En proceso</div><div class="statnum-trend" id="trend-proceso"></div></div>
      <div class="statcard" style="cursor:pointer;" onclick="setModulo('ninieras')"><div class="statnum">—</div><div class="statlabel">Niñeras activas</div><div class="statnum-trend" id="trend-ninieras"></div></div>
      <div class="statcard" style="cursor:pointer;" onclick="setModulo('familias')"><div class="statnum">—</div><div class="statlabel">Familias</div><div class="statnum-trend" id="trend-familias"></div></div>
    </div>
    <div class="chartcard">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
        <h2 style="margin:0;">Facturado y costos por mes</h2>
        <div class="chartlegend"><span><span class="chartdot" style="background:var(--accent);"></span>Facturado</span><span><span class="chartdot" style="background:var(--clay);"></span>Costos</span></div>
      </div>
      <div style="position:relative;height:170px;" id="finmesChartWrap"><canvas id="finmesChart" role="img" aria-label="Facturado y costos por mes, calculados a partir de los sittings, traslados y gastos generales reales"></canvas></div>
    </div>
    <div id="dash-corrida"></div>
    <button class="pendbanner" onclick="setModulo('pend-hoy')">
      <div class="pendbanner-left">
        <div class="pendbanner-num" id="dash-pend-num">—</div>
        <div class="pendbanner-label">Sittings/traslados sin registrar</div>
      </div>
      <div class="pendbanner-link">Ver</div>
    </button>
    <div id="dash-autoconf"></div>
    <div id="dash-chat"></div>
    <div id="dash-faltan"></div>
    <div class="card">
      <h2>Sin resolver · hoy y mañana</h2>
      <div id="agenda" class="agendabox"><div class="empty">Cargando…</div></div>
    </div>
  `;
  // Los mensajes de niñeras van aparte: no frenan el resto de Hoy ni la pantalla de entrada.
  cargarMensajesNinerasHoy();
  // Se devuelve la carga para que la pantalla de entrada y el indicador de sección sepan
  // cuándo Hoy ya tiene sus datos (15/10/2026).
  return loadDashboardData();
}
async function loadDashboardData(){
  await esperarConfigFijos(); // fijos automáticos: saber si hay que sacar los previstos
  const chartReady = asegurarChart(); // se descarga en paralelo con las consultas, no bloquea nada
  // Una sola tanda en paralelo con TODAS las consultas independientes del dashboard.
  // Antes eran 4 tandas en serie (4 idas y vueltas a Supabase); ahora es 1.
  // allSettled: si una consulta falla, las demás secciones igual se renderizan.
  const [pipelineR, ninierasR, familiasR, sitsR, gastosR, hoyR, solR, solSinResolverR] = await Promise.allSettled([
    sb.from('candidatas').select('estado').in('estado', ['intake','entrevistada']),
    sb.from('ninieras').select('nombre,tipo,activa'),
    sb.from('familias').select('cobro_hora'),
    leerTodasLasFilas(()=>sinPrevistos(sb.from('sittings_traslados').select('fecha,cobro_familia,pago_ninera,cobrado,pagado')).gte('fecha', primerDiaMesesAtras(6)).order('id')),
    sb.from('gastos_generales').select('fecha,monto').gte('fecha', primerDiaMesesAtras(6)),
    sb.from('sittings_traslados').select('fecha,familia_nombre,ninera_nombre').gte('fecha', diasAtras(PENDIENTE_DIAS_ATRAS)).lte('fecha', todayISO()),
    sb.from('solicitudes').select('*').gte('fecha', diasAtras(PENDIENTE_DIAS_ATRAS)).lte('fecha', todayISO()).eq('estado','confirmada'),
    sb.from('solicitudes').select('*').gte('fecha', todayISO()).lte('fecha', mananaISO()).in('estado', ['sin_asignar','pendiente_confirmar']).order('fecha', {ascending:true}),
  ]);
  const okData = r => (r.status==='fulfilled' && !r.value.error) ? (r.value.data||[]) : [];

  // ---- Stat cards ----
  try{
    const nums = document.querySelectorAll('#statrow .statnum');
    const pipeline = okData(pipelineR);
    const sinEntrevistar = pipeline.filter(r=>r.estado==='intake').length;
    const entrevistadas = pipeline.filter(r=>r.estado==='entrevistada').length;
    if(nums[0]) nums[0].textContent = pipeline.length;
    const tProceso = document.getElementById('trend-proceso');
    if(tProceso) tProceso.textContent = pipeline.length ? `${sinEntrevistar} sin entrevistar · ${entrevistadas} entrevistada${entrevistadas===1?'':'s'}` : 'Nadie en el pipeline ahora';

    const ninierasActivas = okData(ninierasR).filter(n=>n.activa===true);
    if(nums[1]) nums[1].textContent = ninierasActivas.length;
    const soloNinera = ninierasActivas.filter(n=>(n.tipo||'Niñera')==='Niñera').length;
    const traslados = ninierasActivas.filter(n=>n.tipo==='Traslados').length;
    const ambas = ninierasActivas.filter(n=>n.tipo==='Ambas').length;
    const tNin = document.getElementById('trend-ninieras');
    if(tNin) tNin.textContent = `${soloNinera} niñera · ${traslados} traslados · ${ambas} ambas`;

    const familias = okData(familiasR);
    if(nums[2]) nums[2].textContent = familias.length;
    const conTarifa = familias.filter(f=>f.cobro_hora!==null && f.cobro_hora!=='').length;
    const tFam = document.getElementById('trend-familias');
    if(tFam) tFam.textContent = `${conTarifa} con tarifa fija cargada`;
  }catch(e){}

  // ---- Gráfico ingresos/gastos por mes ----
  try{
    const sits = okData(sitsR);
    const gastos = okData(gastosR);
    const porMes = {};
    (sits||[]).forEach(r=>{
      if(!r.fecha) return;
      const mes = r.fecha.slice(0,7);
      if(!porMes[mes]) porMes[mes] = {ingresos:0, gastos:0};
      // Mismo criterio que Finanzas: lo facturado y lo que corresponde pagar a las niñeras
      // en el mes, esté o no marcado como cobrado / pagado.
      porMes[mes].ingresos += Number(r.cobro_familia)||0;
      porMes[mes].gastos += Number(r.pago_ninera)||0;
    });
    (gastos||[]).forEach(g=>{
      if(!g.fecha) return;
      const mes = g.fecha.slice(0,7);
      if(!porMes[mes]) porMes[mes] = {ingresos:0, gastos:0};
      porMes[mes].gastos += Number(g.monto)||0;
    });
    const meses = Object.keys(porMes).sort().slice(-6);
    const wrap = document.getElementById('finmesChartWrap');
    const canvas = document.getElementById('finmesChart');
    await chartReady;
    if(canvas && meses.length && window.Chart){
      const labels = meses.map(m=>{
        const [y,mm] = m.split('-').map(Number);
        const f = new Intl.DateTimeFormat('es-UY', {month:'short'}).format(new Date(y, mm-1, 1));
        return (f.charAt(0).toUpperCase()+f.slice(1)).replace('.','');
      });
      if(dashChart){ dashChart.destroy(); dashChart = null; }
      dashChart = new Chart(canvas, {
        type:'bar',
        data:{ labels, datasets:[
          {label:'Facturado', data:meses.map(m=>Math.round(porMes[m].ingresos)), backgroundColor:'#757CBB', borderRadius:4, barThickness:22},
          {label:'Costos', data:meses.map(m=>Math.round(porMes[m].gastos)), backgroundColor:'#DF8386', borderRadius:4, barThickness:22},
        ]},
        options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
          scales:{
            y:{ grid:{color:'#E3E1EE'}, ticks:{color:'#6C6A84', font:{size:10}, callback:v=>'$'+Math.round(v/1000)+'k'} },
            x:{ grid:{display:false}, ticks:{color:'#6C6A84', font:{size:11.5}} }
          } }
      });
    } else if(wrap){
      wrap.innerHTML = '<div class="empty">Todavía no hay suficientes sittings o gastos cargados para graficar por mes.</div>';
    }
  }catch(e){}

  // ---- Panel "Sin resolver · hoy y mañana" ----
  const box = document.getElementById('agenda');
  try{
    if(!box) return;
    const sinResolver = okData(solSinResolverR);
    if(!sinResolver.length){
      box.innerHTML = '<div class="empty">Todo lo de hoy y mañana ya tiene niñera confirmada.</div>';
    } else {
      const hoyStr = todayISO();
      const filas = sinResolver.map(s=>{
        const esHoy = s.fecha===hoyStr;
        const horario = s.hora_inicio ? `${s.hora_inicio.slice(0,5)}${s.hora_fin?'–'+s.hora_fin.slice(0,5):''}` : 'Sin horario';
        const estadoTxt = s.estado==='pendiente_confirmar' ? 'Invitación enviada, sin confirmar' : 'Sin niñera asignada';
        return `
        <div class="agendarow" style="cursor:pointer;" onclick="setModulo('agenda')">
          <div class="agendatime">${esHoy?'Hoy':'Mañana'} · ${horario}</div>
          <div class="agendaicon ${s.tipo==='traslado'?'traslado':'sitting'}">${s.tipo==='traslado'?ICONS.sittings:ICONS.ninieras}</div>
          <div class="agendabody">
            <div><b>${escaparHtml(s.familia_nombre)}</b></div>
            <div class="agendatype">${estadoTxt}</div>
          </div>
        </div>`;
      });
      box.innerHTML = `<div class="timeline">${filas.join('')}</div>`;
    }
  }catch(e){ if(box) box.innerHTML = errBox(e); }

  // ---- Pendiente (sittings/traslados previstos, hasta hoy, sin registrar) ----
  // Mira hacia atrás PENDIENTE_DIAS_ATRAS días, no solo hoy — si un puntual confirmado de
  // hace unos días quedó sin cargar en Sittings & traslados, se sigue avisando en vez de
  // perderse apenas pasa el día. Los fijos: el 12/09 se sacaron de acá porque se registraban
  // a mano por su camino semanal y entraban como ruido. Con los fijos automáticos (06/10/2026)
  // cada día de un fijo ya tiene su fila cargada sola, así que un día sin ninguna fila solo
  // pasa si el proceso falló (o el fijo se creó hoy): vuelven a entrar, como alarma.
  cargarConfirmadosAutomaticos();
  revisarCorridaFijos();
  cargarDatosQueFaltan();
  try{
    const registros = okData(hoyR);
    const solicitudesConfirmadas = okData(solR);
    const registradosSet = new Set((registros||[]).map(r=>r.fecha+'|'+normaliza(r.ninera_nombre||'')+'|'+normaliza(r.familia_nombre||'')));

    const previstos = [];

    if(solicitudesConfirmadas.length){
      const { data: snRango } = await sb.from('solicitud_ninieras').select('*').in('solicitud_id', solicitudesConfirmadas.map(s=>s.id)).eq('estado','confirmada');
      const porSol = {};
      (snRango||[]).forEach(r=>{ (porSol[r.solicitud_id] ||= []).push(r); });
      solicitudesConfirmadas.forEach(s=>{
        (porSol[s.id]||[]).forEach(n=>{
          previstos.push({ fecha: s.fecha, ninera_nombre: n.ninera_nombre, familia_nombre: s.familia_nombre, hora_inicio: s.hora_inicio, hora_fin: s.hora_fin, tipo: s.tipo==='traslado' ? 'traslado' : 'sitting' });
        });
      });
    }

    if(fijosAutomaticosActivos){
      const desde = diasAtras(PENDIENTE_DIAS_ATRAS), hasta = todayISO();
      const [{data:asigs}, {data:filasFijos}, pausas] = await Promise.all([
        sb.from('asignaciones').select('*, familias(nombre)'),
        sb.from('sittings_traslados').select('asignacion_id,fecha').not('asignacion_id', 'is', null).gte('fecha', desde).lte('fecha', hasta),
        cargarPausasFijos(),
      ]);
      const cubiertos = new Set((filasFijos||[]).map(r=>r.asignacion_id+'|'+r.fecha));
      rangoFechas(desde, hasta).forEach(fecha=>{
        const dia = diaSemanaDeISO(fecha);
        (asigs||[]).filter(a=>Array.isArray(a.dias) && a.dias.includes(dia) && asignacionVigenteEn(a, fecha) && !fijoPausadoEn(pausas, a.id, fecha) && !cubiertos.has(a.id+'|'+fecha))
          .forEach(a=>previstos.push({
            fecha, ninera_nombre: a.ninera_nombre, familia_nombre: a.familias?.nombre || '', hora_inicio: a.hora_inicio, hora_fin: a.hora_fin, esFijo: true,
            asignacion_id: a.id, tipo: tipoAsignacion(a), cobro_traslado: a.cobro_traslado ?? null, pago_traslado: a.pago_traslado ?? null,
            ninera_id: a.ninera_id ?? null, pago_hora: a.pago_hora ?? null,
          }));
      });
    }

    dashPendientesHoy = previstos.filter(p=>{
      const key = p.fecha+'|'+normaliza(p.ninera_nombre||'')+'|'+normaliza(p.familia_nombre||'');
      return !registradosSet.has(key);
    }).sort((a,b)=> a.fecha.localeCompare(b.fecha));

    const el = document.getElementById('dash-pend-num');
    if(el) el.textContent = dashPendientesHoy.length;
  }catch(e){}
}

/* Aviso si la carga automática de las 03:00 no anduvo (mejora 7, 06/10/2026). Antes solo se
   notaba porque los días aparecían en "Sin registrar". Dos señales: un previsto de hoy o de
   antes que sigue sin confirmar (la corrida confirma los de hoy), o un día de un fijo de la
   próxima semana sin su fila (ni la automática ni una cargada a mano). Se mira desde las 04:00
   de Montevideo, con los fijos automáticos prendidos. "Cargarlos ahora" corre la misma carga.
   13/10/2026: usa la misma regla que generar_previstos_fijos (desde mañana, solo fijos con hora
   de inicio). Un fijo sin hora de inicio contaba como "sin cargar", la carga nunca lo genera y
   el aviso quedaba prendido para siempre: ahora se avisa que a ese fijo le falta el horario. */
function horaActualMontevideo(){
  return Number(new Intl.DateTimeFormat('en-GB', {hour:'2-digit', hourCycle:'h23', timeZone:ZONA_NEGOCIO}).format(new Date()));
}
// Misma regla que generar_previstos_fijos: días como lista y hora de inicio cargada.
function fijoSeGeneraSolo(a){ return Array.isArray(a.dias) && a.dias.length > 0 && !!a.hora_inicio; }
async function revisarCorridaFijos(){
  const box = document.getElementById('dash-corrida');
  await esperarConfigFijos();
  if(!box) return;
  if(!fijosAutomaticosActivos || horaActualMontevideo() < 4){ box.innerHTML = ''; return; }
  const hoy = todayISO(), desde = sumarDiasISO(hoy, 1), hasta = sumarDiasISO(hoy, 6);
  const [{data:sinConfirmar, error:e1}, {data:asigs, error:e2}, {data:filas, error:e3}, pausas] = await Promise.all([
    sb.from('sittings_traslados').select('id').eq('estado', 'previsto').lte('fecha', hoy).limit(1),
    sb.from('asignaciones').select('*, familias(nombre)'),
    sb.from('sittings_traslados').select('asignacion_id,fecha,familia_id,ninera_nombre').gte('fecha', desde).lte('fecha', hasta),
    cargarPausasFijos(),
  ]);
  if(!document.getElementById('dash-corrida')) return;
  if(e1 || e2 || e3){ box.innerHTML = ''; return; } // sin datos no se acusa a nadie
  const porAsig = new Set((filas||[]).filter(r=>r.asignacion_id).map(r=>r.asignacion_id+'|'+r.fecha));
  const aMano = new Set((filas||[]).filter(r=>!r.asignacion_id).map(r=>r.fecha+'|'+r.familia_id+'|'+normaliza(r.ninera_nombre||'')));
  let faltan = 0;
  const sinHorario = new Map(); // fijos vigentes esta semana que la carga no puede generar
  rangoFechas(desde, hasta).forEach(fecha=>{
    const dia = diaSemanaDeISO(fecha);
    (asigs||[]).forEach(a=>{
      if(!Array.isArray(a.dias) || !a.dias.includes(dia) || !asignacionVigenteEn(a, fecha) || fijoPausadoEn(pausas, a.id, fecha)) return;
      if(porAsig.has(a.id+'|'+fecha) || aMano.has(fecha+'|'+a.familia_id+'|'+normaliza(a.ninera_nombre||''))) return;
      if(!fijoSeGeneraSolo(a)){ sinHorario.set(a.id, a); return; }
      faltan++;
    });
  });
  const viejos = (sinConfirmar||[]).length > 0;
  const avisos = [];
  if(faltan || viejos){
    const que = [faltan ? `${faltan} ${faltan===1?'día':'días'} de fijos de esta semana sin cargar` : '', viejos ? 'días de hoy o anteriores sin confirmar' : ''].filter(Boolean).join(' y ');
    avisos.push(`<div class="warnbox corrida-aviso" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;"><b>La carga automática de los fijos de esta noche no anduvo.</b> Hay ${que}. Avisale a Diego.</div>
      <button class="smallbtn" onclick="conGuardado(this, ()=>cargarFijosAhora())">Cargarlos ahora</button>
    </div>`);
  }
  [...sinHorario.values()].forEach(a=>{
    avisos.push(`<div class="warnbox fijo-sin-horario" style="margin-bottom:12px;">Al fijo de <b>${escaparHtml(a.ninera_nombre||'(sin niñera)')}</b> con ${escaparHtml(a.familias?.nombre||'(familia)')} le falta el horario: no se carga solo en la Agenda. Completalo en la Agenda (Editar horarios futuros).</div>`);
  });
  box.innerHTML = avisos.join('');
}
async function cargarFijosAhora(){
  const ok = await sincronizarPrevistosFijos();
  if(ok === false) return; // sincronizarPrevistosFijos ya avisó qué falló
  toast('Listo: los fijos quedaron cargados.');
  await revisarCorridaFijos();
  if(document.getElementById('dash-pend-num')) loadDashboardData();
}

/* Datos que faltan (mejora 6, 06/10/2026): lo que hace que pagos, cobros y previstos no salgan
   solos. Solo de quien trabaja ahora (con un fijo vigente o algo en los últimos 60 días), para
   que la lista sea corta: niñeras sin teléfono o sin cuenta para pagarles, y familias con
   sittings sin la tarifa por hora (los previstos y el cálculo salen en $0). */
let dashDatosFaltan = [];
async function cargarDatosQueFaltan(){
  const box = document.getElementById('dash-faltan');
  if(!box) return;
  const hoy = todayISO();
  const [{data:nins, error:e1}, {data:fams, error:e2}, {data:asigs, error:e3}, {data:sits, error:e4}] = await Promise.all([
    sb.from('ninieras').select('id,nombre,telefono,cuenta_bancaria,activa').eq('activa', true),
    sb.from('familias').select('id,nombre,cobro_hora,pago_hora'),
    sb.from('asignaciones').select('*'),
    sinPrevistos(sb.from('sittings_traslados').select('familia_id,ninera_id,ninera_nombre,tipo')).gte('fecha', sumarDiasISO(hoy, -60)).lte('fecha', hoy),
  ]);
  if(!document.getElementById('dash-faltan')) return;
  if(e1 || e2 || e3 || e4){ box.innerHTML = ''; return; }
  const vigentes = (asigs||[]).filter(a=>!asignacionTerminada(a, hoy));
  const ninTrabaja = new Set(), ninTrabajaNombre = new Set(), famSitting = new Set();
  vigentes.forEach(a=>{
    if(a.ninera_id) ninTrabaja.add(a.ninera_id); else ninTrabajaNombre.add(normaliza(a.ninera_nombre||''));
    if(tipoAsignacion(a)==='sitting' && a.familia_id) famSitting.add(a.familia_id);
  });
  (sits||[]).forEach(r=>{
    if(r.ninera_id) ninTrabaja.add(r.ninera_id); else ninTrabajaNombre.add(normaliza(r.ninera_nombre||''));
    if(r.tipo==='sitting' && r.familia_id) famSitting.add(r.familia_id);
  });
  const sinCuenta = c => !(Array.isArray(c) ? c.some(x=>String(x||'').trim()) : String(c||'').trim());
  const items = [];
  (nins||[]).filter(n=>ninTrabaja.has(n.id) || ninTrabajaNombre.has(normaliza(n.nombre||''))).forEach(n=>{
    const falta = [!String(n.telefono||'').trim() ? 'el teléfono' : '', sinCuenta(n.cuenta_bancaria) ? 'la cuenta para pagarle' : ''].filter(Boolean);
    if(falta.length) items.push({tipo:'ninera', id:n.id, nombre:n.nombre, falta:falta.join(' y ')});
  });
  (fams||[]).filter(f=>famSitting.has(f.id)).forEach(f=>{
    const falta = [!Number(f.cobro_hora) ? 'cuánto se le cobra por hora' : '', !Number(f.pago_hora) ? 'cuánto se le paga a la niñera por hora' : ''].filter(Boolean);
    if(falta.length) items.push({tipo:'familia', id:f.id, nombre:f.nombre, falta:falta.join(' y ')});
  });
  dashDatosFaltan = items.sort((a,b)=>a.tipo.localeCompare(b.tipo) || String(a.nombre||'').localeCompare(String(b.nombre||''), 'es'));
  if(!dashDatosFaltan.length){ box.innerHTML = ''; return; }
  box.innerHTML = `<div class="card datos-faltan-card">
    <h2 style="margin:0 0 4px;">Datos que faltan (${dashDatosFaltan.length})</h2>
    <div class="helper" style="margin:0 0 8px;">De niñeras y familias con las que se trabaja ahora. Sin estos datos, los pagos, los cobros y los fijos no salen solos.</div>
    ${dashDatosFaltan.map(it=>`<div class="agendarow" style="border-bottom:1px solid var(--line);gap:8px;flex-wrap:wrap;">
      <div><b>${escaparHtml(it.nombre||'(sin nombre)')}</b> <span class="helper" style="margin:0;">· ${it.tipo==='ninera'?'niñera':'familia'} · falta ${escaparHtml(it.falta)}</span></div>
      <button class="smallbtn" onclick="abrirFichaDesdeHoy(${argJs(it.tipo)}, ${argJs(it.id)})">Completar</button>
    </div>`).join('')}
  </div>`;
}
async function abrirFichaDesdeHoy(tipo, id){
  await setModulo(tipo==='familia' ? 'familias' : 'ninieras');
  await abrirFichaCuandoCargue(tipo, id);
}
// El módulo carga su lista después de dibujarse: se espera a que esté (hasta 5 s).
async function abrirFichaCuandoCargue(tipo, id){
  const esFamilia = tipo==='familia';
  if(!esFamilia) return abrirFichaNineraCuandoCargue(id);
  for(let i=0; i<50; i++){
    if((familiasItems||[]).some(x=>x.id===id)) break;
    await new Promise(r=>setTimeout(r, 100));
  }
  verFamilia(id);
}

// Niñeras: se espera la carga de la lista que está en curso. Si no está en la lista (dada de baja:
// cargarNinieras trae solo las activas, 30/10/2026), su fila se lee y se abre igual, en vez de esperar
// 5 s y no hacer nada (llega desde Hoy o del push del chat). Se lee cada vez que se abre: la copia de
// antes puede estar vieja (se editó, o la cambió otra admin) y "Editar" guardaría encima. Va con el
// mismo select que la lista: la ficha usa casi todas las columnas, y una lista a mano se rompería con
// una base sin migrar. Si la lectura falla, se avisa (30/10/2026): antes tocar la fila no hacía nada.
async function abrirFichaNineraCuandoCargue(id){
  const enLista = () => (ninierasItems||[]).some(x=>x.id===id);
  if(!enLista() && ninCargaEnVuelo) await ninCargaEnVuelo.catch(()=>{});
  if(!enLista()){
    let data = null, error = null;
    try{ ({ data, error } = await sb.from('ninieras').select('*, candidatas(*)').eq('id', id).maybeSingle()); }
    catch(e){ error = e; }
    if(error){
      console.error('[ficha niñera]', error);
      toast('No se pudo abrir la ficha de la niñera. Revisá tu conexión.', 'bad');
      return;
    }
    if(!data) return;
    nineraFueraDeLista = data;
  }
  await verNinera(id);
}
// Abre la ficha de la niñera en el chat: tarjeta de Hoy, campanita y el push a las admins (30/10/2026).
// cambiarModulo false: Niñeras ya se está pintando (el link del push) y solo falta esperar la lista.
async function abrirChatDeNinera(id, { cambiarModulo = true } = {}){
  chatFichaEnfocar = id; // pintarChatFicha (ninieras.js) lleva la ficha hasta el chat
  try {
    if(cambiarModulo) await abrirFichaDesdeHoy('ninera', id);
    else await abrirFichaCuandoCargue('ninera', id);
  } finally {
    if(chatFichaEnfocar === id) chatFichaEnfocar = null; // no se abrió: que no la lleve otra ficha
  }
}

/* Mensajes de niñeras (fase 1, etapa 3, 30/10/2026): una fila por niñera con mensajes del chat que
   ninguna admin leyó todavía, con cuántos y el último recortado; la que escribió último, arriba.
   Tocarla abre su ficha en el chat, que los marca leídos. Se carga aparte, sin frenar el resto de
   Hoy. Sin mensajes, si la lectura falla o sin la migración de la etapa 3, no se muestra. */
let dashChatNinieras = [];
let dashChatLectura = 0; // cada lectura suma uno: solo pinta la última (vuelven en desorden)
function recortarMensajeHoy(texto, max = 90){
  const t = String(texto||'').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}
async function cargarMensajesNinerasHoy(){
  const box = document.getElementById('dash-chat');
  if(!box) return;
  const lectura = ++dashChatLectura;
  if(chatTablasSinMigrar){ pintarSiCambio(box, ''); return; }
  const { data, error } = await sb.from('chat_mensajes').select('ninera_id,texto,creado_en')
    .eq('de', 'ninera').is('leido_admin_en', null).order('creado_en', { ascending:false }).limit(500);
  if(error && esFaltaTabla(error)) chatTablasSinMigrar = true;
  else if(!error) chatTablasSinMigrar = false;
  const grupos = new Map();
  (error ? [] : data||[]).forEach(m=>{
    const g = grupos.get(m.ninera_id);
    if(g) g.cant++;
    else grupos.set(m.ninera_id, { id:m.ninera_id, cant:1, ultimo:m.texto });
  });
  // Los nombres, de la lista de Niñeras si ya está; si no, una sola lectura para las que falten.
  const nombres = new Map((ninierasItems||[]).map(n=>[n.id, n.nombre]));
  const faltan = [...grupos.keys()].filter(id=>!nombres.has(id));
  if(faltan.length){
    const { data: ns } = await sb.from('ninieras').select('id,nombre').in('id', faltan);
    (ns||[]).forEach(n=>nombres.set(n.id, n.nombre));
  }
  const caja = document.getElementById('dash-chat');
  if(!caja || lectura !== dashChatLectura) return;
  dashChatNinieras = [...grupos.values()].map(g=>({ ...g, nombre: nombres.get(g.id) || 'Niñera' }));
  if(!dashChatNinieras.length){ pintarSiCambio(caja, ''); return; }
  asegurarEstilosChat();
  pintarSiCambio(caja, `<div class="card chat-hoy-card">
    <h2 style="margin:0 0 6px;">Mensajes de niñeras</h2>
    ${dashChatNinieras.map(g=>`<button type="button" class="chat-hoy-fila" onclick="abrirChatDeNinera(${argJs(g.id)})">
      <span class="chat-hoy-cuerpo"><b>${escaparHtml(g.nombre)}</b><span class="chat-hoy-ultimo">${escaparHtml(recortarMensajeHoy(g.ultimo))}</span></span>
      <span class="chat-hoy-cant" aria-label="${g.cant} sin leer">${g.cant}</span>
    </button>`).join('')}
  </div>`);
}

/* Confirmados automáticamente (fijos automáticos, 06/10/2026): los días de los fijos se
   confirman solos cuando llegan. Acá queda una lista corta de los que ya pasaron y nadie
   miró todavía (ayer, o los últimos días si no entraron), para revisarlos de un vistazo y
   marcar "no fue", otra hora o el reemplazo si hace falta. "Sí" los saca de la lista. */
let dashAutoConfirmados = [];
async function cargarConfirmadosAutomaticos(){
  const box = document.getElementById('dash-autoconf');
  await esperarConfigFijos();
  if(!box || !fijosAutomaticosActivos){ if(box) box.innerHTML = ''; return; }
  const { data, error } = await sb.from('sittings_traslados').select('*')
    .eq('generado_automatico', true).is('revisado_at', null).eq('cancelado', false)
    .gte('fecha', diasAtras(PENDIENTE_DIAS_ATRAS)).lt('fecha', todayISO()).order('fecha').order('hora_inicio');
  if(!document.getElementById('dash-autoconf')) return;
  if(error){ box.innerHTML = ''; return; }
  dashAutoConfirmados = data || [];
  if(!dashAutoConfirmados.length){ box.innerHTML = ''; return; }
  const fmt = iso => new Date(iso+'T12:00:00').toLocaleDateString('es-UY',{weekday:'short',day:'2-digit',month:'2-digit'});
  const hhmm = h => escaparHtml(String(h||'').slice(0,5));
  const plata = n => '$'+Number(n||0).toLocaleString('es-UY');
  // Cierre de los fijos (21/10/2026, de las maquetas): en vez de un "Bien" genérico, la pregunta
  // concreta "¿Terminó a las 19:00?". "Otra hora" deja cambiar la hora de entrada y la de fin, y
  // recalcula el precio con la tarifa.
  box.innerHTML = `<div class="card autoconf-card">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;">
      <h2 style="margin:0;">Cierre de los fijos</h2>
      <button class="smallbtn" onclick="conGuardado(this, ()=>marcarAutoRevisados(dashAutoConfirmados.map(r=>r.id)))">Sí a todos</button>
    </div>
    <div class="helper" style="margin:4px 0 8px;">Se cargaron solos con el horario previsto. Confirmá cómo fue cada uno.</div>
    ${dashAutoConfirmados.map(r=>`<div class="autoconf-fila" data-autoconf="${escaparHtml(r.id)}">
      <div class="autoconf-txt">
        <div><b>${fmt(r.fecha)}</b> · ${escaparHtml(r.ninera_nombre)} en ${escaparHtml(r.familia_nombre)}</div>
        <div class="helper" style="margin:2px 0 0;">${r.tipo==='traslado'?'Traslado':'Sitting'} previsto ${hhmm(r.hora_inicio)}${r.hora_fin?'–'+hhmm(r.hora_fin):''} · cobro ${plata(r.cobro_familia)} · pago ${plata(r.pago_ninera)}.${r.hora_fin?` ¿Terminó a las ${hhmm(r.hora_fin)}?`:''}</div>
      </div>
      <div class="autoconf-btns">
        <button class="smallbtn" onclick="conGuardado(this, ()=>marcarAutoRevisados([${argJs(r.id)}]))">${r.hora_fin ? `Sí, terminó ${hhmm(r.hora_fin)}` : 'Sí, fue así'}</button>
        <button class="smallbtn" onclick="abrirOtraHoraAuto(${argJs(r.id)})">Otra hora</button>
        ${variantesPrecioDisponible && r.familia_id ? `<button class="smallbtn" onclick="abrirVariantesAuto(${argJs(r.id)})">Variantes</button>` : ''}
        <button class="smallbtn" onclick="conGuardado(this, ()=>marcarAutoNoFue(${argJs(r.id)}))">No fue</button>
        <button class="smallbtn" onclick="abrirReemplazoAuto(${argJs(r.id)})">Fue otra</button>
      </div>
    </div>`).join('')}
  </div>`;
}
async function marcarAutoRevisados(ids){
  if(!ids.length) return;
  if(!(await sbGuardar(sb.from('sittings_traslados').update({ revisado_at: new Date().toISOString() }).in('id', ids), 'la revisión'))) return;
  toast(ids.length===1 ? 'Listo.' : `Listo: ${ids.length} días revisados.`);
  await cargarConfirmadosAutomaticos();
}
async function marcarAutoNoFue(id){
  const r = dashAutoConfirmados.find(x=>x.id===id);
  if(!r) return;
  if(r.cobrado || r.pagado){ toast('Ese día ya está marcado como cobrado o pagado: corregilo desde Sittings & traslados.', 'bad'); return; }
  if(!(await confirmarAccion(`¿${r.ninera_nombre} no fue el ${new Date(r.fecha+'T12:00:00').toLocaleDateString('es-UY',{day:'numeric',month:'long'})} a lo de ${r.familia_nombre}? Queda en $0, sin cobro ni pago.`, 'Sí, no fue'))) return;
  if(!(await sbGuardar(sb.from('sittings_traslados').update({
    cancelado: true, cobro_familia: 0, pago_ninera: 0, cobrado: true, pagado: true,
    generado_automatico: false, revisado_at: new Date().toISOString(),
    notas: `${r.ninera_nombre} no fue — sin reemplazo`,
  }).eq('id', id), 'el cambio'))) return;
  toast('Listo: ese día no fue nadie.');
  await cargarConfirmadosAutomaticos();
}
/* "Otra hora" (21/10/2026): la hora de entrada y la de fin reales de ese día. En un sitting, el
   cobro y el pago se recalculan con la tarifa de la familia y las reglas de siempre
   (precioSegunHorario: términos y redondeo); en un traslado solo cambia la hora. El pago por hora
   (01/11/2026) es el de un día de fijo: el precio propio del fijo si lo hizo su niñera, si no el de
   la niñera de ese día con esa familia, si no la tarifa (precioHoraNinera). */
let dashOtraHoraFamilia = null;
async function abrirOtraHoraAuto(id){
  const r = dashAutoConfirmados.find(x=>x.id===id);
  if(!r) return;
  if(r.cobrado || r.pagado){ toast('Ese día ya está marcado como cobrado o pagado: corregilo desde Sittings & traslados.', 'bad'); return; }
  dashOtraHoraFamilia = null;
  if(r.tipo!=='traslado' && r.familia_id){
    // Sin la tarifa se guardaría la hora nueva con el precio viejo: mejor no abrir. La familia, los
    // precios de esa niñera y el del fijo, juntos.
    const [{ data, error }, precios, fijo] = await Promise.all([
      leerFamiliasConTerminos('id,nombre,cobro_hora,pago_hora', q=>q.eq('id', r.familia_id)),
      r.ninera_id ? leerPreciosNinera(r.familia_id, r.ninera_id) : [],
      r.asignacion_id ? sb.from('asignaciones').select('ninera_id,ninera_nombre,pago_hora').eq('id', r.asignacion_id).maybeSingle() : { data: null },
    ]);
    if(error || fijo.error){ toast('No se pudo leer la tarifa de la familia. Probá de nuevo.', 'bad'); return; }
    if(preciosNoLeidos(precios)){ toast(AVISO_PRECIOS_NO_LEIDOS, 'bad'); return; }
    const fam = (data||[])[0] || null;
    dashOtraHoraFamilia = fam && { ...fam, pago_hora: precioHoraNinera(fam, r.ninera_id || null, precios, pagoFijoDeNinera(fijo.data, r.ninera_id || null, r.ninera_nombre)) };
  }
  const esSitting = r.tipo!=='traslado';
  abrirModal(`
    <h2 style="margin:0 0 4px;padding-right:32px;">¿A qué hora fue?</h2>
    <div class="helper" style="margin-bottom:12px;">${escaparHtml(r.ninera_nombre)} en ${escaparHtml(r.familia_nombre)} · ${new Date(r.fecha+'T12:00:00').toLocaleDateString('es-UY',{weekday:'long',day:'numeric',month:'long'})}. Previsto ${escaparHtml(String(r.hora_inicio||'').slice(0,5))}${r.hora_fin?'–'+escaparHtml(r.hora_fin.slice(0,5)):''}.</div>
    <div class="grid2">
      <div class="field"><label>${esSitting ? 'Entró a las' : 'Hora'}</label>${selectHora('autoconf-hi')}</div>
      ${esSitting ? `<div class="field"><label>Terminó a las</label>${selectHora('autoconf-hf')}</div>` : ''}
    </div>
    ${esSitting ? `<label class="chk" style="margin:0 0 8px;"><input type="checkbox" id="autoconf-cruza" ${r.termina_dia_siguiente?'checked':''}> Termina al día siguiente</label>` : ''}
    <div id="autoconf-precio" class="helper" style="margin:4px 0 0;"></div>
    <div id="autoconf-warn"></div>
    <div class="confirmbtns">
      <button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primary" onclick="conGuardado(this, ()=>guardarOtraHoraAuto(${argJs(id)}))">Guardar</button>
    </div>`);
  setHoraSelect('autoconf-hi', r.hora_inicio||'');
  if(esSitting) setHoraSelect('autoconf-hf', r.hora_fin||'');
  const box = document.querySelector('#editmodal .confirmbox');
  box?.addEventListener('change', ()=>pintarPrecioOtraHoraAuto(r));
  pintarPrecioOtraHoraAuto(r);
}
// Lo que se va a guardar: horas y, en un sitting con tarifa, el precio recalculado. Si el
// horario no sirve, `error` dice por qué.
function otraHoraAutoElegida(r){
  const hi = leerHora('autoconf-hi');
  if(!hi) return { error: 'Elegí la hora.' };
  if(r.tipo==='traslado') return { cambios: { hora_inicio: hi } };
  const hf = leerHora('autoconf-hf');
  const cruza = document.getElementById('autoconf-cruza')?.checked || false;
  if(!hf) return { error: 'Elegí a qué hora terminó.' };
  if(!cruza && hf<=hi) return { error: 'La hora de fin tiene que ser después de la de entrada. Si terminó pasada la medianoche, marcá "Termina al día siguiente".' };
  if(cruceMedianocheMalMarcado(hi, hf, cruza)) return { error: AVISO_CRUCE_MEDIANOCHE };
  const cambios = { hora_inicio: hi, hora_fin: hf, termina_dia_siguiente: cruza };
  const calc = dashOtraHoraFamilia ? precioSegunHorario(dashOtraHoraFamilia, hi, hf, cruza, r.fecha) : {};
  if(calc.cobro!=null) cambios.cobro_familia = calc.cobro;
  if(calc.pago!=null) cambios.pago_ninera = calc.pago;
  return { cambios };
}
function pintarPrecioOtraHoraAuto(r){
  const box = document.getElementById('autoconf-precio');
  if(!box) return;
  const { cambios, error } = otraHoraAutoElegida(r);
  if(error || r.tipo==='traslado'){ box.textContent = ''; return; }
  const plata = n => '$'+Number(n||0).toLocaleString('es-UY');
  box.textContent = cambios.cobro_familia!=null || cambios.pago_ninera!=null
    ? `Queda: cobro ${plata(cambios.cobro_familia ?? r.cobro_familia)} · pago ${plata(cambios.pago_ninera ?? r.pago_ninera)}.`
    : 'La familia no tiene tarifa por hora: el precio queda como estaba.';
}
async function guardarOtraHoraAuto(id){
  const r = dashAutoConfirmados.find(x=>x.id===id);
  const warn = document.getElementById('autoconf-warn');
  if(!r) return;
  const { cambios, error: problema } = otraHoraAutoElegida(r);
  if(problema){ warn.innerHTML = `<div class="warnbox">${escaparHtml(problema)}</div>`; return; }
  // Solo si sigue sin cobrar ni pagar (si otra admin lo marcó mientras tanto, no se toca).
  const { data, error } = await sb.from('sittings_traslados')
    .update({ ...cambios, generado_automatico: false, revisado_at: new Date().toISOString() })
    .eq('id', id).eq('cobrado', false).eq('pagado', false).select('id');
  if(error){ warn.innerHTML = errBox(error); return; }
  if(!data || !data.length){ warn.innerHTML = '<div class="warnbox">No se guardó: mientras tanto alguien lo marcó como cobrado o pagado. Corregilo desde Sittings &amp; traslados.</div>'; return; }
  cerrarModal();
  toast('Listo: quedó con el horario real.');
  await cargarConfirmadosAutomaticos();
}
/* "Variantes" (23/10/2026): los botones de variantes de la familia y el ajuste libre sobre el
   precio de ese día ("la llevó a la casa"). La base es el precio que tenía (o la base guardada,
   si ya tenía variantes); se guarda con las variantes y queda anotado cuáles. */
function abrirVariantesAuto(id){
  const r = dashAutoConfirmados.find(x=>x.id===id);
  if(!r) return;
  if(r.cobrado || r.pagado){ toast('Ese día ya está marcado como cobrado o pagado: corregilo desde Sittings & traslados.', 'bad'); return; }
  const base = r.precio_variantes?.base || { cobro: Number(r.cobro_familia)||0, pago: Number(r.pago_ninera)||0 };
  abrirModal(`
    <h2 style="margin:0 0 4px;padding-right:32px;">Variantes de ese día</h2>
    <div class="helper" style="margin-bottom:12px;">${escaparHtml(r.ninera_nombre)} en ${escaparHtml(r.familia_nombre)} · ${new Date(r.fecha+'T12:00:00').toLocaleDateString('es-UY',{weekday:'long',day:'numeric',month:'long'})} · ${r.tipo==='traslado' ? 'traslado' : 'sitting'} a $${Number(base.cobro).toLocaleString('es-UY')} / $${Number(base.pago).toLocaleString('es-UY')}.</div>
    <div id="cierre-variantes"><div class="empty"><span class="spinner dark"></span> Cargando…</div></div>
    <div id="autoconf-warn"></div>
    <div class="confirmbtns">
      <button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primary" onclick="conGuardado(this, ()=>guardarVariantesAuto(${argJs(id)}))">Guardar</button>
    </div>`);
  prepararVariantesPrecio('cierre', { familiaId: r.familia_id, tipo: r.tipo, asignacionId: r.asignacion_id, aplicadas: r.precio_variantes?.aplicadas || [], base: ()=>base })
    .then(()=>{
      const box = document.getElementById('cierre-variantes');
      if(box && variantesUI.cierre?.inactivo) box.innerHTML = '<div class="helper">Las variantes de precio todavía no están activadas en la base. Avisale a Diego.</div>';
    });
}
async function guardarVariantesAuto(id){
  const r = dashAutoConfirmados.find(x=>x.id===id);
  const warn = document.getElementById('autoconf-warn');
  if(!r) return;
  const vars = leerVariantesPrecio('cierre');
  if(vars.error){ warn.innerHTML = `<div class="warnbox">${escaparHtml(vars.error)}</div>`; return; }
  // Sin variantes antes ni ahora no hay nada que cambiar (se conserva el motivo de un precio a mano).
  if(vars.inactivo || (!vars.aplicadas && !r.precio_variantes)){ cerrarModal(); return; }
  const base = r.precio_variantes?.base || { cobro: Number(r.cobro_familia)||0, pago: Number(r.pago_ninera)||0 };
  const cambios = vars.aplicadas
    ? { ...aplicarVariantes(base.cobro, base.pago, vars.aplicadas), precio_variantes: { base, aplicadas: vars.aplicadas }, precio_motivo: vars.motivo }
    : { cobro: base.cobro, pago: base.pago, precio_variantes: null, precio_motivo: null };
  // Solo si sigue sin cobrar ni pagar (si otra admin lo marcó mientras tanto, no se toca).
  const { data, error } = await sb.from('sittings_traslados')
    .update({ cobro_familia: cambios.cobro, pago_ninera: cambios.pago, precio_variantes: cambios.precio_variantes, precio_motivo: cambios.precio_motivo,
      generado_automatico: false, revisado_at: new Date().toISOString() })
    .eq('id', id).eq('cobrado', false).eq('pagado', false).select('id');
  if(error){ warn.innerHTML = errBox(error); return; }
  if(!data || !data.length){ warn.innerHTML = '<div class="warnbox">No se guardó: mientras tanto alguien lo marcó como cobrado o pagado. Corregilo desde Sittings &amp; traslados.</div>'; return; }
  cerrarModal();
  toast(vars.aplicadas ? 'Listo: quedó con las variantes.' : 'Listo: quedó sin variantes.');
  await cargarConfirmadosAutomaticos();
}
let dashReemplazoSel = null;
let dashReemplazoLista = []; // las niñeras activas de la lista, para buscar el nombre escrito entero
async function abrirReemplazoAuto(id){
  const r = dashAutoConfirmados.find(x=>x.id===id);
  if(!r) return;
  dashReemplazoSel = null;
  // La lista se trae ANTES de abrir el modal: si se conectaba después, quien escribía rápido
  // no veía ninguna opción (el autocompletar todavía no estaba enganchado).
  const { data: ninieras } = await sb.from('ninieras').select('id,nombre').eq('activa', true).order('nombre');
  dashReemplazoLista = ninieras || [];
  abrirModal(`
    <h2 style="margin:0 0 4px;">¿Quién fue en lugar de ${escaparHtml(r.ninera_nombre)}?</h2>
    <div class="helper" style="margin-bottom:12px;">${escaparHtml(r.familia_nombre)} · ${new Date(r.fecha+'T12:00:00').toLocaleDateString('es-UY',{weekday:'long',day:'numeric',month:'long'})}. ${r.tipo==='traslado' ? 'Mismo horario y montos' : 'Mismo horario. Se le paga su precio con esta familia'}; si algo cambió, editalo después en Sittings &amp; traslados.</div>
    <div class="field" style="position:relative;"><label>Niñera</label>
      <input type="text" id="autoconf-ninera" autocomplete="off" oninput="dashReemplazoSel=null;">
      <div id="autoconf-ninera-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
    </div>
    <div id="autoconf-warn"></div>
    <div class="confirmbtns">
      <button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primary" onclick="conGuardado(this, ()=>guardarReemplazoAuto(${argJs(id)}))">Guardar</button>
    </div>`);
  attachAutocomplete('autoconf-ninera', 'autoconf-ninera-dropdown', ()=>ninieras||[], o=>{ dashReemplazoSel = o; });
}
async function guardarReemplazoAuto(id){
  const r = dashAutoConfirmados.find(x=>x.id===id);
  const warn = document.getElementById('autoconf-warn');
  const nombre = document.getElementById('autoconf-ninera')?.value.trim();
  if(!r) return;
  if(!nombre){ warn.innerHTML = '<div class="warnbox">Elegí quién fue.</div>'; return; }
  if(normaliza(nombre)===normaliza(r.ninera_nombre)){ warn.innerHTML = '<div class="warnbox">Esa es la niñera que ya figura.</div>'; return; }
  if(r.pagado){ warn.innerHTML = '<div class="warnbox">Ese día ya está marcado como pagado: corregilo desde Sittings &amp; traslados.</div>'; return; }
  // Elegida de la lista o escrita entera (sin tildes ni mayúsculas), como findNinera en Sittings: si no, se
  // guardaba sin ninera_id y con la tarifa aunque tuviera su precio (revisión final, 31/10/2026).
  const sel = (dashReemplazoSel && normaliza(dashReemplazoSel.nombre)===normaliza(nombre) ? dashReemplazoSel : null)
    || dashReemplazoLista.find(n=>normaliza(n.nombre)===normaliza(nombre)) || null;
  const nombreFue = sel?.nombre || nombre;
  const cambios = {
    ninera_nombre: nombreFue, ninera_id: sel?.id || null, generado_automatico: false,
    revisado_at: new Date().toISOString(), notas: `Reemplazo de ${r.ninera_nombre}`,
  };
  // Un sitting (01/11/2026, respuesta 2 de Diego): la que fue cobra su precio con esta familia o la
  // tarifa, nunca el precio propio del fijo (es de la titular). Lo que paga la familia no cambia. Con
  // variantes ya aplicadas, el pago nuevo es la base y se vuelven a aplicar. Un traslado sigue igual.
  if(r.tipo!=='traslado' && r.familia_id && r.hora_inicio && r.hora_fin){
    const [{ data: fams, error: eFam }, precios, fijo] = await Promise.all([
      leerFamiliasConTerminos('id,cobro_hora,pago_hora', q=>q.eq('id', r.familia_id)),
      sel ? leerPreciosNinera(r.familia_id, sel.id) : [],
      r.asignacion_id ? sb.from('asignaciones').select('ninera_id,ninera_nombre,pago_hora').eq('id', r.asignacion_id).maybeSingle() : { data: null },
    ]);
    if(eFam || fijo.error){ warn.innerHTML = '<div class="warnbox">No se pudo leer la tarifa de la familia. Probá de nuevo.</div>'; return; }
    if(preciosNoLeidos(precios)){ warn.innerHTML = `<div class="warnbox">${escaparHtml(AVISO_PRECIOS_NO_LEIDOS)}</div>`; return; }
    const fam = (fams||[])[0] || null;
    const pagoHora = Number(precioHoraNinera(fam, sel?.id || null, precios, pagoFijoDeNinera(fijo.data, sel?.id || null, nombreFue)))||0;
    const horas = horasSitting(r.hora_inicio, r.hora_fin, !!r.termina_dia_siguiente, fam, r.fecha);
    if(pagoHora && horas){
      const pago = redondearPago(horas.real*pagoHora);
      const aplicadas = r.precio_variantes?.aplicadas;
      if(aplicadas?.length){
        const base = { cobro: r.precio_variantes.base?.cobro ?? (Number(r.cobro_familia)||0), pago };
        cambios.pago_ninera = aplicarVariantes(base.cobro, base.pago, aplicadas).pago;
        cambios.precio_variantes = { base, aplicadas };
      } else cambios.pago_ninera = pago;
    }
  }
  const { error } = await sb.from('sittings_traslados').update(cambios).eq('id', id);
  if(error){ warn.innerHTML = errBox(error); return; }
  cerrarModal();
  toast(`Listo: ese día figura ${nombreFue}.`);
  await cargarConfirmadosAutomaticos();
}

function renderPendHoy(cont){
  cont.innerHTML = `
    <button class="backbtn" onclick="setModulo(null)">← Volver</button>
    <h1 class="modtitle">Sittings/traslados sin registrar</h1>
    <div class="helper">Comparando lo previsto de los últimos ${PENDIENTE_DIAS_ATRAS} días (pedidos puntuales confirmados${fijosAutomaticosActivos ? ' y días de los fijos' : ''}) contra lo que ya cargaste en Sittings &amp; traslados.${fijosAutomaticosActivos ? ' Los fijos se cargan solos: si aparece uno acá, es que algo falló y conviene cargarlo.' : ' Los horarios fijos no entran acá — esos se registran aparte.'}</div>
    <div class="card">
      ${dashPendientesHoy.length ? dashPendientesHoy.map(a=>{
        const fechaFmt = new Date(a.fecha+'T00:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'short'});
        const esHoy = a.fecha===todayISO();
        return `
        <div class="agendarow" style="border-bottom:1px solid var(--line);flex-wrap:wrap;gap:8px;">
          <div>
            <div><b>${esHoy?'Hoy':fechaFmt}</b> · ${escaparHtml(a.ninera_nombre)} → ${escaparHtml(a.familia_nombre || 'familia sin nombre')}${a.esFijo ? ' <span class="helper" style="margin:0;">· fijo</span>' : ''}</div>
            <div style="color:var(--ink-soft);">${a.hora_inicio ? a.hora_inicio.slice(0,5) : ''}${a.hora_fin ? '–'+a.hora_fin.slice(0,5) : ''}</div>
          </div>
          <button class="smallbtn" onclick="cargarSittingDesdePendiente(${argJs(a)})">Cargar sitting</button>
        </div>`;
      }).join('') : '<div class="empty">Está todo registrado.</div>'}
    </div>
    <div class="actions"><button class="btn primary" onclick="setModulo('sittings')">Ir a cargar un sitting suelto</button></div>
  `;
}
async function cargarSittingDesdePendiente(item){
  // El día de un fijo se carga como el fijo: vinculado a la asignación, con su tipo y, si es
  // traslado, con su precio. Antes abría siempre como sitting suelto: un traslado fijo quedó
  // como sitting de $0 y ninguno de los dos quedó vinculado al fijo (06/10/2026).
  const traslado = item.tipo==='traslado';
  sitPrefill = {
    familiaNombre: item.familia_nombre,
    nineraNombre: item.ninera_nombre,
    fecha: item.fecha,
    horaInicio: item.hora_inicio,
    horaFin: item.hora_fin,
    tipo: traslado ? 'traslado' : 'sitting',
    asignacionId: item.asignacion_id || null,
    cobro: traslado ? item.cobro_traslado ?? null : null,
    pago: traslado ? item.pago_traslado ?? null : null,
    notas: item.asignacion_id ? `${traslado?'Traslado':'Sitting'} fijo — cargado desde "Sittings sin registrar"` : 'Cargado desde "Sittings sin registrar"',
    // El precio propio del fijo (01/11/2026): el pago sale con él mientras la niñera sea la del fijo.
    fijo: item.asignacion_id && !traslado ? { ninera_id: item.ninera_id ?? null, ninera_nombre: item.ninera_nombre, pago_hora: item.pago_hora ?? null } : null,
  };
  await setModulo('sittings');
  abrirModalSitForm();
}

/* ================= NOTIFICACIONES (campanita) =================
   V1: solo los "urgentes" — sittings de HOY sin asignar y sittings de HOY sin registrar
   (misma lógica que ya usan el panel "Sin resolver · hoy y mañana" y el banner de Hoy,
   pero acotada a hoy). "Leído" es individual por usuaria (tabla notificaciones_leidas).
   "Resuelto" no se marca a mano: si el sitting ya tiene niñera o ya se cargó, deja de
   aparecer en la consulta sola y por lo tanto desaparece de la campanita para las dos.
   El push real al celu (VAPID) queda para una próxima etapa — esto es solo la campanita. */
let notifItems = [];
let notifLeidas = new Set();
let notifPanelAbierto = false;
let notifChannel = null;
let notifRefrescarTimer = null;

function notifUsuario(){ return session?.user?.email || 'desconocida'; }

/* Catálogo único de tipos de notificación — lo usa tanto cargarNotificaciones() (bell) como
   renderNotifConfig() (la pantalla de ajustes) y, en paralelo, la Edge Function (con su
   propia copia en Deno, ver enviar-push-urgentes) para saber qué mandar por push y con qué
   default cuando el usuario nunca tocó el switch. */
/* Aviso de "falta subir el extracto" apagado (23/10/2026): ya no usan Itaú y el lector de
   Mercado Pago todavía no está (ver Pendientes, "Cambio de banco"). Apaga el aviso de Finanzas,
   el de la campanita, el puntito y el switch de las preferencias; la Edge Function
   enviar-push-urgentes tiene su propia marca. El día del lector, se vuelve a prender acá y allá. */
const AVISO_EXTRACTO_ACTIVO = false;
const TIPOS_NOTIF = [
  {tipo:'sin_asignar', label:'Sitting sin asignar', sub:'Hoy, sin niñera confirmada', icono:'agenda', defaultPush:true},
  {tipo:'sin_registrar', label:'Sitting sin registrar', sub:'Ya pasó y falta cargarlo en el sistema', icono:'sittings', defaultPush:false},
  {tipo:'cv_desactualizado', label:'CV de niñera desactualizado', sub:'Cumplió años después de generarlo', icono:'ninieras', defaultPush:true},
  ...(AVISO_EXTRACTO_ACTIVO ? [{tipo:'extracto', label:'Falta subir extracto Itaú', sub:'Hace más de 15 días que no se sube uno nuevo', icono:'finanzas', defaultPush:true}] : []),
  {tipo:'temporada', label:'Pedir la temporada de Punta', sub:'Cada 1 de octubre, con el mensaje listo para mandar', icono:'ninieras', defaultPush:true},
  {tipo:'chat', label:'Mensajes de niñeras', sub:'Cuando una niñera escribe por el chat de la app', icono:'ninieras', defaultPush:true},
  {tipo:'pedidos', label:'Pedidos de la app', sub:'Cuando una niñera dice que puede o entra un pedido de WhatsApp', icono:'agenda', defaultPush:true},
];

async function cargarNotificaciones(){
  if(!session) return;
  const hoyStr = todayISO();
  const [{data:sinAsignar}, {data:sitsHoy}, {data:solConfHoy}, avisosR] = await Promise.all([
    sb.from('solicitudes').select('id,familia_nombre,hora_inicio,tipo').eq('fecha', hoyStr).in('estado', ['sin_asignar','pendiente_confirmar']),
    sb.from('sittings_traslados').select('familia_nombre').eq('fecha', hoyStr),
    sb.from('solicitudes').select('id,familia_nombre,hora_inicio').eq('fecha', hoyStr).eq('estado','confirmada'),
    // Sin la migración de la etapa 3 no se vuelve a pedir (sería un 404 en cada cambio).
    chatTablasSinMigrar ? { data: null, error: null }
      : sb.from('avisos').select('id,tipo,titulo,cuerpo,url,datos,creado_en').not('para_admin', 'is', null)
        .gte('creado_en', new Date(Date.now() - 3*86400000).toISOString()).order('creado_en', { ascending:false }).limit(50),
  ]);
  // Los avisos de la cola para las admins van primero: son de personas (el chat) y no esperan.
  const items = await itemsAvisosAdmin(avisosR);
  (sinAsignar||[]).forEach(s=>{
    items.push({
      id: 'sol:'+s.id,
      tipo: 'sin_asignar',
      titulo: 'Sitting sin asignar',
      mensaje: `${s.familia_nombre||'Familia sin nombre'}, hoy${s.hora_inicio?' '+s.hora_inicio.slice(0,5):''} — sin niñera confirmada`,
      destino: 'agenda',
    });
  });
  if(solConfHoy && solConfHoy.length){
    const registradas = new Set((sitsHoy||[]).map(r=>normaliza(r.familia_nombre||'')));
    const { data: snHoy } = await sb.from('solicitud_ninieras').select('id,ninera_nombre,solicitud_id').in('solicitud_id', solConfHoy.map(s=>s.id)).eq('estado','confirmada');
    const porSol = {};
    (snHoy||[]).forEach(r=>{ (porSol[r.solicitud_id] ||= []).push(r); });
    solConfHoy.forEach(s=>{
      if(registradas.has(normaliza(s.familia_nombre||''))) return;
      (porSol[s.id]||[]).forEach(n=>{
        items.push({
          id: 'sn:'+n.id,
          tipo: 'sin_registrar',
          titulo: 'Sitting sin registrar',
          mensaje: `${n.ninera_nombre} → ${s.familia_nombre||'familia sin nombre'}, hoy${s.hora_inicio?' '+s.hora_inicio.slice(0,5):''} — todavía no se cargó`,
          destino: 'pend-hoy',
        });
      });
    });
  }

  // CV desactualizado: misma condición que ya usa el badge de la lista de Niñeras
  // (cvEstaDesactualizado, en ninieras.js) — la reusamos tal cual, no se duplica la regla.
  try{
    const { data: ninierasActivas } = await sb.from('ninieras').select('id,nombre,cv_generado_en,candidatas(fecha_nacimiento)').eq('activa', true);
    (ninierasActivas||[]).forEach(n=>{
      if(typeof cvEstaDesactualizado === 'function' && cvEstaDesactualizado(n)){
        items.push({
          id: 'cv:'+n.id,
          tipo: 'cv_desactualizado',
          titulo: 'CV desactualizado',
          mensaje: `${n.nombre} cumplió años después de generarle el CV — convendría regenerarlo`,
          destino: 'ninieras',
          abrirId: n.id,
        });
      }
    });
  }catch(e){}

  // Extracto Itaú sin subir hace más de 15 días. El id incluye la fecha límite: mientras
  // no se suba un extracto nuevo, la fecha límite no cambia, así que esto avisa una sola
  // vez por período atrasado (no se repite cada 10 minutos) — recién vuelve a avisar si
  // pasan otros 15 días desde la próxima vez que se suba. Si nunca se subió ninguno (no hay
  // fila todavía), es el caso más urgente de todos, no el motivo para no avisar.
  if(AVISO_EXTRACTO_ACTIVO) try{
    const { data: cfg } = await sb.from('app_config').select('actualizado_at').eq('id','ultima_conciliacion_cobros').maybeSingle();
    if(!cfg?.actualizado_at){
      items.push({
        id: 'extracto:nunca',
        tipo: 'extracto',
        titulo: 'Falta subir el extracto de Itaú',
        mensaje: `Todavía no se subió ningún extracto para conciliar.`,
        destino: 'finanzas',
      });
    } else {
      const limite = new Date(cfg.actualizado_at);
      limite.setDate(limite.getDate()+15);
      if(limite.getTime() <= Date.now()){
        items.push({
          id: 'extracto:'+limite.toISOString().slice(0,10),
          tipo: 'extracto',
          titulo: 'Falta subir el extracto de Itaú',
          mensaje: `Hace más de 15 días que no se sube un extracto nuevo para conciliar.`,
          destino: 'finanzas',
        });
      }
    }
  }catch(e){}

  // Recordatorio anual: desde el 1 de octubre, pedirles a las niñeras la temporada de Punta.
  // Un id por año: queda en la campanita hasta que cada una lo descarta o lo abre.
  const hoyD = new Date(hoyStr+'T12:00:00');
  if(hoyD.getMonth() >= 9){
    items.push({
      id: 'temporada:'+hoyD.getFullYear(),
      tipo: 'temporada',
      titulo: 'Pedir la temporada de Punta',
      mensaje: 'Mandales a las niñeras el link para que carguen en qué fechas van a estar en Punta del Este.',
      destino: 'ninieras',
      accion: 'temporada',
    });
  }

  notifItems = items;
  await cargarNotifLeidas();
  renderNotifBell();
}

/* Avisos de la cola para las admins (fase 1, etapa 3, 30/10/2026): los de los últimos 3 días, con su
   título, su cuerpo y el destino de su url ("?ir=ninieras&ninera=<id>" abre la ficha en el chat). Los
   del chat cuyo mensaje ya leyó alguna admin no se muestran: se resolvieron, como los demás ítems de
   la campanita. Sin la migración (la tabla no existe) la campanita sigue como antes. */
async function itemsAvisosAdmin({ data, error }){
  if(error){ if(esFaltaTabla(error)) chatTablasSinMigrar = true; return []; }
  if(!Array.isArray(data)) return [];
  chatTablasSinMigrar = false;
  suscribirAvisosRealtime();
  const idsMensajes = [...new Set(data.filter(a=>a.tipo==='chat' && a.datos?.mensaje_id).map(a=>a.datos.mensaje_id))];
  const leidos = new Set();
  if(idsMensajes.length){
    const { data: ms, error: e2 } = await sb.from('chat_mensajes').select('id,leido_admin_en').in('id', idsMensajes);
    if(!e2) (ms||[]).forEach(m=>{ if(m.leido_admin_en) leidos.add(m.id); });
  }
  return data.filter(a=>!(a.tipo==='chat' && leidos.has(a.datos?.mensaje_id))).map(a=>{
    const { destino, ninera, solicitud } = destinoDeUrlAviso(a.url);
    return { id: 'aviso:'+a.id, tipo: a.tipo, titulo: a.titulo || 'Aviso', mensaje: a.cuerpo || '', destino, abrirChat: ninera, abrirSolicitud: solicitud };
  });
}
// "?ir=<módulo>&ninera=<id>" (lo mismo que abre el push): a qué módulo va y qué ficha abre en el chat.
function destinoDeUrlAviso(url){
  const q = String(url||'');
  const i = q.indexOf('?');
  if(i < 0) return { destino: null, ninera: null, solicitud: null };
  const p = new URLSearchParams(q.slice(i+1));
  const ir = p.get('ir');
  const valido = !!ir && (ir==='pend-hoy' || MODULOS.some(m=>m.key===ir));
  return { destino: valido ? ir : null, ninera: valido && ir==='ninieras' ? p.get('ninera') : null, solicitud: valido && ir==='agenda' ? p.get('solicitud') : null };
}

async function cargarNotifLeidas(){
  if(!notifItems.length){ notifLeidas = new Set(); return; }
  const { data } = await sb.from('notificaciones_leidas').select('notif_id').eq('usuario', notifUsuario()).in('notif_id', notifItems.map(i=>i.id));
  notifLeidas = new Set((data||[]).map(r=>r.notif_id));
}

function renderNotifBell(){
  const sinLeer = notifItems.filter(i=>!notifLeidas.has(i.id));
  document.querySelectorAll('.notif-badge').forEach(b=>{
    b.textContent = sinLeer.length;
    b.style.display = sinLeer.length ? 'flex' : 'none';
  });
  const panel = document.getElementById('notif-panel');
  if(!panel) return;
  // Ahora solo se muestran las no leídas — deslizar (celu) o tocar la X (compu) las
  // "borra" del panel marcándolas como leídas, así desaparecen solas.
  const cuerpo = sinLeer.length ? sinLeer.map(i=>`
    <div class="notif-item" data-id="${i.id}">
      <div class="notif-item-bg">${ICONS.trash}</div>
      <div class="notif-item-content" onclick="irANotificacion(${argJs(i.id)})">
        <div class="notif-item-ic">${ICONS.alert}</div>
        <div class="notif-item-body">
          <div class="notif-item-title">${escaparHtml(i.titulo)}</div>
          <div class="notif-item-msg">${escaparHtml(i.mensaje)}</div>
        </div>
        <button class="notif-item-xbtn" onclick="event.stopPropagation();marcarNotifLeida(${argJs(i.id)})" aria-label="Descartar" title="Descartar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
    </div>`).join('') : '<div class="notif-empty">No hay avisos urgentes por ahora.</div>';
  panel.innerHTML = `<div class="notif-panel-head">Notificaciones</div>${cuerpo}`;
  activarSwipeNotif();
}

// Deslizar para la izquierda en celu = descartar (como en el centro de notificaciones de
// iOS). En compu no hay touch, ahí se usa el botón X que aparece al pasar el mouse.
function activarSwipeNotif(){
  document.querySelectorAll('.notif-item-content').forEach(el=>{
    let startX = null, dx = 0;
    el.addEventListener('touchstart', e=>{ startX = e.touches[0].clientX; dx = 0; }, {passive:true});
    el.addEventListener('touchmove', e=>{
      if(startX===null) return;
      dx = e.touches[0].clientX - startX;
      if(dx < 0) el.style.transform = `translateX(${Math.max(dx,-100)}px)`;
    }, {passive:true});
    el.addEventListener('touchend', ()=>{
      const id = el.closest('.notif-item')?.dataset.id;
      if(dx < -60 && id){
        el.style.transform = 'translateX(-100%)';
        setTimeout(()=>marcarNotifLeida(id), 160);
      } else {
        el.style.transform = '';
      }
      startX = null; dx = 0;
    });
  });
}

async function irANotificacion(id){
  const item = notifItems.find(i=>i.id===id);
  await marcarNotifLeida(id);
  toggleNotifPanel(false);
  if(!item) return;
  await setModulo(item.destino);
  if(item.abrirId && item.destino==='ninieras' && typeof verNinera==='function'){
    verNinera(item.abrirId);
  }
  if(item.abrirChat && item.destino==='ninieras') await abrirChatDeNinera(item.abrirChat, { cambiarModulo:false });
  if(item.abrirSolicitud && item.destino==='agenda') await abrirSolicitudDeLink(item.abrirSolicitud);
  if(item.accion==='temporada' && typeof abrirRecordatorioTemporada==='function'){
    abrirRecordatorioTemporada();
  }
}

async function marcarNotifLeida(id){
  if(notifLeidas.has(id)) return;
  notifLeidas.add(id);
  renderNotifBell();
  const { error } = await sb.from('notificaciones_leidas').upsert({notif_id:id, usuario:notifUsuario(), leido_en:new Date().toISOString()});
  if(error){
    // No quedó guardada: vuelve a aparecer como no leída, así no se pierde el aviso.
    notifLeidas.delete(id);
    renderNotifBell();
    toast('No se pudo marcar como leída. Revisá tu conexión.', 'bad');
  }
}

function toggleNotifPanel(force){
  notifPanelAbierto = typeof force==='boolean' ? force : !notifPanelAbierto;
  document.getElementById('notif-panel')?.classList.toggle('show', notifPanelAbierto);
}
document.addEventListener('click', (e)=>{
  if(!notifPanelAbierto) return;
  const panel = document.getElementById('notif-panel');
  if(panel && !panel.contains(e.target) && !e.target.closest('.notif-btn')) toggleNotifPanel(false);
});

function suscribirNotifRealtime(){
  if(notifChannel){ sb.removeChannel(notifChannel); notifChannel = null; }
  if(notifAvisosChannel){ sb.removeChannel(notifAvisosChannel); notifAvisosChannel = null; } // vuelve con la próxima lectura de avisos
  notifChannel = sb.channel('rt-notif-'+Date.now());
  ['solicitudes','solicitud_ninieras','sittings_traslados'].forEach(t=>{
    notifChannel.on('postgres_changes', {event:'*', schema:'public', table:t}, ()=>{
      clearTimeout(notifRefrescarTimer);
      notifRefrescarTimer = setTimeout(cargarNotificaciones, 600);
    });
  });
  notifChannel.subscribe();
}

/* Avisos y chat en vivo (30/10/2026): un canal aparte del de arriba, que se abre recién cuando la
   lectura de avisos anduvo. En Realtime, un canal con una tabla que no existe no se une, y se
   llevaría puesta la campanita entera mientras la base no tenga la migración de la etapa 3. Un
   aviso nuevo, un mensaje o uno marcado leído ponen al día la campanita y, si está a la vista, la
   tarjeta "Mensajes de niñeras" de Hoy. */
let notifAvisosChannel = null;
let notifAvisosTimer = null;
function suscribirAvisosRealtime(){
  if(notifAvisosChannel) return;
  const alCambiar = ()=>{
    clearTimeout(notifAvisosTimer);
    notifAvisosTimer = setTimeout(()=>{
      cargarNotificaciones();
      if(document.getElementById('dash-chat')) cargarMensajesNinerasHoy();
    }, 600);
  };
  notifAvisosChannel = sb.channel('rt-notif-avisos-'+Date.now())
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'avisos' }, alCambiar)
    .on('postgres_changes', { event:'*', schema:'public', table:'chat_mensajes' }, alCambiar);
  notifAvisosChannel.subscribe();
}

/* ---- Push real al celular (Web Push + VAPID) ----
   Solo para lo urgente: sittings de hoy sin asignar. La clave privada VAPID vive en la
   tabla app_secrets (sin ninguna policy — solo la Edge Function, con la service role key,
   puede leerla). El envío real lo hace la Edge Function "enviar-push-urgentes", disparada
   por un cron de Supabase cada 10 minutos — no depende de que este chat ni el navegador
   estén abiertos. Acá solo pedimos permiso, nos suscribimos, y guardamos la suscripción.
   VAPID_PUBLIC_KEY y urlBase64ToUint8Array están en comun.js desde el 26/10/2026: las usa
   también la app de niñeras. */
function pushSoportado(){
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
async function pushYaActivado(){
  if(!pushSoportado()) return false;
  try{
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  }catch(e){ return false; }
}
async function activarPushNotificaciones(){
  if(!pushSoportado()){
    toast('Este dispositivo no soporta notificaciones push. En iPhone: agregá la app a la pantalla de inicio primero (compartir → Agregar a inicio) y probá de nuevo desde ahí.');
    return;
  }
  try{
    const permiso = await Notification.requestPermission();
    if(permiso !== 'granted'){
      toast('No se activó — hace falta dar permiso de notificaciones cuando el navegador lo pide.');
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const json = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({
      usuario: notifUsuario(),
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth_key: json.keys.auth,
    }, {onConflict:'endpoint'});
    if(error) throw error;
    toast('Notificaciones push activadas en este dispositivo.');
  }catch(e){
    toast('No se pudo activar el push: '+(e.message||e), 'bad');
  }
  // Una vez activado ya no tiene sentido mostrar la tarjeta "Este dispositivo" (era solo para
  // llegar a este punto) — se vuelve a pintar toda la pantalla para que desaparezca sola.
  if(notifCfgCont) renderNotifConfig(notifCfgCont);
  actualizarNotifNavdot();
}
async function actualizarNotifNavdot(){
  const dot = document.getElementById('notif-navdot');
  if(!dot) return;
  const activo = await pushYaActivado();
  dot.innerHTML = (pushSoportado() && !activo) ? '<span class="navdot"></span>' : '';
}

/* ---- Pantalla "Notificaciones" (sidebar) ----
   Acá vive todo lo de push en un solo lugar: activar el dispositivo, y elegir tipo por tipo
   cuáles mandan push al celular (la campanita siempre muestra todo, esto solo filtra el push).
   Preferencia por usuaria (notif_push_preferencias): si no hay fila guardada, se usa el
   default de TIPOS_NOTIF — mismo criterio que aplica la Edge Function del lado del servidor.
   El mismo puntito rojo que ya usan Agenda y Finanzas (navdot) se prende en este ítem del
   menú mientras ESTE dispositivo no tenga el push activado — así avisa solo, sin que haga
   falta entrar a mirar. Una vez activado, ni el punto ni la tarjeta de "Este dispositivo"
   se muestran más: si ya lo hiciste, confirmarlo cada vez no aporta nada. */
let notifCfgCont = null;
async function renderNotifConfig(cont){
  notifCfgCont = cont;
  cont.innerHTML = '<div class="empty">Cargando…</div>';
  const [{data:prefs}, activo] = await Promise.all([
    sb.from('notif_push_preferencias').select('tipo,activado').eq('usuario', notifUsuario()),
    pushYaActivado(),
  ]);
  const prefMap = {};
  (prefs||[]).forEach(p=>{ prefMap[p.tipo] = p.activado; });
  cont.innerHTML = `
    ${activo ? '' : `
    <div class="card">
      <h2>Este dispositivo</h2>
      ${!pushSoportado()
        ? `<p class="helper">Este dispositivo no soporta notificaciones push.</p>`
        : `<p class="helper" style="margin-bottom:12px;">Activalo una vez por dispositivo (celular, tablet) para recibir avisos aunque tengas la app cerrada. En iPhone hay que agregarlo antes a la pantalla de inicio (compartir → Agregar a inicio).</p>
           <button class="btn" onclick="conGuardado(this, ()=>activarPushNotificaciones())">Activar notificaciones push</button>`}
    </div>`}
    <div class="card">
      <h2>Qué te llega como push</h2>
      <p class="helper" style="margin-bottom:4px;">La campanita siempre muestra todo. Esto es solo para elegir cuáles además te avisan directo al celular.</p>
      <div class="notifcfg-list">
        ${TIPOS_NOTIF.map(t=>{
          const checked = prefMap[t.tipo] !== undefined ? prefMap[t.tipo] : t.defaultPush;
          return `
          <div class="notifcfg-row">
            <div class="notifcfg-row-ic">${ICONS[t.icono]||ICONS.bell}</div>
            <div class="notifcfg-row-body">
              <div class="notifcfg-row-title">${t.label}</div>
              <div class="notifcfg-row-sub">${t.sub}</div>
            </div>
            <label class="toggle">
              <input type="checkbox" ${checked?'checked':''} onchange="guardarPrefNotif(${argJs(t.tipo)}, this.checked)">
              <span class="track"></span>
            </label>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
  actualizarNotifNavdot();
}
async function guardarPrefNotif(tipo, activado){
  const ok = await sbGuardar(sb.from('notif_push_preferencias').upsert({usuario: notifUsuario(), tipo, activado}, {onConflict:'usuario,tipo'}), 'la preferencia');
  if(ok){ toast('Guardado.'); return; }
  // Falló: se vuelve a pintar con lo que hay guardado, así la casilla no miente.
  const cont = document.getElementById('notifcfg-body');
  if(cont) await renderNotifConfig(cont);
}

/* ---- Sidebar: nunca scrollea, se achica solo si hace falta ----
   Si al agregar módulos nuevos el menú deja de entrar en la altura del dispositivo, se aplica
   la clase .snug (menos padding/gap/tamaño de letra) en vez de dejar que aparezca un scroll
   interno. Se revisa cada vez que se repinta el sidebar. */
function ajustarSidebarNav(){
  const nav = document.querySelector('.sidebar-nav');
  const sidebar = document.getElementById('sidebar');
  if(!nav || !sidebar) return;
  nav.classList.remove('snug');
  sidebar.classList.remove('snug-logo');
  requestAnimationFrame(()=>{
    if(sidebar.scrollHeight > sidebar.clientHeight + 1){
      nav.classList.add('snug');
    }
    requestAnimationFrame(()=>{
      if(sidebar.scrollHeight > sidebar.clientHeight + 1){
        sidebar.classList.add('snug-logo');
      }
    });
  });
}

