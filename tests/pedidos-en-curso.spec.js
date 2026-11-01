// "Pedidos en curso" en Hoy y en el modal de la solicitud (fase 1, etapa 6, tarea 6.5, 01/11/2026): una tarjeta por
// pedido mandado por la app que sigue sin niñera ('pendiente_confirmar', de hoy en adelante), con quién puede, quién
// no y quién no respondió, "Ya fue N veces" / "Nueva para esta familia" (una sola lectura del historial para todos),
// el atajo de la niñera que pidió la madre, "Asignar" en las que pueden, "Perfiles para la madre" (la regla del CV),
// "Preguntar a más niñeras", "Todavía buscando", "No conseguimos" y "Cancelar el pedido". Contra el simulador.
// Datos inventados (datosEleccion): hoy es domingo 04/10/2026 a las 12:00 de Montevideo; sPendiente es de Familia
// (práctica), miércoles 07/10 de 18:00 a 22:00, mandado a las 11:00: "Niñera (práctica)" ($200) y Lola ($210) dijeron
// "Puedo" y Mía no respondió; sPedida (jueves 08/10) la pidió la madre a "Niñera (práctica)", que dijo "Puedo" ($230).
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosEleccion, sitting, ID } = require('./support/datos');

// Las fallas simuladas dejan su rastro en la consola (el pedido que falla y el console.error que lo explica).
const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /se cayó/];
const SN_CARLA = '85000000-0000-4000-8000-000000000010';
const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && (!metodo || w.metodo === metodo));
const zona = page => page.locator('#dash-pedidos');
const tarjeta = (page, id = ID.sPendiente) => page.locator(`#dash-pedidos .pedido-curso[data-solicitud="${id}"]`);
const fila = (cont, nombre) => cont.locator('.pedido-curso-fila', { hasText: nombre });
const modal = page => page.locator('#editmodal');
const texto = page => page.locator('#mensaje-madre-texto');
const toasts = page => page.locator('.toaststack .toast');

// Carla no puede (Me queda lejos) en sPendiente; "Niñera (práctica)" ya fue dos veces a Familia (práctica): un
// registro con ids y uno viejo solo con los nombres. Lo que no cuenta: un cancelado, un traslado, un previsto que
// todavía no llegó y uno de otra familia.
function datos({ conHistorial = true } = {}) {
  const d = datosEleccion();
  d.solicitud_ninieras.push({ id: SN_CARLA, solicitud_id: ID.sPendiente, ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', pago_ninera: null,
    estado: 'no_puedo', created_at: '2026-10-04T14:00:00.000Z', origen: 'app', precio_hora: 300, enviado_en: '2026-10-04T14:00:00.000Z',
    respondido_en: '2026-10-04T14:06:00.000Z', motivo_no: 'lejos', motivo_texto: null, seleccionada_en: null, visto_en: null });
  if (conHistorial) {
    const practica = { familia_id: ID.fPractica, familia_nombre: 'Familia (práctica)', ninera_id: ID.nPractica, ninera_nombre: 'Niñera (práctica)' };
    d.sittings_traslados.push(
      sitting('76000000-0000-4000-8000-000000000001', '2026-09-10', practica),
      sitting('76000000-0000-4000-8000-000000000002', '2026-09-12', { ...practica, familia_id: null, ninera_id: null, ninera_nombre: ' niñera (PRACTICA) ' }),
      sitting('76000000-0000-4000-8000-000000000003', '2026-09-14', { ...practica, ninera_id: ID.nLola, ninera_nombre: 'Lola (práctica)', cancelado: true }),
      sitting('76000000-0000-4000-8000-000000000004', '2026-09-15', { ...practica, ninera_id: ID.nLola, ninera_nombre: 'Lola (práctica)', tipo: 'traslado' }),
      sitting('76000000-0000-4000-8000-000000000005', '2026-10-20', { ...practica, ninera_id: ID.nLola, ninera_nombre: 'Lola (práctica)', estado: 'previsto' }),
      sitting('76000000-0000-4000-8000-000000000006', '2026-09-16', { ninera_id: ID.nLola, ninera_nombre: 'Lola (práctica)' }),
    );
  }
  return d;
}
async function espiarPortapapeles(page) {
  await page.evaluate(() => {
    window.__copiado = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copiado.push(t); } } });
  });
}
async function abrirHoy(page, opciones = {}) {
  const e = await abrirApp(page, { datos: datos(), ...opciones });
  await expect(tarjeta(page)).toBeVisible();
  return e;
}

test.describe('"Pedidos en curso" en Hoy', () => {
  test('la tarjeta con sus textos exactos, sin "·", y solo los pedidos abiertos de hoy en adelante', async ({ page }) => {
    const d = datos();
    // No entran: un pedido de ayer todavía pendiente, uno ya confirmado y uno pendiente sin filas de la app.
    const base = d.solicitudes.find(s => s.id === ID.sPendiente);
    d.solicitudes.push(
      { ...base, id: '80000000-0000-4000-8000-000000000091', fecha: '2026-10-03' },
      { ...base, id: '80000000-0000-4000-8000-000000000092', estado: 'confirmada' },
      { ...base, id: '80000000-0000-4000-8000-000000000093' },
    );
    for (const sol of ['80000000-0000-4000-8000-000000000091', '80000000-0000-4000-8000-000000000092']) {
      d.solicitud_ninieras.push({ ...d.solicitud_ninieras.find(x => x.id === ID.snPendLola), id: sol.replace('80000000', '85000000'), solicitud_id: sol });
    }
    const e = await abrirApp(page, { datos: d });
    await expect(zona(page).locator('h2')).toHaveText('Pedidos en curso');
    await expect(zona(page).locator('.pedido-curso')).toHaveCount(2);
    // El orden: el más cercano primero.
    await expect(zona(page).locator('.pedido-curso').first()).toHaveAttribute('data-solicitud', ID.sPendiente);
    const t = tarjeta(page);
    await expect(t.locator('.pedido-curso-titulo')).toHaveText('Familia (práctica), miércoles 07/10, de 18:00 a 22:00');
    await expect(t.locator('.sol-envio')).toHaveText('Pueden 2, no puede 1, falta responder 1. Mandado a 4 a las 11:00.');
    await expect(fila(t, 'Niñera (práctica)').locator('.badge')).toHaveText('Puede');
    await expect(fila(t, 'Niñera (práctica)')).toContainText('$200 por hora. Ya fue 2 veces.');
    await expect(fila(t, 'Lola (práctica)')).toContainText('$210 por hora. Nueva para esta familia.');
    await expect(fila(t, 'Carla Ejemplo').locator('.badge')).toHaveText('No puede: Me queda lejos');
    await expect(fila(t, 'Carla Ejemplo')).toContainText('$300 por hora. Nueva para esta familia.');
    await expect(fila(t, 'Mía (práctica)').locator('.badge')).toHaveText('Sin responder');
    // "Asignar" solo en las que pueden.
    await expect(fila(t, 'Niñera (práctica)').locator('button', { hasText: 'Asignar' })).toHaveCount(1);
    await expect(fila(t, 'Lola (práctica)').locator('button', { hasText: 'Asignar' })).toHaveCount(1);
    await expect(fila(t, 'Carla Ejemplo').locator('button')).toHaveCount(0);
    await expect(fila(t, 'Mía (práctica)').locator('button')).toHaveCount(0);
    // Las que pueden, arriba; después las que no respondieron y al final las que no pueden.
    await expect(t.locator('.pedido-curso-fila b')).toHaveText(['Niñera (práctica)', 'Lola (práctica)', 'Mía (práctica)', 'Carla Ejemplo']);
    const botones = t.locator('.pedido-curso-botones button');
    await expect(botones).toHaveText(['Perfiles para la madre', 'Preguntar a más niñeras', 'Todavía buscando', 'No conseguimos', 'Cancelar el pedido']);
    await expect(t.locator('.pedido-curso-botones button', { hasText: 'Perfiles para la madre' })).toHaveClass(/primary/);
    // Sin atajo en este pedido: la madre no pidió a nadie.
    await expect(t).not.toContainText('La pidió la madre');
    expect(await zona(page).textContent()).not.toContain('·');
    // El resto de Hoy sigue como siempre ("Sin resolver" con el pedido de hoy sin niñera).
    await expect(page.locator('#agenda')).toContainText('Familia (práctica)');
    verificarLimpio(e);
  });

  test('el atajo de la niñera que pidió la madre: arriba, "Asignar y confirmar a la madre" va directo a "Asignar"', async ({ page }) => {
    const e = await abrirHoy(page);
    const t = tarjeta(page, ID.sPedida);
    await expect(t.locator('.pedido-curso-titulo')).toHaveText('Familia (práctica), jueves 08/10, de 18:00 a 22:00');
    await expect(t.locator('.sol-envio')).toHaveText('Puede 1, falta responder 1. Mandado a 2 a las 11:00.');
    const pedida = t.locator('.pedido-curso-fila').first();
    await expect(pedida).toHaveClass(/pedido-curso-pedida/);
    await expect(pedida).toContainText('Niñera (práctica)');
    await expect(pedida).toContainText('La pidió la madre y puede');
    await expect(pedida).toContainText('$230 por hora. Ya fue 2 veces.');
    const atajo = pedida.locator('button', { hasText: 'Asignar y confirmar a la madre' });
    await expect(atajo).toHaveClass(/primary/);
    // Con el atajo, "Perfiles para la madre" deja de ser el botón principal.
    await expect(t.locator('.pedido-curso-botones button', { hasText: 'Perfiles para la madre' })).not.toHaveClass(/primary/);
    await atajo.click();
    const p = page.locator('#editmodal .asignar-pedido');
    await expect(p).toBeVisible();
    await expect(p.locator('.asignar-ninera')).toHaveText('Niñera (práctica)');
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('920'); // 4 h a los $230 que se le ofrecieron
    await page.locator('#pedido-asignar-btn').click();
    // Después de asignar sale la confirmación para la madre, y la tarjeta de atrás ya no tiene ese pedido.
    await expect(page.locator('#editmodal .mensaje-madre')).toBeVisible();
    await expect(texto(page)).toHaveValue('¡Hola Familia! Confirmamos a la niñera Niñera (práctica) el jueves 08/10 a las 18:00.');
    await expect(tarjeta(page, ID.sPedida)).toHaveCount(0);
    await expect(tarjeta(page)).toBeVisible();
    verificarLimpio(e);
  });

  test('sin atajo si la que pidió la madre no dijo "Puedo"', async ({ page }) => {
    const d = datos();
    d.solicitudes.find(s => s.id === ID.sPedida).ninera_pedida_id = ID.nMia; // Mía no respondió
    const e = await abrirApp(page, { datos: d });
    const t = tarjeta(page, ID.sPedida);
    await expect(t).toBeVisible();
    await expect(t).not.toContainText('La pidió la madre');
    await expect(t.locator('button', { hasText: 'Asignar y confirmar a la madre' })).toHaveCount(0);
    await expect(fila(t, 'Niñera (práctica)').locator('button', { hasText: 'Asignar' })).toHaveCount(1);
    await expect(t.locator('.pedido-curso-botones button', { hasText: 'Perfiles para la madre' })).toHaveClass(/primary/);
    verificarLimpio(e);
  });

  test('"Asignar" en una que puede abre "Asignar" con ella y, al asignar, el pedido sale de la tarjeta', async ({ page }) => {
    const e = await abrirHoy(page);
    await fila(tarjeta(page), 'Lola (práctica)').locator('button', { hasText: 'Asignar' }).click();
    await expect(page.locator('#editmodal .asignar-ninera')).toHaveText('Lola (práctica)');
    await expect(page.locator('#agenda-asignar-pago')).toHaveValue('840');
    await page.locator('#pedido-asignar-btn').click();
    await expect(page.locator('#editmodal .mensaje-madre')).toBeVisible();
    expect(e.db.solicitudes.find(s => s.id === ID.sPendiente).estado).toBe('confirmada');
    await expect(tarjeta(page)).toHaveCount(0);
    await expect(tarjeta(page, ID.sPedida)).toBeVisible();
    verificarLimpio(e);
  });

  test('"Preguntar a más niñeras" abre "Elegir niñeras" de ese pedido', async ({ page }) => {
    const e = await abrirHoy(page);
    await tarjeta(page).locator('button', { hasText: 'Preguntar a más niñeras' }).click();
    // Va a la Agenda, a la semana del pedido, y abre "Elegir niñeras" ahí.
    await expect(page.locator('#editmodal .pedido-elegir')).toBeVisible();
    await expect(page.locator('#editmodal h2')).toHaveText('Elegir niñeras');
    await expect(page.locator('#agenda-grid-wrap')).toBeVisible();
    expect(await page.evaluate(() => pedidoElegir.s.id)).toBe(ID.sPendiente);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('"Todavía buscando" y "No conseguimos" arman el mensaje y no tocan el pedido', async ({ page }) => {
    const e = await abrirHoy(page);
    await espiarPortapapeles(page);
    await tarjeta(page).locator('button', { hasText: 'Todavía buscando' }).click();
    await expect(modal(page).locator('h2')).toHaveText('Todavía buscando');
    await expect(texto(page)).toHaveValue('¡Hola Familia! Estamos viendo quién puede el miércoles 07/10. Te avisamos a la brevedad.');
    await modal(page).locator('button', { hasText: 'Copiar' }).click();
    await expect.poll(() => page.evaluate(() => window.__copiado)).toEqual(['¡Hola Familia! Estamos viendo quién puede el miércoles 07/10. Te avisamos a la brevedad.']);
    await modal(page).locator('.modal-close').click();
    await expect(modal(page)).toHaveCount(0);
    await tarjeta(page).locator('button', { hasText: 'No conseguimos' }).click();
    await expect(modal(page).locator('h2')).toHaveText('No conseguimos');
    await expect(texto(page)).toHaveValue('¡Hola Familia! Lamentablemente para el miércoles 07/10 no conseguimos a nadie. ¿Te sirve otro horario?');
    await expect(page.locator('#mensaje-madre-wa')).toHaveAttribute('href', /^https:\/\/wa\.me\/59899000090\?text=/);
    // Nada se escribe: "No conseguimos" no cancela ni cambia el pedido.
    expect(escrituras(e, 'solicitudes')).toEqual([]);
    expect(escrituras(e, 'solicitud_ninieras')).toEqual([]);
    expect(e.db.solicitudes.find(s => s.id === ID.sPendiente).estado).toBe('pendiente_confirmar');
    verificarLimpio(e);
  });

  test('"Todavía buscando" de un pedido de hoy dice "hoy"', async ({ page }) => {
    const d = datos();
    d.solicitudes.find(s => s.id === ID.sPendiente).fecha = '2026-10-04';
    const e = await abrirApp(page, { datos: d });
    await expect(tarjeta(page).locator('.pedido-curso-titulo')).toHaveText('Familia (práctica), domingo 04/10, de 18:00 a 22:00');
    await tarjeta(page).locator('button', { hasText: 'Todavía buscando' }).click();
    await expect(texto(page)).toHaveValue('¡Hola Familia! Estamos viendo quién puede hoy. Te avisamos a la brevedad.');
    verificarLimpio(e);
  });

  test('"Cancelar el pedido": pregunta, cancela con un solo toque y el pedido sale de la tarjeta', async ({ page }) => {
    const e = await abrirHoy(page);
    e.demoraEscrituras = 400;
    // Doble toque: el segundo llega con el botón ya deshabilitado (conGuardado) y no abre otra pregunta.
    await tarjeta(page).locator('button', { hasText: 'Cancelar el pedido' }).evaluate(b => { b.click(); b.click(); });
    await expect(page.locator('#confirm-si')).toHaveCount(1);
    await expect(page.locator('.confirmoverlay .confirmmsg')).toHaveText('¿Cancelar el pedido? A las niñeras que dijeron que pueden por la app les llega un aviso de que se canceló.');
    await expect(page.locator('#confirm-si')).toHaveText('Cancelar el pedido');
    await page.locator('#confirm-si').click();
    await expect(tarjeta(page)).toHaveCount(0);
    const cancelaciones = escrituras(e, 'solicitudes', 'PATCH');
    expect(cancelaciones).toHaveLength(1);
    expect(cancelaciones[0].cuerpo).toEqual({ estado: 'cancelada' });
    // Con la condición del estado que tenía en pantalla (dos admins a la vez).
    expect(cancelaciones[0].params).toMatchObject({ id: `eq.${ID.sPendiente}`, estado: 'eq.pendiente_confirmar' });
    expect(e.db.solicitudes.find(s => s.id === ID.sPendiente).estado).toBe('cancelada');
    // El aviso "Se canceló el pedido" lo manda la base (trigger) a las que dijeron "Puedo".
    expect(e.db.avisos.filter(a => /cancelado/.test(a.clave || ''))).toHaveLength(2);
    await expect(tarjeta(page, ID.sPedida)).toBeVisible();
    verificarLimpio(e);
  });

  test('"Cancelar el pedido" después de que otra admin lo asignó: no lo cancela, avisa y la tarjeta se pone al día', async ({ page }) => {
    const e = await abrirHoy(page);
    await tarjeta(page).locator('button', { hasText: 'Cancelar el pedido' }).click();
    await expect(page.locator('#confirm-si')).toBeVisible();
    // Mientras se confirmaba, otra admin asignó a Lola (la solicitud quedó confirmada).
    e.db.solicitudes.find(s => s.id === ID.sPendiente).estado = 'confirmada';
    e.db.solicitud_ninieras.find(x => x.id === ID.snPendLola).estado = 'confirmada';
    await page.locator('#confirm-si').click();
    await expect(toasts(page).last()).toHaveText(/No se canceló: mientras tanto alguien más asignó o canceló este pedido\. Fijate cómo quedó\./);
    expect(e.db.solicitudes.find(s => s.id === ID.sPendiente).estado).toBe('confirmada');
    expect(e.db.solicitud_ninieras.find(x => x.id === ID.snPendLola).estado).toBe('confirmada');
    expect(e.db.avisos.filter(a => /cancelado/.test(a.clave || ''))).toEqual([]);
    await expect(toasts(page).filter({ hasText: 'Cancelad' })).toHaveCount(0);
    await expect(tarjeta(page)).toHaveCount(0); // se volvió a leer: ya no está en curso
    await expect(tarjeta(page, ID.sPedida)).toBeVisible();
    verificarLimpio(e);
  });

  test('desde el modal de la Agenda, una solicitud ya confirmada se cancela con la condición de "confirmada"', async ({ page }) => {
    const d = datos();
    d.solicitudes.find(s => s.id === ID.sUno).estado = 'confirmada';
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'agenda');
    await page.evaluate(async () => { agendaAncla = '2026-10-05'; await cargarAgendaSolicitudes(); });
    await page.evaluate(i => abrirModalSolicitud(i), ID.sUno);
    await modal(page).locator('button', { hasText: 'Cancelar solicitud' }).click();
    await page.locator('#confirm-si').click();
    await expect(modal(page)).toHaveCount(0);
    const [cancelacion] = escrituras(e, 'solicitudes', 'PATCH');
    expect(cancelacion.params).toMatchObject({ id: `eq.${ID.sUno}`, estado: 'eq.confirmada' });
    expect(e.db.solicitudes.find(s => s.id === ID.sUno).estado).toBe('cancelada');
    verificarLimpio(e);
  });

  test('"Cancelar el pedido" que falla: avisa y el pedido sigue en la tarjeta', async ({ page }) => {
    const e = await abrirHoy(page);
    e.fallar = ({ tabla, metodo }) => tabla === 'solicitudes' && metodo === 'PATCH' ? { status: 500, message: 'se cayó' } : null;
    await tarjeta(page).locator('button', { hasText: 'Cancelar el pedido' }).click();
    await page.locator('#confirm-si').click();
    await expect(toasts(page).last()).toContainText('No se pudo');
    await expect(tarjeta(page)).toBeVisible();
    expect(e.db.solicitudes.find(s => s.id === ID.sPendiente).estado).toBe('pendiente_confirmar');
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('"Perfiles para la madre"', () => {
  async function abrirPerfiles(page, id = ID.sPendiente) {
    await tarjeta(page, id).locator('button', { hasText: 'Perfiles para la madre' }).click();
    await expect(modal(page).locator('.perfiles-madre')).toBeVisible();
  }
  const filaPerfil = (page, nombre) => page.locator('#editmodal .perfiles-fila', { hasText: nombre });
  const copiar = page => page.locator('#mensaje-madre-copiar');

  test('solo las que pueden; la que ya fue tildada con solo el nombre; la nueva entra con "Revisé su perfil" y el aviso del CV', async ({ page }) => {
    const d = datos();
    d.ninieras.find(n => n.id === ID.nLola).cv_generado_en = '2026-09-01';
    const e = await abrirApp(page, { datos: d });
    await espiarPortapapeles(page);
    await abrirPerfiles(page);
    await expect(modal(page).locator('h2')).toHaveText('Perfiles para la madre');
    await expect(page.locator('#editmodal .perfiles-fila')).toHaveCount(2); // ni Mía (sin responder) ni Carla (no puede)
    const conocida = filaPerfil(page, 'Niñera (práctica)');
    await expect(conocida).toContainText('Ya fue a esa casa: va solo el nombre.');
    await expect(conocida.locator('input[type=checkbox]')).toBeChecked();
    const nueva = filaPerfil(page, 'Lola (práctica)');
    await expect(nueva).toContainText('Nueva para esta familia.');
    await expect(nueva.locator('label', { hasText: 'Revisé su perfil' }).locator('input')).not.toBeChecked();
    await expect(nueva.locator('button', { hasText: 'Ver ficha' })).toBeVisible();
    await expect(texto(page)).toHaveValue('¡Hola Familia! Te paso las niñeras disponibles para el miércoles 07/10 a las 18:00:\n- Niñera (práctica)\nAvísame cuál preferís y te la confirmo.');
    await expect(page.locator('#perfiles-cv')).toHaveText('');
    await nueva.locator('label', { hasText: 'Revisé su perfil' }).locator('input').check();
    await expect(texto(page)).toHaveValue('¡Hola Familia! Te paso las niñeras disponibles para el miércoles 07/10 a las 18:00:\n- Niñera (práctica)\n- Lola (práctica) (te paso su CV)\nAvísame cuál preferís y te la confirmo.');
    await expect(page.locator('#perfiles-cv')).toHaveText('Adjuntá en WhatsApp el CV de Lola (práctica).');
    await copiar(page).click();
    await expect.poll(() => page.evaluate(() => window.__copiado)).toEqual(['¡Hola Familia! Te paso las niñeras disponibles para el miércoles 07/10 a las 18:00:\n- Niñera (práctica)\n- Lola (práctica) (te paso su CV)\nAvísame cuál preferís y te la confirmo.']);
    expect(await modal(page).textContent()).not.toContain('·');
    // Nada se escribe en el pedido.
    expect(escrituras(e, 'solicitudes')).toEqual([]);
    verificarLimpio(e);
  });

  test('una nueva sin CV generado: "todavía no tiene CV"; varias con CV en una sola línea', async ({ page }) => {
    const d = datos({ conHistorial: false });
    d.ninieras.find(n => n.id === ID.nLola).cv_generado_en = '2026-09-01';
    d.ninieras.find(n => n.id === ID.nPractica).cv_generado_en = '2026-09-02';
    // Mía también puede, y nunca se le generó el CV.
    Object.assign(d.solicitud_ninieras.find(x => x.id === ID.snPendMia), { estado: 'acepto', respondido_en: '2026-10-04T14:10:00.000Z' });
    const e = await abrirApp(page, { datos: d });
    await abrirPerfiles(page);
    await expect(page.locator('#editmodal .perfiles-fila input:checked')).toHaveCount(0); // ninguna fue a esa casa
    for (const n of ['Niñera (práctica)', 'Lola (práctica)', 'Mía (práctica)']) await filaPerfil(page, n).locator('input').check();
    await expect(page.locator('#perfiles-cv .helper')).toHaveText('Adjuntá en WhatsApp el CV de Niñera (práctica) y Lola (práctica).');
    await expect(page.locator('#perfiles-cv .warnbox')).toHaveText('Mía (práctica) todavía no tiene CV: generalo desde su ficha.');
    await expect(texto(page)).toHaveValue(/- Niñera \(práctica\) \(te paso su CV\)\n- Lola \(práctica\) \(te paso su CV\)\n- Mía \(práctica\) \(te paso su CV\)\n/);
    verificarLimpio(e);
  });

  test('sin ninguna tildada, "Copiar" queda gris y no copia', async ({ page }) => {
    const e = await abrirHoy(page);
    await espiarPortapapeles(page);
    await abrirPerfiles(page);
    await expect(copiar(page)).not.toHaveClass(/apagado/);
    await filaPerfil(page, 'Niñera (práctica)').locator('input').uncheck();
    await expect(copiar(page)).toHaveClass(/apagado/);
    await expect(page.locator('#mensaje-madre-falta')).toHaveText('Faltan las niñeras para completar el mensaje.');
    await copiar(page).click();
    await expect(toasts(page).last()).toContainText('Completá lo que falta antes de mandarlo.');
    expect(await page.evaluate(() => window.__copiado)).toEqual([]);
    await filaPerfil(page, 'Niñera (práctica)').locator('input').check();
    await expect(copiar(page)).not.toHaveClass(/apagado/);
    verificarLimpio(e);
  });

  test('"Ver ficha" abre la ficha de la niñera y, al volver, lo tildado sigue', async ({ page }) => {
    const e = await abrirHoy(page);
    await abrirPerfiles(page);
    await filaPerfil(page, 'Lola (práctica)').locator('input').check();
    await filaPerfil(page, 'Lola (práctica)').locator('button', { hasText: 'Ver ficha' }).click();
    await expect(modal(page).locator('h2').first()).toContainText('Lola (práctica)');
    await modal(page).locator('.modal-close').click();
    await expect(modal(page)).toHaveCount(0);
    await abrirPerfiles(page);
    await expect(filaPerfil(page, 'Lola (práctica)').locator('input')).toBeChecked();
    await expect(texto(page)).toHaveValue(/- Lola \(práctica\) \(te paso su CV\)/);
    verificarLimpio(e);
  });

  test('si el pedido ya no está abierto, avisa y no arma el mensaje', async ({ page }) => {
    const e = await abrirHoy(page);
    e.db.solicitudes.find(s => s.id === ID.sPendiente).estado = 'confirmada';
    await tarjeta(page).locator('button', { hasText: 'Perfiles para la madre' }).click();
    await expect(modal(page)).toContainText('Este pedido ya no está abierto');
    await expect(texto(page)).toHaveCount(0);
    verificarLimpio(e);
  });

  test('si falla leer el historial, todas van como nuevas (con "Revisé su perfil") y nada se rompe', async ({ page }) => {
    const e = await abrirHoy(page);
    await page.route(/rest\/v1\/sittings_traslados\?select=ninera_id%2Cninera_nombre%2Cfamilia_id%2Cfamilia_nombre/, r => r.fulfill({ status: 500, json: { code: 'XX000', message: 'se cayó' } }));
    await abrirPerfiles(page);
    await expect(page.locator('#editmodal .perfiles-fila input:checked')).toHaveCount(0);
    await expect(filaPerfil(page, 'Niñera (práctica)').locator('label', { hasText: 'Revisé su perfil' })).toBeVisible();
    await expect(page.locator('#mensaje-madre-falta')).toHaveText('Faltan las niñeras para completar el mensaje.');
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('"Pedidos en curso": lecturas, Realtime y fallas', () => {
  test('una sola lectura del historial para todos los pedidos (por id o por el nombre de la familia)', async ({ page }) => {
    const d = datos();
    // Un tercer pedido, de otra familia: Familia Prueba Uno (Ana ya fue una vez, en datosBase hay sittings suyos).
    const otro = { ...d.solicitudes.find(s => s.id === ID.sPendiente), id: '80000000-0000-4000-8000-000000000094', familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', fecha: '2026-10-09' };
    d.solicitudes.push(otro);
    d.solicitud_ninieras.push({ ...d.solicitud_ninieras.find(x => x.id === ID.snPendLola), id: '85000000-0000-4000-8000-000000000094', solicitud_id: otro.id, ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia' });
    const lecturas = [];
    page.on('request', r => { if (r.method() === 'GET' && r.url().includes('/rest/v1/sittings_traslados?select=ninera_id%2Cninera_nombre%2Cfamilia_id%2Cfamilia_nombre')) lecturas.push(decodeURIComponent(r.url().replace(/\+/g, ' '))); });
    const e = await abrirApp(page, { datos: d });
    await expect(zona(page).locator('.pedido-curso')).toHaveCount(3);
    await esperarQuieta(page);
    expect(lecturas).toHaveLength(1);
    expect(lecturas[0]).toContain('tipo=eq.sitting');
    expect(lecturas[0]).toContain('cancelado=eq.false');
    expect(lecturas[0]).toContain('estado=neq.previsto');
    expect(lecturas[0]).toContain(`familia_id.in.(${ID.fPractica},${ID.fUno})`);
    expect(lecturas[0]).toContain('familia_nombre.in.("Familia (práctica)","Familia Prueba Uno")');
    const veces = e.db.sittings_traslados.filter(s => s.familia_id === ID.fUno && s.ninera_id === ID.nAna && !s.cancelado && s.tipo === 'sitting').length;
    expect(veces).toBeGreaterThan(0);
    await expect(fila(tarjeta(page, otro.id), 'Ana Ficticia')).toContainText(`Ya fue ${veces} ${veces === 1 ? 'vez' : 'veces'}.`);
    verificarLimpio(e);
  });

  test('una respuesta nueva repinta la tarjeta; con un modal abierto espera a que se cierre', async ({ page }) => {
    const e = await abrirHoy(page);
    await expect(tarjeta(page).locator('.sol-envio')).toHaveText('Pueden 2, no puede 1, falta responder 1. Mandado a 4 a las 11:00.');
    const mia = e.db.solicitud_ninieras.find(x => x.id === ID.snPendMia);
    Object.assign(mia, { estado: 'acepto', respondido_en: '2026-10-04T14:20:00.000Z' });
    await expect.poll(() => e.emitirRealtime('solicitud_ninieras', 'UPDATE', mia)).toBeGreaterThan(0);
    await expect(tarjeta(page).locator('.sol-envio')).toHaveText('Pueden 3, no puede 1. Mandado a 4 a las 11:00.');
    await expect(fila(tarjeta(page), 'Mía (práctica)').locator('button', { hasText: 'Asignar' })).toHaveCount(1);
    // Con "Todavía buscando" abierto, otra respuesta no repinta Hoy hasta cerrarlo.
    await tarjeta(page).locator('button', { hasText: 'Todavía buscando' }).click();
    await expect(texto(page)).toBeVisible();
    await texto(page).fill('Escribiendo algo para la madre');
    const lola = e.db.solicitud_ninieras.find(x => x.id === ID.snPendLola);
    Object.assign(lola, { estado: 'no_puedo', motivo_no: 'tarde' });
    e.emitirRealtime('solicitud_ninieras', 'UPDATE', lola);
    await page.waitForTimeout(1500);
    await expect(texto(page)).toHaveValue('Escribiendo algo para la madre');
    await expect(tarjeta(page).locator('.sol-envio')).toHaveText('Pueden 3, no puede 1. Mandado a 4 a las 11:00.');
    await modal(page).locator('.modal-close').click();
    await expect(tarjeta(page).locator('.sol-envio')).toHaveText('Pueden 2, no pueden 2. Mandado a 4 a las 11:00.');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('si falla la lectura de los pedidos, aviso en la tarjeta, el resto de Hoy anda y "Reintentar" la vuelve a leer', async ({ page }) => {
    const falla = /rest\/v1\/solicitudes\?select=id%2Cfamilia_id.*estado=eq\.pendiente_confirmar/;
    const e = await abrirApp(page, { datos: datos() });
    // La ruta del simulador se registró antes: la última registrada gana. Se vuelve a pintar Hoy con la falla.
    await page.route(falla, r => r.fulfill({ status: 500, json: { code: 'XX000', message: 'se cayó' } }));
    await page.evaluate(() => setModulo(null));
    await expect(zona(page)).toContainText('No se pudieron cargar los pedidos en curso.');
    await expect(page.locator('#agenda')).toContainText('Familia (práctica)');
    await expect(page.locator('#statrow .statnum').first()).not.toHaveText('—');
    await page.unroute(falla);
    await zona(page).locator('button', { hasText: 'Reintentar' }).click();
    await expect(tarjeta(page)).toBeVisible();
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('si falla la lectura del historial, la tarjeta sale igual sin "Ya fue" ni "Nueva"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await page.route(/rest\/v1\/sittings_traslados\?select=ninera_id%2Cninera_nombre%2Cfamilia_id%2Cfamilia_nombre/, r => r.fulfill({ status: 500, json: { code: 'XX000', message: 'se cayó' } }));
    await page.evaluate(() => setModulo(null));
    await expect(tarjeta(page)).toBeVisible();
    await expect(fila(tarjeta(page), 'Niñera (práctica)').locator('.helper')).toHaveText('$200 por hora.');
    await expect(tarjeta(page)).not.toContainText('Ya fue');
    await expect(tarjeta(page)).not.toContainText('Nueva para esta familia');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('base sin la migración de la etapa 6: la tarjeta anda igual', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos(), baseSinMigrar: 'etapa6' });
    await expect(tarjeta(page).locator('.sol-envio')).toHaveText('Pueden 2, no puede 1, falta responder 1. Mandado a 4 a las 11:00.');
    await expect(tarjeta(page, ID.sPedida)).toContainText('La pidió la madre y puede');
    // Los 404 son del chat y los avisos, que el simulador también saca con 'etapa6'.
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('base sin la migración de la etapa 5: sin tarjeta y Hoy entero', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos(), baseSinMigrar: 'etapa5' });
    await expect(page.locator('#agenda')).toContainText('Familia (práctica)');
    await esperarQuieta(page);
    await expect(zona(page)).toHaveText('');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('escape: nombres y motivo con HTML y comillas salen como texto y los botones siguen andando', async ({ page }) => {
    const d = datos();
    const raro = 'Fam "Rara" <img src=x onerror=window.__xss=1>';
    d.familias.find(f => f.id === ID.fPractica).nombre = raro;
    d.solicitudes.filter(s => s.familia_id === ID.fPractica).forEach(s => { s.familia_nombre = raro; });
    const lola = d.solicitud_ninieras.find(x => x.id === ID.snPendLola);
    lola.ninera_nombre = "Lola 'O\"Neil' <b>x</b>";
    Object.assign(d.solicitud_ninieras.find(x => x.id === SN_CARLA), { motivo_no: 'otro', motivo_texto: '<script>window.__xss=2</script>' });
    const e = await abrirApp(page, { datos: d });
    const t = tarjeta(page);
    await expect(t.locator('.pedido-curso-titulo')).toHaveText(`${raro}, miércoles 07/10, de 18:00 a 22:00`);
    await expect(fila(t, 'Lola')).toContainText("Lola 'O\"Neil' <b>x</b>");
    await expect(fila(t, 'Carla Ejemplo').locator('.badge')).toHaveText('No puede: <script>window.__xss=2</script>');
    await expect(page.locator('#dash-pedidos img, #dash-pedidos script, #dash-pedidos .pedido-curso-fila b b')).toHaveCount(0);
    await fila(t, 'Lola').locator('button', { hasText: 'Asignar' }).click();
    await expect(page.locator('#editmodal .asignar-ninera')).toHaveText("Lola 'O\"Neil' <b>x</b>");
    await modal(page).locator('.modal-close').click();
    await tarjeta(page).locator('button', { hasText: 'Perfiles para la madre' }).click();
    await expect(page.locator('#editmodal .perfiles-fila', { hasText: 'Lola' })).toBeVisible();
    await page.locator('#editmodal .perfiles-fila', { hasText: 'Lola' }).locator('input').check();
    await expect(texto(page)).toHaveValue(/- Lola 'O"Neil' <b>x<\/b> \(te paso su CV\)/);
    await expect(page.locator('#editmodal img, #editmodal script')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e, { ignorar: [/ejemplo\.test|Failed to load resource/] });
  });

  for (const ancho of [390, 1280]) {
    test(`a ${ancho} px: sin scroll de costado y los botones a la vista`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: ancho === 390 ? 844 : 900 });
      const e = await abrirHoy(page);
      await tarjeta(page, ID.sPedida).scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ancho);
      for (const b of await tarjeta(page).locator('button').all()) {
        const caja = await b.boundingBox();
        expect(caja.x).toBeGreaterThanOrEqual(0);
        expect(caja.x + caja.width).toBeLessThanOrEqual(ancho);
      }
      await zona(page).screenshot({ path: `test-results/pedidos-en-curso-${ancho}.png` });
      await tarjeta(page).locator('button', { hasText: 'Perfiles para la madre' }).click();
      await expect(modal(page).locator('.perfiles-madre')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ancho);
      await modal(page).locator('.confirmbox').screenshot({ path: `test-results/perfiles-madre-${ancho}.png` });
      verificarLimpio(e);
    });
  }
});

test.describe('"Pedidos en curso" en el modal de la solicitud (Agenda)', () => {
  test('el mismo detalle que en Hoy: respuestas, "Ya fue", "Asignar", atajo y los botones', async ({ page }) => {
    const e = await abrirApp(page, { datos: datos() });
    await irAModulo(page, 'agenda');
    await page.evaluate(async () => { agendaAncla = '2026-10-05'; await cargarAgendaSolicitudes(); });
    await page.evaluate(i => abrirModalSolicitud(i), ID.sPendiente);
    const m = modal(page);
    await expect(m.locator('h2').first()).toHaveText('Familia (práctica)');
    await expect(m.locator('.sol-envio')).toHaveText('Pueden 2, no puede 1, falta responder 1. Mandado a 4 a las 11:00.');
    await expect(fila(m, 'Niñera (práctica)')).toContainText('$200 por hora. Ya fue 2 veces.');
    await expect(fila(m, 'Lola (práctica)').locator('button', { hasText: 'Asignar' })).toHaveCount(1);
    await expect(fila(m, 'Carla Ejemplo').locator('button')).toHaveCount(0);
    await expect(m.locator('.pedido-curso-botones button')).toHaveText(['Perfiles para la madre', 'Preguntar a más niñeras', 'Todavía buscando', 'No conseguimos', 'Cancelar el pedido']);
    await expect(m.locator('button', { hasText: 'Cancelar solicitud' })).toHaveCount(0);
    await m.locator('button', { hasText: 'Perfiles para la madre' }).click();
    await expect(m.locator('.perfiles-madre')).toBeVisible();
    await page.evaluate(i => abrirModalSolicitud(i), ID.sPedida);
    await expect(m.locator('.pedido-curso-pedida')).toContainText('La pidió la madre y puede');
    await m.locator('button', { hasText: 'Asignar y confirmar a la madre' }).click();
    await expect(m.locator('.asignar-ninera')).toHaveText('Niñera (práctica)');
    verificarLimpio(e);
  });
});
