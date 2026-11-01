// "Asignar" (pantalla 4), las plantillas de los mensajes para la madre y la confirmación (pantalla 5): fase 1,
// etapa 6, tarea 6.4 (03/11/2026). "Asignar" desde "Pedidos en curso" (abrirAsignarPedido) y "Guardar asignación"
// desde "Elegir niñeras" comparten la misma asignación (asignarNineraAlPedido, agenda.js): la dirección de la
// familia es obligatoria para un sitting, se toma el pedido con la condición del estado (dos admins a la vez),
// la fila de la niñera y el registro (con solicitud_id) y, al final, la confirmación para la madre con la
// plantilla editable ("Copiar", "Abrir WhatsApp", "Guardar como plantilla"). Los avisos a la niñera los manda
// la base (los triggers del simulador): el panel no manda nada.
// Datos inventados (datosEleccion): hoy es domingo 04/10/2026; sPendiente es de Familia (práctica), miércoles
// 07/10 de 18:00 a 22:00: "Niñera (práctica)" ($200) y Lola ($210) dijeron "Puedo" y Mía no respondió.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosEleccion, ID } = require('./support/datos');

const RUIDO_4XX = /status of 4\d\d/;
const RUIDO_500 = /status of 500/;
const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && (!metodo || w.metodo === metodo));
const modal = page => page.locator('#editmodal');
const pantallaAsignar = page => page.locator('#editmodal .asignar-pedido');
const botonAsignar = page => page.locator('#pedido-asignar-btn');
const warn = page => page.locator('#agenda-asignar-warn');
const mensaje = page => page.locator('#editmodal .mensaje-madre');
const texto = page => page.locator('#mensaje-madre-texto');
const linkWA = page => page.locator('#mensaje-madre-wa');
const toasts = page => page.locator('.toaststack .toast');
const TEXTO_LOLA = '¡Hola Familia! Confirmamos a la niñera Lola (práctica) el miércoles 07/10 a las 18:00.';
const wa = t => 'https://wa.me/59899000090?text=' + encodeURIComponent(t);

async function abrirAsignar(page, solicitudId = ID.sPendiente, snId = ID.snPendLola) {
  await page.evaluate(([s, sn]) => abrirAsignarPedido(s, sn), [solicitudId, snId]);
  await expect(pantallaAsignar(page)).toBeVisible();
}
async function espiarPortapapeles(page) {
  await page.evaluate(() => {
    window.__copiado = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copiado.push(t); } } });
  });
}
function soloPracticaApagado(e) {
  e.db.app_config.find(c => c.id === 'pedidos_app').valor.solo_practica = false;
}

test.describe('"Asignar" desde "Pedidos en curso" (pantalla 4)', () => {
  test('pago con lo ofrecido por las horas, quién recibe qué, y la asignación con el registro del pedido', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    await abrirAsignar(page);
    const p = pantallaAsignar(page);
    await expect(p.locator('h2')).toHaveText('Asignar');
    await expect(p).toContainText('Familia (práctica), miércoles 07/10, de 18:00 a 22:00');
    await expect(p).toContainText('Lola (práctica)');
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('840'); // 4 h a los $210 que se le ofrecieron
    await expect(p).toContainText('4 horas a $210 por hora, lo que se le ofreció.');
    await expect(page.locator('#agenda-asignar-direccion')).toHaveCount(0); // la familia ya tiene dirección
    const quien = p.locator('.asignar-quien');
    await expect(quien).toContainText('A Lola (práctica) le llega "¡Quedaste seleccionada!" con los datos del sitting.');
    await expect(quien).toContainText('A Niñera (práctica) le llega que ya se cubrió.');
    await expect(quien).toContainText('A las que no respondieron no les llega nada: el pedido se les va solo.');
    expect(await p.textContent()).not.toContain('·');
    await botonAsignar(page).click();
    await expect(mensaje(page)).toBeVisible();
    const [toma] = escrituras(e, 'solicitudes', 'PATCH');
    expect(toma.cuerpo).toEqual({ estado: 'confirmada' });
    expect(toma.params).toMatchObject({ id: `eq.${ID.sPendiente}`, estado: 'in.(sin_asignar,pendiente_confirmar)' });
    // La fila de la app conserva su precio_hora: solo cambia el estado y el pago.
    const [fila] = escrituras(e, 'solicitud_ninieras', 'PATCH');
    expect(fila.cuerpo).toEqual({ estado: 'confirmada', pago_ninera: 840 });
    expect(fila.params).toMatchObject({ id: `eq.${ID.snPendLola}`, estado: 'eq.acepto' });
    expect(escrituras(e, 'solicitud_ninieras', 'POST')).toEqual([]);
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({
      solicitud_id: ID.sPendiente, familia_id: ID.fPractica, ninera_id: ID.nLola, ninera_nombre: 'Lola (práctica)',
      fecha: '2026-10-07', pago_ninera: 840, notas: 'Asignado desde Agenda',
    });
    expect(e.db.solicitudes.find(s => s.id === ID.sPendiente).estado).toBe('confirmada');
    expect(e.db.solicitud_ninieras.find(x => x.id === ID.snPendLola).precio_hora).toBe(210);
    // El aviso lo mandó la base (trigger), no el panel.
    expect(e.db.avisos.filter(a => a.clave === `pedido:${ID.snPendLola}:seleccionada`)).toHaveLength(1);
    await expect(toasts(page).last()).toContainText('Asignado');
    verificarLimpio(e);
  });

  test('después, la confirmación para la madre: el texto completo, "Copiar" y "Abrir WhatsApp" con el teléfono', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    await abrirAsignar(page);
    await botonAsignar(page).click();
    await expect(mensaje(page).locator('h2')).toHaveText('Confirmación para la madre');
    await expect(mensaje(page).locator('.okbox')).toHaveText('Lola (práctica) quedó seleccionada. Ya le llegó el aviso.');
    await expect(texto(page)).toHaveValue(TEXTO_LOLA);
    await expect(linkWA(page)).toHaveAttribute('href', wa(TEXTO_LOLA));
    await expect(linkWA(page)).toHaveAttribute('target', '_blank');
    await espiarPortapapeles(page);
    await mensaje(page).locator('button', { hasText: 'Copiar' }).click();
    await expect(toasts(page).last()).toContainText('Mensaje copiado');
    expect(await page.evaluate(() => window.__copiado)).toEqual([TEXTO_LOLA]);
    // Se puede cambiar antes de mandarlo: lo que se copia y el link van con lo escrito.
    const editado = TEXTO_LOLA + '\nCualquier cosa, avisame.';
    await texto(page).fill(editado);
    await expect(linkWA(page)).toHaveAttribute('href', wa(editado));
    await mensaje(page).locator('button', { hasText: 'Copiar' }).click();
    expect(await page.evaluate(() => window.__copiado)).toEqual([TEXTO_LOLA, editado]);
    expect(await mensaje(page).textContent()).not.toContain('·');
    verificarLimpio(e);
  });

  test('sin teléfono de la familia: solo "Copiar" y el aviso', async ({ page }) => {
    const d = datosEleccion();
    d.familias.find(f => f.id === ID.fPractica).telefono = null;
    const e = await abrirApp(page, { datos: d });
    await abrirAsignar(page);
    await botonAsignar(page).click();
    await expect(texto(page)).toHaveValue(TEXTO_LOLA);
    await expect(linkWA(page)).toHaveCount(0);
    await expect(mensaje(page)).toContainText('Falta el teléfono de la familia.');
    await expect(mensaje(page).locator('button', { hasText: 'Copiar' })).toBeVisible();
    verificarLimpio(e);
  });

  test('sin dirección no deja asignar; escrita, se guarda en la familia antes de asignar', async ({ page }) => {
    const d = datosEleccion();
    d.familias.find(f => f.id === ID.fPractica).direccion = null;
    const e = await abrirApp(page, { datos: d });
    await abrirAsignar(page);
    await expect(page.locator('#agenda-asignar-direccion')).toBeVisible();
    await botonAsignar(page).click();
    await expect(warn(page)).toContainText('Falta la dirección de la familia.');
    expect(e.escrituras).toEqual([]);
    await page.fill('#agenda-asignar-direccion', '  Calle Nueva 45  ');
    await botonAsignar(page).click();
    await expect(mensaje(page)).toBeVisible();
    const [dir] = escrituras(e, 'familias', 'PATCH');
    expect(dir.cuerpo).toEqual({ direccion: 'Calle Nueva 45' });
    expect(dir.params).toMatchObject({ id: `eq.${ID.fPractica}` });
    // Primero la dirección, después el pedido.
    expect(e.escrituras.findIndex(w => w.tabla === 'familias')).toBeLessThan(e.escrituras.findIndex(w => w.tabla === 'solicitudes'));
    expect(e.db.familias.find(f => f.id === ID.fPractica).direccion).toBe('Calle Nueva 45');
    expect(e.db.solicitudes.find(s => s.id === ID.sPendiente).estado).toBe('confirmada');
    verificarLimpio(e);
  });

  test('si falla guardar la dirección, no se asigna nada', async ({ page }) => {
    const d = datosEleccion();
    d.familias.find(f => f.id === ID.fPractica).direccion = '';
    const e = await abrirApp(page, { datos: d });
    await abrirAsignar(page);
    await page.fill('#agenda-asignar-direccion', 'Calle Nueva 45');
    e.fallar = ({ tabla, metodo }) => (tabla === 'familias' && metodo === 'PATCH' ? { status: 500, message: 'falla simulada' } : undefined);
    await botonAsignar(page).click();
    await expect(warn(page)).toContainText('falla simulada');
    await expect(warn(page)).toContainText('No se asignó.');
    expect(escrituras(e, 'solicitudes')).toEqual([]);
    expect(escrituras(e, 'solicitud_ninieras')).toEqual([]);
    expect(escrituras(e, 'sittings_traslados')).toEqual([]);
    expect(e.db.solicitudes.find(s => s.id === ID.sPendiente).estado).toBe('pendiente_confirmar');
    await expect(pantallaAsignar(page)).toBeVisible();
    verificarLimpio(e, { ignorar: [RUIDO_500] });
  });

  test('dos admins: si otra ya lo asignó mientras se miraba, avisa y no carga nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    await abrirAsignar(page);
    e.db.solicitudes.find(s => s.id === ID.sPendiente).estado = 'confirmada';
    await botonAsignar(page).click();
    await expect(warn(page)).toContainText('alguien más ya asignó este pedido');
    expect(escrituras(e, 'solicitud_ninieras')).toEqual([]);
    expect(escrituras(e, 'sittings_traslados')).toEqual([]);
    expect(e.db.avisos.filter(a => a.clave.startsWith('pedido:'))).toEqual([]);
    verificarLimpio(e);
  });

  test('"Quién recibe qué" no promete avisos que la base no manda (solo_practica con una familia real, niñera sin app)', async ({ page }) => {
    const d = datosEleccion();
    // El mismo pedido, pero de una familia real: con solo_practica prendido la base no avisa a nadie.
    Object.assign(d.solicitudes.find(s => s.id === ID.sPendiente), { familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno' });
    const e = await abrirApp(page, { datos: d });
    await abrirAsignar(page);
    const quien = pantallaAsignar(page).locator('.asignar-quien');
    await expect(quien).toContainText('A Lola (práctica) no le llega aviso por la app: avisale por WhatsApp.');
    await expect(quien).toContainText('Niñera (práctica) dijo "Puedo" y no le llega aviso por la app: avisale por WhatsApp.');
    await expect(quien).not.toContainText('¡Quedaste seleccionada!');
    // Sin la app (lo arreglaron por WhatsApp): lo dice.
    e.db.ninieras.find(n => n.id === ID.nLola).user_id = null;
    await abrirAsignar(page);
    await expect(quien).toContainText('Lola (práctica) no tiene la app: avisale por WhatsApp.');
    verificarLimpio(e);
  });

  test('un pedido que ya no está abierto: lo dice y no ofrece asignar', async ({ page }) => {
    const d = datosEleccion();
    d.solicitudes.find(s => s.id === ID.sPendiente).estado = 'cancelada';
    const e = await abrirApp(page, { datos: d });
    await abrirAsignar(page);
    await expect(pantallaAsignar(page)).toContainText('Este pedido ya no está abierto');
    await expect(botonAsignar(page)).toHaveCount(0);
    verificarLimpio(e);
  });

  test('doble toque: un solo pedido tomado, una sola fila y un solo registro', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    await abrirAsignar(page);
    e.demoraEscrituras = 400;
    await botonAsignar(page).dblclick();
    await expect(mensaje(page)).toBeVisible();
    expect(escrituras(e, 'solicitudes', 'PATCH')).toHaveLength(1);
    expect(escrituras(e, 'solicitud_ninieras', 'PATCH')).toHaveLength(1);
    expect(escrituras(e, 'sittings_traslados', 'POST')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('si falla la fila de la niñera, el pedido vuelve atrás y no sale ningún aviso', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    await abrirAsignar(page);
    e.fallar = ({ tabla, metodo }) => (tabla === 'solicitud_ninieras' && metodo === 'PATCH' ? { status: 500, message: 'falla simulada' } : undefined);
    await botonAsignar(page).click();
    await expect(warn(page)).toContainText('falla simulada');
    expect(e.db.solicitudes.find(s => s.id === ID.sPendiente).estado).toBe('pendiente_confirmar');
    expect(escrituras(e, 'sittings_traslados')).toEqual([]);
    expect(e.db.avisos.filter(a => a.clave.startsWith('pedido:'))).toEqual([]);
    await expect(mensaje(page)).toHaveCount(0);
    verificarLimpio(e, { ignorar: [RUIDO_500] });
  });

  test('si falla el registro, queda asignada, el aviso dice qué faltó y sale igual la confirmación', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    await abrirAsignar(page);
    e.fallar = ({ tabla, metodo }) => (tabla === 'sittings_traslados' && metodo === 'POST' ? { status: 500, message: 'falla simulada' } : undefined);
    await botonAsignar(page).click();
    await expect(toasts(page).filter({ hasText: 'Quedó asignado, pero no se pudo cargar en Sittings & traslados' })).toBeVisible();
    await expect(mensaje(page).locator('.okbox')).toHaveText('Lola (práctica) quedó seleccionada. Ya le llegó el aviso.');
    expect(e.db.solicitudes.find(s => s.id === ID.sPendiente).estado).toBe('confirmada');
    verificarLimpio(e, { ignorar: [RUIDO_500] });
  });

  test('datos tramposos: el nombre de la madre y el de la niñera se ven como texto y nada se ejecuta', async ({ page }) => {
    const d = datosEleccion();
    const MADRE = `D'Ale"<img src=x onerror="window.__xss=1">`;
    const LOLA = `Lola<img src=x onerror="window.__xss=2"> (práctica)`;
    d.familias.find(f => f.id === ID.fPractica).nombre = `${MADRE} (práctica)`;
    d.ninieras.find(n => n.id === ID.nLola).nombre = LOLA;
    d.solicitud_ninieras.find(x => x.id === ID.snPendLola).ninera_nombre = LOLA;
    const e = await abrirApp(page, { datos: d });
    await abrirAsignar(page);
    await expect(pantallaAsignar(page)).toContainText(LOLA);
    await expect(page.locator('#editmodal img')).toHaveCount(0);
    await botonAsignar(page).click();
    await expect(mensaje(page).locator('.okbox')).toHaveText(`${LOLA} quedó seleccionada. Ya le llegó el aviso.`);
    // La madre es la primera palabra del nombre de la familia, tal cual.
    const esperado = `¡Hola D'Ale"<img! Confirmamos a la niñera ${LOLA} el miércoles 07/10 a las 18:00.`;
    await expect(texto(page)).toHaveValue(esperado);
    await expect(linkWA(page)).toHaveAttribute('href', wa(esperado));
    await expect(page.locator('#editmodal img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });

  test('base sin la migración de la etapa 6: el registro se guarda sin solicitud_id y la confirmación no promete el aviso', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion(), baseSinMigrar: 'etapa6' });
    await abrirAsignar(page);
    await botonAsignar(page).click();
    await expect(mensaje(page).locator('.okbox')).toHaveText('Lola (práctica) quedó asignada.');
    // El primer intento (con solicitud_id) lo rechaza la base con PGRST204 y no queda anotado: se anota el reintento.
    const registros = escrituras(e, 'sittings_traslados', 'POST');
    expect(registros).toHaveLength(1);
    expect(registros[0].cuerpo).not.toHaveProperty('solicitud_id');
    expect(registros[0].cuerpo).toMatchObject({ ninera_id: ID.nLola, pago_ninera: 840 });
    expect(e.db.sittings_traslados.filter(r => r.ninera_id === ID.nLola)).toHaveLength(1);
    await expect(texto(page)).toHaveValue(TEXTO_LOLA); // la plantilla por defecto
    await expect(toasts(page).filter({ hasText: 'Asignado' }).first()).toBeVisible();
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  for (const [ancho, alto] of [[390, 844], [1280, 800]]) {
    test(`a ${ancho} px: la pantalla y la confirmación entran sin scroll de costado`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      const d = datosEleccion();
      d.familias.find(f => f.id === ID.fPractica).direccion = null;
      const e = await abrirApp(page, { datos: d });
      await abrirAsignar(page);
      const sinScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(await sinScroll()).toBe(true);
      await expect(page.locator('#agenda-asignar-direccion')).toBeVisible();
      await page.fill('#agenda-asignar-direccion', 'Calle Nueva 45');
      await expect(botonAsignar(page)).toBeInViewport();
      await page.screenshot({ path: test.info().outputPath(`asignar-${ancho}.png`) });
      await botonAsignar(page).click();
      await expect(mensaje(page)).toBeVisible();
      expect(await sinScroll()).toBe(true);
      await expect(mensaje(page).locator('button', { hasText: 'Copiar' })).toBeVisible();
      await expect(linkWA(page)).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`confirmacion-${ancho}.png`) });
      verificarLimpio(e);
    });
  }
});

test.describe('"Guardar como plantilla"', () => {
  async function confirmacionDeLola(page) {
    await abrirAsignar(page);
    await botonAsignar(page).click();
    await expect(texto(page)).toHaveValue(TEXTO_LOLA);
  }
  const EDITADO = '¡Hola Familia! Te confirmo a Lola (práctica) para el miércoles 07/10 a las 18:00.\nCualquier cosa, avisame.';
  const MODELO = '¡Hola [madre]! Te confirmo a [niñera] para el [día] a las [hora inicio].\nCualquier cosa, avisame.';

  test('muestra el modelo con corchetes, lo guarda para las tres y se usa la próxima vez', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    await confirmacionDeLola(page);
    await texto(page).fill(EDITADO);
    await mensaje(page).locator('button', { hasText: 'Guardar como plantilla' }).click();
    const modelo = page.locator('#mensaje-madre-modelo');
    await expect(modelo.locator('.mensaje-madre-modelo-texto')).toHaveText(MODELO);
    await expect(modelo).toContainText('La próxima vez va a salir así. Lo que está entre corchetes se completa solo.');
    await expect(modelo).toContainText('Cambia el mensaje de las tres admins.');
    expect(escrituras(e, 'app_config')).toEqual([]); // todavía no guardó nada
    await modelo.locator('button', { hasText: 'Guardar plantilla' }).click();
    await expect(toasts(page).last()).toContainText('Plantilla guardada');
    const [w] = escrituras(e, 'app_config', 'POST');
    expect(w.cuerpo).toMatchObject({ id: 'plantilla_confirmacion', valor: { texto: MODELO } });
    expect(w.params).toMatchObject({ on_conflict: 'id' });
    expect(e.db.app_config.find(c => c.id === 'plantilla_confirmacion').valor).toEqual({ texto: MODELO });
    await expect(texto(page)).toHaveValue(EDITADO); // lo escrito queda para copiar
    // La próxima vez (otro pedido, otra niñera), sale con el modelo nuevo.
    await page.evaluate(([s, n]) => abrirConfirmacionMadre(s, n), [ID.sPedida, 'Niñera (práctica)']);
    await expect(texto(page)).toHaveValue('¡Hola Familia! Te confirmo a Niñera (práctica) para el jueves 08/10 a las 18:00.\nCualquier cosa, avisame.');
    // Guardarla otra vez actualiza la misma fila.
    await mensaje(page).locator('button', { hasText: 'Guardar como plantilla' }).click();
    await page.locator('#mensaje-madre-modelo button', { hasText: 'Guardar plantilla' }).click();
    await expect(toasts(page).last()).toContainText('Plantilla guardada');
    expect(e.db.app_config.filter(c => c.id === 'plantilla_confirmacion')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('"Volver" no guarda nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    await confirmacionDeLola(page);
    await mensaje(page).locator('button', { hasText: 'Guardar como plantilla' }).click();
    await page.locator('#mensaje-madre-modelo button', { hasText: 'Volver' }).click();
    await expect(page.locator('#mensaje-madre-modelo')).toBeHidden();
    expect(escrituras(e, 'app_config')).toEqual([]);
    verificarLimpio(e);
  });

  test('si falla guardar la plantilla, lo dice y no cambia nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    await confirmacionDeLola(page);
    await texto(page).fill(EDITADO);
    await mensaje(page).locator('button', { hasText: 'Guardar como plantilla' }).click();
    e.fallar = ({ tabla, metodo }) => (tabla === 'app_config' && metodo === 'POST' ? { status: 500, message: 'falla simulada' } : undefined);
    await page.locator('#mensaje-madre-modelo button', { hasText: 'Guardar plantilla' }).click();
    await expect(page.locator('#mensaje-madre-warn')).toContainText('No se pudo guardar la plantilla');
    await expect(page.locator('#mensaje-madre-warn')).toContainText('falla simulada');
    await expect(page.locator('#mensaje-madre-modelo')).toBeVisible();
    expect(e.db.app_config.find(c => c.id === 'plantilla_confirmacion')).toBeUndefined();
    verificarLimpio(e, { ignorar: [RUIDO_500] });
  });

  test('si no se puede leer la plantilla guardada, sale la de siempre', async ({ page }) => {
    const d = datosEleccion();
    d.app_config.push({ id: 'plantilla_confirmacion', valor: { texto: 'Otra [madre]' }, actualizado_at: '2026-10-01T12:00:00Z' });
    const e = await abrirApp(page, { datos: d });
    await abrirAsignar(page);
    await page.route(/app_config.*plantilla_confirmacion/, r => r.request().method() === 'GET'
      ? r.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }) : r.fallback());
    await botonAsignar(page).click();
    await expect(texto(page)).toHaveValue(TEXTO_LOLA);
    verificarLimpio(e, { ignorar: [RUIDO_500] });
  });

  test('un dato que falta queda entre corchetes con el aviso, y no deja copiar hasta completarlo', async ({ page }) => {
    const d = datosEleccion();
    d.app_config.push({ id: 'plantilla_confirmacion', valor: { texto: '¡Hola [madre]! [niñera] va el [día] a las [hora inicio]. [algo]' }, actualizado_at: '2026-10-01T12:00:00Z' });
    const e = await abrirApp(page, { datos: d });
    await page.evaluate(([s]) => abrirConfirmacionMadre(s, ''), [ID.sPendiente]);
    await expect(texto(page)).toHaveValue('¡Hola Familia! [niñera] va el miércoles 07/10 a las 18:00. [algo]');
    await expect(page.locator('#mensaje-madre-falta')).toHaveText('Falta la niñera para completar el mensaje.');
    await espiarPortapapeles(page);
    await mensaje(page).locator('button', { hasText: 'Copiar' }).click();
    expect(await page.evaluate(() => window.__copiado)).toEqual([]);
    await texto(page).fill('¡Hola Familia! Ana va el miércoles 07/10 a las 18:00.');
    await expect(page.locator('#mensaje-madre-falta')).toBeEmpty();
    await mensaje(page).locator('button', { hasText: 'Copiar' }).click();
    expect(await page.evaluate(() => window.__copiado)).toEqual(['¡Hola Familia! Ana va el miércoles 07/10 a las 18:00.']);
    verificarLimpio(e);
  });
});

test.describe('"Guardar asignación" desde "Elegir niñeras": el mismo final', () => {
  async function abrirElegir(page, solicitudId) {
    await irAModulo(page, 'agenda');
    await page.evaluate(i => abrirModalAsignar(i), solicitudId);
    await expect(page.locator('#editmodal .pedido-elegir')).toBeVisible();
    await esperarQuieta(page);
  }
  const elegir = (page, nineraId) => page.locator(`#editmodal .pedido-fila[data-id="${nineraId}"] input[name="agenda-asignar-ninera"]`).check();

  test('a una sin la app: la fila del panel lleva su precio por hora, el registro el pedido y sale la confirmación', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    await abrirElegir(page, ID.sUno);
    await elegir(page, ID.nAna);
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('750');
    await expect(page.locator('#agenda-asignar-direccion')).toHaveCount(0); // Familia Prueba Uno tiene dirección
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(mensaje(page).locator('.okbox')).toHaveText('Ana Ficticia quedó asignada.');
    await expect(texto(page)).toHaveValue('¡Hola Familia! Confirmamos a la niñera Ana Ficticia el martes 06/10 a las 20:00.');
    await expect(linkWA(page)).toHaveAttribute('href', /^https:\/\/wa\.me\/59899000001\?text=/);
    expect(escrituras(e, 'solicitud_ninieras', 'POST')[0].cuerpo).toEqual({
      solicitud_id: ID.sUno, ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', estado: 'confirmada', pago_ninera: 750, precio_hora: 250,
    });
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ solicitud_id: ID.sUno, ninera_id: ID.nAna, pago_ninera: 750 });
    verificarLimpio(e);
  });

  test('con solo_practica prendido, a una niñera real con la app no le llega nada y la confirmación no lo promete', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    await abrirElegir(page, ID.sUno);
    await elegir(page, ID.nCarla);
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(mensaje(page).locator('.okbox')).toHaveText('Carla Ejemplo quedó asignada.');
    expect(e.db.avisos.filter(a => a.clave.startsWith('pedido:'))).toEqual([]);
    verificarLimpio(e);
  });

  test('con solo_practica apagado, a la misma le llega el aviso', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    soloPracticaApagado(e);
    await abrirElegir(page, ID.sUno);
    await elegir(page, ID.nCarla);
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(mensaje(page).locator('.okbox')).toHaveText('Carla Ejemplo quedó seleccionada. Ya le llegó el aviso.');
    expect(e.db.avisos.filter(a => a.clave.endsWith(':seleccionada'))).toHaveLength(1);
    verificarLimpio(e);
  });

  test('sin dirección de la familia: la pide, no asigna sin ella y la guarda', async ({ page }) => {
    const SOL_DOS = '80000000-0000-4000-8000-000000000001'; // Familia Prueba Dos, sin dirección
    const e = await abrirApp(page, { datos: datosEleccion() });
    await abrirElegir(page, SOL_DOS);
    await page.evaluate(() => document.querySelectorAll('#editmodal details').forEach(d => { d.open = true; }));
    await elegir(page, ID.nAna);
    await expect(page.locator('#agenda-asignar-direccion')).toBeVisible();
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(warn(page)).toContainText('Falta la dirección de la familia.');
    for (const t of ['familias', 'solicitudes', 'solicitud_ninieras', 'sittings_traslados']) expect(escrituras(e, t)).toEqual([]);
    await page.fill('#agenda-asignar-direccion', 'Calle Nueva 45');
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(mensaje(page)).toBeVisible();
    expect(e.db.familias.find(f => f.id === ID.fDos).direccion).toBe('Calle Nueva 45');
    expect(e.db.solicitudes.find(s => s.id === SOL_DOS).estado).toBe('confirmada');
    verificarLimpio(e);
  });

  test('un traslado no pide dirección ni lleva precio por hora', async ({ page }) => {
    const d = datosEleccion();
    const SOL_DOS = '80000000-0000-4000-8000-000000000001';
    Object.assign(d.solicitudes.find(s => s.id === SOL_DOS), { tipo: 'traslado', hora_fin: null, cobro_familia: 450 });
    const e = await abrirApp(page, { datos: d });
    await abrirElegir(page, SOL_DOS);
    await page.evaluate(() => document.querySelectorAll('#editmodal details').forEach(d => { d.open = true; }));
    await elegir(page, ID.nBruno);
    await expect(page.locator('#agenda-asignar-direccion')).toHaveCount(0);
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(mensaje(page)).toBeVisible();
    expect(escrituras(e, 'solicitud_ninieras', 'POST')[0].cuerpo).not.toHaveProperty('precio_hora');
    verificarLimpio(e);
  });
});
