// El día del sitting y el cierre en el simulador (fase 1, etapa 7, 02/11/2026): la misma regla que
// supabase/migraciones/20261106_el_dia.sql (decisiones.md 6.4). Las RPC de la niñera (ninera_mi_dia,
// ninera_marcar_evento, ninera_cerrar_sitting) con sus errores y los avisos inmediatos a las admins, y lo
// que la RLS deja leer y escribir de sitting_eventos y sitting_cierres (lo usa app.js). Datos en
// db.sitting_eventos y db.sitting_cierres; las fotos de los comprobantes que subió la app, en
// db.storage_comprobantes (las anota app.js). "Ahora" es el reloj fijo del test.
const { randomUUID } = require('crypto');
const { errorRpc, encolarAviso, madreNombreInicial } = require('./rpc-ninera');

const RPC_ETAPA_7 = ['ninera_mi_dia', 'ninera_marcar_evento', 'ninera_cerrar_sitting'];
const TABLAS_ETAPA_7 = ['sitting_eventos', 'sitting_cierres'];
const TIPOS_EVENTO = ['saliendo', 'tarde', 'entre', 'no_abren', 'no_encuentro'];
const COLUMNAS_REVISION_CIERRE = ['revisado_en', 'revisado_por', 'gasto_id'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const fechaMvd = ms => new Date(ms - 3 * 3600000).toISOString().slice(0, 10);
const sumarDias = (fecha, n) => new Date(Date.parse(fecha + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const hhmm = h => String(h).slice(0, 5);
// Un momento de Montevideo (UTC-3 todo el año) de un día y una hora.
const momento = (fecha, hora) => Date.parse(`${fecha}T${hhmm(hora)}:00-03:00`);

// sitting_del_dia_ninera(): el sitting si es de esa niñera, un sitting (no traslado), no cancelado, confirmado
// y de hoy o de ayer.
function sittingDelDia(db, nineraId, id, hoy) {
  return (db.sittings_traslados || []).find(s => s.id === id && s.ninera_id === nineraId && (s.tipo || 'sitting') === 'sitting'
    && !s.cancelado && (s.estado ?? 'confirmado') === 'confirmado' && (s.fecha === hoy || s.fecha === sumarDias(hoy, -1))) || null;
}
const cierreDe = (db, id) => (db.sitting_cierres || []).find(c => c.sitting_id === id) || null;
const nombreFamilia = (db, s) => ((db.familias || []).find(f => f.id === s.familia_id)?.nombre) ?? s.familia_nombre;

// La ruta exacta del comprobante que la niñera puede subir (ninera_ruta_comprobante).
function rutaComprobantePermitida(db, nineraId, ruta, ahora) {
  const m = new RegExp(`^ninieras/${nineraId}/([0-9a-f-]{36})\\.jpg$`).exec(ruta || '');
  if (!m || !UUID.test(m[1])) return false;
  const hoy = fechaMvd(Date.parse(ahora));
  return !!sittingDelDia(db, nineraId, m[1], hoy) && !cierreDe(db, m[1]);
}

// ahora: el reloj fijo del test; sin reloj (null), la hora real de cada llamada, como now() en la base.
function rpcDiaNinera(db, nineraId, ahora = null) {
  const reloj = () => { const ahoraMs = ahora ? Date.parse(ahora) : Date.now(); return { ahoraMs, ahoraISO: new Date(ahoraMs).toISOString(), hoy: fechaMvd(ahoraMs) }; };
  const nombreNinera = () => (db.ninieras || []).find(n => n.id === nineraId)?.nombre || '';
  return {
    ninera_mi_dia: () => {
      if (!nineraId) return [];
      const { hoy } = reloj();
      return (db.sittings_traslados || [])
        .filter(s => s.ninera_id === nineraId && (s.tipo || 'sitting') === 'sitting' && !s.cancelado && (s.estado ?? 'confirmado') === 'confirmado')
        .filter(s => s.fecha === hoy || (s.fecha === sumarDias(hoy, -1) && !cierreDe(db, s.id) && !s.revisado_at))
        .sort((a, b) => (a.fecha + (a.hora_inicio || '')).localeCompare(b.fecha + (b.hora_inicio || '')))
        .map(s => {
          const f = (db.familias || []).find(x => x.id === s.familia_id);
          const c = cierreDe(db, s.id);
          return {
            id: s.id, fecha: s.fecha, hora_inicio: s.hora_inicio ?? null, hora_fin: s.hora_fin ?? null,
            termina_dia_siguiente: !!s.termina_dia_siguiente, es_fijo: s.asignacion_id != null,
            zona: f ? (f.zona ?? null) : null, madre: madreNombreInicial(f && f.nombre != null ? f.nombre : s.familia_nombre),
            eventos: (db.sitting_eventos || []).filter(e => e.sitting_id === s.id && e.ninera_id === nineraId)
              .sort((a, b) => a.creado_en.localeCompare(b.creado_en) || a.tipo.localeCompare(b.tipo))
              .map(e => ({ tipo: e.tipo, minutos: e.minutos ?? null, en: e.creado_en })),
            cerrado_en: c && c.ninera_id === nineraId ? c.creado_en : null,
          };
        });
    },

    ninera_marcar_evento: ({ p_sitting_id, p_tipo, p_minutos = null } = {}) => {
      if (!nineraId) throw errorRpc('no_autorizada');
      const { ahoraISO, hoy } = reloj();
      if (!TIPOS_EVENTO.includes(p_tipo)) throw errorRpc('evento_invalido');
      if (p_tipo === 'tarde' && ![10, 20, 30].includes(p_minutos)) throw errorRpc('minutos_invalidos');
      const minutos = p_tipo === 'tarde' ? p_minutos : null;
      const s = sittingDelDia(db, nineraId, p_sitting_id, hoy);
      if (!s) throw errorRpc('no_existe');
      if (cierreDe(db, s.id)) throw errorRpc('ya_cerrado');
      const lista = db.sitting_eventos = db.sitting_eventos || [];
      const existente = lista.find(e => e.sitting_id === s.id && e.tipo === p_tipo);
      if (existente && existente.minutos === minutos) return existente.creado_en;
      if (existente) existente.minutos = minutos;
      else lista.push({ id: randomUUID(), sitting_id: s.id, ninera_id: nineraId, tipo: p_tipo, minutos, creado_en: ahoraISO });
      const familia = nombreFamilia(db, s), nombre = nombreNinera();
      const comun = { para_admin: 'todas', tipo: 'el_dia', url: `?ir=hoy&sitting=${s.id}`, datos: { sitting_id: s.id, ninera_id: nineraId } };
      if (p_tipo === 'tarde') encolarAviso(db, ahoraISO, { ...comun, clave: `admin:sitting:${s.id}:tarde:${minutos}`,
        titulo: `${nombre} va a llegar ${minutos === 30 ? '30 min o más' : `${minutos} min`} tarde`, cuerpo: `A lo de ${familia}.` });
      if (p_tipo === 'no_abren') encolarAviso(db, ahoraISO, { ...comun, clave: `admin:sitting:${s.id}:no_abren`,
        titulo: `${nombre} está afuera y no le abren`, cuerpo: `${familia}.` });
      if (p_tipo === 'no_encuentro') encolarAviso(db, ahoraISO, { ...comun, clave: `admin:sitting:${s.id}:no_encuentro`,
        titulo: `${nombre} no encuentra la casa`, cuerpo: `${familia}.` });
      return existente ? existente.creado_en : ahoraISO;
    },

    ninera_cerrar_sitting: (c = {}) => {
      if (!nineraId) throw errorRpc('no_autorizada');
      const { ahoraMs, ahoraISO, hoy } = reloj();
      const s = sittingDelDia(db, nineraId, c.p_sitting_id, hoy);
      if (!s) throw errorRpc('no_existe');
      const ya = cierreDe(db, s.id);
      if (ya) return ya.creado_en;
      if (s.revisado_at) throw errorRpc('ya_revisado');
      const dia = !!c.p_dia_siguiente;
      if (!c.p_hora_fin || !/^\d{2}:\d{2}/.test(c.p_hora_fin)) throw errorRpc('hora_invalida');
      const fin = hhmm(c.p_hora_fin), inicio = s.hora_inicio ? hhmm(s.hora_inicio) : null;
      if (inicio && ((!dia && fin <= inicio) || (dia && fin > inicio))) throw errorRpc('hora_invalida');
      if (momento(dia ? sumarDias(s.fecha, 1) : s.fecha, fin) > ahoraMs + 15 * 60000) throw errorRpc('hora_futura');
      const texto = t => { const v = String(t ?? '').trim(); return v === '' ? null : v; };
      const comentarios = texto(c.p_comentarios), jugaron = texto(c.p_jugaron), equipo = texto(c.p_comentario_equipo);
      if ([comentarios, jugaron, equipo].some(t => t && t.length > 2000)) throw errorRpc('texto_largo');
      if (c.p_calificacion != null && !(c.p_calificacion >= 1 && c.p_calificacion <= 5)) throw errorRpc('calificacion_invalida');
      let concepto = null, ruta = null;
      const monto = c.p_gasto_monto ?? null;
      if (monto != null) {
        if (!(monto > 0 && monto < 100000)) throw errorRpc('gasto_invalido');
        concepto = String(c.p_gasto_concepto ?? '').replace(/\s+/g, ' ').trim() || null;
        if (!concepto || concepto.length > 120) throw errorRpc('gasto_sin_concepto');
        ruta = `ninieras/${nineraId}/${s.id}.jpg`;
        if (!(db.storage_comprobantes || []).includes(ruta)) throw errorRpc('falta_comprobante');
      }
      const fila = { sitting_id: s.id, ninera_id: nineraId, hora_fin: `${fin}:00`, termina_dia_siguiente: dia, comentarios,
        calificacion: c.p_calificacion ?? null, volveria: c.p_volveria ?? null, jugaron, comentario_equipo: equipo,
        gasto_monto: monto, gasto_concepto: concepto, gasto_comprobante: ruta, gasto_id: null, creado_en: ahoraISO,
        revisado_en: null, revisado_por: null };
      (db.sitting_cierres = db.sitting_cierres || []).push(fila);
      const familia = nombreFamilia(db, s), nombre = nombreNinera();
      const comun = { para_admin: 'todas', tipo: 'cierres', url: '?ir=hoy', datos: { sitting_id: s.id, ninera_id: nineraId } };
      encolarAviso(db, ahoraISO, { ...comun, clave: `admin:sitting:${s.id}:cerro`, titulo: `${nombre} terminó en ${familia} a las ${fin}`, cuerpo: 'Revisá el registro.' });
      if (monto != null) encolarAviso(db, ahoraISO, { ...comun, clave: `admin:sitting:${s.id}:gasto`,
        titulo: `${nombre} cargó un gasto de $${Math.round(monto).toLocaleString('es-UY')}`, cuerpo: 'Con comprobante. Elegí quién lo paga.' });
      if (comentarios) encolarAviso(db, ahoraISO, { ...comun, clave: `admin:sitting:${s.id}:comentario`,
        titulo: `${nombre} dejó un comentario del sitting con ${familia}`, cuerpo: 'Leelo ahora.' });
      return ahoraISO;
    },
  };
}

// "Prefiero otros perfiles" de sugeridas_datos: la última respuesta de esa niñera con esa familia dijo que no.
function prefiereOtros(db, nineraId, familiaId, familiaNombre, mismoNombre) {
  const ultima = (db.sitting_cierres || []).filter(c => c.ninera_id === nineraId && c.volveria != null)
    .filter(c => {
      const s = (db.sittings_traslados || []).find(x => x.id === c.sitting_id);
      return s && (s.familia_id === familiaId || (s.familia_id == null && mismoNombre(s.familia_nombre, familiaNombre)));
    })
    .sort((a, b) => b.creado_en.localeCompare(a.creado_en))[0];
  return !!ultima && ultima.volveria === false;
}

module.exports = { RPC_ETAPA_7, TABLAS_ETAPA_7, COLUMNAS_REVISION_CIERRE, rpcDiaNinera, rutaComprobantePermitida, prefiereOtros };
