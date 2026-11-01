// CV automático de la niñera (01/11/2026): la pantalla "CV de [nombre]" (vista previa y las 7 líneas, precargadas
// desde la ficha), "Guardar y generar CV" (PNG de 1080×1920 a ninieras-fotos/cv/, cv_url, cv_generado_en,
// cv_datos y cv_generado_con), "Compartir" / "Descargar", el aviso de CV viejo, lo que nunca puede aparecer en el
// CV (teléfono, mail, zona, salud, cuenta, notas) y el CV en "Perfiles para la madre". Contra el simulador, con
// datos inventados: hoy es domingo 04/10/2026; Ana Ficticia nació el 10/03/2005 (21 años).
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, esperarQuieta, verificarLimpio, REF_PROD } = require('./support/app');
const { datosBase, datosEleccion, ID } = require('./support/datos');

const RUIDO = [/status of [45]\d\d/, /Failed to load resource|ERR_FAILED|Failed to fetch/, /\[Supabase\]/, /\[CV\]/];
const FOTOS = `https://${REF_PROD}.supabase.co/storage/v1/object/public/ninieras-fotos/`;
const FOTO = FOTOS + 'fotos/ana.jpg';
const SUBIDA = /^\/storage\/v1\/object\/ninieras-fotos\/cv\/[0-9a-f-]{36}\.png$/;
// Datos de la ficha que nunca pueden llegar al CV (lo ven las madres).
const PROHIBIDOS = ['098000001', '097000001', 'ana.ficticia', 'Pocitos', 'Asma', '0099887766', 'Nota interna', 'Comentario interno', 'Muestra'];

const modal = page => page.locator('#editmodal');
const estadoCv = page => page.locator('#cv-estado');
const botonGenerar = page => modal(page).locator('button', { hasText: 'Guardar y generar CV' });
const toasts = page => page.locator('.toaststack .toast');
const subidas = e => e.escrituras.filter(w => w.metodo === 'POST' && SUBIDA.test(w.tabla));
const borradosFotos = e => e.escrituras.filter(w => w.tabla === '/storage/v1/object/ninieras-fotos' && w.metodo === 'DELETE');
const parches = e => e.escrituras.filter(w => w.tabla === 'ninieras' && w.metodo === 'PATCH');
const ana = e => e.db.ninieras.find(n => n.id === ID.nAna);

function datosCv() {
  const d = datosBase();
  Object.assign(d.candidatas.find(c => c.id === ID.cIntake), {
    estado: 'contratada', fecha_nacimiento: '2005-03-10', universidad: 'Estudiante de Psicología', experiencia: 'Cuidó primos',
    cambia_panales: 'Si', idiomas: 'Inglés', primeros_auxilios: 'Curso de RCP.', capacitacion_extra: null,
    patologias: 'Asma leve inventada', mail: 'ana.ficticia@ejemplo.test', comentarios: 'Comentario interno inventado',
    notas_ficha: { experiencia: 'Dos años con mellizos' }, // lo corregido en la entrevista gana
  });
  Object.assign(d.ninieras.find(n => n.id === ID.nAna), { candidata_id: ID.cIntake, zona: 'Pocitos', notas: 'Nota interna inventada', foto: FOTO });
  return d;
}
// Lo que se dibuja en el lienzo del CV (cada vez que se vuelve a dibujar arranca de cero), lo que se comparte y
// lo que se descarga. compartir: true = el aparato puede compartir archivos; false = no tiene "Compartir".
async function espiar(page, { compartir = true } = {}) {
  await page.addInitScript(puede => {
    window.__cv = { textos: [], imagenes: [] };
    const P = CanvasRenderingContext2D.prototype;
    const delCv = ctx => ctx.canvas && ctx.canvas.id === 'cv-lienzo';
    const limpiar = P.clearRect;
    P.clearRect = function () { if (delCv(this)) window.__cv = { textos: [], imagenes: [] }; return limpiar.apply(this, arguments); };
    const texto = P.fillText;
    P.fillText = function (t, x, y) { if (delCv(this)) window.__cv.textos.push({ t, x, y, font: this.font }); return texto.apply(this, arguments); };
    const imagen = P.drawImage;
    P.drawImage = function (img) { if (delCv(this)) window.__cv.imagenes.push(img.src || ''); return imagen.apply(this, arguments); };
    window.__compartido = [];
    if (puede) {
      navigator.canShare = () => true;
      navigator.share = async d => { window.__compartido.push(d.files.map(f => ({ name: f.name, type: f.type, size: f.size }))); };
    } else {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    }
  }, compartir);
}
async function abrirCv(page, opciones = {}) {
  await espiar(page, opciones);
  const e = await abrirApp(page, { datos: opciones.datos || datosCv(), ...(opciones.baseSinMigrar ? { baseSinMigrar: opciones.baseSinMigrar } : {}) });
  if (opciones.antes) opciones.antes(e);
  await irAModulo(page, 'ninieras');
  await page.locator('#ninieras-body .smallbtn', { hasText: /^CV$/ }).first().click();
  await expect(modal(page).locator('h2')).toHaveText('CV de Ana Ficticia');
  await expect(estadoCv(page)).not.toContainText('Dibujando');
  return e;
}
const dibujado = page => page.evaluate(() => window.__cv);
const campo = (page, key) => page.locator('#cv-' + key);
// El PNG subido (dentro del multipart de supabase-js): ancho y alto del encabezado IHDR.
function medidasPng(bytes) {
  const i = bytes.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (i < 0) return null;
  return { ancho: bytes.readUInt32BE(i + 16), alto: bytes.readUInt32BE(i + 20) };
}

test.describe('Pantalla "CV de [nombre]"', () => {
  test('se abre desde la lista y la ficha, precargada desde la ficha, con la edad calculada y sin datos internos', async ({ page }) => {
    const e = await abrirCv(page);
    await expect(estadoCv(page)).toHaveText('Así va a quedar.');
    await expect(modal(page)).toContainText('Precargado con la ficha');
    // Con fecha de nacimiento, la edad sale sola y no se edita.
    await expect(campo(page, 'edad')).toHaveCount(0);
    await expect(modal(page).locator('.cv-fija')).toContainText('21 años');
    await expect(campo(page, 'estudios')).toHaveValue('Estudiante de Psicología');
    await expect(campo(page, 'experiencia')).toHaveValue('Dos años con mellizos');
    await expect(campo(page, 'panales')).toHaveValue('Cambia pañales');
    await expect(campo(page, 'idiomas')).toHaveValue('Inglés');
    await expect(campo(page, 'certificaciones')).toHaveValue('Curso de RCP');
    await expect(campo(page, 'diferenciales')).toHaveValue('');
    const d = await dibujado(page);
    expect(d.imagenes).toEqual([expect.stringContaining('img/cv/fondo-cv.png'), FOTO]);
    // El nombre va letra por letra (las letras juntadas), en uno o dos renglones.
    const nombre = d.textos.filter(t => t.font.includes('League Spartan'));
    const renglones = [...new Set(nombre.map(t => t.y))].map(y => nombre.filter(t => t.y === y).map(t => t.t).join(''));
    expect(renglones.join(' ')).toBe('ANA FICTICIA');
    expect(nombre[0].font).toBe('800 97px "CV League Spartan"');
    // Cada letra a la derecha de la anterior, un poco más junta que el ancho de la letra sola.
    expect(nombre.slice(1, 3).every((t, i) => t.x > nombre[i].x)).toBe(true);
    expect(d.textos.filter(t => t.font.includes('Arimo')).map(t => t.t).join(' '))
      .toBe('21 años Estudiante de Psicología Dos años con mellizos Cambia pañales Inglés Curso de RCP');
    const visible = await modal(page).textContent();
    for (const p of PROHIBIDOS) expect(visible).not.toContain(p);
    // Abrirla no escribe nada.
    expect(e.escrituras.filter(w => !w.tabla.startsWith('/auth/'))).toEqual([]);
    // Desde la ficha: el botón de la fila "CV" abre la misma pantalla.
    await page.evaluate(() => cerrarModal());
    await page.evaluate(id => verNinera(id), ID.nAna);
    await modal(page).locator('.fichadl button', { hasText: 'Generar el CV' }).click();
    await expect(modal(page).locator('h2')).toHaveText('CV de Ana Ficticia');
    verificarLimpio(e);
  });

  test('pañales "No", primeros auxilios "no", sin fecha de nacimiento y edad vieja: la precarga deja vacías y la edad a mano', async ({ page }) => {
    const d = datosCv();
    Object.assign(d.candidatas.find(c => c.id === ID.cIntake), { fecha_nacimiento: null, edad: '22', cambia_panales: 'No', primeros_auxilios: 'no', capacitacion_extra: 'Taller de juegos inventado' });
    const e = await abrirCv(page, { datos: d });
    await expect(campo(page, 'edad')).toHaveValue('22 años');
    await expect(campo(page, 'panales')).toHaveValue('');
    await expect(campo(page, 'certificaciones')).toHaveValue('Taller de juegos inventado');
    verificarLimpio(e);
  });

  test('lo que se escribe se dibuja enseguida; una línea vacía no va y no deja hueco', async ({ page }) => {
    const e = await abrirCv(page);
    await campo(page, 'idiomas').fill('');
    await campo(page, 'diferenciales').fill('Le encanta leer cuentos');
    await expect.poll(async () => (await dibujado(page)).textos.map(t => t.t).join(' ')).toContain('Le encanta leer cuentos');
    const datos = (await dibujado(page)).textos.filter(t => t.font.includes('Arimo'));
    expect(datos.map(t => t.t).join(' ')).not.toContain('Inglés');
    // Renglones seguidos: siempre la misma distancia entre bases, sin saltos.
    const pasos = datos.slice(1).map((t, i) => Math.round(t.y - datos[i].y));
    expect(new Set(pasos).size).toBe(1);
    verificarLimpio(e);
  });

  test('tamaño de la letra: 7 líneas a 74,5 px; 3 líneas cortas crecen; el CV de referencia (6 que llenan) queda en 74,5', async ({ page }) => {
    const d = datosCv();
    d.ninieras.find(n => n.id === ID.nAna).cv_datos = { estudios: 'Psicología', experiencia: 'Dos años', panales: '', idiomas: '', certificaciones: '', diferenciales: '' };
    const e = await abrirCv(page, { datos: d });
    // El tamaño de la letra de los datos (Chrome escribe el peso 700 como "bold").
    const fuente = async () => (await dibujado(page)).textos.find(t => t.font.includes('Arimo')).font.match(/([\d.]+)px/)[1];
    expect(await fuente()).toBe('111.8'); // 3 líneas (edad, estudios, experiencia): +50%
    await campo(page, 'panales').fill('Cambia pañales');
    await campo(page, 'idiomas').fill('Inglés');
    await campo(page, 'certificaciones').fill('RCP');
    await campo(page, 'diferenciales').fill('Cocina');
    await expect.poll(fuente).toBe('74.5'); // 7 líneas
    // Seis líneas largas como las del CV de referencia: ya llenan la tarjeta y no crecen.
    await campo(page, 'estudios').fill('Estudiante de Medicina en la universidad');
    await campo(page, 'experiencia').fill('Experiencia previa cuidando niños de entre 1-10 años');
    await campo(page, 'idiomas').fill('Habla Inglés');
    await campo(page, 'certificaciones').fill('Realizó un curso de RCP y tres de primeros auxilios');
    await campo(page, 'diferenciales').fill('');
    await expect.poll(async () => (await dibujado(page)).textos.map(t => t.t).join(' ')).toContain('primeros auxilios');
    expect(await fuente()).toBe('74.5');
    verificarLimpio(e);
  });

  test('si no entra ni con la letra más chica, avisa cuál ocupa más y no deja generar', async ({ page }) => {
    const e = await abrirCv(page);
    await campo(page, 'diferenciales').fill('Mucho texto inventado para que no entre en la tarjeta '.repeat(6));
    await expect(estadoCv(page)).toHaveText('No entra todo: acortá alguna línea (la que más ocupa es Diferenciales).');
    await botonGenerar(page).click();
    await expect(toasts(page).last()).toContainText('No entra todo');
    expect(subidas(e)).toEqual([]);
    expect(parches(e)).toEqual([]);
    verificarLimpio(e);
  });

  test('nombre largo: se achica desde 97 px hasta entrar en dos renglones; una palabra que no entra ni chica avisa', async ({ page }) => {
    const d = datosCv();
    d.ninieras.find(n => n.id === ID.nAna).nombre = 'Ana Ficticia Inventadísima';
    await espiar(page);
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => abrirCvNinera(id), ID.nAna);
    await expect(estadoCv(page)).toHaveText('Así va a quedar.');
    const nombre = (await dibujado(page)).textos.filter(t => t.font.includes('League Spartan'));
    expect(new Set(nombre.map(t => t.y)).size).toBe(2);
    expect(Number(nombre[0].font.match(/([\d.]+)px/)[1])).toBeLessThan(97);
    await page.evaluate(() => cerrarModal());
    await page.evaluate(id => { nineraPorId(id).nombre = 'Anaanaanaanaanaanaanaana Ficticia'; abrirCvNinera(id); }, ID.nAna);
    await expect(estadoCv(page)).toHaveText('El nombre no entra en dos renglones: acortalo desde Editar.');
    verificarLimpio(e);
  });

  test('sin foto no se dibuja el círculo', async ({ page }) => {
    const d = datosCv();
    d.ninieras.find(n => n.id === ID.nAna).foto = '';
    const e = await abrirCv(page, { datos: d });
    await expect(estadoCv(page)).toHaveText('Así va a quedar.');
    expect((await dibujado(page)).imagenes).toEqual([expect.stringContaining('img/cv/fondo-cv.png')]);
    verificarLimpio(e);
  });

  test('foto que existe pero no carga: aviso y nada se sube', async ({ page }) => {
    const e = await abrirCv(page, { antes: e => { e.fallar = ({ tabla, metodo }) => metodo === 'GET' && tabla.includes('/fotos/ana.jpg') ? { status: 500 } : null; } });
    await expect(estadoCv(page)).toHaveText('No se pudo cargar la foto de Ana Ficticia. Revisá tu conexión o volvé a subirla desde Editar.');
    await botonGenerar(page).click();
    await expect(toasts(page).last()).toContainText('No se pudo cargar la foto');
    expect(subidas(e)).toEqual([]);
    expect(parches(e)).toEqual([]);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('escape: un nombre y unas líneas tramposas se muestran como texto y no ejecutan nada', async ({ page }) => {
    const d = datosCv();
    const trampa = `"><img src=x onerror="window.__xss=1">'); window.__xss=2; ('`;
    Object.assign(d.ninieras.find(n => n.id === ID.nAna), { nombre: 'Ana <b>' + trampa, cv_datos: { estudios: trampa, experiencia: '</textarea><script>window.__xss=3</script>' } });
    await espiar(page);
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => abrirCvNinera(id), ID.nAna);
    await expect(estadoCv(page)).not.toContainText('Dibujando');
    await expect(modal(page).locator('h2')).toHaveText('CV de Ana <b>' + trampa);
    await expect(campo(page, 'estudios')).toHaveValue(trampa);
    await expect(campo(page, 'experiencia')).toHaveValue('</textarea><script>window.__xss=3</script>');
    await campo(page, 'idiomas').fill('Inglés');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    verificarLimpio(e);
  });

  test('cerrar con cambios sin guardar pregunta antes', async ({ page }) => {
    const e = await abrirCv(page);
    await campo(page, 'diferenciales').fill('Algo nuevo');
    await modal(page).locator('.modal-close').click();
    await expect(page.locator('.confirmoverlay:not(#editmodal)')).toContainText('Tenés cambios sin guardar');
    verificarLimpio(e);
  });

  test('390 px: vista previa arriba, campos debajo, sin scroll de costado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const e = await abrirCv(page);
    const lienzo = await page.locator('#cv-lienzo').boundingBox();
    const primero = await campo(page, 'estudios').boundingBox();
    expect(lienzo.y).toBeLessThan(primero.y);
    expect(lienzo.width).toBeLessThanOrEqual(230);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('cv-390.png'), animations: 'disabled' });
    verificarLimpio(e);
  });

  test('1280 px: vista previa al costado de los campos', async ({ page }) => {
    const e = await abrirCv(page);
    const lienzo = await page.locator('#cv-lienzo').boundingBox();
    const primero = await campo(page, 'estudios').boundingBox();
    expect(lienzo.x + lienzo.width).toBeLessThanOrEqual(primero.x);
    await page.screenshot({ path: test.info().outputPath('cv-1280.png'), animations: 'disabled' });
    verificarLimpio(e);
  });
});

test.describe('"Guardar y generar CV"', () => {
  test('sube el PNG de 1080×1920 con nombre al azar, guarda link, fecha, líneas y con qué se dibujó, y queda para compartir', async ({ page }) => {
    const e = await abrirCv(page);
    await campo(page, 'diferenciales').fill('Le encanta leer cuentos');
    await botonGenerar(page).click();
    await expect(toasts(page).last()).toHaveText('CV listo.');
    expect(subidas(e)).toHaveLength(1);
    expect(medidasPng(subidas(e)[0].bytes)).toEqual({ ancho: 1080, alto: 1920 });
    const url = `https://${REF_PROD}.supabase.co/storage/v1/object/public/ninieras-fotos/${subidas(e)[0].tabla.split('/ninieras-fotos/')[1]}`;
    expect(parches(e)).toHaveLength(1);
    const lineas = ['21 años', 'Estudiante de Psicología', 'Dos años con mellizos', 'Cambia pañales', 'Inglés', 'Curso de RCP', 'Le encanta leer cuentos'];
    expect(parches(e)[0].cuerpo).toEqual({
      // Con fecha de nacimiento, la edad no se guarda: se calcula al dibujar.
      cv_datos: { estudios: 'Estudiante de Psicología', experiencia: 'Dos años con mellizos', panales: 'Cambia pañales', idiomas: 'Inglés', certificaciones: 'Curso de RCP', diferenciales: 'Le encanta leer cuentos' },
      cv_url: url, cv_generado_en: '2026-10-04',
      cv_generado_con: { nombre: 'Ana Ficticia', foto: FOTO, lineas },
    });
    expect(parches(e)[0].params).toMatchObject({ id: 'eq.' + ID.nAna });
    // Nunca un dato interno en lo que se guarda ni en lo dibujado.
    const guardado = JSON.stringify(parches(e)[0].cuerpo);
    const dibujo = (await dibujado(page)).textos.map(t => t.t).join(' ');
    for (const p of PROHIBIDOS) { expect(guardado).not.toContain(p); expect(dibujo).not.toContain(p); }
    // La misma pantalla, ahora con el CV listo para compartir.
    await expect(modal(page)).toContainText('CV generado el 04/10/2026.');
    await expect(modal(page).locator('.cv-viejo')).toHaveCount(0);
    const compartir = page.locator('#cv-compartir');
    await expect(compartir).toHaveText('Compartir');
    await compartir.click();
    await expect.poll(() => page.evaluate(() => window.__compartido)).toEqual([[{ name: 'CV Ana Ficticia.png', type: 'image/png', size: expect.any(Number) }]]);
    // La ficha muestra "Ver el CV" y la lista no marca nada.
    await page.evaluate(() => cerrarModal());
    await page.evaluate(id => verNinera(id), ID.nAna);
    await expect(modal(page).locator('.fichadl button', { hasText: 'Ver el CV' })).toBeVisible();
    await expect(modal(page).locator('.cv-viejo')).toHaveCount(0);
    verificarLimpio(e);
  });

  test('sin "Compartir" en el aparato: "Descargar" baja el archivo', async ({ page }) => {
    const d = datosCv();
    Object.assign(d.ninieras.find(n => n.id === ID.nAna), {
      cv_url: FOTOS + 'cv/00000000-0000-4000-8000-0000000000aa.png', cv_generado_en: '2026-10-01',
      cv_datos: { estudios: 'Psicología' }, cv_generado_con: { nombre: 'Ana Ficticia', foto: FOTO, lineas: ['21 años', 'Psicología'] },
    });
    const e = await abrirCv(page, { datos: d, compartir: false });
    await expect(modal(page)).toContainText('CV generado el 01/10/2026.');
    const boton = page.locator('#cv-compartir');
    await expect(boton).toHaveText('Descargar');
    const [descarga] = await Promise.all([page.waitForEvent('download'), boton.click()]);
    expect(descarga.suggestedFilename()).toBe('CV Ana Ficticia.png');
    verificarLimpio(e);
  });

  test('volver a generar borra el CV anterior del bucket', async ({ page }) => {
    const d = datosCv();
    const anterior = 'cv/00000000-0000-4000-8000-0000000000aa.png';
    Object.assign(d.ninieras.find(n => n.id === ID.nAna), {
      cv_url: FOTOS + anterior, cv_generado_en: '2026-10-01',
      cv_datos: { estudios: 'Psicología' }, cv_generado_con: { nombre: 'Ana Ficticia', foto: FOTO, lineas: ['21 años', 'Psicología'] },
    });
    const e = await abrirCv(page, { datos: d });
    await expect(campo(page, 'estudios')).toHaveValue('Psicología'); // lo guardado, no la precarga
    await campo(page, 'experiencia').fill('Dos años');
    await botonGenerar(page).click();
    await expect(toasts(page).last()).toHaveText('CV listo.');
    expect(borradosFotos(e).map(w => JSON.parse(w.cuerpo))).toEqual([{ prefixes: [anterior] }]);
    expect(ana(e).cv_url).not.toContain(anterior);
    verificarLimpio(e);
  });

  test('doble toque: una sola subida y un solo guardado', async ({ page }) => {
    const e = await abrirCv(page);
    e.demoraEscrituras = 400;
    await botonGenerar(page).dblclick();
    await expect(toasts(page).last()).toHaveText('CV listo.');
    expect(subidas(e)).toHaveLength(1);
    expect(parches(e)).toHaveLength(1);
    verificarLimpio(e);
  });

  test('falla la subida: aviso, no se guarda nada y lo escrito queda', async ({ page }) => {
    const e = await abrirCv(page);
    await campo(page, 'diferenciales').fill('Le encanta leer cuentos');
    e.fallar = ({ tabla, metodo }) => metodo === 'POST' && tabla.includes('/ninieras-fotos/cv/') ? 'red' : null;
    await botonGenerar(page).click();
    await expect(toasts(page).last()).toContainText('No se pudo subir el CV');
    await expect(toasts(page).last()).toContainText('No se guardó nada.');
    expect(parches(e)).toEqual([]);
    await expect(campo(page, 'diferenciales')).toHaveValue('Le encanta leer cuentos');
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('falla guardar en la base: se borra la imagen subida, aviso y no queda como generado', async ({ page }) => {
    const e = await abrirCv(page);
    e.fallar = ({ tabla, metodo }) => tabla === 'ninieras' && metodo === 'PATCH' ? { status: 500, message: 'se cayó' } : null;
    await botonGenerar(page).click();
    await expect(toasts(page).last()).toContainText('No se pudo guardar el CV: se cayó. No se guardó nada.');
    expect(subidas(e)).toHaveLength(1);
    const subida = subidas(e)[0].tabla.split('/ninieras-fotos/')[1];
    expect(borradosFotos(e).map(w => JSON.parse(w.cuerpo))).toEqual([{ prefixes: [subida] }]);
    expect(ana(e).cv_url).toBeNull();
    await expect(page.locator('#cv-compartir')).toHaveCount(0);
    verificarLimpio(e, { ignorar: RUIDO });
  });

  test('base sin la migración del CV: la pantalla anda con la precarga y al generar avisa que falta actualizar la base', async ({ page }) => {
    const e = await abrirCv(page, { baseSinMigrar: 'cv' });
    await expect(campo(page, 'estudios')).toHaveValue('Estudiante de Psicología');
    await botonGenerar(page).click();
    await expect(toasts(page).last()).toHaveText('Falta actualizar la base para el CV nuevo: avisale a Diego. No se guardó nada.');
    expect(borradosFotos(e)).toHaveLength(1);
    expect(ana(e).cv_url).toBeNull();
    verificarLimpio(e, { ignorar: RUIDO });
  });
});

test.describe('CV viejo', () => {
  const generado = (extra = {}) => ({
    cv_url: FOTOS + 'cv/00000000-0000-4000-8000-0000000000aa.png', cv_generado_en: '2026-10-01',
    cv_datos: { estudios: 'Psicología' }, cv_generado_con: { nombre: 'Ana Ficticia', foto: FOTO, lineas: ['21 años', 'Psicología'] }, ...extra,
  });
  for (const [caso, cambio, motivo] of [
    ['cambió la foto', { foto: FOTOS + 'fotos/otra.jpg' }, 'cambió la foto'],
    ['cambió el nombre', { nombre: 'Ana María Ficticia' }, 'cambió el nombre'],
    ['cumplió años', { cv_generado_con: { nombre: 'Ana Ficticia', foto: FOTO, lineas: ['20 años', 'Psicología'] } }, 'cumplió años'],
  ]) {
    test(`${caso}: aviso en la ficha y en la pantalla del CV, sin "Compartir" hasta generarlo de nuevo`, async ({ page }) => {
      const d = datosCv();
      Object.assign(d.ninieras.find(n => n.id === ID.nAna), generado(), cambio);
      await espiar(page);
      const e = await abrirApp(page, { datos: d });
      await irAModulo(page, 'ninieras');
      await page.evaluate(id => verNinera(id), ID.nAna);
      await expect(modal(page).locator('.cv-viejo')).toHaveText(`El CV quedó viejo (${motivo}): generalo de nuevo.`);
      await modal(page).locator('.fichadl button', { hasText: 'Ver el CV' }).click();
      await expect(modal(page).locator('.cv-viejo')).toHaveText(`El CV quedó viejo (${motivo}): generalo de nuevo.`);
      await expect(page.locator('#cv-compartir')).toHaveCount(0);
      await botonGenerar(page).click();
      await expect(toasts(page).last()).toHaveText('CV listo.');
      await expect(modal(page).locator('.cv-viejo')).toHaveCount(0);
      await expect(page.locator('#cv-compartir')).toHaveText('Compartir');
      verificarLimpio(e);
    });
  }

  test('al día: sin aviso y con "Compartir"', async ({ page }) => {
    const d = datosCv();
    Object.assign(d.ninieras.find(n => n.id === ID.nAna), generado());
    const e = await abrirCv(page, { datos: d });
    await expect(modal(page).locator('.cv-viejo')).toHaveCount(0);
    await expect(page.locator('#cv-compartir')).toHaveText('Compartir');
    verificarLimpio(e);
  });

  test('CV de Canva (solo la fecha): avisa si cumplió años después, como antes', async ({ page }) => {
    const d = datosCv();
    d.ninieras.find(n => n.id === ID.nAna).cv_generado_en = '2025-01-01';
    const e = await abrirApp(page, { datos: d });
    await irAModulo(page, 'ninieras');
    await page.evaluate(id => verNinera(id), ID.nAna);
    await expect(modal(page).locator('.cv-viejo')).toHaveText('El CV quedó viejo (cumplió años): generalo de nuevo.');
    verificarLimpio(e);
  });
});

test.describe('"Perfiles para la madre" con el CV de la app', () => {
  // datosEleccion: sPendiente de Familia (práctica); "Niñera (práctica)" y Lola dijeron "Puedo", ninguna fue a esa casa.
  test('la nueva con CV de la app se comparte de un toque; la de Canva se adjunta a mano; sin CV, el aviso', async ({ page }) => {
    const d = datosEleccion();
    Object.assign(d.ninieras.find(n => n.id === ID.nLola), { cv_url: FOTOS + 'cv/00000000-0000-4000-8000-0000000000bb.png', cv_generado_en: '2026-10-01' });
    d.ninieras.find(n => n.id === ID.nPractica).cv_generado_en = '2026-09-02'; // CV de Canva
    Object.assign(d.solicitud_ninieras.find(x => x.id === ID.snPendMia), { estado: 'acepto', respondido_en: '2026-10-04T14:10:00.000Z' });
    await espiar(page);
    const e = await abrirApp(page, { datos: d });
    await page.locator(`#dash-pedidos .pedido-curso[data-solicitud="${ID.sPendiente}"]`).locator('button', { hasText: 'Perfiles para la madre' }).click();
    await expect(modal(page).locator('.perfiles-madre')).toBeVisible();
    for (const n of ['Niñera (práctica)', 'Lola (práctica)', 'Mía (práctica)']) await modal(page).locator('.perfiles-fila', { hasText: n }).locator('input').check();
    const boton = page.locator('#perfiles-compartir-cv');
    await expect(boton).toHaveText('Compartir el CV de Lola (práctica)');
    await expect(page.locator('#perfiles-cv > .helper')).toHaveText('Adjuntá en WhatsApp el CV de Niñera (práctica).');
    await expect(page.locator('#perfiles-cv .warnbox')).toHaveText('Mía (práctica) todavía no tiene CV: generalo desde su ficha.');
    await expect.poll(async () => { await boton.click(); return page.evaluate(() => window.__compartido.length); }).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__compartido[0])).toEqual([{ name: 'CV Lola (práctica).png', type: 'image/png', size: expect.any(Number) }]);
    // Compartir no escribe nada.
    expect(e.escrituras.filter(w => !w.tabla.startsWith('/auth/'))).toEqual([]);
    verificarLimpio(e);
  });
});
