const { test, expect } = require('@playwright/test');
const { abrirApp, verificarLimpio } = require('./support/app');
const { ID } = require('./support/datos');

test.describe('sugeridas de pedidos', () => {
  test('prioriza a quien ya conoce la familia y explica el motivo', async ({ page }) => {
    const e = await abrirApp(page);
    const resultado = await page.evaluate(ids => ordenarSugeridas(
      { tipo: 'sitting', zona: 'Pocitos', ninera_pedida_id: ids.ana },
      { ninieras: [
        { id: ids.bruno, nombre: 'Bruno Ficticio', tipo: 'Niñera', zona: 'Pocitos', activa: true },
        { id: ids.ana, nombre: 'Ana Ficticia', tipo: 'Niñera', zona: 'Carrasco', activa: true },
        { id: ids.carla, nombre: 'Carla Ficticia', tipo: 'Niñera', zona: 'Pocitos', activa: true },
      ], historialFamilia: { [ids.ana]: 2 }, historialTotal: { [ids.bruno]: 8, [ids.carla]: 4 } }
    ), { ana: ID.nAna, bruno: ID.nBruno, carla: ID.nCarla });
    expect(resultado.sugeridas.map(x => x.ninera.id)).toEqual([ID.nAna, ID.nBruno, ID.nCarla]);
    expect(resultado.sugeridas[0].motivo).toBe('La pidió la familia.');
    expect(resultado.sugeridas[1].motivo).toContain('cubre Pocitos');
    verificarLimpio(e);
  });

  test('no propone incompatibles u ocupadas y deja las inactivas al final', async ({ page }) => {
    const e = await abrirApp(page);
    const resultado = await page.evaluate(ids => ordenarSugeridas(
      { tipo: 'traslado', zona: 'Pocitos' },
      { ninieras: [
        { id: ids.ana, nombre: 'Ana Ficticia', tipo: 'Niñera', zona: 'Pocitos', activa: true },
        { id: ids.bruno, nombre: 'Bruno Ficticio', tipo: 'Traslados', zona: 'Pocitos', activa: true },
        { id: ids.carla, nombre: 'Carla Ficticia', tipo: 'Traslados', zona: 'Pocitos', activa: false },
      ], ocupadas: [ids.bruno] }
    ), { ana: ID.nAna, bruno: ID.nBruno, carla: ID.nCarla });
    expect(resultado.sugeridas).toEqual([]);
    expect(resultado.inactivas.map(x => x.ninera.id)).toEqual([ID.nCarla]);
    expect(resultado.descartadas.map(x => x.motivo)).toEqual(expect.arrayContaining([
      'No realiza este tipo de servicio.', 'Ya tiene otro servicio en ese horario.',
    ]));
    verificarLimpio(e);
  });
});
