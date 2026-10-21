-- ============================================================================
-- Prueba de 20261021_borradores.sql en un Postgres LOCAL (nunca en producción): restricciones y
-- política de la tabla de borradores. Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/borradores.sql
-- Todo termina en rollback.
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;
create function pg_temp.falla(sentencia text) returns boolean language plpgsql as $$
begin
  execute sentencia;
  return false;
exception when others then
  return true;
end $$;

insert into auth.users (id) values ('b1000000-0000-4000-8000-000000000001'), ('b1000000-0000-4000-8000-000000000002');
insert into borradores (usuaria, clave, datos) values ('b1000000-0000-4000-8000-000000000001', 'entrevista:nueva', '{"nombre": "Lucía Muestra"}');
select pg_temp.verificar('un borrador entra, con su fecha', (select count(*) = 1 and bool_and(actualizado_at is not null) from borradores));
select pg_temp.verificar('la misma usuaria no puede tener dos con la misma clave',
  pg_temp.falla($$insert into borradores (usuaria, clave, datos) values ('b1000000-0000-4000-8000-000000000001', 'entrevista:nueva', '{}')$$));
insert into borradores (usuaria, clave, datos) values ('b1000000-0000-4000-8000-000000000002', 'entrevista:nueva', '{}');
select pg_temp.verificar('otra usuaria sí, con la misma clave', (select count(*) = 2 from borradores));
-- Guardar de nuevo es un upsert por (usuaria, clave), como hace la app.
insert into borradores (usuaria, clave, datos) values ('b1000000-0000-4000-8000-000000000001', 'entrevista:nueva', '{"nombre": "Otra"}')
  on conflict (usuaria, clave) do update set datos = excluded.datos, actualizado_at = now();
select pg_temp.verificar('guardar de nuevo actualiza la misma fila', (select count(*) = 2 and bool_or(datos ->> 'nombre' = 'Otra') from borradores));
select pg_temp.verificar('clave vacía: no entra', pg_temp.falla($$insert into borradores (usuaria, clave, datos) values ('b1000000-0000-4000-8000-000000000001', '', '{}')$$));
select pg_temp.verificar('sin usuaria: no entra', pg_temp.falla($$insert into borradores (usuaria, clave, datos) values (null, 'x', '{}')$$));
delete from auth.users where id = 'b1000000-0000-4000-8000-000000000002';
select pg_temp.verificar('borrar la cuenta borra sus borradores', (select count(*) = 1 from borradores));
select pg_temp.verificar('RLS prendida y la política pide autorizada y que sea suya',
  (select relrowsecurity from pg_class where oid = 'public.borradores'::regclass)
  and exists (select 1 from pg_policies where tablename = 'borradores' and qual like '%es_usuaria_autorizada%' and qual like '%auth.uid()%' and with_check like '%auth.uid()%'));

rollback;
