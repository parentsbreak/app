-- Deshace 20261105_guia.sql: se sacan las funciones de la guía, las políticas de la firma y del
-- certificado, la configuración 'guia', las tablas y las columnas de RCP, y vuelven enviar_pedido_app,
-- sugeridas_datos, ninera_mi_perfil y programar_avisos como estaban (20261103_eleccion_pedidos).
--
-- Lo cargado no se pierde: antes de borrar, el progreso, los repasos, las firmas y el RCP de cada niñera
-- se copian a respaldo_guia_20261105_* (RLS sin políticas: solo se ven con la clave de servicio o desde
-- el SQL Editor). Las imágenes de las firmas y los certificados quedan en ninieras-privado (las admins
-- las siguen viendo y borrando). Los avisos de la guía que todavía no salieron se borran (abrirían una
-- pantalla que ya no está).
begin;

do $$
begin
  if to_regclass('public.respaldo_guia_20261105_progreso') is null and to_regclass('public.guia_progreso') is not null then
    create table public.respaldo_guia_20261105_progreso as select g.*, now() as respaldado_en from public.guia_progreso g;
    alter table public.respaldo_guia_20261105_progreso enable row level security;
  end if;
  if to_regclass('public.respaldo_guia_20261105_repasos') is null and to_regclass('public.guia_repasos') is not null then
    create table public.respaldo_guia_20261105_repasos as select r.*, now() as respaldado_en from public.guia_repasos r;
    alter table public.respaldo_guia_20261105_repasos enable row level security;
  end if;
  if to_regclass('public.respaldo_guia_20261105_firmas') is null and to_regclass('public.guia_firmas') is not null then
    create table public.respaldo_guia_20261105_firmas as select f.*, now() as respaldado_en from public.guia_firmas f;
    alter table public.respaldo_guia_20261105_firmas enable row level security;
  end if;
  if to_regclass('public.respaldo_guia_20261105_rcp') is null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ninieras' and column_name = 'rcp_presencial') then
    create table public.respaldo_guia_20261105_rcp as
      select n.id, n.rcp_presencial, n.rcp_certificado_ruta, now() as respaldado_en
        from public.ninieras n where n.rcp_presencial is not null or n.rcp_certificado_ruta is not null;
    alter table public.respaldo_guia_20261105_rcp enable row level security;
  end if;
end $$;

delete from public.avisos where tipo = 'guia' and enviado_en is null;

-- ---- Las funciones que cambiaron, como estaban ----
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

create or replace function public.sugeridas_datos(p_familia_id uuid, p_familia_nombre text, p_fecha date)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with regs0 as (
    -- Un registro sin familia_id se reconoce por el nombre (así cuentan también sus chicos y edades).
    select s.id, s.ninera_id, s.fecha, s.tipo, s.estado,
           coalesce(s.familia_id,
                    (select f.id from public.familias f
                      where public.normaliza_nombre(btrim(f.nombre)) = public.normaliza_nombre(btrim(s.familia_nombre))
                      order by f.created_at, f.id limit 1)) as familia_id,
           s.familia_nombre,
           case when s.ninera_id is null then public.normaliza_nombre(btrim(s.ninera_nombre)) end as ninera_clave
      from public.sittings_traslados s
     where not s.cancelado
       and (s.ninera_id is not null or nullif(btrim(s.ninera_nombre), '') is not null)
  ), regs as (
    select r.*,
           (r.familia_id = p_familia_id
             or (r.familia_id is null and public.normaliza_nombre(btrim(r.familia_nombre)) = public.normaliza_nombre(btrim(p_familia_nombre)))) as con_familia
      from regs0 r
  ), hijos as (
    select h.familia_id, h.fecha_nacimiento, h.edad_declarada, h.edad_declarada_en
      from public.hijos_familia h
  ), edades as (
    select r.ninera_id, r.ninera_clave,
           case when h.fecha_nacimiento is not null then extract(year from age(r.fecha, h.fecha_nacimiento))::int
                when h.edad_declarada is not null
                  then h.edad_declarada + trunc((r.fecha - coalesce(h.edad_declarada_en, r.fecha)) / 365.25)::int
           end as edad
      from regs r join hijos h on h.familia_id = r.familia_id
     where r.tipo = 'sitting' and r.estado <> 'previsto'
  ), chicos as (
    select familia_id, count(*)::int as n from public.hijos_familia group by familia_id
  ), historial as (
    select r.ninera_id, r.ninera_clave,
           count(*) filter (where r.tipo = 'sitting' and r.estado <> 'previsto' and r.con_familia)::int as veces_familia,
           count(*) filter (where r.tipo = 'sitting' and r.estado <> 'previsto')::int as total,
           count(*) filter (where r.tipo = 'traslado' and r.estado <> 'previsto' and r.con_familia)::int as veces_familia_traslado,
           count(*) filter (where r.tipo = 'traslado' and r.estado <> 'previsto')::int as total_traslado,
           count(*) filter (where r.tipo = 'sitting'
                              and r.fecha between date_trunc('week', p_fecha)::date and date_trunc('week', p_fecha)::date + 6)::int as semana,
           max(c.n) filter (where r.tipo = 'sitting' and r.estado <> 'previsto') as max_chicos
      from regs r left join chicos c on c.familia_id = r.familia_id
     group by r.ninera_id, r.ninera_clave
  ), historial_edades as (
    select e.ninera_id, e.ninera_clave, array_agg(distinct e.edad order by e.edad) filter (where e.edad between 0 and 18) as edades
      from edades e group by e.ninera_id, e.ninera_clave
  ), respuestas as (
    -- "No puedo" seguidos: los que respondió después de su último "Puedo". "Asignar" (y la etapa 6)
    -- pasan el "Puedo" a 'confirmada' y conserva respondido_en: también cuenta. Una asignada sin
    -- responder (confirmada sin respondido_en) no es un "Puedo".
    select sn.ninera_id,
           count(*) filter (where sn.estado = 'no_puedo'
             and sn.respondido_en > coalesce(ua.ultimo, '-infinity'::timestamptz))::int as no_puedo_seguidos
      from public.solicitud_ninieras sn
      left join (select x.ninera_id, max(x.respondido_en) as ultimo
                   from public.solicitud_ninieras x
                  where x.origen = 'app' and x.estado in ('acepto', 'confirmada') and x.respondido_en is not null
                  group by x.ninera_id) ua on ua.ninera_id = sn.ninera_id
     where sn.origen = 'app' and sn.ninera_id is not null
     group by sn.ninera_id
  )
  select jsonb_build_object(
    'historial', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ninera_id', h.ninera_id, 'ninera_clave', h.ninera_clave, 'veces_familia', h.veces_familia,
               'total', h.total, 'veces_familia_traslado', h.veces_familia_traslado, 'total_traslado', h.total_traslado,
               'semana', h.semana, 'edades', coalesce(to_jsonb(he.edades), '[]'::jsonb),
               'max_chicos', h.max_chicos))
        from historial h
        left join historial_edades he
          on he.ninera_id is not distinct from h.ninera_id and he.ninera_clave is not distinct from h.ninera_clave), '[]'::jsonb),
    'por_ninera', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ninera_id', n.id,
               'no_puedo_seguidos', coalesce(rp.no_puedo_seguidos, 0),
               'incidente_familia', exists (select 1 from public.incidentes i
                                             where (i.ninera_id = n.id
                                                    or (i.ninera_id is null and public.normaliza_nombre(btrim(i.ninera_nombre)) = public.normaliza_nombre(btrim(n.nombre))))
                                               and (i.familia_id = p_familia_id
                                                    or (i.familia_id is null and public.normaliza_nombre(btrim(i.familia_nombre)) = public.normaliza_nombre(btrim(p_familia_nombre))))),
               'no_disponible', exists (select 1 from public.ninera_no_disponible d where d.ninera_id = n.id and d.fecha = p_fecha)))
        from public.ninieras n
        left join respuestas rp on rp.ninera_id = n.id), '[]'::jsonb))
$function$;
revoke execute on function public.sugeridas_datos(uuid, text, date) from public, anon;
grant execute on function public.sugeridas_datos(uuid, text, date) to authenticated;

-- Vuelve a lo que devolvía antes (sin el RCP): hay que borrarla y crearla de nuevo.
drop function public.ninera_mi_perfil();
create or replace function public.ninera_mi_perfil()
returns table (id uuid, nombre text, telefono text, tipo text, zona text, barrios text,
               cuenta_bancaria text[], foto text, foto_propuesta_ruta text,
               foto_propuesta_en timestamp with time zone, perfil_app_en timestamp with time zone,
               perfil_actualizado_en timestamp with time zone, app_activada_en timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select n.id, n.nombre, n.telefono, n.tipo, n.zona, n.barrios, n.cuenta_bancaria, n.foto,
         n.foto_propuesta_ruta, n.foto_propuesta_en, n.perfil_app_en, n.perfil_actualizado_en,
         n.app_activada_en
    from public.ninieras n
   where n.id = (select public.ninera_actual())
$function$;
-- En Supabase anon tiene execute por defecto en public: se le saca a mano.
revoke execute on function public.ninera_mi_perfil() from public, anon;
grant execute on function public.ninera_mi_perfil() to authenticated;

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

-- ---- Lo nuevo ----
drop function if exists public.programar_avisos_guia(timestamp with time zone);
drop function if exists public.ninera_guardar_rcp(boolean, boolean);
drop function if exists public.ninera_firmar_guia(text, text);
drop function if exists public.ninera_aprobar_repaso(text, text);
drop function if exists public.ninera_marcar_leida(text, text);
drop function if exists public.ninera_estado_guia();
drop function if exists public.guia_estado_ninieras();
drop function if exists public.ninera_puede_recibir_pedidos(uuid);
drop function if exists public.guia_estado(uuid, timestamp with time zone);

drop policy if exists ninieras_privado_firma on storage.objects;
drop policy if exists ninieras_privado_rcp on storage.objects;

delete from public.app_config where id = 'guia';

drop table if exists public.guia_firmas;
drop table if exists public.guia_repasos;
drop table if exists public.guia_progreso;

alter table public.ninieras drop column if exists rcp_presencial, drop column if exists rcp_certificado_ruta;

commit;
