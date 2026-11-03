// El panel en la etapa 8 (fase 1, 02/11/2026; decisiones.md 6.5): un pedido ya asignado y registrado se ve en la Agenda
// como su registro, y su modal suma "Cambiar de niñera" (el mismo registro pasa a la nueva: la fila de la anterior a
// 'rechazada', la de la nueva 'confirmada', el registro con la condición de la niñera; avisos y confirmación para la
// madre; dos admins, fallas que vuelven atrás) y "Cancelar el pedido" (la base cancela el registro en $0 y le avisa a la
// elegida). Además: lo que respondió la niñera al cambio de horario, el link del aviso que abre el registro, "Fichas de
// la familia" con "Copiar para la próxima niñera" y la base sin migrar. Contra el simulador (tests/support/rpc-ficha.js).
// Datos inventados: el pedido de Familia Prueba Uno del martes 06/10 de 20 a 23 lo tiene Carla (con app); Ana pasa a
// tener app. "Hoy" es el domingo 04/10/2026 al mediodía.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

const RUIDO = { ignorar: [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/] };
const SOL = '80000000-0000-4000-8000-0000000000e1';
const SN_CARLA = '81000000-0000-4000-8000-0000000000e1';
const REG = '70000000-0000-4000-8000-0000000000e1';
const uAna = '00000000-0000-4000-8000-0000000000a1';

function datos({ registro = {}, filas = [], cambios = [], fichas = [] } = {}) {
  const d = datosBase();
  d.ninieras.find(n => n.id === ID.nAna).user_id = uAna;
  d.app_config.find(c => c.id === 'pedidos_app').valor.solo_practica = false;
  d.solicitudes.push({ id: SOL, familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', tipo: 'sitting', zona: 'Pocitos', fecha: '2026-10-06',
    hora_inicio: '20:00:00', hora_fin: '23:00:00', cobro_familia: 1140, estado: 'confirmada', notas: null, created_at: '2026-10-01T00:00:00Z', termina_dia_siguiente: false });
  d.solicitud_ninieras = [...(d.solicitud_ninieras || []),
    { id: SN_CARLA, solicitud_id: SOL, ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', estado: 'confirmada', pago_ninera: 750, origen: 'app',
      precio_hora: 250, respondido_en: '2026-10-02T15:00:00Z', seleccionada_en: '2026-10-02T16:00:00Z', visto_en: '2026-10-02T17:00:00Z' },
    ...filas];
  d.sittings_traslados.push(sitting(REG, '2026-10-06', { ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', hora_inicio: '20:00:00', hora_fin: '23:00:00',
    cobro_familia: 1140, pago_ninera: 750, solicitud_id: SOL, estado: 'confirmado', notas: 'Asignado desde Agenda', ...registro }));
  d.cambios_horario = cambios;
  d.fichas_familia = fichas;
  return d;
}
const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && (!metodo || w.metodo === metodo));
// Los avisos que dejó el test (los de datosBase quedan afuera).
const AVISOS_DE_ANTES = new Set((datosBase().avisos || []).map(a => a.id));
const avisosA = (e, nineraId) => (e.db.avisos || []).filter(a => a.para_ninera_id === nineraId && !AVISOS_DE_ANTES.has(a.id)).map(a => a.titulo);
async function abrirRegistro(page) {
  await irAModulo(page, 'agenda');
  await page.evaluate(id => abrirModalSolicitud(id), `reg:${REG}`);
  await expect(page.locator('#editmodal h2')).toHaveText('Familia Prueba Uno');
}
async function abrirCambiar(page) {
  await abrirRegistro(page);
  await page.locator('#editmodal button', { hasText: 'Cambiar de niñera' }).click();
  await expect(page.locator('#editmodal h2')).toHaveText('Cambiar de niñera');
}
async function elegir(page, texto, nombre) {
  await page.fill('#cambio-ninera', texto);
  await page.locator('#cambio-ninera-dropdown .autocomplete-item', { hasText: nombre }).click();
  await expect(page.locator('#cambio-ninera')).toHaveValue(nombre);
}
const guardar = page => page.locator('#editmodal button', { hasText: 'Cambiar de niñera' }).click();

test.describe('Cambiar de niñera', () => {
  test('el mismo registro pasa a la nueva con su pago; a la anterior le llega que ya no va y a la nueva que quedó seleccionada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirCambiar(page);
    await expect(page.locator('#editmodal .helper').first()).toContainText('Ahora va Carla Ejemplo.');
    await expect(page.locator('#cambio-ninera-pago')).toHaveValue('750');
    await elegir(page, 'ana', 'Ana Ficticia');
    await expect(page.locator('#cambio-ninera-pago-ayuda')).toHaveText('$250 por hora');
    await guardar(page);
    await expect(page.locator('#editmodal h2')).toHaveText('Confirmación para la madre');
    await expect(page.locator('#editmodal .okbox')).toHaveText('Ana Ficticia quedó seleccionada. Ya le llegó el aviso.');
    // En orden: la anterior, la nueva, el registro (con la condición de que siga con Carla, sin pagar ni cancelar).
    const orden = e.escrituras.filter(w => ['solicitud_ninieras', 'sittings_traslados'].includes(w.tabla)).map(w => `${w.tabla} ${w.metodo}`);
    expect(orden).toEqual(['solicitud_ninieras PATCH', 'solicitud_ninieras POST', 'sittings_traslados PATCH']);
    expect(escrituras(e, 'solicitud_ninieras', 'PATCH')[0]).toMatchObject({ cuerpo: { estado: 'rechazada' }, params: { id: `in.(${SN_CARLA})`, estado: 'eq.confirmada' } });
    expect(escrituras(e, 'solicitud_ninieras', 'POST')[0].cuerpo).toEqual({ solicitud_id: SOL, ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', estado: 'confirmada', pago_ninera: 750, precio_hora: 250 });
    expect(escrituras(e, 'sittings_traslados', 'PATCH')[0]).toMatchObject({
      cuerpo: { ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', pago_ninera: 750 },
      params: { id: `eq.${REG}`, pagado: 'eq.false', cancelado: 'eq.false', ninera_id: `eq.${ID.nCarla}` },
    });
    expect(e.db.sittings_traslados.find(s => s.id === REG)).toMatchObject({ ninera_id: ID.nAna, cobro_familia: 1140, notas: 'Asignado desde Agenda' });
    expect(avisosA(e, ID.nCarla)).toEqual(['Ya no vas al sitting del mar 06/10']);
    // A Ana no le repite "Tienes un sitting": ya le llegó "¡Quedaste seleccionada!".
    expect(avisosA(e, ID.nAna)).toEqual(['¡Quedaste seleccionada!']);
    verificarLimpio(e);
  });

  test('si la nueva ya tenía su fila de la app (dijo "Puedo"), se confirma esa misma fila', async ({ page }) => {
    const SN_ANA = '81000000-0000-4000-8000-0000000000e2';
    const e = await abrirApp(page, { datos: datos({ filas: [{ id: SN_ANA, solicitud_id: SOL, ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', estado: 'cubierto',
      pago_ninera: null, origen: 'app', precio_hora: 260, respondido_en: '2026-10-02T15:10:00Z' }] }) });
    await abrirCambiar(page);
    await elegir(page, 'ana', 'Ana Ficticia');
    await guardar(page);
    await expect(page.locator('#editmodal h2')).toHaveText('Confirmación para la madre');
    expect(escrituras(e, 'solicitud_ninieras', 'POST')).toEqual([]);
    expect(escrituras(e, 'solicitud_ninieras', 'PATCH')[1]).toMatchObject({ cuerpo: { estado: 'confirmada', pago_ninera: 750 }, params: { id: `eq.${SN_ANA}`, estado: 'eq.cubierto' } });
    expect(e.db.solicitud_ninieras.find(f => f.id === SN_ANA)).toMatchObject({ estado: 'confirmada', precio_hora: 260 });
    verificarLimpio(e);
  });

  test('sin elegir o una que no está en la lista: avisa y no escribe; la anterior no se ofrece', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirCambiar(page);
    await guardar(page);
    await expect(page.locator('#cambio-ninera-warn')).toHaveText('Elegí una niñera de la lista.');
    await page.fill('#cambio-ninera', 'carla');
    await expect(page.locator('#cambio-ninera-dropdown')).toContainText('Ninguna niñera coincide');
    await page.fill('#cambio-ninera', 'Alguien Inventada');
    await guardar(page);
    await expect(page.locator('#cambio-ninera-warn')).toHaveText('Elegí una niñera de la lista.');
    expect(escrituras(e, 'solicitud_ninieras')).toEqual([]);
    expect(escrituras(e, 'sittings_traslados')).toEqual([]);
    verificarLimpio(e);
  });

  test('otra admin cambió el registro mientras tanto: las filas vuelven atrás y avisa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirCambiar(page);
    await elegir(page, 'ana', 'Ana Ficticia');
    Object.assign(e.db.sittings_traslados.find(s => s.id === REG), { ninera_id: ID.nBruno, ninera_nombre: 'Bruno Inventado' });
    await guardar(page);
    const warn = page.locator('#cambio-ninera-warn');
    await expect(warn).toContainText('alguien más cambió este pedido');
    await expect(warn).toContainText('El registro sigue con Carla Ejemplo. Si Ana Ficticia tiene la app, ya le llegó que quedó seleccionada: avisale por WhatsApp que no va.');
    expect(e.db.solicitud_ninieras.find(f => f.id === SN_CARLA).estado).toBe('confirmada');
    expect(e.db.solicitud_ninieras.filter(f => f.solicitud_id === SOL && f.ninera_id === ID.nAna)).toEqual([]);
    expect(e.db.sittings_traslados.find(s => s.id === REG).ninera_id).toBe(ID.nBruno);
    verificarLimpio(e);
  });

  test('si falla la fila de la nueva, la anterior vuelve a confirmada y el registro no cambia', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirCambiar(page);
    await elegir(page, 'ana', 'Ana Ficticia');
    e.fallar = ({ tabla, metodo }) => tabla === 'solicitud_ninieras' && metodo === 'POST' ? { status: 500, message: 'falla simulada' } : undefined;
    await guardar(page);
    await expect(page.locator('#cambio-ninera-warn')).toContainText('falla simulada');
    expect(e.db.solicitud_ninieras.find(f => f.id === SN_CARLA).estado).toBe('confirmada');
    expect(escrituras(e, 'sittings_traslados')).toEqual([]);
    expect(avisosA(e, ID.nCarla)).toEqual([]);
    verificarLimpio(e, RUIDO);
  });

  test('pregunta si la nueva ya tiene algo a esa hora; al cancelar no escribe nada', async ({ page }) => {
    const d = datos();
    d.sittings_traslados.push(sitting('70000000-0000-4000-8000-0000000000e9', '2026-10-06', { familia_id: ID.fDos, familia_nombre: 'Familia Prueba Dos', hora_inicio: '21:00:00', hora_fin: '23:30:00' }));
    const e = await abrirApp(page, { datos: d });
    await abrirCambiar(page);
    await elegir(page, 'ana', 'Ana Ficticia');
    await guardar(page);
    const aviso = page.locator('.confirmoverlay:not(#editmodal)');
    await expect(aviso).toContainText('Ana Ficticia ya está comprometida con Familia Prueba Dos');
    await aviso.locator('button', { hasText: 'Cancelar' }).click();
    expect(escrituras(e, 'solicitud_ninieras')).toEqual([]);
    expect(escrituras(e, 'sittings_traslados')).toEqual([]);
    verificarLimpio(e);
  });

  test('doble toque: una sola vez', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirCambiar(page);
    await elegir(page, 'ana', 'Ana Ficticia');
    e.demoraEscrituras = 300;
    const btn = page.locator('#editmodal button', { hasText: 'Cambiar de niñera' });
    await btn.click();
    await btn.click({ force: true, timeout: 500 }).catch(() => {});
    await expect(page.locator('#editmodal h2')).toHaveText('Confirmación para la madre');
    expect(escrituras(e, 'sittings_traslados', 'PATCH')).toHaveLength(1);
    expect(escrituras(e, 'solicitud_ninieras', 'POST')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('pagado, cancelado, pasado o sin pedido: sin "Cambiar de niñera"; pagado sigue con "Cancelar el pedido"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ registro: { pagado: true } }) });
    await abrirRegistro(page);
    await expect(page.locator('#editmodal button', { hasText: 'Cambiar de niñera' })).toHaveCount(0);
    await expect(page.locator('#editmodal button', { hasText: 'Cancelar el pedido' })).toHaveCount(1);
    const sinPedido = e.db.sittings_traslados.find(s => s.id === REG);
    sinPedido.solicitud_id = null;
    await page.evaluate(() => { cerrarModal(); return cargarAgendaSolicitudes(); });
    await page.evaluate(id => abrirModalSolicitud(id), `reg:${REG}`);
    await expect(page.locator('#editmodal button', { hasText: 'Editar este registro' })).toBeVisible();
    await expect(page.locator('#editmodal button', { hasText: /Cambiar de niñera|Cancelar el pedido/ })).toHaveCount(0);
    verificarLimpio(e);
  });

  test('a 390 px: la pantalla entra (captura)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: datos() });
    await abrirCambiar(page);
    await page.fill('#cambio-ninera', 'a');
    expect(await page.evaluate(() => { const b = document.querySelector('#editmodal .confirmbox'); return b.scrollWidth <= b.clientWidth; })).toBe(true);
    await page.locator('#editmodal').screenshot({ path: 'test-results/cambiar-ninera-390.png' });
    verificarLimpio(e);
  });
});

test.describe('Cancelar el pedido ya asignado', () => {
  test('desde el registro: el texto nuevo, la base cancela el registro en $0 y le avisa a la elegida', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirRegistro(page);
    await page.locator('#editmodal button', { hasText: 'Cancelar el pedido' }).click();
    const aviso = page.locator('.confirmoverlay:not(#editmodal)');
    await expect(aviso).toContainText('¿Cancelar el pedido? El registro de Carla Ejemplo en Sittings & traslados queda cancelado en $0 (si no está cobrado ni pagado) y, si tiene la app, le llega un aviso.');
    await expect(aviso).not.toContainText('avisale por WhatsApp');
    await aviso.locator('button', { hasText: 'Cancelar el pedido' }).click();
    await expect(page.locator('#editmodal.show')).toHaveCount(0);
    expect(escrituras(e, 'solicitudes', 'PATCH')[0]).toMatchObject({ cuerpo: { estado: 'cancelada' }, params: { id: `eq.${SOL}`, estado: 'eq.confirmada' } });
    expect(e.db.sittings_traslados.find(s => s.id === REG)).toMatchObject({ cancelado: true, cobro_familia: 0, pago_ninera: 0, notas: 'Asignado desde Agenda — Pedido cancelado' });
    expect(e.db.solicitud_ninieras.find(f => f.id === SN_CARLA).estado).toBe('cancelado');
    const avisoCarla = e.db.avisos.find(a => a.para_ninera_id === ID.nCarla && !AVISOS_DE_ANTES.has(a.id));
    expect(avisoCarla).toMatchObject({ titulo: 'Se canceló tu sitting del mar 06/10', cuerpo: 'Con Familia U. Si tienes dudas, escríbenos.' });
    verificarLimpio(e);
  });

  test('cobrado: el pedido se cancela pero el registro queda como estaba', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ registro: { cobrado: true } }) });
    await abrirRegistro(page);
    await page.locator('#editmodal button', { hasText: 'Cancelar el pedido' }).click();
    await page.locator('.confirmoverlay:not(#editmodal) button', { hasText: 'Cancelar el pedido' }).click();
    await expect(page.locator('#editmodal.show')).toHaveCount(0);
    expect(e.db.solicitudes.find(s => s.id === SOL).estado).toBe('cancelada');
    expect(e.db.sittings_traslados.find(s => s.id === REG)).toMatchObject({ cancelado: false, cobro_familia: 1140 });
    verificarLimpio(e);
  });
});

test.describe('lo que respondió al cambio de horario', () => {
  const cambio = extra => ({ id: '90000000-0000-4000-8000-0000000000e1', ninera_id: ID.nCarla, familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno',
    sitting_id: REG, solicitud_id: SOL, es_fijo: false, desde: '2026-10-06', hora_inicio: '20:00:00', hora_fin: '23:00:00', termina_dia_siguiente: false,
    creado_en: '2026-10-03T12:00:00Z', respuesta: false, respondido_en: '2026-10-03T13:00:00Z', ...extra });

  test('"no puede con el nuevo horario" en el modal del registro; confirmado y sin responder también se ven', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cambios: [cambio()] }) });
    await abrirRegistro(page);
    await expect(page.locator('#reg-cambio-horario .warnbox')).toHaveText('Carla Ejemplo no puede con el nuevo horario (de 20:00 a 23:00). Cambiá de niñera o volvé al horario de antes.');
    e.db.cambios_horario.push(cambio({ id: '90000000-0000-4000-8000-0000000000e2', creado_en: '2026-10-04T10:00:00Z', respuesta: true }));
    await page.evaluate(id => { cerrarModal(); abrirModalSolicitud(id); }, `reg:${REG}`);
    await expect(page.locator('#reg-cambio-horario')).toHaveText('Carla Ejemplo confirmó el nuevo horario (de 20:00 a 23:00).');
    e.db.cambios_horario.push(cambio({ id: '90000000-0000-4000-8000-0000000000e3', creado_en: '2026-10-04T11:00:00Z', respuesta: null, hora_fin: '23:30:00' }));
    await page.evaluate(id => { cerrarModal(); abrirModalSolicitud(id); }, `reg:${REG}`);
    await expect(page.locator('#reg-cambio-horario')).toHaveText('Carla Ejemplo todavía no respondió el cambio de horario (de 20:00 a 23:30).');
    verificarLimpio(e);
  });

  test('el link del aviso (?ir=agenda&solicitud=) de un pedido ya registrado abre su registro', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cambios: [cambio()] }) });
    await irAModulo(page, 'agenda');
    await page.evaluate(id => abrirSolicitudDeLink(id), SOL);
    await expect(page.locator('#editmodal h2')).toHaveText('Familia Prueba Uno');
    await expect(page.locator('#reg-cambio-horario .warnbox')).toContainText('no puede con el nuevo horario');
    verificarLimpio(e);
  });

  test('la respuesta de una niñera anterior no se muestra; un cambio de la admin en la Agenda crea el cambio para responder', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cambios: [cambio({ ninera_id: ID.nAna })] }) });
    await abrirRegistro(page);
    await expect(page.locator('#editmodal button', { hasText: 'Cambiar de niñera' })).toBeVisible();
    await expect(page.locator('#reg-cambio-horario')).toBeEmpty();
    // El trigger del simulador: cambiar la hora de fin del registro le manda el aviso a Carla y deja su cambio.
    await page.evaluate(id => sb.from('sittings_traslados').update({ hora_fin: '23:30' }).eq('id', id), REG);
    const nuevo = e.db.cambios_horario.find(c => c.ninera_id === ID.nCarla);
    expect(nuevo).toMatchObject({ sitting_id: REG, solicitud_id: SOL, desde: '2026-10-06', hora_inicio: '20:00:00', hora_fin: '23:30', respuesta: null });
    expect(e.db.avisos.find(a => a.para_ninera_id === ID.nCarla && !AVISOS_DE_ANTES.has(a.id))).toMatchObject({ titulo: 'Cambió el horario de tu sitting del mar 06/10', cuerpo: 'Ahora es de 20:00 a 23:30. Mira los detalles.', url: `#cambio/${nuevo.id}` });
    verificarLimpio(e);
  });
});

test.describe('Fichas de la familia', () => {
  const ficha = (id, actualizada, datosFicha, ninera = ID.nCarla) => ({ id, familia_id: ID.fUno, sitting_id: null, ninera_id: ninera, datos: datosFicha,
    creada_en: actualizada, actualizada_en: actualizada });

  test('la última con quién y cuándo, "Copiar para la próxima niñera" (sin las casillas) y las anteriores plegadas, escapadas', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ fichas: [
      ficha('90000000-0000-4000-8000-0000000000f1', '2026-09-20T22:00:00Z', { direccion: 'Calle Falsa 123', alergias: 'Maní', c_botiquin: true }),
      ficha('90000000-0000-4000-8000-0000000000f2', '2026-10-03T23:00:00Z', { direccion: 'Calle Falsa 123, apto 2', reglas: '<b onclick="window.__ataque=1">Sin pantallas</b>', c_llaves: true }, ID.nAna),
    ] }) });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    const sec = page.locator('#fam-fichas');
    await expect(sec.locator('.card-section-title')).toHaveText('Fichas de la familia');
    await expect(sec.locator('.ficha-familia .helper')).toHaveText('La completó Ana Ficticia el 03/10/2026.');
    await expect(sec.locator('.ficha-familia .ficha-familia-linea')).toHaveText(['Dirección exacta de la casa: Calle Falsa 123, apto 2',
      'Pantallas, golosinas, salidas y otras reglas: <b onclick="window.__ataque=1">Sin pantallas</b>']);
    await expect(sec.locator('details summary')).toHaveText(['Anterior, del 20/09/2026']);
    await expect(sec).not.toContainText('llaves');
    await sec.locator('button', { hasText: 'Copiar para la próxima niñera' }).click();
    await expect(page.locator('.toaststack .toast', { hasText: 'Ficha copiada. Pegala en WhatsApp.' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("*Ficha de la familia, Parents' Break*\n*Dirección exacta de la casa:* Calle Falsa 123, apto 2\n*Pantallas, golosinas, salidas y otras reglas:* <b onclick=\"window.__ataque=1\">Sin pantallas</b>");
    expect(await page.evaluate(() => window.__ataque)).toBeUndefined();
    verificarLimpio(e);
  });

  test('sin fichas, con la base sin migrar o si la lectura falla', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await expect(page.locator('#editmodal.show')).toBeVisible();
    await expect(page.locator('#fam-fichas')).toBeEmpty();
    await page.route('**/rest/v1/fichas_familia?*', route => route.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }));
    await page.evaluate(id => pintarFichasFamilia(id), ID.fUno);
    await expect(page.locator('#fam-fichas .warnbox')).toHaveText('No se pudieron leer las fichas de la familia.');
    verificarLimpio(e, RUIDO);
  });

  test('base sin la migración de la etapa 8: sin la sección ni la línea del cambio; "Cambiar de niñera" anda igual', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos(), baseSinMigrar: 'etapa8' });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await expect(page.locator('#editmodal.show')).toBeVisible();
    await expect(page.locator('#fam-fichas')).toBeEmpty();
    await page.evaluate(() => cerrarModal());
    await abrirCambiar(page);
    await elegir(page, 'ana', 'Ana Ficticia');
    await guardar(page);
    await expect(page.locator('#editmodal h2')).toHaveText('Confirmación para la madre');
    expect(e.db.sittings_traslados.find(s => s.id === REG).ninera_id).toBe(ID.nAna);
    verificarLimpio(e, RUIDO);
  });
});
