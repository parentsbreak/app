// Entrevista (PR 9, 05/10/2026, E6): los bloques del formulario público aparecen siempre en la
// entrevista — precargados y editables si la candidata lo completó, vacíos y editables si no —
// y lo que se escribe ahí llega a la ficha de la niñera, al CV y al contratar.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase, ID } = require('./support/datos');

// Los campos que manda el formulario público (candidatas-webhook), en su orden.
const CAMPOS_FORM = ['disponibilidad', 'bachillerato', 'experiencia', 'universidad', 'cocina', 'idiomas', 'licencia', 'mail', 'cambia_panales', 'dispone_traslados', 'disponible_tipo', 'fechas_punta', 'trabaja_actualmente', 'capacitacion_extra', 'primeros_auxilios', 'comentarios', 'cuenta_bancaria'];
const ficha = page => page.locator('#fichaOrigenBox');
const camposVisibles = page => page.$$eval('#fichaOrigenBox textarea[id^="ent-nota-"]', ts => ts.map(t => t.id.replace('ent-nota-', '')));

async function irAEntrevista(page) {
  await irAModulo(page, 'rrhh');
  await page.locator('[data-rrhhtab="entrevista"]').click();
  await esperarQuieta(page);
}
async function agendar(page, i = 0) {
  await irAModulo(page, 'rrhh');
  await page.evaluate(async n => { await agendarDesdeIntake(n); }, i);
  await esperarQuieta(page);
}
async function puntuarTodo(page) {
  await page.evaluate(() => COMPETENCIAS.forEach(c => document.querySelector(`[data-score="${c.key}:4"]`).click()));
}

test('entrevista que arranca de cero: aparecen todos los campos del formulario, vacíos y editables', async ({ page }) => {
  const e = await abrirApp(page);
  await irAEntrevista(page);
  await expect(ficha(page)).toContainText('No completó el formulario');
  expect(await camposVisibles(page)).toEqual(CAMPOS_FORM);
  for (const k of CAMPOS_FORM) await expect(page.locator(`#ent-nota-${k}`)).toHaveValue('');
  await expect(page.locator('#ent-zonasitting-zonas-checklist')).toBeVisible();
  verificarLimpio(e);
});

test('candidata que completó el formulario: los campos vienen precargados y se pueden editar', async ({ page }) => {
  const datos = datosBase();
  Object.assign(datos.candidatas[0], { origen: 'Form (auto)', edad: null, idiomas: 'Inglés B2', cocina: '4/5', disponibilidad: 'Tardes', cuenta_bancaria: 'Itaú 123456' });
  const e = await abrirApp(page, { datos });
  await agendar(page);
  await expect(ficha(page)).toContainText('arranca con lo que ella puso en el form');
  await expect(page.locator('#ent-nota-experiencia')).toHaveValue('Cuidó primos');
  await expect(page.locator('#ent-nota-idiomas')).toHaveValue('Inglés B2');
  await expect(page.locator('#ent-nota-cuenta_bancaria')).toHaveValue('Itaú 123456');
  await expect(page.locator('#ent-nota-comentarios')).toHaveValue('');
  expect(await camposVisibles(page)).toEqual(CAMPOS_FORM);
  verificarLimpio(e);
});

test('candidata cargada a mano (sin formulario): mismos campos vacíos para completar', async ({ page }) => {
  const datos = datosBase();
  Object.assign(datos.candidatas[0], { origen: 'Recomendación', experiencia: null, edad: null });
  const e = await abrirApp(page, { datos });
  await agendar(page);
  await expect(ficha(page)).toContainText('No completó el formulario');
  expect(await camposVisibles(page)).toEqual(CAMPOS_FORM);
  verificarLimpio(e);
});

test('campos de formularios viejos (edad en texto, patologías) aparecen solo si hay dato', async ({ page }) => {
  const datos = datosBase();
  Object.assign(datos.candidatas[0], { patologias: 'Asma leve' });
  const e = await abrirApp(page, { datos });
  await agendar(page);
  expect(await camposVisibles(page)).toEqual([...CAMPOS_FORM, 'edad', 'patologias']);
  await expect(page.locator('#ent-nota-patologias')).toHaveValue('Asma leve');
  verificarLimpio(e);
});

test('guardar una entrevista de cero: lo escrito en los bloques queda en los campos de la candidata', async ({ page }) => {
  const e = await abrirApp(page);
  await irAEntrevista(page);
  await page.fill('#f-nombre', 'Valeria Desde Cero');
  await page.fill('#ent-nota-idiomas', 'Portugués');
  await page.fill('#ent-nota-licencia', 'Sí');
  await page.fill('#ent-nota-experiencia', 'Cuidó a sus sobrinos');
  await puntuarTodo(page);
  await page.locator('#btnGuardar').click();
  await expect(page.locator('.toaststack .toast').last()).toContainText('Candidata guardada');
  const alta = e.escrituras.find(w => w.tabla === 'candidatas' && w.metodo === 'POST');
  expect(alta.cuerpo).toMatchObject({ nombre: 'Valeria Desde Cero', idiomas: 'Portugués', licencia: 'Sí', experiencia: 'Cuidó a sus sobrinos', estado: 'entrevistada' });
  expect(alta.cuerpo.notas_ficha).toBeUndefined();
  verificarLimpio(e);
});

test('guardar desde el formulario: lo editado va a notas_ficha y la respuesta original no se toca', async ({ page }) => {
  const e = await abrirApp(page);
  await agendar(page);
  await page.fill('#ent-nota-experiencia', 'Cuidó primos y vecinos (dos años)');
  await page.fill('#ent-nota-idiomas', 'Inglés');
  await puntuarTodo(page);
  await page.locator('#btnGuardar').click();
  await expect(page.locator('.toaststack .toast').last()).toContainText('Candidata guardada');
  const upd = e.escrituras.find(w => w.tabla === 'candidatas' && w.metodo === 'PATCH');
  // La edad en texto viejo ("22") también viaja, igual que antes: se guarda lo que quedó en cada caja.
  expect(upd.cuerpo.notas_ficha).toEqual({ experiencia: 'Cuidó primos y vecinos (dos años)', idiomas: 'Inglés', edad: '22' });
  expect(upd.cuerpo.experiencia).toBeUndefined();
  verificarLimpio(e);
});

test('lo corregido en la entrevista se ve en la ficha de la niñera y en el CV', async ({ page }) => {
  const datos = datosBase();
  datos.ninieras[0].candidata_id = ID.cIntake;
  Object.assign(datos.candidatas[0], { estado: 'contratada', notas_ficha: { experiencia: 'Dos años con mellizos', idiomas: 'Francés' } });
  const e = await abrirApp(page, { datos });
  await irAModulo(page, 'ninieras');
  await page.evaluate(id => verNinera(id), ID.nAna);
  await esperarQuieta(page);
  await expect(page.locator('#editmodal')).toContainText('Dos años con mellizos'); // antes: "Cuidó primos"
  await expect(page.locator('#editmodal')).toContainText('Francés');
  await expect(page.locator('#editmodal')).not.toContainText('Cuidó primos');
  await page.evaluate(() => cerrarModal());
  // El CV (01/11/2026, ya no el mensaje para Canva) se precarga con lo corregido.
  await page.evaluate(id => abrirCvNinera(id), ID.nAna);
  await expect(page.locator('#cv-experiencia')).toHaveValue('Dos años con mellizos');
  await expect(page.locator('#cv-idiomas')).toHaveValue('Francés');
  await expect(page.locator('#cv-estado')).not.toContainText('Dibujando');
  verificarLimpio(e);
});

test('editar la niñera guarda lo corregido como dato y limpia las notas de la entrevista', async ({ page }) => {
  const datos = datosBase();
  datos.ninieras[0].candidata_id = ID.cIntake;
  Object.assign(datos.candidatas[0], { estado: 'contratada', notas_ficha: { experiencia: 'Dos años con mellizos' } });
  const e = await abrirApp(page, { datos });
  await irAModulo(page, 'ninieras');
  await page.evaluate(id => { ninTempOmitidas.add(id); editarNinera(id); }, ID.nAna);
  await expect(page.locator('#ed-extra-fields [data-campo="experiencia"]')).toHaveValue('Dos años con mellizos');
  await page.locator('#editmodal button', { hasText: 'Guardar' }).last().click();
  await expect(page.locator('#editmodal')).toHaveCount(0);
  const upd = e.escrituras.find(w => w.tabla === 'candidatas' && w.metodo === 'PATCH');
  expect(upd.cuerpo).toMatchObject({ experiencia: 'Dos años con mellizos', notas_ficha: {} });
  verificarLimpio(e);
});
