-- Deshace 20261103_eleccion_pedidos.sql: se sacan los triggers de "Seleccionada", "Ya se cubrió" y
-- "Se canceló", los avisos de tiempo de los pedidos, ninera_marcar_pedido_visto, pedido_puede_avisar
-- y las columnas nuevas, y vuelven enviar_pedido_app, ninera_mis_pedidos y ninera_mis_sittings como
-- estaban (etapas 5 y 2).
--
-- Lo cargado no se pierde: antes de borrar, las filas de solicitud_ninieras con un estado nuevo o con
-- seleccionada_en / visto_en, las solicitudes marcadas con horario aproximado y los registros con
-- solicitud_id se copian a respaldo_eleccion_20261103_* (RLS sin políticas: solo se ven con la clave
-- de servicio o desde el SQL Editor). Las filas 'cubierto' / 'cancelado' vuelven a 'acepto' (si
-- habían dicho "Puedo") o a 'invitada', como quedaban en la etapa 5, así el check viejo de estados se
-- puede volver a poner. Los avisos de esta etapa que todavía no salieron se borran.
begin;

do $$
begin
  if to_regclass('public.respaldo_eleccion_20261103_sn') is null then
    create table public.respaldo_eleccion_20261103_sn as
      select sn.*, now() as respaldado_en from public.solicitud_ninieras sn
       where sn.estado in ('cubierto', 'cancelado') or sn.seleccionada_en is not null or sn.visto_en is not null;
    alter table public.respaldo_eleccion_20261103_sn enable row level security;
  end if;
  if to_regclass('public.respaldo_eleccion_20261103_sol') is null then
    create table public.respaldo_eleccion_20261103_sol as
      select s.id, s.horario_aproximado, now() as respaldado_en from public.solicitudes s where s.horario_aproximado;
    alter table public.respaldo_eleccion_20261103_sol enable row level security;
  end if;
  if to_regclass('public.respaldo_eleccion_20261103_reg') is null then
    create table public.respaldo_eleccion_20261103_reg as
      select r.id, r.solicitud_id, now() as respaldado_en from public.sittings_traslados r where r.solicitud_id is not null;
    alter table public.respaldo_eleccion_20261103_reg enable row level security;
  end if;
end $$;

delete from public.avisos
 where enviado_en is null
   and (clave like 'pedido:%:seleccionada' or clave like 'pedido:%:cubierto' or clave like 'pedido:%:cancelado'
        or clave like 'pedido:%:recordatorio' or clave like 'admin:pedido:%:perfiles'
        or clave like 'admin:pedido:%:nadie' or clave like 'admin:pedido:%:3h');

drop trigger if exists solicitud_ninieras_al_confirmar on public.solicitud_ninieras;
drop trigger if exists solicitudes_al_cancelar on public.solicitudes;
drop function if exists public.solicitud_ninieras_al_confirmar();
drop function if exists public.solicitudes_al_cancelar();
drop function if exists public.ninera_marcar_pedido_visto(uuid);

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
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos() from public, anon, authenticated;
grant execute on function public.programar_avisos() to service_role;
drop function if exists public.programar_avisos_pedidos(timestamp with time zone);

-- Como en 20261102_pedidos_app.sql.
create or replace function public.enviar_pedido_app(p_solicitud_id uuid, p_envios jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_s public.solicitudes;
  v_fam public.familias;
  v_n public.ninieras;
  v_e jsonb;
  v_id uuid;
  v_precio numeric;
  v_sn uuid;
  v_chicos text;
  v_zona text;
  v_horario text;
  v_practica boolean;
  v_cfg jsonb;
  v_min integer;
  v_cant integer := 0;
begin
  if not coalesce((select public.es_usuaria_autorizada()), false) then
    raise exception 'no_autorizada';
  end if;
  if p_envios is null or jsonb_typeof(p_envios) <> 'array' or jsonb_array_length(p_envios) = 0 then
    raise exception 'sin_ninieras';
  end if;
  if jsonb_array_length(p_envios) > 40 then
    raise exception 'demasiadas_ninieras';
  end if;

  -- El pedido, bloqueado: dos admins mandando a la vez no lo pisan.
  select * into v_s from public.solicitudes where id = p_solicitud_id for update;
  if not found then raise exception 'no_existe'; end if;
  if v_s.estado not in ('sin_asignar', 'pendiente_confirmar') then raise exception 'cerrado'; end if;
  if v_s.tipo <> 'sitting' then raise exception 'solo_sittings'; end if;
  if v_s.fecha < public.hoy_mvd() then raise exception 'pasado'; end if;
  select * into v_fam from public.familias where id = v_s.familia_id;
  if not found then raise exception 'sin_familia'; end if;
  if not exists (select 1 from public.hijos_familia h where h.familia_id = v_fam.id) then
    raise exception 'sin_chicos';
  end if;
  v_chicos := public.chicos_texto(v_fam.id);

  v_cfg := coalesce((select valor from public.app_config where id = 'pedidos_app'), '{}'::jsonb);
  v_practica := position('(practica)' in public.normaliza_nombre(v_fam.nombre)) > 0;
  if not v_practica and coalesce((v_cfg->>'solo_practica')::boolean, true) then
    raise exception 'solo_practica';
  end if;
  v_zona := coalesce(nullif(btrim(v_s.zona), ''), nullif(btrim(v_fam.zona), ''));
  -- Textos 1: el fin siempre "aproximada, se puede extender"; sin fin, "sin hora de fin"; si
  -- termina pasada la medianoche, "del día siguiente".
  v_horario := to_char(v_s.hora_inicio, 'HH24:MI')
    || case when v_s.hora_fin is null then ', sin hora de fin'
            else ' – ' || to_char(v_s.hora_fin, 'HH24:MI')
                 || case when v_s.termina_dia_siguiente then ' del día siguiente' else '' end
                 || ' (aproximada, se puede extender)' end;

  for v_e in select * from jsonb_array_elements(p_envios) loop
    begin
      v_id := (v_e->>'ninera_id')::uuid;
      v_precio := (v_e->>'precio_hora')::numeric;
    exception when others then
      raise exception 'envio_invalido';
    end;
    if v_precio is null or v_precio <= 0 or v_precio >= 100000 then
      raise exception 'precio_invalido' using hint = coalesce((select nombre from public.ninieras where id = v_id), '');
    end if;
    select * into v_n from public.ninieras where id = v_id;
    -- Ya no está en la base: no hay nombre, va su id y el panel lo busca en la lista que está mirando.
    if not found then raise exception 'ninera_no_existe' using hint = coalesce(v_id::text, ''); end if;
    if not v_n.activa then raise exception 'ninera_inactiva' using hint = v_n.nombre; end if;
    if v_n.user_id is null then raise exception 'ninera_sin_app' using hint = v_n.nombre; end if;
    if v_n.tipo = 'Traslados' then raise exception 'ninera_solo_traslados' using hint = v_n.nombre; end if;
    if (position('(practica)' in public.normaliza_nombre(v_n.nombre)) > 0) <> v_practica then
      raise exception 'practica_mezclada' using hint = v_n.nombre;
    end if;

    v_sn := null;
    insert into public.solicitud_ninieras (solicitud_id, ninera_id, ninera_nombre, estado, origen, precio_hora, enviado_en)
    values (v_s.id, v_n.id, v_n.nombre, 'invitada', 'app', v_precio, now())
    on conflict (solicitud_id, ninera_id) where origen = 'app' do nothing
    returning id into v_sn;
    if v_sn is not null then
      v_cant := v_cant + 1;
      perform public.encolar_aviso('pedido:' || v_sn || ':nuevo', v_n.id, null, 'pedido',
        'Sitting ' || to_char(v_s.fecha, 'DD/MM'),
        concat_ws(E'\n', v_horario, 'Zona: ' || v_zona, v_chicos, 'Precio por hora: ' || public.pesos_texto(v_precio)),
        '#pedido/' || v_sn, jsonb_build_object('solicitud_ninera_id', v_sn));
    end if;
  end loop;

  if v_cant > 0 then
    v_min := case when v_s.fecha = public.hoy_mvd()
                  then coalesce((v_cfg->>'min_mismo_dia')::int, 15)
                  else coalesce((v_cfg->>'min_otro_dia')::int, 30) end;
    update public.solicitudes
       set estado = 'pendiente_confirmar',
           enviado_app_en = coalesce(enviado_app_en, now()),
           responder_hasta = now() + make_interval(mins => v_min)
     where id = v_s.id;
  end if;
  return v_cant;
end
$function$;
revoke execute on function public.enviar_pedido_app(uuid, jsonb) from public, anon;
grant execute on function public.enviar_pedido_app(uuid, jsonb) to authenticated;

drop function public.ninera_mis_pedidos();
-- Como en 20261102_pedidos_app.sql.
create function public.ninera_mis_pedidos()
returns table (id uuid, estado text, fecha date, hora_inicio time without time zone,
               hora_fin time without time zone, termina_dia_siguiente boolean, zona text, chicos text,
               precio_hora numeric, responder_hasta timestamp with time zone,
               enviado_en timestamp with time zone, respondido_en timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select sn.id, sn.estado, s.fecha, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente,
         coalesce(nullif(btrim(s.zona), ''), nullif(btrim(f.zona), '')),
         -- Solo con los chicos cargados uno por uno (nunca el texto libre de familias.ninos).
         case when exists (select 1 from public.hijos_familia h where h.familia_id = s.familia_id)
              then public.chicos_texto(s.familia_id) end,
         sn.precio_hora, s.responder_hasta, sn.enviado_en, sn.respondido_en
    from public.solicitud_ninieras sn
    join public.solicitudes s on s.id = sn.solicitud_id
    left join public.familias f on f.id = s.familia_id
   where sn.ninera_id = (select public.ninera_actual())
     and sn.origen = 'app'
     and sn.estado in ('invitada', 'acepto')
     and s.estado in ('sin_asignar', 'pendiente_confirmar')
     and s.fecha >= public.hoy_mvd()
   order by s.fecha, s.hora_inicio
$function$;
revoke execute on function public.ninera_mis_pedidos() from public, anon;
grant execute on function public.ninera_mis_pedidos() to authenticated;

drop function public.ninera_mis_sittings();
-- Como en la etapa 2 (schema.sql antes de esta migración).
create function public.ninera_mis_sittings()
returns table (id uuid, tipo text, fecha date, hora_inicio time without time zone,
               hora_fin time without time zone, termina_dia_siguiente boolean, estado text,
               zona text, madre text, direccion text, origen text, destino text, chicos text,
               notas_para_ninera text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.id, s.tipo, s.fecha, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente, s.estado,
         f.zona,
         public.madre_nombre_inicial(coalesce(f.nombre, s.familia_nombre)),
         case when s.estado = 'confirmado' then f.direccion end,
         case when s.estado = 'confirmado' then s.origen end,
         case when s.estado = 'confirmado' then s.destino end,
         public.chicos_texto(f.id),
         null::text
    from public.sittings_traslados s
    left join public.familias f on f.id = s.familia_id
   where s.ninera_id = (select public.ninera_actual())
     and not s.cancelado
     and s.estado in ('previsto', 'confirmado')
     and s.fecha between public.hoy_mvd() and public.hoy_mvd() + 60
   order by s.fecha, s.hora_inicio
$function$;
revoke execute on function public.ninera_mis_sittings() from public, anon;
grant execute on function public.ninera_mis_sittings() to authenticated;

drop function if exists public.pedido_puede_avisar(uuid, text, text);

update public.solicitud_ninieras
   set estado = case when respondido_en is not null then 'acepto' else 'invitada' end
 where estado in ('cubierto', 'cancelado');
alter table public.solicitud_ninieras drop constraint solicitud_ninieras_estado_check;
alter table public.solicitud_ninieras add constraint solicitud_ninieras_estado_check
  check (estado in ('invitada', 'confirmada', 'rechazada', 'acepto', 'no_puedo'));
alter table public.solicitud_ninieras drop column seleccionada_en, drop column visto_en;

drop index if exists public.sittings_traslados_solicitud;
alter table public.sittings_traslados drop column solicitud_id;
alter table public.solicitudes drop column horario_aproximado;

commit;
