// Celular obligatorio para una niñera (27/10/2026, pedido de Diego): en el alta y al editar, salvo
// que solo haga traslados. Lo escrito, con cualquier tipo, tiene que ser un celular uruguayo (la
// misma regla que normalizarCelular, la que arma su cuenta de la app) y se guarda como se escribió.
// Las niñeras viejas sin celular quedan como están: se les exige recién al editarlas. Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { datosBase } = require('./support/datos');

const FALTA = 'Falta el celular: para una niñera es obligatorio.';
const REVISAR = 'Revisá el celular: tiene que ser uruguayo, de 8 dígitos y empezar en 9 (099 123 456 o +598 99 123 456).';
const N_VIEJA = '30000000-0000-4000-8000-000000000009';

const toasts = page => page.locator('.toaststack .toast');
const modal = page => page.locator('#editmodal');
const altas = e => e.escrituras.filter(w => w.tabla === 'ninieras' && w.metodo === 'POST');
const ediciones = e => e.escrituras.filter(w => w.tabla === 'ninieras' && w.metodo === 'PATCH');

async function abrirAlta(page) {
  await irAModulo(page, 'ninieras');
  await page.locator('button[onclick^="abrirModalNuevaNinera"]').click();
  await expect(modal(page).locator('h2')).toHaveText('Nueva niñera');
}
const agregar = page => modal(page).locator('button', { hasText: 'Agregar niñera' }).click();
const guardar = page => modal(page).getByRole('button', { name: /^Guardar/ }).last().click();

// Una niñera de antes de la app, sin celular.
function datosConVieja() {
  const d = datosBase();
  d.ninieras.push({ ...d.ninieras[0], id: N_VIEJA, nombre: 'Dora Antigua', telefono: null, tipo: 'Niñera', candidata_id: null, temporada_token: '60000000-0000-4000-8000-000000000009' });
  return d;
}
const editarVieja = page => page.evaluate(id => { ninTempOmitidas.add(id); editarNinera(id); }, N_VIEJA);

test.describe('alta', () => {
  test('sin celular no se guarda: avisa, deja el formulario abierto y el foco en el celular', async ({ page }) => {
    const e = await abrirApp(page);
    await abrirAlta(page);
    await expect(modal(page).locator('.helper').first()).toContainText('Nombre y celular son obligatorios');
    await expect(modal(page).locator('label', { hasText: /^Celular$/ })).toHaveCount(1);
    await page.fill('#nn-nombre', 'Martina Nueva');
    await agregar(page);
    await expect(toasts(page).last()).toHaveText(FALTA);
    await expect(modal(page)).toHaveCount(1);
    await expect(page.locator('#nn-telefono')).toBeFocused();
    expect(e.escrituras).toEqual([]);
    verificarLimpio(e);
  });

  test('un celular que no es uruguayo no se guarda', async ({ page }) => {
    const e = await abrirApp(page);
    await abrirAlta(page);
    await page.fill('#nn-nombre', 'Martina Nueva');
    await page.fill('#nn-telefono', '123');
    await agregar(page);
    await expect(toasts(page).last()).toHaveText(REVISAR);
    await expect(modal(page)).toHaveCount(1);
    expect(e.escrituras).toEqual([]);
    verificarLimpio(e);
  });

  for (const celular of ['099 123 456', '+598 99 123 456']) {
    test(`con "${celular}" se guarda tal cual se escribió`, async ({ page }) => {
      const e = await abrirApp(page);
      await abrirAlta(page);
      await page.fill('#nn-nombre', 'Martina Nueva');
      await page.fill('#nn-telefono', ` ${celular} `);
      await agregar(page);
      await expect(modal(page)).toHaveCount(0);
      expect(altas(e)).toHaveLength(1);
      expect(altas(e)[0].cuerpo).toMatchObject({ nombre: 'Martina Nueva', telefono: celular, tipo: 'Niñera' });
      verificarLimpio(e);
    });
  }

  test('si solo hace traslados, el celular es opcional', async ({ page }) => {
    const e = await abrirApp(page);
    await abrirAlta(page);
    await page.fill('#nn-nombre', 'Chofer Nuevo');
    await page.selectOption('#nn-tipo', 'Traslados');
    await agregar(page);
    await expect(modal(page)).toHaveCount(0);
    expect(altas(e)).toHaveLength(1);
    expect(altas(e)[0].cuerpo).toMatchObject({ nombre: 'Chofer Nuevo', telefono: null, tipo: 'Traslados' });
    verificarLimpio(e);
  });

  test('con traslados, lo escrito igual tiene que ser un celular', async ({ page }) => {
    const e = await abrirApp(page);
    await abrirAlta(page);
    await page.fill('#nn-nombre', 'Chofer Nuevo');
    await page.selectOption('#nn-tipo', 'Traslados');
    await page.fill('#nn-telefono', '123');
    await agregar(page);
    await expect(toasts(page).last()).toHaveText(REVISAR);
    await expect(modal(page)).toHaveCount(1);
    expect(e.escrituras).toEqual([]);
    verificarLimpio(e);
  });

  test('con tipo "Ambas" el celular es obligatorio', async ({ page }) => {
    const e = await abrirApp(page);
    await abrirAlta(page);
    await page.fill('#nn-nombre', 'Martina Nueva');
    await page.selectOption('#nn-tipo', 'Ambas');
    await agregar(page);
    await expect(toasts(page).last()).toHaveText(FALTA);
    await expect(modal(page)).toHaveCount(1);
    expect(e.escrituras).toEqual([]);
    verificarLimpio(e);
  });
});

test.describe('edición de una niñera vieja sin celular', () => {
  test('Guardar exige el celular; con uno válido guarda tal cual', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConVieja() });
    await irAModulo(page, 'ninieras');
    await editarVieja(page);
    await expect(modal(page).locator('label', { hasText: /^Celular$/ })).toHaveCount(1);
    await guardar(page);
    await expect(toasts(page).last()).toHaveText(FALTA);
    await expect(modal(page)).toHaveCount(1);
    await expect(page.locator('#ed-telefono')).toBeFocused();
    expect(e.escrituras).toEqual([]);
    await page.fill('#ed-telefono', '  099 000 009 ');
    await guardar(page);
    await expect(modal(page)).toHaveCount(0);
    await expect(toasts(page).last()).toHaveText('Cambios guardados.');
    expect(ediciones(e)).toHaveLength(1);
    expect(ediciones(e)[0].cuerpo).toMatchObject({ telefono: '099 000 009', tipo: 'Niñera' });
    verificarLimpio(e);
  });

  test('un celular mal escrito no guarda nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConVieja() });
    await irAModulo(page, 'ninieras');
    await editarVieja(page);
    await page.fill('#ed-telefono', '+54 11 5555 5555');
    await guardar(page);
    await expect(toasts(page).last()).toHaveText(REVISAR);
    await expect(modal(page)).toHaveCount(1);
    expect(e.escrituras).toEqual([]);
    verificarLimpio(e);
  });

  test('si pasa a hacer solo traslados, guarda sin celular', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConVieja() });
    await irAModulo(page, 'ninieras');
    await editarVieja(page);
    await page.selectOption('#ed-tipo', 'Traslados');
    await guardar(page);
    await expect(modal(page)).toHaveCount(0);
    expect(ediciones(e)).toHaveLength(1);
    expect(ediciones(e)[0].cuerpo).toMatchObject({ telefono: null, tipo: 'Traslados' });
    verificarLimpio(e);
  });
});

test('la regla, caso por caso (problemaCelularNinera)', async ({ page }) => {
  const e = await abrirApp(page);
  const casos = [
    // sin nada escrito: obligatorio salvo traslados; sin tipo cuenta como niñera (la base pone 'Niñera')
    [null, 'Niñera', FALTA], ['', 'Niñera', FALTA], ['  ', 'Niñera', FALTA], ['', 'Ambas', FALTA],
    [null, null, FALTA], [null, undefined, FALTA], ['', 'Traslados', ''], [null, 'Traslados', ''],
    // escrito: todas las formas que entiende normalizarCelular, con cualquier tipo
    ['99123456', 'Niñera', ''], ['099 123 456', 'Niñera', ''], ['+598 99 123 456', 'Ambas', ''],
    ['00598 99 123 456', 'Niñera', ''], ['099123456', undefined, ''], ['099 123 456', 'Traslados', ''],
    // escrito y no es un celular uruguayo
    ['123', 'Niñera', REVISAR], ['+54 11 5555 5555', 'Niñera', REVISAR], ['123', 'Traslados', REVISAR],
    ['2901 1234', 'Niñera', REVISAR], ['09912345', 'Niñera', REVISAR], ['0991234567', 'Niñera', REVISAR],
  ];
  const resultados = await page.evaluate(casos => casos.map(([tel, tipo]) => problemaCelularNinera(tel, tipo)), casos);
  expect(resultados).toEqual(casos.map(c => c[2]));
  verificarLimpio(e);
});

test('celular de 390 px: el aviso se ve y el formulario no tiene scroll de costado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const e = await abrirApp(page);
  await abrirAlta(page);
  await page.fill('#nn-nombre', 'Martina Nueva');
  await agregar(page);
  await expect(toasts(page).last()).toHaveText(FALTA);
  await expect(toasts(page).last()).toBeVisible();
  const caja = await modal(page).locator('.confirmbox').evaluate(el => [el.scrollWidth, el.clientWidth]);
  expect(caja[0]).toBeLessThanOrEqual(caja[1]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  verificarLimpio(e);
});
