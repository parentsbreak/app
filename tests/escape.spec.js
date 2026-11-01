// Escape de HTML y de handlers (PR 4, 05/10/2026). Las candidatas llegan desde un
// formulario público y cualquier nombre o nota puede traer comillas, apóstrofos (D'Alessandro)
// o HTML. Acá se cargan TODOS los campos de texto de los datos ficticios con un valor
// tramposo y se recorre cada módulo y cada ficha que se abre con "ver..." / "abrir...":
// - el HTML del dato nunca se ejecuta (window.__xss queda sin definir),
// - todo handler inline (onclick, onchange...) sigue siendo JavaScript válido,
// - ningún link o imagen termina en javascript:,
// - no hay errores de JS.
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio } = require('./support/app');
const { datosBase, ID } = require('./support/datos');

const TRAMPA = ` D'Ale"<img src=x onerror="window.__xss=(window.__xss||'')+'X'">`;
const URL_TRAMPA = `https://ejemplo.test/f.jpg?a='"><img src=x onerror="window.__xss='U'">`;
const CAMPOS_TEXTO = new Set([
  'nombre', 'apellido', 'telefono', 'mail', 'direccion', 'notas', 'experiencia', 'comentarios', 'concepto',
  'titulo', 'sugerencia', 'familia_nombre', 'ninera_nombre', 'registrado_por', 'origen', 'destino', 'zona',
  'barrios', 'cuenta_bancaria', 'idiomas', 'universidad', 'bachillerato', 'cocina', 'patologias',
  'capacitacion_extra', 'fechas_punta', 'disponibilidad', 'temporada_comentario', 'parte_nombre',
  'descripcion', 'empresa', 'presentacion', 'puntualidad', 'trato_ninos', 'conformidad', 'entrevisto',
  'explicacion_juegos', 'colegio', 'ninera_anterior', 'ninera_nueva', 'zona_sitting', 'primeros_auxilios',
  'trabaja_actualmente', 'licencia', 'cambia_panales', 'dispone_traslados', 'edad', 'nombre_completo',
  'modelo_auto', 'matricula', 'texto', 'telefono_pendiente',
]);
const CAMPOS_URL = new Set(['foto', 'foto_url', 'cv_url']);

function ensuciar(fila) {
  const out = { ...fila };
  for (const [k, v] of Object.entries(out)) {
    if (CAMPOS_URL.has(k)) out[k] = URL_TRAMPA;
    else if (!CAMPOS_TEXTO.has(k) || v === null || v === undefined) continue;
    else if (Array.isArray(v)) out[k] = v.map(x => typeof x === 'string' ? x + TRAMPA : x);
    else if (typeof v === 'string') out[k] = v + TRAMPA;
  }
  return out;
}

// Los datos base más una fila por cada tabla que en datos.js está vacía.
function datosTramposos() {
  const d = datosBase();
  const t = '2026-10-01T12:00:00Z';
  d.hijos_familia = [{ id: 'a1000000-0000-4000-8000-000000000001', familia_id: ID.fUno, nombre: 'Tomi', fecha_nacimiento: '2020-05-01', colegio: 'Escuela', orden: 1, created_at: t, edad_declarada: null, edad_declarada_en: null }];
  d.juguetes = [{ id: 'a2000000-0000-4000-8000-000000000001', nombre: 'Pelota', tipo: 'Juego', genero: 'Unisex', edad_desde: 2, edad_hasta: 6, foto_url: null, ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', estado: 'prestado', notas: 'Nota', created_at: t }];
  d.juguetes_movimientos = [{ id: 'a2000000-0000-4000-8000-000000000002', juguete_id: 'a2000000-0000-4000-8000-000000000001', ninera_anterior: null, ninera_nueva: 'Ana Ficticia', fecha: t, notas: 'Se lo llevó' }];
  d.contratos = [{ id: 'a3000000-0000-4000-8000-000000000001', tipo: 'ninera', parte_nombre: 'Ana Ficticia', fecha: '2026-10-01', estado: 'borrador', notas: 'Nota', created_at: t }];
  d.incidentes = [{ id: 'a4000000-0000-4000-8000-000000000001', fecha: '2026-09-20', tipo: 'Llegada tarde', gravedad: 'leve', ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', familia_id: ID.fUno, familia_nombre: 'Familia Prueba Uno', sitting_id: null, descripcion: 'Llegó 10 min tarde', registrado_por: 'Prueba', created_at: t }];
  d.resenas_ninieras = [{ id: 'a5000000-0000-4000-8000-000000000001', ninera_nombre: 'Ana Ficticia', ninera_id: ID.nAna, presentacion: 'Bien', puntualidad: 'Bien', trato_ninos: 'Muy bien', conformidad: 'Sí', puntuacion: 5, fecha: '2026-09-21', origen: 'Familia', created_at: t }];
  d.intermediaciones_enrique_pool = [{ id: 'a6000000-0000-4000-8000-000000000001', ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', estado: 'activa', updated_at: t }];
  d.intermediaciones_enrique = [{ id: 'a6000000-0000-4000-8000-000000000002', ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', fecha: '2026-09-22', monto: 1000, comentarios: 'Comentario', registrado_por: 'Prueba', created_at: t, cobrado: false }];
  d.intermediaciones_eventos = [{ id: 'a6000000-0000-4000-8000-000000000003', empresa: 'Empresa', fecha: '2026-09-23', cobro_total: 5000, comentarios: 'Comentario', registrado_por: 'Prueba', created_at: t, cobrado: false }];
  d.intermediaciones_eventos_ninieras = [{ id: 'a6000000-0000-4000-8000-000000000004', evento_id: 'a6000000-0000-4000-8000-000000000003', ninera_id: ID.nAna, ninera_nombre: 'Ana Ficticia', hora_inicio: '10:00:00', hora_fin: '14:00:00', pago: 1200, pagado: false }];
  d.solicitud_ninieras = [{ id: 'a7000000-0000-4000-8000-000000000001', solicitud_id: '80000000-0000-4000-8000-000000000001', ninera_id: ID.nCarla, ninera_nombre: 'Carla Ejemplo', pago_ninera: 780, estado: 'propuesta', created_at: t }];
  d.entrevistas = [{ id: 'a8000000-0000-4000-8000-000000000001', candidata_id: ID.cIntake, fecha: '2026-10-02', entrevisto: 'Prueba', rol: 'Niñera', puntajes: { comunicacion: { score: 4, notes: 'Clara' } }, redflags: {}, referencias: {}, psico: {}, explicacion_juegos: 'Juegos', notas: 'Nota', total: 4, recomendacion: 'Recomendada', created_at: t }];
  d.ninieras[0].candidata_id = ID.cIntake;
  for (const tabla of Object.keys(d)) d[tabla] = d[tabla].map(ensuciar);
  return d;
}

// Revisa la página tal como está: XSS, handlers inválidos, links javascript:.
async function revisar(page, donde) {
  const r = await page.evaluate(() => {
    const malos = [];
    for (const el of document.querySelectorAll('*')) {
      for (const a of el.attributes) {
        if (/^on/i.test(a.name)) {
          try { new Function('event', a.value); } catch (e) { malos.push(`${a.name}: ${a.value.slice(0, 160)}`); }
        }
        if ((a.name === 'href' || a.name === 'src') && /^\s*javascript:/i.test(a.value)) malos.push(`${a.name}=javascript:`);
      }
      // Un atributo que no existe en HTML con nombre de pedazo de dato = se rompieron las comillas.
      const esHtml = el.namespaceURI === 'http://www.w3.org/1999/xhtml'; // los <rect> de los SVG sí tienen x
      for (const a of el.attributes) if (esHtml && /^(ale|d'ale|x|<img)$/i.test(a.name)) malos.push(`atributo roto "${a.name}" en <${el.tagName.toLowerCase()}>`);
    }
    if (document.querySelector('img[src="x"]')) malos.push('se insertó <img src=x> del dato');
    return { xss: window.__xss, malos: [...new Set(malos)] };
  });
  expect(r.xss, `${donde}: se ejecutó HTML de los datos`).toBeUndefined();
  expect(r.malos, `${donde}: handlers o atributos rotos`).toEqual([]);
}

async function cerrarTodo(page) {
  await page.evaluate(() => {
    document.getElementById('fotolightbox')?.remove();
    if (typeof cerrarModal === 'function') { try { cerrarModal(); } catch (e) {} }
    document.querySelectorAll('#editmodal').forEach(m => m.remove());
  });
}

// Abre cada tipo de "ver..."/"abrir..." que haya en pantalla (el primero de cada uno).
const VISTAS = /^(ver(Familia|Ninera|FichaIntake|Detalle|HistorialSitting)|abrirModal(Solicitud|SitForm|Juguete|InterPoolNinera|InterEnriqueDetalle|InterEventoDetalle|Asignar|VigenciaAsignacion|Incidente)|elegirNuevaIntermediacion|abrirForm(InterEnrique|InterEvento)|editar(Familia|Ninera|FechaMarketing|GastoFijo|GastoGeneral|MovimientoSitting)|abrirLightboxFoto)\(/;
async function abrirVistas(page, modulo) {
  // Las secciones plegables (Niñeras de Enrique, 23/10/2026) se abren para revisar lo de adentro.
  await page.evaluate(() => document.querySelectorAll('#modcontent details').forEach(d => { d.open = true; }));
  const handlers = await page.evaluate(re => {
    const vistos = new Map();
    for (const el of document.querySelectorAll('#modcontent [onclick]')) {
      const h = el.getAttribute('onclick').trim();
      const m = h.match(new RegExp(re));
      if (m && !vistos.has(m[1]) && el.offsetParent !== null) vistos.set(m[1], h);
    }
    return [...vistos.values()];
  }, VISTAS.source);
  for (const h of handlers) {
    await page.evaluate(code => { try { (0, eval)(code); } catch (e) { window.__errorHandler = String(e); } }, h);
    await esperarQuieta(page);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__errorHandler), `${modulo}: ${h}`).toBeUndefined();
    await revisar(page, `${modulo} → ${h.slice(0, 60)}`);
    await cerrarTodo(page);
  }
  return handlers.length;
}

// Cuántas fichas/formularios distintos se abren hoy en cada módulo con estos datos.
// Intermediaciones (23/10/2026): sin pestañas, cada ficha se cuenta una vez (colocación, evento,
// niñera de Enrique y "+ Nueva"); antes las mismas se contaban de nuevo en cada pestaña.
const MINIMO_VISTAS = { agenda: 1, rrhh: 5, ninieras: 3, familias: 2, sittings: 2, intermediaciones: 4, finanzas: 1, marketing: 1, juguetes: 2 };
const MODULOS = [null, 'agenda', 'rrhh', 'ninieras', 'familias', 'sittings', 'intermediaciones', 'finanzas', 'marketing', 'legal', 'juguetes', 'notificaciones'];

test.describe('datos con comillas, apóstrofos y HTML', () => {
  for (const modulo of MODULOS) {
    test(`${modulo || 'hoy'}: nada se ejecuta y todos los handlers siguen andando`, async ({ page }) => {
      const e = await abrirApp(page, { datos: datosTramposos() });
      if (modulo) await irAModulo(page, modulo);
      await page.waitForTimeout(300);
      await revisar(page, modulo || 'hoy');
      let abiertas = await abrirVistas(page, modulo || 'hoy');
      // Cada pestaña interna (Candidatas / Entrevistadas, Historial / Niñeras Enrique...).
      const pestanias = await page.locator('#modcontent .subtab').count();
      for (let k = 0; k < pestanias; k++) {
        await page.locator('#modcontent .subtab').nth(k).click();
        await esperarQuieta(page);
        await page.waitForTimeout(200);
        await revisar(page, `${modulo} → pestaña ${k}`);
        abiertas += await abrirVistas(page, `${modulo} → pestaña ${k}`);
      }
      // Si cambia la pantalla y deja de encontrar fichas, el test tiene que avisar (no pasar vacío).
      expect(abiertas, 'fichas abiertas').toBeGreaterThanOrEqual(MINIMO_VISTAS[modulo || 'hoy'] || 0);
      verificarLimpio(e, { ignorar: [/ejemplo\.test|Failed to load resource/] });
    });
  }

  test('la Agenda: fijo, solicitud y registro desde la agenda', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosTramposos() });
    await irAModulo(page, 'agenda');
    await page.evaluate(async () => { agendaAncla = '2026-10-05'; await cargarAgendaSolicitudes(); });
    await esperarQuieta(page);
    const ids = await page.evaluate(() => {
      const fijo = agendaSolicitudes.find(s => s._fuente === 'asignacion');
      const sol = agendaSolicitudes.find(s => s._fuente === 'solicitud');
      return [fijo?.id, sol?.id];
    });
    for (const id of ids.filter(Boolean)) {
      await page.evaluate(i => abrirModalSolicitud(i), id);
      await page.waitForTimeout(200);
      await revisar(page, `agenda → ${id}`);
      await cerrarTodo(page);
    }
    await page.evaluate(() => abrirModalRegistroDesdeAgenda(agendaSolicitudes.find(s => s._fuente === 'asignacion')));
    await page.waitForTimeout(200);
    await revisar(page, 'agenda → registrar');
    verificarLimpio(e, { ignorar: [/ejemplo\.test|Failed to load resource/] });
  });

  test('las fichas de niñera y familia muestran el nombre tal cual, como texto', async ({ page }) => {
    const e = await abrirApp(page, { datos: datosTramposos() });
    await irAModulo(page, 'familias');
    await page.evaluate(id => verFamilia(id), ID.fUno);
    await esperarQuieta(page);
    await expect(page.locator('#editmodal')).toContainText(`Familia Prueba Uno${TRAMPA}`);
    await cerrarTodo(page);
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => verNinera(id), ID.nAna);
    await esperarQuieta(page);
    await expect(page.locator('#editmodal')).toContainText(`Ana Ficticia${TRAMPA}`);
    verificarLimpio(e, { ignorar: [/ejemplo\.test|Failed to load resource/] });
  });
  // 01/11/2026: el aviso de una zona que no pertenece a ninguna ("X" no pertenece...) ponía el texto
  // sin escapar. La zona de una candidata llega del formulario público y la de una familia, escrita a
  // mano; con un barrio conocido adentro (como en los datos tramposos) se reconoce y no llega al aviso.
  test('una zona suelta con HTML se muestra como texto en el aviso de zonas', async ({ page }) => {
    const zona = `Barrio raro"<img src=x onerror="window.__xss='Z'">`;
    const d = datosBase();
    d.familias = d.familias.map(f => f.id === ID.fUno ? { ...f, zona } : f);
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'familias');
    await page.evaluate(id => editarFamilia(id), ID.fUno);
    const aviso = page.locator('#ed-fam-zonas-field .helper', { hasText: 'no pertenece a ninguna zona' });
    await expect(aviso).toContainText(`"${zona}" no pertenece a ninguna zona`);
    await revisar(page, 'editar familia → zona suelta');
    verificarLimpio(e, { ignorar: [/Failed to load resource/] });
  });
});
