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
const { ID, datosPedidos, datosEleccion } = require('./support/datos');
const { rpcPedidosAdmin, alConfirmarFila } = require('./support/rpc-ninera');

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

// Lo que hace "Asignar", desde Node, para armar la situación de un test de la niñera: la solicitud y la
// fila a confirmada, con las mismas reglas de la base que el REST simulado (alConfirmarFila).
const asignarDesdeNode = (e, sol, snId) => {
  e.db.solicitudes.find(s => s.id === sol).estado = 'confirmada';
  const sn = e.db.solicitud_ninieras.find(x => x.id === snId);
  sn.estado = 'confirmada';
  alConfirmarFila(e.db, new Date(AHORA).toISOString(), sn);
};

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
    expect(await err(SOL_UNO, [envio('30000000-0000-4000-8000-0000000000ff')])).toMatchObject({ message: 'ninera_no_existe', hint: '30000000-0000-4000-8000-0000000000ff' });
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
    // Etapa 6: sin la marca horario_aproximado el horario va solo (antes iba siempre "aproximada").
    expect(avisos[0].cuerpo).toBe('20:00 – 23:00\nZona: Pocitos\n1 chico (4 años)\nPrecio por hora: $1.250');
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
    expect(e.db.avisos.filter(a => a.titulo === 'Sitting 04/10').pop().cuerpo.split('\n')[0]).toBe('20:00 – 00:30 del día siguiente');
    // Con la marca (etapa 6), sí.
    Object.assign(e.db.solicitudes.find(s => s.id === SOL_PRACTICA_HOY), { horario_aproximado: true, estado: 'sin_asignar' });
    e.db.solicitud_ninieras.length = 0;
    e.db.avisos = e.db.avisos.filter(a => !a.clave.startsWith('pedido:'));
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
      // Etapa 6: las dos columnas nuevas, al final.
      horario_aproximado: false, solicitud_id: SOL_PRACTICA,
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
    expect(h.find(x => x.ninera_id === ID.nAna)).toEqual({ ninera_id: ID.nAna, ninera_clave: null, veces_familia: 5, total: 5, veces_familia_traslado: 0, total_traslado: 0, semana: 1, edades: [3, 5], max_chicos: 2 });
    // Sin id: se agrupa por el nombre normalizado y es de la familia por el nombre.
    expect(h.find(x => x.ninera_id === null)).toEqual({ ninera_id: null, ninera_clave: 'ana ficticia', veces_familia: 1, total: 1, veces_familia_traslado: 0, total_traslado: 0, semana: 0, edades: [3, 5], max_chicos: 2 });
    // Solo un traslado (con otra familia): ceros de sittings, sin edades ni chicos, y el traslado aparte.
    expect(h.find(x => x.ninera_id === ID.nBruno)).toEqual({ ninera_id: ID.nBruno, ninera_clave: null, veces_familia: 0, total: 0, veces_familia_traslado: 0, total_traslado: 1, semana: 0, edades: [], max_chicos: null });
    expect(h).toHaveLength(3);
    const p = Object.fromEntries(r.data.por_ninera.map(x => [x.ninera_id, x]));
    expect(p[ID.nCarla]).toEqual({ ninera_id: ID.nCarla, no_puedo_seguidos: 2, incidente_familia: true, no_disponible: false });
    expect(p[ID.nAna]).toEqual({ ninera_id: ID.nAna, no_puedo_seguidos: 1, incidente_familia: true, no_disponible: false });
    // Las respuestas del panel no cuentan; el día marcado sí.
    expect(p[ID.nBruno]).toEqual({ ninera_id: ID.nBruno, no_puedo_seguidos: 0, incidente_familia: false, no_disponible: true });
    expect(r.data.por_ninera).toHaveLength(e.db.ninieras.length);
    verificarLimpio(e);
  });

  // Revisión final (02/11/2026): "Asignar" pasa el "Puedo" a 'confirmada' (conserva respondido_en) y eso no
  // borra que dijo que sí; una asignada sin responder (sin respondido_en) no es un "Puedo". Los traslados,
  // aparte: con la familia y en total, sin cancelados ni previstos.
  test('sugeridas_datos: un "Puedo" que terminó asignado corta los "No puedo"; los traslados van aparte', async ({ page }) => {
    const datos = datosPedidos();
    const tr = (id, extra) => ({ ...datos.sittings_traslados.find(r => r.tipo === 'traslado'), id, ...extra });
    datos.sittings_traslados.push(
      tr('70000000-0000-4000-8000-0000000000b1', { familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', fecha: '2026-09-20' }),
      tr('70000000-0000-4000-8000-0000000000b2', { familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', fecha: '2026-09-21', cancelado: true }),
      tr('70000000-0000-4000-8000-0000000000b3', { familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', fecha: '2026-10-07', estado: 'previsto' }),
    );
    const e = await abrirApp(page, { datos });
    const t = (id, estado, quien, en) => ({ id, solicitud_id: SOL_UNO, ninera_id: quien, ninera_nombre: 'x', estado, origen: 'app', respondido_en: en });
    e.db.solicitud_ninieras.push(
      t('81000000-0000-4000-8000-000000000011', 'no_puedo', ID.nCarla, '2026-09-28T10:00:00Z'),
      t('81000000-0000-4000-8000-000000000012', 'no_puedo', ID.nCarla, '2026-09-29T10:00:00Z'),
      t('81000000-0000-4000-8000-000000000013', 'no_puedo', ID.nCarla, '2026-09-30T10:00:00Z'),
      t('81000000-0000-4000-8000-000000000014', 'confirmada', ID.nCarla, '2026-10-01T10:00:00Z'),
      t('81000000-0000-4000-8000-000000000015', 'no_puedo', ID.nAna, '2026-10-01T10:00:00Z'),
      t('81000000-0000-4000-8000-000000000016', 'confirmada', ID.nAna, null),
    );
    const r = await rpcPanel(page, 'sugeridas_datos', { p_familia_id: ID.fUno, p_familia_nombre: 'Familia Prueba Uno', p_fecha: '2026-10-06' });
    expect(r.error).toBeNull();
    const p = Object.fromEntries(r.data.por_ninera.map(x => [x.ninera_id, x]));
    expect(p[ID.nCarla].no_puedo_seguidos).toBe(0);
    expect(p[ID.nAna].no_puedo_seguidos).toBe(1);
    const bruno = r.data.historial.find(x => x.ninera_id === ID.nBruno);
    expect(bruno).toMatchObject({ veces_familia: 0, total: 0, veces_familia_traslado: 1, total_traslado: 2 });
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

// ---- Etapa 6 (01/11/2026): elegir la niñera, los triggers y lo que ve la niñera ----
// Espejo de 20261103_eleccion_pedidos.sql (y de supabase/pruebas/fase1_eleccion.sql). Los avisos salen de las
// escrituras de siempre del panel: la fila de la niñera a 'confirmada' y la solicitud a 'cancelada'.
test.describe('simulador de la elección de niñera (etapa 6)', () => {
  // Como "Asignar": la solicitud a confirmada y la fila de la niñera a confirmada, por el REST simulado.
  const asignar = (page, sol, snId, extra = {}) => page.evaluate(async ([s, id, ex]) => {
    const a = await sb.from('solicitudes').update({ estado: 'confirmada' }).eq('id', s);
    const b = await sb.from('solicitud_ninieras').update({ estado: 'confirmada', ...ex }).eq('id', id);
    return [a.error, b.error];
  }, [sol, snId, extra]);
  const fila = (e, id) => e.db.solicitud_ninieras.find(x => x.id === id);
  const avisosDe = (e, clave) => e.db.avisos.filter(a => a.clave === clave);

  test('asignar a una que dijo "Puedo": la otra que dijo "Puedo" queda cubierta con su aviso y la que no respondió, sin aviso', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    expect(await asignar(page, ID.sPendiente, ID.snPendPractica)).toEqual([null, null]);
    expect(fila(e, ID.snPendPractica)).toMatchObject({ estado: 'confirmada', seleccionada_en: '2026-10-04T15:00:00.000Z', visto_en: null });
    const sel = avisosDe(e, `pedido:${ID.snPendPractica}:seleccionada`);
    expect(sel).toHaveLength(1);
    expect(sel[0]).toMatchObject({
      para_ninera_id: ID.nPractica, para_admin: null, tipo: 'pedido', titulo: '¡Quedaste seleccionada!',
      cuerpo: 'mié 07/10 a las 18:00. Ya tienes todos los datos en la app.', url: `#pedido/${ID.snPendPractica}`,
      datos: { solicitud_ninera_id: ID.snPendPractica },
    });
    expect(fila(e, ID.snPendLola).estado).toBe('cubierto');
    expect(fila(e, ID.snPendMia).estado).toBe('cubierto');
    const cub = avisosDe(e, `pedido:${ID.snPendLola}:cubierto`);
    expect(cub).toHaveLength(1);
    expect(cub[0]).toMatchObject({ para_ninera_id: ID.nLola, tipo: 'pedido', titulo: 'Gracias por responder',
      cuerpo: 'Este sitting ya quedó cubierto. ¡Te tendremos en cuenta para el próximo!', url: '#inicio', datos: { solicitud_ninera_id: ID.snPendLola } });
    expect(avisosDe(e, `pedido:${ID.snPendMia}:cubierto`)).toEqual([]);
    // Volver a tocar la fila no repite nada.
    await page.evaluate(async id => { await sb.from('solicitud_ninieras').update({ pago_ninera: 801, estado: 'confirmada' }).eq('id', id); }, ID.snPendPractica);
    expect(e.db.avisos.filter(a => /^pedido:.*:(seleccionada|cubierto)$/.test(a.clave))).toHaveLength(2);
    verificarLimpio(e);
  });

  test('asignar con una fila nueva avisa; un traslado, una niñera sin app y un pedido pasado, no; la real con solo_practica, tampoco', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    const insertar = (sol, ninera, nombre) => page.evaluate(async ([s, n, nom]) => (await sb.from('solicitud_ninieras').insert({ solicitud_id: s, ninera_id: n, ninera_nombre: nom, estado: 'confirmada', pago_ninera: 500 })).error, [sol, ninera, nombre]);
    const S = n => `86000000-0000-4000-8000-00000000000${n}`;
    const nueva = (id, extra = {}) => ({ ...e.db.solicitudes.find(s => s.id === SOL_UNO), id, ...extra });
    e.db.solicitudes.push(nueva(S(1)), nueva(S(2)), nueva(S(3), { tipo: 'traslado' }), nueva(S(4)), nueva(S(5), { fecha: '2026-10-03' }));
    const dela = sol => e.db.solicitud_ninieras.find(x => x.solicitud_id === sol);
    // Carla tiene app pero es real y la familia también: con solo_practica prendido, nada.
    expect(await insertar(S(1), ID.nCarla, 'Carla Ejemplo')).toBeNull();
    expect(dela(S(1)).seleccionada_en ?? null).toBeNull();
    expect(e.db.avisos.filter(a => a.clave.includes(':seleccionada'))).toEqual([]);
    soloPracticaApagado(e);
    await insertar(S(2), ID.nCarla, 'Carla Ejemplo');
    expect(avisosDe(e, `pedido:${dela(S(2)).id}:seleccionada`)).toHaveLength(1);
    await insertar(S(3), ID.nCarla, 'Carla Ejemplo'); // traslado
    await insertar(S(4), ID.nAna, 'Ana Ficticia'); // sin app
    await insertar(S(5), ID.nCarla, 'Carla Ejemplo'); // pedido pasado
    expect(e.db.avisos.filter(a => a.clave.includes(':seleccionada'))).toHaveLength(1);
    expect(dela(S(4)).seleccionada_en ?? null).toBeNull();
    verificarLimpio(e);
  });

  test('con solo_practica, una de práctica que dijo "Puedo" en un pedido de familia real queda cubierta sin aviso', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    const sn = { id: '86000000-0000-4000-8000-000000000011', solicitud_id: SOL_UNO, ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', estado: 'invitada', origen: 'app', respondido_en: '2026-10-04T13:00:00.000Z' };
    const otra = { ...sn, id: '86000000-0000-4000-8000-000000000012', ninera_id: ID.nLola, ninera_nombre: 'Lola (práctica)', estado: 'acepto' };
    e.db.solicitud_ninieras.push(sn, otra);
    await page.evaluate(async id => { await sb.from('solicitud_ninieras').update({ estado: 'confirmada' }).eq('id', id); }, sn.id);
    expect(otra.estado).toBe('cubierto');
    expect(e.db.avisos.filter(a => a.clave.startsWith('pedido:'))).toEqual([]);
    expect(sn.seleccionada_en ?? null).toBeNull();
    verificarLimpio(e);
  });

  test('cancelar el pedido: las abiertas quedan canceladas y solo a las que dijeron "Puedo" les llega el aviso', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    const r = await page.evaluate(async id => (await sb.from('solicitudes').update({ estado: 'cancelada' }).eq('id', id)).error, ID.sPendiente);
    expect(r).toBeNull();
    for (const id of [ID.snPendPractica, ID.snPendLola, ID.snPendMia]) expect(fila(e, id).estado).toBe('cancelado');
    expect(e.db.avisos.filter(a => a.clave.endsWith(':cancelado')).map(a => a.clave).sort())
      .toEqual([`pedido:${ID.snPendPractica}:cancelado`, `pedido:${ID.snPendLola}:cancelado`].sort());
    expect(avisosDe(e, `pedido:${ID.snPendLola}:cancelado`)[0]).toMatchObject({
      para_ninera_id: ID.nLola, tipo: 'pedido', titulo: 'Se canceló el pedido del mié 07/10', cuerpo: 'Gracias por responder.', url: '#inicio',
      datos: { solicitud_ninera_id: ID.snPendLola },
    });
    // Cancelar otra vez (ya cancelada) no repite nada.
    await page.evaluate(async id => { await sb.from('solicitudes').update({ estado: 'cancelada' }).eq('id', id); }, ID.sPendiente);
    expect(e.db.avisos.filter(a => a.clave.endsWith(':cancelado'))).toHaveLength(2);
    verificarLimpio(e);
  });

  test('la niñera ve la fila elegida una vez y ninera_marcar_pedido_visto la saca; la de otra no se puede marcar', async ({ page }) => {
    const e = await abrirAppNinera(page, { datos: datosEleccion(), ninera: ID.nPractica });
    const antes = await rpcNinera(page, 'ninera_mis_pedidos', {});
    expect(antes.data.map(p => [p.id, p.estado])).toEqual([[ID.snPendPractica, 'acepto'], [ID.snPedPractica, 'acepto']]);
    expect(antes.data[0]).toMatchObject({ horario_aproximado: false, solicitud_id: ID.sPendiente });
    expect(antes.data[1]).toMatchObject({ horario_aproximado: true, solicitud_id: ID.sPedida });
    asignarDesdeNode(e, ID.sPendiente, ID.snPendPractica);
    const lista = (await rpcNinera(page, 'ninera_mis_pedidos', {})).data;
    expect(lista.find(p => p.id === ID.snPendPractica)).toMatchObject({ estado: 'confirmada', solicitud_id: ID.sPendiente });
    expect((await rpcNinera(page, 'ninera_marcar_pedido_visto', { p_sn_id: ID.snPendLola })).data).toBe(false);
    expect((await rpcNinera(page, 'ninera_marcar_pedido_visto', { p_sn_id: ID.snPendPractica })).data).toBe(true);
    expect((await rpcNinera(page, 'ninera_marcar_pedido_visto', { p_sn_id: ID.snPendPractica })).data).toBe(false);
    expect(fila(e, ID.snPendPractica).visto_en).toBe('2026-10-04T15:00:00.000Z');
    expect((await rpcNinera(page, 'ninera_mis_pedidos', {})).data.map(p => p.id)).toEqual([ID.snPedPractica]);
    // Con "Puedo" todavía abierto, no se marca.
    expect((await rpcNinera(page, 'ninera_marcar_pedido_visto', { p_sn_id: ID.snPedPractica })).data).toBe(false);
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('cubierto: Lola lo ve una vez y Mía (no respondió) nunca', async ({ page }) => {
    const e = await abrirAppNinera(page, { datos: datosEleccion(), ninera: ID.nLola });
    asignarDesdeNode(e, ID.sPendiente, ID.snPendPractica);
    expect((await rpcNinera(page, 'ninera_mis_pedidos', {})).data.map(p => [p.id, p.estado])).toEqual([[ID.snPendLola, 'cubierto']]);
    expect((await rpcNinera(page, 'ninera_marcar_pedido_visto', { p_sn_id: ID.snPendLola })).data).toBe(true);
    expect((await rpcNinera(page, 'ninera_mis_pedidos', {})).data).toEqual([]);
    // Mía: su fila queda cubierta pero sin "Puedo": no se le muestra.
    expect(fila(e, ID.snPendMia).estado).toBe('cubierto');
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('una admin no es niñera: ninera_marcar_pedido_visto da no_autorizada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion() });
    expect((await rpcPanel(page, 'ninera_marcar_pedido_visto', { p_sn_id: ID.snPendLola })).error).toMatchObject({ message: 'no_autorizada' });
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('ninera_mis_sittings (etapa 6): indicaciones, marca, precio por hora y solicitud_id; las indicaciones solo si está confirmado; nunca notas internas', async ({ page }) => {
    const datos = datosEleccion();
    const reg = (id, estado, fecha) => ({ ...datos.sittings_traslados[0], id, tipo: 'sitting', ninera_id: ID.nPractica, ninera_nombre: 'Niñera (práctica)', familia_id: ID.fPractica, familia_nombre: 'Familia (práctica)',
      fecha, hora_inicio: '18:00:00', hora_fin: '22:00:00', estado, solicitud_id: ID.sPendiente, notas: 'Nota interna que no se ve', cobro_familia: 2000, pago_ninera: 800 });
    datos.sittings_traslados.push(reg('87000000-0000-4000-8000-000000000001', 'confirmado', '2026-10-07'), reg('87000000-0000-4000-8000-000000000002', 'previsto', '2026-10-08'));
    const e = await abrirAppNinera(page, { datos, ninera: ID.nPractica });
    asignarDesdeNode(e, ID.sPendiente, ID.snPendPractica);
    const todos = (await rpcNinera(page, 'ninera_mis_sittings', {})).data;
    const r = todos.filter(s => s.solicitud_id);
    expect(r).toHaveLength(2);
    expect(r.find(s => s.estado === 'confirmado')).toMatchObject({ notas_para_ninera: 'Hay un perro. Tocar el timbre 5.', horario_aproximado: false, precio_hora: 200, solicitud_id: ID.sPendiente });
    expect(r.find(s => s.estado === 'previsto').notas_para_ninera).toBeNull();
    expect(JSON.stringify(todos)).not.toContain('Nota interna');
    // Un registro sin pedido: las columnas nuevas vacías.
    for (const s of todos.filter(x => !x.solicitud_id)) expect(s).toMatchObject({ horario_aproximado: false, precio_hora: null, solicitud_id: null, notas_para_ninera: null });
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('base sin migrar (etapa6) en la niñera: marcar visto da 404, las dos lecturas vuelven a la forma de la etapa 5 y las columnas nuevas dan error', async ({ page }) => {
    const datos = datosEleccion();
    datos.sittings_traslados.push({ ...datos.sittings_traslados[0], id: '87000000-0000-4000-8000-000000000003', ninera_id: ID.nPractica, ninera_nombre: 'Niñera (práctica)', fecha: '2026-10-07', estado: 'confirmado' });
    const e = await abrirAppNinera(page, { datos, ninera: ID.nPractica, baseSinMigrar: 'etapa6' });
    expect((await rpcNinera(page, 'ninera_marcar_pedido_visto', { p_sn_id: ID.snPendPractica })).error).toMatchObject({ code: 'PGRST202' });
    const lista = (await rpcNinera(page, 'ninera_mis_pedidos', {})).data;
    expect(lista).toHaveLength(2);
    for (const p of lista) { expect(p).not.toHaveProperty('horario_aproximado'); expect(p).not.toHaveProperty('solicitud_id'); }
    const sit = await rpcNinera(page, 'ninera_mis_sittings', {});
    expect(sit.error).toBeNull();
    expect(sit.data.length).toBeGreaterThan(0);
    for (const s of sit.data) for (const c of ['horario_aproximado', 'precio_hora', 'solicitud_id']) expect(s).not.toHaveProperty(c);
    // Lo de la etapa 5 anda: un pedido que no es suyo no existe, pero la RPC responde.
    expect((await rpcNinera(page, 'responder_pedido', { p_sn_id: ID.snPedMia, p_respuesta: 'acepto' })).error).toMatchObject({ message: 'no_existe' });
    const r = await page.evaluate(async () => ({
      colSol: (await sbn.from('solicitudes').select('id, horario_aproximado')).error?.code,
      colSn: (await sbn.from('solicitud_ninieras').select('id, visto_en')).error?.code,
      colSit: (await sbn.from('sittings_traslados').select('id, solicitud_id')).error?.code,
      etapa5: (await sbn.from('solicitudes').select('id, responder_hasta')).error?.code ?? null,
    }));
    expect(r).toEqual({ colSol: '42703', colSn: '42703', colSit: '42703', etapa5: null });
    await page.close();
    expect(e.noSimulados).toEqual([]);
  });

  test('base sin migrar (etapa6) en el panel: asignar y cancelar no disparan nada y escribir una columna nueva da PGRST204', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosEleccion(), baseSinMigrar: 'etapa6' });
    expect(await asignar(page, ID.sPendiente, ID.snPendPractica)).toEqual([null, null]);
    expect(fila(e, ID.snPendLola).estado).toBe('acepto');
    expect(e.db.avisos.filter(a => a.clave.startsWith('pedido:'))).toEqual([]);
    const r = await page.evaluate(async () => ({
      a: (await sb.from('solicitudes').update({ horario_aproximado: true }).eq('id', 'x')).error?.code,
      b: (await sb.from('sittings_traslados').insert({ solicitud_id: 'x' })).error?.code,
      etapa5: (await sb.from('solicitudes').select('id, responder_hasta')).error?.code ?? null,
    }));
    expect(r).toEqual({ a: 'PGRST204', b: 'PGRST204', etapa5: null });
    verificarLimpio(e, { ignorar: [RUIDO_4XX, /status of 4\d\d|Failed to load resource/] });
  });
});
