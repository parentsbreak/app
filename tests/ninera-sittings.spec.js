// App de niñeras (fase 1, etapa 2, 27/10/2026): "Próximos sittings" en el inicio (ninera/js/inicio.js).
// La niñera ve lo de hoy y lo que viene (hasta 60 días) desde ninera_mis_sittings(), sin ningún monto;
// la dirección solo cuando el sitting está confirmado, con "Cómo llegar" y "Agregar al calendario"
// (.ics). Todo contra el simulador (tests/support/app.js y rpc-ninera.js). Hoy en el simulador es el
// domingo 04/10/2026: Ana tiene hoy un confirmado (Familia Prueba Uno, 18:00 a 22:00), mañana un
// previsto que cruza la medianoche (Familia Prueba Tres) y uno a 70 días que no sale.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { rpcNoExiste } = require('./support/rpc-ninera');
const { ID, datosBase } = require('./support/datos');

const ERROR_CARGA = 'No pudimos cargar tus sittings. Revisa tu conexión a internet y vuelve a intentar.';
const SIN_SITTINGS = 'No tienes sittings próximos.';
const SIN_DIRECCION = 'La dirección aparece el día del sitting.';
const ID_HOY = '70000000-0000-4000-8000-000000000005';
const ID_MANANA = '70000000-0000-4000-8000-000000000006';
// Chromium anota en consola toda respuesta 4xx/5xx simulada y todo pedido cortado.
const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[ninera_mis_sittings\]/];
// Nunca plata en la app de niñeras (restricciones de la etapa 2).
const PLATA = /\$\d/;
const PAGO = /\bpago/i;

// Ana con el perfil completo (con zona) y la pantalla de avisos ya vista en este celular: estos
// tests miran el inicio, no el primer ingreso (ninera-perfil.spec.js).
async function abrir(page, opciones = {}) {
  const datos = opciones.datos || datosBase();
  (datos.ninieras || []).forEach(n => { if (n.id === ID.nAna) n.zona = 'Pocitos'; });
  await page.addInitScript(() => localStorage.setItem('pb-ninera-avisos-vistos', '1'));
  return abrirAppNinera(page, { ...opciones, datos });
}
function llamadas(e) {
  return e.escrituras.filter(w => w.tabla === 'rpc/ninera_mis_sittings');
}
const seccion = page => page.locator('#proximos-sittings');
const tarjetas = page => page.locator('#proximos-sittings .sitting-tarjeta');
const modal = page => page.locator('#modal-ninera');

test.describe('próximos sittings en el inicio', () => {
  test('Ana ve hoy y mañana (el que cruza la medianoche), con madre, chicos y zona; no el de 70 días', async ({ page }) => {
    const e = await abrir(page);
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(seccion(page).locator('h2')).toHaveText('Próximos sittings');
    await expect(tarjetas(page)).toHaveCount(2);
    expect(await page.locator('#proximos-sittings .sittings-dia').allTextContents()).toEqual(['Hoy', 'Mañana']);

    const hoy = tarjetas(page).nth(0);
    await expect(hoy).toContainText('18:00 a 22:00');
    await expect(hoy).toContainText('Sitting');
    await expect(hoy).toContainText('Pocitos');
    await expect(hoy).toContainText('Madre: Familia U.');
    await expect(hoy).toContainText('Chicos: 2 chicos (3 y 5 años)');

    const manana = tarjetas(page).nth(1);
    await expect(manana).toContainText('22:00 a 02:00, termina al día siguiente');
    await expect(manana).toContainText('Madre: Familia T.');
    // Sin familia en la lista: ni chicos ni zona.
    await expect(manana).not.toContainText('Chicos:');

    // El de 70 días (13/12) no sale.
    await expect(seccion(page)).not.toContainText('13/12');
    // Una sola lectura, y el inicio de siempre sigue arriba con su pie.
    expect(llamadas(e)).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Mi perfil' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mi cuenta' })).toBeVisible();
    verificarLimpio(e);
  });

  test('tocar el de hoy (confirmado): la dirección y "Cómo llegar"; el de mañana (previsto): sin dirección ni botón', async ({ page }) => {
    const e = await abrir(page);
    await tarjetas(page).nth(0).click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page)).toContainText('Hoy');
    await expect(modal(page)).toContainText('18:00 a 22:00');
    await expect(modal(page)).toContainText('Calle Falsa 123');
    await expect(modal(page)).toContainText('Madre: Familia U.');
    await expect(modal(page)).toContainText('Chicos: 2 chicos (3 y 5 años)');
    const llegar = modal(page).getByRole('link', { name: 'Cómo llegar' });
    await expect(llegar).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=Calle%20Falsa%20123');
    await expect(llegar).toHaveAttribute('target', '_blank');
    await expect(llegar).toHaveAttribute('rel', 'noopener');
    await expect(modal(page)).not.toContainText(SIN_DIRECCION);
    await modal(page).getByRole('button', { name: 'Cerrar' }).click();
    await expect(modal(page)).toHaveCount(0);

    await tarjetas(page).nth(1).click();
    await expect(modal(page)).toContainText('Mañana');
    await expect(modal(page)).toContainText('22:00 a 02:00, termina al día siguiente');
    await expect(modal(page)).toContainText(SIN_DIRECCION);
    await expect(modal(page).getByRole('link', { name: 'Cómo llegar' })).toHaveCount(0);
    await expect(modal(page).getByRole('button', { name: 'Agregar al calendario' })).toBeVisible();
    verificarLimpio(e);
  });

  test('en el iPhone "Cómo llegar" abre Apple Maps', async ({ browser }) => {
    const contexto = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    const page = await contexto.newPage();
    const e = await abrir(page);
    await tarjetas(page).nth(0).click();
    await expect(modal(page).getByRole('link', { name: 'Cómo llegar' })).toHaveAttribute('href', 'https://maps.apple.com/?q=Calle%20Falsa%20123');
    verificarLimpio(e);
    await contexto.close();
  });

  test('"Agregar al calendario": el .ics del de mañana termina al otro día y se descarga', async ({ page }) => {
    const e = await abrir(page);
    const ics = await page.evaluate(id => armarIcsSitting(sittingsNineraCargados.find(s => s.id === id)), ID_MANANA);
    const lineas = ics.split('\r\n');
    expect(lineas[0]).toBe('BEGIN:VCALENDAR');
    expect(lineas).toContain('VERSION:2.0');
    expect(lineas).toContain('PRODID:-//Parents Break//App ninieras//ES');
    expect(lineas).toContain('BEGIN:VEVENT');
    expect(lineas).toContain(`UID:${ID_MANANA}@parentsbreak`);
    // El reloj fijo del simulador: 04/10/2026 12:00 en Montevideo = 15:00 UTC.
    expect(lineas).toContain('DTSTAMP:20261004T150000Z');
    expect(lineas).toContain('DTSTART;TZID=America/Montevideo:20261005T220000');
    expect(lineas).toContain('DTEND;TZID=America/Montevideo:20261006T020000');
    expect(lineas).toContain("SUMMARY:Sitting Parents' Break");
    expect(lineas).toContain('DESCRIPTION:Madre: Familia T.');
    // Previsto: sin dirección.
    expect(lineas.some(l => l.startsWith('LOCATION'))).toBe(false);
    expect(lineas[lineas.length - 2]).toBe('END:VCALENDAR');
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics).not.toMatch(PLATA);
    expect(ics).not.toMatch(PAGO);

    await tarjetas(page).nth(1).click();
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      modal(page).getByRole('button', { name: 'Agregar al calendario' }).click(),
    ]);
    expect(descarga.suggestedFilename()).toBe('sitting-2026-10-05.ics');
    const ruta = await descarga.path();
    const bajado = require('fs').readFileSync(ruta, 'utf8');
    expect(bajado).toContain('DTEND;TZID=America/Montevideo:20261006T020000');
    expect(bajado).not.toMatch(PLATA);
    expect(bajado).not.toMatch(PAGO);

    // El de hoy (confirmado) lleva la dirección.
    const icsHoy = await page.evaluate(id => armarIcsSitting(sittingsNineraCargados.find(s => s.id === id)), ID_HOY);
    expect(icsHoy.split('\r\n')).toContain('LOCATION:Calle Falsa 123');
    expect(icsHoy.split('\r\n')).toContain('DESCRIPTION:Madre: Familia U.\\nChicos: 2 chicos (3 y 5 años)');
    verificarLimpio(e);
  });

  test('sin sittings: "No tienes sittings próximos."', async ({ page }) => {
    // Ana sin sittings en la base: así sale desde la primera lectura.
    const datos = datosBase();
    datos.sittings_traslados = datos.sittings_traslados.filter(s => s.ninera_id !== ID.nAna);
    const e = await abrir(page, { datos });
    await expect(seccion(page)).toContainText(SIN_SITTINGS);
    await expect(tarjetas(page)).toHaveCount(0);
    // Y si la RPC responde vacío al volver a pintar el inicio.
    e.rpc.ninera_mis_sittings = () => [];
    await page.evaluate(() => renderInicio());
    await expect(seccion(page)).toContainText(SIN_SITTINGS);
    verificarLimpio(e);
  });

  test('si la lectura falla: el aviso y "Reintentar" vuelve a pedir', async ({ page }) => {
    const e = await abrir(page);
    e.fallar = p => p.tabla === 'rpc/ninera_mis_sittings' ? { status: 500, message: 'falla simulada' } : undefined;
    await page.evaluate(() => renderInicio());
    await expect(seccion(page)).toContainText(ERROR_CARGA);
    await expect(tarjetas(page)).toHaveCount(0);
    // El resto del inicio sigue.
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.getByRole('button', { name: 'Mi perfil' })).toBeVisible();

    // Sin conexión, también.
    e.fallar = p => p.tabla === 'rpc/ninera_mis_sittings' ? 'red' : undefined;
    await seccion(page).getByRole('button', { name: 'Reintentar' }).click();
    await expect(seccion(page)).toContainText(ERROR_CARGA);

    e.fallar = null;
    const antes = llamadas(e).length;
    await seccion(page).getByRole('button', { name: 'Reintentar' }).click();
    await expect(tarjetas(page)).toHaveCount(2);
    expect(llamadas(e).length).toBe(antes + 1);
    await expect(seccion(page)).not.toContainText(ERROR_CARGA);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('base sin la migración de la etapa 2: sin la sección y el inicio de siempre', async ({ page }) => {
    const e = await abrir(page, { baseSinMigrar: true });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.getByRole('button', { name: 'Mi cuenta' })).toBeVisible();
    await expect(seccion(page)).toHaveCount(0);
    await expect(page.locator('#app')).not.toContainText('Próximos sittings');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('solo ninera_mis_sittings sin migrar (404 PGRST202): se saca la sección', async ({ page }) => {
    const e = await abrir(page);
    e.rpc.ninera_mis_sittings = rpcNoExiste('ninera_mis_sittings');
    await page.evaluate(() => renderInicio());
    await expect(seccion(page)).toHaveCount(0);
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.getByRole('button', { name: 'Mi perfil' })).toBeVisible();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('ni montos ni "pago" en el inicio ni en el detalle', async ({ page }) => {
    const e = await abrir(page);
    await expect(tarjetas(page)).toHaveCount(2);
    for (const i of [0, 1]) {
      await expect(page.locator('#app')).not.toContainText(PLATA);
      expect(await page.locator('#app').innerHTML()).not.toMatch(PLATA);
      expect(await page.locator('#app').innerHTML()).not.toMatch(PAGO);
      await tarjetas(page).nth(i).click();
      const html = await modal(page).innerHTML();
      expect(html).not.toMatch(PLATA);
      expect(html).not.toMatch(PAGO);
      await modal(page).getByRole('button', { name: 'Cerrar' }).click();
    }
    verificarLimpio(e);
  });
});

test.describe('traslados, horarios incompletos y datos raros', () => {
  // Carla (perfil completo) con un traslado confirmado, un sitting sin hora de fin y otro sin hora,
  // en una familia con dirección, zona y chicos (texto viejo) tramposos.
  const ID_FAM = '20000000-0000-4000-8000-0000000000aa';
  const DIR_RARA = 'Av. "Brasil" 2020, apto 3; <img src=x onerror="window.__xss=1">';
  const NINOS_RAROS = '<b>dos</b> chicos; uno "alérgico", otro \\ no';
  function datosCarla() {
    const datos = datosBase();
    datos.familias.push({ ...datos.familias[0], id: ID_FAM, nombre: '<b>María</b> Pérez', zona: 'Pocitos<script>window.__xss=2</script>', direccion: DIR_RARA, ninos: NINOS_RAROS });
    const base = datos.sittings_traslados.find(s => s.id === ID_HOY);
    const fila = (id, fecha, extra) => ({ ...base, id, fecha, familia_id: ID_FAM, familia_nombre: '<b>María</b> Pérez', ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', ...extra });
    datos.sittings_traslados.push(
      fila('70000000-0000-4000-8000-0000000000c1', '2026-10-04', { tipo: 'traslado', hora_inicio: '08:00:00', hora_fin: null, origen: 'Casa, "la de siempre"', destino: 'Colegio Ficticio; puerta 2' }),
      fila('70000000-0000-4000-8000-0000000000c2', '2026-10-08', { hora_inicio: '18:00:00', hora_fin: null }),
      fila('70000000-0000-4000-8000-0000000000c3', '2026-10-09', { hora_inicio: null, hora_fin: null, estado: 'previsto' }),
    );
    return datos;
  }

  test('traslado confirmado: desde y hasta, "Cómo llegar" con el destino; escape en todo', async ({ page }) => {
    const e = await abrir(page, { ninera: ID.nCarla, datos: datosCarla() });
    await expect(tarjetas(page)).toHaveCount(3);
    expect(await page.locator('#proximos-sittings .sittings-dia').allTextContents()).toEqual(['Hoy', 'jue 08/10', 'vie 09/10']);
    const traslado = tarjetas(page).nth(0);
    await expect(traslado).toContainText('desde las 08:00');
    await expect(traslado).toContainText('Traslado');
    await expect(traslado).toContainText('Pocitos<script>window.__xss=2</script>');
    await expect(traslado).toContainText('Madre: <b>María</b> P.');
    await expect(traslado).toContainText(`Chicos: ${NINOS_RAROS}`);
    await expect(tarjetas(page).nth(1)).toContainText('desde las 18:00');
    await expect(tarjetas(page).nth(2)).toContainText('horario a confirmar');

    await traslado.click();
    await expect(modal(page)).toContainText('Desde: Casa, "la de siempre"');
    await expect(modal(page)).toContainText('Hasta: Colegio Ficticio; puerta 2');
    await expect(modal(page).getByRole('link', { name: 'Cómo llegar' }))
      .toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Colegio Ficticio; puerta 2'));
    expect(await modal(page).innerHTML()).not.toMatch(PAGO);
    await modal(page).getByRole('button', { name: 'Cerrar' }).click();

    // Sitting confirmado con la dirección tramposa: se ve tal cual, nada se ejecuta.
    await tarjetas(page).nth(1).click();
    await expect(modal(page)).toContainText(DIR_RARA);
    await expect(modal(page).getByRole('link', { name: 'Cómo llegar' }))
      .toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(DIR_RARA));
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });

  test('el .ics: sin hora de fin dura una hora, sin hora es de todo el día, y escapa comas, ; y \\', async ({ page }) => {
    const e = await abrir(page, { ninera: ID.nCarla, datos: datosCarla() });
    await expect(tarjetas(page)).toHaveCount(3);
    const ics = await page.evaluate(() => sittingsNineraCargados.map(s => armarIcsSitting(s).split('\r\n')));
    const [traslado, sinFin, sinHora] = ics;
    expect(traslado).toContain("SUMMARY:Traslado Parents' Break");
    expect(traslado).toContain('DTSTART;TZID=America/Montevideo:20261004T080000');
    expect(traslado).toContain('DTEND;TZID=America/Montevideo:20261004T090000');
    expect(traslado).toContain('LOCATION:Colegio Ficticio\\; puerta 2');
    expect(traslado.join('\r\n').replace(/\r\n /g, '')).toContain('Desde: Casa\\, "la de siempre"\\nHasta: Colegio Ficticio\\; puerta 2');
    expect(sinFin).toContain('DTSTART;TZID=America/Montevideo:20261008T180000');
    expect(sinFin).toContain('DTEND;TZID=America/Montevideo:20261008T190000');
    // Las líneas largas se doblan (RFC 5545): se vuelven a juntar para leerlas.
    const sinFinUnido = sinFin.join('\r\n').replace(/\r\n /g, '');
    expect(sinFinUnido).toContain('LOCATION:Av. "Brasil" 2020\\, apto 3\\; <img src=x onerror="window.__xss=1">');
    expect(sinFinUnido).toContain('Chicos: <b>dos</b> chicos\\; uno "alérgico"\\, otro \\\\ no');
    for (const l of sinFin) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
    expect(sinHora).toContain('DTSTART;VALUE=DATE:20261009');
    expect(sinHora).toContain('DTEND;VALUE=DATE:20261010');
    // Previsto: sin lugar.
    expect(sinHora.some(l => l.startsWith('LOCATION'))).toBe(false);
    // Saltos de línea de cualquier tipo, también un \r suelto, quedan como \n (27/10/2026).
    expect(await page.evaluate(() => textoIcsNinera('a\r\nb\rc\nd'))).toBe('a\\nb\\nc\\nd');
    verificarLimpio(e);
  });

  test('textoDiaNinera y horasSittingNinera', async ({ page }) => {
    const e = await abrir(page);
    const r = await page.evaluate(() => ({
      dias: [['2026-10-04', '2026-10-04'], ['2026-10-05', '2026-10-04'], ['2026-10-30', '2026-10-04'], ['2027-01-01', '2026-12-31'], ['2027-01-03', '2026-12-31']]
        .map(([f, h]) => textoDiaNinera(f, h)),
      horas: [
        { hora_inicio: '18:00:00', hora_fin: '22:00:00' },
        { hora_inicio: '18:00:00', hora_fin: null },
        { hora_inicio: '22:00:00', hora_fin: '02:00:00', termina_dia_siguiente: true },
        { hora_inicio: null, hora_fin: null },
      ].map(horasSittingNinera),
    }));
    expect(r.dias).toEqual(['Hoy', 'Mañana', 'vie 30/10', 'Mañana', 'dom 03/01']);
    expect(r.horas).toEqual(['18:00 a 22:00', 'desde las 18:00', '22:00 a 02:00, termina al día siguiente', 'horario a confirmar']);
    verificarLimpio(e);
  });
});

test('a 390 px: sin scroll horizontal (captura del inicio y del detalle)', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const e = await abrir(page);
  await expect(tarjetas(page)).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // Las tarjetas se tocan con el dedo: al menos 44 px de alto.
  for (const h of await tarjetas(page).evaluateAll(ts => ts.map(t => t.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('ninera-sittings-390.png'), fullPage: true, animations: 'disabled' });
  await tarjetas(page).nth(0).click();
  await expect(modal(page)).toHaveClass(/show/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('ninera-sittings-detalle-390.png'), animations: 'disabled' });
  verificarLimpio(e);
});
