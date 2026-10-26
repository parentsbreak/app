// Lógica de ninera-cuenta (26/10/2026, fase 1): alta y cambio de contraseña de la cuenta de una
// niñera desde el link de invitación. Sin red: la base y Auth llegan en Deps (index.ts las
// conecta), así se prueba entera con dependencias de mentira (cuenta_test.ts).
//
// La niñera entra con su celular y una contraseña; por dentro, Supabase Auth guarda un mail
// sintético armado con el celular normalizado (docs de la fase 1, 4.1 y 5.2). Quien llama todavía
// no tiene cuenta: la credencial es el token del link (64 hex, lo genera crear_invitacion_ninera).
// Por eso las respuestas dicen lo mínimo: nunca el celular completo, el mail ni la contraseña.

// Tiene que ser igual a mail_sintetico_ninera() en la base (migración 20261026_cuentas_ninieras)
// y a MAIL_DOMINIO_NINERA en js/comun.js: si no, la app arma un mail y la cuenta tiene otro.
// `.invalid` es un dominio reservado que nunca va a existir: nadie recibe esos mails.
export const MAIL_DOMINIO_NINERA = "ninieras.parentsbreak.invalid";
// Mínimo de la contraseña (textos de la app de niñeras, sección 3).
export const MIN_PASSWORD = 8;

const ERROR_INTERNO = "No se pudo crear la cuenta: avisale a Diego";

// Celular uruguayo normalizado a '598' + 8 dígitos que empiezan en 9, o null. La misma regla que
// normalizar_celular() en la base y normalizarCelular() en js/comun.js, con los mismos 11 casos de
// prueba: si cambia una, cambian las tres. Solo dígitos; se quita un 00 inicial; si empieza en
// 598, la parte local es el resto; de la parte local se quita un 0 inicial.
export function normalizarCelular(s: unknown): string | null {
  const digitos = (typeof s === "string" ? s : "").replace(/[^0-9]/g, "").replace(/^00/, "");
  const local = (digitos.startsWith("598") ? digitos.slice(3) : digitos).replace(/^0/, "");
  return /^9[0-9]{7}$/.test(local) ? "598" + local : null;
}

export function mailSintetico(celular: unknown): string | null {
  const n = normalizarCelular(celular);
  return n ? `${n}@${MAIL_DOMINIO_NINERA}` : null;
}

// La invitación con los datos de la ficha que hacen falta (join con ninieras en index.ts).
export type Invitacion = {
  id: string;
  ninera_id: string;
  nombre: string;
  telefono: string | null;
  user_id: string | null;
  activa: boolean;
  vence_en: string;
  usada_en: string | null;
  reemplazada_en: string | null;
};

export type Deps = {
  buscarInvitacion(token: string): Promise<Invitacion | null>;
  // Crea la cuenta de Auth ya confirmada y devuelve su id.
  crearUsuario(email: string, password: string, nineraId: string): Promise<string>;
  // Cambio de contraseña: también el mail, por si la admin le cambió el celular en la ficha.
  actualizarUsuario(userId: string, cambios: { password: string; email: string }): Promise<void>;
  vincular(nineraId: string, userId: string): Promise<void>;
  marcarUsada(invitacionId: string): Promise<void>;
  ahora(): Date;
};

export type Respuesta = { status: number; cuerpo: Record<string, unknown> };

// POST {token} → datos para la bienvenida; POST {token, password} → crea la cuenta (o le cambia
// la contraseña si ya tenía) y devuelve el celular normalizado para que la app entre sola.
export async function procesarCuenta(deps: Deps, entrada: { token?: unknown; password?: unknown }): Promise<Respuesta> {
  const { token, password } = entrada;
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return { status: 400, cuerpo: { error: "token" } };
  try {
    const inv = await deps.buscarInvitacion(token);
    if (!inv) return { status: 404, cuerpo: { error: "no_existe" } };
    // Solo el último link de cada niñera sirve, una sola vez y hasta que vence (fase 1, 5.2).
    if (inv.usada_en || inv.reemplazada_en || new Date(inv.vence_en).getTime() <= deps.ahora().getTime()) {
      return { status: 410, cuerpo: { error: "vencido" } };
    }
    if (inv.activa === false) return { status: 403, cuerpo: { error: "inactiva" } };

    const celular = normalizarCelular(inv.telefono);
    if (password === undefined) {
      return {
        status: 200,
        cuerpo: {
          nombre: (inv.nombre || "").trim().split(/\s+/)[0],
          celular_mascarado: celular ? "••• " + celular.slice(-3) : "•••",
          es_reset: inv.user_id !== null,
        },
      };
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD) return { status: 400, cuerpo: { error: "password_corta" } };
    // crear_invitacion_ninera ya no deja invitar con un celular que no normaliza, pero la admin
    // pudo cambiarlo después de mandar el link.
    if (!celular) return { status: 409, cuerpo: { error: "celular_invalido" } };
    const email = `${celular}@${MAIL_DOMINIO_NINERA}`;

    if (inv.user_id === null) {
      const userId = await deps.crearUsuario(email, password, inv.ninera_id);
      await deps.vincular(inv.ninera_id, userId);
    } else {
      await deps.actualizarUsuario(inv.user_id, { password, email });
    }
    await deps.marcarUsada(inv.id);
    return { status: 200, cuerpo: { celular } };
  } catch {
    // El detalle lo anota index.ts (console.error), sin la contraseña.
    return { status: 500, cuerpo: { error: ERROR_INTERNO } };
  }
}
