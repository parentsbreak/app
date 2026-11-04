import { crearReceptor } from "./recepcion.ts";

// Requiere publicar explícitamente sin comprobación JWT: autentica la firma YCloud.
// No desplegar ni cargar secretos como parte del merge. Ver docs/ycloud-receptor.md.
Deno.serve(crearReceptor({
  config: () => ({
    activo: Deno.env.get("YCLOUD_RECEPCION_ACTIVA") === "true",
    secreto: Deno.env.get("YCLOUD_WEBHOOK_SECRET"),
    wabas: (Deno.env.get("YCLOUD_WABA_IDS") || "").split(",").map((s) =>
      s.trim()
    ).filter(Boolean),
  }),
  ahora: () => Date.now(),
  guardar: async (evento) => {
    const url = Deno.env.get("SUPABASE_URL");
    const clave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !clave) throw new Error("Configuración incompleta");
    // Una RPC: evento y trabajo se confirman juntos. El timeout ambiguo es seguro de repetir.
    const res = await fetch(url + "/rest/v1/rpc/ycloud_recibir_evento", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: clave,
        Authorization: "Bearer " + clave,
      },
      body: JSON.stringify({ p_evento: evento }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error("Guardado no confirmado");
    await res.body?.cancel();
  },
}));
