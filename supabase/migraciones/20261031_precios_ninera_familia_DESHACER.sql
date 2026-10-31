-- Deshace 20261031_precios_ninera_familia.sql: saca la tabla precios_ninera_familia (con sus
-- triggers, su política y su lugar en Realtime), la función pago_hora_ninera() y vuelve el check de
-- finanzas_historial a como estaba. La app de antes no usa nada de esto.
--
-- Los precios cargados se copian antes a respaldo_20261031_precios_ninera_familia (con RLS y sin
-- políticas: la app no la ve), y las filas de finanzas_historial de esta tabla a
-- respaldo_20261031_historial_precios (mismas condiciones) y se borran de finanzas_historial: si
-- quedaran, el check viejo no se podría volver a poner.
begin;

create table public.respaldo_20261031_precios_ninera_familia as
  select * from public.precios_ninera_familia;
alter table public.respaldo_20261031_precios_ninera_familia enable row level security;
create table public.respaldo_20261031_historial_precios as
  select * from public.finanzas_historial where tabla = 'precios_ninera_familia';
alter table public.respaldo_20261031_historial_precios enable row level security;

do $$
begin
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'precios_ninera_familia') then
    alter publication supabase_realtime drop table public.precios_ninera_familia;
  end if;
end $$;

drop function public.pago_hora_ninera(uuid, uuid);
drop table public.precios_ninera_familia;
drop function public.precios_ninera_familia_tocar();

delete from public.finanzas_historial where tabla = 'precios_ninera_familia';
alter table public.finanzas_historial drop constraint finanzas_historial_tabla_check;
alter table public.finanzas_historial add constraint finanzas_historial_tabla_check
  check (tabla = any (array['gastos_generales'::text, 'ajustes_saldo'::text, 'gastos_extra'::text]));

commit;
