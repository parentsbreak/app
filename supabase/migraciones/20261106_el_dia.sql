-- ============================================================================
-- Migración 02/11/2026 (fase 1, etapa 7): el día del sitting y el cierre de la niñera.
--
-- La niñera marca en su app cómo va el día ("Estoy saliendo", "Voy a llegar tarde", "Ya entré", "Estoy
-- afuera y no me abren", "No encuentro la casa") y al terminar cierra el sitting: hasta qué hora estuvo,
-- un gasto con la foto del comprobante, comentarios y cómo le fue con la familia (decisiones.md 6.4,
-- textos.md 1, 5 y 7). Las admins lo revisan en Hoy, en "Cierre de los fijos"; el registro final sigue
-- viviendo en sittings_traslados y lo escribe la admin al confirmar, como hoy.
--
-- Suma:
--   - sitting_eventos y sitting_cierres (la niñera lee lo suyo y escribe solo por sus funciones; las
--     admins leen todo y del cierre actualizan solo revisado_en, revisado_por y gasto_id);
--   - app_config 'el_dia': minutos del aviso "no marcó que llegó" y del recordatorio de cierre;
--   - storage: la niñera sube la foto del comprobante a comprobantes/ninieras/<su id>/<sitting>.jpg,
--     solo de un sitting suyo de hoy o de ayer sin cerrar (ninera_ruta_comprobante);
--   - funciones: ninera_mi_dia, ninera_marcar_evento, ninera_cerrar_sitting (niñera),
--     programar_avisos_el_dia (cron);
--   - cambia: sugeridas_datos devuelve prefiere_otros por niñera (la última calificación de esa niñera
--     con esa familia dijo "Prefiero otros perfiles") y programar_avisos llama a la regla nueva.
--
-- El gasto (Diego, 02/11/2026, reemplaza decisiones 4 "entra como gasto extra pagado por ella"): queda en
-- el cierre y recién pasa a gastos_extra (y a Por cobrar / Por pagar) cuando la admin elige quién lo
-- paga: nada sin revisar llega al cobro de la madre. Por eso no hay ninera_cargar_gasto: el gasto va
-- dentro de ninera_cerrar_sitting, en la misma transacción que el cierre (un solo envío, como la
-- pantalla).
--
-- Solo sittings (los traslados, en la etapa 10). Los fijos no reciben los avisos de 24 h y 1 h ni el de
-- "no marcó que llegó" (decisiones 4.10). Con app_config 'pedidos_app'.solo_practica prendido, los avisos
-- de tiempo van solo a la de práctica (pedido_puede_avisar); los que dispara la niñera con un toque
-- llegan siempre a las admins.
--
-- Compatible con la app publicada: tablas, funciones y una política nuevas; sugeridas_datos devuelve un
-- campo más (el panel de hoy no lo lee). No modifica datos: no hace falta respaldo. Se deshace con
-- 20261106_el_dia_DESHACER.sql.
-- ============================================================================
begin;

-- ---- Lo que marca la niñera durante el día ----
-- Una fila por tipo y por sitting: un segundo toque no suma otra. "Voy a llegar tarde" guarda los minutos
-- (10, 20 o 30, que es "30 min o más") y, si los cambia, se actualizan. creado_en es la hora real del
-- toque (la de "Ya entré" es la hora a la que entró).
create table public.sitting_eventos (
  id uuid default gen_random_uuid() not null,
  sitting_id uuid not null references public.sittings_traslados(id) on delete cascade,
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  tipo text not null,
  minutos integer,
  creado_en timestamp with time zone default now() not null,
  constraint sitting_eventos_pkey primary key (id),
  constraint sitting_eventos_un_tipo unique (sitting_id, tipo),
  constraint sitting_eventos_tipo_check check (tipo = any (array['saliendo', 'tarde', 'entre', 'no_abren', 'no_encuentro'])),
  constraint sitting_eventos_minutos_check check ((tipo = 'tarde') = (minutos is not null) and (minutos is null or minutos in (10, 20, 30)))
);

-- El cierre: uno por sitting y una sola vez (si se equivocó, avisa por el chat y la admin corrige con
-- "Otra hora"). volveria: true = "Sí", false = "Prefiero otros perfiles", null = no contestó. El gasto
-- queda acá hasta que la admin elige quién lo paga: ahí se crea el gasto extra y se anota gasto_id.
create table public.sitting_cierres (
  sitting_id uuid not null references public.sittings_traslados(id) on delete cascade,
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  hora_fin time without time zone not null,
  termina_dia_siguiente boolean default false not null,
  comentarios text,
  calificacion smallint,
  volveria boolean,
  jugaron text,
  comentario_equipo text,
  gasto_monto numeric,
  gasto_concepto text,
  gasto_comprobante text,
  gasto_id uuid references public.gastos_extra(id) on delete set null,
  creado_en timestamp with time zone default now() not null,
  revisado_en timestamp with time zone,
  revisado_por text,
  constraint sitting_cierres_pkey primary key (sitting_id),
  constraint sitting_cierres_calificacion_check check (calificacion between 1 and 5),
  constraint sitting_cierres_gasto_check check ((gasto_monto is null) = (gasto_comprobante is null)
    and (gasto_monto is null) = (gasto_concepto is null) and (gasto_monto is null or gasto_monto > 0)),
  constraint sitting_cierres_textos_check check (char_length(coalesce(comentarios, '')) <= 2000
    and char_length(coalesce(jugaron, '')) <= 2000 and char_length(coalesce(comentario_equipo, '')) <= 2000)
);
-- Lo que lee Hoy (los cierres sin revisar) y la ficha de la familia (lo último de cada sitting).
create index sitting_cierres_sin_revisar on public.sitting_cierres (creado_en) where revisado_en is null;
create index sitting_cierres_ninera on public.sitting_cierres (ninera_id, creado_en desc);

alter table public.sitting_eventos enable row level security;
alter table public.sitting_cierres enable row level security;
create policy sitting_eventos_propio on public.sitting_eventos as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy sitting_eventos_admins_leer on public.sitting_eventos as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
create policy sitting_cierres_propio on public.sitting_cierres as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy sitting_cierres_admins_leer on public.sitting_cierres as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
create policy sitting_cierres_admins_revisar on public.sitting_cierres as permissive for update to public
  using ((select public.es_usuaria_autorizada())) with check ((select public.es_usuaria_autorizada()));
-- Nadie escribe directo salvo la revisión de las admins (solo esas tres columnas).
revoke insert, update, delete on public.sitting_eventos, public.sitting_cierres from anon, authenticated;
grant update (revisado_en, revisado_por, gasto_id) on public.sitting_cierres to authenticated;

-- ---- Configuración (decisiones 7: sin pantalla para editarla en la fase 1) ----
insert into public.app_config (id, valor) values ('el_dia', jsonb_build_object('no_llego_min', 15, 'cierre_recordatorio_min', 30))
on conflict (id) do nothing;

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

-- Lo del día para la app de la niñera: sus sittings de hoy y los de ayer que no cerró ni revisó una admin,
-- con lo que ya marcó y si ya cerró. Sin plata ni dirección (están en ninera_mis_sittings). Vacío si no
-- es niñera.
create or replace function public.ninera_mi_dia()
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

-- ---- Storage: la foto del comprobante (decisiones 5.3) ----
-- Una sola ruta por sitting, comprobantes/ninieras/<su id>/<id del sitting>.jpg, y solo mientras el sitting
-- es suyo, de hoy o de ayer, y no lo cerró (después ya no la toca). La puede subir de nuevo hasta cerrar
-- (para reemplazar una foto mal sacada hace falta poder leerla y pisarla: "for all" sobre esa única ruta).
-- Otras rutas del bucket no las ve ni las lista. Las admins ya leen y borran todo el bucket.
-- Ayuda de la política (security definer: la niñera no lee sittings_traslados).
create or replace function public.ninera_ruta_comprobante(p_nombre text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_id uuid;
begin
  if v_yo is null or p_nombre is null
     or p_nombre !~ ('^ninieras/' || v_yo::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    return false;
  end if;
  v_id := substring(p_nombre from '([0-9a-f-]{36})\.jpg$')::uuid;
  return exists (select 1 from public.sitting_del_dia_ninera(v_id) s
                  where not exists (select 1 from public.sitting_cierres c where c.sitting_id = s.id));
end
$function$;
revoke execute on function public.ninera_ruta_comprobante(text) from public, anon;
grant execute on function public.ninera_ruta_comprobante(text) to authenticated;
-- (select ninera_actual()) se evalúa una vez por consulta: a una admin que lee el bucket no se le llama la
-- función por cada archivo.
create policy comprobantes_ninera_gasto on storage.objects as permissive for all to authenticated
  using ((bucket_id = 'comprobantes'::text) and ((select public.ninera_actual()) is not null) and public.ninera_ruta_comprobante(name))
  with check ((bucket_id = 'comprobantes'::text) and ((select public.ninera_actual()) is not null) and public.ninera_ruta_comprobante(name));

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

-- ---- Funciones que cambian ----
-- sugeridas_datos: igual que en 20261105_guia.sql más prefiere_otros (decisiones 4: "Prefiero otros
-- perfiles" baja a la niñera dentro de su bloque, no la saca). Cuenta la última calificación con
-- respuesta de esa niñera con esa familia (si después dijo "Sí", vuelve a su lugar).
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
  ), calificaciones as (
    -- La última respuesta a "¿Te gustaría volver a esa casa?" de cada niñera con esta familia (etapa 7).
    select distinct on (c.ninera_id) c.ninera_id, c.volveria
      from public.sitting_cierres c
      join public.sittings_traslados s on s.id = c.sitting_id
     where c.volveria is not null
       and (s.familia_id = p_familia_id
            or (s.familia_id is null and public.normaliza_nombre(btrim(s.familia_nombre)) = public.normaliza_nombre(btrim(p_familia_nombre))))
     order by c.ninera_id, c.creado_en desc
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
               'guia_puede', g.puede, 'guia_motivo', g.motivo, 'guia_hasta', g.hasta,
               'prefiere_otros', coalesce(not ca.volveria, false)))
        from public.ninieras n
        left join respuestas rp on rp.ninera_id = n.id
        left join calificaciones ca on ca.ninera_id = n.id
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
  v_total := v_total + public.programar_avisos_el_dia();     -- etapa 7
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos() from public, anon, authenticated;
grant execute on function public.programar_avisos() to service_role;

commit;
