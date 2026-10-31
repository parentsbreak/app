-- ============================================================================
-- Prueba de 20261101_temporada_app_DESHACER.sql con temporadas cargadas desde la app (01/11/2026), en
-- un Postgres LOCAL (nunca en producción). Lo que se verifica: los lugares quedan copiados con su
-- fecha en respaldo_temporada_lugares_20261101 (con RLS y sin políticas), temporada queda como
-- estaba, se borran solo los avisos de la temporada sin enviar y no queda nada de la migración.
-- Corre después de la migración, de los datos y del DESHACER, en ese orden:
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261101_temporada_app.sql \
--     --migracion supabase/pruebas/deshacer/20261101_temporada_app_datos.sql \
--     --migracion supabase/migraciones/20261101_temporada_app_DESHACER.sql \
--     supabase/pruebas/deshacer/20261101_temporada_app.sql
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

select pg_temp.verificar('el respaldo tiene a Ana, con sus lugares y la fecha, y a nadie más',
  (select count(*) = 1
          and bool_and(id = 'f2000000-0000-4000-8000-000000000001'
                       and temporada_lugares = '{"0": "punta", "1": "punta", "5": {"otro": "Rocha"}}'::jsonb
                       and temporada_lugares_en = '2026-10-20 10:00-03'::timestamptz)
     from public.respaldo_temporada_lugares_20261101));
select pg_temp.verificar('el respaldo con RLS y sin políticas',
  (select relrowsecurity from pg_class where oid = 'public.respaldo_temporada_lugares_20261101'::regclass)
  and not exists (select 1 from pg_policies where tablename = 'respaldo_temporada_lugares_20261101'));
select pg_temp.verificar('temporada de Ana como estaba',
  (select temporada = '{"f6000000-0000-4000-8000-000000000003": [0, 1]}'::jsonb and temporada_fuente = 'app'
     from public.ninieras where id = 'f2000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('avisos: se va el pendiente de la temporada; quedan el enviado y el del chat',
  (select array_agg(clave order by clave) = array['chat:prueba', 'temporada:2026:f2000000-0000-4000-8000-000000000001']
     from public.avisos));
select pg_temp.verificar('sin las columnas',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ninieras'
               and column_name in ('temporada_lugares', 'temporada_lugares_en')));
select pg_temp.verificar('sin las funciones',
  not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
               and proname in ('inicio_temporada_mvd', 'ninera_mi_temporada', 'ninera_guardar_temporada', 'programar_avisos_temporada')));
select pg_temp.verificar('programar_avisos vuelve a no programar nada', public.programar_avisos() = 0);

rollback;
