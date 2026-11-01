// App de niñeras (fase 1, etapa 5, tarea 5.7, 02/11/2026): "Pedidos por responder", "Esperando confirmación",
// "Puedo" / "No puedo" (con el motivo y los días que no puede) y abrir un pedido desde un push
// (#pedido/<id>). Todo contra el simulador. Hoy en el simulador es el domingo 04/10/2026 a las 12:00 de
// Montevideo. La niñera de los tests es "Niñera (práctica)"; su pedido es de "Familia (práctica)" (la
// niñera nunca ve ese nombre) para el martes 06/10, de 20:00 a 23:00, en Pocitos, a $1.250 la hora.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { ID, datosPedidos } = require('./support/datos');

const SOL = ID.sPractica;
const SN = '81000000-0000-4000-8000-0000000000a1';
const SN2 = '81000000-0000-4000-8000-0000000000a2';
const RESPONDER_HASTA = '2026-10-04T15:30:00.000Z'; // 12:30 en Montevideo: todavía falta
const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[pedidos\]|\[responder_pedido\]|\[no_disponible\]|\[marcar_no_disponible\]/];
const RUIDO_SIN_MIGRAR = [/Failed to load resource: the server responded with a status of 404/];
const SIN_PEDIDOS = 'No tienes pedidos por ahora.';
const CERRADO = 'Este pedido ya no está abierto.';
const FALLA_RESPONDER = 'No pudimos enviar tu respuesta. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_CARGAR = 'No pudimos cargar tus pedidos. Revisa tu conexión a internet y vuelve a intentar.';
const HORARIO = '20:00 – 23:00 (aproximada, se puede extender)';

function filaSn(extra = {}) {
  return { id: SN, solicitud_id: SOL, ninera_id: ID.nPractica, ninera_nombre: 'Niñera (práctica)', pago_ninera: null, estado: 'invitada', created_at: '2026-10-04T14:50:00Z',
    origen: 'app', precio_hora: 1250, enviado_en: '2026-10-04T14:50:00.000Z', respondido_en: null, motivo_no: null, motivo_texto: null, ...extra };
}
// Los datos con un pedido enviado a la niñera de práctica (como lo deja enviar_pedido_app).
function datos({ sn = {}, solicitud = {}, extraSn = [] } = {}) {
  const d = datosPedidos();
  Object.assign(d.solicitudes.find(s => s.id === SOL), { estado: 'pendiente_confirmar', horario_aproximado: true, responder_hasta: RESPONDER_HASTA, enviado_app_en: '2026-10-04T14:50:00.000Z', ...solicitud });
  d.solicitud_ninieras.push(filaSn(sn), ...extraSn);
  d.ninieras.filter(n => n.id === ID.nPractica).forEach(n => Object.assign(n, { perfil_app_en: '2026-10-02T15:00:00+00:00', app_activada_en: '2026-10-02T14:00:00+00:00' }));
  return d;
}
async function abrir(page, opciones = {}) {
  await page.addInitScript(() => { delete window.PushManager; });
  return abrirAppNinera(page, { ninera: ID.nPractica, datos: datos(), ...opciones });
}
function rpcs(e, nombre) { return e.escrituras.filter(w => w.tabla === `rpc/${nombre}`).map(w => w.cuerpo); }
const tarjeta = (page, id = SN) => page.locator(`#pedido-${id}`);
const porResponder = page => page.locator('#pedidos-por-responder');
const esperando = page => page.locator('#pedidos-esperando');
const boton = (page, nombre) => page.getByRole('button', { name: nombre, exact: true });

test.describe('pedidos por responder', () => {
  test('la tarjeta con los textos de textos.md, sin la familia ni la dirección ni plata fuera del precio por hora', async ({ page }) => {
    const e = await abrir(page);
    await expect(porResponder(page).locator('h2')).toHaveText('Pedidos por responder');
    const t = tarjeta(page);
    await expect(t).toBeVisible();
    await expect(t.locator('.pedido-limite')).toHaveText('Responde antes de las 12:30');
    await expect(t.locator('.pedido-dia')).toHaveText('Martes 06/10');
    const lineas = await t.locator('.pedido-datos p').allTextContents();
    expect(lineas).toEqual([HORARIO, 'Zona: Pocitos', '1 chico (4 años)', 'Precio por hora: $1.250']);
    await expect(boton(page, 'Puedo')).toBeVisible();
    await expect(boton(page, 'No puedo')).toBeVisible();
    // No hay sección de "Esperando confirmación" sin pedidos aceptados.
    await expect(esperando(page)).toHaveCount(0);
    await expect(page.locator('#app')).not.toContainText(SIN_PEDIDOS);
    const texto = await page.locator('#app').innerText();
    for (const prohibido of ['Familia', 'práctica)', 'Calle Inventada', 'Aceptar no es quedar', 'La familia elige', '📍']) {
      expect(texto.replace('Niñera (práctica)', '')).not.toContain(prohibido);
    }
    // Ningún monto salvo el precio por hora.
    expect(texto.match(/\$[\d.]+/g)).toEqual(['$1.250']);
    // Va arriba de "Próximos sittings".
    const orden = await page.evaluate(() => ['#pedidos-por-responder', '#proximos-sittings'].map(s => document.querySelector(s).getBoundingClientRect().top));
    expect(orden[0]).toBeLessThan(orden[1]);
    verificarLimpio(e);
  });

  test('sin pedidos: "No tienes pedidos por ahora."', async ({ page }) => {
    const d = datosPedidos();
    d.ninieras.filter(n => n.id === ID.nPractica).forEach(n => Object.assign(n, { perfil_app_en: '2026-10-02T15:00:00+00:00' }));
    const e = await abrir(page, { datos: d });
    await expect(page.locator('#app')).toContainText(SIN_PEDIDOS);
    await expect(porResponder(page)).toHaveCount(0);
    verificarLimpio(e);
  });

  test('pasada la hora límite: "Responde lo antes posible"', async ({ page }) => {
    const e = await abrir(page, { datos: datos({ solicitud: { responder_hasta: '2026-10-04T14:00:00.000Z' } }) });
    await expect(tarjeta(page).locator('.pedido-limite')).toHaveText('Responde lo antes posible');
    await expect(boton(page, 'Puedo')).toBeEnabled();
    verificarLimpio(e);
  });

  test('sin la marca de horario aproximado, el horario va solo; con la marca, "(aproximada, se puede extender)"', async ({ page }) => {
    const d = datos({ solicitud: { horario_aproximado: false } });
    const e = await abrir(page, { datos: d });
    await expect(tarjeta(page).locator('.pedido-datos p').first()).toHaveText('20:00 – 23:00');
    Object.assign(e.db.solicitudes.find(s => s.id === SOL), { horario_aproximado: true });
    await page.reload();
    await expect(tarjeta(page).locator('.pedido-datos p').first()).toHaveText('20:00 – 23:00 (aproximada, se puede extender)');
    verificarLimpio(e);
  });

  test('sin hora de fin, que cruza la medianoche, sin chicos cargados y con la zona de la familia', async ({ page }) => {
    const d = datos({ solicitud: { hora_fin: null } });
    const e = await abrir(page, { datos: d });
    await expect(tarjeta(page).locator('.pedido-datos p').first()).toHaveText('20:00, sin hora de fin');
    Object.assign(e.db.solicitudes.find(s => s.id === SOL), { hora_fin: '00:30:00', termina_dia_siguiente: true, zona: null });
    e.db.hijos_familia = e.db.hijos_familia.filter(h => h.familia_id !== ID.fPractica);
    await page.reload();
    const lineas = tarjeta(page).locator('.pedido-datos p');
    await expect(lineas.first()).toHaveText('20:00 – 00:30 del día siguiente (aproximada, se puede extender)');
    // La familia no tiene chicos cargados uno por uno: sin esa línea. La zona sale de la ficha.
    expect(await lineas.allTextContents()).toEqual(['20:00 – 00:30 del día siguiente (aproximada, se puede extender)', 'Zona: Pocitos', 'Precio por hora: $1.250']);
    verificarLimpio(e);
  });

  test('un dato tramposo en la zona se muestra como texto y no se ejecuta', async ({ page }) => {
    const d = datos({ solicitud: { zona: '<img src=x onerror="window.__roto=1">Pocitos' } });
    const e = await abrir(page, { datos: d });
    await expect(tarjeta(page)).toContainText('Zona: <img src=x onerror="window.__roto=1">Pocitos');
    expect(await page.evaluate(() => window.__roto)).toBeUndefined();
    await expect(tarjeta(page).locator('img')).toHaveCount(0);
    verificarLimpio(e);
  });
});

test.describe('"Puedo"', () => {
  test('manda el cuerpo exacto y la tarjeta pasa a "Esperando confirmación"', async ({ page }) => {
    const e = await abrir(page);
    await boton(page, 'Puedo').click();
    await expect(esperando(page).locator('h2')).toHaveText('Esperando confirmación');
    await expect(porResponder(page)).toHaveCount(0);
    expect(rpcs(e, 'responder_pedido')).toEqual([{ p_sn_id: SN, p_respuesta: 'acepto', p_motivo: null, p_motivo_texto: null }]);
    const t = tarjeta(page);
    await expect(t).toContainText('✓ Dijiste que puedes');
    await expect(t).toContainText('¡Gracias! Te confirmamos a la brevedad.');
    await expect(t.locator('.pedido-dia')).toHaveText('Martes 06/10');
    await expect(boton(page, 'Puedo')).toHaveCount(0);
    await expect(boton(page, 'No puedo')).toHaveCount(0);
    await expect(t).not.toContainText('Responde');
    expect(e.db.solicitud_ninieras.find(s => s.id === SN).estado).toBe('acepto');
    // Aceptado desde otro celular antes: sigue ahí después de recargar.
    await page.reload();
    await expect(esperando(page).locator(`#pedido-${SN}`)).toContainText('✓ Dijiste que puedes');
    verificarLimpio(e);
  });

  test('doble toque: una sola llamada', async ({ page }) => {
    const e = await abrir(page);
    e.demoraEscrituras = 400;
    await boton(page, 'Puedo').dblclick();
    await expect(esperando(page)).toBeVisible();
    expect(rpcs(e, 'responder_pedido')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('la base falla: aviso en la tarjeta, la tarjeta sigue y se puede reintentar', async ({ page }) => {
    const e = await abrir(page);
    e.fallar = p => (p.tabla === 'rpc/responder_pedido' ? { status: 500, message: 'falla simulada' } : undefined);
    await boton(page, 'Puedo').click();
    await expect(tarjeta(page).locator('.pedido-error')).toHaveText(FALLA_RESPONDER);
    await expect(porResponder(page)).toBeVisible();
    await expect(boton(page, 'Puedo')).toBeEnabled();
    expect(e.db.solicitud_ninieras.find(s => s.id === SN).estado).toBe('invitada');
    e.fallar = null;
    await boton(page, 'Puedo').click();
    await expect(esperando(page)).toBeVisible();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('sin conexión: el mismo aviso y la tarjeta sigue', async ({ page }) => {
    const e = await abrir(page);
    await page.route(/\/rest\/v1\/rpc\/responder_pedido/, r => r.abort('failed'));
    await boton(page, 'Puedo').click();
    await expect(tarjeta(page).locator('.pedido-error')).toHaveText(FALLA_RESPONDER);
    await expect(porResponder(page)).toBeVisible();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('el pedido ya no está abierto (lo asignó otra): el aviso y se saca la tarjeta', async ({ page }) => {
    const e = await abrir(page);
    e.db.solicitudes.find(s => s.id === SOL).estado = 'confirmada';
    await boton(page, 'Puedo').click();
    await expect(page.locator('#pedidos-aviso')).toHaveText(CERRADO);
    await expect(tarjeta(page)).toHaveCount(0);
    await expect(porResponder(page)).toHaveCount(0);
    await expect(esperando(page)).toHaveCount(0);
    verificarLimpio(e);
  });

  test('ya respondido desde otro celular: se recarga y queda como está en la base', async ({ page }) => {
    const e = await abrir(page);
    e.db.solicitud_ninieras.find(s => s.id === SN).estado = 'acepto';
    await boton(page, 'Puedo').click();
    await expect(esperando(page).locator(`#pedido-${SN}`)).toContainText('✓ Dijiste que puedes');
    await expect(porResponder(page)).toHaveCount(0);
    await expect(page.locator('#pedidos-aviso')).toHaveCount(0);
    verificarLimpio(e);
  });
});

test.describe('"No puedo"', () => {
  const MOTIVOS = [['otro_trabajo', 'Tengo otro trabajo o sitting'], ['facultad', 'Tengo examen o facultad'], ['lejos', 'Me queda lejos'], ['tarde', 'Es muy tarde para la vuelta']];

  test('la pantalla del motivo: los cinco motivos, "Otro" abre el campo de 200 y Enviar espera a que elija', async ({ page }) => {
    const e = await abrir(page);
    await boton(page, 'No puedo').click();
    await expect(page.locator('h1')).toHaveText('¿Cuál es el motivo?');
    await expect(page.locator('#app')).toContainText('Lo ve solo el equipo.');
    const opciones = await page.locator('label.radio').allTextContents();
    expect(opciones.map(t => t.trim())).toEqual([...MOTIVOS.map(m => m[1]), 'Otro motivo']);
    await expect(page.locator('#motivo-texto')).toBeHidden();
    await expect(boton(page, 'Enviar')).toBeDisabled();
    await page.getByLabel('Otro motivo').check();
    await expect(page.locator('#motivo-texto')).toBeVisible();
    expect(await page.locator('#motivo-texto').getAttribute('maxlength')).toBe('200');
    await expect(boton(page, 'Enviar')).toBeEnabled();
    expect(rpcs(e, 'responder_pedido')).toEqual([]);
    // Volver deja el pedido como estaba.
    await boton(page, 'Volver').click();
    await expect(porResponder(page)).toBeVisible();
    verificarLimpio(e);
  });

  for (const [clave, texto] of MOTIVOS) {
    test(`con el motivo "${texto}"`, async ({ page }) => {
      const e = await abrir(page);
      await boton(page, 'No puedo').click();
      await page.getByLabel(texto).check();
      await boton(page, 'Enviar').click();
      await expect(page.locator('h1')).toHaveText('¿Quieres marcar otros días en los que no puedes?');
      expect(rpcs(e, 'responder_pedido')).toEqual([{ p_sn_id: SN, p_respuesta: 'no_puedo', p_motivo: clave, p_motivo_texto: null }]);
      expect(e.db.solicitud_ninieras.find(s => s.id === SN)).toMatchObject({ estado: 'no_puedo', motivo_no: clave });
      verificarLimpio(e);
    });
  }

  test('con "Otro motivo" escrito (y recortado)', async ({ page }) => {
    const e = await abrir(page);
    await boton(page, 'No puedo').click();
    await page.getByLabel('Otro motivo').check();
    await page.fill('#motivo-texto', '  Tengo un cumpleaños  ');
    await boton(page, 'Enviar').click();
    await expect(page.locator('h1')).toHaveText('¿Quieres marcar otros días en los que no puedes?');
    expect(rpcs(e, 'responder_pedido')).toEqual([{ p_sn_id: SN, p_respuesta: 'no_puedo', p_motivo: 'otro', p_motivo_texto: 'Tengo un cumpleaños' }]);
    expect(e.db.solicitud_ninieras.find(s => s.id === SN).motivo_texto).toBe('Tengo un cumpleaños');
    verificarLimpio(e);
  });

  test('"Otro motivo" sin escribir nada también se manda (el texto es opcional)', async ({ page }) => {
    const e = await abrir(page);
    await boton(page, 'No puedo').click();
    await page.getByLabel('Otro motivo').check();
    await boton(page, 'Enviar').click();
    await expect(page.locator('h1')).toHaveText('¿Quieres marcar otros días en los que no puedes?');
    expect(rpcs(e, 'responder_pedido')).toEqual([{ p_sn_id: SN, p_respuesta: 'no_puedo', p_motivo: 'otro', p_motivo_texto: null }]);
    verificarLimpio(e);
  });

  test('doble toque en Enviar: una sola llamada', async ({ page }) => {
    const e = await abrir(page);
    await boton(page, 'No puedo').click();
    await page.getByLabel('Me queda lejos').check();
    e.demoraEscrituras = 400;
    await boton(page, 'Enviar').dblclick();
    await expect(page.locator('h1')).toHaveText('¿Quieres marcar otros días en los que no puedes?');
    expect(rpcs(e, 'responder_pedido')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('la base falla al enviar: aviso, sigue en la pantalla con lo elegido', async ({ page }) => {
    const e = await abrir(page);
    await boton(page, 'No puedo').click();
    await page.getByLabel('Me queda lejos').check();
    e.fallar = p => (p.tabla === 'rpc/responder_pedido' ? { status: 500, message: 'falla simulada' } : undefined);
    await boton(page, 'Enviar').click();
    await expect(page.locator('#motivo-error')).toHaveText(FALLA_RESPONDER);
    await expect(page.getByLabel('Me queda lejos')).toBeChecked();
    e.fallar = null;
    await boton(page, 'Enviar').click();
    await expect(page.locator('h1')).toHaveText('¿Quieres marcar otros días en los que no puedes?');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('el pedido ya se cerró mientras elegía el motivo: el aviso en el inicio y sin la tarjeta', async ({ page }) => {
    const e = await abrir(page);
    await boton(page, 'No puedo').click();
    await page.getByLabel('Me queda lejos').check();
    e.db.solicitudes.find(s => s.id === SOL).estado = 'cancelada';
    await boton(page, 'Enviar').click();
    await expect(page.locator('#pedidos-aviso')).toHaveText(CERRADO);
    await expect(page.locator('h1')).toContainText('Hola');
    await expect(tarjeta(page)).toHaveCount(0);
    verificarLimpio(e);
  });

  test('ya respondido desde otro celular: vuelve al inicio con lo que quedó en la base', async ({ page }) => {
    const e = await abrir(page);
    await boton(page, 'No puedo').click();
    await page.getByLabel('Me queda lejos').check();
    e.db.solicitud_ninieras.find(s => s.id === SN).estado = 'acepto';
    await boton(page, 'Enviar').click();
    await expect(esperando(page).locator(`#pedido-${SN}`)).toContainText('✓ Dijiste que puedes');
    verificarLimpio(e);
  });
});

test.describe('los días en que no puede', () => {
  const dia = (page, fecha) => page.locator(`button[data-fecha="${fecha}"]`);
  async function hastaLosDias(page, opciones) {
    const e = await abrir(page, opciones);
    await boton(page, 'No puedo').click();
    await page.getByLabel('Me queda lejos').check();
    await boton(page, 'Enviar').click();
    await expect(page.locator('h1')).toHaveText('¿Quieres marcar otros días en los que no puedes?');
    return e;
  }

  test('los próximos 14 días, con los ya marcados encendidos', async ({ page }) => {
    const d = datos();
    d.ninera_no_disponible.push({ ninera_id: ID.nPractica, fecha: '2026-10-08', creado_en: '2026-10-01T12:00:00+00:00' },
      { ninera_id: ID.nCarla, fecha: '2026-10-09', creado_en: '2026-10-01T12:00:00+00:00' });
    const e = await hastaLosDias(page, { datos: d });
    const fechas = await page.locator('button[data-fecha]').evaluateAll(bs => bs.map(b => b.dataset.fecha));
    expect(fechas).toHaveLength(14);
    expect(fechas[0]).toBe('2026-10-04');
    expect(fechas[13]).toBe('2026-10-17');
    await expect(dia(page, '2026-10-06')).toContainText('Mar 06/10');
    await expect(dia(page, '2026-10-08')).toHaveAttribute('aria-pressed', 'true');
    // El día marcado por otra niñera no es de ella.
    await expect(dia(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'false');
    verificarLimpio(e);
  });

  test('marcar dos y desmarcar uno: Guardar manda los cuerpos exactos', async ({ page }) => {
    const d = datos();
    d.ninera_no_disponible.push({ ninera_id: ID.nPractica, fecha: '2026-10-08', creado_en: '2026-10-01T12:00:00+00:00' });
    const e = await hastaLosDias(page, { datos: d });
    await dia(page, '2026-10-12').click();
    await dia(page, '2026-10-10').click();
    await dia(page, '2026-10-08').click();
    await expect(dia(page, '2026-10-08')).toHaveAttribute('aria-pressed', 'false');
    await expect(dia(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'true');
    // Antes de guardar no se escribió nada.
    expect(rpcs(e, 'ninera_marcar_no_disponible')).toEqual([]);
    await boton(page, 'Guardar').click();
    await expect(page.locator('#app')).toContainText(SIN_PEDIDOS);
    expect(rpcs(e, 'ninera_marcar_no_disponible')).toEqual([
      { p_fechas: ['2026-10-10', '2026-10-12'], p_quitar: false },
      { p_fechas: ['2026-10-08'], p_quitar: true },
    ]);
    expect(e.db.ninera_no_disponible.filter(x => x.ninera_id === ID.nPractica).map(x => x.fecha).sort()).toEqual(['2026-10-10', '2026-10-12']);
    verificarLimpio(e);
  });

  test('marcar y desmarcar el mismo día no manda nada; "No, gracias" tampoco', async ({ page }) => {
    const e = await hastaLosDias(page);
    await dia(page, '2026-10-10').click();
    await dia(page, '2026-10-10').click();
    await boton(page, 'Guardar').click();
    await expect(page.locator('#app')).toContainText(SIN_PEDIDOS);
    expect(rpcs(e, 'ninera_marcar_no_disponible')).toEqual([]);
    verificarLimpio(e);
    const e2 = await hastaLosDias(page);
    await dia(page, '2026-10-10').click();
    await boton(page, 'No, gracias').click();
    await expect(page.locator('h1')).toContainText('Hola');
    expect(rpcs(e2, 'ninera_marcar_no_disponible')).toEqual([]);
    expect(e2.db.ninera_no_disponible).toEqual([]);
  });

  test('Guardar falla: aviso, los días siguen encendidos y reintentar anda', async ({ page }) => {
    const e = await hastaLosDias(page);
    await dia(page, '2026-10-10').click();
    e.fallar = p => (p.tabla === 'rpc/ninera_marcar_no_disponible' ? { status: 500, message: 'falla simulada' } : undefined);
    await boton(page, 'Guardar').click();
    await expect(page.locator('#dias-error')).toHaveText('No pudimos guardar tus días. Revisa tu conexión a internet y vuelve a intentar.');
    await expect(dia(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'true');
    e.fallar = null;
    await boton(page, 'Guardar').click();
    await expect(page.locator('#app')).toContainText(SIN_PEDIDOS);
    expect(e.db.ninera_no_disponible.map(x => x.fecha)).toEqual(['2026-10-10']);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('no se pudieron leer los días marcados: aviso y solo "No, gracias"', async ({ page }) => {
    const e = await abrir(page);
    await boton(page, 'No puedo').click();
    await page.getByLabel('Me queda lejos').check();
    await page.route(/\/rest\/v1\/ninera_no_disponible/, r => r.abort('failed'));
    await boton(page, 'Enviar').click();
    // supabase-js reintenta una lectura sin conexión (1 + 2 + 4 s) antes de rendirse.
    await expect(page.locator('#dias-error')).toHaveText('No pudimos cargar tus días. Revisa tu conexión a internet y vuelve a intentar.', { timeout: 15000 });
    await expect(page.locator('button[data-fecha]')).toHaveCount(0);
    await expect(boton(page, 'Guardar')).toHaveCount(0);
    await boton(page, 'No, gracias').click();
    await expect(page.locator('#app')).toContainText(SIN_PEDIDOS);
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('abrir un pedido desde un push (#pedido/<id>)', () => {
  test('la app cerrada: después de las puertas del arranque lleva a la tarjeta', async ({ page }) => {
    const d = datos({ extraSn: [filaSn({ id: SN2, estado: 'invitada' })] });
    const e = await abrir(page, { datos: d, ruta: `/ninera/#pedido/${SN2}` });
    await expect(tarjeta(page, SN2)).toBeVisible();
    await expect(tarjeta(page, SN2)).toHaveClass(/pedido-destacado/);
    await expect(tarjeta(page, SN2)).toBeInViewport();
    expect(new URL(page.url()).hash).toBe('#inicio');
    verificarLimpio(e);
  });

  test('con la app abierta en el inicio: el pedido nuevo aparece y se lo marca', async ({ page }) => {
    const e = await abrir(page);
    await expect(tarjeta(page)).toBeVisible();
    e.db.solicitud_ninieras.push(filaSn({ id: SN2 }));
    await page.evaluate(id => { location.hash = `#pedido/${id}`; }, SN2);
    await expect(tarjeta(page, SN2)).toBeVisible();
    await expect(tarjeta(page, SN2)).toHaveClass(/pedido-destacado/);
    expect(new URL(page.url()).hash).toBe('#inicio');
    verificarLimpio(e);
  });

  test('desde otra pantalla (el chat) también lleva a la tarjeta', async ({ page }) => {
    const e = await abrir(page);
    await page.locator('#inicio-accesos button', { hasText: 'Mensajes' }).click();
    await expect(page.locator('h1')).toHaveText("Equipo de Parents' Break");
    await page.evaluate(id => { location.hash = `#pedido/${id}`; }, SN);
    await expect(tarjeta(page)).toBeVisible();
    await expect(tarjeta(page)).toHaveClass(/pedido-destacado/);
    verificarLimpio(e);
  });

  test('un pedido que ya no está abierto: va al inicio y avisa', async ({ page }) => {
    const e = await abrir(page, { ruta: '/ninera/#pedido/81000000-0000-4000-8000-0000000000ff' });
    await expect(page.locator('#pedidos-aviso')).toHaveText(CERRADO);
    await expect(tarjeta(page)).toBeVisible();
    verificarLimpio(e);
  });

  test('sin haber pasado las puertas del arranque (login) el link no la salta', async ({ page }) => {
    const e = await abrirAppNinera(page, { ninera: ID.nPractica, datos: datos(), sesion: false, ruta: `/ninera/#pedido/${SN}` });
    await expect(page.locator('#login-celular, input[type=tel]').first()).toBeVisible();
    await expect(tarjeta(page)).toHaveCount(0);
    verificarLimpio(e);
  });

  test('el service worker abre el link del push dentro de ninera/', async () => {
    const fs = require('fs');
    const sw = fs.readFileSync(require('path').join(__dirname, '..', 'ninera', 'sw.js'), 'utf8');
    // Resuelto contra el alcance del service worker: "#pedido/<id>" queda en .../ninera/#pedido/<id>.
    expect(sw).toContain('new URL(rutaCruda, self.registration.scope)');
    const url = new URL(`#pedido/${SN}`, 'https://parentsbreak.github.io/app/ninera/');
    expect(url.href).toBe(`https://parentsbreak.github.io/app/ninera/#pedido/${SN}`);
  });
});

test.describe('cargar y recargar', () => {
  test('la base falla al cargar: aviso con "Reintentar" y no un "no tienes pedidos"', async ({ page }) => {
    await page.addInitScript(() => { delete window.PushManager; });
    const d = datos();
    const e = await abrirAppNinera(page, { ninera: ID.nPractica, datos: d });
    e.fallar = p => (p.tabla === 'rpc/ninera_mis_pedidos' ? 'red' : undefined);
    await page.evaluate(() => renderInicio());
    await expect(page.locator('#inicio-pedidos')).toContainText(FALLA_CARGAR);
    await expect(page.locator('#inicio-pedidos')).not.toContainText(SIN_PEDIDOS);
    e.fallar = null;
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(tarjeta(page)).toBeVisible();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('al volver a la app (visibilitychange) se recargan los pedidos', async ({ page }) => {
    const e = await abrir(page);
    await expect(tarjeta(page)).toBeVisible();
    e.db.solicitud_ninieras.push(filaSn({ id: SN2 }));
    e.db.solicitud_ninieras.find(s => s.id === SN).estado = 'acepto';
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(tarjeta(page, SN2)).toBeVisible();
    await expect(esperando(page).locator(`#pedido-${SN}`)).toBeVisible();
    verificarLimpio(e);
  });

  test('al volver con la base caída no se borra lo que ya estaba a la vista', async ({ page }) => {
    const e = await abrir(page);
    await expect(tarjeta(page)).toBeVisible();
    e.fallar = p => (p.tabla === 'rpc/ninera_mis_pedidos' ? 'red' : undefined);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);
    await expect(tarjeta(page)).toBeVisible();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('base sin la migración de la etapa 5: el inicio como hoy, sin error', async ({ page }) => {
    const e = await abrir(page, { baseSinMigrar: 'etapa5' });
    await expect(page.locator('#app')).toContainText(SIN_PEDIDOS);
    await expect(page.locator('#proximos-sittings')).toBeVisible();
    await expect(porResponder(page)).toHaveCount(0);
    await expect(page.locator('#pedidos-aviso')).toHaveCount(0);
    verificarLimpio(e, { ignorar: RUIDO_SIN_MIGRAR });
  });
});

test.describe('en el celular y en la compu', () => {
  test('a 390 px y a 1280 px: sin scroll horizontal, botones para el dedo (capturas)', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const d = datos({ extraSn: [filaSn({ id: SN2, estado: 'acepto', respondido_en: '2026-10-04T14:55:00.000Z' })] });
    const e = await abrir(page, { datos: d });
    await expect(porResponder(page)).toBeVisible();
    // SN2 apunta a la misma solicitud: "Esperando confirmación" con la misma fecha, está bien para la captura.
    await expect(esperando(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const cajas = await page.locator('.pedido-tarjeta .btn').evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }));
    expect(cajas.length).toBeGreaterThan(1);
    for (const [ancho, alto] of cajas) { expect(alto).toBeGreaterThanOrEqual(48); expect(ancho).toBeGreaterThanOrEqual(120); }
    await page.screenshot({ path: testInfo.outputPath('ninera-pedido-390.png'), fullPage: true, animations: 'disabled' });
    await boton(page, 'No puedo').click();
    await page.getByLabel('Otro motivo').check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('ninera-pedido-motivo-390.png'), fullPage: true, animations: 'disabled' });
    await boton(page, 'Enviar').click();
    await expect(page.locator('h1')).toHaveText('¿Quieres marcar otros días en los que no puedes?');
    const dias = await page.locator('button[data-fecha]').evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }));
    for (const [ancho, alto] of dias) { expect(alto).toBeGreaterThanOrEqual(44); expect(ancho).toBeGreaterThanOrEqual(44); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('ninera-pedido-dias-390.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await page.screenshot({ path: testInfo.outputPath('ninera-pedido-dias-1280.png'), fullPage: true, animations: 'disabled' });
    await boton(page, 'No, gracias').click();
    await expect(page.locator('h1')).toContainText('Hola');
    await page.screenshot({ path: testInfo.outputPath('ninera-pedido-1280.png'), fullPage: true, animations: 'disabled' });
    verificarLimpio(e);
  });
});
