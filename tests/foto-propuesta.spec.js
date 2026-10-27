// Fase 1, etapa 2 (27/10/2026): en la ficha de la niñera del panel, la fila "App" dice cuándo
// completó el perfil desde su app (y si lo editó después: puede cambiar su cuenta bancaria), y la
// foto que mandó queda como "foto propuesta" en el bucket privado hasta que una admin la usa como
// foto del CV (la ven las madres) o la descarta. Todo contra el simulador: Carla completó el perfil
// y mandó una foto; Ana no. Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { datosBase, ID } = require('./support/datos');

const RUTA = `fotos/${ID.nCarla}/propuesta.jpg`;
const PRIVADO = `/storage/v1/object/ninieras-privado`;
const FIRMADA = `/storage/v1/object/sign/ninieras-privado/${RUTA}`;
const PUBLICO = '/storage/v1/object/ninieras-fotos/';
// Chromium anota en consola toda respuesta 4xx/5xx simulada y todo pedido cortado.
const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[Supabase\] al guardar/];

const toasts = page => page.locator('.toaststack .toast');
const bloque = page => page.locator('#vn-foto-propuesta');
const botonUsar = page => bloque(page).locator('button', { hasText: 'Usar como foto del CV' });
const botonDescartar = page => bloque(page).locator('button', { hasText: 'Descartar' });

async function abrirFicha(page, id, opciones = {}) {
  const e = await abrirApp(page, { datos: opciones.datos || datosBase(), ...opciones });
  // Las bajadas (GET) del storage no son escrituras: se anotan aparte para ver de dónde se bajó.
  e.bajadas = [];
  page.on('request', r => {
    const u = new URL(r.url());
    if (r.method() === 'GET' && u.pathname.startsWith('/storage/v1/')) e.bajadas.push(u.pathname);
  });
  await irAModulo(page, 'ninieras');
  await page.evaluate(i => verNinera(i), id);
  await expect(page.locator('#editmodal.show')).toBeVisible();
  await expect(page.locator('#vn-app')).not.toContainText('Cargando');
  return e;
}
const escriturasStorage = e => e.escrituras.filter(w => w.tabla.startsWith('/storage/v1/object/') && !w.tabla.startsWith('/storage/v1/object/sign/'));
const subidasPublicas = e => e.escrituras.filter(w => w.tabla.startsWith(PUBLICO) && w.metodo === 'POST');
const parches = e => e.escrituras.filter(w => w.tabla === 'ninieras' && w.metodo === 'PATCH');
const borradosPrivados = e => e.escrituras.filter(w => w.tabla === PRIVADO && w.metodo === 'DELETE');
const carla = e => e.db.ninieras.find(n => n.id === ID.nCarla);

test.describe('ficha de la niñera: perfil completado en la app', () => {
  test('textoPerfilApp: nada, completado, y editado solo si pasó más de un minuto', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosBase() });
    const r = await page.evaluate(() => [
      textoPerfilApp({}),
      textoPerfilApp({ perfil_app_en: null, perfil_actualizado_en: null }),
      textoPerfilApp({ perfil_app_en: '2026-10-02T15:00:00+00:00', perfil_actualizado_en: '2026-10-02T15:00:00+00:00' }),
      textoPerfilApp({ perfil_app_en: '2026-10-02T15:00:00+00:00', perfil_actualizado_en: '2026-10-02T15:00:50+00:00' }),
      textoPerfilApp({ perfil_app_en: '2026-10-02T15:00:00+00:00', perfil_actualizado_en: '2026-10-04T14:00:00+00:00' }),
      // 23:30 de Montevideo ya es el día siguiente en UTC: la fecha va en hora de acá.
      textoPerfilApp({ perfil_app_en: '2026-10-03T02:30:00+00:00', perfil_actualizado_en: null }),
    ]);
    expect(r).toEqual([
      '',
      '',
      'Perfil completado en la app el 02/10',
      'Perfil completado en la app el 02/10',
      'Perfil completado en la app el 02/10, editado el 04/10',
      'Perfil completado en la app el 02/10',
    ]);
    verificarLimpio(e);
  });

  test('Carla: la fila "App" dice cuándo completó y cuándo editó; Ana: nada', async ({ page }) => {
    const d = datosBase();
    d.ninieras.find(n => n.id === ID.nCarla).perfil_actualizado_en = '2026-10-03T20:00:00+00:00';
    const e = await abrirFicha(page, ID.nCarla, { datos: d });
    await expect(page.locator('#vn-app')).toContainText('Sin app');
    await expect(page.locator('#vn-app')).toContainText('Perfil completado en la app el 02/10, editado el 03/10');
    await page.evaluate(i => verNinera(i), ID.nAna);
    await expect(page.locator('#vn-app')).toContainText('Sin app');
    await expect(page.locator('#vn-app')).not.toContainText('Perfil');
    await expect(bloque(page)).toHaveCount(0);
    verificarLimpio(e);
  });
});

test.describe('ficha de la niñera: foto propuesta', () => {
  test('Carla: el bloque con la fecha, la imagen firmada y los dos botones', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla);
    await expect(bloque(page)).toContainText('Foto propuesta por la niñera el 02/10');
    const img = bloque(page).locator('img');
    await expect(img).toHaveAttribute('src', new RegExp(`${FIRMADA.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\?token=ficticio$`));
    await expect.poll(() => img.evaluate(i => i.complete && i.naturalWidth)).toBe(1);
    await expect(botonUsar(page)).toBeVisible();
    await expect(botonDescartar(page)).toBeVisible();
    // La firma se pide por 10 minutos y nada más: ni subidas ni cambios en la base al abrir.
    const firmas = e.escrituras.filter(w => w.tabla === FIRMADA);
    expect(firmas).toHaveLength(1);
    expect(JSON.parse(firmas[0].cuerpo)).toEqual({ expiresIn: 600 });
    expect(escriturasStorage(e)).toEqual([]);
    expect(parches(e)).toEqual([]);
    verificarLimpio(e);
  });

  test('si no se puede firmar la URL: "No se pudo mostrar la foto" y los botones igual', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosBase() });
    e.fallar = p => (p.tabla.startsWith('/storage/v1/object/sign/') ? { status: 500, message: 'se cayó' } : undefined);
    await irAModulo(page, 'ninieras');
    await page.evaluate(i => verNinera(i), ID.nCarla);
    await expect(bloque(page)).toContainText('No se pudo mostrar la foto');
    await expect(bloque(page).locator('img')).toHaveCount(0);
    await expect(botonUsar(page)).toBeEnabled();
    await expect(botonDescartar(page)).toBeEnabled();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('"Usar como foto del CV": baja la propuesta, la sube al CV, guarda y borra la propuesta', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla);
    await botonUsar(page).click();
    await expect(toasts(page).last()).toHaveText('Foto del CV actualizada.');
    expect(e.bajadas).toContain(`${PRIVADO}/${RUTA}`);
    const subidas = subidasPublicas(e);
    expect(subidas).toHaveLength(1);
    const nombre = subidas[0].tabla.slice(PUBLICO.length);
    expect(nombre).toMatch(new RegExp(`^ninera-\\d+-${ID.nCarla}\\.png$`)); // el simulador baja un PNG
    expect(parches(e)).toHaveLength(1);
    const p = parches(e)[0];
    // Con la condición de la foto que se vio: si la niñera mandó otra, no se pisa (ver abajo).
    expect(p.params).toEqual({ id: `eq.${ID.nCarla}`, foto_propuesta_en: 'eq.2026-10-02T15:00:00+00:00', select: 'id' });
    expect(Object.keys(p.cuerpo).sort()).toEqual(['foto', 'foto_propuesta_en', 'foto_propuesta_ruta']);
    expect(p.cuerpo.foto).toMatch(new RegExp(`/storage/v1/object/public/ninieras-fotos/${nombre.replace('.', '\\.')}$`));
    expect(p.cuerpo.foto_propuesta_ruta).toBeNull();
    expect(p.cuerpo.foto_propuesta_en).toBeNull();
    expect(borradosPrivados(e)).toHaveLength(1);
    expect(JSON.parse(borradosPrivados(e)[0].cuerpo)).toEqual({ prefixes: [RUTA] });
    // El update va después de la subida y el borrado de la propuesta al final.
    const orden = e.escrituras.map(w => w.tabla + ' ' + w.metodo);
    expect(orden.indexOf(subidas[0].tabla + ' POST')).toBeLessThan(orden.indexOf('ninieras PATCH'));
    expect(orden.indexOf('ninieras PATCH')).toBeLessThan(orden.indexOf(PRIVADO + ' DELETE'));
    // La ficha se repinta: sin el bloque y con la foto nueva arriba.
    await expect(bloque(page)).toHaveCount(0);
    await expect(page.locator('#editmodal img').first()).toHaveAttribute('src', p.cuerpo.foto);
    expect(carla(e).foto).toBe(p.cuerpo.foto);
    expect(carla(e).foto_propuesta_ruta).toBeNull();
    verificarLimpio(e);
  });

  test('si falla bajar la propuesta: aviso y nada subido ni guardado', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla);
    e.fallar = p => (p.tabla === `${PRIVADO}/${RUTA}` ? 'red' : undefined);
    await botonUsar(page).click();
    await expect(toasts(page).last()).toHaveText('No se pudo descargar la foto propuesta');
    expect(escriturasStorage(e)).toEqual([]);
    expect(parches(e)).toEqual([]);
    await expect(bloque(page)).toBeVisible();
    await expect(botonUsar(page)).toBeEnabled();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('si falla la subida al CV: aviso, ningún PATCH y la propuesta sigue', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla);
    e.fallar = p => (p.tabla.startsWith(PUBLICO) ? { status: 500, message: 'se cayó' } : undefined);
    await botonUsar(page).click();
    await expect(toasts(page).last()).toHaveText('No se pudo subir la foto al CV');
    expect(parches(e)).toEqual([]);
    expect(borradosPrivados(e)).toEqual([]);
    expect(carla(e).foto).toBeNull();
    await expect(bloque(page)).toBeVisible();
    await expect(botonUsar(page)).toBeEnabled();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('si falla guardar: aviso, la propuesta sigue y la subida que sobra se borra', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla);
    e.fallar = p => (p.tabla === 'ninieras' && p.metodo === 'PATCH' ? { status: 500, message: 'se cayó' } : undefined);
    await botonUsar(page).click();
    await expect(toasts(page).last()).toContainText('No se pudo guardar la foto del CV: se cayó');
    expect(subidasPublicas(e)).toHaveLength(1);
    expect(borradosPrivados(e)).toEqual([]);
    // La foto subida no quedó en ninguna ficha: se borra para no dejarla suelta en el bucket público.
    const nombre = subidasPublicas(e)[0].tabla.slice(PUBLICO.length);
    const borradoPublico = e.escrituras.filter(w => w.tabla === '/storage/v1/object/ninieras-fotos' && w.metodo === 'DELETE');
    expect(borradoPublico.map(w => JSON.parse(w.cuerpo))).toEqual([{ prefixes: [nombre] }]);
    expect(carla(e).foto).toBeNull();
    expect(carla(e).foto_propuesta_ruta).toBe(RUTA);
    await expect(bloque(page)).toBeVisible();
    await expect(bloque(page)).toContainText('Foto propuesta por la niñera el 02/10');
    await expect(botonUsar(page)).toBeEnabled();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('si falla borrar la propuesta después de guardar: igual queda hecho (solo se anota)', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla);
    e.fallar = p => (p.tabla === PRIVADO && p.metodo === 'DELETE' ? { status: 500, message: 'se cayó' } : undefined);
    await botonUsar(page).click();
    await expect(toasts(page).last()).toHaveText('Foto del CV actualizada.');
    expect(parches(e)).toHaveLength(1);
    await expect(bloque(page)).toHaveCount(0);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('doble toque en "Usar como foto del CV": una sola subida y un solo PATCH', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla);
    e.demoraEscrituras = 400;
    await botonUsar(page).dblclick();
    await expect(toasts(page).last()).toHaveText('Foto del CV actualizada.', { timeout: 10_000 });
    expect(subidasPublicas(e)).toHaveLength(1);
    expect(parches(e)).toHaveLength(1);
    expect(borradosPrivados(e)).toHaveLength(1);
    verificarLimpio(e);
  });

  test('"Descartar": pregunta, limpia las dos columnas y después borra la propuesta', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla);
    await botonDescartar(page).click();
    await expect(page.locator('.confirmmsg')).toHaveText('¿Descartar la foto propuesta?');
    await expect(page.locator('#confirm-si')).toHaveText('Descartar la foto');
    // Cancelar no toca nada.
    await page.locator('#confirm-no').click();
    await expect(page.locator('#confirm-si')).toHaveCount(0);
    expect(escriturasStorage(e)).toEqual([]);
    expect(parches(e)).toEqual([]);
    await expect(botonDescartar(page)).toBeEnabled();

    await botonDescartar(page).click();
    await page.locator('#confirm-si').click();
    await expect(toasts(page).last()).toHaveText('Foto propuesta descartada.');
    expect(borradosPrivados(e).map(w => JSON.parse(w.cuerpo))).toEqual([{ prefixes: [RUTA] }]);
    expect(parches(e).map(p => p.cuerpo)).toEqual([{ foto_propuesta_ruta: null, foto_propuesta_en: null }]);
    expect(parches(e)[0].params).toEqual({ id: `eq.${ID.nCarla}`, foto_propuesta_en: 'eq.2026-10-02T15:00:00+00:00', select: 'id' });
    expect(subidasPublicas(e)).toEqual([]);
    // El archivo se borra recién cuando la ficha ya no lo apunta: nunca una foto nueva de la niñera.
    const orden = e.escrituras.map(w => w.tabla + ' ' + w.metodo);
    expect(orden.indexOf('ninieras PATCH')).toBeLessThan(orden.indexOf(PRIVADO + ' DELETE'));
    await expect(bloque(page)).toHaveCount(0);
    expect(carla(e).foto_propuesta_ruta).toBeNull();
    expect(carla(e).foto).toBeNull();
    verificarLimpio(e);
  });

  test('"Descartar" si falla el borrado después de guardar: igual queda descartada (solo se anota)', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla);
    e.fallar = p => (p.tabla === PRIVADO && p.metodo === 'DELETE' ? 'red' : undefined);
    await botonDescartar(page).click();
    await page.locator('#confirm-si').click();
    await expect(toasts(page).last()).toHaveText('Foto propuesta descartada.');
    expect(parches(e)).toHaveLength(1);
    expect(carla(e).foto_propuesta_ruta).toBeNull();
    await expect(bloque(page)).toHaveCount(0);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('"Descartar" si falla guardar: aviso y la ficha sigue con el bloque', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla);
    e.fallar = p => (p.tabla === 'ninieras' && p.metodo === 'PATCH' ? { status: 500, message: 'se cayó' } : undefined);
    await botonDescartar(page).click();
    await page.locator('#confirm-si').click();
    await expect(toasts(page).last()).toContainText('No se pudo guardar');
    expect(carla(e).foto_propuesta_ruta).toBe(RUTA);
    await expect(bloque(page)).toBeVisible();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('"Usar" si la niñera mandó otra foto mientras se miraba: aviso, nada cambia y la copia se borra', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla);
    // La niñera vuelve a subir desde su app (misma ruta, otra fecha) con la ficha abierta.
    carla(e).foto_propuesta_en = '2026-10-04T14:00:00+00:00';
    await botonUsar(page).click();
    await expect(toasts(page).last()).toHaveText('La niñera mandó otra foto mientras la mirabas. Volvé a abrir la ficha.');
    expect(parches(e)).toHaveLength(1); // el intento condicionado, que no actualizó ninguna fila
    expect(carla(e).foto).toBeNull();
    expect(carla(e).foto_propuesta_ruta).toBe(RUTA);
    expect(borradosPrivados(e)).toEqual([]);
    const nombre = subidasPublicas(e)[0].tabla.slice(PUBLICO.length);
    const borradoPublico = e.escrituras.filter(w => w.tabla === '/storage/v1/object/ninieras-fotos' && w.metodo === 'DELETE');
    expect(borradoPublico.map(w => JSON.parse(w.cuerpo))).toEqual([{ prefixes: [nombre] }]);
    // La ficha se repinta con la foto nueva y sus botones ya van con la fecha nueva.
    await expect(bloque(page)).toContainText('Foto propuesta por la niñera el 04/10');
    await botonUsar(page).click();
    await expect(toasts(page).last()).toHaveText('Foto del CV actualizada.');
    expect(carla(e).foto).toMatch(/ninieras-fotos/);
    verificarLimpio(e);
  });

  test('"Descartar" si la niñera mandó otra foto mientras se miraba: aviso y no se borra nada', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla);
    carla(e).foto_propuesta_en = '2026-10-04T14:00:00+00:00';
    await botonDescartar(page).click();
    await page.locator('#confirm-si').click();
    await expect(toasts(page).last()).toHaveText('La niñera mandó otra foto mientras la mirabas. Volvé a abrir la ficha.');
    expect(borradosPrivados(e)).toEqual([]);
    expect(carla(e).foto_propuesta_ruta).toBe(RUTA);
    expect(carla(e).foto_propuesta_en).toBe('2026-10-04T14:00:00+00:00');
    expect(carla(e).foto).toBeNull();
    await expect(bloque(page)).toContainText('Foto propuesta por la niñera el 04/10');
    verificarLimpio(e);
  });

  test('propuesta sin fecha: la condición va con is.null', async ({ page }) => {
    const d = datosBase();
    d.ninieras.find(n => n.id === ID.nCarla).foto_propuesta_en = null;
    const e = await abrirFicha(page, ID.nCarla, { datos: d });
    await expect(bloque(page).locator('div').first()).toHaveText('Foto propuesta por la niñera');
    await botonUsar(page).click();
    await expect(toasts(page).last()).toHaveText('Foto del CV actualizada.');
    expect(parches(e)[0].params).toEqual({ id: `eq.${ID.nCarla}`, foto_propuesta_en: 'is.null', select: 'id' });
    verificarLimpio(e);
  });

  test('base sin migrar: la ficha sin el bloque ni el perfil completado, y sin errores', async ({ page }) => {
    const e = await abrirFicha(page, ID.nCarla, { baseSinMigrar: true });
    await expect(page.locator('#vn-app')).toContainText('Sin app');
    await expect(page.locator('#vn-app')).not.toContainText('Perfil');
    await expect(bloque(page)).toHaveCount(0);
    expect(e.escrituras.filter(w => w.tabla.startsWith('/storage/'))).toEqual([]);
    verificarLimpio(e, { ignorar: [/status of (400|404)/] });
  });

  test('390 px: el bloque entra sin scroll horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirFicha(page, ID.nCarla);
    await expect(bloque(page).locator('img')).toBeVisible();
    await expect(page.locator('#editmodal')).toHaveCSS('opacity', '1'); // terminó de aparecer
    const anchoOk = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth
      && [...document.querySelectorAll('#vn-foto-propuesta, .confirmbox')].every(b => b.scrollWidth <= b.clientWidth + 1));
    expect(await anchoOk()).toBe(true);
    const caja = await bloque(page).boundingBox();
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('foto-propuesta-390.png') });
    await botonDescartar(page).click();
    await expect(page.locator('.confirmoverlay', { has: page.locator('#confirm-si') })).toHaveCSS('opacity', '1');
    expect(await anchoOk()).toBe(true);
    await page.locator('#confirm-no').click();
    verificarLimpio(e);
  });
});
