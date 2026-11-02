-- Deshace 20261106_el_dia.sql: se sacan las funciones del día y del cierre, la política del comprobante,
-- la configuración 'el_dia' y las tablas, y vuelven sugeridas_datos y programar_avisos como estaban
-- (20261105_guia).
--
-- Lo cargado no se pierde: antes de borrar, los eventos y los cierres se copian a
-- respaldo_el_dia_20261106_* (RLS sin políticas: solo se ven con la clave de servicio o desde el SQL
-- Editor). Las fotos de los comprobantes quedan en el bucket comprobantes (las admins las siguen viendo y
-- borrando); un gasto que la admin ya pasó a gastos_extra queda ahí. Los avisos del día que todavía no
-- salieron se borran (abrirían una pantalla que ya no está).
begin;

do $$
begin
  if to_regclass('public.respaldo_el_dia_20261106_eventos') is null and to_regclass('public.sitting_eventos') is not null then
    create table public.respaldo_el_dia_20261106_eventos as select e.*, now() as respaldado_en from public.sitting_eventos e;
    alter table public.respaldo_el_dia_20261106_eventos enable row level security;
  end if;
  if to_regclass('public.respaldo_el_dia_20261106_cierres') is null and to_regclass('public.sitting_cierres') is not null then
    create table public.respaldo_el_dia_20261106_cierres as select c.*, now() as respaldado_en from public.sitting_cierres c;
    alter table public.respaldo_el_dia_20261106_cierres enable row level security;
  end if;
end $$;

-- Solo los de esta etapa: los de la niñera por la clave (la etapa 8 usa el mismo tipo 'sitting').
delete from public.avisos
 where enviado_en is null
   and (tipo in ('el_dia', 'cierres') or (tipo = 'sitting' and clave ~ '^sitting:[0-9a-f-]{36}:(24h|1h|fin|fin30)$'));

-- ---- Las funciones que cambiaron, como estaban ----
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
               'no_disponible', exists (select 1 from public.ninera_no_disponible d where d.ninera_id = n.id and d.fecha = p_fecha),
               -- La guía (etapa 4): solo de las que tienen app (las demás no reciben por la app).
               'guia_puede', g.puede, 'guia_motivo', g.motivo, 'guia_hasta', g.hasta))
        from public.ninieras n
        left join respuestas rp on rp.ninera_id = n.id
        left join lateral (select * from public.ninera_puede_recibir_pedidos(n.id) where n.user_id is not null) g on true), '[]'::jsonb))
$function$;
revoke execute on function public.sugeridas_datos(uuid, text, date) from public, anon;
grant execute on function public.sugeridas_datos(uuid, text, date) to authenticated;

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
  v_total := v_total + public.programar_avisos_guia();       -- etapa 4
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos() from public, anon, authenticated;
grant execute on function public.programar_avisos() to service_role;

-- ---- Lo nuevo, afuera ----
drop policy if exists comprobantes_ninera_gasto on storage.objects;
drop function if exists public.programar_avisos_el_dia(timestamp with time zone);
drop function if exists public.ninera_ruta_comprobante(text);
drop function if exists public.ninera_cerrar_sitting(uuid, time without time zone, boolean, text, integer, boolean, text, text, numeric, text);
drop function if exists public.ninera_marcar_evento(uuid, text, integer);
drop function if exists public.ninera_mi_dia();
drop function if exists public.sitting_del_dia_ninera(uuid);
delete from public.app_config where id = 'el_dia';
drop table if exists public.sitting_cierres;
drop table if exists public.sitting_eventos;

commit;
