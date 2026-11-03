-- ============================================================================
-- Prueba de 20261107_ficha_cambios_DESHACER.sql con fichas y cambios cargados (02/11/2026), en un Postgres LOCAL
-- (nunca en producción). Lo que se verifica: las fichas y los cambios de horario quedan copiados en
-- respaldo_ficha_cambios_20261107_* (con RLS y sin políticas), se borran solo los avisos de esta etapa sin enviar (no
-- los del día de la etapa 7 ni el chat), el registro cancelado queda cancelado, las funciones que cambiaron vuelven a
-- como estaban y no queda nada de la migración. Corre después de la migración, de los datos y del DESHACER:
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261107_ficha_cambios.sql \
--     --migracion supabase/pruebas/deshacer/20261107_ficha_cambios_datos.sql \
--     --migracion supabase/migraciones/20261107_ficha_cambios_DESHACER.sql \
--     supabase/pruebas/deshacer/20261107_ficha_cambios.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;

select pg_temp.verificar('la ficha, con sus datos y su fecha',
  (select count(*) = 1 and bool_and(datos = '{"alergias": "maní"}'::jsonb and creada_en = '2026-11-01 18:00-03')
     from respaldo_ficha_cambios_20261107_fichas));
select pg_temp.verificar('el cambio de horario con lo que respondió',
  (select count(*) = 1 and bool_and(respuesta = false and hora_inicio = '17:00') from respaldo_ficha_cambios_20261107_cambios));
select pg_temp.verificar('los respaldos tienen RLS y ninguna política',
  (select count(*) = 2 from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity and relname like 'respaldo_ficha_cambios_20261107_%')
  and not exists (select 1 from pg_policies where tablename like 'respaldo_ficha_cambios_20261107_%'));
select pg_temp.verificar('avisos: se borraron solo los de esta etapa sin enviar',
  (select array_agg(clave order by clave) from avisos) = array['chat:prueba',
    'sitting:f5800000-0000-4000-8000-000000000001:cancelado:1', 'sitting:f5800000-0000-4000-8000-000000000001:fin']);
select pg_temp.verificar('el registro cancelado sigue cancelado',
  (select cancelado from sittings_traslados where id = 'f5800000-0000-4000-8000-000000000001'));
select pg_temp.verificar('no quedan tablas, triggers ni funciones de la etapa',
  to_regclass('public.fichas_familia') is null and to_regclass('public.cambios_horario') is null
  and not exists (select 1 from pg_trigger where tgname like 'sittings_avisos_%')
  and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
               and proname in ('ficha_familia_campos', 'ninera_guardar_ficha_familia', 'ninera_ficha_familia', 'ninera_mis_cambios',
                               'ninera_responder_cambio', 'sitting_puede_avisar', 'horario_texto', 'aviso_sitting_ninera',
                               'sittings_avisos_cambios', 'avisar_cambios_previstos')));
select pg_temp.verificar('las que cambiaron vuelven a como estaban',
  pg_get_functiondef('public.generar_previstos_fijos'::regproc) not like '%pb.previstos%'
  and pg_get_functiondef('public.solicitudes_al_cancelar'::regproc) not like '%Pedido cancelado%');
select pg_temp.verificar('generar_previstos_fijos sigue andando',
  (select public.generar_previstos_fijos(14) ? 'creados'));

rollback;
