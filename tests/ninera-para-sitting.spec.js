// App de niñeras (fase 1, etapa 12, 03/11/2026; docs/fase1/etapa12-guia-sitting.md): "Para este sitting". El botón en la
// tarjeta del día (debajo de "Ficha de la familia", solo el sitting de hoy) y en el detalle de "Próximos sittings" (solo
// sittings), la pantalla #sitting/<id>/guia (911 y 1722 con un toque y "Qué hacer" siempre, las lecciones por la edad de
// cada chico, los juegos de su edad, autismo / TDAH / discapacidad según la ficha), lecciones y juegos que vuelven ahí,
// los cortes de edad, sin nombres ni montos, el link, fallas, la base sin migrar, escape, que nada se guarde y 390 px.
// Contra el simulador (tests/support/rpc-ninera.js, columnasParaSitting: la misma regla que la base). Ana tiene un
// sitting hoy, domingo 04/10/2026, de 18:00 a 22:00 en lo de Familia Prueba Uno: Lola (3 años, cargada a mano) y Nico
// (nacido el 15/06/2021: 64 meses en octubre, 5 años). Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { ID, datosBase } = require('./support/datos');

const RUIDO = { ignorar: [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/] };
// Solo en los tests de fallas: el error que la pantalla anota a propósito.
const RUIDO_FALLAS = { ignorar: [...RUIDO.ignorar, /\[para este sitting\]|\[ninera_mis_sittings\]|\[guía\]/] };
const SID = '70000000-0000-4000-8000-000000000005';
const SID_NOVIEMBRE = '70000000-0000-4000-8000-0000000000d2';
const TRASLADO = '70000000-0000-4000-8000-0000000000d1';
const JUEGOS_3_Y_5 = ['Emociones', 'Búsqueda del tesoro', 'Hoy con mi niñera', 'Bingo de la plaza', 'Laberinto', 'Ta-te-ti'];

function ficha(salud) {
  return { id: '90000000-0000-4000-8000-0000000000f1', familia_id: ID.fUno, sitting_id: null, ninera_id: ID.nCarla,
    datos: { salud }, creada_en: '2026-09-20T22:00:00Z', actualizada_en: '2026-09-20T22:00:00Z' };
}

// Ana con el perfil completo y sin PushManager (si no, salen las pantallas de la primera vez y de los avisos).
async function abrir(page, { hora = '17:00', datos = datosBase(), fichas = [], hijos, ...opciones } = {}) {
  Object.assign(datos.ninieras.find(n => n.id === ID.nAna), { zona: 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00' });
  datos.fichas_familia = fichas;
  if (hijos) datos.hijos_familia = hijos;
  await page.addInitScript(() => { delete window.PushManager; });
  const e = await abrirAppNinera(page, { ...opciones, datos, ahora: `2026-10-04T${hora}:00-03:00` });
  if (!opciones.ruta) {
    await expect(page.locator('#inicio-dia[data-cargada]')).toBeAttached();
    await expect(page.locator('#proximos-sittings-lista .sitting-tarjeta').first()).toBeVisible();
  }
  return e;
}
const tarjetaDia = page => page.locator(`#inicio-dia .tarjeta-dia[data-sitting="${SID}"]`);
const bloques = page => page.locator('.para-sitting-bloque h2');
async function abrirDesdeLaTarjeta(page) {
  await tarjetaDia(page).getByRole('button', { name: 'Para este sitting' }).click();
  await expect(page.locator('h1')).toHaveText('Para este sitting');
}
function hijo(id, extra) {
  return { id, familia_id: ID.fUno, nombre: 'Chico Inventado', fecha_nacimiento: null, colegio: null, orden: 0, created_at: '2026-09-01T00:00:00Z',
    edad_declarada: null, edad_declarada_en: null, ...extra };
}

test.describe('Para este sitting', () => {
  test('en la tarjeta del día, debajo de "Ficha de la familia"; la pantalla con emergencias, lo de cada edad y los juegos', async ({ page }) => {
    const e = await abrir(page);
    const botones = tarjetaDia(page).locator('button');
    const textos = await botones.allTextContents();
    expect(textos.indexOf('Para este sitting')).toBe(textos.indexOf('Ficha de la familia') + 1);
    await abrirDesdeLaTarjeta(page);
    expect(new URL(page.url()).hash).toBe(`#sitting/${SID}/guia`);
    await expect(page.locator('main > .helper').first()).toContainText('Hoy, 18:00 a 22:00');
    // Emergencias: llaman con un toque.
    const em = page.locator('.para-sitting-emergencias');
    await expect(em.getByRole('link', { name: 'Llamar al 911' })).toHaveAttribute('href', 'tel:911');
    await expect(em.getByRole('link', { name: 'Intoxicaciones, CIAT: 1722' })).toHaveAttribute('href', 'tel:1722');
    await expect(em.locator('.para-sitting-movil')).toHaveText('Emergencia móvil: la de la familia, anotada en la ficha.');
    await expect(em.getByRole('button', { name: 'Qué hacer: a quién avisar y en qué orden' })).toBeVisible();
    // Lola (3 años, cargada a mano) y Nico (5 años): Preescolares y Edad escolar, sin necesidades.
    await expect(bloques(page)).toHaveText(['Preescolares', 'Edad escolar', 'Juegos']);
    await expect(page.locator('[data-modulo="preescolares"] .helper')).toHaveText('Para el chico de 3 años');
    await expect(page.locator('[data-modulo="escolar"] .helper')).toHaveText('Para el chico de 5 años');
    await expect(page.locator('[data-modulo="escolar"] .guia-leccion-fila b')).toHaveText(['Por qué el juego sigue siendo clave', 'Pantallas durante el sitting', 'Actividades para 5 a 8 años']);
    await expect(page.locator('[data-bloque="juegos"] .guia-leccion-fila b')).toHaveText(JUEGOS_3_Y_5);
    // Nunca los nombres de los chicos ni plata.
    await expect(page.locator('main')).not.toContainText('Lola');
    await expect(page.locator('main')).not.toContainText('Nico');
    await expect(page.locator('main')).not.toContainText('$');
    verificarLimpio(e, RUIDO);
  });

  test('una lección se abre adentro y vuelve; "Ya lo leí" la marca y vuelve a Para este sitting', async ({ page }) => {
    const e = await abrir(page);
    await abrirDesdeLaTarjeta(page);
    await page.locator('[data-modulo="preescolares"] .guia-leccion-fila', { hasText: 'Cómo es un chico de 3 a 4 años' }).click();
    await expect(page.locator('h1')).toHaveText('Cómo es un chico de 3 a 4 años');
    await expect(page.locator('.guia-desde-sitting')).toHaveText('Preescolares, 3 a 5 años');
    expect(new URL(page.url()).hash).toBe(`#sitting/${SID}/guia`);
    await page.getByRole('button', { name: 'Volver a Para este sitting' }).click();
    await expect(page.locator('h1')).toHaveText('Para este sitting');
    await page.locator('[data-modulo="escolar"] .guia-leccion-fila', { hasText: 'Pantallas durante el sitting' }).click();
    await page.getByRole('button', { name: 'Ya lo leí' }).click();
    await expect(page.locator('h1')).toHaveText('Para este sitting');
    expect(e.escrituras.filter(w => w.tabla === 'rpc/ninera_marcar_leida').map(w => w.cuerpo)).toEqual([{ p_leccion_id: 's2', p_version: '2026.10' }]);
    verificarLimpio(e, RUIDO);
  });

  test('"Qué hacer" abre "A quién avisar y en qué orden" y vuelve', async ({ page }) => {
    const e = await abrir(page);
    await abrirDesdeLaTarjeta(page);
    await page.getByRole('button', { name: 'Qué hacer: a quién avisar y en qué orden' }).click();
    await expect(page.locator('h1')).toHaveText('A quién avisar y en qué orden');
    await expect(page.locator('#guia-leccion')).toContainText('911 primero.');
    await page.getByRole('button', { name: 'Volver a Para este sitting' }).click();
    await expect(page.locator('h1')).toHaveText('Para este sitting');
    verificarLimpio(e, RUIDO);
  });

  test('un juego se abre adentro, se juega y vuelve', async ({ page }) => {
    const e = await abrir(page);
    await abrirDesdeLaTarjeta(page);
    await page.locator('[data-juego="tateti"]').click();
    await expect(page.locator('h1')).toHaveText('Ta-te-ti');
    await expect(page.locator('.kitnav')).toHaveCount(0);
    const casillas = page.locator('.ttt button');
    for (const i of [0, 3, 1, 4, 2]) await casillas.nth(i).click();
    await expect(page.locator('.sh-win')).toHaveText('¡Ganó X!');
    await page.getByRole('button', { name: 'Volver a Para este sitting' }).click();
    await expect(page.locator('h1')).toHaveText('Para este sitting');
    verificarLimpio(e, RUIDO);
  });

  test('autismo, TDAH o discapacidad si la ficha lo menciona (solo esos tres, después de los juegos)', async ({ page }) => {
    const e = await abrir(page, { fichas: [ficha('Tiene TEA. Diagnóstico de TDAH desde el año pasado.')] });
    await abrirDesdeLaTarjeta(page);
    await expect(bloques(page)).toHaveText(['Preescolares', 'Edad escolar', 'Juegos', 'Autismo', 'TDAH']);
    await expect(page.locator('[data-modulo="autismo"] .helper')).toHaveText('La ficha de la familia lo menciona.');
    await expect(page.locator('[data-modulo="tdah"] .guia-leccion-fila b')).toHaveText(['Cómo ayudar a un chico con TDAH', 'Ayudarlo a regularse']);
    // El texto de "salud" no se muestra acá.
    await expect(page.locator('main')).not.toContainText('Diagnóstico');
    await page.locator('[data-modulo="autismo"] .guia-leccion-fila').first().click();
    await expect(page.locator('h1')).toHaveText('Cómo se comunican');
    verificarLimpio(e, RUIDO);
  });

  test('los cortes de edad: recién nacido, bebé, edad cargada a mano en 0, toddler y preadolescente', async ({ page }) => {
    // Octubre de 2026: 2 meses (Recién nacidos), 4 meses (Bebés), 0 años cargado a mano (los dos), 23 meses (Toddlers)
    // y 13 años cargados a mano (Preadolescentes).
    const e = await abrir(page, { hijos: [
      hijo('21000000-0000-4000-8000-0000000000a1', { fecha_nacimiento: '2026-08-31', orden: 0 }),
      hijo('21000000-0000-4000-8000-0000000000a2', { fecha_nacimiento: '2026-06-01', orden: 1 }),
      hijo('21000000-0000-4000-8000-0000000000a3', { edad_declarada: 0, edad_declarada_en: '2026-09-01', orden: 2 }),
      hijo('21000000-0000-4000-8000-0000000000a4', { fecha_nacimiento: '2024-11-30', orden: 3 }),
      hijo('21000000-0000-4000-8000-0000000000a5', { edad_declarada: 13, edad_declarada_en: '2026-09-01', orden: 4 }),
    ] });
    await abrirDesdeLaTarjeta(page);
    await expect(bloques(page)).toHaveText(['Recién nacidos', 'Bebés', 'Toddlers', 'Preadolescentes']);
    await expect(page.locator('[data-modulo="recien"] .helper')).toHaveText('Para los chicos de 2 meses y menos de 1 año');
    await expect(page.locator('[data-modulo="bebes"] .helper')).toHaveText('Para los chicos de 4 meses y menos de 1 año');
    await expect(page.locator('[data-modulo="toddlers"] .helper')).toHaveText('Para el chico de 23 meses');
    await expect(page.locator('[data-modulo="preteens"] .helper')).toHaveText('Para el chico de 13 años');
    // 1 año (el de 23 meses) no tiene juegos; 13, ninguno de los del kit pasa de 12: sin el bloque.
    await expect(page.locator('[data-bloque="juegos"]')).toHaveCount(0);
    verificarLimpio(e, RUIDO);
  });

  test('las reglas puras: cortes por meses y por años, juegos por rango y solo las tres necesidades', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(() => ({
      meses: [0, 2, 3, 4, 11, 12, 13, 35, 36, 59, 60, 107, 108, 200].map(m => modulosDeChico({ meses: m, anios: Math.floor(m / 12) }).join('+')),
      anios: [0, 1, 2, 3, 4, 5, 8, 9, 15].map(a => modulosDeChico({ meses: null, anios: a }).join('+')),
      juegos2: juegosPorEdad({ edades_meses: [24] }),
      juegos11: juegosPorEdad({ edades_anios: [11] }),
      juegos13: juegosPorEdad({ edades_anios: [13] }),
      nada: juegosPorEdad({}),
      necesidades: necesidadesSitting({ necesidades: ['<b>otra</b>', 'discapacidad', 'autismo', 'autismo'] }),
      textos: [textoChicosDelModulo([{ meses: 0, anios: 0 }]), textoChicosDelModulo([{ meses: 1, anios: 0 }]), textoChicosDelModulo([{ meses: null, anios: 4 }, { meses: 50, anios: 4 }]),
        textoChicosDelModulo([{ meses: 30, anios: 2 }, { meses: null, anios: 1 }])],
    }));
    // Justo en el corte, los dos (los meses por mes calendario pueden pasarse casi un mes de la edad real).
    expect(r.meses).toEqual(['recien', 'recien', 'recien+bebes', 'bebes', 'bebes', 'bebes+toddlers', 'toddlers', 'toddlers', 'toddlers+preescolares',
      'preescolares', 'preescolares+escolar', 'escolar', 'escolar+preteens', 'preteens']);
    expect(r.anios).toEqual(['recien+bebes', 'toddlers', 'toddlers', 'preescolares', 'preescolares', 'escolar', 'escolar', 'preteens', 'preteens']);
    expect(r.juegos2).toEqual(['emociones']);
    expect(r.juegos11).toEqual(['tateti']);
    expect(r.juegos13).toEqual([]);
    expect(r.nada).toEqual([]);
    expect(r.necesidades).toEqual(['autismo', 'discapacidad']);
    expect(r.textos).toEqual(['Para el chico de menos de 1 mes', 'Para el chico de 1 mes', 'Para los chicos de 4 años', 'Para los chicos de 2 años y 1 año']);
  });

  test('sin edades: los teléfonos, "No tenemos las edades de los chicos." y "Ver toda la guía"', async ({ page }) => {
    const e = await abrir(page, { hijos: [hijo('21000000-0000-4000-8000-0000000000b1', {})] });
    await abrirDesdeLaTarjeta(page);
    await expect(page.locator('.para-sitting-emergencias a')).toHaveCount(2);
    await expect(page.locator('.para-sitting-sin-edades')).toHaveText('No tenemos las edades de los chicos.');
    await expect(bloques(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Ver toda la guía' }).click();
    await expect(page.locator('h1')).toHaveText('Guía');
    verificarLimpio(e, RUIDO);
  });

  test('base sin la migración de la etapa 12: igual abre, con los teléfonos y sin edades', async ({ page }) => {
    const e = await abrir(page, { baseSinMigrar: 'etapa12', fichas: [ficha('autismo')] });
    await abrirDesdeLaTarjeta(page);
    await expect(page.locator('.para-sitting-emergencias a')).toHaveCount(2);
    await expect(page.locator('.para-sitting-sin-edades')).toBeVisible();
    await expect(bloques(page)).toHaveCount(0);
    verificarLimpio(e, RUIDO);
  });

  test('desde "Próximos sittings": el botón en el detalle de un sitting (con las edades de ese mes), nunca en un traslado', async ({ page }) => {
    const datos = datosBase();
    const base = datos.sittings_traslados.find(s => s.id === SID);
    datos.sittings_traslados.push({ ...base, id: TRASLADO, tipo: 'traslado', fecha: '2026-10-10', origen: 'A', destino: 'B' },
      { ...base, id: SID_NOVIEMBRE, fecha: '2026-11-20' });
    const e = await abrir(page, { datos });
    await page.locator('#proximos-sittings-lista .sitting-tarjeta', { hasText: 'Traslado' }).click();
    await expect(page.locator('#modal-ninera')).toBeVisible();
    await expect(page.locator('#modal-ninera').getByRole('button', { name: 'Para este sitting' })).toHaveCount(0);
    await page.locator('#modal-ninera .modal-close').click();
    await page.locator('#proximos-sittings-lista .sitting-tarjeta').filter({ hasText: 'Sitting' }).last().click();
    await page.locator('#modal-ninera').getByRole('button', { name: 'Para este sitting' }).click();
    await expect(page.locator('#modal-ninera')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveText('Para este sitting');
    expect(new URL(page.url()).hash).toBe(`#sitting/${SID_NOVIEMBRE}/guia`);
    await expect(page.locator('main > .helper').first()).toContainText('vie 20/11');
    await expect(bloques(page)).toHaveText(['Preescolares', 'Edad escolar', 'Juegos']);
    await page.getByRole('button', { name: 'Volver' }).last().click();
    await expect(page.locator('#inicio-dia[data-cargada]')).toBeAttached();
    verificarLimpio(e, RUIDO);
  });

  test('sin botón en la tarjeta de un traslado de hoy', async ({ page }) => {
    const datos = datosBase();
    const s = datos.sittings_traslados.find(x => x.id === SID);
    Object.assign(s, { tipo: 'traslado', origen: 'A', destino: 'B' });
    await abrir(page, { datos });
    await expect(page.locator('#inicio-dia .tarjeta-dia')).toContainText('Traslado de hoy');
    await expect(page.locator('#inicio-dia').getByRole('button', { name: 'Para este sitting' })).toHaveCount(0);
  });

  test('el link #sitting/<id>/guia al abrir la app lee sus sittings y abre la pantalla', async ({ page }) => {
    const e = await abrir(page, { ruta: `/ninera/#sitting/${SID}/guia` });
    await expect(page.locator('h1')).toHaveText('Para este sitting');
    await expect(bloques(page)).toHaveText(['Preescolares', 'Edad escolar', 'Juegos']);
    verificarLimpio(e, RUIDO);
  });

  test('un sitting que no es suyo (o ya no está): aviso y al inicio', async ({ page }) => {
    const e = await abrir(page, { ruta: '/ninera/#sitting/70000000-0000-4000-8000-0000000000ee/guia' });
    await expect(page.locator('.toast')).toContainText('Este sitting ya no está en tus próximos sittings.');
    await expect(page.locator('#inicio-dia')).toBeAttached();
    verificarLimpio(e, RUIDO);
  });

  test('falla al leer el sitting o la guía: los teléfonos igual, el aviso y "Reintentar"', async ({ page }) => {
    const e = await abrir(page, { ruta: `/ninera/#sitting/${SID}/guia` });
    await expect(page.locator('h1')).toHaveText('Para este sitting');
    e.fallar = p => p.tabla === 'rpc/ninera_mis_sittings' ? { status: 500, message: 'falla simulada' } : undefined;
    await page.evaluate(() => { sittingsNineraCargados = []; pantallaParaSitting('70000000-0000-4000-8000-000000000005'); });
    await expect(page.locator('.error-form')).toHaveText('No pudimos cargar lo de este sitting. Revisa tu conexión a internet y vuelve a intentar.');
    await expect(page.locator('.para-sitting-emergencias a[href="tel:911"]')).toBeVisible();
    e.fallar = null;
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(bloques(page)).toHaveText(['Preescolares', 'Edad escolar', 'Juegos']);
    // Sin la guía (contenido.json no baja).
    await page.route('**/guia/contenido.json', r => r.abort());
    await page.evaluate(() => { guiaContenidoPromesa = null; pantallaParaSitting('70000000-0000-4000-8000-000000000005'); });
    await expect(page.locator('.error-form')).toBeVisible();
    await expect(page.locator('.para-sitting-emergencias a[href="tel:1722"]')).toBeVisible();
    verificarLimpio(e, RUIDO_FALLAS);
  });

  test('lee de nuevo al abrir: la ficha que cambió recién se ve; si la lectura falla, usa lo ya cargado', async ({ page }) => {
    const e = await abrir(page);
    // La ficha se guardó (por ejemplo desde la misma tarjeta) después de cargar el inicio.
    e.db.fichas_familia.push(ficha('Asperger'));
    await abrirDesdeLaTarjeta(page);
    await expect(bloques(page)).toHaveText(['Preescolares', 'Edad escolar', 'Juegos', 'Autismo']);
    await page.getByRole('button', { name: 'Volver' }).last().click();
    await expect(page.locator('#inicio-dia[data-cargada]')).toBeAttached();
    e.fallar = p => p.tabla === 'rpc/ninera_mis_sittings' ? { status: 500, message: 'falla simulada' } : undefined;
    await abrirDesdeLaTarjeta(page);
    await expect(bloques(page)).toHaveText(['Preescolares', 'Edad escolar', 'Juegos', 'Autismo']);
    await expect(page.locator('.error-form')).toHaveCount(0);
    verificarLimpio(e, RUIDO_FALLAS);
  });

  test('escape: el texto de los chicos de la familia y necesidades raras de la base no se ejecutan', async ({ page }) => {
    const datos = datosBase();
    datos.familias.find(f => f.id === ID.fUno).ninos = '<img src=x onerror="window.__x=1">"\'); alert(1)//';
    const e = await abrir(page, { datos, hijos: [] });
    // Una base que devolviera algo raro en necesidades: solo pasan las tres conocidas.
    const leer = e.rpc.ninera_mis_sittings;
    e.rpc.ninera_mis_sittings = (...a) => leer(...a).map(s => ({ ...s, necesidades: ['<img src=x onerror="window.__x=2">', 'tdah'] }));
    await abrirDesdeLaTarjeta(page);
    await expect(page.locator('main > .helper').first()).toContainText('<img src=x');
    await expect(bloques(page)).toHaveText(['TDAH']);
    expect(await page.evaluate(() => window.__x)).toBeUndefined();
    verificarLimpio(e, RUIDO);
  });

  test('nada se guarda: ni en la base ni en el celular, aunque juegue y escriba en el diario', async ({ page }) => {
    const e = await abrir(page);
    const antes = await page.evaluate(() => ({ local: Object.keys(localStorage).sort(), session: Object.keys(sessionStorage).sort() }));
    const escriturasAntes = e.escrituras.length;
    await abrirDesdeLaTarjeta(page);
    await page.locator('[data-juego="diario"]').click();
    await page.locator('.diary input').first().fill('Texto inventado');
    await page.locator('.dfeel button', { hasText: 'Contento' }).click();
    await page.getByRole('button', { name: 'Volver a Para este sitting' }).click();
    await page.locator('[data-juego="tesoro"]').click();
    await page.locator('.chk button').first().click();
    await page.getByRole('button', { name: 'Volver a Para este sitting' }).click();
    // Volver a abrir el diario: vacío.
    await page.locator('[data-juego="diario"]').click();
    await expect(page.locator('.diary input').first()).toHaveValue('');
    const despues = await page.evaluate(() => ({ local: Object.keys(localStorage).sort(), session: Object.keys(sessionStorage).sort() }));
    expect(despues).toEqual(antes);
    expect(e.escrituras.slice(escriturasAntes).filter(w => !w.tabla.startsWith('rpc/ninera_mis_sittings'))).toEqual([]);
    verificarLimpio(e, RUIDO);
  });

  test('a 390 px: la pantalla entra sin scroll de costado (captura)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrir(page, { fichas: [ficha('autismo')] });
    await abrirDesdeLaTarjeta(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: 'test-results/ninera-para-sitting-390.png', fullPage: true });
    verificarLimpio(e, RUIDO);
  });
});
