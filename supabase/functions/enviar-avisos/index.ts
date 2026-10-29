// Edge Function enviar-avisos (29/10/2026, fase 1, etapa 3): manda por push los avisos de la cola
// (tabla avisos) a niñeras y a admins. La lógica está en envio.ts; acá solo se conecta la base
// (con la clave de servicio) y web-push.
//
// La llaman la base y nadie más: el trigger avisos_enviar_ya (un aviso para ya, por ejemplo un
// mensaje del chat) y el cron de cada minuto (correr_cron_avisos), los dos por
// llamar_enviar_avisos() con el encabezado x-cron-secret = app_secrets 'cron_push_secret', el mismo
// de enviar-push-urgentes (migración 20261029_avisos_chat). Sin esa clave, 401. verify_jwt = false
// como todas: quien llama no es una sesión. Las claves VAPID son las de enviar-push-urgentes
// (app_secrets), así los dispositivos ya suscriptos sirven para las dos funciones.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type Deps, procesarAvisos, type Suscripcion, type SuscripcionNinera } from "./envio.ts";

// Comparación en tiempo constante, igual que enviar-push-urgentes.
function mismoSecreto(recibido: string | null, esperado: string | undefined): boolean {
  if (!esperado || !recibido) return false;
  const a = new TextEncoder().encode(recibido), b = new TextEncoder().encode(esperado);
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b[i];
  return dif === 0;
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

const COLUMNAS_SUB = "id, usuario, endpoint, p256dh, auth_key";

Deno.serve(async (req: Request) => {
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: secretos, error: errSecretos } = await sb.from("app_secrets").select("clave, valor")
      .in("clave", ["cron_push_secret", "vapid_public_key", "vapid_private_key", "vapid_contact_email"]);
    if (errSecretos) throw errSecretos;
    const s = Object.fromEntries((secretos || []).map((f: { clave: string; valor: string }) => [f.clave, f.valor]));
    if (!mismoSecreto(req.headers.get("x-cron-secret"), s["cron_push_secret"])) {
      return json({ error: "Unauthorized" }, 401);
    }
    // Antes de reclamar: sin VAPID no se puede mandar nada y los avisos reclamados quedarían
    // marcados como enviados sin haber salido.
    if (!s["vapid_public_key"] || !s["vapid_private_key"] || !s["vapid_contact_email"]) {
      return json({ error: "Faltan las claves VAPID en app_secrets (vapid_public_key, vapid_private_key, vapid_contact_email)" }, 500);
    }
    webpush.setVapidDetails(s["vapid_contact_email"], s["vapid_public_key"], s["vapid_private_key"]);

    const deps: Deps = {
      reclamar: async (max) => {
        const { data, error } = await sb.rpc("reclamar_avisos", { p_max: max });
        if (error) throw error;
        return data || [];
      },
      // Dos lecturas por tanda: las fichas con cuenta y los dispositivos de esas cuentas.
      // push_subscriptions.user_id apunta a auth.users, no a ninieras: no hay join directo.
      suscripcionesNineraPorId: async (nineraIds) => {
        const { data: fichas, error } = await sb.from("ninieras").select("id, activa, user_id")
          .in("id", nineraIds).not("user_id", "is", null);
        if (error) throw error;
        if (!fichas?.length) return [];
        const porUsuario = new Map(fichas.map((f: { id: string; activa: boolean; user_id: string }) => [f.user_id, f]));
        const { data: subs, error: errSubs } = await sb.from("push_subscriptions")
          .select(COLUMNAS_SUB + ", user_id").in("user_id", [...porUsuario.keys()]);
        if (errSubs) throw errSubs;
        return ((subs || []) as unknown as (Suscripcion & { user_id: string })[]).map((sub): SuscripcionNinera => {
          const ficha = porUsuario.get(sub.user_id)!;
          return {
            id: sub.id, usuario: sub.usuario, endpoint: sub.endpoint, p256dh: sub.p256dh, auth_key: sub.auth_key,
            ninera_id: ficha.id, ninera_activa: ficha.activa === true,
          };
        });
      },
      suscripcionesAdmins: async () => {
        const { data, error } = await sb.from("push_subscriptions").select(COLUMNAS_SUB).is("user_id", null);
        if (error) throw error;
        return (data || []) as unknown as Suscripcion[];
      },
      mailsAdminsActivas: async () => {
        const { data, error } = await sb.rpc("admins_activas_mails");
        if (error) throw error;
        // setof text: según la versión llega como lista de textos o de filas con la columna.
        return ((data || []) as unknown[]).map((f) =>
          typeof f === "string" ? f : String((f as Record<string, unknown>)?.admins_activas_mails ?? "")
        ).filter(Boolean);
      },
      preferencias: async (usuarios) => {
        const { data, error } = await sb.from("notif_push_preferencias").select("usuario, tipo, activado").in("usuario", usuarios);
        if (error) throw error;
        return data || [];
      },
      mandar: async (sub, payload) => {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload);
      },
      borrarSuscripcion: async (id) => {
        const { error } = await sb.from("push_subscriptions").delete().eq("id", id);
        if (error) throw error;
      },
      // Con reintento vuelve a la cola: enviado_en vacío y enviar_desde más tarde (reclamar_avisos
      // lo levanta de nuevo). Sin reintento queda como enviado, con el error anotado.
      marcarError: async (id, error, reintentarDesde) => {
        const cambios = reintentarDesde
          ? { error, enviado_en: null, enviar_desde: reintentarDesde.toISOString() }
          : { error };
        const { error: errUpd } = await sb.from("avisos").update(cambios).eq("id", id);
        if (errUpd) throw errUpd;
      },
    };

    return json(await procesarAvisos(deps, new Date()));
  } catch (e) {
    const err = e as { message?: unknown; code?: unknown };
    console.error("enviar-avisos", { mensaje: err?.message ?? String(e), codigo: err?.code });
    return json({ error: "No se pudieron enviar los avisos: " + String(err?.message ?? e) }, 500);
  }
});
