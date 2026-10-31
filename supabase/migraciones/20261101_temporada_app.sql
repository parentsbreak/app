-- ============================================================================
-- Migración 01/11/2026 (fase 1, etapa 9): la temporada de verano desde la app de niñeras.
--
-- La niñera con app marca dónde va a estar cada quincena (Punta del Este, Montevideo, La Paloma,
-- Fuera del país u Otro) y la app se lo pide y se lo recuerda sola, sin que las admins tengan que
-- pedírselo (Diego, 31/10/2026; docs/fase1/etapa9-temporada.md). Las niñeras sin app siguen como
-- hoy, con la página de temporada y el aviso anual del panel.
--
-- Suma:
--   - ninieras.temporada_lugares (las 24 quincenas con su lugar) y ninieras.temporada_lugares_en
--     (cuándo la cargó ella en la app; una corrección de una admin no lo cambia);
--   - inicio_temporada_mvd(): el 1/9 a las 0:00 de Montevideo de la temporada en curso (de setiembre
--     a agosto), la misma regla que inicioTemporadaActual() del panel;
--   - ninera_mi_temporada() y ninera_guardar_temporada(p_lugares): security definer, solo la niñera
--     de la sesión (ninera_actual()). Guardar escribe además ninieras.temporada en el formato de
--     siempre ({<id del grupo Punta del Este>: [quincenas]}), así el filtro de Niñeras y el panel de
--     temporadas la siguen leyendo igual;
--   - programar_avisos_temporada(): del 1/10 al 31/12, de 9 a 21 de Montevideo, el aviso a cada
--     niñera activa con app que no cargó la temporada y un recordatorio cada 15 días desde su primer
--     aviso. programar_avisos() (el cron de cada minuto) la suma.
--
-- Compatible con la app publicada: dos columnas nuevas vacías y funciones nuevas; programar_avisos()
-- encola avisos de tipo 'temporada' con url #temporada (la app publicada los muestra en "Avisos" y,
-- al tocarlos, abre el inicio). No modifica filas existentes: no hace falta respaldo. Se deshace
-- con 20261101_temporada_app_DESHACER.sql.
-- ============================================================================
begin;

alter table public.ninieras add column temporada_lugares jsonb;
alter table public.ninieras add column temporada_lugares_en timestamp with time zone;

-- El inicio de la temporada en curso: el 1 de setiembre (0:00 de Montevideo) de este año si ya
-- llegó setiembre, si no el del año anterior. Lo cargado antes de esa fecha es de otra temporada.
create or replace function public.inicio_temporada_mvd(p_ahora timestamp with time zone default now())
returns timestamp with time zone
language sql
stable
set search_path to ''
as $function$
  select make_timestamp(
           case when extract(month from p_ahora at time zone 'America/Montevideo') >= 9
                then extract(year from p_ahora at time zone 'America/Montevideo')::int
                else extract(year from p_ahora at time zone 'America/Montevideo')::int - 1 end,
           9, 1, 0, 0, 0) at time zone 'America/Montevideo'
$function$;

-- Lo que la niñera de la sesión ve al abrir su temporada: {lugares, al_dia, solo_afuera}, o null si
-- la sesión no es de una niñera. al_dia: la cargó (ella, la página o una admin) en esta temporada.
-- lugares, solo si está al día: los que cargó en la app si siguen valiendo (de esta temporada y sin
-- una respuesta posterior de la página o del formulario), si no armados de temporada ("punta" o
-- "la_paloma" en sus quincenas, "montevideo" en el resto). Sin estar al día es null y la app arma la
-- precarga (diciembre a marzo vacías, Diego 31/10/2026). solo_afuera: todas sus zonas son de grupos
-- de afuera (vive en Punta). Nada de plata ni de otras niñeras.
create or replace function public.ninera_mi_temporada()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_inicio timestamp with time zone := public.inicio_temporada_mvd();
  n record;
  v_al_dia boolean;
  v_lugares jsonb;
  v_solo_afuera boolean;
begin
  if v_id is null then
    return null;
  end if;
  select ni.zona, ni.temporada, ni.temporada_actualizada_en, ni.temporada_fuente,
         ni.temporada_lugares, ni.temporada_lugares_en
    into n from public.ninieras ni where ni.id = v_id;

  v_al_dia := n.temporada_actualizada_en is not null and n.temporada_actualizada_en >= v_inicio;

  if v_al_dia then
    if n.temporada_lugares is not null and n.temporada_lugares_en >= v_inicio
       and n.temporada_fuente in ('app', 'sistema') then
      v_lugares := n.temporada_lugares;
    else
      select jsonb_object_agg(q::text,
               case when exists (select 1 from public.zona_grupos g
                                  where g.fuera_de_montevideo and lower(btrim(g.nombre)) = 'punta del este'
                                    and coalesce(n.temporada -> g.id::text, '[]'::jsonb) @> to_jsonb(q))
                      then 'punta'
                    when exists (select 1 from public.zona_grupos g
                                  where g.fuera_de_montevideo and lower(btrim(g.nombre)) = 'la paloma'
                                    and coalesce(n.temporada -> g.id::text, '[]'::jsonb) @> to_jsonb(q))
                      then 'la_paloma'
                    else 'montevideo' end)
        into v_lugares
        from generate_series(0, 23) q;
    end if;
  end if;

  -- Cada zona escrita en su ficha ("Punta del Este/La Barra") es el nombre o un barrio de un grupo de
  -- afuera, sin mayúsculas ni tildes.
  select count(*) > 0 and bool_and(exists (
           select 1 from public.zona_grupos g
            where g.fuera_de_montevideo
              and z.clave in (select translate(lower(btrim(x)), 'áéíóúüñ', 'aeiouun')
                                from unnest(array[g.nombre] || g.zonas) x)))
    into v_solo_afuera
    from (select translate(lower(btrim(s)), 'áéíóúüñ', 'aeiouun') as clave
            from regexp_split_to_table(coalesce(n.zona, ''), '[/,]') s
           where btrim(s) <> '') z;

  return jsonb_build_object('lugares', v_lugares, 'al_dia', v_al_dia, 'solo_afuera', coalesce(v_solo_afuera, false));
end
$function$;
revoke execute on function public.ninera_mi_temporada() from public, anon;
grant execute on function public.ninera_mi_temporada() to authenticated;

-- Guarda la temporada de la niñera de la sesión. p_lugares trae las 24 quincenas ("0" a "23") con
-- "montevideo", "punta", "la_paloma", "fuera_pais" o {"otro": "<texto de 1 a 80 caracteres>"}; si
-- falta una, sobra una o un valor no es de la lista, no guarda nada (temporada_invalida). Escribe
-- además temporada en el formato de siempre (el grupo de afuera Punta del Este con sus quincenas, y
-- La Paloma si un día existe ese grupo) y, si marcó un lugar cuyo grupo no está en su zona, se lo
-- agrega (como zonaConTemporada del panel y la página): si no, no aparecería al buscar esa zona.
-- Guardar sin cambios también cuenta: es su confirmación de esta temporada. No toca el comentario
-- ni el link de la página.
create or replace function public.ninera_guardar_temporada(p_lugares jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_lugares jsonb;
  v_temporada jsonb := '{}'::jsonb;
  v_zona text;
  g record;
  v_qs jsonb;
begin
  if v_id is null then
    raise exception 'no_autorizada';
  end if;
  if p_lugares is null or jsonb_typeof(p_lugares) <> 'object'
     or (select count(*) from jsonb_object_keys(p_lugares)) <> 24
     or exists (select 1 from jsonb_object_keys(p_lugares) k
                 where k not in (select q::text from generate_series(0, 23) q))
     or exists (select 1 from jsonb_each(p_lugares) e
                 where not (
                   (jsonb_typeof(e.value) = 'string'
                     and e.value #>> '{}' in ('montevideo', 'punta', 'la_paloma', 'fuera_pais'))
                   or (jsonb_typeof(e.value) = 'object'
                     and (select count(*) from jsonb_object_keys(e.value)) = 1
                     and jsonb_typeof(e.value -> 'otro') = 'string'
                     and char_length(btrim(e.value ->> 'otro')) between 1 and 80))) then
    raise exception 'temporada_invalida';
  end if;

  -- Lo de "Otro" se guarda sin espacios de más.
  select jsonb_object_agg(e.key,
           case when jsonb_typeof(e.value) = 'object'
                then jsonb_build_object('otro', btrim(e.value ->> 'otro')) else e.value end)
    into v_lugares
    from jsonb_each(p_lugares) e;

  -- Sin el grupo Punta del Este no hay dónde dejar sus quincenas en Punta: el filtro no la vería.
  if exists (select 1 from jsonb_each(v_lugares) e where e.value = '"punta"')
     and not exists (select 1 from public.zona_grupos z
                      where z.fuera_de_montevideo and lower(btrim(z.nombre)) = 'punta del este') then
    raise exception 'sin_grupo_punta';
  end if;

  select zona into v_zona from public.ninieras where id = v_id;

  -- Un solo grupo por lugar (el primero por orden), por si un día hay dos con el mismo nombre.
  for g in select distinct on (lower(btrim(z.nombre))) z.id, z.nombre, z.zonas,
                  case lower(btrim(z.nombre)) when 'punta del este' then 'punta' else 'la_paloma' end as lugar
             from public.zona_grupos z
            where z.fuera_de_montevideo and lower(btrim(z.nombre)) in ('punta del este', 'la paloma')
            order by lower(btrim(z.nombre)), z.orden, z.id loop
    select coalesce(jsonb_agg(q order by q), '[]'::jsonb) into v_qs
      from generate_series(0, 23) q
     where v_lugares -> q::text = to_jsonb(g.lugar);
    v_temporada := v_temporada || jsonb_build_object(g.id::text, v_qs);
    if jsonb_array_length(v_qs) > 0 and not exists (
         select 1 from regexp_split_to_table(coalesce(v_zona, ''), '[/,]') s
          where translate(lower(btrim(s)), 'áéíóúüñ', 'aeiouun') in
                (select translate(lower(btrim(x)), 'áéíóúüñ', 'aeiouun') from unnest(array[g.nombre] || g.zonas) x)) then
      v_zona := concat_ws('/', nullif(btrim(v_zona), ''), g.nombre);
    end if;
  end loop;

  update public.ninieras
     set temporada_lugares = v_lugares,
         temporada_lugares_en = now(),
         temporada = v_temporada,
         zona = v_zona,
         temporada_actualizada_en = now(),
         temporada_fuente = 'app',
         temporada_propuesta = null,
         temporada_propuesta_en = null
   where id = v_id;
end
$function$;
revoke execute on function public.ninera_guardar_temporada(jsonb) from public, anon;
grant execute on function public.ninera_guardar_temporada(jsonb) to authenticated;

-- Regla de avisos de la temporada (decisiones 6.6; Diego, 31/10/2026). Del 1/10 al 31/12, solo de
-- 9:00 a 21:00 de Montevideo, a cada niñera activa con app que no cargó la temporada de este año:
-- el primer aviso (clave temporada:<año>:<id>) y, cada 15 días contados desde ESE aviso, un
-- recordatorio (temporada:<año>:<id>:q<n>). Contar desde su primer aviso y no desde el 1/10 hace que
-- la que entra a la app en noviembre (o el día que se publica esto) reciba uno y no varios
-- atrasados de golpe. Si la carga (desde la app, la página o una admin), no se encola nada más.
-- Una sola consulta por corrida y, fuera de esas fechas y horas, ninguna. p_ahora es para las
-- pruebas; el cron la llama sin nada.
create or replace function public.programar_avisos_temporada(p_ahora timestamp with time zone default now())
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_local timestamp := p_ahora at time zone 'America/Montevideo';
  v_anio integer := extract(year from v_local)::int;
  v_inicio timestamp with time zone := public.inicio_temporada_mvd(p_ahora);
  v_n integer;
begin
  if extract(month from v_local) not between 10 and 12
     or extract(hour from v_local) not between 9 and 20 then
    return 0;
  end if;

  with pendientes as (
    select n.id, a.creado_en as primero_en
      from public.ninieras n
      left join public.avisos a on a.clave = 'temporada:' || v_anio || ':' || n.id
     where n.activa and n.user_id is not null
       and (n.temporada_actualizada_en is null or n.temporada_actualizada_en < v_inicio)
  ), tocan as (
    select p.id, 'temporada:' || v_anio || ':' || p.id as clave,
           '¿Vas a estar en Punta del Este esta temporada?' as titulo,
           'Marca dónde vas a estar cada quincena.' as cuerpo
      from pendientes p where p.primero_en is null
    union all
    select p.id, 'temporada:' || v_anio || ':' || p.id || ':q'
                 || floor(extract(epoch from p_ahora - p.primero_en) / (15 * 86400))::int,
           'Todavía no marcaste tu ubicación en la temporada',
           'Te lleva un minuto.'
      from pendientes p where p.primero_en <= p_ahora - interval '15 days'
  )
  select count(*) filter (where public.encolar_aviso(t.clave, t.id, null, 'temporada', t.titulo, t.cuerpo, '#temporada'))
    into v_n
    from tocan t
   where not exists (select 1 from public.avisos a where a.clave = t.clave);
  return v_n;
end
$function$;
revoke execute on function public.programar_avisos_temporada(timestamp with time zone) from public, anon, authenticated;

-- Las reglas de tiempo de los avisos (decisiones 5.4 y 7). La corre el cron cada minuto, antes de
-- llamar a enviar-avisos. Cada regla es una función programar_avisos_<regla>() que encola con
-- encolar_aviso (idempotente por clave, recalculada del estado actual: si el sitting se canceló o
-- cambió de hora antes de que toque, no se manda) y devuelve cuántos encoló; acá se suman. Las
-- etapas siguientes agregan las suyas, por ejemplo:
--   v_total := v_total + public.programar_avisos_pedidos();    -- etapa 6
--   v_total := v_total + public.programar_avisos_el_dia();     -- etapa 7
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

commit;
