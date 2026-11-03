// El panel con el día de los traslados de la app de niñeras (fase 1, etapa 11b, 03/11/2026, decisiones.md 6.10):
// "Cierre de los fijos" recibe el cierre de un traslado (sin hora: es un viaje y el precio no cambia), con el gasto y
// "¿Quién lo paga?" (recién ahí pasa a gastos_extra), los comentarios y "Revisado"; "En curso" en Hoy con lo que avisó
// la niñera de un traslado (tarde, no están los chicos, no marcó que salió) y "Contactarla". Dos admins, cobrado
// mientras tanto, escape y 390 px. Hoy en los tests = domingo 04/10/2026. Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

const TRASLADO = 'a7b00000-0000-4000-8000-000000000001'; // sábado 03/10 a las 08:00 ($450 / $250 por viaje)
const HOY = '70000000-0000-4000-8000-000000000005';      // el de Ana de hoy a las 18:00 (acá, un traslado)
const COMPROBANTE = `ninieras/${ID.nAna}/${TRASLADO}.jpg`;
const cierre = (extra = {}) => ({ sitting_id: TRASLADO, ninera_id: ID.nAna, hora_fin: null, termina_dia_siguiente: false,
  comentarios: null, calificacion: null, volveria: null, jugaron: null, comentario_equipo: null, gasto_monto: null, gasto_concepto: null,
  gasto_comprobante: null, gasto_id: null, creado_en: '2026-10-03T11:40:00.000Z', revisado_en: null, revisado_por: null, ...extra });
const conGasto = (extra = {}) => cierre({ gasto_monto: 180, gasto_concepto: 'Peaje', gasto_comprobante: COMPROBANTE, ...extra });
function datos({ cierres = [cierre()], fila = {} } = {}) {
  const d = datosBase();
  d.sittings_traslados.push(sitting(TRASLADO, '2026-10-03', { tipo: 'traslado', hora_inicio: '08:00:00', hora_fin: null,
    cobro_familia: 450, pago_ninera: 250, km: 5, origen: 'Origen Inventado 1', destino: 'Destino Inventado 2', estado: 'confirmado', ...fila }));
  d.sitting_cierres = cierres;
  d.sitting_eventos = [];
  return d;
}
const fila = page => page.locator(`.autoconf-cierre[data-autoconf="${TRASLADO}"]`);
const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && (!metodo || w.metodo === metodo));
const ultimoToast = page => page.locator('.toaststack .toast').last();

test.describe('"Cierre de los fijos" con el cierre de un traslado', () => {
  test('la fila: sin hora, el traslado con su precio y solo "Revisado" (sin "Otra hora")', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await expect(fila(page).locator('.autoconf-txt > div').first()).toContainText('Ana Ficticia con Familia Prueba Uno');
    await expect(fila(page).locator('.autoconf-txt > .helper').first()).toHaveText('Traslado a las 08:00, cobro $450 y pago $250.');
    await expect(fila(page).locator('.cierre-ninera > div')).toHaveText(['Ana Ficticia mandó el cierre del traslado. Sin gastos ni comentarios.']);
    await expect(fila(page).locator('.autoconf-btns button')).toHaveText(['Revisado']);
    verificarLimpio(e);
  });

  test('"Revisado": toma el cierre, marca el registro sin tocar la hora ni el precio y sale de la lista', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await fila(page).getByRole('button', { name: 'Revisado' }).click();
    await expect(ultimoToast(page)).toHaveText('Listo: quedó revisado.');
    await expect(fila(page)).toHaveCount(0);
    const [tomar] = escrituras(e, 'sitting_cierres', 'PATCH');
    expect(tomar.params).toMatchObject({ sitting_id: `eq.${TRASLADO}`, revisado_en: 'is.null' });
    expect(Object.keys(tomar.cuerpo).sort()).toEqual(['revisado_en', 'revisado_por']);
    const [registro] = escrituras(e, 'sittings_traslados', 'PATCH');
    expect(registro.params).toMatchObject({ id: `eq.${TRASLADO}`, cobrado: 'eq.false', pagado: 'eq.false' });
    expect(Object.keys(registro.cuerpo).sort()).toEqual(['generado_automatico', 'revisado_at']);
    expect(escrituras(e, 'gastos_extra')).toEqual([]);
    verificarLimpio(e);
  });

  test('con gasto y comentarios: lo dice, pide quién lo paga y recién ahí pasa a gastos_extra', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto({ comentarios: 'Mucho tránsito en la rambla' })] }) });
    await expect(fila(page).locator('.cierre-ninera')).toContainText('Ana Ficticia mandó el cierre del traslado.');
    await expect(fila(page).locator('.cierre-ninera')).not.toContainText('Sin gastos ni comentarios');
    await expect(fila(page).locator('.cierre-ninera')).toContainText('Gasto: Peaje, $180.');
    await expect(fila(page).locator('.cierre-ninera')).toContainText('Comentarios: Mucho tránsito en la rambla');
    await fila(page).getByRole('button', { name: 'Revisado' }).click();
    await expect(ultimoToast(page)).toHaveText('Elegí quién paga el gasto antes de confirmar.');
    expect(escrituras(e, 'sitting_cierres')).toEqual([]);
    await fila(page).getByLabel('La familia').check();
    await fila(page).getByRole('button', { name: 'Revisado' }).click();
    await expect(ultimoToast(page)).toHaveText('Listo: quedó revisado y el gasto pasó a Por cobrar / Por pagar.');
    const [gasto] = escrituras(e, 'gastos_extra', 'POST');
    expect(gasto.cuerpo).toMatchObject({ sitting_id: TRASLADO, concepto: 'Peaje', monto: 180, pagado_por: 'ninera', comprobante: COMPROBANTE });
    expect('absorbe_pb' in gasto.cuerpo).toBe(false);
    verificarLimpio(e);
  });

  test('"Ver comprobante" abre el ticket con un link firmado', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto()] }) });
    const popup = page.waitForEvent('popup');
    await fila(page).getByRole('button', { name: 'Ver comprobante' }).click();
    await (await popup).close();
    expect(e.escrituras.map(w => w.tabla)).toContain(`/storage/v1/object/sign/comprobantes/${COMPROBANTE}`);
    verificarLimpio(e);
  });

  test('otra admin ya lo revisó: avisa y no toca el registro', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    e.db.sitting_cierres[0].revisado_en = '2026-10-04T14:00:00.000Z';
    await fila(page).getByRole('button', { name: 'Revisado' }).click();
    await expect(ultimoToast(page)).toHaveText('Otra admin ya revisó este cierre.');
    expect(escrituras(e, 'sittings_traslados')).toEqual([]);
    verificarLimpio(e);
  });

  test('lo marcaron cobrado mientras tanto: no guarda y el cierre vuelve a quedar sin revisar', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto()] }) });
    e.db.sittings_traslados.find(s => s.id === TRASLADO).pagado = true;
    await fila(page).getByLabel('Parents Break').check();
    await fila(page).getByRole('button', { name: 'Revisado' }).click();
    await expect(ultimoToast(page)).toHaveText('No se guardó: mientras tanto alguien lo marcó como cobrado o pagado. Corregilo desde Sittings & traslados.');
    expect(e.db.sitting_cierres[0]).toMatchObject({ revisado_en: null, revisado_por: null });
    expect(escrituras(e, 'gastos_extra')).toEqual([]);
    verificarLimpio(e);
  });

  test('doble toque en "Revisado": una sola revisión', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    e.demoraEscrituras = 400;
    const boton = fila(page).getByRole('button', { name: 'Revisado' });
    await boton.click();
    await boton.click({ force: true }).catch(() => {});
    await expect(fila(page)).toHaveCount(0);
    expect(escrituras(e, 'sitting_cierres', 'PATCH')).toHaveLength(1);
    expect(escrituras(e, 'sittings_traslados', 'PATCH')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('escape: lo que escribió la niñera no ejecuta nada', async ({ page }) => {
    const malo = '<img src=x onerror="window.__xss=1">"\'';
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto({ comentarios: malo, gasto_concepto: malo })] }) });
    await expect(fila(page).locator('.cierre-ninera')).toContainText('Comentarios: <img');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });

  test('390 px: la fila del cierre del traslado sin scroll de costado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto({ comentarios: 'Mucho tránsito en la rambla' })] }) });
    await expect(fila(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await fila(page).screenshot({ path: test.info().outputPath('cierre-traslado-390.png') });
    verificarLimpio(e);
  });
});

test.describe('"En curso" en Hoy con un traslado', () => {
  function datosHoy(eventos = [], { fijo = false, conSitting = false } = {}) {
    const d = datosBase();
    d.ninieras.find(n => n.id === ID.nAna).user_id = 'e0000000-0000-4000-8000-0000000000a9';
    Object.assign(d.sittings_traslados.find(s => s.id === HOY), { tipo: 'traslado', hora_fin: null, familia_nombre: 'Familia Prueba Uno',
      asignacion_id: fijo ? ID.aFijo : null });
    if (conSitting) d.sittings_traslados.push(sitting('a7b00000-0000-4000-8000-000000000002', '2026-10-04', { hora_inicio: '17:30:00',
      hora_fin: '21:00:00', estado: 'confirmado' }));
    d.sitting_eventos = eventos.map(([tipo, minutos, en]) => ({ id: `e7${tipo}`, sitting_id: HOY, ninera_id: ID.nAna, tipo, minutos, creado_en: en }));
    d.sitting_cierres = [];
    return d;
  }
  const card = page => page.locator('.en-curso-card');

  test('va a llegar tarde: "En curso", la fila del traslado con lo que avisó y "Contactarla"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy([['tarde', 20, '2026-10-04T20:50:00.000Z']]), ahora: '2026-10-04T17:55:00-03:00' });
    await expect(card(page).locator('h2')).toHaveText('En curso');
    await expect(card(page).locator('.en-curso-txt > div')).toHaveText(['Ana Ficticia, traslado de Familia Prueba Uno a las 18:00',
      'Va a llegar 20 min tarde (avisó a las 17:50).']);
    await expect(card(page).getByRole('link', { name: 'Contactarla' })).toHaveAttribute('href', /^https:\/\/wa\.me\/59898000001/);
    verificarLimpio(e);
  });

  test('"No están los chicos" y el link del aviso (?ir=hoy&sitting=<id>) con la fila marcada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy([['no_estan', null, '2026-10-04T21:02:00.000Z']]), ahora: '2026-10-04T18:05:00-03:00',
      ruta: `/?ir=hoy&sitting=${HOY}` });
    await expect(card(page).locator(`.en-curso-fila.marcada[data-sitting="${HOY}"]`)).toContainText('Llegó y no están los chicos (18:02).');
    verificarLimpio(e);
  });

  test('a la hora de salida sin ningún toque: "No marcó que salió"; un fijo, no; antes de la hora, no', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy(), ahora: '2026-10-04T18:00:00-03:00' });
    await expect(card(page)).toContainText('No marcó que salió.');
    await expect(card(page)).not.toContainText('No marcó que llegó');
    verificarLimpio(e);
    const e2 = await abrirApp(page, { datos: datosHoy([], { fijo: true }), ahora: '2026-10-04T18:20:00-03:00' });
    await expect(page.locator('#dash-en-curso')).toBeEmpty();
    verificarLimpio(e2);
    const e3 = await abrirApp(page, { datos: datosHoy(), ahora: '2026-10-04T17:59:00-03:00' });
    await expect(page.locator('#dash-en-curso')).toBeEmpty();
    verificarLimpio(e3);
  });

  test('salió, los buscó o los dejó: ya no es un problema', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy([['saliendo', null, '2026-10-04T20:40:00.000Z']]), ahora: '2026-10-04T18:05:00-03:00' });
    await expect(page.locator('#dash-en-curso')).toBeEmpty();
    verificarLimpio(e);
    const e2 = await abrirApp(page, { datos: datosHoy([['tarde', 10, '2026-10-04T20:50:00.000Z'], ['busque', null, '2026-10-04T21:08:00.000Z']]),
      ahora: '2026-10-04T18:10:00-03:00' });
    await expect(page.locator('#dash-en-curso')).toBeEmpty();
    verificarLimpio(e2);
  });

  test('un sitting y un traslado a la vez: las dos filas, cada una con su texto', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy([], { conSitting: true }), ahora: '2026-10-04T18:00:00-03:00' });
    await expect(card(page).locator('h2')).toHaveText('En curso');
    await expect(card(page).locator('.en-curso-fila')).toHaveCount(2);
    await expect(card(page)).toContainText('No marcó que llegó.');
    await expect(card(page)).toContainText('No marcó que salió.');
    verificarLimpio(e);
  });

  test('base sin la migración del día: sin la tarjeta y sin errores', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy([['tarde', 20, '2026-10-04T20:50:00.000Z']]), ahora: '2026-10-04T17:55:00-03:00', baseSinMigrar: 'etapa7' });
    await expect(page.locator('#dash-en-curso')).toBeEmpty();
    verificarLimpio(e, { ignorar: [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/] });
  });
});
