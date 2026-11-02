-- ============================================================================
-- Migración 02/11/2026 (fase 1, etapa 4): la guía obligatoria y la firma anual.
--
-- La niñera lee Protocolos y RCP y primeros auxilios en su app, aprueba los dos repasos y firma una vez
-- por año; sin eso no recibe pedidos por la app (decisiones.md 4.6 a 4.9 y 8, plan-implementacion.md
-- etapa 4). El contenido vive en ninera/guia/contenido.json (versión 2026.10); la base guarda el avance.
--
-- Suma:
--   - guia_progreso, guia_repasos y guia_firmas (la niñera lee lo suyo, las admins todo; nadie escribe
--     directo) y ninieras.rcp_presencial / rcp_certificado_ruta;
--   - app_config 'guia': plazo, gracia, versión, módulos y lecciones obligatorias;
--   - storage: la niñera sube su firma del día y su certificado de RCP a ninieras-privado (rutas
--     exactas; el bucket ya existe y no se toca);
--   - funciones: guia_estado (interna), ninera_puede_recibir_pedidos y guia_estado_ninieras (panel),
--     ninera_estado_guia, ninera_marcar_leida, ninera_aprobar_repaso, ninera_firmar_guia y
--     ninera_guardar_rcp (niñera), programar_avisos_guia (cron);
--   - cambia: enviar_pedido_app rechaza a la que no puede ('ninera_sin_guia', con su nombre en hint y
--     el motivo en detail), sugeridas_datos devuelve guia_puede / guia_motivo / guia_hasta por niñera,
--     ninera_mi_perfil suma rcp_presencial y rcp_certificado, y programar_avisos llama a la regla nueva.
--
-- Al aplicarla, toda niñera con app queda sin poder recibir pedidos hasta completar la guía, salvo las
-- que ya trabajaban, que tienen 7 días desde que activaron la app (hoy solo la de práctica tiene la app
-- activada: queda frenada hasta que Diego complete la guía en la sesión del iPhone).
--
-- Compatible con la app publicada: columnas y tablas nuevas; las funciones cambiadas devuelven lo mismo
-- más campos (el panel y la app de hoy no los leen). No modifica datos: no hace falta respaldo. Se
-- deshace con 20261105_guia_DESHACER.sql.
-- ============================================================================
begin;

-- ---- RCP presencial (decisiones 8: en "Mi perfil") ----
-- rcp_certificado_ruta: la foto del certificado en ninieras-privado (rcp/<id>/certificado.jpg), solo
-- si hizo el curso presencial. La escribe ninera_guardar_rcp; la ven las admins con un link firmado.
alter table public.ninieras
  add column rcp_presencial boolean,
  add column rcp_certificado_ruta text;

-- ---- Progreso, repasos y firmas ----
-- Una fila por lección leída y por repaso aprobado (releer o volver a aprobar pisa la fecha: lo que
-- cuenta para el ciclo es lo hecho después de la última firma). version: la de la guía con que se leyó.
create table public.guia_progreso (
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  leccion_id text not null,
  version text not null,
  leido_en timestamp with time zone default now() not null,
  constraint guia_progreso_pkey primary key (ninera_id, leccion_id),
  constraint guia_progreso_leccion_check check (leccion_id ~ '^[a-z0-9-]{1,20}$'),
  constraint guia_progreso_version_check check (version ~ '^[0-9]{4}\.[0-9]{2}$')
);
create table public.guia_repasos (
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  modulo_id text not null,
  version text not null,
  aprobado_en timestamp with time zone default now() not null,
  constraint guia_repasos_pkey primary key (ninera_id, modulo_id),
  constraint guia_repasos_modulo_check check (modulo_id ~ '^[a-z0-9-]{1,20}$'),
  constraint guia_repasos_version_check check (version ~ '^[0-9]{4}\.[0-9]{2}$')
);
-- Cada firma anual queda (no se pisa): la declaración, el nombre tipeado, la imagen de la firma y la
-- versión de la guía (decisiones 4.7).
create table public.guia_firmas (
  id uuid default gen_random_uuid() not null,
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  version text not null,
  nombre text not null,
  firma_ruta text not null,
  firmado_en timestamp with time zone default now() not null,
  constraint guia_firmas_pkey primary key (id),
  constraint guia_firmas_nombre_check check (char_length(nombre) between 3 and 120),
  constraint guia_firmas_version_check check (version ~ '^[0-9]{4}\.[0-9]{2}$')
);
create index guia_firmas_ninera on public.guia_firmas (ninera_id, firmado_en desc);

-- La niñera lee lo suyo; las admins, todo. Nadie escribe directo: la niñera, con sus funciones.
alter table public.guia_progreso enable row level security;
alter table public.guia_repasos enable row level security;
alter table public.guia_firmas enable row level security;
create policy guia_progreso_propio on public.guia_progreso as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy guia_progreso_admins_leer on public.guia_progreso as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
create policy guia_repasos_propio on public.guia_repasos as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy guia_repasos_admins_leer on public.guia_repasos as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
create policy guia_firmas_propio on public.guia_firmas as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy guia_firmas_admins_leer on public.guia_firmas as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
revoke insert, update, delete on public.guia_progreso, public.guia_repasos, public.guia_firmas from anon, authenticated;

-- ---- Configuración ----
-- plazo_dias: para las que ya trabajaban, desde que activan la app (decisiones 4.8); gracia_anual_dias:
-- después del año de la firma (4.9). lecciones_obligatorias: las de Protocolos (sin b2, que pasó a Bebés)
-- y las de RCP y primeros auxilios, iguales a ninera/guia/contenido.json (lo controla
-- tests/estatico.spec.js): la base no lee el JSON y las necesita para saber si está completa.
insert into public.app_config (id, valor) values ('guia', jsonb_build_object(
  'plazo_dias', 7,
  'gracia_anual_dias', 7,
  'version_vigente', '2026.10',
  'modulos_obligatorios', jsonb_build_array('protocolos', 'auxilios'),
  'lecciones_obligatorias', jsonb_build_array(
    'pr1', 'pr2', 'pr3', 'pr4', 'pr5', 'pr6', 'pr7',
    'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9', 'x10', 'x11', 'x12', 'x13')))
on conflict (id) do nothing;

-- ---- Storage: la firma y el certificado de RCP (decisiones 5.3) ----
-- Rutas exactas, como la foto propuesta: la firma solo la del día (firmas/<id>/<AAAA-MM-DD>.png, la
-- puede subir de nuevo ese día y después ya no la toca) y el certificado uno solo
-- (rcp/<id>/certificado.jpg, lo cambia o lo borra cuando quiere). Las admins ya leen y borran todo el
-- bucket (ninieras_privado_admins).
create policy ninieras_privado_firma on storage.objects as permissive for all to authenticated
  using ((bucket_id = 'ninieras-privado'::text) and (name = ('firmas/' || (select public.ninera_actual())::text || '/' || to_char((select public.hoy_mvd()), 'YYYY-MM-DD') || '.png')))
  with check ((bucket_id = 'ninieras-privado'::text) and (name = ('firmas/' || (select public.ninera_actual())::text || '/' || to_char((select public.hoy_mvd()), 'YYYY-MM-DD') || '.png')));
create policy ninieras_privado_rcp on storage.objects as permissive for all to authenticated
  using ((bucket_id = 'ninieras-privado'::text) and (name = ('rcp/' || (select public.ninera_actual())::text || '/certificado.jpg')))
  with check ((bucket_id = 'ninieras-privado'::text) and (name = ('rcp/' || (select public.ninera_actual())::text || '/certificado.jpg')));

-- ---- El estado de la guía de una niñera (decisiones 8) ----
-- completa: todas las lecciones obligatorias leídas y los repasos obligatorios aprobados después de la
--   última firma (o en cualquier momento si nunca firmó): es lo que hace falta para firmar.
-- firma_vigente: la última firma tiene menos de 365 días. Para firmar hubo que tenerla completa, así
--   que "completa y firmada" (decisiones 8) es "firma vigente"; después de firmar, completa vuelve a
--   false hasta el ciclo siguiente.
-- puede / motivo / hasta, en este orden:
--   inactiva o sin_app: no;
--   firma vigente: sí (motivo null);
--   firmó alguna vez y venció: dentro de gracia_anual_dias sí ('gracia', hasta ese día), si no
--   'firma_vencida';
--   nunca firmó: si tenía sittings registrados antes de activar la app (por id o, en la historia
--   vieja, por el nombre) y está dentro de plazo_dias desde que la activó, sí ('plazo', hasta ese día);
--   si no, 'sin_guia'.
-- Interna (sin execute para nadie): la usan las funciones de abajo.
create or replace function public.guia_estado(p_ninera_id uuid, p_ahora timestamp with time zone default now())
returns table (completa boolean, firma_vigente boolean, puede boolean, motivo text, hasta date,
               ultima_firma timestamp with time zone, version_firma text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_n public.ninieras;
  v_cfg jsonb := coalesce((select valor from public.app_config where id = 'guia'), '{}'::jsonb);
  v_plazo integer := coalesce((v_cfg->>'plazo_dias')::int, 7);
  v_gracia integer := coalesce((v_cfg->>'gracia_anual_dias')::int, 7);
  v_lecciones text[] := array(select jsonb_array_elements_text(coalesce(v_cfg->'lecciones_obligatorias', '[]'::jsonb)));
  v_modulos text[] := array(select jsonb_array_elements_text(coalesce(v_cfg->'modulos_obligatorios', '[]'::jsonb)));
  v_desde timestamp with time zone;
  v_vence timestamp with time zone;
  v_nueva boolean;
begin
  select * into v_n from public.ninieras where id = p_ninera_id;
  if not found then return; end if;
  select f.firmado_en, f.version into ultima_firma, version_firma
    from public.guia_firmas f where f.ninera_id = p_ninera_id order by f.firmado_en desc limit 1;
  v_desde := coalesce(ultima_firma, '-infinity'::timestamptz);
  completa := cardinality(v_lecciones) > 0
    and (select count(*) from public.guia_progreso g
          where g.ninera_id = p_ninera_id and g.leccion_id = any (v_lecciones) and g.leido_en > v_desde) = cardinality(v_lecciones)
    and (select count(*) from public.guia_repasos r
          where r.ninera_id = p_ninera_id and r.modulo_id = any (v_modulos) and r.aprobado_en > v_desde) = cardinality(v_modulos);
  firma_vigente := ultima_firma is not null and p_ahora < ultima_firma + interval '365 days';

  if not v_n.activa then
    puede := false; motivo := 'inactiva';
  elsif v_n.user_id is null then
    puede := false; motivo := 'sin_app';
  elsif firma_vigente then
    puede := true;
  elsif ultima_firma is not null then
    v_vence := ultima_firma + make_interval(days => 365 + v_gracia);
    if p_ahora < v_vence then
      puede := true; motivo := 'gracia'; hasta := (v_vence at time zone 'America/Montevideo')::date;
    else
      puede := false; motivo := 'firma_vencida';
    end if;
  else
    v_nueva := v_n.app_activada_en is null or not exists (
      select 1 from public.sittings_traslados s
       where not s.cancelado
         and s.fecha < (v_n.app_activada_en at time zone 'America/Montevideo')::date
         and (s.ninera_id = v_n.id
              or (s.ninera_id is null
                  and public.normaliza_nombre(btrim(s.ninera_nombre)) = public.normaliza_nombre(btrim(v_n.nombre)))));
    v_vence := v_n.app_activada_en + make_interval(days => v_plazo);
    if not v_nueva and p_ahora < v_vence then
      puede := true; motivo := 'plazo'; hasta := (v_vence at time zone 'America/Montevideo')::date;
    else
      puede := false; motivo := 'sin_guia';
    end if;
  end if;
  return next;
end
$function$;
revoke execute on function public.guia_estado(uuid, timestamp with time zone) from public, anon, authenticated;

-- Si una niñera puede recibir pedidos por la app (decisiones 8). Para las admins (sugeridas_datos) o
-- para la propia niñera; enviar_pedido_app usa guia_estado directo.
create or replace function public.ninera_puede_recibir_pedidos(p_ninera_id uuid)
returns table (puede boolean, motivo text, hasta date)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce((select public.es_usuaria_autorizada()), false)
     and p_ninera_id is distinct from (select public.ninera_actual()) then
    raise exception 'no_autorizada';
  end if;
  return query select e.puede, e.motivo, e.hasta from public.guia_estado(p_ninera_id) e;
end
$function$;
revoke execute on function public.ninera_puede_recibir_pedidos(uuid) from public, anon;
grant execute on function public.ninera_puede_recibir_pedidos(uuid) to authenticated;

-- La guía de todas las niñeras activas con app, en una sola lectura (lista y ficha del panel). Solo admins.
create or replace function public.guia_estado_ninieras()
returns table (ninera_id uuid, completa boolean, firma_vigente boolean, puede boolean, motivo text, hasta date,
               ultima_firma timestamp with time zone, version_firma text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce((select public.es_usuaria_autorizada()), false) then
    raise exception 'no_autorizada';
  end if;
  return query
    select n.id, e.completa, e.firma_vigente, e.puede, e.motivo, e.hasta, e.ultima_firma, e.version_firma
      from public.ninieras n cross join lateral public.guia_estado(n.id) e
     where n.activa and n.user_id is not null;
end
$function$;
revoke execute on function public.guia_estado_ninieras() from public, anon;
grant execute on function public.guia_estado_ninieras() to authenticated;

-- La guía de la niñera de la sesión (vacío si no es niñera). Lo leído y aprobado alguna vez (para el
-- índice) y lo del ciclo actual, después de la última firma (para saber qué le falta para firmar).
create or replace function public.ninera_estado_guia()
returns table (completa boolean, firma_vigente boolean, puede boolean, motivo text, hasta date,
               ultima_firma timestamp with time zone, version_firma text,
               lecciones_leidas text[], repasos_aprobados text[], lecciones_ciclo text[], repasos_ciclo text[])
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
begin
  if v_yo is null then return; end if;
  return query
    select e.completa, e.firma_vigente, e.puede, e.motivo, e.hasta, e.ultima_firma, e.version_firma,
           coalesce((select array_agg(g.leccion_id order by g.leccion_id) from public.guia_progreso g where g.ninera_id = v_yo), '{}'),
           coalesce((select array_agg(r.modulo_id order by r.modulo_id) from public.guia_repasos r where r.ninera_id = v_yo), '{}'),
           coalesce((select array_agg(g.leccion_id order by g.leccion_id) from public.guia_progreso g
                      where g.ninera_id = v_yo and g.leido_en > coalesce(e.ultima_firma, '-infinity'::timestamptz)), '{}'),
           coalesce((select array_agg(r.modulo_id order by r.modulo_id) from public.guia_repasos r
                      where r.ninera_id = v_yo and r.aprobado_en > coalesce(e.ultima_firma, '-infinity'::timestamptz)), '{}')
      from public.guia_estado(v_yo) e;
end
$function$;
revoke execute on function public.ninera_estado_guia() from public, anon;
grant execute on function public.ninera_estado_guia() to authenticated;

-- "Ya lo leí": anota (o vuelve a anotar) la lección. Cualquier lección de la guía, obligatoria o no;
-- hasta 200 filas por niñera (la guía tiene 48).
create or replace function public.ninera_marcar_leida(p_leccion_id text, p_version text)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_en timestamp with time zone;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_leccion_id is null or p_leccion_id !~ '^[a-z0-9-]{1,20}$' then raise exception 'leccion_invalida'; end if;
  if p_version is null or p_version !~ '^[0-9]{4}\.[0-9]{2}$' then raise exception 'version_invalida'; end if;
  if (select count(*) from public.guia_progreso where ninera_id = v_yo) >= 200
     and not exists (select 1 from public.guia_progreso where ninera_id = v_yo and leccion_id = p_leccion_id) then
    raise exception 'demasiadas';
  end if;
  insert into public.guia_progreso (ninera_id, leccion_id, version, leido_en)
  values (v_yo, p_leccion_id, p_version, now())
  on conflict (ninera_id, leccion_id) do update set version = excluded.version, leido_en = excluded.leido_en
  returning leido_en into v_en;
  return v_en;
end
$function$;
revoke execute on function public.ninera_marcar_leida(text, text) from public, anon;
grant execute on function public.ninera_marcar_leida(text, text) to authenticated;

-- Repaso aprobado (todas bien). Las respuestas están en el repo público: el celular corrige y la base
-- anota (decisión de Diego, 02/11/2026). Hasta 50 módulos por niñera (la guía tiene 11).
create or replace function public.ninera_aprobar_repaso(p_modulo_id text, p_version text)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_en timestamp with time zone;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_modulo_id is null or p_modulo_id !~ '^[a-z0-9-]{1,20}$' then raise exception 'modulo_invalido'; end if;
  if p_version is null or p_version !~ '^[0-9]{4}\.[0-9]{2}$' then raise exception 'version_invalida'; end if;
  if (select count(*) from public.guia_repasos where ninera_id = v_yo) >= 50
     and not exists (select 1 from public.guia_repasos where ninera_id = v_yo and modulo_id = p_modulo_id) then
    raise exception 'demasiados';
  end if;
  insert into public.guia_repasos (ninera_id, modulo_id, version, aprobado_en)
  values (v_yo, p_modulo_id, p_version, now())
  on conflict (ninera_id, modulo_id) do update set version = excluded.version, aprobado_en = excluded.aprobado_en
  returning aprobado_en into v_en;
  return v_en;
end
$function$;
revoke execute on function public.ninera_aprobar_repaso(text, text) from public, anon;
grant execute on function public.ninera_aprobar_repaso(text, text) to authenticated;

-- La firma anual (decisiones 4.7). La imagen se sube antes a firmas/<id>/<hoy>.png (la ruta la arma la
-- base: la niñera no elige dónde) y la base verifica que esté. Solo con la guía completa. Un segundo
-- toque el mismo día devuelve la misma firma, sin otra fila.
create or replace function public.ninera_firmar_guia(p_nombre text, p_version text)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_ruta text;
  v_en timestamp with time zone;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if char_length(v_nombre) not between 3 and 120 then raise exception 'nombre_invalido'; end if;
  if p_version is null or p_version !~ '^[0-9]{4}\.[0-9]{2}$' then raise exception 'version_invalida'; end if;
  v_ruta := 'firmas/' || v_yo || '/' || to_char(public.hoy_mvd(), 'YYYY-MM-DD') || '.png';
  select firmado_en into v_en from public.guia_firmas where ninera_id = v_yo and firma_ruta = v_ruta;
  if found then return v_en; end if;
  if not (select e.completa from public.guia_estado(v_yo) e) then raise exception 'guia_incompleta'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'ninieras-privado' and o.name = v_ruta) then
    raise exception 'falta_firma';
  end if;
  insert into public.guia_firmas (ninera_id, version, nombre, firma_ruta)
  values (v_yo, p_version, v_nombre, v_ruta)
  returning firmado_en into v_en;
  return v_en;
end
$function$;
revoke execute on function public.ninera_firmar_guia(text, text) from public, anon;
grant execute on function public.ninera_firmar_guia(text, text) to authenticated;

-- RCP presencial Sí / No y, si lo hizo, la foto del certificado (opcional), ya subida a
-- rcp/<id>/certificado.jpg. Sin curso presencial no queda certificado.
create or replace function public.ninera_guardar_rcp(p_presencial boolean, p_con_certificado boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_ruta text;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_presencial is null then raise exception 'rcp_invalido'; end if;
  v_ruta := 'rcp/' || v_yo || '/certificado.jpg';
  if p_presencial and coalesce(p_con_certificado, false)
     and not exists (select 1 from storage.objects o where o.bucket_id = 'ninieras-privado' and o.name = v_ruta) then
    raise exception 'falta_certificado';
  end if;
  update public.ninieras
     set rcp_presencial = p_presencial,
         rcp_certificado_ruta = case when p_presencial and coalesce(p_con_certificado, false) then v_ruta end
   where id = v_yo;
end
$function$;
revoke execute on function public.ninera_guardar_rcp(boolean, boolean) from public, anon;
grant execute on function public.ninera_guardar_rcp(boolean, boolean) to authenticated;

-- ---- Avisos de la guía (textos.md 1), dentro del cron de cada minuto ----
-- De 9 a 21 de Montevideo, como la temporada. Claves:
--   guia:<id>:falta        la guía la frena ('sin_guia': al activar la app si es nueva, o cuando se le
--                          venció el plazo);
--   guia:<id>:falta:mitad  a mitad del plazo de las que ya trabajaban;
--   guia:<id>:anual:<AAAA-MM-DD de la firma>  se cumplió el año de esa firma.
create or replace function public.programar_avisos_guia(p_ahora timestamp with time zone default now())
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_local timestamp := p_ahora at time zone 'America/Montevideo';
  v_plazo integer := coalesce((select (valor->>'plazo_dias')::int from public.app_config where id = 'guia'), 7);
  v_n integer;
begin
  if extract(hour from v_local) not between 9 and 20 then return 0; end if;
  with est as (
    select n.id, n.app_activada_en, e.*
      from public.ninieras n cross join lateral public.guia_estado(n.id, p_ahora) e
     where n.activa and n.user_id is not null and n.app_activada_en is not null
  ), avisos as (
    select 'guia:' || id || ':falta' as clave, id, 'Te falta la guía para empezar' as titulo,
           'Lee Protocolos y RCP antes de tu primer sitting.' as cuerpo
      from est where motivo = 'sin_guia'
    union all
    select 'guia:' || id || ':falta:mitad', id, 'Te falta la guía para empezar',
           'Lee Protocolos y RCP antes de tu primer sitting.'
      from est where motivo = 'plazo' and p_ahora >= app_activada_en + make_interval(secs => v_plazo * 86400 / 2.0)
    union all
    select 'guia:' || id || ':anual:' || to_char(ultima_firma at time zone 'America/Montevideo', 'YYYY-MM-DD'), id,
           'Repasa la guía', 'Hace un año que hiciste Protocolos y RCP. Repásalos para seguir recibiendo pedidos.'
      from est where ultima_firma is not null and not firma_vigente
  )
  select count(*) filter (where public.encolar_aviso(a.clave, a.id, null, 'guia', a.titulo, a.cuerpo, '#guia'))
    into v_n from avisos a;
  return v_n;
end
$function$;
revoke execute on function public.programar_avisos_guia(timestamp with time zone) from public, anon, authenticated;
grant execute on function public.programar_avisos_guia(timestamp with time zone) to service_role;

-- ---- Funciones que cambian ----
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
  v_puede boolean;
  v_motivo text;
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
    -- La guía (etapa 4, decisiones 8): sin la guía o con la firma vencida no recibe pedidos por la app,
    -- tampoco la de práctica. detail: el motivo ('sin_guia', 'firma_vencida').
    select g.puede, g.motivo into v_puede, v_motivo from public.guia_estado(v_n.id) g;
    if not coalesce(v_puede, false) then
      raise exception 'ninera_sin_guia' using hint = v_n.nombre, detail = coalesce(v_motivo, '');
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
               'no_disponible', exists (select 1 from public.ninera_no_disponible d where d.ninera_id = n.id and d.fecha = p_fecha),
               -- La guía (etapa 4): solo de las que tienen app (las demás no reciben por la app).
               'guia_puede', g.puede, 'guia_motivo', g.motivo, 'guia_hasta', g.hasta))
        from public.ninieras n
        left join respuestas rp on rp.ninera_id = n.id
        left join lateral (select * from public.ninera_puede_recibir_pedidos(n.id) where n.user_id is not null) g on true), '[]'::jsonb))
$function$;
revoke execute on function public.sugeridas_datos(uuid, text, date) from public, anon;
grant execute on function public.sugeridas_datos(uuid, text, date) to authenticated;

-- El perfil suma el RCP: cambia lo que devuelve, hay que borrarla y crearla de nuevo.
drop function public.ninera_mi_perfil();
create or replace function public.ninera_mi_perfil()
returns table (id uuid, nombre text, telefono text, tipo text, zona text, barrios text,
               cuenta_bancaria text[], foto text, foto_propuesta_ruta text,
               foto_propuesta_en timestamp with time zone, perfil_app_en timestamp with time zone,
               perfil_actualizado_en timestamp with time zone, app_activada_en timestamp with time zone,
               rcp_presencial boolean, rcp_certificado boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select n.id, n.nombre, n.telefono, n.tipo, n.zona, n.barrios, n.cuenta_bancaria, n.foto,
         n.foto_propuesta_ruta, n.foto_propuesta_en, n.perfil_app_en, n.perfil_actualizado_en,
         n.app_activada_en, n.rcp_presencial, n.rcp_certificado_ruta is not null
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
  v_total := v_total + public.programar_avisos_guia();       -- etapa 4
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos() from public, anon, authenticated;
grant execute on function public.programar_avisos() to service_role;

commit;
