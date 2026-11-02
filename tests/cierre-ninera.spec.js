// El panel con el día de la app de niñeras (fase 1, etapa 7, 02/11/2026): "Cierre de los fijos" recibe el cierre que
// mandó la niñera (puntual o fijo, también el de hoy): la hora con la diferencia, el gasto con "¿Quién lo paga?" (recién
// ahí pasa a gastos_extra), los comentarios y cómo le fue; "Sí, terminó [su hora]" recalcula con la tarifa y "Otra hora"
// arranca con su hora. "Sitting en curso" en Hoy con "Contactarla", "Lo que dijeron las niñeras" en la ficha de la
// familia, "Prefiero otros perfiles" en las sugeridas y las preferencias de avisos. Dos admins, fallas, base sin
// migrar, escape y 390 px. Hoy en los tests = domingo 04/10/2026. Ana en Familia Prueba Uno ($380 / $250 por hora,
// sin términos). Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

const RUIDO = { ignorar: [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/] };
const PUNTUAL = 'a7000000-0000-4000-8000-000000000001'; // sábado 03/10 de 16 a 19 (3 h: $1.140 / $750)
const HOY = '70000000-0000-4000-8000-000000000005';     // el de Ana de hoy, de 18 a 22
const COMPROBANTE = `ninieras/${ID.nAna}/${PUNTUAL}.jpg`;
const cierre = (extra = {}) => ({ sitting_id: PUNTUAL, ninera_id: ID.nAna, hora_fin: '19:30:00', termina_dia_siguiente: false,
  comentarios: null, calificacion: null, volveria: null, jugaron: null, comentario_equipo: null, gasto_monto: null, gasto_concepto: null,
  gasto_comprobante: null, gasto_id: null, creado_en: '2026-10-03T22:40:00.000Z', revisado_en: null, revisado_por: null, ...extra });
const conGasto = (extra = {}) => cierre({ gasto_monto: 350, gasto_concepto: 'Taxi de vuelta', gasto_comprobante: COMPROBANTE, ...extra });
function datos({ cierres = [cierre()], fila = {}, eventos = [] } = {}) {
  const d = datosBase();
  d.sittings_traslados.push(sitting(PUNTUAL, '2026-10-03', { estado: 'confirmado', ...fila }));
  d.sitting_cierres = cierres;
  d.sitting_eventos = eventos;
  return d;
}
const tarjeta = page => page.locator('.autoconf-card');
const fila = page => page.locator(`.autoconf-cierre[data-autoconf="${PUNTUAL}"]`);
const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && (!metodo || w.metodo === metodo));
const ultimoToast = page => page.locator('.toaststack .toast').last();

test.describe('"Cierre de los fijos" con el cierre de la niñera', () => {
  test('la fila dice lo que mandó: la hora con la diferencia, comentarios y cómo le fue (sin "Sí a todos" ni fijos automáticos)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [cierre({ comentarios: 'El más chico tuvo fiebre', calificacion: 4, volveria: false,
      jugaron: 'Legos', comentario_equipo: 'No había luz en el baño' })] }) });
    await expect(tarjeta(page).locator('h2')).toHaveText('Cierre de los fijos');
    await expect(tarjeta(page).getByRole('button', { name: 'Sí a todos' })).toHaveCount(0);
    await expect(tarjeta(page).locator('.helper').first()).toHaveText('Lo que mandaron las niñeras al terminar. Confirmá cómo fue cada uno.');
    await expect(fila(page).locator('.cierre-ninera > div')).toHaveText([
      'Ana Ficticia mandó el cierre: terminó a las 19:30 (30 min más que lo previsto).',
      'Comentarios: El más chico tuvo fiebre',
      'Con la familia: ★★★★ de 5. Prefiere otros perfiles.',
      'Jugaron: Legos',
      'Para el equipo: No había luz en el baño',
    ]);
    await expect(fila(page).locator('.autoconf-btns button')).toHaveText(['Sí, terminó 19:30', 'Otra hora', 'Variantes']);
    verificarLimpio(e);
  });

  test('"Sí, terminó 19:30": toma el cierre, recalcula con la tarifa (3 h 30) y sale de la lista', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await fila(page).getByRole('button', { name: 'Sí, terminó 19:30' }).click();
    await expect(ultimoToast(page)).toHaveText('Listo: quedó con la hora de la niñera.');
    await expect(fila(page)).toHaveCount(0);
    const [tomar] = escrituras(e, 'sitting_cierres', 'PATCH');
    expect(tomar.params).toMatchObject({ sitting_id: `eq.${PUNTUAL}`, revisado_en: 'is.null' });
    expect(Object.keys(tomar.cuerpo).sort()).toEqual(['revisado_en', 'revisado_por']);
    const [registro] = escrituras(e, 'sittings_traslados', 'PATCH');
    expect(registro.params).toMatchObject({ id: `eq.${PUNTUAL}`, cobrado: 'eq.false', pagado: 'eq.false' });
    expect(registro.cuerpo).toMatchObject({ hora_fin: '19:30', termina_dia_siguiente: false, cobro_familia: 1330, pago_ninera: 875, generado_automatico: false });
    expect(registro.cuerpo.revisado_at).toBeTruthy();
    expect(escrituras(e, 'gastos_extra')).toEqual([]);
    verificarLimpio(e);
  });

  test('a la misma hora que el registro: solo queda revisado, sin cambiar montos', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [cierre({ hora_fin: '19:00:00' })] }) });
    await fila(page).getByRole('button', { name: 'Sí, terminó 19:00' }).click();
    await expect(fila(page)).toHaveCount(0);
    const [registro] = escrituras(e, 'sittings_traslados', 'PATCH');
    expect(Object.keys(registro.cuerpo).sort()).toEqual(['generado_automatico', 'revisado_at']);
    verificarLimpio(e);
  });

  test('con gasto: hay que elegir quién lo paga; recién ahí pasa a gastos_extra (Parents Break o la familia)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto()] }) });
    await expect(fila(page).locator('.cierre-ninera')).toContainText('Gasto: Taxi de vuelta, $350.');
    await fila(page).getByRole('button', { name: 'Sí, terminó 19:30' }).click();
    await expect(ultimoToast(page)).toHaveText('Elegí quién paga el gasto antes de confirmar.');
    expect(escrituras(e, 'sitting_cierres')).toEqual([]);
    await fila(page).getByLabel('Parents Break').check();
    await fila(page).getByRole('button', { name: 'Sí, terminó 19:30' }).click();
    await expect(ultimoToast(page)).toHaveText('Listo: quedó revisado y el gasto pasó a Por cobrar / Por pagar.');
    const [gasto] = escrituras(e, 'gastos_extra', 'POST');
    expect(gasto.cuerpo).toMatchObject({ sitting_id: PUNTUAL, concepto: 'Taxi de vuelta', monto: 350, pagado_por: 'ninera', comprobante: COMPROBANTE, absorbe_pb: true });
    const vinculo = escrituras(e, 'sitting_cierres', 'PATCH').find(w => 'gasto_id' in w.cuerpo);
    expect(vinculo.cuerpo).toEqual({ gasto_id: e.db.gastos_extra.at(-1).id });
    verificarLimpio(e);
  });

  test('la familia paga el gasto: sin absorbe_pb', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto()] }) });
    await fila(page).getByLabel('La familia').check();
    await fila(page).getByRole('button', { name: 'Sí, terminó 19:30' }).click();
    await expect(fila(page)).toHaveCount(0);
    const [gasto] = escrituras(e, 'gastos_extra', 'POST');
    expect('absorbe_pb' in gasto.cuerpo).toBe(false);
    verificarLimpio(e);
  });

  test('"Ver comprobante" abre el ticket con un link firmado', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto()] }) });
    const popup = page.waitForEvent('popup');
    await fila(page).getByRole('button', { name: 'Ver comprobante' }).click();
    await (await popup).close();
    expect(e.escrituras.map(w => w.tabla)).toContain(`/storage/v1/object/sign/comprobantes/${COMPROBANTE}`);
    verificarLimpio(e);
  });

  test('otra admin ya lo revisó: avisa y no toca el registro', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    e.db.sitting_cierres[0].revisado_en = '2026-10-04T14:00:00.000Z';
    await fila(page).getByRole('button', { name: 'Sí, terminó 19:30' }).click();
    await expect(ultimoToast(page)).toHaveText('Otra admin ya revisó este cierre.');
    expect(escrituras(e, 'sittings_traslados')).toEqual([]);
    await expect(fila(page)).toHaveCount(0);
    verificarLimpio(e);
  });

  test('lo marcaron cobrado mientras tanto: no guarda y el cierre vuelve a quedar sin revisar', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto()] }) });
    e.db.sittings_traslados.find(s => s.id === PUNTUAL).cobrado = true;
    await fila(page).getByLabel('La familia').check();
    await fila(page).getByRole('button', { name: 'Sí, terminó 19:30' }).click();
    await expect(ultimoToast(page)).toHaveText('No se guardó: mientras tanto alguien lo marcó como cobrado o pagado. Corregilo desde Sittings & traslados.');
    expect(e.db.sitting_cierres[0]).toMatchObject({ revisado_en: null, revisado_por: null });
    expect(escrituras(e, 'gastos_extra')).toEqual([]);
    verificarLimpio(e);
  });

  test('si el gasto no se puede cargar, queda revisado y lo dice', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto()] }) });
    e.fallar = ({ tabla }) => tabla === 'gastos_extra' ? { message: 'falla simulada' } : null;
    await fila(page).getByLabel('La familia').check();
    await fila(page).getByRole('button', { name: 'Sí, terminó 19:30' }).click();
    await expect(ultimoToast(page)).toHaveText('Quedó revisado, pero no se pudo cargar el gasto de Ana Ficticia (Taxi de vuelta): cargalo a mano en Sittings & traslados.');
    expect(e.db.sitting_cierres[0].revisado_en).toBeTruthy();
    verificarLimpio(e, RUIDO);
  });

  test('con precio a mano: abre "Otra hora" con la hora de ella y el aviso; Guardar lo revisa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ fila: { precio_motivo: 'descuento', cobro_familia: 1000 } }) });
    await fila(page).getByRole('button', { name: 'Sí, terminó 19:30' }).click();
    await expect(page.locator('#editmodal h2')).toHaveText('¿A qué hora fue?');
    await expect(page.locator('#autoconf-warn')).toHaveText('Este día tiene un precio a mano o variantes: revisá el monto antes de guardar.');
    await expect(page.locator('#autoconf-hf-hh')).toHaveValue('19');
    await expect(page.locator('#autoconf-hf-mm')).toHaveValue('30');
    await page.locator('#editmodal').getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#editmodal.show')).toHaveCount(0);
    expect(escrituras(e, 'sitting_cierres', 'PATCH')).toHaveLength(1);
    expect(escrituras(e, 'sittings_traslados', 'PATCH')[0].cuerpo).toMatchObject({ hora_fin: '19:30' });
    verificarLimpio(e);
  });

  test('"Otra hora" con gasto pide antes quién lo paga', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto()] }) });
    await fila(page).getByRole('button', { name: 'Otra hora' }).click();
    await expect(ultimoToast(page)).toHaveText('Elegí quién paga el gasto antes de confirmar.');
    await expect(page.locator('#editmodal.show')).toHaveCount(0);
    await fila(page).getByLabel('Parents Break').check();
    await fila(page).getByRole('button', { name: 'Otra hora' }).click();
    await page.locator('#editmodal').getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#editmodal.show')).toHaveCount(0);
    expect(escrituras(e, 'gastos_extra', 'POST')[0].cuerpo).toMatchObject({ absorbe_pb: true });
    verificarLimpio(e);
  });

  test('el cierre de un fijo automático va en su misma fila, con la hora de ella', async ({ page }) => {
    const d = datos({ fila: { asignacion_id: ID.aFijo, generado_automatico: true, revisado_at: null } });
    d.app_config = [{ id: 'fijos_automaticos', valor: { activo: true, dias: 14 }, actualizado_at: '2026-10-04T06:00:00Z' }];
    const e = await abrirApp(page, { datos: d });
    await expect(page.locator(`.autoconf-fila[data-autoconf="${PUNTUAL}"]`)).toHaveCount(1);
    await expect(fila(page).getByRole('button', { name: 'Sí, terminó 19:30' })).toBeVisible();
    verificarLimpio(e);
  });

  test('escape: lo que escribió la niñera no ejecuta nada', async ({ page }) => {
    const malo = '<img src=x onerror="window.__xss=1">"\'';
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto({ comentarios: malo, jugaron: malo, comentario_equipo: malo, gasto_concepto: malo })] }) });
    await expect(fila(page).locator('.cierre-ninera')).toContainText('Comentarios: <img');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });

  test('base sin la migración del día: la tarjeta de siempre, sin errores', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos(), baseSinMigrar: 'etapa7' });
    await expect(page.locator('.autoconf-cierre')).toHaveCount(0);
    await expect(page.locator('#dash-en-curso')).toBeEmpty();
    verificarLimpio(e, RUIDO);
  });

  test('390 px: la fila del cierre sin scroll de costado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: datos({ cierres: [conGasto({ comentarios: 'Todo bien, se durmieron temprano', calificacion: 5, volveria: true })] }) });
    await expect(fila(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await fila(page).screenshot({ path: test.info().outputPath('cierre-ninera-390.png') });
    verificarLimpio(e);
  });
});

test.describe('"Sitting en curso" en Hoy', () => {
  function datosHoy(eventos = []) {
    const d = datosBase();
    d.ninieras.find(n => n.id === ID.nAna).user_id = 'e0000000-0000-4000-8000-0000000000a9';
    d.sittings_traslados.find(s => s.id === HOY).familia_nombre = 'Familia Prueba Uno';
    d.sitting_eventos = eventos.map(([tipo, minutos, en]) => ({ id: `e7${tipo}`, sitting_id: HOY, ninera_id: ID.nAna, tipo, minutos, creado_en: en }));
    d.sitting_cierres = [];
    return d;
  }
  const card = page => page.locator('.en-curso-card');

  test('va a llegar tarde: la fila con lo que avisó y "Contactarla" a su WhatsApp', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy([['tarde', 20, '2026-10-04T20:50:00.000Z']]), ahora: '2026-10-04T18:05:00-03:00' });
    await expect(card(page).locator('h2')).toHaveText('Sitting en curso');
    await expect(card(page).locator('.en-curso-txt > div')).toHaveText(['Ana Ficticia en Familia Prueba Uno, 18:00 a 22:00', 'Va a llegar 20 min tarde (avisó a las 17:50).']);
    await expect(card(page).getByRole('link', { name: 'Contactarla' })).toHaveAttribute('href', /^https:\/\/wa\.me\/59898000001/);
    verificarLimpio(e);
  });

  test('15 minutos sin "Ya entré" en un puntual: "No marcó que llegó"; un fijo, no', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy(), ahora: '2026-10-04T18:20:00-03:00' });
    await expect(card(page)).toContainText('No marcó que llegó.');
    verificarLimpio(e);
    const d = datosHoy();
    d.sittings_traslados.find(s => s.id === HOY).asignacion_id = ID.aFijo;
    const e2 = await abrirApp(page, { datos: d, ahora: '2026-10-04T18:20:00-03:00' });
    await expect(page.locator('#dash-en-curso')).toBeEmpty();
    verificarLimpio(e2);
  });

  test('ya entró, o todavía no es la hora: no aparece', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy([['tarde', 10, '2026-10-04T20:50:00.000Z'], ['entre', null, '2026-10-04T21:08:00.000Z']]), ahora: '2026-10-04T18:20:00-03:00' });
    await expect(page.locator('#dash-en-curso')).toBeEmpty();
    verificarLimpio(e);
    const e2 = await abrirApp(page, { datos: datosHoy(), ahora: '2026-10-04T18:10:00-03:00' });
    await expect(page.locator('#dash-en-curso')).toBeEmpty();
    verificarLimpio(e2);
  });

  test('el link del aviso (?ir=hoy&sitting=<id>) abre Hoy con esa fila marcada', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosHoy([['no_abren', null, '2026-10-04T21:02:00.000Z']]), ahora: '2026-10-04T18:05:00-03:00',
      ruta: `/?ir=hoy&sitting=${HOY}` });
    await expect(card(page).locator(`.en-curso-fila.marcada[data-sitting="${HOY}"]`)).toContainText('Está afuera y no le abren (18:02).');
    expect(page.url()).not.toContain('ir=hoy');
    verificarLimpio(e);
  });
});

test.describe('lo demás del panel', () => {
  test('"Lo que dijeron las niñeras" en la ficha de la familia', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [cierre({ calificacion: 5, volveria: true, jugaron: 'Plastilina', comentarios: 'Muy cariñosos' })] }) });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    const sec = page.locator('#fam-dijeron');
    await expect(sec.locator('.card-section-title')).toHaveText('Lo que dijeron las niñeras');
    await expect(sec.locator('.dijeron-fila')).toHaveCount(1);
    await expect(sec.locator('.dijeron-fila')).toContainText('Ana Ficticia, 03/10: ★★★★★ de 5. Volvería.');
    await expect(sec.locator('.dijeron-fila')).toContainText('Jugaron: Plastilina');
    verificarLimpio(e);
  });

  test('sin nada contado o con la base sin migrar, la sección no aparece', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos(), baseSinMigrar: 'etapa7' });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await expect(page.locator('#editmodal.show')).toBeVisible();
    await expect(page.locator('#fam-dijeron')).toBeEmpty();
    verificarLimpio(e, RUIDO);
  });

  test('"Prefiero otros perfiles" llega a las sugeridas (mapasSugeridas → preferirOtros)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos({ cierres: [cierre({ volveria: false })] }) });
    const r = await page.evaluate(async ([fam, ana]) => {
      const { data } = await sb.rpc('sugeridas_datos', { p_familia_id: fam, p_familia_nombre: 'Familia Prueba Uno', p_fecha: '2026-10-10' });
      return { prefiere: data.por_ninera.find(p => p.ninera_id === ana).prefiere_otros, mapa: mapasSugeridas(data, [{ id: ana, nombre: 'Ana Ficticia' }], 'sitting').preferirOtros };
    }, [ID.fUno, ID.nAna]);
    expect(r).toEqual({ prefiere: true, mapa: [ID.nAna] });
    verificarLimpio(e);
  });

  test('las preferencias de avisos suman "El día del sitting" y "Cierres de niñeras"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosBase() });
    await irAModulo(page, 'notificaciones');
    await expect(page.locator('#notifcfg-body')).toContainText('El día del sitting');
    await expect(page.locator('#notifcfg-body')).toContainText('Cierres de niñeras');
    verificarLimpio(e);
  });
});
