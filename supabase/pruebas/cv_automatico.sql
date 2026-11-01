-- ============================================================================
-- Prueba de 20261104_cv_automatico.sql (01/11/2026) en un Postgres LOCAL (nunca en producción).
-- Datos inventados. Corre sobre supabase/schema.sql (ya trae las columnas) o sobre el schema de main
-- con la migración, y también aplicar, deshacer y volver a aplicar:
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261104_cv_automatico.sql \
--     --migracion supabase/migraciones/20261104_cv_automatico_DESHACER.sql \
--     --migracion supabase/migraciones/20261104_cv_automatico.sql supabase/pruebas/cv_automatico.sql
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;
-- true si la sentencia choca con un check (23514).
create function pg_temp.rechaza(sentencia text) returns boolean language plpgsql as $$
begin
  execute sentencia;
  return false;
exception when check_violation then
  return true;
end $$;

select pg_temp.verificar('ninieras tiene cv_datos y cv_generado_con (jsonb)',
  (select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'ninieras'
      and column_name in ('cv_datos', 'cv_generado_con') and data_type = 'jsonb'));

insert into ninieras (id, nombre) values
  ('e4000000-0000-4000-8000-000000000001', 'Ana Ficticia'),
  ('e4000000-0000-4000-8000-000000000002', 'Bruno Inventado');

select pg_temp.verificar('una niñera nueva no tiene datos del CV (la app precarga)',
  (select cv_datos is null and cv_generado_con is null from ninieras where id = 'e4000000-0000-4000-8000-000000000002'));

update ninieras
   set cv_datos = '{"estudios": "Estudiante de Medicina", "experiencia": "", "panales": "Cambia pañales"}',
       cv_generado_con = '{"nombre": "Ana Ficticia", "foto": null, "lineas": ["21 años", "Estudiante de Medicina", "Cambia pañales"]}',
       cv_url = 'https://ejemplo.invalid/cv.png', cv_generado_en = '2026-11-01'
 where id = 'e4000000-0000-4000-8000-000000000001';
select pg_temp.verificar('guarda las líneas y con qué se dibujó',
  (select cv_datos->>'estudios' = 'Estudiante de Medicina' and cv_generado_con->'lineas'->>2 = 'Cambia pañales'
     from ninieras where id = 'e4000000-0000-4000-8000-000000000001'));

select pg_temp.verificar('cv_datos tiene que ser un objeto (una lista no)',
  pg_temp.rechaza($$update ninieras set cv_datos = '["21 años"]' where id = 'e4000000-0000-4000-8000-000000000002'$$));
select pg_temp.verificar('cv_datos tiene que ser un objeto (un texto no)',
  pg_temp.rechaza($$update ninieras set cv_datos = '"21 años"' where id = 'e4000000-0000-4000-8000-000000000002'$$));
select pg_temp.verificar('cv_generado_con tiene que ser un objeto',
  pg_temp.rechaza($$update ninieras set cv_generado_con = '[]' where id = 'e4000000-0000-4000-8000-000000000002'$$));
select pg_temp.verificar('volver a null está permitido',
  not pg_temp.rechaza($$update ninieras set cv_datos = null, cv_generado_con = null where id = 'e4000000-0000-4000-8000-000000000001'$$));

rollback;
