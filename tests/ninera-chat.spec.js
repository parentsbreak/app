// App de niñeras (fase 1, etapa 3, 30/10/2026): el chat con el equipo (#chat) y la lista de avisos
// (#mis-avisos), en ninera/js/chat.js. La niñera lee su hilo y sus avisos directo (la RLS filtra) y
// escribe solo por sus RPC (ninera_enviar_mensaje, ninera_marcar_chat_leido,
// ninera_marcar_avisos_leidos). Los mensajes nuevos llegan por Realtime sin tocar lo que está
// escribiendo. Todo contra el simulador (tests/support/app.js y rpc-ninera.js). Hoy en el simulador
// es el domingo 04/10/2026 a las 12:00 de Montevideo. El hilo de Ana: dos de "Paula Prueba" (el
// último sin leer, 04/10 10:00) y uno de ella (03/10); tiene un aviso sin leer ("Hoy tienes un
// sitting").
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio } = require('./support/app');
const { errorRpc } = require('./support/rpc-ninera');
const { ID, datosBase } = require('./support/datos');

const TITULO_CHAT = "Equipo de Parents' Break";
const OPERADORA = "Contáctate con una operadora de Parents' Break.";
const FALLA_ENVIAR = 'No pudimos enviar tu mensaje. Revisa tu conexión a internet y vuelve a intentar.';
const MUY_LARGO = 'Tu mensaje es muy largo. Escríbelo en partes más cortas.';
const FALLA_CHAT = 'No pudimos cargar los mensajes. Revisa tu conexión a internet y vuelve a intentar.';
const FALLA_AVISOS = 'No pudimos cargar tus avisos. Revisa tu conexión a internet y vuelve a intentar.';
const SIN_MENSAJES = 'Todavía no hay mensajes.';
const SIN_AVISOS = 'No tienes avisos.';
// Chromium anota en consola toda respuesta 4xx/5xx simulada y todo pedido cortado; la app anota el
// error con su etiqueta.
const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[chat\]|\[avisos\]/];
// Sin la migración, solo el 404 de la tabla que no existe: la app no anota ningún error suyo.
const RUIDO_SIN_MIGRAR = [/Failed to load resource: the server responded with a status of 404/];
// Nunca plata en la app de niñeras.
const PLATA = /\$\d/;
const PAGO = /\bpago/i;

// Un mensaje nuevo del equipo, como lo deja la base (para Realtime).
function mensajeEquipo(id, texto, extra = {}) {
  return { id: `93000000-0000-4000-8000-0000000001${id}`, ninera_id: ID.nAna, de: 'admin', autor: 'Lucía Prueba', texto,
    creado_en: '2026-10-04T15:05:00+00:00', leido_ninera_en: null, leido_admin_en: null, ...extra };
}

// Ana con el perfil completo y la pantalla de avisos ya vista en este celular: estos tests miran el
// chat y los avisos, no el primer ingreso.
async function abrir(page, opciones = {}) {
  const datos = opciones.datos || datosBase();
  (datos.ninieras || []).forEach(n => { if (n.id === ID.nAna) Object.assign(n, { zona: 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00' }); });
  await page.addInitScript(() => localStorage.setItem('pb-ninera-avisos-vistos', '1'));
  return abrirAppNinera(page, { ...opciones, datos });
}
const boton = (page, nombre) => page.locator('#inicio-accesos button', { hasText: nombre });
const mensajes = page => page.locator('#chat-hilo .chat-msg');
const avisos = page => page.locator('#avisos-lista .aviso-item');
function rpcs(e, nombre) {
  return e.escrituras.filter(w => w.tabla === `rpc/${nombre}`).map(w => w.cuerpo);
}
// El canal del chat quedó escuchando (sin eso, emitirRealtime no le llega a nadie).
async function esperarCanal(page) {
  await expect.poll(() => page.evaluate(() => sbn.getChannels().filter(c => c.topic === 'realtime:chat-ninera' && c.state === 'joined').length)).toBe(1);
}
async function abrirChat(page, opciones) {
  const e = await abrir(page, opciones);
  await boton(page, 'Mensajes').click();
  await expect(page.locator('h1')).toHaveText(TITULO_CHAT);
  await expect(mensajes(page).first()).toBeVisible();
  await esperarCanal(page);
  return e;
}

test.describe('inicio: Mensajes y Avisos', () => {
  test('debajo de "Próximos sittings", con lo que falta leer; sin avisos de chat en la cuenta de Avisos', async ({ page }) => {
    const datos = datosBase();
    // Un aviso del chat sin leer: ya cuenta en "Mensajes", no se cuenta dos veces.
    datos.avisos.push({ id: '94000000-0000-4000-8000-000000000010', clave: `chat:${ID.chAna3}`, para_ninera_id: ID.nAna, para_admin: null, tipo: 'chat',
      titulo: 'Paula Prueba', cuerpo: 'Gracias, te mandamos la dirección más tarde.', url: '#chat', creado_en: '2026-10-04T13:00:00+00:00', leido_en: null });
    const e = await abrir(page, { datos });
    await expect(boton(page, 'Mensajes')).toBeVisible();
    await expect(boton(page, 'Mensajes').locator('.contador')).toHaveText('1');
    await expect(boton(page, 'Avisos').locator('.contador')).toHaveText('1');
    // El orden: lo de hoy, los próximos sittings, Mensajes y Avisos, y el pie.
    const orden = await page.evaluate(() => ['#proximos-sittings', '#inicio-accesos', '.pie'].map(s => document.querySelector(s).getBoundingClientRect().top));
    expect(orden[0]).toBeLessThan(orden[1]);
    expect(orden[1]).toBeLessThan(orden[2]);

    await boton(page, 'Mensajes').click();
    await expect(page.locator('h1')).toHaveText(TITULO_CHAT);
    expect(new URL(page.url()).hash).toBe('#chat');
    await expect(mensajes(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(new URL(page.url()).hash).toBe('#inicio');
    // Leído: ya no tiene número.
    await expect(boton(page, 'Mensajes')).toBeVisible();
    await expect(boton(page, 'Mensajes').locator('.contador')).toHaveCount(0);
    await expect(boton(page, 'Avisos').locator('.contador')).toHaveText('1');

    await boton(page, 'Avisos').click();
    await expect(page.locator('h1')).toHaveText('Avisos');
    expect(new URL(page.url()).hash).toBe('#mis-avisos');
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(boton(page, 'Avisos')).toBeVisible();
    await expect(boton(page, 'Avisos').locator('.contador')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('sin nada para leer: los botones sin número', async ({ page }) => {
    const datos = datosBase();
    datos.chat_mensajes.forEach(m => { m.leido_ninera_en = m.leido_ninera_en || '2026-10-04T14:00:00+00:00'; });
    datos.avisos.forEach(a => { a.leido_en = '2026-10-04T14:00:00+00:00'; });
    const e = await abrir(page, { datos });
    await expect(boton(page, 'Mensajes')).toBeVisible();
    await expect(boton(page, 'Avisos')).toBeVisible();
    await expect(page.locator('#inicio-accesos .contador')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('sin conexión al contar: los botones igual están, sin número, y el inicio no se traba', async ({ page }) => {
    const e = await abrir(page);
    // Se corta la conexión y se vuelve a pintar el inicio como la primera vez (sin saber todavía si
    // la base tiene la migración).
    await page.route(/\/rest\/v1\/(chat_mensajes|avisos)/, r => r.abort('failed'));
    await page.evaluate(() => { chatNineraSinMigrar = null; return renderInicio(); });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(boton(page, 'Mensajes')).toBeVisible();
    await expect(boton(page, 'Avisos')).toBeVisible();
    await expect(page.locator('#inicio-accesos .contador')).toHaveCount(0);
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('chat con el equipo', () => {
  test('el hilo en orden: los del equipo a la izquierda con su autor, los suyos a la derecha, con la hora', async ({ page }) => {
    const e = await abrirChat(page);
    await expect(page.locator('#app')).toContainText(OPERADORA);
    await expect(mensajes(page)).toHaveCount(3);
    const filas = await mensajes(page).evaluateAll(ms => ms.map(m => ({
      lado: m.classList.contains('mio') ? 'mio' : 'equipo',
      autor: m.querySelector('.chat-autor')?.textContent ?? null,
      texto: m.querySelector('.chat-texto').textContent,
      hora: m.querySelector('.chat-hora').textContent,
    })));
    expect(filas).toEqual([
      { lado: 'equipo', autor: 'Paula Prueba', texto: 'Hola Ana, ¿te queda bien el sitting de mañana?', hora: '03/10 10:00' },
      { lado: 'mio', autor: null, texto: 'Sí, ahí estaré.', hora: '03/10 10:15' },
      { lado: 'equipo', autor: 'Paula Prueba', texto: 'Gracias, te mandamos la dirección más tarde.', hora: '10:00' },
    ]);
    // Los suyos a la derecha, los del equipo a la izquierda.
    const [x0, x1] = await mensajes(page).evaluateAll(ms => ms.slice(0, 2).map(m => m.getBoundingClientRect()));
    expect(x1.right).toBeGreaterThan(x0.right);
    expect(x0.left).toBeLessThan(x1.left);
    // Nunca el hilo de otra niñera.
    await expect(page.locator('#chat-hilo')).not.toContainText('Hola, ¿me confirman el horario del lunes?');
    verificarLimpio(e);
  });

  test('al abrir marca leído lo del equipo (una vez, después de cargar el hilo)', async ({ page }) => {
    const e = await abrirChat(page);
    await expect.poll(() => rpcs(e, 'ninera_marcar_chat_leido').length).toBe(1);
    expect(e.db.chat_mensajes.find(m => m.id === ID.chAna3).leido_ninera_en).not.toBeNull();
    verificarLimpio(e);
  });

  test('mandar: la RPC con el texto, el mensaje aparece una sola vez aunque llegue también por Realtime', async ({ page }) => {
    const e = await abrirChat(page);
    await page.fill('#chat-texto', 'Hola equipo,\n¿a qué hora llego?');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(mensajes(page)).toHaveCount(4);
    expect(rpcs(e, 'ninera_enviar_mensaje')).toEqual([{ p_texto: 'Hola equipo,\n¿a qué hora llego?' }]);
    const ultimo = mensajes(page).last();
    await expect(ultimo).toHaveClass(/mio/);
    await expect(ultimo.locator('.chat-texto')).toHaveText('Hola equipo,\n¿a qué hora llego?');
    await expect(ultimo.locator('.chat-hora')).toHaveText('12:00');
    await expect(page.locator('#chat-texto')).toHaveValue('');
    // La misma fila por Realtime: no se duplica.
    const fila = e.db.chat_mensajes[e.db.chat_mensajes.length - 1];
    expect(e.emitirRealtime('chat_mensajes', 'INSERT', fila)).toBe(1);
    await page.waitForTimeout(300);
    await expect(mensajes(page)).toHaveCount(4);
    // Lo suyo no se vuelve a marcar leído.
    expect(rpcs(e, 'ninera_marcar_chat_leido')).toHaveLength(1);
    verificarLimpio(e);
  });

  test('si Realtime trae su mensaje antes que la respuesta de la RPC: igual queda una sola vez', async ({ page }) => {
    const e = await abrirChat(page);
    const original = e.rpc.ninera_enviar_mensaje;
    e.rpc.ninera_enviar_mensaje = (cuerpo, db) => {
      const fila = original(cuerpo, db);
      e.emitirRealtime('chat_mensajes', 'INSERT', fila);
      return new Promise(r => setTimeout(() => r(fila), 300));
    };
    await page.fill('#chat-texto', 'Llego en 10');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('#chat-texto')).toHaveValue('');
    await expect(mensajes(page)).toHaveCount(4);
    await expect(mensajes(page).last().locator('.chat-texto')).toHaveText('Llego en 10');
    verificarLimpio(e);
  });

  test('lo que escribe mientras se manda no se pierde', async ({ page }) => {
    const e = await abrirChat(page);
    e.demoraEscrituras = 500;
    await page.fill('#chat-texto', 'Hola');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await page.locator('#chat-texto').press('End');
    await page.locator('#chat-texto').pressSequentially(' y algo más');
    await expect(mensajes(page)).toHaveCount(4);
    await expect(mensajes(page).last().locator('.chat-texto')).toHaveText('Hola');
    await expect(page.locator('#chat-texto')).toHaveValue('y algo más');
    verificarLimpio(e);
  });

  test('recibir por Realtime con algo escrito: el mensaje se suma y lo escrito queda', async ({ page }) => {
    const e = await abrirChat(page);
    await page.fill('#chat-texto', 'Estoy escribiendo a me');
    await page.locator('#chat-texto').focus();
    const nuevo = mensajeEquipo('01', 'La dirección es Calle Falsa 123.');
    e.db.chat_mensajes.push(nuevo);
    expect(e.emitirRealtime('chat_mensajes', 'INSERT', nuevo)).toBe(1);
    await expect(mensajes(page)).toHaveCount(4);
    await expect(mensajes(page).last().locator('.chat-autor')).toHaveText('Lucía Prueba');
    await expect(mensajes(page).last().locator('.chat-texto')).toHaveText('La dirección es Calle Falsa 123.');
    await expect(page.locator('#chat-texto')).toHaveValue('Estoy escribiendo a me');
    await expect(page.locator('#chat-texto')).toBeFocused();
    // Lo vio: se marca leído de nuevo.
    await expect.poll(() => rpcs(e, 'ninera_marcar_chat_leido').length).toBe(2);
    expect(e.db.chat_mensajes.find(m => m.id === nuevo.id).leido_ninera_en).not.toBeNull();
    // El de otra niñera no llega (filtro del canal y RLS).
    expect(e.emitirRealtime('chat_mensajes', 'INSERT', { ...mensajeEquipo('02', 'Para Carla'), ninera_id: ID.nCarla })).toBe(0);
    verificarLimpio(e);
  });

  test('con la app en segundo plano: el mensaje se suma pero no se marca leído hasta volver', async ({ page }) => {
    const e = await abrirChat(page);
    await expect.poll(() => rpcs(e, 'ninera_marcar_chat_leido').length).toBe(1);
    const fijarVisibilidad = estado => page.evaluate(v => {
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
      Object.defineProperty(document, 'hidden', { value: v === 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, estado);
    await fijarVisibilidad('hidden');
    const nuevo = mensajeEquipo('09', 'Mensaje con la pantalla apagada');
    e.db.chat_mensajes.push(nuevo);
    expect(e.emitirRealtime('chat_mensajes', 'INSERT', nuevo)).toBe(1);
    await expect(mensajes(page)).toHaveCount(4);
    await page.waitForTimeout(300);
    expect(rpcs(e, 'ninera_marcar_chat_leido')).toHaveLength(1);
    expect(e.db.chat_mensajes.find(m => m.id === nuevo.id).leido_ninera_en).toBeNull();
    // Vuelve al frente: se relee el hilo (ya estaba) y se marca leído.
    await fijarVisibilidad('visible');
    await expect.poll(() => rpcs(e, 'ninera_marcar_chat_leido').length).toBe(2);
    expect(e.db.chat_mensajes.find(m => m.id === nuevo.id).leido_ninera_en).not.toBeNull();
    await expect(mensajes(page)).toHaveCount(4);
    verificarLimpio(e);
  });

  test('hilo vacío: lo dice, y el primer mensaje que llega lo reemplaza', async ({ page }) => {
    const datos = datosBase();
    datos.chat_mensajes = datos.chat_mensajes.filter(m => m.ninera_id !== ID.nAna);
    const e = await abrir(page, { datos });
    await expect(boton(page, 'Mensajes')).toBeVisible();
    await boton(page, 'Mensajes').click();
    await expect(page.locator('#chat-hilo')).toContainText(SIN_MENSAJES);
    await esperarCanal(page);
    e.emitirRealtime('chat_mensajes', 'INSERT', mensajeEquipo('03', 'Hola Ana'));
    await expect(mensajes(page)).toHaveCount(1);
    await expect(page.locator('#chat-hilo')).not.toContainText(SIN_MENSAJES);
    verificarLimpio(e);
  });

  test('vacío o solo espacios: no manda nada', async ({ page }) => {
    const e = await abrirChat(page);
    await page.getByRole('button', { name: 'Enviar' }).click();
    await page.fill('#chat-texto', '   \n  ');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await page.waitForTimeout(200);
    expect(rpcs(e, 'ninera_enviar_mensaje')).toEqual([]);
    await expect(mensajes(page)).toHaveCount(3);
    await expect(page.locator('#chat-error')).toHaveText('');
    verificarLimpio(e);
  });

  test('si falla: el aviso, el texto queda y no aparece nada; al reintentar sale bien', async ({ page }) => {
    const e = await abrirChat(page);
    e.fallar = p => (p.tabla === 'rpc/ninera_enviar_mensaje' ? 'red' : undefined);
    await page.fill('#chat-texto', 'No me llega la dirección');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('#chat-error')).toHaveText(FALLA_ENVIAR);
    await expect(page.locator('#chat-texto')).toHaveValue('No me llega la dirección');
    await expect(mensajes(page)).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Enviar' })).toBeEnabled();

    e.fallar = p => (p.tabla === 'rpc/ninera_enviar_mensaje' ? { status: 500, message: 'falla simulada' } : undefined);
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('#chat-error')).toHaveText(FALLA_ENVIAR);
    await expect(page.locator('#chat-texto')).toHaveValue('No me llega la dirección');

    e.fallar = null;
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(mensajes(page)).toHaveCount(4);
    await expect(page.locator('#chat-error')).toHaveText('');
    await expect(page.locator('#chat-texto')).toHaveValue('');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('si la base lo rechaza por largo: lo dice (no habla de la conexión) y el texto queda', async ({ page }) => {
    const e = await abrirChat(page);
    e.rpc.ninera_enviar_mensaje = () => { throw errorRpc('mensaje_largo'); };
    await page.fill('#chat-texto', 'Un mensaje');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('#chat-error')).toHaveText(MUY_LARGO);
    await expect(page.locator('#chat-texto')).toHaveValue('Un mensaje');
    // El campo no deja escribir más de 2.000.
    await expect(page.locator('#chat-texto')).toHaveAttribute('maxlength', '2000');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('doble toque en "Enviar" con la base lenta: una sola RPC y un solo mensaje', async ({ page }) => {
    const e = await abrirChat(page);
    e.demoraEscrituras = 500;
    await page.fill('#chat-texto', 'Un solo mensaje');
    await page.getByRole('button', { name: 'Enviar' }).dblclick();
    await expect(mensajes(page)).toHaveCount(4);
    await page.waitForTimeout(700);
    expect(rpcs(e, 'ninera_enviar_mensaje')).toHaveLength(1);
    await expect(mensajes(page)).toHaveCount(4);
    verificarLimpio(e);
  });

  test('HTML tramposo en el texto y en el autor: se ve como texto, nada se ejecuta, los renglones quedan', async ({ page }) => {
    const datos = datosBase();
    const autor = '<img src=x onerror="window.__xss=1">Paula';
    const texto = '<script>window.__xss=2</script><b>negrita</b>\nsegundo renglón';
    datos.chat_mensajes.push({ id: '93000000-0000-4000-8000-000000000050', ninera_id: ID.nAna, de: 'admin', autor, texto,
      creado_en: '2026-10-04T14:30:00+00:00', leido_ninera_en: null, leido_admin_en: null });
    const e = await abrir(page, { datos });
    await boton(page, 'Mensajes').click();
    await expect(mensajes(page)).toHaveCount(4);
    await esperarCanal(page);
    await expect(mensajes(page).last().locator('.chat-autor')).toHaveText(autor);
    await expect(mensajes(page).last().locator('.chat-texto')).toHaveText(texto);
    // Por Realtime, igual (la fila queda en la base, como en la de verdad).
    const tramposo = mensajeEquipo('04', '<img src=x onerror="window.__xss=3">', { autor: '"><svg onload="window.__xss=4">' });
    e.db.chat_mensajes.push(tramposo);
    e.emitirRealtime('chat_mensajes', 'INSERT', tramposo);
    await expect(mensajes(page)).toHaveCount(5);
    await expect(mensajes(page).last().locator('.chat-texto')).toHaveText('<img src=x onerror="window.__xss=3">');
    // Lo que manda ella.
    await page.fill('#chat-texto', '<i onclick="x()">hola</i>');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(mensajes(page)).toHaveCount(6);
    await expect(mensajes(page).last().locator('.chat-texto')).toHaveText('<i onclick="x()">hola</i>');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator('#chat-hilo img, #chat-hilo svg, #chat-hilo b, #chat-hilo i').count()).toBe(0);
    // El salto de línea se ve como renglón aparte (CSS), no con <br> armado a mano.
    expect(await mensajes(page).nth(3).locator('.chat-texto').evaluate(el => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
    expect(await mensajes(page).nth(3).locator('br').count()).toBe(0);
    verificarLimpio(e);
  });

  test('al entrar va al último mensaje; uno nuevo baja solo si estaba abajo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const datos = datosBase();
    for (let i = 10; i < 40; i++) {
      datos.chat_mensajes.push({ id: `93000000-0000-4000-8000-0000000002${i}`, ninera_id: ID.nAna, de: i % 2 ? 'admin' : 'ninera', autor: i % 2 ? 'Paula Prueba' : 'Ana Ficticia',
        texto: `Mensaje número ${i} con un poco de texto para que ocupe lugar en la pantalla del celular.`, creado_en: `2026-10-04T14:${i}:00+00:00`, leido_ninera_en: null, leido_admin_en: null });
    }
    const e = await abrir(page, { datos });
    await boton(page, 'Mensajes').click();
    await expect(mensajes(page)).toHaveCount(33);
    await esperarCanal(page);
    const abajo = () => page.evaluate(() => { const h = document.getElementById('chat-hilo'); return h.scrollHeight - h.scrollTop - h.clientHeight < 4; });
    const arriba = () => page.evaluate(() => document.getElementById('chat-hilo').scrollTop);
    expect(await page.evaluate(() => { const h = document.getElementById('chat-hilo'); return h.scrollHeight > h.clientHeight; })).toBe(true);
    await expect.poll(abajo).toBe(true);
    e.emitirRealtime('chat_mensajes', 'INSERT', mensajeEquipo('05', 'Nuevo de abajo'));
    await expect(mensajes(page)).toHaveCount(34);
    await expect.poll(abajo).toBe(true);
    // Subió a leer algo viejo: el nuevo no la mueve.
    await page.evaluate(() => { document.getElementById('chat-hilo').scrollTop = 0; });
    e.emitirRealtime('chat_mensajes', 'INSERT', mensajeEquipo('06', 'Nuevo mientras lee arriba', { creado_en: '2026-10-04T15:06:00+00:00' }));
    await expect(mensajes(page)).toHaveCount(35);
    expect(await arriba()).toBe(0);
    verificarLimpio(e);
  });

  test('si no carga el hilo: el aviso con "Reintentar", sin marcar leído', async ({ page }) => {
    const e = await abrir(page);
    await expect(boton(page, 'Mensajes')).toBeVisible();
    // La base responde con error (lo que se corta, supabase-js lo reintenta 3 veces antes).
    await page.route(/\/rest\/v1\/chat_mensajes/, r => r.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }));
    await boton(page, 'Mensajes').click();
    await expect(page.locator('#chat-hilo')).toContainText(FALLA_CHAT);
    expect(rpcs(e, 'ninera_marcar_chat_leido')).toEqual([]);
    await page.unroute(/\/rest\/v1\/chat_mensajes/);
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(mensajes(page)).toHaveCount(3);
    await expect.poll(() => rpcs(e, 'ninera_marcar_chat_leido').length).toBe(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('"Volver" lleva al inicio y quita el canal: lo que llega después no se agrega a nada', async ({ page }) => {
    const e = await abrirChat(page);
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect.poll(() => page.evaluate(() => sbn.getChannels().length)).toBe(0);
    expect(e.emitirRealtime('chat_mensajes', 'INSERT', mensajeEquipo('07', 'Tarde'))).toBe(0);
    // Volver a entrar: un canal nuevo, que escucha.
    await boton(page, 'Mensajes').click();
    await expect(mensajes(page)).toHaveCount(3);
    await esperarCanal(page);
    expect(e.emitirRealtime('chat_mensajes', 'INSERT', mensajeEquipo('08', 'Ahora sí'))).toBe(1);
    await expect(mensajes(page)).toHaveCount(4);
    verificarLimpio(e);
  });
});

test.describe('lista de avisos', () => {
  function datosConAvisos() {
    const datos = datosBase();
    datos.avisos.push(
      { id: '94000000-0000-4000-8000-000000000011', clave: `chat:${ID.chAna3}`, para_ninera_id: ID.nAna, para_admin: null, tipo: 'chat',
        titulo: 'Paula Prueba', cuerpo: 'Gracias, te mandamos la dirección más tarde.', url: '#chat', creado_en: '2026-10-04T13:00:00+00:00', leido_en: null },
      { id: '94000000-0000-4000-8000-000000000012', clave: 'bienvenida', para_ninera_id: ID.nAna, para_admin: null, tipo: 'otro',
        titulo: 'Bienvenida', cuerpo: 'Ya puedes recibir avisos.', url: null, creado_en: '2026-10-01T15:00:00+00:00', leido_en: '2026-10-01T16:00:00+00:00' },
    );
    return datos;
  }

  test('el más nuevo arriba, con título, texto y fecha; al abrir se marcan leídos', async ({ page }) => {
    const e = await abrir(page, { datos: datosConAvisos() });
    await boton(page, 'Avisos').click();
    await expect(page.locator('h1')).toHaveText('Avisos');
    await expect(avisos(page)).toHaveCount(3);
    const filas = await avisos(page).evaluateAll(as => as.map(a => [
      a.querySelector('.aviso-titulo').textContent, a.querySelector('.aviso-cuerpo')?.textContent ?? '', a.querySelector('.aviso-fecha').textContent,
    ]));
    expect(filas).toEqual([
      ['Paula Prueba', 'Gracias, te mandamos la dirección más tarde.', '10:00'],
      ['Hoy tienes un sitting', 'A las 18:00 en Pocitos.', '09:00'],
      ['Bienvenida', 'Ya puedes recibir avisos.', '01/10 12:00'],
    ]);
    // Los que no había leído, marcados.
    await expect(avisos(page).nth(0)).toHaveClass(/sin-leer/);
    await expect(avisos(page).nth(2)).not.toHaveClass(/sin-leer/);
    await expect.poll(() => rpcs(e, 'ninera_marcar_avisos_leidos').length).toBe(1);
    expect(e.db.avisos.find(a => a.id === ID.avAna).leido_en).not.toBeNull();
    // Nunca los de otra niñera ni los de las admins.
    await expect(page.locator('#avisos-lista')).not.toContainText('Carla Ejemplo');
    verificarLimpio(e);
  });

  test('tocar uno con link va ahí (el del chat abre el hilo); uno sin link no es un botón', async ({ page }) => {
    const e = await abrir(page, { datos: datosConAvisos() });
    await boton(page, 'Avisos').click();
    await expect(avisos(page)).toHaveCount(3);
    await expect(avisos(page).nth(2)).not.toHaveJSProperty('tagName', 'BUTTON');
    await avisos(page).nth(1).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(new URL(page.url()).hash).toBe('#inicio');
    await boton(page, 'Avisos').click();
    await avisos(page).nth(0).click();
    await expect(page.locator('h1')).toHaveText(TITULO_CHAT);
    expect(new URL(page.url()).hash).toBe('#chat');
    await expect(mensajes(page)).toHaveCount(3);
    verificarLimpio(e);
  });

  test('datos tramposos y un link que no es de la app: texto, sin botón ni ejecución', async ({ page }) => {
    const datos = datosBase();
    datos.avisos = [
      { id: '94000000-0000-4000-8000-000000000020', clave: 'x1', para_ninera_id: ID.nAna, para_admin: null, tipo: 'otro',
        titulo: '<img src=x onerror="window.__xss=1">', cuerpo: '<b>hola</b>\notra línea', url: 'javascript:window.__xss=2', creado_en: '2026-10-04T13:00:00+00:00', leido_en: null },
      { id: '94000000-0000-4000-8000-000000000021', clave: 'x2', para_ninera_id: ID.nAna, para_admin: null, tipo: 'otro',
        titulo: 'Link raro', cuerpo: null, url: '#chat")+alert(1)//', creado_en: '2026-10-04T12:30:00+00:00', leido_en: null },
    ];
    const e = await abrir(page, { datos });
    await boton(page, 'Avisos').click();
    await expect(avisos(page)).toHaveCount(2);
    await expect(avisos(page).nth(0).locator('.aviso-titulo')).toHaveText('<img src=x onerror="window.__xss=1">');
    await expect(avisos(page).nth(0).locator('.aviso-cuerpo')).toHaveText('<b>hola</b>\notra línea');
    await expect(avisos(page).nth(0)).not.toHaveJSProperty('tagName', 'BUTTON');
    // Empieza con # pero no es una pantalla de la app: tocarlo no hace nada.
    await avisos(page).nth(1).click();
    await page.waitForTimeout(200);
    await expect(page.locator('h1')).toHaveText('Avisos');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator('#avisos-lista img, #avisos-lista b').count()).toBe(0);
    verificarLimpio(e);
  });

  test('sin avisos: "No tienes avisos."', async ({ page }) => {
    const datos = datosBase();
    datos.avisos = [];
    const e = await abrir(page, { datos });
    await boton(page, 'Avisos').click();
    await expect(page.locator('#avisos-lista')).toHaveText(SIN_AVISOS);
    verificarLimpio(e);
  });

  test('los últimos 50, aunque tenga más', async ({ page }) => {
    const datos = datosBase();
    for (let i = 10; i < 70; i++) {
      datos.avisos.push({ id: `94000000-0000-4000-8000-0000000003${i}`, clave: `k${i}`, para_ninera_id: ID.nAna, para_admin: null, tipo: 'otro',
        titulo: `Aviso ${i}`, cuerpo: '', url: null, creado_en: new Date(Date.UTC(2026, 8, 1, 12, i)).toISOString(), leido_en: null });
    }
    const e = await abrir(page, { datos });
    await boton(page, 'Avisos').click();
    await expect(avisos(page)).toHaveCount(50);
    // El más nuevo (el de hoy) primero.
    await expect(avisos(page).first().locator('.aviso-titulo')).toHaveText('Hoy tienes un sitting');
    verificarLimpio(e);
  });

  test('si no carga la lista: el aviso con "Reintentar", sin marcar leídos', async ({ page }) => {
    const e = await abrir(page);
    await expect(boton(page, 'Avisos')).toBeVisible();
    // La base responde con error (lo que se corta, supabase-js lo reintenta 3 veces antes).
    await page.route(/\/rest\/v1\/avisos/, r => r.fulfill({ status: 500, json: { code: 'XX000', message: 'falla simulada' } }));
    await boton(page, 'Avisos').click();
    await expect(page.locator('#avisos-lista')).toContainText(FALLA_AVISOS);
    expect(rpcs(e, 'ninera_marcar_avisos_leidos')).toEqual([]);
    await page.unroute(/\/rest\/v1\/avisos/);
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(avisos(page)).toHaveCount(1);
    await expect.poll(() => rpcs(e, 'ninera_marcar_avisos_leidos').length).toBe(1);
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('entrar directo, base sin migrar, celular y textos', () => {
  test('abrir la app con #chat en la URL (el push del chat) va directo al hilo; con #mis-avisos, a la lista', async ({ page, browser }) => {
    const e = await abrir(page, { consulta: '#chat' });
    await expect(page.locator('h1')).toHaveText(TITULO_CHAT);
    await expect(mensajes(page)).toHaveCount(3);
    expect(new URL(page.url()).hash).toBe('#chat');
    verificarLimpio(e);

    const otra = await browser.newPage();
    const e2 = await abrir(otra, { consulta: '#mis-avisos' });
    await expect(otra.locator('h1')).toHaveText('Avisos');
    await expect(avisos(otra)).toHaveCount(1);
    verificarLimpio(e2);
    await otra.close();
  });

  test('con #chat pero sin el perfil completo: primero el perfil y, al guardarlo, el hilo', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pb-ninera-avisos-vistos', '1'));
    const e = await abrirAppNinera(page, { consulta: '#chat' });
    await expect(page.locator('h1')).toHaveText('Completa esto una sola vez');
    await page.getByRole('radio', { name: 'Sittings', exact: true }).check();
    await page.locator('.perfil-zona[value="Pocitos"]').check();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('h1')).toHaveText(TITULO_CHAT);
    await expect(mensajes(page)).toHaveCount(3);
    // Una sola vez: después, "Volver" va al inicio de siempre.
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    verificarLimpio(e);
  });

  test('un push con la app abierta (solo cambia el hash): desde el inicio abre el hilo; desde los avisos, también', async ({ page }) => {
    const e = await abrir(page);
    await expect(boton(page, 'Mensajes')).toBeVisible();
    await page.evaluate(() => { location.hash = '#chat'; });
    await expect(page.locator('h1')).toHaveText(TITULO_CHAT);
    await expect(mensajes(page)).toHaveCount(3);
    await esperarCanal(page);
    await page.evaluate(() => { location.hash = '#mis-avisos'; });
    await expect(page.locator('h1')).toHaveText('Avisos');
    await expect(avisos(page)).toHaveCount(1);
    // Salió del chat: el canal ya no está.
    await expect.poll(() => page.evaluate(() => sbn.getChannels().length)).toBe(0);
    await page.evaluate(() => { location.hash = '#chat'; });
    await expect(page.locator('h1')).toHaveText(TITULO_CHAT);
    verificarLimpio(e);
  });

  test('un push con la app abierta en el perfil de la primera vez: no se saltea el perfil', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pb-ninera-avisos-vistos', '1'));
    const e = await abrirAppNinera(page);
    await expect(page.locator('h1')).toHaveText('Completa esto una sola vez');
    await page.evaluate(() => { location.hash = '#chat'; });
    await page.waitForTimeout(300);
    await expect(page.locator('h1')).toHaveText('Completa esto una sola vez');
    expect(new URL(page.url()).hash).toBe('#perfil');
    expect(rpcs(e, 'ninera_marcar_chat_leido')).toEqual([]);
    // Al guardar, el inicio de siempre (el hash cambiado no quedó como pendiente).
    await page.getByRole('radio', { name: 'Sittings', exact: true }).check();
    await page.locator('.perfil-zona[value="Pocitos"]').check();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    verificarLimpio(e);
  });

  test('base sin la migración de la etapa 3: sin Mensajes ni Avisos, y #chat abre el inicio', async ({ page, browser }) => {
    const e = await abrir(page, { baseSinMigrar: 'etapa3' });
    await expect(page.locator('#app')).toContainText('No tienes pedidos por ahora.');
    await expect(page.locator('#proximos-sittings')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mi perfil' })).toBeVisible();
    await expect(page.locator('#inicio-accesos')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Mensajes|Avisos/ })).toHaveCount(0);
    verificarLimpio(e, { ignorar: RUIDO_SIN_MIGRAR });

    const otra = await browser.newPage();
    const e2 = await abrir(otra, { baseSinMigrar: 'etapa3', consulta: '#chat' });
    await expect(otra.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(new URL(otra.url()).hash).toBe('#inicio');
    await expect(otra.locator('#inicio-accesos')).toHaveCount(0);
    await otra.evaluate(() => irA('#mis-avisos'));
    await expect(otra.locator('#app')).toContainText('No tienes pedidos por ahora.');
    expect(new URL(otra.url()).hash).toBe('#inicio');
    expect(rpcs(e2, 'ninera_marcar_chat_leido')).toEqual([]);
    verificarLimpio(e2, { ignorar: RUIDO_SIN_MIGRAR });
    await otra.close();
  });

  test('a 390 px: sin scroll horizontal, el campo y "Enviar" a la vista y para el dedo (capturas)', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrir(page);
    await expect(boton(page, 'Mensajes')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const alto = await boton(page, 'Mensajes').evaluate(b => b.getBoundingClientRect().height);
    expect(alto).toBeGreaterThanOrEqual(48);
    await page.screenshot({ path: testInfo.outputPath('ninera-inicio-390.png'), fullPage: true, animations: 'disabled' });

    await boton(page, 'Mensajes').click();
    await expect(mensajes(page)).toHaveCount(3);
    await page.fill('#chat-texto', 'Un mensaje largo '.repeat(20));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const enviar = await page.getByRole('button', { name: 'Enviar' }).boundingBox();
    const campo = await page.locator('#chat-texto').boundingBox();
    expect(enviar.height).toBeGreaterThanOrEqual(44);
    expect(enviar.y + enviar.height).toBeLessThanOrEqual(844);
    expect(campo.y + campo.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: testInfo.outputPath('ninera-chat-390.png'), animations: 'disabled' });

    await page.getByRole('button', { name: 'Volver' }).click();
    await boton(page, 'Avisos').click();
    await expect(avisos(page)).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('ninera-avisos-390.png'), fullPage: true, animations: 'disabled' });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => irA('#chat'));
    await expect(mensajes(page)).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await page.screenshot({ path: testInfo.outputPath('ninera-chat-1280.png'), animations: 'disabled' });
    verificarLimpio(e);
  });

  test('ni el inicio, ni el chat, ni los avisos muestran montos ni "pago"', async ({ page }) => {
    const e = await abrir(page);
    await expect(boton(page, 'Mensajes')).toBeVisible();
    const htmls = [await page.locator('#app').innerHTML()];
    await boton(page, 'Mensajes').click();
    await expect(mensajes(page)).toHaveCount(3);
    htmls.push(await page.locator('#app').innerHTML());
    await page.getByRole('button', { name: 'Volver' }).click();
    await boton(page, 'Avisos').click();
    await expect(avisos(page)).toHaveCount(1);
    htmls.push(await page.locator('#app').innerHTML());
    for (const html of htmls) {
      expect(html).not.toMatch(PLATA);
      expect(html).not.toMatch(PAGO);
    }
    verificarLimpio(e);
  });
});
