-- Solo Postgres de prueba / PGlite. Datos ficticios. No ejecutar en producción.
begin;
create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if; end $$;

create function pg_temp.evento(id text, mensaje text default 'mensaje-prueba', wamid text default 'wamid.prueba')
returns jsonb language sql as $$
select jsonb_build_object('id', id, 'type', 'whatsapp.inbound_message.received', 'apiVersion', 'v2',
  'createTime', '2026-11-04T15:00:00Z', 'whatsappInboundMessage',
  jsonb_build_object('id', mensaje, 'wamid', wamid, 'wabaId', 'waba-prueba', 'type', 'audio', 'audio', jsonb_build_object('id', 'audio-prueba')));
$$;

set local role service_role;
select public.ycloud_recibir_evento(pg_temp.evento('evento-uno'));
select public.ycloud_recibir_evento(pg_temp.evento('evento-uno'));
select public.ycloud_recibir_evento(pg_temp.evento('evento-repetido', 'otro-id-proveedor'));
select public.ycloud_recibir_evento(pg_temp.evento('evento-repetido-id', 'mensaje-prueba', 'otro-wamid'));
reset role;
select pg_temp.verificar('cuatro entregas conservan tres eventos y un trabajo',
  (select count(*) = 3 from public.ycloud_eventos) and (select count(*) = 1 from public.ycloud_trabajos));
select pg_temp.verificar('audio original guardado, trabajo pendiente sin IA',
  (select payload #>> '{whatsappInboundMessage,audio,id}' = 'audio-prueba' from public.ycloud_eventos where evento_id = 'evento-uno')
  and (select estado = 'pendiente' and intentos = 0 from public.ycloud_trabajos));

set local role service_role;
select public.ycloud_recibir_evento(pg_temp.evento('sin-wamid', 'sin-wamid', null));
select public.ycloud_recibir_evento(pg_temp.evento('sin-wamid-otra-entrega', 'sin-wamid', null));
select public.ycloud_recibir_evento(jsonb_build_object('id', 'estado-uno', 'type', 'whatsapp.message.updated',
  'apiVersion', 'v2', 'createTime', '2026-11-04T15:00:00Z', 'whatsappMessage',
  jsonb_build_object('id', 'salida-prueba', 'status', 'delivered')));
reset role;
select pg_temp.verificar('sin wamid deduplica por ID; estados no crean trabajo', (select count(*) = 2 from public.ycloud_trabajos));
select pg_temp.verificar('estado sin WABA se conserva sin inventar asociación', (select waba_id is null from public.ycloud_eventos where evento_id = 'estado-uno'));

-- Si falla el trabajo después del insert del evento, la transacción completa retrocede.
create function pg_temp.impedir_trabajo() returns trigger language plpgsql as $$
begin raise exception 'fallo ficticio de almacenamiento'; end $$;
create trigger fallo_ficticio before insert on public.ycloud_trabajos for each row execute function pg_temp.impedir_trabajo();
do $$ begin
  begin
    perform public.ycloud_recibir_evento(pg_temp.evento('fallo-atomico', 'nuevo', 'wamid.nuevo'));
    raise exception 'no produjo el fallo esperado';
  exception when raise_exception then
    if sqlerrm <> 'fallo ficticio de almacenamiento' then raise; end if;
  end;
end $$;
drop trigger fallo_ficticio on public.ycloud_trabajos;
select pg_temp.verificar('sin trabajo tampoco queda el evento aceptado', not exists (select 1 from public.ycloud_eventos where evento_id = 'fallo-atomico'));
select public.ycloud_recibir_evento(pg_temp.evento('fallo-atomico', 'nuevo', 'wamid.nuevo'));
select pg_temp.verificar('al reintentar se recuperan evento y trabajo', exists (select 1 from public.ycloud_trabajos where evento_id = 'fallo-atomico'));

select pg_temp.verificar('RLS activa', (select bool_and(relrowsecurity) from pg_class where oid in ('public.ycloud_eventos'::regclass, 'public.ycloud_trabajos'::regclass)));
select pg_temp.verificar('anon y authenticated sin tablas ni RPC',
  not has_table_privilege('anon', 'public.ycloud_eventos', 'select')
  and not has_table_privilege('authenticated', 'public.ycloud_trabajos', 'insert')
  and not has_table_privilege('authenticated', 'public.ycloud_eventos', 'select')
  and not has_function_privilege('anon', 'public.ycloud_recibir_evento(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.ycloud_recibir_evento(jsonb)', 'execute'));
select pg_temp.verificar('RPC sin elevación de privilegios', not (select prosecdef from pg_proc where oid = 'public.ycloud_recibir_evento(jsonb)'::regprocedure));
select pg_temp.verificar('sin disparadores de envío ni cron', not exists (select 1 from pg_trigger where tgrelid in ('public.ycloud_eventos'::regclass, 'public.ycloud_trabajos'::regclass) and not tgisinternal));
rollback;
