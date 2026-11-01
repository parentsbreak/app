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
  const [nins, sug, precios, hijos, fam, cfg, dudas, sns, dir] = await Promise.all([
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
    // La dirección: para asignar un sitting es obligatoria (etapa 6); si falta, se pide abajo.
    familiaId && s.tipo==='sitting' ? sb.from('familias').select('direccion').eq('id', familiaId).maybeSingle() : { data: null },
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
    // Si no se pudo leer, no se pide: la familia puede tenerla y una lectura fallida no frena la asignación.
    pideDireccion: !dir.error && !!dir.data && !String(dir.data.direccion || '').trim(),
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
          ${st.pideDireccion ? campoDireccionAsignar() : ''}
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
    tocado: document.getElementById('agenda-asignar-pago')?.dataset.tocadoManual, warn: document.getElementById('pedido-enviar-warn')?.innerHTML,
    direccion: document.getElementById('agenda-asignar-direccion')?.value };
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
    const dirCampo = document.getElementById('agenda-asignar-direccion');
    if(dirCampo && pie.direccion) dirCampo.value = pie.direccion;
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
        <div class="field"><label>Fin</label>${selectHora('pedido-hf', hf[0]||'', hf[1]||'')}</div>
      </div>
      ${pedido.horario_nota ? enMensaje(pedido.horario_nota) : ''}
      <label class="chk" style="margin:2px 0 12px;"><input type="checkbox" id="pedido-cruza"${pedido.termina_dia_siguiente ? ' checked' : ''}> Termina al día siguiente</label>
      <label class="chk" style="margin:2px 0 12px;"><input type="checkbox" id="pedido-aprox"${pedido.horario_aproximado ? ' checked' : ''}> Horario aproximado (se puede extender)</label>
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
    cruza: !!document.getElementById('pedido-cruza')?.checked, aprox: !!document.getElementById('pedido-aprox')?.checked };
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

// Una columna de la etapa 5 o 6 que la base todavía no tiene (la app publicada antes de la migración).
function esFaltaColumnaSolicitudApp(error){
  return !!error && (error.code==='PGRST204' || error.code==='42703') && /ninera_pedida_id|notas_para_ninera|horario_aproximado/.test(error.message || '');
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
    hora_inicio: h.hi, hora_fin: h.hf || null, termina_dia_siguiente: !!(h.cruza && h.hf), horario_aproximado: h.aprox, cobro_familia: precio.cobro ?? null, estado: 'sin_asignar' };
  if(nineraId) solicitud.ninera_pedida_id = nineraId;
  if(notas) solicitud.notas_para_ninera = notas;
  let { data: creada, error: e2 } = await sb.from('solicitudes').insert(solicitud).select('id').single();
  let sinColumnas = false;
  if(esFaltaColumnaSolicitudApp(e2)){
    // Base sin la migración de la etapa 5 o 6: se guarda igual, sin esas columnas, y se avisa.
    const { ninera_pedida_id, notas_para_ninera, horario_aproximado, ...resto } = solicitud;
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
  if(sinColumnas) toast(`Falta actualizar la base: la solicitud se guardó sin ${[nineraId && 'la niñera que pidió la madre', notas && 'las notas para la niñera', h.aprox && 'la marca de horario aproximado'].filter(Boolean).join(' ni ')} (quedan en el mensaje). Avisale a Diego.`, 'bad');
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

/* ================= "Asignar", plantillas y mensajes para la madre (etapa 6, tarea 6.4, 01/11/2026) =================
   "Asignar" (pantalla 4) asigna a una niñera que respondió por la app; asignar es lo mismo que "Guardar
   asignación" de "Elegir niñeras" (asignarNineraAlPedido, agenda.js) y las dos terminan en la confirmación
   para la madre (pantalla 5). Los mensajes para la madre salen de plantillas: el texto por defecto vive acá
   y "Guardar como plantilla" deja otro en app_config ('plantilla_<clave>', valor {texto}) para las tres
   admins. Nada sale a la madre sin que una admin toque "Copiar" o "Abrir WhatsApp". */

const DIAS_LARGOS_PEDIDO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
// "sábado 07/11"
function diaPedidoTexto(fechaISO){
  if(!fechaISO) return '';
  return `${DIAS_LARGOS_PEDIDO[new Date(fechaISO+'T12:00:00').getDay()]} ${fechaISO.slice(8, 10)}/${fechaISO.slice(5, 7)}`;
}
// "Familia Prueba, sábado 07/11, de 18:00 a 22:00": sin "·" (Diego, 01/11/2026).
function resumenPedidoTexto(s){
  const hi = (s.hora_inicio || '').slice(0, 5);
  const horario = !hi ? '' : s.hora_fin ? `de ${hi} a ${s.hora_fin.slice(0, 5)}${s.termina_dia_siguiente ? ' del día siguiente' : ''}` : `a las ${hi}, sin hora de fin`;
  return [s.familia_nombre, diaPedidoTexto(s.fecha), horario].filter(Boolean).join(', ');
}
// "Ana", "Ana y Lola", "Ana, Lola y Mía".
function listaNombresTexto(nombres){
  return nombres.length > 1 ? nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1] : (nombres[0] || '');
}

// Los textos por defecto (textos.md 9 y las respuestas de Diego del 01/11/2026). Los corchetes se completan solos.
const PLANTILLAS_PEDIDO = {
  perfiles: '¡Hola [madre]! Te paso las niñeras disponibles para el [día] a las [hora inicio]:\n[niñeras]\nAvísame cuál preferís y te la confirmo.',
  confirmacion: '¡Hola [madre]! Confirmamos a la niñera [niñera] el [día] a las [hora inicio].',
  buscando: '¡Hola [madre]! Estamos viendo quién puede [cuándo]. Te avisamos a la brevedad.',
  no_conseguimos: '¡Hola [madre]! Lamentablemente para el [día] no conseguimos a nadie. ¿Te sirve otro horario?',
};
const TITULOS_MENSAJE_MADRE = { perfiles: 'Perfiles para la madre', confirmacion: 'Confirmación para la madre', buscando: 'Todavía buscando', no_conseguimos: 'No conseguimos' };
// Los corchetes que se completan solos, y cómo se nombra cada uno en "Falta [dato] para completar el mensaje."
const DATOS_PLANTILLA_PEDIDO = { 'madre': 'el nombre de la madre', 'día': 'el día', 'hora inicio': 'la hora de inicio', 'cuándo': 'el día', 'niñera': 'la niñera', 'niñeras': 'las niñeras' };

// El texto de la plantilla: el guardado o, si no hay (o no se pudo leer), el de siempre. Una lectura fallida
// nunca deja el mensaje sin texto.
async function leerPlantillaPedido(clave){
  const { data, error } = await sb.from('app_config').select('valor').eq('id', 'plantilla_'+clave).maybeSingle();
  const guardado = !error && typeof data?.valor?.texto === 'string' ? data.valor.texto : '';
  return guardado.trim() ? guardado : (PLANTILLAS_PEDIDO[clave] || '');
}
const RE_CORCHETE_PEDIDO = /\[([^[\]\n]+)\]/g;
function claveCorchete(t){ const c = String(t).trim().toLowerCase(); return c in DATOS_PLANTILLA_PEDIDO ? c : null; }
// Completa los corchetes conocidos con los datos del pedido. Lo que falta queda entre corchetes y vuelve en
// `faltan` (las claves); un corchete que no es de los nuestros queda tal cual.
function completarPlantilla(texto, datos){
  const faltan = [];
  const completo = String(texto || '').replace(RE_CORCHETE_PEDIDO, (todo, nombre) => {
    const clave = claveCorchete(nombre);
    if(!clave) return todo;
    const valor = datos[clave];
    if(valor == null || !String(valor).trim()){ if(!faltan.includes(clave)) faltan.push(clave); return todo; }
    return String(valor);
  });
  return { texto: completo, faltan };
}
// Los corchetes de los nuestros que siguen en un texto (los que la admin todavía no completó).
function faltanEnMensaje(texto){
  const faltan = [];
  for(const m of String(texto || '').matchAll(RE_CORCHETE_PEDIDO)){
    const clave = claveCorchete(m[1]);
    if(clave && !faltan.includes(clave)) faltan.push(clave);
  }
  return faltan;
}
/* "Guardar como plantilla": lo que en el texto coincide con un dato del pedido vuelve a su corchete. Va del
   valor más largo al más corto (la lista de niñeras antes que un nombre suelto) y solo palabras enteras (la
   madre "Ana" no toca "Mariana"); lo ya convertido no se vuelve a mirar. */
function plantillaACorchetes(texto, datos){
  const pares = Object.entries(datos).filter(([, v]) => v != null && String(v).trim()).map(([k, v]) => [k, String(v)])
    .sort((a, b) => b[1].length - a[1].length);
  let partes = [{ t: String(texto || ''), libre: true }];
  for(const [clave, valor] of pares) partes = partes.flatMap(p => p.libre ? cortarPorValorPlantilla(p.t, valor, clave) : [p]);
  return partes.map(p => p.t).join('');
}
const ES_LETRA_PLANTILLA = /[\p{L}\p{N}]/u;
function cortarPorValorPlantilla(t, valor, clave){
  const borde = c => c === undefined || !ES_LETRA_PLANTILLA.test(c);
  const out = [];
  let inicio = 0, busca = 0, i;
  while((i = t.indexOf(valor, busca)) !== -1){
    if(borde(t[i - 1]) && borde(t[i + valor.length])){
      if(i > inicio) out.push({ t: t.slice(inicio, i), libre: true });
      out.push({ t: `[${clave}]`, libre: false });
      inicio = busca = i + valor.length;
    } else busca = i + 1;
  }
  if(inicio < t.length) out.push({ t: t.slice(inicio), libre: true });
  return out;
}

/* El cuadro del mensaje para la madre: el texto editable, "Copiar", "Abrir WhatsApp" (con el teléfono de la
   familia) y "Guardar como plantilla". clave: 'perfiles', 'confirmacion', 'buscando' o 'no_conseguimos'.
   solicitud: { id, familia_id, familia_nombre, fecha, hora_inicio }. extra: { nineraNombre, ninieras (una por
   renglón), titulo, arriba y abajo (HTML ya escapado que va antes y después del texto) }. Lo usan la confirmación
   (pantalla 5) y, desde la tarea 6.5, "Perfiles para la madre", "Todavía buscando" y "No conseguimos". */
let mensajeMadre = null;
async function abrirMensajeMadre({ clave, solicitud, extra = {} }){
  const s = solicitud || {};
  abrirModal('<div class="empty"><span class="spinner dark"></span> Armando el mensaje…</div>');
  const token = modalToken;
  const [plantilla, fam] = await Promise.all([
    leerPlantillaPedido(clave),
    s.familia_id ? sb.from('familias').select('nombre,telefono').eq('id', s.familia_id).maybeSingle() : { data: null },
  ]);
  if(token !== modalToken) return;
  const familia = fam.error ? null : fam.data;
  // [madre] es la primera palabra del nombre de la familia (decisiones 4.16: se carga con el de la madre).
  const datos = {
    'madre': String(familia?.nombre || s.familia_nombre || '').trim().split(/\s+/)[0] || '',
    'día': diaPedidoTexto(s.fecha),
    'hora inicio': (s.hora_inicio || '').slice(0, 5),
    'cuándo': !s.fecha ? '' : s.fecha === todayISO() ? 'hoy' : 'el ' + diaPedidoTexto(s.fecha),
    'niñera': extra.nineraNombre || '',
    'niñeras': extra.ninieras || '',
  };
  const telefono = String(familia?.telefono || '').trim();
  mensajeMadre = { clave, plantilla, datos, telefono, modelo: null };
  const sinTelefono = fam.error ? 'No se pudo leer el teléfono de la familia: copiá el mensaje.' : 'Falta el teléfono de la familia.';
  abrirModal(`<div class="mensaje-madre">
    <h2>${escaparHtml(extra.titulo || TITULOS_MENSAJE_MADRE[clave] || 'Mensaje para la madre')}</h2>
    ${extra.arriba || ''}
    <div class="field" style="margin-top:12px;"><label for="mensaje-madre-texto">Mensaje</label>
      <textarea id="mensaje-madre-texto" rows="5" oninput="revisarMensajeMadre()"></textarea>
      <div class="helper">Los datos del pedido se completaron solos. Podés cambiar el texto antes de mandarlo.</div>
    </div>
    ${extra.abajo || ''}
    <div id="mensaje-madre-falta"></div>
    <div class="mensaje-madre-botones">
      <button type="button" class="btn ghost" id="mensaje-madre-copiar" onclick="copiarMensajeMadre()">Copiar</button>
      ${telefono ? '<a class="btn primary" id="mensaje-madre-wa" href="#" target="_blank" rel="noopener" onclick="return mensajeMadreListo()">Abrir WhatsApp</a>' : ''}
    </div>
    ${telefono ? '' : `<div class="helper">${escaparHtml(sinTelefono)}</div>`}
    <button type="button" class="smallbtn mensaje-madre-plantilla" onclick="verModeloPlantilla()">Guardar como plantilla</button>
    <div id="mensaje-madre-modelo" hidden></div>
    <div id="mensaje-madre-warn"></div>
  </div>`);
  // El texto va por .value (no por el HTML): sale tal cual, con sus renglones y lo que traiga el nombre.
  document.getElementById('mensaje-madre-texto').value = completarPlantilla(plantilla, datos).texto;
  revisarMensajeMadre();
}
// Con cada cambio del texto: el aviso de lo que falta y el link de WhatsApp con lo escrito.
function revisarMensajeMadre(){
  const st = mensajeMadre, area = document.getElementById('mensaje-madre-texto');
  if(!st || !area) return;
  const faltan = faltanEnMensaje(area.value);
  const caja = document.getElementById('mensaje-madre-falta');
  if(caja) caja.innerHTML = faltan.map(c => `<div class="warnbox">${escaparHtml(`${c === 'niñeras' ? 'Faltan' : 'Falta'} ${DATOS_PLANTILLA_PEDIDO[c]} para completar el mensaje.`)}</div>`).join('');
  // "Copiar" gris mientras falte algo (en "Perfiles para la madre", sin ninguna tildada): igual responde con el aviso.
  document.getElementById('mensaje-madre-copiar')?.classList.toggle('apagado', faltan.length > 0);
  const wa = document.getElementById('mensaje-madre-wa');
  if(wa){
    wa.setAttribute('href', waLink(st.telefono, area.value));
    wa.classList.toggle('apagado', faltan.length > 0);
  }
}
// Con un corchete sin completar no se copia ni se abre WhatsApp: a la madre no le llega "[madre]".
function mensajeMadreListo(){
  const area = document.getElementById('mensaje-madre-texto');
  if(!area) return false;
  if(faltanEnMensaje(area.value).length){ toast('Completá lo que falta antes de mandarlo.', 'bad'); return false; }
  if(!area.value.trim()){ toast('El mensaje está vacío.', 'bad'); return false; }
  return true;
}
function copiarMensajeMadre(){
  if(!mensajeMadreListo()) return;
  copiarAlPortapapeles(document.getElementById('mensaje-madre-texto').value, 'Mensaje copiado.');
}
// "Guardar como plantilla": primero muestra cómo va a quedar, con los corchetes; recién "Guardar plantilla" guarda.
function verModeloPlantilla(){
  const st = mensajeMadre, area = document.getElementById('mensaje-madre-texto'), cont = document.getElementById('mensaje-madre-modelo');
  if(!st || !area || !cont) return;
  const warn = document.getElementById('mensaje-madre-warn');
  warn.innerHTML = '';
  // [cuándo] ("el sábado 07/11") se busca solo si la plantilla lo usa: si no, "Confirmamos a Ana el sábado 07/11"
  // quedaría "Confirmamos a [niñera] [cuándo]" y otro día diría "hoy" donde iba la fecha.
  const datos = { ...st.datos };
  if(!st.plantilla.includes('[cuándo]')) delete datos['cuándo'];
  const modelo = plantillaACorchetes(area.value, datos);
  if(!modelo.trim()){ warn.innerHTML = '<div class="warnbox">Escribí el mensaje antes de guardarlo como plantilla.</div>'; return; }
  st.modelo = modelo;
  cont.hidden = false;
  cont.innerHTML = `<div class="mensaje-madre-modelo-caja">
    <div class="helper" style="margin:0;">La próxima vez va a salir así. Lo que está entre corchetes se completa solo.</div>
    <div class="mensaje-madre-modelo-texto">${escaparHtml(modelo)}</div>
    <div class="helper" style="margin:0;">Cambia el mensaje de las tres admins.</div>
    <div class="mensaje-madre-botones">
      <button type="button" class="btn ghost" onclick="ocultarModeloPlantilla()">Volver</button>
      <button type="button" class="btn primary" onclick="conGuardado(this, ()=>guardarPlantillaPedido())">Guardar plantilla</button>
    </div>
  </div>`;
}
function ocultarModeloPlantilla(){
  const cont = document.getElementById('mensaje-madre-modelo');
  if(cont){ cont.hidden = true; cont.innerHTML = ''; }
  if(mensajeMadre) mensajeMadre.modelo = null;
}
async function guardarPlantillaPedido(){
  const st = mensajeMadre;
  if(!st || !st.modelo) return;
  const warn = document.getElementById('mensaje-madre-warn');
  const { error } = await sb.from('app_config').upsert({ id: 'plantilla_'+st.clave, valor: { texto: st.modelo }, actualizado_at: new Date().toISOString() }, { onConflict: 'id' });
  if(error){ if(warn) warn.innerHTML = `<div class="warnbox">${escaparHtml('No se pudo guardar la plantilla: '+(error.message || 'error de conexión'))}</div>`; return; }
  st.plantilla = st.modelo;
  ocultarModeloPlantilla();
  toast('Plantilla guardada. La próxima vez el mensaje sale así.');
}

/* Pantalla 5: la confirmación para la madre, después de asignar (desde "Asignar" o desde "Elegir niñeras").
   "Ya le llegó el aviso" solo si la base de verdad lo mandó: el trigger pone seleccionada_en cuando le encola
   "¡Quedaste seleccionada!" (no lo hace sin app, con solo_practica para una niñera real, con un pedido pasado
   ni con la base sin migrar). Se lee después de escribir, nunca de la respuesta de la escritura. */
async function abrirConfirmacionMadre(solicitudId, nineraNombre){
  abrirModal('<div class="empty"><span class="spinner dark"></span> Armando el mensaje…</div>');
  const token = modalToken;
  const [sol, filas] = await Promise.all([
    sb.from('solicitudes').select('id,familia_id,familia_nombre,tipo,fecha,hora_inicio').eq('id', solicitudId).maybeSingle(),
    sb.from('solicitud_ninieras').select('seleccionada_en').eq('solicitud_id', solicitudId).eq('estado', 'confirmada'),
  ]);
  if(token !== modalToken) return;
  const nombre = nineraNombre || '';
  const seleccionada = !filas.error && (filas.data || []).some(f => f.seleccionada_en);
  const ok = nombre ? `<div class="okbox">${escaparHtml(seleccionada ? `${nombre} quedó seleccionada. Ya le llegó el aviso.` : `${nombre} quedó asignada.`)}</div>` : '';
  if(sol.error || !sol.data){
    abrirModal(`<h2>${escaparHtml(TITULOS_MENSAJE_MADRE.confirmacion)}</h2>${ok}${sol.error ? errBox(sol.error) : '<div class="warnbox">No se encontró el pedido.</div>'}`);
    return;
  }
  await abrirMensajeMadre({ clave: 'confirmacion', solicitud: sol.data, extra: { nineraNombre: nombre, arriba: ok } });
}

/* Pantalla 4: "Asignar" a una niñera que respondió el pedido por la app (snId: su fila de solicitud_ninieras).
   Lo usan "Pedidos en curso" y el atajo "Asignar y confirmar a la madre" (tarea 6.5). El pago se precarga con
   lo que se le ofreció por las horas; la dirección se pide si a la familia de un sitting le falta; abajo, quién
   recibe qué (lo mandan los triggers de la base, con la misma regla de pedido_puede_avisar). */
let pedidoAsignar = null;
async function abrirAsignarPedido(solicitudId, snId){
  pedidoAsignar = null;
  abrirModal('<div class="empty"><span class="spinner dark"></span> Cargando el pedido…</div>');
  const token = modalToken;
  const [sol, filas, cfg] = await Promise.all([
    sb.from('solicitudes').select('id,familia_id,familia_nombre,tipo,fecha,hora_inicio,hora_fin,termina_dia_siguiente,cobro_familia,estado,familias(id,nombre,direccion)').eq('id', solicitudId).maybeSingle(),
    sb.from('solicitud_ninieras').select('id,solicitud_id,ninera_id,ninera_nombre,estado,precio_hora,origen,ninieras(id,nombre,user_id)').eq('solicitud_id', solicitudId),
    sb.from('app_config').select('valor').eq('id', 'pedidos_app').maybeSingle(),
  ]);
  if(token !== modalToken) return;
  const error = sol.error || filas.error;
  if(error){ abrirModal(`<div class="asignar-pedido"><h2>Asignar</h2>${errBox(error)}</div>`); return; }
  const s = sol.data, sn = (filas.data || []).find(x => x.id === snId);
  if(!s || !sn){ abrirModal('<div class="asignar-pedido"><h2>Asignar</h2><div class="warnbox">No se encontró el pedido o la respuesta de esa niñera. Cerrá y volvé a abrirlo.</div></div>'); return; }
  s.ninieras = filas.data || [];
  const familia = s.familias || null;
  const nombre = sn.ninera_nombre || sn.ninieras?.nombre || '';
  const abierto = ['sin_asignar', 'pendiente_confirmar'].includes(s.estado);
  const pideDireccion = s.tipo === 'sitting' && !!familia && !String(familia.direccion || '').trim();
  // El pago: lo que se le ofreció por hora, por las horas reales (las que se le pagan).
  const horas = s.tipo === 'sitting' ? horasSitting(s.hora_inicio, s.hora_fin, !!s.termina_dia_siguiente, null, s.fecha) : null;
  const ofrecido = Number(sn.precio_hora) || 0;
  const pago = horas && ofrecido ? redondearPago(ofrecido * horas.real) : 0;
  const horasTxt = horas ? `${horas.real.toLocaleString('es-UY', { maximumFractionDigits: 2 })} ${horas.real === 1 ? 'hora' : 'horas'}` : '';
  const ayudaPago = horas && ofrecido ? `${horasTxt} a $${ofrecido.toLocaleString('es-UY')} por hora, lo que se le ofreció.`
    : s.tipo === 'sitting' && !s.hora_fin ? 'Sin hora de fin: el pago se calcula cuando la cargues en Sittings & traslados.' : '';
  pedidoAsignar = { s, sn, familia, nombre };
  const estadoNinera = sn.estado === 'no_puedo' ? `<div class="warnbox">${escaparHtml(`${nombre} dijo que no puede. Si lo arreglaron por otro lado, la podés asignar igual.`)}</div>`
    : sn.estado === 'invitada' ? `<div class="helper">${escaparHtml(`${nombre} todavía no respondió.`)}</div>` : '';
  abrirModal(`<div class="asignar-pedido">
    <h2>Asignar</h2>
    <div class="helper pedido-resumen">${escaparHtml(resumenPedidoTexto({ ...s, familia_nombre: familia?.nombre || s.familia_nombre }))}</div>
    <div class="asignar-ninera"><b>${escaparHtml(nombre)}</b></div>
    ${abierto ? `${estadoNinera}
      <div class="field"><label for="agenda-asignar-pago">Pago a la niñera</label><div class="moneyfield"><input type="number" id="agenda-asignar-pago" value="${escaparHtml(String(pago))}"></div>
        ${ayudaPago ? `<div class="helper">${escaparHtml(ayudaPago)}</div>` : ''}</div>
      ${pideDireccion ? campoDireccionAsignar() : ''}
      <div class="asignar-quien"><div class="agenda-tier-label">Quién recibe qué</div><ul>${quienRecibeQue(s, sn, nombre, familia, cfg).map(t => `<li>${escaparHtml(t)}</li>`).join('')}</ul></div>
      <div id="agenda-asignar-warn"></div>
      <button class="btn primary" id="pedido-asignar-btn" style="width:100%;margin-top:6px;" onclick="conGuardado(this, ()=>guardarAsignarPedido())">Asignar</button>`
    : '<div class="warnbox">Este pedido ya no está abierto: alguien más lo asignó o lo canceló. Cerrá para ver cómo quedó.</div>'}
  </div>`);
}
// La dirección de la familia, cuando falta y el pedido es un sitting (la usan "Asignar" y "Elegir niñeras").
function campoDireccionAsignar(){
  return `<div class="field"><label for="agenda-asignar-direccion">Dirección de la familia</label>
    <input type="text" id="agenda-asignar-direccion" placeholder="Calle, número, apto." autocomplete="off">
    <div class="helper">Falta en su ficha y hace falta para asignar: la niñera la ve recién cuando queda confirmada. Se guarda en la ficha.</div></div>`;
}
/* Lo que les llega a las niñeras al asignar, con la regla de los triggers (solicitud_ninieras_al_confirmar y
   pedido_puede_avisar): solo sittings de hoy en adelante; con solo_practica prendido (o sin poder leerlo, como
   la base), solo si la familia y la niñera son de práctica. A la elegida, si tiene la app; a las otras de la
   app que dijeron "Puedo", que ya se cubrió; a las que no respondieron, nada. */
function quienRecibeQue(s, sn, nombre, familia, cfg){
  const soloPractica = cfg.error || !cfg.data ? true : cfg.data.valor?.solo_practica !== false;
  const nombreFamilia = familia?.nombre || s.familia_nombre;
  const avisa = n => s.tipo === 'sitting' && s.fecha >= todayISO()
    && (!soloPractica || (nineraEsPractica({ nombre: nombreFamilia }) && nineraEsPractica({ nombre: n })));
  const lineas = [];
  if(!sn.ninieras?.user_id) lineas.push(`${nombre} no tiene la app: avisale por WhatsApp.`);
  else if(avisa(nombre)) lineas.push(`A ${nombre} le llega "¡Quedaste seleccionada!" con los datos del sitting.`);
  else lineas.push(`A ${nombre} no le llega aviso por la app: avisale por WhatsApp.`);
  if(s.tipo === 'sitting'){
    const otras = (s.ninieras || []).filter(x => x.id !== sn.id && x.origen === 'app');
    const pueden = otras.filter(x => x.estado === 'acepto').map(x => x.ninera_nombre || '');
    const avisadas = pueden.filter(avisa), sinAviso = pueden.filter(n => !avisa(n));
    if(avisadas.length) lineas.push(`A ${listaNombresTexto(avisadas)} ${avisadas.length === 1 ? 'le' : 'les'} llega que ya se cubrió.`);
    if(sinAviso.length) lineas.push(sinAviso.length === 1
      ? `${sinAviso[0]} dijo "Puedo" y no le llega aviso por la app: avisale por WhatsApp.`
      : `${listaNombresTexto(sinAviso)} dijeron "Puedo" y no les llega aviso por la app: avisales por WhatsApp.`);
    if(otras.some(x => x.estado === 'invitada')) lineas.push('A las que no respondieron no les llega nada: el pedido se les va solo.');
  }
  lineas.push('Después sale el mensaje para la madre, para copiar o mandar por WhatsApp.');
  return lineas;
}
async function guardarAsignarPedido(){
  const st = pedidoAsignar;
  if(!st) return;
  const ok = await asignarNineraAlPedido({
    s: st.s, ninera: { id: st.sn.ninera_id, nombre: st.nombre }, familia: st.familia ? { id: st.familia.id, nombre: st.familia.nombre } : null,
    pago: redondearPago(document.getElementById('agenda-asignar-pago').value), snIdApp: st.sn.id,
  });
  if(ok) pedidoAsignar = null;
}

/* ================= "Pedidos en curso" (fase 1, etapa 6, tarea 6.5, 01/11/2026) =================
   En Hoy y en el modal de la solicitud de la Agenda, cada pedido mandado por la app que sigue sin niñera
   ('pendiente_confirmar', de hoy en adelante) dice quién puede, quién no y quién no respondió, lo que se le ofreció
   por hora y si ya fue a esa casa. De ahí salen los dos caminos para elegir (decisiones de Diego, 01/11/2026):
   "Asignar" en cada una que puede (o el atajo, si puede la que pidió la madre) y "Perfiles para la madre". Lo que va
   a la madre sale siempre del cuadro editable (abrirMensajeMadre): el panel no manda nada solo, y los avisos a las
   niñeras los mandan los triggers de la base al asignar o cancelar. Los pedidos que no se mandaron por la app
   siguen en "Sin resolver". */
let pedidosEnCursoDatos = {}; // id -> la solicitud pintada: los botones de la tarjeta la toman de acá
let pedidosEnCursoLectura = 0; // cada lectura suma uno: solo pinta la última (vuelven en desorden)

// Un valor de in.(...) dentro de un or= de PostgREST: entre comillas y con \ y " escapadas, porque el nombre de
// una familia puede traer comas, paréntesis o comillas ("Familia (práctica)").
function valorListaPostgrest(v){ return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

/* "Ya fue N veces" / "Nueva para esta familia": UNA lectura de sittings_traslados para todos los pedidos que se
   muestran (nunca una por pedido), solo sittings, sin cancelados ni previstos, de esas familias por familia_id o
   por el nombre tal cual (los registros viejos no tienen ids). Se cuenta por niñera como en mapasSugeridas: por
   id y, lo que no tiene id, por el nombre normalizado. Devuelve { [solicitud]: { porId, porClave } }, o null si la
   lectura falló: quien la usa sigue sin esa línea ("Nueva" del lado seguro en Perfiles).
   Los previstos se sacan siempre (estado <> 'previsto', como "Fue N veces" de sugeridas_datos en "Elegir niñeras":
   las dos pantallas cuentan igual), no con sinPrevistos: un previsto todavía no pasó, y así la lectura lleva un
   solo or= (el de las familias) y no depende de la marca de los fijos automáticos. estado nunca es nulo. */
async function historialPedidosEnCurso(solicitudes){
  const lista = (solicitudes || []).filter(s => s.familia_id || String(s.familia_nombre || '').trim());
  if(!lista.length) return {};
  const ids = [...new Set(lista.map(s => s.familia_id).filter(Boolean))];
  const nombres = [...new Set(lista.map(s => s.familia_nombre).filter(n => String(n || '').trim()))];
  const condiciones = [];
  if(ids.length) condiciones.push(`familia_id.in.(${ids.join(',')})`);
  if(nombres.length) condiciones.push(`familia_nombre.in.(${nombres.map(valorListaPostgrest).join(',')})`);
  let respuesta;
  try {
    respuesta = await sb.from('sittings_traslados').select('ninera_id,ninera_nombre,familia_id,familia_nombre')
      .eq('tipo', 'sitting').eq('cancelado', false).neq('estado', 'previsto').or(condiciones.join(','));
  } catch(e){ respuesta = { error: e }; }
  if(respuesta.error){ console.error('[pedidos en curso] historial', respuesta.error); return null; }
  const out = {};
  lista.forEach(s => {
    const h = { porId: {}, porClave: {} };
    (respuesta.data || []).forEach(r => {
      // Con los dos ids, manda el id (dos familias con el mismo nombre no se mezclan); si no, el nombre tal cual.
      const deEsta = r.familia_id && s.familia_id ? r.familia_id === s.familia_id : r.familia_nombre === s.familia_nombre;
      if(!deEsta) return;
      if(r.ninera_id) h.porId[r.ninera_id] = (h.porId[r.ninera_id] || 0) + 1;
      else {
        const clave = normaliza(String(r.ninera_nombre || '').trim());
        if(clave) h.porClave[clave] = (h.porClave[clave] || 0) + 1;
      }
    });
    out[s.id] = h;
  });
  return out;
}
function vecesEnFamilia(h, sn){
  return (sn.ninera_id ? h.porId[sn.ninera_id] || 0 : 0) + (h.porClave[normaliza(String(sn.ninera_nombre || '').trim())] || 0);
}

// "Pueden 2, no puede 1, falta responder 1. Mandado a 4 a las 14:05. Responder antes de las 14:35." (sin "·"; lo que está en cero no se dice).
function textoRespuestasCurso(filas, s){
  const cuenta = estado => filas.filter(n => n.estado === estado).length;
  const pueden = cuenta('acepto'), noPueden = cuenta('no_puedo'), faltan = cuenta('invitada');
  const partes = [];
  if(pueden) partes.push(pueden === 1 ? 'puede 1' : `pueden ${pueden}`);
  if(noPueden) partes.push(noPueden === 1 ? 'no puede 1' : `no pueden ${noPueden}`);
  if(faltan) partes.push(faltan === 1 ? 'falta responder 1' : `faltan responder ${faltan}`);
  const enviado = horaMontevideoPanel(s.enviado_app_en || filas.map(n => n.enviado_en).filter(Boolean).sort()[0]);
  // El plazo de respuesta (revisión final, 01/11/2026: se había perdido de la pantalla).
  const hasta = horaMontevideoPanel(s.responder_hasta);
  const mandado = `Mandado a ${filas.length}${enviado ? ' a las ' + enviado : ''}.${hasta ? ' Responder antes de las ' + hasta + '.' : ''}`;
  if(!partes.length) return mandado;
  const t = partes.join(', ');
  return `${t[0].toUpperCase()}${t.slice(1)}. ${mandado}`;
}

const ORDEN_RESPUESTA_CURSO = { acepto: 0, invitada: 1, no_puedo: 2 };
/* El detalle de un pedido en curso (lo usan la tarjeta de Hoy y el modal de la solicitud; enModal: sin el renglón
   del pedido, que el modal ya tiene arriba, con el WhatsApp de cada niñera, como antes, y filasExtra: las filas del
   panel, sin origen 'app', ya armadas). historial: el de esa
   solicitud (historialPedidosEnCurso) o null si no se pudo leer o todavía no llegó. */
function htmlPedidoEnCurso(s, historial, { enModal = false, filasExtra = '' } = {}){
  pedidosEnCursoDatos[s.id] = s;
  const filas = (s.ninieras || []).filter(esRespuestaApp);
  // El atajo (Diego, 01/11/2026): la que pidió la madre, si dijo "Puedo", va primera y se asigna directo.
  const pedida = s.ninera_pedida_id ? filas.find(n => n.ninera_id === s.ninera_pedida_id && n.estado === 'acepto') || null : null;
  const orden = n => n === pedida ? -1 : (ORDEN_RESPUESTA_CURSO[n.estado] ?? 3);
  const ordenadas = filas.map((n, i) => ({ n, i })).sort((a, b) => orden(a.n) - orden(b.n) || a.i - b.i).map(x => x.n);
  const id = argJs(s.id);
  return `<div class="pedido-curso" data-solicitud="${escaparHtml(s.id)}">
    ${enModal ? '' : `<div class="pedido-curso-titulo">${escaparHtml(resumenPedidoTexto(s))}</div>`}
    <div class="helper sol-envio">${escaparHtml(textoRespuestasCurso(filas, s))}</div>
    <div class="pedido-curso-filas">${ordenadas.map(n => filaPedidoEnCurso(s, n, historial, n === pedida, enModal)).join('')}${filasExtra}</div>
    <div class="pedido-curso-botones">
      <button type="button" class="btn ${pedida ? 'ghost' : 'primary'} pedido-curso-perfiles" onclick="abrirPerfilesMadre(${id})">Perfiles para la madre</button>
      <button type="button" class="btn ghost" onclick="preguntarAMasNineras(${id})">Preguntar a más niñeras</button>
      <button type="button" class="btn ghost" onclick="abrirMensajePedidoEnCurso('buscando', ${id})">Todavía buscando</button>
      <button type="button" class="btn ghost" onclick="abrirMensajePedidoEnCurso('no_conseguimos', ${id})">No conseguimos</button>
      <button type="button" class="btn ghost pedido-curso-cancelar" onclick="conGuardado(this, ()=>cancelarSolicitud(${id}, ${argJs(s.estado)}))">Cancelar el pedido</button>
    </div>
  </div>`;
}
function filaPedidoEnCurso(s, n, historial, esPedida, enModal){
  const partes = [];
  if(n.precio_hora != null && n.precio_hora !== '') partes.push(`$${Number(n.precio_hora).toLocaleString('es-UY')} por hora.`);
  if(historial){
    const veces = vecesEnFamilia(historial, n);
    partes.push(veces ? `Ya fue ${veces} ${veces === 1 ? 'vez' : 'veces'}.` : 'Nueva para esta familia.');
  }
  const detalle = partes.length ? `<div class="helper">${escaparHtml(partes.join(' '))}</div>` : '';
  const whatsapp = enModal ? `<a class="smallbtn" href="${urlSegura(waLink(agendaTelefonoNinera(n.ninera_nombre), mensajeWA(s, n.ninera_nombre)))}" target="_blank" rel="noopener">WhatsApp</a>` : '';
  const asignar = `abrirAsignarPedido(${argJs(s.id)}, ${argJs(n.id)})`;
  const boton = esPedida || n.estado !== 'acepto' ? '' : `<button type="button" class="smallbtn" onclick="${asignar}">Asignar</button>`;
  return `<div class="agenda-ninerarow pedido-curso-fila${esPedida ? ' pedido-curso-pedida' : ''}">
      <div class="pedido-curso-quien"><b>${escaparHtml(n.ninera_nombre)}</b> ${badgeRespuestaApp(n)}
        ${esPedida ? '<div class="pedido-curso-marca">La pidió la madre y puede</div>' : ''}${detalle}</div>
      ${boton || whatsapp ? `<div class="pedido-curso-acciones">${boton}${whatsapp}</div>` : ''}
      ${esPedida ? `<button type="button" class="btn primary pedido-curso-atajo" onclick="${asignar}">Asignar y confirmar a la madre</button>` : ''}
    </div>`;
}
/* "Preguntar a más niñeras" es "Elegir niñeras" (sin las ya mandadas, que conservan su estado). Esa pantalla usa lo
   que carga la Agenda (sus familias, niñeras y la semana del pedido): desde Hoy se va a la Agenda, a la semana del
   pedido (como el link del push), y se abre ahí. */
async function preguntarAMasNineras(solicitudId){
  const enAgenda = () => !!document.getElementById('agenda-grid-wrap') && agendaSolicitudes.some(x => x.id === solicitudId);
  if(!enAgenda()){
    const fecha = pedidosEnCursoDatos[solicitudId]?.fecha;
    if(fecha) agendaAncla = fecha;
    await setModulo('agenda');
  }
  if(!enAgenda()){ toast('No se encontró ese pedido en la Agenda.', 'bad'); return; }
  await abrirElegirNineras(solicitudId);
}
// "Todavía buscando" y "No conseguimos": solo arman el mensaje. Cancelar es "Cancelar el pedido", aparte.
function abrirMensajePedidoEnCurso(clave, solicitudId){
  const s = pedidosEnCursoDatos[solicitudId];
  if(s) abrirMensajeMadre({ clave, solicitud: s });
}

/* La tarjeta de Hoy: se carga aparte, sin frenar el resto de Hoy (como "Mensajes de niñeras"), en una lectura de
   las solicitudes con sus filas (columnas justas) y otra del historial. Si falla, un aviso corto adentro de la
   tarjeta y Hoy sigue. Sin la migración de la etapa 5 no hay pedidos por la app: no se muestra nada. El Realtime
   de Hoy ya recarga con solicitudes y solicitud_ninieras (y espera si hay un modal abierto). */
async function cargarPedidosEnCurso(){
  if(!document.getElementById('dash-pedidos')) return;
  const lectura = ++pedidosEnCursoLectura;
  let respuesta;
  try {
    respuesta = await sb.from('solicitudes')
      .select('id,familia_id,familia_nombre,tipo,fecha,hora_inicio,hora_fin,termina_dia_siguiente,estado,enviado_app_en,ninera_pedida_id,solicitud_ninieras(id,ninera_id,ninera_nombre,estado,origen,precio_hora,motivo_no,motivo_texto,enviado_en)')
      .eq('estado', 'pendiente_confirmar').gte('fecha', todayISO()).order('fecha').order('hora_inicio');
  } catch(e){ respuesta = { error: e }; }
  const { data, error } = respuesta;
  let caja = document.getElementById('dash-pedidos');
  if(!caja || lectura !== pedidosEnCursoLectura) return;
  if(error){
    if(error.code === '42703' || error.code === 'PGRST200' || esFaltaTabla(error)){ pintarSiCambio(caja, ''); return; }
    console.error('[pedidos en curso]', error);
    pintarSiCambio(caja, `<div class="card pedidos-curso-card"><h2>Pedidos en curso</h2>
      <div class="warnbox">No se pudieron cargar los pedidos en curso. Revisá la conexión.</div>
      <button type="button" class="smallbtn" onclick="cargarPedidosEnCurso()">Reintentar</button></div>`);
    return;
  }
  const lista = (data || []).map(s => ({ ...s, ninieras: s.solicitud_ninieras || [] })).filter(s => s.ninieras.some(esRespuestaApp));
  if(!lista.length){ pintarSiCambio(caja, ''); return; }
  const historial = await historialPedidosEnCurso(lista);
  caja = document.getElementById('dash-pedidos');
  if(!caja || lectura !== pedidosEnCursoLectura) return;
  pintarSiCambio(caja, `<div class="card pedidos-curso-card"><h2>Pedidos en curso</h2>
    ${lista.map(s => htmlPedidoEnCurso(s, historial ? historial[s.id] : null)).join('')}</div>`);
}

/* "Perfiles para la madre" (pantalla 2, regla del CV de reglas-del-negocio 4.6 y Diego, 01/11/2026): solo las que
   dijeron "Puedo". Las que ya fueron a esa casa vienen tildadas y van con el nombre solo; una nueva entra recién
   cuando la admin tilda "Revisé su perfil", con "(te paso su CV)", y abajo el aviso de adjuntar su CV (o de que
   todavía no tiene). Lo tildado se recuerda por pedido mientras la app está abierta: "Ver ficha" abre la ficha en
   lugar de este cuadro y, al volver, sigue igual. */
let perfilesMadre = null; // { solicitudId, items, tildadas }
const perfilesMadreMarcas = new Map(); // solicitud -> { tildadas: Set, vistas: Set } (filas de solicitud_ninieras)
async function abrirPerfilesMadre(solicitudId){
  perfilesMadre = null;
  abrirModal('<div class="empty"><span class="spinner dark"></span> Cargando las respuestas…</div>');
  const token = modalToken;
  const titulo = `<h2>${escaparHtml(TITULOS_MENSAJE_MADRE.perfiles)}</h2>`;
  const { data: s, error } = await sb.from('solicitudes')
    .select('id,familia_id,familia_nombre,tipo,fecha,hora_inicio,hora_fin,termina_dia_siguiente,estado,solicitud_ninieras(id,ninera_id,ninera_nombre,estado,origen)')
    .eq('id', solicitudId).maybeSingle();
  if(token !== modalToken) return;
  if(error){ abrirModal(`${titulo}${errBox(error)}`); return; }
  if(!s || s.estado !== 'pendiente_confirmar'){
    abrirModal(`${titulo}<div class="warnbox">Este pedido ya no está abierto: alguien más lo asignó o lo canceló. Cerrá para ver cómo quedó.</div>`);
    return;
  }
  const pueden = (s.solicitud_ninieras || []).filter(n => esRespuestaApp(n) && n.estado === 'acepto');
  if(!pueden.length){
    abrirModal(`${titulo}<div class="helper pedido-resumen">${escaparHtml(resumenPedidoTexto(s))}</div>
      <div class="warnbox">Todavía ninguna niñera dijo que puede. Cuando alguna responda, armás el mensaje desde acá.</div>`);
    return;
  }
  const ids = [...new Set(pueden.map(n => n.ninera_id).filter(Boolean))];
  const [historial, cvs] = await Promise.all([
    historialPedidosEnCurso([s]),
    ids.length ? sb.from('ninieras').select('id,cv_generado_en').in('id', ids) : { data: [] },
  ]);
  if(token !== modalToken) return;
  const h = historial ? historial[s.id] : null;
  // Sin poder leer los CV no se avisa que falta: solo se pide adjuntarlo.
  const cvPorId = cvs.error ? null : new Map((cvs.data || []).map(n => [n.id, n.cv_generado_en]));
  // Las que ya fueron, arriba.
  const items = pueden.map((n, i) => ({
    i, snId: n.id, nineraId: n.ninera_id || null, nombre: n.ninera_nombre || '',
    conocida: !!h && vecesEnFamilia(h, n) > 0,
    sinCv: !!cvPorId && !!n.ninera_id && cvPorId.has(n.ninera_id) && !cvPorId.get(n.ninera_id),
  })).sort((a, b) => (b.conocida - a.conocida) || a.i - b.i);
  const marcas = perfilesMadreMarcas.get(s.id) || { tildadas: new Set(), vistas: new Set() };
  items.forEach(it => {
    if(!marcas.vistas.has(it.snId)){ marcas.vistas.add(it.snId); if(it.conocida) marcas.tildadas.add(it.snId); }
  });
  perfilesMadreMarcas.set(s.id, marcas);
  const estado = { solicitudId: s.id, items, tildadas: marcas.tildadas };
  perfilesMadre = estado;
  const arriba = `<div class="perfiles-madre">
    <div class="helper pedido-resumen">${escaparHtml(resumenPedidoTexto(s))}</div>
    ${items.map(filaPerfilMadre).join('')}
  </div>`;
  await abrirMensajeMadre({ clave: 'perfiles', solicitud: s, extra: { ninieras: textoNinerasPerfiles(), arriba, abajo: '<div id="perfiles-cv"></div>' } });
  if(perfilesMadre === estado && mensajeMadre?.clave === 'perfiles') pintarAvisosCvPerfiles();
}
function filaPerfilMadre(it){
  const casilla = etiqueta => `<label class="perfiles-check"><input type="checkbox"${perfilesMadre.tildadas.has(it.snId) ? ' checked' : ''} onchange="tildarPerfilMadre(${argJs(it.snId)}, this.checked)"> ${etiqueta}</label>`;
  if(it.conocida) return `<div class="perfiles-fila">${casilla(`<b>${escaparHtml(it.nombre)}</b>`)}
    <div class="helper">Ya fue a esa casa: va solo el nombre.</div></div>`;
  return `<div class="perfiles-fila">
    <div class="perfiles-nombre"><b>${escaparHtml(it.nombre)}</b>${it.nineraId ? `<button type="button" class="smallbtn" onclick="abrirFichaNineraCuandoCargue(${argJs(it.nineraId)})">Ver ficha</button>` : ''}</div>
    <div class="helper">Nueva para esta familia.</div>
    ${casilla('Revisé su perfil')}</div>`;
}
// [niñeras]: una por renglón, en el orden de la lista; la nueva con "(te paso su CV)".
function textoNinerasPerfiles(){
  const st = perfilesMadre;
  return st.items.filter(it => st.tildadas.has(it.snId)).map(it => `- ${it.nombre}${it.conocida ? '' : ' (te paso su CV)'}`).join('\n');
}
// Al tildar o destildar se vuelve a armar el mensaje con la plantilla (lo escrito a mano en el cuadro se reemplaza).
function tildarPerfilMadre(snId, marcar){
  const st = perfilesMadre, area = document.getElementById('mensaje-madre-texto');
  if(!st || !area || mensajeMadre?.clave !== 'perfiles') return;
  if(marcar) st.tildadas.add(snId); else st.tildadas.delete(snId);
  mensajeMadre.datos['niñeras'] = textoNinerasPerfiles();
  area.value = completarPlantilla(mensajeMadre.plantilla, mensajeMadre.datos).texto;
  revisarMensajeMadre();
  pintarAvisosCvPerfiles();
}
function pintarAvisosCvPerfiles(){
  const st = perfilesMadre, caja = document.getElementById('perfiles-cv');
  if(!st || !caja) return;
  const nuevas = st.items.filter(it => !it.conocida && st.tildadas.has(it.snId));
  const conCv = nuevas.filter(it => !it.sinCv).map(it => it.nombre);
  caja.innerHTML = (conCv.length ? `<div class="helper">${escaparHtml(`Adjuntá en WhatsApp el CV de ${listaNombresTexto(conCv)}.`)}</div>` : '')
    + nuevas.filter(it => it.sinCv).map(it => `<div class="warnbox">${escaparHtml(`${it.nombre} todavía no tiene CV: generalo desde su ficha.`)}</div>`).join('');
}
