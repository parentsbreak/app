// App de niñeras (fase 1, 26/10/2026): la segunda puerta, en ninera/. Estos tests arrancan por el
// simulador (abrirAppNinera en tests/support/app.js): que la puerta abra con la sesión de una
// niñera guardada aparte de la del panel, que se pueda simular la app instalada o no, y que las
// Edge Functions y las RPC de la niñera se simulen por nombre. Abajo, los de la invitación, el
// login, instalar, los avisos y el inicio (tarea 1.5).
const { test, expect } = require('@playwright/test');
const { abrirApp, abrirAppNinera: abrirAppNineraSimulador, verificarLimpio, REF_PROD, USUARIO_NINERA } = require('./support/app');
const { ID, datosBase } = require('./support/datos');

// Etapa 2 (27/10/2026): Ana todavía no completó su perfil y al entrar le sale "Completa esto una
// sola vez". Estos tests miran la cuenta, los avisos y el inicio, así que entran con el perfil de
// Ana ya completo (con zona y la fecha en que lo guardó desde la app); la primera vez se prueba en
// ninera-perfil.spec.js.
function abrirAppNinera(page, opciones = {}) {
  const datos = datosBase();
  Object.assign(datos.ninieras.find(n => n.id === ID.nAna), { zona: 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00' });
  return abrirAppNineraSimulador(page, { datos, ...opciones });
}

const BASE = `https://${REF_PROD}.supabase.co`;

test.describe('puerta de niñeras: simulador', () => {
  test('abre /ninera/ con la sesión de la niñera bajo su propia clave', async ({ page }) => {
    const e = await abrirAppNinera(page);
    // Desde la tarea 1.5 la app arranca de verdad: entra con esa sesión (no muestra el login) y la
    // pantalla de carga se va. Antes se miraba solo que siguiera la pantalla de carga.
    await expect(page.locator('#pantalla-carga')).toHaveCount(0);
    await expect(page.locator('#login-celular')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/ninera/');
    const { niniera, panel } = await page.evaluate(ref => ({
      niniera: localStorage.getItem('sb-ninera-auth'),
      panel: localStorage.getItem(`sb-${ref}-auth-token`),
    }), REF_PROD);
    expect(panel).toBeNull();
    const sesion = JSON.parse(niniera);
    expect(sesion.user.id).toBe('00000000-0000-4000-8000-000000000002');
    expect(sesion.user.email).toBe('59900000001@ninieras.parentsbreak.invalid');
    // La niñera elegida (Ana por defecto) queda atada a esa cuenta; las otras, sin cuenta.
    expect(e.db.ninieras.find(n => n.id === ID.nAna).user_id).toBe(ID.uNinera);
    expect(e.db.ninieras.find(n => n.id === ID.nBruno).user_id).toBeNull();
    verificarLimpio(e);
  });

  test('simula la app instalada en la pantalla de inicio, o abierta en el navegador', async ({ page, browser }) => {
    const e = await abrirAppNinera(page);
    expect(await page.evaluate(() => [window.matchMedia('(display-mode: standalone)').matches, navigator.standalone])).toEqual([true, true]);
    verificarLimpio(e);

    const otra = await browser.newPage();
    const e2 = await abrirAppNinera(otra, { instalada: false });
    expect(await otra.evaluate(() => [window.matchMedia('(display-mode: standalone)').matches, navigator.standalone])).toEqual([false, false]);
    // El resto de las consultas de matchMedia siguen andando como siempre.
    expect(await otra.evaluate(() => typeof window.matchMedia('(max-width: 760px)').matches)).toBe('boolean');
    verificarLimpio(e2);
    await otra.close();
  });

  test('una Edge Function se simula por nombre y la llamada queda anotada', async ({ page }) => {
    const e = await abrirAppNinera(page);
    let recibido = null;
    e.funciones['ninera-cuenta'] = cuerpo => { recibido = cuerpo; return { status: 410, json: { error: 'vencido' } }; };
    const respuesta = await page.evaluate(async base => {
      const r = await fetch(base + '/functions/v1/ninera-cuenta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'canjear', token: 'b'.repeat(64) }),
      });
      return { status: r.status, cuerpo: await r.json() };
    }, BASE);
    expect(respuesta).toEqual({ status: 410, cuerpo: { error: 'vencido' } });
    expect(recibido).toEqual({ accion: 'canjear', token: 'b'.repeat(64) });
    expect(e.escrituras.filter(w => w.tabla === '/functions/v1/ninera-cuenta')).toHaveLength(1);
    verificarLimpio(e, { ignorar: [/status of 410/] }); // Chromium anota en consola toda respuesta 4xx
  });

  test('las RPC de la niñera vienen simuladas y un test las puede pisar', async ({ page }) => {
    const e = await abrirAppNinera(page, { ninera: ID.nCarla });
    const pedir = () => page.evaluate(async base => {
      const r = await fetch(base + '/rest/v1/rpc/ninera_actual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      return r.json();
    }, BASE);
    expect(await pedir()).toBe(ID.nCarla);
    e.rpc.ninera_actual = () => null;
    expect(await pedir()).toBeNull();
    verificarLimpio(e);
  });
});

/* ============================================================
   Tarea 1.5 (26/10/2026): invitación, login con el celular, instalar, avisos e inicio vacío.
   ============================================================ */
const TOKEN = 'c'.repeat(64);
const EMAIL_LOGIN = '59899000001@ninieras.parentsbreak.invalid';
const AVISOS_APAGADOS = 'Avisos apagados. No te van a llegar los pedidos. Actívalos en Ajustes.';
// Chromium anota en consola toda respuesta 4xx/5xx simulada y todo pedido cortado.
const RUIDO_4XX = /status of 4\d\d/;
const RUIDO_RED = /Failed to load resource|ERR_FAILED|Failed to fetch/;

// En Chromium headless no hay servicio de push: se reemplazan el permiso y el registro del service
// worker por unos de mentira. permiso: lo que responde requestPermission; suscripta: el registro ya
// tiene una suscripción (y su endpoint quedó guardado en la base desde este celular). bloqueado: el
// permiso ya está en 'denied' al abrir (Notification.permission), como un celular donde lo bloqueó antes.
async function fingirAvisos(page, { permiso = 'granted', suscripta = false, bloqueado = false } = {}) {
  await page.addInitScript(({ permiso, suscripta, bloqueado, uid }) => {
    const suscripcion = {
      endpoint: 'https://push.ejemplo.test/suscripcion-1',
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'clave-p256dh-ficticia', auth: 'clave-auth-ficticia' } }; },
      async unsubscribe() { window.__desuscripciones++; actual = null; return true; },
    };
    window.__desuscripciones = 0;
    let actual = suscripta ? suscripcion : null;
    let permisoActual = bloqueado ? 'denied' : (suscripta ? 'granted' : 'default');
    // La marca que deja la app al guardar la suscripción: la cuenta y el endpoint.
    if (suscripta) localStorage.setItem('pb-ninera-push-guardado', `${uid}|${suscripcion.endpoint}`);
    window.__pedidosDePermiso = 0;
    const registro = {
      scope: new URL('/ninera/', location.href).href,
      active: { state: 'activated' },
      pushManager: {
        getSubscription: async () => actual,
        subscribe: async opciones => {
          window.__suscripcionPedida = { userVisibleOnly: opciones.userVisibleOnly, largoClave: opciones.applicationServerKey.length };
          actual = suscripcion;
          return actual;
        },
      },
    };
    navigator.serviceWorker.register = async () => registro;
    navigator.serviceWorker.getRegistration = async () => registro;
    Object.defineProperty(Notification, 'permission', { get: () => permisoActual, configurable: true });
    Notification.requestPermission = async () => { window.__pedidosDePermiso++; permisoActual = permiso; return permiso; };
  }, { permiso, suscripta, bloqueado, uid: USUARIO_NINERA.id });
}

// Pasa la pantalla obligatoria de avisos como lo haría quien no puede activarlos: toca "Activar avisos",
// que falla (sin conexión; con el permiso bloqueado van los pasos), y recién ahí aparece "Seguir sin
// avisos". El ruido de consola de esa falla simulada se descarta.
async function omitirAvisos(page, e) {
  const previa = e.fallar;
  e.fallar = () => 'red';
  await page.getByRole('button', { name: 'Activar avisos' }).click();
  const link = page.getByRole('button', { name: 'Seguir sin avisos' });
  await expect(link).toBeVisible();
  e.fallar = previa;
  for (let i = e.errores.length - 1; i >= 0; i--) if (RUIDO_RED.test(e.errores[i]) || /\[avisos\]/.test(e.errores[i])) e.errores.splice(i, 1);
  await link.click();
}

// Abre la app de niñeras con los avisos ya activos (lo normal en los tests que miran otra cosa).
async function abrir(page, opciones = {}, avisos = { suscripta: true }) {
  await fingirAvisos(page, avisos);
  return abrirAppNinera(page, opciones);
}

function llamadasFuncion(e) {
  return e.escrituras.filter(w => w.tabla === '/functions/v1/ninera-cuenta').map(w => JSON.parse(w.cuerpo));
}
function loginsPedidos(e) {
  return e.escrituras.filter(w => w.tabla === '/auth/v1/token' && /grant_type=password/.test(w.params || ''));
}
function rpcLlamadas(e) {
  return e.escrituras.filter(w => w.tabla.startsWith('rpc/')).map(w => w.tabla.slice(4));
}
// La secuencia que sigue al inicio, sin la lectura de la tarjeta de la temporada (etapa 9, 31/10/2026):
// llega sin frenar nada y se prueba en tests/ninera-temporada.spec.js; acá contaría de más según cuándo llegue.
function rpcSecuencia(e) {
  return rpcLlamadas(e).filter(n => n !== 'ninera_mi_temporada');
}
// Los próximos sittings del inicio (etapa 2, 27/10/2026) se piden sin frenar lo de arriba: antes de
// contar las RPC, que hayan llegado.
async function esperarSittings(page) {
  await expect(page.locator('#proximos-sittings-lista')).not.toContainText('Cargando');
}
// La función simulada: bienvenida sin contraseña, cuenta creada con contraseña.
function funcionInvitacionOk(e, { nombre = 'Ana' } = {}) {
  e.funciones['ninera-cuenta'] = cuerpo => (cuerpo.password === undefined
    ? { json: { nombre, celular_mascarado: '••• 001', es_reset: false } }
    : { json: { celular: '59900000001' } });
}
// Abre la app sin sesión, deja que el test simule la función y recién ahí abre el link.
async function abrirInvitacion(page, preparar, { avisos = { suscripta: true }, ...opciones } = {}) {
  const e = await abrir(page, { sesion: false, ...opciones }, avisos);
  preparar(e);
  await page.goto(`/ninera/?i=${TOKEN}`);
  return e;
}

test.describe('celular normalizado (la misma regla que la base y la Edge Function)', () => {
  test('los 11 casos dan lo mismo que en SQL y en Deno, y el mail sintético usa el dominio de la base', async ({ page }) => {
    const e = await abrir(page, { sesion: false });
    const casos = ['+598 99 123 456', '099123456', '99123456', '099-123-456', '59899123456', '00598 99 123 456', '+598 099 123 456', '123', '+54 11 5555 5555', '', null];
    const resultado = await page.evaluate(casos => casos.map(c => normalizarCelular(c)), casos);
    expect(resultado).toEqual([...Array(7).fill('59899123456'), null, null, null, null]);
    expect(await page.evaluate(() => [MAIL_DOMINIO_NINERA, mailSinteticoNinera('59899123456'), mailSinteticoNinera(null)]))
      .toEqual(['ninieras.parentsbreak.invalid', '59899123456@ninieras.parentsbreak.invalid', null]);
    verificarLimpio(e);
  });
});

test.describe('invitación: crear la contraseña desde el link', () => {
  test('link válido: bienvenida, contraseña corta o distinta, y al crearla entra sola hasta el inicio', async ({ page }) => {
    const e = await abrirInvitacion(page, funcionInvitacionOk);
    await expect(page.locator('#app')).toContainText("Te invitamos a Parents' Break");
    await expect(page.locator('#app')).toContainText('Ana, desde ahora los pedidos te llegarán por aquí en vez de por WhatsApp.');
    await expect(page.locator('#app')).toContainText('Crea una contraseña');
    expect(new URL(page.url()).hash).toBe('#invitacion');
    // La primera llamada pide solo la bienvenida.
    expect(llamadasFuncion(e)).toEqual([{ token: TOKEN }]);

    await page.fill('#inv-pass', '1234567');
    await page.fill('#inv-pass2', '1234567');
    await page.click('#inv-btn');
    await expect(page.locator('#inv-error')).toHaveText('Mínimo 8 letras o números.');
    await page.fill('#inv-pass', '        ');
    await page.fill('#inv-pass2', '        ');
    await page.click('#inv-btn');
    await expect(page.locator('#inv-error')).toHaveText('Mínimo 8 letras o números.');
    await page.fill('#inv-pass', 'clave-ficticia-1');
    await page.fill('#inv-pass2', 'clave-ficticia-2');
    await page.click('#inv-btn');
    await expect(page.locator('#inv-error')).toHaveText('Las contraseñas no coinciden.');
    expect(llamadasFuncion(e)).toHaveLength(1); // nada de eso llegó a la función

    await page.fill('#inv-pass2', 'clave-ficticia-1');
    await page.click('#inv-btn');
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.locator('h1')).toHaveText('Hola, Ana');
    expect(llamadasFuncion(e)).toEqual([{ token: TOKEN }, { token: TOKEN, password: 'clave-ficticia-1' }]);
    // Entra con el mail sintético del celular que devolvió la función.
    expect(loginsPedidos(e).map(w => w.cuerpo.email)).toEqual(['59900000001@ninieras.parentsbreak.invalid']);
    expect(loginsPedidos(e)[0].cuerpo.password).toBe('clave-ficticia-1');
    // El link ya no queda en la URL, y la sesión se guarda solo bajo la clave de la niñera.
    const url = new URL(page.url());
    expect(url.search).toBe('');
    expect(url.hash).toBe('#inicio');
    expect(await page.evaluate(() => [!!localStorage.getItem('sb-ninera-auth'), localStorage.getItem('sb-wvewzamdohrpfhpccvcz-auth-token')])).toEqual([true, null]);
    // Etapa 2 (27/10/2026): antes del inicio lee el perfil (si no lo completó, va a completarlo) y
    // el inicio pide sus próximos sittings.
    await esperarSittings(page);
    expect(rpcSecuencia(e)).toEqual(['ninera_actual', 'ninera_activar_app', 'ninera_mi_perfil', 'ninera_mis_pedidos', 'ninera_mis_sittings']);
    // Al volver a abrir la app, el nombre sigue (viene en la cuenta, user_metadata).
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Hola, Ana');
    verificarLimpio(e);
  });

  test('la función se llama con la clave publicable y el doble toque crea una sola cuenta', async ({ page }) => {
    const cabeceras = [];
    const e = await abrirInvitacion(page, e => {
      e.funciones['ninera-cuenta'] = async (cuerpo, req) => {
        cabeceras.push(req.headers()['apikey']);
        if (cuerpo.password === undefined) return { json: { nombre: 'Ana', celular_mascarado: '••• 001', es_reset: false } };
        await new Promise(r => setTimeout(r, 400));
        return { json: { celular: '59900000001' } };
      };
    });
    await page.fill('#inv-pass', 'clave-ficticia-1');
    await page.fill('#inv-pass2', 'clave-ficticia-1');
    await page.locator('#inv-btn').dblclick();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(llamadasFuncion(e).filter(c => c.password)).toHaveLength(1);
    expect(loginsPedidos(e)).toHaveLength(1);
    expect(cabeceras.length).toBeGreaterThan(0);
    expect(cabeceras.every(c => c && c.startsWith('sb_publishable_'))).toBe(true);
    verificarLimpio(e);
  });

  test('cada respuesta de error de la función tiene su pantalla, sin pantalla en blanco', async ({ page }) => {
    const e = await abrirInvitacion(page, funcionInvitacionOk);
    const casos = [
      [410, { error: 'vencido' }, 'Este link venció. Solicítale uno nuevo al equipo por WhatsApp.'],
      [404, { error: 'no_existe' }, 'Este link no es válido. Pídele uno nuevo al equipo por WhatsApp.'],
      [400, { error: 'token' }, 'Este link no es válido. Pídele uno nuevo al equipo por WhatsApp.'],
      [403, { error: 'inactiva' }, 'Tu cuenta no está activa. Escríbenos por WhatsApp.'],
      [409, { error: 'celular_invalido' }, 'Tu número de celular no es válido. Avísale al equipo para corregirlo.'],
      // Error interno (26/10/2026): el texto de la función, que no nombra a nadie; sin texto, el mismo.
      [500, { error: "No pudimos crear tu cuenta. Avisa al equipo de Parents' Break." }, "No pudimos crear tu cuenta. Avisa al equipo de Parents' Break."],
      [502, {}, "No pudimos crear tu cuenta. Avisa al equipo de Parents' Break."],
    ];
    for (const [status, json, texto] of casos) {
      e.funciones['ninera-cuenta'] = () => ({ status, json });
      await page.reload();
      await expect(page.locator('#app')).toContainText(texto);
      await expect(page.locator('#inv-pass')).toHaveCount(0);
    }
    // El error del servidor deja reintentar.
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    await expect(page.locator('#app')).not.toContainText('Diego');
    // Sin conexión: el aviso de la conexión, también con Reintentar.
    await page.route(/functions\/v1\/ninera-cuenta/, r => r.abort('failed'));
    await page.reload();
    await expect(page.locator('#app')).toContainText('No pudimos crear tu cuenta. Revisa tu conexión a internet y vuelve a intentar.');
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    // Desde un link que ya no sirve se puede ir a entrar con el celular (quien ya creó su cuenta).
    await page.unroute(/functions\/v1\/ninera-cuenta/);
    e.funciones['ninera-cuenta'] = () => ({ status: 410, json: { error: 'vencido' } });
    await page.reload();
    await page.getByRole('button', { name: 'Entrar con mi celular' }).click();
    await expect(page.locator('#login-celular')).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    verificarLimpio(e, { ignorar: [/status of (4\d\d|50\d)/, RUIDO_RED] });
  });

  test('si la función falla al crear la cuenta, el formulario avisa y deja reintentar sin perder nada', async ({ page }) => {
    const e = await abrirInvitacion(page, e => {
      e.funciones['ninera-cuenta'] = cuerpo => (cuerpo.password === undefined
        ? { json: { nombre: 'Ana', celular_mascarado: '••• 001', es_reset: false } }
        : { status: 500, json: { error: "No pudimos crear tu cuenta. Avisa al equipo de Parents' Break." } });
    });
    await page.fill('#inv-pass', 'clave-ficticia-1');
    await page.fill('#inv-pass2', 'clave-ficticia-1');
    await page.click('#inv-btn');
    // Error interno (26/10/2026): el texto de la función, no el de la conexión.
    await expect(page.locator('#inv-error')).toHaveText("No pudimos crear tu cuenta. Avisa al equipo de Parents' Break.");
    await expect(page.locator('#inv-pass')).toHaveValue('clave-ficticia-1');
    await expect(page.locator('#inv-btn')).toBeEnabled();
    expect(loginsPedidos(e)).toHaveLength(0);
    // Sin conexión: el aviso de la conexión, también sin perder nada.
    await page.route(/functions\/v1\/ninera-cuenta/, r => r.abort('failed'));
    await page.click('#inv-btn');
    await expect(page.locator('#inv-error')).toHaveText('No pudimos crear tu cuenta. Revisa tu conexión a internet y vuelve a intentar.');
    await page.unroute(/functions\/v1\/ninera-cuenta/);
    // El servidor dice que es corta: el aviso del mínimo.
    e.funciones['ninera-cuenta'] = () => ({ status: 400, json: { error: 'password_corta' } });
    await page.click('#inv-btn');
    await expect(page.locator('#inv-error')).toHaveText('Mínimo 8 letras o números.');
    funcionInvitacionOk(e);
    await page.click('#inv-btn');
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    verificarLimpio(e, { ignorar: [/status of (4\d\d|500)/, RUIDO_RED] });
  });

  test('cuenta creada pero el login falla: pasa al login con el aviso, sin éxito falso', async ({ page }) => {
    const e = await abrirInvitacion(page, funcionInvitacionOk);
    await page.fill('#inv-pass', 'clave-ficticia-1');
    await page.fill('#inv-pass2', 'clave-ficticia-1');
    e.fallar = p => (p.tabla === '/auth/v1/token' ? 'red' : undefined);
    await page.click('#inv-btn');
    await expect(page.locator('#login-error')).toHaveText('No pudimos entrar. Revisa tu conexión a internet y vuelve a intentar.');
    await expect(page.locator('#app')).not.toContainText('No tienes pedidos');
    expect(new URL(page.url()).search).toBe('');
    verificarLimpio(e, { ignorar: [RUIDO_RED] });
  });

  test('un nombre con HTML se muestra como texto', async ({ page }) => {
    const e = await abrirInvitacion(page, e => funcionInvitacionOk(e, { nombre: '<img src=x onerror="window.__xss=1">' }));
    await expect(page.locator('#app')).toContainText('<img src=x onerror="window.__xss=1">, desde ahora');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('#app img[src="x"]')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('link para cambiar la contraseña (es_reset): otro título y otro texto, y entra igual', async ({ page }) => {
    const e = await abrirInvitacion(page, e => {
      e.funciones['ninera-cuenta'] = cuerpo => (cuerpo.password === undefined
        ? { json: { nombre: 'Ana', celular_mascarado: '••• 001', es_reset: true } }
        : { json: { celular: '59900000001' } });
    });
    await expect(page.locator('h1')).toHaveText('Crea una contraseña nueva');
    await expect(page.locator('#app')).toContainText("Ana, con esta contraseña vas a entrar a la app de Parents' Break.");
    await expect(page.locator('#app')).not.toContainText('Te invitamos');
    await expect(page.locator('#inv-btn')).toHaveText('Guardar contraseña');
    await page.fill('#inv-pass', 'clave-ficticia-9');
    await page.fill('#inv-pass2', 'clave-ficticia-9');
    await page.click('#inv-btn');
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(llamadasFuncion(e)).toEqual([{ token: TOKEN }, { token: TOKEN, password: 'clave-ficticia-9' }]);
    verificarLimpio(e);
  });
});

test.describe('login con el celular', () => {
  test('cualquier forma de escribir el celular entra con el mismo mail; cerrar sesión vuelve al login', async ({ page }) => {
    const e = await abrir(page, { sesion: false });
    await expect(page.locator('#login-celular')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#login');
    for (const [i, celular] of ['+598 99 000 001', '099000001', '99 000 001'].entries()) {
      await page.fill('#login-celular', celular);
      await page.fill('#login-pass', 'clave-ficticia-1');
      await page.click('#login-btn');
      // Cerrar sesión desuscribe este celular (30/10/2026): al volver a entrar, los avisos están
      // apagados y se la ofrece cada vez (los avisos son obligatorios, etapa 9; cerrar sesión borra el "Seguir
      // sin avisos"). La primera entra directo: la suscripción de partida está activa.
      if (i >= 1) {
        await expect(page.locator('h1')).toHaveText('Activa los avisos');
        await omitirAvisos(page, e);
      }
      await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
      // El nombre viene en la cuenta: saluda también después de un login sin invitación.
      await expect(page.locator('h1')).toHaveText('Hola, Ana');
      await page.getByRole('button', { name: 'Mi cuenta' }).click();
      await page.locator('#modal-ninera').getByRole('button', { name: 'Cerrar sesión' }).click();
      await expect(page.locator('#login-celular')).toBeVisible();
      await expect(page.locator('#modal-ninera')).toHaveCount(0);
    }
    expect(loginsPedidos(e).map(w => w.cuerpo.email)).toEqual([EMAIL_LOGIN, EMAIL_LOGIN, EMAIL_LOGIN]);
    // signOut con scope local: solo este celular.
    const salidas = e.escrituras.filter(w => w.tabla === '/auth/v1/logout');
    expect(salidas).toHaveLength(3);
    expect(salidas.every(w => /scope=local/.test(w.params))).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('sb-ninera-auth'))).toBeNull();
    verificarLimpio(e);
  });

  test('celular que no es uruguayo, contraseña mal y sin conexión: aviso claro y sigue en el login', async ({ page }) => {
    const e = await abrir(page, { sesion: false });
    await page.fill('#login-celular', '+54 11 5555 5555');
    await page.fill('#login-pass', 'clave-ficticia-1');
    await page.click('#login-btn');
    await expect(page.locator('#login-error')).toHaveText('Revisa el número de celular');
    expect(loginsPedidos(e)).toHaveLength(0);

    await page.fill('#login-celular', '099000001');
    e.fallar = p => (p.tabla === '/auth/v1/token' ? { status: 400, message: 'Invalid login credentials' } : undefined);
    await page.click('#login-btn');
    await expect(page.locator('#login-error')).toHaveText('El celular o la contraseña no son correctos');
    await expect(page.locator('#login-btn')).toBeEnabled();
    await expect(page.locator('#login-btn')).toHaveText('Entrar');

    // Muchos intentos seguidos (Supabase responde 429): no es la contraseña.
    e.fallar = p => (p.tabla === '/auth/v1/token' ? { status: 429, message: 'rate limit' } : undefined);
    await page.click('#login-btn');
    await expect(page.locator('#login-error')).toHaveText('Demasiados intentos. Espera un minuto y vuelve a intentar.');
    await expect(page.locator('#login-btn')).toBeEnabled();

    e.fallar = () => 'red';
    await page.locator('#login-pass').press('Enter');
    await expect(page.locator('#login-error')).toHaveText('No pudimos entrar. Revisa tu conexión a internet y vuelve a intentar.');
    await expect(page.locator('#app')).not.toContainText('No tienes pedidos');
    // Lo escrito queda.
    await expect(page.locator('#login-celular')).toHaveValue('099000001');

    e.fallar = null;
    await page.click('#login-btn');
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    verificarLimpio(e, { ignorar: [RUIDO_4XX, RUIDO_RED] });
  });

  test('doble toque en Entrar: un solo login', async ({ page }) => {
    const e = await abrir(page, { sesion: false });
    await page.route(/auth\/v1\/token/, async r => { await new Promise(res => setTimeout(res, 400)); return r.fallback(); });
    await page.fill('#login-celular', '099000001');
    await page.fill('#login-pass', 'clave-ficticia-1');
    await page.locator('#login-btn').dblclick();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(loginsPedidos(e)).toHaveLength(1);
    verificarLimpio(e);
  });

  test('"¿Olvidaste tu contraseña?" dice cómo pedir un link nuevo', async ({ page }) => {
    const e = await abrir(page, { sesion: false });
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
    await expect(page.locator('#login-olvide')).toHaveText('Pídele un link nuevo al equipo por WhatsApp.');
    expect(e.escrituras).toEqual([]);
    verificarLimpio(e);
  });
});

test.describe('instalar la app', () => {
  test('abierta en el navegador: los 4 pasos y la nota de Android; "Ya la instalé" sigue al inicio', async ({ page }) => {
    const e = await abrir(page, { instalada: false });
    await expect(page.locator('#app')).toContainText('Instala la app para recibir los pedidos');
    expect(new URL(page.url()).hash).toBe('#instalar');
    await expect(page.locator('ol.pasos li')).toHaveText([
      'Abre este link en Safari o en tu navegador.',
      'Toca Compartir.',
      'Agregar a pantalla de inicio.',
      "Abre Parents' Break desde el ícono.",
    ]);
    await expect(page.locator('#app')).toContainText('Con Android alcanza con tocar "Instalar" cuando aparezca.');
    // La app instalada del iPhone no comparte la sesión con Safari: hay que volver a entrar.
    await expect(page.locator('#app')).toContainText('Después de instalarla, entra con tu celular y la contraseña que creaste.');
    // ninera_activar_app ya corrió antes de esta pantalla.
    expect(rpcLlamadas(e)).toEqual(['ninera_actual', 'ninera_activar_app']);
    await page.getByRole('button', { name: 'Ya la instalé' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    verificarLimpio(e);
  });

  test('en el navegador del iPhone (sin avisos): el inicio pide instalarla en vez de "Avisos apagados"', async ({ page }) => {
    // Safari sin instalar no tiene PushManager.
    await page.addInitScript(() => { delete window.PushManager; });
    const e = await abrir(page, { instalada: false });
    await page.getByRole('button', { name: 'Ya la instalé' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.locator('#inicio-avisos')).toContainText('Instala la app para recibir los pedidos.');
    await expect(page.locator('#app')).not.toContainText('Avisos apagados');
    await page.locator('#inicio-avisos').getByRole('button', { name: 'Ver cómo' }).click();
    await expect(page.locator('ol.pasos')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#instalar');
    verificarLimpio(e);
  });

  test('"Copiar el link" copia la dirección de la app; si el portapapeles no anda, la muestra para copiar a mano', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const e = await abrir(page, { instalada: false });
    await page.getByRole('button', { name: 'Copiar el link' }).click();
    await expect(page.locator('.toaststack')).toContainText('Link copiado.');
    const base = new URL('/ninera/', page.url()).href;
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(base);

    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('sin permiso')); });
    await page.getByRole('button', { name: 'Copiar el link' }).click();
    const modal = page.locator('#modal-ninera');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Cópialo de aquí');
    await expect(modal.locator('#copiar-a-mano')).toHaveValue(base);
    await modal.getByRole('button', { name: 'Cerrar' }).click();
    await expect(modal).toHaveCount(0);
    verificarLimpio(e);
  });
});

test.describe('avisos', () => {
  test('permiso concedido: se suscribe y guarda la suscripción con su user_id; no vuelve a preguntar', async ({ page }) => {
    const e = await abrir(page, {}, { permiso: 'granted', suscripta: false });
    await expect(page.locator('h1')).toHaveText('Activa los avisos');
    await expect(page.locator('#app')).toContainText('Te avisaremos cuando haya un pedido, cuando quedes seleccionada y antes de tu sitting. Sin avisos te vas a perder pedidos.');
    expect(new URL(page.url()).hash).toBe('#avisos');
    await page.getByRole('button', { name: 'Activar avisos' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.locator('#app')).not.toContainText('Avisos apagados');
    const guardadas = e.escrituras.filter(w => w.tabla === 'push_subscriptions');
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0].metodo).toBe('POST');
    expect(guardadas[0].params.on_conflict).toBe('endpoint');
    expect(guardadas[0].cuerpo).toEqual({
      usuario: '59900000001@ninieras.parentsbreak.invalid',
      endpoint: 'https://push.ejemplo.test/suscripcion-1',
      p256dh: 'clave-p256dh-ficticia',
      auth_key: 'clave-auth-ficticia',
      user_id: '00000000-0000-4000-8000-000000000002',
    });
    expect(await page.evaluate(() => window.__suscripcionPedida)).toEqual({ userVisibleOnly: true, largoClave: 65 });
    // Ya no se guarda ninguna marca de "avisos vistos" (etapa 9, 31/10/2026).
    expect(await page.evaluate(() => localStorage.getItem('pb-ninera-avisos-vistos'))).toBeNull();
    verificarLimpio(e);
  });

  test('permiso denegado: sale directo con los pasos de Ajustes, sin pedir el permiso; "Seguir sin avisos" lleva al inicio', async ({ page }) => {
    const e = await abrir(page, {}, { permiso: 'denied', suscripta: false, bloqueado: true });
    await expect(page.locator('h1')).toHaveText('Los avisos están bloqueados');
    expect(await page.evaluate(() => window.__pedidosDePermiso)).toBe(0);
    expect(new URL(page.url()).hash).toBe('#avisos');
    await expect(page.locator('#app')).toContainText("iPhone: Ajustes > Notificaciones > Parents' Break > Permitir notificaciones.");
    await expect(page.locator('#app')).toContainText('Android: mantén apretado el ícono de la app > Información de la app > Notificaciones > actívalas.');
    await page.getByRole('button', { name: 'Seguir sin avisos' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.locator('#app')).toContainText(AVISOS_APAGADOS);
    expect(e.escrituras.filter(w => w.tabla === 'push_subscriptions')).toHaveLength(0);
    verificarLimpio(e);
  });

  test('"Activar avisos" con el permiso que queda bloqueado: pasos; "Ya los activé" se queda mientras siga bloqueado y sigue cuando se concede', async ({ page }) => {
    const e = await abrir(page, {}, { permiso: 'denied', suscripta: false });
    await page.getByRole('button', { name: 'Activar avisos' }).click();
    await expect(page.locator('h1')).toHaveText('Los avisos están bloqueados');
    expect(new URL(page.url()).hash).toBe('#avisos');
    await page.getByRole('button', { name: 'Ya los activé' }).click();
    await expect(page.locator('.toaststack')).toContainText('Los avisos siguen apagados. Actívalos en Ajustes.');
    await expect(page.locator('h1')).toHaveText('Los avisos están bloqueados');
    expect(e.escrituras.filter(w => w.tabla === 'push_subscriptions')).toHaveLength(0);
    // La niñera los activa en Ajustes: al volver, el permiso está concedido.
    await page.evaluate(() => {
      Notification.requestPermission = async () => {
        Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
        return 'granted';
      };
    });
    await page.getByRole('button', { name: 'Ya los activé' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.locator('#app')).not.toContainText('Avisos apagados');
    expect(e.escrituras.filter(w => w.tabla === 'push_subscriptions')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('sale cada vez que entra con los avisos apagados; con "Seguir sin avisos" no insiste hasta recargar', async ({ page }) => {
    const e = await abrir(page, {}, { permiso: 'granted', suscripta: false });
    await expect(page.locator('h1')).toHaveText('Activa los avisos');
    // Al aparecer, solo "Activar avisos": ni "Ahora no" ni una salida a la vista.
    await expect(page.getByRole('button', { name: 'Ahora no' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Seguir sin avisos' })).toHaveCount(0);
    await omitirAvisos(page, e);
    await expect(page.locator('#app')).toContainText(AVISOS_APAGADOS);
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Activa los avisos');
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Activa los avisos');
    expect(await page.evaluate(() => localStorage.getItem('pb-ninera-avisos-vistos'))).toBeNull();
    verificarLimpio(e);
  });

  test('"Seguir sin avisos" va al inicio con el aviso rojo, y con el permiso bloqueado su botón lleva a los pasos', async ({ page }) => {
    const e = await abrir(page, {}, { permiso: 'denied', suscripta: false });
    await omitirAvisos(page, e);
    await expect(page.locator('#app')).toContainText(AVISOS_APAGADOS);
    await page.evaluate(() => Object.defineProperty(Notification, 'permission', { get: () => 'denied', configurable: true }));
    const pedidos = await page.evaluate(() => window.__pedidosDePermiso);
    await page.locator('#inicio-avisos').getByRole('button', { name: 'Activar avisos' }).click();
    await expect(page.locator('h1')).toHaveText('Los avisos están bloqueados');
    expect(new URL(page.url()).hash).toBe('#avisos');
    expect(await page.evaluate(() => window.__pedidosDePermiso)).toBe(pedidos);
    verificarLimpio(e);
  });

  test('"Seguir sin avisos" no sobrevive al cerrar sesión: quien entra después ve la pantalla de avisos sin recargar', async ({ page }) => {
    const e = await abrir(page, {}, { permiso: 'granted', suscripta: false });
    await omitirAvisos(page, e);
    await expect(page.locator('#app')).toContainText(AVISOS_APAGADOS);
    await cerrarSesionDesdeMiCuenta(page);
    await expect(page.locator('#login-celular')).toBeVisible();
    await page.fill('#login-celular', '099000001');
    await page.fill('#login-pass', 'clave-ficticia-1');
    await page.click('#login-btn');
    await expect(page.locator('h1')).toHaveText('Activa los avisos');
    await expect(page.getByRole('button', { name: 'Seguir sin avisos' })).toHaveCount(0);
    verificarLimpio(e);
  });

  test('celular que no puede recibir avisos: sin pantalla de avisos', async ({ page }) => {
    await page.addInitScript(() => { delete window.PushManager; });
    const e = await abrir(page, {}, { permiso: 'default', suscripta: false });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.locator('#app')).not.toContainText('Activa los avisos');
    verificarLimpio(e);
  });

  test('si falla guardar la suscripción, se queda en la pantalla y "Seguir sin avisos" siempre sale (390 px)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    const e = await abrir(page, {}, { permiso: 'granted', suscripta: false });
    await expect(page.getByRole('button', { name: 'Seguir sin avisos' })).toHaveCount(0);
    e.fallar = () => 'red';
    await page.getByRole('button', { name: 'Activar avisos' }).click();
    await expect(page.locator('.toaststack')).toContainText('No pudimos activar los avisos.');
    await expect(page.locator('h1')).toHaveText('Activa los avisos');
    const link = page.getByRole('button', { name: 'Seguir sin avisos' });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    e.fallar = null;
    await link.click();
    await expect(page.locator('#app')).toContainText(AVISOS_APAGADOS);
    verificarLimpio(e, { ignorar: [RUIDO_RED, /\[avisos\]/] });
  });

  test('pantalla de pasos a 390 px: botón y link alcanzables, sin scroll horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    const e = await abrir(page, {}, { permiso: 'denied', suscripta: false });
    await page.getByRole('button', { name: 'Activar avisos' }).click();
    await expect(page.locator('h1')).toHaveText('Los avisos están bloqueados');
    for (const n of ['Ya los activé', 'Seguir sin avisos']) {
      const b = page.getByRole('button', { name: n });
      await b.scrollIntoViewIfNeeded();
      await expect(b).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    verificarLimpio(e);
  });

  test('"Seguir sin avisos" no pide el permiso, y desde el inicio se pueden activar', async ({ page }) => {
    const e = await abrir(page, {}, { permiso: 'granted', suscripta: false });
    await omitirAvisos(page, e);
    await expect(page.locator('#app')).toContainText(AVISOS_APAGADOS);
    expect(await page.evaluate(() => window.__pedidosDePermiso)).toBe(1); // el de "Activar avisos" de la pantalla
    await page.locator('#inicio-avisos').getByRole('button', { name: 'Activar avisos' }).click();
    await expect(page.locator('.toaststack')).toContainText('Avisos activados.');
    await expect(page.locator('#app')).not.toContainText('Avisos apagados');
    expect(e.escrituras.filter(w => w.tabla === 'push_subscriptions')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('si la base no guarda la suscripción: aviso de error y el inicio sigue diciendo que están apagados', async ({ page }) => {
    const e = await abrir(page, {}, { permiso: 'granted', suscripta: false });
    e.fallar = p => (p.tabla === 'push_subscriptions' ? { status: 500, message: 'falla simulada' } : undefined);
    await page.getByRole('button', { name: 'Activar avisos' }).click();
    await expect(page.locator('.toaststack')).toContainText('No pudimos activar los avisos. Revisa tu conexión a internet y vuelve a intentar.');
    await expect(page.locator('.toaststack')).not.toContainText('Avisos activados');
    // Se queda en la pantalla de avisos; sigue sin ellos y el inicio dice que están apagados.
    await expect(page.locator('h1')).toHaveText('Activa los avisos');
    await page.getByRole('button', { name: 'Seguir sin avisos' }).click();
    await expect(page.locator('#app')).toContainText(AVISOS_APAGADOS);
    // Sin conexión, igual.
    e.fallar = () => 'red';
    await page.locator('#inicio-avisos').getByRole('button', { name: 'Activar avisos' }).click();
    await expect(page.locator('#app')).toContainText(AVISOS_APAGADOS);
    // Vuelve la conexión: se guarda.
    e.fallar = null;
    await page.locator('#inicio-avisos').getByRole('button', { name: 'Activar avisos' }).click();
    await expect(page.locator('#app')).not.toContainText('Avisos apagados');
    verificarLimpio(e, { ignorar: [/status of 500/, RUIDO_RED, /\[avisos\]/] });
  });

  // Push al cerrar sesión (revisión final de la etapa 3, 30/10/2026): un celular compartido por dos
  // niñeras dejaba la fila con el user_id de la primera; la segunda no podía guardar la suya (la RLS
  // no deja pisar una fila ajena) y le salía un error de conexión. Al cerrar sesión se borra la fila
  // de este celular (por endpoint), se desuscribe y se borra la marca de avisos guardados.
  async function cerrarSesionDesdeMiCuenta(page) {
    await page.getByRole('button', { name: 'Mi cuenta' }).click();
    await page.locator('#modal-ninera').getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page.locator('#login-celular')).toBeVisible();
  }
  function borradosPush(e) {
    return e.escrituras.filter(w => w.tabla === 'push_subscriptions' && w.metodo === 'DELETE');
  }

  test('cerrar sesión borra la suscripción de este celular por endpoint y lo desuscribe', async ({ page }) => {
    const e = await abrir(page, {}, { suscripta: true });
    e.db.push_subscriptions.push(
      { id: 'sub-este', endpoint: 'https://push.ejemplo.test/suscripcion-1', user_id: '00000000-0000-4000-8000-000000000002' },
      { id: 'sub-otro', endpoint: 'https://push.ejemplo.test/otro-celular', user_id: '00000000-0000-4000-8000-000000000002' });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await cerrarSesionDesdeMiCuenta(page);
    const borrados = borradosPush(e);
    expect(borrados).toHaveLength(1);
    expect(borrados[0].params).toEqual({ endpoint: 'eq.https://push.ejemplo.test/suscripcion-1' });
    expect(e.db.push_subscriptions.map(f => f.id)).toEqual(['sub-otro']);
    expect(await page.evaluate(() => window.__desuscripciones)).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('pb-ninera-push-guardado'))).toBeNull();
    // Borra antes de cerrar la sesión: sin sesión, la RLS no la deja borrar su fila.
    const orden = e.escrituras.map(w => w.tabla).filter(t => t === 'push_subscriptions' || t === '/auth/v1/logout');
    expect(orden).toEqual(['push_subscriptions', '/auth/v1/logout']);
    expect(await page.evaluate(() => localStorage.getItem('sb-ninera-auth'))).toBeNull();
    verificarLimpio(e);
  });

  for (const [caso, falla] of [['la base falla', { status: 500, message: 'falla simulada' }], ['sin conexión', 'red']]) {
    test(`si borrar la suscripción no anda (${caso}), la sesión se cierra igual`, async ({ page }) => {
      const e = await abrir(page, {}, { suscripta: true });
      await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
      e.fallar = p => (p.tabla === 'push_subscriptions' ? falla : undefined);
      await cerrarSesionDesdeMiCuenta(page);
      expect(e.escrituras.filter(w => w.tabla === '/auth/v1/logout')).toHaveLength(1);
      expect(await page.evaluate(() => localStorage.getItem('sb-ninera-auth'))).toBeNull();
      // El celular se desuscribe igual: la fila que quedó vence sola (410) y enviar-avisos la borra.
      expect(await page.evaluate(() => window.__desuscripciones)).toBe(1);
      expect(await page.evaluate(() => localStorage.getItem('pb-ninera-push-guardado'))).toBeNull();
      verificarLimpio(e, { ignorar: [/status of 500/, RUIDO_RED, /\[cerrar sesión\]/] });
    });
  }

  test('sin suscripción en este celular, cerrar sesión no borra nada', async ({ page }) => {
    const e = await abrir(page, {}, { permiso: 'denied', suscripta: false });
    await omitirAvisos(page, e);
    await expect(page.locator('#app')).toContainText(AVISOS_APAGADOS);
    await cerrarSesionDesdeMiCuenta(page);
    expect(borradosPush(e)).toHaveLength(0);
    expect(await page.evaluate(() => window.__desuscripciones)).toBe(0);
    expect(e.escrituras.filter(w => w.tabla === '/auth/v1/logout')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('avisos que se apagaron después en Ajustes: el inicio lo dice', async ({ page }) => {
    const e = await abrir(page, {}, { suscripta: true });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.locator('#app')).not.toContainText('Avisos apagados');
    await page.evaluate(() => Object.defineProperty(Notification, 'permission', { get: () => 'denied', configurable: true }));
    await page.evaluate(() => renderInicio());
    await expect(page.locator('#app')).toContainText(AVISOS_APAGADOS);
    verificarLimpio(e);
  });
});

test.describe('arranque con sesión', () => {
  test('cuenta dada de baja (ninera_actual null): no está activa, cerrar sesión, sin activar la app', async ({ page }) => {
    await fingirAvisos(page, { suscripta: true });
    const e = await abrirAppNinera(page);
    e.rpc.ninera_actual = () => null;
    await page.evaluate(() => localStorage.removeItem('pb-ninera-app-activada'));
    await page.reload();
    await expect(page.locator('#app')).toContainText('Tu cuenta no está activa. Escríbenos por WhatsApp.');
    await expect(page.locator('#app')).not.toContainText('No tienes pedidos');
    const activadas = rpcLlamadas(e).filter(n => n === 'ninera_activar_app').length;
    expect(rpcLlamadas(e).slice(-1)).toEqual(['ninera_actual']);
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page.locator('#login-celular')).toBeVisible();
    expect(e.escrituras.filter(w => w.tabla === '/auth/v1/logout')).toHaveLength(1);
    expect(rpcLlamadas(e).filter(n => n === 'ninera_activar_app').length).toBe(activadas);
    verificarLimpio(e);
  });

  test('cuenta dada de baja después de un login: "Cerrar sesión" vuelve al login sin recargar', async ({ page }) => {
    // Antes la URL quedaba en #login y cerrar sesión no pintaba nada (revisión del 27/10/2026).
    const e = await abrir(page, { sesion: false });
    e.rpc.ninera_actual = () => null;
    await page.fill('#login-celular', '099000001');
    await page.fill('#login-pass', 'clave-ficticia-1');
    await page.click('#login-btn');
    await expect(page.locator('#app')).toContainText('Tu cuenta no está activa. Escríbenos por WhatsApp.');
    expect(new URL(page.url()).hash).toBe('#inactiva');
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page.locator('#login-celular')).toBeVisible();
    await expect(page.locator('#app')).not.toContainText('no está activa');
    expect(await page.evaluate(() => localStorage.getItem('sb-ninera-auth'))).toBeNull();
    expect(e.escrituras.filter(w => w.tabla === '/auth/v1/logout')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('el saludo usa el nombre de la cuenta al arrancar con la sesión guardada; escapado y sin nombre', async ({ page }) => {
    const e = await abrir(page);
    await expect(page.locator('h1')).toHaveText('Hola, Ana');
    // Un nombre con HTML se muestra como texto (se toca la sesión guardada: no hay red al arrancar).
    const cambiarNombre = nombre => page.evaluate(nombre => {
      const s = JSON.parse(localStorage.getItem('sb-ninera-auth'));
      if (nombre === null) delete s.user.user_metadata.nombre; else s.user.user_metadata.nombre = nombre;
      localStorage.setItem('sb-ninera-auth', JSON.stringify(s));
    }, nombre);
    await cambiarNombre('<img src=x onerror="window.__xss=1"> Ficticia');
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Hola, <img');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await cambiarNombre(null);
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Hola');
    verificarLimpio(e);
  });

  test('ninera_activar_app se llama al entrar, después de ninera_actual, una vez por celular', async ({ page }) => {
    const e = await abrir(page);
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await esperarSittings(page);
    expect(rpcSecuencia(e)).toEqual(['ninera_actual', 'ninera_activar_app', 'ninera_mi_perfil', 'ninera_mis_pedidos', 'ninera_mis_sittings']);
    await page.reload();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await esperarSittings(page);
    expect(rpcSecuencia(e)).toEqual(['ninera_actual', 'ninera_activar_app', 'ninera_mi_perfil', 'ninera_mis_pedidos', 'ninera_mis_sittings', 'ninera_actual', 'ninera_mi_perfil', 'ninera_mis_pedidos', 'ninera_mis_sittings']);
    verificarLimpio(e);
  });

  test('si ninera_activar_app falla, entra igual y lo intenta la próxima vez', async ({ page }) => {
    await fingirAvisos(page, { suscripta: true });
    const e = await abrirAppNinera(page, { sesion: false });
    // La ruta que falla va después de la del simulador (Playwright prueba primero la última).
    await page.route(/rpc\/ninera_activar_app/, r => r.fulfill({ status: 500, json: { message: 'falla simulada' } }));
    await page.fill('#login-celular', '099000001');
    await page.fill('#login-pass', 'clave-ficticia-1');
    await page.click('#login-btn');
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await esperarSittings(page);
    expect(rpcSecuencia(e)).toEqual(['ninera_actual', 'ninera_mi_perfil', 'ninera_mis_pedidos', 'ninera_mis_sittings']); // la que falló no llegó al simulador
    await page.unroute(/rpc\/ninera_activar_app/);
    await page.reload();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await esperarSittings(page);
    expect(rpcSecuencia(e)).toEqual(['ninera_actual', 'ninera_mi_perfil', 'ninera_mis_pedidos', 'ninera_mis_sittings', 'ninera_actual', 'ninera_activar_app', 'ninera_mi_perfil', 'ninera_mis_pedidos', 'ninera_mis_sittings']);
    verificarLimpio(e, { ignorar: [/status of 500/, /\[ninera_activar_app\]/] });
  });

  test('sin conexión o base sin migrar: "No pudimos cargar tus pedidos" y Reintentar', async ({ page }) => {
    await fingirAvisos(page, { suscripta: true });
    const e = await abrirAppNinera(page);
    await page.route(/rpc\/ninera_actual/, r => r.abort('failed'));
    await page.reload();
    const texto = 'No pudimos cargar tus pedidos. Revisa tu conexión a internet y vuelve a intentar.';
    await expect(page.locator('#app')).toContainText(texto);
    await page.unroute(/rpc\/ninera_actual/);
    await page.route(/rpc\/ninera_actual/, r => r.fulfill({ status: 404, json: { code: 'PGRST202', message: 'Could not find the function public.ninera_actual in the schema cache' } }));
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.locator('#app')).toContainText(texto);
    await page.unroute(/rpc\/ninera_actual/);
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    verificarLimpio(e, { ignorar: [RUIDO_RED, RUIDO_4XX, /\[ninera_actual\]/] });
  });

  test('la renovación del token no repinta; una sesión cerrada desde otro lado vuelve al login', async ({ page }) => {
    const e = await abrir(page);
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await page.evaluate(() => { document.querySelector('#app > *').dataset.marca = 'sigue'; });
    await page.evaluate(() => sbn.auth.refreshSession());
    await page.waitForTimeout(200);
    await expect(page.locator('#app > [data-marca="sigue"]')).toHaveCount(1);
    expect(e.escrituras.some(w => w.tabla === '/auth/v1/token' && /refresh_token/.test(w.params))).toBe(true);
    await page.evaluate(() => sbn.auth.signOut({ scope: 'local' }));
    await expect(page.locator('#login-celular')).toBeVisible();
    verificarLimpio(e);
  });
});

test.describe('inicio vacío, celular y textos', () => {
  test('inicio a 390 px y la invitación: capturas, sin scroll horizontal (390 y 1280)', async ({ page, browser }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrir(page, {}, { permiso: 'denied', suscripta: false });
    await omitirAvisos(page, e);
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.locator('#app')).toContainText(AVISOS_APAGADOS);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('ninera-inicio-390.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await page.screenshot({ path: testInfo.outputPath('ninera-inicio-1280.png'), animations: 'disabled' });
    verificarLimpio(e);

    const otra = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const e2 = await abrirInvitacion(otra, funcionInvitacionOk);
    await expect(otra.locator('#inv-pass')).toBeVisible();
    expect(await otra.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await otra.screenshot({ path: testInfo.outputPath('ninera-invitacion-390.png'), fullPage: true, animations: 'disabled' });
    verificarLimpio(e2);
    await otra.close();
  });

  test('ninguna pantalla ni archivo de la app de niñeras muestra montos', async ({ page }) => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'ninera', 'js');
    for (const archivo of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, archivo), 'utf8');
      expect(src, archivo).not.toMatch(/\$\s?\d/);
    }
    const e = await abrirInvitacion(page, funcionInvitacionOk, { instalada: false, avisos: { permiso: 'granted', suscripta: false } });
    const textos = [];
    const juntar = async () => textos.push(await page.locator('body').innerText());
    await expect(page.locator('#inv-pass')).toBeVisible();
    await juntar();
    await page.fill('#inv-pass', 'clave-ficticia-1');
    await page.fill('#inv-pass2', 'clave-ficticia-1');
    await page.click('#inv-btn');
    await expect(page.locator('ol.pasos')).toBeVisible();
    await juntar();
    await page.getByRole('button', { name: 'Ya la instalé' }).click();
    await expect(page.locator('#app')).toContainText('Activa los avisos');
    await juntar();
    await omitirAvisos(page, e);
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await juntar();
    await page.getByRole('button', { name: 'Mi cuenta' }).click();
    await expect(page.locator('#modal-ninera')).toBeVisible();
    await juntar();
    expect(textos).toHaveLength(5);
    for (const t of textos) expect(t).not.toMatch(/\$\s?\d/);
    verificarLimpio(e);
  });
});

// Una socia puede tener cuenta de admin y de niñera en el mismo navegador (tarea 1.6): cada puerta
// guarda su sesión bajo su propia clave y nunca entra con la de la otra, ni la borra.
test.describe('las dos puertas no comparten sesión', () => {
  const CLAVE_PANEL = `sb-${REF_PROD}-auth-token`;
  const sesiones = page => page.evaluate(clave => ({
    panel: localStorage.getItem(clave),
    niniera: localStorage.getItem('sb-ninera-auth'),
  }), CLAVE_PANEL);

  test('con la sesión del panel, /ninera/ pide el login de la niñera y deja la del panel intacta', async ({ page }) => {
    const e = await abrirApp(page);
    const antes = (await sesiones(page)).panel;
    expect(JSON.parse(antes).user.email).toBe('prueba@ejemplo.test'); // la admin ficticia de abrirApp

    await page.goto('/ninera/');
    await expect(page.locator('#login-celular')).toBeVisible();
    await expect(page.locator('#app')).not.toContainText('Hola,');
    const { panel, niniera } = await sesiones(page);
    expect(niniera).toBeNull();
    expect(panel).toBe(antes);
    // La puerta de la niñera no le preguntó nada a la base con la sesión de la admin.
    expect(rpcLlamadas(e)).toEqual([]);
    verificarLimpio(e);
  });

  test('con la sesión de la niñera, / pide el login del panel y deja la de la niñera intacta', async ({ page }) => {
    const e = await abrir(page); // con los avisos activos, entra directo al inicio
    await expect(page.locator('h1')).toHaveText('Hola, Ana');
    const antes = (await sesiones(page)).niniera;
    expect(JSON.parse(antes).user.id).toBe(USUARIO_NINERA.id);

    await page.goto('/');
    await expect(page.locator('#login-mail')).toBeVisible();
    await expect(page.locator('#modcontent')).toHaveCount(0);
    const { panel, niniera } = await sesiones(page);
    expect(panel).toBeNull();
    expect(niniera).toBe(antes);
    verificarLimpio(e);
  });

  test('el simulador abre sin sesión sin llamar a la base, y con consulta abre el link de invitación', async ({ page, browser }) => {
    const e = await abrirAppNinera(page, { sesion: false });
    await expect(page.locator('#login-celular')).toBeVisible();
    expect(rpcLlamadas(e)).toEqual([]);
    expect(await sesiones(page)).toEqual({ panel: null, niniera: null });
    verificarLimpio(e);

    const otra = await browser.newPage();
    let recibido = null;
    const e2 = await abrirAppNinera(otra, {
      sesion: false,
      consulta: '?i=' + 'a'.repeat(64),
      funciones: { 'ninera-cuenta': cuerpo => { recibido = cuerpo; return { json: { nombre: 'Ana', celular_mascarado: '••• 001', es_reset: false } }; } },
    });
    await expect(otra.locator('#app')).toContainText("Te invitamos a Parents' Break");
    await expect(otra.locator('#app')).toContainText('Crea una contraseña');
    expect(recibido).toEqual({ token: 'a'.repeat(64) });
    expect(llamadasFuncion(e2)).toEqual([{ token: 'a'.repeat(64) }]);
    verificarLimpio(e2);
    await otra.close();
  });
});
