// Generador de casos de plata (red de tests del rediseño, docs/rediseno-panel.md 4.10).
// Todo es inventado y sale de una semilla: con la misma semilla salen siempre los mismos casos,
// así un caso que falla se puede reproducir (SEMILLA=123 npx playwright test tests/red-plata.spec.js).
// Lo usan tests/red-plata.spec.js (la app contra el oráculo) y scripts/paridad-plata-sql.js
// (la base contra el oráculo).

const SEMILLA_FIJA = 20261021;

// mulberry32: chico, rápido y repetible. No es para nada de seguridad, solo para armar casos.
function crearAzar(semilla) {
  let a = semilla >>> 0;
  const r = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    r,
    entero: (min, max) => min + Math.floor(r() * (max - min + 1)),
    de: lista => lista[Math.floor(r() * lista.length)],
    si: (p = 0.5) => r() < p,
  };
}

const dos = n => String(n).padStart(2, '0');
const hhmm = m => `${dos(Math.floor(m / 60) % 24)}:${dos(m % 60)}`;
// Suma días a "AAAA-MM-DD" al mediodía UTC: no depende de la zona de quien corre el test.
function sumarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const idFicticio = (prefijo, n) => `${prefijo}-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Tarifas por hora como las reales (enteras) y algunas con centavos, que es donde se equivoca un
// redondeo. 0 = familia sin tarifa cargada.
const TARIFAS = [0, 240.2, 250, 260, 280, 300.5, 303, 333.33, 380, 400, 450.75];
// Familias según los términos y condiciones: sin la casilla, aceptados antes del 01/12/2026 (redondea
// desde el 01/12, que cae en el medio de las fechas de los casos) o después (redondea desde ese día).
const FAMILIAS_TERMINOS = [null, { terminos_aceptados_el: null }, { terminos_aceptados_el: '2026-10-01' }, { terminos_aceptados_el: '2026-12-08' }];

// Un horario: inicio cualquiera, entre 1 minuto y 16 horas. Si pasa la medianoche, con la casilla
// del día siguiente; a veces la casilla mal marcada (fin después del inicio) o un horario a medias.
function casoHorario(az) {
  const ini = az.entero(0, 1439);
  const dur = az.entero(1, 960);
  const finAbs = ini + dur;
  let cruza = finAbs >= 1440;
  const fin = finAbs % 1440;
  if (!cruza && az.si(0.08)) cruza = true; // mal marcada
  const conSegundos = az.si(0.3); // como viene de la base: "HH:MM:SS"
  const fmt = m => (conSegundos ? hhmm(m) + ':00' : hhmm(m));
  const incompleto = az.si(0.03) ? az.de(['ini', 'fin']) : null;
  return {
    ini: incompleto === 'ini' ? '' : fmt(ini),
    fin: incompleto === 'fin' ? '' : fmt(fin),
    cruza,
    familia: az.de(FAMILIAS_TERMINOS),
    fecha: az.si(0.05) ? '' : sumarDias('2026-11-24', az.entero(0, 16)), // del 24/11 al 10/12
  };
}
// Barridos de borde: cada minuto de fin de una tarde (14:01 a 23:59), lo mismo con un inicio suelto
// (14:07) y cada minuto después de la medianoche (22:00 a 00:00..05:59), con y sin términos. Ahí vive
// la regla de los 15 minutos (sobre el total de horas).
function barridoHorarios() {
  const casos = [];
  const conTerminos = { terminos_aceptados_el: '2026-10-01' };
  for (let m = 14 * 60 + 1; m < 24 * 60; m++) casos.push({ ini: '14:00', fin: hhmm(m), cruza: false, familia: conTerminos, fecha: '2026-12-21' });
  for (let m = 14 * 60 + 8; m < 24 * 60; m++) casos.push({ ini: '14:07', fin: hhmm(m), cruza: false, familia: conTerminos, fecha: '2026-12-21' });
  for (let m = 0; m < 6 * 60; m++) casos.push({ ini: '22:00', fin: hhmm(m), cruza: true, familia: m % 2 ? conTerminos : null, fecha: '2026-12-21' });
  casos.push({ ini: '20:00', fin: '20:00', cruza: true, familia: conTerminos, fecha: '2026-12-21' }); // 24 h justas
  // El primer día de la regla y el anterior.
  for (const fecha of ['2026-11-30', '2026-12-01']) casos.push({ ini: '14:00', fin: '17:46', cruza: false, familia: conTerminos, fecha });
  return casos;
}

// Montos: enteros, con centavos y justo en los bordes de ,5; negativos; lo que sale de multiplicar
// una tarifa por minutos (,4999... por el punto flotante); y valores raros que no son números.
function casoMonto(az) {
  const tipo = az.entero(1, 10);
  if (tipo <= 2) return az.de(['600.5', '', null, undefined, NaN, 'abc', '0', '-0.5', Infinity]);
  if (tipo <= 5) {
    const base = az.entero(0, 6000) + az.de([0, 0.5, 0.49, 0.51, 0.4, 0.6, 0.05, 0.95, az.entero(0, 99) / 100]);
    return az.si(0.1) ? -base : base;
  }
  return az.de(TARIFAS.filter(Boolean)) * az.entero(1, 900) / 60;
}

// Un mes de registros para el resumen (facturado, cobrado, por cobrar, por pagar, resultado):
// puntuales y de fijos, con y sin marcar, algunos de días que todavía no pasaron.
function escenarioResumen(az, hoy) {
  const mes = hoy.slice(0, 7);
  const nins = ['Ana Generada', 'Bruno Generado', 'Carla Generada', 'Dana Generada'];
  const fams = ['Familia Generada Uno', 'Familia Generada Dos', 'Familia Generada Tres'];
  const asigs = [];
  const nAsig = az.entero(0, 3);
  for (let i = 0; i < nAsig; i++) {
    const dias = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].filter(() => az.si(0.35));
    asigs.push({
      id: idFicticio('4a000000', i + 1), familia_id: idFicticio('2a000000', (i % 3) + 1), ninera_id: az.si(0.8) ? idFicticio('3a000000', (i % 4) + 1) : null,
      ninera_nombre: nins[i % 4], familias: { nombre: fams[i % 3] }, dias: dias.length ? dias : ['L'],
      vigente_desde: `${mes}-01`, vigente_hasta: az.si(0.2) ? `${mes}-${dos(az.entero(5, 28))}` : null, tipo: 'sitting',
    });
  }
  const sits = [];
  const n = az.entero(1, 30);
  for (let i = 0; i < n; i++) {
    const f = az.entero(0, 2), ni = az.entero(0, 3);
    const deFijo = asigs.length && az.si(0.4) ? az.de(asigs) : null;
    sits.push({
      id: idFicticio('7a000000', i + 1), fecha: `${mes}-${dos(az.entero(1, 28))}`,
      familia_id: deFijo ? deFijo.familia_id : (az.si(0.9) ? idFicticio('2a000000', f + 1) : null),
      familia_nombre: deFijo ? deFijo.familias.nombre : fams[f],
      ninera_id: deFijo ? deFijo.ninera_id : (az.si(0.9) ? idFicticio('3a000000', ni + 1) : null),
      ninera_nombre: deFijo ? deFijo.ninera_nombre : nins[ni],
      asignacion_id: deFijo && az.si(0.6) ? deFijo.id : null,
      cobro_familia: az.si(0.05) ? 0 : Math.round(az.entero(300, 3000) * 100 + az.de([0, 50, 49, 51])) / 100,
      pago_ninera: az.si(0.05) ? 0 : Math.round(az.entero(200, 2000) * 100 + az.de([0, 50, 49, 51])) / 100,
      cobrado: az.si(0.4), pagado: az.si(0.5),
    });
  }
  const enrique = Array.from({ length: az.entero(0, 2) }, (_, i) => ({ id: idFicticio('5a000000', i + 1), ninera_nombre: nins[i], fecha: `${mes}-${dos(az.entero(1, 28))}`, monto: az.entero(1000, 9000), cobrado: az.si() }));
  const eventos = Array.from({ length: az.entero(0, 2) }, (_, i) => ({
    id: idFicticio('6a000000', i + 1), empresa: `Empresa Generada ${i + 1}`, fecha: `${mes}-${dos(az.entero(1, 28))}`, cobro_total: az.entero(2000, 20000), cobrado: az.si(),
    intermediaciones_eventos_ninieras: Array.from({ length: az.entero(0, 3) }, (_, j) => ({ id: idFicticio('6b000000', i * 10 + j + 1), ninera_nombre: nins[j], pago: az.entero(500, 3000), pagado: az.si() })),
  }));
  return { sits, asigs, gastosNegocio: az.entero(0, 20000), absorbidos: az.si(0.3) ? az.entero(0, 3000) : 0, enrique, eventos };
}

// Una base chica para Por cobrar / Por pagar: familias semanales y mensuales, fijos (algunos con
// fin de semana), puntuales, días que todavía no pasaron (y previstos de los fijos automáticos),
// gastos extra que pagó la niñera (a cobrar, a reintegrar, que absorbe Parents Break) y saldos a
// favor que suman o descuentan, enteros o a medio usar.
function escenarioPendientes(az, hoy, fijosAutomaticos = true) {
  const nFam = az.entero(1, 4), nNin = az.entero(1, 4);
  const familias = Array.from({ length: nFam }, (_, i) => ({
    id: idFicticio('2b000000', i + 1), nombre: `Familia Generada ${i + 1}`, zona: 'Pocitos', telefono: '099000000',
    frecuencia_cobro: az.de(['mensual', 'semanal', 'mensual', null]), cobro_hora: 400, pago_hora: 260,
    cuenta_bancaria: az.si(0.5) ? ['0001234567'] : [], terminos_aceptados_el: null, created_at: '2026-09-01T00:00:00Z',
  }));
  const ninieras = Array.from({ length: nNin }, (_, i) => ({
    id: idFicticio('3b000000', i + 1), nombre: `Niñera Generada ${i + 1}`, activa: true, tipo: 'Niñera', zona: 'Pocitos', telefono: '098000000',
    cuenta_bancaria: az.si(0.6) ? [`BROU 00998877${dos(i)}`] : [], created_at: '2026-09-01T00:00:00Z',
  }));
  const asignaciones = [];
  for (let i = 0; i < az.entero(0, 3); i++) {
    const fam = az.de(familias), nin = az.de(ninieras);
    const dias = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].filter(() => az.si(0.3));
    asignaciones.push({
      id: idFicticio('4b000000', i + 1), familia_id: fam.id, ninera_id: az.si(0.85) ? nin.id : null, ninera_nombre: nin.nombre,
      dias: dias.length ? dias : ['X'], hora_inicio: '16:00:00', hora_fin: '19:00:00', tipo: 'sitting',
      vigente_desde: sumarDias(hoy, -az.entero(10, 70)), vigente_hasta: az.si(0.2) ? sumarDias(hoy, az.entero(-20, 20)) : null,
      cobro_hora: null, pago_hora: null, created_at: '2026-09-01T00:00:00Z',
    });
  }
  const sittings = [];
  for (let i = 0; i < az.entero(3, 25); i++) {
    const asig = asignaciones.length && az.si(0.45) ? az.de(asignaciones) : null;
    const fam = asig ? familias.find(f => f.id === asig.familia_id) : az.de(familias);
    const nin = asig ? ninieras.find(n => n.nombre === asig.ninera_nombre) : az.de(ninieras);
    const fecha = sumarDias(hoy, -az.entero(-7, 42));
    const futuro = fecha > hoy;
    const previsto = fijosAutomaticos && futuro && !!asig && az.si(0.6);
    sittings.push({
      id: idFicticio('7b000000', i + 1), tipo: 'sitting', registrado_por: previsto ? 'Automático' : 'Prueba',
      familia_id: az.si(0.92) ? fam.id : null, familia_nombre: fam.nombre,
      ninera_id: (asig && !asig.ninera_id) || az.si(0.08) ? null : nin.id, ninera_nombre: nin.nombre,
      fecha, hora_inicio: '16:00:00', hora_fin: '19:00:00', termina_dia_siguiente: false,
      cobro_familia: az.si(0.06) ? 0 : Math.round(az.entero(300, 3000) * 100 + az.de([0, 50, 49, 51])) / 100,
      pago_ninera: az.si(0.06) ? 0 : Math.round(az.entero(200, 2000) * 100 + az.de([0, 50, 49, 51])) / 100,
      cobrado: !futuro && az.si(0.35), pagado: !futuro && az.si(0.35), cancelado: false,
      asignacion_id: asig && az.si(0.7) ? asig.id : null, estado: previsto ? 'previsto' : 'confirmado', generado_automatico: previsto,
      fuente: 'app', notas: null, km: null, origen: null, destino: null, revisado_at: null, created_at: fecha + 'T22:00:00Z',
    });
  }
  const gastos_extra = [];
  for (let i = 0; i < az.entero(0, 4) && sittings.length; i++) {
    const s = az.de(sittings);
    const pagadoPor = az.si(0.8) ? 'ninera' : 'familia';
    gastos_extra.push({
      id: idFicticio('8b000000', i + 1), sitting_id: s.id, concepto: az.de(['Taxi', 'Merienda', 'Farmacia']), monto: az.entero(50, 900) + az.de([0, 0.5]),
      pagado_por: pagadoPor, absorbe_pb: pagadoPor === 'ninera' && az.si(0.25), cobrado: az.si(0.3), reintegrado: az.si(0.3),
      comprobante: 'ficticio/ticket.jpg', ajuste_id: null, creado_por: 'Prueba', created_at: '2026-10-01T00:00:00Z',
    });
  }
  const ajustes_saldo = [];
  for (let i = 0; i < az.entero(0, 3); i++) {
    const deFamilia = az.si();
    const quien = deFamilia ? az.de(familias) : az.de(ninieras);
    const monto = (az.si(0.6) ? -1 : 1) * (az.entero(50, 2500) + az.de([0, 0.5, 0.25]));
    ajustes_saldo.push({
      id: idFicticio('9b000000', i + 1), sujeto: deFamilia ? 'familia' : 'ninera',
      familia_id: deFamilia && az.si(0.9) ? quien.id : null, ninera_id: !deFamilia && az.si(0.9) ? quien.id : null, nombre: quien.nombre,
      monto, aplicado: az.si(0.3) ? Math.round(Math.abs(monto) * az.r() * 100) / 100 : 0, aplicaciones: [], motivo: 'Saldo generado',
      fecha: sumarDias(hoy, -az.entero(0, 40)), creado_por: 'Prueba', created_at: '2026-10-01T00:00:00Z',
    });
  }
  return { familias, ninieras, asignaciones, sittings_traslados: sittings, gastos_extra, ajustes_saldo };
}

module.exports = { SEMILLA_FIJA, crearAzar, casoHorario, barridoHorarios, casoMonto, escenarioResumen, escenarioPendientes, TARIFAS, hhmm, sumarDias };
