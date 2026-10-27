// App de niñeras (fase 1, 26/10/2026): el inicio. En la etapa 1 no hay pedidos todavía: el saludo,
// el aviso si los avisos están apagados, "No tienes pedidos por ahora." y Mi cuenta. Sin montos ni
// fechas de pago, nunca (textos.md, sección 3). Los pedidos llegan en las etapas 5 y 6. Desde la
// etapa 2 (27/10/2026) el pie suma "Mi perfil" (perfil.js) y debajo de lo de hoy van los "Próximos
// sittings" (ninera_mis_sittings), las dos cosas salvo con la base sin migrar.

// El nombre viene en la cuenta (user_metadata, lo pone ninera-cuenta al crearla o al cambiar la
// contraseña): sirve en cualquier celular y en la app instalada. Se saluda con el primero.
function primerNombreNinera(){
  const nombre = sesionNinera && sesionNinera.user && sesionNinera.user.user_metadata && sesionNinera.user.user_metadata.nombre;
  return typeof nombre === 'string' ? (nombre.trim().split(/\s+/)[0] || '') : '';
}

async function renderInicio(){
  marcarRuta('#inicio');
  const nombre = primerNombreNinera();
  pintar(`<main class="pantalla">
    <header class="cabecera">
      <img src="../logo-simbolo.png" alt="" class="cabecera-simbolo">
      <h1>${nombre ? `Hola, ${escaparHtml(nombre)}` : 'Hola'}</h1>
    </header>
    <div id="inicio-avisos"></div>
    <p class="vacio">No tienes pedidos por ahora.</p>
    ${perfilNineraSinMigrar ? '' : `<section id="proximos-sittings" class="proximos" aria-live="polite">
      <h2>Próximos sittings</h2>
      <div id="proximos-sittings-lista"><p class="vacio">Cargando…</p></div>
    </section>`}
    <footer class="pie">
      ${perfilNineraSinMigrar ? '' : '<button type="button" class="link-boton" onclick="conGuardado(this, ()=>abrirMiPerfil())">Mi perfil</button>'}
      <button type="button" class="link-boton" onclick="abrirMiCuentaNinera()">Mi cuenta</button>
    </footer>
  </main>`);
  // Sin esperar: los sittings llegan solos a su sección y lo de arriba ya está en pantalla. Con la
  // base sin la migración de la etapa 2 ni se piden (ya se supo al leer el perfil).
  if(!perfilNineraSinMigrar) cargarProximosSittings();
  const cont = document.getElementById('inicio-avisos');
  // Abierta en el navegador del iPhone (sin avisos ahí): lo que falta es instalarla.
  if(!esAppInstalada() && !avisosSoportados()){
    cont.innerHTML = `<div class="aviso-apagado" role="alert">
      <p>Instala la app para recibir los pedidos.</p>
      <button class="btn primary ancho" onclick="irA('#instalar')">Ver cómo</button>
    </div>`;
    return;
  }
  // Se pinta primero y el aviso se suma después: mirar la suscripción puede tardar un momento.
  if(avisosSoportados() && !(await avisosActivados())){
    if(cont.isConnected) cont.innerHTML = `<div class="aviso-apagado" role="alert">
      <p>Avisos apagados. No te van a llegar los pedidos. Actívalos en Ajustes.</p>
      <button class="btn primary ancho" onclick="conGuardado(this, ()=>activarAvisosNinera('#inicio'))">Activar avisos</button>
    </div>`;
  }
}

// Sin conexión o la base no responde al arrancar: "Reintentar" vuelve a cargar.
function mostrarErrorCargaInicio(){
  mostrarErrorNinera('No pudimos cargar tus pedidos.', 'Revisa tu conexión a internet y vuelve a intentar.');
}

function abrirMiCuentaNinera(){
  abrirModalNinera(`<h2 class="modal-titulo">Mi cuenta</h2>
    <button class="btn ghost ancho" onclick="conGuardado(this, ()=>cerrarSesionNinera())">Cerrar sesión</button>`);
}

/* ---- Próximos sittings (etapa 2, 27/10/2026) ----
   De hoy a 60 días, previstos (los fijos que carga la base) y confirmados, desde
   ninera_mis_sittings(): la base nunca manda montos, notas internas ni el apellido de la madre, y la
   dirección (u origen / destino) solo cuando está confirmado. Se pinta solo #proximos-sittings: los
   avisos y el pie de arriba no se tocan. */

// Las filas de la última lectura: el detalle y el calendario las buscan por id.
let sittingsNineraCargados = [];
const FALLA_CARGAR_SITTINGS = 'No pudimos cargar tus sittings. Revisa tu conexión a internet y vuelve a intentar.';
const DIAS_CORTOS_NINERA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

async function cargarProximosSittings(){
  const lista = document.getElementById('proximos-sittings-lista');
  if(!lista) return;
  lista.innerHTML = '<p class="vacio">Cargando…</p>';
  let filas;
  try{
    const { data, error } = await sbn.rpc('ninera_mis_sittings');
    if(error) throw error;
    filas = Array.isArray(data) ? data : [];
  }catch(e){
    // Sin la función (base sin la migración): el inicio sigue como en la etapa 1, sin la sección.
    if(e && e.code === 'PGRST202'){
      const seccion = document.getElementById('proximos-sittings');
      if(seccion) seccion.remove();
      return;
    }
    console.error('[ninera_mis_sittings]', e);
    const actual = document.getElementById('proximos-sittings-lista');
    if(actual) actual.innerHTML = `<p class="vacio">${escaparHtml(FALLA_CARGAR_SITTINGS)}</p>
      <button type="button" class="btn ghost ancho reintentar" onclick="cargarProximosSittings()">Reintentar</button>`;
    return;
  }
  sittingsNineraCargados = filas;
  // Puede haber cambiado de pantalla mientras cargaba: se busca de nuevo.
  const actual = document.getElementById('proximos-sittings-lista');
  if(actual) actual.innerHTML = filas.length ? htmlSittingsNinera(filas) : '<p class="vacio">No tienes sittings próximos.</p>';
}

// "Hoy", "Mañana" o "jue 30/10". Al mediodía, como sumarDiasISO: la zona horaria del celular nunca
// mueve la fecha.
function textoDiaNinera(fechaISO, hoyISO){
  if(fechaISO === hoyISO) return 'Hoy';
  if(fechaISO === sumarDiasISO(hoyISO, 1)) return 'Mañana';
  const d = new Date(fechaISO + 'T12:00:00');
  return `${DIAS_CORTOS_NINERA[d.getDay()]} ${fechaISO.slice(8, 10)}/${fechaISO.slice(5, 7)}`;
}

function horaCortaNinera(h){ return String(h).slice(0, 5); }

// "18:00 a 22:00"; sin hora de fin (un traslado de ida, un pedido sin hora de vuelta), "desde las
// 18:00"; si cruza la medianoche, se dice: si no, "22:00 a 02:00" parece un error.
function horasSittingNinera(s){
  if(!s.hora_inicio) return 'horario a confirmar';
  const inicio = horaCortaNinera(s.hora_inicio);
  if(!s.hora_fin) return `desde las ${inicio}`;
  return `${inicio} a ${horaCortaNinera(s.hora_fin)}${s.termina_dia_siguiente ? ', termina al día siguiente' : ''}`;
}

function tipoSittingNinera(s){ return s.tipo === 'traslado' ? 'Traslado' : 'Sitting'; }

// La lista agrupada por día (vienen ordenadas por fecha y hora desde la base). Una tarjeta por
// sitting: se toca entera para ver el detalle.
function htmlSittingsNinera(filas, hoyISO = todayISO()){
  const dias = [];
  filas.forEach(s => {
    const ultimo = dias[dias.length - 1];
    if(ultimo && ultimo.fecha === s.fecha) ultimo.filas.push(s);
    else dias.push({ fecha: s.fecha, filas: [s] });
  });
  return dias.map(d => `<h3 class="sittings-dia">${escaparHtml(textoDiaNinera(d.fecha, hoyISO))}</h3>
    ${d.filas.map(s => `<button type="button" class="sitting-tarjeta" onclick="abrirDetalleSittingNinera(${argJs(s.id)})">
      <span class="sitting-horas">${escaparHtml(horasSittingNinera(s))}</span>
      <span class="sitting-tipo">${escaparHtml(tipoSittingNinera(s))}${s.zona ? ` · ${escaparHtml(s.zona)}` : ''}</span>
      ${s.madre ? `<span>Madre: ${escaparHtml(s.madre)}</span>` : ''}
      ${s.chicos ? `<span>Chicos: ${escaparHtml(s.chicos)}</span>` : ''}
    </button>`).join('')}`).join('');
}

// Adónde tiene que ir: en un traslado, el destino (o el origen si no hay); si no, la casa.
function lugarSittingNinera(s){
  if(s.tipo === 'traslado') return s.destino || s.origen || s.direccion || '';
  return s.direccion || '';
}

// En el iPhone abre Mapas de Apple; en el resto, Google Maps (web o la app si está instalada).
function linkMapaNinera(lugar){
  const q = encodeURIComponent(lugar);
  return /iPhone|iPad/.test(navigator.userAgent) ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function abrirDetalleSittingNinera(id){
  const s = sittingsNineraCargados.find(x => x.id === id);
  if(!s) return;
  const linea = (etiqueta, valor) => valor ? `<p><span class="detalle-etiqueta">${etiqueta}:</span> ${escaparHtml(valor)}</p>` : '';
  const lugar = lugarSittingNinera(s);
  let donde;
  if(s.tipo === 'traslado' && (s.origen || s.destino)) donde = linea('Desde', s.origen) + linea('Hasta', s.destino);
  else donde = linea('Dirección', s.direccion);
  // La base manda la dirección solo si está confirmado. Un previsto (un fijo antes de su día) la
  // muestra el día; un confirmado sin dirección cargada no promete nada.
  if(!lugar && s.estado === 'previsto') donde = '<p class="helper">La dirección aparece el día del sitting.</p>';
  abrirModalNinera(`<h2 class="modal-titulo">${escaparHtml(tipoSittingNinera(s))}</h2>
    <div class="detalle-sitting">
      <p class="detalle-cuando">${escaparHtml(textoDiaNinera(s.fecha, todayISO()))}, ${escaparHtml(horasSittingNinera(s))}</p>
      ${linea('Zona', s.zona)}
      ${linea('Madre', s.madre)}
      ${linea('Chicos', s.chicos)}
      ${donde}
    </div>
    ${lugar ? `<a class="btn primary ancho" href="${urlSegura(linkMapaNinera(lugar))}" target="_blank" rel="noopener">Cómo llegar</a>` : ''}
    <button type="button" class="btn ghost ancho" onclick="descargarIcsSitting(${argJs(s)})">Agregar al calendario</button>`);
}

/* ---- Calendario (.ics, RFC 5545) ----
   Hora local de Montevideo con su zona (VTIMEZONE: UTC-3 todo el año, sin horario de verano desde
   2015), así el evento cae a la misma hora aunque el celular esté en otra zona. Sin montos. */

// Texto de un campo: \ ; , y los saltos de línea van escapados.
function textoIcsNinera(t){
  return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Ninguna línea pasa de 75 bytes: se sigue en la próxima con un espacio adelante. Por letra, para no
// cortar una tilde (2 bytes en UTF-8) por la mitad.
function doblarLineaIcsNinera(linea){
  const utf8 = new TextEncoder();
  const partes = [];
  let actual = '', bytes = 0;
  for(const c of linea){
    const b = utf8.encode(c).length;
    const max = partes.length ? 74 : 75;
    if(bytes + b > max){ partes.push(actual); actual = ''; bytes = 0; }
    actual += c; bytes += b;
  }
  partes.push(actual);
  return partes.join('\r\n ');
}

function fechaIcsNinera(fechaISO){ return fechaISO.replace(/-/g, ''); }

// fecha + "HH:MM" + minutos → "AAAAMMDDTHHMMSS", pasando al día siguiente si hace falta.
function momentoIcsNinera(fechaISO, minutos){
  const dias = Math.floor(minutos / 1440), resto = minutos % 1440;
  const fecha = dias ? sumarDiasISO(fechaISO, dias) : fechaISO;
  return `${fechaIcsNinera(fecha)}T${String(Math.floor(resto / 60)).padStart(2, '0')}${String(resto % 60).padStart(2, '0')}00`;
}
function minutosNinera(h){ const [hh, mm] = String(h).split(':').map(Number); return hh * 60 + mm; }

// El texto del .ics de un sitting. `ahora` es el DTSTAMP (cuándo se armó el archivo).
function armarIcsSitting(s, ahora = new Date()){
  const stamp = ahora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const tz = 'TZID=America/Montevideo';
  let cuando;
  if(!s.hora_inicio){
    // Sin hora: un evento de todo el día.
    cuando = [`DTSTART;VALUE=DATE:${fechaIcsNinera(s.fecha)}`, `DTEND;VALUE=DATE:${fechaIcsNinera(sumarDiasISO(s.fecha, 1))}`];
  }else{
    const inicio = minutosNinera(s.hora_inicio);
    let fin;
    if(!s.hora_fin) fin = inicio + 60; // sin hora de fin: una hora, para que se vea en el calendario
    else{
      fin = minutosNinera(s.hora_fin);
      // Cruza la medianoche (o un fin que no está después del inicio: el calendario no acepta un
      // evento que termina antes de empezar).
      if(s.termina_dia_siguiente || fin <= inicio) fin += 1440;
    }
    cuando = [`DTSTART;${tz}:${momentoIcsNinera(s.fecha, inicio)}`, `DTEND;${tz}:${momentoIcsNinera(s.fecha, fin)}`];
  }
  const descripcion = [
    s.madre ? `Madre: ${s.madre}` : '',
    s.chicos ? `Chicos: ${s.chicos}` : '',
    s.tipo === 'traslado' && s.origen ? `Desde: ${s.origen}` : '',
    s.tipo === 'traslado' && s.destino ? `Hasta: ${s.destino}` : '',
  ].filter(Boolean).join('\n');
  const lugar = lugarSittingNinera(s);
  const lineas = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Parents Break//App ninieras//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:America/Montevideo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
    'TZOFFSETFROM:-0300', 'TZOFFSETTO:-0300', 'TZNAME:-03', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', `UID:${s.id}@parentsbreak`, `DTSTAMP:${stamp}`, ...cuando,
    `SUMMARY:${tipoSittingNinera(s)} Parents' Break`,
    lugar ? `LOCATION:${textoIcsNinera(lugar)}` : '',
    descripcion ? `DESCRIPTION:${textoIcsNinera(descripcion)}` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lineas.map(doblarLineaIcsNinera).join('\r\n') + '\r\n';
}

// Baja el archivo: el celular lo ofrece para sumarlo al calendario.
function descargarIcsSitting(s){
  const url = URL.createObjectURL(new Blob([armarIcsSitting(s)], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `sitting-${s.fecha}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
