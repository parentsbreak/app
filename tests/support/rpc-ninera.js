// Simulación compartida de las RPC de la app de niñeras (fase 1, 26/10/2026).
//
// abrirAppNinera (app.js) registra estas funciones en estado.rpc antes de abrir la página, y cada
// test puede pisar la que necesite (estado.rpc.ninera_actual = () => null) o hacerla fallar con
// estado.fallar (recibe {tabla: 'rpc/<nombre>', ...}). Cada tarea siguiente suma acá las RPC de la
// niñera que usa, imitando lo que hace la función SQL real (supabase/migraciones) sobre la base
// ficticia `db`: mismos argumentos y misma forma de la respuesta. Nada de esto llega a la base real.

const { randomUUID } = require('crypto');

// Un "raise exception" de la función SQL (27/10/2026): PostgREST lo devuelve como 400 con el
// código P0001 y el texto de la excepción en message. Una simulación lo tira con
// `throw errorRpc('sin_zonas')` y app.js responde ese error, como Supabase.
// hint: el `using hint = ...` del raise (02/11/2026: enviar_pedido_app pone el nombre de la niñera).
function errorRpc(message, { status = 400, code = 'P0001', hint = null } = {}) {
  const e = new Error(message);
  e.rpc = { status, code, message, hint };
  return e;
}

// "Hoy" en Montevideo del reloj fijo del test (como hoy_mvd() en la base): la simulación corre
// en Node, que no ve el reloj del navegador.
function fechaMontevideo(ahora) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ahora));
}
function sumarDias(fechaISO, dias) {
  const d = new Date(fechaISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
// Años cumplidos entre dos fechas 'AAAA-MM-DD', como extract(year from age(hasta, desde)):
// negativo si desde es posterior.
function anosEntre(desde, hasta) {
  if (desde > hasta) return -anosEntre(hasta, desde);
  const [a1, m1, d1] = desde.split('-').map(Number);
  const [a2, m2, d2] = hasta.split('-').map(Number);
  return a2 - a1 - ((m2 < m1 || (m2 === m1 && d2 < d1)) ? 1 : 0);
}
// madre_nombre_inicial(): "María Pérez" → "María P.", una palabra queda igual, vacío → "la familia".
function madreNombreInicial(nombre) {
  const p = String(nombre ?? '').split(/\s+/).filter(Boolean);
  if (!p.length) return 'la familia';
  if (p.length === 1) return p[0];
  return `${p[0]} ${Array.from(p[p.length - 1])[0]}.`;
}
// chicos_texto(): "2 chicos (3 y 5 años)" desde hijos_familia; sin hijos, familias.ninos recortado a
// 80; sin nada, null.
function chicosTexto(db, familiaId, hoy) {
  const hijos = (db.hijos_familia || []).filter(h => familiaId && h.familia_id === familiaId)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  if (!hijos.length) {
    const ninos = (db.familias || []).find(f => f.id === familiaId)?.ninos;
    if (ninos == null) return null;
    const texto = Array.from(String(ninos).replace(/^ +| +$/g, '')).slice(0, 80).join('');
    return texto || null;
  }
  const n = hijos.length;
  const edades = hijos.map(h => {
    if (h.fecha_nacimiento) return anosEntre(h.fecha_nacimiento, hoy);
    if (h.edad_declarada != null) return h.edad_declarada + Math.max(0, h.edad_declarada_en ? anosEntre(h.edad_declarada_en, hoy) : 0);
    return null;
  }).filter(x => x !== null);
  if (!edades.length) return `${n} ${n === 1 ? 'chico' : 'chicos'}`;
  let partes;
  if (edades.includes(0)) {
    partes = edades.map(x => x === 0 ? 'menos de 1 año' : x === 1 ? '1 año' : `${x} años`);
  } else {
    partes = edades.map(String);
    partes[partes.length - 1] += (edades.length === 1 && edades[0] === 1) ? ' año' : ' años';
  }
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
  return `${n} ${n === 1 ? 'chico' : 'chicos'} (${lista})`;
}
// order by hora_inicio: en Postgres, sin hora va al final del día.
function horaParaOrdenar(s) { return s.hora_inicio == null ? '99' : String(s.hora_inicio); }
const TIPOS_PERFIL = ['Niñera', 'Traslados', 'Ambas'];

// Lo que suma la migración de la etapa 2 (20261027_perfil_ninera.sql). Con baseSinMigrar,
// abrirAppNinera responde estas RPC como Supabase cuando la función no existe (404 PGRST202) y
// abrirApp / abrirAppNinera sacan las columnas de las filas de ninieras.
const RPC_ETAPA_2 = ['ninera_mi_perfil', 'ninera_zonas_disponibles', 'ninera_guardar_perfil', 'ninera_mis_sittings'];
const COLUMNAS_NINIERAS_ETAPA_2 = ['perfil_app_en', 'perfil_actualizado_en', 'foto_propuesta_ruta', 'foto_propuesta_en'];
// Lo que suma la migración de la etapa 3 (20261029_avisos_chat.sql, 30/10/2026): las funciones de la
// niñera y las dos tablas. Con baseSinMigrar las RPC dan 404 PGRST202 y las tablas 404 PGRST205.
const RPC_ETAPA_3 = ['ninera_enviar_mensaje', 'ninera_marcar_chat_leido', 'ninera_marcar_avisos_leidos'];
const TABLAS_ETAPA_3 = ['chat_mensajes', 'avisos'];
// Lo que suma la migración de la etapa 9 (20261101_temporada_app.sql, 01/11/2026): las dos funciones
// de la niñera. La base real nunca tiene la etapa 9 sin la 3: baseSinMigrar true y 'etapa3' también
// las dejan sin existir; 'etapa9' deja sin existir solo estas dos.
const RPC_ETAPA_9 = ['ninera_mi_temporada', 'ninera_guardar_temporada'];
const COLUMNAS_NINIERAS_ETAPA_9 = ['temporada_lugares', 'temporada_lugares_en'];
// Lo que suma la migración de la etapa 5 (20261102_pedidos_app.sql, 02/11/2026). Las tres de la niñera
// van en rpcNinera; las dos del panel (enviar_pedido_app y sugeridas_datos) en rpcPedidosAdmin. Con
// baseSinMigrar las RPC dan 404 PGRST202, ninera_no_disponible 404 PGRST205 y las columnas nuevas dan
// error de columna (app.js).
const RPC_ETAPA_5 = ['ninera_mis_pedidos', 'responder_pedido', 'ninera_marcar_no_disponible'];
const RPC_ETAPA_5_ADMIN = ['enviar_pedido_app', 'sugeridas_datos'];
const TABLAS_ETAPA_5 = ['ninera_no_disponible'];
const COLUMNAS_ETAPA_5 = {
  solicitudes: ['ninera_pedida_id', 'notas_para_ninera', 'enviado_app_en', 'responder_hasta'],
  solicitud_ninieras: ['origen', 'precio_hora', 'enviado_en', 'respondido_en', 'motivo_no', 'motivo_texto'],
  familias: ['solo_conocidas'],
  pedidos_whatsapp: ['ninera_pedida'],
};
function rpcNoExiste(nombre) {
  return () => { throw errorRpc(`Could not find the function public.${nombre} in the schema cache`, { status: 404, code: 'PGRST202' }); };
}

/* ---- Etapa 3 (30/10/2026): chat y avisos, lo que comparten la RPC de la niñera y el insert de
   las admins (app.js) ---- */
// btrim(texto, E' \t\r\n') de la SQL: solo espacios, tabs y saltos, no cualquier blanco (un espacio
// duro queda, como en la base).
function recortarBlancos(texto) { return String(texto ?? '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ''); }
// char_length / left() cuentan caracteres, no unidades UTF-16.
function largo(texto) { return Array.from(String(texto)).length; }
// El now() del servidor para una fila nueva: el reloj fijo del test, pero siempre después del último
// mensaje. En la base cada insert tiene su propio now(); con el reloj fijo, dos mensajes del mismo
// test quedarían con la misma hora y el orden del hilo dependería de la suerte.
function momentoNuevo(db, ahora) {
  const ultimo = Math.max(0, ...(db.chat_mensajes || []).map(m => Date.parse(m.creado_en) || 0));
  return new Date(Math.max(new Date(ahora ?? Date.now()).getTime(), ultimo + 1)).toISOString();
}
// Inserta un mensaje como la base (id y creado_en por defecto, nada leído) y hace lo del trigger
// chat_mensajes_aviso: de una admin, el aviso a la niñera ('chat:<id>', título el autor, '#chat');
// de la niñera, a 'todas' ('admin:chat:<id>', título el nombre de su ficha, link a su ficha). El
// cuerpo, el texto recortado a 120. Devuelve la fila.
function insertarMensajeChat(db, { ninera_id, de, autor, texto }, ahora) {
  const creado = momentoNuevo(db, ahora);
  const fila = { id: randomUUID(), ninera_id, de, autor, texto, creado_en: creado, leido_ninera_en: null, leido_admin_en: null };
  (db.chat_mensajes = db.chat_mensajes || []).push(fila);
  const deAdmin = de === 'admin';
  const nombreFicha = (db.ninieras || []).find(n => n.id === ninera_id)?.nombre;
  (db.avisos = db.avisos || []).push({
    id: randomUUID(), clave: (deAdmin ? 'chat:' : 'admin:chat:') + fila.id,
    para_ninera_id: deAdmin ? ninera_id : null, para_admin: deAdmin ? null : 'todas', tipo: 'chat',
    titulo: deAdmin ? autor : (nombreFicha ?? autor), cuerpo: Array.from(texto).slice(0, 120).join(''),
    url: deAdmin ? '#chat' : `?ir=ninieras&ninera=${ninera_id}`,
    datos: deAdmin ? { mensaje_id: fila.id } : { mensaje_id: fila.id, ninera_id },
    enviar_desde: creado, enviado_en: null, error: null, intentos: 0, leido_en: null, creado_en: creado,
  });
  return fila;
}

/* ---- Etapa 9 (01/11/2026): temporada, espejo de inicio_temporada_mvd() y de las dos funciones de
   20261101_temporada_app.sql ---- */
// El 1/9 a las 0:00 de Montevideo de la temporada en curso (de setiembre a agosto). Montevideo es
// UTC-3 todo el año (sin horario de verano): se calcula con ese corrimiento fijo, no con la zona de
// la máquina que corre los tests.
function inicioTemporadaMvd(ahora) {
  const local = new Date(new Date(ahora).getTime() - 3 * 3600 * 1000);
  const anio = local.getUTCMonth() + 1 >= 9 ? local.getUTCFullYear() : local.getUTCFullYear() - 1;
  return new Date(Date.UTC(anio, 8, 1, 3, 0, 0));
}
// translate(lower(btrim(x)), 'áéíóúüñ', 'aeiouun') de la SQL.
function claveZona(x) {
  return String(x ?? '').replace(/^\s+|\s+$/g, '').toLowerCase().replace(/[áéíóúüñ]/g, c => 'aeiouun'['áéíóúüñ'.indexOf(c)]);
}
const LUGARES_FIJOS = ['montevideo', 'punta', 'la_paloma', 'fuera_pais'];
// Los grupos de afuera que la temporada conoce por nombre: el primero por orden de cada uno.
function grupoAfuera(db, nombre) {
  return (db.zona_grupos || []).filter(g => g.fuera_de_montevideo && claveZona(g.nombre) === nombre)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

/* ---- Etapa 5 (02/11/2026): el pedido por la app, espejo de 20261102_pedidos_app.sql ---- */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// normaliza_nombre(): sin tildes y en minúsculas (el mismo translate que la SQL).
const CON_TILDE = 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ', SIN_TILDE = 'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun';
function normalizaNombre(t) {
  return Array.from(String(t ?? '')).map(c => { const i = CON_TILDE.indexOf(c); return i >= 0 ? SIN_TILDE[i] : c; }).join('').toLowerCase();
}
const esPractica = nombre => normalizaNombre(nombre).includes('(practica)');
// pesos_texto(): "$1.250", sin centavos y con punto de miles.
function pesosTexto(monto) { return '$' + String(Math.round(Number(monto))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
// dia_corto_texto(): "mar 06/10".
function diaCortoTexto(fecha) {
  const dow = new Date(fecha + 'T00:00:00Z').getUTCDay();
  return `${['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][dow]} ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
}
const hhmm = h => String(h).slice(0, 5);
// encolar_aviso(): idempotente por clave (la segunda vez no hace nada). enviado_en vacío: lo manda
// enviar-avisos, que no corre en los tests.
function encolarAviso(db, ahoraISO, { clave, para_ninera_id = null, para_admin = null, tipo, titulo, cuerpo, url, datos = {} }) {
  const lista = db.avisos = db.avisos || [];
  if (lista.some(a => a.clave === clave)) return false;
  lista.push({ id: randomUUID(), clave, para_ninera_id, para_admin, tipo, titulo, cuerpo, url, datos,
    enviar_desde: ahoraISO, enviado_en: null, error: null, intentos: 0, leido_en: null, creado_en: ahoraISO });
  return true;
}
// pedidos_whatsapp_aviso_nuevo(): trigger "update of solicitud_id" (null -> valor): el aviso "Pedido
// nuevo" a las admins, con datos.excepto = quien lo pegó.
function avisoPedidoNuevo(db, ahoraISO, fila) {
  const s = (db.solicitudes || []).find(x => x.id === fila.solicitud_id);
  if (!s) return;
  encolarAviso(db, ahoraISO, {
    clave: `admin:pedido:${s.id}:nuevo`, para_admin: 'todas', tipo: 'pedidos', titulo: `Pedido nuevo de ${s.familia_nombre}`,
    cuerpo: `${diaCortoTexto(s.fecha)}, ${hhmm(s.hora_inicio)}${s.hora_fin ? ' a ' + hhmm(s.hora_fin) : ''}. Revisalo.`,
    url: `?ir=agenda&solicitud=${s.id}`, datos: { solicitud_id: s.id, excepto: fila.creado_por ?? null },
  });
}
const ABIERTO = ['sin_asignar', 'pendiente_confirmar'];

/* ---- Etapa 6 (01/11/2026): elegir la niñera, espejo de 20261103_eleccion_pedidos.sql ----
   Los avisos los disparan triggers sobre las escrituras de siempre del panel; app.js los llama desde el
   REST simulado (POST / PATCH de solicitud_ninieras a 'confirmada' y PATCH de solicitudes a 'cancelada'),
   así que cualquier pantalla que ya escribe eso recibe los avisos sin hacer nada más. */
const RPC_ETAPA_6 = ['ninera_marcar_pedido_visto'];
// Sin la migración, estas columnas no existen (leerlas da 42703 y escribirlas PGRST204). ninera_mis_pedidos y
// ninera_mis_sittings existen pero con la forma de antes (sin las columnas nuevas): rpcNinera(..., { sinEtapa6 }).
const COLUMNAS_ETAPA_6 = {
  solicitudes: ['horario_aproximado'],
  solicitud_ninieras: ['seleccionada_en', 'visto_en'],
  sittings_traslados: ['solicitud_id'],
};
// pedido_puede_avisar(): con solo_practica prendido (o sin la fila: como la migración, prendido), solo si la
// familia y la niñera son las dos de práctica; apagado, siempre.
function pedidoPuedeAvisar(db, familiaId, familiaNombre, nineraNombre) {
  const cfg = (db.app_config || []).find(c => c.id === 'pedidos_app')?.valor ?? {};
  if (!(cfg.solo_practica ?? true)) return true;
  const fam = (db.familias || []).find(f => f.id === familiaId);
  return esPractica(fam ? fam.nombre : familiaNombre) && esPractica(nineraNombre);
}
// solicitud_ninieras_al_confirmar(): corre cuando una fila pasa a 'confirmada' (o se inserta así). Las demás filas
// de la app abiertas ('invitada' / 'acepto') pasan a 'cubierto' y a las que habían dicho "Puedo" les llega "Gracias
// por responder"; a la elegida, si tiene app y el pedido es de hoy en adelante, "¡Quedaste seleccionada!" y
// seleccionada_en. Solo sittings. Sin avisos si pedidoPuedeAvisar da false.
function alConfirmarFila(db, ahoraISO, sn) {
  const hoy = fechaMontevideo(ahoraISO);
  const s = (db.solicitudes || []).find(x => x.id === sn.solicitud_id);
  if (!s || s.tipo !== 'sitting') return;
  for (const otra of (db.solicitud_ninieras || [])) {
    if (otra.solicitud_id !== sn.solicitud_id || otra.id === sn.id || (otra.origen ?? 'panel') !== 'app' || !['invitada', 'acepto'].includes(otra.estado)) continue;
    otra.estado = 'cubierto';
    if (otra.respondido_en != null && s.fecha >= hoy && pedidoPuedeAvisar(db, s.familia_id, s.familia_nombre, otra.ninera_nombre)) {
      encolarAviso(db, ahoraISO, {
        clave: `pedido:${otra.id}:cubierto`, para_ninera_id: otra.ninera_id, tipo: 'pedido', titulo: 'Gracias por responder',
        cuerpo: 'Este sitting ya quedó cubierto. ¡Te tendremos en cuenta para el próximo!', url: '#inicio', datos: { solicitud_ninera_id: otra.id },
      });
    }
  }
  if (sn.ninera_id == null || sn.seleccionada_en != null || s.fecha < hoy) return;
  const n = (db.ninieras || []).find(x => x.id === sn.ninera_id);
  if (!n || n.user_id == null || !pedidoPuedeAvisar(db, s.familia_id, s.familia_nombre, n.nombre)) return;
  sn.seleccionada_en = ahoraISO;
  encolarAviso(db, ahoraISO, {
    clave: `pedido:${sn.id}:seleccionada`, para_ninera_id: n.id, tipo: 'pedido', titulo: '¡Quedaste seleccionada!',
    cuerpo: `${diaCortoTexto(s.fecha)} a las ${hhmm(s.hora_inicio)}. Ya tienes todos los datos en la app.`, url: `#pedido/${sn.id}`,
    datos: { solicitud_ninera_id: sn.id },
  });
}
// solicitudes_al_cancelar(): la solicitud pasó a 'cancelada'. Las filas de la app abiertas pasan a 'cancelado' y a las
// que dijeron "Puedo", "Se canceló el pedido del [día]".
function alCancelarSolicitud(db, ahoraISO, s) {
  const hoy = fechaMontevideo(ahoraISO);
  for (const otra of (db.solicitud_ninieras || [])) {
    if (otra.solicitud_id !== s.id || (otra.origen ?? 'panel') !== 'app' || !['invitada', 'acepto'].includes(otra.estado)) continue;
    otra.estado = 'cancelado';
    if (otra.respondido_en != null && s.fecha >= hoy && pedidoPuedeAvisar(db, s.familia_id, s.familia_nombre, otra.ninera_nombre)) {
      encolarAviso(db, ahoraISO, {
        clave: `pedido:${otra.id}:cancelado`, para_ninera_id: otra.ninera_id, tipo: 'pedido', titulo: `Se canceló el pedido del ${diaCortoTexto(s.fecha)}`,
        cuerpo: 'Gracias por responder.', url: '#inicio', datos: { solicitud_ninera_id: otra.id },
      });
    }
  }
}

// enviar_pedido_app y sugeridas_datos. admin: false simula la sesión de una niñera (la guarda
// es_usuaria_autorizada() da false: no_autorizada). El valor por defecto de app_config 'pedidos_app'
// (solo_practica = true si falta) es el de la migración.
function rpcPedidosAdmin(db, ahora = new Date().toISOString(), { admin = true } = {}) {
  const hoy = fechaMontevideo(ahora);
  const ahoraISO = new Date(ahora).toISOString();
  return {
    enviar_pedido_app: (cuerpo = {}) => {
      const { p_solicitud_id, p_envios } = cuerpo;
      if (!admin) throw errorRpc('no_autorizada');
      if (!Array.isArray(p_envios) || p_envios.length === 0) throw errorRpc('sin_ninieras');
      if (p_envios.length > 40) throw errorRpc('demasiadas_ninieras');
      const s = (db.solicitudes || []).find(x => x.id === p_solicitud_id);
      if (!s) throw errorRpc('no_existe');
      if (!ABIERTO.includes(s.estado)) throw errorRpc('cerrado');
      if (s.tipo !== 'sitting') throw errorRpc('solo_sittings');
      if (s.fecha < hoy) throw errorRpc('pasado');
      const fam = (db.familias || []).find(f => f.id === s.familia_id);
      if (!fam) throw errorRpc('sin_familia');
      // Solo hijos_familia: el texto libre familias.ninos no cuenta.
      if (!(db.hijos_familia || []).some(h => h.familia_id === fam.id)) throw errorRpc('sin_chicos');
      const chicos = chicosTexto(db, fam.id, hoy);
      const cfg = (db.app_config || []).find(c => c.id === 'pedidos_app')?.valor ?? {};
      const practica = esPractica(fam.nombre);
      if (!practica && (cfg.solo_practica ?? true)) throw errorRpc('solo_practica');
      const zona = [s.zona, fam.zona].map(z => String(z ?? '').trim()).find(z => z !== '') ?? null;
      const horario = hhmm(s.hora_inicio) + (s.hora_fin == null ? ', sin hora de fin'
        : ` – ${hhmm(s.hora_fin)}${s.termina_dia_siguiente ? ' del día siguiente' : ''}${s.horario_aproximado ? ' (aproximada, se puede extender)' : ''}`);

      // Todo o nada: se valida todo y recién al final se escribe (la SQL lo logra con la transacción).
      const nuevas = [];
      const yaEnviada = id => (db.solicitud_ninieras || []).some(x => x.solicitud_id === s.id && x.ninera_id === id && (x.origen ?? 'panel') === 'app')
        || nuevas.some(x => x.ninera_id === id);
      for (const e of p_envios) {
        const raw = e && typeof e === 'object' ? e : {};
        const id = raw.ninera_id ?? null;
        const precio = raw.precio_hora == null ? null : Number(raw.precio_hora);
        if ((id !== null && !(typeof id === 'string' && UUID.test(id))) || (precio !== null && !Number.isFinite(precio))) throw errorRpc('envio_invalido');
        const n = (db.ninieras || []).find(x => x.id === id);
        if (precio === null || precio <= 0 || precio >= 100000) throw errorRpc('precio_invalido', { hint: n ? n.nombre : '' });
        if (!n) throw errorRpc('ninera_no_existe', { hint: id ?? '' });
        if (!n.activa) throw errorRpc('ninera_inactiva', { hint: n.nombre });
        if (n.user_id == null) throw errorRpc('ninera_sin_app', { hint: n.nombre });
        if (n.tipo === 'Traslados') throw errorRpc('ninera_solo_traslados', { hint: n.nombre });
        if (esPractica(n.nombre) !== practica) throw errorRpc('practica_mezclada', { hint: n.nombre });
        if (yaEnviada(n.id)) continue;
        nuevas.push({ id: randomUUID(), solicitud_id: s.id, ninera_id: n.id, ninera_nombre: n.nombre, pago_ninera: null, estado: 'invitada',
          created_at: ahoraISO, origen: 'app', precio_hora: precio, enviado_en: ahoraISO, respondido_en: null, motivo_no: null, motivo_texto: null, seleccionada_en: null, visto_en: null });
      }
      (db.solicitud_ninieras = db.solicitud_ninieras || []).push(...nuevas);
      for (const sn of nuevas) {
        encolarAviso(db, ahoraISO, {
          clave: `pedido:${sn.id}:nuevo`, para_ninera_id: sn.ninera_id, tipo: 'pedido', titulo: `Sitting ${s.fecha.slice(8, 10)}/${s.fecha.slice(5, 7)}`,
          cuerpo: [horario, zona ? `Zona: ${zona}` : null, chicos, `Precio por hora: ${pesosTexto(sn.precio_hora)}`].filter(x => x != null).join('\n'),
          url: `#pedido/${sn.id}`, datos: { solicitud_ninera_id: sn.id },
        });
      }
      if (nuevas.length) {
        const min = s.fecha === hoy ? (cfg.min_mismo_dia ?? 15) : (cfg.min_otro_dia ?? 30);
        Object.assign(s, { estado: 'pendiente_confirmar', enviado_app_en: s.enviado_app_en ?? ahoraISO,
          responder_hasta: new Date(new Date(ahoraISO).getTime() + min * 60000).toISOString() });
      }
      return nuevas.length;
    },

    // Una sola lectura con lo que el panel necesita para ordenar (ver el comentario de la migración).
    sugeridas_datos: (cuerpo = {}) => {
      const { p_familia_id, p_familia_nombre, p_fecha } = cuerpo;
      const clave = t => normalizaNombre(String(t ?? '').trim());
      const familias = (db.familias || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
      const hijosDe = fid => (db.hijos_familia || []).filter(h => h.familia_id === fid);
      const regs = (db.sittings_traslados || [])
        .filter(r => !r.cancelado && (r.ninera_id != null || String(r.ninera_nombre ?? '').trim() !== ''))
        .map(r => {
          const familiaId = r.familia_id ?? familias.find(f => clave(f.nombre) === clave(r.familia_nombre))?.id ?? null;
          return { ...r, estado: r.estado ?? 'confirmado', familia_id: familiaId, ninera_clave: r.ninera_id == null ? clave(r.ninera_nombre) : null,
            con_familia: familiaId === p_familia_id || (familiaId == null && clave(r.familia_nombre) === clave(p_familia_nombre)) };
        });
      // date_trunc('week'): el lunes de la semana del pedido, hasta el domingo.
      const dow = (new Date(p_fecha + 'T00:00:00Z').getUTCDay() + 6) % 7;
      const lunes = sumarDias(p_fecha, -dow), domingo = sumarDias(lunes, 6);
      const edadEn = (h, fecha) => {
        if (h.fecha_nacimiento) return anosEntre(h.fecha_nacimiento, fecha);
        if (h.edad_declarada != null) {
          const dias = Math.round((new Date(fecha + 'T00:00:00Z') - new Date((h.edad_declarada_en || fecha) + 'T00:00:00Z')) / 86400000);
          return h.edad_declarada + Math.trunc(dias / 365.25);
        }
        return null;
      };
      const grupos = new Map();
      for (const r of regs) {
        const k = `${r.ninera_id}|${r.ninera_clave}`;
        if (!grupos.has(k)) grupos.set(k, { ninera_id: r.ninera_id ?? null, ninera_clave: r.ninera_clave, veces_familia: 0, total: 0, veces_familia_traslado: 0, total_traslado: 0, semana: 0, edades: new Set(), max_chicos: null });
        const g = grupos.get(k);
        const sitting = r.tipo === 'sitting';
        const real = sitting && r.estado !== 'previsto';
        if (real && r.con_familia) g.veces_familia++;
        if (real) g.total++;
        const trasladoReal = r.tipo === 'traslado' && r.estado !== 'previsto';
        if (trasladoReal && r.con_familia) g.veces_familia_traslado++;
        if (trasladoReal) g.total_traslado++;
        if (sitting && r.fecha >= lunes && r.fecha <= domingo) g.semana++;
        if (real) {
          const n = r.familia_id ? hijosDe(r.familia_id).length : 0;
          if (n > 0) g.max_chicos = Math.max(g.max_chicos ?? 0, n);
          hijosDe(r.familia_id).forEach(h => { const e = edadEn(h, r.fecha); if (e !== null && e >= 0 && e <= 18) g.edades.add(e); });
        }
      }
      const historial = [...grupos.values()].map(g => ({ ...g, edades: [...g.edades].sort((a, b) => a - b) }));
      const sns = (db.solicitud_ninieras || []).filter(x => (x.origen ?? 'panel') === 'app' && x.ninera_id != null);
      // El último "Puedo": 'acepto' o, ya asignada, 'confirmada' con respondido_en (max() de la SQL ignora los nulos).
      const ultimoAcepto = id => Math.max(-Infinity, ...sns.filter(x => x.ninera_id === id && ['acepto', 'confirmada'].includes(x.estado) && x.respondido_en != null)
        .map(x => Date.parse(x.respondido_en)));
      const mismo = (nombre, fam) => clave(nombre) === clave(fam);
      const por_ninera = (db.ninieras || []).map(n => ({
        ninera_id: n.id,
        no_puedo_seguidos: sns.filter(x => x.ninera_id === n.id && x.estado === 'no_puedo' && Date.parse(x.respondido_en) > ultimoAcepto(n.id)).length,
        incidente_familia: (db.incidentes || []).some(i => (i.ninera_id === n.id || (i.ninera_id == null && mismo(i.ninera_nombre, n.nombre)))
          && (i.familia_id === p_familia_id || (i.familia_id == null && mismo(i.familia_nombre, p_familia_nombre)))),
        no_disponible: (db.ninera_no_disponible || []).some(d => d.ninera_id === n.id && d.fecha === p_fecha),
      }));
      return { historial, por_ninera };
    },
  };
}

// ahora: el reloj fijo del test (ISO con zona), para "hoy" y para el now() de los guardados.
// sinEtapa6: la base sin la migración 20261103 (01/11/2026): ninera_marcar_pedido_visto no existe (lo pone app.js) y
// ninera_mis_pedidos / ninera_mis_sittings devuelven lo de antes, sin las columnas nuevas.
function rpcNinera(db, nineraId, ahora = new Date().toISOString(), { sinEtapa6 = false } = {}) {
  const hoy = fechaMontevideo(ahora);
  const ahoraISO = new Date(ahora).toISOString();
  const miFila = () => (db.ninieras || []).find(n => n.id === nineraId);
  return {
    // La niñera de la sesión (ninieras.user_id = auth.uid()).
    ninera_actual: () => nineraId,
    es_ninera: () => true,
    // Primera vez que abre la app instalada: la fecha que queda en app_activada_en.
    ninera_activar_app: () => '2026-10-04T15:00:00+00:00',
    // Link de invitación (lo pide el panel de admins): un token ficticio de 64 caracteres.
    crear_invitacion_ninera: (cuerpo) => [{ token: 'a'.repeat(64), vence_en: '2026-10-11T15:00:00+00:00', es_reset: false }],

    // Etapa 2 (27/10/2026), migración 20261027_perfil_ninera.sql.
    // Su fila con las columnas de ninera_mi_perfil() (datos bancarios incluidos: es la propia).
    ninera_mi_perfil: () => {
      const n = miFila();
      if (!n) return [];
      const columnas = ['id', 'nombre', 'telefono', 'tipo', 'zona', 'barrios', 'cuenta_bancaria', 'foto', 'foto_propuesta_ruta',
        'foto_propuesta_en', 'perfil_app_en', 'perfil_actualizado_en', 'app_activada_en'];
      return [Object.fromEntries(columnas.map(c => [c, n[c] ?? null]))];
    },
    ninera_zonas_disponibles: () => nineraId ? (db.zona_grupos || []).slice()
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.nombre).localeCompare(String(b.nombre)))
      .map(z => ({ id: z.id, nombre: z.nombre, orden: z.orden, fuera_de_montevideo: z.fuera_de_montevideo })) : [],
    // Valida todo antes de escribir, en el mismo orden que la SQL; devuelve null.
    ninera_guardar_perfil: (cuerpo = {}) => {
      const { p_tipo, p_zonas, p_cuenta } = cuerpo;
      const pFotoRuta = cuerpo.p_foto_ruta ?? null;
      if (!nineraId) throw errorRpc('no_autorizada');
      if (!TIPOS_PERFIL.includes(p_tipo)) throw errorRpc('tipo_invalido');
      if (!Array.isArray(p_zonas) || !p_zonas.length) throw errorRpc('sin_zonas');
      const nombresZonas = (db.zona_grupos || []).map(z => z.nombre);
      if (p_zonas.some(z => !nombresZonas.includes(z))) throw errorRpc('zona_desconocida');
      if (pFotoRuta !== null && pFotoRuta !== `fotos/${nineraId}/propuesta.jpg`) throw errorRpc('foto_invalida');
      const cuenta = (p_cuenta || []).filter(l => l != null)
        .map(l => String(l).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')).filter(l => l !== '')
        .map(l => Array.from(l).slice(0, 120).join(''));
      // Tope de 10 cuentas después de sacar los renglones vacíos, como la SQL (27/10/2026).
      if (cuenta.length > 10) throw errorRpc('demasiadas_cuentas');
      const n = miFila();
      if (n) {
        Object.assign(n, {
          tipo: p_tipo,
          zona: [...new Set(p_zonas)].join('/'),
          cuenta_bancaria: cuenta.length ? cuenta : null,
          perfil_app_en: n.perfil_app_en ?? ahoraISO,
          perfil_actualizado_en: ahoraISO,
          foto_propuesta_ruta: pFotoRuta ?? n.foto_propuesta_ruta ?? null,
          foto_propuesta_en: pFotoRuta !== null ? ahoraISO : (n.foto_propuesta_en ?? null),
        });
      }
      return null;
    },
    // De hoy a 60 días, sin cancelados, previstos y confirmados; nunca montos ni notas. La
    // dirección (y origen / destino) solo si está confirmado. estado vacío = 'confirmado', el
    // default de la columna.
    ninera_mis_sittings: () => {
      const hasta = sumarDias(hoy, 60);
      return (db.sittings_traslados || [])
        .map(s => ({ ...s, estado: s.estado ?? 'confirmado' }))
        .filter(s => nineraId && s.ninera_id === nineraId && !s.cancelado && ['previsto', 'confirmado'].includes(s.estado)
          && s.fecha >= hoy && s.fecha <= hasta)
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || horaParaOrdenar(a).localeCompare(horaParaOrdenar(b)))
        .map(s => {
          const f = (db.familias || []).find(x => x.id === s.familia_id) || null;
          const confirmado = s.estado === 'confirmado';
          const sol = s.solicitud_id ? (db.solicitudes || []).find(x => x.id === s.solicitud_id) : null;
          return {
            id: s.id, tipo: s.tipo, fecha: s.fecha, hora_inicio: s.hora_inicio ?? null, hora_fin: s.hora_fin ?? null,
            termina_dia_siguiente: !!s.termina_dia_siguiente, estado: s.estado,
            zona: f ? f.zona ?? null : null,
            madre: madreNombreInicial(f && f.nombre != null ? f.nombre : s.familia_nombre),
            direccion: confirmado && f ? f.direccion ?? null : null,
            origen: confirmado ? s.origen ?? null : null,
            destino: confirmado ? s.destino ?? null : null,
            chicos: chicosTexto(db, f ? f.id : null, hoy),
            // Etapa 6: si el registro salió de un pedido, las indicaciones (solo confirmado, como la dirección),
            // la marca de horario aproximado y su precio por hora (el de su fila confirmada: nunca un total).
            notas_para_ninera: sinEtapa6 ? null : (confirmado ? String(sol?.notas_para_ninera ?? '').trim() || null : null),
            ...(sinEtapa6 ? {} : {
              horario_aproximado: !!sol?.horario_aproximado,
              precio_hora: (db.solicitud_ninieras || []).filter(x => x.solicitud_id === s.solicitud_id && x.ninera_id === s.ninera_id && x.estado === 'confirmada')
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]?.precio_hora ?? null,
              solicitud_id: s.solicitud_id ?? null,
            }),
          };
        });
    },

    // Etapa 9 (01/11/2026), migración 20261101_temporada_app.sql. Lo que ve al abrir su temporada:
    // {lugares, al_dia, solo_afuera}, o null si no es niñera. "Ahora" es el del reloj del test.
    ninera_mi_temporada: () => {
      const n = miFila();
      if (!nineraId || !n) return null;
      const inicio = inicioTemporadaMvd(ahora);
      const en = x => x != null && new Date(x) >= inicio;
      const alDia = en(n.temporada_actualizada_en);
      let lugares = null;
      if (alDia) {
        if (n.temporada_lugares != null && en(n.temporada_lugares_en) && ['app', 'sistema'].includes(n.temporada_fuente)) {
          lugares = n.temporada_lugares;
        } else {
          const punta = grupoAfuera(db, 'punta del este');
          const paloma = grupoAfuera(db, 'la paloma');
          const tiene = (g, q) => !!g && ((n.temporada || {})[g.id] || []).includes(q);
          lugares = {};
          for (let q = 0; q < 24; q++) lugares[String(q)] = tiene(punta, q) ? 'punta' : tiene(paloma, q) ? 'la_paloma' : 'montevideo';
        }
      }
      // Cada zona de su ficha es el nombre o un barrio de un grupo de afuera.
      const zonas = String(n.zona ?? '').split(/[/,]/).map(claveZona).filter(z => z !== '');
      const soloAfuera = zonas.length > 0 && zonas.every(z => (db.zona_grupos || []).some(g =>
        g.fuera_de_montevideo && [g.nombre, ...(g.zonas || [])].map(claveZona).includes(z)));
      return { lugares, al_dia: alDia, solo_afuera: soloAfuera };
    },
    // Valida las 24 quincenas y los valores, y escribe las mismas columnas que la función SQL.
    ninera_guardar_temporada: (cuerpo = {}) => {
      const p = cuerpo.p_lugares;
      if (!nineraId) throw errorRpc('no_autorizada');
      const claves = p && typeof p === 'object' && !Array.isArray(p) ? Object.keys(p) : null;
      const valorValido = v => (typeof v === 'string' && LUGARES_FIJOS.includes(v))
        || (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1
          && typeof v.otro === 'string' && largo(recortarBlancos(v.otro)) >= 1 && largo(recortarBlancos(v.otro)) <= 80);
      if (!claves || claves.length !== 24 || claves.some(k => !/^(?:[0-9]|1[0-9]|2[0-3])$/.test(k))
        || claves.some(k => !valorValido(p[k]))) throw errorRpc('temporada_invalida');
      const lugares = {};
      claves.forEach(k => { lugares[k] = typeof p[k] === 'object' ? { otro: recortarBlancos(p[k].otro) } : p[k]; });
      const punta = grupoAfuera(db, 'punta del este');
      if (Object.values(lugares).includes('punta') && !punta) throw errorRpc('sin_grupo_punta');
      const n = miFila();
      if (!n) return null;
      let zona = n.zona ?? null;
      const temporada = {};
      [[punta, 'punta'], [grupoAfuera(db, 'la paloma'), 'la_paloma']].forEach(([g, lugar]) => {
        if (!g) return;
        const qs = Array.from({ length: 24 }, (_, q) => q).filter(q => lugares[String(q)] === lugar);
        temporada[g.id] = qs;
        const propias = [g.nombre, ...(g.zonas || [])].map(claveZona);
        if (qs.length && !String(zona ?? '').split(/[/,]/).some(z => propias.includes(claveZona(z)))) {
          zona = [String(zona ?? '').trim() || null, g.nombre].filter(Boolean).join('/');
        }
      });
      Object.assign(n, {
        temporada_lugares: lugares, temporada_lugares_en: ahoraISO, temporada, zona,
        temporada_actualizada_en: ahoraISO, temporada_fuente: 'app',
        temporada_propuesta: null, temporada_propuesta_en: null,
      });
      return null;
    },

    // Etapa 5 (02/11/2026), migración 20261102_pedidos_app.sql. Sus pedidos abiertos ('invitada' y
    // 'acepto', de la app, con la solicitud abierta y de hoy en adelante): nunca la familia, la dirección,
    // el cobro ni las notas, y los chicos solo si están cargados uno por uno.
    // Etapa 6 (01/11/2026), 20261103_eleccion_pedidos.sql: además, una sola vez, lo que se cerró: la elegida
    // ('confirmada' con seleccionada_en) hasta que abre los datos, y 'cubierto' / 'cancelado' de las que dijeron
    // "Puedo" hasta que lo ven (visto_en); y las columnas horario_aproximado y solicitud_id al final.
    ninera_mis_pedidos: () => (db.solicitud_ninieras || [])
      .map(sn => ({ sn, s: (db.solicitudes || []).find(x => x.id === sn.solicitud_id) }))
      .filter(({ sn, s }) => nineraId && s && sn.ninera_id === nineraId && s.fecha >= hoy && (
        ((sn.origen ?? 'panel') === 'app' && ['invitada', 'acepto'].includes(sn.estado) && ABIERTO.includes(s.estado))
        || (!sinEtapa6 && sn.estado === 'confirmada' && sn.seleccionada_en != null && sn.visto_en == null && s.estado === 'confirmada')
        || (!sinEtapa6 && (sn.origen ?? 'panel') === 'app' && ['cubierto', 'cancelado'].includes(sn.estado) && sn.respondido_en != null && sn.visto_en == null)))
      .sort((a, b) => a.s.fecha.localeCompare(b.s.fecha) || horaParaOrdenar(a.s).localeCompare(horaParaOrdenar(b.s)))
      .map(({ sn, s }) => {
        const f = (db.familias || []).find(x => x.id === s.familia_id);
        const zona = [s.zona, f?.zona].map(z => String(z ?? '').trim()).find(z => z !== '') ?? null;
        const conHijos = (db.hijos_familia || []).some(h => h.familia_id === s.familia_id);
        return {
          id: sn.id, estado: sn.estado, fecha: s.fecha, hora_inicio: s.hora_inicio ?? null, hora_fin: s.hora_fin ?? null,
          termina_dia_siguiente: !!s.termina_dia_siguiente, zona, chicos: conHijos ? chicosTexto(db, s.familia_id, hoy) : null,
          precio_hora: sn.precio_hora ?? null, responder_hasta: s.responder_hasta ?? null, enviado_en: sn.enviado_en ?? null, respondido_en: sn.respondido_en ?? null,
          ...(sinEtapa6 ? {} : { horario_aproximado: !!s.horario_aproximado, solicitud_id: s.id }),
        };
      }),
    // La niñera vio la tarjeta de "Seleccionada" o el aviso de "cubierto" / "cancelado": no se le vuelve a mostrar.
    // Solo sus filas; true si marcó algo.
    ninera_marcar_pedido_visto: (cuerpo = {}) => {
      if (!nineraId) throw errorRpc('no_autorizada');
      const sn = (db.solicitud_ninieras || []).find(x => x.id === cuerpo.p_sn_id && x.ninera_id === nineraId && x.visto_en == null
        && ['confirmada', 'cubierto', 'cancelado'].includes(x.estado));
      if (!sn) return false;
      sn.visto_en = ahoraISO;
      return true;
    },
    // 'acepto' ("Puedo") o 'no_puedo' con motivo (el texto solo con 'otro'). 'ok', 'ya_respondido' o
    // 'cerrado'; un "Puedo" avisa a las admins (admin:pedido:<sn>:acepto).
    responder_pedido: (cuerpo = {}) => {
      const { p_sn_id, p_respuesta } = cuerpo;
      let motivo = cuerpo.p_motivo ?? null;
      let texto = recortarBlancos(cuerpo.p_motivo_texto ?? '') || null;
      if (!nineraId) throw errorRpc('no_autorizada');
      if (!['acepto', 'no_puedo'].includes(p_respuesta)) throw errorRpc('respuesta_invalida');
      if (p_respuesta === 'no_puedo') {
        if (!['otro_trabajo', 'facultad', 'lejos', 'tarde', 'otro'].includes(motivo)) throw errorRpc('motivo_invalido');
        if (motivo !== 'otro') texto = null;
        if (texto !== null && largo(texto) > 200) throw errorRpc('motivo_largo');
      } else { motivo = null; texto = null; }
      const sn = (db.solicitud_ninieras || []).find(x => x.id === p_sn_id && x.ninera_id === nineraId && (x.origen ?? 'panel') === 'app');
      if (!sn) throw errorRpc('no_existe');
      const s = (db.solicitudes || []).find(x => x.id === sn.solicitud_id);
      if (!s || !ABIERTO.includes(s.estado) || s.fecha < hoy) return 'cerrado';
      if (sn.estado !== 'invitada') return 'ya_respondido';
      Object.assign(sn, { estado: p_respuesta, respondido_en: ahoraISO, motivo_no: motivo, motivo_texto: texto });
      if (p_respuesta === 'acepto') {
        encolarAviso(db, ahoraISO, {
          clave: `admin:pedido:${sn.id}:acepto`, para_admin: 'todas', tipo: 'pedidos', titulo: `${sn.ninera_nombre} aceptó el pedido de ${s.familia_nombre}`,
          cuerpo: `${diaCortoTexto(s.fecha)} ${hhmm(s.hora_inicio)}`, url: `?ir=agenda&solicitud=${s.id}`, datos: { solicitud_id: s.id },
        });
      }
      return 'ok';
    },
    // Marca (o con p_quitar, desmarca) días en que no puede, de hoy a hoy + 90, hasta 62 por vez.
    ninera_marcar_no_disponible: (cuerpo = {}) => {
      const { p_fechas, p_quitar } = cuerpo;
      if (!nineraId) throw errorRpc('no_autorizada');
      if (!Array.isArray(p_fechas) || p_fechas.length === 0) return 0;
      if (p_fechas.length > 62) throw errorRpc('demasiados_dias');
      if (p_fechas.some(d => d == null || d < hoy || d > sumarDias(hoy, 90))) throw errorRpc('fecha_fuera_de_rango');
      const lista = db.ninera_no_disponible = db.ninera_no_disponible || [];
      if (p_quitar) {
        const antes = lista.length;
        db.ninera_no_disponible = lista.filter(d => !(d.ninera_id === nineraId && p_fechas.includes(d.fecha)));
        return antes - db.ninera_no_disponible.length;
      }
      let n = 0;
      for (const fecha of new Set(p_fechas)) {
        if (lista.some(d => d.ninera_id === nineraId && d.fecha === fecha)) continue;
        lista.push({ ninera_id: nineraId, fecha, creado_en: ahoraISO }); n++;
      }
      return n;
    },

    // Etapa 3 (30/10/2026), migración 20261029_avisos_chat.sql. Le escribe al equipo: guarda el texto
    // sin blancos alrededor, de 'ninera' y el nombre de su ficha como autor, y devuelve la fila (un
    // objeto, no una lista: la función devuelve un chat_mensajes, no un setof).
    ninera_enviar_mensaje: (cuerpo = {}) => {
      if (!nineraId) throw errorRpc('no_autorizada');
      const texto = recortarBlancos(cuerpo.p_texto);
      if (texto === '') throw errorRpc('mensaje_vacio');
      if (largo(texto) > 2000) throw errorRpc('mensaje_largo');
      const n = miFila();
      if (!n) return null;
      return insertarMensajeChat(db, { ninera_id: nineraId, de: 'ninera', autor: n.nombre, texto }, ahora);
    },
    // Marca leídos los del equipo en su hilo; devuelve cuántos (0 si no es niñera).
    ninera_marcar_chat_leido: () => {
      if (!nineraId) return 0;
      const sinLeer = (db.chat_mensajes || []).filter(m => m.ninera_id === nineraId && m.de === 'admin' && m.leido_ninera_en == null);
      sinLeer.forEach(m => { m.leido_ninera_en = ahoraISO; });
      return sinLeer.length;
    },
    // Marca leídos sus avisos; devuelve cuántos (0 si no es niñera).
    ninera_marcar_avisos_leidos: () => {
      if (!nineraId) return 0;
      const sinLeer = (db.avisos || []).filter(a => a.para_ninera_id === nineraId && a.leido_en == null);
      sinLeer.forEach(a => { a.leido_en = ahoraISO; });
      return sinLeer.length;
    },
  };
}

module.exports = { rpcNinera, errorRpc, rpcNoExiste, RPC_ETAPA_2, COLUMNAS_NINIERAS_ETAPA_2, RPC_ETAPA_3, TABLAS_ETAPA_3, RPC_ETAPA_9, COLUMNAS_NINIERAS_ETAPA_9, RPC_ETAPA_5, RPC_ETAPA_5_ADMIN, TABLAS_ETAPA_5, COLUMNAS_ETAPA_5, RPC_ETAPA_6, COLUMNAS_ETAPA_6, alConfirmarFila, alCancelarSolicitud, pedidoPuedeAvisar, rpcPedidosAdmin, avisoPedidoNuevo, inicioTemporadaMvd, recortarBlancos, largo, insertarMensajeChat };
