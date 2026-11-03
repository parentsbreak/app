-- ============================================================================
-- Prueba de 20261110_dia_traslados_DESHACER.sql con traslados cargados (03/11/2026), en un Postgres LOCAL (nunca en
-- producción). Lo que se verifica: los eventos y el cierre del traslado quedan copiados enteros en
-- respaldo_dia_traslados_20261110_eventos y _cierres (con RLS y sin políticas) y salen de las tablas; lo del sitting
-- no se toca; vuelven el check de los tipos, hora_fin obligatoria y la configuración de antes, y no queda
-- ninera_cerrar_traslado. Corre después de la migración, de los datos y del DESHACER:
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261110_dia_traslados.sql \
--     --migracion supabase/pruebas/deshacer/20261110_dia_traslados_datos.sql \
--     --migracion supabase/migraciones/20261110_dia_traslados_DESHACER.sql \
--     supabase/pruebas/deshacer/20261110_dia_traslados.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;

select pg_temp.verificar('el respaldo de los eventos: los tres del traslado, enteros',
  (select count(*) = 3 and bool_and(sitting_id = 'f5a00000-0000-4000-8000-000000000001')
          and array_agg(tipo::text order by tipo) = array['busque', 'deje', 'saliendo']
     from respaldo_dia_traslados_20261110_eventos));
select pg_temp.verificar('el respaldo del cierre: el del traslado, entero',
  (select count(*) = 1 and bool_and(sitting_id = 'f5a00000-0000-4000-8000-000000000001' and hora_fin is null
          and comentarios = 'Mucho tránsito' and gasto_monto = 120 and gasto_concepto = 'Peaje'
          and gasto_comprobante like 'ninieras/%/f5a00000-0000-4000-8000-000000000001.jpg')
     from respaldo_dia_traslados_20261110_cierres));
select pg_temp.verificar('los respaldos tienen RLS y ninguna política',
  (select bool_and(relrowsecurity) and count(*) = 2 from pg_class
    where relname in ('respaldo_dia_traslados_20261110_eventos', 'respaldo_dia_traslados_20261110_cierres') and relnamespace = 'public'::regnamespace)
  and not exists (select 1 from pg_policies where tablename like 'respaldo_dia_traslados_20261110%'));
select pg_temp.verificar('salen de las tablas; lo del sitting queda',
  (select count(*) = 1 from sitting_eventos) and (select tipo = 'entre' from sitting_eventos)
  and (select count(*) = 1 from sitting_cierres) and (select hora_fin = '19:00' from sitting_cierres));
select pg_temp.verificar('vuelve el check de los tipos y hora_fin obligatoria',
  pg_get_constraintdef((select oid from pg_constraint where conname = 'sitting_eventos_tipo_check')) not like '%busque%'
  and (select attnotnull from pg_attribute where attrelid = 'public.sitting_cierres'::regclass and attname = 'hora_fin')
  and not exists (select 1 from pg_constraint where conname = 'sitting_cierres_sin_hora_check'));
select pg_temp.verificar('la configuración de antes y sin ninera_cerrar_traslado',
  (select not (valor ? 'no_salio_min') from app_config where id = 'el_dia')
  and to_regprocedure('public.ninera_cerrar_traslado(uuid, text, numeric, text)') is null);
select pg_temp.verificar('ninera_mi_dia y sitting_del_dia_ninera, otra vez solo sittings',
  pg_get_functiondef('public.ninera_mi_dia'::regproc) like '%s.tipo = ''sitting''%'
  and pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%destino_zona%'
  and pg_get_functiondef('public.sitting_del_dia_ninera'::regproc) like '%s.tipo = ''sitting''%');
select pg_temp.verificar('programar_avisos_el_dia, sin los avisos nuevos',
  pg_get_functiondef('public.programar_avisos_el_dia'::regproc) not like '%no_salio%'
  and pg_get_functiondef('public.programar_avisos_el_dia'::regproc) not like '%sin_cierre%');

rollback;
