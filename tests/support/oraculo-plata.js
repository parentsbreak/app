// Oráculo de plata: copia EXACTA de las funciones que calculan plata en js/, tal como estaban el
// 31/10/2026 (commit 1047c50). La generó scripts/congelar-oraculo-plata.js: no se edita a mano.
// tests/red-plata.spec.js compara la app con esta copia en miles de casos (docs/rediseno-panel.md,
// 4.10). Si una regla cambia a propósito, se vuelve a generar en el mismo PR y el PR lo dice.
// Lo que no es plata (supabase, normaliza, todayISO, sumarDiasISO...) es el de la app.
function crearOraculoPlata(){
  // Propias del oráculo: si la copia de una lectura marca una tabla como faltante, no toca la app.
  let gastosExtraDisponible = true;
  let ajustesSaldoDisponible = true;
  // ---- constantes de js/core.js
  const TOLERANCIA_FIN_COBRO_MIN = 5;
  // ---- js/agenda.js
  function agendaMinutos(hhmm){
    if(!hhmm) return null;
    const [h,m] = hhmm.split(':').map(Number);
    return h*60+(m||0);
  }
  // ---- js/core.js
  function gastoACargoFamilia(g){ return !!g && g.pagado_por==='ninera' && !g.absorbe_pb; }
  function redondearMonto(n, mitadSube){
    const v = Number(n);
    if(!isFinite(v)) return 0;
    const centavos = Math.round(Math.abs(v)*100);
    const entero = Math.floor(centavos/100), resto = centavos % 100;
    const r = resto > 50 || (resto === 50 && mitadSube) ? entero + 1 : entero;
    return v < 0 && r ? -r : r;
  }
  function redondearPago(n){ return redondearMonto(n, false); }
  function redondearCobro(n){ return redondearMonto(n, true); }
  function asignacionVigenteEn(a, fechaISO){
    if(!a || !fechaISO) return false;
    if(a.vigente_desde && fechaISO < a.vigente_desde) return false;
    if(a.vigente_hasta && fechaISO > a.vigente_hasta) return false;
    return true;
  }
  function asignacionTerminada(a, hoyISO){ return !!(a && a.vigente_hasta && a.vigente_hasta < hoyISO); }
  function redondearFinCobro(min){
    const media = Math.floor(min/30)*30;
    return min - media <= TOLERANCIA_FIN_COBRO_MIN ? media : media + 30;
  }
  function familiaRedondeaFin(familia, fechaISO){
    const desde = familia?.terminos_aceptados_el;
    return !!desde && (!fechaISO || fechaISO >= desde);
  }
  function cruceMedianocheMalMarcado(horaIni, horaFin, cruza){
    if(!cruza || !horaIni || !horaFin) return false;
    return agendaMinutos(String(horaFin).slice(0,5)) > agendaMinutos(String(horaIni).slice(0,5));
  }
  function horasSitting(horaIni, horaFin, cruza, familia, fechaISO){
    if(!horaIni || !horaFin) return null;
    if(cruceMedianocheMalMarcado(horaIni, horaFin, cruza)) return null;
    const mi = agendaMinutos(String(horaIni).slice(0,5));
    const mf = agendaMinutos(String(horaFin).slice(0,5)) + (cruza ? 24*60 : 0);
    if(mf<=mi) return null;
    const mfCobro = familiaRedondeaFin(familia, fechaISO) ? Math.max(mi, redondearFinCobro(mf)) : mf;
    const hhmm = m => `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
    return { real: (mf-mi)/60, cobro: (mfCobro-mi)/60, finCobro: mfCobro!==mf ? hhmm(mfCobro) : null };
  }
  function efectoVariantes(base, efectos){
    const n = x => Number(x)||0;
    const total = efectos.filter(e=>e.modo==='total').pop();
    let v = total ? n(total.valor) : n(base);
    efectos.filter(e=>e.modo==='porcentaje').forEach(e=>{ v = v * (1 + n(e.valor)/100); });
    efectos.filter(e=>e.modo==='sumar').forEach(e=>{ v = v + n(e.valor); });
    return Math.max(Math.round(v*100)/100, 0);
  }
  function aplicarVariantes(baseCobro, basePago, aplicadas){
    const lado = k => (aplicadas||[]).map(a=>a && a[k]).filter(e=>e && e.modo);
    return { cobro: redondearCobro(efectoVariantes(baseCobro, lado('cobro'))), pago: redondearPago(efectoVariantes(basePago, lado('pago'))) };
  }
  function precioHoraNinera(familia, nineraId, precios, pagoFijo){
    // Number(null) y Number('') dan 0: un campo vacío o en 0 es "no cargado".
    const positivo = x => Number(x) > 0 ? Number(x) : null;
    if(positivo(pagoFijo) != null) return positivo(pagoFijo);
    const fila = nineraId && familia?.id ? (precios||[]).find(p => p && p.familia_id===familia.id && p.ninera_id===nineraId) : null;
    return positivo(fila?.pago_hora) ?? positivo(familia?.pago_hora);
  }
  // ---- js/sittings.js
  function precioSegunHorario(familia, horaIni, horaFin, cruza, fechaISO){
    const horas = horasSitting(horaIni, horaFin, cruza, familia, fechaISO);
    const cobroH = Number(familia?.cobro_hora)||0, pagoH = Number(familia?.pago_hora)||0;
    return {
      cobro: horas && cobroH ? redondearCobro(cobroH*horas.cobro) : null,
      pago: horas && pagoH ? redondearPago(pagoH*horas.real) : null,
    };
  }
  // ---- js/finanzas.js
  function construirEsTrabajoFijo(asigs){
    const porClave = new Map();
    const agregar = (k, a) => { if(!porClave.has(k)) porClave.set(k, []); porClave.get(k).push(a); };
    (asigs||[]).forEach(a=>{
      if(a.ninera_id && a.familia_id) agregar(a.ninera_id+'|'+a.familia_id, a);
      agregar(normaliza(a.ninera_nombre||'')+'|'+normaliza(a.familias?.nombre||''), a);
    });
    const vigenteEn = (k, fecha) => (porClave.get(k)||[]).some(a=>!fecha || asignacionVigenteEn(a, fecha));
    return function esTrabajoFijo(r){
      if(r.asignacion_id) return true;
      if(r.ninera_id && r.familia_id && vigenteEn(r.ninera_id+'|'+r.familia_id, r.fecha)) return true;
      return vigenteEn(normaliza(r.ninera_nombre||'')+'|'+normaliza(r.familia_nombre||''), r.fecha);
    };
  }
  function filtrarFijosSemanaIncompleta(sits, esEnCurso){
    return (sits||[]).filter(r => !esEnCurso(r));
  }
  function resumenFinancieroMes(sitsTodos, gastosNegocio, gastosAbsorbidos=0, inter=null, esEnCurso=()=>false){
    const hoy = todayISO();
    const suma = (lista, campo, cond=()=>true) => (lista||[]).filter(cond).reduce((s,r)=>s+(Number(r[campo])||0), 0);
    // Intermediaciones (20/10/2026): suman igual que un sitting, lo cobrado a Enrique o a la
    // empresa al facturado y lo que se les paga a las niñeras de un evento a pagos a niñeras.
    const it = inter || resumenIntermediaciones([], []);
    const facturado = suma(sitsTodos, 'cobro_familia') + it.facturado;
    const costoNinieras = suma(sitsTodos, 'pago_ninera') + it.pagos;
    const gastos = Number(gastosNegocio)||0;
    return {
      facturado,
      costoNinieras,
      gastos,
      cobrado: suma(sitsTodos, 'cobro_familia', r=>r.cobrado) + it.cobrado,
      porCobrar: suma(sitsTodos, 'cobro_familia', r=>!r.cobrado) + it.porCobrar,
      // Como la lista de Por pagar (E7): lo de días que todavía no pasaron no se debe todavía
      // (05/10/2026). Facturado y resultado sí lo cuentan, porque son del mes.
      porPagar: suma(sitsTodos, 'pago_ninera', r=>!r.pagado && r.fecha <= hoy && !esEnCurso(r)) + it.porPagar,
      porPagarEnCurso: suma(sitsTodos, 'pago_ninera', r=>!r.pagado && r.fecha <= hoy && esEnCurso(r)),
      porPagarFuturo: suma(sitsTodos, 'pago_ninera', r=>!r.pagado && r.fecha > hoy) + it.porPagarFuturo,
      // Gastos extra que absorbe Parents Break (13/10/2026): no se le cobran a nadie y se le
      // reintegran a la niñera, así que bajan la ganancia del mes.
      absorbidos: Number(gastosAbsorbidos)||0,
      resultado: facturado - costoNinieras - gastos - (Number(gastosAbsorbidos)||0),
      intermediaciones: it,
    };
  }
  function resumenIntermediaciones(enrique, eventos){
    const hoy = todayISO();
    const pagos = eventos.flatMap(ev=>(ev.intermediaciones_eventos_ninieras||[]).map(n=>({...n, fecha:ev.fecha})));
    const suma = (lista, campo, cond=()=>true) => lista.filter(cond).reduce((s,r)=>s+(Number(r[campo])||0), 0);
    const colocaciones = suma(enrique, 'monto');
    const cobroEventos = suma(eventos, 'cobro_total');
    const totalPagos = suma(pagos, 'pago');
    return {
      hay: enrique.length + eventos.length > 0,
      colocaciones, cobroEventos,
      facturado: colocaciones + cobroEventos,
      pagos: totalPagos,
      neto: colocaciones + cobroEventos - totalPagos,
      cobrado: suma(enrique, 'monto', r=>r.cobrado) + suma(eventos, 'cobro_total', r=>r.cobrado),
      porCobrar: suma(enrique, 'monto', r=>!r.cobrado) + suma(eventos, 'cobro_total', r=>!r.cobrado),
      porPagar: suma(pagos, 'pago', r=>!r.pagado && r.fecha <= hoy),
      porPagarFuturo: suma(pagos, 'pago', r=>!r.pagado && r.fecha > hoy),
    };
  }
  async function intermediacionesPendientes(){
    const hoy = todayISO();
    const [{data:enrique, error:e1}, {data:eventos, error:e2}, {data:pagos, error:e3}] = await Promise.all([
      sb.from('intermediaciones_enrique').select('id,ninera_nombre,fecha,monto').eq('cobrado', false).gt('monto', 0),
      sb.from('intermediaciones_eventos').select('id,empresa,fecha,cobro_total').eq('cobrado', false).gt('cobro_total', 0),
      sb.from('intermediaciones_eventos_ninieras').select('id,evento_id,ninera_id,ninera_nombre,pago').eq('pagado', false).gt('pago', 0),
    ]);
    let error = e1||e2||e3;
    let eventosDePagos = [];
    if(!error && pagos?.length){
      const res = await sb.from('intermediaciones_eventos').select('id,empresa,fecha').in('id', [...new Set(pagos.map(p=>p.evento_id))]).lte('fecha', hoy);
      error = res.error;
      eventosDePagos = res.data||[];
    }
    if(error){ toast('No se pudieron leer las intermediaciones pendientes: '+error.message, 'bad'); return { cobrar:[], pagar:[] }; }
    const cobrar = [
      ...(enrique||[]).map(r=>({nombre:'Agencia Enrique', detalle:`Colocación de ${r.ninera_nombre}`, bucket:r.fecha, total:Number(r.monto)||0, inter:{tabla:'intermediaciones_enrique', id:r.id}})),
      ...(eventos||[]).map(r=>({nombre:r.empresa, detalle:'Evento', bucket:r.fecha, total:Number(r.cobro_total)||0, inter:{tabla:'intermediaciones_eventos', id:r.id}})),
    ];
    const eventoPorId = Object.fromEntries(eventosDePagos.map(ev=>[ev.id, ev]));
    const pagar = (pagos||[]).filter(p=>eventoPorId[p.evento_id]).map(p=>{
      const ev = eventoPorId[p.evento_id];
      return {nombre:p.ninera_nombre, ninera_id:p.ninera_id, detalle:`Evento ${ev.empresa}`, bucket:ev.fecha, total:Number(p.pago)||0,
        inter:{tabla:'intermediaciones_eventos_ninieras', id:p.id, ninera:p.ninera_nombre, titulo:`Evento ${ev.empresa}`, detalle:fmtFechaCortaFin(ev.fecha), monto:Number(p.pago)||0}};
    });
    return { cobrar, pagar };
  }
  function lunesDeSemana(fechaISO){
    const dow = new Date(fechaISO+'T12:00:00').getDay();
    return sumarDiasISO(fechaISO, dow===0 ? -6 : 1-dow);
  }
  function inicioSemanaPago(fechaISO){
    return new Date(fechaISO+'T12:00:00').getDay()===0 ? fechaISO : lunesDeSemana(fechaISO);
  }
  function finSemanaPago(inicioISO){
    return new Date(inicioISO+'T12:00:00').getDay()===0 ? inicioISO : sumarDiasISO(inicioISO, 5);
  }
  function finEnMinutos(horaIni, horaFin, cruza){
    const aMin = h => { if(!h) return null; const [hh, mm] = String(h).split(':').map(Number); return Number.isFinite(hh) ? hh*60 + (mm||0) : null; };
    const f = aMin(horaFin);
    if(f===null) return null;
    const i = aMin(horaIni);
    return f + ((cruza || (i!==null && f<=i)) ? 1440 : 0);
  }
  function construirFinUltimoFijo(asigs){
    return function(nineraId, nineraNombre, fechaISO){
      const dia = diaSemanaDeISO(fechaISO);
      let fin = null;
      (asigs||[]).forEach(a=>{
        const suya = (nineraId && a.ninera_id===nineraId) || normaliza(a.ninera_nombre||'')===normaliza(nineraNombre||'');
        if(!suya || !asignacionVigenteEn(a, fechaISO) || !(a.dias||[]).includes(dia)) return;
        const m = finEnMinutos(a.hora_inicio, a.hora_fin, false);
        if(m!==null) fin = Math.max(fin ?? 0, m);
      });
      return fin;
    };
  }
  function cierreSemanaFijo(inicioISO, finUltimoFijo){
    const dia = finSemanaPago(inicioISO);
    const m = Math.max(Number(finUltimoFijo)||0, 0);
    return { fecha: sumarDiasISO(dia, Math.floor(m/1440)), min: m % 1440 };
  }
  function semanaFijoCerrada(cierre){
    const hoy = todayISO();
    if(hoy !== cierre.fecha) return hoy > cierre.fecha;
    return minutosAhoraMontevideo() >= cierre.min;
  }
  function construirEsEnCurso(sits, asigs){
    const esTrabajoFijo = construirEsTrabajoFijo(asigs);
    const finUltimoFijo = construirFinUltimoFijo(asigs);
    const clave = (r, fecha) => (r.ninera_id || normaliza(r.ninera_nombre||'')) + '|' + fecha;
    const registrados = {};
    (sits||[]).forEach(r=>{
      if(!esTrabajoFijo(r)) return;
      const fin = finEnMinutos(r.hora_inicio, r.hora_fin, r.termina_dia_siguiente);
      if(fin!==null) registrados[clave(r, r.fecha)] = Math.max(registrados[clave(r, r.fecha)]||0, fin);
    });
    const cierres = {};
    return function esEnCurso(r){
      if(!esTrabajoFijo(r)) return false;
      const inicio = inicioSemanaPago(r.fecha);
      const dia = finSemanaPago(inicio);
      const k = clave(r, dia);
      cierres[k] ??= cierreSemanaFijo(inicio, Math.max(finUltimoFijo(r.ninera_id, r.ninera_nombre, dia) ?? 0, registrados[k] ?? 0));
      return !semanaFijoCerrada(cierres[k]);
    };
  }
  function finDeSemanaDesde(lunesISO){
    return sumarDiasISO(lunesISO, 6);
  }
  function bucketKeyFecha(fechaISO, frecuencia){
    if(frecuencia==='mensual') return fechaISO.slice(0,7);
    if(frecuencia==='semanal') return lunesDeSemana(fechaISO);
    return fechaISO;
  }
  function bucketPagoFecha(fechaISO, frecuencia){
    return frecuencia==='semanal' ? inicioSemanaPago(fechaISO) : bucketKeyFecha(fechaISO, frecuencia);
  }
  async function cargarAjustesSaldo(filtro){
    if(!ajustesSaldoDisponible) return [];
    let q = sb.from('ajustes_saldo').select('*').order('fecha', {ascending:true});
    if(filtro?.familia_id) q = q.eq('familia_id', filtro.familia_id);
    if(filtro?.ninera_id) q = q.eq('ninera_id', filtro.ninera_id);
    const { data, error } = await q;
    if(error){
      if(error.code==='PGRST205' || error.code==='42P01'){ ajustesSaldoDisponible = false; return []; }
      toast('No se pudieron leer los saldos a favor: '+error.message, 'bad');
      return [];
    }
    return data||[];
  }
  function pendienteAjuste(a){
    const resto = Math.abs(Number(a.monto)||0) - (Number(a.aplicado)||0);
    return resto > 0 ? Math.sign(Number(a.monto)) * resto : 0;
  }
  function aplicarAjustesAGrupos(grupos, ajustes, sujeto){
    const clavePersona = sujeto==='familia'
      ? (x => x.familia_id || ('n:'+normaliza(x.nombre||x.familia_nombre||'')))
      : (x => x.ninera_id || ('n:'+normaliza(x.nombre||x.ninera_nombre||'')));
    const restos = new Map();
    ajustes.filter(a=>a.sujeto===sujeto).forEach(a=>{ const p = pendienteAjuste(a); if(p) restos.set(a.id, p); });
    grupos.forEach(g=>{ g.ajustes = []; g.totalNeto = g.total; });
    [...grupos].sort((a,b)=> a.bucket.localeCompare(b.bucket)).forEach(g=>{
      ajustes.filter(a=>a.sujeto===sujeto && restos.get(a.id)).forEach(a=>{
        const mismaPersona = clavePersona(a)===clavePersona(g) || (!!a[sujeto==='familia'?'familia_id':'ninera_id'] && a[sujeto==='familia'?'familia_id':'ninera_id']===g[sujeto==='familia'?'familia_id':'ninera_id']);
        if(!mismaPersona) return;
        const resto = restos.get(a.id);
        const usar = resto > 0 ? resto : -Math.min(-resto, g.totalNeto);
        if(!usar) return;
        g.ajustes.push({ id:a.id, monto:Math.round(usar*100)/100, motivo:a.motivo, fecha:a.fecha });
        g.totalNeto = Math.round((g.totalNeto + usar)*100)/100;
        const queda = Math.round((resto - usar)*100)/100;
        if(queda) restos.set(a.id, queda); else restos.delete(a.id);
      });
    });
    return ajustes.filter(a=>restos.get(a.id)).map(a=>({...a, restante: restos.get(a.id)}));
  }
  async function calcularPendientesAgrupados(){
    await esperarConfigFijos(); // fijos automáticos: saber si hay que sacar los previstos
    const [{data:pendCobrar, error:e1}, {data:pendPagar, error:e2}, {data:fams}, {data:nins}, {data:asigs}] = await Promise.all([
      sinPrevistos(sb.from('sittings_traslados').select('id,familia_id,familia_nombre,fecha,cobro_familia')).eq('cobrado', false).gt('cobro_familia', 0),
      // Por pagar solo muestra lo que ya pasó (05/10/2026, E7): un sitting cargado por
      // adelantado aparecía como para pagar y se le pagó a una niñera antes de que ocurriera.
      // Entra recién el día del sitting.
      sb.from('sittings_traslados').select('id,familia_id,familia_nombre,ninera_id,ninera_nombre,fecha,pago_ninera,asignacion_id,hora_inicio,hora_fin,termina_dia_siguiente').eq('pagado', false).gt('pago_ninera', 0).lte('fecha', todayISO()),
      sb.from('familias').select('id,nombre,frecuencia_cobro,cuenta_bancaria'),
      sb.from('ninieras').select('id,nombre,cuenta_bancaria'),
      sb.from('asignaciones').select('*, familias(nombre)'),
    ]);
    const famFrecPorId = {}; const famFrecPorNombre = {};
    (fams||[]).forEach(f=>{ famFrecPorId[f.id] = f.frecuencia_cobro || 'mensual'; famFrecPorNombre[normaliza(f.nombre)] = f.frecuencia_cobro || 'mensual'; });
    const ninInfoPorId = {}; const ninInfoPorNombre = {};
    (nins||[]).forEach(n=>{ ninInfoPorId[n.id] = n; ninInfoPorNombre[normaliza(n.nombre)] = n; });
    const esTrabajoFijo = construirEsTrabajoFijo(asigs);
  
    const gruposCobrar = {};
    (pendCobrar||[]).forEach(r=>{
      const frec = r.familia_id ? (famFrecPorId[r.familia_id]||'mensual') : (famFrecPorNombre[normaliza(r.familia_nombre)]||'mensual');
      const bucket = bucketKeyFecha(r.fecha, frec);
      const key = (r.familia_id||normaliza(r.familia_nombre))+'|'+bucket;
      if(!gruposCobrar[key]) gruposCobrar[key] = {nombre:r.familia_nombre, familia_id:r.familia_id||null, frec, bucket, total:0, ids:[]};
      gruposCobrar[key].total += Number(r.cobro_familia)||0;
      gruposCobrar[key].ids.push(r.id);
    });
    const gruposPagar = {};
    (pendPagar||[]).forEach(r=>{
      // La frecuencia depende del trabajo, no de la niñera: si es una relación fija con esa familia, se junta semanal; si es puntual, se paga aparte por día.
      const frec = esTrabajoFijo(r) ? 'semanal' : 'diario';
      const bucket = bucketPagoFecha(r.fecha, frec);
      const info = r.ninera_id ? ninInfoPorId[r.ninera_id] : ninInfoPorNombre[normaliza(r.ninera_nombre)];
      const key = (r.ninera_id||normaliza(r.ninera_nombre))+'|'+bucket;
      if(!gruposPagar[key]) gruposPagar[key] = {nombre:r.ninera_nombre, ninera_id:r.ninera_id||info?.id||null, frec, bucket, total:0, ids:[], cuentas:cuentasDeFicha(info)};
      gruposPagar[key].total += Number(r.pago_ninera)||0;
      gruposPagar[key].ids.push(r.id);
      if(frec==='semanal'){
        const fin = finEnMinutos(r.hora_inicio, r.hora_fin, r.termina_dia_siguiente);
        if(fin!==null){ const f = (gruposPagar[key].finesPorDia ||= {}); f[r.fecha] = Math.max(f[r.fecha]||0, fin); }
      }
    });
    // Gastos extra que pagó la niñera (08/10/2026): se le cobran a la familia tal cual y se le
    // reintegran a la niñera, en el mismo grupo que el sitting (o en uno propio si ese sitting
    // ya estaba cobrado/pagado). No suman al facturado ni al margen.
    const { gastos, sits: sitsGastos } = await cargarGastosExtraPendientes();
    const hoyG = todayISO();
    gastos.forEach(gx=>{
      const r = sitsGastos.find(x=>x.id===gx.sitting_id);
      if(!r) return;
      const item = { id: gx.id, concepto: gx.concepto, monto: Number(gx.monto)||0 };
      // Lo que absorbe Parents Break no se le cobra a la familia (13/10/2026): solo se reintegra.
      if(!gx.cobrado && !gx.absorbe_pb){
        const frec = r.familia_id ? (famFrecPorId[r.familia_id]||'mensual') : (famFrecPorNombre[normaliza(r.familia_nombre)]||'mensual');
        const bucket = bucketKeyFecha(r.fecha, frec);
        const key = (r.familia_id||normaliza(r.familia_nombre))+'|'+bucket;
        if(!gruposCobrar[key]) gruposCobrar[key] = {nombre:r.familia_nombre, familia_id:r.familia_id||null, frec, bucket, total:0, ids:[]};
        (gruposCobrar[key].gastos ||= []).push(item);
        gruposCobrar[key].total += item.monto;
      }
      if(!gx.reintegrado && r.fecha <= hoyG){
        const frec = esTrabajoFijo(r) ? 'semanal' : 'diario';
        const bucket = bucketPagoFecha(r.fecha, frec);
        const info = r.ninera_id ? ninInfoPorId[r.ninera_id] : ninInfoPorNombre[normaliza(r.ninera_nombre)];
        const key = (r.ninera_id||normaliza(r.ninera_nombre))+'|'+bucket;
        if(!gruposPagar[key]) gruposPagar[key] = {nombre:r.ninera_nombre, ninera_id:r.ninera_id||info?.id||null, frec, bucket, total:0, ids:[], cuentas:cuentasDeFicha(info)};
        (gruposPagar[key].gastos ||= []).push(item);
        gruposPagar[key].total += item.monto;
      }
    });
    // Sin los pendientes no se puede decir "No hay pagos pendientes": quien llama muestra el error.
    // Cuándo se puede pagar cada semana de fijo (cierreSemanaFijo).
    const finUltimoFijo = construirFinUltimoFijo(asigs);
    Object.values(gruposPagar).forEach(g=>{
      if(g.frec!=='semanal') return;
      const dia = finSemanaPago(g.bucket);
      g.hasta = dia;
      g.cierre = cierreSemanaFijo(g.bucket, Math.max(finUltimoFijo(g.ninera_id, g.nombre, dia) ?? 0, g.finesPorDia?.[dia] ?? 0));
    });
    return { gruposCobrar:Object.values(gruposCobrar), gruposPagar:Object.values(gruposPagar), fams:fams||[], nins:nins||[], error:e1||e2 };
  }
  function armarTarjetasPendientes(grupos, sujeto){
    const campoId = sujeto==='familia' ? 'familia_id' : 'ninera_id';
    const porId = new Map(), porNombre = new Map(), tarjetas = [];
    // Primero lo que trae el id; un registro viejo que solo trae el nombre va a la tarjeta de esa
    // persona (si no, la misma familia salía en dos tarjetas: lo encontró la red de plata).
    [...grupos].sort((a,b)=> (!a[campoId]) - (!b[campoId]) || a.bucket.localeCompare(b.bucket)).forEach(g=>{
      const nombre = normaliza(g.nombre||'');
      let t = g[campoId] ? porId.get(g[campoId]) : porNombre.get(nombre);
      if(!t){
        t = { nombre: g.nombre, [campoId]: g[campoId] || null, frec: g.frec, total: 0, ids: [], gastos: [], grupos: [] };
        if(g.cuentas) t.cuentas = g.cuentas;
        if(g[campoId]) porId.set(g[campoId], t);
        if(!porNombre.has(nombre)) porNombre.set(nombre, t);
        tarjetas.push(t);
      }
      t.total += g.total;
      t.ids.push(...g.ids);
      t.gastos.push(...(g.gastos||[]));
      t.grupos.push(g);
      if(t.frec !== g.frec) t.frec = null; // una fija con semanas y días sueltos: sin frecuencia
    });
    tarjetas.forEach(t=>{
      t.grupos.sort((a,b)=> a.bucket.localeCompare(b.bucket));
      t.bucket = t.grupos[t.grupos.length-1].bucket;
    });
    return tarjetas;
  }
  function esFaltaTabla(error){ return !!error && (error.code==='PGRST205' || error.code==='42P01'); }
  async function cargarGastosExtraPendientes(){
    if(!gastosExtraDisponible) return { gastos:[], sits:[] };
    const { data, error } = await sb.from('gastos_extra').select('*').eq('pagado_por', 'ninera').or('cobrado.eq.false,reintegrado.eq.false');
    if(error){
      if(esFaltaTabla(error)) gastosExtraDisponible = false;
      else toast('No se pudieron leer los gastos extra: '+error.message, 'bad');
      return { gastos:[], sits:[] };
    }
    if(!data || !data.length) return { gastos:[], sits:[] };
    const { data: sits } = await sb.from('sittings_traslados').select('id,fecha,familia_id,familia_nombre,ninera_id,ninera_nombre,asignacion_id')
      .in('id', [...new Set(data.map(g=>g.sitting_id))]);
    return { gastos: data, sits: sits||[] };
  }
  function montoGrupo(g, sujeto){
    const n = g.totalNeto ?? g.total;
    return sujeto==='familia' ? redondearCobro(n) : redondearPago(n);
  }
  function cuentasDeFicha(info){ return (info?.cuenta_bancaria||[]).filter(Boolean); }
  function montoParaCopiar(n){ return String(redondearPago(n)); }
  function totalParcial(subtotal, ajustes, sujeto){
    let neto = subtotal;
    const usados = [];
    (ajustes||[]).forEach(a=>{
      const m = Number(a.monto)||0;
      const usar = m > 0 ? m : -Math.min(-m, Math.max(neto, 0));
      if(!usar) return;
      usados.push({ ...a, monto: Math.round(usar*100)/100 });
      neto = Math.round((neto + usar)*100)/100;
    });
    return { total: sujeto==='familia' ? redondearCobro(neto) : redondearPago(neto), usados };
  }
  function combinacionExacta(unidades, objetivo, ajustes, sujeto){
    const cent = unidades.map(u=>Math.round((Number(u.monto)||0)*100));
    const n = cent.length;
    // alcanzables[k]: las sumas que se pueden armar con las unidades k..n-1.
    const alcanzables = Array(n+1);
    alcanzables[n] = new Set([0]);
    for(let k=n-1; k>=0; k--){
      const s = new Set(alcanzables[k+1]);
      alcanzables[k+1].forEach(x=>s.add(x + cent[k]));
      if(s.size > 200000) return null; // demasiadas combinaciones: mejor a mano
      alcanzables[k] = s;
    }
    let mejor = null;
    alcanzables[0].forEach(suma=>{
      if(!suma || totalParcial(suma/100, ajustes, sujeto).total !== objetivo) return;
      // De la más vieja a la más nueva, cada una entra si con ella todavía se llega a la suma.
      const elegidas = [];
      let resto = suma;
      for(let k=0; k<n; k++){
        if(alcanzables[k+1].has(resto - cent[k])){ elegidas.push(k); resto -= cent[k]; }
      }
      const masVieja = (a, b) => { for(let j=0; j<Math.min(a.length, b.length); j++) if(a[j]!==b[j]) return a[j] < b[j]; return a.length < b.length; };
      if(!mejor || masVieja(elegidas, mejor)) mejor = elegidas;
    });
    return mejor;
  }
  return { agendaMinutos, gastoACargoFamilia, redondearMonto, redondearPago, redondearCobro, asignacionVigenteEn, asignacionTerminada, redondearFinCobro, familiaRedondeaFin, cruceMedianocheMalMarcado, horasSitting, efectoVariantes, aplicarVariantes, precioHoraNinera, precioSegunHorario, construirEsTrabajoFijo, filtrarFijosSemanaIncompleta, resumenFinancieroMes, resumenIntermediaciones, intermediacionesPendientes, lunesDeSemana, inicioSemanaPago, finSemanaPago, finEnMinutos, construirFinUltimoFijo, cierreSemanaFijo, semanaFijoCerrada, construirEsEnCurso, finDeSemanaDesde, bucketKeyFecha, bucketPagoFecha, cargarAjustesSaldo, pendienteAjuste, aplicarAjustesAGrupos, calcularPendientesAgrupados, armarTarjetasPendientes, esFaltaTabla, cargarGastosExtraPendientes, montoGrupo, cuentasDeFicha, montoParaCopiar, totalParcial, combinacionExacta };
}
const ORACULO_PLATA_CONGELADO = { fecha: "31/10/2026", commit: "1047c50" };
if (typeof module !== 'undefined') module.exports = { crearOraculoPlata, ORACULO_PLATA_CONGELADO };
