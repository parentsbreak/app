-- ============================================================================
-- Prueba de 20261105_guia_DESHACER.sql con la guía cargada (02/11/2026), en un Postgres LOCAL (nunca en
-- producción). Lo que se verifica: el progreso, los repasos, las firmas y el RCP quedan copiados en
-- respaldo_guia_20261105_* (con RLS y sin políticas), se borran solo los avisos de la guía sin enviar, las
-- cuatro funciones que cambiaron vuelven a como estaban y no queda nada de la migración. Corre después de
-- la migración, de los datos y del DESHACER, en ese orden:
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261105_guia.sql \
--     --migracion supabase/pruebas/deshacer/20261105_guia_datos.sql \
--     --migracion supabase/migraciones/20261105_guia_DESHACER.sql \
--     supabase/pruebas/deshacer/20261105_guia.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;

select pg_temp.verificar('el progreso, con sus fechas', (select count(*) = 2 from respaldo_guia_20261105_progreso)
  and (select leido_en = '2026-11-01 10:05-03' from respaldo_guia_20261105_progreso where leccion_id = 'x1'));
select pg_temp.verificar('los repasos', (select count(*) = 1 and bool_and(modulo_id = 'protocolos') from respaldo_guia_20261105_repasos));
select pg_temp.verificar('la firma, con su nombre, ruta y fecha',
  (select count(*) = 1 and bool_and(nombre = 'Ana Ficticia' and firma_ruta = 'firmas/f2000000-0000-4000-8000-000000000001/2026-11-01.png'
          and firmado_en = '2026-11-01 10:20-03') from respaldo_guia_20261105_firmas));
select pg_temp.verificar('el RCP, solo de la que lo tenía cargado',
  (select count(*) = 1 and bool_and(id = 'f2000000-0000-4000-8000-000000000001' and rcp_presencial
          and rcp_certificado_ruta = 'rcp/f2000000-0000-4000-8000-000000000001/certificado.jpg') from respaldo_guia_20261105_rcp));
select pg_temp.verificar('los respaldos tienen RLS y ninguna política',
  (select count(*) = 4 from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity and relname like 'respaldo_guia_20261105_%')
  and not exists (select 1 from pg_policies where tablename like 'respaldo_guia_20261105_%'));
select pg_temp.verificar('avisos: se borró solo el de la guía sin enviar',
  (select array_agg(clave order by clave) from avisos) = array['chat:prueba', 'guia:f2000000-0000-4000-8000-000000000001:falta']);
select pg_temp.verificar('no quedan tablas, columnas, configuración ni políticas de la guía',
  to_regclass('public.guia_progreso') is null and to_regclass('public.guia_repasos') is null and to_regclass('public.guia_firmas') is null
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ninieras' and column_name like 'rcp_%')
  and not exists (select 1 from app_config where id = 'guia')
  and not exists (select 1 from pg_policies where policyname in ('ninieras_privado_firma', 'ninieras_privado_rcp')));
select pg_temp.verificar('no quedan funciones de la guía',
  not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
               and proname in ('guia_estado', 'ninera_puede_recibir_pedidos', 'guia_estado_ninieras', 'ninera_estado_guia', 'ninera_marcar_leida',
                               'ninera_aprobar_repaso', 'ninera_firmar_guia', 'ninera_guardar_rcp', 'programar_avisos_guia')));
select pg_temp.verificar('las que cambiaron vuelven a como estaban',
  pg_get_functiondef('public.enviar_pedido_app'::regproc) not like '%guia%'
  and pg_get_functiondef('public.sugeridas_datos'::regproc) not like '%guia%'
  and pg_get_functiondef('public.programar_avisos'::regproc) not like '%guia%'
  and pg_get_function_result('public.ninera_mi_perfil'::regproc) not like '%rcp%');
select pg_temp.verificar('ninera_mi_perfil sigue sin anon',
  has_function_privilege('authenticated', 'public.ninera_mi_perfil()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_mi_perfil()', 'execute'));

rollback;
