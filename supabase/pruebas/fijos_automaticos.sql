-- ============================================================================
-- Prueba de 20261006_fijos_automaticos.sql en un Postgres LOCAL (nunca en producción).
-- Recorre la tabla de convivencia del diseño contra la función real. Datos inventados.
-- Uso: crear una base con supabase/schema.sql (sin las extensiones de Supabase), aplicar
-- la migración y correr este archivo con psql -v ON_ERROR_STOP=1. Si algo no da, corta con
-- el nombre del caso. Todo corre en una transacción que termina en rollback.
-- ============================================================================
begin;

create function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Montevideo')::date $$;
create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;
create temporary table _resultado (r jsonb);
create function pg_temp.correr() returns jsonb language plpgsql as $$
declare x jsonb;
begin
  x := public.generar_previstos_fijos(14);
  delete from _resultado; insert into _resultado values (x);
  return x;
end $$;
create function pg_temp.ultimo(k text) returns integer language sql as $$ select (r->>k)::integer from _resultado $$;

insert into familias (id, nombre, cobro_hora, pago_hora) values
  ('f0000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 300, 200),
  ('f0000000-0000-4000-8000-000000000002', 'Familia Prueba Dos', 300, 200);
insert into ninieras (id, nombre) values
  ('e0000000-0000-4000-8000-000000000001', 'Ana Ficticia'),
  ('e0000000-0000-4000-8000-000000000002', 'Bruno Inventado');
-- Fijo de todos los días, 16 a 19 (3 h): $900 de cobro y $600 de pago por día.
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo) values
  ('a0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Ana Ficticia',
   '["L","M","X","J","V","S","D"]', '16:00', '19:00', pg_temp.hoy() - 30, 'sitting');

-- Generación
select pg_temp.correr();
select pg_temp.verificar('crea los 14 días siguientes (mañana a hoy+14)', pg_temp.ultimo('creados') = 14);
select pg_temp.verificar('todos previstos y automáticos', (select count(*) from sittings_traslados where estado = 'previsto' and generado_automatico) = 14);
select pg_temp.verificar('no crea hoy ni días pasados', (select min(fecha) from sittings_traslados) = pg_temp.hoy() + 1 and (select max(fecha) from sittings_traslados) = pg_temp.hoy() + 14);
select pg_temp.verificar('montos con la tarifa de la familia (3 h)', (select bool_and(cobro_familia = 900 and pago_ninera = 600) from sittings_traslados));
select pg_temp.verificar('vinculados al fijo, con su niñera', (select bool_and(asignacion_id = 'a0000000-0000-4000-8000-000000000001' and ninera_nombre = 'Ana Ficticia') from sittings_traslados));
select pg_temp.correr();
select pg_temp.verificar('correr de nuevo no duplica ni cambia nada', (pg_temp.ultimo('creados') = 0 and pg_temp.ultimo('actualizados') = 0 and pg_temp.ultimo('borrados') = 0));

-- Cambia la tarifa de la familia: se recalculan los previstos que nadie tocó.
update sittings_traslados set hora_fin = '20:00', cobro_familia = 1200, pago_ninera = 800, generado_automatico = false
 where fecha = pg_temp.hoy() + 2; -- editado a mano desde la app
update familias set cobro_hora = 400 where id = 'f0000000-0000-4000-8000-000000000001';
select pg_temp.correr();
select pg_temp.verificar('tarifa nueva: recalcula los 13 automáticos', pg_temp.ultimo('actualizados') = 13);
select pg_temp.verificar('el editado a mano no se toca', (select cobro_familia = 1200 and hora_fin = '20:00' from sittings_traslados where fecha = pg_temp.hoy() + 2));
select pg_temp.verificar('los automáticos con la tarifa nueva', (select cobro_familia from sittings_traslados where fecha = pg_temp.hoy() + 1) = 1200);

-- "Este día no fue": el previsto pasa a la fila en $0 y el proceso no lo vuelve a crear.
update sittings_traslados set cancelado = true, cobro_familia = 0, pago_ninera = 0, cobrado = true, pagado = true, generado_automatico = false
 where fecha = pg_temp.hoy() + 3;
select pg_temp.correr();
select pg_temp.verificar('no fue: no lo recrea', pg_temp.ultimo('creados') = 0 and (select count(*) from sittings_traslados where fecha = pg_temp.hoy() + 3) = 1);

-- Reemplazo de un día: cambia la niñera de ese previsto, solo ese día.
update sittings_traslados set ninera_nombre = 'Bruno Inventado', ninera_id = 'e0000000-0000-4000-8000-000000000002', generado_automatico = false
 where fecha = pg_temp.hoy() + 4;
select pg_temp.correr();
select pg_temp.verificar('reemplazo: queda la otra niñera ese día', (select ninera_nombre from sittings_traslados where fecha = pg_temp.hoy() + 4) = 'Bruno Inventado' and pg_temp.ultimo('actualizados') = 0);

-- Vacaciones: pausa de dos días.
insert into asignaciones_pausas (asignacion_id, desde, hasta) values ('a0000000-0000-4000-8000-000000000001', pg_temp.hoy() + 5, pg_temp.hoy() + 6);
select pg_temp.correr();
select pg_temp.verificar('pausa: borra los 2 previstos del rango', pg_temp.ultimo('borrados') = 2);
select pg_temp.verificar('pausa: no quedan filas en el rango', not exists (select 1 from sittings_traslados where fecha between pg_temp.hoy() + 5 and pg_temp.hoy() + 6));
delete from asignaciones_pausas;
select pg_temp.correr();
select pg_temp.verificar('sacar la pausa: vuelven a crearse', pg_temp.ultimo('creados') = 2);

-- Cambiar la niñera desde hoy+8: se cierra el fijo el día antes y se abre otro.
update asignaciones set vigente_hasta = pg_temp.hoy() + 7 where id = 'a0000000-0000-4000-8000-000000000001';
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo) values
  ('a0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'Bruno Inventado',
   '["L","M","X","J","V","S","D"]', '16:00', '19:00', pg_temp.hoy() + 8, 'sitting');
select pg_temp.correr();
select pg_temp.verificar('cambio de niñera: borra 7 y crea 7', (pg_temp.ultimo('borrados') = 7 and pg_temp.ultimo('creados') = 7));
select pg_temp.verificar('desde hoy+8 lo hace la niñera nueva', (select bool_and(ninera_nombre = 'Bruno Inventado' and asignacion_id = 'a0000000-0000-4000-8000-000000000002') from sittings_traslados where fecha >= pg_temp.hoy() + 8));
select pg_temp.verificar('antes de hoy+8 sigue la anterior', (select ninera_nombre from sittings_traslados where fecha = pg_temp.hoy() + 7) = 'Ana Ficticia');

-- Editar horarios futuros desde hoy+11: mismo mecanismo, con otro horario.
update asignaciones set vigente_hasta = pg_temp.hoy() + 10 where id = 'a0000000-0000-4000-8000-000000000002';
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo) values
  ('a0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'Bruno Inventado',
   '["L","M","X","J","V","S","D"]', '15:00', '19:00', pg_temp.hoy() + 11, 'sitting');
select pg_temp.correr();
select pg_temp.verificar('horario nuevo desde hoy+11: 4 h a $400', (pg_temp.ultimo('borrados') = 4 and pg_temp.ultimo('creados') = 4)
  and (select bool_and(hora_inicio = '15:00' and cobro_familia = 1600) from sittings_traslados where fecha >= pg_temp.hoy() + 11));
select pg_temp.verificar('lo anterior conserva su horario', (select hora_inicio from sittings_traslados where fecha = pg_temp.hoy() + 10) = '16:00');

-- Terminar el fijo desde hoy+13: se borran los automáticos desde esa fecha.
update asignaciones set vigente_hasta = pg_temp.hoy() + 12 where id = 'a0000000-0000-4000-8000-000000000003';
select pg_temp.correr();
select pg_temp.verificar('terminar: borra los 2 últimos', pg_temp.ultimo('borrados') = 2 and (select max(fecha) from sittings_traslados) = pg_temp.hoy() + 12);

-- Un editado a mano fuera de la vigencia nueva queda (lo decide la app/las dueñas).
update asignaciones set vigente_hasta = pg_temp.hoy() + 1 where id = 'a0000000-0000-4000-8000-000000000001';
select pg_temp.correr();
select pg_temp.verificar('editados a mano fuera de vigencia quedan', (select count(*) from sittings_traslados where asignacion_id = 'a0000000-0000-4000-8000-000000000001' and fecha > pg_temp.hoy() + 1) = 3
  and (select count(*) from sittings_traslados where asignacion_id = 'a0000000-0000-4000-8000-000000000001' and fecha > pg_temp.hoy() + 1 and generado_automatico) = 0);

-- Llega el día: lo previsto de hoy o antes pasa a confirmado.
update sittings_traslados set fecha = pg_temp.hoy() where fecha = pg_temp.hoy() + 1;
select pg_temp.correr();
select pg_temp.verificar('llegó el día: se confirma solo', pg_temp.ultimo('confirmados') = 1 and (select estado from sittings_traslados where fecha = pg_temp.hoy()) = 'confirmado');

-- Una fila cargada a mano sin vínculo (misma familia, niñera y día) evita el previsto.
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo) values
  ('a0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000002', null, 'Ana Ficticia',
   '["L","M","X","J","V","S","D"]', '09:00', '10:00', pg_temp.hoy(), 'sitting');
insert into sittings_traslados (tipo, familia_id, familia_nombre, ninera_nombre, fecha, hora_inicio, hora_fin, cobro_familia, pago_ninera)
values ('sitting', 'f0000000-0000-4000-8000-000000000002', 'Familia Prueba Dos', ' ana ficticia ', pg_temp.hoy() + 2, '09:00', '10:00', 300, 200);
select pg_temp.correr();
select pg_temp.verificar('cargado a mano sin vínculo: no se duplica', pg_temp.ultimo('creados') = 13
  and (select count(*) from sittings_traslados where familia_id = 'f0000000-0000-4000-8000-000000000002' and fecha = pg_temp.hoy() + 2) = 1);

-- Traslado fijo: el precio del último traslado de esa familia; cruce de medianoche en sitting.
insert into sittings_traslados (tipo, familia_id, familia_nombre, ninera_nombre, fecha, hora_inicio, cobro_familia, pago_ninera)
values ('traslado', 'f0000000-0000-4000-8000-000000000002', 'Familia Prueba Dos', 'Bruno Inventado', pg_temp.hoy() - 3, '13:00', 520.5, 310);
insert into asignaciones (id, familia_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo) values
  ('a0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000002', 'Bruno Inventado', '["L","M","X","J","V","S","D"]', '13:00', null, pg_temp.hoy(), 'traslado'),
  ('a0000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000001', 'Ana Ficticia', '["S"]', '22:00', '02:00', pg_temp.hoy(), 'sitting');
select pg_temp.correr();
select pg_temp.verificar('traslado: precio del último traslado de la familia', (select bool_and(cobro_familia = 520.5 and pago_ninera = 310 and tipo = 'traslado') from sittings_traslados where asignacion_id = 'a0000000-0000-4000-8000-000000000005'));
select pg_temp.verificar('de 22 a 02: 4 h y termina al día siguiente', (select bool_and(termina_dia_siguiente and cobro_familia = 1600 and pago_ninera = 800) from sittings_traslados where asignacion_id = 'a0000000-0000-4000-8000-000000000006'));
-- Con precio cargado en el fijo (06/10/2026) se usa ese, no el del último traslado.
update asignaciones set cobro_traslado = 956, pago_traslado = 559 where id = 'a0000000-0000-4000-8000-000000000005';
select pg_temp.correr();
select pg_temp.verificar('traslado con precio en el fijo: lo recalcula con ese precio', pg_temp.ultimo('actualizados') = 14
  and (select bool_and(cobro_familia = 956 and pago_ninera = 559) from sittings_traslados where asignacion_id = 'a0000000-0000-4000-8000-000000000005'));
select pg_temp.verificar('solo los sábados', (select bool_and(extract(dow from fecha) = 6) from sittings_traslados where asignacion_id = 'a0000000-0000-4000-8000-000000000006'));

-- Lo que carga la app a mano sigue entrando como confirmado.
select pg_temp.verificar('lo cargado a mano es confirmado', (select estado from sittings_traslados where notas is null and tipo = 'traslado' limit 1) = 'confirmado');

-- Pago por hora de un sitting fijo (01/11/2026, precio por niñera con cada familia): primero el
-- precio del fijo (asignaciones.pago_hora, si es más que 0), si no el de esa niñera con esa familia
-- (precios_ninera_familia), si no la tarifa de la familia. El cobro sigue siempre con la tarifa.
-- Todos de 16 a 19 (3 h) en la Familia Prueba Tres: cobro 3 x 300 = 900 en todos.
insert into familias (id, nombre, cobro_hora, pago_hora) values
  ('f0000000-0000-4000-8000-000000000003', 'Familia Prueba Tres', 300, 200);
insert into ninieras (id, nombre) values
  ('e0000000-0000-4000-8000-000000000003', 'Carla Supuesta');
-- Ana tiene precio con la Familia Tres; Carla, solo con la Familia Uno (otra familia).
insert into precios_ninera_familia (familia_id, ninera_id, pago_hora, nota) values
  ('f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 250, '3 chicos'),
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 275, null);
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo, pago_hora) values
  -- Precio propio del fijo: gana sobre el de Ana con la familia.
  ('a0000000-0000-4000-8000-000000000007', 'f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'Ana Ficticia',
   '["L","M","X","J","V","S","D"]', '16:00', '19:00', pg_temp.hoy(), 'sitting', 230),
  -- Precio del fijo en 0 (no cargado): el de Ana con la familia.
  ('a0000000-0000-4000-8000-000000000008', 'f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'Ana Ficticia',
   '["L","M","X","J","V","S","D"]', '16:00', '19:00', pg_temp.hoy(), 'sitting', 0),
  -- Carla tiene precio, pero con otra familia: la tarifa de la Familia Tres.
  ('a0000000-0000-4000-8000-000000000009', 'f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000003', 'Carla Supuesta',
   '["L","M","X","J","V","S","D"]', '16:00', '19:00', pg_temp.hoy(), 'sitting', null),
  -- Sin niñera vinculada (solo el nombre): la tarifa de la familia.
  ('a0000000-0000-4000-8000-000000000010', 'f0000000-0000-4000-8000-000000000003', null, 'Dora Externa',
   '["L","M","X","J","V","S","D"]', '16:00', '19:00', pg_temp.hoy(), 'sitting', null);
select pg_temp.correr();
select pg_temp.verificar('pago del fijo: el precio propio del fijo gana (3 x 230)', (select count(*) = 14 and bool_and(pago_ninera = 690 and cobro_familia = 900) from sittings_traslados where asignacion_id = 'a0000000-0000-4000-8000-000000000007'));
select pg_temp.verificar('pago del fijo: sin precio propio, el de la niñera con esa familia (3 x 250)', (select count(*) = 14 and bool_and(pago_ninera = 750 and cobro_familia = 900) from sittings_traslados where asignacion_id = 'a0000000-0000-4000-8000-000000000008'));
select pg_temp.verificar('pago del fijo: precio de la niñera con otra familia no cuenta (3 x 200)', (select count(*) = 14 and bool_and(pago_ninera = 600 and cobro_familia = 900) from sittings_traslados where asignacion_id = 'a0000000-0000-4000-8000-000000000009'));
select pg_temp.verificar('pago del fijo: sin niñera vinculada, la tarifa de la familia (3 x 200)', (select count(*) = 14 and bool_and(pago_ninera = 600 and cobro_familia = 900) from sittings_traslados where asignacion_id = 'a0000000-0000-4000-8000-000000000010'));
-- Cambia el precio de Ana con la familia: se recalculan sus previstos, no los del fijo con precio propio.
update precios_ninera_familia set pago_hora = 260 where familia_id = 'f0000000-0000-4000-8000-000000000003' and ninera_id = 'e0000000-0000-4000-8000-000000000001';
select pg_temp.correr();
select pg_temp.verificar('precio de la niñera nuevo: recalcula solo los 14 que lo usan', pg_temp.ultimo('actualizados') = 14
  and (select bool_and(pago_ninera = 780) from sittings_traslados where asignacion_id = 'a0000000-0000-4000-8000-000000000008')
  and (select bool_and(pago_ninera = 690) from sittings_traslados where asignacion_id = 'a0000000-0000-4000-8000-000000000007'));

-- La app (rol authenticated) puede llamar la función; anon no.
select pg_temp.verificar('authenticated puede ejecutar', has_function_privilege('authenticated', 'public.generar_previstos_fijos(integer)', 'execute'));
select pg_temp.verificar('anon no puede ejecutar', not has_function_privilege('anon', 'public.generar_previstos_fijos(integer)', 'execute'));

rollback;
