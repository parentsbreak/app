// Lógica de enviar-avisos (29/10/2026, fase 1, etapa 3): manda por push los avisos de la cola
// (tabla avisos). Sin red: la base y el push llegan en Deps (index.ts los conecta), así se prueba
// entera con dependencias de mentira (envio_test.ts).
//
// Cada tanda reclama hasta 50 avisos con reclamar_avisos(): el reclamo ya los marca enviados y
// suma un intento, así el trigger de disparo inmediato y el cron de cada minuto nunca mandan dos
// veces lo mismo (migración 20261029_avisos_chat). Después se reparte:
//   - a una niñera: los dispositivos de su cuenta (push_subscriptions.user_id = ninieras.user_id),
//     solo si está activa (a una dada de baja no le llega nada, aunque tenga la app instalada);
//   - a 'todas' o al mail de una admin: los dispositivos de admins (user_id vacío) de las cuentas
//     activas (admins_activas_mails), sin la de datos.excepto (la que escribió no se avisa a sí
//     misma) y solo si no apagó ese tipo en notif_push_preferencias (sin fila: prendido).
// Una suscripción vencida (404/410) se borra y no frena las demás. Si había dispositivos y no llegó
// a ninguno por otro error, el aviso vuelve a la cola a los 2 minutos, hasta 3 intentos; después
// queda con el error anotado. Sin dispositivos no es error: la niñera lo ve en su lista de avisos.

// Lo que reclama cada tanda (reclamar_avisos(p_max)). 50 por minuto sobra: son pocas niñeras.
export const MAX_RECLAMO = 50;
// Intentos de push de un aviso antes de dejarlo con error (decisiones 5.4, revisión del plan).
export const INTENTOS_MAX = 3;
// Espera antes de reintentar un aviso que no llegó a ningún dispositivo.
export const REINTENTO_MS = 2 * 60 * 1000;
// Largo máximo del error que se anota en avisos.error.
const MAX_ERROR = 300;

// Una fila de public.avisos (la devuelve reclamar_avisos con intentos ya sumado).
export type Aviso = {
  id: string;
  clave: string;
  para_ninera_id: string | null;
  para_admin: string | null;
  tipo: string;
  titulo: string;
  cuerpo: string | null;
  url: string | null;
  datos: Record<string, unknown> | null;
  enviar_desde: string;
  enviado_en: string | null;
  error: string | null;
  intentos: number;
  leido_en: string | null;
  creado_en: string;
};

// Una fila de push_subscriptions (usuario: el mail de la cuenta que la guardó).
export type Suscripcion = { id: string; usuario: string; endpoint: string; p256dh: string; auth_key: string };
// La de un dispositivo de niñera, con su ficha: ninera_id y si está activa.
export type SuscripcionNinera = Suscripcion & { ninera_id: string; ninera_activa: boolean };
export type Preferencia = { usuario: string; tipo: string; activado: boolean };

export type Deps = {
  reclamar(max: number): Promise<Aviso[]>;
  // Los dispositivos de esas niñeras que tienen cuenta (ninieras.user_id), con si están activas.
  suscripcionesNineraPorId(nineraIds: string[]): Promise<SuscripcionNinera[]>;
  // Los dispositivos de admins (push_subscriptions.user_id vacío).
  suscripcionesAdmins(): Promise<Suscripcion[]>;
  mailsAdminsActivas(): Promise<string[]>;
  preferencias(usuarios: string[]): Promise<Preferencia[]>;
  // Tira el error de web-push (con statusCode si el servidor de push respondió).
  mandar(sub: Suscripcion, payload: string): Promise<void>;
  borrarSuscripcion(id: string): Promise<void>;
  // Anota el error; con reintentarDesde, además lo devuelve a la cola (enviado_en vacío).
  marcarError(id: string, error: string, reintentarDesde: Date | null): Promise<void>;
};

export type Resultado = {
  reclamados: number;
  // Avisos que llegaron al menos a un dispositivo. Los que no tenían ninguno no son enviados ni
  // fallidos: reclamados - enviados - fallidos.
  enviados: number;
  // Avisos que volvieron a la cola o quedaron con error.
  fallidos: number;
  // Suscripciones vencidas borradas.
  borradas: number;
};

const minuscula = (s: string) => s.trim().toLowerCase();

function statusDe(e: unknown): number | undefined {
  const s = (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === "number" ? s : undefined;
}

// Solo el código y el mensaje: el cuerpo de la respuesta del servidor de push no se anota (puede
// traer el endpoint, que es la credencial del dispositivo).
function textoError(e: unknown): string {
  const status = statusDe(e);
  const msg = e instanceof Error ? e.message : String(e);
  return ((status !== undefined ? `push ${status}: ` : "") + msg).slice(0, MAX_ERROR);
}

// Lo que ve el service worker (sw.js de las dos puertas): el mismo formato que enviar-push-urgentes.
// Nada de datos, clave ni destinatario: ningún aviso lleva plata ni datos de otros.
function payloadDe(a: Aviso): string {
  return JSON.stringify({ id: a.id, titulo: a.titulo, mensaje: a.cuerpo ?? "", url: a.url ?? null });
}

export async function procesarAvisos(deps: Deps, ahora: Date): Promise<Resultado> {
  const avisos = await deps.reclamar(MAX_RECLAMO);
  const res: Resultado = { reclamados: avisos.length, enviados: 0, fallidos: 0, borradas: 0 };
  if (!avisos.length) return res;

  const fallar = async (a: Aviso, error: string) => {
    res.fallidos++;
    const reintento = a.intentos < INTENTOS_MAX ? new Date(ahora.getTime() + REINTENTO_MS) : null;
    try {
      await deps.marcarError(a.id, error, reintento);
    } catch (e) {
      // Queda como enviado sin error: se pierde este aviso, pero no la tanda.
      console.error("enviar-avisos", "marcarError", { aviso: a.id, mensaje: textoError(e) });
    }
  };

  const deNinieras = avisos.filter((a) => a.para_ninera_id);
  const deAdmins = avisos.filter((a) => !a.para_ninera_id && a.para_admin);

  // ---- A quién: una búsqueda por tanda, nunca una por aviso. Si falla, esos avisos vuelven a la
  // cola (con el mismo tope de intentos) y los demás salen igual.
  const destinos = new Map<string, Suscripcion[]>();
  const sinBuscar = new Map<string, string>(); // aviso → error de la búsqueda

  if (deNinieras.length) {
    try {
      const ids = [...new Set(deNinieras.map((a) => a.para_ninera_id as string))];
      const subs = (await deps.suscripcionesNineraPorId(ids)).filter((s) => s.ninera_activa);
      for (const a of deNinieras) destinos.set(a.id, subs.filter((s) => s.ninera_id === a.para_ninera_id));
    } catch (e) {
      for (const a of deNinieras) sinBuscar.set(a.id, "buscar dispositivos de la niñera: " + textoError(e));
    }
  }

  if (deAdmins.length) {
    try {
      const [subs, mails] = await Promise.all([deps.suscripcionesAdmins(), deps.mailsAdminsActivas()]);
      const activas = new Set(mails.map(minuscula));
      const deActivas = subs.filter((s) => activas.has(minuscula(s.usuario)));
      const usuarios = [...new Set(deActivas.map((s) => s.usuario))];
      const apagadas = new Set(
        (usuarios.length ? await deps.preferencias(usuarios) : [])
          .filter((p) => p.activado === false).map((p) => minuscula(p.usuario) + "|" + p.tipo),
      );
      for (const a of deAdmins) {
        const para = minuscula(a.para_admin as string);
        const excepto = typeof a.datos?.excepto === "string" ? minuscula(a.datos.excepto) : null;
        destinos.set(a.id, deActivas.filter((s) => {
          const u = minuscula(s.usuario);
          return (para === "todas" || u === para) && u !== excepto && !apagadas.has(u + "|" + a.tipo);
        }));
      }
    } catch (e) {
      for (const a of deAdmins) sinBuscar.set(a.id, "buscar dispositivos de las admins: " + textoError(e));
    }
  }

  // ---- Mandar. Los avisos de a uno (en orden) y los dispositivos de cada aviso en paralelo. Una
  // suscripción vencida se borra una sola vez y no se vuelve a usar en el resto de la tanda.
  const vencidas = new Set<string>();
  for (const a of avisos) {
    const errorBusqueda = sinBuscar.get(a.id);
    if (errorBusqueda) { await fallar(a, errorBusqueda); continue; }
    const subs = (destinos.get(a.id) ?? []).filter((s) => !vencidas.has(s.id));
    if (!subs.length) continue;

    const payload = payloadDe(a);
    const resultados = await Promise.allSettled(subs.map((s) => deps.mandar(s, payload)));
    let llegaron = 0;
    let otroError: unknown = null;
    for (let i = 0; i < subs.length; i++) {
      const r = resultados[i];
      if (r.status === "fulfilled") { llegaron++; continue; }
      const status = statusDe(r.reason);
      if (status === 404 || status === 410) {
        vencidas.add(subs[i].id);
        try {
          await deps.borrarSuscripcion(subs[i].id);
          res.borradas++;
        } catch (e) {
          console.error("enviar-avisos", "borrarSuscripcion", { mensaje: textoError(e) });
        }
      } else if (otroError === null) {
        otroError = r.reason;
      }
    }
    if (llegaron > 0) res.enviados++;
    // Solo vencidas: es como no tener dispositivos, no se reintenta.
    else if (otroError !== null) await fallar(a, textoError(otroError));
  }
  return res;
}
