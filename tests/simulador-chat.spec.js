// Simulador de la etapa 3 (fase 1, 30/10/2026): chat_mensajes, avisos y las RPC de la niñera como
// los deja la migración 20261029_avisos_chat.sql. Las pantallas (tareas 3.4 y 3.5) se prueban en sus
// propios archivos; acá se mira que el simulador imite a la base, porque esos tests confían en él:
// la RLS de cada puerta (también en Realtime), las validaciones de las RPC, lo que una admin puede
// escribir y la base sin migrar. Todo por el cliente de supabase-js de cada puerta (sbn en la app de
// niñeras, sb en el panel), como lo va a usar la app.
const { test, expect } = require('@playwright/test');
const { abrirApp, abrirAppNinera, verificarLimpio } = require('./support/app');
const { ID, datosBase } = require('./support/datos');

// Ana con el perfil completo: sin eso la app la manda a completarlo (etapa 2).
function datosAnaConPerfil() {
  const datos = datosBase();
  Object.assign(datos.ninieras.find(n => n.id === ID.nAna), { zona: 'Pocitos', perfil_app_en: '2026-10-02T15:00:00+00:00' });
  return datos;
}
// Chromium anota en consola toda respuesta 4xx simulada.
const RUIDO_4XX = /status of 4\d\d/;

test.describe('simulador del chat y los avisos (etapa 3)', () => {
  test('la niñera lee solo su hilo y sus avisos', async ({ page }) => {
    const e = await abrirAppNinera(page, { datos: datosAnaConPerfil() });
    const { chat, avisos } = await page.evaluate(async () => {
      const chat = await sbn.from('chat_mensajes').select('id, de, autor, leido_ninera_en').order('creado_en');
      const avisos = await sbn.from('avisos').select('id, leido_en');
      return { chat, avisos };
    });
    expect(chat.error).toBeNull();
    expect(chat.data.map(m => [m.id, m.de, m.autor])).toEqual([
      [ID.chAna1, 'admin', 'Paula Prueba'], [ID.chAna2, 'ninera', 'Ana Ficticia'], [ID.chAna3, 'admin', 'Paula Prueba'],
    ]);
    expect(chat.data[2].leido_ninera_en).toBeNull();
    // Ni el aviso de chat para las admins ni nada de Carla.
    // (El simulador devuelve la fila entera aunque se pidan columnas: se miran los ids.)
    expect(avisos.data.map(a => [a.id, a.leido_en])).toEqual([[ID.avAna, null]]);
    verificarLimpio(e);
  });

  test('ninera_enviar_mensaje valida como la SQL, guarda la fila y encola el aviso a las admins', async ({ page }) => {
    const e = await abrirAppNinera(page, { datos: datosAnaConPerfil() });
    const enviar = texto => page.evaluate(async t => {
      const r = await sbn.rpc('ninera_enviar_mensaje', { p_texto: t });
      return { data: r.data, error: r.error && { code: r.error.code, message: r.error.message } };
    }, texto);

    for (const vacio of ['', '   ', ' \t\r\n ']) {
      expect((await enviar(vacio)).error).toEqual({ code: 'P0001', message: 'mensaje_vacio' });
    }
    expect((await enviar('a'.repeat(2001))).error).toEqual({ code: 'P0001', message: 'mensaje_largo' });
    expect(e.db.chat_mensajes).toHaveLength(4);

    // 2.000 caracteres con espacios alrededor entran: se cuentan después de recortar.
    const largo = await enviar('  ' + 'b'.repeat(2000) + '\n');
    expect(largo.error).toBeNull();
    expect(largo.data.texto).toBe('b'.repeat(2000));

    const r = await enviar('  Hola <b>equipo</b>\n');
    expect(r.error).toBeNull();
    // Un objeto (la función devuelve un chat_mensajes), con autor de la ficha y lo de la base.
    expect(r.data).toMatchObject({ ninera_id: ID.nAna, de: 'ninera', autor: 'Ana Ficticia', texto: 'Hola <b>equipo</b>', leido_ninera_en: null, leido_admin_en: null });
    expect(r.data.id).toMatch(/^[0-9a-f-]{36}$/);
    // Después del último mensaje aunque el reloj del test esté fijo: el hilo queda en orden.
    expect(r.data.creado_en > largo.data.creado_en).toBe(true);
    expect(largo.data.creado_en > '2026-10-04T14:00:00+00:00').toBe(true);
    const aviso = e.db.avisos.find(a => a.clave === `admin:chat:${r.data.id}`);
    expect(aviso).toMatchObject({ para_admin: 'todas', para_ninera_id: null, tipo: 'chat', titulo: 'Ana Ficticia',
      cuerpo: 'Hola <b>equipo</b>', url: `?ir=ninieras&ninera=${ID.nAna}` });
    // El del texto largo, recortado a 120.
    expect(e.db.avisos.find(a => a.clave === `admin:chat:${largo.data.id}`).cuerpo).toBe('b'.repeat(120));
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('marcar leído el chat y los avisos devuelve cuántos y la segunda vez 0', async ({ page }) => {
    const e = await abrirAppNinera(page, { datos: datosAnaConPerfil() });
    const llamar = nombre => page.evaluate(async n => (await sbn.rpc(n)).data, nombre);
    expect(await llamar('ninera_marcar_chat_leido')).toBe(1);
    expect(await llamar('ninera_marcar_chat_leido')).toBe(0);
    expect(e.db.chat_mensajes.find(m => m.id === ID.chAna3).leido_ninera_en).toBe('2026-10-04T15:00:00.000Z');
    // El de Carla y el de la propia Ana, intactos.
    expect(e.db.chat_mensajes.find(m => m.id === ID.chCarla).leido_ninera_en).toBeNull();
    expect(e.db.chat_mensajes.find(m => m.id === ID.chAna2).leido_ninera_en).toBeNull();
    expect(await llamar('ninera_marcar_avisos_leidos')).toBe(1);
    expect(await llamar('ninera_marcar_avisos_leidos')).toBe(0);
    expect(e.db.avisos.find(a => a.id === ID.avCarlaChat).leido_en).toBeNull();
    verificarLimpio(e);
  });

  test('la niñera no escribe directo en las tablas', async ({ page }) => {
    const e = await abrirAppNinera(page, { datos: datosAnaConPerfil() });
    const r = await page.evaluate(async ({ nAna, chAna3 }) => {
      const ins = await sbn.from('chat_mensajes').insert({ ninera_id: nAna, de: 'admin', autor: 'Paula Prueba', texto: 'falso' });
      const upd = await sbn.from('chat_mensajes').update({ leido_admin_en: '2026-10-04T15:00:00Z' }).eq('id', chAna3).select('id');
      const aviso = await sbn.from('avisos').insert({ para_ninera_id: nAna, clave: 'x', tipo: 'x', titulo: 'x' });
      return { ins: ins.error && ins.error.code, upd: upd.data, aviso: aviso.error && aviso.error.code };
    }, ID);
    expect(r).toEqual({ ins: '42501', upd: [], aviso: '42501' });
    expect(e.db.chat_mensajes).toHaveLength(4);
    expect(e.db.chat_mensajes.find(m => m.id === ID.chAna3).leido_admin_en).toBeNull();
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('Realtime llega a un canal de la app de niñeras, solo con lo suyo y lo que cumple el filtro', async ({ page }) => {
    const e = await abrirAppNinera(page, { datos: datosAnaConPerfil() });
    await page.evaluate(nAna => new Promise(resolve => {
      window.__rt = [];
      sbn.channel('prueba-chat')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensajes', filter: `ninera_id=eq.${nAna}` }, p => window.__rt.push(p.new))
        .subscribe(s => { if (s === 'SUBSCRIBED') resolve(); });
    }), ID.nAna);
    const nuevo = { id: '93000000-0000-4000-8000-000000000099', ninera_id: ID.nAna, de: 'admin', autor: 'Paula Prueba', texto: 'Nuevo' };
    expect(e.emitirRealtime('chat_mensajes', 'INSERT', nuevo)).toBe(1);
    // De otra niñera: la RLS no lo deja ver, no se manda.
    expect(e.emitirRealtime('chat_mensajes', 'INSERT', { ...nuevo, id: 'otro', ninera_id: ID.nCarla })).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__rt.map(m => m.id))).toEqual([nuevo.id]);
    verificarLimpio(e);
  });

  test('panel: una admin escribe solo como admin, a una niñera con cuenta, y marca solo leido_admin_en', async ({ page }) => {
    const e = await abrirApp(page);
    const r = await page.evaluate(async ({ nCarla, nBruno, chCarla }) => {
      const error = x => x.error && x.error.code;
      const ok = await sb.from('chat_mensajes').insert({ ninera_id: nCarla, de: 'admin', autor: 'Paula Prueba', texto: '  Hola Carla ' }).select('id, creado_en, texto').single();
      return {
        ok: ok.data, okError: error(ok),
        sinCuenta: error(await sb.from('chat_mensajes').insert({ ninera_id: nBruno, de: 'admin', autor: 'Paula Prueba', texto: 'Hola' })),
        comoNinera: error(await sb.from('chat_mensajes').insert({ ninera_id: nCarla, de: 'ninera', autor: 'Carla Ejemplo', texto: 'Hola' })),
        conId: error(await sb.from('chat_mensajes').insert({ id: '93000000-0000-4000-8000-000000000098', ninera_id: nCarla, de: 'admin', autor: 'Paula Prueba', texto: 'Hola' })),
        vacio: error(await sb.from('chat_mensajes').insert({ ninera_id: nCarla, de: 'admin', autor: 'Paula Prueba', texto: ' \n ' })),
        marcar: (await sb.from('chat_mensajes').update({ leido_admin_en: '2026-10-04T15:00:00Z' }).eq('id', chCarla).select('id')).data,
        cambiarTexto: error(await sb.from('chat_mensajes').update({ texto: 'otro' }).eq('id', chCarla)),
        chat: (await sb.from('chat_mensajes').select('id')).data.length,
        avisos: (await sb.from('avisos').select('id, para_admin')).data,
      };
    }, ID);
    expect(r.okError).toBeNull();
    // La base guarda el texto como llega (el trim es de la app) y pone id y creado_en.
    expect(r.ok.texto).toBe('  Hola Carla ');
    expect(r.ok.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r).toMatchObject({ sinCuenta: '42501', comoNinera: '42501', conId: '42501', vacio: '23514', marcar: [{ id: ID.chCarla }], cambiarTexto: '42501', chat: 5 });
    // Las admins ven solo los avisos para ellas, más el que encoló el mensaje a Carla... que es para
    // Carla: no lo ven.
    expect(r.avisos.every(a => a.para_admin === 'todas')).toBe(true);
    expect(r.avisos.map(a => a.id).sort()).toEqual([ID.avAnaChat, ID.avCarlaChat].sort());
    expect(e.db.avisos.find(a => a.clave === `chat:${r.ok.id}`)).toMatchObject({ para_ninera_id: ID.nCarla, titulo: 'Paula Prueba', url: '#chat' });
    expect(e.db.chat_mensajes.find(m => m.id === ID.chCarla)).toMatchObject({ texto: 'Hola, ¿me confirman el horario del lunes?', leido_admin_en: '2026-10-04T15:00:00Z' });
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });
  });

  test('base sin migrar: las RPC y las tablas de la etapa 3 no existen, lo de antes anda', async ({ page, browser }) => {
    const pedir = p => p.evaluate(async () => {
      const codigo = r => r.error ? r.error.code : 'ok';
      return {
        enviar: codigo(await sbn.rpc('ninera_enviar_mensaje', { p_texto: 'Hola' })),
        chat: codigo(await sbn.from('chat_mensajes').select('id')),
        avisos: codigo(await sbn.from('avisos').select('id')),
        actual: codigo(await sbn.rpc('ninera_actual')),
        perfil: codigo(await sbn.rpc('ninera_mi_perfil')),
      };
    });
    const e = await abrirAppNinera(page, { datos: datosAnaConPerfil(), baseSinMigrar: true });
    expect(await pedir(page)).toEqual({ enviar: 'PGRST202', chat: 'PGRST205', avisos: 'PGRST205', actual: 'ok', perfil: 'PGRST202' });
    verificarLimpio(e, { ignorar: [RUIDO_4XX] });

    // Solo sin la etapa 3: el perfil de la etapa 2 anda.
    const otra = await browser.newPage();
    const e2 = await abrirAppNinera(otra, { datos: datosAnaConPerfil(), baseSinMigrar: 'etapa3' });
    expect(await pedir(otra)).toEqual({ enviar: 'PGRST202', chat: 'PGRST205', avisos: 'PGRST205', actual: 'ok', perfil: 'ok' });
    verificarLimpio(e2, { ignorar: [RUIDO_4XX] });
    await otra.close();

    // El panel, igual.
    const panel = await browser.newPage();
    const e3 = await abrirApp(panel, { baseSinMigrar: 'etapa3' });
    expect(await panel.evaluate(async () => (await sb.from('chat_mensajes').select('id')).error.code)).toBe('PGRST205');
    verificarLimpio(e3, { ignorar: [RUIDO_4XX] });
    await panel.close();
  });
});
