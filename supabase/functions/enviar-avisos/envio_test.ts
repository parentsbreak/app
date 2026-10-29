// Tests de enviar-avisos con la base y el push SIMULADOS: nunca llaman a Supabase ni a un servidor
// de push. Datos inventados. Se corren desde una carpeta fuera del repo (el package.json de la raíz
// confunde a Deno), por ejemplo: npx deno@2 test --allow-env <carpeta>/enviar-avisos/
import { assert, assertEquals } from "jsr:@std/assert@1.0.13";
import {
  type Aviso, type Deps, INTENTOS_MAX, MAX_RECLAMO, procesarAvisos, type Suscripcion, type SuscripcionNinera,
} from "./envio.ts";

const AHORA = new Date("2026-10-29T15:00:00Z");
const EN_2_MIN = new Date("2026-10-29T15:02:00Z");
const ANA = "30000000-0000-4000-8000-000000000001";
const BETO = "30000000-0000-4000-8000-000000000002";
const CARLA = "30000000-0000-4000-8000-000000000003";

let siguiente = 0;
function aviso(cambios: Partial<Aviso> = {}): Aviso {
  siguiente++;
  return {
    id: `a0000000-0000-4000-8000-${String(siguiente).padStart(12, "0")}`,
    clave: `prueba:${siguiente}`, para_ninera_id: ANA, para_admin: null, tipo: "chat",
    titulo: "Paula Prueba", cuerpo: "Hola, ¿mañana a las 9?", url: "#chat", datos: {},
    enviar_desde: AHORA.toISOString(), enviado_en: AHORA.toISOString(), error: null, intentos: 1,
    leido_en: null, creado_en: AHORA.toISOString(), ...cambios,
  };
}
function sub(id: string, usuario: string): Suscripcion {
  return { id, usuario, endpoint: `https://push.prueba.invalid/${id}`, p256dh: `p-${id}`, auth_key: `k-${id}` };
}
function subNinera(id: string, nineraId: string, activa = true): SuscripcionNinera {
  return { ...sub(id, "598900000@ninieras.parentsbreak.invalid"), ninera_id: nineraId, ninera_activa: activa };
}

// Base y push de mentira. `respuestas` dice qué pasa al mandar a cada suscripción (por id): un
// número es el statusCode del error (como web-push), una lista va una respuesta por intento.
type Respuesta = "ok" | number | "red";
function simulado(op: {
  avisos?: Aviso[];
  ninieras?: SuscripcionNinera[];
  admins?: Suscripcion[];
  activas?: string[];
  prefs?: { usuario: string; tipo: string; activado: boolean }[];
  respuestas?: Record<string, Respuesta | Respuesta[]>;
  falla?: (keyof Deps)[];
} = {}) {
  const llamadas = {
    reclamar: [] as number[], ninieras: [] as string[][], admins: 0, activas: 0, prefs: [] as string[][],
    mandar: [] as { sub: string; payload: string }[], borrar: [] as string[],
    errores: [] as { id: string; error: string; reintentar: Date | null }[],
  };
  const intentosPorSub: Record<string, number> = {};
  const falla = (nombre: keyof Deps) => {
    if (op.falla?.includes(nombre)) throw new Error(`falla simulada en ${nombre}`);
  };
  const deps: Deps = {
    reclamar: async (max) => { llamadas.reclamar.push(max); falla("reclamar"); return op.avisos ?? []; },
    suscripcionesNineraPorId: async (ids) => {
      llamadas.ninieras.push([...ids]); falla("suscripcionesNineraPorId");
      return (op.ninieras ?? []).filter((s) => ids.includes(s.ninera_id));
    },
    suscripcionesAdmins: async () => { llamadas.admins++; falla("suscripcionesAdmins"); return op.admins ?? []; },
    mailsAdminsActivas: async () => { llamadas.activas++; falla("mailsAdminsActivas"); return op.activas ?? []; },
    preferencias: async (usuarios) => {
      llamadas.prefs.push([...usuarios]); falla("preferencias");
      return (op.prefs ?? []).filter((p) => usuarios.includes(p.usuario));
    },
    mandar: async (s, payload) => {
      llamadas.mandar.push({ sub: s.id, payload });
      const r = op.respuestas?.[s.id] ?? "ok";
      const n = intentosPorSub[s.id] = (intentosPorSub[s.id] ?? 0) + 1;
      const esta = Array.isArray(r) ? r[Math.min(n, r.length) - 1] : r;
      if (esta === "ok") return;
      if (esta === "red") throw new TypeError("error de red simulado");
      throw Object.assign(new Error("Received unexpected response code"), { statusCode: esta, body: "detalle" });
    },
    borrarSuscripcion: async (id) => { llamadas.borrar.push(id); falla("borrarSuscripcion"); },
    marcarError: async (id, error, reintentar) => { llamadas.errores.push({ id, error, reintentar }); falla("marcarError"); },
  };
  return { deps, llamadas };
}
const subsMandadas = (l: { mandar: { sub: string }[] }) => l.mandar.map((m) => m.sub).sort();

// ------------------------------------------------------------ cola vacía
Deno.test("sin avisos pendientes: reclama 50 y no busca nada más", async () => {
  const { deps, llamadas } = simulado();
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 0, enviados: 0, fallidos: 0, borradas: 0 });
  assertEquals(llamadas.reclamar, [MAX_RECLAMO]);
  assertEquals(MAX_RECLAMO, 50);
  assertEquals(llamadas.ninieras.length + llamadas.admins + llamadas.activas + llamadas.prefs.length, 0);
});

// ------------------------------------------------------------ niñeras
Deno.test("niñera con dos dispositivos: le llega a los dos, una sola búsqueda", async () => {
  const a = aviso();
  const { deps, llamadas } = simulado({ avisos: [a], ninieras: [subNinera("s1", ANA), subNinera("s2", ANA), subNinera("s3", BETO)] });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 1, enviados: 1, fallidos: 0, borradas: 0 });
  assertEquals(subsMandadas(llamadas), ["s1", "s2"]);
  assertEquals(llamadas.ninieras, [[ANA]]);
  // Un aviso para niñeras no mira las cuentas de las admins.
  assertEquals(llamadas.admins + llamadas.activas + llamadas.prefs.length, 0);
});

Deno.test("varias niñeras en la misma tanda: una sola búsqueda con todas, sin repetir ids", async () => {
  const avisos = [aviso({ para_ninera_id: ANA }), aviso({ para_ninera_id: BETO }), aviso({ para_ninera_id: ANA })];
  const { deps, llamadas } = simulado({ avisos, ninieras: [subNinera("s1", ANA), subNinera("s2", BETO)] });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 3, enviados: 3, fallidos: 0, borradas: 0 });
  assertEquals(llamadas.ninieras.length, 1);
  assertEquals([...llamadas.ninieras[0]].sort(), [ANA, BETO]);
  // Cada aviso, solo a los dispositivos de su niñera.
  const porAviso = llamadas.mandar.map((m) => [JSON.parse(m.payload).id, m.sub]);
  assertEquals(porAviso, [[avisos[0].id, "s1"], [avisos[1].id, "s2"], [avisos[2].id, "s1"]]);
});

Deno.test("niñera inactiva: no se le manda y no es error", async () => {
  const { deps, llamadas } = simulado({ avisos: [aviso({ para_ninera_id: CARLA })], ninieras: [subNinera("s9", CARLA, false)] });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 1, enviados: 0, fallidos: 0, borradas: 0 });
  assertEquals(llamadas.mandar.length, 0);
  assertEquals(llamadas.errores.length, 0);
});

Deno.test("aviso sin suscripciones (sin cuenta o sin push): no es error, queda en su lista", async () => {
  const { deps, llamadas } = simulado({ avisos: [aviso({ para_ninera_id: BETO })], ninieras: [subNinera("s1", ANA)] });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 1, enviados: 0, fallidos: 0, borradas: 0 });
  assertEquals(llamadas.mandar.length, 0);
  assertEquals(llamadas.errores.length, 0);
});

// ------------------------------------------------------------ admins
const MAIL_A = "admin.a@prueba.invalid";
const MAIL_B = "admin.b@prueba.invalid"; // dada de baja
const MAIL_C = "admin.c@prueba.invalid"; // apagó los avisos del chat
const MAIL_D = "admin.d@prueba.invalid"; // la que escribió (excepto)

Deno.test("'todas': solo las activas, sin la preferencia apagada ni la de excepto", async () => {
  const a = aviso({ para_ninera_id: null, para_admin: "todas", datos: { excepto: MAIL_D } });
  const { deps, llamadas } = simulado({
    avisos: [a],
    admins: [sub("a1", MAIL_A), sub("a2", MAIL_A), sub("b1", MAIL_B), sub("c1", MAIL_C), sub("d1", MAIL_D)],
    activas: [MAIL_A, MAIL_C, MAIL_D],
    // La de A apagada para otro tipo no cuenta; sin fila para el chat, está prendido.
    prefs: [{ usuario: MAIL_C, tipo: "chat", activado: false }, { usuario: MAIL_A, tipo: "sin_asignar", activado: false }],
  });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 1, enviados: 1, fallidos: 0, borradas: 0 });
  assertEquals(subsMandadas(llamadas), ["a1", "a2"]);
  // Las preferencias se piden una vez por tanda, solo de las activas (excepto es de cada aviso).
  assertEquals(llamadas.prefs.length, 1);
  assertEquals([...llamadas.prefs[0]].sort(), [MAIL_A, MAIL_C, MAIL_D]);
  assertEquals(llamadas.ninieras.length, 0);
});

Deno.test("'todas': el mail se compara sin mayúsculas (activas y excepto)", async () => {
  const a = aviso({ para_ninera_id: null, para_admin: "todas", datos: { excepto: "Admin.D@Prueba.invalid" } });
  const { deps, llamadas } = simulado({
    avisos: [a], admins: [sub("a1", "Admin.A@prueba.invalid"), sub("d1", MAIL_D)], activas: [MAIL_A, MAIL_D],
  });
  await procesarAvisos(deps, AHORA);
  assertEquals(subsMandadas(llamadas), ["a1"]);
});

Deno.test("'todas': excepto que no es texto se ignora", async () => {
  const a = aviso({ para_ninera_id: null, para_admin: "todas", datos: { excepto: 42 } });
  const { deps, llamadas } = simulado({ avisos: [a], admins: [sub("a1", MAIL_A), sub("d1", MAIL_D)], activas: [MAIL_A, MAIL_D] });
  await procesarAvisos(deps, AHORA);
  assertEquals(subsMandadas(llamadas), ["a1", "d1"]);
});

Deno.test("aviso para una admin por su mail: solo sus dispositivos, si está activa y lo quiere", async () => {
  const paraA = aviso({ para_ninera_id: null, para_admin: MAIL_A });
  const paraB = aviso({ para_ninera_id: null, para_admin: MAIL_B });
  const paraC = aviso({ para_ninera_id: null, para_admin: MAIL_C });
  const { deps, llamadas } = simulado({
    avisos: [paraA, paraB, paraC],
    admins: [sub("a1", MAIL_A), sub("b1", MAIL_B), sub("c1", MAIL_C)],
    activas: [MAIL_A, MAIL_C],
    prefs: [{ usuario: MAIL_C, tipo: "chat", activado: false }],
  });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 3, enviados: 1, fallidos: 0, borradas: 0 });
  assertEquals(subsMandadas(llamadas), ["a1"]);
});

// ------------------------------------------------------------ suscripciones vencidas
Deno.test("410 borra la suscripción y sigue con las demás; no se vuelve a usar en la tanda", async () => {
  const a1 = aviso(), a2 = aviso();
  const { deps, llamadas } = simulado({
    avisos: [a1, a2], ninieras: [subNinera("vieja", ANA), subNinera("nueva", ANA)], respuestas: { vieja: 410 },
  });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 2, enviados: 2, fallidos: 0, borradas: 1 });
  assertEquals(llamadas.borrar, ["vieja"]);
  assertEquals(llamadas.mandar.filter((m) => m.sub === "vieja").length, 1);
  assertEquals(llamadas.mandar.filter((m) => m.sub === "nueva").length, 2);
  assertEquals(llamadas.errores.length, 0);
});

Deno.test("todas vencidas (404 y 410): se borran y no es error (es como no tener dispositivos)", async () => {
  const { deps, llamadas } = simulado({
    avisos: [aviso()], ninieras: [subNinera("s1", ANA), subNinera("s2", ANA)], respuestas: { s1: 404, s2: 410 },
  });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 1, enviados: 0, fallidos: 0, borradas: 2 });
  assertEquals(llamadas.borrar.sort(), ["s1", "s2"]);
  assertEquals(llamadas.errores.length, 0);
});

Deno.test("si borrar la suscripción vencida falla, se sigue igual y no la cuenta", async () => {
  const { deps, llamadas } = simulado({
    avisos: [aviso()], ninieras: [subNinera("vieja", ANA), subNinera("nueva", ANA)], respuestas: { vieja: 410 },
    falla: ["borrarSuscripcion"],
  });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 1, enviados: 1, fallidos: 0, borradas: 0 });
  assertEquals(llamadas.borrar, ["vieja"]);
});

// ------------------------------------------------------------ errores de push y reintentos
Deno.test("error de push en todas: reintenta a los 2 minutos en el intento 1 y 2, en el 3 queda con error", async () => {
  for (const [intentos, reintentar] of [[1, EN_2_MIN], [2, EN_2_MIN], [3, null]] as const) {
    const a = aviso({ intentos });
    const { deps, llamadas } = simulado({ avisos: [a], ninieras: [subNinera("s1", ANA), subNinera("s2", ANA)], respuestas: { s1: 500, s2: "red" } });
    const r = await procesarAvisos(deps, AHORA);
    assertEquals(r, { reclamados: 1, enviados: 0, fallidos: 1, borradas: 0 }, `intento ${intentos}`);
    assertEquals(llamadas.errores.length, 1);
    assertEquals(llamadas.errores[0].id, a.id);
    assertEquals(llamadas.errores[0].reintentar, reintentar, `intento ${intentos}`);
    assert(llamadas.errores[0].error.length > 0 && llamadas.errores[0].error.length <= 300);
    assertEquals(llamadas.borrar.length, 0);
  }
  assertEquals(INTENTOS_MAX, 3);
});

Deno.test("el error anotado dice el código y no copia el cuerpo de la respuesta del servidor", async () => {
  const { deps, llamadas } = simulado({ avisos: [aviso()], ninieras: [subNinera("s1", ANA)], respuestas: { s1: 429 } });
  await procesarAvisos(deps, AHORA);
  assert(llamadas.errores[0].error.includes("429"));
  assert(!llamadas.errores[0].error.includes("detalle"));
});

Deno.test("éxito parcial (uno falla, otro llega) cuenta como enviado y no reintenta", async () => {
  const { deps, llamadas } = simulado({ avisos: [aviso()], ninieras: [subNinera("s1", ANA), subNinera("s2", ANA)], respuestas: { s1: 503 } });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 1, enviados: 1, fallidos: 0, borradas: 0 });
  assertEquals(llamadas.errores.length, 0);
});

Deno.test("una vencida y otra con error: el aviso falla (nada llegó) y la vencida se borra", async () => {
  const { deps, llamadas } = simulado({ avisos: [aviso()], ninieras: [subNinera("s1", ANA), subNinera("s2", ANA)], respuestas: { s1: 410, s2: 500 } });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 1, enviados: 0, fallidos: 1, borradas: 1 });
  assertEquals(llamadas.errores[0].reintentar, EN_2_MIN);
});

Deno.test("si marcarError falla, se sigue con el resto de la tanda", async () => {
  const malo = aviso({ para_ninera_id: ANA }), bueno = aviso({ para_ninera_id: BETO });
  const { deps, llamadas } = simulado({
    avisos: [malo, bueno], ninieras: [subNinera("s1", ANA), subNinera("s2", BETO)], respuestas: { s1: 500 },
    falla: ["marcarError"],
  });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 2, enviados: 1, fallidos: 1, borradas: 0 });
  assertEquals(subsMandadas(llamadas), ["s1", "s2"]);
});

Deno.test("si falla buscar a quién mandar, esos avisos vuelven a la cola con reintento y los otros salen", async () => {
  const deAdmins = aviso({ para_ninera_id: null, para_admin: "todas" });
  const deNinera = aviso({ para_ninera_id: ANA });
  const { deps, llamadas } = simulado({
    avisos: [deAdmins, deNinera], ninieras: [subNinera("s1", ANA)], admins: [sub("a1", MAIL_A)], activas: [MAIL_A],
    falla: ["mailsAdminsActivas"],
  });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 2, enviados: 1, fallidos: 1, borradas: 0 });
  assertEquals(subsMandadas(llamadas), ["s1"]);
  assertEquals(llamadas.errores.map((e) => [e.id, e.reintentar]), [[deAdmins.id, EN_2_MIN]]);
});

Deno.test("si falla buscar los dispositivos de las niñeras, sus avisos vuelven a la cola", async () => {
  const a = aviso({ intentos: 3 });
  const { deps, llamadas } = simulado({ avisos: [a], falla: ["suscripcionesNineraPorId"] });
  const r = await procesarAvisos(deps, AHORA);
  assertEquals(r, { reclamados: 1, enviados: 0, fallidos: 1, borradas: 0 });
  assertEquals(llamadas.errores.map((e) => [e.id, e.reintentar]), [[a.id, null]]);
});

// ------------------------------------------------------------ payload
Deno.test("payload: solo id, titulo, mensaje (el cuerpo) y url; nada de datos ni la clave", async () => {
  const a = aviso({ titulo: "Paula Prueba", cuerpo: "Te escribo por lo de mañana", url: "#chat", datos: { mensaje_id: "m1", excepto: "x" } });
  const { deps, llamadas } = simulado({ avisos: [a], ninieras: [subNinera("s1", ANA)] });
  await procesarAvisos(deps, AHORA);
  const p = JSON.parse(llamadas.mandar[0].payload);
  assertEquals(Object.keys(p).sort(), ["id", "mensaje", "titulo", "url"]);
  assertEquals(p, { id: a.id, titulo: "Paula Prueba", mensaje: "Te escribo por lo de mañana", url: "#chat" });
});

Deno.test("payload sin cuerpo ni url: mensaje vacío y url null (sw.js usa la de su carpeta)", async () => {
  const a = aviso({ cuerpo: null, url: null });
  const { deps, llamadas } = simulado({ avisos: [a], ninieras: [subNinera("s1", ANA)] });
  await procesarAvisos(deps, AHORA);
  assertEquals(JSON.parse(llamadas.mandar[0].payload), { id: a.id, titulo: a.titulo, mensaje: "", url: null });
});

Deno.test("si reclamar falla, el error sube (index.ts responde 500)", async () => {
  const { deps } = simulado({ falla: ["reclamar"] });
  let fallo = false;
  try { await procesarAvisos(deps, AHORA); } catch { fallo = true; }
  assert(fallo);
});
