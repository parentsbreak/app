// Datos ficticios, sin claves reales ni llamadas a YCloud/Supabase.
import { strict as assert } from "node:assert";
import {
  crearReceptor,
  type Evento,
  firmaValida,
  MAX_ANTIGUEDAD_SEGUNDOS,
  MAX_BYTES,
} from "./recepcion.ts";

const AHORA = Date.parse("2026-11-04T15:00:00Z");
const SECRETO = "secreto-ficticio-solo-para-tests";
const evento = (id = "evento-prueba") => ({
  id,
  type: "whatsapp.inbound_message.received",
  apiVersion: "v2",
  createTime: "2026-11-04T14:59:00Z",
  whatsappInboundMessage: {
    id: "mensaje-prueba",
    wamid: "wamid.prueba",
    wabaId: "waba-prueba",
    type: "text",
    text: { body: "Pedido ficticio" },
  },
});
async function firmar(cuerpo: string, tiempo = Math.floor(AHORA / 1000)) {
  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRETO),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      clave,
      new TextEncoder().encode(tiempo + "." + cuerpo),
    ),
  );
  return `t=${tiempo},s=${
    Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")
  }`;
}
async function peticion(dato: unknown = evento(), tiempo?: number) {
  const cuerpo = typeof dato === "string" ? dato : JSON.stringify(dato);
  return new Request("https://ejemplo.test/webhook", {
    method: "POST",
    body: cuerpo,
    headers: { "YCloud-Signature": await firmar(cuerpo, tiempo) },
  });
}
function simular() {
  const guardados: Evento[] = [];
  const cfg = { activo: true, secreto: SECRETO, wabas: ["waba-prueba"] };
  let fallar = false;
  const recibir = crearReceptor({
    config: () => cfg,
    ahora: () => AHORA,
    guardar: async (e) => {
      if (fallar) {
        throw new Error("Datos privados no deben salir en la respuesta");
      }
      guardados.push(e);
    },
  });
  return {
    recibir,
    guardados,
    cfg,
    fallar: () => {
      fallar = true;
    },
  };
}

Deno.test("guarda el evento exacto antes de responder éxito", async () => {
  const s = simular();
  assert.equal((await s.recibir(await peticion())).status, 200);
  assert.deepEqual(s.guardados, [evento()]);
});
Deno.test("apagado, sin secreto o sin cuentas permitidas: falla cerrado", async () => {
  for (const cambios of [{ activo: false }, { secreto: "" }, { wabas: [] }]) {
    const s = simular();
    Object.assign(s.cfg, cambios);
    assert.equal((await s.recibir(await peticion())).status, 503);
    assert.equal(s.guardados.length, 0);
  }
});
Deno.test("sin firma, firma falsa y cuerpo alterado nunca escriben", async () => {
  const s = simular();
  const cuerpo = JSON.stringify(evento());
  for (const firma of ["", "t=1,s=falsa", await firmar(cuerpo + " ")]) {
    const req = new Request("https://ejemplo.test/webhook", {
      method: "POST",
      body: cuerpo,
      headers: { "YCloud-Signature": firma },
    });
    assert.equal((await s.recibir(req)).status, 401);
  }
  assert.equal(s.guardados.length, 0);
});
Deno.test("firma preserva bytes UTF-8 y espacios: no se firma JSON reserializado", async () => {
  const s = simular();
  const dato = evento();
  dato.whatsappInboundMessage.text.body = "¿Mañana? Niños.";
  assert.equal(
    (await s.recibir(await peticion(JSON.stringify(dato, null, 2)))).status,
    200,
  );
});
Deno.test("reintento tardío firmado se admite, firma antigua o futura se rechaza", async () => {
  const s = simular();
  const t = Math.floor(AHORA / 1000);
  assert.equal(
    (await s.recibir(await peticion(evento(), t - 6 * 3600))).status,
    200,
  );
  assert.equal(
    (await s.recibir(await peticion(evento(), t - MAX_ANTIGUEDAD_SEGUNDOS - 1)))
      .status,
    401,
  );
  assert.equal(
    (await s.recibir(await peticion(evento(), t + 301))).status,
    401,
  );
});
Deno.test("rotación de firmas y timestamp ambiguo", async () => {
  const cuerpo = JSON.stringify(evento());
  const bytes = new TextEncoder().encode(cuerpo);
  const firma = await firmar(cuerpo);
  assert(
    await firmaValida(bytes, firma + ",s=" + "0".repeat(64), SECRETO, AHORA),
  );
  assert(!await firmaValida(bytes, firma + ",t=1", SECRETO, AHORA));
});
Deno.test("firma válida pero JSON, versión, fecha o mensaje inválidos: no escribe", async () => {
  for (
    const dato of ["{", [], { ...evento(), apiVersion: "v3" }, {
      ...evento(),
      createTime: "sin-fecha",
    }, { ...evento(), whatsappInboundMessage: null }]
  ) {
    const s = simular();
    assert.equal((await s.recibir(await peticion(dato))).status, 400);
    assert.equal(s.guardados.length, 0);
  }
});
Deno.test("otra WABA no puede ingresar eventos", async () => {
  const s = simular();
  const dato = evento();
  dato.whatsappInboundMessage.wabaId = "otra-waba";
  assert.equal((await s.recibir(await peticion(dato))).status, 403);
  assert.equal(s.guardados.length, 0);
});
Deno.test("historial, ecos y productos ajenos no alimentan el ingreso", async () => {
  for (
    const tipo of [
      "whatsapp.history",
      "whatsapp.business_app_message.received",
      "sms.inbound.received",
    ]
  ) {
    const s = simular();
    assert.equal(
      (await s.recibir(await peticion({ ...evento(), type: tipo }))).status,
      200,
    );
    assert.equal(s.guardados.length, 0);
  }
});
Deno.test("estados salientes se conservan, sin interpretar ni enviar", async () => {
  const s = simular();
  const dato = {
    id: "estado-prueba",
    type: "whatsapp.message.updated",
    apiVersion: "v2",
    createTime: evento().createTime,
    whatsappMessage: {
      id: "salida-prueba",
      wabaId: "waba-prueba",
      status: "delivered",
    },
  };
  assert.equal((await s.recibir(await peticion(dato))).status, 200);
  assert.deepEqual(s.guardados, [dato]);
});
Deno.test("estado oficial sin WABA se conserva sin atribuir una cuenta; entrada sin WABA se rechaza", async () => {
  const s = simular();
  const estado = {
    id: "estado-sin-waba",
    type: "whatsapp.message.updated",
    apiVersion: "v2",
    createTime: evento().createTime,
    whatsappMessage: { id: "salida-prueba", status: "delivered" },
  };
  assert.equal((await s.recibir(await peticion(estado))).status, 200);
  assert.deepEqual(s.guardados, [estado]);
  const entrada = evento();
  delete (entrada.whatsappInboundMessage as Partial<
    typeof entrada.whatsappInboundMessage
  >).wabaId;
  assert.equal((await s.recibir(await peticion(entrada))).status, 400);
});
Deno.test("fallo de base devuelve error reintentable, sin filtrar detalles", async () => {
  const s = simular();
  s.fallar();
  const res = await s.recibir(await peticion());
  assert.equal(res.status, 503);
  assert(!(await res.text()).includes("Datos privados"));
});
Deno.test("un cuerpo grande sin Content-Length también se corta", async () => {
  const s = simular();
  const req = new Request("https://ejemplo.test/webhook", {
    method: "POST",
    body: "x".repeat(MAX_BYTES + 1),
  });
  assert.equal((await s.recibir(req)).status, 413);
  assert.equal(s.guardados.length, 0);
});
Deno.test("no acepta GET ni handshake de Meta", async () => {
  const s = simular();
  assert.equal(
    (await s.recibir(
      new Request("https://ejemplo.test/webhook?hub.challenge=prueba"),
    )).status,
    405,
  );
});
