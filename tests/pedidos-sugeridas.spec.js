// Tarea 5.4 (31/10/2026): el orden de las sugeridas, una prueba por regla de reglas-del-negocio.md 5.
// La función es pura: se prueba en la página con datos inventados, sin tocar la base.
const { test, expect } = require('@playwright/test');
const { abrirApp, verificarLimpio } = require('./support/app');

const PEDIDO = { tipo: 'sitting', zona: 'Pocitos', fecha: '2026-11-10', edades: [], chicos: 1, ninera_pedida_id: null,
  solo_conocidas: false, mostrar_nuevas: false, practica: false };
const nin = (id, extra = {}) => ({ id, nombre: 'Nin ' + id, tipo: 'Niñera', zona: 'Pocitos', activa: true, user_id: 'u' + id, ...extra });

// Corre ordenarSugeridas en la página; devuelve los ids por grupo y el resultado entero.
async function ordenar(page, pedido, datos) {
  return await page.evaluate(([p, d]) => {
    const r = ordenarSugeridas(p, d);
    const ids = l => l.map(x => (x.ninera || x).id);
    return { r, sug: ids(r.sugeridas), ocu: ids(r.ocultas), des: ids(r.descartadas), ina: ids(r.inactivas) };
  }, [{ ...PEDIDO, ...pedido }, datos]);
}
const item = (res, id) => res.r.sugeridas.concat(res.r.ocultas, res.r.inactivas).find(x => x.ninera.id === id);

test.describe('sugeridas de pedidos (5.4)', () => {
  test.beforeEach(async ({ page }) => { page.e = await abrirApp(page); });
  test.afterEach(async ({ page }) => { verificarLimpio(page.e); });

  test('no hace sittings: descartada', async ({ page }) => {
    const res = await ordenar(page, {}, { ninieras: [nin('a', { tipo: 'Traslados' }), nin('b')] });
    expect(res.des).toEqual(['a']);
    expect(res.sug).toEqual(['b']);
  });
  test('ocupada: descartada', async ({ page }) => {
    const res = await ordenar(page, {}, { ninieras: [nin('a'), nin('b')], ocupadas: ['a'] });
    expect(res.des).toEqual(['a']);
    expect(res.r.descartadas[0].motivo).toBe('Ya tiene otro servicio en ese horario.');
  });
  test('fuera por temporada: descartada con su motivo', async ({ page }) => {
    const res = await ordenar(page, {}, { ninieras: [nin('a'), nin('b')], fueraTemporada: { a: 'En Punta del Este esa quincena' } });
    expect(res.des).toEqual(['a']);
    expect(res.r.descartadas[0].motivo).toBe('En Punta del Este esa quincena');
  });
  test('inactiva: al fondo (inactivas)', async ({ page }) => {
    const res = await ordenar(page, {}, { ninieras: [nin('a', { activa: false }), nin('b')] });
    expect(res.ina).toEqual(['a']);
    expect(res.sug).toEqual(['b']);
  });
  test('bloque 1 aunque sea de otra zona', async ({ page }) => {
    const res = await ordenar(page, {}, { ninieras: [nin('a', { zona: 'Carrasco' }), nin('b')], historialFamilia: { a: 1 }, historialTotal: { b: 90 } });
    expect(res.sug).toEqual(['a', 'b']);
    expect(item(res, 'a').bloque).toBe(1);
    expect(item(res, 'b').bloque).toBe(2);
  });
  test('bloque 1: la pedida primero', async ({ page }) => {
    const res = await ordenar(page, { ninera_pedida_id: 'b' }, { ninieras: [nin('a'), nin('b')], historialFamilia: { a: 9, b: 5 } });
    expect(res.sug).toEqual(['b', 'a']);
    expect(item(res, 'b').pedida).toBe(true);
    expect(item(res, 'b').porque).toBe('La pidió la madre. Fue 5 veces.');
  });
  test('bloque 1: más veces con la familia arriba', async ({ page }) => {
    const res = await ordenar(page, {}, { ninieras: [nin('a'), nin('b'), nin('c')], historialFamilia: { a: 1, b: 3, c: 2 } });
    expect(res.sug).toEqual(['b', 'c', 'a']);
    expect(item(res, 'b').porque).toBe('Fue 3 veces.');
    expect(item(res, 'a').porque).toBe('Fue 1 vez.');
  });
  test('bloque 2: de la zona del pedido, más sittings arriba', async ({ page }) => {
    const res = await ordenar(page, {}, { ninieras: [nin('a'), nin('b'), nin('c')], historialTotal: { a: 10, b: 31, c: 20 } });
    expect(res.sug).toEqual(['b', 'c', 'a']);
    expect(item(res, 'b').bloque).toBe(2);
    expect(item(res, 'b').porque).toBe('31 sittings.');
  });
  test('bloque 2: a igual sittings, la que cuidó esas edades', async ({ page }) => {
    const res = await ordenar(page, { edades: [4, 7] }, { ninieras: [nin('a'), nin('b'), nin('c')],
      historialTotal: { a: 48, b: 48, c: 48 }, edadesCuidadas: { a: [9], b: [4, 7, 10], c: [4] } });
    expect(res.sug).toEqual(['b', 'c', 'a']);
    expect(item(res, 'b').porque).toBe('48 sittings. Cuidó chicos de 4 y 7 años.');
  });
  test('bloque 2: 3 o más chicos, la que cuidó a varios', async ({ page }) => {
    const res = await ordenar(page, { chicos: 3 }, { ninieras: [nin('a'), nin('b')],
      historialTotal: { a: 20, b: 20 }, maxChicos: { a: 1, b: 3 } });
    expect(res.sug).toEqual(['b', 'a']);
    expect(item(res, 'b').varios).toBe(true);
    // con 2 chicos esa cuenta no se usa: gana el nombre
    const res2 = await ordenar(page, { chicos: 2 }, { ninieras: [nin('a'), nin('b')],
      historialTotal: { a: 20, b: 20 }, maxChicos: { a: 1, b: 3 } });
    expect(res2.sug).toEqual(['a', 'b']);
  });
  test('bloque 3: de otra zona, mismo orden', async ({ page }) => {
    const res = await ordenar(page, { edades: [4] }, { ninieras: [nin('a', { zona: 'Carrasco' }), nin('b', { zona: 'Carrasco' }), nin('c', { zona: 'Carrasco' }), nin('z')],
      historialTotal: { a: 5, b: 40, c: 40, z: 1 }, edadesCuidadas: { c: [4] } });
    expect(res.sug).toEqual(['z', 'c', 'b', 'a']);
    expect(item(res, 'b').bloque).toBe(3);
    expect(item(res, 'b').porque).toBe('40 sittings.');
  });

  // Cada "baja": queda debajo de una del mismo bloque con menos sittings, pero no sale.
  const BAJAS = [
    ['no disponible ese día', { noDisponibles: ['a'] }, 'Marcó que ese día no puede'],
    ['3 No puedo seguidos (2 no baja)', { rechazosSeguidos: { a: 3 } }, '3 "No puedo" seguidos', { rechazosSeguidos: { a: 2 } }],
    ['incidente con esa familia', { incidentesFamilia: ['a'] }, 'Incidente o queja con esta familia'],
    ['prefiere otros perfiles', { preferirOtros: ['a'] }, 'Prefiere otros perfiles con esta familia'],
    ['4 sittings esa semana (3 no baja)', { sittingsSemana: { a: 4 } }, '4 sittings esa semana', { sittingsSemana: { a: 3 } }],
  ];
  for (const [nombre, extra, texto, noBaja] of BAJAS) {
    test('baja: ' + nombre, async ({ page }) => {
      const base = { ninieras: [nin('a'), nin('b')], historialTotal: { a: 50, b: 5 } };
      const res = await ordenar(page, {}, { ...base, ...extra });
      expect(res.sug).toEqual(['b', 'a']);
      expect(item(res, 'a').baja).toBe(true);
      expect(item(res, 'a').bajas).toEqual([texto]);
      expect(item(res, 'a').marcas).toContain(texto);
      if (noBaja) {
        const r2 = await ordenar(page, {}, { ...base, ...noBaja });
        expect(r2.sug).toEqual(['a', 'b']);
        expect(item(r2, 'a').baja).toBe(false);
      }
    });
  }
  test('una que baja en el bloque 1 queda sobre el bloque 2 (no cambia de bloque)', async ({ page }) => {
    const res = await ordenar(page, {}, { ninieras: [nin('a'), nin('b'), nin('c')], historialFamilia: { a: 1, b: 4 }, incidentesFamilia: ['b'], historialTotal: { c: 99 } });
    expect(res.sug).toEqual(['a', 'b', 'c']);
  });

  test('solo conocidas: bloques 2 y 3 en ocultas', async ({ page }) => {
    const datos = { ninieras: [nin('a'), nin('b'), nin('c', { zona: 'Carrasco' })], historialFamilia: { a: 1 } };
    const res = await ordenar(page, { solo_conocidas: true }, datos);
    expect(res.sug).toEqual(['a']);
    expect(res.ocu).toEqual(['b', 'c']);
  });
  test('solo conocidas con mostrar_nuevas: vuelven', async ({ page }) => {
    const datos = { ninieras: [nin('a'), nin('b'), nin('c', { zona: 'Carrasco' })], historialFamilia: { a: 1 } };
    const res = await ordenar(page, { solo_conocidas: true, mostrar_nuevas: true }, datos);
    expect(res.sug).toEqual(['a', 'b', 'c']);
    expect(res.ocu).toEqual([]);
  });

  test('mapasSugeridas suma por id y por nombre normalizado', async ({ page }) => {
    const m = await page.evaluate(() => mapasSugeridas({
      historial: [
        { ninera_id: 'a', ninera_clave: null, veces_familia: 2, total: 10, semana: 1, edades: [3, 5], max_chicos: 2 },
        { ninera_id: null, ninera_clave: 'maria ficticia', veces_familia: 1, total: 4, semana: 2, edades: [5, 8], max_chicos: 3 },
        { ninera_id: null, ninera_clave: 'otra desconocida', veces_familia: 9, total: 9, semana: 9, edades: [], max_chicos: 1 },
      ],
      por_ninera: [
        { ninera_id: 'a', no_puedo_seguidos: 3, incidente_familia: true, no_disponible: false },
        { ninera_id: 'b', no_puedo_seguidos: 0, incidente_familia: false, no_disponible: true },
      ],
    }, [{ id: 'a', nombre: ' María Ficticia ' }, { id: 'b', nombre: 'Bruno Ficticio' }]));
    expect(m.historialFamilia).toEqual({ a: 3 });
    expect(m.historialTotal).toEqual({ a: 14 });
    expect(m.sittingsSemana).toEqual({ a: 3 });
    expect(m.edadesCuidadas).toEqual({ a: [3, 5, 8] });
    expect(m.maxChicos).toEqual({ a: 3 });
    expect(m.rechazosSeguidos).toEqual({ a: 3 });
    expect(m.incidentesFamilia).toEqual(['a']);
    expect(m.noDisponibles).toEqual(['b']);
  });
  // Revisión final (02/11/2026): "Elegir niñeras" también se usa para un traslado; ahí cuenta quién ya los hace.
  test('mapasSugeridas con un traslado toma los traslados (con la familia y en total), no los sittings', async ({ page }) => {
    const [s, t, sinTipo] = await page.evaluate(() => {
      const r = { historial: [
        { ninera_id: 'a', ninera_clave: null, veces_familia: 4, total: 30, veces_familia_traslado: 2, total_traslado: 7, semana: 1, edades: [5], max_chicos: 1 },
        { ninera_id: null, ninera_clave: 'bruno ficticio', veces_familia: 0, total: 3, veces_familia_traslado: 1, total_traslado: 1, semana: 0, edades: [], max_chicos: null },
      ], por_ninera: [] };
      const ns = [{ id: 'a', nombre: 'Ana' }, { id: 'b', nombre: 'Bruno Ficticio' }];
      return [mapasSugeridas(r, ns, 'sitting'), mapasSugeridas(r, ns, 'traslado'), mapasSugeridas(r, ns)];
    });
    expect(s.historialFamilia).toEqual({ a: 4 });
    expect(s.historialTotal).toEqual({ a: 30, b: 3 });
    expect(t.historialFamilia).toEqual({ a: 2, b: 1 });
    expect(t.historialTotal).toEqual({ a: 7, b: 1 });
    // La semana, las edades y los chicos no cambian con el tipo.
    expect(t.sittingsSemana).toEqual({ a: 1 });
    expect(t.edadesCuidadas).toEqual({ a: [5] });
    // Sin tipo, como un sitting.
    expect(sinTipo.historialTotal).toEqual(s.historialTotal);
  });
  test('el porqué de un traslado: "Fue N veces." en el bloque 1 y "N traslados." en el 2 y el 3', async ({ page }) => {
    const datos = { ninieras: [nin('a', { tipo: 'Traslados' }), nin('b', { tipo: 'Ambas' }), nin('c', { tipo: 'Traslados', zona: 'Carrasco' }), nin('d', { tipo: 'Ambas' })],
      historialFamilia: { a: 3 }, historialTotal: { a: 9, b: 1, c: 12 } };
    const res = await ordenar(page, { tipo: 'traslado' }, datos);
    expect(res.sug).toEqual(['a', 'b', 'd', 'c']);
    expect(item(res, 'a').porque).toBe('Fue 3 veces.');
    expect(item(res, 'b').porque).toBe('1 traslado.');
    expect(item(res, 'c').porque).toBe('12 traslados.');
    expect(item(res, 'd').porque).toBe('0 traslados.');
    // Un sitting sigue igual.
    const s = await ordenar(page, {}, { ninieras: [nin('b')], historialTotal: { b: 1 } });
    expect(item(s, 'b').porque).toBe('1 sitting.');
  });
  test('mapasSugeridas con respuesta vacía o nula no rompe', async ({ page }) => {
    const m = await page.evaluate(() => [mapasSugeridas(null, []), mapasSugeridas({}, [{ id: 'a', nombre: 'A' }])]);
    for (const x of m) { expect(x.historialFamilia).toEqual({}); expect(x.incidentesFamilia).toEqual([]); }
  });

  // R1 (controller, 31/10/2026): enviadas, práctica, solo práctica y temporada sin cargar.
  test('enviadas: conservan su lugar, con su estado, y no son enviables', async ({ page }) => {
    const res = await ordenar(page, {}, { ninieras: [nin('a'), nin('b'), nin('c')], historialFamilia: { a: 3, b: 2 },
      enviadas: { a: 'acepto' } });
    expect(res.sug).toEqual(['a', 'b', 'c']);
    expect(item(res, 'a').estadoEnvio).toBe('acepto');
    expect(item(res, 'a').enviable).toBe(false);
    expect(item(res, 'b').estadoEnvio).toBeNull();
    expect(item(res, 'b').enviable).toBe(true);
  });
  test('enviable: sitting, con app y sin enviar; traslado nunca; sin app nunca (con marca)', async ({ page }) => {
    const datos = { ninieras: [nin('a'), nin('b', { user_id: null, tipo: 'Ambas' })] };
    const s = await ordenar(page, {}, datos);
    expect(item(s, 'a').enviable).toBe(true);
    expect(item(s, 'a').conApp).toBe(true);
    expect(item(s, 'b').enviable).toBe(false);
    expect(item(s, 'b').marcas).toContain('sin app');
    const t = await ordenar(page, { tipo: 'traslado' }, datos);
    expect(item(t, 'b').enviable).toBe(false);
  });
  test('práctica: solo se mezcla práctica con práctica, con o sin tilde', async ({ page }) => {
    const datos = { ninieras: [nin('a', { nombre: 'Ana Ficticia (práctica)' }), nin('b', { nombre: ' Bea (PRACTICA) ' }), nin('c')] };
    const p = await ordenar(page, { practica: true }, datos);
    expect(['a', 'b', 'c'].map(i => item(p, i).enviable)).toEqual([true, true, false]);
    const r = await ordenar(page, { practica: false }, datos);
    expect(['a', 'b', 'c'].map(i => item(r, i).enviable)).toEqual([false, false, true]);
  });
  test('soloPractica: con un pedido real nadie es enviable; con uno de práctica sí', async ({ page }) => {
    const datos = { ninieras: [nin('a'), nin('p', { nombre: 'Pía (práctica)' })], soloPractica: true };
    const r = await ordenar(page, { practica: false }, datos);
    expect(item(r, 'a').enviable).toBe(false);
    const p = await ordenar(page, { practica: true }, datos);
    expect(item(p, 'p').enviable).toBe(true);
  });
  test('sin temporada cargada: marca y no baja', async ({ page }) => {
    const res = await ordenar(page, {}, { ninieras: [nin('a'), nin('b')], historialTotal: { a: 50, b: 5 }, sinTemporada: ['a'] });
    expect(res.sug).toEqual(['a', 'b']);
    expect(item(res, 'a').baja).toBe(false);
    expect(item(res, 'a').marcas).toEqual(['sin temporada cargada']);
  });
  test('la Agenda vieja (mapas por nombre normalizado) sigue ordenando', async ({ page }) => {
    const res = await ordenar(page, {}, { ninieras: [nin('a', { nombre: 'Ana Ficticia' }), nin('b', { nombre: 'Bruno Ficticio' })],
      historialFamilia: { 'bruno ficticio': 2 } });
    expect(res.sug).toEqual(['b', 'a']);
  });
});
