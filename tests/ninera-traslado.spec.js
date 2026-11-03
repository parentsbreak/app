// App de niñeras: los pedidos de traslado (fase 1, etapa 11, 03/11/2026, decisiones 6.9). La tarjeta "Traslado [día]" con la
// hora de salida, "De [zona] a [zona]", los chicos y "Precio: $X por viaje" (nunca las direcciones ni el cobro antes de que la
// elijan), "¡Quedaste seleccionada!" con las dos direcciones y "Cómo llegar" a cada una, el traslado de un fijo en "Próximos
// sittings" y la tarjeta del cambio de horario de un traslado. Hoy es el domingo 04/10/2026 a las 12:00 de Montevideo; la
// niñera es "Niñera (práctica)" y el traslado de la Familia (práctica) sale el martes 06/10 a las 08:00, a $350 el viaje.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { ID, datosPedidos, sitting } = require('./support/datos');

const SOL = '88000000-0000-4000-8000-0000000000b1';
const SN = '81000000-0000-4000-8000-0000000000b1';
const REGISTRO = '70000000-0000-4000-8000-0000000000b1';
const FIJO = '70000000-0000-4000-8000-0000000000b2';
const ORIGEN = 'Calle Inventada 1';
const DESTINO = 'Colegio Inventado, puerta 2';
const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/];

function datos({ sn = {}, solicitud = {}, registro = false, sinColumnas = false } = {}) {
  const d = datosPedidos();
  const ruta = sinColumnas ? {} : { origen: ORIGEN, destino: DESTINO, destino_zona: 'Carrasco', km: 12 };
  d.solicitudes.push({ id: SOL, familia_id: ID.fPractica, familia_nombre: 'Familia (práctica)', tipo: 'traslado', zona: 'Pocitos', fecha: '2026-10-06',
    hora_inicio: '08:00:00', hora_fin: null, cobro_familia: 450, estado: 'pendiente_confirmar', notas: 'Nota interna de prueba', created_at: '2026-10-01T00:00:00Z',
    termina_dia_siguiente: false, horario_aproximado: false, responder_hasta: '2026-10-04T15:30:00.000Z', enviado_app_en: '2026-10-04T14:50:00.000Z', ...ruta, ...solicitud });
  d.solicitud_ninieras.push({ id: SN, solicitud_id: SOL, ninera_id: ID.nPractica, ninera_nombre: 'Niñera (práctica)', pago_ninera: null, estado: 'invitada',
    created_at: '2026-10-04T14:50:00Z', origen: 'app', precio_hora: null, ...(sinColumnas ? {} : { precio_viaje: 350 }), enviado_en: '2026-10-04T14:50:00.000Z',
    respondido_en: null, motivo_no: null, motivo_texto: null, seleccionada_en: null, visto_en: null, ...sn });
  d.ninieras.filter(n => n.id === ID.nPractica).forEach(n => Object.assign(n, { tipo: 'Ambas', perfil_app_en: '2026-10-02T15:00:00+00:00', app_activada_en: '2026-10-02T14:00:00+00:00' }));
  if (registro) {
    d.sittings_traslados.push(sitting(REGISTRO, '2026-10-06', { tipo: 'traslado', familia_id: ID.fPractica, familia_nombre: 'Familia (práctica)', ninera_id: ID.nPractica,
      ninera_nombre: 'Niñera (práctica)', hora_inicio: '08:00:00', hora_fin: null, estado: 'confirmado', solicitud_id: SOL, origen: ORIGEN, destino: DESTINO, km: 12,
      cobro_familia: 450, pago_ninera: 350 }));
  }
  return d;
}
async function abrir(page, opciones = {}) {
  await page.addInitScript(() => { delete window.PushManager; });
  return abrirAppNinera(page, { ninera: ID.nPractica, datos: datos(), ...opciones });
}
const rpcs = (e, nombre) => e.escrituras.filter(w => w.tabla === `rpc/${nombre}`).map(w => w.cuerpo);
const tarjeta = page => page.locator(`#pedido-${SN}`);
const modal = page => page.locator('#modal-ninera');
const boton = (page, nombre) => page.getByRole('button', { name: nombre, exact: true });
const PLATA = /\$450|cobro|km/i;

test.describe('el pedido de un traslado', () => {
  test('la tarjeta: "Traslado [día]", la hora de salida, las dos zonas, los chicos y el precio por viaje; sin direcciones ni el cobro', async ({ page }) => {
    const e = await abrir(page);
    await expect(tarjeta(page).locator('h3')).toHaveText('Traslado Martes 06/10');
    const datosTarjeta = tarjeta(page).locator('.pedido-datos p');
    await expect(datosTarjeta).toHaveText(['A las 08:00', 'De Pocitos a Carrasco', '1 chico (4 años)', 'Precio: $350 por viaje']);
    const html = await page.locator('main').innerHTML();
    for (const prohibido of [ORIGEN, 'Colegio Inventado', 'Nota interna', 'Precio por hora', 'Familia (práctica)']) expect(html).not.toContain(prohibido);
    expect(html).not.toMatch(PLATA);
    await boton(page, 'Puedo').click();
    await expect(page.locator('#pedidos-esperando')).toContainText('Dijiste que puedes');
    expect(rpcs(e, 'responder_pedido')).toEqual([{ p_sn_id: SN, p_respuesta: 'acepto', p_motivo: null, p_motivo_texto: null }]);
    verificarLimpio(e);
  });

  test('base sin migrar (etapa 11): la tarjeta sale igual, sin precio ni zonas de destino', async ({ page }) => {
    const e = await abrir(page, { datos: datos({ sinColumnas: true }), baseSinMigrar: 'etapa11' });
    await expect(tarjeta(page)).toBeVisible();
    await expect(tarjeta(page)).not.toContainText('por viaje');
    await expect(tarjeta(page)).not.toContainText('Precio por hora');
    verificarLimpio(e);
  });

  test('escape: una zona con HTML se ve tal cual', async ({ page }) => {
    const d = datos({ solicitud: { destino_zona: '<img src=x onerror="window.__xss=1">' } });
    const e = await abrir(page, { datos: d });
    await expect(tarjeta(page)).toContainText('De Pocitos a <img src=x onerror="window.__xss=1">');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });

  test('a 390 px, sin scroll de costado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrir(page);
    await expect(tarjeta(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    verificarLimpio(e);
  });
});

test.describe('"¡Quedaste seleccionada!" en un traslado', () => {
  const elegida = () => datos({ registro: true, solicitud: { estado: 'confirmada' }, sn: { estado: 'confirmada', respondido_en: '2026-10-04T14:55:00.000Z', seleccionada_en: '2026-10-04T15:00:00.000Z' } });

  test('la tarjeta y "Ver los datos": las dos direcciones, las zonas, el precio por viaje y "Cómo llegar" a cada una', async ({ page }) => {
    const e = await abrir(page, { datos: elegida() });
    await expect(page.locator('#pedidos-seleccionada p').first()).toHaveText('Traslado del Martes 06/10, a las 08:00. Ya tienes todos los datos.');
    await boton(page, 'Ver los datos').click();
    await expect(modal(page).locator('h2')).toHaveText('¡Quedaste seleccionada!');
    await expect(modal(page)).toContainText(`Desde: ${ORIGEN}`);
    await expect(modal(page)).toContainText(`Hasta: ${DESTINO}`);
    await expect(modal(page)).toContainText('Zonas: de Pocitos a Carrasco');
    await expect(modal(page)).toContainText('Precio: $350 por viaje');
    await expect(modal(page)).not.toContainText('Precio por hora');
    await expect(modal(page).locator('#detalle-ficha')).toHaveCount(0); // la ficha de la familia es de los sittings
    await boton(page, 'Cómo llegar al origen').click();
    await expect(modal(page).locator('#como-llegar-origen').getByRole('link', { name: 'Google Maps', exact: true }))
      .toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ORIGEN));
    await boton(page, 'Cómo llegar al destino').click();
    await expect(modal(page).locator('#como-llegar-destino').getByRole('link', { name: 'Waze', exact: true }))
      .toHaveAttribute('href', 'https://waze.com/ul?q=' + encodeURIComponent(DESTINO) + '&navigate=yes');
    expect(await modal(page).innerHTML()).not.toMatch(PLATA);
    expect(rpcs(e, 'ninera_marcar_pedido_visto')).toEqual([{ p_sn_id: SN }]);
    verificarLimpio(e);
  });

  test('sin el registro todavía: los datos del pedido con las zonas y el precio por viaje', async ({ page }) => {
    const d = elegida();
    d.sittings_traslados = d.sittings_traslados.filter(s => s.id !== REGISTRO);
    const e = await abrir(page, { datos: d });
    await boton(page, 'Ver los datos').click();
    await expect(modal(page)).toContainText('Zonas: de Pocitos a Carrasco');
    await expect(modal(page)).toContainText('Precio: $350 por viaje');
    await expect(modal(page)).not.toContainText(ORIGEN);
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('traslados en "Próximos sittings" y los cambios', () => {
  test('un traslado de un fijo, previsto: "Las direcciones aparecen el día del traslado"', async ({ page }) => {
    const d = datos();
    d.solicitud_ninieras = d.solicitud_ninieras.filter(x => x.id !== SN);
    d.sittings_traslados.push(sitting(FIJO, '2026-10-07', { tipo: 'traslado', familia_id: ID.fPractica, familia_nombre: 'Familia (práctica)', ninera_id: ID.nPractica,
      ninera_nombre: 'Niñera (práctica)', hora_inicio: '07:30:00', hora_fin: null, estado: 'previsto', origen: ORIGEN, destino: DESTINO, km: 12, asignacion_id: '99000000-0000-4000-8000-000000000001' }));
    const e = await abrir(page, { datos: d });
    const fila = page.locator('#proximos-sittings .sitting-tarjeta', { hasText: 'Traslado' });
    await expect(fila).toContainText('Traslado · Pocitos');
    await fila.click();
    await expect(modal(page)).toContainText('Las direcciones aparecen el día del traslado.');
    await expect(modal(page).getByRole('button', { name: /Cómo llegar/ })).toHaveCount(0);
    verificarLimpio(e);
  });

  test('la tarjeta del cambio de un traslado y de un fijo de traslados', async ({ page }) => {
    const d = datos();
    d.solicitud_ninieras = d.solicitud_ninieras.filter(x => x.id !== SN);
    const cambio = (id, extra) => ({ id, ninera_id: ID.nPractica, familia_id: ID.fPractica, familia_nombre: 'Familia (práctica)', sitting_id: null, solicitud_id: null,
      es_fijo: false, desde: '2026-10-06', hora_inicio: '08:30:00', hora_fin: null, termina_dia_siguiente: false, creado_en: '2026-10-04T14:00:00Z',
      respuesta: null, respondido_en: null, tipo: 'traslado', ...extra });
    d.cambios_horario = [cambio('9a000000-0000-4000-8000-000000000001'), cambio('9a000000-0000-4000-8000-000000000002', { es_fijo: true, desde: '2026-10-08', creado_en: '2026-10-04T14:10:00Z' })];
    const e = await abrir(page, { datos: d });
    const tarjetas = page.locator('#inicio-cambios .tarjeta-cambio');
    await expect(tarjetas).toHaveCount(2);
    await expect(tarjetas.nth(0).locator('h2')).toHaveText('Cambió el horario de tu traslado');
    await expect(tarjetas.nth(0)).toContainText('a las 08:30');
    await expect(tarjetas.nth(0)).not.toContainText(', en Pocitos');
    await expect(tarjetas.nth(1).locator('h2')).toHaveText('Cambió el horario de tu fijo de traslados');
    verificarLimpio(e);
  });
});
