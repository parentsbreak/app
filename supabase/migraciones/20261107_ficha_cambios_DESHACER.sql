-- Deshace 20261107_ficha_cambios.sql: se sacan los triggers de avisos de sittings_traslados, las funciones de la
-- ficha y de los cambios de horario, y las dos tablas, y vuelven generar_previstos_fijos y solicitudes_al_cancelar
-- como estaban (20261101_previstos_precio_ninera y 20261103_eleccion_pedidos).
--
-- Lo cargado no se pierde: antes de borrar, las fichas y los cambios de horario se copian a
-- respaldo_ficha_cambios_20261107_* (RLS sin políticas: solo se ven con la clave de servicio o desde el SQL
-- Editor). Los registros que se cancelaron al cancelar un pedido quedan cancelados (se reactivan desde la Agenda).
-- Los avisos de esta etapa que todavía no salieron se borran (abrirían una pantalla que ya no está).
begin;

do $$
begin
  if to_regclass('public.respaldo_ficha_cambios_20261107_fichas') is null and to_regclass('public.fichas_familia') is not null then
    create table public.respaldo_ficha_cambios_20261107_fichas as select f.*, now() as respaldado_en from public.fichas_familia f;
    alter table public.respaldo_ficha_cambios_20261107_fichas enable row level security;
  end if;
  if to_regclass('public.respaldo_ficha_cambios_20261107_cambios') is null and to_regclass('public.cambios_horario') is not null then
    create table public.respaldo_ficha_cambios_20261107_cambios as select c.*, now() as respaldado_en from public.cambios_horario c;
    alter table public.respaldo_ficha_cambios_20261107_cambios enable row level security;
  end if;
end $$;

delete from public.avisos
 where enviado_en is null
   and (clave ~ '^sitting:[0-9a-f-]{36}:(cancelado|sin:|nuevo:|cambio:)' or clave like 'fijo:%' or clave like 'admin:cambio:%');

drop trigger if exists sittings_avisos_insert on public.sittings_traslados;
drop trigger if exists sittings_avisos_update on public.sittings_traslados;
drop trigger if exists sittings_avisos_delete on public.sittings_traslados;

-- ---- Las funciones que cambiaron, como estaban ----
create or replace function public.generar_previstos_fijos(p_dias integer default 14)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  hoy date := (now() at time zone 'America/Montevideo')::date;
  n_confirmados integer;
  n_borrados integer;
  n_actualizados integer;
  n_creados integer;
begin
  -- Solo una admin o la tarea programada (26/10/2026). Desde las cuentas de niñeras, un JWT
  -- "authenticated" ya no es siempre de una admin, y esta función es security definer: sin esto,
  -- una niñera podría llamarla y escribir previstos en sittings_traslados. pg_cron (la corrida de
  -- las 03:00) y la clave de servicio no traen 'sub' (auth.uid() es null) y pasan; la sesión de
  -- una niñera sí lo trae y no está en usuarias_autorizadas.
  if (select auth.uid()) is not null and not coalesce((select public.es_usuaria_autorizada()), false) then
    raise exception 'no_autorizada';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 60 then
    raise exception 'p_dias tiene que estar entre 1 y 60 (vino %)', p_dias;
  end if;
  -- Dos corridas a la vez (la de las 03:00 y una de la app) se esperan una a la otra.
  perform pg_advisory_xact_lock(hashtext('generar_previstos_fijos'));

  update sittings_traslados set estado = 'confirmado' where estado = 'previsto' and fecha <= hoy;
  get diagnostics n_confirmados = row_count;

  -- Se puede llamar más de una vez en la misma transacción (por ejemplo desde _ACTIVAR).
  drop table if exists pg_temp._previstos_deseados;
  create temporary table _previstos_deseados on commit drop as
  with dias as (
    select a.*, f.nombre as fam_nombre, f.cobro_hora as fam_cobro_hora, f.pago_hora as fam_pago_hora,
           f.terminos_aceptados_el as fam_terminos, d::date as dia
      from asignaciones a
      join familias f on f.id = a.familia_id
     cross join generate_series(hoy + 1, hoy + p_dias, interval '1 day') d
     where jsonb_typeof(a.dias) = 'array'
       and a.dias ? (array['D','L','M','X','J','V','S'])[extract(dow from d)::integer + 1]
       and a.hora_inicio is not null
       and (a.vigente_desde is null or a.vigente_desde <= d::date)
       and (a.vigente_hasta is null or a.vigente_hasta >= d::date)
       and not exists (select 1 from asignaciones_pausas p where p.asignacion_id = a.id and d::date between p.desde and p.hasta)
  ), con_horas as (
    select dias.*,
           coalesce(dias.tipo, 'sitting') as tipo_fijo,
           (dias.hora_fin is not null and dias.hora_fin <= dias.hora_inicio) as cruza,
           case when dias.hora_fin is null then null
                else (extract(epoch from dias.hora_fin) - extract(epoch from dias.hora_inicio)) / 3600.0
                     + case when dias.hora_fin <= dias.hora_inicio then 24 else 0 end
           end as horas,
           -- Términos y condiciones (20/10/2026): desde el día que los aceptó, a la familia se
           -- le cobra con el fin redondeado (minutos_fin_cobro); a la niñera, la hora real.
           case when dias.hora_fin is null then null
                when dias.fam_terminos is null or dias.dia < dias.fam_terminos then null
                else greatest(public.minutos_fin_cobro(
                       (extract(epoch from dias.hora_fin) / 60)::integer
                       + case when dias.hora_fin <= dias.hora_inicio then 1440 else 0 end)
                     - (extract(epoch from dias.hora_inicio) / 60)::integer, 0) / 60.0
           end as horas_cobro
      from dias
  )
  -- Montos sin centavos (21/10/2026): el cobro con redondear_cobro y el pago con redondear_pago.
  , base as (
  select c.id as asignacion_id, c.dia as fecha, c.familia_id, c.fam_nombre as familia_nombre,
         c.ninera_id, c.ninera_nombre, c.tipo_fijo as tipo, c.hora_inicio, c.hora_fin,
         c.cruza as termina_dia_siguiente,
         (array['D','L','M','X','J','V','S'])[extract(dow from c.dia)::integer + 1] as dia_codigo,
         case when c.tipo_fijo = 'traslado' then coalesce(c.cobro_traslado, t.cobro_familia, 0)
              else public.redondear_cobro(coalesce(c.horas_cobro, c.horas, 0) * coalesce(c.fam_cobro_hora, 0)) end as cobro_base,
         case when c.tipo_fijo = 'traslado' then coalesce(c.pago_traslado, t.pago_ninera, 0)
              -- Pago por hora (01/11/2026, precio por niñera con cada familia): el precio del fijo si
              -- está cargado (más que 0: un 0 o un negativo es no cargado, como en la app), si no el de
              -- esa niñera con esa familia, si no la tarifa. Igual que precioHoraNinera() en
              -- js/core.js. c.pago_hora es asignaciones.pago_hora.
              else public.redondear_pago(coalesce(c.horas, 0) * coalesce(case when c.pago_hora > 0 then c.pago_hora end,
                     (select p.pago_hora from public.precios_ninera_familia p
                       where p.familia_id = c.familia_id and p.ninera_id = c.ninera_id),
                     c.fam_pago_hora, 0)) end as pago_base
    from con_horas c
    -- Un traslado no se cobra por hora: el precio cargado en el fijo o, si no tiene, el del
    -- último traslado de ese fijo o de esa familia (lo mismo que precarga la app).
    left join lateral (
      select s.cobro_familia, s.pago_ninera
        from sittings_traslados s
       where c.tipo_fijo = 'traslado' and (c.cobro_traslado is null or c.pago_traslado is null)
         and s.tipo = 'traslado' and not s.cancelado and s.estado = 'confirmado'
         and (s.asignacion_id = c.id or s.familia_id = c.familia_id)
       order by (s.asignacion_id = c.id) desc, s.fecha desc
       limit 1
    ) t on true
  )
  -- Variantes programadas (23/10/2026): las de ese fijo que rigen ese día ("desde el 1/11, los
  -- martes la vuelta la hace el padre"), en el orden en que se crearon. Quedan anotadas en
  -- precio_variantes (la base y cuáles se aplicaron) y el motivo, el de la primera.
  select b.asignacion_id, b.fecha, b.familia_id, b.familia_nombre, b.ninera_id, b.ninera_nombre, b.tipo,
         b.hora_inicio, b.hora_fin, b.termina_dia_siguiente,
         coalesce((public.precio_con_variantes(b.cobro_base, b.pago_base, v.aplicadas)->>'cobro')::numeric, b.cobro_base) as cobro_familia,
         coalesce((public.precio_con_variantes(b.cobro_base, b.pago_base, v.aplicadas)->>'pago')::numeric, b.pago_base) as pago_ninera,
         case when v.aplicadas is null then null
              else jsonb_build_object('base', jsonb_build_object('cobro', b.cobro_base, 'pago', b.pago_base), 'aplicadas', v.aplicadas) end as precio_variantes,
         v.motivo as precio_motivo
    from base b
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', vp.id, 'nombre', vp.nombre, 'motivo', vp.motivo, 'programada', true,
               'cobro', case when vp.cobro_modo is null then null else jsonb_build_object('modo', vp.cobro_modo, 'valor', vp.cobro_valor) end,
               'pago', case when vp.pago_modo is null then null else jsonb_build_object('modo', vp.pago_modo, 'valor', vp.pago_valor) end)
               order by vp.created_at, vp.id) as aplicadas,
             (array_agg(vp.motivo order by vp.created_at, vp.id))[1] as motivo
        from variantes_precio vp
       where vp.asignacion_id = b.asignacion_id and vp.activa
         and vp.auto_desde is not null and vp.auto_desde <= b.fecha
         and (vp.auto_hasta is null or vp.auto_hasta >= b.fecha)
         and (vp.auto_dias is null or vp.auto_dias ? b.dia_codigo)
         and vp.aplica_a in (b.tipo, 'ambos')
    ) v on true;

  delete from sittings_traslados s
   where s.generado_automatico and s.estado = 'previsto' and s.fecha > hoy
     and not exists (select 1 from _previstos_deseados d where d.asignacion_id = s.asignacion_id and d.fecha = s.fecha);
  get diagnostics n_borrados = row_count;

  update sittings_traslados s
     set ninera_id = d.ninera_id, ninera_nombre = d.ninera_nombre, familia_nombre = d.familia_nombre,
         tipo = d.tipo, hora_inicio = d.hora_inicio, hora_fin = d.hora_fin,
         termina_dia_siguiente = d.termina_dia_siguiente,
         cobro_familia = d.cobro_familia, pago_ninera = d.pago_ninera,
         precio_variantes = d.precio_variantes, precio_motivo = d.precio_motivo
    from _previstos_deseados d
   where s.generado_automatico and s.estado = 'previsto' and s.fecha > hoy
     and d.asignacion_id = s.asignacion_id and d.fecha = s.fecha
     and (s.ninera_id, s.ninera_nombre, s.familia_nombre, s.tipo, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente, s.cobro_familia, s.pago_ninera, s.precio_variantes, s.precio_motivo)
         is distinct from
         (d.ninera_id, d.ninera_nombre, d.familia_nombre, d.tipo, d.hora_inicio, d.hora_fin, d.termina_dia_siguiente, d.cobro_familia, d.pago_ninera, d.precio_variantes, d.precio_motivo);
  get diagnostics n_actualizados = row_count;

  insert into sittings_traslados (tipo, registrado_por, asignacion_id, familia_id, familia_nombre, ninera_id,
         ninera_nombre, fecha, hora_inicio, hora_fin, termina_dia_siguiente, cobro_familia, pago_ninera,
         precio_variantes, precio_motivo, cobrado, pagado, cancelado, estado, generado_automatico, notas)
  select d.tipo, 'Automático', d.asignacion_id, d.familia_id, d.familia_nombre, d.ninera_id,
         d.ninera_nombre, d.fecha, d.hora_inicio, d.hora_fin, d.termina_dia_siguiente, d.cobro_familia, d.pago_ninera,
         d.precio_variantes, d.precio_motivo, false, false, false, 'previsto', true,
         case when d.tipo = 'traslado' then 'Traslado fijo' else 'Sitting fijo' end || ' — cargado automáticamente'
    from _previstos_deseados d
   where not exists (select 1 from sittings_traslados s where s.asignacion_id = d.asignacion_id and s.fecha = d.fecha)
     and not exists (select 1 from sittings_traslados s
                      where s.asignacion_id is null and s.fecha = d.fecha and s.familia_id = d.familia_id
                        and lower(trim(s.ninera_nombre)) = lower(trim(d.ninera_nombre)));
  get diagnostics n_creados = row_count;

  return jsonb_build_object('confirmados', n_confirmados, 'borrados', n_borrados,
                            'actualizados', n_actualizados, 'creados', n_creados, 'hoy', hoy);
end;
$function$;
revoke execute on function public.generar_previstos_fijos(integer) from public, anon;
grant execute on function public.generar_previstos_fijos(integer) to authenticated;

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

-- ---- Lo nuevo, afuera ----
drop function if exists public.sittings_avisos_cambios();
drop function if exists public.avisar_cambios_previstos(date);
drop function if exists public.aviso_sitting_ninera(text, uuid, uuid, uuid, text, date, time without time zone, time without time zone, boolean, uuid, date);
drop function if exists public.horario_texto(time without time zone, time without time zone, boolean);
drop function if exists public.sitting_puede_avisar(uuid, uuid, text);
drop function if exists public.ninera_responder_cambio(uuid, boolean);
drop function if exists public.ninera_mis_cambios();
drop function if exists public.ninera_ficha_familia(uuid);
drop function if exists public.ninera_guardar_ficha_familia(uuid, jsonb);
drop function if exists public.ficha_familia_campos();
drop table if exists public.cambios_horario;
drop table if exists public.fichas_familia;

commit;
