// El panel en la etapa 10 (fase 1, 02/11/2026; decisiones.md 6.7): "Carsitting para revisar" en Hoy (los datos, las
// fotos con link firmado, "Aprobar" y "Pedir de nuevo" con la condición de la revisión, el aviso y el chat que manda la
// base, dos admins, una actualización estando aprobada con lo de antes), el panel "Car sitting" de Niñeras (Completaron /
// Faltan / Sin app con "Invitar a la app"), la ficha de la niñera ("Carsitting pendiente" / "aprobado", las fotos de la
// app), el aviso al asignar un traslado sin el carsitting aprobado, RR.HH. sin el aviso de mails, las preferencias y la
// base sin migrar. Contra el simulador (tests/support/rpc-carsitting.js). Bruno hace solo traslados y Carla, sittings y
// traslados (con app). Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { datosBase, ID } = require('./support/datos');

const RUIDO = { ignorar: [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/] };
const FOTOS = ['licencia_frente', 'licencia_dorso', 'libreta_frente', 'libreta_dorso', 'asientos', 'auto_dentro', 'auto_fuera'];
const CS = '90000000-0000-4000-8000-0000000000b1';
function filaCarla(extra = {}) {
  return { id: CS, ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', nombre_completo: 'Carla Ejemplo Prueba', cedula: '1.234.567-8',
    numero_licencia: '0001234', anio_licencia: '2019', modelo_auto: 'Auto Inventado', anio_fabricacion: '2018', color_auto: 'Gris',
    matricula: 'AAA 0001', padron: '000111', libreta_propiedad: null, compania_seguro: 'Seguros de Prueba', tipo_seguro: 'Total',
    cantidad_asientos: '5', cantidad_cinturones: '5', fotos: Object.fromEntries(FOTOS.map(k => [k, `carsitting/${ID.nCarla}/${k}_0a1b2c3d.jpg`])),
    enviado_en: '2026-10-03T15:00:00Z', revision: 'pendiente', revisado_en: null, revisado_por: null, comentario: null,
    aprobado_en: null, aprobado_por: null, aprobado_datos: null, created_at: '2026-10-03T15:00:00Z', ...extra };
}
function datos(filas = []) {
  const d = datosBase();
  d.carsitting_datos = filas;
  d.app_config.find(c => c.id === 'pedidos_app').valor.solo_practica = false;
  return d;
}
const AVISOS_DE_ANTES = new Set((datosBase().avisos || []).map(a => a.id));
const avisosNuevos = e => (e.db.avisos || []).filter(a => !AVISOS_DE_ANTES.has(a.id));
const tarjeta = page => page.locator('#dash-carsitting .cs-revisar-card');
async function abrirRevision(page) {
  await tarjeta(page).getByRole('button', { name: 'Revisar' }).click();
  await expect(page.locator('#editmodal h2')).toHaveText('Carsitting de Carla Ejemplo');
}

test.describe('Carsitting para revisar (Hoy)', () => {
  test('la tarjeta, los datos y las 7 fotos; "Aprobar" con la condición y el aviso a la niñera', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([filaCarla()]) });
    await expect(tarjeta(page).locator('h2')).toHaveText('Carsitting para revisar');
    await expect(tarjeta(page).locator('.cs-revisar-fila')).toContainText('Lo mandó el 03/10');
    await abrirRevision(page);
    await expect(page.locator('#editmodal .fichadl')).toContainText('MatrículaAAA 0001');
    await expect(page.locator('#editmodal .fichadl')).toContainText('Número de la libreta de propiedad—');
    await expect(page.locator('#editmodal .cs-fotos button')).toHaveCount(7);
    await page.locator('#editmodal button', { hasText: 'Aprobar' }).click();
    await expect(page.locator('.toaststack .toast', { hasText: 'Carsitting aprobado.' })).toBeVisible();
    const w = e.escrituras.filter(x => x.tabla === 'carsitting_datos' && x.metodo === 'PATCH');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ cuerpo: { revision: 'aprobado', revisado_por: 'Prueba' }, params: { id: `eq.${CS}`, revision: 'eq.pendiente' } });
    expect(e.db.carsitting_datos[0]).toMatchObject({ revision: 'aprobado', aprobado_por: 'Prueba' });
    expect(avisosNuevos(e).filter(a => a.para_ninera_id === ID.nCarla).map(a => [a.titulo, a.cuerpo])).toEqual([['Tu carsitting quedó aprobado', 'Gracias por completar los datos.']]);
    await expect(page.locator('#dash-carsitting')).toBeEmpty();
    verificarLimpio(e);
  });

  test('"Ver" una foto pide el link firmado del bucket privado', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([filaCarla()]) });
    await page.evaluate(() => { window.__abiertas = []; window.open = url => { window.__abiertas.push(url); return null; }; });
    await abrirRevision(page);
    await page.locator('#editmodal .cs-fotos button', { hasText: 'Asientos de atrás' }).click();
    await expect.poll(() => page.evaluate(() => window.__abiertas.length)).toBe(1);
    expect(e.escrituras.some(w => w.tabla === `/storage/v1/object/sign/ninieras-privado/carsitting/${ID.nCarla}/asientos_0a1b2c3d.jpg`)).toBe(true);
    verificarLimpio(e);
  });

  test('"Pedir de nuevo": sin comentario no deja; con comentario le llega por el chat', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([filaCarla()]) });
    await abrirRevision(page);
    const pedir = page.locator('#editmodal button', { hasText: 'Pedir de nuevo' });
    await pedir.click();
    await expect(page.locator('#cs-revisar-warn')).toHaveText('Escribí qué tiene que corregir: le llega por el chat.');
    expect(e.escrituras.filter(x => x.tabla === 'carsitting_datos')).toEqual([]);
    await page.fill('#cs-comentario', 'La foto del dorso de la licencia está borrosa.');
    await pedir.click();
    await expect(page.locator('.toaststack .toast', { hasText: 'le llega por el chat' })).toBeVisible();
    expect(e.db.carsitting_datos[0]).toMatchObject({ revision: 'rehacer', comentario: 'La foto del dorso de la licencia está borrosa.', aprobado_en: null });
    expect(e.db.chat_mensajes.filter(m => m.ninera_id === ID.nCarla && m.de === 'admin').map(m => [m.autor, m.texto]).at(-1))
      .toEqual(['Prueba', 'Hay que corregir algo de tus datos de carsitting: La foto del dorso de la licencia está borrosa.']);
    verificarLimpio(e);
  });

  test('otra admin ya lo revisó: no se pisa y avisa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([filaCarla()]) });
    await abrirRevision(page);
    Object.assign(e.db.carsitting_datos[0], { revision: 'aprobado', aprobado_en: '2026-10-04T13:00:00Z', aprobado_por: 'Otra Admin' });
    await page.locator('#editmodal button', { hasText: 'Aprobar' }).click();
    await expect(page.locator('#cs-revisar-warn')).toContainText('alguien más ya lo revisó');
    expect(e.db.carsitting_datos[0].aprobado_por).toBe('Otra Admin');
    verificarLimpio(e);
  });

  test('una actualización estando aprobada: dice que sigue aprobada y muestra lo de antes', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([filaCarla({ modelo_auto: 'Otro Auto Inventado', enviado_en: '2026-10-04T10:00:00Z', aprobado_en: '2026-10-03T16:00:00Z',
      aprobado_datos: { ...filaCarla(), modelo_auto: 'Auto Inventado' } })]) });
    await expect(tarjeta(page)).toContainText('Actualizó los datos del auto el 04/10 (sigue aprobada con los de antes)');
    await abrirRevision(page);
    await expect(page.locator('#editmodal .fichadl')).toContainText('ModeloOtro Auto Inventado (antes: Auto Inventado)');
    await expect(page.locator('#editmodal .fichadl')).not.toContainText('antes: Gris');
    verificarLimpio(e);
  });

  test('si falla, lo dice y no cierra; escapado', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([filaCarla({ ninera_nombre: 'Carla <img src=x onerror="window.__ataque=1">', modelo_auto: '<b>Auto</b>' })]) });
    await tarjeta(page).getByRole('button', { name: 'Revisar' }).click();
    await expect(page.locator('#editmodal h2')).toHaveText('Carsitting de Carla <img src=x onerror="window.__ataque=1">');
    await expect(page.locator('#editmodal .fichadl')).toContainText('<b>Auto</b>');
    e.fallar = ({ tabla, metodo }) => tabla === 'carsitting_datos' && metodo === 'PATCH' ? { status: 500, message: 'falla simulada' } : undefined;
    await page.locator('#editmodal button', { hasText: 'Aprobar' }).click();
    await expect(page.locator('#cs-revisar-warn')).toContainText('falla simulada');
    expect(e.db.carsitting_datos[0].revision).toBe('pendiente');
    expect(await page.evaluate(() => window.__ataque)).toBeUndefined();
    verificarLimpio(e, RUIDO);
  });
});

test.describe('Niñeras y la ficha', () => {
  test('el panel "Car sitting": Completaron, Faltan y Sin app con "Invitar a la app"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([filaCarla()]) });
    await irAModulo(page, 'ninieras');
    const panel = page.locator('#nin-carsitting');
    await expect(panel).toContainText('Faltan 1');
    await panel.locator('span', { hasText: 'Car sitting' }).click();
    await expect(panel.locator('.cs-fila')).toHaveCount(2);
    await expect(panel).toContainText('Completaron (1)');
    await expect(panel.locator('.cs-fila', { hasText: 'Carla Ejemplo' })).toContainText('Para revisar');
    await expect(panel).toContainText('Sin app (1)');
    await panel.locator('.cs-fila', { hasText: 'Bruno Inventado' }).getByRole('button', { name: 'Invitar a la app' }).click();
    await expect(page.locator('#vn-app')).toBeVisible();
    await expect(page.locator('#vn-app button', { hasText: 'Invitar a la app' })).toBeVisible();
    verificarLimpio(e);
  });

  test('la ficha: "Carsitting pendiente" mientras no está aprobado; aprobado, con las fotos de la app', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([filaCarla()]) });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => verNinera(id), ID.nCarla);
    const sec = page.locator('#vn-carsitting');
    await expect(sec.locator('.cs-marca')).toHaveText('Carsitting pendiente');
    await expect(sec.locator('.cs-estado')).toHaveText('Lo mandó el 03/10: está para revisar en Hoy.');
    Object.assign(e.db.carsitting_datos[0], { revision: 'aprobado', aprobado_en: '2026-10-04T13:00:00Z' });
    await page.evaluate(() => cerrarModal());
    await page.evaluate(id => verNinera(id), ID.nCarla);
    await expect(sec.locator('.cs-marca')).toHaveText('Carsitting aprobado');
    await expect(sec.locator('button')).toHaveCount(7);
    verificarLimpio(e);
  });

  test('la ficha de una sin app: sin la marca (no lo puede completar), con los mails del formulario de siempre', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([]) });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => verNinera(id), ID.nBruno);
    const sec = page.locator('#vn-carsitting');
    await expect(sec).toContainText('Hace traslados pero todavía no completó el form de carsitting.');
    await expect(sec.locator('.cs-marca')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('la ficha de una con app que no lo completó: lo pide la app, sin los mails del formulario', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([]) });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => verNinera(id), ID.nCarla);
    const sec = page.locator('#vn-carsitting');
    await expect(sec.locator('.cs-marca')).toHaveText('Carsitting pendiente');
    await expect(sec).toContainText('Todavía no completó los datos en la app: se los pide la app.');
    await expect(sec).not.toContainText('Enviar mail de carsitting');
    verificarLimpio(e);
  });

  test('RR.HH. ya no tiene el aviso de "Pendientes de carsitting"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([]) });
    await irAModulo(page, 'rrhh');
    await expect(page.locator('.subnav')).toBeVisible();
    await expect(page.locator('#modcontent')).not.toContainText('Pendientes de carsitting');
    verificarLimpio(e);
  });

  test('las preferencias de avisos tienen "Carsitting"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([]) });
    expect(await page.evaluate(() => TIPOS_NOTIF.some(t => t.tipo === 'carsitting' && t.defaultPush))).toBe(true);
    verificarLimpio(e);
  });
});

test.describe('asignar un traslado', () => {
  async function nuevaSolicitudTraslado(page) {
    await irAModulo(page, 'agenda');
    await page.locator('button', { hasText: '+ Nueva solicitud' }).click();
    await page.fill('#agenda-familia', 'Familia Prueba Dos');
    await page.selectOption('#agenda-tipo', 'traslado');
  }
  async function elegir(page, texto, nombre) {
    await page.fill('#agenda-ninera', texto);
    await page.locator('#agenda-ninera-dropdown .autocomplete-item', { hasText: nombre }).click();
  }

  test('"+ Nueva solicitud": a una niñera con app sin el carsitting aprobado, aviso sin frenar; aprobada, nada', async ({ page }) => {
    const d = datos([filaCarla({ revision: 'aprobado', aprobado_en: '2026-10-03T16:00:00Z' })]);
    d.ninieras.find(n => n.id === ID.nBruno).user_id = '00000000-0000-4000-8000-0000000000b2';
    const e = await abrirApp(page, { datos: d });
    await nuevaSolicitudTraslado(page);
    await elegir(page, 'bru', 'Bruno Inventado');
    await expect(page.locator('#agenda-carsitting-aviso')).toHaveText('Bruno Inventado no tiene el carsitting aprobado. La podés asignar igual.');
    await page.waitForTimeout(200);
    await elegir(page, 'carla', 'Carla Ejemplo');
    await expect(page.locator('#agenda-carsitting-aviso')).toBeEmpty();
    // Un sitting no avisa.
    await page.selectOption('#agenda-tipo', 'sitting');
    await expect(page.locator('#agenda-carsitting-aviso')).toBeEmpty();
    verificarLimpio(e);
  });

  test('a una niñera sin app no le sale el aviso (no lo puede completar)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([]) });
    await nuevaSolicitudTraslado(page);
    await elegir(page, 'bru', 'Bruno Inventado');
    await expect(page.locator('#agenda-ninera')).toHaveValue('Bruno Inventado');
    // Espera a que terminen las dos lecturas del aviso.
    await expect.poll(() => page.evaluate(() => document.getElementById('agenda-carsitting-aviso')?.dataset.ninera)).toBeTruthy();
    await page.waitForTimeout(300);
    await expect(page.locator('#agenda-carsitting-aviso')).toBeEmpty();
    verificarLimpio(e);
  });

  test('base sin la migración de la etapa 10: ni tarjeta en Hoy, ni panel, ni aviso al asignar', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos([]), baseSinMigrar: 'etapa10' });
    await expect(page.locator('#dash-carsitting')).toBeEmpty();
    await nuevaSolicitudTraslado(page);
    await elegir(page, 'bru', 'Bruno Inventado');
    await expect(page.locator('#agenda-ninera')).toHaveValue('Bruno Inventado');
    await page.waitForTimeout(300);
    await expect(page.locator('#agenda-carsitting-aviso')).toBeEmpty();
    await page.evaluate(() => cerrarModal());
    await irAModulo(page, 'ninieras');
    await expect(page.locator('#nin-carsitting')).toHaveCount(0);
    verificarLimpio(e, RUIDO);
  });

  test('a 390 px: la revisión entra en la pantalla (captura)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: datos([filaCarla()]) });
    await abrirRevision(page);
    expect(await page.evaluate(() => { const b = document.querySelector('#editmodal .confirmbox'); return b.scrollWidth <= b.clientWidth; })).toBe(true);
    await page.locator('#editmodal').screenshot({ path: 'test-results/carsitting-revisar-390.png' });
    verificarLimpio(e);
  });
});
