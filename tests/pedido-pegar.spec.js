// "Pegar WhatsApp" (fase 1, etapa 5, tarea 5.6, 02/11/2026): en la Agenda, la admin pega el mensaje de la
// madre, la Edge Function pedido-whatsapp arma el ticket (simulada: estado.funciones), la admin lo revisa y
// lo corrige, y "Revisar y elegir niñeras" lo pasa a la Agenda: primero toma el pedido (estado
// 'confirmado' con la condición de que siga en 'borrador'), después crea la solicitud y al final le pone
// solicitud_id (ahí sale el aviso "Pedido nuevo" a las otras admins), y abre "Elegir niñeras".
// Datos inventados (datosPedidos): hoy es domingo 04/10/2026; el ticket por defecto es de Familia Prueba
// Uno (Pocitos, dos chicos cargados, tarifa $380), el martes 06/10 de 20 a 23, con una duda y Carla como
// la niñera que pide la madre. Familia Prueba Dos no tiene chicos ni dirección.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosPedidos, ID } = require('./support/datos');

const RUIDO_4XX = /status of 4\d\d/;
const TEXTO = 'Hola! Necesito alguien el martes de 20 a 23, son los dos chicos. Si puede Carla mejor.';

const escrituras = (e, tabla, metodo) => e.escrituras.filter(w => w.tabla === tabla && (!metodo || w.metodo === metodo));
const llamadas = e => escrituras(e, '/functions/v1/pedido-whatsapp');
const modal = page => page.locator('#editmodal');
const ticket = page => page.locator('#editmodal .pedido-ticket');
const warnTicket = page => page.locator('#pedido-ticket-warn');
const boton = (page, texto) => page.locator('#editmodal button', { hasText: texto });
const toastCon = (page, texto, tipo = '') => page.locator(`.toaststack .toast${tipo}`, { hasText: texto });

function soloPracticaApagado(e) {
  e.db.app_config.find(c => c.id === 'pedidos_app').valor.solo_practica = false;
}

// El ticket que "devuelve el modelo": el de siempre con lo que cambia cada test. Se guarda en la base
// simulada como lo hace la función real.
let nPedido = 0;
function conTicket(e, extra = {}) {
  e.funciones['pedido-whatsapp'] = (cuerpo = {}) => {
    const fila = {
      id: `83000000-0000-4000-8000-${String(++nPedido).padStart(12, '0')}`, creado_el: '2026-10-04T15:00:00Z', creado_por: 'Paula Prueba',
      texto: cuerpo.texto ?? '', estado: 'borrador', tipo: 'pedido_nuevo', familia_id: ID.fUno, familia_texto: 'Prueba Uno', servicio: 'sitting',
      fecha: '2026-10-06', hora_inicio: '20:00', hora_fin: '23:00', termina_dia_siguiente: false, horario_aproximado: false, horario_nota: null,
      chicos_cantidad: 2, chicos_edades: '3 y 5 años', zona: 'Pocitos', ninera_pedida: 'Carla Ejemplo', notas: null,
      dudas: ['No queda claro si hay que dar de cenar.'], cobro_estimado: 1140, pago_estimado: 750, solicitud_id: null, ...extra,
    };
    (e.db.pedidos_whatsapp = e.db.pedidos_whatsapp || []).push(fila);
    return { json: { pedido: fila } };
  };
}
function errorDeFuncion(e, status, error) {
  e.funciones['pedido-whatsapp'] = () => ({ status, json: { error } });
}

async function abrirPegar(page) {
  await irAModulo(page, 'agenda');
  await page.locator('.mesbar button', { hasText: 'Pegar WhatsApp' }).click();
  await expect(modal(page).locator('.pedido-pegar')).toBeVisible();
}
async function armar(page, texto = TEXTO) {
  await abrirPegar(page);
  await page.fill('#pedido-texto', texto);
  await boton(page, 'Armar pedido').click();
  await expect(ticket(page)).toBeVisible();
  await esperarQuieta(page);
}
async function esEsta(page) {
  await boton(page, 'Es esta').click();
  await expect(page.locator('#pedido-familia-box')).toContainText('✓');
  await esperarQuieta(page);
}
async function hora(page, prefijo, hhmm) {
  const [hh, mm] = hhmm.split(':');
  await page.selectOption(`#${prefijo}-hh`, hh);
  await page.selectOption(`#${prefijo}-mm`, mm);
}

test.describe('Pegar WhatsApp: del mensaje al ticket', () => {
  test('caso feliz: el cuerpo exacto a la función, el ticket, y la solicitud en la Agenda con "Elegir niñeras" abierto', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    await abrirPegar(page);
    await expect(modal(page)).toContainText('Pegá el mensaje de la madre. Podés pegar varios mensajes seguidos.');
    await page.fill('#pedido-texto', TEXTO);
    await boton(page, 'Armar pedido').click();
    await expect(ticket(page)).toBeVisible();
    await esperarQuieta(page);
    expect(llamadas(e)).toHaveLength(1);
    expect(JSON.parse(llamadas(e)[0].cuerpo)).toEqual({ texto: TEXTO });

    // El ticket: el mensaje pegado (plegable), la familia propuesta, el horario, los chicos de la ficha, la
    // niñera que pidió la madre precargada, el precio esperado y la duda.
    await expect(modal(page).locator('h2')).toHaveText('Pedido nuevo de WhatsApp');
    await expect(modal(page).locator('details.pedido-msg')).toContainText(TEXTO);
    await expect(page.locator('#pedido-familia-box')).toContainText('Familia Prueba Uno');
    await expect(page.locator('#pedido-fecha')).toHaveValue('2026-10-06');
    await expect(page.locator('#pedido-hi-hh')).toHaveValue('20');
    await expect(page.locator('#pedido-hf-hh')).toHaveValue('23');
    await expect(page.locator('#pedido-cruza')).not.toBeChecked();
    await expect(page.locator('#pedido-ninera')).toHaveValue('Carla Ejemplo');
    await expect(page.locator('#pedido-precio')).toContainText('Precio esperado para la madre: $1.140 (3 h × $380)');
    await expect(page.locator('#pedido-ticket-dudas')).toContainText('A confirmar: No queda claro si hay que dar de cenar.');
    await expect(page.locator('#pedido-zonas-checklist input[value="Pocitos"]')).toBeChecked();

    await esEsta(page);
    await expect(page.locator('#pedido-chicos')).toContainText('2 chicos (3 y 5 años)');
    await expect(page.locator('#pedido-direccion-box')).toHaveCount(0); // Familia Prueba Uno ya tiene dirección
    await page.fill('#pedido-notas', 'Tomás es alérgico al maní.');

    e.escrituras.length = 0;
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(modal(page).locator('.pedido-elegir')).toBeVisible();
    await esperarQuieta(page);

    // En este orden: se toma el pedido, se crea la solicitud y se le pone solicitud_id.
    const orden = e.escrituras.filter(w => ['pedidos_whatsapp', 'solicitudes'].includes(w.tabla) && w.metodo !== 'GET');
    expect(orden.map(w => `${w.metodo} ${w.tabla}`)).toEqual(['PATCH pedidos_whatsapp', 'POST solicitudes', 'PATCH pedidos_whatsapp']);
    const pid = e.db.pedidos_whatsapp[0].id;
    expect(orden[0].cuerpo).toEqual({ estado: 'confirmado' });
    expect(orden[0].params).toMatchObject({ id: `eq.${pid}`, estado: 'eq.borrador' });
    expect(orden[1].cuerpo).toEqual({
      familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', tipo: 'sitting', zona: 'Pocitos', fecha: '2026-10-06',
      hora_inicio: '20:00', hora_fin: '23:00', termina_dia_siguiente: false, cobro_familia: 1140, estado: 'sin_asignar',
      ninera_pedida_id: ID.nCarla, notas_para_ninera: 'Tomás es alérgico al maní.',
    });
    const sol = e.db.solicitudes.find(s => s.familia_nombre === 'Familia Prueba Uno' && s.notas_para_ninera);
    expect(orden[2].cuerpo).toEqual({ solicitud_id: sol.id });
    expect(orden[2].params).toMatchObject({ id: `eq.${pid}` });
    expect(e.db.pedidos_whatsapp[0]).toMatchObject({ estado: 'confirmado', solicitud_id: sol.id });
    // El trigger avisa a las otras admins.
    expect(e.db.avisos.some(a => a.clave === `admin:pedido:${sol.id}:nuevo`)).toBe(true);
    // La Agenda quedó en esa semana y "Elegir niñeras" es de esa solicitud.
    await expect(page.locator('#agenda-fecha-label')).toHaveText('6–12 oct');
    await expect(modal(page).locator('.pedido-resumen')).toContainText('Familia Prueba Uno');
    await expect(modal(page).locator('.pedido-resumen')).toContainText('20:00–23:00');
    verificarLimpio(e);
  });

  test('sin tocar "Es esta" no se pasa a la Agenda; "Otra familia" busca otra y recalcula precio, chicos y dirección', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    await armar(page);
    e.escrituras.length = 0;
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(warnTicket(page)).toContainText('Confirmá la familia');
    expect(escrituras(e, 'solicitudes', 'POST')).toHaveLength(0);
    expect(escrituras(e, 'pedidos_whatsapp', 'PATCH')).toHaveLength(0);

    await boton(page, 'Otra familia').click();
    await page.fill('#pedido-familia', 'dos');
    await page.locator('#pedido-familia-dropdown .autocomplete-item', { hasText: 'Familia Prueba Dos' }).dispatchEvent('mousedown');
    await esperarQuieta(page);
    await expect(page.locator('#pedido-familia-box')).toContainText('Familia Prueba Dos');
    await expect(page.locator('#pedido-familia-box')).toContainText('✓');
    await expect(page.locator('#pedido-precio')).toContainText('$1.200 (3 h × $400)');
    await expect(page.locator('#pedido-chicos')).toContainText('Faltan los chicos');
    await expect(page.locator('#pedido-direccion-box')).toContainText('Falta la dirección de Familia Prueba Dos');
    // Lo demás del ticket no se tocó.
    await expect(page.locator('#pedido-fecha')).toHaveValue('2026-10-06');
    await expect(page.locator('#pedido-ninera')).toHaveValue('Carla Ejemplo');

    // "Cambiar" vuelve al buscador.
    await boton(page, 'Cambiar').click();
    await expect(page.locator('#pedido-familia')).toBeVisible();
    verificarLimpio(e);
  });

  test('familia nueva: la ficha se completa ahí mismo sin perder el ticket, se cargan los chicos y se crea la solicitud con ella', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    conTicket(e, { familia_id: null, familia_texto: 'Familia Nueva Tres', ninera_pedida: null, notas: 'Llevar juegos', dudas: [] });
    await armar(page);
    await expect(page.locator('#pedido-familia')).toHaveValue('Familia Nueva Tres');
    await expect(page.locator('#pedido-notas')).toHaveValue('Llevar juegos');
    const crear = page.locator('#pedido-familia-create button', { hasText: 'Familia nueva' });
    await expect(crear).toHaveText('+ Familia nueva "Familia Nueva Tres"');
    await crear.click();
    await expect(page.locator('#pedido-familia-nueva')).toContainText('Familia nueva');
    await page.fill('#pedfam-telefono', '099000123');
    await page.fill('#pedfam-cobro', '400');
    await page.locator('#pedido-familia-nueva button', { hasText: 'Crear familia' }).click();
    await expect(page.locator('#pedido-familia-box')).toContainText('Familia Nueva Tres');
    await expect(page.locator('#pedido-familia-box')).toContainText('✓');
    await esperarQuieta(page);
    const [fam] = escrituras(e, 'familias', 'POST');
    expect(fam.cuerpo).toEqual({ nombre: 'Familia Nueva Tres', telefono: '099000123', direccion: '', zona: '', cobro_hora: 400, pago_hora: null });
    const idNueva = e.db.familias.find(f => f.nombre === 'Familia Nueva Tres').id;
    // El ticket sigue como estaba y el precio sale de la tarifa nueva.
    await expect(page.locator('#pedido-fecha')).toHaveValue('2026-10-06');
    await expect(page.locator('#pedido-notas')).toHaveValue('Llevar juegos');
    await expect(page.locator('#pedido-precio')).toContainText('$1.200 (3 h × $400)');

    // Sin chicos no se manda: se cargan acá, uno por uno.
    await expect(page.locator('#pedido-chicos')).toContainText('Faltan los chicos');
    await boton(page, '+ Agregar').click();
    await page.fill('#pedido-hijo-edad', '4');
    await page.locator('#pedido-chicos button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#pedido-chicos')).toContainText('1 chico (4 años)');
    expect(escrituras(e, 'hijos_familia', 'POST')[0].cuerpo).toEqual({ familia_id: idNueva, nombre: null, edad_declarada: 4, edad_declarada_en: '2026-10-04', orden: 0 });

    await boton(page, 'Después').click(); // la dirección queda para después
    await expect(page.locator('#pedido-direccion-box')).toHaveCount(0);
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(modal(page).locator('.pedido-elegir')).toBeVisible();
    const [sol] = escrituras(e, 'solicitudes', 'POST');
    expect(sol.cuerpo).toMatchObject({ familia_id: idNueva, familia_nombre: 'Familia Nueva Tres', cobro_familia: 1200, notas_para_ninera: 'Llevar juegos' });
    expect(sol.cuerpo).not.toHaveProperty('ninera_pedida_id');
    verificarLimpio(e);
  });

  test('sin chicos cargados "Revisar y elegir niñeras" no sigue hasta agregar uno (con nombre opcional)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    conTicket(e, { familia_id: ID.fDos, familia_texto: 'Prueba Dos', zona: null, dudas: [] });
    await armar(page);
    await esEsta(page);
    await expect(page.locator('#pedido-chicos')).toContainText('Faltan los chicos');
    // El mensaje decía dos chicos: se ve como ayuda, pero no cuenta (solo los cargados uno por uno).
    await expect(page.locator('#pedido-chicos')).toContainText('En el mensaje: 2 chicos, 3 y 5 años');
    // Sin zona en el ticket, la de la familia.
    await expect(page.locator('#pedido-zonas-checklist input[value="Carrasco"]')).toBeChecked();
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(warnTicket(page)).toContainText('Faltan los chicos de la familia');
    expect(escrituras(e, 'solicitudes', 'POST')).toHaveLength(0);
    expect(escrituras(e, 'pedidos_whatsapp', 'PATCH')).toHaveLength(0);

    // Una edad que no es válida no se guarda.
    await boton(page, '+ Agregar').click();
    await page.fill('#pedido-hijo-edad', '');
    await page.locator('#pedido-chicos button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#pedido-chicos')).toContainText('Poné la edad');
    expect(escrituras(e, 'hijos_familia', 'POST')).toHaveLength(0);

    await page.fill('#pedido-hijo-edad', '6');
    await page.fill('#pedido-hijo-nombre', 'Lucía Inventada');
    await page.locator('#pedido-chicos button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#pedido-chicos')).toContainText('1 chico (6 años)');
    expect(escrituras(e, 'hijos_familia', 'POST')[0].cuerpo).toEqual({ familia_id: ID.fDos, nombre: 'Lucía Inventada', edad_declarada: 6, edad_declarada_en: '2026-10-04', orden: 0 });
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(modal(page).locator('.pedido-elegir')).toBeVisible();
    // "Elegir niñeras" lee los chicos de la ficha: ya no avisa que faltan.
    await expect(modal(page)).not.toContainText('Faltan los chicos');
    expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ familia_id: ID.fDos, zona: 'Carrasco', cobro_familia: 1200 });
    verificarLimpio(e);
  });

  test('si la base falla al guardar el chico, avisa y no lo da por cargado', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    conTicket(e, { familia_id: ID.fDos, dudas: [] });
    await armar(page);
    await esEsta(page);
    await boton(page, '+ Agregar').click();
    await page.fill('#pedido-hijo-edad', '6');
    e.fallar = ({ tabla, metodo }) => (tabla === 'hijos_familia' && metodo === 'POST' ? { status: 500, message: 'falla simulada' } : undefined);
    await page.locator('#pedido-chicos button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#pedido-chicos')).toContainText('falla simulada');
    await expect(page.locator('#pedido-chicos')).toContainText('Faltan los chicos');
    await expect(page.locator('#pedido-hijo-edad')).toHaveValue('6');
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('la dirección: "Guardar" la escribe en la familia y "Después" no bloquea', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    conTicket(e, { familia_id: ID.fDos, dudas: [] });
    await armar(page);
    await esEsta(page);
    await expect(page.locator('#pedido-direccion-box')).toContainText('La niñera la ve recién cuando la eligen.');
    await page.locator('#pedido-direccion-box button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#pedido-direccion-box')).toContainText('Escribí la dirección');
    expect(escrituras(e, 'familias', 'PATCH')).toHaveLength(0);
    await page.fill('#pedido-direccion', 'Calle Inventada 789, apto 2');
    await page.locator('#pedido-direccion-box button', { hasText: 'Guardar' }).click();
    await expect(page.locator('#pedido-direccion-box')).toContainText('Dirección guardada.');
    const [w] = escrituras(e, 'familias', 'PATCH');
    expect(w.cuerpo).toEqual({ direccion: 'Calle Inventada 789, apto 2' });
    expect(w.params).toMatchObject({ id: `eq.${ID.fDos}` });
    expect(e.db.familias.find(f => f.id === ID.fDos).direccion).toBe('Calle Inventada 789, apto 2');
    verificarLimpio(e);
  });

  test('"Guardar sin mandar" crea la solicitud sin chicos ni dirección y no abre "Elegir niñeras"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    conTicket(e, { familia_id: ID.fDos, dudas: [] });
    await armar(page);
    await esEsta(page);
    await boton(page, 'Guardar sin mandar').click();
    await expect(modal(page)).toHaveCount(0);
    await expect(toastCon(page, 'Solicitud guardada en la Agenda.')).toBeVisible();
    const [sol] = escrituras(e, 'solicitudes', 'POST');
    expect(sol.cuerpo).toMatchObject({ familia_id: ID.fDos, estado: 'sin_asignar' });
    const creada = e.db.solicitudes.find(s => s.id !== '80000000-0000-4000-8000-000000000001' && s.familia_id === ID.fDos);
    expect(e.db.pedidos_whatsapp[0]).toMatchObject({ estado: 'confirmado', solicitud_id: creada.id });
    await expect(page.locator('#agenda-fecha-label')).toHaveText('6–12 oct');
    verificarLimpio(e);
  });
});

test.describe('Pegar WhatsApp: dudas, horarios y traslados', () => {
  test('las dudas se guardan en el pedido: "Enviar" queda en gris en "Elegir niñeras" hasta "Ya lo confirmé"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    soloPracticaApagado(e);
    await armar(page);
    await esEsta(page);
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(modal(page).locator('.pedido-elegir')).toBeVisible();
    await esperarQuieta(page);
    await page.locator(`#editmodal .pedido-tilde[data-id="${ID.nCarla}"]`).check();
    await expect(page.locator('#pedido-enviar')).toBeDisabled();
    await expect(page.locator('#pedido-dudas')).toContainText('A confirmar: No queda claro si hay que dar de cenar.');
    await page.locator('#pedido-dudas button', { hasText: 'Ya lo confirmé' }).click();
    await expect(page.locator('#pedido-enviar')).toBeEnabled();
    expect(e.db.pedidos_whatsapp[0].dudas).toEqual([]);
    verificarLimpio(e);
  });

  test('en el ticket, "Ya lo confirmé" saca una duda y "Mandar igual" las vacía (guardado en el pedido)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    conTicket(e, { dudas: ['La hora de vuelta.', 'Si hay que dar de cenar.', 'Si va el perro.'] });
    await armar(page);
    const pid = e.db.pedidos_whatsapp[0].id;
    await page.locator('#pedido-ticket-dudas .pedido-duda', { hasText: 'Si hay que dar de cenar.' }).locator('button').click();
    await expect(page.locator('#pedido-ticket-dudas .pedido-duda')).toHaveCount(2);
    let w = escrituras(e, 'pedidos_whatsapp', 'PATCH');
    expect(w[0].cuerpo).toEqual({ dudas: ['La hora de vuelta.', 'Si va el perro.'] });
    expect(w[0].params).toMatchObject({ id: `eq.${pid}` });
    await boton(page, 'Mandar igual').click();
    await expect(page.locator('#pedido-ticket-dudas .pedido-duda')).toHaveCount(0);
    w = escrituras(e, 'pedidos_whatsapp', 'PATCH');
    expect(w[1].cuerpo).toEqual({ dudas: [] });
    expect(e.db.pedidos_whatsapp[0].dudas).toEqual([]);
    // Si la base falla, la duda sigue y se avisa.
    conTicket(e, { dudas: ['Otra duda.'] });
    await page.locator('#editmodal .modal-close').click();
    await expect(modal(page)).toHaveCount(0);
    await armar(page);
    e.fallar = ({ tabla, metodo }) => (tabla === 'pedidos_whatsapp' && metodo === 'PATCH' ? { status: 500, message: 'falla simulada' } : undefined);
    await page.locator('#pedido-ticket-dudas button', { hasText: 'Ya lo confirmé' }).click();
    await expect(page.locator('#pedido-ticket-dudas')).toContainText('No se guardó: falla simulada');
    await expect(page.locator('#pedido-ticket-dudas .pedido-duda')).toHaveCount(1);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('sin hora de fin: marca "aproximado", "Sin total hasta que se sepa la hora de fin" y la solicitud sin fin ni cobro', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    conTicket(e, { hora_fin: null, horario_aproximado: true, horario_nota: 'sin hora de fin, no antes de las 2', dudas: [] });
    await armar(page);
    await expect(page.locator('#editmodal .pedido-aprox')).toHaveText('aproximado');
    await expect(ticket(page)).toContainText('sin hora de fin, no antes de las 2');
    await expect(page.locator('#pedido-hf-hh')).toHaveValue('');
    await expect(page.locator('#pedido-precio')).toContainText('Sin total hasta que se sepa la hora de fin.');
    await esEsta(page);
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(modal(page).locator('.pedido-elegir')).toBeVisible();
    expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ hora_inicio: '20:00', hora_fin: null, termina_dia_siguiente: false, cobro_familia: null });
    await expect(modal(page).locator('.pedido-resumen')).toContainText('20:00, sin hora de fin');
    verificarLimpio(e);
  });

  test('cruza la medianoche: precio por 4,5 h, la casilla marcada y mal marcada no deja seguir', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    conTicket(e, { hora_fin: '00:30', termina_dia_siguiente: true, horario_aproximado: true, dudas: [] });
    await armar(page);
    await expect(page.locator('#pedido-cruza')).toBeChecked();
    await expect(page.locator('#pedido-precio')).toContainText('$1.710 (4.5 h × $380)');
    await esEsta(page);
    // Sin la casilla, el fin queda antes del inicio: no se guarda.
    await page.locator('#pedido-cruza').uncheck();
    await expect(page.locator('#pedido-precio')).not.toContainText('$');
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(warnTicket(page)).toContainText('Termina al día siguiente');
    expect(escrituras(e, 'solicitudes', 'POST')).toHaveLength(0);
    // Con la casilla y un fin después del inicio: el aviso de siempre.
    await page.locator('#pedido-cruza').check();
    await hora(page, 'pedido-hf', '22:00');
    await expect(page.locator('#pedido-precio')).toContainText('más de 24 horas');
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(warnTicket(page)).toContainText('más de 24 horas');
    expect(escrituras(e, 'solicitudes', 'POST')).toHaveLength(0);
    await hora(page, 'pedido-hf', '00:30');
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(modal(page).locator('.pedido-elegir')).toBeVisible();
    expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ hora_inicio: '20:00', hora_fin: '00:30', termina_dia_siguiente: true, cobro_familia: 1710 });
    await expect(modal(page).locator('.pedido-resumen')).toContainText('20:00–00:30 del día siguiente');
    verificarLimpio(e);
  });

  test('traslado: crea la solicitud sin pedir chicos y abre la misma pantalla, sin casillas de la app', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    soloPracticaApagado(e);
    conTicket(e, { familia_id: ID.fDos, servicio: 'traslado', hora_inicio: '08:00', hora_fin: null, dudas: [], ninera_pedida: null });
    await armar(page);
    await expect(page.locator('#pedido-tipo')).toHaveValue('traslado');
    await expect(page.locator('#pedido-precio')).toContainText('El precio del traslado se calcula con los km al asignarlo.');
    await esEsta(page);
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(modal(page).locator('.pedido-elegir')).toBeVisible();
    await esperarQuieta(page);
    expect(escrituras(e, 'solicitudes', 'POST')[0].cuerpo).toMatchObject({ tipo: 'traslado', hora_inicio: '08:00', hora_fin: null, cobro_familia: null });
    await expect(page.locator('#editmodal .pedido-tilde')).toHaveCount(0);
    verificarLimpio(e);
  });
});

test.describe('Pegar WhatsApp: no es un pedido nuevo', () => {
  test('una cancelación no crea solicitud: muestra los pedidos próximos de la familia con "Abrir" y "Descartar"', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    conTicket(e, { tipo: 'cancelacion', dudas: [] });
    await armar(page);
    await expect(ticket(page)).toContainText('Esto parece una cancelación, no un pedido nuevo.');
    await expect(boton(page, 'Revisar y elegir niñeras')).toHaveCount(0);
    const proximo = page.locator('#editmodal .pedido-proximo');
    await expect(proximo).toHaveCount(1);
    await expect(proximo).toContainText('20:00–23:00');
    await proximo.locator('button', { hasText: 'Abrir' }).click();
    await expect(modal(page).locator('h2')).toHaveText('Familia Prueba Uno');
    await expect(modal(page)).toContainText('Cancelar solicitud');
    await expect(page.locator('#agenda-fecha-label')).toHaveText('6–12 oct');
    expect(escrituras(e, 'solicitudes', 'POST')).toHaveLength(0);
    verificarLimpio(e);
  });

  test('"Descartar" deja el pedido descartado (con la condición de que siga en borrador)', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    conTicket(e, { tipo: 'cambio', dudas: [] });
    await armar(page);
    await expect(ticket(page)).toContainText('Esto parece un cambio, no un pedido nuevo.');
    await boton(page, 'Descartar').click();
    await expect(modal(page)).toHaveCount(0);
    const [w] = escrituras(e, 'pedidos_whatsapp', 'PATCH');
    expect(w.cuerpo).toEqual({ estado: 'descartado' });
    expect(w.params).toMatchObject({ estado: 'eq.borrador' });
    expect(e.db.pedidos_whatsapp[0].estado).toBe('descartado');
    expect(escrituras(e, 'solicitudes', 'POST')).toHaveLength(0);
    verificarLimpio(e);
  });

  test('otra cosa sin familia reconocida: lo dice y no lista pedidos', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    conTicket(e, { tipo: 'otra_cosa', familia_id: null, familia_texto: null, dudas: [] });
    await armar(page);
    await expect(ticket(page)).toContainText('Esto parece otra cosa, no un pedido nuevo.');
    await expect(ticket(page)).toContainText('No se reconoció la familia');
    await expect(page.locator('#editmodal .pedido-proximo')).toHaveCount(0);
    verificarLimpio(e);
  });
});

test.describe('Pegar WhatsApp: fallas y dos admins', () => {
  const CASOS = [
    [400, 'El texto es muy largo (máximo 6000 caracteres): pegá solo los mensajes del pedido.'],
    [401, 'Sesión vencida: volvé a entrar'],
    [403, 'Esta cuenta no tiene acceso'],
    [422, 'El asistente no devolvió un ticket válido. Probá de nuevo o cargalo a mano.'],
    [429, 'Llegaste al máximo de pedidos de hoy, avisale a Diego'],
    [502, 'No se pudo hablar con el asistente: probá de nuevo'],
    [503, 'La clave de Anthropic no es válida: avisale a Diego'],
  ];
  for (const [status, mensaje] of CASOS) {
    test(`la función responde ${status}: se ve su mensaje y el texto pegado sigue ahí`, async ({ page }) => {
      const e = await abrirApp(page, { datos: datosPedidos() });
      errorDeFuncion(e, status, mensaje);
      await abrirPegar(page);
      await page.fill('#pedido-texto', TEXTO);
      await boton(page, 'Armar pedido').click();
      await expect(page.locator('#pedido-pegar-warn')).toContainText(mensaje);
      await expect(page.locator('#pedido-texto')).toHaveValue(TEXTO);
      await expect(ticket(page)).toHaveCount(0);
      await expect(boton(page, 'Armar pedido')).toBeEnabled();
      verificarLimpio(e, { ignorar: [/status of \d\d\d/] });
    });
  }

  test('sin conexión o una respuesta sin JSON: aviso claro y el texto sigue ahí', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    await abrirPegar(page);
    await page.fill('#pedido-texto', TEXTO);
    await page.route('**/functions/v1/pedido-whatsapp', r => r.abort('failed'));
    await boton(page, 'Armar pedido').click();
    await expect(page.locator('#pedido-pegar-warn')).toContainText('No se pudo conectar con el asistente: revisá internet y probá de nuevo.');
    await expect(page.locator('#pedido-texto')).toHaveValue(TEXTO);
    await page.unroute('**/functions/v1/pedido-whatsapp');
    await page.route('**/functions/v1/pedido-whatsapp', r => r.fulfill({ status: 504, contentType: 'text/plain', body: 'upstream timeout' }));
    await boton(page, 'Armar pedido').click();
    await expect(page.locator('#pedido-pegar-warn')).toContainText('El asistente no respondió (error 504): probá de nuevo.');
    await expect(page.locator('#pedido-texto')).toHaveValue(TEXTO);
    verificarLimpio(e, { ignorar: [/Failed to load resource/, /status of 504/] });
  });

  test('sin texto no llama a la función', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    await abrirPegar(page);
    await page.fill('#pedido-texto', '   ');
    await boton(page, 'Armar pedido').click();
    await expect(page.locator('#pedido-pegar-warn')).toContainText('Pegá el mensaje de la madre.');
    expect(llamadas(e)).toHaveLength(0);
    verificarLimpio(e);
  });

  test('doble toque en "Armar pedido" y en "Revisar y elegir niñeras": una sola llamada y una sola solicitud', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    const original = e.funciones['pedido-whatsapp'];
    e.funciones['pedido-whatsapp'] = async c => { await new Promise(r => setTimeout(r, 400)); return original(c); };
    await abrirPegar(page);
    await page.fill('#pedido-texto', TEXTO);
    await boton(page, 'Armar pedido').dblclick();
    await expect(ticket(page)).toBeVisible();
    await esperarQuieta(page);
    expect(llamadas(e)).toHaveLength(1);
    expect(e.db.pedidos_whatsapp).toHaveLength(1);
    await esEsta(page);
    e.demoraEscrituras = 300;
    await boton(page, 'Revisar y elegir niñeras').dblclick();
    await expect(modal(page).locator('.pedido-elegir')).toBeVisible();
    await esperarQuieta(page);
    expect(escrituras(e, 'solicitudes', 'POST')).toHaveLength(1);
    expect(escrituras(e, 'pedidos_whatsapp', 'PATCH')).toHaveLength(2);
    verificarLimpio(e);
  });

  test('otra admin ya pasó el pedido a la Agenda: avisa y no crea otra solicitud', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    await armar(page);
    await esEsta(page);
    e.db.pedidos_whatsapp[0].estado = 'confirmado';
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(warnTicket(page)).toContainText('otra admin ya pasó este pedido a la Agenda');
    expect(escrituras(e, 'solicitudes', 'POST')).toHaveLength(0);
    await expect(ticket(page)).toBeVisible();
    verificarLimpio(e);
  });

  test('si la base falla al crear la solicitud, el pedido vuelve a borrador y se puede reintentar', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    await armar(page);
    await esEsta(page);
    e.fallar = ({ tabla, metodo }) => (tabla === 'solicitudes' && metodo === 'POST' ? { status: 500, message: 'falla simulada' } : undefined);
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(warnTicket(page)).toContainText('falla simulada');
    expect(e.db.pedidos_whatsapp[0].estado).toBe('borrador');
    expect(e.db.pedidos_whatsapp[0].solicitud_id).toBeNull();
    e.fallar = null;
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(modal(page).locator('.pedido-elegir')).toBeVisible();
    expect(escrituras(e, 'solicitudes', 'POST')).toHaveLength(1);
    expect(e.db.pedidos_whatsapp[0].estado).toBe('confirmado');
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('si falla vincular el pedido, la solicitud queda y se avisa que revise las dudas (sin abrir "Elegir niñeras")', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    await armar(page);
    await esEsta(page);
    e.fallar = ({ tabla, metodo, cuerpo }) => (tabla === 'pedidos_whatsapp' && metodo === 'PATCH' && cuerpo && 'solicitud_id' in cuerpo ? { status: 500, message: 'falla simulada' } : undefined);
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(toastCon(page, 'no se pudo vincular', '.bad')).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    expect(escrituras(e, 'solicitudes', 'POST')).toHaveLength(1);
    verificarLimpio(e, { ignorar: [/status of 500/] });
  });

  test('base sin la migración de la etapa 5: se guarda sin la niñera pedida ni las notas y avisa', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos(), baseSinMigrar: 'etapa5' });
    await armar(page);
    await esEsta(page);
    await page.fill('#pedido-notas', 'Alergia al maní');
    await boton(page, 'Revisar y elegir niñeras').click();
    await expect(modal(page).locator('.pedido-elegir')).toBeVisible();
    await esperarQuieta(page);
    const posts = escrituras(e, 'solicitudes', 'POST');
    expect(posts).toHaveLength(1); // el primer intento lo rechazó la base (no queda anotado)
    expect(posts[0].cuerpo).not.toHaveProperty('ninera_pedida_id');
    expect(posts[0].cuerpo).not.toHaveProperty('notas_para_ninera');
    await expect(toastCon(page, 'Falta actualizar la base', '.bad')).toBeVisible();
    expect(e.db.pedidos_whatsapp[0]).toMatchObject({ estado: 'confirmado' });
    await expect(page.locator('#editmodal .pedido-tilde')).toHaveCount(0);
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });
});

test.describe('Pegar WhatsApp: pantalla y escape', () => {
  test('a 390 px y a 1280 px el ticket entra sin scroll de costado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirApp(page, { datos: datosPedidos() });
    conTicket(e, { familia_id: ID.fDos, hora_fin: '00:30', termina_dia_siguiente: true, horario_aproximado: true, horario_nota: 'más o menos',
      notas: 'Tomás es alérgico al maní.', dudas: ['La hora de vuelta ("más o menos").'] });
    // Los dos botones de la Agenda entran a 390 px sin empujar la página.
    await irAModulo(page, 'agenda');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.locator('.mesbar').screenshot({ path: 'test-results/pedido-pegar-agenda-390.png' });
    await armar(page);
    await esEsta(page);
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(ancho).toBeLessThanOrEqual(390);
    await page.locator('#editmodal .confirmbox').screenshot({ path: 'test-results/pedido-pegar-390.png' });
    // Todo el ticket de una vez (con un alto de pantalla que no lo corta), para revisarlo entero.
    await page.setViewportSize({ width: 390, height: 2200 });
    await page.waitForTimeout(150);
    await page.locator('#editmodal .confirmbox').screenshot({ path: 'test-results/pedido-pegar-390-entero.png' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(150);
    await page.locator('#editmodal .confirmbox').screenshot({ path: 'test-results/pedido-pegar-1280.png' });
    verificarLimpio(e);
  });

  test('todo lo que viene del mensaje y del modelo se escapa: nada se ejecuta', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosPedidos() });
    const trampa = n => `<img src=x onerror="window.__xss=${n}">'"\`);window.__xss=${n};//`;
    conTicket(e, {
      tipo: 'pedido_nuevo', familia_id: null, familia_texto: trampa(1), horario_nota: trampa(2), chicos_edades: trampa(3), zona: trampa(4),
      ninera_pedida: trampa(5), notas: trampa(6), dudas: [trampa(7)],
    });
    await armar(page, trampa(8));
    await esperarQuieta(page);
    await expect(ticket(page)).toContainText('window.__xss=8');
    await expect(page.locator('#pedido-ticket-dudas')).toContainText('window.__xss=7');
    await expect(page.locator('#pedido-notas')).toHaveValue(trampa(6));
    await expect(page.locator('#pedido-familia')).toHaveValue(trampa(1));
    await expect(page.locator('#pedido-familia-create')).toContainText('window.__xss=1');
    expect(await page.locator('#editmodal img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    // Y en el caso "no es un pedido nuevo".
    conTicket(e, { tipo: 'cambio', familia_id: null, familia_texto: trampa(9) });
    await page.locator('#editmodal .modal-close').click();
    await armar(page, trampa(10));
    expect(await page.locator('#editmodal img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });
});
