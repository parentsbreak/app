// Etapa 5, tarea 5.8 (02/11/2026): el panel recibe las respuestas de las niñeras. El modal de la solicitud
// de la Agenda dice quién puede, quién no (con el motivo) y quién no respondió; se repinta solo con un canal
// de Realtime propio mientras está abierto; el push de las admins (?ir=agenda&solicitud=<id>) lo abre; las
// preferencias suman "Pedidos de la app"; y la ficha de la familia tiene "No acepta niñeras nuevas".
// Todo contra el simulador. Hoy es el domingo 04/10/2026 a las 12:00 de Montevideo (UTC-3). Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosPedidos, ID } = require('./support/datos');

const SOL = ID.sUno; // Familia Prueba Uno, martes 06/10, 20 a 23
const DORA = '30000000-0000-4000-8000-000000000005';
const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/];
const sn = (id, ninera, nombre, estado, extra = {}) => ({
  id, solicitud_id: SOL, ninera_id: ninera, ninera_nombre: nombre, pago_ninera: null, estado,
  created_at: '2026-10-04T13:00:00Z', origen: 'app', precio_hora: 300, enviado_en: '2026-10-04T13:00:00Z',
  respondido_en: null, motivo_no: null, motivo_texto: null, ...extra,
});
const SN_CARLA = 'a7000000-0000-4000-8000-000000000041';
const SN_DORA = 'a7000000-0000-4000-8000-000000000042';
const SN_ANA = 'a7000000-0000-4000-8000-000000000043';

function datos({ filas } = {}) {
  const d = datosPedidos();
  const carla = d.ninieras.find(n => n.id === ID.nCarla);
  d.ninieras.push({ ...carla, id: DORA, nombre: 'Dora Inventada', telefono: '098000005', zona: 'Carrasco', user_id: '00000000-0000-4000-8000-000000000005', temporada_token: '60000000-0000-4000-8000-000000000005', foto_propuesta_ruta: null, foto_propuesta_en: null });
  const s = d.solicitudes.find(x => x.id === SOL);
  Object.assign(s, { estado: 'pendiente_confirmar', enviado_app_en: '2026-10-04T13:00:00Z', responder_hasta: '2026-10-04T16:30:00Z' });
  d.solicitud_ninieras.push(...(filas || [
    sn(SN_CARLA, ID.nCarla, 'Carla Ejemplo', 'acepto', { respondido_en: '2026-10-04T13:05:00Z', precio_hora: 320 }),
    sn(SN_DORA, DORA, 'Dora Inventada', 'no_puedo', { respondido_en: '2026-10-04T13:06:00Z', motivo_no: 'lejos' }),
    sn(SN_ANA, ID.nAna, 'Ana Ficticia', 'invitada'),
  ]));
  return d;
}
async function abrirModal(page, id = SOL) {
  await irAModulo(page, 'agenda');
  await page.evaluate(i => abrirModalSolicitud(i), id);
  await expect(page.locator('#editmodal.show h2').first()).toHaveText('Familia Prueba Uno');
  await esperarQuieta(page);
}
const fila = (page, nombre) => page.locator('#editmodal .agenda-ninerarow', { hasText: nombre });

test.describe('modal de la solicitud: respuestas de la app', () => {
  test('Puede, No puede con motivo y Sin responder, con su precio; sin "Confirmar"; encabezado con las horas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: datos() });
    await abrirModal(page);
    const modal = page.locator('#editmodal');
    // Etapa 6 (01/11/2026): el modal de un pedido en curso usa el detalle de "Pedidos en curso" de Hoy.
    await expect(modal.locator('.sol-envio')).toHaveText('Puede 1, no puede 1, falta responder 1. Mandado a 3 a las 10:00. Responder antes de las 13:30.');
    await expect(fila(page, 'Carla Ejemplo')).toContainText('Puede');
    await expect(fila(page, 'Carla Ejemplo').locator('.badge')).toHaveClass(/good/);
    await expect(fila(page, 'Carla Ejemplo')).toContainText('$320 por hora');
    await expect(fila(page, 'Dora Inventada')).toContainText('No puede: Me queda lejos');
    await expect(fila(page, 'Dora Inventada').locator('.badge')).toHaveClass(/bad/);
    await expect(fila(page, 'Ana Ficticia')).toContainText('Sin responder');
    await expect(fila(page, 'Ana Ficticia').locator('.badge')).toHaveClass(/warn/);
    await expect(modal.locator('button', { hasText: 'Confirmar' })).toHaveCount(0);
    await expect(modal.locator('button', { hasText: 'Preguntar a más niñeras' })).toBeVisible();
    await expect(modal.locator('button', { hasText: 'Agregar otra niñera' })).toHaveCount(0);
    await expect(fila(page, 'Carla Ejemplo').locator('a', { hasText: 'WhatsApp' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await modal.locator('.confirmbox').screenshot({ path: 'test-results/pedido-respuestas-390.png' });
    verificarLimpio(e);
  });

  test('"Otro motivo" muestra el texto que escribió, escapado; cada motivo con su texto', async ({ page }) => {
    const filas = [
      sn(SN_CARLA, ID.nCarla, 'Carla Ejemplo', 'no_puedo', { motivo_no: 'otro', motivo_texto: 'Viajo <img src=x onerror=alert(1)>' }),
      sn(SN_DORA, DORA, 'Dora Inventada', 'no_puedo', { motivo_no: 'tarde' }),
      sn(SN_ANA, ID.nAna, 'Ana Ficticia', 'no_puedo', { motivo_no: 'facultad' }),
    ];
    const e = await abrirApp(page, { datos: datos({ filas }) });
    await abrirModal(page);
    await expect(fila(page, 'Carla Ejemplo')).toContainText('No puede: Viajo <img src=x onerror=alert(1)>');
    await expect(page.locator('#editmodal img')).toHaveCount(0);
    await expect(fila(page, 'Dora Inventada')).toContainText('No puede: Es muy tarde para la vuelta');
    await expect(fila(page, 'Ana Ficticia')).toContainText('No puede: Tengo examen o facultad');
    verificarLimpio(e);
  });

  test('"Otro motivo" sin texto dice solo "Otro motivo"; las filas del panel (sin origen) siguen con "Confirmar"', async ({ page }) => {
    const filas = [
      sn(SN_CARLA, ID.nCarla, 'Carla Ejemplo', 'no_puedo', { motivo_no: 'otro', motivo_texto: null }),
      { id: SN_ANA, solicitud_id: SOL, ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', pago_ninera: null, estado: 'invitada', created_at: '2026-10-04T13:00:00Z' },
    ];
    const e = await abrirApp(page, { datos: datos({ filas }) });
    await abrirModal(page);
    await expect(fila(page, 'Carla Ejemplo')).toContainText('No puede: Otro motivo');
    await expect(fila(page, 'Ana Ficticia')).toContainText('Pendiente');
    await expect(fila(page, 'Ana Ficticia').locator('button', { hasText: 'Confirmar' })).toHaveCount(1);
    await expect(fila(page, 'Carla Ejemplo').locator('button', { hasText: 'Confirmar' })).toHaveCount(0);
    verificarLimpio(e);
  });

  test('"Preguntar a más niñeras" (antes "Elegir niñeras") abre la pantalla de elegir y cierra el modal de la solicitud', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirModal(page);
    await page.locator('#editmodal button', { hasText: 'Preguntar a más niñeras' }).click();
    await expect(page.locator('#editmodal .pedido-elegir')).toBeVisible();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('solicitud sin asignar y sin filas de la app: como siempre (sin encabezado de envío)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    await abrirModal(page);
    await expect(page.locator('#editmodal .sol-envio')).toHaveCount(0);
    await expect(page.locator('#editmodal button', { hasText: 'Asignar niñera' })).toBeVisible();
    verificarLimpio(e);
  });
});

test.describe('modal de la solicitud: Realtime propio', () => {
  test('una respuesta nueva repinta el modal abierto; al cerrar, el canal se suelta', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirModal(page);
    await expect(fila(page, 'Ana Ficticia')).toContainText('Sin responder');
    const nueva = { ...e.db.solicitud_ninieras.find(x => x.id === SN_ANA), estado: 'acepto', respondido_en: '2026-10-04T14:00:00Z', precio_hora: 350 };
    Object.assign(e.db.solicitud_ninieras.find(x => x.id === SN_ANA), nueva);
    await expect.poll(() => e.emitirRealtime('solicitud_ninieras', 'UPDATE', nueva)).toBeGreaterThan(0);
    await expect(fila(page, 'Ana Ficticia')).toContainText('Puede');
    await expect(fila(page, 'Ana Ficticia')).toContainText('$350 por hora');
    // Los canales sin filtro (el del módulo, la campanita) los cuenta una fila de otra solicitud; el del modal es uno más.
    const ajena = { ...nueva, solicitud_id: ID.sPractica };
    const base = e.emitirRealtime('solicitud_ninieras', 'UPDATE', ajena);
    expect(e.emitirRealtime('solicitud_ninieras', 'UPDATE', nueva)).toBe(base + 1);
    await page.locator('#editmodal .modal-close').click();
    await expect.poll(() => e.emitirRealtime('solicitud_ninieras', 'UPDATE', nueva)).toBe(base);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('un cambio de otra solicitud no repinta ni molesta', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirModal(page);
    const ajena = sn('a7000000-0000-4000-8000-000000000099', ID.nCarla, 'Carla Ejemplo', 'acepto');
    ajena.solicitud_id = ID.sPractica;
    const propia = { ...ajena, solicitud_id: SOL };
    // El filtro del canal del modal es de esta solicitud: una fila de otra llega a un canal menos.
    expect(e.emitirRealtime('solicitud_ninieras', 'UPDATE', propia)).toBe(e.emitirRealtime('solicitud_ninieras', 'UPDATE', ajena) + 1);
    verificarLimpio(e);
  });

  test('si la lectura de la respuesta falla, el modal sigue como estaba y no se rompe', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await abrirModal(page);
    e.fallar = ({ tabla, metodo }) => (tabla === 'solicitud_ninieras' && metodo === 'GET' ? { status: 500, message: 'falla simulada' } : null);
    const nueva = { ...e.db.solicitud_ninieras.find(x => x.id === SN_ANA), estado: 'acepto' };
    e.emitirRealtime('solicitud_ninieras', 'UPDATE', nueva);
    await page.waitForTimeout(500);
    await expect(fila(page, 'Ana Ficticia')).toContainText('Sin responder');
    await expect(page.locator('#editmodal.show')).toBeVisible();
    verificarLimpio(e, { ignorar: [...RUIDO, /\[solicitud\]/] });
  });
});

test.describe('link del push: ?ir=agenda&solicitud=<id>', () => {
  test('abre la Agenda en el día del pedido y su modal, y limpia la dirección', async ({ page }) => {
    const d = datos();
    // Un pedido de dos semanas después: la Agenda arranca en hoy y tiene que saltar a su día.
    d.solicitudes.find(s => s.id === SOL).fecha = '2026-10-20';
    const e = await abrirApp(page, { datos: d, ruta: `/?ir=agenda&solicitud=${SOL}` });
    await expect(page.locator('#editmodal.show h2').first()).toHaveText('Familia Prueba Uno');
    await expect(fila(page, 'Carla Ejemplo')).toContainText('Puede');
    expect(await page.evaluate(() => moduloActivo)).toBe('agenda');
    expect(await page.evaluate(() => agendaAncla)).toBe('2026-10-20');
    expect(await page.evaluate(() => location.search)).toBe('');
    verificarLimpio(e);
  });

  test('un pedido de esta misma semana no mueve la Agenda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos(), ruta: `/?ir=agenda&solicitud=${SOL}` });
    await expect(page.locator('#editmodal.show h2').first()).toHaveText('Familia Prueba Uno');
    expect(await page.evaluate(() => agendaAncla)).toBe('2026-10-04');
    verificarLimpio(e);
  });

  test('un pedido que no existe: avisa y deja la Agenda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos(), ruta: '/?ir=agenda&solicitud=80000000-0000-4000-8000-0000000000ff' });
    await expect(page.locator('.toast', { hasText: 'No se encontró ese pedido' })).toBeVisible();
    await expect(page.locator('#editmodal.show')).toHaveCount(0);
    expect(await page.evaluate(() => moduloActivo)).toBe('agenda');
    verificarLimpio(e);
  });

  test('sin solicitud, como siempre: solo el módulo', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos(), ruta: '/?ir=agenda' });
    await page.waitForTimeout(300);
    await expect(page.locator('#editmodal.show')).toHaveCount(0);
    expect(await page.evaluate(() => moduloActivo)).toBe('agenda');
    verificarLimpio(e);
  });
});

test.describe('preferencia "Pedidos de la app"', () => {
  test('aparece con push prendido de entrada y se apaga', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await irAModulo(page, 'notificaciones');
    const f = page.locator('.notifcfg-row', { hasText: 'Pedidos de la app' });
    await expect(f).toHaveCount(1);
    await expect(f).toContainText('Cuando una niñera dice que puede o entra un pedido de WhatsApp');
    await expect(f.locator('input[type=checkbox]')).toBeChecked();
    await f.locator('.toggle').click();
    await expect.poll(() => e.escrituras.filter(w => w.tabla === 'notif_push_preferencias').map(w => w.cuerpo)).toEqual([{ usuario: 'prueba@ejemplo.test', tipo: 'pedidos', activado: false }]);
    verificarLimpio(e);
  });
});

test.describe('ficha de la familia: "No acepta niñeras nuevas"', () => {
  test('en Editar se tilda y se guarda solo_conocidas; la ficha lo muestra', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    await irAModulo(page, 'familias');
    await page.evaluate(id => editarFamilia(id), ID.fUno);
    const chk = page.locator('#ed-fam-solo-conocidas');
    await expect(chk).not.toBeChecked();
    await chk.check();
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect.poll(() => e.escrituras.filter(w => w.tabla === 'familias' && w.metodo === 'PATCH').length).toBe(1);
    const cambios = e.escrituras.find(w => w.tabla === 'familias' && w.metodo === 'PATCH').cuerpo;
    expect(cambios.solo_conocidas).toBe(true);
    expect(e.db.familias.find(f => f.id === ID.fUno).solo_conocidas).toBe(true);
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await expect(page.locator('#editmodal')).toContainText('No acepta niñeras nuevas');
    verificarLimpio(e);
  });

  test('sin tocar la casilla, un guardado común no manda la columna', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    await irAModulo(page, 'familias');
    await page.evaluate(id => editarFamilia(id), ID.fUno);
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect.poll(() => e.escrituras.filter(w => w.tabla === 'familias' && w.metodo === 'PATCH').length).toBe(1);
    expect('solo_conocidas' in e.escrituras.find(w => w.tabla === 'familias' && w.metodo === 'PATCH').cuerpo).toBe(false);
    verificarLimpio(e);
  });

  test('en el alta de una familia nueva', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    await irAModulo(page, 'familias');
    await page.evaluate(() => abrirModalNuevaFamilia());
    await page.locator('#fam-nombre').fill('Familia Prueba Nueve');
    await page.locator('#fam-solo-conocidas').check();
    await page.locator('#editmodal button', { hasText: 'Agregar familia' }).click();
    await expect.poll(() => e.escrituras.filter(w => w.tabla === 'familias' && w.metodo === 'POST').length).toBe(1);
    expect(e.escrituras.find(w => w.tabla === 'familias' && w.metodo === 'POST').cuerpo.solo_conocidas).toBe(true);
    verificarLimpio(e);
  });

  test('base sin migrar: se guarda igual sin la casilla y avisa; no rompe', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos(), baseSinMigrar: 'etapa5' });
    await irAModulo(page, 'familias');
    await page.evaluate(id => editarFamilia(id), ID.fUno);
    await page.locator('#ed-fam-nombre').fill('Familia Prueba Uno B');
    await page.locator('#ed-fam-solo-conocidas').check();
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('.toast', { hasText: 'falta actualizar la base' })).toBeVisible();
    await expect.poll(() => e.db.familias.find(f => f.id === ID.fUno).nombre).toBe('Familia Prueba Uno B');
    expect('solo_conocidas' in e.db.familias.find(f => f.id === ID.fUno)).toBe(false);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('base sin migrar: el alta guarda la familia sin la casilla y avisa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos(), baseSinMigrar: 'etapa5' });
    await irAModulo(page, 'familias');
    await page.evaluate(() => abrirModalNuevaFamilia());
    await page.locator('#fam-nombre').fill('Familia Prueba Nueve');
    await page.locator('#fam-solo-conocidas').check();
    await page.locator('#editmodal button', { hasText: 'Agregar familia' }).click();
    await expect(page.locator('.toast', { hasText: 'falta actualizar la base' })).toBeVisible();
    await expect.poll(() => e.db.familias.some(f => f.nombre === 'Familia Prueba Nueve')).toBe(true);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('base que falla al guardar: avisa y no cierra con éxito falso', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    await irAModulo(page, 'familias');
    await page.evaluate(id => editarFamilia(id), ID.fUno);
    await page.locator('#ed-fam-solo-conocidas').check();
    e.fallar = ({ tabla, metodo }) => (tabla === 'familias' && metodo === 'PATCH' ? { status: 500, message: 'falla simulada' } : null);
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('.toast', { hasText: 'No se pudo guardar' })).toBeVisible();
    expect(e.db.familias.find(f => f.id === ID.fUno).solo_conocidas).toBeFalsy();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('a 390 px la casilla mide 24 px y no desborda', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: datosPedidos() });
    await irAModulo(page, 'familias');
    await page.evaluate(id => editarFamilia(id), ID.fUno);
    const caja = await page.locator('#ed-fam-solo-conocidas').boundingBox();
    expect(Math.round(caja.width)).toBe(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    verificarLimpio(e);
  });
});

test.describe('cancelar un pedido que ya está asignado (revisión final, 01/11/2026)', () => {
  async function abrirYCancelar(page, filas) {
    const d = datos({ filas });
    Object.assign(d.solicitudes.find(x => x.id === SOL), { estado: 'confirmada' });
    const e = await abrirApp(page, { datos: d });
    await abrirModal(page);
    await page.locator('#editmodal button', { hasText: 'Cancelar solicitud' }).click();
    return e;
  }

  test('el texto dice la verdad: a la elegida no le llega aviso y hay que cancelar el registro', async ({ page }) => {
    const e = await abrirYCancelar(page, [sn(SN_CARLA, ID.nCarla, 'Carla Ejemplo', 'confirmada', { respondido_en: '2026-10-04T13:05:00Z' })]);
    await expect(page.locator('.confirmoverlay .confirmmsg')).toHaveText('¿Cancelar el pedido? A Carla Ejemplo no le llega ningún aviso: avisale por WhatsApp y cancelá el registro en Sittings & traslados.');
    verificarLimpio(e);
  });

  test('sin el nombre de la elegida: "la niñera"', async ({ page }) => {
    const e = await abrirYCancelar(page, [sn(SN_CARLA, null, '', 'confirmada')]);
    await expect(page.locator('.confirmoverlay .confirmmsg')).toHaveText('¿Cancelar el pedido? A la niñera no le llega ningún aviso: avisale por WhatsApp y cancelá el registro en Sittings & traslados.');
    verificarLimpio(e);
  });
});
