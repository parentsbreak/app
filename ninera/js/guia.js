// App de niñeras (fase 1, etapa 4, 02/11/2026): la guía obligatoria y la firma anual (decisiones.md 4.6 a
// 4.9 y 8). El contenido es ninera/guia/contenido.json (la guía de Paulina, sale de guia-original.html con
// scripts/guia-desde-html.mjs; el texto queda en voseo, como el publicado). La base guarda lo leído, los
// repasos aprobados y la firma (ninera_estado_guia, ninera_marcar_leida, ninera_aprobar_repaso,
// ninera_firmar_guia). Protocolos y RCP son obligatorios: sin terminarlos y firmar no llegan pedidos. Todo en
// una sola ruta, #guia (el link de los avisos). Textos en "tú".

let guiaContenidoPromesa = null;
let guiaEstadoNinera = null;
// Base sin la migración de la etapa 4 (las RPC dan 404 PGRST202): ni tarjeta ni pantalla.
let guiaNineraSinMigrar = false;
// Lo respondido en el repaso que está en pantalla: índice de la pregunta -> opción elegida.
let repasoRespuestas = {};
let firmaTrazada = false;

const FALLA_ABRIR_GUIA = 'No pudimos abrir la guía. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_GUARDAR_GUIA = 'No pudimos guardarlo. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_SUBIR_FIRMA = 'No pudimos subir tu firma. Revisa tu conexión a internet y vuelve a intentar.';
const TEXTO_GUIA_OBLIGATORIA = 'Antes de tu primer sitting. Lee Protocolos, RCP y primeros auxilios y responde el repaso.';
const DECLARACION_FIRMA = "Leí y entendí la guía de Protocolos y RCP y primeros auxilios de Parents' Break.";

// El contenido se baja una vez por apertura (si falla, la próxima vez se reintenta).
function cargarContenidoGuia(){
  if(!guiaContenidoPromesa){
    guiaContenidoPromesa = fetch('guia/contenido.json', { cache: 'no-cache' }).then(r => {
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    guiaContenidoPromesa.catch(() => { guiaContenidoPromesa = null; });
  }
  return guiaContenidoPromesa;
}

// La fila de ninera_estado_guia(), o null con la base sin migrar (o sin ficha). Un error de red tira.
async function cargarEstadoGuia(){
  const { data, error } = await sbn.rpc('ninera_estado_guia');
  if(error){
    if(error.code === 'PGRST202'){ guiaNineraSinMigrar = true; return null; }
    throw error;
  }
  guiaNineraSinMigrar = false;
  guiaEstadoNinera = (Array.isArray(data) ? data[0] : data) || null;
  return guiaEstadoNinera;
}

// dd/mm de un 'AAAA-MM-DD' (la fecha ya es de Montevideo: la arma la base).
function fechaGuiaNinera(iso){ return iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : ''; }
// "Tienes hasta el" dice el día anterior a `hasta`: el plazo vence ese día a la hora en que activó la app, así que
// ese día ya no lo tiene completo (orquestador, 02/11/2026). La base sigue devolviendo el día del vencimiento.
function ultimoDiaGuiaNinera(hasta){ return hasta ? fechaGuiaNinera(sumarDiasISO(String(hasta).slice(0, 10), -1)) : ''; }

// Lo leído que cuenta: en los obligatorios, sin la firma vigente, solo lo del ciclo nuevo (después de la última
// firma: hay que releer para firmar de nuevo); en el resto, lo leído alguna vez.
function leidasGuia(modulo, e){
  return new Set(modulo.obligatorio && !e.firma_vigente ? (e.lecciones_ciclo || []) : (e.lecciones_leidas || []));
}
function repasoAprobadoGuia(modulo, e){
  return (modulo.obligatorio && !e.firma_vigente ? (e.repasos_ciclo || []) : (e.repasos_aprobados || [])).includes(modulo.id);
}
function moduloTerminadoGuia(modulo, e){
  const leidas = leidasGuia(modulo, e);
  return modulo.lecciones.every(l => leidas.has(l.id)) && (!modulo.repaso.length || repasoAprobadoGuia(modulo, e));
}

// Qué decirle según el estado (decisiones 8, textos.md 6), o null si está al día.
function avisoGuiaNinera(e){
  if(!e) return null;
  if(e.firma_vigente) return null;
  if(e.completa) return { titulo: 'Ya leíste todo', texto: 'Solo te falta firmar.', boton: 'Firmar', accion: 'pantallaFirmaGuia()' };
  if(e.ultima_firma){
    const texto = e.motivo === 'gracia'
      ? `Hace un año que hiciste Protocolos y RCP. Repásalos y firma de nuevo antes del ${fechaGuiaNinera(e.hasta)} para seguir recibiendo pedidos.`
      : 'Hace un año que hiciste Protocolos y RCP. Hasta que los repases y firmes de nuevo no te llegarán pedidos.';
    return { titulo: 'Repasa la guía', texto, boton: 'Repasar', accion: 'pantallaGuiaNinera()' };
  }
  const hasta = e.motivo === 'plazo' ? `Tienes hasta el ${ultimoDiaGuiaNinera(e.hasta)} para completarla.` : 'Hasta que lo termines no te llegarán pedidos.';
  const empezo = (e.lecciones_ciclo || []).length > 0 || (e.repasos_ciclo || []).length > 0;
  return { titulo: 'Guía obligatoria', texto: `${TEXTO_GUIA_OBLIGATORIA} ${hasta}`, boton: empezo ? 'Seguir' : 'Empezar', accion: 'pantallaGuiaNinera()' };
}

/* ---- Tarjeta del inicio ---- */

// Se pide sin esperar a pintar el resto del inicio. Sin migrar o si la lectura falla no aparece nada: la
// pantalla de arriba no depende de esto.
async function cargarTarjetaGuia(){
  try{
    if(guiaNineraSinMigrar) return;
    let e;
    try{
      e = await cargarEstadoGuia();
    }catch(err){
      console.error('[guía] al leer', err);
      return;
    }
    const cont = document.getElementById('inicio-guia');
    const aviso = avisoGuiaNinera(e);
    if(!cont || !cont.isConnected) return;
    if(!aviso){ if(guiaNineraSinMigrar){ document.getElementById('inicio-boton-guia')?.remove(); } return; }
    cont.innerHTML = `<section class="tarjeta-guia" role="status">
      <h2>${escaparHtml(aviso.titulo)}</h2>
      <p>${escaparHtml(aviso.texto)}</p>
      <button type="button" class="btn primary ancho" onclick="${aviso.accion}">${escaparHtml(aviso.boton)}</button>
    </section>`;
  }finally{
    // Marca de que la carga terminó (con tarjeta o sin ella): los tests esperan esto.
    const cont = document.getElementById('inicio-guia');
    if(cont) cont.setAttribute('data-cargada', '1');
    if(guiaNineraSinMigrar) document.getElementById('inicio-boton-guia')?.remove();
  }
}

/* ---- Pantallas (todas en #guia) ---- */

function cabeceraGuia(titulo){
  return `<header class="cabecera">
      <img src="../logo-simbolo.png" alt="" class="cabecera-simbolo">
      <h1>${escaparHtml(titulo)}</h1>
    </header>`;
}

// Carga el contenido y el estado; si algo falla, avisa y vuelve al inicio. Devuelve { guia, e } o null.
async function cargarGuiaParaPantalla(){
  let guia, e;
  try{
    [guia, e] = await Promise.all([cargarContenidoGuia(), cargarEstadoGuia()]);
  }catch(err){
    console.error('[guía] al abrir', err);
    toast(FALLA_ABRIR_GUIA, 'bad');
    if(rutaActual() !== '#inicio') await renderInicio();
    return null;
  }
  if(!e){ await renderInicio(); return null; }
  return { guia, e };
}

// El índice, por grupo ("Antes de ir", "Por edad", "Necesidades especiales").
async function pantallaGuiaNinera(){
  const cargada = await cargarGuiaParaPantalla();
  if(!cargada) return;
  const { guia, e } = cargada;
  const aviso = avisoGuiaNinera(e);
  const grupos = [];
  guia.modulos.forEach(m => {
    let g = grupos.find(x => x.nombre === m.grupo);
    if(!g){ g = { nombre: m.grupo, modulos: [] }; grupos.push(g); }
    g.modulos.push(m);
  });
  marcarRuta('#guia');
  pintar(`<main class="pantalla pantalla-guia">
    ${cabeceraGuia('Guía')}
    ${aviso ? `<div class="guia-estado" role="status"><p><b>${escaparHtml(aviso.titulo)}.</b> ${escaparHtml(aviso.texto)}</p></div>` : '<p class="helper">Tu guía está al día.</p>'}
    ${grupos.map(g => `<section class="guia-grupo">
      <h2>${escaparHtml(g.nombre)}</h2>
      ${g.modulos.map(m => {
        const leidas = leidasGuia(m, e);
        const n = m.lecciones.filter(l => leidas.has(l.id)).length;
        const listo = moduloTerminadoGuia(m, e);
        return `<button type="button" class="guia-modulo" data-modulo="${escaparHtml(m.id)}" onclick="pantallaModuloGuia(${argJs(m.id)})">
          <span class="guia-modulo-nombre">${escaparHtml(m.nombre)}${m.obligatorio ? ' <span class="guia-obligatorio">Obligatorio</span>' : ''}</span>
          <span class="guia-modulo-detalle">${escaparHtml(m.edad)}</span>
          <span class="guia-modulo-avance">${listo ? '✓ Terminado' : escaparHtml(`${n} de ${m.lecciones.length} leídas`)}</span>
        </button>`;
      }).join('')}
    </section>`).join('')}
    ${e.completa && !e.firma_vigente ? '<button type="button" class="btn primary ancho" onclick="pantallaFirmaGuia()">Firmar la guía</button>' : ''}
    <button type="button" class="link-boton" onclick="renderInicio()">Volver</button>
  </main>`);
}

async function pantallaModuloGuia(moduloId){
  const cargada = await cargarGuiaParaPantalla();
  if(!cargada) return;
  const { guia, e } = cargada;
  const m = guia.modulos.find(x => x.id === moduloId);
  if(!m) return pantallaGuiaNinera();
  const leidas = leidasGuia(m, e);
  const aprobado = repasoAprobadoGuia(m, e);
  marcarRuta('#guia');
  pintar(`<main class="pantalla pantalla-guia">
    ${cabeceraGuia(m.nombre)}
    <p class="helper">${escaparHtml(m.edad)}</p>
    ${m.intro ? `<p>${escaparHtml(m.intro)}</p>` : ''}
    <div class="guia-lecciones">
      ${m.lecciones.map((l, i) => `<button type="button" class="guia-leccion-fila" data-leccion="${escaparHtml(l.id)}" onclick="pantallaLeccionGuia(${argJs(m.id)}, ${argJs(l.id)})">
        <span class="guia-leccion-num">${leidas.has(l.id) ? '✓' : i + 1}</span>
        <span><b>${escaparHtml(l.titulo)}</b>${l.subtitulo ? `<small>${escaparHtml(l.subtitulo)}</small>` : ''}</span>
      </button>`).join('')}
    </div>
    ${m.repaso.length ? `<button type="button" class="btn ${aprobado ? 'ghost' : 'primary'} ancho" onclick="pantallaRepasoGuia(${argJs(m.id)})">${aprobado ? '✓ Repaso aprobado (hacerlo de nuevo)' : 'Hacer el repaso'}</button>` : ''}
    <button type="button" class="link-boton" onclick="pantallaGuiaNinera()">Volver a la guía</button>
  </main>`);
}

// El HTML de la lección es contenido del repo (la guía), no datos de nadie: va con innerHTML (decisiones 8). Las de
// actividades traen sus juegos (`juegos`, juegos.js) debajo del texto, como el original. Con sittingId (abierta desde
// "Para este sitting", etapa 12) vuelve ahí y queda en su ruta.
async function pantallaLeccionGuia(moduloId, leccionId, { sittingId } = {}){
  let guia;
  try{
    guia = await cargarContenidoGuia();
  }catch(err){
    console.error('[guía] al abrir la lección', err);
    toast(FALLA_ABRIR_GUIA, 'bad');
    return;
  }
  const m = guia.modulos.find(x => x.id === moduloId);
  const l = m && m.lecciones.find(x => x.id === leccionId);
  if(!l) return sittingId ? pantallaParaSitting(sittingId) : pantallaGuiaNinera();
  marcarRuta(sittingId ? `#sitting/${sittingId}/guia` : '#guia');
  const desde = sittingId ? `, ${argJs(sittingId)}` : '';
  pintar(`<main class="pantalla pantalla-guia">
    ${cabeceraGuia(l.titulo)}
    ${sittingId ? `<p class="helper guia-desde-sitting">${escaparHtml(m.nombre)}, ${escaparHtml(m.edad)}</p>` : ''}
    ${l.subtitulo ? `<p class="helper">${escaparHtml(l.subtitulo)}</p>` : ''}
    <article class="guia-leccion" id="guia-leccion"></article>
    <div id="guia-kit"></div>
    <p class="error-form" id="guia-error" role="alert"></p>
    <button type="button" class="btn primary ancho" onclick="conGuardado(this, ()=>marcarLeidaGuia(${argJs(m.id)}, ${argJs(l.id)}${desde}))">Ya lo leí</button>
    ${sittingId
      ? `<button type="button" class="link-boton" onclick="pantallaParaSitting(${argJs(sittingId)})">Volver a Para este sitting</button>`
      : `<button type="button" class="link-boton" onclick="pantallaModuloGuia(${argJs(m.id)})">Volver a ${escaparHtml(m.nombre)}</button>`}
  </main>`);
  document.getElementById('guia-leccion').innerHTML = l.html;
  montarKitJuegos(document.getElementById('guia-kit'), l.juegos);
  window.scrollTo(0, 0);
}

// Anota la lección y sigue con la próxima del módulo (o vuelve al módulo si era la última); abierta desde "Para este
// sitting" (sittingId), vuelve ahí. Si falla, el aviso queda arriba del botón para reintentar. El aviso no se borra al
// empezar: si se borrara, la pantalla subiría y un segundo toque rápido caería en "Volver" (02/11/2026, lo encontró
// el test del doble toque).
async function marcarLeidaGuia(moduloId, leccionId, sittingId){
  const aviso = document.getElementById('guia-error');
  let guia;
  try{
    guia = await cargarContenidoGuia();
    const { error } = await sbn.rpc('ninera_marcar_leida', { p_leccion_id: leccionId, p_version: guia.version });
    if(error) throw error;
  }catch(err){
    console.error('[guía] al marcar leída', err);
    if(aviso) aviso.textContent = /no_autorizada/.test(err?.message || '') ? CUENTA_NO_ACTIVA : FALLA_GUARDAR_GUIA;
    return;
  }
  if(sittingId) return pantallaParaSitting(sittingId);
  const m = guia.modulos.find(x => x.id === moduloId);
  const i = m.lecciones.findIndex(x => x.id === leccionId);
  if(i >= 0 && i < m.lecciones.length - 1) return pantallaLeccionGuia(moduloId, m.lecciones[i + 1].id);
  return pantallaModuloGuia(moduloId);
}

/* ---- Repaso: todas bien para aprobarlo, reintentos libres y la explicación al instante (decisiones 4.6) ---- */

async function pantallaRepasoGuia(moduloId){
  let guia;
  try{
    guia = await cargarContenidoGuia();
  }catch(err){
    console.error('[guía] al abrir el repaso', err);
    toast(FALLA_ABRIR_GUIA, 'bad');
    return;
  }
  const m = guia.modulos.find(x => x.id === moduloId);
  if(!m || !m.repaso.length) return pantallaGuiaNinera();
  repasoRespuestas = {};
  marcarRuta('#guia');
  pintar(`<main class="pantalla pantalla-guia">
    ${cabeceraGuia(`Repaso: ${m.nombre}`)}
    <p class="helper">Elige una respuesta en cada pregunta. Para aprobar, todas tienen que estar bien.</p>
    ${m.repaso.map((r, i) => `<fieldset class="guia-pregunta" data-pregunta="${i}">
      <legend>${escaparHtml(r.q)}</legend>
      ${r.o.map((op, j) => `<button type="button" class="guia-opcion" aria-pressed="false" data-opcion="${j}" onclick="responderRepasoGuia(${argJs(m.id)}, ${i}, ${j})">${escaparHtml(op)}</button>`).join('')}
      <p class="guia-explicacion" id="guia-explicacion-${i}" aria-live="polite"></p>
    </fieldset>`).join('')}
    <p class="error-form" id="guia-error" role="alert"></p>
    <button type="button" class="btn primary ancho" id="guia-terminar-repaso" disabled onclick="conGuardado(this, ()=>aprobarRepasoGuia(${argJs(m.id)}))">Terminar el repaso</button>
    <button type="button" class="link-boton" onclick="pantallaModuloGuia(${argJs(m.id)})">Volver a ${escaparHtml(m.nombre)}</button>
  </main>`);
}

function responderRepasoGuia(moduloId, i, j){
  cargarContenidoGuia().then(g => {
    const m = g.modulos.find(x => x.id === moduloId);
    const r = m && m.repaso[i];
    if(!r) return;
    repasoRespuestas[i] = j;
    const caja = document.querySelector(`.guia-pregunta[data-pregunta="${i}"]`);
    if(!caja) return;
    caja.querySelectorAll('.guia-opcion').forEach(b => {
      const k = Number(b.dataset.opcion);
      b.setAttribute('aria-pressed', String(k === j));
      b.classList.toggle('bien', k === j && j === r.a);
      b.classList.toggle('mal', k === j && j !== r.a);
    });
    const exp = document.getElementById(`guia-explicacion-${i}`);
    if(exp){
      exp.className = 'guia-explicacion ' + (j === r.a ? 'bien' : 'mal');
      exp.textContent = `${j === r.a ? 'Bien.' : 'No es esa.'} ${r.e}`;
    }
    const todasBien = m.repaso.every((x, k) => repasoRespuestas[k] === x.a);
    const boton = document.getElementById('guia-terminar-repaso');
    if(boton && !boton.dataset.guardando) boton.disabled = !todasBien;
  });
}

async function aprobarRepasoGuia(moduloId){
  const aviso = document.getElementById('guia-error'); // no se borra al empezar (ver marcarLeidaGuia)
  let guia;
  try{
    guia = await cargarContenidoGuia();
    const m = guia.modulos.find(x => x.id === moduloId);
    // Por las dudas: solo con todas bien (el botón ya está gris si no).
    if(!m || !m.repaso.every((x, k) => repasoRespuestas[k] === x.a)) return;
    const { error } = await sbn.rpc('ninera_aprobar_repaso', { p_modulo_id: moduloId, p_version: guia.version });
    if(error) throw error;
  }catch(err){
    console.error('[guía] al aprobar el repaso', err);
    if(aviso) aviso.textContent = /no_autorizada/.test(err?.message || '') ? CUENTA_NO_ACTIVA : FALLA_GUARDAR_GUIA;
    return;
  }
  toast('¡Repaso aprobado!');
  const e = await cargarEstadoGuia().catch(() => null);
  // Con Protocolos y RCP terminados, directo a firmar.
  if(e && e.completa && !e.firma_vigente) return pantallaFirmaGuia();
  return pantallaModuloGuia(moduloId);
}

/* ---- Firma anual (decisiones 4.7): la declaración, el nombre tipeado y la firma dibujada con el dedo ---- */

async function pantallaFirmaGuia(){
  const cargada = await cargarGuiaParaPantalla();
  if(!cargada) return;
  const { e } = cargada;
  if(e.firma_vigente || !e.completa) return pantallaGuiaNinera();
  firmaTrazada = false;
  marcarRuta('#guia');
  pintar(`<main class="pantalla pantalla-guia">
    ${cabeceraGuia('Firma de la guía')}
    <p class="helper">Una vez por año confirmas que leíste Protocolos y RCP.</p>
    <label class="chk guia-declaracion"><input type="checkbox" id="firma-declaracion"> ${escaparHtml(DECLARACION_FIRMA)}</label>
    <div class="field">
      <label for="firma-nombre">Tu nombre completo</label>
      <input type="text" id="firma-nombre" maxlength="120" autocomplete="name">
    </div>
    <div class="field">
      <label for="firma-lienzo">Firma con el dedo</label>
      <canvas id="firma-lienzo" class="firma-lienzo" aria-label="Espacio para firmar"></canvas>
      <button type="button" class="link-boton" onclick="borrarFirmaGuia()">Borrar la firma</button>
    </div>
    <p class="error-form" id="guia-error" role="alert"></p>
    <button type="button" class="btn primary ancho" onclick="conGuardado(this, ()=>firmarGuia())">Firmar</button>
    <button type="button" class="link-boton" onclick="pantallaGuiaNinera()">Volver a la guía</button>
  </main>`);
  prepararLienzoFirma();
}

// El lienzo con el tamaño real en el celular (más nítido) y fondo blanco. Dibuja con el dedo o el mouse.
function prepararLienzoFirma(){
  const lienzo = document.getElementById('firma-lienzo');
  if(!lienzo) return;
  const escala = Math.min(window.devicePixelRatio || 1, 2);
  lienzo.width = Math.round((lienzo.clientWidth || 300) * escala);
  lienzo.height = Math.round((lienzo.clientHeight || 180) * escala);
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.strokeStyle = '#1c1c28';
  ctx.lineWidth = 2.5 * escala;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let dibujando = false;
  const punto = ev => {
    const r = lienzo.getBoundingClientRect();
    return [(ev.clientX - r.left) * lienzo.width / r.width, (ev.clientY - r.top) * lienzo.height / r.height];
  };
  lienzo.addEventListener('pointerdown', ev => {
    dibujando = true;
    lienzo.setPointerCapture?.(ev.pointerId);
    const [x, y] = punto(ev);
    ctx.beginPath();
    ctx.moveTo(x, y);
  });
  lienzo.addEventListener('pointermove', ev => {
    if(!dibujando) return;
    const [x, y] = punto(ev);
    ctx.lineTo(x, y);
    ctx.stroke();
    firmaTrazada = true;
  });
  const soltar = () => { dibujando = false; };
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);
}

function borrarFirmaGuia(){
  const lienzo = document.getElementById('firma-lienzo');
  if(!lienzo) return;
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  firmaTrazada = false;
}

// Primero la imagen (a firmas/<su id>/<hoy>.png: la única ruta que la base le deja usar) y después la firma.
// Si algo falla, el aviso queda arriba del botón y lo escrito y dibujado siguen ahí para reintentar (la imagen
// del mismo día se pisa, nunca quedan sueltas).
async function firmarGuia(){
  const aviso = document.getElementById('guia-error');
  const lienzo = document.getElementById('firma-lienzo');
  if(!aviso || !lienzo) return; // el aviso no se borra al empezar (ver marcarLeidaGuia)
  const nombre = (document.getElementById('firma-nombre').value || '').replace(/\s+/g, ' ').trim();
  if(!document.getElementById('firma-declaracion').checked){ aviso.textContent = 'Marca la casilla para confirmar que leíste la guía.'; return; }
  if(nombre.length < 3){ aviso.textContent = 'Escribe tu nombre completo.'; return; }
  if(!firmaTrazada){ aviso.textContent = 'Firma con el dedo en el recuadro.'; return; }
  let guia;
  try{
    guia = await cargarContenidoGuia();
  }catch(err){
    console.error('[guía] al firmar', err);
    aviso.textContent = FALLA_GUARDAR_GUIA;
    return;
  }
  const blob = await new Promise(ok => lienzo.toBlob(ok, 'image/png'));
  if(!blob){ aviso.textContent = FALLA_SUBIR_FIRMA; return; }
  try{
    const { error } = await sbn.storage.from('ninieras-privado').upload(`firmas/${nineraIdSesion}/${todayISO()}.png`, blob, { upsert: true, contentType: 'image/png' });
    if(error) throw error;
  }catch(err){
    console.error('[guía] al subir la firma', err);
    aviso.textContent = FALLA_SUBIR_FIRMA;
    return;
  }
  try{
    const { error } = await sbn.rpc('ninera_firmar_guia', { p_nombre: nombre, p_version: guia.version });
    if(error) throw error;
  }catch(err){
    console.error('[guía] al guardar la firma', err);
    const motivo = err?.message || '';
    aviso.textContent = /no_autorizada/.test(motivo) ? CUENTA_NO_ACTIVA
      : /guia_incompleta/.test(motivo) ? 'Te falta terminar Protocolos y RCP antes de firmar.'
      : /nombre_invalido/.test(motivo) ? 'Escribe tu nombre completo.'
      : FALLA_GUARDAR_GUIA;
    return;
  }
  marcarRuta('#guia');
  pintar(`<main class="pantalla pantalla-guia">
    ${cabeceraGuia('¡Listo! Ya puedes recibir pedidos.')}
    <p>Esta guía no reemplaza un curso presencial de RCP: si hiciste uno, cárgalo en tu perfil.</p>
    <button type="button" class="btn primary ancho" onclick="conGuardado(this, ()=>abrirMiPerfil())">Ir a Mi perfil</button>
    <button type="button" class="link-boton" onclick="renderInicio()">Volver al inicio</button>
  </main>`);
}
