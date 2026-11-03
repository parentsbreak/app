-- ============================================================================
-- Prueba de 20261107_ficha_cambios.sql en un Postgres LOCAL (nunca en producción): la ficha de la familia y los
-- avisos de cambios y cancelaciones (decisiones.md 6.5). Los avisos por día (nuevo, cambio de horario, de día, de
-- niñera, cancelado, borrado, reactivado; nada de un sitting que ya empezó, de un traslado, a una niñera sin app ni con
-- solo_practica), el pedido ya asignado que se cancela (la elegida y su registro), el resumen de los fijos en
-- generar_previstos_fijos (fijo nuevo, horario desde una fecha, la ventana que crece, pausa, cambio de niñera,
-- termina), la respuesta al cambio y la ficha (guardar, quién la ve y hasta cuándo). Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_ficha_cambios.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261107_ficha_cambios.sql \
--     --migracion supabase/migraciones/20261107_ficha_cambios_DESHACER.sql \
--     --migracion supabase/migraciones/20261107_ficha_cambios.sql supabase/pruebas/fase1_ficha_cambios.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- Los avisos por día usan fechas de 2030 (siempre en el futuro); los fijos y la ficha, fechas relativas a hoy (la
-- base usa now()). Todo termina en rollback.
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;
create function pg_temp.error_de(sentencia text) returns text language plpgsql as $$
begin
  execute sentencia;
  return null;
exception when others then
  return sqlerrm;
end $$;
-- Los avisos de una niñera (o de las admins) que llegaron desde la marca, como "título | cuerpo", en orden.
create function pg_temp.avisos_de(p_ninera uuid) returns text[] language sql as $$
  select coalesce(array_agg(titulo || ' | ' || coalesce(cuerpo, '') order by creado_en, clave), '{}')
    from public.avisos where para_ninera_id = p_ninera
$$;
create function pg_temp.dia(p date) returns text language sql as $$ select public.dia_corto_texto(p) $$;

-- ---------------------------------------------------------------------------
-- Está todo (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('dos tablas nuevas con RLS',
  (select count(*) = 2 from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
    and relname in ('fichas_familia', 'cambios_horario')));
select pg_temp.verificar('los tres triggers por sentencia sobre sittings_traslados',
  (select count(*) = 3 from pg_trigger where tgrelid = 'public.sittings_traslados'::regclass
    and tgname in ('sittings_avisos_insert', 'sittings_avisos_update', 'sittings_avisos_delete')));
select pg_temp.verificar('las de la niñera: authenticated sí, anon no',
  has_function_privilege('authenticated', 'public.ninera_guardar_ficha_familia(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_ficha_familia(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_mis_cambios()', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_responder_cambio(uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_guardar_ficha_familia(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_ficha_familia(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_responder_cambio(uuid, boolean)', 'execute'));
select pg_temp.verificar('las internas: ni authenticated ni anon',
  not has_function_privilege('authenticated', 'public.aviso_sitting_ninera(text, uuid, uuid, uuid, text, date, time without time zone, time without time zone, boolean, uuid, date)', 'execute')
  and not has_function_privilege('authenticated', 'public.avisar_cambios_previstos(date)', 'execute')
  and not has_function_privilege('authenticated', 'public.sitting_puede_avisar(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.ficha_familia_campos()', 'execute'));
select pg_temp.verificar('generar_previstos_fijos marca la transacción y llama al resumen',
  pg_get_functiondef('public.generar_previstos_fijos'::regproc) like '%pb.previstos%'
  and pg_get_functiondef('public.generar_previstos_fijos'::regproc) like '%avisar_cambios_previstos(hoy)%');

-- ---------------------------------------------------------------------------
-- Datos inventados: una admin; Ana y Bruno con app; Eva sin app; Familia Prueba Uno (Pocitos). solo_practica apagado
-- (se prende al final).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e1800000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('e1800000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid'),
  ('e1800000-0000-4000-8000-000000000002', '59899000002@ninieras.parentsbreak.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('e1800000-0000-4000-8000-0000000000a1', 'desarrollo');
insert into ninieras (id, nombre, telefono, user_id, activa, zona, tipo) values
  ('e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'e1800000-0000-4000-8000-000000000001', true, 'Pocitos', 'Niñera'),
  ('e2800000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', 'e1800000-0000-4000-8000-000000000002', true, 'Pocitos', 'Niñera'),
  ('e2800000-0000-4000-8000-000000000005', 'Eva Sinapp', '099000005', null, true, 'Pocitos', 'Niñera');
insert into familias (id, nombre, zona, cobro_hora, pago_hora) values
  ('e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'Pocitos', 380, 250);
update app_config set valor = valor || '{"solo_practica": false}'::jsonb where id = 'pedidos_app';

-- ---------------------------------------------------------------------------
-- Avisos por día (jueves 10/01/2030)
-- ---------------------------------------------------------------------------
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin, cobro_familia, pago_ninera) values
  ('e5800000-0000-4000-8000-000000000001', 'sitting', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-10', '16:00', '19:00', 1140, 750),
  ('e5800000-0000-4000-8000-000000000005', 'sitting', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2800000-0000-4000-8000-000000000005', 'Eva Sinapp', '2030-01-10', '16:00', '19:00', 1140, 750),
  ('e5800000-0000-4000-8000-000000000006', 'traslado', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-10', '08:00', null, 450, 250),
  ('e5800000-0000-4000-8000-000000000007', 'sitting', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', '2020-01-10', '16:00', '19:00', 1140, 750);
select pg_temp.verificar('un sitting nuevo: "Tienes un sitting el [día]" a Ana; nada a Eva (sin app), del traslado ni del pasado',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000001') = array['Tienes un sitting el ' || pg_temp.dia('2030-01-10') || ' | 16:00, en Pocitos. Mira los datos en la app.']
  and pg_temp.avisos_de('e2800000-0000-4000-8000-000000000005') = '{}'
  and (select url = '#inicio' and tipo = 'sitting' from avisos where para_ninera_id = 'e2800000-0000-4000-8000-000000000001'));

delete from avisos;
update sittings_traslados set hora_inicio = '17:00', hora_fin = '20:00' where id = 'e5800000-0000-4000-8000-000000000001';
select pg_temp.verificar('cambió el horario: el aviso con "Mira los detalles" y su fila para responder',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000001') = array['Cambió el horario de tu sitting del ' || pg_temp.dia('2030-01-10') || ' | Ahora es de 17:00 a 20:00. Mira los detalles.']
  and (select count(*) = 1 from cambios_horario where sitting_id = 'e5800000-0000-4000-8000-000000000001' and not es_fijo
         and hora_inicio = '17:00' and hora_fin = '20:00' and respuesta is null)
  and (select url = '#cambio/' || (select id from cambios_horario where sitting_id = 'e5800000-0000-4000-8000-000000000001')
         from avisos where para_ninera_id = 'e2800000-0000-4000-8000-000000000001'));
update sittings_traslados set hora_inicio = '17:00', hora_fin = '20:00' where id = 'e5800000-0000-4000-8000-000000000001';
update sittings_traslados set cobro_familia = 1200, cobrado = true where id = 'e5800000-0000-4000-8000-000000000001';
update sittings_traslados set cobrado = false where id = 'e5800000-0000-4000-8000-000000000001';
update sittings_traslados set hora_inicio = '09:00' where id = 'e5800000-0000-4000-8000-000000000006';
select pg_temp.verificar('sin cambio de horario, solo plata, o un traslado: nada más',
  (select count(*) = 1 from avisos where para_ninera_id = 'e2800000-0000-4000-8000-000000000001'));

delete from avisos;
update sittings_traslados set fecha = '2030-01-11' where id = 'e5800000-0000-4000-8000-000000000001';
select pg_temp.verificar('cambió el día: lo dice con el día nuevo',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000001') = array['Cambió el horario de tu sitting del ' || pg_temp.dia('2030-01-10')
    || ' | Ahora es el ' || pg_temp.dia('2030-01-11') || ', de 17:00 a 20:00. Mira los detalles.']);

delete from avisos;
update sittings_traslados set ninera_id = 'e2800000-0000-4000-8000-000000000002', ninera_nombre = 'Bruno Ejemplo' where id = 'e5800000-0000-4000-8000-000000000001';
select pg_temp.verificar('cambió la niñera: "Ya no vas" a Ana y "Tienes un sitting" a Bruno',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000001') = array['Ya no vas al sitting del ' || pg_temp.dia('2030-01-11') || ' | El equipo hizo un cambio. Si tienes dudas, escríbenos.']
  and pg_temp.avisos_de('e2800000-0000-4000-8000-000000000002') = array['Tienes un sitting el ' || pg_temp.dia('2030-01-11') || ' | 17:00, en Pocitos. Mira los datos en la app.']);

delete from avisos;
update sittings_traslados set cancelado = true, cobro_familia = 0, pago_ninera = 0 where id = 'e5800000-0000-4000-8000-000000000001';
select pg_temp.verificar('cancelado: "Se canceló tu sitting" con la madre como la ve la niñera (nombre e inicial, sin doble punto)',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000002') = array['Se canceló tu sitting del ' || pg_temp.dia('2030-01-11') || ' | Con '
    || rtrim(public.madre_nombre_inicial('Familia Prueba Uno'), '.') || '. Si tienes dudas, escríbenos.']
  and (select cuerpo not like '%Prueba Uno%' from avisos where para_ninera_id = 'e2800000-0000-4000-8000-000000000002'));
delete from avisos;
update sittings_traslados set cancelado = false where id = 'e5800000-0000-4000-8000-000000000001';
select pg_temp.verificar('reactivado: le llega como nuevo',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000002') = array['Tienes un sitting el ' || pg_temp.dia('2030-01-11') || ' | 17:00, en Pocitos. Mira los datos en la app.']);
delete from avisos;
delete from sittings_traslados where id = 'e5800000-0000-4000-8000-000000000001';
select pg_temp.verificar('borrado: como cancelado',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000002') = array['Se canceló tu sitting del ' || pg_temp.dia('2030-01-11') || ' | Con '
    || rtrim(public.madre_nombre_inicial('Familia Prueba Uno'), '.') || '. Si tienes dudas, escríbenos.']);

delete from avisos;
update sittings_traslados set hora_inicio = '17:00', cancelado = true where id = 'e5800000-0000-4000-8000-000000000007';
select pg_temp.verificar('un sitting que ya pasó: nada', (select count(*) = 0 from avisos));

-- ---------------------------------------------------------------------------
-- Un pedido ya asignado: la elegida no recibe "Tienes un sitting" (le llegó "Quedaste seleccionada"); si se
-- cancela, ella y su registro quedan cancelados
-- ---------------------------------------------------------------------------
insert into solicitudes (id, familia_id, familia_nombre, tipo, fecha, hora_inicio, hora_fin, estado) values
  ('e6800000-0000-4000-8000-000000000001', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting', '2030-01-12', '16:00', '19:00', 'confirmada'),
  ('e6800000-0000-4000-8000-000000000002', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting', '2030-01-13', '16:00', '19:00', 'confirmada');
insert into solicitud_ninieras (solicitud_id, ninera_id, ninera_nombre, estado, origen) values
  ('e6800000-0000-4000-8000-000000000001', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', 'confirmada', 'panel'),
  ('e6800000-0000-4000-8000-000000000002', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', 'confirmada', 'panel');
delete from avisos;
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin, cobro_familia, pago_ninera, solicitud_id) values
  ('e5800000-0000-4000-8000-000000000011', 'sitting', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-12', '16:00', '19:00', 1140, 750, 'e6800000-0000-4000-8000-000000000001'),
  ('e5800000-0000-4000-8000-000000000012', 'sitting', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-13', '16:00', '19:00', 1140, 750, 'e6800000-0000-4000-8000-000000000002');
select pg_temp.verificar('el registro de un pedido con su fila confirmada: sin "Tienes un sitting"',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000001') = '{}');
update sittings_traslados set cobrado = true where id = 'e5800000-0000-4000-8000-000000000012';
update solicitudes set estado = 'cancelada' where id in ('e6800000-0000-4000-8000-000000000001', 'e6800000-0000-4000-8000-000000000002');
select pg_temp.verificar('cancelar el pedido asignado: la fila de la elegida cancelada y su registro en $0',
  (select estado = 'cancelado' from solicitud_ninieras where solicitud_id = 'e6800000-0000-4000-8000-000000000001')
  and (select cancelado and cobro_familia = 0 and pago_ninera = 0 and cobrado and pagado and notas like '%Pedido cancelado%'
         from sittings_traslados where id = 'e5800000-0000-4000-8000-000000000011'));
select pg_temp.verificar('el que ya estaba cobrado no se toca',
  (select not cancelado and cobro_familia = 1140 from sittings_traslados where id = 'e5800000-0000-4000-8000-000000000012'));
select pg_temp.verificar('a la elegida le llega "Se canceló tu sitting" (solo del que se canceló)',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000001') = array['Se canceló tu sitting del ' || pg_temp.dia('2030-01-12') || ' | Con '
    || rtrim(public.madre_nombre_inicial('Familia Prueba Uno'), '.') || '. Si tienes dudas, escríbenos.']);

-- ---------------------------------------------------------------------------
-- La respuesta al cambio de horario
-- ---------------------------------------------------------------------------
delete from avisos;
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin) values
  ('e5800000-0000-4000-8000-000000000021', 'sitting', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-02-01', '16:00', '19:00'),
  ('e5800000-0000-4000-8000-000000000022', 'sitting', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-02-02', '16:00', '19:00');
update sittings_traslados set hora_fin = '21:00' where id in ('e5800000-0000-4000-8000-000000000021', 'e5800000-0000-4000-8000-000000000022');
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1800000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Ana ve sus cambios sin responder, con la madre como la ve la niñera',
  (select count(*) = 2 and bool_and(not es_fijo and hora_fin = '21:00' and madre = public.madre_nombre_inicial('Familia Prueba Uno'))
     from public.ninera_mis_cambios() where desde in ('2030-02-01', '2030-02-02')));
select pg_temp.verificar('"Ok": queda respondido; un segundo toque devuelve lo primero',
  public.ninera_responder_cambio((select id from cambios_horario where sitting_id = 'e5800000-0000-4000-8000-000000000021'), true)
  and public.ninera_responder_cambio((select id from cambios_horario where sitting_id = 'e5800000-0000-4000-8000-000000000021'), false));
select pg_temp.verificar('"A esa hora no puedo"', not public.ninera_responder_cambio((select id from cambios_horario where sitting_id = 'e5800000-0000-4000-8000-000000000022'), false));
select pg_temp.verificar('inválidos: sin respuesta, uno que no existe',
  pg_temp.error_de(format('select public.ninera_responder_cambio(%L, null)', (select id from cambios_horario where sitting_id = 'e5800000-0000-4000-8000-000000000022'))) = 'respuesta_invalida'
  and pg_temp.error_de($$select public.ninera_responder_cambio('e5800000-0000-4000-8000-0000000000ff', true)$$) = 'no_existe');
select pg_temp.verificar('respondidos, ya no aparecen', not exists (select 1 from public.ninera_mis_cambios() where desde in ('2030-02-01', '2030-02-02')));
set local request.jwt.claims = '{"sub": "e1800000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Bruno no ve ni responde los de Ana',
  not exists (select 1 from public.ninera_mis_cambios() where desde in ('2030-02-01', '2030-02-02'))
  and (select count(*) = 0 from cambios_horario)
  and pg_temp.error_de(format('select public.ninera_responder_cambio(%L, true)', (select id from public.cambios_horario limit 1))) is not null);
reset role;
set local request.jwt.claims = ''; -- de nuevo postgres, sin sesión (generar_previstos_fijos frena a una niñera)
select pg_temp.verificar('"No puedo" avisa a las admins para buscar a otra (y "Ok" no)',
  (select array_agg(titulo || ' | ' || cuerpo) from avisos where para_admin = 'todas' and clave like 'admin:cambio:%')
    = array['Ana Ficticia no puede el ' || pg_temp.dia('2030-02-02') || ' de 16:00 a 21:00 | Buscá a otra.']
  and (select respuesta = false and respondido_en is not null from cambios_horario where sitting_id = 'e5800000-0000-4000-8000-000000000022'));

-- ---------------------------------------------------------------------------
-- Los fijos: un aviso resumido por fijo (generar_previstos_fijos)
-- ---------------------------------------------------------------------------
delete from avisos;
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo) values
  ('e4800000-0000-4000-8000-000000000001', 'e3800000-0000-4000-8000-000000000001', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia',
   '["D","L","M","X","J","V","S"]', '16:00', '19:00', public.hoy_mvd() - 30, 'sitting');
select public.generar_previstos_fijos(14);
select pg_temp.verificar('un fijo nuevo: un solo aviso, no uno por día',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000001') = array['Tienes un fijo nuevo con ' || public.madre_nombre_inicial('Familia Prueba Uno')
    || ' | Desde el ' || pg_temp.dia(public.hoy_mvd() + 1) || ', a las 16:00, en Pocitos. Mira los datos en la app.']
  and (select count(*) = 14 from sittings_traslados where asignacion_id = 'e4800000-0000-4000-8000-000000000001'));
select public.generar_previstos_fijos(14);
select public.generar_previstos_fijos(15);
select pg_temp.verificar('otra corrida sin cambios y un día más al final de la ventana (la de cada noche): nada',
  (select count(*) = 1 from avisos where para_ninera_id = 'e2800000-0000-4000-8000-000000000001'));

-- El horario desde una fecha, como lo hace el panel: el fijo viejo termina y empieza otro.
delete from avisos;
update asignaciones set vigente_hasta = public.hoy_mvd() + 4 where id = 'e4800000-0000-4000-8000-000000000001';
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo) values
  ('e4800000-0000-4000-8000-000000000002', 'e3800000-0000-4000-8000-000000000001', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia',
   '["D","L","M","X","J","V","S"]', '17:00', '20:00', public.hoy_mvd() + 5, 'sitting');
select public.generar_previstos_fijos(15);
select pg_temp.verificar('cambió el horario desde una fecha: un solo "Cambió el horario de tu fijo", ni "ya no vas" ni "fijo nuevo"',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000001') = array['Cambió el horario de tu fijo con ' || public.madre_nombre_inicial('Familia Prueba Uno')
    || ' | Desde el ' || pg_temp.dia(public.hoy_mvd() + 5) || ', de 17:00 a 20:00. Mira los detalles.']
  and (select count(*) = 1 from cambios_horario where es_fijo and desde = public.hoy_mvd() + 5 and hora_inicio = '17:00'));

delete from avisos;
insert into asignaciones_pausas (asignacion_id, desde, hasta) values ('e4800000-0000-4000-8000-000000000002', public.hoy_mvd() + 7, public.hoy_mvd() + 9);
select public.generar_previstos_fijos(15);
select pg_temp.verificar('una pausa: "Tu fijo con [madre] se pausa" del día al día',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000001') = array['Tu fijo con ' || public.madre_nombre_inicial('Familia Prueba Uno') || ' se pausa | Del '
    || pg_temp.dia(public.hoy_mvd() + 7) || ' al ' || pg_temp.dia(public.hoy_mvd() + 9) || '. Si tienes dudas, escríbenos.']);

-- Cambio de niñera desde una fecha: el de Ana termina y empieza uno de Bruno.
delete from avisos;
update asignaciones set vigente_hasta = public.hoy_mvd() + 10 where id = 'e4800000-0000-4000-8000-000000000002';
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo) values
  ('e4800000-0000-4000-8000-000000000003', 'e3800000-0000-4000-8000-000000000001', 'e2800000-0000-4000-8000-000000000002', 'Bruno Ejemplo',
   '["D","L","M","X","J","V","S"]', '17:00', '20:00', public.hoy_mvd() + 11, 'sitting');
select public.generar_previstos_fijos(15);
select pg_temp.verificar('cambio de niñera desde una fecha: uno a la que deja de ir y uno a la nueva',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000001') = array['Ya no vas al fijo con ' || public.madre_nombre_inicial('Familia Prueba Uno')
    || ' desde el ' || pg_temp.dia(public.hoy_mvd() + 11) || ' | El equipo hizo un cambio. Si tienes dudas, escríbenos.']
  and pg_temp.avisos_de('e2800000-0000-4000-8000-000000000002') = array['Tienes un fijo nuevo con ' || public.madre_nombre_inicial('Familia Prueba Uno')
    || ' | Desde el ' || pg_temp.dia(public.hoy_mvd() + 11) || ', a las 17:00, en Pocitos. Mira los datos en la app.']);

delete from avisos;
update asignaciones set vigente_hasta = public.hoy_mvd() + 12 where id = 'e4800000-0000-4000-8000-000000000003';
select public.generar_previstos_fijos(15);
select pg_temp.verificar('el fijo termina: "Tu fijo con [madre] termina el [día]"',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000002') = array['Tu fijo con ' || public.madre_nombre_inicial('Familia Prueba Uno') || ' termina el '
    || pg_temp.dia(public.hoy_mvd() + 12) || ' | Si tienes dudas, escríbenos.']);

delete from avisos;
update asignaciones set dias = '["L"]' where id = 'e4800000-0000-4000-8000-000000000002';
select public.generar_previstos_fijos(15);
select pg_temp.verificar('cambiaron los días de un fijo que sigue: "Cambiaron los días de tu fijo"',
  pg_temp.avisos_de('e2800000-0000-4000-8000-000000000001') = array['Cambiaron los días de tu fijo con ' || public.madre_nombre_inicial('Familia Prueba Uno')
    || ' | Mira tus próximos sittings en la app.']);

-- ---------------------------------------------------------------------------
-- solo_practica: nada a una niñera real
-- ---------------------------------------------------------------------------
delete from avisos;
update app_config set valor = valor || '{"solo_practica": true}'::jsonb where id = 'pedidos_app';
insert into sittings_traslados (tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin) values
  ('sitting', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-03-01', '16:00', '19:00');
update asignaciones set hora_inicio = '15:00', vigente_hasta = null where id = 'e4800000-0000-4000-8000-000000000003';
select public.generar_previstos_fijos(15);
select pg_temp.verificar('solo_practica prendido: ningún aviso', (select count(*) = 0 from avisos));
update app_config set valor = valor || '{"solo_practica": false}'::jsonb where id = 'pedidos_app';

-- ---------------------------------------------------------------------------
-- La ficha de la familia
-- ---------------------------------------------------------------------------
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin) values
  ('e5800000-0000-4000-8000-000000000031', 'sitting', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd(), '00:00', '23:59'),
  ('e5800000-0000-4000-8000-000000000032', 'sitting', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2800000-0000-4000-8000-000000000002', 'Bruno Ejemplo', public.hoy_mvd() + 20, '16:00', '19:00'),
  ('e5800000-0000-4000-8000-000000000033', 'sitting', 'e3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2800000-0000-4000-8000-000000000002', 'Bruno Ejemplo', public.hoy_mvd() - 3, '16:00', '19:00');
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1800000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('inválidos: un campo que no es de la ficha, una casilla con texto, un texto largo, un sitting ajeno',
  pg_temp.error_de($$select public.ninera_guardar_ficha_familia('e5800000-0000-4000-8000-000000000031', '{"cuenta": "x"}')$$) = 'ficha_invalida'
  and pg_temp.error_de($$select public.ninera_guardar_ficha_familia('e5800000-0000-4000-8000-000000000031', '{"c_botiquin": "si"}')$$) = 'ficha_invalida'
  and pg_temp.error_de($$select public.ninera_guardar_ficha_familia('e5800000-0000-4000-8000-000000000031', '[1]')$$) = 'ficha_invalida'
  and pg_temp.error_de(format('select public.ninera_guardar_ficha_familia(%L, %L)', 'e5800000-0000-4000-8000-000000000031', jsonb_build_object('alergias', repeat('a', 1001)))) = 'texto_largo'
  and pg_temp.error_de($$select public.ninera_guardar_ficha_familia('e5800000-0000-4000-8000-000000000032', '{"alergias": "no tiene"}')$$) = 'no_existe');
select pg_temp.verificar('Ana guarda la ficha de su sitting de hoy (lo vacío no se guarda) y la corrige',
  public.ninera_guardar_ficha_familia('e5800000-0000-4000-8000-000000000031',
    '{"alergias": "  maní  ", "tel_madre": "099111222", "reglas": "", "c_botiquin": true, "c_linterna": false}') is not null
  and public.ninera_guardar_ficha_familia('e5800000-0000-4000-8000-000000000031',
    '{"alergias": "maní y nueces", "tel_madre": "099111222", "c_botiquin": true}') is not null);
select pg_temp.verificar('la ve como suya',
  (select datos = '{"alergias": "maní y nueces", "tel_madre": "099111222", "c_botiquin": true}'::jsonb and es_de_este_sitting
     from public.ninera_ficha_familia('e5800000-0000-4000-8000-000000000031')));
select pg_temp.verificar('no lee la tabla directo', (select count(*) = 0 from fichas_familia));
set local request.jwt.claims = '{"sub": "e1800000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Bruno, con un sitting confirmado con esa familia: ve la última ficha (sin saber de quién)',
  (select datos ->> 'alergias' = 'maní y nueces' and not es_de_este_sitting from public.ninera_ficha_familia('e5800000-0000-4000-8000-000000000032')));
select pg_temp.verificar('lo que devuelve: datos, la fecha y si es suya; nada de la niñera que la cargó',
  pg_get_function_result('public.ninera_ficha_familia'::regproc) = 'TABLE(datos jsonb, actualizada_en timestamp with time zone, es_de_este_sitting boolean)');
select pg_temp.verificar('un sitting de Bruno que ya terminó hace días, o el de Ana: nada',
  not exists (select 1 from public.ninera_ficha_familia('e5800000-0000-4000-8000-000000000033'))
  and not exists (select 1 from public.ninera_ficha_familia('e5800000-0000-4000-8000-000000000031')));
reset role;
select pg_temp.verificar('la admin lee la ficha con su familia, su sitting y la niñera',
  (select familia_id = 'e3800000-0000-4000-8000-000000000001' and ninera_id = 'e2800000-0000-4000-8000-000000000001'
     from fichas_familia where sitting_id = 'e5800000-0000-4000-8000-000000000031'));

rollback;
