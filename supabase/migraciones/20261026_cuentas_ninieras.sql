-- ============================================================================
-- Migración 26/10/2026 (fase 1, etapa 1): cuentas de las niñeras.
--
-- Las niñeras van a entrar a su propia app (/ninera/) con su celular y una contraseña, sin mail
-- ni SMS. Por dentro, la cuenta de Supabase Auth usa un mail sintético armado con el celular
-- normalizado (59899123456@ninieras.parentsbreak.invalid; .invalid es un dominio reservado que
-- nunca va a existir). La cuenta la crea la Edge Function ninera-cuenta (clave de servicio) al
-- abrir el link de invitación que genera una admin desde la ficha. Ver docs/fase1, 4.1 y 5.2.
--
-- Suma:
--   - ninieras.user_id (la cuenta de la niñera) y ninieras.app_activada_en (primer ingreso);
--   - ninera_invitaciones: los links de invitación / cambio de contraseña (solo admins);
--   - normalizar_celular() y mail_sintetico_ninera(): la misma regla que js/comun.js;
--   - ninera_actual() / es_ninera(): el rol de niñera, como es_usuaria_autorizada() el de admin.
--     Las políticas de las tablas compartidas NO cambian: siguen pidiendo es_usuaria_autorizada(),
--     así que una niñera con sesión lee 0 filas de sittings, familias, ninieras, etc. Lo que vea
--     va a pasar por funciones security definer que filtran por ninera_actual() (etapas siguientes);
--   - ninera_activar_app() y crear_invitacion_ninera();
--   - push_subscriptions.user_id y la política push_propias (cada cuenta, solo sus filas); la de
--     las admins queda igual;
--   - app_config 'ninieras_app' con la vigencia del link (7 días);
--   - una guardia de admin en generar_previstos_fijos(): desde acá un JWT "authenticated" puede
--     ser de una niñera, y esa función (security definer) escribe en sittings_traslados.
--
-- Compatible con la app publicada: columnas nuevas vacías, una tabla nueva, funciones nuevas,
-- una política permisiva más en push_subscriptions (las admins siguen con la suya) y
-- generar_previstos_fijos igual que antes para las admins y el cron. No modifica filas
-- existentes: no hace falta respaldo. Se deshace con 20261026_cuentas_ninieras_DESHACER.sql.
-- ============================================================================
begin;

-- Cuenta de la niñera. Única: una cuenta, una ficha. Si se borra la cuenta, la ficha queda.
alter table public.ninieras add column user_id uuid;
alter table public.ninieras add constraint ninieras_user_id_key UNIQUE (user_id);
alter table public.ninieras add constraint ninieras_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
-- Primer ingreso a la app (lo pone ninera_activar_app); la admin lo ve en la ficha.
alter table public.ninieras add column app_activada_en timestamp with time zone;

-- Links de invitación y de cambio de contraseña. El token es largo y al azar, nunca el id de la
-- niñera. Solo el último link vigente de cada niñera sirve (reemplazada_en) y una sola vez
-- (usada_en, lo marca ninera-cuenta).
create table public.ninera_invitaciones (
  id uuid default gen_random_uuid() not null,
  ninera_id uuid not null,
  token text not null,
  creada_por text,
  creada_en timestamp with time zone default now() not null,
  vence_en timestamp with time zone not null,
  usada_en timestamp with time zone,
  reemplazada_en timestamp with time zone,
  constraint ninera_invitaciones_pkey PRIMARY KEY (id),
  constraint ninera_invitaciones_token_key UNIQUE (token)
);
alter table public.ninera_invitaciones add constraint ninera_invitaciones_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES ninieras(id) ON DELETE CASCADE;
CREATE INDEX ninera_invitaciones_ninera_id_idx ON public.ninera_invitaciones USING btree (ninera_id);
alter table public.ninera_invitaciones enable row level security;
create policy solo_autorizadas_todo on public.ninera_invitaciones as permissive for all to public
  using ((select public.es_usuaria_autorizada())) with check ((select public.es_usuaria_autorizada()));

-- Celular normalizado (regla del 26/10/2026): solo dígitos; se quita un 00 inicial (prefijo
-- internacional); si empieza en 598, el número local es el resto, si no, todo; del número local
-- se quita un 0 inicial (el 0 de larga distancia); el número local tiene que ser de 8 dígitos y
-- empezar en 9 → '598' || local; cualquier otra cosa → null (no se puede invitar: la admin
-- corrige el celular). Así '+598 99 123 456', '099123456', '99123456', '099-123-456',
-- '59899123456', '00598 99 123 456' y '+598 099 123 456' dan siempre '59899123456', y un número
-- de otro país, un fijo o uno incompleto da null.
-- Tiene que dar lo mismo que normalizarCelular() en js/comun.js y en ninera-cuenta.
create or replace function public.normalizar_celular(p text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case when l ~ '^9[0-9]{7}$' then '598' || l end
    from (select regexp_replace(case when d like '598%' then substr(d, 4) else d end, '^0', '') as l
            from (select regexp_replace(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '^00', '') as d) x) y
$function$;

-- Mail sintético de la cuenta de una niñera; null si el celular no normaliza. El dominio vive
-- solo acá en la base: tiene que ser igual a MAIL_DOMINIO_NINERA en js/comun.js y en la Edge
-- Function ninera-cuenta.
create or replace function public.mail_sintetico_ninera(p_celular text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select public.normalizar_celular(p_celular) || '@ninieras.parentsbreak.invalid'
$function$;

-- La niñera de la sesión: su ficha si está activa, o null (admin, cuenta sin ficha, dada de baja
-- o sin sesión). Mismo patrón que es_usuaria_autorizada(): security definer para leer ninieras
-- sin abrirle la tabla, y ejecutable por anon para que una política "to public" no falle.
-- Una cuenta nunca tiene los dos roles (26/10/2026): si una admin quedara vinculada a una ficha
-- por error, sigue siendo admin y no entra como niñera (null).
create or replace function public.ninera_actual()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select id from public.ninieras
   where user_id = auth.uid() and activa
     and not coalesce((select public.es_usuaria_autorizada()), false)
   limit 1
$function$;
revoke execute on function public.ninera_actual() from public;
grant execute on function public.ninera_actual() to authenticated, anon;

create or replace function public.es_ninera()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.ninera_actual() is not null
$function$;
revoke execute on function public.es_ninera() from public;
grant execute on function public.es_ninera() to authenticated, anon;

-- Primer ingreso a la app: anota la fecha una sola vez (nunca la pisa) y la devuelve; null si la
-- sesión no es de una niñera activa. Solo actualiza si estaba vacía, para no disparar un cambio
-- de Realtime en ninieras en cada ingreso.
create or replace function public.ninera_activar_app()
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_fecha timestamp with time zone;
begin
  if v_id is null then
    return null;
  end if;
  update public.ninieras set app_activada_en = now() where id = v_id and app_activada_en is null;
  select app_activada_en into v_fecha from public.ninieras where id = v_id;
  return v_fecha;
end
$function$;
-- En Supabase anon tiene execute por defecto en public: se le saca a mano.
revoke execute on function public.ninera_activar_app() from public, anon;
grant execute on function public.ninera_activar_app() to authenticated;

-- Link de invitación (o de cambio de contraseña, si ya tiene cuenta) para una niñera. Lo llama
-- la admin desde la ficha, con su sesión. Un link nuevo invalida los anteriores de esa niñera
-- que no se usaron. Token: dos gen_random_uuid() pegados sin guiones (64 hex; sin pgcrypto),
-- como cron_push_secret. La vigencia sale de app_config 'ninieras_app' (7 días si no está o no
-- sirve). No se invita a una niñera dada de baja ni a una con un celular que no normaliza.
create or replace function public.crear_invitacion_ninera(p_ninera_id uuid)
returns table (token text, vence_en timestamp with time zone, es_reset boolean)
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_telefono text;
  v_user_id uuid;
  v_activa boolean;
  v_dias text;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_vence timestamp with time zone;
begin
  if not coalesce((select public.es_usuaria_autorizada()), false) then
    raise exception 'no_autorizada';
  end if;
  -- for update: si dos admins generan el link a la vez, la segunda espera y reemplaza el de la
  -- primera; nunca quedan dos vigentes.
  select n.telefono, n.user_id, n.activa into v_telefono, v_user_id, v_activa
    from public.ninieras n where n.id = p_ninera_id for update;
  if not found then
    raise exception 'ninera_no_encontrada';
  end if;
  -- Dada de baja: no se invita (igual no vería nada: ninera_actual() pide activa).
  if not v_activa then
    raise exception 'ninera_inactiva';
  end if;
  if public.mail_sintetico_ninera(v_telefono) is null then
    raise exception 'celular_invalido';
  end if;
  -- Vigencia en días: si app_config trae algo que no es un entero positivo (texto, 0, negativo),
  -- 7. Así un valor mal cargado no frena todas las invitaciones ni crea links ya vencidos. El
  -- cast va solo cuando la expresión regular ya dijo que es un entero de 1 a 9999.
  v_dias := (select c.valor ->> 'vigencia_dias' from public.app_config c where c.id = 'ninieras_app');
  v_vence := now() + make_interval(days =>
    case when v_dias ~ '^[1-9][0-9]{0,3}$' then v_dias::int else 7 end);

  update public.ninera_invitaciones i set reemplazada_en = now()
   where i.ninera_id = p_ninera_id and i.usada_en is null and i.reemplazada_en is null;
  insert into public.ninera_invitaciones (ninera_id, token, creada_por, vence_en)
  values (p_ninera_id, v_token, coalesce(auth.email(), auth.uid()::text), v_vence);

  return query select v_token, v_vence, v_user_id is not null;
end
$function$;
revoke execute on function public.crear_invitacion_ninera(uuid) from public, anon;
grant execute on function public.crear_invitacion_ninera(uuid) to authenticated;

-- generar_previstos_fijos con guardia de admin (26/10/2026): el cuerpo es el mismo de
-- 20261023_variantes_precio.sql, copiado tal cual, con un solo cambio: la primera sentencia frena
-- a quien tenga sesión y no sea admin (ver el comentario adentro). Los permisos no cambian
-- (create or replace los conserva): authenticated la sigue pudiendo llamar, porque la app de las
-- admins la usa (sincronizarPrevistosFijos), y el cron la corre sin sesión.
create or replace function public.generar_previstos_fijos(p_dias integer default 14)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  hoy date := (now() at time zone 'America/Montevideo')::date;
  n_confirmados integer;
  n_borrados integer;
  n_actualizados integer;
  n_creados integer;
begin
  -- Solo una admin o la tarea programada (26/10/2026). Desde las cuentas de niñeras, un JWT
  -- "authenticated" ya no es siempre de una admin, y esta función es security definer: sin esto,
  -- una niñera podría llamarla y escribir previstos en sittings_traslados. pg_cron (la corrida de
  -- las 03:00) y la clave de servicio no traen 'sub' (auth.uid() es null) y pasan; la sesión de
  -- una niñera sí lo trae y no está en usuarias_autorizadas.
  if (select auth.uid()) is not null and not coalesce((select public.es_usuaria_autorizada()), false) then
    raise exception 'no_autorizada';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 60 then
    raise exception 'p_dias tiene que estar entre 1 y 60 (vino %)', p_dias;
  end if;
  -- Dos corridas a la vez (la de las 03:00 y una de la app) se esperan una a la otra.
  perform pg_advisory_xact_lock(hashtext('generar_previstos_fijos'));

  update sittings_traslados set estado = 'confirmado' where estado = 'previsto' and fecha <= hoy;
  get diagnostics n_confirmados = row_count;

  -- Se puede llamar más de una vez en la misma transacción (por ejemplo desde _ACTIVAR).
  drop table if exists pg_temp._previstos_deseados;
  create temporary table _previstos_deseados on commit drop as
  with dias as (
    select a.*, f.nombre as fam_nombre, f.cobro_hora as fam_cobro_hora, f.pago_hora as fam_pago_hora,
           f.terminos_aceptados_el as fam_terminos, d::date as dia
      from asignaciones a
      join familias f on f.id = a.familia_id
     cross join generate_series(hoy + 1, hoy + p_dias, interval '1 day') d
     where jsonb_typeof(a.dias) = 'array'
       and a.dias ? (array['D','L','M','X','J','V','S'])[extract(dow from d)::integer + 1]
       and a.hora_inicio is not null
       and (a.vigente_desde is null or a.vigente_desde <= d::date)
       and (a.vigente_hasta is null or a.vigente_hasta >= d::date)
       and not exists (select 1 from asignaciones_pausas p where p.asignacion_id = a.id and d::date between p.desde and p.hasta)
  ), con_horas as (
    select dias.*,
           coalesce(dias.tipo, 'sitting') as tipo_fijo,
           (dias.hora_fin is not null and dias.hora_fin <= dias.hora_inicio) as cruza,
           case when dias.hora_fin is null then null
                else (extract(epoch from dias.hora_fin) - extract(epoch from dias.hora_inicio)) / 3600.0
                     + case when dias.hora_fin <= dias.hora_inicio then 24 else 0 end
           end as horas,
           -- Términos y condiciones (20/10/2026): desde el día que los aceptó, a la familia se
           -- le cobra con el fin redondeado (minutos_fin_cobro); a la niñera, la hora real.
           case when dias.hora_fin is null then null
                when dias.fam_terminos is null or dias.dia < dias.fam_terminos then null
                else greatest(public.minutos_fin_cobro(
                       (extract(epoch from dias.hora_fin) / 60)::integer
                       + case when dias.hora_fin <= dias.hora_inicio then 1440 else 0 end)
                     - (extract(epoch from dias.hora_inicio) / 60)::integer, 0) / 60.0
           end as horas_cobro
      from dias
  )
  -- Montos sin centavos (21/10/2026): el cobro con redondear_cobro y el pago con redondear_pago.
  , base as (
  select c.id as asignacion_id, c.dia as fecha, c.familia_id, c.fam_nombre as familia_nombre,
         c.ninera_id, c.ninera_nombre, c.tipo_fijo as tipo, c.hora_inicio, c.hora_fin,
         c.cruza as termina_dia_siguiente,
         (array['D','L','M','X','J','V','S'])[extract(dow from c.dia)::integer + 1] as dia_codigo,
         case when c.tipo_fijo = 'traslado' then coalesce(c.cobro_traslado, t.cobro_familia, 0)
              else public.redondear_cobro(coalesce(c.horas_cobro, c.horas, 0) * coalesce(c.fam_cobro_hora, 0)) end as cobro_base,
         case when c.tipo_fijo = 'traslado' then coalesce(c.pago_traslado, t.pago_ninera, 0)
              else public.redondear_pago(coalesce(c.horas, 0) * coalesce(c.fam_pago_hora, 0)) end as pago_base
    from con_horas c
    -- Un traslado no se cobra por hora: el precio cargado en el fijo o, si no tiene, el del
    -- último traslado de ese fijo o de esa familia (lo mismo que precarga la app).
    left join lateral (
      select s.cobro_familia, s.pago_ninera
        from sittings_traslados s
       where c.tipo_fijo = 'traslado' and (c.cobro_traslado is null or c.pago_traslado is null)
         and s.tipo = 'traslado' and not s.cancelado and s.estado = 'confirmado'
         and (s.asignacion_id = c.id or s.familia_id = c.familia_id)
       order by (s.asignacion_id = c.id) desc, s.fecha desc
       limit 1
    ) t on true
  )
  -- Variantes programadas (23/10/2026): las de ese fijo que rigen ese día ("desde el 1/11, los
  -- martes la vuelta la hace el padre"), en el orden en que se crearon. Quedan anotadas en
  -- precio_variantes (la base y cuáles se aplicaron) y el motivo, el de la primera.
  select b.asignacion_id, b.fecha, b.familia_id, b.familia_nombre, b.ninera_id, b.ninera_nombre, b.tipo,
         b.hora_inicio, b.hora_fin, b.termina_dia_siguiente,
         coalesce((public.precio_con_variantes(b.cobro_base, b.pago_base, v.aplicadas)->>'cobro')::numeric, b.cobro_base) as cobro_familia,
         coalesce((public.precio_con_variantes(b.cobro_base, b.pago_base, v.aplicadas)->>'pago')::numeric, b.pago_base) as pago_ninera,
         case when v.aplicadas is null then null
              else jsonb_build_object('base', jsonb_build_object('cobro', b.cobro_base, 'pago', b.pago_base), 'aplicadas', v.aplicadas) end as precio_variantes,
         v.motivo as precio_motivo
    from base b
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', vp.id, 'nombre', vp.nombre, 'motivo', vp.motivo, 'programada', true,
               'cobro', case when vp.cobro_modo is null then null else jsonb_build_object('modo', vp.cobro_modo, 'valor', vp.cobro_valor) end,
               'pago', case when vp.pago_modo is null then null else jsonb_build_object('modo', vp.pago_modo, 'valor', vp.pago_valor) end)
               order by vp.created_at, vp.id) as aplicadas,
             (array_agg(vp.motivo order by vp.created_at, vp.id))[1] as motivo
        from variantes_precio vp
       where vp.asignacion_id = b.asignacion_id and vp.activa
         and vp.auto_desde is not null and vp.auto_desde <= b.fecha
         and (vp.auto_hasta is null or vp.auto_hasta >= b.fecha)
         and (vp.auto_dias is null or vp.auto_dias ? b.dia_codigo)
         and vp.aplica_a in (b.tipo, 'ambos')
    ) v on true;

  delete from sittings_traslados s
   where s.generado_automatico and s.estado = 'previsto' and s.fecha > hoy
     and not exists (select 1 from _previstos_deseados d where d.asignacion_id = s.asignacion_id and d.fecha = s.fecha);
  get diagnostics n_borrados = row_count;

  update sittings_traslados s
     set ninera_id = d.ninera_id, ninera_nombre = d.ninera_nombre, familia_nombre = d.familia_nombre,
         tipo = d.tipo, hora_inicio = d.hora_inicio, hora_fin = d.hora_fin,
         termina_dia_siguiente = d.termina_dia_siguiente,
         cobro_familia = d.cobro_familia, pago_ninera = d.pago_ninera,
         precio_variantes = d.precio_variantes, precio_motivo = d.precio_motivo
    from _previstos_deseados d
   where s.generado_automatico and s.estado = 'previsto' and s.fecha > hoy
     and d.asignacion_id = s.asignacion_id and d.fecha = s.fecha
     and (s.ninera_id, s.ninera_nombre, s.familia_nombre, s.tipo, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente, s.cobro_familia, s.pago_ninera, s.precio_variantes, s.precio_motivo)
         is distinct from
         (d.ninera_id, d.ninera_nombre, d.familia_nombre, d.tipo, d.hora_inicio, d.hora_fin, d.termina_dia_siguiente, d.cobro_familia, d.pago_ninera, d.precio_variantes, d.precio_motivo);
  get diagnostics n_actualizados = row_count;

  insert into sittings_traslados (tipo, registrado_por, asignacion_id, familia_id, familia_nombre, ninera_id,
         ninera_nombre, fecha, hora_inicio, hora_fin, termina_dia_siguiente, cobro_familia, pago_ninera,
         precio_variantes, precio_motivo, cobrado, pagado, cancelado, estado, generado_automatico, notas)
  select d.tipo, 'Automático', d.asignacion_id, d.familia_id, d.familia_nombre, d.ninera_id,
         d.ninera_nombre, d.fecha, d.hora_inicio, d.hora_fin, d.termina_dia_siguiente, d.cobro_familia, d.pago_ninera,
         d.precio_variantes, d.precio_motivo, false, false, false, 'previsto', true,
         case when d.tipo = 'traslado' then 'Traslado fijo' else 'Sitting fijo' end || ' — cargado automáticamente'
    from _previstos_deseados d
   where not exists (select 1 from sittings_traslados s where s.asignacion_id = d.asignacion_id and s.fecha = d.fecha)
     and not exists (select 1 from sittings_traslados s
                      where s.asignacion_id is null and s.fecha = d.fecha and s.familia_id = d.familia_id
                        and lower(trim(s.ninera_nombre)) = lower(trim(d.ninera_nombre)));
  get diagnostics n_creados = row_count;

  return jsonb_build_object('confirmados', n_confirmados, 'borrados', n_borrados,
                            'actualizados', n_actualizados, 'creados', n_creados, 'hoy', hoy);
end;
$function$;


-- Avisos push a niñeras: la suscripción lleva la cuenta (user_id) y cada cuenta lee, escribe y
-- borra solo las suyas. Las admins siguen con usuario (mail) y push_subscriptions_authenticated_all.
alter table public.push_subscriptions add column user_id uuid;
alter table public.push_subscriptions add constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX push_subscriptions_user_id_idx ON public.push_subscriptions USING btree (user_id);
create policy push_propias on public.push_subscriptions as permissive for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

insert into public.app_config (id, valor) values ('ninieras_app', '{"vigencia_dias": 7}')
on conflict (id) do nothing;

commit;
