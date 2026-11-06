// App de niñeras (fase 1, etapa 8, 02/11/2026): la ficha de la familia y los cambios de horario (decisiones.md 6.5,
// textos.md 5). Textos en "tú".
// - La ficha: desde la tarjeta del día ("Ficha de la familia", #sitting/<id>/ficha), opcional, se repasa con los
//   padres antes de que se vayan. Viene precargada con la última ficha de esa familia (de cualquier niñera, sin
//   decir cuál) y la base la guarda por sitting (ninera_guardar_ficha_familia): lo que escribe la niñera nunca pisa
//   la ficha de la familia del panel. La siguiente niñera la ve en el detalle del sitting y en "¡Quedaste
//   seleccionada!" desde que queda confirmada hasta el fin de su sitting (ninera_ficha_familia decide qué ve).
// - Los cambios de horario: una tarjeta por cada uno sin responder ("Ok" / "A esa hora no puedo",
//   ninera_responder_cambio), arriba del inicio. #cambio/<id> es el link del aviso. "No puedo" le avisa al equipo
//   (lo manda la base); el registro no cambia: decide una admin.
// Con la base sin la migración de la etapa 8 (las RPC dan 404 PGRST202): ni tarjeta de cambios ni ficha.

let etapa8NineraSinMigrar = false;
// Los cambios de la última lectura (la ruta #cambio/<id> los busca por id).
let cambiosNinera = [];
// La lectura de los cambios en curso: #cambio/<id> la espera antes de buscar.
let cargaCambiosNinera = Promise.resolve();

const FALLA_CARGAR_FICHA = 'No pudimos cargar la ficha de la familia. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_GUARDAR_FICHA = 'No pudimos guardar la ficha. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_CARGAR_CAMBIOS = 'No pudimos cargar los cambios de tus sittings. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_RESPONDER_CAMBIO = 'No pudimos enviar tu respuesta. Revisa tu conexión a internet y vuelve a intentar.';
const CAMBIO_NO_PENDIENTE = 'Este cambio ya no está pendiente.';
const SITTING_FUERA_DEL_DIA = 'Este sitting ya no está en tu día. Si algo no está bien, escríbenos por el chat.';

// Sin la migración: lo que ya está en pantalla de la etapa 8 se va (el botón de la ficha en la tarjeta del día).
function marcarEtapa8SinMigrar(){
  etapa8NineraSinMigrar = true;
  document.querySelectorAll('.dia-ficha').forEach(el => el.remove());
}

/* ---- La ficha de la familia ---- */

// { datos, actualizada_en, es_de_este_sitting } o null (sin ficha, o no le corresponde verla). Un error tira.
async function leerFichaFamiliaNinera(sittingId){
  const { data, error } = await sbn.rpc('ninera_ficha_familia', { p_sitting_id: sittingId });
  if(error){
    if(error.code === 'PGRST202'){ marcarEtapa8SinMigrar(); return null; }
    throw error;
  }
  const fila = Array.isArray(data) ? data[0] : data;
  return fila && fila.datos && typeof fila.datos === 'object' ? fila : null;
}

// El botón de la tarjeta del día (dia.js), debajo de lo que toca según la hora: es opcional.
function htmlBotonFichaDia(s){
  if(etapa8NineraSinMigrar) return '';
  return `<div class="dia-ficha">
    <button type="button" class="btn ghost ancho" onclick="pantallaFichaFamilia(${argJs(s.id)})">Ficha de la familia</button>
    <p class="dia-ficha-ayuda">Repásala con los padres antes de que se vayan.</p>
  </div>`;
}

// #sitting/<id>/ficha: el formulario, precargado. Las casillas son de lo que revisó ella en este sitting: solo se
// precargan de su propia ficha, nunca de la de otra niñera.
async function pantallaFichaFamilia(id){
  marcarRuta(`#sitting/${id}/ficha`);
  mostrarCargaNinera();
  let s, ficha;
  try{
    await cargarDiaNinera();
    s = diaNinera.find(x => x.id === id);
    ficha = s && !etapa8NineraSinMigrar ? await leerFichaFamiliaNinera(id) : null;
  }catch(err){
    console.error('[ficha] al abrir', err);
    pintarMensajeNinera(FALLA_CARGAR_FICHA, `<button type="button" class="btn primary ancho" onclick="pantallaFichaFamilia(${argJs(id)})">Reintentar</button>
      <button type="button" class="link-boton" onclick="renderInicio()">Volver</button>`);
    return;
  }
  if(diaNineraSinMigrar || etapa8NineraSinMigrar) return renderInicio();
  if(!s){
    pintarMensajeNinera(SITTING_FUERA_DEL_DIA, '<button type="button" class="btn primary ancho" onclick="renderInicio()">Volver al inicio</button>');
    return;
  }
  const datos = ficha ? ficha.datos : {};
  const propia = !!(ficha && ficha.es_de_este_sitting);
  const campo = c => {
    const valor = typeof datos[c.clave] === 'string' ? datos[c.clave] : '';
    const idCampo = `ficha-${c.clave}`;
    const control = c.largo
      ? `<textarea id="${idCampo}" rows="2" maxlength="${LARGO_MAXIMO_FICHA}"${c.ayuda ? ` placeholder="${escaparHtml(c.ayuda)}"` : ''}>${escaparHtml(valor)}</textarea>`
      : `<input type="${c.tel ? 'tel' : 'text'}" id="${idCampo}" maxlength="${LARGO_MAXIMO_FICHA}" autocomplete="off" value="${escaparHtml(valor)}"${c.ayuda ? ` placeholder="${escaparHtml(c.ayuda)}"` : ''}>`;
    return `<div class="field"><label for="${idCampo}">${escaparHtml(c.etiqueta)}</label>${control}</div>`;
  };
  pintar(`<main class="pantalla pantalla-ficha">
    <header class="cabecera">
      <img src="../logo-simbolo.png" alt="" class="cabecera-simbolo">
      <h1>Ficha de la familia</h1>
    </header>
    <p class="helper">Repásala con los padres antes de que se vayan.${s.madre ? ` Familia: ${escaparHtml(s.madre)}.` : ''}</p>
    ${ficha && !propia ? '<p class="aviso-info">Ya viene con lo que sabemos de la familia. Revisa con los padres que siga igual.</p>' : ''}
    ${propia ? `<p class="aviso-info">Ya la guardaste a las ${escaparHtml(horaMvdNinera(Date.parse(ficha.actualizada_en)))}. Puedes corregirla hasta mañana.</p>` : ''}
    ${GRUPOS_FICHA_FAMILIA.map(([titulo, campos]) => `<fieldset class="grupo">
      <legend>${escaparHtml(titulo)}</legend>
      ${campos.map(campo).join('')}
    </fieldset>`).join('')}
    <fieldset class="grupo">
      <legend>Antes de que se vayan los padres</legend>
      ${CASILLAS_FICHA_FAMILIA.map(([clave, texto]) => `<label class="chk"><input type="checkbox" id="ficha-${clave}"${propia && datos[clave] === true ? ' checked' : ''}> ${escaparHtml(texto)}</label>`).join('')}
    </fieldset>
    <p class="error-form" id="ficha-error" role="alert"></p>
    <button type="button" class="btn primary ancho" onclick="conGuardado(this, ()=>guardarFichaFamilia(${argJs(id)}))">Guardar la ficha</button>
    <button type="button" class="link-boton" onclick="renderInicio()">Volver</button>
  </main>`);
}

function mensajeErrorFicha(err){
  const motivo = err?.message || '';
  if(/no_autorizada/.test(motivo)) return CUENTA_NO_ACTIVA;
  if(/texto_largo/.test(motivo)) return `Algún dato es demasiado largo: hasta ${LARGO_MAXIMO_FICHA.toLocaleString('es-UY')} caracteres.`;
  if(/no_existe/.test(motivo)) return SITTING_FUERA_DEL_DIA;
  return FALLA_GUARDAR_FICHA;
}

// Todos los campos van (los vacíos como texto vacío: la base no los guarda) y las casillas como true / false.
async function guardarFichaFamilia(id){
  const aviso = document.getElementById('ficha-error');
  const datos = {};
  CAMPOS_FICHA_FAMILIA.forEach(c => { datos[c.clave] = (document.getElementById(`ficha-${c.clave}`)?.value || '').trim(); });
  CASILLAS_FICHA_FAMILIA.forEach(([clave]) => { datos[clave] = !!document.getElementById(`ficha-${clave}`)?.checked; });
  try{
    const { error } = await sbn.rpc('ninera_guardar_ficha_familia', { p_sitting_id: id, p_datos: datos });
    if(error) throw error;
  }catch(err){
    console.error('[ficha] al guardar', err);
    if(aviso) aviso.textContent = mensajeErrorFicha(err);
    return;
  }
  pintarMensajeNinera('¡Gracias! La ficha quedó guardada.', '<button type="button" class="btn primary ancho" onclick="renderInicio()">Volver al inicio</button>');
}

// En el detalle del sitting y en "¡Quedaste seleccionada!" (inicio.js): la ficha que le toca ver, sin las casillas.
// Llega después del modal; si mientras tanto se cerró o se abrió otro sitting, no pinta nada.
async function pintarFichaEnDetalle(sittingId){
  const cont = () => {
    const el = document.getElementById('detalle-ficha');
    return el && el.dataset.sitting === sittingId ? el : null;
  };
  if(etapa8NineraSinMigrar){ cont()?.remove(); return; }
  let ficha;
  try{
    ficha = await leerFichaFamiliaNinera(sittingId);
  }catch(err){
    console.error('[ficha] en el detalle', err);
    const el = cont();
    if(el) el.innerHTML = `<p class="helper">${escaparHtml(FALLA_CARGAR_FICHA)}</p>`;
    return;
  }
  const el = cont();
  if(!el) return;
  const lineas = ficha ? lineasFichaFamilia(ficha.datos) : [];
  if(!lineas.length){ el.remove(); return; }
  el.innerHTML = `<h3>Ficha de la familia</h3>
    ${lineas.map(l => `<p><span class="detalle-etiqueta">${escaparHtml(l.etiqueta)}:</span> ${escaparHtml(l.valor)}</p>`).join('')}`;
}

/* ---- Los cambios de horario ---- */

function horarioCambioNinera(c){
  if(!c.hora_inicio) return '';
  if(!c.hora_fin) return `a las ${horaCortaNinera(c.hora_inicio)}`;
  return `de ${horaCortaNinera(c.hora_inicio)} a ${horaCortaNinera(c.hora_fin)}${c.termina_dia_siguiente ? ' del día siguiente' : ''}`;
}
function textoCambioNinera(c){
  const horario = horarioCambioNinera(c);
  const dia = diaLargoNinera(c.desde);
  return c.es_fijo ? `Desde el ${dia}${horario ? `, ${horario}` : ''}.` : `${dia}${horario ? `, ${horario}` : ''}.`;
}
function htmlTarjetaCambio(c){
  const id = argJs(c.id);
  return `<section class="tarjeta-dia tarjeta-cambio" id="cambio-${escaparHtml(c.id)}">
    <h2>${c.tipo === 'traslado' ? (c.es_fijo ? 'Cambió el horario de tu fijo de traslados' : 'Cambió el horario de tu traslado')
      : (c.es_fijo ? 'Cambió el horario de tu fijo' : 'Cambió el horario de tu sitting')}</h2>
    <p class="dia-cuando">${escaparHtml(textoCambioNinera(c))}</p>
    ${c.madre ? `<p class="helper">Familia: ${escaparHtml(c.madre)}${c.zona && c.tipo !== 'traslado' ? `, en ${escaparHtml(c.zona)}` : ''}</p>` : ''}
    <div class="dia-botones">
      <button type="button" class="btn primary ancho" onclick="conGuardado(this, ()=>responderCambioNinera(${id}, true))">Ok</button>
      <button type="button" class="btn ghost ancho" onclick="conGuardado(this, ()=>responderCambioNinera(${id}, false))">A esa hora no puedo</button>
    </div>
    <p class="error-form dia-error" id="cambio-error-${escaparHtml(c.id)}" role="alert"></p>
  </section>`;
}

// La tarjeta del inicio: se pide sin esperar al resto. Si falla, lo dice con "Reintentar".
function cargarTarjetaCambios(){
  cargaCambiosNinera = leerTarjetaCambios();
  return cargaCambiosNinera;
}
async function leerTarjetaCambios(){
  if(!document.getElementById('inicio-cambios') || etapa8NineraSinMigrar) return;
  let filas;
  try{
    const { data, error } = await sbn.rpc('ninera_mis_cambios');
    if(error){
      if(error.code === 'PGRST202'){ marcarEtapa8SinMigrar(); return; }
      throw error;
    }
    filas = Array.isArray(data) ? data : [];
  }catch(err){
    console.error('[cambios] al leer', err);
    const actual = document.getElementById('inicio-cambios');
    if(actual) actual.innerHTML = `<section class="tarjeta-dia">
      <p class="vacio">${escaparHtml(FALLA_CARGAR_CAMBIOS)}</p>
      <button type="button" class="btn ghost ancho" onclick="cargarTarjetaCambios()">Reintentar</button>
    </section>`;
    return;
  }finally{
    document.getElementById('inicio-cambios')?.setAttribute('data-cargada', '1');
  }
  cambiosNinera = filas;
  const actual = document.getElementById('inicio-cambios');
  if(actual) actual.innerHTML = filas.map(htmlTarjetaCambio).join('');
}

function mensajeErrorCambio(err){
  const motivo = err?.message || '';
  if(/no_autorizada/.test(motivo)) return CUENTA_NO_ACTIVA;
  if(/no_existe/.test(motivo)) return CAMBIO_NO_PENDIENTE;
  return FALLA_RESPONDER_CAMBIO;
}

// Un toque. La base devuelve la primera respuesta (un segundo toque, o desde otro celular, no la cambia): lo que
// se ve es lo que quedó.
async function responderCambioNinera(id, ok){
  const aviso = document.getElementById(`cambio-error-${id}`);
  let quedo;
  try{
    const { data, error } = await sbn.rpc('ninera_responder_cambio', { p_cambio_id: id, p_ok: ok });
    if(error) throw error;
    quedo = data === true;
  }catch(err){
    console.error('[cambios] al responder', err);
    if(aviso) aviso.textContent = mensajeErrorCambio(err);
    return;
  }
  cambiosNinera = cambiosNinera.filter(c => c.id !== id);
  const tarjeta = document.getElementById(`cambio-${id}`);
  if(tarjeta) tarjeta.outerHTML = `<p class="aviso-info aviso-cambio" role="status">${escaparHtml(quedo
    ? 'Listo, gracias por confirmar.'
    : 'Le avisamos al equipo. Te escribimos si hace falta.')}</p>`;
}

// #cambio/<id>, del aviso: el inicio con ese cambio a la vista. Si ya no está (lo respondió, o ya pasó), lo dice.
async function abrirCambioNinera(id){
  if(document.getElementById('inicio-cambios')){
    marcarRuta('#inicio');
    await cargarTarjetaCambios();
  }else{
    await renderInicio();
    await cargaCambiosNinera;
  }
  const cont = document.getElementById('inicio-cambios');
  if(!cont || etapa8NineraSinMigrar) return;
  const tarjeta = document.getElementById(`cambio-${id}`);
  if(tarjeta){
    tarjeta.classList.add('destacada');
    tarjeta.scrollIntoView({ block: 'center' });
  }else if(!cont.querySelector('.vacio')){
    cont.insertAdjacentHTML('afterbegin', `<p class="aviso-info aviso-cambio" role="status">${escaparHtml(CAMBIO_NO_PENDIENTE)}</p>`);
  }
}
