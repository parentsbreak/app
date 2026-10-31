// Red de tests de plata (docs/rediseno-panel.md 4.10, punto 2), antes de tocar cualquier cálculo
// en el rediseño. Miles de casos inventados, con una semilla fija, comparan:
//  - la app (js/) con el oráculo: la copia congelada de las funciones de plata de hoy
//    (tests/support/oraculo-plata.js). Si alguien cambia un cálculo sin querer, salta acá;
//  - la app con la regla escrita (CLAUDE.md), armada aparte en este archivo, para que un
//    error que estuviera en las dos copias también se vea.
// La base (minutos_fin_cobro, redondear_*, generar_previstos_fijos) se compara con el mismo
// oráculo en supabase/pruebas/paridad_plata.sql (Postgres local, nunca producción).
// Otra semilla: SEMILLA=123 npx playwright test tests/red-plata.spec.js
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { abrirApp, irAModulo, verificarLimpio } = require('./support/app');
const { SEMILLA_FIJA, crearAzar, casoHorario, barridoHorarios, casoMonto, escenarioResumen, escenarioPendientes, TARIFAS, hhmm } = require('./support/generador-plata');
const { generarSQL } = require('../scripts/paridad-plata-sql');

const SEMILLA = Number(process.env.SEMILLA || SEMILLA_FIJA);
const FUENTE_ORACULO = fs.readFileSync(path.join(__dirname, 'support', 'oraculo-plata.js'), 'utf8');
// Fechas de "hoy" que cambian lo que se debe: un miércoles (semanas en curso), el sábado en que
// cierran las semanas de las fijas, el domingo (lo de ese día se paga ese día, 23/10/2026) y el lunes
// siguiente. Sin el lunes, correr el cierre un día no lo
// atrapaba ningún caso.
const HOYS = [['miércoles', '2026-10-21T10:00:00-03:00'], ['sábado', '2026-10-24T10:00:00-03:00'], ['domingo', '2026-10-25T10:00:00-03:00'], ['lunes', '2026-10-26T10:00:00-03:00']];

async function cargarOraculo(page) {
  await page.addScriptTag({ content: FUENTE_ORACULO + '\nwindow.ORACULO = crearOraculoPlata();' });
}
// Las diferencias se muestran con los datos del caso (las primeras 5), para reproducirlo.
function sinDiferencias(lista, que) {
  expect(lista.slice(0, 5), `${lista.length} casos de ${que} no coinciden (semilla ${SEMILLA})`).toEqual([]);
}
function anotarCasos(cuantos, que) {
  test.info().annotations.push({ type: 'casos', description: `${cuantos} ${que}` });
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cerca = (a, b) => Math.abs(a - b) < 1e-6;

// ---------- La regla escrita, armada aparte (no copia el código de la app) ----------
const minutos = h => { if (!h) return null; const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm; };
// Horas de un sitting (CLAUDE.md, términos y condiciones y "Termina al día siguiente"): la niñera
// cobra la hora real; a la familia que aceptó los términos, desde ese día, el fin se lleva a la
// media hora con 5 minutos de tolerancia (17:05 → 17:00, 17:06 → 17:30, 17:36 → 18:00). Con la
// casilla del día siguiente el fin va antes del inicio (o igual: 24 h).
function reglaHoras({ ini, fin, cruza, familia, fecha }) {
  if (!ini || !fin) return null;
  const mi = minutos(ini), finReloj = minutos(fin);
  if (cruza && finReloj > mi) return null;
  const mf = finReloj + (cruza ? 1440 : 0);
  if (mf <= mi) return null;
  const desde = familia?.terminos_aceptados_el;
  let mc = mf;
  if (desde && (!fecha || fecha >= desde)) {
    const resto = mf % 30;
    mc = Math.max(mi, resto <= 5 ? mf - resto : mf - resto + 30);
  }
  return { real: (mf - mi) / 60, cobro: (mc - mi) / 60, finCobro: mc !== mf ? hhmm(mc) : null };
}
const diaSemanaRegla = iso => new Date(iso + 'T12:00:00Z').getUTCDay(); // 0 domingo … 6 sábado
const sumarDiasRegla = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// Montos sin centavos: el pago, ,5 o menos baja; el cobro, ,5 o más sube; primero a centavos.
function reglaRedondeo(n, cobro) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const centavos = Math.round(Math.abs(v) * 100);
  const r = cobro ? Math.floor((centavos + 50) / 100) : Math.floor((centavos + 49) / 100);
  return v < 0 && r ? -r : r;
}

// Pago por hora de una niñera (31/10/2026, docs/precio-ninera-familia.md): el precio del fijo si es
// más que 0; si no, el de esa niñera con esa familia (precios_ninera_familia); si no, la tarifa de la
// familia si es más que 0; si no, ninguno. Lo que llega de un campo puede venir como texto ("300").
function reglaPagoHora(familia, nineraId, precios, pagoFijo) {
  const num = x => (x === null || x === undefined || x === '' ? NaN : Number(x));
  if (num(pagoFijo) > 0) return num(pagoFijo);
  const fila = nineraId && familia && familia.id ? (precios || []).find(p => p.familia_id === familia.id && p.ninera_id === nineraId) : undefined;
  if (fila && num(fila.pago_hora) > 0) return num(fila.pago_hora);
  return familia && num(familia.pago_hora) > 0 ? num(familia.pago_hora) : null;
}

test.describe('red de plata: la app contra el oráculo y la regla escrita', () => {
  test('horario: horas reales, horas cobradas y hasta qué hora se cobra', async ({ page }) => {
    const e = await abrirApp(page);
    await cargarOraculo(page);
    const az = crearAzar(SEMILLA);
    const casos = [...barridoHorarios(), ...Array.from({ length: 1000 }, () => casoHorario(az))];
    const res = await page.evaluate(cs => cs.map(c => ({
      app: horasSitting(c.ini, c.fin, c.cruza, c.familia, c.fecha),
      oraculo: ORACULO.horasSitting(c.ini, c.fin, c.cruza, c.familia, c.fecha),
    })), casos);
    const contraOraculo = [], contraRegla = [];
    res.forEach((r, i) => {
      if (!igual(r.app, r.oraculo)) contraOraculo.push({ caso: casos[i], app: r.app, oraculo: r.oraculo });
      const regla = reglaHoras(casos[i]);
      if (!igual(r.app, regla)) contraRegla.push({ caso: casos[i], app: r.app, regla });
    });
    sinDiferencias(contraOraculo, 'horario contra el oráculo');
    sinDiferencias(contraRegla, 'horario contra la regla escrita');
    expect(casos.length).toBeGreaterThan(1900);
    anotarCasos(casos.length, 'horarios');
    verificarLimpio(e);
  });

  test('montos: redondeo del cobro y del pago, y precio de un sitting por horario', async ({ page }) => {
    const e = await abrirApp(page);
    await cargarOraculo(page);
    const az = crearAzar(SEMILLA + 1);
    const montos = Array.from({ length: 800 }, () => casoMonto(az));
    // El horario de casoHorario con la familia de este caso (tarifa y términos).
    const precios = Array.from({ length: 800 }, () => {
      const { familia, ...horario } = casoHorario(az);
      return { ...horario, fam: { cobro_hora: az.de(TARIFAS), pago_hora: az.de(TARIFAS), terminos_aceptados_el: familia?.terminos_aceptados_el ?? null } };
    });
    const res = await page.evaluate(([ms, ps]) => ({
      montos: ms.map(n => ({ app: [redondearPago(n), redondearCobro(n)], oraculo: [ORACULO.redondearPago(n), ORACULO.redondearCobro(n)] })),
      precios: ps.map(p => ({
        app: precioSegunHorario(p.fam, p.ini, p.fin, p.cruza, p.fecha),
        oraculo: ORACULO.precioSegunHorario(p.fam, p.ini, p.fin, p.cruza, p.fecha),
      })),
    }), [montos, precios]);
    const malos = [];
    res.montos.forEach((r, i) => {
      const regla = [reglaRedondeo(montos[i], false), reglaRedondeo(montos[i], true)];
      if (!igual(r.app, r.oraculo) || !igual(r.app, regla)) malos.push({ monto: String(montos[i]), app: r.app, oraculo: r.oraculo, regla });
    });
    res.precios.forEach((r, i) => {
      const p = precios[i];
      const h = reglaHoras({ ...p, familia: p.fam });
      const cobroH = Number(p.fam.cobro_hora) || 0, pagoH = Number(p.fam.pago_hora) || 0;
      const regla = { cobro: h && cobroH ? reglaRedondeo(cobroH * h.cobro, true) : null, pago: h && pagoH ? reglaRedondeo(pagoH * h.real, false) : null };
      if (!igual(r.app, r.oraculo) || !igual(r.app, regla)) malos.push({ caso: p, app: r.app, oraculo: r.oraculo, regla });
    });
    sinDiferencias(malos, 'montos y precios');
    anotarCasos(montos.length + precios.length, 'montos y precios');
    verificarLimpio(e);
  });

  for (const [dia, ahora] of HOYS) {
    test(`resumen del mes, un ${dia}: facturado, cobrado, por cobrar, por pagar y resultado`, async ({ page }) => {
      const e = await abrirApp(page, { ahora });
      await cargarOraculo(page);
      const az = crearAzar(SEMILLA + 2 + HOYS.findIndex(h => h[1] === ahora));
      const hoy = ahora.slice(0, 10);
      const escenarios = Array.from({ length: 100 }, () => escenarioResumen(az, hoy));
      const res = await page.evaluate(escs => {
        const APP = { construirEsTrabajoFijo, construirEsEnCurso, resumenIntermediaciones, resumenFinancieroMes, filtrarFijosSemanaIncompleta };
        // Igual que cargarFinanzas: una fija cuya semana todavía no se puede pagar va aparte de
        // Por pagar (construirEsEnCurso; 21/10/2026: el día que cierra, después del último fijo).
        const calcular = (F, esc) => {
          const esFijo = F.construirEsTrabajoFijo(esc.asigs);
          const enCurso = F.construirEsEnCurso(esc.sits, esc.asigs);
          const inter = F.resumenIntermediaciones(esc.enrique, esc.eventos);
          return {
            resumen: F.resumenFinancieroMes(esc.sits, esc.gastosNegocio, esc.absorbidos, inter, enCurso),
            margen: F.filtrarFijosSemanaIncompleta(esc.sits, enCurso).map(r => r.id),
            fijos: esc.sits.filter(esFijo).map(r => r.id),
          };
        };
        return escs.map(esc => ({ app: calcular(APP, esc), oraculo: calcular(ORACULO, esc) }));
      }, escenarios);
      const malos = [];
      res.forEach((r, i) => {
        const esc = escenarios[i], s = r.app.resumen, it = s.intermediaciones;
        if (!igual(r.app, r.oraculo)) malos.push({ escenario: i, que: 'contra el oráculo', app: r.app, oraculo: r.oraculo });
        // La regla escrita (CLAUDE.md, Finanzas): el resultado sale de lo facturado.
        if (!cerca(s.facturado, s.cobrado + s.porCobrar)) malos.push({ escenario: i, que: 'facturado = cobrado + por cobrar', s });
        if (!cerca(s.resultado, s.facturado - s.costoNinieras - s.gastos - s.absorbidos)) malos.push({ escenario: i, que: 'resultado', s });
        const sinPagar = esc.sits.filter(x => !x.pagado).reduce((t, x) => t + x.pago_ninera, 0) + it.porPagar + it.porPagarFuturo;
        if (!cerca(s.porPagar + s.porPagarEnCurso + s.porPagarFuturo, sinPagar)) malos.push({ escenario: i, que: 'por pagar + en curso + futuro', s });
        // El margen (23/10/2026): un fijo cuenta cuando su período de pago cerró: la semana de lunes
        // a sábado, o el mismo domingo si es de un domingo. Antes de ese día nunca; desde el subsiguiente
        // siempre (ese día y el siguiente dependen de la hora del último fijo). Lo puntual, siempre.
        for (const x of esc.sits) {
          const enMargen = r.app.margen.includes(x.id);
          if (!r.app.fijos.includes(x.id)) { if (!enMargen) malos.push({ escenario: i, que: 'puntual fuera del margen', x }); continue; }
          const dow = diaSemanaRegla(x.fecha);
          const cierra = dow === 0 ? x.fecha : sumarDiasRegla(x.fecha, 6 - dow);
          if (hoy < cierra && enMargen) malos.push({ escenario: i, que: 'fijo en el margen antes de que cierre', x, hoy });
          if (hoy > sumarDiasRegla(cierra, 1) && !enMargen) malos.push({ escenario: i, que: 'fijo de un período cerrado fuera del margen', x, hoy });
        }
      });
      sinDiferencias(malos, `resúmenes (${dia})`);
      anotarCasos(escenarios.length, `meses (${dia})`);
      verificarLimpio(e);
    });
  }

  for (const [dia, ahora] of HOYS) {
    test(`Por cobrar y Por pagar, un ${dia}: grupos, gastos extra, saldo a favor y monto a transferir`, async ({ page }) => {
      const fijosAutomaticos = dia !== 'sábado'; // un día sin la marca, para cubrir los dos caminos
      const app_config = fijosAutomaticos ? [{ id: 'fijos_automaticos', valor: { activo: true, dias: 14 }, actualizado_at: '2026-10-04T06:00:00Z' }] : [];
      const e = await abrirApp(page, { ahora, datos: { app_config } });
      await cargarOraculo(page);
      const hoy = ahora.slice(0, 10);
      const az = crearAzar(SEMILLA + 10 + HOYS.findIndex(h => h[1] === ahora));
      const malos = [];
      const N = 100;
      for (let i = 0; i < N; i++) {
        const esc = escenarioPendientes(az, hoy, fijosAutomaticos);
        Object.assign(e.db, esc);
        const r = await page.evaluate(async () => {
          // Orden estable para comparar: por persona y período, con los ids ordenados.
          const orden = gs => gs.map(g => ({ ...g, ids: [...g.ids].sort() })).sort((a, b) => `${a.familia_id || a.ninera_id || a.nombre}|${a.bucket}`.localeCompare(`${b.familia_id || b.ninera_id || b.nombre}|${b.bucket}`));
          const calcular = async F => {
            const p = await F.calcularPendientesAgrupados();
            const ajustes = await F.cargarAjustesSaldo();
            const cobrar = structuredClone(p.gruposCobrar), pagar = structuredClone(p.gruposPagar);
            const sueltos = { familia: F.aplicarAjustesAGrupos(cobrar, ajustes, 'familia'), ninera: F.aplicarAjustesAGrupos(pagar, ajustes, 'ninera') };
            return {
              cobrar: orden(cobrar).map(g => ({ ...g, monto: F.montoGrupo(g, 'familia') })),
              pagar: orden(pagar).map(g => ({ ...g, monto: F.montoGrupo(g, 'ninera'), copiar: F.montoParaCopiar(F.montoGrupo(g, 'ninera')) })),
              sueltos, error: !!p.error,
            };
          };
          return { app: await calcular(window), oraculo: await calcular(ORACULO) };
        });
        if (!igual(r.app, r.oraculo)) { malos.push({ escenario: i, que: 'contra el oráculo', app: r.app, oraculo: r.oraculo }); continue; }
        // La regla escrita: cada registro pendiente está en un solo grupo, y nada más.
        const enGrupos = gs => gs.flatMap(g => g.ids);
        const debeCobrar = esc.sittings_traslados.filter(s => s.cobro_familia > 0 && !s.cobrado && !(s.estado === 'previsto' && s.fecha > hoy)).map(s => s.id).sort();
        const debePagar = esc.sittings_traslados.filter(s => s.pago_ninera > 0 && !s.pagado && s.fecha <= hoy).map(s => s.id).sort();
        if (!igual(enGrupos(r.app.cobrar).sort(), debeCobrar)) malos.push({ escenario: i, que: 'registros en Por cobrar', app: enGrupos(r.app.cobrar), debeCobrar });
        if (!igual(enGrupos(r.app.pagar).sort(), debePagar)) malos.push({ escenario: i, que: 'registros en Por pagar', app: enGrupos(r.app.pagar), debePagar });
        // El total de cada grupo es la suma de sus registros y sus gastos; un descuento nunca lo deja en negativo.
        const montoDe = (id, campo) => esc.sittings_traslados.find(s => s.id === id)[campo];
        for (const [gs, campo] of [[r.app.cobrar, 'cobro_familia'], [r.app.pagar, 'pago_ninera']]) {
          for (const g of gs) {
            const suma = g.ids.reduce((t, id) => t + montoDe(id, campo), 0) + (g.gastos || []).reduce((t, x) => t + x.monto, 0);
            if (!cerca(g.total, suma)) malos.push({ escenario: i, que: 'total del grupo', g, suma });
            if (g.totalNeto < -1e-6) malos.push({ escenario: i, que: 'saldo a favor dejó un grupo en negativo', g });
          }
        }
        // Un gasto que pagó la niñera se cobra (si no lo absorbe Parents Break) y se reintegra.
        for (const gx of esc.gastos_extra.filter(x => x.pagado_por === 'ninera')) {
          const s = esc.sittings_traslados.find(x => x.id === gx.sitting_id);
          const enCobro = r.app.cobrar.some(g => (g.gastos || []).some(x => x.id === gx.id));
          const enPago = r.app.pagar.some(g => (g.gastos || []).some(x => x.id === gx.id));
          if (enCobro !== (!gx.cobrado && !gx.absorbe_pb)) malos.push({ escenario: i, que: 'gasto extra en Por cobrar', gx });
          if (enPago !== (!gx.reintegrado && s.fecha <= hoy)) malos.push({ escenario: i, que: 'gasto extra en Por pagar', gx });
        }
      }
      sinDiferencias(malos, `Por cobrar y Por pagar (${dia})`);
      anotarCasos(N, `bases chicas (${dia})`);
      verificarLimpio(e);
    });
  }

  test('lo que se ve en Por cobrar y Por pagar es lo que dice el oráculo', async ({ page }) => {
    const ahora = HOYS[0][1];
    const app_config = [{ id: 'fijos_automaticos', valor: { activo: true, dias: 14 }, actualizado_at: '2026-10-04T06:00:00Z' }];
    const e = await abrirApp(page, { ahora, datos: { app_config } });
    await irAModulo(page, 'finanzas');
    await cargarOraculo(page);
    const az = crearAzar(SEMILLA + 20);
    const malos = [];
    const N = 60;
    for (let i = 0; i < N; i++) {
      // Cada escenario en otro de los días de HOYS: cambia qué semanas ya cerraron.
      const hoyCaso = HOYS[i % HOYS.length][1];
      await page.clock.setFixedTime(new Date(hoyCaso));
      Object.assign(e.db, escenarioPendientes(az, hoyCaso.slice(0, 10), true));
      const r = await page.evaluate(async () => {
        await cargarPorCobrarPorPagar();
        // Lo que se ve: nombre y monto de cada fila (en la semana en curso, lo que "lleva").
        const filas = sel => [...document.querySelectorAll(sel)].map(f => [f.children[0].children[0].textContent.trim(), Number(f.children[1].querySelector('span').textContent.replace(/[^0-9-]/g, ''))]);
        const visto = {
          cobrar: filas('#fin-porcobrar-wrap .agendarow'),
          pagar: filas('#fin-porpagar-wrap .agendarow:not(.fin-semana-en-curso)'),
          enCurso: filas('#fin-porpagar-wrap .fin-semana-en-curso'),
          cobrarTarjetas: [...document.querySelectorAll('#fin-porcobrar-wrap .fin-pend-cabeza')].map(c => c.children[0].textContent.trim()),
          pagarTarjetas: [...document.querySelectorAll('#fin-porpagar-wrap .fin-pend-cabeza')].map(c => c.children[0].textContent.trim()),
        };
        // Misma composición que cargarPorCobrarPorPagar (finanzas.js), con las funciones del oráculo.
        const O = ORACULO, hoyISO = todayISO();
        const { gruposCobrar, gruposPagar } = await O.calcularPendientesAgrupados();
        const inter = await O.intermediacionesPendientes();
        const listaCobrar = gruposCobrar.filter(g => g.frec !== 'semanal' || O.finDeSemanaDesde(g.bucket) < hoyISO);
        const enCurso = g => g.frec === 'semanal' && !O.semanaFijoCerrada(g.cierre);
        const listaPagar = gruposPagar.filter(g => !enCurso(g));
        const ajustes = await O.cargarAjustesSaldo();
        // Una tarjeta por persona (23/10/2026) y el saldo a favor sobre la tarjeta entera.
        const tarjetasCobrar = O.armarTarjetasPendientes(listaCobrar, 'familia');
        const tarjetasPagar = O.armarTarjetasPendientes(listaPagar, 'ninera');
        O.aplicarAjustesAGrupos(tarjetasCobrar, ajustes, 'familia');
        O.aplicarAjustesAGrupos(tarjetasPagar, ajustes, 'ninera');
        const oraculo = {
          cobrar: [...tarjetasCobrar, ...inter.cobrar].map(g => [g.nombre, O.montoGrupo(g, 'familia')]),
          pagar: [...tarjetasPagar, ...inter.pagar].map(g => [g.nombre, O.montoGrupo(g, 'ninera')]),
          enCurso: gruposPagar.filter(enCurso).map(g => [g.nombre, O.redondearPago(g.total)]),
        };
        return { visto, oraculo };
      });
      const ordenar = l => l.map(x => x.join(' $')).sort();
      for (const k of ['cobrar', 'pagar', 'enCurso']) {
        if (!igual(ordenar(r.visto[k]), ordenar(r.oraculo[k]))) malos.push({ escenario: i, lista: k, visto: r.visto[k], oraculo: r.oraculo[k] });
      }
      // La regla escrita: una sola tarjeta por familia o niñera (sin contar las intermediaciones).
      for (const k of ['cobrar', 'pagar']) {
        const nombres = r.visto[k + 'Tarjetas'];
        if (new Set(nombres).size !== nombres.length) malos.push({ escenario: i, que: 'una persona en dos tarjetas', lista: k, nombres });
      }
    }
    sinDiferencias(malos, 'pantallas de Por cobrar y Por pagar');
    anotarCasos(N, 'pantallas de Finanzas');
    verificarLimpio(e);
  });

  test('cobro parcial: lo tildado con el saldo a favor y la combinación exacta de "¿Cuánto pagó?"', async ({ page }) => {
    // Regla escrita (23/10/2026): el saldo se aplica a lo que se marca, en orden; un descuento
    // nunca deja el total en negativo; el total va sin centavos. "¿Cuánto pagó?" elige, entre
    // las partes que suman exacto, la que usa las más viejas (se compara con probar todas).
    const e = await abrirApp(page);
    await cargarOraculo(page);
    const az = crearAzar(SEMILLA + 30);
    const reglaParcial = (subtotal, ajustes, familia) => {
      let neto = subtotal;
      for (const a of ajustes) neto = a.monto > 0 ? neto + a.monto : neto - Math.min(-a.monto, Math.max(neto, 0));
      return reglaRedondeo(Math.round(neto * 100) / 100, familia);
    };
    const casos = [];
    const N = 400;
    for (let i = 0; i < N; i++) {
      const n = az.entero(1, 9);
      const unidades = Array.from({ length: n }, () => ({ monto: az.si(0.6) ? az.de([380, 570, 760, 1140, 1520]) : Math.round(az.entero(100, 3000) * 100 + az.de([0, 0, 50, 49])) / 100 }));
      const ajustes = Array.from({ length: az.entero(0, 2) }, (_, k) => ({ id: 'aj' + k, monto: (az.si(0.8) ? -1 : 1) * az.de([100, 250, 500, 760, 2000, 333.5]) }));
      const familia = az.si(0.7);
      // Una parte al azar (siempre tiene solución) o un monto al azar (puede no tenerla).
      const parte = unidades.map(() => az.si(0.5));
      if (!parte.some(Boolean)) parte[az.entero(0, n - 1)] = true;
      const suma = unidades.reduce((t, u, k) => t + (parte[k] ? u.monto : 0), 0);
      const objetivo = az.si(0.7) ? reglaParcial(suma, ajustes, familia) : az.entero(1, 8000);
      casos.push({ unidades, ajustes, familia, objetivo, suma });
    }
    const r = await page.evaluate(casos => casos.map(c => {
      const sujeto = c.familia ? 'familia' : 'ninera';
      const de = F => ({ parcial: F.totalParcial(c.suma, c.ajustes, sujeto), combinacion: F.combinacionExacta(c.unidades, c.objetivo, c.ajustes, sujeto) });
      return { app: de(window), oraculo: de(ORACULO) };
    }), casos);
    const malos = [];
    const masVieja = (a, b) => { for (let j = 0; j < Math.min(a.length, b.length); j++) if (a[j] !== b[j]) return a[j] < b[j]; return a.length < b.length; };
    casos.forEach((c, i) => {
      const { app, oraculo } = r[i];
      if (!igual(app, oraculo)) { malos.push({ caso: i, que: 'contra el oráculo', c, app, oraculo }); return; }
      if (app.parcial.total !== reglaParcial(c.suma, c.ajustes, c.familia)) malos.push({ caso: i, que: 'total de lo tildado', c, app: app.parcial });
      // Lo usado de cada ajuste, sumado a lo tildado, da el total (antes de sacar los centavos).
      const usado = app.parcial.usados.reduce((t, a) => t + a.monto, 0);
      if (!cerca(reglaRedondeo(Math.round((c.suma + usado) * 100) / 100, c.familia), app.parcial.total)) malos.push({ caso: i, que: 'saldo usado', c, app: app.parcial });
      let mejor = null;
      for (let m = 1; m < (1 << c.unidades.length); m++) {
        const idx = c.unidades.map((_, k) => k).filter(k => m & (1 << k));
        const s = Math.round(idx.reduce((t, k) => t + c.unidades[k].monto, 0) * 100) / 100;
        if (reglaParcial(s, c.ajustes, c.familia) === c.objetivo && (!mejor || masVieja(idx, mejor))) mejor = idx;
      }
      if (!igual(app.combinacion, mejor)) malos.push({ caso: i, que: 'combinación exacta', c, app: app.combinacion, regla: mejor });
    });
    sinDiferencias(malos, 'cobros parciales');
    anotarCasos(N, 'cobros parciales');
    verificarLimpio(e);
  });

  test('variantes de precio: total fijo, porcentaje y sumas, con el redondeo de cada lado', async ({ page }) => {
    // Regla escrita (23/10/2026): de cada lado (cobro y pago), primero el total fijo (si hay varios,
    // el último), después los porcentajes y al final las sumas; nunca menos de $0; el cobro con
    // la regla del cobro y el pago con la del pago.
    const e = await abrirApp(page);
    await cargarOraculo(page);
    const az = crearAzar(SEMILLA + 40);
    const efecto = () => {
      const modo = az.de(['sumar', 'sumar', 'total', 'porcentaje']);
      const valor = modo === 'porcentaje' ? az.de([-100, -50, -33, -10, 10, 15, 50]) : modo === 'total' ? az.entero(0, 3000) + az.de([0, 0, 0.5, 0.49]) : az.de([-1, 1]) * (az.entero(0, 900) + az.de([0, 0.5, 0.25]));
      return { modo, valor };
    };
    const casos = Array.from({ length: 600 }, () => ({
      cobro: az.entero(0, 4000) + az.de([0, 0.5, 0.4]),
      pago: az.entero(0, 3000) + az.de([0, 0.5, 0.6]),
      aplicadas: Array.from({ length: az.entero(0, 3) }, (_, k) => ({ id: 'v' + k, nombre: 'Variante ' + k, cobro: az.si(0.75) ? efecto() : null, pago: az.si(0.75) ? efecto() : null })),
    }));
    const regla = (base, efectos, cobro) => {
      const total = efectos.filter(x => x.modo === 'total').pop();
      let v = total ? total.valor : base;
      for (const x of efectos.filter(x => x.modo === 'porcentaje')) v = v * (1 + x.valor / 100);
      for (const x of efectos.filter(x => x.modo === 'sumar')) v = v + x.valor;
      return reglaRedondeo(Math.max(Math.round(v * 100) / 100, 0), cobro);
    };
    const r = await page.evaluate(casos => casos.map(c => ({ app: aplicarVariantes(c.cobro, c.pago, c.aplicadas), oraculo: ORACULO.aplicarVariantes(c.cobro, c.pago, c.aplicadas) })), casos);
    const malos = [];
    casos.forEach((c, i) => {
      const esperado = { cobro: regla(c.cobro, c.aplicadas.map(a => a.cobro).filter(Boolean), true), pago: regla(c.pago, c.aplicadas.map(a => a.pago).filter(Boolean), false) };
      if (!igual(r[i].app, r[i].oraculo) || !igual(r[i].app, esperado)) malos.push({ caso: c, app: r[i].app, oraculo: r[i].oraculo, regla: esperado });
    });
    sinDiferencias(malos, 'variantes de precio');
    anotarCasos(casos.length, 'variantes de precio');
    verificarLimpio(e);
  });

  test('pago por hora de la niñera: el del fijo, el de la niñera con esa familia o la tarifa', async ({ page }) => {
    // 31/10/2026: precioHoraNinera (core.js) elige la base del pago; precioSegunHorario la usa como
    // familia.pago_hora. Casos a mano de cada nivel y un lote al azar, contra el oráculo y la regla.
    const e = await abrirApp(page);
    await cargarOraculo(page);
    const F1 = 'f0000000-0000-4000-8000-000000000001', F2 = 'f0000000-0000-4000-8000-000000000002';
    const N1 = 'e0000000-0000-4000-8000-000000000001', N2 = 'e0000000-0000-4000-8000-000000000002', N3 = 'e0000000-0000-4000-8000-000000000003';
    const fam = { id: F1, cobro_hora: 300, pago_hora: 200 };
    // N1 tiene precio con F1; N2 solo con otra familia (F2); N3 no tiene ninguno.
    const precios = [{ familia_id: F1, ninera_id: N1, pago_hora: 250 }, { familia_id: F2, ninera_id: N2, pago_hora: 275 }];
    const aMano = [
      ['el precio del fijo gana sobre el de la niñera', fam, N1, precios, 230, 230],
      ['el precio del fijo gana sin fila', fam, N3, precios, 230, 230],
      ['sin precio del fijo, el de la niñera con esa familia', fam, N1, precios, null, 250],
      ['la fila manda aunque la familia no tenga tarifa', { id: F1, cobro_hora: 300, pago_hora: null }, N1, precios, null, 250],
      ['fila de la niñera con otra familia: la tarifa', fam, N2, precios, null, 200],
      ['sin fila: la tarifa', fam, N3, precios, null, 200],
      ['sin niñera (null): la tarifa', fam, null, precios, null, 200],
      ['sin niñera (vacío): la tarifa', fam, '', precios, null, 200],
      ['sin lista de precios: la tarifa', fam, N1, null, null, 200],
      ['familia sin tarifa y sin fila: ninguno', { id: F1, cobro_hora: 300, pago_hora: null }, N3, precios, null, null],
      ['familia con tarifa 0 y sin niñera: ninguno', { id: F1, cobro_hora: 300, pago_hora: 0 }, null, precios, null, null],
      ['sin familia: ninguno', null, N1, precios, null, null],
      ['precio del fijo 0: se ignora', fam, N1, precios, 0, 250],
      ['precio del fijo vacío: se ignora', fam, N1, precios, '', 250],
      ['precio del fijo "0": se ignora', fam, N1, precios, '0', 250],
      ['precio del fijo negativo: se ignora (tarifa)', fam, N3, precios, -50, 200],
      ['precio del fijo negativo: se ignora (el de la niñera)', fam, N1, precios, -50, 250],
      ['precio del fijo negativo en texto: se ignora', fam, N1, precios, '-50', 250],
      ['precio del fijo como texto', fam, N1, precios, '300', 300],
      ['precio del fijo con centavos', fam, N1, precios, '187.5', 187.5],
      ['tarifa de la familia como texto', { id: F1, cobro_hora: 300, pago_hora: '280' }, N3, precios, null, 280],
    ];
    // El lote al azar: cuatro familias (tarifas con centavos, 0, vacías o en texto), niñeras con y sin
    // precio en alguna de ellas, y el precio del fijo cargado o no.
    const az = crearAzar(SEMILLA + 50);
    const fams = [1, 2, 3, 4].map(i => ({ id: `f1000000-0000-4000-8000-00000000000${i}`, cobro_hora: az.de(TARIFAS.filter(Boolean)) }));
    const nins = [1, 2, 3, 4, 5].map(i => `e1000000-0000-4000-8000-00000000000${i}`);
    const lote = Array.from({ length: 600 }, () => {
      const lista = [];
      for (const f of fams) for (const n of nins) if (az.si(0.3)) lista.push({ familia_id: f.id, ninera_id: n, pago_hora: az.de(TARIFAS.filter(Boolean)) });
      const { familia, ...horario } = casoHorario(az);
      return {
        fam: { ...az.de(fams), pago_hora: az.si(0.25) ? az.de([null, '', '0', '280', '300.5']) : az.de(TARIFAS), terminos_aceptados_el: familia?.terminos_aceptados_el ?? null },
        nineraId: az.si(0.15) ? az.de([null, '']) : az.de(nins),
        precios: lista,
        pagoFijo: az.si(0.6) ? az.de([null, 0, '', '0']) : az.de([230, '300', 187.5, ...TARIFAS.filter(Boolean)]),
        horario,
      };
    });
    const res = await page.evaluate(([aMano, lote]) => ({
      aMano: aMano.map(([, f, n, p, fijo]) => ({ app: precioHoraNinera(f, n, p, fijo), oraculo: ORACULO.precioHoraNinera(f, n, p, fijo) })),
      lote: lote.map(c => {
        const de = F => {
          const pagoHora = F.precioHoraNinera(c.fam, c.nineraId, c.precios, c.pagoFijo);
          const h = c.horario;
          return { pagoHora, precio: F.precioSegunHorario({ ...c.fam, pago_hora: pagoHora }, h.ini, h.fin, h.cruza, h.fecha) };
        };
        return { app: de(window), oraculo: de(ORACULO) };
      }),
    }), [aMano, lote]);
    const malos = [];
    aMano.forEach(([que, f, n, p, fijo, esperado], i) => {
      const r = res.aMano[i];
      if (r.app !== esperado || r.oraculo !== esperado || reglaPagoHora(f, n, p, fijo) !== esperado) malos.push({ que, app: r.app, oraculo: r.oraculo, esperado });
    });
    res.lote.forEach((r, i) => {
      const c = lote[i];
      const pagoHora = reglaPagoHora(c.fam, c.nineraId, c.precios, c.pagoFijo);
      const h = reglaHoras({ ...c.horario, familia: c.fam });
      const cobroH = Number(c.fam.cobro_hora) || 0;
      const regla = { pagoHora, precio: { cobro: h && cobroH ? reglaRedondeo(cobroH * h.cobro, true) : null, pago: h && pagoHora ? reglaRedondeo(pagoHora * h.real, false) : null } };
      if (!igual(r.app, r.oraculo) || !igual(r.app, regla)) malos.push({ caso: c, app: r.app, oraculo: r.oraculo, regla });
    });
    sinDiferencias(malos, 'pagos por hora de la niñera');
    anotarCasos(aMano.length + lote.length, 'pagos por hora de la niñera');
    verificarLimpio(e);
  });

  test('la prueba SQL de paridad está al día con el oráculo y la semilla', () => {
    // Si cambia el oráculo o el generador, hay que volver a generarla: node scripts/paridad-plata-sql.js
    const enRepo = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'pruebas', 'paridad_plata.sql'), 'utf8');
    expect(enRepo === generarSQL(), 'supabase/pruebas/paridad_plata.sql está desactualizada: node scripts/paridad-plata-sql.js').toBe(true);
  });
});
