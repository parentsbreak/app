-- ============================================================================
-- Prueba de 20261029_avisos_chat.sql en un Postgres LOCAL (nunca en producción): la cola de avisos
-- (avisos, encolar_aviso, reclamar_avisos, programar_avisos, admins_activas_mails, el disparo
-- inmediato y el cron enviar-avisos) y el chat entre cada niñera y las admins (chat_mensajes, sus
-- políticas, ninera_enviar_mensaje, ninera_marcar_chat_leido, ninera_marcar_avisos_leidos y el
-- aviso de cada mensaje). Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_avisos_chat.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261029_avisos_chat.sql supabase/pruebas/fase1_avisos_chat.sql
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261029_avisos_chat.sql \
--     --migracion supabase/migraciones/20261029_avisos_chat_DESHACER.sql \
--     --migracion supabase/migraciones/20261029_avisos_chat.sql supabase/pruebas/fase1_avisos_chat.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- El DESHACER con mensajes (respaldo_chat_20261029) se prueba aparte: supabase/pruebas/deshacer/.
-- Para "ser" una cuenta: set local role authenticated + set local request.jwt.claims; reset role
-- vuelve a postgres. Todo termina en rollback.
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;
-- El mensaje del error que tira la sentencia, o null si no falla.
create function pg_temp.error_de(sentencia text) returns text language plpgsql as $$
begin
  execute sentencia;
  return null;
exception when others then
  return sqlerrm;
end $$;
-- Cuántas filas tocó la sentencia (un update o delete que la RLS frena toca 0, sin error).
create function pg_temp.filas_de(sentencia text) returns integer language plpgsql as $$
declare n integer;
begin
  execute sentencia;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Todo lo de la migración está (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('las dos tablas, con RLS',
  (select count(*) = 2 and bool_and(relrowsecurity) from pg_class
    where relnamespace = 'public'::regnamespace and relname in ('avisos', 'chat_mensajes') and relkind = 'r'));
select pg_temp.verificar('las seis políticas: 2 de avisos y 4 del chat, una vez cada una',
  (select count(*) = 6 from pg_policies where schemaname = 'public'
    and (tablename, policyname) in (('avisos', 'avisos_ninera_leer'), ('avisos', 'avisos_admins_leer'),
                                    ('chat_mensajes', 'chat_ninera_leer'), ('chat_mensajes', 'chat_admins_leer'),
                                    ('chat_mensajes', 'chat_admins_marcar'), ('chat_mensajes', 'chat_admins_escribir')))
  and (select count(*) = 6 from pg_policies where schemaname = 'public' and tablename in ('avisos', 'chat_mensajes')));
select pg_temp.verificar('avisos: solo políticas de lectura; chat: sin delete',
  not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'avisos' and cmd <> 'SELECT')
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_mensajes' and cmd in ('DELETE', 'ALL')));
select pg_temp.verificar('los cinco índices',
  (select count(*) = 5 from pg_indexes where schemaname = 'public'
    and indexname in ('idx_avisos_pendientes', 'idx_avisos_ninera', 'idx_chat_mensajes_ninera',
                      'idx_chat_mensajes_sin_leer_admin', 'idx_avisos_admins')));
-- Los parciales que leen Hoy y la campanita todo el tiempo (revisión final, 30/10/2026).
select pg_temp.verificar('índice parcial de los mensajes de niñeras sin leer por las admins',
  (select indexdef ilike '%chat_mensajes%(creado_en DESC)%WHERE%de = ''ninera''%leido_admin_en IS NULL%'
     from pg_indexes where schemaname = 'public' and indexname = 'idx_chat_mensajes_sin_leer_admin'));
select pg_temp.verificar('índice parcial de los avisos para las admins',
  (select indexdef ilike '%avisos%(creado_en DESC)%WHERE%para_admin IS NOT NULL%'
     from pg_indexes where schemaname = 'public' and indexname = 'idx_avisos_admins'));
select pg_temp.verificar('las once funciones: security definer con search_path fijo',
  (select count(*) = 11 from pg_proc
    where pronamespace = 'public'::regnamespace and prosecdef
      and proname in ('encolar_aviso', 'reclamar_avisos', 'programar_avisos', 'admins_activas_mails',
                      'ninera_enviar_mensaje', 'ninera_marcar_chat_leido', 'ninera_marcar_avisos_leidos',
                      'chat_mensajes_encolar_aviso', 'avisos_disparar_envio', 'llamar_enviar_avisos',
                      'correr_cron_avisos')
      and exists (select 1 from unnest(proconfig) c where c = 'search_path=public')));
select pg_temp.verificar('los dos triggers',
  (select count(*) = 2 from pg_trigger where not tgisinternal
    and ((tgname = 'chat_mensajes_aviso' and tgrelid = 'public.chat_mensajes'::regclass)
      or (tgname = 'avisos_enviar_ya' and tgrelid = 'public.avisos'::regclass))));
select pg_temp.verificar('avisos_enviar_ya: una vez por sentencia, con la tabla de las filas nuevas',
  (select pg_get_triggerdef(oid) like '%REFERENCING NEW TABLE AS nuevos FOR EACH STATEMENT%'
     from pg_trigger where tgname = 'avisos_enviar_ya' and tgrelid = 'public.avisos'::regclass));
select pg_temp.verificar('el cron enviar-avisos cada minuto, una sola vez: corre correr_cron_avisos()',
  (select count(*) = 1 and bool_and(schedule = '* * * * *' and command = 'select public.correr_cron_avisos();')
     from cron.job where jobname = 'enviar-avisos'));
select pg_temp.verificar('Realtime: las dos tablas en la publicación',
  (select count(*) = 2 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
    and tablename in ('avisos', 'chat_mensajes')));

-- Permisos: las internas, solo la base (triggers, cron) y la clave de servicio.
select pg_temp.verificar('las internas y los triggers: ni authenticated ni anon',
  not exists (select 1 from pg_proc p, unnest(array['authenticated', 'anon']) r
               where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('encolar_aviso', 'reclamar_avisos', 'programar_avisos', 'admins_activas_mails',
                                   'chat_mensajes_encolar_aviso', 'avisos_disparar_envio', 'llamar_enviar_avisos',
                                   'correr_cron_avisos')
                 and has_function_privilege(r, p.oid, 'execute')));
select pg_temp.verificar('reclamar_avisos, programar_avisos, admins_activas_mails y correr_cron_avisos: service_role sí',
  has_function_privilege('service_role', 'public.reclamar_avisos(integer)', 'execute')
  and has_function_privilege('service_role', 'public.correr_cron_avisos()', 'execute')
  and has_function_privilege('service_role', 'public.programar_avisos()', 'execute')
  and has_function_privilege('service_role', 'public.admins_activas_mails()', 'execute'));
select pg_temp.verificar('las tres de la niñera: authenticated sí, anon no',
  has_function_privilege('authenticated', 'public.ninera_enviar_mensaje(text)', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_marcar_chat_leido()', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_marcar_avisos_leidos()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_enviar_mensaje(text)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_marcar_chat_leido()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_marcar_avisos_leidos()', 'execute'));
select pg_temp.verificar('el chat: authenticated solo puede actualizar leido_admin_en',
  has_column_privilege('authenticated', 'public.chat_mensajes', 'leido_admin_en', 'update')
  and not has_column_privilege('authenticated', 'public.chat_mensajes', 'texto', 'update')
  and not has_column_privilege('authenticated', 'public.chat_mensajes', 'autor', 'update')
  and not has_column_privilege('authenticated', 'public.chat_mensajes', 'leido_ninera_en', 'update')
  and not has_column_privilege('anon', 'public.chat_mensajes', 'leido_admin_en', 'update'));
select pg_temp.verificar('el chat: authenticated inserta solo ninera_id, de, autor y texto',
  has_column_privilege('authenticated', 'public.chat_mensajes', 'ninera_id', 'insert')
  and has_column_privilege('authenticated', 'public.chat_mensajes', 'de', 'insert')
  and has_column_privilege('authenticated', 'public.chat_mensajes', 'autor', 'insert')
  and has_column_privilege('authenticated', 'public.chat_mensajes', 'texto', 'insert')
  and not has_column_privilege('authenticated', 'public.chat_mensajes', 'id', 'insert')
  and not has_column_privilege('authenticated', 'public.chat_mensajes', 'creado_en', 'insert')
  and not has_column_privilege('authenticated', 'public.chat_mensajes', 'leido_ninera_en', 'insert')
  and not has_column_privilege('authenticated', 'public.chat_mensajes', 'leido_admin_en', 'insert')
  and not has_column_privilege('anon', 'public.chat_mensajes', 'texto', 'insert'));

-- ---------------------------------------------------------------------------
-- Datos inventados: dos admins (una dada de baja), dos niñeras con cuenta (Ana y Bruno) y una sin
-- la app (Carla)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e1000000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('e1000000-0000-4000-8000-0000000000a2', 'admin.de.baja@ejemplo.invalid'),
  ('e1000000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid'),
  ('e1000000-0000-4000-8000-000000000002', '59899000002@ninieras.parentsbreak.invalid');
insert into usuarias_autorizadas (user_id, rol, activa) values
  ('e1000000-0000-4000-8000-0000000000a1', 'desarrollo', true),
  ('e1000000-0000-4000-8000-0000000000a2', 'socia', false);
insert into ninieras (id, nombre, telefono, user_id) values
  ('e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', 'e1000000-0000-4000-8000-000000000002'),
  ('e2000000-0000-4000-8000-000000000003', 'Carla Sin App', '099000003', null);

-- net.http_post de mentira que anota cada llamada, para ver qué dispara el trigger avisos_enviar_ya.
create table public.prueba_http_posts (url text, headers jsonb, body jsonb, timeout_ms int);
create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', params jsonb default '{}', timeout_milliseconds int default 1000)
returns bigint language plpgsql as $$
begin
  insert into public.prueba_http_posts values (url, headers, body, timeout_milliseconds);
  return 1;
end $$;

-- ---------------------------------------------------------------------------
-- La cola (como postgres: las internas las usa la base)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('encolar_aviso la primera vez: true',
  public.encolar_aviso('prueba:1', 'e2000000-0000-4000-8000-000000000001', null, 'prueba', 'Título', 'Cuerpo', '#inicio'));
select pg_temp.verificar('encolar_aviso con la misma clave: false, sin pisar la fila',
  not public.encolar_aviso('prueba:1', null, 'todas', 'otro', 'Otro título', 'Otro cuerpo', null));
select pg_temp.verificar('una sola fila con esa clave, la primera, con datos {} por defecto',
  (select count(*) = 1 and bool_and(para_ninera_id = 'e2000000-0000-4000-8000-000000000001' and para_admin is null
                                    and tipo = 'prueba' and titulo = 'Título' and datos = '{}'::jsonb
                                    and intentos = 0 and enviado_en is null and leido_en is null)
     from avisos where clave = 'prueba:1'));
select pg_temp.verificar('un solo destinatario: ninguno → falla el check',
  pg_temp.error_de($$insert into avisos (clave, tipo, titulo) values ('prueba:sin', 'prueba', 'x')$$) like '%avisos_un_destinatario%');
select pg_temp.verificar('un solo destinatario: los dos → falla el check',
  pg_temp.error_de($$insert into avisos (clave, para_ninera_id, para_admin, tipo, titulo)
                      values ('prueba:dos', 'e2000000-0000-4000-8000-000000000001', 'todas', 'prueba', 'x')$$) like '%avisos_un_destinatario%');
select pg_temp.verificar('encolar_aviso sin destinatario también falla',
  pg_temp.error_de($$select public.encolar_aviso('prueba:nadie', null, null, 'prueba', 'x', 'y', null)$$) like '%avisos_un_destinatario%');

-- Disparo inmediato (trigger avisos_enviar_ya). Sin la clave en app_secrets no llama a nada y el
-- aviso queda igual (lo manda el cron).
-- (La llamada y lo que se verifica van en sentencias separadas: una subconsulta de la misma
-- sentencia no ve lo que insertó la función.)
select pg_temp.verificar('sin cron_push_secret: encolar_aviso guarda el aviso',
  public.encolar_aviso('prueba:sin-secreto', null, 'todas', 'prueba', 'x', 'y', null));
select pg_temp.verificar('sin cron_push_secret: no se llama a la función',
  exists (select 1 from avisos where clave = 'prueba:sin-secreto') and (select count(*) = 0 from public.prueba_http_posts));
insert into app_secrets (clave, valor) values ('cron_push_secret', 'secreto-de-prueba');
select pg_temp.verificar('con la clave: encolar_aviso para ya',
  public.encolar_aviso('prueba:ya', null, 'todas', 'prueba', 'x', 'y', null));
select pg_temp.verificar('con la clave: un aviso para ya llama una vez a enviar-avisos con x-cron-secret',
  (select count(*) = 1
              and bool_and(url = 'https://wvewzamdohrpfhpccvcz.supabase.co/functions/v1/enviar-avisos'
                           and headers ->> 'x-cron-secret' = 'secreto-de-prueba')
         from public.prueba_http_posts));
-- pg_net corta a los 5 s por defecto y enviar-avisos tarda hasta su plazo total de un minuto (30/10/2026).
select pg_temp.verificar('la llamada espera hasta un minuto (timeout_milliseconds 60000)',
  (select bool_and(timeout_ms = 60000) from public.prueba_http_posts));
select pg_temp.verificar('encolar_aviso para dentro de una hora',
  public.encolar_aviso('prueba:futuro', 'e2000000-0000-4000-8000-000000000001', null, 'prueba', 'x', 'y', null,
                       '{}'::jsonb, now() + interval '1 hour'));
select pg_temp.verificar('un aviso para más tarde no llama a nada (lo manda el cron cuando toque)',
  (select count(*) = 1 from public.prueba_http_posts));
-- Si el post falla, el aviso se guarda igual (sin raise): lo manda el cron.
create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', params jsonb default '{}', timeout_milliseconds int default 1000)
returns bigint language plpgsql as $$ begin raise exception 'pg_net caído'; end $$;
select pg_temp.verificar('si net.http_post falla, encolar_aviso no falla',
  pg_temp.error_de($$select public.encolar_aviso('prueba:post-roto', null, 'todas', 'prueba', 'x', 'y', null)$$) is null);
select pg_temp.verificar('si net.http_post falla, el aviso queda en la cola para el cron',
  exists (select 1 from avisos where clave = 'prueba:post-roto' and enviado_en is null));
create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', params jsonb default '{}', timeout_milliseconds int default 1000)
returns bigint language plpgsql as $$
begin
  insert into public.prueba_http_posts values (url, headers, body, timeout_milliseconds);
  return 1;
end $$;

-- programar_avisos: con la temporada de todas cargada, la regla de la temporada (etapa 9, de octubre
-- a diciembre) no encola nada y las demás reglas todavía no existen.
update ninieras set temporada_actualizada_en = now();
select pg_temp.verificar('programar_avisos() devuelve 0', public.programar_avisos() = 0);

-- reclamar_avisos: atómico, una sola entrega aunque lo llamen el trigger y el cron a la vez.
-- Pendientes ahora: prueba:1, prueba:sin-secreto, prueba:ya, prueba:post-roto (prueba:futuro no).
update avisos set enviar_desde = now() - interval '10 minutes' where clave = 'prueba:1';
create temp table reclamo1 as select * from public.reclamar_avisos(1);
select pg_temp.verificar('reclamar_avisos(1): solo el más viejo',
  (select count(*) = 1 and bool_and(clave = 'prueba:1' and intentos = 1 and enviado_en is not null) from reclamo1));
create temp table reclamo2 as select * from public.reclamar_avisos(50);
create temp table reclamo3 as select * from public.reclamar_avisos(50);
select pg_temp.verificar('reclamar_avisos(50): los otros tres pendientes, sin el del futuro ni el ya reclamado',
  (select count(*) = 3 and bool_and(intentos = 1) from reclamo2)
  and not exists (select 1 from reclamo2 where clave in ('prueba:futuro', 'prueba:1')));
select pg_temp.verificar('dos reclamos seguidos: el segundo no devuelve nada',
  (select count(*) = 0 from reclamo3));
select pg_temp.verificar('el del futuro sigue sin reclamar',
  (select enviado_en is null and intentos = 0 from avisos where clave = 'prueba:futuro'));
-- Reintento (lo hace enviar-avisos al fallar): vuelve a la cola y suma otro intento.
update avisos set enviado_en = null, error = 'falló', enviar_desde = now() where clave = 'prueba:1';
select pg_temp.verificar('un reintento se reclama de nuevo y suma intentos',
  (select count(*) = 1 and bool_and(clave = 'prueba:1' and intentos = 2) from public.reclamar_avisos(50)));

-- El disparo es uno por sentencia (29/10/2026, revisión): un pedido a varias niñeras o
-- programar_avisos encolan muchos de una vez.
truncate public.prueba_http_posts;
insert into avisos (clave, para_admin, tipo, titulo) values
  ('prueba:lote:1', 'todas', 'prueba', 'x'), ('prueba:lote:2', 'todas', 'prueba', 'x'), ('prueba:lote:3', 'todas', 'prueba', 'x');
select pg_temp.verificar('tres avisos para ya en una sola sentencia: una sola llamada',
  (select count(*) = 1 from public.prueba_http_posts) and (select count(*) = 3 from avisos where clave like 'prueba:lote:%'));
truncate public.prueba_http_posts;
insert into avisos (clave, para_admin, tipo, titulo, enviar_desde) values
  ('prueba:mas-tarde:1', 'todas', 'prueba', 'x', now() + interval '1 hour'),
  ('prueba:mas-tarde:2', 'todas', 'prueba', 'x', now() + interval '2 hours');
select pg_temp.verificar('solo avisos para más tarde: ninguna llamada',
  (select count(*) = 0 from public.prueba_http_posts));
select pg_temp.verificar('encolar_aviso con una clave repetida (no inserta nada)',
  not public.encolar_aviso('prueba:lote:1', null, 'todas', 'prueba', 'x', 'y', null));
select pg_temp.verificar('una clave repetida no llama a nada',
  (select count(*) = 0 from public.prueba_http_posts));

-- correr_cron_avisos (lo que corre el cron cada minuto): llama a enviar-avisos solo si hay algo
-- pendiente para ya.
select pg_temp.verificar('se reclaman los tres del lote', (select count(*) = 3 from public.reclamar_avisos(50)));
select public.correr_cron_avisos();
select pg_temp.verificar('cron sin pendientes para ya (solo los de más tarde): ninguna llamada',
  (select count(*) = 0 from public.prueba_http_posts));
update avisos set enviado_en = null where clave = 'prueba:lote:1';
select public.correr_cron_avisos();
select pg_temp.verificar('cron con uno pendiente: una llamada con x-cron-secret',
  (select count(*) = 1 and bool_and(url = 'https://wvewzamdohrpfhpccvcz.supabase.co/functions/v1/enviar-avisos'
                                    and headers ->> 'x-cron-secret' = 'secreto-de-prueba')
     from public.prueba_http_posts));
delete from app_secrets where clave = 'cron_push_secret';
select pg_temp.verificar('cron sin la clave: no falla y no llama',
  pg_temp.error_de('select public.correr_cron_avisos()') is null);
select pg_temp.verificar('cron sin la clave: sigue en una llamada', (select count(*) = 1 from public.prueba_http_posts));
insert into app_secrets (clave, valor) values ('cron_push_secret', 'secreto-de-prueba');
select pg_temp.verificar('se reclama el pendiente', (select count(*) = 1 from public.reclamar_avisos(50)));

-- admins_activas_mails: solo las activas (como service_role, la que la usa).
set local role service_role;
select pg_temp.verificar('admins_activas_mails(): la activa sí, la dada de baja no',
  (select array_agg(m) = array['admin.prueba@ejemplo.invalid'] from public.admins_activas_mails() m));
reset role;

-- El chat de Bruno y dos mensajes de la admin a Ana sin leer (como postgres, para tener qué no ver).
insert into chat_mensajes (ninera_id, de, autor, texto, creado_en) values
  ('e2000000-0000-4000-8000-000000000002', 'admin', 'Paula Prueba', 'Hola Bruno', now() - interval '3 hours'),
  ('e2000000-0000-4000-8000-000000000002', 'ninera', 'Bruno Ejemplo', 'Hola equipo', now() - interval '2 hours'),
  ('e2000000-0000-4000-8000-000000000001', 'admin', 'Paula Prueba', 'Hola Ana', now() - interval '2 hours'),
  ('e2000000-0000-4000-8000-000000000001', 'admin', 'Dora Prueba', '¿Todo bien?', now() - interval '1 hour');
select pg_temp.verificar('cada mensaje de una admin encoló su aviso chat:<id> para la niñera',
  (select count(*) = 3 from chat_mensajes m join avisos a on a.clave = 'chat:' || m.id
    where m.de = 'admin' and a.para_ninera_id = m.ninera_id and a.tipo = 'chat'));
select pg_temp.verificar('el de Bruno encoló admin:chat:<id> para todas',
  (select count(*) = 1 from chat_mensajes m join avisos a on a.clave = 'admin:chat:' || m.id
    where m.de = 'ninera' and a.para_admin = 'todas'));

-- ---------------------------------------------------------------------------
-- Desde la cuenta de Ana
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('es Ana', public.ninera_actual() = 'e2000000-0000-4000-8000-000000000001');
select pg_temp.verificar('ninera_enviar_mensaje("  hola  "): guarda "hola", de ninera, con el nombre de su ficha',
  (select texto = 'hola' and de = 'ninera' and autor = 'Ana Ficticia'
          and ninera_id = 'e2000000-0000-4000-8000-000000000001' and leido_ninera_en is null and leido_admin_en is null
     from public.ninera_enviar_mensaje('  hola  ')));
select pg_temp.verificar('vacío, solo espacios, renglones en blanco o null: mensaje_vacio',
  pg_temp.error_de($$select public.ninera_enviar_mensaje('')$$) like '%mensaje_vacio%'
  and pg_temp.error_de($$select public.ninera_enviar_mensaje('     ')$$) like '%mensaje_vacio%'
  and pg_temp.error_de($$select public.ninera_enviar_mensaje(E' \n\t\r\n ')$$) like '%mensaje_vacio%'
  and pg_temp.error_de($$select public.ninera_enviar_mensaje(null)$$) like '%mensaje_vacio%');
select pg_temp.verificar('2.001 caracteres: mensaje_largo',
  pg_temp.error_de($$select public.ninera_enviar_mensaje(repeat('a', 2001))$$) like '%mensaje_largo%');
select pg_temp.verificar('2.000 caracteres con espacios alrededor: pasa (cuenta sin los espacios)',
  (select char_length(texto) = 2000 from public.ninera_enviar_mensaje('  ' || repeat('b', 2000) || '  ')));
select pg_temp.verificar('HTML: se guarda tal cual, como texto',
  (select texto = '<img src=x onerror=alert(1)> "hola"' from public.ninera_enviar_mensaje('<img src=x onerror=alert(1)> "hola"')));
select pg_temp.verificar('renglones de adentro se conservan',
  (select texto = E'línea 1\nlínea 2' from public.ninera_enviar_mensaje(E'\n línea 1\nlínea 2 \n')));
select pg_temp.verificar('Ana lee solo su chat: sus 4 y los 2 de la admin, 0 de Bruno',
  (select count(*) = 6 and bool_and(ninera_id = 'e2000000-0000-4000-8000-000000000001') from chat_mensajes));
select pg_temp.verificar('Ana lee solo sus avisos: ni los de todas ni los de Bruno',
  (select count(*) >= 1 and bool_and(para_ninera_id = 'e2000000-0000-4000-8000-000000000001' and para_admin is null) from avisos));
select pg_temp.verificar('Ana no escribe directo en chat_mensajes (RLS), ni como niñera ni como admin',
  pg_temp.error_de($$insert into chat_mensajes (ninera_id, de, autor, texto)
                      values ('e2000000-0000-4000-8000-000000000001', 'ninera', 'Ana Ficticia', 'directo')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into chat_mensajes (ninera_id, de, autor, texto)
                          values ('e2000000-0000-4000-8000-000000000001', 'admin', 'Paula Prueba', 'me hago pasar')$$) like '%row-level security%');
select pg_temp.verificar('Ana no escribe directo en avisos (RLS)',
  pg_temp.error_de($$insert into avisos (clave, para_ninera_id, tipo, titulo)
                      values ('trucho', 'e2000000-0000-4000-8000-000000000001', 'chat', 'x')$$) like '%row-level security%');
select pg_temp.verificar('Ana no cambia el texto de un mensaje (sin permiso) ni marca leido_admin_en (0 filas)',
  pg_temp.error_de($$update chat_mensajes set texto = 'otro' where texto = 'hola'$$) like '%permission denied%'
  and pg_temp.filas_de($$update chat_mensajes set leido_admin_en = now()$$) = 0);
select pg_temp.verificar('Ana no borra mensajes ni avisos (0 filas)',
  pg_temp.filas_de($$delete from chat_mensajes$$) = 0 and pg_temp.filas_de($$delete from avisos$$) = 0);
select pg_temp.verificar('Ana no ejecuta las internas',
  pg_temp.error_de($$select public.encolar_aviso('x', null, 'todas', 'x', 'x', 'x', null)$$) like '%permission denied%'
  and pg_temp.error_de($$select * from public.reclamar_avisos(50)$$) like '%permission denied%'
  and pg_temp.error_de($$select public.programar_avisos()$$) like '%permission denied%'
  and pg_temp.error_de($$select * from public.admins_activas_mails()$$) like '%permission denied%');
select pg_temp.verificar('ninera_marcar_chat_leido: los 2 de la admin',
  public.ninera_marcar_chat_leido() = 2);
select pg_temp.verificar('después: los de la admin leídos, los suyos sin tocar',
  (select bool_and(leido_ninera_en is not null) from chat_mensajes where de = 'admin')
  and (select bool_and(leido_ninera_en is null) from chat_mensajes where de = 'ninera'));
select pg_temp.verificar('ninera_marcar_chat_leido otra vez: 0', public.ninera_marcar_chat_leido() = 0);
reset role;
select pg_temp.verificar('Ana mandó 4: cada uno con su aviso admin:chat:<id> para todas, con su nombre y el link a su ficha',
  (select count(*) = 4
          and bool_and(a.para_admin = 'todas' and a.para_ninera_id is null and a.tipo = 'chat'
                       and a.titulo = 'Ana Ficticia' and a.cuerpo = left(m.texto, 120)
                       and a.url = '?ir=ninieras&ninera=e2000000-0000-4000-8000-000000000001'
                       and a.datos = jsonb_build_object('mensaje_id', m.id, 'ninera_id', m.ninera_id))
     from chat_mensajes m join avisos a on a.clave = 'admin:chat:' || m.id
    where m.ninera_id = 'e2000000-0000-4000-8000-000000000001' and m.de = 'ninera'));
select pg_temp.verificar('el del texto largo: cuerpo recortado a 120',
  (select char_length(a.cuerpo) = 120 from chat_mensajes m join avisos a on a.clave = 'admin:chat:' || m.id
    where char_length(m.texto) = 2000));
select pg_temp.verificar('el mensaje de Bruno sigue sin leer por él',
  (select leido_ninera_en is null from chat_mensajes where texto = 'Hola Bruno'));
-- Avisos sin leer: 4 de Ana (prueba:1, prueba:futuro y los 2 del chat) y 1 de Bruno.
select pg_temp.verificar('antes de marcar: 4 de Ana y 1 de Bruno sin leer',
  (select count(*) = 4 from avisos where para_ninera_id = 'e2000000-0000-4000-8000-000000000001' and leido_en is null)
  and (select count(*) = 1 from avisos where para_ninera_id = 'e2000000-0000-4000-8000-000000000002' and leido_en is null));
set local role authenticated;
select pg_temp.verificar('ninera_marcar_avisos_leidos: sus 4, y otra vez 0',
  public.ninera_marcar_avisos_leidos() = 4 and public.ninera_marcar_avisos_leidos() = 0);
reset role;
select pg_temp.verificar('los de Bruno y los de todas siguen sin leer',
  (select count(*) = 1 from avisos where para_ninera_id = 'e2000000-0000-4000-8000-000000000002' and leido_en is null)
  and not exists (select 1 from avisos where para_admin is not null and leido_en is not null));

-- ---------------------------------------------------------------------------
-- Desde la cuenta de Bruno
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Bruno ve solo su chat (2) y su aviso (1)',
  (select count(*) = 2 and bool_and(ninera_id = 'e2000000-0000-4000-8000-000000000002') from chat_mensajes)
  and (select count(*) = 1 and bool_and(para_ninera_id = 'e2000000-0000-4000-8000-000000000002') from avisos));
reset role;
-- Dado de baja: ninera_actual() es null, no escribe ni ve nada.
update ninieras set activa = false where id = 'e2000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.verificar('Bruno dado de baja: no_autorizada, 0 al marcar y no ve nada',
  pg_temp.error_de($$select public.ninera_enviar_mensaje('hola')$$) like '%no_autorizada%'
  and public.ninera_marcar_chat_leido() = 0 and public.ninera_marcar_avisos_leidos() = 0
  and (select count(*) = 0 from chat_mensajes) and (select count(*) = 0 from avisos));
reset role;
update ninieras set activa = true where id = 'e2000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- Desde la cuenta de la admin
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('la admin escribe a Ana (insert con de admin)',
  pg_temp.error_de($$insert into chat_mensajes (ninera_id, de, autor, texto)
                      values ('e2000000-0000-4000-8000-000000000001', 'admin', 'Paula Prueba', 'Mensaje largo ' || repeat('z', 200))$$) is null);
select pg_temp.verificar('la admin no puede poner leido_ninera_en al escribir (sin permiso)',
  pg_temp.error_de($$insert into chat_mensajes (ninera_id, de, autor, texto, leido_ninera_en)
                      values ('e2000000-0000-4000-8000-000000000001', 'admin', 'Paula Prueba', 'ya leído', now())$$) like '%permission denied%');
select pg_temp.verificar('la admin no le escribe a una niñera sin la app (RLS)',
  pg_temp.error_de($$insert into chat_mensajes (ninera_id, de, autor, texto)
                      values ('e2000000-0000-4000-8000-000000000003', 'admin', 'Paula Prueba', 'hola Carla')$$) like '%row-level security%');
reset role;
update ninieras set activa = false where id = 'e2000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.verificar('la admin no le escribe a una niñera dada de baja (RLS)',
  pg_temp.error_de($$insert into chat_mensajes (ninera_id, de, autor, texto)
                      values ('e2000000-0000-4000-8000-000000000002', 'admin', 'Paula Prueba', 'hola Bruno')$$) like '%row-level security%');
reset role;
update ninieras set activa = true where id = 'e2000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.verificar('la admin no puede escribir como niñera (RLS)',
  pg_temp.error_de($$insert into chat_mensajes (ninera_id, de, autor, texto)
                      values ('e2000000-0000-4000-8000-000000000001', 'ninera', 'Ana Ficticia', 'trucho')$$) like '%row-level security%');
select pg_temp.verificar('la admin: texto vacío, solo espacios o de 2.001 caracteres no se guarda (check)',
  pg_temp.error_de($$insert into chat_mensajes (ninera_id, de, autor, texto)
                      values ('e2000000-0000-4000-8000-000000000001', 'admin', 'Paula Prueba', '   ')$$) like '%chat_mensajes_texto_check%'
  and pg_temp.error_de($$insert into chat_mensajes (ninera_id, de, autor, texto)
                          values ('e2000000-0000-4000-8000-000000000001', 'admin', 'Paula Prueba', E'\n\n')$$) like '%chat_mensajes_texto_check%'
  and pg_temp.error_de($$insert into chat_mensajes (ninera_id, de, autor, texto)
                          values ('e2000000-0000-4000-8000-000000000001', 'admin', 'Paula Prueba', repeat('a', 2001))$$) like '%chat_mensajes_texto_check%');
select pg_temp.verificar('la admin lee los dos chats',
  (select count(distinct ninera_id) = 2 from chat_mensajes));
select pg_temp.verificar('la admin lee los avisos de todas y ninguno de una niñera',
  (select count(*) > 0 from avisos where para_admin = 'todas')
  and not exists (select 1 from avisos where para_ninera_id is not null));
select pg_temp.verificar('la admin marca leido_admin_en de los de Ana',
  pg_temp.filas_de($$update chat_mensajes set leido_admin_en = now()
                      where ninera_id = 'e2000000-0000-4000-8000-000000000001' and de = 'ninera' and leido_admin_en is null$$) = 4);
select pg_temp.verificar('la admin no cambia el texto ni el autor de un mensaje (sin permiso)',
  pg_temp.error_de($$update chat_mensajes set texto = 'cambiado' where texto = 'hola'$$) like '%permission denied%'
  and pg_temp.error_de($$update chat_mensajes set autor = 'Otra' where texto = 'hola'$$) like '%permission denied%');
select pg_temp.verificar('la admin no borra mensajes (0 filas)', pg_temp.filas_de($$delete from chat_mensajes$$) = 0);
select pg_temp.verificar('la admin no escribe avisos directo (RLS)',
  pg_temp.error_de($$insert into avisos (clave, para_admin, tipo, titulo) values ('trucho', 'todas', 'x', 'x')$$) like '%row-level security%');
select pg_temp.verificar('la admin: las funciones de la niñera no le sirven',
  pg_temp.error_de($$select public.ninera_enviar_mensaje('hola')$$) like '%no_autorizada%'
  and public.ninera_marcar_chat_leido() = 0 and public.ninera_marcar_avisos_leidos() = 0);
select pg_temp.verificar('la admin no ejecuta las internas',
  pg_temp.error_de($$select public.encolar_aviso('x', null, 'todas', 'x', 'x', 'x', null)$$) like '%permission denied%'
  and pg_temp.error_de($$select * from public.reclamar_avisos(50)$$) like '%permission denied%'
  and pg_temp.error_de($$select public.programar_avisos()$$) like '%permission denied%'
  and pg_temp.error_de($$select * from public.admins_activas_mails()$$) like '%permission denied%');
reset role;
select pg_temp.verificar('el mensaje de la admin encoló chat:<id> para Ana, con el autor de título y el texto recortado a 120',
  (select count(*) = 1
          and bool_and(a.para_ninera_id = 'e2000000-0000-4000-8000-000000000001' and a.para_admin is null
                       and a.tipo = 'chat' and a.titulo = 'Paula Prueba' and a.url = '#chat'
                       and a.cuerpo = left('Mensaje largo ' || repeat('z', 200), 120) and char_length(a.cuerpo) = 120
                       and a.datos = jsonb_build_object('mensaje_id', m.id))
     from chat_mensajes m join avisos a on a.clave = 'chat:' || m.id
    where m.texto like 'Mensaje largo %'));
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000a2", "email": "admin.de.baja@ejemplo.invalid"}';
select pg_temp.verificar('la admin dada de baja: 0 mensajes, 0 avisos y no escribe',
  (select count(*) = 0 from chat_mensajes) and (select count(*) = 0 from avisos)
  and pg_temp.error_de($$insert into chat_mensajes (ninera_id, de, autor, texto)
                          values ('e2000000-0000-4000-8000-000000000001', 'admin', 'De Baja', 'hola')$$) like '%row-level security%');
reset role;

-- ---------------------------------------------------------------------------
-- Sin sesión (anon): nada
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '';
set local role anon;
select pg_temp.verificar('anon: no lee mensajes ni avisos',
  (select count(*) = 0 from chat_mensajes) and (select count(*) = 0 from avisos));
select pg_temp.verificar('anon: no escribe en el chat',
  pg_temp.error_de($$insert into chat_mensajes (ninera_id, de, autor, texto)
                      values ('e2000000-0000-4000-8000-000000000001', 'admin', 'Nadie', 'hola')$$) is not null);
select pg_temp.verificar('anon: permission denied en las de la niñera y en las internas',
  pg_temp.error_de($$select public.ninera_enviar_mensaje('hola')$$) like '%permission denied%'
  and pg_temp.error_de($$select public.ninera_marcar_chat_leido()$$) like '%permission denied%'
  and pg_temp.error_de($$select public.ninera_marcar_avisos_leidos()$$) like '%permission denied%'
  and pg_temp.error_de($$select public.encolar_aviso('x', null, 'todas', 'x', 'x', 'x', null)$$) like '%permission denied%'
  and pg_temp.error_de($$select * from public.reclamar_avisos(50)$$) like '%permission denied%'
  and pg_temp.error_de($$select public.programar_avisos()$$) like '%permission denied%'
  and pg_temp.error_de($$select * from public.admins_activas_mails()$$) like '%permission denied%');
reset role;

-- ---------------------------------------------------------------------------
-- Borrar la ficha de una niñera borra su chat y sus avisos (on delete cascade)
-- ---------------------------------------------------------------------------
delete from ninieras where id = 'e2000000-0000-4000-8000-000000000002';
select pg_temp.verificar('sin la ficha de Bruno: ni sus mensajes ni sus avisos',
  not exists (select 1 from chat_mensajes where ninera_id = 'e2000000-0000-4000-8000-000000000002')
  and not exists (select 1 from avisos where para_ninera_id = 'e2000000-0000-4000-8000-000000000002'));

rollback;
