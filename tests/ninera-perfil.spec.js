// App de niñeras (fase 1, etapa 2, 27/10/2026): "Completa esto una sola vez" y "Mi perfil"
// (ninera/js/perfil.js). La niñera elige qué servicios hace, sus zonas, sus datos bancarios y,
// si quiere, una foto que queda como "foto propuesta" (la aprueba una admin). Todo contra el
// simulador (tests/support/app.js y rpc-ninera.js): Ana (la niñera por defecto) todavía no lo
// completó; Carla ya lo completó y mandó una foto.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { ID } = require('./support/datos');

const TITULO_PRIMERA = 'Completa esto una sola vez';
const SIN_ZONA = 'Elige al menos una zona.';
const FALLA_FOTO = 'No pudimos subir tu foto. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_GUARDAR = 'No pudimos guardar tu perfil. Revisa tu conexión a internet y vuelve a intentar.';
const LISTO = '¡Listo! Tu perfil quedó guardado.';
const AVISO_AUTO = 'Pronto vas a poder cargar los datos del auto desde aquí.';
const RUTA_FOTO_ANA = `fotos/${ID.nAna}/propuesta.jpg`;
// Chromium anota en consola toda respuesta 4xx/5xx simulada y todo pedido cortado.
const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[perfil\]|\[ninera_mi_perfil\]|\[ninera_zonas_disponibles\]/];

// Abre la app con la pantalla de avisos ya vista en este celular (estos tests miran el perfil).
async function abrir(page, opciones = {}) {
  await page.addInitScript(() => localStorage.setItem('pb-ninera-avisos-vistos', '1'));
  return abrirAppNinera(page, opciones);
}
function rpcs(e, nombre) {
  return e.escrituras.filter(w => w.tabla === `rpc/${nombre}`).map(w => w.cuerpo);
}
function subidas(e) {
  return e.escrituras.filter(w => w.tabla.startsWith('/storage/v1/'));
}
const radio = (page, nombre) => page.getByRole('radio', { name: nombre, exact: true });
const zona = (page, nombre) => page.locator(`.perfil-zona[value="${nombre}"]`);
// Un PNG de 300×200 hecho con un canvas del navegador (nada de archivos reales).
async function pngFicticio(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#757CBB'; ctx.fillRect(0, 0, 300, 200);
    return c.toDataURL('image/png');
  });
  return { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
}
// Completa el formulario de Ana: Ambos, Pocitos y dos renglones de cuenta.
async function completarAna(page) {
  await radio(page, 'Ambos').check();
  await zona(page, 'Pocitos').check();
  await page.fill('#perfil-cuenta', '  Banco Ficticio  \n\nCA 0001234567\n');
}

test.describe('primer ingreso: "Completa esto una sola vez"', () => {
  test('Ana entra por primera vez: servicios, zonas y datos bancarios; sin zona no guarda', async ({ page }) => {
    const e = await abrir(page);
    await expect(page.locator('h1')).toHaveText(TITULO_PRIMERA);
    expect(new URL(page.url()).hash).toBe('#perfil');
    await expect(page.locator('#app')).toContainText('¿Qué servicios realizas?');
    for (const n of ['Sittings', 'Carsittings', 'Ambos']) await expect(radio(page, n)).toBeVisible();
    // Precargado desde su ficha: tipo 'Niñera' = Sittings, y su cuenta.
    await expect(radio(page, 'Sittings')).toBeChecked();
    await expect(page.locator('#app')).toContainText('Zonas donde puedes tomar servicios');
    expect(await page.locator('.perfil-zona').evaluateAll(cs => cs.map(c => [c.value, c.checked])))
      .toEqual([['Pocitos', false], ['Carrasco', false], ['Punta del Este', false]]);
    await expect(page.locator('#app')).toContainText('Datos bancarios para pagarte');
    await expect(page.locator('#app')).toContainText('Banco, tipo y número de cuenta, uno por línea.');
    await expect(page.locator('#perfil-cuenta')).toHaveValue('0099887766');
    await expect(page.locator('#app')).toContainText('Tu foto (opcional)');
    await expect(page.locator('#app')).toContainText('La ve el equipo y, si la aprueban, pasa a tu perfil.');
    await expect(page.locator('#app')).not.toContainText('Foto enviada');
    // Sin "Volver": la primera vez se completa.
    await expect(page.getByRole('button', { name: 'Volver' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#perfil-error')).toHaveText(SIN_ZONA);
    expect(rpcs(e, 'ninera_guardar_perfil')).toEqual([]);
    expect(subidas(e)).toEqual([]);
    verificarLimpio(e);
  });

  test('Ambos + Pocitos + dos renglones de cuenta: guarda y va al inicio; el aviso del auto con Carsittings o Ambos', async ({ page }) => {
    const e = await abrir(page);
    await expect(page.locator('h1')).toHaveText(TITULO_PRIMERA);
    await expect(page.getByText(AVISO_AUTO)).toBeHidden();
    await radio(page, 'Carsittings').check();
    await expect(page.getByText(AVISO_AUTO)).toBeVisible();
    await radio(page, 'Sittings').check();
    await expect(page.getByText(AVISO_AUTO)).toBeHidden();
    await completarAna(page);
    await expect(page.getByText(AVISO_AUTO)).toBeVisible();

    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('.toast')).toHaveText(LISTO);
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(new URL(page.url()).hash).toBe('#inicio');
    expect(rpcs(e, 'ninera_guardar_perfil')).toEqual([
      { p_tipo: 'Ambas', p_zonas: ['Pocitos'], p_cuenta: ['Banco Ficticio', 'CA 0001234567'], p_foto_ruta: null },
    ]);
    expect(subidas(e)).toEqual([]);
    const ana = e.db.ninieras.find(n => n.id === ID.nAna);
    expect([ana.tipo, ana.zona, ana.cuenta_bancaria]).toEqual(['Ambas', 'Pocitos', ['Banco Ficticio', 'CA 0001234567']]);
    verificarLimpio(e);
  });

  test('con una foto: la sube a su carpeta (siempre la misma ruta) y la RPC lleva esa ruta', async ({ page }) => {
    const e = await abrir(page);
    await completarAna(page);
    await page.setInputFiles('#perfil-foto', await pngFicticio(page));
    await expect(page.locator('#perfil-foto-previa')).toBeVisible();
    expect(await page.locator('#perfil-foto-previa').getAttribute('src')).toMatch(/^blob:/);

    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    const subida = subidas(e);
    expect(subida.map(s => [s.tabla, s.metodo])).toEqual([[`/storage/v1/object/ninieras-privado/${RUTA_FOTO_ANA}`, 'POST']]);
    // Sube con su tipo real (27/10/2026). supabase-js manda un File como multipart: el tipo que
    // guarda Storage es el de la parte del archivo, que el simulador anota en el cuerpo.
    expect(subida[0].cuerpo).toMatch(/Content-Type: image\/png/i);
    expect(subida[0].cuerpo).not.toMatch(/Content-Type: image\/jpeg/i);
    expect(rpcs(e, 'ninera_guardar_perfil')).toEqual([
      { p_tipo: 'Ambas', p_zonas: ['Pocitos'], p_cuenta: ['Banco Ficticio', 'CA 0001234567'], p_foto_ruta: RUTA_FOTO_ANA },
    ]);
    // Primero la foto, después el perfil.
    const orden = e.escrituras.map(w => w.tabla);
    expect(orden.indexOf(`/storage/v1/object/ninieras-privado/${RUTA_FOTO_ANA}`)).toBeLessThan(orden.indexOf('rpc/ninera_guardar_perfil'));
    expect(e.db.ninieras.find(n => n.id === ID.nAna).foto_propuesta_ruta).toBe(RUTA_FOTO_ANA);
    verificarLimpio(e);
  });

  test('una foto que no es JPG, PNG ni WEBP (HEIC sin convertir): avisa, no sube nada ni guarda el perfil', async ({ page }) => {
    const e = await abrir(page);
    await completarAna(page);
    await page.setInputFiles('#perfil-foto', { name: 'foto.heic', mimeType: 'image/heic', buffer: Buffer.from('heic ficticio') });
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#perfil-error')).toHaveText('La foto tiene que ser JPG o PNG.');
    expect(subidas(e)).toEqual([]);
    expect(rpcs(e, 'ninera_guardar_perfil')).toEqual([]);
    await expect(radio(page, 'Ambos')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeEnabled();
    verificarLimpio(e);
  });

  test('si falla subir la foto: avisa, no guarda el perfil y el formulario sigue con lo escrito', async ({ page }) => {
    const e = await abrir(page);
    await completarAna(page);
    await page.setInputFiles('#perfil-foto', await pngFicticio(page));
    e.fallar = p => (p.tabla.startsWith('/storage/v1/') ? 'red' : undefined);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#perfil-error')).toHaveText(FALLA_FOTO);
    expect(rpcs(e, 'ninera_guardar_perfil')).toEqual([]);
    expect(new URL(page.url()).hash).toBe('#perfil');
    await expect(radio(page, 'Ambos')).toBeChecked();
    await expect(zona(page, 'Pocitos')).toBeChecked();
    await expect(page.locator('#perfil-cuenta')).toHaveValue('  Banco Ficticio  \n\nCA 0001234567\n');
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeEnabled();
    expect(e.db.ninieras.find(n => n.id === ID.nAna).zona).toBeNull();

    // Vuelve la conexión: el segundo intento sube la misma foto y guarda.
    e.fallar = null;
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(subidas(e)).toHaveLength(1);
    expect(rpcs(e, 'ninera_guardar_perfil').map(c => c.p_foto_ruta)).toEqual([RUTA_FOTO_ANA]);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('si falla guardar el perfil: avisa y el formulario sigue con lo escrito', async ({ page }) => {
    const e = await abrir(page);
    await completarAna(page);
    e.fallar = p => (p.tabla === 'rpc/ninera_guardar_perfil' ? { status: 500, message: 'falla simulada' } : undefined);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#perfil-error')).toHaveText(FALLA_GUARDAR);
    await expect(page.locator('.toast')).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe('#perfil');
    await expect(radio(page, 'Ambos')).toBeChecked();
    await expect(zona(page, 'Pocitos')).toBeChecked();
    await expect(page.locator('#perfil-cuenta')).toHaveValue('  Banco Ficticio  \n\nCA 0001234567\n');
    expect(e.db.ninieras.find(n => n.id === ID.nAna).zona).toBeNull();

    // Sin conexión, el mismo aviso.
    e.fallar = p => (p.tabla === 'rpc/ninera_guardar_perfil' ? 'red' : undefined);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#perfil-error')).toHaveText(FALLA_GUARDAR);
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeEnabled();

    e.fallar = null;
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(rpcs(e, 'ninera_guardar_perfil')).toHaveLength(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('doble toque en "Guardar" con la base lenta: una sola subida y una sola RPC', async ({ page }) => {
    const e = await abrir(page);
    await completarAna(page);
    await page.setInputFiles('#perfil-foto', await pngFicticio(page));
    e.demoraEscrituras = 400;
    await page.evaluate(() => { const b = document.getElementById('perfil-guardar'); b.click(); b.click(); });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(subidas(e)).toHaveLength(1);
    expect(rpcs(e, 'ninera_guardar_perfil')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('si no puede leer el perfil al entrar: el error de siempre con "Reintentar"', async ({ page }) => {
    const e = await abrir(page);
    e.fallar = p => (p.tabla === 'rpc/ninera_mi_perfil' ? 'red' : undefined);
    await page.reload();
    await expect(page.locator('#pantalla-error')).toContainText('No pudimos cargar tus pedidos.');
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('si no puede leer las zonas al entrar: el mismo error', async ({ page }) => {
    const e = await abrir(page);
    e.fallar = p => (p.tabla === 'rpc/ninera_zonas_disponibles' ? { status: 500 } : undefined);
    await page.reload();
    await expect(page.locator('#pantalla-error')).toContainText('No pudimos cargar tus pedidos.');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('después de "Ahora no" en los avisos, la primera vez sigue al perfil', async ({ page }) => {
    // Sin la marca de avisos vistos: Chromium headless tiene push, sin permiso.
    const e = await abrirAppNinera(page);
    await expect(page.locator('#app')).toContainText('Activa los avisos');
    await page.getByRole('button', { name: 'Ahora no' }).click();
    await expect(page.locator('h1')).toHaveText(TITULO_PRIMERA);
    verificarLimpio(e);
  });
});

test.describe('"Mi perfil": editar desde el inicio', () => {
  test('Carla (perfil completo) entra directo al inicio y "Mi perfil" abre la edición precargada', async ({ page }) => {
    const e = await abrir(page, { ninera: ID.nCarla });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(new URL(page.url()).hash).toBe('#inicio');
    e.db.ninieras.find(n => n.id === ID.nCarla).cuenta_bancaria = ['Banco Ficticio', 'CA 0001234567'];

    await page.getByRole('button', { name: 'Mi perfil' }).click();
    await expect(page.locator('h1')).toHaveText('Mi perfil');
    expect(new URL(page.url()).hash).toBe('#perfil');
    await expect(radio(page, 'Ambos')).toBeChecked();
    await expect(zona(page, 'Pocitos')).toBeChecked();
    await expect(zona(page, 'Carrasco')).toBeChecked();
    await expect(zona(page, 'Punta del Este')).not.toBeChecked();
    await expect(page.locator('#perfil-cuenta')).toHaveValue('Banco Ficticio\nCA 0001234567');
    await expect(page.locator('#app')).toContainText('Foto enviada el 02/10, el equipo la va a revisar.');
    await expect(page.getByText(AVISO_AUTO)).toBeVisible();

    // "Volver" vuelve al inicio sin guardar nada.
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(rpcs(e, 'ninera_guardar_perfil')).toEqual([]);

    // Editar: saca Carrasco y guarda; sin foto nueva, la propuesta de antes queda.
    await page.getByRole('button', { name: 'Mi perfil' }).click();
    await zona(page, 'Carrasco').uncheck();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('.toast')).toHaveText(LISTO);
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(rpcs(e, 'ninera_guardar_perfil')).toEqual([
      { p_tipo: 'Ambas', p_zonas: ['Pocitos'], p_cuenta: ['Banco Ficticio', 'CA 0001234567'], p_foto_ruta: null },
    ]);
    const carla = e.db.ninieras.find(n => n.id === ID.nCarla);
    expect([carla.zona, carla.foto_propuesta_ruta]).toEqual(['Pocitos', `fotos/${ID.nCarla}/propuesta.jpg`]);
    verificarLimpio(e);
  });

  test('una zona escrita a mano en el panel (sin tildes ni mayúsculas) igual sale marcada', async ({ page }) => {
    const e = await abrir(page, { ninera: ID.nCarla });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    e.db.ninieras.find(n => n.id === ID.nCarla).zona = 'pocitos/PUNTA DEL ESTE';
    await page.getByRole('button', { name: 'Mi perfil' }).click();
    await expect(page.locator('h1')).toHaveText('Mi perfil');
    expect(await page.locator('.perfil-zona').evaluateAll(cs => cs.map(c => [c.value, c.checked])))
      .toEqual([['Pocitos', true], ['Carrasco', false], ['Punta del Este', true]]);
    verificarLimpio(e);
  });

  test('si no puede abrir "Mi perfil": avisa y se queda en el inicio', async ({ page }) => {
    const e = await abrir(page, { ninera: ID.nCarla });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    e.fallar = p => (p.tabla === 'rpc/ninera_mi_perfil' ? 'red' : undefined);
    await page.getByRole('button', { name: 'Mi perfil' }).click();
    await expect(page.locator('.toast')).toHaveText('No pudimos abrir tu perfil. Revisa tu conexión a internet y vuelve a intentar.');
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.getByRole('button', { name: 'Mi perfil' })).toBeEnabled();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('base sin la migración: el inicio de siempre, sin "Mi perfil" ni pantalla de perfil', async ({ page }) => {
    const e = await abrir(page, { baseSinMigrar: true });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(new URL(page.url()).hash).toBe('#inicio');
    await expect(page.getByRole('button', { name: 'Mi cuenta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mi perfil' })).toHaveCount(0);
    await expect(page.locator('#app')).not.toContainText(TITULO_PRIMERA);
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('perfil: datos raros, celular y textos', () => {
  test('datos tramposos en la cuenta y en el nombre de una zona: se muestran como texto y se guardan tal cual', async ({ page }) => {
    const ZONA_RARA = `Zona "O'Hara" <b>`;
    const CUENTA_RARA = '</textarea><img src=x onerror="window.__xss=1">';
    const e = await abrir(page);
    e.db.zona_grupos.push({ id: '70000000-0000-4000-8000-000000000099', nombre: ZONA_RARA, zonas: [], orden: 4, fuera_de_montevideo: false, created_at: '2026-09-01T00:00:00Z' });
    e.db.ninieras.find(n => n.id === ID.nAna).cuenta_bancaria = [CUENTA_RARA];
    await page.reload();
    await expect(page.locator('h1')).toHaveText(TITULO_PRIMERA);
    await expect(page.locator('#perfil-cuenta')).toHaveValue(CUENTA_RARA);
    await expect(page.getByText(ZONA_RARA, { exact: true })).toBeVisible();
    await page.locator('.perfil-zona').last().check();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(rpcs(e, 'ninera_guardar_perfil')[0]).toMatchObject({ p_zonas: [ZONA_RARA], p_cuenta: [CUENTA_RARA] });
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });

  test('a 390 px: sin scroll horizontal, casillas de 24 px y renglones para el dedo (captura)', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrir(page);
    await expect(page.locator('h1')).toHaveText(TITULO_PRIMERA);
    await radio(page, 'Ambos').check();
    await page.setInputFiles('#perfil-foto', await pngFicticio(page));
    await expect(page.locator('#perfil-foto-previa')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const tamanos = await page.locator('input[type=radio], input[type=checkbox]').evaluateAll(cs => cs.map(c => {
      const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)];
    }));
    expect(tamanos).toHaveLength(6);
    for (const [w, h] of tamanos) { expect(w).toBeGreaterThanOrEqual(24); expect(h).toBeGreaterThanOrEqual(24); }
    const renglones = await page.locator('label.radio, label.chk').evaluateAll(ls => ls.map(l => l.getBoundingClientRect().height));
    for (const h of renglones) expect(h).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath('ninera-perfil-390.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await page.screenshot({ path: testInfo.outputPath('ninera-perfil-1280.png'), fullPage: true, animations: 'disabled' });
    verificarLimpio(e);
  });

  test('ni la pantalla de perfil ni el inicio muestran montos ni la palabra "pago"', async ({ page }) => {
    const e = await abrir(page, { ninera: ID.nCarla });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    const htmls = [await page.locator('#app').innerHTML()];
    await page.getByRole('button', { name: 'Mi perfil' }).click();
    await expect(page.locator('#app')).toContainText('Foto enviada el');
    htmls.push(await page.locator('#app').innerHTML());
    expect(htmls[1]).toContain('Datos bancarios para pagarte');
    for (const h of htmls) {
      expect(h).not.toMatch(/\$\d/);
      expect(h).not.toMatch(/\bpago\b/i);
    }
    verificarLimpio(e);
  });
});
