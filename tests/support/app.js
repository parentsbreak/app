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
const { rpcNinera } = require('./rpc-ninera');

const REF_PROD = 'wvewzamdohrpfhpccvcz';

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
function resolverEmbebidos(filas, tabla, select, db) {
  const embs = embebidos(select);
  if (!embs.length) return filas;
  return filas.map(f => {
    const copia = { ...f };
    for (const emb of embs) {
      const hijos = db[emb] || [];
      const fk = Object.keys(f).find(k => k === singular(emb) + '_id' || k === emb.replace(/s$/, '') + '_id');
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
 *     terminos_aceptados_el, 20/10/2026), con los mismos errores que Supabase
 */
async function abrirApp(page, opciones = {}) {
  const { datos = {}, sesion = true, ahora = '2026-10-04T12:00:00-03:00', ruta = '/', baseSinMigrar = false } = opciones;
  const estado = crearEstado(datos);
  if (baseSinMigrar) (estado.db.familias || []).forEach(f => { delete f.terminos_aceptados_el; });
  await prepararPagina(page, estado, { usuario: USUARIO, claveSesion: `sb-${REF_PROD}-auth-token`, sesion, ahora, baseSinMigrar });

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
 *   funciones: Edge Functions simuladas por nombre desde el primer pedido (como estado.funciones,
 *     pero antes de navegar: con consulta, la app llama a la función apenas abre)
 *   instalada: true simula la app abierta desde la pantalla de inicio (display-mode: standalone
 *     y navigator.standalone del iPhone); false, abierta en el navegador
 */
async function abrirAppNinera(page, opciones = {}) {
  const { datos = {}, ninera = ID.nAna, sesion = true, ahora = '2026-10-04T12:00:00-03:00', ruta = '/ninera/', instalada = true, consulta = '', funciones = {} } = opciones;
  const estado = crearEstado(datos);
  Object.assign(estado.funciones, funciones);
  if (sesion) {
    const fila = (estado.db.ninieras || []).find(n => n.id === ninera);
    if (fila) fila.user_id = USUARIO_NINERA.id;
  }
  Object.assign(estado.rpc, rpcNinera(estado.db, ninera));
  // Clave propia de la sesión (storageKey 'sb-ninera-auth'): el panel y la app de niñeras nunca
  // comparten sesión en el mismo navegador.
  await prepararPagina(page, estado, { usuario: USUARIO_NINERA, claveSesion: 'sb-ninera-auth', sesion, ahora });

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
  return { escrituras: [], errores: [], noSimulados: [], db, demoraEscrituras: 0, demoraLecturas: 0, fallar: null, rpc: {}, funciones: {}, maxFilas: 1000 };
}

/**
 * Lo común a las dos puertas (panel y app de niñeras): reloj, CDNs, Realtime, el Supabase
 * simulado y la sesión. Cada puerta navega y espera lo suyo después.
 *   usuario: el que responden /auth/v1/user y /auth/v1/token
 *   claveSesion: dónde guarda supabase-js la sesión (la storageKey de cada puerta)
 */
async function prepararPagina(page, estado, { usuario, claveSesion, sesion, ahora, baseSinMigrar = false }) {
  const { db } = estado;
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
    for (const [topic, c] of canalesRT) {
      const ids = c.cambios.filter(x => x.table === tabla).map(x => x.id);
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
    if (url.pathname.startsWith('/storage/v1/') || url.pathname.startsWith('/functions/v1/')) {
      estado.escrituras.push({ tabla: url.pathname, metodo, params: url.search, cuerpo: req.postData() });
      // estado.funciones[nombre] = (cuerpo, req) => ({ status, json }) simula una Edge Function
      // por nombre; sin eso, la respuesta genérica de siempre.
      const funcion = url.pathname.startsWith('/functions/v1/') && estado.funciones[url.pathname.split('/')[3]];
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
      estado.escrituras.push({ tabla, metodo, cuerpo });
      // Con la base sin migrar, una función nueva no existe (mismo error que Supabase).
      if (baseSinMigrar) return route.fulfill({ status: 404, json: { code: 'PGRST202', message: `Could not find the function public.${tabla.slice(4)} in the schema cache` } });
      // estado.rpc[nombre] = (cuerpo, db) => resultado simula lo que hace la función en la base.
      const simular = estado.rpc[tabla.slice(4)];
      return route.fulfill({ json: simular ? simular(cuerpo, db) : [] });
    }
    if (baseSinMigrar && ['sittings_historial', 'finanzas_historial', 'ajustes_saldo', 'gastos_extra', 'variantes_precio', 'borradores'].includes(tabla)) {
      return route.fulfill({ status: 404, json: { code: 'PGRST205', message: `Could not find the table 'public.${tabla}' in the schema cache` } });
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
      let filas = ordenar(filtrar(db[tabla], params), url.searchParams.get('order'));
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
    estado.escrituras.push({ tabla, metodo, params: Object.fromEntries(params), cuerpo });
    let afectadas = [];
    if (metodo === 'POST') {
      const lista = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      const conflicto = url.searchParams.get('on_conflict');
      for (const fila of lista) {
        if (prefer.includes('merge-duplicates') && conflicto) {
          const claves = conflicto.split(',');
          const existente = db[tabla].find(f => claves.every(c => String(f[c]) === String(fila[c])));
          if (existente) { Object.assign(existente, fila); afectadas.push(existente); continue; }
        }
        const nueva = { id: nuevoId(), created_at: new Date().toISOString(), ...fila };
        db[tabla].push(nueva); afectadas.push(nueva);
      }
    } else if (metodo === 'PATCH') {
      afectadas = filtrar(db[tabla], params);
      afectadas.forEach(f => Object.assign(f, cuerpo));
    } else if (metodo === 'DELETE') {
      afectadas = filtrar(db[tabla], params);
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

module.exports = { abrirApp, abrirAppNinera, irAModulo, esperarQuieta, verificarLimpio, REF_PROD, USUARIO_NINERA };
