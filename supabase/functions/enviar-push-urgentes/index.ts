import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Corre disparada por pg_cron cada 10 min (ver migración cron_push_urgentes).
// Sin JWT de usuario a propósito (verify_jwt:false) — mismo criterio ya usado en
// candidatas-webhook, porque quien llama es un cron interno, no una sesión de Pau/Delfi.
// V7 (13/09): "sitting sin asignar" ya NO avisa apenas se detecta — avisa recién cuando
// faltan 2 horas para el sitting, y de nuevo si sigue sin resolverse cuando falta 1 hora
// (dos ids distintos por solicitud, cada uno se manda una sola vez). Ojo con la zona
// horaria: este runtime corre en UTC, pero hora_inicio es hora de Montevideo — se arma
// la fecha con el offset "-03:00" explícito para que la resta de horas dé bien (Uruguay
// no tiene horario de verano, el offset es fijo todo el año).
// V8 (30/09/2026): recordatorio anual "Pedir la temporada de Punta" desde el 1 de octubre
// a partir de las 9 (hora Montevideo), una vez por año (id temporada:AAAA).
// V9 (06/10/2026, S4): solo la puede disparar el cron. Antes cualquiera con la URL la
// disparaba. El cron manda el encabezado x-cron-secret con el valor de app_secrets
// 'cron_push_secret' (migración 20261013_cron_push_secreto); sin esa clave, 401.
// V10 (23/10/2026): aviso del extracto apagado. Ya no usan Itaú y el lector de Mercado Pago
// todavía no está (Pendientes, "Cambio de banco"). La app tiene la misma marca (app-shell.js).
// V11 (26/10/2026, fase 1): solo dispositivos de admins (push_subscriptions.user_id vacío). Desde
// la migración cuentas_ninieras las niñeras guardan sus propias suscripciones (con user_id) y
// nunca tienen que recibir estos avisos del panel, que nombran familias y otras niñeras.
const AVISO_EXTRACTO_ACTIVO = false;

function mismoSecreto(recibido: string | null, esperado: string | undefined): boolean {
  if (!esperado || !recibido) return false;
  const a = new TextEncoder().encode(recibido), b = new TextEncoder().encode(esperado);
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b[i];
  return dif === 0;
}

const DEFAULTS_PUSH: Record<string, boolean> = {
  sin_asignar: true,
  sin_registrar: false,
  cv_desactualizado: true,
  extracto: true,
  temporada: true,
};

function calcularEdad(fechaNacISO: string | null, fechaRefISO?: string): number | null {
  if (!fechaNacISO) return null;
  const nac = new Date(fechaNacISO + "T00:00:00");
  const ref = fechaRefISO ? new Date(fechaRefISO + "T00:00:00") : new Date();
  if (isNaN(nac.getTime())) return null;
  let edad = ref.getFullYear() - nac.getFullYear();
  const noLlegoAlCumple = (ref.getMonth() < nac.getMonth()) || (ref.getMonth() === nac.getMonth() && ref.getDate() < nac.getDate());
  if (noLlegoAlCumple) edad--;
  return edad;
}
function cvEstaDesactualizado(fechaNacISO: string | null, cvGeneradoEnISO: string | null): boolean {
  const edadCalculada = calcularEdad(fechaNacISO);
  if (!cvGeneradoEnISO || edadCalculada === null) return false;
  return (calcularEdad(fechaNacISO, cvGeneradoEnISO) as number) < edadCalculada;
}
function normaliza(s: string): string {
  return (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
// Montevideo no tiene horario de verano -- offset fijo todo el año.
function horaMontevideo(fechaISO: string, horaISO: string): Date {
  return new Date(`${fechaISO}T${horaISO}-03:00`);
}

type Candidata = { id: string; tipo: string; titulo: string; mensaje: string; url: string };

Deno.serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const { data: secrets } = await sb.from("app_secrets").select("clave,valor");
    const secretMap = Object.fromEntries((secrets || []).map((s: any) => [s.clave, s.valor]));
    if (!mismoSecreto(req.headers.get("x-cron-secret"), secretMap["cron_push_secret"])) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    const vapidPublic = secretMap["vapid_public_key"];
    const vapidPrivate = secretMap["vapid_private_key"];
    const vapidEmail = secretMap["vapid_contact_email"];
    if (!vapidPublic || !vapidPrivate) {
      return new Response(JSON.stringify({ error: "faltan claves vapid en app_secrets" }), { status: 500 });
    }
    webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);

    const ahora = new Date();
    const hoy = new Date(ahora.getTime() - 3 * 3600000).toISOString().slice(0, 10); // "hoy" en hora Montevideo
    const candidatas: Candidata[] = [];

    // ---- 1) Sittings de hoy sin asignar: avisa cuando faltan <=2hs, de nuevo si sigue sin
    // resolverse cuando faltan <=1h ----
    const { data: sinAsignar } = await sb.from("solicitudes")
      .select("id,familia_nombre,hora_inicio")
      .eq("fecha", hoy)
      .in("estado", ["sin_asignar", "pendiente_confirmar"]);
    (sinAsignar || []).forEach((s: any) => {
      if (!s.hora_inicio) return;
      const horasFaltan = (horaMontevideo(hoy, s.hora_inicio).getTime() - ahora.getTime()) / 3600000;
      if (horasFaltan <= 2) {
        candidatas.push({
          id: "sol:" + s.id + ":2h",
          tipo: "sin_asignar",
          titulo: "Sitting sin asignar",
          mensaje: `${s.familia_nombre || "Familia sin nombre"} — faltan menos de 2 horas y sigue sin niñera confirmada`,
          url: "?ir=agenda",
        });
      }
      if (horasFaltan <= 1) {
        candidatas.push({
          id: "sol:" + s.id + ":1h",
          tipo: "sin_asignar",
          titulo: "Sitting sin asignar — falta 1 hora",
          mensaje: `${s.familia_nombre || "Familia sin nombre"} — falta menos de 1 hora y sigue sin niñera confirmada`,
          url: "?ir=agenda",
        });
      }
    });

    // ---- 2) Sittings de hoy confirmados pero sin registrar ----
    const { data: sitsHoy } = await sb.from("sittings_traslados").select("familia_nombre").eq("fecha", hoy);
    const { data: solConfHoy } = await sb.from("solicitudes").select("id,familia_nombre,hora_inicio").eq("fecha", hoy).eq("estado", "confirmada");
    if (solConfHoy && solConfHoy.length) {
      const registradas = new Set((sitsHoy || []).map((r: any) => normaliza(r.familia_nombre || "")));
      const { data: snHoy } = await sb.from("solicitud_ninieras").select("id,ninera_nombre,solicitud_id").in("solicitud_id", solConfHoy.map((s: any) => s.id)).eq("estado", "confirmada");
      const porSol: Record<string, any[]> = {};
      (snHoy || []).forEach((r: any) => { (porSol[r.solicitud_id] ||= []).push(r); });
      solConfHoy.forEach((s: any) => {
        if (registradas.has(normaliza(s.familia_nombre || ""))) return;
        (porSol[s.id] || []).forEach((n: any) => {
          candidatas.push({
            id: "sn:" + n.id,
            tipo: "sin_registrar",
            titulo: "Sitting sin registrar",
            mensaje: `${n.ninera_nombre} → ${s.familia_nombre || "familia sin nombre"}, hoy${s.hora_inicio ? " " + s.hora_inicio.slice(0, 5) : ""} — todavía no se cargó`,
            url: "?ir=pend-hoy",
          });
        });
      });
    }

    // ---- 3) CV desactualizado ----
    const { data: ninierasActivas } = await sb.from("ninieras")
      .select("id,nombre,cv_generado_en,candidatas(fecha_nacimiento)")
      .eq("activa", true);
    (ninierasActivas || []).forEach((n: any) => {
      const fechaNac = n.candidatas?.fecha_nacimiento || null;
      if (cvEstaDesactualizado(fechaNac, n.cv_generado_en)) {
        candidatas.push({
          id: "cv:" + n.id,
          tipo: "cv_desactualizado",
          titulo: "CV desactualizado",
          mensaje: `${n.nombre} cumplió años después de generarle el CV — convendría regenerarlo`,
          url: "?ir=ninieras",
        });
      }
    });

    // ---- 4) Extracto Itaú: nunca subido, o hace más de 15 días (apagado, ver V10) ----
    if (AVISO_EXTRACTO_ACTIVO) {
      const { data: cfg } = await sb.from("app_config").select("actualizado_at").eq("id", "ultima_conciliacion_cobros").maybeSingle();
      if (!cfg?.actualizado_at) {
        candidatas.push({
          id: "extracto:nunca",
          tipo: "extracto",
          titulo: "Falta subir el extracto de Itaú",
          mensaje: "Todavía no se subió ningún extracto para conciliar.",
          url: "?ir=finanzas",
        });
      } else {
        const limite = new Date(cfg.actualizado_at);
        limite.setDate(limite.getDate() + 15);
        if (limite.getTime() <= Date.now()) {
          candidatas.push({
            id: "extracto:" + limite.toISOString().slice(0, 10),
            tipo: "extracto",
            titulo: "Falta subir el extracto de Itaú",
            mensaje: "Hace más de 15 días que no se sube un extracto nuevo para conciliar.",
            url: "?ir=finanzas",
          });
        }
      }
    }

    // ---- 5) Recordatorio anual: pedir la temporada de Punta desde el 1 de octubre, a partir
    // de las 9 de la mañana (hora Montevideo). Un id por año, se manda una sola vez. ----
    const ahoraMvd = new Date(ahora.getTime() - 3 * 3600000);
    if (ahoraMvd.getUTCMonth() >= 9 && ahoraMvd.getUTCHours() >= 9) {
      candidatas.push({
        id: "temporada:" + ahoraMvd.getUTCFullYear(),
        tipo: "temporada",
        titulo: "Pedir la temporada de Punta",
        mensaje: "Mandales a las niñeras el link para que carguen en qué fechas van a estar en Punta del Este.",
        url: "?ir=ninieras",
      });
    }

    if (!candidatas.length) {
      return new Response(JSON.stringify({ enviados: 0, motivo: "nada urgente" }), { headers: { "Content-Type": "application/json" } });
    }

    const ids = candidatas.map((c) => c.id);
    const { data: yaEnviadas } = await sb.from("notif_push_enviadas").select("notif_id").in("notif_id", ids);
    const enviadasSet = new Set((yaEnviadas || []).map((r: any) => r.notif_id));
    const nuevas = candidatas.filter((c) => !enviadasSet.has(c.id));

    if (!nuevas.length) {
      return new Response(JSON.stringify({ enviados: 0, motivo: "ya se habia avisado de todas" }), { headers: { "Content-Type": "application/json" } });
    }

    const { data: subs } = await sb.from("push_subscriptions").select("*").is("user_id", null);
    if (!subs || !subs.length) {
      for (const c of nuevas) await sb.from("notif_push_enviadas").insert({ notif_id: c.id });
      return new Response(JSON.stringify({ enviados: 0, motivo: "nadie activo el push todavia" }), { headers: { "Content-Type": "application/json" } });
    }

    const usuarios = [...new Set(subs.map((s: any) => s.usuario))];
    const { data: prefsRows } = await sb.from("notif_push_preferencias").select("usuario,tipo,activado").in("usuario", usuarios);
    const prefMap: Record<string, boolean> = {};
    (prefsRows || []).forEach((p: any) => { prefMap[p.usuario + "|" + p.tipo] = p.activado; });
    function quiereEsteTipo(usuario: string, tipo: string): boolean {
      const key = usuario + "|" + tipo;
      return key in prefMap ? prefMap[key] : (DEFAULTS_PUSH[tipo] ?? false);
    }

    let enviados = 0;
    for (const c of nuevas) {
      const payload = JSON.stringify({ id: c.id, titulo: c.titulo, mensaje: c.mensaje, url: c.url });
      for (const sub of subs) {
        if (!quiereEsteTipo(sub.usuario, c.tipo)) continue;
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            payload,
          );
          enviados++;
        } catch (err: any) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            await sb.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      }
      await sb.from("notif_push_enviadas").insert({ notif_id: c.id });
    }

    return new Response(JSON.stringify({ enviados, nuevas: nuevas.length }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
