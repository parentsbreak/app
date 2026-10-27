// Cambio de horario con precio a mano (25/10/2026, tanda de bugs antes de la fase 1, punto 4):
// al corregir el horario de un registro con precio puesto a mano, el aviso "Con este horario y la
// tarifa de la familia: cobro $X. Lo que pusiste a mano no se cambió" ofrece dos salidas:
// "Usar el nuevo monto ($X)" (aplica el cálculo nuevo al cobro y al pago y saca la marca de precio
// a mano, así el horario vuelve a recalcular solo) y "Mantener el precio a mano" (sigue pidiendo el
// motivo, como hasta ahora). Sin elegir no se guarda.
// En el mismo PR: todas las casillas miden al menos 24 px en el celular y el botón del confirmar
// dice lo que hace ("Sí, no fue", "Quitar la pausa").
// Datos inventados: Familia Prueba Uno cobra $380 y paga $250 por hora.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

const ID_SEP28 = '70000000-0000-4000-8000-000000000003'; // 16 a 19, $1.140 / $750 (horas por tarifa)
const patches = e => e.escrituras.filter(x => x.tabla === 'sittings_traslados' && x.metodo === 'PATCH');
const sugerencia = page => page.locator('#sit-precio-sugerido');
const guardar = page => page.locator('#editmodal button', { hasText: /^Guardar (registro|cambios)$/ }).click();
async function hora(page, prefijo, hhmm) {
  const [hh, mm] = hhmm.split(':');
  await page.selectOption(`#${prefijo}-hh`, hh);
  await page.selectOption(`#${prefijo}-mm`, mm);
}
// El registro del 28/09 con el cobro puesto a mano ($1.000 en vez de $1.140) y su motivo.
async function editarConPrecioAMano(page, extra = {}, opciones = {}) {
  const datos = datosBase();
  Object.assign(datos.sittings_traslados.find(r => r.id === ID_SEP28), { cobro_familia: 1000, precio_motivo: 'descuento', ...extra });
  const e = await abrirApp(page, { datos, ...opciones });
  await irAModulo(page, 'sittings');
  await page.evaluate(i => abrirModalSitForm(i), ID_SEP28);
  await expect(page.locator('#sit-familia')).toHaveValue('Familia Prueba Uno');
  return e;
}

test.describe('cambio de horario con precio a mano', () => {
  test('al cambiar la hora ofrece "Usar el nuevo monto ($X)" y "Mantener el precio a mano", y guarda el motivo', async ({ page }) => {
    const e = await editarConPrecioAMano(page);
    await expect(page.locator('#sit-precio-motivo')).toHaveValue('descuento'); // al abrir, como siempre
    await hora(page, 'sit-horafin', '20:00');
    await expect(page.locator('#sit-cobro')).toHaveValue('1000'); // lo puesto a mano no se pisa
    await expect(page.locator('#sit-pago')).toHaveValue('1000'); // el pago sí era el calculado: sigue al horario
    await expect(sugerencia(page)).toContainText('Con este horario y la tarifa de la familia: cobro $1.520. Lo que pusiste a mano no se cambió.');
    await expect(sugerencia(page).locator('button')).toHaveText(['Usar el nuevo monto ($1.520)', 'Mantener el precio a mano']);
    await expect(page.locator('#sit-precio-motivo')).toHaveCount(0); // el motivo se pide recién si se mantiene

    await sugerencia(page).locator('button', { hasText: 'Mantener el precio a mano' }).click();
    await expect(page.locator('#sit-precio-motivo')).toHaveValue('descuento'); // vuelve con el motivo que tenía
    await expect(sugerencia(page).locator('button')).toHaveText(['Usar el nuevo monto ($1.520)']);
    await expect(page.locator('#sit-cobro')).toHaveValue('1000');
    await guardar(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(patches(e)[0].cuerpo).toMatchObject({ cobro_familia: 1000, pago_ninera: 1000, hora_fin: '20:00', precio_motivo: 'descuento' });
    verificarLimpio(e);
  });

  test('"Usar el nuevo monto" aplica el cálculo, saca la marca de precio a mano y el horario vuelve a recalcular solo', async ({ page }) => {
    const e = await editarConPrecioAMano(page);
    await hora(page, 'sit-horafin', '20:00');
    await sugerencia(page).locator('button', { hasText: 'Usar el nuevo monto ($1.520)' }).click();
    await expect(page.locator('#sit-cobro')).toHaveValue('1520');
    await expect(sugerencia(page)).toBeEmpty();
    await hora(page, 'sit-horafin', '21:00'); // ya sin la marca: sigue a la tarifa sin preguntar
    await expect(page.locator('#sit-cobro')).toHaveValue('1900');
    await expect(page.locator('#sit-pago')).toHaveValue('1250');
    await expect(sugerencia(page)).toBeEmpty();
    await guardar(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(patches(e)[0].cuerpo).toMatchObject({ cobro_familia: 1900, pago_ninera: 1250, hora_fin: '21:00', precio_motivo: null });
    verificarLimpio(e);
  });

  test('sin elegir no guarda; si mantiene y borra el motivo, tampoco', async ({ page }) => {
    const e = await editarConPrecioAMano(page);
    await hora(page, 'sit-horafin', '20:00');
    await guardar(page);
    await expect(page.locator('.toaststack')).toContainText('Elegí si usás el nuevo monto o mantenés el precio a mano');
    expect(patches(e)).toHaveLength(0);
    await sugerencia(page).locator('button', { hasText: 'Mantener el precio a mano' }).click();
    await page.selectOption('#sit-precio-motivo', '');
    await guardar(page);
    await expect(page.locator('.toaststack')).toContainText('Elegí por qué el precio no es el de la tarifa');
    expect(patches(e)).toHaveLength(0);
    verificarLimpio(e);
  });

  test('con cobro y pago a mano: "Usar los nuevos montos (cobro $X y pago $Y)"', async ({ page }) => {
    const e = await editarConPrecioAMano(page, { pago_ninera: 600, precio_motivo: 'otro' });
    await hora(page, 'sit-horafin', '20:00');
    await expect(page.locator('#sit-pago')).toHaveValue('600');
    await expect(sugerencia(page)).toContainText('cobro $1.520 y pago $1.000');
    const usar = sugerencia(page).locator('button', { hasText: 'Usar los nuevos montos (cobro $1.520 y pago $1.000)' });
    await expect(usar).toHaveCount(1);
    await usar.click();
    await expect(page.locator('#sit-cobro')).toHaveValue('1520');
    await expect(page.locator('#sit-pago')).toHaveValue('1000');
    await guardar(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(patches(e)[0].cuerpo).toMatchObject({ cobro_familia: 1520, pago_ninera: 1000, precio_motivo: null });
    verificarLimpio(e);
  });

  test('cambiar la hora dos veces sin elegir sigue ofreciendo las dos salidas con el monto nuevo', async ({ page }) => {
    const e = await editarConPrecioAMano(page);
    await hora(page, 'sit-horafin', '20:00');
    await hora(page, 'sit-horafin', '21:00');
    await expect(sugerencia(page).locator('button')).toHaveText(['Usar el nuevo monto ($1.900)', 'Mantener el precio a mano']);
    await sugerencia(page).locator('button', { hasText: 'Mantener' }).click();
    await expect(page.locator('#sit-precio-motivo')).toHaveValue('descuento');
    verificarLimpio(e);
  });

  test('un registro nuevo con el precio tipeado pide el motivo enseguida, como hasta ahora', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'sittings');
    await page.locator('button[onclick^="abrirModalSitForm"]').first().click();
    await page.fill('#sit-familia', 'Familia Prueba Uno');
    await page.fill('#sit-ninera', 'Carla Ejemplo');
    await page.evaluate(() => { onSitFamiliaInput(); onSitNineraInput(); });
    await hora(page, 'sit-horaini', '16:00');
    await hora(page, 'sit-horafin', '19:00');
    await page.fill('#sit-cobro', '570');
    await expect(page.locator('#sit-precio-motivo')).toBeVisible(); // tipeó el precio a propósito: no hace falta preguntar si lo mantiene
    await expect(sugerencia(page).locator('button')).toHaveText(['Usar el nuevo monto ($1.140)']);
    verificarLimpio(e);
  });

  test('base sin la columna del motivo: "Usar el nuevo monto" guarda igual', async ({ page }) => {
    const e = await editarConPrecioAMano(page, { precio_motivo: undefined }, { baseSinMigrar: true });
    await hora(page, 'sit-horafin', '20:00');
    await sugerencia(page).locator('button', { hasText: 'Usar el nuevo monto ($1.520)' }).click();
    await guardar(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(e.db.sittings_traslados.find(r => r.id === ID_SEP28)).toMatchObject({ cobro_familia: 1520, pago_ninera: 1000 });
    verificarLimpio(e, { ignorar: [/status of (400|404)/] }); // la columna y las tablas que no existen sin migrar
  });

  test('a 390 px: los dos botones entran en la pantalla (captura)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await editarConPrecioAMano(page);
    await hora(page, 'sit-horafin', '20:00');
    for (const b of await sugerencia(page).locator('button').all()) {
      await b.scrollIntoViewIfNeeded();
      const caja = await b.boundingBox();
      expect(caja.x + caja.width).toBeLessThanOrEqual(390);
      expect(caja.height).toBeGreaterThanOrEqual(36);
    }
    await sugerencia(page).screenshot({ path: 'test-results/precio-a-mano-horario-390.png' });
    verificarLimpio(e);
  });
});

test.describe('casillas y confirmaciones en el celular', () => {
  // El modal abre con una animación de escala (.98 → 1): se mide cuando terminó.
  async function casillasGrandes(page) {
    await page.waitForFunction(() => [...document.querySelectorAll('.confirmbox')].every(b => ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(b).transform)));
    const casillas = await page.locator('input[type=checkbox]:visible').all();
    expect(casillas.length).toBeGreaterThan(0);
    for (const c of casillas) {
      const caja = await c.boundingBox();
      expect(caja.width, 'ancho de la casilla').toBeGreaterThanOrEqual(24);
      expect(caja.height, 'alto de la casilla').toBeGreaterThanOrEqual(24);
    }
  }
  test('a 390 px todas las casillas miden al menos 24 px: registro, nueva solicitud y login', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page);
    await irAModulo(page, 'sittings');
    await page.locator('button[onclick^="abrirModalSitForm"]').first().click();
    await expect(page.locator('#sit-esfijo')).toBeVisible();
    await casillasGrandes(page); // "¿Es un trabajo fijo?" y "Termina al día siguiente"
    await page.locator('#editmodal .modal-close').click();
    await irAModulo(page, 'agenda');
    await page.locator('button', { hasText: '+ Nueva solicitud' }).click();
    await expect(page.locator('#agenda-cruza-medianoche')).toBeVisible();
    await casillasGrandes(page);
    verificarLimpio(e);
  });
  test('a 390 px la casilla de "Recordarme" del login también', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { sesion: false });
    await expect(page.locator('#login-recordar')).toBeVisible();
    await casillasGrandes(page);
    verificarLimpio(e);
  });

  test('el botón del confirmar dice lo que hace: "Sí, no fue" en el Cierre de los fijos', async ({ page }) => {
    const d = datosBase();
    d.app_config = [{ id: 'fijos_automaticos', valor: { activo: true, dias: 14 }, actualizado_at: '2026-10-04T06:00:00Z' }];
    d.sittings_traslados = d.sittings_traslados.map(s => ({ ...s, estado: 'confirmado', generado_automatico: false, revisado_at: null }));
    d.sittings_traslados.push(sitting('a1000000-0000-4000-8000-000000000030', '2026-09-30', { asignacion_id: ID.aFijo, estado: 'confirmado', generado_automatico: true, revisado_at: null, registrado_por: 'Automático' }));
    d.asignaciones_pausas = [];
    const e = await abrirApp(page, { datos: d });
    await page.locator('.autoconf-card button', { hasText: 'No fue' }).click();
    await expect(page.locator('.confirmoverlay .confirmmsg')).toContainText('no fue el 30 de set'); // es-UY: "setiembre"
    await expect(page.locator('#confirm-si')).toHaveText('Sí, no fue');
    await page.locator('#confirm-si').click();
    await expect(page.locator('.toaststack .toast', { hasText: 'Listo: ese día no fue nadie.' })).toBeVisible();
    expect(patches(e)[0].cuerpo).toMatchObject({ cancelado: true, cobro_familia: 0, pago_ninera: 0 });
    verificarLimpio(e);
  });

  test('el botón del confirmar dice lo que hace: "Quitar la pausa" en el fijo', async ({ page }) => {
    const d = datosBase();
    d.app_config = [{ id: 'fijos_automaticos', valor: { activo: true, dias: 14 }, actualizado_at: '2026-10-04T06:00:00Z' }];
    d.sittings_traslados = d.sittings_traslados.map(s => ({ ...s, estado: 'confirmado', generado_automatico: false, revisado_at: null }));
    d.asignaciones_pausas = [{ id: 'b1000000-0000-4000-8000-000000000001', asignacion_id: ID.aFijo, desde: '2026-10-12', hasta: '2026-10-14', motivo: 'Vacaciones', created_at: '2026-10-01T00:00:00Z' }];
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'agenda');
    // La tarjeta del fijo ("asig:"), no el sitting de hoy de Ana en la misma familia (datos.js, etapa 2).
    await page.locator('#agenda-grid-wrap [onclick*="asig:"]', { hasText: 'Familia Prueba Uno' }).first().click();
    await page.locator('#editmodal button', { hasText: 'Quitar pausa' }).click();
    await expect(page.locator('.confirmoverlay .confirmmsg')).toContainText('¿Quitar la pausa?');
    await expect(page.locator('#confirm-si')).toHaveText('Quitar la pausa');
    await page.locator('#confirm-no').click();
    expect(e.escrituras.filter(w => w.tabla === 'asignaciones_pausas')).toEqual([]);
    verificarLimpio(e);
  });
});
