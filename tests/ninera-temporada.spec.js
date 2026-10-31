// App de niñeras (fase 1, etapa 9, 31/10/2026): la temporada. La tarjeta del inicio y la pantalla
// #temporada, donde la niñera marca dónde está cada quincena. Todo contra el simulador. Hoy en el
// simulador es el 04/10/2026 (en temporada). Ana no cargó su temporada (sin app_activada: la
// pantalla parte de cero); Carla la cargó en esta temporada (marzo: "Fuera del país" y "Otro: Rocha").
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { errorRpc } = require('./support/rpc-ninera');
const { ID, datosBase } = require('./support/datos');

const TITULO = '¿Dónde vas a estar esta temporada?';
const GUARDADA = '¡Listo! Guardamos tu temporada.';
const FALLA_GUARDAR = 'No pudimos guardar tu temporada. Revisa tu conexión a internet y vuelve a intentar.';
const OTRO_VACIO = 'Escribe dónde vas a estar.';
const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[temporada\]/];
const RUIDO_SIN_MIGRAR = [/Failed to load resource: the server responded with a status of 404/];
const PLATA = /\$\d/;
const PAGO = /\bpago/i;
// Las 8 de diciembre a marzo y las 16 del resto del año, en el orden de la pantalla.
const OCHO = [22, 23, 0, 1, 2, 3, 4, 5];
const RESTO = Array.from({ length: 16 }, (_, i) => 6 + i);

// Sin PushManager (desde la etapa 9 los avisos son obligatorios: sin esto saldría su pantalla; un
// celular que no puede recibirlos pasa de largo). Ana con el perfil completo.
async function abrir(page, opciones = {}) {
  const datos = opciones.datos || datosBase();
  datos.ninieras.filter(n => n.id === ID.nAna).forEach(n => Object.assign(n, { zona: n.zona || 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00' }));
  if (opciones.sinPush !== false) await page.addInitScript(() => { delete window.PushManager; });
  return abrirAppNinera(page, { ...opciones, datos });
}
// El celular que sí puede recibir avisos pero los tiene apagados (permiso sin pedir, sin suscripción):
// en Chromium headless no hay servicio de push, así que se reemplazan el permiso y el registro del
// service worker por unos de mentira (como en tests/ninera-cuenta.spec.js).
async function celularConAvisosApagados(page) {
  await page.addInitScript(() => {
    const registro = { scope: new URL('/ninera/', location.href).href, active: { state: 'activated' },
      pushManager: { getSubscription: async () => null, subscribe: async () => { throw new Error('sin push en el test'); } } };
    navigator.serviceWorker.register = async () => registro;
    navigator.serviceWorker.getRegistration = async () => registro;
    Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
  });
}
const fila = (page, q) => page.locator(`.temp-fila[data-q="${q}"]`);
const opcion = (page, q, nombre) => fila(page, q).getByRole('button', { name: nombre, exact: true });
const guardar = page => page.getByRole('button', { name: 'Guardar' });
const error = page => page.locator('#temporada-error');
// La tarjeta se pide sin frenar el inicio: antes de mirarla, que la lectura haya salido.
async function esperarLecturaTemporada(page, e) {
  await expect.poll(() => e.escrituras.some(w => w.tabla === 'rpc/ninera_mi_temporada')).toBe(true);
  // Y que la app haya terminado de procesarla (la respuesta llega después de salir el pedido).
  await page.waitForTimeout(300);
}
function rpcs(e, nombre) {
  return e.escrituras.filter(w => w.tabla === `rpc/${nombre}`).map(w => w.cuerpo);
}
async function abrirPantalla(page, opciones) {
  const e = await abrir(page, opciones);
  await page.locator('#inicio-temporada').getByRole('button').click();
  await expect(page.locator('h1')).toHaveText(TITULO);
  return e;
}
// Marca las 8 de diciembre a marzo en Montevideo.
async function marcarLasOcho(page, lugar = 'Montevideo') {
  for (const q of OCHO) await opcion(page, q, lugar).click();
}
async function estados(page, qs) {
  return page.evaluate(qs => qs.map(q => {
    const marcado = document.querySelector(`.temp-fila[data-q="${q}"] button[aria-pressed="true"]`);
    return marcado ? marcado.textContent.trim() : null;
  }), qs);
}
const lugaresMontevideo = (distintos = {}) => {
  const l = {};
  for (let q = 0; q < 24; q++) l[String(q)] = 'montevideo';
  return { ...l, ...distintos };
};

test.describe('tarjeta de la temporada en el inicio', () => {
  test('sin la temporada cargada: pregunta y "Marcar" lleva a la pantalla', async ({ page }) => {
    const e = await abrir(page);
    const tarjeta = page.locator('#inicio-temporada');
    await expect(tarjeta).toContainText(TITULO);
    await expect(tarjeta.getByRole('button', { name: 'Marcar' })).toBeVisible();
    await expect(tarjeta).not.toContainText('Tu temporada');
    await tarjeta.getByRole('button', { name: 'Marcar' }).click();
    await expect(page.locator('h1')).toHaveText(TITULO);
    expect(new URL(page.url()).hash).toBe('#temporada');
    verificarLimpio(e);
  });

  test('al día: "Tu temporada" con el resumen y "Cambiar"; "Otro" tramposo se ve como texto', async ({ page }) => {
    const datos = datosBase();
    const tramposo = '<img src=x onerror="window.__roto=1">"\'';
    datos.ninieras.find(n => n.id === ID.nCarla).temporada_lugares = lugaresMontevideo({ 4: 'fuera_pais', 5: { otro: tramposo }, 0: 'punta', 1: 'punta' });
    const e = await abrir(page, { datos, ninera: ID.nCarla });
    const tarjeta = page.locator('#inicio-temporada');
    await expect(tarjeta.getByRole('heading', { name: 'Tu temporada' })).toBeVisible();
    await expect(tarjeta).toContainText('Punta del Este: enero');
    await expect(tarjeta).toContainText('Fuera del país: 1ra quincena de marzo');
    await expect(tarjeta).toContainText(`Otro (${tramposo}): 2da quincena de marzo`);
    await expect(tarjeta.getByRole('button', { name: 'Cambiar' })).toBeVisible();
    await expect(tarjeta.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__roto)).toBeUndefined();
    verificarLimpio(e);
  });

  test('al día y todo en Montevideo: "Toda la temporada en Montevideo."', async ({ page }) => {
    const datos = datosBase();
    datos.ninieras.find(n => n.id === ID.nCarla).temporada_lugares = lugaresMontevideo();
    const e = await abrir(page, { datos, ninera: ID.nCarla });
    await expect(page.locator('#inicio-temporada')).toContainText('Toda la temporada en Montevideo.');
    verificarLimpio(e);
  });

  test('en mayo no hay tarjeta (se entra igual por el link del aviso)', async ({ page }) => {
    const e = await abrir(page, { ahora: '2026-05-10T12:00:00-03:00' });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.locator('#inicio-temporada')).toBeEmpty();
    await expect(page.locator('#inicio-temporada')).not.toContainText(TITULO);
    verificarLimpio(e);
  });

  test('setiembre y marzo sí, abril no (mes de todayISO en Montevideo)', async ({ page, browser }) => {
    for (const [ahora, hay] of [['2026-08-31T23:30:00-03:00', false], ['2026-09-01T00:30:00-03:00', true], ['2027-03-31T23:30:00-03:00', true], ['2027-04-01T00:30:00-03:00', false]]) {
      const p = await browser.newPage();
      const e = await abrir(p, { ahora });
      await expect(p.locator('#app')).toContainText('No tienes pedidos por ahora.');
      if (!hay) await p.waitForTimeout(300); // si hubiera pedido la tarjeta, ya habría llegado
      if (hay) await expect(p.locator('#inicio-temporada')).toContainText(TITULO);
      else await expect(p.locator('#inicio-temporada')).toBeEmpty();
      verificarLimpio(e);
      await p.close();
    }
  });

  test('base sin la migración: sin tarjeta y sin aviso', async ({ page }) => {
    const e = await abrir(page, { baseSinMigrar: 'etapa9' });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await esperarLecturaTemporada(page, e);
    await expect(page.locator('#inicio-temporada')).toBeEmpty();
    verificarLimpio(e, { ignorar: RUIDO_SIN_MIGRAR });
  });

  test('la lectura falla por la red: la tarjeta no aparece', async ({ page }) => {
    await page.addInitScript(() => { delete window.PushManager; });
    const datos = datosBase();
    datos.ninieras.filter(n => n.id === ID.nAna).forEach(n => Object.assign(n, { zona: n.zona || 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00' }));
    // fallar se pone antes de que corra la lectura: abrirAppNinera deja correr la app, así que se
    // enciende apenas existe el estado y el simulador lo consulta en cada pedido.
    const e = await abrirAppNinera(page, { datos, ninera: ID.nAna, funciones: {} });
    e.fallar = p => (p.tabla === 'rpc/ninera_mi_temporada' ? 'red' : undefined);
    await page.evaluate(() => renderInicio());
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    // La lectura que falla no llega al simulador: se sabe que corrió porque la app anota el error.
    await expect.poll(() => e.errores.some(m => /\[temporada\] al leer/.test(m))).toBe(true);
    await expect(page.locator('#inicio-temporada')).toBeEmpty();
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('pantalla de la temporada', () => {
  test('sin estar al día: las 8 de diciembre a marzo vacías y las 16 del resto en Montevideo', async ({ page }) => {
    const e = await abrirPantalla(page);
    await expect(page.locator('.temp-fila')).toHaveCount(24);
    // Ocho visibles con su texto y sin nada marcado.
    expect(await estados(page, OCHO)).toEqual(Array(8).fill(null));
    await expect(fila(page, 22)).toContainText('1ra quincena de diciembre');
    await expect(fila(page, 23)).toContainText('2da quincena de diciembre');
    await expect(fila(page, 5)).toContainText('2da quincena de marzo');
    // Las otras 16, plegadas, en Montevideo.
    await expect(page.locator('#temp-resto')).toBeHidden();
    expect(await estados(page, RESTO)).toEqual(Array(16).fill('Montevideo'));
    await page.getByRole('button', { name: 'Ver el resto del año' }).click();
    await expect(page.locator('#temp-resto')).toBeVisible();
    await expect(fila(page, 6)).toContainText('1ra quincena de abril');
    await expect(fila(page, 21)).toContainText('2da quincena de noviembre');
    // Cada fila tiene las 5 opciones.
    await expect(fila(page, 22).getByRole('button')).toHaveText(['Punta del Este', 'Montevideo', 'La Paloma', 'Fuera del país', 'Otro']);
    verificarLimpio(e);
  });

  test('si vive solo en Punta, el resto del año viene en Punta', async ({ page }) => {
    const datos = datosBase();
    datos.ninieras.find(n => n.id === ID.nAna).zona = 'Punta del Este';
    const e = await abrir(page, { datos });
    await page.locator('#inicio-temporada').getByRole('button').click();
    expect(await estados(page, OCHO)).toEqual(Array(8).fill(null));
    expect(await estados(page, RESTO)).toEqual(Array(16).fill('Punta del Este'));
    verificarLimpio(e);
  });

  test('al día: viene lo que cargó, con el texto de "Otro"', async ({ page }) => {
    const e = await abrirPantalla(page, { ninera: ID.nCarla });
    expect(await estados(page, [4, 5, 22, 6])).toEqual(['Fuera del país', 'Otro', 'Montevideo', 'Montevideo']);
    await expect(page.locator('#temp-otro-5')).toHaveValue('Rocha');
    await expect(page.locator('#temp-otro-4')).toBeHidden();
    verificarLimpio(e);
  });

  test('los botones marcan de a uno (aria-pressed) y "Otro" abre "¿Dónde?" con tope de 80', async ({ page }) => {
    const e = await abrirPantalla(page);
    await opcion(page, 22, 'La Paloma').click();
    await expect(opcion(page, 22, 'La Paloma')).toHaveAttribute('aria-pressed', 'true');
    await opcion(page, 22, 'Punta del Este').click();
    await expect(opcion(page, 22, 'La Paloma')).toHaveAttribute('aria-pressed', 'false');
    await expect(opcion(page, 22, 'Punta del Este')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#temp-otro-22')).toBeHidden();
    await opcion(page, 22, 'Otro').click();
    const campo = page.locator('#temp-otro-22');
    await expect(campo).toBeVisible();
    await expect(campo).toHaveAttribute('maxlength', '80');
    await expect(fila(page, 22).getByLabel('¿Dónde?')).toBeVisible();
    await campo.fill('x'.repeat(80));
    await campo.pressSequentially('y');
    expect(await campo.inputValue()).toBe('x'.repeat(80));
    verificarLimpio(e);
  });

  test('"Todo el verano en Punta" marca Punta de la 2da de diciembre a la 2da de febrero y deja el resto', async ({ page }) => {
    const e = await abrirPantalla(page);
    await opcion(page, 22, 'La Paloma').click();
    await opcion(page, 5, 'Fuera del país').click();
    await page.getByRole('button', { name: 'Todo el verano en Punta' }).click();
    expect(await estados(page, OCHO)).toEqual(['La Paloma', 'Punta del Este', 'Punta del Este', 'Punta del Este', 'Punta del Este', 'Punta del Este', null, 'Fuera del país']);
    expect(await estados(page, RESTO)).toEqual(Array(16).fill('Montevideo'));
    verificarLimpio(e);
  });

  test('guardar con alguna vacía: no llama a la base, las marca y dice cuántas faltan', async ({ page }) => {
    const e = await abrirPantalla(page);
    for (const q of [22, 23, 0, 1, 2]) await opcion(page, q, 'Montevideo').click();
    await guardar(page).click();
    await expect(error(page)).toHaveText('Te falta marcar 3 quincenas.');
    await expect(fila(page, 3)).toHaveClass(/falta/);
    await expect(fila(page, 22)).not.toHaveClass(/falta/);
    expect(rpcs(e, 'ninera_guardar_temporada')).toEqual([]);
    // Con una sola, en singular; al marcarla desaparece la marca.
    await opcion(page, 3, 'Montevideo').click();
    await opcion(page, 4, 'Montevideo').click();
    await guardar(page).click();
    await expect(error(page)).toHaveText('Te falta marcar 1 quincena.');
    await expect(fila(page, 5)).toHaveClass(/falta/);
    await opcion(page, 5, 'Montevideo').click();
    await expect(fila(page, 5)).not.toHaveClass(/falta/);
    expect(rpcs(e, 'ninera_guardar_temporada')).toEqual([]);
    verificarLimpio(e);
  });

  test('"Otro" vacío (o solo espacios) no guarda; con 80 caracteres sí', async ({ page }) => {
    const e = await abrirPantalla(page);
    await marcarLasOcho(page);
    await opcion(page, 0, 'Otro').click();
    await guardar(page).click();
    await expect(error(page)).toHaveText(OTRO_VACIO);
    await page.locator('#temp-otro-0').fill('   ');
    await guardar(page).click();
    await expect(error(page)).toHaveText(OTRO_VACIO);
    expect(rpcs(e, 'ninera_guardar_temporada')).toEqual([]);
    const largo = 'ñ'.repeat(80);
    await page.locator('#temp-otro-0').fill(largo);
    await guardar(page).click();
    await expect(page.locator('#inicio-temporada')).toContainText('Tu temporada');
    expect(rpcs(e, 'ninera_guardar_temporada')[0].p_lugares['0']).toEqual({ otro: largo });
    verificarLimpio(e);
  });

  test('guardar bien: cuerpo con las 24 claves, aviso, vuelve al inicio y la tarjeta dice "Tu temporada"', async ({ page }) => {
    const e = await abrirPantalla(page);
    await marcarLasOcho(page);
    await opcion(page, 23, 'Punta del Este').click();
    await opcion(page, 0, 'Otro').click();
    await page.locator('#temp-otro-0').fill('  Rocha  ');
    await opcion(page, 5, 'Fuera del país').click();
    await page.getByRole('button', { name: 'Ver el resto del año' }).click();
    await opcion(page, 10, 'La Paloma').click();
    await guardar(page).click();
    await expect(page.locator('.toast')).toHaveText(GUARDADA);
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(new URL(page.url()).hash).toBe('#inicio');
    const esperado = lugaresMontevideo({ 23: 'punta', 0: { otro: 'Rocha' }, 5: 'fuera_pais', 10: 'la_paloma' });
    expect(rpcs(e, 'ninera_guardar_temporada')).toEqual([{ p_lugares: esperado }]);
    expect(Object.keys(rpcs(e, 'ninera_guardar_temporada')[0].p_lugares)).toHaveLength(24);
    const tarjeta = page.locator('#inicio-temporada');
    await expect(tarjeta.getByRole('heading', { name: 'Tu temporada' })).toBeVisible();
    await expect(tarjeta).toContainText('Punta del Este: 2da quincena de diciembre');
    await expect(tarjeta).toContainText('La Paloma: 1ra quincena de junio');
    await expect(tarjeta).toContainText('Otro (Rocha): 1ra quincena de enero');
    verificarLimpio(e);
  });

  test('al día, guardar sin cambios confirma lo que ya tenía', async ({ page }) => {
    const e = await abrirPantalla(page, { ninera: ID.nCarla });
    await guardar(page).click();
    await expect(page.locator('.toast')).toHaveText(GUARDADA);
    expect(rpcs(e, 'ninera_guardar_temporada')).toEqual([{ p_lugares: lugaresMontevideo({ 4: 'fuera_pais', 5: { otro: 'Rocha' } }) }]);
    verificarLimpio(e);
  });

  for (const [nombre, falla] of [['la base falla', { status: 500, message: 'falla simulada' }], ['sin conexión', 'red']]) {
    test(`${nombre}: avisa y lo marcado queda; al reintentar guarda`, async ({ page }) => {
      const e = await abrirPantalla(page);
      await marcarLasOcho(page);
      await opcion(page, 1, 'Otro').click();
      await page.locator('#temp-otro-1').fill('Rocha');
      await opcion(page, 2, 'Punta del Este').click();
      e.fallar = p => (p.tabla === 'rpc/ninera_guardar_temporada' ? falla : undefined);
      await guardar(page).click();
      await expect(error(page)).toHaveText(FALLA_GUARDAR);
      await expect(page.locator('.toast')).toHaveCount(0);
      await expect(page.locator('h1')).toHaveText(TITULO);
      expect(await estados(page, [1, 2, 3])).toEqual(['Otro', 'Punta del Este', 'Montevideo']);
      await expect(page.locator('#temp-otro-1')).toHaveValue('Rocha');
      e.fallar = null;
      await expect(guardar(page)).toBeEnabled();
      await guardar(page).click();
      await expect(page.locator('.toast')).toHaveText(GUARDADA);
      expect(rpcs(e, 'ninera_guardar_temporada')).toHaveLength(1);
      verificarLimpio(e, { ignorar: RUIDO });
    });
  }

  test('la base rechaza (cuenta dada de baja): avisa que la cuenta no está activa', async ({ page }) => {
    const e = await abrirPantalla(page);
    await marcarLasOcho(page);
    e.rpc.ninera_guardar_temporada = () => { throw errorRpc('no_autorizada'); };
    await guardar(page).click();
    await expect(error(page)).toHaveText('Tu cuenta no está activa. Escríbenos por WhatsApp.');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('doble toque: una sola llamada', async ({ page }) => {
    const e = await abrirPantalla(page);
    await marcarLasOcho(page);
    e.demoraEscrituras = 400;
    await guardar(page).dblclick();
    await expect(page.locator('.toast')).toHaveText(GUARDADA);
    expect(rpcs(e, 'ninera_guardar_temporada')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('"Volver" lleva al inicio sin guardar', async ({ page }) => {
    const e = await abrirPantalla(page);
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(rpcs(e, 'ninera_guardar_temporada')).toEqual([]);
    verificarLimpio(e);
  });

  test('base sin la migración: #temporada va al inicio', async ({ page }) => {
    const e = await abrir(page, { baseSinMigrar: 'etapa9', consulta: '#temporada' });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(new URL(page.url()).hash).toBe('#inicio');
    verificarLimpio(e, { ignorar: RUIDO_SIN_MIGRAR });
  });

  test('la lectura falla al abrirla desde la tarjeta: avisa y sigue en el inicio', async ({ page }) => {
    const e = await abrir(page);
    await expect(page.locator('#inicio-temporada')).toContainText(TITULO);
    e.fallar = p => (p.tabla === 'rpc/ninera_mi_temporada' ? 'red' : undefined);
    await page.locator('#inicio-temporada').getByRole('button').click();
    await expect(page.locator('.toast')).toHaveText('No pudimos abrir tu temporada. Revisa tu conexión a internet y vuelve a intentar.');
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('rutas de la temporada', () => {
  test('abrir con #temporada y los avisos apagados: pasa primero por los avisos y llega a la temporada', async ({ page }) => {
    await celularConAvisosApagados(page);
    const e = await abrir(page, { sinPush: false, consulta: '#temporada' });
    await expect(page.locator('h1')).toHaveText('Activa los avisos');
    // Sin permiso real en el test: la falla simulada deja "Seguir sin avisos".
    const previa = e.fallar;
    e.fallar = () => 'red';
    await page.getByRole('button', { name: 'Activar avisos' }).click();
    const link = page.getByRole('button', { name: 'Seguir sin avisos' });
    await expect(link).toBeVisible();
    e.fallar = previa;
    for (let i = e.errores.length - 1; i >= 0; i--) if (/status of [45]\d\d|Failed to load resource|ERR_FAILED|Failed to fetch|\[avisos\]/.test(e.errores[i])) e.errores.splice(i, 1);
    await link.click();
    await expect(page.locator('h1')).toHaveText(TITULO);
    expect(new URL(page.url()).hash).toBe('#temporada');
    verificarLimpio(e);
  });

  test('abrir con #temporada con todo en orden: va directo a la pantalla', async ({ page }) => {
    const e = await abrir(page, { consulta: '#temporada' });
    await expect(page.locator('h1')).toHaveText(TITULO);
    verificarLimpio(e);
  });

  test('un push con la app abierta (#temporada) lleva a la pantalla desde el inicio', async ({ page }) => {
    const e = await abrir(page);
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await page.evaluate(() => { location.hash = '#temporada'; });
    await expect(page.locator('h1')).toHaveText(TITULO);
    verificarLimpio(e);
  });

  test('un aviso con url #temporada en "Avisos" lleva a la pantalla', async ({ page }) => {
    const datos = datosBase();
    datos.avisos = [{ id: '94000000-0000-4000-8000-000000000001', clave: 'temporada:2026:ana', para_ninera_id: ID.nAna, para_admin: null, tipo: 'temporada',
      titulo: TITULO, cuerpo: 'Marca dónde vas a estar cada quincena.', url: '#temporada', creado_en: '2026-10-03T12:00:00+00:00', leido_en: null }];
    const e = await abrir(page, { datos });
    await page.locator('#inicio-accesos button', { hasText: 'Avisos' }).click();
    await page.locator('#avisos-lista .aviso-item').first().click();
    await expect(page.locator('h1')).toHaveText(TITULO);
    verificarLimpio(e);
  });
});

test.describe('en el celular', () => {
  test('a 390 px y a 1280 px: sin scroll horizontal, botones para el dedo, sin plata (capturas)', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirPantalla(page);
    await page.getByRole('button', { name: 'Ver el resto del año' }).click();
    await opcion(page, 0, 'Otro').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const cajas = await page.locator('.temp-fila:visible button').evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }));
    expect(cajas.length).toBeGreaterThan(100);
    for (const [ancho, alto] of cajas) { expect(alto).toBeGreaterThanOrEqual(44); expect(ancho).toBeGreaterThanOrEqual(44); }
    const texto = await page.locator('#app').innerText();
    expect(texto).not.toMatch(PLATA);
    expect(texto).not.toMatch(PAGO);
    await page.screenshot({ path: testInfo.outputPath('ninera-temporada-390.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await page.screenshot({ path: testInfo.outputPath('ninera-temporada-1280.png'), fullPage: true, animations: 'disabled' });
    verificarLimpio(e);
  });

  test('la tarjeta tampoco muestra plata ni pagos', async ({ page }) => {
    const e = await abrir(page, { ninera: ID.nCarla });
    await expect(page.locator('#inicio-temporada')).toContainText('Tu temporada');
    const texto = await page.locator('#inicio-temporada').innerText();
    expect(texto).not.toMatch(PLATA);
    expect(texto).not.toMatch(PAGO);
    verificarLimpio(e);
  });
});
