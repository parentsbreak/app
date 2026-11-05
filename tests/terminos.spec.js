// Términos y condiciones (20/10/2026; regla nueva del 04/11/2026). La admin marca en la ficha que la
// familia los aceptó y desde qué fecha; desde ese día, y nunca antes del 01/12/2026, el TOTAL de horas
// de cada sitting se le cobra así: de cada media hora, hasta 15 minutos exactos y desde el 16 la media
// hora entera (3 h 15 → 3 h 15; 3 h 16 → 3 h 30; 3 h 46 → 4 h). A la niñera se le paga la hora real.
// La misma regla en la base (generar_previstos_fijos, precio_sitting) se prueba en
// supabase/pruebas/terminos_redondeo.sql.
// Hoy en los tests = domingo 04/10/2026 (antes de que rija); los que registran sittings que redondean
// corren con el reloj en diciembre (DICIEMBRE). Familia Prueba Uno: $380 / $250 por hora.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && w.metodo === metodo);
const toasts = page => page.locator('.toaststack .toast');
const DICIEMBRE = '2026-12-05T12:00:00-03:00';
function datosConTerminos(desde = '2026-10-01') {
  const d = datosBase();
  d.familias.find(f => f.id === ID.fUno).terminos_aceptados_el = desde;
  return d;
}
// Elige la hora como lo hace la persona: los dos selectores, que disparan el recálculo.
async function hora(page, prefijo, hhmm) {
  const [hh, mm] = hhmm.split(':');
  await page.selectOption(`#${prefijo}-hh`, hh);
  await page.selectOption(`#${prefijo}-mm`, mm);
}
async function nuevoSitting(page, { familia = 'Familia Prueba Uno', fecha = '2026-12-03', ini, fin, cruza = false }) {
  await irAModulo(page, 'sittings');
  await page.locator('button[onclick^="abrirModalSitForm"]').first().click();
  await page.fill('#sit-familia', familia);
  await page.fill('#sit-ninera', 'Carla Ejemplo');
  await page.evaluate(() => { onSitFamiliaInput(); onSitNineraInput(); });
  await page.fill('#sit-fecha', fecha);
  if (cruza) await page.check('#sit-cruza-medianoche');
  await hora(page, 'sit-horaini', ini);
  await hora(page, 'sit-horafin', fin);
}

test.describe('la regla del redondeo (una sola, en core.js)', () => {
  test('bordes: 15 y 16, 45 y 46 minutos, inicio suelto, medianoche, el 01/12 y familia sin la casilla', async ({ page }) => {
    const e = await abrirApp(page);
    const r = await page.evaluate(() => {
      const acepto = { terminos_aceptados_el: '2026-10-01' };
      const fin = (hf, extra = {}) => {
        const h = horasSitting(extra.ini || '14:00', hf, !!extra.cruza, 'familia' in extra ? extra.familia : acepto, 'fecha' in extra ? extra.fecha : '2026-12-03');
        return { cobro: h.cobro, real: h.real, finCobro: h.finCobro, texto: textoFinCobrado(hf, h) };
      };
      return {
        f1700: fin('17:00'), f1715: fin('17:15'), f1716: fin('17:16'), f1729: fin('17:29'), f1730: fin('17:30'),
        f1745: fin('17:45'), f1746: fin('17:46'), f1759: fin('17:59'),
        diezMin: fin('14:10'), dieciseisMin: fin('14:16'),
        inicioSuelto: fin('17:36', { ini: '14:20' }), inicioSueltoExacto: fin('17:35', { ini: '14:20' }),
        f2346: fin('23:46', { ini: '20:00' }),
        cruza: fin('01:20', { ini: '22:00', cruza: true }),
        cruzaExacto: fin('01:06', { ini: '22:00', cruza: true }),
        sinCasilla: fin('17:46', { familia: { terminos_aceptados_el: null } }),
        sinFamilia: fin('17:46', { familia: null }),
        antesDelUno: fin('17:46', { fecha: '2026-11-30' }),
        elUno: fin('17:46', { fecha: '2026-12-01' }),
        aceptoDespues: fin('17:46', { familia: { terminos_aceptados_el: '2026-12-10' }, fecha: '2026-12-09' }),
        elDiaQueAcepto: fin('17:46', { familia: { terminos_aceptados_el: '2026-12-10' }, fecha: '2026-12-10' }),
        sinFecha: fin('17:46', { fecha: '' }),
        incompleto: horasSitting('14:00', '', false, acepto, '2026-12-03'),
        finAntes: horasSitting('14:00', '13:00', false, acepto, '2026-12-03'),
      };
    });
    expect(r.f1700).toEqual({ cobro: 3, real: 3, finCobro: null, texto: '' });
    expect(r.f1715).toEqual({ cobro: 3.25, real: 3.25, finCobro: null, texto: '' });
    expect(r.f1716).toMatchObject({ cobro: 3.5, finCobro: '17:30', texto: 'Hora real 17:16, se cobra hasta 17:30' });
    expect(r.f1729).toMatchObject({ cobro: 3.5, finCobro: '17:30' });
    expect(r.f1730).toMatchObject({ cobro: 3.5, finCobro: null, texto: '' });
    expect(r.f1745).toMatchObject({ cobro: 3.75, real: 3.75, finCobro: null });
    expect(r.f1746).toMatchObject({ cobro: 4, finCobro: '18:00', texto: 'Hora real 17:46, se cobra hasta 18:00' });
    expect(r.f1759).toMatchObject({ cobro: 4, finCobro: '18:00' });
    expect(r.diezMin).toMatchObject({ finCobro: null });
    expect(r.dieciseisMin).toMatchObject({ cobro: 0.5, finCobro: '14:30' });
    // Va por el total de horas: de 14:20 a 17:36 son 3 h 16, se cobran 3 h 30 (hasta 17:50).
    expect(r.inicioSuelto).toMatchObject({ cobro: 3.5, finCobro: '17:50', texto: 'Hora real 17:36, se cobra hasta 17:50' });
    expect(r.inicioSueltoExacto).toMatchObject({ cobro: 3.25, finCobro: null });
    expect(r.f2346).toMatchObject({ cobro: 4, finCobro: '00:00', texto: 'Hora real 23:46, se cobra hasta 00:00' });
    expect(r.cruza).toMatchObject({ cobro: 3.5, finCobro: '01:30', texto: 'Hora real 01:20, se cobra hasta 01:30' });
    expect(r.cruzaExacto).toMatchObject({ cobro: 3.1, real: 3.1, finCobro: null });
    for (const k of ['sinCasilla', 'sinFamilia', 'antesDelUno', 'aceptoDespues']) {
      expect(r[k], k).toMatchObject({ finCobro: null, texto: '' });
      expect(r[k].cobro, k).toBeCloseTo(226 / 60, 10);
    }
    for (const k of ['elUno', 'elDiaQueAcepto', 'sinFecha']) expect(r[k], k).toMatchObject({ cobro: 4, finCobro: '18:00' });
    expect(r.incompleto).toBeNull();
    expect(r.finAntes).toBeNull();
    verificarLimpio(e);
  });
});

test.describe('ficha de la familia: casilla "Aceptó términos y condiciones"', () => {
  test('marcarla guarda la fecha (hoy por defecto) y la ficha la muestra', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    const box = page.locator('#fam-terminos');
    await expect(page.locator('#fam-terminos-chk')).not.toBeChecked();
    await expect(page.locator('#fam-terminos-guardar')).toBeHidden();
    await page.check('#fam-terminos-chk');
    await expect(page.locator('#fam-terminos-fecha')).toHaveValue('2026-10-04');
    await page.locator('#fam-terminos-guardar').click();
    await expect(toasts(page).filter({ hasText: 'aceptó los términos' })).toBeVisible();
    const [cambio] = escrituras(e, 'familias', 'PATCH');
    expect(cambio.cuerpo).toEqual({ terminos_aceptados_el: '2026-10-04' });
    expect(cambio.params).toMatchObject({ id: `eq.${ID.fUno}` });
    // Rige desde el 01/12/2026 aunque los haya aceptado antes.
    await expect(box).toContainText('Desde el 01/12/2026, las horas de cada sitting se le cobran así');
    await expect(page.locator('#fam-terminos-chk')).toBeChecked();
    await expect(page.locator('#fam-terminos-guardar')).toBeHidden();
    verificarLimpio(e);
  });

  test('cambiar la fecha o sacar la marca también se guarda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos('2026-10-01') });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await expect(page.locator('#fam-terminos')).toContainText('Desde el 01/12/2026');
    await page.fill('#fam-terminos-fecha', '2026-12-15');
    await page.locator('#fam-terminos-guardar').click();
    await expect(page.locator('#fam-terminos')).toContainText('Desde el 15/12/2026');
    await page.uncheck('#fam-terminos-chk');
    await expect(page.locator('#fam-terminos-fecha-wrap')).toBeHidden();
    await page.locator('#fam-terminos-guardar').click();
    await expect(toasts(page).filter({ hasText: 'se sacó la marca' })).toBeVisible();
    expect(escrituras(e, 'familias', 'PATCH').map(w => w.cuerpo.terminos_aceptados_el)).toEqual(['2026-12-15', null]);
    await expect(page.locator('#fam-terminos-chk')).not.toBeChecked();
    verificarLimpio(e);
  });

  test('marcada sin fecha no se guarda', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await page.check('#fam-terminos-chk');
    await page.fill('#fam-terminos-fecha', '');
    await page.locator('#fam-terminos-guardar').click();
    await expect(toasts(page).filter({ hasText: 'Poné la fecha' })).toBeVisible();
    expect(escrituras(e, 'familias', 'PATCH')).toEqual([]);
    verificarLimpio(e);
  });

  test('si la base falla avisa y no la da por marcada', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    e.fallar = ({ tabla, metodo }) => (tabla === 'familias' && metodo === 'PATCH' ? { message: 'falla simulada' } : undefined);
    await page.check('#fam-terminos-chk');
    await page.locator('#fam-terminos-guardar').click();
    await expect(toasts(page).filter({ hasText: 'No se pudo guardar: falla simulada' })).toBeVisible();
    await expect(toasts(page).filter({ hasText: 'aceptó los términos' })).toHaveCount(0);
    expect(await page.evaluate(id => familiasItems.find(f => f.id === id).terminos_aceptados_el, ID.fUno)).toBeNull();
    await expect(page.locator('#fam-terminos-guardar')).toBeVisible(); // se puede reintentar
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('doble toque en Guardar: una sola escritura', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await page.check('#fam-terminos-chk');
    e.demoraEscrituras = 400;
    await page.locator('#fam-terminos-guardar').dblclick();
    await expect(toasts(page).filter({ hasText: 'aceptó los términos' })).toBeVisible();
    expect(escrituras(e, 'familias', 'PATCH')).toHaveLength(1);
    verificarLimpio(e);
  });
});

test.describe('alta de familia nueva', () => {
  async function abrirAlta(page) {
    await irAModulo(page, 'familias');
    await page.locator('button[onclick^="abrirModalNuevaFamilia"]').click();
    await page.fill('#fam-nombre', 'Familia Prueba Nueva');
  }
  const altas = e => escrituras(e, 'familias', 'POST');

  test('antes del 01/12: la casilla viene sin tildar; marcándola se guarda con la fecha (hoy por defecto)', async ({ page }) => {
    const e = await abrirApp(page);
    await abrirAlta(page);
    await expect(page.locator('#fam-terminos-nueva')).not.toBeChecked();
    await expect(page.locator('#fam-terminos-nueva-fecha-wrap')).toBeHidden();
    await page.check('#fam-terminos-nueva');
    await expect(page.locator('#fam-terminos-nueva-fecha')).toHaveValue('2026-10-04');
    await page.fill('#fam-terminos-nueva-fecha', '2026-10-02');
    await page.locator('#editmodal button', { hasText: 'Agregar familia' }).click();
    await expect(toasts(page).filter({ hasText: 'Familia agregada' })).toBeVisible();
    expect(altas(e)[0].cuerpo).toMatchObject({ nombre: 'Familia Prueba Nueva', terminos_aceptados_el: '2026-10-02' });
    verificarLimpio(e);
  });

  test('desde el 01/12: la casilla viene tildada con la fecha de hoy y se guarda así', async ({ page }) => {
    const e = await abrirApp(page, { ahora: '2026-12-01T09:00:00-03:00' });
    await abrirAlta(page);
    await expect(page.locator('#fam-terminos-nueva')).toBeChecked();
    await expect(page.locator('#fam-terminos-nueva-fecha')).toBeVisible();
    await expect(page.locator('#fam-terminos-nueva-fecha')).toHaveValue('2026-12-01');
    await page.locator('#editmodal button', { hasText: 'Agregar familia' }).click();
    await expect(toasts(page).filter({ hasText: 'Familia agregada' })).toBeVisible();
    expect(altas(e)[0].cuerpo).toMatchObject({ nombre: 'Familia Prueba Nueva', terminos_aceptados_el: '2026-12-01' });
    verificarLimpio(e);
  });

  test('desde el 01/12 se puede destildar: no manda la columna', async ({ page }) => {
    const e = await abrirApp(page, { ahora: '2026-12-10T09:00:00-03:00' });
    await abrirAlta(page);
    await page.uncheck('#fam-terminos-nueva');
    await expect(page.locator('#fam-terminos-nueva-fecha-wrap')).toBeHidden();
    await page.locator('#editmodal button', { hasText: 'Agregar familia' }).click();
    await expect(toasts(page).filter({ hasText: 'Familia agregada' })).toBeVisible();
    expect(altas(e)[0].cuerpo).not.toHaveProperty('terminos_aceptados_el');
    verificarLimpio(e);
  });

  test('familia nueva desde el registro de un sitting: desde el 01/12 también viene tildada', async ({ page }) => {
    const e = await abrirApp(page, { ahora: DICIEMBRE });
    await irAModulo(page, 'sittings');
    await page.locator('button[onclick^="abrirModalSitForm"]').first().click();
    await page.fill('#sit-familia', 'Familia Nueva Tres');
    await page.evaluate(() => onSitFamiliaInput());
    await page.locator('#sit-familia-create button', { hasText: 'Familia nueva' }).click();
    await expect(page.locator('#sitfam-terminos')).toBeChecked();
    await expect(page.locator('#sitfam-terminos-fecha')).toHaveValue('2026-12-05');
    await page.locator('#sit-familia-nueva button', { hasText: 'Crear familia' }).click();
    await expect(page.locator('#sit-familia-create')).toContainText('Familia creada.');
    expect(altas(e)[0].cuerpo).toMatchObject({ nombre: 'Familia Nueva Tres', terminos_aceptados_el: '2026-12-05' });
    verificarLimpio(e);
  });

  test('sin marcar no manda la columna', async ({ page }) => {
    const e = await abrirApp(page);
    await abrirAlta(page);
    await page.locator('#editmodal button', { hasText: 'Agregar familia' }).click();
    await expect(toasts(page).filter({ hasText: 'Familia agregada' })).toBeVisible();
    expect(altas(e)[0].cuerpo).not.toHaveProperty('terminos_aceptados_el');
    verificarLimpio(e);
  });

  test('marcada sin fecha no se guarda', async ({ page }) => {
    const e = await abrirApp(page);
    await abrirAlta(page);
    await page.check('#fam-terminos-nueva');
    await page.fill('#fam-terminos-nueva-fecha', '');
    await page.locator('#editmodal button', { hasText: 'Agregar familia' }).click();
    await expect(toasts(page).filter({ hasText: 'Poné la fecha' })).toBeVisible();
    expect(altas(e)).toEqual([]);
    verificarLimpio(e);
  });

  test('con la base sin migrar no aparece la casilla y el alta anda igual', async ({ page }) => {
    const e = await abrirApp(page, { baseSinMigrar: true });
    await abrirAlta(page);
    await expect(page.locator('#fam-terminos-nueva')).toHaveCount(0);
    await page.locator('#editmodal button', { hasText: 'Agregar familia' }).click();
    await expect(toasts(page).filter({ hasText: 'Familia agregada' })).toBeVisible();
    expect(altas(e)[0].cuerpo).not.toHaveProperty('terminos_aceptados_el');
    verificarLimpio(e, { ignorar: [/status of 400/, /status of 404/] });
  });
});

test.describe('registro en Sittings: "Hora real 17:46, se cobra hasta 18:00"', () => {
  test('familia que aceptó: cobro de 4 h, pago a la niñera con la hora real', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos(), ahora: DICIEMBRE });
    await nuevoSitting(page, { ini: '14:00', fin: '17:46' });
    await expect(page.locator('#sit-fin-cobro')).toHaveText('Hora real 17:46, se cobra hasta 18:00');
    await expect(page.locator('#sit-cobro')).toHaveValue('1520'); // 4 h a $380
    await expect(page.locator('#sit-pago')).toHaveValue('942'); // 3 h 46 a $250
    await page.locator('#editmodal button', { hasText: 'Guardar registro' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const [alta] = escrituras(e, 'sittings_traslados', 'POST');
    expect(alta.cuerpo).toMatchObject({ hora_inicio: '14:00', hora_fin: '17:46', cobro_familia: 1520, pago_ninera: 942 });
    verificarLimpio(e);
  });

  test('15 y 45 minutos se cobran exactos; 16 ya es la media hora', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos(), ahora: DICIEMBRE });
    await nuevoSitting(page, { ini: '14:00', fin: '17:15' });
    await expect(page.locator('#sit-fin-cobro')).toHaveText('');
    await expect(page.locator('#sit-cobro')).toHaveValue('1235'); // 3 h 15 a $380
    await expect(page.locator('#sit-pago')).toHaveValue('812'); // 3 h 15 a $250 (812,5: el pago baja)
    await hora(page, 'sit-horafin', '17:16');
    await expect(page.locator('#sit-fin-cobro')).toHaveText('Hora real 17:16, se cobra hasta 17:30');
    await expect(page.locator('#sit-cobro')).toHaveValue('1330');
    await hora(page, 'sit-horafin', '17:45');
    await expect(page.locator('#sit-fin-cobro')).toHaveText('');
    await expect(page.locator('#sit-cobro')).toHaveValue('1425');
    await hora(page, 'sit-horafin', '17:30');
    await expect(page.locator('#sit-fin-cobro')).toHaveText('');
    await expect(page.locator('#sit-cobro')).toHaveValue('1330');
    verificarLimpio(e);
  });

  test('el inicio no cuenta: de 14:20 a 17:36 son 3 h 16 y se cobra hasta las 17:50', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos(), ahora: DICIEMBRE });
    await nuevoSitting(page, { ini: '14:20', fin: '17:36' });
    await expect(page.locator('#sit-fin-cobro')).toHaveText('Hora real 17:36, se cobra hasta 17:50');
    await expect(page.locator('#sit-cobro')).toHaveValue('1330'); // 3 h 30
    await expect(page.locator('#sit-pago')).toHaveValue('817'); // 3 h 16
    verificarLimpio(e);
  });

  test('termina pasada la medianoche: se cobra hasta la 01:30', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos(), ahora: DICIEMBRE });
    await nuevoSitting(page, { ini: '22:00', fin: '01:20', cruza: true });
    await expect(page.locator('#sit-fin-cobro')).toHaveText('Hora real 01:20, se cobra hasta 01:30');
    await expect(page.locator('#sit-cobro')).toHaveValue('1330'); // 3,5 h
    await expect(page.locator('#sit-pago')).toHaveValue('833'); // 3 h 20
    await page.locator('#editmodal button', { hasText: 'Guardar registro' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ hora_fin: '01:20', termina_dia_siguiente: true, cobro_familia: 1330, pago_ninera: 833 });
    verificarLimpio(e);
  });

  test('termina 23:46: se cobra hasta las 00:00 sin marcar "termina al día siguiente"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos(), ahora: DICIEMBRE });
    await nuevoSitting(page, { ini: '20:00', fin: '23:46' });
    await expect(page.locator('#sit-fin-cobro')).toHaveText('Hora real 23:46, se cobra hasta 00:00');
    await expect(page.locator('#sit-cobro')).toHaveValue('1520');
    verificarLimpio(e);
  });

  test('familia sin la casilla: todo con la hora real, sin aviso', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos(), ahora: DICIEMBRE });
    await nuevoSitting(page, { familia: 'Familia Prueba Dos', ini: '14:00', fin: '17:46' });
    await expect(page.locator('#sit-fin-cobro')).toHaveText('');
    await expect(page.locator('#sit-cobro')).toHaveValue('1507'); // 3 h 46 a $400
    await expect(page.locator('#sit-pago')).toHaveValue('979');
    verificarLimpio(e);
  });

  test('sitting de antes del 01/12: hora real aunque haya aceptado antes', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos('2026-10-01'), ahora: DICIEMBRE });
    await nuevoSitting(page, { fecha: '2026-11-30', ini: '14:00', fin: '17:46' });
    await expect(page.locator('#sit-fin-cobro')).toHaveText('');
    await expect(page.locator('#sit-cobro')).toHaveValue('1431'); // 3 h 46 a $380
    verificarLimpio(e);
  });

  test('sitting de antes del día que aceptó (después del 01/12): hora real', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos('2026-12-04'), ahora: DICIEMBRE });
    await nuevoSitting(page, { fecha: '2026-12-03', ini: '14:00', fin: '17:46' });
    await expect(page.locator('#sit-fin-cobro')).toHaveText('');
    await expect(page.locator('#sit-cobro')).toHaveValue('1431');
    verificarLimpio(e);
  });

  test('cambiar la fecha después de las horas recalcula según el 01/12', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos('2026-10-01'), ahora: DICIEMBRE });
    await nuevoSitting(page, { fecha: '2026-12-03', ini: '14:00', fin: '17:46' });
    await expect(page.locator('#sit-cobro')).toHaveValue('1520');
    await page.fill('#sit-fecha', '2026-11-30');
    await page.locator('#sit-fecha').dispatchEvent('change');
    await expect(page.locator('#sit-cobro')).toHaveValue('1431');
    await expect(page.locator('#sit-fin-cobro')).toHaveText('');
    verificarLimpio(e);
  });

  test('abrir un registro guardado muestra el aviso sin recalcular el cobro', async ({ page }) => {
    const d = datosConTerminos('2026-09-01');
    const SIT = '70000000-0000-4000-8000-000000000003';
    Object.assign(d.sittings_traslados.find(s => s.id === SIT), { fecha: '2026-12-02', hora_fin: '19:46:00', cobro_familia: 1500 });
    const e = await abrirApp(page, { datos: d, ahora: DICIEMBRE });
    await irAModulo(page, 'sittings');
    await page.evaluate(id => abrirModalSitForm(id), SIT);
    await expect(page.locator('#sit-fin-cobro')).toHaveText('Hora real 19:46, se cobra hasta 20:00');
    await expect(page.locator('#sit-cobro')).toHaveValue('1500');
    verificarLimpio(e);
  });
});

test.describe('historial y PDF de la familia', () => {
  test('el horario aclara hasta qué hora se cobra', async ({ page }) => {
    const d = datosConTerminos('2026-09-01');
    d.app_config = [...(d.app_config || []), { id: 'cuenta_cobro', valor: { texto: 'Banco Prueba 0001234567' }, actualizado_at: '2026-10-01T00:00:00Z' }];
    Object.assign(d.sittings_traslados.find(s => s.id === '70000000-0000-4000-8000-000000000003'), { fecha: '2026-12-02', hora_fin: '19:18:00', cobro_familia: 1330 });
    const e = await abrirApp(page, { datos: d, ahora: DICIEMBRE });
    await irAModulo(page, 'sittings');
    await page.evaluate(() => {
      const sel = document.getElementById('sithist-familia');
      sel.value = [...sel.options].find(o => o.textContent === 'Familia Prueba Uno').value;
    });
    await page.evaluate(() => abrirModalExportarHistorialPDF());
    await page.fill('#exphist-desde', '2026-12-02');
    await page.fill('#exphist-hasta', '2026-12-02');
    await page.locator('#editmodal button', { hasText: 'Ver vista previa' }).click();
    const fila = page.locator('#exphist-preview tbody tr').first();
    await expect(fila).toContainText('16:00–19:18 (se cobra hasta 19:30)'); // 3 h 18: se cobran 3 h 30
    await expect(fila).toContainText('3.3 hs'); // horas reales
    await expect(page.locator('#exphist-total-pagar')).toHaveText('Total a pagar: $1.330');
    verificarLimpio(e);
  });

  test('familia sin la casilla: el horario de siempre', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'sittings');
    const txt = await page.evaluate(() => horarioEfectuadoTexto({ tipo: 'sitting', familia_id: sitFamilias[0].id, fecha: '2026-09-28', hora_inicio: '16:00:00', hora_fin: '19:36:00' }));
    expect(txt).toBe('16:00–19:36');
    verificarLimpio(e);
  });
});

test.describe('Agenda', () => {
  async function verAgendaDesde(page, fechaISO) {
    await page.evaluate(async f => { agendaAncla = f; await cargarAgendaSolicitudes(); }, fechaISO);
    await esperarQuieta(page);
  }

  test('registrar un día de un fijo: aviso y cobro redondeado, pago con la hora real', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos('2026-09-01'), ahora: '2026-12-10T12:00:00-03:00' });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-12-07');
    await page.evaluate(id => abrirModalSolicitud(`asig:${id}@2026-12-07`), ID.aFijo);
    await expect(page.locator('#agenda-fija-fin-cobro')).toHaveText(''); // 16 a 19 en punto
    await hora(page, 'agenda-fija-hf', '19:16');
    await expect(page.locator('#agenda-fija-fin-cobro')).toHaveText('Hora real 19:16, se cobra hasta 19:30');
    await page.locator('#editmodal button', { hasText: 'Registrar sitting de este día' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const [alta] = escrituras(e, 'sittings_traslados', 'POST');
    expect(alta.cuerpo).toMatchObject({ asignacion_id: ID.aFijo, hora_fin: '19:16', cobro_familia: 1330, pago_ninera: 817 });
    verificarLimpio(e);
  });

  test('reemplazo de un día de un fijo: misma regla', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos('2026-09-01'), ahora: '2026-12-10T12:00:00-03:00' });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-12-07');
    await page.evaluate(id => abrirModalSolicitud(`asig:${id}@2026-12-07`), ID.aFijo);
    await page.locator('#editmodal button', { hasText: 'Este día no fue' }).click();
    await page.locator('#editmodal button', { hasText: 'Vino otra niñera' }).click();
    await page.fill('#agenda-fija-reemplazo-ninera', 'Carla Ejemplo');
    await hora(page, 'agenda-fija-rhf', '19:46');
    await expect(page.locator('#agenda-fija-rfin-cobro')).toHaveText('Hora real 19:46, se cobra hasta 20:00');
    await page.locator('#editmodal button', { hasText: 'Registrar reemplazo' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_nombre: 'Carla Ejemplo', cobro_familia: 1520, pago_ninera: 942 });
    verificarLimpio(e);
  });

  test('solicitud puntual: el total estimado y el cobro guardado usan la regla', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos('2026-09-01'), ahora: DICIEMBRE });
    await irAModulo(page, 'agenda');
    await page.locator('button[onclick^="abrirModalNuevaSolicitud"]').first().click();
    await page.fill('#agenda-familia', 'Familia Prueba Uno');
    await page.evaluate(() => onAgendaFamiliaInput());
    await page.fill('#agenda-nueva-fecha', '2026-12-10');
    await hora(page, 'agenda-hora-inicio', '14:00');
    await hora(page, 'agenda-hora-fin', '17:46');
    await expect(page.locator('#agenda-total-preview')).toHaveText('Total estimado: $1.520 (4 h) · Hora real 17:46, se cobra hasta 18:00');
    await page.locator('#editmodal button', { hasText: /Guardar|Crear|Agregar/ }).last().click();
    await expect.poll(() => escrituras(e, 'solicitudes', 'POST').length).toBe(1);
    expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ hora_fin: '17:46', cobro_familia: 1520 });
    verificarLimpio(e);
  });
});

test.describe('fijos automáticos: el sitting de hoy sigue a la marca', () => {
  test('marcar los términos recalcula el de hoy (si nadie lo tocó) y pide recalcular los previstos', async ({ page }) => {
    const HOY = 'a1000000-0000-4000-8000-000000000005';
    const d = datosBase();
    d.app_config = [{ id: 'fijos_automaticos', valor: { activo: true, dias: 14 }, actualizado_at: '2026-10-04T06:00:00Z' }];
    d.asignaciones_pausas = [];
    d.asignaciones[0].hora_fin = '19:18:00';
    d.sittings_traslados = d.sittings_traslados.map(s => ({ ...s, estado: 'confirmado', generado_automatico: false, revisado_at: null }));
    d.sittings_traslados.push(sitting(HOY, '2026-12-07', { asignacion_id: ID.aFijo, estado: 'confirmado', generado_automatico: true, revisado_at: null,
      registrado_por: 'Automático', hora_fin: '19:18:00', cobro_familia: 1254, pago_ninera: 825 }));
    const e = await abrirApp(page, { datos: d, ahora: '2026-12-07T10:00:00-03:00' });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await page.check('#fam-terminos-chk');
    await page.locator('#fam-terminos-guardar').click();
    // 3 h 18: se cobran 3 h 30 ($1.330); a la niñera, 3 h 18 ($825).
    await expect.poll(() => e.db.sittings_traslados.find(s => s.id === HOY).cobro_familia).toBe(1330);
    expect(e.db.sittings_traslados.find(s => s.id === HOY)).toMatchObject({ pago_ninera: 825, hora_fin: '19:18' });
    expect(escrituras(e, 'rpc/generar_previstos_fijos', 'POST')).toHaveLength(1);
    verificarLimpio(e);
  });
});

test.describe('base sin la migración', () => {
  test('la app anda igual: sin la casilla y todo con la hora real', async ({ page }) => {
    const e = await abrirApp(page, { baseSinMigrar: true });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await expect(page.locator('#editmodal')).toContainText('Familia Prueba Uno');
    await expect(page.locator('#fam-terminos')).toHaveCount(0);
    await page.evaluate(() => cerrarModal());
    await nuevoSitting(page, { ini: '14:00', fin: '17:36' });
    await expect(page.locator('#sit-cobro')).toHaveValue('1368');
    await expect(page.locator('#sit-fin-cobro')).toHaveText('');
    await page.locator('#editmodal button', { hasText: 'Guardar registro' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ cobro_familia: 1368, pago_ninera: 900 });
    // La consulta con la columna falla una vez (400) y se reintenta sin ella; las tablas nuevas, 404.
    verificarLimpio(e, { ignorar: [/status of 400/, /status of 404/] });
  });
});

test.describe('celular (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('la casilla de la ficha entra en la pantalla', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTerminos() });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await expect(page.locator('#fam-terminos-fecha')).toBeVisible();
    const caja = await page.locator('#editmodal .confirmbox').boundingBox();
    expect(caja.x + caja.width).toBeLessThanOrEqual(391);
    const ancho = await page.evaluate(() => document.querySelector('#editmodal .confirmbox').scrollWidth - document.querySelector('#editmodal .confirmbox').clientWidth);
    expect(ancho, 'nada se sale de la ficha').toBeLessThanOrEqual(1);
    verificarLimpio(e);
  });
});
