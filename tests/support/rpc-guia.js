// La guía obligatoria y la firma anual en el simulador (fase 1, etapa 4, 02/11/2026): la misma regla que
// guia_estado() de supabase/migraciones/20261105_guia.sql (decisiones.md 8), las RPC de la niñera
// (ninera_estado_guia, ninera_marcar_leida, ninera_aprobar_repaso, ninera_firmar_guia, ninera_guardar_rcp) y
// las del panel (ninera_puede_recibir_pedidos, guia_estado_ninieras). Datos en db.guia_progreso,
// db.guia_repasos, db.guia_firmas y ninieras.rcp_presencial / rcp_certificado_ruta. Las imágenes subidas se
// miran en db.storage_ninieras_privado (rutas que subió la app, lo anota app.js).
//
// Sin guia_firmas en los datos del test, todas las niñeras con app tienen la guía firmada el 15/09/2026
// (completarFirmasPorDefecto): así los tests de antes de la etapa 4 no cambian. Un test de la guía pasa
// guia_firmas: [] (o las firmas que necesita).
const path = require('path');
const fs = require('fs');
const { errorRpc } = require('./rpc-ninera');

const CONTENIDO = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'ninera/guia/contenido.json'), 'utf8'));
const OBLIGATORIOS = CONTENIDO.modulos.filter(m => m.obligatorio);
const CONFIG_GUIA = {
  plazo_dias: 7, gracia_anual_dias: 7, version_vigente: CONTENIDO.version,
  modulos_obligatorios: OBLIGATORIOS.map(m => m.id),
  lecciones_obligatorias: OBLIGATORIOS.flatMap(m => m.lecciones.map(l => l.id)),
};
const RPC_ETAPA_4 = ['ninera_estado_guia', 'ninera_marcar_leida', 'ninera_aprobar_repaso', 'ninera_firmar_guia', 'ninera_guardar_rcp'];
const RPC_ETAPA_4_ADMIN = ['ninera_puede_recibir_pedidos', 'guia_estado_ninieras'];
const TABLAS_ETAPA_4 = ['guia_progreso', 'guia_repasos', 'guia_firmas'];
const COLUMNAS_NINIERAS_ETAPA_4 = ['rcp_presencial', 'rcp_certificado_ruta'];
const DIA = 86400000;
const ID_LECCION = /^[a-z0-9-]{1,20}$/, VERSION = /^[0-9]{4}\.[0-9]{2}$/;

const fechaMvd = ms => new Date(ms - 3 * 3600000).toISOString().slice(0, 10);
const CON_TILDE = 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ', SIN_TILDE = 'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun';
const normaliza = t => String(t ?? '').trim().replace(/[ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ]/g, c => SIN_TILDE[CON_TILDE.indexOf(c)]).toLowerCase().replace(/\s+/g, ' ');

function completarFirmasPorDefecto(db) {
  if (db.guia_firmas !== undefined) return;
  db.guia_firmas = (db.ninieras || []).filter(n => n.user_id).map(n => ({
    id: `f9000000-0000-4000-8000-${String(n.id).slice(-12)}`, ninera_id: n.id, version: CONTENIDO.version, nombre: n.nombre,
    firma_ruta: `firmas/${n.id}/2026-09-15.png`, firmado_en: '2026-09-15T15:00:00.000Z',
  }));
}

// Con la migración, select('*') de ninieras trae las columnas de RCP aunque estén vacías.
function completarColumnasGuia(db) {
  (db.ninieras || []).forEach(n => COLUMNAS_NINIERAS_ETAPA_4.forEach(c => { if (n[c] === undefined) n[c] = null; }));
}

function configGuia(db) {
  return { ...CONFIG_GUIA, ...((db.app_config || []).find(c => c.id === 'guia')?.valor || {}) };
}

// Como guia_estado(id, p_ahora): { completa, firma_vigente, puede, motivo, hasta, ultima_firma, version_firma }.
function guiaEstado(db, nineraId, ahora) {
  const n = (db.ninieras || []).find(x => x.id === nineraId);
  if (!n) return null;
  const cfg = configGuia(db);
  const t = Date.parse(ahora);
  const firma = (db.guia_firmas || []).filter(f => f.ninera_id === nineraId).sort((a, b) => Date.parse(b.firmado_en) - Date.parse(a.firmado_en))[0] || null;
  const desde = firma ? Date.parse(firma.firmado_en) : -Infinity;
  const leidas = new Set((db.guia_progreso || []).filter(g => g.ninera_id === nineraId && Date.parse(g.leido_en) > desde).map(g => g.leccion_id));
  const aprobados = new Set((db.guia_repasos || []).filter(r => r.ninera_id === nineraId && Date.parse(r.aprobado_en) > desde).map(r => r.modulo_id));
  const e = {
    completa: cfg.lecciones_obligatorias.length > 0 && cfg.lecciones_obligatorias.every(l => leidas.has(l)) && cfg.modulos_obligatorios.every(m => aprobados.has(m)),
    firma_vigente: !!firma && t < Date.parse(firma.firmado_en) + 365 * DIA,
    puede: false, motivo: null, hasta: null,
    ultima_firma: firma ? firma.firmado_en : null, version_firma: firma ? firma.version : null,
  };
  if (!n.activa) e.motivo = 'inactiva';
  else if (!n.user_id) e.motivo = 'sin_app';
  else if (e.firma_vigente) e.puede = true;
  else if (firma) {
    const vence = Date.parse(firma.firmado_en) + (365 + cfg.gracia_anual_dias) * DIA;
    if (t < vence) Object.assign(e, { puede: true, motivo: 'gracia', hasta: fechaMvd(vence) });
    else e.motivo = 'firma_vencida';
  } else {
    const activada = n.app_activada_en ? Date.parse(n.app_activada_en) : null;
    const nueva = activada == null || !(db.sittings_traslados || []).some(s => !s.cancelado && s.fecha < fechaMvd(activada)
      && (s.ninera_id === n.id || (s.ninera_id == null && normaliza(s.ninera_nombre) === normaliza(n.nombre))));
    const vence = activada == null ? null : activada + cfg.plazo_dias * DIA;
    if (!nueva && t < vence) Object.assign(e, { puede: true, motivo: 'plazo', hasta: fechaMvd(vence) });
    else e.motivo = 'sin_guia';
  }
  return e;
}

// Las de la niñera de la sesión. ahora: el reloj fijo del test.
function rpcGuiaNinera(db, nineraId, ahora = new Date().toISOString()) {
  const ahoraISO = new Date(ahora).toISOString();
  const hoy = fechaMvd(Date.parse(ahoraISO));
  const yo = () => { if (!nineraId || !(db.ninieras || []).some(n => n.id === nineraId && n.activa)) throw errorRpc('no_autorizada'); return nineraId; };
  const subida = ruta => (db.storage_ninieras_privado || []).includes(ruta);
  const anotar = (tabla, clave, valor, fila) => {
    const lista = (db[tabla] = db[tabla] || []);
    const ya = lista.find(x => x.ninera_id === fila.ninera_id && x[clave] === valor);
    if (ya) Object.assign(ya, fila); else lista.push(fila);
  };
  return {
    ninera_estado_guia: () => {
      if (!nineraId) return [];
      const e = guiaEstado(db, nineraId, ahoraISO);
      if (!e) return [];
      const desde = e.ultima_firma ? Date.parse(e.ultima_firma) : -Infinity;
      const mias = (tabla, col) => (db[tabla] || []).filter(x => x.ninera_id === nineraId);
      const ids = (lista, col) => lista.map(x => x[col]).sort();
      const prog = mias('guia_progreso'), rep = mias('guia_repasos');
      return [{ ...e,
        lecciones_leidas: ids(prog, 'leccion_id'), repasos_aprobados: ids(rep, 'modulo_id'),
        lecciones_ciclo: ids(prog.filter(g => Date.parse(g.leido_en) > desde), 'leccion_id'),
        repasos_ciclo: ids(rep.filter(r => Date.parse(r.aprobado_en) > desde), 'modulo_id') }];
    },
    ninera_marcar_leida: ({ p_leccion_id, p_version } = {}) => {
      const id = yo();
      if (!ID_LECCION.test(p_leccion_id ?? '')) throw errorRpc('leccion_invalida');
      if (!VERSION.test(p_version ?? '')) throw errorRpc('version_invalida');
      anotar('guia_progreso', 'leccion_id', p_leccion_id, { ninera_id: id, leccion_id: p_leccion_id, version: p_version, leido_en: ahoraISO });
      return ahoraISO;
    },
    ninera_aprobar_repaso: ({ p_modulo_id, p_version } = {}) => {
      const id = yo();
      if (!ID_LECCION.test(p_modulo_id ?? '')) throw errorRpc('modulo_invalido');
      if (!VERSION.test(p_version ?? '')) throw errorRpc('version_invalida');
      anotar('guia_repasos', 'modulo_id', p_modulo_id, { ninera_id: id, modulo_id: p_modulo_id, version: p_version, aprobado_en: ahoraISO });
      return ahoraISO;
    },
    ninera_firmar_guia: ({ p_nombre, p_version } = {}) => {
      const id = yo();
      const nombre = String(p_nombre ?? '').replace(/\s+/g, ' ').trim();
      if (nombre.length < 3 || nombre.length > 120) throw errorRpc('nombre_invalido');
      if (!VERSION.test(p_version ?? '')) throw errorRpc('version_invalida');
      const ruta = `firmas/${id}/${hoy}.png`;
      const ya = (db.guia_firmas || []).find(f => f.ninera_id === id && f.firma_ruta === ruta);
      if (ya) return ya.firmado_en;
      if (!guiaEstado(db, id, ahoraISO).completa) throw errorRpc('guia_incompleta');
      if (!subida(ruta)) throw errorRpc('falta_firma');
      (db.guia_firmas = db.guia_firmas || []).push({ id: `f9100000-0000-4000-8000-${String(Date.now()).slice(-12).padStart(12, '0')}`, ninera_id: id, version: p_version, nombre, firma_ruta: ruta, firmado_en: ahoraISO });
      return ahoraISO;
    },
    ninera_guardar_rcp: ({ p_presencial, p_con_certificado = false } = {}) => {
      const id = yo();
      if (typeof p_presencial !== 'boolean') throw errorRpc('rcp_invalido');
      const ruta = `rcp/${id}/certificado.jpg`;
      if (p_presencial && p_con_certificado && !subida(ruta)) throw errorRpc('falta_certificado');
      Object.assign(db.ninieras.find(n => n.id === id), { rcp_presencial: p_presencial, rcp_certificado_ruta: p_presencial && p_con_certificado ? ruta : null });
      return null;
    },
  };
}

// Las del panel. admin: false simula la sesión de una niñera (no_autorizada salvo sobre sí misma).
function rpcGuiaAdmin(db, ahora = new Date().toISOString(), { admin = true, nineraId = null } = {}) {
  const ahoraISO = new Date(ahora).toISOString();
  return {
    ninera_puede_recibir_pedidos: ({ p_ninera_id } = {}) => {
      if (!admin && p_ninera_id !== nineraId) throw errorRpc('no_autorizada');
      const e = guiaEstado(db, p_ninera_id, ahoraISO);
      return e ? [{ puede: e.puede, motivo: e.motivo, hasta: e.hasta }] : [];
    },
    guia_estado_ninieras: () => {
      if (!admin) throw errorRpc('no_autorizada');
      return (db.ninieras || []).filter(n => n.activa && n.user_id).map(n => {
        const e = guiaEstado(db, n.id, ahoraISO);
        return { ninera_id: n.id, completa: e.completa, firma_vigente: e.firma_vigente, puede: e.puede, motivo: e.motivo, hasta: e.hasta,
          ultima_firma: e.ultima_firma, version_firma: e.version_firma };
      });
    },
  };
}

module.exports = { CONTENIDO, CONFIG_GUIA, RPC_ETAPA_4, RPC_ETAPA_4_ADMIN, TABLAS_ETAPA_4, COLUMNAS_NINIERAS_ETAPA_4,
  completarFirmasPorDefecto, completarColumnasGuia, guiaEstado, rpcGuiaNinera, rpcGuiaAdmin };
