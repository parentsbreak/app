// App de niñeras (fase 1, etapa 10, 02/11/2026): el carsitting (decisiones.md 6.7). La tarjeta del inicio (sin completar,
// para corregir con el comentario, en revisión, aprobada), la pantalla #carsitting (los campos y las 7 fotos, lo que falta
// sin subir nada, las fotos a su carpeta con 8 hex, el cuerpo exacto de ninera_guardar_carsitting, "¡Listo! Gracias."),
// corregir solo una foto, "Actualizar los datos del auto" en "Mi perfil" (sigue aprobada), errores (subir, la base, sin
// conexión, reintento sin volver a subir), doble toque, #carsitting desde un push, base sin migrar y 390 px. Contra el
// simulador (tests/support/rpc-carsitting.js, la misma regla que la base). Bruno hace solo traslados; Ana, solo sittings.
// Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { errorRpc } = require('./support/rpc-ninera');
const { ID, datosBase } = require('./support/datos');

const RUIDO = { ignorar: [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[carsitting\]/] };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const FOTOS = ['licencia_frente', 'licencia_dorso', 'libreta_frente', 'libreta_dorso', 'asientos', 'auto_dentro', 'auto_fuera'];
const CAMPOS = { nombre_completo: 'Bruno Inventado Prueba', cedula: '1.234.567-8', numero_licencia: '0001234', anio_licencia: '2019',
  modelo_auto: 'Auto Inventado', anio_fabricacion: '2018', color_auto: 'Gris', matricula: 'AAA 0001', padron: '000111',
  compania_seguro: 'Seguros de Prueba', tipo_seguro: 'Total', cantidad_asientos: '5', cantidad_cinturones: '5' };
const rutaDe = (clave, sufijo = '0a1b2c3d') => `carsitting/${ID.nBruno}/${clave}_${sufijo}.jpg`;

// Una fila de la app de Bruno ya mandada.
function filaBruno(extra = {}) {
  return { id: '90000000-0000-4000-8000-0000000000a1', ninera_id: ID.nBruno, ninera_nombre: 'Bruno Inventado', ...CAMPOS, libreta_propiedad: null,
    fotos: Object.fromEntries(FOTOS.map(k => [k, rutaDe(k)])), enviado_en: '2026-10-02T15:00:00Z', revision: 'pendiente', revisado_en: null,
    revisado_por: null, comentario: null, aprobado_en: null, aprobado_por: null, aprobado_datos: null, created_at: '2026-10-02T15:00:00Z', ...extra };
}
async function abrir(page, { ninera = ID.nBruno, filas = [], datos = datosBase(), ...opciones } = {}) {
  Object.assign(datos.ninieras.find(n => n.id === ninera), { zona: 'Carrasco', perfil_app_en: '2026-10-02T15:00:00+00:00' });
  datos.carsitting_datos = filas;
  datos.storage_ninieras_privado = filas.flatMap(f => Object.values(f.fotos || {}));
  const pedidos = datos.app_config.find(c => c.id === 'pedidos_app');
  if (pedidos) pedidos.valor.solo_practica = false;
  await page.addInitScript(() => { delete window.PushManager; });
  const e = await abrirAppNinera(page, { ...opciones, ninera, datos });
  if (!opciones.ruta && opciones.baseSinMigrar !== 'etapa10') await expect(page.locator('#inicio-carsitting[data-cargada]')).toBeAttached();
  return e;
}
const rpcs = (e, nombre) => e.escrituras.filter(w => w.tabla === `rpc/${nombre}`).map(w => w.cuerpo);
const subidas = e => e.escrituras.filter(w => w.metodo === 'POST' && w.tabla.startsWith('/storage/v1/object/ninieras-privado/')).map(w => decodeURIComponent(w.tabla.replace('/storage/v1/object/ninieras-privado/', '')));
async function llenar(page, valores = CAMPOS) {
  for (const [k, v] of Object.entries(valores)) await page.fill(`#cs-${k}`, v);
}
async function elegirFotos(page, claves = FOTOS) {
  for (const k of claves) await page.setInputFiles(`#cs-foto-${k}`, { name: `${k}.png`, mimeType: 'image/png', buffer: PNG });
}

test.describe('la tarjeta del inicio', () => {
  test('sin completar: "Completa tus datos de carsitting" con "Completar", que abre la pantalla', async ({ page }) => {
    const e = await abrir(page);
    const t = page.locator('#inicio-carsitting .tarjeta-carsitting');
    await expect(t.locator('h2')).toHaveText('Completa tus datos de carsitting');
    await expect(t.locator('.helper')).toHaveText('Marcaste que realizas traslados. Necesitamos estos datos una sola vez.');
    await t.getByRole('button', { name: 'Completar' }).click();
    await expect(page.locator('h1')).toHaveText('Datos de carsitting');
    expect(new URL(page.url()).hash).toBe('#carsitting');
    verificarLimpio(e);
  });

  test('para corregir: el comentario y "Corregir"; en revisión, una línea; aprobada, nada', async ({ page }) => {
    const e = await abrir(page, { filas: [filaBruno({ revision: 'rehacer', comentario: 'La foto <b>del dorso</b> está borrosa.', revisado_en: '2026-10-03T12:00:00Z' })] });
    const t = page.locator('#inicio-carsitting .tarjeta-carsitting');
    await expect(t.locator('h2')).toHaveText('Hay que corregir tus datos de carsitting');
    await expect(t.locator('.dia-estado')).toHaveText('La foto <b>del dorso</b> está borrosa.');
    await expect(t.getByRole('button', { name: 'Corregir' })).toBeVisible();
    Object.assign(e.db.carsitting_datos[0], { revision: 'pendiente', comentario: null });
    await page.evaluate(() => cargarTarjetaCarsitting());
    await expect(page.locator('#inicio-carsitting')).toHaveText('Tus datos de carsitting los está revisando el equipo.');
    Object.assign(e.db.carsitting_datos[0], { revision: 'aprobado', aprobado_en: '2026-10-03T13:00:00Z' });
    await page.evaluate(() => cargarTarjetaCarsitting());
    await expect(page.locator('#inicio-carsitting')).toBeEmpty();
    // Aprobada y actualizando: sigue aprobada, sin tarjeta.
    e.db.carsitting_datos[0].revision = 'pendiente';
    await page.evaluate(() => cargarTarjetaCarsitting());
    await expect(page.locator('#inicio-carsitting')).toBeEmpty();
    verificarLimpio(e);
  });

  test('una niñera que solo hace sittings no ve nada', async ({ page }) => {
    const e = await abrir(page, { ninera: ID.nAna });
    await expect(page.locator('#inicio-carsitting')).toBeEmpty();
    verificarLimpio(e);
  });
});

test.describe('la pantalla', () => {
  test('los grupos, los campos y las 7 fotos; lo que falta avisa sin subir nada', async ({ page }) => {
    const e = await abrir(page, { ruta: '/ninera/#carsitting' });
    await expect(page.locator('h1')).toHaveText('Datos de carsitting');
    await expect(page.locator('legend')).toHaveText(['Tus datos', 'Licencia de conducir', 'El auto', 'Seguro', 'Fotos']);
    await expect(page.locator('input[type=file]')).toHaveCount(7);
    await expect(page.locator('label[for^="cs-foto-"]')).toHaveText(['Licencia de conducir, frente', 'Licencia de conducir, dorso', 'Libreta de propiedad, frente',
      'Libreta de propiedad, dorso', 'Asientos de atrás', 'El auto por dentro', 'El auto por fuera']);
    const enviar = page.getByRole('button', { name: 'Enviar' });
    await enviar.click();
    await expect(page.locator('#cs-error')).toHaveText('Completa: Nombre completo.');
    await llenar(page, { ...CAMPOS, padron: '' });
    await enviar.click();
    await expect(page.locator('#cs-error')).toHaveText('Completa: Padrón.');
    await page.fill('#cs-padron', '000111');
    await elegirFotos(page, FOTOS.slice(0, 6));
    await enviar.click();
    await expect(page.locator('#cs-error')).toHaveText('Falta la foto: El auto por fuera.');
    expect(subidas(e)).toEqual([]);
    expect(rpcs(e, 'ninera_guardar_carsitting')).toEqual([]);
    verificarLimpio(e);
  });

  test('enviar: las 7 fotos a su carpeta, el cuerpo exacto, "¡Listo! Gracias." y el aviso al equipo', async ({ page }) => {
    const e = await abrir(page);
    await page.locator('#inicio-carsitting').getByRole('button', { name: 'Completar' }).click();
    await llenar(page, { ...CAMPOS, color_auto: '  Gris oscuro  ' });
    await elegirFotos(page);
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('.mensaje')).toHaveText('¡Listo! Gracias.');
    await expect(page.locator('main .helper')).toHaveText('El equipo lo va a revisar.');
    const rutas = subidas(e);
    expect(rutas).toHaveLength(7);
    for (const r of rutas) expect(r).toMatch(new RegExp(`^carsitting/${ID.nBruno}/(${FOTOS.join('|')})_[0-9a-f]{8}\\.jpg$`));
    const [cuerpo] = rpcs(e, 'ninera_guardar_carsitting');
    expect(cuerpo.p_datos).toEqual({ ...CAMPOS, color_auto: 'Gris oscuro', libreta_propiedad: '' });
    expect(Object.keys(cuerpo.p_fotos).sort()).toEqual([...FOTOS].sort());
    for (const k of FOTOS) expect(rutas).toContain(cuerpo.p_fotos[k]);
    expect(e.db.carsitting_datos[0]).toMatchObject({ ninera_id: ID.nBruno, revision: 'pendiente', color_auto: 'Gris oscuro', libreta_propiedad: null });
    expect(e.db.avisos.filter(a => a.tipo === 'carsitting').map(a => a.titulo)).toEqual(['Bruno Inventado completó el carsitting']);
    await page.getByRole('button', { name: 'Volver al inicio' }).click();
    await expect(page.locator('#inicio-carsitting')).toHaveText('Tus datos de carsitting los está revisando el equipo.');
    verificarLimpio(e);
  });

  test('para corregir: el comentario arriba, los datos y "Ya la cargaste"; cambia solo una foto', async ({ page }) => {
    const e = await abrir(page, { filas: [filaBruno({ revision: 'rehacer', comentario: 'La foto del dorso está borrosa.' })] });
    await page.locator('#inicio-carsitting').getByRole('button', { name: 'Corregir' }).click();
    await expect(page.locator('h1')).toHaveText('Datos del auto');
    await expect(page.locator('.aviso-info')).toHaveText('Hay que corregir algo: La foto del dorso está borrosa.');
    await expect(page.locator('#cs-modelo_auto')).toHaveValue('Auto Inventado');
    await expect(page.locator('.cs-foto-ya')).toHaveCount(7);
    await elegirFotos(page, ['licencia_dorso']);
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('.mensaje')).toHaveText('¡Listo! Gracias.');
    expect(subidas(e)).toHaveLength(1);
    const [cuerpo] = rpcs(e, 'ninera_guardar_carsitting');
    expect(Object.keys(cuerpo.p_fotos)).toEqual(['licencia_dorso']);
    expect(e.db.carsitting_datos[0]).toMatchObject({ revision: 'pendiente', comentario: null });
    expect(e.db.carsitting_datos[0].fotos.asientos).toBe(rutaDe('asientos'));
    expect(e.db.carsitting_datos[0].fotos.licencia_dorso).not.toBe(rutaDe('licencia_dorso'));
    verificarLimpio(e);
  });

  test('aprobada: "Actualizar los datos del auto" en Mi perfil; al mandar sigue aprobada y el equipo lo revisa', async ({ page }) => {
    const e = await abrir(page, { filas: [filaBruno({ revision: 'aprobado', aprobado_en: '2026-10-03T13:00:00Z', aprobado_por: 'Paula Prueba' })] });
    await page.getByRole('button', { name: 'Mi perfil' }).click();
    await page.locator('#perfil-carsitting').click();
    await expect(page.locator('h1')).toHaveText('Datos del auto');
    await expect(page.locator('main > .helper').first()).toHaveText('Si cambiaste de auto o se te venció la licencia, actualízalos: el equipo los vuelve a revisar.');
    await page.fill('#cs-modelo_auto', 'Otro Auto Inventado');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('.mensaje')).toHaveText('¡Listo! Gracias.');
    expect(rpcs(e, 'ninera_guardar_carsitting')[0].p_fotos).toEqual({});
    expect(e.db.carsitting_datos[0]).toMatchObject({ revision: 'pendiente', aprobado_en: '2026-10-03T13:00:00Z', modelo_auto: 'Otro Auto Inventado' });
    expect(e.db.avisos.filter(a => a.tipo === 'carsitting').map(a => a.titulo)).toEqual(['Bruno Inventado actualizó los datos del auto']);
    verificarLimpio(e);
  });

  test('Mi perfil de una niñera que solo hace sittings no tiene "Actualizar los datos del auto"', async ({ page }) => {
    const e = await abrir(page, { ninera: ID.nAna });
    await page.getByRole('button', { name: 'Mi perfil' }).click();
    await expect(page.locator('#perfil-guardar')).toBeVisible();
    await expect(page.locator('#perfil-carsitting')).toHaveCount(0);
    verificarLimpio(e);
  });
});

test.describe('fallas', () => {
  test('si falla subir una foto no se llama a la base; un reintento no vuelve a subir las que ya subió', async ({ page }) => {
    const e = await abrir(page, { ruta: '/ninera/#carsitting' });
    await llenar(page);
    await elegirFotos(page);
    let veces = 0;
    e.fallar = ({ tabla, metodo }) => metodo === 'POST' && tabla.includes('/auto_fuera_') && veces++ === 0 ? 'red' : null;
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('#cs-error')).toHaveText('No pudimos subir las fotos. Revisa tu conexión a internet y vuelve a intentar.');
    expect(rpcs(e, 'ninera_guardar_carsitting')).toEqual([]);
    expect(subidas(e)).toHaveLength(6);
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('.mensaje')).toHaveText('¡Listo! Gracias.');
    expect(subidas(e)).toHaveLength(7);
    verificarLimpio(e, RUIDO);
  });

  test('errores de la base: un dato que falta (con su nombre), una foto inválida y sin conexión; lo escrito queda', async ({ page }) => {
    const e = await abrir(page, { ruta: '/ninera/#carsitting' });
    await llenar(page);
    await elegirFotos(page);
    const enviar = page.getByRole('button', { name: 'Enviar' });
    e.rpc.ninera_guardar_carsitting = () => { throw errorRpc('faltan_datos', { hint: 'matricula' }); };
    await enviar.click();
    await expect(page.locator('#cs-error')).toHaveText('Completa: Matrícula.');
    e.rpc.ninera_guardar_carsitting = () => { throw errorRpc('foto_invalida', { hint: 'asientos' }); };
    await enviar.click();
    await expect(page.locator('#cs-error')).toHaveText('Vuelve a elegir la foto: Asientos de atrás.');
    e.rpc.ninera_guardar_carsitting = undefined;
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_guardar_carsitting' ? 'red' : null;
    await enviar.click();
    await expect(page.locator('#cs-error')).toHaveText('No pudimos enviar tus datos. Revisa tu conexión a internet y vuelve a intentar.');
    await expect(page.locator('#cs-modelo_auto')).toHaveValue('Auto Inventado');
    // Las fotos se subieron una sola vez, en el primer intento.
    expect(subidas(e)).toHaveLength(7);
    verificarLimpio(e, RUIDO);
  });

  test('doble toque en "Enviar": una sola vez', async ({ page }) => {
    const e = await abrir(page, { ruta: '/ninera/#carsitting' });
    await llenar(page);
    await elegirFotos(page);
    e.demoraEscrituras = 300;
    const enviar = page.getByRole('button', { name: 'Enviar' });
    await enviar.click();
    await enviar.click({ force: true, timeout: 500 }).catch(() => {});
    await expect(page.locator('.mensaje')).toHaveText('¡Listo! Gracias.', { timeout: 15_000 });
    expect(rpcs(e, 'ninera_guardar_carsitting')).toHaveLength(1);
    expect(subidas(e)).toHaveLength(7);
    verificarLimpio(e);
  });

  test('si no se puede leer: "Reintentar" en la pantalla', async ({ page }) => {
    const e = await abrir(page);
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_mi_carsitting' ? 'red' : null;
    await page.locator('#inicio-carsitting').getByRole('button', { name: 'Completar' }).click();
    await expect(page.locator('.mensaje')).toHaveText('No pudimos cargar tus datos de carsitting. Revisa tu conexión a internet y vuelve a intentar.');
    e.fallar = null;
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.locator('h1')).toHaveText('Datos de carsitting');
    verificarLimpio(e, RUIDO);
  });

  test('base sin la migración de la etapa 10: sin tarjeta y #carsitting vuelve al inicio', async ({ page }) => {
    const e = await abrir(page, { baseSinMigrar: 'etapa10', ruta: '/ninera/#carsitting' });
    await expect(page.locator('#inicio-carsitting')).toBeAttached();
    expect(new URL(page.url()).hash).toBe('#inicio');
    await expect(page.locator('#inicio-carsitting')).toBeEmpty();
    verificarLimpio(e, RUIDO);
  });

  test('a 390 px: la pantalla entra (captura)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrir(page, { ruta: '/ninera/#carsitting' });
    await expect(page.locator('h1')).toHaveText('Datos de carsitting');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/ninera-carsitting-390.png', fullPage: true });
    verificarLimpio(e);
  });
});
