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

// Con un traslado, vecesFamilia y total son traslados (mapasSugeridas): "Fue N veces." sirve igual y el
// total dice "N traslados." (revisión final, 02/11/2026).
function sugeridaPorque(item, tipo){
  const veces = `Fue ${item.vecesFamilia} ${item.vecesFamilia === 1 ? 'vez' : 'veces'}.`;
  if(item.bloque === 1) return item.pedida ? (item.vecesFamilia ? `La pidió la madre. ${veces}` : 'La pidió la madre.') : veces;
  const [uno, varios] = tipo === 'traslado' ? ['traslado', 'traslados'] : ['sitting', 'sittings'];
  const partes = [`${item.total} ${item.total === 1 ? uno : varios}.`];
  if(item.edadesCoinciden.length) partes.push(`Cuidó chicos de ${sugeridaTextoEdades(item.edadesCoinciden)}.`);
  if(item.varios) partes.push('Cuidó familias con 3 o más chicos.');
  return partes.join(' ');
}

/* Junta lo que devuelve la RPC `sugeridas_datos` en los mapas que usa `ordenarSugeridas`. Las filas
   con `ninera_id` suman por id; las sin id (204 de 641 registros viejos, 31/10/2026) traen
   `ninera_clave` y se cruzan con el nombre normalizado de la lista: las dos suman a la misma niñera.
   `tipo` es el del pedido: con 'traslado', historialFamilia e historialTotal salen de
   veces_familia_traslado y total_traslado (quién ya hace los traslados de esa familia); con
   'sitting' o sin tipo, de veces_familia y total. La semana, las edades y los chicos son siempre de
   los sittings (revisión final, 02/11/2026). */
function mapasSugeridas(respuesta, ninieras, tipo){
  const traslado = tipo === 'traslado';
  const porClave = {}, porId = {};
  (ninieras || []).forEach(n => { porId[n.id] = n; const k = sugeridaClave(n); if(k && !porClave[k]) porClave[k] = n; });
  const m = { historialFamilia: {}, historialTotal: {}, sittingsSemana: {}, edadesCuidadas: {}, maxChicos: {},
    rechazosSeguidos: {}, incidentesFamilia: [], noDisponibles: [] };
  const sumar = (mapa, id, n) => { n = sugeridaNumero(n); if(n) mapa[id] = (mapa[id] || 0) + n; };
  ((respuesta && respuesta.historial) || []).forEach(h => {
    const n = (h.ninera_id && porId[h.ninera_id]) || (h.ninera_clave && porClave[normaliza(String(h.ninera_clave).trim())]);
    if(!n) return;
    sumar(m.historialFamilia, n.id, traslado ? h.veces_familia_traslado : h.veces_familia);
    sumar(m.historialTotal, n.id, traslado ? h.total_traslado : h.total);
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
    item.porque = sugeridaPorque(item, pedido.tipo);
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
// registrado), por nombre normalizado. Solo lo del tipo del pedido, como sugeridas_datos: el porqué dice
// "N sittings" o "N traslados" (revisión final, 02/11/2026).
async function datosSugeridasViejos(s){
  await esperarConfigFijos(); // fijos automáticos: sacar los previstos del conteo
  const [{data:histFam}, {data:histTotal}, {data:sitTotal}] = await Promise.all([
    sb.from('solicitud_ninieras').select('ninera_nombre, solicitudes!inner(familia_nombre,tipo)').eq('estado','confirmada').eq('solicitudes.familia_nombre', s.familia_nombre),
    sb.from('solicitud_ninieras').select('ninera_nombre, solicitudes!inner(tipo)').eq('estado','confirmada'),
    leerTodasLasFilas(()=>sinPrevistos(sb.from('sittings_traslados').select('ninera_nombre').eq('tipo', s.tipo)).order('id')),
  ]);
  const historialFamilia = {}, historialTotal = {};
  const contar = (mapa, nombre) => { const k = normaliza(String(nombre||'').trim()); if(k) mapa[k] = (mapa[k]||0) + 1; };
  // solicitud_ninieras es chica (lo asignado desde la Agenda): el tipo se mira acá.
  const delTipo = r => r.solicitudes?.tipo === s.tipo;
  (histFam||[]).filter(delTipo).forEach(r=>contar(historialFamilia, r.ninera_nombre));
  (histTotal||[]).filter(delTipo).forEach(r=>contar(historialTotal, r.ninera_nombre));
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
  const mapas = sug.error ? await datosSugeridasViejos(s) : mapasSugeridas(sug.data, ninieras, s.tipo);
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
    // Para el precio de cada niñera: la familia de la Agenda o, si la Agenda no la tiene cargada (la sumó
    // otra admin después), al menos su id, así se encuentran sus precios con esta familia.
    familiaPrecios: familia || (familiaId ? { id: familiaId } : null),
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
  const pagoHora = ofrecido || Number(precioHoraNinera(st.familiaPrecios, n.id, st.preciosFam)) || 0;
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

// El mismo tope que enviar_pedido_app (demasiadas_ninieras): más de 40 por vez no se tildan.
const MAX_TILDADAS_PEDIDO = 40;
function avisoTopePedido(mostrar){
  const w = document.getElementById('pedido-enviar-warn');
  if(!w) return;
  if(mostrar) w.innerHTML = `<div class="warnbox" data-tope="1">Hasta ${MAX_TILDADAS_PEDIDO} por vez.</div>`;
  else if(w.querySelector('[data-tope]')) w.innerHTML = '';
}
function tildarNineraPedido(nineraId, marcar){
  const st = pedidoElegir;
  if(!st) return;
  const chk = [...document.querySelectorAll('#editmodal .pedido-tilde')].find(c=>c.dataset.id===nineraId);
  if(marcar && !st.tildadas.has(nineraId)){
    if(st.tildadas.size >= MAX_TILDADAS_PEDIDO){
      if(chk) chk.checked = false;
      avisoTopePedido(true);
      return;
    }
    const precio = precioHoraNinera(st.familiaPrecios, nineraId, st.preciosFam);
    st.tildadas.set(nineraId, { precio: precio==null ? '' : String(precio), tocado: false, guardar: undefined });
  }
  if(!marcar){ st.tildadas.delete(nineraId); avisoTopePedido(false); }
  if(chk) chk.checked = !!marcar;
  pintarPreciosPedido();
}
// "Marcar las 10 primeras" (solo las que se les puede mandar, en el orden de la lista) o "Ninguna" (0).
function marcarPrimerasPedido(cantidad){
  const st = pedidoElegir;
  if(!st) return;
  const enviables = ordenElegirNineras().sugeridas.filter(i=>i.enviable);
  if(!cantidad){ st.tildadas.clear(); avisoTopePedido(false); }
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
  const casilla = casillaPrecioNinera({ familiaId: st.familiaId, nineraId: id, filas: st.preciosFam, valor: t.precio,
    tocadoManual: t.tocado, pagoActual: precioHoraNinera(st.familiaPrecios, id, st.preciosFam) });
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
    // no_existe: lo borraron mientras se elegía; para la admin es lo mismo que cerrado.
    case 'cerrado': case 'no_existe': return 'No se mandó: mientras elegías, alguien asignó o canceló este pedido. Cerrá para ver cómo quedó.';
    // La base ya no la tiene: el hint trae su id y el nombre sale de la lista que se está mirando.
    case 'ninera_no_existe': {
      const n = error?.hint && pedidoElegir?.ninieras.find(x=>x.id===error.hint);
      return `${n ? n.nombre : quien} ya no está en la lista: destildala.`;
    }
    case 'demasiadas_ninieras': return `Hasta ${MAX_TILDADAS_PEDIDO} por vez.`;
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
  // La familia por su id (st.familiaId): la de la Agenda puede no estar cargada (familiaPrecios).
  const resultados = await Promise.all(aGuardar.map(e=>guardarPrecioNineraFamilia({ familiaId: st.familiaId, nineraId: e.ninera_id, pagoHora: e.precio_hora,
    nueva: !(st.preciosFam||[]).some(p=>p.familia_id===st.familiaId && p.ninera_id===e.ninera_id) })));
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

/* ================= "Pegar WhatsApp" (etapa 5, tarea 5.6, 02/11/2026) =================
   En la Agenda, la admin pega el mensaje de la madre, la Edge Function pedido-whatsapp arma el ticket
   (queda en pedidos_whatsapp como borrador) y la admin lo revisa y lo corrige acá. "Revisar y elegir
   niñeras" y "Guardar sin mandar" lo pasan a la Agenda en tres pasos, en este orden: se toma el pedido
   (estado 'confirmado', con la condición de que siga en 'borrador': si otra admin ya lo tomó, no se crea
   nada), se crea la solicitud y al final se le pone solicitud_id (ahí la base le avisa a las otras admins).
   Todo lo que viene del mensaje y del modelo es un dato: siempre escapado. Las dudas viven en
   pedidos_whatsapp.dudas: "Elegir niñeras" las vuelve a leer y no deja mandar hasta resolverlas. */
let pedidoTicket = null; // el ticket a la vista: el pedido, la familia elegida, sus chicos y lo que se tocó

function abrirPegarWhatsApp(){
  pedidoTicket = null;
  abrirModal(`<div class="pedido-pegar">
    <h2>Pedido nuevo de WhatsApp</h2>
    <div class="helper">Pegá el mensaje de la madre. Podés pegar varios mensajes seguidos.</div>
    <div class="field"><textarea id="pedido-texto" rows="8" aria-label="Mensaje de la madre"></textarea></div>
    <div id="pedido-pegar-warn"></div>
    <button class="btn primary" style="width:100%;margin-top:4px;" onclick="conGuardado(this, ()=>armarPedidoWhatsApp())">Armar pedido</button>
  </div>`);
  protegerModal('pedido-pegar'); // lo pegado vuelve si se recarga la página antes de armar el pedido
}

// El texto de un error de la Edge Function. Con un código que no es 2xx, supabase-js devuelve
// FunctionsHttpError con la respuesta sin leer en `context`: el mensaje es el que armó la función
// (ticket.ts / index.ts: texto vacío o largo, sesión vencida, sin acceso, tope del día...).
async function textoErrorPedidoWhatsApp(error){
  if(error?.name==='FunctionsHttpError' && error.context){
    let mensaje = '';
    try { mensaje = (await error.context.json())?.error || ''; } catch(_) { /* sin JSON: el texto genérico */ }
    return mensaje ? String(mensaje) : `El asistente no respondió (error ${error.context.status}): probá de nuevo.`;
  }
  if(error?.name==='FunctionsFetchError') return 'No se pudo conectar con el asistente: revisá internet y probá de nuevo.';
  return `No se pudo armar el pedido: ${error?.message || error}`;
}

async function armarPedidoWhatsApp(){
  const warn = document.getElementById('pedido-pegar-warn');
  const aviso = t => { if(warn) warn.innerHTML = `<div class="warnbox">${escaparHtml(t)}</div>`; };
  if(warn) warn.innerHTML = '';
  const texto = (document.getElementById('pedido-texto')?.value || '').trim();
  if(!texto){ aviso('Pegá el mensaje de la madre.'); return; }
  const token = modalToken;
  const { data, error } = await sb.functions.invoke('pedido-whatsapp', { body: { texto } });
  // Si mientras pensaba se cerró o se abrió otro modal, no se lo pisa (el pedido queda como borrador).
  if(token!==modalToken || !document.getElementById('pedido-texto')) return;
  if(error){ aviso(await textoErrorPedidoWhatsApp(error)); return; }
  if(!data?.pedido?.id){ aviso('El asistente no devolvió un ticket válido. Probá de nuevo o cargalo a mano.'); return; }
  await pintarTicket(data.pedido);
}

// La niñera que pidió la madre, tal cual la escribió: la de la lista con ese nombre (normaliza) o, si
// escribió solo el primer nombre y hay una sola activa que se llama así, esa. Si no, nadie: la admin elige.
function nineraPedidaDelTicket(texto){
  const q = normaliza(String(texto||'').trim());
  if(!q) return null;
  const clave = n => normaliza(String(n.nombre||'').trim());
  const exacta = agendaNinierasBase.find(n=>clave(n)===q);
  if(exacta) return exacta;
  const porNombre = agendaNinierasBase.filter(n=>clave(n).split(/\s+/)[0]===q);
  return porNombre.length===1 ? porNombre[0] : null;
}

async function pintarTicket(pedido){
  const token = modalToken;
  if(!agendaFamilias.length) await cargarAgendaBase();
  if(!zonaGruposCache) await cargarZonaGrupos();
  if(token!==modalToken) return;
  if(pedido.tipo && pedido.tipo!=='pedido_nuevo') return await pintarNoEsPedidoNuevo(pedido);
  const familia = pedido.familia_id ? agendaFamilias.find(f=>f.id===pedido.familia_id) || null : null;
  const ninera = nineraPedidaDelTicket(pedido.ninera_pedida);
  // La zona del mensaje solo si es una de las nuestras (puede venir una dirección); si no, la de la familia.
  const zonaTicket = zonasMencionadasEnTexto(pedido.zona||'').map(g=>g.nombre).join('/');
  pedidoTicket = { pedido, familia, confirmada: false, buscando: !familia, hijos: null, hijosError: null, agregandoHijo: false,
    direccion: null, direccionLeida: false, direccionDespues: false, direccionGuardada: false,
    dudas: (Array.isArray(pedido.dudas) ? pedido.dudas : []).map(String), nineraPedidaId: ninera?.id || null,
    zonaDelTicket: !!zonaTicket, zonaTocada: false };
  const hi = (pedido.hora_inicio||'').slice(0,5).split(':'), hf = (pedido.hora_fin||'').slice(0,5).split(':');
  const servicio = pedido.servicio==='traslado' || pedido.servicio==='sitting' ? pedido.servicio : '';
  const enMensaje = t => `<div class="helper pedido-del-mensaje">${escaparHtml(`En el mensaje: "${t}"`)}</div>`;
  abrirModal(`<div class="pedido-ticket">
    <h2>Pedido nuevo de WhatsApp</h2>
    <details class="pedido-msg" open><summary>Mensaje pegado</summary><div class="pedido-msg-texto">${escaparHtml(pedido.texto||'')}</div></details>
    <div class="field"><label>Familia</label><div id="pedido-familia-box"></div></div>
    <div class="grid2">
      <div class="field"><label>Tipo</label><select id="pedido-tipo" onchange="actualizarPrecioTicket()">
        ${servicio ? '' : '<option value="">Elegí</option>'}
        <option value="sitting"${servicio==='sitting'?' selected':''}>Sitting</option>
        <option value="traslado"${servicio==='traslado'?' selected':''}>Traslado</option></select></div>
      <div class="field"><label>Día</label><input type="date" id="pedido-fecha" value="${escaparHtml(pedido.fecha||'')}" onchange="actualizarPrecioTicket()"></div>
    </div>
    <div id="pedido-horario" onchange="actualizarPrecioTicket()">
      <div class="grid2">
        <div class="field"><label>Inicio</label>${selectHora('pedido-hi', hi[0]||'', hi[1]||'')}</div>
        <div class="field"><label>Fin${pedido.horario_aproximado ? ' <span class="badge warn pedido-aprox">aproximado</span>' : ''}</label>${selectHora('pedido-hf', hf[0]||'', hf[1]||'')}</div>
      </div>
      ${pedido.horario_nota ? enMensaje(pedido.horario_nota) : ''}
      <label class="chk" style="margin:2px 0 12px;"><input type="checkbox" id="pedido-cruza"${pedido.termina_dia_siguiente ? ' checked' : ''}> Termina al día siguiente</label>
    </div>
    <div id="pedido-zona-wrap" onchange="onZonaTicket()">${checklistZonas('pedido', zonaTicket || familia?.zona || '', 'Zona')}</div>
    ${pedido.zona && !zonaTicket ? enMensaje(pedido.zona) : ''}
    <div class="field"><label>Chicos (de la ficha)</label><div id="pedido-chicos"></div></div>
    <div class="field" style="position:relative;"><label>La madre pidió a</label>
      <input type="text" id="pedido-ninera" autocomplete="off" placeholder="Nadie en especial" value="${escaparHtml(ninera?.nombre || '')}">
      <div id="pedido-ninera-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
      ${pedido.ninera_pedida && !ninera ? enMensaje(pedido.ninera_pedida) : ''}
    </div>
    <div class="field"><label>Notas para la niñera</label><textarea id="pedido-notas" rows="3" maxlength="1000">${escaparHtml(pedido.notas||'')}</textarea></div>
    <div id="pedido-precio"></div>
    <div id="pedido-ticket-dudas"></div>
    <div id="pedido-direccion-wrap"></div>
    <button class="btn ghost" style="width:100%;margin-top:6px;" onclick="conGuardado(this, ()=>crearSolicitudDesdeTicket({ mandar: false }))">Guardar sin mandar</button>
    <div class="pedido-pie">
      <div id="pedido-ticket-warn"></div>
      <button class="btn primary" style="width:100%;" onclick="conGuardado(this, ()=>crearSolicitudDesdeTicket({ mandar: true }))">Revisar y elegir niñeras</button>
      <div class="helper" style="text-align:center;margin:6px 0 0;">Guarda la solicitud en la Agenda (sin asignar) y abre las sugeridas.</div>
    </div>
  </div>`);
  document.querySelector('#pedido-zona-wrap .zona-detalle')?.remove(); // "Editar zonas" abriría otro modal encima del ticket
  attachAutocomplete('pedido-ninera', 'pedido-ninera-dropdown', ()=>agendaNinierasBase,
    n=>{ if(pedidoTicket) pedidoTicket.nineraPedidaId = n?.id || null; }, { sinCoincidencias: 'Ninguna niñera coincide.' });
  pintarFamiliaTicket();
  pintarChicosTicket();
  pintarDudasTicket();
  pintarDireccionTicket();
  actualizarPrecioTicket();
  protegerModal('pedido-whatsapp:'+pedido.id); // pregunta antes de cerrar con cambios
}
function onZonaTicket(){ if(pedidoTicket) pedidoTicket.zonaTocada = true; }

// La familia: la propuesta con "Es esta" / "Otra familia"; elegida, con "Cambiar"; si no, el buscador
// y "+ Familia nueva" (la ficha corta del registro, ahí mismo, sin perder el ticket).
function pintarFamiliaTicket(){
  const st = pedidoTicket, box = document.getElementById('pedido-familia-box');
  if(!st || !box) return;
  const p = st.pedido;
  const enMensaje = p.familia_texto ? `<div class="helper" style="margin:2px 0 0;">${escaparHtml(`En el mensaje: "${p.familia_texto}"`)}</div>` : '';
  if(st.familia && !st.buscando){
    box.innerHTML = `<div class="pedido-fam">
      <div class="pedido-fam-txt"><b>${escaparHtml(st.familia.nombre)}</b>${enMensaje}</div>
      <div class="pedido-fam-acc">${st.confirmada
        ? `<span class="badge good">Es esta ✓</span><button type="button" class="smallbtn" onclick="buscarOtraFamiliaTicket()">Cambiar</button>`
        : `<button type="button" class="smallbtn pedido-ac" onclick="elegirFamiliaTicket(${argJs(st.familia.id)})">Es esta</button><button type="button" class="smallbtn" onclick="buscarOtraFamiliaTicket()">Otra familia</button>`}</div>
    </div>`;
    return;
  }
  box.innerHTML = `<div style="position:relative;"><input type="text" id="pedido-familia" autocomplete="off" placeholder="Buscá la familia" value="${escaparHtml(st.familia ? '' : (p.familia_texto || ''))}">
      <div id="pedido-familia-dropdown" class="autocomplete-dropdown" style="display:none;"></div></div>
    ${enMensaje}
    <div id="pedido-familia-create" style="margin-top:6px;"></div>
    <div id="pedido-familia-nueva"></div>`;
  attachAutocomplete('pedido-familia', 'pedido-familia-dropdown', ()=>agendaFamilias,
    f=>{ if(f) elegirFamiliaTicket(f.id); else pintarCrearFamiliaTicket(); }, { sinCoincidencias: '' });
  pintarCrearFamiliaTicket();
}
function buscarOtraFamiliaTicket(){
  const st = pedidoTicket;
  if(!st) return;
  st.buscando = true; st.confirmada = false; st.familia = null; st.hijos = null; st.hijosError = null;
  st.direccionLeida = false; st.direccionGuardada = false;
  pintarFamiliaTicket(); pintarChicosTicket(); pintarDireccionTicket(); actualizarPrecioTicket();
  document.getElementById('pedido-familia')?.focus();
}
function pintarCrearFamiliaTicket(){
  const box = document.getElementById('pedido-familia-create');
  if(!box) return;
  const val = (document.getElementById('pedido-familia')?.value || '').trim();
  const existe = agendaFamilias.some(f=>normaliza(f.nombre)===normaliza(val));
  const fichaAbierta = !!document.getElementById('pedfam-telefono');
  box.innerHTML = val && !existe && !fichaAbierta ? `<button type="button" class="createbtn" onclick="abrirFamiliaNuevaTicket()">${escaparHtml(`+ Familia nueva "${val}"`)}</button>` : '';
}
function abrirFamiliaNuevaTicket(){
  const panel = document.getElementById('pedido-familia-nueva');
  if(!panel) return;
  panel.innerHTML = fichaFamiliaNuevaHtml('pedfam', { cancelar: 'cerrarFamiliaNuevaTicket()', crear: 'crearFamiliaDesdeTicket()' });
  panel.querySelector('.zona-detalle')?.remove(); // "Editar zonas" abre su propio modal en lugar de este
  const dd = document.getElementById('pedido-familia-dropdown');
  if(dd) dd.style.display = 'none';
  pintarCrearFamiliaTicket();
  document.getElementById('pedfam-telefono').focus();
}
function cerrarFamiliaNuevaTicket(){
  const panel = document.getElementById('pedido-familia-nueva');
  if(panel) panel.innerHTML = '';
  pintarCrearFamiliaTicket();
}
async function crearFamiliaDesdeTicket(){
  const nombre = (document.getElementById('pedido-familia')?.value || '').trim();
  const data = await insertarFamiliaNueva('pedfam', nombre, agendaFamilias);
  if(!data) return;
  agendaFamilias.push(data); // así la Agenda y "Elegir niñeras" la encuentran sin recargar
  toast('Familia creada. Cuentas y notas se agregan desde Familias.');
  await elegirFamiliaTicket(data.id);
}
async function elegirFamiliaTicket(id){
  const st = pedidoTicket, f = agendaFamilias.find(x=>x.id===id);
  if(!st || !f) return;
  Object.assign(st, { familia: f, confirmada: true, buscando: false, hijos: null, hijosError: null, agregandoHijo: false,
    direccion: null, direccionLeida: false, direccionDespues: false, direccionGuardada: false });
  pintarFamiliaTicket();
  // Sin zona en el mensaje (y sin tocarla), la de la familia elegida.
  if(!st.zonaDelTicket && !st.zonaTocada){
    setZonasChecklist('pedido', f.zona || '', 'Zona');
    document.querySelector('#pedido-zona-wrap .zona-detalle')?.remove();
  }
  pintarChicosTicket(); pintarDireccionTicket(); actualizarPrecioTicket();
  await leerFichaFamiliaTicket(id);
}
// Los chicos (uno por uno, hijos_familia: el texto libre viejo no cuenta) y la dirección, en paralelo.
async function leerFichaFamiliaTicket(id){
  const [hijos, fam] = await Promise.all([
    sb.from('hijos_familia').select('id,fecha_nacimiento,edad_declarada,edad_declarada_en').eq('familia_id', id),
    sb.from('familias').select('direccion').eq('id', id).maybeSingle(),
  ]);
  const st = pedidoTicket;
  if(!st || st.familia?.id!==id) return; // se eligió otra mientras leía
  st.hijos = hijos.error ? null : (hijos.data || []);
  st.hijosError = hijos.error || null;
  st.direccionLeida = !fam.error;
  st.direccion = fam.data?.direccion || '';
  pintarChicosTicket(); pintarDireccionTicket();
}

function pintarChicosTicket(){
  const st = pedidoTicket, box = document.getElementById('pedido-chicos');
  if(!st || !box) return;
  const p = st.pedido;
  const cantidad = Number(p.chicos_cantidad) || 0;
  const partes = [cantidad ? `${cantidad} ${cantidad===1 ? 'chico' : 'chicos'}` : '', p.chicos_edades || ''].filter(Boolean);
  const delMensaje = partes.length ? `<div class="helper" style="margin:4px 0 0;">${escaparHtml('En el mensaje: '+partes.join(', '))}</div>` : '';
  if(!st.confirmada){ box.innerHTML = `<div class="helper" style="margin:0;">Confirmá la familia para ver sus chicos.</div>${delMensaje}`; return; }
  if(st.hijosError){
    box.innerHTML = `<div class="warnbox" style="margin-top:0;">${escaparHtml('No se pudieron leer los chicos de la familia: '+(st.hijosError.message || st.hijosError))}
      <div style="margin-top:8px;"><button type="button" class="smallbtn" onclick="leerFichaFamiliaTicket(${argJs(st.familia.id)})">Reintentar</button></div></div>`;
    return;
  }
  if(st.hijos===null){ box.innerHTML = '<div class="helper" style="margin:0;">Leyendo los chicos de la ficha…</div>'; return; }
  const form = st.agregandoHijo ? `<div class="pedido-hijo-form">
      <div class="grid2">
        <div class="field"><label>Edad (años)</label><input type="number" inputmode="numeric" min="0" max="30" id="pedido-hijo-edad"></div>
        <div class="field"><label>Nombre (opcional)</label><input type="text" id="pedido-hijo-nombre"></div>
      </div>
      <div id="pedido-hijo-warn"></div>
      <button type="button" class="smallbtn pedido-ac" onclick="conGuardado(this, ()=>guardarHijoTicket())">Guardar</button>
    </div>` : '<button type="button" class="smallbtn" onclick="abrirHijoTicket()">+ Agregar</button>';
  if(st.hijos.length){
    const edades = st.hijos.map(edadHijo).filter(e=>e!==null);
    box.innerHTML = `<div class="pedido-chicos-txt">${escaparHtml(chicosPedidoTexto(edades, st.hijos.length))}</div><div style="margin-top:6px;">${form}</div>`;
  } else {
    box.innerHTML = `<div class="warnbox pedido-faltan" style="margin-top:0;"><b>Faltan los chicos</b> ${escaparHtml(`de ${st.familia.nombre}. Para mandar el pedido, cargá la edad de cada uno (el nombre es opcional).`)}
      ${delMensaje}<div style="margin-top:8px;">${form}</div></div>`;
  }
  if(st.agregandoHijo) document.getElementById('pedido-hijo-edad')?.focus();
}
function abrirHijoTicket(){
  if(!pedidoTicket) return;
  pedidoTicket.agregandoHijo = true;
  pintarChicosTicket();
}
async function guardarHijoTicket(){
  const st = pedidoTicket;
  if(!st?.familia || !st.hijos) return;
  const warn = document.getElementById('pedido-hijo-warn');
  const edadTxt = (document.getElementById('pedido-hijo-edad')?.value || '').trim();
  const edad = Number(edadTxt);
  if(!edadTxt || !Number.isInteger(edad) || edad < 0 || edad > 30){ warn.innerHTML = '<div class="warnbox">Poné la edad en años (un número entero).</div>'; return; }
  const fila = { familia_id: st.familia.id, nombre: (document.getElementById('pedido-hijo-nombre')?.value || '').trim() || null,
    edad_declarada: edad, edad_declarada_en: todayISO(), orden: st.hijos.length };
  const { data, error } = await sb.from('hijos_familia').insert(fila).select('id,fecha_nacimiento,edad_declarada,edad_declarada_en').single();
  if(error){ warn.innerHTML = errBox(error); return; }
  if(pedidoTicket!==st || st.familia.id!==fila.familia_id) return;
  st.hijos.push(data);
  st.agregandoHijo = false;
  pintarChicosTicket();
}

// "Falta la dirección" (la niñera la ve recién cuando la eligen, etapa 6): se puede guardar acá o dejar
// para después; no bloquea.
function pintarDireccionTicket(){
  const st = pedidoTicket, wrap = document.getElementById('pedido-direccion-wrap');
  if(!st || !wrap) return;
  if(st.confirmada && st.direccionGuardada){ wrap.innerHTML = '<div class="helper pedido-ok" id="pedido-direccion-box">Dirección guardada.</div>'; return; }
  if(!st.confirmada || !st.direccionLeida || st.direccion || st.direccionDespues){ wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="warnbox pedido-direccion" id="pedido-direccion-box"><b>${escaparHtml('Falta la dirección de '+st.familia.nombre)}</b>. La niñera la ve recién cuando la eligen.
    <input type="text" id="pedido-direccion" placeholder="Calle, número, apto." autocomplete="off" style="margin-top:8px;">
    <div id="pedido-direccion-warn"></div>
    <div class="pedido-botones">
      <button type="button" class="smallbtn pedido-ac" onclick="conGuardado(this, ()=>guardarDireccionTicket())">Guardar</button>
      <button type="button" class="smallbtn" onclick="direccionDespuesTicket()">Después</button>
    </div></div>`;
}
function direccionDespuesTicket(){
  if(!pedidoTicket) return;
  pedidoTicket.direccionDespues = true;
  pintarDireccionTicket();
}
async function guardarDireccionTicket(){
  const st = pedidoTicket;
  if(!st?.familia) return;
  const warn = document.getElementById('pedido-direccion-warn');
  const valor = (document.getElementById('pedido-direccion')?.value || '').trim();
  if(!valor){ warn.innerHTML = '<div class="warnbox">Escribí la dirección (o tocá "Después").</div>'; return; }
  const familiaId = st.familia.id;
  const { error } = await sb.from('familias').update({ direccion: valor }).eq('id', familiaId);
  if(error){ warn.innerHTML = errBox(error); return; }
  if(pedidoTicket!==st || st.familia?.id!==familiaId) return;
  st.direccion = valor;
  st.direccionGuardada = true;
  pintarDireccionTicket();
}

// Las dudas del modelo: "Ya lo confirmé" saca una y "Mandar igual" las vacía, guardado en el pedido
// (pedidos_whatsapp.dudas). No frenan el pase a la Agenda: frenan el envío en "Elegir niñeras".
function pintarDudasTicket(error){
  const st = pedidoTicket, cont = document.getElementById('pedido-ticket-dudas');
  if(!st || !cont) return;
  cont.innerHTML = st.dudas.length ? `<div class="warnbox">
      ${st.dudas.map((d, i)=>`<div class="pedido-duda"><span>${escaparHtml('A confirmar: '+d)}</span>
        <button type="button" class="smallbtn" onclick="conGuardado(this, ()=>guardarDudaTicket(${i}))">Ya lo confirmé</button></div>`).join('')}
      <div style="margin:2px 0 0;">Preguntale a la madre antes de mandar.</div>
      <div style="margin-top:8px;"><button type="button" class="smallbtn" onclick="conGuardado(this, ()=>guardarDudasTicket([]))">Mandar igual</button></div>
      ${error ? `<div style="margin-top:6px;">${escaparHtml('No se guardó: '+(error.message || error))}</div>` : ''}
    </div>` : '';
}
async function guardarDudasTicket(lista){
  const st = pedidoTicket;
  if(!st) return;
  const { error } = await sb.from('pedidos_whatsapp').update({ dudas: lista }).eq('id', st.pedido.id);
  if(pedidoTicket!==st) return;
  if(error){ pintarDudasTicket(error); return; }
  st.dudas = lista;
  pintarDudasTicket();
}
async function guardarDudaTicket(indice){
  if(!pedidoTicket) return;
  await guardarDudasTicket(pedidoTicket.dudas.filter((_, i)=>i!==indice));
}

function leerHorarioTicket(){
  const valor = id => document.getElementById(id)?.value || '';
  return { tipo: valor('pedido-tipo'), fecha: valor('pedido-fecha'), hi: leerHora('pedido-hi'), hf: leerHora('pedido-hf'),
    cruza: !!document.getElementById('pedido-cruza')?.checked };
}
// El precio esperado para la madre: las horas a cobrar (horasSitting, con los términos de la familia)
// por su tarifa, sin centavos (redondearCobro). Sin fin no hay total (como en la Agenda). `problema`:
// un horario que no se puede guardar.
function precioTicket(){
  const st = pedidoTicket, h = leerHorarioTicket();
  if(h.tipo==='traslado') return { cobro: null, texto: 'El precio del traslado se calcula con los km al asignarlo.' };
  if(cruceMedianocheMalMarcado(h.hi, h.hf, h.cruza)) return { cobro: null, problema: AVISO_CRUCE_MEDIANOCHE };
  if(h.hi && h.hf && !h.cruza && h.hf <= h.hi) return { cobro: null, problema: 'La hora de fin tiene que ser después de la de inicio. Si termina pasada la medianoche, marcá "Termina al día siguiente".' };
  if(!h.hi) return { cobro: null, texto: '' };
  if(!h.hf) return { cobro: null, texto: 'Sin total hasta que se sepa la hora de fin.' };
  const fam = st?.familia;
  if(!fam) return { cobro: null, texto: 'Elegí la familia para ver el precio.' };
  const tarifa = Number(fam.cobro_hora) || 0;
  if(!tarifa) return { cobro: null, texto: `${fam.nombre} no tiene tarifa por hora cargada: el total se calcula al registrar.` };
  const horas = horasSitting(h.hi, h.hf, h.cruza, fam, h.fecha);
  if(!horas) return { cobro: null, texto: '' };
  const cobro = redondearCobro(tarifa * horas.cobro);
  const fin = textoFinCobrado(h.hf, horas);
  return { cobro, texto: `Precio esperado para la madre: $${cobro.toLocaleString('es-UY')} (${horas.cobro.toFixed(1).replace('.0','')} h × $${tarifa.toLocaleString('es-UY')})${fin ? ' · '+fin : ''}` };
}
function actualizarPrecioTicket(){
  const cont = document.getElementById('pedido-precio');
  if(!cont || !pedidoTicket) return;
  const p = precioTicket();
  cont.innerHTML = p.problema ? `<div class="warnbox">${escaparHtml(p.problema)}</div>`
    : p.texto ? `<div class="pedido-precio-esperado">${escaparHtml(p.texto)}</div>` : '';
}

// Una columna de la etapa 5 que la base todavía no tiene (la app publicada antes de la migración).
function esFaltaColumnaSolicitudApp(error){
  return !!error && (error.code==='PGRST204' || error.code==='42703') && /ninera_pedida_id|notas_para_ninera/.test(error.message || '');
}

async function crearSolicitudDesdeTicket({ mandar }){
  const st = pedidoTicket;
  if(!st || st.noNuevo) return;
  const warn = document.getElementById('pedido-ticket-warn');
  const aviso = t => { warn.innerHTML = `<div class="warnbox">${escaparHtml(t)}</div>`; };
  warn.innerHTML = '';
  const fam = st.confirmada ? st.familia : null;
  if(!fam){ aviso(st.familia && !st.buscando ? 'Confirmá la familia ("Es esta") o elegí otra.' : 'Confirmá la familia: elegila de la lista o creala con "+ Familia nueva".'); return; }
  const h = leerHorarioTicket();
  if(!h.tipo){ aviso('Elegí si es un sitting o un traslado.'); return; }
  if(!h.fecha){ aviso('Falta el día.'); return; }
  if(!h.hi){ aviso('Falta la hora de inicio.'); return; }
  const precio = precioTicket();
  if(precio.problema){ aviso(precio.problema); return; }
  // Para mandar un sitting hacen falta los chicos cargados uno por uno (la base da sin_chicos igual).
  if(mandar && h.tipo==='sitting'){
    if(st.hijosError){ aviso('No se pudieron leer los chicos de la familia: tocá "Reintentar" antes de mandar.'); return; }
    if(st.hijos===null){ aviso('Esperá a que se lean los chicos de la familia.'); return; }
    if(!st.hijos.length){ aviso('Faltan los chicos de la familia: cargalos acá arriba antes de mandar el pedido.'); return; }
  }
  const nineraTxt = (document.getElementById('pedido-ninera')?.value || '').trim();
  let nineraId = nineraTxt ? st.nineraPedidaId : null;
  if(nineraTxt && !nineraId){
    const n = agendaNinierasBase.find(x=>normaliza(String(x.nombre||'').trim())===normaliza(nineraTxt));
    if(!n){ aviso('Elegí de la lista a la niñera que pidió la madre, o dejá el campo vacío.'); return; }
    nineraId = n.id;
  }
  const notas = (document.getElementById('pedido-notas')?.value || '').trim();
  const zona = leerZonasChecklist('pedido') || fam.zona || null;

  // 1) Se toma el pedido: si otra admin ya lo pasó a la Agenda (o lo descartó), no se crea nada.
  const pid = st.pedido.id;
  const { data: tomado, error: e1 } = await sb.from('pedidos_whatsapp').update({ estado: 'confirmado' }).eq('id', pid).eq('estado', 'borrador').select('id');
  if(e1){ warn.innerHTML = errBox(e1); return; }
  if(!tomado || !tomado.length){ aviso('No se creó nada: otra admin ya pasó este pedido a la Agenda (o lo descartó). Cerrá para ver cómo quedó.'); return; }
  // 2) La solicitud. Sin hora de fin no hay total (cobro_familia vacío, como en "+ Nueva solicitud").
  const solicitud = { familia_id: fam.id, familia_nombre: fam.nombre, tipo: h.tipo, zona, fecha: h.fecha,
    hora_inicio: h.hi, hora_fin: h.hf || null, termina_dia_siguiente: !!(h.cruza && h.hf), cobro_familia: precio.cobro ?? null, estado: 'sin_asignar' };
  if(nineraId) solicitud.ninera_pedida_id = nineraId;
  if(notas) solicitud.notas_para_ninera = notas;
  let { data: creada, error: e2 } = await sb.from('solicitudes').insert(solicitud).select('id').single();
  let sinColumnas = false;
  if(esFaltaColumnaSolicitudApp(e2)){
    // Base sin la migración de la etapa 5: se guarda igual, sin esas dos columnas, y se avisa.
    const { ninera_pedida_id, notas_para_ninera, ...resto } = solicitud;
    ({ data: creada, error: e2 } = await sb.from('solicitudes').insert(resto).select('id').single());
    sinColumnas = true;
  }
  if(e2){
    // El pedido vuelve a borrador, así se puede reintentar.
    const { error: eVuelta } = await sb.from('pedidos_whatsapp').update({ estado: 'borrador' }).eq('id', pid).eq('estado', 'confirmado');
    warn.innerHTML = errBox(e2) + (eVuelta ? '<div class="warnbox">Además, el pedido quedó marcado como pasado a la Agenda sin solicitud: avisale a Diego.</div>' : '');
    return;
  }
  // 3) Se vincula: recién acá la base avisa "Pedido nuevo" a las otras admins.
  const { error: e3 } = await sb.from('pedidos_whatsapp').update({ solicitud_id: creada.id }).eq('id', pid);
  pedidoTicket = null;
  cerrarModal();
  agendaAncla = h.fecha;
  const lbl = document.getElementById('agenda-fecha-label');
  if(lbl) lbl.textContent = agendaRangoLabel();
  await cargarAgendaSolicitudes();
  actualizarAgendaBadge();
  if(sinColumnas) toast(`Falta actualizar la base: la solicitud se guardó sin ${[nineraId && 'la niñera que pidió la madre', notas && 'las notas para la niñera'].filter(Boolean).join(' ni ')} (quedan en el mensaje). Avisale a Diego.`, 'bad');
  if(e3){
    toast(`La solicitud quedó en la Agenda, pero no se pudo vincular con el mensaje de WhatsApp (${e3.message || e3}): revisá las dudas con la madre antes de mandarlo.`, 'bad');
    return;
  }
  if(mandar && agendaSolicitudes.some(x=>x.id===creada.id)) await abrirElegirNineras(creada.id);
  else if(mandar) toast('La solicitud quedó en la Agenda, pero no se pudo abrir "Elegir niñeras": tocala en la Agenda para elegir.', 'bad');
  else toast('Solicitud guardada en la Agenda.');
}

// Un cambio, una cancelación u otra cosa: no se crea nada. Se muestran los pedidos próximos de esa
// familia para abrir el que corresponde, y "Descartar" deja el mensaje como descartado.
const TIPO_MENSAJE_TEXTO = { cambio: 'un cambio', cancelacion: 'una cancelación', otra_cosa: 'otra cosa' };
async function pintarNoEsPedidoNuevo(pedido){
  const token = modalToken;
  const familia = pedido.familia_id ? agendaFamilias.find(f=>f.id===pedido.familia_id) || null : null;
  let lista = '';
  if(familia){
    const { data, error } = await sb.from('solicitudes').select('id,fecha,hora_inicio,hora_fin,termina_dia_siguiente,tipo,estado')
      .eq('familia_id', familia.id).gte('fecha', todayISO()).neq('estado', 'cancelada').order('fecha').order('hora_inicio').limit(10);
    if(token!==modalToken) return;
    lista = error ? errBox(error) : (data||[]).length ? (data||[]).map(s=>{
      const fechaTxt = new Date(s.fecha+'T00:00:00').toLocaleDateString('es-UY', { weekday: 'short', day: '2-digit', month: '2-digit' });
      return `<div class="pedido-proximo">
        <div class="pedido-proximo-txt"><b>${escaparHtml(fechaTxt)}</b> · ${s.tipo==='traslado' ? 'Traslado' : 'Sitting'} · ${escaparHtml(horarioPedidoTexto(s))}</div>
        <button type="button" class="smallbtn" onclick="abrirSolicitudDesdeTicket(${argJs(s.id)}, ${argJs(s.fecha)})">Abrir</button>
      </div>`;
    }).join('') : '<div class="helper">No tiene pedidos próximos en la Agenda.</div>';
  }
  pedidoTicket = { pedido, noNuevo: true };
  const tipo = TIPO_MENSAJE_TEXTO[pedido.tipo] || 'otra cosa';
  abrirModal(`<div class="pedido-ticket pedido-no-nuevo">
    <h2>Mensaje de WhatsApp</h2>
    <details class="pedido-msg" open><summary>Mensaje pegado</summary><div class="pedido-msg-texto">${escaparHtml(pedido.texto||'')}</div></details>
    <div class="warnbox">${escaparHtml(`Esto parece ${tipo}, no un pedido nuevo.`)}</div>
    ${familia
      ? `<div class="agenda-tier-label">${escaparHtml('Pedidos próximos de '+familia.nombre)}</div>${lista}`
      : `<div class="helper">${escaparHtml(`No se reconoció la familia${pedido.familia_texto ? ` ("${pedido.familia_texto}")` : ''}: buscá el pedido en la Agenda.`)}</div>`}
    <div id="pedido-ticket-warn"></div>
    <button class="btn ghost" style="width:100%;margin-top:12px;" onclick="conGuardado(this, ()=>descartarPedidoWhatsApp())">Descartar</button>
  </div>`);
}
async function abrirSolicitudDesdeTicket(id, fecha){
  pedidoTicket = null;
  cerrarModal();
  agendaAncla = fecha;
  const lbl = document.getElementById('agenda-fecha-label');
  if(lbl) lbl.textContent = agendaRangoLabel();
  await cargarAgendaSolicitudes();
  abrirModalSolicitud(id);
}
async function descartarPedidoWhatsApp(){
  const st = pedidoTicket;
  if(!st) return;
  const warn = document.getElementById('pedido-ticket-warn');
  const { data, error } = await sb.from('pedidos_whatsapp').update({ estado: 'descartado' }).eq('id', st.pedido.id).eq('estado', 'borrador').select('id');
  if(error){ warn.innerHTML = errBox(error); return; }
  if(!data || !data.length){ warn.innerHTML = '<div class="warnbox">Otra admin ya pasó este mensaje a la Agenda o lo descartó.</div>'; return; }
  pedidoTicket = null;
  cerrarModal();
  toast('Mensaje descartado.');
}
