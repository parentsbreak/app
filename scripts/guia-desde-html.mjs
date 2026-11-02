// Arma ninera/guia/contenido.json desde docs/fase1/guia-original.html (la guía de Paulina, idéntica a la
// publicada; fase 1, etapa 4, decisiones.md 8). Se corre una vez y queda para rearmarla si cambia la
// fuente:
//   node scripts/guia-desde-html.mjs
// Sin dependencias: el HTML de la guía es nuestro y regular, alcanza con expresiones regulares.
// - Módulos: los <section class="module ..."> menos "inicio", "ficha" (pasa a ser el formulario de la
//   etapa 8) y "recibidas" (de las admins).
// - Lecciones: <details class="lesson" data-id>: título (summary > b), subtítulo (summary > small) y el
//   HTML de .lbody sin el botón "Ya lo leí" (lo pone la app) ni los juegos (.kit, con el "Para jugar
//   acá" que los anunciaba).
// - La lección "Higiene y cambio de pañales" (b2) pasa de Protocolos a Bebés, en segundo lugar.
// - Repaso de cada módulo: el QUIZ de la guía (data-quiz; el de RCP se llama "emergencias").
// - Los links externos se abren aparte (target="_blank" rel="noopener").
// Si la versión del contenido cambia, también cambia app_config 'guia'.version_vigente (migración).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUENTE = path.join(RAIZ, 'docs/fase1/guia-original.html');
const DESTINO = path.join(RAIZ, 'ninera/guia/contenido.json');
const VERSION = '2026.10';
const FUERA = ['inicio', 'ficha', 'recibidas'];
const OBLIGATORIOS = ['protocolos', 'auxilios'];

const html = fs.readFileSync(FUENTE, 'utf8');
const sinEspacios = t => t.replace(/\s+/g, ' ').trim();
const atributo = (tag, nombre) => (new RegExp(`${nombre}="([^"]*)"`).exec(tag) || [])[1] ?? '';

// El QUIZ es un literal de JS dentro del <script> de la guía (contenido del repo, no de datos).
const iQuiz = html.indexOf('const QUIZ=');
const fQuiz = html.indexOf('\n};', iQuiz);
if (iQuiz < 0 || fQuiz < 0) throw new Error('No encontré el QUIZ en la guía');
const QUIZ = new Function(`return ${html.slice(iQuiz + 'const QUIZ='.length, fQuiz + 2)}`)();

function limpiarLeccion(cuerpo) {
  return cuerpo
    .replace(/\s*<button class="mark"[^>]*>[\s\S]*?<\/button>/g, '')
    // Los juegos no van; su anuncio ("Para jugar acá" y el párrafo que dice qué tocar), tampoco.
    .replace(/\s*<h3>Para jugar acá<\/h3>(\s*<p>[\s\S]*?<\/p>)?(?=\s*<div class="kit")/g, '')
    .replace(/\s*<div class="kit"[^>]*><\/div>/g, '')
    .replace(/<a href="(https:\/\/[^"]+)"(?![^>]*target=)/g, '<a href="$1" target="_blank" rel="noopener"')
    .trim();
}

const modulos = [];
for (const bloque of html.split(/(?=<section class="module)/).slice(1)) {
  const tag = /^<section[^>]*>/.exec(bloque)[0];
  const id = atributo(tag, 'id');
  if (FUERA.includes(id)) continue;
  const cuerpo = bloque.slice(0, bloque.indexOf('</section>'));
  const intro = (/<div class="mhead">[\s\S]*?<p>([\s\S]*?)<\/p>/.exec(cuerpo) || [])[1] || '';
  const lecciones = [...cuerpo.matchAll(/<details class="lesson" data-id="([^"]+)">\s*<summary>([\s\S]*?)<\/summary>\s*<div class="lbody">([\s\S]*?)<\/div><\/details>/g)]
    .map(([, lid, summary, lbody]) => ({
      id: lid,
      titulo: sinEspacios((/<b>([\s\S]*?)<\/b>/.exec(summary) || [])[1] || ''),
      subtitulo: sinEspacios((/<small>([\s\S]*?)<\/small>/.exec(summary) || [])[1] || ''),
      html: limpiarLeccion(lbody),
    }));
  const claveQuiz = (/data-quiz="([^"]+)"/.exec(cuerpo) || [])[1];
  modulos.push({
    id,
    nombre: atributo(tag, 'data-name'),
    grupo: atributo(tag, 'data-group'),
    edad: atributo(tag, 'data-age'),
    obligatorio: OBLIGATORIOS.includes(id),
    intro: sinEspacios(intro),
    lecciones,
    repaso: (claveQuiz && QUIZ[claveQuiz] || []).map(({ q, o, a, e }) => ({ q, o, a, e })),
  });
}

// b2 a Bebés, en segundo lugar.
const protocolos = modulos.find(m => m.id === 'protocolos');
const bebes = modulos.find(m => m.id === 'bebes');
const iB2 = protocolos.lecciones.findIndex(l => l.id === 'b2');
if (iB2 < 0) throw new Error('No encontré la lección b2 en Protocolos');
const [b2] = protocolos.lecciones.splice(iB2, 1);
bebes.lecciones.splice(1, 0, b2);

fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
fs.writeFileSync(DESTINO, JSON.stringify({ version: VERSION, modulos }, null, 2) + '\n');
const total = modulos.reduce((s, m) => s + m.lecciones.length, 0);
console.log(`${DESTINO}: ${modulos.length} módulos, ${total} lecciones`);
