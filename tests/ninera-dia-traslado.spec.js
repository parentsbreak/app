// App de niñeras (fase 1, etapa 11b, 03/11/2026): el día y el cierre de un traslado (decisiones.md 6.10). La tarjeta
// del inicio desde 3 horas antes ("Traslado de hoy", la hora de salida y las zonas), "Estoy saliendo", "Voy a llegar
// tarde", "No están los chicos", "Ya los busqué" y "Ya los dejé", que abre el cierre; un fijo, solo "Ya los busqué" /
// "Ya los dejé". El cierre sin hora: el gasto (peajes o estacionamiento, con la foto) y los comentarios. Fallas, doble
// toque, base sin migrar 'etapa11b', escape, sin montos y 390 px. Contra el simulador (tests/support/rpc-dia.js, la
// misma regla que la base). Ana tiene un traslado hoy, domingo 04/10/2026, a las 18:00, de Punta Carretas a Centro,
// con Familia Prueba Uno (casa en Pocitos). Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { errorRpc } = require('./support/rpc-ninera');
const { ID, datosBase } = require('./support/datos');

const RUIDO = { ignorar: [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[el día\]/] };
const TID = '70000000-0000-4000-8000-000000000005';
const SOL = '80000000-0000-4000-8000-0000000000b1';
const PLATA = /\$\d/;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const FALLA_GUARDAR = 'No pudimos guardarlo. Revisa tu conexión a internet y vuelve a intentar.';

// El sitting de Ana de hoy pasa a ser un traslado del pedido SOL (o de un fijo, sin pedido).
function datosTraslado({ fijo = false, zonas = ['Punta Carretas', 'Centro'] } = {}) {
  const d = datosBase();
  Object.assign(d.sittings_traslados.find(s => s.id === TID), { tipo: 'traslado', hora_fin: null, solicitud_id: fijo ? null : SOL,
    asignacion_id: fijo ? ID.aFijo : null, origen: 'Origen Inventado 1', destino: 'Destino Inventado 2' });
  if (!fijo) d.solicitudes.push({ id: SOL, familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', tipo: 'traslado', zona: zonas[0],
    destino_zona: zonas[1], origen: 'Origen Inventado 1', destino: 'Destino Inventado 2', km: 5, fecha: '2026-10-04', hora_inicio: '18:00:00',
    hora_fin: null, cobro_familia: null, estado: 'confirmada', notas: null, created_at: '2026-10-01T00:00:00Z', termina_dia_siguiente: false });
  return d;
}
// Ana con el perfil completo y sin PushManager (si no, salen las pantallas de la primera vez y de los avisos).
// hora: la hora de Montevideo del domingo 04/10 (o 'AAAA-MM-DDTHH:MM' para otro día).
async function abrir(page, { hora = '17:00', datos = datosTraslado(), ...opciones } = {}) {
  Object.assign(datos.ninieras.find(n => n.id === ID.nAna), { zona: 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00' });
  await page.addInitScript(() => { delete window.PushManager; });
  const ahora = `${hora.includes('T') ? hora : `2026-10-04T${hora}`}:00-03:00`;
  const e = await abrirAppNinera(page, { ...opciones, datos, ahora });
  if (!opciones.ruta) await expect(page.locator('#inicio-dia[data-cargada]')).toBeAttached();
  return e;
}
const tarjeta = page => page.locator(`#inicio-dia .tarjeta-dia[data-sitting="${TID}"]`);
const botones = page => tarjeta(page).locator('.dia-botones button');
const rpcs = (e, nombre) => e.escrituras.filter(w => w.tabla === `rpc/${nombre}`).map(w => w.cuerpo);
const avisosAdmin = e => (e.db.avisos || []).filter(a => a.para_admin && a.clave.startsWith('admin:sitting:')).map(a => [a.titulo, a.cuerpo]);
async function abrirCierre(page) {
  await tarjeta(page).getByRole('button', { name: 'Ya los dejé' }).click();
  await expect(page.locator('h1')).toHaveText('Cierre del traslado');
}

test.describe('la tarjeta del traslado', () => {
  test('antes de las 3 horas previas no hay tarjeta; desde ahí, la hora, las zonas, la madre y los botones', async ({ page }) => {
    const e = await abrir(page, { hora: '14:59' });
    await expect(page.locator('#inicio-dia .tarjeta-dia')).toHaveCount(0);
    expect(e.lecturasRpc.map(w => w.tabla)).toContain('rpc/ninera_mi_dia');
    verificarLimpio(e);
    const e2 = await abrir(page, { hora: '15:00' });
    await expect(tarjeta(page).locator('h2')).toHaveText('Traslado de hoy');
    await expect(tarjeta(page).locator('.dia-cuando')).toHaveText('A las 18:00, de Punta Carretas a Centro');
    await expect(tarjeta(page).locator('.helper')).toHaveText('Madre: Familia U.');
    await expect(botones(page)).toHaveText(['Estoy saliendo', 'Voy a llegar tarde', 'No están los chicos', 'Ya los busqué']);
    // Sin la ficha de la familia (es de los sittings).
    await expect(tarjeta(page).getByRole('button', { name: 'Ficha de la familia' })).toHaveCount(0);
    verificarLimpio(e2);
  });

  test('"Estoy saliendo": cuerpo exacto, la hora en la tarjeta y sin aviso al equipo', async ({ page }) => {
    const e = await abrir(page, { hora: '17:20' });
    await tarjeta(page).getByRole('button', { name: 'Estoy saliendo' }).click();
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Saliste a las 17:20.']);
    await expect(tarjeta(page).getByRole('button', { name: 'Estoy saliendo' })).toHaveCount(0);
    expect(rpcs(e, 'ninera_marcar_evento')).toEqual([{ p_sitting_id: TID, p_tipo: 'saliendo' }]);
    expect(avisosAdmin(e)).toEqual([]);
    verificarLimpio(e);
  });

  test('"Voy a llegar tarde" y "No están los chicos": quedan escritos y avisan al equipo con el traslado', async ({ page }) => {
    const e = await abrir(page, { hora: '17:50' });
    await tarjeta(page).getByRole('button', { name: 'Voy a llegar tarde' }).click();
    await page.locator('#modal-ninera').getByRole('button', { name: '20 min' }).click();
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Avisaste que llegas 20 min tarde. Le avisamos al equipo.']);
    await tarjeta(page).getByRole('button', { name: 'No están los chicos' }).click();
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Avisaste que llegas 20 min tarde. Le avisamos al equipo.',
      'Avisaste que no están los chicos. Le avisamos al equipo.']);
    await expect(tarjeta(page).getByRole('button', { name: 'No están los chicos' })).toHaveCount(0);
    expect(rpcs(e, 'ninera_marcar_evento')).toEqual([{ p_sitting_id: TID, p_tipo: 'tarde', p_minutos: 20 }, { p_sitting_id: TID, p_tipo: 'no_estan' }]);
    expect(avisosAdmin(e)).toEqual([['Ana Ficticia va a llegar 20 min tarde', 'Al traslado de Familia Prueba Uno.'],
      ['Ana Ficticia llegó y no están los chicos', 'Traslado de Familia Prueba Uno.']]);
    verificarLimpio(e);
  });

  test('ya es la hora: "Ya los busqué" deja solo "Ya los dejé", que abre el cierre', async ({ page }) => {
    const e = await abrir(page, { hora: '18:10' });
    await expect(botones(page)).toHaveText(['Voy a llegar tarde', 'No están los chicos', 'Ya los busqué', 'Ya los dejé']);
    await tarjeta(page).getByRole('button', { name: 'Ya los busqué' }).click();
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Los buscaste a las 18:10.']);
    await expect(botones(page)).toHaveText(['Ya los dejé']);
    await expect(botones(page)).toHaveClass(/primary/);
    await abrirCierre(page);
    expect(page.url()).toContain(`#sitting/${TID}/cierre`);
    expect(rpcs(e, 'ninera_marcar_evento')).toEqual([{ p_sitting_id: TID, p_tipo: 'busque' }, { p_sitting_id: TID, p_tipo: 'deje' }]);
    expect(avisosAdmin(e)).toEqual([]);
    // "Volver" sin mandar: la tarjeta dice cuándo los dejó y ofrece "Cerrar el traslado".
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Los buscaste a las 18:10.', 'Los dejaste a las 18:10.']);
    await expect(botones(page)).toHaveText(['Cerrar el traslado']);
    await botones(page).click();
    await expect(page.locator('h1')).toHaveText('Cierre del traslado');
    verificarLimpio(e);
  });

  test('un fijo: solo "Ya los busqué" y, ya empezado, "Ya los dejé"; sin pedido, la zona de la casa (decisiones 4.10)', async ({ page }) => {
    const e = await abrir(page, { hora: '17:00', datos: datosTraslado({ fijo: true }) });
    await expect(botones(page)).toHaveText(['Ya los busqué']);
    await expect(tarjeta(page).locator('.dia-cuando')).toHaveText('A las 18:00, desde Pocitos');
    verificarLimpio(e);
    const e2 = await abrir(page, { hora: '18:05', datos: datosTraslado({ fijo: true }) });
    await expect(botones(page)).toHaveText(['Ya los busqué', 'Ya los dejé']);
    verificarLimpio(e2);
  });

  test('el de ayer sin cerrar: "Traslado de ayer" con "Ya los dejé"', async ({ page }) => {
    const e = await abrir(page, { hora: '2026-10-05T09:00' });
    await expect(tarjeta(page).locator('h2')).toHaveText('Traslado de ayer');
    await expect(botones(page)).toContainText(['Ya los dejé']);
    verificarLimpio(e);
  });

  test('si marcar falla, el aviso queda en la tarjeta y no abre el cierre; doble toque: una sola vez', async ({ page }) => {
    const e = await abrir(page, { hora: '18:10' });
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_marcar_evento' ? 'red' : null;
    await tarjeta(page).getByRole('button', { name: 'Ya los dejé' }).click();
    await expect(tarjeta(page).locator('.dia-error')).toHaveText(FALLA_GUARDAR);
    await expect(page.locator('h1')).toHaveText('Hola, Ana');
    e.fallar = null;
    e.demoraEscrituras = 400;
    const boton = tarjeta(page).getByRole('button', { name: 'Ya los busqué' });
    await boton.click();
    await boton.click({ force: true }).catch(() => {});
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Los buscaste a las 18:10.']);
    expect(rpcs(e, 'ninera_marcar_evento').filter(c => c.p_tipo === 'busque')).toHaveLength(1);
    verificarLimpio(e, RUIDO);
  });

  test('ya cerrado desde otro celular: lo dice con "traslado"', async ({ page }) => {
    const e = await abrir(page, { hora: '18:10' });
    e.rpc.ninera_marcar_evento = () => { throw errorRpc('ya_cerrado'); };
    await tarjeta(page).getByRole('button', { name: 'Ya los busqué' }).click();
    await expect(tarjeta(page).locator('.dia-error')).toHaveText('Este traslado ya está cerrado.');
    verificarLimpio(e, RUIDO);
  });
});

test.describe('el cierre del traslado', () => {
  test('sin hora ni "Se extendió"; sin gasto: lo que falta, el cuerpo exacto, "¡Gracias, Ana!" y los avisos', async ({ page }) => {
    const e = await abrir(page, { hora: '18:40' });
    await abrirCierre(page);
    await expect(page.locator('.pantalla-cierre > .helper')).toHaveText('Traslado de hoy, a las 18:00, de Punta Carretas a Centro.');
    await expect(page.locator('#cierre-hora')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Se extendió el sitting' })).toHaveCount(0);
    await expect(page.locator('#cierre-estrellas, input[name="cierre-estrellas"], #cierre-jugaron')).toHaveCount(0);
    await expect(page.locator('legend')).toHaveText(['¿Pagaste peajes, estacionamiento u otro gasto?']);
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('#cierre-error')).toHaveText('Responde si pagaste algún gasto.');
    expect(rpcs(e, 'ninera_cerrar_traslado')).toEqual([]);
    await page.locator('input[name="cierre-gasto"][value="no"]').check();
    await page.locator('#cierre-comentarios').fill('  Había mucho tránsito en la rambla.  ');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('h1')).toHaveText('¡Gracias, Ana!');
    expect(rpcs(e, 'ninera_cerrar_traslado')).toEqual([{ p_sitting_id: TID, p_comentarios: 'Había mucho tránsito en la rambla.',
      p_gasto_monto: null, p_gasto_concepto: null }]);
    expect(rpcs(e, 'ninera_cerrar_sitting')).toEqual([]);
    expect(e.db.sitting_cierres).toEqual([expect.objectContaining({ sitting_id: TID, hora_fin: null, termina_dia_siguiente: false,
      comentarios: 'Había mucho tránsito en la rambla.', gasto_monto: null })]);
    expect(avisosAdmin(e)).toEqual([['Ana Ficticia cerró el traslado de Familia Prueba Uno', 'Revisalo en Hoy.'],
      ['Ana Ficticia dejó un comentario del traslado de Familia Prueba Uno', 'Leelo ahora.']]);
    await page.getByRole('button', { name: 'Volver al inicio' }).click();
    await expect(page.locator('#inicio-dia[data-cargada]')).toBeAttached();
    await expect(page.locator('#inicio-dia .tarjeta-dia')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('con gasto: monto, en qué y la foto son obligatorios; sube a su ruta y manda el gasto', async ({ page }) => {
    const e = await abrir(page, { hora: '18:40' });
    await abrirCierre(page);
    await page.locator('input[name="cierre-gasto"][value="si"]').check();
    await expect(page.locator('#cierre-gasto-concepto')).toHaveAttribute('placeholder', 'Peaje, estacionamiento');
    await expect(page.locator('#cierre-gasto-datos .helper')).toHaveText('Te lo reintegramos junto al pago.');
    const enviar = () => page.getByRole('button', { name: 'Enviar' }).click();
    await enviar();
    await expect(page.locator('#cierre-error')).toHaveText('Pon el monto del gasto.');
    await page.locator('#cierre-gasto-monto').fill('180');
    await enviar();
    await expect(page.locator('#cierre-error')).toHaveText('Escribe en qué fue el gasto.');
    await page.locator('#cierre-gasto-concepto').fill('  Peaje   y estacionamiento ');
    await enviar();
    await expect(page.locator('#cierre-error')).toHaveText('Saca una foto del comprobante.');
    expect(rpcs(e, 'ninera_cerrar_traslado')).toEqual([]);
    await page.setInputFiles('#cierre-gasto-foto', { name: 'ticket.png', mimeType: 'image/png', buffer: PNG });
    await enviar();
    await expect(page.locator('h1')).toHaveText('¡Gracias, Ana!');
    const subidas = e.escrituras.filter(w => w.tabla.startsWith('/storage/v1/object/comprobantes/')).map(w => w.tabla);
    expect(subidas).toEqual([`/storage/v1/object/comprobantes/ninieras/${ID.nAna}/${TID}.jpg`]);
    expect(rpcs(e, 'ninera_cerrar_traslado')).toEqual([{ p_sitting_id: TID, p_comentarios: null, p_gasto_monto: 180, p_gasto_concepto: 'Peaje y estacionamiento' }]);
    expect(e.db.sitting_cierres).toEqual([expect.objectContaining({ sitting_id: TID, hora_fin: null, gasto_monto: 180,
      gasto_concepto: 'Peaje y estacionamiento', gasto_comprobante: `ninieras/${ID.nAna}/${TID}.jpg`, gasto_id: null })]);
    // El cierre no toca la plata del registro ni crea un gasto extra: eso lo decide la admin.
    expect(e.escrituras.filter(w => ['sittings_traslados', 'gastos_extra'].includes(w.tabla))).toEqual([]);
    expect(avisosAdmin(e).map(([t]) => t)).toEqual(['Ana Ficticia cerró el traslado de Familia Prueba Uno', 'Ana Ficticia cargó un gasto de $180']);
    verificarLimpio(e);
  });

  test('si la foto no sube, no cierra y lo escrito queda; reintentar con doble toque cierra una vez', async ({ page }) => {
    const e = await abrir(page, { hora: '18:40' });
    await abrirCierre(page);
    await page.locator('input[name="cierre-gasto"][value="si"]').check();
    await page.locator('#cierre-gasto-monto').fill('90');
    await page.locator('#cierre-gasto-concepto').fill('Estacionamiento');
    await page.setInputFiles('#cierre-gasto-foto', { name: 'ticket.png', mimeType: 'image/png', buffer: PNG });
    e.fallar = ({ tabla }) => tabla.startsWith('/storage/v1/object/comprobantes/') ? 'red' : null;
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('#cierre-error')).toHaveText('No pudimos subir la foto del comprobante. Revisa tu conexión a internet y vuelve a intentar.');
    expect(rpcs(e, 'ninera_cerrar_traslado')).toEqual([]);
    await expect(page.locator('#cierre-gasto-concepto')).toHaveValue('Estacionamiento');
    e.fallar = null;
    e.demoraEscrituras = 400;
    const boton = page.getByRole('button', { name: 'Enviar' });
    await boton.click();
    await boton.click({ force: true }).catch(() => {});
    await expect(page.locator('h1')).toHaveText('¡Gracias, Ana!');
    expect(rpcs(e, 'ninera_cerrar_traslado')).toHaveLength(1);
    verificarLimpio(e, RUIDO);
  });

  test('si la base falla, lo dice y lo escrito queda; los errores de la base, en simple', async ({ page }) => {
    const e = await abrir(page, { hora: '18:40' });
    await abrirCierre(page);
    await page.locator('input[name="cierre-gasto"][value="no"]').check();
    await page.locator('#cierre-comentarios').fill('Todo bien');
    const casos = [
      ['red', FALLA_GUARDAR],
      [errorRpc('ya_revisado'), 'El equipo ya revisó este traslado. Si algo no está bien, escríbenos por el chat.'],
      [errorRpc('no_existe'), 'Este traslado ya no está en tu día. Si algo no está bien, escríbenos por el chat.'],
      [errorRpc('texto_largo'), 'Uno de los textos es muy largo. Acórtalo un poco.'],
      [errorRpc('no_autorizada'), 'Tu cuenta no está activa. Escríbenos por WhatsApp.'],
    ];
    for (const [falla, texto] of casos) {
      if (falla === 'red') e.fallar = ({ tabla }) => tabla === 'rpc/ninera_cerrar_traslado' ? 'red' : null;
      else { e.fallar = null; e.rpc.ninera_cerrar_traslado = () => { throw falla; }; }
      await page.getByRole('button', { name: 'Enviar' }).click();
      await expect(page.locator('#cierre-error')).toHaveText(texto);
      await expect(page.locator('#cierre-comentarios')).toHaveValue('Todo bien');
    }
    verificarLimpio(e, RUIDO);
  });

  test('el link del aviso (#sitting/<id>/cierre) abre el cierre del traslado; uno cerrado dice "Gracias"', async ({ page }) => {
    const e = await abrir(page, { hora: '18:45', ruta: `/ninera/#sitting/${TID}/cierre` });
    await expect(page.locator('h1')).toHaveText('Cierre del traslado');
    await page.locator('input[name="cierre-gasto"][value="no"]').check();
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('h1')).toHaveText('¡Gracias, Ana!');
    await page.evaluate(id => irA(`#sitting/${id}/cierre`), TID);
    await expect(page.locator('h1')).toHaveText('¡Gracias, Ana!');
    verificarLimpio(e);
  });
});

test.describe('lo demás', () => {
  test('base sin la migración (etapa11b): sin tarjeta del traslado ni cierre, y el resto anda', async ({ page }) => {
    const e = await abrir(page, { hora: '18:10', baseSinMigrar: 'etapa11b' });
    await expect(page.locator('#inicio-dia .tarjeta-dia')).toHaveCount(0);
    await expect(page.locator('#proximos-sittings-lista')).toContainText('18:00');
    await page.evaluate(id => irA(`#sitting/${id}/cierre`), TID);
    await expect(page.locator('h1')).toHaveText('Hola, Ana');
    verificarLimpio(e, RUIDO);
  });

  test('base sin la migración (etapa11b): el sitting de hoy sigue con su tarjeta de siempre', async ({ page }) => {
    const e = await abrir(page, { hora: '18:10', datos: datosBase(), baseSinMigrar: 'etapa11b' });
    await expect(tarjeta(page).locator('h2')).toHaveText('Sitting de hoy');
    await tarjeta(page).getByRole('button', { name: 'Ya entré' }).click();
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Entraste a las 18:10.']);
    verificarLimpio(e, RUIDO);
  });

  test('escape: las zonas y la madre con HTML no ejecutan nada', async ({ page }) => {
    const malo = '"><img src=x onerror="window.__xss=1">';
    const d = datosTraslado({ zonas: [malo, '<script>window.__xss=1</script>'] });
    d.familias.find(f => f.id === ID.fUno).nombre = '<img src=x onerror="window.__xss=1">';
    const e = await abrir(page, { hora: '18:30', datos: d });
    await expect(tarjeta(page).locator('.dia-cuando')).toContainText('<img');
    await abrirCierre(page);
    await expect(page.locator('.pantalla-cierre > .helper')).toContainText('<script>');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });

  test('nunca un monto en la tarjeta ni en el cierre', async ({ page }) => {
    const e = await abrir(page, { hora: '18:10' });
    expect(await tarjeta(page).innerText()).not.toMatch(PLATA);
    await abrirCierre(page);
    await page.locator('input[name="cierre-gasto"][value="si"]').check();
    expect(await page.locator('main').innerText()).not.toMatch(PLATA);
    expect(await page.locator('main').innerText()).not.toMatch(/cobro|tarifa|total|por viaje/i);
    verificarLimpio(e);
  });

  test('390 px: la tarjeta y el cierre sin scroll de costado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrir(page, { hora: '17:30' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('traslado-tarjeta-390.png'), fullPage: true });
    const e2 = await abrir(page, { hora: '18:40' });
    await abrirCierre(page);
    await page.locator('input[name="cierre-gasto"][value="si"]').check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('traslado-cierre-390.png'), fullPage: true });
    verificarLimpio(e);
    verificarLimpio(e2);
  });
});
