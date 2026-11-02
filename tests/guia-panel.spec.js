// La guía en el panel (fase 1, etapa 4, 02/11/2026): en "Elegir niñeras" la que no puede recibir pedidos por la
// guía aparece en su lugar, con la marca ("Le falta la guía" / "Firma vencida") y sin casilla; el error de
// enviar_pedido_app ('ninera_sin_guia'); "Asignar" no se frena pero avisa; la marca "Sin guía" en la lista de
// Niñeras y la fila "Guía" / "RCP presencial" de la ficha. Contra el simulador (tests/support/rpc-guia.js).
// Datos inventados (datosEleccion): hoy es domingo 04/10/2026; Familia (práctica) pide el martes 06/10
// (sPractica, sin mandar todavía); "Niñera (práctica)" y Carla tienen la guía firmada, a Lola le falta y la de
// Mía venció (firmó el 20/09/2025).
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosEleccion, ID } = require('./support/datos');

const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/];
const firma = (ninera_id, firmado_en, extra = {}) => ({ id: `f9300000-0000-4000-8000-${ninera_id.slice(-12)}`, ninera_id, version: '2026.10',
  nombre: 'x', firma_ruta: `firmas/${ninera_id}/${firmado_en.slice(0, 10)}.png`, firmado_en, ...extra });
function datos() {
  const d = datosEleccion();
  d.guia_firmas = [firma(ID.nPractica, '2026-09-15T15:00:00.000Z'), firma(ID.nCarla, '2026-09-16T15:00:00.000Z'), firma(ID.nMia, '2025-09-20T15:00:00.000Z')];
  d.guia_progreso = [];
  d.guia_repasos = [];
  return d;
}
const fila = (page, id) => page.locator(`#editmodal .pedido-fila[data-id="${id}"]`);
const tilde = (page, id) => page.locator(`#editmodal .pedido-tilde[data-id="${id}"]`);
async function abrirElegir(page, solicitudId = ID.sPractica) {
  await irAModulo(page, 'agenda');
  await page.evaluate(i => abrirModalAsignar(i), solicitudId);
  await expect(page.locator('#editmodal .pedido-elegir')).toBeVisible();
  await esperarQuieta(page);
}

test.describe('"Elegir niñeras" con la guía', () => {
  test('la que no puede queda en su lugar con la marca y sin casilla; "Marcar las 10 primeras" no la tilda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirElegir(page);
    await expect(fila(page, ID.nLola)).toBeVisible();
    await expect(fila(page, ID.nLola).locator('.pedido-marcas')).toContainText('Le falta la guía');
    await expect(fila(page, ID.nMia).locator('.pedido-marcas')).toContainText('Firma vencida');
    await expect(tilde(page, ID.nLola)).toHaveCount(0);
    await expect(tilde(page, ID.nMia)).toHaveCount(0);
    await expect(tilde(page, ID.nPractica)).toHaveCount(1);
    await page.getByRole('button', { name: 'Marcar las 10 primeras' }).click();
    await expect(tilde(page, ID.nPractica)).toBeChecked();
    // "Asignar" sigue en su fila, con el aviso.
    await fila(page, ID.nLola).locator('.pedido-asignar input').check();
    await expect(page.locator('#agenda-asignar-guia-aviso')).toHaveText('Lola (práctica) no recibe pedidos por la app: le falta la guía. La podés asignar igual.');
    await fila(page, ID.nPractica).locator('.pedido-asignar input').check();
    await expect(page.locator('#agenda-asignar-guia-aviso')).toHaveText('');
    verificarLimpio(e);
  });

  test('si mientras tanto se le vence la guía, la base la rechaza y el aviso dice quién', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    e.db.app_config.find(c => c.id === 'pedidos_app').valor.solo_practica = true;
    await abrirElegir(page);
    await tilde(page, ID.nPractica).check();
    // Otra admin, otro celular: la firma de la de práctica ya no está.
    e.db.guia_firmas = e.db.guia_firmas.filter(f => f.ninera_id !== ID.nPractica);
    await page.locator('#pedido-enviar').click();
    await expect(page.locator('#pedido-enviar-warn')).toContainText('Niñera (práctica) no puede recibir pedidos por la app (le falta la guía): destildala.');
    expect(e.db.solicitud_ninieras.filter(x => x.solicitud_id === ID.sPractica)).toHaveLength(0);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('base sin la migración de la guía: nadie marcado, todo como antes', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos(), baseSinMigrar: 'etapa4' });
    await abrirElegir(page);
    await expect(page.locator('#editmodal .pedido-marcas', { hasText: 'guía' })).toHaveCount(0);
    await expect(tilde(page, ID.nLola)).toHaveCount(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('"Asignar" desde "Pedidos en curso"', () => {
  async function abrirAsignar(page, snId) {
    await page.evaluate(([s, sn]) => abrirAsignarPedido(s, sn), [ID.sPendiente, snId]);
    await expect(page.locator('#editmodal .asignar-pedido')).toBeVisible();
  }
  test('a la que le falta la guía la deja asignar con el aviso; a la que la tiene, sin aviso', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirAsignar(page, ID.snPendLola);
    await expect(page.locator('#asignar-guia-aviso')).toHaveText('Lola (práctica) no recibe pedidos por la app: le falta la guía. La podés asignar igual.');
    await expect(page.locator('#pedido-asignar-btn')).toBeEnabled();
    await page.evaluate(() => cerrarModal());
    await abrirAsignar(page, ID.snPendPractica);
    await expect(page.locator('#editmodal .asignar-pedido')).toContainText('Quién recibe qué');
    await esperarQuieta(page);
    await expect(page.locator('#asignar-guia-aviso')).toHaveText('');
    verificarLimpio(e);
  });

  test('si la lectura de la guía falla, no hay aviso y se puede asignar igual', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_puede_recibir_pedidos' ? 'red' : null;
    await abrirAsignar(page, ID.snPendLola);
    await esperarQuieta(page);
    await expect(page.locator('#asignar-guia-aviso')).toHaveText('');
    await expect(page.locator('#pedido-asignar-btn')).toBeEnabled();
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('Niñeras: la lista y la ficha', () => {
  async function abrirFicha(page, id) {
    await page.evaluate(i => verNinera(i), id);
    await expect(page.locator('#editmodal.show')).toBeVisible();
    await expect(page.locator('#vn-guia')).not.toHaveText('Cargando…');
  }

  test('la lista marca "Sin guía" solo a las de la app que no pueden', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await irAModulo(page, 'ninieras');
    const filaLista = nombre => page.locator('.person-row', { has: page.locator('.name', { hasText: nombre }) });
    await expect(page.locator('.ninera-sin-guia')).toHaveCount(2); // Lola y Mía
    await expect(filaLista('Lola (práctica)').locator('.ninera-sin-guia')).toHaveText('Sin guía');
    await expect(filaLista('Carla Ejemplo').locator('.ninera-sin-guia')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('la ficha: completa y firmada, con "Ver firma" (link firmado); RCP presencial con su certificado', async ({ page }) => {
    const d = datos();
    Object.assign(d.ninieras.find(n => n.id === ID.nCarla), { rcp_presencial: true, rcp_certificado_ruta: `rcp/${ID.nCarla}/certificado.jpg` });
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'ninieras');
    await abrirFicha(page, ID.nCarla);
    await expect(page.locator('#vn-guia')).toHaveText('Completa, firmada el 16/09/2026 (v2026.10). Ver firma');
    await expect(page.locator('#vn-rcp')).toHaveText('Sí Ver certificado');
    const popup = page.waitForEvent('popup');
    await page.locator('#vn-guia button', { hasText: 'Ver firma' }).click();
    await (await popup).close();
    expect(e.escrituras.filter(w => w.tabla.startsWith('/storage/v1/object/sign/ninieras-privado/firmas/')).map(w => w.tabla))
      .toEqual([`/storage/v1/object/sign/ninieras-privado/firmas/${ID.nCarla}/2026-09-16.png`]);
    verificarLimpio(e);
  });

  test('la ficha: le falta (con lo que leyó), firma vencida y sin cargar el RCP', async ({ page }) => {
    const d = datos();
    d.guia_progreso = ['pr1', 'pr2', 'x1'].map(l => ({ ninera_id: ID.nLola, leccion_id: l, version: '2026.10', leido_en: '2026-10-03T12:00:00.000Z' }));
    d.guia_repasos = [{ ninera_id: ID.nLola, modulo_id: 'protocolos', version: '2026.10', aprobado_en: '2026-10-03T12:00:00.000Z' }];
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'ninieras');
    await abrirFicha(page, ID.nLola);
    await expect(page.locator('#vn-guia')).toHaveText('Le falta la guía: no recibe pedidos hasta terminarla (leyó 3 de 20 lecciones y aprobó 1 de 2 repasos).');
    await expect(page.locator('#vn-rcp')).toHaveText('Sin cargar');
    await page.evaluate(() => cerrarModal());
    await abrirFicha(page, ID.nMia);
    await expect(page.locator('#vn-guia')).toHaveText('Firma vencida: no recibe pedidos hasta que la repase y firme de nuevo (leyó 0 de 20 lecciones y aprobó 0 de 2 repasos). Ver firma');
    verificarLimpio(e);
  });

  test('la ficha de una niñera sin app no tiene la fila "Guía"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await irAModulo(page, 'ninieras');
    await page.evaluate(i => verNinera(i), ID.nAna);
    await expect(page.locator('#editmodal.show')).toBeVisible();
    await expect(page.locator('#vn-guia')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('base sin la migración: sin marcas en la lista y la ficha lo dice', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos(), baseSinMigrar: 'etapa4' });
    await irAModulo(page, 'ninieras');
    await expect(page.locator('.ninera-sin-guia')).toHaveCount(0);
    await abrirFicha(page, ID.nCarla);
    await expect(page.locator('#vn-guia')).toHaveText('Falta actualizar la base para ver la guía.');
    await expect(page.locator('#vn-rcp')).toHaveText('—');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('escape: una ruta de firma tramposa no rompe el botón ni ejecuta nada', async ({ page }) => {
    const d = datos();
    d.guia_firmas.find(f => f.ninera_id === ID.nCarla).firma_ruta = `firmas/x'); window.__xss=1; ('.png`;
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'ninieras');
    await abrirFicha(page, ID.nCarla);
    const popup = page.waitForEvent('popup');
    await page.locator('#vn-guia button', { hasText: 'Ver firma' }).click();
    await (await popup).close();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });

  test('390 px: la ficha sin scroll de costado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: datos() });
    await irAModulo(page, 'ninieras');
    await abrirFicha(page, ID.nLola);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    verificarLimpio(e);
  });
});
