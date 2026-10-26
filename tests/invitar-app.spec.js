// App de niñeras, fase 1 (26/10/2026): desde la ficha de la niñera el panel la invita a la app
// (link con token por WhatsApp, siempre con el OK de la admin: se copia o se abre WhatsApp, nunca
// se manda solo) y muestra en qué anda su cuenta. Y si una niñera entra al panel de admins con su
// cuenta, no queda en una pantalla vacía: el login le dice que entre por su app.
// Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { datosBase, ID } = require('./support/datos');

// El reloj de abrirApp está fijo en el 04/10/2026 a las 12:00 de Montevideo.
const AHORA_MS = new Date('2026-10-04T12:00:00-03:00').getTime();
const DIA = 24 * 3600 * 1000;
const enDias = n => new Date(AHORA_MS + n * DIA).toISOString();
const TOKEN = 'a'.repeat(64);
const USER_ANA = ID.uNinera;

const toasts = page => page.locator('.toaststack .toast');
const filaApp = page => page.locator('#vn-app');
const botonApp = page => page.locator('#vn-app button');
const modalInv = page => page.locator('#invitar-overlay');

function datos(cambios = {}) {
  const d = datosBase();
  Object.assign(d.ninieras.find(n => n.id === ID.nAna), cambios);
  return d;
}
async function abrirFichaAna(page, opciones = {}) {
  const e = await abrirApp(page, { datos: datos(), ...opciones });
  await irAModulo(page, 'ninieras');
  await page.evaluate(id => verNinera(id), ID.nAna);
  await expect(page.locator('#editmodal.show')).toBeVisible();
  return e;
}
const invitacionOk = (esReset = false) => () => [{ token: TOKEN, vence_en: enDias(7), es_reset: esReset }];
const llamadasInvitar = e => e.escrituras.filter(w => w.tabla === 'rpc/crear_invitacion_ninera');
async function espiarPortapapeles(page) {
  await page.evaluate(() => {
    window.__copiado = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async t => { window.__copiado.push(t); },
    } });
  });
}

test.describe('ficha de la niñera: fila "App" e "Invitar a la app"', () => {
  test('sin app: invita, arma el link y el mensaje, copia y abre WhatsApp', async ({ page }) => {
    const e = await abrirFichaAna(page);
    await expect(filaApp(page)).toContainText('Sin app');
    await expect(botonApp(page)).toHaveText('Invitar a la app');
    await expect(botonApp(page)).toBeEnabled();
    // Como la base: guarda la invitación (la fila "App" la lee después) y devuelve el token.
    e.rpc.crear_invitacion_ninera = (cuerpo, db) => {
      db.ninera_invitaciones.push({ id: '52000000-0000-4000-8000-000000000009', ninera_id: cuerpo.p_ninera_id, token: TOKEN, creada_por: null, creada_en: enDias(0), vence_en: enDias(7), usada_en: null, reemplazada_en: null });
      return invitacionOk()();
    };
    await botonApp(page).click();
    await expect(modalInv(page)).toBeVisible();
    await expect(modalInv(page).locator('h2')).toHaveText('Invitar a la app');
    const link = await page.evaluate(t => `${new URL('ninera/', location.href).href}?i=${t}`, TOKEN);
    expect(link).toMatch(new RegExp(`/ninera/\\?i=${TOKEN}$`));
    const esperado = `¡Hola Ana! Desde ahora los pedidos de Parents' Break te van a llegar por nuestra app. Haz click aquí para crear tu usuario y contraseña: ${link}. Vale por 7 días.`;
    await expect(modalInv(page).locator('#invitar-mensaje')).toHaveText(esperado);
    expect(llamadasInvitar(e)).toEqual([{ tabla: 'rpc/crear_invitacion_ninera', metodo: 'POST', cuerpo: { p_ninera_id: ID.nAna } }]);

    await espiarPortapapeles(page);
    await modalInv(page).locator('button', { hasText: 'Copiar mensaje' }).click();
    await expect(toasts(page).last()).toContainText('Mensaje copiado. Pegalo en WhatsApp.');
    expect(await page.evaluate(() => window.__copiado)).toEqual([esperado]);

    const wa = modalInv(page).locator('a', { hasText: 'Abrir WhatsApp' });
    await expect(wa).toHaveAttribute('href', `https://wa.me/59898000001?text=${encodeURIComponent(esperado)}`);
    await expect(wa).toHaveAttribute('target', '_blank');
    // La ficha sigue abajo y la fila "App" ya muestra la invitación nueva.
    await modalInv(page).locator('button', { hasText: 'Cerrar' }).click();
    await expect(modalInv(page)).toHaveCount(0);
    await expect(page.locator('#editmodal.show')).toBeVisible();
    await expect(filaApp(page)).toContainText('Invitada el 04/10, el link vence el 11/10');
    verificarLimpio(e);
  });

  test('sin un celular uruguayo válido: el botón queda deshabilitado y dice por qué', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ telefono: '123' }) });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => verNinera(id), ID.nAna);
    await expect(botonApp(page)).toBeDisabled();
    await expect(filaApp(page)).toContainText('Cargá un celular uruguayo válido para invitarla');
    expect(llamadasInvitar(e)).toEqual([]);
    verificarLimpio(e);
  });

  test('estadoAppNinera: los textos y cuándo se puede invitar', async ({ page }) => {
    const e = await abrirApp(page);
    const r = await page.evaluate(([ahora, dia]) => {
      const iso = n => new Date(ahora + n * dia).toISOString();
      const n = { activa: true, telefono: '098 000 001', user_id: null, app_activada_en: null };
      return {
        sin: estadoAppNinera(n, null, 0),
        vigente: estadoAppNinera(n, { creada_en: iso(-1), vence_en: iso(6), usada_en: null, reemplazada_en: null }, 0),
        vencida: estadoAppNinera(n, { creada_en: iso(-9), vence_en: iso(-2), usada_en: null, reemplazada_en: null }, 0),
        usada: estadoAppNinera(n, { creada_en: iso(-9), vence_en: iso(-2), usada_en: iso(-8), reemplazada_en: null }, 0),
        activa: estadoAppNinera({ ...n, user_id: 'u', app_activada_en: iso(-3) }, null, 2),
        inactiva: estadoAppNinera({ ...n, activa: false }, null, 0),
        sinCel: estadoAppNinera({ ...n, telefono: null }, null, 0),
        extranjero: estadoAppNinera({ ...n, telefono: '+54 11 5555 0000' }, null, 0),
      };
    }, [AHORA_MS, DIA]);
    expect(r.sin).toEqual({ texto: 'Sin app', puedeInvitar: true, motivo: '', esReset: false, linkVigente: false });
    expect(r.vigente).toMatchObject({ texto: 'Invitada el 03/10, el link vence el 10/10', linkVigente: true });
    expect(r.vencida.linkVigente).toBe(false);
    expect(r.vencida.texto).toBe('Link vencido el 02/10');
    expect(r.usada.texto).toBe('Sin app');
    expect(r.activa).toEqual({ texto: 'App activa desde 01/10 · avisos activados', puedeInvitar: true, motivo: '', esReset: true, linkVigente: false });
    expect(r.inactiva).toMatchObject({ puedeInvitar: false, motivo: 'Está inactiva' });
    expect(r.sinCel).toMatchObject({ puedeInvitar: false, motivo: 'Cargá un celular uruguayo válido para invitarla' });
    expect(r.extranjero).toMatchObject({ puedeInvitar: false });
    verificarLimpio(e);
  });

  test('con la app activa y sin avisos: "sin avisos" y el link para cambiar la contraseña', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ user_id: USER_ANA, app_activada_en: '2026-10-01T15:00:00Z' }) });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => verNinera(id), ID.nAna);
    await expect(filaApp(page)).toContainText('App activa desde 01/10 · sin avisos');
    await expect(botonApp(page)).toHaveText('Link para cambiar la contraseña');
    e.rpc.crear_invitacion_ninera = invitacionOk(true);
    await botonApp(page).click();
    await expect(modalInv(page).locator('h2')).toHaveText('Link para cambiar la contraseña');
    const mensaje = modalInv(page).locator('#invitar-mensaje');
    await expect(mensaje).toContainText('¡Hola Ana! Con este link puedes crear una contraseña nueva: ');
    await expect(mensaje).toContainText(`/ninera/?i=${TOKEN}. Vale por 7 días.`);
    verificarLimpio(e);
  });

  test('con la app activa y un dispositivo suscripto: "avisos activados"', async ({ page }) => {
    const d = datos({ user_id: USER_ANA, app_activada_en: '2026-10-01T15:00:00Z' });
    d.push_subscriptions = [{ id: '51000000-0000-4000-8000-000000000001', user_id: USER_ANA, endpoint: 'https://push.ejemplo.test/1' }];
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => verNinera(id), ID.nAna);
    await expect(filaApp(page)).toContainText('App activa desde 01/10 · avisos activados');
    verificarLimpio(e);
  });

  const INV = (n, cambios) => ({ id: `52000000-0000-4000-8000-00000000000${n}`, ninera_id: ID.nAna, token: String(n).repeat(64), creada_por: null, usada_en: null, reemplazada_en: null, ...cambios });

  test('invitación vigente: "Invitada el …, el link vence el …"', async ({ page }) => {
    const d = datos();
    d.ninera_invitaciones = [
      INV(1, { creada_en: enDias(-10), vence_en: enDias(-3), reemplazada_en: enDias(-1) }),
      INV(2, { creada_en: enDias(-1), vence_en: enDias(6) }),
    ];
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => verNinera(id), ID.nAna);
    await expect(filaApp(page)).toContainText('Invitada el 03/10, el link vence el 10/10');
    await expect(botonApp(page)).toHaveText('Invitar a la app');
    verificarLimpio(e);
  });

  test('con un link vigente, pregunta antes de crear otro (el anterior deja de servir)', async ({ page }) => {
    const d = datos();
    d.ninera_invitaciones = [INV(2, { creada_en: enDias(-1), vence_en: enDias(6) })];
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => verNinera(id), ID.nAna);
    await expect(filaApp(page)).toContainText('Invitada el 03/10');
    e.rpc.crear_invitacion_ninera = invitacionOk();
    // Cancelar: no se crea nada.
    await botonApp(page).click();
    await expect(page.locator('.confirmoverlay .confirmmsg')).toHaveText('Ya tiene un link vigente, que deja de servir si creás otro. ¿Crear otro?');
    await expect(page.locator('#confirm-si')).toHaveText('Crear otro link');
    await page.locator('#confirm-no').click();
    await expect(page.locator('.confirmoverlay .confirmmsg')).toHaveCount(0);
    await expect(botonApp(page)).toBeEnabled();
    expect(llamadasInvitar(e)).toEqual([]);
    await expect(modalInv(page)).toHaveCount(0);
    // "Crear otro link": una sola RPC y el modal con el mensaje.
    await botonApp(page).click();
    await page.locator('#confirm-si').click();
    await expect(modalInv(page)).toBeVisible();
    expect(llamadasInvitar(e)).toHaveLength(1);
    verificarLimpio(e);
  });

  test('"Vale por 1 día" y "Vale por 3 días": los días salen de cuándo vence', async ({ page }) => {
    const e = await abrirFichaAna(page);
    for (const [dias, texto] of [[1, 'Vale por 1 día.'], [3, 'Vale por 3 días.']]) {
      e.rpc.crear_invitacion_ninera = () => [{ token: TOKEN, vence_en: enDias(dias), es_reset: false }];
      await botonApp(page).click();
      await expect(modalInv(page).locator('#invitar-mensaje')).toContainText(`?i=${TOKEN}. ${texto}`);
      await modalInv(page).locator('button', { hasText: 'Cerrar' }).click();
      await expect(modalInv(page)).toHaveCount(0);
    }
    verificarLimpio(e);
  });

  test('invitación vencida sin usar: "Link vencido el …"', async ({ page }) => {
    const d = datos();
    d.ninera_invitaciones = [INV(1, { creada_en: enDias(-9), vence_en: enDias(-2) })];
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => verNinera(id), ID.nAna);
    await expect(filaApp(page)).toContainText('Link vencido el 02/10');
    verificarLimpio(e);
  });

  test('si la base no crea el link: aviso claro y sin modal (inactiva, sin conexión)', async ({ page }) => {
    const e = await abrirFichaAna(page);
    // El simulador no pasa las RPC por estado.fallar: la respuesta con error va por una ruta propia.
    await page.route(/rest\/v1\/rpc\/crear_invitacion_ninera/, r => r.fulfill({ status: 400, json: { code: 'P0001', message: 'ninera_inactiva' } }));
    await botonApp(page).click();
    await expect(toasts(page).last()).toContainText('No se pudo crear el link: la niñera está inactiva');
    await expect(modalInv(page)).toHaveCount(0);
    await expect(botonApp(page)).toBeEnabled();

    await page.unroute(/rest\/v1\/rpc\/crear_invitacion_ninera/);
    await page.route(/rest\/v1\/rpc\/crear_invitacion_ninera/, r => r.abort('failed'));
    await botonApp(page).click();
    await expect(toasts(page).last()).toHaveText('No se pudo crear el link: revisá la conexión e intentá de nuevo.');
    await expect(modalInv(page)).toHaveCount(0);
    verificarLimpio(e, { ignorar: [/status of 400|Failed to load resource|ERR_FAILED/] });
  });

  test('cada error de la base se traduce; uno desconocido se muestra con su mensaje', async ({ page }) => {
    const e = await abrirFichaAna(page);
    const casos = [
      ['celular_invalido', 'No se pudo crear el link: el celular no es válido'],
      ['no_autorizada', 'No se pudo crear el link: tu cuenta no tiene permiso'],
      ['otra cosa rara', 'No se pudo crear el link: otra cosa rara'],
    ];
    for (const [mensaje, aviso] of casos) {
      await page.unroute(/rest\/v1\/rpc\/crear_invitacion_ninera/);
      await page.route(/rest\/v1\/rpc\/crear_invitacion_ninera/, r => r.fulfill({ status: 400, json: { code: 'P0001', message: mensaje } }));
      await botonApp(page).click();
      await expect(toasts(page).last()).toHaveText(aviso);
      await expect(modalInv(page)).toHaveCount(0);
    }
    verificarLimpio(e, { ignorar: [/status of 400/] });
  });

  test('doble toque en "Invitar a la app": una sola invitación', async ({ page }) => {
    const e = await abrirFichaAna(page);
    e.rpc.crear_invitacion_ninera = invitacionOk();
    await page.route(/rest\/v1\/rpc\/crear_invitacion_ninera/, async r => { await new Promise(ok => setTimeout(ok, 400)); await r.fallback(); });
    await botonApp(page).dblclick();
    await expect(modalInv(page)).toBeVisible();
    expect(llamadasInvitar(e)).toHaveLength(1);
    verificarLimpio(e);
  });

  test('si no se puede leer el estado de la app, lo dice y la ficha sigue andando', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await irAModulo(page, 'ninieras');
    await page.route(/rest\/v1\/ninera_invitaciones/, r => r.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }));
    await page.evaluate(id => verNinera(id), ID.nAna);
    await expect(filaApp(page)).toContainText('No se pudo cargar el estado de la app');
    await expect(page.locator('#vn-telefono')).toHaveText('098000001');
    await expect(page.locator('#vn-historial')).not.toContainText('Cargando');
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('cambiar el celular de una niñera con app avisa que necesita un link nuevo', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ user_id: USER_ANA, app_activada_en: '2026-10-01T15:00:00Z' }) });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => { ninTempOmitidas.add(id); editarNinera(id); }, ID.nAna);
    await page.fill('#ed-telefono', '098000077');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(toasts(page).last()).toContainText('Cambió el celular: va a necesitar un link nuevo para entrar (Invitar a la app).');
    verificarLimpio(e);
  });

  test('con app, cambiar solo el formato del celular no avisa (es la misma cuenta)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ telefono: '098 000 001', user_id: USER_ANA, app_activada_en: '2026-10-01T15:00:00Z' }) });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => { ninTempOmitidas.add(id); editarNinera(id); }, ID.nAna);
    await page.fill('#ed-telefono', '098000001');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(toasts(page).last()).toContainText('Cambios guardados');
    await page.waitForTimeout(200);
    expect((await toasts(page).allInnerTexts()).join(' | ')).not.toContain('Cambió el celular');
    verificarLimpio(e);
  });

  test('sin app, cambiar el celular no avisa nada de la app', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => { ninTempOmitidas.add(id); editarNinera(id); }, ID.nAna);
    await page.fill('#ed-telefono', '098000077');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(toasts(page).last()).toContainText('Cambios guardados');
    await page.waitForTimeout(200);
    expect((await toasts(page).allInnerTexts()).join(' | ')).not.toContain('Cambió el celular');
    verificarLimpio(e);
  });

  test('390 px: la ficha y la invitación entran sin scroll horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirFichaAna(page);
    await expect(filaApp(page)).toContainText('Sin app');
    const anchoOk = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth
      && [...document.querySelectorAll('.confirmbox')].every(b => b.scrollWidth <= b.clientWidth + 1));
    expect(await anchoOk()).toBe(true);
    e.rpc.crear_invitacion_ninera = invitacionOk();
    await botonApp(page).click();
    await expect(modalInv(page)).toHaveCSS('opacity', '1'); // terminó de aparecer, encima de la ficha
    expect(await anchoOk()).toBe(true);
    await page.screenshot({ path: test.info().outputPath('invitar-390.png') });
    verificarLimpio(e);
  });
});

test.describe('login del panel con una cuenta que no es de admin', () => {
  async function entrar(page, e) {
    await page.fill('#login-mail', 'prueba@ejemplo.test');
    await page.fill('#login-pass', 'contraseña-falsa');
    await page.locator('#loginbtn').click();
  }
  const cerroSesion = e => e.escrituras.some(w => w.tabla === '/auth/v1/logout');

  test('cuenta de niñera: cierra la sesión y le manda el link a su app', async ({ page }) => {
    const e = await abrirApp(page, { sesion: false });
    e.rpc.es_usuaria_autorizada = () => false;
    e.rpc.ninera_actual = () => ID.nAna;
    await entrar(page, e);
    const aviso = page.locator('#loginwarn .warnbox');
    await expect(aviso).toContainText('Esta cuenta es de niñera. Entrá por la app de niñeras:');
    await expect(aviso.locator('a')).toHaveAttribute('href', /ninera\/$/);
    await expect.poll(() => cerroSesion(e)).toBe(true);
    expect(e.escrituras.find(w => w.tabla === '/auth/v1/logout').params).toContain('scope=local');
    await expect(page.locator('#loginbtn')).toBeEnabled();
    await expect(page.locator('#modcontent')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('cuenta sin acceso (ni admin ni niñera): cierra la sesión y lo dice', async ({ page }) => {
    const e = await abrirApp(page, { sesion: false });
    e.rpc.es_usuaria_autorizada = () => false;
    e.rpc.ninera_actual = () => null;
    await entrar(page, e);
    await expect(page.locator('#loginwarn .warnbox')).toContainText('Esta cuenta no tiene acceso. Avisale a Diego.');
    await expect.poll(() => cerroSesion(e)).toBe(true);
    verificarLimpio(e);
  });

  test('si la consulta falla, la admin entra como siempre (sigue a Face ID)', async ({ page }) => {
    const e = await abrirApp(page, { sesion: false });
    await page.route(/\/auth\/v1\/passkeys/, r => r.fulfill({ json: [] }));
    await page.route(/rest\/v1\/rpc\/es_usuaria_autorizada/, r => r.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }));
    await entrar(page, e);
    await expect(page.locator('#bio-btn')).toBeVisible();
    expect(cerroSesion(e)).toBe(false);
    expect(e.escrituras.some(w => w.tabla === 'rpc/ninera_actual')).toBe(false);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('admin autorizada: sigue a Face ID sin preguntar si es niñera', async ({ page }) => {
    const e = await abrirApp(page, { sesion: false });
    await page.route(/\/auth\/v1\/passkeys/, r => r.fulfill({ json: [] }));
    e.rpc.es_usuaria_autorizada = () => true;
    await entrar(page, e);
    await expect(page.locator('#bio-btn')).toBeVisible();
    expect(e.escrituras.filter(w => w.tabla.startsWith('rpc/')).map(w => w.tabla)).toEqual(['rpc/es_usuaria_autorizada']);
    verificarLimpio(e);
  });
});
