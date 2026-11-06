// App de niñeras (fase 1, etapa 7, 02/11/2026): el día del sitting y el cierre (decisiones.md 6.4, textos.md 5).
// En el inicio, una tarjeta por sitting de hoy (desde 3 horas antes) o de ayer sin cerrar, con lo que toca según
// la hora y lo que ya marcó: "Estoy saliendo", "Voy a llegar tarde", "Ya entré", "Estoy afuera y no me abren",
// "No encuentro la casa" y "Llegaron los padres", que abre el cierre (#sitting/<id>/cierre, el link de los
// avisos de fin). Los fijos solo tienen "Ya entré" (opcional) y el cierre (4.10). El cierre se manda una vez:
// la hora real (con la diferencia con lo previsto, sin montos), el gasto con la foto del comprobante, los
// comentarios y cómo le fue con la familia. La base guarda (ninera_mi_dia, ninera_marcar_evento,
// ninera_cerrar_sitting) y avisa al equipo; el registro y la plata los revisa una admin en el panel. Textos en "tú".
// Traslados (etapa 11b, 03/11/2026, decisiones.md 6.10): la misma tarjeta con "Estoy saliendo", "Voy a llegar
// tarde", "No están los chicos", "Ya los busqué" y "Ya los dejé" (que abre el cierre); un fijo, solo "Ya los busqué"
// / "Ya los dejé". El cierre de un traslado no tiene hora (es un viaje): el gasto (peajes o estacionamiento) y los
// comentarios (ninera_cerrar_traslado).

// Las filas de la última lectura de ninera_mi_dia (la tarjeta y el cierre las buscan por id).
let diaNinera = [];
// Base sin la migración de la etapa 7 (la RPC da 404 PGRST202): ni tarjeta ni cierre.
let diaNineraSinMigrar = false;
// La foto del comprobante elegida en el cierre (se achica y se sube al enviar).
let comprobanteCierreElegido = null;

// La tarjeta aparece 3 horas antes del inicio: antes, el sitting está solo en "Próximos sittings".
const VENTANA_TARJETA_DIA_MS = 3 * 3600000;
const DEMORAS_DIA = [[10, '10 min'], [20, '20 min'], [30, '30 min o más']];
const FALLA_GUARDAR_DIA = 'No pudimos guardarlo. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_CARGAR_DIA = 'No pudimos cargar tu sitting de hoy. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_SUBIR_COMPROBANTE = 'No pudimos subir la foto del comprobante. Revisa tu conexión a internet y vuelve a intentar.';

/* ---- Horas (Montevideo es UTC-3 todo el año: la zona del celular no mueve nada) ---- */
function momentoDiaNinera(fecha, hora){ return Date.parse(`${fecha}T${String(hora).slice(0, 5)}:00-03:00`); }
function inicioDiaNinera(s){ return s.hora_inicio ? momentoDiaNinera(s.fecha, s.hora_inicio) : null; }
function finPrevistoDiaNinera(s){
  return s.hora_fin ? momentoDiaNinera(s.termina_dia_siguiente ? sumarDiasISO(s.fecha, 1) : s.fecha, s.hora_fin) : null;
}
// "HH:MM" de un momento, en Montevideo.
function horaMvdNinera(ms){
  return new Intl.DateTimeFormat('es-UY', { timeZone: 'America/Montevideo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}
function eventoDiaNinera(s, tipo){ return (s.eventos || []).find(e => e.tipo === tipo) || null; }
// "1 h", "45 min", "1 h 15 min".
function duracionDiaNinera(min){
  const h = Math.floor(min / 60), m = min % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

// La lectura de la base. null con la base sin migrar (o sin ficha); un error de red tira.
async function cargarDiaNinera(){
  const { data, error } = await sbn.rpc('ninera_mi_dia');
  if(error){
    if(error.code === 'PGRST202'){ diaNineraSinMigrar = true; diaNinera = []; return null; }
    throw error;
  }
  diaNineraSinMigrar = false;
  diaNinera = Array.isArray(data) ? data : [];
  return diaNinera;
}

// Las que van en el inicio: sin cerrar, de ayer (quedó abierto) o de hoy desde 3 horas antes.
function sittingsVisiblesDiaNinera(filas, ahora = Date.now()){
  const hoy = todayISO();
  return (filas || []).filter(s => !s.cerrado_en
    && (s.fecha < hoy || !s.hora_inicio || ahora >= inicioDiaNinera(s) - VENTANA_TARJETA_DIA_MS));
}

/* ---- La tarjeta del inicio ---- */

// Se pide sin esperar al resto del inicio. Sin migrar no aparece nada; si la lectura falla, lo dice con
// "Reintentar" (puede haber un sitting en curso).
async function cargarTarjetaDia(){
  const cont = document.getElementById('inicio-dia');
  if(!cont || diaNineraSinMigrar) return;
  try{
    await cargarDiaNinera();
  }catch(err){
    console.error('[el día] al leer', err);
    const actual = document.getElementById('inicio-dia');
    if(actual) actual.innerHTML = `<section class="tarjeta-dia">
      <p class="vacio">${escaparHtml(FALLA_CARGAR_DIA)}</p>
      <button type="button" class="btn ghost ancho" onclick="cargarTarjetaDia()">Reintentar</button>
    </section>`;
    return;
  }finally{
    // Marca de que la carga terminó (con tarjeta o sin ella): los tests esperan esto.
    document.getElementById('inicio-dia')?.setAttribute('data-cargada', '1');
  }
  const actual = document.getElementById('inicio-dia');
  if(actual) actual.innerHTML = sittingsVisiblesDiaNinera(diaNinera).map(s => htmlTarjetaDia(s)).join('');
}

function htmlTarjetaDia(s, ahora = Date.now()){
  if(s.tipo === 'traslado') return htmlTarjetaTraslado(s, ahora);
  const hoy = todayISO();
  const inicio = inicioDiaNinera(s), fin = finPrevistoDiaNinera(s);
  const empezo = s.fecha < hoy || inicio == null || ahora >= inicio;
  const termino = fin != null && ahora >= fin;
  const entre = eventoDiaNinera(s, 'entre'), saliendo = eventoDiaNinera(s, 'saliendo'), tarde = eventoDiaNinera(s, 'tarde');
  const noAbren = eventoDiaNinera(s, 'no_abren'), noEncuentro = eventoDiaNinera(s, 'no_encuentro');
  const id = argJs(s.id);
  const horario = s.hora_inicio
    ? `${horaCortaNinera(s.hora_inicio)}${s.hora_fin ? ` a ${horaCortaNinera(s.hora_fin)}${s.termina_dia_siguiente ? ' del día siguiente' : ''}` : ''}`
    : 'Sin horario';
  const lineas = [];
  if(saliendo && !entre) lineas.push(`Saliste a las ${horaMvdNinera(Date.parse(saliendo.en))}.`);
  if(tarde && !entre) lineas.push(`Avisaste que llegas ${tarde.minutos === 30 ? '30 min o más' : `${tarde.minutos} min`} tarde. Le avisamos al equipo.`);
  if(noAbren && !entre) lineas.push('Avisaste que no te abren. Le avisamos al equipo.');
  if(noEncuentro && !entre) lineas.push('Avisaste que no encuentras la casa. Le avisamos al equipo.');
  if(entre) lineas.push(`Entraste a las ${horaMvdNinera(Date.parse(entre.en))}.`);
  const botones = [];
  if(!entre){
    if(!s.es_fijo && !saliendo && !empezo) botones.push(`<button type="button" class="btn ghost ancho" onclick="conGuardado(this, ()=>marcarEventoDia(${id}, 'saliendo'))">Estoy saliendo</button>`);
    if(!s.es_fijo) botones.push(`<button type="button" class="btn ghost ancho" onclick="abrirDemoraDia(${id})">Voy a llegar tarde</button>`);
    botones.push(`<button type="button" class="btn ${termino ? 'ghost' : 'primary'} ancho" onclick="conGuardado(this, ()=>marcarEventoDia(${id}, 'entre'))">Ya entré</button>`);
    if(!s.es_fijo && !noAbren) botones.push(`<button type="button" class="btn ghost ancho" onclick="conGuardado(this, ()=>marcarEventoDia(${id}, 'no_abren'))">Estoy afuera y no me abren</button>`);
    if(!s.es_fijo && !noEncuentro) botones.push(`<button type="button" class="btn ghost ancho" onclick="conGuardado(this, ()=>marcarEventoDia(${id}, 'no_encuentro'))">No encuentro la casa</button>`);
  }
  if(empezo) botones.push(`<button type="button" class="btn ${entre || termino ? 'primary' : 'ghost'} ancho" onclick="pantallaCierreSitting(${id})">Llegaron los padres</button>`);
  return `<section class="tarjeta-dia" data-sitting="${escaparHtml(s.id)}">
    <h2>${s.fecha < hoy ? 'Sitting de ayer' : 'Sitting de hoy'}</h2>
    <p class="dia-cuando">${escaparHtml(horario)}${s.zona ? `, en ${escaparHtml(s.zona)}` : ''}</p>
    ${s.madre ? `<p class="helper">Familia: ${escaparHtml(s.madre)}</p>` : ''}
    ${lineas.map(l => `<p class="dia-estado">${escaparHtml(l)}</p>`).join('')}
    <div class="dia-botones">${botones.join('')}</div>
    ${htmlBotonFichaDia(s)}
    ${htmlBotonParaSittingDia(s)}
    <p class="error-form dia-error" id="dia-error-${escaparHtml(s.id)}" role="alert"></p>
  </section>`;
}

// La tarjeta de un traslado: antes de buscarlos, "Estoy saliendo" (hasta la hora de salida), "Voy a llegar tarde",
// "No están los chicos" y "Ya los busqué"; después, "Ya los dejé" (también sin haber marcado que los buscó, si ya
// era la hora) y, si no cerró, "Cerrar el traslado". Un fijo, solo "Ya los busqué" / "Ya los dejé" (4.10).
function htmlTarjetaTraslado(s, ahora = Date.now()){
  const hoy = todayISO();
  const inicio = inicioDiaNinera(s);
  const empezo = s.fecha < hoy || inicio == null || ahora >= inicio;
  const saliendo = eventoDiaNinera(s, 'saliendo'), tarde = eventoDiaNinera(s, 'tarde'), noEstan = eventoDiaNinera(s, 'no_estan');
  const busque = eventoDiaNinera(s, 'busque'), deje = eventoDiaNinera(s, 'deje');
  const id = argJs(s.id);
  const cuando = s.hora_inicio ? `A las ${horaCortaNinera(s.hora_inicio)}` : 'Sin horario';
  const ruta = s.zona && s.destino_zona ? `, de ${s.zona} a ${s.destino_zona}` : s.zona ? `, desde ${s.zona}` : '';
  const lineas = [];
  if(saliendo && !busque && !deje) lineas.push(`Saliste a las ${horaMvdNinera(Date.parse(saliendo.en))}.`);
  if(tarde && !busque && !deje) lineas.push(`Avisaste que llegas ${tarde.minutos === 30 ? '30 min o más' : `${tarde.minutos} min`} tarde. Le avisamos al equipo.`);
  if(noEstan && !busque && !deje) lineas.push('Avisaste que no están los chicos. Le avisamos al equipo.');
  if(busque) lineas.push(`Los buscaste a las ${horaMvdNinera(Date.parse(busque.en))}.`);
  if(deje) lineas.push(`Los dejaste a las ${horaMvdNinera(Date.parse(deje.en))}.`);
  const botones = [];
  if(!busque && !deje){
    if(!s.es_fijo && !saliendo && !empezo) botones.push(`<button type="button" class="btn ghost ancho" onclick="conGuardado(this, ()=>marcarEventoDia(${id}, 'saliendo'))">Estoy saliendo</button>`);
    if(!s.es_fijo) botones.push(`<button type="button" class="btn ghost ancho" onclick="abrirDemoraDia(${id})">Voy a llegar tarde</button>`);
    if(!s.es_fijo && !noEstan) botones.push(`<button type="button" class="btn ghost ancho" onclick="conGuardado(this, ()=>marcarEventoDia(${id}, 'no_estan'))">No están los chicos</button>`);
    botones.push(`<button type="button" class="btn primary ancho" onclick="conGuardado(this, ()=>marcarEventoDia(${id}, 'busque'))">Ya los busqué</button>`);
  }
  if(!deje && (busque || empezo)) botones.push(`<button type="button" class="btn ${busque ? 'primary' : 'ghost'} ancho" onclick="conGuardado(this, ()=>marcarEventoDia(${id}, 'deje'))">Ya los dejé</button>`);
  if(deje) botones.push(`<button type="button" class="btn primary ancho" onclick="pantallaCierreSitting(${id})">Cerrar el traslado</button>`);
  return `<section class="tarjeta-dia" data-sitting="${escaparHtml(s.id)}">
    <h2>${s.fecha < hoy ? 'Traslado de ayer' : 'Traslado de hoy'}</h2>
    <p class="dia-cuando">${escaparHtml(cuando + ruta)}</p>
    ${s.madre ? `<p class="helper">Familia: ${escaparHtml(s.madre)}</p>` : ''}
    ${lineas.map(l => `<p class="dia-estado">${escaparHtml(l)}</p>`).join('')}
    <div class="dia-botones">${botones.join('')}</div>
    <div class="dia-llegar" data-llegar="${escaparHtml(s.id)}">${htmlComoLlegarDia(s)}</div>
    <p class="error-form dia-error" id="dia-error-${escaparHtml(s.id)}" role="alert"></p>
  </section>`;
}

// "Cómo llegar" en la tarjeta del traslado (03/11/2026, Diego): las direcciones salen del registro confirmado que ya
// trae ninera_mis_sittings ("Próximos sittings", inicio.js), sin sumar nada a ninera_mi_dia. Antes de "Ya los
// busqué", al origen; después, al destino; ya los dejó, nada. Las dos lecturas llegan cada una por su lado: la que
// termina última pinta el botón (pintarComoLlegarDia).
function htmlComoLlegarDia(s){
  const r = sittingsNineraCargados.find(x => x.id === s.id);
  if(!r || eventoDiaNinera(s, 'deje')) return '';
  const busque = eventoDiaNinera(s, 'busque');
  const lugar = busque ? r.destino : r.origen;
  if(!lugar) return '';
  return htmlComoLlegarNinera(lugar, busque ? 'Cómo llegar al destino' : 'Cómo llegar al origen', `llegar-${s.id}`, 'ghost');
}
function pintarComoLlegarDia(){
  document.querySelectorAll('#inicio-dia .dia-llegar[data-llegar]').forEach(caja => {
    const s = diaNinera.find(x => x.id === caja.dataset.llegar);
    if(s) caja.innerHTML = htmlComoLlegarDia(s);
  });
}

// "Voy a llegar tarde": la demora, un toque (textos.md 5).
function abrirDemoraDia(id){
  abrirModalNinera(`<h2 class="modal-titulo">¿Cuánta demora aproximada tienes?</h2>
    <p class="helper">Le avisamos al equipo.</p>
    ${DEMORAS_DIA.map(([min, texto]) => `<button type="button" class="btn ghost ancho" onclick="conGuardado(this, ()=>marcarEventoDia(${argJs(id)}, 'tarde', ${min}))">${escaparHtml(texto)}</button>`).join('')}
    <p class="error-form" id="dia-error-demora" role="alert"></p>`);
}

// que: 'sitting' o 'traslado' (el texto de los avisos).
function mensajeErrorDia(err, que = 'sitting'){
  const motivo = err?.message || '';
  if(/no_autorizada/.test(motivo)) return CUENTA_NO_ACTIVA;
  if(/ya_cerrado/.test(motivo)) return `Este ${que} ya está cerrado.`;
  if(/ya_revisado/.test(motivo)) return `El equipo ya revisó este ${que}. Si algo no está bien, escríbenos por el chat.`;
  if(/no_existe/.test(motivo)) return `Este ${que} ya no está en tu día. Si algo no está bien, escríbenos por el chat.`;
  return FALLA_GUARDAR_DIA;
}
function queDiaNinera(s){ return s && s.tipo === 'traslado' ? 'traslado' : 'sitting'; }

// Un toque del día. El aviso de error no se borra al empezar (como en la guía: si la pantalla se mueve, un
// segundo toque cae en otro botón); con éxito se vuelve a pintar la tarjeta. "Ya los dejé" (traslados) abre el
// cierre enseguida: un paso menos.
async function marcarEventoDia(id, tipo, minutos){
  const aviso = document.getElementById(tipo === 'tarde' ? 'dia-error-demora' : `dia-error-${id}`);
  try{
    const { error } = await sbn.rpc('ninera_marcar_evento', tipo === 'tarde'
      ? { p_sitting_id: id, p_tipo: tipo, p_minutos: minutos } : { p_sitting_id: id, p_tipo: tipo });
    if(error) throw error;
  }catch(err){
    console.error('[el día] al marcar', err);
    if(aviso) aviso.textContent = mensajeErrorDia(err, queDiaNinera(diaNinera.find(x => x.id === id)));
    return;
  }
  if(tipo === 'tarde') cerrarModalNinera();
  if(tipo === 'deje') return pantallaCierreSitting(id);
  await cargarTarjetaDia();
}

/* ---- El cierre (#sitting/<id>/cierre) ---- */

// La ruta #sitting/<id>/cierre (el link de los avisos de fin y "Llegaron los padres"), desde la etapa 8
// #sitting/<id>/ficha (la ficha de la familia, ficha.js) y desde la 12 #sitting/<id>/guia ("Para este sitting").
function abrirRutaSittingNinera(hash){
  const m = /^#sitting\/([0-9a-f-]{36})\/(cierre|ficha|guia)$/.exec(hash || '');
  if(!m) return renderInicio();
  if(m[2] === 'guia') return pantallaParaSitting(m[1]);
  return m[2] === 'ficha' ? pantallaFichaFamilia(m[1]) : pantallaCierreSitting(m[1]);
}

// La hora con que arranca el cierre: la de fin prevista si ya llegó (o falta menos de 15 minutos); si no, o
// si no tiene hora de fin, la de ahora.
function horaInicialCierre(s, ahora = Date.now()){
  const fin = finPrevistoDiaNinera(s);
  return fin != null && ahora >= fin - 15 * 60000 ? horaCortaNinera(s.hora_fin) : horaMvdNinera(ahora);
}

async function pantallaCierreSitting(id){
  let s;
  try{
    await cargarDiaNinera();
    s = diaNinera.find(x => x.id === id);
  }catch(err){
    console.error('[el día] al abrir el cierre', err);
    toast(FALLA_CARGAR_DIA, 'bad');
    if(rutaActual() !== '#inicio') await renderInicio();
    return;
  }
  if(diaNineraSinMigrar || !s){
    toast('Este sitting ya no está para cerrar. Si algo no está bien, escríbenos por el chat.', 'bad');
    return renderInicio();
  }
  marcarRuta(`#sitting/${id}/cierre`);
  if(s.cerrado_en) return pantallaGraciasCierre();
  comprobanteCierreElegido = null;
  if(s.tipo === 'traslado') return pantallaCierreTraslado(s);
  const radios = (nombre, opciones, onchange = '') => opciones.map(([valor, texto]) =>
    `<label class="radio"><input type="radio" name="${nombre}" value="${escaparHtml(valor)}"${onchange ? ` onchange="${onchange}"` : ''}> ${escaparHtml(texto)}</label>`).join('');
  pintar(`<main class="pantalla pantalla-cierre">
    <header class="cabecera">
      <img src="../logo-simbolo.png" alt="" class="cabecera-simbolo">
      <h1>¿Hasta qué hora estuviste?</h1>
    </header>
    <p class="helper">${escaparHtml(s.fecha < todayISO() ? 'Sitting de ayer' : 'Sitting de hoy')}${s.hora_inicio ? `, desde las ${escaparHtml(horaCortaNinera(s.hora_inicio))}` : ''}${s.zona ? `, en ${escaparHtml(s.zona)}` : ''}.</p>
    <div class="field">
      <label for="cierre-hora">Hora en que te fuiste</label>
      <input type="time" id="cierre-hora" value="${escaparHtml(horaInicialCierre(s))}" oninput="pintarDiferenciaCierre(${argJs(id)})">
      <p class="aviso-info" id="cierre-diferencia" aria-live="polite"></p>
    </div>
    <button type="button" class="btn ghost ancho" onclick="horaAhoraCierre(${argJs(id)})">Se extendió el sitting</button>
    ${htmlGastoCierre('¿Hubo algún gasto extra?')}
    <div class="field">
      <label for="cierre-comentarios">Comentarios extras</label>
      <textarea id="cierre-comentarios" rows="3" maxlength="2000"></textarea>
      <p class="helper">Llegan al instante al equipo.</p>
    </div>
    <fieldset class="grupo cierre-estrellas">
      <legend>¿Cómo te fue con la familia?</legend>
      ${[1, 2, 3, 4, 5].map(n => `<label class="radio estrella" aria-label="${n} de 5"><input type="radio" name="cierre-estrellas" value="${n}"> ${'★'.repeat(n)}</label>`).join('')}
    </fieldset>
    <fieldset class="grupo">
      <legend>¿Te gustaría volver a esa casa?</legend>
      ${radios('cierre-volver', [['si', 'Sí'], ['otros', 'Prefiero otros perfiles']])}
    </fieldset>
    <div class="field">
      <label for="cierre-jugaron">¿A qué jugaron?</label>
      <textarea id="cierre-jugaron" rows="2" maxlength="2000"></textarea>
      <p class="helper">Deja feedback de juguetes si corresponde.</p>
    </div>
    <div class="field">
      <label for="cierre-equipo">Comentarios para el equipo</label>
      <textarea id="cierre-equipo" rows="2" maxlength="2000"></textarea>
      <p class="helper">No lo ve la familia.</p>
    </div>
    <p class="error-form" id="cierre-error" role="alert"></p>
    <button type="button" class="btn primary ancho" onclick="conGuardado(this, ()=>enviarCierreSitting(${argJs(id)}))">Enviar</button>
    <button type="button" class="link-boton" onclick="renderInicio()">Volver</button>
  </main>`);
  pintarDiferenciaCierre(id);
}

// El gasto del cierre (sitting o traslado): "¿Hubo...?" Sí / No y, con Sí, monto, en qué y la foto.
function htmlGastoCierre(pregunta, ejemplo = ''){
  return `<fieldset class="grupo">
      <legend>${escaparHtml(pregunta)}</legend>
      ${[['no', 'No'], ['si', 'Sí']].map(([valor, texto]) => `<label class="radio"><input type="radio" name="cierre-gasto" value="${valor}" onchange="mostrarGastoCierre()"> ${texto}</label>`).join('')}
      <div id="cierre-gasto-datos" hidden>
        <div class="field">
          <label for="cierre-gasto-monto">Monto</label>
          <input type="number" id="cierre-gasto-monto" inputmode="decimal" min="1" step="1">
        </div>
        <div class="field">
          <label for="cierre-gasto-concepto">¿En qué?</label>
          <input type="text" id="cierre-gasto-concepto" maxlength="120" autocomplete="off"${ejemplo ? ` placeholder="${escaparHtml(ejemplo)}"` : ''}>
        </div>
        <div class="field">
          <label for="cierre-gasto-foto">Foto del comprobante</label>
          <input type="file" id="cierre-gasto-foto" accept="image/*" onchange="elegirComprobanteCierre(this)">
        </div>
        <p class="helper">Te lo reintegramos junto al pago.</p>
      </div>
    </fieldset>`;
}

// El cierre de un traslado (decisiones.md 6.10): sin hora (es un viaje), el gasto y los comentarios.
function pantallaCierreTraslado(s){
  const id = argJs(s.id);
  const ruta = s.zona && s.destino_zona ? `, de ${s.zona} a ${s.destino_zona}` : s.zona ? `, desde ${s.zona}` : '';
  pintar(`<main class="pantalla pantalla-cierre">
    <header class="cabecera">
      <img src="../logo-simbolo.png" alt="" class="cabecera-simbolo">
      <h1>Cierre del traslado</h1>
    </header>
    <p class="helper">${escaparHtml(`${s.fecha < todayISO() ? 'Traslado de ayer' : 'Traslado de hoy'}${s.hora_inicio ? `, a las ${horaCortaNinera(s.hora_inicio)}` : ''}${ruta}.`)}</p>
    ${htmlGastoCierre('¿Pagaste peajes, estacionamiento u otro gasto?', 'Peaje, estacionamiento')}
    <div class="field">
      <label for="cierre-comentarios">Comentarios extras</label>
      <textarea id="cierre-comentarios" rows="3" maxlength="2000"></textarea>
      <p class="helper">Llegan al instante al equipo.</p>
    </div>
    <p class="error-form" id="cierre-error" role="alert"></p>
    <button type="button" class="btn primary ancho" onclick="conGuardado(this, ()=>enviarCierreTraslado(${id}))">Enviar</button>
    <button type="button" class="link-boton" onclick="renderInicio()">Volver</button>
  </main>`);
}

// La hora elegida y si pasó la medianoche: antes (o igual) que el inicio es del día siguiente.
function horaElegidaCierre(s){
  const hora = (document.getElementById('cierre-hora')?.value || '').slice(0, 5);
  if(!/^\d{2}:\d{2}$/.test(hora)) return null;
  const diaSiguiente = !!s.hora_inicio && hora <= horaCortaNinera(s.hora_inicio);
  return { hora, diaSiguiente };
}

// "30 min más de lo previsto (19:00)." Sin montos (textos.md 5).
function textoDiferenciaCierre(s, elegida){
  if(!elegida) return '';
  const partes = [];
  const fin = finPrevistoDiaNinera(s);
  if(fin != null){
    const real = momentoDiaNinera(elegida.diaSiguiente ? sumarDiasISO(s.fecha, 1) : s.fecha, elegida.hora);
    const dif = Math.round((real - fin) / 60000);
    const previsto = horaCortaNinera(s.hora_fin);
    partes.push(dif === 0 ? `Igual a lo previsto (${previsto}).`
      : `${duracionDiaNinera(Math.abs(dif))} ${dif > 0 ? 'más' : 'menos'} de lo previsto (${previsto}).`);
  }
  if(elegida.diaSiguiente) partes.push('Terminó al día siguiente.');
  return partes.join(' ');
}
function pintarDiferenciaCierre(id){
  const s = diaNinera.find(x => x.id === id);
  const caja = document.getElementById('cierre-diferencia');
  if(s && caja) caja.textContent = textoDiferenciaCierre(s, horaElegidaCierre(s));
}
// "Se extendió el sitting": la hora de ahora.
function horaAhoraCierre(id){
  const input = document.getElementById('cierre-hora');
  if(input) input.value = horaMvdNinera(Date.now());
  pintarDiferenciaCierre(id);
}
function mostrarGastoCierre(){
  const marcado = document.querySelector('input[name="cierre-gasto"]:checked');
  const datos = document.getElementById('cierre-gasto-datos');
  if(datos) datos.hidden = !(marcado && marcado.value === 'si');
}
function elegirComprobanteCierre(input){
  comprobanteCierreElegido = (input.files && input.files[0]) || null;
}

function mensajeErrorCierre(err, s){
  const motivo = err?.message || '';
  if(/hora_invalida/.test(motivo)) return s.hora_inicio ? `Revisa la hora: tiene que ser después de las ${horaCortaNinera(s.hora_inicio)}.` : 'Revisa la hora.';
  if(/hora_futura/.test(motivo)) return 'Esa hora todavía no llegó. Pon la hora en que te fuiste.';
  if(/falta_comprobante/.test(motivo)) return 'Saca una foto del comprobante.';
  if(/gasto_sin_concepto/.test(motivo)) return 'Escribe en qué fue el gasto.';
  if(/gasto_invalido/.test(motivo)) return 'Revisa el monto del gasto.';
  if(/texto_largo/.test(motivo)) return 'Uno de los textos es muy largo. Acórtalo un poco.';
  return mensajeErrorDia(err, queDiaNinera(s));
}

// El gasto del cierre: lo que falta en la pantalla y, si hubo, la foto subida a comprobantes/ninieras/<su id>/<id>.jpg
// (la base arma la misma ruta). null (con el aviso escrito) si falta algo o falló la subida; si no, { monto, concepto }
// (null los dos sin gasto).
async function gastoCierreSubido(id, aviso, falta = 'Responde si hubo algún gasto extra.'){
  const gasto = document.querySelector('input[name="cierre-gasto"]:checked');
  if(!gasto){ aviso.textContent = falta; return null; }
  if(gasto.value !== 'si') return { monto: null, concepto: null };
  const monto = Number(String(document.getElementById('cierre-gasto-monto').value || '').replace(',', '.'));
  const concepto = (document.getElementById('cierre-gasto-concepto').value || '').replace(/\s+/g, ' ').trim();
  if(!(monto > 0)){ aviso.textContent = 'Pon el monto del gasto.'; return null; }
  if(!concepto){ aviso.textContent = 'Escribe en qué fue el gasto.'; return null; }
  if(!comprobanteCierreElegido){ aviso.textContent = 'Saca una foto del comprobante.'; return null; }
  const archivo = await achicarFoto(comprobanteCierreElegido, 1600, 0.8);
  if(!/^image\/(jpeg|png|webp)$/.test(archivo.type || '')){ aviso.textContent = FOTO_TIPO_INVALIDO; return null; }
  try{
    const { error } = await sbn.storage.from('comprobantes').upload(`ninieras/${nineraIdSesion}/${id}.jpg`, archivo, { upsert: true, contentType: archivo.type });
    if(error) throw error;
  }catch(err){
    console.error('[el día] al subir el comprobante', err);
    aviso.textContent = FALLA_SUBIR_COMPROBANTE;
    return null;
  }
  return { monto, concepto };
}

// Enviar: primero lo que falta en la pantalla, después la foto (si hubo gasto) y al final la base. Si algo
// falla, lo escrito queda en pantalla para volver a tocar "Enviar".
async function enviarCierreSitting(id){
  const aviso = document.getElementById('cierre-error');
  const s = diaNinera.find(x => x.id === id);
  if(!aviso || !s) return;
  const elegida = horaElegidaCierre(s);
  if(!elegida){ aviso.textContent = 'Pon la hora en que te fuiste.'; return; }
  const gasto = await gastoCierreSubido(id, aviso);
  if(!gasto) return;
  const { monto, concepto } = gasto;
  const valor = nombre => document.querySelector(`input[name="${nombre}"]:checked`)?.value || null;
  const texto = idCampo => (document.getElementById(idCampo)?.value || '').trim() || null;
  const estrellas = valor('cierre-estrellas'), volver = valor('cierre-volver');
  try{
    const { error } = await sbn.rpc('ninera_cerrar_sitting', {
      p_sitting_id: id, p_hora_fin: elegida.hora, p_dia_siguiente: elegida.diaSiguiente,
      p_comentarios: texto('cierre-comentarios'), p_calificacion: estrellas ? Number(estrellas) : null,
      p_volveria: volver === 'si' ? true : volver === 'otros' ? false : null,
      p_jugaron: texto('cierre-jugaron'), p_comentario_equipo: texto('cierre-equipo'),
      p_gasto_monto: monto, p_gasto_concepto: monto != null ? concepto : null,
    });
    if(error) throw error;
  }catch(err){
    console.error('[el día] al cerrar', err);
    aviso.textContent = mensajeErrorCierre(err, s);
    return;
  }
  comprobanteCierreElegido = null;
  pantallaGraciasCierre();
}

// Enviar el cierre del traslado: como el del sitting, sin hora.
async function enviarCierreTraslado(id){
  const aviso = document.getElementById('cierre-error');
  const s = diaNinera.find(x => x.id === id);
  if(!aviso || !s) return;
  const gasto = await gastoCierreSubido(id, aviso, 'Responde si pagaste algún gasto.');
  if(!gasto) return;
  try{
    const { error } = await sbn.rpc('ninera_cerrar_traslado', {
      p_sitting_id: id, p_comentarios: (document.getElementById('cierre-comentarios')?.value || '').trim() || null,
      p_gasto_monto: gasto.monto, p_gasto_concepto: gasto.monto != null ? gasto.concepto : null,
    });
    if(error) throw error;
  }catch(err){
    console.error('[el día] al cerrar el traslado', err);
    aviso.textContent = mensajeErrorCierre(err, s);
    return;
  }
  comprobanteCierreElegido = null;
  pantallaGraciasCierre();
}

function pantallaGraciasCierre(){
  const nombre = primerNombreNinera();
  pintar(`<main class="pantalla pantalla-cierre">
    <header class="cabecera">
      <img src="../logo-simbolo.png" alt="" class="cabecera-simbolo">
      <h1>${nombre ? `¡Gracias, ${escaparHtml(nombre)}!` : '¡Gracias!'}</h1>
    </header>
    <p class="mensaje" role="status">Ya quedó registrado.</p>
    <button type="button" class="btn primary ancho" onclick="renderInicio()">Volver al inicio</button>
  </main>`);
}
