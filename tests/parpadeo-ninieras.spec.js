// Parpadeo en Niñeras (27/10/2026, Diego probando en producción): después de guardar un cambio,
// "Utilización" y "Temporadas de verano" se prendían y apagaban varias veces. El guardado ya
// recarga la lista (cargarNinieras) y el UPDATE propio volvía por Realtime (ninieras y, después,
// candidatas) y disparaba otras recargas completas intercaladas con la primera: cada una volvía
// a crear las tarjetas con su fundido de entrada. Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { datosBase, ID } = require('./support/datos');

const CAND_CARLA = '41000000-0000-4000-8000-000000000003';
function datos() {
  const d = datosBase();
  // Carla con ficha de candidata: así el guardado también escribe en candidatas, como en producción.
  d.candidatas.push({ ...d.candidatas[0], id: CAND_CARLA, nombre: 'Carla', apellido: null, estado: 'contratada', fecha_nacimiento: '2005-07-05' });
  d.ninieras.find(n => n.id === ID.nCarla).candidata_id = CAND_CARLA;
  return d;
}
const filaCarla = e => e.db.ninieras.find(n => n.id === ID.nCarla);
const nombreEnGrilla = (page, nombre) => page.locator('#ninierasgrid .person-row .name', { hasText: nombre });

// Cuenta cuántas tarjetas (.card) se crean dentro de cada panel desde este momento y vigila
// cada 100 ms que Utilización nunca quede vacía.
async function vigilarTarjetas(page) {
  await page.evaluate(() => {
    window.__tarjetas = { 'nin-utilizacion-wrap': 0, 'nin-temporadas-wrap': 0 };
    window.__utilVacia = false;
    new MutationObserver(ms => {
      for (const m of ms) {
        if (!(m.target.id in window.__tarjetas)) continue;
        for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('card')) window.__tarjetas[m.target.id]++;
      }
    }).observe(document.getElementById('ninieras-body'), { childList: true, subtree: true });
    setInterval(() => { if (!document.querySelector('#nin-utilizacion-wrap .card')) window.__utilVacia = true; }, 100);
  });
}
const tarjetas = page => page.evaluate(() => window.__tarjetas);

// Edita a Carla desde la lista (sin el paso de la temporada) y guarda. No espera la recarga.
async function editarCarla(page, campo, valor) {
  await page.evaluate(id => { ninTempOmitidas.add(id); editarNinera(id); }, ID.nCarla);
  const modal = page.locator('#editmodal');
  await modal.locator(campo).fill(valor);
  await modal.getByRole('button', { name: /^Guardar/ }).last().click();
  await expect(modal).toHaveCount(0);
}

// El eco del propio guardado: como en producción, el UPDATE de ninieras vuelve enseguida y el de
// candidatas un rato después (cada uno reinicia el debounce de Realtime).
async function ecoDelGuardado(page, e) {
  await page.waitForTimeout(100);
  expect(e.emitirRealtime('ninieras', 'UPDATE', filaCarla(e))).toBeGreaterThan(0);
  await page.waitForTimeout(700);
  expect(e.emitirRealtime('candidatas', 'UPDATE', e.db.candidatas.find(c => c.id === CAND_CARLA))).toBeGreaterThan(0);
}

async function abrirNinieras(page) {
  const e = await abrirApp(page, { datos: datos() });
  await irAModulo(page, 'ninieras');
  await expect(page.locator('#nin-utilizacion-wrap .card')).toHaveCount(1);
  await expect(page.locator('#nin-temporadas-wrap .card')).toHaveCount(1);
  return e;
}

test('guardar una niñera: Utilización y Temporadas se repintan a lo sumo una vez, aunque vuelva el eco por Realtime', async ({ page }) => {
  const e = await abrirNinieras(page);
  await vigilarTarjetas(page);
  e.demoraLecturas = 400; // como en producción: la recarga del guardado tarda y se solapa con la de Realtime
  await editarCarla(page, '#ed-nombre', 'Carla Ejemplo Editada');
  await ecoDelGuardado(page, e);
  await page.waitForTimeout(3000);
  const t = await tarjetas(page);
  expect(t['nin-utilizacion-wrap'], 'tarjetas nuevas de Utilización').toBeLessThanOrEqual(1);
  expect(t['nin-temporadas-wrap'], 'tarjetas nuevas de Temporadas').toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.__utilVacia), 'Utilización quedó vacía en algún momento').toBe(false);
  await expect(nombreEnGrilla(page, 'Carla Ejemplo Editada')).toHaveCount(1);
  verificarLimpio(e);
});

test('con Utilización abierta: guardar sin tocar el panel no vuelve a armar el gráfico; un cambio que sí lo toca lo repinta una vez', async ({ page }) => {
  const e = await abrirNinieras(page);
  await page.locator('#nin-utilizacion-wrap h2').click();
  await expect(page.locator('#ninUtilChart')).toBeVisible();
  await page.waitForFunction(() => !!ninUtilChart);
  await page.evaluate(() => { window.__chart0 = ninUtilChart; });
  await vigilarTarjetas(page);
  const mismoGrafico = () => page.evaluate(() => ninUtilChart === window.__chart0 && ninUtilChart.canvas.isConnected);

  // El teléfono no se ve en el panel: queda igual, con su gráfico.
  await editarCarla(page, '#ed-telefono', '098000333');
  await ecoDelGuardado(page, e);
  await page.waitForTimeout(1500);
  expect((await tarjetas(page))['nin-utilizacion-wrap']).toBe(0);
  expect(await mismoGrafico()).toBe(true);
  expect(filaCarla(e).telefono).toBe('098000333');

  // El nombre sí está en la lista de "sin actividad": se repinta una vez, con el gráfico nuevo.
  await editarCarla(page, '#ed-nombre', 'Carla Ejemplo Editada');
  await ecoDelGuardado(page, e);
  await page.waitForTimeout(1500);
  expect((await tarjetas(page))['nin-utilizacion-wrap']).toBe(1);
  await expect(page.locator('#nin-utilizacion-wrap')).toContainText('Carla Ejemplo Editada');
  expect(await mismoGrafico()).toBe(false);
  expect(await page.evaluate(() => !!ninUtilChart && ninUtilChart.canvas.isConnected)).toBe(true);
  verificarLimpio(e);
});

test('un cambio de otra admin que llega después del guardado sí se refleja', async ({ page }) => {
  const e = await abrirNinieras(page);
  await editarCarla(page, '#ed-nombre', 'Carla Ejemplo Editada');
  await ecoDelGuardado(page, e);
  await expect(nombreEnGrilla(page, 'Carla Ejemplo Editada')).toHaveCount(1);
  await page.waitForTimeout(2500); // pasada la ventana del eco (1,5 s después de la recarga del guardado)
  const bruno = e.db.ninieras.find(n => n.id === ID.nBruno);
  bruno.nombre = 'Bruno Renombrado';
  expect(e.emitirRealtime('ninieras', 'UPDATE', bruno)).toBeGreaterThan(0);
  await expect(nombreEnGrilla(page, 'Bruno Renombrado')).toHaveCount(1, { timeout: 3000 });
  await expect(nombreEnGrilla(page, 'Carla Ejemplo Editada')).toHaveCount(1);
  verificarLimpio(e);
});

test('si la base falla al recargar después de guardar: aviso claro, sin reintentos en loop, y se recupera con el próximo cambio', async ({ page }) => {
  const e = await abrirNinieras(page);
  let lecturasFallidas = 0;
  const lecturaNinieras = /\/rest\/v1\/ninieras\?/;
  await page.route(lecturaNinieras, async r => {
    if (r.request().method() !== 'GET') return r.fallback(); // el guardado (PATCH) anda; la recarga, no
    lecturasFallidas++;
    await new Promise(res => setTimeout(res, 600)); // como en producción, fallar también tarda
    return r.fulfill({ status: 500, json: { message: 'falla simulada' } });
  });
  await editarCarla(page, '#ed-nombre', 'Carla Ejemplo Editada');
  await ecoDelGuardado(page, e);
  await expect(page.locator('#ninierasgrid .warnbox')).toContainText('Error de conexión con la base');
  await page.waitForTimeout(3000);
  expect(lecturasFallidas).toBe(1);
  // La base vuelve y otra admin cambia algo: la lista se recarga sola, sin quedar trabada.
  await page.unroute(lecturaNinieras);
  const bruno = e.db.ninieras.find(n => n.id === ID.nBruno);
  bruno.nombre = 'Bruno Renombrado';
  expect(e.emitirRealtime('ninieras', 'UPDATE', bruno)).toBeGreaterThan(0);
  await expect(nombreEnGrilla(page, 'Bruno Renombrado')).toHaveCount(1, { timeout: 3000 });
  await expect(page.locator('#ninierasgrid .warnbox')).toHaveCount(0);
  verificarLimpio(e, { ignorar: [/status of 500/] });
});
