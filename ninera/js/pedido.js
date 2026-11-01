// App de niñeras (fase 1, etapa 5, 02/11/2026): los pedidos que manda una admin. En el inicio, arriba de
// "Próximos sittings": "Pedidos por responder" (con "Puedo" / "No puedo") y "Esperando confirmación" (lo
// que ya dijo que puede). "No puedo" pide el motivo y después ofrece marcar otros días en que no puede.
// Un push abre #pedido/<id>. Lee y escribe solo por ninera_mis_pedidos(), responder_pedido() y
// ninera_marcar_no_disponible(): la base nunca manda la familia, la dirección, el cobro ni las notas.
// Textos en "tú" (docs/fase1/textos.md 4). Nada de montos fuera del precio por hora.
// Etapa 6 (03/11/2026): lo que se cerró llega una sola vez por la misma lectura. La tarjeta "¡Quedaste
// seleccionada!" va arriba hasta que abre los datos ("Ver los datos" la marca vista); "Ya se cubrió" y "Se
// canceló" (de las que habían dicho "Puedo") se muestran y se marcan vistos. Si marcar falla, no se rompe nada:
// vuelve a salir la próxima vez.

const FALLA_CARGAR_PEDIDOS = 'No pudimos cargar tus pedidos. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_RESPONDER_PEDIDO = 'No pudimos enviar tu respuesta. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_GUARDAR_DIAS = 'No pudimos guardar tus días. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_CARGAR_DIAS = 'No pudimos cargar tus días. Revisa tu conexión a internet y vuelve a intentar.';
const PEDIDO_CERRADO = 'Este pedido ya no está abierto.';
const MARCA_APROXIMADA_NINERA = '(aproximada, se puede extender)';
const DATOS_INCOMPLETOS_NINERA = 'Los datos todavía no están completos: escríbenos.';
const SIN_PEDIDOS_NINERA = 'No tienes pedidos por ahora.';
// En el orden de textos.md 4.
const MOTIVOS_NO_PUEDO_NINERA = [
  ['otro_trabajo', 'Tengo otro trabajo o sitting'], ['facultad', 'Tengo examen o facultad'], ['lejos', 'Me queda lejos'],
  ['tarde', 'Es muy tarde para la vuelta'], ['otro', 'Otro motivo'],
];
const DIAS_LARGOS_NINERA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_MARCABLES_NINERA = 14;

// Los pedidos de la última lectura (los dos estados), el aviso de arriba ("ya no está abierto") y el
// pedido que acaba de abrir un push (se lo marca). `lecturaPedidosNinera` descarta una lectura vieja que
// llega después de otra; `cargaPedidosNinera` es la lectura en curso (abrirPedidoNinera la espera).
let pedidosNineraCargados = [];
let pedidosNineraSinMigrar = false;
let avisoPedidosNinera = '';
let pedidoDestacadoNinera = null;
let lecturaPedidosNinera = 0;
// Los avisos de "Ya se cubrió" / "Se canceló" que ya se mostraron (id → texto): la base los devuelve una sola vez
// y se marcan vistos al mostrarse, así que se guardan en memoria hasta cerrar sesión o recargar la app (fix 03/11/2026:
// si iba a otra pantalla y volvía al inicio antes de leerlo, se perdía para siempre). cerrarSesionNinera los vacía.
let avisosCierreNinera = new Map();
let marcandoVistoNinera = new Set();
let cargaPedidosNinera = Promise.resolve();

/* ---- Textos de una tarjeta ---- */

// "Sábado 07/11". Al mediodía, como sumarDiasISO: la zona horaria del celular nunca mueve la fecha.
function diaLargoNinera(fechaISO){
  return `${DIAS_LARGOS_NINERA[new Date(fechaISO + 'T12:00:00').getDay()]} ${fechaISO.slice(8, 10)}/${fechaISO.slice(5, 7)}`;
}

// Precio con signo de peso (mil doscientos cincuenta = "$" + 1.250): sin centavos y con punto de miles, como pesos_texto() de la base y el push del pedido.
// (Es solo texto de lo que se le ofreció; no calcula nada de plata.)
function pesosTextoNinera(monto){
  const n = Number(monto);
  if(monto == null || !isFinite(n)) return '';
  return '$' + String(Math.trunc(n + 0.5)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// "HH:MM" en Montevideo, aunque el celular tenga otra zona.
function horaMontevideoNinera(ts){
  const d = new Date(ts);
  if(isNaN(d)) return '';
  return new Intl.DateTimeFormat('es-UY', { timeZone: 'America/Montevideo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

// El mismo texto que el push de la base: "(aproximada, se puede extender)" solo si el pedido trae la marca
// (horario_aproximado, etapa 6: antes iba siempre); sin fin, "sin hora de fin"; si pasa de la medianoche, se dice.
function horarioPedidoNinera(p){
  if(!p.hora_inicio) return 'horario a confirmar';
  const inicio = horaCortaNinera(p.hora_inicio);
  if(!p.hora_fin) return `${inicio}, sin hora de fin`;
  return `${inicio} – ${horaCortaNinera(p.hora_fin)}${p.termina_dia_siguiente ? ' del día siguiente' : ''}${p.horario_aproximado ? ` ${MARCA_APROXIMADA_NINERA}` : ''}`;
}

function limitePedidoNinera(p, ahora){
  if(!p.responder_hasta) return '';
  const t = Date.parse(p.responder_hasta);
  if(isNaN(t)) return '';
  return t > ahora.getTime() ? `Responde antes de las ${horaMontevideoNinera(p.responder_hasta)}` : 'Responde lo antes posible';
}

/* ---- Tarjetas y secciones ---- */

function tarjetaPedidoNinera(p, ahora){
  const esperandoConfirmar = p.estado === 'acepto';
  const limite = esperandoConfirmar ? '' : limitePedidoNinera(p, ahora);
  const precio = pesosTextoNinera(p.precio_hora);
  return `<article class="pedido-tarjeta${p.id === pedidoDestacadoNinera ? ' pedido-destacado' : ''}" id="pedido-${escaparHtml(p.id)}">
    ${limite ? `<p class="pedido-limite">${escaparHtml(limite)}</p>` : ''}
    <h3 class="pedido-dia">${escaparHtml(diaLargoNinera(p.fecha))}</h3>
    <div class="pedido-datos">
      <p>${escaparHtml(horarioPedidoNinera(p))}</p>
      ${p.zona ? `<p>Zona: ${escaparHtml(p.zona)}</p>` : ''}
      ${p.chicos ? `<p>${escaparHtml(p.chicos)}</p>` : ''}
      ${precio ? `<p>Precio por hora: ${escaparHtml(precio)}</p>` : ''}
    </div>
    ${esperandoConfirmar ? `<p class="pedido-dijiste">✓ Dijiste que puedes</p>
      <p class="helper">¡Gracias! Te confirmamos a la brevedad.</p>` : `<div class="pedido-botones">
      <button type="button" class="btn primary ancho" onclick="conGuardado(this, ()=>responderPedidoNinera(${argJs(p.id)}, 'acepto'))">Puedo</button>
      <button type="button" class="btn ghost ancho" onclick="pantallaNoPuedoNinera(${argJs(p.id)})">No puedo</button>
    </div>
    <p class="error-form pedido-error" role="alert"></p>`}
  </article>`;
}

const TITULO_SELECCIONADA_NINERA = '¡Quedaste seleccionada!';

// La tarjeta de la elegida: solo el día, el horario y a dónde tocar; los datos van en el detalle.
function tarjetaSeleccionadaNinera(p){
  return `<article class="pedido-tarjeta pedido-seleccionada" id="pedido-${escaparHtml(p.id)}">
    <p class="pedido-dato-principal">${escaparHtml(`${diaLargoNinera(p.fecha)}, ${horarioPedidoNinera(p)}. Ya tienes todos los datos.`)}</p>
    <button type="button" class="btn primary ancho" onclick="conGuardado(this, ()=>verDatosSeleccionadaNinera(${argJs(p.id)}))">Ver los datos</button>
  </article>`;
}

function textoCierreNinera(p){
  const dia = diaLargoNinera(p.fecha);
  return p.estado === 'cancelado'
    ? `Se canceló el pedido del ${dia}. Gracias por responder.`
    : `Este pedido ya se cubrió: ${dia}. Gracias por responder. ¡Te tendremos en cuenta para el próximo!`;
}

// Arriba la elegida, después los avisos de lo que se cerró, y las dos secciones de siempre. Sin nada de eso,
// lo de hoy. Vienen ordenados por fecha y hora desde la base.
function htmlPedidosNinera(filas, ahora = new Date()){
  const seleccionadas = filas.filter(p => p.estado === 'confirmada');
  const porResponder = filas.filter(p => p.estado === 'invitada');
  const esperando = filas.filter(p => p.estado === 'acepto');
  const cierres = [...avisosCierreNinera.values()];
  const seccion = (id, titulo, lista) => lista.length ? `<section class="pedidos" id="${id}">
    <h2>${titulo}</h2>
    ${lista.map(p => tarjetaPedidoNinera(p, ahora)).join('')}
  </section>` : '';
  const html = (seleccionadas.length ? `<section class="pedidos" id="pedidos-seleccionada">
    <h2>${TITULO_SELECCIONADA_NINERA}</h2>
    ${seleccionadas.map(tarjetaSeleccionadaNinera).join('')}
  </section>` : '')
    + cierres.map(t => `<p class="aviso-info aviso-pedido" role="status">${escaparHtml(t)}</p>`).join('')
    + seccion('pedidos-por-responder', 'Pedidos por responder', porResponder)
    + seccion('pedidos-esperando', 'Esperando confirmación', esperando);
  return seleccionadas.length || porResponder.length || esperando.length ? html : html + `<p class="vacio">${SIN_PEDIDOS_NINERA}</p>`;
}

// Lo que va en el inicio antes de que lleguen los pedidos. Con la base sin migrar (ya se supo), lo de hoy.
function htmlInicioPedidos(){
  const aviso = avisoPedidosNinera;
  avisoPedidosNinera = '';
  pedidoDestacadoNinera = null;
  return `<div id="inicio-pedidos" aria-live="polite">
    ${aviso ? `<p class="aviso-info" id="pedidos-aviso" role="status">${escaparHtml(aviso)}</p>` : ''}
    <div id="pedidos-lista">${pedidosNineraSinMigrar ? `<p class="vacio">${SIN_PEDIDOS_NINERA}</p>` : '<p class="vacio">Cargando…</p>'}</div>
  </div>`;
}

function pintarPedidosNinera(){
  const lista = document.getElementById('pedidos-lista');
  if(lista) lista.innerHTML = htmlPedidosNinera(pedidosNineraCargados);
}

// Un aviso arriba de los pedidos (se crea si no estaba).
function avisarPedidosNinera(texto){
  const cont = document.getElementById('inicio-pedidos');
  if(!cont){ avisoPedidosNinera = texto; return; }
  let el = document.getElementById('pedidos-aviso');
  if(!el){
    el = document.createElement('p');
    el.id = 'pedidos-aviso';
    el.className = 'aviso-info';
    el.setAttribute('role', 'status');
    cont.insertBefore(el, cont.firstChild);
  }
  el.textContent = texto;
}

/* ---- Lectura ---- */

// silencioso: al volver a la app o con un push, sin tocar lo que ya está a la vista si falla.
function cargarPedidosNinera({ silencioso = false } = {}){
  if(pedidosNineraSinMigrar) return Promise.resolve();
  cargaPedidosNinera = leerPedidosNinera(silencioso);
  return cargaPedidosNinera;
}

async function leerPedidosNinera(silencioso){
  if(!document.getElementById('pedidos-lista')) return;
  const lectura = ++lecturaPedidosNinera;
  let filas;
  try{
    const { data, error } = await sbn.rpc('ninera_mis_pedidos');
    if(error) throw error;
    filas = Array.isArray(data) ? data : [];
  }catch(e){
    if(lectura !== lecturaPedidosNinera) return;
    // Sin la función (base sin la migración de la etapa 5): el inicio como siempre.
    if(e && e.code === 'PGRST202'){
      pedidosNineraSinMigrar = true;
      pedidosNineraCargados = [];
      pintarPedidosNinera();
      return;
    }
    console.error('[pedidos]', e);
    if(silencioso) return;
    const lista = document.getElementById('pedidos-lista');
    if(lista) lista.innerHTML = `<p class="vacio">${escaparHtml(FALLA_CARGAR_PEDIDOS)}</p>
      <button type="button" class="btn ghost ancho reintentar" onclick="cargarPedidosNinera()">Reintentar</button>`;
    return;
  }
  // Otra lectura más nueva salió mientras esta volaba: manda esa.
  if(lectura !== lecturaPedidosNinera) return;
  pedidosNineraCargados = filas;
  registrarCierresNinera(filas);
  pintarPedidosNinera();
}

// Lo que se cerró (cubierto / cancelado) se anota para mostrarlo y se marca visto: así sale una sola vez.
function registrarCierresNinera(filas){
  filas.filter(p => p.estado === 'cubierto' || p.estado === 'cancelado').forEach(p => {
    avisosCierreNinera.set(p.id, textoCierreNinera(p));
    marcarVistoPedidoNinera(p.id);
  });
}

// Marca una fila como vista. Si falla (sin conexión, base sin migrar) se sigue: la fila vuelve en la próxima lectura.
async function marcarVistoPedidoNinera(snId){
  if(marcandoVistoNinera.has(snId)) return false;
  marcandoVistoNinera.add(snId);
  try{
    const { error } = await sbn.rpc('ninera_marcar_pedido_visto', { p_sn_id: snId });
    if(error) throw error;
    return true;
  }catch(e){
    console.error('[marcar_pedido_visto]', e);
    return false;
  }finally{
    marcandoVistoNinera.delete(snId);
  }
}

// Al volver a la app con el inicio a la vista: en el iPhone lo que se mandó con la pantalla apagada no
// llegó por ningún lado. (Con otra pantalla abierta no hace nada: el inicio se vuelve a leer al volver.)
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible' && document.getElementById('pedidos-lista')) cargarPedidosNinera({ silencioso: true });
});

// #pedido/<id>, de un push (o de un aviso): el inicio con ese pedido marcado y a la vista. Si ya no está
// (se cubrió, lo cancelaron o ya lo respondió y salió de la lista), el aviso de siempre.
async function abrirPedidoNinera(id){
  if(document.getElementById('pedidos-lista')){
    marcarRuta('#inicio');
    await cargarPedidosNinera();
  }else{
    await renderInicio();
    await cargaPedidosNinera;
  }
  const buscado = pedidosNineraCargados.find(p => p.id === id);
  if(!buscado){
    if(!pedidosNineraSinMigrar && document.getElementById('pedidos-lista')) avisarPedidosNinera(PEDIDO_CERRADO);
    return;
  }
  // Ya la eligieron: sus datos. Lo que se cerró ya está a la vista como aviso.
  if(buscado.estado === 'confirmada'){ await verDatosSeleccionadaNinera(id); return; }
  if(buscado.estado === 'cubierto' || buscado.estado === 'cancelado') return;
  pedidoDestacadoNinera = id;
  pintarPedidosNinera();
  const t = document.getElementById(`pedido-${id}`);
  if(t) t.scrollIntoView({ block: 'center' });
}

/* ---- "¡Quedaste seleccionada!": los datos ---- */

// El mismo detalle de "Próximos sittings" (se busca por solicitud_id), con otro título. Se vuelve a leer la
// lista: la elección es de hace un momento y la que está cargada puede ser anterior. Si el registro no está
// (falló al cargarse), se ve lo que trae el pedido y se avisa que falta completar.
async function verDatosSeleccionadaNinera(snId){
  const p = pedidosNineraCargados.find(x => x.id === snId);
  if(!p) return;
  try{
    const { data, error } = await sbn.rpc('ninera_mis_sittings');
    if(error) throw error;
    if(Array.isArray(data)) sittingsNineraCargados = data;
  }catch(e){
    console.error('[ninera_mis_sittings]', e);
  }
  const s = p.solicitud_id ? sittingsNineraCargados.find(x => x.solicitud_id === p.solicitud_id) : null;
  if(s) abrirDetalleSittingNinera(s.id, { titulo: TITULO_SELECCIONADA_NINERA });
  else abrirDatosDelPedidoNinera(p);
  await marcarVistoPedidoNinera(snId);
  pedidosNineraCargados = pedidosNineraCargados.filter(x => x.id !== snId);
  pintarPedidosNinera();
}

function abrirDatosDelPedidoNinera(p){
  const linea = (etiqueta, valor) => valor ? `<p><span class="detalle-etiqueta">${etiqueta}:</span> ${escaparHtml(valor)}</p>` : '';
  abrirModalNinera(`<h2 class="modal-titulo">${TITULO_SELECCIONADA_NINERA}</h2>
    <div class="detalle-sitting">
      <p class="detalle-cuando">${escaparHtml(`${diaLargoNinera(p.fecha)}, ${horarioPedidoNinera(p)}`)}</p>
      ${linea('Zona', p.zona)}
      ${linea('Chicos', p.chicos)}
      ${linea('Precio por hora', pesosTextoNinera(p.precio_hora))}
      <p class="helper">${DATOS_INCOMPLETOS_NINERA}</p>
    </div>`);
}

/* ---- "Puedo" ---- */

// Llama a responder_pedido: 'ok', 'ya_respondido' o 'cerrado'; un error tira.
async function enviarRespuestaPedidoNinera(snId, respuesta, motivo = null, motivoTexto = null){
  const { data, error } = await sbn.rpc('responder_pedido', { p_sn_id: snId, p_respuesta: respuesta, p_motivo: motivo, p_motivo_texto: motivoTexto });
  if(error) throw error;
  return data;
}

function textoErrorRespuestaNinera(e){
  // La dieron de baja con la app abierta: reintentar no sirve, que lo sepa.
  return e && /no_autorizada/.test(e.message || '') ? CUENTA_NO_ACTIVA : FALLA_RESPONDER_PEDIDO;
}

// Sacado de la lista porque ya no está abierto (lo asignó otra admin, lo cancelaron o ya no existe).
function sacarPedidoCerradoNinera(snId){
  pedidosNineraCargados = pedidosNineraCargados.filter(p => p.id !== snId);
  pintarPedidosNinera();
  avisarPedidosNinera(PEDIDO_CERRADO);
}

async function responderPedidoNinera(snId, respuesta){
  let resultado;
  try{
    resultado = await enviarRespuestaPedidoNinera(snId, respuesta);
  }catch(e){
    if(/no_existe/.test((e && e.message) || '')){ sacarPedidoCerradoNinera(snId); return; }
    console.error('[responder_pedido]', e);
    const t = document.getElementById(`pedido-${snId}`);
    const aviso = t && t.querySelector('.pedido-error');
    if(aviso) aviso.textContent = textoErrorRespuestaNinera(e);
    return;
  }
  if(resultado === 'cerrado'){ sacarPedidoCerradoNinera(snId); return; }
  if(resultado === 'ok'){
    // Se ve ya; lo que diga la base llega con la lectura de abajo.
    const p = pedidosNineraCargados.find(x => x.id === snId);
    if(p) p.estado = 'acepto';
    pintarPedidosNinera();
  }
  // 'ya_respondido' (desde otro celular o con un doble toque): queda como está en la base.
  await cargarPedidosNinera({ silencioso: true });
}

/* ---- "No puedo": el motivo y los días ---- */

function pantallaNoPuedoNinera(snId){
  if(!pedidosNineraCargados.some(p => p.id === snId)){ renderInicio(); return; }
  marcarRuta('#no-puedo');
  pintar(`<main class="pantalla pantalla-pedido">
    <header class="cabecera">
      <img src="../logo-simbolo.png" alt="" class="cabecera-simbolo">
      <h1>¿Cuál es el motivo?</h1>
    </header>
    <p class="helper">Lo ve solo el equipo.</p>
    <fieldset class="grupo">
      ${MOTIVOS_NO_PUEDO_NINERA.map(([clave, texto]) => `<label class="radio"><input type="radio" name="motivo" value="${clave}" onchange="alElegirMotivoNinera()">${escaparHtml(texto)}</label>`).join('')}
    </fieldset>
    <div id="motivo-otro" hidden>
      <input type="text" id="motivo-texto" maxlength="200" autocomplete="off" aria-label="Escribe el motivo">
    </div>
    <p class="error-form" id="motivo-error" role="alert"></p>
    <button type="button" class="btn primary ancho" id="motivo-enviar" disabled onclick="conGuardado(this, ()=>enviarNoPuedoNinera(${argJs(snId)}))">Enviar</button>
    <button type="button" class="link-boton" onclick="renderInicio()">Volver</button>
  </main>`);
}

function motivoElegidoNinera(){
  const r = document.querySelector('input[name="motivo"]:checked');
  return r ? r.value : '';
}

function alElegirMotivoNinera(){
  const motivo = motivoElegidoNinera();
  const otro = document.getElementById('motivo-otro');
  if(otro) otro.hidden = motivo !== 'otro';
  const enviar = document.getElementById('motivo-enviar');
  if(enviar && !enviar.dataset.guardando) enviar.disabled = !motivo;
  if(motivo === 'otro'){ const campo = document.getElementById('motivo-texto'); if(campo) campo.focus(); }
}

async function enviarNoPuedoNinera(snId){
  const motivo = motivoElegidoNinera();
  if(!motivo) return;
  const campo = document.getElementById('motivo-texto');
  const texto = motivo === 'otro' && campo ? campo.value.trim() : '';
  const aviso = document.getElementById('motivo-error');
  if(aviso) aviso.textContent = '';
  let resultado;
  try{
    resultado = await enviarRespuestaPedidoNinera(snId, 'no_puedo', motivo, texto || null);
  }catch(e){
    if(/no_existe/.test((e && e.message) || '')) resultado = 'cerrado';
    else{
      console.error('[responder_pedido]', e);
      if(aviso) aviso.textContent = textoErrorRespuestaNinera(e);
      return;
    }
  }
  if(resultado === 'cerrado'){ avisoPedidosNinera = PEDIDO_CERRADO; await renderInicio(); return; }
  if(resultado === 'ya_respondido'){ await renderInicio(); return; }
  pedidosNineraCargados = pedidosNineraCargados.filter(p => p.id !== snId);
  await pantallaDiasNinera();
}

// Los próximos 14 días, con los que ya marcó encendidos. Lee su propia tabla (la RLS deja ver solo los
// suyos) y escribe por la RPC. Lo marcado vive acá hasta "Guardar": tocar enciende o apaga.
let diasNineraOriginales = new Set();
let diasNineraElegidos = new Set();

function etiquetaDiaCortoNinera(fechaISO){
  const d = new Date(fechaISO + 'T12:00:00');
  return `${DIAS_CORTOS_NINERA[d.getDay()][0].toUpperCase()}${DIAS_CORTOS_NINERA[d.getDay()].slice(1)} ${fechaISO.slice(8, 10)}/${fechaISO.slice(5, 7)}`;
}

async function pantallaDiasNinera(){
  const hoy = todayISO();
  const fechas = Array.from({ length: DIAS_MARCABLES_NINERA }, (_, i) => sumarDiasISO(hoy, i));
  let leidos = null;
  try{
    const { data, error } = await sbn.from('ninera_no_disponible').select('fecha').gte('fecha', hoy).lte('fecha', fechas[fechas.length - 1]);
    if(error) throw error;
    leidos = new Set((data || []).map(x => x.fecha));
  }catch(e){
    console.error('[no_disponible]', e);
  }
  diasNineraOriginales = leidos || new Set();
  diasNineraElegidos = new Set(diasNineraOriginales);
  marcarRuta('#no-puedo');
  pintar(`<main class="pantalla pantalla-pedido">
    <header class="cabecera">
      <img src="../logo-simbolo.png" alt="" class="cabecera-simbolo">
      <h1>¿Quieres marcar otros días en los que no puedes?</h1>
    </header>
    ${leidos ? `<div class="dias-grilla">${fechas.map(f => `<button type="button" class="dia-op" data-fecha="${f}" aria-pressed="${diasNineraElegidos.has(f)}" onclick="alternarDiaNinera(${argJs(f)})">${escaparHtml(etiquetaDiaCortoNinera(f))}</button>`).join('')}</div>` : ''}
    <p class="error-form" id="dias-error" role="alert">${leidos ? '' : escaparHtml(FALLA_CARGAR_DIAS)}</p>
    ${leidos ? '<button type="button" class="btn primary ancho" onclick="conGuardado(this, ()=>guardarDiasNinera())">Guardar</button>' : ''}
    <button type="button" class="${leidos ? 'link-boton' : 'btn ghost ancho'}" onclick="renderInicio()">No, gracias</button>
  </main>`);
}

function alternarDiaNinera(fecha){
  if(diasNineraElegidos.has(fecha)) diasNineraElegidos.delete(fecha); else diasNineraElegidos.add(fecha);
  const b = document.querySelector(`.dia-op[data-fecha="${fecha}"]`);
  if(b) b.setAttribute('aria-pressed', String(diasNineraElegidos.has(fecha)));
}

// Dos llamadas como mucho: las que sumó y las que quitó. Lo que ya se guardó deja de contar, así un
// reintento (si falló la segunda) no repite la primera.
async function guardarDiasNinera(){
  const aviso = document.getElementById('dias-error');
  if(aviso) aviso.textContent = '';
  const nuevos = [...diasNineraElegidos].filter(f => !diasNineraOriginales.has(f)).sort();
  const quitados = [...diasNineraOriginales].filter(f => !diasNineraElegidos.has(f)).sort();
  try{
    if(nuevos.length){
      const { error } = await sbn.rpc('ninera_marcar_no_disponible', { p_fechas: nuevos, p_quitar: false });
      if(error) throw error;
      nuevos.forEach(f => diasNineraOriginales.add(f));
    }
    if(quitados.length){
      const { error } = await sbn.rpc('ninera_marcar_no_disponible', { p_fechas: quitados, p_quitar: true });
      if(error) throw error;
      quitados.forEach(f => diasNineraOriginales.delete(f));
    }
  }catch(e){
    console.error('[marcar_no_disponible]', e);
    if(aviso) aviso.textContent = FALLA_GUARDAR_DIAS;
    return;
  }
  await renderInicio();
}
