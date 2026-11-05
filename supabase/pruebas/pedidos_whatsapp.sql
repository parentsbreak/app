-- ============================================================================
-- Prueba de 20261021_pedidos_whatsapp.sql en un Postgres LOCAL (nunca en producción).
-- La tabla pedidos_whatsapp (estados, tipos, límites, política), precio_sitting() con casos a
-- mano: términos (antes y después del día), medianoche, sin hora de fin, sin tarifa; y el tope
-- diario (reservar_llamada_pedido). Los casos al azar contra la app están en paridad_plata.sql.
-- Datos inventados.
-- Uso: crear una base con supabase/schema.sql (sin las extensiones de Supabase) y correr este
-- archivo con psql -v ON_ERROR_STOP=1. Todo termina en rollback.
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;
-- true si la sentencia falla (por una restricción), sin cortar la transacción.
create function pg_temp.falla(sentencia text) returns boolean language plpgsql as $$
begin
  execute sentencia;
  return false;
exception when others then
  return true;
end $$;

insert into familias (id, nombre, cobro_hora, pago_hora, terminos_aceptados_el) values
  ('f2000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 400, 260, '2026-12-20'),
  ('f2000000-0000-4000-8000-000000000002', 'Familia Prueba Dos', 380, 250, null),
  ('f2000000-0000-4000-8000-000000000003', 'Familia Prueba Tres', null, null, null);

-- precio_sitting: con términos desde el 20/12, 17:00 a 20:46 (3 h 46) se cobran 4 h (regla del 04/11/2026).
select pg_temp.verificar('con términos: cobra 4 h ($1.600) y paga 3 h 46 ($979)',
  (select cobro = 1600 and pago = 979 and horas_cobro = 4 from public.precio_sitting('f2000000-0000-4000-8000-000000000001', '2026-12-21', '17:00', '20:46')));
select pg_temp.verificar('el mismo día que aceptó los términos ya redondea ($1.600)',
  (select cobro = 1600 from public.precio_sitting('f2000000-0000-4000-8000-000000000001', '2026-12-20', '17:00', '20:46')));
select pg_temp.verificar('el día antes de aceptar los términos: la hora real ($1.507)',
  (select cobro = 1507 from public.precio_sitting('f2000000-0000-4000-8000-000000000001', '2026-12-19', '17:00', '20:46')));
select pg_temp.verificar('2 h 15 se cobran exactas (hasta 15 minutos)',
  (select horas_cobro = 2.25 from public.precio_sitting('f2000000-0000-4000-8000-000000000001', '2026-12-21', '15:00', '17:15')));
select pg_temp.verificar('sin términos: 3 h justas ($1.140 y $750)',
  (select cobro = 1140 and pago = 750 from public.precio_sitting('f2000000-0000-4000-8000-000000000002', '2026-10-21', '16:00', '19:00')));
select pg_temp.verificar('pasada la medianoche: 21:00 a 01:00 son 4 h',
  (select horas = 4 and cobro = 1520 from public.precio_sitting('f2000000-0000-4000-8000-000000000002', '2026-10-21', '21:00', '01:00')));
select pg_temp.verificar('sin hora de fin: no devuelve precio',
  not exists (select 1 from public.precio_sitting('f2000000-0000-4000-8000-000000000002', '2026-10-21', '21:00', null)));
select pg_temp.verificar('familia sin tarifa: cobro y pago vacíos',
  (select cobro is null and pago is null and horas = 3 from public.precio_sitting('f2000000-0000-4000-8000-000000000003', '2026-10-21', '16:00', '19:00')));
select pg_temp.verificar('familia que no existe: no devuelve nada',
  not exists (select 1 from public.precio_sitting('f2000000-0000-4000-8000-000000000999', '2026-10-21', '16:00', '19:00')));

-- La tabla: un borrador normal entra con sus valores por defecto.
insert into pedidos_whatsapp (texto, tipo, familia_id, servicio, fecha, hora_inicio, hora_fin, chicos_cantidad, creado_por)
values ('Hola, ¿tienen alguien el sábado de 20 a 23:30?', 'pedido_nuevo', 'f2000000-0000-4000-8000-000000000001', 'sitting', '2026-10-24', '20:00', '23:30', 2, 'prueba@ejemplo.test');
select pg_temp.verificar('el borrador entra como borrador, sin dudas y con fecha de alta',
  (select estado = 'borrador' and dudas = '[]'::jsonb and creado_el is not null from pedidos_whatsapp));
select pg_temp.verificar('estado inventado: no entra', pg_temp.falla($$insert into pedidos_whatsapp (texto, estado) values ('x', 'enviado')$$));
select pg_temp.verificar('tipo inventado: no entra', pg_temp.falla($$insert into pedidos_whatsapp (texto, tipo) values ('x', 'reclamo')$$));
select pg_temp.verificar('servicio inventado: no entra', pg_temp.falla($$insert into pedidos_whatsapp (texto, servicio) values ('x', 'limpieza')$$));
select pg_temp.verificar('texto vacío: no entra', pg_temp.falla($$insert into pedidos_whatsapp (texto) values ('')$$));
select pg_temp.verificar('texto de más de 6000 caracteres: no entra', pg_temp.falla($$insert into pedidos_whatsapp (texto) values (repeat('x', 6001))$$));
select pg_temp.verificar('13 chicos: no entra', pg_temp.falla($$insert into pedidos_whatsapp (texto, chicos_cantidad) values ('x', 13)$$));
-- Borrar la familia no borra el pedido: queda sin familia.
delete from familias where id = 'f2000000-0000-4000-8000-000000000001';
select pg_temp.verificar('borrar la familia deja el pedido sin familia', (select count(*) = 1 and bool_and(familia_id is null) from pedidos_whatsapp));
select pg_temp.verificar('RLS prendida y una política con es_usuaria_autorizada',
  (select relrowsecurity from pg_class where oid = 'public.pedidos_whatsapp'::regclass)
  and exists (select 1 from pg_policies where tablename = 'pedidos_whatsapp' and qual like '%es_usuaria_autorizada%'));

-- Tope diario (reservar_llamada_pedido): cuenta las llamadas del día de Montevideo, pedidos y
-- pruebas juntas. 98 de hoy (un tercio son pruebas) y 5 de ayer a última hora, que en UTC ya son
-- de hoy: esas no cuentan.
create temporary table _dia as
  select date_trunc('day', now() at time zone 'America/Montevideo') at time zone 'America/Montevideo' as desde;
insert into pedidos_whatsapp_uso (creado_el, creado_por, probar)
  select (select desde from _dia) + make_interval(mins => g), 'prueba@ejemplo.test', g % 3 = 0 from generate_series(0, 97) g;
insert into pedidos_whatsapp_uso (creado_el, creado_por, probar)
  select (select desde from _dia) - make_interval(mins => g), 'prueba@ejemplo.test', false from generate_series(1, 5) g;
select pg_temp.verificar('con 98 de hoy, la 99 (una prueba) pasa y devuelve su id',
  public.reservar_llamada_pedido('prueba@ejemplo.test', true, 100) is not null);
select pg_temp.verificar('la 100 (de otra cuenta) también pasa',
  public.reservar_llamada_pedido('otra@ejemplo.test', false, 100) is not null);
select pg_temp.verificar('la 101 no pasa: devuelve null',
  public.reservar_llamada_pedido('prueba@ejemplo.test', false, 100) is null);
select pg_temp.verificar('una prueba tampoco pasa con el tope lleno',
  public.reservar_llamada_pedido('prueba@ejemplo.test', true, 100) is null);
select pg_temp.verificar('lo rechazado no se anota: hoy quedan 100, 34 de ellas pruebas',
  (select count(*) = 100 and count(*) filter (where probar) = 34 from pedidos_whatsapp_uso where creado_el >= (select desde from _dia)));
select pg_temp.verificar('lo de ayer sigue ahí y no contó', (select count(*) = 5 from pedidos_whatsapp_uso where creado_el < (select desde from _dia)));
select pg_temp.verificar('ni la app ni anon pueden llamar a las funciones (solo la clave de servicio)',
  not has_function_privilege('authenticated', 'public.reservar_llamada_pedido(text, boolean, integer)', 'execute')
  and not has_function_privilege('anon', 'public.reservar_llamada_pedido(text, boolean, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.precio_sitting(uuid, date, time without time zone, time without time zone)', 'execute'));
select pg_temp.verificar('pedidos_whatsapp_uso con RLS y solo lectura para las autorizadas',
  (select relrowsecurity from pg_class where oid = 'public.pedidos_whatsapp_uso'::regclass)
  and (select count(*) = 1 and bool_and(cmd = 'SELECT' and qual like '%es_usuaria_autorizada%') from pg_policies where tablename = 'pedidos_whatsapp_uso'));

rollback;
