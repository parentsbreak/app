// Simulador de la etapa 5 (fase 1, 02/11/2026): enviar_pedido_app, sugeridas_datos, las RPC del
// pedido de la niñera, ninera_no_disponible, el trigger del aviso "Pedido nuevo" y la base sin migrar,
// como los deja la migración 20261102_pedidos_app.sql. Las pantallas (tareas 5.5 a 5.7) se prueban en
// sus propios archivos; acá se mira que el simulador imite a la base, porque esos tests confían en él.
//
// Ojo: el simulador arranca con app_config 'pedidos_app'.solo_practica = true, como la migración (por la
// app solo salen pedidos de práctica). Un test que manda pedidos de familias reales lo apaga con
// `soloPracticaApagado(e)` (pone solo_practica en false en e.db.app_config).
const { test, expect } = require('@playwright/test');
const { abrirApp, abrirAppNinera, verificarLimpio } = require('./support/app');
const { ID, datosPedidos } = require('./support/datos');
const { rpcPedidosAdmin } = require('./support/rpc-ninera');

const RUIDO_4XX = /status of 4\d\d/;
const SOL_UNO = '80000000-0000-4000-8000-000000000002'; // Familia Prueba Uno, con chicos, 06/10
const SOL_PRACTICA_HOY = '80000000-0000-4000-8000-000000000003'; // Familia (práctica), hoy 04/10
const SOL_PRACTICA = '80000000-0000-4000-8000-000000000004'; // Familia (práctica), 06/10

function soloPracticaApagado(e) {
  e.db.app_config.find(c => c.id === 'pedidos_app').valor.solo_practica = false;
}
const rpcPanel = (page, nombre, args) => page.evaluate(async ([n, a]) => {
  const r = await sb.rpc(n, a);
  return { data: r.data, error: r.error && { code: r.error.code, message: r.error.message, hint: r.error.hint } };
}, [nombre, args]);
const rpcNinera = (page, nombre, args) => page.evaluate(async ([n, a]) => {
  const r = await sbn.rpc(n, a);
  return { data: r.data, error: r.error && { code: r.error.code, message: r.error.message, hint: r.error.hint } };
}, [nombre, args]);
const envio = (id, precio = 300) => ({ ninera_id: id, precio_hora: precio });
const AHORA = '2026-10-04T12:00:00-03:00';
// Manda un pedido desde Node (como una admin) para armar la situación de un test de la niñera.
const mandar = (e, sol, envios) => rpcPedidosAdmin(e.db, AHORA, { admin: true }).enviar_pedido_app({ p_solicitud_id: sol, p_envios: envios });

test.describe('simulador del pedido por la app (etapa 5)', () => {
  test('enviar_pedido_app valida como la SQL, en el mismo orden y con el nombre en el hint', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    soloPracticaApagado(e);
    const enviar = (sol, envios) => rpcPanel(page, 'enviar_pedido_app', { p_solicitud_id: sol, p_envios: envios });
    const err = async (sol, envios) => (await enviar(sol, envios)).error;

    expect(await err(SOL_UNO, [])).toMatchObject({ code: 'P0001', message: 'sin_ninieras' });
    expect(await err(SOL_UNO, Array.from({ length: 41 }, () => envio(ID.nCarla)))).toMatchObject({ message: 'demasiadas_ninieras' });
    expect(await err(ID.fUno, [envio(ID.nCarla)])).toMatchObject({ message: 'no_existe' });
    // Familia Prueba Dos no tiene chicos cargados (hijos_familia): el texto libre no cuenta.
    e.db.familias.find(f => f.id === ID.fDos).ninos = 'Pepe y Pepa Apellido';
    expect(await err('80000000-0000-4000-8000-000000000001', [envio(ID.nCarla)])).toMatchObject({ message: 'sin_chicos' });
    expect(await err(SOL_UNO, [{ ninera_id: 'no-es-uuid', precio_hora: 300 }])).toMatchObject({ message: 'envio_invalido' });
    expect(await err(SOL_UNO, [envio(ID.nCarla, 0)])).toMatchObject({ message: 'precio_invalido', hint: 'Carla Ejemplo' });
    expect(await err(SOL_UNO, [envio(ID.nCarla, 100000)])).toMatchObject({ message: 'precio_invalido' });
    expect(await err(SOL_UNO, [envio('30000000-0000-4000-8000-0000000000ff')])).toMatchObject({ message: 'ninera_no_existe' });
    expect(await err(SOL_UNO, [envio(ID.nAna)])).toMatchObject({ message: 'ninera_sin_app', hint: 'Ana Ficticia' });
    e.db.ninieras.find(n => n.id === ID.nBruno).user_id = ID.uCarla;
    expect(await err(SOL_UNO, [envio(ID.nBruno)])).toMatchObject({ message: 'ninera_solo_traslados', hint: 'Bruno Inventado' });
    e.db.ninieras.find(n => n.id === ID.nCarla).activa = false;
    expect(await err(SOL_UNO, [envio(ID.nCarla)])).toMatchObject({ message: 'ninera_inactiva', hint: 'Carla Ejemplo' });
    e.db.ninieras.find(n => n.id === ID.nCarla).activa = true;
    // Práctica con real, para los dos lados.
    expect(await err(SOL_UNO, [envio(ID.nPractica)])).toMatchObject({ message: 'practica_mezclada', hint: 'Niñera (práctica)' });
    expect(await err(SOL_PRACTICA, [envio(ID.nCarla)])).toMatchObject({ message: 'practica_mezclada', hint: 'Carla Ejemplo' });
    // Sin tilde también es práctica.
    e.db.ninieras.find(n => n.id === ID.nPractica).nombre = 'Ninera (practica)';
    expect((await enviar(SOL_PRACTICA, [envio(ID.nPractica)])).data).toBe(1);
    // Nada a medias: la segunda falla y la primera no queda.
    expect(await err(SOL_UNO, [envio(ID.nCarla), envio(ID.nAna)])).toMatchObject({ message: 'ninera_sin_app' });
    expect(e.db.solicitud_ninieras.filter(s => s.solicitud_id === SOL_UNO)).toEqual([]);
    expect(e.db.solicitudes.find(s => s.id === SOL_UNO).estado).toBe('sin_asignar');
    // Cerrado y pasado.
    e.db.solicitudes.find(s => s.id === SOL_UNO).estado = 'confirmada';
    expect(await err(SOL_UNO, [envio(ID.nCarla)])).toMatchObject({ message: 'cerrado' });
    e.db.solicitudes.find(s => s.id === SOL_UNO).estado = 'sin_asignar';
    e.db.solicitudes.find(s => s.id === SOL_UNO).fecha = '2026-10-03';
    expect(await err(SOL_UNO, [envio(ID.nCarla)])).toMatchObject({ message: 'pasado' });
    e.db.solicitudes.find(s => s.id === SOL_UNO).fecha = '2026-10-06';
    e.db.solicitudes.find(s => s.id === SOL_UNO).tipo = 'traslado';
    expect(await err(SOL_UNO, [envio(ID.nCarla)])).toMatchObject({ message: 'solo_sittings' });
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('con solo_practica prendido (lo normal) una familia real no sale; la de práctica sí', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    const r1 = await rpcPanel(page, 'enviar_pedido_app', { p_solicitud_id: SOL_UNO, p_envios: [envio(ID.nCarla)] });
    expect(r1.error).toMatchObject({ message: 'solo_practica' });
    const r2 = await rpcPanel(page, 'enviar_pedido_app', { p_solicitud_id: SOL_PRACTICA, p_envios: [envio(ID.nPractica)] });
    expect(r2).toEqual({ data: 1, error: null });
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('una niñera no es admin (no_autorizada) y una sin app se rechaza con ninera_sin_app', async ({ page }) => {
    const e = await abrirAppNinera(page, { datos: datosPedidos(), ninera: ID.nPractica });
    // Una niñera no es admin: la guarda va primero.
    const r = await rpcNinera(page, 'enviar_pedido_app', { p_solicitud_id: SOL_PRACTICA, p_envios: [envio(ID.nPractica)] });
    expect(r.error).toMatchObject({ message: 'no_autorizada' });
    const admin = rpcPedidosAdmin(e.db, AHORA, { admin: true });
    expect(() => admin.enviar_pedido_app({ p_solicitud_id: SOL_PRACTICA, p_envios: [envio(ID.nAna)] })).toThrow(expect.objectContaining({ rpc: expect.objectContaining({ message: 'ninera_sin_app', hint: 'Ana Ficticia' }) }));
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('no repite a una ya enviada, cuenta lo nuevo y arma el aviso, el estado y la hora límite', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    soloPracticaApagado(e);
    e.db.familias.find(f => f.id === ID.fUno).zona = 'Pocitos';
    // Otra práctica para ver el conteo.
    const otra = { ...e.db.ninieras.find(n => n.id === ID.nPractica), id: '30000000-0000-4000-8000-000000000099', nombre: 'Otra Niñera (práctica)' };
    e.db.ninieras.push(otra);
    const enviar = (sol, envios) => rpcPanel(page, 'enviar_pedido_app', { p_solicitud_id: sol, p_envios: envios });
    expect(await enviar(SOL_PRACTICA, [envio(ID.nPractica, 1250)])).toEqual({ data: 1, error: null });
    // Mismo pedido, la misma niñera y una nueva: manda solo a la nueva, sin error.
    expect(await enviar(SOL_PRACTICA, [envio(ID.nPractica, 1250), envio(otra.id)])).toEqual({ data: 1, error: null });
    expect(await enviar(SOL_PRACTICA, [envio(ID.nPractica, 1250)])).toEqual({ data: 0, error: null });
    const filas = e.db.solicitud_ninieras.filter(s => s.solicitud_id === SOL_PRACTICA);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ estado: 'invitada', origen: 'app', precio_hora: 1250, ninera_nombre: 'Niñera (práctica)' });
    const sol = e.db.solicitudes.find(s => s.id === SOL_PRACTICA);
    expect(sol.estado).toBe('pendiente_confirmar');
    expect(sol.enviado_app_en).toBe('2026-10-04T15:00:00.000Z');
    expect(sol.responder_hasta).toBe('2026-10-04T15:30:00.000Z'); // otro día: 30 min
    const avisos = e.db.avisos.filter(a => a.clave.startsWith('pedido:'));
    expect(avisos).toHaveLength(2);
    expect(avisos[0]).toMatchObject({
      clave: `pedido:${filas[0].id}:nuevo`, para_ninera_id: ID.nPractica, para_admin: null, tipo: 'pedido',
      titulo: 'Sitting 06/10', url: `#pedido/${filas[0].id}`, datos: { solicitud_ninera_id: filas[0].id },
    });
    expect(avisos[0].cuerpo).toBe('20:00 – 23:00 (aproximada, se puede extender)\nZona: Pocitos\n1 chico (4 años)\nPrecio por hora: $1.250');
  });

  test('responder_hasta: 15 min si es para hoy; el horario sin fin y el que cruza la medianoche', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    const enviar = (sol) => rpcPanel(page, 'enviar_pedido_app', { p_solicitud_id: sol, p_envios: [envio(ID.nPractica)] });
    expect(await enviar(SOL_PRACTICA_HOY)).toEqual({ data: 1, error: null });
    expect(e.db.solicitudes.find(s => s.id === SOL_PRACTICA_HOY).responder_hasta).toBe('2026-10-04T15:15:00.000Z');
    // Del config si está: 45 min otro día.
    e.db.app_config.find(c => c.id === 'pedidos_app').valor.min_otro_dia = 45;
    Object.assign(e.db.solicitudes.find(s => s.id === SOL_PRACTICA), { hora_fin: null });
    await enviar(SOL_PRACTICA);
    expect(e.db.solicitudes.find(s => s.id === SOL_PRACTICA).responder_hasta).toBe('2026-10-04T15:45:00.000Z');
    expect(e.db.avisos.find(a => a.titulo === 'Sitting 06/10').cuerpo.split('\n')[0]).toBe('20:00, sin hora de fin');
    Object.assign(e.db.solicitudes.find(s => s.id === SOL_PRACTICA_HOY), { hora_inicio: '20:00:00', hora_fin: '00:30:00', termina_dia_siguiente: true, estado: 'sin_asignar' });
    e.db.solicitud_ninieras.length = 0;
    await enviar(SOL_PRACTICA_HOY);
    expect(e.db.avisos.filter(a => a.titulo === 'Sitting 04/10').pop().cuerpo.split('\n')[0]).toBe('20:00 – 00:30 del día siguiente (aproximada, se puede extender)');
    verificarLimpio(e);
  });

  test('ninera_mis_pedidos no trae la familia; responder_pedido: ya_respondido y cerrado', async ({ page }) => {
    const e = await abrirAppNinera(page, { datos: datosPedidos(), ninera: ID.nPractica });
    expect(await mandar(e, SOL_PRACTICA, [envio(ID.nPractica, 1250)])).toBe(1);
    const sn = e.db.solicitud_ninieras[0];
    const lista = await rpcNinera(page, 'ninera_mis_pedidos', {});
    expect(lista.error).toBeNull();
    expect(lista.data).toHaveLength(1);
    expect(lista.data[0]).toEqual({
      id: sn.id, estado: 'invitada', fecha: '2026-10-06', hora_inicio: '20:00:00', hora_fin: '23:00:00', termina_dia_siguiente: false,
      zona: 'Pocitos', chicos: '1 chico (4 años)', precio_hora: 1250, responder_hasta: e.db.solicitudes.find(s => s.id === SOL_PRACTICA).responder_hasta,
      enviado_en: sn.enviado_en, respondido_en: null,
    });
    const texto = JSON.stringify(lista.data);
    for (const prohibido of ['familia', 'Familia', 'direccion', 'cobro', 'notas']) expect(texto).not.toContain(prohibido);

    // Errores de formato antes de mirar el pedido.
    expect((await rpcNinera(page, 'responder_pedido', { p_sn_id: sn.id, p_respuesta: 'quizas' })).error).toMatchObject({ message: 'respuesta_invalida' });
    expect((await rpcNinera(page, 'responder_pedido', { p_sn_id: sn.id, p_respuesta: 'no_puedo', p_motivo: 'x' })).error).toMatchObject({ message: 'motivo_invalido' });
    expect((await rpcNinera(page, 'responder_pedido', { p_sn_id: sn.id, p_respuesta: 'no_puedo' })).error).toMatchObject({ message: 'motivo_invalido' });
    expect((await rpcNinera(page, 'responder_pedido', { p_sn_id: sn.id, p_respuesta: 'no_puedo', p_motivo: 'otro', p_motivo_texto: 'a'.repeat(201) })).error).toMatchObject({ message: 'motivo_largo' });
    expect((await rpcNinera(page, 'responder_pedido', { p_sn_id: ID.fUno, p_respuesta: 'acepto' })).error).toMatchObject({ message: 'no_existe' });

    expect((await rpcNinera(page, 'responder_pedido', { p_sn_id: sn.id, p_respuesta: 'acepto' })).data).toBe('ok');
    // Segundo toque.
    expect((await rpcNinera(page, 'responder_pedido', { p_sn_id: sn.id, p_respuesta: 'no_puedo', p_motivo: 'lejos' })).data).toBe('ya_respondido');
    expect(e.db.solicitud_ninieras[0]).toMatchObject({ estado: 'acepto', motivo_no: null });
    expect(e.db.solicitud_ninieras[0].respondido_en).toBe('2026-10-04T15:00:00.000Z');
    // Sigue abierto como "Esperando confirmación".
    expect((await rpcNinera(page, 'ninera_mis_pedidos', {})).data[0].estado).toBe('acepto');
    // El aviso a las admins, una sola vez.
    const avisos = e.db.avisos.filter(a => a.clave === `admin:pedido:${sn.id}:acepto`);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      para_admin: 'todas', para_ninera_id: null, tipo: 'pedidos', titulo: 'Niñera (práctica) aceptó el pedido de Familia (práctica)',
      cuerpo: 'mar 06/10 20:00', url: `?ir=agenda&solicitud=${SOL_PRACTICA}`, datos: { solicitud_id: SOL_PRACTICA },
    });
    // Asignado por otra admin: cerrado, y ya no aparece.
    e.db.solicitudes.find(s => s.id === SOL_PRACTICA).estado = 'confirmada';
    expect((await rpcNinera(page, 'responder_pedido', { p_sn_id: sn.id, p_respuesta: 'acepto' })).data).toBe('cerrado');
    expect((await rpcNinera(page, 'ninera_mis_pedidos', {})).data).toEqual([]);
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('"No puedo" guarda el motivo (el texto solo con otro); un pedido de otra no existe', async ({ page }) => {
    const e = await abrirAppNinera(page, { datos: datosPedidos(), ninera: ID.nPractica });
    await mandar(e, SOL_PRACTICA, [envio(ID.nPractica)]);
    const sn = e.db.solicitud_ninieras[0];
    e.db.solicitud_ninieras.push({ ...sn, id: '81000000-0000-4000-8000-000000000001', ninera_id: ID.nCarla });
    expect((await rpcNinera(page, 'responder_pedido', { p_sn_id: '81000000-0000-4000-8000-000000000001', p_respuesta: 'acepto' })).error).toMatchObject({ message: 'no_existe' });
    const r = await rpcNinera(page, 'responder_pedido', { p_sn_id: sn.id, p_respuesta: 'no_puedo', p_motivo: 'lejos', p_motivo_texto: 'ignorado' });
    expect(r.data).toBe('ok');
    expect(e.db.solicitud_ninieras[0]).toMatchObject({ estado: 'no_puedo', motivo_no: 'lejos', motivo_texto: null });
    expect(e.db.avisos.filter(a => a.clave.startsWith('admin:pedido:'))).toEqual([]);
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('ninera_marcar_no_disponible: rango, tope, quitar y lo que cuenta', async ({ page }) => {
    const e = await abrirAppNinera(page, { datos: datosPedidos(), ninera: ID.nPractica });
    const marcar = (fechas, quitar) => rpcNinera(page, 'ninera_marcar_no_disponible', quitar === undefined ? { p_fechas: fechas } : { p_fechas: fechas, p_quitar: quitar });
    expect((await marcar([])).data).toBe(0);
    expect((await marcar(['2026-10-03'])).error).toMatchObject({ message: 'fecha_fuera_de_rango' });
    expect((await marcar(['2027-01-03'])).error).toMatchObject({ message: 'fecha_fuera_de_rango' });
    const muchos = Array.from({ length: 63 }, (_, i) => `2026-10-${String(4 + i).padStart(2, '0')}`);
    expect((await marcar(muchos)).error).toMatchObject({ message: 'demasiados_dias' });
    // Hoy y hoy + 90 (2027-01-02) entran; un día repetido cuenta una vez.
    expect((await marcar(['2026-10-04', '2027-01-02', '2026-10-04'])).data).toBe(2);
    expect((await marcar(['2026-10-04', '2026-10-05'])).data).toBe(1); // el 04 ya estaba
    expect(e.db.ninera_no_disponible.map(d => d.fecha).sort()).toEqual(['2026-10-04', '2026-10-05', '2027-01-02']);
    expect(e.db.ninera_no_disponible.every(d => d.ninera_id === ID.nPractica)).toBe(true);
    expect((await marcar(['2026-10-05', '2026-11-01'], true)).data).toBe(1);
    expect(e.db.ninera_no_disponible.map(d => d.fecha).sort()).toEqual(['2026-10-04', '2027-01-02']);
    // Nadie escribe la tabla directo: ni la niñera ni una admin.
    const directo = await page.evaluate(async id => (await sbn.from('ninera_no_disponible').insert({ ninera_id: id, fecha: '2026-10-09' })).error?.code, ID.nPractica);
    expect(directo).toBe('42501');
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('sugeridas_datos: historial por id y por nombre, edades, semana, "no puedo" seguidos e incidentes', async ({ page }) => {
    const datos = datosPedidos();
    // Un registro viejo sin ninera_id (solo el nombre, con mayúsculas y tilde distintas) y sin familia_id.
    datos.sittings_traslados.push({ ...datos.sittings_traslados[0], id: '70000000-0000-4000-8000-0000000000a1', ninera_id: null, ninera_nombre: ' ANA Ficticia ', familia_id: null, familia_nombre: 'familia prueba uno', fecha: '2026-09-21' });
    // Cancelado: no cuenta.
    datos.sittings_traslados.push({ ...datos.sittings_traslados[0], id: '70000000-0000-4000-8000-0000000000a2', cancelado: true, fecha: '2026-09-22' });
    const e = await abrirApp(page, { datos });
    const t = (id, estado, quien, en) => ({ id, solicitud_id: SOL_UNO, ninera_id: quien, ninera_nombre: 'x', estado, origen: 'app', respondido_en: en });
    e.db.solicitud_ninieras.push(
      t('81000000-0000-4000-8000-000000000001', 'no_puedo', ID.nCarla, '2026-09-30T10:00:00Z'),
      t('81000000-0000-4000-8000-000000000002', 'acepto', ID.nCarla, '2026-10-01T10:00:00Z'),
      t('81000000-0000-4000-8000-000000000003', 'no_puedo', ID.nCarla, '2026-10-02T10:00:00Z'),
      t('81000000-0000-4000-8000-000000000004', 'no_puedo', ID.nCarla, '2026-10-03T10:00:00Z'),
      t('81000000-0000-4000-8000-000000000005', 'no_puedo', ID.nAna, '2026-10-03T10:00:00Z'),
      { ...t('81000000-0000-4000-8000-000000000006', 'no_puedo', ID.nBruno, '2026-10-03T10:00:00Z'), origen: 'panel' },
    );
    e.db.incidentes.push({ id: '82000000-0000-4000-8000-000000000001', ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno' });
    e.db.incidentes.push({ id: '82000000-0000-4000-8000-000000000002', ninera_id: null, ninera_nombre: 'carla EJEMPLO', familia_id: null, familia_nombre: 'Familia Prueba Uno' });
    e.db.ninera_no_disponible.push({ ninera_id: ID.nBruno, fecha: '2026-10-06', creado_en: '2026-10-03T10:00:00Z' });
    const r = await rpcPanel(page, 'sugeridas_datos', { p_familia_id: ID.fUno, p_familia_nombre: 'Familia Prueba Uno', p_fecha: '2026-10-06' });
    expect(r.error).toBeNull();
    const h = r.data.historial;
    expect(h.find(x => x.ninera_id === ID.nAna)).toEqual({ ninera_id: ID.nAna, ninera_clave: null, veces_familia: 5, total: 5, semana: 1, edades: [3, 5], max_chicos: 2 });
    // Sin id: se agrupa por el nombre normalizado y es de la familia por el nombre.
    expect(h.find(x => x.ninera_id === null)).toEqual({ ninera_id: null, ninera_clave: 'ana ficticia', veces_familia: 1, total: 1, semana: 0, edades: [3, 5], max_chicos: 2 });
    // Solo un traslado: aparece con ceros, sin edades ni chicos.
    expect(h.find(x => x.ninera_id === ID.nBruno)).toEqual({ ninera_id: ID.nBruno, ninera_clave: null, veces_familia: 0, total: 0, semana: 0, edades: [], max_chicos: null });
    expect(h).toHaveLength(3);
    const p = Object.fromEntries(r.data.por_ninera.map(x => [x.ninera_id, x]));
    expect(p[ID.nCarla]).toEqual({ ninera_id: ID.nCarla, no_puedo_seguidos: 2, incidente_familia: true, no_disponible: false });
    expect(p[ID.nAna]).toEqual({ ninera_id: ID.nAna, no_puedo_seguidos: 1, incidente_familia: true, no_disponible: false });
    // Las respuestas del panel no cuentan; el día marcado sí.
    expect(p[ID.nBruno]).toEqual({ ninera_id: ID.nBruno, no_puedo_seguidos: 0, incidente_familia: false, no_disponible: true });
    expect(r.data.por_ninera).toHaveLength(e.db.ninieras.length);
    verificarLimpio(e);
  });

  test('pasar un pedido de WhatsApp a la Agenda avisa a las otras admins (trigger)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    e.db.pedidos_whatsapp = [{ id: '83000000-0000-4000-8000-000000000001', creado_por: 'Paula Prueba', texto: 'hola', estado: 'confirmado', solicitud_id: null }];
    const patch = valor => page.evaluate(async v => (await sb.from('pedidos_whatsapp').update({ solicitud_id: v }).eq('id', '83000000-0000-4000-8000-000000000001')).error, valor);
    expect(await patch(SOL_UNO)).toBeNull();
    const av = e.db.avisos.filter(a => a.clave === `admin:pedido:${SOL_UNO}:nuevo`);
    expect(av).toHaveLength(1);
    expect(av[0]).toMatchObject({
      para_admin: 'todas', para_ninera_id: null, tipo: 'pedidos', titulo: 'Pedido nuevo de Familia Prueba Uno',
      cuerpo: 'mar 06/10, 20:00 a 23:00. Revisalo.', url: `?ir=agenda&solicitud=${SOL_UNO}`, datos: { solicitud_id: SOL_UNO, excepto: 'Paula Prueba' },
    });
    // Solo null -> valor: cambiarlo de nuevo no repite el aviso.
    await patch(SOL_PRACTICA);
    expect(e.db.avisos.filter(a => a.clave.startsWith('admin:pedido:') && a.clave.endsWith(':nuevo'))).toHaveLength(1);
    verificarLimpio(e);
  });

  test('el ticket de pedido-whatsapp viene simulado: familia reconocida, una duda y la niñera pedida', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    const r = await page.evaluate(async () => {
      const x = await sb.functions.invoke('pedido-whatsapp', { body: { texto: 'Hola, necesito el martes de 20 a 23' } });
      return x.data;
    });
    expect(r.pedido).toMatchObject({ estado: 'borrador', tipo: 'pedido_nuevo', familia_id: ID.fUno, servicio: 'sitting', fecha: '2026-10-06', hora_inicio: '20:00', hora_fin: '23:00', ninera_pedida: 'Carla Ejemplo' });
    expect(r.pedido.dudas).toHaveLength(1);
    expect(e.db.pedidos_whatsapp).toHaveLength(1);
    verificarLimpio(e);
  });

  test('base sin migrar (etapa5): las tres RPC de la niñera y las del panel dan 404, y la tabla y las columnas no existen', async ({ page }) => {
    const e = await abrirAppNinera(page, { datos: datosPedidos(), ninera: ID.nPractica, baseSinMigrar: 'etapa5' });
    for (const nombre of ['ninera_mis_pedidos', 'responder_pedido', 'ninera_marcar_no_disponible']) {
      expect((await rpcNinera(page, nombre, {})).error).toMatchObject({ code: 'PGRST202' });
    }
    // Lo de las etapas anteriores anda.
    expect((await rpcNinera(page, 'ninera_mis_sittings', {})).error).toBeNull();
    const tabla = await page.evaluate(async () => (await sbn.from('ninera_no_disponible').select('fecha')).error?.code);
    expect(tabla).toBe('PGRST205');
    await page.close();
    expect(e.noSimulados).toEqual([]);
  });

  test('base sin migrar (etapa5) en el panel: RPC 404, tabla y columnas nuevas con el error de Supabase', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos(), baseSinMigrar: 'etapa5' });
    for (const [nombre, args] of [['enviar_pedido_app', { p_solicitud_id: SOL_UNO, p_envios: [envio(ID.nCarla)] }], ['sugeridas_datos', { p_familia_id: ID.fUno, p_familia_nombre: 'x', p_fecha: '2026-10-06' }]]) {
      expect((await rpcPanel(page, nombre, args)).error).toMatchObject({ code: 'PGRST202' });
    }
    const r = await page.evaluate(async () => ({
      tabla: (await sb.from('ninera_no_disponible').select('fecha')).error?.code,
      colSol: (await sb.from('solicitudes').select('id, responder_hasta')).error?.code,
      colSn: (await sb.from('solicitud_ninieras').select('id, origen')).error?.code,
      colFam: (await sb.from('familias').select('id, solo_conocidas')).error?.code,
      colPed: (await sb.from('pedidos_whatsapp').select('id, ninera_pedida')).error?.code,
      escribe: (await sb.from('solicitudes').update({ enviado_app_en: 'x' }).eq('id', 'x')).error?.code,
      sinColumnas: (await sb.from('solicitudes').select('id, estado')).error,
    }));
    expect(r).toEqual({ tabla: 'PGRST205', colSol: '42703', colSn: '42703', colFam: '42703', colPed: '42703', escribe: 'PGRST204', sinColumnas: null });
    // Lo que ya existía anda como siempre.
    expect(e.db.solicitudes.length).toBeGreaterThan(0);
    verificarLimpio(e, { ignorar: [RUIDO_4XX, /status of 4\d\d|Failed to load resource/] });
  });
});
