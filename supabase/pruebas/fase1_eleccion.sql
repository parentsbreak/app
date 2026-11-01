-- ============================================================================
-- Prueba de 20261103_eleccion_pedidos.sql en un Postgres LOCAL (nunca en producción): asignar a la
-- elegida ("¡Quedaste seleccionada!" y "Ya se cubrió"), cancelar ("Se canceló"), lo que ve la niñera
-- (ninera_mis_pedidos, ninera_mis_sittings, ninera_marcar_pedido_visto), la marca de horario
-- aproximado en el aviso del pedido, solo_practica y los avisos de tiempo (programar_avisos_pedidos
-- con el "ahora" fijado a mano). Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_eleccion.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261103_eleccion_pedidos.sql \
--     --migracion supabase/migraciones/20261103_eleccion_pedidos_DESHACER.sql \
--     --migracion supabase/migraciones/20261103_eleccion_pedidos.sql supabase/pruebas/fase1_eleccion.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- Todo termina en rollback.
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
create function pg_temp.hay_aviso(p_clave text) returns boolean language sql as $$
  select exists (select 1 from public.avisos where clave = p_clave)
$$;
-- Un momento de Montevideo: el día (relativo a hoy) a esa hora.
create function pg_temp.mvd(p_dias integer, p_hora time) returns timestamp with time zone language sql as $$
  select ((public.hoy_mvd() + p_dias) + p_hora) at time zone 'America/Montevideo'
$$;

-- ---------------------------------------------------------------------------
-- Está todo (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('columnas nuevas',
  (select count(*) = 4 from information_schema.columns where table_schema = 'public'
    and ((table_name = 'solicitudes' and column_name = 'horario_aproximado')
      or (table_name = 'solicitud_ninieras' and column_name in ('seleccionada_en', 'visto_en'))
      or (table_name = 'sittings_traslados' and column_name = 'solicitud_id'))));
select pg_temp.verificar('los dos triggers',
  (select count(*) = 2 from pg_trigger where not tgisinternal
    and tgname in ('solicitud_ninieras_al_confirmar', 'solicitudes_al_cancelar')));
select pg_temp.verificar('índice de sittings_traslados.solicitud_id',
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sittings_traslados_solicitud'));
select pg_temp.verificar('horario_aproximado en falso por defecto',
  (select column_default = 'false' and is_nullable = 'NO' from information_schema.columns
    where table_schema = 'public' and table_name = 'solicitudes' and column_name = 'horario_aproximado'));

-- ---------------------------------------------------------------------------
-- Datos inventados: una admin; Ana y Bruno con app (reales); Dora sin app; Pía, Lola y Mía de
-- práctica con app. Familia Prueba Uno (real) y Familia (práctica), cada una con un chico.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e1000000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('e1000000-0000-4000-8000-000000000001', '59899100001@ninieras.parentsbreak.invalid'),
  ('e1000000-0000-4000-8000-000000000002', '59899100002@ninieras.parentsbreak.invalid'),
  ('e1000000-0000-4000-8000-000000000006', '59899100006@ninieras.parentsbreak.invalid'),
  ('e1000000-0000-4000-8000-000000000007', '59899100007@ninieras.parentsbreak.invalid'),
  ('e1000000-0000-4000-8000-000000000008', '59899100008@ninieras.parentsbreak.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('e1000000-0000-4000-8000-0000000000a1', 'desarrollo');
insert into ninieras (id, nombre, telefono, user_id, activa, zona, tipo) values
  ('e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099100001', 'e1000000-0000-4000-8000-000000000001', true, 'Pocitos', 'Niñera'),
  ('e2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099100002', 'e1000000-0000-4000-8000-000000000002', true, 'Pocitos', 'Niñera'),
  ('e2000000-0000-4000-8000-000000000004', 'Dora Sinapp', '099100004', null, true, 'Pocitos', 'Niñera'),
  ('e2000000-0000-4000-8000-000000000006', 'Pía (practica)', '099100006', 'e1000000-0000-4000-8000-000000000006', true, 'Pocitos', 'Niñera'),
  ('e2000000-0000-4000-8000-000000000007', 'Lola (práctica)', '099100007', 'e1000000-0000-4000-8000-000000000007', true, 'Pocitos', 'Niñera'),
  ('e2000000-0000-4000-8000-000000000008', 'Mía (práctica)', '099100008', 'e1000000-0000-4000-8000-000000000008', true, 'Pocitos', 'Niñera');
insert into familias (id, nombre, zona, cobro_hora, pago_hora, direccion) values
  ('e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'Pocitos', 500, 250, 'Calle Inventada 123'),
  ('e3000000-0000-4000-8000-000000000003', 'Familia (práctica)', 'Pocitos', 500, 250, 'Calle Ficticia 456');
insert into hijos_familia (familia_id, nombre, edad_declarada, edad_declarada_en, orden) values
  ('e3000000-0000-4000-8000-000000000001', 'Uno', 4, public.hoy_mvd(), 0),
  ('e3000000-0000-4000-8000-000000000003', 'Tres', 2, public.hoy_mvd(), 0);
insert into solicitudes (id, familia_id, familia_nombre, tipo, zona, fecha, hora_inicio, hora_fin, estado, notas_para_ninera, horario_aproximado) values
  -- práctica, mañana, horario exacto: se elige a Pía
  ('e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000003', 'Familia (práctica)', 'sitting', null,
   public.hoy_mvd() + 1, '18:00', '22:00', 'sin_asignar', 'Hay un perro. Tocar el timbre 5.', false),
  -- práctica, pasado mañana, horario aproximado: se cancela
  ('e4000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000003', 'Familia (práctica)', 'sitting', null,
   public.hoy_mvd() + 2, '09:00', '13:00', 'sin_asignar', null, true),
  -- real: Ana asignada a mano (sin pasar por la app)
  ('e4000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting', null,
   public.hoy_mvd() + 1, '10:00', '12:00', 'sin_asignar', null, false),
  ('e4000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting', null,
   public.hoy_mvd() + 3, '10:00', '12:00', 'sin_asignar', null, false),
  -- traslado: el trigger no hace nada
  ('e4000000-0000-4000-8000-000000000005', 'e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'traslado', null,
   public.hoy_mvd() + 1, '08:00', null, 'sin_asignar', null, false);

-- ---------------------------------------------------------------------------
-- El aviso del pedido: "(aproximada, se puede extender)" solo con la marca
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('se manda el de horario exacto a Pía, Lola y Mía',
  public.enviar_pedido_app('e4000000-0000-4000-8000-000000000001',
    '[{"ninera_id": "e2000000-0000-4000-8000-000000000006", "precio_hora": 200},
      {"ninera_id": "e2000000-0000-4000-8000-000000000007", "precio_hora": 210},
      {"ninera_id": "e2000000-0000-4000-8000-000000000008", "precio_hora": 220}]') = 3);
select pg_temp.verificar('se manda el aproximado a Pía y Lola',
  public.enviar_pedido_app('e4000000-0000-4000-8000-000000000002',
    '[{"ninera_id": "e2000000-0000-4000-8000-000000000006", "precio_hora": 200},
      {"ninera_id": "e2000000-0000-4000-8000-000000000007", "precio_hora": 210}]') = 2);
reset role;
select pg_temp.verificar('horario exacto: sin "(aproximada"',
  (select bool_and(cuerpo like '18:00 – 22:00' || E'\n' || '%' and cuerpo not like '%aproximada%') from avisos a
    join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':nuevo'
   where sn.solicitud_id = 'e4000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('horario aproximado: con "(aproximada, se puede extender)"',
  (select bool_and(cuerpo like '09:00 – 13:00 (aproximada, se puede extender)' || E'\n' || '%') from avisos a
    join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':nuevo'
   where sn.solicitud_id = 'e4000000-0000-4000-8000-000000000002'));

-- Pía y Lola dicen "Puedo" en los dos; Mía no responde.
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000006", "email": "59899100006@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('la niñera ve la marca de aproximado en sus pedidos',
  (select bool_and(horario_aproximado = (solicitud_id = 'e4000000-0000-4000-8000-000000000002')) from public.ninera_mis_pedidos())
  and (select count(*) = 2 from public.ninera_mis_pedidos()));
-- La niñera no lee solicitud_ninieras: responde con los ids de sus pedidos.
select pg_temp.verificar('Pía dice Puedo en los dos',
  (select bool_and(public.responder_pedido(p.id, 'acepto') = 'ok') from public.ninera_mis_pedidos() p));
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000007", "email": "59899100007@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Lola dice Puedo en los dos',
  (select bool_and(public.responder_pedido(p.id, 'acepto') = 'ok') from public.ninera_mis_pedidos() p));
reset role;

-- ---------------------------------------------------------------------------
-- Asignar a Pía (lo que hace "Asignar": la solicitud a confirmada y su fila a confirmada)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
update solicitudes set estado = 'confirmada' where id = 'e4000000-0000-4000-8000-000000000001';
update solicitud_ninieras set estado = 'confirmada', pago_ninera = 800
 where solicitud_id = 'e4000000-0000-4000-8000-000000000001' and ninera_id = 'e2000000-0000-4000-8000-000000000006' and estado = 'acepto';
insert into sittings_traslados (tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin,
                                cobro_familia, pago_ninera, cobrado, pagado, solicitud_id, notas) values
  ('sitting', 'e3000000-0000-4000-8000-000000000003', 'Familia (práctica)', 'e2000000-0000-4000-8000-000000000006',
   'Pía (practica)', public.hoy_mvd() + 1, '18:00', '22:00', 2000, 800, false, false,
   'e4000000-0000-4000-8000-000000000001', 'Nota interna que la niñera no ve');
reset role;

select pg_temp.verificar('Pía: seleccionada_en y el aviso "¡Quedaste seleccionada!"',
  (select seleccionada_en is not null from solicitud_ninieras
    where solicitud_id = 'e4000000-0000-4000-8000-000000000001' and ninera_id = 'e2000000-0000-4000-8000-000000000006')
  and (select titulo = '¡Quedaste seleccionada!' and cuerpo like '% a las 18:00. Ya tienes todos los datos en la app.'
              and url = '#pedido/' || sn.id and para_ninera_id = sn.ninera_id
         from avisos a join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':seleccionada'
        where sn.solicitud_id = 'e4000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('Lola (dijo Puedo) y Mía (sin responder) quedan cubierto',
  (select count(*) = 2 from solicitud_ninieras where solicitud_id = 'e4000000-0000-4000-8000-000000000001' and estado = 'cubierto'));
select pg_temp.verificar('a Lola le llega "Gracias por responder"; a Mía, nada',
  (select titulo = 'Gracias por responder' from avisos a join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':cubierto'
    where sn.solicitud_id = 'e4000000-0000-4000-8000-000000000001' and sn.ninera_id = 'e2000000-0000-4000-8000-000000000007')
  and not exists (select 1 from avisos a join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':cubierto'
    where sn.solicitud_id = 'e4000000-0000-4000-8000-000000000001' and sn.ninera_id = 'e2000000-0000-4000-8000-000000000008'));
update solicitud_ninieras set pago_ninera = 801, estado = 'confirmada'
 where solicitud_id = 'e4000000-0000-4000-8000-000000000001' and ninera_id = 'e2000000-0000-4000-8000-000000000006';
select pg_temp.verificar('el aviso de seleccionada no se repite si la fila se vuelve a tocar',
  (select count(*) = 1 from avisos where clave like 'pedido:%:seleccionada'));

-- Lo que ve cada una.
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000006", "email": "59899100006@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Pía ve la fila confirmada del pedido elegido (hasta que la abre)',
  (select count(*) = 1 from public.ninera_mis_pedidos() where estado = 'confirmada' and solicitud_id = 'e4000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('Pía ve en Próximos sittings las indicaciones, su precio por hora y la marca, nunca la nota interna',
  (select notas_para_ninera = 'Hay un perro. Tocar el timbre 5.' and precio_hora = 200 and horario_aproximado = false
          and solicitud_id = 'e4000000-0000-4000-8000-000000000001' and direccion = 'Calle Ficticia 456'
     from public.ninera_mis_sittings() where solicitud_id is not null));
select pg_temp.verificar('Pía no puede marcar como vista la fila de otra',
  not public.ninera_marcar_pedido_visto((select id from solicitud_ninieras where solicitud_id = 'e4000000-0000-4000-8000-000000000001'
                                           and ninera_id = 'e2000000-0000-4000-8000-000000000007')));
-- Marcar y mirar en sentencias separadas: dentro de una misma sentencia se ve lo de antes.
select pg_temp.verificar('Pía abre los datos',
  public.ninera_marcar_pedido_visto((select id from public.ninera_mis_pedidos() where estado = 'confirmada')));
select pg_temp.verificar('la tarjeta se va', not exists (select 1 from public.ninera_mis_pedidos() where estado = 'confirmada'));
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000007", "email": "59899100007@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Lola ve una vez "cubierto"',
  (select count(*) = 1 from public.ninera_mis_pedidos() where estado = 'cubierto')
  and public.ninera_marcar_pedido_visto((select id from public.ninera_mis_pedidos() where estado = 'cubierto')));
select pg_temp.verificar('después de verlo, no', not exists (select 1 from public.ninera_mis_pedidos() where estado = 'cubierto'));
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000008", "email": "59899100008@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Mía (no respondió) no ve nada de ese pedido',
  not exists (select 1 from public.ninera_mis_pedidos() where solicitud_id = 'e4000000-0000-4000-8000-000000000001'));
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('una admin no es niñera: ninera_marcar_pedido_visto da no_autorizada',
  pg_temp.error_de($$select public.ninera_marcar_pedido_visto(gen_random_uuid())$$) = 'no_autorizada');
reset role;

-- ---------------------------------------------------------------------------
-- Cancelar: "Se canceló el pedido del [día]" solo a las que dijeron "Puedo"
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000007", "email": "59899100007@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Lola sigue con el aproximado abierto', exists (select 1 from public.ninera_mis_pedidos()
  where solicitud_id = 'e4000000-0000-4000-8000-000000000002' and estado = 'acepto'));
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
-- Pía no respondió este (se vuelve atrás su "Puedo" para probar el caso sin respuesta).
reset role;
update solicitud_ninieras set estado = 'invitada', respondido_en = null
 where solicitud_id = 'e4000000-0000-4000-8000-000000000002' and ninera_id = 'e2000000-0000-4000-8000-000000000006';
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
update solicitudes set estado = 'cancelada' where id = 'e4000000-0000-4000-8000-000000000002';
reset role;
select pg_temp.verificar('al cancelar, las dos filas abiertas quedan cancelado',
  (select count(*) = 2 from solicitud_ninieras where solicitud_id = 'e4000000-0000-4000-8000-000000000002' and estado = 'cancelado'));
select pg_temp.verificar('a Lola le llega "Se canceló el pedido del ..."; a Pía, nada',
  (select titulo like 'Se canceló el pedido del %' and cuerpo = 'Gracias por responder.'
     from avisos a join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':cancelado'
    where sn.solicitud_id = 'e4000000-0000-4000-8000-000000000002' and sn.ninera_id = 'e2000000-0000-4000-8000-000000000007')
  and not exists (select 1 from avisos a join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':cancelado'
    where sn.solicitud_id = 'e4000000-0000-4000-8000-000000000002' and sn.ninera_id = 'e2000000-0000-4000-8000-000000000006'));
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000007", "email": "59899100007@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Lola ve una vez el cancelado', exists (select 1 from public.ninera_mis_pedidos()
  where solicitud_id = 'e4000000-0000-4000-8000-000000000002' and estado = 'cancelado'));
reset role;

-- ---------------------------------------------------------------------------
-- solo_practica y asignar a mano (sin pasar por la app)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
insert into solicitud_ninieras (solicitud_id, ninera_id, ninera_nombre, estado, pago_ninera) values
  ('e4000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', 'confirmada', 500);
reset role;
select pg_temp.verificar('con solo_practica, a una niñera real asignada a mano no le llega nada',
  not exists (select 1 from avisos a join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':seleccionada'
               where sn.solicitud_id = 'e4000000-0000-4000-8000-000000000003')
  and (select seleccionada_en is null from solicitud_ninieras where solicitud_id = 'e4000000-0000-4000-8000-000000000003'));
update app_config set valor = valor || '{"solo_practica": false}'::jsonb where id = 'pedidos_app';
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
insert into solicitud_ninieras (solicitud_id, ninera_id, ninera_nombre, estado, pago_ninera) values
  ('e4000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', 'confirmada', 500),
  ('e4000000-0000-4000-8000-000000000005', 'e2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', 'confirmada', 300);
reset role;
select pg_temp.verificar('sin solo_practica, Ana asignada a mano recibe "¡Quedaste seleccionada!"',
  exists (select 1 from avisos a join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':seleccionada'
           where sn.solicitud_id = 'e4000000-0000-4000-8000-000000000004'));
select pg_temp.verificar('un traslado no avisa',
  not exists (select 1 from avisos a join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':seleccionada'
               where sn.solicitud_id = 'e4000000-0000-4000-8000-000000000005'));
insert into solicitudes (familia_id, familia_nombre, tipo, fecha, hora_inicio, hora_fin, estado)
values ('e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting', public.hoy_mvd() + 4, '10:00', '12:00', 'confirmada');
insert into solicitud_ninieras (solicitud_id, ninera_id, ninera_nombre, estado)
  select id, 'e2000000-0000-4000-8000-000000000004', 'Dora Sinapp', 'confirmada' from solicitudes where fecha = public.hoy_mvd() + 4;
select pg_temp.verificar('Dora sin app: sin seleccionada_en ni aviso',
  (select seleccionada_en is null from solicitud_ninieras where ninera_id = 'e2000000-0000-4000-8000-000000000004')
  and not exists (select 1 from avisos a join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':seleccionada'
                   where sn.ninera_id = 'e2000000-0000-4000-8000-000000000004'));

-- ---------------------------------------------------------------------------
-- Avisos de tiempo (programar_avisos_pedidos con el "ahora" a mano)
-- ---------------------------------------------------------------------------
-- t1: mañana, mandado hoy a las 10:00 (otro día: perfiles a los 30), responder hasta 10:30.
-- t2: hoy 18:00, mandado hoy a las 10:00 (mismo día: perfiles a los 15), nadie respondió.
-- t3: hoy 18:00, sin mandar (sin_asignar): solo el de 3 horas antes.
insert into solicitudes (id, familia_id, familia_nombre, tipo, fecha, hora_inicio, hora_fin, estado, enviado_app_en, responder_hasta) values
  ('e5000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000003', 'Familia (práctica)', 'sitting',
   public.hoy_mvd() + 1, '18:00', '22:00', 'pendiente_confirmar', pg_temp.mvd(0, '10:00'), pg_temp.mvd(0, '10:30')),
  ('e5000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000003', 'Familia (práctica)', 'sitting',
   public.hoy_mvd(), '18:00', '22:00', 'pendiente_confirmar', pg_temp.mvd(0, '10:00'), pg_temp.mvd(0, '10:15')),
  ('e5000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting',
   public.hoy_mvd(), '18:00', '22:00', 'sin_asignar', null, null);
insert into solicitud_ninieras (id, solicitud_id, ninera_id, ninera_nombre, estado, origen, precio_hora, enviado_en, respondido_en) values
  ('e6000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000006', 'Pía (practica)', 'acepto', 'app', 200, pg_temp.mvd(0, '10:00'), pg_temp.mvd(0, '10:05')),
  ('e6000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000007', 'Lola (práctica)', 'invitada', 'app', 200, pg_temp.mvd(0, '10:00'), null),
  ('e6000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000008', 'Mía (práctica)', 'invitada', 'app', 200, pg_temp.mvd(0, '10:00'), null);
delete from avisos;

select public.programar_avisos_pedidos(pg_temp.mvd(0, '10:19'));
select pg_temp.verificar('10:19: todavía ningún recordatorio (t1 es a las 10:20)',
  not pg_temp.hay_aviso('pedido:e6000000-0000-4000-8000-000000000002:recordatorio'));
select pg_temp.verificar('10:19: el recordatorio de t2 (10:05 a 10:15) ya pasó: no sale tarde',
  not pg_temp.hay_aviso('pedido:e6000000-0000-4000-8000-000000000003:recordatorio'));
select public.programar_avisos_pedidos(pg_temp.mvd(0, '10:20'));
select pg_temp.verificar('10:20: recordatorio a Lola (sin responder), no a Pía (dijo Puedo)',
  pg_temp.hay_aviso('pedido:e6000000-0000-4000-8000-000000000002:recordatorio')
  and not pg_temp.hay_aviso('pedido:e6000000-0000-4000-8000-000000000001:recordatorio')
  and (select cuerpo = '¡Hola! Avísame por favor si estarías disponible.' and para_ninera_id = 'e2000000-0000-4000-8000-000000000007'
         from avisos where clave = 'pedido:e6000000-0000-4000-8000-000000000002:recordatorio'));
select pg_temp.verificar('10:20: t2 (mismo día) ya tiene que tener "nadie"? no: es a los 30',
  not pg_temp.hay_aviso('admin:pedido:e5000000-0000-4000-8000-000000000002:nadie'));
select pg_temp.verificar('10:20: t2 sin nadie que pueda: sin "perfiles"',
  not pg_temp.hay_aviso('admin:pedido:e5000000-0000-4000-8000-000000000002:perfiles'));
select public.programar_avisos_pedidos(pg_temp.mvd(0, '10:29'));
select pg_temp.verificar('10:29: t1 (otro día) todavía sin "perfiles"',
  not pg_temp.hay_aviso('admin:pedido:e5000000-0000-4000-8000-000000000001:perfiles'));
select public.programar_avisos_pedidos(pg_temp.mvd(0, '10:30'));
select pg_temp.verificar('10:30: t1 "Puede 1 niñera para el pedido de Familia (práctica)" a todas',
  (select titulo = 'Puede 1 niñera para el pedido de Familia (práctica)' and cuerpo = 'Mandale los perfiles a la madre.'
          and para_admin = 'todas' and tipo = 'pedidos' and url = '?ir=agenda&solicitud=e5000000-0000-4000-8000-000000000001'
     from avisos where clave = 'admin:pedido:e5000000-0000-4000-8000-000000000001:perfiles'));
select pg_temp.verificar('10:30: t1 no tiene "nadie" (Pía respondió); t2 sí',
  not pg_temp.hay_aviso('admin:pedido:e5000000-0000-4000-8000-000000000001:nadie')
  and (select titulo = 'Nadie respondió el pedido de Familia (práctica)' and cuerpo = 'Preguntale a más niñeras.'
         from avisos where clave = 'admin:pedido:e5000000-0000-4000-8000-000000000002:nadie'));
select pg_temp.verificar('otra vuelta en el mismo minuto: nada nuevo',
  public.programar_avisos_pedidos(pg_temp.mvd(0, '10:30')) = 0);
select public.programar_avisos_pedidos(pg_temp.mvd(0, '14:59'));
select pg_temp.verificar('14:59: sin el de 3 horas antes',
  not pg_temp.hay_aviso('admin:pedido:e5000000-0000-4000-8000-000000000003:3h'));
select public.programar_avisos_pedidos(pg_temp.mvd(0, '15:00'));
select pg_temp.verificar('15:00: t3 (sin mandar) y t2 (mandado) sin niñera, con su texto',
  (select titulo = 'Familia Prueba Uno hoy a las 18:00 sigue sin niñera' and cuerpo = 'Elegí a quién mandárselo.'
     from avisos where clave = 'admin:pedido:e5000000-0000-4000-8000-000000000003:3h')
  and (select cuerpo = 'Mirá las respuestas.' from avisos where clave = 'admin:pedido:e5000000-0000-4000-8000-000000000002:3h')
  and not pg_temp.hay_aviso('admin:pedido:e5000000-0000-4000-8000-000000000001:3h'));
update solicitudes set estado = 'confirmada' where id = 'e5000000-0000-4000-8000-000000000001';
select pg_temp.verificar('un pedido ya asignado o con el cron parado de más: nada viejo',
  public.programar_avisos_pedidos(pg_temp.mvd(0, '18:00')) = 0);
select pg_temp.verificar('programar_avisos suma la regla de pedidos',
  position('programar_avisos_pedidos' in pg_get_functiondef('public.programar_avisos()'::regprocedure)) > 0);

-- ---------------------------------------------------------------------------
-- Quién puede llamar qué
-- ---------------------------------------------------------------------------
select pg_temp.verificar('authenticated no ejecuta programar_avisos_pedidos ni pedido_puede_avisar',
  not has_function_privilege('authenticated', 'public.programar_avisos_pedidos(timestamp with time zone)', 'execute')
  and not has_function_privilege('authenticated', 'public.pedido_puede_avisar(uuid, text, text)', 'execute'));
select pg_temp.verificar('authenticated no ejecuta las funciones de los triggers',
  not has_function_privilege('authenticated', 'public.solicitud_ninieras_al_confirmar()', 'execute')
  and not has_function_privilege('authenticated', 'public.solicitudes_al_cancelar()', 'execute'));
select pg_temp.verificar('anon no ejecuta ninera_marcar_pedido_visto',
  not has_function_privilege('anon', 'public.ninera_marcar_pedido_visto(uuid)', 'execute'));

rollback;
