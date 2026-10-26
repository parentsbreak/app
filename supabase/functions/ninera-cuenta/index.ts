// Edge Function ninera-cuenta (26/10/2026, fase 1): la niñera abre ninera/?i=<token> y la app
// llama acá para crear su cuenta (o cambiarle la contraseña, si ya tenía) con la clave de
// servicio. La lógica está en cuenta.ts; acá solo se conecta la base y Auth.
//
// Pública a propósito (verify_jwt = false como todas, y sin sesión: quien llama todavía no tiene
// cuenta). La credencial es el token del link: 64 hex al azar, vale una sola vez, vence a los 7
// días y un link nuevo invalida los anteriores (crear_invitacion_ninera, migración
// 20261026_cuentas_ninieras). Nunca se devuelve ni se anota la contraseña ni el celular completo.
// Opcional (Supabase > Edge Functions > Secrets): ORIGENES_PERMITIDOS (separados por coma) si la
// app se publica en otro dominio.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type Deps, type Invitacion, procesarCuenta } from "./cuenta.ts";

// Solo la app publicada, como pedido-whatsapp (Diego, 21/10/2026).
const ORIGENES = (Deno.env.get("ORIGENES_PERMITIDOS") || "https://diegomarin28.github.io")
  .split(",").map(o => o.trim()).filter(Boolean);

function encabezados(origen: string | null): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origen && ORIGENES.includes(origen) ? origen : ORIGENES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

type Ficha = { nombre: string; telefono: string | null; user_id: string | null; activa: boolean };
type FilaInvitacion = {
  id: string; ninera_id: string; vence_en: string; usada_en: string | null; reemplazada_en: string | null;
  ninieras: Ficha | Ficha[] | null;
};

// Anota en los logs qué paso falló, sin los datos que se le pasaron (ahí van la contraseña y el
// mail con el celular): solo el mensaje y el código del error.
function conRegistro<A extends unknown[], R>(paso: string, f: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await f(...args);
    } catch (e) {
      const err = e as { message?: unknown; code?: unknown; status?: unknown };
      console.error("ninera-cuenta", paso, { mensaje: err?.message, codigo: err?.code, status: err?.status });
      throw e;
    }
  };
}

Deno.serve(async (req: Request) => {
  const h = encabezados(req.headers.get("origin"));
  const responder = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: h });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return responder({ error: "Solo POST" }, 405);

  let cuerpo: { token?: unknown; password?: unknown } = {};
  try { cuerpo = await req.json(); } catch { return responder({ error: "El cuerpo tiene que ser JSON" }, 400); }
  if (!cuerpo || typeof cuerpo !== "object") return responder({ error: "El cuerpo tiene que ser JSON" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const deps: Deps = {
    buscarInvitacion: conRegistro("buscarInvitacion", async (token: string): Promise<Invitacion | null> => {
      const { data, error } = await sb.from("ninera_invitaciones")
        .select("id, ninera_id, vence_en, usada_en, reemplazada_en, ninieras ( nombre, telefono, user_id, activa )")
        .eq("token", token).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const fila = data as unknown as FilaInvitacion;
      const ficha = Array.isArray(fila.ninieras) ? fila.ninieras[0] : fila.ninieras;
      // Sin ficha no hay a quién crearle la cuenta (la FK borra las invitaciones con la niñera).
      if (!ficha) return null;
      return {
        id: fila.id, ninera_id: fila.ninera_id, nombre: ficha.nombre, telefono: ficha.telefono,
        user_id: ficha.user_id, activa: ficha.activa, vence_en: fila.vence_en, usada_en: fila.usada_en,
        reemplazada_en: fila.reemplazada_en,
      };
    }),
    crearUsuario: conRegistro("crearUsuario", async (email: string, password: string, nineraId: string) => {
      const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { ninera_id: nineraId } });
      if (error) throw error;
      if (!data.user) throw new Error("Auth no devolvió la cuenta creada");
      return data.user.id;
    }),
    actualizarUsuario: conRegistro("actualizarUsuario", async (userId: string, cambios: { password: string; email: string }) => {
      const { error } = await sb.auth.admin.updateUserById(userId, { password: cambios.password, email: cambios.email });
      if (error) throw error;
    }),
    vincular: conRegistro("vincular", async (nineraId: string, userId: string) => {
      const { data, error } = await sb.from("ninieras").update({ user_id: userId }).eq("id", nineraId).select("id");
      if (error) throw error;
      if (!data || !data.length) throw new Error("No se encontró la ficha para vincular la cuenta");
    }),
    // Con la condición del valor de antes (CLAUDE.md, "Lo que dos admins pueden cambiar a la vez"):
    // dos pedidos con el mismo link al mismo tiempo pasan los dos el chequeo de vigencia, pero
    // solo uno lo marca; el otro recibe false y responde 410.
    marcarUsada: conRegistro("marcarUsada", async (invitacionId: string) => {
      const { data, error } = await sb.from("ninera_invitaciones").update({ usada_en: new Date().toISOString() })
        .eq("id", invitacionId).is("usada_en", null).select("id");
      if (error) throw error;
      return !!data && data.length > 0;
    }),
    ahora: () => new Date(),
  };

  const res = await procesarCuenta(deps, { token: cuerpo.token, password: cuerpo.password });
  return responder(res.cuerpo, res.status);
});
