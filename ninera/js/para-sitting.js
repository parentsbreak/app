// App de niñeras (fase 1, etapa 12, 03/11/2026, pedido de Paulina y Delfina; docs/fase1/etapa12-guia-sitting.md):
// "Para este sitting" (#sitting/<id>/guia), desde la tarjeta del día (debajo de "Ficha de la familia") y desde el
// detalle de "Próximos sittings". Solo sittings, nunca traslados. Arriba y siempre (aunque falle todo lo demás), los
// teléfonos de emergencia, que llaman con un toque, y qué hacer si pasa algo. Después, lo de la guía que sirve para
// esos chicos: las lecciones de la edad de cada uno, los juegos de su edad (juegos.js) y lo de autismo, TDAH o
// discapacidad si la ficha de la familia lo menciona. Las edades y las necesidades las da la base
// (ninera_mis_sittings: edades_meses por mes calendario, edades_anios de la edad cargada a mano y necesidades);
// nunca la fecha de nacimiento ni los nombres de los chicos. Nada se guarda.

const FALLA_PARA_SITTING = 'No pudimos cargar lo de este sitting. Revisa tu conexión a internet y vuelve a intentar.';
const SIN_EDADES_PARA_SITTING = 'No tenemos las edades de los chicos.';
const NECESIDADES_PARA_SITTING = ['autismo', 'tdah', 'discapacidad'];

/* ---- Reglas (puras: sin base ni DOM) ---- */

// Los chicos de un sitting con edad: { meses (si hay fecha de nacimiento), anios }.
function chicosConEdadSitting(s){
  return [
    ...(Array.isArray(s?.edades_meses) ? s.edades_meses : []).filter(Number.isInteger).map(m => ({ meses: m, anios: Math.floor(m / 12) })),
    ...(Array.isArray(s?.edades_anios) ? s.edades_anios : []).filter(Number.isInteger).map(a => ({ meses: null, anios: a })),
  ];
}

// El módulo de la guía de un chico (docs/fase1/etapa12-guia-sitting.md, cortes aprobados por Diego). Con la edad cargada
// a mano (solo años), 0 años son Recién nacidos y Bebés.
function modulosDeChico(c){
  if(c.meses != null){
    if(c.meses < 3) return ['recien'];
    if(c.meses < 12) return ['bebes'];
    if(c.meses < 36) return ['toddlers'];
    if(c.meses < 60) return ['preescolares'];
    if(c.meses < 108) return ['escolar'];
    return ['preteens'];
  }
  if(c.anios <= 0) return ['recien', 'bebes'];
  if(c.anios < 3) return ['toddlers'];
  if(c.anios < 5) return ['preescolares'];
  if(c.anios < 9) return ['escolar'];
  return ['preteens'];
}

// "8 meses" hasta los 2 años si se sabe el mes; si no, en años ("menos de 1 año" con la edad cargada a mano en 0).
function textoEdadChicoSitting(c){
  if(c.meses != null && c.meses < 24) return c.meses === 1 ? '1 mes' : `${c.meses} meses`;
  if(c.anios <= 0) return 'menos de 1 año';
  return c.anios === 1 ? '1 año' : `${c.anios} años`;
}

// "Para el chico de 8 meses" / "Para los chicos de 3 y 5 años" (sin repetir edades).
function textoChicosDelModulo(chicos){
  const edades = [...new Set(chicos.map(textoEdadChicoSitting))];
  const lista = edades.length === 1 ? edades[0] : `${edades.slice(0, -1).join(', ')} y ${edades[edades.length - 1]}`;
  return chicos.length === 1 ? `Para el chico de ${lista}` : `Para los chicos de ${lista}`;
}

// Los módulos por edad que tienen al menos un chico, en el orden de la guía: [{ id, chicos }].
function modulosPorEdad(s){
  const orden = ['recien', 'bebes', 'toddlers', 'preescolares', 'escolar', 'preteens'];
  const por = new Map();
  chicosConEdadSitting(s).forEach(c => modulosDeChico(c).forEach(id => {
    if(!por.has(id)) por.set(id, []);
    por.get(id).push(c);
  }));
  return orden.filter(id => por.has(id)).map(id => ({ id, chicos: por.get(id) }));
}

// Los juegos cuyo rango (el del original) incluye la edad en años de algún chico, en ORDEN_JUEGOS_GUIA.
function juegosPorEdad(s){
  const anios = chicosConEdadSitting(s).map(c => c.anios);
  return ORDEN_JUEGOS_GUIA.filter(n => anios.some(a => a >= JUEGOS_GUIA[n].desde && a <= JUEGOS_GUIA[n].hasta));
}

// Solo las tres que conoce la app, en su orden (lo demás se ignora).
function necesidadesSitting(s){
  const de = Array.isArray(s?.necesidades) ? s.necesidades : [];
  return NECESIDADES_PARA_SITTING.filter(n => de.includes(n));
}

/* ---- Pantalla ---- */

// El botón de la tarjeta del día (dia.js), debajo de "Ficha de la familia": solo el sitting de hoy.
function htmlBotonParaSittingDia(s){
  if(s.tipo === 'traslado' || s.fecha !== todayISO()) return '';
  return `<button type="button" class="btn ghost ancho dia-para-sitting" onclick="pantallaParaSitting(${argJs(s.id)})">Para este sitting</button>`;
}

function abrirLeccionParaSitting(sittingId, moduloId, leccionId){
  return pantallaLeccionGuia(moduloId, leccionId, { sittingId });
}

function htmlEmergenciasParaSitting(id){
  return `<section class="para-sitting-emergencias" aria-label="Emergencias">
    <h2>Si pasa algo</h2>
    <a class="btn llamar ancho" href="tel:911">Llamar al 911</a>
    <a class="btn llamar-ciat ancho" href="tel:1722">Intoxicaciones, CIAT: 1722</a>
    <p class="para-sitting-movil">Emergencia móvil: la de la familia, anotada en la ficha.</p>
    <button type="button" class="btn ghost ancho" onclick="abrirLeccionParaSitting(${argJs(id)}, 'auxilios', 'x3')">Qué hacer: a quién avisar y en qué orden</button>
  </section>`;
}

function htmlLeccionesParaSitting(id, m){
  return `<div class="guia-lecciones">
    ${m.lecciones.map((l, i) => `<button type="button" class="guia-leccion-fila" data-leccion="${escaparHtml(l.id)}" onclick="abrirLeccionParaSitting(${argJs(id)}, ${argJs(m.id)}, ${argJs(l.id)})">
      <span class="guia-leccion-num">${i + 1}</span>
      <span><b>${escaparHtml(l.titulo)}</b>${l.subtitulo ? `<small>${escaparHtml(l.subtitulo)}</small>` : ''}</span>
    </button>`).join('')}
  </div>`;
}

// Lee el sitting de ninera_mis_sittings (si no está ya cargado, por ejemplo al abrir el link) y la guía, a la vez.
async function cargarParaSitting(id){
  const leerSitting = async () => {
    const ya = sittingsNineraCargados.find(x => x.id === id);
    if(ya) return ya;
    const { data, error } = await sbn.rpc('ninera_mis_sittings');
    if(error) throw error;
    if(Array.isArray(data)) sittingsNineraCargados = data;
    return (Array.isArray(data) ? data : []).find(x => x.id === id) || null;
  };
  const [s, guia] = await Promise.all([leerSitting(), cargarContenidoGuia()]);
  return { s, guia };
}

async function pantallaParaSitting(id){
  marcarRuta(`#sitting/${id}/guia`);
  mostrarCargaNinera();
  let s, guia;
  try{
    ({ s, guia } = await cargarParaSitting(id));
  }catch(err){
    console.error('[para este sitting] al abrir', err);
    // Los teléfonos quedan igual: son lo único que no puede faltar.
    pintar(`<main class="pantalla pantalla-guia pantalla-para-sitting">
      ${cabeceraGuia('Para este sitting')}
      ${htmlEmergenciasParaSitting(id)}
      <p class="error-form" role="alert">${escaparHtml(FALLA_PARA_SITTING)}</p>
      <button type="button" class="btn primary ancho" onclick="pantallaParaSitting(${argJs(id)})">Reintentar</button>
      <button type="button" class="link-boton" onclick="renderInicio()">Volver</button>
    </main>`);
    return;
  }
  if(!s || s.tipo === 'traslado'){
    toast('Este sitting ya no está en tus próximos sittings. Si algo no está bien, escríbenos por el chat.', 'bad');
    return renderInicio();
  }
  const modulo = mid => guia.modulos.find(m => m.id === mid);
  const porEdad = modulosPorEdad(s).filter(x => modulo(x.id));
  const juegos = juegosPorEdad(s);
  const necesidades = necesidadesSitting(s).filter(modulo);
  const bloques = [
    ...porEdad.map(x => {
      const m = modulo(x.id);
      return `<section class="para-sitting-bloque" data-modulo="${escaparHtml(m.id)}">
        <h2>${escaparHtml(m.nombre)}</h2>
        <p class="helper">${escaparHtml(textoChicosDelModulo(x.chicos))}</p>
        ${htmlLeccionesParaSitting(id, m)}
      </section>`;
    }),
    juegos.length ? `<section class="para-sitting-bloque" data-bloque="juegos">
      <h2>Juegos</h2>
      <p class="helper">Para jugar con los chicos desde el celular.</p>
      <div class="guia-lecciones">
        ${juegos.map(n => `<button type="button" class="guia-leccion-fila guia-juego-fila" data-juego="${escaparHtml(n)}" onclick="pantallaJuegoGuia(${argJs(n)}, ${argJs(id)})">
          <span class="guia-leccion-num" aria-hidden="true">★</span>
          <span><b>${escaparHtml(JUEGOS_GUIA[n].titulo)}</b><small>${escaparHtml(JUEGOS_GUIA[n].edad)}</small></span>
        </button>`).join('')}
      </div>
    </section>` : '',
    ...necesidades.map(mid => {
      const m = modulo(mid);
      return `<section class="para-sitting-bloque" data-modulo="${escaparHtml(m.id)}">
        <h2>${escaparHtml(m.nombre)}</h2>
        <p class="helper">La ficha de la familia lo menciona.</p>
        ${htmlLeccionesParaSitting(id, m)}
      </section>`;
    }),
  ].filter(Boolean);
  pintar(`<main class="pantalla pantalla-guia pantalla-para-sitting">
    ${cabeceraGuia('Para este sitting')}
    <p class="helper">${escaparHtml(`${textoDiaNinera(s.fecha, todayISO())}, ${horasSittingNinera(s)}`)}${s.chicos ? `<br>Chicos: ${escaparHtml(s.chicos)}` : ''}</p>
    ${htmlEmergenciasParaSitting(id)}
    ${porEdad.length ? '' : `<p class="helper para-sitting-sin-edades">${escaparHtml(SIN_EDADES_PARA_SITTING)}</p>`}
    ${bloques.join('')}
    <button type="button" class="btn ghost ancho" onclick="pantallaGuiaNinera()">Ver toda la guía</button>
    <button type="button" class="link-boton" onclick="renderInicio()">Volver</button>
  </main>`);
  window.scrollTo(0, 0);
}
