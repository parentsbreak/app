// Cancelar un traslado desde el celular y "Reactivar" un registro cancelado desde la Agenda
// (25/10/2026, tanda de bugs antes de la fase 1).
//
// 1) En el celular, la fila de "Registros del mes" (Sittings) no se podía tocar y el botón
//    "Editar" quedaba fuera de pantalla (había que deslizar la tabla al costado); además la
//    casilla "Este día no hubo servicio…" se cortaba y medía 13 px. Ahora la fila se toca
//    como las del historial y la casilla se ve entera y grande.
// 2) El modal de la Agenda de un registro cancelado solo ofrecía "Eliminar". "Reactivar" lo
//    deja como estaba antes de cancelarlo (montos incluidos), leyendo el historial de cambios;
//    sin historial queda en $0 y se abre para cargar los montos.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase } = require('./support/datos');

const ID = {
  fDos: '20000000-0000-4000-8000-000000000002',
  nBruno: '30000000-0000-4000-8000-000000000002',
};
const TRASLADO = '70000000-0000-4000-8000-000000000004'; // el de los datos ficticios
const CANCELADO = '70000000-0000-4000-8000-000000000041';
const PREVISTO = '70000000-0000-4000-8000-000000000043';
const A_TRAS = '40000000-0000-4000-8000-000000000042';
const TAMANOS = [[390, 844], [1280, 900]];

function registroCancelado(extra = {}) {
  return {
    id: CANCELADO, tipo: 'traslado', registrado_por: 'Prueba', familia_id: ID.fDos, familia_nombre: 'Familia Prueba Dos',
    ninera_id: ID.nBruno, ninera_nombre: 'Bruno Inventado', fecha: '2026-10-05', hora_inicio: '08:00:00', hora_fin: null,
    km: 12, origen: 'Casa', destino: 'Colegio', cobro_familia: 0, pago_ninera: 0, notas: 'Bruno Inventado no fue — sin reemplazo',
    created_at: '2026-10-01T22:00:00Z', termina_dia_siguiente: false, cobrado: true, pagado: true, fuente: 'app',
    asignacion_id: null, cancelado: true, ...extra,
  };
}
// Lo que escribió el trigger al cancelarlo (y otros cambios alrededor, para que se elija el correcto).
function historialCancelacion(sittingId = CANCELADO) {
  return [
    { id: 1, sitting_id: sittingId, accion: 'alta', usuario: 'paulina@ejemplo.test', cuando: '2026-10-01T22:00:00Z', cambios: null, fila: {} },
    { id: 2, sitting_id: sittingId, accion: 'cambio', usuario: 'paulina@ejemplo.test', cuando: '2026-10-02T10:00:00Z',
      cambios: { km: { antes: 10, despues: 12 } }, fila: null },
    { id: 3, sitting_id: sittingId, accion: 'cambio', usuario: 'delfina@ejemplo.test', cuando: '2026-10-05T12:00:00Z',
      cambios: {
        cancelado: { antes: false, despues: true }, cobro_familia: { antes: 450, despues: 0 }, pago_ninera: { antes: 250, despues: 0 },
        cobrado: { antes: false, despues: true }, pagado: { antes: false, despues: true },
        notas: { antes: 'Llevar <b>mochila</b>', despues: 'Bruno Inventado no fue — sin reemplazo' },
      }, fila: null },
    { id: 4, sitting_id: sittingId, accion: 'cambio', usuario: 'delfina@ejemplo.test', cuando: '2026-10-05T12:30:00Z',
      cambios: { registrado_por: { antes: 'Prueba', despues: 'Delfina' } }, fila: null },
  ];
}
function datosCancelado(extraRegistro = {}) {
  const d = datosBase();
  d.sittings_traslados.push(registroCancelado(extraRegistro));
  d.sittings_historial = historialCancelacion();
  return d;
}
// Fijos automáticos: un traslado fijo de los martes con el previsto del 06/10 marcado "no va".
function datosPrevistoCancelado() {
  const d = datosBase();
  d.app_config = [{ id: 'fijos_automaticos', valor: { activo: true, dias: 14 }, actualizado_at: '2026-10-04T06:00:00Z' }];
  d.asignaciones = d.asignaciones.map(a => ({ ...a, cobro_traslado: null, pago_traslado: null }));
  d.asignaciones.push({ id: A_TRAS, familia_id: ID.fDos, ninera_id: ID.nBruno, ninera_nombre: 'Bruno Inventado', cobro_hora: null, pago_hora: null, created_at: '2026-09-01T00:00:00Z', dias: ['M'], hora_inicio: '08:00:00', hora_fin: null, vigente_desde: '2026-09-01', vigente_hasta: null, tipo: 'traslado', cobro_traslado: 956, pago_traslado: 559 });
  d.sittings_traslados.push(registroCancelado({ id: PREVISTO, fecha: '2026-10-06', km: null, origen: null, destino: null, registrado_por: null,
    notas: 'Bruno Inventado no va — sin reemplazo', asignacion_id: A_TRAS, estado: 'previsto', generado_automatico: false, revisado_at: null }));
  d.sittings_historial = [
    { id: 1, sitting_id: PREVISTO, accion: 'alta', usuario: 'postgres', cuando: '2026-10-01T06:00:00Z', cambios: null, fila: {} },
    { id: 2, sitting_id: PREVISTO, accion: 'cambio', usuario: 'delfina@ejemplo.test', cuando: '2026-10-04T10:00:00Z',
      cambios: {
        cancelado: { antes: false, despues: true }, cobro_familia: { antes: 956, despues: 0 }, pago_ninera: { antes: 559, despues: 0 },
        cobrado: { antes: false, despues: true }, pagado: { antes: false, despues: true }, generado_automatico: { antes: true, despues: false },
        notas: { antes: null, despues: 'Bruno Inventado no va — sin reemplazo' },
      }, fila: null },
  ];
  return d;
}

const itemsAgenda = (page, texto) => page.locator('#agenda-grid-wrap [onclick^="abrirModalSolicitud"]', { hasText: texto });
const modal = page => page.locator('#editmodal.show');
const patches = e => e.escrituras.filter(w => w.tabla === 'sittings_traslados' && w.metodo === 'PATCH');
async function abrirModalCancelado(page) {
  await irAModulo(page, 'agenda');
  const item = itemsAgenda(page, 'Cancelado').filter({ hasText: 'Familia Prueba Dos' });
  await expect(item).toHaveCount(1);
  await item.click();
  await expect(modal(page)).toBeVisible();
}

test.describe('cancelar un traslado desde el celular', () => {
  for (const [ancho, alto] of TAMANOS) {
    test(`a ${ancho} px: tocar la fila de la lista abre el registro, sin deslizar la tabla; los botones siguen andando`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      const d = datosBase();
      d.sittings_traslados.find(s => s.id === TRASLADO).fecha = '2026-10-02'; // en el mes de la lista
      const e = await abrirApp(page, { datos: d });
      await irAModulo(page, 'sittings');
      const fila = page.locator('#sit-list-wrap tbody tr', { hasText: 'Familia Prueba Dos' });
      const celdaFamilia = fila.locator('td').nth(2);
      const caja = await celdaFamilia.boundingBox();
      expect(caja.x + caja.width, 'la celda que se toca entra en la pantalla').toBeLessThanOrEqual(ancho);
      await celdaFamilia.click();
      await expect(modal(page).locator('h2')).toHaveText('Editar registro');
      await expect(page.locator('#sit-familia')).toHaveValue('Familia Prueba Dos');
      await page.locator('#editmodal .modal-close').click();
      await expect(modal(page)).toHaveCount(0);

      // Los botones de la fila no abren además el formulario.
      await fila.locator('button', { hasText: 'Incidente' }).click();
      await expect(modal(page).locator('h2')).toHaveText('Registrar incidente');
      await expect(page.locator('#sit-familia')).toHaveCount(0);
      await page.locator('#editmodal .modal-close').click();
      await fila.locator('button', { hasText: 'Eliminar' }).click();
      await expect(page.locator('.confirmoverlay .confirmmsg')).toContainText('¿Eliminar este registro?');
      await expect(page.locator('#sit-familia')).toHaveCount(0);
      await page.locator('#confirm-no').click();
      expect(patches(e)).toEqual([]);
      expect(e.escrituras.filter(w => w.metodo === 'DELETE')).toEqual([]);
      verificarLimpio(e);
    });

    test(`a ${ancho} px: la casilla "sin cargo" se ve entera y grande, y cancela el traslado`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      const d = datosBase();
      d.sittings_traslados.find(s => s.id === TRASLADO).fecha = '2026-10-02';
      const e = await abrirApp(page, { datos: d });
      await irAModulo(page, 'sittings');
      await page.locator('#sit-list-wrap tbody tr', { hasText: 'Familia Prueba Dos' }).locator('td').nth(2).click();
      await expect(modal(page)).toBeVisible();
      const chk = page.locator('#sit-cancelado');
      const etiqueta = chk.locator('xpath=..');
      await chk.scrollIntoViewIfNeeded();
      expect((await chk.boundingBox()).width, 'casilla fácil de tocar').toBeGreaterThanOrEqual(22);
      const medidas = await page.evaluate(() => {
        const box = document.querySelector('#editmodal .confirmbox'), lbl = document.getElementById('sit-cancelado').parentElement;
        return { modal: [box.scrollWidth, box.clientWidth], etiqueta: [lbl.scrollWidth, lbl.clientWidth] };
      });
      expect(medidas.modal[0], 'el modal no hace scroll de costado').toBeLessThanOrEqual(medidas.modal[1]);
      expect(medidas.etiqueta[0], 'el texto de la casilla no se corta').toBeLessThanOrEqual(medidas.etiqueta[1]);
      await expect(etiqueta).toContainText('sin cargo');
      await etiqueta.screenshot({ path: `test-results/cancelar-casilla-${ancho}.png` });

      await etiqueta.click({ position: { x: Math.min(120, (await etiqueta.boundingBox()).width - 5), y: 10 } }); // tocando el texto, no la cajita
      await expect(chk).toBeChecked();
      await expect(page.locator('#sit-cobro')).toHaveValue('0');
      await expect(page.locator('#sit-pago')).toHaveValue('0');
      await expect(page.locator('#sit-cobro')).toBeDisabled();
      await page.locator('#editmodal button', { hasText: 'Guardar cambios' }).click();
      await expect(page.locator('.toaststack .toast', { hasText: 'Registro actualizado.' })).toBeVisible();
      expect(patches(e)).toHaveLength(1);
      expect(patches(e)[0].cuerpo).toMatchObject({ cancelado: true, cobro_familia: 0, pago_ninera: 0, tipo: 'traslado' });
      await expect(page.locator('#sit-list-wrap tbody tr', { hasText: 'Familia Prueba Dos' })).toContainText('Cancelado');
      verificarLimpio(e);
    });
  }
});

test.describe('reactivar un registro cancelado desde la Agenda', () => {
  test('el modal ofrece "Reactivar" y lo deja como estaba antes de cancelarlo, montos incluidos', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCancelado() });
    await abrirModalCancelado(page);
    await expect(modal(page)).toContainText('Cancelado');
    const botones = modal(page).locator('button');
    await expect(botones.filter({ hasText: 'Reactivar' })).toHaveCount(1);
    await expect(botones.filter({ hasText: 'Eliminar este registro' })).toHaveCount(1);
    await botones.filter({ hasText: 'Reactivar' }).click();
    const msg = page.locator('.confirmoverlay .confirmmsg');
    await expect(msg).toContainText('como estaba antes de cancelarlo');
    await expect(msg).toContainText('cobro $450');
    await expect(msg).toContainText('pago $250');
    await expect(page.locator('#confirm-si')).toHaveText('Reactivar');
    await page.locator('#confirm-si').click();
    await expect(page.locator('.toaststack .toast', { hasText: 'Registro reactivado.' })).toBeVisible();
    expect(patches(e)).toHaveLength(1);
    // Solo lo que cambió al cancelar, vuelto atrás (el cambio posterior de "Registró" no se toca).
    expect(patches(e)[0].cuerpo).toEqual({ cancelado: false, cobro_familia: 450, pago_ninera: 250, cobrado: false, pagado: false, notas: 'Llevar <b>mochila</b>' });
    expect(patches(e)[0].params).toMatchObject({ id: `eq.${CANCELADO}`, cancelado: 'eq.true' }); // si otra lo tocó antes, no pisa nada
    await expect(modal(page)).toHaveCount(0);
    const item = itemsAgenda(page, 'Familia Prueba Dos').filter({ hasText: '08:00' });
    await expect(item).not.toContainText('Cancelado');
    await expect(item).toContainText('450');
    verificarLimpio(e);
  });

  test('cancelar el confirmar no cambia nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCancelado() });
    await abrirModalCancelado(page);
    await modal(page).locator('button', { hasText: 'Reactivar' }).click();
    await page.locator('#confirm-no').click();
    await expect(page.locator('.confirmoverlay .confirmmsg')).toHaveCount(0);
    expect(patches(e)).toEqual([]);
    await expect(modal(page)).toBeVisible(); // el modal sigue abierto para seguir mirando
    await expect(modal(page).locator('button', { hasText: 'Reactivar' })).toBeEnabled();
    verificarLimpio(e);
  });

  test('un previsto marcado "no va" se reactiva y vuelve a ser el previsto del fijo', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPrevistoCancelado() });
    await abrirModalCancelado(page);
    await expect(modal(page).locator('button', { hasText: 'Editar este registro' })).toHaveCount(0); // un previsto se corrige desde el fijo
    await modal(page).locator('button', { hasText: 'Reactivar' }).click();
    await expect(page.locator('.confirmoverlay .confirmmsg')).toContainText('cobro $956');
    await page.locator('#confirm-si').click();
    await expect(page.locator('.toaststack .toast', { hasText: 'Registro reactivado.' })).toBeVisible();
    expect(patches(e)[0].cuerpo).toEqual({ cancelado: false, cobro_familia: 956, pago_ninera: 559, cobrado: false, pagado: false, generado_automatico: true, notas: null });
    await expect(itemsAgenda(page, 'Cancelado')).toHaveCount(0);
    await expect(itemsAgenda(page, 'Previsto').filter({ hasText: 'Familia Prueba Dos' })).toHaveCount(1);
    verificarLimpio(e);
  });

  test('sin historial de la cancelación: avisa, queda en $0 y abre el registro para cargar los montos', async ({ page }) => {
    const d = datosCancelado();
    d.sittings_historial = [{ id: 1, sitting_id: CANCELADO, accion: 'alta', usuario: 'paulina@ejemplo.test', cuando: '2026-10-05T12:00:00Z', cambios: null, fila: { cancelado: true } }]; // nació cancelado ("No fue nadie ese día")
    const e = await abrirApp(page, { datos: d });
    await abrirModalCancelado(page);
    await modal(page).locator('button', { hasText: 'Reactivar' }).click();
    const msg = page.locator('.confirmoverlay .confirmmsg');
    await expect(msg).toContainText('No hay registro de cómo estaba antes');
    await expect(msg).toContainText('$0');
    await page.locator('#confirm-si').click();
    await expect(page.locator('.toaststack .toast', { hasText: 'Registro reactivado' })).toBeVisible();
    expect(patches(e)).toHaveLength(1);
    expect(patches(e)[0].cuerpo).toEqual({ cancelado: false, cobrado: false, pagado: false });
    // Se abre el registro en Sittings & traslados, ya sin la casilla tildada.
    await expect(modal(page).locator('h2')).toHaveText('Editar registro');
    await expect(page.locator('#sit-familia')).toHaveValue('Familia Prueba Dos');
    await expect(page.locator('#sit-cancelado')).not.toBeChecked();
    await expect(page.locator('#sit-cobro')).toHaveValue('0');
    verificarLimpio(e);
  });

  test('base sin la tabla de historial: lo mismo, sin errores', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCancelado(), baseSinMigrar: true });
    await abrirModalCancelado(page);
    await modal(page).locator('button', { hasText: 'Reactivar' }).click();
    await expect(page.locator('.confirmoverlay .confirmmsg')).toContainText('No hay registro de cómo estaba antes');
    await page.locator('#confirm-si').click();
    await expect(page.locator('.toaststack .toast', { hasText: 'Registro reactivado' })).toBeVisible();
    expect(patches(e)[0].cuerpo).toEqual({ cancelado: false, cobrado: false, pagado: false });
    await expect(modal(page).locator('h2')).toHaveText('Editar registro');
    verificarLimpio(e, { ignorar: [/status of (400|404)/] }); // la tabla y la columna que no existen
  });

  test('si la base falla, avisa y el registro sigue cancelado', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCancelado() });
    e.fallar = ({ tabla, metodo }) => (tabla === 'sittings_traslados' && metodo === 'PATCH') ? { status: 500, message: 'falla simulada' } : undefined;
    await abrirModalCancelado(page);
    await modal(page).locator('button', { hasText: 'Reactivar' }).click();
    await page.locator('#confirm-si').click();
    await expect(page.locator('.toaststack .toast.bad', { hasText: 'No se pudo reactivar' })).toBeVisible();
    await expect(page.locator('.toaststack .toast', { hasText: 'Registro reactivado' })).toHaveCount(0);
    expect(e.db.sittings_traslados.find(s => s.id === CANCELADO).cancelado).toBe(true);
    await expect(modal(page).locator('button', { hasText: 'Reactivar' })).toBeEnabled(); // se puede volver a intentar
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('si otra admin ya lo reactivó, avisa y no pisa nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCancelado() });
    await abrirModalCancelado(page);
    await modal(page).locator('button', { hasText: 'Reactivar' }).click();
    // Mientras está el confirmar abierto, la otra lo reactiva (y hasta le corrige el monto).
    Object.assign(e.db.sittings_traslados.find(s => s.id === CANCELADO), { cancelado: false, cobro_familia: 500, pago_ninera: 300, cobrado: false, pagado: false });
    await page.locator('#confirm-si').click();
    await expect(page.locator('.toaststack .toast.bad', { hasText: 'alguien más' })).toBeVisible();
    await expect(page.locator('.toaststack .toast', { hasText: 'Registro reactivado' })).toHaveCount(0);
    expect(e.db.sittings_traslados.find(s => s.id === CANCELADO)).toMatchObject({ cobro_familia: 500, pago_ninera: 300 });
    verificarLimpio(e);
  });

  test('doble toque: un solo cambio en la base', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCancelado() });
    e.demoraEscrituras = 500;
    await abrirModalCancelado(page);
    const btn = modal(page).locator('button', { hasText: 'Reactivar' });
    await btn.click();
    await page.locator('#confirm-si').click();
    await expect(btn).toBeDisabled();
    await btn.click({ force: true, timeout: 500 }).catch(() => {});
    await expect(page.locator('.toaststack .toast', { hasText: 'Registro reactivado.' })).toBeVisible();
    expect(patches(e)).toHaveLength(1);
    verificarLimpio(e);
  });

  test('un registro que no está cancelado no ofrece Reactivar', async ({ page }) => {
    const d = datosBase();
    d.sittings_traslados.find(s => s.id === TRASLADO).fecha = '2026-10-05';
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'agenda');
    await itemsAgenda(page, 'Familia Prueba Dos').filter({ hasText: '08:00' }).click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('button', { hasText: 'Reactivar' })).toHaveCount(0);
    await expect(modal(page).locator('button', { hasText: 'Editar este registro' })).toHaveCount(1);
    verificarLimpio(e);
  });

  test('a 390 px: el botón entra en la pantalla (captura)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: datosCancelado() });
    await abrirModalCancelado(page);
    const btn = modal(page).locator('button', { hasText: 'Reactivar' });
    const caja = await btn.boundingBox();
    expect(caja.x + caja.width).toBeLessThanOrEqual(390);
    expect(caja.height).toBeGreaterThanOrEqual(36);
    await modal(page).screenshot({ path: 'test-results/reactivar-390.png' });
    verificarLimpio(e);
  });
});
