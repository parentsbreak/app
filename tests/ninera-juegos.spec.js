// App de niñeras (fase 1, etapa 12, 03/11/2026; docs/fase1/etapa12-guia-sitting.md): los juegos del kit de la guía de
// Paulina dentro de las lecciones de actividades, iguales al original (docs/fase1/guia-original.html): las pestañas de
// cada kit, la búsqueda del tesoro, el bingo (cuatro en línea), la sopa de letras, el laberinto con el dedo, emociones,
// el ta-te-ti (gana, empate, de nuevo) y el diario; que no guarden nada; que las lecciones sin kit no tengan juegos y
// 390 px. Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { ID, datosBase } = require('./support/datos');

const RUIDO = { ignorar: [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/] };

async function abrir(page) {
  const datos = datosBase();
  Object.assign(datos.ninieras.find(n => n.id === ID.nAna), { zona: 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00' });
  await page.addInitScript(() => { delete window.PushManager; });
  const e = await abrirAppNinera(page, { datos, ahora: '2026-10-04T12:00:00-03:00' });
  await expect(page.locator('#inicio-boton-guia')).toBeVisible();
  return e;
}
async function abrirLeccion(page, modulo, leccion) {
  await page.locator('#inicio-boton-guia').click();
  await page.locator(`.guia-modulo[data-modulo="${modulo}"]`).click();
  await page.locator(`.guia-leccion-fila[data-leccion="${leccion}"]`).click();
  await expect(page.locator('#guia-leccion')).toBeVisible();
}
const pestanas = page => page.locator('#guia-kit .kitnav button');
const hojaVisible = page => page.locator('#guia-kit .sheet:visible');

test.describe('los juegos de la guía', () => {
  test('Edad escolar: el kit debajo de "Para jugar acá", con sus seis pestañas y uno visible por vez', async ({ page }) => {
    const e = await abrir(page);
    await abrirLeccion(page, 'escolar', 'act-s');
    await expect(page.locator('#guia-leccion h3').last()).toHaveText('Para jugar acá');
    await expect(pestanas(page)).toHaveText(['Búsqueda del tesoro', 'Bingo de la plaza', 'Sopa de letras', 'Laberinto', 'Ta-te-ti', 'Hoy con mi niñera']);
    await expect(page.locator('#guia-kit .kitnav')).toHaveAttribute('role', 'tablist');
    await expect(hojaVisible(page)).toHaveCount(1);
    await expect(hojaVisible(page).locator('h3')).toHaveText('Búsqueda del tesoro');
    await expect(hojaVisible(page).locator('.sh-head small')).toHaveText('3 a 8 años');
    await expect(pestanas(page).first()).toHaveAttribute('aria-selected', 'true');
    await pestanas(page).filter({ hasText: 'Ta-te-ti' }).click();
    await expect(hojaVisible(page).locator('h3')).toHaveText('Ta-te-ti');
    await expect(pestanas(page).filter({ hasText: 'Ta-te-ti' })).toHaveAttribute('aria-selected', 'true');
    await expect(pestanas(page).first()).toHaveAttribute('aria-selected', 'false');
    // El kit va antes de "Ya lo leí".
    const orden = await page.evaluate(() => {
      const kit = document.getElementById('guia-kit'), boton = [...document.querySelectorAll('button')].find(b => b.textContent === 'Ya lo leí');
      return !!(kit.compareDocumentPosition(boton) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(orden).toBe(true);
    verificarLimpio(e, RUIDO);
  });

  test('los kits de cada edad son los del original; una lección sin kit no tiene juegos', async ({ page }) => {
    const e = await abrir(page);
    await abrirLeccion(page, 'toddlers', 'act-t');
    await expect(pestanas(page)).toHaveText(['Emociones']);
    await expect(page.locator('#guia-leccion')).toContainText('Tocá "Emociones" y que el chico elija cómo se siente.');
    await page.getByRole('button', { name: 'Volver a Toddlers' }).click();
    await page.locator('.guia-leccion-fila[data-leccion="t2"]').click();
    await expect(page.locator('#guia-kit')).toBeEmpty();
    await expect(page.locator('#guia-leccion')).not.toContainText('Para jugar acá');
    await page.getByRole('button', { name: 'Volver a Toddlers' }).click();
    await page.getByRole('button', { name: 'Volver a la guía' }).click();
    await page.locator('.guia-modulo[data-modulo="preescolares"]').click();
    await page.locator('.guia-leccion-fila[data-leccion="act-p"]').click();
    await expect(pestanas(page)).toHaveText(['Búsqueda del tesoro', 'Emociones', 'Laberinto', 'Bingo de la plaza', 'Hoy con mi niñera']);
    await page.getByRole('button', { name: 'Volver a Preescolares' }).click();
    await page.getByRole('button', { name: 'Volver a la guía' }).click();
    await page.locator('.guia-modulo[data-modulo="preteens"]').click();
    await page.locator('.guia-leccion-fila[data-leccion="act-y"]').click();
    await expect(pestanas(page)).toHaveText(['Ta-te-ti', 'Sopa de letras']);
    verificarLimpio(e, RUIDO);
  });

  test('búsqueda del tesoro y sopa de letras: se marca y se desmarca; los 8 animales se tachan', async ({ page }) => {
    const e = await abrir(page);
    await abrirLeccion(page, 'escolar', 'act-s');
    const cosas = hojaVisible(page).locator('.chk button');
    await expect(cosas).toHaveCount(12);
    await expect(cosas.first()).toHaveText('Algo rojo');
    await cosas.first().click();
    await expect(cosas.first()).toHaveClass(/\bon\b/);
    await cosas.first().click();
    await expect(cosas.first()).not.toHaveClass(/\bon\b/);
    await pestanas(page).filter({ hasText: 'Sopa de letras' }).click();
    await expect(hojaVisible(page).locator('.sopa button')).toHaveCount(100);
    await expect(hojaVisible(page).locator('.sopa button').first()).toHaveText('U');
    await expect(hojaVisible(page).locator('.words button')).toHaveText(['PERRO', 'GATO', 'LORO', 'VACA', 'PATO', 'OSO', 'LEON', 'MONO']);
    await hojaVisible(page).locator('.words button', { hasText: 'GATO' }).click();
    await expect(hojaVisible(page).locator('.words button', { hasText: 'GATO' })).toHaveCSS('text-decoration-line', 'line-through');
    verificarLimpio(e, RUIDO);
  });

  test('bingo: cuatro en línea (fila, columna o diagonal) dice "¡Bingo!" y desmarcar lo saca', async ({ page }) => {
    const e = await abrir(page);
    await abrirLeccion(page, 'escolar', 'act-s');
    await pestanas(page).filter({ hasText: 'Bingo de la plaza' }).click();
    const casillas = hojaVisible(page).locator('.bingo button');
    const aviso = hojaVisible(page).locator('.sh-win');
    await expect(casillas).toHaveCount(16);
    for (const i of [0, 5, 10]) await casillas.nth(i).click();
    await expect(aviso).toHaveText('');
    await casillas.nth(15).click();
    await expect(aviso).toHaveText('¡Bingo!');
    await casillas.nth(15).click();
    await expect(aviso).toHaveText('');
    for (const i of [4, 8, 12]) await casillas.nth(i).click(); // columna 0 con el 0
    await expect(aviso).toHaveText('¡Bingo!');
    verificarLimpio(e, RUIDO);
  });

  test('ta-te-ti: turnos, gana la O, empate y "Jugar de nuevo"', async ({ page }) => {
    const e = await abrir(page);
    await abrirLeccion(page, 'preteens', 'act-y');
    const c = hojaVisible(page).locator('.ttt button');
    const aviso = hojaVisible(page).locator('.sh-win');
    await expect(aviso).toHaveText('Turno de X');
    for (const i of [0, 3, 1, 4, 8, 5]) await c.nth(i).click();
    await expect(aviso).toHaveText('¡Ganó O!');
    await expect(c.nth(3)).toHaveClass(/\bo\b/);
    await c.nth(2).click(); // terminado: no marca
    await expect(c.nth(2)).toHaveText('');
    await hojaVisible(page).getByRole('button', { name: 'Jugar de nuevo' }).click();
    await expect(aviso).toHaveText('Turno de X');
    await expect(c.nth(0)).toHaveAttribute('aria-label', 'casilla vacía');
    for (const i of [0, 1, 2, 4, 3, 5, 7, 6, 8]) await c.nth(i).click();
    await expect(aviso).toHaveText('Empate');
    verificarLimpio(e, RUIDO);
  });

  test('emociones y el diario: la cara elegida, una sola marcada; el diario con sus cinco renglones', async ({ page }) => {
    const e = await abrir(page);
    await abrirLeccion(page, 'preescolares', 'act-p');
    await pestanas(page).filter({ hasText: 'Emociones' }).click();
    const caras = hojaVisible(page).locator('.emos button');
    await expect(caras).toHaveText(['Contento', 'Triste', 'Enojado', 'Asustado', 'Sorprendido', 'Cansado']);
    await caras.nth(1).click();
    await expect(hojaVisible(page).locator('.sh-win')).toHaveText('Hoy me siento triste');
    await caras.nth(5).click();
    await expect(hojaVisible(page).locator('.emos button.on')).toHaveText(['Cansado']);
    await pestanas(page).filter({ hasText: 'Hoy con mi niñera' }).click();
    await expect(hojaVisible(page).locator('.diary label')).toHaveText(['Me llamo', 'Mi niñera se llama', 'Hoy jugamos a', 'Comí', 'Lo que más me gustó']);
    await expect(hojaVisible(page).locator('.dlabel')).toHaveText('Hoy me sentí');
    await expect(hojaVisible(page).locator('.dfeel button')).toHaveCount(6);
    verificarLimpio(e, RUIDO);
  });

  test('laberinto: se dibuja con el dedo y "Borrar y volver a empezar" lo limpia', async ({ page }) => {
    const e = await abrir(page);
    await abrirLeccion(page, 'escolar', 'act-s');
    await pestanas(page).filter({ hasText: 'Laberinto' }).click();
    const cv = hojaVisible(page).locator('canvas.maze');
    await expect(cv).toHaveAttribute('aria-label', 'Laberinto para recorrer con el dedo');
    const imagen = () => cv.evaluate(c => c.toDataURL());
    const limpio = await imagen();
    await cv.scrollIntoViewIfNeeded();
    const caja = await cv.boundingBox();
    await page.mouse.move(caja.x + 30, caja.y + 50);
    await page.mouse.down();
    await page.mouse.move(caja.x + 80, caja.y + 90, { steps: 5 });
    await page.mouse.up();
    expect(await imagen()).not.toBe(limpio);
    await hojaVisible(page).getByRole('button', { name: 'Borrar y volver a empezar' }).click();
    expect(await imagen()).toBe(limpio);
    verificarLimpio(e, RUIDO);
  });

  test('nada se guarda: lo marcado y lo escrito se borran al salir, sin tocar el celular ni la base', async ({ page }) => {
    const e = await abrir(page);
    const antes = await page.evaluate(() => ({ local: Object.keys(localStorage).sort(), session: Object.keys(sessionStorage).sort() }));
    const escriturasAntes = e.escrituras.length;
    await abrirLeccion(page, 'escolar', 'act-s');
    await hojaVisible(page).locator('.chk button').first().click();
    await pestanas(page).filter({ hasText: 'Hoy con mi niñera' }).click();
    await hojaVisible(page).locator('.diary input').first().fill('Nombre inventado');
    await page.getByRole('button', { name: 'Volver a Edad escolar' }).click();
    await page.locator('.guia-leccion-fila[data-leccion="act-s"]').click();
    await expect(hojaVisible(page).locator('.chk button.on')).toHaveCount(0);
    await pestanas(page).filter({ hasText: 'Hoy con mi niñera' }).click();
    await expect(hojaVisible(page).locator('.diary input').first()).toHaveValue('');
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage).sort(), session: Object.keys(sessionStorage).sort() }))).toEqual(antes);
    expect(e.escrituras.slice(escriturasAntes)).toEqual([]);
    verificarLimpio(e, RUIDO);
  });

  test('a 390 px: cada juego entra sin scroll de costado (captura del bingo y la sopa)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrir(page);
    await abrirLeccion(page, 'escolar', 'act-s');
    for (const nombre of ['Búsqueda del tesoro', 'Bingo de la plaza', 'Sopa de letras', 'Laberinto', 'Ta-te-ti', 'Hoy con mi niñera']) {
      await pestanas(page).filter({ hasText: nombre }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), nombre).toBeLessThanOrEqual(390);
      const caja = await hojaVisible(page).boundingBox();
      expect(caja.x + caja.width, nombre).toBeLessThanOrEqual(390);
      if (nombre === 'Bingo de la plaza' || nombre === 'Sopa de letras') {
        await hojaVisible(page).screenshot({ path: `test-results/ninera-juego-${nombre === 'Sopa de letras' ? 'sopa' : 'bingo'}-390.png` });
      }
    }
    verificarLimpio(e, RUIDO);
  });
});
