-- ============================================================================
-- Prueba de 20261109_traslados_app.sql en un Postgres LOCAL (nunca en producción): los pedidos de traslado por la app
-- de niñeras (decisiones.md 6.9). enviar_pedido_app con un traslado (origen, destino, zonas, a quién: hace traslados,
-- carsitting aprobado y guía; el aviso con "Precio: $X por viaje"), lo que lee la niñera (zonas antes, direcciones
-- recién confirmada, nunca el cobro), "Puedo", el recordatorio, "¡Quedaste seleccionada!" y "Este traslado ya quedó
-- cubierto", los avisos por día de un traslado (nuevo, cambio de la hora de salida con su fila, "Ya no vas",
-- cancelado), los recordatorios de 24 h y 1 h (sin "no marcó que llegó" ni el cierre), el resumen de los fijos de
-- traslado (aparte de los de sitting) y solo_practica. Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_traslados.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261109_traslados_app.sql \
--     --migracion supabase/migraciones/20261109_traslados_app_DESHACER.sql \
--     --migracion supabase/migraciones/20261109_traslados_app.sql supabase/pruebas/fase1_traslados.sql
-- Los avisos de tiempo se prueban con p_ahora en fechas fijas (2030). Todo termina en rollback.
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;
-- El mensaje del error que tira la sentencia (con la pista, si tiene: "mensaje|pista"), o null si no falla.
create function pg_temp.error_de(sentencia text) returns text language plpgsql as $$
declare v_pista text;
begin
  execute sentencia;
  return null;
exception when others then
  get stacked diagnostics v_pista = pg_exception_hint;
  return sqlerrm || case when coalesce(v_pista, '') <> '' then '|' || v_pista else '' end;
end $$;
create function pg_temp.avisos_de(p_ninera uuid) returns text[] language sql as $$
  select coalesce(array_agg(titulo || ' | ' || coalesce(cuerpo, '') order by creado_en, clave), '{}')
    from public.avisos where para_ninera_id = p_ninera
$$;
create function pg_temp.dia(p date) returns text language sql as $$ select public.dia_corto_texto(p) $$;

-- ---------------------------------------------------------------------------
-- Está todo (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('columnas nuevas: solicitudes (4), solicitud_ninieras (1), pedidos_whatsapp (3), cambios_horario (1)',
  (select count(*) = 9 from information_schema.columns where table_schema = 'public'
    and ((table_name = 'solicitudes' and column_name in ('origen', 'destino', 'destino_zona', 'km'))
      or (table_name = 'solicitud_ninieras' and column_name = 'precio_viaje')
      or (table_name = 'pedidos_whatsapp' and column_name in ('origen', 'destino', 'destino_zona'))
      or (table_name = 'cambios_horario' and column_name = 'tipo'))));
select pg_temp.verificar('carsitting_aprobado es interna: ni authenticated ni anon',
  not has_function_privilege('authenticated', 'public.carsitting_aprobado(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.carsitting_aprobado(uuid)', 'execute'));
select pg_temp.verificar('aviso_sitting_ninera con p_servicio, interna; la firma vieja ya no está',
  not has_function_privilege('authenticated', 'public.aviso_sitting_ninera(text, uuid, uuid, uuid, text, date, time without time zone, time without time zone, boolean, uuid, date, text)', 'execute')
  and to_regprocedure('public.aviso_sitting_ninera(text, uuid, uuid, uuid, text, date, time without time zone, time without time zone, boolean, uuid, date)') is null);
select pg_temp.verificar('lo que lee la niñera: authenticated sí, anon no',
  has_function_privilege('authenticated', 'public.ninera_mis_pedidos()', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_mis_sittings()', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_mis_cambios()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_mis_pedidos()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_mis_sittings()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_mis_cambios()', 'execute'));
select pg_temp.verificar('ninera_mis_pedidos nunca devuelve direcciones, origen, destino, familia ni cobro',
  not exists (select 1 from pg_proc p, unnest(p.proargnames) a
               where p.oid = 'public.ninera_mis_pedidos'::regproc
                 and a in ('origen', 'destino', 'direccion', 'familia_nombre', 'familia_id', 'cobro_familia', 'pago_ninera', 'km', 'notas')));
select pg_temp.verificar('ninera_mis_sittings nunca devuelve plata del registro',
  not exists (select 1 from pg_proc p, unnest(p.proargnames) a
               where p.oid = 'public.ninera_mis_sittings'::regproc and a in ('cobro_familia', 'pago_ninera', 'km', 'notas')));
select pg_temp.verificar('los límites: km, largo de origen y destino, precio por viaje, tipo del cambio',
  pg_temp.error_de($$insert into solicitudes (familia_nombre, tipo, fecha, hora_inicio, km) values ('x', 'traslado', '2030-01-01', '08:00', 0)$$) like '%solicitudes_km_check%'
  and pg_temp.error_de(format('insert into solicitudes (familia_nombre, tipo, fecha, hora_inicio, origen) values (%L, %L, %L, %L, %L)',
        'x', 'traslado', '2030-01-01', '08:00', repeat('a', 301))) like '%solicitudes_origen_check%'
  and pg_temp.error_de(format('insert into pedidos_whatsapp (texto, destino) values (%L, %L)', 'x', repeat('a', 301))) like '%pedidos_whatsapp_destino_check%'
  and pg_temp.error_de($$insert into solicitud_ninieras (solicitud_id, ninera_nombre, precio_viaje) values (gen_random_uuid(), 'x', 0)$$) like '%precio_viaje_check%'
  and pg_temp.error_de($$insert into cambios_horario (ninera_id, desde, tipo) values (gen_random_uuid(), '2030-01-01', 'otro')$$) is not null);

-- ---------------------------------------------------------------------------
-- Datos inventados: una admin; Ana (solo sittings), Bruno (Ambas, carsitting aprobado), Carla (traslados, carsitting
-- enviado sin aprobar), Dora (traslados, sin app), Gaby (traslados, solo el formulario viejo), Hana (traslados,
-- aprobada y con una actualización en revisión), Iris (traslados, aprobada, sin la guía). Familia Prueba Uno con dos
-- chicos.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('b1100000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('b1100000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid'),
  ('b1100000-0000-4000-8000-000000000002', '59899000002@ninieras.parentsbreak.invalid'),
  ('b1100000-0000-4000-8000-000000000003', '59899000003@ninieras.parentsbreak.invalid'),
  ('b1100000-0000-4000-8000-000000000005', '59899000005@ninieras.parentsbreak.invalid'),
  ('b1100000-0000-4000-8000-000000000006', '59899000006@ninieras.parentsbreak.invalid'),
  ('b1100000-0000-4000-8000-000000000007', '59899000007@ninieras.parentsbreak.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('b1100000-0000-4000-8000-0000000000a1', 'desarrollo');
insert into ninieras (id, nombre, telefono, user_id, activa, zona, tipo) values
  ('b2100000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'b1100000-0000-4000-8000-000000000001', true, 'Pocitos', 'Niñera'),
  ('b2100000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', 'b1100000-0000-4000-8000-000000000002', true, 'Pocitos', 'Ambas'),
  ('b2100000-0000-4000-8000-000000000003', 'Carla Prueba', '099000003', 'b1100000-0000-4000-8000-000000000003', true, 'Pocitos', 'Traslados'),
  ('b2100000-0000-4000-8000-000000000004', 'Dora Sinapp', '099000004', null, true, 'Pocitos', 'Traslados'),
  ('b2100000-0000-4000-8000-000000000005', 'Gaby Formulario', '099000005', 'b1100000-0000-4000-8000-000000000005', true, 'Pocitos', 'Traslados'),
  ('b2100000-0000-4000-8000-000000000006', 'Hana Inventada', '099000006', 'b1100000-0000-4000-8000-000000000006', true, 'Pocitos', 'Traslados'),
  ('b2100000-0000-4000-8000-000000000007', 'Iris Singuia', '099000007', 'b1100000-0000-4000-8000-000000000007', true, 'Pocitos', 'Traslados');
insert into guia_firmas (ninera_id, version, nombre, firma_ruta)
select id, '2026.10', nombre, 'firmas/' || id || '/2026-10-01.png' from ninieras
 where user_id is not null and nombre <> 'Iris Singuia';
insert into carsitting_datos (ninera_id, ninera_nombre, nombre_completo, enviado_en, revision, aprobado_en) values
  ('b2100000-0000-4000-8000-000000000002', 'Bruno Ejemplo', 'Bruno Ejemplo', now() - interval '3 days', 'aprobado', now() - interval '2 days'),
  ('b2100000-0000-4000-8000-000000000003', 'Carla Prueba', 'Carla Prueba', now() - interval '1 day', 'pendiente', null),
  ('b2100000-0000-4000-8000-000000000005', 'Gaby Formulario', 'Gaby Formulario', null, null, null),
  ('b2100000-0000-4000-8000-000000000006', 'Hana Inventada', 'Hana Inventada', now() - interval '1 hour', 'pendiente', now() - interval '20 days'),
  ('b2100000-0000-4000-8000-000000000007', 'Iris Singuia', 'Iris Singuia', now() - interval '3 days', 'aprobado', now() - interval '2 days');
insert into familias (id, nombre, zona, cobro_hora, pago_hora, direccion) values
  ('b3100000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'Pocitos', 500, 250, 'Calle Inventada 123');
insert into hijos_familia (familia_id, nombre, edad_declarada, edad_declarada_en, orden) values
  ('b3100000-0000-4000-8000-000000000001', 'Uno', 4, public.hoy_mvd(), 0),
  ('b3100000-0000-4000-8000-000000000001', 'Dos', 7, public.hoy_mvd(), 1);
insert into solicitudes (id, familia_id, familia_nombre, tipo, zona, fecha, hora_inicio, hora_fin, estado, origen, destino, destino_zona, km) values
  -- el traslado de mañana: de la casa al colegio
  ('b4100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'traslado', 'Pocitos',
   public.hoy_mvd() + 1, '08:00', null, 'sin_asignar', 'Calle Inventada 123', 'Colegio Inventado 456', 'Carrasco', 12),
  -- sin origen
  ('b4100000-0000-4000-8000-000000000002', 'b3100000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'traslado', 'Pocitos',
   public.hoy_mvd() + 1, '17:00', null, 'sin_asignar', null, 'Colegio Inventado 456', 'Carrasco', null),
  -- sin la zona de origen
  ('b4100000-0000-4000-8000-000000000003', 'b3100000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'traslado', null,
   public.hoy_mvd() + 1, '17:00', null, 'sin_asignar', 'Colegio Inventado 456', 'Calle Inventada 123', 'Pocitos', null),
  -- un sitting, como siempre
  ('b4100000-0000-4000-8000-000000000004', 'b3100000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting', null,
   public.hoy_mvd() + 2, '10:00', '12:00', 'sin_asignar', null, null, null, null),
  -- otro traslado, para el todo o nada
  ('b4100000-0000-4000-8000-000000000005', 'b3100000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'traslado', 'Carrasco',
   public.hoy_mvd() + 1, '17:00', null, 'sin_asignar', 'Colegio Inventado 456', 'Calle Inventada 123', 'Pocitos', 12);

select pg_temp.verificar('carsitting_aprobado: aprobada, o aprobada con una actualización en revisión; no la pendiente ni la del formulario',
  public.carsitting_aprobado('b2100000-0000-4000-8000-000000000002') and public.carsitting_aprobado('b2100000-0000-4000-8000-000000000006')
  and not public.carsitting_aprobado('b2100000-0000-4000-8000-000000000003') and not public.carsitting_aprobado('b2100000-0000-4000-8000-000000000005')
  and not public.carsitting_aprobado('b2100000-0000-4000-8000-000000000004'));

-- ---------------------------------------------------------------------------
-- enviar_pedido_app con un traslado
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "b1100000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('con solo_practica prendido, un traslado real no sale',
  pg_temp.error_de($$select public.enviar_pedido_app('b4100000-0000-4000-8000-000000000001', '[{"ninera_id": "b2100000-0000-4000-8000-000000000002", "precio_viaje": 400}]')$$) = 'solo_practica');
reset role;
update app_config set valor = valor || '{"solo_practica": false}'::jsonb where id = 'pedidos_app';
set local role authenticated;
select pg_temp.verificar('sin origen o sin destino: sin_origen_destino',
  pg_temp.error_de($$select public.enviar_pedido_app('b4100000-0000-4000-8000-000000000002', '[{"ninera_id": "b2100000-0000-4000-8000-000000000002", "precio_viaje": 400}]')$$) = 'sin_origen_destino');
select pg_temp.verificar('sin una de las zonas: sin_zonas',
  pg_temp.error_de($$select public.enviar_pedido_app('b4100000-0000-4000-8000-000000000003', '[{"ninera_id": "b2100000-0000-4000-8000-000000000002", "precio_viaje": 400}]')$$) = 'sin_zonas');
select pg_temp.verificar('el precio de un traslado es por viaje: con precio_hora, precio_invalido',
  pg_temp.error_de($$select public.enviar_pedido_app('b4100000-0000-4000-8000-000000000001', '[{"ninera_id": "b2100000-0000-4000-8000-000000000002", "precio_hora": 400}]')$$) = 'precio_invalido|Bruno Ejemplo');
select pg_temp.verificar('una que no hace traslados: ninera_no_hace_traslados con su nombre',
  pg_temp.error_de($$select public.enviar_pedido_app('b4100000-0000-4000-8000-000000000001', '[{"ninera_id": "b2100000-0000-4000-8000-000000000001", "precio_viaje": 400}]')$$) = 'ninera_no_hace_traslados|Ana Ficticia');
select pg_temp.verificar('sin el carsitting aprobado (enviado sin revisar, o solo el formulario viejo): sin_carsitting con su nombre',
  pg_temp.error_de($$select public.enviar_pedido_app('b4100000-0000-4000-8000-000000000001', '[{"ninera_id": "b2100000-0000-4000-8000-000000000003", "precio_viaje": 400}]')$$) = 'sin_carsitting|Carla Prueba'
  and pg_temp.error_de($$select public.enviar_pedido_app('b4100000-0000-4000-8000-000000000001', '[{"ninera_id": "b2100000-0000-4000-8000-000000000005", "precio_viaje": 400}]')$$) = 'sin_carsitting|Gaby Formulario');
select pg_temp.verificar('sin app: ninera_sin_app; con el carsitting y sin la guía: ninera_sin_guia',
  pg_temp.error_de($$select public.enviar_pedido_app('b4100000-0000-4000-8000-000000000001', '[{"ninera_id": "b2100000-0000-4000-8000-000000000004", "precio_viaje": 400}]')$$) = 'ninera_sin_app|Dora Sinapp'
  and pg_temp.error_de($$select public.enviar_pedido_app('b4100000-0000-4000-8000-000000000001', '[{"ninera_id": "b2100000-0000-4000-8000-000000000007", "precio_viaje": 400}]')$$) = 'ninera_sin_guia|Iris Singuia');
select pg_temp.verificar('todo o nada: Bruno y Carla juntos, no le llega a ninguna',
  pg_temp.error_de($$select public.enviar_pedido_app('b4100000-0000-4000-8000-000000000005', '[{"ninera_id": "b2100000-0000-4000-8000-000000000002", "precio_viaje": 400}, {"ninera_id": "b2100000-0000-4000-8000-000000000003", "precio_viaje": 400}]')$$) = 'sin_carsitting|Carla Prueba');
reset role;
select pg_temp.verificar('todo o nada: ni filas ni avisos',
  not exists (select 1 from solicitud_ninieras where solicitud_id = 'b4100000-0000-4000-8000-000000000005')
  and not exists (select 1 from avisos)
  and (select estado = 'sin_asignar' from solicitudes where id = 'b4100000-0000-4000-8000-000000000005'));
set local role authenticated;
select pg_temp.verificar('un sitting sigue igual: la de solo traslados no, y el precio es por hora',
  pg_temp.error_de($$select public.enviar_pedido_app('b4100000-0000-4000-8000-000000000004', '[{"ninera_id": "b2100000-0000-4000-8000-000000000003", "precio_hora": 300}]')$$) = 'ninera_solo_traslados|Carla Prueba'
  and pg_temp.error_de($$select public.enviar_pedido_app('b4100000-0000-4000-8000-000000000004', '[{"ninera_id": "b2100000-0000-4000-8000-000000000002", "precio_viaje": 300}]')$$) = 'precio_invalido|Bruno Ejemplo');
select pg_temp.verificar('Bruno y Hana (aprobada con una actualización en revisión): a las dos',
  public.enviar_pedido_app('b4100000-0000-4000-8000-000000000001',
    '[{"ninera_id": "b2100000-0000-4000-8000-000000000002", "precio_viaje": 400}, {"ninera_id": "b2100000-0000-4000-8000-000000000006", "precio_viaje": 450}]') = 2);
reset role;
select pg_temp.verificar('las filas: origen app, invitada, el precio por viaje y sin precio por hora',
  (select count(*) = 2 and bool_and(origen = 'app' and estado = 'invitada' and precio_hora is null)
          and sum(precio_viaje) = 850
     from solicitud_ninieras where solicitud_id = 'b4100000-0000-4000-8000-000000000001')
  and (select estado = 'pendiente_confirmar' and responder_hasta is not null from solicitudes where id = 'b4100000-0000-4000-8000-000000000001'));
select pg_temp.verificar('el aviso: "Traslado [dd/mm]", la hora de salida, las dos zonas, los chicos y "Precio: $X por viaje" (sin direcciones)',
  pg_temp.avisos_de('b2100000-0000-4000-8000-000000000002') = array['Traslado ' || to_char(public.hoy_mvd() + 1, 'DD/MM') || ' | '
    || concat_ws(E'\n', 'A las 08:00', 'De Pocitos a Carrasco', public.chicos_texto('b3100000-0000-4000-8000-000000000001'), 'Precio: $400 por viaje')]
  and pg_temp.avisos_de('b2100000-0000-4000-8000-000000000006') = array['Traslado ' || to_char(public.hoy_mvd() + 1, 'DD/MM') || ' | '
    || concat_ws(E'\n', 'A las 08:00', 'De Pocitos a Carrasco', public.chicos_texto('b3100000-0000-4000-8000-000000000001'), 'Precio: $450 por viaje')]
  and not exists (select 1 from avisos where cuerpo like '%Inventad%')
  and (select bool_and(tipo = 'pedido' and url = '#pedido/' || (datos->>'solicitud_ninera_id')) from avisos));

-- ---------------------------------------------------------------------------
-- Lo que ve la niñera, "Puedo", el recordatorio y la elección
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "b1100000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Bruno ve el traslado: tipo, las dos zonas y su precio por viaje, sin precio por hora',
  (select count(*) = 1 and bool_and(tipo = 'traslado' and zona = 'Pocitos' and destino_zona = 'Carrasco' and precio_viaje = 400
                                    and precio_hora is null and estado = 'invitada' and hora_inicio = '08:00')
     from public.ninera_mis_pedidos()));
select pg_temp.verificar('"Puedo"',
  public.responder_pedido((select id from public.ninera_mis_pedidos()), 'acepto') = 'ok');
reset role;
delete from avisos;
select pg_temp.verificar('el recordatorio: "Traslado [dd/mm]", solo a la que no respondió (Hana)',
  public.programar_avisos_pedidos((select responder_hasta - interval '5 minutes' from solicitudes where id = 'b4100000-0000-4000-8000-000000000001')) >= 1
  and pg_temp.avisos_de('b2100000-0000-4000-8000-000000000006') = array['Traslado ' || to_char(public.hoy_mvd() + 1, 'DD/MM')
    || ' | ¡Hola! Avísame por favor si estarías disponible.']
  and pg_temp.avisos_de('b2100000-0000-4000-8000-000000000002') = '{}');
set local role authenticated;
set local request.jwt.claims = '{"sub": "b1100000-0000-4000-8000-000000000006", "email": "59899000006@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Hana también puede', public.responder_pedido((select id from public.ninera_mis_pedidos()), 'acepto') = 'ok');
reset role;
delete from avisos;
-- "Asignar" a Bruno, como lo hace el panel: la solicitud y después su fila.
update solicitudes set estado = 'confirmada' where id = 'b4100000-0000-4000-8000-000000000001';
update solicitud_ninieras set estado = 'confirmada', pago_ninera = 400
 where solicitud_id = 'b4100000-0000-4000-8000-000000000001' and ninera_id = 'b2100000-0000-4000-8000-000000000002';
select pg_temp.verificar('a Bruno "¡Quedaste seleccionada!"; a Hana "Este traslado ya quedó cubierto"',
  pg_temp.avisos_de('b2100000-0000-4000-8000-000000000002') = array['¡Quedaste seleccionada! | ' || pg_temp.dia(public.hoy_mvd() + 1)
    || ' a las 08:00. Ya tienes todos los datos en la app.']
  and pg_temp.avisos_de('b2100000-0000-4000-8000-000000000006') = array['Gracias por responder | Este traslado ya quedó cubierto. ¡Te tendremos en cuenta para el próximo!']
  and (select estado = 'cubierto' from solicitud_ninieras where solicitud_id = 'b4100000-0000-4000-8000-000000000001' and ninera_id = 'b2100000-0000-4000-8000-000000000006'));

-- El registro del pedido (lo escribe "Asignar"): no le llega "Tienes un traslado" (ya le llegó "¡Quedaste seleccionada!").
delete from avisos;
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin, km, origen, destino,
                                cobro_familia, pago_ninera, solicitud_id) values
  ('b5100000-0000-4000-8000-000000000001', 'traslado', 'b3100000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'b2100000-0000-4000-8000-000000000002',
   'Bruno Ejemplo', public.hoy_mvd() + 1, '08:00', null, 12, 'Calle Inventada 123', 'Colegio Inventado 456', 700, 400, 'b4100000-0000-4000-8000-000000000001'),
  -- un traslado de un fijo, previsto
  ('b5100000-0000-4000-8000-000000000002', 'traslado', 'b3100000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'b2100000-0000-4000-8000-000000000002',
   'Bruno Ejemplo', public.hoy_mvd() + 2, '08:00', null, 12, 'Calle Inventada 123', 'Colegio Inventado 456', 700, 400, null);
update sittings_traslados set estado = 'previsto' where id = 'b5100000-0000-4000-8000-000000000002';
select pg_temp.verificar('el registro de un pedido ya elegido no avisa "Tienes un traslado"',
  not exists (select 1 from avisos where para_ninera_id = 'b2100000-0000-4000-8000-000000000002' and clave like '%b5100000-0000-4000-8000-000000000001%'));
set local role authenticated;
set local request.jwt.claims = '{"sub": "b1100000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('confirmado: las direcciones, las zonas del pedido y el precio por viaje',
  (select origen = 'Calle Inventada 123' and destino = 'Colegio Inventado 456' and zona = 'Pocitos' and destino_zona = 'Carrasco'
          and precio_viaje = 400 and precio_hora is null and tipo = 'traslado'
     from public.ninera_mis_sittings() where id = 'b5100000-0000-4000-8000-000000000001'));
select pg_temp.verificar('previsto: sin las direcciones ni el precio (no salió de un pedido)',
  (select origen is null and destino is null and direccion is null and precio_viaje is null and zona = 'Pocitos'
     from public.ninera_mis_sittings() where id = 'b5100000-0000-4000-8000-000000000002'));
select pg_temp.verificar('la elegida que ya vio los datos tampoco ve direcciones en sus pedidos',
  not exists (select 1 from public.ninera_mis_pedidos() p where p.zona like '%Inventad%'));
reset role;

-- ---------------------------------------------------------------------------
-- Los avisos por día de un traslado
-- ---------------------------------------------------------------------------
delete from avisos;
update sittings_traslados set hora_inicio = '08:30' where id = 'b5100000-0000-4000-8000-000000000001';
select pg_temp.verificar('cambió la hora de salida: "Cambió el horario de tu traslado" con "a las" y su fila (tipo traslado, sin hora de fin)',
  pg_temp.avisos_de('b2100000-0000-4000-8000-000000000002') = array['Cambió el horario de tu traslado del ' || pg_temp.dia(public.hoy_mvd() + 1)
    || ' | Ahora es a las 08:30. Mira los detalles.']
  and (select count(*) = 1 from cambios_horario where sitting_id = 'b5100000-0000-4000-8000-000000000001' and tipo = 'traslado'
         and hora_inicio = '08:30' and hora_fin is null and not es_fijo));
update sittings_traslados set hora_fin = '09:15' where id = 'b5100000-0000-4000-8000-000000000001';
update sittings_traslados set hora_inicio = '08:30' where id = 'b5100000-0000-4000-8000-000000000001';
select pg_temp.verificar('la hora de fin de un traslado, o la misma hora otra vez: nada más',
  (select count(*) = 1 from avisos where para_ninera_id = 'b2100000-0000-4000-8000-000000000002'));
set local role authenticated;
select pg_temp.verificar('ninera_mis_cambios dice que es un traslado',
  (select tipo = 'traslado' from public.ninera_mis_cambios() where desde = public.hoy_mvd() + 1));
reset role;

delete from avisos;
update sittings_traslados set ninera_id = 'b2100000-0000-4000-8000-000000000006', ninera_nombre = 'Hana Inventada'
 where id = 'b5100000-0000-4000-8000-000000000001';
select pg_temp.verificar('cambió la niñera: "Ya no vas al traslado" a Bruno y "Tienes un traslado" (sin zona) a Hana',
  pg_temp.avisos_de('b2100000-0000-4000-8000-000000000002') = array['Ya no vas al traslado del ' || pg_temp.dia(public.hoy_mvd() + 1)
    || ' | El equipo hizo un cambio. Si tienes dudas, escríbenos.']
  and pg_temp.avisos_de('b2100000-0000-4000-8000-000000000006') = array['Tienes un traslado el ' || pg_temp.dia(public.hoy_mvd() + 1)
    || ' | A las 08:30. Mira los datos en la app.']);

delete from avisos;
update solicitudes set estado = 'cancelada' where id = 'b4100000-0000-4000-8000-000000000001';
select pg_temp.verificar('se canceló el pedido: el registro en $0 y "Se canceló tu traslado" a Hana',
  (select cancelado and cobro_familia = 0 and pago_ninera = 0 from sittings_traslados where id = 'b5100000-0000-4000-8000-000000000001')
  and pg_temp.avisos_de('b2100000-0000-4000-8000-000000000006') = array['Se canceló tu traslado del ' || pg_temp.dia(public.hoy_mvd() + 1)
    || ' | Con ' || rtrim(public.madre_nombre_inicial('Familia Prueba Uno'), '.') || '. Si tienes dudas, escríbenos.']);

-- ---------------------------------------------------------------------------
-- Los recordatorios de 24 h y 1 h (jueves 10/01/2030), sin "no marcó que llegó" ni el cierre
-- ---------------------------------------------------------------------------
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin, cobro_familia, pago_ninera) values
  ('b5100000-0000-4000-8000-000000000011', 'traslado', 'b3100000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'b2100000-0000-4000-8000-000000000002',
   'Bruno Ejemplo', '2030-01-10', '08:00', '09:00', 700, 400);
delete from avisos;
select public.programar_avisos_el_dia('2030-01-09 08:10-03');
select public.programar_avisos_el_dia('2030-01-10 07:05-03');
select public.programar_avisos_el_dia('2030-01-10 08:40-03');
select public.programar_avisos_el_dia('2030-01-10 09:10-03');
select public.programar_avisos_el_dia('2030-01-10 09:50-03');
select pg_temp.verificar('24 h y 1 h con "traslado" y sin la zona; nada más (ni no_llego, ni fin, ni fin30)',
  pg_temp.avisos_de('b2100000-0000-4000-8000-000000000002') @> array['¡Hola! Mañana tienes un traslado | Jueves 10/01 a las 08:00.',
    'Tu traslado empieza en 1 hora | 08:00.']
  and cardinality(pg_temp.avisos_de('b2100000-0000-4000-8000-000000000002')) = 2
  and not exists (select 1 from avisos where clave like 'admin:sitting:b5100000-0000-4000-8000-000000000011%'));

-- ---------------------------------------------------------------------------
-- Los fijos de traslado: el resumen por fijo, aparte del de sitting de la misma familia
-- ---------------------------------------------------------------------------
set local request.jwt.claims = ''; -- postgres sin sesión (generar_previstos_fijos frena a una niñera)
delete from avisos;
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo, cobro_traslado, pago_traslado) values
  ('b6100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-000000000001', 'b2100000-0000-4000-8000-000000000002', 'Bruno Ejemplo',
   '["D","L","M","X","J","V","S"]', '07:30', null, public.hoy_mvd() - 30, 'traslado', 700, 400),
  ('b6100000-0000-4000-8000-000000000002', 'b3100000-0000-4000-8000-000000000001', 'b2100000-0000-4000-8000-000000000002', 'Bruno Ejemplo',
   '["D","L","M","X","J","V","S"]', '16:00', '19:00', public.hoy_mvd() - 30, 'sitting', null, null);
select public.generar_previstos_fijos(14);
select pg_temp.verificar('un fijo de traslados nuevo y uno de sitting: un aviso por cada uno',
  pg_temp.avisos_de('b2100000-0000-4000-8000-000000000002') @> array[
    'Tienes un fijo nuevo con ' || public.madre_nombre_inicial('Familia Prueba Uno') || ' | Desde el ' || pg_temp.dia(public.hoy_mvd() + 1)
      || ', a las 16:00, en Pocitos. Mira los datos en la app.',
    'Tienes un fijo nuevo de traslados con ' || public.madre_nombre_inicial('Familia Prueba Uno') || ' | Desde el ' || pg_temp.dia(public.hoy_mvd() + 1)
      || ', a las 07:30. Mira los datos en la app.']
  and cardinality(pg_temp.avisos_de('b2100000-0000-4000-8000-000000000002')) = 2);

delete from avisos;
update asignaciones set vigente_hasta = public.hoy_mvd() + 4 where id = 'b6100000-0000-4000-8000-000000000001';
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo, cobro_traslado, pago_traslado) values
  ('b6100000-0000-4000-8000-000000000003', 'b3100000-0000-4000-8000-000000000001', 'b2100000-0000-4000-8000-000000000002', 'Bruno Ejemplo',
   '["D","L","M","X","J","V","S"]', '08:00', null, public.hoy_mvd() + 5, 'traslado', 700, 400);
select public.generar_previstos_fijos(14);
select pg_temp.verificar('la hora de salida del fijo de traslados desde una fecha: "Cambió el horario de tu fijo de traslados" y su fila',
  pg_temp.avisos_de('b2100000-0000-4000-8000-000000000002') = array['Cambió el horario de tu fijo de traslados con ' || public.madre_nombre_inicial('Familia Prueba Uno')
    || ' | Desde el ' || pg_temp.dia(public.hoy_mvd() + 5) || ', a las 08:00. Mira los detalles.']
  and (select count(*) = 1 from cambios_horario where es_fijo and tipo = 'traslado' and desde = public.hoy_mvd() + 5 and hora_inicio = '08:00' and hora_fin is null));

delete from avisos;
update asignaciones set vigente_hasta = public.hoy_mvd() + 6 where id = 'b6100000-0000-4000-8000-000000000003';
select public.generar_previstos_fijos(14);
select pg_temp.verificar('termina el fijo de traslados: "Tu fijo de traslados con [madre] termina el [día]"; el de sitting no cambia',
  pg_temp.avisos_de('b2100000-0000-4000-8000-000000000002') = array['Tu fijo de traslados con ' || public.madre_nombre_inicial('Familia Prueba Uno')
    || ' termina el ' || pg_temp.dia(public.hoy_mvd() + 6) || ' | Si tienes dudas, escríbenos.']);

-- ---------------------------------------------------------------------------
-- solo_practica prendido: nada a una niñera real
-- ---------------------------------------------------------------------------
update app_config set valor = valor || '{"solo_practica": true}'::jsonb where id = 'pedidos_app';
delete from avisos;
update sittings_traslados set hora_inicio = '07:00' where id = 'b5100000-0000-4000-8000-000000000011';
select public.programar_avisos_el_dia('2030-01-09 07:10-03');
select pg_temp.verificar('con solo_practica, ni el cambio ni el recordatorio de un traslado real', not exists (select 1 from avisos));

rollback;
