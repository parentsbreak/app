// Tests de ninera-cuenta con la base y Auth SIMULADAS: nunca llaman a Supabase. Datos inventados.
// Se corren desde una carpeta fuera del repo (el package.json de la raíz confunde a Deno), por
// ejemplo: npx deno@2 test --allow-env <carpeta>/ninera-cuenta/
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1.0.13";
import {
  ERROR_PASSWORD_DEBIL, MAIL_DOMINIO_NINERA, mailSintetico, MIN_PASSWORD, normalizarCelular, procesarCuenta,
  type Deps, type Invitacion,
} from "./cuenta.ts";

const TOKEN = "a".repeat(32) + "0123456789abcdef0123456789abcdef";
const AHORA = new Date("2026-10-26T15:00:00Z");
const ERROR_500 = "No pudimos crear tu cuenta. Avisa al equipo de Parents' Break.";

function invitacion(cambios: Partial<Invitacion> = {}): Invitacion {
  return {
    id: "c0000000-0000-4000-8000-000000000001", ninera_id: "30000000-0000-4000-8000-000000000001",
    nombre: "Ana Ficticia", telefono: "099 000 001", user_id: null, activa: true,
    vence_en: "2026-11-02T15:00:00Z", usada_en: null, reemplazada_en: null, ...cambios,
  };
}

// Base y Auth de mentira: anotan qué se les pidió, cada una en su lista y todas en `orden`.
// marcarUsada pone usada_en en la invitación, como la base, para probar el mismo link dos veces;
// con yaMarcada devuelve false, como cuando otro pedido con el mismo link lo marcó antes.
// `falla` puede ser una lista (por ejemplo, vincular y también borrarUsuario) y `mensaje` cambia
// el error simulado (ERROR_PASSWORD_DEBIL, como cuando Auth no acepta la contraseña).
type Paso = keyof Omit<Deps, "ahora">;
function simulado(inv: Invitacion | null, falla?: Paso | Paso[], yaMarcada = false, mensaje?: string) {
  const llamadas = {
    buscar: [] as string[], crear: [] as unknown[][], actualizar: [] as unknown[][],
    vincular: [] as unknown[][], borrar: [] as string[], usada: [] as string[], orden: [] as string[],
  };
  const fallas: string[] = falla === undefined ? [] : Array.isArray(falla) ? falla : [falla];
  const fallar = (nombre: string) => {
    llamadas.orden.push(nombre);
    if (fallas.includes(nombre)) throw new Error(mensaje ?? `falla simulada en ${nombre}`);
  };
  const deps: Deps = {
    buscarInvitacion: async (token) => { llamadas.buscar.push(token); fallar("buscarInvitacion"); return inv ? { ...inv } : null; },
    crearUsuario: async (email, password, nineraId, nombre) => {
      llamadas.crear.push([email, password, nineraId, nombre]); fallar("crearUsuario");
      return "40000000-0000-4000-8000-000000000001";
    },
    actualizarUsuario: async (userId, cambios) => { llamadas.actualizar.push([userId, cambios]); fallar("actualizarUsuario"); },
    vincular: async (nineraId, userId) => { llamadas.vincular.push([nineraId, userId]); fallar("vincular"); },
    borrarUsuario: async (userId) => { llamadas.borrar.push(userId); fallar("borrarUsuario"); },
    marcarUsada: async (id) => {
      fallar("marcarUsada");
      if (yaMarcada) return false;
      llamadas.usada.push(id);
      if (inv) inv.usada_en = AHORA.toISOString();
      return true;
    },
    ahora: () => AHORA,
  };
  return { deps, llamadas };
}

// ------------------------------------------------------------ normalización (los 11 casos de la SQL)
Deno.test("normalizarCelular: los 11 casos de la prueba SQL", () => {
  const casos: [unknown, string | null][] = [
    ["+598 99 123 456", "59899123456"],
    ["099123456", "59899123456"],
    ["99123456", "59899123456"],
    ["099-123-456", "59899123456"],
    ["59899123456", "59899123456"],
    ["00598 99 123 456", "59899123456"],
    ["+598 099 123 456", "59899123456"],
    ["123", null],
    ["+54 11 5555 5555", null],
    ["", null],
    [null, null],
  ];
  for (const [entrada, esperado] of casos) assertEquals(normalizarCelular(entrada), esperado, String(entrada));
});

Deno.test("mailSintetico: celular normalizado y el dominio de siempre", () => {
  assertEquals(MAIL_DOMINIO_NINERA, "ninieras.parentsbreak.invalid");
  assertEquals(mailSintetico("099123456"), "59899123456@ninieras.parentsbreak.invalid");
  assertEquals(mailSintetico("123"), null);
  assertEquals(MIN_PASSWORD, 8);
});

// ------------------------------------------------------------ procesarCuenta, en el orden de los chequeos
Deno.test("sin token o con un token que no es de 64 hex: 400 y no busca nada", async () => {
  for (const token of [undefined, "", 123, "corto", "g".repeat(64), TOKEN + "a"]) {
    const { deps, llamadas } = simulado(invitacion());
    const r = await procesarCuenta(deps, { token });
    assertEquals(r, { status: 400, cuerpo: { error: "token" } }, String(token));
    assertEquals(llamadas.buscar, []);
  }
});

Deno.test("token que no existe: 404", async () => {
  const { deps, llamadas } = simulado(null);
  assertEquals(await procesarCuenta(deps, { token: TOKEN }), { status: 404, cuerpo: { error: "no_existe" } });
  assertEquals(llamadas.buscar, [TOKEN]);
});

Deno.test("link ya usado: 410", async () => {
  const { deps } = simulado(invitacion({ usada_en: "2026-10-25T12:00:00Z" }));
  assertEquals(await procesarCuenta(deps, { token: TOKEN }), { status: 410, cuerpo: { error: "vencido" } });
});

Deno.test("link reemplazado por uno más nuevo: 410", async () => {
  const { deps } = simulado(invitacion({ reemplazada_en: "2026-10-25T12:00:00Z" }));
  assertEquals(await procesarCuenta(deps, { token: TOKEN }), { status: 410, cuerpo: { error: "vencido" } });
});

Deno.test("link vencido (vence_en justo ahora o antes): 410 y no crea nada", async () => {
  for (const vence_en of [AHORA.toISOString(), "2026-10-20T00:00:00Z"]) {
    const { deps, llamadas } = simulado(invitacion({ vence_en }));
    assertEquals(await procesarCuenta(deps, { token: TOKEN, password: "clave1234" }), { status: 410, cuerpo: { error: "vencido" } });
    assertEquals(llamadas.crear, []);
  }
});

Deno.test("niñera dada de baja: 403 y no crea la cuenta", async () => {
  const { deps, llamadas } = simulado(invitacion({ activa: false }));
  assertEquals(await procesarCuenta(deps, { token: TOKEN, password: "clave1234" }), { status: 403, cuerpo: { error: "inactiva" } });
  assertEquals(llamadas.crear, []);
});

Deno.test("sin contraseña: bienvenida con el primer nombre y el celular tapado, sin tocar nada", async () => {
  const { deps, llamadas } = simulado(invitacion());
  assertEquals(await procesarCuenta(deps, { token: TOKEN }), {
    status: 200, cuerpo: { nombre: "Ana", celular_mascarado: "••• 001", es_reset: false },
  });
  assertEquals([llamadas.crear, llamadas.actualizar, llamadas.vincular, llamadas.usada], [[], [], [], []]);
});

Deno.test("sin contraseña, con cuenta (reset) y celular que no normaliza: es_reset y '•••'", async () => {
  const { deps } = simulado(invitacion({ user_id: "40000000-0000-4000-8000-000000000009", telefono: "123", nombre: "  María José Ficticia " }));
  assertEquals(await procesarCuenta(deps, { token: TOKEN }), {
    status: 200, cuerpo: { nombre: "María", celular_mascarado: "•••", es_reset: true },
  });
});

Deno.test("contraseña corta o que no es texto: 400 y no crea nada", async () => {
  for (const password of ["1234567", "", 12345678, null, "        ", "  abc1234  "]) {
    const { deps, llamadas } = simulado(invitacion());
    assertEquals(await procesarCuenta(deps, { token: TOKEN, password }), { status: 400, cuerpo: { error: "password_corta" } }, String(password));
    assertEquals(llamadas.crear, []);
  }
});

Deno.test("celular de la ficha que no normaliza: 409 y no crea nada", async () => {
  const { deps, llamadas } = simulado(invitacion({ telefono: "+54 11 5555 5555" }));
  assertEquals(await procesarCuenta(deps, { token: TOKEN, password: "clave1234" }), { status: 409, cuerpo: { error: "celular_invalido" } });
  assertEquals(llamadas.crear, []);
  assertEquals(llamadas.usada, []);
});

Deno.test("alta: crea la cuenta con el mail sintético, la vincula y marca el link usado", async () => {
  const { deps, llamadas } = simulado(invitacion());
  const r = await procesarCuenta(deps, { token: TOKEN, password: "clave1234" });
  assertEquals(r, { status: 200, cuerpo: { celular: "59899000001" } });
  // El nombre de la ficha va a user_metadata (la app saluda con el primero).
  assertEquals(llamadas.crear, [["59899000001@ninieras.parentsbreak.invalid", "clave1234", "30000000-0000-4000-8000-000000000001", "Ana Ficticia"]]);
  assertEquals(llamadas.vincular, [["30000000-0000-4000-8000-000000000001", "40000000-0000-4000-8000-000000000001"]]);
  assertEquals(llamadas.usada, ["c0000000-0000-4000-8000-000000000001"]);
  assertEquals(llamadas.actualizar, []);
  // Primero la cuenta y recién al final la marca del link.
  assertEquals(llamadas.orden, ["buscarInvitacion", "crearUsuario", "vincular", "marcarUsada"]);
  // La respuesta no lleva la contraseña ni el mail (solo el celular normalizado, que es su usuario).
  const texto = JSON.stringify(r);
  assertFalse(texto.includes("clave1234"));
  assertFalse(texto.includes("@"));
});

Deno.test("reset: cambia la contraseña y el mail de la cuenta que ya existe, sin crear otra", async () => {
  const { deps, llamadas } = simulado(invitacion({ user_id: "40000000-0000-4000-8000-000000000009", telefono: "+598 99 000 002", nombre: " Bea Ficticia " }));
  const r = await procesarCuenta(deps, { token: TOKEN, password: "otraclave99" });
  assertEquals(r, { status: 200, cuerpo: { celular: "59899000002" } });
  // También el nombre (sin espacios alrededor) y el ninera_id, por si la admin corrigió la ficha.
  assertEquals(llamadas.actualizar, [["40000000-0000-4000-8000-000000000009", {
    password: "otraclave99", email: "59899000002@ninieras.parentsbreak.invalid",
    nineraId: "30000000-0000-4000-8000-000000000001", nombre: "Bea Ficticia",
  }]]);
  assertEquals(llamadas.usada, ["c0000000-0000-4000-8000-000000000001"]);
  assertEquals([llamadas.crear, llamadas.vincular], [[], []]);
  assertEquals(llamadas.orden, ["buscarInvitacion", "actualizarUsuario", "marcarUsada"]);
  assertFalse(JSON.stringify(r).includes("otraclave99"));
});

Deno.test("el mismo link dos veces: la segunda vez 410 y no crea otra cuenta", async () => {
  const { deps, llamadas } = simulado(invitacion());
  assertEquals((await procesarCuenta(deps, { token: TOKEN, password: "clave1234" })).status, 200);
  assertEquals(await procesarCuenta(deps, { token: TOKEN, password: "clave1234" }), { status: 410, cuerpo: { error: "vencido" } });
  assertEquals(await procesarCuenta(deps, { token: TOKEN }), { status: 410, cuerpo: { error: "vencido" } });
  assertEquals(llamadas.crear.length, 1);
});

Deno.test("contraseña con espacios alrededor: se guarda tal cual se escribió", async () => {
  const { deps, llamadas } = simulado(invitacion());
  assertEquals((await procesarCuenta(deps, { token: TOKEN, password: " clave1234 " })).status, 200);
  assertEquals(llamadas.crear[0][1], " clave1234 ");
});

Deno.test("si falla la base o Auth: 500 con el aviso, sin la contraseña", async () => {
  for (const falla of ["buscarInvitacion", "crearUsuario", "vincular", "marcarUsada"] as const) {
    const { deps, llamadas } = simulado(invitacion(), falla);
    const r = await procesarCuenta(deps, { token: TOKEN, password: "clave1234" });
    assertEquals(r, { status: 500, cuerpo: { error: ERROR_500 } }, falla);
    // Si la cuenta no se terminó de armar, el link no queda usado: sirve para reintentar.
    assertEquals(llamadas.usada, [], falla);
  }
  const { deps } = simulado(invitacion({ user_id: "40000000-0000-4000-8000-000000000009" }), "actualizarUsuario");
  assertEquals(await procesarCuenta(deps, { token: TOKEN, password: "clave1234" }), { status: 500, cuerpo: { error: ERROR_500 } });
});

// Dos pedidos con el mismo link al mismo tiempo: los dos pasan la vigencia y el que llega segundo
// a marcarlo recibe false. Que igual haya creado o cambiado la cuenta está bien: el primero ya hizo
// lo mismo con el mismo link (en el alta, el segundo createUser falla por mail repetido y da 500
// antes de llegar acá; en el reset, la contraseña que queda es la de uno de los dos pedidos de la
// misma niñera). Lo importante es que el segundo no responda como si hubiera entrado.
Deno.test("link marcado por otro pedido al mismo tiempo: 410, después de tocar la cuenta", async () => {
  const alta = simulado(invitacion(), undefined, true);
  assertEquals(await procesarCuenta(alta.deps, { token: TOKEN, password: "clave1234" }), { status: 410, cuerpo: { error: "vencido" } });
  assertEquals(alta.llamadas.orden, ["buscarInvitacion", "crearUsuario", "vincular", "marcarUsada"]);
  const reset = simulado(invitacion({ user_id: "40000000-0000-4000-8000-000000000009" }), undefined, true);
  assertEquals(await procesarCuenta(reset.deps, { token: TOKEN, password: "clave1234" }), { status: 410, cuerpo: { error: "vencido" } });
  assertEquals(reset.llamadas.orden, ["buscarInvitacion", "actualizarUsuario", "marcarUsada"]);
});

Deno.test("ninguna respuesta lleva el celular completo de la ficha", async () => {
  const { deps } = simulado(invitacion());
  const texto = JSON.stringify(await procesarCuenta(deps, { token: TOKEN }));
  assertFalse(texto.includes("59899000001"));
  assertFalse(texto.includes("099 000 001"));
  assert(texto.includes("••• 001"));
});

// ------------------------------------------------------------ cuenta huérfana y contraseña débil (26/10/2026)
Deno.test("alta: si falla vincular, borra la cuenta recién creada, 500 y el link sigue sin usar", async () => {
  const { deps, llamadas } = simulado(invitacion(), "vincular");
  assertEquals(await procesarCuenta(deps, { token: TOKEN, password: "clave1234" }), { status: 500, cuerpo: { error: ERROR_500 } });
  assertEquals(llamadas.borrar, ["40000000-0000-4000-8000-000000000001"]);
  assertEquals(llamadas.orden, ["buscarInvitacion", "crearUsuario", "vincular", "borrarUsuario"]);
  assertEquals(llamadas.usada, []);
});

Deno.test("alta: si falla vincular y también borrar la cuenta, igual 500 con el aviso de siempre", async () => {
  const { deps, llamadas } = simulado(invitacion(), ["vincular", "borrarUsuario"]);
  assertEquals(await procesarCuenta(deps, { token: TOKEN, password: "clave1234" }), { status: 500, cuerpo: { error: ERROR_500 } });
  assertEquals(llamadas.borrar, ["40000000-0000-4000-8000-000000000001"]);
  assertEquals(llamadas.usada, []);
});

Deno.test("nunca borra una cuenta que no creó: ni si falla crearla, ni en un reset, ni si falla marcar el link", async () => {
  for (const [inv, falla] of [
    [invitacion(), "crearUsuario"],
    [invitacion(), "marcarUsada"],
    [invitacion({ user_id: "40000000-0000-4000-8000-000000000009" }), "actualizarUsuario"],
  ] as const) {
    const { deps, llamadas } = simulado(inv, falla);
    assertEquals((await procesarCuenta(deps, { token: TOKEN, password: "clave1234" })).status, 500, falla);
    assertEquals(llamadas.borrar, [], falla);
  }
});

Deno.test("Auth no acepta la contraseña (weak_password): 400 password_corta, en el alta y en el reset", async () => {
  const alta = simulado(invitacion(), "crearUsuario", false, ERROR_PASSWORD_DEBIL);
  assertEquals(await procesarCuenta(alta.deps, { token: TOKEN, password: "clave1234" }), { status: 400, cuerpo: { error: "password_corta" } });
  assertEquals(alta.llamadas.vincular, []);
  assertEquals(alta.llamadas.usada, []);
  const reset = simulado(invitacion({ user_id: "40000000-0000-4000-8000-000000000009" }), "actualizarUsuario", false, ERROR_PASSWORD_DEBIL);
  assertEquals(await procesarCuenta(reset.deps, { token: TOKEN, password: "clave1234" }), { status: 400, cuerpo: { error: "password_corta" } });
  assertEquals(reset.llamadas.usada, []);
});
