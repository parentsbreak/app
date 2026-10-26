/* ================= FAMILIAS ================= */
let familiasItems = [];
let famBusqueda = '';
let famFiltroZonas = new Set(); // claveZona() de las zonas marcadas en el filtro
function toggleFiltroZonaFam(k, marcada){
  if(k===null) famFiltroZonas.clear();
  else if(marcada) famFiltroZonas.add(k); else famFiltroZonas.delete(k);
  const w = document.getElementById('fam-zonas-filtro');
  if(w) w.innerHTML = htmlFiltroZonas(famFiltroZonas, 'toggleFiltroZonaFam');
  renderFamiliasList();
}
let famDetalleAbierta = null;
function renderFamilias(body){
  body.innerHTML = `
    <div id="fam-riesgo-wrap"></div>
    <div id="fam-zonasnuevas-wrap"></div>
    <div class="card" style="padding:14px 18px;"><div class="grid2">
      <div class="field" style="margin:0;"><label>Buscar familia</label><input type="text" id="fam-buscar" autocomplete="off" placeholder="Nombre..." value="${escaparHtml(famBusqueda)}" oninput="famBusqueda=this.value;renderFamiliasList();"></div>
      <div class="field" style="margin:0;"><button class="btn primary" style="width:100%;margin-top:22px;" onclick="abrirModalNuevaFamilia()">+ Agregar familia</button></div>
    </div>
    <div class="field" style="margin:12px 0 0;"><label>Zonas</label><div id="fam-zonas-filtro">${htmlFiltroZonas(famFiltroZonas, 'toggleFiltroZonaFam')}</div></div>
    </div>
    <div id="familiaslist"></div>
  `;
  famDetalleAbierta = null;
  cargarFamilias();
}
function abrirModalNuevaFamilia(){
  abrirModal(`
    <h2 style="margin:0 0 6px;">Nueva familia</h2>
    <div class="helper" style="margin-bottom:14px;">El precio es por familia: cuánto le cobramos por hora y cuánto le pagamos a la niñera. El margen se calcula solo.</div>
    <div class="grid3">
      <div class="field"><label>Nombre de la familia</label><input type="text" id="fam-nombre"></div>
      <div class="field"><label>Teléfono</label><input type="tel" id="fam-telefono"></div>
    </div>
    ${checklistZonas('fam', '', 'Zona')}
    <div class="grid3">
      <div class="field"><label>Cobro a familia ($/h)</label><input type="number" id="fam-cobro"></div>
      <div class="field"><label>Pago a niñera ($/h)</label><input type="number" id="fam-pago"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Dirección</label><input type="text" id="fam-direccion" placeholder="Para sugerir origen en traslados"></div>
    </div>
    ${htmlHijosFamilia('fam', [])}
    ${htmlCuentasBancarias('fam', [])}
    ${baseTieneTerminos() ? `<label class="chk" style="margin:4px 0 0;"><input type="checkbox" id="fam-terminos-nueva" onchange="onFamTerminosNuevaChange()"> Aceptó términos y condiciones</label>
    <div class="field" id="fam-terminos-nueva-fecha-wrap" style="margin:6px 0 10px;display:none;"><label>Fecha en que los aceptó</label><input type="date" id="fam-terminos-nueva-fecha" value="${todayISO()}"></div>` : ''}
    <div class="field"><label>Notas</label><textarea id="fam-notas"></textarea></div>
    <div class="confirmbtns">
      <button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primary" onclick="conGuardado(this, ()=>addFamilia())">Agregar familia</button>
    </div>`);
  protegerModal('familia:nueva');
}
// Términos y condiciones al dar de alta (20/10/2026): la casilla solo aparece si la base ya
// tiene la columna (con la base sin migrar, familias no la trae).
function baseTieneTerminos(){
  return !familiasSinTerminos && (!familiasItems.length || familiasItems.some(f=>'terminos_aceptados_el' in f));
}
function onFamTerminosNuevaChange(){
  document.getElementById('fam-terminos-nueva-fecha-wrap').style.display = document.getElementById('fam-terminos-nueva').checked ? '' : 'none';
}
async function addFamilia(){
  const nombre = document.getElementById('fam-nombre').value.trim();
  if(!nombre){ toast('Falta el nombre de la familia.','bad'); return; }
  const aceptoTerminos = !!document.getElementById('fam-terminos-nueva')?.checked;
  const terminosDesde = aceptoTerminos ? document.getElementById('fam-terminos-nueva-fecha').value : null;
  if(aceptoTerminos && !terminosDesde){ toast('Poné la fecha en que aceptó los términos.', 'bad'); return; }
  if(!(await confirmarNombreNuevo(nombre, familiasItems, 'familia'))) return;
  const fam = { nombre, zona:leerZonasChecklist('fam'), telefono:document.getElementById('fam-telefono').value,
    cobro_hora:document.getElementById('fam-cobro').value||null, pago_hora:document.getElementById('fam-pago').value||null,
    direccion:document.getElementById('fam-direccion').value,
    cuenta_bancaria:leerCuentasBancarias('fam'), notas:document.getElementById('fam-notas').value };
  if(aceptoTerminos) fam.terminos_aceptados_el = terminosDesde; // sin marcar no se manda: anda con la base sin migrar
  const { data, error } = await sb.from('familias').insert(fam).select().single();
  if(error){ toast('No se pudo guardar: '+error.message,'bad'); return; }
  const hijos = leerHijosFamilia('fam');
  if(hijos.length){
    const { error: e2 } = await sb.from('hijos_familia').insert(hijos.map((h,i)=>({...h, familia_id:data.id, orden:i})));
    if(e2){ cerrarModal(); toast('Familia guardada, pero no los hijos: '+e2.message, 'bad'); cargarFamilias(); return; }
  }
  cerrarModal();
  toast('Familia agregada.');
  cargarFamilias();
}
let famResenaPorNinera = {};
let famHistorialPorFamilia = {};
let famUltimaActividad = {};
let famPausas = []; // pausas de los fijos (vacaciones), solo con los fijos automáticos activados
const FAM_RIESGO_SEMANAS = 6;      // sin sittings hace más de esto = "en riesgo"
const FAM_RIESGO_SNOOZE_DIAS = 30; // al marcar "ya la contacté", no volver a avisar por este tiempo
let famRiesgoAbierto = false;      // arranca cerrado — antes mostraba todas de una, "cartel inmenso"
async function cargarFamilias(){
  await esperarConfigFijos(); // fijos automáticos: saber si hay que sacar los previstos
  // Las zonas se esperan: el filtro, el panel de "barrios sin zona" y el selector de Editar las usan.
  if(!zonaGruposCache) await cargarZonaGrupos();
  const cont = document.getElementById('familiaslist');
  if(!cont) return; // se puede llamar desde otra pantalla (ej. al quitar una asignación fija desde Agenda) — sin esto, rompía ahí.
  cont.innerHTML = '<div class="empty"><span class="spinner dark"></span> Cargando…</div>';
  const necesitaNinieras = !ninierasItems.length;
  const [{data:familias, error}, {data:asignaciones}, {data:sittings}, {data:resenas}, ninierasRes, pausas] = await Promise.all([
    sb.from('familias').select('*, hijos_familia(*)').order('nombre'),
    sb.from('asignaciones').select('*'),
    leerTodasLasFilas(()=>sinPrevistos(sb.from('sittings_traslados').select('familia_nombre,ninera_nombre,fecha')).order('id')),
    sb.from('resenas_ninieras').select('ninera_nombre,puntuacion'),
    necesitaNinieras ? sb.from('ninieras').select('id,nombre') : Promise.resolve({data:null}), // con el id: el fijo guarda ninera_id (auditoría 21/10/2026)
    cargarPausasFijos(),
  ]);
  if(error){ cont.innerHTML = errBox(error); return; }
  famPausas = pausas || [];
  if(necesitaNinieras && ninierasRes?.data) ninierasItems = ninierasRes.data;
  famResenaPorNinera = {};
  (resenas||[]).forEach(r=>{
    if(r.puntuacion==null) return;
    const k = normaliza(r.ninera_nombre||'');
    if(!k) return;
    if(!famResenaPorNinera[k]) famResenaPorNinera[k] = {suma:0, cant:0};
    famResenaPorNinera[k].suma += Number(r.puntuacion);
    famResenaPorNinera[k].cant += 1;
  });
  famHistorialPorFamilia = {};
  famUltimaActividad = {};
  (sittings||[]).forEach(s=>{
    const kf = normaliza(s.familia_nombre||'');
    const kn = s.ninera_nombre;
    if(kf && kn){
      if(!famHistorialPorFamilia[kf]) famHistorialPorFamilia[kf] = {};
      famHistorialPorFamilia[kf][kn] = (famHistorialPorFamilia[kf][kn]||0) + 1;
    }
    if(kf && s.fecha && (!famUltimaActividad[kf] || s.fecha > famUltimaActividad[kf])) famUltimaActividad[kf] = s.fecha;
  });
  familiasItems = familias.map(f => ({...f, hijos: (f.hijos_familia||[]).slice().sort((a,b)=>a.orden-b.orden), asignaciones: (asignaciones||[]).filter(a=>a.familia_id===f.id)}));
  renderZonasNuevasPanel();
  const wZonas = document.getElementById('fam-zonas-filtro');
  if(wZonas) wZonas.innerHTML = htmlFiltroZonas(famFiltroZonas, 'toggleFiltroZonaFam');
  await cargarConteoIncidentesFamilias();
  renderFamiliasList();
  renderFamiliasEnRiesgo();
  if(famDetalleAbierta){
    if(familiasItems.some(f=>f.id===famDetalleAbierta)) verFamilia(famDetalleAbierta);
    else { famDetalleAbierta = null; cerrarModal(); }
  }
}
function semanasDesde(fechaStr){
  const ms = Date.now() - new Date(fechaStr+'T00:00:00').getTime();
  return Math.floor(ms / (7*24*3600*1000));
}
/* Borrador de mensaje — todavía no es el texto final acordado con Pau/Delfi
   (pendiente #10), así que se puede editar antes de copiarlo. */
function mensajeRiesgoPara(f){
  const primerNombre = (f.nombre||'').trim().split(' ')[0] || f.nombre;
  return `¡Hola ${primerNombre}! Somos de Parents’ Break 💛 Hace un tiempo que no coordinamos ningún sitting con ustedes y queríamos saber cómo están. Si necesitan una niñera o un traslado, contanos y lo vemos. Como agradecimiento por seguir confiando en nosotras, tenemos un 5% de descuento para el próximo servicio. ¡Esperamos su mensaje!`;
}
function toggleFamRiesgo(){ famRiesgoAbierto = !famRiesgoAbierto; renderFamiliasEnRiesgo(); }
function renderFamiliasEnRiesgo(){
  const wrap = document.getElementById('fam-riesgo-wrap');
  if(!wrap) return;
  const enRiesgo = familiasItems.filter(f=>{
    const ultima = famUltimaActividad[normaliza(f.nombre)];
    if(!ultima) return false; // nunca tuvo un sitting registrado — no es que "se enfrió", nunca arrancó
    if(semanasDesde(ultima) < FAM_RIESGO_SEMANAS) return false;
    if(f.contactada_riesgo_en){
      const diasDesdeContacto = Math.floor((Date.now() - new Date(f.contactada_riesgo_en+'T00:00:00').getTime())/(24*3600*1000));
      if(diasDesdeContacto < FAM_RIESGO_SNOOZE_DIAS) return false;
    }
    return true;
  }).sort((a,b)=> famUltimaActividad[normaliza(a.nombre)].localeCompare(famUltimaActividad[normaliza(b.nombre)]));

  if(!enRiesgo.length){ wrap.innerHTML = ''; return; }

  wrap.innerHTML = `
    <div class="card" style="padding:14px 18px;border-left:3px solid var(--clay);margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;cursor:pointer;" onclick="toggleFamRiesgo()">
        <h2 style="margin:0;">Familias en riesgo</h2>
        <div class="helper" style="margin:0;">${enRiesgo.length} sin pedir hace ${FAM_RIESGO_SEMANAS}+ semanas · ${famRiesgoAbierto?'tocá para cerrar ▲':'tocá para ver ▼'}</div>
      </div>
      ${famRiesgoAbierto ? `
      <div class="helper" style="margin:12px 0 12px;">El texto es un borrador — revisalo y ajustalo a tu gusto antes de mandarlo.</div>
      ${enRiesgo.map(f=>{
        const semanas = semanasDesde(famUltimaActividad[normaliza(f.nombre)]);
        return `
        <div class="agendarow" style="border-bottom:1px solid var(--line);align-items:flex-start;flex-wrap:wrap;">
          <div style="flex:1;min-width:220px;">
            <div style="font-weight:600;">${escaparHtml(f.nombre)}</div>
            <div class="helper" style="margin:2px 0 8px;">Hace ${semanas} semana${semanas===1?'':'s'} sin sittings</div>
            <textarea readonly style="width:100%;min-height:70px;font-size:12.5px;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px;" id="fam-riesgo-msj-${f.id}">${escaparHtml(mensajeRiesgoPara(f))}</textarea>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;min-width:150px;">
            ${f.telefono
              ? `<button class="btn primary" style="padding:6px 10px;font-size:12.5px;" onclick="enviarWhatsappRiesgo(${argJs(f.id)})">Enviar por WhatsApp</button>`
              : `<div class="helper" style="margin:0;color:var(--clay-text);">Sin teléfono cargado</div>`}
            <button class="smallbtn" onclick="copiarMensajeRiesgo(${argJs(f.id)})">Copiar mensaje</button>
            <button class="smallbtn" onclick="conGuardado(this, ()=>marcarContactadaRiesgo(${argJs(f.id)}))">Ya la contacté</button>
          </div>
        </div>`;
      }).join('')}` : ''}
    </div>`;
}
/* Uruguay: números locales vienen como "099123456" o "99123456" — wa.me
   necesita el formato internacional completo, sin 0 inicial ni espacios. */
function formatearTelefonoWhatsApp(tel){
  let d = (tel||'').replace(/\D/g,'');
  if(!d) return null;
  if(d.startsWith('598')) return d;
  if(d.startsWith('0')) d = d.slice(1);
  return '598'+d;
}
function enviarWhatsappRiesgo(id){
  const f = familiasItems.find(x=>x.id===id);
  if(!f) return;
  const tel = formatearTelefonoWhatsApp(f.telefono);
  if(!tel){ toast('Esta familia no tiene teléfono cargado — agregalo en su ficha primero.', 'bad'); return; }
  const ta = document.getElementById('fam-riesgo-msj-'+id);
  const texto = ta ? ta.value : mensajeRiesgoPara(f);
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank');
}
async function copiarMensajeRiesgo(id){
  const ta = document.getElementById('fam-riesgo-msj-'+id);
  if(!ta) return;
  try{
    await navigator.clipboard.writeText(ta.value);
    toast('Mensaje copiado — pegalo en WhatsApp.');
  }catch(e){
    toast('No se pudo copiar automático — seleccioná el texto a mano.', 'bad');
  }
}
async function marcarContactadaRiesgo(id){
  const { error } = await sb.from('familias').update({contactada_riesgo_en: todayISO()}).eq('id', id);
  if(error){ toast('No se pudo guardar: '+error.message, 'bad'); return; }
  const f = familiasItems.find(x=>x.id===id);
  if(f) f.contactada_riesgo_en = todayISO();
  toast('Anotado — no la vamos a mostrar como urgente por un tiempo.');
  renderFamiliasEnRiesgo();
}
let famIncidentesCount = {};
async function cargarConteoIncidentesFamilias(){
  const { data } = await sb.from('incidentes').select('familia_id,familia_nombre').not('familia_nombre','is',null);
  famIncidentesCount = {};
  (data||[]).forEach(i=>{
    const key = normaliza(i.familia_nombre||'');
    if(!key) return;
    famIncidentesCount[key] = (famIncidentesCount[key]||0) + 1;
  });
}
function renderFamiliasList(){
  const cont = document.getElementById('familiaslist');
  if(!cont) return;
  if(!familiasItems.length){ cont.innerHTML='<div class="empty">Todavía no hay familias cargadas.</div>'; return; }
  const q = normaliza(famBusqueda);
  const filtradas = familiasItems.filter(f=>{
    const matchNombre = !q || normaliza(f.nombre).includes(q);
    const matchZona = coincideFiltroZonas(f.zona, famFiltroZonas);
    return matchNombre && matchZona;
  });
  const countMsg = `<div class="helper" style="margin:0 0 8px;">${filtradas.length} de ${familiasItems.length} familias</div>`;
  if(!filtradas.length){ cont.innerHTML = countMsg + '<div class="empty">Ninguna familia coincide con la búsqueda.</div>'; return; }
  cont.innerHTML = countMsg + '<div class="person-list">' + filtradas.map(f=>{
    const margenFam = (Number(f.cobro_hora)||0) - (Number(f.pago_hora)||0);
    const tieneTarifa = f.cobro_hora || f.pago_hora;
    const badge = tieneTarifa
      ? `<span class="badge ${margenFam>=0?'good':'bad'}" style="font-size:10px;padding:2px 8px;">$${f.cobro_hora||0}/h</span>`
      : `<span class="badge warn" style="font-size:10px;padding:2px 8px;">Sin tarifa</span>`;
    return `
    <div class="person-row">
      <div class="av">${escaparHtml((f.nombre||'?').charAt(0).toUpperCase())}</div>
      <div class="info">
        <div class="name">${escaparHtml(f.nombre)}</div>
        <div class="meta">${escaparHtml(f.zona||'zona s/d')}${escaparHtml((() => { const r = resumenHijosFamilia(f.hijos); return r ? ' · niños: '+r : (f.ninos ? ' · niños: '+f.ninos : ''); })())}</div>
      </div>
      <div class="badge-slot">
        ${badge}
        ${famIncidentesCount[normaliza(f.nombre)] ? `<span class="badge bad" style="font-size:10px;padding:2px 8px;">${famIncidentesCount[normaliza(f.nombre)]} incidente${famIncidentesCount[normaliza(f.nombre)]===1?'':'s'}</span>` : ''}
      </div>
      <div class="rowbtns">
        <button class="smallbtn" onclick="verFamilia(${argJs(f.id)})">Ver ficha</button>
        <button class="smallbtn" onclick="editarFamilia(${argJs(f.id)})">Editar</button>
        <button class="pcard-delete" style="position:static;box-shadow:none;" onclick="conGuardado(this, ()=>eliminarFamilia(${argJs(f.id)}))" title="Eliminar familia" aria-label="Eliminar familia">${ICONS.trash}</button>
      </div>
    </div>`;
  }).join('') + '</div>';
}
function fmtFechaPausa(iso){ return new Date(iso+'T12:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'2-digit'}); }
function verFamilia(id){
  const f = familiasItems.find(x=>x.id===id);
  if(!f) return;
  famDetalleAbierta = id;
  const margenFam = (Number(f.cobro_hora)||0) - (Number(f.pago_hora)||0);
  const precioHtml = (f.cobro_hora||f.pago_hora) ? `<div class="precio-fam"><span>Cobro: <b>$${f.cobro_hora||0}/h</b></span><span>Pago: <b>$${f.pago_hora||0}/h</b></span><span class="${margenFam>=0?'margenpos':'margenneg'}">Margen: <b>$${margenFam}/h</b></span></div>` : '<div class="helper" style="color:var(--clay-text);">Sin precio cargado — editá la familia para ponerlo.</div>';
  // Fijos vigentes arriba; los que ya terminaron (cambio de niñera, fin del fijo) quedan
  // abajo como historial, editables por si la fecha estaba mal cargada.
  const hoyFam = todayISO();
  const filaAsig = a=>{
    const dias = (a.dias||[]).join(' ');
    const horario = a.hora_inicio ? `${a.hora_inicio.slice(0,5)}${a.hora_fin?'–'+a.hora_fin.slice(0,5):''}` : '—';
    const terminado = asignacionTerminada(a, hoyFam);
    // Pausas (vacaciones) de este fijo que todavía no terminaron: se ven y se quitan acá
    // también, no solo desde la Agenda (06/10/2026).
    const pausasHtml = famPausas.filter(p=>p.asignacion_id===a.id && p.hasta >= hoyFam).map(p=>`<div class="helper fam-pausa" style="margin:2px 0 0;">Pausado del ${fmtFechaPausa(p.desde)} al ${fmtFechaPausa(p.hasta)}${p.motivo?' · '+escaparHtml(p.motivo):''} <button class="smallbtn" onclick="conGuardado(this, ()=>quitarPausaFijo(${argJs(p.id)}))">Quitar pausa</button></div>`).join('');
    return `<tr><td>${escaparHtml(a.ninera_nombre)}</td><td>${tipoAsignacion(a)==='traslado'?'Traslado':'Sitting'} · ${dias||'—'} · ${horario}${tipoAsignacion(a)==='traslado' && a.cobro_traslado!=null ? ` · $${Number(a.cobro_traslado).toLocaleString('es-UY')} / $${Number(a.pago_traslado||0).toLocaleString('es-UY')}` : ''}<div class="helper" style="margin:2px 0 0;">${textoVigencia(a)}</div>${pausasHtml}</td><td><div class="tablecell-btns"><button class="smallbtn" onclick="abrirModalVigenciaAsignacion(${argJs(a.id)})">${tipoAsignacion(a)==='traslado' && 'cobro_traslado' in a ? 'Vigencia y precio' : 'Vigencia'}</button>${terminado || !fijosAutomaticosActivos ? '' : `<button class="smallbtn" onclick="abrirModalPausarFijo(${argJs(a.id)})">Pausar</button>`}${terminado ? '' : `<button class="smallbtn danger" onclick="abrirModalTerminarFijo(${argJs(a.id)})">Terminar</button>`}</div></td></tr>`;
  };
  const ordenAsig = (x,y)=>(y.vigente_desde||'').localeCompare(x.vigente_desde||'');
  const asigRows = (f.asignaciones||[]).filter(a=>!asignacionTerminada(a, hoyFam)).sort(ordenAsig).map(filaAsig).join('');
  const asigTerminadas = (f.asignaciones||[]).filter(a=>asignacionTerminada(a, hoyFam)).sort(ordenAsig);
  const historialFam = famHistorialPorFamilia[normaliza(f.nombre)] || {};
  const historialNombres = Object.keys(historialFam);
  const historialHtml = historialNombres.length ? `
    <div style="margin-top:14px;">
      <div class="card-section-title">Niñeras que trabajaron con esta familia</div>
      ${historialNombres.map(nn=>{
        const cant = historialFam[nn];
        const res = famResenaPorNinera[normaliza(nn)];
        const promedio = res ? (res.suma/res.cant).toFixed(1) : null;
        const colorProm = promedio===null ? 'var(--ink-soft)' : (Number(promedio)>=4 ? 'var(--good)' : Number(promedio)>=3 ? '#7A5A16' : 'var(--clay-text)');
        return `<div class="agendarow" style="border-bottom:1px solid var(--line);">
          <div>${escaparHtml(nn)} <span style="color:var(--ink-soft);font-size:12px;">· ${cant} ${cant===1?'sitting/traslado':'sittings/traslados'}</span></div>
          <div style="font-weight:600;color:${colorProm};">${promedio!==null ? '★ '+promedio+'/5 ('+res.cant+')' : 'Sin reseñas'}</div>
        </div>`;
      }).join('')}
    </div>` : '';
  abrirModal(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px;padding-right:44px;">
      <h2 style="margin:0;">${escaparHtml(f.nombre)}</h2>
      <div style="display:flex;gap:6px;">
        <button class="smallbtn" onclick="abrirModalIncidente(${argJs({familia_id:f.id, familia_nombre:f.nombre})})">+ Registrar incidente</button>
        <button class="btn primary" style="padding:7px 14px;font-size:12.5px;" onclick="editarFamilia(${argJs(f.id)})">Editar</button>
      </div>
    </div>
    <div class="helper">${escaparHtml(f.zona||'zona s/d')} ${escaparHtml(f.telefono?'· '+f.telefono:'')}</div>
    ${precioHtml}
    ${'terminos_aceptados_el' in f ? htmlTerminosFamilia(f) : ''}
    ${f.frecuencia_cobro?`<div class="helper">Frecuencia de cobro: ${escaparHtml(f.frecuencia_cobro)}</div>`:''}
    ${f.direccion?`<div class="helper">Dirección: ${escaparHtml(f.direccion)}</div>`:''}
    ${textoHijosFamilia(f.hijos) ? `<div class="helper">Niños:<br>${textoHijosFamilia(f.hijos)}</div>` : (f.ninos ? `<div class="helper">Niños: ${escaparHtml(f.ninos)}</div>` : '')}
    ${f.cuenta_bancaria && f.cuenta_bancaria.length ? `<div class="helper">Cuenta: ${escaparHtml(textoCuentasBancarias(f.cuenta_bancaria))}</div>` : ''}
    ${f.notas?`<div class="helper">${escaparHtml(f.notas)}</div>`:''}
    ${historialHtml}
    <div id="fam-saldo" style="margin-top:14px;"></div>
    <div id="fam-variantes" style="margin-top:14px;"></div>
    <div id="fam-incidentes" style="margin-top:14px;"></div>
    <div class="card-section-title">Niñeras asignadas</div>
    <div class="tablewrap"><table class="asigtable"><thead><tr><th>Niñera asignada</th><th>Días y horario</th><th></th></tr></thead>
      <tbody>${asigRows || '<tr><td colspan="3" style="color:var(--ink-soft);">Sin niñeras asignadas todavía.</td></tr>'}</tbody></table></div>
    ${asigTerminadas.length ? `<div class="helper" style="margin:10px 0 4px;">Fijos que ya terminaron</div>
    <div class="tablewrap"><table class="asigtable"><tbody>${asigTerminadas.map(filaAsig).join('')}</tbody></table></div>` : ''}
    <div class="grid3" style="margin-top:14px;">
      <div class="field" style="position:relative;"><label>Niñera</label>
        <input type="text" id="asig-nombre-${f.id}" autocomplete="off">
        <div id="asig-nombre-${f.id}-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
      </div>
      <div class="field"><label>Hora inicio</label>${selectHora('asig-horaini-'+f.id)}</div>
      <div class="field"><label>Hora fin</label>${selectHora('asig-horafin-'+f.id)}</div>
    </div>
    <div class="grid3">
      <div class="field"><label>Tipo</label><select id="asig-tipo-${f.id}"><option value="sitting">Sitting</option><option value="traslado">Traslado</option></select></div>
      <div class="field"><label>Desde</label><input type="date" id="asig-desde-${f.id}" value="${hoyFam}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Cobro por traslado (solo traslados)</label><div class="moneyfield"><input type="number" id="asig-cobro-${f.id}"></div></div>
      <div class="field"><label>Pago a la niñera por traslado</label><div class="moneyfield"><input type="number" id="asig-pago-${f.id}"></div></div>
    </div>
    <div class="field"><label>Días</label>
      <div class="dayrow" id="asig-dias-${f.id}">
        ${['L','M','X','J','V','S','D'].map(d=>`<button type="button" class="daybtn" onclick="this.classList.toggle('selected')">${d}</button>`).join('')}
      </div>
    </div>
    <button class="smallbtn" onclick="conGuardado(this, ()=>addAsignacion(${argJs(f.id)}))">+ Asignar niñera</button>`);
  // Buscador de la app, no la lista nativa: en el iPhone "pia" no encontraba "Pía" (25/10/2026).
  attachAutocomplete('asig-nombre-'+f.id, 'asig-nombre-'+f.id+'-dropdown', ()=>ninierasItems, ()=>{}, {sinCoincidencias:''});
  renderIncidentesEnFicha('fam-incidentes', 'familia', f.id, f.nombre);
  pintarSaldoEnFicha('fam-saldo', 'familia', f.id, f.nombre);
  pintarVariantesEnFicha(f.id);
}
/* Términos y condiciones (20/10/2026): la admin marca que la familia los aceptó y desde qué
   fecha. Desde ese día, el fin de cada sitting se le cobra redondeado (horasSitting, core.js).
   Con la base sin migrar la columna no viene y la casilla no se muestra. */
function htmlTerminosFamilia(f){
  const desde = f.terminos_aceptados_el;
  const fechaTxt = desde ? new Date(desde+'T12:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';
  return `<div id="fam-terminos" data-guardado="${escaparHtml(desde||'')}" style="margin:10px 0;">
    <label class="chk" style="margin:0;"><input type="checkbox" id="fam-terminos-chk" ${desde?'checked':''} onchange="onFamTerminosChange()"> Aceptó términos y condiciones</label>
    <div class="field" id="fam-terminos-fecha-wrap" style="margin:6px 0 0;display:${desde?'':'none'};"><label>Fecha en que los aceptó</label><input type="date" id="fam-terminos-fecha" value="${escaparHtml(desde||todayISO())}" onchange="onFamTerminosChange()"></div>
    <div class="helper" style="margin:4px 0 0;">${desde ? `Desde el ${fechaTxt}, el` : 'Si los aceptó, desde esa fecha el'} fin de cada sitting se le cobra redondeado a la media hora siguiente (con 5 minutos de tolerancia). A la niñera se le paga la hora real.</div>
    <button class="smallbtn" id="fam-terminos-guardar" style="display:none;margin-top:6px;" onclick="conGuardado(this, ()=>guardarTerminosFamilia(${argJs(f.id)}))">Guardar</button>
  </div>`;
}
function valorTerminosFamilia(){
  if(!document.getElementById('fam-terminos-chk')?.checked) return null;
  return document.getElementById('fam-terminos-fecha')?.value || '';
}
function onFamTerminosChange(){
  const box = document.getElementById('fam-terminos');
  if(!box) return;
  const valor = valorTerminosFamilia();
  document.getElementById('fam-terminos-fecha-wrap').style.display = valor===null ? 'none' : '';
  document.getElementById('fam-terminos-guardar').style.display = valor === (box.dataset.guardado || null) ? 'none' : '';
}
async function guardarTerminosFamilia(id){
  const valor = valorTerminosFamilia();
  if(valor===''){ toast('Poné la fecha en que aceptó los términos.', 'bad'); return; }
  const { error } = await sb.from('familias').update({terminos_aceptados_el: valor}).eq('id', id);
  if(error){ toast('No se pudo guardar: '+error.message, 'bad'); return; }
  const f = familiasItems.find(x=>x.id===id);
  if(f) f.terminos_aceptados_el = valor;
  // Cambia lo que se le cobra: los previstos de sus fijos y el sitting de hoy se recalculan.
  await sincronizarPrevistosFijos();
  await alinearHoyFijosDeFamilia(id);
  toast(valor ? 'Listo: aceptó los términos. El fin de sus sittings se cobra redondeado.' : 'Listo: se sacó la marca de los términos.');
  if(f && famDetalleAbierta===id && document.getElementById('fam-terminos')) verFamilia(id);
}
// Tarifa o términos nuevos: el sitting de hoy de sus fijos, si lo cargó el proceso y nadie lo
// tocó (06/10/2026, alinearRegistroDeHoy en agenda.js).
async function alinearHoyFijosDeFamilia(id){
  const { data: fijosFam } = await sb.from('asignaciones').select('*').eq('familia_id', id);
  for(const a of (fijosFam||[]).filter(a=>tipoAsignacion(a)==='sitting')) await alinearRegistroDeHoy(a.id, a, null, {noCancelar:true});
}
function editarFamilia(id){
  const f = familiasItems.find(x=>x.id===id);
  if(!f) return;
  registrarRenderizadorZona('ed-fam', ()=>editarFamilia(id));
  abrirModal(`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
      <div style="width:46px;height:46px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-family:'Baloo 2',sans-serif;font-weight:600;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${escaparHtml((f.nombre||'?').charAt(0).toUpperCase())}</div>
      <h2 style="margin:0;">Editar a ${escaparHtml(f.nombre)}</h2>
    </div>
    <div class="grid2">
      <div class="field"><label>Nombre</label><input type="text" id="ed-fam-nombre" value="${escaparHtml(f.nombre)}"></div>
      <div class="field"><label>Teléfono</label><input type="tel" id="ed-fam-telefono" value="${escaparHtml(f.telefono)}"></div>
      <div class="field"><label>Cobro a familia ($/h)</label><input type="number" id="ed-fam-cobro" value="${f.cobro_hora??''}"></div>
      <div class="field"><label>Pago a niñera ($/h)</label><input type="number" id="ed-fam-pago" value="${f.pago_hora??''}"></div>
      <div class="field"><label>Dirección</label><input type="text" id="ed-fam-direccion" value="${escaparHtml(f.direccion)}"></div>
      <div class="field"><label>Frecuencia de cobro</label><select id="ed-fam-frecuencia">
        <option value="diario" ${f.frecuencia_cobro==='diario'?'selected':''}>Diario (puntual)</option>
        <option value="semanal" ${f.frecuencia_cobro==='semanal'?'selected':''}>Semanal</option>
        <option value="mensual" ${(f.frecuencia_cobro||'mensual')==='mensual'?'selected':''}>Mensual</option>
      </select></div>
    </div>
    ${htmlHijosFamilia('ed-fam', f.hijos)}
    ${htmlCuentasBancarias('ed-fam', f.cuenta_bancaria)}
    ${checklistZonas('ed-fam', f.zona)}
    <div class="field"><label>Notas</label><textarea id="ed-fam-notas">${escaparHtml(f.notas)}</textarea></div>
    <div class="confirmbtns">
      <button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primary" onclick="conGuardado(this, ()=>guardarEdicionFamilia(${argJs(id)}))">Guardar</button>
    </div>`);
  protegerModal('familia:'+id); // borrador y aviso antes de cerrar con cambios (21/10/2026)
}
async function guardarEdicionFamilia(id){
  const cambios = {
    nombre: document.getElementById('ed-fam-nombre').value,
    zona: leerZonasChecklist('ed-fam'),
    telefono: document.getElementById('ed-fam-telefono').value,
    cobro_hora: document.getElementById('ed-fam-cobro').value||null,
    pago_hora: document.getElementById('ed-fam-pago').value||null,
    direccion: document.getElementById('ed-fam-direccion').value,
    cuenta_bancaria: leerCuentasBancarias('ed-fam'),
    frecuencia_cobro: document.getElementById('ed-fam-frecuencia').value,
    notas: document.getElementById('ed-fam-notas').value,
  };
  const { error } = await sb.from('familias').update(cambios).eq('id', id);
  if(error){ toast('No se pudo guardar: '+error.message,'bad'); return; }
  // Hijos: se reemplaza la lista entera, porque el formulario siempre manda la lista completa.
  // Primero se cargan los nuevos y recién después se borran los de antes: si algo falla a
  // mitad de camino nunca se pierden los hijos (antes se borraba primero sin mirar el error).
  const hijos = leerHijosFamilia('ed-fam');
  const { data: previos, error: e0 } = await sb.from('hijos_familia').select('id').eq('familia_id', id);
  let errHijos = e0;
  if(!errHijos && hijos.length){
    const { error: e2 } = await sb.from('hijos_familia').insert(hijos.map((h,i)=>({...h, familia_id:id, orden:i})));
    errHijos = e2;
  }
  if(!errHijos && (previos||[]).length){
    const { error: e3 } = await sb.from('hijos_familia').delete().in('id', previos.map(h=>h.id));
    errHijos = e3;
  }
  cerrarModal();
  // Fijos automáticos: con tarifa o nombre nuevos se recalculan los previstos que nadie tocó.
  await sincronizarPrevistosFijos();
  // Tarifa nueva: también el sitting de hoy de sus fijos.
  const antes = familiasItems.find(x=>x.id===id);
  if(antes && (String(antes.cobro_hora ?? '') !== String(cambios.cobro_hora ?? '') || String(antes.pago_hora ?? '') !== String(cambios.pago_hora ?? ''))){
    await alinearHoyFijosDeFamilia(id);
  }
  if(errHijos) toast('Se guardó lo demás, pero no los hijos: '+errHijos.message, 'bad');
  else toast('Cambios guardados.');
  const scrollF1 = guardarScrollMainarea();
  await cargarFamilias();
  restaurarScrollMainarea(scrollF1);
}
async function addAsignacion(famId){
  const nombre = document.getElementById('asig-nombre-'+famId).value.trim();
  if(!nombre){ toast('Falta el nombre de la niñera.','bad'); return; }
  const dias = Array.from(document.querySelectorAll(`#asig-dias-${famId} .daybtn.selected`)).map(b=>b.textContent);
  // Mismos controles que al crear un fijo desde Sittings o la Agenda (05/10/2026): antes se
  // podía guardar sin días (un fijo que nunca aparece), con la hora de fin antes que la de
  // inicio, y sin el aviso de que la niñera ya tiene otro fijo en ese horario.
  const hi = leerHora('asig-horaini-'+famId), hf = leerHora('asig-horafin-'+famId);
  const tipoNuevo = document.getElementById('asig-tipo-'+famId)?.value || 'sitting';
  const precio = tipoNuevo==='traslado' ? { cobro_traslado: Number(document.getElementById('asig-cobro-'+famId)?.value)||null, pago_traslado: Number(document.getElementById('asig-pago-'+famId)?.value)||null } : {};
  const problema = problemaFijoNuevo({ dias, hora_inicio: hi, tipo: tipoNuevo, ...precio });
  if(problema){ toast(problema,'bad'); return; }
  if(hi && hf && hf <= hi){ toast('La hora de fin tiene que ser después de la de inicio.','bad'); return; }
  if(!(await avisarSiFijoDuplicado({ familia_id: famId, ninera_nombre: nombre, dias, vigente_desde: document.getElementById('asig-desde-'+famId)?.value || todayISO() }))) return;
  const choque = await chequearFijoNuevoContraTodo(nombre, dias, hi||null, hf||null);
  if(!(await avisarSiDobleReserva(choque, nombre, 'Asignar igual'))) return;
  const ninera = (ninierasItems||[]).find(n=>normaliza(n.nombre)===normaliza(nombre));
  const asig = { familia_id:famId, ninera_nombre:nombre, ninera_id: ninera?.id || null, dias,
    hora_inicio:leerHora('asig-horaini-'+famId)||null, hora_fin:leerHora('asig-horafin-'+famId)||null,
    tipo: tipoNuevo, ...precio,
    vigente_desde: document.getElementById('asig-desde-'+famId)?.value || todayISO() };
  const { error } = await escribirAsignacion(p=>sb.from('asignaciones').insert(p), asig);
  if(error){ toast('No se pudo agregar: '+error.message,'bad'); return; }
  await sincronizarPrevistosFijos();
  toast('Niñera asignada.');
  cargarFamilias();
}
async function eliminarFamilia(id){
  if(!(await confirmarAccion('¿Eliminar esta familia? No se puede deshacer.'))) return;
  const { error } = await sb.from('familias').delete().eq('id', id);
  if(error){ toast('No se pudo eliminar: '+error.message,'bad'); return; }
  if(famDetalleAbierta===id){ famDetalleAbierta=null; cerrarModal(); }
  const scrollF2 = guardarScrollMainarea();
  await cargarFamilias();
  restaurarScrollMainarea(scrollF2);
}


/* ================= VARIANTES DE PRECIO (23/10/2026) =================
   Los casos especiales de una familia ("la llevó a la casa", "no se hizo: se cobra igual y a la
   niñera se le paga un monto fijo") dejan de ser notas y montos cambiados a mano. Al registrar (y en el
   Cierre de los fijos de Hoy) hay un ajuste libre siempre a mano y, con un toque, se guarda como
   botón de esa familia. Las variantes se ven, editan y borran en la ficha; pueden ser solo de
   un fijo y programarse para aplicarse solas desde una fecha y en ciertos días (la carga de
   previstos de la base). Cuáles se aplicaron queda en sittings_traslados.precio_variantes, con
   la base, copiadas tal cual (no cambian si después se edita o se borra la variante). La cuenta
   la hace aplicarVariantes (core.js). Pensado para que la app de niñeras use lo mismo. Con la
   base sin migrar no se muestra nada y todo sigue como antes. */
let variantesPrecioDisponible = true;
async function cargarVariantesFamilia(familiaId){
  if(!variantesPrecioDisponible || !familiaId) return [];
  const { data, error } = await sb.from('variantes_precio').select('*').eq('familia_id', familiaId).order('created_at').order('id');
  if(error){
    if(esFaltaTabla(error)) variantesPrecioDisponible = false;
    else toast('No se pudieron leer las variantes de precio: '+error.message, 'bad');
    return [];
  }
  return data||[];
}
// La fila de la tabla como se guarda en un registro: { id, nombre, motivo, cobro, pago }.
function aplicadaDeVariante(v){
  const efecto = (modo, valor) => modo ? { modo, valor: Number(valor)||0 } : null;
  return { id: v.id, nombre: v.nombre, motivo: v.motivo || null, cobro: efecto(v.cobro_modo, v.cobro_valor), pago: efecto(v.pago_modo, v.pago_valor) };
}
// "Familia +$450 · Niñera +$250", "Niñera: total $180", "Familia −50%".
function textoEfectoVariante(a){
  const plata = n => Math.abs(Number(n)||0).toLocaleString('es-UY', {maximumFractionDigits:2});
  const lado = (e, quien) => {
    if(!e || !e.modo) return '';
    const v = Number(e.valor)||0;
    if(e.modo==='total') return `${quien}: total $${plata(v)}`;
    if(e.modo==='porcentaje') return `${quien} ${v<0 ? '−' : '+'}${plata(v)}%`;
    return `${quien} ${v<0 ? '−' : '+'}$${plata(v)}`;
  };
  return [lado(a.cobro, 'Familia'), lado(a.pago, 'Niñera')].filter(Boolean).join(' · ');
}
// Nombres de las variantes de un registro, para mostrarlos (Por cobrar / Por pagar, PDF).
function nombresVariantes(precioVariantes){
  return (precioVariantes?.aplicadas||[]).map(a=>a.nombre).filter(Boolean).join(' + ');
}
// Un solo motivo para el registro: el de las variantes; si son distintos, 'otro'.
function motivoDeVariantes(aplicadas){
  const motivos = [...new Set((aplicadas||[]).map(a=>a.motivo).filter(Boolean))];
  return motivos.length > 1 ? 'otro' : (motivos[0] || null);
}

/* ---- Botones de variantes + ajuste libre: uno por prefijo ('sit' en el registro, 'cierre' en
   el Cierre de los fijos). El que lo usa da la base (cobro y pago sin variantes) y se entera
   de cada cambio para actualizar lo suyo (margen, etc.). ---- */
const variantesUI = {};
async function prepararVariantesPrecio(prefijo, { familiaId, tipo, asignacionId=null, aplicadas=null, base, alCambiar=null }){
  const box = document.getElementById(prefijo+'-variantes');
  if(!box) return;
  const anterior = variantesUI[prefijo];
  // Si se vuelve a preparar en el mismo formulario (cambió el tipo o la familia), lo ya
  // marcado que sigue valiendo se conserva.
  const yaElegidas = aplicadas ?? (anterior && anterior.familiaId===familiaId ? anterior.elegidas : []);
  const libreAnterior = aplicadas ? (aplicadas.find(a=>a.libre) || null) : (anterior?.libre || null);
  const ui = { familiaId, tipo, asignacionId, base, alCambiar, lista: [], chips: [], elegidas: [], libre: libreAnterior, libreAbierto: !!libreAnterior, inactivo: true };
  variantesUI[prefijo] = ui;
  const lista = familiaId ? await cargarVariantesFamilia(familiaId) : [];
  if(variantesUI[prefijo] !== ui) return; // se volvió a preparar mientras tanto
  if(!variantesPrecioDisponible || !familiaId || !document.getElementById(prefijo+'-variantes')){
    box.innerHTML = '';
    alCambiar?.();
    return;
  }
  ui.inactivo = false;
  ui.lista = lista;
  const aplica = v => v.activa && (v.aplica_a==='ambos' || v.aplica_a===tipo) && (!v.asignacion_id || v.asignacion_id===asignacionId);
  // Las guardadas en el registro van como se aplicaron (aunque la variante se haya editado o
  // borrado); las demás, las de esta familia que aplican a este tipo y a este fijo.
  const guardadas = (yaElegidas||[]).filter(a=>!a.libre);
  const idsGuardadas = new Set(guardadas.map(a=>a.id).filter(Boolean));
  ui.chips = [
    ...guardadas.map(a=>({ aplicada: a, elegida: true })),
    ...lista.filter(v=>aplica(v) && !idsGuardadas.has(v.id)).map(v=>({ aplicada: aplicadaDeVariante(v), elegida: false })),
  ];
  pintarVariantesPrecio(prefijo);
}
function pintarVariantesPrecio(prefijo){
  const ui = variantesUI[prefijo], box = document.getElementById(prefijo+'-variantes');
  if(!ui || ui.inactivo || !box) return;
  const motivoOpts = sel => `<option value="">Elegí el motivo…</option>${MOTIVOS_PRECIO.map(([v, t])=>`<option value="${v}"${sel===v ? ' selected' : ''}>${t}</option>`).join('')}`;
  const l = ui.libre || {};
  box.innerHTML = `<div class="variantes-box">
    <div class="variantes-titulo">Variantes y ajustes <span class="helper" style="margin:0;">de esta familia</span></div>
    ${ui.chips.length ? `<div class="variantes-chips">${ui.chips.map((c, k)=>`<button type="button" class="variante-chip${c.elegida ? ' on' : ''}" aria-pressed="${c.elegida}" onclick="tocarVariantePrecio(${argJs(prefijo)}, ${k})">
        <b>${escaparHtml(c.aplicada.nombre)}</b><span>${escaparHtml(textoEfectoVariante(c.aplicada))}</span></button>`).join('')}</div>`
      : '<div class="helper" style="margin:2px 0 6px;">Todavía no tiene variantes. Hacé un ajuste y guardalo como botón.</div>'}
    ${ui.libreAbierto ? `<div class="variante-libre">
      <div class="grid2">
        <div class="field"><label for="${prefijo}-libre-cobro">A la familia (+ o −)</label><input type="number" id="${prefijo}-libre-cobro" value="${l.cobro?.valor ?? ''}" placeholder="ej. 500" oninput="cambioAjusteLibre(${argJs(prefijo)})"></div>
        <div class="field"><label for="${prefijo}-libre-pago">A la niñera (+ o −)</label><input type="number" id="${prefijo}-libre-pago" value="${l.pago?.valor ?? ''}" placeholder="ej. 300" oninput="cambioAjusteLibre(${argJs(prefijo)})"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="${prefijo}-libre-texto">Por qué</label><input type="text" id="${prefijo}-libre-texto" maxlength="60" value="${escaparHtml(l.nombre && l.nombre!=='Ajuste' ? l.nombre : '')}" placeholder="ej. La llevó a la casa" oninput="cambioAjusteLibre(${argJs(prefijo)})"></div>
        <div class="field"><label for="${prefijo}-libre-motivo">Motivo</label><select id="${prefijo}-libre-motivo" onchange="cambioAjusteLibre(${argJs(prefijo)})">${motivoOpts(l.motivo || '')}</select></div>
      </div>
      <div class="variante-libre-btns">
        <button type="button" class="smallbtn" onclick="conGuardado(this, ()=>guardarAjusteComoBoton(${argJs(prefijo)}))">Guardar como botón</button>
        <button type="button" class="smallbtn" onclick="quitarAjusteLibre(${argJs(prefijo)})">Quitar ajuste</button>
      </div>
    </div>` : `<button type="button" class="smallbtn variante-libre-abrir" onclick="abrirAjusteLibre(${argJs(prefijo)})">+ Ajuste libre</button>`}
    <div class="helper variantes-resumen" style="margin:6px 0 0;"></div>
  </div>`;
  actualizarResumenVariantes(prefijo);
}
function tocarVariantePrecio(prefijo, k){
  const ui = variantesUI[prefijo];
  if(!ui?.chips[k]) return;
  ui.chips[k].elegida = !ui.chips[k].elegida;
  const chip = document.querySelectorAll(`#${prefijo}-variantes .variante-chip`)[k];
  if(chip){ chip.classList.toggle('on', ui.chips[k].elegida); chip.setAttribute('aria-pressed', String(ui.chips[k].elegida)); }
  actualizarResumenVariantes(prefijo);
}
function abrirAjusteLibre(prefijo){
  const ui = variantesUI[prefijo];
  if(!ui) return;
  ui.libreAbierto = true;
  pintarVariantesPrecio(prefijo);
  document.getElementById(prefijo+'-libre-cobro')?.focus();
}
function quitarAjusteLibre(prefijo){
  const ui = variantesUI[prefijo];
  if(!ui) return;
  ui.libre = null; ui.libreAbierto = false;
  pintarVariantesPrecio(prefijo);
}
// El ajuste libre tal como está escrito (o null si no suma ni resta nada).
function leerAjusteLibre(prefijo){
  const ui = variantesUI[prefijo];
  if(!ui?.libreAbierto) return ui?.libre || null;
  const val = id => { const t = document.getElementById(prefijo+'-libre-'+id)?.value; return t==='' || t==null ? null : Number(t); };
  const cobro = val('cobro'), pago = val('pago');
  const texto = (document.getElementById(prefijo+'-libre-texto')?.value || '').trim();
  const motivo = document.getElementById(prefijo+'-libre-motivo')?.value || null;
  if(!cobro && !pago) return null;
  return { id: null, libre: true, nombre: texto || 'Ajuste', motivo,
    cobro: cobro ? { modo: 'sumar', valor: cobro } : null, pago: pago ? { modo: 'sumar', valor: pago } : null };
}
function cambioAjusteLibre(prefijo){
  const ui = variantesUI[prefijo];
  if(!ui) return;
  ui.libre = leerAjusteLibre(prefijo);
  actualizarResumenVariantes(prefijo);
}
// Lo que se aplica: los botones marcados, en el orden de la lista, y el ajuste libre al final.
// error: el ajuste libre sin motivo. inactivo: sin variantes en la base (no se manda nada).
function leerVariantesPrecio(prefijo){
  const ui = variantesUI[prefijo];
  if(!ui || ui.inactivo) return { inactivo: true, aplicadas: null };
  const libre = leerAjusteLibre(prefijo);
  if(libre && !libre.motivo) return { error: 'Elegí el motivo del ajuste: descuento, extra, se cobra sin servicio u otro.' };
  const aplicadas = [...ui.chips.filter(c=>c.elegida).map(c=>c.aplicada), ...(libre ? [libre] : [])];
  return { aplicadas: aplicadas.length ? aplicadas : null, motivo: motivoDeVariantes(aplicadas) };
}
// Cobro y pago con lo elegido, sobre la base que da el formulario (null si no hay nada elegido).
function precioConVariantesUI(prefijo){
  const ui = variantesUI[prefijo];
  if(!ui || ui.inactivo) return null;
  const libre = leerAjusteLibre(prefijo);
  const aplicadas = [...ui.chips.filter(c=>c.elegida).map(c=>c.aplicada), ...(libre ? [libre] : [])];
  if(!aplicadas.length) return null;
  const b = ui.base ? ui.base() : { cobro: 0, pago: 0 };
  return aplicarVariantes(b.cobro, b.pago, aplicadas);
}
// avisar = false cuando lo llama quien ya actualiza lo suyo (calcSitMargen).
function actualizarResumenVariantes(prefijo, avisar=true){
  const ui = variantesUI[prefijo];
  const el = document.querySelector(`#${prefijo}-variantes .variantes-resumen`);
  const p = precioConVariantesUI(prefijo);
  if(el) el.innerHTML = p ? `Con los ajustes: <b>cobro $${p.cobro.toLocaleString('es-UY')} · pago $${p.pago.toLocaleString('es-UY')}</b>. Se guarda esto.` : '';
  if(avisar) ui?.alCambiar?.();
}
// "Guardar como botón": el ajuste libre pasa a ser una variante de la familia (sumar lo escrito,
// para este tipo de servicio) y queda marcado como botón.
async function guardarAjusteComoBoton(prefijo){
  const ui = variantesUI[prefijo];
  if(!ui || ui.inactivo) return;
  const libre = leerAjusteLibre(prefijo);
  if(!libre){ toast('Escribí cuánto suma o resta a la familia o a la niñera.', 'bad'); return; }
  if(libre.nombre==='Ajuste'){ toast('Escribí por qué (es el nombre del botón).', 'bad'); document.getElementById(prefijo+'-libre-texto')?.focus(); return; }
  if(!libre.motivo){ toast('Elegí el motivo del ajuste.', 'bad'); return; }
  const fila = { familia_id: ui.familiaId, nombre: libre.nombre, aplica_a: ui.tipo==='traslado' ? 'traslado' : 'sitting', asignacion_id: null,
    cobro_modo: libre.cobro ? 'sumar' : null, cobro_valor: libre.cobro ? libre.cobro.valor : null,
    pago_modo: libre.pago ? 'sumar' : null, pago_valor: libre.pago ? libre.pago.valor : null,
    motivo: libre.motivo, auto_desde: null, auto_hasta: null, auto_dias: null, activa: true, creado_por: registradoPorUsuario() || null };
  const { data, error } = await sb.from('variantes_precio').insert(fila).select().single();
  if(error){ toast('No se pudo guardar el botón: '+error.message, 'bad'); return; }
  ui.lista.push(data);
  ui.chips.push({ aplicada: aplicadaDeVariante(data), elegida: true });
  ui.libre = null; ui.libreAbierto = false;
  pintarVariantesPrecio(prefijo);
  toast('Guardado como botón de esta familia.');
}

/* ---- En la ficha de la familia: la lista, nueva / editar / borrar. El formulario va en una
   capa encima de la ficha, para no perderla (como el saldo a favor). ---- */
async function pintarVariantesEnFicha(familiaId){
  const cont = document.getElementById('fam-variantes');
  if(!cont) return;
  const lista = await cargarVariantesFamilia(familiaId);
  if(!variantesPrecioDisponible || !document.getElementById('fam-variantes')){ cont.innerHTML = ''; return; }
  const f = familiasItems.find(x=>x.id===familiaId);
  const fijo = id => (f?.asignaciones||[]).find(a=>a.id===id);
  const fmtF = iso => iso ? `${iso.slice(8,10)}/${iso.slice(5,7)}` : '';
  const aplica = { ambos: 'Sittings y traslados', sitting: 'Sittings', traslado: 'Traslados' };
  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;">
      <div class="card-section-title" style="margin:0;">Variantes de precio</div>
      <button class="smallbtn" style="min-height:36px;" onclick="abrirModalVariantePrecio(${argJs(familiaId)}, null)">+ Nueva variante</button>
    </div>
    ${lista.length ? lista.map(v=>{
      const a = fijo(v.asignacion_id);
      const deFijo = a ? ` · solo el fijo de ${escaparHtml(a.ninera_nombre)}` : '';
      const dias = (v.auto_dias||[]).map(d=>DIAS_CORTO[d]||d).join(' ');
      const programada = v.auto_desde ? `<div class="helper" style="margin:2px 0 0;">Se aplica sola desde el ${fmtF(v.auto_desde)}${v.auto_hasta ? ' hasta el '+fmtF(v.auto_hasta) : ''}${dias ? ', los '+dias : ''}</div>` : '';
      return `<div class="agendarow variante-ficha" style="border-bottom:1px solid var(--line);flex-wrap:wrap;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;">${escaparHtml(v.nombre)}${v.activa ? '' : ' <span class="badge warn">Pausada</span>'}</div>
          <div class="helper" style="margin:2px 0 0;">${escaparHtml(textoEfectoVariante(aplicadaDeVariante(v)))} · ${aplica[v.aplica_a] || ''}${deFijo}</div>
          ${programada}
        </div>
        <div style="display:flex;gap:6px;">
          <button class="smallbtn" style="min-height:36px;" onclick="abrirModalVariantePrecio(${argJs(familiaId)}, ${argJs(v.id)})">Editar</button>
          <button class="smallbtn danger" style="min-height:36px;" onclick="conGuardado(this, ()=>eliminarVariantePrecio(${argJs(familiaId)}, ${argJs(v.id)}))">Borrar</button>
        </div>
      </div>`;
    }).join('') : '<div class="helper" style="margin:4px 0;">Sin variantes. Se crean acá o con "Guardar como botón" al registrar.</div>'}`;
}
async function abrirModalVariantePrecio(familiaId, id){
  const lista = await cargarVariantesFamilia(familiaId);
  const v = id ? lista.find(x=>x.id===id) : null;
  if(id && !v){ toast('Esa variante ya no existe.', 'bad'); pintarVariantesEnFicha(familiaId); return; }
  const f = familiasItems.find(x=>x.id===familiaId);
  const fijos = (f?.asignaciones||[]).filter(a=>!asignacionTerminada(a, todayISO()));
  const modoOpts = sel => `<option value="">No cambia</option>${MODOS_VARIANTE.map(([m, t])=>`<option value="${m}"${sel===m ? ' selected' : ''}>${t}</option>`).join('')}`;
  const overlay = document.createElement('div');
  overlay.className = 'confirmoverlay';
  overlay.id = 'variante-overlay';
  overlay.innerHTML = `
    <div class="confirmbox wide" role="dialog" aria-label="Variante de precio">
      <h2 style="margin:0 0 4px;">${v ? 'Editar variante' : 'Nueva variante'}</h2>
      <div class="helper" style="margin:0 0 12px;">${escaparHtml(f?.nombre || '')} · aparece como botón al registrar.</div>
      <div class="field"><label for="var-nombre">Nombre</label><input type="text" id="var-nombre" maxlength="60" value="${escaparHtml(v?.nombre || '')}" placeholder="ej. La llevó a la casa"></div>
      <div class="grid2">
        <div class="field"><label for="var-aplica">Para</label><select id="var-aplica">
          ${[['ambos','Sittings y traslados'],['sitting','Sittings'],['traslado','Traslados']].map(([k, t])=>`<option value="${k}"${(v?.aplica_a||'ambos')===k ? ' selected' : ''}>${t}</option>`).join('')}
        </select></div>
        <div class="field"><label for="var-motivo">Motivo</label><select id="var-motivo"><option value="">Sin motivo</option>${MOTIVOS_PRECIO.map(([k, t])=>`<option value="${k}"${v?.motivo===k ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="var-cobro-modo">A la familia</label><select id="var-cobro-modo">${modoOpts(v?.cobro_modo || '')}</select>
          <input type="number" id="var-cobro-valor" style="margin-top:6px;" value="${v?.cobro_valor ?? ''}" placeholder="Monto o %"></div>
        <div class="field"><label for="var-pago-modo">A la niñera</label><select id="var-pago-modo">${modoOpts(v?.pago_modo || '')}</select>
          <input type="number" id="var-pago-valor" style="margin-top:6px;" value="${v?.pago_valor ?? ''}" placeholder="Monto o %"></div>
      </div>
      <div class="helper" style="margin:-4px 0 10px;">Sumar o restar (ej. 500 o −200), total fijo (reemplaza el precio) o porcentaje (−50 = la mitad).</div>
      <div class="field"><label for="var-fijo">Solo para un fijo (opcional)</label><select id="var-fijo" onchange="pintarDiasVariante()">
        <option value="">Para cualquier sitting o traslado de la familia</option>
        ${fijos.map(a=>`<option value="${escaparHtml(a.id)}" data-dias="${escaparHtml((a.dias||[]).join(','))}"${v?.asignacion_id===a.id ? ' selected' : ''}>${escaparHtml(a.ninera_nombre)} · ${tipoAsignacion(a)==='traslado' ? 'Traslado' : 'Sitting'} · ${escaparHtml((a.dias||[]).join(' '))}${a.hora_inicio ? ' · '+escaparHtml(a.hora_inicio.slice(0,5)) : ''}</option>`).join('')}
      </select></div>
      <div id="var-programa-box">
        <label class="chk" style="margin:0 0 8px;"><input type="checkbox" id="var-programar"${v?.auto_desde ? ' checked' : ''} onchange="pintarDiasVariante()"> Que se aplique sola a ese fijo desde una fecha</label>
        <div id="var-programa" style="display:none;">
          <div class="grid2">
            <div class="field"><label for="var-desde">Desde</label><input type="date" id="var-desde" value="${v?.auto_desde || ''}"></div>
            <div class="field"><label for="var-hasta">Hasta (opcional)</label><input type="date" id="var-hasta" value="${v?.auto_hasta || ''}"></div>
          </div>
          <div class="field"><label>Qué días</label><div class="dayrow" id="var-dias" data-elegidos="${escaparHtml((v?.auto_dias||[]).join(','))}"></div>
          <div class="helper" style="margin:4px 0 0;">Sin días marcados: todos los días del fijo.</div></div>
        </div>
      </div>
      <div id="variante-warn"></div>
      <div class="confirmbtns">
        <button class="btn ghost" id="variante-cancelar">Cancelar</button>
        <button class="btn primary" id="variante-guardar" onclick="conGuardado(this, ()=>guardarVariantePrecio(${argJs(familiaId)}, ${argJs(id)}))">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(()=>overlay.classList.add('show'));
  overlay.querySelector('#variante-cancelar').addEventListener('click', cerrarModalVariantePrecio);
  pintarDiasVariante();
}
// Los días de la programación son los del fijo elegido; arrancan sin marcar (= todos).
function pintarDiasVariante(){
  const sel = document.getElementById('var-fijo'), box = document.getElementById('var-programa-box');
  if(!sel || !box) return;
  const opcion = sel.selectedOptions[0];
  box.style.display = sel.value ? '' : 'none';
  const programar = !!sel.value && document.getElementById('var-programar').checked;
  document.getElementById('var-programa').style.display = programar ? '' : 'none';
  const dias = document.getElementById('var-dias');
  const elegidos = new Set([...dias.querySelectorAll('.daybtn.selected')].map(b=>b.dataset.dia).concat((dias.dataset.elegidos||'').split(',').filter(Boolean)));
  dias.dataset.elegidos = '';
  dias.innerHTML = (opcion?.dataset.dias||'').split(',').filter(Boolean).map(d=>`<button type="button" class="daybtn${elegidos.has(d) ? ' selected' : ''}" data-dia="${escaparHtml(d)}" onclick="this.classList.toggle('selected')">${escaparHtml(DIAS_CORTO[d]||d)}</button>`).join('');
}
function cerrarModalVariantePrecio(){
  const o = document.getElementById('variante-overlay');
  if(!o) return;
  o.classList.remove('show');
  o.id = '';
  setTimeout(()=>o.remove(), 180);
}
async function guardarVariantePrecio(familiaId, id){
  const warn = document.getElementById('variante-warn');
  const val = k => document.getElementById(k)?.value ?? '';
  const nombre = val('var-nombre').trim();
  if(!nombre){ warn.innerHTML = '<div class="warnbox">Ponele un nombre: es lo que dice el botón.</div>'; return; }
  const lado = k => {
    const modo = val(`var-${k}-modo`), txt = val(`var-${k}-valor`);
    if(!modo) return { modo: null, valor: null };
    if(txt==='' || !isFinite(Number(txt))) return { error: `Poné el monto o el porcentaje ${k==='cobro' ? 'de la familia' : 'de la niñera'}.` };
    if(modo==='total' && Number(txt) < 0) return { error: 'Un total fijo no puede ser negativo.' };
    return { modo, valor: Number(txt) };
  };
  const cobro = lado('cobro'), pago = lado('pago');
  if(cobro.error || pago.error){ warn.innerHTML = `<div class="warnbox">${escaparHtml(cobro.error || pago.error)}</div>`; return; }
  if(!cobro.modo && !pago.modo){ warn.innerHTML = '<div class="warnbox">Decí qué le cambia al cobro o al pago (o a los dos).</div>'; return; }
  const asignacionId = val('var-fijo') || null;
  const programar = !!asignacionId && document.getElementById('var-programar').checked;
  const desde = programar ? val('var-desde') : '', hasta = programar ? val('var-hasta') : '';
  if(programar && !desde){ warn.innerHTML = '<div class="warnbox">Elegí desde qué fecha se aplica sola.</div>'; return; }
  if(hasta && hasta < desde){ warn.innerHTML = '<div class="warnbox">El "hasta" tiene que ser después del "desde".</div>'; return; }
  const dias = programar ? [...document.querySelectorAll('#var-dias .daybtn.selected')].map(b=>b.dataset.dia) : [];
  const fila = { familia_id: familiaId, nombre, aplica_a: val('var-aplica') || 'ambos', motivo: val('var-motivo') || null, asignacion_id: asignacionId,
    cobro_modo: cobro.modo, cobro_valor: cobro.valor, pago_modo: pago.modo, pago_valor: pago.valor,
    auto_desde: desde || null, auto_hasta: hasta || null, auto_dias: dias.length ? dias : null };
  const antes = id ? (await cargarVariantesFamilia(familiaId)).find(x=>x.id===id) : null;
  const { error } = id
    ? await sb.from('variantes_precio').update({ ...fila, updated_at: new Date().toISOString() }).eq('id', id)
    : await sb.from('variantes_precio').insert({ ...fila, activa: true, creado_por: registradoPorUsuario() || null });
  if(error){ warn.innerHTML = errBox(error); return; }
  cerrarModalVariantePrecio();
  toast(id ? 'Variante actualizada.' : 'Variante guardada.');
  await pintarVariantesEnFicha(familiaId);
  // Programada (o lo era): los previstos de ese fijo se recalculan ya, sin esperar a la noche.
  if(fila.auto_desde || antes?.auto_desde) await sincronizarPrevistosFijos();
}
async function eliminarVariantePrecio(familiaId, id){
  const v = (await cargarVariantesFamilia(familiaId)).find(x=>x.id===id);
  if(!v) return;
  if(!(await confirmarAccion(`¿Borrar la variante "${v.nombre}"? Los registros donde ya se usó la conservan.`, 'Borrar'))) return;
  const { error } = await sb.from('variantes_precio').delete().eq('id', id);
  if(error){ toast('No se pudo borrar: '+error.message, 'bad'); return; }
  toast('Variante borrada.');
  await pintarVariantesEnFicha(familiaId);
  if(v.auto_desde) await sincronizarPrevistosFijos();
}
// Cuando un fijo cambia "desde una fecha" (otra niñera u otro horario) se crea otro: sus
// variantes lo siguen. Sin la tabla, no hace nada.
async function moverVariantesAlFijoNuevo(viejoId, nuevoId){
  if(!variantesPrecioDisponible || !viejoId || !nuevoId) return;
  const { error } = await sb.from('variantes_precio').update({ asignacion_id: nuevoId, updated_at: new Date().toISOString() }).eq('asignacion_id', viejoId);
  if(error && !esFaltaTabla(error)) toast('El fijo cambió, pero sus variantes de precio quedaron en el anterior: revisalas en la ficha de la familia.', 'bad');
}
