// Simulación compartida de las RPC de la app de niñeras (fase 1, 26/10/2026).
//
// abrirAppNinera (app.js) registra estas funciones en estado.rpc antes de abrir la página, y cada
// test puede pisar la que necesite (estado.rpc.ninera_actual = () => null) o hacerla fallar con
// estado.fallar (recibe {tabla: 'rpc/<nombre>', ...}). Cada tarea siguiente suma acá las RPC de la
// niñera que usa, imitando lo que hace la función SQL real (supabase/migraciones) sobre la base
// ficticia `db`: mismos argumentos y misma forma de la respuesta. Nada de esto llega a la base real.

// Un "raise exception" de la función SQL (27/10/2026): PostgREST lo devuelve como 400 con el
// código P0001 y el texto de la excepción en message. Una simulación lo tira con
// `throw errorRpc('sin_zonas')` y app.js responde ese error, como Supabase.
function errorRpc(message, { status = 400, code = 'P0001' } = {}) {
  const e = new Error(message);
  e.rpc = { status, code, message };
  return e;
}

// "Hoy" en Montevideo del reloj fijo del test (como hoy_mvd() en la base): la simulación corre
// en Node, que no ve el reloj del navegador.
function fechaMontevideo(ahora) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ahora));
}
function sumarDias(fechaISO, dias) {
  const d = new Date(fechaISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
// Años cumplidos entre dos fechas 'AAAA-MM-DD', como extract(year from age(hasta, desde)):
// negativo si desde es posterior.
function anosEntre(desde, hasta) {
  if (desde > hasta) return -anosEntre(hasta, desde);
  const [a1, m1, d1] = desde.split('-').map(Number);
  const [a2, m2, d2] = hasta.split('-').map(Number);
  return a2 - a1 - ((m2 < m1 || (m2 === m1 && d2 < d1)) ? 1 : 0);
}
// madre_nombre_inicial(): "María Pérez" → "María P.", una palabra queda igual, vacío → "la familia".
function madreNombreInicial(nombre) {
  const p = String(nombre ?? '').split(/\s+/).filter(Boolean);
  if (!p.length) return 'la familia';
  if (p.length === 1) return p[0];
  return `${p[0]} ${Array.from(p[p.length - 1])[0]}.`;
}
// chicos_texto(): "2 chicos (3 y 5 años)" desde hijos_familia; sin hijos, familias.ninos recortado a
// 80; sin nada, null.
function chicosTexto(db, familiaId, hoy) {
  const hijos = (db.hijos_familia || []).filter(h => familiaId && h.familia_id === familiaId)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  if (!hijos.length) {
    const ninos = (db.familias || []).find(f => f.id === familiaId)?.ninos;
    if (ninos == null) return null;
    const texto = Array.from(String(ninos).replace(/^ +| +$/g, '')).slice(0, 80).join('');
    return texto || null;
  }
  const n = hijos.length;
  const edades = hijos.map(h => {
    if (h.fecha_nacimiento) return anosEntre(h.fecha_nacimiento, hoy);
    if (h.edad_declarada != null) return h.edad_declarada + Math.max(0, h.edad_declarada_en ? anosEntre(h.edad_declarada_en, hoy) : 0);
    return null;
  }).filter(x => x !== null);
  if (!edades.length) return `${n} ${n === 1 ? 'chico' : 'chicos'}`;
  let partes;
  if (edades.includes(0)) {
    partes = edades.map(x => x === 0 ? 'menos de 1 año' : x === 1 ? '1 año' : `${x} años`);
  } else {
    partes = edades.map(String);
    partes[partes.length - 1] += (edades.length === 1 && edades[0] === 1) ? ' año' : ' años';
  }
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
  return `${n} ${n === 1 ? 'chico' : 'chicos'} (${lista})`;
}
// order by hora_inicio: en Postgres, sin hora va al final del día.
function horaParaOrdenar(s) { return s.hora_inicio == null ? '99' : String(s.hora_inicio); }
const TIPOS_PERFIL = ['Niñera', 'Traslados', 'Ambas'];

// Lo que suma la migración de la etapa 2 (20261027_perfil_ninera.sql). Con baseSinMigrar,
// abrirAppNinera responde estas RPC como Supabase cuando la función no existe (404 PGRST202) y
// abrirApp / abrirAppNinera sacan las columnas de las filas de ninieras.
const RPC_ETAPA_2 = ['ninera_mi_perfil', 'ninera_zonas_disponibles', 'ninera_guardar_perfil', 'ninera_mis_sittings'];
const COLUMNAS_NINIERAS_ETAPA_2 = ['perfil_app_en', 'perfil_actualizado_en', 'foto_propuesta_ruta', 'foto_propuesta_en'];
function rpcNoExiste(nombre) {
  return () => { throw errorRpc(`Could not find the function public.${nombre} in the schema cache`, { status: 404, code: 'PGRST202' }); };
}

// ahora: el reloj fijo del test (ISO con zona), para "hoy" y para el now() de los guardados.
function rpcNinera(db, nineraId, ahora = new Date().toISOString()) {
  const hoy = fechaMontevideo(ahora);
  const ahoraISO = new Date(ahora).toISOString();
  const miFila = () => (db.ninieras || []).find(n => n.id === nineraId);
  return {
    // La niñera de la sesión (ninieras.user_id = auth.uid()).
    ninera_actual: () => nineraId,
    es_ninera: () => true,
    // Primera vez que abre la app instalada: la fecha que queda en app_activada_en.
    ninera_activar_app: () => '2026-10-04T15:00:00+00:00',
    // Link de invitación (lo pide el panel de admins): un token ficticio de 64 caracteres.
    crear_invitacion_ninera: (cuerpo) => [{ token: 'a'.repeat(64), vence_en: '2026-10-11T15:00:00+00:00', es_reset: false }],

    // Etapa 2 (27/10/2026), migración 20261027_perfil_ninera.sql.
    // Su fila con las columnas de ninera_mi_perfil() (datos bancarios incluidos: es la propia).
    ninera_mi_perfil: () => {
      const n = miFila();
      if (!n) return [];
      const columnas = ['id', 'nombre', 'telefono', 'tipo', 'zona', 'barrios', 'cuenta_bancaria', 'foto', 'foto_propuesta_ruta',
        'foto_propuesta_en', 'perfil_app_en', 'perfil_actualizado_en', 'app_activada_en'];
      return [Object.fromEntries(columnas.map(c => [c, n[c] ?? null]))];
    },
    ninera_zonas_disponibles: () => nineraId ? (db.zona_grupos || []).slice()
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.nombre).localeCompare(String(b.nombre)))
      .map(z => ({ id: z.id, nombre: z.nombre, orden: z.orden, fuera_de_montevideo: z.fuera_de_montevideo })) : [],
    // Valida todo antes de escribir, en el mismo orden que la SQL; devuelve null.
    ninera_guardar_perfil: (cuerpo = {}) => {
      const { p_tipo, p_zonas, p_cuenta } = cuerpo;
      const pFotoRuta = cuerpo.p_foto_ruta ?? null;
      if (!nineraId) throw errorRpc('no_autorizada');
      if (!TIPOS_PERFIL.includes(p_tipo)) throw errorRpc('tipo_invalido');
      if (!Array.isArray(p_zonas) || !p_zonas.length) throw errorRpc('sin_zonas');
      const nombresZonas = (db.zona_grupos || []).map(z => z.nombre);
      if (p_zonas.some(z => !nombresZonas.includes(z))) throw errorRpc('zona_desconocida');
      if (pFotoRuta !== null && pFotoRuta !== `fotos/${nineraId}/propuesta.jpg`) throw errorRpc('foto_invalida');
      const cuenta = (p_cuenta || []).filter(l => l != null)
        .map(l => String(l).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')).filter(l => l !== '')
        .map(l => Array.from(l).slice(0, 120).join(''));
      // Tope de 10 cuentas después de sacar los renglones vacíos, como la SQL (27/10/2026).
      if (cuenta.length > 10) throw errorRpc('demasiadas_cuentas');
      const n = miFila();
      if (n) {
        Object.assign(n, {
          tipo: p_tipo,
          zona: [...new Set(p_zonas)].join('/'),
          cuenta_bancaria: cuenta.length ? cuenta : null,
          perfil_app_en: n.perfil_app_en ?? ahoraISO,
          perfil_actualizado_en: ahoraISO,
          foto_propuesta_ruta: pFotoRuta ?? n.foto_propuesta_ruta ?? null,
          foto_propuesta_en: pFotoRuta !== null ? ahoraISO : (n.foto_propuesta_en ?? null),
        });
      }
      return null;
    },
    // De hoy a 60 días, sin cancelados, previstos y confirmados; nunca montos ni notas. La
    // dirección (y origen / destino) solo si está confirmado. estado vacío = 'confirmado', el
    // default de la columna.
    ninera_mis_sittings: () => {
      const hasta = sumarDias(hoy, 60);
      return (db.sittings_traslados || [])
        .map(s => ({ ...s, estado: s.estado ?? 'confirmado' }))
        .filter(s => nineraId && s.ninera_id === nineraId && !s.cancelado && ['previsto', 'confirmado'].includes(s.estado)
          && s.fecha >= hoy && s.fecha <= hasta)
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || horaParaOrdenar(a).localeCompare(horaParaOrdenar(b)))
        .map(s => {
          const f = (db.familias || []).find(x => x.id === s.familia_id) || null;
          const confirmado = s.estado === 'confirmado';
          return {
            id: s.id, tipo: s.tipo, fecha: s.fecha, hora_inicio: s.hora_inicio ?? null, hora_fin: s.hora_fin ?? null,
            termina_dia_siguiente: !!s.termina_dia_siguiente, estado: s.estado,
            zona: f ? f.zona ?? null : null,
            madre: madreNombreInicial(f && f.nombre != null ? f.nombre : s.familia_nombre),
            direccion: confirmado && f ? f.direccion ?? null : null,
            origen: confirmado ? s.origen ?? null : null,
            destino: confirmado ? s.destino ?? null : null,
            chicos: chicosTexto(db, f ? f.id : null, hoy),
            notas_para_ninera: null,
          };
        });
    },
  };
}

module.exports = { rpcNinera, errorRpc, rpcNoExiste, RPC_ETAPA_2, COLUMNAS_NINIERAS_ETAPA_2 };
