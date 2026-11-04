-- W1 YCloud: solo ingreso durable. No aplica pedidos ni programa envíos.
-- Revisar/aplicar por separado; este archivo no fue aplicado a producción.
begin;

create table public.ycloud_eventos (
  evento_id text primary key check (char_length(evento_id) between 1 and 512),
  tipo text not null check (tipo in ('whatsapp.inbound_message.received', 'whatsapp.message.updated')),
  waba_id text check (waba_id is null or char_length(waba_id) between 1 and 512),
  mensaje_id text not null check (char_length(mensaje_id) between 1 and 512),
  wamid text check (wamid is null or char_length(wamid) between 1 and 512),
  ocurrido_en timestamptz not null,
  recibido_en timestamptz not null default now(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  check (tipo <> 'whatsapp.inbound_message.received' or waba_id is not null)
);

create table public.ycloud_trabajos (
  id uuid primary key default gen_random_uuid(),
  evento_id text not null unique references public.ycloud_eventos(evento_id),
  waba_id text not null,
  mensaje_id text not null,
  wamid text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'procesando', 'completado', 'error')),
  intentos integer not null default 0 check (intentos >= 0),
  disponible_desde timestamptz not null default now(),
  bloqueado_hasta timestamptz,
  creado_en timestamptz not null default now(),
  unique (waba_id, mensaje_id)
);
create unique index ycloud_trabajos_wamid_idx on public.ycloud_trabajos(waba_id, wamid) where wamid is not null;
create index ycloud_trabajos_pendientes_idx on public.ycloud_trabajos(disponible_desde) where estado = 'pendiente';
create index ycloud_eventos_recibido_idx on public.ycloud_eventos(recibido_en);

alter table public.ycloud_eventos enable row level security;
alter table public.ycloud_trabajos enable row level security;
revoke all on public.ycloud_eventos, public.ycloud_trabajos from public, anon, authenticated;
grant all on public.ycloud_eventos, public.ycloud_trabajos to service_role;
create policy ycloud_eventos_interno on public.ycloud_eventos for all to service_role using (true) with check (true);
create policy ycloud_trabajos_interno on public.ycloud_trabajos for all to service_role using (true) with check (true);

-- Una llamada atómica: nunca confirmar el evento sin dejar el trabajo durable.
-- SECURITY INVOKER; ni anon ni una sesión admin pueden llamarla.
create function public.ycloud_recibir_evento(p_evento jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_tipo text := p_evento->>'type';
  v_id text := p_evento->>'id';
  v_mensaje jsonb;
  v_guardado text;
begin
  if jsonb_typeof(p_evento) is distinct from 'object'
     or p_evento->>'apiVersion' is distinct from 'v2'
     or v_tipo is null or v_tipo not in ('whatsapp.inbound_message.received', 'whatsapp.message.updated')
     or jsonb_typeof(p_evento->'id') is distinct from 'string'
     or not (char_length(v_id) between 1 and 512) or btrim(v_id) <> v_id
     or jsonb_typeof(p_evento->'createTime') is distinct from 'string' then
    raise exception 'Evento YCloud inválido';
  end if;
  v_mensaje := case when v_tipo = 'whatsapp.inbound_message.received'
    then p_evento->'whatsappInboundMessage' else p_evento->'whatsappMessage' end;
  if jsonb_typeof(v_mensaje) is distinct from 'object'
     or jsonb_typeof(v_mensaje->'id') is distinct from 'string'
     or coalesce(char_length(v_mensaje->>'id'), 0) not between 1 and 512
     or btrim(v_mensaje->>'id') <> v_mensaje->>'id' then
    raise exception 'Mensaje YCloud inválido';
  end if;
  if (v_tipo = 'whatsapp.inbound_message.received' or v_mensaje->>'wabaId' is not null) and
     (jsonb_typeof(v_mensaje->'wabaId') is distinct from 'string'
      or coalesce(char_length(v_mensaje->>'wabaId'), 0) not between 1 and 512
      or btrim(v_mensaje->>'wabaId') <> v_mensaje->>'wabaId') then
    raise exception 'Cuenta YCloud inválida';
  end if;
  if v_mensaje->>'wamid' is not null and
     (jsonb_typeof(v_mensaje->'wamid') <> 'string' or char_length(v_mensaje->>'wamid') not between 1 and 512
      or btrim(v_mensaje->>'wamid') <> v_mensaje->>'wamid') then
    raise exception 'Identificador YCloud inválido';
  end if;
  insert into public.ycloud_eventos(evento_id, tipo, waba_id, mensaje_id, wamid, ocurrido_en, payload)
  values (v_id, v_tipo, v_mensaje->>'wabaId', v_mensaje->>'id', v_mensaje->>'wamid', (p_evento->>'createTime')::timestamptz, p_evento)
  on conflict (evento_id) do nothing returning evento_id into v_guardado;
  if v_guardado is null then return false; end if;

  if v_tipo = 'whatsapp.inbound_message.received' then
    insert into public.ycloud_trabajos(evento_id, waba_id, mensaje_id, wamid)
    values (v_id, v_mensaje->>'wabaId', v_mensaje->>'id', v_mensaje->>'wamid')
    on conflict do nothing;
  end if;
  return true;
end;
$$;
revoke all on function public.ycloud_recibir_evento(jsonb) from public, anon, authenticated;
grant execute on function public.ycloud_recibir_evento(jsonb) to service_role;

commit;
