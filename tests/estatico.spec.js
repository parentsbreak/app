// Capa 1: chequeos estáticos, sin navegador. Corren en segundos.
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const path = require('path');
const { RAIZ, leer, ORDEN_SCRIPTS, ORDEN_SCRIPTS_NINERA, TODOS_LOS_SCRIPTS, scriptsDeIndex, scriptsDeIndexNinera, declaracionesTopLevel, funcionesLlamadasPorHandlers, emojisPorArchivo } = require('./support/fuentes');

test.describe('estático', () => {
  for (const archivo of [...TODOS_LOS_SCRIPTS, 'sw.js', 'ninera/sw.js']) {
    test(`node --check ${archivo}`, () => {
      execFileSync(process.execPath, ['--check', path.join(RAIZ, archivo)], { stdio: 'pipe' });
    });
  }

  test('manifest.json es JSON válido', () => {
    const m = JSON.parse(leer('manifest.json'));
    expect(m.start_url).toBe('./');
    // El de la app de niñeras (fase 1): ./ es su carpeta, ninera/.
    const n = JSON.parse(leer('ninera/manifest.json'));
    expect(n.start_url).toBe('./');
  });

  test('los handlers inline reciben los datos con argJs(), nunca entre comillas a mano', () => {
    // 05/10/2026: onclick="f('${nombre}')" se rompía con D'Alessandro y dejaba inyectar código.
    // El dato va como onclick="f(${argJs(nombre)})" (ver comun.js, "Escape de datos").
    const malos = [];
    for (const archivo of TODOS_LOS_SCRIPTS) {
      leer(archivo).split('\n').forEach((l, i) => {
        for (const m of l.matchAll(/\bon[a-z]+=(["'])(.*?)\1/g)) {
          if (/\\?'\$\{|"\$\{/.test(m[2]) || (m[1] === "'" && m[2].includes('${'))) malos.push(`${archivo}:${i + 1}: ${m[0].slice(0, 90)}`);
        }
      });
    }
    expect(malos).toEqual([]);
  });

  test('todo botón que escribe en la base pasa por conGuardado (sin doble toque)', () => {
    // 05/10/2026: un doble toque en Guardar disparaba dos inserts. Las funciones de abajo
    // escriben en la base; un <button> que las llama tiene que hacerlo con
    // conGuardado(this, ()=>...). Login y contraseñas manejan su botón por su cuenta.
    // Vale para las dos puertas (panel y app de niñeras).
    const ESCRIBEN = /^(guardar\w*|add(Asignacion|Contrato|Familia|FechaMarketing|Intake|Ninera)|contratar|crear(FamiliaRapida|NineraRapida)|registrar(ExcepcionFija|SittingFijoDeHoy|PasskeyDispositivo)|confirmar(Ninera|ReemplazoFijoHoy)|cambiarNineraAsignacionFija|cancelarSolicitud|marcar(GrupoResuelto|ContactadaRiesgo|Pendiente|TodoPendiente)|resolverCambioTelefono|repetirTemporadaAnterior|descartarIntake|eliminar\w+|reactivarRegistroDesdeAgenda|terminarFijoDesde|accion(AsignarBarrioAZona|CrearZonaConBarrio)|cambiarEstadoPoolEnrique|procesarExtractoConciliacion|confirmarConciliacion|activarPushNotificaciones|crearCuentaDesdeInvitacion|activarAvisosNinera|abrirInvitacionApp)$/;
    const PROPIOS = new Set(['guardarNuevaContrasena']);
    const malos = [];
    for (const archivo of TODOS_LOS_SCRIPTS) {
      leer(archivo).split('\n').forEach((l, i) => {
        for (const m of l.matchAll(/<button\b[^<>]*?\bonclick="([^"]*)"/g)) {
          const llamadas = [...m[1].matchAll(/(?<![\w.])([A-Za-z_]\w*)\(/g)].map(x => x[1]);
          const escribe = llamadas.filter(n => ESCRIBEN.test(n) && !PROPIOS.has(n));
          if (escribe.length && !m[1].startsWith('conGuardado(this, ()=>')) malos.push(`${archivo}:${i + 1}: ${escribe.join(', ')}`);
        }
      });
    }
    expect(malos).toEqual([]);
  });

  test('index.html carga los scripts en el orden acordado (bootstrap.js último)', () => {
    expect(scriptsDeIndex()).toEqual(ORDEN_SCRIPTS);
    expect(ORDEN_SCRIPTS[0]).toBe('js/comun.js');
    expect(leer('index.html')).not.toMatch(/type=["']module["']/);
  });

  test('ninera/index.html carga los scripts en el orden acordado (arranque.js último)', () => {
    // Fase 1 (26/10/2026): la app de niñeras comparte js/comun.js con el panel y suma sus
    // propios archivos; supabase-js va antes que todo, como en index.html.
    expect(scriptsDeIndexNinera()).toEqual(ORDEN_SCRIPTS_NINERA);
    const html = leer('ninera/index.html');
    expect(html).toContain('<script src="../vendor/supabase-js-2.117.2.umd.js"></script>');
    expect(html.indexOf('<script src="../vendor/supabase-js-2.117.2.umd.js"')).toBeLessThan(html.indexOf('<script src="../js/comun.js"'));
    expect(html).not.toMatch(/type=["']module["']/);
  });

  test('ninguna función o variable global está definida dos veces', () => {
    const porNombre = new Map();
    for (const d of declaracionesTopLevel()) {
      if (!porNombre.has(d.nombre)) porNombre.set(d.nombre, []);
      porNombre.get(d.nombre).push(`${d.archivo}:${d.linea}`);
    }
    const duplicadas = [...porNombre].filter(([, lugares]) => lugares.length > 1).map(([n, l]) => `${n} -> ${l.join(', ')}`);
    expect(duplicadas).toEqual([]);
  });

  test('app de niñeras: toda función que llama un handler inline está declarada en sus scripts', () => {
    // 26/10/2026: el panel lo controla en el navegador (humo.spec.js); la app de niñeras, acá sin
    // abrirla. Un onclick que llama una función de otro archivo del panel (o mal escrita) no
    // existe en /ninera/ y el botón no hace nada, sin error a la vista.
    const declaradas = new Set(declaracionesTopLevel(ORDEN_SCRIPTS_NINERA).map(d => d.nombre));
    const llamadas = [...funcionesLlamadasPorHandlers(ORDEN_SCRIPTS_NINERA)];
    expect(llamadas.length).toBeGreaterThan(0);
    const faltan = llamadas.filter(([n]) => !declaradas.has(n)).map(([n, donde]) => `${n} (${donde})`);
    expect(faltan).toEqual([]);
  });

  test('no se agregan emojis nuevos (los que ya existían quedan, ✕ ✓ ★ permitidos)', () => {
    // Lista congelada el 04/10/2026. Si un cambio saca uno de estos, actualizar acá.
    expect(emojisPorArchivo()).toEqual({
      'js/familias.js': '💛',
      'js/ninieras.js': '🎂💛☺',
      'js/postulantes.js': '⚠',
    });
  });

  test('ninguna fecha se saca con toISOString().slice(0,10) (es UTC: de noche da mañana)', () => {
    // 05/10/2026: todayISO() hacía eso y a partir de las 21:00 proponía la fecha de mañana.
    // Única excepción: el id de la notificación del extracto, que no se muestra (cambiarlo
    // haría reaparecer avisos ya leídos).
    const usos = [];
    for (const archivo of TODOS_LOS_SCRIPTS) {
      leer(archivo).split('\n').forEach((l, i) => {
        if (/toISOString\(\)\.slice\(0, ?10\)/.test(l) && !l.includes("id: 'extracto:'")) usos.push(`${archivo}:${i + 1}`);
      });
    }
    expect(usos).toEqual([]);
  });

  test('supabase-js se sirve desde el repo, con la versión y el archivo fijados', () => {
    // 05/10/2026 (E4): antes venía de jsdelivr y si el CDN fallaba la app quedaba en blanco.
    // Es el dist/umd/supabase.js de @supabase/supabase-js@2.117.2 publicado en npm.
    const html = leer('index.html');
    expect(html).toContain('<script src="vendor/supabase-js-2.117.2.umd.js"></script>');
    expect(html).not.toMatch(/cdn\.jsdelivr\.net/);
    const sha = require('crypto').createHash('sha256').update(require('fs').readFileSync(path.join(RAIZ, 'vendor/supabase-js-2.117.2.umd.js'))).digest('hex');
    expect(sha).toBe('59d39487c3589843b410322d8a3d562ce022aba1e5ccb16898ef3fb2a0da2ecd');
    // Va antes que core.js (que crea el cliente).
    expect(html.indexOf('vendor/supabase-js')).toBeLessThan(html.indexOf('js/core.js'));
  });

  test('temporada.html sigue redirigiendo al formulario de temporada (está en uso)', () => {
    const html = leer('temporada.html');
    expect(html).toContain("location.replace('https://parentsbreak.pages.dev/temporada' + location.search)");
  });
});

// Pantallas de inicio del iPhone (15/10/2026): cada <link> apunta a un PNG que existe y que
// mide exactamente lo que dice su media query (si no coincide, iOS lo ignora y muestra blanco).
test('pantallas de inicio del iPhone: archivos presentes y del tamaño justo', () => {
  const fs = require('fs');
  const path = require('path');
  const raiz = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  const links = [...html.matchAll(/<link rel="apple-touch-startup-image" href="([^"]+)" media="\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\) and \(orientation: portrait\)">/g)];
  expect(links.length).toBe(13);
  for (const [, href, w, h, r] of links) {
    const png = fs.readFileSync(path.join(raiz, href));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], href).toEqual([w * r, h * r]);
  }
});
