-- ============================================================================
-- Migración 27/10/2026 (fase 1, etapa 2): perfil de la niñera, foto propuesta y próximos sittings.
--
-- La niñera completa su perfil una sola vez desde su app (servicios, zonas, datos bancarios y,
-- si quiere, una foto) y ve en el inicio sus próximos sittings sin ningún monto. La foto que sube
-- NO reemplaza la del CV (la ven las madres): queda como "foto propuesta" en un bucket privado
-- propio y una admin la aprueba o la descarta desde la ficha (OK de Diego, 27/10/2026).
--
-- Suma:
--   - ninieras.perfil_app_en (cuándo completó el perfil por primera vez; la admin lo ve en la
--     ficha), ninieras.foto_propuesta_ruta y ninieras.foto_propuesta_en;
--   - el bucket privado ninieras-privado, con rutas por niñera (fotos/<ninera_id>/propuesta.jpg;
--     más adelante firmas/, rcp/ y carsitting/ con el mismo criterio): cada niñera solo su
--     carpeta (ninieras_privado_propio), las admins todo (ninieras_privado_admins);
--   - los ayudantes hoy_mvd(), madre_nombre_inicial() y chicos_texto();
--   - las funciones de la niñera: ninera_mi_perfil(), ninera_zonas_disponibles(),
--     ninera_guardar_perfil() y ninera_mis_sittings(). Son security definer y filtran por
--     ninera_actual(): las políticas de las tablas compartidas no cambian (docs/fase1,
--     decisiones 5.3) y la niñera recibe solo las columnas permitidas, nunca plata.
--
-- Compatible con la app publicada: columnas nuevas vacías, un bucket y dos políticas nuevas,
-- funciones nuevas. No modifica filas existentes: no hace falta respaldo. Se deshace con
-- 20261027_perfil_ninera_DESHACER.sql.
-- ============================================================================
begin;

-- Perfil completado desde la app (lo pone ninera_guardar_perfil la primera vez y no lo pisa) y
-- la foto que propuso la niñera, a la espera de que una admin la apruebe.
alter table public.ninieras add column perfil_app_en timestamp with time zone;
alter table public.ninieras add column foto_propuesta_ruta text;
alter table public.ninieras add column foto_propuesta_en timestamp with time zone;

-- Bucket privado de las niñeras: se abre con createSignedUrl, nunca con URL pública.
insert into storage.buckets (id, name, public) values ('ninieras-privado', 'ninieras-privado', false)
on conflict (id) do nothing;

-- Cada niñera, solo su carpeta: el segundo tramo de la ruta es su id (fotos/<ninera_id>/...).
-- "for all" porque la app sube con upsert (insert o update) a la misma ruta, así nunca quedan
-- fotos huérfanas. Una admin no pasa: ninera_actual() es null para ella.
create policy ninieras_privado_propio on storage.objects as permissive for all to authenticated
  using (((bucket_id = 'ninieras-privado'::text) AND ((storage.foldername(name))[2] = (( SELECT public.ninera_actual() AS ninera_actual))::text)))
  with check (((bucket_id = 'ninieras-privado'::text) AND ((storage.foldername(name))[2] = (( SELECT public.ninera_actual() AS ninera_actual))::text)));
-- Las admins ven, aprueban (copian) y borran todo, como en comprobantes.
create policy ninieras_privado_admins on storage.objects as permissive for all to public
  using (((bucket_id = 'ninieras-privado'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)))
  with check (((bucket_id = 'ninieras-privado'::text) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));

-- "Hoy" en Montevideo, como todayISO() en la app y generar_previstos_fijos: now() es UTC y de
-- 21:00 a 24:00 ya sería mañana.
create or replace function public.hoy_mvd()
returns date
language sql
stable
set search_path to ''
as $function$
  select (now() at time zone 'America/Montevideo')::date
$function$;

-- Cómo ve la niñera a la madre: nombre y la inicial del apellido, nunca el apellido completo
-- (docs/fase1, decisiones 5.3). "María Pérez" → "María P.", "Familia Pérez" → "Familia P.",
-- una sola palabra queda igual y sin nombre, "la familia".
create or replace function public.madre_nombre_inicial(p_nombre text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case when cardinality(p) = 0 then 'la familia'
              when cardinality(p) = 1 then p[1]
              else p[1] || ' ' || left(p[cardinality(p)], 1) || '.' end
    from (select array_remove(regexp_split_to_array(coalesce(p_nombre, ''), '\s+'), '') as p) x
$function$;

-- Los chicos de una familia en una línea: "2 chicos (3 y 5 años)". La edad es la misma regla que
-- edadHijo() en core.js: años cumplidos desde la fecha de nacimiento o, si no hay, la edad
-- declarada más los años que pasaron desde que se declaró. Un bebé es "menos de 1 año"; el que no
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
                        then h.edad_declarada + coalesce(extract(year from age(public.hoy_mvd(), h.edad_declarada_en))::int, 0)
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

-- El perfil de la niñera de la sesión (vacío si no es niñera). Es el único lugar, junto con la
-- ficha del panel, que devuelve sus datos bancarios. foto: la del CV, la que ven las madres.
create or replace function public.ninera_mi_perfil()
returns table (id uuid, nombre text, telefono text, tipo text, zona text, barrios text,
               cuenta_bancaria text[], foto text, foto_propuesta_ruta text,
               foto_propuesta_en timestamp with time zone, perfil_app_en timestamp with time zone,
               app_activada_en timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select n.id, n.nombre, n.telefono, n.tipo, n.zona, n.barrios, n.cuenta_bancaria, n.foto,
         n.foto_propuesta_ruta, n.foto_propuesta_en, n.perfil_app_en, n.app_activada_en
    from public.ninieras n
   where n.id = (select public.ninera_actual())
$function$;
-- En Supabase anon tiene execute por defecto en public: se le saca a mano.
revoke execute on function public.ninera_mi_perfil() from public, anon;
grant execute on function public.ninera_mi_perfil() to authenticated;

-- Las zonas para elegir en el perfil (las mismas de la ficha del panel), por orden. Vacío si la
-- sesión no es de una niñera: la tabla sigue cerrada para ella.
create or replace function public.ninera_zonas_disponibles()
returns table (id uuid, nombre text, orden integer, fuera_de_montevideo boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select z.id, z.nombre, z.orden, z.fuera_de_montevideo
    from public.zona_grupos z
   where (select public.ninera_actual()) is not null
   order by z.orden, z.nombre
$function$;
revoke execute on function public.ninera_zonas_disponibles() from public, anon;
grant execute on function public.ninera_zonas_disponibles() to authenticated;

-- Guarda el perfil de la niñera de la sesión. Valida todo antes de escribir (nada a medias):
-- tipo de la lista, al menos una zona y todas de zona_grupos (la app manda los nombres que le dio
-- ninera_zonas_disponibles), y la foto solo en su carpeta. La cuenta: una línea por renglón, sin
-- espacios de más ni renglones vacíos. perfil_app_en se pone una sola vez. Sin foto nueva, la
-- propuesta que haya queda como estaba.
create or replace function public.ninera_guardar_perfil(p_tipo text, p_zonas text[], p_cuenta text[], p_foto_ruta text default null)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_cuenta text[];
begin
  if v_id is null then
    raise exception 'no_autorizada';
  end if;
  if p_tipo is null or p_tipo not in ('Niñera', 'Traslados', 'Ambas') then
    raise exception 'tipo_invalido';
  end if;
  if coalesce(cardinality(p_zonas), 0) = 0 then
    raise exception 'sin_zonas';
  end if;
  if exists (select 1 from unnest(p_zonas) z
              where not exists (select 1 from public.zona_grupos g where g.nombre = z)) then
    raise exception 'zona_desconocida';
  end if;
  -- Solo en su carpeta, y sin "..": la ruta se guarda y la admin la abre después.
  if p_foto_ruta is not null
     and (not starts_with(p_foto_ruta, 'fotos/' || v_id::text || '/') or p_foto_ruta like '%..%') then
    raise exception 'foto_invalida';
  end if;

  select array_agg(btrim(l, E' \t\r\n') order by o) into v_cuenta
    from unnest(p_cuenta) with ordinality u(l, o)
   where btrim(l, E' \t\r\n') <> '';

  update public.ninieras n
     set tipo = p_tipo,
         zona = array_to_string(p_zonas, '/'),
         cuenta_bancaria = v_cuenta,
         perfil_app_en = coalesce(n.perfil_app_en, now()),
         foto_propuesta_ruta = coalesce(p_foto_ruta, n.foto_propuesta_ruta),
         foto_propuesta_en = case when p_foto_ruta is not null then now() else n.foto_propuesta_en end
   where n.id = v_id;
end
$function$;
revoke execute on function public.ninera_guardar_perfil(text, text[], text[], text) from public, anon;
grant execute on function public.ninera_guardar_perfil(text, text[], text[], text) to authenticated;

-- Los próximos sittings de la niñera de la sesión (de hoy a 60 días), sin cancelados. Nunca
-- montos, cobrado / pagado, notas internas ni precios (docs/fase1, decisiones 5.3). La dirección
-- (y el origen / destino de un traslado) solo cuando está confirmado: un previsto todavía puede
-- cambiar de niñera. notas_para_ninera queda vacía hasta la etapa 5 (la columna de solicitudes).
create or replace function public.ninera_mis_sittings()
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

commit;
