// Montos sin centavos (21/10/2026, pedido de Paulina y Delfina). Dos reglas, en core.js:
// - pago a la niñera (redondearPago): ,5 o menos baja; ,6 o más sube (600,5 → 600).
// - cobro a la familia (redondearCobro): ,4 o menos baja; ,5 o más sube (600,5 → 601).
// Se usan en el registro por hora, los sittings desde un fijo, Por pagar / Por cobrar (y
// "Copiar monto") y el PDF de la familia. La misma regla en la base (generar_previstos_fijos)
// se prueba en supabase/pruebas/redondeo_montos.sql.
// Hoy en los tests = domingo 04/10/2026. Datos ficticios: Ana tiene por pagar el 28/09 y la
// Familia Prueba Uno por cobrar el 16/09 y el 28/09.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase, ID } = require('./support/datos');

const SIT_16 = '70000000-0000-4000-8000-000000000002';
const SIT_28 = '70000000-0000-4000-8000-000000000003';
const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && w.metodo === metodo);
const porPagar = page => page.locator('#fin-porpagar-wrap');
const porCobrar = page => page.locator('#fin-porcobrar-wrap');
const filaDe = (box, nombre) => box.locator('.agendarow', { hasText: nombre });

// Tarifas de la Familia Prueba Uno y montos de los sittings de setiembre.
function datosCon({ tarifas, sit28, sit16, ajustes } = {}) {
  const d = datosBase();
  if (tarifas) Object.assign(d.familias.find(f => f.id === ID.fUno), tarifas);
  if (sit28) Object.assign(d.sittings_traslados.find(s => s.id === SIT_28), sit28);
  if (sit16) Object.assign(d.sittings_traslados.find(s => s.id === SIT_16), sit16);
  if (ajustes) d.ajustes_saldo = ajustes;
  return d;
}
async function hora(page, prefijo, hhmm) {
  const [hh, mm] = hhmm.split(':');
  await page.selectOption(`#${prefijo}-hh`, hh);
  await page.selectOption(`#${prefijo}-mm`, mm);
}
async function nuevoSitting(page, { ini, fin }) {
  await irAModulo(page, 'sittings');
  await page.locator('button[onclick^="abrirModalSitForm"]').first().click();
  await page.fill('#sit-familia', 'Familia Prueba Uno');
  await page.fill('#sit-ninera', 'Carla Ejemplo');
  await page.evaluate(() => { onSitFamiliaInput(); onSitNineraInput(); });
  await page.fill('#sit-fecha', '2026-10-03');
  await hora(page, 'sit-horaini', ini);
  await hora(page, 'sit-horafin', fin);
}
async function espiarPortapapeles(page) {
  await page.evaluate(() => {
    window.__copiado = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copiado.push(t); } } });
  });
}

test.describe('las dos reglas (core.js)', () => {
  test('bordes: ,4 ,5 ,6 y enteros, para el pago y para el cobro', async ({ page }) => {
    const e = await abrirApp(page);
    const r = await page.evaluate(() => {
      const casos = [600, 600.4, 600.5, 600.6, 600.49, 600.51, 0, 0.4, 0.5, 0.6, -600.5, -600.6, '600.5', '', null, undefined, NaN, 'abc',
        50 / 60 * 303, 2.5 * 240.2];
      return casos.map(n => ({ n: String(n), pago: redondearPago(n), cobro: redondearCobro(n) }));
    });
    const de = n => r.find(x => x.n === String(n));
    // Pago a la niñera: ,5 o menos baja.
    expect(de(600)).toMatchObject({ pago: 600, cobro: 600 });
    expect(de(600.4)).toMatchObject({ pago: 600, cobro: 600 });
    expect(de(600.5)).toMatchObject({ pago: 600, cobro: 601 }); // la única que cambia entre las dos
    expect(de(600.6)).toMatchObject({ pago: 601, cobro: 601 });
    expect(de(600.49)).toMatchObject({ pago: 600, cobro: 600 });
    expect(de(600.51)).toMatchObject({ pago: 601, cobro: 601 });
    expect(de(0)).toMatchObject({ pago: 0, cobro: 0 });
    expect(de(0.4)).toMatchObject({ pago: 0, cobro: 0 });
    expect(de(0.5)).toMatchObject({ pago: 0, cobro: 1 });
    expect(de(0.6)).toMatchObject({ pago: 1, cobro: 1 });
    expect(de(-600.5)).toMatchObject({ pago: -600, cobro: -601 });
    expect(de(-600.6)).toMatchObject({ pago: -601, cobro: -601 });
    // Un ,5 que el punto flotante deja en ,4999… (50 min = 0,8333… h; 2,5 h × 240,2) sigue
    // siendo ,5.
    expect(de(50 / 60 * 303)).toMatchObject({ pago: 252, cobro: 253 });
    expect(de(2.5 * 240.2)).toMatchObject({ pago: 600, cobro: 601 });
    // Texto (lo que viene de un input) y datos vacíos o raros.
    expect(de('600.5')).toMatchObject({ pago: 600, cobro: 601 });
    for (const raro of ['', 'null', 'undefined', 'NaN', 'abc']) expect(de(raro), raro).toMatchObject({ pago: 0, cobro: 0 });
    // Nunca -0 (se vería "-0" en pantalla).
    expect(await page.evaluate(() => [Object.is(redondearPago(-0.4), -0), Object.is(redondearCobro(-0.4), -0)])).toEqual([false, false]);
    verificarLimpio(e);
  });
});

test.describe('registro en Sittings (por hora)', () => {
  test('2,5 h a $301 / $201: cobra $753 (752,5 sube) y paga $502 (502,5 baja)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ tarifas: { cobro_hora: 301, pago_hora: 201 } }) });
    await nuevoSitting(page, { ini: '14:00', fin: '16:30' });
    await expect(page.locator('#sit-cobro')).toHaveValue('753');
    await expect(page.locator('#sit-pago')).toHaveValue('502');
    await page.locator('#editmodal button', { hasText: 'Guardar registro' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ cobro_familia: 753, pago_ninera: 502 });
    verificarLimpio(e);
  });

  test(',4 baja y ,6 sube en las dos reglas (750,4 → 750; 500,6 → 501)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ tarifas: { cobro_hora: 300.16, pago_hora: 200.24 } }) });
    await nuevoSitting(page, { ini: '14:00', fin: '16:30' });
    await expect(page.locator('#sit-cobro')).toHaveValue('750');
    await expect(page.locator('#sit-pago')).toHaveValue('501');
    verificarLimpio(e);
  });

  test('horas enteras: el monto no cambia', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevoSitting(page, { ini: '14:00', fin: '17:00' });
    await expect(page.locator('#sit-cobro')).toHaveValue('1140'); // 3 h a $380
    await expect(page.locator('#sit-pago')).toHaveValue('750'); // 3 h a $250
    verificarLimpio(e);
  });

  test('pago tipeado por hora: el total sale con la regla del pago', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevoSitting(page, { ini: '14:00', fin: '16:30' });
    await page.evaluate(() => toggleSitPagoModoHora());
    await page.fill('#sit-pago-hora', '201');
    await expect(page.locator('#sit-pago')).toHaveValue('502'); // 502,5 baja
    verificarLimpio(e);
  });
});

// Lo tipeado a mano también se guarda sin centavos (pedido de Diego, 21/10/2026).
test.describe('montos tipeados a mano', () => {
  for (const [tipeado, cobro, pago] of [['600.5', 601, 600], ['600.4', 600, 600], ['600.6', 601, 601], ['600', 600, 600]]) {
    test(`registro en Sittings: ${tipeado.replace('.', ',')} tipeado → cobro ${cobro}, pago ${pago}`, async ({ page }) => {
      const e = await abrirApp(page);
      await nuevoSitting(page, { ini: '14:00', fin: '17:00' });
      await page.fill('#sit-cobro', tipeado);
      await page.fill('#sit-pago', tipeado);
      await page.selectOption('#sit-precio-motivo', 'otro'); // no es el de la tarifa: pide el motivo (21/10/2026)
      await page.locator('#editmodal button', { hasText: 'Guardar registro' }).click();
      await expect(page.locator('#editmodal')).toHaveCount(0);
      expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ cobro_familia: cobro, pago_ninera: pago });
      verificarLimpio(e);
    });
  }

  test('editar un movimiento en Finanzas: 600,5 → cobro 601, pago 600 (también en la confirmación)', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'finanzas');
    await page.evaluate(async () => { finMes = '2026-09'; await cargarFinanzas(); });
    await esperarQuieta(page);
    await page.evaluate(i => editarMovimientoSitting(i), SIT_28);
    await page.fill('#fin-mov-cobro', '600.5');
    await page.fill('#fin-mov-pago', '600.5');
    await page.selectOption('#fin-mov-motivo', 'otro'); // cambiar el monto pide el motivo (21/10/2026)
    await page.check('#fin-mov-pagado');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#pago-total')).toHaveText('$600');
    await page.locator('#pago-confirmar').click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'PATCH')[0].cuerpo).toMatchObject({ cobro_familia: 601, pago_ninera: 600, pagado: true });
    verificarLimpio(e);
  });

  test('editar en Finanzas: un monto que no es número sigue avisando y no guarda', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'finanzas');
    await page.evaluate(async () => { finMes = '2026-09'; await cargarFinanzas(); });
    await esperarQuieta(page);
    await page.evaluate(i => editarMovimientoSitting(i), SIT_28);
    await page.fill('#fin-mov-pago', '');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#fin-mov-warn')).toContainText('Los montos tienen que ser números');
    expect(e.escrituras).toEqual([]);
    verificarLimpio(e);
  });

  test('Agenda: pago tipeado al asignar niñera, 600,5 → 600', async ({ page }) => {
    const d = datosBase();
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'agenda');
    await page.evaluate(id => abrirModalAsignar(id), d.solicitudes[0].id);
    await page.locator('input[name="agenda-asignar-ninera"]').first().check();
    await page.fill('#agenda-asignar-pago', '600.5');
    await page.fill('#agenda-asignar-direccion', 'Calle Inventada 2'); // etapa 6: la Familia Dos no tiene y es obligatoria
    await page.locator('#editmodal button', { hasText: /Asignar|Confirmar|Guardar/ }).last().click();
    await expect.poll(() => escrituras(e, 'sittings_traslados', 'POST').length).toBe(1);
    expect(escrituras(e, 'solicitud_ninieras', 'POST')[0].cuerpo).toMatchObject({ pago_ninera: 600 });
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ pago_ninera: 600 });
    verificarLimpio(e);
  });
});

test.describe('Agenda', () => {
  async function verAgendaDesde(page, fechaISO) {
    await page.evaluate(async f => { agendaAncla = f; await cargarAgendaSolicitudes(); }, fechaISO);
    await esperarQuieta(page);
  }

  test('registrar un día de un fijo: cobro con la regla del cobro, pago con la del pago', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ tarifas: { cobro_hora: 301, pago_hora: 201 } }) });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-09-21');
    await page.evaluate(id => abrirModalSolicitud(`asig:${id}@2026-09-21`), ID.aFijo);
    await hora(page, 'agenda-fija-hf', '18:30'); // 16:00 a 18:30, 2,5 h
    await page.locator('#editmodal button', { hasText: 'Registrar sitting de este día' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ asignacion_id: ID.aFijo, cobro_familia: 753, pago_ninera: 502 });
    verificarLimpio(e);
  });

  test('reemplazo de un día de un fijo: las mismas reglas', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ tarifas: { cobro_hora: 301, pago_hora: 201 } }) });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-09-21');
    await page.evaluate(id => abrirModalSolicitud(`asig:${id}@2026-09-21`), ID.aFijo);
    await page.locator('#editmodal button', { hasText: 'Este día no fue' }).click();
    await page.locator('#editmodal button', { hasText: 'Vino otra niñera' }).click();
    await page.fill('#agenda-fija-reemplazo-ninera', 'Carla Ejemplo');
    await hora(page, 'agenda-fija-rhf', '18:30');
    await page.locator('#editmodal button', { hasText: 'Registrar reemplazo' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_nombre: 'Carla Ejemplo', cobro_familia: 753, pago_ninera: 502 });
    verificarLimpio(e);
  });

  test('solicitud puntual: total estimado y cobro guardado con la regla del cobro', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ tarifas: { cobro_hora: 301, pago_hora: 201 } }) });
    await irAModulo(page, 'agenda');
    await page.locator('button[onclick^="abrirModalNuevaSolicitud"]').first().click();
    await page.fill('#agenda-familia', 'Familia Prueba Uno');
    await page.evaluate(() => onAgendaFamiliaInput());
    await page.fill('#agenda-nueva-fecha', '2026-10-08');
    await hora(page, 'agenda-hora-inicio', '14:00');
    await hora(page, 'agenda-hora-fin', '16:30');
    await expect(page.locator('#agenda-total-preview')).toHaveText('Total estimado: $753 (2.5 h)');
    await page.locator('#editmodal button', { hasText: /Guardar|Crear|Agregar/ }).last().click();
    await expect.poll(() => escrituras(e, 'solicitudes', 'POST').length).toBe(1);
    expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ cobro_familia: 753 });
    verificarLimpio(e);
  });

  test('asignar niñera a una solicitud: el pago sugerido con la regla del pago', async ({ page }) => {
    const d = datosBase();
    Object.assign(d.familias.find(f => f.id === ID.fDos), { pago_hora: 201 });
    Object.assign(d.solicitudes[0], { hora_fin: '22:30:00' }); // 20:00 a 22:30, 2,5 h
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'agenda');
    await page.evaluate(id => abrirModalAsignar(id), d.solicitudes[0].id);
    await page.locator('input[name="agenda-asignar-ninera"]').first().check();
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('502');
    verificarLimpio(e);
  });
});

test.describe('Por pagar y Por cobrar', () => {
  test(',5: a la niñera se le paga $750 (baja) y a la familia se le cobra $2.281 (sube)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ sit28: { cobro_familia: 1140.5, pago_ninera: 750.5 } }) });
    await irAModulo(page, 'finanzas');
    await espiarPortapapeles(page);
    // Familia Prueba Uno: 1140 + 1140,5 = 2280,5.
    const fam = filaDe(porCobrar(page), 'Familia Prueba Uno');
    await expect(fam).toContainText('$2.281');
    await expect(porCobrar(page).locator('h2 + .helper')).toContainText('$2.731'); // + el traslado de $450 de la Familia Prueba Dos
    const ana = filaDe(porPagar(page), 'Ana Ficticia');
    await expect(ana).toContainText('$750');
    await expect(ana).not.toContainText('750,5');
    await expect(porPagar(page).locator('h2 + .helper')).toContainText('$1.000'); // + los $250 de Bruno
    await ana.locator('button', { hasText: 'Copiar monto' }).click();
    expect(await page.evaluate(() => window.__copiado)).toEqual(['750']);
    // La confirmación: la línea tal cual y el total que se paga, sin centavos.
    await ana.locator('button', { hasText: 'Marcar todo pagado' }).click();
    await expect(page.locator('#pago-detalle')).toContainText('$750,5');
    await expect(page.locator('#pago-total')).toHaveText('$750');
    await page.locator('#pago-confirmar').click();
    await expect(page.locator('.toaststack .toast', { hasText: 'Marcado como pagado.' })).toBeVisible();
    verificarLimpio(e);
  });

  test(',4 y ,6: baja y sube igual en las dos (cobro $2.280, pago $751)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ sit28: { cobro_familia: 1140.4, pago_ninera: 750.6 } }) });
    await irAModulo(page, 'finanzas');
    await espiarPortapapeles(page);
    await expect(filaDe(porCobrar(page), 'Familia Prueba Uno')).toContainText('$2.280');
    const ana = filaDe(porPagar(page), 'Ana Ficticia');
    await expect(ana).toContainText('$751');
    await ana.locator('button', { hasText: 'Copiar monto' }).click();
    expect(await page.evaluate(() => window.__copiado)).toEqual(['751']);
    verificarLimpio(e);
  });

  test('montos enteros: no cambia nada', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'finanzas');
    await espiarPortapapeles(page);
    await expect(filaDe(porCobrar(page), 'Familia Prueba Uno')).toContainText('$2.280');
    const ana = filaDe(porPagar(page), 'Ana Ficticia');
    await ana.locator('button', { hasText: 'Copiar monto' }).click();
    expect(await page.evaluate(() => window.__copiado)).toEqual(['750']);
    verificarLimpio(e);
  });

  test('con saldo a favor con centavos: el total que queda se redondea con cada regla', async ({ page }) => {
    const base = { fecha: '2026-10-03', aplicado: 0, aplicaciones: [], creado_por: null, created_at: '2026-10-03T12:00:00Z' };
    const ajustes = [
      { ...base, id: 'a5000000-0000-4000-8000-000000000001', sujeto: 'ninera', familia_id: null, ninera_id: ID.nAna, nombre: 'Ana Ficticia', monto: -299.5, motivo: 'Adelanto' },
      { ...base, id: 'a5000000-0000-4000-8000-000000000002', sujeto: 'familia', familia_id: ID.fUno, ninera_id: null, nombre: 'Familia Prueba Uno', monto: -279.5, motivo: 'Pagó de más' },
    ];
    const e = await abrirApp(page, { datos: datosCon({ ajustes }) });
    await irAModulo(page, 'finanzas');
    // Ana: 750 − 299,5 = 450,5 → $450. Familia: 2280 − 279,5 = 2000,5 → $2.001.
    const ana = filaDe(porPagar(page), 'Ana Ficticia');
    await expect(ana.locator('span[style*="IBM Plex Mono"]').last()).toHaveText('$450');
    await expect(filaDe(porCobrar(page), 'Familia Prueba Uno').locator('span[style*="IBM Plex Mono"]').last()).toHaveText('$2.001');
    await ana.locator('button', { hasText: 'Marcar todo pagado' }).click();
    await expect(page.locator('#pago-total')).toHaveText('$450');
    await page.locator('#pago-confirmar').click();
    await expect(page.locator('.toaststack .toast', { hasText: 'Marcado como pagado.' })).toBeVisible();
    // El saldo se anota completo como usado: el redondeo es solo del monto que se paga.
    expect(e.db.ajustes_saldo.find(a => a.nombre === 'Ana Ficticia').aplicado).toBe(299.5);
    verificarLimpio(e);
  });
});

test.describe('PDF de la familia', () => {
  async function vistaPrevia(page) {
    await irAModulo(page, 'sittings');
    await page.evaluate(() => {
      const sel = document.getElementById('sithist-familia');
      sel.value = [...sel.options].find(o => o.textContent === 'Familia Prueba Uno').value;
    });
    await page.evaluate(() => abrirModalExportarHistorialPDF());
    await page.fill('#exphist-desde', '2026-09-28');
    await page.fill('#exphist-hasta', '2026-09-28');
    await page.locator('#editmodal button', { hasText: 'Ver vista previa' }).click();
  }
  for (const [monto, total] of [[1140.5, '$1.141'], [1140.4, '$1.140'], [1140.6, '$1.141'], [1140, '$1.140']]) {
    test(`cobro ${String(monto).replace('.', ',')}: Total a pagar ${total}`, async ({ page }) => {
      const e = await abrirApp(page, { datos: datosCon({ sit28: { cobro_familia: monto } }) });
      await vistaPrevia(page);
      await expect(page.locator('#exphist-total-pagar')).toHaveText(`Total a pagar: ${total}`);
      await expect(page.locator('.exphist-total')).toContainText(`Servicios: ${total}`);
      expect(await page.evaluate(() => exphistTotal.total)).toBe(Number(total.replace(/\D/g, '')));
      verificarLimpio(e);
    });
  }
});

test.describe('celular (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('Por pagar con montos redondeados entra sin scroll horizontal', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ sit28: { cobro_familia: 1140.5, pago_ninera: 750.5 } }) });
    await irAModulo(page, 'finanzas');
    await expect(filaDe(porPagar(page), 'Ana Ficticia')).toContainText('$750');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    verificarLimpio(e);
  });
});
