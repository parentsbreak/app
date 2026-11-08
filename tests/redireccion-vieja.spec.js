// Páginas del repo de redirección (la dirección vieja, diegomarin28.github.io/sistema-parents-break):
// la copia está en docs/mudanza-redireccion/ y sigue publicada en el repo aparte con el nombre viejo.
// Mandan los links viejos (ícono del celular, invitaciones, temporada) a parentsbreak.github.io/app.
// Venían de tests/mudanza.spec.js, que se borró con el aviso "La app se mudó" de la app (08/11/2026).
// Nada sale a internet: la dirección nueva se responde con page.route.
const { test, expect } = require('@playwright/test');
const { leer } = require('./support/fuentes');

const ORIGEN_NUEVO = 'https://parentsbreak.github.io';
const APP_NUEVA = ORIGEN_NUEVO + '/app/';
const REDIRECCION = 'docs/mudanza-redireccion/';

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
