// Etapa 9, tarea 9.5 (31/10/2026): el panel lee la temporada que las niñeras cargan desde su app.
// Con app no se les pide nada a las admins ("Se la pide la app"); los lugares de la app (Fuera del país,
// La Paloma, Otro) cuentan en el filtro; una temporada de la anterior es "sin temporada cargada"; y
// corregir las quincenas de Punta no pisa lo que ella marcó. Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { datosBase, ID } = require('./support/datos');

const lugares = (distintos = {}) => {
  const l = {};
  for (let q = 0; q < 24; q++) l[String(q)] = 'montevideo';
  return { ...l, ...distintos };
};
const ID_N = i => `3f500000-0000-4000-8000-00000000000${i}`;
const ACTUAL = '2026-09-20T15:00:00+00:00';
const ANTERIOR = '2025-10-10T15:00:00+00:00';

function datos({ extra = [], sinColumnas = false } = {}) {
  const d = datosBase();
  const base = d.ninieras[0];
  const nin = (i, nombre, zona, campos) => ({
    ...base, id: ID_N(i), nombre, zona, barrios: zona, candidata_id: null, user_id: null,
    temporada: null, temporada_actualizada_en: null, temporada_fuente: null, temporada_lugares: null, temporada_lugares_en: null,
    temporada_token: `6f500000-0000-4000-8000-00000000000${i}`, ...campos,
  });
  d.ninieras = [
    // Con app, lugares vigentes: Punta la 1ra quincena de enero, Fuera del país la 1ra quincena de marzo, "Otro" la 2da.
    nin(1, 'Ema App Vigente', 'Pocitos/Punta del Este', {
      user_id: ID.uCarla, temporada: { [ID.zPunta]: [0] }, temporada_actualizada_en: ACTUAL, temporada_fuente: 'app',
      temporada_lugares: lugares({ 0: 'punta', 4: 'fuera_pais', 5: { otro: 'Rocha' } }), temporada_lugares_en: ACTUAL }),
    // Con app, sin cargar nada todavía.
    nin(2, 'Fina App Sin Cargar', 'Pocitos', { user_id: ID.uCarla }),
    // Sin app y sin temporada: todo como hoy.
    nin(3, 'Gina Sin App', 'Pocitos', {}),
    // La Paloma la 1ra quincena de enero.
    nin(4, 'Hebe La Paloma', 'Pocitos', {
      user_id: ID.uCarla, temporada: {}, temporada_actualizada_en: ACTUAL, temporada_fuente: 'app',
      temporada_lugares: lugares({ 0: 'la_paloma' }), temporada_lugares_en: ACTUAL }),
    // Temporada de la anterior (marcó Punta todo enero y lugares viejos): ya no vale.
    nin(5, 'Ines Temporada Anterior', 'Pocitos/Punta del Este', {
      temporada: { [ID.zPunta]: [0, 1] }, temporada_actualizada_en: ANTERIOR, temporada_fuente: 'app',
      temporada_lugares: lugares({ 0: 'fuera_pais' }), temporada_lugares_en: ANTERIOR }),
    // "Otro" con HTML y comillas.
    nin(6, 'Julia Otro Tramposo', 'Pocitos', {
      user_id: ID.uCarla, temporada: {}, temporada_actualizada_en: ACTUAL, temporada_fuente: 'app',
      temporada_lugares: lugares({ 2: { otro: '<img src=x onerror=window.__xss=1> "Tigre"' } }), temporada_lugares_en: ACTUAL }),
    // Este año, pero la respondió por la página después (fuente 'ninera'): sus lugares no valen.
    nin(7, 'Kira Por la Página', 'Pocitos', {
      user_id: ID.uCarla, temporada: {}, temporada_actualizada_en: ACTUAL, temporada_fuente: 'ninera',
      temporada_lugares: lugares({ 4: 'fuera_pais' }), temporada_lugares_en: ACTUAL }),
    ...extra,
  ];
  if (sinColumnas) d.ninieras.forEach(n => { delete n.temporada_lugares; delete n.temporada_lugares_en; });
  return d;
}
const filaLista = (page, nombre) => page.locator('#ninierasgrid .person-row', { hasText: nombre });
const filaPanel = (page, nombre) => page.locator('#nin-temporadas-wrap .temp-row', { hasText: nombre });
const patchesNinera = e => e.escrituras.filter(w => w.tabla === 'ninieras' && w.metodo === 'PATCH');
const cuerpo = w => (typeof w.cuerpo === 'string' ? JSON.parse(w.cuerpo) : w.cuerpo);
async function abrir(page, opciones = {}) {
  const e = await abrirApp(page, { datos: datos(opciones) });
  await irAModulo(page, 'ninieras');
  return e;
}
const abrirPanel = async page => { await page.evaluate(() => { ninTempAbierto = true; ninTempVerTodas = true; renderTemporadasPanel(); }); };
const nombresFiltro = page => page.locator('#ninierasgrid .person-list').first().locator('.name').allInnerTexts();

test('con app no abre el paso previo de la temporada; sin app, igual que hoy', async ({ page }) => {
  const e = await abrir(page);
  await page.evaluate(id => editarNinera(id), ID_N(2));
  await expect(page.locator('#editmodal')).not.toContainText('Todavía no sabemos si veranea');
  await expect(page.locator('#editmodal')).toContainText('Guardar');
  await page.evaluate(() => cerrarModal());
  await page.evaluate(id => editarNinera(id), ID_N(3));
  await expect(page.locator('#editmodal')).toContainText('Todavía no sabemos si veranea');
  verificarLimpio(e);
});

test('panel de temporadas: "Se la pide la app" con app y "Pedirle por WhatsApp" sin app; contador sin las de app', async ({ page }) => {
  const e = await abrir(page);
  await abrirPanel(page);
  await expect(filaPanel(page, 'Fina App Sin Cargar')).toContainText('Se la pide la app');
  await expect(filaPanel(page, 'Fina App Sin Cargar').getByRole('button', { name: 'Pedirle por WhatsApp' })).toHaveCount(0);
  await expect(filaPanel(page, 'Gina Sin App').getByRole('button', { name: 'Pedirle por WhatsApp' })).toHaveCount(1);
  await expect(filaPanel(page, 'Gina Sin App')).not.toContainText('Se la pide la app');
  // Sin temporada al día: Fina (app), Gina e Ines (sin app) -> solo 2 hay que pedir.
  await expect(page.locator('#nin-temporadas-wrap')).toContainText('2 sin temporada,');
  verificarLimpio(e);
});

test('el recordatorio anual cuenta solo a las niñeras sin app', async ({ page }) => {
  const e = await abrir(page);
  await page.evaluate(() => abrirRecordatorioTemporada());
  await expect(page.locator('#editmodal')).toContainText('Hoy hay 2 sin temporada al día');
  verificarLimpio(e);
});

test('la fuente "app" dice "la cargó ella en la app"', async ({ page }) => {
  const e = await abrir(page);
  await abrirPanel(page);
  await expect(filaPanel(page, 'Ema App Vigente')).toContainText('la cargó ella en la app');
  verificarLimpio(e);
});

test('panel y ficha muestran los lugares de la app, uno por renglón', async ({ page }) => {
  const e = await abrir(page);
  await abrirPanel(page);
  const f = filaPanel(page, 'Ema App Vigente');
  await expect(f).toContainText('En Punta del Este: 1ra quincena de enero');
  await expect(f).toContainText('Fuera del país: 1ra quincena de marzo');
  await expect(f).toContainText('Otro (Rocha): 2da quincena de marzo');
  await page.evaluate(id => verNinera(id), ID_N(1));
  const sec = page.locator('#vn-temporada');
  await expect(sec).toContainText('En Punta del Este: 1ra quincena de enero');
  await expect(sec).toContainText('Fuera del país: 1ra quincena de marzo');
  await expect(sec).toContainText('Otro (Rocha): 2da quincena de marzo');
  await expect(sec).toContainText('la cargó ella en la app');
  // Entre los datos y el chat.
  const orden = await page.evaluate(() => { const t = document.getElementById('vn-temporada'); const c = document.getElementById('vn-chat'); return !!(t.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); });
  expect(orden).toBe(true);
  verificarLimpio(e);
});

test('ficha: sin temporada cargada y temporada de la anterior', async ({ page }) => {
  const e = await abrir(page);
  await page.evaluate(id => verNinera(id), ID_N(2));
  await expect(page.locator('#vn-temporada')).toContainText('Sin temporada cargada');
  await page.evaluate(() => cerrarModal());
  await page.evaluate(id => verNinera(id), ID_N(5));
  await expect(page.locator('#vn-temporada')).toContainText('Sin temporada cargada');
  await expect(page.locator('#vn-temporada')).not.toContainText('En Punta del Este');
  verificarLimpio(e);
});

test('filtro por Pocitos y mes: Fuera del país, Otro y La Paloma la sacan; Montevideo no', async ({ page }) => {
  const e = await abrir(page);
  await page.evaluate(() => toggleFiltroZonaNin(claveZona('Pocitos'), true));
  // Enero: Hebe está en La Paloma la 1ra (parte); Ema en Punta la 1ra (parte).
  await page.evaluate(() => toggleFiltroMes(0));
  await expect(filaLista(page, 'Hebe La Paloma')).toHaveCount(1);
  // Marzo: Ema (Fuera del país y Otro) no está en Pocitos; Hebe sí, todo marzo.
  await page.evaluate(() => { toggleFiltroMes(0); toggleFiltroMes(2); });
  const marzo = await nombresFiltro(page);
  expect(marzo).toContain('Hebe La Paloma');
  expect(marzo).toContain('Julia Otro Tramposo');
  expect(marzo.join('|')).not.toContain('Ema App Vigente');
  // Febrero: Julia está en "Otro" la 1ra; las demás, en Montevideo.
  await page.evaluate(() => { toggleFiltroMes(2); toggleFiltroMes(1); });
  const feb = await nombresFiltro(page);
  expect(feb).toEqual(expect.arrayContaining(['Ema App Vigente', 'Hebe La Paloma']));
  expect(feb.join('|')).not.toContain('Julia Otro Tramposo'); // "Otro" la 1ra de febrero
  // Enero: Hebe en La Paloma la 1ra: solo una parte.
  await page.evaluate(() => { toggleFiltroMes(1); toggleFiltroMes(0); });
  await expect(page.locator('#ninierasgrid')).toContainText('solo una parte');
  verificarLimpio(e);
});

test('temporada de la anterior: "sin temporada cargada" en el filtro y no "Dijo que no va"', async ({ page }) => {
  const e = await abrir(page);
  await page.evaluate(() => toggleFiltroZonaNin(claveZona('Punta del Este'), true));
  // Antes de esta etapa Ines figuraba en Punta en enero por su temporada vieja; ahora no se sabe.
  await page.evaluate(() => toggleFiltroMes(0));
  await expect(page.locator('#nin-sin-temporada + .person-list .name', { hasText: 'Ines Temporada Anterior' })).toHaveCount(1);
  await expect(page.locator('#ninierasgrid')).toContainText('sin temporada cargada');
  await page.evaluate(() => toggleFiltroMes(0));
  await expect(filaLista(page, 'Ines Temporada Anterior')).not.toContainText('Dijo que no va');
  verificarLimpio(e);
});

test('corregir Punta conserva Fuera del país y Otro; lo que estaba en Punta pasa a Montevideo', async ({ page }) => {
  const e = await abrir(page);
  await abrirPanel(page);
  // Ema: saco la 1ra quincena de enero y marco la 1ra de febrero en Punta.
  await page.evaluate(() => {
    const ed = document.querySelector('.temp-editor[data-prefix="tp-3f500000-0000-4000-8000-000000000001"]');
    ed.querySelector('.tq[data-q="0"]').click();
    ed.querySelector('.tq[data-q="2"]').click();
  });
  await filaPanel(page, 'Ema App Vigente').getByRole('button', { name: /Guardar/ }).click();
  await expect.poll(() => patchesNinera(e).length).toBe(1);
  const c = cuerpo(patchesNinera(e)[0]);
  expect(c.temporada_lugares).toEqual(lugares({ 2: 'punta', 4: 'fuera_pais', 5: { otro: 'Rocha' } }));
  expect(c).not.toHaveProperty('temporada_lugares_en');
  expect(c.temporada).toEqual({ [ID.zPunta]: [2] });
  verificarLimpio(e);
});

test('corregir con lugares que no están vigentes los borra (y la fecha)', async ({ page }) => {
  const e = await abrir(page);
  await abrirPanel(page);
  await filaPanel(page, 'Ines Temporada Anterior').getByRole('button', { name: 'Repetir lo del año pasado' }).click();
  await expect.poll(() => patchesNinera(e).length).toBe(1);
  const c = cuerpo(patchesNinera(e)[0]);
  expect(c.temporada_lugares).toBeNull();
  expect(c.temporada_lugares_en).toBeNull();
  verificarLimpio(e);
});

test('"Otro" con HTML y comillas se ve como texto en el panel, la ficha y la lista', async ({ page }) => {
  const e = await abrir(page);
  await abrirPanel(page);
  const f = filaPanel(page, 'Julia Otro Tramposo');
  await expect(f).toContainText('Otro (<img src=x onerror=window.__xss=1> "Tigre"): 3ra'.replace('3ra', '1ra quincena de febrero'));
  await expect(f.locator('img')).toHaveCount(0);
  await page.evaluate(id => verNinera(id), ID_N(6));
  await expect(page.locator('#vn-temporada')).toContainText('<img src=x');
  await expect(page.locator('#vn-temporada img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  verificarLimpio(e);
});

test('base sin las columnas nuevas: como hoy, y el guardado no las manda', async ({ page }) => {
  const e = await abrirApp(page, { datos: datos({ sinColumnas: true }) });
  await irAModulo(page, 'ninieras');
  await abrirPanel(page);
  await filaPanel(page, 'Gina Sin App').getByRole('button', { name: 'Todo el año' }).click();
  await filaPanel(page, 'Gina Sin App').getByRole('button', { name: /Guardar/ }).click();
  await expect.poll(() => patchesNinera(e).length).toBe(1);
  const c = cuerpo(patchesNinera(e)[0]);
  expect(c).not.toHaveProperty('temporada_lugares');
  expect(c).not.toHaveProperty('temporada_lugares_en');
  await page.evaluate(id => verNinera(id), ID_N(1));
  await expect(page.locator('#vn-temporada')).toBeVisible();
  verificarLimpio(e);
});

test('390 px: fila del panel y sección de la ficha, sin scroll horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const e = await abrir(page);
  await abrirPanel(page);
  const f = filaPanel(page, 'Ema App Vigente');
  await f.scrollIntoViewIfNeeded();
  await f.screenshot({ path: '.superpowers/sdd/plan-implementacion/task-9.5-panel-390.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(id => verNinera(id), ID_N(1));
  const sec = page.locator('#vn-temporada');
  await sec.scrollIntoViewIfNeeded();
  await sec.screenshot({ path: '.superpowers/sdd/plan-implementacion/task-9.5-ficha-390.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  verificarLimpio(e);
});

test('con app y sin temporada: sin aviso en la lista, fuera del panel por defecto y dentro de "Ver todas"', async ({ page }) => {
  const e = await abrir(page);
  await expect(filaLista(page, 'Fina App Sin Cargar')).not.toContainText('Sin temporada cargada');
  await expect(filaLista(page, 'Ines Temporada Anterior')).toContainText('Temporada sin actualizar');
  await expect(filaLista(page, 'Gina Sin App')).toContainText('Sin temporada cargada');
  await page.evaluate(() => { ninTempAbierto = true; ninTempVerTodas = false; renderTemporadasPanel(); });
  await expect(filaPanel(page, 'Fina App Sin Cargar')).toHaveCount(0);
  await expect(filaPanel(page, 'Gina Sin App')).toHaveCount(1);
  await page.evaluate(() => toggleTemporadasVerTodas());
  await expect(filaPanel(page, 'Fina App Sin Cargar')).toContainText('Se la pide la app');
  verificarLimpio(e);
});

test('lugares de este año pero respondidos por la página: no valen en el filtro, la ficha ni al corregir', async ({ page }) => {
  const e = await abrir(page);
  await page.evaluate(() => { toggleFiltroZonaNin(claveZona('Pocitos'), true); toggleFiltroMes(2); });
  expect(await nombresFiltro(page)).toContain('Kira Por la Página');
  await page.evaluate(id => verNinera(id), ID_N(7));
  await expect(page.locator('#vn-temporada')).not.toContainText('Fuera del país');
  await expect(page.locator('#vn-temporada')).toContainText('Toda la temporada en Montevideo.');
  await page.evaluate(() => cerrarModal());
  await abrirPanel(page);
  await filaPanel(page, 'Kira Por la Página').getByRole('button', { name: 'Todo el año' }).click();
  await filaPanel(page, 'Kira Por la Página').getByRole('button', { name: /Guardar/ }).click();
  await expect.poll(() => patchesNinera(e).length).toBe(1);
  const c = cuerpo(patchesNinera(e)[0]);
  expect(c.temporada_lugares).toBeNull();
  expect(c.temporada_lugares_en).toBeNull();
  verificarLimpio(e);
});
