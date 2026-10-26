-- ============================================================================
-- Prueba de 20261026_cuentas_ninieras.sql en un Postgres LOCAL (nunca en producción): celular
-- normalizado y mail sintético, ninera_actual() y la RLS vista desde la cuenta de una niñera,
-- ninera_activar_app(), crear_invitacion_ninera(), push_subscriptions propias, la guardia de admin
-- de generar_previstos_fijos() y una cuenta con un solo rol. Datos inventados. La lista permitida
-- de funciones security definer está aparte, en catalogo_seguridad.sql.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_cuentas_ninieras.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261026_cuentas_ninieras.sql supabase/pruebas/fase1_cuentas_ninieras.sql
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261026_cuentas_ninieras.sql \
--     --migracion supabase/migraciones/20261026_cuentas_ninieras_DESHACER.sql \
--     --migracion supabase/migraciones/20261026_cuentas_ninieras.sql supabase/pruebas/fase1_cuentas_ninieras.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- Para "ser" una cuenta: set local role authenticated + set local request.jwt.claims (el
-- auth.uid() de mentira de scripts/probar-sql.mjs lee el 'sub' de ahí). reset role vuelve a
-- postgres. Todo termina en rollback.
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;
-- El mensaje del error que tira la sentencia, o null si no falla.
create function pg_temp.error_de(sentencia text) returns text language plpgsql as $$
begin
  execute sentencia;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Todo lo de la migración está (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('columnas nuevas en ninieras y push_subscriptions',
  (select count(*) = 3 from information_schema.columns where table_schema = 'public'
    and ((table_name = 'ninieras' and column_name in ('user_id', 'app_activada_en'))
      or (table_name = 'push_subscriptions' and column_name = 'user_id'))));
select pg_temp.verificar('tabla ninera_invitaciones con RLS', (select relrowsecurity from pg_class where oid = to_regclass('public.ninera_invitaciones')));
select pg_temp.verificar('las seis funciones',
  (select count(*) = 6 from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('normalizar_celular', 'mail_sintetico_ninera', 'ninera_actual', 'es_ninera', 'ninera_activar_app', 'crear_invitacion_ninera')));
select pg_temp.verificar('políticas push_propias y de invitaciones, una sola vez cada una',
  (select count(*) = 1 from pg_policies where tablename = 'push_subscriptions' and policyname = 'push_propias')
  and (select count(*) = 1 from pg_policies where tablename = 'ninera_invitaciones'));
select pg_temp.verificar('fila ninieras_app en app_config', exists (select 1 from app_config where id = 'ninieras_app'));

-- ---------------------------------------------------------------------------
-- Celular normalizado y mail sintético (la misma regla que comun.js y ninera-cuenta)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('celular escrito de siete formas: siempre 59899123456',
  -- "is not distinct from": un null tiene que contar como falla (bool_and ignora los null).
  (select count(*) = 7 and bool_and(public.normalizar_celular(c) is not distinct from '59899123456')
     from unnest(array['+598 99 123 456', '099123456', '99123456', '099-123-456', '59899123456',
                       '00598 99 123 456', '+598 099 123 456']) c));
select pg_temp.verificar('celular corto, de otro país, vacío o null: null',
  (select bool_and(public.normalizar_celular(c) is null)
     from unnest(array['123', '+54 11 5555 5555', '', null]) c));
select pg_temp.verificar('fijo uruguayo (no empieza en 9): null', public.normalizar_celular('2901 2345') is null);
select pg_temp.verificar('mail sintético del celular', public.mail_sintetico_ninera('099123456') = '59899123456@ninieras.parentsbreak.invalid');
select pg_temp.verificar('mail sintético: el mismo con otro formato', public.mail_sintetico_ninera('+598 99 123 456') = '59899123456@ninieras.parentsbreak.invalid');
select pg_temp.verificar('mail sintético de un celular que no normaliza: null',
  public.mail_sintetico_ninera('+54 11 5555 5555') is null and public.mail_sintetico_ninera(null) is null);
select pg_temp.verificar('normalizar_celular y mail_sintetico_ninera son immutable',
  (select count(*) = 2 and bool_and(provolatile = 'i') from pg_proc
    where proname in ('normalizar_celular', 'mail_sintetico_ninera') and pronamespace = 'public'::regnamespace));

-- ---------------------------------------------------------------------------
-- Datos inventados: una admin, dos niñeras con cuenta, una sin cuenta y una con celular malo
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1000000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('c1000000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid'),
  ('c1000000-0000-4000-8000-000000000002', '59899000002@ninieras.parentsbreak.invalid'),
  ('c1000000-0000-4000-8000-000000000003', 'sin.ficha@ejemplo.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('c1000000-0000-4000-8000-0000000000a1', 'desarrollo');
insert into ninieras (id, nombre, telefono, user_id) values
  ('c2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002', 'Beatriz Ejemplo', '099 000 002', 'c1000000-0000-4000-8000-000000000002'),
  ('c2000000-0000-4000-8000-000000000003', 'Carla Muestra', '123', null),
  ('c2000000-0000-4000-8000-000000000004', 'Dora Prueba', '+598 99 000 004', null);
insert into sittings_traslados (tipo, familia_nombre, ninera_id, ninera_nombre, fecha, cobro_familia, pago_ninera) values
  ('sitting', 'Familia Prueba Uno', 'c2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '2026-11-02', 1000, 600);

select pg_temp.verificar('ninieras.user_id y app_activada_en existen, vacías por defecto',
  (select user_id is null and app_activada_en is null from ninieras where id = 'c2000000-0000-4000-8000-000000000003'));
select pg_temp.verificar('una cuenta no puede quedar vinculada a dos niñeras',
  pg_temp.error_de($$update ninieras set user_id = 'c1000000-0000-4000-8000-000000000001' where id = 'c2000000-0000-4000-8000-000000000004'$$) is not null);
select pg_temp.verificar('app_config ninieras_app con vigencia de 7 días',
  (select valor ->> 'vigencia_dias' = '7' from app_config where id = 'ninieras_app'));
select pg_temp.verificar('funciones security definer con search_path fijo',
  (select count(*) = 4 from pg_proc
    where pronamespace = 'public'::regnamespace and prosecdef
      and proname in ('ninera_actual', 'es_ninera', 'ninera_activar_app', 'crear_invitacion_ninera')
      and exists (select 1 from unnest(proconfig) c where c like 'search_path=%')));
select pg_temp.verificar('ninera_actual, es_ninera: authenticated y anon pueden (como es_usuaria_autorizada)',
  has_function_privilege('authenticated', 'public.ninera_actual()', 'execute')
  and has_function_privilege('anon', 'public.ninera_actual()', 'execute')
  and has_function_privilege('authenticated', 'public.es_ninera()', 'execute'));
select pg_temp.verificar('ninera_activar_app y crear_invitacion_ninera: authenticated sí, anon no',
  has_function_privilege('authenticated', 'public.ninera_activar_app()', 'execute')
  and has_function_privilege('authenticated', 'public.crear_invitacion_ninera(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_activar_app()', 'execute')
  and not has_function_privilege('anon', 'public.crear_invitacion_ninera(uuid)', 'execute'));

-- ---------------------------------------------------------------------------
-- Desde la cuenta de Ana (niñera activa)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('sin sesión (postgres) el sitting de Ana está', (select count(*) = 1 from sittings_traslados));
set local role authenticated;
set local request.jwt.claims = '{"sub": "c1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('la prueba corre como authenticated, con su sub', current_user = 'authenticated' and auth.uid() = 'c1000000-0000-4000-8000-000000000001');
select pg_temp.verificar('ninera_actual() es su ficha', public.ninera_actual() = 'c2000000-0000-4000-8000-000000000001');
select pg_temp.verificar('es_ninera() true y no es admin', public.es_ninera() and not public.es_usuaria_autorizada());
select pg_temp.verificar('lectura directa de sittings_traslados: 0 filas (ni los suyos)', (select count(*) = 0 from sittings_traslados));
select pg_temp.verificar('lectura directa de ninieras: 0 filas (ni la suya)', (select count(*) = 0 from ninieras));
select pg_temp.verificar('lectura directa de familias y app_config: 0 filas',
  (select count(*) = 0 from familias) and (select count(*) = 0 from app_config));
select pg_temp.verificar('no puede cambiar su ficha directo (0 filas)',
  pg_temp.error_de($q$do $x$ declare n int; begin
     update ninieras set app_activada_en = '2020-01-01' where id = 'c2000000-0000-4000-8000-000000000001';
     get diagnostics n = row_count; if n > 0 then raise exception 'actualizó'; end if; end $x$ $q$) is null);
select pg_temp.verificar('activar la app la primera vez pone la fecha', public.ninera_activar_app() is not null);
reset role;
select pg_temp.verificar('la fecha quedó en su ficha',
  (select app_activada_en is not null from ninieras where id = 'c2000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('a Beatriz no la tocó',
  (select app_activada_en is null from ninieras where id = 'c2000000-0000-4000-8000-000000000002'));
-- Para ver que no la pisa: la fecha queda en el pasado y se vuelve a activar.
update ninieras set app_activada_en = '2026-10-01 12:00-03' where id = 'c2000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.verificar('activar de nuevo no pisa la primera fecha', public.ninera_activar_app() = '2026-10-01 12:00-03'::timestamptz);
reset role;
select pg_temp.verificar('la ficha sigue con la primera fecha',
  (select app_activada_en = '2026-10-01 12:00-03'::timestamptz from ninieras where id = 'c2000000-0000-4000-8000-000000000001'));

-- Dada de baja: sin rol de niñera.
update ninieras set activa = false where id = 'c2000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.verificar('niñera dada de baja: ninera_actual() null y es_ninera() false', public.ninera_actual() is null and not public.es_ninera());
select pg_temp.verificar('niñera dada de baja: activar devuelve null', public.ninera_activar_app() is null);
reset role;
update ninieras set activa = true where id = 'c2000000-0000-4000-8000-000000000001';

-- Cuenta sin ficha de niñera (ni admin): nada.
set local role authenticated;
set local request.jwt.claims = '{"sub": "c1000000-0000-4000-8000-000000000003", "email": "sin.ficha@ejemplo.invalid"}';
select pg_temp.verificar('cuenta sin ficha: ninera_actual() null, activar null, 0 sittings',
  public.ninera_actual() is null and public.ninera_activar_app() is null and (select count(*) = 0 from sittings_traslados));
reset role;

-- Sin sesión (anon).
set local request.jwt.claims = '';
set local role anon;
select pg_temp.verificar('anon: ninera_actual() null', public.ninera_actual() is null);
select pg_temp.verificar('anon: no puede activar', pg_temp.error_de('select public.ninera_activar_app()') like '%permission denied%');
select pg_temp.verificar('anon: no puede crear invitaciones',
  pg_temp.error_de($$select * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-000000000004')$$) like '%permission denied%');
reset role;

-- ---------------------------------------------------------------------------
-- Invitaciones (la admin genera el link desde la ficha)
-- ---------------------------------------------------------------------------
create temp table inv (n int, token text, vence_en timestamptz, es_reset boolean);
grant all on inv to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub": "c1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
insert into inv select 1, * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-000000000004');
select pg_temp.verificar('la admin no es niñera', public.ninera_actual() is null);
select pg_temp.verificar('token de 64 hex, vence en 7 días, no es reset (no tiene cuenta)',
  (select token ~ '^[0-9a-f]{64}$' and vence_en between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute'
          and es_reset = false from inv where n = 1));
select pg_temp.verificar('la admin ve la invitación, con quién la creó',
  (select count(*) = 1 and bool_and(creada_por = 'admin.prueba@ejemplo.invalid' and usada_en is null and reemplazada_en is null)
     from ninera_invitaciones where ninera_id = 'c2000000-0000-4000-8000-000000000004'));
insert into inv select 2, * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-000000000004');
select pg_temp.verificar('un link nuevo: otro token', (select count(distinct token) = 2 from inv));
select pg_temp.verificar('un link nuevo deja el anterior reemplazado y solo uno vigente',
  (select reemplazada_en is not null from ninera_invitaciones where token = (select token from inv where n = 1))
  and (select count(*) = 1 from ninera_invitaciones
        where ninera_id = 'c2000000-0000-4000-8000-000000000004' and reemplazada_en is null and usada_en is null)
  and (select reemplazada_en is null from ninera_invitaciones where token = (select token from inv where n = 2)));
insert into inv select 3, * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-000000000001');
select pg_temp.verificar('niñera con cuenta: es un link para cambiar la contraseña (es_reset)', (select es_reset from inv where n = 3));
select pg_temp.verificar('el link de otra niñera no reemplaza los de Dora',
  (select count(*) = 1 from ninera_invitaciones
    where ninera_id = 'c2000000-0000-4000-8000-000000000004' and reemplazada_en is null));
select pg_temp.verificar('niñera con celular que no normaliza: celular_invalido',
  pg_temp.error_de($$select * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-000000000003')$$) like '%celular_invalido%');
select pg_temp.verificar('niñera que no existe: ninera_no_encontrada',
  pg_temp.error_de($$select * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-0000000000ff')$$) like '%ninera_no_encontrada%');
reset role;
-- Dada de baja: no se invita, y no queda ningún link suyo.
update ninieras set activa = false where id = 'c2000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.verificar('niñera dada de baja: ninera_inactiva',
  pg_temp.error_de($$select * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-000000000002')$$) like '%ninera_inactiva%');
select pg_temp.verificar('niñera dada de baja: sin invitación creada',
  not exists (select 1 from ninera_invitaciones where ninera_id = 'c2000000-0000-4000-8000-000000000002'));
reset role;
update ninieras set activa = true where id = 'c2000000-0000-4000-8000-000000000002';
-- La vigencia sale de app_config.
update app_config set valor = '{"vigencia_dias": 3}' where id = 'ninieras_app';
set local role authenticated;
insert into inv select 4, * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-000000000004');
select pg_temp.verificar('con vigencia_dias 3 en app_config, vence en 3 días',
  (select vence_en between now() + interval '3 days' - interval '1 minute' and now() + interval '3 days' + interval '1 minute' from inv where n = 4));
reset role;
-- Un valor mal cargado (texto, 0, negativo) no frena las invitaciones ni crea links vencidos: 7 días.
update app_config set valor = '{"vigencia_dias": "siete"}' where id = 'ninieras_app';
set local role authenticated;
insert into inv select 6, * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-000000000004');
reset role;
update app_config set valor = '{"vigencia_dias": 0}' where id = 'ninieras_app';
set local role authenticated;
insert into inv select 7, * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-000000000004');
reset role;
update app_config set valor = '{"vigencia_dias": -2}' where id = 'ninieras_app';
set local role authenticated;
insert into inv select 8, * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-000000000004');
select pg_temp.verificar('vigencia_dias "siete", 0 o -2 en app_config: 7 días',
  (select count(*) = 3 and bool_and(vence_en between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute')
     from inv where n in (6, 7, 8)));
reset role;
delete from app_config where id = 'ninieras_app';
set local role authenticated;
insert into inv select 5, * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-000000000004');
select pg_temp.verificar('sin la fila de app_config, 7 días',
  (select vence_en between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute' from inv where n = 5));
reset role;

-- Como niñera: no crea invitaciones ni las ve.
set local role authenticated;
set local request.jwt.claims = '{"sub": "c1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('una niñera no puede crear invitaciones (no_autorizada)',
  pg_temp.error_de($$select * from public.crear_invitacion_ninera('c2000000-0000-4000-8000-000000000001')$$) like '%no_autorizada%');
select pg_temp.verificar('una niñera no ve invitaciones (ni las suyas)', (select count(*) = 0 from ninera_invitaciones));
select pg_temp.verificar('una niñera no puede insertar invitaciones',
  pg_temp.error_de($$insert into ninera_invitaciones (ninera_id, token, vence_en) values ('c2000000-0000-4000-8000-000000000001', 'x', now() + interval '1 day')$$) is not null);
reset role;
select pg_temp.verificar('invitaciones: RLS prendida y la política pide admin',
  (select relrowsecurity from pg_class where oid = 'public.ninera_invitaciones'::regclass)
  and exists (select 1 from pg_policies where tablename = 'ninera_invitaciones' and qual like '%es_usuaria_autorizada%'));
select pg_temp.verificar('token único', pg_temp.error_de(
  $$insert into ninera_invitaciones (ninera_id, token, vence_en) select ninera_id, token, vence_en from ninera_invitaciones limit 1$$) is not null);

-- ---------------------------------------------------------------------------
-- push_subscriptions: cada cuenta las suyas; las admins, todas (política de siempre)
-- ---------------------------------------------------------------------------
insert into push_subscriptions (usuario, endpoint, p256dh, auth_key, user_id) values
  ('59899000002@ninieras.parentsbreak.invalid', 'https://push.ejemplo.invalid/b', 'k', 'a', 'c1000000-0000-4000-8000-000000000002'),
  ('admin.prueba@ejemplo.invalid', 'https://push.ejemplo.invalid/admin', 'k', 'a', null);
set local role authenticated;
set local request.jwt.claims = '{"sub": "c1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
insert into push_subscriptions (usuario, endpoint, p256dh, auth_key, user_id)
  values ('59899000001@ninieras.parentsbreak.invalid', 'https://push.ejemplo.invalid/a', 'k', 'a', 'c1000000-0000-4000-8000-000000000001');
select pg_temp.verificar('la niñera ve solo su suscripción', (select count(*) = 1 and bool_and(endpoint = 'https://push.ejemplo.invalid/a') from push_subscriptions));
select pg_temp.verificar('no puede insertar a nombre de otra cuenta',
  pg_temp.error_de($$insert into push_subscriptions (usuario, endpoint, p256dh, auth_key, user_id)
    values ('x', 'https://push.ejemplo.invalid/x', 'k', 'a', 'c1000000-0000-4000-8000-000000000002')$$) is not null);
select pg_temp.verificar('no puede insertar sin user_id',
  pg_temp.error_de($$insert into push_subscriptions (usuario, endpoint, p256dh, auth_key)
    values ('x', 'https://push.ejemplo.invalid/y', 'k', 'a')$$) is not null);
delete from push_subscriptions where endpoint in ('https://push.ejemplo.invalid/b', 'https://push.ejemplo.invalid/admin');
update push_subscriptions set p256dh = 'k2';
reset role;
select pg_temp.verificar('no borró ni cambió las de otras; la suya sí la cambia',
  (select count(*) = 3 from push_subscriptions)
  and (select p256dh = 'k' from push_subscriptions where endpoint = 'https://push.ejemplo.invalid/b')
  and (select p256dh = 'k2' from push_subscriptions where endpoint = 'https://push.ejemplo.invalid/a'));
set local role authenticated;
set local request.jwt.claims = '{"sub": "c1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('la admin sigue viendo todas', (select count(*) = 3 from push_subscriptions));
reset role;
select pg_temp.verificar('push_subscriptions: las dos políticas',
  (select count(*) = 2 from pg_policies where tablename = 'push_subscriptions'
    and policyname in ('push_subscriptions_authenticated_all', 'push_propias')));

-- ---------------------------------------------------------------------------
-- generar_previstos_fijos (security definer, escribe en sittings_traslados): solo una admin o
-- la tarea programada, que corre sin sesión (26/10/2026). Un fijo de todos los días para Ana.
-- ---------------------------------------------------------------------------
insert into familias (id, nombre, cobro_hora, pago_hora) values ('c3000000-0000-4000-8000-000000000001', 'Familia Prueba Dos', 300, 200);
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo) values
  ('c4000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Ana Ficticia',
   '["L","M","X","J","V","S","D"]', '16:00', '19:00', (now() at time zone 'America/Montevideo')::date - 1, 'sitting');
create temp table previstos_corrida (quien text, resultado jsonb);
grant all on previstos_corrida to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub": "c1000000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('es la sesión de una niñera (Beatriz)', public.es_ninera() and not public.es_usuaria_autorizada());
select pg_temp.verificar('una niñera no puede generar previstos (no_autorizada)',
  pg_temp.error_de('select public.generar_previstos_fijos(1)') like '%no_autorizada%');
reset role;
select pg_temp.verificar('la corrida de la niñera no escribió nada',
  not exists (select 1 from sittings_traslados where asignacion_id = 'c4000000-0000-4000-8000-000000000001'));
set local role authenticated;
set local request.jwt.claims = '{"sub": "c1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
insert into previstos_corrida select 'admin', public.generar_previstos_fijos(1);
reset role;
select pg_temp.verificar('la admin sí: carga el previsto de mañana',
  (select (resultado ->> 'creados')::int = 1 from previstos_corrida where quien = 'admin')
  and (select count(*) = 1 from sittings_traslados where asignacion_id = 'c4000000-0000-4000-8000-000000000001' and estado = 'previsto'));
-- La tarea programada: sin claims (auth.uid() null), como pg_cron.
set local request.jwt.claims = '';
insert into previstos_corrida select 'cron', public.generar_previstos_fijos(2);
select pg_temp.verificar('sin sesión (cron) también: carga el de pasado mañana',
  (select (resultado ->> 'creados')::int = 1 from previstos_corrida where quien = 'cron')
  and (select count(*) = 2 from sittings_traslados where asignacion_id = 'c4000000-0000-4000-8000-000000000001' and estado = 'previsto'));

-- ---------------------------------------------------------------------------
-- Una cuenta, un rol: una admin vinculada por error a una ficha sigue siendo solo admin
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('c1000000-0000-4000-8000-0000000000a2', 'admin.dos@ejemplo.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('c1000000-0000-4000-8000-0000000000a2', 'desarrollo');
update ninieras set user_id = 'c1000000-0000-4000-8000-0000000000a2' where id = 'c2000000-0000-4000-8000-000000000003';
set local role authenticated;
set local request.jwt.claims = '{"sub": "c1000000-0000-4000-8000-0000000000a2", "email": "admin.dos@ejemplo.invalid"}';
select pg_temp.verificar('admin con ficha vinculada: ninera_actual() null, es_ninera() false, sigue admin',
  public.ninera_actual() is null and not public.es_ninera() and public.es_usuaria_autorizada());
select pg_temp.verificar('admin con ficha vinculada: activar la app devuelve null', public.ninera_activar_app() is null);
reset role;
select pg_temp.verificar('y no le anotó el ingreso a la ficha',
  (select app_activada_en is null from ninieras where id = 'c2000000-0000-4000-8000-000000000003'));

-- ---------------------------------------------------------------------------
-- Borrar la cuenta: la ficha queda sin vínculo y sus suscripciones se van
-- ---------------------------------------------------------------------------
delete from auth.users where id = 'c1000000-0000-4000-8000-000000000001';
select pg_temp.verificar('borrar la cuenta deja la ficha sin user_id',
  (select user_id is null from ninieras where id = 'c2000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('borrar la cuenta borra sus suscripciones',
  (select count(*) = 0 from push_subscriptions where endpoint = 'https://push.ejemplo.invalid/a'));
delete from ninieras where id = 'c2000000-0000-4000-8000-000000000004';
select pg_temp.verificar('borrar la ficha borra sus invitaciones',
  not exists (select 1 from ninera_invitaciones where ninera_id = 'c2000000-0000-4000-8000-000000000004'));

rollback;
