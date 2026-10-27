// Lista de Niñeras (21/10/2026, pedidos de Paulina y Delfina en un video):
// - ordenada por la fecha de la entrevista, de la más nueva a la más vieja; las de antes de la
//   app, sin entrevista, al final;
// - en cada fila, cuántos sittings y traslados viene haciendo (sin cancelados ni previstos);
// - "Editar niñera" con una sola "Fecha de nacimiento" (estaba el calendario y además el texto).
// Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

const C = n => `41000000-0000-4000-8000-00000000000${n}`;
function datos() {
  const d = datosBase();
  const cand = (n, nombre, extra = {}) => ({ ...d.candidatas[0], id: C(n), nombre, apellido: null, estado: 'contratada', ...extra });
  d.candidatas.push(cand(1, 'Ana'), cand(2, 'Bruno'), cand(3, 'Carla', { fecha_nacimiento: '2005-07-05' }));
  d.ninieras.find(n => n.id === ID.nAna).candidata_id = C(1);
  d.ninieras.find(n => n.id === ID.nBruno).candidata_id = C(2);
  d.ninieras.find(n => n.id === ID.nCarla).candidata_id = C(3);
  // Una cuarta, de antes de la app: sin candidata ni entrevista.
  d.ninieras.push({ ...d.ninieras[0], id: '30000000-0000-4000-8000-000000000009', nombre: 'Dora Antigua', candidata_id: null, telefono: '098000009', temporada_token: '60000000-0000-4000-8000-000000000009' });
  d.entrevistas = [
    { id: '42000000-0000-4000-8000-000000000001', candidata_id: C(1), fecha: '2026-03-10', estado: 'completa', created_at: '2026-03-10T12:00:00Z' },
    { id: '42000000-0000-4000-8000-000000000002', candidata_id: C(2), fecha: '2026-09-20', estado: 'completa', created_at: '2026-09-20T12:00:00Z' },
    { id: '42000000-0000-4000-8000-000000000003', candidata_id: C(3), fecha: '2026-06-01', estado: 'completa', created_at: '2026-06-01T12:00:00Z' },
    // Una a medias más nueva de Ana no le cambia la fecha: cuenta la completa.
    { id: '42000000-0000-4000-8000-000000000004', candidata_id: C(1), fecha: '2026-10-01', estado: 'en_curso', created_at: '2026-10-01T12:00:00Z' },
  ];
  // Trabajos: Bruno hace un traslado; Carla tiene uno cancelado (no cuenta).
  d.sittings_traslados.push(
    sitting('71000000-0000-4000-8000-000000000001', '2026-10-02', { ninera_id: ID.nBruno, ninera_nombre: 'Bruno Inventado', tipo: 'traslado', hora_fin: null }),
    sitting('71000000-0000-4000-8000-000000000002', '2026-10-02', { ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', cancelado: true }),
  );
  return d;
}
const nombres = page => page.locator('#ninierasgrid .person-row .name').allInnerTexts();
const fila = (page, nombre) => page.locator('#ninierasgrid .person-row', { hasText: nombre });

test('ordenada por la fecha de la entrevista, de la más nueva a la más vieja; sin entrevista, al final', async ({ page }) => {
  const e = await abrirApp(page, { datos: datos() });
  await irAModulo(page, 'ninieras');
  expect(await nombres(page)).toEqual(['Bruno Inventado', 'Carla Ejemplo', 'Ana Ficticia', 'Dora Antigua']);
  // Filtrando, mantiene el mismo orden.
  await page.selectOption('#filt-tipo', 'Niñera');
  expect(await nombres(page)).toEqual(['Ana Ficticia', 'Dora Antigua']);
  verificarLimpio(e);
});

test('cada fila dice cuántos sittings y traslados viene haciendo (sin cancelados)', async ({ page }) => {
  const d = datos();
  // El previsto de mañana de Ana (datos.js, etapa 2) solo existe con los fijos automáticos
  // prendidos, como en producción: con la marca, la lista no lo cuenta.
  d.app_config = [...d.app_config, { id: 'fijos_automaticos', valor: { activo: true, dias: 14 }, actualizado_at: '2026-10-04T06:00:00Z' }];
  const e = await abrirApp(page, { datos: d });
  await irAModulo(page, 'ninieras');
  const deAna = d.sittings_traslados.filter(r => r.ninera_id === ID.nAna && !r.cancelado && r.estado !== 'previsto' && r.tipo === 'sitting').length;
  expect(deAna).toBeGreaterThan(1);
  await expect(fila(page, 'Ana Ficticia').locator('.nin-trabajos')).toHaveText(`${deAna} sittings`);
  const deBruno = d.sittings_traslados.filter(r => r.ninera_id === ID.nBruno && !r.cancelado && r.tipo === 'traslado').length;
  await expect(fila(page, 'Bruno Inventado').locator('.nin-trabajos')).toContainText(`${deBruno} traslado`);
  await expect(fila(page, 'Carla Ejemplo').locator('.nin-trabajos')).toHaveText('Sin sittings todavía');
  verificarLimpio(e);
});

test('si no se pueden leer las entrevistas, la lista sale igual, por nombre', async ({ page }) => {
  const e = await abrirApp(page, { datos: datos() });
  await page.route(/\/rest\/v1\/entrevistas/, r => r.fulfill({ status: 500, json: { message: 'falla simulada' } }));
  await irAModulo(page, 'ninieras');
  expect(await nombres(page)).toEqual(['Ana Ficticia', 'Bruno Inventado', 'Carla Ejemplo', 'Dora Antigua']);
  verificarLimpio(e, { ignorar: [/status of 500/] });
});

test('"Editar niñera": una sola "Fecha de nacimiento" (el calendario), y se guarda', async ({ page }) => {
  const e = await abrirApp(page, { datos: datos() });
  await irAModulo(page, 'ninieras');
  await page.evaluate(id => { ninTempOmitidas.add(id); editarNinera(id); }, ID.nCarla);
  const modal = page.locator('#editmodal');
  await expect(modal.locator('label', { hasText: /^Fecha de nacimiento$/ })).toHaveCount(1);
  await expect(modal.locator('#ed-fecha-nac')).toHaveValue('2005-07-05');
  await expect(modal.locator('[data-campo="fecha_nacimiento"]')).toHaveCount(0);
  await modal.locator('#ed-fecha-nac').fill('2005-07-06');
  await modal.getByRole('button', { name: /^Guardar/ }).last().click();
  await expect(modal).toHaveCount(0);
  const w = e.escrituras.filter(x => x.tabla === 'candidatas' && x.metodo === 'PATCH').at(-1);
  expect(w.cuerpo).toMatchObject({ fecha_nacimiento: '2005-07-06' });
  verificarLimpio(e);
});

test('celular de 390 px: las filas entran en la pantalla', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const e = await abrirApp(page, { datos: datos() });
  await irAModulo(page, 'ninieras');
  await expect(fila(page, 'Ana Ficticia').locator('.nin-trabajos')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  verificarLimpio(e);
});
