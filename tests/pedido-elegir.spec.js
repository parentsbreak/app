// "Elegir niñeras" (fase 1, etapa 5, tarea 5.5, 02/11/2026): reemplaza el cuerpo de "Asignar niñera" en la
// Agenda para toda solicitud. Ordena con ordenarSugeridas (bloques, bajas, descartadas, inactivas), deja
// tildar a las que tienen la app ("Marcar las 10 primeras" / "Ninguna"), con el precio por hora de cada
// una a la vista y editable, y manda el pedido por la app ("Enviar a N", RPC enviar_pedido_app). "Asignar"
// (la asignación directa de siempre, con su pago y "Guardar asignación") queda en cada fila.
// Datos inventados (datosPedidos): hoy es domingo 04/10/2026; Familia Prueba Uno (Pocitos, dos chicos) pide
// el martes 06/10 de 20 a 23; Ana fue cinco veces a esa casa y no tiene la app; Carla y la "Niñera
// (práctica)" tienen la app; Bruno solo hace traslados. El simulador arranca con solo_practica prendido.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosPedidos, ID } = require('./support/datos');
const { errorRpc } = require('./support/rpc-ninera');

const SOL_UNO = ID.sUno; // Familia Prueba Uno, martes 06/10, 20 a 23, Pocitos
const SOL_PRACTICA = ID.sPractica; // Familia (práctica), martes 06/10
const SOL_DOS = '80000000-0000-4000-8000-000000000001'; // Familia Prueba Dos (sin chicos), Carrasco
const DORA = '30000000-0000-4000-8000-000000000005';
const EVA = '30000000-0000-4000-8000-000000000006';
const RUIDO_4XX = /status of 4\d\d/;

const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && (!metodo || w.metodo === metodo));
const envios = e => escrituras(e, 'rpc/enviar_pedido_app');
const fila = (page, id) => page.locator(`#editmodal .pedido-fila[data-id="${id}"]`);
const tilde = (page, id) => page.locator(`#editmodal .pedido-tilde[data-id="${id}"]`);
const botonEnviar = page => page.locator('#pedido-enviar');
const warnEnvio = page => page.locator('#pedido-enviar-warn');

function soloPracticaApagado(e) {
  e.db.app_config.find(c => c.id === 'pedidos_app').valor.solo_practica = false;
}
let nPrecio = 0;
const precio = (familia_id, ninera_id, pago_hora) => ({
  id: `95000000-0000-4000-8000-${String(++nPrecio).padStart(12, '0')}`, familia_id, ninera_id, pago_hora, nota: null,
  creado_por: 'Prueba', creado_en: '2026-10-01T12:00:00Z', actualizado_en: '2026-10-01T12:00:00Z',
});
// Dora (Carrasco, con la app: "Fuera de zona" para un pedido de Pocitos) y Eva (inactiva). Carla marcó
// que el martes no puede: baja dentro de su bloque, se le puede mandar igual.
function datos({ precios = [], noPuede = true } = {}) {
  const d = datosPedidos();
  const carla = d.ninieras.find(n => n.id === ID.nCarla);
  d.ninieras.push(
    { ...carla, id: DORA, nombre: 'Dora Inventada', telefono: '098000005', zona: 'Carrasco', tipo: 'Niñera', user_id: '00000000-0000-4000-8000-000000000005', temporada_token: '60000000-0000-4000-8000-000000000005', foto_propuesta_ruta: null, foto_propuesta_en: null },
    { ...carla, id: EVA, nombre: 'Eva Inactiva', telefono: '098000006', zona: 'Pocitos', tipo: 'Niñera', activa: false, user_id: null, temporada_token: '60000000-0000-4000-8000-000000000006', foto_propuesta_ruta: null, foto_propuesta_en: null },
  );
  if (noPuede) d.ninera_no_disponible = [{ id: '96000000-0000-4000-8000-000000000001', ninera_id: ID.nCarla, fecha: '2026-10-06', creado_en: '2026-10-02T12:00:00Z' }];
  d.precios_ninera_familia = precios;
  return d;
}
async function abrirElegir(page, solicitudId) {
  await irAModulo(page, 'agenda');
  await page.evaluate(i => abrirModalAsignar(i), solicitudId);
  await expect(page.locator('#editmodal .pedido-elegir')).toBeVisible();
  await esperarQuieta(page);
}

test.describe('Elegir niñeras: orden y bloques', () => {
  test('a 390 px: ya fueron, nunca fueron de la zona (las que bajan al final), fuera de zona, no se les puede mandar e inactivas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    const modal = page.locator('#editmodal');
    await expect(modal.locator('h2')).toHaveText('Elegir niñeras');
    await expect(modal.locator('.pedido-resumen')).toContainText('Familia Prueba Uno');
    await expect(modal.locator('.pedido-resumen')).toContainText('20:00–23:00');
    await expect(modal.locator('.pedido-resumen')).toContainText('2 chicos');
    // El orden, de arriba abajo (los plegados también están en la página, cerrados).
    expect(await modal.locator('.pedido-fila .pedido-nombre').allTextContents())
      .toEqual(['Ana Ficticia', 'Niñera (práctica)', 'Carla Ejemplo', 'Dora Inventada', 'Bruno Inventado', 'Eva Inactiva']);
    const bloques = modal.locator('.pedido-bloque');
    await expect(bloques.nth(0).locator('.agenda-tier-label').first()).toHaveText('Ya fueron a esa casa');
    await expect(bloques.nth(1).locator('.agenda-tier-label').first()).toHaveText('Nunca fueron, de Pocitos');
    // "Bajan, pero se les puede mandar igual" va antes de Carla (no puede ese día), no antes de la de práctica.
    const bloque2 = await bloques.nth(1).evaluate(b => [...b.querySelectorAll('.agenda-tier-label, .pedido-nombre')].map(x => x.textContent));
    expect(bloque2).toEqual(['Nunca fueron, de Pocitos', 'Niñera (práctica)', 'Bajan, pero se les puede mandar igual', 'Carla Ejemplo']);
    await expect(fila(page, ID.nCarla)).toContainText('Marcó que ese día no puede');
    // Ana: fue cinco veces, sin la app (sin casilla, con WhatsApp) y sin temporada cargada.
    await expect(fila(page, ID.nAna)).toContainText('Fue 5 veces.');
    await expect(fila(page, ID.nAna)).toContainText('sin app');
    await expect(fila(page, ID.nAna)).toContainText('sin temporada cargada');
    await expect(tilde(page, ID.nAna)).toHaveCount(0);
    const wa = fila(page, ID.nAna).locator('a', { hasText: 'WhatsApp' });
    await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/59898000001\?text=/);
    await expect(fila(page, ID.nCarla).locator('a', { hasText: 'WhatsApp' })).toHaveCount(0);
    // Plegados, con la cantidad.
    const plegado = texto => modal.locator('details.pedido-plegado', { has: page.locator('summary', { hasText: texto }) });
    await expect(plegado('Fuera de zona (1)')).not.toHaveAttribute('open', '');
    await expect(plegado('No se les puede mandar (1)')).toContainText('No realiza este tipo de servicio.');
    await expect(plegado('Inactivas (1)')).toContainText('Eva Inactiva');
    await expect(fila(page, DORA)).toBeHidden();
    // "Asignar" en todas, también en las que no se les puede mandar y en las inactivas.
    await expect(modal.locator('input[name="agenda-asignar-ninera"]')).toHaveCount(6);
    // Sin nada tildado, "Enviar" en gris.
    await expect(botonEnviar(page)).toHaveText('Enviar a 0 por la app');
    await expect(botonEnviar(page)).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.locator('#editmodal .confirmbox').screenshot({ path: 'test-results/pedido-elegir-390.png' });
    // La lectura: una sola RPC con la familia y el día.
    expect(escrituras(e, 'rpc/sugeridas_datos')[0].cuerpo).toEqual({ p_familia_id: ID.fUno, p_familia_nombre: 'Familia Prueba Uno', p_fecha: '2026-10-06' });
    verificarLimpio(e);
  });

  test('a 1280 px se ve igual, sin scroll de costado', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ precios: [precio(ID.fUno, ID.nCarla, 300)] }) });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await page.locator('#editmodal button', { hasText: 'Marcar las 10 primeras' }).click();
    await expect(botonEnviar(page)).toHaveText('Enviar a 2 por la app');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await page.locator('#editmodal .confirmbox').screenshot({ path: 'test-results/pedido-elegir-1280.png' });
    verificarLimpio(e);
  });

  test('temporada: fuera de Montevideo esa quincena va a "No se les puede mandar" con el lugar', async ({ page }) => {
    const d = datos({ noPuede: false });
    // 06/10 es la 1ra quincena de octubre (la 18 de 24).
    // (Las fichas de prueba copian la de Carla: la suya va aparte para no cambiar las otras.)
    const carla = d.ninieras.find(n => n.id === ID.nCarla);
    carla.temporada_lugares = { ...carla.temporada_lugares, 18: 'punta' };
    const e = await abrirApp(page, { datos: d });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await expect(page.locator('#editmodal details.pedido-plegado', { hasText: 'No se les puede mandar (2)' })).toContainText('En Punta del Este esa quincena');
    await expect(tilde(page, ID.nCarla)).toHaveCount(0);
    verificarLimpio(e);
  });

  test('ocupada en ese horario: no se le puede mandar, pero se puede asignar', async ({ page }) => {
    const d = datos({ noPuede: false });
    d.solicitudes.push({ id: '80000000-0000-4000-8000-000000000009', familia_id: ID.fDos, familia_nombre: 'Familia Prueba Dos', tipo: 'sitting', zona: 'Carrasco', fecha: '2026-10-06', hora_inicio: '21:00:00', hora_fin: '23:30:00', cobro_familia: null, estado: 'confirmada', notas: null, created_at: '2026-10-01T00:00:00Z', termina_dia_siguiente: false });
    d.solicitud_ninieras.push({ id: 'a7000000-0000-4000-8000-000000000009', solicitud_id: '80000000-0000-4000-8000-000000000009', ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', pago_ninera: 600, estado: 'confirmada', created_at: '2026-10-01T00:00:00Z' });
    const e = await abrirApp(page, { datos: d });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await expect(fila(page, ID.nCarla)).toContainText('Ya tiene otro servicio en ese horario.');
    await expect(tilde(page, ID.nCarla)).toHaveCount(0);
    await expect(fila(page, ID.nCarla).locator('input[name="agenda-asignar-ninera"]')).toHaveCount(1);
    verificarLimpio(e);
  });
});

test.describe('Elegir niñeras: tildar y precios', () => {
  test('"Marcar las 10 primeras" tilda solo a las que se les puede mandar; "Ninguna" destilda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await page.locator('#editmodal button', { hasText: 'Marcar las 10 primeras' }).click();
    await expect(tilde(page, ID.nCarla)).toBeChecked();
    await expect(tilde(page, DORA)).toBeChecked();
    // Dora está en "Fuera de zona": se abre para que se vea que quedó tildada.
    await expect(fila(page, DORA)).toBeVisible();
    await expect(tilde(page, ID.nAna)).toHaveCount(0); // sin app
    await expect(tilde(page, ID.nPractica)).toHaveCount(0); // de práctica, con una familia real
    await expect(botonEnviar(page)).toHaveText('Enviar a 2 por la app');
    await expect(botonEnviar(page)).toBeEnabled();
    await page.locator('#editmodal button', { hasText: 'Ninguna' }).click();
    await expect(tilde(page, ID.nCarla)).not.toBeChecked();
    await expect(botonEnviar(page)).toHaveText('Enviar a 0 por la app');
    await expect(botonEnviar(page)).toBeDisabled();
    expect(envios(e)).toEqual([]);
    verificarLimpio(e);
  });

  test('el precio guardado viene precargado y se puede cambiar; la casilla sale solo al cambiarlo', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ precios: [precio(ID.fUno, ID.nCarla, 300)] }) });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await tilde(page, ID.nCarla).check();
    const pCarla = page.locator(`#pedido-precio-${ID.nCarla}`);
    await expect(pCarla).toHaveValue('300');
    await expect(page.locator(`#pedido-guardar-precio-${ID.nCarla}`)).toHaveCount(0);
    await pCarla.fill('320');
    const casillaCarla = page.locator(`#pedido-guardar-precio-${ID.nCarla}`);
    await expect(casillaCarla).toBeVisible();
    await expect(casillaCarla).not.toBeChecked(); // ya tenía precio: un precio de un día no lo pisa
    await expect(page.locator('#editmodal label', { hasText: 'Guardar como precio de Carla Ejemplo con esta familia' })).toBeVisible();
    await pCarla.fill('300');
    await expect(casillaCarla).toHaveCount(0);
    // Dora no tiene precio: la tarifa de la familia, y al cambiarlo la casilla viene tildada.
    await page.locator('#editmodal details.pedido-plegado summary', { hasText: 'Fuera de zona' }).click();
    await tilde(page, DORA).check();
    await expect(page.locator(`#pedido-precio-${DORA}`)).toHaveValue('250');
    await page.locator(`#pedido-precio-${DORA}`).fill('280');
    await expect(page.locator(`#pedido-guardar-precio-${DORA}`)).toBeChecked();
    // Destildar a Carla saca su renglón de precios; el de Dora queda como estaba.
    await tilde(page, ID.nCarla).uncheck();
    await expect(pCarla).toHaveCount(0);
    await expect(page.locator(`#pedido-precio-${DORA}`)).toHaveValue('280');
    verificarLimpio(e);
  });

  test('"Enviar a 2": el cuerpo exacto a enviar_pedido_app, sin centavos, y después el precio tildado', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ precios: [precio(ID.fUno, ID.nCarla, 300)] }) });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await page.locator('#editmodal button', { hasText: 'Marcar las 10 primeras' }).click();
    await page.locator(`#pedido-precio-${DORA}`).fill('280.5');
    await expect(page.locator(`#pedido-guardar-precio-${DORA}`)).toBeChecked();
    await botonEnviar(page).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    await expect(page.locator('.toaststack .toast', { hasText: 'Enviado a 2. Te avisamos cuando alguna diga que puede.' })).toBeVisible();
    expect(envios(e)).toHaveLength(1);
    expect(envios(e)[0].cuerpo).toEqual({ p_solicitud_id: SOL_UNO, p_envios: [{ ninera_id: ID.nCarla, precio_hora: 300 }, { ninera_id: DORA, precio_hora: 280 }] });
    const guardados = escrituras(e, 'precios_ninera_familia', 'POST');
    expect(guardados).toHaveLength(1);
    expect(guardados[0].cuerpo).toMatchObject({ familia_id: ID.fUno, ninera_id: DORA, pago_hora: 280 });
    // Primero se manda, después se guarda el precio.
    expect(e.escrituras.indexOf(envios(e)[0])).toBeLessThan(e.escrituras.indexOf(guardados[0]));
    expect(e.db.solicitudes.find(s => s.id === SOL_UNO).estado).toBe('pendiente_confirmar');
    expect(e.db.solicitud_ninieras.filter(s => s.solicitud_id === SOL_UNO && s.origen === 'app')).toHaveLength(2);
    verificarLimpio(e);
  });

  test('si ya les había llegado a todas: lo dice, sin "Enviado a 0"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    e.rpc.enviar_pedido_app = () => 0;
    await abrirElegir(page, SOL_UNO);
    await tilde(page, ID.nCarla).check();
    await botonEnviar(page).click();
    await expect(page.locator('.toaststack .toast', { hasText: 'Ya les había llegado a todas las tildadas.' })).toBeVisible();
    verificarLimpio(e);
  });

  test('si no se pudo guardar el precio tildado, lo mandado queda y se avisa qué faltó', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await tilde(page, ID.nCarla).check();
    await page.locator(`#pedido-precio-${ID.nCarla}`).fill('310');
    e.fallar = ({ tabla, metodo }) => (tabla === 'precios_ninera_familia' && metodo === 'POST' ? { status: 500, message: 'falla simulada' } : undefined);
    await botonEnviar(page).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    await expect(page.locator('.toaststack .toast.bad', { hasText: 'Se mandó, pero no el precio de Carla Ejemplo con esta familia' })).toBeVisible();
    expect(envios(e)).toHaveLength(1);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('un precio vacío o en 0 no se manda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await tilde(page, ID.nCarla).check();
    await page.locator(`#pedido-precio-${ID.nCarla}`).fill('0');
    await botonEnviar(page).click();
    await expect(warnEnvio(page)).toContainText('Falta el precio por hora de Carla Ejemplo.');
    expect(envios(e)).toEqual([]);
    verificarLimpio(e);
  });
});

test.describe('Elegir niñeras: cuando no se puede mandar', () => {
  const CASOS = [
    ['cerrado', 'No se mandó: mientras elegías, alguien asignó o canceló este pedido. Cerrá para ver cómo quedó.'],
    ['ninera_sin_app', 'Carla Ejemplo ya no puede recibir pedidos por la app: destildala.'],
    ['ninera_inactiva', 'Carla Ejemplo ya no puede recibir pedidos por la app: destildala.'],
    ['ninera_solo_traslados', 'Carla Ejemplo ya no puede recibir pedidos por la app: destildala.'],
    ['sin_chicos', 'Faltan los chicos de la familia: cargalos en su ficha.'],
    ['practica_mezclada', 'Hay niñeras reales tildadas junto con una de práctica.'],
    ['solo_practica', 'Por ahora, por la app solo se mandan pedidos de práctica. Para este, usá "Asignar" o WhatsApp.'],
    ['pasado', 'Este pedido es de un día que ya pasó.'],
  ];
  test('cada error de la base con su texto; nada guardado y lo tildado sigue tildado', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await tilde(page, ID.nCarla).check();
    await page.locator(`#pedido-precio-${ID.nCarla}`).fill('310'); // con la casilla tildada
    await expect(page.locator(`#pedido-guardar-precio-${ID.nCarla}`)).toBeChecked();
    for (const [codigo, texto] of CASOS) {
      e.rpc.enviar_pedido_app = () => { throw errorRpc(codigo, { hint: 'Carla Ejemplo' }); };
      await botonEnviar(page).click();
      await expect(warnEnvio(page)).toHaveText(texto);
      await expect(tilde(page, ID.nCarla)).toBeChecked();
    }
    e.rpc.enviar_pedido_app = () => { throw errorRpc('Could not find the function public.enviar_pedido_app in the schema cache', { status: 404, code: 'PGRST202' }); };
    await botonEnviar(page).click();
    await expect(warnEnvio(page)).toHaveText('Falta actualizar la base para mandar por la app: avisale a Diego.');
    e.fallar = ({ tabla }) => (tabla === 'rpc/enviar_pedido_app' ? { status: 500, message: 'falla simulada' } : undefined);
    await botonEnviar(page).click();
    await expect(warnEnvio(page)).toHaveText('Error de conexión con la base: falla simulada');
    expect(escrituras(e, 'precios_ninera_familia')).toEqual([]);
    expect(e.db.solicitud_ninieras.filter(s => s.solicitud_id === SOL_UNO)).toEqual([]);
    await expect(page.locator('#editmodal .pedido-elegir')).toBeVisible();
    verificarLimpio(e, { ignorar: [RUIDO_4XX, /status of 500/] });
  });

  test('dos admins: si otra lo asignó mientras se elegía, la base dice "cerrado" y no se manda nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await tilde(page, ID.nCarla).check();
    e.db.solicitudes.find(s => s.id === SOL_UNO).estado = 'confirmada';
    await botonEnviar(page).click();
    await expect(warnEnvio(page)).toContainText('alguien asignó o canceló este pedido');
    expect(e.db.solicitud_ninieras.filter(s => s.solicitud_id === SOL_UNO)).toEqual([]);
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('doble toque en "Enviar": una sola llamada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await tilde(page, ID.nCarla).check();
    e.demoraEscrituras = 400;
    await botonEnviar(page).dblclick();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(envios(e)).toHaveLength(1);
    verificarLimpio(e);
  });

  test('práctica mezclada con una real: avisa y no llama', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirElegir(page, SOL_PRACTICA);
    // Con la familia de práctica solo la niñera de práctica tiene casilla.
    await expect(tilde(page, ID.nCarla)).toHaveCount(0);
    await tilde(page, ID.nPractica).check();
    // Si una real quedara tildada igual (la pantalla no lo deja, la base tampoco), no sigue.
    await page.evaluate(id => tildarNineraPedido(id, true), ID.nCarla);
    await expect(page.locator('#editmodal .warnbox', { hasText: 'Hay niñeras reales tildadas junto con una de práctica.' })).toBeVisible();
    await botonEnviar(page).click();
    expect(envios(e)).toEqual([]);
    await page.evaluate(id => tildarNineraPedido(id, false), ID.nCarla);
    await botonEnviar(page).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(envios(e)[0].cuerpo).toEqual({ p_solicitud_id: SOL_PRACTICA, p_envios: [{ ninera_id: ID.nPractica, precio_hora: 250 }] });
    verificarLimpio(e);
  });

  test('con solo práctica (lo normal hoy) un pedido real no tiene casillas y lo explica', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirElegir(page, SOL_UNO);
    await expect(page.locator('#editmodal .pedido-tilde')).toHaveCount(0);
    await expect(page.locator('#editmodal')).toContainText('Por ahora, por la app solo se mandan pedidos de práctica. Para este, usá "Asignar" o WhatsApp.');
    await expect(botonEnviar(page)).toHaveCount(0);
    verificarLimpio(e);
  });

  test('familia sin chicos cargados: lo avisa y "Enviar" queda en gris', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_DOS);
    await expect(page.locator('#editmodal')).toContainText('Faltan los chicos de la familia: cargalos en su ficha.');
    await tilde(page, ID.nCarla).check();
    await expect(botonEnviar(page)).toBeDisabled();
    verificarLimpio(e);
  });

  test('pedido de una familia que no está en la lista: lo avisa y "Enviar" queda en gris', async ({ page }) => {
    const d = datos();
    Object.assign(d.solicitudes.find(s => s.id === SOL_UNO), { familia_id: null, familia_nombre: 'Familia Sin Ficha' });
    const e = await abrirApp(page, { datos: d });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await expect(page.locator('#editmodal')).toContainText('Este pedido no tiene una familia de la lista: para mandarlo por la app, la familia tiene que estar cargada.');
    await tilde(page, ID.nCarla).check();
    await expect(botonEnviar(page)).toBeDisabled();
    expect(escrituras(e, 'rpc/sugeridas_datos')[0].cuerpo).toEqual({ p_familia_id: null, p_familia_nombre: 'Familia Sin Ficha', p_fecha: '2026-10-06' });
    verificarLimpio(e);
  });

  test('dudas del ticket sin resolver: "Enviar" en gris hasta "Ya lo confirmé"', async ({ page }) => {
    const d = datos();
    d.pedidos_whatsapp = [{ id: '97000000-0000-4000-8000-000000000001', creado_el: '2026-10-04T14:00:00Z', creado_por: 'Prueba', texto: 'Hola', estado: 'confirmado', tipo: 'pedido_nuevo', familia_id: ID.fPractica, solicitud_id: SOL_PRACTICA, dudas: ['No queda claro si hay que dar de cenar.', 'No dice <b>la hora</b> de "fin".'] }];
    const e = await abrirApp(page, { datos: d });
    await abrirElegir(page, SOL_PRACTICA);
    const dudas = page.locator('#pedido-dudas');
    await expect(dudas).toContainText('A confirmar: No queda claro si hay que dar de cenar.');
    await expect(dudas).toContainText('No dice <b>la hora</b> de "fin".'); // como texto
    await tilde(page, ID.nPractica).check();
    await expect(botonEnviar(page)).toBeDisabled();
    await dudas.locator('button', { hasText: 'Ya lo confirmé' }).first().click();
    await expect(dudas).not.toContainText('dar de cenar');
    expect(escrituras(e, 'pedidos_whatsapp', 'PATCH')[0].cuerpo).toEqual({ dudas: ['No dice <b>la hora</b> de "fin".'] });
    await expect(botonEnviar(page)).toBeDisabled();
    await dudas.locator('button', { hasText: 'Mandar igual' }).click();
    await expect(dudas).toBeEmpty();
    expect(escrituras(e, 'pedidos_whatsapp', 'PATCH')[1].cuerpo).toEqual({ dudas: [] });
    await expect(botonEnviar(page)).toBeEnabled();
    await botonEnviar(page).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(envios(e)).toHaveLength(1);
    verificarLimpio(e);
  });

  test('si no se pudieron leer las dudas, no deja mandar (puede haber alguna sin resolver)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await page.route(/rest\/v1\/pedidos_whatsapp/, r => r.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }));
    await abrirElegir(page, SOL_PRACTICA);
    await expect(page.locator('#pedido-dudas')).toContainText('No se pudieron leer las dudas del pedido');
    await tilde(page, ID.nPractica).check();
    await expect(botonEnviar(page)).toBeDisabled();
    // "Asignar" sigue andando.
    await fila(page, ID.nPractica).locator('input[name="agenda-asignar-ninera"]').check();
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('750');
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('si no se pudo sacar la duda, sigue ahí y "Enviar" sigue en gris', async ({ page }) => {
    const d = datos();
    d.pedidos_whatsapp = [{ id: '97000000-0000-4000-8000-000000000001', creado_el: '2026-10-04T14:00:00Z', creado_por: 'Prueba', texto: 'Hola', estado: 'confirmado', tipo: 'pedido_nuevo', familia_id: ID.fPractica, solicitud_id: SOL_PRACTICA, dudas: ['No queda claro si hay que dar de cenar.'] }];
    const e = await abrirApp(page, { datos: d });
    await abrirElegir(page, SOL_PRACTICA);
    await tilde(page, ID.nPractica).check();
    e.fallar = ({ tabla }) => (tabla === 'pedidos_whatsapp' ? { status: 500, message: 'falla simulada' } : undefined);
    await page.locator('#pedido-dudas button', { hasText: 'Ya lo confirmé' }).click();
    await expect(page.locator('#pedido-dudas')).toContainText('falla simulada');
    await expect(page.locator('#pedido-dudas')).toContainText('dar de cenar');
    await expect(botonEnviar(page)).toBeDisabled();
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });
});

test.describe('Elegir niñeras: familia que no acepta nuevas', () => {
  test('solo las que ya fueron, con el aviso y "Mostrar las que nunca fueron"', async ({ page }) => {
    const d = datos();
    d.familias.find(f => f.id === ID.fUno).solo_conocidas = true;
    const e = await abrirApp(page, { datos: d });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await expect(page.locator('#editmodal')).toContainText('Esta familia no acepta niñeras nuevas.');
    await expect(fila(page, ID.nAna)).toBeVisible();
    await expect(fila(page, ID.nCarla)).toHaveCount(0);
    await page.locator('#editmodal button', { hasText: 'Mostrar las que nunca fueron' }).click();
    await expect(fila(page, ID.nCarla)).toBeVisible();
    await expect(page.locator('#editmodal button', { hasText: 'Mostrar las que nunca fueron' })).toHaveCount(0);
    await tilde(page, ID.nCarla).check();
    await expect(botonEnviar(page)).toHaveText('Enviar a 1 por la app');
    verificarLimpio(e);
  });
});

test.describe('Elegir niñeras: "Asignar" como siempre', () => {
  test('a una sin la app: confirmada y el registro, con su pago', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirElegir(page, SOL_UNO);
    await fila(page, ID.nAna).locator('input[name="agenda-asignar-ninera"]').check();
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('750'); // 3 h a $250, la tarifa
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'solicitud_ninieras', 'POST')[0].cuerpo).toEqual({ solicitud_id: SOL_UNO, ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', estado: 'confirmada', pago_ninera: 750 });
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nAna, pago_ninera: 750, fecha: '2026-10-06' });
    expect(e.db.solicitudes.find(s => s.id === SOL_UNO).estado).toBe('confirmada');
    verificarLimpio(e);
  });

  test('a la que dijo "Puedo": su fila de la app pasa a confirmada con lo que se le ofreció', async ({ page }) => {
    const d = datos();
    const SN = 'a7000000-0000-4000-8000-000000000021';
    d.solicitudes.find(s => s.id === SOL_PRACTICA).estado = 'pendiente_confirmar';
    d.solicitud_ninieras.push({ id: SN, solicitud_id: SOL_PRACTICA, ninera_id: ID.nPractica, ninera_nombre: 'Niñera (práctica)', pago_ninera: null, estado: 'acepto', created_at: '2026-10-04T13:00:00Z', origen: 'app', precio_hora: 320, enviado_en: '2026-10-04T13:00:00Z', respondido_en: '2026-10-04T13:05:00Z', motivo_no: null, motivo_texto: null });
    const e = await abrirApp(page, { datos: d });
    await abrirElegir(page, SOL_PRACTICA);
    await expect(fila(page, ID.nPractica)).toContainText('Puede');
    await expect(tilde(page, ID.nPractica)).toHaveCount(0); // ya se le mandó
    await fila(page, ID.nPractica).locator('input[name="agenda-asignar-ninera"]').check();
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('960'); // 3 h a los $320 que se le ofrecieron
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'solicitud_ninieras', 'POST')).toEqual([]);
    const [w] = escrituras(e, 'solicitud_ninieras', 'PATCH');
    expect(w.cuerpo).toEqual({ estado: 'confirmada', pago_ninera: 960 });
    expect(w.params).toMatchObject({ id: `eq.${SN}`, estado: 'eq.acepto' });
    expect(e.db.solicitud_ninieras.find(x => x.id === SN).estado).toBe('confirmada');
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nPractica, pago_ninera: 960 });
    verificarLimpio(e);
  });

  test('si la respuesta de esa niñera cambió mientras se elegía, no asigna y el pedido vuelve a como estaba', async ({ page }) => {
    const d = datos();
    const SN = 'a7000000-0000-4000-8000-000000000021';
    d.solicitudes.find(s => s.id === SOL_PRACTICA).estado = 'pendiente_confirmar';
    d.solicitud_ninieras.push({ id: SN, solicitud_id: SOL_PRACTICA, ninera_id: ID.nPractica, ninera_nombre: 'Niñera (práctica)', pago_ninera: null, estado: 'acepto', created_at: '2026-10-04T13:00:00Z', origen: 'app', precio_hora: 320, enviado_en: '2026-10-04T13:00:00Z', respondido_en: '2026-10-04T13:05:00Z', motivo_no: null, motivo_texto: null });
    const e = await abrirApp(page, { datos: d });
    await abrirElegir(page, SOL_PRACTICA);
    await fila(page, ID.nPractica).locator('input[name="agenda-asignar-ninera"]').check();
    e.db.solicitud_ninieras.find(x => x.id === SN).estado = 'no_puedo';
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(page.locator('#agenda-asignar-warn')).toContainText('La respuesta de Niñera (práctica) cambió mientras elegías');
    expect(e.db.solicitudes.find(s => s.id === SOL_PRACTICA).estado).toBe('pendiente_confirmar');
    expect(escrituras(e, 'sittings_traslados', 'POST')).toEqual([]);
    verificarLimpio(e);
  });

  test('las ya mandadas aparecen en su lugar con su estado', async ({ page }) => {
    const d = datos({ noPuede: false });
    d.solicitudes.find(s => s.id === SOL_UNO).estado = 'pendiente_confirmar';
    const sn = (id, ninera, nombre, estado) => ({ id, solicitud_id: SOL_UNO, ninera_id: ninera, ninera_nombre: nombre, pago_ninera: null, estado, created_at: '2026-10-04T13:00:00Z', origen: 'app', precio_hora: 300, enviado_en: '2026-10-04T13:00:00Z', respondido_en: null, motivo_no: null, motivo_texto: null });
    d.solicitud_ninieras.push(sn('a7000000-0000-4000-8000-000000000031', ID.nCarla, 'Carla Ejemplo', 'invitada'), sn('a7000000-0000-4000-8000-000000000032', DORA, 'Dora Inventada', 'no_puedo'));
    const e = await abrirApp(page, { datos: d });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await expect(fila(page, ID.nCarla)).toContainText('Sin responder');
    await expect(fila(page, DORA)).toContainText('No puede');
    await expect(tilde(page, ID.nCarla)).toHaveCount(0);
    await expect(page.locator('#editmodal button', { hasText: 'Marcar las 10 primeras' })).toHaveCount(0); // ya no queda a quién
    verificarLimpio(e);
  });
});

test.describe('Elegir niñeras: base sin la migración de los pedidos', () => {
  test('arma la lista con el historial de antes, sin casillas de la app, y "Asignar" anda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ noPuede: false }), baseSinMigrar: 'etapa5' });
    await abrirElegir(page, SOL_UNO);
    await expect(page.locator('#editmodal .pedido-tilde')).toHaveCount(0);
    await expect(botonEnviar(page)).toHaveCount(0);
    await expect(fila(page, ID.nCarla)).toBeVisible();
    await fila(page, ID.nCarla).locator('input[name="agenda-asignar-ninera"]').check();
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('750');
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'solicitud_ninieras', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nCarla, estado: 'confirmada', pago_ninera: 750 });
    expect(escrituras(e, 'sittings_traslados', 'POST')).toHaveLength(1);
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });
});

test.describe('Elegir niñeras: datos tramposos', () => {
  const TRAMPA = ` D'Ale"<img src=x onerror="window.__xss=1">`;
  test('el nombre de la niñera se ve como texto, nada se ejecuta y todo sigue andando', async ({ page }) => {
    const d = datos();
    d.ninieras.find(n => n.id === ID.nCarla).nombre = 'Carla Ejemplo' + TRAMPA;
    d.solicitudes.find(s => s.id === SOL_UNO).zona = `Pocitos<img src=x onerror="window.__xss=2">`;
    const e = await abrirApp(page, { datos: d });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_UNO);
    await expect(fila(page, ID.nCarla).locator('.pedido-nombre')).toHaveText('Carla Ejemplo' + TRAMPA);
    await expect(page.locator('#editmodal img')).toHaveCount(0);
    await tilde(page, ID.nCarla).check();
    await page.locator(`#pedido-precio-${ID.nCarla}`).fill('333');
    await expect(page.locator('#editmodal label', { hasText: 'Guardar como precio de Carla Ejemplo' + TRAMPA })).toBeVisible();
    e.rpc.enviar_pedido_app = () => { throw errorRpc('ninera_sin_app', { hint: 'Carla Ejemplo' + TRAMPA }); };
    await botonEnviar(page).click();
    await expect(warnEnvio(page)).toHaveText(`Carla Ejemplo${TRAMPA} ya no puede recibir pedidos por la app: destildala.`);
    await fila(page, ID.nCarla).locator('input[name="agenda-asignar-ninera"]').check();
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo' + TRAMPA });
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });
});
