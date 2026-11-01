-- ============================================================================
-- Migración 03/11/2026 (fase 1, etapa 6): elegir la niñera de un pedido y avisarles a todas.
--
-- La admin asigna a la que eligió la madre (con "Asignar", desde "Pedidos en curso" o desde
-- "Elegir niñeras"); a la elegida le llega "¡Quedaste seleccionada!" y ve los datos en la app, y a
-- las que dijeron "Puedo" y no quedaron, "Ya se cubrió". Si se cancela el pedido, a las que dijeron
-- "Puedo", "Se canceló el pedido del [día]". Además, los avisos de tiempo de los pedidos
-- (decisiones.md 7): recordatorio a la niñera que no respondió, "Mandale los perfiles a la madre",
-- "Nadie respondió" y "Sigue sin niñera" 3 horas antes (plan-implementacion.md, etapa 6).
--
-- La app nunca elige sola (Paulina y Delfina, 01/11/2026): lo que dispara los avisos es que una
-- admin confirme a una niñera. Por eso van en triggers sobre las escrituras de siempre del panel
-- ("Asignar" confirma la fila de la niñera; "Cancelar solicitud" cancela la solicitud): cualquier
-- camino que asigne o cancele avisa, y el aviso queda en la misma transacción que el cambio.
--
-- Suma:
--   - solicitudes.horario_aproximado: la madre no dio una hora de fin cerrada. Lo trae el ticket de
--     pedido-whatsapp y se puede tildar a mano. Solo con la marca va "(aproximada, se puede
--     extender)" en el aviso del pedido y en la app (Diego, 01/11/2026; antes iba siempre);
--   - solicitud_ninieras: estados 'cubierto' (se asignó a otra) y 'cancelado' (se canceló el
--     pedido), seleccionada_en (cuándo le llegó "¡Quedaste seleccionada!") y visto_en (cuándo lo
--     vio en la app: la tarjeta de arriba y los avisos de una vez se van);
--   - sittings_traslados.solicitud_id: el registro que salió de un pedido. De ahí la app de
--     niñeras saca las indicaciones (notas_para_ninera), el precio por hora y la marca de horario
--     aproximado del sitting;
--   - pedido_puede_avisar (ayuda), los triggers de "Seleccionada", "Ya se cubrió" y "Se canceló",
--     ninera_marcar_pedido_visto (niñera) y programar_avisos_pedidos (cron, cada minuto, dentro de
--     programar_avisos);
--   - cambian enviar_pedido_app (la marca de aproximado), ninera_mis_pedidos (la marca, el id de la
--     solicitud y las filas de una vez: seleccionada, cubierto, cancelado) y ninera_mis_sittings (las
--     indicaciones, el precio por hora y la marca). Las dos últimas cambian lo que devuelven: se
--     borran y se vuelven a crear (mismas columnas de antes, en el mismo orden, y las nuevas al final:
--     la app publicada sigue andando).
--
-- solo_practica (app_config 'pedidos_app'): mientras esté prendido, a una niñera real no le llega
-- ningún aviso de pedidos aunque una admin la asigne a mano (pedido_puede_avisar).
--
-- Compatible con la app publicada: columnas nuevas con valor por defecto o vacías, el check de
-- estados solo suma valores y los dos estados nuevos los escriben solo los triggers. No modifica
-- datos: no hace falta respaldo. Se deshace con 20261103_eleccion_pedidos_DESHACER.sql.
-- ============================================================================
begin;

-- ---- Columnas ----
alter table public.solicitudes add column horario_aproximado boolean default false not null;

alter table public.solicitud_ninieras
  add column seleccionada_en timestamp with time zone,
  add column visto_en timestamp with time zone;
alter table public.solicitud_ninieras drop constraint solicitud_ninieras_estado_check;
alter table public.solicitud_ninieras add constraint solicitud_ninieras_estado_check
  check (estado in ('invitada', 'confirmada', 'rechazada', 'acepto', 'no_puedo', 'cubierto', 'cancelado'));

alter table public.sittings_traslados
  add column solicitud_id uuid references public.solicitudes(id) on delete set null;
create index sittings_traslados_solicitud on public.sittings_traslados (solicitud_id) where solicitud_id is not null;

-- ---- Ayuda ----
-- ¿Se le puede mandar un aviso de pedidos a esta niñera por este pedido? Con solo_practica prendido,
-- solo si la familia y la niñera son las dos de práctica ("(práctica)" con o sin tilde, la misma
-- regla que enviar_pedido_app). Apagado, siempre.
create or replace function public.pedido_puede_avisar(p_familia_id uuid, p_familia_nombre text, p_ninera_nombre text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select not coalesce((select (valor->>'solo_practica')::boolean from public.app_config where id = 'pedidos_app'), true)
      or (position('(practica)' in public.normaliza_nombre(coalesce((select f.nombre from public.familias f where f.id = p_familia_id), p_familia_nombre))) > 0
          and position('(practica)' in public.normaliza_nombre(p_ninera_nombre)) > 0)
$function$;
revoke execute on function public.pedido_puede_avisar(uuid, text, text) from public, anon, authenticated;

-- ---- El aviso del pedido: "(aproximada, se puede extender)" solo con la marca ----
-- Igual que en 20261102_pedidos_app.sql salvo v_horario.
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

-- ---- Una admin confirma a una niñera: "¡Quedaste seleccionada!" y "Ya se cubrió" ----
-- Corre cuando una fila de solicitud_ninieras pasa a 'confirmada' (o se inserta así: "Asignar" a una
-- que no recibió el pedido por la app, Diego 01/11/2026). Solo pedidos de sitting (los traslados no
-- van por la app, decisiones 4.2).
--   - Las demás filas de la app que seguían abiertas ('invitada' o 'acepto') pasan a 'cubierto'; a
--     las que habían dicho "Puedo" (respondido_en) les llega "Gracias por responder" (4.19).
--   - Si la elegida tiene app y el pedido es de hoy en adelante, "¡Quedaste seleccionada!" y
--     seleccionada_en (la tarjeta de arriba en su inicio, hasta que la ve).
-- Los avisos, solo si pedido_puede_avisar. Las claves son una por fila: no se repiten.
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
-- Solo cuando cambia el estado: el update de seleccionada_en de adentro no lo vuelve a disparar.
create trigger solicitud_ninieras_al_confirmar after insert or update of estado on public.solicitud_ninieras
  for each row when (new.estado = 'confirmada')
  execute function public.solicitud_ninieras_al_confirmar();

-- ---- Se cancela el pedido: "Se canceló el pedido del [día]" ----
-- Las filas de la app abiertas pasan a 'cancelado'; a las que dijeron "Puedo", el aviso (4.19).
create or replace function public.solicitudes_al_cancelar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_otra record;
begin
  for v_otra in
    update public.solicitud_ninieras x
       set estado = 'cancelado'
     where x.solicitud_id = new.id and x.origen = 'app' and x.estado in ('invitada', 'acepto')
    returning x.id, x.ninera_id, x.ninera_nombre, x.respondido_en
  loop
    if v_otra.respondido_en is not null and new.fecha >= public.hoy_mvd()
       and public.pedido_puede_avisar(new.familia_id, new.familia_nombre, v_otra.ninera_nombre) then
      perform public.encolar_aviso('pedido:' || v_otra.id || ':cancelado', v_otra.ninera_id, null, 'pedido',
        'Se canceló el pedido del ' || public.dia_corto_texto(new.fecha), 'Gracias por responder.',
        '#inicio', jsonb_build_object('solicitud_ninera_id', v_otra.id));
    end if;
  end loop;
  return null;
end
$function$;
revoke execute on function public.solicitudes_al_cancelar() from public, anon, authenticated;
create trigger solicitudes_al_cancelar after update of estado on public.solicitudes
  for each row when (new.estado = 'cancelada' and old.estado is distinct from 'cancelada')
  execute function public.solicitudes_al_cancelar();

-- ---- Lo que ve la niñera ----
-- Sus pedidos abiertos (como en la etapa 5) y, una sola vez, lo que se cerró: la elegida
-- ('confirmada' con seleccionada_en) hasta que abre los datos, y 'cubierto' / 'cancelado' de las que
-- dijeron "Puedo" hasta que lo ve en el inicio. Nunca familia, dirección, notas ni cobro.
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

-- La niñera vio la tarjeta de "Seleccionada" (abrió los datos) o el aviso de "cubierto" / "cancelado"
-- del inicio: no se le vuelve a mostrar. Solo sus filas. true si marcó algo.
create or replace function public.ninera_marcar_pedido_visto(p_sn_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  update public.solicitud_ninieras
     set visto_en = now()
   where id = p_sn_id and ninera_id = v_yo and visto_en is null
     and estado in ('confirmada', 'cubierto', 'cancelado');
  return found;
end
$function$;
revoke execute on function public.ninera_marcar_pedido_visto(uuid) from public, anon;
grant execute on function public.ninera_marcar_pedido_visto(uuid) to authenticated;

-- Próximos sittings: lo de la etapa 2 y, si el registro salió de un pedido, las indicaciones para la
-- niñera (solo confirmado, como la dirección), la marca de horario aproximado y su precio por hora
-- (lo que se le ofreció o con lo que se la asignó; nunca un total).
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

-- ---- Avisos de tiempo de los pedidos (decisiones 7) ----
-- Corre cada minuto dentro de programar_avisos (cron enviar-avisos). p_ahora es para las pruebas.
-- Cada aviso tiene su clave (no se repite) y una ventana: si el cron estuvo parado, no salen avisos
-- viejos de golpe (2 horas para los de las admins; el recordatorio, solo antes de responder_hasta).
--   - pedido:<sn>:recordatorio: a la que sigue sin responder, recordatorio_min_antes (10) antes de
--     responder_hasta.
--   - admin:pedido:<sol>:perfiles: hay al menos una que puede y nadie elegida, 15 min (pedido para el
--     mismo día del envío) o 30 min (otro día) después del primer envío.
--   - admin:pedido:<sol>:nadie: nadie respondió nada, min_nadie (30) después del primer envío.
--   - admin:pedido:<sol>:3h: pedido de hoy sin niñera (mandado por la app o no), aviso_sin_ninera_horas
--     (3) antes del inicio. Mientras solo_practica esté prendido, solo de familias de práctica (Diego,
--     01/11/2026: se prende con todo lo demás antes de la prueba con niñeras reales).
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
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos() from public, anon, authenticated;
grant execute on function public.programar_avisos() to service_role;

commit;
