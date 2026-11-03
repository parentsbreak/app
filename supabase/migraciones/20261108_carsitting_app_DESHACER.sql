-- Deshace 20261108_carsitting_app.sql: se sacan las funciones, el trigger de la revisión, la política de las fotos,
-- la regla de avisos y las columnas nuevas de carsitting_datos, y programar_avisos vuelve a como estaba
-- (20261106_el_dia).
--
-- Lo cargado no se pierde: antes de sacar las columnas, las filas que llegaron por la app se copian enteras a
-- respaldo_carsitting_20261108 (RLS sin políticas: solo se ven con la clave de servicio o desde el SQL Editor) y
-- quedan en carsitting_datos con los campos de siempre (los textos; las fotos, en el bucket ninieras-privado, que
-- las admins siguen viendo). Los avisos de carsitting que todavía no salieron se borran (abrirían una pantalla que
-- ya no está).
begin;

do $$
begin
  if to_regclass('public.respaldo_carsitting_20261108') is null then
    create table public.respaldo_carsitting_20261108 as
      select c.*, now() as respaldado_en from public.carsitting_datos c where c.enviado_en is not null;
    alter table public.respaldo_carsitting_20261108 enable row level security;
  end if;
end $$;

delete from public.avisos where enviado_en is null and tipo = 'carsitting';

create or replace function public.programar_avisos()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_total integer := 0;
begin
  v_total := v_total + public.programar_avisos_temporada();  -- etapa 9
  v_total := v_total + public.programar_avisos_pedidos();    -- etapa 6
  v_total := v_total + public.programar_avisos_guia();       -- etapa 4
  v_total := v_total + public.programar_avisos_el_dia();     -- etapa 7
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos() from public, anon, authenticated;
grant execute on function public.programar_avisos() to service_role;

drop function if exists public.programar_avisos_carsitting(timestamp with time zone);
drop trigger if exists carsitting_al_revisar on public.carsitting_datos;
drop function if exists public.carsitting_al_revisar();
drop policy if exists ninieras_privado_carsitting on storage.objects;
drop function if exists public.ninera_guardar_carsitting(jsonb, jsonb);
drop function if exists public.ninera_mi_carsitting();
drop function if exists public.carsitting_puede_avisar(text);
drop function if exists public.carsitting_fotos();
drop function if exists public.carsitting_campos();
drop index if exists public.carsitting_datos_app_ninera;
alter table public.carsitting_datos
  drop constraint if exists carsitting_datos_revision_check,
  drop constraint if exists carsitting_datos_comentario_check,
  drop column if exists fotos,
  drop column if exists enviado_en,
  drop column if exists revision,
  drop column if exists revisado_en,
  drop column if exists revisado_por,
  drop column if exists comentario,
  drop column if exists aprobado_en,
  drop column if exists aprobado_por,
  drop column if exists aprobado_datos;

commit;
