// Arranca la app en el navegador de los tests con Supabase SIMULADO.
//
// - Todo pedido a *.supabase.co se responde acá con los datos ficticios de datos.js
//   (o los que pase cada test). Nada llega a la base real: un pedido que no se sabe
//   simular queda anotado en `noSimulados` y el test falla al final (ver verificarLimpio).
// - supabase-js viene del propio repo (vendor/, desde el 05/10/2026): los tests no dependen
//   de ningún CDN.
// - Chart.js y xlsx se reemplazan por versiones mínimas (stubs.js): los tests miran la
//   app, no los gráficos.
// - La sesión se inyecta en localStorage, igual que la deja supabase-js después de un login
//   real. auth.js la toma por el camino rápido (leerSesionGuardada) y no pide Face ID.
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { datosBase, ID } = require('./datos');
const { STUB_CHART, STUB_XLSX } = require('./stubs');
const { rpcNinera, rpcNoExiste, RPC_ETAPA_2, COLUMNAS_NINIERAS_ETAPA_2, RPC_ETAPA_3, TABLAS_ETAPA_3, RPC_ETAPA_9, COLUMNAS_NINIERAS_ETAPA_9, RPC_ETAPA_5, RPC_ETAPA_5_ADMIN, TABLAS_ETAPA_5, COLUMNAS_ETAPA_5, RPC_ETAPA_6, COLUMNAS_ETAPA_6, alConfirmarFila, alCancelarSolicitud, rpcPedidosAdmin, avisoPedidoNuevo, recortarBlancos, largo, insertarMensajeChat } = require('./rpc-ninera');

const REF_PROD = 'wvewzamdohrpfhpccvcz';
// PNG transparente de 1×1: lo que devuelve Storage al bajar una foto o abrir una URL firmada.
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const USUARIO = {
  id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
  email: 'prueba@ejemplo.test', user_metadata: { nombre: 'Prueba' }, app_metadata: {},
};
// La cuenta de una niñera (fase 1): mail sintético armado con el celular, nunca uno real. El
// nombre de la ficha va en user_metadata, como lo deja la Edge Function ninera-cuenta (27/10/2026).
const USUARIO_NINERA = {
  id: ID.uNinera, aud: 'authenticated', role: 'authenticated',
  email: '59900000001@ninieras.parentsbreak.invalid', user_metadata: { nombre: 'Ana Ficticia', ninera_id: ID.nAna }, app_metadata: {},
};

function base64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }
function sesionFalsa(usuario = USUARIO) {
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const token = base64url({ alg: 'HS256', typ: 'JWT' }) + '.' +
    base64url({ sub: usuario.id, email: usuario.email, role: 'authenticated', aud: 'authenticated', exp }) + '.firma-falsa';
  return { access_token: token, refresh_token: 'refresh-falso', token_type: 'bearer', expires_in: 30 * 24 * 3600, expires_at: exp, user: usuario };
}

/* ---------- Mini PostgREST sobre arrays en memoria ---------- */
function valorFiltro(raw) {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}
function comparar(a, b) {
  if (a === null || a === undefined) return null;
  const na = Number(a), nb = Number(b);
  if (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb) && typeof a !== 'boolean') return na - nb;
  return String(a).localeCompare(String(b));
}
function separarLista(txt) {
  // in.(a,b,"c, d")
  const out = []; let actual = ''; let comillas = false;
  for (const c of txt) {
    if (c === '"') { comillas = !comillas; continue; }
    if (c === ',' && !comillas) { out.push(actual); actual = ''; continue; }
    actual += c;
  }
  if (actual !== '') out.push(actual);
  return out;
}
function cumple(fila, columna, expr) {
  const v = fila[columna];
  const i = expr.indexOf('.');
  let op = expr.slice(0, i), arg = expr.slice(i + 1);
  let negado = false;
  if (op === 'not') { negado = true; const j = arg.indexOf('.'); op = arg.slice(0, j); arg = arg.slice(j + 1); }
  let ok;
  switch (op) {
    case 'eq': ok = String(v) === String(valorFiltro(arg)) || v === valorFiltro(arg); break;
    case 'neq': ok = String(v) !== String(valorFiltro(arg)); break;
    case 'gt': ok = comparar(v, arg) > 0; break;
    case 'gte': ok = comparar(v, arg) >= 0; break;
    case 'lt': ok = comparar(v, arg) < 0; break;
    case 'lte': ok = comparar(v, arg) <= 0; break;
    case 'is': ok = arg === 'null' ? (v === null || v === undefined) : v === valorFiltro(arg); break;
    case 'in': ok = separarLista(arg.replace(/^\(|\)$/g, '')).some(x => String(x) === String(v)); break;
    case 'like': case 'ilike': {
      const re = new RegExp('^' + arg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*') + '$', op === 'ilike' ? 'i' : '');
      ok = re.test(String(v ?? '')); break;
    }
    case 'cs': { const lista = JSON.parse(arg.replace(/^\{/, '[').replace(/\}$/, ']')); ok = Array.isArray(v) && lista.every(x => v.includes(x)); break; }
    default: ok = true; // operador que no simulamos: no filtra
  }
  return negado ? !ok : ok;
}
const PARAMS_NO_FILTRO = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
function filtrar(filas, params) {
  let out = filas;
  for (const [k, v] of params) {
    if (PARAMS_NO_FILTRO.has(k)) continue;
    if (k === 'or') { // or=(estado.neq.previsto,fecha.lte.2026-10-04): alguna de las condiciones
      const conds = separarLista(v.replace(/^\(|\)$/g, ''));
      out = out.filter(f => conds.some(c => { const i = c.indexOf('.'); return cumple(f, c.slice(0, i), c.slice(i + 1)); }));
      continue;
    }
    out = out.filter(f => cumple(f, k, v));
  }
  return out;
}
function ordenar(filas, order) {
  if (!order) return filas;
  const claves = order.split(',').map(p => { const [col, dir] = p.split('.'); return { col, desc: dir === 'desc' }; });
  return filas.slice().sort((a, b) => {
    for (const { col, desc } of claves) {
      const c = comparar(a[col], b[col]);
      if (c === null) continue;
      if (c !== 0) return desc ? -c : c;
    }
    return 0;
  });
}
// Embebidos tipo "*, familias(nombre)" o "*, solicitud_ninieras(*)".
function embebidos(select) {
  const out = []; let nivel = 0; let actual = '';
  for (const c of select || '') {
    if (c === '(') nivel++;
    if (c === ')') nivel--;
    if (c === ',' && nivel === 0) { out.push(actual.trim()); actual = ''; continue; }
    actual += c;
  }
  if (actual.trim()) out.push(actual.trim());
  return out.map(p => p.match(/^(?:\w+:)?(\w+)(?:!\w+)?\((.*)\)$/)).filter(Boolean).map(m => m[1]);
}
function singular(tabla) { return tabla.replace(/es$/, '').replace(/s$/, ''); }
// La columna que apunta a una tabla cuando no sale de su nombre: ninieras -> ninera_id (01/11/2026,
// precios_ninera_familia con ninieras(nombre)).
const FK_EMBEBIDO = { ninieras: 'ninera_id' };
function resolverEmbebidos(filas, tabla, select, db) {
  const embs = embebidos(select);
  if (!embs.length) return filas;
  return filas.map(f => {
    const copia = { ...f };
    for (const emb of embs) {
      const hijos = db[emb] || [];
      const fk = Object.keys(f).find(k => k === singular(emb) + '_id' || k === emb.replace(/s$/, '') + '_id' || k === FK_EMBEBIDO[emb]);
      if (fk) copia[emb] = hijos.find(h => h.id === f[fk]) || null;
      else {
        const clavePadre = Object.keys(hijos[0] || {}).find(k => k.endsWith('_id') && (k === singular(tabla) + '_id' || k === tabla.replace(/s$/, '') + '_id' || k === 'evento_id'));
        copia[emb] = clavePadre ? hijos.filter(h => h[clavePadre] === f.id) : [];
      }
    }
    return copia;
  });
}

let secuenciaId = 0;
function nuevoId() { secuenciaId++; return `00000000-0000-4000-9000-${String(secuenciaId).padStart(12, '0')}`; }

/**
 * Abre la app con Supabase simulado.
 * @param {import('@playwright/test').Page} page
 * @param {object} opciones
 *   datos: tablas ficticias (se mezclan sobre datos.js)
 *   sesion: false para ver la pantalla de login
 *   ahora: fecha/hora fija (string ISO con zona) para el reloj del navegador
 *   ruta: path a abrir (por defecto '/')
 *   baseSinMigrar: true simula la base ANTES de la migración del 05/10/2026 (asignaciones
 *     sin vigencia/tipo, sin tabla sittings_historial) y de las siguientes (familias sin
 *     terminos_aceptados_el, 20/10/2026; ninieras sin las columnas de la etapa 2, 27/10/2026;
 *     sin chat_mensajes ni avisos, 30/10/2026; sin precios_ninera_familia, 01/11/2026), con los mismos
 *     errores que Supabase.
 *     'etapa3' simula la base con todo menos la migración de la etapa 3 (sin chat_mensajes ni
 *     avisos): es como va a estar producción entre que se publica la app y se aplica la migración.
 *     'etapa5' (02/11/2026): solo falta la migración de los pedidos por la app: enviar_pedido_app, sugeridas_datos
 *     y las tres RPC de la niñera dan 404 PGRST202, ninera_no_disponible 404 PGRST205 y las columnas nuevas
 *     (solicitudes, solicitud_ninieras, familias.solo_conocidas, pedidos_whatsapp.ninera_pedida) dan el error
 *     de columna de Supabase al leerlas o escribirlas.
 *   Con los pedidos de la etapa 5, app_config 'pedidos_app'.solo_practica arranca en true (como la migración): un
 *   test que manda pedidos de familias reales lo apaga con estado.db.app_config (ver tests/simulador-pedidos.spec.js).
 */
async function abrirApp(page, opciones = {}) {
  const { datos = {}, sesion = true, ahora = '2026-10-04T12:00:00-03:00', ruta = '/', baseSinMigrar = false } = opciones;
  const estado = crearEstado(datos);
  const sinMigrarTodo = baseSinMigrar === true;
  // Los pedidos de la etapa 5: las RPC del panel y de la niñera (la admin las llama y recibe no_autorizada).
  Object.assign(estado.rpc, rpcPedidosAdmin(estado.db, ahora, { admin: true }));
  // La etapa 6 es posterior a la 5: sin la 5 tampoco está la 6.
  const sinEtapa5 = sinMigrarTodo || baseSinMigrar === 'etapa5';
  const sinEtapa6 = sinEtapa5 || baseSinMigrar === 'etapa6';
  Object.assign(estado.rpc, Object.fromEntries(Object.entries(rpcNinera(estado.db, null, ahora, { sinEtapa6 })).filter(([n]) => RPC_ETAPA_5.includes(n) || RPC_ETAPA_6.includes(n))));
  if (sinEtapa5) [...RPC_ETAPA_5, ...RPC_ETAPA_5_ADMIN].forEach(nombre => { estado.rpc[nombre] = rpcNoExiste(nombre); });
  if (sinEtapa6) RPC_ETAPA_6.forEach(nombre => { estado.rpc[nombre] = rpcNoExiste(nombre); });
  if (sinMigrarTodo) (estado.db.familias || []).forEach(f => { delete f.terminos_aceptados_el; });
  if (sinMigrarTodo) sacarColumnasEtapa2(estado.db);
  await prepararPagina(page, estado, { usuario: USUARIO, claveSesion: `sb-${REF_PROD}-auth-token`, sesion, ahora,
    baseSinMigrar: sinMigrarTodo, sinEtapa5, sinEtapa6, tablasSinMigrar: baseSinMigrar === 'etapa5' ? TABLAS_ETAPA_5 : baseSinMigrar ? [...TABLAS_ETAPA_3, ...TABLAS_ETAPA_5] : [] });

  await page.goto(ruta);
  if (sesion) await expect(page.locator('#modcontent')).toBeVisible();
  else await expect(page.locator('#login-mail')).toBeVisible();
  await esperarQuieta(page);
  return estado;
}

/**
 * Abre la app de niñeras (ninera/, fase 1) con Supabase simulado. Devuelve el mismo `estado`
 * que abrirApp, con las RPC de la niñera ya simuladas (rpc-ninera.js; un test puede pisarlas).
 *   datos, ahora: como en abrirApp
 *   ninera: id de la niñera de la sesión (su fila queda con user_id = USUARIO_NINERA.id)
 *   sesion: false para entrar sin sesión (invitación, login)
 *   ruta, consulta: path y query a abrir (consulta: '?i=<token>' para un link de invitación)
 *   baseSinMigrar: true simula la base sin las migraciones de las etapas 2 (27/10/2026) y 3
 *     (30/10/2026): sus RPC dan 404 PGRST202, ninieras no tiene las columnas de la etapa 2 y
 *     chat_mensajes y avisos dan 404 PGRST205; las de la etapa 1 andan. 'etapa3': falta la 3
 *     (y con ella la 9; el perfil y los próximos sittings andan). 'etapa9' (01/11/2026): solo falta
 *     la de la temporada (ninera_mi_temporada y ninera_guardar_temporada dan 404 PGRST202, ninieras
 *     sin sus dos columnas); lo de las etapas 2 y 3 anda
 *   funciones: Edge Functions simuladas por nombre desde el primer pedido (como estado.funciones,
 *     pero antes de navegar: con consulta, la app llama a la función apenas abre)
 *   instalada: true simula la app abierta desde la pantalla de inicio (display-mode: standalone
 *     y navigator.standalone del iPhone); false, abierta en el navegador
 */
async function abrirAppNinera(page, opciones = {}) {
  const { datos = {}, ninera = ID.nAna, sesion = true, ahora = '2026-10-04T12:00:00-03:00', ruta = '/ninera/', instalada = true, consulta = '', funciones = {}, baseSinMigrar = false } = opciones;
  const estado = crearEstado(datos);
  Object.assign(estado.funciones, funciones);
  if (sesion) {
    const fila = (estado.db.ninieras || []).find(n => n.id === ninera);
    if (fila) fila.user_id = USUARIO_NINERA.id;
  }
  // 'etapa5' (solo falta la de los pedidos), y también con true y 'etapa3' (la 5 es posterior a la 3).
  // 'etapa6' (03/11/2026): solo falta la de elegir la niñera (la 6 es posterior a la 5).
  const sinEtapa5 = baseSinMigrar === true || baseSinMigrar === 'etapa3' || baseSinMigrar === 'etapa5';
  const sinEtapa6 = sinEtapa5 || baseSinMigrar === 'etapa6';
  Object.assign(estado.rpc, rpcNinera(estado.db, ninera, ahora || undefined, { sinEtapa6 }));
  // Una niñera no es admin: enviar_pedido_app y sugeridas_datos le dan no_autorizada / nada.
  Object.assign(estado.rpc, rpcPedidosAdmin(estado.db, ahora || undefined, { admin: false }));
  if (sinEtapa5) [...RPC_ETAPA_5, ...RPC_ETAPA_5_ADMIN].forEach(nombre => { estado.rpc[nombre] = rpcNoExiste(nombre); });
  if (sinEtapa6) RPC_ETAPA_6.forEach(nombre => { estado.rpc[nombre] = rpcNoExiste(nombre); });
  if (baseSinMigrar === true) {
    RPC_ETAPA_2.forEach(nombre => { estado.rpc[nombre] = rpcNoExiste(nombre); });
    sacarColumnasEtapa2(estado.db);
  }
  // 'etapa3': sin la 3 ni la 9 (la base real no tiene la 9 sin la 3). 'etapa9': solo sin la 9.
  if (baseSinMigrar === true || baseSinMigrar === 'etapa3') RPC_ETAPA_3.forEach(nombre => { estado.rpc[nombre] = rpcNoExiste(nombre); });
  if (baseSinMigrar) {
    RPC_ETAPA_9.forEach(nombre => { estado.rpc[nombre] = rpcNoExiste(nombre); });
    (estado.db.ninieras || []).forEach(n => COLUMNAS_NINIERAS_ETAPA_9.forEach(c => { delete n[c]; }));
  }
  // Clave propia de la sesión (storageKey 'sb-ninera-auth'): el panel y la app de niñeras nunca
  // comparten sesión en el mismo navegador. sesionNinera: las lecturas de chat_mensajes y avisos
  // pasan por la RLS de la niñera (30/10/2026).
  await prepararPagina(page, estado, { usuario: USUARIO_NINERA, claveSesion: 'sb-ninera-auth', sesion, ahora,
    sesionNinera: ninera, sinEtapa5, sinEtapa6,
    tablasSinMigrar: [...(baseSinMigrar === true || baseSinMigrar === 'etapa3' ? TABLAS_ETAPA_3 : []), ...(sinEtapa5 ? TABLAS_ETAPA_5 : [])] });

  // page.emulateMedia no sabe de display-mode: se pisa matchMedia solo para esa consulta, y
  // navigator.standalone (el que mira Safari del iPhone).
  await page.addInitScript(instalada => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = consulta => {
      if (/display-mode:\s*standalone/.test(String(consulta))) {
        return { matches: instalada, media: String(consulta), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
      }
      return original(consulta);
    };
    Object.defineProperty(navigator, 'standalone', { value: instalada, configurable: true });
  }, instalada);

  await page.goto(ruta + consulta);
  await esperarQuieta(page);
  return estado;
}

// Base sin la migración de la etapa 2 (27/10/2026): las filas de ninieras sin sus columnas.
function sacarColumnasEtapa2(db) {
  (db.ninieras || []).forEach(n => COLUMNAS_NINIERAS_ETAPA_2.forEach(c => { delete n[c]; }));
}

// El estado que ve cada test: la base ficticia y lo que pasó (escrituras, errores, pedidos sin
// simular).
function crearEstado(datos) {
  const db = structuredClone({ ...datosBase(), ...datos });
  // demoraEscrituras (ms) y fallar(pedido) se pueden cambiar en medio del test: sirven para
  // simular una base lenta (doble toque) o que falle un guardado. fallar recibe
  // {tabla, metodo, cuerpo} y devuelve undefined (anda), 'red' (se corta la conexión) o
  // {status, message} (Supabase responde con error).
  // maxFilas: como Supabase (max rows del proyecto), ninguna lectura devuelve más de 1.000
  // filas aunque haya más; quien necesita todo tiene que pedir de a tandas (leerTodasLasFilas).
  // rpc[nombre] y funciones[nombre] simulan una función de la base o una Edge Function.
  // funciones['pedido-whatsapp'] (02/11/2026): el ticket ficticio de siempre (Familia Prueba Uno, el martes
  // 06/10 de 20 a 23, dos chicos, una duda y la niñera que pide la madre); guarda la fila como la función
  // real. Un test lo pisa con su propio ticket.
  const funciones = { 'pedido-whatsapp': (cuerpo = {}) => {
    const fila = { id: nuevoId(), creado_el: new Date().toISOString(), creado_por: cuerpo.creado_por ?? 'Paula Prueba', texto: cuerpo.texto ?? '', estado: 'borrador',
      tipo: 'pedido_nuevo', familia_id: ID.fUno, familia_texto: 'Prueba Uno', servicio: 'sitting', fecha: '2026-10-06', hora_inicio: '20:00', hora_fin: '23:00',
      termina_dia_siguiente: false, horario_aproximado: false, horario_nota: null, chicos_cantidad: 2, chicos_edades: '3 y 5 años', zona: 'Pocitos',
      ninera_pedida: 'Carla Ejemplo', notas: null, dudas: ['No queda claro si hay que dar de cenar.'], cobro_estimado: 1140, pago_estimado: 750, solicitud_id: null };
    (db.pedidos_whatsapp = db.pedidos_whatsapp || []).push(fila);
    return { json: { pedido: fila } };
  } };
  return { escrituras: [], errores: [], noSimulados: [], db, demoraEscrituras: 0, demoraLecturas: 0, fallar: null, rpc: {}, funciones, maxFilas: 1000 };
}

/**
 * Lo común a las dos puertas (panel y app de niñeras): reloj, CDNs, Realtime, el Supabase
 * simulado y la sesión. Cada puerta navega y espera lo suyo después.
 *   usuario: el que responden /auth/v1/user y /auth/v1/token
 *   claveSesion: dónde guarda supabase-js la sesión (la storageKey de cada puerta)
 *   sesionNinera: id de la niñera de la sesión (app de niñeras); sin eso, la sesión es de una admin
 *   tablasSinMigrar: tablas que todavía no existen (404 PGRST205), además de las de baseSinMigrar
 *   sinEtapa5: las columnas de la migración de los pedidos (COLUMNAS_ETAPA_5) no existen
 */
async function prepararPagina(page, estado, { usuario, claveSesion, sesion, ahora, baseSinMigrar = false, sinEtapa5 = false, sinEtapa6 = false, sesionNinera = null, tablasSinMigrar = [] }) {
  const { db } = estado;
  const rls = reglasEtapa3(db, sesionNinera);
  page.on('console', m => { if (m.type() === 'error') estado.errores.push('consola: ' + m.text()); });
  page.on('pageerror', e => estado.errores.push('excepción: ' + e.message));

  if (ahora) await page.clock.setFixedTime(new Date(ahora));

  // jsdelivr ya no se usa: si algo lo pide, que falle y se note.
  await page.route(/cdn\.jsdelivr\.net/, r => { estado.noSimulados.push('CDN ' + r.request().url()); return r.abort(); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: '', contentType: 'text/css' }));
  // Ojo: Playwright prueba primero la ruta registrada ÚLTIMA. La genérica va antes.
  await page.route(/cdnjs\.cloudflare\.com/, r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js/, r => r.fulfill({ body: STUB_CHART, contentType: 'application/javascript' }));
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx/, r => r.fulfill({ body: STUB_XLSX, contentType: 'application/javascript' }));
  // Fotos y links externos de los datos ficticios: imagen vacía, nunca red real.
  await page.route(/ejemplo\.test|example\.com/, r => r.fulfill({ status: 404, body: '' }));

  // Realtime simulado (protocolo Phoenix v2 de supabase-js): acepta las suscripciones y deja
  // que el test "haga un cambio desde otro celular" con estado.emitirRealtime(tabla, tipo, fila).
  // Sin eso no manda nada, como antes.
  const canalesRT = new Map(); // topic -> { joinRef, cambios: [{id, table}] }
  let sockets = [], idRT = 1;
  await page.routeWebSocket(/supabase\.co/, ws => {
    sockets.push(ws);
    ws.onMessage(m => {
      let msg; try { msg = JSON.parse(String(m)); } catch { return; }
      if (!Array.isArray(msg)) return;
      const [joinRef, ref, topic, evento, payload] = msg;
      const responder = resp => ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: resp }]));
      if (evento === 'heartbeat') return responder({});
      if (evento === 'phx_join') {
        const cambios = (payload?.config?.postgres_changes || []).map(c => ({ ...c, id: idRT++ }));
        canalesRT.set(topic, { joinRef, cambios, ws });
        return responder({ postgres_changes: cambios });
      }
      if (evento === 'phx_leave') { canalesRT.delete(topic); return responder({}); }
    });
  });
  estado.emitirRealtime = (tabla, tipo = 'INSERT', fila = {}) => {
    let enviados = 0;
    // Como Realtime (30/10/2026): no manda lo que la RLS no deja leer a esa sesión, ni lo que no
    // cumple el filter del canal (solo col=eq.valor, el único que usa la app).
    if (!rls.visible(tabla, fila)) return 0;
    const cumpleFiltro = filtro => {
      const m = /^(\w+)=eq\.(.*)$/.exec(filtro || '');
      return !m || String(fila[m[1]]) === m[2];
    };
    for (const [topic, c] of canalesRT) {
      const ids = c.cambios.filter(x => x.table === tabla && cumpleFiltro(x.filter)).map(x => x.id);
      if (!ids.length) continue;
      c.ws.send(JSON.stringify([c.joinRef, null, topic, 'postgres_changes', { ids, data: {
        schema: 'public', table: tabla, commit_timestamp: new Date().toISOString(), type: tipo,
        record: fila, old_record: {}, columns: [], errors: null,
      } }]));
      enviados++;
    }
    return enviados;
  };

  await page.route(/supabase\.co/, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const metodo = req.method();
    if (!url.hostname.startsWith(REF_PROD + '.')) { estado.noSimulados.push(metodo + ' ' + req.url()); return route.abort(); }

    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: usuario });
      // Login y cerrar sesión quedan anotados (app de niñeras, 26/10/2026: el test mira con qué
      // mail entra y que cierre solo este dispositivo) y pasan por estado.fallar como una
      // escritura: 'red' corta la conexión y {status, message} es el error de Supabase
      // (por ejemplo 400 'Invalid login credentials').
      if (url.pathname === '/auth/v1/logout' || url.pathname === '/auth/v1/token') {
        let cuerpo; try { cuerpo = req.postDataJSON(); } catch { cuerpo = req.postData(); }
        const falla = estado.fallar && estado.fallar({ tabla: url.pathname, metodo, cuerpo, params: Object.fromEntries(url.searchParams) });
        if (falla === 'red') return route.abort('failed');
        if (falla) return route.fulfill({ status: falla.status || 400, json: { code: falla.code || 'invalid_credentials', error_code: falla.code || 'invalid_credentials', message: falla.message || 'falla simulada' } });
        estado.escrituras.push({ tabla: url.pathname, metodo, params: url.search, cuerpo });
        if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
        return route.fulfill({ json: sesionFalsa(usuario) });
      }
      estado.noSimulados.push(metodo + ' ' + url.pathname);
      return route.fulfill({ status: 400, json: { message: 'no simulado en tests' } });
    }
    // Storage (27/10/2026, etapa 2): pasa por estado.fallar ({tabla: la ruta de /storage/v1/...},
    // 'red' o {status, message}) y por demoraEscrituras al subir o borrar. Bajar un archivo o abrir
    // una URL firmada devuelve una imagen de 1×1 (no es una escritura: no se anota); pedir la URL
    // firmada responde una ficticia que vuelve a pasar por acá. Subir, borrar y lo demás se anota
    // en escrituras con la ruta.
    if (url.pathname.startsWith('/storage/v1/')) {
      const falla = estado.fallar && estado.fallar({ tabla: url.pathname, metodo, cuerpo: null, params: Object.fromEntries(url.searchParams) });
      if (falla === 'red') { estado.fallidas = (estado.fallidas || 0) + 1; return route.abort('failed'); }
      if (falla) {
        estado.fallidas = (estado.fallidas || 0) + 1;
        const status = falla.status || 500;
        return route.fulfill({ status, json: { statusCode: String(status), error: 'falla simulada', message: falla.message || 'falla simulada' } });
      }
      if (metodo === 'GET') return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1X1, 'base64') });
      if (estado.demoraEscrituras) await new Promise(r => setTimeout(r, estado.demoraEscrituras));
      estado.escrituras.push({ tabla: url.pathname, metodo, params: url.search, cuerpo: req.postData() });
      if (metodo === 'POST' && url.pathname.startsWith('/storage/v1/object/sign/')) {
        return route.fulfill({ json: { signedURL: `${url.pathname.replace('/storage/v1', '')}?token=ficticio` } });
      }
      return route.fulfill({ json: { Key: 'ficticio', path: 'ficticio' } });
    }
    if (url.pathname.startsWith('/functions/v1/')) {
      estado.escrituras.push({ tabla: url.pathname, metodo, params: url.search, cuerpo: req.postData() });
      // estado.funciones[nombre] = (cuerpo, req) => ({ status, json }) simula una Edge Function
      // por nombre; sin eso, la respuesta genérica de siempre.
      const funcion = estado.funciones[url.pathname.split('/')[3]];
      if (typeof funcion === 'function') {
        let cuerpo; try { cuerpo = req.postDataJSON(); } catch { cuerpo = req.postData(); }
        const { status = 200, json } = (await funcion(cuerpo, req)) || {};
        return route.fulfill({ status, json });
      }
      return route.fulfill({ json: { Key: 'ficticio', path: 'ficticio' } });
    }
    if (!url.pathname.startsWith('/rest/v1/')) {
      estado.noSimulados.push(metodo + ' ' + url.pathname);
      return route.fulfill({ status: 404, json: {} });
    }

    const tabla = url.pathname.replace('/rest/v1/', '');
    if (tabla.startsWith('rpc/')) {
      const cuerpo = req.postDataJSON?.();
      // Una RPC también puede fallar con estado.fallar (27/10/2026, etapa 2): {tabla: 'rpc/<nombre>'}.
      // Como en las escrituras, la que falla no queda anotada, y demoraEscrituras la demora (doble
      // toque en un botón que guarda con una RPC).
      const falla = estado.fallar && estado.fallar({ tabla, metodo, cuerpo, params: Object.fromEntries(url.searchParams) });
      if (falla === 'red') { estado.fallidas = (estado.fallidas || 0) + 1; return route.abort('failed'); }
      if (falla) {
        estado.fallidas = (estado.fallidas || 0) + 1;
        return route.fulfill({ status: falla.status || 500, json: { code: falla.code || 'XX000', message: falla.message || 'falla simulada' } });
      }
      if (estado.demoraEscrituras) await new Promise(r => setTimeout(r, estado.demoraEscrituras));
      estado.escrituras.push({ tabla, metodo, cuerpo });
      // Con la base sin migrar, una función nueva no existe (mismo error que Supabase).
      if (baseSinMigrar) return route.fulfill({ status: 404, json: { code: 'PGRST202', message: `Could not find the function public.${tabla.slice(4)} in the schema cache` } });
      // estado.rpc[nombre] = (cuerpo, db) => resultado simula lo que hace la función en la base. Si
      // tira errorRpc (rpc-ninera.js), responde ese error, como un "raise exception" de la SQL.
      const simular = estado.rpc[tabla.slice(4)];
      let resultado;
      try { resultado = simular ? await simular(cuerpo, db) : []; }
      catch (e) {
        if (!e || !e.rpc) throw e;
        return route.fulfill({ status: e.rpc.status, json: { code: e.rpc.code, details: null, hint: e.rpc.hint ?? null, message: e.rpc.message } });
      }
      return route.fulfill({ json: resultado });
    }
    if ((baseSinMigrar && ['sittings_historial', 'finanzas_historial', 'ajustes_saldo', 'gastos_extra', 'variantes_precio', 'borradores', 'precios_ninera_familia'].includes(tabla))
      || tablasSinMigrar.includes(tabla)) {
      return route.fulfill({ status: 404, json: { code: 'PGRST205', message: `Could not find the table 'public.${tabla}' in the schema cache` } });
    }
    // Etapa 5 (02/11/2026): sin la migración de los pedidos, las columnas nuevas no existen: leerlas da
    // 42703 (select) y escribirlas PGRST204, como Supabase.
    // Etapa 6 (03/11/2026): lo mismo con las columnas de elegir la niñera (COLUMNAS_ETAPA_6).
    const columnasNuevas = [...(sinEtapa5 ? COLUMNAS_ETAPA_5[tabla] || [] : []), ...(sinEtapa6 ? COLUMNAS_ETAPA_6[tabla] || [] : [])];
    if (columnasNuevas.length) {
      if (metodo === 'GET' || metodo === 'HEAD') {
        const col = columnasNuevas.find(c => new RegExp(`(^|[^\\w])${c}([^\\w]|$)`).test(url.searchParams.get('select') || ''));
        if (col) return route.fulfill({ status: 400, json: { code: '42703', message: `column ${tabla}.${col} does not exist` } });
      } else if (['POST', 'PATCH'].includes(metodo) && req.postData()) {
        const col = columnasNuevas.find(c => [].concat(JSON.parse(req.postData())).some(f => c in f));
        if (col) {
          estado.rechazadas = (estado.rechazadas || 0) + 1;
          return route.fulfill({ status: 400, json: { code: 'PGRST204', message: `Could not find the '${col}' column of '${tabla}' in the schema cache` } });
        }
      }
    }
    // Términos y condiciones (20/10/2026): sin la migración, familias no tiene la columna.
    if (baseSinMigrar && tabla === 'familias' && /terminos_aceptados_el/.test((url.searchParams.get('select') || '') + (req.postData() || ''))) {
      return route.fulfill({ status: 400, json: { code: '42703', message: 'column familias.terminos_aceptados_el does not exist' } });
    }
    // Variantes de precio (23/10/2026): sin la migración, sittings_traslados no tiene precio_variantes.
    if (baseSinMigrar && tabla === 'sittings_traslados' && ['POST', 'PATCH'].includes(metodo) && /"precio_variantes"/.test(req.postData() || '')) {
      return route.fulfill({ status: 400, json: { code: 'PGRST204', message: "Could not find the 'precio_variantes' column of 'sittings_traslados' in the schema cache" } });
    }
    if (baseSinMigrar && tabla === 'sittings_traslados' && metodo === 'GET' && /precio_variantes/.test(url.searchParams.get('select') || '')) {
      return route.fulfill({ status: 400, json: { code: '42703', message: 'column sittings_traslados.precio_variantes does not exist' } });
    }
    // Precio a mano (21/10/2026): sin la migración, sittings_traslados no tiene precio_motivo.
    if (baseSinMigrar && tabla === 'sittings_traslados' && ['POST', 'PATCH'].includes(metodo) && /"precio_motivo"/.test(req.postData() || '')) {
      return route.fulfill({ status: 400, json: { code: 'PGRST204', message: "Could not find the 'precio_motivo' column of 'sittings_traslados' in the schema cache" } });
    }
    if (baseSinMigrar && tabla === 'asignaciones' && ['POST', 'PATCH'].includes(metodo) && req.postData()) {
      const filas = [].concat(JSON.parse(req.postData()));
      const col = ['vigente_desde', 'vigente_hasta', 'tipo'].find(c => filas.some(f => c in f));
      if (col) {
        estado.rechazadas = (estado.rechazadas || 0) + 1;
        return route.fulfill({ status: 400, json: { code: 'PGRST204', message: `Could not find the '${col}' column of 'asignaciones' in the schema cache` } });
      }
    }
    db[tabla] = db[tabla] || [];
    const params = [...url.searchParams.entries()];
    const unico = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const prefer = req.headers()['prefer'] || '';
    const responder = (filas, extra = {}) => {
      const conEmb = resolverEmbebidos(filas, tabla, url.searchParams.get('select'), db);
      if (unico) {
        if (conEmb.length !== 1) return route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${conEmb.length} filas` } });
        return route.fulfill({ json: conEmb[0], ...extra });
      }
      return route.fulfill({ json: conEmb, ...extra });
    };

    if (metodo === 'GET' || metodo === 'HEAD') {
      if (estado.demoraLecturas) await new Promise(r => setTimeout(r, estado.demoraLecturas * (0.5 + Math.random())));
      let filas = ordenar(filtrar(db[tabla].filter(f => rls.visible(tabla, f)), params), url.searchParams.get('order'));
      const total = filas.length;
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = url.searchParams.get('limit');
      filas = filas.slice(offset, limit ? offset + Number(limit) : undefined);
      if (estado.maxFilas) filas = filas.slice(0, estado.maxFilas);
      const headers = { 'content-range': `${offset}-${offset + Math.max(filas.length - 1, 0)}/${total}` };
      if (metodo === 'HEAD') return route.fulfill({ status: 200, headers, body: '' });
      return responder(filas, { headers });
    }

    const cuerpo = req.postData() ? JSON.parse(req.postData()) : null;
    if (estado.demoraEscrituras) await new Promise(r => setTimeout(r, estado.demoraEscrituras));
    const falla = estado.fallar && estado.fallar({ tabla, metodo, cuerpo, params: Object.fromEntries(params) });
    if (falla === 'red') { estado.fallidas = (estado.fallidas || 0) + 1; return route.abort('failed'); }
    if (falla) {
      estado.fallidas = (estado.fallidas || 0) + 1;
      return route.fulfill({ status: falla.status || 500, json: { code: falla.code || 'XX000', message: falla.message || 'falla simulada' } });
    }
    // Lo que la base de la etapa 3 no deja escribir (permisos por columna, RLS y checks): mismo error
    // que Supabase y, como las de asignaciones sin migrar, no queda anotado en escrituras.
    const rechazo = rls.rechazo(tabla, metodo, cuerpo);
    if (rechazo) {
      estado.rechazadas = (estado.rechazadas || 0) + 1;
      return route.fulfill({ status: rechazo.status, json: { code: rechazo.code, details: null, hint: null, message: rechazo.message } });
    }
    estado.escrituras.push({ tabla, metodo, params: Object.fromEntries(params), cuerpo });
    // Lo que pone la base: precios_ninera_familia nace con creado_en y actualizado_en, y un trigger
    // vuelve a poner actualizado_en en cada cambio (01/11/2026: la ficha guarda con esa condición).
    const conFechas = tabla === 'precios_ninera_familia';
    const ahoraIso = () => new Date().toISOString();
    // Triggers de la etapa 6 (solicitud_ninieras_al_confirmar y solicitudes_al_cancelar): corren cuando la fila
    // pasa a 'confirmada' (insert o update de estado) o la solicitud pasa a 'cancelada'. Sin la migración, no existen.
    const triggersEleccion = (tablaFila, fila, estadoAntes) => {
      if (sinEtapa6 || fila.estado === estadoAntes) return;
      const ahoraDb = new Date(ahora || Date.now()).toISOString();
      if (tablaFila === 'solicitud_ninieras' && fila.estado === 'confirmada') alConfirmarFila(db, ahoraDb, fila);
      if (tablaFila === 'solicitudes' && fila.estado === 'cancelada') alCancelarSolicitud(db, ahoraDb, fila);
    };
    let afectadas = [];
    if (metodo === 'POST' && tabla === 'chat_mensajes') {
      // id, creado_en y lo leído los pone la base, y el trigger encola el aviso.
      afectadas = [].concat(cuerpo).map(f => insertarMensajeChat(db, f, ahora));
    } else if (metodo === 'POST') {
      const lista = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      const conflicto = url.searchParams.get('on_conflict');
      for (const fila of lista) {
        if (prefer.includes('merge-duplicates') && conflicto) {
          const claves = conflicto.split(',');
          const existente = db[tabla].find(f => claves.every(c => String(f[c]) === String(fila[c])));
          if (existente) {
            const antes = existente.estado;
            Object.assign(existente, fila, conFechas ? { actualizado_en: ahoraIso() } : {});
            afectadas.push(existente);
            triggersEleccion(tabla, existente, antes);
            continue;
          }
        }
        const nueva = { id: nuevoId(), created_at: new Date().toISOString(), ...(conFechas ? { creado_en: ahoraIso(), actualizado_en: ahoraIso() } : {}), ...fila };
        db[tabla].push(nueva); afectadas.push(nueva);
        triggersEleccion(tabla, nueva, undefined);
      }
    } else if (metodo === 'PATCH') {
      afectadas = filtrar(db[tabla].filter(f => rls.modificable(tabla, metodo, f)), params);
      afectadas.forEach(f => {
        const sinSolicitud = f.solicitud_id == null;
        const antes = f.estado;
        Object.assign(f, cuerpo, conFechas ? { actualizado_en: ahoraIso() } : {});
        triggersEleccion(tabla, f, antes);
        // Trigger pedidos_whatsapp_aviso_nuevo (etapa 5): solicitud_id pasa de null a un valor.
        if (tabla === 'pedidos_whatsapp' && !sinEtapa5 && sinSolicitud && f.solicitud_id != null) avisoPedidoNuevo(db, new Date(ahora || Date.now()).toISOString(), f);
      });
    } else if (metodo === 'DELETE') {
      afectadas = filtrar(db[tabla].filter(f => rls.modificable(tabla, metodo, f)), params);
      db[tabla] = db[tabla].filter(f => !afectadas.includes(f));
    }
    if (prefer.includes('return=representation')) return responder(afectadas, { status: metodo === 'POST' ? 201 : 200 });
    return route.fulfill({ status: metodo === 'POST' ? 201 : 204, body: '' });
  });

  if (sesion) {
    await page.addInitScript(([clave, valor]) => {
      if (!sessionStorage.getItem('__tests_sesion_puesta')) {
        localStorage.setItem(clave, valor);
        sessionStorage.setItem('__tests_sesion_puesta', '1');
      }
    }, [claveSesion, JSON.stringify(sesionFalsa(usuario))]);
  }
}

/* ---- Etapa 3 (30/10/2026): la RLS y los permisos de chat_mensajes y avisos ----
   Imitan 20261029_avisos_chat.sql. La niñera de la sesión lee solo su hilo y sus avisos y no
   escribe en ninguna de las dos (lo hace por sus RPC, rpc-ninera.js). Una admin lee todo el chat y
   solo los avisos con para_admin; en el chat inserta solo ninera_id, de, autor y texto (de 'admin',
   a una niñera activa con cuenta) y solo actualiza leido_admin_en. Nadie inserta en avisos (lo hace
   la base) ni borra. Un update o un delete que la RLS no deja no da error: no toca ninguna fila. Las
   demás tablas, como siempre. */
const COLUMNAS_INSERT_CHAT = ['ninera_id', 'de', 'autor', 'texto'];
function reglasEtapa3(db, sesionNinera) {
  const esNinera = !!sesionNinera;
  const permisoDenegado = tabla => ({ status: 403, code: '42501', message: `permission denied for table ${tabla}` });
  const violaRls = tabla => ({ status: 403, code: '42501', message: `new row violates row-level security policy for table "${tabla}"` });
  return {
    visible(tabla, fila) {
      if (tabla === 'chat_mensajes') return !esNinera || fila.ninera_id === sesionNinera;
      if (tabla === 'avisos') return esNinera ? fila.para_ninera_id === sesionNinera : fila.para_admin != null;
      if (tabla === 'ninera_no_disponible') return !esNinera || fila.ninera_id === sesionNinera;
      return true;
    },
    modificable(tabla, metodo, fila) {
      if (tabla === 'chat_mensajes') return metodo === 'PATCH' && !esNinera;
      if (tabla === 'avisos' || tabla === 'ninera_no_disponible') return false;
      return true;
    },
    // Error de PostgREST para una escritura que la base rechaza, o null si pasa.
    rechazo(tabla, metodo, cuerpo) {
      if (tabla === 'avisos') return metodo === 'POST' ? violaRls(tabla) : null;
      // ninera_no_disponible (etapa 5): se le quitó insert, update y delete a todos; solo la RPC escribe.
      if (tabla === 'ninera_no_disponible') return permisoDenegado(tabla);
      if (tabla !== 'chat_mensajes') return null;
      const filas = [].concat(cuerpo || []);
      if (metodo === 'PATCH' && filas.some(f => Object.keys(f).some(c => c !== 'leido_admin_en'))) return permisoDenegado(tabla);
      if (metodo !== 'POST') return null;
      // En el orden de Postgres: permisos por columna, la política (with check) y los checks.
      if (filas.some(f => Object.keys(f).some(c => !COLUMNAS_INSERT_CHAT.includes(c)))) return permisoDenegado(tabla);
      const destinoValido = f => (db.ninieras || []).some(n => n.id === f.ninera_id && n.activa && n.user_id != null);
      if (esNinera || filas.some(f => f.de !== 'admin' || !destinoValido(f))) return violaRls(tabla);
      const nula = COLUMNAS_INSERT_CHAT.find(c => filas.some(f => f[c] == null));
      if (nula) return { status: 400, code: '23502', message: `null value in column "${nula}" of relation "chat_mensajes" violates not-null constraint` };
      if (filas.some(f => { const n = largo(recortarBlancos(f.texto)); return n < 1 || n > 2000; })) {
        return { status: 400, code: '23514', message: 'new row for relation "chat_mensajes" violates check constraint "chat_mensajes_texto_check"' };
      }
      return null;
    },
  };
}

// Espera a que no queden spinners de "Cargando…" en pantalla.
async function esperarQuieta(page) {
  await expect(page.locator('#app .spinner')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(150);
}

async function irAModulo(page, clave) {
  await page.evaluate(k => setModulo(k), clave);
  await esperarQuieta(page);
}

// Al final de cada test: ni errores de consola/JS, ni pedidos a Supabase sin simular.
function verificarLimpio(estado, { ignorar = [] } = {}) {
  const errores = estado.errores.filter(e => !ignorar.some(re => re.test(e)));
  expect(estado.noSimulados, 'pedidos a Supabase sin simular').toEqual([]);
  expect(errores, 'errores en consola o excepciones').toEqual([]);
}

// La app servida bajo la dirección publicada (https://parentsbreak.github.io/app/), desde los archivos
// del repo: cada pedido a /app/<archivo> se responde con el archivo local. Lo usan los tests que miran
// algo que solo pasa en ese host (el aviso "La app se mudó"). El service worker se registra por fuera
// de page.route (iría a internet de verdad): se anula, estos tests no lo necesitan.
const ORIGEN_PUBLICADO = 'https://parentsbreak.github.io';
const APP_PUBLICADA = ORIGEN_PUBLICADO + '/app/';
async function servirAppEnDireccionPublicada(page) {
  const raiz = path.resolve(__dirname, '..', '..');
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('sin service worker en el test'));
  });
  await page.route(ORIGEN_PUBLICADO + '/**', r => {
    let ruta = new URL(r.request().url()).pathname.replace(/^\/app\/?/, '');
    if (ruta === '' || ruta.endsWith('/')) ruta += 'index.html';
    const archivo = path.join(raiz, ruta);
    if (!archivo.startsWith(raiz) || !fs.existsSync(archivo)) return r.fulfill({ status: 404, body: 'No encontrado' });
    return r.fulfill({ path: archivo });
  });
}

module.exports = { abrirApp, abrirAppNinera, irAModulo, esperarQuieta, verificarLimpio, REF_PROD, USUARIO_NINERA, servirAppEnDireccionPublicada, APP_PUBLICADA, ORIGEN_PUBLICADO };
