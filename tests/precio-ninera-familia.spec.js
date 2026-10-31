// Precio por hora de cada niñera con cada familia (01/11/2026, docs/precio-ninera-familia.md, tarea B):
// donde el panel calcula el pago de un sitting, el pago por hora sale de precioHoraNinera (core.js):
// el precio propio del fijo (solo los días de ese fijo con su niñera), si no el de esa niñera con esa
// familia (precios_ninera_familia), si no la tarifa de la familia. Un reemplazo cobra su propio precio,
// nunca el del fijo. Al tipear a mano otro pago por hora aparece "Guardar como precio de [niñera] con
// esta familia": tildada solo si esa niñera no tiene precio con esa familia (respuesta 3 de Diego).
// Datos inventados: Familia Prueba Uno cobra $380 y paga $250 por hora (fijo de Ana lunes y miércoles
// de 16 a 19); Familia Prueba Dos cobra $400 y paga $260. Hoy en los tests = domingo 04/10/2026.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

let nPrecio = 0;
const precio = (familia_id, ninera_id, pago_hora, extra = {}) => ({
  id: `95000000-0000-4000-8000-${String(++nPrecio).padStart(12, '0')}`,
  familia_id, ninera_id, pago_hora, nota: null, creado_por: 'Prueba', creado_en: '2026-10-01T12:00:00Z', actualizado_en: '2026-10-01T12:00:00Z', ...extra,
});
function datosCon({ precios = [], fijo = {}, fijosAutomaticos = false } = {}) {
  const d = datosBase();
  d.precios_ninera_familia = precios;
  Object.assign(d.asignaciones.find(a => a.id === ID.aFijo), fijo);
  if (fijosAutomaticos) {
    d.app_config = [{ id: 'fijos_automaticos', valor: { activo: true, dias: 14 }, actualizado_at: '2026-10-04T06:00:00Z' }];
    d.asignaciones_pausas = [];
  }
  return d;
}
const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && w.metodo === metodo);
const llamadasProceso = e => e.escrituras.filter(w => w.tabla === 'rpc/generar_previstos_fijos');
async function hora(page, prefijo, hhmm) {
  const [hh, mm] = hhmm.split(':');
  await page.selectOption(`#${prefijo}-hh`, hh);
  await page.selectOption(`#${prefijo}-mm`, mm);
}
// Las lecturas de la tabla nueva, para ver que es una por familia y con las columnas justas.
function espiarLecturas(page) {
  const urls = [];
  page.on('request', r => { if (r.method() === 'GET' && r.url().includes('/rest/v1/precios_ninera_familia')) urls.push(decodeURIComponent(r.url())); });
  return urls;
}

/* ---------------- Sittings & traslados ---------------- */
async function nuevoSitting(page, { familia = 'Familia Prueba Uno', ninera = 'Carla Ejemplo', ini = '14:00', fin = '17:00' } = {}) {
  await irAModulo(page, 'sittings');
  await page.locator('button[onclick^="abrirModalSitForm"]').first().click();
  await page.fill('#sit-familia', familia);
  await page.fill('#sit-ninera', ninera);
  await page.fill('#sit-fecha', '2026-10-03');
  await hora(page, 'sit-horaini', ini);
  await hora(page, 'sit-horafin', fin);
}
const guardarSit = page => page.locator('#editmodal button', { hasText: /^Guardar (registro|cambios)$/ }).click();
const casilla = page => page.locator('#sit-guardar-precio');
async function pagoPorHora(page) {
  await page.locator('#sit-pago-modo-link').click();
  await expect(page.locator('#sit-pago-hora')).toBeVisible();
}

test.describe('Sittings: el pago por hora de la niñera con esa familia', () => {
  test('con precio guardado: horas por su precio; sin precio: la tarifa. Una sola lectura por familia', async ({ page }) => {
    const urls = espiarLecturas(page);
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nCarla, 300)] }) });
    await nuevoSitting(page);
    await expect(page.locator('#sit-pago')).toHaveValue('900'); // 3 h a $300
    await expect(page.locator('#sit-cobro')).toHaveValue('1140'); // el cobro sigue con la tarifa de la familia
    // Cambiar la niñera recalcula, como cambiar la hora.
    await page.fill('#sit-ninera', 'Ana Ficticia');
    await expect(page.locator('#sit-pago')).toHaveValue('750'); // Ana no tiene precio: la tarifa ($250)
    await page.fill('#sit-ninera', 'Carla Ejemplo');
    await expect(page.locator('#sit-pago')).toHaveValue('900');
    await expect(page.locator('#sit-precio-sugerido')).toBeEmpty();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`familia_id=eq.${ID.fUno}`);
    expect(urls[0]).toContain('select=familia_id,ninera_id,pago_hora');
    await guardarSit(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nCarla, cobro_familia: 1140, pago_ninera: 900, precio_motivo: null });
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toEqual([]);
    verificarLimpio(e);
  });

  test('lo puesto a mano no se pisa al cambiar la niñera: ofrece el nuevo monto', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nCarla, 300)] }) });
    await nuevoSitting(page, { ninera: 'Ana Ficticia' });
    await expect(page.locator('#sit-pago')).toHaveValue('750');
    await page.fill('#sit-pago', '800');
    await page.fill('#sit-ninera', 'Carla Ejemplo');
    await expect(page.locator('#sit-pago')).toHaveValue('800');
    await expect(page.locator('#sit-precio-sugerido')).toContainText('pago $900');
    await page.locator('#sit-precio-sugerido button', { hasText: 'Usar el nuevo monto ($900)' }).click();
    await expect(page.locator('#sit-pago')).toHaveValue('900');
    verificarLimpio(e);
  });

  test('cambiar a una niñera con el mismo pago no pregunta nada en un registro con precio a mano', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevoSitting(page, { ninera: 'Ana Ficticia' });
    await page.fill('#sit-pago', '800');
    await page.selectOption('#sit-precio-motivo', 'extra');
    await page.fill('#sit-ninera', 'Carla Ejemplo'); // ninguna tiene precio propio: el pago por hora no cambia
    await expect(page.locator('#sit-precio-elegir')).toHaveCount(0);
    await expect(page.locator('#sit-precio-motivo')).toHaveValue('extra');
    verificarLimpio(e);
  });

  test('editar un registro hecho con el precio de la niñera no lo marca como precio a mano', async ({ page }) => {
    const d = datosCon({ precios: [precio(ID.fUno, ID.nCarla, 300)] });
    const ID_REG = '70000000-0000-4000-8000-000000000099';
    d.sittings_traslados.push(sitting(ID_REG, '2026-10-02', { ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', hora_inicio: '14:00:00', hora_fin: '17:00:00', cobro_familia: 1140, pago_ninera: 900 }));
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'sittings');
    await page.evaluate(i => abrirModalSitForm(i), ID_REG);
    await expect(page.locator('#sit-ninera')).toHaveValue('Carla Ejemplo');
    await expect(page.locator('#sit-pago')).toHaveValue('900');
    await expect(page.locator('#sit-precio-sugerido')).toBeEmpty();
    await hora(page, 'sit-horafin', '18:00'); // como no era a mano, sigue al horario
    await expect(page.locator('#sit-pago')).toHaveValue('1200');
    verificarLimpio(e);
  });

  test('el día de un fijo cargado desde "Sin registrar": el precio propio del fijo', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nAna, 300)], fijo: { pago_hora: 320 } }) });
    // El mismo item que arma "Sittings sin registrar" en Hoy para un día de un fijo.
    await page.evaluate(([asig, ana]) => cargarSittingDesdePendiente({ fecha: '2026-09-30', ninera_nombre: 'Ana Ficticia', ninera_id: ana, familia_nombre: 'Familia Prueba Uno',
      hora_inicio: '16:00:00', hora_fin: '19:00:00', esFijo: true, asignacion_id: asig, tipo: 'sitting', cobro_traslado: null, pago_traslado: null, pago_hora: 320 }), [ID.aFijo, ID.nAna]);
    await expect(page.locator('#sit-ninera')).toHaveValue('Ana Ficticia');
    await expect(page.locator('#sit-pago')).toHaveValue('960'); // 3 h a $320, el del fijo
    // Si ese día fue otra (reemplazo), no se le paga el precio del fijo: el suyo o la tarifa.
    await page.fill('#sit-ninera', 'Carla Ejemplo');
    await expect(page.locator('#sit-pago')).toHaveValue('750');
    verificarLimpio(e);
  });
});
test.describe('Sittings: "Guardar como precio de [niñera] con esta familia"', () => {
  test('sin precio guardado: aparece tildada al tipear otro pago por hora y se guarda con el registro', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevoSitting(page);
    await pagoPorHora(page);
    await expect(page.locator('#sit-pago-hora')).toHaveValue('250'); // la tarifa de la familia
    await expect(casilla(page)).toBeHidden();
    await page.fill('#sit-pago-hora', '280');
    await expect(page.locator('#sit-pago')).toHaveValue('840');
    await expect(casilla(page)).toBeVisible();
    await expect(casilla(page)).toBeChecked();
    await expect(page.locator('#sit-guardar-precio-wrap')).toContainText('Guardar como precio de Carla Ejemplo con esta familia');
    await guardarSit(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nCarla, pago_ninera: 840 });
    const [w] = escrituras(e, 'precios_ninera_familia', 'POST');
    expect(w.cuerpo).toEqual({ familia_id: ID.fUno, ninera_id: ID.nCarla, pago_hora: 280, creado_por: 'Prueba' });
    expect(w.params.on_conflict).toBe('familia_id,ninera_id');
    await expect(page.locator('.toaststack .toast.good', { hasText: 'precio de Carla Ejemplo con esta familia' })).toBeVisible();
    expect(llamadasProceso(e)).toEqual([]); // Carla no tiene fijo con esta familia (y los automáticos están apagados)
    verificarLimpio(e);
  });

  test('destildada no guarda el precio', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevoSitting(page);
    await pagoPorHora(page);
    await page.fill('#sit-pago-hora', '280');
    await casilla(page).uncheck();
    await guardarSit(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ pago_ninera: 840 });
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toEqual([]);
    verificarLimpio(e);
  });

  test('con precio guardado: viene con el suyo y otro precio de un día aparece destildado (no pisa el guardado)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nCarla, 300)] }) });
    await nuevoSitting(page);
    await pagoPorHora(page);
    await expect(page.locator('#sit-pago-hora')).toHaveValue('300');
    await page.fill('#sit-pago-hora', '300');
    await expect(casilla(page)).toBeHidden(); // el mismo precio: nada que guardar
    await page.fill('#sit-pago-hora', '320');
    await expect(casilla(page)).toBeVisible();
    await expect(casilla(page)).not.toBeChecked();
    await guardarSit(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ pago_ninera: 960 });
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toEqual([]);
    verificarLimpio(e);
  });

  test('si falla guardar el precio, el registro queda guardado y el aviso lo dice (sin éxito falso)', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevoSitting(page);
    await pagoPorHora(page);
    await page.fill('#sit-pago-hora', '280');
    e.fallar = ({ tabla }) => tabla === 'precios_ninera_familia' ? { status: 500, message: 'falla simulada' } : undefined;
    await guardarSit(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')).toHaveLength(1);
    await expect(page.locator('.toaststack .toast.bad', { hasText: 'no el precio de Carla Ejemplo' })).toBeVisible();
    await expect(page.locator('.toaststack .toast.good')).toHaveCount(0);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('con un fijo de esa niñera con esa familia, guardar el precio recalcula los días previstos', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ fijosAutomaticos: true }) });
    await nuevoSitting(page, { ninera: 'Ana Ficticia' });
    await pagoPorHora(page);
    await page.fill('#sit-pago-hora', '270');
    await expect(casilla(page)).toBeChecked();
    await guardarSit(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    await expect.poll(() => llamadasProceso(e).length).toBe(1);
    expect(escrituras(e, 'precios_ninera_familia', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nAna, pago_hora: 270 });
    verificarLimpio(e);
  });

  test('sin fijo con esa familia no recalcula nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ fijosAutomaticos: true }) });
    await nuevoSitting(page);
    await pagoPorHora(page);
    await page.fill('#sit-pago-hora', '270');
    await guardarSit(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    await expect.poll(() => escrituras(e, 'precios_ninera_familia', 'POST').length).toBe(1);
    await page.waitForTimeout(200);
    expect(llamadasProceso(e)).toEqual([]);
    verificarLimpio(e);
  });

  test('celular de 390 px: la casilla se ve entera, mide 24 px y no hay scroll de costado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page);
    await nuevoSitting(page);
    await pagoPorHora(page);
    await page.fill('#sit-pago-hora', '280');
    await expect(casilla(page)).toBeVisible();
    const caja = await casilla(page).boundingBox();
    expect(caja.width).toBeGreaterThanOrEqual(24);
    expect(caja.x + caja.width).toBeLessThanOrEqual(390);
    const texto = await page.locator('#sit-guardar-precio-wrap').boundingBox();
    expect(texto.x + texto.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('casilla-390.png') });
    verificarLimpio(e);
  });
});

/* ---------------- Agenda ---------------- */
async function nuevaSolicitud(page, { familia = 'Familia Prueba Dos', fecha = '2026-10-06', ini = '16:00', fin = '19:00' } = {}) {
  await irAModulo(page, 'agenda');
  await page.locator('button', { hasText: '+ Nueva solicitud' }).click();
  await page.fill('#agenda-familia', familia);
  await page.fill('#agenda-nueva-fecha', fecha);
  await hora(page, 'agenda-hora-inicio', ini);
  await hora(page, 'agenda-hora-fin', fin);
}
async function elegirNineraAgenda(page, texto, nombre) {
  // El buscador esconde su lista 150 ms después de perder el foco (attachAutocomplete): al elegir dos
  // niñeras seguidas, esa espera de la elección anterior escondía la lista nueva.
  await page.waitForTimeout(200);
  await page.fill('#agenda-ninera', texto);
  await page.locator('#agenda-ninera-dropdown .autocomplete-item', { hasText: nombre }).click();
  await expect(page.locator('#agenda-ninera')).toHaveValue(nombre);
}
const guardarSolicitud = page => page.locator('#editmodal button', { hasText: 'Guardar solicitud' }).click();

test.describe('Agenda: + Nueva solicitud con niñera', () => {
  test('el precio por hora a la niñera viene con el suyo; sin precio, la tarifa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fDos, ID.nAna, 300)] }) });
    await nuevaSolicitud(page);
    await expect(page.locator('#agenda-pago-hora')).toHaveValue('260');
    await elegirNineraAgenda(page, 'ana', 'Ana Ficticia');
    await expect(page.locator('#agenda-pago-hora')).toHaveValue('300');
    await expect(page.locator('#agenda-pago-preview')).toHaveText('Pago a la niñera: $900 (3 h)');
    await expect(page.locator('#agenda-guardar-precio')).toBeHidden();
    await elegirNineraAgenda(page, 'carla', 'Carla Ejemplo');
    await expect(page.locator('#agenda-pago-hora')).toHaveValue('260');
    await elegirNineraAgenda(page, 'ana', 'Ana Ficticia');
    await guardarSolicitud(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'solicitud_ninieras', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nAna, pago_ninera: 900 });
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nAna, cobro_familia: 1200, pago_ninera: 900 });
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toEqual([]);
    verificarLimpio(e);
  });

  test('lo tipeado a mano no se pisa al elegir la niñera; sin precio guardado, la casilla tildada lo guarda', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevaSolicitud(page);
    await page.fill('#agenda-pago-hora', '310');
    await elegirNineraAgenda(page, 'carla', 'Carla Ejemplo');
    await expect(page.locator('#agenda-pago-hora')).toHaveValue('310');
    await expect(page.locator('#agenda-guardar-precio')).toBeVisible();
    await expect(page.locator('#agenda-guardar-precio')).toBeChecked();
    await expect(page.locator('#agenda-guardar-precio-wrap')).toContainText('Guardar como precio de Carla Ejemplo con esta familia');
    await guardarSolicitud(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nCarla, pago_ninera: 930 });
    await expect.poll(() => escrituras(e, 'precios_ninera_familia', 'POST').length).toBe(1); // va después de asignar
    const [w] = escrituras(e, 'precios_ninera_familia', 'POST');
    expect(w.cuerpo).toEqual({ familia_id: ID.fDos, ninera_id: ID.nCarla, pago_hora: 310, creado_por: 'Prueba' });
    expect(w.params.on_conflict).toBe('familia_id,ninera_id');
    verificarLimpio(e);
  });

  test('con precio guardado, otro precio tipeado aparece destildado y no lo pisa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fDos, ID.nAna, 300)] }) });
    await nuevaSolicitud(page);
    await elegirNineraAgenda(page, 'ana', 'Ana Ficticia');
    await page.fill('#agenda-pago-hora', '330');
    await expect(page.locator('#agenda-guardar-precio')).toBeVisible();
    await expect(page.locator('#agenda-guardar-precio')).not.toBeChecked();
    await guardarSolicitud(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ pago_ninera: 990 });
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toEqual([]);
    verificarLimpio(e);
  });

  test('si falla guardar el precio, la solicitud queda asignada y el aviso lo dice', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevaSolicitud(page);
    await page.fill('#agenda-pago-hora', '310');
    await elegirNineraAgenda(page, 'carla', 'Carla Ejemplo');
    e.fallar = ({ tabla }) => tabla === 'precios_ninera_familia' ? { status: 500, message: 'falla simulada' } : undefined;
    await guardarSolicitud(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')).toHaveLength(1);
    await expect(page.locator('.toaststack .toast.bad', { hasText: 'no el precio de Carla Ejemplo' })).toBeVisible();
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });
});

test.describe('Agenda: asignar niñera, días de un fijo y reemplazos', () => {
  const SOL = '80000000-0000-4000-8000-000000000001'; // Familia Dos, martes 06/10, 20 a 23, sin asignar
  async function elegirEnAsignar(page, nineraId) {
    const mas = page.locator('#editmodal button', { hasText: '+ Niñeras' });
    if (await mas.isVisible()) await mas.click();
    await page.locator(`#editmodal input[name="agenda-asignar-ninera"][value="${nineraId}"]`).check();
  }

  test('Asignar niñera: el pago sugerido es el de cada niñera con esa familia', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fDos, ID.nAna, 300)] }) });
    await irAModulo(page, 'agenda');
    await page.evaluate(i => abrirModalAsignar(i), SOL);
    await elegirEnAsignar(page, ID.nAna);
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('900'); // 3 h a $300
    await elegirEnAsignar(page, ID.nCarla);
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('780'); // 3 h a $260, la tarifa
    await elegirEnAsignar(page, ID.nAna);
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nAna, pago_ninera: 900 });
    verificarLimpio(e);
  });

  const DIA = `asig:${ID.aFijo}@2026-10-05`;
  async function registrarDia(page) {
    await irAModulo(page, 'agenda');
    await page.evaluate(i => abrirModalSolicitud(i), DIA);
    await page.locator('#editmodal button', { hasText: 'Registrar sitting de este día' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
  }
  for (const [nombre, opciones, pago] of [
    ['el precio propio del fijo gana sobre el de la niñera', { precios: [precio(ID.fUno, ID.nAna, 300)], fijo: { pago_hora: 320 } }, 960],
    ['sin precio del fijo: el de la niñera con esa familia', { precios: [precio(ID.fUno, ID.nAna, 300)] }, 900],
    ['sin ninguno de los dos: la tarifa de la familia', {}, 750],
  ]) {
    test(`día de un fijo: ${nombre}`, async ({ page }) => {
      const e = await abrirApp(page, { datos: datosCon(opciones) });
      await registrarDia(page);
      expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ asignacion_id: ID.aFijo, ninera_id: ID.nAna, cobro_familia: 1140, pago_ninera: pago });
      verificarLimpio(e);
    });
  }

  test('reemplazo de un día: la reemplazante cobra su precio, nunca el del fijo', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nCarla, 290), precio(ID.fUno, ID.nAna, 300)], fijo: { pago_hora: 320 } }) });
    await irAModulo(page, 'agenda');
    await page.evaluate(i => { abrirModalSolicitud(i); mostrarExcepcionAsignacionFija(i); mostrarReemplazoFijoHoy(i); }, DIA);
    await page.fill('#agenda-fija-reemplazo-ninera', 'Carla');
    await page.locator('#agenda-fija-reemplazo-ninera-dropdown .autocomplete-item', { hasText: 'Carla Ejemplo' }).click();
    await page.locator('#editmodal button', { hasText: 'Registrar reemplazo' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nCarla, cobro_familia: 1140, pago_ninera: 870 });
    verificarLimpio(e);
  });

  test('reemplazo de una niñera sin precio con esa familia: la tarifa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ fijo: { pago_hora: 320 } }) });
    await irAModulo(page, 'agenda');
    await page.evaluate(i => { abrirModalSolicitud(i); mostrarExcepcionAsignacionFija(i); mostrarReemplazoFijoHoy(i); }, DIA);
    await page.fill('#agenda-fija-reemplazo-ninera', 'Carla');
    await page.locator('#agenda-fija-reemplazo-ninera-dropdown .autocomplete-item', { hasText: 'Carla Ejemplo' }).click();
    await page.locator('#editmodal button', { hasText: 'Registrar reemplazo' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nCarla, pago_ninera: 750 });
    verificarLimpio(e);
  });
});

// Cambios del fijo "desde hoy" (alinearRegistroDeHoy): acá "hoy" es el lunes 05/10/2026, con el día
// de hoy del fijo ya confirmado solo y sin tocar.
test.describe('Agenda: cambios del fijo y el sitting de hoy', () => {
  const AHORA = '2026-10-05T10:00:00-03:00';
  const HOY = 'a1000000-0000-4000-8000-000000000005';
  function datosHoy(opciones) {
    const d = datosCon({ ...opciones, fijosAutomaticos: true });
    d.sittings_traslados = d.sittings_traslados.map(s => ({ ...s, estado: s.estado || 'confirmado', generado_automatico: false, revisado_at: null }));
    d.sittings_traslados.push(sitting(HOY, '2026-10-05', { asignacion_id: ID.aFijo, estado: 'confirmado', generado_automatico: true, revisado_at: null, registrado_por: 'Automático', pago_ninera: (opciones.fijo?.pago_hora || 250) * 3 }));
    return d;
  }
  async function abrirFijo(page) {
    await irAModulo(page, 'agenda');
    await page.evaluate(async () => { agendaAncla = '2026-10-05'; await cargarAgendaSolicitudes(); });
    await esperarQuieta(page);
    await page.evaluate(id => abrirModalSolicitud(`asig:${id}@2026-10-07`), ID.aFijo);
    await expect(page.locator('#editmodal')).toBeVisible();
  }
  const hoyDe = e => e.db.sittings_traslados.find(s => s.id === HOY);

  test('cambiar la niñera desde una fecha: el fijo nuevo no se lleva el precio de la anterior', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy({ precios: [precio(ID.fUno, ID.nCarla, 290)], fijo: { pago_hora: 320 } }), ahora: AHORA });
    await abrirFijo(page);
    await page.locator(`#agenda-fija-ninera-${ID.aFijo}`).fill('Carla Ejemplo');
    await page.locator('#editmodal .autocomplete-item', { hasText: 'Carla Ejemplo' }).click();
    await page.locator(`#agenda-fija-guardar-${ID.aFijo}`).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const [nuevo] = escrituras(e, 'asignaciones', 'POST');
    expect(nuevo.cuerpo).toMatchObject({ ninera_nombre: 'Carla Ejemplo', vigente_desde: '2026-10-05', pago_hora: null });
    // El de hoy pasa a Carla con su precio con esta familia (3 h a $290), no con el del fijo de Ana.
    await expect.poll(() => hoyDe(e).ninera_nombre).toBe('Carla Ejemplo');
    expect(hoyDe(e)).toMatchObject({ ninera_id: ID.nCarla, cobro_familia: 1140, pago_ninera: 870 });
    verificarLimpio(e);
  });

  test('cambiar la niñera en el mismo fijo (sin pasado que cuidar) también le saca el precio de la anterior', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy({ fijo: { pago_hora: 320, vigente_desde: '2026-10-12' } }), ahora: AHORA });
    await irAModulo(page, 'agenda');
    await page.evaluate(async () => { agendaAncla = '2026-10-12'; await cargarAgendaSolicitudes(); });
    await esperarQuieta(page);
    await page.evaluate(id => abrirModalSolicitud(`asig:${id}@2026-10-12`), ID.aFijo);
    await page.locator(`#agenda-fija-ninera-${ID.aFijo}`).fill('Carla Ejemplo');
    await page.locator('#editmodal .autocomplete-item', { hasText: 'Carla Ejemplo' }).click();
    await page.locator(`#agenda-fija-guardar-${ID.aFijo}`).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const [cambio] = escrituras(e, 'asignaciones', 'PATCH');
    expect(cambio.cuerpo).toEqual({ ninera_nombre: 'Carla Ejemplo', ninera_id: ID.nCarla, pago_hora: null });
    verificarLimpio(e);
  });

  test('otro horario desde hoy: el de hoy se recalcula con el precio propio del fijo', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy({ precios: [precio(ID.fUno, ID.nAna, 300)], fijo: { pago_hora: 320 } }), ahora: AHORA });
    await abrirFijo(page);
    await page.locator('#agenda-fija-edit-toggle').click();
    await page.selectOption('#agenda-fija-edit-hi-hh', '15');
    await page.locator('#editmodal button', { hasText: 'Guardar horario/días desde esa fecha' }).click();
    // 15 a 19 = 4 h a $380 / $320; el fijo nuevo conserva su precio (misma niñera).
    await expect.poll(() => hoyDe(e).hora_inicio).toBe('15:00');
    expect(hoyDe(e)).toMatchObject({ cobro_familia: 1520, pago_ninera: 1280 });
    expect(escrituras(e, 'asignaciones', 'POST')[0].cuerpo).toMatchObject({ pago_hora: 320 });
    verificarLimpio(e);
  });

  test('otro horario desde hoy sin precio del fijo: el de la niñera con esa familia', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy({ precios: [precio(ID.fUno, ID.nAna, 300)] }), ahora: AHORA });
    await abrirFijo(page);
    await page.locator('#agenda-fija-edit-toggle').click();
    await page.selectOption('#agenda-fija-edit-hi-hh', '15');
    await page.locator('#editmodal button', { hasText: 'Guardar horario/días desde esa fecha' }).click();
    await expect.poll(() => hoyDe(e).hora_inicio).toBe('15:00');
    expect(hoyDe(e)).toMatchObject({ cobro_familia: 1520, pago_ninera: 1200 });
    verificarLimpio(e);
  });
});

/* ---------------- Hoy: Cierre de los fijos ---------------- */
test.describe('Cierre de los fijos: "Otra hora"', () => {
  const MIE30 = 'a1000000-0000-4000-8000-000000000030';
  function datosCierre(opciones, fila = {}) {
    const d = datosCon({ ...opciones, fijosAutomaticos: true });
    d.sittings_traslados = d.sittings_traslados.map(s => ({ ...s, estado: 'confirmado', generado_automatico: false, revisado_at: null }));
    d.sittings_traslados.push(sitting(MIE30, '2026-09-30', { asignacion_id: ID.aFijo, estado: 'confirmado', generado_automatico: true, revisado_at: null, registrado_por: 'Automático', ...fila }));
    return d;
  }
  async function otraHora(page, entrada) {
    await page.locator('.autoconf-card button', { hasText: 'Otra hora' }).click();
    await expect(page.locator('#editmodal')).toContainText('¿A qué hora fue?');
    await hora(page, 'autoconf-hi', entrada);
  }
  for (const [nombre, opciones, fila, pago] of [
    ['el precio propio del fijo', { precios: [precio(ID.fUno, ID.nAna, 300)], fijo: { pago_hora: 320 } }, {}, '$1.120'],
    ['sin precio del fijo, el de la niñera con esa familia', { precios: [precio(ID.fUno, ID.nAna, 300)] }, {}, '$1.050'],
    ['sin ninguno, la tarifa', {}, {}, '$875'],
    ['un día que fue otra niñera: su precio, no el del fijo', { precios: [precio(ID.fUno, ID.nCarla, 290)], fijo: { pago_hora: 320 } }, { ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo' }, '$1.015'],
  ]) {
    test(`recalcula con ${nombre}`, async ({ page }) => {
      const e = await abrirApp(page, { datos: datosCierre(opciones, fila) });
      await otraHora(page, '15:30'); // 15:30 a 19 = 3,5 h; cobro 3,5 × $380 = $1.330
      await expect(page.locator('#autoconf-precio')).toHaveText(`Queda: cobro $1.330 · pago ${pago}.`);
      await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
      await expect(page.locator('#editmodal')).toHaveCount(0);
      const [cambio] = escrituras(e, 'sittings_traslados', 'PATCH');
      expect(cambio.cuerpo).toMatchObject({ hora_inicio: '15:30', cobro_familia: 1330, pago_ninera: Number(pago.replace(/\D/g, '')) });
      verificarLimpio(e);
    });
  }
});

test('si no se pueden leer los precios: la tarifa y sin la casilla (no pisa un precio guardado)', async ({ page }) => {
  const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nCarla, 300)] }) });
  // La lectura de la tabla falla (la base responde con error); el resto anda.
  await page.route(/precios_ninera_familia/, r => r.request().method() === 'GET'
    ? r.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }) : r.fallback());
  await nuevoSitting(page);
  await expect(page.locator('#sit-pago')).toHaveValue('750');
  await pagoPorHora(page);
  await page.fill('#sit-pago-hora', '280');
  await expect(page.locator('#sit-pago')).toHaveValue('840');
  await expect(casilla(page)).toBeHidden();
  await guardarSit(page);
  await expect(page.locator('#editmodal')).toHaveCount(0);
  expect(escrituras(e, 'precios_ninera_familia', 'POST')).toEqual([]);
  verificarLimpio(e, { ignorar: [/status of 500/] });
});

/* ---------------- Base sin la tabla ---------------- */
test.describe('base sin la tabla precios_ninera_familia: todo como hoy', () => {
  test('Sittings calcula con la tarifa, sin casilla y sin errores', async ({ page }) => {
    const e = await abrirApp(page, { baseSinMigrar: true });
    await nuevoSitting(page);
    await expect(page.locator('#sit-pago')).toHaveValue('750');
    await pagoPorHora(page);
    await page.fill('#sit-pago-hora', '280');
    await expect(page.locator('#sit-pago')).toHaveValue('840');
    await expect(casilla(page)).toBeHidden();
    await page.fill('#sit-ninera', 'Ana Ficticia');
    await guardarSit(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nAna, pago_ninera: 840 });
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toEqual([]);
    await expect(page.locator('.toaststack .toast.bad')).toHaveCount(0);
    verificarLimpio(e, { ignorar: [/status of (400|404)/] }); // las tablas y columnas que esa base no tiene
  });

  test('Agenda: la solicitud con niñera y el día de un fijo van con la tarifa', async ({ page }) => {
    const e = await abrirApp(page, { baseSinMigrar: true });
    await nuevaSolicitud(page);
    await elegirNineraAgenda(page, 'ana', 'Ana Ficticia');
    await expect(page.locator('#agenda-pago-hora')).toHaveValue('260');
    await page.fill('#agenda-pago-hora', '300');
    await expect(page.locator('#agenda-guardar-precio')).toBeHidden();
    await guardarSolicitud(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ pago_ninera: 900 });
    await page.evaluate(async () => { agendaAncla = '2026-10-05'; await cargarAgendaSolicitudes(); }); // guardar la llevó al 06/10
    await esperarQuieta(page);
    await page.evaluate(i => abrirModalSolicitud(i), `asig:${ID.aFijo}@2026-10-05`);
    await page.locator('#editmodal button', { hasText: 'Registrar sitting de este día' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[1].cuerpo).toMatchObject({ asignacion_id: ID.aFijo, pago_ninera: 750 });
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toEqual([]);
    verificarLimpio(e, { ignorar: [/status of (400|404)/] });
  });
});

/* ---------------- Arreglos de la revisión (01/11/2026) ---------------- */
// La lectura de la tabla falla (la base responde con error) pero la tabla existe: ningún pago se crea ni
// se pisa con la tarifa en silencio.
async function fallarLecturaPrecios(page) {
  await page.route(/precios_ninera_familia/, r => r.request().method() === 'GET'
    ? r.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }) : r.fallback());
}

test.describe('Sittings: cambiar la familia con la casilla visible', () => {
  test('a un nombre sin familia: la casilla se va y el registro se guarda (sin el precio)', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevoSitting(page);
    await pagoPorHora(page);
    await page.fill('#sit-pago-hora', '280');
    await expect(casilla(page)).toBeChecked();
    await page.fill('#sit-familia', 'Familia Que No Existe');
    await expect(casilla(page)).toBeHidden();
    await guardarSit(page); // un nombre que no se parece a ninguno: no pregunta, guarda
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ familia_id: null, familia_nombre: 'Familia Que No Existe', pago_ninera: 840 });
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toEqual([]);
    verificarLimpio(e);
  });
});

test.describe('lectura de precios que falla (la tabla existe): no se paga con la tarifa en silencio', () => {
  test('Agenda, día de un fijo: avisa y no registra', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nAna, 300)] }) });
    await fallarLecturaPrecios(page);
    await irAModulo(page, 'agenda');
    await page.evaluate(i => abrirModalSolicitud(i), `asig:${ID.aFijo}@2026-10-05`);
    await page.locator('#editmodal button', { hasText: 'Registrar sitting de este día' }).click();
    await expect(page.locator('#agenda-fija-horario-warn')).toContainText('No se pudo leer el precio');
    expect(escrituras(e, 'sittings_traslados', 'POST')).toEqual([]);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('Agenda, reemplazo de un día: avisa y no registra', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nCarla, 290)] }) });
    await fallarLecturaPrecios(page);
    await irAModulo(page, 'agenda');
    const dia = `asig:${ID.aFijo}@2026-10-05`;
    await page.evaluate(i => { abrirModalSolicitud(i); mostrarExcepcionAsignacionFija(i); mostrarReemplazoFijoHoy(i); }, dia);
    await page.fill('#agenda-fija-reemplazo-ninera', 'Carla');
    await page.locator('#agenda-fija-reemplazo-ninera-dropdown .autocomplete-item', { hasText: 'Carla Ejemplo' }).click();
    await page.locator('#editmodal button', { hasText: 'Registrar reemplazo' }).click();
    await expect(page.locator('#agenda-fija-reemplazo-warn')).toContainText('No se pudo leer el precio');
    expect(escrituras(e, 'sittings_traslados', 'POST')).toEqual([]);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('Agenda, cambio del fijo desde hoy: el de hoy no se pisa con la tarifa y se avisa', async ({ page }) => {
    const HOY = 'a1000000-0000-4000-8000-000000000005';
    const d = datosCon({ precios: [precio(ID.fUno, ID.nAna, 300)], fijosAutomaticos: true });
    d.sittings_traslados = d.sittings_traslados.map(s => ({ ...s, estado: s.estado || 'confirmado', generado_automatico: false, revisado_at: null }));
    d.sittings_traslados.push(sitting(HOY, '2026-10-05', { asignacion_id: ID.aFijo, estado: 'confirmado', generado_automatico: true, revisado_at: null, pago_ninera: 900 }));
    const e = await abrirApp(page, { datos: d, ahora: '2026-10-05T10:00:00-03:00' });
    await fallarLecturaPrecios(page);
    await irAModulo(page, 'agenda');
    await page.evaluate(async () => { agendaAncla = '2026-10-05'; await cargarAgendaSolicitudes(); });
    await esperarQuieta(page);
    await page.evaluate(id => abrirModalSolicitud(`asig:${id}@2026-10-07`), ID.aFijo);
    await page.locator('#agenda-fija-edit-toggle').click();
    await page.selectOption('#agenda-fija-edit-hi-hh', '15');
    await page.locator('#editmodal button', { hasText: 'Guardar horario/días desde esa fecha' }).click();
    await expect(page.locator('.toaststack .toast.bad', { hasText: 'no se pudo corregir el sitting de hoy' })).toBeVisible();
    expect(e.db.sittings_traslados.find(s => s.id === HOY)).toMatchObject({ hora_inicio: '16:00:00', pago_ninera: 900 });
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('Cierre de los fijos, "Otra hora": avisa y no abre', async ({ page }) => {
    const MIE30 = 'a1000000-0000-4000-8000-000000000030';
    const d = datosCon({ precios: [precio(ID.fUno, ID.nAna, 300)], fijosAutomaticos: true });
    d.sittings_traslados = d.sittings_traslados.map(s => ({ ...s, estado: 'confirmado', generado_automatico: false, revisado_at: null }));
    d.sittings_traslados.push(sitting(MIE30, '2026-09-30', { asignacion_id: ID.aFijo, estado: 'confirmado', generado_automatico: true, revisado_at: null, pago_ninera: 900 }));
    const e = await abrirApp(page, { datos: d });
    await fallarLecturaPrecios(page);
    await page.locator('.autoconf-card button', { hasText: 'Otra hora' }).click();
    await expect(page.locator('.toaststack .toast.bad', { hasText: 'No se pudo leer el precio' })).toBeVisible();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'PATCH')).toEqual([]);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });
});

/* "Fue otra" en el Cierre de los fijos (decisión del 01/11/2026, respuesta 2 de Diego): la que fue cobra
   su precio con esa familia (o la tarifa), nunca el del fijo; lo que paga la familia no cambia. */
test.describe('Cierre de los fijos: "Fue otra"', () => {
  const MIE30 = 'a1000000-0000-4000-8000-000000000030';
  function datosFueOtra(opciones, fila = {}) {
    const d = datosCon({ ...opciones, fijosAutomaticos: true });
    d.sittings_traslados = d.sittings_traslados.map(s => ({ ...s, estado: 'confirmado', generado_automatico: false, revisado_at: null }));
    d.sittings_traslados.push(sitting(MIE30, '2026-09-30', { asignacion_id: ID.aFijo, estado: 'confirmado', generado_automatico: true, revisado_at: null, ...fila }));
    return d;
  }
  async function fueOtra(page, nombre) {
    await page.locator('.autoconf-card button', { hasText: 'Fue otra' }).click();
    await expect(page.locator('#editmodal')).toContainText('Se le paga su precio con esta familia');
    await expect(page.locator('#editmodal')).not.toContainText('Mismo horario y montos');
    await page.locator('#autoconf-ninera').fill(nombre);
    await page.locator('#editmodal .autocomplete-item', { hasText: nombre }).click();
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
  }
  for (const [nombre, opciones, pago] of [
    ['con precio con esa familia: el suyo, no el del fijo', { precios: [precio(ID.fUno, ID.nCarla, 290)], fijo: { pago_hora: 320 } }, 870],
    ['sin precio: la tarifa, no el del fijo', { fijo: { pago_hora: 320 } }, 750],
  ]) {
    test(nombre, async ({ page }) => {
      const e = await abrirApp(page, { datos: datosFueOtra(opciones, { pago_ninera: 960 }) });
      await fueOtra(page, 'Carla Ejemplo');
      await expect(page.locator('.toaststack .toast').last()).toContainText('ese día figura Carla Ejemplo');
      const [cambio] = escrituras(e, 'sittings_traslados', 'PATCH');
      expect(cambio.cuerpo).toMatchObject({ ninera_nombre: 'Carla Ejemplo', ninera_id: ID.nCarla, pago_ninera: pago });
      expect(cambio.cuerpo).not.toHaveProperty('cobro_familia'); // lo que paga la familia no cambia
      verificarLimpio(e);
    });
  }

  test('con variantes ya aplicadas: el pago nuevo es la base y se vuelven a aplicar', async ({ page }) => {
    const aplicadas = [{ id: 'v1', nombre: 'Tres chicos', pago: { modo: 'sumar', valor: 100 } }];
    const e = await abrirApp(page, { datos: datosFueOtra({ precios: [precio(ID.fUno, ID.nCarla, 290)] },
      { cobro_familia: 1140, pago_ninera: 850, precio_variantes: { base: { cobro: 1140, pago: 750 }, aplicadas } }) });
    await fueOtra(page, 'Carla Ejemplo');
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const [cambio] = escrituras(e, 'sittings_traslados', 'PATCH');
    expect(cambio.cuerpo).toMatchObject({ pago_ninera: 970, precio_variantes: { base: { cobro: 1140, pago: 870 }, aplicadas } });
    verificarLimpio(e);
  });

  test('si no se puede leer su precio: avisa y no cambia nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosFueOtra({ precios: [precio(ID.fUno, ID.nCarla, 290)] }) });
    await fallarLecturaPrecios(page);
    await fueOtra(page, 'Carla Ejemplo');
    await expect(page.locator('#autoconf-warn')).toContainText('No se pudo leer el precio');
    expect(escrituras(e, 'sittings_traslados', 'PATCH')).toEqual([]);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('base sin la tabla: la tarifa', async ({ page }) => {
    const d = datosFueOtra({ fijo: { pago_hora: 320 } }, { pago_ninera: 960 });
    const e = await abrirApp(page, { datos: d, baseSinMigrar: true });
    await fueOtra(page, 'Carla Ejemplo');
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'PATCH')[0].cuerpo).toMatchObject({ ninera_id: ID.nCarla, pago_ninera: 750 });
    verificarLimpio(e, { ignorar: [/status of (400|404)/] });
  });
});

test.describe('guardar el precio: aviso si no se pudo ver el fijo', () => {
  test('si falla la consulta de los fijos, el aviso dice que los días del fijo se actualizan a la noche', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ fijosAutomaticos: true }) });
    await nuevoSitting(page, { ninera: 'Ana Ficticia' });
    await pagoPorHora(page);
    await page.fill('#sit-pago-hora', '270');
    // La consulta de los fijos de ese par (después de guardar el precio) falla.
    await page.route(/rest\/v1\/asignaciones\?.*ninera_id=eq/, r => r.request().method() === 'GET'
      ? r.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }) : r.fallback());
    await guardarSit(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toHaveLength(1);
    await expect(page.locator('.toaststack .toast.bad', { hasText: 'se actualizan esta noche' })).toBeVisible();
    await expect(page.locator('.toaststack .toast.good')).toHaveCount(0);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });
});

test.describe('doble toque con la casilla tildada: un registro y un precio', () => {
  test('Sittings: "Guardar registro"', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevoSitting(page);
    await pagoPorHora(page);
    await page.fill('#sit-pago-hora', '280');
    await expect(casilla(page)).toBeChecked();
    e.demoraEscrituras = 400;
    await page.locator('#editmodal button', { hasText: 'Guardar registro' }).dblclick();
    await expect(page.locator('#editmodal')).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(() => escrituras(e, 'precios_ninera_familia', 'POST').length).toBe(1);
    await page.waitForTimeout(600);
    expect(escrituras(e, 'sittings_traslados', 'POST')).toHaveLength(1);
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('"+ Nueva solicitud": "Guardar solicitud"', async ({ page }) => {
    const e = await abrirApp(page);
    await nuevaSolicitud(page);
    await page.fill('#agenda-pago-hora', '310');
    await elegirNineraAgenda(page, 'carla', 'Carla Ejemplo');
    await expect(page.locator('#agenda-guardar-precio')).toBeChecked();
    e.demoraEscrituras = 400;
    await page.locator('#editmodal button', { hasText: 'Guardar solicitud' }).dblclick();
    await expect(page.locator('#editmodal')).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(() => escrituras(e, 'precios_ninera_familia', 'POST').length).toBe(1);
    await page.waitForTimeout(600);
    expect(escrituras(e, 'solicitudes', 'POST')).toHaveLength(1);
    expect(escrituras(e, 'sittings_traslados', 'POST')).toHaveLength(1);
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toHaveLength(1);
    verificarLimpio(e);
  });
});

test.describe('escape: niñera con nombre tramposo', () => {
  const TRAMPOSO = `Ana "La'Rara" <img src=x onerror="window.__xss=1">`;
  function datosTramposos() {
    const d = datosCon({ precios: [precio(ID.fDos, ID.nCarla, 300)] });
    const c = d.ninieras.find(n => n.id === ID.nCarla);
    c.nombre = TRAMPOSO;
    return d;
  }
  test('la etiqueta de la casilla muestra el nombre como texto y nada se ejecuta', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosTramposos() });
    await nuevoSitting(page, { ninera: TRAMPOSO });
    await pagoPorHora(page);
    await page.fill('#sit-pago-hora', '280');
    await expect(page.locator('#sit-guardar-precio-wrap')).toContainText(`Guardar como precio de ${TRAMPOSO} con esta familia`);
    await expect(page.locator('#sit-guardar-precio-wrap img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await guardarSit(page);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'precios_ninera_familia', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nCarla, pago_hora: 280 });
    verificarLimpio(e);
  });

  test('"Asignar niñera": el radio sigue andando con su precio y nada se ejecuta', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosTramposos() });
    await irAModulo(page, 'agenda');
    await page.evaluate(i => abrirModalAsignar(i), '80000000-0000-4000-8000-000000000001');
    const mas = page.locator('#editmodal button', { hasText: '+ Niñeras' });
    if (await mas.isVisible()) await mas.click();
    await page.locator(`#editmodal input[name="agenda-asignar-ninera"][value="${ID.nCarla}"]`).check();
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('900'); // 3 h a $300, su precio
    await expect(page.locator('#editmodal .agenda-ninera-pick img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nCarla, ninera_nombre: TRAMPOSO, pago_ninera: 900 });
    verificarLimpio(e);
  });
});
