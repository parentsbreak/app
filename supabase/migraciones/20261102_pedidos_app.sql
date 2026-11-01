-- ============================================================================
-- Migración 02/11/2026 (fase 1, etapa 5): el pedido por la app de niñeras.
--
-- La admin pega el WhatsApp de la madre, revisa el ticket y elige a quién mandárselo; a las que
-- tienen la app les llega un aviso y responden "Puedo" / "No puedo" desde su celular
-- (docs/fase1/decisiones.md 6.3, plan-implementacion.md etapa 5). Elegir a la que va (y avisarles
-- a las demás) es la etapa 6: hasta entonces la admin asigna con "Asignar", como hoy.
--
-- Suma:
--   - solicitudes: ninera_pedida_id (la que pidió la madre), notas_para_ninera, enviado_app_en
--     (primer envío por la app) y responder_hasta (hasta cuándo se espera la respuesta);
--   - solicitud_ninieras: origen ('panel' como siempre, 'app' lo que se mandó por la app),
--     precio_hora, enviado_en, respondido_en, motivo_no, motivo_texto, y los estados 'acepto'
--     ("Puedo") y 'no_puedo'. Una niñera recibe un mismo pedido una sola vez por la app;
--   - ninera_no_disponible: los días que la niñera marcó que no puede (los lee el orden de las
--     sugeridas; ella los escribe solo con su función);
--   - familias.solo_conocidas ("No acepta nuevas", decisiones 4.16) y pedidos_whatsapp.ninera_pedida
--     (la niñera que pide la madre, tal cual la escribe; la devuelve pedido-whatsapp);
--   - app_config 'pedidos_app': los minutos para responder (15 si el pedido es para hoy, 30 si no),
--     los tiempos de los avisos de la etapa 6 y solo_practica (prendido: por la app solo salen
--     pedidos de práctica hasta la guía y la prueba con niñeras reales);
--   - funciones: enviar_pedido_app (admin), ninera_mis_pedidos, responder_pedido y
--     ninera_marcar_no_disponible (niñera), sugeridas_datos (admin, invoker: lo que el panel necesita
--     para ordenar en una sola lectura), pesos_texto y normaliza_nombre (ayudas), y el aviso
--     "Pedido nuevo" a las otras admins cuando un pedido de WhatsApp se pasa a la Agenda.
--
-- Lo que la niñera ve del pedido (regla 3): día, horario, zona, chicos y su precio por hora. Nunca
-- la familia, la dirección, el cobro ni las notas (las notas y la dirección van al quedar elegida,
-- etapa 6). Lo garantizan las funciones: la niñera no tiene políticas sobre solicitudes ni
-- solicitud_ninieras.
--
-- La guía (etapa 4) todavía no existe: enviar_pedido_app no la mira. La etapa 4 suma ahí el freno
-- (ninera_puede_recibir_pedidos) antes de la prueba con niñeras reales (Diego, 31/10/2026).
--
-- Compatible con la app publicada: columnas nuevas con valor por defecto o vacías, el check de
-- estados solo suma valores, una tabla y funciones nuevas. Las filas que ya existen quedan con
-- origen 'panel' y siguen igual. No modifica datos: no hace falta respaldo. Se deshace con
-- 20261102_pedidos_app_DESHACER.sql.
-- ============================================================================
begin;

-- ---- Columnas ----
alter table public.solicitudes
  add column ninera_pedida_id uuid references public.ninieras(id) on delete set null,
  add column notas_para_ninera text,
  add column enviado_app_en timestamp with time zone,
  add column responder_hasta timestamp with time zone,
  add constraint solicitudes_notas_para_ninera_check
    check (notas_para_ninera is null or char_length(notas_para_ninera) <= 1000);

alter table public.solicitud_ninieras
  add column origen text default 'panel' not null,
  add column precio_hora numeric,
  add column enviado_en timestamp with time zone,
  add column respondido_en timestamp with time zone,
  add column motivo_no text,
  add column motivo_texto text,
  add constraint solicitud_ninieras_origen_check check (origen in ('panel', 'app')),
  add constraint solicitud_ninieras_precio_hora_check
    check (precio_hora is null or (precio_hora > 0 and precio_hora < 100000)),
  add constraint solicitud_ninieras_motivo_no_check
    check (motivo_no is null or motivo_no in ('otro_trabajo', 'facultad', 'lejos', 'tarde', 'otro')),
  add constraint solicitud_ninieras_motivo_texto_check
    check (motivo_texto is null or char_length(motivo_texto) <= 200);
alter table public.solicitud_ninieras drop constraint solicitud_ninieras_estado_check;
alter table public.solicitud_ninieras add constraint solicitud_ninieras_estado_check
  check (estado in ('invitada', 'confirmada', 'rechazada', 'acepto', 'no_puedo'));
-- Una niñera recibe un pedido una sola vez por la app ("Mandar a más niñeras" no la repite). Lo
-- cargado desde el panel no entra: ahí puede haber filas viejas repetidas.
create unique index solicitud_ninieras_app_unica on public.solicitud_ninieras (solicitud_id, ninera_id)
  where origen = 'app';
-- Los pedidos de la niñera (ninera_mis_pedidos) y el estado de sus respuestas.
create index solicitud_ninieras_ninera_estado on public.solicitud_ninieras (ninera_id, estado);

alter table public.familias add column solo_conocidas boolean default false not null;

alter table public.pedidos_whatsapp
  add column ninera_pedida text,
  add constraint pedidos_whatsapp_ninera_pedida_check
    check (ninera_pedida is null or char_length(ninera_pedida) <= 80);

-- ---- Días que la niñera no puede ----
-- Los marca ella después de un "No puedo" (textos 4). No la sacan de las sugeridas: la bajan dentro
-- de su grupo con la marca "no puede ese día" (reglas 5).
create table public.ninera_no_disponible (
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  fecha date not null,
  creado_en timestamp with time zone default now() not null,
  constraint ninera_no_disponible_pkey primary key (ninera_id, fecha)
);
alter table public.ninera_no_disponible enable row level security;
create policy ninera_no_disponible_propios on public.ninera_no_disponible as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy ninera_no_disponible_admins_leer on public.ninera_no_disponible as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
-- Nadie escribe directo: la niñera, con ninera_marcar_no_disponible.
revoke insert, update, delete on public.ninera_no_disponible from anon, authenticated;

-- ---- Configuración ----
-- Minutos para responder (decisiones 6.3, paso 5) y los tiempos de los avisos de la etapa 6.
-- solo_practica: mientras sea true, por la app solo se mandan pedidos de práctica (decisiones 4.17).
-- Hasta la guía (etapa 4) y la prueba con niñeras reales, a ninguna niñera real le llega un pedido
-- por la app (Diego, 31/10/2026). Se apaga por SQL con el OK de Diego.
-- Sin interfaz en la fase 1: se cambian por SQL.
insert into public.app_config (id, valor)
values ('pedidos_app', '{"min_mismo_dia": 15, "min_otro_dia": 30, "recordatorio_min_antes": 10, "aviso_sin_ninera_horas": 3, "solo_practica": true}'::jsonb)
on conflict (id) do nothing;

-- ---- Ayudas ----
-- "$1.250": sin centavos y con punto de miles, como el panel. to_char con ',' literal (no 'G'), así
-- no depende del idioma de la base.
create or replace function public.pesos_texto(p_monto numeric)
returns text
language sql
immutable
set search_path to ''
as $function$
  select '$' || replace(to_char(round(p_monto), 'FM999,999,999'), ',', '.')
$function$;

-- La misma regla que normaliza() de js/comun.js (sin tildes y en minúsculas), para cruzar los
-- registros viejos que tienen el nombre pero no el id de la niñera o de la familia.
create or replace function public.normaliza_nombre(p_texto text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select lower(translate(coalesce(p_texto, ''), 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
                                               'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun'))
$function$;

-- "sáb 07/11": el día de la semana sin depender del idioma de la base.
create or replace function public.dia_corto_texto(p_fecha date)
returns text
language sql
immutable
set search_path to ''
as $function$
  select (array['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'])[extract(dow from p_fecha)::int + 1]
         || ' ' || to_char(p_fecha, 'DD/MM')
$function$;

-- ---- Mandar el pedido por la app (admin) ----
-- p_envios: [{"ninera_id": "...", "precio_hora": 300}, ...]. En una sola transacción: valida el
-- pedido y cada niñera, crea su fila (estado 'invitada', origen 'app'), le encola el aviso
-- pedido:<sn>:nuevo y deja el pedido 'pendiente_confirmar' con su hora límite. Una niñera a la que
-- ya le llegó este pedido se saltea sin error (no se le manda dos veces). Devuelve a cuántas se
-- mandó. Los errores van por raise con un código corto (el panel los traduce) y el nombre de la
-- niñera en el hint.
-- Práctica (decisiones 4.17): un pedido de una familia "(práctica)" va solo a niñeras "(práctica)"
-- y al revés (con o sin tilde); la pantalla no deja tildarlas, y esto es la red por si algo se
-- escapa. Con app_config 'pedidos_app'.solo_practica, un pedido real no se manda por la app.
-- Los chicos tienen que estar cargados uno por uno (hijos_familia): el texto libre viejo de
-- familias.ninos puede tener nombres y apellido, y el pedido les llega a varias antes de elegir.
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
  -- Textos 1: el fin siempre "aproximada, se puede extender"; sin fin, "sin hora de fin"; si
  -- termina pasada la medianoche, "del día siguiente".
  v_horario := to_char(v_s.hora_inicio, 'HH24:MI')
    || case when v_s.hora_fin is null then ', sin hora de fin'
            else ' – ' || to_char(v_s.hora_fin, 'HH24:MI')
                 || case when v_s.termina_dia_siguiente then ' del día siguiente' else '' end
                 || ' (aproximada, se puede extender)' end;

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

-- ---- Lo de la niñera ----
-- Sus pedidos abiertos: los que todavía no respondió ('invitada', "Pedidos por responder") y los que
-- dijo que puede ('acepto', "Esperando confirmación"). Un pedido asignado, cancelado o de un día que
-- ya pasó no aparece. Nunca la familia, la dirección, el cobro ni las notas.
create or replace function public.ninera_mis_pedidos()
returns table (id uuid, estado text, fecha date, hora_inicio time without time zone,
               hora_fin time without time zone, termina_dia_siguiente boolean, zona text, chicos text,
               precio_hora numeric, responder_hasta timestamp with time zone,
               enviado_en timestamp with time zone, respondido_en timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select sn.id, sn.estado, s.fecha, s.hora_inicio, s.hora_fin, s.termina_dia_siguiente,
         coalesce(nullif(btrim(s.zona), ''), nullif(btrim(f.zona), '')),
         -- Solo con los chicos cargados uno por uno (nunca el texto libre de familias.ninos).
         case when exists (select 1 from public.hijos_familia h where h.familia_id = s.familia_id)
              then public.chicos_texto(s.familia_id) end,
         sn.precio_hora, s.responder_hasta, sn.enviado_en, sn.respondido_en
    from public.solicitud_ninieras sn
    join public.solicitudes s on s.id = sn.solicitud_id
    left join public.familias f on f.id = s.familia_id
   where sn.ninera_id = (select public.ninera_actual())
     and sn.origen = 'app'
     and sn.estado in ('invitada', 'acepto')
     and s.estado in ('sin_asignar', 'pendiente_confirmar')
     and s.fecha >= public.hoy_mvd()
   order by s.fecha, s.hora_inicio
$function$;
revoke execute on function public.ninera_mis_pedidos() from public, anon;
grant execute on function public.ninera_mis_pedidos() to authenticated;

-- Responde un pedido suyo: 'acepto' ("Puedo") o 'no_puedo' con el motivo (textos 4; el texto libre
-- solo con 'otro'). Una sola respuesta: el update lleva la condición del estado anterior, así dos
-- toques o dos celulares no responden dos veces. Puede responder pasada la hora límite mientras el
-- pedido siga abierto (decisiones 4.11). Devuelve 'ok', 'ya_respondido' o 'cerrado'. Un "Puedo"
-- avisa al instante a las admins (admin:pedido:<sn>:acepto).
create or replace function public.responder_pedido(p_sn_id uuid, p_respuesta text, p_motivo text default null,
  p_motivo_texto text default null)
returns text
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_sn public.solicitud_ninieras;
  v_s public.solicitudes;
  v_texto text := nullif(btrim(coalesce(p_motivo_texto, '')), '');
  v_n integer;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_respuesta is null or p_respuesta not in ('acepto', 'no_puedo') then raise exception 'respuesta_invalida'; end if;
  if p_respuesta = 'no_puedo' then
    if p_motivo is null or p_motivo not in ('otro_trabajo', 'facultad', 'lejos', 'tarde', 'otro') then
      raise exception 'motivo_invalido';
    end if;
    if p_motivo <> 'otro' then v_texto := null; end if;
    if char_length(v_texto) > 200 then raise exception 'motivo_largo'; end if;
  else
    p_motivo := null;
    v_texto := null;
  end if;

  -- Un pedido de otra o que no existe dan lo mismo: no se dice si existe.
  select * into v_sn from public.solicitud_ninieras where id = p_sn_id and ninera_id = v_yo and origen = 'app';
  if not found then raise exception 'no_existe'; end if;
  -- for share: que nadie lo asigne ni lo cancele entre el chequeo y la respuesta.
  select * into v_s from public.solicitudes where id = v_sn.solicitud_id for share;
  if v_s.estado not in ('sin_asignar', 'pendiente_confirmar') or v_s.fecha < public.hoy_mvd() then
    return 'cerrado';
  end if;

  update public.solicitud_ninieras
     set estado = p_respuesta, respondido_en = now(), motivo_no = p_motivo, motivo_texto = v_texto
   where id = p_sn_id and estado = 'invitada';
  get diagnostics v_n = row_count;
  if v_n = 0 then return 'ya_respondido'; end if;

  if p_respuesta = 'acepto' then
    perform public.encolar_aviso('admin:pedido:' || p_sn_id || ':acepto', null, 'todas', 'pedidos',
      v_sn.ninera_nombre || ' aceptó el pedido de ' || v_s.familia_nombre,
      public.dia_corto_texto(v_s.fecha) || ' ' || to_char(v_s.hora_inicio, 'HH24:MI'),
      '?ir=agenda&solicitud=' || v_s.id, jsonb_build_object('solicitud_id', v_s.id));
  end if;
  return 'ok';
end
$function$;
revoke execute on function public.responder_pedido(uuid, text, text, text) from public, anon;
grant execute on function public.responder_pedido(uuid, text, text, text) to authenticated;

-- Marca (o con p_quitar, desmarca) días en que no puede, de hoy a 90 días, hasta 62 por vez.
-- Devuelve cuántos cambió.
create or replace function public.ninera_marcar_no_disponible(p_fechas date[], p_quitar boolean default false)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_n integer;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_fechas is null or cardinality(p_fechas) = 0 then return 0; end if;
  if cardinality(p_fechas) > 62 then raise exception 'demasiados_dias'; end if;
  if exists (select 1 from unnest(p_fechas) d where d is null or d < public.hoy_mvd() or d > public.hoy_mvd() + 90) then
    raise exception 'fecha_fuera_de_rango';
  end if;
  if coalesce(p_quitar, false) then
    delete from public.ninera_no_disponible where ninera_id = v_yo and fecha = any (p_fechas);
  else
    insert into public.ninera_no_disponible (ninera_id, fecha)
    select v_yo, d from (select distinct unnest(p_fechas) as d) x
    on conflict do nothing;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;
revoke execute on function public.ninera_marcar_no_disponible(date[], boolean) from public, anon;
grant execute on function public.ninera_marcar_no_disponible(date[], boolean) to authenticated;

-- ---- Lo que el panel necesita para ordenar las sugeridas ----
-- Una sola lectura en lugar de bajar toda la historia de sittings (lo que hacía "Asignar niñera").
-- Invoker a propósito: corre con la RLS de quien llama (una admin ve todo; una niñera, nada).
-- 204 de 641 registros no tienen ninera_id y 315 no tienen familia_id (31/10/2026): el historial
-- se agrupa por id y, sin id, por el nombre normalizado (ninera_clave); el panel lo cruza con su
-- lista. La familia del pedido se reconoce por id o, en los registros sin id, por el nombre.
-- Devuelve {"historial": [{ninera_id, ninera_clave, veces_familia, total, veces_familia_traslado,
--                          total_traslado, semana, edades, max_chicos}],
--           "por_ninera": [{ninera_id, no_puedo_seguidos, incidente_familia, no_disponible}]}.
--   veces_familia: sittings con esa familia; total: sittings en general; veces_familia_traslado y
--   total_traslado: lo mismo con los traslados ("Elegir niñeras" también se usa para un traslado, y
--   ahí cuenta quién ya los hace; el panel elige según el tipo del pedido); semana: los sittings que
--   tiene de lunes a domingo de la semana del pedido (previstos incluidos); edades:
--   las edades (al día del sitting) de los chicos que cuidó; max_chicos: la familia con más chicos
--   que cuidó. Sin cancelados; sin previstos salvo en semana.
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
               'no_disponible', exists (select 1 from public.ninera_no_disponible d where d.ninera_id = n.id and d.fecha = p_fecha)))
        from public.ninieras n
        left join respuestas rp on rp.ninera_id = n.id), '[]'::jsonb))
$function$;
revoke execute on function public.sugeridas_datos(uuid, text, date) from public, anon;
grant execute on function public.sugeridas_datos(uuid, text, date) to authenticated;

-- ---- Aviso "Pedido nuevo" a las otras admins ----
-- Cuando un pedido pegado de WhatsApp pasa a la Agenda (el panel le pone solicitud_id), les llega a
-- las demás admins (no a la que lo pegó: datos.excepto, como el chat). Catálogo de avisos,
-- admin:pedido:<sol>:nuevo.
create or replace function public.pedidos_whatsapp_aviso_nuevo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s public.solicitudes;
begin
  select * into v_s from public.solicitudes where id = new.solicitud_id;
  if found then
    perform public.encolar_aviso('admin:pedido:' || v_s.id || ':nuevo', null, 'todas', 'pedidos',
      'Pedido nuevo de ' || v_s.familia_nombre,
      public.dia_corto_texto(v_s.fecha) || ', ' || to_char(v_s.hora_inicio, 'HH24:MI')
        || coalesce(' a ' || to_char(v_s.hora_fin, 'HH24:MI'), '') || '. Revisalo.',
      '?ir=agenda&solicitud=' || v_s.id,
      jsonb_build_object('solicitud_id', v_s.id, 'excepto', new.creado_por));
  end if;
  return null;
end
$function$;
revoke execute on function public.pedidos_whatsapp_aviso_nuevo() from public, anon, authenticated;
create trigger pedidos_whatsapp_aviso_nuevo after update of solicitud_id on public.pedidos_whatsapp
  for each row when (old.solicitud_id is null and new.solicitud_id is not null)
  execute function public.pedidos_whatsapp_aviso_nuevo();

commit;
