// Pedidos de traslado por la app en el panel (fase 1, etapa 11, 03/11/2026, decisiones 6.9). Que cargar un traslado sea tan
// rápido como un sitting: "+ Nueva solicitud" de traslado trae origen y destino precargados con lo último de la familia (la
// casa y el colegio), "Invertir" (ida / vuelta) y los km del viaje anterior con el precio por km; "Elegir niñeras" manda el
// traslado por la app solo a las que tienen el carsitting aprobado, con "Precio: $X por viaje" (sugerido con la tarifa de
// km y editable), y el recorrido se puede completar ahí mismo; "Asignar" lleva la ruta al registro.
// Datos inventados: hoy es domingo 04/10/2026; Familia Prueba Dos (Carrasco, sin dirección) tuvo un traslado de Casa a
// Colegio de 12 km; Familia Prueba Uno (Pocitos, Calle Falsa 123, dos chicos) no tiene traslados. La tarifa de traslados es
// $200 + $20/km con 15 % de margen: 12 km son $450 a la familia y $350 a la niñera. Carla hace las dos cosas y tiene la app;
// Gaby, solo traslados, con la app y sin el carsitting aprobado; Bruno, solo traslados, sin la app.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosPedidos, ID } = require('./support/datos');

const SOL_TRASLADO = '88000000-0000-4000-8000-000000000001';
const SOL_VIEJO = '88000000-0000-4000-8000-000000000002';
const GABY = '30000000-0000-4000-8000-000000000011';
const RUIDO_4XX = /status of 4\d\d/;
const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && (!metodo || w.metodo === metodo));
const modal = page => page.locator('#editmodal');
const tilde = (page, id) => page.locator(`#editmodal .pedido-tilde[data-id="${id}"]`);
const fila = (page, id) => page.locator(`#editmodal .pedido-fila[data-id="${id}"]`);

function soloPracticaApagado(e) {
  e.db.app_config.find(c => c.id === 'pedidos_app').valor.solo_practica = false;
}
function datos({ conRuta = true } = {}) {
  const d = datosPedidos();
  const carla = d.ninieras.find(n => n.id === ID.nCarla);
  d.ninieras.push({ ...carla, id: GABY, nombre: 'Gaby Traslados', telefono: '098000011', zona: 'Pocitos', tipo: 'Traslados',
    user_id: '00000000-0000-4000-8000-000000000011', temporada_token: '60000000-0000-4000-8000-000000000011', foto_propuesta_ruta: null, foto_propuesta_en: null });
  d.carsitting_datos = [
    { id: '97000000-0000-4000-8000-000000000001', ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', nombre_completo: 'Carla Ejemplo',
      enviado_en: '2026-10-01T12:00:00Z', revision: 'aprobado', aprobado_en: '2026-10-02T12:00:00Z' },
    { id: '97000000-0000-4000-8000-000000000002', ninera_id: GABY, ninera_nombre: 'Gaby Traslados', nombre_completo: 'Gaby Traslados',
      enviado_en: '2026-10-03T12:00:00Z', revision: 'pendiente', aprobado_en: null },
  ];
  const base = { familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', tipo: 'traslado', fecha: '2026-10-06', hora_inicio: '08:00:00', hora_fin: null,
    cobro_familia: 450, estado: 'sin_asignar', notas: null, created_at: '2026-10-01T00:00:00Z', termina_dia_siguiente: false, horario_aproximado: false };
  d.solicitudes.push(
    { ...base, id: SOL_TRASLADO, zona: 'Pocitos', ...(conRuta ? { origen: 'Calle Falsa 123', destino: 'Colegio Inventado', destino_zona: 'Carrasco', km: 12 } : {}) },
    // Un traslado de antes de la etapa 11: sin ruta.
    { ...base, id: SOL_VIEJO, zona: 'Pocitos', fecha: '2026-10-07', origen: null, destino: null, destino_zona: null, km: null },
  );
  return d;
}
async function nuevaTraslado(page, familia) {
  await irAModulo(page, 'agenda');
  await page.locator('button', { hasText: '+ Nueva solicitud' }).click();
  await page.selectOption('#agenda-tipo', 'traslado');
  await page.fill('#agenda-familia', familia);
  await page.locator('#agenda-familia').dispatchEvent('input');
  await page.fill('#agenda-nueva-fecha', '2026-10-06');
  await page.selectOption('#agenda-hora-inicio-hh', '08');
  await page.selectOption('#agenda-hora-inicio-mm', '00');
}
async function abrirElegir(page, id) {
  await irAModulo(page, 'agenda');
  await page.evaluate(i => abrirModalAsignar(i), id);
  await expect(page.locator('#editmodal .pedido-elegir')).toBeVisible();
  await esperarQuieta(page);
}
const zonasMarcadas = (page, prefijo) => page.locator(`#${prefijo}-zonas-checklist input:checked`).evaluateAll(l => l.map(i => i.value));

test.describe('"+ Nueva solicitud" de traslado: la ruta precargada', () => {
  test('con el último traslado de la familia: origen, destino, km y el precio por km; "Invertir" da vuelta lugares y zonas', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await nuevaTraslado(page, 'Familia Prueba Dos');
    await expect(page.locator('#agenda-origen')).toHaveValue('Casa');
    await expect(page.locator('#agenda-destino')).toHaveValue('Colegio');
    await expect(page.locator('#agenda-km')).toHaveValue('12');
    await expect(page.locator('#agenda-ruta-nota')).toContainText('Con el último traslado de la familia (19/09)');
    await expect(page.locator('#agenda-cobro-traslado')).toHaveValue('450');
    await expect(page.locator('#agenda-pago-traslado')).toHaveValue('350');
    await expect(page.locator('#agenda-zonas-field label').first()).toContainText('Zona de origen');
    await page.locator('#agenda-destino-zonas-checklist input[value="Pocitos"]').check();
    expect(await zonasMarcadas(page, 'agenda')).toEqual(['Carrasco']);
    await page.locator('#editmodal button', { hasText: 'Invertir (ida / vuelta)' }).click();
    await expect(page.locator('#agenda-origen')).toHaveValue('Colegio');
    await expect(page.locator('#agenda-destino')).toHaveValue('Casa');
    expect(await zonasMarcadas(page, 'agenda')).toEqual(['Pocitos']);
    expect(await zonasMarcadas(page, 'agenda-destino')).toEqual(['Carrasco']);
    await expect(page.locator('#agenda-km')).toHaveValue('12');
    await page.locator('#editmodal button', { hasText: 'Guardar solicitud' }).click();
    await expect(modal(page).locator('h2')).toHaveCount(0);
    expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ tipo: 'traslado', familia_id: ID.fDos, hora_inicio: '08:00',
      origen: 'Colegio', destino: 'Casa', zona: 'Pocitos', destino_zona: 'Carrasco', km: 12, cobro_familia: 450, estado: 'sin_asignar' });
    verificarLimpio(e);
  });

  test('sin traslados anteriores: la casa como origen con su zona; el destino se escribe y los km se cargan a mano', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    // Sin pedidos de traslado de la Uno en la base para precargar.
    e.db.solicitudes = e.db.solicitudes.filter(s => s.tipo !== 'traslado');
    await nuevaTraslado(page, 'Familia Prueba Uno');
    await expect(page.locator('#agenda-origen')).toHaveValue('Calle Falsa 123');
    await expect(page.locator('#agenda-destino')).toHaveValue('');
    await expect(page.locator('#agenda-ruta-nota')).toHaveText('Origen: la casa de la familia. Falta el destino.');
    expect(await zonasMarcadas(page, 'agenda')).toEqual(['Pocitos']);
    await page.fill('#agenda-destino', 'Club Inventado');
    await page.fill('#agenda-km', '5');
    await expect(page.locator('#agenda-cobro-traslado')).toHaveValue('300'); // 200 + 5 × 20
    await expect(page.locator('#agenda-pago-traslado')).toHaveValue('250');
    // El autocompletar ofrece los lugares de la familia (la casa).
    await page.fill('#agenda-destino', 'calle');
    await expect(page.locator('#agenda-destino-dropdown .autocomplete-item')).toHaveText(['Calle Falsa 123']);
    verificarLimpio(e);
  });

  test('otra familia: lo precargado se va y se precarga lo de la nueva; lo escrito a mano queda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    e.db.solicitudes = e.db.solicitudes.filter(s => s.tipo !== 'traslado');
    await nuevaTraslado(page, 'Familia Prueba Dos');
    await expect(page.locator('#agenda-origen')).toHaveValue('Casa');
    await page.fill('#agenda-destino', 'Escrito a mano');
    await page.fill('#agenda-familia', 'Familia Prueba Uno');
    await page.locator('#agenda-familia').dispatchEvent('input');
    await expect(page.locator('#agenda-origen')).toHaveValue('Calle Falsa 123');
    await expect(page.locator('#agenda-destino')).toHaveValue('Escrito a mano');
    await expect(page.locator('#agenda-km')).toHaveValue('');
    verificarLimpio(e);
  });

  test('base sin migrar (etapa 11): la solicitud se guarda sin la ruta y se avisa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos(), baseSinMigrar: 'etapa11' });
    await nuevaTraslado(page, 'Familia Prueba Dos');
    await expect(page.locator('#agenda-origen')).toHaveValue('Casa'); // del registro, que siempre tuvo origen
    await page.locator('#editmodal button', { hasText: 'Guardar solicitud' }).click();
    await expect(page.locator('.toast', { hasText: 'Falta actualizar la base: la solicitud se guardó sin el origen, el destino ni los km.' })).toBeVisible();
    // El primer intento (con la ruta) lo rechaza la base; queda el segundo, sin ella.
    const posts = escrituras(e, 'solicitudes', 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].cuerpo).not.toHaveProperty('origen');
    expect(e.rechazadas).toBeGreaterThanOrEqual(1);
    expect(e.db.solicitudes.some(s => s.familia_id === ID.fDos && s.tipo === 'traslado' && s.fecha === '2026-10-06')).toBe(true);
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('a 390 px: la ruta entra sin scroll de costado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: datos() });
    await nuevaTraslado(page, 'Familia Prueba Dos');
    await expect(page.locator('#agenda-origen')).toHaveValue('Casa');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const invertir = await page.locator('#editmodal .ruta-invertir').boundingBox();
    expect(invertir.height).toBeGreaterThanOrEqual(40);
    verificarLimpio(e);
  });
});

test.describe('"Elegir niñeras" de un traslado', () => {
  test('solo con el carsitting aprobado; precio por viaje con la tarifa de km; "Enviar" manda precio_viaje', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_TRASLADO);
    await expect(modal(page).locator('.ruta-elegir summary')).toHaveText('De Calle Falsa 123 a Colegio Inventado');
    await expect(tilde(page, ID.nCarla)).toHaveCount(1);
    await expect(tilde(page, GABY)).toHaveCount(0);
    await expect(fila(page, GABY)).toContainText('Sin carsitting aprobado');
    await expect(tilde(page, ID.nAna)).toHaveCount(0); // no hace traslados: "No se les puede mandar"
    await tilde(page, ID.nCarla).check();
    await expect(page.locator('#pedido-precios')).toContainText('Precio por viaje para cada una');
    await expect(page.locator(`#pedido-precio-${ID.nCarla}`)).toHaveValue('350');
    await expect(page.locator('#pedido-precios input[type=checkbox]')).toHaveCount(0); // sin "Guardar como precio"
    await page.fill(`#pedido-precio-${ID.nCarla}`, '380');
    await page.locator('#pedido-enviar').click();
    await expect(modal(page).locator('.pedido-elegir')).toHaveCount(0);
    expect(escrituras(e, 'rpc/enviar_pedido_app')[0].cuerpo).toEqual({ p_solicitud_id: SOL_TRASLADO, p_envios: [{ ninera_id: ID.nCarla, precio_viaje: 380 }] });
    expect(escrituras(e, 'solicitudes', 'PATCH')).toHaveLength(0); // el recorrido no cambió
    const aviso = e.db.avisos.find(a => a.para_ninera_id === ID.nCarla && a.clave.endsWith(':nuevo'));
    expect(aviso.titulo).toBe('Traslado 06/10');
    expect(aviso.cuerpo).toBe('A las 08:00\nDe Pocitos a Carrasco\n2 chicos (3 y 5 años)\nPrecio: $380 por viaje');
    verificarLimpio(e);
  });

  test('un traslado sin recorrido (de antes): el plegable abierto, pide las zonas, lo guarda en la solicitud y después manda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_VIEJO);
    const ruta = modal(page).locator('.ruta-elegir');
    await expect(ruta).toHaveAttribute('open', '');
    // Sin el recorrido de la familia en la base (el otro pedido sí lo tiene): precarga ese viaje.
    await expect(page.locator('#elegir-origen')).toHaveValue('Calle Falsa 123');
    await expect(page.locator('#elegir-destino')).toHaveValue('Colegio Inventado');
    await page.fill('#elegir-destino', 'Club Inventado');
    await page.fill('#elegir-km', '');
    await page.locator('#elegir-destino-zonas-checklist input:checked').uncheck();
    await tilde(page, ID.nCarla).check();
    await page.fill(`#pedido-precio-${ID.nCarla}`, '300');
    await page.locator('#pedido-enviar').click();
    await expect(page.locator('#pedido-enviar-warn')).toContainText('Marcá la zona de origen y la de destino del recorrido');
    expect(escrituras(e, 'rpc/enviar_pedido_app')).toHaveLength(0);
    await page.locator('#elegir-destino-zonas-checklist input[value="Pocitos"]').check();
    await page.locator('#pedido-enviar').click();
    await expect(modal(page).locator('.pedido-elegir')).toHaveCount(0);
    const patch = escrituras(e, 'solicitudes', 'PATCH')[0];
    expect(patch.cuerpo).toEqual({ origen: 'Calle Falsa 123', destino: 'Club Inventado', destino_zona: 'Pocitos' });
    // Primero el recorrido, después el envío.
    expect(e.escrituras.indexOf(patch)).toBeLessThan(e.escrituras.indexOf(escrituras(e, 'rpc/enviar_pedido_app')[0]));
    verificarLimpio(e);
  });

  test('errores de la base: sin el carsitting (otra admin lo cambió) y la base sin migrar', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_TRASLADO);
    await tilde(page, ID.nCarla).check();
    e.db.carsitting_datos.find(c => c.ninera_id === ID.nCarla).aprobado_en = null; // mientras elegía
    await page.locator('#pedido-enviar').click();
    await expect(page.locator('#pedido-enviar-warn')).toHaveText('Carla Ejemplo no tiene el carsitting aprobado: destildala.');
    expect(e.db.solicitud_ninieras.filter(x => x.solicitud_id === SOL_TRASLADO)).toHaveLength(0);
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('base sin migrar (etapa 11): sin casillas y el aviso; "Asignar" sigue', async ({ page }) => {
    const d = datos();
    d.solicitudes.forEach(s => { if (s.tipo === 'traslado') ['origen', 'destino', 'destino_zona', 'km'].forEach(c => { delete s[c]; }); });
    const e = await abrirApp(page, { datos: d, baseSinMigrar: 'etapa11' });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_TRASLADO);
    await expect(modal(page)).toContainText('Falta actualizar la base para mandar traslados por la app');
    await expect(page.locator('#editmodal .pedido-tilde')).toHaveCount(0);
    await expect(fila(page, ID.nCarla).locator('input[name="agenda-asignar-ninera"]')).toHaveCount(1);
    verificarLimpio(e, { ignorar: [RUIDO_4XX] }); // los pedidos anteriores sin la columna origen (42703)
  });

  test('"Asignar" un traslado: el registro con origen, destino y km; la fila con el precio por viaje', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    soloPracticaApagado(e);
    await abrirElegir(page, SOL_TRASLADO);
    await fila(page, ID.nCarla).locator('input[name="agenda-asignar-ninera"]').check();
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('350');
    await page.locator('#editmodal button', { hasText: 'Guardar asignación' }).click();
    await expect(modal(page).locator('h2')).toHaveText('Confirmación para la madre');
    expect(escrituras(e, 'solicitud_ninieras', 'POST')[0].cuerpo).toMatchObject({ solicitud_id: SOL_TRASLADO, ninera_id: ID.nCarla, estado: 'confirmada',
      pago_ninera: 350, precio_viaje: 350 });
    expect(escrituras(e, 'sittings_traslados', 'POST')[0].cuerpo).toMatchObject({ tipo: 'traslado', ninera_id: ID.nCarla, solicitud_id: SOL_TRASLADO,
      origen: 'Calle Falsa 123', destino: 'Colegio Inventado', km: 12, cobro_familia: 450, pago_ninera: 350 });
    // A Carla (con app) le llega "¡Quedaste seleccionada!" y no "Tienes un traslado".
    expect(e.db.avisos.filter(a => a.para_ninera_id === ID.nCarla).map(a => a.titulo)).toEqual(['¡Quedaste seleccionada!']);
    verificarLimpio(e);
  });

  test('escape: un origen con HTML se ve tal cual en el recorrido y no se ejecuta', async ({ page }) => {
    const d = datos();
    d.solicitudes.find(s => s.id === SOL_TRASLADO).origen = '<img src=x onerror="window.__xss=1">';
    const e = await abrirApp(page, { datos: d });
    await abrirElegir(page, SOL_TRASLADO);
    await expect(modal(page).locator('.ruta-elegir summary')).toContainText('<img src=x onerror="window.__xss=1">');
    await expect(page.locator('#elegir-origen')).toHaveValue('<img src=x onerror="window.__xss=1">');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });
});
