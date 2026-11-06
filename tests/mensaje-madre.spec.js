// La confirmación para la madre con el monto y las horas (Paulina, 05/11/2026: "un mensaje para copiar en WhatsApp
// para la madre, con monto y horas"; 06/11/2026: sin la hora de fin, "a las 20:00, por 3 h"): las horas que se le cobran (horasSitting, con el redondeo de los
// términos) y el total del registro del pedido; sin hora de fin, sin horas ni total; un traslado, el precio del viaje.
// Se vuelve a abrir con "Mensaje para la madre" desde el registro del pedido en la Agenda (o desde la solicitud
// confirmada sin registro). Nada sale solo: "Copiar" y "Abrir WhatsApp". También: plantilla guardada vieja, plantilla
// que usa un dato que el pedido no tiene, "Guardar como plantilla" con los corchetes nuevos, lecturas que fallan, escape,
// 390 px y las horas del historial de Sittings ("3 h 20", no "3.3 hs").
// Datos inventados: el pedido de Familia Prueba Uno del martes 06/10 de 20 a 23 lo tiene Carla, con su registro.
// "Hoy" es el domingo 04/10/2026 al mediodía.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

const SOL = '80000000-0000-4000-8000-0000000000f1';
const REG = '70000000-0000-4000-8000-0000000000f1';
const RUIDO_500 = /status of 500/;
const mensaje = page => page.locator('#editmodal .mensaje-madre');
const texto = page => page.locator('#mensaje-madre-texto');
const linkWA = page => page.locator('#mensaje-madre-wa');
const wa = t => 'https://wa.me/59899000001?text=' + encodeURIComponent(t);
const COMPLETO = '¡Hola Familia! Confirmamos a la niñera Carla Ejemplo el martes 06/10 a las 20:00, por 3 h. El total es $1.140.';

// pedido: lo que cambia de la solicitud; registro: lo que cambia del registro (null: sin registro).
function datos({ pedido = {}, registro = {}, familia = {} } = {}) {
  const d = datosBase();
  Object.assign(d.familias.find(f => f.id === ID.fUno), familia);
  d.solicitudes.push({ id: SOL, familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', tipo: 'sitting', zona: 'Pocitos', fecha: '2026-10-06',
    hora_inicio: '20:00:00', hora_fin: '23:00:00', cobro_familia: 1140, estado: 'confirmada', notas: null, created_at: '2026-10-01T00:00:00Z',
    termina_dia_siguiente: false, ...pedido });
  d.solicitud_ninieras = [...(d.solicitud_ninieras || []), { id: '81000000-0000-4000-8000-0000000000f1', solicitud_id: SOL, ninera_id: ID.nCarla,
    ninera_nombre: 'Carla Ejemplo', estado: 'confirmada', pago_ninera: 750, origen: 'app', precio_hora: 250, seleccionada_en: '2026-10-02T16:00:00Z' }];
  if (registro) {
    d.sittings_traslados.push(sitting(REG, pedido.fecha || '2026-10-06', { ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', hora_inicio: '20:00:00',
      hora_fin: '23:00:00', cobro_familia: 1140, pago_ninera: 750, solicitud_id: SOL, estado: 'confirmado', notas: 'Asignado desde Agenda',
      tipo: pedido.tipo || 'sitting', ...registro }));
  }
  return d;
}
async function abrirRegistro(page) {
  await irAModulo(page, 'agenda');
  await page.evaluate(id => abrirModalSolicitud(id), `reg:${REG}`);
  await expect(page.locator('#editmodal h2')).toHaveText('Familia Prueba Uno');
}
async function reabrir(page) {
  await page.evaluate(id => abrirConfirmacionMadre(id, 'Carla Ejemplo', { reabrir: true }), SOL);
  await expect(mensaje(page)).toBeVisible();
}
async function espiarPortapapeles(page) {
  await page.evaluate(() => {
    window.__copiado = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copiado.push(t); } } });
  });
}

test.describe('"Mensaje para la madre" desde el registro del pedido en la Agenda', () => {
  test('vuelve a abrir la confirmación con la hora de inicio, las horas y el total (sin la hora de fin); "Copiar" y "Abrir WhatsApp", sin escribir nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirRegistro(page);
    await page.locator('#editmodal button', { hasText: 'Mensaje para la madre' }).click();
    await expect(mensaje(page).locator('h2')).toHaveText('Confirmación para la madre');
    await expect(mensaje(page).locator('.okbox')).toHaveCount(0); // no es una asignación nueva
    await expect(texto(page)).toHaveValue(COMPLETO);
    await expect(page.locator('#mensaje-madre-falta')).toBeEmpty();
    await expect(linkWA(page)).toHaveAttribute('href', wa(COMPLETO));
    await espiarPortapapeles(page);
    await mensaje(page).locator('button', { hasText: 'Copiar' }).click();
    expect(await page.evaluate(() => window.__copiado)).toEqual([COMPLETO]);
    expect(e.escrituras).toEqual([]); // nada sale solo ni se guarda
    expect(await mensaje(page).textContent()).not.toContain('·');
    verificarLimpio(e);
  });

  test('el registro manda sobre la solicitud: con la hora de fin y el cobro editados, va lo del registro', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ registro: { hora_fin: '23:20:00', cobro_familia: 1267, ninera_nombre: 'Ana Ficticia', ninera_id: ID.nAna } }) });
    await abrirRegistro(page);
    await page.locator('#editmodal button', { hasText: 'Mensaje para la madre' }).click();
    await expect(texto(page)).toHaveValue('¡Hola Familia! Confirmamos a la niñera Ana Ficticia el martes 06/10 a las 20:00, por 3 h 20. El total es $1.267.');
    verificarLimpio(e);
  });

  test('un registro cancelado no tiene el botón', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ registro: { cancelado: true, cobro_familia: 0, pago_ninera: 0 } }) });
    await abrirRegistro(page);
    await expect(page.locator('#editmodal button', { hasText: 'Mensaje para la madre' })).toHaveCount(0);
    verificarLimpio(e);
  });

  test('un registro que no salió de un pedido no tiene el botón', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ registro: { solicitud_id: null } }) });
    await abrirRegistro(page);
    await expect(page.locator('#editmodal button', { hasText: 'Cambiar de niñera' })).toHaveCount(0);
    await expect(page.locator('#editmodal button', { hasText: 'Mensaje para la madre' })).toHaveCount(0);
    verificarLimpio(e);
  });

  test('pedido confirmado sin registro (falló al asignar): el botón está en la solicitud y usa sus datos', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ registro: null }) });
    await irAModulo(page, 'agenda');
    await page.evaluate(id => abrirModalSolicitud(id), SOL);
    await page.locator('#editmodal button', { hasText: 'Mensaje para la madre' }).click();
    await expect(texto(page)).toHaveValue(COMPLETO);
    verificarLimpio(e);
  });
});

test.describe('lo que dice según el pedido', () => {
  test('términos aceptados, en diciembre: las horas que se cobran (3 h 20 se cobran 3 h 30) y el total del registro', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ familia: { terminos_aceptados_el: '2026-10-01' }, pedido: { fecha: '2026-12-07', hora_fin: '23:20:00', cobro_familia: 1330 },
      registro: { hora_fin: '23:20:00', cobro_familia: 1330 } }) });
    await reabrir(page);
    await expect(texto(page)).toHaveValue('¡Hola Familia! Confirmamos a la niñera Carla Ejemplo el lunes 07/12 a las 20:00, por 3 h 30. El total es $1.330.');
    verificarLimpio(e);
  });

  test('sin hora de fin: sin horas ni total, y ningún corchete vacío', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ pedido: { hora_fin: null, cobro_familia: null }, registro: { hora_fin: null, cobro_familia: 0 } }) });
    await reabrir(page);
    const t = '¡Hola Familia! Confirmamos a la niñera Carla Ejemplo el martes 06/10 a las 20:00.';
    await expect(texto(page)).toHaveValue(t);
    await expect(page.locator('#mensaje-madre-falta')).toBeEmpty();
    await expect(mensaje(page).locator('#mensaje-madre-copiar')).not.toHaveClass(/apagado/);
    await expect(linkWA(page)).toHaveAttribute('href', wa(t));
    verificarLimpio(e);
  });

  test('con hora de fin y sin precio: las horas sin el total', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ pedido: { cobro_familia: null }, registro: { cobro_familia: 0 } }) });
    await reabrir(page);
    await expect(texto(page)).toHaveValue('¡Hola Familia! Confirmamos a la niñera Carla Ejemplo el martes 06/10 a las 20:00, por 3 h.');
    verificarLimpio(e);
  });

  test('un traslado: el precio del viaje, sin horas', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ pedido: { tipo: 'traslado', hora_fin: null, cobro_familia: 900 },
      registro: { tipo: 'traslado', hora_fin: null, cobro_familia: 900, pago_ninera: 500, origen: 'Calle Falsa 123', destino: 'Colegio Inventado' } }) });
    await reabrir(page);
    await expect(texto(page)).toHaveValue('¡Hola Familia! Confirmamos a la niñera Carla Ejemplo para el traslado del martes 06/10 a las 20:00. El viaje es $900.');
    verificarLimpio(e);
  });

  test('si no se puede leer el registro, va lo de la solicitud', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ registro: { hora_fin: '23:20:00', cobro_familia: 1267 } }) });
    await page.route(/sittings_traslados.*solicitud_id=eq/, r => r.request().method() === 'GET'
      ? r.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }) : r.fallback());
    await reabrir(page);
    await expect(texto(page)).toHaveValue(COMPLETO);
    verificarLimpio(e, { ignorar: [RUIDO_500] });
  });

  test('si no se pueden leer los términos de la familia: sin horas (nunca unas que no son las del total)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await page.route(/familias.*terminos_aceptados_el/, r => r.request().method() === 'GET' && r.request().url().includes(`id=eq.${ID.fUno}`)
      ? r.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }) : r.fallback());
    await reabrir(page);
    await expect(texto(page)).toHaveValue('¡Hola Familia! Confirmamos a la niñera Carla Ejemplo el martes 06/10 a las 20:00.');
    verificarLimpio(e, { ignorar: [RUIDO_500] });
  });
});

test.describe('plantillas guardadas', () => {
  function conPlantilla(d, t) {
    d.app_config.push({ id: 'plantilla_confirmacion', valor: { texto: t }, actualizado_at: '2026-10-01T12:00:00Z' });
    return d;
  }

  test('una plantilla vieja (sin los corchetes nuevos) se usa tal cual', async ({ page }) => {
    const e = await abrirApp(page, { datos: conPlantilla(datos(), 'Hola [madre], va [niñera] el [día] a las [hora inicio]. ¡Gracias!') });
    await reabrir(page);
    await expect(texto(page)).toHaveValue('Hola Familia, va Carla Ejemplo el martes 06/10 a las 20:00. ¡Gracias!');
    await expect(mensaje(page).locator('.mensaje-madre-nota')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('una plantilla guardada con [hora fin] la sigue completando (ya no está en el texto por defecto)', async ({ page }) => {
    const e = await abrirApp(page, { datos: conPlantilla(datos(), '[madre]: [niñera], [día], [hora inicio] a [hora fin], [horas], $[monto].') });
    await reabrir(page);
    await expect(texto(page)).toHaveValue('Familia: Carla Ejemplo, martes 06/10, 20:00 a 23:00, 3 h, $1.140.');
    verificarLimpio(e);
  });

  test('una plantilla que usa el monto, con un pedido sin hora de fin: va la de siempre y lo dice', async ({ page }) => {
    const d = conPlantilla(datos({ pedido: { hora_fin: null, cobro_familia: null }, registro: { hora_fin: null, cobro_familia: 0 } }),
      'Hola [madre], [niñera] de [hora inicio] a [hora fin]. Son $[monto].');
    const e = await abrirApp(page, { datos: d });
    await reabrir(page);
    await expect(texto(page)).toHaveValue('¡Hola Familia! Confirmamos a la niñera Carla Ejemplo el martes 06/10 a las 20:00.');
    await expect(mensaje(page).locator('.mensaje-madre-nota')).toHaveText('La plantilla guardada usa la hora de fin y el monto, que este pedido no tiene: va el mensaje de siempre.');
    await expect(page.locator('#mensaje-madre-falta')).toBeEmpty();
    verificarLimpio(e);
  });

  test('"Guardar como plantilla" vuelve la hora de inicio, las horas y el monto a sus corchetes', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await reabrir(page);
    await texto(page).fill(COMPLETO + '\nCualquier cosa, avisame.');
    await mensaje(page).locator('button', { hasText: 'Guardar como plantilla' }).click();
    const MODELO = '¡Hola [madre]! Confirmamos a la niñera [niñera] el [día] a las [hora inicio], por [horas]. El total es $[monto].\nCualquier cosa, avisame.';
    await expect(page.locator('#mensaje-madre-modelo .mensaje-madre-modelo-texto')).toHaveText(MODELO);
    await page.locator('#mensaje-madre-modelo button', { hasText: 'Guardar plantilla' }).click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('Plantilla guardada');
    expect(e.db.app_config.find(c => c.id === 'plantilla_confirmacion').valor).toEqual({ texto: MODELO });
    verificarLimpio(e);
  });
});

test('datos tramposos: el nombre de la niñera en el botón y en el mensaje se ven como texto y nada se ejecuta', async ({ page }) => {
  const TRAMPOSA = `Carla "La'Rara" <img src=x onerror="window.__xss=1">`;
  const d = datos({ registro: { ninera_nombre: TRAMPOSA } });
  d.familias.find(f => f.id === ID.fUno).nombre = `D'Ale"<img src=x onerror="window.__xss=2"> Uno`;
  d.solicitudes.find(s => s.id === SOL).familia_nombre = d.familias.find(f => f.id === ID.fUno).nombre;
  d.sittings_traslados.find(s => s.id === REG).familia_nombre = d.familias.find(f => f.id === ID.fUno).nombre;
  const e = await abrirApp(page, { datos: d });
  await irAModulo(page, 'agenda');
  await page.evaluate(id => abrirModalSolicitud(id), `reg:${REG}`);
  await page.locator('#editmodal button', { hasText: 'Mensaje para la madre' }).click();
  await expect(texto(page)).toHaveValue(`¡Hola D'Ale"<img! Confirmamos a la niñera ${TRAMPOSA} el martes 06/10 a las 20:00, por 3 h. El total es $1.140.`);
  await expect(page.locator('#editmodal img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  verificarLimpio(e);
});

test('a 390 px: el registro con el botón y el mensaje entran sin scroll de costado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const e = await abrirApp(page, { datos: datos() });
  await abrirRegistro(page);
  const sinScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const boton = page.locator('#editmodal button', { hasText: 'Mensaje para la madre' });
  await expect(boton).toBeInViewport();
  expect(await sinScroll()).toBe(true);
  await page.screenshot({ path: test.info().outputPath('registro-390.png') });
  await boton.click();
  await expect(texto(page)).toHaveValue(COMPLETO);
  expect(await sinScroll()).toBe(true);
  await expect(mensaje(page).locator('button', { hasText: 'Copiar' })).toBeVisible();
  await expect(linkWA(page)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('mensaje-390.png') });
  verificarLimpio(e);
});

test('el historial de Sittings muestra las horas como "3 h 20", no con un decimal', async ({ page }) => {
  const d = datos();
  d.sittings_traslados.push(sitting('70000000-0000-4000-8000-0000000000f2', '2026-10-01', { hora_inicio: '16:00:00', hora_fin: '19:20:00' }));
  const e = await abrirApp(page, { datos: d });
  await irAModulo(page, 'sittings');
  const fila = page.locator('#sithist-lista tbody tr', { hasText: '16:00–19:20' });
  await expect(fila).toContainText('3 h 20');
  await expect(page.locator('#sithist-lista')).not.toContainText(' hs');
  verificarLimpio(e);
});
