// Guardados (PR 5, 05/10/2026):
// - doble toque en "Guardar": un solo insert, botón deshabilitado y con ruedita mientras guarda;
// - si la base falla (error de Supabase o se corta la red) nunca se muestra éxito;
// - "Terminar este fijo desde una fecha" en lugar de borrarlo.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase, ID } = require('./support/datos');

const IGNORAR_RED = [/Failed to load resource|ERR_FAILED|\[Supabase\]|Failed to fetch|TypeError/];

async function elegirAutocomplete(page, input, texto) {
  // El formulario engancha el autocompletar en un setTimeout después de abrirse: si se
  // escribe antes (en el CI pasa), ese tipeo no abre la lista. Se vuelve a escribir.
  const item = page.locator(`${input}-dropdown .autocomplete-item`, { hasText: texto }).first();
  await expect(async () => {
    await page.fill(input, '');
    await page.fill(input, texto.slice(0, 5));
    await expect(item).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await item.click();
  await page.waitForTimeout(200); // el blur del autocompletar cierra el desplegable a los 150 ms
}
async function llenarSitting(page) {
  await irAModulo(page, 'sittings');
  await page.locator('button[onclick^="abrirModalSitForm"]').first().click();
  await elegirAutocomplete(page, '#sit-familia', 'Familia Prueba Dos');
  await elegirAutocomplete(page, '#sit-ninera', 'Bruno Inventado');
  await page.fill('#sit-fecha', '2026-10-03');
  await page.evaluate(() => { setHoraSelect('sit-horaini', '10:00'); setHoraSelect('sit-horafin', '12:00'); });
  await page.fill('#sit-cobro', '800');
  await page.fill('#sit-pago', '520');
}
const toasts = page => page.locator('.toaststack .toast');

const FORMULARIOS = [
  {
    nombre: 'sitting', tabla: 'sittings_traslados', boton: 'Guardar registro',
    llenar: llenarSitting,
  },
  {
    nombre: 'familia', tabla: 'familias', boton: 'Agregar familia',
    llenar: async page => {
      await irAModulo(page, 'familias');
      await page.locator('button[onclick^="abrirModalNuevaFamilia"]').click();
      await page.fill('#fam-nombre', 'Familia Doble Toque');
    },
  },
  {
    nombre: 'gasto', tabla: 'gastos_generales', boton: 'Agregar gasto',
    llenar: async page => {
      await irAModulo(page, 'finanzas');
      await page.locator('button[onclick^="abrirModalNuevoGasto("]').click();
      await page.fill('#fin-gasto-concepto', 'Insumos');
      await page.fill('#fin-gasto-monto', '300');
    },
  },
  {
    nombre: 'fecha de marketing', tabla: 'fechas_marketing', boton: 'Agregar fecha',
    llenar: async page => {
      await irAModulo(page, 'marketing');
      await page.locator('button[onclick^="abrirModalNuevaFechaMarketing"]').click();
      await page.fill('#mk-fecha', '2026-11-15');
      await page.fill('#mk-titulo', 'Fecha doble');
    },
  },
  {
    nombre: 'niñera', tabla: 'ninieras', boton: 'Agregar niñera',
    llenar: async page => {
      await irAModulo(page, 'ninieras');
      await page.locator('button[onclick^="abrirModalNuevaNinera"]').click();
      await page.fill('#nn-nombre', 'Niñera Doble Toque');
      await page.fill('#nn-telefono', '099 123 456');
    },
  },
  {
    nombre: 'candidata', tabla: 'candidatas', boton: 'Agregar candidata',
    llenar: async page => {
      await irAModulo(page, 'rrhh');
      await page.locator('button[onclick^="abrirModalNuevaCandidata"]').click();
      await page.fill('#in-nombre', 'Candidata Doble');
    },
  },
];

test.describe('doble toque en Guardar', () => {
  for (const f of FORMULARIOS) {
    test(`${f.nombre}: dos toques seguidos guardan una sola vez`, async ({ page }) => {
      const e = await abrirApp(page);
      await f.llenar(page);
      e.demoraEscrituras = 800; // base lenta: el segundo toque llega mientras guarda
      const boton = page.locator('#editmodal button', { hasText: f.boton });
      await boton.click();
      // Mientras guarda: deshabilitado y con la ruedita.
      await expect(boton).toBeDisabled();
      await expect(boton.locator('.spinner')).toHaveCount(1);
      await boton.click({ force: true }).catch(() => {});
      await page.evaluate(() => document.querySelector('#editmodal button[aria-busy]')?.click());
      await expect(page.locator('#editmodal')).toHaveCount(0, { timeout: 5000 });
      await esperarQuieta(page);
      expect(e.escrituras.filter(w => w.tabla === f.tabla && w.metodo === 'POST')).toHaveLength(1);
      verificarLimpio(e);
    });
  }

  test('el botón vuelve a quedar habilitado si el guardado falla, y se puede reintentar', async ({ page }) => {
    const e = await abrirApp(page);
    await FORMULARIOS[2].llenar(page);
    e.fallar = ({ tabla }) => tabla === 'gastos_generales' ? { message: 'se cayó la base' } : undefined;
    const boton = page.locator('#editmodal button', { hasText: 'Agregar gasto' });
    await boton.click();
    await expect(toasts(page).last()).toContainText('se cayó la base');
    await expect(boton).toBeEnabled();
    await expect(boton).toHaveText('Agregar gasto');
    e.fallar = null;
    await boton.click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(e.escrituras.filter(w => w.tabla === 'gastos_generales')).toHaveLength(1);
    verificarLimpio(e, { ignorar: IGNORAR_RED });
  });

  test('todos los botones que escriben en la base pasan por conGuardado', async ({ page }) => {
    // Complementa el chequeo estático: lo que se ve en pantalla en los formularios principales.
    const e = await abrirApp(page);
    for (const f of FORMULARIOS) {
      await f.llenar(page);
      const h = await page.locator('#editmodal button', { hasText: f.boton }).getAttribute('onclick');
      expect(h, f.nombre).toMatch(/^conGuardado\(this, \(\)=>/);
      await page.evaluate(() => cerrarModal());
    }
    verificarLimpio(e);
  });
});

test.describe('cerrar el modal a mitad del guardado', () => {
  for (const f of FORMULARIOS) {
    test(`${f.nombre}: guarda una vez y no tira errores`, async ({ page }) => {
      const e = await abrirApp(page);
      await f.llenar(page);
      e.demoraEscrituras = 600;
      await page.locator('#editmodal button', { hasText: f.boton }).click();
      await page.waitForTimeout(100);
      await page.evaluate(() => cerrarModal());
      await page.waitForTimeout(1200);
      await esperarQuieta(page);
      expect(e.escrituras.filter(w => w.tabla === f.tabla && w.metodo === 'POST')).toHaveLength(1);
      verificarLimpio(e);
    });

    test(`${f.nombre}: si además falla, avisa sin romperse`, async ({ page }) => {
      const e = await abrirApp(page);
      await f.llenar(page);
      e.demoraEscrituras = 600;
      e.fallar = ({ tabla }) => tabla === f.tabla ? { message: 'falla simulada' } : undefined;
      await page.locator('#editmodal button', { hasText: f.boton }).click();
      await page.waitForTimeout(100);
      await page.evaluate(() => cerrarModal());
      await expect.poll(() => e.fallidas || 0).toBeGreaterThan(0);
      await page.waitForTimeout(500);
      expect(await page.locator('.toaststack .toast.good').count()).toBe(0);
      verificarLimpio(e, { ignorar: IGNORAR_RED });
    });
  }
});

test.describe('si la base falla, nunca se muestra éxito', () => {
  for (const modo of ['error de Supabase', 'sin conexión']) {
    for (const f of FORMULARIOS) {
      test(`${f.nombre} con ${modo}`, async ({ page }) => {
        const e = await abrirApp(page);
        await f.llenar(page);
        e.fallar = ({ tabla }) => tabla === f.tabla ? (modo === 'sin conexión' ? 'red' : { message: 'falla simulada' }) : undefined;
        await page.locator('#editmodal button', { hasText: f.boton }).click();
        await expect.poll(() => e.fallidas || 0).toBeGreaterThan(0);
        await page.waitForTimeout(400);
        // El formulario sigue abierto (no se pierde lo cargado) y el aviso es de error.
        await expect(page.locator('#editmodal')).toHaveCount(1);
        const textos = await toasts(page).allInnerTexts();
        const avisos = textos.join(' | ') + ' ' + (await page.locator('#editmodal .warnbox').allInnerTexts()).join(' | ');
        expect(avisos).toMatch(/No se pudo|Error|falla simulada|conexión/i);
        expect(await page.locator('.toaststack .toast.good').count(), 'ningún aviso de éxito').toBe(0);
        verificarLimpio(e, { ignorar: IGNORAR_RED });
      });
    }
  }

  test('editar familia: si fallan los hijos no se pierden los que había', async ({ page }) => {
    const datos = datosBase();
    datos.hijos_familia = [{ id: 'a1000000-0000-4000-8000-000000000001', familia_id: ID.fUno, nombre: 'Tomi', fecha_nacimiento: '2020-05-01', colegio: null, orden: 0, created_at: '2026-09-01T00:00:00Z', edad_declarada: null, edad_declarada_en: null }];
    const e = await abrirApp(page, { datos });
    await irAModulo(page, 'familias');
    await page.evaluate(id => editarFamilia(id), ID.fUno);
    await page.waitForTimeout(300);
    e.fallar = ({ tabla, metodo }) => tabla === 'hijos_familia' && metodo === 'POST' ? { message: 'no se pudo insertar' } : undefined;
    await page.locator('#editmodal button', { hasText: 'Guardar' }).last().click();
    await expect(toasts(page).last()).toContainText('no los hijos');
    expect(e.db.hijos_familia.map(h => h.nombre)).toEqual(['Tomi']); // antes se borraban primero
    expect(e.escrituras.filter(w => w.tabla === 'hijos_familia' && w.metodo === 'DELETE')).toHaveLength(0);
    verificarLimpio(e, { ignorar: IGNORAR_RED });
  });

  test('editar familia: los hijos se reemplazan sin duplicarse', async ({ page }) => {
    const datos = datosBase();
    datos.hijos_familia = [{ id: 'a1000000-0000-4000-8000-000000000001', familia_id: ID.fUno, nombre: 'Tomi', fecha_nacimiento: '2020-05-01', colegio: null, orden: 0, created_at: '2026-09-01T00:00:00Z', edad_declarada: null, edad_declarada_en: null }];
    const e = await abrirApp(page, { datos });
    await irAModulo(page, 'familias');
    await page.evaluate(id => editarFamilia(id), ID.fUno);
    await page.waitForTimeout(300);
    await page.locator('#editmodal button', { hasText: 'Guardar' }).last().click();
    await expect(toasts(page).last()).toContainText('Cambios guardados');
    expect(e.db.hijos_familia.filter(h => h.familia_id === ID.fUno).map(h => h.nombre)).toEqual(['Tomi']);
    verificarLimpio(e);
  });

  test('colocación de Enrique: si falla sacarla de Niñeras se avisa, no dice "listo"', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'intermediaciones');
    await page.evaluate(() => abrirFormInterEnrique());
    await elegirAutocomplete(page, '#inter-enrique-ninera', 'Ana Ficticia');
    await page.fill('#inter-enrique-monto', '1000');
    e.fallar = ({ tabla }) => tabla === 'ninieras' ? { message: 'permiso denegado' } : undefined;
    await page.locator('button', { hasText: 'Guardar colocación' }).click();
    await expect(toasts(page).last()).toContainText('no se pudo sacarla de la lista de Niñeras');
    await expect(page.locator('.toaststack .toast.good')).toHaveCount(0);
    verificarLimpio(e, { ignorar: IGNORAR_RED });
  });

  test('marcar una notificación como leída: si falla, vuelve a aparecer', async ({ page }) => {
    const e = await abrirApp(page);
    const id = 'extracto:nunca';
    e.fallar = ({ tabla }) => tabla === 'notificaciones_leidas' ? 'red' : undefined;
    await page.evaluate(i => marcarNotifLeida(i), id);
    expect(await page.evaluate(i => notifLeidas.has(i), id)).toBe(false);
    await expect(toasts(page).last()).toContainText('No se pudo marcar como leída');
    verificarLimpio(e, { ignorar: IGNORAR_RED });
  });
});

test.describe('terminar un fijo desde una fecha (antes "Quitar" lo borraba)', () => {
  test('desde la Agenda: completa vigente_hasta y no borra nada', async ({ page }) => {
    const datos = datosBase();
    datos.sittings_traslados.push({ ...datos.sittings_traslados[0], id: '70000000-0000-4000-8000-000000000009', fecha: '2026-09-30', asignacion_id: ID.aFijo });
    const e = await abrirApp(page, { datos, ahora: '2026-10-05T12:00:00-03:00' });
    await irAModulo(page, 'agenda');
    await page.evaluate(async () => { agendaAncla = '2026-10-05'; await cargarAgendaSolicitudes(); });
    await esperarQuieta(page);
    const id = await page.evaluate(() => agendaSolicitudes.find(s => s._fuente === 'asignacion').id);
    await page.evaluate(i => abrirModalSolicitud(i), id);
    await page.locator('#editmodal button', { hasText: 'Terminar este fijo desde una fecha' }).click();
    await expect(page.locator('#terminar-desde')).toHaveValue('2026-10-05');
    await page.fill('#terminar-desde', '2026-10-12');
    await page.locator('#editmodal button', { hasText: 'Terminar el fijo' }).click();
    await expect(page.locator('#editmodal')).toHaveCount(0);
    expect(e.escrituras.filter(w => w.tabla === 'asignaciones')).toEqual([
      expect.objectContaining({ metodo: 'PATCH', cuerpo: { vigente_hasta: '2026-10-11' } }),
    ]);
    expect(e.db.asignaciones).toHaveLength(1);
    expect(e.db.sittings_traslados.find(s => s.asignacion_id === ID.aFijo)).toBeTruthy();
    // La semana siguiente ya no lo proyecta; esta semana sí (lunes 05 y miércoles 07).
    const proy = await page.evaluate(async () => {
      agendaAncla = '2026-10-05'; await cargarAgendaSolicitudes();
      const a = agendaSolicitudes.filter(s => s._fuente === 'asignacion').map(s => s.fecha);
      agendaAncla = '2026-10-12'; await cargarAgendaSolicitudes();
      const b = agendaSolicitudes.filter(s => s._fuente === 'asignacion').map(s => s.fecha);
      return [a, b];
    });
    expect(proy[0].filter(f => f <= '2026-10-11')).toEqual(['2026-10-05', '2026-10-07']);
    expect(proy[1]).toEqual([]);
    await expect(toasts(page).last()).toContainText('corre hasta el 11 de octubre');
    verificarLimpio(e);
  });

  test('desde la ficha de la familia: pide fecha, no borra y no deja terminar antes de que empiece', async ({ page }) => {
    const e = await abrirApp(page, { ahora: '2026-10-05T12:00:00-03:00' });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await page.locator('#editmodal button', { hasText: 'Terminar' }).click();
    await expect(page.locator('#terminar-desde')).toBeVisible();
    await page.fill('#terminar-desde', '2026-09-01'); // el día que empezó
    await page.locator('#editmodal button', { hasText: 'Terminar el fijo' }).click();
    await expect(page.locator('#terminar-warn')).toContainText('empezó el');
    expect(e.escrituras).toEqual([]);
    await page.fill('#terminar-desde', '2026-10-06');
    await page.locator('#editmodal button', { hasText: 'Terminar el fijo' }).click();
    await expect(page.locator('#terminar-warn')).toHaveCount(0);
    expect(e.escrituras.map(w => [w.tabla, w.metodo, w.cuerpo])).toEqual([['asignaciones', 'PATCH', { vigente_hasta: '2026-10-05' }]]);
    expect(e.escrituras.some(w => w.metodo === 'DELETE')).toBe(false);
    verificarLimpio(e);
  });

  test('con la base sin migrar no borra: avisa que falta la migración', async ({ page }) => {
    const datos = datosBase();
    const { vigente_desde, vigente_hasta, tipo, ...viejo } = datos.asignaciones[0];
    datos.asignaciones = [viejo];
    const respuestas400 = [];
    page.on('response', r => { if (r.status() === 400) respuestas400.push(r.url()); });
    const e = await abrirApp(page, { datos, baseSinMigrar: true });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await page.locator('#editmodal button', { hasText: 'Terminar' }).click();
    await page.locator('#editmodal button', { hasText: 'Terminar el fijo' }).click();
    await expect(page.locator('#terminar-warn')).toContainText('falta la migración');
    expect(e.escrituras).toEqual([]);
    // 404: tablas nuevas (saldo a favor) que la base sin migrar todavía no tiene. La lectura de "Pedidos en curso" de
    // Hoy pide columnas de la etapa 5 y la base sin migrar responde 400 (sin ellas no muestra nada, 01/11/2026). La
    // consola no dice la dirección: se controla acá que todo 400 sea esa lectura y solo entonces se ignora el aviso.
    expect(respuestas400.filter(u => !/\/rest\/v1\/solicitudes\?select=id%2Cfamilia_id.*estado=eq\.pendiente_confirmar/.test(u))).toEqual([]);
    verificarLimpio(e, { ignorar: [/status of 404/, ...(respuestas400.length ? [/status of 400/] : [])] });
  });
});
