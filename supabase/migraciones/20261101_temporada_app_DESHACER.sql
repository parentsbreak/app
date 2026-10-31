-- Deshace 20261101_temporada_app.sql: programar_avisos() vuelve a no programar nada y se sacan la
-- regla de avisos de la temporada, las dos funciones de la niñera, inicio_temporada_mvd() y las
-- columnas temporada_lugares y temporada_lugares_en. La app de las admins sigue igual; la de
-- niñeras, sin las funciones (404), no muestra la tarjeta ni la pantalla de la temporada.
--
-- Lo que las niñeras cargaron no se pierde: ninieras.temporada queda como la escribió la app (el
-- formato de siempre, lo que lee el panel) y los lugares con su fecha se copian antes a
-- respaldo_temporada_lugares_20261101 (RLS sin políticas: solo se ve con la clave de servicio o
-- desde el SQL Editor). Si se deshace más de una vez, se suman las que falten. Los avisos de la
-- temporada que todavía no salieron se borran (abrirían una pantalla que ya no está); los que ya
-- salieron quedan en "Avisos".
begin;

do $$
begin
  if exists (select 1 from public.ninieras where temporada_lugares is not null) then
    if to_regclass('public.respaldo_temporada_lugares_20261101') is null then
      create table public.respaldo_temporada_lugares_20261101 as
        select id, temporada_lugares, temporada_lugares_en, now() as respaldado_en
          from public.ninieras where temporada_lugares is not null;
      alter table public.respaldo_temporada_lugares_20261101 enable row level security;
    else
      insert into public.respaldo_temporada_lugares_20261101
      select n.id, n.temporada_lugares, n.temporada_lugares_en, now()
        from public.ninieras n
       where n.temporada_lugares is not null
         and not exists (select 1 from public.respaldo_temporada_lugares_20261101 r where r.id = n.id);
    end if;
  end if;
end $$;

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
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos() from public, anon, authenticated;
grant execute on function public.programar_avisos() to service_role;

delete from public.avisos where clave like 'temporada:%' and enviado_en is null;

drop function if exists public.programar_avisos_temporada(timestamp with time zone);
drop function if exists public.ninera_guardar_temporada(jsonb);
drop function if exists public.ninera_mi_temporada();
drop function if exists public.inicio_temporada_mvd(timestamp with time zone);

alter table public.ninieras drop column if exists temporada_lugares;
alter table public.ninieras drop column if exists temporada_lugares_en;

commit;
