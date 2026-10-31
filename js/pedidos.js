/* ================= PEDIDOS (fase 1, etapa 5) =================
   La entrada desde WhatsApp y las pantallas llegan en pasos siguientes. Este archivo concentra
   la regla pura de sugeridas para que el panel no decida distinto según desde dónde se abrió un
   pedido. No escribe ni llama a la base: recibe únicamente datos que una admin ya puede leer. */

function sugeridaHaceTipo(ninera, tipo){
  return tipo === 'traslado'
    ? ninera.tipo === 'Traslados' || ninera.tipo === 'Ambas'
    : ninera.tipo !== 'Traslados';
}

function sugeridaClave(ninera){ return normaliza(ninera.nombre || ninera.id || ''); }

function sugeridaNumero(valor){
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

// La familia puede conocer a una niñera aunque el histórico viejo no tenga ids. Por eso se
// acepta un conteo por id y, como respaldo, por nombre normalizado. La pantalla final deja que la
// admin corrija el resultado antes de preparar un perfil para la madre.
function sugeridaVecesConFamilia(ninera, historialFamilia){
  if(!historialFamilia) return 0;
  return sugeridaNumero(historialFamilia[ninera.id]) || sugeridaNumero(historialFamilia[sugeridaClave(ninera)]);
}

function sugeridaValor(mapa, ninera){
  if(!mapa) return 0;
  return sugeridaNumero(mapa[ninera.id]) || sugeridaNumero(mapa[sugeridaClave(ninera)]);
}

function sugeridaMotivo(item, pedido){
  if(item.bloque === 1){
    if(item.pedida) return 'La pidió la familia.';
    return `Ya estuvo con esta familia ${item.vecesFamilia} vez${item.vecesFamilia === 1 ? '' : 'es'}.`;
  }
  if(item.bloque === 2) return `Nunca fue, pero cubre ${pedido.zona || 'la zona del pedido'}.`;
  return 'Nunca fue; queda como alternativa fuera de zona.';
}

/* Ordena sin ocultar información relevante. Las que no pueden recibir el pedido quedan en
   descartadas con un motivo; las inactivas se conservan al final para que una admin pueda verlas,
   pero nunca se marcan como recomendadas. La UI decide si muestra esos grupos plegados. */
function ordenarSugeridas(pedido, datos = {}){
  const ninieras = datos.ninieras || [];
  const excluirIds = new Set(datos.excluirIds || []);
  const ocupadas = new Set(datos.ocupadas || []);
  const sinGuia = new Set(datos.sinGuia || []);
  const fueraTemporada = new Set(datos.fueraTemporada || []);
  const noDisponibles = new Set(datos.noDisponibles || []);
  const historialFamilia = datos.historialFamilia || {};
  const historialTotal = datos.historialTotal || {};
  const experienciaEdad = datos.experienciaEdad || {};
  const experienciaVarios = datos.experienciaVarios || {};
  const rechazosSeguidos = datos.rechazosSeguidos || {};
  const incidentesFamilia = new Set(datos.incidentesFamilia || []);
  const preferirOtros = new Set(datos.preferirOtros || []);
  const pedidaId = pedido.ninera_pedida_id || null;

  const sugeridas = [], descartadas = [], inactivas = [];
  ninieras.forEach(ninera => {
    if(excluirIds.has(ninera.id)) return;
    const key = sugeridaClave(ninera);
    if(!sugeridaHaceTipo(ninera, pedido.tipo)){
      descartadas.push({ ninera, motivo: 'No realiza este tipo de servicio.' }); return;
    }
    if(ocupadas.has(ninera.id) || ocupadas.has(key)){
      descartadas.push({ ninera, motivo: 'Ya tiene otro servicio en ese horario.' }); return;
    }
    if(fueraTemporada.has(ninera.id) || fueraTemporada.has(key)){
      descartadas.push({ ninera, motivo: 'No está disponible en esa zona durante esta temporada.' }); return;
    }
    if(sinGuia.has(ninera.id) || sinGuia.has(key)){
      descartadas.push({ ninera, motivo: 'Todavía no puede recibir pedidos en la app.' }); return;
    }
    const vecesFamilia = sugeridaVecesConFamilia(ninera, historialFamilia);
    const pedidoPorFamilia = ninera.id === pedidaId;
    const mismaZona = !!(pedido.zona && typeof mismoGrupoZona === 'function' && mismoGrupoZona(ninera.zona, pedido.zona));
    const item = {
      ninera,
      vecesFamilia,
      total: sugeridaValor(historialTotal, ninera),
      edad: sugeridaValor(experienciaEdad, ninera),
      varios: sugeridaValor(experienciaVarios, ninera),
      pedida: pedidoPorFamilia,
      noDisponible: noDisponibles.has(ninera.id) || noDisponibles.has(key),
      rechazos: sugeridaValor(rechazosSeguidos, ninera),
      incidente: incidentesFamilia.has(ninera.id) || incidentesFamilia.has(key),
      preferirOtros: preferirOtros.has(ninera.id) || preferirOtros.has(key),
    };
    item.bloque = vecesFamilia > 0 ? 1 : (mismaZona ? 2 : 3);
    item.motivo = sugeridaMotivo(item, pedido);
    if(ninera.activa === false) inactivas.push(item); else sugeridas.push(item);
  });

  const comparar = (a, b) => {
    if(a.bloque !== b.bloque) return a.bloque - b.bloque;
    if(a.bloque === 1){
      if(a.pedida !== b.pedida) return a.pedida ? -1 : 1;
      if(a.vecesFamilia !== b.vecesFamilia) return b.vecesFamilia - a.vecesFamilia;
    } else {
      if(a.total !== b.total) return b.total - a.total;
      if(a.edad !== b.edad) return b.edad - a.edad;
      if(a.varios !== b.varios) return b.varios - a.varios;
    }
    // Bajan dentro de su bloque, pero no se esconden: la admin puede enviarlas igual.
    const riesgoA = (a.noDisponible ? 1 : 0) + (a.rechazos >= 3 ? 1 : 0) + (a.incidente ? 1 : 0) + (a.preferirOtros ? 1 : 0);
    const riesgoB = (b.noDisponible ? 1 : 0) + (b.rechazos >= 3 ? 1 : 0) + (b.incidente ? 1 : 0) + (b.preferirOtros ? 1 : 0);
    if(riesgoA !== riesgoB) return riesgoA - riesgoB;
    return (a.ninera.nombre || '').localeCompare(b.ninera.nombre || '', 'es');
  };
  sugeridas.sort(comparar);
  inactivas.sort(comparar);
  return { sugeridas, descartadas, inactivas };
}
