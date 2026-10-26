// Corre las pruebas SQL de supabase/pruebas/ en un Postgres en memoria (PGlite), sin instalar
// Postgres y sin tocar ninguna base real. Carga supabase/schema.sql con lo mínimo de Supabase de
// mentira (roles y sus permisos, auth.uid() / auth.jwt() / auth.email(), storage, cron.schedule(),
// net.http_post(), la publicación de Realtime) y corre cada archivo en una base nueva. Si una
// prueba falla, muestra el caso.
//
// PGlite no es dependencia del repo: se instala en una carpeta aparte, una vez.
//   mkdir -p /tmp/pglite && cd /tmp/pglite && npm init -y && npm i @electric-sql/pglite
// y se corre desde la raíz del repo:
//   PGLITE_DIR=/tmp/pglite node scripts/probar-sql.mjs supabase/pruebas/*.sql
// Con --migracion <archivo> aplica antes esa migración (para probarla sobre el schema de main,
// por ejemplo con git show origin/main:supabase/schema.sql > /tmp/schema-main.sql y --schema).
// --migracion se puede repetir: los archivos se aplican en el orden en que se pasan. Sirve para
// probar que el DESHACER deja todo como estaba (aplicar, deshacer y volver a aplicar):
//   --schema /tmp/schema-main.sql --migracion <mig>.sql --migracion <mig>_DESHACER.sql --migracion <mig>.sql
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const args = process.argv.slice(2);
const opcion = n => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const schema = opcion('--schema') || 'supabase/schema.sql';
const migraciones = [];
for (let m = opcion('--migracion'); m; m = opcion('--migracion')) migraciones.push(m);
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error('Falta PGLITE_DIR (la carpeta donde se instaló @electric-sql/pglite).'); process.exit(2); }
if (!args.length) { console.error('Pasá al menos un archivo .sql de supabase/pruebas/.'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(path.join(dir, 'node_modules/@electric-sql/pglite/dist/index.js')).href);

const SUPABASE_DE_MENTIRA = `
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage; create schema cron; create schema extensions; create schema net;
create table auth.users (id uuid primary key, email text);
-- Como en Supabase, auth.uid(), auth.jwt() y auth.email() salen de los claims de la sesión
-- (26/10/2026). Sin claims dan null / '{}', como antes. Así una prueba puede "ser" una usuaria:
--   set local role authenticated; set local request.jwt.claims = '{"sub": "<uuid>", "email": "..."}';
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email' $$;
-- Permisos que Supabase da por defecto a sus roles (anon, authenticated, service_role) sobre lo
-- que se crea en public: tablas, secuencias y funciones. Sin esto, una prueba con
-- "set local role authenticated" chocaría con "permission denied" en vez de probar la RLS, y un
-- "revoke ... from public" parecería alcanzar para frenar a anon (en Supabase no alcanza).
grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create function auth.role() returns text language sql as $$ select 'authenticated' $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create table cron.job (jobid serial primary key, jobname text, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, c) returning jobid::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', params jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
create publication supabase_realtime;
`;
const textoSchema = fs.readFileSync(schema, 'utf8').replace(/^create extension[^\n]*\n/gim, '');

let fallas = 0;
for (const archivo of args) {
  const db = new PGlite(); // una base nueva por archivo
  try {
    await db.exec(SUPABASE_DE_MENTIRA);
    await db.exec(textoSchema);
    for (const m of migraciones) await db.exec(fs.readFileSync(m, 'utf8'));
    await db.exec(fs.readFileSync(archivo, 'utf8'));
    console.log(`OK     ${archivo}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA  ${archivo}: ${e.message}`);
  } finally {
    await db.close();
  }
}
process.exit(fallas ? 1 : 0);
