// Cierre de los fijos en Hoy (21/10/2026): los días de los fijos que se confirmaron solos se
// cierran con la pregunta "¿Terminó a las 19:00?". "Otra hora" deja corregir la hora de entrada
// y la de fin, y en un sitting recalcula el cobro y el pago con la tarifa de la familia.
// Hoy en los tests = domingo 04/10/2026. Fijo de Ana en Familia Prueba Uno: 16 a 19
// (3 h a $380 / $250 = $1.140 de cobro y $750 de pago).
const { test, expect } = require('@playwright/test');
const { abrirApp, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

const MIE30 = 'a1000000-0000-4000-8000-000000000030';
const VIE2 = 'a1000000-0000-4000-8000-000000000102';
const auto = (id, fecha, extra = {}) => sitting(id, fecha, {
  asignacion_id: ID.aFijo, estado: 'confirmado', generado_automatico: true, revisado_at: null,
  registrado_por: 'Automático', notas: 'Sitting fijo — cargado automáticamente', ...extra,
});
function datos({ fila = {}, familia = {}, otras = [] } = {}) {
  const d = datosBase();
  d.app_config = [{ id: 'fijos_automaticos', valor: { activo: true, dias: 14 }, actualizado_at: '2026-10-04T06:00:00Z' }];
  d.sittings_traslados = d.sittings_traslados.map(s => ({ ...s, estado: 'confirmado', generado_automatico: false, revisado_at: null }));
  d.sittings_traslados.push(auto(MIE30, '2026-09-30', fila), ...otras);
  d.familias = d.familias.map(f => f.id === ID.fUno ? { ...f, ...familia } : f);
  d.asignaciones_pausas = [];
  return d;
}
const patches = e => e.escrituras.filter(w => w.tabla === 'sittings_traslados' && w.metodo === 'PATCH');
const tarjeta = page => page.locator('.autoconf-card');
async function elegirHora(page, prefijo, hhmm) {
  const [hh, mm] = hhmm.split(':');
  await page.selectOption(`#${prefijo}-hh`, hh);
  await page.selectOption(`#${prefijo}-mm`, mm);
}
async function abrirOtraHora(page) {
  await tarjeta(page).locator('button', { hasText: 'Otra hora' }).click();
  await expect(page.locator('#editmodal')).toContainText('¿A qué hora fue?');
}

test.describe('Cierre de los fijos en Hoy', () => {
  test('cada día muestra lo previsto y pregunta si terminó a esa hora', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    const card = tarjeta(page);
    await expect(card.locator('h2')).toHaveText('Cierre de los fijos');
    await expect(card).toContainText('Ana Ficticia en Familia Prueba Uno');
    await expect(card).toContainText('Sitting previsto 16:00–19:00 · cobro $1.140 · pago $750. ¿Terminó a las 19:00?');
    // "Variantes" (23/10/2026): las variantes de precio de la familia y el ajuste libre (variantes-precio.spec.js).
    await expect(card.locator('.autoconf-btns button')).toHaveText(['Sí, terminó 19:00', 'Otra hora', 'Variantes', 'No fue', 'Fue otra']);
    await card.locator('button', { hasText: 'Sí, terminó 19:00' }).click();
    await expect(card).toHaveCount(0);
    const [revision] = patches(e);
    expect(Object.keys(revision.cuerpo)).toEqual(['revisado_at']);
    verificarLimpio(e);
  });

  test('"Sí a todos" cierra todos los días juntos', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ otras: [auto(VIE2, '2026-10-02')] }) });
    await expect(tarjeta(page).locator('.autoconf-fila')).toHaveCount(2);
    await tarjeta(page).locator('button', { hasText: 'Sí a todos' }).click();
    await expect(tarjeta(page)).toHaveCount(0);
    expect(patches(e)).toHaveLength(1);
    expect(patches(e)[0].params).toEqual({ id: `in.(${MIE30},${VIE2})` });
    verificarLimpio(e);
  });

  test('"Otra hora": cambia la entrada y recalcula cobro y pago con la tarifa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirOtraHora(page);
    await expect(page.locator('#autoconf-precio')).toHaveText('Queda: cobro $1.140 · pago $750.');
    await elegirHora(page, 'autoconf-hi', '15:30');
    await expect(page.locator('#autoconf-precio')).toHaveText('Queda: cobro $1.330 · pago $875.');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    await expect(page.locator('.toaststack .toast').last()).toContainText('horario real');
    await expect(tarjeta(page)).toHaveCount(0);
    const [cambio] = patches(e);
    expect(cambio.params).toEqual({ id: `eq.${MIE30}`, cobrado: 'eq.false', pagado: 'eq.false', select: 'id' });
    expect(cambio.cuerpo).toMatchObject({ hora_inicio: '15:30', hora_fin: '19:00', termina_dia_siguiente: false, cobro_familia: 1330, pago_ninera: 875, generado_automatico: false });
    expect(cambio.cuerpo.revisado_at).toBeTruthy();
    verificarLimpio(e);
  });

  test('"Otra hora" con términos: las horas se cobran redondeadas y se paga la hora real', async ({ page }) => {
    // El redondeo rige desde el 01/12/2026 (04/11/2026): el día del fijo y "hoy", en diciembre.
    const e = await abrirApp(page, { datos: datos({ fila: { fecha: '2026-12-02' }, familia: { terminos_aceptados_el: '2026-09-01' } }), ahora: '2026-12-04T12:00:00-03:00' });
    await abrirOtraHora(page);
    await elegirHora(page, 'autoconf-hf', '19:46');
    // 3 h 46: se cobran 4 h (× 380) y se pagan 3 h 46 (× 250).
    await expect(page.locator('#autoconf-precio')).toHaveText('Queda: cobro $1.520 · pago $942.');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(patches(e)[0].cuerpo).toMatchObject({ hora_inicio: '16:00', hora_fin: '19:46', cobro_familia: 1520, pago_ninera: 942 });
    verificarLimpio(e);
  });

  test('"Otra hora" pasada la medianoche: sin la casilla avisa y no guarda; con la casilla, sí', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirOtraHora(page);
    await elegirHora(page, 'autoconf-hi', '22:00');
    await elegirHora(page, 'autoconf-hf', '01:00');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#autoconf-warn')).toContainText('Termina al día siguiente');
    expect(patches(e)).toHaveLength(0);
    await page.check('#autoconf-cruza');
    await expect(page.locator('#autoconf-precio')).toHaveText('Queda: cobro $1.140 · pago $750.');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(patches(e)[0].cuerpo).toMatchObject({ hora_inicio: '22:00', hora_fin: '01:00', termina_dia_siguiente: true, cobro_familia: 1140, pago_ninera: 750 });
    verificarLimpio(e);
  });

  test('"Otra hora" con la casilla mal marcada (fin después de la entrada) no guarda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirOtraHora(page);
    await page.check('#autoconf-cruza');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#autoconf-warn')).toContainText('serían más de 24 horas');
    await expect(page.locator('#autoconf-precio')).toHaveText('');
    expect(patches(e)).toHaveLength(0);
    verificarLimpio(e);
  });

  test('ya cobrado: "Otra hora" no abre y manda a Sittings', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ fila: { cobrado: true } }) });
    await tarjeta(page).locator('button', { hasText: 'Otra hora' }).click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('cobrado o pagado');
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(patches(e)).toHaveLength(0);
    verificarLimpio(e);
  });

  test('si otra admin lo cobró con el modal abierto, no se pisa y se avisa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirOtraHora(page);
    await elegirHora(page, 'autoconf-hi', '15:00');
    e.db.sittings_traslados.find(s => s.id === MIE30).cobrado = true;
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#autoconf-warn')).toContainText('alguien lo marcó como cobrado o pagado');
    await expect(page.locator('#editmodal')).toBeVisible();
    const fila = e.db.sittings_traslados.find(s => s.id === MIE30);
    expect([fila.hora_inicio, fila.cobro_familia]).toEqual(['16:00:00', 1140]);
    verificarLimpio(e);
  });

  test('si la base falla, avisa, el modal queda abierto y el día sigue en la lista', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirOtraHora(page);
    await elegirHora(page, 'autoconf-hi', '15:00');
    e.fallar = ({ tabla, metodo }) => (tabla === 'sittings_traslados' && metodo === 'PATCH' ? { message: 'falla simulada' } : undefined);
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#autoconf-warn')).toContainText('falla simulada');
    await expect(page.locator('#editmodal')).toBeVisible();
    await page.locator('#editmodal button', { hasText: 'Cancelar' }).click();
    await expect(tarjeta(page).locator('.autoconf-fila')).toHaveCount(1);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('si no se puede leer la tarifa, no abre (no guarda la hora con el precio viejo)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await page.route(/\/rest\/v1\/familias\?.*id=eq\./, r => r.fulfill({ status: 500, json: { message: 'falla simulada' } }));
    await tarjeta(page).locator('button', { hasText: 'Otra hora' }).click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('No se pudo leer la tarifa');
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(patches(e)).toHaveLength(0);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('doble toque en Guardar: una sola escritura', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirOtraHora(page);
    await elegirHora(page, 'autoconf-hi', '15:00');
    e.demoraEscrituras = 400;
    await page.locator('#editmodal button', { hasText: 'Guardar' }).dblclick();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(patches(e)).toHaveLength(1);
    verificarLimpio(e);
  });

  test('Cancelar no escribe nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirOtraHora(page);
    await elegirHora(page, 'autoconf-hi', '15:00');
    await page.locator('#editmodal button', { hasText: 'Cancelar' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    await expect(tarjeta(page).locator('.autoconf-fila')).toHaveCount(1);
    expect(patches(e)).toHaveLength(0);
    verificarLimpio(e);
  });

  test('familia sin tarifa por hora: cambia el horario y el precio queda como estaba', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ familia: { cobro_hora: null, pago_hora: null } }) });
    await abrirOtraHora(page);
    await elegirHora(page, 'autoconf-hi', '15:00');
    await expect(page.locator('#autoconf-precio')).toContainText('no tiene tarifa por hora');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const [cambio] = patches(e);
    expect(cambio.cuerpo).toMatchObject({ hora_inicio: '15:00', hora_fin: '19:00' });
    expect(cambio.cuerpo).not.toHaveProperty('cobro_familia');
    expect(cambio.cuerpo).not.toHaveProperty('pago_ninera');
    verificarLimpio(e);
  });

  test('traslado: solo cambia la hora, el precio queda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ fila: { tipo: 'traslado', hora_inicio: '08:00:00', hora_fin: null, cobro_familia: 450, pago_ninera: 250 } }) });
    const card = tarjeta(page);
    await expect(card).toContainText('Traslado previsto 08:00 · cobro $450 · pago $250.');
    await expect(card).not.toContainText('¿Terminó');
    await expect(card.locator('.autoconf-btns button').first()).toHaveText('Sí, fue así');
    await abrirOtraHora(page);
    await expect(page.locator('#autoconf-hf-hh')).toHaveCount(0);
    await elegirHora(page, 'autoconf-hi', '08:30');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const [cambio] = patches(e);
    expect(Object.keys(cambio.cuerpo).sort()).toEqual(['generado_automatico', 'hora_inicio', 'revisado_at']);
    expect(cambio.cuerpo.hora_inicio).toBe('08:30');
    verificarLimpio(e);
  });

  test('nombres con HTML se muestran como texto', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ fila: { ninera_nombre: '<img src=x onerror="window.__xss=1">Ana', familia_nombre: '"Familia" <b>Uno</b>' } }) });
    await expect(tarjeta(page)).toContainText('<img src=x onerror="window.__xss=1">Ana en "Familia" <b>Uno</b>');
    await abrirOtraHora(page);
    await expect(page.locator('#editmodal')).toContainText('"Familia" <b>Uno</b>');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });

  test('celular de 390 px: la tarjeta y el modal entran sin scroll de costado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: datos() });
    await expect(tarjeta(page)).toBeVisible();
    const ancho = () => page.evaluate(() => document.documentElement.scrollWidth);
    expect(await ancho()).toBeLessThanOrEqual(390);
    const borde = await tarjeta(page).boundingBox();
    for (const b of await tarjeta(page).locator('.autoconf-btns button').all()) {
      const caja = await b.boundingBox();
      expect(caja.x + caja.width).toBeLessThanOrEqual(borde.x + borde.width - 8); // dentro de la tarjeta, no pegado al borde
    }
    await abrirOtraHora(page);
    expect(await ancho()).toBeLessThanOrEqual(390);
    const guardar = await page.locator('#editmodal button', { hasText: 'Guardar' }).boundingBox();
    expect(guardar.x + guardar.width).toBeLessThanOrEqual(390);
    verificarLimpio(e);
  });
});
