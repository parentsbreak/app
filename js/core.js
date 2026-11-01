// SUPABASE_URL, SUPABASE_KEY, el escape, las fechas, toast, conGuardado y sbGuardar están en
// js/comun.js (26/10/2026), que se carga antes: los comparte la app de niñeras.
// Si supabase-js no cargó, sb queda en null y boot() muestra un error claro en vez de dejar la
// pantalla en blanco (antes: "supabase is not defined" y nada más).
const sb = (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function')
  ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage, experimental: { passkey: true } }
    })
  : null;

/* ---- Pantalla de carga y error de arranque (05/10/2026, E4) ----
   Mientras arranca, se busca la sesión o se entra, se ve el símbolo latiendo (el HTML
   inicial ya lo trae en index.html; desde el 15/10/2026 sin ruedita). Si algo sale mal antes de poder pintar la app, se
   explica qué pasó con un botón para reintentar, en vez de una pantalla en blanco. */
function mostrarPantallaCarga(mensaje='Cargando…'){
  const app = document.getElementById('app');
  if(!app) return;
  if(!document.getElementById('pantalla-carga')){
    app.innerHTML = `<div class="pantallacarga" id="pantalla-carga" role="status" aria-live="polite">
      <img src="logo-simbolo.png" alt="Parents’ Break" class="pantallacarga-simbolo simbolo-latido">
      <div class="pantallacarga-msg" id="pantallacarga-msg"></div>
    </div>`;
  }
  const msg = document.getElementById('pantallacarga-msg');
  if(msg) msg.textContent = mensaje;
  programarAvisoCargaLenta();
}
function mostrarErrorArranque(titulo, detalle){
  const app = document.getElementById('app');
  if(!app) return;
  app.innerHTML = `<div class="pantallacarga" id="pantalla-error" role="alert">
    <img src="logo.png" alt="Parents’ Break" class="pantallacarga-logo">
    <div class="pantallacarga-msg"><b>${escaparHtml(titulo)}</b>${escaparHtml(detalle)}</div>
    <button class="btn primary" onclick="location.reload()">Reintentar</button>
  </div>`;
}
/* Entre el login (o el arranque) y Hoy (15/10/2026): la app ya pintada queda tapada por la
   misma pantalla de carga hasta que la primera pantalla tiene sus datos, en vez de verse vacía.
   Va fuera de #app (con otro id) para no confundir a boot(), y se saca sola a los 10 s como
   máximo: nunca deja la app bloqueada. */
function cubrirHastaQueCargue(promesa){
  if(!promesa || typeof promesa.then!=='function') return;
  document.getElementById('pantalla-entrada')?.remove();
  const capa = document.createElement('div');
  capa.className = 'pantallacarga'; capa.id = 'pantalla-entrada';
  capa.setAttribute('role', 'status'); capa.setAttribute('aria-live', 'polite');
  capa.innerHTML = `<img src="logo-simbolo.png" alt="Parents’ Break" class="pantallacarga-simbolo simbolo-latido">
    <div class="pantallacarga-msg">Cargando…</div>`;
  document.body.appendChild(capa);
  let listo = false;
  const sacar = ()=>{ if(listo) return; listo = true; clearTimeout(tope); capa.remove(); };
  const tope = setTimeout(sacar, 10000);
  promesa.then(sacar, sacar);
}
/* Al cambiar de sección (15/10/2026): el símbolo chico latiendo en el centro del área de
   contenido, solo si la carga tarda más de 300 ms (si carga antes no se ve nada, sin
   parpadeos). La barra lateral no se toca. */
let cargaModuloSec = 0;
function indicarCargaModulo(promesa){
  const sec = ++cargaModuloSec;
  document.getElementById('carga-modulo')?.remove();
  if(!promesa || typeof promesa.then!=='function') return;
  let listo = false;
  const timer = setTimeout(()=>{
    const cont = document.getElementById('modcontent');
    if(listo || sec!==cargaModuloSec || !cont) return;
    const r = cont.getBoundingClientRect();
    const arriba = Math.max(r.top, 0), abajo = Math.min(r.bottom, window.innerHeight);
    const ind = document.createElement('div');
    ind.className = 'carga-modulo'; ind.id = 'carga-modulo';
    ind.setAttribute('role', 'status'); ind.setAttribute('aria-label', 'Cargando');
    ind.style.left = (r.left + r.width/2) + 'px';
    ind.style.top = (arriba + Math.max(abajo-arriba, 0)/2) + 'px';
    ind.innerHTML = '<img src="logo-simbolo.png" alt="" class="simbolo-latido">';
    document.body.appendChild(ind);
  }, 300);
  const fin = ()=>{ listo = true; clearTimeout(timer); if(sec===cargaModuloSec) document.getElementById('carga-modulo')?.remove(); };
  promesa.then(fin, fin);
}
// Si la carga tarda mucho (mala señal), se avisa debajo del logo sin cortar nada.
let avisoCargaLentaTimer = null;
function programarAvisoCargaLenta(){
  clearTimeout(avisoCargaLentaTimer);
  avisoCargaLentaTimer = setTimeout(()=>{
    const msg = document.getElementById('pantallacarga-msg');
    if(!msg || !document.getElementById('pantalla-carga')) return;
    msg.innerHTML = `${escaparHtml(msg.textContent)}<br>Está tardando más de lo normal. Si no avanza, revisá la conexión.`;
    if(!document.getElementById('pantallacarga-reintentar')){
      const b = document.createElement('button');
      b.id = 'pantallacarga-reintentar'; b.className = 'btn ghost'; b.textContent = 'Reintentar';
      b.addEventListener('click', ()=>location.reload());
      msg.after(b);
    }
  }, 12000);
}
programarAvisoCargaLenta();

/* ---- Carga de librerías pesadas SOLO cuando hacen falta (Chart.js y xlsx no bloquean el arranque de la app) ---- */
function cargarScript(src){
  return new Promise((resolve, reject) => {
    if(document.querySelector(`script[src="${src}"]`)){ resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('No se pudo cargar '+src)); }; // se saca para que un reintento lo vuelva a pedir de verdad
    document.head.appendChild(s);
  });
}
let _chartPromise = null;
function asegurarChart(){
  if(window.Chart) return Promise.resolve();
  if(!_chartPromise) _chartPromise = cargarScript('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js');
  return _chartPromise;
}
// jsPDF + autotable: solo se usan para exportar el historial de Sittings a PDF. Antes se
// cargaban en el <head> de index.html en cada apertura de la app (~127 KB comprimidos que
// bloqueaban el arranque); ahora se piden recién al abrir "Exportar a PDF". El plugin
// autotable necesita que jsPDF ya esté cargado, por eso van en orden.
let _jspdfPromise = null;
function asegurarJsPDF(){
  if(window.jspdf?.jsPDF?.API?.autoTable) return Promise.resolve();
  if(!_jspdfPromise){
    _jspdfPromise = cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      .then(()=>cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'))
      .catch(e=>{ _jspdfPromise = null; throw e; });
  }
  return _jspdfPromise;
}
let _xlsxPromise = null;
function asegurarXLSX(){
  if(window.XLSX) return Promise.resolve();
  if(!_xlsxPromise) _xlsxPromise = cargarScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  return _xlsxPromise;
}

function zonasDe(zonaStr){ return (zonaStr||'').split(/[/,]/).map(z=>z.trim()).filter(Boolean); }
/* ============================================================
   ZONAS (30/09/2026): todo el sistema trabaja por ZONA, no por barrio suelto.
   Cada fila de zona_grupos es una zona:
     - nombre: lo que se guarda en niñeras, familias, candidatas y solicitudes
       (nunca lleva "/" ni ",", que son los separadores de varias zonas).
     - zonas: los barrios que la forman (incluye el propio nombre). Solo sirve para
       traducir texto que llega suelto -- el formulario de postulantes, datos viejos --
       a la zona que corresponde. Ej. "Olivos" o "San Nicolás" -> "Carrasco".
     - fuera_de_montevideo: zonas donde se pide la temporada (Punta del Este).
   ============================================================ */
let zonaGruposCache = null;
async function cargarZonaGrupos(){
  const { data } = await sb.from('zona_grupos').select('*').order('orden');
  zonaGruposCache = data || [];
  return zonaGruposCache;
}
function listaZonas(){
  return (zonaGruposCache||[]).slice().sort((a,b)=>(a.orden??0)-(b.orden??0) || (a.nombre||'').localeCompare(b.nombre||''));
}
function claveZona(s){ return normaliza(s).trim().replace(/\s+/g,' '); }
// Zona (objeto) que corresponde a un texto: por nombre de zona o por uno de sus barrios.
function grupoDeZona(txt){
  if(!zonaGruposCache || !txt) return null;
  const k = claveZona(txt);
  if(!k) return null;
  return zonaGruposCache.find(g=>claveZona(g.nombre)===k)
      || zonaGruposCache.find(g=>(g.zonas||[]).some(z=>claveZona(z)===k)) || null;
}
// Para texto libre ("centro y pocitos", "de lunes a jueves en pocitos y los findes en punta
// del este"): todas las zonas cuyo nombre o algún barrio aparece como palabra completa.
function zonasMencionadasEnTexto(txt){
  const t = ' '+claveZona(txt).replace(/[^a-z0-9ñ]+/g,' ')+' ';
  return listaZonas().filter(g=>[g.nombre, ...(g.zonas||[])].some(b=>{
    const kb = claveZona(b).replace(/[^a-z0-9ñ]+/g,' ').trim();
    return kb && t.includes(' '+kb+' ');
  }));
}
// Texto de zonas guardado ("Olivos/San Nicolás/Pocitos") -> lista de zonas sin repetir, en el
// orden de las zonas ("Carrasco", "Pocitos y Punta Carretas"). Lo que no se puede ubicar en
// ninguna zona se conserva tal cual al final, para no perder el dato (aparece en el panel
// "Barrios sin zona" para asignarlo).
function zonasNormalizadas(zonaStr){
  if(!zonaGruposCache) return zonasDe(zonaStr);
  const conocidas = new Map(), desconocidas = new Map();
  zonasDe(zonaStr).forEach(p=>{
    const g = grupoDeZona(p);
    if(g){ conocidas.set(g.id, g); return; }
    const mencionadas = zonasMencionadasEnTexto(p);
    if(mencionadas.length){ mencionadas.forEach(x=>conocidas.set(x.id, x)); return; }
    const k = claveZona(p);
    if(k && !desconocidas.has(k)) desconocidas.set(k, p.trim());
  });
  const orden = listaZonas().map(g=>g.id);
  return [...[...conocidas.values()].sort((a,b)=>orden.indexOf(a.id)-orden.indexOf(b.id)).map(g=>g.nombre), ...desconocidas.values()];
}
function textoZonas(zonaStr){ return zonasNormalizadas(zonaStr).join('/'); }
// Barrio exacto que marcó (ninieras.barrios, candidatas.zona_barrios/zona_sitting_barrios):
// solo informativo, todo se busca por zona. Se agrupa por zona y se muestra únicamente para
// las zonas que tiene hoy ("Punta del Este (José Ignacio, La Barra) · Carrasco (Olivos)").
// El barrio que se llama igual que su zona no agrega nada y no se repite.
function barriosPorZona(zonaStr, barriosStr){
  const res = zonasNormalizadas(zonaStr).map(z=>({zona:z, barrios:[]}));
  zonasDe(barriosStr).forEach(b=>{
    const g = grupoDeZona(b);
    if(!g || claveZona(b)===claveZona(g.nombre)) return;
    const item = res.find(r=>claveZona(r.zona)===claveZona(g.nombre));
    if(item && !item.barrios.some(x=>claveZona(x)===claveZona(b))) item.barrios.push(b.trim());
  });
  return res;
}
function textoZonasConBarrios(zonaStr, barriosStr){
  return barriosPorZona(zonaStr, barriosStr).map(r=>r.barrios.length ? `${r.zona} (${r.barrios.join(', ')})` : r.zona).join(' · ');
}
// Une varios textos de barrios sin repetir (ej. dónde vive + dónde puede hacer sitting).
// Línea chica "Marcó: Carrasco (Olivos) · ..." para mostrar debajo de un selector de zonas.
// Vacía si no hay ningún barrio más específico que la zona.
function htmlBarriosMarcados(zonaStr, barriosStr, prefijo='Barrios que marcó'){
  const grupos = barriosPorZona(zonaStr, barriosStr).filter(r=>r.barrios.length);
  if(!grupos.length) return '';
  return `<div class="helper" style="margin:-6px 0 12px;">${prefijo}: ${grupos.map(r=>escaparHtml(`${r.zona} (${r.barrios.join(', ')})`)).join(' · ')}</div>`;
}
function unirBarrios(...textos){
  const m = new Map();
  textos.forEach(t=>zonasDe(t).forEach(b=>{ const k = claveZona(b); if(k && !m.has(k)) m.set(k, b.trim()); }));
  return [...m.values()].join('/') || null;
}
// ¿Comparten alguna zona?
function mismoGrupoZona(zonaA, zonaB){
  if(!zonaA || !zonaB) return false;
  const a = new Set(zonasNormalizadas(zonaA).map(claveZona));
  return zonasNormalizadas(zonaB).some(z=>a.has(claveZona(z)));
}
// Lista blanca vieja de zonas revisadas (tabla zonas_confirmadas). Ya no decide nada -- ahora
// lo que no pertenece a ninguna zona es lo que se muestra para revisar -- pero se sigue
// cargando para no romper a quien la llame.
let zonasConfirmadasCache = null;
async function cargarZonasConfirmadas(){
  const { data } = await sb.from('zonas_confirmadas').select('nombre');
  zonasConfirmadasCache = new Set((data||[]).map(z=>normaliza(z.nombre)));
  return zonasConfirmadasCache;
}
// Textos de zona que aparecen en niñeras o familias pero no pertenecen a ninguna zona.
function zonasNuevasSinConfirmar(){
  if(!zonaGruposCache) return [];
  return obtenerTodasLasZonas().filter(z=>!grupoDeZona(z));
}
// Vuelve a escribir la zona de todas las niñeras y familias que tengan este texto, ya
// traducido a zonas (después de haberlo sumado como barrio de una zona, o de crear la zona).
async function reescribirZonasConTexto(texto){
  const k = claveZona(texto);
  const tiene = x => zonasDe(x.zona).some(z=>claveZona(z)===k);
  const afectadasNin = (ninierasItems||[]).filter(tiene);
  const afectadasFam = (familiasItems||[]).filter(tiene);
  // Cuenta solo las que se guardaron de verdad y avisa si alguna falló (antes se ignoraba el
  // error y el aviso decía que se corrigieron todas).
  let corregidas = 0, fallidas = 0;
  for(const [tabla, filas] of [['ninieras', afectadasNin], ['familias', afectadasFam]]){
    for(const x of filas){
      const { error } = await sb.from(tabla).update({zona: textoZonas(x.zona)}).eq('id', x.id);
      if(error) fallidas++; else corregidas++;
    }
  }
  if(fallidas) toast(`No se pudo corregir la zona en ${fallidas} ficha${fallidas===1?'':'s'}. Reintentá en un momento.`, 'bad');
  return corregidas;
}
async function refrescarTrasCambioDeZonas(){
  if(typeof cargarNinieras==='function' && document.getElementById('ninierasgrid')) await cargarNinieras();
  if(typeof cargarFamilias==='function' && document.getElementById('familiaslist')) await cargarFamilias();
  renderZonasNuevasPanel();
}
async function accionAsignarBarrioAZona(barrio, selectId){
  const zonaId = document.getElementById(selectId)?.value;
  const g = (zonaGruposCache||[]).find(x=>x.id===zonaId);
  if(!g){ toast('Elegí a qué zona pertenece.', 'bad'); return; }
  const zonas = [...(g.zonas||[]), formatearNombreZona(barrio)];
  const { error } = await sb.from('zona_grupos').update({zonas}).eq('id', g.id);
  if(error){ toast('No se pudo guardar: '+error.message, 'bad'); return; }
  await cargarZonaGrupos();
  const n = await reescribirZonasConTexto(barrio);
  toast(`"${barrio}" ahora es parte de ${g.nombre}. Se corrigieron ${n} ficha${n===1?'':'s'}.`);
  await refrescarTrasCambioDeZonas();
}
async function accionCrearZonaConBarrio(barrio){
  const nombre = formatearNombreZona(barrio).replace(/[/,]/g,' ').replace(/\s+/g,' ').trim();
  if(!(await confirmarAccion(`¿Crear "${nombre}" como zona nueva? Va a aparecer como opción en todas partes.`, 'Crear zona'))) return;
  const { error } = await sb.from('zona_grupos').insert({nombre, zonas:[nombre], orden:(zonaGruposCache||[]).length+1, fuera_de_montevideo:false});
  if(error){ toast('No se pudo crear: '+error.message, 'bad'); return; }
  await cargarZonaGrupos();
  await reescribirZonasConTexto(barrio);
  toast(`Zona "${nombre}" creada.`);
  await refrescarTrasCambioDeZonas();
}
// Mini panel reusable (Niñeras o Familias): solo aparece si alguna ficha tiene un texto de
// zona que no pertenece a ninguna zona (ej. un barrio nuevo cargado a mano).
function renderZonasNuevasPanel(){
  const wrap = document.getElementById('nin-zonasnuevas-wrap') || document.getElementById('fam-zonasnuevas-wrap');
  if(!wrap) return;
  const nuevas = zonasNuevasSinConfirmar();
  if(!nuevas.length){ pintarSiCambio(wrap, ''); return; }
  pintarSiCambio(wrap, `<div class="card" style="padding:12px 18px;border-left:3px solid var(--warn);border-radius:0 12px 12px 0;margin-bottom:10px;">
    <div style="font-weight:600;margin-bottom:2px;">Barrios sin zona (${nuevas.length})</div>
    <div class="helper" style="margin:0 0 6px;">Aparecen en alguna ficha pero no pertenecen a ninguna zona. Elegí a qué zona van y se corrigen solas todas las fichas.</div>
    ${nuevas.map((z,i)=>`
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--line);">
        <b style="min-width:120px;">${escaparHtml(z)}</b>
        <select id="zn-sel-${i}" style="flex:1;min-width:140px;">
          <option value="">¿De qué zona es?</option>
          ${listaZonas().map(g=>`<option value="${escaparHtml(g.id)}">${escaparHtml(g.nombre)}</option>`).join('')}
        </select>
        <button class="smallbtn" onclick="conGuardado(this, ()=>accionAsignarBarrioAZona(${argJs(z)},'zn-sel-${i}'))">Asignar</button>
        <button class="smallbtn" onclick="conGuardado(this, ()=>accionCrearZonaConBarrio(${argJs(z)}))">Crear zona nueva</button>
      </div>`).join('')}
  </div>`);
}
/* Checklist de zonas compartido — reemplaza el texto libre de antes (donde
   escribir "Pocitos, Malvín" terminaba pisando otras zonas por error). Junta
   todas las zonas que ya existen entre niñeras y familias, con checkboxes
   para elegir varias, más un campo para agregar una zona nueva si no está. */
function obtenerTodasLasZonas(){
  const mapa = new Map();
  [...(ninierasItems||[]), ...(familiasItems||[])].forEach(x=>{
    zonasDe(x.zona).forEach(raw=>{
      const key = normaliza(raw);
      if(key && !mapa.has(key)) mapa.set(key, raw);
    });
  });
  return [...mapa.values()].sort((a,b)=>a.localeCompare(b));
}
const ICONO_LAPIZ = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
// Capitaliza cada palabra ("treinta y tres" -> "Treinta y Tres"), dejando en minúscula los
// conectores cortos salvo que sean la primera palabra.
function formatearNombreZona(s){
  const conectores = new Set(['y','de','del','la','las','los','en']);
  return (s||'').trim().split(/\s+/).map((w,i)=>{
    const wl = w.toLowerCase();
    if(i>0 && conectores.has(wl)) return wl;
    return wl.charAt(0).toUpperCase()+wl.slice(1);
  }).join(' ');
}
function filaZonaDeGrupo(z){
  return `<span class="zg-zona-chip" data-zona="${escaparHtml(z)}">${escaparHtml(z)} <button type="button" onclick="editarZonaChip(this)" title="Editar">${ICONO_LAPIZ}</button> <button type="button" onclick="this.closest('.zg-zona-chip').remove()" title="Quitar">✕</button></span>`;
}
function editarZonaChip(btn){
  const chip = btn.closest('.zg-zona-chip');
  const actual = chip.dataset.zona;
  chip.innerHTML = `<input type="text" class="zg-zona-edit-input" value="${escaparHtml(actual)}" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">`;
  const inp = chip.querySelector('input');
  inp.addEventListener('blur', ()=>confirmarEdicionZonaChip(inp));
  inp.focus();
  inp.select();
}
function confirmarEdicionZonaChip(inp){
  const chip = inp.closest('.zg-zona-chip');
  if(!chip) return;
  const val = formatearNombreZona(inp.value);
  if(!val){ chip.remove(); return; }
  chip.outerHTML = filaZonaDeGrupo(val);
}
function agregarZonaAEsteGrupo(btn){
  const row = btn.closest('.zonagrupo-row');
  const input = row.querySelector('.zg-zona-nueva');
  const val = formatearNombreZona(input.value);
  if(!val) return;
  const lista = row.querySelector('.zg-zonas-list');
  const vacio = lista.querySelector('.helper');
  if(vacio) vacio.remove();
  lista.insertAdjacentHTML('beforeend', filaZonaDeGrupo(val));
  input.value = '';
  input.focus();
}
function activarEdicionNombreGrupo(btn){
  const row = btn.closest('.zonagrupo-row');
  row.querySelector('.zg-nombre-display').style.display = 'none';
  btn.style.display = 'none';
  const inp = row.querySelector('.zg-nombre');
  inp.style.display = '';
  inp.focus();
  inp.select();
}
function confirmarNombreGrupo(inp){
  const row = inp.closest('.zonagrupo-row');
  const disp = row.querySelector('.zg-nombre-display');
  const btn = row.querySelector('.zg-nombre-editbtn');
  disp.textContent = inp.value.trim() || '(sin nombre)';
  disp.style.display = '';
  if(btn) btn.style.display = '';
  inp.style.display = 'none';
  refrescarSelectsDeGrupos();
}
function filaZonaGrupo(g){
  const nombre = g?.nombre || '';
  // El nombre de la zona ya cuenta como barrio propio: no se repite como chip.
  const zonas = (g?.zonas || []).filter(z=>claveZona(z)!==claveZona(nombre));
  const sinNombreAun = !nombre; // grupo recién creado, todavía sin nombre -> arranca en modo edición ya visible, no escondido detrás del lápiz
  return `
    <div class="zonagrupo-row" data-id="${g?.id||''}">
      <div class="zg-nombre-row">
        <span class="zg-nombre-display" style="${sinNombreAun?'display:none;':''}">${escaparHtml(nombre)}</span>
        <button type="button" class="iconbtn zg-nombre-editbtn" onclick="activarEdicionNombreGrupo(this)" title="Editar nombre" style="${sinNombreAun?'display:none;':''}">${ICONO_LAPIZ}</button>
        <input type="text" class="zg-nombre" value="${escaparHtml(nombre)}" placeholder="Nombre de la zona" style="${sinNombreAun?'':'display:none;'}" oninput="refrescarSelectsDeGrupos()" onkeydown="if(event.key==='Enter'){event.preventDefault();confirmarNombreGrupo(this);}" onblur="confirmarNombreGrupo(this)">
      </div>
      <div class="zg-zonas-list">${zonas.map(filaZonaDeGrupo).join('') || '<span class="helper" style="margin:0;">Sin otros barrios.</span>'}</div>
      <label class="chk" style="margin:6px 0;white-space:normal;"><input type="checkbox" class="zg-fuera" ${g?.fuera_de_montevideo?'checked':''}> Fuera de Montevideo y Canelones (se pide la temporada: en qué quincenas del año está cada niñera)</label>
      <div class="zg-agregar-zona">
        <input type="text" class="zg-zona-nueva" placeholder="Agregar barrio a esta zona…" onkeydown="if(event.key==='Enter'){event.preventDefault();agregarZonaAEsteGrupo(this.nextElementSibling);}">
        <button type="button" class="smallbtn" onclick="agregarZonaAEsteGrupo(this)">+ Agregar</button>
      </div>
      <button type="button" class="smallbtn danger" onclick="this.closest('.zonagrupo-row').remove();refrescarSelectsDeGrupos();">Eliminar zona</button>
    </div>`;
}
function agregarFilaZonaGrupo(){
  document.getElementById('zonagrupos-list')?.insertAdjacentHTML('beforeend', filaZonaGrupo(null));
}
function refrescarSelectsDeGrupos(){
  // Los desplegables de "zonas sin grupo" tienen que reflejar los grupos tal como están AHORA
  // en el modal (incluidos los recién creados o renombrados, todavía sin guardar) — antes
  // quedaban congelados con la lista de cuando se abrió el modal.
  const nombres = [...document.querySelectorAll('.zonagrupo-row .zg-nombre')].map(inp=>inp.value.trim()).filter(Boolean);
  const opciones = nombres.map(n=>`<option value="${escaparHtml(n)}">${escaparHtml(n)}</option>`).join('');
  document.querySelectorAll('.zsg-grupo-select').forEach(sel=>{
    const actual = sel.value;
    sel.innerHTML = opciones;
    if(nombres.includes(actual)) sel.value = actual;
  });
}
const RENDERIZADORES_ZONA_POR_PREFIX = {}; // idPrefix -> función que vuelve a pintar ese checklist puntual
function registrarRenderizadorZona(idPrefix, fn){ RENDERIZADORES_ZONA_POR_PREFIX[idPrefix] = fn; }
let zonaGruposCallback = null;
function abrirModalGruposZona(idPrefixOrigen){
  // idPrefixOrigen identifica qué checklist llamó a esto -- así, al guardar, se vuelve a
  // pintar ESE checklist con los grupos nuevos. Antes se guardaba bien pero la pantalla de
  // atrás se quedaba con los datos viejos hasta salir y volver a entrar.
  zonaGruposCallback = idPrefixOrigen ? RENDERIZADORES_ZONA_POR_PREFIX[idPrefixOrigen] : null;
  const grupos = zonaGruposCache || [];
  const zonasAgrupadas = new Set();
  grupos.forEach(g=>(g.zonas||[]).forEach(z=>zonasAgrupadas.add(normaliza(z))));
  const sinGrupo = obtenerTodasLasZonas().filter(z=>!zonasAgrupadas.has(normaliza(z)) && !grupoDeZona(z));
  const opcionesGrupos = grupos.map(g=>`<option value="${escaparHtml(g.nombre)}">${escaparHtml(g.nombre)}</option>`).join('');
  const filaSinGrupo = (z) => `
    <div class="zonasingrupo-row">
      <span class="zsg-nombre">${escaparHtml(z)}</span>
      ${grupos.length ? `<select class="zsg-grupo-select">${opcionesGrupos}</select><button type="button" class="smallbtn" onclick="agregarZonaAGrupoExistente(${argJs(z)}, this)">Sumar a esa zona</button>` : ''}
      <button type="button" class="smallbtn" onclick="crearGrupoConZona(${argJs(z)}, this)">Crear zona nueva</button>
    </div>`;
  const html = `
    <h2>Zonas</h2>
    <div class="helper">Todo el sistema trabaja por zona: en las fichas, los filtros y las sugerencias de Agenda. Los barrios de cada zona sirven para que lo que llega escrito como barrio (el formulario de postulantes, por ejemplo) caiga solo en su zona. El nombre de la zona no puede llevar "/" ni ",".</div>
    ${sinGrupo.length ? `
    <div class="card" style="margin:12px 0;padding:12px;background:var(--bg);">
      <div class="helper" style="margin-bottom:6px;"><b>Barrios sin zona</b>: sumalos a una zona existente o creá una zona nueva:</div>
      <div id="zonassingrupo-list">${sinGrupo.map(filaSinGrupo).join('')}</div>
    </div>` : ''}
    <div id="zonagrupos-list" style="margin-top:10px;">${listaZonas().map(filaZonaGrupo).join('') || '<div class="empty">Todavía no hay zonas.</div>'}</div>
    <button type="button" class="smallbtn" onclick="agregarFilaZonaGrupo()" style="margin-bottom:10px;">+ Agregar zona</button>
    <div id="zonagrupos-warn"></div>
    <button class="btn primary" style="width:100%;" onclick="conGuardado(this, ()=>guardarGruposZona())">Guardar</button>
  `;
  abrirModal(html);
}
function agregarZonaAGrupoExistente(zona, btn){
  const row = btn.closest('.zonasingrupo-row');
  const nombreGrupo = row.querySelector('.zsg-grupo-select')?.value;
  const filaGrupo = [...document.querySelectorAll('.zonagrupo-row')].find(r=>r.querySelector('.zg-nombre').value.trim()===nombreGrupo);
  if(!filaGrupo) return;
  const lista = filaGrupo.querySelector('.zg-zonas-list');
  const yaEsta = [...lista.querySelectorAll('.zg-zona-chip')].some(chip=>normaliza(chip.dataset.zona)===normaliza(zona));
  if(!yaEsta){
    const vacio = lista.querySelector('.helper');
    if(vacio) vacio.remove();
    lista.insertAdjacentHTML('beforeend', filaZonaDeGrupo(formatearNombreZona(zona)));
  }
  row.remove();
}
function crearGrupoConZona(zona, btn){
  const nombreZona = formatearNombreZona(zona);
  document.getElementById('zonagrupos-list')?.insertAdjacentHTML('beforeend', filaZonaGrupo({nombre:nombreZona, zonas:[nombreZona]}));
  btn.closest('.zonasingrupo-row')?.remove();
  refrescarSelectsDeGrupos();
}
async function guardarGruposZona(){
  const warn = document.getElementById('zonagrupos-warn');
  warn.innerHTML = '';
  const filas = [...document.querySelectorAll('.zonagrupo-row')];
  const leidas = filas.map(fila=>({
    fila,
    id: fila.dataset.id || null,
    nombre: fila.querySelector('.zg-nombre').value.replace(/\s+/g,' ').trim(),
    barrios: [...fila.querySelectorAll('.zg-zona-chip')].map(chip=>chip.dataset.zona).filter(Boolean),
    fuera_de_montevideo: !!fila.querySelector('.zg-fuera')?.checked,
  })).filter(z=>z.nombre || z.barrios.length); // fila totalmente vacía: se ignora
  const mal = (fila, msg) => { warn.innerHTML = `<div class="warnbox">${escaparHtml(msg)}</div>`; fila.scrollIntoView({behavior:'smooth', block:'center'}); };
  const sinNombre = leidas.find(z=>!z.nombre);
  if(sinNombre) return mal(sinNombre.fila, 'Hay una zona sin nombre. Poneselo o eliminala con "Eliminar zona" antes de guardar.');
  const conSeparador = leidas.find(z=>/[/,]/.test(z.nombre));
  if(conSeparador) return mal(conSeparador.fila, `El nombre "${conSeparador.nombre}" lleva "/" o ",". Usá "y" en su lugar (ej. "Pocitos y Punta Carretas").`);
  const vistos = new Map();
  for(const z of leidas){
    const k = claveZona(z.nombre);
    if(vistos.has(k)) return mal(z.fila, `Hay dos zonas que se llaman "${z.nombre}".`);
    vistos.set(k, z);
  }
  // Un mismo barrio no puede estar en dos zonas (no sabríamos a cuál mandarlo).
  const barrioEn = new Map();
  for(const z of leidas){
    for(const b of [z.nombre, ...z.barrios]){
      const k = claveZona(b);
      if(barrioEn.has(k) && barrioEn.get(k)!==z) return mal(z.fila, `"${b}" está en dos zonas: ${barrioEn.get(k).nombre} y ${z.nombre}. Dejalo en una sola.`);
      barrioEn.set(k, z);
    }
  }
  const anteriores = new Map((zonaGruposCache||[]).map(g=>[g.id, g]));
  const renombres = []; // [{viejo, nuevo}]
  const idsVistos = [];
  for(const [i, z] of leidas.entries()){
    const previa = z.id ? anteriores.get(z.id) : null;
    const renombrada = previa && claveZona(previa.nombre)!==claveZona(z.nombre);
    if(renombrada) renombres.push({viejo: previa.nombre, nuevo: z.nombre});
    // Barrios guardados: el nombre primero, los barrios, y si se renombró, el nombre viejo
    // también (así lo que llegue escrito con el nombre anterior sigue cayendo acá).
    const zonas = [];
    [z.nombre, ...z.barrios, ...(renombrada ? [previa.nombre] : [])].forEach(b=>{ if(!zonas.some(x=>claveZona(x)===claveZona(b))) zonas.push(b); });
    const fila = {nombre: z.nombre, zonas, fuera_de_montevideo: z.fuera_de_montevideo, orden: i+1};
    if(z.id){
      const { error } = await sb.from('zona_grupos').update(fila).eq('id', z.id);
      if(error){ warn.innerHTML = errBox(error); return; }
      idsVistos.push(z.id);
    } else {
      const { data, error } = await sb.from('zona_grupos').insert(fila).select().single();
      if(error){ warn.innerHTML = errBox(error); return; }
      idsVistos.push(data.id);
    }
  }
  // Zonas que estaban antes y ya no aparecen (se borraron con "Eliminar zona"). Las fichas
  // que la tenían conservan el texto y aparecen en "Barrios sin zona" para reasignarlas.
  const aBorrar = [...anteriores.keys()].filter(id=>!idsVistos.includes(id));
  for(const id of aBorrar){
    const { error } = await sb.from('zona_grupos').delete().eq('id', id);
    if(error){ warn.innerHTML = errBox(error); await cargarZonaGrupos(); return; }
  }
  await cargarZonaGrupos();
  // Zona renombrada: se cambia el nombre en todas las fichas que la tenían guardada.
  let corregidas = 0;
  for(const r of renombres) corregidas += await renombrarZonaEnFichas(r.viejo, r.nuevo);
  cerrarModal();
  toast(renombres.length ? `Zonas guardadas. Se actualizó el nombre en ${corregidas} ficha${corregidas===1?'':'s'}.` : 'Zonas guardadas.');
  if(typeof zonaGruposCallback === 'function'){ zonaGruposCallback(); zonaGruposCallback = null; }
  await refrescarTrasCambioDeZonas();
  // Si se marcó o desmarcó una zona como "fuera de Montevideo", el panel de temporadas y
  // los badges de la lista de niñeras dependen de eso -- se repintan al toque.
  if(document.getElementById('nin-temporadas-wrap') && typeof renderTemporadasPanel==='function'){ renderTemporadasPanel(); filtrarNinieras(); }
}
// Reemplaza el nombre viejo de una zona por el nuevo en todas las tablas que guardan zonas.
async function renombrarZonaEnFichas(viejo, nuevo){
  const kv = claveZona(viejo);
  const cambiar = txt => zonasDe(txt).some(z=>claveZona(z)===kv) ? textoZonas(zonasDe(txt).map(z=>claveZona(z)===kv ? nuevo : z).join('/')) : null;
  const objetivos = [['ninieras','zona'],['familias','zona'],['solicitudes','zona'],['candidatas','zona'],['candidatas','zona_sitting']];
  let total = 0, fallidas = 0;
  for(const [tabla, col] of objetivos){
    const { data, error: eLeer } = await sb.from(tabla).select(`id,${col}`).ilike(col, `%${viejo.replace(/[%_]/g,'')}%`);
    if(eLeer){ fallidas++; continue; }
    for(const r of (data||[])){
      const nuevoTxt = cambiar(r[col]);
      if(nuevoTxt===null || nuevoTxt===r[col]) continue;
      const { error } = await sb.from(tabla).update({[col]: nuevoTxt}).eq('id', r.id);
      if(error) fallidas++; else total++;
    }
  }
  if(fallidas) toast(`No se pudo cambiar el nombre de la zona en algunas fichas (${fallidas}). Volvé a guardar las zonas.`, 'bad');
  return total;
}
/* ============================================================
   Hijos de una familia (tabla hijos_familia): antes "Niños (edades)" era un
   solo texto libre que quedaba viejo apenas cumplían años. Ahora cada hijo
   es su propia fila, con fecha de nacimiento real (la edad se calcula sola,
   mismo criterio que en niñeras) y colegio.
   ============================================================ */
function filaHijoFamilia(hijo, abierta){
  const h = hijo || {};
  const q = escaparHtml;
  const edadActual = edadHijo(h);
  const faltaInfo = edadActual===null || !h.colegio;
  const resumen = resumenUnHijo(h);
  return `<div class="hijofamilia-row" style="border:1px solid var(--line);border-radius:8px;margin-bottom:8px;overflow:hidden;" data-edad-declarada="${h.edad_declarada??''}" data-edad-declarada-en="${h.edad_declarada_en||''}">
    <div class="hijofamilia-summary" onclick="toggleHijoFamiliaRow(this)" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;cursor:pointer;${faltaInfo?'color:var(--warn);':''}">
      <span class="hf-summary-text" style="font-weight:600;">${escaparHtml(resumen)}${faltaInfo?' — Falta info':''}</span>
      <span class="hf-summary-arrow">${abierta?'▴':'▾'}</span>
    </div>
    <div class="hijofamilia-detail" style="display:${abierta?'block':'none'};padding:0 12px 12px;">
      <div class="grid3" style="margin-bottom:0;">
        <div class="field" style="margin-bottom:0;"><label>Nombre</label><input type="text" class="hf-nombre" value="${q(h.nombre)}" placeholder="opcional" oninput="actualizarResumenHijoFamilia(this)"></div>
        <div class="field" style="margin-bottom:0;"><label>Fecha de nacimiento</label><input type="date" class="hf-fecha-nac" value="${h.fecha_nacimiento||''}" onchange="this.closest('.hijofamilia-row').querySelector('.hf-edad-declarada').disabled = !!this.value; actualizarResumenHijoFamilia(this);"></div>
        <div class="field" style="margin-bottom:0;"><label>Colegio</label><input type="text" class="hf-colegio" value="${q(h.colegio)}" oninput="actualizarResumenHijoFamilia(this)"></div>
      </div>
      <div class="field" style="margin:6px 0 0;">
        <label>O, si no sabés la fecha exacta: edad ahora mismo${edadActual!==null && !h.fecha_nacimiento ? ` <span class="helper" style="margin:0;">(hoy: ${edadActual} años)</span>` : ''}</label>
        <input type="number" class="hf-edad-declarada" placeholder="${edadActual!==null && !h.fecha_nacimiento ? 'Cambiar edad a…' : 'Ej: 5'}" min="0" max="30" ${h.fecha_nacimiento ? 'disabled' : ''} onchange="actualizarResumenHijoFamilia(this)">
        <div class="helper" style="margin:2px 0 0;">Dejalo vacío para no tocarla. Si escribís un número, queda esa edad a partir de hoy y suma un año sola cada 12 meses — como si fuese un reloj.</div>
      </div>
      <button type="button" class="smallbtn danger" style="margin-top:6px;" onclick="confirmarQuitarHijoFamilia(this)">Quitar</button>
    </div>
  </div>`;
}
// Texto compacto de la fila cerrada: nombre (o "Hijo N"), y lo que ya se sabe.
function resumenUnHijo(h, posicion){
  const nombre = h.nombre || `Hijo ${posicion||''}`.trim();
  const edad = edadHijo(h);
  const partes = [edad!==null ? `${edad} años` : null, h.colegio || null].filter(Boolean);
  return partes.length ? `${nombre} — ${partes.join(' · ')}` : nombre;
}
function actualizarResumenHijoFamilia(inputEl){
  const row = inputEl.closest('.hijofamilia-row');
  const h = {
    nombre: row.querySelector('.hf-nombre').value.trim(),
    colegio: row.querySelector('.hf-colegio').value.trim(),
    fecha_nacimiento: row.querySelector('.hf-fecha-nac').value || null,
    edad_declarada: row.querySelector('.hf-edad-declarada').value || row.dataset.edadDeclarada || null,
    edad_declarada_en: row.dataset.edadDeclaradaEn || todayISO(),
  };
  const faltaInfo = edadHijo(h)===null || !h.colegio;
  const span = row.querySelector('.hf-summary-text');
  const idx = [...row.parentElement.children].indexOf(row) + 1;
  span.textContent = resumenUnHijo(h, idx) + (faltaInfo ? ' — Falta info' : '');
  row.querySelector('.hijofamilia-summary').style.color = faltaInfo ? 'var(--warn)' : '';
}
function toggleHijoFamiliaRow(summaryEl){
  const detail = summaryEl.nextElementSibling;
  const abrir = detail.style.display==='none';
  detail.style.display = abrir ? 'block' : 'none';
  summaryEl.querySelector('.hf-summary-arrow').textContent = abrir ? '▴' : '▾';
}
function confirmarQuitarHijoFamilia(btn){
  const row = btn.closest('.hijofamilia-row');
  const nombre = row.querySelector('.hf-summary-text').textContent;
  confirmarAccion(`¿Quitar a ${nombre}? Se va a borrar al guardar.`, 'Quitar').then(ok=>{ if(ok) row.remove(); });
}
function htmlHijosFamilia(prefix, hijos){
  const lista = hijos && hijos.length ? hijos : [];
  return `<div class="field">
    <label>Hijos</label>
    <div id="${prefix}-hijos-list">${lista.map(h=>filaHijoFamilia(h, false)).join('')}</div>
    <button class="smallbtn" type="button" onclick="agregarFilaHijoFamilia(${argJs(prefix)})" style="margin-top:6px;">+ Agregar hijo</button>
  </div>`;
}
function agregarFilaHijoFamilia(prefix){
  document.getElementById(prefix+'-hijos-list').insertAdjacentHTML('beforeend', filaHijoFamilia(null, true));
}
function leerHijosFamilia(prefix){
  return [...document.querySelectorAll(`#${prefix}-hijos-list .hijofamilia-row`)].map(row=>{
    const fechaNac = row.querySelector('.hf-fecha-nac').value || null;
    const edadInput = row.querySelector('.hf-edad-declarada').value;
    let edad_declarada = row.dataset.edadDeclarada ? Number(row.dataset.edadDeclarada) : null;
    let edad_declarada_en = row.dataset.edadDeclaradaEn || null;
    if(fechaNac){
      // hay fecha real: la edad declarada ya no hace falta, se limpia para que no quede
      // dando vueltas una edad vieja de respaldo.
      edad_declarada = null; edad_declarada_en = null;
    } else if(edadInput !== ''){
      // escribieron un número nuevo: el reloj arranca de nuevo hoy.
      edad_declarada = Number(edadInput);
      edad_declarada_en = todayISO();
    }
    return {
      nombre: row.querySelector('.hf-nombre').value.trim() || null,
      fecha_nacimiento: fechaNac,
      colegio: row.querySelector('.hf-colegio').value.trim() || null,
      edad_declarada, edad_declarada_en,
    };
  }).filter(h=>h.nombre || h.fecha_nacimiento || h.colegio || h.edad_declarada!=null);
}
// Para mostrar en una ficha (view-only): "Nombre (edad) · Colegio", uno por línea.
function textoHijosFamilia(hijos){
  if(!hijos || !hijos.length) return null;
  return hijos.map(h=>{
    const edad = edadHijo(h);
    const partes = [h.nombre || 'Hijo/a', edad!==null ? `${edad} años` : null, h.colegio || null].filter(Boolean);
    return escaparHtml(partes.join(' · '));
  }).join('<br>'); // devuelve HTML (cada hijo escapado, uno por renglón)
}
// Versión compacta en una sola línea, para la lista (ej. "Juan (5 años), Ana (8 años)").
function resumenHijosFamilia(hijos){
  if(!hijos || !hijos.length) return null;
  return hijos.map(h=>{
    const edad = edadHijo(h);
    return edad!==null ? `${h.nombre||'Hijo/a'} (${edad} años)` : (h.nombre||'Hijo/a');
  }).join(', ');
}
/* Selector de zonas compartido (niñeras, familias, postulantes, Agenda): una casilla por
   zona, se pueden marcar varias. Lo que llega escrito como barrio ("Olivos") ya aparece
   marcado en su zona ("Carrasco"). Si algún texto viejo no pertenece a ninguna zona, se
   muestra marcado aparte (con borde punteado) para no perderlo al guardar. */
function checklistZonas(idPrefix, zonaActual, labelTexto='Zonas'){
  if(!zonaGruposCache){
    // Primera vez en la sesión: se piden las zonas y se vuelve a pintar este mismo bloque.
    // Mientras tanto se guarda el valor original, así un "Guardar" apurado no lo borra.
    cargarZonaGrupos().then(()=>{
      const el = document.getElementById(idPrefix+'-zonas-field');
      if(el) el.outerHTML = checklistZonas(idPrefix, zonaActual, labelTexto);
    });
    return `<div class="field" id="${idPrefix}-zonas-field"><label>${labelTexto}</label>
      <div class="helper" style="margin:0;">Cargando zonas…</div>
      <input type="hidden" id="${idPrefix}-zonas-orig" value="${escaparHtml(zonaActual)}"></div>`;
  }
  const actuales = zonasNormalizadas(zonaActual);
  const marcadas = new Set(actuales.map(claveZona));
  const sueltas = actuales.filter(z=>!grupoDeZona(z));
  const chip = (valor, texto, extraClase='', titulo='') => `<label class="zona-chip ${extraClase}"${titulo?` title="${escaparHtml(titulo)}"`:''}><input type="checkbox" value="${escaparHtml(valor)}" ${marcadas.has(claveZona(valor))?'checked':''}> ${texto}</label>`;
  const zonas = listaZonas();
  const detalle = zonas.map(g=>{
    const barrios = (g.zonas||[]).filter(z=>claveZona(z)!==claveZona(g.nombre));
    return `<div><b>${escaparHtml(g.nombre)}</b>${barrios.length?escaparHtml(': '+barrios.join(', ')):''}</div>`;
  }).join('');
  return `
    <div class="field" id="${idPrefix}-zonas-field"><label>${labelTexto} <a href="#" onclick="event.preventDefault();alternarTodasZonasChecklist(${argJs(idPrefix)})" style="font-weight:400;font-size:11.5px;">todas / ninguna</a></label>
      <div id="${idPrefix}-zonas-checklist" class="zona-chips">
        ${zonas.map(g=>chip(g.nombre, escaparHtml(g.nombre), '', (g.zonas||[]).join(', '))).join('')}
        ${sueltas.map(z=>chip(z, `${escaparHtml(z)} <span class="zona-chip-nota">sin zona</span>`, 'suelta')).join('')}
      </div>
      ${sueltas.length ? `<div class="helper" style="margin:4px 0 0;color:var(--warn);">"${escaparHtml(sueltas.join('", "'))}" no pertenece a ninguna zona. Asignalo en <a href="#" onclick="abrirModalGruposZona(${argJs(idPrefix)});return false;">Editar zonas</a>.</div>` : ''}
      <details class="zona-detalle"><summary>Qué barrios tiene cada zona</summary>${detalle}<div style="margin-top:4px;"><a href="#" onclick="abrirModalGruposZona(${argJs(idPrefix)});return false;">Editar zonas</a></div></details>
    </div>`;
}
// Vuelve a pintar un selector ya puesto en pantalla con otro valor (ej. al cargar una ficha).
function setZonasChecklist(idPrefix, zonaStr, labelTexto){
  const el = document.getElementById(idPrefix+'-zonas-field');
  if(el) el.outerHTML = checklistZonas(idPrefix, zonaStr, labelTexto || el.querySelector('label')?.childNodes[0]?.textContent?.trim() || 'Zonas');
}
function alternarTodasZonasChecklist(idPrefix){
  const cont = document.getElementById(idPrefix+'-zonas-checklist');
  if(!cont) return;
  const boxes = [...cont.querySelectorAll('input[type=checkbox]')];
  const todasMarcadas = boxes.length>0 && boxes.every(b=>b.checked);
  boxes.forEach(b=>{ b.checked = !todasMarcadas; });
}
function leerZonasChecklist(idPrefix){
  const cont = document.getElementById(idPrefix+'-zonas-checklist');
  if(!cont){
    // Todavía cargando las zonas: se devuelve lo que tenía, sin tocarlo.
    const orig = document.getElementById(idPrefix+'-zonas-orig');
    return orig ? orig.value : '';
  }
  return textoZonas([...cont.querySelectorAll('input[type=checkbox]:checked')].map(chk=>chk.value).join('/'));
}
/* Filtro de zonas (Niñeras, Familias): mismas casillas, varias a la vez. `seleccion` es un
   Set con claveZona() de las zonas marcadas; onToggle es el nombre de la función global que
   se llama con (clave, marcada). */
function htmlFiltroZonas(seleccion, onToggle){
  if(!zonaGruposCache) return '<span class="helper" style="margin:0;">Cargando zonas…</span>';
  return `<div class="zona-chips">${listaZonas().map(g=>{
    const k = claveZona(g.nombre);
    return `<label class="zona-chip" title="${escaparHtml((g.zonas||[]).join(', '))}"><input type="checkbox" ${seleccion.has(k)?'checked':''} onchange="${onToggle}(${argJs(k)}, this.checked)"> ${escaparHtml(g.nombre)}</label>`;
  }).join('')}${seleccion.size?`<button type="button" class="smallbtn" onclick="${onToggle}(null, false)">Limpiar</button>`:''}</div>`;
}
function coincideFiltroZonas(zonaStr, seleccion){
  if(!seleccion.size) return true;
  return zonasNormalizadas(zonaStr).some(z=>seleccion.has(claveZona(z)));
}
function nombresZonasFiltro(seleccion){
  return listaZonas().filter(g=>seleccion.has(claveZona(g.nombre))).map(g=>g.nombre);
}
function scrollToDetalle(id){
  const el = document.getElementById(id);
  if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
}
/* Encabezado de tarjeta con flechita para minimizar/expandir el bloque entero. Se usa en
   Entrevista (Ficha del formulario y cada bloque de preguntas) — el contenido va adentro de
   un .card-body, y toggleCardCollapse esconde/muestra ese body nada más. */
function cardHeaderConColapso(titulo){
  return `<div style="display:flex;justify-content:space-between;align-items:center;">
    <h2 style="margin:0;">${titulo}</h2>
    <button type="button" class="card-collapse-btn" onclick="toggleCardCollapse(this)" aria-label="Minimizar/expandir">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
    </button>
  </div>`;
}
function toggleCardCollapse(btn){
  btn.closest('.card-collapsible')?.classList.toggle('collapsed');
}

/* Al editar/eliminar algo de una lista larga (niñeras, familias), recargar la
   lista reemplaza todo su HTML y el navegador vuelve el scroll arriba del
   todo — muy molesto si estás revisando la lista una por una. Estas dos
   funciones guardan la posición antes de recargar y la restauran después. */
function guardarScrollMainarea(){
  return document.querySelector('.mainarea')?.scrollTop ?? 0;
}
function restaurarScrollMainarea(valor){
  requestAnimationFrame(()=>{
    const el = document.querySelector('.mainarea');
    if(el) el.scrollTop = valor;
  });
}
/* Pinta un bloque solo si su HTML cambió (27/10/2026, parpadeo en Niñeras). Cada
   `wrap.innerHTML = ...` vuelve a crear la tarjeta con su fundido de entrada (.card tiene
   animation fadeIn): los paneles de Niñeras se repintaban en cada recarga aunque no hubiera
   cambiado nada y se veían prender y apagar. El último HTML pintado se guarda en el nodo (no se
   compara con innerHTML, que el navegador normaliza al serializar). Devuelve true si pintó. */
function pintarSiCambio(wrap, html){
  if(wrap._htmlPintado === html) return false;
  wrap.innerHTML = html;
  wrap._htmlPintado = html;
  return true;
}

/* ============================================================
   Lista de cuentas bancarias (columna cuenta_bancaria: text[]).
   Cada cuenta se guarda como UN string ("Itaú 1234567 (Sucursal Pocitos)") para no
   migrar la columna, pero se edita con campos separados: banco / número / sucursal.

   Una fila por cuenta, y el estado vive en el propio DOM (no en un mapa aparte).
   Reemplaza la versión anterior que guardaba un mapa banco -> cuenta, que tenía
   estos problemas (confirmados con datos reales de la base):
   - Sin cuentas, el número quedaba deshabilitado: no se podía tipear nada sin
     antes tocar "+ Agregar otro banco".
   - Dos cuentas del mismo banco (dos Itaú) se pisaban: al guardar CUALQUIER
     cambio de la ficha se borraba una en silencio.
   - Una cuenta guardada sin banco ("1234567") se duplicaba al guardar
     ("1234567 1234567").
   - No había forma de cambiar el banco de una cuenta ya cargada.
   - Un banco "Otro" solo se agregaba apretando Enter.
   ============================================================ */
const BANCOS_CUENTA = ['Itaú','BROU','Santander','Scotiabank','Prex','BBVA','Mercado Pago','HSBC'];
function normBancoCuenta(b){
  return String(b||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}
// Separa el string guardado en banco / número / sucursal. Tolera los formatos viejos que
// hay en la base: "Santander - 123", "Santander- 123", "Itau 123" (sin tilde), solo el
// número sin banco, o texto extra después del número ("... (a nombre de ...)").
function parsearCuentaBancaria(valor){
  const v = String(valor||'').trim();
  if(!v) return {banco:'', numero:'', sucursal:''};
  const mSuc = v.match(/^(.*?)\s*\(Sucursal\s+(.+)\)\s*$/i);
  const resto = mSuc ? mSuc[1].trim() : v;
  const sucursal = mSuc ? mSuc[2].trim() : '';
  const m = resto.match(/^([^\d]*?)[\s\-–:]*(\d[\s\S]*)$/);
  // Sin ningún dígito: se deja todo como número para no perder el dato.
  if(!m) return {banco:'', numero:resto, sucursal};
  let banco = m[1].replace(/[\s\-–:]+$/,'').trim();
  const conocido = BANCOS_CUENTA.find(b=>normBancoCuenta(b)===normBancoCuenta(banco));
  if(conocido) banco = conocido;
  // Si lo que viene antes del número no parece un nombre de banco (solo letras y espacios),
  // no se parte: se deja el texto entero como número para no alterarlo al guardar.
  else if(banco && !/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .]*$/.test(banco)) return {banco:'', numero:resto, sucursal};
  return {banco, numero:m[2].trim(), sucursal};
}
function htmlFilaCuentaBancaria(cuenta){
  const {banco, numero, sucursal} = parsearCuentaBancaria(cuenta);
  const q = escaparHtml;
  const esOtro = !!banco && !BANCOS_CUENTA.includes(banco);
  return `<div class="cb-fila" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;">
      <select class="cb-banco" onchange="cambioBancoFilaCuenta(this)" style="flex:1 1 110px;min-width:0;">
        <option value="" ${!banco?'selected':''}>Banco...</option>
        ${BANCOS_CUENTA.map(b=>`<option value="${b}" ${b===banco?'selected':''}>${b}</option>`).join('')}
        <option value="__otro__" ${esOtro?'selected':''}>Otro</option>
      </select>
      <input type="text" class="cb-otro" placeholder="Nombre del banco" value="${esOtro?q(banco):''}" style="flex:1 1 110px;min-width:0;${esOtro?'':'display:none;'}">
      <input type="text" class="cb-numero" placeholder="Número de cuenta" value="${q(numero)}" style="flex:1.4 1 130px;min-width:0;">
      <input type="text" class="cb-sucursal" placeholder="Sucursal (opcional)" value="${q(sucursal)}" style="flex:1 1 120px;min-width:0;">
      <button class="smallbtn danger" type="button" style="flex:0 0 auto;" onclick="quitarFilaCuentaBancaria(this)">Quitar</button>
    </div>`;
}
function htmlCuentasBancarias(prefix, cuentas){
  const lista = Array.isArray(cuentas) ? cuentas.filter(Boolean) : (cuentas ? [cuentas] : []);
  // Sin cuentas: una fila vacía lista para tipear (no hace falta apretar nada antes).
  const filas = (lista.length ? lista : ['']).map(htmlFilaCuentaBancaria).join('');
  return `<div class="field" id="${prefix}-cuentas-wrap">
    <label>Cuenta bancaria</label>
    <div id="${prefix}-cb-filas">${filas}</div>
    <button class="smallbtn" type="button" onclick="agregarFilaCuentaBancaria(${argJs(prefix)})">+ Agregar otra cuenta</button>
  </div>`;
}
function cambioBancoFilaCuenta(sel){
  const otro = sel.closest('.cb-fila').querySelector('.cb-otro');
  if(sel.value==='__otro__'){ otro.style.display=''; otro.focus(); }
  else { otro.style.display='none'; otro.value=''; }
}
function agregarFilaCuentaBancaria(prefix){
  const cont = document.getElementById(prefix+'-cb-filas');
  cont.insertAdjacentHTML('beforeend', htmlFilaCuentaBancaria(''));
  cont.lastElementChild.querySelector('.cb-banco').focus();
}
function quitarFilaCuentaBancaria(btn){
  const fila = btn.closest('.cb-fila');
  const cont = fila.parentElement;
  const numero = fila.querySelector('.cb-numero').value.trim();
  const quitar = ()=>{
    // Si era la única fila, se deja una vacía en su lugar (así siempre hay dónde tipear).
    if(cont.querySelectorAll('.cb-fila').length>1) fila.remove();
    else fila.outerHTML = htmlFilaCuentaBancaria('');
  };
  if(!numero){ quitar(); return; }
  confirmarAccion(`¿Quitar la cuenta ${numero}? Se borra al guardar.`, 'Quitar').then(ok=>{ if(ok) quitar(); });
}
function leerCuentasBancarias(prefix){
  const filas = document.querySelectorAll(`#${prefix}-cb-filas .cb-fila`);
  const out = [];
  filas.forEach(f=>{
    const sel = f.querySelector('.cb-banco').value;
    const banco = sel==='__otro__' ? f.querySelector('.cb-otro').value.trim() : sel;
    const numero = f.querySelector('.cb-numero').value.trim();
    const sucursal = f.querySelector('.cb-sucursal').value.trim();
    if(!numero) return;
    const txt = `${banco?banco+' ':''}${numero}${sucursal?' (Sucursal '+sucursal+')':''}`;
    if(!out.includes(txt)) out.push(txt);
  });
  return out;
}
// Para mostrar en una ficha (view-only): une las cuentas con · , o '—' si no hay ninguna.
function textoCuentasBancarias(cuentas){
  const lista = Array.isArray(cuentas) ? cuentas.filter(Boolean) : (cuentas ? [cuentas] : []);
  return lista.length ? lista.join(' · ') : '—';
}

// Cuántos años completos pasaron desde una fecha (mismo criterio que calcularEdad, pero
// contando años transcurridos en vez de edad respecto a un nacimiento).
function anosCompletosDesde(fechaISO){
  if(!fechaISO) return 0;
  const inicio = new Date(fechaISO+'T00:00:00'), hoy = new Date(todayISO()+'T00:00:00');
  if(isNaN(inicio)) return 0;
  let anos = hoy.getFullYear() - inicio.getFullYear();
  const noLlegoAlAniversario = (hoy.getMonth() < inicio.getMonth()) || (hoy.getMonth()===inicio.getMonth() && hoy.getDate() < inicio.getDate());
  if(noLlegoAlAniversario) anos--;
  return Math.max(0, anos);
}
// Edad calculada para alguien de quien no se sabe la fecha de nacimiento, solo la edad que
// tenía en una fecha conocida (ej. "cuando la cargamos, tenía 5 años") -- le suma los años
// completos que pasaron desde esa fecha, así se mantiene al día sin saber el cumpleaños real.
function edadDesdeDeclarada(edadDeclarada, declaradaEnISO){
  if(edadDeclarada==null || edadDeclarada==='') return null;
  return Number(edadDeclarada) + anosCompletosDesde(declaradaEnISO);
}
// Edad de un hijo: prioriza la fecha de nacimiento real: si no hay, usa la edad declarada
// (con su fecha de referencia); si no hay ninguna de las dos, no se puede calcular.
function edadHijo(hijo){
  const porFecha = calcularEdad(hijo?.fecha_nacimiento);
  if(porFecha!==null) return porFecha;
  return edadDesdeDeclarada(hijo?.edad_declarada, hijo?.edad_declarada_en);
}

/* ============================================================
   F1 · Red de seguridad de errores y conexión
   Muestra un aviso claro cuando algo falla, en vez de dejar
   la pantalla a medias. No hay que tocar cada consulta:
   los fallos de red y los errores sueltos caen acá solos.
   ============================================================ */
let _sinConexion = false;
function avisarSinConexion(){
  if(_sinConexion) return;
  _sinConexion = true;
  toast('Te quedaste sin conexión. Lo que cargues no se guarda hasta que vuelva internet.', 'bad');
}
window.addEventListener('offline', avisarSinConexion);
window.addEventListener('online', ()=>{
  if(_sinConexion){ toast('Conexión restablecida.', 'good'); _sinConexion = false; }
});
window.addEventListener('unhandledrejection', (ev)=>{
  const msg = (ev.reason && (ev.reason.message || ev.reason)) || '';
  console.error('[error no manejado]', ev.reason);
  if(!navigator.onLine || /fetch|network|failed to fetch|conexi|timeout/i.test(String(msg))){
    toast('Problema de conexión. Revisá internet y reintentá.', 'bad');
  } else {
    toast('Ocurrió un error inesperado. Si sigue pasando, recargá la página.', 'bad');
  }
});

/* Envoltorio para lecturas de Supabase: si la consulta falla, avisa
   y devuelve un valor seguro en vez de romper la vista.
   Uso: const datos = await sbLeer(sb.from('ninieras').select('*'), 'las niñeras', []); */
async function sbLeer(consulta, queCosa='los datos', fallback=null){
  try {
    const { data, error } = await consulta;
    if(error){
      console.error('[Supabase] al cargar', queCosa, error);
      toast(`No se pudieron cargar ${queCosa}. Reintentá en un momento.`, 'bad');
      return fallback;
    }
    return data;
  } catch(e){
    console.error('[Supabase] al cargar', queCosa, e);
    toast(`No se pudieron cargar ${queCosa}. Revisá tu conexión.`, 'bad');
    return fallback;
  }
}

/* Consultas que leen una tabla entera (06/10/2026, testing de la noche). Supabase devuelve
   como mucho 1.000 filas por pedido y corta sin avisar: con más sittings que eso, el filtro
   de familias del historial, la actividad de las niñeras o los gráficos de varios meses
   quedaban incompletos sin ningún error. (El 06/10 había 575; con los fijos automáticos
   pasan los 1.000 en pocos meses.) Esto pide de a 1.000 hasta traer todo. armar() tiene que
   devolver una consulta NUEVA cada vez, con un orden fijo (por ejemplo .order('id')) para
   que las tandas no se pisen. Devuelve { data, error } como una consulta común. */
const FILAS_POR_PEDIDO = 1000;
async function leerTodasLasFilas(armar){
  const filas = [];
  for(let desde = 0; ; desde += FILAS_POR_PEDIDO){
    const { data, error } = await armar().range(desde, desde + FILAS_POR_PEDIDO - 1);
    if(error) return { data: null, error };
    filas.push(...(data||[]));
    if(!data || data.length < FILAS_POR_PEDIDO) return { data: filas, error: null };
  }
}

/* ============================================================
   B2 · Anti-duplicados: detecta nombres parecidos antes de crear
   una familia/niñera nueva (typos, variantes: "Carla Ejenplo" vs
   "Carla Ejemplo", "Mariana Prueba" vs "Mari Prueba").
   ============================================================ */
function distanciaEdicion(a, b){
  const m = a.length, n = b.length;
  if(!m) return n; if(!n) return m;
  let prev = Array.from({length:n+1}, (_,j)=>j);
  for(let i=1;i<=m;i++){
    const cur = [i];
    for(let j=1;j<=n;j++){
      cur[j] = a[i-1]===b[j-1] ? prev[j-1] : 1+Math.min(prev[j-1], prev[j], cur[j-1]);
    }
    prev = cur;
  }
  return prev[n];
}
function nombreParecido(texto, lista){
  const q = normaliza((texto||'').trim());
  if(!q || q.length<3) return null;
  let mejor = null, mejorDist = Infinity;
  (lista||[]).forEach(o=>{
    const cand = normaliza(o.nombre||'');
    if(!cand || cand===q) return; // exacto no cuenta como "parecido", ya es la misma persona
    const dist = distanciaEdicion(q, cand);
    const umbral = cand.length<=6 ? 1 : cand.length<=10 ? 2 : 3;
    if(dist<=umbral && dist<mejorDist){ mejor = o; mejorDist = dist; }
  });
  return mejor;
}
/* Devuelve true si está OK seguir (no había parecido, o el usuario confirmó que es alguien distinto). */
async function confirmarNombreNuevo(texto, lista, tipoLabel){
  const parecido = nombreParecido(texto, lista);
  if(!parecido) return true;
  return confirmarAccion(`¿Quisiste decir "${parecido.nombre}"? Ya existe ${tipoLabel==='familia'?'una familia':'una niñera'} con un nombre muy parecido. Si es alguien distinto, confirmá para crear "${texto.trim()}" igual.`, 'Es alguien distinto, crear igual');
}

/* ============================================================
   B4 · Detección de doble reserva: avisa si una niñera queda
   comprometida en dos horarios que se pisan el mismo día.
   No bloquea — el criterio final es de quien está cargando.
   ============================================================ */
function rangosSolapan(i1, f1, i2, f2){
  if(!i1 || !i2) return false; // sin horario cargado de un lado, no se puede comparar — no molesta
  const s1 = agendaMinutos(i1), e1 = f1 ? agendaMinutos(f1) : s1+60;
  const s2 = agendaMinutos(i2), e2 = f2 ? agendaMinutos(f2) : s2+60;
  return s1 < e2 && s2 < e1;
}
/* Chequea contra lo ya cargado en Agenda (solicitudes confirmadas, fijos, registrados) — sin ir a la base.
   agendaSolicitudes tiene TODA la semana visible (desde el rediseño semanal), así que se filtra por la
   fecha del sitting que se está registrando: sin este filtro, un fijo de otro día de la semana con
   el mismo horario (ej. lunes/miércoles/viernes) disparaba un choque falso contra otro día. */
function chequearDobleReservaAgenda(nineraNombre, fecha, horaInicio, horaFin, excluirId){
  if(!horaInicio || !fecha) return null;
  const key = normaliza(nineraNombre);
  for(const s of agendaSolicitudes){
    if(s.fecha!==fecha) continue;
    if(s.id===excluirId || s.estado==='cancelada' || s.cancelado) continue;
    const comprometida = s.ninieras.some(n=>normaliza(n.ninera_nombre)===key && n.estado==='confirmada');
    if(!comprometida) continue;
    if(rangosSolapan(horaInicio, horaFin, s.hora_inicio, s.hora_fin)) return s;
  }
  return null;
}
/* Misma idea pero consultando la base — para usar fuera de Agenda (ej. cargando un sitting a mano).
   familiaId: lo de la misma familia no es doble reserva. Cargar un día del fijo de Laura con
   Romina chocaba contra ese mismo fijo ("ya está comprometida con [la misma familia]", 06/10/2026);
   un registro repetido de la misma familia ya lo avisa chequearRegistroExistenteMismoDia. */
async function chequearDobleReservaDB(nineraNombre, fecha, horaInicio, horaFin, {familiaId=null, asignacionId=null}={}){
  if(!horaInicio) return null;
  const mismaFamilia = x => !!familiaId && x.familia_id===familiaId;
  const [{data:regs}, {data:asigs}, {data:sols}] = await Promise.all([
    sb.from('sittings_traslados').select('familia_id,familia_nombre,hora_inicio,hora_fin,ninera_nombre,asignacion_id').eq('fecha', fecha),
    sb.from('asignaciones').select('*, familias(nombre)'),
    sb.from('solicitudes').select('familia_nombre,hora_inicio,hora_fin,estado,solicitud_ninieras(ninera_nombre,estado)').eq('fecha', fecha),
  ]);
  const key = normaliza(nineraNombre);
  const diaSemana = diaDeFecha(fecha);
  for(const r of (regs||[])){
    if(normaliza(r.ninera_nombre)!==key || mismaFamilia(r) || (asignacionId && r.asignacion_id===asignacionId)) continue;
    if(rangosSolapan(horaInicio, horaFin, r.hora_inicio, r.hora_fin)) return {familia_nombre:r.familia_nombre, hora_inicio:r.hora_inicio, hora_fin:r.hora_fin};
  }
  for(const a of (asigs||[])){
    if(a.id===asignacionId || mismaFamilia(a)) continue;
    if(normaliza(a.ninera_nombre)!==key || !Array.isArray(a.dias) || !a.dias.includes(diaSemana) || !asignacionVigenteEn(a, fecha)) continue;
    if(rangosSolapan(horaInicio, horaFin, a.hora_inicio, a.hora_fin)) return {familia_nombre:a.familias?.nombre||'(familia)', hora_inicio:a.hora_inicio, hora_fin:a.hora_fin};
  }
  for(const s of (sols||[])){
    if(s.estado==='cancelada') continue;
    const comprometida = (s.solicitud_ninieras||[]).some(n=>normaliza(n.ninera_nombre)===key && n.estado==='confirmada');
    if(!comprometida) continue;
    if(rangosSolapan(horaInicio, horaFin, s.hora_inicio, s.hora_fin)) return {familia_nombre:s.familia_nombre, hora_inicio:s.hora_inicio, hora_fin:s.hora_fin};
  }
  return null;
}
/* Al crear/editar una asignación fija: chequea contra otros fijos de esa niñera (cualquier fecha, no vencen),
   y contra sittings ya registrados o solicitudes puntuales confirmadas DE HOY EN ADELANTE cuyo día de
   semana caiga en los días elegidos para el fijo. excluirAsigId es para cuando se está EDITANDO un fijo
   existente -- si no, se autodetecta como conflicto contra sí mismo. */
async function chequearFijoNuevoContraTodo(nineraNombre, dias, horaInicio, horaFin, excluirAsigId=null){
  if(!horaInicio) return null;
  const hoy = todayISO();
  const key = normaliza(nineraNombre);
  const [{data:fijos}, {data:regs}, {data:sols}] = await Promise.all([
    sb.from('asignaciones').select('*, familias(nombre)'),
    sb.from('sittings_traslados').select('familia_nombre,fecha,hora_inicio,hora_fin,ninera_nombre,asignacion_id').gte('fecha', hoy),
    sb.from('solicitudes').select('familia_nombre,fecha,hora_inicio,hora_fin,estado,solicitud_ninieras(ninera_nombre,estado)').gte('fecha', hoy),
  ]);
  for(const ex of (fijos||[])){
    if(ex.id===excluirAsigId || normaliza(ex.ninera_nombre)!==key || !Array.isArray(ex.dias) || !dias.some(d=>ex.dias.includes(d))) continue;
    if(asignacionTerminada(ex, hoy)) continue; // un fijo que ya terminó no choca con nada nuevo
    if(rangosSolapan(horaInicio, horaFin, ex.hora_inicio, ex.hora_fin)) return {familia_nombre:ex.familias?.nombre||'(familia)', hora_inicio:ex.hora_inicio, hora_fin:ex.hora_fin};
  }
  for(const r of (regs||[])){
    // Los días de este mismo fijo (por ejemplo sus previstos automáticos) no chocan con él.
    if(excluirAsigId && r.asignacion_id===excluirAsigId) continue;
    if(normaliza(r.ninera_nombre)!==key || !dias.includes(diaDeFecha(r.fecha))) continue;
    if(rangosSolapan(horaInicio, horaFin, r.hora_inicio, r.hora_fin)) return {familia_nombre:r.familia_nombre, hora_inicio:r.hora_inicio, hora_fin:r.hora_fin, fecha:r.fecha};
  }
  for(const s of (sols||[])){
    if(s.estado==='cancelada' || !dias.includes(diaDeFecha(s.fecha))) continue;
    const comprometida = (s.solicitud_ninieras||[]).some(n=>normaliza(n.ninera_nombre)===key && n.estado==='confirmada');
    if(!comprometida) continue;
    if(rangosSolapan(horaInicio, horaFin, s.hora_inicio, s.hora_fin)) return {familia_nombre:s.familia_nombre, hora_inicio:s.hora_inicio, hora_fin:s.hora_fin, fecha:s.fecha};
  }
  return null;
}
function horaTxt(h){ return h ? h.slice(0,5) : '?'; }

/* Precio puesto a mano (21/10/2026, Paulina y Delfina): cuando el precio de un sitting no es el de
   la tarifa, se anota por qué (sittings_traslados.precio_motivo). Lo piden el registro (si no
   coincide con el calculado) y "Editar movimiento" en Finanzas (si se cambia el monto). */
const MOTIVOS_PRECIO = [['descuento', 'Descuento'], ['extra', 'Extra'], ['sin_servicio', 'Se cobra sin servicio'], ['otro', 'Otro (contalo en las notas)']];
function htmlMotivoPrecio(id, actual){
  return `<div class="field" style="margin:8px 0 0;"><label for="${id}">¿Por qué este precio? (queda anotado)</label>
    <select id="${id}"><option value="">Elegí el motivo…</option>${MOTIVOS_PRECIO.map(([v, t])=>`<option value="${v}"${actual===v?' selected':''}>${t}</option>`).join('')}</select></div>`;
}
// Sin la migración del 21/10/2026 la columna no existe: se guarda igual, sin el motivo.
function esFaltaColumnaMotivo(error){ return !!error && /precio_motivo/.test(error.message||''); }
// Sin la migración del 23/10/2026 (variantes de precio) no está la columna: se guarda sin ellas.
function esFaltaColumnaVariantes(error){ return !!error && /precio_variantes/.test(error.message||''); }
// Minutos desde la medianoche de ahora en Montevideo (21/10/2026): para saber si ya terminó el
// último fijo del día, aunque el aparato tenga otra zona horaria.
function minutosAhoraMontevideo(d=new Date()){
  try{
    const p = {};
    new Intl.DateTimeFormat('en-GB', {timeZone:ZONA_NEGOCIO, hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(d).forEach(x=>{ p[x.type] = x.value; });
    if(p.hour!==undefined) return Number(p.hour)*60 + Number(p.minute);
  }catch(e){}
  return d.getHours()*60 + d.getMinutes();
}

/* ============================================================
   Vigencia de los fijos (05/10/2026, error E2). Cada asignación vale entre
   vigente_desde y vigente_hasta, los dos inclusive; vacío = sin límite (asignaciones
   de antes de la migración). Cambiar la niñera de un fijo cierra la asignación vieja y
   abre una nueva desde una fecha, así el pasado sigue siendo de quien lo hizo.
   ============================================================ */
function asignacionVigenteEn(a, fechaISO){
  if(!a || !fechaISO) return false;
  if(a.vigente_desde && fechaISO < a.vigente_desde) return false;
  if(a.vigente_hasta && fechaISO > a.vigente_hasta) return false;
  return true;
}
function asignacionTerminada(a, hoyISO){ return !!(a && a.vigente_hasta && a.vigente_hasta < hoyISO); }
function tipoAsignacion(a){ return a && a.tipo==='traslado' ? 'traslado' : 'sitting'; }
function textoVigencia(a){
  const f = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('es-UY',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '';
  // "Empezó el" (10/10/2026): fecha real si el fijo arrancó antes de la app. Solo informativo.
  const empezo = a.inicio_real && (!a.vigente_desde || a.inicio_real < a.vigente_desde) ? ` (empezó el ${f(a.inicio_real)}, antes de la app)` : '';
  if(a.vigente_desde && a.vigente_hasta) return `del ${f(a.vigente_desde)} al ${f(a.vigente_hasta)}${empezo}`;
  if(a.vigente_desde) return `desde el ${f(a.vigente_desde)}${empezo}`;
  if(a.vigente_hasta) return `hasta el ${f(a.vigente_hasta)}${empezo}`;
  return 'sin fecha de inicio'+empezo;
}
/* Escribe en asignaciones tolerando que la base todavía no tenga las columnas nuevas
   (si se publicara la app antes de correr la migración): en ese caso reintenta sin
   vigencia ni tipo y avisa, en vez de fallar. `consulta` recibe el payload y devuelve
   la consulta de supabase-js (insert/update). */
let asignacionesSinVigencia = false;
const COLUMNAS_VIGENCIA = ['vigente_desde','vigente_hasta','tipo'];
function sinColumnasVigencia(payload){
  const limpiar = o => { const c = {...o}; COLUMNAS_VIGENCIA.forEach(k=>delete c[k]); return c; };
  return Array.isArray(payload) ? payload.map(limpiar) : limpiar(payload);
}
/* Gastos extra a cargo de la familia (13/10/2026): los que pagó la niñera y no absorbe
   Parents Break. Los que pagó la familia van como saldo a su favor; los que absorbe Parents
   Break no se le cobran a nadie (se le reintegran a la niñera y bajan el resultado del mes). */
function gastoACargoFamilia(g){ return !!g && g.pagado_por==='ninera' && !g.absorbe_pb; }
/* Montos sin centavos (21/10/2026, regla de Paulina y Delfina). Todo pago a una niñera y todo
   cobro a una familia que sale de una cuenta (horas por tarifa, totales con saldo o gastos)
   pasa por una de estas dos. Pago: ,5 o menos baja (600,5 → 600; 600,6 → 601). Cobro: ,5 o
   más sube (600,5 → 601; 600,4 → 600). Primero se lleva a centavos para que el error de
   punto flotante (2,5 h × 240,2 = 600,4999…) no cambie el lado del ,5. Son las mismas
   reglas que redondear_pago() y redondear_cobro() en la base (generar_previstos_fijos): si
   cambia una, cambia la otra. Con negativos redondea igual sobre el valor absoluto. */
function redondearMonto(n, mitadSube){
  const v = Number(n);
  if(!isFinite(v)) return 0;
  const centavos = Math.round(Math.abs(v)*100);
  const entero = Math.floor(centavos/100), resto = centavos % 100;
  const r = resto > 50 || (resto === 50 && mitadSube) ? entero + 1 : entero;
  return v < 0 && r ? -r : r;
}
function redondearPago(n){ return redondearMonto(n, false); }
function redondearCobro(n){ return redondearMonto(n, true); }
/* Variantes de precio (23/10/2026): los casos especiales de una familia ("la llevó a la casa":
   se suma algo a la madre y a la niñera; "no se hizo": se cobra igual y a la niñera se le paga un
   monto fijo; un descuento por porcentaje) dejan de ser notas sueltas. Cada variante dice qué le hace al cobro
   y qué al pago: sumar (o restar) un monto, reemplazar por un total fijo o un porcentaje. De
   cada lado va primero el total fijo (si hay varios, el último), después los porcentajes y al
   final las sumas; nunca menos de $0, y sin centavos con la regla de cada lado. En la base, lo
   mismo hace precio_con_variantes() (generar_previstos_fijos); si cambia una, cambian las dos
   (las compara supabase/pruebas/paridad_plata.sql). La app de niñeras puede usar las mismas. */
const MODOS_VARIANTE = [['sumar', 'Sumar o restar'], ['total', 'Total fijo'], ['porcentaje', 'Porcentaje']];
function efectoVariantes(base, efectos){
  const n = x => Number(x)||0;
  const total = efectos.filter(e=>e.modo==='total').pop();
  let v = total ? n(total.valor) : n(base);
  efectos.filter(e=>e.modo==='porcentaje').forEach(e=>{ v = v * (1 + n(e.valor)/100); });
  efectos.filter(e=>e.modo==='sumar').forEach(e=>{ v = v + n(e.valor); });
  return Math.max(Math.round(v*100)/100, 0);
}
// aplicadas: [{ id, nombre, cobro: {modo, valor} | null, pago: {modo, valor} | null, ... }].
function aplicarVariantes(baseCobro, basePago, aplicadas){
  const lado = k => (aplicadas||[]).map(a=>a && a[k]).filter(e=>e && e.modo);
  return { cobro: redondearCobro(efectoVariantes(baseCobro, lado('cobro'))), pago: redondearPago(efectoVariantes(basePago, lado('pago'))) };
}
/* Pago por hora de una niñera con una familia (31/10/2026, regla 2 de docs/fase1/reglas-del-negocio.md
   y docs/precio-ninera-familia.md). Lo que cobra la niñera cambia según la familia (cantidad de chicos,
   antigüedad, fuera de Montevideo) y se guarda por par en precios_ninera_familia. El orden: el precio
   del fijo (asignaciones.pago_hora, solo si es más que 0), si no el de esa niñera con esa familia, si
   no la tarifa de la familia; si no hay ninguno, null. precios: filas {familia_id, ninera_id,
   pago_hora}; pagoFijo y las tarifas pueden llegar como texto de un campo ("300"). No calcula el
   pago del sitting: se le pasa a precioSegunHorario la familia con este pago_hora. En la base, la
   misma regla está en el pago de generar_previstos_fijos (lo compara con esta función
   supabase/pruebas/paridad_plata.sql) y, con el mismo orden pero sin el precio del fijo, en
   pago_hora_ninera() (supabase/pruebas/precios_ninera_familia.sql): si cambia una, cambian todas. */
function precioHoraNinera(familia, nineraId, precios, pagoFijo){
  // Number(null) y Number('') dan 0: un campo vacío o en 0 es "no cargado".
  const positivo = x => Number(x) > 0 ? Number(x) : null;
  if(positivo(pagoFijo) != null) return positivo(pagoFijo);
  const fila = nineraId && familia?.id ? (precios||[]).find(p => p && p.familia_id===familia.id && p.ninera_id===nineraId) : null;
  return positivo(fila?.pago_hora) ?? positivo(familia?.pago_hora);
}
/* Dónde se usa (01/11/2026, tarea B): Sittings, la Agenda y el Cierre de los fijos leen los precios
   con una consulta por familia (o por par) cuando hace falta, nunca una por fila. Sin la tabla (base
   sin la migración), todo sigue como antes: la tarifa de la familia. Con un error de lectura, nunca la
   tarifa en silencio (preciosNoLeidos, abajo).
   Devuelve las filas, o null si no se pudo leer (así la casilla de guardar no supone que la niñera no
   tiene precio y lo pisa); precioHoraNinera toma null como "sin filas". */
let preciosNineraDisponible = true; // false si la base no tiene la tabla: no se vuelve a pedir
async function leerPreciosNinera(familiaId, nineraId=null){
  if(!familiaId || !preciosNineraDisponible) return [];
  let q = sb.from('precios_ninera_familia').select('familia_id,ninera_id,pago_hora').eq('familia_id', familiaId);
  if(nineraId) q = q.eq('ninera_id', nineraId);
  const { data, error } = await q;
  if(error){ if(esFaltaTabla(error)) preciosNineraDisponible = false; return null; }
  return data || [];
}
// La tabla existe pero la lectura falló (01/11/2026, revisión): quien crea o pisa un pago con eso no
// puede seguir con la tarifa en silencio (le pagaría de menos a una niñera con precio): avisa y no
// guarda. Sin la tabla (base sin migrar), la tarifa como siempre.
const AVISO_PRECIOS_NO_LEIDOS = 'No se pudo leer el precio de la niñera con esta familia. Probá de nuevo.';
function preciosNoLeidos(precios){ return precios===null && preciosNineraDisponible; }
// Donde el pago queda a la vista y se puede corregir antes de guardar (Sittings, "+ Nueva solicitud" y
// "Asignar niñera"), se sigue con la tarifa pero con este aviso al lado (revisión final, 31/10/2026).
function avisoPreciosNoLeidosTarifa(nineraNombre){
  return `No se pudo leer el precio de ${nineraNombre} con esta familia: el pago va con la tarifa. Revisalo o probá de nuevo.`;
}
/* La casilla "Guardar como precio de [niñera] con esta familia" (respuesta 3 de Diego), una sola regla
   para Sittings y "+ Nueva solicitud": null si no corresponde (sin familia o niñera, precios sin leer,
   pago no tipeado a mano, cero o igual al que ya le corresponde); si corresponde, {tildada}: solo si
   esa niñera no tiene precio con esa familia (un precio especial de un día no pisa el guardado). */
function casillaPrecioNinera({ familiaId, nineraId, filas, valor, tocadoManual, pagoActual }){
  if(!preciosNineraDisponible || !familiaId || !nineraId || !Array.isArray(filas) || !tocadoManual) return null;
  const v = Number(valor)||0;
  if(v<=0 || v===Number(pagoActual)) return null;
  return { tildada: !filas.some(p=>p.familia_id===familiaId && p.ninera_id===nineraId) };
}
// El precio propio de un fijo es de su niñera (respuestas de Diego, 31/10/2026): un reemplazo de un
// día o la niñera nueva de un fijo no lo usan, cobran el suyo con esa familia. Sin ids (fijos viejos),
// por el nombre.
function pagoFijoDeNinera(a, nineraId, nineraNombre){
  if(!a) return null;
  const esSuya = a.ninera_id ? a.ninera_id===nineraId : (!!nineraNombre && normaliza(a.ninera_nombre||'')===normaliza(nineraNombre));
  return esSuya ? (a.pago_hora ?? null) : null;
}
/* "Guardar como precio de [niñera] con esta familia" al registrar (respuesta 3 de Diego): se guarda
   después del registro, así si falla el registro igual queda y el aviso dice qué faltó. Si esa niñera
   tiene un fijo vigente con esa familia, sus días previstos se recalculan (el fijo sin precio propio
   paga con este). Devuelve {error} si no se guardó, o {previstosSinActualizar: true} si se guardó pero
   no se pudo ver si tiene un fijo (los previstos se corrigen solos a la noche). */
async function guardarPrecioNineraFamilia({familiaId, nineraId, pagoHora, nueva}){
  const fila = { familia_id: familiaId, ninera_id: nineraId, pago_hora: pagoHora };
  if(nueva) fila.creado_por = registradoPorUsuario() || null; // en un cambio no se pisa quién la cargó
  const { error } = await sb.from('precios_ninera_familia').upsert(fila, { onConflict: 'familia_id,ninera_id' });
  if(error) return { error };
  return (await recalcularPrevistosDelPar(familiaId, nineraId)) ? {} : { previstosSinActualizar: true };
}
// Después de guardar o borrar el precio de una niñera con una familia (al registrar o en la ficha,
// 01/11/2026): si esa niñera tiene un fijo vigente con esa familia, sus días previstos se recalculan ya
// (el fijo sin precio propio paga con este). El de hoy (ya confirmado a las 03:00, el proceso no lo
// vuelve a tocar) sigue al precio nuevo si lo cargó el proceso y nadie lo tocó, con la misma regla que
// un cambio del fijo desde hoy (alinearRegistroDeHoy, agenda.js; revisión final, 31/10/2026). false si
// no se pudo ver si tiene un fijo: los previstos se corrigen solos a la noche.
async function recalcularPrevistosDelPar(familiaId, nineraId){
  await esperarConfigFijos();
  if(!fijosAutomaticosActivos) return true;
  const { data: fijos, error } = await sb.from('asignaciones')
    .select('id,vigente_hasta,vigente_desde,familia_id,ninera_id,ninera_nombre,tipo,dias,hora_inicio,hora_fin,pago_hora')
    .eq('familia_id', familiaId).eq('ninera_id', nineraId);
  if(error) return false;
  const hoy = todayISO();
  const vigentes = (fijos||[]).filter(a=>!a.vigente_hasta || a.vigente_hasta >= hoy);
  if(!vigentes.length) return true;
  await sincronizarPrevistosFijos();
  for(const a of vigentes.filter(a=>tipoAsignacion(a)==='sitting')) await alinearRegistroDeHoy(a.id, a, null, { noCancelar: true, queSeGuardo: 'el precio' });
  return true;
}
// El aviso después de guardar el precio: null si salió todo bien, o {texto, tipo}.
function avisoPrecioGuardado(res, nineraNombre, prefijoError){
  if(res.error) return { texto: `${prefijoError} no el precio de ${nineraNombre} con esta familia: ${res.error.message}`, tipo: 'bad' };
  if(res.previstosSinActualizar) return { texto: `Precio de ${nineraNombre} con esta familia guardado; los próximos días de su fijo se actualizan esta noche.`, tipo: 'bad' };
  return null;
}
// "Traslado $1.018 + gastos $427 = $1.445". Delfi no veía que la comida se sumaba aparte, la
// metió en el precio y quedó cobrada dos veces (13/10/2026). Sin gastos devuelve ''.
function textoTotalConGastos(etiqueta, base, gastos){
  const g = Number(gastos)||0;
  if(!g) return '';
  const b = Number(base)||0, f = n => '$'+Math.round(n).toLocaleString('es-UY');
  return `${etiqueta} ${f(b)} + gastos ${f(g)} = ${f(b+g)}`;
}
/* Términos y condiciones (20/10/2026, regla de Paulina y Delfina). A las familias que los
   aceptaron (familias.terminos_aceptados_el) el fin de cada sitting se les COBRA redondeado a
   la media hora siguiente, con 5 minutos de tolerancia: 17:05 → 17:00, 17:06 → 17:30,
   17:36 → 18:00. El inicio no se redondea y a la niñera se le paga siempre la hora real.
   Rige para los sittings desde el día que aceptó: las familias de siempre no cambian.
   Es la misma regla que minutos_fin_cobro() en la base (generar_previstos_fijos): si cambia
   acá, cambia allá. */
const TOLERANCIA_FIN_COBRO_MIN = 5;
function redondearFinCobro(min){
  const media = Math.floor(min/30)*30;
  return min - media <= TOLERANCIA_FIN_COBRO_MIN ? media : media + 30;
}
function familiaRedondeaFin(familia, fechaISO){
  const desde = familia?.terminos_aceptados_el;
  return !!desde && (!fechaISO || fechaISO >= desde);
}
/* "Termina al día siguiente" con la hora de fin DESPUÉS de la de inicio (20:00 a 22:00) sumaba
   24 h sin avisar y se cobraban 26 horas (auditoría, 21/10/2026). Con la casilla, el fin tiene
   que ser antes que el inicio (20:00 a 01:00) o igual (24 h justas). Cada pantalla con la casilla
   muestra este aviso y no deja guardar; horasSitting devuelve null. */
const AVISO_CRUCE_MEDIANOCHE = 'Marcaste "Termina al día siguiente", pero la hora de fin es después de la de inicio: serían más de 24 horas. Si termina el mismo día, desmarcá la casilla.';
function cruceMedianocheMalMarcado(horaIni, horaFin, cruza){
  if(!cruza || !horaIni || !horaFin) return false;
  return agendaMinutos(String(horaFin).slice(0,5)) > agendaMinutos(String(horaIni).slice(0,5));
}
// Horas de un sitting: las reales (pago a la niñera) y las que se le cobran a la familia,
// y hasta qué hora se cobra si no es la real. null si el horario está incompleto, el fin no
// es después del inicio o la casilla del día siguiente está mal marcada. Todo cobro por hora
// pasa por acá.
function horasSitting(horaIni, horaFin, cruza, familia, fechaISO){
  if(!horaIni || !horaFin) return null;
  if(cruceMedianocheMalMarcado(horaIni, horaFin, cruza)) return null;
  const mi = agendaMinutos(String(horaIni).slice(0,5));
  const mf = agendaMinutos(String(horaFin).slice(0,5)) + (cruza ? 24*60 : 0);
  if(mf<=mi) return null;
  const mfCobro = familiaRedondeaFin(familia, fechaISO) ? Math.max(mi, redondearFinCobro(mf)) : mf;
  const hhmm = m => `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  return { real: (mf-mi)/60, cobro: (mfCobro-mi)/60, finCobro: mfCobro!==mf ? hhmm(mfCobro) : null };
}
// "Hora real 17:36, se cobra hasta 18:00"; '' si se cobra la hora real.
function textoFinCobrado(horaFin, horas){
  return horas?.finCobro ? `Hora real ${String(horaFin).slice(0,5)}, se cobra hasta ${horas.finCobro}` : '';
}
/* Lee familias con terminos_aceptados_el. Con la base sin migrar la columna no existe y la
   consulta entera fallaría: se reintenta sin ella (nadie redondea) y no se vuelve a pedir.
   `armar` agrega lo que siga a la consulta (order, eq, maybeSingle). */
let familiasSinTerminos = false;
async function leerFamiliasConTerminos(columnas, armar = q=>q){
  if(!familiasSinTerminos){
    const res = await armar(sb.from('familias').select(columnas+',terminos_aceptados_el'));
    if(!res.error || !/terminos_aceptados_el/.test(res.error.message||'')) return res;
    familiasSinTerminos = true;
  }
  return armar(sb.from('familias').select(columnas));
}
/* Celular de una niñera (27/10/2026, pedido de Diego): obligatorio en el alta y al editar, salvo
   que solo haga traslados (la misma lectura que nineraHaceTipo: 'Niñera' y 'Ambas' hacen sittings;
   sin tipo cuenta como niñera, porque la base pone 'Niñera' por defecto). Lo escrito, con cualquier
   tipo, tiene que ser un celular uruguayo según normalizarCelular (comun.js), la regla con la que
   se arma su cuenta de la app. Se guarda como se escribió, no normalizado. Devuelve el problema en
   texto, o '' si está bien. */
function problemaCelularNinera(telefono, tipo){
  const valor = String(telefono ?? '').trim();
  if(!valor) return tipo==='Traslados' ? '' : 'Falta el celular: para una niñera es obligatorio.';
  if(!normalizarCelular(valor)) return 'Revisá el celular: tiene que ser uruguayo, de 8 dígitos y empezar en 9 (099 123 456 o +598 99 123 456).';
  return '';
}
/* Controles al crear un fijo (13/10/2026). Un fijo de traslado sin precio hizo que el
   precargado tomara un traslado con la comida sumada y lo copiara a todo el mes, y un fijo
   sin hora de inicio no se carga solo (generar_previstos_fijos lo saltea) y dejaba el aviso
   de Hoy prendido para siempre. Devuelve el problema en texto, o null si está bien. */
function problemaFijoNuevo(f){
  if(!Array.isArray(f.dias) || !f.dias.length) return 'Elegí al menos un día.';
  if(!f.hora_inicio) return 'Falta la hora de inicio: sin horario el fijo no se carga solo en la Agenda.';
  if(f.tipo==='traslado' && !(Number(f.cobro_traslado)>0 && Number(f.pago_traslado)>0)) return 'Un traslado fijo necesita lo que se cobra y lo que se paga a la niñera por cada traslado.';
  return null;
}
// Antes de crear un fijo: si ya hay uno vigente de la misma niñera con la misma familia algún
// día igual (fijo duplicado de Paula, 13/10/2026), se pregunta. true = seguir.
async function avisarSiFijoDuplicado(f){
  if(!f.familia_id) return true;
  const { data } = await sb.from('asignaciones').select('*').eq('familia_id', f.familia_id);
  const desde = f.vigente_desde || todayISO();
  const igual = (data||[]).find(a=>!asignacionTerminada(a, desde) && normaliza(a.ninera_nombre||'')===normaliza(f.ninera_nombre||'')
    && Array.isArray(a.dias) && a.dias.some(d=>(f.dias||[]).includes(d)));
  if(!igual) return true;
  const dias = (igual.dias||[]).map(d=>DIAS_CORTO[d]||d).join(' ');
  return confirmarAccion(`Ya hay un fijo vigente de ${f.ninera_nombre} con esta familia (${dias}${igual.hora_inicio ? ' · '+horaTxt(igual.hora_inicio) : ''}). Si es el mismo, cancelá y editá el que está. ¿Crear otro igual?`, 'Crear otro');
}
async function escribirAsignacion(consulta, payload){
  const intento = asignacionesSinVigencia ? sinColumnasVigencia(payload) : payload;
  let res = await consulta(intento);
  const faltaColumna = res.error && (res.error.code==='PGRST204' || /vigente_desde|vigente_hasta|'tipo'/.test(res.error.message||''));
  if(faltaColumna && !asignacionesSinVigencia){
    asignacionesSinVigencia = true;
    console.warn('[asignaciones] la base todavía no tiene vigencia/tipo; se guarda sin esas columnas');
    res = await consulta(sinColumnasVigencia(payload));
  }
  return res;
}

/* ============================================================
   Fijos automáticos (06/10/2026). Un proceso en la base (generar_previstos_fijos, pg_cron
   a las 03:00) mantiene cargados como sittings "previstos" los próximos 14 días de cada
   fijo vigente; el día que ocurren pasan solos a "confirmado". Decisiones de Diego y las
   dueñas (05/10/2026): los previstos se ven solo en la Agenda (Sittings, Finanzas y el
   resto muestran lo que ya pasó), se confirman solos con una lista corta para revisar en
   Hoy, y Finanzas muestra aparte el "previsto del mes".
   Todo esto rige solo si la base lo tiene activado (app_config 'fijos_automaticos', lo
   prende 20261006_fijos_automaticos_ACTIVAR.sql). Apagado, la app funciona como antes,
   también con la base sin migrar.
   ============================================================ */
const DIAS_PREVISTOS = 14;
let fijosAutomaticosActivos = false;
let promesaConfigFijos = null;
async function cargarConfigFijosAutomaticos(){
  try{
    const { data, error } = await sb.from('app_config').select('valor').eq('id', 'fijos_automaticos').maybeSingle();
    fijosAutomaticosActivos = !error && !!data?.valor?.activo;
  }catch(e){ fijosAutomaticosActivos = false; }
  return fijosAutomaticosActivos;
}
// Se lee una vez por sesión, la primera vez que alguna pantalla lo necesita.
function esperarConfigFijos(){
  if(!promesaConfigFijos) promesaConfigFijos = cargarConfigFijosAutomaticos();
  return promesaConfigFijos;
}
// Previsto = lo cargó el proceso para un día que todavía no llegó. Uno de hoy o de antes
// cuenta como confirmado aunque el proceso no haya corrido todavía.
function esPrevisto(r){ return !!r && r.estado==='previsto' && !!r.fecha && r.fecha > todayISO(); }
// Saca los previstos de una consulta de sittings_traslados (solo si están activados: con
// la base sin migrar la columna estado no existe).
function sinPrevistos(consulta){
  return fijosAutomaticosActivos ? consulta.or(`estado.neq.previsto,fecha.lte.${todayISO()}`) : consulta;
}
// Después de cambiar un fijo (niñera, horario, vigencia, pausa, tarifa de la familia) se
// llama al proceso para que los previstos queden al día enseguida, sin esperar a la noche.
async function sincronizarPrevistosFijos(){
  await esperarConfigFijos();
  if(!fijosAutomaticosActivos) return true;
  const { error } = await sb.rpc('generar_previstos_fijos', { p_dias: DIAS_PREVISTOS });
  if(error){
    toast('Se guardó, pero no se pudieron actualizar los días previstos ('+error.message+'). Se corrigen solos a la noche.', 'bad');
    return false;
  }
  return true;
}
// Pausas de los fijos (vacaciones): solo existen con los fijos automáticos activados.
async function cargarPausasFijos(){
  await esperarConfigFijos();
  if(!fijosAutomaticosActivos) return [];
  const { data, error } = await sb.from('asignaciones_pausas').select('*').order('desde');
  return error ? [] : (data||[]);
}
function fijoPausadoEn(pausas, asigId, fechaISO){
  return (pausas||[]).some(p=>p.asignacion_id===asigId && fechaISO>=p.desde && fechaISO<=p.hasta);
}

/* ============================================================
   B6 · Detección de familia ya cubierta: si una familia ya tiene un
   sitting REGISTRADO ese horario con otra niñera, avisa antes de
   registrar/asignar una niñera distinta para el mismo horario -- capaz
   se mandan dos niñeras a propósito, pero que quede la duda planteada.
   ============================================================ */
async function chequearFamiliaYaCubierta(familiaId, fecha, horaInicio, horaFin, nineraNombre, excluirRegId){
  if(!familiaId || !fecha || !horaInicio) return null;
  const { data } = await sb.from('sittings_traslados')
    .select('id,ninera_nombre,hora_inicio,hora_fin')
    .eq('familia_id', familiaId).eq('fecha', fecha);
  const key = normaliza(nineraNombre);
  for(const r of (data||[])){
    if(r.id===excluirRegId || normaliza(r.ninera_nombre||'')===key) continue;
    if(rangosSolapan(horaInicio, horaFin, r.hora_inicio, r.hora_fin)) return r;
  }
  return null;
}
async function avisarSiFamiliaYaCubierta(match, familiaNombre, textoBoton){
  if(!match) return true;
  return confirmarAccion(`${familiaNombre} ya tiene un sitting registrado ese horario con ${match.ninera_nombre} (${horaTxt(match.hora_inicio)}–${horaTxt(match.hora_fin)}). ¿Van dos niñeras a la vez, o es un error?`, textoBoton);
}

/* ============================================================
   B5 · Detección de sitting ya cargado: antes de guardar un sitting
   NUEVO, si ya existe un registro para la misma familia + niñera +
   fecha, avisa con acceso directo a editar ese en vez de crear uno
   nuevo por al lado. No bloquea -- puede ser un segundo turno real
   el mismo día (ej. mañana y noche).
   ============================================================ */
async function chequearRegistroExistenteMismoDia(nineraNombre, familiaId, fecha, excluirId){
  if(!familiaId || !fecha) return [];
  const { data } = await sb.from('sittings_traslados')
    .select('id,hora_inicio,hora_fin,cobro_familia,pago_ninera,ninera_nombre')
    .eq('familia_id', familiaId).eq('fecha', fecha);
  const key = normaliza(nineraNombre);
  return (data||[]).filter(r=> r.id!==excluirId && normaliza(r.ninera_nombre||'')===key);
}
/* Como confirmarAccion, pero con 3 salidas: 'cancelar' | 'ver' | 'continuar'.
   Si textoVer es null/vacío, no se muestra ese botón (queda en 2 vías). */
function confirmarAccionTresVias(mensaje, textoVer, textoContinuar){
  return new Promise((resolve)=>{
    const overlay = document.createElement('div');
    overlay.className = 'confirmoverlay';
    overlay.innerHTML = `
      <div class="confirmbox">
        <div class="confirmmsg">${escaparHtml(mensaje)}</div>
        <div class="confirmbtns" style="flex-wrap:wrap;">
          <button class="btn ghost" id="confirm3-cancelar">Cancelar</button>
          ${textoVer ? `<button class="btn" id="confirm3-ver">${escaparHtml(textoVer)}</button>` : ''}
          <button class="btn danger" id="confirm3-continuar">${escaparHtml(textoContinuar)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(()=>overlay.classList.add('show'));
    function cerrar(resultado){
      overlay.classList.remove('show');
      setTimeout(()=>overlay.remove(), 180);
      resolve(resultado);
    }
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) cerrar('cancelar'); });
    overlay.querySelector('#confirm3-cancelar').addEventListener('click', ()=>cerrar('cancelar'));
    if(textoVer) overlay.querySelector('#confirm3-ver').addEventListener('click', ()=>cerrar('ver'));
    overlay.querySelector('#confirm3-continuar').addEventListener('click', ()=>cerrar('continuar'));
  });
}
async function avisarSiDobleReserva(choque, nineraNombre, textoBoton){
  if(!choque) return true;
  const fechaTxt = choque.fecha ? ` el ${new Date(choque.fecha+'T00:00:00').toLocaleDateString('es-UY',{weekday:'long',day:'numeric',month:'long'})}` : '';
  return confirmarAccion(`${nineraNombre} ya está comprometida con ${choque.familia_nombre}${fechaTxt} de ${horaTxt(choque.hora_inicio)} a ${horaTxt(choque.hora_fin)}, que se pisa con este horario. ¿Seguir igual?`, textoBoton);
}

function confirmarAccion(mensaje, textoBoton='Eliminar'){
  return new Promise((resolve)=>{
    const overlay = document.createElement('div');
    overlay.className = 'confirmoverlay';
    overlay.innerHTML = `
      <div class="confirmbox">
        <div class="confirmmsg">${escaparHtml(mensaje)}</div>
        <div class="confirmbtns">
          <button class="btn ghost" id="confirm-no">Cancelar</button>
          <button class="btn danger" id="confirm-si">${escaparHtml(textoBoton)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(()=>overlay.classList.add('show'));
    function cerrar(resultado){
      overlay.classList.remove('show');
      setTimeout(()=>overlay.remove(), 180);
      resolve(resultado);
    }
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) cerrar(false); });
    overlay.querySelector('#confirm-no').addEventListener('click', ()=>cerrar(false));
    overlay.querySelector('#confirm-si').addEventListener('click', ()=>cerrar(true));
  });
}

// Si la foto de la ficha no carga (link de Drive sin permiso, por ejemplo), en su lugar
// queda un aviso con el link para abrirla. Se arma con el DOM: el link viene de la base.
function fotoNoSePudoMostrar(img, url){
  const aviso = document.createElement('div');
  aviso.className = 'helper';
  aviso.style.marginBottom = '12px';
  aviso.append('No se pudo mostrar la foto — ');
  const link = document.createElement('a');
  link.href = urlSegura(url) ? String(url).trim() : '#';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'abrirla en Drive';
  aviso.append(link, '.');
  img.replaceWith(aviso);
}
function abrirLightboxFoto(url, alt=''){
  if(!url) return;
  cerrarLightboxFoto(); // por si había uno colgado de antes
  const ov = document.createElement('div');
  ov.id = 'fotolightbox';
  ov.className = 'confirmoverlay';
  ov.style.zIndex = '400';
  ov.style.cursor = 'zoom-out';
  ov.innerHTML = `<img id="fotolightbox-img" src="${urlSegura(url)}" alt="${escaparHtml(alt)}" style="max-width:92vw;max-height:92vh;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.4);">
    <button class="modal-close" onclick="cerrarLightboxFoto()" aria-label="Cerrar" style="position:fixed;top:18px;right:22px;">×</button>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e)=>{ if(e.target===ov) cerrarLightboxFoto(); });
  requestAnimationFrame(()=>ov.classList.add('show'));
}
function cerrarLightboxFoto(){
  const ov = document.getElementById('fotolightbox');
  if(!ov) return;
  ov.style.pointerEvents = 'none'; // deja de bloquear clics apenas se empieza a cerrar
  ov.classList.remove('show');
  setTimeout(()=>{ ov.remove(); }, 200); // recién ahí lo saca del todo, cuando terminó la animación
}
let modalToken = 0;
// El fondo, la × y los "Cancelar" de un modal con cambios sin guardar preguntan antes de cerrar
// (21/10/2026): un toque de más afuera de la caja borraba una ficha entera. Se intercepta en la
// fase de captura, antes del onclick="cerrarModal()" del botón.
function crearOverlayModal(){
  const overlay = document.createElement('div');
  overlay.className = 'confirmoverlay';
  overlay.id = 'editmodal';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e)=>{
    const boton = e.target.closest('button');
    const esCerrar = e.target===overlay || (boton && boton.getAttribute('onclick')==='cerrarModal()');
    if(!esCerrar) return;
    e.stopPropagation(); e.preventDefault();
    cerrarModalPreguntando();
  }, true);
  return overlay;
}
// Al abrir un modal encima de otro: si el de antes se estaba guardando, su borrador se borra; si
// no, queda (se ofrece la próxima vez que se abra ese formulario).
function soltarModalAnterior(overlay){
  const clave = overlay.dataset.borrador;
  if(clave && guardandoActivo > 0) borrarBorrador(clave);
  delete overlay.dataset.borrador;
  marcarSinCambios('modal');
}
async function cerrarModalPreguntando(){
  if(formulariosConCambios.has('modal')
     && !(await confirmarAccion('Tenés cambios sin guardar. Si cerrás, se pierden.', 'Cerrar sin guardar'))) return;
  cerrarModal();
}
/* Lo que hay que soltar cuando el modal se cierra o se reemplaza por otro (30/10/2026, chat de la
   ficha de la niñera: su canal de Realtime vive mientras la ficha está a la vista). Uno solo a la
   vez: lo registra quien pinta el modal, después de abrirlo, y corre una sola vez. */
let alCerrarModalActual = null;
function alCerrarModal(fn){ alCerrarModalActual = fn; }
function soltarAlCerrarModal(){
  const fn = alCerrarModalActual;
  alCerrarModalActual = null;
  if(fn) try { fn(); } catch(e){ console.error('[modal] al cerrar', e); }
}
function abrirModal(html){
  soltarAlCerrarModal();
  modalToken++;
  let overlay = document.getElementById('editmodal');
  if(!overlay){
    overlay = crearOverlayModal();
  }
  soltarModalAnterior(overlay);
  overlay.innerHTML = `<div class="confirmbox wide"><button class="modal-close" onclick="cerrarModal()" aria-label="Cerrar">×</button>${html}</div>`;
  requestAnimationFrame(()=>overlay.classList.add('show'));
}
let modalNodoOrigen = null;
function abrirModalConNodo(node, headerHtml=''){
  soltarAlCerrarModal();
  modalToken++;
  let overlay = document.getElementById('editmodal');
  if(!overlay){
    overlay = crearOverlayModal();
  }
  soltarModalAnterior(overlay);
  modalNodoOrigen = { node, parent: node.parentNode, next: node.nextSibling };
  const box = document.createElement('div');
  box.className = 'confirmbox wide';
  box.innerHTML = `<button class="modal-close" onclick="cerrarModal()" aria-label="Cerrar">×</button>`;
  if(headerHtml) box.innerHTML += headerHtml;
  box.appendChild(node);
  overlay.innerHTML = '';
  overlay.appendChild(box);
  requestAnimationFrame(()=>overlay.classList.add('show'));
}
function cerrarModal(){
  soltarAlCerrarModal();
  const overlay = document.getElementById('editmodal');
  if(!overlay) return;
  // Se cerró porque se guardó o porque se eligió no guardar: el borrador ya no sirve.
  if(overlay.dataset.borrador) borrarBorrador(overlay.dataset.borrador);
  delete overlay.dataset.borrador;
  marcarSinCambios('modal');
  const myToken = modalToken;
  overlay.classList.remove('show');
  setTimeout(()=>{
    if(modalToken !== myToken) return; // se abrió un modal nuevo mientras este se cerraba — no lo pisemos
    if(modalNodoOrigen){
      const {node, parent, next} = modalNodoOrigen;
      if(parent){ parent.insertBefore(node, next); }
      modalNodoOrigen = null;
    }
    overlay.remove();
  }, 180);
}

/* columnas de candidatas que vienen del form / ficha (nombres = columnas reales de la tabla) */
const FICHA_CAMPOS = [
  {key:'nombre', label:'Nombre', hints:['nombre']},
  {key:'apellido', label:'Apellido', hints:['apellido']},
  {key:'edad', label:'Edad (texto viejo, sin fecha exacta)', hints:['edad']},
  {key:'fecha_nacimiento', label:'Fecha de nacimiento', hints:['fecha de nacimiento','nacimiento']},
  {key:'disponibilidad', label:'Disponibilidad', hints:['disponibilidad para hacer']},
  {key:'zona_sitting', label:'Zona en la que puede hacer sitting', hints:['que puede hacer sitting']},
  {key:'disponible_tipo', label:'Disponible para', hints:['disponible para realizar']},
  {key:'fechas_punta', label:'Fechas en Punta del Este', hints:['punta del este']},
  {key:'primeros_auxilios', label:'Curso primeros auxilios', hints:['primeros auxilio']},
  {key:'trabaja_actualmente', label:'Trabaja actualmente', hints:['trabajas actualmente']},
  {key:'cambia_panales', label:'Cambia pañales', hints:['panales']},
  {key:'dispone_traslados', label:'Dispuesta a traslados', hints:['traslado']},
  {key:'patologias', label:'Patologías / condiciones declaradas', hints:['patolog']},
  {key:'capacitacion_extra', label:'Capacitación extra', hints:['capacitacion']},
  {key:'comentarios', label:'Comentarios', hints:['comentario']},
  {key:'licencia', label:'Licencia de conducir', hints:['licencia']},
  {key:'mail', label:'Mail', hints:['mail','correo']},
  {key:'telefono', label:'Teléfono', hints:['telefono','celular']},
  {key:'universidad', label:'Universidad / qué estudia', hints:['universidad']},
  {key:'bachillerato', label:'Bachillerato / colegio', hints:['bachillerato']},
  {key:'cocina', label:'Cocina (escala 1-5)', hints:['cocina']},
  {key:'idiomas', label:'Idiomas', hints:['idioma']},
  {key:'experiencia', label:'Experiencia con niños', hints:['experiencia']},
  {key:'zona', label:'Zona en la que vive', hints:['vive']},
];

// Datos de la ficha de una candidata (o de la niñera que salió de ella) tal como quedaron
// después de la entrevista: lo que se corrigió o completó en la entrevista se guarda en
// notas_ficha y pisa a la respuesta original del formulario. Antes la ficha de la niñera y el
// pedido de CV leían solo la respuesta original, y lo cargado en la entrevista no se veía
// (05/10/2026: 12 niñeras contratadas tenían datos así).
function datosFichaCandidata(cd){
  const out = {...(cd||{})};
  const notas = (cd && cd.notas_ficha) || {};
  Object.entries(notas).forEach(([k, v])=>{ if(v!==null && v!==undefined && String(v).trim()!=='') out[k] = v; });
  return out;
}

const COMPETENCIAS = [
  {key:'responsabilidad', titulo:'Responsabilidad y puntualidad', preguntas:['Contame de una vez que tuviste que cambiar un plan personal porque te llamaron para cubrir un turno de urgencia. ¿Qué hiciste?','¿Cómo avisás si sabés que vas a llegar tarde o no vas a poder ir a un turno?']},
  {key:'seguridad', titulo:'Seguridad y manejo de imprevistos', preguntas:['Si un nene se cae y se lastima mientras estás sola con él, ¿qué es lo primero que hacés?','¿Qué harías si no podés comunicarte con los padres en una emergencia?']},
  {key:'limites', titulo:'Límites y disciplina positiva', preguntas:['Contame cómo manejás una rabieta fuerte de un nene de 3-4 años.','¿Qué opinás de poner límites firmes sin gritar ni castigar?']},
  {key:'experiencia', titulo:'Experiencia práctica y logística', preguntas:['Contame tu experiencia con nenes de la edad que buscamos. ¿Manejaste rutinas de sueño o comida?','Si el rol incluye traslados: ¿tenés carné vigente y experiencia manejando con niños en el auto?']},
  {key:'actitud', titulo:'Actitud y calidez', preguntas:['¿Qué te gusta de cuidar niños? Contame una anécdota linda.','¿Cómo te llevás con coordinar horarios por WhatsApp día a día?']},
  {key:'presentacion', titulo:'Presentación', preguntas:[], helper:'Impresión general: puntualidad, prolijidad, primera impresión.'},
  {key:'comunicacion', titulo:'Comunicación', preguntas:[], helper:'Claridad para expresarse, fluidez, cómo responde en la charla.'},
];
// Presentación y Comunicación se muestran aparte, justo antes de "Señales de alerta"
// (después de Explicación de juegos y Psicotécnico) — no junto al resto de competencias.
const COMP_FINALES_KEYS = ['presentacion','comunicacion'];
const COMP_PRINCIPALES = COMPETENCIAS.filter(c=>!COMP_FINALES_KEYS.includes(c.key));
const COMP_FINALES = COMPETENCIAS.filter(c=>COMP_FINALES_KEYS.includes(c.key));
// Preguntas de cada competencia: antes vivían fijas en COMPETENCIAS.preguntas, ahora se
// pueden agregar/editar/borrar desde la app (tabla entrevista_preguntas). Si todavía no
// cargó nada de la base, se usa lo que venía por default en COMPETENCIAS como respaldo.
let entrevistaPreguntasCache = null;
async function cargarEntrevistaPreguntas(){
  const { data } = await sb.from('entrevista_preguntas').select('*').order('orden');
  entrevistaPreguntasCache = data || [];
  return entrevistaPreguntasCache;
}
function preguntasDe(competenciaKey){
  if(entrevistaPreguntasCache){
    return entrevistaPreguntasCache.filter(p=>p.competencia_key===competenciaKey).map(p=>p.texto);
  }
  return COMPETENCIAS.find(c=>c.key===competenciaKey)?.preguntas || [];
}
function abrirModalEditarPreguntas(){
  const porCompetencia = key => (entrevistaPreguntasCache||[]).filter(p=>p.competencia_key===key).sort((a,b)=>a.orden-b.orden);
  const bloque = c => `
    <div style="margin-bottom:14px;">
      <div style="font-weight:600;margin-bottom:6px;">${c.titulo}</div>
      <div class="epregunta-list" data-competencia="${c.key}">
        ${porCompetencia(c.key).map(p=>`
          <div class="epregunta-row" data-id="${p.id}" style="display:flex;gap:6px;margin-bottom:6px;">
            <input type="text" class="ep-texto" value="${escaparHtml(p.texto)}" style="flex:1;">
            <button type="button" class="smallbtn danger" onclick="this.closest('.epregunta-row').remove()">Quitar</button>
          </div>`).join('')}
      </div>
      <button type="button" class="smallbtn" onclick="agregarFilaPreguntaEntrevista(${argJs(c.key)})">+ Agregar pregunta</button>
    </div>`;
  const html = `
    <h2>Editar preguntas de la entrevista</h2>
    <div class="helper">Se usan en la ficha de entrevista, agrupadas por competencia. Usá ¿...? en las que sean preguntas de verdad.</div>
    ${COMPETENCIAS.filter(c=>!COMP_FINALES_KEYS.includes(c.key)).map(bloque).join('')}
    <div id="epreguntas-warn"></div>
    <button class="btn primary" style="width:100%;" onclick="conGuardado(this, ()=>guardarPreguntasEntrevista())">Guardar</button>
  `;
  abrirModal(html);
}
function agregarFilaPreguntaEntrevista(key){
  const lista = document.querySelector(`.epregunta-list[data-competencia="${key}"]`);
  lista.insertAdjacentHTML('beforeend', `<div class="epregunta-row" data-id="" style="display:flex;gap:6px;margin-bottom:6px;">
    <input type="text" class="ep-texto" placeholder="¿...?" style="flex:1;">
    <button type="button" class="smallbtn danger" onclick="this.closest('.epregunta-row').remove()">Quitar</button>
  </div>`);
}
async function guardarPreguntasEntrevista(){
  const warn = document.getElementById('epreguntas-warn');
  const idsVistos = [];
  for(const lista of document.querySelectorAll('.epregunta-list')){
    const key = lista.dataset.competencia;
    const filas = [...lista.querySelectorAll('.epregunta-row')];
    for(let i=0;i<filas.length;i++){
      const texto = filas[i].querySelector('.ep-texto').value.trim();
      if(!texto) continue;
      const id = filas[i].dataset.id;
      if(id){
        const { error } = await sb.from('entrevista_preguntas').update({texto, orden:i}).eq('id', id);
        if(error){ warn.innerHTML = errBox(error); return; }
        idsVistos.push(id);
      } else {
        const { data, error } = await sb.from('entrevista_preguntas').insert({competencia_key:key, texto, orden:i}).select().single();
        if(error){ warn.innerHTML = errBox(error); return; }
        idsVistos.push(data.id);
      }
    }
  }
  const idsPrevios = (entrevistaPreguntasCache||[]).map(p=>p.id);
  for(const id of idsPrevios.filter(id=>!idsVistos.includes(id))){
    const { error } = await sb.from('entrevista_preguntas').delete().eq('id', id);
    if(error){ warn.innerHTML = errBox(error); await cargarEntrevistaPreguntas(); return; }
  }
  await cargarEntrevistaPreguntas();
  cerrarModal();
  if(typeof renderCompetencias==='function' && document.getElementById('competencias')) renderCompetencias();
  if(typeof renderCompetenciasFinales==='function' && document.getElementById('competencias-finales')) renderCompetenciasFinales();
  toast('Preguntas guardadas.');
}
const REDFLAGS = [
  {key:'tarde', texto:'Llegó tarde a la entrevista sin avisar', critico:false},
  {key:'malhabla', texto:'Habla mal de familias o trabajos anteriores sin matices', critico:false},
  {key:'sinref', texto:'No puede dar ni un contacto de referencia', critico:true},
  {key:'evade', texto:'Evade preguntas directas sobre por qué dejó el último trabajo', critico:false},
  {key:'inseguraseg', texto:'Se muestra insegura o evasiva ante preguntas básicas de seguridad', critico:true},
  {key:'despectiva', texto:'Actitud despectiva hacia límites o reglas puestas por la familia', critico:false},
];
const PSICO_IMGS = [
  {id:'p1', svg:`<svg viewBox="0 0 200 200"><rect width="200" height="200" fill="#fff"/><path d="M100 20 C60 40 40 80 60 110 C30 120 20 160 60 175 C90 190 110 170 100 150 C140 165 175 130 150 100 C180 85 170 45 135 45 C130 20 110 15 100 20Z" fill="#2C4A38" opacity="0.85"/></svg>`},
  {id:'p2', svg:`<svg viewBox="0 0 200 200"><rect width="200" height="200" fill="#fff"/><ellipse cx="100" cy="70" rx="55" ry="35" fill="#C97D42" opacity="0.85"/><ellipse cx="100" cy="140" rx="70" ry="40" fill="#35604A" opacity="0.7"/><circle cx="60" cy="60" r="14" fill="#B9862E"/><circle cx="140" cy="60" r="14" fill="#B9862E"/></svg>`},
  {id:'p3', svg:`<svg viewBox="0 0 200 200"><rect width="200" height="200" fill="#fff"/><path d="M100 15 L130 80 L190 90 L145 130 L160 190 L100 155 L40 190 L55 130 L10 90 L70 80 Z" fill="#52655A" opacity="0.8"/></svg>`},
];

/* ============================================================
   Que no se pierda lo escrito (21/10/2026). A Paulina y Delfina se les borró muchas veces la
   entrevista: la página se recargaba (el botón "Actualizar" al volver de un rato, o el
   navegador / el iPhone que descartan la pestaña en segundo plano), la sesión se cerraba desde
   otro dispositivo, cambiaban de pestaña o de sección, o tocaban "Vaciar formulario". Desde acá:
   - borrador en el dispositivo (localStorage) en cada cambio, por usuaria y por formulario, que
     se ofrece al volver a abrir ese formulario ("Tenés un borrador de hace X minutos");
   - registro de formularios con cambios sin guardar: el navegador avisa antes de cerrar o
     recargar, "Actualizar" pregunta y los modales no se cierran sin preguntar.
   El borrador se borra al guardar o al elegir descartarlo. Vence a los 14 días.
   ============================================================ */
const BORRADOR_PREFIJO = 'pb_borrador:';
const BORRADOR_VIGENCIA_DIAS = 14;
// La usuaria de la última sesión: al cerrarse la sesión todavía hay que guardar sus borradores.
let ultimaUsuariaBorrador = null;
function claveLocalBorrador(clave){
  const usuaria = session?.user?.id || ultimaUsuariaBorrador || 'sin-sesion';
  if(session?.user?.id) ultimaUsuariaBorrador = session.user.id;
  return `${BORRADOR_PREFIJO}${usuaria}:${clave}`;
}
function leerBorrador(clave){
  try{
    const raw = localStorage.getItem(claveLocalBorrador(clave));
    if(!raw) return null;
    const b = JSON.parse(raw);
    if(!b?.guardadoEl || Date.now() - new Date(b.guardadoEl).getTime() > BORRADOR_VIGENCIA_DIAS*864e5){
      localStorage.removeItem(claveLocalBorrador(clave));
      return null;
    }
    return b;
  }catch(e){ return null; }
}
function escribirBorrador(clave, datos){
  try{ localStorage.setItem(claveLocalBorrador(clave), JSON.stringify({ ...datos, guardadoEl: new Date().toISOString() })); return true; }
  catch(e){ console.error('[borrador] no se pudo guardar en el dispositivo', e); return false; }
}
function borrarBorrador(clave){
  cancelarBorradorPendiente(clave);
  try{ localStorage.removeItem(claveLocalBorrador(clave)); }catch(e){}
  borrarBorradorEnBase(clave);
}
// Pone un borrador tal cual (con su fecha), por ejemplo uno traído de la base.
function guardarBorradorTal(clave, datos){
  try{ localStorage.setItem(claveLocalBorrador(clave), JSON.stringify(datos)); }catch(e){}
}
/* Copia en la base (tabla borradores, 21/10/2026): cada 5 segundos como mucho mientras se
   escribe y al salir de cada campo. Sirve para seguir desde otro dispositivo, o si se borran los
   datos del navegador. Solo la entrevista. Sin la tabla (base sin migrar) queda solo el del
   dispositivo, sin avisos: es una red de seguridad, no un guardado. */
let borradoresEnBase = true;
const BORRADOR_BASE_CADA_MS = 5000;
const vaABase = clave => clave.startsWith('entrevista:') && !clave.includes('~');
const subidasBorrador = new Map(); // clave -> { timer, ultima }
const faltaTablaBorradores = error => !!error && (error.code==='PGRST205' || error.code==='42P01');
function programarBorradorEnBase(clave, armar, ahora=false){
  if(!borradoresEnBase || !vaABase(clave) || !session?.user?.id) return;
  const previa = subidasBorrador.get(clave) || {};
  clearTimeout(previa.timer);
  const subir = async ()=>{
    subidasBorrador.set(clave, { ultima: Date.now() });
    const datos = armar();
    if(!datos || !session?.user?.id) return;
    try{
      const { error } = await sb.from('borradores').upsert({ usuaria: session.user.id, clave, datos, actualizado_at: new Date().toISOString() }, { onConflict: 'usuaria,clave' });
      if(faltaTablaBorradores(error)) borradoresEnBase = false;
      else if(error) console.warn('[borrador] no se pudo copiar en la base:', error.message);
    }catch(e){ console.warn('[borrador] no se pudo copiar en la base:', e?.message || e); }
  };
  const espera = ahora ? 0 : Math.max(0, BORRADOR_BASE_CADA_MS - (Date.now() - (previa.ultima || 0)));
  subidasBorrador.set(clave, { ...previa, timer: setTimeout(subir, espera) });
}
function borrarBorradorEnBase(clave){
  const previa = subidasBorrador.get(clave);
  if(previa){ clearTimeout(previa.timer); subidasBorrador.delete(clave); }
  if(!borradoresEnBase || !vaABase(clave) || !session?.user?.id) return;
  sb.from('borradores').delete().eq('usuaria', session.user.id).eq('clave', clave)
    .then(({ error })=>{ if(faltaTablaBorradores(error)) borradoresEnBase = false; else if(error) console.warn('[borrador] no se pudo borrar en la base:', error.message); },
          e=>console.warn('[borrador] no se pudo borrar en la base:', e?.message || e));
}
// El borrador de la base de una clave, o el más nuevo cuyas claves empiecen con `prefijo`, como
// {clave, datos} con la fecha en datos.guardadoEl. null si no hay o no se puede leer.
async function traerBorradorDeLaBase({ clave, prefijo }){
  if(!borradoresEnBase || !session?.user?.id) return null;
  let q = sb.from('borradores').select('clave,datos,actualizado_at').eq('usuaria', session.user.id);
  q = clave ? q.eq('clave', clave) : q.like('clave', prefijo + '%').order('actualizado_at', { ascending:false }).limit(1);
  try{
    const { data, error } = await q;
    if(error){ if(faltaTablaBorradores(error)) borradoresEnBase = false; return null; }
    const f = (data||[])[0];
    return f ? { clave: f.clave, datos: { ...(f.datos||{}), guardadoEl: f.actualizado_at } } : null;
  }catch(e){ return null; }
}
// Si se empieza a escribir sin contestar "¿Recuperar?" / "¿Seguir?", lo nuevo no pisa el
// borrador que se está ofreciendo: ese se aparta a otra clave (con la misma fecha) y el aviso
// sigue apuntándole. Devuelve la clave nueva.
function apartarBorrador(clave){
  cancelarBorradorPendiente(clave);
  try{
    const raw = localStorage.getItem(claveLocalBorrador(clave));
    if(!raw) return null;
    const nueva = `${clave}~${Date.now()}`;
    localStorage.setItem(claveLocalBorrador(nueva), raw);
    localStorage.removeItem(claveLocalBorrador(clave));
    return nueva;
  }catch(e){ return null; }
}
// Borradores de esta usuaria cuya clave empieza con `prefijo`, el más nuevo primero.
function borradoresQueEmpiezanCon(prefijo){
  const base = claveLocalBorrador(prefijo);
  const lista = [];
  try{
    for(let i=0; i<localStorage.length; i++){
      const k = localStorage.key(i);
      if(!k || !k.startsWith(base)) continue;
      const clave = prefijo + k.slice(base.length);
      const datos = leerBorrador(clave);
      if(datos) lista.push({ clave, datos });
    }
  }catch(e){}
  return lista.sort((a,b)=>String(b.datos.guardadoEl).localeCompare(String(a.datos.guardadoEl)));
}
// Escrituras con una pausa corta (cada tecla no escribe), que se fuerzan antes de cambiar de
// sección, al irse a segundo plano o al cerrar la página.
const borradoresPendientes = new Map();
function programarBorrador(clave, armar, ms=400){
  cancelarBorradorPendiente(clave);
  const escribir = ()=>{ borradoresPendientes.delete(clave); const datos = armar(); if(datos) escribirBorrador(clave, datos); };
  borradoresPendientes.set(clave, { timer: setTimeout(escribir, ms), escribir });
}
function cancelarBorradorPendiente(clave){
  const p = borradoresPendientes.get(clave);
  if(p){ clearTimeout(p.timer); borradoresPendientes.delete(clave); }
}
function guardarBorradoresPendientes(){
  [...borradoresPendientes.values()].forEach(p=>{ clearTimeout(p.timer); p.escribir(); });
}
// Formularios con cambios sin guardar ('entrevista', 'modal').
const formulariosConCambios = new Set();
function marcarConCambios(clave){ formulariosConCambios.add(clave); }
function marcarSinCambios(clave){ formulariosConCambios.delete(clave); }
function hayCambiosSinGuardar(){ return formulariosConCambios.size > 0; }
window.addEventListener('beforeunload', (e)=>{
  guardarBorradoresPendientes();
  if(hayCambiosSinGuardar()){ e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('pagehide', guardarBorradoresPendientes);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') guardarBorradoresPendientes(); });
function textoHaceCuanto(iso){
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime())/60000));
  if(min < 1) return 'hace un momento';
  if(min < 60) return `hace ${min} minuto${min===1?'':'s'}`;
  const h = Math.round(min/60);
  if(h < 24) return `hace ${h} hora${h===1?'':'s'}`;
  const d = Math.round(h/24);
  return `hace ${d} día${d===1?'':'s'}`;
}
// Lo cargado en un formulario: cada campo con id (sin archivos, contraseñas ni campos
// deshabilitados) y las zonas de cada checklist de zonas. Alcanza para las fichas, el registro
// de sittings y la entrevista (que suma lo suyo sin id: psicotécnico, notas y puntajes).
function leerCamposFormulario(cont){
  const campos = {}, zonas = {};
  cont.querySelectorAll('input[id], textarea[id], select[id]').forEach(el=>{
    if(el.disabled || ['file','password','hidden','button','submit'].includes(el.type)) return;
    campos[el.id] = (el.type==='checkbox' || el.type==='radio') ? el.checked : el.value;
  });
  cont.querySelectorAll('[id$="-zonas-checklist"]').forEach(c=>{
    const prefijo = c.id.slice(0, -'-zonas-checklist'.length);
    zonas[prefijo] = leerZonasChecklist(prefijo);
  });
  return { campos, zonas };
}
// Vuelve a poner lo leído. Avisa a cada campo como si se hubiera escrito (input y change), así
// lo que depende de él se recalcula (la familia del registro, la edad, el precio); con
// avisar=false solo pone los valores (redibujar una parte sin que cuente como un cambio).
function ponerCamposFormulario(cont, { campos={}, zonas={} }={}, avisar=true){
  Object.entries(zonas).forEach(([prefijo, valor])=>{
    if(cont.querySelector(`#${CSS.escape(prefijo)}-zonas-field`)) setZonasChecklist(prefijo, valor);
  });
  Object.entries(campos).forEach(([id, valor])=>{
    const el = cont.querySelector('#'+CSS.escape(id));
    if(!el || el.disabled) return;
    if(el.type==='checkbox' || el.type==='radio') el.checked = !!valor; else el.value = valor ?? '';
    if(!avisar) return;
    el.dispatchEvent(new Event('input', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
  });
}
// Un modal largo (ficha de niñera o de familia, registro de sitting) con borrador propio. Se
// llama después de abrirlo y precargarlo. Si quedó un borrador de ese mismo formulario (se
// recargó la página o se cayó la sesión con cambios sin guardar), se ofrece recuperarlo.
function protegerModal(clave){
  const overlay = document.getElementById('editmodal');
  const box = overlay?.querySelector('.confirmbox');
  if(!box) return;
  overlay.dataset.borrador = clave;
  const previo = leerBorrador(clave);
  if(previo){
    const aviso = document.createElement('div');
    aviso.className = 'borrador-aviso'; aviso.id = 'modal-borrador-aviso'; aviso.setAttribute('role', 'status');
    aviso.dataset.clave = clave;
    aviso.innerHTML = `<div>Quedaron cambios sin guardar de ${textoHaceCuanto(previo.guardadoEl)}.</div>
      <div class="borrador-botones"><button type="button" class="btn primary" onclick="recuperarBorradorModal()">Recuperar</button>
      <button type="button" class="btn ghost" onclick="descartarBorradorModal()">Descartar</button></div>`;
    box.insertBefore(aviso, box.querySelector('.modal-close')?.nextSibling || box.firstChild);
  }
  const alCambiar = (e)=>{
    if(overlay.dataset.borrador!==clave || e.target.closest('#modal-borrador-aviso')) return;
    const aviso = document.getElementById('modal-borrador-aviso');
    if(aviso && aviso.dataset.clave===clave) aviso.dataset.clave = apartarBorrador(clave) || clave;
    marcarConCambios('modal');
    programarBorrador(clave, ()=>leerCamposFormulario(box));
  };
  box.addEventListener('input', alCambiar);
  box.addEventListener('change', alCambiar);
}
function recuperarBorradorModal(){
  const overlay = document.getElementById('editmodal');
  const aviso = document.getElementById('modal-borrador-aviso');
  const clave = aviso?.dataset.clave;
  const b = clave ? leerBorrador(clave) : null;
  aviso?.remove();
  if(!b){ toast('Ese borrador ya no está.', 'bad'); return; }
  ponerCamposFormulario(overlay.querySelector('.confirmbox'), b);
  if(clave !== overlay.dataset.borrador) borrarBorrador(clave); // lo recuperado ya se guarda con la clave del formulario
  toast('Listo: recuperaste lo que no se había guardado. Revisalo y tocá Guardar.');
}
async function descartarBorradorModal(){
  const aviso = document.getElementById('modal-borrador-aviso');
  const clave = aviso?.dataset.clave;
  if(!(await confirmarAccion('¿Descartar los cambios que no se guardaron?', 'Descartar'))) return;
  if(clave) borrarBorrador(clave);
  aviso?.remove();
}
