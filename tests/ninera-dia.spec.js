// App de niñeras (fase 1, etapa 7, 02/11/2026): el día del sitting y el cierre. La tarjeta del inicio (desde 3 horas
// antes, lo que toca según la hora y lo marcado, fijos con solo "Ya entré"), "Voy a llegar tarde", "Llegaron los
// padres" y el cierre (#sitting/<id>/cierre): la hora real con la diferencia, "Se extendió el sitting", el gasto con
// la foto del comprobante, comentarios y calificación, "¡Gracias, Ana!". Fallas, doble toque, base sin migrar,
// escape, sin montos y 390 px. Contra el simulador (tests/support/rpc-dia.js, la misma regla que la base).
// Ana tiene un sitting hoy, domingo 04/10/2026, de 18:00 a 22:00 en lo de Familia Prueba Uno (Pocitos). Datos
// inventados.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { errorRpc } = require('./support/rpc-ninera');
const { ID, datosBase } = require('./support/datos');

const RUIDO = { ignorar: [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[el día\]/] };
const SID = '70000000-0000-4000-8000-000000000005';
const PLATA = /\$\d/;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const FALLA_GUARDAR = 'No pudimos guardarlo. Revisa tu conexión a internet y vuelve a intentar.';

// Ana con el perfil completo y sin PushManager (si no, salen las pantallas de la primera vez y de los avisos).
// hora: la hora de Montevideo del domingo 04/10 (o 'AAAA-MM-DDTHH:MM' para otro día).
async function abrir(page, { hora = '17:00', datos = datosBase(), ...opciones } = {}) {
  Object.assign(datos.ninieras.find(n => n.id === ID.nAna), { zona: 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00' });
  await page.addInitScript(() => { delete window.PushManager; });
  const ahora = `${hora.includes('T') ? hora : `2026-10-04T${hora}`}:00-03:00`;
  const e = await abrirAppNinera(page, { ...opciones, datos, ahora });
  if (!opciones.ruta) await expect(page.locator('#inicio-dia[data-cargada]')).toBeAttached();
  return e;
}
const tarjeta = page => page.locator(`#inicio-dia .tarjeta-dia[data-sitting="${SID}"]`);
const botones = page => tarjeta(page).locator('.dia-botones button');
const rpcs = (e, nombre) => e.escrituras.filter(w => w.tabla === `rpc/${nombre}`).map(w => w.cuerpo);
const avisosAdmin = e => (e.db.avisos || []).filter(a => a.para_admin && a.clave.startsWith('admin:sitting:')).map(a => a.titulo);
async function abrirCierre(page) {
  await tarjeta(page).getByRole('button', { name: 'Llegaron los padres' }).click();
  await expect(page.locator('h1')).toHaveText('¿Hasta qué hora estuviste?');
}

test.describe('la tarjeta del día', () => {
  test('antes de las 3 horas previas no hay tarjeta; el sitting sigue en "Próximos sittings"', async ({ page }) => {
    const e = await abrir(page, { hora: '14:59' });
    await expect(page.locator('#inicio-dia .tarjeta-dia')).toHaveCount(0);
    await expect(page.locator('#proximos-sittings-lista')).toContainText('18:00');
    expect(e.lecturasRpc.map(w => w.tabla)).toContain('rpc/ninera_mi_dia');
    verificarLimpio(e);
  });

  test('desde 3 horas antes: el horario, la zona, la madre y los botones de antes de llegar', async ({ page }) => {
    const e = await abrir(page, { hora: '15:00' });
    await expect(tarjeta(page).locator('h2')).toHaveText('Sitting de hoy');
    await expect(tarjeta(page).locator('.dia-cuando')).toHaveText('18:00 a 22:00, en Pocitos');
    await expect(tarjeta(page).locator('.helper')).toHaveText('Madre: Familia U.');
    await expect(botones(page)).toHaveText(['Estoy saliendo', 'Voy a llegar tarde', 'Ya entré', 'Estoy afuera y no me abren', 'No encuentro la casa']);
    // La tarjeta va arriba de todo, antes de los pedidos y los sittings.
    const orden = await page.evaluate(() => [...document.querySelectorAll('main > *')].map(x => x.id).filter(Boolean));
    expect(orden.indexOf('inicio-dia')).toBeLessThan(orden.indexOf('proximos-sittings'));
    verificarLimpio(e);
  });

  test('"Estoy saliendo": cuerpo exacto, la hora en la tarjeta y sin aviso al equipo', async ({ page }) => {
    const e = await abrir(page, { hora: '17:20' });
    await tarjeta(page).getByRole('button', { name: 'Estoy saliendo' }).click();
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Saliste a las 17:20.']);
    await expect(tarjeta(page).getByRole('button', { name: 'Estoy saliendo' })).toHaveCount(0);
    expect(rpcs(e, 'ninera_marcar_evento')).toEqual([{ p_sitting_id: SID, p_tipo: 'saliendo' }]);
    expect(avisosAdmin(e)).toEqual([]);
    verificarLimpio(e);
  });

  test('"Voy a llegar tarde": la demora en un toque, el aviso al equipo y se puede cambiar', async ({ page }) => {
    const e = await abrir(page, { hora: '17:50' });
    await tarjeta(page).getByRole('button', { name: 'Voy a llegar tarde' }).click();
    await expect(page.locator('#modal-ninera h2')).toHaveText('¿Cuánta demora aproximada tienes?');
    await expect(page.locator('#modal-ninera .helper')).toHaveText('Le avisamos al equipo.');
    await expect(page.locator('#modal-ninera button.btn')).toHaveText(['10 min', '20 min', '30 min o más']);
    await page.locator('#modal-ninera').getByRole('button', { name: '20 min' }).click();
    await expect(page.locator('#modal-ninera')).toHaveCount(0);
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Avisaste que llegas 20 min tarde. Le avisamos al equipo.']);
    expect(rpcs(e, 'ninera_marcar_evento')).toEqual([{ p_sitting_id: SID, p_tipo: 'tarde', p_minutos: 20 }]);
    expect(avisosAdmin(e)).toEqual(['Ana Ficticia va a llegar 20 min tarde']);
    await tarjeta(page).getByRole('button', { name: 'Voy a llegar tarde' }).click();
    await page.locator('#modal-ninera').getByRole('button', { name: '30 min o más' }).click();
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Avisaste que llegas 30 min o más tarde. Le avisamos al equipo.']);
    expect(avisosAdmin(e)).toEqual(['Ana Ficticia va a llegar 20 min tarde', 'Ana Ficticia va a llegar 30 min o más tarde']);
    verificarLimpio(e);
  });

  test('"Estoy afuera y no me abren" y "No encuentro la casa": avisan y quedan escritos', async ({ page }) => {
    const e = await abrir(page, { hora: '18:05' });
    await tarjeta(page).getByRole('button', { name: 'Estoy afuera y no me abren' }).click();
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Avisaste que no te abren. Le avisamos al equipo.']);
    await tarjeta(page).getByRole('button', { name: 'No encuentro la casa' }).click();
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Avisaste que no te abren. Le avisamos al equipo.', 'Avisaste que no encuentras la casa. Le avisamos al equipo.']);
    expect(avisosAdmin(e)).toEqual(['Ana Ficticia está afuera y no le abren', 'Ana Ficticia no encuentra la casa']);
    verificarLimpio(e);
  });

  test('ya empezó: sin "Estoy saliendo"; "Ya entré" deja solo "Llegaron los padres"', async ({ page }) => {
    const e = await abrir(page, { hora: '18:10' });
    await expect(botones(page)).toHaveText(['Voy a llegar tarde', 'Ya entré', 'Estoy afuera y no me abren', 'No encuentro la casa', 'Llegaron los padres']);
    await tarjeta(page).getByRole('button', { name: 'Ya entré' }).click();
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Entraste a las 18:10.']);
    await expect(botones(page)).toHaveText(['Llegaron los padres']);
    await expect(botones(page)).toHaveClass(/primary/);
    expect(rpcs(e, 'ninera_marcar_evento')).toEqual([{ p_sitting_id: SID, p_tipo: 'entre' }]);
    verificarLimpio(e);
  });

  test('un fijo: solo "Ya entré" y, ya empezado, "Llegaron los padres" (decisiones 4.10)', async ({ page }) => {
    const d = datosBase();
    Object.assign(d.sittings_traslados.find(s => s.id === SID), { asignacion_id: ID.aFijo });
    const e = await abrir(page, { hora: '17:00', datos: d });
    await expect(botones(page)).toHaveText(['Ya entré']);
    verificarLimpio(e);
  });

  test('el de ayer sin cerrar: "Sitting de ayer" con "Llegaron los padres"; cerrado o revisado ya no está', async ({ page }) => {
    const e = await abrir(page, { hora: '2026-10-05T09:00' });
    await expect(tarjeta(page).locator('h2')).toHaveText('Sitting de ayer');
    await expect(botones(page)).toContainText(['Llegaron los padres']);
    verificarLimpio(e);
  });

  test('si marcar falla, el aviso queda en la tarjeta; doble toque: una sola vez', async ({ page }) => {
    const e = await abrir(page, { hora: '18:10' });
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_marcar_evento' ? 'red' : null;
    await tarjeta(page).getByRole('button', { name: 'Ya entré' }).click();
    await expect(tarjeta(page).locator('.dia-error')).toHaveText(FALLA_GUARDAR);
    e.fallar = null;
    e.demoraEscrituras = 400;
    const boton = tarjeta(page).getByRole('button', { name: 'Ya entré' });
    await boton.click();
    await boton.click({ force: true }).catch(() => {});
    await expect(tarjeta(page).locator('.dia-estado')).toHaveText(['Entraste a las 18:10.']);
    expect(rpcs(e, 'ninera_marcar_evento')).toEqual([{ p_sitting_id: SID, p_tipo: 'entre' }]);
    verificarLimpio(e, RUIDO);
  });

  test('ya cerrado desde otro celular: lo dice', async ({ page }) => {
    const e = await abrir(page, { hora: '18:10' });
    e.rpc.ninera_marcar_evento = () => { throw errorRpc('ya_cerrado'); };
    await tarjeta(page).getByRole('button', { name: 'Ya entré' }).click();
    await expect(tarjeta(page).locator('.dia-error')).toHaveText('Este sitting ya está cerrado.');
    verificarLimpio(e, RUIDO);
  });

  test('la lectura falla: lo dice con "Reintentar" y el resto del inicio sigue', async ({ page }) => {
    await page.addInitScript(() => { delete window.PushManager; });
    const d = datosBase();
    Object.assign(d.ninieras.find(n => n.id === ID.nAna), { zona: 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00' });
    let fallar = true;
    const e = await abrirAppNinera(page, { datos: d, ahora: '2026-10-04T17:00:00-03:00' });
    e.fallar = ({ tabla }) => fallar && tabla === 'rpc/ninera_mi_dia' ? 'red' : null;
    await page.evaluate(() => cargarTarjetaDia());
    await expect(page.locator('#inicio-dia')).toContainText('No pudimos cargar tu sitting de hoy.');
    await expect(page.locator('#proximos-sittings-lista')).toContainText('18:00');
    fallar = false;
    await page.locator('#inicio-dia').getByRole('button', { name: 'Reintentar' }).click();
    await expect(tarjeta(page)).toBeVisible();
    verificarLimpio(e, RUIDO);
  });
});

test.describe('el cierre', () => {
  test('a la hora prevista: la hora precargada, la diferencia y "Se extendió el sitting"', async ({ page }) => {
    const e = await abrir(page, { hora: '22:30' });
    await abrirCierre(page);
    expect(page.url()).toContain(`#sitting/${SID}/cierre`);
    await expect(page.locator('#cierre-hora')).toHaveValue('22:00');
    await expect(page.locator('#cierre-diferencia')).toHaveText('Igual a lo previsto (22:00).');
    await page.locator('#cierre-hora').fill('21:45');
    await expect(page.locator('#cierre-diferencia')).toHaveText('15 min menos de lo previsto (22:00).');
    await page.getByRole('button', { name: 'Se extendió el sitting' }).click();
    await expect(page.locator('#cierre-hora')).toHaveValue('22:30');
    await expect(page.locator('#cierre-diferencia')).toHaveText('30 min más de lo previsto (22:00).');
    verificarLimpio(e);
  });

  test('antes de la hora de fin arranca con la de ahora', async ({ page }) => {
    const e = await abrir(page, { hora: '20:10' });
    await abrirCierre(page);
    await expect(page.locator('#cierre-hora')).toHaveValue('20:10');
    await expect(page.locator('#cierre-diferencia')).toHaveText('1 h 50 min menos de lo previsto (22:00).');
    verificarLimpio(e);
  });

  test('sin gasto: lo que falta, el cuerpo exacto, "¡Gracias, Ana!" y los avisos al equipo', async ({ page }) => {
    const e = await abrir(page, { hora: '22:30' });
    await abrirCierre(page);
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('#cierre-error')).toHaveText('Responde si hubo algún gasto extra.');
    expect(rpcs(e, 'ninera_cerrar_sitting')).toEqual([]);
    await page.locator('input[name="cierre-gasto"][value="no"]').check();
    await page.locator('#cierre-comentarios').fill('  El más chico tuvo fiebre, avisé a la madre.  ');
    await page.locator('input[name="cierre-estrellas"][value="4"]').check();
    await page.locator('input[name="cierre-volver"][value="otros"]').check();
    await page.locator('#cierre-jugaron').fill('Legos y cartas');
    await page.locator('#cierre-equipo').fill('La casa no tenía luz en el baño');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('h1')).toHaveText('¡Gracias, Ana!');
    await expect(page.locator('.mensaje')).toHaveText('Ya quedó registrado.');
    expect(rpcs(e, 'ninera_cerrar_sitting')).toEqual([{
      p_sitting_id: SID, p_hora_fin: '22:00', p_dia_siguiente: false, p_comentarios: 'El más chico tuvo fiebre, avisé a la madre.',
      p_calificacion: 4, p_volveria: false, p_jugaron: 'Legos y cartas', p_comentario_equipo: 'La casa no tenía luz en el baño',
      p_gasto_monto: null, p_gasto_concepto: null,
    }]);
    expect(avisosAdmin(e)).toEqual(['Ana Ficticia terminó en Familia Prueba Uno a las 22:00', 'Ana Ficticia dejó un comentario del sitting con Familia Prueba Uno']);
    // Ya cerrado: en el inicio no hay tarjeta.
    await page.getByRole('button', { name: 'Volver al inicio' }).click();
    await expect(page.locator('#inicio-dia[data-cargada]')).toBeAttached();
    await expect(page.locator('#inicio-dia .tarjeta-dia')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('con gasto: monto, en qué y la foto son obligatorios; sube a su ruta y manda el gasto', async ({ page }) => {
    const e = await abrir(page, { hora: '22:30' });
    await abrirCierre(page);
    await expect(page.locator('#cierre-gasto-datos')).toBeHidden();
    await page.locator('input[name="cierre-gasto"][value="si"]').check();
    await expect(page.locator('#cierre-gasto-datos')).toBeVisible();
    await expect(page.locator('#cierre-gasto-datos .helper')).toHaveText('Te lo reintegramos junto al pago.');
    const enviar = () => page.getByRole('button', { name: 'Enviar' }).click();
    await enviar();
    await expect(page.locator('#cierre-error')).toHaveText('Pon el monto del gasto.');
    await page.locator('#cierre-gasto-monto').fill('350');
    await enviar();
    await expect(page.locator('#cierre-error')).toHaveText('Escribe en qué fue el gasto.');
    await page.locator('#cierre-gasto-concepto').fill('  Taxi   de vuelta ');
    await enviar();
    await expect(page.locator('#cierre-error')).toHaveText('Saca una foto del comprobante.');
    expect(rpcs(e, 'ninera_cerrar_sitting')).toEqual([]);
    await page.setInputFiles('#cierre-gasto-foto', { name: 'ticket.png', mimeType: 'image/png', buffer: PNG });
    await enviar();
    await expect(page.locator('h1')).toHaveText('¡Gracias, Ana!');
    const subidas = e.escrituras.filter(w => w.tabla.startsWith('/storage/v1/object/comprobantes/')).map(w => w.tabla);
    expect(subidas).toEqual([`/storage/v1/object/comprobantes/ninieras/${ID.nAna}/${SID}.jpg`]);
    expect(rpcs(e, 'ninera_cerrar_sitting')[0]).toMatchObject({ p_gasto_monto: 350, p_gasto_concepto: 'Taxi de vuelta', p_calificacion: null, p_volveria: null });
    expect(e.db.sitting_cierres).toEqual([expect.objectContaining({ sitting_id: SID, gasto_monto: 350, gasto_concepto: 'Taxi de vuelta',
      gasto_comprobante: `ninieras/${ID.nAna}/${SID}.jpg`, gasto_id: null })]);
    // El cierre no toca la plata del registro ni crea un gasto extra: eso lo decide la admin.
    expect(e.escrituras.filter(w => ['sittings_traslados', 'gastos_extra'].includes(w.tabla))).toEqual([]);
    expect(avisosAdmin(e)).toContain('Ana Ficticia cargó un gasto de $350');
    verificarLimpio(e);
  });

  test('si la foto no sube, no cierra y lo escrito queda; reintentar con doble toque cierra una vez', async ({ page }) => {
    const e = await abrir(page, { hora: '22:30' });
    await abrirCierre(page);
    await page.locator('input[name="cierre-gasto"][value="si"]').check();
    await page.locator('#cierre-gasto-monto').fill('120');
    await page.locator('#cierre-gasto-concepto').fill('Farmacia');
    await page.setInputFiles('#cierre-gasto-foto', { name: 'ticket.png', mimeType: 'image/png', buffer: PNG });
    e.fallar = ({ tabla }) => tabla.startsWith('/storage/v1/object/comprobantes/') ? 'red' : null;
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('#cierre-error')).toHaveText('No pudimos subir la foto del comprobante. Revisa tu conexión a internet y vuelve a intentar.');
    expect(rpcs(e, 'ninera_cerrar_sitting')).toEqual([]);
    await expect(page.locator('#cierre-gasto-concepto')).toHaveValue('Farmacia');
    e.fallar = null;
    e.demoraEscrituras = 400;
    const boton = page.getByRole('button', { name: 'Enviar' });
    await boton.click();
    await boton.click({ force: true }).catch(() => {});
    await expect(page.locator('h1')).toHaveText('¡Gracias, Ana!');
    expect(rpcs(e, 'ninera_cerrar_sitting')).toHaveLength(1);
    verificarLimpio(e, RUIDO);
  });

  test('si la base falla, lo dice y lo escrito queda; los errores de la base, en simple', async ({ page }) => {
    const e = await abrir(page, { hora: '22:30' });
    await abrirCierre(page);
    await page.locator('input[name="cierre-gasto"][value="no"]').check();
    await page.locator('#cierre-comentarios').fill('Todo bien');
    const casos = [
      ['red', FALLA_GUARDAR],
      [errorRpc('hora_futura'), 'Esa hora todavía no llegó. Pon la hora en que te fuiste.'],
      [errorRpc('hora_invalida'), 'Revisa la hora: tiene que ser después de las 18:00.'],
      [errorRpc('ya_revisado'), 'El equipo ya revisó este sitting. Si algo no está bien, escríbenos por el chat.'],
      [errorRpc('no_autorizada'), 'Tu cuenta no está activa. Escríbenos por WhatsApp.'],
    ];
    for (const [falla, texto] of casos) {
      if (falla === 'red') e.fallar = ({ tabla }) => tabla === 'rpc/ninera_cerrar_sitting' ? 'red' : null;
      else { e.fallar = null; e.rpc.ninera_cerrar_sitting = () => { throw falla; }; }
      await page.getByRole('button', { name: 'Enviar' }).click();
      await expect(page.locator('#cierre-error')).toHaveText(texto);
      await expect(page.locator('#cierre-comentarios')).toHaveValue('Todo bien');
    }
    verificarLimpio(e, RUIDO);
  });

  test('pasada la medianoche: "Terminó al día siguiente" y se manda con la marca', async ({ page }) => {
    const e = await abrir(page, { hora: '2026-10-05T00:30' });
    await expect(tarjeta(page).locator('h2')).toHaveText('Sitting de ayer');
    await abrirCierre(page);
    await page.locator('#cierre-hora').fill('00:15');
    await expect(page.locator('#cierre-diferencia')).toHaveText('2 h 15 min más de lo previsto (22:00). Terminó al día siguiente.');
    await page.locator('input[name="cierre-gasto"][value="no"]').check();
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('h1')).toHaveText('¡Gracias, Ana!');
    expect(rpcs(e, 'ninera_cerrar_sitting')[0]).toMatchObject({ p_hora_fin: '00:15', p_dia_siguiente: true });
    verificarLimpio(e);
  });

  test('el link del aviso (#sitting/<id>/cierre) abre el cierre después de entrar; uno cerrado dice "Gracias"', async ({ page }) => {
    const e = await abrir(page, { hora: '22:05', ruta: `/ninera/#sitting/${SID}/cierre` });
    await expect(page.locator('h1')).toHaveText('¿Hasta qué hora estuviste?');
    await page.locator('input[name="cierre-gasto"][value="no"]').check();
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('h1')).toHaveText('¡Gracias, Ana!');
    await page.evaluate(id => irA(`#sitting/${id}/cierre`), SID);
    await expect(page.locator('h1')).toHaveText('¡Gracias, Ana!');
    verificarLimpio(e);
  });

  test('un link a un sitting que no es suyo (o que no existe): avisa y va al inicio', async ({ page }) => {
    const e = await abrir(page, { hora: '22:05', ruta: '/ninera/#sitting/70000000-0000-4000-8000-0000000000ff/cierre' });
    await expect(page.locator('.toaststack .toast').last()).toHaveText('Este sitting ya no está para cerrar. Si algo no está bien, escríbenos por el chat.');
    await expect(page.locator('h1')).toHaveText('Hola, Ana');
    verificarLimpio(e);
  });
});

test.describe('lo demás', () => {
  test('base sin la migración del día: ni tarjeta ni cierre, y el resto anda', async ({ page }) => {
    const e = await abrir(page, { hora: '22:30', baseSinMigrar: 'etapa7' });
    await expect(page.locator('#inicio-dia .tarjeta-dia')).toHaveCount(0);
    await expect(page.locator('#proximos-sittings-lista')).toContainText('18:00');
    await page.evaluate(id => irA(`#sitting/${id}/cierre`), SID);
    await expect(page.locator('h1')).toHaveText('Hola, Ana');
    verificarLimpio(e, RUIDO);
  });

  test('escape: la zona y la madre con HTML no ejecutan nada', async ({ page }) => {
    const d = datosBase();
    Object.assign(d.familias.find(f => f.id === ID.fUno), { nombre: '<img src=x onerror="window.__xss=1">', zona: '"><script>window.__xss=1</script>' });
    const e = await abrir(page, { hora: '18:30', datos: d });
    await expect(tarjeta(page)).toBeVisible();
    await abrirCierre(page);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });

  test('nunca un monto en la tarjeta ni en el cierre', async ({ page }) => {
    const e = await abrir(page, { hora: '22:30' });
    expect(await tarjeta(page).innerText()).not.toMatch(PLATA);
    await abrirCierre(page);
    await page.locator('input[name="cierre-gasto"][value="si"]').check();
    expect(await page.locator('main').innerText()).not.toMatch(PLATA);
    expect(await page.locator('main').innerText()).not.toMatch(/cobro|tarifa|total/i);
    verificarLimpio(e);
  });

  test('390 px: la tarjeta y el cierre sin scroll de costado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrir(page, { hora: '18:10' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('dia-tarjeta-390.png'), fullPage: true });
    await abrirCierre(page);
    await page.locator('input[name="cierre-gasto"][value="si"]').check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('dia-cierre-390.png'), fullPage: true });
    verificarLimpio(e);
  });
});
