// El simulador de los traslados por la app (fase 1, etapa 11, 03/11/2026): la misma regla que
// supabase/migraciones/20261109_traslados_app.sql (la prueba de la base es supabase/pruebas/fase1_traslados.sql).
// enviar_pedido_app con un traslado (en el mismo orden que la SQL), lo que leen las niñeras, los avisos por día de un
// traslado y la base sin la migración ('etapa11'). Datos inventados (datosPedidos): hoy es domingo 04/10/2026; Carla
// hace las dos cosas y tiene la app; Bruno solo traslados, sin la app; Ana solo sittings.
const { test, expect } = require('@playwright/test');
const { abrirApp, abrirAppNinera, verificarLimpio } = require('./support/app');
const { ID, datosPedidos, sitting } = require('./support/datos');

const SOL = '88000000-0000-4000-8000-0000000000c1';
const REGISTRO = '70000000-0000-4000-8000-0000000000c1';
const RUIDO_4XX = /status of 4\d\d/;
const rpcPanel = (page, nombre, args) => page.evaluate(async ([n, a]) => {
  const r = await sb.rpc(n, a);
  return { data: r.data, error: r.error && { code: r.error.code, message: r.error.message, hint: r.error.hint } };
}, [nombre, args]);
const rpcNinera = (page, nombre, args) => page.evaluate(async ([n, a]) => {
  const r = await sbn.rpc(n, a);
  return { data: r.data, error: r.error && { code: r.error.code, message: r.error.message, hint: r.error.hint } };
}, [nombre, args]);

function datos({ ruta = {}, carsitting = true } = {}) {
  const d = datosPedidos();
  d.app_config.find(c => c.id === 'pedidos_app').valor.solo_practica = false;
  d.carsitting_datos = carsitting ? [{ id: '97000000-0000-4000-8000-0000000000c1', ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', nombre_completo: 'Carla Ejemplo',
    enviado_en: '2026-10-01T12:00:00Z', revision: 'pendiente', aprobado_en: '2026-09-20T12:00:00Z' }] : [];
  d.solicitudes.push({ id: SOL, familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', tipo: 'traslado', zona: 'Pocitos', fecha: '2026-10-06', hora_inicio: '08:00:00',
    hora_fin: null, cobro_familia: 450, estado: 'sin_asignar', notas: null, created_at: '2026-10-01T00:00:00Z', termina_dia_siguiente: false, horario_aproximado: false,
    origen: 'Calle Falsa 123', destino: 'Colegio Inventado', destino_zona: 'Carrasco', km: 12, ...ruta });
  return d;
}
const mandar = (page, envios) => rpcPanel(page, 'enviar_pedido_app', { p_solicitud_id: SOL, p_envios: envios });

test('enviar_pedido_app con un traslado: valida como la SQL y en su orden, y el aviso dice "Precio: $X por viaje"', async ({ page }) => {
  const e = await abrirApp(page, { datos: datos({ ruta: { origen: '  ' } }) });
  expect((await mandar(page, [{ ninera_id: ID.nCarla, precio_viaje: 350 }])).error).toMatchObject({ message: 'sin_origen_destino' });
  e.db.solicitudes.find(s => s.id === SOL).origen = 'Calle Falsa 123';
  e.db.solicitudes.find(s => s.id === SOL).destino_zona = null;
  expect((await mandar(page, [{ ninera_id: ID.nCarla, precio_viaje: 350 }])).error).toMatchObject({ message: 'sin_zonas' });
  e.db.solicitudes.find(s => s.id === SOL).destino_zona = 'Carrasco';
  expect((await mandar(page, [{ ninera_id: ID.nCarla, precio_hora: 350 }])).error).toMatchObject({ message: 'precio_invalido', hint: 'Carla Ejemplo' });
  expect((await mandar(page, [{ ninera_id: ID.nAna, precio_viaje: 350 }])).error).toMatchObject({ message: 'ninera_sin_app' });
  e.db.ninieras.find(n => n.id === ID.nAna).user_id = '00000000-0000-4000-8000-0000000000aa';
  expect((await mandar(page, [{ ninera_id: ID.nAna, precio_viaje: 350 }])).error).toMatchObject({ message: 'ninera_no_hace_traslados', hint: 'Ana Ficticia' });
  e.db.carsitting_datos[0].aprobado_en = null;
  expect((await mandar(page, [{ ninera_id: ID.nCarla, precio_viaje: 350 }])).error).toMatchObject({ message: 'sin_carsitting', hint: 'Carla Ejemplo' });
  expect(e.db.solicitud_ninieras.filter(x => x.solicitud_id === SOL)).toHaveLength(0);
  // Aprobada una vez: una actualización en revisión no la frena.
  e.db.carsitting_datos[0].aprobado_en = '2026-09-20T12:00:00Z';
  expect((await mandar(page, [{ ninera_id: ID.nCarla, precio_viaje: 350 }])).data).toBe(1);
  expect(e.db.solicitud_ninieras.find(x => x.solicitud_id === SOL)).toMatchObject({ origen: 'app', estado: 'invitada', precio_hora: null, precio_viaje: 350 });
  expect(e.db.solicitudes.find(s => s.id === SOL).estado).toBe('pendiente_confirmar');
  const aviso = e.db.avisos.find(a => a.clave.endsWith(':nuevo'));
  expect([aviso.titulo, aviso.cuerpo]).toEqual(['Traslado 06/10', 'A las 08:00\nDe Pocitos a Carrasco\n2 chicos (3 y 5 años)\nPrecio: $350 por viaje']);
  verificarLimpio(e, { ignorar: [RUIDO_4XX] });
});

test('lo que lee la niñera: tipo, la zona de destino y el precio por viaje; las direcciones, solo en el registro confirmado', async ({ page }) => {
  const d = datos();
  d.solicitud_ninieras.push({ id: '81000000-0000-4000-8000-0000000000c1', solicitud_id: SOL, ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', pago_ninera: 350,
    estado: 'confirmada', created_at: '2026-10-04T14:50:00Z', origen: 'app', precio_hora: null, precio_viaje: 350, enviado_en: '2026-10-04T14:50:00Z',
    respondido_en: '2026-10-04T14:55:00Z', seleccionada_en: '2026-10-04T15:00:00Z', visto_en: null });
  d.solicitudes.find(s => s.id === SOL).estado = 'confirmada';
  d.sittings_traslados.push(sitting(REGISTRO, '2026-10-06', { tipo: 'traslado', familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', ninera_id: ID.nCarla,
    ninera_nombre: 'Carla Ejemplo', hora_inicio: '08:00:00', hora_fin: null, solicitud_id: SOL, origen: 'Calle Falsa 123', destino: 'Colegio Inventado', km: 12 }));
  const e = await abrirAppNinera(page, { ninera: ID.nCarla, datos: d });
  const pedidos = await rpcNinera(page, 'ninera_mis_pedidos', {});
  expect(pedidos.data[0]).toMatchObject({ tipo: 'traslado', zona: 'Pocitos', destino_zona: 'Carrasco', precio_viaje: 350, precio_hora: null });
  expect(JSON.stringify(pedidos.data)).not.toMatch(/Calle Falsa|Colegio|cobro|km/);
  const sittings = await rpcNinera(page, 'ninera_mis_sittings', {});
  expect(sittings.data.find(s => s.id === REGISTRO)).toMatchObject({ tipo: 'traslado', origen: 'Calle Falsa 123', destino: 'Colegio Inventado',
    zona: 'Pocitos', destino_zona: 'Carrasco', precio_viaje: 350 });
  verificarLimpio(e);
});

test('los avisos por día de un traslado: la hora de salida avisa con su fila; la hora de fin no', async ({ page }) => {
  const d = datos();
  d.ninieras.find(n => n.id === ID.nCarla).activa = true;
  d.sittings_traslados.push(sitting(REGISTRO, '2026-10-06', { tipo: 'traslado', familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', ninera_id: ID.nCarla,
    ninera_nombre: 'Carla Ejemplo', hora_inicio: '08:00:00', hora_fin: null }));
  const e = await abrirApp(page, { datos: d });
  const patch = cambios => page.evaluate(async ([id, c]) => (await sb.from('sittings_traslados').update(c).eq('id', id)).error, [REGISTRO, cambios]);
  expect(await patch({ hora_fin: '09:00' })).toBeNull();
  expect(e.db.avisos.filter(a => a.para_ninera_id === ID.nCarla && a.clave.includes(':cambio:'))).toHaveLength(0);
  expect(await patch({ hora_inicio: '08:30' })).toBeNull();
  const aviso = e.db.avisos.find(a => a.para_ninera_id === ID.nCarla && a.clave.includes(':cambio:'));
  expect([aviso.titulo, aviso.cuerpo]).toEqual(['Cambió el horario de tu traslado del mar 06/10', 'Ahora es a las 08:30. Mira los detalles.']);
  expect(e.db.cambios_horario.find(c => c.sitting_id === REGISTRO)).toMatchObject({ tipo: 'traslado', hora_inicio: '08:30', hora_fin: null });
  expect(await patch({ cancelado: true })).toBeNull();
  expect(e.db.avisos.some(a => a.para_ninera_id === ID.nCarla && a.titulo === 'Se canceló tu traslado del mar 06/10')).toBe(true);
  verificarLimpio(e);
});

test('base sin migrar (etapa 11): enviar un traslado da solo_sittings y los avisos por día siguen solo para sittings', async ({ page }) => {
  const d = datos();
  d.sittings_traslados.push(sitting(REGISTRO, '2026-10-06', { tipo: 'traslado', familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', ninera_id: ID.nCarla,
    ninera_nombre: 'Carla Ejemplo', hora_inicio: '08:00:00', hora_fin: null }));
  const e = await abrirApp(page, { datos: d, baseSinMigrar: 'etapa11' });
  expect((await mandar(page, [{ ninera_id: ID.nCarla, precio_viaje: 350 }])).error).toMatchObject({ message: 'solo_sittings' });
  await page.evaluate(async id => sb.from('sittings_traslados').update({ hora_inicio: '08:30' }).eq('id', id), REGISTRO);
  expect(e.db.avisos.filter(a => a.para_ninera_id === ID.nCarla && a.clave.includes(REGISTRO))).toHaveLength(0);
  const escribir = await page.evaluate(async id => (await sb.from('solicitud_ninieras').insert({ solicitud_id: id, ninera_nombre: 'X', precio_viaje: 1 })).error?.code, SOL);
  expect(escribir).toBe('PGRST204');
  verificarLimpio(e, { ignorar: [RUIDO_4XX] });
});
