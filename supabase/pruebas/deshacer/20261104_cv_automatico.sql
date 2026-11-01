-- ============================================================================
-- Prueba de 20261104_cv_automatico_DESHACER.sql con líneas del CV cargadas (01/11/2026), en un
-- Postgres LOCAL (nunca en producción). Lo que se verifica: las líneas y con qué se dibujó quedan
-- copiadas en respaldo_cv_automatico_20261104 (con RLS y sin políticas), cv_url y cv_generado_en
-- quedan como estaban y no queda nada de la migración. Corre después de la migración, de los datos y
-- del DESHACER, en ese orden:
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261104_cv_automatico.sql \
--     --migracion supabase/pruebas/deshacer/20261104_cv_automatico_datos.sql \
--     --migracion supabase/migraciones/20261104_cv_automatico_DESHACER.sql \
--     supabase/pruebas/deshacer/20261104_cv_automatico.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;

select pg_temp.verificar('ya no están las columnas nuevas',
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'ninieras'
                 and column_name in ('cv_datos', 'cv_generado_con')));
select pg_temp.verificar('ya no están los checks',
  not exists (select 1 from pg_constraint where conname in ('ninieras_cv_datos_objeto', 'ninieras_cv_generado_con_objeto')));
select pg_temp.verificar('el respaldo tiene solo la niñera con datos del CV, con sus líneas',
  (select count(*) = 1 and bool_and(id = 'f4000000-0000-4000-8000-000000000001'
                                    and cv_datos->>'estudios' = 'Estudiante de Medicina'
                                    and cv_generado_con->>'nombre' = 'Ana Ficticia'
                                    and cv_url = 'https://ejemplo.invalid/cv-ana.png')
     from respaldo_cv_automatico_20261104));
select pg_temp.verificar('el respaldo tiene RLS y ninguna política',
  (select relrowsecurity from pg_class where oid = 'public.respaldo_cv_automatico_20261104'::regclass)
  and not exists (select 1 from pg_policies where tablename = 'respaldo_cv_automatico_20261104'));
select pg_temp.verificar('cv_url y cv_generado_en quedan como estaban',
  (select cv_url = 'https://ejemplo.invalid/cv-ana.png' and cv_generado_en = '2026-11-01'
     from ninieras where id = 'f4000000-0000-4000-8000-000000000001'));

rollback;
