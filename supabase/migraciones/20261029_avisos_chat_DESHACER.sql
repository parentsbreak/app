-- Deshace 20261029_avisos_chat.sql: saca el cron enviar-avisos, las dos tablas de Realtime, los
-- triggers, las funciones de la cola y del chat, y las tablas avisos y chat_mensajes (con sus
-- políticas e índices). La app de las admins sigue andando igual y la de niñeras también: sin las
-- tablas ni las funciones (404), no muestran "Mensajes" ni "Avisos". Si enviar-avisos está
-- publicada, nadie la llama más.
--
-- Los mensajes del chat no se pierden: si hay alguno, se copian antes a respaldo_chat_20261029
-- (RLS sin políticas: solo se ve con la clave de servicio o desde el SQL Editor). Si se deshace más
-- de una vez, se suman los que falten. Los avisos no se guardan: son copias de lo que ya pasó
-- (mensajes, pedidos) y se vuelven a programar del estado.
begin;

do $$
begin
  if exists (select 1 from public.chat_mensajes) then
    if to_regclass('public.respaldo_chat_20261029') is null then
      create table public.respaldo_chat_20261029 as select * from public.chat_mensajes;
      alter table public.respaldo_chat_20261029 enable row level security;
    else
      insert into public.respaldo_chat_20261029
      select m.* from public.chat_mensajes m
       where not exists (select 1 from public.respaldo_chat_20261029 r where r.id = m.id);
    end if;
  end if;
end $$;

-- Por nombre y solo si está (cron.unschedule falla con un nombre que no existe).
select cron.unschedule(j.jobname) from cron.job j where j.jobname = 'enviar-avisos';

-- Fuera de Realtime antes de borrarlas.
do $$
begin
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_mensajes') then
    alter publication supabase_realtime drop table public.chat_mensajes;
  end if;
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'avisos') then
    alter publication supabase_realtime drop table public.avisos;
  end if;
end $$;

drop trigger if exists chat_mensajes_aviso on public.chat_mensajes;
drop trigger if exists avisos_enviar_ya on public.avisos;

-- Las funciones antes que las tablas: ninera_enviar_mensaje y reclamar_avisos devuelven sus filas.
drop function if exists public.chat_mensajes_encolar_aviso();
drop function if exists public.avisos_disparar_envio();
drop function if exists public.ninera_marcar_avisos_leidos();
drop function if exists public.ninera_marcar_chat_leido();
drop function if exists public.ninera_enviar_mensaje(text);
drop function if exists public.admins_activas_mails();
drop function if exists public.programar_avisos();
drop function if exists public.reclamar_avisos(integer);
drop function if exists public.encolar_aviso(text, uuid, text, text, text, text, text, jsonb, timestamp with time zone);

drop table if exists public.chat_mensajes;
drop table if exists public.avisos;
commit;
