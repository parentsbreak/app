// "Detalle" del PDF para la madre (03/11/2026, pedido de Paulina y Delfina): las notas que escribe
// el sistema ("Sitting fijo — cargado automáticamente", "Asignado desde Agenda", "Reemplazo de ...")
// no van al PDF ni a su vista previa; lo que escribieron las chicas, las variantes de precio y los
// motivos de un registro cancelado ("no fue — sin reemplazo", "Fijo en pausa: ...") sí. En la vista
// previa el Detalle de cada fila se puede editar: sale en el PDF y no se guarda en el registro.
// El historial de pantalla sigue mostrando la nota entera. Hoy en los tests = domingo 04/10/2026.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

const S = n => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VARIANTE = { base: { cobro: 1000, pago: 600 }, aplicadas: [{ id: 'v1', nombre: 'La llevó a la casa', motivo: 'extra', cobro: { modo: 'sumar', valor: 140 }, pago: { modo: 'sumar', valor: 150 } }] };

// Agosto de la Familia Prueba Uno: una nota por día.
function datosAgosto(notas) {
  const d = datosBase();
  notas.forEach((n, i) => d.sittings_traslados.push(sitting(S(i + 1), `2026-08-${String(i + 1).padStart(2, '0')}`, typeof n === 'string' || n === null ? { notas: n } : n)));
  return d;
}
async function vistaPrevia(page) {
  await irAModulo(page, 'sittings');
  await page.evaluate(() => {
    const sel = document.getElementById('sithist-familia');
    sel.value = [...sel.options].find(o => o.textContent === 'Familia Prueba Uno').value;
  });
  await page.evaluate(() => abrirModalExportarHistorialPDF());
  await page.fill('#exphist-desde', '2026-08-01');
  await page.fill('#exphist-hasta', '2026-08-31');
  await page.locator('#editmodal button', { hasText: 'Ver vista previa' }).click();
  await expect(page.locator('#exphist-total-pagar')).toBeVisible();
}
const celda = (page, n) => page.locator(`#exphist-preview textarea.exphist-detalle[data-id="${S(n)}"]`);
// jsPDF de mentira: anota lo que se le manda a autoTable (el CDN no se baja en los tests).
async function pdfFalso(page) {
  await page.evaluate(() => {
    window.__tablas = [];
    function PDF() { this.lastAutoTable = { finalY: 40 }; }
    PDF.prototype = {
      setFontSize() {}, text() {}, addPage() {}, addImage() {}, save(n) { window.__pdf = n; },
      autoTable(o) { window.__tablas.push(JSON.parse(JSON.stringify({ head: o.head, body: o.body }))); },
    };
    PDF.API = { autoTable: PDF.prototype.autoTable };
    window.jspdf = { jsPDF: PDF };
  });
}
async function descargar(page) {
  await page.locator('#exphist-preview button', { hasText: 'Descargar PDF' }).click();
  await expect.poll(() => page.evaluate(() => window.__pdf || null)).toBeTruthy();
  const tablas = await page.evaluate(() => window.__tablas);
  const t = tablas.find(x => x.head[0].includes('Detalle'));
  return Object.fromEntries(t.body.map(f => [f[0], f[6]]));
}

const SISTEMA = [
  'Sitting fijo — cargado automáticamente',
  'Traslado fijo — cargado automáticamente',
  'Sitting fijo — generado automáticamente',
  'Traslado fijo — generado automáticamente',
  'Sitting fijo — registrado desde Agenda',
  'Traslado fijo — registrado desde Agenda',
  'Asignado desde Agenda',
  'Cargado desde "Sittings sin registrar"',
  'Sitting fijo — cargado desde "Sittings sin registrar"',
  'Traslado fijo — cargado desde "Sittings sin registrar"',
  'Reemplazo de Ana Ficticia',
];

test.describe('la nota del sistema no va al Detalle del PDF', () => {
  for (const nota of SISTEMA) {
    test(`"${nota}": sola, el Detalle queda vacío; con texto después, queda el texto`, async ({ page }) => {
      const e = await abrirApp(page, { datos: datosBase() });
      const r = await page.evaluate(n => [
        detalleParaPDF({ notas: n }),
        detalleParaPDF({ notas: n + '. Llegó tarde' }),
        detalleParaPDF({ notas: n + ' — Llegó tarde' }),
        detalleParaPDF({ notas: n + ', Llegó tarde' }),
        detalleParaPDF({ notas: n + '.\nLlegó tarde' }),
        detalleParaPDF({ notas: n + '\nLlegó tarde' }),
        detalleParaPDF({ notas: '  ' + n + '  ' }),
      ], nota);
      expect(r).toEqual(['', 'Llegó tarde', 'Llegó tarde', 'Llegó tarde', 'Llegó tarde', 'Llegó tarde', '']);
      // Separado solo con un espacio (así hay una en producción): el texto queda. En "Reemplazo de"
      // no se sabe dónde termina el nombre, así que sale todo (la vista previa deja corregirlo).
      expect(await page.evaluate(n => detalleParaPDF({ notas: n + ' NO SE HIZO y se cobra igual' }), nota))
        .toBe(nota.startsWith('Reemplazo de') ? '' : 'NO SE HIZO y se cobra igual');
      verificarLimpio(e);
    });
  }

  test('lo que escribieron las chicas, los motivos de cancelado y las variantes quedan', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosBase() });
    const intactas = [
      'Llegó tarde, la madre avisó',
      'Traslado fijo — se había borrado el 04/10, se vuelve a cargar',
      'Ana Ficticia no fue — sin reemplazo',
      'Ana Ficticia no va — sin reemplazo',
      'El fijo no corre hoy',
      'Fijo terminado',
      'Fijo en pausa: vacaciones',
      'Cambió el horario del fijo: hoy no va',
      'Se quedó hasta tarde. Asignado desde Agenda',
      'Reemplazo: lo cubrió otra',
    ];
    const r = await page.evaluate(ns => ns.map(n => detalleParaPDF({ notas: n })), intactas);
    expect(r).toEqual(intactas);
    expect(await page.evaluate(() => [
      detalleParaPDF({ notas: 'Asignado desde Agenda — Pedido cancelado' }),
      detalleParaPDF({ notas: null }),
      detalleParaPDF({ notas: '' }),
    ])).toEqual(['Pedido cancelado', '', '']);
    // Variantes de precio: van siempre; la nota del sistema que las acompaña, no.
    expect(await page.evaluate(v => [
      detalleParaPDF({ precio_variantes: v, notas: 'Sitting fijo — cargado automáticamente' }),
      detalleParaPDF({ precio_variantes: v, notas: 'Sitting fijo — cargado automáticamente. Llegó tarde' }),
    ], VARIANTE)).toEqual(['La llevó a la casa', 'La llevó a la casa · Llegó tarde']);
    verificarLimpio(e);
  });
});

test('vista previa: el Detalle viene limpio y editable, y el PDF lleva lo editado sin tocar el registro', async ({ page }) => {
  const d = datosAgosto([
    'Sitting fijo — cargado automáticamente',
    'Sitting fijo — cargado automáticamente. Laura no avisó, la niñera ya había llegado',
    'Llevar el abrigo',
    { notas: 'Asignado desde Agenda', precio_variantes: VARIANTE },
    'Reemplazo de Ana Ficticia',
  ]);
  const e = await abrirApp(page, { datos: d });
  await vistaPrevia(page);
  await expect(celda(page, 1)).toHaveValue('');
  await expect(celda(page, 2)).toHaveValue('Laura no avisó, la niñera ya había llegado');
  await expect(celda(page, 3)).toHaveValue('Llevar el abrigo');
  await expect(celda(page, 4)).toHaveValue('La llevó a la casa');
  await expect(celda(page, 5)).toHaveValue('');
  await expect(page.locator('#exphist-preview')).not.toContainText('cargado automáticamente');
  // Editar dos filas y cambiar la cuenta para transferir: lo escrito sigue ahí.
  await celda(page, 1).fill('Se quedó hasta las 20');
  await celda(page, 3).fill('');
  await page.fill('#exphist-cuenta', 'Banco Inventado 0001234567');
  await expect(celda(page, 1)).toHaveValue('Se quedó hasta las 20');
  await pdfFalso(page);
  const det = await descargar(page);
  expect(Object.values(det).sort()).toEqual(['', '', 'La llevó a la casa', 'Laura no avisó, la niñera ya había llegado', 'Se quedó hasta las 20'].sort());
  const fecha = await page.evaluate(iso => new Date(iso + 'T00:00:00').toLocaleDateString('es-UY', { day: '2-digit', month: 'short', year: 'numeric' }), '2026-08-01');
  expect(det[fecha]).toBe('Se quedó hasta las 20');
  // Las notas siguen siendo internas: el registro no se tocó.
  expect(e.escrituras.filter(w => w.tabla === 'sittings_traslados')).toEqual([]);
  expect(e.db.sittings_traslados.find(s => s.id === S(1)).notas).toBe('Sitting fijo — cargado automáticamente');
  verificarLimpio(e);
});

test('volver a tocar "Ver vista previa" no pierde lo escrito; abrir el modal de nuevo empieza limpio', async ({ page }) => {
  const e = await abrirApp(page, { datos: datosAgosto(['Asignado desde Agenda', 'Llevar el abrigo']) });
  await vistaPrevia(page);
  await celda(page, 1).fill('Cumpleaños de la nena');
  await page.locator('#editmodal button', { hasText: 'Ver vista previa' }).click();
  await expect(celda(page, 1)).toHaveValue('Cumpleaños de la nena');
  await expect(celda(page, 2)).toHaveValue('Llevar el abrigo');
  await vistaPrevia(page);
  await expect(celda(page, 1)).toHaveValue('');
  verificarLimpio(e);
});

test('el historial de pantalla sigue mostrando la nota entera', async ({ page }) => {
  const e = await abrirApp(page, { datos: datosAgosto(['Sitting fijo — cargado automáticamente. Llegó tarde']) });
  await irAModulo(page, 'sittings');
  expect(await page.evaluate(() => detalleRegistro({ notas: 'Sitting fijo — cargado automáticamente. Llegó tarde' })))
    .toBe('Sitting fijo — cargado automáticamente. Llegó tarde');
  verificarLimpio(e);
});

test('notas con comillas y HTML: se ven como texto en la vista previa y en el PDF, nada se ejecuta', async ({ page }) => {
  const raro = `Asignado desde Agenda. <img src=x onerror="window.__xss=1">O'Neil "casa" </textarea><b>x</b>`;
  const limpio = `<img src=x onerror="window.__xss=1">O'Neil "casa" </textarea><b>x</b>`;
  const e = await abrirApp(page, { datos: datosAgosto([raro]) });
  await vistaPrevia(page);
  await expect(celda(page, 1)).toHaveValue(limpio);
  await celda(page, 1).fill(limpio + ` ');window.__xss=2;('`);
  await pdfFalso(page);
  const det = await descargar(page);
  expect(Object.values(det)).toEqual([limpio + ` ');window.__xss=2;('`]);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('#exphist-preview b').count()).toBe(0);
  verificarLimpio(e);
});

test.describe('celular (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('el Detalle se ve como un campo para escribir, se puede tocar y no hay scroll horizontal', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosAgosto(['Asignado desde Agenda', 'Llevar el abrigo']) });
    await vistaPrevia(page);
    const c = celda(page, 2);
    await c.scrollIntoViewIfNeeded();
    await expect(c).toBeVisible();
    const caja = await c.boundingBox();
    expect(caja.width).toBeGreaterThanOrEqual(150);
    expect(caja.height).toBeGreaterThanOrEqual(36);
    // Borde visible y letra de 16 px (con menos, el iPhone hace zoom al tocar).
    const estilo = await c.evaluate(el => { const s = getComputedStyle(el); return { borde: s.borderTopWidth, letra: s.fontSize }; });
    expect(estilo.borde).not.toBe('0px');
    expect(estilo.letra).toBe('16px');
    await c.tap();
    await c.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
    await page.keyboard.type(', y la mochila');
    await expect(c).toHaveValue('Llevar el abrigo, y la mochila');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('vista-previa-390.png') });
    verificarLimpio(e);
  });
});
