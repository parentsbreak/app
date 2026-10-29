-- ============================================================================
-- Prueba de 20261029_avisos_chat_DESHACER.sql con mensajes en el chat (29/10/2026), en un Postgres
-- LOCAL (nunca en producción). Lo que se verifica: los mensajes quedan copiados tal cual en
-- respaldo_chat_20261029 (con RLS y sin políticas) y no queda nada de la migración (tablas, cron,
-- Realtime, funciones).
-- Corre después de la migración, de los datos y del DESHACER, en ese orden:
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261029_avisos_chat.sql \
--     --migracion supabase/pruebas/deshacer/20261029_avisos_chat_datos.sql \
--     --migracion supabase/migraciones/20261029_avisos_chat_DESHACER.sql \
--     supabase/pruebas/deshacer/20261029_avisos_chat.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- Está en una subcarpeta para que no entre en supabase/pruebas/*.sql: suelta, sin los pasos
-- anteriores, fallaría.
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;

select pg_temp.verificar('respaldo_chat_20261029 existe, con RLS y sin políticas',
  (select relrowsecurity from pg_class where oid = to_regclass('public.respaldo_chat_20261029'))
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'respaldo_chat_20261029'));
select pg_temp.verificar('los tres mensajes, tal cual (autor, de, texto y lo leído)',
  (select count(*) = 3 from public.respaldo_chat_20261029)
  and exists (select 1 from public.respaldo_chat_20261029 where id = 'f3000000-0000-4000-8000-000000000001'
                and de = 'admin' and autor = 'Paula Prueba' and texto = 'Hola Ana'
                and leido_ninera_en = '2026-10-29 10:00-03'::timestamptz and leido_admin_en is null
                and ninera_id = 'f2000000-0000-4000-8000-000000000001' and creado_en is not null)
  and exists (select 1 from public.respaldo_chat_20261029 where id = 'f3000000-0000-4000-8000-000000000002'
                and de = 'ninera' and autor = 'Ana Ficticia' and texto = 'Hola equipo')
  and exists (select 1 from public.respaldo_chat_20261029 where id = 'f3000000-0000-4000-8000-000000000003'
                and texto = '<b>sin</b> perder nada'));
select pg_temp.verificar('no quedan las tablas avisos ni chat_mensajes',
  to_regclass('public.avisos') is null and to_regclass('public.chat_mensajes') is null);
select pg_temp.verificar('no queda el cron enviar-avisos',
  not exists (select 1 from cron.job where jobname = 'enviar-avisos'));
select pg_temp.verificar('no queda nada en Realtime de la migración',
  not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
               and tablename in ('avisos', 'chat_mensajes')));
select pg_temp.verificar('no queda ninguna de las once funciones',
  not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
               and proname in ('encolar_aviso', 'reclamar_avisos', 'programar_avisos', 'admins_activas_mails',
                               'ninera_enviar_mensaje', 'ninera_marcar_chat_leido', 'ninera_marcar_avisos_leidos',
                               'chat_mensajes_encolar_aviso', 'avisos_disparar_envio', 'llamar_enviar_avisos',
                               'correr_cron_avisos')));
select pg_temp.verificar('la ficha de la niñera sigue (el DESHACER no toca ninieras)',
  exists (select 1 from ninieras where id = 'f2000000-0000-4000-8000-000000000001'));

rollback;
