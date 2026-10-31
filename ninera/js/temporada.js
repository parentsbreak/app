// App de niñeras (fase 1, etapa 9, 31/10/2026): la tarjeta de la temporada en el inicio y la pantalla
// "¿Dónde vas a estar esta temporada?" (#temporada), donde la niñera marca dónde está cada quincena.
// Lee y escribe solo por ninera_mi_temporada() y ninera_guardar_temporada(p_lugares). Textos en "tú"
// (docs/fase1/textos.md 6). Nunca montos ni pagos.

// Las 8 quincenas que hay que marcar una por una (de la 1ra de diciembre a la 2da de marzo) y las 16
// del resto del año, de abril a noviembre, plegadas y en Montevideo. q = mes * 2 (+1 la segunda), sin
// año: el mismo número que usa el panel.
const QUINCENAS_VERANO_NINERA = [22, 23, 0, 1, 2, 3, 4, 5];
const QUINCENAS_RESTO_NINERA = Array.from({ length: 16 }, (_, i) => 6 + i);
// "Todo el verano en Punta": de la 2da de diciembre a la 2da de febrero, las quincenas en que veranean
// hoy (Diego, 31/10/2026).
const QUINCENAS_ATAJO_PUNTA_NINERA = [23, 0, 1, 2, 3];
// El orden de los botones de cada fila (textos.md, sección 6).
const OPCIONES_TEMPORADA_NINERA = ['punta', 'montevideo', 'la_paloma', 'fuera_pais', 'otro'];
const LARGO_OTRO_TEMPORADA = 80;

const FALLA_GUARDAR_TEMPORADA = 'No pudimos guardar tu temporada. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_ABRIR_TEMPORADA = 'No pudimos abrir tu temporada. Revisa tu conexión a internet y vuelve a intentar.';
const OTRO_TEMPORADA_VACIO = 'Escribe dónde vas a estar.';

// Lo marcado en la pantalla abierta: '' (sin elegir), un lugar fijo u 'otro' (con su texto aparte).
// Vive acá y no solo en los botones para no perderlo si guardar falla.
let temporadaMarcada = {};
let temporadaOtros = {};
// Base sin la migración de la etapa 9 (las RPC dan 404 PGRST202): ni tarjeta ni pantalla.
let temporadaNineraSinMigrar = false;

// {lugares, al_dia, solo_afuera}, o null con la base sin migrar (o sin ficha). Un error de red tira.
async function cargarTemporadaNinera(){
  const { data, error } = await sbn.rpc('ninera_mi_temporada');
  if(error){
    if(error.code === 'PGRST202'){ temporadaNineraSinMigrar = true; return null; }
    throw error;
  }
  temporadaNineraSinMigrar = false;
  return (Array.isArray(data) ? data[0] : data) || null;
}

// De setiembre a marzo, con el mes de todayISO() (Montevideo, no el del celular). El resto del año la
// temporada no se persigue; se puede entrar igual por el link de un aviso.
function esMesDeTemporadaNinera(){
  const mes = Number(todayISO().slice(5, 7));
  return mes >= 9 || mes <= 3;
}

function nombreQuincenaNinera(q){
  return `${q % 2 ? '2da' : '1ra'} quincena de ${TEMP_MESES_LARGO[q >> 1]}`;
}

/* ---- Tarjeta del inicio ---- */

// Se pide sin esperar a pintar el resto del inicio. Sin migrar o si la lectura falla no aparece
// nada, sin aviso: la pantalla de arriba no depende de esto.
async function cargarTarjetaTemporada(){
  if(!esMesDeTemporadaNinera() || temporadaNineraSinMigrar) return;
  let t;
  try{
    t = await cargarTemporadaNinera();
  }catch(e){
    console.error('[temporada] al leer', e);
    return;
  }
  const cont = document.getElementById('inicio-temporada');
  if(!t || !cont || !cont.isConnected) return;
  if(!t.al_dia){
    cont.innerHTML = `<section class="tarjeta-temporada">
      <h2>${escaparHtml(TITULO_TEMPORADA_NINERA)}</h2>
      <p class="helper">Marca dónde vas a estar cada quincena. Te lleva un minuto.</p>
      <button type="button" class="btn primary ancho" onclick="pantallaTemporadaNinera()">Marcar</button>
    </section>`;
    return;
  }
  const renglones = resumenLugaresTemporada(t.lugares);
  cont.innerHTML = `<section class="tarjeta-temporada">
    <h2>Tu temporada</h2>
    ${renglones.length
      ? `<ul class="temp-resumen">${renglones.map(r => `<li>${escaparHtml(r.etiqueta)}: ${escaparHtml(textoQuincenas(r.quincenas))}</li>`).join('')}</ul>`
      : '<p class="helper">Toda la temporada en Montevideo.</p>'}
    <button type="button" class="btn ghost ancho" onclick="pantallaTemporadaNinera()">Cambiar</button>
  </section>`;
}

/* ---- Pantalla #temporada ---- */

const TITULO_TEMPORADA_NINERA = '¿Dónde vas a estar esta temporada?';

function htmlFilaTemporada(q){
  const marcada = temporadaMarcada[q] || '';
  const botones = OPCIONES_TEMPORADA_NINERA.map(lugar =>
    `<button type="button" class="temp-op" aria-pressed="${marcada === lugar}" onclick="marcarLugarTemporada(${q}, ${argJs(lugar)})">${escaparHtml(LUGARES_TEMPORADA[lugar])}</button>`).join('');
  return `<div class="temp-fila" data-q="${q}">
    <p class="temp-fila-titulo">${escaparHtml(nombreQuincenaNinera(q))}</p>
    <div class="temp-opciones" role="group" aria-label="${escaparHtml(nombreQuincenaNinera(q))}">${botones}</div>
    <div class="temp-otro"${marcada === 'otro' ? '' : ' hidden'}>
      <label for="temp-otro-${q}">¿Dónde?</label>
      <input type="text" id="temp-otro-${q}" maxlength="${LARGO_OTRO_TEMPORADA}" autocomplete="off" value="${escaparHtml(temporadaOtros[q] || '')}" oninput="escribirOtroTemporada(${q}, this.value)">
    </div>
  </div>`;
}

// Lo que ya cargó (al día) o la partida: las 8 de verano sin elegir y el resto del año en Montevideo
// (en Punta si vive solo en zonas de afuera, para no desaparecer de ahí de abril a noviembre).
function precargarTemporadaNinera(t){
  temporadaMarcada = {};
  temporadaOtros = {};
  for(let q = 0; q < 24; q++){
    const v = t.al_dia && t.lugares ? t.lugares[String(q)] : null;
    if(v && typeof v === 'object' && typeof v.otro === 'string'){ temporadaMarcada[q] = 'otro'; temporadaOtros[q] = v.otro; }
    else if(typeof v === 'string' && LUGARES_TEMPORADA[v]) temporadaMarcada[q] = v;
    else if(t.al_dia) temporadaMarcada[q] = 'montevideo';
    else temporadaMarcada[q] = QUINCENAS_VERANO_NINERA.includes(q) ? '' : (t.solo_afuera ? 'punta' : 'montevideo');
  }
}

async function pantallaTemporadaNinera(){
  let t;
  try{
    t = await cargarTemporadaNinera();
  }catch(e){
    console.error('[temporada] al abrir', e);
    toast(FALLA_ABRIR_TEMPORADA, 'bad');
    // Abierta por un link y sin pantalla de dónde volver: al inicio.
    if(rutaActual() !== '#inicio') await renderInicio();
    return;
  }
  if(!t){ await renderInicio(); return; }
  precargarTemporadaNinera(t);
  marcarRuta('#temporada');
  pintar(`<main class="pantalla">
    <header class="cabecera">
      <img src="../logo-simbolo.png" alt="" class="cabecera-simbolo">
      <h1>${escaparHtml(TITULO_TEMPORADA_NINERA)}</h1>
    </header>
    <p class="helper">Marca dónde vas a estar cada quincena.</p>
    <button type="button" class="btn ghost ancho" onclick="todoElVeranoEnPunta()">Todo el verano en Punta</button>
    <div class="temp-filas">${QUINCENAS_VERANO_NINERA.map(htmlFilaTemporada).join('')}</div>
    <button type="button" class="link-boton" id="temp-resto-boton" aria-expanded="false" aria-controls="temp-resto" onclick="alternarRestoTemporada()">Ver el resto del año</button>
    <div class="temp-filas" id="temp-resto" hidden>${QUINCENAS_RESTO_NINERA.map(htmlFilaTemporada).join('')}</div>
    <p class="error-form" id="temporada-error" role="alert"></p>
    <button class="btn primary ancho" onclick="conGuardado(this, ()=>guardarTemporadaNinera())">Guardar</button>
    <button type="button" class="link-boton" onclick="renderInicio()">Volver</button>
  </main>`);
}

function alternarRestoTemporada(){
  const resto = document.getElementById('temp-resto');
  const boton = document.getElementById('temp-resto-boton');
  if(!resto || !boton) return;
  resto.hidden = !resto.hidden;
  boton.setAttribute('aria-expanded', String(!resto.hidden));
  boton.textContent = resto.hidden ? 'Ver el resto del año' : 'Ocultar el resto del año';
}

// Repinta solo los botones y el campo de esa fila: el texto de "Otro" de las demás no se toca.
function pintarFilaTemporada(q){
  const f = document.querySelector(`.temp-fila[data-q="${q}"]`);
  if(!f) return;
  const marcada = temporadaMarcada[q] || '';
  f.querySelectorAll('.temp-op').forEach((b, i) => b.setAttribute('aria-pressed', String(OPCIONES_TEMPORADA_NINERA[i] === marcada)));
  const otro = f.querySelector('.temp-otro');
  if(otro) otro.hidden = marcada !== 'otro';
  f.classList.remove('falta');
}

function marcarLugarTemporada(q, lugar){
  temporadaMarcada[q] = lugar;
  pintarFilaTemporada(q);
  if(lugar === 'otro'){ const campo = document.getElementById(`temp-otro-${q}`); if(campo) campo.focus(); }
}

function escribirOtroTemporada(q, valor){
  temporadaOtros[q] = valor;
  const f = document.querySelector(`.temp-fila[data-q="${q}"]`);
  if(f) f.classList.remove('falta');
}

// Marca Punta de la 2da de diciembre a la 2da de febrero y deja el resto como estaba.
function todoElVeranoEnPunta(){
  QUINCENAS_ATAJO_PUNTA_NINERA.forEach(q => { temporadaMarcada[q] = 'punta'; pintarFilaTemporada(q); });
}

// Con alguna de las 8 sin elegir o un "Otro" sin texto no se llama a la base: se marcan las filas y el
// aviso dice qué falta. Si guardar falla, el aviso queda arriba del botón y lo marcado sigue ahí.
async function guardarTemporadaNinera(){
  const aviso = document.getElementById('temporada-error');
  if(!aviso) return;
  aviso.textContent = '';
  document.querySelectorAll('.temp-fila.falta').forEach(f => f.classList.remove('falta'));
  const faltan = QUINCENAS_VERANO_NINERA.filter(q => !temporadaMarcada[q]);
  if(faltan.length){
    faltan.forEach(q => document.querySelector(`.temp-fila[data-q="${q}"]`)?.classList.add('falta'));
    aviso.textContent = faltan.length === 1 ? 'Te falta marcar 1 quincena.' : `Te falta marcar ${faltan.length} quincenas.`;
    document.querySelector(`.temp-fila[data-q="${faltan[0]}"]`)?.scrollIntoView({ block: 'center' });
    return;
  }
  const lugares = {};
  for(let q = 0; q < 24; q++){
    if(temporadaMarcada[q] !== 'otro'){ lugares[String(q)] = temporadaMarcada[q]; continue; }
    const texto = (temporadaOtros[q] || '').trim();
    if(!texto){
      const resto = document.getElementById('temp-resto');
      if(resto && resto.hidden && QUINCENAS_RESTO_NINERA.includes(q)) alternarRestoTemporada();
      document.querySelector(`.temp-fila[data-q="${q}"]`)?.classList.add('falta');
      aviso.textContent = OTRO_TEMPORADA_VACIO;
      const campo = document.getElementById(`temp-otro-${q}`);
      if(campo) campo.focus();
      return;
    }
    lugares[String(q)] = { otro: texto };
  }
  try{
    const { error } = await sbn.rpc('ninera_guardar_temporada', { p_lugares: lugares });
    if(error) throw error;
  }catch(e){
    console.error('[temporada] al guardar', e);
    const motivo = (e && e.message) || '';
    aviso.textContent = /no_autorizada/.test(motivo) ? CUENTA_NO_ACTIVA : FALLA_GUARDAR_TEMPORADA;
    return;
  }
  toast('¡Listo! Guardamos tu temporada.');
  await renderInicio();
}
