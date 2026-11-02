// App de niñeras (fase 1, etapa 4, 02/11/2026): la guía obligatoria y la firma anual. La tarjeta del inicio
// según el estado (nueva, con plazo, la firma por vencer o vencida, al día), el índice, las lecciones ("Ya lo
// leí"), el repaso (todas bien, reintentos libres), la firma con el dedo y el RCP presencial en "Mi perfil".
// Contra el simulador (tests/support/rpc-guia.js, la misma regla que la base). Hoy en el simulador es el
// domingo 04/10/2026 a las 12:00. Ana: sin la guía (guia_firmas: []) salvo donde se dice; tiene sittings
// desde el 14/09. Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { errorRpc } = require('./support/rpc-ninera');
const { CONTENIDO } = require('./support/rpc-guia');
const { ID, datosBase } = require('./support/datos');

const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[guía\]|\[perfil\]/];
const PLATA = /\$\d/;
const PROTOCOLOS = CONTENIDO.modulos.find(m => m.id === 'protocolos');
const AUXILIOS = CONTENIDO.modulos.find(m => m.id === 'auxilios');
const OBLIGATORIAS = [...PROTOCOLOS.lecciones, ...AUXILIOS.lecciones].map(l => l.id);
const FALLA_GUARDAR = 'No pudimos guardarlo. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_SUBIR_FIRMA = 'No pudimos subir tu firma. Revisa tu conexión a internet y vuelve a intentar.';

// Ana con el perfil completo y sin PushManager (si no, salen las pantallas de la primera vez y de los avisos).
// guia: las filas de la guía (por defecto ninguna: le falta toda); activada: app_activada_en.
async function abrir(page, { guia = {}, activada = null, ...opciones } = {}) {
  const datos = opciones.datos || datosBase();
  Object.assign(datos.ninieras.find(n => n.id === ID.nAna), { zona: 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00', app_activada_en: activada });
  datos.guia_firmas = guia.firmas || [];
  datos.guia_progreso = guia.progreso || [];
  datos.guia_repasos = guia.repasos || [];
  await page.addInitScript(() => { delete window.PushManager; });
  const e = await abrirAppNinera(page, { ...opciones, datos });
  if (!opciones.ruta) await expect(page.locator('#inicio-guia[data-cargada]')).toBeAttached();
  return e;
}
const leidas = (ids, en = '2026-10-03T12:00:00.000Z') => ids.map(id => ({ ninera_id: ID.nAna, leccion_id: id, version: '2026.10', leido_en: en }));
const aprobados = (ids, en = '2026-10-03T12:00:00.000Z') => ids.map(id => ({ ninera_id: ID.nAna, modulo_id: id, version: '2026.10', aprobado_en: en }));
const firma = en => ({ id: 'f9200000-0000-4000-8000-000000000001', ninera_id: ID.nAna, version: '2026.10', nombre: 'Ana Ficticia', firma_ruta: `firmas/${ID.nAna}/x.png`, firmado_en: en });
const tarjeta = page => page.locator('#inicio-guia .tarjeta-guia');
const rpcs = (e, nombre) => e.escrituras.filter(w => w.tabla === `rpc/${nombre}`).map(w => w.cuerpo);
const errorForm = page => page.locator('#guia-error');
async function abrirModulo(page, nombre) {
  await page.locator('.guia-modulo', { hasText: nombre }).click();
  await expect(page.locator('h1')).toHaveText(nombre);
}
async function dibujarFirma(page) {
  const caja = await page.locator('#firma-lienzo').boundingBox();
  await page.mouse.move(caja.x + 20, caja.y + 40);
  await page.mouse.down();
  await page.mouse.move(caja.x + 120, caja.y + 90, { steps: 5 });
  await page.mouse.move(caja.x + 200, caja.y + 50, { steps: 5 });
  await page.mouse.up();
}

test.describe('la tarjeta del inicio', () => {
  test('nueva (sin sittings antes de activar la app): "Guía obligatoria", sin pedidos hasta terminarla', async ({ page }) => {
    const e = await abrir(page);
    await expect(tarjeta(page).locator('h2')).toHaveText('Guía obligatoria');
    await expect(tarjeta(page).locator('p')).toHaveText('Antes de tu primer sitting. Lee Protocolos, RCP y primeros auxilios y responde el repaso. Hasta que lo termines no te llegarán pedidos.');
    await expect(tarjeta(page).getByRole('button')).toHaveText('Empezar');
    verificarLimpio(e);
  });

  test('ya trabajaba (sittings antes de activar la app): tiene 7 días, con el último día completo', async ({ page }) => {
    // Activó el 01/10 a las 10:00: el plazo vence el 08/10 a las 10:00, así que el último día completo es el 07/10.
    const e = await abrir(page, { activada: '2026-10-01T13:00:00+00:00' });
    await expect(tarjeta(page).locator('p')).toHaveText('Antes de tu primer sitting. Lee Protocolos, RCP y primeros auxilios y responde el repaso. Tienes hasta el 07/10 para completarla.');
    verificarLimpio(e);
  });

  test('activó la app de noche: la fecha es la de Montevideo, un día antes del vencimiento', async ({ page }) => {
    // 02/10 a las 01:30 UTC es el 01/10 a las 22:30 en Montevideo: vence el 08/10 a las 22:30.
    const e = await abrir(page, { activada: '2026-10-02T01:30:00+00:00' });
    await expect(tarjeta(page).locator('p')).toContainText('Tienes hasta el 07/10 para completarla.');
    verificarLimpio(e);
  });

  test('con algo leído dice "Seguir"', async ({ page }) => {
    const e = await abrir(page, { guia: { progreso: leidas(['pr1']) } });
    await expect(tarjeta(page).getByRole('button')).toHaveText('Seguir');
    verificarLimpio(e);
  });

  test('todo leído y aprobado, sin firmar: "Ya leíste todo" y "Firmar" lleva a la firma', async ({ page }) => {
    const e = await abrir(page, { guia: { progreso: leidas(OBLIGATORIAS), repasos: aprobados(['protocolos', 'auxilios']) } });
    await expect(tarjeta(page).locator('h2')).toHaveText('Ya leíste todo');
    await expect(tarjeta(page).locator('p')).toHaveText('Solo te falta firmar.');
    await tarjeta(page).getByRole('button', { name: 'Firmar' }).click();
    await expect(page.locator('h1')).toHaveText('Firma de la guía');
    verificarLimpio(e);
  });

  test('pasó el año de la firma: "Repasa la guía" con la fecha; vencida la gracia, sin pedidos', async ({ page }) => {
    // Firmó el 30/09/2025: el año se cumplió el 30/09/2026 y la gracia (7 días) va hasta el 07/10.
    const e = await abrir(page, { guia: { firmas: [firma('2025-09-30T15:00:00.000Z')], progreso: leidas(OBLIGATORIAS, '2025-09-29T12:00:00.000Z') } });
    await expect(tarjeta(page).locator('h2')).toHaveText('Repasa la guía');
    await expect(tarjeta(page).locator('p')).toHaveText('Hace un año que hiciste Protocolos y RCP. Repásalos y firma de nuevo antes del 07/10 para seguir recibiendo pedidos.');
    // Lo leído antes de esa firma no cuenta para el ciclo nuevo: en el índice, Protocolos vuelve a 0.
    await tarjeta(page).getByRole('button', { name: 'Repasar' }).click();
    await expect(page.locator('.guia-modulo', { hasText: 'Protocolos' })).toContainText(`0 de ${PROTOCOLOS.lecciones.length} leídas`);
    verificarLimpio(e);
  });

  test('firma vencida y fuera de la gracia', async ({ page }) => {
    const e = await abrir(page, { guia: { firmas: [firma('2025-09-20T15:00:00.000Z')] } });
    await expect(tarjeta(page).locator('p')).toHaveText('Hace un año que hiciste Protocolos y RCP. Hasta que los repases y firmes de nuevo no te llegarán pedidos.');
    verificarLimpio(e);
  });

  test('al día: sin tarjeta; "La guía" en el pie abre el índice', async ({ page }) => {
    const e = await abrir(page, { guia: { firmas: [firma('2026-09-15T15:00:00.000Z')] } });
    await expect(tarjeta(page)).toHaveCount(0);
    await page.locator('#inicio-boton-guia').click();
    await expect(page.locator('h1')).toHaveText('Guía');
    await expect(page.locator('.pantalla-guia')).toContainText('Tu guía está al día.');
    verificarLimpio(e);
  });

  test('si la lectura falla, abrir la guía avisa y el inicio sigue', async ({ page }) => {
    const e = await abrir(page);
    // La falla desde ahora: abrir la guía avisa y queda en el inicio.
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_estado_guia' ? 'red' : null;
    await page.locator('#inicio-boton-guia').click();
    await expect(page.locator('.toaststack .toast').last()).toHaveText('No pudimos abrir la guía. Revisa tu conexión a internet y vuelve a intentar.');
    await expect(page.locator('h1')).toContainText('Hola');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('base sin la migración de la guía: ni tarjeta ni "La guía", y #guia va al inicio', async ({ page }) => {
    const e = await abrir(page, { baseSinMigrar: 'etapa4' });
    await expect(tarjeta(page)).toHaveCount(0);
    await expect(page.locator('#inicio-boton-guia')).toHaveCount(0);
    await page.evaluate(() => irA('#guia'));
    await expect(page.locator('h1')).toContainText('Hola');
    verificarLimpio(e, { ignorar: [/status of 404/] });
  });

  test('el link de un aviso (#guia) abre la guía después de entrar', async ({ page }) => {
    const e = await abrir(page, { ruta: '/ninera/#guia' });
    await expect(page.locator('h1')).toHaveText('Guía');
    verificarLimpio(e);
  });
});

test.describe('índice y lecciones', () => {
  test('los 11 módulos por grupo, Protocolos y RCP obligatorios, con lo leído', async ({ page }) => {
    const e = await abrir(page, { guia: { progreso: leidas(['pr1', 'pr2', 'e1']) } });
    await tarjeta(page).getByRole('button').click();
    await expect(page.locator('.guia-grupo h2')).toHaveText(['Antes de ir', 'Por edad', 'Necesidades especiales']);
    await expect(page.locator('.guia-modulo')).toHaveCount(11);
    await expect(page.locator('.guia-obligatorio')).toHaveCount(2);
    await expect(page.locator('.guia-modulo', { hasText: 'Protocolos' })).toContainText(`2 de ${PROTOCOLOS.lecciones.length} leídas`);
    await expect(page.locator('.guia-modulo', { hasText: 'Bebés' })).toContainText('1 de 5 leídas');
    expect(await page.locator('main').textContent()).not.toMatch(PLATA);
    verificarLimpio(e);
  });

  test('"Ya lo leí" anota la lección (cuerpo exacto) y pasa a la siguiente; la última vuelve al módulo con ✓', async ({ page }) => {
    const e = await abrir(page);
    await tarjeta(page).getByRole('button').click();
    await abrirModulo(page, 'Protocolos');
    await page.locator('.guia-leccion-fila').first().click();
    await expect(page.locator('h1')).toHaveText(PROTOCOLOS.lecciones[0].titulo);
    await expect(page.locator('#guia-leccion li').first()).toBeVisible();
    await page.getByRole('button', { name: 'Ya lo leí' }).click();
    await expect(page.locator('h1')).toHaveText(PROTOCOLOS.lecciones[1].titulo);
    expect(rpcs(e, 'ninera_marcar_leida')).toEqual([{ p_leccion_id: PROTOCOLOS.lecciones[0].id, p_version: '2026.10' }]);
    // La última de Protocolos: vuelve al módulo, con las dos leídas marcadas.
    const ultima = PROTOCOLOS.lecciones[PROTOCOLOS.lecciones.length - 1];
    await page.evaluate(([m, l]) => pantallaLeccionGuia(m, l), ['protocolos', ultima.id]);
    await page.getByRole('button', { name: 'Ya lo leí' }).click();
    await expect(page.locator('h1')).toHaveText('Protocolos');
    await expect(page.locator(`.guia-leccion-fila[data-leccion="${ultima.id}"] .guia-leccion-num`)).toHaveText('✓');
    await expect(page.locator(`.guia-leccion-fila[data-leccion="${PROTOCOLOS.lecciones[0].id}"] .guia-leccion-num`)).toHaveText('✓');
    verificarLimpio(e);
  });

  test('si anotar falla, el aviso queda y la lección sigue; doble toque: una sola vez', async ({ page }) => {
    const e = await abrir(page);
    await page.evaluate(() => pantallaLeccionGuia('protocolos', 'pr1'));
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_marcar_leida' ? 'red' : null;
    await page.getByRole('button', { name: 'Ya lo leí' }).click();
    await expect(errorForm(page)).toHaveText(FALLA_GUARDAR);
    await expect(page.locator('h1')).toHaveText(PROTOCOLOS.lecciones[0].titulo);
    e.fallar = null;
    e.demoraEscrituras = 400;
    await page.getByRole('button', { name: 'Ya lo leí' }).dblclick();
    await expect(page.locator('h1')).toHaveText(PROTOCOLOS.lecciones[1].titulo);
    expect(rpcs(e, 'ninera_marcar_leida')).toHaveLength(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('el HTML de las lecciones se pinta sin nada que se ejecute y los links abren aparte', async ({ page }) => {
    const e = await abrir(page);
    for (const m of CONTENIDO.modulos) {
      for (const l of m.lecciones) {
        await page.evaluate(([mi, li]) => pantallaLeccionGuia(mi, li), [m.id, l.id]);
        await expect(page.locator('h1')).toHaveText(l.titulo);
        const raro = await page.evaluate(() => {
          const art = document.getElementById('guia-leccion');
          const conHandler = [...art.querySelectorAll('*')].some(el => [...el.attributes].some(a => /^on/i.test(a.name)));
          const links = [...art.querySelectorAll('a')];
          return { scripts: art.querySelectorAll('script, iframe, form, input, button').length, conHandler,
            linksMalos: links.filter(a => !a.href.startsWith('https://') || a.target !== '_blank' || a.rel !== 'noopener').length };
        });
        expect(raro, l.id).toEqual({ scripts: 0, conHandler: false, linksMalos: 0 });
      }
    }
    verificarLimpio(e);
  });
});

test.describe('repaso', () => {
  test('mal: "No es esa." con la explicación y el botón gris; todas bien: se aprueba (cuerpo exacto)', async ({ page }) => {
    const e = await abrir(page);
    await page.evaluate(() => pantallaRepasoGuia('protocolos'));
    await expect(page.locator('h1')).toHaveText('Repaso: Protocolos');
    const preguntas = PROTOCOLOS.repaso;
    const boton = page.getByRole('button', { name: 'Terminar el repaso' });
    const mala = preguntas[0].a === 0 ? 1 : 0;
    await page.locator('.guia-pregunta[data-pregunta="0"] .guia-opcion').nth(mala).click();
    await expect(page.locator('#guia-explicacion-0')).toHaveText(`No es esa. ${preguntas[0].e}`);
    await expect(boton).toBeDisabled();
    for (let i = 0; i < preguntas.length; i++) await page.locator(`.guia-pregunta[data-pregunta="${i}"] .guia-opcion`).nth(preguntas[i].a).click();
    await expect(page.locator('#guia-explicacion-0')).toHaveText(`Bien. ${preguntas[0].e}`);
    await expect(boton).toBeEnabled();
    await boton.click();
    await expect(page.locator('.toaststack .toast').last()).toHaveText('¡Repaso aprobado!');
    expect(rpcs(e, 'ninera_aprobar_repaso')).toEqual([{ p_modulo_id: 'protocolos', p_version: '2026.10' }]);
    await expect(page.locator('h1')).toHaveText('Protocolos');
    verificarLimpio(e);
  });

  test('si aprobar falla, el aviso queda y lo respondido sigue', async ({ page }) => {
    const e = await abrir(page);
    await page.evaluate(() => pantallaRepasoGuia('protocolos'));
    for (let i = 0; i < PROTOCOLOS.repaso.length; i++) await page.locator(`.guia-pregunta[data-pregunta="${i}"] .guia-opcion`).nth(PROTOCOLOS.repaso[i].a).click();
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_aprobar_repaso' ? { status: 500, message: 'se cayó' } : null;
    await page.getByRole('button', { name: 'Terminar el repaso' }).click();
    await expect(errorForm(page)).toHaveText(FALLA_GUARDAR);
    await expect(page.locator('.guia-opcion.bien')).toHaveCount(PROTOCOLOS.repaso.length);
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('la firma', () => {
  // Todo leído y Protocolos aprobado: le falta el repaso de RCP.
  const casiTodo = { progreso: leidas(OBLIGATORIAS), repasos: aprobados(['protocolos']) };

  test('el último repaso lleva a la firma; firma con el dedo: sube la imagen del día, firma y puede recibir pedidos', async ({ page }) => {
    const e = await abrir(page, { guia: casiTodo });
    await page.evaluate(() => pantallaRepasoGuia('auxilios'));
    for (let i = 0; i < AUXILIOS.repaso.length; i++) await page.locator(`.guia-pregunta[data-pregunta="${i}"] .guia-opcion`).nth(AUXILIOS.repaso[i].a).click();
    await page.getByRole('button', { name: 'Terminar el repaso' }).click();
    await expect(page.locator('h1')).toHaveText('Firma de la guía');
    // Lo que falta, de a uno.
    const firmar = page.getByRole('button', { name: 'Firmar', exact: true });
    await firmar.click();
    await expect(errorForm(page)).toHaveText('Marca la casilla para confirmar que leíste la guía.');
    await expect(page.locator('.guia-declaracion')).toHaveText("Leí y entendí la guía de Protocolos y RCP y primeros auxilios de Parents' Break.");
    await page.locator('#firma-declaracion').check();
    await page.fill('#firma-nombre', ' A ');
    await firmar.click();
    await expect(errorForm(page)).toHaveText('Escribe tu nombre completo.');
    await page.fill('#firma-nombre', '  Ana   Ficticia ');
    await firmar.click();
    await expect(errorForm(page)).toHaveText('Firma con el dedo en el recuadro.');
    await dibujarFirma(page);
    await firmar.click();
    await expect(page.locator('h1')).toHaveText('¡Listo! Ya puedes recibir pedidos.');
    await expect(page.locator('main')).toContainText('Esta guía no reemplaza un curso presencial de RCP: si hiciste uno, cárgalo en tu perfil.');
    const subida = e.escrituras.filter(w => w.metodo === 'POST' && w.tabla.startsWith('/storage/v1/object/ninieras-privado/'));
    expect(subida.map(w => w.tabla)).toEqual([`/storage/v1/object/ninieras-privado/firmas/${ID.nAna}/2026-10-04.png`]);
    expect(rpcs(e, 'ninera_firmar_guia')).toEqual([{ p_nombre: 'Ana Ficticia', p_version: '2026.10' }]);
    expect(e.db.guia_firmas).toHaveLength(1);
    // De vuelta en el inicio: ya no hay tarjeta.
    await page.getByRole('button', { name: 'Volver al inicio' }).click();
    await expect(page.locator('#inicio-guia[data-cargada]')).toBeAttached();
    await expect(tarjeta(page)).toHaveCount(0);
    verificarLimpio(e);
  });

  test('"Borrar la firma" obliga a firmar de nuevo', async ({ page }) => {
    const e = await abrir(page, { guia: { ...casiTodo, repasos: aprobados(['protocolos', 'auxilios']) } });
    await page.evaluate(() => pantallaFirmaGuia());
    await page.locator('#firma-declaracion').check();
    await page.fill('#firma-nombre', 'Ana Ficticia');
    await dibujarFirma(page);
    await page.getByRole('button', { name: 'Borrar la firma' }).click();
    await page.getByRole('button', { name: 'Firmar', exact: true }).click();
    await expect(errorForm(page)).toHaveText('Firma con el dedo en el recuadro.');
    expect(rpcs(e, 'ninera_firmar_guia')).toEqual([]);
    verificarLimpio(e);
  });

  test('si la subida falla no firma; si la firma falla, avisa; reintentar con doble toque firma una sola vez', async ({ page }) => {
    const e = await abrir(page, { guia: { ...casiTodo, repasos: aprobados(['protocolos', 'auxilios']) } });
    await page.evaluate(() => pantallaFirmaGuia());
    await page.locator('#firma-declaracion').check();
    await page.fill('#firma-nombre', 'Ana Ficticia');
    await dibujarFirma(page);
    const firmar = page.getByRole('button', { name: 'Firmar', exact: true });
    e.fallar = ({ tabla, metodo }) => metodo === 'POST' && tabla.includes('/ninieras-privado/firmas/') ? 'red' : null;
    await firmar.click();
    await expect(errorForm(page)).toHaveText(FALLA_SUBIR_FIRMA);
    expect(rpcs(e, 'ninera_firmar_guia')).toEqual([]);
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_firmar_guia' ? { status: 500, message: 'se cayó' } : null;
    await firmar.click();
    await expect(errorForm(page)).toHaveText(FALLA_GUARDAR);
    e.fallar = null;
    e.demoraEscrituras = 400;
    await firmar.dblclick();
    await expect(page.locator('h1')).toHaveText('¡Listo! Ya puedes recibir pedidos.');
    expect(rpcs(e, 'ninera_firmar_guia')).toHaveLength(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('si la base dice que le falta algo, lo dice', async ({ page }) => {
    const e = await abrir(page, { guia: { ...casiTodo, repasos: aprobados(['protocolos', 'auxilios']) } });
    e.rpc.ninera_firmar_guia = () => { throw errorRpc('guia_incompleta'); };
    await page.evaluate(() => pantallaFirmaGuia());
    await page.locator('#firma-declaracion').check();
    await page.fill('#firma-nombre', 'Ana Ficticia');
    await dibujarFirma(page);
    await page.getByRole('button', { name: 'Firmar', exact: true }).click();
    await expect(errorForm(page)).toHaveText('Te falta terminar Protocolos y RCP antes de firmar.');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('390 px: la lección y la firma sin scroll de costado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrir(page, { guia: { ...casiTodo, repasos: aprobados(['protocolos', 'auxilios']) } });
    await page.evaluate(() => pantallaLeccionGuia('auxilios', 'x3'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('guia-leccion-390.png'), fullPage: true });
    await page.evaluate(() => pantallaFirmaGuia());
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('guia-firma-390.png') });
    verificarLimpio(e);
  });
});

test.describe('RCP presencial en "Mi perfil"', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  async function abrirPerfil(page, opciones) {
    const e = await abrir(page, opciones);
    await page.getByRole('button', { name: 'Mi perfil' }).click();
    await expect(page.locator('h1')).toHaveText('Mi perfil');
    return e;
  }

  test('Sí con la foto del certificado: la sube a su ruta y guarda (cuerpos exactos)', async ({ page }) => {
    const e = await abrirPerfil(page);
    await expect(page.locator('#perfil-rcp-certificado')).toBeHidden();
    await page.locator('#perfil-rcp input[value="si"]').check();
    await expect(page.locator('#perfil-rcp-certificado')).toBeVisible();
    await page.setInputFiles('#perfil-certificado', { name: 'certificado.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('.toaststack .toast').last()).toHaveText('¡Listo! Tu perfil quedó guardado.');
    const subidas = e.escrituras.filter(w => w.metodo === 'POST' && w.tabla.startsWith('/storage/v1/object/ninieras-privado/')).map(w => w.tabla);
    expect(subidas).toEqual([`/storage/v1/object/ninieras-privado/rcp/${ID.nAna}/certificado.jpg`]);
    expect(rpcs(e, 'ninera_guardar_rcp')).toEqual([{ p_presencial: true, p_con_certificado: true }]);
    expect(e.db.ninieras.find(n => n.id === ID.nAna)).toMatchObject({ rcp_presencial: true, rcp_certificado_ruta: `rcp/${ID.nAna}/certificado.jpg` });
    verificarLimpio(e);
  });

  test('No: guarda sin certificado; sin contestar no se toca', async ({ page }) => {
    const e = await abrirPerfil(page);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('.toaststack .toast').last()).toHaveText('¡Listo! Tu perfil quedó guardado.');
    expect(rpcs(e, 'ninera_guardar_rcp')).toEqual([]);
    await page.getByRole('button', { name: 'Mi perfil' }).click();
    await page.locator('#perfil-rcp input[value="no"]').check();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('h1')).toContainText('Hola');
    expect(rpcs(e, 'ninera_guardar_rcp')).toEqual([{ p_presencial: false, p_con_certificado: false }]);
    verificarLimpio(e);
  });

  test('si guardar el RCP falla, el perfil queda guardado y lo dice', async ({ page }) => {
    const e = await abrirPerfil(page);
    await page.locator('#perfil-rcp input[value="si"]').check();
    e.fallar = ({ tabla }) => tabla === 'rpc/ninera_guardar_rcp' ? 'red' : null;
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#perfil-error')).toHaveText('Guardamos tu perfil. Lo del curso de RCP no se guardó: revisa tu conexión a internet y vuelve a intentar.');
    expect(rpcs(e, 'ninera_guardar_perfil')).toHaveLength(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('base sin la migración de la guía: "Mi perfil" sin la pregunta del RCP', async ({ page }) => {
    const e = await abrirPerfil(page, { baseSinMigrar: 'etapa4' });
    await expect(page.locator('#perfil-rcp')).toHaveCount(0);
    verificarLimpio(e, { ignorar: [/status of 404/] });
  });
});
