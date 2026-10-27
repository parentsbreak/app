-- ============================================================================
-- Prueba de 20261027_perfil_ninera.sql en un Postgres LOCAL (nunca en producción): el perfil que
-- completa la niñera (ninera_mi_perfil, ninera_zonas_disponibles, ninera_guardar_perfil), sus
-- próximos sittings sin plata (ninera_mis_sittings), los ayudantes (hoy_mvd, madre_nombre_inicial,
-- chicos_texto) y el bucket privado ninieras-privado con sus dos políticas. Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_perfil.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261027_perfil_ninera.sql supabase/pruebas/fase1_perfil.sql
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261027_perfil_ninera.sql \
--     --migracion supabase/migraciones/20261027_perfil_ninera_DESHACER.sql \
--     --migracion supabase/migraciones/20261027_perfil_ninera.sql supabase/pruebas/fase1_perfil.sql
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
-- "Hoy" en Montevideo, escrito acá a mano para no depender de la función que se prueba.
create function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Montevideo')::date $$;

-- ---------------------------------------------------------------------------
-- Todo lo de la migración está (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('cuatro columnas nuevas en ninieras',
  (select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'ninieras'
    and column_name in ('perfil_app_en', 'perfil_actualizado_en', 'foto_propuesta_ruta', 'foto_propuesta_en')));
select pg_temp.verificar('bucket ninieras-privado, privado, una sola vez',
  (select count(*) = 1 and bool_and(not public) from storage.buckets where id = 'ninieras-privado'));
select pg_temp.verificar('bucket ninieras-privado: hasta 5 MB y solo imágenes',
  (select file_size_limit = 5242880 and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
     from storage.buckets where id = 'ninieras-privado'));
select pg_temp.verificar('las dos políticas del bucket, una sola vez cada una',
  (select count(*) = 2 from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('ninieras_privado_propio', 'ninieras_privado_admins')));
select pg_temp.verificar('las siete funciones',
  (select count(*) = 7 from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('hoy_mvd', 'madre_nombre_inicial', 'chicos_texto', 'ninera_mi_perfil',
                    'ninera_zonas_disponibles', 'ninera_guardar_perfil', 'ninera_mis_sittings')));
select pg_temp.verificar('las cuatro de la niñera: security definer con search_path fijo',
  (select count(*) = 4 from pg_proc
    where pronamespace = 'public'::regnamespace and prosecdef
      and proname in ('ninera_mi_perfil', 'ninera_zonas_disponibles', 'ninera_guardar_perfil', 'ninera_mis_sittings')
      and exists (select 1 from unnest(proconfig) c where c like 'search_path=%')));
select pg_temp.verificar('los ayudantes no son security definer',
  (select count(*) = 3 and bool_and(not prosecdef) from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('hoy_mvd', 'madre_nombre_inicial', 'chicos_texto')));
select pg_temp.verificar('las cuatro de la niñera: authenticated sí, anon no',
  has_function_privilege('authenticated', 'public.ninera_mi_perfil()', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_zonas_disponibles()', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_guardar_perfil(text, text[], text[], text)', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_mis_sittings()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_mi_perfil()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_zonas_disponibles()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_guardar_perfil(text, text[], text[], text)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_mis_sittings()', 'execute'));
select pg_temp.verificar('ninera_mis_sittings no devuelve plata, notas internas ni precios',
  (select r not like '%cobro%' and r not like '%pago%' and r not like '%precio%'
          and replace(r, 'notas_para_ninera', '') not like '%notas%'
     from (select pg_get_function_result('public.ninera_mis_sittings'::regproc) as r) x));

-- ---------------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------------
select pg_temp.verificar('hoy_mvd() es el día de Montevideo', public.hoy_mvd() = pg_temp.hoy());
select pg_temp.verificar('madre_nombre_inicial: "María Pérez" → "María P."', public.madre_nombre_inicial('María Pérez') = 'María P.');
select pg_temp.verificar('madre_nombre_inicial: "Pérez" → "Pérez"', public.madre_nombre_inicial('Pérez') = 'Pérez');
select pg_temp.verificar('madre_nombre_inicial: "Familia Pérez" → "Familia P."', public.madre_nombre_inicial('Familia Pérez') = 'Familia P.');
select pg_temp.verificar('madre_nombre_inicial: vacío, espacios o null → "la familia"',
  public.madre_nombre_inicial('') = 'la familia' and public.madre_nombre_inicial('   ') = 'la familia'
  and public.madre_nombre_inicial(null) = 'la familia');
select pg_temp.verificar('madre_nombre_inicial: varias palabras y espacios de más → primera + inicial de la última',
  public.madre_nombre_inicial('  Ana  María Pérez Gómez ') = 'Ana G.');

-- ---------------------------------------------------------------------------
-- Datos inventados: una admin, dos niñeras con cuenta (Ana y Bruno), familias con y sin hijos
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d1000000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('d1000000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid'),
  ('d1000000-0000-4000-8000-000000000002', '59899000002@ninieras.parentsbreak.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('d1000000-0000-4000-8000-0000000000a1', 'desarrollo');
insert into ninieras (id, nombre, telefono, user_id, tipo, zona, barrios, foto, cuenta_bancaria) values
  ('d2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'd1000000-0000-4000-8000-000000000001',
   'Niñera', 'Centro', 'Cordón', 'https://ejemplo.invalid/ana.jpg', array['Banco Inventado', 'cuenta 0009876543']),
  ('d2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', 'd1000000-0000-4000-8000-000000000002',
   'Traslados', 'Carrasco', null, null, array['Banco Otro', 'cuenta 0001112223']);
insert into zona_grupos (id, nombre, orden, fuera_de_montevideo) values
  ('d6000000-0000-4000-8000-000000000001', 'Pocitos', 2, false),
  ('d6000000-0000-4000-8000-000000000002', 'Carrasco', 1, false),
  ('d6000000-0000-4000-8000-000000000003', 'Punta del Este', 3, true);
insert into familias (id, nombre, direccion, zona, ninos, cobro_hora, pago_hora) values
  ('d3000000-0000-4000-8000-000000000001', 'Laura Ficticia', 'Calle Inventada 123', 'Pocitos', 'texto viejo que no se usa', 300, 200),
  ('d3000000-0000-4000-8000-000000000002', 'Familia Prueba', 'Calle Falsa 456', 'Carrasco', null, 300, 200),
  ('d3000000-0000-4000-8000-000000000003', 'Solo Texto', null, null, '   Dos nenas, una de 4 y otra de 8, ' || repeat('x', 100), 300, 200),
  ('d3000000-0000-4000-8000-000000000004', 'Sin Nada', null, null, '   ', 300, 200),
  ('d3000000-0000-4000-8000-000000000005', 'Con Bebe', null, null, null, 300, 200),
  ('d3000000-0000-4000-8000-000000000006', 'Sin Edades', null, null, null, 300, 200),
  ('d3000000-0000-4000-8000-000000000007', 'Un Chico', null, null, null, 300, 200),
  ('d3000000-0000-4000-8000-000000000008', 'Declarada Futura', null, null, null, 300, 200);
-- Familia 1 (con fecha de nacimiento): cargados en otro orden que el de "orden".
insert into hijos_familia (familia_id, nombre, fecha_nacimiento, orden) values
  ('d3000000-0000-4000-8000-000000000001', 'Mayor Ficticio', (pg_temp.hoy() - interval '5 years')::date, 1),
  ('d3000000-0000-4000-8000-000000000001', 'Menor Ficticio', (pg_temp.hoy() - interval '3 years 10 days')::date, 0);
-- Familia 2 (edad declarada hace más de dos años): 4 declarados + 2 cumplidos = 6.
insert into hijos_familia (familia_id, nombre, edad_declarada, edad_declarada_en, orden) values
  ('d3000000-0000-4000-8000-000000000002', 'Declarado Ficticio', 4, (pg_temp.hoy() - interval '2 years 1 day')::date, 0);
-- Familia 8: edad declarada con una fecha futura (mal cargada): no resta, 3 + 0 = 3.
insert into hijos_familia (familia_id, nombre, edad_declarada, edad_declarada_en, orden) values
  ('d3000000-0000-4000-8000-000000000008', 'Futuro Ficticio', 3, pg_temp.hoy() + 400, 0);
-- Familia 5: un bebé (0 años), uno sin edad y uno de 2.
insert into hijos_familia (familia_id, nombre, fecha_nacimiento, edad_declarada, edad_declarada_en, orden) values
  ('d3000000-0000-4000-8000-000000000005', 'Bebe Ficticio', (pg_temp.hoy() - interval '3 months')::date, null, null, 0),
  ('d3000000-0000-4000-8000-000000000005', 'Sin Edad', null, null, null, 1),
  ('d3000000-0000-4000-8000-000000000005', 'Dos Ficticio', null, 2, null, 2);
-- Familia 6: dos sin edad. Familia 7: uno de 5.
insert into hijos_familia (familia_id, nombre, orden) values
  ('d3000000-0000-4000-8000-000000000006', 'Uno Sin Edad', 0),
  ('d3000000-0000-4000-8000-000000000006', 'Otro Sin Edad', 1);
insert into hijos_familia (familia_id, nombre, fecha_nacimiento, orden) values
  ('d3000000-0000-4000-8000-000000000007', 'Cinco Ficticio', (pg_temp.hoy() - interval '5 years 2 months')::date, 0);

-- Sittings: 2 de Ana en los próximos días (previsto y confirmado), y los que no tiene que ver.
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin,
                                origen, destino, cobro_familia, pago_ninera, notas, estado, cancelado) values
  -- Ana, pasado mañana, previsto: sin dirección ni origen / destino.
  ('d5000000-0000-4000-8000-000000000001', 'sitting', 'd3000000-0000-4000-8000-000000000002', 'Familia Prueba',
   'd2000000-0000-4000-8000-000000000001', 'Ana Ficticia', pg_temp.hoy() + 2, '16:00', '19:00',
   'Origen Previsto', 'Destino Previsto', 1000, 600, 'nota interna', 'previsto', false),
  -- Ana, mañana, confirmado: con la dirección de la familia y origen / destino.
  ('d5000000-0000-4000-8000-000000000002', 'traslado', 'd3000000-0000-4000-8000-000000000001', 'Laura Ficticia',
   'd2000000-0000-4000-8000-000000000001', 'Ana Ficticia', pg_temp.hoy() + 1, '08:00', '08:30',
   'Colegio Inventado', 'Club Inventado', 500, 300, 'nota interna', 'confirmado', false),
  -- Ana: cancelado, de hace un mes y a 70 días.
  ('d5000000-0000-4000-8000-000000000003', 'sitting', 'd3000000-0000-4000-8000-000000000001', 'Laura Ficticia',
   'd2000000-0000-4000-8000-000000000001', 'Ana Ficticia', pg_temp.hoy() + 3, '10:00', '12:00', null, null, 0, 0, null, 'confirmado', true),
  ('d5000000-0000-4000-8000-000000000004', 'sitting', 'd3000000-0000-4000-8000-000000000001', 'Laura Ficticia',
   'd2000000-0000-4000-8000-000000000001', 'Ana Ficticia', pg_temp.hoy() - 30, '10:00', '12:00', null, null, 600, 400, null, 'confirmado', false),
  ('d5000000-0000-4000-8000-000000000005', 'sitting', 'd3000000-0000-4000-8000-000000000001', 'Laura Ficticia',
   'd2000000-0000-4000-8000-000000000001', 'Ana Ficticia', pg_temp.hoy() + 70, '10:00', '12:00', null, null, 600, 400, null, 'previsto', false),
  -- Bruno, mañana.
  ('d5000000-0000-4000-8000-000000000006', 'traslado', 'd3000000-0000-4000-8000-000000000002', 'Familia Prueba',
   'd2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', pg_temp.hoy() + 1, '17:00', '17:30', 'A', 'B', 500, 300, null, 'confirmado', false);

-- ---------------------------------------------------------------------------
-- chicos_texto (como postgres: la llama ninera_mis_sittings, que corre como su dueña)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('chicos_texto con fecha de nacimiento, por orden: "2 chicos (3 y 5 años)"',
  public.chicos_texto('d3000000-0000-4000-8000-000000000001') = '2 chicos (3 y 5 años)');
select pg_temp.verificar('chicos_texto con edad declarada vieja: suma los años cumplidos ("1 chico (6 años)")',
  public.chicos_texto('d3000000-0000-4000-8000-000000000002') = '1 chico (6 años)');
select pg_temp.verificar('chicos_texto con edad declarada en una fecha futura: suma 0 ("1 chico (3 años)")',
  public.chicos_texto('d3000000-0000-4000-8000-000000000008') = '1 chico (3 años)');
select pg_temp.verificar('chicos_texto sin hijos cargados: familias.ninos recortado a 80',
  public.chicos_texto('d3000000-0000-4000-8000-000000000003') = left('Dos nenas, una de 4 y otra de 8, ' || repeat('x', 100), 80)
  and length(public.chicos_texto('d3000000-0000-4000-8000-000000000003')) = 80);
select pg_temp.verificar('chicos_texto sin hijos ni texto (o solo espacios): null',
  public.chicos_texto('d3000000-0000-4000-8000-000000000004') is null
  and public.chicos_texto('d3000000-0000-4000-8000-0000000000ff') is null
  and public.chicos_texto(null) is null);
select pg_temp.verificar('chicos_texto: bebé "menos de 1 año", y el que no tiene edad cuenta pero no va entre paréntesis',
  public.chicos_texto('d3000000-0000-4000-8000-000000000005') = '3 chicos (menos de 1 año y 2 años)');
select pg_temp.verificar('chicos_texto: ninguno con edad → "2 chicos"',
  public.chicos_texto('d3000000-0000-4000-8000-000000000006') = '2 chicos');
select pg_temp.verificar('chicos_texto: uno solo → "1 chico (5 años)"',
  public.chicos_texto('d3000000-0000-4000-8000-000000000007') = '1 chico (5 años)');

-- ---------------------------------------------------------------------------
-- Desde la cuenta de Ana
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('es Ana', public.ninera_actual() = 'd2000000-0000-4000-8000-000000000001');
select pg_temp.verificar('ninera_mi_perfil(): solo su fila, con su cuenta y su foto del CV',
  (select count(*) = 1
          and bool_and(id = 'd2000000-0000-4000-8000-000000000001' and nombre = 'Ana Ficticia' and tipo = 'Niñera'
                       and zona = 'Centro' and barrios = 'Cordón' and telefono = '099000001'
                       and cuenta_bancaria = array['Banco Inventado', 'cuenta 0009876543']
                       and foto = 'https://ejemplo.invalid/ana.jpg'
                       and foto_propuesta_ruta is null and perfil_app_en is null and perfil_actualizado_en is null)
     from public.ninera_mi_perfil()));
select pg_temp.verificar('ninera_zonas_disponibles(): las zonas por orden',
  (select array_agg(nombre order by ordinality) = array['Carrasco', 'Pocitos', 'Punta del Este']
          and bool_and(fuera_de_montevideo = (nombre = 'Punta del Este'))
     from public.ninera_zonas_disponibles() with ordinality));
select pg_temp.verificar('ninera_mis_sittings(): exactamente sus 2, por fecha',
  (select array_agg(id order by ordinality) = array['d5000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000001']::uuid[]
     from public.ninera_mis_sittings() with ordinality));
select pg_temp.verificar('el previsto: sin dirección, origen ni destino',
  (select direccion is null and origen is null and destino is null and estado = 'previsto'
          and madre = 'Familia P.' and zona = 'Carrasco' and chicos = '1 chico (6 años)'
          and hora_inicio = '16:00' and hora_fin = '19:00' and not termina_dia_siguiente and notas_para_ninera is null
     from public.ninera_mis_sittings() where id = 'd5000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('el confirmado: con la dirección de la familia, origen y destino',
  (select direccion = 'Calle Inventada 123' and origen = 'Colegio Inventado' and destino = 'Club Inventado'
          and tipo = 'traslado' and madre = 'Laura F.' and chicos = '2 chicos (3 y 5 años)'
     from public.ninera_mis_sittings() where id = 'd5000000-0000-4000-8000-000000000002'));
select pg_temp.verificar('lectura directa de sittings_traslados como Ana: 0 filas', (select count(*) = 0 from sittings_traslados));
select pg_temp.verificar('chicos_texto llamada directo por Ana: null (no ve hijos ni familias)',
  public.chicos_texto('d3000000-0000-4000-8000-000000000001') is null);

-- ninera_guardar_perfil: lo que rechaza, sin guardar nada.
select pg_temp.verificar('tipo "Chofer": tipo_invalido',
  pg_temp.error_de($$select public.ninera_guardar_perfil('Chofer', array['Pocitos'], array['Banco X'])$$) like '%tipo_invalido%');
select pg_temp.verificar('tipo null: tipo_invalido',
  pg_temp.error_de($$select public.ninera_guardar_perfil(null, array['Pocitos'], array['Banco X'])$$) like '%tipo_invalido%');
select pg_temp.verificar('zonas vacías o null: sin_zonas',
  pg_temp.error_de($$select public.ninera_guardar_perfil('Ambas', array[]::text[], array['Banco X'])$$) like '%sin_zonas%'
  and pg_temp.error_de($$select public.ninera_guardar_perfil('Ambas', null, array['Banco X'])$$) like '%sin_zonas%');
select pg_temp.verificar('zona "Narnia": zona_desconocida',
  pg_temp.error_de($$select public.ninera_guardar_perfil('Ambas', array['Pocitos', 'Narnia'], array['Banco X'])$$) like '%zona_desconocida%');
select pg_temp.verificar('foto en la carpeta de Bruno: foto_invalida',
  pg_temp.error_de($$select public.ninera_guardar_perfil('Ambas', array['Pocitos'], array['Banco X'],
    'fotos/d2000000-0000-4000-8000-000000000002/propuesta.jpg')$$) like '%foto_invalida%');
select pg_temp.verificar('foto en su carpeta con otro nombre: foto_invalida',
  pg_temp.error_de($$select public.ninera_guardar_perfil('Ambas', array['Pocitos'], array['Banco X'],
    'fotos/d2000000-0000-4000-8000-000000000001/otra.jpg')$$) like '%foto_invalida%');
select pg_temp.verificar('foto que sale de su carpeta con "..": foto_invalida',
  pg_temp.error_de($$select public.ninera_guardar_perfil('Ambas', array['Pocitos'], array['Banco X'],
    'fotos/d2000000-0000-4000-8000-000000000001/../d2000000-0000-4000-8000-000000000002/propuesta.jpg')$$) like '%foto_invalida%');
select pg_temp.verificar('después de los rechazos su perfil sigue igual',
  (select tipo = 'Niñera' and zona = 'Centro' and perfil_app_en is null and perfil_actualizado_en is null
          and foto_propuesta_ruta is null from public.ninera_mi_perfil()));

-- Lo que acepta.
select public.ninera_guardar_perfil('Ambas', array['Pocitos', 'Carrasco'], array['Banco X', '', '  cuenta 0001234567  '],
  'fotos/d2000000-0000-4000-8000-000000000001/propuesta.jpg');
select pg_temp.verificar('guardó tipo, zonas con "/", cuenta sin líneas vacías, la foto propuesta y cuándo completó el perfil',
  (select tipo = 'Ambas' and zona = 'Pocitos/Carrasco' and cuenta_bancaria = array['Banco X', 'cuenta 0001234567']
          and foto_propuesta_ruta = 'fotos/d2000000-0000-4000-8000-000000000001/propuesta.jpg'
          and foto_propuesta_en is not null and perfil_app_en is not null and perfil_actualizado_en is not null
          and foto = 'https://ejemplo.invalid/ana.jpg'
     from public.ninera_mi_perfil()));
reset role;
select pg_temp.verificar('a Bruno no lo tocó',
  (select tipo = 'Traslados' and zona = 'Carrasco' and perfil_app_en is null and perfil_actualizado_en is null
          and foto_propuesta_ruta is null
     from ninieras where id = 'd2000000-0000-4000-8000-000000000002'));
-- Para ver qué se mueve: las tres fechas quedan en el pasado y se vuelve a guardar sin foto.
update ninieras set perfil_app_en = '2026-10-01 12:00-03', perfil_actualizado_en = '2026-10-01 12:00-03',
                    foto_propuesta_en = '2026-10-01 12:00-03'
 where id = 'd2000000-0000-4000-8000-000000000001';
set local role authenticated;
select public.ninera_guardar_perfil('Niñera', array['Carrasco'], array['   ', '']);
select pg_temp.verificar('segunda vez: perfil_app_en no se mueve, la foto propuesta queda, sin cuenta → null',
  (select perfil_app_en = '2026-10-01 12:00-03'::timestamptz and foto_propuesta_en = '2026-10-01 12:00-03'::timestamptz
          and foto_propuesta_ruta = 'fotos/d2000000-0000-4000-8000-000000000001/propuesta.jpg'
          and tipo = 'Niñera' and zona = 'Carrasco' and cuenta_bancaria is null
     from public.ninera_mi_perfil()));
select pg_temp.verificar('segunda vez: perfil_actualizado_en sí se mueve (un cambio de cuenta no pasa en silencio)',
  (select perfil_actualizado_en > '2026-10-01 12:00-03'::timestamptz from public.ninera_mi_perfil()));
-- Zonas repetidas: una vez cada una, en el orden en que llegaron (no alfabético). Renglón de la
-- cuenta de más de 120 caracteres: se corta.
select public.ninera_guardar_perfil('Ambas', array['Pocitos', 'Pocitos', 'Carrasco', 'Pocitos'], array[repeat('9', 150), ' Banco Y ']);
select pg_temp.verificar('zonas repetidas: "Pocitos/Carrasco"',
  (select zona = 'Pocitos/Carrasco' from public.ninera_mi_perfil()));
select pg_temp.verificar('renglón de la cuenta cortado a 120 caracteres',
  (select cuenta_bancaria = array[repeat('9', 120), 'Banco Y'] from public.ninera_mi_perfil()));

-- Storage: su carpeta sí, la de Bruno no.
reset role;
insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'fotos/d2000000-0000-4000-8000-000000000002/propuesta.jpg');
set local role authenticated;
select pg_temp.verificar('Ana sube a su carpeta',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'fotos/d2000000-0000-4000-8000-000000000001/propuesta.jpg')$$) is null);
select pg_temp.verificar('Ana no puede subir a la carpeta de Bruno (RLS)',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'fotos/d2000000-0000-4000-8000-000000000002/otra.jpg')$$) like '%row-level security%');
select pg_temp.verificar('Ana no puede subir a otro bucket privado',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('comprobantes', 'fotos/d2000000-0000-4000-8000-000000000001/x.jpg')$$) like '%row-level security%');
select pg_temp.verificar('Ana ve solo lo suyo',
  (select count(*) = 1 and bool_and(name = 'fotos/d2000000-0000-4000-8000-000000000001/propuesta.jpg') from storage.objects));
select pg_temp.verificar('Ana puede reemplazar la suya (upsert) pero no mover a la carpeta de Bruno',
  pg_temp.error_de($$update storage.objects set owner = 'd1000000-0000-4000-8000-000000000001' where name = 'fotos/d2000000-0000-4000-8000-000000000001/propuesta.jpg'$$) is null
  and pg_temp.error_de($$update storage.objects set name = 'fotos/d2000000-0000-4000-8000-000000000002/propuesta2.jpg' where name = 'fotos/d2000000-0000-4000-8000-000000000001/propuesta.jpg'$$) like '%row-level security%');
select pg_temp.verificar('Ana no borra la de Bruno (0 filas)',
  pg_temp.error_de($q$do $x$ declare n int; begin
     delete from storage.objects where name = 'fotos/d2000000-0000-4000-8000-000000000002/propuesta.jpg';
     get diagnostics n = row_count; if n > 0 then raise exception 'borró'; end if; end $x$ $q$) is null);
reset role;

-- ---------------------------------------------------------------------------
-- Desde la cuenta de Bruno: su perfil, sus sittings
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Bruno: su perfil y su sitting',
  (select count(*) = 1 and bool_and(id = 'd2000000-0000-4000-8000-000000000002') from public.ninera_mi_perfil())
  and (select array_agg(id) = array['d5000000-0000-4000-8000-000000000006']::uuid[] from public.ninera_mis_sittings()));
select pg_temp.verificar('Bruno no ve la foto de Ana', (select count(*) = 1 from storage.objects)
  and not exists (select 1 from storage.objects where name like 'fotos/d2000000-0000-4000-8000-000000000001/%'));
reset role;

-- Niñera dada de baja: nada.
update ninieras set activa = false where id = 'd2000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.verificar('Bruno dado de baja: perfil, zonas y sittings vacíos; guardar no_autorizada; storage 0',
  not exists (select 1 from public.ninera_mi_perfil()) and not exists (select 1 from public.ninera_zonas_disponibles())
  and not exists (select 1 from public.ninera_mis_sittings())
  and pg_temp.error_de($$select public.ninera_guardar_perfil('Ambas', array['Pocitos'], array['Banco X'])$$) like '%no_autorizada%'
  and (select count(*) = 0 from storage.objects));
reset role;
update ninieras set activa = true where id = 'd2000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- Desde la cuenta de la admin
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('admin: ninera_guardar_perfil da no_autorizada',
  pg_temp.error_de($$select public.ninera_guardar_perfil('Ambas', array['Pocitos'], array['Banco X'])$$) like '%no_autorizada%');
select pg_temp.verificar('admin: ninera_mi_perfil, zonas y sittings vacíos',
  not exists (select 1 from public.ninera_mi_perfil()) and not exists (select 1 from public.ninera_zonas_disponibles())
  and not exists (select 1 from public.ninera_mis_sittings()));
select pg_temp.verificar('admin: lee las columnas nuevas en la ficha',
  (select foto_propuesta_ruta = 'fotos/d2000000-0000-4000-8000-000000000001/propuesta.jpg' and perfil_app_en is not null
     from ninieras where id = 'd2000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('admin: ve las dos fotos', (select count(*) = 2 from storage.objects where bucket_id = 'ninieras-privado'));
select pg_temp.verificar('admin: puede subir en cualquier carpeta',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'fotos/d2000000-0000-4000-8000-000000000002/otra.jpg')$$) is null);
delete from storage.objects where bucket_id = 'ninieras-privado';
reset role;
select pg_temp.verificar('admin: borró todo el bucket', not exists (select 1 from storage.objects where bucket_id = 'ninieras-privado'));

-- ---------------------------------------------------------------------------
-- Sin sesión (anon): no puede llamar las funciones de la niñera ni ver el bucket
-- ---------------------------------------------------------------------------
insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'fotos/d2000000-0000-4000-8000-000000000001/propuesta.jpg');
set local request.jwt.claims = '';
set local role anon;
select pg_temp.verificar('anon: permission denied en las cuatro',
  pg_temp.error_de('select * from public.ninera_mi_perfil()') like '%permission denied%'
  and pg_temp.error_de('select * from public.ninera_zonas_disponibles()') like '%permission denied%'
  and pg_temp.error_de('select * from public.ninera_mis_sittings()') like '%permission denied%'
  and pg_temp.error_de($$select public.ninera_guardar_perfil('Ambas', array['Pocitos'], array['Banco X'])$$) like '%permission denied%');
select pg_temp.verificar('anon: no ve el bucket', (select count(*) = 0 from storage.objects));
select pg_temp.verificar('anon: no puede subir',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'fotos/d2000000-0000-4000-8000-000000000001/x.jpg')$$) is not null);
reset role;

rollback;
