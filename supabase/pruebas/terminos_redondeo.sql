-- ============================================================================
-- Prueba del redondeo del cobro (20261020_terminos_redondeo.sql, regla nueva de
-- 20261112_redondeo_cobro.sql) en un Postgres LOCAL (nunca en producción).
-- La regla (04/11/2026, Paulina y Delfina): a la familia que aceptó los términos, desde ese día
-- y nunca antes del 01/12/2026, el TOTAL de horas de cada sitting se cobra así: de cada media
-- hora, hasta 15 minutos exactos y desde el 16 la media hora entera. A la niñera, la hora real.
-- Bordes de la regla, el 01/12/2026, precio_sitting y los previstos de los fijos con y sin
-- términos. Datos inventados.
-- Uso: crear una base con supabase/schema.sql (sin las extensiones de Supabase) y correr este
-- archivo con psql -v ON_ERROR_STOP=1 (o con scripts/probar-sql.mjs). Si algo no da, corta con
-- el nombre del caso. Todo corre en una transacción que termina en rollback.
-- ============================================================================
begin;

create function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Montevideo')::date $$;
create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;
-- Horas cobradas de 14:00 a h, con los términos desde siempre y un día en que ya rige.
create function pg_temp.cobro(h text, ini text default '14:00') returns numeric language sql as $$
  select coalesce(public.horas_cobro_sitting(date '2000-01-01', date '2026-12-15', ini::time, h::time), -1)
$$;

-- La regla, borde por borde (los mismos casos que tests/terminos.spec.js). -1 = se cobra la real.
select pg_temp.verificar('3 h justas: la real', pg_temp.cobro('17:00') = 3);
select pg_temp.verificar('3 h 15: exacto', pg_temp.cobro('17:15') = 3.25);
select pg_temp.verificar('3 h 16: 3 h 30', pg_temp.cobro('17:16') = 3.5);
select pg_temp.verificar('3 h 29: 3 h 30', pg_temp.cobro('17:29') = 3.5);
select pg_temp.verificar('3 h 30: exacto', pg_temp.cobro('17:30') = 3.5);
select pg_temp.verificar('3 h 45: exacto', pg_temp.cobro('17:45') = 3.75);
select pg_temp.verificar('3 h 46: 4 h', pg_temp.cobro('17:46') = 4);
select pg_temp.verificar('3 h 59: 4 h', pg_temp.cobro('17:59') = 4);
select pg_temp.verificar('10 minutos: exacto', pg_temp.cobro('14:10') = 10 / 60.0);
select pg_temp.verificar('16 minutos: media hora', pg_temp.cobro('14:16') = 0.5);
select pg_temp.verificar('el inicio no cuenta: 14:20 a 17:36 son 3 h 16, se cobran 3 h 30', pg_temp.cobro('17:36', '14:20') = 3.5);
select pg_temp.verificar('14:20 a 17:35 son 3 h 15: exacto', pg_temp.cobro('17:35', '14:20') = 3.25);
select pg_temp.verificar('pasa la medianoche: 22:00 a 01:20 se cobran 3 h 30', pg_temp.cobro('01:20', '22:00') = 3.5);
select pg_temp.verificar('pasa la medianoche: 22:00 a 01:06 exacto', pg_temp.cobro('01:06', '22:00') = 3.1);
select pg_temp.verificar('fin igual al inicio: 24 h', pg_temp.cobro('20:00', '20:00') = 24);
select pg_temp.verificar('minutos_cobro: 195, 196, 225, 226', public.minutos_cobro(195) = 195 and public.minutos_cobro(196) = 210
  and public.minutos_cobro(225) = 225 and public.minutos_cobro(226) = 240);

-- Desde cuándo rige.
select pg_temp.verificar('rige desde el 01/12/2026', public.inicio_redondeo_cobro() = date '2026-12-01');
select pg_temp.verificar('el 30/11/2026 todavía no, aunque haya aceptado antes',
  public.horas_cobro_sitting(date '2026-10-01', date '2026-11-30', '14:00', '17:46') is null);
select pg_temp.verificar('el 01/12/2026 ya rige',
  public.horas_cobro_sitting(date '2026-10-01', date '2026-12-01', '14:00', '17:46') = 4);
select pg_temp.verificar('aceptó después del 01/12: el día antes, no',
  public.horas_cobro_sitting(date '2026-12-10', date '2026-12-09', '14:00', '17:46') is null);
select pg_temp.verificar('aceptó después del 01/12: ese día, sí',
  public.horas_cobro_sitting(date '2026-12-10', date '2026-12-10', '14:00', '17:46') = 4);
select pg_temp.verificar('sin términos: nunca', public.horas_cobro_sitting(null, date '2027-01-01', '14:00', '17:46') is null);
select pg_temp.verificar('sin hora de fin: nada', public.horas_cobro_sitting(date '2000-01-01', date '2027-01-01', '14:00', null) is null);
select pg_temp.verificar('sin día: rige (como la app)', public.horas_cobro_sitting(date '2000-01-01', null, '14:00', '17:46') = 4);

insert into familias (id, nombre, cobro_hora, pago_hora, terminos_aceptados_el) values
  ('f0000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 300, 200, date '2026-10-01'),
  ('f0000000-0000-4000-8000-000000000002', 'Familia Prueba Dos', 300, 200, null),
  ('f0000000-0000-4000-8000-000000000003', 'Familia Prueba Tres', 300, 200, pg_temp.hoy() + 5);

-- precio_sitting (el pedido desde WhatsApp): 14:00 a 17:46, 3 h 46 reales.
select pg_temp.verificar('precio_sitting el 01/12: se cobran 4 h, a la niñera la hora real',
  (select cobro = 1200 and pago = round(226 / 60.0 * 200) and horas_cobro = 4
     from public.precio_sitting('f0000000-0000-4000-8000-000000000001', '2026-12-01', '14:00', '17:46')));
select pg_temp.verificar('precio_sitting el 30/11: la hora real',
  (select cobro = round(226 / 60.0 * 300) and horas_cobro = horas
     from public.precio_sitting('f0000000-0000-4000-8000-000000000001', '2026-11-30', '14:00', '17:46')));
select pg_temp.verificar('precio_sitting sin términos: la hora real',
  (select cobro = round(226 / 60.0 * 300)
     from public.precio_sitting('f0000000-0000-4000-8000-000000000002', '2026-12-15', '14:00', '17:46')));

-- Los previstos de los fijos dependen de "hoy": el redondeo rige desde hoy + 3 (se pisa la
-- fecha de inicio dentro de esta transacción).
do $$ begin
  execute format('create or replace function public.inicio_redondeo_cobro() returns date language sql immutable set search_path to '''' as $f$ select %L::date $f$', pg_temp.hoy() + 3);
end $$;

insert into ninieras (id, nombre) values ('e0000000-0000-4000-8000-000000000001', 'Ana Ficticia');
-- Todos los días, 14:00 a 17:46 (3 h 46 reales).
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, dias, hora_inicio, hora_fin, vigente_desde, tipo) values
  ('a0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Ana Ficticia',
   '["L","M","X","J","V","S","D"]', '14:00', '17:46', pg_temp.hoy() - 30, 'sitting'),
  ('a0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'Ana Ficticia',
   '["L","M","X","J","V","S","D"]', '14:00', '17:46', pg_temp.hoy() - 30, 'sitting'),
  ('a0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'Ana Ficticia',
   '["L","M","X","J","V","S","D"]', '14:00', '17:46', pg_temp.hoy() - 30, 'sitting');

select public.generar_previstos_fijos(14);
select pg_temp.verificar('aceptó antes: hasta que rige, la real; desde ese día, 4 h; a la niñera siempre la real',
  (select bool_and(cobro_familia = case when fecha >= pg_temp.hoy() + 3 then 1200 else round(226 / 60.0 * 300) end
                   and pago_ninera = round(226 / 60.0 * 200) and hora_fin = '17:46')
     from sittings_traslados where familia_id = 'f0000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('sin la casilla: todo con la hora real',
  (select bool_and(cobro_familia = round(226 / 60.0 * 300) and pago_ninera = round(226 / 60.0 * 200))
     from sittings_traslados where familia_id = 'f0000000-0000-4000-8000-000000000002'));
select pg_temp.verificar('aceptó en hoy + 5 (después de que rige): desde ese día',
  (select bool_and(cobro_familia = case when fecha >= pg_temp.hoy() + 5 then 1200 else round(226 / 60.0 * 300) end)
     from sittings_traslados where familia_id = 'f0000000-0000-4000-8000-000000000003'));

-- 3 h 15: exacto.
update asignaciones set hora_fin = '17:15' where id = 'a0000000-0000-4000-8000-000000000001';
select public.generar_previstos_fijos(14);
select pg_temp.verificar('3 h 15: se cobran 3 h 15',
  (select bool_and(cobro_familia = 975 and pago_ninera = 650) from sittings_traslados
    where familia_id = 'f0000000-0000-4000-8000-000000000001'));

-- Pasa la medianoche: 22:00 a 01:20 se cobran 3 h 30.
update asignaciones set hora_inicio = '22:00', hora_fin = '01:20' where id = 'a0000000-0000-4000-8000-000000000001';
select public.generar_previstos_fijos(14);
select pg_temp.verificar('cruza la medianoche: se cobran 3 h 30 desde que rige',
  (select bool_and(termina_dia_siguiente and cobro_familia = case when fecha >= pg_temp.hoy() + 3 then 1050 else 1000 end
                   and pago_ninera = round(200 / 60.0 * 200))
     from sittings_traslados where familia_id = 'f0000000-0000-4000-8000-000000000001'));

-- Sacar la marca: los previstos que nadie tocó vuelven a la hora real.
update familias set terminos_aceptados_el = null where id = 'f0000000-0000-4000-8000-000000000001';
select public.generar_previstos_fijos(14);
select pg_temp.verificar('sin la marca: vuelve a la hora real',
  (select bool_and(cobro_familia = 1000) from sittings_traslados where familia_id = 'f0000000-0000-4000-8000-000000000001'));

-- Las funciones de la regla no se llaman desde la app.
select pg_temp.verificar('authenticated y anon no ejecutan las funciones de la regla',
  not has_function_privilege('authenticated', 'public.minutos_cobro(integer)', 'execute')
  and not has_function_privilege('anon', 'public.minutos_cobro(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.inicio_redondeo_cobro()', 'execute')
  and not has_function_privilege('authenticated', 'public.horas_cobro_sitting(date, date, time, time)', 'execute')
  and not has_function_privilege('anon', 'public.horas_cobro_sitting(date, date, time, time)', 'execute'));
select pg_temp.verificar('la regla vieja ya no está', to_regprocedure('public.minutos_fin_cobro(integer)') is null);

rollback;
