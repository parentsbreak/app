-- ============================================================================
-- Prueba de 20261108_carsitting_app_DESHACER.sql con carsittings cargados (02/11/2026), en un Postgres LOCAL (nunca en
-- producción). Lo que se verifica: la fila de la app queda copiada entera en respaldo_carsitting_20261108 (con RLS y
-- sin políticas) y sigue en carsitting_datos con los campos de siempre; la del formulario no se toca; se borran solo
-- los avisos de carsitting sin enviar; programar_avisos vuelve a como estaba y no queda nada de la migración. Corre
-- después de la migración, de los datos y del DESHACER:
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261108_carsitting_app.sql \
--     --migracion supabase/pruebas/deshacer/20261108_carsitting_app_datos.sql \
--     --migracion supabase/migraciones/20261108_carsitting_app_DESHACER.sql \
--     supabase/pruebas/deshacer/20261108_carsitting_app.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;

select pg_temp.verificar('el respaldo: solo la fila de la app, entera (fotos, revisión y lo aprobado)',
  (select count(*) = 1 and bool_and(ninera_id = 'f2900000-0000-4000-8000-000000000001' and revision = 'pendiente'
          and fotos->>'asientos' like '%asientos_0a1b2c3d.jpg' and aprobado_por = 'Paula Prueba' and aprobado_datos->>'modelo_auto' = 'Auto Viejo')
     from respaldo_carsitting_20261108));
select pg_temp.verificar('el respaldo tiene RLS y ninguna política',
  (select relrowsecurity from pg_class where relname = 'respaldo_carsitting_20261108' and relnamespace = 'public'::regnamespace)
  and not exists (select 1 from pg_policies where tablename = 'respaldo_carsitting_20261108'));
select pg_temp.verificar('las dos filas siguen en carsitting_datos con los campos de siempre',
  (select count(*) = 2 from carsitting_datos)
  and (select modelo_auto = 'Auto Inventado' from carsitting_datos where ninera_id = 'f2900000-0000-4000-8000-000000000001')
  and (select modelo_auto = 'Del formulario' from carsitting_datos where ninera_id = 'f2900000-0000-4000-8000-000000000002'));
select pg_temp.verificar('avisos: se borraron solo los de carsitting sin enviar',
  (select array_agg(clave order by clave) from avisos)
    = array['carsitting:f2900000-0000-4000-8000-000000000001:aprobado:1', 'guia:f2900000-0000-4000-8000-000000000002:falta']);
select pg_temp.verificar('no queda nada de la migración',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'carsitting_datos'
               and column_name in ('fotos', 'enviado_en', 'revision', 'revisado_en', 'revisado_por', 'comentario', 'aprobado_en', 'aprobado_por', 'aprobado_datos'))
  and to_regclass('public.carsitting_datos_app_ninera') is null
  and not exists (select 1 from pg_trigger where tgname = 'carsitting_al_revisar')
  and not exists (select 1 from pg_policies where policyname = 'ninieras_privado_carsitting')
  and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in
    ('carsitting_campos', 'carsitting_fotos', 'carsitting_puede_avisar', 'ninera_mi_carsitting', 'ninera_guardar_carsitting',
     'carsitting_al_revisar', 'programar_avisos_carsitting')));
select pg_temp.verificar('programar_avisos como estaba (sin el carsitting, con las otras)',
  pg_get_functiondef('public.programar_avisos'::regproc) not like '%carsitting%'
  and pg_get_functiondef('public.programar_avisos'::regproc) like '%programar_avisos_el_dia()%');

rollback;
