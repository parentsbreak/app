// Ingreso solamente: no llama a IA, no crea pedidos ni envía mensajes.
// Firma oficial: HMAC-SHA256(timestamp + "." + cuerpo exacto).
export const MAX_BYTES = 1024 * 1024;
// YCloud reintenta durante varias horas. No presuponemos que vuelva a firmar cada intento.
// IDs únicos en Postgres impiden reprocesar un evento firmado repetido.
export const MAX_ANTIGUEDAD_SEGUNDOS = 8 * 60 * 60;
const MAX_ADELANTO_SEGUNDOS = 300;
const TIPOS = ["whatsapp.inbound_message.received", "whatsapp.message.updated"];

export type Config = { activo: boolean; secreto?: string; wabas: string[] };
export type Evento = {
  id: string;
  type: string;
  apiVersion: string;
  createTime: string;
  [campo: string]: unknown;
};
export type Deps = {
  config: () => Config;
  ahora: () => number;
  guardar: (evento: Evento) => Promise<void>;
};

const objeto = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const identificador = (x: unknown) =>
  typeof x === "string" && x.trim() === x && x.length > 0 && x.length <= 512;

export async function firmaValida(
  cuerpo: Uint8Array,
  encabezado: string | null,
  secreto: string,
  ahora: number,
): Promise<boolean> {
  if (!encabezado || encabezado.length > 1024) return false;
  const partes = encabezado.split(",").map((p) => p.trim().split("="));
  const tiempos = partes.filter((p) => p[0] === "t");
  const firmas = partes.filter((p) => p[0] === "s");
  if (
    tiempos.length !== 1 || tiempos[0].length !== 2 ||
    !/^\d{1,12}$/.test(tiempos[0][1])
  ) return false;
  const tiempo = Number(tiempos[0][1]);
  const diferencia = Math.floor(ahora / 1000) - tiempo;
  if (
    !Number.isSafeInteger(tiempo) || diferencia > MAX_ANTIGUEDAD_SEGUNDOS ||
    diferencia < -MAX_ADELANTO_SEGUNDOS
  ) return false;
  const prefijo = new TextEncoder().encode(tiempos[0][1] + ".");
  const firmado = new Uint8Array(prefijo.length + cuerpo.length);
  firmado.set(prefijo);
  firmado.set(cuerpo, prefijo.length);
  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  for (const parte of firmas) {
    if (parte.length !== 2 || !/^[a-f\d]{64}$/i.test(parte[1])) continue;
    const firma = Uint8Array.from(
      parte[1].match(/../g)!,
      (h) => parseInt(h, 16),
    );
    if (await crypto.subtle.verify("HMAC", clave, firma, firmado)) return true;
  }
  return false;
}

// Límite también sin Content-Length: no acumula un cuerpo arbitrario en memoria.
async function leerCuerpo(req: Request): Promise<Uint8Array | null> {
  if (Number(req.headers.get("content-length")) > MAX_BYTES) return null;
  const lector = req.body?.getReader();
  if (!lector) return new Uint8Array();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        await lector.cancel();
        return null;
      }
      partes.push(value);
    }
  } finally {
    lector.releaseLock();
  }
  const cuerpo = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    cuerpo.set(p, pos);
    pos += p.length;
  }
  return cuerpo;
}

function respuesta(status: number, error?: string) {
  return new Response(JSON.stringify(error ? { error } : { ok: true }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function crearReceptor(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return respuesta(405, "Solo POST");
    const cfg = deps.config();
    // Apagado por defecto; no necesita la API key saliente de YCloud.
    if (!cfg.activo || !cfg.secreto || !cfg.wabas.length) {
      return respuesta(503, "Recepción no configurada");
    }
    let cuerpo: Uint8Array;
    try {
      const leido = await leerCuerpo(req);
      if (leido === null) return respuesta(413, "Evento demasiado grande");
      cuerpo = leido;
    } catch {
      return respuesta(400, "No se pudo leer el evento");
    }
    if (
      !await firmaValida(
        cuerpo,
        req.headers.get("YCloud-Signature"),
        cfg.secreto,
        deps.ahora(),
      )
    ) return respuesta(401, "Firma inválida");
    let evento: unknown;
    try {
      evento = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(cuerpo),
      );
    } catch {
      return respuesta(400, "JSON inválido");
    }
    if (
      !objeto(evento) || !identificador(evento.id) ||
      typeof evento.type !== "string"
    ) return respuesta(400, "Evento inválido");
    // No alimentar la cola con importaciones históricas, ecos o eventos de otros productos.
    if (!TIPOS.includes(evento.type)) return respuesta(200);
    if (
      evento.apiVersion !== "v2" || typeof evento.createTime !== "string" ||
      !Number.isFinite(Date.parse(evento.createTime))
    ) return respuesta(400, "Versión o fecha inválida");
    const mensaje = evento[
      evento.type === TIPOS[0] ? "whatsappInboundMessage" : "whatsappMessage"
    ];
    if (!objeto(mensaje) || !identificador(mensaje.id)) {
      return respuesta(400, "Mensaje inválido");
    }
    const entrante = evento.type === TIPOS[0];
    // Los ejemplos oficiales de estados no siempre traen wabaId. Se conservan sin
    // asociar: un procesador futuro deberá vincularlos a una salida conocida, nunca a un pedido.
    if (
      (entrante || mensaje.wabaId != null) && !identificador(mensaje.wabaId)
    ) return respuesta(400, "Cuenta inválida");
    if (mensaje.wamid != null && !identificador(mensaje.wamid)) {
      return respuesta(400, "Identificador inválido");
    }
    if (
      mensaje.wabaId != null && !cfg.wabas.includes(mensaje.wabaId as string)
    ) return respuesta(403, "Cuenta no habilitada");
    try {
      await deps.guardar(evento as Evento);
    } catch {
      // Nunca imprimir la excepción: podría traer cuerpo, teléfonos o claves del proveedor.
      return respuesta(503, "No se pudo guardar; reintentar");
    }
    return respuesta(200);
  };
}
