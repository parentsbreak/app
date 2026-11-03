-- ============================================================================
-- Migración 02/11/2026 (fase 1, etapa 8): la ficha de la familia y los avisos de cambios y cancelaciones.
--
-- La niñera completa con los padres la ficha de la familia (los 18 datos y las 6 casillas de la guía original)
-- y la siguiente la ve desde que queda confirmada hasta el fin de su sitting (decisiones.md 6.5). Cuando una admin
-- cambia un sitting que todavía no empezó, a la niñera con app le llega el aviso: se canceló, ya no va (cambio de
-- niñera), tiene uno nuevo o cambió el horario (con "Ok" / "A esa hora no puedo"). Un fijo que cambia desde una
-- fecha, se pausa o termina manda un solo aviso resumido, no uno por día (Diego, 02/11/2026).
--
-- Suma:
--   - fichas_familia y cambios_horario (la niñera lee lo suyo y escribe solo por sus funciones; las admins leen);
--   - funciones de la niñera: ninera_guardar_ficha_familia, ninera_ficha_familia, ninera_mis_cambios,
--     ninera_responder_cambio;
--   - avisos: triggers por sentencia sobre sittings_traslados (sittings_avisos_cambios) y el resumen de los fijos
--     (avisar_cambios_previstos, al final de generar_previstos_fijos);
--   - cambia: generar_previstos_fijos (solo marca la transacción y llama al resumen; la plata no se toca) y
--     solicitudes_al_cancelar (un pedido ya asignado que se cancela cancela también el registro de la elegida en
--     $0, si no está cobrado ni pagado: le llega el aviso en la misma transacción).
--
-- Solo sittings (los traslados, en la etapa 10), solo si no empezó, solo a niñeras activas con app y, con
-- app_config 'pedidos_app'.solo_practica prendido, solo los de práctica (pedido_puede_avisar). Un aviso nunca
-- frena un guardado: si algo falla al avisar, queda un warning en el log de la base y el cambio se guarda igual.
-- La familia va como la ve la niñera en el resto de la app (madre_nombre_inicial): nunca el apellido completo.
--
-- Compatible con la app publicada: tablas y funciones nuevas, y las dos que cambian hacen lo mismo de antes más lo
-- nuevo. No modifica datos: no hace falta respaldo. Se deshace con 20261107_ficha_cambios_DESHACER.sql.
-- ============================================================================
begin;

-- ---- La ficha de la familia (decisiones 6.5) ----
-- Una por sitting (la niñera la puede corregir hasta el fin del día siguiente); datos: los campos de la ficha de
-- la guía original (la familia, la fecha y la niñera las pone la base: son las del sitting). Si el sitting se
-- borra, la ficha queda (es de la familia).
create table public.fichas_familia (
  id uuid default gen_random_uuid() not null,
  familia_id uuid not null references public.familias(id) on delete cascade,
  sitting_id uuid references public.sittings_traslados(id) on delete set null,
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  datos jsonb not null,
  creada_en timestamp with time zone default now() not null,
  actualizada_en timestamp with time zone default now() not null,
  constraint fichas_familia_pkey primary key (id),
  constraint fichas_familia_sitting_key unique (sitting_id),
  constraint fichas_familia_datos_check check (jsonb_typeof(datos) = 'object')
);
create index fichas_familia_familia on public.fichas_familia (familia_id, actualizada_en desc);

-- Los cambios de horario avisados y lo que respondió la niñera ("Ok" / "A esa hora no puedo"). Uno por aviso: de
-- un día (sitting_id) o de un fijo desde una fecha (es_fijo, sin sitting_id).
create table public.cambios_horario (
  id uuid default gen_random_uuid() not null,
  ninera_id uuid not null references public.ninieras(id) on delete cascade,
  familia_id uuid references public.familias(id) on delete cascade,
  familia_nombre text,
  sitting_id uuid references public.sittings_traslados(id) on delete cascade,
  solicitud_id uuid,
  es_fijo boolean default false not null,
  desde date not null,
  hora_inicio time without time zone,
  hora_fin time without time zone,
  termina_dia_siguiente boolean default false not null,
  creado_en timestamp with time zone default now() not null,
  respuesta boolean,
  respondido_en timestamp with time zone,
  constraint cambios_horario_pkey primary key (id)
);
create index cambios_horario_ninera on public.cambios_horario (ninera_id, creado_en desc);

alter table public.fichas_familia enable row level security;
alter table public.cambios_horario enable row level security;
create policy fichas_familia_admins_leer on public.fichas_familia as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
create policy cambios_horario_propio on public.cambios_horario as permissive for select to authenticated
  using (ninera_id = (select public.ninera_actual()));
create policy cambios_horario_admins_leer on public.cambios_horario as permissive for select to public
  using ((select public.es_usuaria_autorizada()));
-- La niñera no lee fichas_familia directo (tiene teléfonos de otras familias): solo por ninera_ficha_familia.
-- Nadie escribe directo: la niñera, con sus funciones; los avisos, la base.
revoke insert, update, delete on public.fichas_familia, public.cambios_horario from anon, authenticated;

-- Los campos de la ficha (el orden de la guía original): 15 textos y 6 casillas.
create or replace function public.ficha_familia_campos()
returns table (clave text, es_casilla boolean)
language sql
immutable
set search_path to ''
as $function$
  select * from (values
    ('direccion', false), ('chicos', false), ('tel_madre', false), ('tel_padre', false), ('otro_adulto', false),
    ('emergencia', false), ('mutualista', false), ('alergias', false), ('medicacion', false), ('salud', false),
    ('comidas', false), ('sueno', false), ('reglas', false), ('retira', false), ('otros', false),
    ('c_botiquin', true), ('c_llaves', true), ('c_linterna', true), ('c_telefonos', true), ('c_medicacion', true),
    ('c_adrenalina', true)) as c(clave, es_casilla)
$function$;
revoke execute on function public.ficha_familia_campos() from public, anon, authenticated;

-- Guardar (o corregir) la ficha de su sitting: de hoy o de ayer, suyo, confirmado y no cancelado. Solo los campos
-- de la ficha (los textos hasta 1.000 caracteres; las casillas true / false); lo vacío no se guarda.
create or replace function public.ninera_guardar_ficha_familia(p_sitting_id uuid, p_datos jsonb)
returns timestamp with time zone
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_s public.sittings_traslados;
  v_datos jsonb := '{}'::jsonb;
  v_c record;
  v_valor jsonb;
  v_en timestamp with time zone;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then raise exception 'ficha_invalida'; end if;
  if exists (select 1 from jsonb_object_keys(p_datos) k where k not in (select clave from public.ficha_familia_campos())) then
    raise exception 'ficha_invalida';
  end if;
  select * into v_s from public.sittings_traslados s
   where s.id = p_sitting_id and s.ninera_id = v_yo and s.tipo = 'sitting' and not s.cancelado and s.estado = 'confirmado'
     and s.fecha between public.hoy_mvd() - 1 and public.hoy_mvd();
  if not found or v_s.familia_id is null then raise exception 'no_existe'; end if;
  for v_c in select * from public.ficha_familia_campos() loop
    v_valor := p_datos -> v_c.clave;
    if v_valor is null or v_valor = 'null'::jsonb then continue; end if;
    if v_c.es_casilla then
      if jsonb_typeof(v_valor) <> 'boolean' then raise exception 'ficha_invalida'; end if;
      if v_valor = 'true'::jsonb then v_datos := v_datos || jsonb_build_object(v_c.clave, true); end if;
    else
      if jsonb_typeof(v_valor) <> 'string' then raise exception 'ficha_invalida'; end if;
      if char_length(btrim(v_valor #>> '{}')) > 1000 then raise exception 'texto_largo'; end if;
      if btrim(v_valor #>> '{}') <> '' then v_datos := v_datos || jsonb_build_object(v_c.clave, btrim(v_valor #>> '{}')); end if;
    end if;
  end loop;
  insert into public.fichas_familia (familia_id, sitting_id, ninera_id, datos)
  values (v_s.familia_id, v_s.id, v_yo, v_datos)
  on conflict (sitting_id) do update set datos = excluded.datos, actualizada_en = now()
  returning actualizada_en into v_en;
  return v_en;
end
$function$;
revoke execute on function public.ninera_guardar_ficha_familia(uuid, jsonb) from public, anon;
grant execute on function public.ninera_guardar_ficha_familia(uuid, jsonb) to authenticated;

-- La última ficha de la familia de su sitting (de cualquier niñera, sin decir cuál: datos de otras niñeras no) y
-- si es la suya de ese sitting. Solo mientras el sitting es suyo (previsto o confirmado, no cancelado) y no
-- terminó: desde que queda confirmada hasta el fin de su sitting (sin hora de fin, hasta el fin de ese día).
-- Después, hasta el día siguiente, solo la suya de ese sitting. Vacío si no hay ficha o no corresponde.
create or replace function public.ninera_ficha_familia(p_sitting_id uuid)
returns table (datos jsonb, actualizada_en timestamp with time zone, es_de_este_sitting boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_s public.sittings_traslados;
  v_fin timestamp with time zone;
begin
  if v_yo is null then return; end if;
  select * into v_s from public.sittings_traslados s
   where s.id = p_sitting_id and s.ninera_id = v_yo and s.tipo = 'sitting' and not s.cancelado
     and s.estado in ('previsto', 'confirmado');
  if not found or v_s.familia_id is null then return; end if;
  v_fin := case when v_s.hora_fin is not null
                then ((v_s.fecha + case when v_s.termina_dia_siguiente then 1 else 0 end) + v_s.hora_fin) at time zone 'America/Montevideo'
                else (v_s.fecha + 1)::timestamp at time zone 'America/Montevideo' end;
  -- Hasta el fin de su sitting: la última de la familia (la suya de este sitting primero).
  if now() < v_fin then
    return query
      select f.datos, f.actualizada_en, f.sitting_id is not distinct from v_s.id
        from public.fichas_familia f
       where f.familia_id = v_s.familia_id
       order by (f.sitting_id is not distinct from v_s.id) desc, f.actualizada_en desc
       limit 1;
    return;
  end if;
  -- Ya terminó: solo la suya de este sitting, hasta el día siguiente (para corregirla), y nunca la de otra niñera.
  if v_s.fecha >= public.hoy_mvd() - 1 then
    return query
      select f.datos, f.actualizada_en, true from public.fichas_familia f where f.sitting_id = v_s.id and f.ninera_id = v_yo;
  end if;
end
$function$;
revoke execute on function public.ninera_ficha_familia(uuid) from public, anon;
grant execute on function public.ninera_ficha_familia(uuid) to authenticated;

-- ---- Avisos de cambios y cancelaciones (textos.md 1; los nuevos, en textos-provisorios.md) ----

-- Si se le puede avisar de un sitting a esta niñera: activa, con app y, con solo_practica prendido, solo si la
-- familia y la niñera son de práctica (pedido_puede_avisar). Interna.
create or replace function public.sitting_puede_avisar(p_ninera_id uuid, p_familia_id uuid, p_familia_nombre text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.ninieras n
                  where n.id = p_ninera_id and n.activa and n.user_id is not null
                    and public.pedido_puede_avisar(p_familia_id, p_familia_nombre, n.nombre))
$function$;
revoke execute on function public.sitting_puede_avisar(uuid, uuid, text) from public, anon, authenticated;

-- "de 16:00 a 19:00", "de 22:00 a 02:00 del día siguiente", "desde las 16:00".
create or replace function public.horario_texto(p_hi time without time zone, p_hf time without time zone, p_termina boolean)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case when p_hi is null then 'sin horario'
              when p_hf is null then 'desde las ' || to_char(p_hi, 'HH24:MI')
              else 'de ' || to_char(p_hi, 'HH24:MI') || ' a ' || to_char(p_hf, 'HH24:MI')
                   || case when p_termina then ' del día siguiente' else '' end end
$function$;
revoke execute on function public.horario_texto(time without time zone, time without time zone, boolean) from public, anon, authenticated;

-- El aviso de un sitting a una niñera (uno por día). p_tipo:
--   cancelado  "Se canceló tu sitting del [día]" / "Con [madre]. Si tienes dudas, escríbenos." (textos.md 1)
--   sin        "Ya no vas al sitting del [día]" / "El equipo hizo un cambio. Si tienes dudas, escríbenos."
--   nuevo      "Tienes un sitting el [día]" / "[hora], en [zona]. Mira los datos en la app." Si sale de un pedido y
--              ya tiene su fila confirmada, no: le llegó "¡Quedaste seleccionada!".
--   cambio     "Cambió el horario de tu sitting del [día]" / "Ahora es de [hi] a [hf]. Mira los detalles.", con su
--              fila en cambios_horario para "Ok" / "A esa hora no puedo" (#cambio/<id>).
-- Solo si el sitting (el de antes para cancelado y sin, el nuevo para nuevo y cambio) todavía no empezó. Las claves de
-- cancelado, sin y nuevo llevan el número de la transacción (reactivar y volver a cancelar es un hecho nuevo); la del
-- cambio, el horario nuevo (el mismo cambio no se repite). Interna.
create or replace function public.aviso_sitting_ninera(p_tipo text, p_sitting_id uuid, p_ninera_id uuid, p_familia_id uuid,
  p_familia_nombre text, p_fecha date, p_hi time without time zone, p_hf time without time zone, p_termina boolean,
  p_solicitud_id uuid default null, p_fecha_antes date default null)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_madre text;
  v_zona text;
  v_dia text := public.dia_corto_texto(p_fecha);
  v_cambio uuid;
  v_datos jsonb := jsonb_build_object('sitting_id', p_sitting_id);
begin
  if p_ninera_id is null or p_fecha is null then return; end if;
  if ((p_fecha + coalesce(p_hi, '00:00'::time)) at time zone 'America/Montevideo') <= now() then return; end if;
  if not public.sitting_puede_avisar(p_ninera_id, p_familia_id, p_familia_nombre) then return; end if;
  select public.madre_nombre_inicial(coalesce(f.nombre, p_familia_nombre)), nullif(btrim(f.zona), '')
    into v_madre, v_zona from (select 1) x left join public.familias f on f.id = p_familia_id;
  if p_tipo = 'cancelado' then
    perform public.encolar_aviso('sitting:' || p_sitting_id || ':cancelado:' || txid_current(), p_ninera_id, null, 'sitting',
      'Se canceló tu sitting del ' || v_dia, 'Con ' || rtrim(v_madre, '.') || '. Si tienes dudas, escríbenos.', '#inicio', v_datos);
  elsif p_tipo = 'sin' then
    perform public.encolar_aviso('sitting:' || p_sitting_id || ':sin:' || p_ninera_id || ':' || txid_current(), p_ninera_id, null, 'sitting',
      'Ya no vas al sitting del ' || v_dia, 'El equipo hizo un cambio. Si tienes dudas, escríbenos.', '#inicio', v_datos);
  elsif p_tipo = 'nuevo' then
    if p_solicitud_id is not null and exists (select 1 from public.solicitud_ninieras sn
         where sn.solicitud_id = p_solicitud_id and sn.ninera_id = p_ninera_id and sn.estado = 'confirmada') then
      return;
    end if;
    perform public.encolar_aviso('sitting:' || p_sitting_id || ':nuevo:' || p_ninera_id || ':' || txid_current(), p_ninera_id, null, 'sitting',
      'Tienes un sitting el ' || v_dia,
      coalesce(to_char(p_hi, 'HH24:MI'), 'Sin horario') || coalesce(', en ' || v_zona, '') || '. Mira los datos en la app.',
      '#inicio', v_datos);
  elsif p_tipo = 'cambio' then
    v_cambio := gen_random_uuid();
    if public.encolar_aviso('sitting:' || p_sitting_id || ':cambio:' || p_fecha || ':' || coalesce(to_char(p_hi, 'HH24MI'), '') || '-'
           || coalesce(to_char(p_hf, 'HH24MI'), '') || case when p_termina then 'd' else '' end,
         p_ninera_id, null, 'sitting',
         'Cambió el horario de tu sitting del ' || public.dia_corto_texto(coalesce(p_fecha_antes, p_fecha)),
         'Ahora es ' || case when p_fecha_antes is not null and p_fecha_antes <> p_fecha then 'el ' || v_dia || ', ' else '' end
           || public.horario_texto(p_hi, p_hf, p_termina) || '. Mira los detalles.',
         '#cambio/' || v_cambio, v_datos || jsonb_build_object('cambio_id', v_cambio)) then
      insert into public.cambios_horario (id, ninera_id, familia_id, familia_nombre, sitting_id, solicitud_id, es_fijo, desde,
                                          hora_inicio, hora_fin, termina_dia_siguiente)
      values (v_cambio, p_ninera_id, p_familia_id, p_familia_nombre, p_sitting_id, p_solicitud_id, false, p_fecha, p_hi, p_hf, coalesce(p_termina, false));
    end if;
  end if;
end
$function$;
revoke execute on function public.aviso_sitting_ninera(text, uuid, uuid, uuid, text, date, time without time zone, time without time zone, boolean, uuid, date) from public, anon, authenticated;

-- Los triggers (uno por sentencia: lo que tocó la sentencia entera en old / new table). Mientras corre
-- generar_previstos_fijos (pb.previstos = '1') no avisa: anota en una tabla temporal y avisar_cambios_previstos
-- manda el resumen por fijo al final. Si no, por fila:
--   update: se canceló → cancelado; se reactivó → nuevo; cambió la niñera → sin a la de antes y nuevo a la nueva;
--           cambió el día o el horario → cambio;
--   insert: un sitting puntual nuevo (sin asignacion_id; los días de un fijo los carga la base) → nuevo;
--   delete: se borró un sitting que no estaba cancelado → cancelado.
create or replace function public.sittings_avisos_cambios()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  begin
    if coalesce(current_setting('pb.previstos', true), '') = '1' then
      create temporary table if not exists _pb_cambios_previstos (
        accion text, id uuid, fecha date, tipo text, cancelado boolean, ninera_id uuid, ninera_nombre text,
        familia_id uuid, familia_nombre text, asignacion_id uuid, hora_inicio time without time zone,
        hora_fin time without time zone, termina_dia_siguiente boolean) on commit drop;
      if tg_op in ('UPDATE', 'DELETE') then
        insert into _pb_cambios_previstos
          select 'antes', o.id, o.fecha, o.tipo, o.cancelado, o.ninera_id, o.ninera_nombre, o.familia_id, o.familia_nombre,
                 o.asignacion_id, o.hora_inicio, o.hora_fin, o.termina_dia_siguiente from viejas o;
      end if;
      if tg_op in ('UPDATE', 'INSERT') then
        insert into _pb_cambios_previstos
          select 'despues', n.id, n.fecha, n.tipo, n.cancelado, n.ninera_id, n.ninera_nombre, n.familia_id, n.familia_nombre,
                 n.asignacion_id, n.hora_inicio, n.hora_fin, n.termina_dia_siguiente from nuevas n;
      end if;
      return null;
    end if;

    if tg_op = 'UPDATE' then
      for r in
        select o.id, o.fecha as f0, n.fecha as f1, o.cancelado as c0, n.cancelado as c1, o.ninera_id as n0, n.ninera_id as n1,
               o.hora_inicio as hi0, n.hora_inicio as hi1, o.hora_fin as hf0, n.hora_fin as hf1,
               o.termina_dia_siguiente as t0, n.termina_dia_siguiente as t1, n.familia_id, n.familia_nombre, n.solicitud_id
          from viejas o join nuevas n on n.id = o.id
         where n.tipo = 'sitting'
           and (o.cancelado, o.ninera_id, o.fecha, o.hora_inicio, o.hora_fin, o.termina_dia_siguiente)
               is distinct from (n.cancelado, n.ninera_id, n.fecha, n.hora_inicio, n.hora_fin, n.termina_dia_siguiente)
      loop
        if not r.c0 and r.c1 then
          perform public.aviso_sitting_ninera('cancelado', r.id, r.n0, r.familia_id, r.familia_nombre, r.f0, r.hi0, r.hf0, r.t0);
        elsif r.c0 and not r.c1 then
          perform public.aviso_sitting_ninera('nuevo', r.id, r.n1, r.familia_id, r.familia_nombre, r.f1, r.hi1, r.hf1, r.t1, r.solicitud_id);
        elsif not r.c1 and r.n0 is distinct from r.n1 then
          perform public.aviso_sitting_ninera('sin', r.id, r.n0, r.familia_id, r.familia_nombre, r.f0, r.hi0, r.hf0, r.t0);
          perform public.aviso_sitting_ninera('nuevo', r.id, r.n1, r.familia_id, r.familia_nombre, r.f1, r.hi1, r.hf1, r.t1, r.solicitud_id);
        elsif not r.c1 then
          perform public.aviso_sitting_ninera('cambio', r.id, r.n1, r.familia_id, r.familia_nombre, r.f1, r.hi1, r.hf1, r.t1, r.solicitud_id, r.f0);
        end if;
      end loop;
    elsif tg_op = 'INSERT' then
      for r in select * from nuevas n where n.tipo = 'sitting' and not n.cancelado and n.asignacion_id is null loop
        perform public.aviso_sitting_ninera('nuevo', r.id, r.ninera_id, r.familia_id, r.familia_nombre, r.fecha, r.hora_inicio, r.hora_fin,
          r.termina_dia_siguiente, r.solicitud_id);
      end loop;
    elsif tg_op = 'DELETE' then
      for r in select * from viejas o where o.tipo = 'sitting' and not o.cancelado loop
        perform public.aviso_sitting_ninera('cancelado', r.id, r.ninera_id, r.familia_id, r.familia_nombre, r.fecha, r.hora_inicio, r.hora_fin,
          r.termina_dia_siguiente);
      end loop;
    end if;
  exception when others then
    -- Un aviso nunca frena un guardado (plata, Agenda, fijos): queda en el log de la base.
    raise warning 'sittings_avisos_cambios: %', sqlerrm;
  end;
  return null;
end
$function$;
revoke execute on function public.sittings_avisos_cambios() from public, anon, authenticated;
create trigger sittings_avisos_insert after insert on public.sittings_traslados
  referencing new table as nuevas for each statement execute function public.sittings_avisos_cambios();
create trigger sittings_avisos_update after update on public.sittings_traslados
  referencing old table as viejas new table as nuevas for each statement execute function public.sittings_avisos_cambios();
create trigger sittings_avisos_delete after delete on public.sittings_traslados
  referencing old table as viejas for each statement execute function public.sittings_avisos_cambios();

-- El resumen de los fijos (Diego, 02/11/2026): lo que generar_previstos_fijos cambió en los días previstos (después
-- de hoy), comparado por niñera y familia, día por día (un cambio "desde una fecha" cierra el fijo y abre otro: los
-- días del viejo se borran y los del nuevo se crean). Un aviso por fijo, no uno por día:
--   mismo día antes y después con otro horario → "Cambió el horario de tu fijo con [madre]" / "Desde el [día], de
--     [hi] a [hf]. Mira los detalles." (con su fila en cambios_horario para responder);
--   días que estaban y ya no: con una pausa → "Tu fijo con [madre] se pausa" / "Del [día] al [día]. Si tienes
--     dudas, escríbenos."; si esos días pasaron a otra niñera → "Ya no vas al fijo con [madre] desde el [día]" / "El
--     equipo hizo un cambio. Si tienes dudas, escríbenos."; si el fijo terminó → "Tu fijo con [madre] termina el
--     [día]" / "Si tienes dudas, escríbenos."; si no, cambiaron los días;
--   días nuevos: si no tenía ningún día de un fijo con esa familia → "Tienes un fijo nuevo con [madre]" / "Desde el
--     [día], a las [hi], en [zona]. Mira los datos en la app."; los que se suman al final de la ventana (la corrida de
--     cada noche) no cuentan; otros → "Cambiaron los días de tu fijo con [madre]" / "Mira tus próximos sittings en la
--     app.".
-- La clave lleva el número de la transacción: cada corrida es un hecho nuevo. Interna; un error no frena nada.
create or replace function public.avisar_cambios_previstos(p_hoy date)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  g record;
  v_total integer := 0;
  v_madre text;
  v_zona text;
  v_clave text;
  v_cambio uuid;
  v_titulo text;
  v_cuerpo text;
  v_pausa record;
  v_termina date;
  v_max date;
  v_dias boolean;
begin
  if to_regclass('pg_temp._pb_cambios_previstos') is null then return 0; end if;
  begin
    for g in
      with c as (
        select * from _pb_cambios_previstos
         where coalesce(tipo, 'sitting') = 'sitting' and not coalesce(cancelado, false) and fecha > p_hoy and ninera_id is not null
      ), a as (
        select distinct on (ninera_id, familia_id, fecha) * from c where accion = 'antes' order by ninera_id, familia_id, fecha, hora_inicio
      ), d as (
        select distinct on (ninera_id, familia_id, fecha) * from c where accion = 'despues' order by ninera_id, familia_id, fecha, hora_inicio
      ), pares as (
        select coalesce(a.ninera_id, d.ninera_id) as ninera_id, coalesce(a.familia_id, d.familia_id) as familia_id,
               coalesce(d.familia_nombre, a.familia_nombre) as familia_nombre, coalesce(a.fecha, d.fecha) as fecha,
               a.id is not null as habia, d.id is not null as hay,
               a.id is not null and d.id is not null
                 and (a.hora_inicio, a.hora_fin, a.termina_dia_siguiente) is distinct from (d.hora_inicio, d.hora_fin, d.termina_dia_siguiente) as cambio,
               d.hora_inicio, d.hora_fin, d.termina_dia_siguiente
          from a full join d on d.ninera_id = a.ninera_id and d.familia_id is not distinct from a.familia_id and d.fecha = a.fecha
      )
      select p.ninera_id, p.familia_id, max(p.familia_nombre) as familia_nombre,
             min(p.fecha) filter (where p.cambio) as desde_cambio,
             min(p.fecha) filter (where p.habia and not p.hay) as desde_quita,
             max(p.fecha) filter (where p.habia and not p.hay) as hasta_quita,
             array_agg(p.fecha order by p.fecha) filter (where p.hay and not p.habia) as sumas
        from pares p
       where p.cambio or p.habia <> p.hay
       group by p.ninera_id, p.familia_id
    loop
      if not public.sitting_puede_avisar(g.ninera_id, g.familia_id, g.familia_nombre) then continue; end if;
      select public.madre_nombre_inicial(coalesce(f.nombre, g.familia_nombre)), nullif(btrim(f.zona), '')
        into v_madre, v_zona from (select 1) x left join public.familias f on f.id = g.familia_id;
      v_clave := 'fijo:' || coalesce(g.familia_id::text, '-') || ':' || g.ninera_id || ':';
      v_dias := false;

      if g.desde_cambio is not null then
        select * into v_pausa from _pb_cambios_previstos
         where accion = 'despues' and ninera_id = g.ninera_id and familia_id is not distinct from g.familia_id and fecha = g.desde_cambio
         order by hora_inicio limit 1;
        v_cambio := gen_random_uuid();
        if public.encolar_aviso(v_clave || 'horario:' || txid_current(), g.ninera_id, null, 'sitting',
             'Cambió el horario de tu fijo con ' || v_madre,
             'Desde el ' || public.dia_corto_texto(g.desde_cambio) || ', ' || public.horario_texto(v_pausa.hora_inicio, v_pausa.hora_fin, v_pausa.termina_dia_siguiente)
               || '. Mira los detalles.',
             '#cambio/' || v_cambio, jsonb_build_object('cambio_id', v_cambio)) then
          insert into public.cambios_horario (id, ninera_id, familia_id, familia_nombre, es_fijo, desde, hora_inicio, hora_fin, termina_dia_siguiente)
          values (v_cambio, g.ninera_id, g.familia_id, g.familia_nombre, true, g.desde_cambio, v_pausa.hora_inicio, v_pausa.hora_fin,
                  coalesce(v_pausa.termina_dia_siguiente, false));
          v_total := v_total + 1;
        end if;
      end if;

      if g.desde_quita is not null then
        select p.desde, p.hasta into v_pausa from public.asignaciones_pausas p join public.asignaciones a on a.id = p.asignacion_id
         where a.ninera_id = g.ninera_id and a.familia_id is not distinct from g.familia_id and g.desde_quita between p.desde and p.hasta
         order by p.created_at desc limit 1;
        if found then
          v_titulo := 'Tu fijo con ' || v_madre || ' se pausa';
          v_cuerpo := 'Del ' || public.dia_corto_texto(greatest(v_pausa.desde, g.desde_quita)) || ' al ' || public.dia_corto_texto(v_pausa.hasta)
                      || '. Si tienes dudas, escríbenos.';
        elsif exists (select 1 from _pb_cambios_previstos x
                       where x.accion = 'despues' and x.familia_id is not distinct from g.familia_id and x.ninera_id is distinct from g.ninera_id
                         and x.fecha between g.desde_quita and g.hasta_quita and not coalesce(x.cancelado, false)) then
          v_titulo := 'Ya no vas al fijo con ' || v_madre || ' desde el ' || public.dia_corto_texto(g.desde_quita);
          v_cuerpo := 'El equipo hizo un cambio. Si tienes dudas, escríbenos.';
        elsif not exists (select 1 from public.asignaciones a
                           where a.ninera_id = g.ninera_id and a.familia_id is not distinct from g.familia_id
                             and (a.vigente_hasta is null or a.vigente_hasta >= g.desde_quita)) then
          select max(a.vigente_hasta) into v_termina from public.asignaciones a
           where a.ninera_id = g.ninera_id and a.familia_id is not distinct from g.familia_id;
          v_titulo := 'Tu fijo con ' || v_madre || ' termina el ' || public.dia_corto_texto(coalesce(v_termina, g.desde_quita - 1));
          v_cuerpo := 'Si tienes dudas, escríbenos.';
        else
          v_dias := true;
        end if;
        if not v_dias and public.encolar_aviso(v_clave || 'quita:' || txid_current(), g.ninera_id, null, 'sitting', v_titulo, v_cuerpo,
             '#inicio', jsonb_build_object('familia_id', g.familia_id)) then
          v_total := v_total + 1;
        end if;
      end if;

      if g.sumas is not null then
        if not exists (select 1 from public.sittings_traslados s
                        where s.ninera_id = g.ninera_id and s.familia_id is not distinct from g.familia_id and s.asignacion_id is not null
                          and s.id not in (select x.id from _pb_cambios_previstos x where x.accion = 'despues' and x.id is not null)) then
          select * into v_pausa from _pb_cambios_previstos
           where accion = 'despues' and ninera_id = g.ninera_id and familia_id is not distinct from g.familia_id and fecha = g.sumas[1]
           order by hora_inicio limit 1;
          if public.encolar_aviso(v_clave || 'nuevo:' || txid_current(), g.ninera_id, null, 'sitting',
               'Tienes un fijo nuevo con ' || v_madre,
               'Desde el ' || public.dia_corto_texto(g.sumas[1]) || ', a las ' || coalesce(to_char(v_pausa.hora_inicio, 'HH24:MI'), '-')
                 || coalesce(', en ' || v_zona, '') || '. Mira los datos en la app.',
               '#inicio', jsonb_build_object('familia_id', g.familia_id)) then
            v_total := v_total + 1;
          end if;
        else
          -- Lo que se suma al final de la ventana (la corrida de cada noche agrega un día) no es un cambio.
          select max(s.fecha) into v_max from public.sittings_traslados s
           where s.ninera_id = g.ninera_id and s.familia_id is not distinct from g.familia_id and s.asignacion_id is not null
             and s.id not in (select x.id from _pb_cambios_previstos x where x.accion = 'despues' and x.id is not null);
          if exists (select 1 from unnest(g.sumas) f where f < v_max) then v_dias := true; end if;
        end if;
      end if;

      if v_dias and public.encolar_aviso(v_clave || 'dias:' || txid_current(), g.ninera_id, null, 'sitting',
           'Cambiaron los días de tu fijo con ' || v_madre, 'Mira tus próximos sittings en la app.',
           '#inicio', jsonb_build_object('familia_id', g.familia_id)) then
        v_total := v_total + 1;
      end if;
    end loop;
  exception when others then
    raise warning 'avisar_cambios_previstos: %', sqlerrm;
  end;
  truncate _pb_cambios_previstos;
  return v_total;
end
$function$;
revoke execute on function public.avisar_cambios_previstos(date) from public, anon, authenticated;

-- ---- La respuesta al cambio de horario ----
-- Sus cambios sin responder, de hoy en adelante, para la tarjeta del inicio (#cambio/<id>). La familia como la ve en
-- el resto de la app. Vacío si no es niñera.
create or replace function public.ninera_mis_cambios()
returns table (id uuid, es_fijo boolean, desde date, hora_inicio time without time zone, hora_fin time without time zone,
               termina_dia_siguiente boolean, madre text, zona text, creado_en timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.id, c.es_fijo, c.desde, c.hora_inicio, c.hora_fin, c.termina_dia_siguiente,
         public.madre_nombre_inicial(coalesce(f.nombre, c.familia_nombre)), nullif(btrim(f.zona), ''), c.creado_en
    from public.cambios_horario c
    left join public.familias f on f.id = c.familia_id
   where c.ninera_id = (select public.ninera_actual()) and c.respuesta is null and c.desde >= public.hoy_mvd()
   order by c.creado_en
$function$;
revoke execute on function public.ninera_mis_cambios() from public, anon;
grant execute on function public.ninera_mis_cambios() to authenticated;

-- "Ok" (p_ok true) o "A esa hora no puedo" (false), una vez. "No puedo" avisa a las admins para buscar a otra; el
-- registro queda como está (decide una admin, decisiones 6.5). Un segundo toque devuelve la primera respuesta.
create or replace function public.ninera_responder_cambio(p_cambio_id uuid, p_ok boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := (select public.ninera_actual());
  v_c public.cambios_horario;
  v_nombre text;
begin
  if v_yo is null then raise exception 'no_autorizada'; end if;
  if p_ok is null then raise exception 'respuesta_invalida'; end if;
  select * into v_c from public.cambios_horario where id = p_cambio_id and ninera_id = v_yo for update;
  if not found then raise exception 'no_existe'; end if;
  if v_c.respuesta is not null then return v_c.respuesta; end if;
  update public.cambios_horario set respuesta = p_ok, respondido_en = now() where id = v_c.id;
  if not p_ok then
    select nombre into v_nombre from public.ninieras where id = v_yo;
    perform public.encolar_aviso('admin:cambio:' || v_c.id || ':no_puede', null, 'todas', 'el_dia',
      case when v_c.es_fijo then v_nombre || ' no puede el nuevo horario de su fijo con ' || coalesce(v_c.familia_nombre, 'la familia')
           else v_nombre || ' no puede el ' || public.dia_corto_texto(v_c.desde) || ' ' || public.horario_texto(v_c.hora_inicio, v_c.hora_fin, v_c.termina_dia_siguiente) end,
      case when v_c.es_fijo then 'Desde el ' || public.dia_corto_texto(v_c.desde) || ', ' || public.horario_texto(v_c.hora_inicio, v_c.hora_fin, v_c.termina_dia_siguiente) || '. Buscá a otra.'
           else 'Buscá a otra.' end,
      case when v_c.solicitud_id is not null then '?ir=agenda&solicitud=' || v_c.solicitud_id else '?ir=agenda' end,
      jsonb_build_object('cambio_id', v_c.id, 'ninera_id', v_yo, 'sitting_id', v_c.sitting_id));
  end if;
  return p_ok;
end
$function$;
revoke execute on function public.ninera_responder_cambio(uuid, boolean) from public, anon;
grant execute on function public.ninera_responder_cambio(uuid, boolean) to authenticated;

-- ---- Funciones que cambian ----
-- Se cancela el pedido (etapa 6, y desde la etapa 8 también uno ya asignado): las filas de la app abiertas pasan a
-- 'cancelado' y a las que dijeron "Puedo", "Se canceló el pedido del [día]" (como antes). La elegida (fila
-- 'confirmada') pasa a 'cancelado' y su registro de hoy en adelante, si no está cobrado ni pagado, queda cancelado en
-- $0: el trigger de sittings_traslados le manda "Se canceló tu sitting del [día]" (Diego, 02/11/2026; antes el panel
-- pedía avisarle por WhatsApp y cancelarlo a mano en Sittings).
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
  -- Ya asignado (etapa 8): la elegida y su registro.
  update public.solicitud_ninieras x set estado = 'cancelado' where x.solicitud_id = new.id and x.estado = 'confirmada';
  update public.sittings_traslados s
     set cancelado = true, cobro_familia = 0, pago_ninera = 0, cobrado = true, pagado = true, generado_automatico = false,
         notas = concat_ws(' — ', nullif(btrim(s.notas), ''), 'Pedido cancelado')
   where s.solicitud_id = new.id and not s.cancelado and not s.cobrado and not s.pagado and s.fecha >= public.hoy_mvd();
  return null;
end
$function$;
revoke execute on function public.solicitudes_al_cancelar() from public, anon, authenticated;

-- generar_previstos_fijos: igual que antes (20261101_previstos_precio_ninera.sql) salvo las dos marcas de la etapa 8:
-- desde el borrado de los previstos, lo que cambie lo anota sittings_avisos_cambios y al final sale el resumen.
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

  -- Etapa 8 (02/11/2026): de acá hasta el final, lo que cambie en los previstos no avisa fila por fila
  -- (sittings_avisos_cambios lo anota): al terminar, avisar_cambios_previstos manda un aviso resumido por fijo.
  perform set_config('pb.previstos', '1', true);

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

  perform set_config('pb.previstos', '', true);
  perform public.avisar_cambios_previstos(hoy);

  return jsonb_build_object('confirmados', n_confirmados, 'borrados', n_borrados,
                            'actualizados', n_actualizados, 'creados', n_creados, 'hoy', hoy);
end;
$function$;
revoke execute on function public.generar_previstos_fijos(integer) from public, anon;
grant execute on function public.generar_previstos_fijos(integer) to authenticated;

commit;
