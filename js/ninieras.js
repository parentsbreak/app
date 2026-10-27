/* ---- Niñeras ---- */
let ninierasItems = [];
let sitHistResenas = {};
// CV desactualizado: cumplió años después de la última vez que se generó el CV de Canva.
// Compartido entre la ficha y el badge de la lista.
function cvEstaDesactualizado(n){
  const cd = n.candidatas || {};
  const edadCalculada = calcularEdad(cd.fecha_nacimiento);
  if(!n.cv_generado_en || edadCalculada===null) return false;
  return calcularEdad(cd.fecha_nacimiento, n.cv_generado_en) < edadCalculada;
}
// Cumple hoy (mismo día y mes que la fecha de nacimiento, año aparte).
function esCumpleHoy(n){
  const fn = n.candidatas?.fecha_nacimiento;
  if(!fn) return false;
  return String(fn).slice(5,10) === todayISO().slice(5,10);
}
let ninFiltroZonas = new Set(); // claveZona() de las zonas marcadas en el filtro
function toggleFiltroZonaNin(k, marcada){
  if(k===null) ninFiltroZonas.clear();
  else if(marcada) ninFiltroZonas.add(k); else ninFiltroZonas.delete(k);
  const w = document.getElementById('filt-zonas-wrap');
  if(w) w.innerHTML = htmlFiltroZonas(ninFiltroZonas, 'toggleFiltroZonaNin');
  filtrarNinieras();
}
function renderNinieras(body){
  body.innerHTML = `
    <div id="nin-cumpleaneras-wrap"></div>
    <div id="nin-zonasnuevas-wrap"></div>
    <div id="nin-temporadas-wrap"></div>
    <div id="nin-utilizacion-wrap"></div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px;"><button class="btn primary" onclick="abrirModalNuevaNinera()">+ Agregar niñera</button></div>
    <div class="card" style="padding:14px 18px;"><div class="grid2">
      <div class="field" style="margin:0;"><label>Buscar (nombre, universidad, idioma...)</label><input type="text" id="filt-nombre" autocomplete="off" placeholder="Escribí para filtrar..." oninput="filtrarNinieras()"></div>
      <div class="field" style="margin:0;"><label>Tipo</label><select id="filt-tipo" onchange="filtrarNinieras()"><option value="">Todas</option><option>Niñera</option><option>Traslados</option><option>Ambas</option></select></div>
    </div>
    <div class="field" style="margin:12px 0 0;"><label>Zonas</label><div id="filt-zonas-wrap">${htmlFiltroZonas(ninFiltroZonas, 'toggleFiltroZonaNin')}</div></div>
    <div class="field" style="margin:12px 0 0;"><label>Cuándo (junto con una zona: quiénes están ahí esos meses)</label><div id="filt-meses-wrap">${htmlFiltroMeses()}</div></div>
    </div>
    <div id="ninierasgrid"></div>
  `;
  return cargarNinieras();
}
// Mini sección arriba de todo, separada de la lista general -- solo aparece si hay alguna
// cumpleañera hoy, para no ocupar espacio de más el resto del año.
function renderCumpleaneras(){
  const wrap = document.getElementById('nin-cumpleaneras-wrap');
  if(!wrap) return;
  const cumpleaneras = ninierasItems.filter(esCumpleHoy);
  if(!cumpleaneras.length){ pintarSiCambio(wrap, ''); return; }
  pintarSiCambio(wrap, `<div class="card" style="padding:12px 18px;border-left:3px solid var(--accent);margin-bottom:10px;">
    <div style="font-weight:600;margin-bottom:2px;">🎂 Cumpleañera${cumpleaneras.length>1?'s':''} hoy</div>
    <div class="helper" style="margin:0;">${escaparHtml(cumpleaneras.map(n=>n.nombre).join(', '))}</div>
  </div>`);
}
/* Una sola carga en vuelo (27/10/2026, parpadeo en Niñeras): el guardado y el eco de Realtime
   llamaban a cargarNinieras a la vez y las dos pintadas se intercalaban (cada una vuelve a crear
   Utilización y Temporadas con su fundido). Una llamada que llega con otra en curso espera esa
   misma y, como puede haber datos nuevos, la carga se repite una vez al terminar. Le avisa a
   Realtime cuándo empieza y termina (marcarRecargaLiviana, agenda.js) para que el eco del propio
   guardado no dispare otra. */
let ninCargaEnVuelo = null, ninCargaDesde = 0, ninCargaRepetir = false;
function cargarNinieras(){
  // Una lectura colgada (fetch no tiene timeout) no puede dejar la pantalla trabada para siempre.
  if(ninCargaEnVuelo && performance.now() - ninCargaDesde < 20000){ ninCargaRepetir = true; return ninCargaEnVuelo; }
  marcarRecargaLiviana('ninieras', true);
  ninCargaDesde = performance.now();
  const carga = cargarNinierasUnaVez().finally(()=>{
    if(ninCargaEnVuelo === carga) ninCargaEnVuelo = null;
    marcarRecargaLiviana('ninieras', false);
    if(ninCargaRepetir){ ninCargaRepetir = false; return cargarNinieras(); }
  });
  ninCargaEnVuelo = carga;
  return carga;
}
async function cargarNinierasUnaVez(){
  asegurarEstilosTemporada();
  // Los grupos de zona ahora se esperan: además del checklist de "Editar", la lista los usa
  // para saber qué zonas son de afuera (temporadas) al filtrar y al poner el badge.
  await Promise.all([
    zonaGruposCache ? null : cargarZonaGrupos(),
    zonasConfirmadasCache ? null : cargarZonasConfirmadas(),
  ]);
  const { data, error } = await sb.from('ninieras').select('*, candidatas(*)').eq('activa', true).order('nombre');
  if(error){ const g = document.getElementById('ninierasgrid'); if(g) g.innerHTML = errBox(error); return; }
  ninierasItems = data;
  const fechasEntrevista = cargarFechasEntrevistaNinieras(); // en paralelo: para el orden de la lista
  renderCumpleaneras();
  renderZonasNuevasPanel();
  renderTemporadasPanel();
  await cargarUtilizacionNinieras();
  await cargarConteoIncidentesNinieras();
  const wZonas = document.getElementById('filt-zonas-wrap');
  if(wZonas) wZonas.innerHTML = htmlFiltroZonas(ninFiltroZonas, 'toggleFiltroZonaNin');
  await fechasEntrevista;
  filtrarNinieras();
}
/* Orden de la lista (21/10/2026, pedido de Paulina y Delfina): por la fecha de la entrevista, de la
   más nueva a la más vieja; las de antes de la app, sin entrevista, al final. La fecha es la de la
   entrevista completa más reciente de su candidata (si solo hay una a medias, esa). */
let ninFechaEntrevista = {}; // id de la niñera -> 'AAAA-MM-DD'
async function cargarFechasEntrevistaNinieras(){
  const porCandidata = {};
  ninierasItems.forEach(n=>{ if(n.candidata_id) porCandidata[n.candidata_id] = n.id; });
  const ids = Object.keys(porCandidata);
  ninFechaEntrevista = {};
  if(!ids.length) return;
  const { data, error } = await sb.from('entrevistas').select('candidata_id,fecha,estado,created_at').in('candidata_id', ids);
  if(error) return; // sin las fechas, queda por nombre: no frena la lista
  const mejor = {};
  (data||[]).forEach(e=>{
    const fecha = e.fecha || (e.created_at ? fechaNegocioISO(new Date(e.created_at)) : null);
    if(!fecha) return;
    const completa = e.estado !== 'en_curso';
    const antes = mejor[e.candidata_id];
    if(!antes || (completa && !antes.completa) || (completa===antes.completa && fecha > antes.fecha)) mejor[e.candidata_id] = { fecha, completa };
  });
  Object.entries(mejor).forEach(([cid, m])=>{ ninFechaEntrevista[porCandidata[cid]] = m.fecha; });
}
function ordenarNinierasPorEntrevista(a, b){
  const fa = ninFechaEntrevista[a.id], fb = ninFechaEntrevista[b.id];
  if(fa && fb && fa!==fb) return fb.localeCompare(fa);
  if(fa && !fb) return -1;
  if(fb && !fa) return 1;
  return String(a.nombre||'').localeCompare(String(b.nombre||''), 'es');
}
/* Cuántos trabajos viene haciendo cada una, en su fila (21/10/2026): sittings y traslados que se
   hicieron (sin previstos ni cancelados), de toda la historia. Sale de la misma lectura que el
   panel de utilización: no suma consultas. */
let ninConteoTrabajos = { porId: {}, porNombre: {} };
function conteoTrabajosNinera(n){
  const a = ninConteoTrabajos.porId[n.id] || { sitting:0, traslado:0 };
  const b = ninConteoTrabajos.porNombre[normaliza(n.nombre||'')] || { sitting:0, traslado:0 };
  return { sittings: a.sitting + b.sitting, traslados: a.traslado + b.traslado };
}
function textoTrabajosNinera(n){
  const { sittings, traslados } = conteoTrabajosNinera(n);
  if(!sittings && !traslados) return 'Sin sittings todavía';
  const partes = [];
  if(sittings) partes.push(`${sittings} sitting${sittings===1?'':'s'}`);
  if(traslados) partes.push(`${traslados} traslado${traslados===1?'':'s'}`);
  return partes.join(' · ');
}
const NIN_UTIL_DIAS = 30;
let ninUtilChart = null;
let ninUtilAbierto = false; // arranca cerrado — con 77 niñeras sin actividad era un cartel inmenso
let ninUtilPorNinera = {};
let ninUtilUltimaActividad = {};
/* E2 · Utilización de niñeras: cuántos sittings/traslados hizo cada una en
   los últimos 30 días, y quiénes no tuvieron ninguno (con la fecha de su
   último sitting, alguna vez) — para decidir a quién darle más changas,
   a quién no sobrecargar, y a quién dar de baja si ya no trabaja más con
   el equipo. No bloquea el resto de la pantalla si falla — es secundario. */
async function cargarUtilizacionNinieras(){
  await esperarConfigFijos(); // fijos automáticos: saber si hay que sacar los previstos
  const { data, error } = await leerTodasLasFilas(()=>sinPrevistos(sb.from('sittings_traslados').select('ninera_id,ninera_nombre,fecha,tipo,cancelado')).order('id'));
  if(error || !document.getElementById('nin-utilizacion-wrap')) return;
  const desde30 = sumarDiasISO(todayISO(), -NIN_UTIL_DIAS);
  const porNinera = {};
  const ultimaActividad = {};
  const conteo = { porId: {}, porNombre: {} };
  (data||[]).forEach(r=>{
    if(!r.cancelado){
      // Cada registro cuenta una sola vez: por la niñera vinculada o, si no tiene, por el nombre.
      const mapa = r.ninera_id ? conteo.porId : conteo.porNombre;
      const k = r.ninera_id || normaliza(r.ninera_nombre||'');
      if(k){ mapa[k] ||= { sitting:0, traslado:0 }; mapa[k][r.tipo==='traslado' ? 'traslado' : 'sitting']++; }
    }
    const k = normaliza(r.ninera_nombre||'');
    if(!k || !r.fecha) return;
    if(r.fecha >= desde30){
      if(!porNinera[k]) porNinera[k] = {nombre:r.ninera_nombre, cant:0};
      porNinera[k].cant += 1;
    }
    if(!ultimaActividad[k] || r.fecha > ultimaActividad[k]) ultimaActividad[k] = r.fecha;
  });
  ninUtilPorNinera = porNinera;
  ninUtilUltimaActividad = ultimaActividad;
  ninConteoTrabajos = conteo;
  renderUtilizacionNinieras();
}
function toggleNinUtil(){ ninUtilAbierto = !ninUtilAbierto; renderUtilizacionNinieras(); }
function renderUtilizacionNinieras(){
  const wrap = document.getElementById('nin-utilizacion-wrap');
  if(!wrap) return;
  const porNinera = ninUtilPorNinera;
  const top = Object.values(porNinera).sort((a,b)=>b.cant-a.cant).slice(0, 8);
  const sinActividad = ninierasItems
    .filter(n => !porNinera[normaliza(n.nombre)])
    .sort((a,b)=>{
      const ua = ninUtilUltimaActividad[normaliza(a.nombre)] || ''; // nunca tuvo sitting = más atrasada de todas
      const ub = ninUtilUltimaActividad[normaliza(b.nombre)] || '';
      return ua.localeCompare(ub);
    });

  const etiquetas = top.map(x=>(x.nombre||'').split(' ')[0]);
  const valores = top.map(x=>x.cant);
  const html = !top.length && !sinActividad.length ? '' : `
    <div class="card" style="padding:14px 18px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;cursor:pointer;" onclick="toggleNinUtil()">
        <h2 style="margin:0;">Utilización — últimos ${NIN_UTIL_DIAS} días</h2>
        <div class="helper" style="margin:0;">${sinActividad.length} sin actividad · ${ninUtilAbierto?'tocá para cerrar ▲':'tocá para ver ▼'}</div>
      </div>
      ${ninUtilAbierto ? `
      ${top.length ? `<div style="height:220px;margin-top:12px;"><canvas id="ninUtilChart"></canvas></div>` : `<div class="empty">Sin sittings registrados en este período.</div>`}
      ${sinActividad.length ? `
        <div class="helper" style="margin:14px 0 6px;">Sin ningún sitting en ${NIN_UTIL_DIAS} días (${sinActividad.length}) — de la más atrasada a la más reciente:</div>
        <div style="display:flex;flex-direction:column;gap:2px;">
          ${sinActividad.map(n=>{
            const ultima = ninUtilUltimaActividad[normaliza(n.nombre)];
            const hace = ultima ? `Último sitting: ${new Date(ultima+'T00:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'short',year:'numeric'})}` : 'Nunca tuvo un sitting registrado';
            return `
            <div class="agendarow" style="border-bottom:1px solid var(--line);padding:7px 0;align-items:center;flex-wrap:wrap;gap:6px;">
              <div style="flex:1;min-width:160px;">
                <div>${escaparHtml(n.nombre)}</div>
                <div class="helper" style="margin:0;">${hace}</div>
              </div>
              ${n.telefono
                ? `<button class="smallbtn" onclick="enviarWhatsappNinera(${argJs(n.id)})">Enviar por WhatsApp</button>`
                : `<span class="helper" style="margin:0;">Sin teléfono cargado</span>`}
              <button class="smallbtn" style="color:var(--bad);border-color:var(--bad);" onclick="conGuardado(this, ()=>eliminarNinera(${argJs(n.id)}))">Eliminar niñera</button>
            </div>`;
          }).join('')}
        </div>` : ''}` : ''}
    </div>`;
  if(!pintarSiCambio(wrap, html)){
    // El panel quedó igual: el gráfico no se vuelve a armar, solo recibe los conteos de hoy (las
    // barras no están en el HTML, así que pueden cambiar sin que cambie el panel).
    if(ninUtilAbierto && ninUtilChart){ ninUtilChart.data.labels = etiquetas; ninUtilChart.data.datasets[0].data = valores; ninUtilChart.update(); }
    return;
  }

  if(ninUtilAbierto && top.length){
    asegurarChart().then(()=>{
      const canvas = document.getElementById('ninUtilChart');
      if(!canvas || !window.Chart) return;
      if(ninUtilChart){ ninUtilChart.destroy(); ninUtilChart = null; }
      ninUtilChart = new Chart(canvas, {
        type:'bar',
        data:{ labels: etiquetas, datasets:[{ label:'Sittings/traslados', data: valores, backgroundColor:'#757CBB', borderRadius:6 }] },
        options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } } }
      });
    });
  }
}
/* Borrador — igual que el de familias, pendiente de revisión por Pau/Delfi. */
function mensajeUtilizacionPara(n){
  const primerNombre = (n.nombre||'').trim().split(' ')[0] || n.nombre;
  return `¡Hola ${primerNombre}! Somos de Parents’ Break 💛 Hace un tiempo que no te agendamos ningún sitting y queríamos saber cómo estás y si seguís con ganas de tomar changas. ¡Contanos!`;
}
function enviarWhatsappNinera(id){
  const n = ninierasItems.find(x=>x.id===id);
  if(!n) return;
  const tel = formatearTelefonoWhatsApp(n.telefono);
  if(!tel){ toast('Esta niñera no tiene teléfono cargado — agregalo en su ficha primero.', 'bad'); return; }
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(mensajeUtilizacionPara(n))}`, '_blank');
}
let ninIncidentesCount = {};
async function cargarConteoIncidentesNinieras(){
  const { data } = await sb.from('incidentes').select('ninera_id,ninera_nombre').not('ninera_nombre','is',null);
  ninIncidentesCount = {};
  (data||[]).forEach(i=>{
    const key = normaliza(i.ninera_nombre||'');
    if(!key) return;
    ninIncidentesCount[key] = (ninIncidentesCount[key]||0) + 1;
  });
}
// Las zonas por las que se filtra: las marcadas, más una zona de afuera escrita tal cual en el
// buscador ("Punta del Este", "José Ignacio"), que se busca igual que si se marcara, con la
// misma regla de temporada (21/10/2026: escribiendo "Punta del Este" aparecía una niñera que
// dijo que no va, porque lo tenía en los barrios).
function zonasDelFiltroNin(textoBuscado){
  const zonas = new Set(ninFiltroZonas);
  const g = grupoDeZona(textoBuscado||'');
  if(g?.fuera_de_montevideo) zonas.add(claveZona(g.nombre));
  return { zonas, porTexto: !!g?.fuera_de_montevideo };
}
// "Dijo que no va" (21/10/2026): cargó la temporada sin ninguna quincena en una zona de afuera
// que tiene en su zona y que está en el filtro. Sin meses elegidos aparece, con esta marca; con
// meses, no aparece.
function dijoQueNoVa(n, zonas){
  if(!temporadaCargada(n)) return false;
  return gruposFueraDeNinera(n).some(g=>zonas.has(claveZona(g.nombre)) && !quincenasDeGrupo(n.temporada, g.id).length);
}
function filtrarNinieras(){
  const grid = document.getElementById('ninierasgrid');
  if(!grid) return;
  const textoBuscado = document.getElementById('filt-nombre')?.value||'';
  const { zonas, porTexto } = zonasDelFiltroNin(textoBuscado);
  const fn = porTexto ? '' : normaliza(textoBuscado);
  const hayZonas = zonas.size>0;
  const ft = document.getElementById('filt-tipo')?.value||'';
  const qsFiltro = quincenasDeMeses(ninFiltroMeses);
  const filtraPeriodo = !!(hayZonas && qsFiltro.length);
  const cobertura = {}; // id -> 'todo' | 'parte' (solo con filtro de período)
  const filtradas = ninierasItems.filter(n => {
    const cd = datosFichaCandidata(n.candidatas);
    const blob = normaliza([n.nombre, n.notas, cd.universidad, cd.idiomas, cd.experiencia, n.barrios].filter(Boolean).join(' '));
    const matchTexto = !fn || blob.includes(fn);
    const matchZona = coincideFiltroZonas(n.zona, zonas);
    const matchTipo = !ft || (n.tipo||'Niñera')===ft;
    if(!(matchTexto && matchZona && matchTipo)) return false;
    if(!filtraPeriodo) return true;
    // Solo las zonas marcadas que ella tiene (si marcaste Carrasco y Punta del Este y ella
    // es solo de Carrasco, se mira si está en Carrasco esos meses).
    const suyas = zonasNormalizadas(n.zona).map(claveZona).filter(k=>zonas.has(k));
    const c = coberturaPeriodo(n, suyas, qsFiltro);
    cobertura[n.id] = c;
    // Con un período elegido, las que no tienen temporada cargada (no se sabe si están) van
    // aparte, al final, como "sin temporada cargada" (21/10/2026; antes no se mostraban).
    return c!=='nada';
  });
  filtradas.sort(ordenarNinierasPorEntrevista);
  const zonaLabel = escaparHtml(nombresZonasFiltro(zonas).join(' o '));
  const hayZonaAfuera = [...zonas].some(k=>grupoFueraDeZona(k));
  const mesesTxt = [...ninFiltroMeses].sort((a,b)=>a-b).map(m=>TEMP_MESES_LARGO[m]).join(', ');
  const completas = filtraPeriodo ? filtradas.filter(n=>cobertura[n.id]==='todo') : filtradas;
  const parciales = filtraPeriodo ? filtradas.filter(n=>cobertura[n.id]==='parte') : [];
  const sinDato = filtraPeriodo ? filtradas.filter(n=>cobertura[n.id]==='desconocido') : [];
  let countMsg;
  if(filtraPeriodo){
    countMsg = `<div class="helper" style="margin:0 0 8px;">${completas.length} en ${zonaLabel} todo ${mesesTxt}${parciales.length?`, ${parciales.length} solo una parte`:''}${sinDato.length?`, ${sinDato.length} sin temporada cargada`:''}.</div>`;
  } else {
    countMsg = `<div class="helper" style="margin:0 0 8px;">${filtradas.length} de ${ninierasItems.length} niñeras${ninFiltroMeses.size && !hayZonas ? '. Elegí también una zona para filtrar por mes.' : ''}</div>`;
  }
  if(!filtradas.length){ grid.innerHTML = countMsg + '<div class="empty">Ninguna niñera coincide con la búsqueda.</div>'; return; }
  const mostrarTira = filtraPeriodo || hayZonaAfuera;
  const filaNinera = n=>`
    <div class="person-row">
      <div class="av" ${n.foto?`style="cursor:zoom-in;" onclick="abrirLightboxFoto(${argJs(n.foto)}, ${argJs('Foto de '+n.nombre)})"`:''}>${n.foto?`<img loading="lazy" decoding="async" src="${urlSegura(n.foto)}" alt="Foto de ${escaparHtml(n.nombre)}" onerror="this.parentElement.textContent=${argJs((n.nombre||'?').charAt(0).toUpperCase())}">`:escaparHtml((n.nombre||'?').charAt(0).toUpperCase())}</div>
      <div class="info">
        <div class="name">${escaparHtml(n.nombre)}${cvEstaDesactualizado(n) ? ` <span style="color:var(--warn);font-weight:600;font-size:12px;">· Actualizar CV</span>` : ''}</div>
        <div class="meta">${escaparHtml(textoZonasConBarrios(n.zona, n.barrios)||'zona s/d')}${escaparHtml((() => { const e = calcularEdad(n.candidatas?.fecha_nacimiento); return e!==null ? ' · '+e+' años' : (n.candidatas?.edad ? ' · '+n.candidatas.edad : ''); })())}${n.candidatas?.universidad?escaparHtml(' · '+n.candidatas.universidad):''}</div>
        <div class="meta nin-trabajos">${escaparHtml(textoTrabajosNinera(n))}</div>
        ${mostrarTira ? htmlMiniTemporada(n, qsFiltro) : ''}
      </div>
      <div class="badge-slot">
        <span class="badge brand" style="font-size:10px;padding:2px 8px;">${escaparHtml(n.tipo||'Niñera')}</span>
        ${!n.candidatas?.fecha_nacimiento ? `<span class="badge warn" style="font-size:10px;padding:2px 8px;">Sin fecha de nac.</span>` : ''}
        ${ninIncidentesCount[normaliza(n.nombre)] ? `<span class="badge bad" style="font-size:10px;padding:2px 8px;">${ninIncidentesCount[normaliza(n.nombre)]} incidente${ninIncidentesCount[normaliza(n.nombre)]===1?'':'s'}</span>` : ''}
        ${badgeTemporada(n)}
        ${hayZonaAfuera && !filtraPeriodo && dijoQueNoVa(n, zonas) ? `<span class="badge warn ninera-no-va" style="font-size:10px;padding:2px 8px;">Dijo que no va</span>` : ''}
        ${n.telefono_pendiente ? `<span class="badge warn" style="font-size:10px;padding:2px 8px;">Celular nuevo por confirmar</span>` : ''}
      </div>
      <div class="rowbtns">
        <button class="smallbtn" onclick="verNinera(${argJs(n.id)})">Ver ficha</button>
        <button class="smallbtn" onclick="editarNinera(${argJs(n.id)})">Editar</button>
        <button class="smallbtn" onclick="generarMensajeCV(${argJs(n.id)})">CV</button>
        <button class="pcard-delete" style="position:static;box-shadow:none;" onclick="conGuardado(this, ()=>eliminarNinera(${argJs(n.id)}))" title="Eliminar niñera" aria-label="Eliminar niñera">${ICONS.trash}</button>
      </div>
    </div>`;
  grid.innerHTML = countMsg + '<div class="person-list">' + completas.map(filaNinera).join('') + '</div>'
    + (parciales.length ? `<div class="helper" style="margin:16px 0 8px;">Solo parte del período (la tira muestra en qué quincenas está en ${zonaLabel}${hayZonaAfuera?'':' — lo pintado es cuándo está afuera'})</div><div class="person-list">${parciales.map(filaNinera).join('')}</div>` : '')
    + (sinDato.length ? `<div class="helper" id="nin-sin-temporada" style="margin:16px 0 8px;">Sin temporada cargada: no sabemos si están en ${zonaLabel} esos meses</div><div class="person-list">${sinDato.map(filaNinera).join('')}</div>` : '');
}
// Sección "Datos de carsitting" reutilizable: busca por nombre (sin importar tildes/mayúsculas)
// contra TODOS los registros de carsitting_datos, sin depender de si ya está en Niñeras o
// todavía en Candidatas — así aparece sola apenas ella manda el form, esté donde esté.
async function cargarCarsittingSeccion(nombre, boxId, tipo, mail){
  const box = document.getElementById(boxId);
  if(!box) return;
  const { data } = await sb.from('carsitting_datos').select('*').order('created_at', {ascending:false});
  const nombreNorm = normaliza(nombre);
  const c = (data||[]).find(r=>normaliza(r.ninera_nombre)===nombreNorm);
  if(c){
    const campos = [
      ['Auto', [c.modelo_auto, c.color_auto].filter(Boolean).join(' · ')],
      ['Padrón / Matrícula', [c.padron, c.matricula].filter(Boolean).join(' · ')],
      ['Año de fabricación', c.anio_fabricacion],
      ['Asientos / Cinturones', [c.cantidad_asientos, c.cantidad_cinturones].filter(Boolean).join(' / ')],
      ['Seguro', [c.compania_seguro, c.tipo_seguro].filter(Boolean).join(' · ')],
      ['Licencia de conducir', [c.numero_licencia, c.anio_licencia?'obtenida '+c.anio_licencia:''].filter(Boolean).join(' · ')],
      ['Libreta de propiedad', c.libreta_propiedad],
      ['Cédula', c.cedula],
    ].filter(([,v])=>v);
    const fotos = [['Foto licencia', c.foto_licencia_url], ['Foto libreta', c.foto_libreta_url], ['Foto asientos', c.foto_asientos_url]].filter(([,v])=>v);
    box.innerHTML = `
      <div style="margin-top:14px;">
        <h2 class="card-section-title" style="margin-top:0;">Datos de carsitting</h2>
        <div class="fichadl">${campos.map(([l,v])=>`<div><b>${l}</b>${escaparHtml(v)}</div>`).join('')}</div>
        ${fotos.length?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">${fotos.map(([l,v])=>`<a href="${urlSegura(v)}" target="_blank" rel="noopener" class="smallbtn">${l}</a>`).join('')}</div>`:''}
      </div>`;
    return;
  }
  // todavía no completó el form -- si hace traslados, ofrecemos mandarle el mail ya armado
  if(tipo==='Traslados' || tipo==='Ambas'){
    const primerNombre = (nombre||'').split(' ')[0];
    const asunto = encodeURIComponent('¡Bienvenida al equipo de traslados de Parents’ Break!');
    const cuerpo = encodeURIComponent(`Hola ${primerNombre},\n\n¡Qué alegría contar con vos para hacer traslados con Parents’ Break! Ya vimos en tu entrevista que tenés licencia de conducir y ganas de sumarte a esta parte del equipo.\n\nPara terminar de darte de alta como carsitter, necesitamos que completes este formulario con los datos de tu auto y algunos datos más:\n\nhttps://forms.gle/J4QXgNJQ8kXMsA4C6\n\nCon esto ya vas a quedar lista para que te empecemos a asignar traslados.\n\nCualquier duda, escribinos.\n\nUn abrazo,\nParents’ Break`);
    const href = `mailto:${escaparHtml(mail)}?subject=${asunto}&body=${cuerpo}`;
    const asuntoPersonal = encodeURIComponent('Parents’ Break');
    const cuerpoPersonal = encodeURIComponent(`Hola ${primerNombre},\n\n\n\nUn abrazo,\nParents’ Break`);
    const hrefPersonal = `mailto:${escaparHtml(mail)}?subject=${asuntoPersonal}&body=${cuerpoPersonal}`;
    box.innerHTML = `
      <div style="margin-top:14px;background:var(--accent-soft);border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="font-size:13px;color:var(--ink);">Hace traslados pero todavía no completó el form de carsitting.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <a class="btn" style="padding:7px 14px;font-size:12.5px;text-decoration:none;" href="${urlSegura(hrefPersonal)}">Mail personalizado</a>
          <a class="btn primary" style="padding:7px 14px;font-size:12.5px;text-decoration:none;" href="${urlSegura(href)}">Enviar mail de carsitting</a>
        </div>
      </div>`;
  }
}
async function verNinera(id){
  await esperarConfigFijos(); // fijos automáticos: saber si hay que sacar los previstos
  const n = ninierasItems.find(x=>x.id===id);
  const cd = datosFichaCandidata(n.candidatas);
  const edadCalculada = calcularEdad(cd.fecha_nacimiento);
  // Si hay fecha de nacimiento cargada, la edad calculada pisa al texto viejo ("19 años")
  // en la lista de campos — así nunca se muestran las dos ni queda la vieja dando vueltas.
  const rows = FICHA_CAMPOS.filter(f=>cd[f.key] && !(f.key==='edad' && edadCalculada!==null)).map(f=>`<div><b>${f.label}</b>${escaparHtml(cd[f.key])}</div>`).join('');
  const edadRow = edadCalculada!==null ? `<div><b>Edad</b>${edadCalculada} años</div>` : '';
  // Aviso si el CV de Canva quedó viejo: cumplió años después de la última vez que se generó.
  const cvDesactualizado = cvEstaDesactualizado(n);
  const fotoHtml = n.foto ? `<img src="${urlSegura(n.foto)}" alt="Foto de ${escaparHtml(n.nombre)}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;margin-bottom:12px;cursor:zoom-in;" onclick="abrirLightboxFoto(${argJs(n.foto)}, ${argJs('Foto de '+n.nombre)})" onerror="this.style.display='none'">` : '';
  abrirModal(`
    ${fotoHtml}
    ${htmlFotoPropuesta(n)}
    <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;padding-right:44px;">
      <h2 style="margin:0 0 10px;">${escaparHtml(n.nombre)} ${resenaBadge ? resenaBadge(n.nombre) : ''}</h2>
      <button class="smallbtn" onclick="abrirModalIncidente(${argJs({ninera_id:n.id, ninera_nombre:n.nombre})})">+ Registrar incidente</button>
    </div>
    ${htmlCambioTelefono(n)}
    ${cvDesactualizado ? `<div class="warnbox" style="margin-bottom:10px;">Cumplió años desde que se generó el CV — convendría rehacerlo.</div>` : ''}
    <div class="fichadl">${edadRow}${rows||(edadRow?'':'<div>Sin más datos.</div>')}<div><b>Zona</b>${escaparHtml(textoZonasConBarrios(n.zona, n.barrios)||'—')}</div><div><b>Teléfono</b><span id="vn-telefono">${escaparHtml(n.telefono||'—')}</span></div><div><b>App</b><span id="vn-app" data-ninera="${escaparHtml(n.id)}">Cargando…</span></div><div><b>Tipo</b>${escaparHtml(n.tipo||'Niñera')}</div>${n.cv_url?`<div><b>CV</b><a href="${urlSegura(n.cv_url)}" target="_blank" rel="noopener">Ver CV</a></div>`:''}<div><b>Cuenta bancaria</b>${escaparHtml(textoCuentasBancarias(n.cuenta_bancaria))}</div><div><b>Notas</b>${escaparHtml(n.notas||'—')}</div></div>
    <div id="vn-carsitting"></div>
    <div id="vn-juguetes"></div>
    <div id="vn-saldo" style="margin-top:18px;"></div>
    <div id="vn-incidentes" style="margin-top:18px;"></div>
    <div id="vn-intermediaciones" style="margin-top:18px;"></div>
    <div style="margin-top:18px;">
      <h2 class="card-section-title" style="margin-top:0;">Sittings y traslados de ${escaparHtml(n.nombre.split(' ')[0])}</h2>
      <div class="grid2">
        <div class="field"><label>Familia</label><select id="vn-familia" onchange="renderNineraHistorial(${argJs(n.id)})"><option value="">Todas</option></select></div>
        <div class="field"><label>Período</label><select id="vn-periodo" onchange="renderNineraHistorial(${argJs(n.id)})">
          <option value="0">Todo</option><option value="7">Últimos 7 días</option><option value="15">Últimos 15 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option>
        </select></div>
      </div>
      <div id="vn-historial"><div class="empty"><span class="spinner dark"></span> Cargando…</div></div>
    </div>`);
  cargarEstadoAppNinera(n.id);
  if(n.foto_propuesta_ruta) cargarFotoPropuesta(n.id, n.foto_propuesta_ruta);
  cargarCarsittingSeccion(n.nombre, 'vn-carsitting', n.tipo, cd.mail);
  cargarJuguetesDeNinera(n.nombre);
  renderIncidentesEnFicha('vn-incidentes', 'ninera', n.id, n.nombre);
  pintarSaldoEnFicha('vn-saldo', 'ninera', n.id, n.nombre);
  renderIntermediacionesEnFicha('vn-intermediaciones', n.id);
  // cargar los sittings de esta niñera y sus reseñas (si no están cargadas ya globalmente) en paralelo
  const necesitaResenas = !Object.keys(sitHistResenas).length;
  const [{data}, resenasRes] = await Promise.all([
    sinPrevistos(sb.from('sittings_traslados').select('*')).eq('ninera_nombre', n.nombre).order('fecha', {ascending:false}),
    necesitaResenas ? sb.from('resenas_ninieras').select('ninera_nombre,puntuacion') : Promise.resolve({data:null}),
  ]);
  nineraHistItems = data || [];
  if(necesitaResenas){
    (resenasRes.data||[]).forEach(r=>{
      if(r.puntuacion==null) return;
      const k = normaliza(r.ninera_nombre||'');
      if(!k) return;
      if(!sitHistResenas[k]) sitHistResenas[k] = {suma:0, cant:0};
      sitHistResenas[k].suma += Number(r.puntuacion);
      sitHistResenas[k].cant += 1;
    });
  }
  const sel = document.getElementById('vn-familia');
  if(sel){
    const famMap = new Map();
    nineraHistItems.forEach(s=>{
      const raw = (s.familia_nombre||'').trim();
      if(!raw) return;
      const key = normaliza(raw);
      if(!famMap.has(key)) famMap.set(key, raw);
    });
    const fams = [...famMap.entries()].sort((a,b)=>a[1].localeCompare(b[1]));
    sel.innerHTML = `<option value="">Todas</option>` + fams.map(([key,label])=>`<option value="${escaparHtml(key)}">${escaparHtml(label)}</option>`).join('');
  }
  renderNineraHistorial(n.id);
}
// Cambio de celular pedido desde la página de temporada (entró con nombre porque su número
// no coincidía con el cargado). No se aplica solo: Pau o Delfi lo aceptan o lo descartan.
function htmlCambioTelefono(n){
  if(!n || !n.telefono_pendiente) return '';
  const cuando = n.telefono_pendiente_en ? new Date(n.telefono_pendiente_en).toLocaleDateString('es-UY',{day:'numeric',month:'short'}) : '';
  return `
    <div id="cambio-tel-box" style="background:var(--accent-soft);border-radius:12px;padding:12px 14px;margin:0 0 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
      <div style="font-size:13px;line-height:1.5;">
        <div style="font-weight:600;">Pidió cambiar su celular${cuando?` el ${cuando}`:''}</div>
        <div>Nuevo: <span style="font-family:'IBM Plex Mono',monospace;">${escaparHtml(n.telefono_pendiente)}</span>. Ahora: <span style="font-family:'IBM Plex Mono',monospace;">${escaparHtml(n.telefono||'sin celular')}</span></div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn ghost" style="padding:7px 14px;font-size:12.5px;" onclick="conGuardado(this, ()=>resolverCambioTelefono(${argJs(n.id)}, false))">Descartar</button>
        <button class="btn primary" style="padding:7px 14px;font-size:12.5px;" onclick="conGuardado(this, ()=>resolverCambioTelefono(${argJs(n.id)}, true))">Aceptar</button>
      </div>
    </div>`;
}
async function resolverCambioTelefono(id, aceptar){
  const n = ninierasItems.find(x=>x.id===id);
  if(!n || !n.telefono_pendiente) return;
  const cambios = { telefono_pendiente: null, telefono_pendiente_en: null };
  if(aceptar) cambios.telefono = n.telefono_pendiente;
  const { error } = await sb.from('ninieras').update(cambios).eq('id', id);
  if(error){ toast('No se pudo guardar: '+error.message, 'bad'); return; }
  const nuevo = n.telefono_pendiente;
  Object.assign(n, cambios);
  const box = document.getElementById('cambio-tel-box');
  if(box) box.remove();
  // Si está en "Editar", el campo de teléfono queda con el número nuevo (si no, al guardar
  // la edición se volvería a pisar con el viejo).
  const campo = document.getElementById('ed-telefono');
  if(campo && aceptar) campo.value = nuevo;
  const enFicha = document.getElementById('vn-telefono');
  if(enFicha && aceptar) enFicha.textContent = nuevo;
  filtrarNinieras();
  toast(aceptar ? 'Celular actualizado.' : 'Cambio descartado, queda el celular de antes.');
}
/* ---- App de niñeras (fase 1, 26/10/2026) ----
   La ficha muestra en qué anda la cuenta de la niñera y arma el link de invitación (o de cambio
   de contraseña, si ya tiene cuenta). El link lo crea la base (crear_invitacion_ninera: invalida
   el anterior y vence solo) y el mensaje NUNCA sale solo: la admin lo copia o abre WhatsApp. */
// dd/mm en hora de Montevideo. Se arma a mano: con 'es-UY', day:'2-digit' igual da "3/10".
function fechaCortaApp(iso){
  const partes = new Intl.DateTimeFormat('es-UY', { day:'numeric', month:'numeric', timeZone:'America/Montevideo' }).formatToParts(new Date(iso));
  const p = t => (partes.find(x=>x.type===t)?.value || '').padStart(2, '0');
  return `${p('day')}/${p('month')}`;
}
// Pura (sin DOM): n es la fila de ninieras, invitacion la última de ninera_invitaciones (o null)
// y pushs cuántos dispositivos de esa cuenta tienen los avisos prendidos.
function estadoAppNinera(n, invitacion, pushs){
  let texto = 'Sin app', linkVigente = false;
  if(n.user_id){
    texto = (n.app_activada_en ? `App activa desde ${fechaCortaApp(n.app_activada_en)}` : 'App activa')
      + (pushs > 0 ? ' · avisos activados' : ' · sin avisos');
  } else if(invitacion && !invitacion.usada_en && !invitacion.reemplazada_en && invitacion.vence_en){
    linkVigente = new Date(invitacion.vence_en).getTime() > Date.now();
    texto = linkVigente
      ? `Invitada el ${fechaCortaApp(invitacion.creada_en)}, el link vence el ${fechaCortaApp(invitacion.vence_en)}`
      : `Link vencido el ${fechaCortaApp(invitacion.vence_en)}`;
  }
  let motivo = '';
  if(!n.activa) motivo = 'Está inactiva';
  else if(!normalizarCelular(n.telefono)) motivo = 'Cargá un celular uruguayo válido para invitarla';
  return { texto, puedeInvitar: !motivo, motivo, esReset: !!n.user_id, linkVigente };
}
// Perfil desde la app (etapa 2, 27/10/2026): perfil_app_en es el primer guardado y
// perfil_actualizado_en el último. La niñera puede cambiar su cuenta bancaria desde la app, así que
// la ficha dice también cuándo editó por última vez (con un minuto de margen: el primer guardado
// escribe las dos columnas casi juntas). Pura: con la base sin migrar no hay columnas y da ''.
function textoPerfilApp(n){
  if(!n || !n.perfil_app_en) return '';
  let texto = `Perfil completado en la app el ${fechaCortaApp(n.perfil_app_en)}`;
  if(n.perfil_actualizado_en && new Date(n.perfil_actualizado_en).getTime() - new Date(n.perfil_app_en).getTime() > 60000){
    texto += `, editado el ${fechaCortaApp(n.perfil_actualizado_en)}`;
  }
  return texto;
}
async function cargarEstadoAppNinera(id){
  const n = ninierasItems.find(x=>x.id===id);
  if(!n) return;
  const [inv, push] = await Promise.all([
    sb.from('ninera_invitaciones').select('vence_en,usada_en,reemplazada_en,creada_en')
      .eq('ninera_id', id).order('creada_en', { ascending:false }).limit(1),
    n.user_id ? sb.from('push_subscriptions').select('id').eq('user_id', n.user_id) : Promise.resolve({ data: [] }),
  ]);
  const cont = document.getElementById('vn-app');
  // La ficha se cerró o ya es la de otra niñera (se abrió otra mientras esto cargaba): no se pinta.
  if(!cont || cont.dataset.ninera !== id) return;
  // El perfil completado sale de la fila de ninieras: se muestra aunque falle la lectura del estado.
  const perfil = textoPerfilApp(n);
  const perfilHtml = perfil ? `<div class="helper" style="margin-top:4px;">${escaparHtml(perfil)}</div>` : '';
  if(inv.error || push.error){ cont.innerHTML = `<span>No se pudo cargar el estado de la app</span>${perfilHtml}`; return; }
  const est = estadoAppNinera(n, (inv.data||[])[0] || null, (push.data||[]).length);
  const etiqueta = est.esReset ? 'Link para cambiar la contraseña' : 'Invitar a la app';
  cont.innerHTML = `<span>${escaparHtml(est.texto)}</span> `
    + (est.puedeInvitar
      ? `<button class="smallbtn" onclick="conGuardado(this, ()=>abrirInvitacionApp(${argJs(id)}, ${est.linkVigente}))">${etiqueta}</button>`
      : `<button class="smallbtn" disabled>${etiqueta}</button><div class="helper" style="margin-top:4px;">${escaparHtml(est.motivo)}</div>`)
    + perfilHtml;
}
const ERRORES_INVITACION = {
  ninera_inactiva: 'la niñera está inactiva',
  celular_invalido: 'el celular no es válido',
  no_autorizada: 'tu cuenta no tiene permiso',
  ninera_no_encontrada: 'no se encontró la niñera',
};
let invitacionAppMensaje = '';
// Celular repetido (26/10/2026): la cuenta es una por celular (el mail sintético sale de él), así que
// una segunda ficha con el mismo celular no puede tener cuenta: Auth la rechaza con email_exists y la
// niñera ve un error genérico. Se controla antes de invitar, contra TODAS las fichas (también las
// inactivas, que cargarNinieras no trae; son unas 100 filas, una sola lectura). Devuelve las otras
// fichas con ese celular, o null si no se pudo leer.
async function fichasConMismoCelular(id, telefono){
  const { data, error } = await sb.from('ninieras').select('id,nombre,telefono,activa');
  if(error || !Array.isArray(data)) return null;
  const propio = normalizarCelular((data.find(x=>x.id===id) || {}).telefono ?? telefono);
  if(!propio) return [];
  return data.filter(x=>x.id!==id && normalizarCelular(x.telefono)===propio);
}
async function abrirInvitacionApp(id, linkVigente=false){
  const n = ninierasItems.find(x=>x.id===id);
  if(!n) return;
  // Nunca se invita sin saber si el celular está repetido: si la lectura falla, no se crea el link.
  const repetidas = await fichasConMismoCelular(id, n.telefono);
  if(!repetidas){ toast('No se pudo verificar el celular: revisá la conexión e intentá de nuevo.', 'bad'); return; }
  // En la fila "App" y no en un toast: hay que leer el nombre e ir a corregir una de las dos fichas.
  const cont = document.getElementById('vn-app');
  cont?.querySelector('.app-celular-repetido')?.remove();
  if(repetidas.length){
    const lista = repetidas.map(x=>`${(x.nombre||'').trim() || 'Sin nombre'} (${x.activa ? 'activa' : 'inactiva'})`).join(', ');
    const aviso = `Otra ficha tiene el mismo celular: ${lista}. Corregí el celular en una de las dos antes de invitar.`;
    if(cont && cont.dataset.ninera === id) cont.insertAdjacentHTML('beforeend', `<div class="warnbox app-celular-repetido" style="margin-top:8px;">${escaparHtml(aviso)}</div>`);
    else toast(aviso, 'bad'); // toast usa textContent: no hace falta escapar
    return;
  }
  // Cada link nuevo invalida el anterior: si ya le mandaron uno que todavía sirve, se pregunta antes.
  if(linkVigente && !(await confirmarAccion('Ya tiene un link vigente, que deja de servir si creás otro. ¿Crear otro?', 'Crear otro link'))) return;
  const { data, error, status } = await sb.rpc('crear_invitacion_ninera', { p_ninera_id: id });
  const fila = Array.isArray(data) ? data[0] : data;
  if(error || !fila || !fila.token){
    // Sin respuesta de la base (status 0) es la conexión: no se muestra el "TypeError: Failed to fetch".
    const msg = !error ? 'la base no devolvió el link'
      : !status ? 'revisá la conexión e intentá de nuevo.'
      : (ERRORES_INVITACION[error.message] || error.message);
    toast('No se pudo crear el link: ' + msg, 'bad');
    return;
  }
  const link = `${new URL('ninera/', location.href).href}?i=${encodeURIComponent(fila.token)}`;
  const nombre = (n.nombre||'').trim().split(/\s+/)[0];
  const dias = Math.max(1, Math.round((new Date(fila.vence_en).getTime() - Date.now()) / 86400000)) || 7;
  const vale = `Vale por ${dias} ${dias===1 ? 'día' : 'días'}.`;
  // Textos de docs/fase1/textos.md, sección 2 (a la niñera, en "tú").
  invitacionAppMensaje = fila.es_reset
    ? `¡Hola ${nombre}! Con este link puedes crear una contraseña nueva: ${link}. ${vale}`
    : `¡Hola ${nombre}! Desde ahora los pedidos de Parents' Break te van a llegar por nuestra app. Haz click aquí para crear tu usuario y contraseña: ${link}. ${vale}`;
  const titulo = fila.es_reset ? 'Link para cambiar la contraseña' : 'Invitar a la app';
  cerrarInvitacionApp();
  // Va en un modal aparte, encima de la ficha: al cerrarlo la ficha sigue ahí, con la fila "App" al día.
  const overlay = document.createElement('div');
  overlay.className = 'confirmoverlay';
  overlay.id = 'invitar-overlay';
  overlay.innerHTML = `
    <div class="confirmbox wide" role="dialog" aria-label="${titulo}">
      <h2 style="margin:0 0 4px;">${titulo}</h2>
      <div class="helper" style="margin:0 0 12px;">Mandale este mensaje a ${escaparHtml(nombre)} por WhatsApp. El link sirve una sola vez.</div>
      <div id="invitar-mensaje" style="white-space:pre-wrap;overflow-wrap:anywhere;background:var(--accent-soft);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.5;">${escaparHtml(invitacionAppMensaje)}</div>
      <div class="confirmbtns" style="flex-wrap:wrap;">
        <button class="btn ghost" onclick="cerrarInvitacionApp()">Cerrar</button>
        <button class="btn" onclick="copiarMensajeInvitacion()">Copiar mensaje</button>
        <a class="btn primary" href="${urlSegura(waLink(n.telefono, invitacionAppMensaje))}" target="_blank" rel="noopener">Abrir WhatsApp</a>
      </div>
    </div>`;
  overlay.addEventListener('click', e=>{ if(e.target===overlay) cerrarInvitacionApp(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(()=>overlay.classList.add('show'));
  cargarEstadoAppNinera(id);
}
async function copiarMensajeInvitacion(){
  await copiarAlPortapapeles(invitacionAppMensaje, 'Mensaje copiado. Pegalo en WhatsApp.');
  // Sin portapapeles, copiarAlPortapapeles pone el texto en el modal de abajo: se cierra este para verlo.
  if(document.getElementById('copiar-a-mano')) cerrarInvitacionApp();
}
function cerrarInvitacionApp(){
  const o = document.getElementById('invitar-overlay');
  if(!o) return;
  o.classList.remove('show');
  o.id = '';
  setTimeout(()=>o.remove(), 180);
}
let nineraHistItems = [];
function renderNineraHistorial(id){
  const cont = document.getElementById('vn-historial');
  if(!cont) return;
  const famF = document.getElementById('vn-familia')?.value||'';
  const periodo = parseInt(document.getElementById('vn-periodo')?.value||'0');
  let items = nineraHistItems.slice();
  if(famF) items = items.filter(s=>normaliza(s.familia_nombre)===famF);
  if(periodo>0){
    const limiteISO = sumarDiasISO(todayISO(), -periodo);
    items = items.filter(s=>s.fecha && s.fecha >= limiteISO);
  }
  if(!items.length){ cont.innerHTML = '<div class="empty">No hay sittings registrados con estos filtros.</div>'; return; }
  const totalPago = items.reduce((s,r)=>s+(Number(r.pago_ninera)||0),0);
  cont.innerHTML = `
    <div class="helper" style="margin:8px 0;">${items.length} registro(s) · total pagado a la niñera: $${totalPago.toLocaleString('es-UY')}</div>
    <div class="tablewrap"><table class="asigtable"><thead><tr><th>Fecha</th><th>Familia</th><th>Cobro</th><th>Pago</th></tr></thead>
    <tbody>${items.map(r=>{
      const fechaFmt = r.fecha ? new Date(r.fecha+'T00:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'short'}) : '—';
      return `<tr><td>${fechaFmt}</td><td>${escaparHtml(r.familia_nombre)}</td><td>${plataFin(r.cobro_familia)}</td><td>${plataFin(r.pago_ninera)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}
/* Alta directa de una niñera (05/10/2026, E5). Antes la única forma era pasar por toda la
   entrevista de RR.HH. (o crearla al vuelo desde un sitting). Nombre y celular son obligatorios
   (el celular, salvo que solo haga traslados; 27/10/2026); lo demás se puede completar después
   con "Editar". */
function abrirModalNuevaNinera(){
  abrirModal(`
    <h2 style="margin:0 0 6px;">Nueva niñera</h2>
    <div class="helper" style="margin-bottom:14px;">Nombre y celular son obligatorios (el celular, salvo que solo haga traslados). Lo demás (foto, fecha de nacimiento, temporada, categorías) se completa después desde "Editar".</div>
    <div class="grid2">
      <div class="field"><label>Nombre</label><input type="text" id="nn-nombre" autocomplete="off"></div>
      <div class="field"><label>Celular</label><input type="tel" id="nn-telefono"></div>
      <div class="field"><label>Tipo</label><select id="nn-tipo"><option>Niñera</option><option>Traslados</option><option>Ambas</option></select></div>
    </div>
    ${checklistZonas('nn', '', 'Zonas (opcional)')}
    ${htmlCuentasBancarias('nn', [])}
    <div class="field"><label>Notas (opcional)</label><textarea id="nn-notas"></textarea></div>
    <div class="confirmbtns">
      <button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primary" onclick="conGuardado(this, ()=>addNinera())">Agregar niñera</button>
    </div>`);
  setTimeout(()=>document.getElementById('nn-nombre')?.focus(), 30);
  protegerModal('ninera:nueva');
}
async function addNinera(){
  const nombre = document.getElementById('nn-nombre').value.trim().replace(/\s+/g, ' ');
  if(!nombre){ toast('Falta el nombre.', 'bad'); return; }
  const telefono = document.getElementById('nn-telefono').value.trim();
  const tipo = document.getElementById('nn-tipo').value || 'Niñera';
  const problemaCel = problemaCelularNinera(telefono, tipo);
  if(problemaCel){ toast(problemaCel, 'bad'); document.getElementById('nn-telefono').focus(); return; }
  if(!(await confirmarNombreNuevo(nombre, ninierasItems||[], 'niñera'))) return;
  const notas = document.getElementById('nn-notas').value.trim();
  const ninera = {
    nombre,
    telefono: telefono || null,
    tipo,
    zona: leerZonasChecklist('nn') || null,
    cuenta_bancaria: leerCuentasBancarias('nn'),
    notas: notas || null,
    activa: true,
  };
  const { error } = await sb.from('ninieras').insert(ninera);
  if(error){ toast('No se pudo agregar: '+error.message, 'bad'); return; }
  cerrarModal();
  toast(`${nombre} ya está en Niñeras.`);
  await cargarNinieras();
}
function editarNinera(id){
  const n = ninierasItems.find(x=>x.id===id);
  // Si le falta la temporada, se pide antes de la edición normal (con "Omitir por ahora").
  if(n && estadoTemporada(n)!=='ok' && !ninTempOmitidas.has(id) && gruposParaEditor(n).length){
    abrirPasoTemporada(id);
    return;
  }
  const tipos = ['Niñera','Traslados','Ambas'];
  ninEditCandidataCache = datosFichaCandidata(n.candidatas);
  registrarRenderizadorZona('ed', ()=>editarNinera(id));
  abrirModal(`
    <h2 style="margin:0 0 12px;">Editar a ${escaparHtml(n.nombre)}</h2>
    ${htmlCambioTelefono(n)}
    <div style="margin-bottom:14px;">
      <div id="ed-foto-preview" style="width:100%;height:160px;border-radius:12px;background:var(--bg);border:1px dashed var(--line);display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:12px;color:var(--ink-soft);">
        ${n.foto?`<img src="${urlSegura(n.foto)}" style="width:100%;height:100%;object-fit:cover;">`:'sin foto'}
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap;">
        <input type="file" accept="image/*" id="ed-foto-input" style="font-size:12px;" onchange="subirFotoNinera(this)">
        <button class="smallbtn" type="button" onclick="quitarFotoNinera()">Quitar foto</button>
      </div>
      <div id="ed-foto-status" class="helper" style="margin:2px 0 0;"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Nombre</label><input type="text" id="ed-nombre" value="${escaparHtml(n.nombre)}"></div>
      <div class="field"><label>Celular</label><input type="tel" id="ed-telefono" value="${escaparHtml(n.telefono)}"></div>
      <div class="field"><label>Tipo</label><select id="ed-tipo">${tipos.map(t=>`<option ${n.tipo===t?'selected':''}>${t}</option>`).join('')}</select></div>
    </div>
    ${htmlCuentasBancarias('ed', n.cuenta_bancaria)}
    ${checklistZonas('ed', n.zona)}
    ${htmlBarriosMarcados(n.zona, n.barrios)}
    ${gruposParaEditor(n).length ? `
    <div class="field">
      <label>Temporada de verano</label>
      <div class="helper" style="margin:0 0 4px;">Quincenas en que está en Punta del Este. Tocá el mes para marcarlo entero. Lo que no esté marcado cuenta como que está en Montevideo o Canelones.${temporadaCargada(n)?` Última actualización: ${textoFuenteTemporada(n)}.`:''}</div>
      ${htmlEditorTemporada('ed-temp', gruposParaEditor(n), n.temporada)}
      <span data-temp-guardar="ed-temp" style="display:none;"></span>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
        <button type="button" class="smallbtn" onclick="setTodasQuincenas('ed-temp', true)">Todo el año</button>
        <button type="button" class="smallbtn" onclick="setTodasQuincenas('ed-temp', false)">No va</button>
      </div>
    </div>` : ''}
    <div class="field"><label>Notas</label><textarea id="ed-notas">${escaparHtml(n.notas)}</textarea></div>
    <div class="field">
      <label>Fecha de nacimiento</label>
      <input type="date" id="ed-fecha-nac" value="${escaparHtml(n.candidatas && n.candidatas.fecha_nacimiento)}" onchange="ocultarEdadViejaSiHayFecha(this)">
      <div class="helper" style="margin:4px 0 0;">Con esto cargado, la edad se calcula sola en todos lados (ficha y CV) — no vuelve a quedar vieja.</div>
    </div>
    <div id="ed-extra-fields"></div>
    <button class="btn" type="button" style="width:100%;margin-top:10px;" onclick="abrirSelectorCategoriaNinera()">+ Agregar categorías</button>
    <div class="confirmbtns" style="margin-top:18px;">
      <button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primary" onclick="conGuardado(this, ()=>guardarEdicionNinera(${argJs(id)}))">Guardar</button>
    </div>`);
  ninFotoUrlPendiente = n.foto || null;
  // precargar los campos de categorías que ya tenían datos cargados —
  // si no se hace esto, al reabrir "Editar" los campos con dato quedaban
  // invisibles (solo se veían en "Ver ficha") y no había forma de corregirlos
  // La fecha de nacimiento tiene su calendario propio arriba: no va también como categoría de
  // texto (21/10/2026, aparecía dos veces, "2005-07-05" debajo del calendario).
  FICHA_CAMPOS.forEach(f=>{
    if(!['nombre','apellido','telefono','zona','fecha_nacimiento'].includes(f.key) && ninEditCandidataCache[f.key]){
      agregarCampoExtraNinera(f.key);
    }
  });
  // Si ya tenía fecha de nacimiento real cargada de antes, la fila de "Edad (texto viejo)"
  // que se acaba de precargar arriba tampoco hace falta -- se saca también acá, no solo
  // cuando la fecha se carga recién en este momento (ver ocultarEdadViejaSiHayFecha).
  if(ninEditCandidataCache.fecha_nacimiento){
    const filaEdad = document.querySelector('#ed-extra-fields [data-campo="edad"]');
    if(filaEdad) filaEdad.closest('.field').remove();
  }
  protegerModal('ninera:'+id); // borrador y aviso antes de cerrar con cambios (21/10/2026)
}
// Al cargar una fecha de nacimiento real, la fila de "Edad (texto viejo)" ya no aporta nada
// -- se saca de la vista al toque (el guardado también la limpia en la base, más abajo).
function ocultarEdadViejaSiHayFecha(inputFecha){
  if(!inputFecha.value) return;
  const filaEdad = document.querySelector('#ed-extra-fields [data-campo="edad"]');
  if(filaEdad) filaEdad.closest('.field').remove();
}
function quitarFotoNinera(){
  ninFotoUrlPendiente = null;
  document.getElementById('ed-foto-preview').innerHTML = 'sin foto';
  const input = document.getElementById('ed-foto-input');
  if(input) input.value = '';
}
let ninEditCandidataCache = {};
function abrirSelectorCategoriaNinera(){
  const yaAgregadas = new Set([...document.querySelectorAll('#ed-extra-fields [data-campo]')].map(el=>el.dataset.campo));
  // "edad" no se ofrece más para agregar -- el campo correcto para cargar el cumpleaños es
  // la fecha de nacimiento (más abajo, con calendario). Si una niñera ya tenía texto viejo
  // ahí, sigue precargado y editable (ver el forEach de arriba) -- esto solo saca la opción
  // para las que no tienen nada, así no se vuelve a usar el campo de texto libre.
  const disponibles = FICHA_CAMPOS.filter(f=>!['nombre','apellido','telefono','zona','edad','fecha_nacimiento'].includes(f.key) && !yaAgregadas.has(f.key));
  const seleccionadas = new Set();
  const overlay = document.createElement('div');
  overlay.className = 'confirmoverlay';
  overlay.innerHTML = `
    <div class="confirmbox" style="max-width:480px;max-height:78vh;overflow-y:auto;text-align:left;">
      <h2 style="margin:0 0 4px;">Agregar categorías</h2>
      <div class="helper" style="margin:0 0 14px;">Elegí las que quieras agregar a la ficha.</div>
      <div id="cat-picker-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div class="confirmbtns" style="margin-top:16px;">
        <button class="btn ghost" id="cat-picker-cancelar">Cancelar</button>
        <button class="btn primary" id="cat-picker-confirmar">Confirmar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(()=>overlay.classList.add('show'));
  const lista = overlay.querySelector('#cat-picker-list');
  if(!disponibles.length){
    lista.innerHTML = '<div class="helper" style="margin:0;">Ya agregaste todas las categorías disponibles.</div>';
  }
  disponibles.forEach(f=>{
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border:1px solid var(--line);border-radius:8px;cursor:pointer;';
    row.innerHTML = `<span style="font-size:13px;">${f.label}${ninEditCandidataCache[f.key]?' <span class="helper" style="margin:0;">(con dato)</span>':''}</span><span data-marca style="font-size:12px;font-weight:600;color:var(--accent);">+</span>`;
    row.addEventListener('click', ()=>{
      if(seleccionadas.has(f.key)){
        seleccionadas.delete(f.key);
        row.style.background = '';
        row.querySelector('[data-marca]').textContent = '+';
      } else {
        seleccionadas.add(f.key);
        row.style.background = 'var(--accent-soft)';
        row.querySelector('[data-marca]').textContent = 'agregada';
      }
    });
    lista.appendChild(row);
  });
  function cerrar(){ overlay.classList.remove('show'); setTimeout(()=>overlay.remove(), 180); }
  overlay.addEventListener('click', e=>{ if(e.target===overlay) cerrar(); });
  overlay.querySelector('#cat-picker-cancelar').addEventListener('click', cerrar);
  overlay.querySelector('#cat-picker-confirmar').addEventListener('click', ()=>{
    seleccionadas.forEach(key=>agregarCampoExtraNinera(key));
    cerrar();
  });
}
function agregarCampoExtraNinera(key){
  const campo = FICHA_CAMPOS.find(f=>f.key===key);
  if(!campo) return;
  const cont = document.getElementById('ed-extra-fields');
  if(cont.querySelector(`[data-campo="${key}"]`)) return; // ya está agregado
  const row = document.createElement('div');
  row.className = 'field';
  row.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <label style="margin:0;">${campo.label}</label>
      <button type="button" title="Quitar esta categoría" aria-label="Quitar esta categoría" onclick="this.closest('.field').remove()" style="width:20px;height:20px;border-radius:50%;border:none;background:var(--bad);color:#fff;font-size:15px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;flex-shrink:0;">−</button>
    </div>
    <textarea data-campo="${key}" rows="2">${escaparHtml(ninEditCandidataCache[key])}</textarea>`;
  cont.appendChild(row);
}
async function subirFotoNinera(input){
  const original = input.files[0];
  if(!original) return;
  const status = document.getElementById('ed-foto-status');
  status.textContent = 'Subiendo...';
  const file = await achicarFoto(original);
  const path = `ninera-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g,'_')}`;
  const { error } = await sb.storage.from('ninieras-fotos').upload(path, file, { upsert:true, contentType: file.type || undefined });
  if(error){ status.textContent = 'Error al subir: '+error.message; return; }
  const { data:pub } = sb.storage.from('ninieras-fotos').getPublicUrl(path);
  ninFotoUrlPendiente = pub.publicUrl;
  document.getElementById('ed-foto-preview').innerHTML = `<img src="${urlSegura(ninFotoUrlPendiente)}" style="width:100%;height:100%;object-fit:cover;">`;
  status.textContent = 'Foto lista.';
}
let ninFotoUrlPendiente = null;
/* ---- Foto propuesta por la niñera (fase 1, etapa 2, 27/10/2026) ----
   La foto que la niñera sube desde su app NO reemplaza la del CV (la ven las madres): queda en el
   bucket privado 'ninieras-privado' (fotos/<id>/propuesta.jpg) y una admin la usa o la descarta
   desde la ficha. Con la base sin migrar la fila no trae foto_propuesta_ruta: no hay bloque. */
function htmlFotoPropuesta(n){
  if(!n || !n.foto_propuesta_ruta) return '';
  const cuando = n.foto_propuesta_en ? ` el ${fechaCortaApp(n.foto_propuesta_en)}` : '';
  return `
    <div id="vn-foto-propuesta" style="background:var(--accent-soft);border-radius:12px;padding:12px 14px;margin:0 0 12px;max-width:100%;box-sizing:border-box;">
      <div style="font-weight:600;font-size:13px;padding-right:36px;">Foto propuesta por la niñera${cuando}</div>
      <div id="vn-foto-propuesta-img" data-ninera="${escaparHtml(n.id)}" style="margin:8px 0;font-size:13px;">Cargando…</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn ghost" style="padding:7px 14px;font-size:12.5px;" onclick="conGuardado(this, ()=>descartarFotoPropuesta(${argJs(n.id)}, ${argJs(n.foto_propuesta_en)}))">Descartar</button>
        <button class="btn primary" style="padding:7px 14px;font-size:12.5px;" onclick="conGuardado(this, ()=>aprobarFotoPropuesta(${argJs(n.id)}, ${argJs(n.foto_propuesta_en)}))">Usar como foto del CV</button>
      </div>
    </div>`;
}
// El bucket es privado: la imagen se ve con una URL firmada por 10 minutos (lo que dura mirar la ficha).
async function cargarFotoPropuesta(id, ruta){
  let url = null;
  try {
    const { data, error } = await sb.storage.from('ninieras-privado').createSignedUrl(ruta, 600);
    if(!error) url = data?.signedUrl || null;
  } catch(e){ url = null; }
  const cont = document.getElementById('vn-foto-propuesta-img');
  // La ficha se cerró o ya es la de otra niñera: no se pinta.
  if(!cont || cont.dataset.ninera !== id) return;
  if(!url){ cont.textContent = 'No se pudo mostrar la foto'; return; }
  cont.innerHTML = `<img src="${urlSegura(url)}" alt="Foto propuesta" style="width:96px;height:96px;border-radius:50%;object-fit:cover;cursor:zoom-in;" onclick="abrirLightboxFoto(this.src, 'Foto propuesta')" onerror="this.parentElement.textContent='No se pudo mostrar la foto'">`;
}
// La niñera puede mandar otra foto (misma ruta, upsert) mientras la admin mira la ficha: el update
// va con la condición de foto_propuesta_en tal como se pintó (`antes`), como las marcas que dos
// admins pueden cambiar a la vez. Devuelve 'ok', 'cambio' (no se actualizó ninguna fila: la foto
// ya es otra) o 'error' (ya avisado, como sbGuardar).
async function guardarSiFotoPropuestaNoCambio(id, antes, cambios, queCosa){
  try {
    let q = sb.from('ninieras').update(cambios).eq('id', id);
    q = antes == null ? q.is('foto_propuesta_en', null) : q.eq('foto_propuesta_en', antes);
    const { data, error } = await q.select('id');
    if(error){
      console.error('[Supabase] al guardar', queCosa, error);
      toast(`No se pudo guardar ${queCosa}: ${error.message}`, 'bad');
      return 'error';
    }
    return (data || []).length ? 'ok' : 'cambio';
  } catch(e){
    console.error('[Supabase] al guardar', queCosa, e);
    toast(`No se pudo guardar ${queCosa}. Revisá tu conexión.`, 'bad');
    return 'error';
  }
}
// Relee solo las columnas de la foto (no toda la lista) y repinta: la ficha muestra lo que hay ahora.
async function avisarFotoPropuestaCambiada(id){
  toast('La niñera mandó otra foto mientras la mirabas. Volvé a abrir la ficha.', 'bad');
  const n = ninierasItems.find(x=>x.id===id);
  if(!n) return;
  const { data, error } = await sb.from('ninieras').select('foto,foto_propuesta_ruta,foto_propuesta_en').eq('id', id);
  if(!error && data && data[0]) Object.assign(n, data[0]);
  verNinera(id);
}
// Copia la propuesta al bucket público del CV y recién después cambia la ficha (el update va
// último: si algo falla antes, la ficha queda como estaba). El nombre es nuevo cada vez, como en
// subirFotoNinera: pisar un nombre fijo cambiaría la foto del CV antes del update (y si el update
// falla quedaría a medias), y el navegador seguiría mostrando la vieja desde su caché.
async function aprobarFotoPropuesta(id, antes){
  const n = ninierasItems.find(x=>x.id===id);
  if(!n || !n.foto_propuesta_ruta) return;
  const ruta = n.foto_propuesta_ruta;
  let blob = null;
  try {
    const { data, error } = await sb.storage.from('ninieras-privado').download(ruta);
    if(!error) blob = data;
  } catch(e){ blob = null; }
  if(!blob){ toast('No se pudo descargar la foto propuesta', 'bad'); return; }
  // La app de niñeras sube el tipo real (JPG, PNG o WEBP) aunque la ruta diga .jpg.
  const ext = { 'image/png':'png', 'image/webp':'webp' }[blob.type] || 'jpg';
  const nombre = `ninera-${Date.now()}-${id}.${ext}`;
  const publico = sb.storage.from('ninieras-fotos');
  let subida = false;
  try {
    const { error } = await publico.upload(nombre, blob, { upsert:true, contentType: blob.type || undefined });
    subida = !error;
  } catch(e){ subida = false; }
  if(!subida){ toast('No se pudo subir la foto al CV', 'bad'); return; }
  const cambios = { foto: publico.getPublicUrl(nombre).data.publicUrl, foto_propuesta_ruta: null, foto_propuesta_en: null };
  const resultado = await guardarSiFotoPropuestaNoCambio(id, antes, cambios, 'la foto del CV');
  if(resultado !== 'ok'){
    // Que la copia no quede suelta en el bucket público: no la usa ninguna ficha. La propuesta
    // privada no se toca (si cambió, es la foto nueva de la niñera).
    try { await publico.remove([nombre]); } catch(e){ /* nada más que hacer */ }
    if(resultado === 'cambio') await avisarFotoPropuestaCambiada(id);
    return;
  }
  // Ya no se muestra en ningún lado: si no se puede borrar, solo se anota.
  try {
    const { error } = await sb.storage.from('ninieras-privado').remove([ruta]);
    if(error) console.warn('[foto propuesta] no se pudo borrar', error);
  } catch(e){ console.warn('[foto propuesta] no se pudo borrar', e); }
  Object.assign(n, cambios);
  filtrarNinieras();
  verNinera(id);
  toast('Foto del CV actualizada.');
}
// Primero limpia la ficha (con la condición de `antes`) y recién después borra el archivo: así nunca
// se borra una foto que la niñera mandó mientras la admin miraba. Si el borrado falla, la ficha ya
// no la muestra y la próxima foto de la niñera la pisa (misma ruta): solo se anota.
async function descartarFotoPropuesta(id, antes){
  const n = ninierasItems.find(x=>x.id===id);
  if(!n || !n.foto_propuesta_ruta) return;
  const ruta = n.foto_propuesta_ruta;
  if(!(await confirmarAccion('¿Descartar la foto propuesta?', 'Descartar la foto'))) return;
  const cambios = { foto_propuesta_ruta: null, foto_propuesta_en: null };
  const resultado = await guardarSiFotoPropuestaNoCambio(id, antes, cambios, 'los cambios');
  if(resultado === 'cambio'){ await avisarFotoPropuestaCambiada(id); return; }
  if(resultado !== 'ok') return;
  try {
    const { error } = await sb.storage.from('ninieras-privado').remove([ruta]);
    if(error) console.warn('[foto propuesta] no se pudo borrar', error);
  } catch(e){ console.warn('[foto propuesta] no se pudo borrar', e); }
  Object.assign(n, cambios);
  verNinera(id);
  toast('Foto propuesta descartada.');
}
async function guardarEdicionNinera(id){
  // Celular obligatorio salvo traslados (27/10/2026): a las que no lo tienen de antes se les pide
  // acá, al editarlas. Vacío se guarda como null, igual que en el alta.
  const telefono = document.getElementById('ed-telefono').value.trim();
  const tipo = document.getElementById('ed-tipo').value;
  const problemaCel = problemaCelularNinera(telefono, tipo);
  if(problemaCel){ toast(problemaCel, 'bad'); document.getElementById('ed-telefono').focus(); return; }
  const cambios = {
    nombre: document.getElementById('ed-nombre').value,
    telefono: telefono || null,
    zona: leerZonasChecklist('ed'),
    tipo,
    foto: ninFotoUrlPendiente,
    cuenta_bancaria: leerCuentasBancarias('ed'),
    notas: document.getElementById('ed-notas').value,
  };
  // Temporada: se guarda (y se marca como actualizada) solo si el calendario estaba en pantalla
  // y se tocó -- abrir "Editar" para cambiar el teléfono no tiene que dar la temporada por revisada.
  const editorTemp = document.querySelector('[data-temp-guardar="ed-temp"]');
  if(hayEditorTemporada('ed-temp') && editorTemp && editorTemp.dataset.tocado==='1'){
    const nPrev = ninierasItems.find(x=>x.id===id);
    cambios.temporada = leerEditorTemporada('ed-temp', nPrev?.temporada);
    cambios.temporada_actualizada_en = new Date().toISOString();
    cambios.temporada_fuente = 'sistema';
    cambios.zona = zonaConTemporada(cambios.zona, cambios.temporada);
  }
  const nAntes = ninierasItems.find(x=>x.id===id);
  // Con la app activa, la cuenta está atada al celular (el mail de la cuenta sale de él): si cambia,
  // la niñera ya no entra con el número nuevo hasta que le manden un link (26/10/2026).
  // Se compara el número normalizado: '098 000 001' y '098000001' son la misma cuenta.
  const cambioCelularConApp = !!(nAntes?.user_id && normalizarCelular(nAntes.telefono) !== normalizarCelular(cambios.telefono));
  const { error } = await sb.from('ninieras').update(cambios).eq('id', id);
  if(error){ toast('No se pudo guardar: '+error.message,'bad'); return; }
  const extraInputs = [...document.querySelectorAll('#ed-extra-fields [data-campo]')];
  const extra = {};
  extraInputs.forEach(el=>{ extra[el.dataset.campo] = el.value; });
  // Fecha de nacimiento: campo propio, no es parte del sistema de categorías genérico —
  // mismo criterio de "mandar null si se borró" que el resto.
  const fechaNac = document.getElementById('ed-fecha-nac').value;
  if(fechaNac) extra.fecha_nacimiento = fechaNac;
  else if(ninEditCandidataCache.fecha_nacimiento) extra.fecha_nacimiento = null;
  // Si queda una fecha de nacimiento real cargada, el texto viejo de "edad" ya no hace
  // falta -- se borra solo, así no quedan las dos cosas dando vueltas ni hay que acordarse
  // de sacarlo a mano.
  if(fechaNac && ninEditCandidataCache.edad) extra.edad = null;
  // campos que tenían dato al abrir la ficha (ver ninEditCandidataCache) y que se
  // borraron con el botón "−" durante esta edición: hay que mandarlos como null
  // explícitamente, si no Supabase nunca los toca y el dato viejo queda pegado en la base
  const clavesActuales = new Set(extraInputs.map(el=>el.dataset.campo));
  // La fecha de nacimiento no es una categoría (tiene su calendario, arriba): no se borra acá.
  FICHA_CAMPOS.forEach(f=>{
    if(!['nombre','apellido','telefono','zona','fecha_nacimiento'].includes(f.key) && ninEditCandidataCache[f.key] && !clavesActuales.has(f.key)){
      extra[f.key] = null;
    }
  });
  let errExtra = null; // si falla lo de la ficha de candidata, se avisa en vez de "Cambios guardados"
  if(Object.keys(extra).length){
    const n = ninierasItems.find(x=>x.id===id);
    let candidataId = n?.candidata_id;
    if(!candidataId){
      const partes = (cambios.nombre||'').trim().split(' ');
      const { data:nuevaCand, error:e2 } = await sb.from('candidatas')
        .insert({ nombre: partes[0]||cambios.nombre, apellido: partes.slice(1).join(' ')||null, estado:'contratada', tipo: cambios.tipo, ...extra })
        .select().single();
      if(e2) errExtra = e2;
      else {
        const { error:e4 } = await sb.from('ninieras').update({candidata_id: nuevaCand.id}).eq('id', id);
        if(e4) errExtra = e4;
      }
    } else {
      // Lo que vino corregido de la entrevista (notas_ficha) ya está en los campos que se
      // acaban de guardar: desde ahora la ficha es la verdad y las notas viejas se limpian.
      if(n?.candidatas?.notas_ficha && Object.keys(n.candidatas.notas_ficha).length) extra.notas_ficha = {};
      const { error:e3 } = await sb.from('candidatas').update(extra).eq('id', candidataId);
      if(e3) errExtra = e3;
    }
  }
  cerrarModal();
  if(errExtra) toast('Se guardó lo básico, pero no las categorías extra: '+errExtra.message, 'bad');
  else toast('Cambios guardados.');
  if(cambioCelularConApp) toast('Cambió el celular: va a necesitar un link nuevo para entrar (Invitar a la app).');
  const scrollN1 = guardarScrollMainarea();
  await cargarNinieras();
  restaurarScrollMainarea(scrollN1);
}
async function eliminarNinera(id){
  if(!(await confirmarAccion('¿Eliminar esta niñera del sistema? No se puede deshacer.'))) return;
  const { error } = await sb.from('ninieras').delete().eq('id', id);
  if(error){ toast('No se pudo eliminar: '+error.message,'bad'); return; }
  toast('Niñera eliminada.');
  const scrollN2 = guardarScrollMainarea();
  await cargarNinieras();
  restaurarScrollMainarea(scrollN2);
}

/* ---- Generar CV: arma el pedido para pegarle a Claude en el chat ---- */
const CV_CANVA_DESIGN_ID = 'DAHUzD60KqA';
const CV_CANVA_DESIGN_NOMBRE = 'PLANTILLA BASE v2 - CV niñeras';
function generarMensajeCV(id){
  const n = ninierasItems.find(x=>x.id===id);
  if(!n) return;
  const cd = datosFichaCandidata(n.candidatas);
  // Importante: NUNCA incluir teléfono, mail ni zona acá — esos son datos internos
  // (quedan en la ficha/directorio), no van en el CV que ve la familia.
  const datos = [`Nombre: ${n.nombre}`];
  if(n.foto) datos.push(`Foto (URL): ${n.foto}`);
  // Si hay fecha de nacimiento cargada, la edad calculada pisa al texto viejo ("edad") —
  // así el CV siempre sale con la edad real de hoy, no la que tenía cuando se cargó el dato.
  const edadCalculada = calcularEdad(cd.fecha_nacimiento);
  FICHA_CAMPOS.forEach(f=>{
    if(f.key==='edad' && edadCalculada!==null){ datos.push(`${f.label}: ${edadCalculada} años`); return; }
    if(cd[f.key]) datos.push(`${f.label}: ${cd[f.key]}`);
  });
  if(n.notas) datos.push(`Notas: ${n.notas}`);
  const mensaje = `Generame el CV de ${n.nombre} en Canva.

Antes de generarlo, leé en los Files de este Project el archivo "instrucciones_generar_cv_ninieras.md" y la imagen de ejemplo de un CV ya terminado — ahí está el paso a paso exacto y el formato visual a respetar (fondo salvia, nombre en violeta bold, foto circular, bullets coral).

Usá como plantilla base el diseño "${CV_CANVA_DESIGN_NOMBRE}" (ID: ${CV_CANVA_DESIGN_ID}) de mi cuenta de Canva conectada — copiá su única página a un diseño nuevo con Canva:copy-design (no edites la plantilla base en sí), reemplazá los placeholders por los datos de abajo respetando el formato ya definido (fondo salvia, nombre en violeta bold, foto circular, bullets coral), y mandámelo acá como PDF.

Datos de la niñera:
${datos.map(d=>'- '+d).join('\n')}`;
  abrirModal(`
    <h2 style="margin:0 0 10px;">Mensaje para pedirle el CV a Claude</h2>
    <div class="helper">Copiá esto (o descargalo) y pegalo en un chat con Claude dentro de este Project — tiene todo lo que necesita para generar el CV de ${escaparHtml(n.nombre)} y mandártelo en PDF. Para que funcione, el Project tiene que tener cargados el archivo de instrucciones y una imagen de ejemplo de CV en su sección de Files.</div>
    <textarea id="cv-msg-${id}" readonly style="min-height:220px;font-family:'IBM Plex Mono',monospace;font-size:12.5px;">${escaparHtml(mensaje)}</textarea>
    <div class="confirmbtns">
      <button class="btn ghost" onclick="descargarMensajeCV(${argJs(id)})">Descargar .txt</button>
      <button class="btn primary" onclick="copiarMensajeCV(${argJs(id)})">Copiar mensaje</button>
    </div>`);
}
async function copiarMensajeCV(id){
  const ta = document.getElementById('cv-msg-'+id);
  try{
    await navigator.clipboard.writeText(ta.value);
    toast('Mensaje copiado — pegalo en el chat con Claude.');
    marcarCvGenerado(id);
  }catch(e){
    ta.select();
    toast('No se pudo copiar automático — seleccioná el texto y copiá a mano.', 'bad');
  }
}
// Marca la fecha de hoy como "último CV pedido" para esta niñera — así la ficha puede avisar
// más adelante si cumple años y el CV queda desactualizado. Se asume optimista: si pidió el
// mensaje, es porque va a generar el CV ahora — no hace falta que confirme de vuelta.
async function marcarCvGenerado(id){
  const { error } = await sb.from('ninieras').update({ cv_generado_en: todayISO() }).eq('id', id);
  if(error){ toast('No se pudo anotar la fecha del CV: '+error.message, 'bad'); return; }
  const n = ninierasItems.find(x=>x.id===id);
  if(n) n.cv_generado_en = todayISO();
}
function descargarMensajeCV(id){
  const n = ninierasItems.find(x=>x.id===id);
  const ta = document.getElementById('cv-msg-'+id);
  if(!ta) return;
  const blob = new Blob([ta.value], {type:'text/plain;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download = `pedido_cv_${(n?.nombre||'ninera').replace(/\s+/g,'_')}.txt`; a.click(); URL.revokeObjectURL(url);
  marcarCvGenerado(id);
}


/* ============================================================
   Temporadas fuera de Montevideo/Canelones (Punta del Este y alrededores)
   ------------------------------------------------------------
   Muchas niñeras son de Pocitos/Carrasco pero pasan parte del verano en
   Punta. La zona sola no alcanza para saber dónde está cada una en cada
   momento del año, así que para los grupos de zona marcados como
   "fuera_de_montevideo" se guarda en qué quincenas está ahí:
     ninieras.temporada = { "<zona_grupo_id>": [0..23] }
   Quincena q = mes*2 + (0 primera, 1 segunda) -- q=0 es 1-15 de enero,
   q=1 es 16-31 de enero, ... q=23 es 16-31 de diciembre.
   Regla de búsqueda (decidida con Diego/Pau/Delfi):
   - Buscar una zona "fuera" en un período -> solo las que marcaron estar
     ahí en esas quincenas.
   - Buscar una zona de Montevideo/Canelones -> las que están en Punta en
     esas quincenas NO aparecen (no están en Pocitos si están en Punta).
   - Una niñera sin temporada cargada nunca se esconde: aparece igual,
     con el badge "Sin temporada", para no perder a nadie por falta de dato.
   La temporada "vence" cada 1 de setiembre (antes de que arranque el
   verano): si no se actualizó desde entonces vuelve el badge, y se puede
   confirmar con un toque que se repite lo del año pasado.
   ============================================================ */
const TEMP_MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];
const TEMP_MESES_LARGO = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','setiembre','octubre','noviembre','diciembre'];
const TEMP_TODAS = Array.from({length:24}, (_,i)=>i);
let ninFiltroMeses = new Set(); // meses (0-11) elegidos en el filtro "Cuándo"
let ninTempAbierto = false;

function asegurarEstilosTemporada(){
  if(document.getElementById('estilos-temporada')) return;
  const st = document.createElement('style');
  st.id = 'estilos-temporada';
  st.textContent = `
.temp-meses{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:2px;margin:0 0 3px;}
.temp-meses button{border:none;background:none;padding:0;font-size:10.5px;color:var(--ink-soft);font-family:'Inter',sans-serif;cursor:pointer;text-align:left;}
.temp-meses span{font-size:10.5px;color:var(--ink-soft);}
.temp-strip{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:2px;}
.temp-strip .tq{height:22px;border-radius:4px;background:var(--bg);border:1px solid var(--line);padding:0;cursor:pointer;}
.temp-strip .tq:nth-child(2n){margin-right:2px;}
.temp-strip .tq.on{background:var(--accent);border-color:var(--accent);}
.temp-strip.mini{pointer-events:none;margin-top:5px;max-width:260px;}
.temp-strip.mini .tq{height:6px;border-radius:2px;cursor:default;}
.temp-strip.mini .tq.foco{outline:1.5px solid var(--clay);outline-offset:1px;}
.temp-strip.propuesta .tq.on{background:var(--clay);border-color:var(--clay);}
.temp-row{padding:12px 0;border-bottom:1px solid var(--line);}
.temp-row:last-child{border-bottom:none;}
.temp-row-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:8px;}
.temp-acciones{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
.mes-chips{display:flex;gap:4px;flex-wrap:wrap;align-items:center;}
.mes-chip{border:1px solid var(--line);background:var(--paper);color:var(--ink-soft);border-radius:100px;padding:4px 10px;font-size:12px;font-family:'Inter',sans-serif;cursor:pointer;}
.mes-chip.on{background:var(--accent);border-color:var(--accent);color:#fff;}
@media (max-width:760px){ .temp-strip .tq{height:26px;} .temp-strip .tq:nth-child(2n){margin-right:1px;} }
`;
  document.head.appendChild(st);
}

/* ---- Lógica compartida ---- */
function gruposFueraDeZonaStr(zonaStr){
  const ids = new Set(zonasNormalizadas(zonaStr).map(z=>grupoDeZona(z)?.id).filter(Boolean));
  return (zonaGruposCache||[]).filter(g=>g.fuera_de_montevideo && ids.has(g.id));
}
function gruposFueraDeNinera(n){ return gruposFueraDeZonaStr(n.zona); }
// Qué calendarios se le muestran para editar: los de sus zonas de afuera, o si no tiene
// ninguna (vive en Montevideo/Canelones), todos los grupos de afuera -- para poder marcar
// que veranea allá.
function gruposParaEditor(n){
  const suyos = gruposFueraDeNinera(n);
  return suyos.length ? suyos : (zonaGruposCache||[]).filter(g=>g.fuera_de_montevideo);
}
// Si marcó alguna quincena en un grupo de afuera y su zona no incluye ninguna zona de ese
// grupo, se le agrega (Punta del Este si está en el grupo) -- si no, nunca aparecería al
// buscar esa zona. Mismo criterio que la página de la niñera y el alta desde Postulantes.
function zonaConTemporada(zonaStr, temporada){
  let zona = (zonaStr||'').trim();
  (zonaGruposCache||[]).filter(g=>g.fuera_de_montevideo).forEach(g=>{
    if(!quincenasDeGrupo(temporada, g.id).length) return;
    if(gruposFueraDeZonaStr(zona).some(x=>x.id===g.id)) return;
    zona = textoZonas([zona, g.nombre].filter(Boolean).join('/'));
  });
  return zona;
}
function grupoFueraDeZona(zonaKey){
  const g = grupoDeZona(zonaKey);
  return g && g.fuera_de_montevideo ? g : null;
}
function inicioTemporadaActual(ref=new Date()){
  // Setiembre (mes 8) arranca la temporada nueva -- de setiembre a agosto del año siguiente.
  const y = ref.getMonth()>=8 ? ref.getFullYear() : ref.getFullYear()-1;
  return new Date(y, 8, 1);
}
function temporadaCargada(n){ return !!n.temporada_actualizada_en; }
// 'sin' (nunca se cargó) | 'vieja' (cargada antes del 1 de setiembre) | 'ok'
// Se pide a TODAS las niñeras, no solo a las que ya tienen una zona de afuera: una chica de
// Pocitos puede veranear en Punta y justamente eso es lo que se quiere saber. Confirmar que
// no va ("No va", ninguna quincena marcada) también cuenta como cargada.
function estadoTemporada(n){
  if(!temporadaCargada(n)) return 'sin';
  return new Date(n.temporada_actualizada_en) >= inicioTemporadaActual() ? 'ok' : 'vieja';
}
function quincenasDeGrupo(temporada, grupoId){
  const qs = (temporada||{})[grupoId];
  return Array.isArray(qs) ? qs.map(Number).filter(q=>Number.isInteger(q) && q>=0 && q<24) : [];
}
function quincenasDeMeses(meses){ return [...meses].flatMap(m=>[m*2, m*2+1]).sort((a,b)=>a-b); }
// true | false | null (no se sabe: sin temporada cargada)
function nineraPresenteEnZona(n, zonaKey, q){
  const grupo = grupoFueraDeZona(zonaKey);
  if(!temporadaCargada(n)){
    // Vive afuera (todas sus zonas son de afuera, por ejemplo solo Punta del Este): está ahí
    // todo el año aunque no haya cargado la temporada (21/10/2026; 17 niñeras así quedaban
    // fuera del filtro con meses). Si no, no se sabe (puede estar veraneando).
    if(grupo && soloZonasDeAfuera(n)) return true;
    return null;
  }
  if(grupo) return quincenasDeGrupo(n.temporada, grupo.id).includes(q);
  // Zona de Montevideo/Canelones: está, salvo que esa quincena esté en alguna zona de afuera.
  return !gruposFueraDeNinera(n).some(g=>quincenasDeGrupo(n.temporada, g.id).includes(q));
}
function soloZonasDeAfuera(n){
  const zs = zonasNormalizadas(n.zona);
  return zs.length>0 && zs.every(z=>grupoFueraDeZona(claveZona(z)));
}
// Para el filtro: 'todo' | 'parte' | 'nada' | 'desconocido'
// zonaKeys: una clave o una lista (está si está en CUALQUIERA de esas zonas esa quincena).
function coberturaPeriodo(n, zonaKeys, qs){
  if(!qs.length) return 'todo';
  const keys = Array.isArray(zonaKeys) ? zonaKeys : [zonaKeys];
  if(!keys.length) return 'nada';
  let si = 0;
  for(const q of qs){
    const ps = keys.map(k=>nineraPresenteEnZona(n, k, q));
    if(ps.some(p=>p===null)) return 'desconocido';
    if(ps.some(Boolean)) si++;
  }
  return si===qs.length ? 'todo' : (si>0 ? 'parte' : 'nada');
}
function textoQuincenas(qs){
  // "Todo el año" / "enero y febrero completos, 1ra quincena de marzo"
  const set = new Set(qs);
  if(!set.size) return 'No va';
  if(set.size===24) return 'Todo el año';
  const partes = [];
  let m = 0;
  while(m<12){
    if(set.has(m*2) && set.has(m*2+1)){
      let fin = m;
      while(fin+1<12 && set.has((fin+1)*2) && set.has((fin+1)*2+1)) fin++;
      partes.push(fin===m ? TEMP_MESES_LARGO[m] : `${TEMP_MESES_LARGO[m]} a ${TEMP_MESES_LARGO[fin]}`);
      m = fin+1;
    } else {
      if(set.has(m*2)) partes.push(`1ra quincena de ${TEMP_MESES_LARGO[m]}`);
      if(set.has(m*2+1)) partes.push(`2da quincena de ${TEMP_MESES_LARGO[m]}`);
      m++;
    }
  }
  return partes.join(', ');
}

/* ---- Editor: una tira de 24 quincenas por grupo de zona "fuera" ---- */
function htmlEditorTemporada(prefix, grupos, temporada, opts={}){
  if(!grupos.length) return '';
  return grupos.map(g=>{
    const qs = new Set(quincenasDeGrupo(temporada, g.id));
    return `
    <div class="temp-editor" data-prefix="${prefix}" data-grupo="${g.id}" style="margin-top:6px;">
      ${grupos.length>1 || opts.mostrarNombreGrupo ? `<div class="helper" style="margin:0 0 4px;">${escaparHtml(g.nombre)}</div>` : ''}
      <div class="temp-meses">${TEMP_MESES.map((m,i)=>`<button type="button" onclick="toggleMesTemporada(this, ${i})" title="Marcar o desmarcar ${TEMP_MESES_LARGO[i]} completo">${m}</button>`).join('')}</div>
      <div class="temp-strip${opts.propuesta?' propuesta':''}">${TEMP_TODAS.map(q=>`<button type="button" class="tq${qs.has(q)?' on':''}" data-q="${q}" onclick="toggleQuincena(this)" title="${q%2?'2da':'1ra'} quincena de ${TEMP_MESES_LARGO[q>>1]}" aria-label="${q%2?'2da':'1ra'} quincena de ${TEMP_MESES_LARGO[q>>1]}" aria-pressed="${qs.has(q)}"></button>`).join('')}</div>
      <div class="helper temp-resumen" style="margin:4px 0 0;">${textoQuincenas([...qs])}</div>
    </div>`;
  }).join('');
}
function htmlMiniTemporada(n, focoQs=[]){
  const grupos = gruposParaEditor(n);
  if(!grupos.length || !temporadaCargada(n)) return '';
  const foco = new Set(focoQs);
  const qs = new Set(grupos.flatMap(g=>quincenasDeGrupo(n.temporada, g.id)));
  return `<div class="temp-strip mini" aria-hidden="true">${TEMP_TODAS.map(q=>`<span class="tq${qs.has(q)?' on':''}${foco.has(q)?' foco':''}"></span>`).join('')}</div>`;
}
function refrescarResumenEditor(editor){
  const qs = [...editor.querySelectorAll('.tq.on')].map(b=>Number(b.dataset.q));
  const r = editor.querySelector('.temp-resumen');
  if(r) r.textContent = textoQuincenas(qs);
  const prefix = editor.dataset.prefix;
  const btn = document.querySelector(`[data-temp-guardar="${prefix}"]`);
  if(btn){ btn.style.display = ''; btn.dataset.tocado = '1'; }
}
function toggleQuincena(btn){
  btn.classList.toggle('on');
  btn.setAttribute('aria-pressed', btn.classList.contains('on'));
  refrescarResumenEditor(btn.closest('.temp-editor'));
}
function toggleMesTemporada(btn, mes){
  const editor = btn.closest('.temp-editor');
  const celdas = [editor.querySelector(`.tq[data-q="${mes*2}"]`), editor.querySelector(`.tq[data-q="${mes*2+1}"]`)];
  const prender = !celdas.every(c=>c.classList.contains('on'));
  celdas.forEach(c=>{ c.classList.toggle('on', prender); c.setAttribute('aria-pressed', prender); });
  refrescarResumenEditor(editor);
}
function setTodasQuincenas(prefix, prender){
  document.querySelectorAll(`.temp-editor[data-prefix="${prefix}"]`).forEach(editor=>{
    editor.querySelectorAll('.tq').forEach(c=>{ c.classList.toggle('on', prender); c.setAttribute('aria-pressed', prender); });
    refrescarResumenEditor(editor);
  });
}
function leerEditorTemporada(prefix, temporadaBase){
  // Arranca de lo que ya tenía (así no se pierden grupos que no se muestran en este editor)
  const out = {...(temporadaBase||{})};
  document.querySelectorAll(`.temp-editor[data-prefix="${prefix}"]`).forEach(editor=>{
    out[editor.dataset.grupo] = [...editor.querySelectorAll('.tq.on')].map(b=>Number(b.dataset.q)).sort((a,b)=>a-b);
  });
  return out;
}
function hayEditorTemporada(prefix){ return !!document.querySelector(`.temp-editor[data-prefix="${prefix}"]`); }

/* ---- Filtro "Cuándo" en la lista de niñeras ---- */
function htmlFiltroMeses(){
  return `<div class="mes-chips" id="filt-meses">${TEMP_MESES.map((m,i)=>`<button type="button" class="mes-chip${ninFiltroMeses.has(i)?' on':''}" aria-pressed="${ninFiltroMeses.has(i)}" onclick="toggleFiltroMes(${i})">${m}</button>`).join('')}${ninFiltroMeses.size?`<button type="button" class="smallbtn" style="margin-left:4px;" onclick="limpiarFiltroMeses()">Limpiar</button>`:''}</div>`;
}
function pintarFiltroMeses(){
  const wrap = document.getElementById('filt-meses-wrap');
  if(wrap) wrap.innerHTML = htmlFiltroMeses();
}
function toggleFiltroMes(i){
  ninFiltroMeses.has(i) ? ninFiltroMeses.delete(i) : ninFiltroMeses.add(i);
  pintarFiltroMeses();
  filtrarNinieras();
}
function limpiarFiltroMeses(){ ninFiltroMeses.clear(); pintarFiltroMeses(); filtrarNinieras(); }

/* ---- Badge en la fila de la lista ---- */
function badgeTemporada(n){
  const est = estadoTemporada(n);
  if(est==='sin') return `<span class="badge warn" style="font-size:10px;padding:2px 8px;">Sin temporada cargada</span>`;
  if(est==='vieja') return `<span class="badge warn" style="font-size:10px;padding:2px 8px;">Temporada sin actualizar</span>`;
  return '';
}

/* ---- Panel "Temporadas de verano" ----
   Lista a TODAS las niñeras activas. Por defecto muestra solo las que faltan (sin temporada o
   de la temporada anterior), que es lo que hay que resolver; "Ver todas" muestra el resto. */
let ninTempVerTodas = false;
let ninTempOmitidas = new Set(); // "Omitir por ahora" en Editar: no se vuelve a pedir en esta sesión
function toggleTemporadasPanel(){ ninTempAbierto = !ninTempAbierto; renderTemporadasPanel(); }
function toggleTemporadasVerTodas(){ ninTempVerTodas = !ninTempVerTodas; renderTemporadasPanel(); }
function renderTemporadasPanel(){
  const wrap = document.getElementById('nin-temporadas-wrap');
  if(!wrap) return;
  asegurarEstilosTemporada();
  if(!(zonaGruposCache||[]).some(g=>g.fuera_de_montevideo)){ pintarSiCambio(wrap, ''); return; }
  const faltan = ninierasItems.filter(n=>estadoTemporada(n)!=='ok');
  const alDia = ninierasItems.filter(n=>estadoTemporada(n)==='ok');
  const inicio = inicioTemporadaActual();
  const lista = ninTempVerTodas ? [...faltan, ...alDia] : faltan;
  pintarSiCambio(wrap, `
    <div class="card" style="padding:14px 18px;margin-bottom:14px;${faltan.length?'border-left:3px solid var(--warn);border-radius:0 12px 12px 0;':''}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;cursor:pointer;" onclick="toggleTemporadasPanel()">
        <h2 style="margin:0;">Temporadas de verano</h2>
        <div class="helper" style="margin:0;">${faltan.length ? `${faltan.length} sin temporada, ` : ''}${alDia.length} al día ${ninTempAbierto?'(tocá para cerrar)':'(tocá para ver)'}</div>
      </div>
      ${ninTempAbierto ? `
        <div class="helper" style="margin:8px 0 8px;">En qué quincenas está cada una en Punta del Este (o la zona de afuera que corresponda). Lo que no esté marcado cuenta como que está en Montevideo o Canelones. Si no va nunca, guardalo vacío y el aviso se va igual. Se pide actualizar cada año desde el 1 de setiembre (esta temporada arrancó el ${inicio.toLocaleDateString('es-UY',{day:'numeric',month:'long',year:'numeric'})}).</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
          <button type="button" class="smallbtn" onclick="copiarMensajeDifusionTemporada()">Copiar mensaje para difusión</button>
          <button type="button" class="smallbtn" onclick="toggleTemporadasVerTodas()">${ninTempVerTodas?'Ver solo las que faltan':`Ver todas (${ninierasItems.length})`}</button>
        </div>
        ${lista.length ? lista.map(filaTemporadaPanel).join('') : '<div class="empty">Están todas al día.</div>'}
      ` : ''}
    </div>`);
}
function textoFuenteTemporada(n){
  if(!n.temporada_actualizada_en) return '';
  const f = new Date(n.temporada_actualizada_en).toLocaleDateString('es-UY',{day:'numeric',month:'short',year:'numeric'});
  const quien = n.temporada_fuente==='ninera' ? 'la cargó ella' : n.temporada_fuente==='formulario' ? 'del formulario de postulación' : 'cargada por ustedes';
  return `${f}, ${quien}`;
}
function filaTemporadaPanel(n){
  const prefix = 'tp-'+n.id;
  const grupos = gruposParaEditor(n);
  const est = estadoTemporada(n);
  const estadoTxt = est==='sin' ? 'Sin temporada'
    : est==='vieja' ? `Temporada anterior (${textoFuenteTemporada(n)})`
    : `Al día (${textoFuenteTemporada(n)})`;
  return `
    <div class="temp-row" id="temp-row-${n.id}">
      <div class="temp-row-head">
        <div>
          <div style="font-weight:600;">${escaparHtml(n.nombre)}</div>
          <div class="helper" style="margin:0;">${escaparHtml(textoZonasConBarrios(n.zona, n.barrios)||'zona s/d')}</div>
          <div class="helper" style="margin:2px 0 0;color:${est!=='ok'?'var(--warn)':'var(--ink-soft)'};">${estadoTxt}</div>
          ${n.temporada_comentario ? `<div class="helper" style="margin:2px 0 0;">Comentario: ${escaparHtml(n.temporada_comentario)}</div>` : ''}
        </div>
        <div class="temp-acciones">
          ${est==='vieja' ? `<button type="button" class="smallbtn" onclick="conGuardado(this, ()=>repetirTemporadaAnterior(${argJs(n.id)}))">Repetir lo del año pasado</button>` : ''}
          <button type="button" class="smallbtn" onclick="pedirTemporadaWhatsapp(${argJs(n.id)})">Pedirle por WhatsApp</button>
          <button type="button" class="smallbtn" onclick="setTodasQuincenas(${argJs(prefix)}, true)">Todo el año</button>
          <button type="button" class="smallbtn" onclick="setTodasQuincenas(${argJs(prefix)}, false)">No va</button>
        </div>
      </div>
      ${htmlEditorTemporada(prefix, grupos, n.temporada)}
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
        <button type="button" class="smallbtn" data-temp-guardar="${prefix}" style="display:${est==='ok'?'none':''};background:var(--accent);color:#fff;border-color:var(--accent);" onclick="conGuardado(this, ()=>guardarTemporadaPanel(${argJs(n.id)}))">${est==='ok'?'Guardar cambios':'Guardar temporada'}</button>
      </div>
    </div>`;
}
async function guardarTemporadaEnBase(id, temporada, extra={}){
  const n = ninierasItems.find(x=>x.id===id);
  const cambios = {
    temporada,
    zona: zonaConTemporada(n?.zona, temporada),
    temporada_actualizada_en: new Date().toISOString(),
    temporada_fuente: 'sistema',
    temporada_propuesta: null, temporada_propuesta_en: null,
    ...extra,
  };
  const { error } = await sb.from('ninieras').update(cambios).eq('id', id);
  if(error){ toast('No se pudo guardar la temporada: '+error.message, 'bad'); return false; }
  if(n) Object.assign(n, cambios);
  return true;
}
async function guardarTemporadaPanel(id){
  const n = ninierasItems.find(x=>x.id===id);
  if(!n) return;
  const temporada = leerEditorTemporada('tp-'+id, n.temporada);
  if(!(await guardarTemporadaEnBase(id, temporada))) return;
  toast(`Temporada de ${n.nombre.split(' ')[0]} guardada.`);
  refrescarTrasTemporada();
}
async function repetirTemporadaAnterior(id, despues){
  const n = ninierasItems.find(x=>x.id===id);
  if(!n) return;
  // Mismas quincenas que ya tenía -- solo se renueva la fecha de actualización.
  if(!(await guardarTemporadaEnBase(id, n.temporada || {}, { temporada_fuente: n.temporada_fuente || 'sistema' }))) return;
  toast(`Listo: ${n.nombre.split(' ')[0]} repite las mismas fechas este año.`);
  refrescarTrasTemporada();
  if(typeof despues==='function') despues();
}
/* Mensaje único para mandar por difusión de WhatsApp: el link general pide el celular, así
   que sirve el mismo para todas. Texto escrito por Pau (30/09/2026). */
// La página de temporada vive en Cloudflare Pages (parentsbreak.pages.dev) para que las
// niñeras no vean la dirección de GitHub.
const TEMPORADA_URL = 'https://parentsbreak.pages.dev/temporada';
function linkTemporadaGeneral(){
  return TEMPORADA_URL;
}
function mensajeDifusionTemporada(){
  return `¡Hola! Les dejamos este formulario para que puedan establecer las fechas en las que estarán disponibles para trabajar en Punta del Este.\n\n${linkTemporadaGeneral()}\n\nGracias☺️`;
}
async function copiarMensajeDifusionTemporada(){
  try{ await navigator.clipboard.writeText(mensajeDifusionTemporada()); toast('Mensaje copiado. Pegalo en la lista de difusión de WhatsApp.'); }
  catch(e){ abrirModal(`<h2 style="margin:0 0 8px;">Mensaje para difusión</h2><div class="helper">Copialo y pegalo en la lista de difusión.</div><textarea style="width:100%;min-height:180px;">${escaparHtml(mensajeDifusionTemporada())}</textarea>`); }
}
/* Recordatorio anual (campanita, cada 1 de octubre): el mensaje listo para mandar por
   difusión, con el link. WhatsApp no deja abrir una lista de difusión directo desde un link,
   así que "Enviar por WhatsApp" abre WhatsApp con el texto y ahí se elige la lista. */
function abrirRecordatorioTemporada(){
  const faltan = (ninierasItems||[]).filter(n=>estadoTemporada(n)!=='ok').length;
  abrirModal(`
    <h2 style="margin:0 0 6px;padding-right:44px;">Pedir la temporada de Punta</h2>
    <div class="helper" style="margin:0 0 12px;">Mandales este mensaje a las niñeras por la lista de difusión. Lo que carguen se guarda solo en su ficha.${faltan?` Hoy hay ${faltan} sin temporada al día.`:''}</div>
    <div style="background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px 14px;white-space:pre-wrap;font-size:14px;line-height:1.5;">${escaparHtml(mensajeDifusionTemporada())}</div>
    <div class="confirmbtns" style="margin-top:16px;">
      <a class="btn ghost" style="text-decoration:none;text-align:center;" href="https://wa.me/?text=${encodeURIComponent(mensajeDifusionTemporada())}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
      <button class="btn primary" onclick="copiarMensajeDifusionTemporada()">Copiar mensaje</button>
    </div>`);
}
/* Paso previo al abrir "Editar" de una niñera sin temporada: se pide primero, con la opción
   de omitirlo por ahora (no se vuelve a pedir en esta sesión). */
function abrirPasoTemporada(id){
  const n = ninierasItems.find(x=>x.id===id);
  if(!n) return;
  asegurarEstilosTemporada();
  const est = estadoTemporada(n);
  abrirModal(`
    <h2 style="margin:0 0 4px;padding-right:32px;">Temporada de ${escaparHtml(n.nombre.split(' ')[0])}</h2>
    <div class="helper" style="margin:0 0 10px;">${est==='vieja'
      ? `Su temporada es del año pasado (${textoFuenteTemporada(n)}). ¿Sigue igual este verano?`
      : 'Todavía no sabemos si veranea afuera de Montevideo. Marcá las quincenas en que está en Punta del Este, o dejalo vacío si no va.'}</div>
    ${htmlEditorTemporada('paso-temp', gruposParaEditor(n), n.temporada)}
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
      ${est==='vieja' ? `<button type="button" class="smallbtn" onclick="conGuardado(this, ()=>repetirTemporadaAnterior(${argJs(id)}, ()=>editarNinera(${argJs(id)})))">Repetir lo del año pasado</button>` : ''}
      <button type="button" class="smallbtn" onclick="setTodasQuincenas('paso-temp', true)">Todo el año</button>
      <button type="button" class="smallbtn" onclick="setTodasQuincenas('paso-temp', false)">No va</button>
      <button type="button" class="smallbtn" onclick="pedirTemporadaWhatsapp(${argJs(id)})">Pedirle por WhatsApp</button>
    </div>
    <div class="confirmbtns" style="margin-top:16px;">
      <button class="btn ghost" onclick="omitirPasoTemporada(${argJs(id)})">Omitir por ahora</button>
      <button class="btn primary" onclick="conGuardado(this, ()=>guardarPasoTemporada(${argJs(id)}))">Guardar y seguir</button>
    </div>`);
}
function omitirPasoTemporada(id){ ninTempOmitidas.add(id); editarNinera(id); }
async function guardarPasoTemporada(id){
  const n = ninierasItems.find(x=>x.id===id);
  if(!n) return;
  const temporada = leerEditorTemporada('paso-temp', n.temporada);
  if(!(await guardarTemporadaEnBase(id, temporada))) return;
  toast(`Temporada de ${n.nombre.split(' ')[0]} guardada.`);
  refrescarTrasTemporada();
  editarNinera(id);
}
function refrescarTrasTemporada(){
  // Solo se repintan el panel y la lista (con su scroll), sin volver a pedir todo a la base.
  const scroll = guardarScrollMainarea();
  renderTemporadasPanel();
  filtrarNinieras();
  restaurarScrollMainarea(scroll);
}
/* Link personal para que la propia niñera cargue sus fechas desde el celular (sin tener que
   poner su número). Lo que manda se guarda directo como su temporada (función
   temporada-ninera). Borrador de texto, a revisar por Pau/Delfi. */
function linkTemporadaNinera(n){
  return `${TEMPORADA_URL}?t=${n.temporada_token}`;
}
function mensajeTemporadaPara(n){
  const primerNombre = (n.nombre||'').trim().split(' ')[0] || n.nombre;
  return `Hola ${primerNombre}! Te escribimos de Parents’ Break. Estamos armando la agenda de la temporada en Punta del Este y queremos saber en qué fechas vas a estar por allá. Nos marcás las quincenas acá? Es un minuto:\n\n${linkTemporadaNinera(n)}\n\nGracias!`;
}
function pedirTemporadaWhatsapp(id){
  const n = ninierasItems.find(x=>x.id===id);
  if(!n) return;
  if(!n.temporada_token){ toast('Falta el link de esta niñera. Recargá la página e intentá de nuevo.', 'bad'); return; }
  const tel = formatearTelefonoWhatsApp(n.telefono);
  if(!tel){
    navigator.clipboard?.writeText(linkTemporadaNinera(n));
    toast('No tiene teléfono cargado. Copié el link para que se lo mandes por otro lado.');
    return;
  }
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(mensajeTemporadaPara(n))}`, '_blank');
}
