// App de niñeras (fase 1, etapa 12, 03/11/2026, pedido de Paulina y Delfina; docs/fase1/etapa12-guia-sitting.md): los
// juegos del kit de la guía de Paulina (docs/fase1/guia-original.html, el <script> del final), iguales al original:
// mismos textos, mismas fichas y las mismas reglas. Van debajo de las lecciones de actividades de cada edad
// (contenido.json, `juegos` de la lección) y, uno por uno, desde "Para este sitting" (para-sitting.js).
// No guardan nada, ni en la base ni en el celular (en el original tampoco): lo marcado y lo escrito en "Hoy con mi
// niñera" se borra al salir de la pantalla. Sin el modo oscuro del original: la app es siempre clara.
// El texto es el de la guía (voseo, como el publicado). Todo se arma con el DOM: no hay datos de nadie.

// Las letras de la sopa, sus 8 animales y las paredes del laberinto ([arriba, derecha, abajo, izquierda] por celda),
// copiados tal cual del original (KIT).
const KIT_JUEGOS = {
  sopa: ["UGPPMJHFHV", "CUAAJSRLPA", "JVCTDSPOFC", "LEROOOEBCA", "TULLMVRRUP", "CCIRCBRMJU", "PLLJNMOOAP", "MOEFVDRNBG", "JROSOEHONN", "RONCFPNTIE"],
  words: ["PERRO", "GATO", "LORO", "VACA", "PATO", "OSO", "LEON", "MONO"],
  maze: [[[0,0,1,1],[1,0,0,1],[1,1,0,0],[1,1,0,0],[1,0,0,0],[1,0,1,0],[1,0,0,1],[1,0,1,0],[1,0,0,1],[1,0,1,0]],[[0,0,1,1],[0,1,0,1],[1,1,1,0],[1,0,0,1],[0,1,1,0],[0,1,0,1],[0,1,1,0],[0,1,0,1],[0,1,1,0],[0,0,1,1]],[[0,1,0,1],[1,1,0,0],[1,0,1,0],[0,0,1,1],[1,0,1,1],[1,0,0,1],[1,1,0,0],[1,1,0,0],[1,1,0,0],[0,1,1,0]],[[1,0,1,1],[1,0,0,1],[0,1,1,0],[0,0,1,1],[0,0,1,1],[0,1,0,1],[1,0,1,0],[1,1,0,1],[1,1,0,0],[1,0,1,0]],[[0,0,0,1],[0,1,1,0],[1,1,0,1],[0,0,1,0],[0,0,0,1],[1,1,1,0],[0,1,0,1],[1,1,0,0],[1,1,0,0],[0,0,1,0]],[[0,1,0,1],[1,0,1,0],[1,0,0,1],[0,1,1,0],[0,1,0,1],[1,1,0,0],[1,0,1,0],[1,0,0,1],[1,1,0,0],[0,1,1,0]],[[1,0,1,1],[0,0,1,1],[0,0,0,1],[1,0,1,0],[1,0,0,1],[1,1,0,0],[0,1,1,0],[0,0,1,1],[1,1,0,1],[1,0,1,0]],[[0,0,0,1],[0,1,1,0],[0,1,1,1],[0,0,1,1],[0,0,0,1],[1,1,0,0],[1,0,1,0],[0,1,0,1],[1,1,0,0],[0,0,1,0]],[[0,1,0,1],[1,1,0,0],[1,1,0,0],[0,1,1,0],[0,1,1,1],[1,0,0,1],[0,0,1,0],[1,0,0,1],[1,0,1,0],[0,0,1,1]],[[1,0,0,1],[1,0,1,0],[1,0,0,1],[1,0,0,0],[1,1,0,0],[0,1,1,0],[0,0,1,1],[0,0,1,1],[0,1,0,1],[0,1,1,0]],[[0,0,1,1],[0,0,1,1],[0,0,1,1],[0,0,1,1],[1,1,0,1],[1,1,0,0],[0,1,1,0],[0,1,0,1],[1,1,0,0],[1,0,1,0]],[[0,1,1,1],[0,1,0,1],[0,1,1,0],[0,1,0,1],[1,1,0,0],[1,1,0,0],[1,1,0,0],[1,1,0,0],[1,1,0,0],[0,0,1,0]]],
};

function elJuego(tag, clase, texto){
  const n = document.createElement(tag);
  if(clase) n.className = clase;
  if(texto != null) n.textContent = texto;
  return n;
}
// Un botón que se marca y desmarca con cada toque (la ficha del tesoro, una letra, un animal).
function botonJuego(texto, alternable = true){
  const b = elJuego('button', null, texto);
  b.type = 'button';
  if(alternable) b.addEventListener('click', () => b.classList.toggle('on'));
  return b;
}

// Las caras de "Emociones" y "Hoy me sentí" (SVG del original).
const CARAS_JUEGO = {
  Contento: '<path d="M22 40q10 10 20 0"/>',
  Triste: '<path d="M22 46q10-9 20 0"/>',
  Enojado: '<path d="M22 46q10-9 20 0"/><path d="M17 20l9 4M47 20l-9 4"/>',
  Asustado: '<path d="M22 44l5-3 5 3 5-3 5 3"/><path d="M17 22l8-4M47 22l-8-4"/>',
  Sorprendido: '<circle cx="32" cy="43" r="5"/>',
  Cansado: '<path d="M25 44h14"/>',
};
function ojosJuego(k){
  if(k === 'Cansado') return '<path d="M18 28h9M37 28h9"/>';
  if(k === 'Asustado' || k === 'Sorprendido') return '<circle cx="23" cy="28" r="3.5" fill="currentColor"/><circle cx="41" cy="28" r="3.5" fill="currentColor"/>';
  return '<circle cx="23" cy="28" r="2.5" fill="currentColor"/><circle cx="41" cy="28" r="2.5" fill="currentColor"/>';
}
function caraJuego(k){
  return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="32" cy="32" r="28" style="stroke:var(--accent)"/>${ojosJuego(k)}${CARAS_JUEGO[k]}</svg>`;
}
// Elegir una cara (una sola marcada). salida: el <p> donde va "Hoy me siento ..." (o nada).
function selectorEmocionesJuego(clase, salida){
  const caja = elJuego('div', clase);
  Object.keys(CARAS_JUEGO).forEach(k => {
    const b = elJuego('button');
    b.type = 'button';
    b.innerHTML = caraJuego(k) + k;
    b.addEventListener('click', () => {
      caja.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if(salida) salida.textContent = 'Hoy me siento ' + k.toLowerCase();
    });
    caja.appendChild(b);
  });
  return caja;
}
function avisoJuego(texto){
  const p = elJuego('p', 'sh-win', texto);
  p.setAttribute('aria-live', 'polite');
  return p;
}

// Lo que tiene que encontrar cada uno, en orden (los del original).
const TESORO_JUEGO = ['Algo rojo', 'Algo más chico que tu mano', 'Algo suave', 'Algo que haga ruido', 'Una cuchara', 'Algo redondo',
  'Un libro con un animal', 'Algo amarillo', 'Una media', 'Algo que empiece con M', 'Algo frío', 'Tu juguete favorito'];
const BINGO_JUEGO = ['Un perro', 'Una hoja seca', 'Una paloma', 'Un tobogán', 'Una flor', 'Una bici', 'Un árbol grande', 'Una nube con forma',
  'Una piedra lisa', 'Un banco', 'Una hormiga', 'Algo azul', 'Una pelota', 'Un gato', 'Una hamaca', 'Un pájaro que canta'];
const DIARIO_JUEGO = ['Me llamo', 'Mi niñera se llama', 'Hoy jugamos a', 'Comí', 'Lo que más me gustó'];

function armarTesoroJuego(){
  const g = elJuego('div', 'chk');
  TESORO_JUEGO.forEach(t => g.appendChild(botonJuego(t)));
  return [g];
}
function armarBingoJuego(){
  const g = elJuego('div', 'bingo'), w = avisoJuego('');
  const bb = BINGO_JUEGO.map(t => g.appendChild(botonJuego(t, false)));
  // Las 4 filas, las 4 columnas y las 2 diagonales.
  const lineas = [];
  for(let i = 0; i < 4; i++){ lineas.push([0, 1, 2, 3].map(j => i * 4 + j)); lineas.push([0, 1, 2, 3].map(j => j * 4 + i)); }
  lineas.push([0, 5, 10, 15], [3, 6, 9, 12]);
  bb.forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('on');
    w.textContent = lineas.some(l => l.every(k => bb[k].classList.contains('on'))) ? '¡Bingo!' : '';
  }));
  return [g, w];
}
function armarSopaJuego(){
  const g = elJuego('div', 'sopa');
  KIT_JUEGOS.sopa.forEach(fila => [...fila].forEach(letra => g.appendChild(botonJuego(letra))));
  const w = elJuego('div', 'words');
  KIT_JUEGOS.words.forEach(p => w.appendChild(botonJuego(p)));
  return [g, w];
}
// El laberinto se recorre con el dedo (pointer events, sin scroll encima: touch-action none en el CSS).
function armarLaberintoJuego(){
  const cv = elJuego('canvas', 'maze');
  cv.width = 400; cv.height = 480;
  cv.setAttribute('aria-label', 'Laberinto para recorrer con el dedo');
  const cx = cv.getContext('2d');
  const R = KIT_JUEGOS.maze.length, C = KIT_JUEGOS.maze[0].length, cs = 36, ox = 20, oy = 30;
  let trazos = [], dibujando = false;
  const color = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const dibujar = () => {
    if(!cx) return;
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.lineCap = 'round'; cx.strokeStyle = color('--ink'); cx.lineWidth = 3;
    for(let r = 0; r < R; r++) for(let c = 0; c < C; c++){
      const w = KIT_JUEGOS.maze[r][c], x = ox + c * cs, y = oy + r * cs;
      cx.beginPath();
      if(w[0]){ cx.moveTo(x, y); cx.lineTo(x + cs, y); }
      if(w[3]){ cx.moveTo(x, y); cx.lineTo(x, y + cs); }
      if(r === R - 1 && w[1]){ cx.moveTo(x, y + cs); cx.lineTo(x + cs, y + cs); }
      if(c === C - 1 && w[2]){ cx.moveTo(x + cs, y); cx.lineTo(x + cs, y + cs); }
      cx.stroke();
    }
    cx.fillStyle = color('--clay'); cx.font = "600 14px Inter, sans-serif";
    cx.textAlign = 'left'; cx.fillText('Perro', ox, oy - 10);
    cx.textAlign = 'right'; cx.fillText('Hueso', ox + C * cs, oy + R * cs + 20);
    cx.strokeStyle = color('--clay'); cx.lineWidth = 5;
    trazos.forEach(t => { cx.beginPath(); t.forEach((p, i) => i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1])); cx.stroke(); });
  };
  const punto = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.addEventListener('pointerdown', e => { dibujando = true; trazos.push([punto(e)]); try{ cv.setPointerCapture(e.pointerId); }catch(_){} });
  cv.addEventListener('pointermove', e => { if(!dibujando) return; trazos[trazos.length - 1].push(punto(e)); dibujar(); });
  ['pointerup', 'pointercancel'].forEach(t => cv.addEventListener(t, () => { dibujando = false; }));
  const borrar = elJuego('button', 'mini', 'Borrar y volver a empezar');
  borrar.type = 'button';
  borrar.addEventListener('click', () => { trazos = []; dibujar(); });
  cv._dibujar = dibujar;
  dibujar();
  return [cv, borrar];
}
function armarEmocionesJuego(){
  const w = avisoJuego('');
  return [selectorEmocionesJuego('emos', w), w];
}
function armarTatetiJuego(){
  const g = elJuego('div', 'ttt'), w = avisoJuego('Turno de X');
  let turno = 'X', termino = false;
  const casillas = [...Array(9)].map(() => {
    const b = elJuego('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'casilla vacía');
    g.appendChild(b);
    return b;
  });
  const TRES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  casillas.forEach(b => b.addEventListener('click', () => {
    if(termino || b.textContent) return;
    b.textContent = turno;
    b.classList.toggle('o', turno === 'O');
    b.setAttribute('aria-label', turno);
    if(TRES.some(l => l.every(k => casillas[k].textContent === turno))){ w.textContent = '¡Ganó ' + turno + '!'; termino = true; return; }
    if(casillas.every(c => c.textContent)){ w.textContent = 'Empate'; termino = true; return; }
    turno = turno === 'X' ? 'O' : 'X';
    w.textContent = 'Turno de ' + turno;
  }));
  const otra = elJuego('button', 'mini', 'Jugar de nuevo');
  otra.type = 'button';
  otra.addEventListener('click', () => {
    casillas.forEach(c => { c.textContent = ''; c.classList.remove('o'); c.setAttribute('aria-label', 'casilla vacía'); });
    turno = 'X'; termino = false; w.textContent = 'Turno de X';
  });
  return [g, w, otra];
}
// "Hoy con mi niñera": lo escrito queda solo en pantalla (sin name ni autocompletar: nada se guarda).
function armarDiarioJuego(){
  const d = elJuego('div', 'diary');
  DIARIO_JUEGO.forEach(t => {
    const lb = elJuego('label', null, t);
    const inp = elJuego('input');
    inp.type = 'text';
    inp.autocomplete = 'off';
    lb.appendChild(inp);
    d.appendChild(lb);
  });
  d.appendChild(elJuego('span', 'dlabel', 'Hoy me sentí'));
  d.appendChild(selectorEmocionesJuego('dfeel', null));
  return [d];
}

// Los 7 juegos: título, edad (el texto y el rango, para "Para este sitting"), la consigna y cómo se arma.
const JUEGOS_GUIA = {
  tesoro: { titulo: 'Búsqueda del tesoro', edad: '3 a 8 años', desde: 3, hasta: 8, texto: 'Encontrá cada cosa en la casa y tocala cuando la tengas.', armar: armarTesoroJuego },
  bingo: { titulo: 'Bingo de la plaza', edad: '4 a 10 años', desde: 4, hasta: 10, texto: 'Cuando veas algo, tocalo. Cuatro en línea es bingo.', armar: armarBingoJuego },
  sopa: { titulo: 'Sopa de letras', edad: '6 a 10 años', desde: 6, hasta: 10, texto: 'Encontrá los 8 animales. Tocá las letras para marcarlas y tachá cada animal que encuentres.', armar: armarSopaJuego },
  laberinto: { titulo: 'Laberinto', edad: '4 a 8 años', desde: 4, hasta: 8, texto: 'Con el dedo, llevá al perro de la entrada (arriba a la izquierda) hasta su hueso (abajo a la derecha).', armar: armarLaberintoJuego },
  emociones: { titulo: 'Emociones', edad: '2 a 6 años', desde: 2, hasta: 6, texto: '¿Cómo te sentís hoy? Tocá la cara que se parece a lo que sentís.', armar: armarEmocionesJuego },
  tateti: { titulo: 'Ta-te-ti', edad: '5 a 12 años', desde: 5, hasta: 12, texto: 'De a dos, por turnos. Empieza la X.', armar: armarTatetiJuego },
  diario: { titulo: 'Hoy con mi niñera', edad: '3 a 10 años', desde: 3, hasta: 10, texto: 'Completalo con el chico al final del sitting y mostráselo a la familia o mandales una captura.', armar: armarDiarioJuego },
};
// El orden en que se listan en "Para este sitting": de la edad desde la que sirven, de menor a mayor.
const ORDEN_JUEGOS_GUIA = ['emociones', 'tesoro', 'diario', 'bingo', 'laberinto', 'tateti', 'sopa'];

// Una hoja: el título con la edad, la consigna y el juego.
function hojaJuego(nombre){
  const j = JUEGOS_GUIA[nombre];
  const hoja = elJuego('div', 'sheet');
  hoja.dataset.juego = nombre;
  const cabeza = elJuego('div', 'sh-head');
  cabeza.append(elJuego('h3', null, j.titulo), elJuego('small', null, j.edad));
  hoja.append(cabeza, elJuego('p', 'sh-sub', j.texto), ...j.armar());
  return hoja;
}

// El kit de una lección, como el original: una pestaña por juego y se ve uno por vez. Los nombres que no existen no
// van (el JSON es del repo, pero así una versión vieja de la app no se rompe con un juego nuevo).
function montarKitJuegos(contenedor, nombres){
  const validos = (nombres || []).filter(n => JUEGOS_GUIA[n]);
  if(!contenedor || !validos.length) return;
  contenedor.classList.add('kit');
  const nav = elJuego('div', 'kitnav');
  nav.setAttribute('role', 'tablist');
  contenedor.appendChild(nav);
  const hojas = validos.map((n, i) => {
    const hoja = hojaJuego(n);
    hoja.hidden = i !== 0;
    contenedor.appendChild(hoja);
    const b = elJuego('button', null, JUEGOS_GUIA[n].titulo);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    nav.appendChild(b);
    return [hoja, b];
  });
  hojas.forEach(([hoja, b]) => b.addEventListener('click', () => {
    hojas.forEach(([h2, b2]) => { h2.hidden = h2 !== hoja; b2.setAttribute('aria-selected', h2 === hoja ? 'true' : 'false'); });
    hoja.querySelectorAll('canvas.maze').forEach(c => c._dibujar());
  }));
}

// Un juego solo, desde "Para este sitting" (#sitting/<id>/guia): vuelve ahí.
function pantallaJuegoGuia(nombre, sittingId){
  const j = JUEGOS_GUIA[nombre];
  if(!j) return pantallaParaSitting(sittingId);
  pintar(`<main class="pantalla pantalla-guia">
    ${cabeceraGuia(j.titulo)}
    <div class="kit" id="juego-kit"></div>
    <button type="button" class="link-boton" onclick="pantallaParaSitting(${argJs(sittingId)})">Volver a Para este sitting</button>
  </main>`);
  document.getElementById('juego-kit').appendChild(hojaJuego(nombre));
  window.scrollTo(0, 0);
}
