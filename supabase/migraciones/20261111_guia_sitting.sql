-- ============================================================================
-- Migración 03/11/2026 (fase 1, etapa 12): la guía según el sitting (docs/fase1/etapa12-guia-sitting.md).
--
-- "Para este sitting" (app de niñeras) muestra las lecciones y los juegos de la edad de cada chico y lo de autismo,
-- TDAH o discapacidad si la ficha de la familia lo menciona en "salud". Para eso ninera_mis_sittings devuelve además
-- (se vuelve a crear: cambian las columnas que devuelve):
--   - edades_meses int[]: la edad en meses de cada chico con fecha de nacimiento, contada por MES CALENDARIO (mes del
--     sitting menos mes de nacimiento). Nunca la fecha: con meses por día, mirando sittings de días seguidos se
--     sabría el día del cumpleaños; así dos chicos nacidos el mismo mes dan siempre lo mismo y el valor cambia
--     recién el 1.º de cada mes. Una fecha de nacimiento posterior al mes del sitting (mal cargada) no va.
--   - edades_anios int[]: los chicos sin fecha con edad cargada a mano, en años al día del sitting (la regla de
--     chicos_texto: edad declarada + años cumplidos desde que se declaró; una fecha futura no resta).
--   - necesidades text[]: solo 'autismo', 'tdah' y 'discapacidad', en ese orden, por palabras clave en "salud" de
--     la ficha de la familia que la niñera ya puede leer (ninera_ficha_familia: la de este sitting, si no la última
--     de la familia). Sin ficha, con "salud" vacío o en un traslado: vacío.
-- Las tres van solo en sittings (en un traslado, vacías) y nunca son null.
-- Además chicos_texto (lo que la niñera ve en "Chicos", en sus sittings, pedidos y avisos) cuenta los años por mes
-- calendario y no por día: por día, junto con el mes de edades_meses, abriendo la app un mes se sabía el día del cumpleaños.
-- Puede decir la edad nueva hasta un mes antes. La edad declarada (sin fecha) queda igual.
--
-- Compatible con la app publicada: lee las columnas por nombre y las de más no la rompen. Sin datos que migrar.
-- Prueba: supabase/pruebas/fase1_guia_sitting.sql. Deshacer: 20261111_guia_sitting_DESHACER.sql.
-- ============================================================================
begin;

-- Los chicos de una familia en una línea: "2 chicos (3 y 5 años)". Con fecha de nacimiento, los años
-- por MES calendario (etapa 12, 03/11/2026): contados por día, abriendo la app cada día se veía el día
-- del cumpleaños, y con edades_meses (el mes) alcanzaba con un mes. Puede decir la edad nueva hasta
-- un mes antes del cumpleaños. Sin fecha, la edad
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
                        then div((extract(year from public.hoy_mvd())::int * 12 + extract(month from public.hoy_mvd())::int)
                               - (extract(year from h.fecha_nacimiento)::int * 12 + extract(month from h.fecha_nacimiento)::int), 12)::int
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

-- Los próximos sittings de la niñera de la sesión (de hoy a 60 días), sin cancelados. Nunca
-- montos, cobrado / pagado, notas internas ni precios (docs/fase1, decisiones 5.3). La dirección
-- (y el origen / destino de un traslado) solo cuando está confirmado: un previsto todavía puede
-- cambiar de niñera. notas_para_ninera (solo confirmado), horario_aproximado y precio_hora (lo ofrecido, nunca
-- un total) salen del pedido del que vino el registro (solicitud_id, etapa 6). Etapa 12: edades_meses (por mes
-- calendario, nunca la fecha de nacimiento), edades_anios (edad cargada a mano) y necesidades (autismo, tdah,
-- discapacidad) para "Para este sitting"; solo en sittings.
drop function public.ninera_mis_sittings();
create function public.ninera_mis_sittings()
returns table (id uuid, tipo text, fecha date, hora_inicio time without time zone,
               hora_fin time without time zone, termina_dia_siguiente boolean, estado text,
               zona text, madre text, direccion text, origen text, destino text, chicos text,
               notas_para_ninera text, horario_aproximado boolean, precio_hora numeric, solicitud_id uuid,
               destino_zona text, precio_viaje numeric, edades_meses integer[], edades_anios integer[],
               necesidades text[])
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
         case when s.tipo = 'traslado' then sn.precio_viaje end,
         coalesce((select array_agg(e.meses order by e.orden, e.created_at, e.id)
                     from (select h.orden, h.created_at, h.id,
                                  (extract(year from s.fecha)::int * 12 + extract(month from s.fecha)::int)
                                  - (extract(year from h.fecha_nacimiento)::int * 12 + extract(month from h.fecha_nacimiento)::int) as meses
                             from public.hijos_familia h
                            where s.tipo = 'sitting' and h.familia_id = f.id and h.fecha_nacimiento is not null) e
                    where e.meses >= 0), '{}'::integer[]),
         coalesce((select array_agg(h.edad_declarada + greatest(0, coalesce(extract(year from age(s.fecha, h.edad_declarada_en))::int, 0))
                                    order by h.orden, h.created_at, h.id)
                     from public.hijos_familia h
                    where s.tipo = 'sitting' and h.familia_id = f.id and h.fecha_nacimiento is null
                      and h.edad_declarada is not null), '{}'::integer[]),
         coalesce((select array_agg(n.necesidad order by n.orden)
                     from (values (1, 'autismo', 'autis|asperger|\mtea\M'),
                                  (2, 'tdah', 'tdah|hiperactiv|deficit de atencion'),
                                  (3, 'discapacidad', 'discapacid|sindrome de down|paralisis|silla de ruedas')) n(orden, necesidad, patron)
                    where s.tipo = 'sitting' and fic.salud ~ n.patron), '{}'::text[])
    from public.sittings_traslados s
    left join public.familias f on f.id = s.familia_id
    left join public.solicitudes sol on sol.id = s.solicitud_id
    left join lateral (select x.precio_hora, x.precio_viaje from public.solicitud_ninieras x
                        where x.solicitud_id = s.solicitud_id and x.ninera_id = s.ninera_id and x.estado = 'confirmada'
                        order by x.created_at desc limit 1) sn on true
    -- "salud" de la ficha que vería la niñera, en minúsculas y sin tildes (las palabras clave van así).
    left join lateral (select translate(lower(ff.datos ->> 'salud'), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuaeiouu') as salud
                         from public.fichas_familia ff
                        where ff.familia_id = s.familia_id
                        order by (ff.sitting_id is not distinct from s.id) desc, ff.actualizada_en desc
                        limit 1) fic on true
   where s.ninera_id = (select public.ninera_actual())
     and not s.cancelado
     and s.estado in ('previsto', 'confirmado')
     and s.fecha between public.hoy_mvd() and public.hoy_mvd() + 60
   order by s.fecha, s.hora_inicio
$function$;
revoke execute on function public.ninera_mis_sittings() from public, anon;
grant execute on function public.ninera_mis_sittings() to authenticated;

commit;
