-- ============================================================================
-- Prueba de 20261101_temporada_app.sql en un Postgres LOCAL (nunca en producción): la temporada que
-- carga la niñera desde la app (ninera_mi_temporada, ninera_guardar_temporada), el inicio de la
-- temporada (inicio_temporada_mvd) y la regla de avisos (programar_avisos_temporada). Datos
-- inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_temporada.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261101_temporada_app.sql \
--     --migracion supabase/migraciones/20261101_temporada_app_DESHACER.sql \
--     --migracion supabase/migraciones/20261101_temporada_app.sql supabase/pruebas/fase1_temporada.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
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
-- Las 24 quincenas con el mismo lugar, para armar casos.
create function pg_temp.todas(lugar text) returns jsonb language sql as $$
  select jsonb_object_agg(q::text, lugar) from generate_series(0, 23) q
$$;

-- ---------------------------------------------------------------------------
-- Todo lo de la migración está (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('dos columnas nuevas en ninieras',
  (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'ninieras'
    and column_name in ('temporada_lugares', 'temporada_lugares_en')));
select pg_temp.verificar('las cuatro funciones nuevas',
  (select count(*) = 4 from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('inicio_temporada_mvd', 'ninera_mi_temporada', 'ninera_guardar_temporada', 'programar_avisos_temporada')));
select pg_temp.verificar('las dos de la niñera y la regla: security definer con search_path fijo',
  (select count(*) = 3 from pg_proc
    where pronamespace = 'public'::regnamespace and prosecdef
      and proname in ('ninera_mi_temporada', 'ninera_guardar_temporada', 'programar_avisos_temporada')
      and exists (select 1 from unnest(proconfig) c where c like 'search_path=%')));
select pg_temp.verificar('inicio_temporada_mvd no es security definer',
  not (select prosecdef from pg_proc where oid = 'public.inicio_temporada_mvd'::regproc));
select pg_temp.verificar('las de la niñera: authenticated sí, anon no',
  has_function_privilege('authenticated', 'public.ninera_mi_temporada()', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_guardar_temporada(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_mi_temporada()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_guardar_temporada(jsonb)', 'execute'));
select pg_temp.verificar('la regla: ni authenticated ni anon',
  not has_function_privilege('authenticated', 'public.programar_avisos_temporada(timestamp with time zone)', 'execute')
  and not has_function_privilege('anon', 'public.programar_avisos_temporada(timestamp with time zone)', 'execute'));
select pg_temp.verificar('programar_avisos llama a la regla de la temporada',
  pg_get_functiondef('public.programar_avisos'::regproc) like '%programar_avisos_temporada()%');
select pg_temp.verificar('ninera_mi_temporada no devuelve plata ni datos de otras',
  pg_get_functiondef('public.ninera_mi_temporada'::regproc) not like '%cobro%'
  and pg_get_functiondef('public.ninera_mi_temporada'::regproc) not like '%pago%');

-- ---------------------------------------------------------------------------
-- inicio_temporada_mvd: el 1/9 a las 0:00 de Montevideo (03:00 UTC)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('15/10/2026 → 1/9/2026',
  public.inicio_temporada_mvd('2026-10-15 12:00-03') = '2026-09-01 00:00-03'::timestamptz);
select pg_temp.verificar('1/9/2026 a las 0:30 de Montevideo → 1/9/2026',
  public.inicio_temporada_mvd('2026-09-01 00:30-03') = '2026-09-01 00:00-03'::timestamptz);
select pg_temp.verificar('31/8/2026 a las 23:30 de Montevideo (ya 1/9 en UTC) → 1/9/2025',
  public.inicio_temporada_mvd('2026-08-31 23:30-03') = '2025-09-01 00:00-03'::timestamptz);
select pg_temp.verificar('15/2/2027 (en pleno verano) → 1/9/2026',
  public.inicio_temporada_mvd('2027-02-15 12:00-03') = '2026-09-01 00:00-03'::timestamptz);

-- ---------------------------------------------------------------------------
-- Datos inventados: una admin; Ana (Centro), Bruno (Punta del Este) y Carla (jose ignacio, sin tilde)
-- con app; Dora sin app; Eva con app pero dada de baja.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d1000000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('d1000000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid'),
  ('d1000000-0000-4000-8000-000000000002', '59899000002@ninieras.parentsbreak.invalid'),
  ('d1000000-0000-4000-8000-000000000003', '59899000003@ninieras.parentsbreak.invalid'),
  ('d1000000-0000-4000-8000-000000000005', '59899000005@ninieras.parentsbreak.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('d1000000-0000-4000-8000-0000000000a1', 'desarrollo');
insert into zona_grupos (id, nombre, zonas, orden, fuera_de_montevideo) values
  ('d6000000-0000-4000-8000-000000000001', 'Centro', array['Cordón'], 1, false),
  ('d6000000-0000-4000-8000-000000000003', 'Punta del Este', array['La Barra', 'José Ignacio'], 3, true);
insert into ninieras (id, nombre, telefono, user_id, activa, zona, temporada_comentario) values
  ('d2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'd1000000-0000-4000-8000-000000000001', true, 'Centro', 'comentario viejo'),
  ('d2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', 'd1000000-0000-4000-8000-000000000002', true, 'Punta del Este', null),
  ('d2000000-0000-4000-8000-000000000003', 'Carla Prueba', '099000003', 'd1000000-0000-4000-8000-000000000003', true, 'jose ignacio', null),
  ('d2000000-0000-4000-8000-000000000004', 'Dora Sinapp', '099000004', null, true, 'Centro', null),
  ('d2000000-0000-4000-8000-000000000005', 'Eva Debaja', '099000005', 'd1000000-0000-4000-8000-000000000005', false, 'Centro', null);

-- ---------------------------------------------------------------------------
-- Ana: lo que ve sin temporada y lo que no se puede guardar
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('es Ana', public.ninera_actual() = 'd2000000-0000-4000-8000-000000000001');
select pg_temp.verificar('Ana sin temporada: no está al día, sin lugares, no vive afuera',
  public.ninera_mi_temporada() = '{"lugares": null, "al_dia": false, "solo_afuera": false}'::jsonb);
select pg_temp.verificar('inválidos: null, 23 quincenas, una de más, la "24", un lugar que no existe, un número',
  pg_temp.error_de('select public.ninera_guardar_temporada(null)') like '%temporada_invalida%'
  and pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo') - '23')$$) like '%temporada_invalida%'
  and pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo') || '{"x": "punta"}')$$) like '%temporada_invalida%'
  and pg_temp.error_de($$select public.ninera_guardar_temporada((pg_temp.todas('montevideo') - '23') || '{"24": "punta"}')$$) like '%temporada_invalida%'
  and pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo') || '{"5": "playa"}')$$) like '%temporada_invalida%'
  and pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo') || '{"5": 3}')$$) like '%temporada_invalida%'
  and pg_temp.error_de($$select public.ninera_guardar_temporada('[]')$$) like '%temporada_invalida%');
select pg_temp.verificar('inválidos: "Otro" vacío, solo espacios, de 81 caracteres, con otra clave o sin texto',
  pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo') || '{"5": {"otro": ""}}')$$) like '%temporada_invalida%'
  and pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo') || '{"5": {"otro": "   "}}')$$) like '%temporada_invalida%'
  and pg_temp.error_de(format('select public.ninera_guardar_temporada(pg_temp.todas(%L) || jsonb_build_object(%L, jsonb_build_object(%L, %L)))',
        'montevideo', '5', 'otro', repeat('x', 81))) like '%temporada_invalida%'
  and pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo') || '{"5": {"otro": "Rocha", "x": 1}}')$$) like '%temporada_invalida%'
  and pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo') || '{"5": {"otro": 7}}')$$) like '%temporada_invalida%'
  and pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo') || '{"5": "otro"}')$$) like '%temporada_invalida%');
reset role;
select pg_temp.verificar('nada se guardó con los inválidos',
  (select temporada_lugares is null and temporada is null and temporada_actualizada_en is null
     from ninieras where id = 'd2000000-0000-4000-8000-000000000001'));

-- ---------------------------------------------------------------------------
-- Ana guarda: todo el verano en Punta, fuera del país la 1ra de marzo y "Otro" la 2da
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Ana guarda sin error',
  pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo')
    || '{"23": "punta", "0": "punta", "1": "punta", "2": "punta", "3": "punta", "4": "fuera_pais", "5": {"otro": "  Rocha  "}, "6": "la_paloma"}')$$) is null);
reset role;
select pg_temp.verificar('quedan los lugares, con "Otro" sin espacios de más',
  (select temporada_lugares = pg_temp.todas('montevideo')
      || '{"23": "punta", "0": "punta", "1": "punta", "2": "punta", "3": "punta", "4": "fuera_pais", "5": {"otro": "Rocha"}, "6": "la_paloma"}'
     from ninieras where id = 'd2000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('temporada en el formato de siempre: el grupo Punta con sus quincenas en orden (sin grupo La Paloma, nada más)',
  (select temporada = '{"d6000000-0000-4000-8000-000000000003": [0, 1, 2, 3, 23]}'::jsonb
     from ninieras where id = 'd2000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('fuente app, las dos fechas, propuesta vacía; comentario y link intactos',
  (select temporada_fuente = 'app' and temporada_lugares_en is not null and temporada_actualizada_en = temporada_lugares_en
          and temporada_propuesta is null and temporada_propuesta_en is null
          and temporada_comentario = 'comentario viejo' and temporada_token is not null
     from ninieras where id = 'd2000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('a su zona se le agrega Punta del Este',
  (select zona = 'Centro/Punta del Este' from ninieras where id = 'd2000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('Bruno no cambió',
  (select temporada_lugares is null and temporada is null and zona = 'Punta del Este'
     from ninieras where id = 'd2000000-0000-4000-8000-000000000002'));

set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Ana al día ve lo que cargó',
  public.ninera_mi_temporada() = jsonb_build_object('al_dia', true, 'solo_afuera', false, 'lugares', pg_temp.todas('montevideo')
      || '{"23": "punta", "0": "punta", "1": "punta", "2": "punta", "3": "punta", "4": "fuera_pais", "5": {"otro": "Rocha"}, "6": "la_paloma"}'));
select pg_temp.verificar('Ana vuelve a guardar sin Punta: la zona no se toca y Punta queda vacío ("no va")',
  pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo'))$$) is null);
reset role;
select pg_temp.verificar('zona igual y temporada con Punta vacío',
  (select zona = 'Centro/Punta del Este' and temporada = '{"d6000000-0000-4000-8000-000000000003": []}'::jsonb
     from ninieras where id = 'd2000000-0000-4000-8000-000000000001'));

-- ---------------------------------------------------------------------------
-- Cuál manda: lugares de la app, respuesta posterior de la página, temporada anterior
-- ---------------------------------------------------------------------------
update ninieras set temporada_lugares = pg_temp.todas('fuera_pais'), temporada_lugares_en = now(),
       temporada = '{"d6000000-0000-4000-8000-000000000003": [0]}', temporada_fuente = 'ninera',
       temporada_actualizada_en = now()
 where id = 'd2000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('después contestó la página: manda temporada (punta en la 0, Montevideo el resto)',
  public.ninera_mi_temporada() -> 'lugares' = pg_temp.todas('montevideo') || '{"0": "punta"}');
reset role;
update ninieras set temporada_fuente = 'sistema' where id = 'd2000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('corrección de una admin (sistema): mandan los lugares',
  public.ninera_mi_temporada() -> 'lugares' = pg_temp.todas('fuera_pais'));
reset role;
update ninieras set temporada_lugares_en = public.inicio_temporada_mvd() - interval '1 second'
 where id = 'd2000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('lugares de la temporada anterior: no valen, se arman de temporada',
  public.ninera_mi_temporada() -> 'lugares' = pg_temp.todas('montevideo') || '{"0": "punta"}');
reset role;
update ninieras set temporada_actualizada_en = public.inicio_temporada_mvd() - interval '1 second'
 where id = 'd2000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('temporada cargada antes del 1/9: no está al día y no hay lugares',
  public.ninera_mi_temporada() = '{"lugares": null, "al_dia": false, "solo_afuera": false}'::jsonb);
reset role;

-- ---------------------------------------------------------------------------
-- Las que viven en Punta: solo_afuera, por nombre o por barrio y sin tildes; la zona no se toca
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Bruno (Punta del Este) vive afuera', (public.ninera_mi_temporada() ->> 'solo_afuera')::boolean);
select pg_temp.verificar('Bruno guarda Punta todo el año', pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('punta'))$$) is null);
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000003", "email": "59899000003@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Carla (jose ignacio) vive afuera', (public.ninera_mi_temporada() ->> 'solo_afuera')::boolean);
select pg_temp.verificar('Carla guarda Punta en enero', pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo') || '{"0": "punta", "1": "punta"}')$$) is null);
reset role;
select pg_temp.verificar('a Bruno y Carla no se les agrega Punta del Este (ya la tienen)',
  (select zona = 'Punta del Este' from ninieras where id = 'd2000000-0000-4000-8000-000000000002')
  and (select zona = 'jose ignacio' from ninieras where id = 'd2000000-0000-4000-8000-000000000003'));
select pg_temp.verificar('Bruno: las 24 quincenas en Punta',
  (select jsonb_array_length(temporada -> 'd6000000-0000-4000-8000-000000000003') = 24
     from ninieras where id = 'd2000000-0000-4000-8000-000000000002'));

-- ---------------------------------------------------------------------------
-- Sin el grupo Punta del Este: marcar Punta no se puede, el resto sí
-- ---------------------------------------------------------------------------
update zona_grupos set nombre = 'Punta' where id = 'd6000000-0000-4000-8000-000000000003';
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('con Punta marcada: sin_grupo_punta',
  pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('punta'))$$) like '%sin_grupo_punta%');
select pg_temp.verificar('sin Punta marcada: guarda, con temporada vacía',
  pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo'))$$) is null);
reset role;
select pg_temp.verificar('temporada vacía', (select temporada = '{}'::jsonb from ninieras where id = 'd2000000-0000-4000-8000-000000000001'));
update zona_grupos set nombre = 'Punta del Este' where id = 'd6000000-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- Una admin, una niñera dada de baja y sin sesión no pueden
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('admin: ninera_mi_temporada da null y guardar da no_autorizada',
  public.ninera_mi_temporada() is null
  and pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo'))$$) like '%no_autorizada%');
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000005", "email": "59899000005@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('dada de baja: no_autorizada',
  pg_temp.error_de($$select public.ninera_guardar_temporada(pg_temp.todas('montevideo'))$$) like '%no_autorizada%');
select pg_temp.verificar('authenticated no puede correr la regla de avisos',
  pg_temp.error_de('select public.programar_avisos_temporada()') like '%permission denied%');
set local request.jwt.claims = '';
set local role anon;
select pg_temp.verificar('anon: permission denied en las dos',
  pg_temp.error_de('select public.ninera_mi_temporada()') like '%permission denied%'
  and pg_temp.error_de($$select public.ninera_guardar_temporada('{}')$$) like '%permission denied%');
reset role;

-- ---------------------------------------------------------------------------
-- Regla de avisos. Ana y Carla sin la temporada de este año, Bruno al día; Dora sin app y Eva de baja
-- nunca. Las horas son de Montevideo (-03).
-- ---------------------------------------------------------------------------
update ninieras set temporada_actualizada_en = null;
update ninieras set temporada_actualizada_en = '2026-10-02 10:00-03' where id = 'd2000000-0000-4000-8000-000000000002';
select pg_temp.verificar('fuera de octubre a diciembre, nada (setiembre y enero)',
  public.programar_avisos_temporada('2026-09-30 12:00-03') = 0
  and public.programar_avisos_temporada('2027-01-02 12:00-03') = 0);
select pg_temp.verificar('fuera de 9 a 21, nada (8:59 y 21:00)',
  public.programar_avisos_temporada('2026-10-15 08:59-03') = 0
  and public.programar_avisos_temporada('2026-10-15 21:00-03') = 0);
select pg_temp.verificar('nada encolado todavía', not exists (select 1 from avisos where clave like 'temporada:%'));
select pg_temp.verificar('15/10 a las 9:00: el primer aviso a Ana y a Carla',
  public.programar_avisos_temporada('2026-10-15 09:00-03') = 2);
select pg_temp.verificar('claves, destinatarias, tipo, textos y url',
  (select count(*) = 2
          and bool_and(clave = 'temporada:2026:' || para_ninera_id and para_admin is null and tipo = 'temporada'
                       and titulo = '¿Vas a estar en Punta del Este esta temporada?'
                       and cuerpo = 'Marca dónde vas a estar cada quincena.' and url = '#temporada')
          and array_agg(para_ninera_id order by para_ninera_id) =
              array['d2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000003']::uuid[]
     from avisos where clave like 'temporada:%'));
select pg_temp.verificar('otra corrida (20:59) no duplica', public.programar_avisos_temporada('2026-10-15 20:59-03') = 0);
-- El aviso se creó "ahora"; para la prueba, el 15/10 a las 9:00.
update avisos set creado_en = '2026-10-15 09:00-03' where clave like 'temporada:%';
select pg_temp.verificar('a los 14 días y 23:59 todavía no hay recordatorio',
  public.programar_avisos_temporada('2026-10-30 08:59-03') = 0);
select pg_temp.verificar('a los 15 días (30/10 a las 9:00), el primer recordatorio a las dos',
  public.programar_avisos_temporada('2026-10-30 09:00-03') = 2);
select pg_temp.verificar('recordatorio: clave :q1, textos y url',
  (select count(*) = 2
          and bool_and(clave = 'temporada:2026:' || para_ninera_id || ':q1' and tipo = 'temporada'
                       and titulo = 'Todavía no marcaste tu ubicación en la temporada'
                       and cuerpo = 'Te lleva un minuto.' and url = '#temporada')
     from avisos where clave like 'temporada:%:q1'));
select pg_temp.verificar('el recordatorio no se repite el mismo día', public.programar_avisos_temporada('2026-10-30 15:00-03') = 0);
-- Ana la carga el 5/11 (desde la app, la página o una admin: lo que cuenta es la fecha).
update ninieras set temporada_actualizada_en = '2026-11-05 10:00-03' where id = 'd2000000-0000-4000-8000-000000000001';
-- (Lo que encola la función se ve recién en la sentencia siguiente: por eso van separadas.)
select pg_temp.verificar('a los 30 días, el segundo recordatorio solo a Carla',
  public.programar_avisos_temporada('2026-11-14 09:00-03') = 1);
select pg_temp.verificar('es el :q2 de Carla',
  exists (select 1 from avisos where clave = 'temporada:2026:d2000000-0000-4000-8000-000000000003:q2'));
select pg_temp.verificar('si el de los 15 días cae de noche, sale a las 9 del día siguiente',
  public.programar_avisos_temporada('2026-11-29 22:00-03') = 0
  and public.programar_avisos_temporada('2026-11-30 09:00-03') = 1);
select pg_temp.verificar('es el :q3 de Carla',
  exists (select 1 from avisos where clave = 'temporada:2026:d2000000-0000-4000-8000-000000000003:q3'));
select pg_temp.verificar('el 31/12 a las 20:59 todavía, el 1/1 ya no',
  public.programar_avisos_temporada('2026-12-31 20:59-03') = 1
  and public.programar_avisos_temporada('2027-01-01 10:00-03') = 0);
select pg_temp.verificar('Bruno (al día), Dora (sin app) y Eva (de baja) nunca',
  not exists (select 1 from avisos where clave like 'temporada:%'
               and para_ninera_id in ('d2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004',
                                      'd2000000-0000-4000-8000-000000000005')));
select pg_temp.verificar('la temporada siguiente arranca de cero: el 1/10/2027 a las 9, el primer aviso de 2027 a Ana, Bruno y Carla (lo de 2026 ya no vale)',
  public.programar_avisos_temporada('2027-10-01 09:00-03') = 3);
select pg_temp.verificar('son los de 2027',
  (select count(*) = 3 from avisos where clave like 'temporada:2027:%' and clave not like '%:q%'));
select pg_temp.verificar('programar_avisos() corre (con la hora real)', public.programar_avisos() >= 0);

rollback;
