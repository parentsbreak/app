// Edge Function pedido-whatsapp (21/10/2026): recibe el texto pegado de los mensajes de una madre
// y devuelve el ticket del pedido, que queda guardado como borrador en pedidos_whatsapp. Lo arma
// Claude Haiku con salida estructurada; la lógica y la validación están en ticket.ts.
//
// La llama la app con la sesión de la admin: verify_jwt = false como todas, pero acá se valida
// adentro el token de la usuaria y que esté en usuarias_autorizadas (es_usuaria_autorizada). Sin
// eso, 401/403: la clave de Anthropic se paga por uso y no puede quedar abierta.
// Prueba interna (21/10/2026): con el encabezado x-cron-secret (app_secrets 'cron_push_secret',
// el mismo del cron) se puede llamar sin sesión, pero SOLO con probar: true (no guarda nada).
// Sirve para probar la función publicada desde el SQL Editor sin usar la cuenta de nadie, y
// cuenta para el tope del día como cualquier otra llamada.
// Secretos (Supabase > Edge Functions > Secrets): ANTHROPIC_API_KEY. Opcional:
// ORIGENES_PERMITIDOS (separados por coma) si la app se publica en otro dominio.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.131.0/helpers/zod";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { accesoInterno, hoyEnMontevideo, parametrosModelo, procesarPedido, RespuestaModelo, type Dependencias } from "./ticket.ts";

// Solo la app publicada (Diego, 21/10/2026). Mudanza a parentsbreak.github.io (27/10/2026): el
// nuevo primero (es el que se responde a un pedido de otro lado) y el viejo hasta que se saque del
// secret. Lo publicado sigue con el valor anterior hasta republicar con OK de Diego.
const ORIGENES = (Deno.env.get("ORIGENES_PERMITIDOS") || "https://parentsbreak.github.io,https://diegomarin28.github.io")
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

Deno.serve(async (req: Request) => {
  const h = encabezados(req.headers.get("origin"));
  const responder = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: h });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return responder({ error: "Solo POST" }, 405);

  let cuerpo: { texto?: unknown; familia_id?: unknown; probar?: unknown } = {};
  try { cuerpo = await req.json(); } catch { return responder({ error: "El cuerpo tiene que ser JSON" }, 400); }
  const url = Deno.env.get("SUPABASE_URL")!;
  // La base se usa con la clave de servicio, como las otras funciones, recién después de saber
  // quién llama (abajo).
  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Quién llama: la prueba interna (solo probar) o la sesión de una admin autorizada.
  let creadoPor: string;
  const secretoCron = req.headers.get("x-cron-secret");
  if (secretoCron) {
    const { data: fila } = await sb.from("app_secrets").select("valor").eq("clave", "cron_push_secret").maybeSingle();
    const acceso = accesoInterno(secretoCron, fila?.valor, cuerpo.probar);
    if (!acceso.ok) return responder({ error: acceso.error }, acceso.status);
    creadoPor = "prueba interna";
  } else {
    const token = req.headers.get("Authorization");
    if (!token) return responder({ error: "Falta la sesión" }, 401);
    const comoUsuaria = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: token } } });
    const { data: { user }, error: errUsuaria } = await comoUsuaria.auth.getUser();
    if (errUsuaria || !user) return responder({ error: "Sesión vencida: volvé a entrar" }, 401);
    const { data: autorizada } = await comoUsuaria.rpc("es_usuaria_autorizada");
    if (autorizada !== true) return responder({ error: "Esta cuenta no tiene acceso" }, 403);
    creadoPor = user.email || user.id;
  }

  const claveAnthropic = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claveAnthropic) return responder({ error: "Falta cargar ANTHROPIC_API_KEY en los secretos de Supabase" }, 503);
  const claude = new Anthropic({ apiKey: claveAnthropic, timeout: 60_000, maxRetries: 2 });

  const deps: Dependencias = {
    hoy: () => hoyEnMontevideo(),
    familias: async () => {
      const { data, error } = await sb.from("familias").select("id,nombre,zona").order("nombre");
      if (error) throw error;
      return data || [];
    },
    reservarLlamada: async (quien, probar, tope) => {
      const { data, error } = await sb.rpc("reservar_llamada_pedido", { p_creado_por: quien, p_probar: probar, p_tope: tope });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    anotarUso: async (id, uso) => {
      const { error } = await sb.from("pedidos_whatsapp_uso").update({ tokens_entrada: uso.entrada, tokens_salida: uso.salida }).eq("id", id);
      if (error) throw error;
    },
    pedirAlModelo: async (sistema, mensaje) => {
      const p = parametrosModelo(sistema, mensaje);
      const r = await claude.messages.parse({ ...p, output_config: { ...p.output_config, format: zodOutputFormat(RespuestaModelo) } });
      const uso = { entrada: r.usage.input_tokens, salida: r.usage.output_tokens };
      if (r.stop_reason === "refusal") return { salida: null, motivo: "rechazo", uso };
      if (r.stop_reason === "max_tokens") return { salida: null, motivo: "cortado", uso };
      return r.parsed_output ? { salida: r.parsed_output, uso } : { salida: null, motivo: "sin_formato", uso };
    },
    precio: async (familiaId, fecha, ini, fin) => {
      const { data, error } = await sb.rpc("precio_sitting", { p_familia_id: familiaId, p_fecha: fecha, p_hora_inicio: ini, p_hora_fin: fin }).maybeSingle();
      if (error) throw error;
      return data ? { cobro: (data as { cobro: number | null }).cobro, pago: (data as { pago: number | null }).pago } : null;
    },
    guardar: async (fila) => {
      const { data, error } = await sb.from("pedidos_whatsapp").insert(fila).select("*").single();
      if (error) throw error;
      return data;
    },
  };

  try {
    const res = await procesarPedido(deps, { texto: cuerpo.texto, familia_id: cuerpo.familia_id, probar: cuerpo.probar, creado_por: creadoPor });
    return res.ok ? responder({ pedido: res.pedido }) : responder({ error: res.error }, res.status);
  } catch (e) {
    // De lo más específico a lo más general (errores tipados del SDK, nunca por el texto).
    if (e instanceof Anthropic.RateLimitError) return responder({ error: "El asistente está con mucha demanda: probá en un minuto" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return responder({ error: "La clave de Anthropic no es válida: avisale a Diego" }, 503);
    if (e instanceof Anthropic.APIConnectionError) return responder({ error: "No se pudo hablar con el asistente: probá de nuevo" }, 502);
    if (e instanceof Anthropic.APIError) return responder({ error: `El asistente respondió con un error (${e.status})` }, 502);
    console.error("pedido-whatsapp", e);
    return responder({ error: "No se pudo guardar el pedido: avisale a Diego" }, 500);
  }
});
