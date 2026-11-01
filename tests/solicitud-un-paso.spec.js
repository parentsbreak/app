// Solicitud en un paso (25/10/2026, tanda de bugs antes de la fase 1, punto 6): en "+ Nueva solicitud"
// (Agenda) están en el mismo formulario la niñera (opcional, con buscador), "Precio por hora a la
// familia" y "Precio por hora a la niñera", precargados con la tarifa de la familia. Con niñera
// elegida se guarda ya confirmada, con su niñera y cargada en Sittings & traslados (antes había que
// asignar en un segundo paso). En las tarjetas de la Agenda el pago de la niñera de un sitting se ve
// por hora ("$250/h") en vez del total; los traslados siguen con su precio por viaje.
// Datos inventados: Familia Prueba Dos cobra $400 y paga $260 por hora (la Uno, $380 y $250, ya tiene el
// fijo de Ana los lunes y miércoles); Ana hace sittings y Bruno solo traslados; la tarifa de traslados
// es $200 + $20/km con 15 % de margen.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase, ID } = require('./support/datos');

const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && w.metodo === metodo);
const warn = page => page.locator('#agenda-nueva-warn');
const tarjetas = (page, texto) => page.locator('#agenda-grid-wrap [onclick^="abrirModalSolicitud"]', { hasText: texto });
async function hora(page, prefijo, hhmm) {
  const [hh, mm] = hhmm.split(':');
  await page.selectOption(`#${prefijo}-hh`, hh);
  await page.selectOption(`#${prefijo}-mm`, mm);
}
async function nuevaSolicitud(page, { familia = 'Familia Prueba Dos', fecha = '2026-10-06', ini = '16:00', fin = '19:00' } = {}) {
  await irAModulo(page, 'agenda');
  await page.locator('button', { hasText: '+ Nueva solicitud' }).click();
  await page.fill('#agenda-familia', familia);
  await page.fill('#agenda-nueva-fecha', fecha);
  if (ini) await hora(page, 'agenda-hora-inicio', ini);
  if (fin) await hora(page, 'agenda-hora-fin', fin);
}
async function elegirNinera(page, texto, nombre) {
  await page.fill('#agenda-ninera', texto);
  await page.locator('#agenda-ninera-dropdown .autocomplete-item', { hasText: nombre }).click();
  await expect(page.locator('#agenda-ninera')).toHaveValue(nombre);
}
const guardar = page => page.locator('#editmodal button', { hasText: 'Guardar solicitud' }).click();

test('el formulario trae la niñera opcional y los dos precios por hora, precargados con la tarifa de la familia', async ({ page }) => {
  const e = await abrirApp(page);
  await nuevaSolicitud(page);
  const modal = page.locator('#editmodal');
  await expect(modal).toContainText('Niñera (opcional)');
  await expect(modal).toContainText('Precio por hora a la familia');
  await expect(modal).toContainText('Precio por hora a la niñera');
  await expect(page.locator('#agenda-cobro')).toHaveValue('400');
  await expect(page.locator('#agenda-pago-hora')).toHaveValue('260');
  await expect(page.locator('#agenda-total-preview')).toHaveText('Total estimado: $1.200 (3 h)'); // como siempre
  await expect(page.locator('#agenda-pago-preview')).toHaveText('Pago a la niñera: $780 (3 h)');
  await page.fill('#agenda-pago-hora', '300');
  await expect(page.locator('#agenda-pago-preview')).toHaveText('Pago a la niñera: $900 (3 h)');
  verificarLimpio(e);
});

test('con niñera: queda confirmada, con su niñera y cargada en Sittings; la tarjeta muestra el pago por hora', async ({ page }) => {
  const e = await abrirApp(page);
  await nuevaSolicitud(page);
  await elegirNinera(page, 'ana', 'Ana Ficticia');
  await guardar(page);
  await expect(page.locator('.toaststack .toast', { hasText: 'ya quedó cargado en Sittings' })).toBeVisible();
  await expect(page.locator('#editmodal')).toHaveCount(0);
  expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ familia_id: ID.fDos, familia_nombre: 'Familia Prueba Dos', tipo: 'sitting', fecha: '2026-10-06', hora_inicio: '16:00', hora_fin: '19:00', cobro_familia: 1200, estado: 'confirmada' });
  const sol = e.db.solicitudes.find(s => s.estado === 'confirmada' && s.fecha === '2026-10-06');
  expect(escrituras(e, 'solicitud_ninieras', 'POST')[0].cuerpo).toEqual({ solicitud_id: sol.id, ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', estado: 'confirmada', pago_ninera: 780 });
  expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ tipo: 'sitting', familia_id: ID.fDos, ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', fecha: '2026-10-06', hora_inicio: '16:00', hora_fin: '19:00', termina_dia_siguiente: false, cobro_familia: 1200, pago_ninera: 780, cobrado: false, pagado: false, notas: 'Asignado desde Agenda' });
  // En la Agenda queda la tarjeta del registro: el cobro total y el pago de la niñera por hora.
  const tarjeta = tarjetas(page, 'Familia Prueba Dos').filter({ hasText: '16:00' });
  await expect(tarjeta).toHaveCount(1);
  await expect(tarjeta).toContainText('$1.200');
  await expect(tarjeta).toContainText('$260/h');
  await expect(tarjeta).not.toContainText('$780');
  verificarLimpio(e);
});

test('sin niñera: queda sin asignar, como hasta ahora, para asignarla después', async ({ page }) => {
  const e = await abrirApp(page);
  await nuevaSolicitud(page);
  await guardar(page);
  await expect(page.locator('.toaststack .toast', { hasText: 'Solicitud guardada.' })).toBeVisible();
  expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ estado: 'sin_asignar', cobro_familia: 1200 });
  expect(escrituras(e, 'solicitud_ninieras', 'POST')).toEqual([]);
  expect(escrituras(e, 'sittings_traslados', 'POST')).toEqual([]);
  await expect(tarjetas(page, 'Familia Prueba Dos').filter({ hasText: '16:00' })).toContainText('Sin asignar');
  verificarLimpio(e);
});

test('una niñera que no está en la lista: avisa y no guarda nada', async ({ page }) => {
  const e = await abrirApp(page);
  await nuevaSolicitud(page);
  await page.fill('#agenda-ninera', 'Alguien Inventada');
  await guardar(page);
  await expect(warn(page)).toContainText('Elegí una niñera de la lista');
  expect(escrituras(e, 'solicitudes', 'POST')).toEqual([]);
  verificarLimpio(e);
});

test('los precios por hora cambiados a mano mandan sobre la tarifa', async ({ page }) => {
  const e = await abrirApp(page);
  await nuevaSolicitud(page);
  await page.fill('#agenda-cobro', '450');
  await page.fill('#agenda-pago-hora', '300');
  await elegirNinera(page, 'ana', 'Ana Ficticia');
  await guardar(page);
  await expect(page.locator('#editmodal')).toHaveCount(0);
  expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ cobro_familia: 1350 });
  expect(escrituras(e, 'solicitud_ninieras', 'POST')[0].cuerpo).toMatchObject({ pago_ninera: 900 });
  expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ cobro_familia: 1350, pago_ninera: 900 });
  await expect(tarjetas(page, 'Familia Prueba Dos').filter({ hasText: '16:00' })).toContainText('$300/h');
  verificarLimpio(e);
});

test('sin hora de fin con niñera: se carga en $0 y avisa que falta la hora de fin', async ({ page }) => {
  const e = await abrirApp(page);
  await nuevaSolicitud(page, { fin: null });
  await expect(page.locator('#agenda-pago-preview')).toHaveText('');
  await elegirNinera(page, 'ana', 'Ana Ficticia');
  await guardar(page);
  await expect(page.locator('.toaststack .toast', { hasText: 'Falta la hora de fin' })).toBeVisible();
  expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ estado: 'confirmada', cobro_familia: null, hora_fin: null });
  expect(escrituras(e, 'solicitud_ninieras', 'POST')[0].cuerpo).toMatchObject({ pago_ninera: 0 });
  expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ cobro_familia: 0, pago_ninera: 0, hora_fin: null });
  verificarLimpio(e);
});

test('traslado con niñera: precio por viaje y pago por viaje sugeridos por los km, sin "/h"', async ({ page }) => {
  const e = await abrirApp(page);
  await nuevaSolicitud(page, { ini: '08:00', fin: null });
  await page.selectOption('#agenda-tipo', 'traslado');
  await page.fill('#agenda-km', '12');
  await expect(page.locator('#agenda-cobro-traslado')).toHaveValue('450'); // (200 + 12 × 20) redondeado a 50 para arriba
  await expect(page.locator('#agenda-pago-traslado')).toHaveValue('350'); // 440 × 0,85 = 374, a 50 para abajo
  await expect(page.locator('#agenda-campo-pago-hora')).toBeHidden(); // los precios por hora son de los sittings
  await expect(page.locator('#agenda-campo-sitting')).toBeHidden();
  await elegirNinera(page, 'bru', 'Bruno Inventado');
  await guardar(page);
  await expect(page.locator('.toaststack .toast', { hasText: 'ya quedó cargado en Sittings' })).toBeVisible();
  expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ tipo: 'traslado', estado: 'confirmada', cobro_familia: 450 });
  expect(escrituras(e, 'solicitud_ninieras', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nBruno, pago_ninera: 350 });
  expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ tipo: 'traslado', cobro_familia: 450, pago_ninera: 350, hora_inicio: '08:00', hora_fin: null });
  const tarjeta = tarjetas(page, 'Familia Prueba Dos').filter({ hasText: '08:00' });
  await expect(tarjeta).toContainText('$350');
  await expect(tarjeta).not.toContainText('/h');
  verificarLimpio(e);
});

test('la lista de niñeras respeta el tipo: para un sitting no ofrece a quien solo hace traslados, y al revés', async ({ page }) => {
  const e = await abrirApp(page);
  await nuevaSolicitud(page);
  await page.fill('#agenda-ninera', 'bru');
  await expect(page.locator('#agenda-ninera-dropdown')).toContainText('Ninguna niñera coincide');
  await page.selectOption('#agenda-tipo', 'traslado');
  await page.fill('#agenda-ninera', 'bru');
  await expect(page.locator('#agenda-ninera-dropdown .autocomplete-item')).toHaveText(['Bruno Inventado']);
  await page.fill('#agenda-ninera', 'ana');
  await expect(page.locator('#agenda-ninera-dropdown')).toContainText('Ninguna niñera coincide');
  verificarLimpio(e);
});

test('si falla cargar la niñera, el pedido vuelve a "sin asignar" y avisa; no se carga el registro', async ({ page }) => {
  const e = await abrirApp(page);
  e.fallar = ({ tabla, metodo }) => (tabla === 'solicitud_ninieras' && metodo === 'POST') ? { status: 500, message: 'falla simulada' } : undefined;
  await nuevaSolicitud(page);
  await elegirNinera(page, 'ana', 'Ana Ficticia');
  await guardar(page);
  await expect(warn(page)).toContainText('falla simulada');
  await expect(warn(page)).toContainText('quedó guardado sin niñera');
  expect(escrituras(e, 'solicitudes', 'PATCH')[0].cuerpo).toEqual({ estado: 'sin_asignar' });
  expect(e.db.solicitudes.at(-1).estado).toBe('sin_asignar');
  expect(escrituras(e, 'sittings_traslados', 'POST')).toEqual([]);
  verificarLimpio(e, { ignorar: [/status of 500/] });
});

test('si falla cargar el registro en Sittings, queda asignado y avisa', async ({ page }) => {
  const e = await abrirApp(page);
  e.fallar = ({ tabla, metodo }) => (tabla === 'sittings_traslados' && metodo === 'POST') ? { status: 500, message: 'falla simulada' } : undefined;
  await nuevaSolicitud(page);
  await elegirNinera(page, 'ana', 'Ana Ficticia');
  await guardar(page);
  await expect(page.locator('.toaststack .toast.bad', { hasText: 'Quedó asignado, pero no se pudo cargar en Sittings' })).toBeVisible();
  expect(e.db.solicitudes.at(-1).estado).toBe('confirmada');
  expect(escrituras(e, 'solicitud_ninieras', 'POST')).toHaveLength(1);
  verificarLimpio(e, { ignorar: [/status of 500/] });
});

test('la niñera ya tiene un fijo a esa hora: pregunta antes, y al cancelar no guarda nada', async ({ page }) => {
  const e = await abrirApp(page);
  await nuevaSolicitud(page, { fecha: '2026-10-05' }); // lunes: Ana hace 16 a 19 en Familia Uno
  await elegirNinera(page, 'ana', 'Ana Ficticia');
  await guardar(page);
  const aviso = page.locator('.confirmoverlay:not(#editmodal)');
  await expect(aviso).toContainText('Ana Ficticia');
  await aviso.locator('button', { hasText: 'Cancelar' }).click();
  expect(escrituras(e, 'solicitudes', 'POST')).toEqual([]);
  await expect(page.locator('#editmodal')).toBeVisible(); // el formulario sigue ahí para cambiar la niñera
  verificarLimpio(e);
});

test('doble toque en Guardar: una sola solicitud', async ({ page }) => {
  const e = await abrirApp(page);
  e.demoraEscrituras = 400;
  await nuevaSolicitud(page);
  await elegirNinera(page, 'ana', 'Ana Ficticia');
  const btn = page.locator('#editmodal button', { hasText: 'Guardar solicitud' });
  await btn.click();
  await btn.click({ force: true, timeout: 500 }).catch(() => {});
  await expect(page.locator('.toaststack .toast', { hasText: 'ya quedó cargado en Sittings' })).toBeVisible();
  expect(escrituras(e, 'solicitudes', 'POST')).toHaveLength(1);
  expect(escrituras(e, 'sittings_traslados', 'POST')).toHaveLength(1);
  verificarLimpio(e);
});

test('a 390 px: el formulario entra en la pantalla (captura)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const e = await abrirApp(page);
  await nuevaSolicitud(page);
  await page.fill('#agenda-ninera', 'ana');
  const lista = page.locator('#agenda-ninera-dropdown');
  await expect(lista).toBeVisible();
  expect((await lista.boundingBox()).x + (await lista.boundingBox()).width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => { const b = document.querySelector('#editmodal .confirmbox'); return b.scrollWidth <= b.clientWidth; })).toBe(true);
  await page.locator('#editmodal').screenshot({ path: 'test-results/solicitud-un-paso-390.png' });
  verificarLimpio(e);
});

// Horario aproximado (etapa 6, 03/11/2026): la casilla de "+ Nueva solicitud" y su marca en la Agenda.
test('horario aproximado: la casilla se guarda tildada, la tarjeta y el modal dicen "aproximado"', async ({ page }) => {
  const e = await abrirApp(page);
  await nuevaSolicitud(page);
  await expect(page.locator('label.chk', { hasText: 'Horario aproximado (se puede extender)' })).toBeVisible();
  await expect(page.locator('#agenda-aproximado')).not.toBeChecked();
  await page.locator('#agenda-aproximado').check();
  await guardar(page);
  await expect(page.locator('#editmodal')).toHaveCount(0);
  expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ horario_aproximado: true, estado: 'sin_asignar' });
  const tarjeta = tarjetas(page, 'Familia Prueba Dos').first();
  await expect(tarjeta).toContainText('aproximado');
  await tarjeta.click();
  await expect(page.locator('#editmodal')).toContainText('(aproximado)');
  verificarLimpio(e);
});

test('horario aproximado: sin tildar se guarda en false y la tarjeta no dice nada', async ({ page }) => {
  const e = await abrirApp(page);
  await nuevaSolicitud(page);
  await guardar(page);
  await expect(page.locator('#editmodal')).toHaveCount(0);
  expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo.horario_aproximado).toBe(false);
  await expect(tarjetas(page, 'Familia Prueba Dos').first()).not.toContainText('aproximado');
  verificarLimpio(e);
});

test('horario aproximado con niñera: la solicitud lo lleva y el registro se carga igual', async ({ page }) => {
  const e = await abrirApp(page);
  await nuevaSolicitud(page);
  await elegirNinera(page, 'ana', 'Ana Ficticia');
  await page.locator('#agenda-aproximado').check();
  await guardar(page);
  await expect(page.locator('.toaststack .toast', { hasText: 'ya quedó cargado en Sittings' })).toBeVisible();
  expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ horario_aproximado: true, estado: 'confirmada' });
  expect(escrituras(e, 'sittings_traslados', 'POST')).toHaveLength(1);
  verificarLimpio(e);
});

test('horario aproximado: base sin la migración de la etapa 6 guarda lo demás y avisa', async ({ page }) => {
  const e = await abrirApp(page, { baseSinMigrar: 'etapa6' });
  await nuevaSolicitud(page);
  await page.locator('#agenda-aproximado').check();
  await guardar(page);
  await expect(page.locator('#editmodal')).toHaveCount(0);
  const posts = escrituras(e, 'solicitudes', 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0].cuerpo).not.toHaveProperty('horario_aproximado');
  expect(posts[0].cuerpo).toMatchObject({ fecha: '2026-10-06', hora_inicio: '16:00', hora_fin: '19:00', cobro_familia: 1200, estado: 'sin_asignar' });
  await expect(page.locator('.toaststack .toast.bad', { hasText: 'la marca de horario aproximado' })).toBeVisible();
  expect(e.db.solicitudes.some(s => s.familia_nombre === 'Familia Prueba Dos' && s.fecha === '2026-10-06')).toBe(true);
  verificarLimpio(e, { ignorar: [/status of 4\d\d/] });
});
