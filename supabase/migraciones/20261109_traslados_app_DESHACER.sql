-- Deshace 20261109_traslados_app.sql: las funciones vuelven a como estaban (solo sittings: 20261102_pedidos_app,
-- 20261103_eleccion_pedidos, 20261106_el_dia y 20261107_ficha_cambios), se saca carsitting_aprobado y las columnas
-- nuevas.
--
-- Lo cargado no se pierde: antes de sacar las columnas, las filas que las usan se copian enteras a
-- respaldo_traslados_20261109_solicitudes, _solicitud_ninieras, _pedidos_whatsapp y _cambios_horario (RLS sin
-- políticas: solo se ven con la clave de servicio o desde el SQL Editor). Los pedidos de traslado que ya se mandaron
-- por la app quedan con sus filas (sin el precio por viaje, que queda en el respaldo); la app vieja no los muestra
-- distinto de un sitting.
begin;

do $$
begin
  if to_regclass('public.respaldo_traslados_20261109_solicitudes') is null then
    create table public.respaldo_traslados_20261109_solicitudes as
      select s.*, now() as respaldado_en from public.solicitudes s
       where s.origen is not null or s.destino is not null or s.destino_zona is not null or s.km is not null;
    alter table public.respaldo_traslados_20261109_solicitudes enable row level security;
    create table public.respaldo_traslados_20261109_solicitud_ninieras as
      select x.*, now() as respaldado_en from public.solicitud_ninieras x where x.precio_viaje is not null;
    alter table public.respaldo_traslados_20261109_solicitud_ninieras enable row level security;
    create table public.respaldo_traslados_20261109_pedidos_whatsapp as
      select p.*, now() as respaldado_en from public.pedidos_whatsapp p
       where p.origen is not null or p.destino is not null or p.destino_zona is not null;
    alter table public.respaldo_traslados_20261109_pedidos_whatsapp enable row level security;
    create table public.respaldo_traslados_20261109_cambios_horario as
      select c.*, now() as respaldado_en from public.cambios_horario c where c.tipo <> 'sitting';
    alter table public.respaldo_traslados_20261109_cambios_horario enable row level security;
  end if;
end $$;

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
  v_puede boolean;
  v_motivo text;
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
  -- Textos 1: "(aproximada, se puede extender)" solo con la marca horario_aproximado (etapa 6); sin
  -- fin, "sin hora de fin"; si termina pasada la medianoche, "del día siguiente".
  v_horario := to_char(v_s.hora_inicio, 'HH24:MI')
    || case when v_s.hora_fin is null then ', sin hora de fin'
            else ' – ' || to_char(v_s.hora_fin, 'HH24:MI')
                 || case when v_s.termina_dia_siguiente then ' del día siguiente' else '' end
                 || case when v_s.horario_aproximado then ' (aproximada, se puede extender)' else '' end end;

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
    -- La guía (etapa 4, decisiones 8): sin la guía o con la firma vencida no recibe pedidos por la app,
    -- tampoco la de práctica. detail: el motivo ('sin_guia', 'firma_vencida').
    select g.puede, g.motivo into v_puede, v_motivo from public.guia_estado(v_n.id) g;
    if not coalesce(v_puede, false) then
      raise exception 'ninera_sin_guia' using hint = v_n.nombre, detail = coalesce(v_motivo, '');
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

create or replace function public.solicitud_ninieras_al_confirmar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s public.solicitudes;
  v_n public.ninieras;
  v_otra record;
begin
  if tg_op = 'UPDATE' and old.estado = 'confirmada' then return null; end if;
  select * into v_s from public.solicitudes where id = new.solicitud_id;
  if not found or v_s.tipo <> 'sitting' then return null; end if;

  for v_otra in
    update public.solicitud_ninieras x
       set estado = 'cubierto'
     where x.solicitud_id = new.solicitud_id and x.id <> new.id and x.origen = 'app'
       and x.estado in ('invitada', 'acepto')
    returning x.id, x.ninera_id, x.ninera_nombre, x.respondido_en
  loop
    if v_otra.respondido_en is not null and v_s.fecha >= public.hoy_mvd()
       and public.pedido_puede_avisar(v_s.familia_id, v_s.familia_nombre, v_otra.ninera_nombre) then
      perform public.encolar_aviso('pedido:' || v_otra.id || ':cubierto', v_otra.ninera_id, null, 'pedido',
        'Gracias por responder', 'Este sitting ya quedó cubierto. ¡Te tendremos en cuenta para el próximo!',
        '#inicio', jsonb_build_object('solicitud_ninera_id', v_otra.id));
    end if;
  end loop;

  if new.ninera_id is null or new.seleccionada_en is not null or v_s.fecha < public.hoy_mvd() then return null; end if;
  select * into v_n from public.ninieras where id = new.ninera_id;
  if not found or v_n.user_id is null
     or not public.pedido_puede_avisar(v_s.familia_id, v_s.familia_nombre, v_n.nombre) then
    return null;
  end if;
  update public.solicitud_ninieras set seleccionada_en = now() where id = new.id;
  perform public.encolar_aviso('pedido:' || new.id || ':seleccionada', v_n.id, null, 'pedido',
    '¡Quedaste seleccionada!',
    public.dia_corto_texto(v_s.fecha) || ' a las ' || to_char(v_s.hora_inicio, 'HH24:MI') || '. Ya tienes todos los datos en la app.',
    '#pedido/' || new.id, jsonb_build_object('solicitud_ninera_id', new.id));
  return null;
end
$function$;
revoke execute on function public.solicitud_ninieras_al_confirmar() from public, anon, authenticated;

create or replace function public.programar_avisos_pedidos(p_ahora timestamp with time zone default now())
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_cfg jsonb := coalesce((select valor from public.app_config where id = 'pedidos_app'), '{}'::jsonb);
  v_hoy date := (p_ahora at time zone 'America/Montevideo')::date;
  v_rec integer := coalesce((v_cfg->>'recordatorio_min_antes')::int, 10);
  v_nadie integer := coalesce((v_cfg->>'min_nadie')::int, 30);
  v_horas integer := coalesce((v_cfg->>'aviso_sin_ninera_horas')::int, 3);
  v_solo_practica boolean := coalesce((v_cfg->>'solo_practica')::boolean, true);
  v_total integer := 0;
  v_min integer;
  v_inicio timestamp with time zone;
  r record;
begin
  -- Recordatorio a la niñera.
  for r in
    select sn.id, sn.ninera_id, s.fecha
      from public.solicitud_ninieras sn
      join public.solicitudes s on s.id = sn.solicitud_id
     where sn.origen = 'app' and sn.estado = 'invitada'
       and s.estado in ('sin_asignar', 'pendiente_confirmar') and s.fecha >= v_hoy
       and s.responder_hasta is not null
       and p_ahora >= s.responder_hasta - make_interval(mins => v_rec) and p_ahora < s.responder_hasta
  loop
    if public.encolar_aviso('pedido:' || r.id || ':recordatorio', r.ninera_id, null, 'pedido',
         'Sitting ' || to_char(r.fecha, 'DD/MM'), '¡Hola! Avísame por favor si estarías disponible.',
         '#pedido/' || r.id, jsonb_build_object('solicitud_ninera_id', r.id)) then
      v_total := v_total + 1;
    end if;
  end loop;

  -- Perfiles para la madre y nadie respondió.
  for r in
    select s.id, s.familia_nombre, s.fecha, s.enviado_app_en,
           (select count(*) from public.solicitud_ninieras x
             where x.solicitud_id = s.id and x.origen = 'app' and x.estado = 'acepto')::int as pueden,
           (select count(*) from public.solicitud_ninieras x
             where x.solicitud_id = s.id and x.origen = 'app' and x.respondido_en is not null)::int as respondieron
      from public.solicitudes s
     where s.estado = 'pendiente_confirmar' and s.enviado_app_en is not null and s.fecha >= v_hoy
       and p_ahora < s.enviado_app_en + interval '3 hours'
  loop
    v_min := case when r.fecha = (r.enviado_app_en at time zone 'America/Montevideo')::date
                  then coalesce((v_cfg->>'min_mismo_dia')::int, 15)
                  else coalesce((v_cfg->>'min_otro_dia')::int, 30) end;
    if r.pueden > 0
       and p_ahora >= r.enviado_app_en + make_interval(mins => v_min)
       and p_ahora < r.enviado_app_en + make_interval(mins => v_min) + interval '2 hours'
       and public.encolar_aviso('admin:pedido:' || r.id || ':perfiles', null, 'todas', 'pedidos',
             case when r.pueden = 1 then 'Puede 1 niñera para el pedido de ' else 'Pueden ' || r.pueden || ' niñeras para el pedido de ' end
               || r.familia_nombre,
             'Mandale los perfiles a la madre.', '?ir=agenda&solicitud=' || r.id, jsonb_build_object('solicitud_id', r.id)) then
      v_total := v_total + 1;
    end if;
    if r.respondieron = 0
       and p_ahora >= r.enviado_app_en + make_interval(mins => v_nadie)
       and p_ahora < r.enviado_app_en + make_interval(mins => v_nadie) + interval '2 hours'
       and public.encolar_aviso('admin:pedido:' || r.id || ':nadie', null, 'todas', 'pedidos',
             'Nadie respondió el pedido de ' || r.familia_nombre, 'Preguntale a más niñeras.',
             '?ir=agenda&solicitud=' || r.id, jsonb_build_object('solicitud_id', r.id)) then
      v_total := v_total + 1;
    end if;
  end loop;

  -- Pedido de hoy sin niñera, 3 horas antes.
  for r in
    select s.id, s.familia_nombre, s.hora_inicio, s.estado, s.fecha
      from public.solicitudes s
      left join public.familias f on f.id = s.familia_id
     where s.estado in ('sin_asignar', 'pendiente_confirmar') and s.fecha = v_hoy
       and (not v_solo_practica
            or position('(practica)' in public.normaliza_nombre(coalesce(f.nombre, s.familia_nombre))) > 0)
  loop
    v_inicio := (r.fecha + r.hora_inicio) at time zone 'America/Montevideo';
    if p_ahora >= v_inicio - make_interval(hours => v_horas) and p_ahora < v_inicio
       and public.encolar_aviso('admin:pedido:' || r.id || ':3h', null, 'todas', 'pedidos',
             r.familia_nombre || ' hoy a las ' || to_char(r.hora_inicio, 'HH24:MI') || ' sigue sin niñera',
             case when r.estado = 'pendiente_confirmar' then 'Mirá las respuestas.' else 'Elegí a quién mandárselo.' end,
             '?ir=agenda&solicitud=' || r.id, jsonb_build_object('solicitud_id', r.id)) then
      v_total := v_total + 1;
    end if;
  end loop;
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos_pedidos(timestamp with time zone) from public, anon, authenticated;
grant execute on function public.programar_avisos_pedidos(timestamp with time zone) to service_role;

create or replace function public.programar_avisos_el_dia(p_ahora timestamp with time zone default now())
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_cfg jsonb := coalesce((select valor from public.app_config where id = 'el_dia'), '{}'::jsonb);
  v_no_llego integer := coalesce((v_cfg->>'no_llego_min')::int, 15);
  v_rec integer := coalesce((v_cfg->>'cierre_recordatorio_min')::int, 30);
  v_hoy date := (p_ahora at time zone 'America/Montevideo')::date;
  v_dias text[] := array['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  v_total integer := 0;
  v_inicio timestamp with time zone;
  v_fin timestamp with time zone;
  v_lugar text;
  r record;
begin
  for r in
    select s.id, s.fecha, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente, s.asignacion_id is not null as es_fijo,
           s.ninera_id, n.nombre as ninera, coalesce(f.nombre, s.familia_nombre) as familia, nullif(btrim(f.zona), '') as zona,
           exists (select 1 from public.sitting_eventos e where e.sitting_id = s.id and e.tipo = 'entre') as entro,
           exists (select 1 from public.sitting_cierres c where c.sitting_id = s.id) as cerro
      from public.sittings_traslados s
      join public.ninieras n on n.id = s.ninera_id
      left join public.familias f on f.id = s.familia_id
     where s.fecha between v_hoy - 1 and v_hoy + 1
       and s.tipo = 'sitting' and not s.cancelado and s.estado = 'confirmado' and s.revisado_at is null
       and s.hora_inicio is not null
       and n.activa and n.user_id is not null
       and public.pedido_puede_avisar(s.familia_id, s.familia_nombre, n.nombre)
  loop
    v_inicio := (r.fecha + r.hora_inicio) at time zone 'America/Montevideo';
    v_fin := case when r.hora_fin is not null
                  then ((r.fecha + case when r.termina_dia_siguiente then 1 else 0 end) + r.hora_fin) at time zone 'America/Montevideo' end;
    v_lugar := coalesce(', en ' || r.zona, '');
    if not r.es_fijo then
      if p_ahora >= v_inicio - interval '24 hours' and p_ahora < v_inicio - interval '23 hours'
         and public.encolar_aviso('sitting:' || r.id || ':24h', r.ninera_id, null, 'sitting', '¡Hola! Mañana tienes un sitting',
               v_dias[extract(dow from r.fecha)::int + 1] || ' ' || to_char(r.fecha, 'DD/MM') || ' a las '
                 || to_char(r.hora_inicio, 'HH24:MI') || v_lugar || '.',
               '#inicio', jsonb_build_object('sitting_id', r.id)) then
        v_total := v_total + 1;
      end if;
      if p_ahora >= v_inicio - interval '1 hour' and p_ahora < v_inicio - interval '30 minutes'
         and public.encolar_aviso('sitting:' || r.id || ':1h', r.ninera_id, null, 'sitting', 'Tu sitting empieza en 1 hora',
               to_char(r.hora_inicio, 'HH24:MI') || v_lugar || '.', '#inicio', jsonb_build_object('sitting_id', r.id)) then
        v_total := v_total + 1;
      end if;
      if not r.entro and not r.cerro
         and p_ahora >= v_inicio + make_interval(mins => v_no_llego) and p_ahora < v_inicio + interval '2 hours'
         and public.encolar_aviso('admin:sitting:' || r.id || ':no_llego', null, 'todas', 'el_dia',
               r.ninera || ' no marcó que llegó',
               'El sitting con ' || r.familia || ' empezaba a las ' || to_char(r.hora_inicio, 'HH24:MI') || '.',
               '?ir=hoy&sitting=' || r.id, jsonb_build_object('sitting_id', r.id, 'ninera_id', r.ninera_id)) then
        v_total := v_total + 1;
      end if;
    end if;
    if v_fin is not null and not r.cerro then
      if p_ahora >= v_fin and p_ahora < v_fin + make_interval(mins => v_rec)
         and public.encolar_aviso('sitting:' || r.id || ':fin', r.ninera_id, null, 'sitting', '¿Ya te retiraste del hogar?',
               'Cuéntanos hasta qué hora estuviste.', '#sitting/' || r.id || '/cierre', jsonb_build_object('sitting_id', r.id)) then
        v_total := v_total + 1;
      end if;
      if p_ahora >= v_fin + make_interval(mins => v_rec) and p_ahora < v_fin + interval '3 hours'
         and public.encolar_aviso('sitting:' || r.id || ':fin30', r.ninera_id, null, 'sitting', 'Te falta cerrar el sitting',
               'Cuéntanos hasta qué hora estuviste.', '#sitting/' || r.id || '/cierre', jsonb_build_object('sitting_id', r.id)) then
        v_total := v_total + 1;
      end if;
    end if;
  end loop;
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos_el_dia(timestamp with time zone) from public, anon, authenticated;
grant execute on function public.programar_avisos_el_dia(timestamp with time zone) to service_role;

drop function public.ninera_mis_pedidos();
create function public.ninera_mis_pedidos()
returns table (id uuid, estado text, fecha date, hora_inicio time without time zone,
               hora_fin time without time zone, termina_dia_siguiente boolean, zona text, chicos text,
               precio_hora numeric, responder_hasta timestamp with time zone,
               enviado_en timestamp with time zone, respondido_en timestamp with time zone,
               horario_aproximado boolean, solicitud_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select sn.id, sn.estado, s.fecha, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente,
         coalesce(nullif(btrim(s.zona), ''), nullif(btrim(f.zona), '')),
         case when exists (select 1 from public.hijos_familia h where h.familia_id = s.familia_id)
              then public.chicos_texto(s.familia_id) end,
         sn.precio_hora, s.responder_hasta, sn.enviado_en, sn.respondido_en,
         s.horario_aproximado, s.id
    from public.solicitud_ninieras sn
    join public.solicitudes s on s.id = sn.solicitud_id
    left join public.familias f on f.id = s.familia_id
   where sn.ninera_id = (select public.ninera_actual())
     and s.fecha >= public.hoy_mvd()
     and ((sn.origen = 'app' and sn.estado in ('invitada', 'acepto') and s.estado in ('sin_asignar', 'pendiente_confirmar'))
          or (sn.estado = 'confirmada' and sn.seleccionada_en is not null and sn.visto_en is null and s.estado = 'confirmada')
          or (sn.origen = 'app' and sn.estado in ('cubierto', 'cancelado') and sn.respondido_en is not null and sn.visto_en is null))
   order by s.fecha, s.hora_inicio
$function$;
revoke execute on function public.ninera_mis_pedidos() from public, anon;
grant execute on function public.ninera_mis_pedidos() to authenticated;

drop function public.ninera_mis_sittings();
create function public.ninera_mis_sittings()
returns table (id uuid, tipo text, fecha date, hora_inicio time without time zone,
               hora_fin time without time zone, termina_dia_siguiente boolean, estado text,
               zona text, madre text, direccion text, origen text, destino text, chicos text,
               notas_para_ninera text, horario_aproximado boolean, precio_hora numeric, solicitud_id uuid)
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
         case when s.estado = 'confirmado' then nullif(btrim(sol.notas_para_ninera), '') end,
         coalesce(sol.horario_aproximado, false),
         (select sn.precio_hora from public.solicitud_ninieras sn
           where sn.solicitud_id = s.solicitud_id and sn.ninera_id = s.ninera_id and sn.estado = 'confirmada'
           order by sn.created_at desc limit 1),
         s.solicitud_id
    from public.sittings_traslados s
    left join public.familias f on f.id = s.familia_id
    left join public.solicitudes sol on sol.id = s.solicitud_id
   where s.ninera_id = (select public.ninera_actual())
     and not s.cancelado
     and s.estado in ('previsto', 'confirmado')
     and s.fecha between public.hoy_mvd() and public.hoy_mvd() + 60
   order by s.fecha, s.hora_inicio
$function$;
revoke execute on function public.ninera_mis_sittings() from public, anon;
grant execute on function public.ninera_mis_sittings() to authenticated;

drop function public.ninera_mis_cambios();
create function public.ninera_mis_cambios()
returns table (id uuid, es_fijo boolean, desde date, hora_inicio time without time zone, hora_fin time without time zone,
               termina_dia_siguiente boolean, madre text, zona text, creado_en timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.id, c.es_fijo, c.desde, c.hora_inicio, c.hora_fin, c.termina_dia_siguiente,
         public.madre_nombre_inicial(coalesce(f.nombre, c.familia_nombre)), nullif(btrim(f.zona), ''), c.creado_en
    from public.cambios_horario c
    left join public.familias f on f.id = c.familia_id
   where c.ninera_id = (select public.ninera_actual()) and c.respuesta is null and c.desde >= public.hoy_mvd()
   order by c.creado_en
$function$;
revoke execute on function public.ninera_mis_cambios() from public, anon;
grant execute on function public.ninera_mis_cambios() to authenticated;

drop function public.aviso_sitting_ninera(text, uuid, uuid, uuid, text, date, time without time zone, time without time zone, boolean, uuid, date, text);
create function public.aviso_sitting_ninera(p_tipo text, p_sitting_id uuid, p_ninera_id uuid, p_familia_id uuid,
  p_familia_nombre text, p_fecha date, p_hi time without time zone, p_hf time without time zone, p_termina boolean,
  p_solicitud_id uuid default null, p_fecha_antes date default null)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_madre text;
  v_zona text;
  v_dia text := public.dia_corto_texto(p_fecha);
  v_cambio uuid;
  v_datos jsonb := jsonb_build_object('sitting_id', p_sitting_id);
begin
  if p_ninera_id is null or p_fecha is null then return; end if;
  if ((p_fecha + coalesce(p_hi, '00:00'::time)) at time zone 'America/Montevideo') <= now() then return; end if;
  if not public.sitting_puede_avisar(p_ninera_id, p_familia_id, p_familia_nombre) then return; end if;
  select public.madre_nombre_inicial(coalesce(f.nombre, p_familia_nombre)), nullif(btrim(f.zona), '')
    into v_madre, v_zona from (select 1) x left join public.familias f on f.id = p_familia_id;
  if p_tipo = 'cancelado' then
    perform public.encolar_aviso('sitting:' || p_sitting_id || ':cancelado:' || txid_current(), p_ninera_id, null, 'sitting',
      'Se canceló tu sitting del ' || v_dia, 'Con ' || rtrim(v_madre, '.') || '. Si tienes dudas, escríbenos.', '#inicio', v_datos);
  elsif p_tipo = 'sin' then
    perform public.encolar_aviso('sitting:' || p_sitting_id || ':sin:' || p_ninera_id || ':' || txid_current(), p_ninera_id, null, 'sitting',
      'Ya no vas al sitting del ' || v_dia, 'El equipo hizo un cambio. Si tienes dudas, escríbenos.', '#inicio', v_datos);
  elsif p_tipo = 'nuevo' then
    if p_solicitud_id is not null and exists (select 1 from public.solicitud_ninieras sn
         where sn.solicitud_id = p_solicitud_id and sn.ninera_id = p_ninera_id and sn.estado = 'confirmada') then
      return;
    end if;
    perform public.encolar_aviso('sitting:' || p_sitting_id || ':nuevo:' || p_ninera_id || ':' || txid_current(), p_ninera_id, null, 'sitting',
      'Tienes un sitting el ' || v_dia,
      coalesce(to_char(p_hi, 'HH24:MI'), 'Sin horario') || coalesce(', en ' || v_zona, '') || '. Mira los datos en la app.',
      '#inicio', v_datos);
  elsif p_tipo = 'cambio' then
    v_cambio := gen_random_uuid();
    if public.encolar_aviso('sitting:' || p_sitting_id || ':cambio:' || p_fecha || ':' || coalesce(to_char(p_hi, 'HH24MI'), '') || '-'
           || coalesce(to_char(p_hf, 'HH24MI'), '') || case when p_termina then 'd' else '' end,
         p_ninera_id, null, 'sitting',
         'Cambió el horario de tu sitting del ' || public.dia_corto_texto(coalesce(p_fecha_antes, p_fecha)),
         'Ahora es ' || case when p_fecha_antes is not null and p_fecha_antes <> p_fecha then 'el ' || v_dia || ', ' else '' end
           || public.horario_texto(p_hi, p_hf, p_termina) || '. Mira los detalles.',
         '#cambio/' || v_cambio, v_datos || jsonb_build_object('cambio_id', v_cambio)) then
      insert into public.cambios_horario (id, ninera_id, familia_id, familia_nombre, sitting_id, solicitud_id, es_fijo, desde,
                                          hora_inicio, hora_fin, termina_dia_siguiente)
      values (v_cambio, p_ninera_id, p_familia_id, p_familia_nombre, p_sitting_id, p_solicitud_id, false, p_fecha, p_hi, p_hf, coalesce(p_termina, false));
    end if;
  end if;
end
$function$;
revoke execute on function public.aviso_sitting_ninera(text, uuid, uuid, uuid, text, date, time without time zone, time without time zone, boolean, uuid, date) from public, anon, authenticated;

create or replace function public.sittings_avisos_cambios()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  begin
    if coalesce(current_setting('pb.previstos', true), '') = '1' then
      create temporary table if not exists _pb_cambios_previstos (
        accion text, id uuid, fecha date, tipo text, cancelado boolean, ninera_id uuid, ninera_nombre text,
        familia_id uuid, familia_nombre text, asignacion_id uuid, hora_inicio time without time zone,
        hora_fin time without time zone, termina_dia_siguiente boolean) on commit drop;
      if tg_op in ('UPDATE', 'DELETE') then
        insert into _pb_cambios_previstos
          select 'antes', o.id, o.fecha, o.tipo, o.cancelado, o.ninera_id, o.ninera_nombre, o.familia_id, o.familia_nombre,
                 o.asignacion_id, o.hora_inicio, o.hora_fin, o.termina_dia_siguiente from viejas o;
      end if;
      if tg_op in ('UPDATE', 'INSERT') then
        insert into _pb_cambios_previstos
          select 'despues', n.id, n.fecha, n.tipo, n.cancelado, n.ninera_id, n.ninera_nombre, n.familia_id, n.familia_nombre,
                 n.asignacion_id, n.hora_inicio, n.hora_fin, n.termina_dia_siguiente from nuevas n;
      end if;
      return null;
    end if;

    if tg_op = 'UPDATE' then
      for r in
        select o.id, o.fecha as f0, n.fecha as f1, o.cancelado as c0, n.cancelado as c1, o.ninera_id as n0, n.ninera_id as n1,
               o.hora_inicio as hi0, n.hora_inicio as hi1, o.hora_fin as hf0, n.hora_fin as hf1,
               o.termina_dia_siguiente as t0, n.termina_dia_siguiente as t1, n.familia_id, n.familia_nombre, n.solicitud_id
          from viejas o join nuevas n on n.id = o.id
         where n.tipo = 'sitting'
           and (o.cancelado, o.ninera_id, o.fecha, o.hora_inicio, o.hora_fin, o.termina_dia_siguiente)
               is distinct from (n.cancelado, n.ninera_id, n.fecha, n.hora_inicio, n.hora_fin, n.termina_dia_siguiente)
      loop
        if not r.c0 and r.c1 then
          perform public.aviso_sitting_ninera('cancelado', r.id, r.n0, r.familia_id, r.familia_nombre, r.f0, r.hi0, r.hf0, r.t0);
        elsif r.c0 and not r.c1 then
          perform public.aviso_sitting_ninera('nuevo', r.id, r.n1, r.familia_id, r.familia_nombre, r.f1, r.hi1, r.hf1, r.t1, r.solicitud_id);
        elsif not r.c1 and r.n0 is distinct from r.n1 then
          perform public.aviso_sitting_ninera('sin', r.id, r.n0, r.familia_id, r.familia_nombre, r.f0, r.hi0, r.hf0, r.t0);
          perform public.aviso_sitting_ninera('nuevo', r.id, r.n1, r.familia_id, r.familia_nombre, r.f1, r.hi1, r.hf1, r.t1, r.solicitud_id);
        elsif not r.c1 then
          perform public.aviso_sitting_ninera('cambio', r.id, r.n1, r.familia_id, r.familia_nombre, r.f1, r.hi1, r.hf1, r.t1, r.solicitud_id, r.f0);
        end if;
      end loop;
    elsif tg_op = 'INSERT' then
      for r in select * from nuevas n where n.tipo = 'sitting' and not n.cancelado and n.asignacion_id is null loop
        perform public.aviso_sitting_ninera('nuevo', r.id, r.ninera_id, r.familia_id, r.familia_nombre, r.fecha, r.hora_inicio, r.hora_fin,
          r.termina_dia_siguiente, r.solicitud_id);
      end loop;
    elsif tg_op = 'DELETE' then
      for r in select * from viejas o where o.tipo = 'sitting' and not o.cancelado loop
        perform public.aviso_sitting_ninera('cancelado', r.id, r.ninera_id, r.familia_id, r.familia_nombre, r.fecha, r.hora_inicio, r.hora_fin,
          r.termina_dia_siguiente);
      end loop;
    end if;
  exception when others then
    -- Un aviso nunca frena un guardado (plata, Agenda, fijos): queda en el log de la base.
    raise warning 'sittings_avisos_cambios: %', sqlerrm;
  end;
  return null;
end
$function$;
revoke execute on function public.sittings_avisos_cambios() from public, anon, authenticated;

create or replace function public.avisar_cambios_previstos(p_hoy date)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  g record;
  v_total integer := 0;
  v_madre text;
  v_zona text;
  v_clave text;
  v_cambio uuid;
  v_titulo text;
  v_cuerpo text;
  v_pausa record;
  v_termina date;
  v_max date;
  v_dias boolean;
begin
  if to_regclass('pg_temp._pb_cambios_previstos') is null then return 0; end if;
  begin
    for g in
      with c as (
        select * from _pb_cambios_previstos
         where coalesce(tipo, 'sitting') = 'sitting' and not coalesce(cancelado, false) and fecha > p_hoy and ninera_id is not null
      ), a as (
        select distinct on (ninera_id, familia_id, fecha) * from c where accion = 'antes' order by ninera_id, familia_id, fecha, hora_inicio
      ), d as (
        select distinct on (ninera_id, familia_id, fecha) * from c where accion = 'despues' order by ninera_id, familia_id, fecha, hora_inicio
      ), pares as (
        select coalesce(a.ninera_id, d.ninera_id) as ninera_id, coalesce(a.familia_id, d.familia_id) as familia_id,
               coalesce(d.familia_nombre, a.familia_nombre) as familia_nombre, coalesce(a.fecha, d.fecha) as fecha,
               a.id is not null as habia, d.id is not null as hay,
               a.id is not null and d.id is not null
                 and (a.hora_inicio, a.hora_fin, a.termina_dia_siguiente) is distinct from (d.hora_inicio, d.hora_fin, d.termina_dia_siguiente) as cambio,
               d.hora_inicio, d.hora_fin, d.termina_dia_siguiente
          from a full join d on d.ninera_id = a.ninera_id and d.familia_id is not distinct from a.familia_id and d.fecha = a.fecha
      )
      select p.ninera_id, p.familia_id, max(p.familia_nombre) as familia_nombre,
             min(p.fecha) filter (where p.cambio) as desde_cambio,
             min(p.fecha) filter (where p.habia and not p.hay) as desde_quita,
             max(p.fecha) filter (where p.habia and not p.hay) as hasta_quita,
             array_agg(p.fecha order by p.fecha) filter (where p.hay and not p.habia) as sumas
        from pares p
       where p.cambio or p.habia <> p.hay
       group by p.ninera_id, p.familia_id
    loop
      if not public.sitting_puede_avisar(g.ninera_id, g.familia_id, g.familia_nombre) then continue; end if;
      select public.madre_nombre_inicial(coalesce(f.nombre, g.familia_nombre)), nullif(btrim(f.zona), '')
        into v_madre, v_zona from (select 1) x left join public.familias f on f.id = g.familia_id;
      v_clave := 'fijo:' || coalesce(g.familia_id::text, '-') || ':' || g.ninera_id || ':';
      v_dias := false;

      if g.desde_cambio is not null then
        select * into v_pausa from _pb_cambios_previstos
         where accion = 'despues' and ninera_id = g.ninera_id and familia_id is not distinct from g.familia_id and fecha = g.desde_cambio
         order by hora_inicio limit 1;
        v_cambio := gen_random_uuid();
        if public.encolar_aviso(v_clave || 'horario:' || txid_current(), g.ninera_id, null, 'sitting',
             'Cambió el horario de tu fijo con ' || v_madre,
             'Desde el ' || public.dia_corto_texto(g.desde_cambio) || ', ' || public.horario_texto(v_pausa.hora_inicio, v_pausa.hora_fin, v_pausa.termina_dia_siguiente)
               || '. Mira los detalles.',
             '#cambio/' || v_cambio, jsonb_build_object('cambio_id', v_cambio)) then
          insert into public.cambios_horario (id, ninera_id, familia_id, familia_nombre, es_fijo, desde, hora_inicio, hora_fin, termina_dia_siguiente)
          values (v_cambio, g.ninera_id, g.familia_id, g.familia_nombre, true, g.desde_cambio, v_pausa.hora_inicio, v_pausa.hora_fin,
                  coalesce(v_pausa.termina_dia_siguiente, false));
          v_total := v_total + 1;
        end if;
      end if;

      if g.desde_quita is not null then
        select p.desde, p.hasta into v_pausa from public.asignaciones_pausas p join public.asignaciones a on a.id = p.asignacion_id
         where a.ninera_id = g.ninera_id and a.familia_id is not distinct from g.familia_id and g.desde_quita between p.desde and p.hasta
         order by p.created_at desc limit 1;
        if found then
          v_titulo := 'Tu fijo con ' || v_madre || ' se pausa';
          v_cuerpo := 'Del ' || public.dia_corto_texto(greatest(v_pausa.desde, g.desde_quita)) || ' al ' || public.dia_corto_texto(v_pausa.hasta)
                      || '. Si tienes dudas, escríbenos.';
        elsif exists (select 1 from _pb_cambios_previstos x
                       where x.accion = 'despues' and x.familia_id is not distinct from g.familia_id and x.ninera_id is distinct from g.ninera_id
                         and x.fecha between g.desde_quita and g.hasta_quita and not coalesce(x.cancelado, false)) then
          v_titulo := 'Ya no vas al fijo con ' || v_madre || ' desde el ' || public.dia_corto_texto(g.desde_quita);
          v_cuerpo := 'El equipo hizo un cambio. Si tienes dudas, escríbenos.';
        elsif not exists (select 1 from public.asignaciones a
                           where a.ninera_id = g.ninera_id and a.familia_id is not distinct from g.familia_id
                             and (a.vigente_hasta is null or a.vigente_hasta >= g.desde_quita)) then
          select max(a.vigente_hasta) into v_termina from public.asignaciones a
           where a.ninera_id = g.ninera_id and a.familia_id is not distinct from g.familia_id;
          v_titulo := 'Tu fijo con ' || v_madre || ' termina el ' || public.dia_corto_texto(coalesce(v_termina, g.desde_quita - 1));
          v_cuerpo := 'Si tienes dudas, escríbenos.';
        else
          v_dias := true;
        end if;
        if not v_dias and public.encolar_aviso(v_clave || 'quita:' || txid_current(), g.ninera_id, null, 'sitting', v_titulo, v_cuerpo,
             '#inicio', jsonb_build_object('familia_id', g.familia_id)) then
          v_total := v_total + 1;
        end if;
      end if;

      if g.sumas is not null then
        if not exists (select 1 from public.sittings_traslados s
                        where s.ninera_id = g.ninera_id and s.familia_id is not distinct from g.familia_id and s.asignacion_id is not null
                          and s.id not in (select x.id from _pb_cambios_previstos x where x.accion = 'despues' and x.id is not null)) then
          select * into v_pausa from _pb_cambios_previstos
           where accion = 'despues' and ninera_id = g.ninera_id and familia_id is not distinct from g.familia_id and fecha = g.sumas[1]
           order by hora_inicio limit 1;
          if public.encolar_aviso(v_clave || 'nuevo:' || txid_current(), g.ninera_id, null, 'sitting',
               'Tienes un fijo nuevo con ' || v_madre,
               'Desde el ' || public.dia_corto_texto(g.sumas[1]) || ', a las ' || coalesce(to_char(v_pausa.hora_inicio, 'HH24:MI'), '-')
                 || coalesce(', en ' || v_zona, '') || '. Mira los datos en la app.',
               '#inicio', jsonb_build_object('familia_id', g.familia_id)) then
            v_total := v_total + 1;
          end if;
        else
          -- Lo que se suma al final de la ventana (la corrida de cada noche agrega un día) no es un cambio.
          select max(s.fecha) into v_max from public.sittings_traslados s
           where s.ninera_id = g.ninera_id and s.familia_id is not distinct from g.familia_id and s.asignacion_id is not null
             and s.id not in (select x.id from _pb_cambios_previstos x where x.accion = 'despues' and x.id is not null);
          if exists (select 1 from unnest(g.sumas) f where f < v_max) then v_dias := true; end if;
        end if;
      end if;

      if v_dias and public.encolar_aviso(v_clave || 'dias:' || txid_current(), g.ninera_id, null, 'sitting',
           'Cambiaron los días de tu fijo con ' || v_madre, 'Mira tus próximos sittings en la app.',
           '#inicio', jsonb_build_object('familia_id', g.familia_id)) then
        v_total := v_total + 1;
      end if;
    end loop;
  exception when others then
    raise warning 'avisar_cambios_previstos: %', sqlerrm;
  end;
  truncate _pb_cambios_previstos;
  return v_total;
end
$function$;
revoke execute on function public.avisar_cambios_previstos(date) from public, anon, authenticated;

drop function if exists public.carsitting_aprobado(uuid);

alter table public.cambios_horario drop constraint if exists cambios_horario_tipo_check, drop column if exists tipo;
alter table public.pedidos_whatsapp
  drop constraint if exists pedidos_whatsapp_origen_check,
  drop constraint if exists pedidos_whatsapp_destino_check,
  drop constraint if exists pedidos_whatsapp_destino_zona_check,
  drop column if exists origen,
  drop column if exists destino,
  drop column if exists destino_zona;
alter table public.solicitud_ninieras
  drop constraint if exists solicitud_ninieras_precio_viaje_check,
  drop column if exists precio_viaje;
alter table public.solicitudes
  drop constraint if exists solicitudes_origen_check,
  drop constraint if exists solicitudes_destino_check,
  drop constraint if exists solicitudes_destino_zona_check,
  drop constraint if exists solicitudes_km_check,
  drop column if exists origen,
  drop column if exists destino,
  drop column if exists destino_zona,
  drop column if exists km;

commit;
