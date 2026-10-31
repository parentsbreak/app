// Precio por hora de cada niñera con cada familia, en las fichas (01/11/2026, docs/precio-ninera-familia.md,
// tarea C). Ficha de la familia: la sección "Precio por niñera" (lista con la tarifa de referencia, agregar
// con el pago precargado del último sitting de esa niñera con esa familia, editar y borrar con la
// condición de actualizado_en, como lo que dos admins pueden cambiar a la vez). Ficha de la niñera:
// "Precio por familia", solo para mirar (respuesta 4 de Diego).
// Datos inventados: Familia Prueba Uno cobra $380 y paga $250 por hora (fijo de Ana lunes y miércoles);
// Familia Prueba Dos paga $260. Hoy en los tests = domingo 04/10/2026, 12:00 de Montevideo.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

let nPrecio = 0;
const precio = (familia_id, ninera_id, pago_hora, extra = {}) => ({
  id: `96000000-0000-4000-8000-${String(++nPrecio).padStart(12, '0')}`,
  familia_id, ninera_id, pago_hora, nota: null, creado_por: 'Prueba', creado_en: '2026-10-01T12:00:00Z', actualizado_en: '2026-10-01T12:00:00Z', ...extra,
});
// Sittings de Carla con la Familia Prueba Uno: el último que vale es el del 01/10 (3,5 h por $1.000 =
// $285,71 la hora, sin centavos $286). Los que no cuentan: uno cancelado, uno futuro, un traslado y uno
// sin pago (el de hoy de Ana en $0 ya está en los datos base).
const ID_S = n => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const deCarla = extra => ({ ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', ...extra });
function sittingsDeCarla() {
  return [
    sitting(ID_S(1), '2026-09-20', deCarla({ hora_inicio: '14:00:00', hora_fin: '17:00:00', pago_ninera: 900 })),
    sitting(ID_S(2), '2026-10-01', deCarla({ hora_inicio: '14:00:00', hora_fin: '17:30:00', pago_ninera: 1000 })),
    sitting(ID_S(3), '2026-10-02', deCarla({ hora_inicio: '14:00:00', hora_fin: '16:00:00', pago_ninera: 2000, cancelado: true })),
    sitting(ID_S(4), '2026-10-10', deCarla({ hora_inicio: '14:00:00', hora_fin: '16:00:00', pago_ninera: 3000 })),
    sitting(ID_S(5), '2026-10-03', deCarla({ tipo: 'traslado', hora_inicio: '08:00:00', hora_fin: '09:00:00', pago_ninera: 500 })),
  ];
}
function datosCon({ precios = [], fijosAutomaticos = false, conSittings = true } = {}) {
  const d = datosBase();
  d.precios_ninera_familia = precios;
  if (conSittings) d.sittings_traslados.push(...sittingsDeCarla());
  if (fijosAutomaticos) {
    d.app_config = [{ id: 'fijos_automaticos', valor: { activo: true, dias: 14 }, actualizado_at: '2026-10-04T06:00:00Z' }];
    d.asignaciones_pausas = [];
  }
  return d;
}
const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && w.metodo === metodo);
const llamadasProceso = e => e.escrituras.filter(w => w.tabla === 'rpc/generar_previstos_fijos');
function espiarLecturas(page, tabla) {
  const urls = [];
  page.on('request', r => { if (r.method() === 'GET' && r.url().includes(`/rest/v1/${tabla}?`)) urls.push(decodeURIComponent(r.url())); });
  return urls;
}
// La lectura de la tabla responde con error (500) o como una base sin la migración (404 PGRST205).
async function lecturaPreciosQueFalla(page, sinTabla = false) {
  await page.route(/precios_ninera_familia/, r => r.request().method() !== 'GET' ? r.fallback()
    : r.fulfill(sinTabla
      ? { status: 404, json: { code: 'PGRST205', message: "Could not find the table 'public.precios_ninera_familia' in the schema cache" } }
      : { status: 500, json: { code: 'XX000', message: 'falla simulada' } }));
}
// Frena la lectura del último sitting de una niñera hasta que el test la suelte.
async function frenarUltimoSitting(page, ninera) {
  let soltar;
  const frenada = new Promise(r => { soltar = r; });
  await page.route(/sittings_traslados/, async r => {
    const u = decodeURIComponent(r.request().url());
    if (r.request().method() === 'GET' && u.includes(`ninera_id=eq.${ninera}`) && u.includes('limit=')) await frenada;
    return r.fallback();
  });
  return () => soltar();
}

const seccion = page => page.locator('#fam-precios-nin');
const filas = page => page.locator('#fam-precios-nin .precio-nin-fila');
const modal = page => page.locator('#precio-nin-overlay');
const toastMalo = (page, texto) => page.locator('.toaststack .toast.bad', { hasText: texto });
async function abrirFicha(page, familia = ID.fUno) {
  await irAModulo(page, 'familias');
  await page.evaluate(id => verFamilia(id), familia);
  await expect(seccion(page).locator('.card-section-title')).toHaveText('Precio por niñera');
}
async function agregar(page) {
  await seccion(page).locator('button', { hasText: '+ Agregar' }).click();
  await expect(modal(page)).toBeVisible();
}
async function elegirNinera(page, texto, nombre) {
  // El buscador esconde la lista 150 ms después de perder el foco (attachAutocomplete): una segunda
  // elección enseguida de la primera la vería cerrarse sola.
  await page.waitForTimeout(200);
  await page.fill('#pnf-ninera', texto);
  await page.locator('#pnf-ninera-dropdown .autocomplete-item', { hasText: nombre }).click();
}
const guardar = page => page.locator('#pnf-guardar').click();

/* ---------------- Ficha de la familia: la lista ---------------- */
test.describe('ficha de la familia: la lista "Precio por niñera"', () => {
  test('niñera, $/h, nota y "cambiado el dd/mm" (de Montevideo), con la tarifa de referencia. Una sola lectura', async ({ page }) => {
    const urls = espiarLecturas(page, 'precios_ninera_familia');
    // 01:30 del 03/10 en UTC es el 02/10 a las 22:30 en Montevideo.
    const e = await abrirApp(page, { datos: datosCon({ precios: [
      precio(ID.fUno, ID.nCarla, 300, { nota: '3 chicos', actualizado_en: '2026-10-03T01:30:00Z' }),
      precio(ID.fDos, ID.nAna, 999),
    ] }) });
    await abrirFicha(page);
    await expect(filas(page)).toHaveCount(1); // la de la otra familia no
    await expect(filas(page)).toContainText('Carla Ejemplo');
    await expect(filas(page)).toContainText('$300/h');
    await expect(filas(page)).toContainText('3 chicos');
    await expect(filas(page)).toContainText('cambiado el 02/10');
    await expect(seccion(page)).toContainText('Las demás niñeras: $250/h (tarifa de la familia)');
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`familia_id=eq.${ID.fUno}`);
    expect(urls[0]).not.toContain('select=*');
    verificarLimpio(e);
  });

  test('familia sin tarifa: "Las demás niñeras: sin tarifa cargada"', async ({ page }) => {
    const d = datosCon({ precios: [precio(ID.fDos, ID.nCarla, 300)] });
    d.familias.find(f => f.id === ID.fDos).pago_hora = null;
    const e = await abrirApp(page, { datos: d });
    await abrirFicha(page, ID.fDos);
    await expect(seccion(page)).toContainText('Las demás niñeras: sin tarifa cargada');
    verificarLimpio(e);
  });

  test('sin precios: todas con la tarifa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon() });
    await abrirFicha(page);
    await expect(filas(page)).toHaveCount(0);
    await expect(seccion(page)).toContainText('$250/h (tarifa de la familia)');
    verificarLimpio(e);
  });

  test('si falla la lectura: aviso y "Reintentar", nunca la lista vacía', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nCarla, 300)] }) });
    await lecturaPreciosQueFalla(page);
    await abrirFicha(page);
    await expect(seccion(page)).toContainText('No se pudieron leer los precios por niñera.');
    await expect(seccion(page)).not.toContainText('tarifa de la familia');
    await expect(seccion(page).locator('button', { hasText: '+ Agregar' })).toHaveCount(0);
    await page.unroute(/precios_ninera_familia/);
    await seccion(page).locator('button', { hasText: 'Reintentar' }).click();
    await expect(filas(page)).toContainText('$300/h');
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('base sin la tabla: la sección no aparece y la ficha anda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon() });
    await lecturaPreciosQueFalla(page, true);
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await expect(page.locator('#editmodal h2')).toHaveText('Familia Prueba Uno');
    await page.waitForTimeout(300);
    await expect(seccion(page)).toBeEmpty();
    await expect(page.locator('.toaststack .toast.bad')).toHaveCount(0);
    verificarLimpio(e, { ignorar: [/status of 404/] });
  });
});

/* ---------------- Agregar ---------------- */
test.describe('ficha de la familia: "+ Agregar"', () => {
  test('el pago viene con el de su último sitting con esa familia (sin cancelados, futuros ni traslados) y se guarda', async ({ page }) => {
    const urls = espiarLecturas(page, 'sittings_traslados');
    const e = await abrirApp(page, { datos: datosCon() });
    await abrirFicha(page);
    await agregar(page);
    // Solo niñeras activas que hacen sittings: Bruno hace solo traslados.
    await page.fill('#pnf-ninera', 'bru');
    await expect(page.locator('#pnf-ninera-dropdown .autocomplete-item')).toHaveCount(0);
    const antes = urls.length;
    await elegirNinera(page, 'carla', 'Carla Ejemplo');
    await expect(page.locator('#pnf-pago')).toHaveValue('286');
    await expect(page.locator('#pnf-origen')).toContainText('último sitting');
    const lectura = urls.slice(antes);
    expect(lectura).toHaveLength(1);
    expect(lectura[0]).toContain(`familia_id=eq.${ID.fUno}`);
    expect(lectura[0]).toContain(`ninera_id=eq.${ID.nCarla}`);
    expect(lectura[0]).toContain('limit=');
    expect(lectura[0]).not.toContain('select=*');
    await page.fill('#pnf-nota', '3 chicos');
    await guardar(page);
    await expect(modal(page)).toHaveCount(0);
    const [alta] = escrituras(e, 'precios_ninera_familia', 'POST');
    expect(alta.cuerpo).toMatchObject({ familia_id: ID.fUno, ninera_id: ID.nCarla, pago_hora: 286, nota: '3 chicos' });
    await expect(filas(page)).toContainText('$286/h');
    await expect(filas(page)).toContainText('3 chicos');
    verificarLimpio(e);
  });

  test('con variantes en el último sitting: la base, sin las variantes', async ({ page }) => {
    const d = datosCon();
    d.sittings_traslados.push(sitting(ID_S(6), '2026-10-03', deCarla({ hora_inicio: '10:00:00', hora_fin: '12:00:00', pago_ninera: 800,
      precio_variantes: { base: { cobro: 760, pago: 560 }, aplicadas: [{ id: 'v1', nombre: 'La llevó a la casa', cobro: null, pago: { modo: 'sumar', valor: 240 } }] } })));
    const e = await abrirApp(page, { datos: d });
    await abrirFicha(page);
    await agregar(page);
    await elegirNinera(page, 'carla', 'Carla Ejemplo');
    await expect(page.locator('#pnf-pago')).toHaveValue('280'); // $560 en 2 h
    verificarLimpio(e);
  });

  test('sin sittings con esa familia: la tarifa de la familia', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon() });
    await abrirFicha(page, ID.fDos);
    await agregar(page);
    await elegirNinera(page, 'ana', 'Ana Ficticia');
    await expect(page.locator('#pnf-pago')).toHaveValue('260');
    await expect(page.locator('#pnf-origen')).toContainText('tarifa de la familia');
    verificarLimpio(e);
  });

  test('lo que la admin ya tipeó no se pisa cuando llega el último sitting', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon() });
    await abrirFicha(page);
    const soltar = await frenarUltimoSitting(page, ID.nCarla);
    await agregar(page);
    await elegirNinera(page, 'carla', 'Carla Ejemplo');
    await page.fill('#pnf-pago', '400');
    soltar();
    await page.waitForTimeout(300);
    await expect(page.locator('#pnf-pago')).toHaveValue('400');
    verificarLimpio(e);
  });

  test('una lectura vieja que vuelve tarde (cambió de niñera) se descarta', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon() });
    await abrirFicha(page);
    const soltar = await frenarUltimoSitting(page, ID.nCarla);
    await agregar(page);
    await elegirNinera(page, 'carla', 'Carla Ejemplo');
    await elegirNinera(page, 'ana', 'Ana Ficticia');
    await expect(page.locator('#pnf-pago')).toHaveValue('250'); // el último de Ana: 3 h por $750
    soltar();
    await page.waitForTimeout(300);
    await expect(page.locator('#pnf-pago')).toHaveValue('250');
    verificarLimpio(e);
  });

  test('par repetido: el modal pasa a editar esa fila', async ({ page }) => {
    const fila = precio(ID.fUno, ID.nCarla, 300, { nota: '3 chicos' });
    const e = await abrirApp(page, { datos: datosCon({ precios: [fila] }) });
    await abrirFicha(page);
    await agregar(page);
    await elegirNinera(page, 'carla', 'Carla Ejemplo');
    await expect(page.locator('#pnf-ya-tiene')).toHaveText('Ya tiene un precio con esta familia: lo estás cambiando.');
    await expect(page.locator('#pnf-pago')).toHaveValue('300');
    await expect(page.locator('#pnf-nota')).toHaveValue('3 chicos');
    // Otra niñera sin precio: vuelve a ser un alta.
    await elegirNinera(page, 'ana', 'Ana Ficticia');
    await expect(page.locator('#pnf-ya-tiene')).toBeHidden();
    await expect(page.locator('#pnf-pago')).toHaveValue('250');
    await expect(page.locator('#pnf-nota')).toHaveValue('');
    await elegirNinera(page, 'carla', 'Carla Ejemplo');
    await page.fill('#pnf-pago', '320');
    await guardar(page);
    await expect(modal(page)).toHaveCount(0);
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toEqual([]);
    const [cambio] = escrituras(e, 'precios_ninera_familia', 'PATCH');
    expect(cambio.cuerpo).toEqual({ pago_hora: 320, nota: '3 chicos' });
    expect(cambio.params).toMatchObject({ id: `eq.${fila.id}`, actualizado_en: `eq.${fila.actualizado_en}` });
    await expect(filas(page)).toContainText('$320/h');
    verificarLimpio(e);
  });

  test('otra admin le cargó un precio a la vez (23505): aviso, se repinta y no se guarda nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon() });
    await abrirFicha(page);
    await agregar(page);
    await elegirNinera(page, 'carla', 'Carla Ejemplo');
    e.fallar = ({ tabla, metodo }) => {
      if (tabla !== 'precios_ninera_familia' || metodo !== 'POST') return undefined;
      e.db.precios_ninera_familia.push(precio(ID.fUno, ID.nCarla, 310, { nota: 'de la otra admin' }));
      return { status: 409, code: '23505', message: 'duplicate key value violates unique constraint "precios_ninera_familia_par_key"' };
    };
    await guardar(page);
    await expect(toastMalo(page, 'Otra admin le cargó un precio a esta niñera recién. Abrilo de nuevo para verlo.')).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    await expect(filas(page)).toContainText('$310/h');
    expect(e.db.precios_ninera_familia).toHaveLength(1);
    expect(escrituras(e, 'precios_ninera_familia', 'PATCH')).toEqual([]);
    verificarLimpio(e, { ignorar: [/status of 409/] });
  });

  test('si falla guardar: el modal queda abierto con lo escrito y el error, sin éxito falso', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon() });
    await abrirFicha(page);
    await agregar(page);
    await elegirNinera(page, 'carla', 'Carla Ejemplo');
    await page.fill('#pnf-pago', '330');
    await page.fill('#pnf-nota', 'fuera de Montevideo');
    e.fallar = ({ tabla }) => tabla === 'precios_ninera_familia' ? { status: 500, message: 'falla simulada' } : undefined;
    await guardar(page);
    await expect(page.locator('#pnf-warn')).toContainText('falla simulada');
    await expect(modal(page)).toBeVisible();
    await expect(page.locator('#pnf-ninera')).toHaveValue('Carla Ejemplo');
    await expect(page.locator('#pnf-pago')).toHaveValue('330');
    await expect(page.locator('#pnf-nota')).toHaveValue('fuera de Montevideo');
    await expect(page.locator('.toaststack .toast.good')).toHaveCount(0);
    // Sin conexión: igual.
    e.fallar = ({ tabla }) => tabla === 'precios_ninera_familia' ? 'red' : undefined;
    await guardar(page);
    await expect(page.locator('#pnf-warn .warnbox')).toBeVisible();
    await expect(modal(page)).toBeVisible();
    // Vuelve la base: se guarda.
    e.fallar = null;
    await guardar(page);
    await expect(modal(page)).toHaveCount(0);
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toHaveLength(1);
    verificarLimpio(e, { ignorar: [/status of 500/, /Failed to fetch|ERR_FAILED/] });
  });

  test('doble toque en Guardar: un solo insert', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon() });
    await abrirFicha(page);
    await agregar(page);
    await elegirNinera(page, 'carla', 'Carla Ejemplo');
    e.demoraEscrituras = 400;
    await page.locator('#pnf-guardar').dblclick();
    await expect(modal(page)).toHaveCount(0);
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('validación: niñera de la lista, pago mayor que $0 y menor que $100.000 sin centavos, nota de hasta 200', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon() });
    await abrirFicha(page);
    await agregar(page);
    const warn = page.locator('#pnf-warn');
    await page.fill('#pnf-ninera', 'carla');
    await page.fill('#pnf-pago', '300');
    await guardar(page);
    await expect(warn).toContainText('Elegí la niñera de la lista.');
    await elegirNinera(page, 'carla', 'Carla Ejemplo');
    for (const [valor, texto] of [['', 'Poné el pago por hora.'], ['0', 'tiene que ser más que $0'], ['0.4', 'tiene que ser más que $0'], ['-5', 'tiene que ser más que $0'], ['100000', 'menor que $100.000']]) {
      await page.fill('#pnf-pago', valor);
      await guardar(page);
      await expect(warn).toContainText(texto);
    }
    await page.fill('#pnf-pago', '300');
    await page.evaluate(() => { document.getElementById('pnf-nota').value = 'x'.repeat(201); });
    await guardar(page);
    await expect(warn).toContainText('hasta 200');
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toEqual([]);
    await expect(modal(page)).toBeVisible();
    // Sin centavos, con la regla de los pagos: 280,6 → 281.
    await page.fill('#pnf-nota', '');
    await page.fill('#pnf-pago', '280.6');
    await guardar(page);
    await expect(modal(page)).toHaveCount(0);
    expect(escrituras(e, 'precios_ninera_familia', 'POST')[0].cuerpo).toMatchObject({ pago_hora: 281, nota: null });
    verificarLimpio(e);
  });

  test('el nombre escrito entero (sin tildes ni mayúsculas) vale como elegido', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon() });
    await abrirFicha(page);
    await agregar(page);
    await page.fill('#pnf-ninera', 'carla ejemplo');
    await expect(page.locator('#pnf-pago')).toHaveValue('286');
    await guardar(page);
    await expect(modal(page)).toHaveCount(0);
    expect(escrituras(e, 'precios_ninera_familia', 'POST')[0].cuerpo).toMatchObject({ ninera_id: ID.nCarla });
    verificarLimpio(e);
  });
});

/* ---------------- Editar y borrar ---------------- */
test.describe('ficha de la familia: editar y borrar', () => {
  test('tocar la fila abre el modal con su valor y nota; se guarda con la condición de actualizado_en', async ({ page }) => {
    const fila = precio(ID.fUno, ID.nCarla, 300, { nota: '3 chicos' });
    const e = await abrirApp(page, { datos: datosCon({ precios: [fila] }) });
    await abrirFicha(page);
    await filas(page).first().click();
    await expect(modal(page)).toContainText('Carla Ejemplo');
    await expect(page.locator('#pnf-pago')).toHaveValue('300');
    await expect(page.locator('#pnf-nota')).toHaveValue('3 chicos');
    await page.fill('#pnf-pago', '350');
    await page.fill('#pnf-nota', '4 chicos');
    await guardar(page);
    await expect(modal(page)).toHaveCount(0);
    const [cambio] = escrituras(e, 'precios_ninera_familia', 'PATCH');
    expect(cambio.cuerpo).toEqual({ pago_hora: 350, nota: '4 chicos' });
    expect(cambio.params).toMatchObject({ id: `eq.${fila.id}`, actualizado_en: `eq.${fila.actualizado_en}`, select: 'id' });
    await expect(filas(page)).toContainText('$350/h');
    await expect(filas(page)).toContainText('4 chicos');
    verificarLimpio(e);
  });

  test('otra admin lo cambió mientras estaba abierto: aviso, se repinta y no se pisa', async ({ page }) => {
    const fila = precio(ID.fUno, ID.nCarla, 300);
    const e = await abrirApp(page, { datos: datosCon({ precios: [fila] }) });
    await abrirFicha(page);
    await filas(page).first().click();
    await page.fill('#pnf-pago', '350');
    Object.assign(e.db.precios_ninera_familia[0], { pago_hora: 310, actualizado_en: '2026-10-04T14:00:00Z' });
    await guardar(page);
    await expect(toastMalo(page, 'Otra admin cambió este precio. Volvé a abrirlo.')).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    expect(e.db.precios_ninera_familia[0].pago_hora).toBe(310);
    await expect(filas(page)).toContainText('$310/h');
    await expect(page.locator('.toaststack .toast.good')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('borrar pide confirmación ("Borrar el precio"); cancelar no borra', async ({ page }) => {
    const fila = precio(ID.fUno, ID.nCarla, 300);
    const e = await abrirApp(page, { datos: datosCon({ precios: [fila] }) });
    await abrirFicha(page);
    await filas(page).first().click();
    await page.locator('#pnf-borrar').click();
    await expect(page.locator('#confirm-si')).toHaveText('Borrar el precio');
    await page.locator('#confirm-no').click();
    await page.waitForTimeout(250);
    expect(escrituras(e, 'precios_ninera_familia', 'DELETE')).toEqual([]);
    await expect(modal(page)).toBeVisible();
    await page.locator('#pnf-borrar').click();
    await page.locator('#confirm-si').click();
    await expect(modal(page)).toHaveCount(0);
    const [baja] = escrituras(e, 'precios_ninera_familia', 'DELETE');
    expect(baja.params).toMatchObject({ id: `eq.${fila.id}`, actualizado_en: `eq.${fila.actualizado_en}` });
    expect(e.db.precios_ninera_familia).toEqual([]);
    await expect(filas(page)).toHaveCount(0);
    verificarLimpio(e);
  });

  test('borrar uno que otra admin cambió: aviso y no se borra', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nCarla, 300)] }) });
    await abrirFicha(page);
    await filas(page).first().click();
    e.db.precios_ninera_familia[0].actualizado_en = '2026-10-04T14:00:00Z';
    await page.locator('#pnf-borrar').click();
    await page.locator('#confirm-si').click();
    await expect(toastMalo(page, 'Otra admin cambió este precio. Volvé a abrirlo.')).toBeVisible();
    expect(e.db.precios_ninera_familia).toHaveLength(1);
    verificarLimpio(e);
  });
});

/* ---------------- Días previstos de un fijo ---------------- */
test.describe('ficha de la familia: los días previstos del fijo', () => {
  test('agregar, editar y borrar el precio de una niñera con fijo vigente recalcula los previstos', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ fijosAutomaticos: true }) });
    await abrirFicha(page);
    await agregar(page);
    await elegirNinera(page, 'ana', 'Ana Ficticia');
    await page.fill('#pnf-pago', '270');
    await guardar(page);
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => llamadasProceso(e).length).toBe(1);
    await filas(page).first().click();
    await page.fill('#pnf-pago', '280');
    await guardar(page);
    await expect.poll(() => llamadasProceso(e).length).toBe(2);
    await filas(page).first().click();
    await page.locator('#pnf-borrar').click();
    await page.locator('#confirm-si').click();
    await expect.poll(() => llamadasProceso(e).length).toBe(3);
    verificarLimpio(e);
  });

  test('sin fijo con esa familia no recalcula nada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ fijosAutomaticos: true }) });
    await abrirFicha(page);
    await agregar(page);
    await elegirNinera(page, 'carla', 'Carla Ejemplo');
    await guardar(page);
    await expect(modal(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(llamadasProceso(e)).toEqual([]);
    verificarLimpio(e);
  });

  test('si no se puede ver si tiene un fijo: guardado, y el aviso dice que se actualizan esta noche', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ fijosAutomaticos: true }) });
    await abrirFicha(page);
    await page.route(/asignaciones/, r => r.request().method() === 'GET' && decodeURIComponent(r.request().url()).includes('select=id,vigente_hasta')
      ? r.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }) : r.fallback());
    await agregar(page);
    await elegirNinera(page, 'ana', 'Ana Ficticia');
    await guardar(page);
    await expect(modal(page)).toHaveCount(0);
    await expect(toastMalo(page, 'se actualizan esta noche')).toBeVisible();
    await expect(page.locator('.toaststack .toast')).toHaveCount(1); // un solo aviso, el rojo (sin "Precio guardado." aparte)
    expect(escrituras(e, 'precios_ninera_familia', 'POST')).toHaveLength(1);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('"Cancelar" mientras se guarda: si el precio se guardó, los previstos se recalculan igual', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ fijosAutomaticos: true }) });
    await abrirFicha(page);
    await agregar(page);
    await elegirNinera(page, 'ana', 'Ana Ficticia');
    await page.fill('#pnf-pago', '270');
    e.demoraEscrituras = 600;
    await guardar(page);
    await page.locator('#pnf-cancelar').click();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => escrituras(e, 'precios_ninera_familia', 'POST').length).toBe(1);
    await expect.poll(() => llamadasProceso(e).length).toBe(1);
    await expect(page.locator('.toaststack .toast', { hasText: 'Precio guardado.' })).toBeVisible();
    verificarLimpio(e);
  });

  test('"Cancelar" mientras se borra: si se borró, los previstos se recalculan igual', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ fijosAutomaticos: true, precios: [precio(ID.fUno, ID.nAna, 280)] }) });
    await abrirFicha(page);
    await filas(page).first().click();
    await page.locator('#pnf-borrar').click();
    e.demoraEscrituras = 600;
    await page.locator('#confirm-si').click();
    await page.locator('#pnf-cancelar').click();
    await expect.poll(() => escrituras(e, 'precios_ninera_familia', 'DELETE').length).toBe(1);
    await expect.poll(() => llamadasProceso(e).length).toBe(1);
    verificarLimpio(e);
  });
});

/* ---------------- Escape y Realtime ---------------- */
const RARO = `"><img src=x onerror="window.__pwned=1">'); window.__pwned=1; //`;
test('nombres y notas tramposos se ven como texto y nada se ejecuta', async ({ page }) => {
  const d = datosCon({ precios: [] });
  const idRara = '30000000-0000-4000-8000-000000000099';
  d.ninieras.push({ ...d.ninieras.find(n => n.id === ID.nAna), id: idRara, nombre: 'Rara ' + RARO, user_id: null });
  d.precios_ninera_familia.push(precio(ID.fUno, idRara, 300, { nota: RARO }));
  d.familias.find(f => f.id === ID.fDos).nombre = 'Familia ' + RARO;
  d.precios_ninera_familia.push(precio(ID.fDos, idRara, 290, { nota: RARO }));
  const e = await abrirApp(page, { datos: d });
  await abrirFicha(page);
  await expect(filas(page)).toContainText('Rara ' + RARO);
  await expect(filas(page)).toContainText(RARO);
  await filas(page).first().click();
  await expect(modal(page)).toContainText('Rara ' + RARO);
  await expect(page.locator('#pnf-nota')).toHaveValue(RARO);
  await guardar(page);
  await expect(modal(page)).toHaveCount(0);
  expect(escrituras(e, 'precios_ninera_familia', 'PATCH')[0].cuerpo).toEqual({ pago_hora: 300, nota: RARO });
  await page.evaluate(() => cerrarModal());
  await irAModulo(page, 'ninieras');
  await page.evaluate(id => verNinera(id), idRara);
  await expect(page.locator('#vn-precios-fam .precio-fam-fila')).toHaveCount(2);
  await expect(page.locator('#vn-precios-fam')).toContainText('Familia ' + RARO);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  verificarLimpio(e);
});

const canalesPrecios = page => page.evaluate(() => sb.getChannels().filter(c => /^realtime:precios-ficha-/.test(c.topic) && c.state === 'joined').length);
test('Realtime: si otra admin cambia un precio con la ficha abierta, la sección se repinta sin tocar el modal abierto', async ({ page }) => {
  const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nCarla, 300)] }) });
  await abrirFicha(page);
  await expect.poll(() => canalesPrecios(page)).toBe(1);
  const nueva = precio(ID.fUno, ID.nAna, 270, { nota: 'cargado desde otro celular' });
  e.db.precios_ninera_familia.push(nueva);
  e.emitirRealtime('precios_ninera_familia', 'INSERT', nueva);
  await expect(filas(page)).toHaveCount(2);
  await expect(seccion(page)).toContainText('cargado desde otro celular');
  // Con el modal abierto y algo escrito: la lista se pone al día y el modal queda como estaba.
  await filas(page).filter({ hasText: 'Carla Ejemplo' }).click();
  await page.fill('#pnf-pago', '333');
  e.db.precios_ninera_familia = e.db.precios_ninera_familia.filter(p => p.id !== nueva.id);
  e.emitirRealtime('precios_ninera_familia', 'DELETE', { id: nueva.id });
  await expect(filas(page)).toHaveCount(1);
  await expect(page.locator('#pnf-pago')).toHaveValue('333');
  // Al cerrar la ficha se suelta el canal.
  await page.locator('#pnf-cancelar').click();
  await page.evaluate(() => cerrarModal());
  await expect.poll(() => canalesPrecios(page)).toBe(0);
  verificarLimpio(e);
});

/* ---------------- Ficha de la niñera ---------------- */
test.describe('ficha de la niñera: "Precio por familia", solo para mirar', () => {
  const abrirFichaNinera = async (page, id) => {
    await irAModulo(page, 'ninieras');
    await page.evaluate(i => verNinera(i), id);
  };
  const lista = page => page.locator('#vn-precios-fam');

  test('la lista con familia, $/h, nota y fecha, de una sola lectura por niñera y sin botones', async ({ page }) => {
    const urls = espiarLecturas(page, 'precios_ninera_familia');
    const e = await abrirApp(page, { datos: datosCon({ precios: [
      precio(ID.fUno, ID.nCarla, 300, { nota: '3 chicos', actualizado_en: '2026-10-03T01:30:00Z' }),
      precio(ID.fDos, ID.nCarla, 320),
      precio(ID.fUno, ID.nAna, 270),
    ] }) });
    await abrirFichaNinera(page, ID.nCarla);
    await expect(lista(page).locator('.card-section-title')).toHaveText('Precio por familia');
    const filasN = lista(page).locator('.precio-fam-fila');
    await expect(filasN).toHaveCount(2);
    await expect(filasN.nth(0)).toContainText('Familia Prueba Dos');
    await expect(filasN.nth(0)).toContainText('$320/h');
    await expect(filasN.nth(1)).toContainText('Familia Prueba Uno');
    await expect(filasN.nth(1)).toContainText('$300/h');
    await expect(filasN.nth(1)).toContainText('3 chicos');
    await expect(filasN.nth(1)).toContainText('cambiado el 02/10');
    await expect(lista(page).locator('button')).toHaveCount(0);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`ninera_id=eq.${ID.nCarla}`);
    expect(urls[0]).toContain('familias(nombre)');
    verificarLimpio(e);
  });

  test('sin precios: "Sin precios especiales: cobra la tarifa de cada familia."', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon() });
    await abrirFichaNinera(page, ID.nAna);
    await expect(lista(page)).toContainText('Sin precios especiales: cobra la tarifa de cada familia.');
    verificarLimpio(e);
  });

  test('si falla la lectura: aviso y "Reintentar"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nCarla, 300)] }) });
    await lecturaPreciosQueFalla(page);
    await abrirFichaNinera(page, ID.nCarla);
    await expect(lista(page)).toContainText('No se pudieron leer los precios por familia.');
    await expect(lista(page)).not.toContainText('Sin precios especiales');
    await page.unroute(/precios_ninera_familia/);
    await lista(page).locator('button', { hasText: 'Reintentar' }).click();
    await expect(lista(page).locator('.precio-fam-fila')).toContainText('$300/h');
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('base sin la tabla: no aparece', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosCon() });
    await lecturaPreciosQueFalla(page, true);
    await abrirFichaNinera(page, ID.nCarla);
    await expect(page.locator('#vn-historial .spinner')).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(lista(page)).toBeEmpty();
    verificarLimpio(e, { ignorar: [/status of 404/] });
  });
});

/* ---------------- Celular y compu ---------------- */
for (const [ancho, alto] of [[390, 844], [1280, 900]]) {
  test(`a ${ancho} px: sin scroll de costado en las fichas y el modal (capturas)`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const largo = 'Hermanos mellizos y la más chica, fuera de Montevideo los fines de semana largos';
    const e = await abrirApp(page, { datos: datosCon({ precios: [precio(ID.fUno, ID.nCarla, 300, { nota: largo }), precio(ID.fUno, ID.nAna, 12500)] }) });
    await abrirFicha(page);
    await expect(filas(page)).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ancho);
    await seccion(page).scrollIntoViewIfNeeded();
    await seccion(page).screenshot({ path: `test-results/precio-ninera-${ancho}-ficha-familia.png` });
    await agregar(page);
    await elegirNinera(page, 'carla', 'Carla Ejemplo');
    for (const id of ['#pnf-ninera', '#pnf-pago', '#pnf-nota', '#pnf-guardar']) {
      const caja = await page.locator(id).boundingBox();
      expect(caja.x).toBeGreaterThanOrEqual(0);
      expect(caja.x + caja.width).toBeLessThanOrEqual(ancho);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ancho);
    await page.locator('#precio-nin-overlay .confirmbox').screenshot({ path: `test-results/precio-ninera-${ancho}-modal.png` });
    await page.locator('#pnf-cancelar').click();
    await page.evaluate(() => cerrarModal());
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => verNinera(id), ID.nCarla);
    await expect(page.locator('#vn-precios-fam .precio-fam-fila')).toHaveCount(1);
    await page.locator('#vn-precios-fam').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ancho);
    await page.locator('#vn-precios-fam').screenshot({ path: `test-results/precio-ninera-${ancho}-ficha-ninera.png` });
    verificarLimpio(e);
  });
}
