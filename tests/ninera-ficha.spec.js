// App de niñeras (fase 1, etapa 8, 02/11/2026): la ficha de la familia y los cambios de horario (decisiones.md 6.5).
// La ficha: "Ficha de la familia" en la tarjeta del día (#sitting/<id>/ficha), precargada con la última de la familia
// sin decir de quién y sin sus casillas, el cuerpo exacto de ninera_guardar_ficha_familia, la propia con sus casillas,
// errores, doble toque, el link, la ficha en el detalle del sitting (y hasta cuándo) y la base sin migrar. Los cambios:
// la tarjeta del inicio ("Ok" / "A esa hora no puedo", el aviso al equipo), un fijo, #cambio/<id>, fallas y doble toque.
// Contra el simulador (tests/support/rpc-ficha.js, la misma regla que la base). Ana tiene un sitting hoy, domingo
// 04/10/2026, de 18:00 a 22:00 en lo de Familia Prueba Uno (Pocitos). Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { errorRpc } = require('./support/rpc-ninera');
const { ID, datosBase } = require('./support/datos');

const RUIDO = { ignorar: [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[ficha\]|\[cambios\]/] };
const SID = '70000000-0000-4000-8000-000000000005';
const OTRO_SITTING = '70000000-0000-4000-8000-0000000000f1';
const CAMBIO = '90000000-0000-4000-8000-0000000000c1';
const CAMPOS = ['direccion', 'chicos', 'tel_madre', 'tel_padre', 'otro_adulto', 'emergencia', 'mutualista', 'alergias', 'medicacion',
  'salud', 'comidas', 'sueno', 'reglas', 'retira', 'otros'];
const CASILLAS = ['c_botiquin', 'c_llaves', 'c_linterna', 'c_telefonos', 'c_medicacion', 'c_adrenalina'];

// La ficha que dejó otra niñera (Carla) el mes pasado en lo de Familia Prueba Uno.
function fichaDeCarla(datos = {}) {
  return { id: '90000000-0000-4000-8000-0000000000f1', familia_id: ID.fUno, sitting_id: OTRO_SITTING, ninera_id: ID.nCarla,
    datos: { direccion: 'Calle Falsa 123, apto 2', tel_madre: '099 000 111', alergias: 'Maní', c_botiquin: true, ...datos },
    creada_en: '2026-09-20T22:00:00Z', actualizada_en: '2026-09-20T22:00:00Z' };
}
function cambio(extra = {}) {
  return { id: CAMBIO, ninera_id: ID.nAna, familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', sitting_id: SID, solicitud_id: null,
    es_fijo: false, desde: '2026-10-06', hora_inicio: '17:00:00', hora_fin: '21:00:00', termina_dia_siguiente: false,
    creado_en: '2026-10-04T12:00:00Z', respuesta: null, respondido_en: null, ...extra };
}

// Ana con el perfil completo y sin PushManager (si no, salen las pantallas de la primera vez y de los avisos).
async function abrir(page, { hora = '17:00', datos = datosBase(), fichas = [fichaDeCarla()], cambios = [], ...opciones } = {}) {
  Object.assign(datos.ninieras.find(n => n.id === ID.nAna), { zona: 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00' });
  datos.fichas_familia = fichas;
  datos.cambios_horario = cambios;
  await page.addInitScript(() => { delete window.PushManager; });
  const ahora = `${hora.includes('T') ? hora : `2026-10-04T${hora}`}:00-03:00`;
  const e = await abrirAppNinera(page, { ...opciones, datos, ahora });
  if (!opciones.ruta) {
    await expect(page.locator('#inicio-dia[data-cargada]')).toBeAttached();
    if (opciones.baseSinMigrar !== 'etapa8') await expect(page.locator('#inicio-cambios[data-cargada]')).toBeAttached();
  }
  return e;
}
const tarjetaDia = page => page.locator(`#inicio-dia .tarjeta-dia[data-sitting="${SID}"]`);
const rpcs = (e, nombre) => e.escrituras.filter(w => w.tabla === `rpc/${nombre}`).map(w => w.cuerpo);
async function abrirFicha(page) {
  await tarjetaDia(page).getByRole('button', { name: 'Ficha de la familia' }).click();
  await expect(page.locator('h1')).toHaveText('Ficha de la familia');
}

test.describe('la ficha de la familia', () => {
  test('en la tarjeta del día, debajo de los botones; precargada con la última de la familia, sin las casillas ni quién la hizo', async ({ page }) => {
    const e = await abrir(page);
    await expect(tarjetaDia(page).locator('.dia-ficha')).toContainText('Repásala con los padres antes de que se vayan.');
    // No se mezcla con los botones de lo que toca según la hora.
    await expect(tarjetaDia(page).locator('.dia-botones button', { hasText: 'Ficha de la familia' })).toHaveCount(0);
    await abrirFicha(page);
    await expect(page.locator('.aviso-info')).toHaveText('Ya viene con lo que sabemos de la familia. Revisa con los padres que siga igual.');
    await expect(page.locator('#ficha-direccion')).toHaveValue('Calle Falsa 123, apto 2');
    await expect(page.locator('#ficha-tel_madre')).toHaveValue('099 000 111');
    await expect(page.locator('#ficha-tel_madre')).toHaveAttribute('type', 'tel');
    await expect(page.locator('#ficha-alergias')).toHaveValue('Maní');
    await expect(page.locator('#ficha-chicos')).toHaveValue('');
    await expect(page.locator('#ficha-c_botiquin')).not.toBeChecked();
    await expect(page.locator('legend')).toHaveText(['La casa', 'Los chicos', 'Contactos', 'Salud', 'Rutina y reglas', 'Antes de que se vayan los padres']);
    await expect(page.locator('main')).not.toContainText('Carla');
    expect(e.lecturasRpc.filter(w => w.tabla === 'rpc/ninera_ficha_familia').map(w => w.cuerpo)).toEqual([{ p_sitting_id: SID }]);
    verificarLimpio(e);
  });

  test('guardar: el cuerpo exacto, "¡Gracias!" y al volver es la suya, con sus casillas', async ({ page }) => {
    const e = await abrir(page);
    await abrirFicha(page);
    await page.fill('#ficha-chicos', '  Juana, 4 años.  ');
    await page.fill('#ficha-alergias', '');
    await page.locator('label.chk', { hasText: 'Tengo ubicada una linterna' }).click();
    await page.getByRole('button', { name: 'Guardar la ficha' }).click();
    await expect(page.locator('.mensaje')).toHaveText('¡Gracias! La ficha quedó guardada.');
    const cuerpo = rpcs(e, 'ninera_guardar_ficha_familia');
    expect(cuerpo).toHaveLength(1);
    expect(cuerpo[0].p_sitting_id).toBe(SID);
    expect(Object.keys(cuerpo[0].p_datos).sort()).toEqual([...CAMPOS, ...CASILLAS].sort());
    expect(cuerpo[0].p_datos).toMatchObject({ direccion: 'Calle Falsa 123, apto 2', chicos: 'Juana, 4 años.', alergias: '', c_linterna: true, c_botiquin: false });
    // La base guarda la de este sitting, sin los vacíos ni las casillas en false; la de Carla queda como estaba.
    const guardada = e.db.fichas_familia.find(f => f.sitting_id === SID);
    expect(guardada).toMatchObject({ familia_id: ID.fUno, ninera_id: ID.nAna, datos: { direccion: 'Calle Falsa 123, apto 2', tel_madre: '099 000 111', chicos: 'Juana, 4 años.', c_linterna: true } });
    expect(guardada.datos).not.toHaveProperty('alergias');
    expect(e.db.fichas_familia.find(f => f.sitting_id === OTRO_SITTING).datos.alergias).toBe('Maní');
    await page.getByRole('button', { name: 'Volver al inicio' }).click();
    await abrirFicha(page);
    await expect(page.locator('.aviso-info')).toHaveText('Ya la guardaste a las 17:00. Puedes corregirla hasta mañana.');
    await expect(page.locator('#ficha-c_linterna')).toBeChecked();
    await expect(page.locator('#ficha-alergias')).toHaveValue('');
    verificarLimpio(e);
  });

  test('sin ficha anterior de la familia: vacía y sin aviso', async ({ page }) => {
    const e = await abrir(page, { fichas: [] });
    await abrirFicha(page);
    await expect(page.locator('.aviso-info')).toHaveCount(0);
    for (const c of CAMPOS) await expect(page.locator(`#ficha-${c}`)).toHaveValue('');
    verificarLimpio(e);
  });

  test('errores de la base: texto largo, sitting que ya no está y sin conexión; lo escrito queda', async ({ page }) => {
    const e = await abrir(page);
    await abrirFicha(page);
    await page.fill('#ficha-otros', 'Un perro que se llama Toby.');
    const guardar = page.getByRole('button', { name: 'Guardar la ficha' });
    e.rpc.ninera_guardar_ficha_familia = () => { throw errorRpc('texto_largo'); };
    await guardar.click();
    await expect(page.locator('#ficha-error')).toHaveText('Algún dato es demasiado largo: hasta 1.000 caracteres.');
    e.rpc.ninera_guardar_ficha_familia = () => { throw errorRpc('no_existe'); };
    await guardar.click();
    await expect(page.locator('#ficha-error')).toHaveText('Este sitting ya no está en tu día. Si algo no está bien, escríbenos por el chat.');
    e.rpc.ninera_guardar_ficha_familia = undefined;
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_guardar_ficha_familia' ? 'red' : null;
    await guardar.click();
    await expect(page.locator('#ficha-error')).toHaveText('No pudimos guardar la ficha. Revisa tu conexión a internet y vuelve a intentar.');
    await expect(page.locator('#ficha-otros')).toHaveValue('Un perro que se llama Toby.');
    verificarLimpio(e, RUIDO);
  });

  test('doble toque en "Guardar la ficha": una sola vez', async ({ page }) => {
    const e = await abrir(page);
    await abrirFicha(page);
    e.demoraEscrituras = 400;
    const guardar = page.getByRole('button', { name: 'Guardar la ficha' });
    await guardar.click();
    await guardar.click({ force: true, timeout: 500 }).catch(() => {});
    await expect(page.locator('.mensaje')).toHaveText('¡Gracias! La ficha quedó guardada.');
    expect(rpcs(e, 'ninera_guardar_ficha_familia')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('si no se puede leer la ficha: "Reintentar" la vuelve a pedir', async ({ page }) => {
    const e = await abrir(page);
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_ficha_familia' ? 'red' : null;
    await tarjetaDia(page).getByRole('button', { name: 'Ficha de la familia' }).click();
    await expect(page.locator('.mensaje')).toHaveText('No pudimos cargar la ficha de la familia. Revisa tu conexión a internet y vuelve a intentar.');
    e.fallar = null;
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.locator('#ficha-direccion')).toHaveValue('Calle Falsa 123, apto 2');
    verificarLimpio(e, RUIDO);
  });

  test('#sitting/<id>/ficha desde un link abre la ficha; un sitting que no es de hoy vuelve al inicio con el aviso', async ({ page }) => {
    const e = await abrir(page, { ruta: `/ninera/#sitting/${SID}/ficha` });
    await expect(page.locator('h1')).toHaveText('Ficha de la familia');
    await expect(page.locator('#ficha-direccion')).toHaveValue('Calle Falsa 123, apto 2');
    await page.evaluate(id => pantallaFichaFamilia(id), OTRO_SITTING);
    await expect(page.locator('.mensaje')).toHaveText('Este sitting ya no está en tu día. Si algo no está bien, escríbenos por el chat.');
    verificarLimpio(e);
  });

  test('en el detalle del sitting: la ficha de la familia, escapada y sin las casillas', async ({ page }) => {
    const e = await abrir(page, { fichas: [fichaDeCarla({ reglas: '<img src=x onerror="window.__ataque=1">Sin pantallas' })] });
    await page.locator('#proximos-sittings-lista .sitting-tarjeta', { hasText: '18:00' }).first().click();
    const ficha = page.locator('#modal-ninera #detalle-ficha');
    await expect(ficha.locator('h3')).toHaveText('Ficha de la familia');
    await expect(ficha).toContainText('Dirección exacta de la casa: Calle Falsa 123, apto 2');
    await expect(ficha).toContainText('Pantallas, golosinas, salidas y otras reglas: <img src=x onerror="window.__ataque=1">Sin pantallas');
    await expect(ficha).not.toContainText('botiquín');
    expect(await page.evaluate(() => window.__ataque)).toBeUndefined();
    verificarLimpio(e);
  });

  test('terminado su sitting ya no ve la ficha de otra niñera; sin ficha, sin la sección', async ({ page }) => {
    const e = await abrir(page, { hora: '22:30' });
    await page.locator('#proximos-sittings-lista .sitting-tarjeta', { hasText: '18:00' }).first().click();
    await expect(page.locator('#modal-ninera .detalle-cuando')).toBeVisible();
    await expect(page.locator('#modal-ninera #detalle-ficha')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('base sin la migración de la etapa 8: ni botón de la ficha ni tarjeta de cambios, y el detalle sin la ficha', async ({ page }) => {
    const e = await abrir(page, { baseSinMigrar: 'etapa8', cambios: [cambio()] });
    await expect(tarjetaDia(page)).toBeVisible();
    await expect(page.locator('.dia-ficha')).toHaveCount(0);
    await expect(page.locator('#inicio-cambios .tarjeta-cambio')).toHaveCount(0);
    await page.locator('#proximos-sittings-lista .sitting-tarjeta', { hasText: '18:00' }).first().click();
    await expect(page.locator('#modal-ninera .detalle-cuando')).toBeVisible();
    await expect(page.locator('#modal-ninera #detalle-ficha')).toHaveCount(0);
    verificarLimpio(e, RUIDO);
  });

  test('a 390 px: la ficha entra en la pantalla (captura)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrir(page);
    await abrirFicha(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/ninera-ficha-390.png', fullPage: true });
    verificarLimpio(e);
  });
});

test.describe('los cambios de horario', () => {
  const tarjetaCambio = page => page.locator(`#cambio-${CAMBIO}`);

  test('la tarjeta arriba del sitting de hoy: el día, el horario y la madre; "Ok" responde y queda el gracias', async ({ page }) => {
    const e = await abrir(page, { cambios: [cambio()] });
    await expect(tarjetaCambio(page).locator('h2')).toHaveText('Cambió el horario de tu sitting');
    await expect(tarjetaCambio(page).locator('.dia-cuando')).toHaveText('Martes 06/10, de 17:00 a 21:00.');
    await expect(tarjetaCambio(page).locator('.helper')).toHaveText('Madre: Familia U., en Pocitos');
    const orden = await page.evaluate(() => [...document.querySelectorAll('main > *')].map(x => x.id).filter(Boolean));
    expect(orden.indexOf('inicio-cambios')).toBeLessThan(orden.indexOf('inicio-dia'));
    await tarjetaCambio(page).getByRole('button', { name: 'Ok' }).click();
    await expect(page.locator('.aviso-cambio')).toHaveText('Listo, gracias por confirmar.');
    await expect(tarjetaCambio(page)).toHaveCount(0);
    expect(rpcs(e, 'ninera_responder_cambio')).toEqual([{ p_cambio_id: CAMBIO, p_ok: true }]);
    expect(e.db.cambios_horario[0].respuesta).toBe(true);
    expect((e.db.avisos || []).filter(a => a.clave.startsWith('admin:cambio:'))).toEqual([]);
    verificarLimpio(e);
  });

  test('"A esa hora no puedo": le avisa al equipo para buscar a otra', async ({ page }) => {
    const e = await abrir(page, { cambios: [cambio()] });
    await tarjetaCambio(page).getByRole('button', { name: 'A esa hora no puedo' }).click();
    await expect(page.locator('.aviso-cambio')).toHaveText('Le avisamos al equipo. Te escribimos si hace falta.');
    expect(rpcs(e, 'ninera_responder_cambio')).toEqual([{ p_cambio_id: CAMBIO, p_ok: false }]);
    const aviso = e.db.avisos.find(a => a.clave === `admin:cambio:${CAMBIO}:no_puede`);
    expect(aviso).toMatchObject({ para_admin: 'todas', tipo: 'el_dia', titulo: 'Ana Ficticia no puede el mar 06/10 de 17:00 a 21:00', cuerpo: 'Buscá a otra.', url: '?ir=agenda' });
    verificarLimpio(e);
  });

  test('un fijo: "Cambió el horario de tu fijo" desde el día; uno que ya pasó o ya respondido no aparece', async ({ page }) => {
    const e = await abrir(page, { cambios: [
      cambio({ es_fijo: true, sitting_id: null, desde: '2026-10-07', hora_inicio: '22:00:00', hora_fin: '02:00:00', termina_dia_siguiente: true }),
      cambio({ id: '90000000-0000-4000-8000-0000000000c2', desde: '2026-10-03' }),
      cambio({ id: '90000000-0000-4000-8000-0000000000c3', respuesta: true }),
    ] });
    await expect(page.locator('#inicio-cambios .tarjeta-cambio')).toHaveCount(1);
    await expect(tarjetaCambio(page).locator('h2')).toHaveText('Cambió el horario de tu fijo');
    await expect(tarjetaCambio(page).locator('.dia-cuando')).toHaveText('Desde el Miércoles 07/10, de 22:00 a 02:00 del día siguiente.');
    verificarLimpio(e);
  });

  test('#cambio/<id> del aviso: la tarjeta a la vista; ya respondido, "Este cambio ya no está pendiente."', async ({ page }) => {
    const e = await abrir(page, { cambios: [cambio()], ruta: `/ninera/#cambio/${CAMBIO}` });
    await expect(tarjetaCambio(page)).toHaveClass(/destacada/);
    expect(new URL(page.url()).hash).toBe('#inicio');
    await tarjetaCambio(page).getByRole('button', { name: 'Ok' }).click();
    await expect(page.locator('.aviso-cambio')).toHaveText('Listo, gracias por confirmar.');
    await page.evaluate(id => { location.hash = `#cambio/${id}`; }, CAMBIO);
    await expect(page.locator('#inicio-cambios .aviso-cambio')).toHaveText('Este cambio ya no está pendiente.');
    verificarLimpio(e);
  });

  test('si responder falla, el aviso queda en la tarjeta; doble toque: una sola respuesta', async ({ page }) => {
    const e = await abrir(page, { cambios: [cambio()] });
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_responder_cambio' ? 'red' : null;
    await tarjetaCambio(page).getByRole('button', { name: 'Ok' }).click();
    await expect(page.locator(`#cambio-error-${CAMBIO}`)).toHaveText('No pudimos enviar tu respuesta. Revisa tu conexión a internet y vuelve a intentar.');
    e.fallar = null;
    e.demoraEscrituras = 400;
    const ok = tarjetaCambio(page).getByRole('button', { name: 'Ok' });
    await ok.click();
    await ok.click({ force: true, timeout: 500 }).catch(() => {});
    await expect(page.locator('.aviso-cambio')).toHaveText('Listo, gracias por confirmar.');
    expect(rpcs(e, 'ninera_responder_cambio')).toHaveLength(1); // la que se cortó no llegó a la base
    verificarLimpio(e, RUIDO);
  });

  test('si leer los cambios falla: el aviso con "Reintentar"', async ({ page }) => {
    const e = await abrir(page, { cambios: [cambio()] });
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_mis_cambios' ? 'red' : null;
    await page.evaluate(() => cargarTarjetaCambios());
    e.fallar = null;
    await expect(page.locator('#inicio-cambios .vacio')).toHaveText('No pudimos cargar los cambios de tus sittings. Revisa tu conexión a internet y vuelve a intentar.');
    await page.locator('#inicio-cambios').getByRole('button', { name: 'Reintentar' }).click();
    await expect(tarjetaCambio(page)).toBeVisible();
    verificarLimpio(e, RUIDO);
  });
});
