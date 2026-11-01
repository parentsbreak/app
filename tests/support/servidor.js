// Servidor estático mínimo para los tests: sirve la raíz del repo tal cual la publica
// GitHub Pages. Sin dependencias (solo Node), así los tests no suman paquetes a la app.
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const PUERTO = Number(process.env.PUERTO_TESTS || 4173);
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let archivo = path.normalize(path.join(RAIZ, ruta));
  if (!archivo.startsWith(RAIZ)) { res.writeHead(403); res.end(); return; }
  if (ruta.endsWith('/')) archivo = path.join(archivo, 'index.html');
  fs.readFile(archivo, (err, contenido) => {
    if (err) { res.writeHead(404); res.end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(contenido);
  });
}).listen(PUERTO, () => console.log(`Servidor de tests en http://localhost:${PUERTO}`));
