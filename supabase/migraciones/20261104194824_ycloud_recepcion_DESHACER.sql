-- Solo si las tablas siguen vacías. Con eventos reales: respaldar y diseñar la reversión.
begin;
do $$ begin
  if exists (select 1 from public.ycloud_eventos) or exists (select 1 from public.ycloud_trabajos) then
    raise exception 'Hay eventos YCloud: no se borra ningún dato. Respaldar y revisar la reversión.';
  end if;
end $$;
drop function public.ycloud_recibir_evento(jsonb);
drop table public.ycloud_trabajos;
drop table public.ycloud_eventos;
commit;
