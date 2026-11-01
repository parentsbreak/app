// App de niñeras (fase 1, etapa 6, tarea 6.6, 03/11/2026): la tarjeta "¡Quedaste seleccionada!" arriba del inicio,
// el detalle del sitting con "Indicaciones", precio por hora y la marca de aproximado, los avisos de una sola vez
// ("Ya se cubrió" / "Se canceló") y "Cómo llegar" con Google Maps, Waze o Mapas. Todo contra el simulador. Hoy
// es el domingo 04/10/2026 a las 12:00 de Montevideo. La niñera de los tests es "Niñera (práctica)": el pedido
// de la Familia Prueba Uno es para el miércoles 07/10, de 18:00 a 22:00, a $200 la hora.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { ID, datosEleccion, sitting } = require('./support/datos');

const SN = ID.snPendPractica;
const SN_CUBIERTO = ID.snPedPractica;
const SOL = ID.sPendiente;
const REGISTRO = '70000000-0000-4000-8000-0000000000e1';
const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[pedidos\]|\[marcar_pedido_visto\]|\[ninera_mis_sittings\]/];
const RUIDO_SIN_MIGRAR = [/Failed to load resource: the server responded with a status of 404/];
const TARJETA = 'Miércoles 07/10, 18:00 – 22:00. Ya tienes todos los datos.';
const COMPLETAR = 'Los datos todavía no están completos: escríbenos.';
const MARCA = '(aproximada, se puede extender)';

// La niñera de práctica elegida para el pedido del 07/10 (lo que deja el trigger al pasar la fila a confirmada).
function datos({ registro = true, solicitud = {}, sn = {}, fam = {} } = {}) {
  const d = datosEleccion();
  const s = d.solicitudes.find(x => x.id === SOL);
  Object.assign(s, { estado: 'confirmada', familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', notas: 'Nota interna: no le gusta Prueba', ...solicitud });
  Object.assign(d.solicitud_ninieras.find(x => x.id === SN), { estado: 'confirmada', precio_hora: 200, seleccionada_en: '2026-10-04T14:30:00.000Z', ...sn });
  Object.assign(d.familias.find(f => f.id === ID.fUno), fam);
  d.ninieras.filter(n => n.id === ID.nPractica).forEach(n => Object.assign(n, { zona: 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00', app_activada_en: '2026-10-02T14:00:00+00:00' }));
  if (registro) {
    d.sittings_traslados.push(sitting(REGISTRO, '2026-10-07', { familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', ninera_id: ID.nPractica, ninera_nombre: 'Niñera (práctica)',
      hora_inicio: '18:00:00', hora_fin: '22:00:00', estado: 'confirmado', solicitud_id: SOL, cobro_familia: 1520, pago_ninera: 800 }));
  }
  return d;
}
async function abrir(page, opciones = {}) {
  await page.addInitScript(() => { delete window.PushManager; });
  return abrirAppNinera(page, { ninera: ID.nPractica, datos: datos(), ...opciones });
}
function rpcs(e, nombre) { return e.escrituras.filter(w => w.tabla === `rpc/${nombre}`).map(w => w.cuerpo); }
const modal = page => page.locator('#modal-ninera');
const tarjeta = page => page.locator('#pedidos-seleccionada');
const boton = (page, nombre) => page.getByRole('button', { name: nombre, exact: true });
const FALLA_MARCAR = p => (p.tabla === 'rpc/ninera_marcar_pedido_visto' ? { status: 500, message: 'falla simulada' } : undefined);

test.describe('¡Quedaste seleccionada!', () => {
  test('la tarjeta arriba de todo, con su texto y "Ver los datos", sin plata', async ({ page }) => {
    const e = await abrir(page);
    await expect(tarjeta(page)).toBeVisible();
    await expect(tarjeta(page).locator('h2')).toHaveText('¡Quedaste seleccionada!');
    await expect(tarjeta(page).locator('p').first()).toHaveText(TARJETA);
    await expect(boton(page, 'Ver los datos')).toBeVisible();
    const texto = await tarjeta(page).innerText();
    expect(texto).not.toMatch(/\$/);
    // Arriba de los pedidos por responder y de "Próximos sittings".
    const orden = await page.evaluate(() => ['#pedidos-seleccionada', '#proximos-sittings'].map(s => document.querySelector(s).getBoundingClientRect().top));
    expect(orden[0]).toBeLessThan(orden[1]);
    // No es "Sin pedidos".
    await expect(page.locator('#pedidos-lista')).not.toContainText('No tienes pedidos por ahora.');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('con la marca de aproximado, el horario lo dice', async ({ page }) => {
    const e = await abrir(page, { datos: datos({ solicitud: { horario_aproximado: true } }) });
    await expect(tarjeta(page).locator('p').first()).toHaveText(`Miércoles 07/10, 18:00 – 22:00 ${MARCA}. Ya tienes todos los datos.`);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('"Ver los datos": el detalle con el título, dirección, madre, chicos, Indicaciones y precio por hora; marca visto', async ({ page }) => {
    const d = datos({ solicitud: { notas_para_ninera: 'Hay un perro. Tocar el timbre 5.', horario_aproximado: true } });
    const e = await abrir(page, { datos: d });
    await boton(page, 'Ver los datos').click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('.modal-titulo')).toHaveText('¡Quedaste seleccionada!');
    await expect(modal(page)).toContainText(`18:00 a 22:00 ${MARCA}`);
    await expect(modal(page)).toContainText('Zona: Pocitos');
    await expect(modal(page)).toContainText('Madre: Familia U.');
    await expect(modal(page)).toContainText('Chicos: 2 chicos (3 y 5 años)');
    await expect(modal(page)).toContainText('Dirección: Calle Falsa 123');
    await expect(modal(page)).toContainText('Indicaciones: Hay un perro. Tocar el timbre 5.');
    await expect(modal(page)).toContainText('Precio por hora: $200');
    const texto = await modal(page).innerText();
    // Ningún monto salvo el precio por hora, y nada interno.
    expect(texto.match(/\$[\d.]+/g)).toEqual(['$200']);
    expect(texto).not.toMatch(/Nota interna|Prueba Uno|1\.520|800/);
    // La marca de visto: el cuerpo exacto, una sola vez, y la tarjeta se va.
    await expect.poll(() => rpcs(e, 'ninera_marcar_pedido_visto').length).toBe(1);
    expect(rpcs(e, 'ninera_marcar_pedido_visto')[0]).toEqual({ p_sn_id: SN });
    expect(e.db.solicitud_ninieras.find(x => x.id === SN).visto_en).not.toBeNull();
    await modal(page).getByRole('button', { name: 'Cerrar' }).click();
    await expect(tarjeta(page)).toHaveCount(0);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('sin Indicaciones ni precio, esas líneas no salen', async ({ page }) => {
    const e = await abrir(page, { datos: datos({ sn: { precio_hora: null }, solicitud: { notas_para_ninera: null } }) });
    await boton(page, 'Ver los datos').click();
    await expect(modal(page).locator('.modal-titulo')).toHaveText('¡Quedaste seleccionada!');
    await expect(modal(page)).not.toContainText('Indicaciones');
    await expect(modal(page)).not.toContainText('Precio por hora');
    await expect(modal(page)).not.toContainText(MARCA);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('desde "Próximos sittings" es el mismo detalle con el título "Sitting" y no marca nada', async ({ page }) => {
    const d = datos({ solicitud: { notas_para_ninera: 'Hay un perro.' } });
    const e = await abrir(page, { datos: d });
    await expect(page.locator('#proximos-sittings .sitting-tarjeta')).toHaveCount(1);
    await page.locator('#proximos-sittings .sitting-tarjeta').click();
    await expect(modal(page).locator('.modal-titulo')).toHaveText('Sitting');
    await expect(modal(page)).toContainText('Indicaciones: Hay un perro.');
    await expect(modal(page)).toContainText('Precio por hora: $200');
    await expect(modal(page)).toContainText('Dirección: Calle Falsa 123');
    expect(rpcs(e, 'ninera_marcar_pedido_visto')).toHaveLength(0);
    await modal(page).getByRole('button', { name: 'Cerrar' }).click();
    await expect(tarjeta(page)).toBeVisible();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('un sitting que no vino de un pedido no tiene Indicaciones ni precio por hora', async ({ page }) => {
    const e = await abrir(page, { datos: datos() });
    await page.locator('#proximos-sittings .sitting-tarjeta').click();
    // (El registro del pedido sí los tiene; el otro caso es el sitting de siempre, sin solicitud.)
    await modal(page).getByRole('button', { name: 'Cerrar' }).click();
    const d = datos();
    d.sittings_traslados.find(s => s.id === REGISTRO).solicitud_id = null;
    d.solicitud_ninieras = [];
    const e2 = await abrirAppNinera(page, { ninera: ID.nPractica, datos: d });
    await page.locator('#proximos-sittings .sitting-tarjeta').click();
    await expect(modal(page).locator('.modal-titulo')).toHaveText('Sitting');
    await expect(modal(page)).not.toContainText('Indicaciones');
    await expect(modal(page)).not.toContainText('Precio por hora');
    verificarLimpio(e, { ignorar: RUIDO });
    verificarLimpio(e2, { ignorar: RUIDO });
  });

  test('si el registro todavía no está, se ven los datos del pedido y "Los datos todavía no están completos"', async ({ page }) => {
    const e = await abrir(page, { datos: datos({ registro: false }) });
    await boton(page, 'Ver los datos').click();
    await expect(modal(page).locator('.modal-titulo')).toHaveText('¡Quedaste seleccionada!');
    await expect(modal(page)).toContainText('Miércoles 07/10');
    await expect(modal(page)).toContainText('18:00 – 22:00');
    await expect(modal(page)).toContainText('Zona: Pocitos');
    await expect(modal(page)).toContainText('Precio por hora: $200');
    await expect(modal(page)).toContainText(COMPLETAR);
    await expect(modal(page)).not.toContainText('Dirección');
    await expect(modal(page).getByRole('button', { name: 'Cómo llegar' })).toHaveCount(0);
    await expect.poll(() => rpcs(e, 'ninera_marcar_pedido_visto').length).toBe(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('si la marca de visto falla, no se rompe nada y la tarjeta vuelve la próxima vez', async ({ page }) => {
    const e = await abrir(page);
    e.fallar = FALLA_MARCAR;
    await boton(page, 'Ver los datos').click();
    await expect(modal(page).locator('.modal-titulo')).toHaveText('¡Quedaste seleccionada!');
    await expect(modal(page)).toContainText('Dirección: Calle Falsa 123');
    await expect.poll(() => e.errores.some(x => /marcar_pedido_visto/.test(x))).toBe(true);
    expect(e.db.solicitud_ninieras.find(x => x.id === SN).visto_en).toBeNull();
    e.fallar = null;
    await page.reload();
    await expect(tarjeta(page)).toBeVisible();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('doble toque en "Ver los datos": una sola marca', async ({ page }) => {
    const e = await abrir(page);
    e.demoraEscrituras = 300;
    await boton(page, 'Ver los datos').dblclick();
    await expect(modal(page)).toBeVisible();
    await expect.poll(() => rpcs(e, 'ninera_marcar_pedido_visto').length).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    expect(rpcs(e, 'ninera_marcar_pedido_visto')).toHaveLength(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('#pedido/<sn> desde el push abre los datos', async ({ page }) => {
    const e = await abrir(page, { ruta: `/ninera/#pedido/${SN}` });
    await expect(modal(page).locator('.modal-titulo')).toHaveText('¡Quedaste seleccionada!');
    await expect(modal(page)).toContainText('Dirección: Calle Falsa 123');
    await expect.poll(() => rpcs(e, 'ninera_marcar_pedido_visto').length).toBe(1);
    await expect(page.locator('#app')).not.toContainText('Este pedido ya no está abierto.');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('#pedido/<sn> de una selección que ya vio: el aviso de siempre', async ({ page }) => {
    const e = await abrir(page, { datos: datos({ sn: { visto_en: '2026-10-04T15:00:00.000Z' } }), ruta: `/ninera/#pedido/${SN}` });
    await expect(page.locator('#pedidos-aviso')).toHaveText('Este pedido ya no está abierto.');
    await expect(modal(page)).toHaveCount(0);
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('"Ya se cubrió" y "Se canceló"', () => {
  function datosAvisos(estado) {
    const d = datos();
    // Solo el aviso: la elegida ya vio sus datos.
    Object.assign(d.solicitud_ninieras.find(x => x.id === SN), { visto_en: '2026-10-04T15:00:00.000Z' });
    Object.assign(d.solicitud_ninieras.find(x => x.id === SN_CUBIERTO), { estado, respondido_en: '2026-10-04T14:05:00.000Z', visto_en: null });
    return d;
  }

  test('"Ya se cubrió" sale una vez, con su texto, y se marca visto', async ({ page }) => {
    const e = await abrir(page, { datos: datosAvisos('cubierto') });
    const aviso = page.locator('.aviso-pedido');
    await expect(aviso).toHaveCount(1);
    await expect(aviso).toHaveText('Este pedido ya se cubrió: Jueves 08/10. Gracias por responder. ¡Te tendremos en cuenta para el próximo!');
    await expect.poll(() => rpcs(e, 'ninera_marcar_pedido_visto').length).toBe(1);
    expect(rpcs(e, 'ninera_marcar_pedido_visto')[0]).toEqual({ p_sn_id: SN_CUBIERTO });
    expect(e.db.solicitud_ninieras.find(x => x.id === SN_CUBIERTO).visto_en).not.toBeNull();
    await expect(tarjeta(page)).toHaveCount(0);
    await expect(page.locator('#app')).not.toContainText('$');
    // La próxima vez ya no está.
    await page.reload();
    await expect(page.locator('#proximos-sittings')).toBeVisible();
    await expect(page.locator('.aviso-pedido')).toHaveCount(0);
    expect(rpcs(e, 'ninera_marcar_pedido_visto')).toHaveLength(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('"Se canceló el pedido" sale una vez, con su texto', async ({ page }) => {
    const e = await abrir(page, { datos: datosAvisos('cancelado') });
    await expect(page.locator('.aviso-pedido')).toHaveText('Se canceló el pedido del Jueves 08/10. Gracias por responder.');
    await expect.poll(() => rpcs(e, 'ninera_marcar_pedido_visto').length).toBe(1);
    await page.reload();
    await expect(page.locator('#proximos-sittings')).toBeVisible();
    await expect(page.locator('.aviso-pedido')).toHaveCount(0);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  // Adaptado (fix 03/11/2026): antes el aviso duraba hasta cambiar de pantalla; ahora, hasta cerrar sesión o recargar.
  test('si volver a la app lee de nuevo, el aviso que ya se mostró sigue a la vista', async ({ page }) => {
    const e = await abrir(page, { datos: datosAvisos('cubierto') });
    await expect(page.locator('.aviso-pedido')).toHaveCount(1);
    await expect.poll(() => rpcs(e, 'ninera_marcar_pedido_visto').length).toBe(1);
    await page.evaluate(() => cargarPedidosNinera({ silencioso: true }));
    await expect(page.locator('.aviso-pedido')).toHaveCount(1);
    expect(rpcs(e, 'ninera_marcar_pedido_visto')).toHaveLength(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('el aviso sobrevive a ir a otra pantalla y volver al inicio, y se va al cerrar sesión', async ({ page }) => {
    const e = await abrir(page, { datos: datosAvisos('cubierto') });
    await expect(page.locator('.aviso-pedido')).toHaveCount(1);
    await expect.poll(() => rpcs(e, 'ninera_marcar_pedido_visto').length).toBe(1);
    await page.evaluate(() => irA('#temporada'));
    await expect(page.locator('#inicio-pedidos')).toHaveCount(0);
    await page.evaluate(() => irA('#inicio'));
    await expect(page.locator('.aviso-pedido')).toHaveCount(1);
    await expect(page.locator('.aviso-pedido')).toContainText('Este pedido ya se cubrió');
    expect(rpcs(e, 'ninera_marcar_pedido_visto')).toHaveLength(1);
    await page.getByRole('button', { name: 'Mi cuenta' }).click();
    await modal(page).getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page.locator('#inicio-pedidos')).toHaveCount(0);
    expect(await page.evaluate(() => avisosCierreNinera.size)).toBe(0);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('si marcar falla, el aviso se ve igual y vuelve la próxima vez', async ({ page }) => {
    const e = await abrir(page, { datos: datosAvisos('cubierto') });
    await expect.poll(() => rpcs(e, 'ninera_marcar_pedido_visto').length).toBe(1);
    // Se vuelve a dejar sin ver y la base falla al marcar.
    e.db.solicitud_ninieras.find(x => x.id === SN_CUBIERTO).visto_en = null;
    e.fallar = FALLA_MARCAR;
    await page.reload();
    await expect(page.locator('.aviso-pedido')).toHaveCount(1);
    expect(e.db.solicitud_ninieras.find(x => x.id === SN_CUBIERTO).visto_en).toBeNull();
    e.fallar = null;
    await page.reload();
    await expect(page.locator('.aviso-pedido')).toHaveCount(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('"Cómo llegar"', () => {
  test('abre la elección con Google Maps, Waze y Mapas, con la dirección codificada', async ({ page }) => {
    const e = await abrir(page, { datos: datos({ fam: { direccion: 'Av. Brasil 1234 & Ejido, apto 5' } }) });
    await page.locator('#proximos-sittings .sitting-tarjeta').click();
    await expect(modal(page).getByRole('link')).toHaveCount(0);
    await modal(page).getByRole('button', { name: 'Cómo llegar' }).click();
    const q = encodeURIComponent('Av. Brasil 1234 & Ejido, apto 5');
    const esperados = [['Google Maps', `https://www.google.com/maps/search/?api=1&query=${q}`], ['Waze', `https://waze.com/ul?q=${q}&navigate=yes`], ['Mapas', `https://maps.apple.com/?q=${q}`]];
    for (const [nombre, href] of esperados) {
      const link = modal(page).getByRole('link', { name: nombre, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener');
    }
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('sin dirección, sin "Cómo llegar"', async ({ page }) => {
    const e = await abrir(page, { datos: datos({ fam: { direccion: null } }) });
    await page.locator('#proximos-sittings .sitting-tarjeta').click();
    await expect(modal(page).locator('.modal-titulo')).toHaveText('Sitting');
    await expect(modal(page).getByRole('button', { name: 'Cómo llegar' })).toHaveCount(0);
    await expect(modal(page).getByRole('link')).toHaveCount(0);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('una dirección con comillas y HTML no se ejecuta ni rompe los links', async ({ page }) => {
    const rara = 'Calle "Rara" <img src=x onerror=window.__xss=1> 5';
    const e = await abrir(page, { datos: datos({ fam: { direccion: rara } }) });
    await page.locator('#proximos-sittings .sitting-tarjeta').click();
    await modal(page).getByRole('button', { name: 'Cómo llegar' }).click();
    await expect(modal(page).getByRole('link', { name: 'Waze', exact: true })).toHaveAttribute('href', `https://waze.com/ul?q=${encodeURIComponent(rara)}&navigate=yes`);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('base sin migrar y pantallas', () => {
  test('base sin la migración de la etapa 6: el inicio como en la etapa 5, sin tarjeta ni errores', async ({ page }) => {
    const e = await abrir(page, { baseSinMigrar: 'etapa6' });
    await expect(page.locator('#proximos-sittings')).toBeVisible();
    await expect(tarjeta(page)).toHaveCount(0);
    await expect(page.locator('.aviso-pedido')).toHaveCount(0);
    // Lo único que ve es lo de la etapa 5: el pedido que sigue esperando confirmación.
    await expect(page.locator('#pedidos-esperando')).toBeVisible();
    expect(rpcs(e, 'ninera_marcar_pedido_visto')).toHaveLength(0);
    // El detalle del sitting sigue andando, sin Indicaciones ni precio.
    await page.locator('#proximos-sittings .sitting-tarjeta').click();
    await expect(modal(page)).toContainText('Dirección: Calle Falsa 123');
    await expect(modal(page)).not.toContainText('Indicaciones');
    verificarLimpio(e, { ignorar: [...RUIDO, ...RUIDO_SIN_MIGRAR] });
  });

  test('si marcar visto da 404 (base sin la función), no se rompe', async ({ page }) => {
    const e = await abrir(page);
    e.fallar = p => (p.tabla === 'rpc/ninera_marcar_pedido_visto' ? { status: 404, code: 'PGRST202', message: 'no existe' } : undefined);
    await boton(page, 'Ver los datos').click();
    await expect(modal(page).locator('.modal-titulo')).toHaveText('¡Quedaste seleccionada!');
    verificarLimpio(e, { ignorar: [...RUIDO, ...RUIDO_SIN_MIGRAR] });
  });

  for (const [ancho, alto] of [[390, 844], [1280, 900]]) {
    test(`a ${ancho} px la tarjeta, el detalle y las opciones de mapa no se salen`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      const e = await abrir(page, { datos: datos({ solicitud: { notas_para_ninera: 'Una indicación bastante larga para ver cómo se parte en el celular sin salirse de la pantalla.', horario_aproximado: true } }) });
      await expect(tarjeta(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ancho);
      await boton(page, 'Ver los datos').click();
      await modal(page).getByRole('button', { name: 'Cómo llegar' }).click();
      await expect(modal(page).getByRole('link', { name: 'Mapas', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ancho);
      const caja = await modal(page).locator('.confirmbox').boundingBox();
      expect(caja.x).toBeGreaterThanOrEqual(0);
      expect(caja.x + caja.width).toBeLessThanOrEqual(ancho);
      verificarLimpio(e, { ignorar: RUIDO });
    });
  }
});
