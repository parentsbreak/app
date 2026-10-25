// Precio puesto a mano, con motivo (21/10/2026, Paulina y Delfina): cuando el precio de un sitting
// no es el de la tarifa, se anota por qué (descuento, extra, se cobra sin servicio, otro), en el
// registro y en "Editar movimiento" de Finanzas. "Revisar meses" ya no lo marca como sospechoso.
// Datos inventados: Familia Prueba Uno cobra $380 y paga $250 por hora.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase } = require('./support/datos');

const ID_SEP28 = '70000000-0000-4000-8000-000000000003'; // 16 a 19, $1.140 / $750 (horas por tarifa)
const escrituras = (e, metodo) => e.escrituras.filter(x => x.tabla === 'sittings_traslados' && x.metodo === metodo);
async function hora(page, prefijo, hhmm) {
  const [hh, mm] = hhmm.split(':');
  await page.selectOption(`#${prefijo}-hh`, hh);
  await page.selectOption(`#${prefijo}-mm`, mm);
}
async function nuevoRegistro(page) {
  await irAModulo(page, 'sittings');
  await page.locator('button[onclick^="abrirModalSitForm"]').first().click();
  await page.fill('#sit-familia', 'Familia Prueba Uno');
  await page.fill('#sit-ninera', 'Carla Ejemplo');
  await page.evaluate(() => { onSitFamiliaInput(); onSitNineraInput(); });
  await page.fill('#sit-fecha', '2026-10-03');
  await hora(page, 'sit-horaini', '16:00');
  await hora(page, 'sit-horafin', '19:00');
}
const guardar = page => page.locator('#editmodal button', { hasText: /^Guardar (registro|cambios)$/ }).click();

test.describe('registro de un sitting', () => {
  test('con el precio de la tarifa no pregunta nada y no anota motivo', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevoRegistro(page);
    await expect(page.locator('#sit-precio-motivo')).toHaveCount(0);
    await guardar(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'POST')[0].cuerpo).toMatchObject({ cobro_familia: 1140, precio_motivo: null });
    verificarLimpio(e);
  });

  test('con un precio a mano pide el motivo; sin elegirlo no guarda; con el motivo, queda anotado', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevoRegistro(page);
    await page.fill('#sit-cobro', '570');
    await expect(page.locator('#sit-precio-motivo')).toBeVisible();
    await guardar(page);
    await expect(page.locator('.toaststack')).toContainText('Elegí por qué el precio no es el de la tarifa');
    expect(escrituras(e, 'POST')).toHaveLength(0);
    await page.selectOption('#sit-precio-motivo', 'descuento');
    await page.fill('#sit-notas', 'Mitad de precio por la demora');
    await expect(page.locator('#sit-precio-motivo')).toHaveValue('descuento'); // no se pierde al redibujar
    await guardar(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'POST')[0].cuerpo).toMatchObject({ cobro_familia: 570, pago_ninera: 750, precio_motivo: 'descuento' });
    verificarLimpio(e);
  });

  test('"Usar el nuevo monto" vuelve a la tarifa y saca el motivo', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevoRegistro(page);
    await page.fill('#sit-cobro', '2000');
    await page.selectOption('#sit-precio-motivo', 'extra');
    await page.locator('#sit-precio-sugerido button', { hasText: 'Usar el nuevo monto ($1.140)' }).click();
    await expect(page.locator('#sit-precio-motivo')).toHaveCount(0);
    await guardar(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'POST')[0].cuerpo).toMatchObject({ cobro_familia: 1140, precio_motivo: null });
    verificarLimpio(e);
  });

  test('al editar uno con motivo, el motivo aparece elegido', async ({ page }) => {
    const datos = datosBase();
    Object.assign(datos.sittings_traslados.find(r => r.id === ID_SEP28), { cobro_familia: 2000, precio_motivo: 'sin_servicio' });
    const e = await abrirApp(page, { datos });
    await irAModulo(page, 'sittings');
    await page.evaluate(i => abrirModalSitForm(i), ID_SEP28);
    await expect(page.locator('#sit-precio-motivo')).toHaveValue('sin_servicio');
    await guardar(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'PATCH').at(-1).cuerpo).toMatchObject({ cobro_familia: 2000, precio_motivo: 'sin_servicio' });
    verificarLimpio(e);
  });

  test('base sin la migración: se guarda igual, sin el motivo, y lo avisa', async ({ page }) => {
    const e = await abrirApp(page, { baseSinMigrar: true });
    await nuevoRegistro(page);
    await page.fill('#sit-cobro', '570');
    await page.selectOption('#sit-precio-motivo', 'descuento');
    await guardar(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    await expect(page.locator('.toaststack')).toContainText('sin el motivo del precio');
    const w = escrituras(e, 'POST').at(-1).cuerpo;
    expect(w.cobro_familia).toBe(570);
    expect(w).not.toHaveProperty('precio_motivo');
    verificarLimpio(e, { ignorar: [/status of 400|status of 404/] });
  });
});

test.describe('Finanzas → Editar movimiento', () => {
  async function abrirMovimiento(page, id) {
    await irAModulo(page, 'finanzas');
    await page.evaluate(async () => { finMes = '2026-09'; await cargarFinanzas(); });
    await esperarQuieta(page);
    await page.evaluate(i => editarMovimientoSitting(i), id);
  }
  const guardarMov = page => page.locator('#editmodal button', { hasText: 'Guardar' }).click();

  test('cambiar el monto pide el motivo; con el motivo se guarda', async ({ page }) => {
    const e = await abrirApp(page);
    await abrirMovimiento(page, ID_SEP28);
    await page.fill('#fin-mov-cobro', '1500');
    await guardarMov(page);
    await expect(page.locator('#fin-mov-warn')).toContainText('elegí por qué');
    expect(escrituras(e, 'PATCH')).toHaveLength(0);
    await page.selectOption('#fin-mov-motivo', 'extra');
    await guardarMov(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'PATCH')[0].cuerpo).toEqual({ cobro_familia: 1500, pago_ninera: 750, precio_motivo: 'extra' });
    verificarLimpio(e);
  });

  test('sin cambiar el monto no pide motivo ni lo manda', async ({ page }) => {
    const e = await abrirApp(page);
    await abrirMovimiento(page, ID_SEP28);
    await page.locator('#fin-mov-pagado').check();
    await guardarMov(page);
    await page.locator('[aria-label="Confirmar pago"] button', { hasText: 'Confirmar pago' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'PATCH')[0].cuerpo).not.toHaveProperty('precio_motivo');
    verificarLimpio(e);
  });
});

test.describe('Finanzas → Revisar meses', () => {
  test('un precio muy distinto a la tarifa con motivo ya no es sospechoso; sin motivo, sí', async ({ page }) => {
    const datos = datosBase();
    datos.sittings_traslados.find(r => r.id === ID_SEP28).cobro_familia = 570;
    const e = await abrirApp(page, { datos });
    const sospechas = await page.evaluate(async id => {
      const { data: sits } = await sb.from('sittings_traslados').select('*').gte('fecha', '2026-09-01').lt('fecha', '2026-10-01');
      const { data: fams } = await sb.from('familias').select('*');
      const ctx = { asigPorId: {}, famPorId: Object.fromEntries(fams.map(f => [f.id, f])), hoy: todayISO() };
      const sin = sospechasDelMes(sits, ctx)[id] || [];
      const con = sospechasDelMes(sits.map(r => r.id === id ? { ...r, precio_motivo: 'descuento' } : r), ctx)[id] || [];
      return { sin, con };
    }, ID_SEP28);
    expect(sospechas.sin.join(' ')).toContain('daría $1.140');
    expect(sospechas.con.join(' ')).not.toContain('daría');
    verificarLimpio(e);
  });
});
