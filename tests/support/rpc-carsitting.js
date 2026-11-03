// El carsitting en el simulador (fase 1, etapa 10, 02/11/2026): la misma regla que
// supabase/migraciones/20261108_carsitting_app.sql (decisiones.md 6.7).
// - Las RPC de la niñera: ninera_mi_carsitting y ninera_guardar_carsitting (campos, las 7 fotos subidas a su carpeta,
//   solo si hace traslados, el aviso a las admins).
// - El trigger de la revisión (carsittingAlRevisar): aprobar (lo aprobado y el aviso) o pedir de nuevo (el comentario
//   por el chat); sin comentario, falta_comentario (rechazoRevision).
// - La ruta de las fotos que deja la política del bucket (rutaFotoCarsittingPermitida).
// La programación de los avisos de tiempo no se simula (no corre en el navegador): lo prueba
// supabase/pruebas/fase1_carsitting.sql. Datos en db.carsitting_datos; las fotos subidas, en db.storage_ninieras_privado.
const { randomUUID } = require('crypto');
const { errorRpc, encolarAviso, insertarMensajeChat } = require('./rpc-ninera');

const RPC_ETAPA_10 = ['ninera_mi_carsitting', 'ninera_guardar_carsitting'];
const COLUMNAS_ETAPA_10 = { carsitting_datos: ['fotos', 'enviado_en', 'revision', 'revisado_en', 'revisado_por', 'comentario', 'aprobado_en', 'aprobado_por', 'aprobado_datos'] };
// carsitting_campos(): todos obligatorios salvo la libreta.
const CAMPOS = ['nombre_completo', 'cedula', 'numero_licencia', 'anio_licencia', 'modelo_auto', 'anio_fabricacion', 'color_auto', 'matricula',
  'padron', 'libreta_propiedad', 'compania_seguro', 'tipo_seguro', 'cantidad_asientos', 'cantidad_cinturones'];
const OPCIONALES = ['libreta_propiedad'];
const FOTOS = ['licencia_frente', 'licencia_dorso', 'libreta_frente', 'libreta_dorso', 'asientos', 'auto_dentro', 'auto_fuera'];
const largo = t => Array.from(t).length;
const esPractica = nombre => String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes('(practica)');

function rutaFotoCarsittingPermitida(nineraId, ruta) {
  return new RegExp(`^carsitting/${nineraId}/(${FOTOS.join('|')})_[0-9a-f]{8}\\.jpg$`).test(ruta || '');
}
// carsitting_puede_avisar(): con solo_practica prendido (o sin la fila), solo a las de práctica.
function puedeAvisar(db, nombre) {
  const cfg = (db.app_config || []).find(c => c.id === 'pedidos_app')?.valor || {};
  return !(cfg.solo_practica ?? true) || esPractica(nombre);
}
const filaApp = (db, nineraId) => (db.carsitting_datos || []).find(c => c.ninera_id === nineraId && c.enviado_en);

function rpcCarsittingNinera(db, nineraId, ahora = null) {
  const ahoraISO = () => new Date(ahora ? Date.parse(ahora) : Date.now()).toISOString();
  const yo = () => (db.ninieras || []).find(n => n.id === nineraId) || null;
  return {
    ninera_mi_carsitting: () => {
      const n = nineraId ? yo() : null;
      if (!n) return null;
      const c = filaApp(db, nineraId);
      return {
        hace_traslados: ['Traslados', 'Ambas'].includes(n.tipo),
        datos: c ? Object.fromEntries(CAMPOS.map(k => [k, c[k] ?? null])) : null,
        fotos: c ? c.fotos ?? null : null, revision: c ? c.revision ?? null : null,
        comentario: c && c.revision === 'rehacer' ? c.comentario ?? null : null,
        enviado_en: c ? c.enviado_en : null, aprobado_en: c ? c.aprobado_en ?? null : null,
      };
    },
    ninera_guardar_carsitting: ({ p_datos, p_fotos = {} }) => {
      if (!nineraId) throw errorRpc('no_autorizada');
      const n = yo();
      if (!n || !['Traslados', 'Ambas'].includes(n.tipo)) throw errorRpc('no_hace_traslados');
      if (!p_datos || typeof p_datos !== 'object' || Array.isArray(p_datos)
        || Object.entries(p_datos).some(([k, v]) => !CAMPOS.includes(k) || (v !== null && typeof v !== 'string'))) throw errorRpc('datos_invalidos');
      const fila = {};
      for (const k of CAMPOS) {
        const v = typeof p_datos[k] === 'string' && p_datos[k].trim() ? p_datos[k].trim() : null;
        if (v && largo(v) > 120) throw errorRpc('dato_largo', { hint: k });
        if (!v && !OPCIONALES.includes(k)) throw errorRpc('faltan_datos', { hint: k });
        fila[k] = v;
      }
      const antes = filaApp(db, nineraId);
      const fotos = { ...(antes?.fotos || {}) };
      if (p_fotos == null) p_fotos = {};
      if (typeof p_fotos !== 'object' || Array.isArray(p_fotos)) throw errorRpc('foto_invalida');
      const subidas = db.storage_ninieras_privado || [];
      for (const [k, ruta] of Object.entries(p_fotos)) {
        if (!FOTOS.includes(k) || typeof ruta !== 'string' || !new RegExp(`^carsitting/${nineraId}/${k}_[0-9a-f]{8}\\.jpg$`).test(ruta) || !subidas.includes(ruta)) {
          throw errorRpc('foto_invalida', { hint: k });
        }
        fotos[k] = ruta;
      }
      const falta = FOTOS.find(k => !fotos[k]);
      if (falta) throw errorRpc('faltan_fotos', { hint: falta });
      const en = ahoraISO();
      const lista = db.carsitting_datos = db.carsitting_datos || [];
      const cambios = { ...fila, ninera_nombre: n.nombre, fotos, enviado_en: en, revision: 'pendiente', revisado_en: null, revisado_por: null, comentario: null };
      if (antes) Object.assign(antes, cambios);
      else lista.push({ id: randomUUID(), ninera_id: nineraId, created_at: en, aprobado_en: null, aprobado_por: null, aprobado_datos: null, ...cambios });
      encolarAviso(db, en, {
        clave: `admin:carsitting:${nineraId}:${en}:${lista.length}:${Math.random()}`, para_admin: 'todas', tipo: 'carsitting',
        titulo: `${n.nombre}${antes && antes.aprobado_en ? ' actualizó los datos del auto' : ' completó el carsitting'}`,
        cuerpo: 'Revisalo.', url: '?ir=hoy', datos: { ninera_id: nineraId },
      });
      return en;
    },
  };
}

// carsitting_al_revisar() (before update of revision): el error que tira la base antes de escribir, o null.
function rechazoRevision(fila, cambios) {
  if (!fila.enviado_en || fila.revision !== 'pendiente' || cambios.revision !== 'rehacer') return null;
  return String(cambios.comentario ?? fila.comentario ?? '').trim() ? null : { status: 400, code: 'P0001', message: 'falta_comentario' };
}
// Lo que hace después de escribir: fila ya tiene los cambios; revisionAntes es la de antes.
function carsittingAlRevisar(db, ahoraISO, fila, revisionAntes) {
  if (!fila.enviado_en || revisionAntes !== 'pendiente' || !['aprobado', 'rehacer'].includes(fila.revision)) return;
  const n = (db.ninieras || []).find(x => x.id === fila.ninera_id);
  fila.revisado_en = fila.revisado_en || ahoraISO;
  if (fila.revision === 'aprobado') {
    Object.assign(fila, { comentario: null, aprobado_en: fila.revisado_en, aprobado_por: fila.revisado_por ?? null,
      aprobado_datos: { ...Object.fromEntries(CAMPOS.map(k => [k, fila[k] ?? null])), fotos: fila.fotos } });
    if (n && n.activa && n.user_id && puedeAvisar(db, n.nombre)) {
      encolarAviso(db, ahoraISO, { clave: `carsitting:${fila.ninera_id}:aprobado:${fila.revisado_en}`, para_ninera_id: fila.ninera_id, tipo: 'carsitting',
        titulo: 'Tu carsitting quedó aprobado', cuerpo: 'Gracias por completar los datos.', url: '#carsitting', datos: { carsitting_id: fila.id } });
    }
  } else {
    fila.comentario = String(fila.comentario).trim();
    if (n && n.user_id) insertarMensajeChat(db, { ninera_id: fila.ninera_id, de: 'admin', autor: String(fila.revisado_por || '').trim() || "Parents' Break",
      texto: `Hay que corregir algo de tus datos de carsitting: ${fila.comentario}` }, ahoraISO);
  }
}

module.exports = { RPC_ETAPA_10, COLUMNAS_ETAPA_10, rpcCarsittingNinera, rutaFotoCarsittingPermitida, rechazoRevision, carsittingAlRevisar };
