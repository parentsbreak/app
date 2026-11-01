/* ================= PEDIDOS (fase 1, etapa 5) =================
   El orden de las niñeras sugeridas para un pedido (reglas-del-negocio.md, sección 5) vive acá,
   en funciones puras: no leen la base ni el DOM, reciben datos que una admin ya puede leer. Así la
   Agenda, el ticket de WhatsApp y "Elegir niñeras" no ordenan distinto según desde dónde se abrió.
   Se usan en tiempo de ejecución (no desde el nivel superior): `nineraHaceTipo` es de agenda.js y
   `mismoGrupoZona` de core.js. */

// Mismo criterio que la base (`normaliza_nombre(btrim(...))`): el histórico viejo no tiene ids y
// se cruza por nombre, y un espacio de más no tiene que separar a la misma persona en dos.
function sugeridaClave(ninera){ return normaliza(String(ninera.nombre || ninera.id || '').trim()); }

// Una niñera de práctica lleva "(práctica)" en el nombre, con o sin tilde. La base usa la misma
// regla: el pedido de práctica solo les llega a ellas y el real solo a las reales (4.17).
function nineraEsPractica(ninera){ return normaliza(String(ninera.nombre || '').trim()).includes('(practica)'); }

function sugeridaNumero(valor){
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

// Valor de un mapa por id y, como respaldo, por nombre normalizado (historia sin ids).
function sugeridaValor(mapa, ninera, clave){
  if(!mapa) return 0;
  return sugeridaNumero(mapa[ninera.id]) || sugeridaNumero(mapa[clave]);
}
function sugeridaEnLista(lista, ninera, clave){ return lista.has(ninera.id) || lista.has(clave); }

// "4", "4 y 7", "3, 4 y 7" + " años".
function sugeridaTextoEdades(edades){
  const t = edades.length > 1 ? edades.slice(0, -1).join(', ') + ' y ' + edades[edades.length - 1] : String(edades[0]);
  return `${t} ${edades.length === 1 && edades[0] === 1 ? 'año' : 'años'}`;
}

function sugeridaPorque(item){
  const veces = `Fue ${item.vecesFamilia} ${item.vecesFamilia === 1 ? 'vez' : 'veces'}.`;
  if(item.bloque === 1) return item.pedida ? (item.vecesFamilia ? `La pidió la madre. ${veces}` : 'La pidió la madre.') : veces;
  const partes = [`${item.total} ${item.total === 1 ? 'sitting' : 'sittings'}.`];
  if(item.edadesCoinciden.length) partes.push(`Cuidó chicos de ${sugeridaTextoEdades(item.edadesCoinciden)}.`);
  if(item.varios) partes.push('Cuidó familias con 3 o más chicos.');
  return partes.join(' ');
}

/* Junta lo que devuelve la RPC `sugeridas_datos` en los mapas que usa `ordenarSugeridas`. Las filas
   con `ninera_id` suman por id; las sin id (204 de 641 registros viejos, 31/10/2026) traen
   `ninera_clave` y se cruzan con el nombre normalizado de la lista: las dos suman a la misma niñera. */
function mapasSugeridas(respuesta, ninieras){
  const porClave = {}, porId = {};
  (ninieras || []).forEach(n => { porId[n.id] = n; const k = sugeridaClave(n); if(k && !porClave[k]) porClave[k] = n; });
  const m = { historialFamilia: {}, historialTotal: {}, sittingsSemana: {}, edadesCuidadas: {}, maxChicos: {},
    rechazosSeguidos: {}, incidentesFamilia: [], noDisponibles: [] };
  const sumar = (mapa, id, n) => { n = sugeridaNumero(n); if(n) mapa[id] = (mapa[id] || 0) + n; };
  ((respuesta && respuesta.historial) || []).forEach(h => {
    const n = (h.ninera_id && porId[h.ninera_id]) || (h.ninera_clave && porClave[normaliza(String(h.ninera_clave).trim())]);
    if(!n) return;
    sumar(m.historialFamilia, n.id, h.veces_familia);
    sumar(m.historialTotal, n.id, h.total);
    sumar(m.sittingsSemana, n.id, h.semana);
    const edades = new Set(m.edadesCuidadas[n.id] || []);
    (h.edades || []).forEach(e => edades.add(Number(e)));
    if(edades.size) m.edadesCuidadas[n.id] = [...edades].sort((a, b) => a - b);
    const mc = sugeridaNumero(h.max_chicos);
    if(mc > (m.maxChicos[n.id] || 0)) m.maxChicos[n.id] = mc;
  });
  ((respuesta && respuesta.por_ninera) || []).forEach(p => {
    if(!porId[p.ninera_id]) return;
    sumar(m.rechazosSeguidos, p.ninera_id, p.no_puedo_seguidos);
    if(p.incidente_familia) m.incidentesFamilia.push(p.ninera_id);
    if(p.no_disponible) m.noDisponibles.push(p.ninera_id);
  });
  return m;
}

/* Ordena sin esconder a nadie que la admin pueda querer. Las que no pueden recibir el pedido quedan
   en `descartadas` con su motivo; las inactivas van aparte, al fondo; las que "bajan" (no puede ese
   día, 3 "No puedo" seguidos, incidente con la familia, prefiere otros perfiles, 4 sittings esa
   semana) siguen en su bloque pero debajo de las que no bajan, con la marca a la vista.
   Bloque 1: ya fue a esa casa (la pedida primero, después más veces). Bloque 2: nunca fue, de la zona
   del pedido. Bloque 3: nunca fue, de otra zona. 2 y 3: más sittings, más edades del pedido y, con
   3 o más chicos, las que cuidaron a varios. Con familia "solo conocidas" los bloques 2 y 3 van a
   `ocultas` hasta que la admin pida las nuevas (`mostrar_nuevas`).
   Las ya mandadas por la app conservan su lugar con su estado y no se vuelven a enviar. */
function ordenarSugeridas(pedido, datos = {}){
  const ninieras = datos.ninieras || [];
  const conjunto = l => new Set(l || []);
  const excluirIds = conjunto(datos.excluirIds), ocupadas = conjunto(datos.ocupadas), sinGuia = conjunto(datos.sinGuia);
  const noDisponibles = conjunto(datos.noDisponibles), incidentesFamilia = conjunto(datos.incidentesFamilia);
  const preferirOtros = conjunto(datos.preferirOtros), sinTemporada = conjunto(datos.sinTemporada);
  const fueraTemporada = datos.fueraTemporada || {}, enviadas = datos.enviadas || {};
  const pedidaId = pedido.ninera_pedida_id || null;
  const edadesPedido = [...new Set((pedido.edades || []).map(Number))];
  const masDeTres = sugeridaNumero(pedido.chicos) >= 3;
  const soloConocidas = !!pedido.solo_conocidas && !pedido.mostrar_nuevas;

  const sugeridas = [], ocultas = [], descartadas = [], inactivas = [];
  ninieras.forEach(ninera => {
    if(excluirIds.has(ninera.id)) return;
    const key = sugeridaClave(ninera);
    if(!nineraHaceTipo(ninera, pedido.tipo)){
      descartadas.push({ ninera, motivo: 'No realiza este tipo de servicio.' }); return;
    }
    if(sugeridaEnLista(ocupadas, ninera, key)){
      descartadas.push({ ninera, motivo: 'Ya tiene otro servicio en ese horario.' }); return;
    }
    const motivoTemporada = fueraTemporada[ninera.id] || fueraTemporada[key];
    if(motivoTemporada){
      descartadas.push({ ninera, motivo: String(motivoTemporada) }); return;
    }
    if(sugeridaEnLista(sinGuia, ninera, key)){
      descartadas.push({ ninera, motivo: 'Todavía no puede recibir pedidos en la app.' }); return;
    }
    const vecesFamilia = sugeridaValor(datos.historialFamilia, ninera, key);
    const pedida = ninera.id === pedidaId;
    const cuidadas = (datos.edadesCuidadas && (datos.edadesCuidadas[ninera.id] || datos.edadesCuidadas[key])) || [];
    const edadesCoinciden = edadesPedido.filter(e => cuidadas.includes(e)).sort((a, b) => a - b);
    const rechazos = sugeridaValor(datos.rechazosSeguidos, ninera, key);
    const semana = sugeridaValor(datos.sittingsSemana, ninera, key);
    const bajas = [];
    if(sugeridaEnLista(noDisponibles, ninera, key)) bajas.push('Marcó que ese día no puede');
    if(rechazos >= 3) bajas.push(`${rechazos} "No puedo" seguidos`);
    if(sugeridaEnLista(incidentesFamilia, ninera, key)) bajas.push('Incidente o queja con esta familia');
    if(sugeridaEnLista(preferirOtros, ninera, key)) bajas.push('Prefiere otros perfiles con esta familia');
    if(semana >= 4) bajas.push(`${semana} sittings esa semana`);
    const estadoEnvio = enviadas[ninera.id] || null;
    const marcas = [];
    if(!ninera.user_id) marcas.push('sin app');
    // Sin temporada cargada no sabemos si está: se queda en su bloque, solo se avisa.
    if(sugeridaEnLista(sinTemporada, ninera, key)) marcas.push('sin temporada cargada');
    marcas.push(...bajas);
    const activa = ninera.activa !== false;
    const item = {
      ninera, vecesFamilia, pedida, bajas, marcas, estadoEnvio,
      baja: bajas.length > 0,
      total: sugeridaValor(datos.historialTotal, ninera, key),
      edad: edadesCoinciden.length, edadesCoinciden,
      varios: masDeTres && sugeridaValor(datos.maxChicos, ninera, key) >= 3,
      conApp: !!ninera.user_id,
      // Solo un sitting, a una niñera activa con app, que no lo recibió ya, y práctica con práctica.
      enviable: activa && pedido.tipo === 'sitting' && !!ninera.user_id && !estadoEnvio
        && nineraEsPractica(ninera) === !!pedido.practica && !(datos.soloPractica && !pedido.practica),
    };
    const mismaZona = !!(pedido.zona && mismoGrupoZona(ninera.zona, pedido.zona));
    item.bloque = (vecesFamilia > 0 || pedida) ? 1 : (mismaZona ? 2 : 3);
    item.porque = sugeridaPorque(item);
    if(!activa) inactivas.push(item);
    else if(soloConocidas && item.bloque > 1) ocultas.push(item);
    else sugeridas.push(item);
  });

  const comparar = (a, b) => {
    if(a.bloque !== b.bloque) return a.bloque - b.bloque;
    if(a.baja !== b.baja) return a.baja ? 1 : -1;
    if(a.bloque === 1){
      if(a.pedida !== b.pedida) return a.pedida ? -1 : 1;
      if(a.vecesFamilia !== b.vecesFamilia) return b.vecesFamilia - a.vecesFamilia;
    } else {
      if(a.total !== b.total) return b.total - a.total;
      if(a.edad !== b.edad) return b.edad - a.edad;
      if(a.varios !== b.varios) return a.varios ? -1 : 1;
    }
    return (a.ninera.nombre || '').localeCompare(b.ninera.nombre || '', 'es');
  };
  [sugeridas, ocultas, inactivas].forEach(l => l.sort(comparar));
  return { sugeridas, ocultas, descartadas, inactivas };
}

/* ================= "Elegir niñeras" (etapa 5, tarea 5.5, 02/11/2026) =================
   Reemplaza el cuerpo de "Asignar niñera" para toda solicitud (respuesta 2 de Diego, 31/10/2026): la
   lista ordenada con ordenarSugeridas, casillas para mandar el pedido por la app a las que la tienen
   ("Enviar a N", RPC enviar_pedido_app) y, en cada fila, "Asignar": la asignación directa de siempre
   (el mismo radio `agenda-asignar-ninera`, su pago y "Guardar asignación", agenda.js). La pantalla
   no decide quién puede recibir el pedido: lo vuelve a validar la base, en una transacción. */
let pedidoElegir = null; // lo que está a la vista: la solicitud, los datos leídos y lo tildado

// Una RPC que la base todavía no tiene (la app publicada antes de la migración).
function esFaltaFuncion(error){ return !!error && (error.code==='PGRST202' || error.code==='42883'); }

// El historial que leía "Asignar niñera" antes de la etapa 5: de respaldo con la base sin migrar o si
// falla sugeridas_datos. Solo zona e historial (lo asignado desde la Agenda con esta familia y todo lo
// registrado), por nombre normalizado.
async function datosSugeridasViejos(s){
  await esperarConfigFijos(); // fijos automáticos: sacar los previstos del conteo
  const [{data:histFam}, {data:histTotal}, {data:sitTotal}] = await Promise.all([
    sb.from('solicitud_ninieras').select('ninera_nombre, solicitudes!inner(familia_nombre)').eq('estado','confirmada').eq('solicitudes.familia_nombre', s.familia_nombre),
    sb.from('solicitud_ninieras').select('ninera_nombre').eq('estado','confirmada'),
    leerTodasLasFilas(()=>sinPrevistos(sb.from('sittings_traslados').select('ninera_nombre')).order('id')),
  ]);
  const historialFamilia = {}, historialTotal = {};
  const contar = (mapa, nombre) => { const k = normaliza(String(nombre||'').trim()); if(k) mapa[k] = (mapa[k]||0) + 1; };
  (histFam||[]).forEach(r=>contar(historialFamilia, r.ninera_nombre));
  (histTotal||[]).forEach(r=>contar(historialTotal, r.ninera_nombre));
  (sitTotal||[]).forEach(r=>contar(historialTotal, r.ninera_nombre));
  return { historialFamilia, historialTotal };
}

// La quincena de una fecha como la guarda la temporada: 0 = 1ra de enero ... 23 = 2da de diciembre.
function quincenaDeFechaPedido(fecha){
  return (Number(fecha.slice(5,7)) - 1) * 2 + (Number(fecha.slice(8,10)) > 15 ? 1 : 0);
}
// Por qué no está esa quincena, con el nombre del lugar: "En Punta del Este esa quincena".
function motivoFueraTemporada(n, claves, q){
  const lugares = lugaresTemporadaVigentes(n);
  const v = lugares ? lugares[String(q)] : null;
  if(v && typeof v === 'object' && typeof v.otro === 'string') return `En ${v.otro} esa quincena`;
  if(v === 'fuera_pais') return 'Fuera del país esa quincena';
  if(typeof v === 'string' && v !== 'montevideo' && LUGARES_TEMPORADA[v]) return `En ${LUGARES_TEMPORADA[v]} esa quincena`;
  const afuera = gruposFueraDeNinera(n).find(g=>quincenasDeGrupo(n.temporada, g.id).includes(q));
  if(afuera) return `En ${afuera.nombre} esa quincena`;
  const grupoPedido = claves.map(grupoFueraDeZona).find(Boolean);
  return grupoPedido ? `No está en ${grupoPedido.nombre} esa quincena` : 'No está en esa zona esa quincena';
}
/* La temporada con la regla del filtro de Niñeras (nineraPresenteEnZona, la 4.5 de las reglas): está si
   está en cualquiera de las zonas del pedido (como coberturaPeriodo); si no se sabe (sin temporada
   cargada) se queda en su bloque con la marca; si no está, a "No se les puede mandar" con el lugar. */
function temporadaPedido(ninieras, zonaPedido, fecha){
  const fueraTemporada = {}, sinTemporada = [];
  const claves = zonasNormalizadas(zonaPedido||'').map(claveZona).filter(Boolean);
  if(!claves.length || !fecha) return { fueraTemporada, sinTemporada };
  const q = quincenaDeFechaPedido(fecha);
  ninieras.forEach(n=>{
    const ps = claves.map(k=>nineraPresenteEnZona(n, k, q));
    if(ps.some(p=>p===true)) return;
    if(ps.some(p=>p===null)) sinTemporada.push(n.id);
    else fueraTemporada[n.id] = motivoFueraTemporada(n, claves, q);
  });
  return { fueraTemporada, sinTemporada };
}

// "20:00–23:00", "20:00–00:30 del día siguiente", "20:00, sin hora de fin".
function horarioPedidoTexto(s){
  const hi = (s.hora_inicio||'').slice(0,5);
  if(!s.hora_fin) return `${hi}, sin hora de fin`;
  return `${hi}–${s.hora_fin.slice(0,5)}${s.termina_dia_siguiente ? ' del día siguiente' : ''}`;
}
function chicosPedidoTexto(edades, cantidad){
  if(!cantidad) return '';
  const conEdad = edades.filter(e=>e!==null && e!==undefined);
  const base = `${cantidad} ${cantidad===1 ? 'chico' : 'chicos'}`;
  return conEdad.length ? `${base} (${sugeridaTextoEdades([...conEdad].sort((a,b)=>a-b))})` : base;
}

async function abrirElegirNineras(solicitudId){
  const s = agendaSolicitudes.find(x=>x.id===solicitudId);
  if(!s) return;
  abrirModal('<div class="empty"><span class="spinner dark"></span> Buscando niñeras recomendadas…</div>');
  const token = modalToken; // si mientras carga se abre otro modal, no se lo pisa
  if(!zonaGruposCache) await cargarZonaGrupos();
  const familia = familiaDeSolicitud(s);
  const familiaId = familia?.id || s.familia_id || null;
  const [nins, sug, precios, hijos, fam, cfg, dudas, sns] = await Promise.all([
    // Todas, también las inactivas (van al fondo), con lo que necesita la temporada.
    sb.from('ninieras').select('id,nombre,zona,tipo,telefono,activa,user_id,temporada,temporada_actualizada_en,temporada_fuente,temporada_lugares,temporada_lugares_en').order('nombre'),
    sb.rpc('sugeridas_datos', { p_familia_id: familiaId, p_familia_nombre: s.familia_nombre, p_fecha: s.fecha }),
    s.tipo==='traslado' ? [] : leerPreciosNinera(familiaId), // el precio de cada niñera con esta familia
    familiaId ? sb.from('hijos_familia').select('fecha_nacimiento,edad_declarada,edad_declarada_en').eq('familia_id', familiaId) : { data: [] },
    familiaId ? sb.from('familias').select('solo_conocidas').eq('id', familiaId).maybeSingle() : { data: null },
    sb.from('app_config').select('valor').eq('id', 'pedidos_app').maybeSingle(),
    sb.from('pedidos_whatsapp').select('id,dudas').eq('solicitud_id', s.id),
    // Las respuestas pueden haber llegado después de cargar la Agenda.
    sb.from('solicitud_ninieras').select('*').eq('solicitud_id', s.id),
  ]);
  if(token!==modalToken) return;
  if(nins.error){ abrirModal(`<h2>Elegir niñeras</h2>${errBox(nins.error)}`); return; }
  if(!sns.error) s.ninieras = sns.data || [];
  const ninieras = nins.data || [];

  // sugeridas_datos (una lectura) o, si la base no la tiene o falla, el historial de antes.
  const sinMigrar = esFaltaFuncion(sug.error);
  const mapas = sug.error ? await datosSugeridasViejos(s) : mapasSugeridas(sug.data, ninieras);
  if(token!==modalToken) return;
  // Las ya mandadas por la app: su fila (estado y precio ofrecido), por niñera.
  const filasApp = {};
  (s.ninieras||[]).filter(x=>x.origen==='app' && x.ninera_id).forEach(x=>{ filasApp[x.ninera_id] = x; });
  const enviadas = Object.fromEntries(Object.entries(filasApp).map(([id, x])=>[id, x.estado]));
  const zonaPedido = s.zona || familia?.zona || null;
  const ocupadas = ninieras.filter(n=>chequearDobleReservaAgenda(n.nombre, s.fecha, s.hora_inicio, s.hora_fin, s.id)).map(n=>n.id);
  const hijosLeidos = hijos.error ? null : (hijos.data || []);
  const edades = (hijosLeidos||[]).map(edadHijo).filter(e=>e!==null);
  const nombreFamilia = familia?.nombre || s.familia_nombre;
  const practica = nineraEsPractica({ nombre: nombreFamilia });
  const soloPractica = cfg.error || !cfg.data ? true : cfg.data.valor?.solo_practica !== false;
  // Mandar por la app: solo un sitting abierto, de hoy en adelante, con la base al día.
  const puedeApp = !sinMigrar && s.tipo==='sitting' && s.fecha >= todayISO() && ['sin_asignar','pendiente_confirmar'].includes(s.estado);

  let pagoTraslado = 0;
  if(s.tipo==='traslado'){
    if(!tarifaTrasladoConfig) await cargarTarifaTrasladoConfig();
    const margenNinera = Number(tarifaTrasladoConfig?.margen_ninera)||0;
    pagoTraslado = s.cobro_familia ? redondearAbajo50(Number(s.cobro_familia) * (1 - margenNinera)) : 0;
  }
  if(token!==modalToken) return;

  pedidoElegir = {
    s, familia, familiaId, sinFamilia: !familiaId, ninieras, filasApp, preciosFam: precios, puedeApp, practica, soloPractica,
    sinMigrar, falloLectura: !!sug.error && !sinMigrar, pagoTraslado,
    hijosLeidos, chicosTexto: chicosPedidoTexto(edades, (hijosLeidos||[]).length),
    soloConocidas: !fam.error && !!fam.data?.solo_conocidas, mostrarNuevas: false,
    dudas: dudas.error ? null : (dudas.data||[]).map(p=>({ id: p.id, lista: Array.isArray(p.dudas) ? p.dudas.map(String) : [] })),
    tildadas: new Map(), // id -> { precio, tocado, guardar }
    pedido: { tipo: s.tipo, zona: zonaPedido, fecha: s.fecha, edades, chicos: (hijosLeidos||[]).length,
      ninera_pedida_id: s.ninera_pedida_id || null, solo_conocidas: false, mostrar_nuevas: false, practica },
    datos: { ninieras, ...mapas, ocupadas, enviadas, soloPractica, excluirIds: [], ...temporadaPedido(ninieras, zonaPedido, s.fecha) },
  };
  pedidoElegir.pedido.solo_conocidas = pedidoElegir.soloConocidas;
  pintarElegirNineras();
}

function ordenElegirNineras(){
  const st = pedidoElegir;
  const orden = ordenarSugeridas({ ...st.pedido, mostrar_nuevas: st.mostrarNuevas }, st.datos);
  if(!st.puedeApp) [orden.sugeridas, orden.ocultas, orden.inactivas].forEach(l=>l.forEach(i=>{ i.enviable = false; }));
  return orden;
}

// El pago sugerido al tocar "Asignar": a una que ya recibió el pedido por la app, lo que se le ofreció
// (su precio_hora por las horas); si no, su precio con esta familia o la tarifa. Un traslado, el cobro
// menos el margen.
function pagoSugeridoElegir(n){
  const st = pedidoElegir, s = st.s;
  if(s.tipo==='traslado') return st.pagoTraslado;
  const ofrecido = Number(st.filasApp[n.id]?.precio_hora) || 0;
  const pagoHora = ofrecido || Number(precioHoraNinera(st.familia, n.id, st.preciosFam)) || 0;
  if(!pagoHora || !s.hora_inicio || !s.hora_fin) return 0;
  const mi = agendaMinutos(s.hora_inicio);
  let mf = agendaMinutos(s.hora_fin);
  if(s.termina_dia_siguiente) mf += 24*60;
  return redondearPago(Math.max(0, mf-mi)/60*pagoHora);
}

const ESTADO_ENVIO_TEXTO = { invitada: ['Sin responder', 'warn'], acepto: ['Puede', 'good'], no_puedo: ['No puede', 'bad'] };
function filaElegirNinera(item, motivo){
  const st = pedidoElegir, n = item.ninera;
  const fila = st.filasApp[n.id];
  const estado = item.estadoEnvio && ESTADO_ENVIO_TEXTO[item.estadoEnvio];
  const marcas = (item.marcas||[]).map(m=>`<span class="pedido-marca${item.bajas?.includes(m) ? ' baja' : ''}">${escaparHtml(m)}</span>`).join('');
  const wa = !n.user_id && n.telefono
    ? `<a class="smallbtn pedido-wa" href="${urlSegura(waLink(n.telefono, mensajeWA(st.s, n.nombre)))}" target="_blank" rel="noopener">WhatsApp</a>` : '';
  return `
    <div class="agenda-ninera-pick pedido-fila" data-id="${escaparHtml(n.id)}">
      <div class="pedido-tilde-wrap">${item.enviable ? `<input type="checkbox" class="pedido-tilde" data-id="${escaparHtml(n.id)}" aria-label="${escaparHtml('Mandar a '+n.nombre)}" ${st.tildadas.has(n.id)?'checked':''} onchange="tildarNineraPedido(this.dataset.id, this.checked)">` : ''}</div>
      <div class="pedido-info">
        <div><b class="pedido-nombre">${escaparHtml(n.nombre)}</b>${estado ? ` <span class="badge ${estado[1]}">${estado[0]}</span>` : ''}</div>
        ${marcas ? `<div class="pedido-marcas">${marcas}</div>` : ''}
        <div class="helper" style="margin:2px 0 0;">${escaparHtml(motivo ?? item.porque ?? '')}</div>
      </div>
      <div class="pedido-acciones">
        ${wa}
        <label class="smallbtn pedido-asignar"><input type="radio" name="agenda-asignar-ninera" value="${escaparHtml(n.id)}" data-nombre="${escaparHtml(n.nombre)}"${fila ? ` data-sn-app="${escaparHtml(fila.id)}"` : ''} onchange="onAgendaNineraSel(${pagoSugeridoElegir(n)})"> Asignar</label>
      </div>
    </div>`;
}
// Un bloque con su título y, antes de las que bajan, "Bajan, pero se les puede mandar igual".
function filasBloqueElegir(items){
  let html = '', bajaPuesta = false;
  items.forEach(i=>{
    if(i.baja && !bajaPuesta){ html += '<div class="agenda-tier-label">Bajan, pero se les puede mandar igual</div>'; bajaPuesta = true; }
    html += filaElegirNinera(i);
  });
  return html;
}
function plegadoElegir(clave, titulo, cuerpo, abierto){
  return `<details class="pedido-plegado" data-clave="${clave}"${abierto ? ' open' : ''}><summary>${escaparHtml(titulo)}</summary>${cuerpo}</details>`;
}

function pintarElegirNineras(){
  const st = pedidoElegir, s = st.s;
  const orden = ordenElegirNineras();
  const b1 = orden.sugeridas.filter(i=>i.bloque===1), b2 = orden.sugeridas.filter(i=>i.bloque===2), b3 = orden.sugeridas.filter(i=>i.bloque===3);
  const hayEnviables = orden.sugeridas.some(i=>i.enviable);
  const bloqueaPractica = st.puedeApp && st.soloPractica && !st.practica;
  const fechaTxt = new Date(s.fecha+'T00:00:00').toLocaleDateString('es-UY',{weekday:'short',day:'2-digit',month:'2-digit'});
  const resumen = [s.familia_nombre, s.tipo==='traslado' ? 'Traslado' : 'Sitting', fechaTxt, horarioPedidoTexto(s),
    st.pedido.zona, st.chicosTexto, s.cobro_familia ? `Cobro a familia $${Number(s.cobro_familia).toLocaleString('es-UY')}` : ''].filter(Boolean).join(' · ');
  const avisos = [];
  if(st.soloConocidas) avisos.push(`<div class="warnbox">Esta familia no acepta niñeras nuevas.${orden.ocultas.length ? `<div style="margin-top:8px;"><button type="button" class="smallbtn" onclick="mostrarNuevasPedido()">Mostrar las que nunca fueron</button></div>` : ''}</div>`);
  if(bloqueaPractica) avisos.push('<div class="helper">Por ahora, por la app solo se mandan pedidos de práctica. Para este, usá "Asignar" o WhatsApp.</div>');
  if(st.puedeApp && !bloqueaPractica && st.sinFamilia) avisos.push(`<div class="warnbox">${escaparHtml(TEXTO_PEDIDO_SIN_FAMILIA)}</div>`);
  else if(st.puedeApp && !bloqueaPractica && st.hijosLeidos && !st.hijosLeidos.length) avisos.push('<div class="warnbox">Faltan los chicos de la familia: cargalos en su ficha.</div>');
  if(st.falloLectura) avisos.push('<div class="warnbox">No se pudo leer todo el historial de las niñeras: el orden puede no ser el de siempre.</div>');
  const muestraPie = st.puedeApp && !bloqueaPractica;
  // Sin ninguna casilla posible (traslado, base sin migrar, solo práctica...), sin el lugar vacío de la casilla.
  const conCasillas = [...orden.sugeridas, ...orden.ocultas].some(i=>i.enviable);
  const html = `
    <div class="pedido-elegir${conCasillas ? '' : ' sin-casillas'}">
      <h2>Elegir niñeras</h2>
      <div class="helper pedido-resumen">${escaparHtml(resumen)}</div>
      <div id="pedido-dudas"></div>
      ${avisos.join('')}
      ${hayEnviables ? `<div class="pedido-marcar">
        <button type="button" class="smallbtn" onclick="marcarPrimerasPedido(10)">Marcar las 10 primeras</button>
        <button type="button" class="smallbtn" onclick="marcarPrimerasPedido(0)">Ninguna</button>
      </div>` : ''}
      ${b1.length ? `<div class="pedido-bloque"><div class="agenda-tier-label">Ya fueron a esa casa</div>${filasBloqueElegir(b1)}</div>` : ''}
      ${b2.length ? `<div class="pedido-bloque"><div class="agenda-tier-label">${escaparHtml('Nunca fueron, de '+st.pedido.zona)}</div>${filasBloqueElegir(b2)}</div>` : ''}
      ${b3.length ? plegadoElegir('fuera', `Fuera de zona (${b3.length})`, filasBloqueElegir(b3), !b1.length && !b2.length) : ''}
      ${orden.descartadas.length ? plegadoElegir('descartadas', `No se les puede mandar (${orden.descartadas.length})`, orden.descartadas.map(d=>filaElegirNinera({ ninera: d.ninera, marcas: d.ninera.user_id ? [] : ['sin app'], estadoEnvio: st.datos.enviadas[d.ninera.id] || null }, d.motivo)).join(''), false) : ''}
      ${orden.inactivas.length ? plegadoElegir('inactivas', `Inactivas (${orden.inactivas.length})`, orden.inactivas.map(i=>filaElegirNinera({ ...i, enviable: false }, 'Está inactiva.')).join(''), false) : ''}
      ${muestraPie ? '<div id="pedido-precios"></div>' : ''}
      <div class="pedido-pie">
        <div id="agenda-asignar-pago-wrap" style="display:none;" ${preciosNoLeidos(st.preciosFam) ? 'data-precios-no-leidos="1"' : ''}>
          <div class="helper" id="agenda-asignar-quien" style="margin:0 0 6px;"></div>
          <div class="field"><label>Pago a la niñera</label><div class="moneyfield"><input type="number" id="agenda-asignar-pago" oninput="marcarCampoEditadoManual('agenda-asignar-pago')"></div></div>
          <div id="agenda-asignar-precio-aviso"></div>
          <div id="agenda-asignar-warn"></div>
          <button class="btn primary" style="width:100%;margin-top:6px;" onclick="conGuardado(this, ()=>guardarAsignacionDirecta(${argJs(s.id)}))">Guardar asignación</button>
        </div>
        ${muestraPie ? `<div id="pedido-practica-warn"></div><div id="pedido-enviar-warn"></div>
        <button class="btn primary" id="pedido-enviar" style="width:100%;margin-top:8px;" onclick="conGuardado(this, ()=>enviarPedidoApp(${argJs(s.id)}))" disabled>Enviar a 0 por la app</button>` : ''}
      </div>
    </div>`;
  abrirModal(html);
  pintarDudasPedido();
  pintarPreciosPedido();
}

// Repinta las listas (por ejemplo, al mostrar las nuevas) sin perder lo tildado, los precios, los
// plegados abiertos ni la elegida para "Asignar" con su pago.
function repintarListasPedido(){
  const modal = document.querySelector('#editmodal .pedido-elegir');
  if(!modal) return;
  const abiertos = [...modal.querySelectorAll('details.pedido-plegado[open]')].map(d=>d.dataset.clave);
  const elegida = modal.querySelector('input[name="agenda-asignar-ninera"]:checked')?.value;
  const wrap = document.getElementById('agenda-asignar-pago-wrap');
  const pie = { visible: wrap && wrap.style.display!=='none', pago: document.getElementById('agenda-asignar-pago')?.value,
    tocado: document.getElementById('agenda-asignar-pago')?.dataset.tocadoManual, warn: document.getElementById('pedido-enviar-warn')?.innerHTML };
  pintarElegirNineras();
  document.querySelectorAll('#editmodal details.pedido-plegado').forEach(d=>{ if(abiertos.includes(d.dataset.clave)) d.open = true; });
  if(elegida){
    const radio = [...document.querySelectorAll('#editmodal input[name="agenda-asignar-ninera"]')].find(r=>r.value===elegida);
    if(radio) radio.checked = true;
  }
  if(pie.visible){
    document.getElementById('agenda-asignar-pago-wrap').style.display = '';
    const input = document.getElementById('agenda-asignar-pago');
    input.value = pie.pago;
    if(pie.tocado) input.dataset.tocadoManual = pie.tocado;
    onAgendaNineraSel(Number(pie.pago)||0);
  }
  if(pie.warn && document.getElementById('pedido-enviar-warn')) document.getElementById('pedido-enviar-warn').innerHTML = pie.warn;
}
function mostrarNuevasPedido(){
  if(!pedidoElegir) return;
  pedidoElegir.mostrarNuevas = true;
  repintarListasPedido();
}

function tildarNineraPedido(nineraId, marcar){
  const st = pedidoElegir;
  if(!st) return;
  if(marcar && !st.tildadas.has(nineraId)){
    const precio = precioHoraNinera(st.familia, nineraId, st.preciosFam);
    st.tildadas.set(nineraId, { precio: precio==null ? '' : String(precio), tocado: false, guardar: undefined });
  }
  if(!marcar) st.tildadas.delete(nineraId);
  const chk = [...document.querySelectorAll('#editmodal .pedido-tilde')].find(c=>c.dataset.id===nineraId);
  if(chk) chk.checked = !!marcar;
  pintarPreciosPedido();
}
// "Marcar las 10 primeras" (solo las que se les puede mandar, en el orden de la lista) o "Ninguna" (0).
function marcarPrimerasPedido(cantidad){
  const st = pedidoElegir;
  if(!st) return;
  const enviables = ordenElegirNineras().sugeridas.filter(i=>i.enviable);
  if(!cantidad) st.tildadas.clear();
  enviables.slice(0, cantidad).forEach(i=>{ if(!st.tildadas.has(i.ninera.id)) tildarNineraPedido(i.ninera.id, true); });
  document.querySelectorAll('#editmodal .pedido-tilde').forEach(c=>{
    c.checked = st.tildadas.has(c.dataset.id);
    // Si quedó tildada una de "Fuera de zona", el plegado se abre para que se vea.
    if(c.checked){ const d = c.closest('details'); if(d) d.open = true; }
  });
  pintarPreciosPedido();
}

// Un renglón por tildada (en el orden de la lista) con su precio por hora, editable. Si se cambia, la
// casilla "Guardar como precio de [niñera] con esta familia" de siempre (casillaPrecioNinera).
function pintarPreciosPedido(){
  const st = pedidoElegir, cont = document.getElementById('pedido-precios');
  if(!st || !cont){ actualizarPiePedido(); return; }
  const porId = new Map(st.ninieras.map(n=>[n.id, n]));
  const orden = ordenElegirNineras();
  const enLista = [...orden.sugeridas, ...orden.ocultas].map(i=>i.ninera.id);
  const ids = [...st.tildadas.keys()].sort((a,b)=>{
    const ia = enLista.indexOf(a), ib = enLista.indexOf(b);
    return (ia<0 ? 1e6 : ia) - (ib<0 ? 1e6 : ib);
  });
  if(!ids.length){ cont.innerHTML = ''; actualizarPiePedido(); return; }
  const noLeidos = preciosNoLeidos(st.preciosFam);
  cont.innerHTML = `
    <div class="agenda-tier-label">Precio por hora para cada una</div>
    ${noLeidos ? `<div class="warnbox" style="margin:0 0 8px;">${escaparHtml(avisoPreciosNoLeidosTarifa(ids.map(id=>porId.get(id)?.nombre||'').join(', ')))}</div>` : ''}
    ${ids.map(id=>{
      const t = st.tildadas.get(id), nombre = porId.get(id)?.nombre || '';
      return `<div class="pedido-precio">
        <div class="pedido-precio-fila"><span>${escaparHtml(nombre)}</span>
          <div class="moneyfield"><input type="number" inputmode="numeric" id="pedido-precio-${escaparHtml(id)}" data-id="${escaparHtml(id)}" value="${escaparHtml(t.precio)}" aria-label="${escaparHtml('Precio por hora de '+nombre)}" oninput="onPrecioPedido(this)"></div>
        </div>
        <div id="pedido-casilla-${escaparHtml(id)}">${casillaPrecioPedidoHtml(id)}</div>
      </div>`;
    }).join('')}`;
  actualizarPiePedido();
}
function casillaPrecioPedidoHtml(id){
  const st = pedidoElegir, t = st.tildadas.get(id);
  const casilla = casillaPrecioNinera({ familiaId: st.familia?.id, nineraId: id, filas: st.preciosFam, valor: t.precio,
    tocadoManual: t.tocado, pagoActual: precioHoraNinera(st.familia, id, st.preciosFam) });
  if(!casilla){ t.guardar = undefined; return ''; }
  if(t.guardar===undefined) t.guardar = casilla.tildada;
  const nombre = st.ninieras.find(n=>n.id===id)?.nombre || '';
  return `<label class="chk chk-largo" style="margin:4px 0 6px;"><input type="checkbox" id="pedido-guardar-precio-${escaparHtml(id)}" data-id="${escaparHtml(id)}" ${t.guardar?'checked':''} onchange="onGuardarPrecioPedido(this)"> ${escaparHtml(`Guardar como precio de ${nombre} con esta familia`)}</label>`;
}
function onGuardarPrecioPedido(chk){
  const t = pedidoElegir?.tildadas.get(chk.dataset.id);
  if(t) t.guardar = chk.checked;
}
function onPrecioPedido(input){
  const t = pedidoElegir?.tildadas.get(input.dataset.id);
  if(!t) return;
  t.precio = input.value;
  t.tocado = true;
  const cont = document.getElementById('pedido-casilla-'+input.dataset.id);
  if(cont) cont.innerHTML = casillaPrecioPedidoHtml(input.dataset.id);
}

// Lo que no deja mandar todavía: nada tildado, dudas del ticket, sin chicos o sin leer las dudas.
function bloqueoEnvioPedido(){
  const st = pedidoElegir;
  if(!st.tildadas.size) return 'nada';
  if(st.sinFamilia) return 'sin_familia';
  if(st.dudas===null) return 'dudas_sin_leer';
  if(st.dudas.some(p=>p.lista.length)) return 'dudas';
  if(st.hijosLeidos && !st.hijosLeidos.length) return 'sin_chicos';
  return null;
}
// Práctica (4.17): una "(práctica)" (familia o niñera) junto con algo real no se manda.
function practicaMezcladaPedido(){
  const st = pedidoElegir;
  const tildadas = [...st.tildadas.keys()].map(id=>st.ninieras.find(n=>n.id===id)).filter(Boolean);
  return tildadas.some(n=>nineraEsPractica(n)!==st.practica);
}
function actualizarPiePedido(){
  const st = pedidoElegir, btn = document.getElementById('pedido-enviar');
  if(!st || !btn) return;
  const n = st.tildadas.size;
  if(!btn.dataset.guardando){
    btn.textContent = `Enviar a ${n} por la app`;
    btn.disabled = !!bloqueoEnvioPedido();
  }
  const pw = document.getElementById('pedido-practica-warn');
  if(pw) pw.innerHTML = practicaMezcladaPedido() ? '<div class="warnbox">Hay niñeras reales tildadas junto con una de práctica.</div>' : '';
}

// Las dudas del ticket de WhatsApp que siguen sin resolver (pedidos_whatsapp.dudas): mientras haya,
// "Enviar" queda en gris. "Ya lo confirmé" saca una; "Mandar igual" las vacía todas.
function pintarDudasPedido(error){
  const st = pedidoElegir, cont = document.getElementById('pedido-dudas');
  if(!st || !cont) return;
  if(st.dudas===null){ cont.innerHTML = '<div class="warnbox">No se pudieron leer las dudas del pedido: cerrá y volvé a abrirlo para mandarlo.</div>'; actualizarPiePedido(); return; }
  const pendientes = st.dudas.flatMap(p=>p.lista.map((texto, i)=>({ pid: p.id, i, texto })));
  cont.innerHTML = pendientes.length ? `<div class="warnbox">
      ${pendientes.map(d=>`<div class="pedido-duda"><span>${escaparHtml('A confirmar: '+d.texto)}</span>
        <button type="button" class="smallbtn" onclick="conGuardado(this, ()=>guardarDudaConfirmada(${argJs(d.pid)}, ${d.i}))">Ya lo confirmé</button></div>`).join('')}
      <div style="margin-top:8px;"><button type="button" class="smallbtn" onclick="conGuardado(this, ()=>guardarDudasMandarIgual())">Mandar igual</button></div>
      ${error ? `<div style="margin-top:6px;">${escaparHtml('No se guardó: '+(error.message||error))}</div>` : ''}
    </div>` : '';
  actualizarPiePedido();
}
async function guardarDudasPedido(cambios){
  const st = pedidoElegir;
  for(const [pid, lista] of cambios){
    const { error } = await sb.from('pedidos_whatsapp').update({ dudas: lista }).eq('id', pid);
    if(error){ pintarDudasPedido(error); return; }
    const p = st.dudas.find(x=>x.id===pid);
    if(p) p.lista = lista;
  }
  pintarDudasPedido();
}
async function guardarDudaConfirmada(pedidoId, indice){
  const p = pedidoElegir?.dudas?.find(x=>x.id===pedidoId);
  if(!p) return;
  await guardarDudasPedido([[pedidoId, p.lista.filter((_, i)=>i!==indice)]]);
}
async function guardarDudasMandarIgual(){
  if(!pedidoElegir?.dudas) return;
  await guardarDudasPedido(pedidoElegir.dudas.filter(p=>p.lista.length).map(p=>[p.id, []]));
}

const TEXTO_PEDIDO_SIN_FAMILIA = 'Este pedido no tiene una familia de la lista: para mandarlo por la app, la familia tiene que estar cargada.';
// El texto de cada error de enviar_pedido_app (la base valida todo de nuevo, en una transacción).
function textoErrorEnvio(error){
  if(esFaltaFuncion(error)) return 'Falta actualizar la base para mandar por la app: avisale a Diego.';
  const quien = error?.hint || 'Una de las niñeras';
  switch(error?.message){
    case 'cerrado': return 'No se mandó: mientras elegías, alguien asignó o canceló este pedido. Cerrá para ver cómo quedó.';
    case 'ninera_sin_app': case 'ninera_inactiva': case 'ninera_solo_traslados':
      return `${quien} ya no puede recibir pedidos por la app: destildala.`;
    case 'sin_chicos': return 'Faltan los chicos de la familia: cargalos en su ficha.';
    case 'practica_mezclada': return 'Hay niñeras reales tildadas junto con una de práctica.';
    case 'solo_practica': return 'Por ahora, por la app solo se mandan pedidos de práctica. Para este, usá "Asignar" o WhatsApp.';
    case 'pasado': return 'Este pedido es de un día que ya pasó.';
    case 'sin_familia': return TEXTO_PEDIDO_SIN_FAMILIA;
    case 'precio_invalido': return `El precio por hora de ${quien} no es válido.`;
    default: return `Error de conexión con la base: ${error?.message || error}`;
  }
}

async function enviarPedidoApp(solicitudId){
  const st = pedidoElegir;
  if(!st || st.s.id!==solicitudId) return;
  const warn = document.getElementById('pedido-enviar-warn');
  const aviso = texto => { warn.innerHTML = `<div class="warnbox">${escaparHtml(texto)}</div>`; };
  warn.innerHTML = '';
  const bloqueo = bloqueoEnvioPedido();
  if(bloqueo==='nada'){ aviso('Tildá al menos una niñera.'); return; }
  if(bloqueo==='dudas' || bloqueo==='dudas_sin_leer'){ aviso('Antes de mandar, resolvé las dudas del pedido.'); return; }
  if(bloqueo==='sin_familia'){ aviso(TEXTO_PEDIDO_SIN_FAMILIA); return; }
  if(bloqueo==='sin_chicos'){ aviso('Faltan los chicos de la familia: cargalos en su ficha.'); return; }
  if(practicaMezcladaPedido()){ actualizarPiePedido(); return; } // el aviso ya está a la vista
  // En el orden de la lista; el precio sin centavos, como todo pago a una niñera.
  const ids = [...document.querySelectorAll('#pedido-precios input[type=number][data-id]')].map(i=>i.dataset.id).filter(id=>st.tildadas.has(id));
  const envios = [];
  for(const id of ids){
    const t = st.tildadas.get(id), nombre = st.ninieras.find(n=>n.id===id)?.nombre || '';
    const precio = redondearPago(Number(t.precio)||0);
    if(!(precio > 0)){ aviso(`Falta el precio por hora de ${nombre}.`); return; }
    envios.push({ ninera_id: id, precio_hora: precio, nombre, guardar: !!t.guardar });
  }
  const { data, error } = await sb.rpc('enviar_pedido_app', { p_solicitud_id: solicitudId, p_envios: envios.map(e=>({ ninera_id: e.ninera_id, precio_hora: e.precio_hora })) });
  if(error){ aviso(textoErrorEnvio(error)); return; }
  // Los precios con la casilla tildada, después de mandar (como al registrar): si alguno falla, lo
  // mandado queda y se avisa qué faltó.
  const aGuardar = envios.filter(e=>e.guardar);
  const resultados = await Promise.all(aGuardar.map(e=>guardarPrecioNineraFamilia({ familiaId: st.familia.id, nineraId: e.ninera_id, pagoHora: e.precio_hora,
    nueva: !(st.preciosFam||[]).some(p=>p.familia_id===st.familia.id && p.ninera_id===e.ninera_id) })));
  cerrarModal();
  pedidoElegir = null;
  await cargarAgendaSolicitudes();
  actualizarAgendaBadge();
  const n = Number(data)||0;
  toast(n ? `Enviado a ${n}. Te avisamos cuando alguna diga que puede.` : 'Ya les había llegado a todas las tildadas.');
  resultados.forEach((res, i)=>{
    const a = avisoPrecioGuardado(res, aGuardar[i].nombre, 'Se mandó, pero');
    if(a) toast(a.texto, a.tipo);
  });
}
