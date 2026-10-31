/* ================= AGENDA (solicitudes) ================= */
let agendaAncla = null; // primer día visible — arranca siempre en hoy
let agendaFamilias = [];
let agendaNinierasBase = [];
let agendaSolicitudes = [];
let agendaResizeListenerAttached = false;
let agendaReemplazoNineraSel = null;
let agendaPausas = []; // pausas de los fijos (vacaciones), solo con los fijos automáticos activados

function agendaDiasVisibles(){ return 7; } // la página siempre es de una semana — lo que cambia con el ancho es CÓMO se dibuja (ver agendaEsMobile)
function agendaEsMobile(){ return window.innerWidth <= 760; }
function attachAgendaResizeListener(){
  if(agendaResizeListenerAttached) return;
  agendaResizeListenerAttached = true;
  let resizeTimer = null;
  window.addEventListener('resize', ()=>{
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(()=>{
      if(moduloActivo!=='agenda') return;
      const lbl = document.getElementById('agenda-fecha-label');
      if(lbl) lbl.textContent = agendaRangoLabel();
      renderAgendaGrid();
    }, 200);
  });
}
const AGENDA_START_MIN = 480, AGENDA_END_MIN = 1200, AGENDA_ROWH = 35;
const AGENDA_GRIDH = Math.round(((AGENDA_END_MIN-AGENDA_START_MIN)/60)*AGENDA_ROWH);

function agendaMinutos(hhmm){
  if(!hhmm) return null;
  const [h,m] = hhmm.split(':').map(Number);
  return h*60+(m||0);
}
function agendaTop(hhmm){
  const min = agendaMinutos(hhmm);
  if(min==null) return 0;
  return Math.max(0, Math.min(AGENDA_GRIDH, ((min-AGENDA_START_MIN)/60)*AGENDA_ROWH));
}
function agendaAlto(inicio, fin, cruza){
  const mi = agendaMinutos(inicio);
  if(mi==null) return 40;
  if(cruza){
    return Math.max(28, AGENDA_GRIDH - agendaTop(inicio));
  }
  const mf = agendaMinutos(fin);
  const dur = (mf!=null && mf>mi) ? (mf-mi) : 60;
  return Math.max(28, (dur/60)*AGENDA_ROWH);
}
function agendaFechaLarga(f){
  const d = new Date(f+'T00:00:00');
  const s = new Intl.DateTimeFormat('es-UY',{weekday:'long', day:'numeric', month:'long'}).format(d);
  return s.charAt(0).toUpperCase()+s.slice(1);
}
const AGENDA_MESES_CORTO = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
function agendaRangoLabel(){
  const n = agendaDiasVisibles();
  const d1 = new Date(agendaAncla+'T00:00:00');
  if(n===1) return agendaFechaLarga(agendaAncla);
  const d2 = new Date(d1); d2.setDate(d2.getDate()+n-1);
  const mismoMes = d1.getMonth()===d2.getMonth();
  return mismoMes
    ? `${d1.getDate()}–${d2.getDate()} ${AGENDA_MESES_CORTO[d1.getMonth()]}`
    : `${d1.getDate()} ${AGENDA_MESES_CORTO[d1.getMonth()]} – ${d2.getDate()} ${AGENDA_MESES_CORTO[d2.getMonth()]}`;
}
function cambiarAgendaRango(delta){
  const n = agendaDiasVisibles();
  agendaAncla = sumarDiasISO(agendaAncla, delta*n);
  const lbl = document.getElementById('agenda-fecha-label');
  if(lbl) lbl.textContent = agendaRangoLabel();
  cargarAgendaSolicitudes();
}
function waLink(telefono, mensaje){
  let tel = (telefono||'').replace(/[^0-9]/g,'');
  if(!tel) return '#';
  if(!tel.startsWith('598')) tel = '598'+tel.replace(/^0+/,'');
  return `https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}`;
}
function mensajeWA(s, nineraNombre){
  const horario = s.hora_fin ? `${s.hora_inicio.slice(0,5)} a ${s.hora_fin.slice(0,5)}` : s.hora_inicio.slice(0,5);
  const tipoTxt = s.tipo==='traslado' ? 'un traslado' : 'un sitting';
  const fechaTxt = new Date(s.fecha+'T00:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'2-digit'});
  return `Hola ${(nineraNombre||'').split(' ')[0]}! Te escribo de Parents’ Break — ¿podés cubrir ${tipoTxt} con la familia ${s.familia_nombre} el ${fechaTxt} de ${horario}${s.zona?` (zona ${s.zona})`:''}? Avisame si te queda bien.`;
}
function agendaTelefonoNinera(nombre){
  const n = agendaNinierasBase.find(x=>normaliza(x.nombre)===normaliza(nombre));
  return n ? n.telefono : '';
}
async function actualizarAgendaBadge(){
  const dot = document.getElementById('agenda-navdot');
  if(!dot) return;
  const { data, error } = await sb.from('solicitudes').select('id').in('estado', ['sin_asignar','pendiente_confirmar']).gte('fecha', todayISO());
  if(error) return;
  dot.innerHTML = (data && data.length) ? '<span class="navdot"></span>' : '';
}

async function renderAgenda(cont){
  agendaAncla = agendaAncla || todayISO();
  attachAgendaResizeListener();
  cont.innerHTML = moduloHeader('Agenda') + `
    <div class="mesbar">
      <div class="mesnav">
        <button onclick="cambiarAgendaRango(-1)" aria-label="Días anteriores"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="mesnav-label" id="agenda-fecha-label">${agendaRangoLabel()}</div>
        <button onclick="cambiarAgendaRango(1)" aria-label="Días siguientes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <button class="smallbtn" onclick="abrirModalNuevaSolicitud()">+ Nueva solicitud</button>
    </div>
    <div class="agenda-legend">
      <span><span class="agenda-dot dot-sinasignar"></span>Sin asignar</span>
      <span><span class="agenda-dot dot-pendiente"></span>Pendiente de confirmar</span>
      <span><span class="agenda-dot dot-confirmada"></span>Confirmada</span>
    </div>
    <div id="agenda-grid-wrap"><div class="empty"><span class="spinner dark"></span> Cargando…</div></div>
  `;
  // cargarAgendaBase va primero (no en paralelo): cargarAgendaSolicitudes ahora
  // necesita agendaFamilias ya cargada para resolver la zona de cada registro.
  await cargarAgendaBase();
  await cargarAgendaSolicitudes();
}

async function cargarAgendaBase(){
  const [{data:fams}, {data:nins}] = await Promise.all([
    leerFamiliasConTerminos('id,nombre,zona,telefono,cobro_hora,pago_hora', q=>q.order('nombre')),
    sb.from('ninieras').select('id,nombre,zona,tipo,telefono').eq('activa', true).order('nombre'),
  ]);
  agendaFamilias = fams || [];
  agendaNinierasBase = nins || [];
}

function diaDeFecha(fechaISO){ return diaSemanaDeISO(fechaISO); }
async function cargarAgendaSolicitudes(){
  const wrap = document.getElementById('agenda-grid-wrap');
  if(wrap) wrap.innerHTML = '<div class="empty"><span class="spinner dark"></span> Cargando…</div>';
  const n = agendaDiasVisibles();
  const desde = agendaAncla, hasta = sumarDiasISO(agendaAncla, n-1);

  await esperarConfigFijos();
  const [{data:sols, error}, {data:asigs}, {data:registros}, pausas] = await Promise.all([
    sb.from('solicitudes').select('*, solicitud_ninieras(*)').gte('fecha', desde).lte('fecha', hasta).order('hora_inicio', {ascending:true}),
    sb.from('asignaciones').select('*, familias(nombre)'),
    sb.from('sittings_traslados').select('*').gte('fecha', desde).lte('fecha', hasta),
    cargarPausasFijos(),
  ]);
  if(error){ if(wrap) wrap.innerHTML = errBox(error); return; }
  agendaPausas = pausas;
  // Fijos automáticos (06/10/2026): el día de un fijo ya cargado como "previsto" se sigue
  // dibujando como la tarjeta del fijo (con lo previsto adentro), no como un registro.
  const previstosPorAsig = new Map((registros||[]).filter(r=>r.asignacion_id && esPrevisto(r)).map(r=>[r.asignacion_id+'|'+r.fecha, r]));
  const reales = (registros||[]).filter(r=>!esPrevisto(r));
  // Ya registrado en Sittings, por día+niñera+familia (antes era solo niñera+familia, sin día).
  const registradosSet = new Set(reales.map(r=>r.fecha+'|'+normaliza(r.ninera_nombre||'')+'|'+normaliza(r.familia_nombre||'')));
  // Lo registrado desde un fijo queda vinculado a su asignación (05/10/2026): ese día el
  // fijo ya está cubierto aunque haya ido otra niñera (reemplazo) o no haya ido nadie.
  const registradosPorAsig = new Set(reales.filter(r=>r.asignacion_id).map(r=>r.asignacion_id+'|'+r.fecha));
  const previstosUsados = new Set();

  // Solicitudes puntuales: al confirmar una niñera (guardarAsignacionDirecta) se crea de una
  // el registro real en Sittings & traslados -- si no se filtra acá, la solicitud confirmada
  // queda como tarjeta aparte, duplicada con el registro real del mismo día.
  const puntuales = (sols||[]).map(s=>({...s, ninieras: s.solicitud_ninieras||[], _fuente:'solicitud'}))
    .filter(s=>{
      const nineraConfirmada = (s.solicitud_ninieras||[]).find(x=>x.estado==='confirmada');
      if(!nineraConfirmada) return true; // sin niñera confirmada todavía, no puede tener registro real
      const yaRegistrado = registradosSet.has(s.fecha+'|'+normaliza(nineraConfirmada.ninera_nombre||'')+'|'+normaliza(s.familia_nombre||''));
      return !yaRegistrado;
    });

  // Horarios fijos: una instancia por cada día visible cuyo día de semana matchee.
  // Si ese día+niñera+familia ya tiene un registro real cargado en Sittings & traslados
  // (registradosSet), NO se agrega la tarjeta del fijo -- si no, queda duplicado: la
  // tarjeta "pendiente" del fijo Y la tarjeta del registro real, para el mismo día.
  const fijas = [];
  for(let i=0;i<n;i++){
    const fechaISO = sumarDiasISO(agendaAncla, i);
    const diaSemana = diaDeFecha(fechaISO);
    // Solo dentro de su vigencia: antes un fijo se dibujaba en TODAS las semanas, pasadas
    // incluidas, con la niñera de hoy -- al cambiarla, el pasado aparecía como de la nueva (E2).
    (asigs||[]).filter(a=>Array.isArray(a.dias) && a.dias.includes(diaSemana) && asignacionVigenteEn(a, fechaISO) && !fijoPausadoEn(pausas, a.id, fechaISO)).forEach(a=>{
      const yaRegistrado = registradosPorAsig.has(a.id+'|'+fechaISO)
        || registradosSet.has(fechaISO+'|'+normaliza(a.ninera_nombre||'')+'|'+normaliza(a.familias?.nombre||''));
      if(yaRegistrado) return; // el registro real (en `registrados`, más abajo) ya cubre este día
      const previsto = previstosPorAsig.get(a.id+'|'+fechaISO) || null;
      if(previsto){
        previstosUsados.add(previsto.id);
        // Un previsto de "no fue" ya está resuelto: se dibuja como cancelado, igual que un registro.
        if(previsto.cancelado) return;
      }
      fijas.push({
        id: 'asig:'+a.id+'@'+fechaISO,
        fecha: fechaISO,
        _fuente: 'asignacion',
        _raw: a,
        _asigId: a.id,
        _yaRegistrado: false,
        familia_nombre: a.familias?.nombre || '(familia)',
        tipo: tipoAsignacion(a),
        hora_inicio: a.hora_inicio,
        hora_fin: a.hora_fin,
        termina_dia_siguiente: false,
        zona: null,
        cobro_familia: null,
        estado: 'confirmada',
        ninieras: [{ id:'asigninera:'+a.id+'@'+fechaISO, ninera_nombre:(previsto?previsto.ninera_nombre:a.ninera_nombre), estado:'confirmada' }],
        _previsto: previsto,
      });
      if(previsto){
        const f = fijas[fijas.length-1];
        f.hora_inicio = previsto.hora_inicio; f.hora_fin = previsto.hora_fin;
        f.termina_dia_siguiente = !!previsto.termina_dia_siguiente;
        f.cobro_familia = previsto.cobro_familia;
      }
    });
  }

  // Registros ya cargados en Sittings & traslados dentro del rango visible (los previstos
  // que ya se dibujan en la tarjeta de su fijo no se repiten).
  const registrados = (registros||[]).filter(r=>!previstosUsados.has(r.id) || r.cancelado).map(r=>({
    id: 'reg:'+r.id,
    fecha: r.fecha,
    _fuente: 'registro',
    _regId: r.id,
    familia_nombre: r.familia_nombre || '(familia)',
    tipo: r.tipo,
    hora_inicio: r.hora_inicio,
    hora_fin: r.hora_fin,
    termina_dia_siguiente: r.termina_dia_siguiente || false,
    zona: agendaFamilias.find(f=>f.id===r.familia_id)?.zona || null,
    cobro_familia: r.cobro_familia,
    pago_ninera: r.pago_ninera,
    cancelado: r.cancelado || false,
    _esPrevisto: esPrevisto(r),
    estado: 'confirmada',
    ninieras: [{ id:'regninera:'+r.id, ninera_nombre:r.ninera_nombre, estado:'confirmada' }],
  }));

  agendaSolicitudes = [...puntuales, ...fijas, ...registrados];
  renderAgendaGrid();
}

function renderAgendaGrid(){
  const wrap = document.getElementById('agenda-grid-wrap');
  if(!wrap) return;
  const n = agendaDiasVisibles();
  const hoy = todayISO();
  const dias = [];
  for(let i=0;i<n;i++){
    dias.push(sumarDiasISO(agendaAncla, i));
  }
  const porDia = dias.map(fecha=>{
    const esHoy = fecha===hoy;
    const items = agendaSolicitudes
      .filter(s=>s.fecha===fecha && s.estado!=='cancelada')
      .sort((a,b)=>(a.hora_inicio||'').localeCompare(b.hora_inicio||''));
    const d = new Date(fecha+'T00:00:00');
    const diaLabel = new Intl.DateTimeFormat('es-UY',{weekday:'short'}).format(d).replace('.','');
    return { fecha, esHoy, items, numero: d.getDate(), diaLabel };
  });

  if(agendaEsMobile()){
    // Celular: lista vertical, un día abajo del otro — entran los 7 sin apretar
    // columnas ni scrollear al costado, solo hace falta scrollear para abajo.
    // Cada día tiene su propio fondo en el encabezado (no solo una línea fina)
    // para que se distinga bien uno de otro, y cada sitting es una sola línea
    // compacta — así un día con varios sittings no empuja tanto al resto.
    wrap.innerHTML = porDia.map(({fecha, esHoy, items, numero, diaLabel})=>`
      <div style="margin-bottom:18px;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;margin-bottom:6px;background:${esHoy?'var(--accent-soft)':'var(--paper)'};">
          <div style="font-size:11px;font-weight:700;color:${esHoy?'var(--accent)':'var(--ink-soft)'};text-transform:uppercase;letter-spacing:0.03em;">${diaLabel}</div>
          <div style="font-size:16px;font-weight:700;color:${esHoy?'var(--accent)':'var(--ink)'};">${numero}</div>
          ${esHoy ? `<div style="font-size:10px;font-weight:700;color:var(--accent);background:var(--bg);padding:2px 7px;border-radius:100px;margin-left:2px;">HOY</div>` : ''}
        </div>
        ${items.length ? items.map(s=>renderAgendaFilaMobile(s)).join('') : '<div class="helper" style="padding:4px 10px;">Sin pedidos</div>'}
      </div>`).join('');
  } else {
    // Compu: columnas lado a lado, cada una crece según su propio contenido.
    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(${n}, minmax(0,1fr));gap:8px;align-items:start;">
        ${porDia.map(({fecha, esHoy, items, numero, diaLabel})=>`
        <div style="border:1px solid ${esHoy?'var(--accent)':'var(--line)'};border-radius:12px;padding:8px;background:${esHoy?'var(--accent-soft)':'var(--paper)'};">
          <div style="text-align:center;margin-bottom:8px;">
            <div style="font-size:11px;color:${esHoy?'var(--accent)':'var(--ink-soft)'};font-weight:${esHoy?700:400};text-transform:uppercase;">${diaLabel}</div>
            <div style="font-size:16px;font-weight:700;color:${esHoy?'var(--accent)':'var(--ink)'};">${numero}</div>
          </div>
          ${items.length ? items.map(s=>renderAgendaTarjetaDia(s)).join('') : '<div class="helper" style="text-align:center;padding-top:16px;">Sin pedidos</div>'}
        </div>`).join('')}
      </div>
    `;
  }
}
// El pago de la niñera en la tarjeta de un sitting se ve por hora, "$250/h" (25/10/2026, Paulina
// y Delfina): sale del total por las horas reales. Un traslado sigue con su precio por viaje.
function textoPagoAgenda(s){
  const total = Number(s.pago_ninera||0);
  if(s.tipo==='sitting' && total && s.hora_inicio && s.hora_fin){
    const horas = horasSitting(s.hora_inicio, s.hora_fin, !!s.termina_dia_siguiente, null, s.fecha);
    if(horas?.real) return `$${redondearPago(total/horas.real).toLocaleString('es-UY')}/h`;
  }
  return `$${total.toLocaleString('es-UY')}`;
}
function renderAgendaFilaMobile(s){
  const sinAsignar = !s.ninieras.length || s.ninieras.every(x=>x.estado!=='confirmada');
  const horaTxt = s.hora_inicio ? s.hora_inicio.slice(0,5) : '--:--';
  const ninTxt = s.ninieras.length ? s.ninieras.map(x=>(x.ninera_nombre||'').split(' ')[0]).join(' + ') : null;
  const esRegistro = s._fuente==='registro' && !s.cancelado;
  const previsto = !!(s._previsto || s._esPrevisto);
  return `<div style="padding:7px 10px;border-bottom:1px solid var(--line);font-size:13px;cursor:pointer;" onclick="abrirModalSolicitud(${argJs(s.id)})">
    <div style="display:flex;align-items:center;gap:8px;">
      <div style="color:var(--ink-soft);font-variant-numeric:tabular-nums;width:38px;flex-shrink:0;">${horaTxt}</div>
      <div style="flex:1;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escaparHtml(s.familia_nombre)}</div>
      ${s.cancelado
        ? `<span class="badge warn" style="font-size:10px;padding:2px 7px;flex-shrink:0;">Cancelado</span>`
        : esRegistro
          ? (s.zona ? `<span class="badge accent" style="font-size:10px;padding:2px 7px;flex-shrink:0;">${escaparHtml(s.zona)}</span>` : '')
          : `<div style="font-size:11px;font-weight:700;color:${sinAsignar?'var(--warn)':'var(--good)'};flex-shrink:0;">${sinAsignar ? 'Sin asignar' : escaparHtml(ninTxt)}</div>`}
      ${previsto ? `<span class="agenda-previsto">Previsto</span>` : ''}
    </div>
    ${esRegistro ? `<div style="display:flex;gap:14px;margin-top:4px;padding-left:46px;font-size:11px;color:var(--ink-soft);">
      <span>Cobro <b style="color:var(--ink);font-family:'IBM Plex Mono',monospace;">$${Number(s.cobro_familia||0).toLocaleString('es-UY')}</b></span>
      <span>Pago <b style="color:var(--ink);font-family:'IBM Plex Mono',monospace;">${textoPagoAgenda(s)}</b></span>
    </div>` : ''}
  </div>`;
}
function renderAgendaTarjetaDia(s){
  const sinAsignar = !s.ninieras.length || s.ninieras.every(x=>x.estado!=='confirmada');
  const horaTxt = s.hora_inicio ? s.hora_inicio.slice(0,5) : 'Sin hora';
  const ninTxt = s.ninieras.length ? s.ninieras.map(x=>(x.ninera_nombre||'').split(' ')[0]).join(' + ') : null;
  const esRegistro = s._fuente==='registro' && !s.cancelado;
  const previsto = !!(s._previsto || s._esPrevisto);
  return `<div style="background:var(--bg);border-radius:8px;padding:7px 8px;margin-bottom:6px;cursor:pointer;font-size:12px;" onclick="abrirModalSolicitud(${argJs(s.id)})">
    <div style="font-weight:700;color:var(--ink);margin-bottom:2px;">${escaparHtml(s.familia_nombre)}</div>
    <div class="helper" style="margin:0 0 4px;">${horaTxt}${previsto ? ` · <span class="agenda-previsto">Previsto</span>` : ''}</div>
    ${s.cancelado
      ? `<span class="badge warn" style="font-size:10.5px;padding:3px 8px;">Cancelado</span>`
      : esRegistro
        ? `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-soft);margin-bottom:1px;"><span>Cobro</span><span style="font-family:'IBM Plex Mono',monospace;color:var(--ink);font-weight:600;">$${Number(s.cobro_familia||0).toLocaleString('es-UY')}</span></div>
           <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-soft);margin-bottom:${s.zona?'6px':'0'};"><span>Pago</span><span style="font-family:'IBM Plex Mono',monospace;color:var(--ink);font-weight:600;">${textoPagoAgenda(s)}</span></div>
           ${s.zona ? `<span class="badge accent" style="font-size:10.5px;padding:3px 8px;">${escaparHtml(s.zona)}</span>` : ''}`
        : `<span class="badge ${sinAsignar?'warn':'good'}" style="font-size:10.5px;padding:3px 8px;">${sinAsignar ? 'Sin asignar' : escaparHtml(ninTxt)}</span>`}
  </div>`;
}

function onHoraSelectChange(){
  actualizarAgendaTotal();
  pintarFinCobroAgenda();
  actualizarAgendaPrecioTraslado();
  actualizarPrecioSugeridoTraslado();
  actualizarCobroPagoPorHorario();
}
// "Hora real 17:36, se cobra hasta 18:00" al registrar un día de un fijo o su reemplazo
// (términos y condiciones). Cada aviso lleva la familia y la fecha del día que se registra.
function pintarFinCobroAgenda(){
  [['agenda-fija-fin-cobro', 'agenda-fija-hi', 'agenda-fija-hf', 'agenda-fija-cruza'],
   ['agenda-fija-rfin-cobro', 'agenda-fija-rhi', 'agenda-fija-rhf', 'agenda-fija-rcruza']].forEach(([id, hi, hf, cruza])=>{
    const box = document.getElementById(id);
    if(!box) return;
    const familia = agendaFamilias.find(f=>f.id===box.dataset.familia);
    const horas = horasSitting(leerHora(hi), leerHora(hf), document.getElementById(cruza)?.checked, familia, box.dataset.fecha);
    const cruceMal = cruceMedianocheMalMarcado(leerHora(hi), leerHora(hf), document.getElementById(cruza)?.checked);
    box.textContent = cruceMal ? AVISO_CRUCE_MEDIANOCHE : textoFinCobrado(leerHora(hf), horas);
    box.style.color = cruceMal ? 'var(--bad)' : '';
  });
}
function selectHora(idPrefix, valHH='', valMM=''){
  const horas = Array.from({length:24},(_,i)=>String(i).padStart(2,'0'));
  const mins = Array.from({length:60},(_,i)=>String(i).padStart(2,'0'));
  return `<div class="timepick">
    <select id="${idPrefix}-hh" onchange="onHoraSelectChange()"><option value="">--</option>${horas.map(h=>`<option value="${h}" ${h===valHH?'selected':''}>${h}</option>`).join('')}</select>
    <span>:</span>
    <select id="${idPrefix}-mm" onchange="onHoraSelectChange()"><option value="">--</option>${mins.map(m=>`<option value="${m}" ${m===valMM?'selected':''}>${m}</option>`).join('')}</select>
  </div>`;
}
function leerHora(idPrefix){
  const hh = document.getElementById(idPrefix+'-hh')?.value;
  if(!hh) return ''; // sin hora elegida, no hay horario — esto sí queda vacío
  const mm = document.getElementById(idPrefix+'-mm')?.value;
  return `${hh}:${mm || '00'}`; // minutos en blanco = :00, para no obligar a tocar los dos selectores siempre
}
function setHoraSelect(idPrefix, hhmm){
  if(!hhmm) return;
  const [hh,mm] = hhmm.slice(0,5).split(':');
  const selHH = document.getElementById(idPrefix+'-hh');
  const selMM = document.getElementById(idPrefix+'-mm');
  if(selHH) selHH.value = hh;
  if(selMM) selMM.value = mm; // ahora el selector tiene los 60 minutos — coincide exacto, sin redondear
}
function mostrarAgendaFamiliaDropdown(){
  const input = document.getElementById('agenda-familia');
  const dd = document.getElementById('agenda-familia-dropdown');
  if(!input || !dd) return;
  const q = normaliza(input.value.trim());
  const matches = agendaFamilias.filter(f=>!q || normaliza(f.nombre).includes(q)).slice(0,8);
  if(!matches.length){
    dd.innerHTML = q ? `<div class="autocomplete-empty">Ninguna familia coincide — se va a cargar como nueva.</div>` : '';
    dd.style.display = q ? 'block' : 'none';
    return;
  }
  dd.innerHTML = matches.map(f=>`<div class="autocomplete-item" onmousedown="elegirAgendaFamilia(${argJs(f.id)})">${escaparHtml(f.nombre)}</div>`).join('');
  dd.style.display = 'block';
}
function ocultarAgendaFamiliaDropdown(){
  setTimeout(()=>{ const dd = document.getElementById('agenda-familia-dropdown'); if(dd) dd.style.display='none'; }, 150);
}
function elegirAgendaFamilia(id){
  const f = agendaFamilias.find(x=>x.id===id);
  if(!f) return;
  document.getElementById('agenda-familia').value = f.nombre;
  const dd = document.getElementById('agenda-familia-dropdown');
  if(dd) dd.style.display = 'none';
  onAgendaFamiliaInput();
}
function onAgendaFamiliaInput(){
  mostrarAgendaFamiliaDropdown();
  const val = document.getElementById('agenda-familia').value;
  const f = agendaFamilias.find(x=>normaliza(x.nombre)===normaliza(val));
  const cobroInput = document.getElementById('agenda-cobro');
  const pagoInput = document.getElementById('agenda-pago-hora');
  if(f){
    // Si todavía no marcaron ninguna zona, se precargan las de la familia elegida.
    if(f.zona && !leerZonasChecklist('agenda')) setZonasChecklist('agenda', f.zona, 'Zona');
    if(cobroInput && !cobroInput.value && f.cobro_hora) cobroInput.value = f.cobro_hora;
  }
  if(pagoInput) precargarPagoHoraAgenda();
  actualizarAgendaTotal();
}
/* Precio por niñera (01/11/2026): "Precio por hora a la niñera" viene con el de la niñera elegida con
   esa familia (precioHoraNinera; sin niñera o sin precio, la tarifa). Lo tipeado a mano no se pisa.
   Los precios de la familia se leen una vez por familia (agendaPreciosFam). */
let agendaPreciosFam = { familiaId: null, filas: null, leida: false }; // filas null: leyéndose (leida false) o no se pudieron leer
function familiaNuevaSolicitud(){
  const val = document.getElementById('agenda-familia')?.value || '';
  return agendaFamilias.find(f=>normaliza(f.nombre)===normaliza(val)) || null;
}
function nineraNuevaSolicitud(){
  const val = (document.getElementById('agenda-ninera')?.value || '').trim();
  return val ? agendaNinierasBase.find(n=>normaliza(n.nombre)===normaliza(val)) || null : null;
}
function preciosNuevaSolicitud(f){ return (f && agendaPreciosFam.familiaId===f.id && agendaPreciosFam.filas) || []; }
async function precargarPagoHoraAgenda(){
  const f = familiaNuevaSolicitud();
  // Si la lectura anterior falló, elegir la niñera la vuelve a probar (31/10/2026).
  const reintentar = agendaPreciosFam.leida && preciosNoLeidos(agendaPreciosFam.filas) && !!nineraNuevaSolicitud();
  if(f && (agendaPreciosFam.familiaId!==f.id || reintentar)){
    const carga = { familiaId: f.id, filas: null, leida: false };
    agendaPreciosFam = carga;
    // Mientras se lee, la tarifa: guardar en ese momento no puede dar un pago de $0 (revisión final,
    // 31/10/2026). Cuando llega la lectura se corrige con el precio de la niñera (si no se tipeó a mano).
    aplicarPagoHoraAgenda(f);
    carga.filas = await leerPreciosNinera(f.id);
    carga.leida = true;
    if(agendaPreciosFam!==carga || familiaNuevaSolicitud()?.id!==f.id) return; // mientras tanto cambió la familia
  }
  aplicarPagoHoraAgenda(f);
}
function aplicarPagoHoraAgenda(f){
  const input = document.getElementById('agenda-pago-hora');
  if(!input) return;
  if(f && !input.dataset.tocadoManual){
    input.value = precioHoraNinera(f, nineraNuevaSolicitud()?.id || null, preciosNuevaSolicitud(f)) ?? '';
    actualizarAgendaPagoPreview();
  }
  pintarGuardarPrecioAgenda();
}
// La lectura de los precios falló (la tabla existe): el precio por hora va con la tarifa, con el aviso a
// la vista (avisoPreciosNoLeidosTarifa, core.js). Solo con niñera elegida: sin niñera no se guarda pago.
function pintarAvisoPreciosAgenda(){
  const box = document.getElementById('agenda-precios-aviso');
  if(!box) return;
  const f = familiaNuevaSolicitud(), n = nineraNuevaSolicitud();
  const falla = f && n && document.getElementById('agenda-tipo')?.value==='sitting'
    && agendaPreciosFam.familiaId===f.id && agendaPreciosFam.leida && preciosNoLeidos(agendaPreciosFam.filas);
  box.innerHTML = falla ? `<div class="warnbox" style="margin:-4px 0 10px;">${escaparHtml(avisoPreciosNoLeidosTarifa(n.nombre))}</div>` : '';
}
// "Guardar como precio de [niñera] con esta familia" (respuesta 3 de Diego, 31/10/2026): con niñera
// elegida y otro precio por hora tipeado a mano. Tildada solo si esa niñera no tiene precio con esa
// familia; si ya tiene, destildada (un precio especial de un día no pisa el guardado).
function pintarGuardarPrecioAgenda(){
  pintarAvisoPreciosAgenda();
  const wrap = document.getElementById('agenda-guardar-precio-wrap'), chk = document.getElementById('agenda-guardar-precio');
  if(!wrap || !chk) return;
  const input = document.getElementById('agenda-pago-hora');
  const f = familiaNuevaSolicitud(), n = nineraNuevaSolicitud();
  const casilla = f && n && document.getElementById('agenda-tipo')?.value==='sitting'
    ? casillaPrecioNinera({ familiaId: f.id, nineraId: n.id, filas: agendaPreciosFam.familiaId===f.id ? agendaPreciosFam.filas : null,
        valor: input?.value, tocadoManual: !!input?.dataset.tocadoManual, pagoActual: precioHoraNinera(f, n.id, preciosNuevaSolicitud(f)) })
    : null;
  if(!casilla){ wrap.style.display = 'none'; return; }
  const clave = f.id+'|'+n.id;
  if(chk.dataset.par!==clave){ chk.checked = casilla.tildada; chk.dataset.par = clave; }
  document.getElementById('agenda-guardar-precio-txt').textContent = `Guardar como precio de ${n.nombre} con esta familia`;
  wrap.style.display = '';
}
function precioNineraAGuardarAgenda(){
  const wrap = document.getElementById('agenda-guardar-precio-wrap');
  if(!wrap || wrap.style.display==='none' || !document.getElementById('agenda-guardar-precio')?.checked) return null;
  const f = familiaNuevaSolicitud(), n = nineraNuevaSolicitud();
  if(!f || !n) return null;
  return { familiaId: f.id, nineraId: n.id, nineraNombre: n.nombre, pagoHora: redondearPago(document.getElementById('agenda-pago-hora').value), // sin centavos, como en la ficha
    nueva: !preciosNuevaSolicitud(f).some(p=>p.ninera_id===n.id) };
}
function onAgendaCruzaChange(){
  const cruza = document.getElementById('agenda-cruza-medianoche').checked;
  const wrapFin = document.getElementById('agenda-hora-fin-wrap');
  if(wrapFin) wrapFin.querySelector('.helper')?.remove();
  if(cruza && wrapFin){
    wrapFin.insertAdjacentHTML('beforeend', `<div class="helper" style="margin-top:4px;">Termina al día siguiente, a esta hora.</div>`);
  }
  actualizarAgendaTotal();
}
function onAgendaTipoChange(){
  const tipo = document.getElementById('agenda-tipo').value;
  document.getElementById('agenda-campo-sitting').style.display = tipo==='sitting' ? '' : 'none';
  document.getElementById('agenda-campo-traslado').style.display = tipo==='traslado' ? '' : 'none';
  document.getElementById('agenda-campo-traslado-cobro').style.display = tipo==='traslado' ? '' : 'none';
  document.getElementById('agenda-campo-pago-hora').style.display = tipo==='sitting' ? '' : 'none';
  document.getElementById('agenda-total-preview').textContent = '';
  document.getElementById('agenda-pago-preview').textContent = '';
  pintarGuardarPrecioAgenda();
  if(tipo==='traslado' && !tarifaTrasladoConfig) cargarTarifaTrasladoConfig().then(actualizarAgendaPrecioTraslado);
  if(tipo==='traslado') actualizarAgendaPrecioTraslado();
}
// Mismo cálculo que en Sittings & traslados (tarifa base + km × precio/km, con recargo
// horario) -- antes esta pantalla nunca miraba los km, usaba siempre la tarifa por hora
// de un sitting común, aunque el tipo elegido fuera Traslado.
function actualizarAgendaPrecioTraslado(){
  const box = document.getElementById('agenda-traslado-precio-box');
  if(!box) return;
  if(!tarifaTrasladoConfig){ box.style.display='none'; return; }
  const km = Number(document.getElementById('agenda-km')?.value||0);
  box.style.display = '';
  if(!km){ box.innerHTML = `<div class="helper" style="margin:0;">Cargá los km para ver el precio sugerido.</div>`; return; }
  const cfg = tarifaTrasladoConfig;
  const hora = leerHora('agenda-hora-inicio');
  const mult = multiplicadorHorarioTraslado(hora);
  const base = Number(cfg.tarifa_base)||0;
  const porKm = Number(cfg.precio_km)||0;
  const premium = Number(cfg.margen_premium)||1;
  const margenNinera = Number(cfg.margen_ninera)||0;
  const crudo = (base + km*porKm) * mult * premium;
  const cobro = redondearArriba50(crudo);
  const pago = redondearAbajo50(crudo * (1 - margenNinera));
  const cobroInput = document.getElementById('agenda-cobro-traslado');
  if(cobroInput && !cobroInput.dataset.tocadoManual){ cobroInput.value = cobro; marcarCampoSugerido('agenda-cobro-traslado'); }
  const pagoInput = document.getElementById('agenda-pago-traslado');
  if(pagoInput && !pagoInput.dataset.tocadoManual){ pagoInput.value = pago; marcarCampoSugerido('agenda-pago-traslado'); }
  box.innerHTML = `
    <div class="helper" style="margin:0;">Precio sugerido: <b>$${cobro.toLocaleString('es-UY')}</b> a cobrar y <b>$${pago.toLocaleString('es-UY')}</b> a la niñera (ya cargados abajo, con el borde punteado — los podés editar).</div>`;
}
// "Pago a la niñera: $750 (3 h)": el precio por hora a la niñera por las horas reales (a la
// niñera se le paga la hora real, sin el redondeo de los términos). Solo sittings con hora de fin.
function actualizarAgendaPagoPreview(){
  const el = document.getElementById('agenda-pago-preview');
  if(!el) return;
  const pagoHora = Number(document.getElementById('agenda-pago-hora')?.value||0);
  const hi = leerHora('agenda-hora-inicio'), hf = leerHora('agenda-hora-fin');
  const cruza = document.getElementById('agenda-cruza-medianoche')?.checked;
  const horas = document.getElementById('agenda-tipo')?.value==='sitting' && pagoHora && hi && hf && !cruceMedianocheMalMarcado(hi, hf, cruza)
    ? horasSitting(hi, hf, cruza, null, document.getElementById('agenda-nueva-fecha')?.value) : null;
  el.textContent = horas ? `Pago a la niñera: $${redondearPago(pagoHora*horas.real).toLocaleString('es-UY')} (${horas.real.toFixed(1).replace('.0','')} h)` : '';
}
function actualizarAgendaTotal(){
  actualizarAgendaPagoPreview();
  const el = document.getElementById('agenda-total-preview');
  if(!el) return;
  if(document.getElementById('agenda-tipo')?.value==='traslado'){ el.textContent=''; return; }
  const tarifa = Number(document.getElementById('agenda-cobro')?.value||0);
  const hi = leerHora('agenda-hora-inicio');
  const hf = leerHora('agenda-hora-fin');
  const cruza = document.getElementById('agenda-cruza-medianoche')?.checked;
  if(cruceMedianocheMalMarcado(hi, hf, cruza)){ el.textContent = AVISO_CRUCE_MEDIANOCHE; return; }
  if(tarifa && hi && !hf){ el.textContent = 'Sin hora de fin: el total se calcula cuando se cargue a qué hora terminó.'; return; }
  if(!tarifa || !hi || !hf){ el.textContent=''; return; }
  const familia = agendaFamilias.find(f=>normaliza(f.nombre)===normaliza(document.getElementById('agenda-familia')?.value||''));
  const horas = horasSitting(hi, hf, cruza, familia, document.getElementById('agenda-nueva-fecha')?.value);
  if(!horas){ el.textContent = !cruza ? 'La hora de fin tiene que ser después de la de inicio (o marcá "Termina al día siguiente").' : ''; return; }
  const finCobro = textoFinCobrado(hf, horas);
  el.textContent = `Total estimado: $${redondearCobro(tarifa*horas.cobro).toLocaleString('es-UY')} (${horas.cobro.toFixed(1).replace('.0','')} h)${finCobro ? ' · '+finCobro : ''}`;
}
let agendaModoNueva = 'puntual';
function onAgendaModoChange(modo){
  agendaModoNueva = modo;
  document.getElementById('agenda-modo-puntual-btn').classList.toggle('selected', modo==='puntual');
  document.getElementById('agenda-modo-repetir-btn').classList.toggle('selected', modo==='repetir');
  document.getElementById('agenda-bloque-puntual').style.display = modo==='puntual' ? 'block' : 'none';
  document.getElementById('agenda-bloque-repetir').style.display = modo==='repetir' ? 'block' : 'none';
}
function toggleAgendaDia(btn){
  btn.classList.toggle('selected');
  renderAgendaHorarioPorDia();
}
function onAgendaRepetirVariaChange(){
  const varia = document.getElementById('agenda-repetir-varia').checked;
  document.getElementById('agenda-repetir-horario-unico').style.display = varia ? 'none' : 'grid';
  document.getElementById('agenda-repetir-horario-por-dia').style.display = varia ? 'block' : 'none';
  if(varia) renderAgendaHorarioPorDia();
}
function renderAgendaHorarioPorDia(){
  const cont = document.getElementById('agenda-repetir-horario-por-dia');
  if(!cont || cont.style.display==='none') return;
  const dias = [...document.querySelectorAll('#agenda-repetir-dias .daybtn.selected')].map(b=>b.dataset.dia);
  if(!dias.length){ cont.innerHTML = '<div class="helper">Elegí los días primero.</div>'; return; }
  cont.innerHTML = dias.map(d=>`
    <div class="grid3" style="align-items:end;margin-bottom:8px;">
      <div class="field" style="margin-bottom:0;"><label>${DIAS_CORTO[d]}</label></div>
      <div class="field" style="margin-bottom:0;">${selectHora('agenda-rep-hi-'+d)}</div>
      <div class="field" style="margin-bottom:0;">${selectHora('agenda-rep-hf-'+d)}</div>
    </div>`).join('');
}
function abrirModalNuevaSolicitud(){
  agendaModoNueva = 'puntual';
  agendaPreciosFam = { familiaId: null, filas: null, leida: false }; // se leen de nuevo en cada solicitud

  const html = `
    <h2>Nueva solicitud</h2>
    <div class="field" style="position:relative;">
      <label>Familia</label>
      <input type="text" id="agenda-familia" autocomplete="off" oninput="onAgendaFamiliaInput()" onfocus="mostrarAgendaFamiliaDropdown()" onblur="ocultarAgendaFamiliaDropdown()" placeholder="Escribí el nombre — si es nueva, se carga igual">
      <div id="agenda-familia-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
    </div>
    <div class="tiporow" style="margin-bottom:14px;">
      <button type="button" class="tipobtn selected" id="agenda-modo-puntual-btn" onclick="onAgendaModoChange('puntual')">Puntual</button>
      <button type="button" class="tipobtn" id="agenda-modo-repetir-btn" onclick="onAgendaModoChange('repetir')">Fijo (se repite)</button>
    </div>
    <div id="agenda-bloque-puntual">
      <div class="grid2">
        <div class="field"><label>Tipo</label><select id="agenda-tipo" onchange="onAgendaTipoChange()"><option value="sitting">Sitting</option><option value="traslado">Traslado</option></select></div>
        <div class="field"><label>Fecha</label><input type="date" id="agenda-nueva-fecha" value="${agendaAncla}"></div>
      </div>
      <div class="field" style="position:relative;"><label>Niñera (opcional)</label>
        <input type="text" id="agenda-ninera" autocomplete="off" placeholder="Si ya sabés quién va, queda asignada y cargada en Sittings">
        <div id="agenda-ninera-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
      </div>
      ${checklistZonas('agenda', '', 'Zona')}
      <div class="grid3">
        <div class="field"><label>Hora inicio</label>${selectHora('agenda-hora-inicio')}</div>
        <div class="field" id="agenda-hora-fin-wrap"><label>Hora fin</label>${selectHora('agenda-hora-fin')}</div>
        <div class="field" id="agenda-campo-sitting"><label>Precio por hora a la familia</label><div class="moneyfield por-hora"><input type="number" id="agenda-cobro" oninput="actualizarAgendaTotal()"></div></div>
        <div class="field" id="agenda-campo-traslado" style="display:none;">
          <label>Km recorridos</label><input type="number" step="0.1" id="agenda-km" oninput="actualizarAgendaPrecioTraslado()">
        </div>
      </div>
      <div class="grid3" id="agenda-campo-pago-hora">
        <div class="field"><label>Precio por hora a la niñera</label><div class="moneyfield por-hora"><input type="number" id="agenda-pago-hora" oninput="marcarCampoEditadoManual('agenda-pago-hora');actualizarAgendaPagoPreview();pintarGuardarPrecioAgenda()"></div></div>
      </div>
      <label class="chk chk-largo" id="agenda-guardar-precio-wrap" style="display:none;margin:-4px 0 10px;"><input type="checkbox" id="agenda-guardar-precio"> <span id="agenda-guardar-precio-txt"></span></label>
      <div id="agenda-precios-aviso"></div>
      <div id="agenda-traslado-precio-box" style="display:none;margin:-4px 0 10px;"></div>
      <div class="grid2" id="agenda-campo-traslado-cobro" style="display:none;">
        <div class="field"><label>Cobro total del traslado</label><div class="moneyfield"><input type="number" id="agenda-cobro-traslado" oninput="marcarCampoEditadoManual('agenda-cobro-traslado')"></div></div>
        <div class="field"><label>Pago a la niñera por viaje</label><div class="moneyfield"><input type="number" id="agenda-pago-traslado" oninput="marcarCampoEditadoManual('agenda-pago-traslado')"></div></div>
      </div>
      <label class="chk" style="margin:-4px 0 10px;"><input type="checkbox" id="agenda-cruza-medianoche" onchange="onAgendaCruzaChange()"> Termina al día siguiente</label>
      <div class="helper" id="agenda-total-preview" style="min-height:16px;"></div>
      <div class="helper" id="agenda-pago-preview" style="min-height:16px;margin-top:2px;"></div>
    </div>
    <div id="agenda-bloque-repetir" style="display:none;">
      <div class="field" style="position:relative;"><label>Niñera</label>
        <input type="text" id="agenda-repetir-ninera" autocomplete="off" placeholder="Escribí el nombre de la niñera">
        <div id="agenda-repetir-ninera-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Tipo</label><select id="agenda-repetir-tipo"><option value="sitting">Sitting</option><option value="traslado">Traslado</option></select></div>
        <div class="field"><label>Desde</label><input type="date" id="agenda-repetir-desde" value="${todayISO()}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Cobro por traslado (solo traslados)</label><div class="moneyfield"><input type="number" id="agenda-repetir-cobro"></div></div>
        <div class="field"><label>Pago a la niñera por traslado</label><div class="moneyfield"><input type="number" id="agenda-repetir-pago"></div></div>
      </div>
      <div class="field"><label>Días</label>
        <div class="dayrow" id="agenda-repetir-dias">
          ${['L','M','X','J','V','S','D'].map(d=>`<button type="button" class="daybtn" data-dia="${d}" onclick="toggleAgendaDia(this)">${DIAS_CORTO[d]}</button>`).join('')}
        </div>
      </div>
      <label class="chk"><input type="checkbox" id="agenda-repetir-varia" onchange="onAgendaRepetirVariaChange()"> El horario cambia según el día</label>
      <div id="agenda-repetir-horario-unico" class="grid2" style="margin-top:6px;">
        <div class="field"><label>Hora inicio</label>${selectHora('agenda-rep-hi')}</div>
        <div class="field"><label>Hora fin</label>${selectHora('agenda-rep-hf')}</div>
      </div>
      <div id="agenda-repetir-horario-por-dia" style="display:none;margin-top:6px;"></div>
    </div>
    <div id="agenda-nueva-warn"></div>
    <button class="btn primary" style="width:100%;margin-top:6px;" onclick="conGuardado(this, ()=>guardarSolicitud())">Guardar solicitud</button>
  `;
  abrirModal(html);
  // El modal se arma en el momento: el autocompletar se engancha ya (con un setTimeout, lo que
  // se escribía en esos primeros milisegundos no abría la lista; 06/10/2026, falló en el CI).
  attachAutocomplete('agenda-repetir-ninera', 'agenda-repetir-ninera-dropdown', ()=>agendaNinierasBase, ()=>{});
  // Solicitud en un paso (25/10/2026): la niñera se puede elegir acá mismo; solo las que hacen
  // ese tipo de servicio (el tipo se lee al escribir, por si cambia).
  // Cada niñera puede tener su precio con esa familia: elegirla (o cambiarla) lo precarga.
  attachAutocomplete('agenda-ninera', 'agenda-ninera-dropdown', ()=>agendaNinierasBase.filter(n=>nineraHaceTipo(n, document.getElementById('agenda-tipo')?.value)), ()=>precargarPagoHoraAgenda(), {sinCoincidencias:'Ninguna niñera coincide.'});
}
// Sitting: cualquiera menos las que solo hacen traslados; traslado: "Traslados" o "Ambas".
function nineraHaceTipo(n, tipo){
  return tipo==='traslado' ? (n.tipo==='Traslados' || n.tipo==='Ambas') : (n.tipo!=='Traslados');
}
async function guardarSolicitud(){
  if(agendaModoNueva==='repetir') return await guardarAsignacionFijaNueva();
  return await guardarSolicitudPuntual();
}
async function guardarSolicitudPuntual(){
  const familiaTxt = document.getElementById('agenda-familia').value.trim();
  const tipo = document.getElementById('agenda-tipo').value;
  const zona = leerZonasChecklist('agenda');
  const fecha = document.getElementById('agenda-nueva-fecha').value;
  const horaInicio = leerHora('agenda-hora-inicio');
  const horaFin = leerHora('agenda-hora-fin');
  const cruza = document.getElementById('agenda-cruza-medianoche').checked;
  const tarifa = document.getElementById('agenda-cobro').value;
  const warn = document.getElementById('agenda-nueva-warn');
  if(!familiaTxt || !fecha || !horaInicio){ warn.innerHTML = '<div class="warnbox">Completá al menos familia, fecha y hora de inicio.</div>'; return; }
  if(!agendaFamilias.some(f=>normaliza(f.nombre)===normaliza(familiaTxt)) && !(await confirmarNombreNuevo(familiaTxt, agendaFamilias, 'familia'))) return;
  if(!cruza && horaFin && horaFin <= horaInicio){
    warn.innerHTML = '<div class="warnbox">La hora de fin tiene que ser después de la de inicio. Si termina pasada la medianoche, marcá "Termina al día siguiente".</div>';
    return;
  }
  if(cruceMedianocheMalMarcado(horaInicio, horaFin, cruza)){ warn.innerHTML = `<div class="warnbox">${escaparHtml(AVISO_CRUCE_MEDIANOCHE)}</div>`; return; }
  const fam = agendaFamilias.find(f=>normaliza(f.nombre)===normaliza(familiaTxt));
  let cobroFinal = null;
  if(tipo==='traslado'){
    // Traslado: el total ya viene armado (por km, o tipeado a mano) — no se multiplica por
    // horas, eso es solo para sitting.
    const cobroTraslado = document.getElementById('agenda-cobro-traslado')?.value;
    cobroFinal = cobroTraslado ? Number(cobroTraslado) : null;
  } else if(tarifa && horaFin){
    const horas = horasSitting(horaInicio, horaFin, cruza, fam, fecha);
    cobroFinal = horas ? redondearCobro(Number(tarifa)*horas.cobro) : null;
  }
  // Solicitud en un paso (25/10/2026): si ya viene con niñera, queda confirmada, con su niñera y
  // cargada en Sittings & traslados, con los mismos avisos que al asignar desde la tarjeta.
  const nineraTxt = document.getElementById('agenda-ninera')?.value.trim() || '';
  let ninera = null, pago = 0;
  if(nineraTxt){
    ninera = agendaNinierasBase.find(n=>normaliza(n.nombre)===normaliza(nineraTxt));
    if(!ninera){ warn.innerHTML = '<div class="warnbox">Elegí una niñera de la lista (o dejá el campo vacío para asignarla después).</div>'; return; }
    if(tipo==='traslado') pago = redondearPago(Number(document.getElementById('agenda-pago-traslado')?.value)||0);
    else {
      const pagoHora = Number(document.getElementById('agenda-pago-hora')?.value)||0;
      const horas = horaFin ? horasSitting(horaInicio, horaFin, cruza, fam, fecha) : null;
      pago = horas && pagoHora ? redondearPago(pagoHora*horas.real) : 0; // sin hora de fin va en $0, como el registro
    }
    const choque = chequearDobleReservaAgenda(ninera.nombre, fecha, horaInicio, horaFin || null, null);
    if(!(await avisarSiDobleReserva(choque, ninera.nombre, 'Asignar igual'))) return;
    if(fam){
      const cubierta = await chequearFamiliaYaCubierta(fam.id, fecha, horaInicio, horaFin || null, ninera.nombre, null);
      if(!(await avisarSiFamiliaYaCubierta(cubierta, familiaTxt, 'Sí, van dos'))) return;
    }
  }
  // Sin hora de fin no hay total: la tarifa por hora no es lo que se cobra. Antes se guardaba la
  // tarifa como cobro total y pasaba así al registro al asignar (auditoría, 21/10/2026). El total
  // se calcula cuando se carga la hora de fin en Sittings & traslados.
  const solicitud = {
    familia_id: fam ? fam.id : null,
    familia_nombre: familiaTxt,
    tipo, zona: zona || (fam ? fam.zona : null),
    fecha, hora_inicio: horaInicio, hora_fin: horaFin || null,
    termina_dia_siguiente: cruza,
    cobro_familia: cobroFinal,
    estado: ninera ? 'confirmada' : 'sin_asignar',
  };
  const precioNinera = ninera && tipo==='sitting' ? precioNineraAGuardarAgenda() : null;
  const { data: creada, error } = await sb.from('solicitudes').insert(solicitud).select('id').single();
  if(error){ warn.innerHTML = errBox(error); return; }
  let resultado = null;
  if(ninera){
    resultado = await cargarNineraYRegistro({ ...solicitud, id: creada.id }, ninera, pago, fam);
    if(resultado.errorNinera){
      // El pedido queda guardado, pero sin niñera, para asignarla después desde la tarjeta.
      const { error: eVuelta } = await sb.from('solicitudes').update({estado:'sin_asignar'}).eq('id', creada.id).eq('estado', 'confirmada');
      warn.innerHTML = errBox(resultado.errorNinera) + `<div class="warnbox">El pedido quedó guardado sin niñera${eVuelta ? ' (y marcado como confirmado: avisale a Diego)' : ''}: cerrá y asignala desde la tarjeta.</div>`;
      return;
    }
  }
  cerrarModal();
  agendaAncla = fecha;
  const lbl = document.getElementById('agenda-fecha-label');
  if(lbl) lbl.textContent = agendaRangoLabel();
  await cargarAgendaSolicitudes();
  actualizarAgendaBadge();
  if(resultado) avisarResultadoAsignacion(resultado);
  else toast('Solicitud guardada.');
  // El precio de la niñera con esta familia, después de asignarla: si falla, lo asignado queda y se avisa.
  if(precioNinera){
    const aviso = avisoPrecioGuardado(await guardarPrecioNineraFamilia(precioNinera), precioNinera.nineraNombre, 'Quedó asignada, pero');
    if(aviso) toast(aviso.texto, aviso.tipo);
    else toast(`Precio de ${precioNinera.nineraNombre} con esta familia guardado.`);
  }
}
/* La niñera confirmada del pedido y, de una, el registro real en Sittings & traslados (al asignar
   desde la tarjeta y, desde el 25/10/2026, al guardar una solicitud que ya viene con niñera). Ya
   no hace falta un paso aparte de "Cargar sitting". Un sitting sin hora de fin va en $0 y se
   calcula al cargarla (un pedido viejo puede traer la tarifa por hora guardada como total); un
   traslado no tiene hora de fin: lleva su cobro total. */
async function cargarNineraYRegistro(s, ninera, pago, familia){
  const { error: errorNinera } = await sb.from('solicitud_ninieras').insert({
    solicitud_id: s.id, ninera_id: ninera.id, ninera_nombre: ninera.nombre,
    estado: 'confirmada', pago_ninera: pago,
  });
  if(errorNinera) return { errorNinera };
  const faltaFin = s.tipo!=='traslado' && !s.hora_fin;
  const { error: errorRegistro } = await sb.from('sittings_traslados').insert({
    tipo: s.tipo, registrado_por: registradoPorUsuario(),
    familia_id: familia?.id || s.familia_id || null, familia_nombre: s.familia_nombre,
    ninera_id: ninera.id, ninera_nombre: ninera.nombre,
    fecha: s.fecha, hora_inicio: s.hora_inicio, hora_fin: s.hora_fin || null,
    termina_dia_siguiente: !!s.termina_dia_siguiente,
    cobro_familia: faltaFin ? 0 : (Number(s.cobro_familia)||0), pago_ninera: pago,
    cobrado: false, pagado: false, notas: 'Asignado desde Agenda',
  });
  return { errorRegistro, faltaFin };
}
function avisarResultadoAsignacion({errorRegistro, faltaFin}){
  if(errorRegistro) toast('Quedó asignado, pero no se pudo cargar en Sittings & traslados: '+errorRegistro.message, 'bad');
  else if(faltaFin) toast('Asignado. Falta la hora de fin: el cobro se calcula cuando la cargues en Sittings & traslados.');
  else toast('Asignado — ya quedó cargado en Sittings & traslados.');
}
async function guardarAsignacionFijaNueva(){
  const familiaTxt = document.getElementById('agenda-familia').value.trim();
  const nineraNombre = document.getElementById('agenda-repetir-ninera').value.trim();
  const warn = document.getElementById('agenda-nueva-warn');
  if(!familiaTxt || !nineraNombre){ warn.innerHTML = '<div class="warnbox">Elegí la familia y la niñera.</div>'; return; }
  if(!agendaFamilias.some(f=>normaliza(f.nombre)===normaliza(familiaTxt)) && !(await confirmarNombreNuevo(familiaTxt, agendaFamilias, 'familia'))) return;
  if(!agendaNinierasBase.some(n=>normaliza(n.nombre)===normaliza(nineraNombre)) && !(await confirmarNombreNuevo(nineraNombre, agendaNinierasBase, 'niñera'))) return;
  const dias = [...document.querySelectorAll('#agenda-repetir-dias .daybtn.selected')].map(b=>b.dataset.dia);
  if(!dias.length){ warn.innerHTML = '<div class="warnbox">Elegí al menos un día.</div>'; return; }
  const varia = document.getElementById('agenda-repetir-varia').checked;
  const fam = agendaFamilias.find(f=>normaliza(f.nombre)===normaliza(familiaTxt));
  const ninera = agendaNinierasBase.find(n=>normaliza(n.nombre)===normaliza(nineraNombre));
  const tipo = document.getElementById('agenda-repetir-tipo')?.value || 'sitting';
  const desde = document.getElementById('agenda-repetir-desde')?.value || todayISO();
  const precio = tipo==='traslado' ? { cobro_traslado: Number(document.getElementById('agenda-repetir-cobro')?.value)||null, pago_traslado: Number(document.getElementById('agenda-repetir-pago')?.value)||null } : {};
  const base = { familia_id: fam?fam.id:null, ninera_nombre:nineraNombre, ninera_id: ninera?.id || null, tipo, vigente_desde: desde, ...precio };
  let filas = [];
  if(varia){
    for(const d of dias){
      filas.push({ ...base, dias:[d], hora_inicio: leerHora('agenda-rep-hi-'+d)||null, hora_fin: leerHora('agenda-rep-hf-'+d)||null });
    }
  } else {
    filas.push({ ...base, dias, hora_inicio: leerHora('agenda-rep-hi')||null, hora_fin: leerHora('agenda-rep-hf')||null });
  }
  for(const fila of filas){
    const problema = problemaFijoNuevo(fila);
    if(problema){ warn.innerHTML = `<div class="warnbox">${escaparHtml(problema)}${varia ? ` (${escaparHtml(DIAS_CORTO[fila.dias[0]]||fila.dias[0])})` : ''}</div>`; return; }
  }
  if(!(await avisarSiFijoDuplicado({ familia_id: base.familia_id, ninera_nombre: nineraNombre, dias, vigente_desde: desde }))) return;
  let choque = null;
  for(const fila of filas){
    choque = await chequearFijoNuevoContraTodo(nineraNombre, fila.dias, fila.hora_inicio, fila.hora_fin);
    if(choque) break;
  }
  if(!(await avisarSiDobleReserva(choque, nineraNombre, 'Crear igual'))) return;
  const { error } = await escribirAsignacion(p=>sb.from('asignaciones').insert(p), filas);
  if(error){ warn.innerHTML = errBox(error); return; }
  cerrarModal();
  await sincronizarPrevistosFijos();
  await cargarAgendaSolicitudes();
  actualizarAgendaBadge();
  toast('Asignación fija guardada — va a aparecer en Agenda los días que elegiste.');
}

// La familia de un pedido: por su id (el nombre del pedido es el de cuando se cargó, y dos familias pueden
// llamarse igual; revisión final, 31/10/2026); el nombre, solo para pedidos sin familia_id.
function familiaDeSolicitud(s){
  if(!s) return null;
  return (s.familia_id && agendaFamilias.find(f=>f.id===s.familia_id))
    || agendaFamilias.find(f=>normaliza(f.nombre)===normaliza(s.familia_nombre)) || null;
}
async function abrirModalAsignar(solicitudId){
  await esperarConfigFijos(); // fijos automáticos: saber si hay que sacar los previstos
  const s = agendaSolicitudes.find(x=>x.id===solicitudId);
  if(!s) return;
  abrirModal('<div class="empty"><span class="spinner dark"></span> Buscando niñeras recomendadas…</div>');
  if(!zonaGruposCache) await cargarZonaGrupos();
  const familiaSol = familiaDeSolicitud(s);
  const [{data:histFam}, {data:histTotal}, {data:sitTotal}, preciosFam] = await Promise.all([
    sb.from('solicitud_ninieras').select('ninera_nombre, solicitudes!inner(familia_nombre)').eq('estado','confirmada').eq('solicitudes.familia_nombre', s.familia_nombre),
    sb.from('solicitud_ninieras').select('ninera_nombre').eq('estado','confirmada'),
    leerTodasLasFilas(()=>sinPrevistos(sb.from('sittings_traslados').select('ninera_nombre')).order('id')),
    s.tipo==='traslado' ? [] : leerPreciosNinera(familiaSol?.id), // precio de cada niñera con esta familia (01/11/2026)
  ]);
  const conteoFamilia = {};
  (histFam||[]).forEach(r=>{ const k=normaliza(r.ninera_nombre); conteoFamilia[k]=(conteoFamilia[k]||0)+1; });
  const conteoTotal = {};
  (histTotal||[]).forEach(r=>{ const k=normaliza(r.ninera_nombre); conteoTotal[k]=(conteoTotal[k]||0)+1; });
  (sitTotal||[]).forEach(r=>{ const k=normaliza(r.ninera_nombre); conteoTotal[k]=(conteoTotal[k]||0)+1; });

  const yaInvitadas = new Set(s.ninieras.map(x=>normaliza(x.ninera_nombre)));
  const candidatas = agendaNinierasBase.filter(n=>!yaInvitadas.has(normaliza(n.nombre)));
  // Misma regla que va a usar el ticket desde WhatsApp (etapa 5): no dejar que la Agenda
  // ordene distinto. Por ahora este modal solo tiene historial y zonas; al enviar pedidos por la
  // app se le suman guía, temporada, no disponibilidad y experiencias de edad.
  const orden = ordenarSugeridas({ tipo:s.tipo, zona:s.zona }, {
    ninieras:candidatas, historialFamilia:conteoFamilia, historialTotal:conteoTotal,
  });
  const tier1 = orden.sugeridas.filter(n=>n.bloque===1);
  const tier2 = orden.sugeridas.filter(n=>n.bloque===2);
  const tier3 = orden.sugeridas.filter(n=>n.bloque===3);
  const inactivas = orden.inactivas;

  // Ya no se invita por WhatsApp a varias y se espera respuesta -- se elige la niñera
  // directo, se ve/ajusta cuánto le corresponde, y se guarda con todo asignado de una:
  // familia, niñera, pago, Y el registro real en Sittings & traslados (antes esto último
  // quedaba pendiente de un paso aparte). Mismo criterio para sitting y traslado.
  // El pago sugerido de un sitting depende de la niñera: horas por su precio con esta familia o la
  // tarifa (precioHoraNinera, 01/11/2026). Un traslado, por el cobro menos el margen.
  let pagoTraslado = 0;
  if(s.tipo==='traslado'){
    if(!tarifaTrasladoConfig) await cargarTarifaTrasladoConfig();
    const margenNinera = Number(tarifaTrasladoConfig?.margen_ninera)||0;
    pagoTraslado = s.cobro_familia ? redondearAbajo50(Number(s.cobro_familia) * (1 - margenNinera)) : 0;
  }
  const pagoSugerido = n => {
    if(s.tipo==='traslado') return pagoTraslado;
    const pagoHora = Number(precioHoraNinera(familiaSol, n.id, preciosFam))||0;
    if(!pagoHora || !s.hora_inicio || !s.hora_fin) return 0;
    const mi = agendaMinutos(s.hora_inicio);
    let mf = agendaMinutos(s.hora_fin);
    if(s.termina_dia_siguiente) mf += 24*60;
    return redondearPago(Math.max(0, mf-mi)/60*pagoHora);
  };
  const filaSel = (n, sub) => `
    <label class="agenda-ninera-pick">
      <input type="radio" name="agenda-asignar-ninera" value="${escaparHtml(n.id)}" data-nombre="${escaparHtml(n.nombre)}" onchange="onAgendaNineraSel(${pagoSugerido(n)})">
      <div><b>${escaparHtml(n.nombre)}</b><div class="helper" style="margin:0;">${escaparHtml(sub)}</div></div>
    </label>`;
  const html = `
    <h2>Asignar niñera${s.tipo==='traslado'?' al traslado':''}</h2>
    <div class="helper">${escaparHtml(s.familia_nombre)} · ${s.tipo==='traslado'?'Traslado':'Sitting'} · ${s.hora_inicio.slice(0,5)}${s.hora_fin?'–'+s.hora_fin.slice(0,5):''}${s.zona?escaparHtml(' · '+s.zona):''}${s.cobro_familia?` · Cobro a familia $${Number(s.cobro_familia).toLocaleString('es-UY')}`:''}</div>
    ${tier1.length ? `<div class="agenda-tier-label">Ya trabajaron con esta familia</div>${tier1.map(n=>filaSel(n.ninera, n.motivo)).join('')}` : ''}
    ${tier2.length ? `<div class="agenda-tier-label">Cubren ${escaparHtml(s.zona||'esta zona')}</div>${tier2.map(n=>filaSel(n.ninera, n.motivo)).join('')}` : ''}
    ${!tier1.length && !tier2.length ? '<div class="helper">Nadie con historial o zona coincidente todavía — mostrando el resto del equipo.</div>' : ''}
    <button type="button" class="smallbtn" style="margin:6px 0;" onclick="document.getElementById('agenda-tier3').style.display='block';this.style.display='none';">+ Niñeras</button>
    <div id="agenda-tier3" style="display:${(!tier1.length && !tier2.length) ? 'block' : 'none'};">
      <div class="agenda-tier-label">Resto del equipo</div>
      ${tier3.map(n=>filaSel(n.ninera, n.motivo)).join('')}
      ${inactivas.length ? `<div class="agenda-tier-label">Inactivas</div>${inactivas.map(n=>filaSel(n.ninera, 'Está inactiva.')).join('')}` : ''}
    </div>
    <div id="agenda-asignar-pago-wrap" style="display:none;margin-top:10px;" ${preciosNoLeidos(preciosFam) ? 'data-precios-no-leidos="1"' : ''}>
      <div class="field"><label>Pago a la niñera</label><div class="moneyfield"><input type="number" id="agenda-asignar-pago" oninput="marcarCampoEditadoManual('agenda-asignar-pago')"></div></div>
      <div id="agenda-asignar-precio-aviso"></div>
      <div id="agenda-asignar-warn"></div>
      <button class="btn primary" style="width:100%;margin-top:6px;" onclick="conGuardado(this, ()=>guardarAsignacionDirecta(${argJs(s.id)}))">Guardar asignación</button>
    </div>
  `;
  abrirModal(html);
}
function onAgendaNineraSel(pagoSugerido){
  const wrap = document.getElementById('agenda-asignar-pago-wrap');
  const pagoInput = document.getElementById('agenda-asignar-pago');
  if(!wrap || !pagoInput) return;
  wrap.style.display = '';
  if(!pagoInput.dataset.tocadoManual){ pagoInput.value = pagoSugerido; marcarCampoSugerido('agenda-asignar-pago'); }
  // Si no se pudieron leer los precios, el sugerido va con la tarifa: a la vista, con el nombre de la elegida.
  const aviso = document.getElementById('agenda-asignar-precio-aviso');
  const sel = document.querySelector('input[name="agenda-asignar-ninera"]:checked');
  if(aviso) aviso.innerHTML = wrap.dataset.preciosNoLeidos && sel ? `<div class="warnbox">${escaparHtml(avisoPreciosNoLeidosTarifa(sel.dataset.nombre))}</div>` : '';
}
async function guardarAsignacionDirecta(solicitudId){
  const sel = document.querySelector('input[name="agenda-asignar-ninera"]:checked');
  const warn = document.getElementById('agenda-asignar-warn');
  if(!sel){ warn.innerHTML = '<div class="warnbox">Elegí una niñera.</div>'; return; }
  const s = agendaSolicitudes.find(x=>x.id===solicitudId);
  const choque = chequearDobleReservaAgenda(sel.dataset.nombre, s?.fecha, s?.hora_inicio, s?.hora_fin, solicitudId);
  if(!(await avisarSiDobleReserva(choque, sel.dataset.nombre, 'Asignar igual'))) return;
  const familia = familiaDeSolicitud(s);
  if(familia && s?.hora_inicio){
    const choqueFamilia = await chequearFamiliaYaCubierta(familia.id, s.fecha, s.hora_inicio, s.hora_fin, sel.dataset.nombre, null);
    if(!(await avisarSiFamiliaYaCubierta(choqueFamilia, s.familia_nombre, 'Sí, van dos'))) return;
  }
  const pago = redondearPago(document.getElementById('agenda-asignar-pago').value);
  // Primero se toma el pedido, con la condición de que siga sin asignar: si otra admin lo asignó
  // (o lo canceló) mientras se elegía, no se carga una segunda niñera ni un segundo registro
  // (auditoría, 21/10/2026). Si las dos guardan a la vez, la base deja pasar a una sola.
  const estadoAntes = s?.estado || 'sin_asignar';
  const { data: tomada, error: e0 } = await sb.from('solicitudes').update({estado:'confirmada'})
    .eq('id', solicitudId).in('estado', ['sin_asignar','pendiente_confirmar']).select('id');
  if(e0){ warn.innerHTML = errBox(e0); return; }
  if(!tomada || !tomada.length){
    warn.innerHTML = '<div class="warnbox">No se cargó nada: mientras elegías, alguien más ya asignó este pedido (o lo canceló). Cerrá para ver cómo quedó.</div>';
    return;
  }
  const resultado = await cargarNineraYRegistro(s, { id: sel.value, nombre: sel.dataset.nombre }, pago, familia);
  if(resultado.errorNinera){
    // El pedido vuelve a como estaba, así se puede reintentar sin que quede "confirmado" sin niñera.
    const { error: eVuelta } = await sb.from('solicitudes').update({estado: estadoAntes}).eq('id', solicitudId).eq('estado', 'confirmada');
    warn.innerHTML = errBox(resultado.errorNinera) + (eVuelta ? '<div class="warnbox">Además, el pedido quedó como confirmado sin niñera: avisale a Diego.</div>' : '');
    return;
  }
  cerrarModal();
  await cargarAgendaSolicitudes();
  actualizarAgendaBadge();
  avisarResultadoAsignacion(resultado);
}
function abrirModalSolicitud(id){
  const s = agendaSolicitudes.find(x=>x.id===id);
  if(!s) return;
  if(s._fuente==='asignacion'){ abrirModalAsignacionFija(s); return; }
  if(s._fuente==='registro'){ abrirModalRegistroDesdeAgenda(s); return; }
  const horario = s.termina_dia_siguiente
    ? `${s.hora_inicio.slice(0,5)} → día siguiente${s.hora_fin?' '+s.hora_fin.slice(0,5):''}`
    : (s.hora_fin ? `${s.hora_inicio.slice(0,5)}–${s.hora_fin.slice(0,5)}` : s.hora_inicio.slice(0,5));
  const fechaTxt = new Date(s.fecha+'T00:00:00').toLocaleDateString('es-UY',{weekday:'long',day:'numeric',month:'long'});
  let ninierasHtml = '';
  if(s.ninieras.length){
    ninierasHtml = s.ninieras.map(n=>`
      <div class="agenda-ninerarow">
        <div>
          <b>${escaparHtml(n.ninera_nombre)}</b>
          <span class="badge ${n.estado==='confirmada'?'good':n.estado==='rechazada'?'bad':'warn'}">${n.estado==='confirmada'?'Confirmada':n.estado==='rechazada'?'Rechazada':'Pendiente'}</span>
          ${n.pago_ninera ? `<div class="helper" style="margin:2px 0 0;">Pago ${textoPagoAgenda({...s, pago_ninera: n.pago_ninera})}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          ${n.estado!=='confirmada' ? `<button class="smallbtn" onclick="conGuardado(this, ()=>confirmarNinera(${argJs(n.id)}))">Confirmar</button>` : ''}
          <a class="smallbtn" href="${urlSegura(waLink(agendaTelefonoNinera(n.ninera_nombre), mensajeWA(s, n.ninera_nombre)))}" target="_blank" rel="noopener">WhatsApp</a>
        </div>
      </div>`).join('');
  }
  const cuerpo = `
    <h2>${escaparHtml(s.familia_nombre)}</h2>
    <div class="helper">${s.tipo==='traslado'?'Traslado':'Sitting'} · ${fechaTxt} · ${horario}${s.zona?escaparHtml(' · '+s.zona):''}</div>
    ${s.cobro_familia ? `<div class="helper">Cobro a la familia: $${Number(s.cobro_familia).toLocaleString('es-UY')}</div>`:''}
    <div style="margin:14px 0;">${ninierasHtml || '<div class="empty">Todavía no hay niñeras asignadas.</div>'}</div>
    ${s.estado==='sin_asignar' ? `<button class="btn primary" style="width:100%;margin-bottom:8px;" onclick="cerrarModal();abrirModalAsignar(${argJs(s.id)})">Asignar niñera</button>` : ''}
    ${s.estado==='pendiente_confirmar' ? `<button class="btn" style="width:100%;margin-bottom:8px;" onclick="cerrarModal();abrirModalAsignar(${argJs(s.id)})">+ Agregar otra niñera</button>` : ''}
    ${s.estado!=='cancelada' ? `<button class="btn danger" style="width:100%;" onclick="conGuardado(this, ()=>cancelarSolicitud(${argJs(s.id)}))">Cancelar solicitud</button>` : `<div class="warnbox">Esta solicitud fue cancelada.</div>`}
  `;
  abrirModal(cuerpo);
}
function abrirModalAsignacionFija(s){
  const asigId = s._asigId;
  const a = s._raw;
  const horario = a.hora_inicio ? `${a.hora_inicio.slice(0,5)}${a.hora_fin?'–'+a.hora_fin.slice(0,5):''}` : 'Sin horario cargado';
  const diasTxt = (a.dias||[]).map(d=>DIAS_CORTO[d]||d).join(' ');
  const esTraslado = tipoAsignacion(a)==='traslado';
  // Cambio de niñera "desde una fecha" (05/10/2026, E2): por defecto desde hoy, nunca antes
  // de que empiece este fijo.
  const hoy = todayISO();
  const desdeSugerido = a.vigente_desde && a.vigente_desde > hoy ? a.vigente_desde : hoy;
  // Un fijo que ya terminó (por ejemplo, la asignación vieja después de un cambio de niñera)
  // se ve en las semanas pasadas solo para registrar esos días: no se le cambia la niñera,
  // el horario ni se borra (perdería su historia).
  const terminado = asignacionTerminada(a, hoy);
  // Fijos automáticos: si este día ya está cargado como previsto, "solo este día" cambia esa
  // fila (horario, no fue, reemplazo) en vez de crear otra.
  const prev = s._previsto || null;
  const desdeHorarioSugerido = a.vigente_desde && a.vigente_desde > hoy ? a.vigente_desde : hoy;
  const pausasDelFijo = (agendaPausas||[]).filter(p=>p.asignacion_id===asigId && p.hasta >= hoy);
  const fmtCorta = iso => new Date(iso+'T12:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'2-digit'});
  const cuerpo = `
    <h2>${escaparHtml(s.familia_nombre)}</h2>
    <div class="helper">${esTraslado?'Traslado':'Sitting'} fijo · ${diasTxt || 'sin días'} · ${horario}${esTraslado && a.cobro_traslado!=null ? ` · $${Number(a.cobro_traslado).toLocaleString('es-UY')} / $${Number(a.pago_traslado||0).toLocaleString('es-UY')}` : ''}</div>
    <div class="helper" style="margin-top:2px;">Lo hace <b>${escaparHtml(a.ninera_nombre||'(sin niñera)')}</b> · vigente ${textoVigencia(a)}</div>
    ${terminado ? `<div class="helper" style="margin:14px 0 8px;">Este fijo terminó el ${new Date(a.vigente_hasta+'T12:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'2-digit',year:'2-digit'})}. Para cambiar quién lo hace de acá en adelante, abrí una tarjeta de una semana actual.</div>
    <button class="btn" style="width:100%;margin-bottom:8px;" onclick="abrirModalVigenciaAsignacion(${argJs(asigId)})">Editar vigencia y tipo</button>` : `
    <div class="grid2" style="margin-top:14px;">
      <div class="field" style="position:relative;"><label>Cambiar a la niñera</label>
        <input type="text" id="agenda-fija-ninera-${asigId}" autocomplete="off" placeholder="Elegí la niñera nueva">
        <div id="agenda-fija-ninera-${asigId}-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
      </div>
      <div class="field"><label>Desde</label><input type="date" id="agenda-fija-desde-${asigId}" value="${desdeSugerido}"></div>
    </div>
    <div class="helper" style="margin:-4px 0 8px;">Lo anterior a esa fecha no cambia: sigue siendo de quien lo hizo.</div>
    <div id="agenda-fija-warn"></div>
    <button class="btn primary" id="agenda-fija-guardar-${asigId}" style="width:100%;margin-bottom:8px;" onclick="conGuardado(this, ()=>cambiarNineraAsignacionFija(${argJs(asigId)}))">Cambiar niñera desde esa fecha</button>
    <button class="btn" style="width:100%;margin-bottom:8px;" onclick="abrirModalVigenciaAsignacion(${argJs(asigId)})">${esTraslado && 'cobro_traslado' in a ? 'Editar vigencia, tipo y precio' : 'Editar vigencia y tipo'}</button>

    <div style="height:1px;background:var(--line);margin:14px 0;"></div>
    <button type="button" class="btn" id="agenda-fija-edit-toggle" style="width:100%;" onclick="document.getElementById('agenda-fija-edit-box').style.display='block';this.style.display='none';">Editar horarios futuros</button>
    <div id="agenda-fija-edit-box" style="display:none;">
      <div class="helper" style="margin:10px 0 8px;">Desde la fecha que elijas. Lo anterior conserva el horario que tuvo y lo ya registrado no se toca:</div>
      <div class="field" style="margin-bottom:8px;"><label>Desde</label><input type="date" id="agenda-fija-edit-desde" value="${desdeHorarioSugerido}"></div>
      <div class="grid2" style="margin-bottom:8px;">
        <div class="field"><label>Hora inicio</label>${selectHora('agenda-fija-edit-hi')}</div>
        <div class="field"><label>Hora fin</label>${selectHora('agenda-fija-edit-hf')}</div>
      </div>
      <div class="dayrow" id="agenda-fija-edit-dias" style="margin-bottom:8px;">
        ${['L','M','X','J','V','S','D'].map(d=>`<button type="button" class="daybtn ${(a.dias||[]).includes(d)?'selected':''}" data-dia="${d}" onclick="this.classList.toggle('selected')">${DIAS_CORTO[d]}</button>`).join('')}
      </div>
      <div id="agenda-fija-edit-warn"></div>
      <button class="btn primary" style="width:100%;margin-bottom:8px;" onclick="conGuardado(this, ()=>guardarHorarioAsignacionFija(${argJs(asigId)}))">Guardar horario/días desde esa fecha</button>
    </div>
    ${fijosAutomaticosActivos ? `
    <div style="height:1px;background:var(--line);margin:14px 0;"></div>
    ${pausasDelFijo.map(p=>`<div class="agenda-ninerarow"><div>Pausado del ${fmtCorta(p.desde)} al ${fmtCorta(p.hasta)}${p.motivo?` <span class="helper" style="margin:0;">· ${escaparHtml(p.motivo)}</span>`:''}</div>
      <button class="smallbtn" onclick="conGuardado(this, ()=>quitarPausaFijo(${argJs(p.id)}))">Quitar pausa</button></div>`).join('')}
    <button class="btn" style="width:100%;" onclick="abrirModalPausarFijo(${argJs(asigId)})">Pausar este fijo (vacaciones)</button>` : ''}`}

    <div style="height:1px;background:var(--line);margin:14px 0;"></div>
    ${prev
      ? `<div class="helper" style="margin-bottom:8px;">Este día (${fmtCorta(s.fecha)}) ya está <b>previsto</b> con ${escaparHtml(prev.ninera_nombre)}${prev.cobro_familia!=null?` · cobro $${Number(prev.cobro_familia).toLocaleString('es-UY')}`:''}: se confirma solo ese día. Si cambia algo solo ese día, corregilo acá:</div>`
      : `<div class="helper" style="margin-bottom:8px;">Corregir solo el día de hoy (${s.fecha}), sin tocar el fijo:</div>`}
    ${s._yaRegistrado
      ? `<div class="helper" style="margin-bottom:8px;">Ya hay un registro cargado para ${escaparHtml(a.ninera_nombre)} este día en Sittings.</div>`
      : `<div class="grid2" style="margin-bottom:8px;">
           <div class="field"><label>Hora inicio</label>${selectHora('agenda-fija-hi')}</div>
           <div class="field"><label>Hora fin</label>${selectHora('agenda-fija-hf')}</div>
         </div>
         <label class="chk" style="margin:-4px 0 10px;"><input type="checkbox" id="agenda-fija-cruza" onchange="pintarFinCobroAgenda()"> Termina al día siguiente</label>
         ${esTraslado ? '' : `<div class="helper" id="agenda-fija-fin-cobro" data-familia="${escaparHtml(a.familia_id)}" data-fecha="${escaparHtml(s.fecha)}" style="margin:-4px 0 8px;"></div>`}
         ${esTraslado ? `<div class="grid2" style="margin-bottom:8px;">
           <div class="field"><label>Cobro del traslado</label><div class="moneyfield"><input type="number" id="agenda-fija-cobro"></div></div>
           <div class="field"><label>Pago a la niñera</label><div class="moneyfield"><input type="number" id="agenda-fija-pago"></div></div>
         </div>
         <div class="helper" id="agenda-fija-precio-helper" style="margin:-4px 0 8px;"></div>` : ''}
         <div id="agenda-fija-horario-warn"></div>
         <button class="btn primary" style="width:100%;margin-bottom:8px;" onclick="conGuardado(this, ()=>registrarSittingFijoDeHoy(${argJs(s.id)}))">${prev ? 'Guardar el cambio de este día' : `Registrar ${esTraslado?'traslado':'sitting'} de este día`}</button>
         <button class="btn" style="width:100%;margin-bottom:8px;" onclick="mostrarExcepcionAsignacionFija(${argJs(s.id)})">Este día no fue</button>`}
    ${terminado ? '' : `<button class="btn danger" style="width:100%;" onclick="abrirModalTerminarFijo(${argJs(asigId)})">Terminar este fijo desde una fecha</button>`}
  `;
  abrirModal(cuerpo);
  setHoraSelect('agenda-fija-edit-hi', a.hora_inicio||'');
  setHoraSelect('agenda-fija-edit-hf', a.hora_fin||'');
  if(!s._yaRegistrado){
    setHoraSelect('agenda-fija-hi', (prev ? prev.hora_inicio : a.hora_inicio)||'');
    setHoraSelect('agenda-fija-hf', (prev ? prev.hora_fin : a.hora_fin)||'');
    if(prev && prev.termina_dia_siguiente){ const c = document.getElementById('agenda-fija-cruza'); if(c) c.checked = true; }
    pintarFinCobroAgenda();
  }
  attachAutocomplete('agenda-fija-ninera-'+asigId, 'agenda-fija-ninera-'+asigId+'-dropdown', ()=>agendaNinierasBase, ()=>{});
  if(esTraslado && !s._yaRegistrado){
    if(prev){
      const c = document.getElementById('agenda-fija-cobro'), p = document.getElementById('agenda-fija-pago');
      if(c) c.value = Number(prev.cobro_familia)||0;
      if(p) p.value = Number(prev.pago_ninera)||0;
    } else precargarPrecioTrasladoFijo(a);
  }
}
/* Un traslado fijo no se cobra por hora: se precarga con el precio cargado en el fijo o, si
   no tiene, con lo del último traslado de ese fijo (o de esa familia), y queda editable. */
// Al partir un fijo (otra niñera u otro horario desde una fecha) el nuevo conserva el precio
// del traslado. Solo si la base ya tiene esas columnas.
function precioTrasladoDelFijo(a){
  return 'cobro_traslado' in a ? {cobro_traslado: a.cobro_traslado ?? null, pago_traslado: a.pago_traslado ?? null} : {};
}
async function precargarPrecioTrasladoFijo(a){
  const cobro0 = document.getElementById('agenda-fija-cobro');
  const pago0 = document.getElementById('agenda-fija-pago');
  const helper0 = document.getElementById('agenda-fija-precio-helper');
  if(a.cobro_traslado!=null && a.pago_traslado!=null && cobro0 && pago0){
    if(!cobro0.value) cobro0.value = Number(a.cobro_traslado)||0;
    if(!pago0.value) pago0.value = Number(a.pago_traslado)||0;
    if(helper0) helper0.textContent = 'Precio del fijo.';
    return;
  }
  // Solo traslados que ya pasaron y no son previstos: antes tomaba un previsto del futuro
  // ("último traslado (22/10)") que a su vez venía de un precio con la comida sumada (13/10/2026).
  // cobro_familia nunca incluye los gastos extra (van aparte), así que no hay nada que restar.
  const hoy = todayISO();
  let { data } = await sinPrevistos(sb.from('sittings_traslados').select('fecha,cobro_familia,pago_ninera').eq('asignacion_id', a.id).eq('cancelado', false)).lte('fecha', hoy).order('fecha', {ascending:false}).limit(1);
  if(!data || !data.length){
    ({ data } = await sinPrevistos(sb.from('sittings_traslados').select('fecha,cobro_familia,pago_ninera').eq('familia_id', a.familia_id).eq('tipo', 'traslado').eq('cancelado', false)).lte('fecha', hoy).order('fecha', {ascending:false}).limit(1));
  }
  const ultimo = (data||[])[0];
  const cobro = document.getElementById('agenda-fija-cobro');
  const pago = document.getElementById('agenda-fija-pago');
  const helper = document.getElementById('agenda-fija-precio-helper');
  if(!ultimo || !cobro || !pago) return;
  if(!cobro.value) cobro.value = Number(ultimo.cobro_familia)||0;
  if(!pago.value) pago.value = Number(ultimo.pago_ninera)||0;
  if(helper) helper.textContent = `Precargado con el último traslado (${new Date(ultimo.fecha+'T12:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'2-digit'})}). Revisalo antes de registrar.`;
}
/* Editar horarios futuros DESDE una fecha (06/10/2026). Antes cambiaba el fijo entero y
   las semanas pasadas sin registrar pasaban a mostrar el horario nuevo (el mismo problema
   que E2 con la niñera). Ahora funciona igual que el cambio de niñera: cierra el fijo el día
   anterior y abre otro igual con el horario o los días nuevos. Si la fecha es el primer
   día del fijo (o antes), no hay pasado que cuidar y se cambia ahí mismo. Lo ya registrado
   no se toca; los previstos automáticos se recalculan desde esa fecha. */
async function guardarHorarioAsignacionFija(asigId){
  const warn = document.getElementById('agenda-fija-edit-warn');
  const horaIni = leerHora('agenda-fija-edit-hi');
  const horaFin = leerHora('agenda-fija-edit-hf');
  const desde = document.getElementById('agenda-fija-edit-desde')?.value || todayISO();
  const dias = [...document.querySelectorAll('#agenda-fija-edit-dias .daybtn.selected')].map(b=>b.dataset.dia);
  if(!horaIni || !horaFin){ if(warn) warn.innerHTML = '<div class="warnbox">Completá las dos horas.</div>'; return; }
  if(horaFin<=horaIni){ if(warn) warn.innerHTML = '<div class="warnbox">La hora de fin tiene que ser después de la de inicio.</div>'; return; }
  if(!dias.length){ if(warn) warn.innerHTML = '<div class="warnbox">Elegí al menos un día.</div>'; return; }
  const item = agendaSolicitudes.find(s=>s._asigId===asigId);
  const a = item?._raw;
  if(!a) return;
  if(a.vigente_hasta && desde > a.vigente_hasta){ if(warn) warn.innerHTML = `<div class="warnbox">Este fijo termina el ${escaparHtml(a.vigente_hasta)}: elegí una fecha anterior.</div>`; return; }
  if(a.ninera_nombre){
    const choque = await chequearFijoNuevoContraTodo(a.ninera_nombre, dias, horaIni, horaFin, asigId);
    if(!(await avisarSiDobleReserva(choque, a.ninera_nombre, 'Guardar igual'))) return;
  }
  const baseSinVigencia = asignacionesSinVigencia || !('vigente_desde' in a);
  const enElMismoLugar = baseSinVigencia || !a.vigente_desde || desde <= a.vigente_desde;
  if(enElMismoLugar && !a.vigente_desde && !baseSinVigencia){
    if(warn) warn.innerHTML = '<div class="warnbox">Este fijo no tiene fecha de inicio cargada. Tocá "Editar vigencia y tipo", cargá desde cuándo corre y después cambiá el horario.</div>';
    return;
  }
  let aHoy = null; // el fijo que rige hoy después del cambio (para el sitting de hoy)
  if(enElMismoLugar){
    const { error } = await sb.from('asignaciones').update({hora_inicio: horaIni, hora_fin: horaFin, dias}).eq('id', asigId);
    if(error){ if(warn) warn.innerHTML = errBox(error); return; }
    aHoy = {...a, hora_inicio: horaIni, hora_fin: horaFin, dias};
  } else {
    const nuevaAsig = {
      familia_id: a.familia_id, ninera_nombre: a.ninera_nombre, ninera_id: a.ninera_id || null,
      dias, hora_inicio: horaIni, hora_fin: horaFin,
      cobro_hora: a.cobro_hora ?? null, pago_hora: a.pago_hora ?? null,
      tipo: tipoAsignacion(a), vigente_desde: desde, vigente_hasta: a.vigente_hasta || null,
      ...precioTrasladoDelFijo(a),
    };
    const { data: creada, error: e1 } = await escribirAsignacion(p=>sb.from('asignaciones').insert(p).select().single(), nuevaAsig);
    if(e1){ if(warn) warn.innerHTML = errBox(e1); return; }
    const { error: e2 } = await escribirAsignacion(p=>sb.from('asignaciones').update(p).eq('id', asigId), {vigente_hasta: sumarDiasISO(desde, -1)});
    if(e2){
      const { error: e3 } = await sb.from('asignaciones').delete().eq('id', creada.id);
      if(warn) warn.innerHTML = e3
        ? `<div class="warnbox">No se pudo cerrar el horario anterior y tampoco deshacer el nuevo: quedaron los dos. Abrí "Editar vigencia y tipo" en el fijo anterior y poné "hasta" el día antes del cambio. (${escaparHtml(e2.message)})</div>`
        : errBox(e2);
      return;
    }
    aHoy = creada;
    await moverVariantesAlFijoNuevo(asigId, creada.id); // sus variantes de precio lo siguen (23/10/2026)
  }
  cerrarModal();
  await sincronizarPrevistosFijos();
  // Si hoy deja de ser uno de sus días, el de hoy se cancela; si no, toma el horario nuevo.
  if(desde <= todayISO()) await alinearRegistroDeHoy(asigId, aHoy, 'Cambió el horario del fijo: hoy no va');
  await cargarAgendaSolicitudes();
  const fechaTxt = new Date(desde+'T12:00:00').toLocaleDateString('es-UY',{day:'numeric',month:'long'});
  toast(`Desde el ${fechaTxt} el fijo va de ${horaIni} a ${horaFin}. Lo anterior conserva su horario.`);
  await revisarPrevistosEditadosFueraDelFijo([asigId]);
}
/* Un solo flujo para registrar el sitting de hoy: el horario sale precargado
   con el habitual de la asignación, pero siempre queda editable ahí mismo —
   si no cambió nada, se registra tal cual; si la niñera se quedó de más o se
   fue antes, se ajusta el horario antes de tocar Registrar. Calcula cobro/pago
   exacto por la duración real, con la tarifa de la familia (misma cuenta que
   en Sittings & traslados). */
async function registrarSittingFijoDeHoy(id){
  const s = agendaSolicitudes.find(x=>x.id===id);
  if(!s) return;
  const a = s._raw;
  const horaIni = leerHora('agenda-fija-hi');
  const horaFin = leerHora('agenda-fija-hf');
  const cruza = document.getElementById('agenda-fija-cruza')?.checked || false;
  const warn = document.getElementById('agenda-fija-horario-warn');
  if(!horaIni || !horaFin){ if(warn) warn.innerHTML = '<div class="warnbox">Completá las dos horas.</div>'; return; }
  if(cruceMedianocheMalMarcado(horaIni, horaFin, cruza)){ if(warn) warn.innerHTML = `<div class="warnbox">${escaparHtml(AVISO_CRUCE_MEDIANOCHE)}</div>`; return; }
  const mi = agendaMinutos(horaIni);
  let mf = agendaMinutos(horaFin);
  if(cruza) mf += 24*60;
  if(mf<=mi){ if(warn) warn.innerHTML = '<div class="warnbox">La hora de fin tiene que ser después de la de inicio (o marcá "Termina al día siguiente").</div>'; return; }
  const familia = agendaFamilias.find(f=>f.id===a.familia_id);
  const horas = horasSitting(horaIni, horaFin, cruza, familia, s.fecha);
  const cobroHora = familia ? Number(familia.cobro_hora)||0 : 0;
  const tipo = tipoAsignacion(a);
  // Pago por hora de un día de fijo (01/11/2026): el precio propio del fijo, si no el de la niñera de
  // ese día con esta familia, si no la tarifa. Si el previsto ya figura con otra niñera (un
  // reemplazo), es el de ella, sin el del fijo.
  const prevDia = s._previsto || null;
  const nineraDia = prevDia ? { id: prevDia.ninera_id || null, nombre: prevDia.ninera_nombre } : { id: a.ninera_id || null, nombre: a.ninera_nombre };
  const preciosDia = tipo==='traslado' || !nineraDia.id ? [] : await leerPreciosNinera(a.familia_id, nineraDia.id);
  if(preciosNoLeidos(preciosDia)){ if(warn) warn.innerHTML = `<div class="warnbox">${escaparHtml(AVISO_PRECIOS_NO_LEIDOS)}</div>`; return; }
  const pagoHora = Number(precioHoraNinera(familia, nineraDia.id, preciosDia, pagoFijoDeNinera(a, nineraDia.id, nineraDia.nombre)))||0;
  let cobro = redondearCobro(horas.cobro*cobroHora), pago = redondearPago(horas.real*pagoHora);
  if(tipo==='traslado'){
    const cobroTxt = document.getElementById('agenda-fija-cobro')?.value ?? '';
    const pagoTxt = document.getElementById('agenda-fija-pago')?.value ?? '';
    if(cobroTxt==='' || pagoTxt===''){ if(warn) warn.innerHTML = '<div class="warnbox">Completá el cobro del traslado y el pago a la niñera.</div>'; return; }
    cobro = redondearCobro(cobroTxt); pago = redondearPago(pagoTxt);
  }
  const choque = chequearDobleReservaAgenda(a.ninera_nombre, s.fecha, horaIni, horaFin, s.id);
  if(!(await avisarSiDobleReserva(choque, a.ninera_nombre, 'Registrar igual'))) return;
  const prev = s._previsto || null;
  if(familia){
    const choqueFamilia = await chequearFamiliaYaCubierta(familia.id, s.fecha, horaIni, horaFin, prev ? prev.ninera_nombre : a.ninera_nombre, prev?.id || null);
    if(!(await avisarSiFamiliaYaCubierta(choqueFamilia, s.familia_nombre, 'Sí, van dos'))) return;
  }
  if(prev){
    // Día ya previsto: se corrige esa misma fila y deja de ser automática (el proceso no
    // la vuelve a recalcular). Sigue "prevista" hasta que llegue el día.
    const { error } = await sb.from('sittings_traslados').update({
      hora_inicio: horaIni, hora_fin: horaFin, termina_dia_siguiente: cruza,
      cobro_familia: cobro, pago_ninera: pago, generado_automatico: false,
      registrado_por: registradoPorUsuario(),
    }).eq('id', prev.id);
    if(error){ if(warn) warn.innerHTML = errBox(error); return; }
    cerrarModal();
    await cargarAgendaSolicitudes();
    toast('Listo: ese día queda con el horario nuevo.');
    return;
  }
  // Niñera y tipo salen de la asignación vigente ESE día (la Agenda solo muestra la que
  // corresponde a cada fecha), y el registro queda vinculado a ella.
  const { error } = await sb.from('sittings_traslados').insert({
    tipo,
    registrado_por: registradoPorUsuario(),
    asignacion_id: a.id,
    familia_id: a.familia_id || null,
    familia_nombre: s.familia_nombre,
    ninera_id: a.ninera_id || null,
    ninera_nombre: a.ninera_nombre,
    fecha: s.fecha,
    hora_inicio: horaIni,
    hora_fin: horaFin,
    termina_dia_siguiente: cruza,
    cobro_familia: cobro,
    pago_ninera: pago,
    cobrado: false, pagado: false,
    notas: `${tipo==='traslado'?'Traslado':'Sitting'} fijo — registrado desde Agenda`,
  });
  if(error){ if(warn) warn.innerHTML = errBox(error); return; }
  cerrarModal();
  await cargarAgendaSolicitudes();
  actualizarAgendaBadge();
  toast(tipoAsignacion(a)==='traslado' ? 'Traslado registrado.' : 'Sitting registrado.');
}
function mostrarExcepcionAsignacionFija(id){
  const s = agendaSolicitudes.find(x=>x.id===id);
  if(!s) return;
  const a = s._raw;
  const fechaTxt = new Date(s.fecha+'T00:00:00').toLocaleDateString('es-UY',{day:'numeric',month:'long'});
  const cuerpo = `
    <h2 style="margin:0 0 6px;">¿${escaparHtml(s._previsto ? s._previsto.ninera_nombre : a.ninera_nombre)} no ${s.fecha>todayISO()?'va':'fue'} el ${fechaTxt} a lo de ${escaparHtml(s.familia_nombre)}?</h2>
    <div class="helper" style="margin-bottom:16px;">No se le cobra nada a la familia ni se le paga nada a ${escaparHtml(a.ninera_nombre)} por este día.</div>
    <button class="btn" style="width:100%;margin-bottom:8px;text-align:left;" onclick="conGuardado(this, ()=>registrarExcepcionFija(${argJs(id)}))">No fue nadie ese día</button>
    <button class="btn primary" style="width:100%;text-align:left;" onclick="mostrarReemplazoFijoHoy(${argJs(id)})">Vino otra niñera</button>
    <div id="agenda-fija-reemplazo-box"></div>
  `;
  abrirModal(cuerpo);
}
async function registrarExcepcionFija(id){
  const s = agendaSolicitudes.find(x=>x.id===id);
  if(!s) return;
  const a = s._raw;
  if(s._previsto){
    // Previsto: esa misma fila pasa a la de $0 (cancelado), así el proceso no lo recrea.
    const { error } = await sb.from('sittings_traslados').update({
      cancelado: true, cobro_familia: 0, pago_ninera: 0, cobrado: true, pagado: true,
      generado_automatico: false, notas: `${s._previsto.ninera_nombre} no va — sin reemplazo`,
    }).eq('id', s._previsto.id);
    if(error){ toast('No se pudo guardar: '+error.message, 'bad'); return; }
    cerrarModal();
    await cargarAgendaSolicitudes();
    toast('Listo: ese día no va nadie.');
    return;
  }
  const { error } = await sb.from('sittings_traslados').insert({
    tipo: tipoAsignacion(a),
    asignacion_id: a.id,
    familia_id: a.familia_id || null,
    familia_nombre: s.familia_nombre,
    ninera_id: a.ninera_id || null,
    ninera_nombre: a.ninera_nombre,
    fecha: s.fecha,
    hora_inicio: a.hora_inicio || null,
    hora_fin: a.hora_fin || null,
    cobro_familia: 0,
    pago_ninera: 0,
    cancelado: true,
    cobrado: true,
    pagado: true,
    notas: `${a.ninera_nombre} no fue — sin reemplazo`,
  });
  if(error){ toast('No se pudo registrar: '+error.message, 'bad'); return; }
  cerrarModal();
  await cargarAgendaSolicitudes();
  actualizarAgendaBadge();
  toast('Registrado: no fue nadie ese día.');
}
/* Reemplazo puntual: otra niñera cubrió el horario fijo ese día. Se registra
   directo su sitting con el cálculo automático de cobro/pago — sin saltar a
   Sittings & traslados a completarlo a mano. */
function mostrarReemplazoFijoHoy(id){
  const s = agendaSolicitudes.find(x=>x.id===id);
  if(!s) return;
  const a = s._raw;
  agendaReemplazoNineraSel = null;
  const box = document.getElementById('agenda-fija-reemplazo-box');
  if(!box) return;
  box.innerHTML = `
    <div style="height:1px;background:var(--line);margin:14px 0;"></div>
    <div class="field" style="position:relative;margin-bottom:8px;"><label>¿Quién vino en su lugar?</label>
      <input type="text" id="agenda-fija-reemplazo-ninera" autocomplete="off" oninput="agendaReemplazoNineraSel=null;">
      <div id="agenda-fija-reemplazo-ninera-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
    </div>
    <div class="grid2" style="margin-bottom:8px;">
      <div class="field"><label>Hora inicio</label>${selectHora('agenda-fija-rhi')}</div>
      <div class="field"><label>Hora fin</label>${selectHora('agenda-fija-rhf')}</div>
    </div>
    <label class="chk" style="margin:-4px 0 10px;"><input type="checkbox" id="agenda-fija-rcruza" onchange="pintarFinCobroAgenda()"> Termina al día siguiente</label>
    ${tipoAsignacion(a)==='traslado' ? '' : `<div class="helper" id="agenda-fija-rfin-cobro" data-familia="${escaparHtml(a.familia_id)}" data-fecha="${escaparHtml(s.fecha)}" style="margin:-4px 0 8px;"></div>`}
    ${tipoAsignacion(a)==='traslado' ? `<div class="grid2" style="margin-bottom:8px;">
      <div class="field"><label>Cobro del traslado</label><div class="moneyfield"><input type="number" id="agenda-fija-rcobro"></div></div>
      <div class="field"><label>Pago a la niñera</label><div class="moneyfield"><input type="number" id="agenda-fija-rpago"></div></div>
    </div>` : ''}
    <div id="agenda-fija-reemplazo-warn"></div>
    <button class="btn primary" style="width:100%;" onclick="conGuardado(this, ()=>confirmarReemplazoFijoHoy(${argJs(id)}))">Registrar reemplazo</button>`;
  setHoraSelect('agenda-fija-rhi', a.hora_inicio||'');
  setHoraSelect('agenda-fija-rhf', a.hora_fin||'');
  pintarFinCobroAgenda();
  attachAutocomplete('agenda-fija-reemplazo-ninera', 'agenda-fija-reemplazo-ninera-dropdown', ()=>agendaNinierasBase, (o)=>{ agendaReemplazoNineraSel = o; });
}
async function confirmarReemplazoFijoHoy(id){
  const s = agendaSolicitudes.find(x=>x.id===id);
  if(!s) return;
  const a = s._raw;
  const warn = document.getElementById('agenda-fija-reemplazo-warn');
  const nineraTxt = document.getElementById('agenda-fija-reemplazo-ninera')?.value.trim();
  if(!nineraTxt){ if(warn) warn.innerHTML = '<div class="warnbox">Elegí quién vino en su lugar.</div>'; return; }
  const horaIni = leerHora('agenda-fija-rhi');
  const horaFin = leerHora('agenda-fija-rhf');
  const cruza = document.getElementById('agenda-fija-rcruza')?.checked || false;
  if(!horaIni || !horaFin){ if(warn) warn.innerHTML = '<div class="warnbox">Completá las dos horas.</div>'; return; }
  if(cruceMedianocheMalMarcado(horaIni, horaFin, cruza)){ if(warn) warn.innerHTML = `<div class="warnbox">${escaparHtml(AVISO_CRUCE_MEDIANOCHE)}</div>`; return; }
  const mi = agendaMinutos(horaIni);
  let mf = agendaMinutos(horaFin);
  if(cruza) mf += 24*60;
  if(mf<=mi){ if(warn) warn.innerHTML = '<div class="warnbox">La hora de fin tiene que ser después de la de inicio (o marcá "Termina al día siguiente").</div>'; return; }
  const familia = agendaFamilias.find(f=>f.id===a.familia_id);
  const horas = horasSitting(horaIni, horaFin, cruza, familia, s.fecha);
  const cobroHora = familia ? Number(familia.cobro_hora)||0 : 0;
  // Elegida de la lista o escrita entera (sin tildes ni mayúsculas), como findNinera en Sittings: si no, se
  // guardaba sin ninera_id y con la tarifa aunque tuviera su precio (revisión final, 31/10/2026).
  const nineraSel = (agendaReemplazoNineraSel && normaliza(agendaReemplazoNineraSel.nombre)===normaliza(nineraTxt) ? agendaReemplazoNineraSel : null)
    || agendaNinierasBase.find(n=>normaliza(n.nombre)===normaliza(nineraTxt)) || null;
  const nombreRe = nineraSel?.nombre || nineraTxt;
  // La reemplazante cobra su propio precio con esta familia, o la tarifa: nunca el precio del fijo,
  // que es de la titular (respuesta 2 de Diego, 31/10/2026).
  const preciosRe = tipoAsignacion(a)==='traslado' || !nineraSel ? [] : await leerPreciosNinera(a.familia_id, nineraSel.id);
  if(preciosNoLeidos(preciosRe)){ if(warn) warn.innerHTML = `<div class="warnbox">${escaparHtml(AVISO_PRECIOS_NO_LEIDOS)}</div>`; return; }
  const pagoHora = Number(precioHoraNinera(familia, nineraSel?.id || null, preciosRe, pagoFijoDeNinera(a, nineraSel?.id || null, nombreRe)))||0;
  let cobro = redondearCobro(horas.cobro*cobroHora), pago = redondearPago(horas.real*pagoHora);
  if(tipoAsignacion(a)==='traslado'){
    const cobroTxt = document.getElementById('agenda-fija-rcobro')?.value ?? '';
    const pagoTxt = document.getElementById('agenda-fija-rpago')?.value ?? '';
    if(cobroTxt==='' || pagoTxt===''){ if(warn) warn.innerHTML = '<div class="warnbox">Completá el cobro del traslado y el pago a la niñera.</div>'; return; }
    cobro = redondearCobro(cobroTxt); pago = redondearPago(pagoTxt);
  }
  const choque = chequearDobleReservaAgenda(nombreRe, s.fecha, horaIni, horaFin, s.id);
  if(!(await avisarSiDobleReserva(choque, nombreRe, 'Registrar igual'))) return;
  if(familia){
    const choqueFamilia = await chequearFamiliaYaCubierta(familia.id, s.fecha, horaIni, horaFin, nombreRe, s._previsto?.id || null);
    if(!(await avisarSiFamiliaYaCubierta(choqueFamilia, s.familia_nombre, 'Sí, van dos'))) return;
  }
  if(s._previsto){
    // Previsto: cambia la niñera de esa fila, solo ese día.
    const { error } = await sb.from('sittings_traslados').update({
      ninera_id: nineraSel?.id || null, ninera_nombre: nombreRe,
      hora_inicio: horaIni, hora_fin: horaFin, termina_dia_siguiente: cruza,
      cobro_familia: cobro, pago_ninera: pago, generado_automatico: false,
      notas: `Reemplazo de ${s._previsto.ninera_nombre}`,
    }).eq('id', s._previsto.id);
    if(error){ if(warn) warn.innerHTML = errBox(error); return; }
    cerrarModal();
    await cargarAgendaSolicitudes();
    toast(`Listo: ese día va ${nombreRe}.`);
    return;
  }
  const { error } = await sb.from('sittings_traslados').insert({
    tipo: tipoAsignacion(a),
    registrado_por: registradoPorUsuario(),
    asignacion_id: a.id,
    familia_id: a.familia_id || null,
    familia_nombre: s.familia_nombre,
    ninera_id: nineraSel?.id || null,
    ninera_nombre: nombreRe,
    fecha: s.fecha,
    hora_inicio: horaIni,
    hora_fin: horaFin,
    termina_dia_siguiente: cruza,
    cobro_familia: cobro,
    pago_ninera: pago,
    cobrado: false, pagado: false,
    notas: `Reemplazo de ${a.ninera_nombre}`,
  });
  if(error){ if(warn) warn.innerHTML = errBox(error); return; }
  cerrarModal();
  await cargarAgendaSolicitudes();
  actualizarAgendaBadge();
  toast('Reemplazo registrado.');
}
/* Cambiar la niñera de un fijo DESDE una fecha (05/10/2026, E2). Antes se pisaba el nombre
   en la misma asignación y el fijo, que no tenía fechas, pasaba a dibujarse como de la niñera
   nueva también en las semanas anteriores. Ahora la asignación vieja se cierra el día antes
   y se abre una nueva (mismos días, horario y tipo) desde esa fecha. Si la fecha es el
   primer día del fijo (o antes), no hay pasado que cuidar y se cambia la niñera ahí mismo. */
async function cambiarNineraAsignacionFija(asigId){
  const nueva = document.getElementById('agenda-fija-ninera-'+asigId).value.trim();
  const desde = document.getElementById('agenda-fija-desde-'+asigId)?.value || todayISO();
  const warn = document.getElementById('agenda-fija-warn');
  const item = agendaSolicitudes.find(s=>s._asigId===asigId);
  const a = item?._raw;
  if(!a) return;
  if(!nueva){ warn.innerHTML = '<div class="warnbox">Elegí la niñera nueva.</div>'; return; }
  if(normaliza(nueva)===normaliza(a.ninera_nombre||'')){ warn.innerHTML = '<div class="warnbox">Esa ya es la niñera de este fijo.</div>'; return; }
  if(a.vigente_hasta && desde > a.vigente_hasta){ warn.innerHTML = `<div class="warnbox">Este fijo termina el ${a.vigente_hasta}: elegí una fecha anterior.</div>`; return; }
  if(!agendaNinierasBase.some(n=>normaliza(n.nombre)===normaliza(nueva)) && !(await confirmarNombreNuevo(nueva, agendaNinierasBase, 'niñera'))) return;
  if(a.hora_inicio && Array.isArray(a.dias)){
    const choque = await chequearFijoNuevoContraTodo(nueva, a.dias, a.hora_inicio, a.hora_fin, asigId);
    if(!(await avisarSiDobleReserva(choque, nueva, 'Asignar igual'))) return;
  }
  const ninera = agendaNinierasBase.find(n=>normaliza(n.nombre)===normaliza(nueva));
  // Si la asignación ni siquiera trae la columna, la base todavía no tiene la migración:
  // se cambia en el mismo lugar, como antes.
  const baseSinVigencia = asignacionesSinVigencia || !('vigente_desde' in a);
  const enElMismoLugar = baseSinVigencia || !a.vigente_desde || desde <= a.vigente_desde;
  if(enElMismoLugar && !a.vigente_desde && !baseSinVigencia){
    // Fijo viejo sin fecha de inicio: no se sabe desde cuándo corre, así que no se puede
    // cuidar el pasado partiéndolo. Se pide primero cargarle la vigencia.
    warn.innerHTML = '<div class="warnbox">Este fijo no tiene fecha de inicio cargada. Tocá "Editar vigencia y tipo", cargá desde cuándo corre y después cambiá la niñera.</div>';
    return;
  }
  let aHoy = null; // el fijo que rige hoy después del cambio (para el sitting de hoy)
  // El precio propio del fijo (pago_hora) es de la niñera anterior: con otra niñera no se copia, y
  // ella cobra el suyo con esta familia o la tarifa (01/11/2026).
  if(enElMismoLugar){
    const cambio = {ninera_nombre: nueva, ninera_id: ninera?.id || null, ...(a.pago_hora!=null ? {pago_hora: null} : {})};
    const { error } = await sb.from('asignaciones').update(cambio).eq('id', asigId);
    if(error){ warn.innerHTML = errBox(error); return; }
    aHoy = {...a, ...cambio};
  } else {
    const nuevaAsig = {
      familia_id: a.familia_id, ninera_nombre: nueva, ninera_id: ninera?.id || null,
      dias: a.dias, hora_inicio: a.hora_inicio, hora_fin: a.hora_fin,
      cobro_hora: a.cobro_hora ?? null, pago_hora: null,
      tipo: tipoAsignacion(a), vigente_desde: desde, vigente_hasta: a.vigente_hasta || null,
      ...precioTrasladoDelFijo(a),
    };
    const { data: creada, error: e1 } = await escribirAsignacion(p=>sb.from('asignaciones').insert(p).select().single(), nuevaAsig);
    if(e1){ warn.innerHTML = errBox(e1); return; }
    const { error: e2 } = await escribirAsignacion(p=>sb.from('asignaciones').update(p).eq('id', asigId), {vigente_hasta: sumarDiasISO(desde, -1)});
    if(e2){
      // Sin cerrar la vieja quedarían dos fijos superpuestos: se deshace la nueva.
      const { error: e3 } = await sb.from('asignaciones').delete().eq('id', creada.id);
      warn.innerHTML = e3
        ? `<div class="warnbox">No se pudo cerrar el fijo anterior y tampoco deshacer el nuevo: quedaron los dos. Abrí "Editar vigencia y tipo" en el de ${escaparHtml(a.ninera_nombre)} y poné "hasta" el día antes del cambio. (${escaparHtml(e2.message)})</div>`
        : errBox(e2);
      return;
    }
    aHoy = creada;
    await moverVariantesAlFijoNuevo(asigId, creada.id); // sus variantes de precio lo siguen (23/10/2026)
  }
  cerrarModal();
  await sincronizarPrevistosFijos();
  if(desde <= todayISO()) await alinearRegistroDeHoy(asigId, aHoy, 'El fijo no corre hoy');
  await cargarAgendaSolicitudes();
  const fechaTxt = new Date(desde+'T12:00:00').toLocaleDateString('es-UY',{day:'numeric',month:'long'});
  toast(`Desde el ${fechaTxt} el fijo lo hace ${nueva}. Lo anterior sigue como estaba.`);
  await revisarPrevistosEditadosFueraDelFijo([asigId]);
}
/* Vigencia (desde / hasta) y tipo de una asignación, editables desde la app para
   corregirlos sin SQL. Se abre desde el fijo en la Agenda y desde la ficha de la familia. */
async function abrirModalVigenciaAsignacion(asigId){
  const { data: a, error } = await sb.from('asignaciones').select('*, familias(nombre)').eq('id', asigId).single();
  if(error || !a){ toast('No se pudo abrir la asignación: '+(error?.message||'no existe'), 'bad'); return; }
  const diasTxt = (a.dias||[]).map(d=>DIAS_CORTO[d]||d).join(' ');
  // Precio fijo por traslado (06/10/2026): solo si la base ya tiene las columnas.
  const conPrecio = 'cobro_traslado' in a;
  abrirModal(`
    <h2 style="margin:0 0 4px;">Vigencia y tipo del fijo</h2>
    <div class="helper" style="margin-bottom:14px;">${escaparHtml(a.familias?.nombre||'(familia)')} · ${escaparHtml(a.ninera_nombre)} · ${diasTxt||'sin días'}</div>
    <div class="grid3">
      <div class="field"><label>Vigente desde</label><input type="date" id="vig-desde" value="${escaparHtml(a.vigente_desde)}"></div>
      <div class="field"><label>Vigente hasta</label><input type="date" id="vig-hasta" value="${escaparHtml(a.vigente_hasta)}"></div>
      <div class="field"><label>Tipo</label><select id="vig-tipo" onchange="const b=document.getElementById('vig-precio-box'); if(b) b.style.display=this.value==='traslado'?'':'none';"><option value="sitting">Sitting</option><option value="traslado">Traslado</option></select></div>
    </div>
    <div class="helper">"Hasta" vacío = sigue vigente. La Agenda solo muestra el fijo entre esas fechas; lo que ya está registrado no se toca.</div>
    ${'inicio_real' in a ? `<div class="field" style="margin-top:10px;"><label>Empezó el (si arrancó antes de la app)</label><input type="date" id="vig-inicio-real" value="${escaparHtml(a.inicio_real)}"></div>
    <div class="helper">Solo se muestra en la ficha. La Agenda no dibuja nada antes de "Vigente desde".</div>` : ''}
    ${conPrecio ? `<div id="vig-precio-box" style="margin-top:12px;">
      <div class="grid2">
        <div class="field"><label>Cobro por traslado</label><div class="moneyfield"><input type="number" id="vig-cobro-traslado" value="${escaparHtml(a.cobro_traslado??'')}"></div></div>
        <div class="field"><label>Pago a la niñera por traslado</label><div class="moneyfield"><input type="number" id="vig-pago-traslado" value="${escaparHtml(a.pago_traslado??'')}"></div></div>
      </div>
      <div class="helper">Lo que se cobra y se paga cada traslado de este fijo (sin gastos extra: esos van aparte, con su ticket).</div>
    </div>` : ''}
    <div id="vig-warn"></div>
    <div class="confirmbtns">
      <button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primary" onclick="conGuardado(this, ()=>guardarVigenciaAsignacion(${argJs(a.id)}))">Guardar</button>
    </div>`);
  document.getElementById('vig-tipo').value = tipoAsignacion(a);
  const precioBox = document.getElementById('vig-precio-box');
  if(precioBox) precioBox.style.display = tipoAsignacion(a)==='traslado' ? '' : 'none';
}
async function guardarVigenciaAsignacion(asigId){
  const desde = document.getElementById('vig-desde').value || null;
  const hasta = document.getElementById('vig-hasta').value || null;
  const tipo = document.getElementById('vig-tipo').value;
  const warn = document.getElementById('vig-warn');
  if(!desde){ warn.innerHTML = '<div class="warnbox">Cargá desde cuándo corre el fijo.</div>'; return; }
  if(hasta && hasta < desde){ warn.innerHTML = '<div class="warnbox">"Hasta" no puede ser antes que "desde".</div>'; return; }
  if(asignacionesSinVigencia){ warn.innerHTML = '<div class="warnbox">La base todavía no tiene vigencia de los fijos (falta la migración). Avisale a Diego.</div>'; return; }
  const cambios = {vigente_desde: desde, vigente_hasta: hasta, tipo};
  const inicioRealEl = document.getElementById('vig-inicio-real');
  if(inicioRealEl) cambios.inicio_real = inicioRealEl.value || null;
  const cobroEl = document.getElementById('vig-cobro-traslado'), pagoEl = document.getElementById('vig-pago-traslado');
  if(cobroEl && pagoEl && tipo==='traslado'){
    const cobroTxt = cobroEl.value.trim(), pagoTxt = pagoEl.value.trim();
    // Sin precio ya no se puede (13/10/2026): el "último traslado" puede traer la comida sumada.
    if(!(Number(cobroTxt)>0) || !(Number(pagoTxt)>0)){ warn.innerHTML = '<div class="warnbox">Un traslado fijo necesita lo que se cobra y lo que se paga a la niñera por cada traslado.</div>'; return; }
    cambios.cobro_traslado = Number(cobroTxt);
    cambios.pago_traslado = Number(pagoTxt);
  }
  const { data: actualizada, error } = await escribirAsignacion(p=>sb.from('asignaciones').update(p).eq('id', asigId).select().maybeSingle(), cambios);
  if(error){ warn.innerHTML = errBox(error); return; }
  if(asignacionesSinVigencia){ warn.innerHTML = '<div class="warnbox">La base todavía no tiene vigencia de los fijos (falta la migración). Avisale a Diego.</div>'; return; }
  cerrarModal();
  await sincronizarPrevistosFijos();
  // Precio nuevo del traslado: también para el de hoy (06/10/2026). Un cambio de vigencia no
  // cancela el de hoy desde acá (eso es "Terminar" o "Pausar").
  if('cobro_traslado' in cambios && actualizada) await alinearRegistroDeHoy(asigId, actualizada, null, {noCancelar:true});
  toast('Vigencia del fijo guardada.');
  if(document.getElementById('agenda-grid-wrap')) await cargarAgendaSolicitudes();
  if(document.getElementById('familiaslist') && typeof cargarFamilias==='function') await cargarFamilias();
  await revisarPrevistosEditadosFueraDelFijo([asigId]);
}
/* Terminar un fijo desde una fecha (05/10/2026, paso 5). Antes "Quitar" BORRABA la
   asignación: desaparecía de todas las semanas, también de las pasadas, y los sittings ya
   registrados quedaban apuntando a un fijo que no existía (desde la ficha de la familia,
   además, sin pedir confirmación). Ahora se completa vigente_hasta con el día anterior a la
   fecha elegida: desde ese día no aparece más en la Agenda ni en Hoy, y lo anterior queda
   como estaba, con sus registros vinculados. Se abre desde la Agenda y desde la ficha. */
async function abrirModalTerminarFijo(asigId){
  const { data: a, error } = await sb.from('asignaciones').select('*, familias(nombre)').eq('id', asigId).single();
  if(error || !a){ toast('No se pudo abrir el fijo: '+(error?.message||'no existe'), 'bad'); return; }
  const hoy = todayISO();
  const minimo = a.vigente_desde ? sumarDiasISO(a.vigente_desde, 1) : null;
  const sugerida = minimo && minimo > hoy ? minimo : hoy;
  const diasTxt = (a.dias||[]).map(d=>DIAS_CORTO[d]||d).join(' ');
  // Fijo creado por error (05/10/2026): si todavía no pasó ningún día y no tiene nada
  // registrado, se puede borrar del todo. Si ya pasó algún día, solo se termina.
  const { data: vinculados } = await sb.from('sittings_traslados').select('*').eq('asignacion_id', asigId);
  const borrable = fijoSePuedeBorrar(a, vinculados, hoy);
  abrirModal(`
    <h2 style="margin:0 0 4px;">Terminar el fijo</h2>
    <div class="helper" style="margin-bottom:14px;">${escaparHtml(a.familias?.nombre||'(familia)')} · ${escaparHtml(a.ninera_nombre)} · ${diasTxt||'sin días'} · vigente ${textoVigencia(a)}</div>
    <div class="field"><label>Deja de correr desde</label><input type="date" id="terminar-desde" value="${sugerida}"${minimo?` min="${minimo}"`:''}></div>
    <div class="helper">Desde ese día el fijo ya no aparece en la Agenda ni en Hoy. Lo anterior, y los sittings que ya están registrados, quedan como están.</div>
    <div id="terminar-warn"></div>
    <div class="confirmbtns">
      <button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
      <button class="btn danger" onclick="conGuardado(this, ()=>terminarFijoDesde(${argJs(a.id)}))">Terminar el fijo</button>
    </div>
    ${borrable ? `<div style="height:1px;background:var(--line);margin:14px 0;"></div>
    <div class="helper" style="margin-bottom:8px;">¿Se creó por error? Todavía no pasó ningún día de este fijo, así que se puede borrar del todo${(vinculados||[]).length ? `, con sus ${(vinculados||[]).length} día${(vinculados||[]).length===1?'':'s'} previsto${(vinculados||[]).length===1?'':'s'}` : ''}.</div>
    <button class="btn danger" id="borrar-fijo-btn" style="width:100%;" onclick="conGuardado(this, ()=>borrarFijoCreadoPorError(${argJs(a.id)}))">Borrar el fijo (se creó por error)</button>` : ''}`);
}
/* Primer día en que corre el fijo (desde vigente_desde, el primer día de la semana que
   tiene). null si no tiene días o no se sabe desde cuándo corre. */
function primerDiaDelFijo(a){
  if(!a || !a.vigente_desde || !Array.isArray(a.dias) || !a.dias.length) return null;
  for(let i=0; i<7; i++){
    const f = sumarDiasISO(a.vigente_desde, i);
    if(a.dias.includes(diaSemanaDeISO(f))) return f;
  }
  return null;
}
// Se puede borrar del todo solo si ningún día del fijo es anterior a hoy y lo único
// vinculado son días previstos (nada registrado, ni un "no fue").
function fijoSePuedeBorrar(a, vinculados, hoyISO){
  if(!a || !('vigente_desde' in a) || !a.vigente_desde) return false;
  const primero = primerDiaDelFijo(a);
  if(primero && primero < hoyISO) return false;
  return (vinculados||[]).every(r => r.estado==='previsto' && r.fecha >= hoyISO);
}
async function borrarFijoCreadoPorError(asigId){
  const warn = document.getElementById('terminar-warn');
  const hoy = todayISO();
  // Se vuelve a mirar en la base: entre que se abrió el modal y ahora pudo cargarse algo.
  const [{ data: a, error: e0 }, { data: vinculados, error: e1 }] = await Promise.all([
    sb.from('asignaciones').select('*, familias(nombre)').eq('id', asigId).single(),
    sb.from('sittings_traslados').select('*').eq('asignacion_id', asigId),
  ]);
  if(e0 || e1 || !a){ warn.innerHTML = errBox(e0 || e1 || 'El fijo ya no existe.'); return; }
  if(!fijoSePuedeBorrar(a, vinculados, hoy)){
    warn.innerHTML = '<div class="warnbox">Este fijo ya tiene días que pasaron o algo registrado: no se puede borrar. Usá "Terminar el fijo".</div>';
    return;
  }
  const previstos = (vinculados||[]).map(r=>r.id);
  const ok = await confirmarAccion(`¿Borrar del todo el fijo de ${a.familias?.nombre||'la familia'} con ${a.ninera_nombre}${previstos.length ? ` y sus ${previstos.length} día${previstos.length===1?'':'s'} previsto${previstos.length===1?'':'s'}` : ''}? No se puede deshacer.`, 'Borrar el fijo');
  if(!ok) return;
  if(previstos.length){
    const { error: e2 } = await sb.from('sittings_traslados').delete().in('id', previstos);
    if(e2){ warn.innerHTML = errBox(e2); return; }
  }
  const { error: e3 } = await sb.from('asignaciones').delete().eq('id', asigId);
  if(e3){
    // Los previstos se vuelven a cargar solos con el fijo, que sigue estando.
    await sincronizarPrevistosFijos();
    warn.innerHTML = errBox(e3);
    return;
  }
  cerrarModal();
  toast('Fijo borrado.');
  if(document.getElementById('agenda-grid-wrap')) await cargarAgendaSolicitudes();
  if(document.getElementById('familiaslist') && typeof cargarFamilias==='function') await cargarFamilias();
}
async function terminarFijoDesde(asigId){
  const warn = document.getElementById('terminar-warn');
  const desde = document.getElementById('terminar-desde')?.value;
  if(!desde){ warn.innerHTML = '<div class="warnbox">Elegí desde qué día deja de correr.</div>'; return; }
  const { data: a, error: e0 } = await sb.from('asignaciones').select('*').eq('id', asigId).single();
  if(e0 || !a){ warn.innerHTML = errBox(e0 || 'El fijo ya no existe.'); return; }
  if(asignacionesSinVigencia || !('vigente_desde' in a)){
    warn.innerHTML = '<div class="warnbox">La base todavía no tiene vigencia de los fijos (falta la migración). Avisale a Diego.</div>';
    return;
  }
  const fmt = iso => new Date(iso+'T12:00:00').toLocaleDateString('es-UY',{day:'numeric',month:'long'});
  if(a.vigente_desde && desde <= a.vigente_desde){
    warn.innerHTML = `<div class="warnbox">Este fijo empezó el ${fmt(a.vigente_desde)}: elegí un día posterior. Si la fecha de inicio estaba mal, corregila con "Editar vigencia y tipo".</div>`;
    return;
  }
  const hasta = sumarDiasISO(desde, -1);
  if(a.vigente_hasta && a.vigente_hasta <= hasta){
    warn.innerHTML = `<div class="warnbox">Este fijo ya termina el ${fmt(a.vigente_hasta)}.</div>`;
    return;
  }
  const { error } = await sb.from('asignaciones').update({vigente_hasta: hasta}).eq('id', asigId);
  if(error){ warn.innerHTML = errBox(error); return; }
  cerrarModal();
  await sincronizarPrevistosFijos();
  // Terminar desde hoy (o antes): el de hoy ya se confirmó solo a las 03:00; se cancela ($0)
  // si nadie lo tocó, igual que con una pausa (06/10/2026, decisión de Diego).
  if(desde <= todayISO()) await alinearRegistroDeHoy(asigId, {...a, vigente_hasta: hasta}, 'Fijo terminado');
  toast(`Listo: el fijo corre hasta el ${fmt(hasta)}. Desde el ${fmt(desde)} ya no aparece en la Agenda.`);
  if(document.getElementById('agenda-grid-wrap')) await cargarAgendaSolicitudes();
  if(document.getElementById('familiaslist') && typeof cargarFamilias==='function') await cargarFamilias();
  await revisarPrevistosEditadosFueraDelFijo([asigId]);
}
/* Pausar un fijo (vacaciones, 06/10/2026): en ese rango no se cargan previstos y la Agenda
   no lo dibuja, sin terminarlo. Solo con los fijos automáticos activados. */
async function abrirModalPausarFijo(asigId){
  const { data: a, error } = await sb.from('asignaciones').select('*, familias(nombre)').eq('id', asigId).single();
  if(error || !a){ toast('No se pudo abrir el fijo: '+(error?.message||'no existe'), 'bad'); return; }
  const hoy = todayISO();
  abrirModal(`
    <h2 style="margin:0 0 4px;">Pausar el fijo</h2>
    <div class="helper" style="margin-bottom:14px;">${escaparHtml(a.familias?.nombre||'(familia)')} · ${escaparHtml(a.ninera_nombre)}</div>
    <div class="grid2">
      <div class="field"><label>Desde</label><input type="date" id="pausa-desde" value="${hoy}"></div>
      <div class="field"><label>Hasta (inclusive)</label><input type="date" id="pausa-hasta"></div>
    </div>
    <div class="field"><label>Motivo (opcional)</label><input type="text" id="pausa-motivo" placeholder="Vacaciones"></div>
    <div class="helper">En esos días no se carga nada y el fijo no aparece en la Agenda. Después sigue solo, con la misma niñera y horario. Lo que ya está registrado no se toca.</div>
    <div id="pausa-warn"></div>
    <div class="confirmbtns">
      <button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primary" onclick="conGuardado(this, ()=>guardarPausaFijo(${argJs(a.id)}))">Pausar</button>
    </div>`);
}
async function guardarPausaFijo(asigId){
  const warn = document.getElementById('pausa-warn');
  const desde = document.getElementById('pausa-desde')?.value;
  const hasta = document.getElementById('pausa-hasta')?.value;
  const motivo = document.getElementById('pausa-motivo')?.value.trim() || null;
  if(!desde || !hasta){ warn.innerHTML = '<div class="warnbox">Elegí las dos fechas.</div>'; return; }
  if(hasta < desde){ warn.innerHTML = '<div class="warnbox">"Hasta" no puede ser antes que "desde".</div>'; return; }
  if(hasta < todayISO()){ warn.innerHTML = '<div class="warnbox">Esas fechas ya pasaron: lo que no fue se marca día por día con "Este día no fue".</div>'; return; }
  const { error } = await sb.from('asignaciones_pausas').insert({ asignacion_id: asigId, desde, hasta, motivo, creado_por: registradoPorUsuario() });
  if(error){ warn.innerHTML = errBox(error); return; }
  cerrarModal();
  await sincronizarPrevistosFijos();
  const hoyP = todayISO();
  if(desde <= hoyP && hasta >= hoyP) await alinearRegistroDeHoy(asigId, null, 'Fijo en pausa'+(motivo ? ': '+motivo : ''));
  const fmt = iso => new Date(iso+'T12:00:00').toLocaleDateString('es-UY',{day:'numeric',month:'long'});
  toast(`Fijo pausado del ${fmt(desde)} al ${fmt(hasta)}.`);
  if(document.getElementById('agenda-grid-wrap')) await cargarAgendaSolicitudes();
  if(document.getElementById('familiaslist') && typeof cargarFamilias==='function') await cargarFamilias();
  await revisarPrevistosEditadosFueraDelFijo([asigId]);
}
async function quitarPausaFijo(pausaId){
  if(!(await confirmarAccion('¿Quitar la pausa? Esos días vuelven a cargarse como siempre.', 'Quitar la pausa'))) return;
  const { error } = await sb.from('asignaciones_pausas').delete().eq('id', pausaId);
  if(error){ toast('No se pudo quitar la pausa: '+error.message, 'bad'); return; }
  cerrarModal();
  await sincronizarPrevistosFijos();
  toast('Pausa quitada.');
  if(document.getElementById('agenda-grid-wrap')) await cargarAgendaSolicitudes();
  if(document.getElementById('familiaslist') && typeof cargarFamilias==='function') await cargarFamilias();
}
/* Cambios del fijo "desde hoy" (06/10/2026, decisión de Diego). El sitting de hoy ya se
   confirmó solo a las 03:00 y el proceso de la noche no vuelve a tocar el día de hoy: si la
   niñera, el horario o el precio del fijo cambiaban desde hoy, el de hoy quedaba con lo de
   antes (y se le pagaba a la niñera anterior). Acá se corrige el de hoy para que siga al
   fijo: se actualiza, o se cancela ($0, como "no fue") si con el cambio el fijo ya no corre
   hoy (una pausa, otros días). Solo si lo cargó el proceso y nadie lo tocó
   (generado_automatico, sin cobrar ni pagar): si alguien lo editó, se avisa y no se pisa.
   asigId: fijo al que está vinculado hoy el registro. aHoy: el fijo que rige hoy después del
   cambio (el mismo, ya cambiado, o el nuevo), o null si hoy ya no corre. */
function horaCorta(h){ return h ? String(h).slice(0,5) : null; }
async function filaDeHoySegunFijo(aHoy, r){
  const tipo = tipoAsignacion(aHoy);
  const hi = horaCorta(aHoy.hora_inicio), hf = horaCorta(aHoy.hora_fin);
  const cruza = !!(hi && hf && hf <= hi);
  const fila = { asignacion_id: aHoy.id, ninera_id: aHoy.ninera_id || null, ninera_nombre: aHoy.ninera_nombre,
    tipo, hora_inicio: hi, hora_fin: hf, termina_dia_siguiente: cruza };
  if(tipo==='traslado'){
    // Un traslado no se cobra por hora: el precio del fijo; si no tiene, el que ya traía.
    fila.cobro_familia = aHoy.cobro_traslado ?? r.cobro_familia;
    fila.pago_ninera = aHoy.pago_traslado ?? r.pago_ninera;
  } else {
    // Igual que generar_previstos_fijos: horas del fijo por la tarifa de la familia (el
    // cobro, con el fin redondeado si aceptó los términos) y el pago por hora de un día de fijo
    // (01/11/2026): el del fijo, si no el de su niñera con esta familia, si no la tarifa.
    const [{ data: fam, error }, precios] = await Promise.all([
      leerFamiliasConTerminos('cobro_hora,pago_hora', q=>q.eq('id', aHoy.familia_id).maybeSingle()),
      aHoy.ninera_id ? leerPreciosNinera(aHoy.familia_id, aHoy.ninera_id) : [],
    ]);
    if(error) throw error;
    if(preciosNoLeidos(precios)) throw new Error(AVISO_PRECIOS_NO_LEIDOS); // no se pisa el pago del de hoy con la tarifa
    const horas = horasSitting(hi, hf, cruza, fam, todayISO()) || { real: 0, cobro: 0 };
    const pagoHora = precioHoraNinera(fam && { ...fam, id: aHoy.familia_id }, aHoy.ninera_id || null, precios, aHoy.pago_hora);
    fila.cobro_familia = redondearCobro(horas.cobro * (Number(fam?.cobro_hora) || 0));
    fila.pago_ninera = redondearPago(horas.real * (Number(pagoHora) || 0));
  }
  return fila;
}
function filaDeHoyCambia(r, fila){
  return Object.keys(fila).some(k=>{
    if(k==='hora_inicio' || k==='hora_fin') return horaCorta(r[k]) !== fila[k];
    if(k==='cobro_familia' || k==='pago_ninera') return Number(r[k]||0) !== Number(fila[k]||0);
    if(k==='termina_dia_siguiente') return !!r[k] !== !!fila[k];
    return (r[k] ?? null) !== (fila[k] ?? null);
  });
}
async function alinearRegistroDeHoy(asigId, aHoy, motivoCancelado, {noCancelar=false, queSeGuardo='el cambio del fijo'}={}){
  await esperarConfigFijos();
  if(!fijosAutomaticosActivos || !asigId) return;
  const hoy = todayISO();
  try{
    const { data: filas, error } = await sb.from('sittings_traslados').select('*').eq('asignacion_id', asigId).eq('fecha', hoy);
    if(error) throw error;
    for(const r of (filas||[])){
      const corre = !!aHoy && Array.isArray(aHoy.dias) && aHoy.dias.includes(diaSemanaDeISO(hoy)) && asignacionVigenteEn(aHoy, hoy);
      const tocado = !r.generado_automatico || r.cobrado || r.pagado;
      let cambios;
      if(!corre){
        if(r.cancelado || noCancelar) continue; // ya estaba como que no va, o el cambio es solo de precio
        cambios = { cancelado: true, cobro_familia: 0, pago_ninera: 0, cobrado: true, pagado: true,
          generado_automatico: false, notas: motivoCancelado || 'El fijo no corre hoy' };
      } else {
        if(r.cancelado) continue; // "no fue": lo decidió alguien, no se revive
        const fila = await filaDeHoySegunFijo(aHoy, r);
        if(!filaDeHoyCambia(r, fila)) continue;
        cambios = fila;
      }
      if(tocado){
        toast(`El sitting de hoy (${r.familia_nombre}, ${r.ninera_nombre}) lo había cambiado alguien a mano o ya está cobrado o pagado: no se tocó. Si también cambia hoy, corregilo en Sittings & traslados.`, 'bad');
        continue;
      }
      // Solo si sigue sin tocar (por si alguien lo editó en este mismo momento).
      const { data: hechas, error: e2 } = await sb.from('sittings_traslados').update(cambios)
        .eq('id', r.id).eq('generado_automatico', true).eq('cobrado', false).eq('pagado', false).select('id');
      if(e2) throw e2;
      if(!(hechas||[]).length) toast(`El sitting de hoy (${r.familia_nombre}) lo acaba de cambiar alguien: no se tocó. Revisalo en Sittings & traslados.`, 'bad');
    }
  }catch(err){
    toast('Se guardó '+queSeGuardo+', pero no se pudo corregir el sitting de hoy ('+(err?.message||err)+'). Revisalo en Sittings & traslados.', 'bad');
  }
}
/* Días previstos que alguien cambió a mano (un horario distinto, un reemplazo, un "no va")
   y que, después de cambiar el fijo, ya no le corresponden: el fijo terminó, cambió de
   niñera u horario desde una fecha, o quedó en pausa. El proceso no los toca (son
   decisiones de alguien): se muestran para decidir si se borran o se dejan. */
async function revisarPrevistosEditadosFueraDelFijo(asigIds){
  if(!fijosAutomaticosActivos || !asigIds || !asigIds.length) return;
  const hoy = todayISO();
  const [{data:filas}, {data:asigs}, pausas] = await Promise.all([
    sb.from('sittings_traslados').select('*').in('asignacion_id', asigIds).eq('estado', 'previsto').eq('generado_automatico', false).gt('fecha', hoy).order('fecha'),
    sb.from('asignaciones').select('*').in('id', asigIds),
    cargarPausasFijos(),
  ]);
  const fuera = (filas||[]).filter(r=>{
    const a = (asigs||[]).find(x=>x.id===r.asignacion_id);
    return !a || !asignacionVigenteEn(a, r.fecha) || !(a.dias||[]).includes(diaSemanaDeISO(r.fecha)) || fijoPausadoEn(pausas, a.id, r.fecha);
  });
  if(!fuera.length) return;
  const fmt = iso => new Date(iso+'T12:00:00').toLocaleDateString('es-UY',{weekday:'short',day:'2-digit',month:'2-digit'});
  abrirModal(`
    <h2 style="margin:0 0 6px;">Días cambiados a mano</h2>
    <div class="helper" style="margin-bottom:12px;">Estos días los había cambiado alguien a mano y, con el cambio del fijo, ya no le corresponden. No se tocaron: ¿los borramos?</div>
    ${fuera.map(r=>`<div class="agenda-ninerarow"><div><b>${fmt(r.fecha)}</b> · ${escaparHtml(r.ninera_nombre)} · ${escaparHtml((r.hora_inicio||'').slice(0,5))}${r.hora_fin?'–'+escaparHtml(r.hora_fin.slice(0,5)):''}${r.cancelado?' · no va':''}</div></div>`).join('')}
    <div class="confirmbtns">
      <button class="btn ghost" onclick="cerrarModal()">Dejarlos</button>
      <button class="btn danger" onclick="conGuardado(this, ()=>borrarPrevistosEditados(${argJs(fuera.map(r=>r.id))}))">Borrar estos días</button>
    </div>`);
}
async function borrarPrevistosEditados(ids){
  const { error } = await sb.from('sittings_traslados').delete().in('id', ids).eq('estado', 'previsto');
  if(error){ toast('No se pudieron borrar: '+error.message, 'bad'); return; }
  cerrarModal();
  toast(ids.length===1 ? 'Día borrado.' : `${ids.length} días borrados.`);
  if(document.getElementById('agenda-grid-wrap')) await cargarAgendaSolicitudes();
}
function abrirModalRegistroDesdeAgenda(s){
  const horario = s.termina_dia_siguiente
    ? `${(s.hora_inicio||'--:--').slice(0,5)} → +1 día${s.hora_fin?' '+s.hora_fin.slice(0,5):''}`
    : (s.hora_inicio ? (s.hora_fin ? `${s.hora_inicio.slice(0,5)}–${s.hora_fin.slice(0,5)}` : s.hora_inicio.slice(0,5)) : 'Sin horario');
  const cuerpo = `
    <h2>${escaparHtml(s.familia_nombre)}</h2>
    <div class="helper">${s.tipo==='traslado'?'Traslado':'Sitting'} · ${horario} · ${s._esPrevisto ? 'previsto (se confirma solo ese día)' : 'ya registrado en Sittings &amp; traslados'}</div>
    <div style="margin:14px 0;">
      <div class="agenda-ninerarow"><div><b>${escaparHtml(s.ninieras[0].ninera_nombre)}</b></div></div>
      ${s.cancelado
        ? `<div class="helper"><span class="badge warn" style="font-size:10.5px;padding:3px 8px;">Cancelado</span> Sin cargo: no se cobra ni se paga.</div>`
        : (s.cobro_familia ? `<div class="helper">Cobro a la familia: $${Number(s.cobro_familia).toLocaleString('es-UY')}</div>` : '')}
    </div>
    ${s.cancelado ? `<button class="btn primary" style="width:100%;margin-bottom:8px;" onclick="conGuardado(this, ()=>reactivarRegistroDesdeAgenda(${argJs(s._regId)}))">Reactivar este registro</button>` : ''}
    ${s._esPrevisto ? '' : `<button class="btn ${s.cancelado ? '' : 'primary'}" style="width:100%;margin-bottom:8px;" onclick="editarRegistroDesdeAgenda(${argJs(s._regId)})">Editar este registro</button>`}
    <button class="btn danger" style="width:100%;" onclick="conGuardado(this, ()=>eliminarRegistroDesdeAgenda(${argJs(s._regId)}))">Eliminar este registro</button>
  `;
  abrirModal(cuerpo);
}
/* Reactivar un registro cancelado (25/10/2026): vuelve a quedar como estaba antes de
   cancelarlo. Lo que cambió al cancelar (montos, cobrado / pagado, notas, si era automático)
   sale del historial de cambios: la fila del trigger en la que `cancelado` pasó a true, y de
   ella solo los valores de "antes". Sin esa fila (nació cancelado con "No fue nadie ese día",
   cancelación anterior al trigger o base sin la tabla) queda en $0 y se abre el registro para
   cargar los montos: no se inventa un precio. */
async function estadoAntesDeCancelar(regId){
  const { data, error } = await sb.from('sittings_historial').select('cambios')
    .eq('sitting_id', regId).eq('accion', 'cambio').order('cuando', {ascending:false}).limit(50);
  if(error || !data) return null;
  const fila = data.find(h=>h.cambios?.cancelado?.despues===true);
  if(!fila) return null;
  const antes = {};
  for(const [campo, c] of Object.entries(fila.cambios)) antes[campo] = c.antes;
  return antes;
}
async function reactivarRegistroDesdeAgenda(regId){
  const s = agendaSolicitudes.find(x=>x._regId===regId);
  const antes = await estadoAntesDeCancelar(regId);
  const plata = n => '$'+(Number(n)||0).toLocaleString('es-UY');
  const msg = antes
    ? `¿Reactivar este registro? Vuelve a quedar como estaba antes de cancelarlo: cobro ${plata(antes.cobro_familia)} y pago ${plata(antes.pago_ninera)}.`
    : '¿Reactivar este registro? No hay registro de cómo estaba antes de cancelarlo: queda con cobro $0 y pago $0, y se abre para que cargues los montos.';
  if(!(await confirmarAccion(msg, 'Reactivar'))) return;
  const cambios = antes ? { ...antes, cancelado: false } : { cancelado: false, cobrado: false, pagado: false };
  // Si otra admin lo reactivó o lo corrigió mientras tanto, no se pisa nada (regla del 21/10/2026).
  const { data, error } = await sb.from('sittings_traslados').update(cambios).eq('id', regId).eq('cancelado', true).select('id');
  if(error){ toast('No se pudo reactivar: '+error.message, 'bad'); return; }
  if(!data || !data.length){
    toast('Ese registro ya no estaba cancelado: lo cambió alguien más hace un momento. No se cambió nada.', 'bad');
    cerrarModal();
    await cargarAgendaSolicitudes();
    return;
  }
  cerrarModal();
  toast(antes ? 'Registro reactivado.' : 'Registro reactivado en $0: cargá los montos.');
  await cargarAgendaSolicitudes();
  actualizarAgendaBadge();
  if(!antes && !s?._esPrevisto) await editarRegistroDesdeAgenda(regId);
}
async function eliminarRegistroDesdeAgenda(regId){
  // Con gastos extra: mismo cuidado que en Sittings (gastosDelRegistroABorrar, sittings.js).
  const gastos = await gastosDelRegistroABorrar(regId);
  if(!gastos) return;
  const ok = await confirmarAccion('¿Eliminar este registro? No se puede deshacer.'+textoGastosAlBorrar(gastos));
  if(!ok) return;
  const { error } = await sb.from('sittings_traslados').delete().eq('id', regId);
  if(error){ toast('No se pudo eliminar: '+error.message, 'bad'); return; }
  cerrarModal();
  const faltas = await limpiarGastosDeRegistroBorrado(gastos);
  if(faltas.length) toast('Registro eliminado, pero no se pudo borrar '+faltas.join(' ni ')+'.', 'bad');
  else toast('Registro eliminado.');
  await cargarAgendaSolicitudes();
  actualizarAgendaBadge();
}
async function editarRegistroDesdeAgenda(regId){
  cerrarModal();
  await setModulo('sittings'); // espera a que sitItems ya esté cargado antes de buscar el registro
  await abrirModalSitForm(regId);
}
async function confirmarNinera(solNineraId){
  let sPrevio = null, nPrevio = null;
  for(const sx of agendaSolicitudes){ const nx = sx.ninieras.find(x=>x.id===solNineraId); if(nx){ sPrevio=sx; nPrevio=nx; break; } }
  if(sPrevio && nPrevio){
    const choque = chequearDobleReservaAgenda(nPrevio.ninera_nombre, sPrevio.fecha, sPrevio.hora_inicio, sPrevio.hora_fin, sPrevio.id);
    if(!(await avisarSiDobleReserva(choque, nPrevio.ninera_nombre, 'Confirmar igual'))) return;
  }
  if(!(await sbGuardar(sb.from('solicitud_ninieras').update({estado:'confirmada'}).eq('id', solNineraId), 'la confirmación'))) return;
  let solId = null;
  for(const s of agendaSolicitudes){ if(s.ninieras.some(n=>n.id===solNineraId)){ solId = s.id; break; } }
  await cargarAgendaSolicitudes();
  if(solId){
    const s2 = agendaSolicitudes.find(x=>x.id===solId);
    if(s2 && s2.ninieras.length && s2.ninieras.every(n=>n.estado==='confirmada')){
      await sbGuardar(sb.from('solicitudes').update({estado:'confirmada'}).eq('id', solId), 'la solicitud');
      await cargarAgendaSolicitudes();
    }
    abrirModalSolicitud(solId);
  }
  actualizarAgendaBadge();
}
async function cancelarSolicitud(id){
  const ok = await confirmarAccion('¿Cancelar esta solicitud? Las niñeras invitadas quedarán sin efecto.', 'Cancelar solicitud');
  if(!ok) return;
  if(!(await sbGuardar(sb.from('solicitudes').update({estado:'cancelada'}).eq('id', id), 'la cancelación'))) return;
  cerrarModal();
  cargarAgendaSolicitudes();
  actualizarAgendaBadge();
}

/* ---- Actualización en vivo (Supabase Realtime) ----
   Cada módulo se suscribe a cambios en sus tablas relevantes. Cuando alguien
   (en otra sesión/celular) inserta, edita o borra algo en esas tablas, se
   vuelve a cargar la vista actual sola, sin que haga falta recargar la página. */
const RT_TABLAS_POR_MODULO = {
  hoy: ['sittings_traslados','gastos_generales','solicitudes','asignaciones','candidatas','ninieras','familias','solicitud_ninieras'],
  agenda: ['solicitudes','solicitud_ninieras','asignaciones','sittings_traslados','familias','ninieras'],
  rrhh: ['candidatas','entrevistas','carsitting_datos','ninieras'],
  ninieras: ['ninieras','candidatas','resenas_ninieras','sittings_traslados','juguetes'],
  familias: ['familias','asignaciones','sittings_traslados','resenas_ninieras','ninieras'],
  sittings: ['sittings_traslados','familias','ninieras','resenas_ninieras','tarifas_traslado_config'],
  finanzas: ['sittings_traslados','gastos_generales','gastos_extra','ajustes_saldo','gastos_fijos','familias','ninieras','asignaciones','app_config','intermediaciones_enrique','intermediaciones_eventos','intermediaciones_eventos_ninieras'],
  marketing: ['fechas_marketing'],
  legal: ['contratos','ninieras','familias'],
  juguetes: ['juguetes','juguetes_movimientos','ninieras'],
  intermediaciones: ['intermediaciones_enrique','intermediaciones_eventos','intermediaciones_eventos_ninieras','intermediaciones_enrique_pool','ninieras'],
};
let rtChannel = null;
let rtRefrescarTimer = null;
// Recarga liviana por módulo: solo trae los datos de nuevo y repinta la lista, sin destruir
// y reconstruir el módulo entero (buscador, filtros, etc.) como hace renderModulo(). Antes,
// CUALQUIER cambio en 'ninieras' o 'familias' — incluido tu propio guardado, que ya se
// mostraba bien al toque — disparaba 600ms después una reconstrucción completa del módulo
// vía Realtime, y esa reconstrucción de más era la causa real de que el scroll se siguiera
// yendo arriba pese a los dos intentos anteriores (que sí guardaban/restauraban el scroll,
// pero sobre un DOM que se estaba tirando abajo y volviendo a armar de cero). De paso, esto
// evita perder lo que estabas escribiendo en el buscador cuando llega un cambio de otro lado.
const RT_RECARGA_LIVIANA = {
  ninieras: 'cargarNinieras',
  familias: 'cargarFamilias',
  // 05/10/2026 (testing exploratorio): reconstruir Finanzas borraba el resultado de la
  // conciliación con el extracto, y reconstruir RR.HH. borraba una entrevista a medio llenar
  // cada vez que entraba una candidata nueva por el formulario público.
  finanzas: 'refrescarFinanzasCompleto',
  rrhh: 'refrescarRrhhSinPisarEntrevista',
};
// Eco del propio guardado (27/10/2026, parpadeo en Niñeras): guardar ya recarga la lista
// (cargarNinieras), y el UPDATE propio volvía por Realtime 600 ms después y disparaba OTRA recarga
// completa (y una tercera cuando también se tocaba la ficha de candidata). Cada una repintaba
// Utilización y Temporadas con su fundido y, como cada carga tarda distinto, se veían prender y
// apagar varias veces. La recarga liviana del módulo avisa cuándo empieza y termina
// (marcarRecargaLiviana, desde cargarNinieras); un evento que llega con esa recarga en curso o
// dentro de esta ventana es el eco del guardado y se ignora. Un cambio de otra admin que llega
// después sigue recargando. Las recargas que lanza el propio Realtime no cuentan: si no, un
// segundo cambio ajeno que llegara mientras se aplica el primero se perdería.
const RT_VENTANA_ECO_MS = 1500;
let rtRecargaPropia = {}; // módulo -> { enCurso: true } o { terminoEn: performance.now() }
let rtRecargaDesdeRealtime = null; // módulo cuya recarga liviana lanzó Realtime (no es un guardado)
function marcarRecargaLiviana(modulo, enCurso){
  if(rtRecargaDesdeRealtime === modulo) return;
  // performance.now(): es un intervalo, no una fecha (y los tests fijan el reloj de Date).
  rtRecargaPropia[modulo] = enCurso ? { enCurso: true } : { terminoEn: performance.now() };
}
function esEcoDeRecargaPropia(modulo){
  const r = rtRecargaPropia[modulo];
  return !!r && (r.enCurso || performance.now() - r.terminoEn < RT_VENTANA_ECO_MS);
}
function suscribirRealtimeModuloActivo(){
  if(rtChannel){ sb.removeChannel(rtChannel); rtChannel = null; }
  const clave = moduloActivo && !moduloActivo.startsWith('pend-') ? moduloActivo : 'hoy';
  const tablas = RT_TABLAS_POR_MODULO[clave] || [];
  if(!tablas.length) return;
  rtChannel = sb.channel('rt-'+clave+'-'+Date.now());
  tablas.forEach(t=>{
    rtChannel.on('postgres_changes', {event:'*', schema:'public', table:t}, ()=>{
      clearTimeout(rtRefrescarTimer);
      const refrescar = async ()=>{
        const claveAhora = moduloActivo && !moduloActivo.startsWith('pend-') ? moduloActivo : 'hoy';
        if(claveAhora !== clave) return; // ya se cambió de módulo: ese módulo cargó datos frescos
        // Con un formulario abierto no se interrumpe, pero el cambio no se pierde: se aplica
        // apenas se cierra (antes se descartaba y la pantalla quedaba vieja hasta recargar).
        if(document.querySelector('.confirmoverlay.show')){ rtRefrescarTimer = setTimeout(refrescar, 800); return; }
        const recargaLiviana = RT_RECARGA_LIVIANA[clave] && window[RT_RECARGA_LIVIANA[clave]];
        if(recargaLiviana && esEcoDeRecargaPropia(clave)) return;
        const scrollRT = guardarScrollMainarea();
        if(recargaLiviana){
          rtRecargaDesdeRealtime = clave;
          try { await recargaLiviana(); } finally { rtRecargaDesdeRealtime = null; }
        }
        else { renderModulo(); }
        restaurarScrollMainarea(scrollRT);
      };
      rtRefrescarTimer = setTimeout(refrescar, 600);
    });
  });
  rtChannel.subscribe();
}
function renderModulo(){
  guardarBorradoresPendientes(); // lo último que se escribió queda en su borrador antes de redibujar
  renderSidebar();
  document.getElementById('modfooter').innerHTML = '';
  suscribirRealtimeModuloActivo();
  esperarConfigFijos(); // arranca la lectura de la marca de fijos automáticos sin frenar el pintado
  const cont = document.getElementById('modcontent');
  // Devuelve la promesa del render específico (cuando la tiene) para que quien llame a
  // renderModulo()/setModulo() pueda hacer `await` y saber que los datos ya cargaron de
  // verdad, en vez de adivinar un setTimeout con un tiempo fijo (ver editarRegistroDesdeAgenda,
  // cargarSittingDesdePendiente, agendarDesdeIntake, irANotificacion).
  if(!moduloActivo){ return renderDashboard(cont); }
  if(moduloActivo.startsWith('pend-')){ return renderPendHoy(cont); }
  const m = MODULOS.find(x=>x.key===moduloActivo);
  if(moduloActivo==='agenda'){ return renderAgenda(cont); }
  if(moduloActivo==='rrhh'){ cont.innerHTML = moduloHeader(m.label) + rrhhShell(); return afterRrhhRender(); }
  if(moduloActivo==='ninieras'){ cont.innerHTML = moduloHeader(m.label) + '<div id="ninieras-body"></div>'; return renderNinieras(document.getElementById('ninieras-body')); }
  if(moduloActivo==='familias'){ cont.innerHTML = moduloHeader(m.label) + '<div id="fam-body"></div>'; return renderFamilias(document.getElementById('fam-body')); }
  if(moduloActivo==='finanzas'){ return renderFinanzas(cont); }
  if(moduloActivo==='sittings'){ cont.innerHTML = moduloHeader(m.label) + '<div id="sit-body"></div>'; return renderSittings(document.getElementById('sit-body')); }
  if(moduloActivo==='marketing'){ return renderMarketing(cont); }
  if(moduloActivo==='legal'){ return renderLegal(cont); }
  if(moduloActivo==='juguetes'){ cont.innerHTML = moduloHeader(m.label) + '<div id="jug-body"></div>'; return renderJuguetes(document.getElementById('jug-body')); }
  if(moduloActivo==='intermediaciones'){ return renderIntermediaciones(cont); }
  if(moduloActivo==='notificaciones'){ cont.innerHTML = moduloHeader(m.label) + '<div id="notifcfg-body"></div>'; return renderNotifConfig(document.getElementById('notifcfg-body')); }
}

