// La ficha de la familia y los cambios en el simulador (fase 1, etapa 8, 02/11/2026): la misma regla que
// supabase/migraciones/20261107_ficha_cambios.sql (decisiones.md 6.5).
// - Las RPC de la niñera: ninera_guardar_ficha_familia, ninera_ficha_familia, ninera_mis_cambios y
//   ninera_responder_cambio (con el aviso a las admins del "No puedo").
// - Los avisos por día del trigger de sittings_traslados (avisosSittings: cancelado, ya no vas, nuevo y cambio de
//   horario, con su fila en cambios_horario) y lo nuevo de solicitudes_al_cancelar (cancelarRegistroDelPedido: la
//   elegida y su registro en $0). El resumen de los fijos de generar_previstos_fijos no se simula (no corre en el
//   navegador): lo prueba supabase/pruebas/fase1_ficha_cambios.sql.
// Datos en db.fichas_familia y db.cambios_horario. "Ahora" es el reloj fijo del test (sin reloj, la hora real).
const { randomUUID } = require('crypto');
const { errorRpc, encolarAviso, madreNombreInicial, pedidoPuedeAvisar } = require('./rpc-ninera');

const RPC_ETAPA_8 = ['ninera_guardar_ficha_familia', 'ninera_ficha_familia', 'ninera_mis_cambios', 'ninera_responder_cambio'];
const TABLAS_ETAPA_8 = ['fichas_familia', 'cambios_horario'];
// ficha_familia_campos(): 15 textos y 6 casillas.
const TEXTOS_FICHA = ['direccion', 'chicos', 'tel_madre', 'tel_padre', 'otro_adulto', 'emergencia', 'mutualista', 'alergias',
  'medicacion', 'salud', 'comidas', 'sueno', 'reglas', 'retira', 'otros'];
const CASILLAS_FICHA = ['c_botiquin', 'c_llaves', 'c_linterna', 'c_telefonos', 'c_medicacion', 'c_adrenalina'];

const fechaMvd = ms => new Date(ms - 3 * 3600000).toISOString().slice(0, 10);
const sumarDias = (fecha, n) => new Date(Date.parse(fecha + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const hhmm = h => String(h).slice(0, 5);
const momento = (fecha, hora) => Date.parse(`${fecha}T${hhmm(hora)}:00-03:00`);
function diaCortoTexto(fecha) {
  const dow = new Date(fecha + 'T00:00:00Z').getUTCDay();
  return `${['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][dow]} ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
}
function horarioTexto(hi, hf, termina) {
  if (!hi) return 'sin horario';
  if (!hf) return `desde las ${hhmm(hi)}`;
  return `de ${hhmm(hi)} a ${hhmm(hf)}${termina ? ' del día siguiente' : ''}`;
}
const esSitting = s => (s.tipo || 'sitting') === 'sitting';
// La base no deja un largo de más de 1000 caracteres (char_length cuenta caracteres, no unidades UTF-16).
const largo = t => Array.from(t).length;

// ahora: el reloj fijo del test; sin reloj (null), la hora real de cada llamada, como now() en la base.
function rpcFichaNinera(db, nineraId, ahora = null) {
  const reloj = () => { const ms = ahora ? Date.parse(ahora) : Date.now(); return { ms, iso: new Date(ms).toISOString(), hoy: fechaMvd(ms) }; };
  const noAutorizada = () => { if (!nineraId) throw errorRpc('no_autorizada'); };
  const nombreNinera = () => (db.ninieras || []).find(n => n.id === nineraId)?.nombre || '';
  return {
    ninera_guardar_ficha_familia: ({ p_sitting_id, p_datos }) => {
      noAutorizada();
      const { iso, hoy } = reloj();
      if (!p_datos || typeof p_datos !== 'object' || Array.isArray(p_datos)) throw errorRpc('ficha_invalida');
      if (Object.keys(p_datos).some(k => !TEXTOS_FICHA.includes(k) && !CASILLAS_FICHA.includes(k))) throw errorRpc('ficha_invalida');
      const s = (db.sittings_traslados || []).find(x => x.id === p_sitting_id && x.ninera_id === nineraId && esSitting(x) && !x.cancelado
        && (x.estado ?? 'confirmado') === 'confirmado' && (x.fecha === hoy || x.fecha === sumarDias(hoy, -1)));
      if (!s || !s.familia_id) throw errorRpc('no_existe');
      const datos = {};
      for (const clave of [...TEXTOS_FICHA, ...CASILLAS_FICHA]) {
        const v = p_datos[clave];
        if (v == null) continue;
        if (CASILLAS_FICHA.includes(clave)) {
          if (typeof v !== 'boolean') throw errorRpc('ficha_invalida');
          if (v) datos[clave] = true;
        } else {
          if (typeof v !== 'string') throw errorRpc('ficha_invalida');
          const t = v.trim();
          if (largo(t) > 1000) throw errorRpc('texto_largo');
          if (t) datos[clave] = t;
        }
      }
      const lista = db.fichas_familia = db.fichas_familia || [];
      let f = lista.find(x => x.sitting_id === s.id);
      if (f) Object.assign(f, { datos, actualizada_en: iso });
      else { f = { id: randomUUID(), familia_id: s.familia_id, sitting_id: s.id, ninera_id: nineraId, datos, creada_en: iso, actualizada_en: iso }; lista.push(f); }
      return f.actualizada_en;
    },
    ninera_ficha_familia: ({ p_sitting_id }) => {
      if (!nineraId) return [];
      const { ms, hoy } = reloj();
      const s = (db.sittings_traslados || []).find(x => x.id === p_sitting_id && x.ninera_id === nineraId && esSitting(x) && !x.cancelado
        && ['previsto', 'confirmado'].includes(x.estado ?? 'confirmado'));
      if (!s || !s.familia_id) return [];
      const fin = s.hora_fin ? momento(s.termina_dia_siguiente ? sumarDias(s.fecha, 1) : s.fecha, s.hora_fin) : momento(sumarDias(s.fecha, 1), '00:00');
      const fichas = (db.fichas_familia || []);
      if (ms < fin) {
        const de = fichas.filter(f => f.familia_id === s.familia_id)
          .sort((a, b) => Number(b.sitting_id === s.id) - Number(a.sitting_id === s.id) || b.actualizada_en.localeCompare(a.actualizada_en));
        return de.slice(0, 1).map(f => ({ datos: f.datos, actualizada_en: f.actualizada_en, es_de_este_sitting: f.sitting_id === s.id }));
      }
      if (s.fecha < sumarDias(hoy, -1)) return [];
      return fichas.filter(f => f.sitting_id === s.id && f.ninera_id === nineraId)
        .map(f => ({ datos: f.datos, actualizada_en: f.actualizada_en, es_de_este_sitting: true }));
    },
    ninera_mis_cambios: () => {
      if (!nineraId) return [];
      const { hoy } = reloj();
      return (db.cambios_horario || []).filter(c => c.ninera_id === nineraId && c.respuesta == null && c.desde >= hoy)
        .sort((a, b) => a.creado_en.localeCompare(b.creado_en))
        .map(c => {
          const f = (db.familias || []).find(x => x.id === c.familia_id);
          return { id: c.id, es_fijo: !!c.es_fijo, desde: c.desde, hora_inicio: c.hora_inicio ?? null, hora_fin: c.hora_fin ?? null,
            termina_dia_siguiente: !!c.termina_dia_siguiente, madre: madreNombreInicial(f && f.nombre != null ? f.nombre : c.familia_nombre),
            zona: f && String(f.zona || '').trim() ? f.zona.trim() : null, creado_en: c.creado_en };
        });
    },
    ninera_responder_cambio: ({ p_cambio_id, p_ok }) => {
      noAutorizada();
      if (typeof p_ok !== 'boolean') throw errorRpc('respuesta_invalida');
      const c = (db.cambios_horario || []).find(x => x.id === p_cambio_id && x.ninera_id === nineraId);
      if (!c) throw errorRpc('no_existe');
      if (c.respuesta != null) return c.respuesta;
      const { iso } = reloj();
      Object.assign(c, { respuesta: p_ok, respondido_en: iso });
      if (!p_ok) {
        const nombre = nombreNinera();
        const horario = horarioTexto(c.hora_inicio, c.hora_fin, c.termina_dia_siguiente);
        encolarAviso(db, iso, {
          clave: `admin:cambio:${c.id}:no_puede`, para_admin: 'todas', tipo: 'el_dia',
          titulo: c.es_fijo ? `${nombre} no puede el nuevo horario de su fijo con ${c.familia_nombre || 'la familia'}` : `${nombre} no puede el ${diaCortoTexto(c.desde)} ${horario}`,
          cuerpo: c.es_fijo ? `Desde el ${diaCortoTexto(c.desde)}, ${horario}. Buscá a otra.` : 'Buscá a otra.',
          url: c.solicitud_id ? `?ir=agenda&solicitud=${c.solicitud_id}` : '?ir=agenda',
          datos: { cambio_id: c.id, ninera_id: nineraId, sitting_id: c.sitting_id ?? null },
        });
      }
      return p_ok;
    },
  };
}

// aviso_sitting_ninera(): un aviso de un día a una niñera activa con app, si el sitting no empezó (y con solo_practica,
// solo los de práctica). txid: el número de la "transacción" (cada escritura del simulador es una).
function avisoSitting(db, ahoraISO, txid, tipo, s, { ninera_id, fecha, hora_inicio, hora_fin, termina_dia_siguiente }, fechaAntes = null) {
  if (!ninera_id || !fecha) return;
  if (momento(fecha, hora_inicio || '00:00') <= Date.parse(ahoraISO)) return;
  const n = (db.ninieras || []).find(x => x.id === ninera_id);
  if (!n || !n.activa || n.user_id == null || !pedidoPuedeAvisar(db, s.familia_id, s.familia_nombre, n.nombre)) return;
  const f = (db.familias || []).find(x => x.id === s.familia_id);
  const madre = madreNombreInicial(f && f.nombre != null ? f.nombre : s.familia_nombre);
  const zona = f && String(f.zona || '').trim() ? f.zona.trim() : null;
  const dia = diaCortoTexto(fecha);
  const datos = { sitting_id: s.id };
  if (tipo === 'cancelado') {
    encolarAviso(db, ahoraISO, { clave: `sitting:${s.id}:cancelado:${txid}`, para_ninera_id: ninera_id, tipo: 'sitting',
      titulo: `Se canceló tu sitting del ${dia}`, cuerpo: `Con ${madre.replace(/\.+$/, '')}. Si tienes dudas, escríbenos.`, url: '#inicio', datos });
  } else if (tipo === 'sin') {
    encolarAviso(db, ahoraISO, { clave: `sitting:${s.id}:sin:${ninera_id}:${txid}`, para_ninera_id: ninera_id, tipo: 'sitting',
      titulo: `Ya no vas al sitting del ${dia}`, cuerpo: 'El equipo hizo un cambio. Si tienes dudas, escríbenos.', url: '#inicio', datos });
  } else if (tipo === 'nuevo') {
    if (s.solicitud_id && (db.solicitud_ninieras || []).some(sn => sn.solicitud_id === s.solicitud_id && sn.ninera_id === ninera_id && sn.estado === 'confirmada')) return;
    encolarAviso(db, ahoraISO, { clave: `sitting:${s.id}:nuevo:${ninera_id}:${txid}`, para_ninera_id: ninera_id, tipo: 'sitting',
      titulo: `Tienes un sitting el ${dia}`, cuerpo: `${hora_inicio ? hhmm(hora_inicio) : 'Sin horario'}${zona ? `, en ${zona}` : ''}. Mira los datos en la app.`, url: '#inicio', datos });
  } else if (tipo === 'cambio') {
    const id = randomUUID();
    const clave = `sitting:${s.id}:cambio:${fecha}:${hora_inicio ? hhmm(hora_inicio).replace(':', '') : ''}-${hora_fin ? hhmm(hora_fin).replace(':', '') : ''}${termina_dia_siguiente ? 'd' : ''}`;
    const otroDia = fechaAntes && fechaAntes !== fecha;
    if (encolarAviso(db, ahoraISO, { clave, para_ninera_id: ninera_id, tipo: 'sitting',
      titulo: `Cambió el horario de tu sitting del ${diaCortoTexto(fechaAntes || fecha)}`,
      cuerpo: `Ahora es ${otroDia ? `el ${dia}, ` : ''}${horarioTexto(hora_inicio, hora_fin, termina_dia_siguiente)}. Mira los detalles.`,
      url: `#cambio/${id}`, datos: { ...datos, cambio_id: id } })) {
      (db.cambios_horario = db.cambios_horario || []).push({ id, ninera_id, familia_id: s.familia_id ?? null, familia_nombre: s.familia_nombre ?? null,
        sitting_id: s.id, solicitud_id: s.solicitud_id ?? null, es_fijo: false, desde: fecha, hora_inicio: hora_inicio ?? null, hora_fin: hora_fin ?? null,
        termina_dia_siguiente: !!termina_dia_siguiente, creado_en: ahoraISO, respuesta: null, respondido_en: null });
    }
  }
}

// sittings_avisos_cambios(): metodo 'POST' | 'PATCH' | 'DELETE'; pares [antes, después] (antes null en un insert,
// después null en un delete). Solo sittings.
let txSimulada = 0;
function avisosSittings(db, ahoraISO, metodo, pares) {
  const txid = ++txSimulada;
  const campos = ['cancelado', 'ninera_id', 'fecha', 'hora_inicio', 'hora_fin', 'termina_dia_siguiente'];
  const de = s => ({ ninera_id: s.ninera_id, fecha: s.fecha, hora_inicio: s.hora_inicio, hora_fin: s.hora_fin, termina_dia_siguiente: !!s.termina_dia_siguiente });
  for (const [o, n] of pares) {
    if (metodo === 'POST') {
      if (esSitting(n) && !n.cancelado && n.asignacion_id == null) avisoSitting(db, ahoraISO, txid, 'nuevo', n, de(n));
    } else if (metodo === 'DELETE') {
      if (esSitting(o) && !o.cancelado) avisoSitting(db, ahoraISO, txid, 'cancelado', o, de(o));
    } else if (esSitting(n) && campos.some(c => (o[c] ?? null) !== (n[c] ?? null) && !(c === 'termina_dia_siguiente' && !!o[c] === !!n[c]))) {
      if (!o.cancelado && n.cancelado) avisoSitting(db, ahoraISO, txid, 'cancelado', n, de(o));
      else if (o.cancelado && !n.cancelado) avisoSitting(db, ahoraISO, txid, 'nuevo', n, de(n));
      else if (!n.cancelado && (o.ninera_id ?? null) !== (n.ninera_id ?? null)) {
        avisoSitting(db, ahoraISO, txid, 'sin', n, de(o));
        avisoSitting(db, ahoraISO, txid, 'nuevo', n, de(n));
      } else if (!n.cancelado) avisoSitting(db, ahoraISO, txid, 'cambio', n, de(n), o.fecha);
    }
  }
}

// Lo nuevo de solicitudes_al_cancelar() (etapa 8): la elegida pasa a 'cancelado' y su registro de hoy en adelante, si
// no está cobrado ni pagado, queda cancelado en $0 (con su aviso, como cualquier cancelación).
function cancelarRegistroDelPedido(db, ahoraISO, s) {
  const hoy = fechaMvd(Date.parse(ahoraISO));
  (db.solicitud_ninieras || []).forEach(sn => { if (sn.solicitud_id === s.id && sn.estado === 'confirmada') sn.estado = 'cancelado'; });
  const pares = [];
  for (const r of (db.sittings_traslados || [])) {
    if (r.solicitud_id !== s.id || r.cancelado || r.cobrado || r.pagado || r.fecha < hoy) continue;
    const antes = { ...r };
    Object.assign(r, { cancelado: true, cobro_familia: 0, pago_ninera: 0, cobrado: true, pagado: true, generado_automatico: false,
      notas: [String(r.notas || '').trim(), 'Pedido cancelado'].filter(Boolean).join(' — ') });
    pares.push([antes, r]);
  }
  if (pares.length) avisosSittings(db, ahoraISO, 'PATCH', pares);
}

module.exports = { RPC_ETAPA_8, TABLAS_ETAPA_8, rpcFichaNinera, avisosSittings, cancelarRegistroDelPedido };
