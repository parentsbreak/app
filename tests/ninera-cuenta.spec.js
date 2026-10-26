// App de niñeras (fase 1, 26/10/2026): la segunda puerta, en ninera/. Estos tests arrancan por el
// simulador (abrirAppNinera en tests/support/app.js): que la puerta abra con la sesión de una
// niñera guardada aparte de la del panel, que se pueda simular la app instalada o no, y que las
// Edge Functions y las RPC de la niñera se simulen por nombre. Las tareas siguientes suman acá
// los tests de la invitación, el login y el inicio.
const { test, expect } = require('@playwright/test');
const { abrirAppNinera, verificarLimpio, REF_PROD } = require('./support/app');
const { ID } = require('./support/datos');

const BASE = `https://${REF_PROD}.supabase.co`;

test.describe('puerta de niñeras: simulador', () => {
  test('abre /ninera/ con la sesión de la niñera bajo su propia clave', async ({ page }) => {
    const e = await abrirAppNinera(page);
    await expect(page.locator('#pantalla-carga')).toHaveCount(1);
    expect(new URL(page.url()).pathname).toBe('/ninera/');
    const { niniera, panel } = await page.evaluate(ref => ({
      niniera: localStorage.getItem('sb-ninera-auth'),
      panel: localStorage.getItem(`sb-${ref}-auth-token`),
    }), REF_PROD);
    expect(panel).toBeNull();
    const sesion = JSON.parse(niniera);
    expect(sesion.user.id).toBe('00000000-0000-4000-8000-000000000002');
    expect(sesion.user.email).toBe('59900000001@ninieras.parentsbreak.invalid');
    // La niñera elegida (Ana por defecto) queda atada a esa cuenta; las otras, sin cuenta.
    expect(e.db.ninieras.find(n => n.id === ID.nAna).user_id).toBe(ID.uNinera);
    expect(e.db.ninieras.find(n => n.id === ID.nBruno).user_id).toBeNull();
    verificarLimpio(e);
  });

  test('simula la app instalada en la pantalla de inicio, o abierta en el navegador', async ({ page, browser }) => {
    const e = await abrirAppNinera(page);
    expect(await page.evaluate(() => [window.matchMedia('(display-mode: standalone)').matches, navigator.standalone])).toEqual([true, true]);
    verificarLimpio(e);

    const otra = await browser.newPage();
    const e2 = await abrirAppNinera(otra, { instalada: false });
    expect(await otra.evaluate(() => [window.matchMedia('(display-mode: standalone)').matches, navigator.standalone])).toEqual([false, false]);
    // El resto de las consultas de matchMedia siguen andando como siempre.
    expect(await otra.evaluate(() => typeof window.matchMedia('(max-width: 760px)').matches)).toBe('boolean');
    verificarLimpio(e2);
    await otra.close();
  });

  test('una Edge Function se simula por nombre y la llamada queda anotada', async ({ page }) => {
    const e = await abrirAppNinera(page);
    let recibido = null;
    e.funciones['ninera-cuenta'] = cuerpo => { recibido = cuerpo; return { status: 410, json: { error: 'vencido' } }; };
    const respuesta = await page.evaluate(async base => {
      const r = await fetch(base + '/functions/v1/ninera-cuenta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'canjear', token: 'b'.repeat(64) }),
      });
      return { status: r.status, cuerpo: await r.json() };
    }, BASE);
    expect(respuesta).toEqual({ status: 410, cuerpo: { error: 'vencido' } });
    expect(recibido).toEqual({ accion: 'canjear', token: 'b'.repeat(64) });
    expect(e.escrituras.filter(w => w.tabla === '/functions/v1/ninera-cuenta')).toHaveLength(1);
    verificarLimpio(e, { ignorar: [/status of 410/] }); // Chromium anota en consola toda respuesta 4xx
  });

  test('las RPC de la niñera vienen simuladas y un test las puede pisar', async ({ page }) => {
    const e = await abrirAppNinera(page, { ninera: ID.nCarla });
    const pedir = () => page.evaluate(async base => {
      const r = await fetch(base + '/rest/v1/rpc/ninera_actual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      return r.json();
    }, BASE);
    expect(await pedir()).toBe(ID.nCarla);
    e.rpc.ninera_actual = () => null;
    expect(await pedir()).toBeNull();
    verificarLimpio(e);
  });
});
