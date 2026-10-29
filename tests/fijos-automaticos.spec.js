// Fijos automáticos (06/10/2026). La base carga sola los días de cada fijo como "previstos"
// (próximos 14 días) y el día que llegan pasan a "confirmado". Eso lo hace la función
// generar_previstos_fijos, que se prueba aparte en Postgres (supabase/pruebas/). Acá se
// prueba la app con esas filas ya cargadas: previstos solo en la Agenda, cambios de un día
// sobre el previsto, cambios del fijo que piden recalcular, la revisión en Hoy y Finanzas.
// Hoy en los tests = domingo 04/10/2026. Fijo de Ana en Familia Prueba Uno: lunes y
// miércoles de 16 a 19 (3 h a $380 / $250 = $1.140 de cobro y $750 de pago).
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

const auto = (id, fecha, extra = {}) => sitting(id, fecha, {
  asignacion_id: ID.aFijo, estado: 'previsto', generado_automatico: true, revisado_at: null,
  registrado_por: 'Automático', notas: 'Sitting fijo — cargado automáticamente', ...extra,
});
const P = { lun5: 'a1000000-0000-4000-8000-000000000005', mie7: 'a1000000-0000-4000-8000-000000000007', lun12: 'a1000000-0000-4000-8000-000000000012', mie14: 'a1000000-0000-4000-8000-000000000014', mie30: 'a1000000-0000-4000-8000-000000000030' };

function datosActivos() {
  const d = datosBase();
  d.app_config = [{ id: 'fijos_automaticos', valor: { activo: true, dias: 14 }, actualizado_at: '2026-10-04T06:00:00Z' }];
  // Los que ya traen estado (el previsto de mañana de Ana, datos.js, etapa 2) lo conservan.
  d.sittings_traslados = d.sittings_traslados.map(s => ({ ...s, estado: s.estado || 'confirmado', generado_automatico: false, revisado_at: null }));
  d.sittings_traslados.push(
    auto(P.mie30, '2026-09-30', { estado: 'confirmado' }), // ya pasó: confirmado solo, sin revisar
    auto(P.lun5, '2026-10-05'), auto(P.mie7, '2026-10-07'), auto(P.lun12, '2026-10-12'), auto(P.mie14, '2026-10-14'),
  );
  d.asignaciones_pausas = [];
  return d;
}
async function verAgendaDesde(page, fechaISO) {
  await page.evaluate(async f => { agendaAncla = f; await cargarAgendaSolicitudes(); }, fechaISO);
  await esperarQuieta(page);
}
const llamadasProceso = e => e.escrituras.filter(w => w.tabla === 'rpc/generar_previstos_fijos');
const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && w.metodo === metodo);
async function abrirDia(page, fecha) {
  await page.evaluate(([id, f]) => abrirModalSolicitud(`asig:${id}@${f}`), [ID.aFijo, fecha]);
  await expect(page.locator('#editmodal')).toBeVisible();
}

test.describe('apagado (antes de correr _ACTIVAR): todo como antes', () => {
  test('sin la marca no se llama al proceso ni se filtra nada', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-10-05');
    await abrirDia(page, '2026-10-05');
    await page.locator('#editmodal button', { hasText: 'Registrar sitting de este día' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'sittings_traslados', 'POST')).toHaveLength(1);
    expect(llamadasProceso(e)).toEqual([]);
    expect(e.escrituras.some(w => w.tabla === 'asignaciones_pausas')).toBe(false);
    await expect(page.locator('#editmodal')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('con la base sin migrar la app arranca y la Agenda anda igual', async ({ page }) => {
    const e = await abrirApp(page, { baseSinMigrar: true });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-10-05');
    expect(await page.evaluate(() => agendaSolicitudes.filter(s => s._fuente === 'asignacion').map(s => s.fecha))).toEqual(['2026-10-05', '2026-10-07']);
    expect(llamadasProceso(e)).toEqual([]);
    verificarLimpio(e, { ignorar: [/status of 400/] }); // familias sin terminos_aceptados_el: se reintenta sin la columna
  });
});

test.describe('previstos solo en la Agenda', () => {
  test('la Agenda muestra el día del fijo como previsto, una sola tarjeta por día', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-10-05');
    const items = await page.evaluate(() => agendaSolicitudes.filter(s => s.familia_nombre === 'Familia Prueba Uno').map(s => `${s.fecha} ${s._fuente} ${s._previsto ? 'previsto' : ''}`.trim()));
    expect(items).toEqual(['2026-10-05 asignacion previsto', '2026-10-07 asignacion previsto']);
    // Las del fijo (Prueba Uno): el previsto de mañana de Ana en otra familia (datos.js, etapa 2) es otra tarjeta.
    await expect(page.locator('[onclick^="abrirModalSolicitud"]', { hasText: 'Familia Prueba Uno' }).locator('.agenda-previsto')).toHaveCount(2);
    await abrirDia(page, '2026-10-05');
    await expect(page.locator('#editmodal')).toContainText('ya está previsto con Ana Ficticia');
    await expect(page.locator('#editmodal')).toContainText('se confirma solo ese día');
    verificarLimpio(e);
  });

  test('Sittings y traslados muestra solo lo que ya pasó', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await irAModulo(page, 'sittings');
    await page.evaluate(async () => { sitMes = '2026-10'; await cargarSitLista(); });
    await esperarQuieta(page);
    // Solo el de hoy de Ana (datos.js, etapa 2): hoy ya cuenta; los previstos de adelante, no.
    expect(await page.evaluate(() => sitItems.map(s => s.fecha))).toEqual(['2026-10-04']);
    await page.evaluate(async () => { sitMes = '2026-09'; await cargarSitLista(); });
    await esperarQuieta(page);
    expect((await page.evaluate(() => sitItems.map(s => s.fecha))).sort()).toEqual(['2026-09-14', '2026-09-16', '2026-09-19', '2026-09-28', '2026-09-30']);
    verificarLimpio(e);
  });

  test('Finanzas: lo previsto no suma en el mes y se muestra aparte', async ({ page }) => {
    const d = datosActivos();
    d.sittings_traslados.push(sitting('70000000-0000-4000-8000-000000000020', '2026-10-02', { cobro_familia: 900, pago_ninera: 600 }));
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'finanzas');
    await page.evaluate(async () => { finMes = '2026-10'; await cargarFinanzas(); });
    await esperarQuieta(page);
    await expect(page.locator('#fin-facturado')).toHaveText('$900'); // solo el del 02/10
    await expect(page.locator('#fin-previsto-cobro')).toHaveText('$4.560'); // 4 días × $1.140
    await expect(page.locator('#fin-previsto-pago')).toHaveText('$3.000');
    await expect(page.locator('.fin-previsto')).toContainText('no suma en las cifras de arriba');
    verificarLimpio(e);
  });

  test('Por cobrar no incluye días que todavía no pasaron', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await irAModulo(page, 'finanzas');
    const { gruposCobrar } = await page.evaluate(() => calcularPendientesAgrupados());
    const ids = gruposCobrar.flatMap(g => g.ids);
    expect(ids).not.toContain(P.lun5);
    expect(ids).toContain(P.mie30); // el del 30/09 ya pasó: se cobra
    verificarLimpio(e);
  });
});

test.describe('cambios de un solo día sobre el previsto', () => {
  test('"Este día no fue": la misma fila pasa a $0, no se crea otra', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-10-05');
    await abrirDia(page, '2026-10-05');
    await page.locator('#editmodal button', { hasText: 'Este día no fue' }).click();
    await expect(page.locator('#editmodal')).toContainText('¿Ana Ficticia no va el');
    await page.locator('#editmodal button', { hasText: 'No fue nadie ese día' }).click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('ese día no va nadie');
    expect(escrituras(e, 'sittings_traslados', 'POST')).toEqual([]);
    const [cambio] = escrituras(e, 'sittings_traslados', 'PATCH');
    expect(cambio.params).toEqual({ id: `eq.${P.lun5}` });
    expect(cambio.cuerpo).toMatchObject({ cancelado: true, cobro_familia: 0, pago_ninera: 0, generado_automatico: false });
    verificarLimpio(e);
  });

  test('reemplazo: cambia la niñera de ese día y nada más', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-10-05');
    await abrirDia(page, '2026-10-07');
    await page.locator('#editmodal button', { hasText: 'Este día no fue' }).click();
    await page.locator('#editmodal button', { hasText: 'Vino otra niñera' }).click();
    await page.locator('#agenda-fija-reemplazo-ninera').fill('Carla Ejemplo');
    await page.locator('#editmodal .autocomplete-item', { hasText: 'Carla Ejemplo' }).click();
    await page.locator('#editmodal button', { hasText: 'Registrar reemplazo' }).click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('ese día va Carla Ejemplo');
    expect(escrituras(e, 'sittings_traslados', 'POST')).toEqual([]);
    const [cambio] = escrituras(e, 'sittings_traslados', 'PATCH');
    expect(cambio.params).toEqual({ id: `eq.${P.mie7}` });
    expect(cambio.cuerpo).toMatchObject({ ninera_nombre: 'Carla Ejemplo', ninera_id: ID.nCarla, generado_automatico: false });
    expect(escrituras(e, 'asignaciones', 'PATCH')).toEqual([]); // el fijo no se toca
    verificarLimpio(e);
  });

  test('otro horario solo ese día: corrige la fila prevista con los montos de ese horario', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-10-05');
    await abrirDia(page, '2026-10-05');
    await page.selectOption('#agenda-fija-hf-hh', '20');
    await page.locator('#editmodal button', { hasText: 'Guardar el cambio de este día' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const [cambio] = escrituras(e, 'sittings_traslados', 'PATCH');
    expect(cambio.params).toEqual({ id: `eq.${P.lun5}` });
    expect(cambio.cuerpo).toMatchObject({ hora_inicio: '16:00', hora_fin: '20:00', cobro_familia: 1520, pago_ninera: 1000, generado_automatico: false });
    expect(escrituras(e, 'sittings_traslados', 'POST')).toEqual([]);
    verificarLimpio(e);
  });
});

test.describe('cambios del fijo: se recalculan los previstos', () => {
  test('editar horarios futuros desde una fecha: cierra el fijo el día antes y abre otro', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-10-05');
    await abrirDia(page, '2026-10-05');
    await page.locator('#agenda-fija-edit-toggle').click();
    await page.fill('#agenda-fija-edit-desde', '2026-10-12');
    await page.selectOption('#agenda-fija-edit-hi-hh', '15');
    await page.locator('#editmodal button', { hasText: 'Guardar horario/días desde esa fecha' }).click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('Lo anterior conserva su horario');
    const [alta] = escrituras(e, 'asignaciones', 'POST');
    expect(alta.cuerpo).toMatchObject({ familia_id: ID.fUno, ninera_nombre: 'Ana Ficticia', dias: ['L', 'X'], hora_inicio: '15:00', hora_fin: '19:00', vigente_desde: '2026-10-12', tipo: 'sitting' });
    const [cierre] = escrituras(e, 'asignaciones', 'PATCH');
    expect(cierre.params).toEqual({ id: `eq.${ID.aFijo}` });
    expect(cierre.cuerpo).toEqual({ vigente_hasta: '2026-10-11' });
    expect(llamadasProceso(e)).toHaveLength(1);
    expect(llamadasProceso(e)[0].cuerpo).toEqual({ p_dias: 14 });
    verificarLimpio(e);
  });

  test('editar horarios desde el primer día del fijo cambia el mismo fijo (no hay pasado)', async ({ page }) => {
    const d = datosActivos();
    d.asignaciones[0].vigente_desde = '2026-10-05';
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-10-05');
    await abrirDia(page, '2026-10-05');
    await page.locator('#agenda-fija-edit-toggle').click();
    await page.fill('#agenda-fija-edit-desde', '2026-10-05');
    await page.selectOption('#agenda-fija-edit-hi-hh', '15');
    await page.locator('#editmodal button', { hasText: 'Guardar horario/días desde esa fecha' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(escrituras(e, 'asignaciones', 'POST')).toEqual([]);
    expect(escrituras(e, 'asignaciones', 'PATCH')[0].cuerpo).toMatchObject({ hora_inicio: '15:00', dias: ['L', 'X'] });
    expect(llamadasProceso(e)).toHaveLength(1);
    verificarLimpio(e);
  });

  test('terminar el fijo: recalcula y ofrece borrar los días que alguien cambió a mano', async ({ page }) => {
    const d = datosActivos();
    // El 14/10 alguien lo cambió a mano (ya no es automático): el proceso no lo toca.
    d.sittings_traslados.find(s => s.id === P.mie14).generado_automatico = false;
    const e = await abrirApp(page, { datos: d });
    // Lo que haría la base: borrar los previstos automáticos desde el 12/10.
    e.rpc.generar_previstos_fijos = (cuerpo, db) => {
      db.sittings_traslados = db.sittings_traslados.filter(s => !(s.generado_automatico && s.estado === 'previsto' && s.fecha >= '2026-10-12'));
      return { borrados: 1 };
    };
    await irAModulo(page, 'agenda');
    await page.evaluate(id => abrirModalTerminarFijo(id), ID.aFijo);
    await page.fill('#terminar-desde', '2026-10-12');
    await page.locator('#editmodal button', { hasText: 'Terminar el fijo' }).click();
    await expect(page.locator('#editmodal')).toContainText('Días cambiados a mano');
    await expect(page.locator('#editmodal')).toContainText('14/10');
    expect(escrituras(e, 'asignaciones', 'PATCH')[0].cuerpo).toEqual({ vigente_hasta: '2026-10-11' });
    expect(llamadasProceso(e)).toHaveLength(1);
    await page.locator('#editmodal button', { hasText: 'Borrar estos días' }).click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('Día borrado');
    const [borrado] = escrituras(e, 'sittings_traslados', 'DELETE');
    expect(borrado.params).toEqual({ id: `in.(${P.mie14})`, estado: 'eq.previsto' });
    verificarLimpio(e);
  });

  test('pausar por vacaciones: guarda la pausa, recalcula y la Agenda no dibuja esos días', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    e.rpc.generar_previstos_fijos = (cuerpo, db) => {
      db.sittings_traslados = db.sittings_traslados.filter(s => !(s.generado_automatico && s.estado === 'previsto' && s.fecha >= '2026-10-05' && s.fecha <= '2026-10-09'));
      return {};
    };
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-10-05');
    await abrirDia(page, '2026-10-05');
    await page.locator('#editmodal button', { hasText: 'Pausar este fijo (vacaciones)' }).click();
    await page.fill('#pausa-desde', '2026-10-05');
    await page.fill('#pausa-hasta', '2026-10-09');
    await page.fill('#pausa-motivo', 'Vacaciones');
    await page.locator('#editmodal button', { hasText: /^Pausar$/ }).click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('Fijo pausado del 5 de octubre al 9 de octubre');
    const [pausa] = escrituras(e, 'asignaciones_pausas', 'POST');
    expect(pausa.cuerpo).toMatchObject({ asignacion_id: ID.aFijo, desde: '2026-10-05', hasta: '2026-10-09', motivo: 'Vacaciones' });
    expect(llamadasProceso(e)).toHaveLength(1);
    // El aviso sale antes de que la Agenda termine de recargarse: se espera a que recargue.
    await expect.poll(() => page.evaluate(() => agendaSolicitudes.filter(s => s._asigId).map(s => s.fecha))).toEqual([]);
    await verAgendaDesde(page, '2026-10-12');
    expect(await page.evaluate(() => agendaSolicitudes.filter(s => s._asigId).map(s => s.fecha))).toEqual(['2026-10-12', '2026-10-14']);
    // La pausa se ve en el fijo y se puede quitar.
    await abrirDia(page, '2026-10-12');
    await expect(page.locator('#editmodal')).toContainText(/Pausado del 0?5\/10 al 0?9\/10/);
    await page.locator('#editmodal button', { hasText: 'Quitar pausa' }).click();
    await page.locator('#confirm-si').click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('Pausa quitada');
    expect(escrituras(e, 'asignaciones_pausas', 'DELETE')).toHaveLength(1);
    expect(llamadasProceso(e)).toHaveLength(2);
    verificarLimpio(e);
  });

  test('cambiar la niñera, la vigencia, la tarifa de la familia o crear un fijo llaman al proceso', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-10-05');
    await abrirDia(page, '2026-10-05');
    await page.locator(`#agenda-fija-ninera-${ID.aFijo}`).fill('Carla Ejemplo');
    await page.locator('#editmodal .autocomplete-item', { hasText: 'Carla Ejemplo' }).click();
    await page.locator(`#agenda-fija-guardar-${ID.aFijo}`).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(llamadasProceso(e)).toHaveLength(1);

    await page.evaluate(id => abrirModalVigenciaAsignacion(id), ID.aFijo);
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(llamadasProceso(e)).toHaveLength(2);

    await irAModulo(page, 'familias');
    await page.evaluate(id => editarFamilia(id), ID.fUno);
    await page.fill('#ed-fam-cobro', '420');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).last().click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(llamadasProceso(e)).toHaveLength(3);
    verificarLimpio(e);
  });
});

test.describe('Hoy: cierre de los fijos y sin registrar', () => {
  test('lista los días que se confirmaron solos y "Sí, terminó" los saca', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    const card = page.locator('.autoconf-card');
    await expect(card).toContainText('Cierre de los fijos');
    await expect(card.locator('.autoconf-fila')).toHaveCount(1);
    await expect(card).toContainText('30/09');
    await expect(card).toContainText('Ana Ficticia');
    await card.locator('button', { hasText: 'Sí, terminó 19:00' }).click();
    await expect(card).toHaveCount(0);
    const [revision] = escrituras(e, 'sittings_traslados', 'PATCH');
    expect(revision.params).toEqual({ id: `in.(${P.mie30})` });
    expect(Object.keys(revision.cuerpo)).toEqual(['revisado_at']);
    verificarLimpio(e);
  });

  test('"No fue" desde Hoy deja ese día en $0', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await page.locator('.autoconf-card button', { hasText: 'No fue' }).click();
    await page.locator('#confirm-si').click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('ese día no fue nadie');
    const [cambio] = escrituras(e, 'sittings_traslados', 'PATCH');
    expect(cambio.params).toEqual({ id: `eq.${P.mie30}` });
    expect(cambio.cuerpo).toMatchObject({ cancelado: true, cobro_familia: 0, pago_ninera: 0, generado_automatico: false });
    expect(cambio.cuerpo.revisado_at).toBeTruthy();
    verificarLimpio(e);
  });

  test('"Fue otra" desde Hoy cambia la niñera de ese día', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await page.locator('.autoconf-card button', { hasText: 'Fue otra' }).click();
    await page.locator('#autoconf-ninera').fill('Carla Ejemplo');
    await page.locator('#editmodal .autocomplete-item', { hasText: 'Carla Ejemplo' }).click();
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('ese día figura Carla Ejemplo');
    const [cambio] = escrituras(e, 'sittings_traslados', 'PATCH');
    expect(cambio.cuerpo).toMatchObject({ ninera_nombre: 'Carla Ejemplo', ninera_id: ID.nCarla, generado_automatico: false });
    verificarLimpio(e);
  });

  test('"Sin registrar" incluye los días de un fijo que no tienen ninguna fila', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    // Últimos 14 días: el lunes 21 y el miércoles 23 de setiembre no tienen nada cargado; el
    // 28 está cargado a mano y el 30 se cargó solo.
    await expect(page.locator('#dash-pend-num')).toHaveText('2');
    await irAModulo(page, 'pend-hoy');
    await expect(page.locator('#modcontent')).toContainText('días de los fijos');
    await expect(page.locator('#modcontent .agendarow')).toHaveCount(2);
    await expect(page.locator('#modcontent .agendarow').first()).toContainText('fijo');
    verificarLimpio(e);
  });

  test('apagado: Hoy no muestra la lista ni mete los fijos en "Sin registrar"', async ({ page }) => {
    const e = await abrirApp(page);
    await expect(page.locator('#dash-pend-num')).toHaveText('0');
    await expect(page.locator('.autoconf-card')).toHaveCount(0);
    verificarLimpio(e);
  });
});

test.describe('pausas desde la ficha de la familia', () => {
  test('se ven, se quitan y se puede pausar desde la ficha', async ({ page }) => {
    const d = datosActivos();
    d.asignaciones_pausas = [
      { id: 'b1000000-0000-4000-8000-000000000001', asignacion_id: ID.aFijo, desde: '2026-10-12', hasta: '2026-10-16', motivo: 'Vacaciones', creado_por: 'Prueba', created_at: '2026-10-01T00:00:00Z' },
      { id: 'b1000000-0000-4000-8000-000000000002', asignacion_id: ID.aFijo, desde: '2026-09-01', hasta: '2026-09-05', motivo: 'Vieja', creado_por: 'Prueba', created_at: '2026-08-20T00:00:00Z' },
    ];
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    const ficha = page.locator('#editmodal');
    await expect(ficha.locator('.fam-pausa')).toHaveCount(1); // la que ya pasó no se muestra
    await expect(ficha.locator('.fam-pausa')).toContainText(/Pausado del 12\/10 al 16\/10 · Vacaciones/);
    await expect(ficha.locator('button', { hasText: /^Pausar$/ })).toHaveCount(1);
    await ficha.locator('button', { hasText: 'Quitar pausa' }).click();
    await page.locator('#confirm-si').click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('Pausa quitada');
    const [borrado] = escrituras(e, 'asignaciones_pausas', 'DELETE');
    expect(borrado.params).toEqual({ id: 'eq.b1000000-0000-4000-8000-000000000001' });
    expect(llamadasProceso(e)).toHaveLength(1);

    await page.evaluate(id => verFamilia(id), ID.fUno);
    await page.locator('#editmodal button', { hasText: /^Pausar$/ }).click();
    await expect(page.locator('#editmodal')).toContainText('Pausar el fijo');
    verificarLimpio(e);
  });

  test('apagado: la ficha no ofrece pausar', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await expect(page.locator('#editmodal button', { hasText: 'Terminar' })).toHaveCount(1);
    await expect(page.locator('#editmodal button', { hasText: /^Pausar$/ })).toHaveCount(0);
    verificarLimpio(e);
  });
});

// Precio fijo del traslado (06/10/2026): los traslados de un fijo cobran siempre lo mismo y
// puede ser distinto según el fijo (lunes a un lugar, martes y jueves a otro).
test.describe('precio fijo de un traslado fijo', () => {
  const aTras = 'b2000000-0000-4000-8000-000000000001';
  function datosConTraslado() {
    const d = datosActivos();
    d.asignaciones = d.asignaciones.map(a => ({ ...a, cobro_traslado: null, pago_traslado: null }));
    d.asignaciones.push({ id: aTras, familia_id: ID.fDos, ninera_id: ID.nBruno, ninera_nombre: 'Bruno Inventado', cobro_hora: null, pago_hora: null, created_at: '2026-09-01T00:00:00Z', dias: ['M'], hora_inicio: '08:00:00', hora_fin: null, vigente_desde: '2026-09-01', vigente_hasta: null, tipo: 'traslado', cobro_traslado: 956, pago_traslado: 559 });
    return d;
  }
  test('se edita en "Vigencia" solo para traslados, se guarda y recalcula los previstos', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTraslado() });
    await irAModulo(page, 'agenda');
    await page.evaluate(id => abrirModalVigenciaAsignacion(id), ID.aFijo);
    await expect(page.locator('#vig-precio-box')).toBeHidden();
    await page.locator('#editmodal .btn.ghost').click();

    await page.evaluate(id => abrirModalVigenciaAsignacion(id), aTras);
    await expect(page.locator('#vig-precio-box')).toBeVisible();
    await expect(page.locator('#vig-cobro-traslado')).toHaveValue('956');
    await expect(page.locator('#vig-pago-traslado')).toHaveValue('559');
    await page.fill('#vig-pago-traslado', '');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#vig-warn')).toContainText('necesita lo que se cobra y lo que se paga');
    await page.fill('#vig-cobro-traslado', '960');
    await page.fill('#vig-pago-traslado', '560');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const upd = escrituras(e, 'asignaciones', 'PATCH').at(-1);
    expect(upd.cuerpo).toMatchObject({ tipo: 'traslado', cobro_traslado: 960, pago_traslado: 560 });
    expect(llamadasProceso(e)).toHaveLength(1);
    verificarLimpio(e);
  });
  test('registrar un día del fijo precarga el precio del fijo, no el del último traslado', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTraslado() });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-09-28');
    await page.evaluate(id => abrirModalSolicitud(`asig:${id}@2026-09-29`), aTras);
    await expect(page.locator('#editmodal')).toContainText('$956 / $559');
    await expect(page.locator('#agenda-fija-cobro')).toHaveValue('956');
    await expect(page.locator('#agenda-fija-pago')).toHaveValue('559');
    await expect(page.locator('#agenda-fija-precio-helper')).toHaveText('Precio del fijo.');
    verificarLimpio(e);
  });
  test('cambiar la niñera desde una fecha conserva el precio en el fijo nuevo', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTraslado() });
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-10-05');
    await page.evaluate(id => abrirModalSolicitud(`asig:${id}@2026-10-06`), aTras);
    await page.locator(`#agenda-fija-ninera-${aTras}`).fill('Carla Ejemplo');
    await page.locator('#editmodal .autocomplete-item', { hasText: 'Carla Ejemplo' }).click();
    await page.locator(`#agenda-fija-guardar-${aTras}`).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const alta = escrituras(e, 'asignaciones', 'POST').at(-1);
    expect(alta.cuerpo).toMatchObject({ ninera_nombre: 'Carla Ejemplo', tipo: 'traslado', cobro_traslado: 956, pago_traslado: 559 });
    verificarLimpio(e);
  });
});

// Cambios del fijo "desde hoy" (06/10/2026, decisión de Diego): el sitting de hoy ya se
// confirmó solo a las 03:00 y el proceso de la noche no lo vuelve a tocar. Si la niñera, el
// horario o el precio cambian desde hoy, el de hoy sigue al fijo; pausar desde hoy lo cancela.
// Siempre que nadie lo haya tocado: si lo editaron (o ya está cobrado o pagado), avisa y no lo pisa.
// Acá "hoy" es el lunes 05/10/2026 a las 10:00.
test.describe('cambios del fijo desde hoy: el sitting de hoy sigue al fijo', () => {
  const AHORA = '2026-10-05T10:00:00-03:00';
  const hoyDe = e => e.db.sittings_traslados.find(s => s.id === P.lun5);
  function datosHoy(extraHoy = {}) {
    const d = datosActivos();
    Object.assign(d.sittings_traslados.find(s => s.id === P.lun5), { estado: 'confirmado', ...extraHoy });
    return d;
  }
  async function abrirFijoDel(page, fecha) {
    await irAModulo(page, 'agenda');
    await verAgendaDesde(page, '2026-10-05');
    await abrirDia(page, fecha);
  }
  async function cambiarNinera(page, nombre) {
    await page.locator(`#agenda-fija-ninera-${ID.aFijo}`).fill(nombre);
    await page.locator('#editmodal .autocomplete-item', { hasText: nombre }).click();
    await page.locator(`#agenda-fija-guardar-${ID.aFijo}`).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
  }
  const avisos = page => page.locator('.toaststack .toast.bad');

  test('cambiar la niñera desde hoy: el de hoy pasa a la niñera nueva y al fijo nuevo', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy(), ahora: AHORA });
    await abrirFijoDel(page, '2026-10-07');
    await expect(page.locator(`#agenda-fija-desde-${ID.aFijo}`)).toHaveValue('2026-10-05');
    await cambiarNinera(page, 'Carla Ejemplo');
    const nuevo = escrituras(e, 'asignaciones', 'POST')[0];
    expect(nuevo.cuerpo).toMatchObject({ ninera_nombre: 'Carla Ejemplo', vigente_desde: '2026-10-05' });
    const nuevoId = e.db.asignaciones.find(a => a.ninera_nombre === 'Carla Ejemplo').id;
    await expect.poll(() => hoyDe(e).ninera_nombre).toBe('Carla Ejemplo');
    expect(hoyDe(e)).toMatchObject({ ninera_id: ID.nCarla, asignacion_id: nuevoId, generado_automatico: true, cancelado: false, cobro_familia: 1140, pago_ninera: 750 });
    await expect(avisos(page)).toHaveCount(0);
    verificarLimpio(e);
  });

  test('si el de hoy lo editaron a mano, avisa y no lo pisa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy({ generado_automatico: false, hora_fin: '20:00:00', cobro_familia: 1520 }), ahora: AHORA });
    await abrirFijoDel(page, '2026-10-07');
    await cambiarNinera(page, 'Carla Ejemplo');
    await expect(avisos(page).filter({ hasText: 'lo había cambiado alguien a mano' })).toBeVisible();
    expect(hoyDe(e)).toMatchObject({ ninera_nombre: 'Ana Ficticia', asignacion_id: ID.aFijo, hora_fin: '20:00:00', cobro_familia: 1520 });
    expect(escrituras(e, 'sittings_traslados', 'PATCH')).toEqual([]);
    verificarLimpio(e);
  });

  test('si el de hoy ya está pagado, tampoco lo toca', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy({ pagado: true }), ahora: AHORA });
    await abrirFijoDel(page, '2026-10-07');
    await cambiarNinera(page, 'Carla Ejemplo');
    await expect(avisos(page).filter({ hasText: 'ya está cobrado o pagado' })).toBeVisible();
    expect(hoyDe(e).ninera_nombre).toBe('Ana Ficticia');
    verificarLimpio(e);
  });

  test('cambiar la niñera desde una fecha futura no toca el de hoy', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy(), ahora: AHORA });
    await abrirFijoDel(page, '2026-10-07');
    await page.fill(`#agenda-fija-desde-${ID.aFijo}`, '2026-10-12');
    await cambiarNinera(page, 'Carla Ejemplo');
    expect(hoyDe(e)).toMatchObject({ ninera_nombre: 'Ana Ficticia', asignacion_id: ID.aFijo });
    expect(escrituras(e, 'sittings_traslados', 'PATCH')).toEqual([]);
    verificarLimpio(e);
  });

  test('otro horario desde hoy: el de hoy toma el horario y los montos nuevos', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy(), ahora: AHORA });
    await abrirFijoDel(page, '2026-10-07');
    await page.locator('#agenda-fija-edit-toggle').click();
    await expect(page.locator('#agenda-fija-edit-desde')).toHaveValue('2026-10-05');
    await page.selectOption('#agenda-fija-edit-hi-hh', '15');
    await page.locator('#editmodal button', { hasText: 'Guardar horario/días desde esa fecha' }).click();
    // 15 a 19 = 4 h a $380 / $250.
    await expect.poll(() => hoyDe(e).hora_inicio).toBe('15:00');
    expect(hoyDe(e)).toMatchObject({ hora_fin: '19:00', cobro_familia: 1520, pago_ninera: 1000, generado_automatico: true });
    verificarLimpio(e);
  });

  test('otros días desde hoy y hoy ya no es uno: el de hoy se cancela', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy(), ahora: AHORA });
    await abrirFijoDel(page, '2026-10-07');
    await page.locator('#agenda-fija-edit-toggle').click();
    await page.locator('#agenda-fija-edit-dias .daybtn[data-dia="L"]').click(); // saca el lunes
    await page.locator('#agenda-fija-edit-dias .daybtn[data-dia="J"]').click(); // agrega el jueves
    await page.locator('#editmodal button', { hasText: 'Guardar horario/días desde esa fecha' }).click();
    await expect.poll(() => hoyDe(e).cancelado).toBe(true);
    expect(hoyDe(e)).toMatchObject({ cobro_familia: 0, pago_ninera: 0, notas: 'Cambió el horario del fijo: hoy no va' });
    verificarLimpio(e);
  });

  test('pausar desde hoy cancela el de hoy ($0); si estaba cobrado, avisa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy(), ahora: AHORA });
    await irAModulo(page, 'agenda');
    await page.evaluate(id => abrirModalPausarFijo(id), ID.aFijo);
    await expect(page.locator('#pausa-desde')).toHaveValue('2026-10-05');
    await page.fill('#pausa-hasta', '2026-10-09');
    await page.fill('#pausa-motivo', 'Vacaciones');
    await page.locator('#editmodal button', { hasText: /^Pausar$/ }).click();
    await expect.poll(() => hoyDe(e).cancelado).toBe(true);
    expect(hoyDe(e)).toMatchObject({ cobro_familia: 0, pago_ninera: 0, notas: 'Fijo en pausa: Vacaciones' });
    verificarLimpio(e);
  });

  test('pausar desde hoy con el de hoy ya cobrado: avisa y no lo toca', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy({ cobrado: true }), ahora: AHORA });
    await irAModulo(page, 'agenda');
    await page.evaluate(id => abrirModalPausarFijo(id), ID.aFijo);
    await page.fill('#pausa-hasta', '2026-10-09');
    await page.locator('#editmodal button', { hasText: /^Pausar$/ }).click();
    await expect(avisos(page).filter({ hasText: 'ya está cobrado o pagado' })).toBeVisible();
    expect(hoyDe(e)).toMatchObject({ cancelado: false, cobro_familia: 1140 });
    verificarLimpio(e);
  });

  test('pausa que empieza mañana no toca el de hoy', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy(), ahora: AHORA });
    await irAModulo(page, 'agenda');
    await page.evaluate(id => abrirModalPausarFijo(id), ID.aFijo);
    await page.fill('#pausa-desde', '2026-10-06');
    await page.fill('#pausa-hasta', '2026-10-09');
    await page.locator('#editmodal button', { hasText: /^Pausar$/ }).click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('Fijo pausado');
    expect(hoyDe(e).cancelado).toBe(false);
    expect(escrituras(e, 'sittings_traslados', 'PATCH')).toEqual([]);
    verificarLimpio(e);
  });

  test('tarifa nueva de la familia: el de hoy toma los montos nuevos', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy(), ahora: AHORA });
    await irAModulo(page, 'familias');
    await page.evaluate(id => editarFamilia(id), ID.fUno);
    await page.fill('#ed-fam-cobro', '420');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).last().click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    // 3 h a $420 / $250.
    await expect.poll(() => hoyDe(e).cobro_familia).toBe(1260);
    expect(hoyDe(e)).toMatchObject({ pago_ninera: 750, ninera_nombre: 'Ana Ficticia', cancelado: false });
    verificarLimpio(e);
  });

  test('otros datos de la familia (sin tocar la tarifa) no tocan el de hoy', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy(), ahora: AHORA });
    await irAModulo(page, 'familias');
    await page.evaluate(id => editarFamilia(id), ID.fUno);
    await page.fill('#ed-fam-notas', 'Tiene perro');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).last().click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(escrituras(e, 'sittings_traslados', 'PATCH')).toEqual([]);
    verificarLimpio(e);
  });

  test('precio nuevo de un traslado fijo: el traslado de hoy toma el precio nuevo', async ({ page }) => {
    const aTras = 'b2000000-0000-4000-8000-000000000001';
    const d = datosHoy();
    d.asignaciones = d.asignaciones.map(a => ({ ...a, cobro_traslado: null, pago_traslado: null }));
    d.asignaciones.push({ id: aTras, familia_id: ID.fDos, ninera_id: ID.nBruno, ninera_nombre: 'Bruno Inventado', cobro_hora: null, pago_hora: null, created_at: '2026-09-01T00:00:00Z', dias: ['L'], hora_inicio: '08:00:00', hora_fin: null, vigente_desde: '2026-09-01', vigente_hasta: null, tipo: 'traslado', cobro_traslado: 956, pago_traslado: 559 });
    d.sittings_traslados.push(sitting('a1000000-0000-4000-8000-000000000105', '2026-10-05', {
      tipo: 'traslado', familia_id: ID.fDos, familia_nombre: 'Familia Prueba Dos', ninera_id: ID.nBruno, ninera_nombre: 'Bruno Inventado',
      hora_inicio: '08:00:00', hora_fin: null, cobro_familia: 956, pago_ninera: 559, asignacion_id: aTras,
      estado: 'confirmado', generado_automatico: true, revisado_at: null }));
    const e = await abrirApp(page, { datos: d, ahora: AHORA });
    await irAModulo(page, 'agenda');
    await page.evaluate(id => abrirModalVigenciaAsignacion(id), aTras);
    await page.fill('#vig-cobro-traslado', '990');
    await page.fill('#vig-pago-traslado', '580');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const tras = () => e.db.sittings_traslados.find(s => s.id === 'a1000000-0000-4000-8000-000000000105');
    await expect.poll(() => tras().cobro_familia).toBe(990);
    expect(tras()).toMatchObject({ pago_ninera: 580, hora_inicio: '08:00', cancelado: false });
    // El sitting de hoy del otro fijo no se toca.
    expect(hoyDe(e)).toMatchObject({ cobro_familia: 1140, ninera_nombre: 'Ana Ficticia' });
    verificarLimpio(e);
  });

  test('con los fijos automáticos apagados no toca nada', async ({ page }) => {
    const d = datosHoy();
    d.app_config = [];
    const e = await abrirApp(page, { datos: d, ahora: AHORA });
    await abrirFijoDel(page, '2026-10-07');
    await cambiarNinera(page, 'Carla Ejemplo');
    expect(hoyDe(e).ninera_nombre).toBe('Ana Ficticia');
    expect(escrituras(e, 'sittings_traslados', 'PATCH')).toEqual([]);
    verificarLimpio(e);
  });
});

// Terminar el fijo desde hoy (06/10/2026, decisión de Diego): igual que la pausa. El de hoy,
// ya confirmado a las 03:00, se cancela en $0 si nadie lo tocó; si no, se avisa.
test.describe('terminar el fijo desde hoy: el sitting de hoy se cancela', () => {
  const AHORA = '2026-10-05T10:00:00-03:00';
  const hoyDe = e => e.db.sittings_traslados.find(s => s.id === P.lun5);
  function datosHoy(extraHoy = {}) {
    const d = datosActivos();
    Object.assign(d.sittings_traslados.find(s => s.id === P.lun5), { estado: 'confirmado', ...extraHoy });
    return d;
  }
  async function terminarDesde(page, fecha) {
    await irAModulo(page, 'agenda');
    await page.evaluate(id => abrirModalTerminarFijo(id), ID.aFijo);
    await page.fill('#terminar-desde', fecha);
    await page.locator('#editmodal button', { hasText: 'Terminar el fijo' }).click();
    await expect(page.locator('.toaststack .toast').filter({ hasText: 'el fijo corre hasta' })).toBeVisible();
  }

  test('desde hoy: el de hoy queda en $0 como "no va"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy(), ahora: AHORA });
    await terminarDesde(page, '2026-10-05');
    expect(escrituras(e, 'asignaciones', 'PATCH')[0].cuerpo).toEqual({ vigente_hasta: '2026-10-04' });
    await expect.poll(() => hoyDe(e).cancelado).toBe(true);
    expect(hoyDe(e)).toMatchObject({ cobro_familia: 0, pago_ninera: 0, notas: 'Fijo terminado' });
    verificarLimpio(e);
  });

  test('desde hoy con el de hoy editado a mano: avisa y no lo toca', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy({ generado_automatico: false }), ahora: AHORA });
    await terminarDesde(page, '2026-10-05');
    await expect(page.locator('.toaststack .toast.bad').filter({ hasText: 'lo había cambiado alguien a mano' })).toBeVisible();
    expect(hoyDe(e)).toMatchObject({ cancelado: false, cobro_familia: 1140 });
    verificarLimpio(e);
  });

  test('desde hoy con el de hoy ya pagado: avisa y no lo toca', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy({ pagado: true }), ahora: AHORA });
    await terminarDesde(page, '2026-10-05');
    await expect(page.locator('.toaststack .toast.bad').filter({ hasText: 'ya está cobrado o pagado' })).toBeVisible();
    expect(hoyDe(e)).toMatchObject({ cancelado: false, pago_ninera: 750 });
    verificarLimpio(e);
  });

  test('desde mañana: el de hoy queda como está', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy(), ahora: AHORA });
    await terminarDesde(page, '2026-10-06');
    expect(escrituras(e, 'asignaciones', 'PATCH')[0].cuerpo).toEqual({ vigente_hasta: '2026-10-05' });
    expect(hoyDe(e)).toMatchObject({ cancelado: false, cobro_familia: 1140 });
    expect(escrituras(e, 'sittings_traslados', 'PATCH')).toEqual([]);
    verificarLimpio(e);
  });
});

// "Cargar sitting" desde Hoy > "Sin registrar" (06/10/2026, uso real): el día de un fijo se
// cargaba como sitting suelto. Un sitting fijo avisaba que la niñera "ya está comprometida"
// con esa misma familia (chocaba contra su propio fijo), un traslado fijo abría como sitting
// en $0, y ninguno quedaba vinculado al fijo (asignacion_id vacío).
test.describe('cargar un día de un fijo desde "Sin registrar"', () => {
  const aTras = 'b2000000-0000-4000-8000-000000000002';
  function datosConTrasladoFijo() {
    const d = datosActivos();
    d.asignaciones = d.asignaciones.map(a => ({ ...a, cobro_traslado: null, pago_traslado: null }));
    d.asignaciones.push({ id: aTras, familia_id: ID.fDos, ninera_id: ID.nBruno, ninera_nombre: 'Bruno Inventado', cobro_hora: null, pago_hora: null, created_at: '2026-09-01T00:00:00Z', dias: ['M'], hora_inicio: '08:00:00', hora_fin: null, vigente_desde: '2026-09-01', vigente_hasta: null, tipo: 'traslado', cobro_traslado: 488, pago_traslado: 282 });
    return d;
  }
  async function cargarDesdePendiente(page, texto) {
    await irAModulo(page, 'pend-hoy');
    await page.locator('#modcontent .agendarow', { hasText: texto }).first().locator('button', { hasText: 'Cargar sitting' }).click();
    await expect(page.locator('#editmodal')).toBeVisible();
    await esperarQuieta(page);
  }

  test('sitting fijo: sin aviso de doble reserva contra su propio fijo y vinculado al fijo', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await cargarDesdePendiente(page, 'Ana Ficticia');
    await expect(page.locator('#sit-tipo-sitting')).toHaveClass(/selected/);
    await expect(page.locator('#sit-fecha')).toHaveValue('2026-09-21');
    await expect(page.locator('#sit-cobro')).toHaveValue('1140');
    await expect(page.locator('#sit-pago')).toHaveValue('750');
    await page.locator('#editmodal button', { hasText: 'Guardar registro' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    await expect(page.locator('.confirmoverlay')).toHaveCount(0);
    const [alta] = escrituras(e, 'sittings_traslados', 'POST');
    expect(alta.cuerpo).toMatchObject({ tipo: 'sitting', asignacion_id: ID.aFijo, familia_id: ID.fUno, ninera_nombre: 'Ana Ficticia', fecha: '2026-09-21', hora_inicio: '16:00', hora_fin: '19:00', cobro_familia: 1140, pago_ninera: 750 });
    verificarLimpio(e);
  });

  test('traslado fijo: abre como traslado, con el precio del fijo, y queda vinculado', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosConTrasladoFijo() });
    await cargarDesdePendiente(page, 'Bruno Inventado');
    await expect(page.locator('#sit-tipo-traslado')).toHaveClass(/selected/);
    await expect(page.locator('#sit-cobro')).toHaveValue('488');
    await expect(page.locator('#sit-pago')).toHaveValue('282');
    await expect(page.locator('#sit-precio-sugerido-box')).toHaveText('Precio del fijo.');
    await page.locator('#editmodal button', { hasText: 'Guardar registro' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const [alta] = escrituras(e, 'sittings_traslados', 'POST');
    expect(alta.cuerpo).toMatchObject({ tipo: 'traslado', asignacion_id: aTras, familia_id: ID.fDos, ninera_nombre: 'Bruno Inventado', fecha: '2026-09-22', hora_inicio: '08:00', cobro_familia: 488, pago_ninera: 282 });
    verificarLimpio(e);
  });

  test('la doble reserva real (otra familia a la misma hora) se sigue avisando', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await irAModulo(page, 'sittings');
    await page.evaluate(() => abrirModalSitForm());
    await esperarQuieta(page);
    await page.fill('#sit-familia', 'Familia Prueba Dos');
    await page.fill('#sit-ninera', 'Ana Ficticia');
    await page.evaluate(() => { onSitFamiliaInput(); onSitNineraInput(); document.getElementById('sit-fecha').value = '2026-09-21'; setHoraSelect('sit-horaini', '17:00'); setHoraSelect('sit-horafin', '18:00'); });
    await page.locator('#editmodal button', { hasText: 'Guardar registro' }).click();
    const aviso = page.locator('.confirmoverlay:not(#editmodal)');
    await expect(aviso).toContainText('ya está comprometida con Familia Prueba Uno');
    await aviso.locator('button', { hasText: 'Cancelar' }).click();
    expect(escrituras(e, 'sittings_traslados', 'POST')).toEqual([]);
    verificarLimpio(e);
  });

  test('un sitting suelto (sin fijo) no se vincula a ninguna asignación', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosActivos() });
    await cargarDesdePendiente(page, 'Ana Ficticia');
    await page.evaluate(() => cerrarModal()); // se abrió desde un fijo y se cerró sin guardar
    await irAModulo(page, 'sittings');
    await page.evaluate(() => abrirModalSitForm());
    await esperarQuieta(page);
    await page.fill('#sit-familia', 'Familia Prueba Dos');
    await page.fill('#sit-ninera', 'Bruno Inventado');
    await page.evaluate(() => { onSitFamiliaInput(); onSitNineraInput(); document.getElementById('sit-fecha').value = '2026-09-24'; setHoraSelect('sit-horaini', '10:00'); setHoraSelect('sit-horafin', '12:00'); });
    await page.locator('#editmodal button', { hasText: 'Guardar registro' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    const [alta] = escrituras(e, 'sittings_traslados', 'POST');
    expect(alta.cuerpo.asignacion_id).toBeUndefined();
    expect(alta.cuerpo.tipo).toBe('sitting');
    verificarLimpio(e);
  });
});
