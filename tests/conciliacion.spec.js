// Conciliación con el extracto (05/10/2026): cada coincidencia con casilla; las seguras
// tildadas, las dudosas destildadas y con el motivo; nada se marca sin confirmar.
// Datos ficticios: Familia Prueba Uno (cuenta 0001234567, mensual) debe $2.280 de setiembre;
// Familia Prueba Dos (sin cuenta, semanal) debe $450; Ana (cuenta 0099887766) tiene $750 por
// pagar de la semana del 28/09.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase, sitting, ID } = require('./support/datos');

const ID_SEP = ['70000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003'];
async function procesar(page, csv, resultado = /créditos? leídos? del extracto/) {
  await page.setInputFiles('#fin-conciliar-file', { name: 'extracto.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.locator('button[onclick*="procesarExtractoConciliacion"]').click();
  await expect(page.locator('#fin-conciliar-resultado')).toContainText(resultado);
}
const fila = (page, texto) => page.locator('.conc-fila', { hasText: texto });
const boton = (page, tipo) => page.locator(`#conc-btn-${tipo}`);
const escriturasSittings = e => e.escrituras.filter(w => w.tabla === 'sittings_traslados');

// B10: importes, cuentas y personas inventados. El mismo saldo que se descuenta en
// Por cobrar / Por pagar debe descontarse y quedar usado al conciliar un extracto.
const AJ_B10 = 'a5000000-0000-4000-8000-000000000010';
function datosSaldoConciliacion(sujeto = 'familia', monto = -300) {
  const d = datosBase();
  d.ajustes_saldo = [{ id: AJ_B10, sujeto, monto, aplicado: 0, aplicaciones: [],
    familia_id: sujeto === 'familia' ? ID.fUno : null,
    ninera_id: sujeto === 'ninera' ? ID.nAna : null,
    nombre: sujeto === 'familia' ? 'Familia Prueba Uno' : 'Ana Ficticia',
    motivo: 'Saldo de prueba', fecha: '2026-09-01' }];
  return d;
}

test('B10 cobro neto: descuenta el saldo, cancelar no lo consume y confirmar impide reutilizarlo', async ({ page }) => {
  const d = datosSaldoConciliacion();
  const e = await abrirApp(page, { datos: d });
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0001234567;1980\n');
  const f = fila(page, 'Familia Prueba Uno');
  await expect(f.locator('input')).toBeChecked();
  await expect(f).toContainText('Saldo: −$300');
  await expect(boton(page, 'cobro')).toContainText('$1.980');
  await boton(page, 'cobro').click();
  const modal = page.locator('[aria-label="Confirmar cobros"]');
  await expect(modal).toContainText('Saldo: −$300');
  await expect(modal.locator('#cobro-total')).toHaveText('$1.980');
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(e.db.ajustes_saldo[0].aplicado).toBe(0);
  expect(escriturasSittings(e)).toEqual([]);
  await boton(page, 'cobro').click();
  await page.locator('[aria-label="Confirmar cobros"]').getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(f).toHaveClass(/conc-hecha/);
  expect(e.db.ajustes_saldo[0]).toMatchObject({ aplicado: 300, aplicaciones: [expect.objectContaining({ monto: -300, en: 'cobrado', sittings: ID_SEP })] });
  // Otro cobro posterior ya no debe descontar esos $300.
  e.db.sittings_traslados.push(sitting('70000000-0000-4000-8000-0000000000d1', '2026-10-01', {}));
  await procesar(page, 'Fecha;Concepto;Crédito\n04/10/2026;TRANSF 0001234567;1140\n');
  await expect(fila(page, 'Familia Prueba Uno').locator('input')).toBeChecked();
  await expect(fila(page, 'Familia Prueba Uno')).not.toContainText('Saldo:');
  expect(e.db.ajustes_saldo[0].aplicaciones).toHaveLength(1);
  verificarLimpio(e);
});

test('B10 pago neto: el detalle E3 y la aplicación usan sólo el saldo restante', async ({ page }) => {
  const d = datosSaldoConciliacion('ninera', -500);
  d.ajustes_saldo[0].aplicado = 200;
  const e = await abrirApp(page, { datos: d });
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Débito;Crédito\n04/10/2026;TRANSF 0099887766;450;\n');
  const f = page.locator('[data-conc-seccion="pago"] .conc-fila', { hasText: 'Ana Ficticia' });
  await expect(f.locator('input')).toBeChecked();
  await boton(page, 'pago').click();
  await expect(page.locator('#pago-detalle')).toContainText('Saldo a favor');
  await expect(page.locator('#pago-total')).toHaveText('$450');
  await page.locator('#pago-confirmar').click();
  await expect(f).toHaveClass(/conc-hecha/);
  expect(e.db.ajustes_saldo[0]).toMatchObject({ aplicado: 500, aplicaciones: [expect.objectContaining({ monto: -300, en: 'pagado' })] });
  verificarLimpio(e);
});

test('B10 varios períodos: sólo consume la porción del saldo asignada al período confirmado', async ({ page }) => {
  const d = datosSaldoConciliacion('familia', -2500);
  d.sittings_traslados.push(sitting('70000000-0000-4000-8000-0000000000d2', '2026-10-01', {}));
  const e = await abrirApp(page, { datos: d });
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0001234567;920\n');
  const f = fila(page, 'Familia Prueba Uno');
  await expect(f.locator('input')).toBeChecked();
  await boton(page, 'cobro').click();
  await page.locator('[aria-label="Confirmar cobros"]').getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(f).toHaveClass(/conc-hecha/);
  // El saldo se reserva al período más viejo: sólo se concilia octubre (1140 - 220).
  expect(e.db.ajustes_saldo[0].aplicado).toBe(220);
  expect(e.db.ajustes_saldo[0].aplicaciones).toHaveLength(1);
  expect(e.db.sittings_traslados.filter(s => ID_SEP.includes(s.id)).every(s => !s.cobrado)).toBe(true);
  verificarLimpio(e);
});

test('B10 dos meses juntos: registra una sola aplicación de saldo para todos los sittings', async ({ page }) => {
  const d = datosSaldoConciliacion();
  const nuevo = '70000000-0000-4000-8000-0000000000d3';
  d.sittings_traslados.push(sitting(nuevo, '2026-10-01', {}));
  const e = await abrirApp(page, { datos: d });
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0001234567;3120\n');
  const f = fila(page, 'Familia Prueba Uno');
  await expect(f).toContainText('Pagó varios períodos juntos');
  await expect(f.locator('input')).toBeChecked();
  await boton(page, 'cobro').click();
  await expect(page.locator('#cobro-total')).toHaveText('$3.120');
  await page.locator('[aria-label="Confirmar cobros"]').getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(f).toHaveClass(/conc-hecha/);
  expect(e.db.ajustes_saldo[0]).toMatchObject({ aplicado: 300, aplicaciones: [expect.objectContaining({ monto: -300, sittings: [...ID_SEP, nuevo] })] });
  verificarLimpio(e);
});

test('B10 un saldo mayor al cobro: no aplica más de lo necesario y conserva el resto', async ({ page }) => {
  const e = await abrirApp(page, { datos: datosSaldoConciliacion('familia', -2500) });
  await irAModulo(page, 'finanzas');
  // Una transferencia ficticia de $1 no coincide con deuda neta $0: continúa siendo dudosa.
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0001234567;1\n');
  const f = fila(page, 'Familia Prueba Uno');
  await expect(f.locator('input')).not.toBeChecked();
  await expect(f).toContainText('Saldo: −$2.280');
  await f.locator('input').check();
  await boton(page, 'cobro').click();
  await expect(page.locator('#cobro-total')).toHaveText('$0');
  await page.locator('[aria-label="Confirmar cobros"]').getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(f).toHaveClass(/conc-hecha/);
  expect(e.db.ajustes_saldo[0].aplicado).toBe(2280);
  await expect(page.locator('#fin-porcobrar-wrap')).toContainText('Familia Prueba Uno: −$220');
  verificarLimpio(e);
});

test('B10 sin cuenta: una coincidencia neta sigue siendo dudosa', async ({ page }) => {
  const e = await abrirApp(page, { datos: datosSaldoConciliacion() });
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;CAMBIOS;1980\n');
  const f = fila(page, 'Familia Prueba Uno');
  await expect(f.locator('input')).not.toBeChecked();
  await expect(f.locator('.conc-motivo')).toContainText('Sin cuenta en el extracto');
  expect(e.db.ajustes_saldo[0].aplicado).toBe(0);
  verificarLimpio(e);
});

test('B10 saldo consumido mientras se confirma: pide reprocesar y no marca', async ({ page }) => {
  const e = await abrirApp(page, { datos: datosSaldoConciliacion() });
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0001234567;1980\n');
  await boton(page, 'cobro').click();
  e.db.ajustes_saldo[0].aplicado = 300;
  await page.locator('[aria-label="Confirmar cobros"]').getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(page.locator('.toaststack')).toContainText('El saldo a favor cambió');
  expect(escriturasSittings(e)).toEqual([]);
  expect(e.escrituras.filter(w => w.tabla === 'ajustes_saldo')).toEqual([]);
  verificarLimpio(e);
});

test('B10 si otra admin ya cobró el grupo, no consume su saldo por segunda vez', async ({ page }) => {
  const e = await abrirApp(page, { datos: datosSaldoConciliacion() });
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0001234567;1980\n');
  await boton(page, 'cobro').click();
  e.db.sittings_traslados.filter(s => ID_SEP.includes(s.id)).forEach(s => { s.cobrado = true; });
  await page.locator('[aria-label="Confirmar cobros"]').getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(page.locator('.toaststack')).toContainText('Ya estaba marcado como cobrado');
  expect(e.db.ajustes_saldo[0].aplicado).toBe(0);
  expect(e.db.ajustes_saldo[0].aplicaciones).toEqual([]);
  verificarLimpio(e);
});

test('B10 error leyendo saldos: no propone conciliar con un total que los ignore', async ({ page }) => {
  const e = await abrirApp(page, { datos: datosSaldoConciliacion() });
  await irAModulo(page, 'finanzas');
  await esperarQuieta(page);
  await page.route(/\/rest\/v1\/ajustes_saldo\?/, r => r.request().method() === 'GET'
    ? r.fulfill({ status: 500, json: { code: 'XX000', message: 'Fallo de prueba' } }) : r.fallback());
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0001234567;2280\n', /No se pudieron leer los saldos a favor/);
  await expect(page.locator('#fin-conciliar-resultado')).toContainText('No se pudieron leer los saldos a favor');
  await expect(page.locator('.conc-fila')).toHaveCount(0);
  expect(escriturasSittings(e)).toEqual([]);
  verificarLimpio(e, { ignorar: [/500 \(Internal Server Error\)/] });
});

test('B10 si falla guardar el saldo, informa que quedó pendiente sin anunciar éxito', async ({ page }) => {
  const e = await abrirApp(page, { datos: datosSaldoConciliacion() });
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0001234567;1980\n');
  e.fallar = p => p.tabla === 'ajustes_saldo' && p.metodo === 'PATCH' ? { status: 500, message: 'Fallo de prueba' } : null;
  await boton(page, 'cobro').click();
  await page.locator('[aria-label="Confirmar cobros"]').getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(page.locator('.toaststack')).toContainText('no se pudo descontar el saldo a favor');
  await expect(page.locator('.toaststack')).not.toContainText('Marcado como cobrado');
  expect(e.db.ajustes_saldo[0].aplicado).toBe(0);
  expect(e.db.sittings_traslados.filter(s => ID_SEP.includes(s.id)).every(s => s.cobrado)).toBe(true);
  verificarLimpio(e, { ignorar: [/500 \(Internal Server Error\)/] });
});

test('B10 saldo y gasto extra se incluyen una sola vez en el cobro', async ({ page }) => {
  const d = datosSaldoConciliacion();
  d.gastos_extra = [{ id: 'b6000000-0000-4000-8000-000000000010', sitting_id: ID_SEP[0],
    concepto: 'Gasto ficticio', monto: 100, pagado_por: 'ninera', cobrado: false, reintegrado: false, absorbe_pb: false }];
  const e = await abrirApp(page, { datos: d });
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0001234567;2080\n');
  await expect(fila(page, 'Familia Prueba Uno').locator('input')).toBeChecked();
  await boton(page, 'cobro').click();
  await expect(page.locator('#cobro-total')).toHaveText('$2.080');
  await page.locator('[aria-label="Confirmar cobros"]').getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(fila(page, 'Familia Prueba Uno')).toHaveClass(/conc-hecha/);
  expect(e.db.ajustes_saldo[0].aplicado).toBe(300);
  expect(e.db.gastos_extra[0].cobrado).toBe(true);
  expect(e.db.gastos_extra[0].reintegrado).toBe(false);
  verificarLimpio(e);
});

test('coincidencia segura: viene tildada, pero no se marca nada hasta confirmar', async ({ page }) => {
  const e = await abrirApp(page);
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0001234567 FAMILIA;2.280,00\n');
  const f = fila(page, 'Familia Prueba Uno');
  await expect(f.locator('input')).toBeChecked();
  await expect(f).not.toHaveClass(/conc-dudosa/);
  await expect(f).toContainText('Setiembre de 2026');
  await expect(boton(page, 'cobro')).toHaveText('Marcar cobrado lo tildado (1 · $2.280)');
  expect(escriturasSittings(e)).toEqual([]); // procesar solo deja la marca en app_config

  await boton(page, 'cobro').click();
  const modal = page.locator('[aria-label="Confirmar cobros"]');
  await expect(modal).toContainText('Familia Prueba Uno');
  await expect(modal.locator('#cobro-total')).toHaveText('$2.280');
  await modal.locator('button', { hasText: 'Cancelar' }).click();
  expect(escriturasSittings(e)).toEqual([]);

  await boton(page, 'cobro').click();
  await page.locator('[aria-label="Confirmar cobros"] button', { hasText: 'Confirmar cobro' }).click();
  await expect(page.locator('.toaststack .toast').last()).toContainText('Marcado como cobrado (1)');
  const w = escriturasSittings(e);
  expect(w).toHaveLength(1);
  expect(w[0].cuerpo).toEqual({ cobrado: true });
  expect(w[0].params.id.replace(/^in\.\(|\)$/g, '').split(',').sort()).toEqual(ID_SEP);
  await expect(f).toHaveClass(/conc-hecha/);
  await expect(f.locator('input')).toBeDisabled();
  verificarLimpio(e);
});

test('sin cuenta (CAMBIOS) y mismo monto: dudosa, destildada y con el motivo', async ({ page }) => {
  const e = await abrirApp(page);
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n22/09/2026;CAMBIOS VARIOS;450\n');
  const f = fila(page, 'Familia Prueba Dos');
  await expect(f.locator('input')).not.toBeChecked();
  await expect(f).toHaveClass(/conc-dudosa/);
  await expect(f.locator('.conc-motivo')).toContainText('Sin cuenta en el extracto');
  await expect(boton(page, 'cobro')).toBeDisabled();
  // Si la elige a mano, se puede confirmar igual.
  await f.locator('input').check();
  await expect(boton(page, 'cobro')).toBeEnabled();
  await boton(page, 'cobro').click();
  await expect(page.locator('[aria-label="Confirmar cobros"]')).toContainText('dudosa, elegida a mano');
  await page.locator('[aria-label="Confirmar cobros"] button', { hasText: 'Confirmar cobro' }).click();
  await expect(page.locator('.toaststack .toast').last()).toContainText('Marcado como cobrado');
  expect(escriturasSittings(e)[0].params.id).toBe('in.(70000000-0000-4000-8000-000000000004)');
  verificarLimpio(e);
});

test('el mismo monto con varias familias: una opción por familia, todas destildadas', async ({ page }) => {
  const d = datosBase();
  // Familia Uno también tiene un puntual semanal-like de $450: dos pendientes de $450.
  d.familias[0].frecuencia_cobro = 'semanal';
  d.sittings_traslados = [
    sitting('70000000-0000-4000-8000-0000000000b1', '2026-09-16', { cobro_familia: 450 }),
    d.sittings_traslados[3],
  ];
  const e = await abrirApp(page, { datos: d });
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n25/09/2026;CAMBIOS;450\n');
  const filas = page.locator('.conc-fila');
  await expect(filas).toHaveCount(2);
  for (const nombre of ['Familia Prueba Uno', 'Familia Prueba Dos']) {
    await expect(fila(page, nombre).locator('input')).not.toBeChecked();
    await expect(fila(page, nombre).locator('.conc-motivo')).toContainText('el mismo monto coincide con 2 pendientes');
  }
  expect(escriturasSittings(e)).toEqual([]);
  verificarLimpio(e);
});

test('cuenta conocida con monto distinto: dudosa, no se marca sola', async ({ page }) => {
  const e = await abrirApp(page);
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0001234567;2000\n');
  const f = fila(page, 'Familia Prueba Uno');
  await expect(f.locator('input')).not.toBeChecked();
  await expect(f.locator('.conc-motivo')).toContainText('Monto distinto: el extracto dice $2.000 y lo pendiente es $2.280');
  verificarLimpio(e);
});

test('movimientos que no coinciden con nada quedan listados para revisar a mano', async ({ page }) => {
  const e = await abrirApp(page);
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0005555555;1234\n04/10/2026;CAMBIOS;99\n');
  const res = page.locator('#fin-conciliar-resultado');
  await expect(res).toContainText('Sin coincidencia');
  await expect(res).toContainText('La cuenta no está cargada en ninguna ficha');
  await expect(res).toContainText('Sin cuenta en el concepto y ningún pendiente con ese monto');
  await expect(page.locator('.conc-fila')).toHaveCount(0);
  verificarLimpio(e);
});

test('pagos a niñeras: el débito a la cuenta de Ana viene tildado y se confirma con el detalle de E3', async ({ page }) => {
  const e = await abrirApp(page);
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Débito;Crédito\n04/10/2026;TRANSF A 0099887766;750;\n05/10/2026;UTE;1500;\n');
  const f = page.locator('[data-conc-seccion="pago"] .conc-fila', { hasText: 'Ana Ficticia' });
  await expect(f.locator('input')).toBeChecked();
  await expect(page.locator('#fin-conciliar-resultado')).not.toContainText('UTE'); // gastos que no son niñeras no se listan
  await boton(page, 'pago').click();
  const modal = page.locator('[aria-label="Confirmar pago"]');
  await expect(modal).toContainText('Ana Ficticia');
  await expect(modal.locator('#pago-total')).toHaveText('$750');
  expect(escriturasSittings(e)).toEqual([]);
  await modal.locator('button', { hasText: 'Confirmar pago' }).click();
  await expect(page.locator('.toaststack .toast').last()).toContainText('Marcado como pagado (1)');
  expect(escriturasSittings(e)).toEqual([expect.objectContaining({ metodo: 'PATCH', cuerpo: { pagado: true }, params: { id: 'in.(70000000-0000-4000-8000-000000000003)', pagado: 'eq.false', select: 'id' } })]);
  verificarLimpio(e);
});

test('una familia que paga dos meses juntos: se propone todo junto y tildado', async ({ page }) => {
  const d = datosBase();
  d.sittings_traslados.push(sitting('70000000-0000-4000-8000-0000000000c1', '2026-10-01', {}));
  const e = await abrirApp(page, { datos: d });
  await irAModulo(page, 'finanzas');
  await procesar(page, 'Fecha;Concepto;Crédito\n03/10/2026;TRANSF 0001234567;3420\n');
  const f = fila(page, 'Familia Prueba Uno');
  await expect(f.locator('input')).toBeChecked();
  await expect(f).toContainText('Pagó varios períodos juntos');
  await expect(f).toContainText('$3.420');
  verificarLimpio(e);
});

// Lectores por formato (05/10/2026): leer el extracto está separado de conciliar, para sumar
// Mercado Pago agregando un lector. Los extractos de acá son INVENTADOS (nunca uno real).
test('extracto con encabezado de banco, saldos y débito/crédito: se leen solo los movimientos', async ({ page }) => {
  const e = await abrirApp(page);
  await irAModulo(page, 'finanzas');
  const csv = [
    'Estado de cuenta;;;;',
    'Cuenta;CAJA DE AHORRO $ 0000000;;;',
    'Período;01/10/2026 al 05/10/2026;;;',
    ';;;;',
    'Fecha;Descripción;Débito;Crédito;Saldo',
    ';SALDO ANTERIOR;;;10.000,00',
    '03/10/2026;TRANSF RECIBIDA 0001234567;;2.280,00;12.280,00',
    '04/10/2026;COMPRA SUPERMERCADO;350,50;;11.929,50',
    ';SALDO FINAL;;;11.929,50',
  ].join('\n');
  await procesar(page, csv);
  await expect(page.locator('#fin-conciliar-resultado')).toContainText('1 crédito leído del extracto');
  await expect(fila(page, 'Familia Prueba Uno').locator('input')).toBeChecked();
  await expect(page.locator('#fin-conciliar-resultado')).not.toContainText('SALDO');
  verificarLimpio(e);
});

test('archivo que ningún lector reconoce: avisa qué formatos entiende y no marca nada', async ({ page }) => {
  const e = await abrirApp(page);
  await irAModulo(page, 'finanzas');
  await page.setInputFiles('#fin-conciliar-file', { name: 'otro.csv', mimeType: 'text/csv', buffer: Buffer.from('Día;Importe\n03/10/2026;2280\n') });
  await page.locator('button[onclick*="procesarExtractoConciliacion"]').click();
  await expect(page.locator('#fin-conciliar-resultado')).toContainText('No reconocí el formato del archivo. Formatos que entiendo: Itaú.');
  expect(e.escrituras).toEqual([]);
  verificarLimpio(e);
});

test('un lector nuevo (Mercado Pago de prueba) concilia sin tocar el resto', async ({ page }) => {
  const e = await abrirApp(page);
  await irAModulo(page, 'finanzas');
  // Formato inventado con otra forma: monto con signo en una sola columna y la cuenta aparte.
  await page.evaluate(() => {
    LECTORES_EXTRACTO.unshift({
      id: 'prueba-mp', nombre: 'Mercado Pago (prueba)',
      reconoce: filas => (filas[0] || []).join('|') === 'FECHA_ORIGEN|CONTRAPARTE|CUENTA_ORIGEN|MONTO' ? {} : null,
      leer: filas => filas.slice(1).filter(f => f[0]).map(f => {
        const monto = parseMontoExtracto(f[3]);
        return { fecha: parseFechaExtracto(f[0]), concepto: f[1], cuenta: soloDigitos(f[2]), credito: monto > 0 ? monto : 0, debito: monto < 0 ? -monto : 0 };
      }),
    });
  });
  await procesar(page, 'FECHA_ORIGEN;CONTRAPARTE;CUENTA_ORIGEN;MONTO\n2026-10-03;Familia;0001234567;2280\n2026-10-04;Ana;0099887766;-750\n');
  await expect(fila(page, 'Familia Prueba Uno').locator('input')).toBeChecked();
  await expect(page.locator('[data-conc-seccion="pago"] .conc-fila', { hasText: 'Ana Ficticia' }).locator('input')).toBeChecked();
  verificarLimpio(e);
});
