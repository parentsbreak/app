// Bug en producción (31/10/2026): en el iPhone el botón "Entrar" del login quedaba fuera de la
// pantalla y no se podía scrollear. .loginstage es position:fixed con inset:0 y no scrolleaba; con el
// aviso "La app se mudó" el contenido medía más que la pantalla (a 390×664 el botón quedaba en 789).
// Estos tests scrollean como una persona (la rueda / el dedo, no scrollIntoView, que mueve aunque haya
// overflow:hidden) y miran que el botón principal de cada pantalla de login quede a la vista, y que lo
// de arriba no quede cortado. Con pantallas chicas: 375×560 y 390×664.
const { test, expect } = require('@playwright/test');
const { abrirApp, verificarLimpio, servirAppEnDireccionPublicada, APP_PUBLICADA } = require('./support/app');

const PANTALLAS = [{ width: 375, height: 560 }, { width: 390, height: 664 }];

// Scrollea hacia abajo con la rueda en el medio de la pantalla hasta que no se mueve más.
async function scrollearHastaAbajo(page, vp) {
  await page.mouse.move(vp.width / 2, vp.height / 2);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
  await page.waitForTimeout(150);
}
async function aLaVista(page, selector, vp) {
  const caja = await page.locator(selector).boundingBox();
  expect(caja, `${selector} existe`).not.toBeNull();
  expect(caja.y, `${selector} no queda arriba de la pantalla`).toBeGreaterThanOrEqual(0);
  expect(caja.y + caja.height, `${selector} entra en la pantalla (${vp.height})`).toBeLessThanOrEqual(vp.height);
}
// Lo de arriba (el título del formulario) no queda cortado: con el scroll arriba, se ve entero.
async function arribaSinCortar(page, selector) {
  await page.evaluate(() => { const s = document.querySelector('.loginstage'); if (s) s.scrollTop = 0; });
  const caja = await page.locator(selector).first().boundingBox();
  expect(caja.y, `${selector} no queda cortado arriba`).toBeGreaterThanOrEqual(0);
}

for (const vp of PANTALLAS) {
  test.describe(`login a ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test('con el aviso "La app se mudó", "Entrar" se alcanza scrolleando y lo de arriba no se corta', async ({ page }) => {
      await servirAppEnDireccionPublicada(page);
      const e = await abrirApp(page, { sesion: false, ruta: APP_PUBLICADA });
      await expect(page.locator('#aviso-mudanza-login')).toBeVisible();
      await scrollearHastaAbajo(page, vp);
      await aLaVista(page, '#loginbtn', vp);
      // Se puede tocar de verdad (sin nada encima).
      await page.locator('#loginbtn').click({ trial: true });
      await arribaSinCortar(page, '.loginwrap h2');
      verificarLimpio(e);
    });

    test('sin el aviso (localhost), igual se alcanza', async ({ page }) => {
      const e = await abrirApp(page, { sesion: false });
      await scrollearHastaAbajo(page, vp);
      await aLaVista(page, '#loginbtn', vp);
      verificarLimpio(e);
    });

    for (const [nombre, render, boton] of [
      ['"Un paso más" (activar Face ID)', "renderPantallaBiometrica('registrar')", '#bio-btn'],
      ['"Confirmá que sos vos"', "renderPantallaBiometrica('confirmar')", '#bio-btn'],
      ['cambio de contraseña obligatorio', 'renderCambioPasswordObligatorio()', '#op-btn'],
      ['contraseña nueva (recuperar)', 'renderNuevaContrasena()', '#np-btn'],
    ]) {
      test(`${nombre}: el botón principal se alcanza`, async ({ page }) => {
        const e = await abrirApp(page, { sesion: false });
        await page.evaluate(js => { (0, eval)(js); }, render);
        await expect(page.locator(boton)).toHaveCount(1);
        await scrollearHastaAbajo(page, vp);
        await aLaVista(page, boton, vp);
        await arribaSinCortar(page, '.loginwrap h2');
        verificarLimpio(e);
      });
    }
  });
}
