-- Deshace 20261111_guia_sitting.sql: ninera_mis_sittings vuelve a como quedó en 20261109_traslados_app (sin
-- edades_meses, edades_anios ni necesidades) y chicos_texto vuelve a contar los años por día (20261027_perfil_ninera).
-- No hay datos que respaldar: la migración no guarda nada.
begin;

-- Los chicos de una familia en una línea: "2 chicos (3 y 5 años)". La edad es la misma regla que
-- edadHijo() en core.js: años cumplidos desde la fecha de nacimiento o, si no hay, la edad
-- declarada más los años que pasaron desde que se declaró (nunca negativos: una fecha futura
-- suma 0, como anosCompletosDesde). Un bebé es "menos de 1 año"; el que no
-- tiene edad cuenta pero no va entre paréntesis. Sin hijos cargados, el texto viejo de
-- familias.ninos recortado a 80; sin nada, null.
-- Invoker a propósito: desde ninera_mis_sittings (security definer) corre como su dueña; llamada
-- directo por una niñera no ve hijos ni familias (RLS) y da null.
create or replace function public.chicos_texto(p_familia_id uuid)
returns text
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_n integer;
  v_edades integer[];
  v_partes text[];
  v_ninos text;
begin
  select count(*),
         array_agg(e.edad order by e.orden, e.created_at, e.id) filter (where e.edad is not null)
    into v_n, v_edades
    from (select h.orden, h.created_at, h.id,
                 case when h.fecha_nacimiento is not null
                        then extract(year from age(public.hoy_mvd(), h.fecha_nacimiento))::int
                      when h.edad_declarada is not null
                        then h.edad_declarada + greatest(0, coalesce(extract(year from age(public.hoy_mvd(), h.edad_declarada_en))::int, 0))
                 end as edad
            from public.hijos_familia h
           where h.familia_id = p_familia_id) e;

  if v_n = 0 then
    select nullif(left(btrim(f.ninos), 80), '') into v_ninos from public.familias f where f.id = p_familia_id;
    return v_ninos;
  end if;

  if v_edades is null then
    return v_n || case when v_n = 1 then ' chico' else ' chicos' end;
  end if;

  -- Con un bebé, cada edad lleva su unidad ("menos de 1 año y 3 años"); si no, la unidad va una
  -- sola vez al final ("3 y 5 años").
  if 0 = any (v_edades) then
    v_partes := array(select case when x = 0 then 'menos de 1 año' when x = 1 then '1 año' else x || ' años' end
                        from unnest(v_edades) with ordinality u(x, o) order by o);
  else
    v_partes := array(select x::text from unnest(v_edades) with ordinality u(x, o) order by o);
    v_partes[cardinality(v_partes)] := v_partes[cardinality(v_partes)]
      || case when cardinality(v_edades) = 1 and v_edades[1] = 1 then ' año' else ' años' end;
  end if;

  return v_n || case when v_n = 1 then ' chico (' else ' chicos (' end
    || case when cardinality(v_partes) = 1 then v_partes[1]
            else array_to_string(v_partes[1:cardinality(v_partes) - 1], ', ') || ' y ' || v_partes[cardinality(v_partes)] end
    || ')';
end
$function$;

drop function public.ninera_mis_sittings();
create function public.ninera_mis_sittings()
returns table (id uuid, tipo text, fecha date, hora_inicio time without time zone,
               hora_fin time without time zone, termina_dia_siguiente boolean, estado text,
               zona text, madre text, direccion text, origen text, destino text, chicos text,
               notas_para_ninera text, horario_aproximado boolean, precio_hora numeric, solicitud_id uuid,
               destino_zona text, precio_viaje numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.id, s.tipo, s.fecha, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente, s.estado,
         case when s.tipo = 'traslado' then coalesce(nullif(btrim(sol.zona), ''), f.zona) else f.zona end,
         public.madre_nombre_inicial(coalesce(f.nombre, s.familia_nombre)),
         case when s.estado = 'confirmado' then f.direccion end,
         case when s.estado = 'confirmado' then s.origen end,
         case when s.estado = 'confirmado' then s.destino end,
         public.chicos_texto(f.id),
         case when s.estado = 'confirmado' then nullif(btrim(sol.notas_para_ninera), '') end,
         coalesce(sol.horario_aproximado, false),
         sn.precio_hora,
         s.solicitud_id,
         case when s.tipo = 'traslado' then nullif(btrim(sol.destino_zona), '') end,
         case when s.tipo = 'traslado' then sn.precio_viaje end
    from public.sittings_traslados s
    left join public.familias f on f.id = s.familia_id
    left join public.solicitudes sol on sol.id = s.solicitud_id
    left join lateral (select x.precio_hora, x.precio_viaje from public.solicitud_ninieras x
                        where x.solicitud_id = s.solicitud_id and x.ninera_id = s.ninera_id and x.estado = 'confirmada'
                        order by x.created_at desc limit 1) sn on true
   where s.ninera_id = (select public.ninera_actual())
     and not s.cancelado
     and s.estado in ('previsto', 'confirmado')
     and s.fecha between public.hoy_mvd() and public.hoy_mvd() + 60
   order by s.fecha, s.hora_inicio
$function$;
revoke execute on function public.ninera_mis_sittings() from public, anon;
grant execute on function public.ninera_mis_sittings() to authenticated;

commit;
