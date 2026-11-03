-- ============================================================================
-- Migración 02/11/2026 (fase 1, etapa 10): el carsitting dentro de la app de niñeras (decisiones.md 6.7).
--
-- La niñera que hace traslados carga una sola vez los datos del auto y de su licencia, con 7 fotos (licencia y
-- libreta de propiedad de frente y de dorso, los asientos de atrás y el auto por dentro y por fuera), y una admin
-- lo revisa desde Hoy: "Aprobar" o "Pedir de nuevo" con un comentario, que le llega por el chat. Si cambia de auto
-- o se le vence la licencia, lo actualiza desde "Mi perfil": vuelve a revisión y mientras tanto sigue aprobada
-- con lo anterior (Diego, 02/11/2026). Reemplaza al formulario de Google "Carsitters datos", que sigue vivo para
-- las niñeras sin app hasta que todas la tengan (la Edge Function carsitting-webhook no se toca).
--
-- Suma:
--   - columnas en carsitting_datos: fotos (las rutas de las 7), enviado_en, revision ('pendiente' | 'aprobado' |
--     'rehacer'), revisado_en, revisado_por, comentario, aprobado_en, aprobado_por, aprobado_datos (lo que se
--     aprobó, para seguir aprobada mientras se revisa lo nuevo). Una fila por niñera desde la app (enviado_en no
--     nulo); las del formulario quedan como están;
--   - funciones de la niñera: ninera_mi_carsitting y ninera_guardar_carsitting (y el aviso a las admins);
--   - la política de su carpeta en ninieras-privado: carsitting/<su id>/<foto>_<8 hex>.jpg;
--   - el trigger de la revisión (carsitting_al_revisar): al aprobar, "Tu carsitting quedó aprobado"; al pedir de
--     nuevo, el comentario por el chat;
--   - la regla de avisos programar_avisos_carsitting (completar y el recordatorio de los lunes a las 10), dentro de
--     programar_avisos.
-- Las admins revisan escribiendo directo (la RLS de siempre, es_usuaria_autorizada), con la condición de la
-- revisión que tenía al abrir. Con app_config 'pedidos_app'.solo_practica prendido, los avisos a niñeras van solo a
-- las de práctica, como los de pedidos. Solo traslados: los sittings no cambian. Los pedidos de traslado por la app
-- (y el freno sin carsitting aprobado) son la etapa 11.
--
-- Compatible con la app publicada: columnas y funciones nuevas; programar_avisos hace lo mismo más la regla nueva.
-- No modifica datos: no hace falta respaldo. Se deshace con 20261108_carsitting_app_DESHACER.sql.
-- ============================================================================
begin;

alter table public.carsitting_datos
  add column fotos jsonb,
  add column enviado_en timestamp with time zone,
  add column revision text,
  add column revisado_en timestamp with time zone,
  add column revisado_por text,
  add column comentario text,
  add column aprobado_en timestamp with time zone,
  add column aprobado_por text,
  add column aprobado_datos jsonb,
  add constraint carsitting_datos_revision_check check (revision is null or revision in ('pendiente', 'aprobado', 'rehacer')),
  add constraint carsitting_datos_comentario_check check (comentario is null or char_length(comentario) <= 500);
-- Una fila por niñera desde la app (las del formulario no tienen enviado_en y pueden repetirse).
create unique index carsitting_datos_app_ninera on public.carsitting_datos (ninera_id) where enviado_en is not null;

-- Los campos del formulario "Carsitters datos" (los textos de la app en ninera/js/carsitting.js): todos obligatorios
-- salvo el número de la libreta.
create or replace function public.carsitting_campos()
returns table (clave text, obligatorio boolean)
language sql
immutable
set search_path to ''
as $function$
  select * from (values
    ('nombre_completo', true), ('cedula', true), ('numero_licencia', true), ('anio_licencia', true),
    ('modelo_auto', true), ('anio_fabricacion', true), ('color_auto', true), ('matricula', true), ('padron', true),
    ('libreta_propiedad', false), ('compania_seguro', true), ('tipo_seguro', true), ('cantidad_asientos', true),
    ('cantidad_cinturones', true)) as c(clave, obligatorio)
$function$;
revoke execute on function public.carsitting_campos() from public, anon, authenticated;

-- Las 7 fotos, todas obligatorias (Diego, 02/11/2026: frente y dorso por separado, reemplaza a las 5 de 6.7).
create or replace function public.carsitting_fotos()
returns setof text
language sql
immutable
set search_path to ''
as $function$
  select unnest(array['licencia_frente', 'licencia_dorso', 'libreta_frente', 'libreta_dorso', 'asientos', 'auto_dentro', 'auto_fuera'])
$function$;
revoke execute on function public.carsitting_fotos() from public, anon, authenticated;

-- Con solo_practica prendido, los avisos a niñeras solo a las de práctica (la regla de pedido_puede_avisar sin familia).
create or replace function public.carsitting_puede_avisar(p_ninera_nombre text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select not coalesce((select (valor->>'solo_practica')::boolean from public.app_config where id = 'pedidos_app'), true)
      or position('(practica)' in public.normaliza_nombre(p_ninera_nombre)) > 0
$function$;
revoke execute on function public.carsitting_puede_avisar(text) from public, anon, authenticated;

-- Lo suyo, para la pantalla y la tarjeta del inicio: si hace traslados, lo que cargó (los textos y las rutas de sus
-- fotos, que solo ella y las admins pueden abrir) y cómo está la revisión. null si no es niñera.
create or replace function public.ninera_mi_carsitting()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
           'hace_traslados', n.tipo in ('Traslados', 'Ambas'),
           'datos', case when c.id is null then null else
             (select jsonb_object_agg(k.clave, to_jsonb(c) -> k.clave) from public.carsitting_campos() k) end,
           'fotos', c.fotos,
           'revision', c.revision,
           'comentario', case when c.revision = 'rehacer' then c.comentario end,
           'enviado_en', c.enviado_en,
           'aprobado_en', c.aprobado_en)
    from public.ninieras n
    left join public.carsitting_datos c on c.ninera_id = n.id and c.enviado_en is not null
   where n.id = (select public.ninera_actual())
$function$;
revoke execute on function public.ninera_mi_carsitting() from public, anon;
grant execute on function public.ninera_mi_carsitting() to authenticated;

-- Enviar (o actualizar) los datos. p_datos: los campos (texto, hasta 120 caracteres; los vacíos no cuentan);
-- p_fotos: {clave: ruta} de las fotos nuevas, ya subidas a su carpeta; las que no manda quedan las que tenía. Al
-- final tienen que estar todos los obligatorios y las 7 fotos. Queda 'pendiente' (si estaba aprobada, sigue
-- aprobada con lo anterior: aprobado_en no se toca) y les avisa a las admins. Errores: no_autorizada,
-- no_hace_traslados, datos_invalidos, dato_largo, faltan_datos (hint: la clave), foto_invalida (hint: la clave),
-- faltan_fotos (hint: la clave).
create or replace function public.ninera_guardar_carsitting(p_datos jsonb, p_fotos jsonb default '{}'::jsonb)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_n public.ninieras;
  v_antes public.carsitting_datos;
  v_fila jsonb := '{}'::jsonb;
  v_fotos jsonb;
  v_c record;
  v_valor text;
  v_clave text;
  v_ruta text;
  v_en timestamp with time zone := now();
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  select * into v_n from public.ninieras where id = v_yo;
  if v_n.tipo is distinct from 'Traslados' and v_n.tipo is distinct from 'Ambas' then raise exception 'no_hace_traslados'; end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object'
     or exists (select 1 from jsonb_each(p_datos) e
                 where e.key not in (select clave from public.carsitting_campos()) or jsonb_typeof(e.value) not in ('string', 'null')) then
    raise exception 'datos_invalidos';
  end if;
  for v_c in select * from public.carsitting_campos() loop
    v_valor := nullif(btrim(p_datos ->> v_c.clave), '');
    if char_length(v_valor) > 120 then raise exception 'dato_largo' using hint = v_c.clave; end if;
    if v_c.obligatorio and v_valor is null then raise exception 'faltan_datos' using hint = v_c.clave; end if;
    v_fila := v_fila || jsonb_build_object(v_c.clave, v_valor);
  end loop;
  select * into v_antes from public.carsitting_datos where ninera_id = v_yo and enviado_en is not null for update;
  v_fotos := coalesce(v_antes.fotos, '{}'::jsonb);
  if p_fotos is null then p_fotos := '{}'::jsonb; end if;
  if jsonb_typeof(p_fotos) <> 'object' then raise exception 'foto_invalida'; end if;
  for v_clave, v_ruta in select e.key, e.value #>> '{}' from jsonb_each(p_fotos) e loop
    if v_clave not in (select public.carsitting_fotos())
       or v_ruta is null or v_ruta !~ ('^carsitting/' || v_yo::text || '/' || v_clave || '_[0-9a-f]{8}\.jpg$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'ninieras-privado' and o.name = v_ruta) then
      raise exception 'foto_invalida' using hint = coalesce(v_clave, '');
    end if;
    v_fotos := v_fotos || jsonb_build_object(v_clave, v_ruta);
  end loop;
  for v_clave in select public.carsitting_fotos() loop
    if not (v_fotos ? v_clave) then raise exception 'faltan_fotos' using hint = v_clave; end if;
  end loop;

  insert into public.carsitting_datos (ninera_id, ninera_nombre, nombre_completo, cedula, numero_licencia, anio_licencia,
    modelo_auto, anio_fabricacion, color_auto, matricula, padron, libreta_propiedad, compania_seguro, tipo_seguro,
    cantidad_asientos, cantidad_cinturones, fotos, enviado_en, revision)
  values (v_yo, v_n.nombre, v_fila->>'nombre_completo', v_fila->>'cedula', v_fila->>'numero_licencia', v_fila->>'anio_licencia',
    v_fila->>'modelo_auto', v_fila->>'anio_fabricacion', v_fila->>'color_auto', v_fila->>'matricula', v_fila->>'padron',
    v_fila->>'libreta_propiedad', v_fila->>'compania_seguro', v_fila->>'tipo_seguro', v_fila->>'cantidad_asientos',
    v_fila->>'cantidad_cinturones', v_fotos, v_en, 'pendiente')
  on conflict (ninera_id) where enviado_en is not null do update set
    ninera_nombre = excluded.ninera_nombre, nombre_completo = excluded.nombre_completo, cedula = excluded.cedula,
    numero_licencia = excluded.numero_licencia, anio_licencia = excluded.anio_licencia, modelo_auto = excluded.modelo_auto,
    anio_fabricacion = excluded.anio_fabricacion, color_auto = excluded.color_auto, matricula = excluded.matricula,
    padron = excluded.padron, libreta_propiedad = excluded.libreta_propiedad, compania_seguro = excluded.compania_seguro,
    tipo_seguro = excluded.tipo_seguro, cantidad_asientos = excluded.cantidad_asientos,
    cantidad_cinturones = excluded.cantidad_cinturones, fotos = excluded.fotos, enviado_en = excluded.enviado_en,
    revision = 'pendiente', revisado_en = null, revisado_por = null, comentario = null;

  -- La clave lleva la hora del reloj (no la de la transacción): cada envío es un aviso.
  perform public.encolar_aviso('admin:carsitting:' || v_yo || ':' || to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), null, 'todas', 'carsitting',
    v_n.nombre || case when v_antes.aprobado_en is not null then ' actualizó los datos del auto' else ' completó el carsitting' end,
    'Revisalo.', '?ir=hoy', jsonb_build_object('ninera_id', v_yo));
  return v_en;
end
$function$;
revoke execute on function public.ninera_guardar_carsitting(jsonb, jsonb) from public, anon;
grant execute on function public.ninera_guardar_carsitting(jsonb, jsonb) to authenticated;

-- Sus fotos: solo en su carpeta, con el nombre de una de las 7 y 8 hex al azar (cada envío sube archivos nuevos, así
-- lo aprobado antes no se pisa mientras se revisa lo nuevo). Las admins ven y borran todo (ninieras_privado_admins).
create policy ninieras_privado_carsitting on storage.objects as permissive for all to authenticated
  using ((bucket_id = 'ninieras-privado'::text)
         and (name ~ ('^carsitting/' || (select public.ninera_actual())::text
                      || '/(licencia_frente|licencia_dorso|libreta_frente|libreta_dorso|asientos|auto_dentro|auto_fuera)_[0-9a-f]{8}\.jpg$')))
  with check ((bucket_id = 'ninieras-privado'::text)
              and (name ~ ('^carsitting/' || (select public.ninera_actual())::text
                           || '/(licencia_frente|licencia_dorso|libreta_frente|libreta_dorso|asientos|auto_dentro|auto_fuera)_[0-9a-f]{8}\.jpg$')));

-- La revisión de una admin (una fila de la app que estaba 'pendiente'):
--   'aprobado' → aprobado_en / aprobado_por y lo que se aprobó (aprobado_datos), y "Tu carsitting quedó aprobado" /
--                "Gracias por completar los datos." (orquestador, 02/11/2026: neutro, los pedidos de traslado son la
--                etapa 11);
--   'rehacer'  → el comentario (obligatorio) le llega por el chat, con el nombre de quien revisó: el chat ya le manda
--                el push.
-- En la misma transacción: si el chat no se puede escribir, la revisión no queda.
create or replace function public.carsitting_al_revisar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n public.ninieras;
begin
  if new.enviado_en is null or old.revision is distinct from 'pendiente' or new.revision not in ('aprobado', 'rehacer') then
    return new;
  end if;
  select * into v_n from public.ninieras where id = new.ninera_id;
  new.revisado_en := coalesce(new.revisado_en, now());
  if new.revision = 'aprobado' then
    new.comentario := null;
    new.aprobado_en := new.revisado_en;
    new.aprobado_por := new.revisado_por;
    new.aprobado_datos := (select jsonb_object_agg(k.clave, to_jsonb(new) -> k.clave) from public.carsitting_campos() k)
                          || jsonb_build_object('fotos', new.fotos);
    if v_n.activa and v_n.user_id is not null and public.carsitting_puede_avisar(v_n.nombre) then
      perform public.encolar_aviso('carsitting:' || new.ninera_id || ':aprobado:' || to_char(new.revisado_en at time zone 'UTC', 'YYYYMMDDHH24MISSUS'),
        new.ninera_id, null, 'carsitting', 'Tu carsitting quedó aprobado', 'Gracias por completar los datos.', '#carsitting',
        jsonb_build_object('carsitting_id', new.id));
    end if;
  else
    new.comentario := nullif(btrim(new.comentario), '');
    if new.comentario is null then raise exception 'falta_comentario'; end if;
    if v_n.user_id is not null then
      insert into public.chat_mensajes (ninera_id, de, autor, texto)
      values (new.ninera_id, 'admin', coalesce(nullif(btrim(new.revisado_por), ''), 'Parents'' Break'),
              'Hay que corregir algo de tus datos de carsitting: ' || new.comentario);
    end if;
  end if;
  return new;
end
$function$;
revoke execute on function public.carsitting_al_revisar() from public, anon, authenticated;
create trigger carsitting_al_revisar before update of revision on public.carsitting_datos
  for each row execute function public.carsitting_al_revisar();

-- ---- Los avisos de tiempo (dentro del cron de cada minuto) ----
-- A las activas con app que hacen traslados (Traslados o Ambas) y no lo completaron (sin fila de la app) o tienen
-- que corregirlo ('rehacer'):
--   carsitting:<id>:completar       la primera vez, de 9 a 21 (sin fila de la app);
--   carsitting:<id>:semana:<lunes>  los lunes a las 10, si ya le llegó el primero antes de ese lunes (o le pidieron
--                                   corregirlo antes de ese lunes).
create or replace function public.programar_avisos_carsitting(p_ahora timestamp with time zone default now())
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_local timestamp := p_ahora at time zone 'America/Montevideo';
  v_hoy date := v_local::date;
  v_n integer;
begin
  if extract(hour from v_local) not between 9 and 20 then return 0; end if;
  with faltan as (
    select n.id, c.id is null as sin_fila, c.revisado_en
      from public.ninieras n
      left join public.carsitting_datos c on c.ninera_id = n.id and c.enviado_en is not null
     where n.activa and n.user_id is not null and n.app_activada_en is not null and n.tipo in ('Traslados', 'Ambas')
       and (c.id is null or c.revision = 'rehacer')
       and public.carsitting_puede_avisar(n.nombre)
  ), avisos as (
    select 'carsitting:' || f.id || ':completar' as clave, f.id, 'Completa tus datos de carsitting' as titulo,
           'Marcaste que realizas traslados. Necesitamos estos datos una sola vez.' as cuerpo
      from faltan f where f.sin_fila
    union all
    select 'carsitting:' || f.id || ':semana:' || v_hoy, f.id, 'Te faltan tus datos de carsitting',
           'Los necesitamos para tus traslados. Complétalos en la app.'
      from faltan f
     where extract(isodow from v_local) = 1 and extract(hour from v_local) = 10
       and (exists (select 1 from public.avisos a where a.clave = 'carsitting:' || f.id || ':completar'
                       and a.creado_en < (v_hoy::timestamp at time zone 'America/Montevideo'))
            or (not f.sin_fila and f.revisado_en < (v_hoy::timestamp at time zone 'America/Montevideo')))
  )
  select count(*) filter (where public.encolar_aviso(a.clave, a.id, null, 'carsitting', a.titulo, a.cuerpo, '#carsitting'))
    into v_n from avisos a;
  return v_n;
end
$function$;
revoke execute on function public.programar_avisos_carsitting(timestamp with time zone) from public, anon, authenticated;
grant execute on function public.programar_avisos_carsitting(timestamp with time zone) to service_role;

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
  v_total := v_total + public.programar_avisos_temporada();   -- etapa 9
  v_total := v_total + public.programar_avisos_pedidos();     -- etapa 6
  v_total := v_total + public.programar_avisos_guia();        -- etapa 4
  v_total := v_total + public.programar_avisos_el_dia();      -- etapa 7
  v_total := v_total + public.programar_avisos_carsitting();  -- etapa 10
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos() from public, anon, authenticated;
grant execute on function public.programar_avisos() to service_role;

commit;
