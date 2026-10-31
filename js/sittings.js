/* ================= SITTINGS & TRASLADOS ================= */
let sitFamilias = [];
let sitNinieras = [];
let sitItems = [];
let sitTipo = 'sitting';
let sitPrefill = null; // {familiaNombre, nineraNombre, fecha, horaInicio, horaFin, tipo, asignacionId, cobro, pago, notas, fijo} — precarga el form desde "Sin registrar" en Hoy
let sitAsignacionId = null; // fijo del que sale el registro nuevo (vino con sitPrefill): se guarda en asignacion_id
let sitEsRegistroConocido = false; // true si se está editando uno ya guardado, o si vino con sitPrefill (un fijo/pendiente ya sabido) — controla si tiene sentido mostrar "Este día no hubo servicio"
let sitPagoModoHora = false; // true = el campo de pago a niñera se tipea por hora (y se calcula el total solo), false = se tipea el total directo
let sitEditId = null;
let sitPrecioMotivo = ''; // el motivo del precio a mano: el guardado al abrir y el último elegido en el formulario (21/10/2026)
let sitTeniaVariantes = false; // el registro que se edita tenía variantes de precio (23/10/2026)
let sitAsignacionVariantes = null; // el fijo del registro, para mostrar las variantes que son solo de ese fijo
let sitFamiliaSel = null;
let sitNineraSel = null;
// Precio por niñera (01/11/2026): los precios de la familia elegida (una lectura por familia) y el
// precio propio del fijo del registro ({ninera_id, ninera_nombre, pago_hora}), que solo vale con su niñera.
let sitPrecios = { familiaId: null, filas: null }; // filas: null mientras se leen o si no se pudieron leer
let sitPagoFijo = null;
let sitPagoHoraUsado = null; // el pago por hora del último cálculo: cambiar la niñera recalcula solo si cambia
let sitOrigenAuto = true;
let sitOrigenCoord = null;
let sitDestinoCoord = null;
let sitMes = null;

function shiftMes(mesStr, delta){ const [y,m] = mesStr.split('-').map(Number); const d = new Date(y, m-1+delta, 1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function primerDiaMesesAtras(n){ return shiftMes(currentMonthStr(), -n)+'-01'; }
function monthLabel(mesStr){
  const [y,m] = mesStr.split('-').map(Number);
  const f = new Intl.DateTimeFormat('es-UY', {month:'long', year:'numeric'}).format(new Date(y, m-1, 1));
  return f.charAt(0).toUpperCase() + f.slice(1);
}
function findFamilia(nombre){ const n = normaliza(nombre); return sitFamilias.find(f=>normaliza(f.nombre)===n) || null; }
function findNinera(nombre){ const n = normaliza(nombre); return sitNinieras.find(x=>normaliza(x.nombre)===n) || null; }

async function renderSittings(body){
  sitMes = sitMes || currentMonthStr();
  sitEditId = null; sitFamiliaSel = null; sitNineraSel = null; sitOrigenAuto = true; sitTipo = 'sitting'; sitPrecioMotivo = '';
  body.innerHTML = `
    <div style="display:flex;justify-content:center;margin-bottom:16px;">
      <button class="btn primary" style="font-size:16px;padding:14px 40px;" onclick="abrirModalSitForm()">+ Agregar sitting o traslado</button>
    </div>
    <div class="mesbar">
      <div class="mesnav">
        <button onclick="cambiarSitMesRel(-1)" aria-label="Mes anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="mesnav-label" id="sit-mes-label">${monthLabel(sitMes)}</div>
        <button onclick="cambiarSitMesRel(1)" aria-label="Mes siguiente"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <button class="smallbtn" onclick="exportarSitCSV()">Exportar CSV</button>
    </div>
    <div class="summary3" id="sit-summary"></div>
    <div class="card" id="sit-list-wrap"></div>
    <div class="card">
      <h2>Historial con filtros</h2>
      <div class="helper">Todos los sittings y traslados registrados, con búsqueda por familia y por período.</div>
      <div class="grid3">
        <div class="field"><label>Familia</label><select id="sithist-familia" onchange="onSitHistFiltroChange()"><option value="">Todas</option></select></div>
        <div class="field"><label>Período</label><select id="sithist-periodo" onchange="onSitHistPeriodoChange()">
          <option value="0">Todo</option><option value="7">Últimos 7 días</option><option value="15">Últimos 15 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="custom">Personalizado…</option>
        </select></div>
        <div class="field"><label>Tipo</label><select id="sithist-tipo" onchange="onSitHistFiltroChange()"><option value="">Todos</option><option value="sitting">Sitting</option><option value="traslado">Traslado</option></select></div>
      </div>
      <div class="grid2" id="sithist-custom-box" style="display:none;margin-top:-4px;margin-bottom:14px;">
        <div class="field"><label>Desde</label><input type="date" id="sithist-desde" onchange="renderSitHistorialCustom()"></div>
        <div class="field"><label>Hasta</label><input type="date" id="sithist-hasta" onchange="renderSitHistorialCustom()"></div>
      </div>
      <button class="smallbtn" onclick="abrirModalExportarHistorialPDF()" style="margin-bottom:12px;">Exportar a PDF</button>
      <div id="sithist-lista"></div>
    </div>
    <div id="incidentes-wrap"></div>
  `;
  await cargarSitBase();
  // Antes estas tres se disparaban sin esperar (fire-and-forget): renderSittings() "terminaba"
  // antes de que sitItems tuviera datos reales, así que quien esperaba a setModulo('sittings')
  // para después buscar un registro por id (editar desde Agenda, o desde "Cargar sitting" en
  // Hoy) se encontraba con sitItems todavía vacío. Ahora se esperan las tres.
  await Promise.all([cargarSitLista(), cargarSitHistorial(), cargarIncidentes()]);
}
let sitHistItems = [];
let sitHistOffset = 0;
let sitHistTotal = 0;
let sitHistLoadingMore = false;
let sitHistMostrar = 10; // cuántas filas se ven de una — separado de cuántas se traen del servidor
let sitListaMostrar = 15; // igual criterio para "Registros de [mes]", arriba del historial
const SIT_HIST_PAGE = 200;
async function cargarSitHistorial(){
  await esperarConfigFijos(); // fijos automáticos: saber si hay que sacar los previstos
  const [{data:pagina, count}, {data:resenas}, {data:soloFamilias}] = await Promise.all([
    sinPrevistos(sb.from('sittings_traslados').select('*', {count:'exact'})).order('fecha', {ascending:false}).range(0, SIT_HIST_PAGE-1),
    sb.from('resenas_ninieras').select('ninera_nombre,puntuacion'),
    leerTodasLasFilas(()=>sinPrevistos(sb.from('sittings_traslados').select('familia_nombre')).order('id')), // solo esta columna: liviano aunque la tabla crezca, así el filtro de familia siempre tiene todas las opciones
  ]);
  sitHistItems = pagina || [];
  sitHistOffset = sitHistItems.length;
  sitHistTotal = count!=null ? count : sitHistItems.length;
  sitHistResenas = {};
  (resenas||[]).forEach(r=>{
    if(r.puntuacion==null) return;
    const k = normaliza(r.ninera_nombre||'');
    if(!k) return;
    if(!sitHistResenas[k]) sitHistResenas[k] = {suma:0, cant:0};
    sitHistResenas[k].suma += Number(r.puntuacion);
    sitHistResenas[k].cant += 1;
  });
  llenarSelectFamiliasHistorial(soloFamilias||[]);
  renderSitHistorial();
}
function llenarSelectFamiliasHistorial(filas){
  // llenar desplegable de familias agrupando variantes de mayúsculas/tildes/espacios como la misma familia
  const sel = document.getElementById('sithist-familia');
  if(!sel) return;
  const valorPrevio = sel.value;
  const famMap = new Map();
  filas.forEach(s=>{
    const raw = (s.familia_nombre||'').trim();
    if(!raw) return;
    const key = normaliza(raw);
    if(!famMap.has(key)) famMap.set(key, raw);
  });
  const fams = [...famMap.entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  sel.innerHTML = `<option value="">Todas</option>` + fams.map(([key,label])=>`<option value="${escaparHtml(key)}">${escaparHtml(label)}</option>`).join('');
  if(valorPrevio) sel.value = valorPrevio;
}
async function cargarSitHistorialMas(){
  await esperarConfigFijos(); // fijos automáticos: saber si hay que sacar los previstos
  if(sitHistLoadingMore || sitHistItems.length>=sitHistTotal) return;
  sitHistLoadingMore = true;
  renderSitHistorial();
  const { data } = await sinPrevistos(sb.from('sittings_traslados').select('*')).order('fecha', {ascending:false}).range(sitHistOffset, sitHistOffset+SIT_HIST_PAGE-1);
  sitHistItems = sitHistItems.concat(data||[]);
  sitHistOffset = sitHistItems.length;
  sitHistLoadingMore = false;
  renderSitHistorial();
}
function resenaBadge(nineraNombre){
  const res = sitHistResenas[normaliza(nineraNombre||'')];
  if(!res) return '<span style="color:var(--ink-soft);">—</span>';
  const prom = (res.suma/res.cant).toFixed(1);
  const color = Number(prom)>=4 ? 'var(--good)' : Number(prom)>=3 ? '#7A5A16' : 'var(--clay-text)';
  return `<span style="font-weight:600;color:${color};">★ ${prom} (${res.cant})</span>`;
}
// Horario/duración solo aplica a sittings (hora_inicio/hora_fin) -- los traslados usan
// km/origen/destino, no tienen ese concepto, así que muestran "—".
// Las horas son las reales; si la familia aceptó los términos, el horario aclara hasta qué
// hora se le cobra (también en el PDF que se le manda).
function horasRegistroSit(r){
  if(r.tipo!=='sitting') return null;
  return horasSitting(r.hora_inicio, r.hora_fin, r.termina_dia_siguiente, (sitFamilias||[]).find(f=>f.id===r.familia_id), r.fecha);
}
function horarioEfectuadoTexto(r){
  if(r.tipo!=='sitting' || !r.hora_inicio || !r.hora_fin) return '—';
  const finCobro = r.cancelado ? null : horasRegistroSit(r)?.finCobro;
  return `${r.hora_inicio.slice(0,5)}–${r.hora_fin.slice(0,5)}${finCobro ? ` (se cobra hasta ${finCobro})` : ''}`;
}
function horasEfectuadasTexto(r){
  const horas = horasRegistroSit(r)?.real;
  if(!horas) return '—';
  return (Number.isInteger(horas) ? horas : horas.toFixed(1)) + ' hs';
}
// Fila compartida entre el historial "Todo/período" y el de rango personalizado -- antes
// estaba duplicada en los dos lugares, con riesgo real de que se actualice uno y no el otro.
// Clickeable: toca la fila para editar el registro (así "Detalle" queda fácil de completar
// justo donde se ve, sin tener que ir a buscarlo a la lista de arriba).
function filaHistorialTr(r){
  const fechaFmt = r.fecha ? new Date(r.fecha+'T00:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  return `<tr style="cursor:pointer;" onclick="abrirModalSitForm(${argJs(r.id)})" title="Tocar para editar">
    <td>${fechaFmt}</td>
    <td>${escaparHtml(r.ninera_nombre)}</td>
    <td>${escaparHtml(r.familia_nombre)}${r.cancelado?' <span class="badge warn" style="font-size:9.5px;padding:2px 6px;">Cancelado</span>':''}</td>
    <td>${horarioEfectuadoTexto(r)}</td>
    <td>${horasEfectuadasTexto(r)}</td>
    <td>${plataFin(r.cobro_familia)}</td>
    <td>${plataFin(r.pago_ninera)}</td>
    <td class="hist-detalle" title="${escaparHtml(detalleRegistro(r))}">${escaparHtml(detalleRegistro(r)||'—')}</td>
    <td>${resenaBadge(r.ninera_nombre)}</td>
  </tr>`;
}
const HIST_THEAD = `<tr><th>Fecha</th><th>Niñera</th><th>Familia</th><th>Horario</th><th>Horas</th><th>Cobro</th><th>Pago</th><th>Detalle</th><th>Reseña niñera</th></tr>`;
function onSitHistPeriodoChange(){
  sitHistMostrar = 10;
  const val = document.getElementById('sithist-periodo')?.value;
  const box = document.getElementById('sithist-custom-box');
  if(box) box.style.display = (val==='custom') ? 'flex' : 'none';
  if(val==='custom') renderSitHistorialCustom();
  else renderSitHistorial();
}
function onSitHistFiltroChange(){
  sitHistMostrar = 10;
  const val = document.getElementById('sithist-periodo')?.value;
  if(val==='custom') renderSitHistorialCustom();
  else renderSitHistorial();
}
/* Rango de fechas libre (ej. setiembre a noviembre 2025): consulta directa a la base,
   no depende de los 200 registros más recientes que se cachean para el resto de los filtros
   — así funciona bien incluso muy atrás en el histórico. */
async function renderSitHistorialCustom(){
  await esperarConfigFijos(); // fijos automáticos: saber si hay que sacar los previstos
  const cont = document.getElementById('sithist-lista');
  if(!cont) return;
  const desde = document.getElementById('sithist-desde')?.value;
  const hasta = document.getElementById('sithist-hasta')?.value;
  if(!desde || !hasta){ cont.innerHTML = '<div class="empty">Elegí las dos fechas del rango.</div>'; return; }
  if(hasta < desde){ cont.innerHTML = '<div class="empty">La fecha "hasta" tiene que ser posterior a la de "desde".</div>'; return; }
  const famF = document.getElementById('sithist-familia')?.value||'';
  const tipoF = document.getElementById('sithist-tipo')?.value||'';
  cont.innerHTML = '<div class="empty"><span class="spinner dark"></span> Buscando…</div>';
  const data = await sbLeer(
    sinPrevistos(sb.from('sittings_traslados').select('*')).gte('fecha', desde).lte('fecha', hasta).order('fecha', {ascending:false}),
    'los registros de ese período', []
  );
  let items = data || [];
  if(famF) items = items.filter(s=>normaliza(s.familia_nombre)===famF);
  if(tipoF) items = items.filter(s=>s.tipo===tipoF);
  if(!items.length){ cont.innerHTML = '<div class="empty">No hay registros en ese rango de fechas.</div>'; return; }
  const totalCobro = items.reduce((s,r)=>s+(Number(r.cobro_familia)||0),0);
  const totalPago = items.reduce((s,r)=>s+(Number(r.pago_ninera)||0),0);
  cont.innerHTML = `
    <div class="helper" style="margin:8px 0;">${items.length} registro(s) · cobrado $${totalCobro.toLocaleString('es-UY')} · pagado $${totalPago.toLocaleString('es-UY')}</div>
    <div class="tablewrap"><table class="asigtable"><thead>${HIST_THEAD}</thead>
    <tbody>${items.map(filaHistorialTr).join('')}</tbody></table></div>`;
}
/* ---- Exportar historial a PDF ----
   Siempre pide un rango de fechas explícito (Desde/Hasta) y hace una consulta directa a la
   base para ese rango exacto -- no depende de los 200 registros cacheados ni de "Mostrar
   más", así que el PDF siempre sale completo aunque el rango sea grande o muy atrás en el
   histórico. Respeta los filtros de Familia/Tipo que ya estén elegidos arriba. No incluye
   Pago a niñera ni Reseña niñera -- eso queda solo en pantalla, no en el PDF que se comparte
   afuera. El "Detalle" (columna nueva) es el mismo campo "Notas" que ya existía en el
   formulario de sitting -- se edita ahí (o tocando la fila en el historial), no acá. */
let exphistItemsPreview = [];
let exphistAjustes = []; // saldo a favor de la familia elegida (07/10/2026)
let exphistGastos = [];  // gastos extra de esos registros (08/10/2026)
function abrirModalExportarHistorialPDF(){
  asegurarJsPDF().catch(()=>{}); // se va descargando mientras eligen el rango, así "Descargar PDF" es inmediato
  const famSel = document.getElementById('sithist-familia');
  const tipoSel = document.getElementById('sithist-tipo');
  const hoy = todayISO();
  const desdeActual = document.getElementById('sithist-desde')?.value || `${hoy.slice(0,4)}-01-01`;
  const hastaActual = document.getElementById('sithist-hasta')?.value || hoy;
  exphistItemsPreview = [];
  const html = `
    <h2>Exportar historial a PDF</h2>
    <div class="helper">Elegí el rango de fechas exacto a exportar — no depende de lo que esté cargado en pantalla.</div>
    <div class="grid2" style="margin-top:10px;">
      <div class="field"><label>Desde</label><input type="date" id="exphist-desde" value="${desdeActual}"></div>
      <div class="field"><label>Hasta</label><input type="date" id="exphist-hasta" value="${hastaActual}"></div>
    </div>
    <div class="helper" style="margin-top:2px;">Familia: ${escaparHtml(famSel?.selectedOptions?.[0]?.textContent || 'Todas')} · Tipo: ${escaparHtml(tipoSel?.selectedOptions?.[0]?.textContent || 'Todos')} — los mismos filtros de arriba.</div>
    <div id="exphist-warn"></div>
    <button class="btn primary" style="width:100%;margin-top:14px;" onclick="generarVistaPreviaHistorialPDF()">Ver vista previa</button>
    <div id="exphist-preview" style="margin-top:16px;"></div>
  `;
  abrirModal(html);
}
// El detalle de un registro en el historial y en el PDF: las variantes de precio que se le
// aplicaron (23/10/2026) y las notas.
function detalleRegistro(r){ return [nombresVariantes(r.precio_variantes), r.notas].filter(Boolean).join(' · '); }
async function generarVistaPreviaHistorialPDF(){
  await esperarConfigFijos(); // fijos automáticos: saber si hay que sacar los previstos
  const desde = document.getElementById('exphist-desde')?.value;
  const hasta = document.getElementById('exphist-hasta')?.value;
  const warn = document.getElementById('exphist-warn');
  const preview = document.getElementById('exphist-preview');
  if(warn) warn.innerHTML = '';
  if(!desde || !hasta){ if(warn) warn.innerHTML = '<div class="warnbox">Elegí las dos fechas.</div>'; return; }
  if(hasta < desde){ if(warn) warn.innerHTML = '<div class="warnbox">"Hasta" tiene que ser posterior a "Desde".</div>'; return; }
  preview.innerHTML = '<div class="empty"><span class="spinner dark"></span> Buscando…</div>';
  const famF = document.getElementById('sithist-familia')?.value||'';
  const tipoF = document.getElementById('sithist-tipo')?.value||'';
  const data = await sbLeer(
    sinPrevistos(sb.from('sittings_traslados').select('*')).gte('fecha', desde).lte('fecha', hasta).order('fecha', {ascending:false}),
    'los registros de ese período', []
  );
  let items = data || [];
  if(famF) items = items.filter(s=>normaliza(s.familia_nombre)===famF);
  if(tipoF) items = items.filter(s=>s.tipo===tipoF);
  if(!items.length){ preview.innerHTML = '<div class="empty">No hay registros en ese rango con estos filtros.</div>'; return; }
  exphistItemsPreview = items;
  // Saldo a favor (07/10/2026): con una familia elegida, sus ajustes del período y los que
  // siguen pendientes van en el PDF, con su motivo.
  exphistAjustes = [];
  if(famF){
    const fam = (sitFamilias||[]).find(f=>normaliza(f.nombre)===famF);
    if(fam && typeof cargarAjustesSaldo==='function'){
      const ajustes = await cargarAjustesSaldo({familia_id: fam.id});
      exphistAjustes = ajustes.filter(a=>pendienteAjuste(a) || (a.fecha>=desde && a.fecha<=hasta));
    }
  }
  // Gastos extra de esos registros, con quién los pagó (el ticket va en el PDF).
  exphistGastos = [];
  if(typeof gastosExtraDisponible==='undefined' || gastosExtraDisponible){
    const ids = items.map(r=>r.id);
    for(let i=0; i<ids.length; i+=100){
      const { data: gs, error: eg } = await sb.from('gastos_extra').select('*').in('sitting_id', ids.slice(i, i+100));
      if(eg){ if(esFaltaTabla(eg)) gastosExtraDisponible = false; break; }
      exphistGastos.push(...(gs||[]));
    }
  }
  // Lo que absorbe Parents Break no se le cobra a la familia: no va en su PDF (13/10/2026).
  exphistGastos = exphistGastos.filter(g=>!g.absorbe_pb);
  const fechaDeSit = id => items.find(r=>r.id===id)?.fecha || '';
  exphistGastos.forEach(g=>{ g._fecha = fechaDeSit(g.sitting_id); });
  exphistGastos.sort((a,b)=>a._fecha.localeCompare(b._fecha));
  const totalGastosFamilia = exphistGastos.filter(gastoACargoFamilia).reduce((t,g)=>t+(Number(g.monto)||0),0);
  const gastosHtml = exphistGastos.length ? `
    <div class="helper" style="margin:12px 0 4px;">Gastos extra${totalGastosFamilia ? ` a cargo de la familia: <b>$${totalGastosFamilia.toLocaleString('es-UY')}</b>` : ''} (el ticket va en el PDF)</div>
    <div class="tablewrap"><table class="asigtable" id="exphist-gastos"><thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Lo pagó</th></tr></thead>
    <tbody>${exphistGastos.map(g=>`<tr><td>${g._fecha ? new Date(g._fecha+'T00:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</td><td>${escaparHtml(g.concepto)}</td><td>$${Number(g.monto).toLocaleString('es-UY')}</td><td>${g.pagado_por==='familia'?'La familia (a su favor)':'La niñera (se cobra)'}</td></tr>`).join('')}</tbody></table></div>` : '';
  const totalCobro = items.reduce((s,r)=>s+(Number(r.cobro_familia)||0),0);
  const saldoPend = Math.round(exphistAjustes.reduce((t,a)=>t+pendienteAjuste(a),0)*100)/100;
  exphistTotal = totalAPagarHistorial(items, exphistGastos, saldoPend);
  exphistCuenta = await leerCuentaCobro();
  const ajustesHtml = exphistAjustes.length ? `
    <div class="helper" style="margin:12px 0 4px;">Saldo${saldoPend ? ` pendiente: <b>${textoMontoAjuste(saldoPend)}</b>` : ''}</div>
    <div class="tablewrap"><table class="asigtable" id="exphist-ajustes"><thead><tr><th>Fecha</th><th>Motivo</th><th>Monto</th><th>Estado</th></tr></thead>
    <tbody>${exphistAjustes.map(a=>`<tr><td>${new Date(a.fecha+'T00:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'short',year:'numeric'})}</td><td>${escaparHtml(a.motivo)}</td><td>${textoMontoAjuste(a.monto)}</td><td>${pendienteAjuste(a) ? 'Pendiente' : 'Ya aplicado'}</td></tr>`).join('')}</tbody></table></div>` : '';
  preview.innerHTML = `
    <div class="helper" style="margin-bottom:8px;">${items.length} registro(s) · cobrado $${totalCobro.toLocaleString('es-UY')}</div>
    <div class="tablewrap" style="max-height:320px;overflow-y:auto;"><table class="asigtable">
      <thead><tr><th>Fecha</th><th>Niñera</th><th>Familia</th><th>Horario</th><th>Horas</th><th>Cobro</th><th>Detalle</th></tr></thead>
      <tbody>${items.map(r=>`<tr>
        <td>${r.fecha ? new Date(r.fecha+'T00:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</td>
        <td>${escaparHtml(r.ninera_nombre)}</td>
        <td>${escaparHtml(r.familia_nombre)}${r.cancelado?' <span class="badge warn" style="font-size:9.5px;padding:2px 6px;">Cancelado</span>':''}</td>
        <td>${horarioEfectuadoTexto(r)}</td>
        <td>${horasEfectuadasTexto(r)}</td>
        <td>${plataFin(r.cobro_familia)}</td>
        <td class="hist-detalle" title="${escaparHtml(detalleRegistro(r))}">${escaparHtml(detalleRegistro(r)||'—')}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${gastosHtml}
    ${ajustesHtml}
    <div class="exphist-total" style="margin-top:12px;padding:10px 12px;border-radius:10px;background:var(--accent-soft, rgba(117,124,187,.12));">
      ${exphistTotal.lineas.map(l=>`<div class="helper" style="margin:0;">${escaparHtml(l)}</div>`).join('')}
      <div style="font-weight:700;margin-top:4px;" id="exphist-total-pagar">Total a pagar: ${plataFin(exphistTotal.total)}</div>
    </div>
    <div class="field" style="margin-top:10px;"><label>Cuenta para transferir (sale en el PDF)</label><input type="text" id="exphist-cuenta" value="${escaparHtml(exphistCuenta)}" placeholder="Banco, número de cuenta y titular"></div>
    <button class="btn primary" style="width:100%;margin-top:12px;" onclick="conGuardado(this, ()=>descargarHistorialPDF(${argJs(desde)},${argJs(hasta)}))">Descargar PDF</button>
  `;
}
// Total a pagar del PDF de la familia: lo que todavía no se cobró de los registros y de los
// gastos a su cargo, más el saldo pendiente (negativo = a favor de la familia).
// Sin centavos, con la regla del cobro (redondearCobro, 21/10/2026).
let exphistTotal = { total:0, lineas:[] }, exphistCuenta = '';
function totalAPagarHistorial(items, gastos, saldoPend){
  const f = n => '$'+redondearCobro(n).toLocaleString('es-UY');
  const servicios = items.filter(r=>!r.cobrado).reduce((t,r)=>t+(Number(r.cobro_familia)||0),0);
  const yaPagado = items.filter(r=>r.cobrado).reduce((t,r)=>t+(Number(r.cobro_familia)||0),0);
  const gastosFam = (gastos||[]).filter(g=>gastoACargoFamilia(g) && !g.cobrado).reduce((t,g)=>t+(Number(g.monto)||0),0);
  const lineas = [`Servicios: ${f(servicios)}`];
  if(gastosFam) lineas.push(`Gastos extra: ${f(gastosFam)}`);
  if(saldoPend) lineas.push(`Saldo ${saldoPend<0 ? 'a favor de la familia' : 'pendiente de la familia'}: ${saldoPend<0?'−':'+'}${f(Math.abs(saldoPend))}`);
  if(yaPagado) lineas.push(`Ya pagado de este período (no se suma): ${f(yaPagado)}`);
  return { total: redondearCobro(Math.max(0, servicios + gastosFam + saldoPend)), lineas };
}
async function leerCuentaCobro(){
  const { data } = await sb.from('app_config').select('valor').eq('id', 'cuenta_cobro').maybeSingle();
  return (data?.valor?.texto || '').toString();
}
async function guardarCuentaCobro(texto){
  const ok = await sbGuardar(sb.from('app_config').upsert({ id:'cuenta_cobro', valor:{ texto }, actualizado_at: new Date().toISOString() }), 'la cuenta para transferir');
  if(ok) exphistCuenta = texto;
}
async function descargarHistorialPDF(desde, hasta){
  if(!exphistItemsPreview.length) return;
  try{ await asegurarJsPDF(); }
  catch(e){ toast('No se pudo cargar el generador de PDF. Revisá la conexión e intentá de nuevo.', 'bad'); return; }
  const fmtFecha = (iso) => iso ? new Date(iso+'T00:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  const famSel = document.getElementById('sithist-familia');
  const famLabel = famSel?.selectedOptions?.[0]?.textContent || 'Todas';
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'landscape'});
  doc.setFontSize(14);
  doc.text('Parents’ Break — Historial de sittings y traslados', 14, 16);
  doc.setFontSize(10);
  doc.text(`Del ${fmtFecha(desde)} al ${fmtFecha(hasta)} · Familia: ${famLabel}`, 14, 23);
  doc.text(`${exphistItemsPreview.length} registro(s)`, 14, 29);
  // La cuenta para transferir se guarda para la próxima (app_config 'cuenta_cobro').
  const cuenta = (document.getElementById('exphist-cuenta')?.value || '').trim();
  if(cuenta !== exphistCuenta) await guardarCuentaCobro(cuenta);
  doc.autoTable({
    startY: 35,
    head: [['Fecha','Niñera','Familia','Horario','Horas','Cobro','Detalle']],
    body: exphistItemsPreview.map(r=>[
      fmtFecha(r.fecha),
      r.ninera_nombre||'',
      r.familia_nombre + (r.cancelado ? ' (Cancelado)' : ''),
      horarioEfectuadoTexto(r),
      horasEfectuadasTexto(r),
      `$${(r.cobro_familia||0).toLocaleString('es-UY')}`,
      detalleRegistro(r),
    ]),
    styles:{fontSize:8, cellPadding:3, overflow:'linebreak'},
    headStyles:{fillColor:[117,124,187]},
    columnStyles:{6:{cellWidth:75}},
  });
  if(exphistGastos.length){
    const y = (doc.lastAutoTable?.finalY || 35) + 10;
    const totalGastosFamilia = exphistGastos.filter(gastoACargoFamilia).reduce((t,g)=>t+(Number(g.monto)||0),0);
    doc.setFontSize(11);
    doc.text(`Gastos extra${totalGastosFamilia ? ` a cargo de la familia: $${totalGastosFamilia.toLocaleString('es-UY')}` : ''}`, 14, y);
    doc.autoTable({
      startY: y + 4,
      head: [['Fecha','Concepto','Monto','Lo pagó']],
      body: exphistGastos.map(g=>[fmtFecha(g._fecha), g.concepto||'', `$${Number(g.monto).toLocaleString('es-UY')}`, g.pagado_por==='familia'?'La familia (a su favor)':'La niñera (se cobra)']),
      styles:{fontSize:8, cellPadding:3, overflow:'linebreak'},
      headStyles:{fillColor:[117,124,187]},
    });
  }
  if(exphistAjustes.length){
    const saldoPend = Math.round(exphistAjustes.reduce((t,a)=>t+pendienteAjuste(a),0)*100)/100;
    const y = (doc.lastAutoTable?.finalY || 35) + 10;
    doc.setFontSize(11);
    doc.text(saldoPend ? `Saldo pendiente: ${textoMontoAjuste(saldoPend)}` : 'Saldo', 14, y);
    doc.autoTable({
      startY: y + 4,
      head: [['Fecha','Motivo','Monto','Estado']],
      body: exphistAjustes.map(a=>[fmtFecha(a.fecha), a.motivo||'', textoMontoAjuste(a.monto), pendienteAjuste(a) ? 'Pendiente' : 'Ya aplicado']),
      styles:{fontSize:8, cellPadding:3, overflow:'linebreak'},
      headStyles:{fillColor:[117,124,187]},
    });
  }
  // Un único "Total a pagar" (13/10/2026): registros + gastos a cargo de la familia + saldo, y
  // la cuenta para transferir. Antes eran tres números sueltos y decía "Total cobrado".
  {
    let y = (doc.lastAutoTable?.finalY || 35) + 12;
    if(y > 175){ doc.addPage(); y = 20; }
    doc.setFontSize(10);
    exphistTotal.lineas.forEach(l=>{ doc.text(l, 14, y); y += 6; });
    doc.setFontSize(13);
    doc.text(`Total a pagar: $${exphistTotal.total.toLocaleString('es-UY')}`, 14, y + 2);
    if(cuenta){ doc.setFontSize(10); doc.text(`Transferir a: ${cuenta}`, 14, y + 10); }
  }
  // Los tickets, uno por página (el bucket es privado: link firmado que vence enseguida).
  for(const g of exphistGastos){
    doc.addPage();
    doc.setFontSize(11);
    doc.text(`Ticket: ${g.concepto} · $${Number(g.monto).toLocaleString('es-UY')} · ${fmtFecha(g._fecha)}`, 14, 16);
    const img = await imagenComprobanteParaPDF(g.comprobante);
    if(img){
      const maxW = 260, maxH = 170;
      const k = Math.min(maxW/img.w, maxH/img.h, 1);
      doc.addImage(img.dataUrl, 'JPEG', 14, 22, img.w*k, img.h*k);
    } else {
      doc.setFontSize(9);
      doc.text('No se pudo traer la foto del ticket (está en la app, en el registro).', 14, 26);
    }
  }
  doc.save(`historial-parents-break-${desde}-a-${hasta}.pdf`);
  toast('PDF descargado.');
}
// Trae el ticket del bucket privado y lo pasa a JPEG con un canvas (sirve también para
// formatos que jsPDF no lee, como las fotos HEIC del celular). Medidas en puntos para el PDF.
async function imagenComprobanteParaPDF(ruta){
  try{
    const { data, error } = await sb.storage.from('comprobantes').createSignedUrl(ruta, 120);
    if(error || !data?.signedUrl) return null;
    const blob = await (await fetch(data.signedUrl)).blob();
    const url = URL.createObjectURL(blob);
    const im = await new Promise((res, rej)=>{ const i = new Image(); i.onload = ()=>res(i); i.onerror = rej; i.src = url; });
    const escala = Math.min(1, 1600/Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth*escala); c.height = Math.round(im.naturalHeight*escala);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return { dataUrl: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height };
  }catch(e){ return null; }
}
function renderSitHistorial(){
  const cont = document.getElementById('sithist-lista');
  if(!cont) return;
  const famF = document.getElementById('sithist-familia')?.value||'';
  const periodo = parseInt(document.getElementById('sithist-periodo')?.value||'0');
  const tipoF = document.getElementById('sithist-tipo')?.value||'';
  let items = sitHistItems.slice();
  if(famF) items = items.filter(s=>normaliza(s.familia_nombre)===famF);
  if(tipoF) items = items.filter(s=>s.tipo===tipoF);
  if(periodo>0){
    const limiteISO = sumarDiasISO(todayISO(), -periodo);
    items = items.filter(s=>s.fecha && s.fecha >= limiteISO);
  }
  const hayMasSinCargar = periodo===0 && sitHistItems.length < sitHistTotal;
  const cargadosLabel = hayMasSinCargar ? ` (${sitHistItems.length} de ${sitHistTotal} cargados)` : '';
  // En "Todo" (el período por defecto) no mostramos todo lo que ya está cargado de una —
  // se revela de a 10 con "Mostrar más". En un período específico (7/15/30/90 días o un
  // rango elegido a mano) ya es un recorte acotado a propósito, así que se muestra entero.
  const mostrarTope = periodo===0 ? Math.min(sitHistMostrar, items.length) : items.length;
  const itemsMostrados = items.slice(0, mostrarTope);
  const hayMasLocal = periodo===0 && mostrarTope < items.length;
  const botonMostrarMas = hayMasLocal ? `<button class="smallbtn" onclick="sitHistMostrar+=10;renderSitHistorial();" style="margin-top:10px;">Mostrar más</button>` : '';
  const botonMas = (!hayMasLocal && hayMasSinCargar) ? `<button class="smallbtn" id="sithist-mas-btn" onclick="cargarSitHistorialMas()" ${sitHistLoadingMore?'disabled':''} style="margin-top:10px;">${sitHistLoadingMore?'Cargando…':'Cargar registros más antiguos'}</button>` : '';
  if(!items.length){
    cont.innerHTML = `<div class="empty">No hay registros que coincidan con estos filtros${hayMasSinCargar?' entre los ya cargados — probá "Cargar registros más antiguos"':''}.</div>${botonMas}`;
    return;
  }
  const totalCobro = items.reduce((s,r)=>s+(Number(r.cobro_familia)||0),0);
  const totalPago = items.reduce((s,r)=>s+(Number(r.pago_ninera)||0),0);
  cont.innerHTML = `
    <div class="helper" style="margin:8px 0;">${itemsMostrados.length} de ${items.length} registro(s)${cargadosLabel} · cobrado $${totalCobro.toLocaleString('es-UY')} · pagado $${totalPago.toLocaleString('es-UY')}</div>
    <div class="tablewrap"><table class="asigtable"><thead>${HIST_THEAD}</thead>
    <tbody>${itemsMostrados.map(filaHistorialTr).join('')}</tbody></table></div>
    ${botonMostrarMas}${botonMas}`;
}
async function cargarSitBase(){
  const [{data:fams}, {data:nins}] = await Promise.all([
    leerFamiliasConTerminos('id,nombre,direccion,cobro_hora,pago_hora', q=>q.order('nombre')),
    sb.from('ninieras').select('id,nombre').eq('activa', true).order('nombre'),
  ]);
  sitFamilias = fams || [];
  sitNinieras = nins || [];
  await cargarTarifaTrasladoConfig();
}

function registradoPorUsuario(){
  // Usa el nombre para mostrar de la cuenta logueada (mismo que el sidebar) en vez de un
  // mapa de mails hardcodeado — así escala solo cuando se suma una cuenta nueva, sin volver
  // a tocar este archivo.
  if(typeof nombreUsuario==='function'){
    const n = nombreUsuario();
    if(n && n!=='?') return n;
  }
  return '';
}
function sitFormHTML(){
  return `
    <h2>${sitEditId ? 'Editar registro' : 'Nuevo registro'}</h2>
    <div class="tiporow">
      <button type="button" class="tipobtn ${sitTipo==='sitting'?'selected':''}" id="sit-tipo-sitting" onclick="setSitTipo('sitting')">Sitting</button>
      <button type="button" class="tipobtn ${sitTipo==='traslado'?'selected':''}" id="sit-tipo-traslado" onclick="setSitTipo('traslado')">Traslado</button>
    </div>
    <div class="grid3">
      <div class="field"><label>Registró</label><input type="text" id="sit-registro" value="${sitEditId ? '' : escaparHtml(registradoPorUsuario())}" placeholder="Nombre"></div>
      <div class="field" style="position:relative;">
        <label>Familia</label>
        <input type="text" id="sit-familia" autocomplete="off">
        <div id="sit-familia-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
        <div class="createhint" id="sit-familia-create"></div>
      </div>
      <div class="field" style="position:relative;">
        <label>Niñera</label>
        <input type="text" id="sit-ninera" autocomplete="off">
        <div id="sit-ninera-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
        <div class="createhint" id="sit-ninera-create"></div>
      </div>
    </div>
    <div id="sit-familia-nueva"></div>
    <div id="sit-camposTipo"></div>
    <div class="field" style="margin-top:4px;">
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;">
        <input type="checkbox" id="sit-esfijo" onchange="toggleSitEsFijo()">
        ¿Es un trabajo fijo? (se repite todas las semanas)
      </label>
    </div>
    <div id="sit-fijo-box" style="display:none;margin-bottom:12px;">
      <div class="helper" style="margin:0 0 6px;">Además de guardar este registro de hoy, se crea la asignación fija para que Agenda la genere sola los próximos días.</div>
      <div class="dayrow" id="sit-fijo-dias">
        ${['L','M','X','J','V','S','D'].map(d=>`<button type="button" class="daybtn" data-dia="${d}" onclick="this.classList.toggle('selected')">${DIAS_CORTO[d]}</button>`).join('')}
      </div>
    </div>
    <label class="chk chk-largo" style="margin:0 0 10px;${sitEsRegistroConocido ? '' : 'display:none;'}">
      <input type="checkbox" id="sit-cancelado" onchange="onSitCanceladoChange()">
      Este día no hubo servicio (canceló la familia o faltó la niñera sin reemplazo) — sin cargo
    </label>
    <div class="grid2">
      <div class="field"><label>Cobro a familia</label><input type="number" id="sit-cobro" value="0" oninput="calcSitMargen();marcarCampoEditadoManual('sit-cobro');refrescarSugerenciaPrecioSit()"></div>
      <div class="field">
        <label>Pago TOTAL a niñera <span style="font-weight:400;color:var(--ink-soft);">(no por hora)</span></label>
        <input type="number" id="sit-pago" value="0" oninput="calcSitMargen();marcarCampoEditadoManual('sit-pago');refrescarSugerenciaPrecioSit()">
        ${sitTipo==='sitting' ? `<a href="#" id="sit-pago-modo-link" onclick="toggleSitPagoModoHora();return false;" style="display:inline-block;margin-top:5px;font-size:11.5px;color:var(--ink);text-decoration:underline;cursor:pointer;">poner pago por hora</a>` : ''}
        <div id="sit-pago-hora-wrap" style="display:none;margin-top:6px;">
          <input type="number" id="sit-pago-hora" placeholder="Pago por hora, ej. 280" oninput="marcarCampoEditadoManual('sit-pago-hora');onSitPagoHoraInput()">
          <label class="chk chk-largo" id="sit-guardar-precio-wrap" style="display:none;margin:8px 0 0;"><input type="checkbox" id="sit-guardar-precio"> <span id="sit-guardar-precio-txt"></span></label>
        </div>
      </div>
    </div>
    <div id="sit-precio-sugerido"></div>
    <div id="sit-sin-tarifa-box"></div>
    <div id="sit-variantes"></div>
    <div id="sit-gastos-box" style="margin-top:12px;"></div>
    <div class="field" style="margin-top:12px;"><label>Notas</label><textarea id="sit-notas"></textarea></div>
    <div class="actions">
      <button class="btn primary" onclick="conGuardado(this, ()=>guardarSitting())">${sitEditId ? 'Guardar cambios' : 'Guardar registro'}</button>
      <div style="margin-left:auto;align-self:center;font-size:13px;color:var(--ink-soft);">Margen: <b id="sit-margen" style="color:var(--good);font-family:'IBM Plex Mono',monospace;">$0</b></div>
    </div>
    ${sitEditId ? `<div id="sit-historial-box" style="margin-top:12px;"><button type="button" class="smallbtn" onclick="verHistorialSitting(${argJs(sitEditId)})">Historial de cambios</button></div>` : ''}
  `;
}
/* Historial de cambios de un sitting (05/10/2026): quién cambió qué y cuándo. Lo escribe un
   trigger en la base (sittings_historial); acá solo se lee. Empieza a registrarse desde que se
   corre la migración, así que lo anterior no aparece. */
const HIST_CAMPOS = {
  fecha:'Fecha', tipo:'Tipo', familia_nombre:'Familia', ninera_nombre:'Niñera', hora_inicio:'Hora inicio', hora_fin:'Hora fin',
  termina_dia_siguiente:'Termina al día siguiente', cobro_familia:'Cobro', pago_ninera:'Pago a la niñera', cobrado:'Cobrado',
  pagado:'Pagado', cancelado:'Cancelado', notas:'Notas', km:'Km', origen:'Origen', destino:'Destino', registrado_por:'Registró',
};
function valorHistorial(v){
  if(v===null || v===undefined || v==='') return '—';
  if(v===true) return 'Sí';
  if(v===false) return 'No';
  return escaparHtml(v);
}
async function verHistorialSitting(id){
  const box = document.getElementById('sit-historial-box');
  if(!box) return;
  box.innerHTML = '<div class="empty"><span class="spinner dark"></span> Cargando historial…</div>';
  const { data, error } = await sb.from('sittings_historial').select('*').eq('sitting_id', id).order('cuando', {ascending:false});
  if(!document.getElementById('sit-historial-box')) return;
  if(error){
    const sinTabla = error.code==='PGRST205' || error.code==='42P01' || /sittings_historial/.test(error.message||'');
    box.innerHTML = `<div class="helper">${sinTabla ? 'El historial de cambios todavía no está activado en la base.' : 'No se pudo cargar el historial: '+escaparHtml(error.message)}</div>`;
    return;
  }
  if(!data || !data.length){ box.innerHTML = '<div class="helper">Sin cambios registrados desde que se activó el historial.</div>'; return; }
  box.innerHTML = '<div class="card-section-title">Historial de cambios</div>' + data.map(h=>{
    const cuando = new Date(h.cuando).toLocaleString('es-UY',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
    let detalle = '';
    if(h.accion==='alta') detalle = 'Creó el registro.';
    else if(h.accion==='baja') detalle = 'Borró el registro.';
    else detalle = Object.entries(h.cambios||{}).filter(([k])=>HIST_CAMPOS[k])
      .map(([k,c])=>`${HIST_CAMPOS[k]}: ${valorHistorial(c.antes)} → ${valorHistorial(c.despues)}`).join('<br>') || 'Cambios internos (vínculos).';
    return `<div class="agendarow" style="border-bottom:1px solid var(--line);align-items:flex-start;">
      <div><div style="font-weight:600;">${escaparHtml(h.usuario||'(sin usuario)')}</div><div class="helper" style="margin:2px 0 0;">${cuando}</div></div>
      <div style="font-size:13px;text-align:right;">${detalle}</div>
    </div>`;
  }).join('');
}
function sitCamposTipoHTML(){
  if(sitTipo==='sitting'){
    return `<div class="grid3">
      <div class="field"><label>Fecha</label><input type="date" id="sit-fecha" value="${todayISO()}" onchange="onSitFechaChange()"></div>
      <div class="field"><label>Hora inicio</label>${selectHora('sit-horaini')}</div>
      <div class="field" id="sit-horafin-wrap"><label>Hora fin</label>${selectHora('sit-horafin')}</div>
    </div>
    <label class="chk" style="margin:-4px 0 10px;"><input type="checkbox" id="sit-cruza-medianoche" onchange="actualizarCobroPagoPorHorario()"> Termina al día siguiente</label>
    <div class="helper" id="sit-fin-cobro" style="margin:-4px 0 10px;"></div>`;
  }
  return `<div class="grid3">
      <div class="field"><label>Fecha</label><input type="date" id="sit-fecha" value="${todayISO()}"></div>
      <div class="field"><label>Hora</label>${selectHora('sit-hora')}</div>
      <div class="field"><label>Km recorridos</label><input type="number" step="0.1" id="sit-km" oninput="actualizarPrecioSugeridoTraslado()"></div>
    </div>
    <div class="grid2" style="margin-top:6px;">
      <div class="field" style="position:relative;">
        <label>Origen</label>
        <input type="text" id="sit-origen" autocomplete="off">
        <div id="sit-origen-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
      </div>
      <div class="field" style="position:relative;">
        <label>Destino</label>
        <input type="text" id="sit-destino" autocomplete="off">
        <div id="sit-destino-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
      </div>
    </div>
    <div class="addrhint" id="sit-addr-hint" style="display:none;"></div>
    <div class="helper" id="sit-km-links" style="margin:6px 0 4px;">Elegí origen y destino de la lista para que el km se calcule solo. <a href="#" onclick="calcularRutaAutomatica();return false;">Recalcular</a> · <a href="#" onclick="verRutaMaps();return false;">ver en Google Maps</a></div>
    <div class="helper" id="sit-km-estado" style="margin:0 0 14px;min-height:15px;"></div>
    <div class="preciosugerido" id="sit-precio-sugerido-box" style="margin-bottom:16px;"></div>`;
}
function wireSitAutocompletes(){
  attachAutocomplete('sit-familia', 'sit-familia-dropdown', ()=>sitFamilias, ()=>onSitFamiliaInput());
  attachAutocomplete('sit-ninera', 'sit-ninera-dropdown', ()=>sitNinieras, ()=>onSitNineraInput());
  if(sitTipo==='traslado'){
    attachAddressAutocomplete('sit-origen', 'sit-origen-dropdown', (pos)=>{ sitOrigenAuto=false; sitOrigenCoord = pos; if(sitDestinoCoord) autoCalcularKmDesdeCoords(); });
    attachAddressAutocomplete('sit-destino', 'sit-destino-dropdown', (pos)=>{ sitDestinoCoord = pos; if(sitOrigenCoord) autoCalcularKmDesdeCoords(); });
  }
}
async function abrirModalSitForm(id=null){
  let r = id ? sitItems.find(x=>x.id===id) : null;
  // 06/10/2026: sitItems tiene solo el mes de la lista. El historial, "Ver ese sitting" y la
  // Agenda abren registros de otros meses: el formulario se abría vacío (con la fecha de
  // hoy) pero apuntando a ese registro, y al guardarlo se pisaba el registro viejo con lo
  // que se escribiera. Ahora, si no está en la lista, se trae de la base.
  if(id && !r){
    const { data, error } = await sb.from('sittings_traslados').select('*').eq('id', id).maybeSingle();
    if(error || !data){ toast('No se pudo abrir ese registro'+(error ? ': '+error.message : ': ya no existe.'), 'bad'); return; }
    r = data;
  }
  sitEditId = id;
  sitPrecioMotivo = r?.precio_motivo || '';
  sitTeniaVariantes = !!r?.precio_variantes;
  sitEsRegistroConocido = !!r || !!sitPrefill; // nuevo en blanco -> no corresponde "no hubo servicio"
  sitPagoModoHora = false;
  sitAsignacionId = (!r && sitPrefill?.asignacionId) || null;
  sitAsignacionVariantes = r?.asignacion_id || sitAsignacionId;
  sitTipo = r ? r.tipo : (sitPrefill?.tipo==='traslado' ? 'traslado' : 'sitting');
  sitFamiliaSel = r ? (sitFamilias.find(f=>f.id===r.familia_id) || findFamilia(r.familia_nombre)) : (sitPrefill ? findFamilia(sitPrefill.familiaNombre||'') : null);
  sitNineraSel = r ? (sitNinieras.find(n=>n.id===r.ninera_id) || findNinera(r.ninera_nombre)) : null;
  // Precio por niñera (01/11/2026): antes de abrir, los precios de esa familia y el precio propio del
  // fijo, así el pago sale con el de esa niñera y un registro hecho con ese precio no se toma como
  // puesto a mano. Un registro nuevo en blanco no espera nada (todavía no tiene familia).
  sitPagoFijo = (!r && sitPrefill?.fijo) || null;
  sitPrecios = { familiaId: null, filas: null }; // cada vez que se abre se leen de nuevo (otra admin pudo cambiarlos)
  sitPagoHoraUsado = null;
  if(sitTipo==='sitting' && (r || sitPrefill)){
    const [, fijo] = await Promise.all([
      cargarPreciosSit() || Promise.resolve(),
      r?.asignacion_id ? sb.from('asignaciones').select('ninera_id,ninera_nombre,pago_hora').eq('id', r.asignacion_id).maybeSingle() : null,
    ]);
    if(fijo?.data) sitPagoFijo = fijo.data;
    sitPagoHoraUsado = familiaConPagoSit()?.pago_hora ?? null; // tocar la niñera recalcula solo si cambia este
  }
  sitOrigenAuto = !r;
  sitOrigenCoord = null; sitDestinoCoord = null;
  abrirModal(sitFormHTML());
  pintarGastosExtraForm(id, r);
  setTimeout(()=>{
    const campos = document.getElementById('sit-camposTipo');
    if(campos) campos.innerHTML = sitCamposTipoHTML();
    wireSitAutocompletes();
    if(r){
      document.getElementById('sit-familia').value = r.familia_nombre || '';
      document.getElementById('sit-ninera').value = r.ninera_nombre || '';
      document.getElementById('sit-registro').value = r.registrado_por || registradoPorUsuario();
      document.getElementById('sit-fecha').value = r.fecha || '';
      // Con variantes de precio, los campos muestran la base (sin las variantes): se vuelven a
      // aplicar al guardar (23/10/2026).
      const baseV = r.precio_variantes?.base;
      const cobroBase = baseV ? baseV.cobro : r.cobro_familia, pagoBase = baseV ? baseV.pago : r.pago_ninera;
      document.getElementById('sit-cobro').value = cobroBase || 0;
      document.getElementById('sit-pago').value = pagoBase || 0;
      // Lo que no es horas × tarifa se puso a mano: no se pisa si se toca el horario (aparece el
      // calculado para usarlo con un toque). Si coincide, cambiar la hora lo sigue recalculando.
      // Un traslado guardado nunca se pisa con el sugerido por km (actualizarPrecioSugeridoTraslado).
      const calc = r.tipo==='sitting' ? precioSegunHorario(familiaConPagoSit(), r.hora_inicio, r.hora_fin, !!r.termina_dia_siguiente, r.fecha) : {};
      [['sit-cobro', cobroBase, calc.cobro], ['sit-pago', pagoBase, calc.pago]].forEach(([campo, guardado, calculado])=>{
        if(r.tipo!=='sitting' || (Number(guardado) && Number(guardado)!==calculado)) document.getElementById(campo).dataset.tocadoManual = '1';
      });
      document.getElementById('sit-cancelado').checked = !!r.cancelado;
      if(r.cancelado) onSitCanceladoChange();
      document.getElementById('sit-notas').value = r.notas || '';
      if(r.tipo==='sitting'){
        setHoraSelect('sit-horaini', r.hora_inicio);
        setHoraSelect('sit-horafin', r.hora_fin);
        const chk = document.getElementById('sit-cruza-medianoche');
        if(chk) chk.checked = !!r.termina_dia_siguiente;
        pintarFinCobroSit(); // solo el aviso: el cobro guardado no se recalcula al abrir
      } else {
        setHoraSelect('sit-hora', r.hora_inicio);
        document.getElementById('sit-km').value = r.km || '';
        document.getElementById('sit-origen').value = r.origen || '';
        document.getElementById('sit-destino').value = r.destino || '';
        actualizarPrecioSugeridoTraslado();
      }
    } else if(sitPrefill){
      document.getElementById('sit-familia').value = sitPrefill.familiaNombre || '';
      sitFamiliaSel = findFamilia(sitPrefill.familiaNombre||'');
      document.getElementById('sit-fecha').value = sitPrefill.fecha || todayISO();
      if(sitPrefill.nineraNombre){
        document.getElementById('sit-ninera').value = sitPrefill.nineraNombre;
        sitNineraSel = findNinera(sitPrefill.nineraNombre);
      }
      if(sitTipo==='traslado'){
        if(sitPrefill.horaInicio) setHoraSelect('sit-hora', sitPrefill.horaInicio);
      } else {
        if(sitPrefill.horaInicio) setHoraSelect('sit-horaini', sitPrefill.horaInicio);
        if(sitPrefill.horaFin) setHoraSelect('sit-horafin', sitPrefill.horaFin);
      }
      if(sitPrefill.notas) document.getElementById('sit-notas').value = sitPrefill.notas;
      onSitFamiliaInput(); // ya calcula cobro/pago solo si la familia tiene tarifa y el horario está cargado
      // Traslado de un fijo: su precio, como en la Agenda. Queda marcado como puesto a mano
      // para que los km no lo cambien por el precio sugerido.
      if(sitTipo==='traslado' && sitPrefill.cobro!=null && sitPrefill.pago!=null){
        const cobroEl = document.getElementById('sit-cobro'), pagoEl = document.getElementById('sit-pago');
        cobroEl.value = Number(sitPrefill.cobro)||0; cobroEl.dataset.tocadoManual = '1';
        pagoEl.value = Number(sitPrefill.pago)||0; pagoEl.dataset.tocadoManual = '1';
        const box = document.getElementById('sit-precio-sugerido-box');
        if(box) box.innerHTML = '<div class="helper" style="margin:0;">Precio del fijo.</div>';
      }
      sitPrefill = null;
    }
    refrescarVariantesSit(r ? (r.precio_variantes?.aplicadas || []) : []);
    calcSitMargen();
    refrescarSugerenciaPrecioSit(); // un registro con precio a mano muestra su motivo al abrir
    // Después de precargar (lo precargado no cuenta como cambio): borrador y aviso antes de
    // cerrar con cambios (21/10/2026).
    protegerModal('sitting:'+(id || 'nuevo'));
  }, 20);
}
function setSitTipo(t){
  // Los campos de cada tipo se vuelven a dibujar: la fecha y la hora de inicio que ya se
  // eligieron se conservan. Antes volvían a hoy sin avisar y un traslado del 28/09 quedó
  // guardado con la fecha del día en que se cargó (04/10/2026, "no dejaba elegir el día").
  const fechaElegida = document.getElementById('sit-fecha')?.value || '';
  const horaElegida = sitTipo==='sitting' ? leerHora('sit-horaini') : leerHora('sit-hora');
  sitTipo = t;
  sitPagoModoHora = false;
  const bS = document.getElementById('sit-tipo-sitting'), bT = document.getElementById('sit-tipo-traslado');
  if(bS) bS.classList.toggle('selected', t==='sitting');
  if(bT) bT.classList.toggle('selected', t==='traslado');
  sitOrigenAuto = true;
  sitOrigenCoord = null; sitDestinoCoord = null;
  document.getElementById('sit-camposTipo').innerHTML = sitCamposTipoHTML();
  if(fechaElegida) document.getElementById('sit-fecha').value = fechaElegida;
  refrescarVariantesSit(); // las variantes dependen de si es sitting o traslado
  if(horaElegida) setHoraSelect(t==='sitting' ? 'sit-horaini' : 'sit-hora', horaElegida);
  wireSitAutocompletes();
  if(t==='traslado') aplicarDireccionSugerida();
  actualizarPrecioSugeridoTraslado();
  calcSitMargen();
  pintarGuardarPrecioSit();
}

/* ---- crear familia/niñera al vuelo ---- */
function onSitFamiliaInput(){
  const val = document.getElementById('sit-familia').value.trim();
  sitFamiliaSel = findFamilia(val);
  if(!val || sitFamiliaSel) cerrarFamiliaNuevaSit(); // eligió una que ya existe: la ficha nueva sobra
  pintarCrearFamiliaSit();
  sitOrigenAuto = true;
  if(sitTipo==='traslado') aplicarDireccionSugerida();
  actualizarCobroPagoPorHorario();
  refrescarVariantesSit();
  // Con otra familia se leen sus precios por niñera y, cuando llegan, se vuelve a calcular.
  const fid = sitFamiliaSel?.id || null;
  cargarPreciosSit()?.then(()=>{ if(fid && sitFamiliaSel?.id===fid && document.getElementById('sit-cobro')) recalcularPorNineraSit(); });
}
/* ---- precio por niñera (01/11/2026) ---- */
// Lee los precios de la familia elegida una sola vez por familia. Devuelve la promesa si empezó una
// lectura nueva, o null si ya estaban (o no hay familia).
function cargarPreciosSit(){
  const fid = sitFamiliaSel?.id || null;
  if(sitPrecios.familiaId===fid) return null;
  const carga = { familiaId: fid, filas: null };
  sitPrecios = carga;
  if(!fid) return null;
  return leerPreciosNinera(fid).then(filas=>{ carga.filas = filas; });
}
function preciosDeFamiliaSit(){ return (sitFamiliaSel && sitPrecios.familiaId===sitFamiliaSel.id && sitPrecios.filas) || []; }
// La familia con el pago por hora de la niñera elegida (precioHoraNinera: el del fijo con su niñera, el
// de la niñera con esa familia o la tarifa). Es lo que se le pasa a precioSegunHorario.
function familiaConPagoSit(){
  if(!sitFamiliaSel) return sitFamiliaSel;
  const nid = sitNineraSel?.id || null;
  const pagoFijo = pagoFijoDeNinera(sitPagoFijo, nid, sitNineraSel?.nombre || document.getElementById('sit-ninera')?.value || '');
  return { ...sitFamiliaSel, pago_hora: precioHoraNinera(sitFamiliaSel, nid, preciosDeFamiliaSit(), pagoFijo) };
}
// Cambiar la niñera (o que lleguen los precios) recalcula como cambiar la hora, pero solo si cambia el
// pago por hora: un registro con precio a mano no pregunta nada si el pago sigue igual.
function recalcularPorNineraSit(){
  const pagoH = familiaConPagoSit()?.pago_hora ?? null;
  if(pagoH!==sitPagoHoraUsado){
    const horaInput = document.getElementById('sit-pago-hora');
    if(sitPagoModoHora && horaInput && !horaInput.dataset.tocadoManual) horaInput.value = pagoH ?? '';
    actualizarCobroPagoPorHorario();
  }
  pintarGuardarPrecioSit();
}
// "Guardar como precio de [niñera] con esta familia" (respuesta 3 de Diego, 31/10/2026): aparece al
// tipear a mano otro pago por hora para la niñera elegida. Tildada solo si esa niñera no tiene precio
// con esa familia; si ya tiene, destildada (un precio especial de un día no pisa el guardado). Con la
// familia sin tarifa no aparece: ese pago por hora se guarda como tarifa de la familia (guardarSitting).
function pintarGuardarPrecioSit(){
  const wrap = document.getElementById('sit-guardar-precio-wrap'), chk = document.getElementById('sit-guardar-precio');
  if(!wrap || !chk) return;
  const horaInput = document.getElementById('sit-pago-hora');
  const valor = Number(horaInput?.value)||0;
  const nid = sitNineraSel?.id || null;
  // Sin los precios leídos no se sabe si ya tiene uno: no se ofrece (no se pisa uno guardado).
  const leidos = sitPrecios.familiaId===sitFamiliaSel?.id && Array.isArray(sitPrecios.filas);
  const mostrar = preciosNineraDisponible && leidos && sitPagoModoHora && sitTipo==='sitting' && !!nid && !!sitFamiliaSel?.id
    && Number(sitFamiliaSel.pago_hora)>0 && !!horaInput?.dataset.tocadoManual && valor>0
    && valor!==familiaConPagoSit().pago_hora && !document.getElementById('sit-cancelado')?.checked;
  if(!mostrar){ wrap.style.display = 'none'; return; }
  const clave = sitFamiliaSel.id+'|'+nid;
  if(chk.dataset.par!==clave){ chk.checked = !preciosDeFamiliaSit().some(p=>p.ninera_id===nid); chk.dataset.par = clave; }
  document.getElementById('sit-guardar-precio-txt').textContent = `Guardar como precio de ${sitNineraSel.nombre} con esta familia`;
  wrap.style.display = '';
}
// Lo que hay que guardar al registrar, o null.
function precioNineraAGuardarSit(){
  const wrap = document.getElementById('sit-guardar-precio-wrap');
  if(!wrap || wrap.style.display==='none' || !document.getElementById('sit-guardar-precio')?.checked) return null;
  return { familiaId: sitFamiliaSel.id, nineraId: sitNineraSel.id, nineraNombre: sitNineraSel.nombre,
    pagoHora: Number(document.getElementById('sit-pago-hora').value),
    nueva: !preciosDeFamiliaSit().some(p=>p.ninera_id===sitNineraSel.id) };
}
// Los botones de variantes de esta familia y el ajuste libre (familias.js). La base es lo que
// dicen los campos de cobro y pago; lo que se guarda, eso con las variantes (23/10/2026).
function refrescarVariantesSit(aplicadas=null){
  return prepararVariantesPrecio('sit', { familiaId: sitFamiliaSel?.id || null, tipo: sitTipo, asignacionId: sitAsignacionVariantes, aplicadas,
    base: ()=>({ cobro: redondearCobro(document.getElementById('sit-cobro')?.value), pago: redondearPago(document.getElementById('sit-pago')?.value) }),
    alCambiar: pintarMargenSit });
}
function onSitNineraInput(){
  const val = document.getElementById('sit-ninera').value.trim();
  sitNineraSel = findNinera(val);
  const box = document.getElementById('sit-ninera-create');
  box.innerHTML = (val && !sitNineraSel) ? `<button type="button" class="createbtn" onclick="conGuardado(this, ()=>crearNineraRapida())">+ Crear niñera "${escaparHtml(val)}"</button>` : '';
  recalcularPorNineraSit(); // cada niñera puede tener su precio con esta familia (01/11/2026)
}
/* Madre nueva desde el registro (21/10/2026): la ficha de la familia se completa acá mismo,
   dentro del formulario del sitting. Otro modal reemplazaría a este y se perdería lo cargado
   (fecha, horario, niñera, notas). Hijos, cuentas y notas se agregan después desde Familias. */
function pintarCrearFamiliaSit(){
  const box = document.getElementById('sit-familia-create');
  if(!box) return;
  const val = document.getElementById('sit-familia').value.trim();
  const fichaAbierta = !!document.getElementById('sitfam-telefono');
  box.innerHTML = (val && !sitFamiliaSel && !fichaAbierta) ? `<button type="button" class="createbtn" onclick="abrirFamiliaNuevaSit()">+ Familia nueva "${escaparHtml(val)}"</button>` : '';
}
async function abrirFamiliaNuevaSit(){
  const panel = document.getElementById('sit-familia-nueva');
  if(!panel) return;
  if(!zonaGruposCache) await cargarZonaGrupos(); // con las zonas ya cargadas el selector no se vuelve a pintar solo
  panel.innerHTML = `<div class="sitfam-ficha" style="border:1px solid var(--line);border-radius:10px;padding:12px;margin:0 0 14px;background:var(--bg);">
    <div style="font-weight:700;margin-bottom:2px;">Familia nueva</div>
    <div class="helper" style="margin:0 0 10px;">Con el nombre de arriba. Hijos, cuentas y notas, después desde Familias.</div>
    <div class="grid2">
      <div class="field"><label>Teléfono</label><input type="tel" id="sitfam-telefono"></div>
      <div class="field"><label>Dirección</label><input type="text" id="sitfam-direccion" placeholder="Para sugerir origen en traslados"></div>
    </div>
    ${checklistZonas('sitfam', '', 'Zona')}
    <div class="grid2">
      <div class="field"><label>Cobro a familia ($/h)</label><input type="number" id="sitfam-cobro"></div>
      <div class="field"><label>Pago a niñera ($/h)</label><input type="number" id="sitfam-pago"></div>
    </div>
    ${baseTieneTerminos() ? `<label class="chk" style="margin:0 0 8px;"><input type="checkbox" id="sitfam-terminos" onchange="onSitfamTerminosChange()"> Aceptó términos y condiciones</label>
    <div class="field" id="sitfam-terminos-fecha-wrap" style="display:none;"><label>Fecha en que los aceptó</label><input type="date" id="sitfam-terminos-fecha" value="${todayISO()}"></div>` : ''}
    <div id="sitfam-warn"></div>
    <div class="confirmbtns">
      <button type="button" class="btn ghost" onclick="cerrarFamiliaNuevaSit()">Cancelar</button>
      <button type="button" class="btn primary" onclick="conGuardado(this, ()=>crearFamiliaDesdeSit())">Crear familia</button>
    </div>
  </div>`;
  // "Editar zonas" abre su propio modal en lugar de este: acá no se ofrece.
  panel.querySelector('.zona-detalle')?.remove();
  const sugerencias = document.getElementById('sit-familia-dropdown'); // "Sin coincidencias" quedaba encima de la ficha
  if(sugerencias) sugerencias.style.display = 'none';
  pintarCrearFamiliaSit();
  document.getElementById('sitfam-telefono').focus();
}
function cerrarFamiliaNuevaSit(){
  const panel = document.getElementById('sit-familia-nueva');
  if(!panel || !panel.innerHTML) return;
  panel.innerHTML = '';
  pintarCrearFamiliaSit();
}
function onSitfamTerminosChange(){
  document.getElementById('sitfam-terminos-fecha-wrap').style.display = document.getElementById('sitfam-terminos').checked ? '' : 'none';
}
async function crearFamiliaDesdeSit(){
  const nombre = document.getElementById('sit-familia').value.trim();
  const warn = document.getElementById('sitfam-warn');
  const aviso = txt => { warn.innerHTML = `<div class="warnbox">${escaparHtml(txt)}</div>`; };
  if(!nombre){ aviso('Escribí el nombre de la familia arriba, en "Familia".'); return; }
  const aceptoTerminos = !!document.getElementById('sitfam-terminos')?.checked;
  const terminosDesde = aceptoTerminos ? document.getElementById('sitfam-terminos-fecha').value : null;
  if(aceptoTerminos && !terminosDesde){ aviso('Poné la fecha en que aceptó los términos.'); return; }
  if(!(await confirmarNombreNuevo(nombre, sitFamilias, 'familia'))) return;
  const valor = id => document.getElementById(id).value.trim();
  const fam = { nombre, telefono: valor('sitfam-telefono'), direccion: valor('sitfam-direccion'), zona: leerZonasChecklist('sitfam'),
    cobro_hora: Number(valor('sitfam-cobro'))||null, pago_hora: Number(valor('sitfam-pago'))||null };
  if(aceptoTerminos) fam.terminos_aceptados_el = terminosDesde; // sin marcar no se manda: anda con la base sin migrar
  const { data, error } = await sb.from('familias').insert(fam).select().single();
  if(error){ warn.innerHTML = errBox(error); return; }
  sitFamilias.push(data);
  sitFamiliaSel = data;
  document.getElementById('sit-familia').value = data.nombre;
  document.getElementById('sit-familia-nueva').innerHTML = '';
  document.getElementById('sit-familia-create').innerHTML = '<div style="font-size:11.5px;color:var(--good);font-weight:600;">Familia creada.</div>';
  toast('Familia creada. Hijos, cuentas y notas se agregan desde Familias.');
  // Con la tarifa y la dirección ya cargadas, el registro calcula el precio y sugiere el origen.
  sitOrigenAuto = true;
  if(sitTipo==='traslado') aplicarDireccionSugerida();
  actualizarCobroPagoPorHorario();
}
async function crearNineraRapida(){
  const val = document.getElementById('sit-ninera').value.trim();
  if(!val) return;
  const { data, error } = await sb.from('ninieras').insert({nombre:val, activa:true}).select().single();
  if(error){ toast('No se pudo crear la niñera: '+error.message, 'bad'); return; }
  sitNinieras.push(data);
  sitNineraSel = data;
  document.getElementById('sit-ninera-create').innerHTML = '<div style="font-size:11.5px;color:var(--good);font-weight:600;">Niñera creada.</div>';
  toast('Niñera creada — le podés agregar zona y teléfono después desde Niñeras.');
}

/* ---- dirección sugerida para traslados ---- */
function aplicarDireccionSugerida(){
  const hint = document.getElementById('sit-addr-hint');
  const origenInput = document.getElementById('sit-origen');
  if(!hint || !origenInput) return;
  if(sitFamiliaSel && sitFamiliaSel.direccion && sitOrigenAuto){
    origenInput.value = sitFamiliaSel.direccion;
    hint.textContent = `Dirección sugerida desde la ficha de ${sitFamiliaSel.nombre} — la podés editar si el traslado arranca en otro lado.`;
    hint.style.display = 'block';
  } else {
    hint.style.display = 'none';
  }
}
function verRutaMaps(){
  const o = (document.getElementById('sit-origen')||{}).value?.trim();
  const d = (document.getElementById('sit-destino')||{}).value?.trim();
  if(!o || !d){ toast('Cargá origen y destino primero.', 'bad'); return; }
  window.open('https://www.google.com/maps/dir/'+encodeURIComponent(o)+'/'+encodeURIComponent(d), '_blank');
}

/* ---- km automático (TomTom) y precio sugerido de traslado ---- */
// Clave restringida desde el panel de TomTom a los dominios de la app (parentsbreak.github.io desde la
// mudanza del 27/10/2026, y diegomarin28.github.io hasta que se saque): segura para vivir en el código público.
const TOMTOM_KEY = 'upPsudbTEF2vqk2AgE7VftlFkI1c7PHt';
let tarifaTrasladoConfig = null;
async function cargarTarifaTrasladoConfig(){
  const { data } = await sb.from('tarifas_traslado_config').select('*').limit(1).maybeSingle();
  tarifaTrasladoConfig = data || null;
}
async function geocodeTomTom(direccion){
  if(!direccion) return null;
  const url = `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(direccion)}.json?key=${TOMTOM_KEY}&countrySet=UY&limit=1&geobias=point:-34.9011,-56.1645`;
  const res = await fetch(url);
  if(res.ok){
    const data = await res.json();
    const r = data.results && data.results[0];
    if(r) return { lat:r.position.lat, lon:r.position.lon };
  }
  // TomTom no la encontró — probamos OpenStreetMap antes de rendirnos.
  try{
    const urlOsm = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(direccion+', Uruguay')}&format=json&countrycodes=uy&limit=1`;
    const resOsm = await fetch(urlOsm);
    if(!resOsm.ok) return null;
    const dataOsm = await resOsm.json();
    const r0 = dataOsm[0];
    if(!r0) return null;
    return { lat:Number(r0.lat), lon:Number(r0.lon) };
  }catch(e){ return null; }
}
async function rutaKmTomTom(o, d){
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${o.lat},${o.lon}:${d.lat},${d.lon}/json?key=${TOMTOM_KEY}`;
  const res = await fetch(url);
  if(!res.ok) return null;
  const data = await res.json();
  const metros = data.routes && data.routes[0] && data.routes[0].summary && data.routes[0].summary.lengthInMeters;
  if(metros==null) return null;
  return Math.round((metros/1000)*10)/10;
}

/* ---- autocomplete propio reusable (familia, niñera) ---- */
/* ============================================================
   D3 · Bitácora de incidentes — accidentes, quejas de familias, u
   otros hechos puntuales. Se puede cargar desde un sitting puntual
   (con niñera/familia/fecha ya cargados), desde la ficha de una
   niñera, o suelto con el botón "+ Registrar incidente" de acá — las
   tres puertas abren el mismo formulario.
   ============================================================ */
let incidentesItems = [];
let incAbierto = false;
let incMostrar = 10;
let incNineraSel = null, incFamiliaSel = null;
function abrirModalIncidente(prefill){
  prefill = prefill || {};
  incNineraSel = prefill.ninera_id ? {id: prefill.ninera_id, nombre: prefill.ninera_nombre} : null;
  incFamiliaSel = prefill.familia_id ? {id: prefill.familia_id, nombre: prefill.familia_nombre} : null;
  const html = `
    <h2>Registrar incidente</h2>
    <div class="grid2">
      <div class="field"><label>Fecha</label><input type="date" id="inc-fecha" value="${escaparHtml(prefill.fecha||todayISO())}"></div>
      <div class="field"><label>Tipo</label><select id="inc-tipo">
        <option value="accidente">Accidente</option>
        <option value="queja">Queja de familia</option>
        <option value="otro" selected>Otro</option>
      </select></div>
    </div>
    <div class="field"><label>Gravedad</label><select id="inc-gravedad">
      <option value="leve" selected>Leve</option>
      <option value="moderado">Moderado</option>
      <option value="grave">Grave</option>
    </select></div>
    <div class="grid2">
      <div class="field" style="position:relative;"><label>Niñera (opcional)</label>
        <input type="text" id="inc-ninera" autocomplete="off" value="${escaparHtml(prefill.ninera_nombre)}">
        <div id="inc-ninera-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
      </div>
      <div class="field" style="position:relative;"><label>Familia (opcional)</label>
        <input type="text" id="inc-familia" autocomplete="off" value="${escaparHtml(prefill.familia_nombre)}">
        <div id="inc-familia-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
      </div>
    </div>
    <div class="field"><label>Descripción</label><textarea id="inc-descripcion" rows="4" placeholder="Qué pasó, cuándo se enteraron, cómo se resolvió…"></textarea></div>
    <div id="inc-warn"></div>
    <button class="btn primary" style="width:100%;" onclick="conGuardado(this, ()=>guardarIncidente(${argJs(prefill.sitting_id||'')}))">Guardar incidente</button>
  `;
  abrirModal(html);
  setTimeout(()=>{
    attachAutocomplete('inc-ninera', 'inc-ninera-dropdown', ()=>sitNinieras, (o)=>{ incNineraSel = o; });
    attachAutocomplete('inc-familia', 'inc-familia-dropdown', ()=>sitFamilias, (o)=>{ incFamiliaSel = o; });
  }, 20);
}
async function guardarIncidente(sittingId){
  const fecha = document.getElementById('inc-fecha').value;
  const tipo = document.getElementById('inc-tipo').value;
  const gravedad = document.getElementById('inc-gravedad').value;
  const nineraTxt = document.getElementById('inc-ninera').value.trim();
  const familiaTxt = document.getElementById('inc-familia').value.trim();
  const descripcion = document.getElementById('inc-descripcion').value.trim();
  const warn = document.getElementById('inc-warn');
  if(!fecha || !descripcion){ warn.innerHTML = '<div class="warnbox">Completá al menos la fecha y la descripción.</div>'; return; }
  const { error } = await sb.from('incidentes').insert({
    fecha, tipo, gravedad,
    ninera_id: (incNineraSel && normaliza(incNineraSel.nombre)===normaliza(nineraTxt)) ? incNineraSel.id : null,
    ninera_nombre: nineraTxt || null,
    familia_id: (incFamiliaSel && normaliza(incFamiliaSel.nombre)===normaliza(familiaTxt)) ? incFamiliaSel.id : null,
    familia_nombre: familiaTxt || null,
    sitting_id: sittingId || null,
    descripcion,
    registrado_por: registradoPorUsuario(),
  });
  if(error){ warn.innerHTML = errBox(error); return; }
  cerrarModal();
  toast('Incidente registrado.');
  cargarIncidentes();
}
async function cargarIncidentes(){
  const { data, error } = await sb.from('incidentes').select('*').order('fecha', {ascending:false}).order('created_at', {ascending:false});
  if(error || !document.getElementById('incidentes-wrap')) return;
  incidentesItems = data || [];
  renderIncidentes();
}
function toggleIncidentes(){ incAbierto = !incAbierto; renderIncidentes(); }
function renderIncidentes(){
  const wrap = document.getElementById('incidentes-wrap');
  if(!wrap) return;
  wrap.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div style="cursor:pointer;flex:1;" onclick="toggleIncidentes()">
          <h2 style="margin:0;">Incidentes</h2>
          <div class="helper" style="margin:2px 0 0;">${incidentesItems.length} registrado${incidentesItems.length===1?'':'s'} · ${incAbierto?'tocá para cerrar':'tocá para ver'}</div>
        </div>
        <button class="smallbtn" onclick="abrirModalIncidente({})">+ Registrar incidente</button>
      </div>
      ${incAbierto ? renderIncidentesLista() : ''}
    </div>`;
}
function renderIncidentesLista(){
  if(!incidentesItems.length) return '<div class="empty" style="margin-top:12px;">No hay incidentes registrados.</div>';
  const mostrarTope = Math.min(incMostrar, incidentesItems.length);
  const items = incidentesItems.slice(0, mostrarTope);
  const hayMas = mostrarTope < incidentesItems.length;
  const gravedadClase = g => g==='grave' ? 'bad' : g==='moderado' ? 'warn' : 'good';
  return `
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:2px;">
      ${items.map(i=>{
        const fechaFmt = new Date(i.fecha+'T00:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'short',year:'numeric'});
        const quienes = [i.ninera_nombre, i.familia_nombre].filter(Boolean).join(' · ');
        return `
        <div class="agendarow" style="border-bottom:1px solid var(--line);align-items:flex-start;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="font-weight:700;">${fechaFmt}${quienes?escaparHtml(' — '+quienes):''}</div>
            <div class="helper" style="margin:2px 0 4px;">${escaparHtml(i.descripcion)}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
            <span class="badge ${i.tipo==='accidente'?'bad':i.tipo==='queja'?'warn':'brand'}" style="font-size:10.5px;">${i.tipo==='accidente'?'Accidente':i.tipo==='queja'?'Queja':'Otro'}</span>
            <span class="badge ${gravedadClase(i.gravedad)}" style="font-size:10.5px;">${escaparHtml(i.gravedad)}</span>
            <button class="smallbtn danger" onclick="conGuardado(this, ()=>eliminarIncidente(${argJs(i.id)}))">Eliminar</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    ${hayMas ? `<button class="smallbtn" style="margin-top:10px;" onclick="incMostrar+=10;renderIncidentes();">Mostrar más</button>` : ''}
  `;
}
async function eliminarIncidente(id){
  const ok = await confirmarAccion('¿Eliminar este incidente? No se puede deshacer.');
  if(!ok) return;
  const { error } = await sb.from('incidentes').delete().eq('id', id);
  if(error){ toast('No se pudo eliminar: '+error.message, 'bad'); return; }
  toast('Incidente eliminado.');
  cargarIncidentes();
}
/* Mini-listado embebido en la ficha de una niñera o una familia — independiente
   del panel general de arriba. Busca por id Y por nombre normalizado, para que
   también aparezcan los incidentes cargados antes de que existiera el vínculo
   por id (o si se escribió el nombre a mano sin elegir de la lista). */
async function renderIncidentesEnFicha(containerId, tipo, id, nombre){
  const cont = document.getElementById(containerId);
  if(!cont) return;
  const { data } = await sb.from('incidentes').select('*').order('fecha', {ascending:false});
  const key = normaliza(nombre||'');
  const propios = (data||[]).filter(i=>{
    if(tipo==='ninera') return (id && i.ninera_id===id) || (key && normaliza(i.ninera_nombre||'')===key);
    return (id && i.familia_id===id) || (key && normaliza(i.familia_nombre||'')===key);
  });
  if(!document.getElementById(containerId)) return; // se pudo haber cerrado el modal mientras esperábamos
  if(!propios.length){
    cont.innerHTML = `<div class="helper" style="margin:6px 0;">Incidentes: ninguno registrado.</div>`;
    return;
  }
  cont.innerHTML = `
    <h2 class="card-section-title" style="margin-top:0;">Incidentes (${propios.length})</h2>
    ${propios.map(i=>{
      const fechaFmt = new Date(i.fecha+'T00:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'short',year:'numeric'});
      const otro = tipo==='ninera' ? i.familia_nombre : i.ninera_nombre;
      return `
      <div class="agendarow" style="border-bottom:1px solid var(--line);align-items:flex-start;flex-wrap:wrap;">
        <div style="flex:1;min-width:180px;">
          <div style="font-weight:700;">${fechaFmt}${otro?escaparHtml(' — '+otro):''}</div>
          <div class="helper" style="margin:2px 0 4px;">${escaparHtml(i.descripcion)}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
          <span class="badge ${i.tipo==='accidente'?'bad':i.tipo==='queja'?'warn':'brand'}" style="font-size:10px;">${i.tipo==='accidente'?'Accidente':i.tipo==='queja'?'Queja':'Otro'}</span>
          <span class="badge ${i.gravedad==='grave'?'bad':i.gravedad==='moderado'?'warn':'good'}" style="font-size:10px;">${escaparHtml(i.gravedad)}</span>
          <button class="smallbtn danger" onclick="conGuardado(this, ()=>eliminarIncidenteFicha(${argJs(i.id)},${argJs(containerId)},${argJs(tipo)},${argJs(id||'')},${argJs(nombre||'')}))">Eliminar</button>
        </div>
      </div>`;
    }).join('')}
  `;
}
async function eliminarIncidenteFicha(incId, containerId, tipo, id, nombre){
  const ok = await confirmarAccion('¿Eliminar este incidente? No se puede deshacer.');
  if(!ok) return;
  const { error } = await sb.from('incidentes').delete().eq('id', incId);
  if(error){ toast('No se pudo eliminar: '+error.message, 'bad'); return; }
  toast('Incidente eliminado.');
  renderIncidentesEnFicha(containerId, tipo, id||null, nombre);
  cargarIncidentes(); // por si el panel general de Sittings también está montado detrás del modal
}
// Buscador de la app (ignora tildes y mayúsculas con normaliza). Es el único que se usa: la
// lista nativa del navegador (<datalist>) no ignora tildes en el iPhone (25/10/2026).
// sinCoincidencias: el aviso cuando no hay nada; vacío, no se muestra nada (nombres libres).
function attachAutocomplete(inputId, dropdownId, getOpciones, onPick, {sinCoincidencias='Sin coincidencias — se puede cargar como nueva.'}={}){
  const input = document.getElementById(inputId);
  const dd = document.getElementById(dropdownId);
  if(!input || !dd) return;
  function render(){
    const q = normaliza(input.value.trim());
    const opciones = getOpciones() || [];
    const matches = opciones.filter(o=>!q || normaliza(o.nombre).includes(q)).slice(0,8);
    dd.innerHTML = '';
    if(!matches.length){
      const aviso = q && sinCoincidencias;
      dd.innerHTML = aviso ? `<div class="autocomplete-empty">${escaparHtml(sinCoincidencias)}</div>` : '';
      dd.style.display = aviso ? 'block' : 'none';
      return;
    }
    matches.forEach(o=>{
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = o.nombre;
      item.addEventListener('mousedown', ()=>{ input.value = o.nombre; dd.style.display = 'none'; onPick(o); });
      dd.appendChild(item);
    });
    dd.style.display = 'block';
  }
  input.addEventListener('input', ()=>{ render(); onPick(null); });
  input.addEventListener('focus', render);
  input.addEventListener('blur', ()=> setTimeout(()=>{ dd.style.display = 'none'; }, 150));
}

/* ---- autocomplete de direcciones reales con TomTom (no más "Cremona" = fábrica de pastas) ---- */
let addrDebounceTimer = null;
function attachAddressAutocomplete(inputId, dropdownId, onPick){
  const input = document.getElementById(inputId);
  const dd = document.getElementById(dropdownId);
  if(!input || !dd) return;
  async function geocodeNominatim(q){
    // Red de contención: solo se usa cuando TomTom no encuentra nada, nunca en cada tecla (respeta la política de uso de Nominatim).
    try{
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&countrycodes=uy&limit=5&addressdetails=1`;
      const res = await fetch(url);
      if(!res.ok) return [];
      const data = await res.json();
      return data.map(r=>({ lat:Number(r.lat), lon:Number(r.lon), label:r.display_name }));
    }catch(e){ return []; }
  }
  async function buscar(){
    const q = input.value.trim();
    if(q.length<3){ dd.style.display='none'; return; }
    dd.innerHTML = '<div class="autocomplete-empty">Buscando…</div>';
    dd.style.display = 'block';
    try{
      // idxSet limitado a calles/direcciones/geografías — sin comercios (POI), que era lo que traía resultados raros.
      const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${TOMTOM_KEY}&countrySet=UY&limit=6&idxSet=Str,PAD,Addr,Geo&geobias=point:-34.9011,-56.1645`;
      const res = await fetch(url);
      if(!res.ok){
        dd.innerHTML = res.status===403
          ? '<div class="autocomplete-empty">La clave de TomTom no tiene habilitada la "Search API" — hay que activarla en el panel de TomTom (Keys → esta clave → Products).</div>'
          : `<div class="autocomplete-empty">TomTom devolvió un error (${res.status}) — probá de nuevo en un rato.</div>`;
        return;
      }
      const data = await res.json();
      const results = data.results || [];
      if(!results.length){
        // TomTom no la tiene mapeada — probamos con OpenStreetMap antes de rendirnos.
        dd.innerHTML = '<div class="autocomplete-empty">Buscando en OpenStreetMap…</div>';
        const nomResults = await geocodeNominatim(q+', Uruguay');
        if(nomResults.length){
          dd.innerHTML = '';
          nomResults.forEach(r=>{
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.textContent = r.label;
            item.addEventListener('mousedown', ()=>{
              input.value = r.label;
              dd.style.display = 'none';
              onPick({ lat:r.lat, lon:r.lon });
            });
            dd.appendChild(item);
          });
          return;
        }
        dd.innerHTML = '<div class="autocomplete-empty">Sin resultados en TomTom ni OpenStreetMap — probá con más detalle o cargá el km a mano.</div>';
        return;
      }
      dd.innerHTML = '';
      results.forEach(r=>{
        const label = (r.address && r.address.freeformAddress) || q;
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.textContent = label;
        item.addEventListener('mousedown', ()=>{
          input.value = label;
          dd.style.display = 'none';
          onPick({ lat:r.position.lat, lon:r.position.lon });
        });
        dd.appendChild(item);
      });
    }catch(e){
      dd.innerHTML = '<div class="autocomplete-empty">Error buscando — probá de nuevo.</div>';
    }
  }
  input.addEventListener('input', ()=>{
    clearTimeout(addrDebounceTimer);
    addrDebounceTimer = setTimeout(buscar, 350);
  });
  input.addEventListener('blur', ()=> setTimeout(()=>{ dd.style.display='none'; }, 150));
}
async function autoCalcularKmDesdeCoords(){
  if(!sitOrigenCoord || !sitDestinoCoord) return;
  const estado = document.getElementById('sit-km-estado');
  if(estado) estado.textContent = 'Calculando ruta…';
  const km = await rutaKmTomTom(sitOrigenCoord, sitDestinoCoord);
  if(km==null){ if(estado) estado.textContent = 'No se pudo calcular la ruta — probá "Recalcular" o cargá el km a mano.'; return; }
  const kmInput = document.getElementById('sit-km');
  if(kmInput) kmInput.value = km;
  if(estado) estado.textContent = `${km} km calculados automáticamente.`;
  actualizarPrecioSugeridoTraslado();
}
async function calcularRutaAutomatica(){
  const origenTxt = (document.getElementById('sit-origen')||{}).value?.trim();
  const destinoTxt = (document.getElementById('sit-destino')||{}).value?.trim();
  const estado = document.getElementById('sit-km-estado');
  if(!origenTxt || !destinoTxt){ if(estado) estado.textContent = 'Cargá origen y destino primero.'; return; }
  if(estado) estado.textContent = 'Calculando ruta…';
  try{
    const [o, d] = await Promise.all([geocodeTomTom(origenTxt), geocodeTomTom(destinoTxt)]);
    if(!o || !d){ if(estado) estado.textContent = 'No se pudo ubicar alguna dirección — probá con más detalle (calle, número, barrio) o cargá el km a mano.'; return; }
    const km = await rutaKmTomTom(o, d);
    if(km==null){ if(estado) estado.textContent = 'No se pudo calcular la ruta — cargá el km a mano.'; return; }
    const kmInput = document.getElementById('sit-km');
    if(kmInput) kmInput.value = km;
    if(estado) estado.textContent = `${km} km calculados con el mapa.`;
    actualizarPrecioSugeridoTraslado();
  }catch(e){
    if(estado) estado.textContent = 'Error consultando el mapa — probá de nuevo o cargá el km a mano.';
  }
}
function multiplicadorHorarioTraslado(horaHHMM){
  const cfg = tarifaTrasladoConfig;
  if(!horaHHMM || !cfg) return 1;
  const min = agendaMinutos(horaHHMM);
  if(min==null) return 1;
  const enRango = (desde, hasta) => {
    if(!desde || !hasta) return false;
    const dmin = agendaMinutos(desde.slice(0,5)), hmin = agendaMinutos(hasta.slice(0,5));
    if(dmin==null || hmin==null || dmin===hmin) return false;
    if(dmin<hmin) return min>=dmin && min<hmin;
    return min>=dmin || min<hmin; // el rango cruza medianoche
  };
  if(enRango(cfg.rec1_desde, cfg.rec1_hasta)) return Number(cfg.rec1_mult)||1;
  if(enRango(cfg.rec2_desde, cfg.rec2_hasta)) return Number(cfg.rec2_mult)||1;
  return 1;
}
// Marca visualmente un campo como "esto es un precio sugerido, no definitivo" -- borde
// punteado + fondo tenue. Se saca solo apenas la persona lo toca a mano (ver
// marcarCampoEditadoManual), para que quede claro que dejó de ser el sugerido.
function marcarCampoSugerido(id){
  const el = document.getElementById(id);
  if(!el) return;
  el.style.border = '2px dashed var(--accent)';
  el.style.background = 'var(--clay-soft)';
  el.title = 'Precio sugerido — se puede editar';
}
function marcarCampoEditadoManual(id){
  const el = document.getElementById(id);
  if(!el) return;
  el.dataset.tocadoManual = '1';
  el.style.border = '';
  el.style.background = '';
  el.title = '';
}
// Redondea a un número "lindo" (terminado en 50 o en 00) -- para arriba (precio a la
// familia) o para abajo (precio a la niñera), nunca al revés.
function redondearArriba50(v){ return Math.ceil(v/50)*50; }
function redondearAbajo50(v){ return Math.floor(v/50)*50; }
function actualizarPrecioSugeridoTraslado(){
  const box = document.getElementById('sit-precio-sugerido-box');
  if(!box) return;
  if(!tarifaTrasladoConfig){ box.innerHTML = ''; return; }
  const km = Number(document.getElementById('sit-km')?.value||0);
  const hora = leerHora('sit-hora');
  if(!km){ box.innerHTML = `<div class="helper" style="margin:0;">Cargá los km para ver el precio sugerido. <a href="#" onclick="abrirModalTarifaTraslado();return false;">Ajustar tarifa</a></div>`; return; }
  const cfg = tarifaTrasladoConfig;
  const base = Number(cfg.tarifa_base)||0;
  const porKm = Number(cfg.precio_km)||0;
  const mult = multiplicadorHorarioTraslado(hora);
  const premium = Number(cfg.margen_premium)||1;
  const margenNinera = Number(cfg.margen_ninera)||0;
  const crudo = (base + km*porKm) * mult * premium;
  const cobro = redondearArriba50(crudo);
  const pago = redondearAbajo50(crudo * (1 - margenNinera));
  // Se precarga directo en los campos de arriba (Cobro a familia / Pago a niñera) -- son
  // los mismos campos que se guardan, no hace falta un botón aparte para "usarlos". Si la
  // persona ya los había tocado a mano, no se pisa: se respeta lo que puso.
  const cobroInput = document.getElementById('sit-cobro'), pagoInput = document.getElementById('sit-pago');
  if(cobroInput && !cobroInput.dataset.tocadoManual){ cobroInput.value = cobro; marcarCampoSugerido('sit-cobro'); }
  if(pagoInput && !pagoInput.dataset.tocadoManual){ pagoInput.value = pago; marcarCampoSugerido('sit-pago'); }
  calcSitMargen();
  const detalles = mult>1 ? ` · recargo horario ×${mult}` : '';
  box.innerHTML = `<div class="helper" style="margin:0;">Precio sugerido según los km${detalles} (margen ${Math.round(margenNinera*100)}% para Parents’ Break) — ya está cargado arriba, en los campos con el borde punteado. Lo podés editar antes de guardar. <a href="#" onclick="abrirModalTarifaTraslado();return false;">Ajustar tarifa</a></div>`;
}
function abrirModalTarifaTraslado(){
  const cfg = tarifaTrasladoConfig || {};
  const hh = (t)=> t ? t.slice(0,2) : '';
  const mm = (t)=> t ? t.slice(3,5) : '';
  const html = `
    <h2>Tarifa de traslados</h2>
    <div class="helper">Se usa para calcular el precio sugerido en traslados nuevos — no toca los ya guardados.</div>
    <div class="grid2">
      <div class="field"><label>Tarifa base ($)</label><input type="number" id="tar-base" value="${cfg.tarifa_base??''}"></div>
      <div class="field"><label>Precio por km ($)</label><input type="number" id="tar-km" value="${cfg.precio_km??''}"></div>
    </div>
    <div class="helper" style="margin-top:6px;">Recargo 1</div>
    <div class="grid3">
      <div class="field"><label>Desde</label>${selectHora('tar-rec1-desde', hh(cfg.rec1_desde), mm(cfg.rec1_desde))}</div>
      <div class="field"><label>Hasta</label>${selectHora('tar-rec1-hasta', hh(cfg.rec1_hasta), mm(cfg.rec1_hasta))}</div>
      <div class="field"><label>Multiplicador</label><input type="number" step="0.01" id="tar-rec1-mult" value="${cfg.rec1_mult??1}"></div>
    </div>
    <div class="helper" style="margin-top:6px;">Recargo 2</div>
    <div class="grid3">
      <div class="field"><label>Desde</label>${selectHora('tar-rec2-desde', hh(cfg.rec2_desde), mm(cfg.rec2_desde))}</div>
      <div class="field"><label>Hasta</label>${selectHora('tar-rec2-hasta', hh(cfg.rec2_hasta), mm(cfg.rec2_hasta))}</div>
      <div class="field"><label>Multiplicador</label><input type="number" step="0.01" id="tar-rec2-mult" value="${cfg.rec2_mult??1}"></div>
    </div>
    <div class="field" style="margin-top:6px;"><label>Margen premium (multiplicador fijo)</label><input type="number" step="0.01" id="tar-premium" value="${cfg.margen_premium??1}"></div>
    <div class="field" style="margin-top:6px;"><label>Margen para Parents’ Break (% que se descuenta al precio de la niñera)</label><input type="number" step="1" id="tar-margen-ninera" value="${Math.round((cfg.margen_ninera??0.15)*100)}"></div>
    <div id="tar-warn"></div>
    <button class="btn primary" style="width:100%;margin-top:8px;" onclick="conGuardado(this, ()=>guardarTarifaTraslado())">Guardar tarifa</button>
  `;
  abrirModal(html);
}
async function guardarTarifaTraslado(){
  const warn = document.getElementById('tar-warn');
  const payload = {
    tarifa_base: Number(document.getElementById('tar-base').value)||0,
    precio_km: Number(document.getElementById('tar-km').value)||0,
    rec1_desde: leerHora('tar-rec1-desde')||null,
    rec1_hasta: leerHora('tar-rec1-hasta')||null,
    rec1_mult: Number(document.getElementById('tar-rec1-mult').value)||1,
    rec2_desde: leerHora('tar-rec2-desde')||null,
    rec2_hasta: leerHora('tar-rec2-hasta')||null,
    rec2_mult: Number(document.getElementById('tar-rec2-mult').value)||1,
    margen_premium: Number(document.getElementById('tar-premium').value)||1,
    margen_ninera: (Number(document.getElementById('tar-margen-ninera').value)||0) / 100,
  };
  if(!tarifaTrasladoConfig){ warn.innerHTML = '<div class="warnbox">No se encontró la fila de configuración base.</div>'; return; }
  const { error } = await sb.from('tarifas_traslado_config').update(payload).eq('id', tarifaTrasladoConfig.id);
  if(error){ warn.innerHTML = errBox(error); return; }
  cerrarModal();
  await cargarTarifaTrasladoConfig();
  actualizarPrecioSugeridoTraslado();
  toast('Tarifa actualizada.');
}

function calcSitMargen(){
  actualizarResumenVariantes('sit', false);
  pintarMargenSit();
}
// Con variantes, el margen es el de lo que se va a guardar.
function pintarMargenSit(){
  const conVariantes = precioConVariantesUI('sit');
  const c = conVariantes ? conVariantes.cobro : Number((document.getElementById('sit-cobro')||{}).value)||0;
  const p = conVariantes ? conVariantes.pago : Number((document.getElementById('sit-pago')||{}).value)||0;
  const el = document.getElementById('sit-margen');
  if(el) el.textContent = '$'+(c-p);
}
/* Recalcula cobro/pago según la duración real (hora fin - hora inicio) por la
   tarifa por hora de la familia — se dispara solo al elegir horario o al
   cambiar la familia. Reemplaza el viejo botón de "horas o cobro extra": ya
   no hace falta cargar un extra a mano, alcanza con poner el horario real
   (por ejemplo, si se quedó 9 minutos más de lo previsto) y esto ya cobra
   exacto por esos minutos. Si la familia no tiene tarifa cargada, no toca
   nada — queda en carga manual como siempre. */
function onSitCanceladoChange(){
  const chk = document.getElementById('sit-cancelado');
  const cobroInput = document.getElementById('sit-cobro');
  const pagoInput = document.getElementById('sit-pago');
  const sinTarifaBox = document.getElementById('sit-sin-tarifa-box');
  if(!chk || !cobroInput || !pagoInput) return;
  cobroInput.disabled = chk.checked;
  pagoInput.disabled = chk.checked;
  if(chk.checked){
    cobroInput.value = 0; pagoInput.value = 0;
    cobroInput.dataset.tocadoManual = '1'; pagoInput.dataset.tocadoManual = '1';
    if(sinTarifaBox) sinTarifaBox.innerHTML = '';
  } else {
    delete cobroInput.dataset.tocadoManual; delete pagoInput.dataset.tocadoManual;
    actualizarCobroPagoPorHorario();
  }
  calcSitMargen();
  pintarGuardarPrecioSit();
}
function actualizarCobroPagoPorHorario(){
  const cobroInput = document.getElementById('sit-cobro');
  const pagoInput = document.getElementById('sit-pago');
  const sinTarifaBox = document.getElementById('sit-sin-tarifa-box');
  if(!cobroInput || !pagoInput) return;
  if(document.getElementById('sit-cancelado')?.checked) return; // cancelado manda, no lo pisa el cálculo automático
  if(sitTipo!=='sitting' || !sitFamiliaSel){ if(sinTarifaBox) sinTarifaBox.innerHTML = ''; pintarFinCobroSit(); return; }
  // El pago por hora es el de la niñera elegida con esta familia (precioHoraNinera, 01/11/2026).
  const familiaPago = familiaConPagoSit();
  sitPagoHoraUsado = familiaPago.pago_hora ?? null;
  const cobroH = Number(sitFamiliaSel.cobro_hora)||0;
  const pagoH = Number(familiaPago.pago_hora)||0;
  const horaIni = leerHora('sit-horaini');
  const horaFin = leerHora('sit-horafin');
  // Si el usuario está usando "poner pago por hora" a mano para este sitting puntual, ese
  // campo maneja el pago (ver onSitPagoHoraInput) — acá no lo tocamos, pero el cobro a la
  // familia sigue calculándose normal. Si falta el PAGO por hora de la familia (haya o no
  // cobro cargado), se ofrece cargarlo ahí mismo — antes esto solo se disparaba si faltaban
  // los dos valores, así que una familia con cobro cargado pero sin pago quedaba calculando
  // el pago en $0 en silencio, sin avisar nada.
  if(!sitPagoModoHora){
    if(!pagoH){
      if(sinTarifaBox && horaIni && horaFin){
        sinTarifaBox.innerHTML = `
          <div class="helper" style="margin:8px 0 6px;color:var(--clay-text);">${escaparHtml(sitFamiliaSel.nombre)} ${cobroH ? 'no tiene cargado cuánto le paga a la niñera por hora' : 'no tiene tarifa por hora cargada'} — cargalo ahora y calculamos este sitting y los que vengan:</div>
          <div class="grid2">
            ${cobroH ? '' : `<div class="field"><label>Cobro por hora</label><input type="number" id="sit-tarifa-cobro-nueva" placeholder="ej. 400"></div>`}
            <div class="field"><label>Pago por hora</label><input type="number" id="sit-tarifa-pago-nueva" placeholder="ej. 280"></div>
          </div>
          <button type="button" class="smallbtn" onclick="conGuardado(this, ()=>guardarTarifaFamiliaDesdeSitting())">Guardar tarifa y calcular</button>`;
      } else if(sinTarifaBox){
        sinTarifaBox.innerHTML = '';
      }
    } else if(sinTarifaBox){
      sinTarifaBox.innerHTML = '';
    }
  } else if(sinTarifaBox){
    sinTarifaBox.innerHTML = '';
  }
  const horas = pintarFinCobroSit();
  if(!horas){ pintarSugerenciaPrecioSit({}); return; } // horario todavía inválido/incompleto, no calcula nada raro
  // Cobro con el fin redondeado si la familia aceptó los términos; pago, con la hora real. Lo
  // puesto a mano no se pisa (auditoría, 21/10/2026: al corregir un minuto de la hora, el precio
  // acordado volvía a horas × tarifa sin avisar): se ofrece el calculado con "Usar estos montos".
  const calc = precioSegunHorario(familiaPago, horaIni, horaFin, document.getElementById('sit-cruza-medianoche')?.checked || false, document.getElementById('sit-fecha')?.value);
  if(sitPagoModoHora) calc.pago = null;
  if(calc.cobro!=null && !cobroInput.dataset.tocadoManual) cobroInput.value = calc.cobro;
  if(calc.pago!=null && !pagoInput.dataset.tocadoManual) pagoInput.value = calc.pago;
  pintarSugerenciaPrecioSit(calc, {elegir:true}); // cambió el horario o la familia: primero se decide qué monto queda
  if(sitPagoModoHora) onSitPagoHoraInput(); // si cambió el horario, recalcula el total con el valor por hora ya tipeado
  calcSitMargen();
}
// Al tipear un precio, el aviso de "no es el de la tarifa" (con el motivo) aparece enseguida, sin
// tocar los montos ni lo demás del formulario (21/10/2026).
function refrescarSugerenciaPrecioSit(){
  if(sitTipo!=='sitting' || !sitFamiliaSel || document.getElementById('sit-cancelado')?.checked) return;
  const horaIni = leerHora('sit-horaini'), horaFin = leerHora('sit-horafin');
  if(!horaIni || !horaFin) return;
  const calc = precioSegunHorario(familiaConPagoSit(), horaIni, horaFin, document.getElementById('sit-cruza-medianoche')?.checked || false, document.getElementById('sit-fecha')?.value);
  if(sitPagoModoHora) calc.pago = null;
  pintarSugerenciaPrecioSit(calc);
}
// Cobro y pago de un sitting según el horario y la tarifa de la familia (null si no se puede).
function precioSegunHorario(familia, horaIni, horaFin, cruza, fechaISO){
  const horas = horasSitting(horaIni, horaFin, cruza, familia, fechaISO);
  const cobroH = Number(familia?.cobro_hora)||0, pagoH = Number(familia?.pago_hora)||0;
  return {
    cobro: horas && cobroH ? redondearCobro(cobroH*horas.cobro) : null,
    pago: horas && pagoH ? redondearPago(pagoH*horas.real) : null,
  };
}
// Si lo puesto a mano no coincide con el horario, se muestra el calculado. Al cambiar el horario o
// la familia (elegir) primero hay que decidir: "Usar el nuevo monto" (aplica cobro y pago y saca la
// marca de precio a mano) o "Mantener el precio a mano" (recién ahí se pide el motivo). Al tipear
// un precio a propósito, el motivo se pide directo (25/10/2026, pedido de Paulina y Delfina).
function pintarSugerenciaPrecioSit(calc, {elegir=false}={}){
  const box = document.getElementById('sit-precio-sugerido');
  if(!box) return;
  const plata = n => '$'+Number(n).toLocaleString('es-UY');
  const difiere = (id, n) => { const el = document.getElementById(id); return n!=null && !!el?.dataset.tocadoManual && Number(el.value)!==n; };
  const cobroNuevo = difiere('sit-cobro', calc.cobro) ? calc.cobro : null;
  const pagoNuevo = difiere('sit-pago', calc.pago) ? calc.pago : null;
  const partes = [cobroNuevo!=null ? `cobro ${plata(cobroNuevo)}` : '', pagoNuevo!=null ? `pago ${plata(pagoNuevo)}` : ''].filter(Boolean);
  // El motivo elegido se conserva al volver a dibujar el aviso (se redibuja con cada cambio) y
  // mientras se decide si se mantiene el precio a mano.
  const sel = document.getElementById('sit-precio-motivo');
  if(sel) sitPrecioMotivo = sel.value;
  if(!partes.length){ box.innerHTML = ''; return; }
  const textoUsar = partes.length>1 ? `Usar los nuevos montos (${partes.join(' y ')})` : `Usar el nuevo monto (${plata(cobroNuevo ?? pagoNuevo)})`;
  const botonUsar = `<button type="button" class="smallbtn" onclick="usarPrecioCalculadoSit(${argJs(cobroNuevo)}, ${argJs(pagoNuevo)})">${textoUsar}</button>`;
  box.innerHTML = `<div class="warnbox" style="margin:0 0 10px;">Con este horario y la tarifa de la familia: ${partes.join(' y ')}. Lo que pusiste a mano no se cambió.
    ${elegir
      ? `<div class="sit-precio-botones" id="sit-precio-elegir">${botonUsar}<button type="button" class="smallbtn" onclick="mantenerPrecioAManoSit()">Mantener el precio a mano</button></div>`
      : `${htmlMotivoPrecio('sit-precio-motivo', sitPrecioMotivo)}<div class="sit-precio-botones">${botonUsar}</div>`}</div>`;
}
function usarPrecioCalculadoSit(cobro, pago){
  [['sit-cobro', cobro], ['sit-pago', pago]].forEach(([id, n])=>{
    const el = document.getElementById(id);
    if(!el || n==null) return;
    el.value = n;
    delete el.dataset.tocadoManual;
  });
  sitPrecioMotivo = ''; // ya no es un precio a mano: no queda motivo
  const box = document.getElementById('sit-precio-sugerido');
  if(box) box.innerHTML = '';
  calcSitMargen();
}
// "Mantener el precio a mano": el mismo aviso, ahora con el motivo para completar.
function mantenerPrecioAManoSit(){ refrescarSugerenciaPrecioSit(); }
/* Toggle "pago por hora" vs "pago total" para ESTE sitting puntual. El campo de pago total
   sigue siendo lo que se guarda en la base (pago_ninera) — el de por hora es solo una forma
   más cómoda de tipear, que calcula el total sola según el horario cargado. */
function toggleSitPagoModoHora(){
  sitPagoModoHora = !sitPagoModoHora;
  const pagoInput = document.getElementById('sit-pago');
  const horaWrap = document.getElementById('sit-pago-hora-wrap');
  const link = document.getElementById('sit-pago-modo-link');
  if(!pagoInput || !horaWrap) return;
  if(sitPagoModoHora){
    pagoInput.readOnly = true;
    pagoInput.style.background = 'var(--bg)';
    horaWrap.style.display = 'block';
    if(link) link.textContent = 'volver a poner el total a mano';
    // Viene con el pago por hora de esa niñera con esta familia (o la tarifa); lo que se tipee
    // después ya es a mano.
    const pagoH = familiaConPagoSit()?.pago_hora;
    const horaInput = document.getElementById('sit-pago-hora');
    if(horaInput){ delete horaInput.dataset.tocadoManual; if(pagoH) horaInput.value = pagoH; }
    onSitPagoHoraInput();
  } else {
    pagoInput.readOnly = false;
    pagoInput.style.background = '';
    horaWrap.style.display = 'none';
    if(link) link.textContent = 'poner pago por hora';
    actualizarCobroPagoPorHorario();
  }
  pintarGuardarPrecioSit();
}
// La fecha decide si rige el redondeo (desde el día que aceptó los términos). En un registro
// ya guardado solo se actualiza el aviso: su cobro no se pisa por cambiar la fecha.
function onSitFechaChange(){
  if(sitEditId) pintarFinCobroSit();
  else actualizarCobroPagoPorHorario();
}
// "Hora real 17:36, se cobra hasta 18:00" debajo del horario (términos y condiciones).
function pintarFinCobroSit(){
  const box = document.getElementById('sit-fin-cobro');
  const horaFin = leerHora('sit-horafin');
  const cruza = document.getElementById('sit-cruza-medianoche')?.checked || false;
  const horas = sitTipo==='sitting' ? horasSitting(leerHora('sit-horaini'), horaFin, cruza, sitFamiliaSel, document.getElementById('sit-fecha')?.value) : null;
  const cruceMal = sitTipo==='sitting' && cruceMedianocheMalMarcado(leerHora('sit-horaini'), horaFin, cruza);
  if(box){ box.textContent = cruceMal ? AVISO_CRUCE_MEDIANOCHE : textoFinCobrado(horaFin, horas); box.style.color = cruceMal ? 'var(--bad)' : ''; }
  return horas;
}
function onSitPagoHoraInput(){
  pintarGuardarPrecioSit();
  const horaVal = Number(document.getElementById('sit-pago-hora')?.value)||0;
  const pagoInput = document.getElementById('sit-pago');
  const horaIni = leerHora('sit-horaini');
  const horaFin = leerHora('sit-horafin');
  if(!pagoInput || !horaIni || !horaFin) return;
  const cruza = document.getElementById('sit-cruza-medianoche')?.checked || false;
  if(cruceMedianocheMalMarcado(horaIni, horaFin, cruza)) return; // serían más de 24 h: lo avisa pintarFinCobroSit
  const mi = agendaMinutos(horaIni);
  let mf = agendaMinutos(horaFin);
  if(cruza) mf += 24*60;
  if(mf<=mi) return;
  const horasFrac = (mf-mi)/60;
  pagoInput.value = redondearPago(horaVal*horasFrac);
  calcSitMargen();
}
async function guardarTarifaFamiliaDesdeSitting(){
  if(!sitFamiliaSel) return;
  const cobroInputEl = document.getElementById('sit-tarifa-cobro-nueva');
  const pagoInputEl = document.getElementById('sit-tarifa-pago-nueva');
  // Si el campo de cobro no está en el formulario (porque la familia YA tenía cobro
  // cargado), hay que conservar ese valor existente en vez de pisarlo con null.
  const cobroH = cobroInputEl ? (Number(cobroInputEl.value)||0) : (Number(sitFamiliaSel.cobro_hora)||0);
  const pagoH = pagoInputEl ? (Number(pagoInputEl.value)||0) : (Number(sitFamiliaSel.pago_hora)||0);
  if(!cobroH && !pagoH){ toast('Cargá al menos uno de los dos valores.', 'bad'); return; }
  const { error } = await sb.from('familias').update({cobro_hora:cobroH||null, pago_hora:pagoH||null}).eq('id', sitFamiliaSel.id);
  if(error){ toast('No se pudo guardar la tarifa: '+error.message, 'bad'); return; }
  sitFamiliaSel.cobro_hora = cobroH||null;
  sitFamiliaSel.pago_hora = pagoH||null;
  const enLista = sitFamilias.find(f=>f.id===sitFamiliaSel.id);
  if(enLista){ enLista.cobro_hora = cobroH||null; enLista.pago_hora = pagoH||null; }
  toast('Tarifa guardada — esta familia ya calcula sola de acá en más.');
  actualizarCobroPagoPorHorario();
}

/* ---- guardar / editar / eliminar ---- */
function toggleSitEsFijo(){
  const box = document.getElementById('sit-fijo-box');
  box.style.display = document.getElementById('sit-esfijo').checked ? 'block' : 'none';
}
async function guardarSitting(){
  const familiaNombre = document.getElementById('sit-familia').value.trim();
  const nineraNombre = document.getElementById('sit-ninera').value.trim();
  const fecha = document.getElementById('sit-fecha').value;
  if(!familiaNombre || !nineraNombre || !fecha){ toast('Faltan familia, niñera o fecha.', 'bad'); return; }
  if(!sitEditId){
    if(!sitFamiliaSel && !(await confirmarNombreNuevo(familiaNombre, sitFamilias, 'familia'))) return;
    if(!sitNineraSel && !(await confirmarNombreNuevo(nineraNombre, sitNinieras, 'niñera'))) return;
  }
  // Precio por niñera (01/11/2026): se lee antes de guardar la tarifa de la familia de abajo (con
  // tarifa nueva la casilla ya no correspondería) y se guarda después del registro.
  const precioNinera = precioNineraAGuardarSit();
  // Si se usó "poner pago por hora" y esta familia todavía no tenía esa tarifa cargada,
  // la guardamos de una vez -- así la próxima vez, con cualquier niñera, ya calcula sola,
  // sin tener que ir a la ficha de la familia a mano.
  if(sitPagoModoHora && sitFamiliaSel && !sitFamiliaSel.pago_hora){
    const horaVal = Number(document.getElementById('sit-pago-hora')?.value)||0;
    if(horaVal){
      const { error: errTarifa } = await sb.from('familias').update({pago_hora:horaVal}).eq('id', sitFamiliaSel.id);
      if(!errTarifa){
        sitFamiliaSel.pago_hora = horaVal;
        const enLista = sitFamilias.find(f=>f.id===sitFamiliaSel.id);
        if(enLista) enLista.pago_hora = horaVal;
        toast('Pago por hora guardado para esta familia — la próxima vez calcula solo.');
      }
    }
  }
  const registro = {
    tipo: sitTipo,
    registrado_por: document.getElementById('sit-registro').value,
    familia_id: sitFamiliaSel ? sitFamiliaSel.id : null,
    familia_nombre: familiaNombre,
    ninera_id: sitNineraSel ? sitNineraSel.id : null,
    ninera_nombre: nineraNombre,
    fecha,
    // Lo tipeado a mano también va sin centavos (21/10/2026): 600,5 → cobro 601, pago 600.
    cobro_familia: redondearCobro(document.getElementById('sit-cobro').value),
    pago_ninera: redondearPago(document.getElementById('sit-pago').value),
    cancelado: document.getElementById('sit-cancelado')?.checked || false,
    notas: document.getElementById('sit-notas').value || null,
    hora_inicio: null, hora_fin: null, km: null, origen: null, destino: null,
    termina_dia_siguiente: false,
  };
  if(sitTipo==='sitting'){
    const horaIni = leerHora('sit-horaini');
    const horaFin = leerHora('sit-horafin');
    const cruza = document.getElementById('sit-cruza-medianoche')?.checked || false;
    if(horaIni && horaFin && !cruza && horaFin<=horaIni){
      toast('La hora de fin tiene que ser después de la de inicio. Si termina pasada la medianoche, marcá "Termina al día siguiente".', 'bad');
      return;
    }
    if(cruceMedianocheMalMarcado(horaIni, horaFin, cruza)){ toast(AVISO_CRUCE_MEDIANOCHE, 'bad'); return; }
    registro.hora_inicio = horaIni || null;
    registro.hora_fin = horaFin || null;
    registro.termina_dia_siguiente = cruza;
  } else {
    registro.hora_inicio = leerHora('sit-hora') || null;
    const km = document.getElementById('sit-km').value;
    registro.km = km ? Number(km) : null;
    registro.origen = document.getElementById('sit-origen').value || null;
    registro.destino = document.getElementById('sit-destino').value || null;
  }
  // Un monto negativo (un "-" de más al tipear) deformaba Finanzas sin avisar (05/10/2026).
  if(registro.cobro_familia < 0 || registro.pago_ninera < 0){ toast('Los montos no pueden ser negativos.', 'bad'); return; }
  // Cambio de horario con precio a mano (25/10/2026): primero hay que decidir qué monto queda.
  const elegir = document.getElementById('sit-precio-elegir');
  if(elegir){ toast('Elegí si usás el nuevo monto o mantenés el precio a mano.', 'bad'); elegir.scrollIntoView({block:'center'}); return; }
  // Precio a mano (21/10/2026): si no coincide con el de la tarifa, se anota por qué.
  const motivoEl = document.getElementById('sit-precio-motivo');
  if(motivoEl && !motivoEl.value){ toast('Elegí por qué el precio no es el de la tarifa: descuento, extra, se cobra sin servicio u otro.', 'bad'); motivoEl.focus(); return; }
  registro.precio_motivo = motivoEl ? motivoEl.value : null;
  // Variantes de precio (23/10/2026): lo de los campos es la base; se guarda con las variantes y
  // queda anotado cuáles (no en las notas). Un día sin servicio va en $0, sin variantes.
  const vars = registro.cancelado ? { aplicadas: null } : leerVariantesPrecio('sit');
  if(vars.error){ toast(vars.error, 'bad'); return; }
  if(vars.aplicadas){
    const base = { cobro: registro.cobro_familia, pago: registro.pago_ninera };
    const conVariantes = aplicarVariantes(base.cobro, base.pago, vars.aplicadas);
    registro.precio_variantes = { base, aplicadas: vars.aplicadas };
    registro.cobro_familia = conVariantes.cobro;
    registro.pago_ninera = conVariantes.pago;
    registro.precio_motivo = vars.motivo || registro.precio_motivo;
  } else if(sitTeniaVariantes) registro.precio_variantes = null;
  // Gastos extra nuevos: se revisan ANTES de guardar el registro (concepto, monto y foto).
  const gastosNuevos = leerGastosExtraNuevos();
  if(gastosNuevos.error){ toast(gastosNuevos.error, 'bad'); return; }
  if(gastosNuevos.lista.some(g=>g.pagado_por==='familia') && !registro.familia_id){
    toast('Para un gasto que pagó la familia, la familia tiene que estar cargada (elegila de la lista).', 'bad'); return;
  }
  let yaAvisadoDuplicado = false;
  if(!sitEditId){
    const existentes = await chequearRegistroExistenteMismoDia(nineraNombre, registro.familia_id, fecha, sitEditId);
    if(existentes.length){
      yaAvisadoDuplicado = true;
      const primero = existentes[0];
      const mensaje = existentes.length===1
        ? `Ya hay un ${primero.hora_inicio?'sitting':'registro'} cargado para ${familiaNombre} con ${nineraNombre} el ${fecha}${primero.hora_inicio?` (${horaTxt(primero.hora_inicio)}–${horaTxt(primero.hora_fin)}, cobro $${Number(primero.cobro_familia||0).toLocaleString('es-UY')}, pago $${Number(primero.pago_ninera||0).toLocaleString('es-UY')})`:''}. ¿Es este mismo sitting (capaz alguien ya lo cargó) o es otro turno distinto?`
        : `Ya hay ${existentes.length} registros cargados para ${familiaNombre} con ${nineraNombre} el ${fecha}. ¿Es otro turno distinto, o querés revisarlos primero en Sittings & traslados?`;
      const resultado = await confirmarAccionTresVias(mensaje, existentes.length===1 ? 'Ver ese sitting' : null, 'Es otro, continuar');
      if(resultado==='cancelar') return;
      if(resultado==='ver'){ abrirModalSitForm(primero.id); return; }
    }
  }
  if(!sitEditId && registro.hora_inicio && !yaAvisadoDuplicado){
    const choque = await chequearDobleReservaDB(nineraNombre, fecha, registro.hora_inicio, registro.hora_fin, {familiaId: registro.familia_id, asignacionId: sitAsignacionId});
    if(!(await avisarSiDobleReserva(choque, nineraNombre, 'Guardar igual'))) return;
  }
  if(!sitEditId && registro.hora_inicio && !yaAvisadoDuplicado){
    const choqueFamilia = await chequearFamiliaYaCubierta(registro.familia_id, fecha, registro.hora_inicio, registro.hora_fin, nineraNombre, sitEditId);
    if(!(await avisarSiFamiliaYaCubierta(choqueFamilia, familiaNombre, 'Sí, van dos'))) return;
  }
  let sitGuardadoId = sitEditId;
  if(!sitEditId && sitAsignacionId) registro.asignacion_id = sitAsignacionId; // día de un fijo cargado desde "Sin registrar"
  const escribir = ()=> sitEditId
    ? sb.from('sittings_traslados').update(registro).eq('id', sitEditId)
    : sb.from('sittings_traslados').insert(registro).select('id').single();
  let res = await escribir();
  let sinMotivo = false;
  if(esFaltaColumnaMotivo(res.error)){ sinMotivo = registro.precio_motivo != null; delete registro.precio_motivo; res = await escribir(); }
  if(esFaltaColumnaVariantes(res.error)){ sinMotivo = true; delete registro.precio_variantes; res = await escribir(); }
  const error = res.error;
  if(!sitEditId) sitGuardadoId = res.data?.id || null;
  if(error){ toast('No se pudo guardar: '+error.message, 'bad'); return; }
  if(sinMotivo) toast('Se guardó, pero sin el motivo del precio: falta actualizar la base. Avisale a Diego.', 'bad');
  // Si falla un gasto, el registro ya está guardado: se dice qué faltó y no se muestra
  // además el "Registro guardado" en verde (06/10/2026).
  let falloGastos = null;
  if(gastosNuevos.lista.length){
    falloGastos = await guardarGastosExtra(sitGuardadoId, gastosNuevos.lista, registro);
    if(falloGastos){ toast('El registro se guardó, pero '+falloGastos, 'bad'); }
  }
  const esFijo = document.getElementById('sit-esfijo')?.checked;
  if(esFijo){
    const dias = [...document.querySelectorAll('#sit-fijo-dias .daybtn.selected')].map(b=>b.dataset.dia);
    if(!dias.length){
      toast('Registro guardado, pero elegí al menos un día para la asignación fija.', 'bad');
    } else {
      const nuevoFijo = {
        familia_id: registro.familia_id, ninera_nombre: nineraNombre, ninera_id: registro.ninera_id || null,
        dias, hora_inicio: registro.hora_inicio, hora_fin: registro.hora_fin,
        tipo: registro.tipo || 'sitting', vigente_desde: registro.fecha || todayISO(),
        // Un traslado fijo lleva su precio: el de este registro (sin los gastos extra).
        ...(registro.tipo==='traslado' ? { cobro_traslado: registro.cobro_familia || null, pago_traslado: registro.pago_ninera || null } : {}),
      };
      const problema = problemaFijoNuevo(nuevoFijo);
      const choqueFijo = problema ? null : await chequearFijoNuevoContraTodo(nineraNombre, dias, registro.hora_inicio, registro.hora_fin);
      const seguirFijo = !problema && (await avisarSiFijoDuplicado(nuevoFijo)) && (await avisarSiDobleReserva(choqueFijo, nineraNombre, 'Crear igual'));
      if(problema) toast('Registro guardado, pero la asignación fija no se creó: '+problema, 'bad');
      else if(!seguirFijo){
        toast('Registro guardado, la asignación fija no se creó.');
      } else {
      const { error: errAsig } = await escribirAsignacion(p=>sb.from('asignaciones').insert(p), nuevoFijo);
      if(errAsig) toast('El registro se guardó, pero la asignación fija falló: '+errAsig.message, 'bad');
      else { await sincronizarPrevistosFijos(); toast(falloGastos ? 'La asignación fija se creó.' : 'Registro guardado y asignación fija creada.'); }
      }
    }
  }
  // El precio de la niñera con esta familia va después del registro: si falla, el registro ya quedó y
  // el aviso dice qué faltó, sin el verde de "Registro guardado".
  let falloPrecio = false;
  if(precioNinera){
    const errPrecio = await guardarPrecioNineraFamilia(precioNinera);
    falloPrecio = !!errPrecio;
    if(errPrecio) toast(`El registro se guardó, pero no el precio de ${precioNinera.nineraNombre} con esta familia: ${errPrecio.message}`, 'bad');
  }
  if(!esFijo && !falloGastos && !falloPrecio){
    const hecho = sitEditId ? 'Registro actualizado' : 'Registro guardado';
    toast(precioNinera ? `${hecho} y precio de ${precioNinera.nineraNombre} con esta familia guardado.` : hecho+'.');
  }
  sitEditId = null; sitFamiliaSel = null; sitNineraSel = null; sitOrigenAuto = true; sitTipo = 'sitting'; sitAsignacionId = null; sitPrecioMotivo = '';
  sitTeniaVariantes = false; sitAsignacionVariantes = null; sitPagoFijo = null;
  cerrarModal();
  cargarSitLista();
}
/* ---- Gastos extra con comprobante (08/10/2026) ----
   Uno o más por registro: concepto, monto, foto del ticket (obligatoria) y quién lo pagó.
   - La niñera: se le cobra a la familia tal cual y se le reintegra en su pago (aparecen
     en Por cobrar / Por pagar, no en el facturado ni en el margen).
   - La familia: queda como saldo a favor de la familia (ajustes_saldo).
   Los tickets van al bucket privado "comprobantes": se ven con un link que vence. */
async function pintarGastosExtraForm(sitId, registro=null){
  const box = document.getElementById('sit-gastos-box');
  if(!box) return;
  let existentes = [];
  if(typeof gastosExtraDisponible!=='undefined' && !gastosExtraDisponible){ box.innerHTML = ''; return; }
  const consulta = sitId
    ? sb.from('gastos_extra').select('*').eq('sitting_id', sitId).order('created_at')
    : sb.from('gastos_extra').select('id').limit(1);
  const { data, error } = await consulta;
  if(error){
    if(esFaltaTabla(error)){ gastosExtraDisponible = false; box.innerHTML = ''; return; }
    box.innerHTML = errBox(error); return;
  }
  if(sitId) existentes = data||[];
  sitGastosExistentes = existentes;
  // El total del registro con sus gastos, a la vista (13/10/2026).
  if(sitId && !registro){
    const { data: reg } = await sb.from('sittings_traslados').select('tipo,cobro_familia').eq('id', sitId).maybeSingle();
    registro = reg;
  }
  if(!document.getElementById('sit-gastos-box')) return;
  const aCargo = existentes.filter(gastoACargoFamilia).reduce((t,g)=>t+(Number(g.monto)||0),0);
  const totalTxt = registro ? textoTotalConGastos(registro.tipo==='traslado' ? 'Traslado' : 'Sitting', registro.cobro_familia, aCargo) : '';
  const quien = g => g.pagado_por==='familia' ? 'lo pagó la familia (saldo a su favor)' : g.absorbe_pb ? 'lo pagó la niñera · lo absorbe Parents Break (no se cobra)' : 'lo pagó la niñera';
  const estado = g => g.pagado_por==='familia' ? '' : g.absorbe_pb ? ` · ${g.reintegrado?'reintegrado':'sin reintegrar'}` : ` · ${g.cobrado?'cobrado':'sin cobrar'} · ${g.reintegrado?'reintegrado':'sin reintegrar'}`;
  box.innerHTML = `
    <div class="card-section-title" style="margin:0 0 4px;">Gastos extra</div>
    <div class="helper" style="margin:0 0 6px;">Lo que se compró para el niño (comida, Uber...). No va en el precio del sitting o traslado: se suma aparte, con su ticket.</div>
    ${totalTxt ? `<div class="sit-total-gastos" style="margin:0 0 8px;padding:8px 10px;border-radius:10px;background:var(--accent-soft, rgba(117,124,187,.12));font-size:13.5px;">A cobrarle a la familia: <b>${escaparHtml(totalTxt)}</b></div>` : ''}
    <div id="sit-gastos-existentes">${existentes.map(g=>`<div class="agendarow gasto-existente" data-gasto="${escaparHtml(g.id)}" style="border-bottom:1px solid var(--line);flex-wrap:wrap;">
      <div><div>${escaparHtml(g.concepto)} · <b>$${Number(g.monto).toLocaleString('es-UY')}</b></div><div class="helper" style="margin:2px 0 0;">${quien(g)}${estado(g)}</div></div>
      <div style="display:flex;gap:6px;">
        <button type="button" class="smallbtn" onclick="verComprobanteGasto(${argJs(g.comprobante)})">Ver ticket</button>
        <button type="button" class="smallbtn" onclick="editarGastoExtra(${argJs(g.id)}, ${argJs(sitId)})">Editar</button>
        ${!g.cobrado && !g.reintegrado ? `<button type="button" class="smallbtn danger" onclick="conGuardado(this, ()=>quitarGastoExtra(${argJs(g.id)}, ${argJs(sitId)}))">Quitar</button>` : ''}
      </div></div>`).join('')}</div>
    <div id="sit-gastos-nuevos"></div>
    <button type="button" class="smallbtn" id="sit-gasto-agregar" onclick="agregarFilaGastoExtra()">+ Agregar gasto extra</button>`;
}
// Editar un gasto ya cargado (13/10/2026): concepto, monto y foto del ticket. El monto no se
// cambia si ya se cobró o se reintegró, ni si su saldo a favor ya se usó en un cobro.
let sitGastosExistentes = [];
function editarGastoExtra(gastoId, sitId){
  const g = sitGastosExistentes.find(x=>x.id===gastoId);
  const fila = document.querySelector(`.gasto-existente[data-gasto="${CSS.escape(gastoId)}"]`);
  if(!g || !fila) return;
  const montoFijo = g.cobrado || g.reintegrado;
  fila.innerHTML = `<div class="gasto-edicion" style="width:100%;">
    <div class="grid2">
      <div class="field"><label>Concepto</label><input type="text" class="gasto-ed-concepto" value="${escaparHtml(g.concepto)}"></div>
      <div class="field"><label>Monto</label><div class="moneyfield"><input type="number" class="gasto-ed-monto" min="0" step="0.01" value="${escaparHtml(g.monto)}" ${montoFijo?'disabled':''}></div></div>
    </div>
    ${montoFijo ? '<div class="helper" style="margin:-4px 0 6px;">Ya se cobró o se reintegró: el monto no se cambia.</div>' : ''}
    <div class="field"><label>Reemplazar la foto del ticket (opcional)</label><input type="file" class="gasto-ed-foto" accept="image/*"></div>
    <div id="gasto-ed-warn"></div>
    <div style="display:flex;gap:6px;">
      <button type="button" class="smallbtn" onclick="pintarGastosExtraForm(${argJs(sitId)})">Cancelar</button>
      <button type="button" class="smallbtn" onclick="conGuardado(this, ()=>guardarEdicionGastoExtra(${argJs(gastoId)}, ${argJs(sitId)}))">Guardar gasto</button>
    </div></div>`;
}
async function guardarEdicionGastoExtra(gastoId, sitId){
  const fila = document.querySelector(`.gasto-existente[data-gasto="${CSS.escape(gastoId)}"]`);
  const warn = fila?.querySelector('#gasto-ed-warn');
  const g = sitGastosExistentes.find(x=>x.id===gastoId);
  if(!fila || !g) return;
  const montoEl = fila.querySelector('.gasto-ed-monto');
  const res = await aplicarEdicionGastoExtra(g, {
    concepto: fila.querySelector('.gasto-ed-concepto').value.trim(),
    monto: montoEl.disabled ? null : Number(montoEl.value),
    archivo: fila.querySelector('.gasto-ed-foto').files?.[0] || null,
  });
  if(res.error){ warn.innerHTML = res.error; return; }
  toast(res.avisos.length ? 'Gasto guardado, pero '+res.avisos.join(' y ')+'.' : 'Gasto guardado.', res.avisos.length ? 'bad' : undefined);
  pintarGastosExtraForm(sitId);
}
/* Guarda la edición de un gasto extra (concepto, monto y foto). La usan el formulario del
   sitting y "Revisar meses" en Finanzas (15/10/2026). monto=null: no se cambia. Devuelve
   { error: html para mostrar } o { avisos: [lo secundario que falló] }. */
async function aplicarEdicionGastoExtra(g, { concepto, monto, archivo }){
  if(!concepto) return { error:'<div class="warnbox">Falta el concepto.</div>' };
  const cambios = { concepto };
  const cambiaMonto = monto!==null && monto !== Number(g.monto);
  if(cambiaMonto){
    if(g.cobrado || g.reintegrado) return { error:'<div class="warnbox">Ya se cobró o se reintegró: el monto no se cambia.</div>' };
    if(!(monto > 0)) return { error:'<div class="warnbox">El monto tiene que ser mayor a cero.</div>' };
    if(g.ajuste_id){
      const { data: aj } = await sb.from('ajustes_saldo').select('aplicado').eq('id', g.ajuste_id).maybeSingle();
      if(aj && Number(aj.aplicado)) return { error:'<div class="warnbox">El saldo a favor de este gasto ya se usó en un cobro: el monto no se cambia.</div>' };
    }
    cambios.monto = monto;
  }
  let rutaNueva = null;
  if(archivo){
    const ext = (archivo.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';
    rutaNueva = `${g.sitting_id}/${crypto.randomUUID()}.${ext}`;
    const { error: eUp } = await sb.storage.from('comprobantes').upload(rutaNueva, archivo, { upsert:false });
    if(eUp) return { error: errBox(eUp) };
    cambios.comprobante = rutaNueva;
  }
  const { error } = await sb.from('gastos_extra').update(cambios).eq('id', g.id);
  if(error){
    if(rutaNueva) await sb.storage.from('comprobantes').remove([rutaNueva]);
    return { error: errBox(error) };
  }
  const avisos = [];
  if(cambiaMonto && g.ajuste_id){
    const { error: eAj } = await sb.from('ajustes_saldo').update({ monto: -monto }).eq('id', g.ajuste_id);
    if(eAj) avisos.push('el saldo a favor no se actualizó ('+eAj.message+')');
  }
  if(rutaNueva && g.comprobante){
    const { error: eRm } = await sb.storage.from('comprobantes').remove([g.comprobante]);
    if(eRm) avisos.push('el ticket viejo no se pudo borrar');
  }
  return { avisos };
}
// Las filas nuevas se agregan al DOM (no se vuelve a dibujar): así no se pierde la foto elegida.
function agregarFilaGastoExtra(){
  const cont = document.getElementById('sit-gastos-nuevos');
  if(!cont) return;
  const fila = document.createElement('div');
  fila.className = 'gasto-nuevo';
  fila.style.cssText = 'border:1px solid var(--line);border-radius:10px;padding:8px;margin:6px 0;';
  fila.innerHTML = `
    <div class="grid2">
      <div class="field"><label>Concepto</label><input type="text" class="gasto-concepto" placeholder="Almuerzo para la niña"></div>
      <div class="field"><label>Monto</label><div class="moneyfield"><input type="number" class="gasto-monto" min="0" step="0.01"></div></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Lo pagó</label><select class="gasto-pagado-por">
        <option value="ninera">La niñera (se le cobra a la familia y se le devuelve)</option>
        <option value="familia">La familia (queda a su favor)</option>
        <option value="absorbe">La niñera, y lo absorbe Parents Break (no se cobra a la familia)</option>
      </select></div>
      <div class="field"><label>Foto del ticket</label><input type="file" class="gasto-foto" accept="image/*"></div>
    </div>
    <button type="button" class="smallbtn" onclick="this.closest('.gasto-nuevo').remove()">Sacar</button>`;
  cont.appendChild(fila);
}
function leerGastosExtraNuevos(){
  const lista = [];
  for(const fila of document.querySelectorAll('#sit-gastos-nuevos .gasto-nuevo')){
    const concepto = fila.querySelector('.gasto-concepto').value.trim();
    const monto = Number(fila.querySelector('.gasto-monto').value);
    const elegido = fila.querySelector('.gasto-pagado-por').value;
    const pagado_por = elegido==='absorbe' ? 'ninera' : elegido;
    const absorbe_pb = elegido==='absorbe';
    const archivo = fila.querySelector('.gasto-foto').files?.[0] || null;
    if(!concepto && !fila.querySelector('.gasto-monto').value && !archivo) continue; // fila vacía
    if(!concepto) return { error: 'Falta el concepto de un gasto extra.' };
    if(!(monto > 0)) return { error: `El gasto "${concepto}" necesita un monto mayor a cero.` };
    if(!archivo) return { error: `Falta la foto del ticket de "${concepto}".` };
    lista.push({ concepto, monto, pagado_por, absorbe_pb, archivo });
  }
  return { lista };
}
// Sube el ticket, crea el saldo a favor si lo pagó la familia y guarda el gasto. Devuelve
// null si salió todo bien, o el texto de lo que faltó.
async function guardarGastosExtra(sitId, lista, registro){
  if(!sitId) return 'no se pudieron guardar los gastos extra (no se supo el registro). Cargalos editándolo.';
  const fallo = (i, txt) => {
    const resto = lista.slice(i+1).map(x=>`"${x.concepto}"`);
    return txt + (resto.length ? ` Tampoco se cargó ${resto.join(', ')}.` : '') + ' Cargalo de nuevo editando el registro.';
  };
  for(const [i, g] of lista.entries()){
    const ext = (g.archivo.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';
    const ruta = `${sitId}/${crypto.randomUUID()}.${ext}`;
    const { error: eUp } = await sb.storage.from('comprobantes').upload(ruta, g.archivo, { upsert:false });
    if(eUp) return fallo(i, `no se pudo subir el ticket de "${g.concepto}" (${eUp.message}).`);
    let ajusteId = null;
    if(g.pagado_por==='familia'){
      const fechaTxt = new Date(registro.fecha+'T12:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'2-digit'});
      const { data: aj, error: eAj } = await sb.from('ajustes_saldo').insert({
        sujeto:'familia', familia_id: registro.familia_id, ninera_id:null, nombre: registro.familia_nombre,
        monto: -g.monto, motivo: `Gasto extra que pagó la familia: ${g.concepto} (${fechaTxt})`, creado_por: registradoPorUsuario() || null,
      }).select('id').single();
      if(eAj){ await sb.storage.from('comprobantes').remove([ruta]); return fallo(i, `no se pudo cargar el saldo a favor de "${g.concepto}" (${eAj.message}).`); }
      ajusteId = aj.id;
    }
    const { error: eG } = await sb.from('gastos_extra').insert({
      sitting_id: sitId, concepto: g.concepto, monto: g.monto, pagado_por: g.pagado_por, comprobante: ruta,
      ajuste_id: ajusteId, creado_por: registradoPorUsuario() || null,
      ...(g.absorbe_pb ? { absorbe_pb: true } : {}), // solo si hace falta: la base sin migrar no tiene la columna
    });
    if(eG && g.absorbe_pb && /absorbe_pb/.test(eG.message||'')){
      await sb.storage.from('comprobantes').remove([ruta]);
      return fallo(i, `"${g.concepto}" no se guardó: la base todavía no tiene "lo absorbe Parents Break" (falta la migración, avisale a Diego).`);
    }
    if(eG){
      if(ajusteId) await sb.from('ajustes_saldo').delete().eq('id', ajusteId);
      await sb.storage.from('comprobantes').remove([ruta]);
      return fallo(i, `no se pudo guardar el gasto "${g.concepto}" (${eG.message}).`);
    }
  }
  return null;
}
async function verComprobanteGasto(ruta){
  const { data, error } = await sb.storage.from('comprobantes').createSignedUrl(ruta, 600);
  if(error || !data?.signedUrl){ toast('No se pudo abrir el ticket'+(error?': '+error.message:'.'), 'bad'); return; }
  window.open(data.signedUrl, '_blank', 'noopener');
}
async function quitarGastoExtra(gastoId, sitId){
  if(!(await confirmarAccion('¿Quitar este gasto extra? Se borra también su ticket.', 'Quitar'))) return;
  const { data: g, error: e0 } = await sb.from('gastos_extra').select('*').eq('id', gastoId).single();
  if(e0 || !g){ toast('No se encontró el gasto.', 'bad'); return; }
  if(g.cobrado || g.reintegrado){ toast('Ese gasto ya se cobró o se reintegró: no se puede quitar.', 'bad'); return; }
  if(g.ajuste_id){
    const { data: aj } = await sb.from('ajustes_saldo').select('aplicado').eq('id', g.ajuste_id).single();
    if(aj && Number(aj.aplicado)){ toast('El saldo a favor de ese gasto ya se usó en un cobro: no se puede quitar.', 'bad'); return; }
  }
  const { error } = await sb.from('gastos_extra').delete().eq('id', gastoId);
  if(error){ toast('No se pudo quitar: '+error.message, 'bad'); return; }
  const avisos = [];
  if(g.ajuste_id){ const { error: e2 } = await sb.from('ajustes_saldo').delete().eq('id', g.ajuste_id); if(e2) avisos.push('el saldo a favor'); }
  const { error: e3 } = await sb.storage.from('comprobantes').remove([g.comprobante]); if(e3) avisos.push('el ticket');
  toast(avisos.length ? `Gasto quitado, pero no se pudo borrar ${avisos.join(' ni ')}.` : 'Gasto quitado.', avisos.length ? 'bad' : undefined);
  pintarGastosExtraForm(sitId);
}

/* Borrar un registro con gastos extra (06/10/2026, testing de la noche): la base borra sus
   gastos en cascada, pero el saldo a favor de un gasto que pagó la familia quedaba vivo (se
   le seguía descontando en el próximo cobro) y los tickets quedaban en el bucket. Lo que ya
   se cobró o reintegró no se borra, igual que "Quitar" un gasto.
   Devuelve null si no se puede borrar, o los gastos y saldos a limpiar después de borrarlo. */
async function gastosDelRegistroABorrar(sitId){
  const nada = { gastos:[], ajustes:[] };
  if(typeof gastosExtraDisponible!=='undefined' && !gastosExtraDisponible) return nada;
  const { data: gastos, error } = await sb.from('gastos_extra').select('*').eq('sitting_id', sitId);
  if(error){
    if(esFaltaTabla(error)){ gastosExtraDisponible = false; return nada; }
    toast('No se pudieron revisar los gastos extra del registro: '+error.message, 'bad'); return null;
  }
  if(!gastos || !gastos.length) return nada;
  if(gastos.some(g=>g.cobrado || g.reintegrado)){ toast('Este registro tiene gastos extra que ya se cobraron o se reintegraron: no se puede eliminar.', 'bad'); return null; }
  const ajustes = gastos.map(g=>g.ajuste_id).filter(Boolean);
  if(ajustes.length){
    const { data: ajs, error: eA } = await sb.from('ajustes_saldo').select('id,aplicado').in('id', ajustes);
    if(eA){ toast('No se pudo revisar el saldo a favor de sus gastos: '+eA.message, 'bad'); return null; }
    if((ajs||[]).some(a=>Number(a.aplicado))){ toast('El saldo a favor de un gasto de este registro ya se usó en un cobro: no se puede eliminar.', 'bad'); return null; }
  }
  return { gastos, ajustes };
}
function textoGastosAlBorrar(info){
  const n = info.gastos.length;
  if(!n) return '';
  return ` También se ${n===1?'borra su gasto extra':'borran sus '+n+' gastos extra'}${info.ajustes.length?' y el saldo a favor que generó la familia':''}.`;
}
// Después de borrar el registro (sus gastos se fueron en cascada): saldos y tickets.
// Devuelve lo que no se pudo borrar, para decirlo en el aviso.
async function limpiarGastosDeRegistroBorrado(info){
  const faltas = [];
  if(info.ajustes.length){
    const { error } = await sb.from('ajustes_saldo').delete().in('id', info.ajustes);
    if(error) faltas.push('el saldo a favor de sus gastos (borralo desde la ficha de la familia)');
  }
  const rutas = info.gastos.map(g=>g.comprobante).filter(Boolean);
  if(rutas.length){
    const { error } = await sb.storage.from('comprobantes').remove(rutas);
    if(error) faltas.push('las fotos de los tickets');
  }
  return faltas;
}
async function eliminarSitting(id){
  const gastos = await gastosDelRegistroABorrar(id);
  if(!gastos) return;
  if(!(await confirmarAccion('¿Eliminar este registro? No se puede deshacer.'+textoGastosAlBorrar(gastos)))) return;
  const { error } = await sb.from('sittings_traslados').delete().eq('id', id);
  if(error){ toast('No se pudo eliminar: '+error.message, 'bad'); return; }
  const faltas = await limpiarGastosDeRegistroBorrado(gastos);
  if(faltas.length) toast('Registro eliminado, pero no se pudo borrar '+faltas.join(' ni ')+'.', 'bad');
  else toast('Registro eliminado.');
  cargarSitLista();
}

/* ---- lista del mes / resumen / export ---- */
function cambiarSitMesRel(delta){
  sitMes = shiftMes(sitMes, delta);
  const lbl = document.getElementById('sit-mes-label'); if(lbl) lbl.textContent = monthLabel(sitMes);
  cargarSitLista();
}
async function cargarSitLista(){
  await esperarConfigFijos(); // fijos automáticos: saber si hay que sacar los previstos
  const wrap = document.getElementById('sit-list-wrap');
  const summary = document.getElementById('sit-summary');
  if(!wrap) return;
  wrap.innerHTML = '<div class="empty"><span class="spinner dark"></span> Cargando…</div>';
  const desde = `${sitMes}-01`;
  const hasta = shiftMes(sitMes, 1)+'-01';
  const { data, error } = await sinPrevistos(sb.from('sittings_traslados').select('*')).gte('fecha', desde).lt('fecha', hasta).order('fecha', {ascending:false});
  if(error){ wrap.innerHTML = errBox(error); return; }
  sitItems = data || [];
  sitGastosFamiliaPorRegistro = await cargarGastosFamiliaPorRegistro(sitItems.map(r=>r.id));
  sitListaMostrar = 15; // se resetea cada vez que se recarga el mes, para no arrastrar un "mostrar todo" al cambiar de mes
  const cobrado = sitItems.reduce((s,r)=>s+(Number(r.cobro_familia)||0), 0);
  const pagado = sitItems.reduce((s,r)=>s+(Number(r.pago_ninera)||0), 0);
  summary.innerHTML = `
    <div class="summarycard"><div class="statlabel">Cobrado en ${monthLabel(sitMes)}</div><div class="statnum" style="font-size:19px;margin-top:3px;">${plataFin(cobrado)}</div></div>
    <div class="summarycard"><div class="statlabel">Pagado en ${monthLabel(sitMes)}</div><div class="statnum" style="font-size:19px;margin-top:3px;">${plataFin(pagado)}</div></div>
    <div class="summarycard" style="border-left:3px solid var(--good);"><div class="statlabel">Margen</div><div class="statnum" style="font-size:19px;margin-top:3px;color:var(--good);">${plataFin(cobrado-pagado)}</div></div>
  `;
  renderSitListaTabla();
}
// Gastos extra a cargo de la familia por registro (13/10/2026): la lista muestra
// "$1.018 + gastos $427 = $1.445" para que se vea que la comida va aparte del precio.
let sitGastosFamiliaPorRegistro = {};
async function cargarGastosFamiliaPorRegistro(ids){
  const porId = {};
  if(!ids.length || (typeof gastosExtraDisponible!=='undefined' && !gastosExtraDisponible)) return porId;
  for(let i=0; i<ids.length; i+=100){
    const { data, error } = await sb.from('gastos_extra').select('sitting_id,monto,pagado_por,absorbe_pb').in('sitting_id', ids.slice(i, i+100));
    if(error){
      if(/absorbe_pb/.test(error.message||'')){ // base sin la columna: se lee sin ella
        const r2 = await sb.from('gastos_extra').select('sitting_id,monto,pagado_por').in('sitting_id', ids.slice(i, i+100));
        (r2.data||[]).filter(gastoACargoFamilia).forEach(g=>{ porId[g.sitting_id] = (porId[g.sitting_id]||0) + (Number(g.monto)||0); });
        continue;
      }
      if(esFaltaTabla(error)) gastosExtraDisponible = false;
      break;
    }
    (data||[]).filter(gastoACargoFamilia).forEach(g=>{ porId[g.sitting_id] = (porId[g.sitting_id]||0) + (Number(g.monto)||0); });
  }
  return porId;
}
// Solo pinta la tabla desde sitItems (ya en memoria) — la usan tanto cargarSitLista() como el
// botón "Mostrar más", que no necesita volver a pedirle nada a la base.
function renderSitListaTabla(){
  const wrap = document.getElementById('sit-list-wrap');
  if(!wrap) return;
  if(!sitItems.length){ wrap.innerHTML = `<div class="empty">No hay registros cargados en ${monthLabel(sitMes)} todavía.</div>`; return; }
  const itemsMostrados = sitItems.slice(0, sitListaMostrar);
  const hayMas = sitListaMostrar < sitItems.length;
  wrap.innerHTML = `
    <h2>Registros de ${monthLabel(sitMes)}</h2>
    <div class="tablewrap"><table class="asigtable"><thead><tr><th>Fecha</th><th>Tipo</th><th>Familia</th><th>Niñera</th><th>Cobro</th><th>Pago</th><th>Margen</th><th></th></tr></thead>
    <tbody>${itemsMostrados.map(r=>{
      const margen = (Number(r.cobro_familia)||0) - (Number(r.pago_ninera)||0);
      const fechaFmt = r.fecha ? new Date(r.fecha+'T00:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'short'}) : '—';
      // La fila se toca para editar, como en el historial (25/10/2026): en el celular la tabla
      // es más ancha que la pantalla y el botón "Editar" quedaba fuera de la vista, así que no
      // se podía cancelar un traslado sin deslizar la tabla al costado.
      return `<tr style="cursor:pointer;" onclick="abrirModalSitForm(${argJs(r.id)})" title="Tocar para editar"><td>${fechaFmt}</td><td><span class="badge ${r.tipo==='sitting'?'brand':'warn'}" style="font-size:10px;padding:2px 8px;">${r.tipo==='sitting'?'Sitting':'Traslado'}</span></td><td>${escaparHtml(r.familia_nombre)}${r.cancelado?' <span class="badge warn" style="font-size:9.5px;padding:2px 6px;">Cancelado</span>':''}</td><td>${escaparHtml(r.ninera_nombre)}</td><td>${plataFin(r.cobro_familia)}${sitGastosFamiliaPorRegistro[r.id] ? `<div class="helper sit-total-fila" style="margin:2px 0 0;white-space:nowrap;">+ gastos ${plataFin(sitGastosFamiliaPorRegistro[r.id])} = ${plataFin((Number(r.cobro_familia)||0)+sitGastosFamiliaPorRegistro[r.id])}</div>` : ''}</td><td>${plataFin(r.pago_ninera)}</td><td class="${margen>=0?'margenpos':'margenneg'}">${plataFin(margen)}</td><td onclick="event.stopPropagation()"><div class="tablecell-btns"><button class="smallbtn" onclick="abrirModalSitForm(${argJs(r.id)})">Editar</button><button class="smallbtn" onclick="abrirModalIncidente(${argJs({sitting_id:r.id, ninera_id:r.ninera_id, ninera_nombre:r.ninera_nombre, familia_id:r.familia_id, familia_nombre:r.familia_nombre, fecha:r.fecha})})">Incidente</button><button class="smallbtn danger" onclick="conGuardado(this, ()=>eliminarSitting(${argJs(r.id)}))">Eliminar</button></div></td></tr>`;
    }).join('')}</tbody></table></div>
    ${hayMas ? `<button class="smallbtn" onclick="sitListaMostrar+=15;renderSitListaTabla();" style="margin-top:10px;">Mostrar más</button>` : ''}
  `;
}
function exportarSitCSV(){
  if(!sitItems.length){ toast('No hay registros para exportar en este mes.', 'bad'); return; }
  const headers = ['Fecha','Tipo','Registró','Familia','Niñera','Hora inicio','Hora fin','Km','Origen','Destino','Cobro familia','Pago niñera','Margen','Notas'];
  const rows = sitItems.map(r=>[r.fecha, r.tipo, r.registrado_por, r.familia_nombre, r.ninera_nombre, r.hora_inicio||'', r.hora_fin||'', r.km||'', r.origen||'', r.destino||'', r.cobro_familia||0, r.pago_ninera||0, (Number(r.cobro_familia)||0)-(Number(r.pago_ninera)||0), (r.notas||'').replace(/\n/g,' ')]);
  descargarCSV(headers, rows, `sittings_traslados_${sitMes}.csv`);
}

