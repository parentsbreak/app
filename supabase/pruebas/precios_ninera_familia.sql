-- ============================================================================
-- Prueba de 20261031_precios_ninera_familia.sql en un Postgres LOCAL (nunca en producción): la tabla
-- del precio por hora de una niñera con una familia, pago_hora_ninera(), el historial, la RLS (solo
-- admins; una niñera con sesión no ve ni escribe nada) y el borrado en cascada. Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/precios_ninera_familia.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar:
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261031_precios_ninera_familia.sql \
--     --migracion supabase/migraciones/20261031_precios_ninera_familia_DESHACER.sql \
--     --migracion supabase/migraciones/20261031_precios_ninera_familia.sql supabase/pruebas/precios_ninera_familia.sql
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

-- ---------------------------------------------------------------------------
-- Todo lo de la migración está (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('tabla con RLS', (select relrowsecurity from pg_class where oid = to_regclass('public.precios_ninera_familia')));
select pg_temp.verificar('una sola política, para admins',
  (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'precios_ninera_familia'));
select pg_temp.verificar('dos triggers (actualizado_en e historial)',
  (select count(*) = 2 from pg_trigger where tgrelid = to_regclass('public.precios_ninera_familia') and not tgisinternal));
select pg_temp.verificar('en Realtime',
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'precios_ninera_familia'));
select pg_temp.verificar('pago_hora_ninera: no es security definer, authenticated sí y anon no',
  (select not prosecdef from pg_proc where oid = 'public.pago_hora_ninera(uuid, uuid)'::regprocedure)
  and has_function_privilege('authenticated', 'public.pago_hora_ninera(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.pago_hora_ninera(uuid, uuid)', 'execute'));
select pg_temp.verificar('el trigger de actualizado_en no lo ejecuta nadie de afuera',
  not has_function_privilege('authenticated', 'public.precios_ninera_familia_tocar()', 'execute')
  and not has_function_privilege('anon', 'public.precios_ninera_familia_tocar()', 'execute'));

-- ---------------------------------------------------------------------------
-- Datos inventados: una admin, una niñera con cuenta (Ana) y otra sin (Bruno), tres familias
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e1000000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('e1000000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('e1000000-0000-4000-8000-0000000000a1', 'desarrollo');
insert into ninieras (id, nombre, telefono, user_id) values
  ('e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', null);
insert into familias (id, nombre, cobro_hora, pago_hora) values
  ('e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 400, 250),
  ('e3000000-0000-4000-8000-000000000002', 'Familia Prueba Dos', 400, null),
  ('e3000000-0000-4000-8000-000000000003', 'Familia Prueba Tres', 400, 0);

-- ---------------------------------------------------------------------------
-- Como la admin
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';

insert into precios_ninera_familia (familia_id, ninera_id, pago_hora, nota, creado_por)
values ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 300, '3 chicos', 'admin.prueba@ejemplo.invalid');
select pg_temp.verificar('la admin carga un precio y lo lee',
  (select count(*) = 1 from precios_ninera_familia));
select pg_temp.verificar('el mismo par no se repite',
  pg_temp.error_de($q$insert into precios_ninera_familia (familia_id, ninera_id, pago_hora)
    values ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 310)$q$) like '%precios_ninera_familia_par_key%');
select pg_temp.verificar('el pago tiene que ser mayor que 0',
  pg_temp.error_de($q$insert into precios_ninera_familia (familia_id, ninera_id, pago_hora)
    values ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 0)$q$) like '%precios_ninera_familia_pago_check%');
select pg_temp.verificar('sin pago no se guarda',
  pg_temp.error_de($q$insert into precios_ninera_familia (familia_id, ninera_id, pago_hora)
    values ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', null)$q$) is not null);
select pg_temp.verificar('una nota de más de 200 no se guarda',
  pg_temp.error_de($q$insert into precios_ninera_familia (familia_id, ninera_id, pago_hora, nota)
    values ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 280, repeat('x', 201))$q$) like '%precios_ninera_familia_nota_check%');

-- pago_hora_ninera: la fila manda; sin fila, la tarifa de la familia; sin ninguna (o 0), null.
select pg_temp.verificar('pago_hora_ninera con fila: el de la fila',
  public.pago_hora_ninera('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001') = 300);
select pg_temp.verificar('pago_hora_ninera sin fila: la tarifa de la familia',
  public.pago_hora_ninera('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002') = 250);
select pg_temp.verificar('pago_hora_ninera sin fila y sin tarifa (null o 0): null',
  public.pago_hora_ninera('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001') is null
  and public.pago_hora_ninera('e3000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001') is null);
select pg_temp.verificar('pago_hora_ninera con ids nulos o inexistentes: null, sin error',
  public.pago_hora_ninera(null, null) is null
  and public.pago_hora_ninera('e3000000-0000-4000-8000-000000000099', 'e2000000-0000-4000-8000-000000000001') is null);
-- En pasos separados: Postgres no garantiza el orden de las partes de un "and".
select pg_temp.verificar('familia sin tarifa y sin fila: null',
  public.pago_hora_ninera('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002') is null);
select pg_temp.verificar('se carga la fila de Bruno con esa familia',
  pg_temp.error_de($q$insert into precios_ninera_familia (familia_id, ninera_id, pago_hora)
    values ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', 270)$q$) is null);
select pg_temp.verificar('con fila en una familia sin tarifa: la fila igual',
  public.pago_hora_ninera('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002') = 270);

-- actualizado_en e historial.
reset role;
update precios_ninera_familia set actualizado_en = '2026-10-01 12:00:00+00'
 where ninera_id = 'e2000000-0000-4000-8000-000000000001' and familia_id = 'e3000000-0000-4000-8000-000000000001';
set local role authenticated;
update precios_ninera_familia set pago_hora = 320
 where ninera_id = 'e2000000-0000-4000-8000-000000000001' and familia_id = 'e3000000-0000-4000-8000-000000000001';
select pg_temp.verificar('un cambio mueve actualizado_en',
  (select actualizado_en > '2026-10-01 12:00:00+00' from precios_ninera_familia
    where ninera_id = 'e2000000-0000-4000-8000-000000000001' and familia_id = 'e3000000-0000-4000-8000-000000000001'));
reset role;
select pg_temp.verificar('historial: alta y cambio con la admin y el antes / después del pago',
  (select count(*) = 2 from finanzas_historial h
    join precios_ninera_familia p on p.id = h.fila_id
   where h.tabla = 'precios_ninera_familia' and p.familia_id = 'e3000000-0000-4000-8000-000000000001'
     and h.usuario = 'admin.prueba@ejemplo.invalid')
  and exists (select 1 from finanzas_historial where tabla = 'precios_ninera_familia' and accion = 'cambio'
               and cambios -> 'pago_hora' = '{"antes": 300, "despues": 320}'::jsonb));

-- ---------------------------------------------------------------------------
-- Como la niñera (Ana): no ve ni escribe nada, ni su propio precio
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('la niñera no lee ningún precio, ni el suyo',
  (select count(*) = 0 from precios_ninera_familia));
select pg_temp.verificar('la niñera no carga precios',
  pg_temp.error_de($q$insert into precios_ninera_familia (familia_id, ninera_id, pago_hora)
    values ('e3000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001', 999)$q$) like '%row-level security%');
select pg_temp.verificar('la niñera no cambia su precio (0 filas)',
  pg_temp.error_de($q$update precios_ninera_familia set pago_hora = 999$q$) is null);
select pg_temp.verificar('pago_hora_ninera para la niñera: null (la RLS no le muestra nada)',
  public.pago_hora_ninera('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001') is null);
reset role;
select pg_temp.verificar('el precio de Ana sigue en 320 después de su intento',
  (select pago_hora = 320 from precios_ninera_familia
    where ninera_id = 'e2000000-0000-4000-8000-000000000001' and familia_id = 'e3000000-0000-4000-8000-000000000001'));

-- ---------------------------------------------------------------------------
-- Sin sesión (anon): nada
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.verificar('anon no lee precios', (select count(*) = 0 from precios_ninera_familia));
select pg_temp.verificar('anon no ejecuta pago_hora_ninera',
  pg_temp.error_de($q$select public.pago_hora_ninera('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001')$q$) like '%permission denied%');
reset role;

-- ---------------------------------------------------------------------------
-- Baja: historial y cascada
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
delete from precios_ninera_familia where familia_id = 'e3000000-0000-4000-8000-000000000002';
reset role;
select pg_temp.verificar('borrar un precio deja la baja en el historial',
  exists (select 1 from finanzas_historial where tabla = 'precios_ninera_familia' and accion = 'baja'));
delete from familias where id = 'e3000000-0000-4000-8000-000000000001';
select pg_temp.verificar('borrar la familia borra sus precios',
  (select count(*) = 0 from precios_ninera_familia where familia_id = 'e3000000-0000-4000-8000-000000000001'));

rollback;
