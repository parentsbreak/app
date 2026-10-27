// Simulación compartida de las RPC de la app de niñeras (fase 1, 26/10/2026).
//
// abrirAppNinera (app.js) registra estas funciones en estado.rpc antes de abrir la página, y cada
// test puede pisar la que necesite (estado.rpc.ninera_actual = () => null). Cada tarea siguiente
// suma acá las RPC de la niñera que usa, imitando lo que hace la función SQL real
// (supabase/migraciones) sobre la base ficticia `db`: mismos argumentos y misma forma de la
// respuesta. Nada de esto llega a la base real.
function rpcNinera(db, nineraId) {
  return {
    // La niñera de la sesión (ninieras.user_id = auth.uid()).
    ninera_actual: () => nineraId,
    es_ninera: () => true,
    // Primera vez que abre la app instalada: la fecha que queda en app_activada_en.
    ninera_activar_app: () => '2026-10-04T15:00:00+00:00',
    // Link de invitación (lo pide el panel de admins): un token ficticio de 64 caracteres.
    crear_invitacion_ninera: (cuerpo) => [{ token: 'a'.repeat(64), vence_en: '2026-10-11T15:00:00+00:00', es_reset: false }],
  };
}

module.exports = { rpcNinera };
