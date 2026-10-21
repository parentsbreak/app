// Borrador de la entrevista en la base (21/10/2026, tabla borradores): además del borrador del
// dispositivo, una copia en la base cada 5 segundos como mucho y al salir de cada campo, para
// seguir desde otro dispositivo. Sin la tabla, o si la base falla, todo sigue con el del
// dispositivo y sin avisos. Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { ID } = require('./support/datos');

const USUARIA = '00000000-0000-4000-8000-000000000001'; // la de la sesión de los tests
const CLAVE = 'entrevista:' + ID.cIntake;
async function agendar(page) {
  await irAModulo(page, 'rrhh');
  await page.evaluate(async () => { await agendarDesdeIntake(0); });
  await esperarQuieta(page);
}
const subidas = e => e.escrituras.filter(w => w.tabla === 'borradores' && w.metodo === 'POST');
const borrados = e => e.escrituras.filter(w => w.tabla === 'borradores' && w.metodo === 'DELETE');
const aviso = page => page.locator('#entrevista-borrador-aviso');

test('al salir de un campo, la copia en la base va enseguida, con la usuaria y la candidata', async ({ page }) => {
  const e = await abrirApp(page);
  await agendar(page);
  await page.fill('#f-notas', 'Muy buena impresión');
  await page.locator('#f-notas').blur();
  await expect.poll(() => subidas(e).at(-1)?.cuerpo.datos.campos['f-notas']).toBe('Muy buena impresión');
  const w = subidas(e).at(-1);
  expect(w.cuerpo).toMatchObject({ usuaria: USUARIA, clave: CLAVE });
  expect(w.cuerpo.datos.nombre).toBe('Lucía Muestra');
  expect(w.cuerpo.datos.campos['f-notas']).toBe('Muy buena impresión');
  expect(w.params.on_conflict).toBe('usuaria,clave');
  verificarLimpio(e);
});

test('mientras escribe, la primera copia va enseguida y después una cada 5 segundos como mucho (no una por tecla)', async ({ page }) => {
  const e = await abrirApp(page);
  await agendar(page);
  await page.locator('#f-notas').pressSequentially('Escribe sin parar', { delay: 20 }); // 17 teclas
  await page.waitForTimeout(1000);
  expect(subidas(e).length).toBe(1);
  await expect.poll(() => subidas(e).length, { timeout: 8000 }).toBe(2);
  expect(subidas(e).at(-1).cuerpo.datos.campos['f-notas']).toBe('Escribe sin parar');
  await page.waitForTimeout(1000);
  expect(subidas(e).length).toBe(2);
  verificarLimpio(e);
});

test('desde otro dispositivo (sin nada guardado ahí): ofrece el borrador de la base y lo pone', async ({ page, browser }) => {
  const e = await abrirApp(page);
  await agendar(page);
  await page.fill('#f-telefono', '099123456');
  await page.fill('#f-notas', 'Seguimos en el celular');
  await page.locator('#f-notas').blur();
  await expect.poll(() => subidas(e).length).toBeGreaterThan(0);
  const fila = { id: 'b2000000-0000-4000-8000-000000000001', ...subidas(e).at(-1).cuerpo };
  // El otro dispositivo: otro navegador, sin localStorage.
  const otro = await browser.newContext();
  const p2 = await otro.newPage();
  const e2 = await abrirApp(p2, { datos: { borradores: [fila] } });
  await agendar(p2);
  await expect(aviso(p2)).toContainText('Tenés un borrador de la entrevista de Lucía Muestra');
  await aviso(p2).getByRole('button', { name: 'Seguir' }).click();
  await expect(p2.locator('#f-telefono')).toHaveValue('099123456');
  await expect(p2.locator('#f-notas')).toHaveValue('Seguimos en el celular');
  verificarLimpio(e2);
  await otro.close();
  verificarLimpio(e);
});

test('si el del dispositivo es más nuevo que el de la base, se queda el del dispositivo', async ({ page }) => {
  const viejo = { id: 'b2000000-0000-4000-8000-000000000002', usuaria: USUARIA, clave: CLAVE, actualizado_at: '2026-10-01T12:00:00Z',
    datos: { nombre: 'Lucía Muestra', estado: { candidataId: ID.cIntake }, campos: { 'f-notas': 'Versión vieja de la base' }, zonas: {} } };
  const e = await abrirApp(page, { datos: { borradores: [viejo] } });
  await agendar(page);
  await page.fill('#f-notas', 'Versión nueva del dispositivo');
  await page.waitForTimeout(600);
  await irAModulo(page, 'agenda');
  await irAModulo(page, 'rrhh');
  await aviso(page).getByRole('button', { name: 'Seguir' }).click();
  await expect(page.locator('#f-notas')).toHaveValue('Versión nueva del dispositivo');
  verificarLimpio(e);
});

test('guardar a medias borra también la copia de la base', async ({ page }) => {
  const e = await abrirApp(page);
  await agendar(page);
  await page.fill('#f-notas', 'Algo');
  await page.locator('#f-notas').blur();
  await expect.poll(() => subidas(e).length).toBeGreaterThan(0);
  await page.locator('#btnGuardarEnCurso').click();
  await expect(page.locator('.toaststack')).toContainText('Entrevista guardada a medias');
  await expect.poll(() => borrados(e).length).toBeGreaterThan(0);
  expect(borrados(e)[0].params).toMatchObject({ usuaria: `eq.${USUARIA}`, clave: `eq.${CLAVE}` });
  expect(e.db.borradores.filter(f => f.clave === CLAVE)).toHaveLength(0);
  verificarLimpio(e);
});

test('base sin la tabla: sigue con el del dispositivo, sin errores ni más intentos', async ({ page }) => {
  const e = await abrirApp(page, { baseSinMigrar: true });
  await agendar(page);
  await page.fill('#f-notas', 'Sin tabla');
  await page.locator('#f-notas').blur();
  await page.fill('#f-telefono', '099');
  await page.locator('#f-telefono').blur();
  await page.waitForTimeout(600);
  expect(subidas(e)).toHaveLength(0); // el simulador contesta 404 antes de anotar la escritura
  await irAModulo(page, 'agenda');
  await irAModulo(page, 'rrhh');
  await aviso(page).getByRole('button', { name: 'Seguir' }).click();
  await expect(page.locator('#f-notas')).toHaveValue('Sin tabla');
  verificarLimpio(e, { ignorar: [/status of 404|status of 400/] });
});

test('si la base falla al copiar, no avisa nada y el borrador del dispositivo sigue', async ({ page }) => {
  const e = await abrirApp(page);
  e.fallar = ({ tabla }) => (tabla === 'borradores' ? { status: 500, message: 'falla simulada' } : undefined);
  await agendar(page);
  await page.fill('#f-notas', 'Con la base caída');
  await page.locator('#f-notas').blur();
  await expect.poll(() => e.fallidas || 0).toBeGreaterThan(0);
  await expect(page.locator('.toaststack .toast')).toHaveCount(0);
  await irAModulo(page, 'agenda');
  await irAModulo(page, 'rrhh');
  await aviso(page).getByRole('button', { name: 'Seguir' }).click();
  await expect(page.locator('#f-notas')).toHaveValue('Con la base caída');
  verificarLimpio(e, { ignorar: [/status of 500/] });
});
