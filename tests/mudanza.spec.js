// Mudanza a parentsbreak.github.io/app (27/10/2026): el aviso "La app se mudó" en el panel (solo en la
// dirección nueva, una vez por dispositivo) y las páginas del repo de redirección que quedan en la
// dirección vieja (docs/mudanza-redireccion/). Nada sale a internet: la app se sirve bajo el host nuevo
// desde los archivos del repo con page.route.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { abrirApp, esperarQuieta, verificarLimpio, servirAppEnDireccionPublicada } = require('./support/app');
const { RAIZ, leer } = require('./support/fuentes');

const ORIGEN_NUEVO = 'https://parentsbreak.github.io';
const APP_NUEVA = ORIGEN_NUEVO + '/app/';
const REDIRECCION = 'docs/mudanza-redireccion/';

const servirAppEnDireccionNueva = servirAppEnDireccionPublicada;

test('hayQueAvisarMudanza: solo en la dirección nueva y mientras no esté la marca', async ({ page }) => {
  const e = await abrirApp(page);
  expect(await page.evaluate(() => [
    hayQueAvisarMudanza('parentsbreak.github.io', null),
    hayQueAvisarMudanza('parentsbreak.github.io', '1'),
    hayQueAvisarMudanza('diegomarin28.github.io', null),
    hayQueAvisarMudanza('localhost', null),
  ])).toEqual([true, false, false, false]);
  verificarLimpio(e);
});

test.describe('en la dirección nueva', () => {
  test('el login muestra la caja "La app se mudó", sin botón', async ({ page }) => {
    await servirAppEnDireccionNueva(page);
    const e = await abrirApp(page, { sesion: false, ruta: APP_NUEVA });
    expect(page.url()).toBe(APP_NUEVA);
    const caja = page.locator('#aviso-mudanza-login');
    await expect(caja).toBeVisible();
    await expect(caja).toContainText('La app se mudó');
    await expect(caja).toContainText('Ahora vive en esta dirección: parentsbreak.github.io/app. Entrá con tu mail y contraseña; después te va a pedir activar Face ID de nuevo. Al entrar aparecen los pasos para reinstalar el ícono.');
    await expect(caja.locator('button')).toHaveCount(0);
    // Arriba del formulario
    expect(await caja.evaluate(el => el.compareDocumentPosition(document.getElementById('login-mail')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
    verificarLimpio(e);
  });

  test('Hoy muestra la tarjeta con los 5 pasos; "Entendido" la saca y no vuelve al recargar', async ({ page }) => {
    await servirAppEnDireccionNueva(page);
    const e = await abrirApp(page, { ruta: APP_NUEVA });
    const tarjeta = page.locator('#aviso-mudanza');
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta.locator('h2')).toHaveText('La app se mudó: reinstalá el ícono');
    await expect(tarjeta.locator('ol li')).toHaveText([
      'Borrá el ícono viejo de Parents’ Break del celular.',
      'Abrí parentsbreak.github.io/app en Safari (en Android, en Chrome).',
      'Tocá Compartir y después Agregar a pantalla de inicio.',
      'Abrí la app desde el ícono nuevo y entrá con tu mail y contraseña.',
      'En el menú, Notificaciones, y tocá Activar notificaciones push.',
    ]);
    // Arriba de todo
    expect(await page.evaluate(() => document.getElementById('modcontent').firstElementChild.id)).toBe('aviso-mudanza');

    const escriturasAntes = e.escrituras.length;
    await tarjeta.getByRole('button', { name: 'Entendido' }).click();
    await expect(tarjeta).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('pb_mudanza_vista'))).toBe('1');
    expect(e.escrituras.length, 'la marca no va a la base').toBe(escriturasAntes);

    await page.reload();
    await expect(page.locator('#modcontent')).toBeVisible();
    await esperarQuieta(page);
    await expect(page.locator('#aviso-mudanza')).toHaveCount(0);
    // El login de este dispositivo tampoco la muestra más
    expect(await page.evaluate(() => avisoMudanzaLoginHtml())).toBe('');
    verificarLimpio(e);
  });

  test.describe('celular de 390 px', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('la tarjeta se ve entera, sin scroll horizontal', async ({ page }) => {
      await servirAppEnDireccionNueva(page);
      const e = await abrirApp(page, { ruta: APP_NUEVA });
      const tarjeta = page.locator('#aviso-mudanza');
      await expect(tarjeta).toBeVisible();
      const caja = await tarjeta.boundingBox();
      expect(caja.x).toBeGreaterThanOrEqual(0);
      expect(caja.x + caja.width).toBeLessThanOrEqual(390);
      expect(caja.y).toBeGreaterThanOrEqual(0);
      expect(caja.y + caja.height).toBeLessThanOrEqual(844);
      const boton = await tarjeta.getByRole('button', { name: 'Entendido' }).boundingBox();
      expect(boton.x + boton.width).toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: 'test-results/mudanza-hoy-390.png' });
      verificarLimpio(e);
    });
  });
});

test.describe('en localhost (como corren todos los tests) y en la dirección vieja', () => {
  test('el login no muestra la caja', async ({ page }) => {
    const e = await abrirApp(page, { sesion: false });
    await expect(page.locator('#aviso-mudanza-login')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('Hoy no muestra la tarjeta', async ({ page }) => {
    const e = await abrirApp(page);
    await expect(page.locator('#aviso-mudanza')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('pb_mudanza_vista'))).toBeNull();
    verificarLimpio(e);
  });
});

test.describe('páginas del repo de redirección (la dirección vieja)', () => {
  test('en el navegador pasan solas a la dirección nueva, con lo que traiga el link', async ({ page }) => {
    await page.route(ORIGEN_NUEVO + '/**', r => r.fulfill({ body: '<!DOCTYPE html><title>destino</title>', contentType: 'text/html' }));
    // El link de invitación de una niñera tiene que llegar entero a /app/ninera/.
    await page.goto('/' + REDIRECCION + 'ninera/index.html?i=abc123#x');
    await page.waitForURL(APP_NUEVA + 'ninera/?i=abc123#x');
    await page.goto('/' + REDIRECCION + 'index.html?acceso=temporal');
    await page.waitForURL(APP_NUEVA + '?acceso=temporal');
    await page.goto('/' + REDIRECCION + 'index.html');
    await page.waitForURL(APP_NUEVA);
  });

  for (const [como, script] of [
    ['navigator.standalone (Safari del iPhone)', () => { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); }],
    ['display-mode: standalone (Android)', () => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = q => /display-mode:\s*standalone/.test(String(q)) ? { matches: true, media: String(q), addEventListener() {}, removeEventListener() {} } : original(q);
    }],
  ]) {
    test(`abiertas desde el ícono viejo (${como}) se quedan, con el botón y los pasos`, async ({ page }) => {
      await page.addInitScript(script);
      await page.goto('/' + REDIRECCION + 'index.html?x=1');
      await expect(page.getByRole('heading', { name: 'La app se mudó' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Abrir la app nueva' })).toHaveAttribute('href', APP_NUEVA + '?x=1');
      await expect(page.locator('ol li')).toHaveCount(5);
      await expect(page.locator('ol li').last()).toHaveText('En el menú, Notificaciones, y tocá Activar notificaciones push.');

      await page.goto('/' + REDIRECCION + 'ninera/index.html');
      await expect(page.getByRole('heading', { name: 'La app se mudó' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Abrir la app nueva' })).toHaveAttribute('href', APP_NUEVA + 'ninera/');
      await expect(page.locator('ol li')).toHaveCount(5);
      await expect(page.locator('ol li').last()).toHaveText('Activa los avisos desde la app.');
      await page.waitForTimeout(300);
      expect(page.url()).toContain('/' + REDIRECCION + 'ninera/');
    });
  }

  test('estático: dirección nueva, chequeo de standalone, sin scripts externos; temporada igual a la raíz', () => {
    for (const [archivo, destino] of [['index.html', APP_NUEVA], ['ninera/index.html', APP_NUEVA + 'ninera/']]) {
      const html = leer(REDIRECCION + archivo);
      expect(html).toContain(`'${destino}'`);
      expect(html).toContain("matchMedia('(display-mode: standalone)')");
      expect(html).toContain('navigator.standalone');
      expect(html).toContain('location.replace(NUEVA + location.search + location.hash)');
      expect(html).toContain('<meta name="color-scheme" content="only light">');
      expect(html).not.toMatch(/<script[^>]+src=/);
    }
    expect(leer(REDIRECCION + 'temporada.html')).toBe(leer('temporada.html'));
    expect(leer(REDIRECCION + 'temporada.html')).toContain("location.replace('https://parentsbreak.pages.dev/temporada' + location.search)");
  });
});
