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
