// Tanda de bugs antes de la fase 1 (25/10/2026), PR C: puntos 2 y 5.
// 2) "Entrevistó" ya no es una lista fija con dos nombres y "Otra" (Fede tiene cuenta propia y no se
//    podía elegir): viene con el nombre de la cuenta logueada (el mismo del sidebar), se puede
//    cambiar escribiendo y sugiere los nombres ya usados. Las entrevistas viejas conservan lo guardado.
// 5) Los dos buscadores que usaban la lista nativa del navegador ("+ Asignar niñera" en la ficha
//    de la familia y el nombre en Contratos) pasan al autocompletar de la app, que ignora tildes y
//    mayúsculas: "pia fict" encuentra "María Pía Ficticia". Nombres y datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase, ID } = require('./support/datos');

const ENT = 'e7000000-0000-4000-8000-000000000001';
const N_PIA = '30000000-0000-4000-8000-000000000077';
const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && w.metodo === metodo);
const dropdown = (page, id) => page.locator(`#${id}-dropdown .autocomplete-item`);

function conPia(d = datosBase()) {
  d.ninieras.push({ ...d.ninieras[0], id: N_PIA, nombre: 'María Pía Ficticia', telefono: '098000077', temporada_token: '60000000-0000-4000-8000-000000000077' });
  d.ninieras.push({ ...d.ninieras[0], id: '30000000-0000-4000-8000-000000000078', nombre: 'Zoe Inactiva', activa: false, telefono: '098000078', temporada_token: '60000000-0000-4000-8000-000000000078' });
  return d;
}
function entrevista(extra = {}) {
  return {
    id: ENT, candidata_id: ID.cIntake, fecha: '2026-10-03', entrevisto: 'Otra', rol: 'Traslados', puntajes: {}, redflags: {}, referencias: [],
    psico: {}, explicacion_juegos: null, notas: 'Seguir el lunes', total: null, recomendacion: null,
    created_at: '2026-10-03T15:00:00Z', estado: 'en_curso', borrador: {}, actualizado_at: '2026-10-03T15:00:00Z', ...extra,
  };
}
// Entrevistas ya guardadas (completas) con quién las hizo: con un repetido, con tilde y con vacíos.
function conEntrevistadores(d = datosBase()) {
  const base = (id, entrevisto) => entrevista({ id, candidata_id: ID.cIntake, estado: 'completa', entrevisto });
  d.entrevistas = [
    base('e7000000-0000-4000-8000-000000000011', 'Fede Prueba'),
    base('e7000000-0000-4000-8000-000000000012', 'Fede Prueba'),
    base('e7000000-0000-4000-8000-000000000013', 'Inés Ejemplo'),
    base('e7000000-0000-4000-8000-000000000014', 'Otra'),
    base('e7000000-0000-4000-8000-000000000015', ''),
    base('e7000000-0000-4000-8000-000000000016', null),
  ];
  return d;
}
async function irAEntrevista(page) {
  await irAModulo(page, 'rrhh');
  await page.locator('[data-rrhhtab="entrevista"]').click();
  await esperarQuieta(page);
}
const puntuarTodo = page => page.evaluate(() => COMPETENCIAS.forEach(c => document.querySelector(`[data-score="${c.key}:4"]`).click()));

test.describe('Entrevistó', () => {
  test('viene con el nombre de la cuenta logueada y se guarda así; ya no es una lista fija', async ({ page }) => {
    const e = await abrirApp(page);
    await irAEntrevista(page);
    const campo = page.locator('#f-entrevisto');
    await expect(campo).toHaveValue('Prueba'); // el mismo nombre que usa el sidebar (nombreUsuario)
    expect(await campo.evaluate(el => el.tagName)).toBe('INPUT');
    await expect(page.locator('#rrhh-body')).not.toContainText('Paulina G');
    await page.fill('#f-nombre', 'Valeria Desde Cero');
    await puntuarTodo(page);
    await page.locator('#btnGuardar').click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('Candidata guardada');
    expect(escrituras(e, 'entrevistas', 'POST')[0].cuerpo).toMatchObject({ entrevisto: 'Prueba' });
    verificarLimpio(e);
  });

  test('se puede cambiar escribiendo: sugiere los nombres ya usados (sin repetir, sin vacíos, sin tildes) y acepta uno nuevo', async ({ page }) => {
    const e = await abrirApp(page, { datos: conEntrevistadores() });
    await irAEntrevista(page);
    const campo = page.locator('#f-entrevisto');
    await campo.fill('');
    await campo.focus();
    await expect(dropdown(page, 'f-entrevisto')).toHaveText(['Prueba', 'Fede Prueba', 'Inés Ejemplo', 'Otra']); // la cuenta primero, después los ya usados
    await campo.fill('ines');
    await expect(dropdown(page, 'f-entrevisto')).toHaveText(['Inés Ejemplo']);
    await campo.fill('FÉDE');
    await expect(dropdown(page, 'f-entrevisto')).toHaveText(['Fede Prueba']);
    await dropdown(page, 'f-entrevisto').first().click();
    await expect(campo).toHaveValue('Fede Prueba');
    await expect(page.locator('#f-entrevisto-dropdown')).toBeHidden();
    // Un nombre que no está: no hay aviso de "cargar como nueva", se guarda tal cual.
    await campo.fill('Nueva Admin');
    await expect(page.locator('#f-entrevisto-dropdown')).toBeHidden();
    await page.fill('#f-nombre', 'Valeria Desde Cero');
    await puntuarTodo(page);
    await page.locator('#btnGuardar').click();
    await expect(page.locator('.toaststack .toast').last()).toContainText('Candidata guardada');
    expect(escrituras(e, 'entrevistas', 'POST')[0].cuerpo).toMatchObject({ entrevisto: 'Nueva Admin' });
    verificarLimpio(e);
  });

  for (const guardado of ['Otra', '']) {
    test(`al retomar una entrevista vieja con "${guardado || 'vacío'}" no se pisa lo guardado`, async ({ page }) => {
      const d = datosBase();
      d.entrevistas = [entrevista({ entrevisto: guardado })];
      const e = await abrirApp(page, { datos: d });
      await irAModulo(page, 'rrhh');
      await page.evaluate(id => seguirEntrevista(id), ENT);
      await esperarQuieta(page);
      await expect(page.locator('#f-notas')).toHaveValue('Seguir el lunes');
      await expect(page.locator('#f-entrevisto')).toHaveValue(guardado);
      await page.locator('#btnGuardarEnCurso').click();
      await expect(page.locator('.toaststack .toast').last()).toContainText('Entrevista guardada a medias');
      expect(escrituras(e, 'entrevistas', 'PATCH').at(-1).cuerpo).toMatchObject({ entrevisto: guardado });
      verificarLimpio(e);
    });
  }

  test('lo escrito en Entrevistó vuelve con el borrador después de recargar', async ({ page }) => {
    const e = await abrirApp(page, { datos: conEntrevistadores() });
    await irAEntrevista(page);
    await page.fill('#f-nombre', 'Valeria Desde Cero');
    await page.fill('#f-entrevisto', 'fede');
    await dropdown(page, 'f-entrevisto').first().click(); // elegir de la lista también cuenta como cambio
    await page.waitForTimeout(600); // la pausa del borrador
    await page.reload();
    await expect(page.locator('#modcontent')).toBeVisible();
    await esperarQuieta(page);
    await irAEntrevista(page);
    const aviso = page.locator('#entrevista-borrador-aviso');
    await expect(aviso).toContainText('Tenés un borrador');
    await aviso.getByRole('button', { name: 'Seguir' }).click();
    await expect(page.locator('#f-entrevisto')).toHaveValue('Fede Prueba');
    verificarLimpio(e);
  });
});

test.describe('buscadores sin lista nativa', () => {
  test('ficha de la familia: "+ Asignar niñera" encuentra sin tildes ni mayúsculas y guarda el id de la niñera', async ({ page }) => {
    const e = await abrirApp(page, { datos: conPia() });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fDos);
    expect(await page.locator('#editmodal datalist').count()).toBe(0);
    const campo = page.locator(`#asig-nombre-${ID.fDos}`);
    await campo.fill('pia fict');
    await expect(dropdown(page, `asig-nombre-${ID.fDos}`)).toHaveText(['María Pía Ficticia']);
    await dropdown(page, `asig-nombre-${ID.fDos}`).first().click();
    await expect(campo).toHaveValue('María Pía Ficticia');
    await page.locator(`#asig-dias-${ID.fDos} .daybtn`, { hasText: 'V' }).click();
    await page.evaluate(id => setHoraSelect('asig-horaini-'+id, '10:00'), ID.fDos);
    await page.locator('#editmodal button', { hasText: '+ Asignar niñera' }).click();
    await expect(page.locator('.toaststack .toast', { hasText: 'Niñera asignada.' })).toBeVisible();
    const alta = escrituras(e, 'asignaciones', 'POST').at(-1).cuerpo;
    expect(alta).toMatchObject({ familia_id: ID.fDos, ninera_nombre: 'María Pía Ficticia', ninera_id: N_PIA }); // antes quedaba sin id (auditoría 21/10)
    verificarLimpio(e);
  });

  test('ficha de la familia: el nombre escrito entero a mano sigue andando, con su id', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fDos);
    await page.fill(`#asig-nombre-${ID.fDos}`, 'ana ficticia');
    await page.locator(`#asig-dias-${ID.fDos} .daybtn`, { hasText: 'V' }).click();
    await page.evaluate(id => setHoraSelect('asig-horaini-'+id, '10:00'), ID.fDos);
    await page.locator('#editmodal button', { hasText: '+ Asignar niñera' }).click();
    await expect(page.locator('.toaststack .toast', { hasText: 'Niñera asignada.' })).toBeVisible();
    expect(escrituras(e, 'asignaciones', 'POST').at(-1).cuerpo).toMatchObject({ ninera_nombre: 'ana ficticia', ninera_id: ID.nAna });
    verificarLimpio(e);
  });

  test('Contratos: el nombre se busca sin tildes entre las niñeras activas y las familias', async ({ page }) => {
    const e = await abrirApp(page, { datos: conPia() });
    await irAModulo(page, 'legal');
    expect(await page.locator('#modcontent datalist').count()).toBe(0);
    const campo = page.locator('#leg-nombre');
    await campo.fill('pia');
    await expect(dropdown(page, 'leg-nombre')).toHaveText(['María Pía Ficticia']);
    await campo.fill('prueba dos');
    await expect(dropdown(page, 'leg-nombre')).toHaveText(['Familia Prueba Dos']);
    await campo.fill('zoe'); // inactiva: no se ofrece, y sin aviso de "cargar como nueva"
    await expect(page.locator('#leg-nombre-dropdown')).toBeHidden();
    await campo.fill('pia');
    await dropdown(page, 'leg-nombre').first().click();
    await expect(campo).toHaveValue('María Pía Ficticia');
    await page.locator('#modcontent button', { hasText: 'Generar texto del contrato' }).click();
    await expect(page.locator('#leg-texto-generado')).toHaveValue(/María Pía Ficticia/);
    verificarLimpio(e);
  });

  test('a 390 px: la lista de la ficha de la familia entra en la pantalla (captura)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: conPia() });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fDos);
    const campo = page.locator(`#asig-nombre-${ID.fDos}`);
    await campo.scrollIntoViewIfNeeded();
    await campo.fill('pia');
    const lista = page.locator(`#asig-nombre-${ID.fDos}-dropdown`);
    await expect(lista).toBeVisible();
    const caja = await lista.boundingBox();
    expect(caja.x + caja.width).toBeLessThanOrEqual(390);
    await page.locator('#editmodal').screenshot({ path: 'test-results/buscador-familia-390.png' });
    verificarLimpio(e);
  });
});
