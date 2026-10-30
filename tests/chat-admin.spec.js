// Panel (fase 1, etapa 3, 30/10/2026): el chat con cada niñera en su ficha, la tarjeta "Mensajes de
// niñeras" en Hoy, el link del push a las admins (?ir=ninieras&ninera=<id>) y los avisos de la cola
// en la campanita. La admin escribe directo en chat_mensajes (la base solo deja de: 'admin' a una
// niñera activa con cuenta) y marca leído leido_admin_en. Los mensajes nuevos llegan por un canal de
// Realtime propio de la ficha, sin tocar lo que se está escribiendo. Todo contra el simulador
// (tests/support/app.js). Hoy en el simulador es el domingo 04/10/2026 a las 12:00 de Montevideo.
// El hilo de Ana: dos de "Paula Prueba" y uno de ella (ya leído); Carla tiene cuenta y un mensaje
// que las admins todavía no leyeron. En el panel Ana no tiene cuenta: los tests que le escriben le
// ponen una. Datos inventados.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { ID, datosBase } = require('./support/datos');

const SIN_APP = 'Todavía no tiene la app: escribile por WhatsApp.';
// Chromium anota en consola toda respuesta 4xx/5xx simulada y todo pedido cortado.
const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/];
// Sin la migración, solo el 404 de las tablas que no existen: la app no anota ningún error suyo.
const RUIDO_SIN_MIGRAR = [/Failed to load resource: the server responded with a status of 404/];
// nombreUsuario() de la cuenta de los tests (prueba@ejemplo.test, sin nombre_mostrar).
const YO = 'Prueba';

const mensajes = page => page.locator('#vn-chat .chatf-msg');
const campo = page => page.locator('#vn-chat textarea');
const enviar = page => page.locator('#vn-chat button', { hasText: 'Enviar' });
const toasts = page => page.locator('.toaststack .toast');
const filasHoy = page => page.locator('#dash-chat .chat-hoy-fila');
// La lectura de la tarjeta de Hoy ya volvió (para mirar que no haya tarjeta sin que pase de casualidad).
const lecturaHoy = page => page.waitForResponse(r => /rest\/v1\/chat_mensajes\?.*de=eq\.ninera/.test(r.url()));

function datosConCuentaAna() {
  const d = datosBase();
  d.ninieras.find(n => n.id === ID.nAna).user_id = ID.uNinera;
  return d;
}
// Un mensaje como lo deja la base (para sembrar o para Realtime).
function mensaje(n, cambios = {}) {
  return { id: `93000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`, ninera_id: ID.nCarla, de: 'ninera', autor: 'Carla Ejemplo',
    texto: 'Mensaje ' + n, creado_en: '2026-10-04T14:30:00+00:00', leido_ninera_en: null, leido_admin_en: null, ...cambios };
}
// El aviso que encola el trigger del chat para las admins.
function avisoChat(n, m, cambios = {}) {
  return { id: `94000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`, clave: `admin:chat:${m.id}`, para_ninera_id: null, para_admin: 'todas',
    tipo: 'chat', titulo: 'Carla Ejemplo', cuerpo: m.texto, url: `?ir=ninieras&ninera=${m.ninera_id}`, datos: { mensaje_id: m.id, ninera_id: m.ninera_id },
    enviar_desde: m.creado_en, enviado_en: m.creado_en, error: null, intentos: 1, leido_en: null, creado_en: m.creado_en, ...cambios };
}
const inserts = e => e.escrituras.filter(w => w.tabla === 'chat_mensajes' && w.metodo === 'POST');
const marcas = e => e.escrituras.filter(w => w.tabla === 'chat_mensajes' && w.metodo === 'PATCH');

// El canal del hilo quedó escuchando (sin eso, emitirRealtime no le llega).
const canalesFicha = page => page.evaluate(() => sb.getChannels().filter(c => /^realtime:chat-ficha-/.test(c.topic)).map(c => ({ topic: c.topic, state: c.state })));
async function esperarCanalFicha(page, id) {
  await expect.poll(async () => (await canalesFicha(page)).filter(c => c.topic.startsWith(`realtime:chat-ficha-${id}`) && c.state === 'joined').length).toBe(1);
}
async function abrirFicha(page, id, opciones = {}) {
  const e = await abrirApp(page, opciones);
  await irAModulo(page, 'ninieras');
  await page.evaluate(i => verNinera(i), id);
  await expect(page.locator('#editmodal.show')).toBeVisible();
  return e;
}
async function abrirChat(page, id, opciones = {}) {
  const e = await abrirFicha(page, id, opciones);
  await expect(mensajes(page).first()).toBeVisible();
  await esperarCanalFicha(page, id);
  return e;
}

test.describe('ficha de la niñera: chat', () => {
  test('con app: el hilo en orden, los de ella a la izquierda, los del equipo con el autor; enviar guarda y agrega', async ({ page }) => {
    const e = await abrirChat(page, ID.nAna, { datos: datosConCuentaAna() });
    await expect(page.locator('#vn-chat h2')).toHaveText('Chat');
    await expect(mensajes(page)).toHaveCount(3);
    await expect(mensajes(page).locator('.chatf-texto')).toHaveText(['Hola Ana, ¿te queda bien el sitting de mañana?', 'Sí, ahí estaré.', 'Gracias, te mandamos la dirección más tarde.']);
    await expect(mensajes(page).nth(0)).toHaveClass(/equipo/);
    await expect(mensajes(page).nth(0).locator('.chatf-autor')).toHaveText('Paula Prueba');
    await expect(mensajes(page).nth(1)).toHaveClass(/ella/);
    await expect(mensajes(page).nth(1).locator('.chatf-autor')).toHaveCount(0);
    // Hora de Montevideo: el 03/10 lleva la fecha; el de hoy, solo la hora.
    await expect(mensajes(page).nth(0).locator('.chatf-hora')).toHaveText('03/10 10:00');
    await expect(mensajes(page).nth(2).locator('.chatf-hora')).toHaveText('10:00');
    // Lo de ella ya estaba leído: no se marca nada.
    expect(marcas(e)).toEqual([]);
    await expect(campo(page)).toHaveAttribute('placeholder', 'Escribile a Ana');
    await expect(campo(page)).toHaveAttribute('maxlength', '2000');

    await campo(page).fill('  Hola Ana, ¿podés el martes a las 18?  ');
    await enviar(page).click();
    await expect(mensajes(page)).toHaveCount(4);
    expect(inserts(e).map(w => w.cuerpo)).toEqual([{ ninera_id: ID.nAna, de: 'admin', autor: YO, texto: 'Hola Ana, ¿podés el martes a las 18?' }]);
    await expect(mensajes(page).nth(3)).toHaveClass(/equipo/);
    await expect(mensajes(page).nth(3).locator('.chatf-autor')).toHaveText(YO);
    await expect(mensajes(page).nth(3).locator('.chatf-texto')).toHaveText('Hola Ana, ¿podés el martes a las 18?');
    await expect(campo(page)).toHaveValue('');
    // El eco por Realtime del propio mensaje no lo repite.
    const guardado = e.db.chat_mensajes.find(m => m.texto === 'Hola Ana, ¿podés el martes a las 18?');
    expect(guardado).toBeTruthy();
    e.emitirRealtime('chat_mensajes', 'INSERT', guardado);
    await page.waitForTimeout(300);
    await expect(mensajes(page)).toHaveCount(4);
    verificarLimpio(e);
  });

  test('sin app: lo dice y no lee ni escribe el chat', async ({ page }) => {
    const pedidos = [];
    page.on('request', r => { if (/chat_mensajes/.test(r.url())) pedidos.push(r.method() + ' ' + r.url()); });
    const e = await abrirFicha(page, ID.nAna);
    await expect(page.locator('#vn-chat')).toContainText(SIN_APP);
    await expect(campo(page)).toHaveCount(0);
    await expect(enviar(page)).toHaveCount(0);
    expect(pedidos.filter(p => p.includes(`ninera_id=eq.${ID.nAna}`))).toEqual([]);
    expect(await canalesFicha(page)).toEqual([]);
    verificarLimpio(e);
  });

  test('al abrir marca leídos los de ella (y sale de la campanita)', async ({ page }) => {
    const e = await abrirApp(page);
    await expect.poll(() => page.evaluate(() => notifItems.map(i => i.id))).toContain('aviso:' + ID.avCarlaChat);
    await irAModulo(page, 'ninieras');
    await page.evaluate(i => verNinera(i), ID.nCarla);
    await expect(mensajes(page)).toHaveCount(1);
    await expect(mensajes(page).first()).toHaveClass(/ella/);
    await expect.poll(() => marcas(e).length).toBe(1);
    expect(marcas(e)[0].cuerpo).toEqual({ leido_admin_en: expect.any(String) });
    expect(marcas(e)[0].params).toMatchObject({ ninera_id: `eq.${ID.nCarla}`, de: 'eq.ninera', leido_admin_en: 'is.null' });
    expect(e.db.chat_mensajes.find(m => m.id === ID.chCarla).leido_admin_en).toBeTruthy();
    await expect.poll(() => page.evaluate(() => notifItems.map(i => i.id))).not.toContain('aviso:' + ID.avCarlaChat);
    verificarLimpio(e);
  });

  test('Realtime con algo escrito: el mensaje nuevo aparece, lo escrito queda con el foco, sin repetir y marcado leído', async ({ page }) => {
    const e = await abrirChat(page, ID.nCarla);
    await expect.poll(() => marcas(e).length).toBe(1);
    await campo(page).fill('Te contesto en un rato');
    await campo(page).focus();
    const nuevo = mensaje(1, { texto: 'Y otra cosa: ¿llevo merienda?' });
    e.db.chat_mensajes.push(nuevo);
    e.emitirRealtime('chat_mensajes', 'INSERT', nuevo);
    await expect(mensajes(page)).toHaveCount(2);
    await expect(mensajes(page).nth(1).locator('.chatf-texto')).toHaveText('Y otra cosa: ¿llevo merienda?');
    await expect(campo(page)).toHaveValue('Te contesto en un rato');
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('vn-chat-texto');
    // El mismo dos veces (reconexión): una sola.
    e.emitirRealtime('chat_mensajes', 'INSERT', nuevo);
    await page.waitForTimeout(300);
    await expect(mensajes(page)).toHaveCount(2);
    // Ya lo vio: queda leído.
    await expect.poll(() => e.db.chat_mensajes.find(m => m.id === nuevo.id).leido_admin_en).toBeTruthy();
    // Uno de otra niñera no entra en este hilo.
    const deAna = mensaje(2, { ninera_id: ID.nAna, autor: 'Ana Ficticia', texto: 'Soy Ana' });
    e.db.chat_mensajes.push(deAna);
    e.emitirRealtime('chat_mensajes', 'INSERT', deAna);
    await page.waitForTimeout(300);
    await expect(mensajes(page)).toHaveCount(2);
    expect(e.db.chat_mensajes.find(m => m.id === deAna.id).leido_admin_en).toBeNull();
    verificarLimpio(e);
  });

  test('dos admins: lo que escribe otra aparece con su nombre, del lado del equipo, en orden', async ({ page }) => {
    const e = await abrirChat(page, ID.nCarla);
    const deOtra = mensaje(3, { de: 'admin', autor: 'Lucía Prueba', texto: 'Sí, el lunes de 16 a 19.' });
    e.db.chat_mensajes.push(deOtra);
    e.emitirRealtime('chat_mensajes', 'INSERT', deOtra);
    await expect(mensajes(page)).toHaveCount(2);
    await expect(mensajes(page).nth(1)).toHaveClass(/equipo/);
    await expect(mensajes(page).nth(1).locator('.chatf-autor')).toHaveText('Lucía Prueba');
    // Uno que llega tarde pero es anterior va en su lugar por la hora.
    const anterior = mensaje(4, { texto: 'Primero', creado_en: '2026-10-04T13:30:00+00:00' });
    e.db.chat_mensajes.push(anterior);
    e.emitirRealtime('chat_mensajes', 'INSERT', anterior);
    await expect(mensajes(page)).toHaveCount(3);
    await expect(mensajes(page).locator('.chatf-texto')).toHaveText(['Primero', 'Hola, ¿me confirman el horario del lunes?', 'Sí, el lunes de 16 a 19.']);
    verificarLimpio(e);
  });

  test('vacío o solo espacios no manda', async ({ page }) => {
    const e = await abrirChat(page, ID.nCarla);
    await enviar(page).click();
    await campo(page).fill('   \n  ');
    await enviar(page).click();
    await page.waitForTimeout(200);
    expect(inserts(e)).toEqual([]);
    await expect(mensajes(page)).toHaveCount(1);
    verificarLimpio(e);
  });

  test('si la base falla: aviso claro, el texto queda y se puede reintentar', async ({ page }) => {
    const e = await abrirChat(page, ID.nCarla);
    e.fallar = ({ tabla, metodo }) => tabla === 'chat_mensajes' && metodo === 'POST' ? { status: 500, message: 'se cayó' } : undefined;
    await campo(page).fill('¿Me pasás tu dirección?');
    await enviar(page).click();
    await expect(toasts(page).last()).toContainText('No se pudo enviar el mensaje');
    await expect(campo(page)).toHaveValue('¿Me pasás tu dirección?');
    await expect(mensajes(page)).toHaveCount(1);
    await expect(enviar(page)).toBeEnabled();

    // Sin conexión, lo mismo.
    e.fallar = ({ tabla, metodo }) => tabla === 'chat_mensajes' && metodo === 'POST' ? 'red' : undefined;
    await enviar(page).click();
    await expect(toasts(page).last()).toContainText(/revisá la conexión/i);
    await expect(campo(page)).toHaveValue('¿Me pasás tu dirección?');
    await expect(mensajes(page)).toHaveCount(1);

    e.fallar = null;
    await enviar(page).click();
    await expect(mensajes(page)).toHaveCount(2);
    await expect(campo(page)).toHaveValue('');
    expect(inserts(e)).toHaveLength(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('la base lo rechaza porque ya no tiene la app: lo dice y no agrega nada', async ({ page }) => {
    const e = await abrirChat(page, ID.nCarla);
    // Entre que se abrió la ficha y se mandó, la niñera quedó sin cuenta: la RLS no deja (403 42501).
    e.db.ninieras.find(n => n.id === ID.nCarla).user_id = null;
    await campo(page).fill('Hola Carla');
    await enviar(page).click();
    await expect(toasts(page).last()).toContainText('ya no tiene la app activa');
    await expect(campo(page)).toHaveValue('Hola Carla');
    await expect(mensajes(page)).toHaveCount(1);
    expect(e.rechazadas).toBe(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('doble toque en Enviar: un solo mensaje', async ({ page }) => {
    const e = await abrirChat(page, ID.nCarla);
    e.demoraEscrituras = 400;
    await campo(page).fill('Una sola vez');
    await enviar(page).dblclick();
    await enviar(page).click({ force: true }).catch(() => {});
    await expect(mensajes(page)).toHaveCount(2);
    await page.waitForTimeout(600);
    expect(inserts(e)).toHaveLength(1);
    await expect(mensajes(page)).toHaveCount(2);
    verificarLimpio(e);
  });

  test('mandar y cambiar de ficha antes de que conteste la base: el mensaje no cae en el hilo de la otra', async ({ page }) => {
    const e = await abrirChat(page, ID.nCarla, { datos: datosConCuentaAna() });
    await expect.poll(() => marcas(e).length).toBe(1);
    e.demoraEscrituras = 800;
    await campo(page).fill('Para Carla');
    await enviar(page).click();
    // Antes de que la base conteste: se cierra la ficha y se abre la de Ana.
    await page.evaluate(i => verNinera(i), ID.nAna);
    await expect(mensajes(page)).toHaveCount(3);
    await expect(toasts(page).last()).toHaveText('Mensaje enviado a Carla Ejemplo.');
    await expect(mensajes(page)).toHaveCount(3);
    await expect(page.locator('#vn-chat')).not.toContainText('Para Carla');
    await expect(campo(page)).toHaveValue('');
    expect(inserts(e).map(w => w.cuerpo)).toEqual([{ ninera_id: ID.nCarla, de: 'admin', autor: YO, texto: 'Para Carla' }]);
    expect(e.db.chat_mensajes.find(m => m.texto === 'Para Carla').ninera_id).toBe(ID.nCarla);
    verificarLimpio(e);
  });

  test('escape: HTML en el texto y en el autor se muestra como texto', async ({ page }) => {
    const d = datosBase();
    const tramposo = '<img src=x onerror="window.__xss=1">\n"comillas" & </div>';
    d.chat_mensajes.push(mensaje(5, { texto: tramposo, creado_en: '2026-10-04T14:10:00+00:00' }));
    d.chat_mensajes.push(mensaje(6, { de: 'admin', autor: '<b onmouseover="window.__xss=2">Admin</b>', texto: "');window.__xss=3;('", creado_en: '2026-10-04T14:20:00+00:00' }));
    const e = await abrirApp(page, { datos: d });
    // En la tarjeta de Hoy, el último de ella (el tramposo) como texto.
    await expect(filasHoy(page)).toHaveCount(1);
    await expect(filasHoy(page).locator('.chat-hoy-ultimo')).toHaveText(tramposo.replace(/\s+/g, ' '));
    await expect(page.locator('#dash-chat img, #dash-chat script')).toHaveCount(0);
    await irAModulo(page, 'ninieras');
    await page.evaluate(i => verNinera(i), ID.nCarla);
    await expect(mensajes(page)).toHaveCount(3);
    await esperarCanalFicha(page, ID.nCarla);
    await expect(mensajes(page).nth(1).locator('.chatf-texto')).toHaveText(tramposo);
    await expect(mensajes(page).nth(2).locator('.chatf-autor')).toHaveText('<b onmouseover="window.__xss=2">Admin</b>');
    await expect(page.locator('#vn-chat img, #vn-chat b')).toHaveCount(0);
    // Por Realtime, igual.
    const porRealtime = mensaje(7, { texto: '<script>window.__xss=4</script><img src=x onerror="window.__xss=5">' });
    e.db.chat_mensajes.push(porRealtime);
    e.emitirRealtime('chat_mensajes', 'INSERT', porRealtime);
    await expect(mensajes(page)).toHaveCount(4);
    await expect(mensajes(page).nth(3).locator('.chatf-texto')).toHaveText(porRealtime.texto);
    await expect(page.locator('#vn-chat img, #vn-chat script')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e, { ignorar: [/ejemplo\.test|Failed to load resource/] });
  });

  test('al cerrar la ficha se quita el canal; otra ficha abre el suyo', async ({ page }) => {
    const e = await abrirChat(page, ID.nCarla);
    await page.evaluate(() => cerrarModal());
    await expect.poll(() => canalesFicha(page)).toEqual([]);
    // Lo que llega después ya no pinta nada ni marca leído.
    const tarde = mensaje(8, { texto: 'Tarde' });
    e.db.chat_mensajes.push(tarde);
    e.emitirRealtime('chat_mensajes', 'INSERT', tarde);
    await page.waitForTimeout(300);
    expect(e.db.chat_mensajes.find(m => m.id === tarde.id).leido_admin_en).toBeNull();
    // Abrir otra ficha con chat abre su canal; abrir otra encima reemplaza el anterior.
    await page.evaluate(i => verNinera(i), ID.nCarla);
    await esperarCanalFicha(page, ID.nCarla);
    await page.evaluate(i => verNinera(i), ID.nBruno);
    await expect.poll(() => canalesFicha(page)).toEqual([]);
    verificarLimpio(e);
  });

  test('si no carga el hilo: aviso con Reintentar, sin marcar leído', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'ninieras');
    // Las lecturas no pasan por estado.fallar: la falla se simula con una ruta propia.
    await page.route(/rest\/v1\/chat_mensajes\?.*ninera_id=eq\./, r => r.fulfill({ status: 500, json: { code: 'XX000', message: 'se cayó' } }));
    await page.evaluate(i => verNinera(i), ID.nCarla);
    await expect(page.locator('#vn-chat')).toContainText('No se pudo cargar el chat');
    expect(marcas(e)).toEqual([]);
    await page.unroute(/rest\/v1\/chat_mensajes\?.*ninera_id=eq\./);
    await page.locator('#vn-chat button', { hasText: 'Reintentar' }).click();
    await expect(mensajes(page)).toHaveCount(1);
    await expect.poll(() => marcas(e).length).toBe(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('Hoy: Mensajes de niñeras', () => {
  test('una fila por niñera con la cantidad y el último recortado; tocarla abre su ficha en el chat', async ({ page }) => {
    const d = datosBase();
    d.ninieras.find(n => n.id === ID.nAna).user_id = ID.uNinera;
    d.chat_mensajes.push(mensaje(10, { texto: 'Y el martes también puedo', creado_en: '2026-10-04T14:40:00+00:00' }));
    const largo = 'Hola, quería contarles que '.padEnd(200, 'x');
    d.chat_mensajes.push(mensaje(11, { ninera_id: ID.nAna, autor: 'Ana Ficticia', texto: largo, creado_en: '2026-10-04T14:50:00+00:00' }));
    const e = await abrirApp(page, { datos: d });
    await expect(page.locator('#dash-chat h2')).toHaveText('Mensajes de niñeras');
    await expect(filasHoy(page)).toHaveCount(2);
    // La más nueva arriba.
    await expect(filasHoy(page).nth(0)).toContainText('Ana Ficticia');
    await expect(filasHoy(page).nth(0).locator('.chat-hoy-cant')).toHaveText('1');
    const ultimoAna = await filasHoy(page).nth(0).locator('.chat-hoy-ultimo').textContent();
    expect(ultimoAna.endsWith('…')).toBe(true);
    expect(ultimoAna.length).toBeLessThan(100);
    await expect(filasHoy(page).nth(1)).toContainText('Carla Ejemplo');
    await expect(filasHoy(page).nth(1).locator('.chat-hoy-cant')).toHaveText('2');
    await expect(filasHoy(page).nth(1).locator('.chat-hoy-ultimo')).toHaveText('Y el martes también puedo');

    await filasHoy(page).nth(1).click();
    await expect(page.locator('#editmodal.show')).toBeVisible();
    await expect(page.locator('#editmodal h2').first()).toContainText('Carla Ejemplo');
    await expect(mensajes(page)).toHaveCount(2);
    await expect(page.locator('#vn-chat')).toBeInViewport();
    expect(await page.evaluate(() => moduloActivo)).toBe('ninieras');
    await expect.poll(() => e.db.chat_mensajes.filter(m => m.ninera_id === ID.nCarla && m.de === 'ninera' && !m.leido_admin_en).length).toBe(0);
    verificarLimpio(e);
  });

  test('sin mensajes sin leer no hay tarjeta', async ({ page }) => {
    const d = datosBase();
    d.chat_mensajes.find(m => m.id === ID.chCarla).leido_admin_en = '2026-10-04T14:05:00+00:00';
    const leida = lecturaHoy(page);
    const e = await abrirApp(page, { datos: d });
    await leida;
    await expect(page.locator('#dash-faltan')).toBeAttached();
    await expect(page.locator('#dash-chat')).toBeEmpty();
    verificarLimpio(e);
  });

  test('llega un mensaje con Hoy abierto: la tarjeta se pone al día', async ({ page }) => {
    const e = await abrirApp(page);
    await expect(filasHoy(page)).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => sb.getChannels().filter(c => /^realtime:rt-notif-avisos-/.test(c.topic) && c.state === 'joined').length)).toBe(1);
    const nuevo = mensaje(12, { texto: 'Ya llegué' });
    e.db.chat_mensajes.push(nuevo);
    e.db.avisos.push(avisoChat(12, nuevo));
    e.emitirRealtime('chat_mensajes', 'INSERT', nuevo);
    e.emitirRealtime('avisos', 'INSERT', avisoChat(12, nuevo));
    await expect(filasHoy(page).first().locator('.chat-hoy-cant')).toHaveText('2');
    await expect(filasHoy(page).first().locator('.chat-hoy-ultimo')).toHaveText('Ya llegué');
    verificarLimpio(e);
  });

  test('dos lecturas que vuelven en desorden: queda la última', async ({ page }) => {
    let primera = true;
    const e = await abrirApp(page, { ruta: '/?ir=agenda' });
    // La primera lectura de la tarjeta tarda y trae lo de antes; la segunda, al toque, lo nuevo.
    await page.route(/rest\/v1\/chat_mensajes\?.*de=eq\.ninera/, async r => {
      if (!primera) return r.fallback();
      primera = false;
      const viejo = e.db.chat_mensajes.filter(m => m.de === 'ninera' && !m.leido_admin_en).map(m => ({ ...m }));
      await new Promise(res => setTimeout(res, 1500));
      return r.fulfill({ json: viejo });
    });
    await page.evaluate(() => { setModulo(null); });
    const nuevo = mensaje(17, { texto: 'Lo más nuevo' });
    e.db.chat_mensajes.push(nuevo);
    await page.evaluate(() => cargarMensajesNinerasHoy());
    await expect(filasHoy(page).first().locator('.chat-hoy-ultimo')).toHaveText('Lo más nuevo');
    await page.waitForTimeout(1800);
    await expect(filasHoy(page).first().locator('.chat-hoy-ultimo')).toHaveText('Lo más nuevo');
    await expect(filasHoy(page).first().locator('.chat-hoy-cant')).toHaveText('2');
    verificarLimpio(e);
  });

  test('de una niñera inactiva: tocar la fila abre igual su ficha (solo para leer el chat)', async ({ page }) => {
    const d = datosBase();
    d.ninieras.find(n => n.id === ID.nCarla).activa = false;
    const e = await abrirApp(page, { datos: d });
    await expect(filasHoy(page)).toHaveCount(1);
    await expect(filasHoy(page).first()).toContainText('Carla Ejemplo');
    const t0 = Date.now();
    await filasHoy(page).first().click();
    await expect(page.locator('#editmodal.show')).toBeVisible({ timeout: 2500 });
    expect(Date.now() - t0).toBeLessThan(4000);
    await expect(page.locator('#editmodal h2').first()).toContainText('Carla Ejemplo');
    await expect(mensajes(page)).toHaveCount(1);
    await expect(campo(page)).toHaveCount(0);
    await expect(page.locator('#vn-chat')).toContainText('Está inactiva: no se le puede escribir por el chat.');
    await expect(page.locator('#vn-app')).toContainText('Está inactiva');
    await expect.poll(() => e.db.chat_mensajes.find(m => m.id === ID.chCarla).leido_admin_en).toBeTruthy();
    // No entra en la lista de Niñeras, que sigue siendo solo de las activas.
    expect(await page.evaluate(i => ninierasItems.some(n => n.id === i), ID.nCarla)).toBe(false);
    verificarLimpio(e);
  });

  test('niñera inactiva: editarla y volver a abrirla muestra lo editado (su fila se vuelve a leer)', async ({ page }) => {
    const d = datosBase();
    d.ninieras.find(n => n.id === ID.nCarla).activa = false;
    const e = await abrirApp(page, { datos: d });
    await filasHoy(page).first().click();
    await expect(mensajes(page)).toHaveCount(1);
    await expect(page.locator('#editmodal .fichadl')).toContainText('Notas—');
    // "Editar" encima de la ficha: arranca con su fila y guarda sobre la misma niñera.
    // Primero pide la temporada (no la tiene): "Omitir por ahora" vuelve a abrir "Editar" con su fila.
    await page.evaluate(i => editarNinera(i), ID.nCarla);
    await page.locator('#editmodal button', { hasText: 'Omitir por ahora' }).click();
    await page.fill('#ed-notas', 'Nota editada');
    await page.locator('#editmodal button', { hasText: 'Guardar' }).click();
    await expect(toasts(page).last()).toHaveText('Cambios guardados.');
    expect(e.db.ninieras.find(n => n.id === ID.nCarla).notas).toBe('Nota editada');
    expect(e.escrituras.filter(w => w.tabla === 'candidatas')).toEqual([]);
    // Al volver a abrirla se ve lo editado, no la fila de antes.
    await page.evaluate(i => abrirChatDeNinera(i, { cambiarModulo: false }), ID.nCarla);
    await expect(page.locator('#editmodal .fichadl')).toContainText('Nota editada');
    // Y si alguien la cambia desde otro lado, al abrirla de nuevo también.
    e.db.ninieras.find(n => n.id === ID.nCarla).notas = 'Cambiada por otra admin';
    await page.evaluate(() => cerrarModal());
    await page.evaluate(i => abrirChatDeNinera(i, { cambiarModulo: false }), ID.nCarla);
    await expect(page.locator('#editmodal .fichadl')).toContainText('Cambiada por otra admin');
    verificarLimpio(e);
  });

  test('verNinera de una niñera que no está: aviso, sin romper', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'ninieras');
    await page.evaluate(() => verNinera('30000000-0000-4000-8000-0000000000ff'));
    await expect(toasts(page).last()).toHaveText('No se encontró la niñera.');
    await expect(page.locator('#editmodal.show')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('si falla la lectura: Hoy anda igual, sin la tarjeta', async ({ page }) => {
    const e = await abrirApp(page);
    await expect(filasHoy(page)).toHaveCount(1);
    // Va después de abrir: Playwright prueba primero la última ruta registrada (la del simulador si no).
    await page.route(/rest\/v1\/chat_mensajes\?.*de=eq\.ninera/, r => r.fulfill({ status: 500, json: { code: 'XX000', message: 'se cayó' } }));
    await irAModulo(page, 'agenda');
    const leida = lecturaHoy(page);
    await irAModulo(page, null);
    expect((await leida).status()).toBe(500);
    await expect(page.locator('#statrow .statnum').nth(1)).toHaveText('3');
    await expect(page.locator('#dash-chat')).toBeEmpty();
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('link del push: ?ir=ninieras&ninera=<id>', () => {
  test('abre Niñeras y la ficha de esa niñera en el chat', async ({ page }) => {
    const e = await abrirApp(page, { ruta: `/?ir=ninieras&ninera=${ID.nCarla}` });
    await expect(page.locator('#editmodal.show')).toBeVisible();
    await expect(page.locator('#editmodal h2').first()).toContainText('Carla Ejemplo');
    await expect(mensajes(page)).toHaveCount(1);
    await expect(page.locator('#vn-chat')).toBeInViewport();
    expect(await page.evaluate(() => moduloActivo)).toBe('ninieras');
    expect(await page.evaluate(() => location.search)).toBe('');
    verificarLimpio(e);
  });

  test('sin ninera, como siempre: solo el módulo', async ({ page }) => {
    const e = await abrirApp(page, { ruta: '/?ir=ninieras' });
    expect(await page.evaluate(() => moduloActivo)).toBe('ninieras');
    await page.waitForTimeout(300);
    await expect(page.locator('#editmodal.show')).toHaveCount(0);
    verificarLimpio(e);
  });
});

test.describe('campanita y preferencias', () => {
  test('el aviso del chat sin leer aparece; el ya leído en el chat no; tocarlo abre el chat y sale', async ({ page }) => {
    const e = await abrirApp(page);
    await expect.poll(() => page.evaluate(() => notifItems.map(i => i.id))).toContain('aviso:' + ID.avCarlaChat);
    const ids = await page.evaluate(() => notifItems.map(i => i.id));
    expect(ids).not.toContain('aviso:' + ID.avAnaChat);
    const item = await page.evaluate(id => notifItems.find(i => i.id === id), 'aviso:' + ID.avCarlaChat);
    expect(item).toMatchObject({ tipo: 'chat', titulo: 'Carla Ejemplo', mensaje: 'Hola, ¿me confirman el horario del lunes?' });

    await page.locator('.notif-btn:visible').first().click();
    const fila = page.locator(`.notif-item[data-id="aviso:${ID.avCarlaChat}"]`);
    await expect(fila).toContainText('Carla Ejemplo');
    await expect(fila).toContainText('Hola, ¿me confirman el horario del lunes?');
    await fila.locator('.notif-item-content').click();
    await expect(page.locator('#editmodal.show')).toBeVisible();
    await expect(page.locator('#editmodal h2').first()).toContainText('Carla Ejemplo');
    await expect(mensajes(page)).toHaveCount(1);
    await expect(page.locator('#vn-chat')).toBeInViewport();
    await expect.poll(() => page.evaluate(() => notifItems.map(i => i.id))).not.toContain('aviso:' + ID.avCarlaChat);
    verificarLimpio(e);
  });

  test('solo los de los últimos 3 días; uno nuevo llega por Realtime', async ({ page }) => {
    const d = datosBase();
    const viejo = mensaje(13, { creado_en: '2026-09-28T14:00:00+00:00' });
    d.chat_mensajes.push(viejo);
    d.avisos.push(avisoChat(13, viejo));
    // Otro tipo de aviso para las admins: sale con su título y su cuerpo.
    d.avisos.push({ ...avisoChat(14, mensaje(14)), clave: 'admin:otro', tipo: 'pedido', titulo: 'Pedido nuevo', cuerpo: 'Una familia pidió un sitting.', url: '?ir=agenda', datos: {} });
    const e = await abrirApp(page, { datos: d });
    await expect.poll(() => page.evaluate(() => notifItems.map(i => i.id))).toContain('aviso:' + ID.avCarlaChat);
    const items = await page.evaluate(() => notifItems.filter(i => i.id.startsWith('aviso:')).map(i => ({ id: i.id, destino: i.destino })));
    expect(items.map(i => i.id)).not.toContain('aviso:' + avisoChat(13, viejo).id);
    expect(items).toContainEqual({ id: 'aviso:' + avisoChat(14, mensaje(14)).id, destino: 'agenda' });

    const nuevo = mensaje(15, { texto: 'Llego 10 minutos tarde' });
    const av = avisoChat(15, nuevo);
    e.db.chat_mensajes.push(nuevo);
    e.db.avisos.push(av);
    e.emitirRealtime('avisos', 'INSERT', av);
    await expect.poll(() => page.evaluate(() => notifItems.map(i => i.id))).toContain('aviso:' + av.id);
    verificarLimpio(e);
  });

  test('preferencias: "Mensajes de niñeras" con push prendido de entrada', async ({ page }) => {
    const e = await abrirApp(page);
    await irAModulo(page, 'notificaciones');
    const fila = page.locator('.notifcfg-row', { hasText: 'Mensajes de niñeras' });
    await expect(fila).toHaveCount(1);
    await expect(fila).toContainText('Cuando una niñera escribe por el chat de la app');
    await expect(fila.locator('input[type=checkbox]')).toBeChecked();
    await fila.locator('.toggle').click();
    await expect.poll(() => e.escrituras.filter(w => w.tabla === 'notif_push_preferencias').map(w => w.cuerpo)).toEqual([{ usuario: 'prueba@ejemplo.test', tipo: 'chat', activado: false }]);
    verificarLimpio(e);
  });
});

test.describe('base sin la migración de la etapa 3', () => {
  test('sin tarjeta, sin chat en la ficha, la campanita como antes y sin errores', async ({ page }) => {
    const leida = lecturaHoy(page);
    const e = await abrirApp(page, { baseSinMigrar: 'etapa3' });
    expect((await leida).status()).toBe(404);
    await expect(page.locator('#dash-pend-num')).not.toHaveText('—');
    await page.waitForTimeout(300);
    await expect(page.locator('#dash-chat')).toBeEmpty();
    const ids = await page.evaluate(() => notifItems.map(i => i.id));
    expect(ids.some(i => i.startsWith('aviso:'))).toBe(false);
    expect(ids).toContain('temporada:2026');
    expect(await page.evaluate(() => sb.getChannels().filter(c => /rt-notif-avisos/.test(c.topic)).length)).toBe(0);

    await irAModulo(page, 'ninieras');
    await page.evaluate(i => verNinera(i), ID.nCarla);
    await expect(page.locator('#editmodal.show')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator('#vn-chat')).toBeEmpty();
    expect(await canalesFicha(page)).toEqual([]);
    // Sin cuenta: tampoco el "Todavía no tiene la app" (sin la migración no hay chat).
    await page.evaluate(i => verNinera(i), ID.nAna);
    await page.waitForTimeout(200);
    await expect(page.locator('#vn-chat')).toBeEmpty();
    expect(e.escrituras.filter(w => w.tabla === 'chat_mensajes')).toEqual([]);
    verificarLimpio(e, { ignorar: RUIDO_SIN_MIGRAR });
  });
});

test.describe('celular', () => {
  test('a 390 px: la tarjeta de Hoy y el chat de la ficha entran sin correrse', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const d = datosBase();
    d.chat_mensajes.push(mensaje(16, { texto: 'Un mensaje largo sin espacios: ' + 'x'.repeat(120), creado_en: '2026-10-04T14:45:00+00:00' }));
    const e = await abrirApp(page, { datos: d });
    await expect(filasHoy(page)).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.locator('#dash-chat').screenshot({ path: testInfo.outputPath('chat-hoy-390.png'), animations: 'disabled' });
    await filasHoy(page).first().click();
    await expect(mensajes(page)).toHaveCount(2);
    const box = await page.locator('#vn-chat').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const hilo = await page.evaluate(() => { const h = document.getElementById('vn-chat-hilo'); return { sw: h.scrollWidth, cw: h.clientWidth }; });
    expect(hilo.sw).toBeLessThanOrEqual(hilo.cw);
    await page.screenshot({ path: testInfo.outputPath('chat-ficha-390.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: testInfo.outputPath('chat-ficha-1280.png'), animations: 'disabled' });
    verificarLimpio(e);
  });
});
