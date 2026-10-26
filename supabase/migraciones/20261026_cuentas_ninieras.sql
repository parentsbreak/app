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
--   - app_config 'ninieras_app' con la vigencia del link (7 días).
--
-- Compatible con la app publicada: columnas nuevas vacías, una tabla nueva, funciones nuevas y
-- una política permisiva más en push_subscriptions (las admins siguen con la suya). No modifica
-- filas existentes: no hace falta respaldo. Se deshace con 20261026_cuentas_ninieras_DESHACER.sql.
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
create or replace function public.ninera_actual()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select id from public.ninieras where user_id = auth.uid() and activa limit 1
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
