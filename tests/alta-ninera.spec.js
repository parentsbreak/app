// Alta directa de niñera (PR 8, 05/10/2026, E5): nombre y celular obligatorios (el celular, salvo que
// solo haga traslados; 27/10/2026, tests/celular-ninera.spec.js); lo demás se completa después.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');

async function abrirAlta(page) {
  await irAModulo(page, 'ninieras');
  await page.locator('button[onclick^="abrirModalNuevaNinera"]').click();
  await expect(page.locator('#editmodal h2')).toHaveText('Nueva niñera');
}
const guardar = page => page.locator('#editmodal button', { hasText: 'Agregar niñera' }).click();

test('con el nombre y el celular se crea la niñera y aparece en la lista', async ({ page }) => {
  const e = await abrirApp(page);
  await abrirAlta(page);
  await page.fill('#nn-nombre', '  Martina   Nueva ');
  await page.fill('#nn-telefono', '099 123 456');
  await guardar(page);
  await expect(page.locator('#editmodal')).toHaveCount(0);
  const alta = e.escrituras.filter(w => w.tabla === 'ninieras' && w.metodo === 'POST');
  expect(alta).toHaveLength(1);
  expect(alta[0].cuerpo).toEqual({ nombre: 'Martina Nueva', telefono: '099 123 456', tipo: 'Niñera', zona: null, cuenta_bancaria: [], notas: null, activa: true });
  await esperarQuieta(page);
  await expect(page.locator('#ninierasgrid')).toContainText('Martina Nueva');
  await expect(page.locator('.toaststack .toast').last()).toContainText('Martina Nueva ya está en Niñeras');
  verificarLimpio(e);
});

test('sin nombre no guarda nada y lo dice', async ({ page }) => {
  const e = await abrirApp(page);
  await abrirAlta(page);
  await page.fill('#nn-telefono', '099123123');
  await guardar(page);
  await expect(page.locator('.toaststack .toast').last()).toContainText('Falta el nombre');
  await expect(page.locator('#editmodal')).toHaveCount(1);
  expect(e.escrituras).toEqual([]);
  verificarLimpio(e);
});

test('los campos opcionales se guardan si se completan', async ({ page }) => {
  const e = await abrirApp(page);
  await abrirAlta(page);
  await page.fill('#nn-nombre', 'Sofía Completa');
  await page.fill('#nn-telefono', '099 555 444');
  await page.selectOption('#nn-tipo', 'Ambas');
  await page.locator('#nn-zonas-checklist input[value="Pocitos"]').check();
  await page.locator('#nn-cb-filas .cb-numero').first().fill('001122334');
  await page.fill('#nn-notas', 'Recomendada por una familia');
  await guardar(page);
  await expect(page.locator('#editmodal')).toHaveCount(0);
  const alta = e.escrituras.find(w => w.tabla === 'ninieras' && w.metodo === 'POST');
  expect(alta.cuerpo).toMatchObject({ nombre: 'Sofía Completa', telefono: '099 555 444', tipo: 'Ambas', zona: 'Pocitos', notas: 'Recomendada por una familia', activa: true });
  expect(alta.cuerpo.cuenta_bancaria.join(' ')).toContain('001122334');
  verificarLimpio(e);
});

test('si solo hace traslados, se crea con el nombre solo', async ({ page }) => {
  const e = await abrirApp(page);
  await abrirAlta(page);
  await page.fill('#nn-nombre', 'Chofer Nuevo');
  await page.selectOption('#nn-tipo', 'Traslados');
  await guardar(page);
  await expect(page.locator('#editmodal')).toHaveCount(0);
  const alta = e.escrituras.filter(w => w.tabla === 'ninieras' && w.metodo === 'POST');
  expect(alta).toHaveLength(1);
  expect(alta[0].cuerpo).toEqual({ nombre: 'Chofer Nuevo', telefono: null, tipo: 'Traslados', zona: null, cuenta_bancaria: [], notas: null, activa: true });
  verificarLimpio(e);
});

test('si el nombre se parece a una que ya existe, pregunta antes de crearla', async ({ page }) => {
  const e = await abrirApp(page);
  await abrirAlta(page);
  await page.fill('#nn-nombre', 'Ana Ficticio');
  await page.fill('#nn-telefono', '099 123 456');
  await guardar(page);
  await expect(page.locator('.confirmoverlay:not(#editmodal)')).toContainText('Ana Ficticia');
  await page.locator('.confirmoverlay:not(#editmodal) button', { hasText: 'Cancelar' }).click();
  expect(e.escrituras).toEqual([]);
  verificarLimpio(e);
});

test('si la base falla, avisa y no cierra el formulario', async ({ page }) => {
  const e = await abrirApp(page);
  await abrirAlta(page);
  await page.fill('#nn-nombre', 'Niñera Con Error');
  await page.fill('#nn-telefono', '099 123 456');
  e.fallar = ({ tabla }) => tabla === 'ninieras' ? { message: 'falla simulada' } : undefined;
  await guardar(page);
  await expect(page.locator('.toaststack .toast').last()).toContainText('No se pudo agregar');
  await expect(page.locator('#editmodal')).toHaveCount(1);
  verificarLimpio(e, { ignorar: [/Failed to load resource/] });
});
