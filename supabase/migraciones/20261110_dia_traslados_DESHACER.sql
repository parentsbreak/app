-- Deshace 20261110_dia_traslados.sql: las funciones del día vuelven a como estaban (solo sittings: 20261106_el_dia y
-- programar_avisos_el_dia de 20261109_traslados_app), se saca ninera_cerrar_traslado, los tipos de evento nuevos y la
-- configuración nueva, y hora_fin vuelve a ser obligatoria.
--
-- Lo cargado no se pierde: antes de borrar, los eventos y los cierres de traslados se copian enteros a
-- respaldo_dia_traslados_20261110_eventos y _cierres (RLS sin políticas: solo se ven con la clave de servicio o
-- desde el SQL Editor). Un gasto de un cierre ya revisado ya está en gastos_extra y queda ahí.
begin;

do $$
begin
  if to_regclass('public.respaldo_dia_traslados_20261110_eventos') is null then
    create table public.respaldo_dia_traslados_20261110_eventos as
      select e.*, now() as respaldado_en from public.sitting_eventos e
       where e.sitting_id in (select s.id from public.sittings_traslados s where s.tipo = 'traslado')
          or e.tipo in ('busque', 'deje', 'no_estan');
    alter table public.respaldo_dia_traslados_20261110_eventos enable row level security;
    create table public.respaldo_dia_traslados_20261110_cierres as
      select c.*, now() as respaldado_en from public.sitting_cierres c
       where c.hora_fin is null or c.sitting_id in (select s.id from public.sittings_traslados s where s.tipo = 'traslado');
    alter table public.respaldo_dia_traslados_20261110_cierres enable row level security;
  end if;
end $$;

delete from public.sitting_eventos e
 where e.sitting_id in (select s.id from public.sittings_traslados s where s.tipo = 'traslado')
    or e.tipo in ('busque', 'deje', 'no_estan');
delete from public.sitting_cierres c
 where c.hora_fin is null or c.sitting_id in (select s.id from public.sittings_traslados s where s.tipo = 'traslado');

alter table public.sitting_eventos drop constraint sitting_eventos_tipo_check;
alter table public.sitting_eventos add constraint sitting_eventos_tipo_check
  check (tipo = any (array['saliendo', 'tarde', 'entre', 'no_abren', 'no_encuentro']));
alter table public.sitting_cierres drop constraint sitting_cierres_sin_hora_check;
alter table public.sitting_cierres alter column hora_fin set not null;

update public.app_config set valor = valor - 'no_salio_min' where id = 'el_dia';

drop function public.ninera_cerrar_traslado(uuid, text, numeric, text);

-- ---- El sitting del día de la niñera ----
-- Interna (sin execute para nadie): el sitting p_sitting_id si es de la niñera de la sesión, es un sitting
-- (no un traslado), no está cancelado, está confirmado y es de hoy o de ayer (uno que pasa la medianoche,
-- o que cerró tarde). Vacío si no.
create or replace function public.sitting_del_dia_ninera(p_sitting_id uuid)
returns setof public.sittings_traslados
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.* from public.sittings_traslados s
   where s.id = p_sitting_id
     and s.ninera_id = (select public.ninera_actual())
     and s.tipo = 'sitting' and not s.cancelado and s.estado = 'confirmado'
     and s.fecha between public.hoy_mvd() - 1 and public.hoy_mvd()
$function$;
revoke execute on function public.sitting_del_dia_ninera(uuid) from public, anon, authenticated;

drop function public.ninera_mi_dia();
-- Lo del día para la app de la niñera: sus sittings de hoy y los de ayer que no cerró ni revisó una admin,
-- con lo que ya marcó y si ya cerró. Sin plata ni dirección (están en ninera_mis_sittings). Vacío si no
-- es niñera.
create function public.ninera_mi_dia()
returns table (id uuid, fecha date, hora_inicio time without time zone, hora_fin time without time zone,
               termina_dia_siguiente boolean, es_fijo boolean, zona text, madre text, eventos jsonb,
               cerrado_en timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.id, s.fecha, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente, s.asignacion_id is not null,
         f.zona, public.madre_nombre_inicial(coalesce(f.nombre, s.familia_nombre)),
         coalesce((select jsonb_agg(jsonb_build_object('tipo', e.tipo, 'minutos', e.minutos, 'en', e.creado_en) order by e.creado_en, e.tipo)
                     from public.sitting_eventos e where e.sitting_id = s.id and e.ninera_id = s.ninera_id), '[]'::jsonb),
         c.creado_en
    from public.sittings_traslados s
    left join public.familias f on f.id = s.familia_id
    left join public.sitting_cierres c on c.sitting_id = s.id and c.ninera_id = s.ninera_id
   where s.ninera_id = (select public.ninera_actual())
     and s.tipo = 'sitting' and not s.cancelado and s.estado = 'confirmado'
     and (s.fecha = public.hoy_mvd()
          or (s.fecha = public.hoy_mvd() - 1 and c.sitting_id is null and s.revisado_at is null))
   order by s.fecha, s.hora_inicio
$function$;
revoke execute on function public.ninera_mi_dia() from public, anon;
grant execute on function public.ninera_mi_dia() to authenticated;

-- "Estoy saliendo", "Voy a llegar tarde" (con los minutos), "Ya entré", "Estoy afuera y no me abren",
-- "No encuentro la casa". Tarde y los dos problemas avisan al instante a las admins, con el link a la
-- tarjeta "Sitting en curso" de Hoy (allí está "Contactarla"). Un segundo toque devuelve la hora del
-- primero; cambiar los minutos de "tarde" avisa de nuevo con los minutos nuevos. Ya cerrado, no.
create or replace function public.ninera_marcar_evento(p_sitting_id uuid, p_tipo text, p_minutos integer default null)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_s public.sittings_traslados;
  v_nombre text;
  v_familia text;
  v_min integer := case when p_tipo = 'tarde' then p_minutos end;
  v_en timestamp with time zone;
  v_url text;
  v_datos jsonb;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_tipo is null or p_tipo not in ('saliendo', 'tarde', 'entre', 'no_abren', 'no_encuentro') then
    raise exception 'evento_invalido';
  end if;
  if p_tipo = 'tarde' and (p_minutos is null or p_minutos not in (10, 20, 30)) then
    raise exception 'minutos_invalidos';
  end if;
  select * into v_s from public.sitting_del_dia_ninera(p_sitting_id);
  if not found then raise exception 'no_existe'; end if;
  if exists (select 1 from public.sitting_cierres c where c.sitting_id = v_s.id) then raise exception 'ya_cerrado'; end if;

  insert into public.sitting_eventos (sitting_id, ninera_id, tipo, minutos)
  values (v_s.id, v_yo, p_tipo, v_min)
  on conflict (sitting_id, tipo) do update set minutos = excluded.minutos
    where public.sitting_eventos.minutos is distinct from excluded.minutos
  returning creado_en into v_en;
  if v_en is null then
    -- Mismo toque otra vez (o los mismos minutos): no cambia nada ni vuelve a avisar.
    select creado_en into v_en from public.sitting_eventos where sitting_id = v_s.id and tipo = p_tipo;
    return v_en;
  end if;

  select nombre into v_nombre from public.ninieras where id = v_yo;
  v_familia := coalesce((select f.nombre from public.familias f where f.id = v_s.familia_id), v_s.familia_nombre);
  v_url := '?ir=hoy&sitting=' || v_s.id;
  v_datos := jsonb_build_object('sitting_id', v_s.id, 'ninera_id', v_yo);
  if p_tipo = 'tarde' then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':tarde:' || v_min, null, 'todas', 'el_dia',
      v_nombre || ' va a llegar ' || case when v_min = 30 then '30 min o más' else v_min || ' min' end || ' tarde',
      'A lo de ' || v_familia || '.', v_url, v_datos);
  elsif p_tipo = 'no_abren' then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':no_abren', null, 'todas', 'el_dia',
      v_nombre || ' está afuera y no le abren', v_familia || '.', v_url, v_datos);
  elsif p_tipo = 'no_encuentro' then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':no_encuentro', null, 'todas', 'el_dia',
      v_nombre || ' no encuentra la casa', v_familia || '.', v_url, v_datos);
  end if;
  return v_en;
end
$function$;
revoke execute on function public.ninera_marcar_evento(uuid, text, integer) from public, anon;
grant execute on function public.ninera_marcar_evento(uuid, text, integer) to authenticated;

-- El cierre (decisiones 6.4): la hora real (con "al día siguiente" si pasó la medianoche), comentarios,
-- calificación, si volvería, a qué jugaron, comentarios para el equipo y, si hubo, el gasto (monto, en qué
-- y la foto ya subida a comprobantes/ninieras/<su id>/<sitting>.jpg: la ruta la arma la base). Una sola
-- vez: un segundo envío devuelve la hora del primero sin cambiar nada. No cierra uno que una admin ya
-- revisó en "Cierre de los fijos". Avisa a las admins que terminó y, si corresponde, del gasto y del
-- comentario.
create or replace function public.ninera_cerrar_sitting(p_sitting_id uuid, p_hora_fin time without time zone,
  p_dia_siguiente boolean, p_comentarios text, p_calificacion integer, p_volveria boolean, p_jugaron text,
  p_comentario_equipo text, p_gasto_monto numeric default null, p_gasto_concepto text default null)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_s public.sittings_traslados;
  v_dia boolean := coalesce(p_dia_siguiente, false);
  v_fin timestamp with time zone;
  v_comentarios text := nullif(btrim(coalesce(p_comentarios, '')), '');
  v_jugaron text := nullif(btrim(coalesce(p_jugaron, '')), '');
  v_equipo text := nullif(btrim(coalesce(p_comentario_equipo, '')), '');
  v_concepto text := nullif(btrim(regexp_replace(coalesce(p_gasto_concepto, ''), '\s+', ' ', 'g')), '');
  v_ruta text;
  v_nombre text;
  v_familia text;
  v_en timestamp with time zone;
  v_datos jsonb;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  select * into v_s from public.sitting_del_dia_ninera(p_sitting_id);
  if not found then raise exception 'no_existe'; end if;
  select creado_en into v_en from public.sitting_cierres where sitting_id = v_s.id;
  if found then return v_en; end if;
  if v_s.revisado_at is not null then raise exception 'ya_revisado'; end if;

  -- La hora: después del inicio el mismo día, o antes (o igual: 24 h) con "al día siguiente", como el
  -- registro del panel (cruceMedianocheMalMarcado). No más de 15 minutos en el futuro.
  if p_hora_fin is null then raise exception 'hora_invalida'; end if;
  if v_s.hora_inicio is not null
     and ((not v_dia and p_hora_fin <= v_s.hora_inicio) or (v_dia and p_hora_fin > v_s.hora_inicio)) then
    raise exception 'hora_invalida';
  end if;
  v_fin := ((v_s.fecha + case when v_dia then 1 else 0 end) + p_hora_fin) at time zone 'America/Montevideo';
  if v_fin > now() + interval '15 minutes' then raise exception 'hora_futura'; end if;

  if char_length(coalesce(v_comentarios, '')) > 2000 or char_length(coalesce(v_jugaron, '')) > 2000
     or char_length(coalesce(v_equipo, '')) > 2000 then
    raise exception 'texto_largo';
  end if;
  if p_calificacion is not null and p_calificacion not between 1 and 5 then raise exception 'calificacion_invalida'; end if;

  if p_gasto_monto is not null then
    if p_gasto_monto <= 0 or p_gasto_monto >= 100000 then raise exception 'gasto_invalido'; end if;
    if v_concepto is null or char_length(v_concepto) > 120 then raise exception 'gasto_sin_concepto'; end if;
    v_ruta := 'ninieras/' || v_yo || '/' || v_s.id || '.jpg';
    if not exists (select 1 from storage.objects o where o.bucket_id = 'comprobantes' and o.name = v_ruta) then
      raise exception 'falta_comprobante';
    end if;
  else
    v_concepto := null;
  end if;

  insert into public.sitting_cierres (sitting_id, ninera_id, hora_fin, termina_dia_siguiente, comentarios, calificacion,
                                      volveria, jugaron, comentario_equipo, gasto_monto, gasto_concepto, gasto_comprobante)
  values (v_s.id, v_yo, p_hora_fin, v_dia, v_comentarios, p_calificacion, p_volveria, v_jugaron, v_equipo,
          p_gasto_monto, v_concepto, v_ruta)
  returning creado_en into v_en;

  select nombre into v_nombre from public.ninieras where id = v_yo;
  v_familia := coalesce((select f.nombre from public.familias f where f.id = v_s.familia_id), v_s.familia_nombre);
  v_datos := jsonb_build_object('sitting_id', v_s.id, 'ninera_id', v_yo);
  perform public.encolar_aviso('admin:sitting:' || v_s.id || ':cerro', null, 'todas', 'cierres',
    v_nombre || ' terminó en ' || v_familia || ' a las ' || to_char(p_hora_fin, 'HH24:MI'), 'Revisá el registro.',
    '?ir=hoy', v_datos);
  if p_gasto_monto is not null then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':gasto', null, 'todas', 'cierres',
      v_nombre || ' cargó un gasto de ' || public.pesos_texto(p_gasto_monto), 'Con comprobante. Elegí quién lo paga.',
      '?ir=hoy', v_datos);
  end if;
  if v_comentarios is not null then
    perform public.encolar_aviso('admin:sitting:' || v_s.id || ':comentario', null, 'todas', 'cierres',
      v_nombre || ' dejó un comentario del sitting con ' || v_familia, 'Leelo ahora.', '?ir=hoy', v_datos);
  end if;
  return v_en;
end
$function$;
revoke execute on function public.ninera_cerrar_sitting(uuid, time without time zone, boolean, text, integer, boolean, text, text, numeric, text) from public, anon;
grant execute on function public.ninera_cerrar_sitting(uuid, time without time zone, boolean, text, integer, boolean, text, text, numeric, text) to authenticated;


-- ---- Avisos de tiempo del día (textos.md 1 y 7), dentro del cron de cada minuto ----
-- A la niñera (sittings con niñera con app, confirmados, sin revisar):
--   sitting:<id>:24h    de 24 a 23 h antes del inicio (no fijos);
--   sitting:<id>:1h     de 1 h a 30 min antes del inicio (no fijos);
--   sitting:<id>:fin    a la hora de fin prevista, hasta el recordatorio, si no cerró;
--   sitting:<id>:fin30  cierre_recordatorio_min después del fin, hasta 3 h después, si no cerró.
-- A las admins:
--   admin:sitting:<id>:no_llego  no_llego_min después del inicio sin "Ya entré" ni cierre, hasta 2 h
--   después (no fijos).
-- Sin hora de fin no hay avisos de fin: la niñera cierra desde la tarjeta del día. Las ventanas evitan
-- que un sitting asignado tarde (o el día que se publica esto) reciba avisos atrasados de golpe. Con
-- solo_practica prendido, solo sittings de práctica (pedido_puede_avisar). p_ahora es para las pruebas.
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
  v_traslado boolean;
  v_que text;
  r record;
begin
  for r in
    select s.id, s.tipo, s.fecha, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente, s.asignacion_id is not null as es_fijo,
           s.ninera_id, n.nombre as ninera, coalesce(f.nombre, s.familia_nombre) as familia, nullif(btrim(f.zona), '') as zona,
           exists (select 1 from public.sitting_eventos e where e.sitting_id = s.id and e.tipo = 'entre') as entro,
           exists (select 1 from public.sitting_cierres c where c.sitting_id = s.id) as cerro
      from public.sittings_traslados s
      join public.ninieras n on n.id = s.ninera_id
      left join public.familias f on f.id = s.familia_id
     where s.fecha between v_hoy - 1 and v_hoy + 1
       and s.tipo in ('sitting', 'traslado') and not s.cancelado and s.estado = 'confirmado' and s.revisado_at is null
       and s.hora_inicio is not null
       and n.activa and n.user_id is not null
       and public.pedido_puede_avisar(s.familia_id, s.familia_nombre, n.nombre)
  loop
    v_traslado := r.tipo = 'traslado';
    v_que := case when v_traslado then 'traslado' else 'sitting' end;
    v_inicio := (r.fecha + r.hora_inicio) at time zone 'America/Montevideo';
    v_fin := case when r.hora_fin is not null
                  then ((r.fecha + case when r.termina_dia_siguiente then 1 else 0 end) + r.hora_fin) at time zone 'America/Montevideo' end;
    v_lugar := case when v_traslado then '' else coalesce(', en ' || r.zona, '') end;
    if not r.es_fijo then
      if p_ahora >= v_inicio - interval '24 hours' and p_ahora < v_inicio - interval '23 hours'
         and public.encolar_aviso('sitting:' || r.id || ':24h', r.ninera_id, null, 'sitting', '¡Hola! Mañana tienes un ' || v_que,
               v_dias[extract(dow from r.fecha)::int + 1] || ' ' || to_char(r.fecha, 'DD/MM') || ' a las '
                 || to_char(r.hora_inicio, 'HH24:MI') || v_lugar || '.',
               '#inicio', jsonb_build_object('sitting_id', r.id)) then
        v_total := v_total + 1;
      end if;
      if p_ahora >= v_inicio - interval '1 hour' and p_ahora < v_inicio - interval '30 minutes'
         and public.encolar_aviso('sitting:' || r.id || ':1h', r.ninera_id, null, 'sitting', 'Tu ' || v_que || ' empieza en 1 hora',
               to_char(r.hora_inicio, 'HH24:MI') || v_lugar || '.', '#inicio', jsonb_build_object('sitting_id', r.id)) then
        v_total := v_total + 1;
      end if;
      if not v_traslado and not r.entro and not r.cerro
         and p_ahora >= v_inicio + make_interval(mins => v_no_llego) and p_ahora < v_inicio + interval '2 hours'
         and public.encolar_aviso('admin:sitting:' || r.id || ':no_llego', null, 'todas', 'el_dia',
               r.ninera || ' no marcó que llegó',
               'El sitting con ' || r.familia || ' empezaba a las ' || to_char(r.hora_inicio, 'HH24:MI') || '.',
               '?ir=hoy&sitting=' || r.id, jsonb_build_object('sitting_id', r.id, 'ninera_id', r.ninera_id)) then
        v_total := v_total + 1;
      end if;
    end if;
    if not v_traslado and v_fin is not null and not r.cerro then
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

commit;
