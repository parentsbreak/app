// Congela el oráculo de plata (red de tests del rediseño, docs/rediseno-panel.md 4.10).
//
// Copia tal cual, desde js/, las funciones que calculan plata y las deja en
// tests/support/oraculo-plata.js, dentro de una función que las encierra (así no chocan con las
// de la app). tests/red-plata.spec.js compara la app con esa copia en miles de casos: si alguien
// cambia un cálculo sin querer, el test lo muestra.
//
// Se corre solo cuando una regla cambia A PROPÓSITO (por ejemplo, el redondeo de montos), en el
// mismo PR que la cambia, y la descripción del PR lo dice:
//   node scripts/congelar-oraculo-plata.js
// La copia corta cada función en la primera línea que es solo "}" (el estilo de todo js/). Si
// una función no termina así, el script avisa y no escribe nada.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const DESTINO = path.join(RAIZ, 'tests', 'support', 'oraculo-plata.js');
// En el orden en que se copian. Lo que no es plata (supabase, normaliza, todayISO, sumarDiasISO,
// minutosAhoraMontevideo, diaSemanaDeISO, esperarConfigFijos, sinPrevistos, leerTodasLasFilas)
// se sigue usando el de la app.
const FUNCIONES = {
  'js/agenda.js': ['agendaMinutos'],
  'js/core.js': ['gastoACargoFamilia', 'redondearMonto', 'redondearPago', 'redondearCobro', 'asignacionVigenteEn',
    'asignacionTerminada', 'redondearFinCobro', 'familiaRedondeaFin', 'cruceMedianocheMalMarcado', 'horasSitting', 'efectoVariantes', 'aplicarVariantes',
    'precioHoraNinera'],
  'js/sittings.js': ['precioSegunHorario'],
  'js/finanzas.js': ['construirEsTrabajoFijo', 'filtrarFijosSemanaIncompleta', 'resumenFinancieroMes',
    'resumenIntermediaciones', 'intermediacionesPendientes', 'lunesDeSemana', 'inicioSemanaPago', 'finSemanaPago', 'finEnMinutos', 'construirFinUltimoFijo',
    'cierreSemanaFijo', 'semanaFijoCerrada', 'construirEsEnCurso', 'finDeSemanaDesde', 'bucketKeyFecha', 'bucketPagoFecha',
    'cargarAjustesSaldo', 'pendienteAjuste', 'aplicarAjustesAGrupos', 'calcularPendientesAgrupados', 'armarTarjetasPendientes', 'esFaltaTabla',
    'cargarGastosExtraPendientes', 'montoGrupo', 'cuentasDeFicha', 'montoParaCopiar', 'totalParcial', 'combinacionExacta'],
};

// Constantes que son regla de plata (se copian como "const NOMBRE = valor;").
const CONSTANTES = {
  'js/core.js': ['TOLERANCIA_FIN_COBRO_MIN'],
};

function extraerConstante(lineas, nombre, archivo) {
  const linea = lineas.find(l => new RegExp(`^const ${nombre} = [^;]+;`).test(l));
  if (!linea) throw new Error(`No encontré la constante ${nombre} en ${archivo}`);
  return linea.replace(/;.*$/, ';');
}

function extraer(lineas, nombre, archivo) {
  const i = lineas.findIndex(l => new RegExp(`^(async )?function ${nombre}\\(`).test(l));
  if (i < 0) throw new Error(`No encontré la función ${nombre} en ${archivo}`);
  const balance = l => (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
  if (balance(lineas[i]) === 0) return lineas[i]; // de una sola línea
  const fin = lineas.findIndex((l, j) => j > i && l === '}');
  if (fin < 0) throw new Error(`${nombre} (${archivo}) no termina en una línea "}"`);
  return lineas.slice(i, fin + 1).join('\n');
}

const partes = [];
const nombres = [];
for (const [archivo, lista] of Object.entries(CONSTANTES)) {
  const lineas = fs.readFileSync(path.join(RAIZ, archivo), 'utf8').split('\n');
  partes.push(`  // ---- constantes de ${archivo}`);
  for (const nombre of lista) partes.push('  ' + extraerConstante(lineas, nombre, archivo));
}
for (const [archivo, lista] of Object.entries(FUNCIONES)) {
  const lineas = fs.readFileSync(path.join(RAIZ, archivo), 'utf8').split('\n');
  partes.push(`  // ---- ${archivo}`);
  for (const nombre of lista) {
    partes.push(extraer(lineas, nombre, archivo).split('\n').map(l => '  ' + l).join('\n'));
    nombres.push(nombre);
  }
}
const commit = execSync('git rev-parse --short HEAD', { cwd: RAIZ }).toString().trim();
const fecha = new Intl.DateTimeFormat('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Montevideo' }).format(new Date());
const salida = `// Oráculo de plata: copia EXACTA de las funciones que calculan plata en js/, tal como estaban el
// ${fecha} (commit ${commit}). La generó scripts/congelar-oraculo-plata.js: no se edita a mano.
// tests/red-plata.spec.js compara la app con esta copia en miles de casos (docs/rediseno-panel.md,
// 4.10). Si una regla cambia a propósito, se vuelve a generar en el mismo PR y el PR lo dice.
// Lo que no es plata (supabase, normaliza, todayISO, sumarDiasISO...) es el de la app.
function crearOraculoPlata(){
  // Propias del oráculo: si la copia de una lectura marca una tabla como faltante, no toca la app.
  let gastosExtraDisponible = true;
  let ajustesSaldoDisponible = true;
${partes.join('\n')}
  return { ${nombres.join(', ')} };
}
const ORACULO_PLATA_CONGELADO = { fecha: ${JSON.stringify(fecha)}, commit: ${JSON.stringify(commit)} };
if (typeof module !== 'undefined') module.exports = { crearOraculoPlata, ORACULO_PLATA_CONGELADO };
`;
fs.writeFileSync(DESTINO, salida);
console.log(`Oráculo congelado: ${nombres.length} funciones, commit ${commit} -> ${path.relative(RAIZ, DESTINO)}`);
