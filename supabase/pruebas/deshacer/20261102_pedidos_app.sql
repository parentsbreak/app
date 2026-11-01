-- ============================================================================
-- Prueba de 20261102_pedidos_app_DESHACER.sql con datos cargados (revisión final, 02/11/2026), en un
-- Postgres LOCAL (nunca en producción). Lo que se verifica: lo que marcaron las admins (familias "No
-- acepta nuevas", la niñera pedida de cada pedido de WhatsApp), lo mandado por la app y los días que
-- no puede quedan copiados en respaldo_pedidos_app_20261102_* (con RLS y sin políticas, solo las filas
-- que no tienen el valor por defecto), y no queda nada de la migración.
-- Corre después de la migración, de los datos y del DESHACER, en ese orden:
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261102_pedidos_app.sql \
--     --migracion supabase/pruebas/deshacer/20261102_pedidos_app_datos.sql \
--     --migracion supabase/migraciones/20261102_pedidos_app_DESHACER.sql \
--     supabase/pruebas/deshacer/20261102_pedidos_app.sql
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

select pg_temp.verificar('familias "No acepta nuevas": solo la marcada',
  (select count(*) = 1 and bool_and(id = 'e3000000-0000-4000-8000-000000000001' and solo_conocidas)
     from public.respaldo_pedidos_app_20261102_fam));
select pg_temp.verificar('pedidos de WhatsApp: solo el que tenía la niñera pedida, con lo que escribió la madre',
  (select count(*) = 1 and bool_and(id = 'e5000000-0000-4000-8000-000000000001' and ninera_pedida = 'Ana')
     from public.respaldo_pedidos_app_20261102_pw));
select pg_temp.verificar('lo mandado por la app, con su respuesta y su precio',
  (select count(*) = 1 and bool_and(estado = 'acepto' and precio_hora = 300 and respondido_en is not null)
     from public.respaldo_pedidos_app_20261102_sn));
select pg_temp.verificar('el pedido con su envío y el día que no puede',
  (select count(*) = 1 from public.respaldo_pedidos_app_20261102_sol where id = 'e4000000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.respaldo_pedidos_app_20261102_dias where fecha = '2026-11-12'));
select pg_temp.verificar('los cinco respaldos con RLS y sin políticas',
  (select count(*) = 5 and bool_and(c.relrowsecurity) from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relname like 'respaldo_pedidos_app_20261102_%')
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'respaldo_pedidos_app_20261102_%'));
select pg_temp.verificar('las columnas nuevas ya no están',
  not exists (select 1 from information_schema.columns where table_schema = 'public'
               and ((table_name = 'familias' and column_name = 'solo_conocidas')
                 or (table_name = 'pedidos_whatsapp' and column_name = 'ninera_pedida')
                 or (table_name = 'solicitud_ninieras' and column_name in ('origen', 'precio_hora', 'respondido_en'))
                 or (table_name = 'solicitudes' and column_name in ('ninera_pedida_id', 'enviado_app_en')))));
select pg_temp.verificar('la fila de la app queda como invitada y la tabla de días ya no está',
  (select estado = 'invitada' from public.solicitud_ninieras where solicitud_id = 'e4000000-0000-4000-8000-000000000001')
  and to_regclass('public.ninera_no_disponible') is null
  and to_regprocedure('public.sugeridas_datos(uuid, text, date)') is null);

rollback;
