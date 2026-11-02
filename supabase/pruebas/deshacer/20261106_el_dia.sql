-- ============================================================================
-- Prueba de 20261106_el_dia_DESHACER.sql con el día cargado (02/11/2026), en un Postgres LOCAL (nunca en
-- producción). Lo que se verifica: los eventos y los cierres quedan copiados en respaldo_el_dia_20261106_*
-- (con RLS y sin políticas), el gasto que la admin ya pasó a gastos_extra queda, se borran solo los avisos
-- del día sin enviar (no uno de otra etapa con el mismo tipo), las funciones que cambiaron vuelven a como
-- estaban y no queda nada de la migración. Corre después de la migración, de los datos y del DESHACER, en
-- ese orden:
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261106_el_dia.sql \
--     --migracion supabase/pruebas/deshacer/20261106_el_dia_datos.sql \
--     --migracion supabase/migraciones/20261106_el_dia_DESHACER.sql \
--     supabase/pruebas/deshacer/20261106_el_dia.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;

select pg_temp.verificar('los eventos, con los minutos y las horas',
  (select count(*) = 2 from respaldo_el_dia_20261106_eventos)
  and (select minutos = 10 and creado_en = '2026-11-01 15:50-03' from respaldo_el_dia_20261106_eventos where tipo = 'tarde'));
select pg_temp.verificar('el cierre entero: hora, comentarios, calificación, gasto y revisión',
  (select count(*) = 1 and bool_and(hora_fin = '19:20' and comentarios = 'Todo bien' and calificacion = 5 and volveria
          and gasto_monto = 350 and gasto_concepto = 'Taxi' and gasto_id = 'f6700000-0000-4000-8000-000000000001'
          and revisado_en = '2026-11-02 09:00-03' and revisado_por = 'Admin Prueba')
     from respaldo_el_dia_20261106_cierres));
select pg_temp.verificar('los respaldos tienen RLS y ninguna política',
  (select count(*) = 2 from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity and relname like 'respaldo_el_dia_20261106_%')
  and not exists (select 1 from pg_policies where tablename like 'respaldo_el_dia_20261106_%'));
select pg_temp.verificar('el gasto extra que creó la admin queda',
  exists (select 1 from gastos_extra where id = 'f6700000-0000-4000-8000-000000000001'));
select pg_temp.verificar('avisos: se borraron solo los del día sin enviar',
  (select array_agg(clave order by clave) from avisos) = array[
    'admin:sitting:f5700000-0000-4000-8000-000000000001:cerro', 'chat:prueba',
    'sitting:f5700000-0000-4000-8000-000000000001:24h', 'sitting:f5700000-0000-4000-8000-000000000001:cambio:1']);
select pg_temp.verificar('no quedan tablas, configuración ni la política del comprobante',
  to_regclass('public.sitting_eventos') is null and to_regclass('public.sitting_cierres') is null
  and not exists (select 1 from app_config where id = 'el_dia')
  and not exists (select 1 from pg_policies where policyname = 'comprobantes_ninera_gasto'));
select pg_temp.verificar('no quedan funciones del día',
  not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
               and proname in ('sitting_del_dia_ninera', 'ninera_mi_dia', 'ninera_marcar_evento', 'ninera_cerrar_sitting',
                               'ninera_ruta_comprobante', 'programar_avisos_el_dia')));
select pg_temp.verificar('las que cambiaron vuelven a como estaban (y siguen con la guía)',
  pg_get_functiondef('public.sugeridas_datos'::regproc) not like '%prefiere_otros%'
  and pg_get_functiondef('public.sugeridas_datos'::regproc) like '%guia_puede%'
  and pg_get_functiondef('public.programar_avisos'::regproc) not like '%el_dia%'
  and pg_get_functiondef('public.programar_avisos'::regproc) like '%programar_avisos_guia()%');
select pg_temp.verificar('sugeridas_datos sigue sin anon',
  not has_function_privilege('anon', 'public.sugeridas_datos(uuid, text, date)', 'execute')
  and has_function_privilege('authenticated', 'public.sugeridas_datos(uuid, text, date)', 'execute'));

rollback;
