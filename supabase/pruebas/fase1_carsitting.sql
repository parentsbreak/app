-- ============================================================================
-- Prueba de 20261108_carsitting_app.sql en un Postgres LOCAL (nunca en producción): el carsitting desde la app de
-- niñeras (decisiones.md 6.7). Lo que ve (ninera_mi_carsitting), las fotos de su carpeta, lo que manda
-- (ninera_guardar_carsitting: campos, 7 fotos, errores, el aviso a las admins), la revisión de una admin (aprobar,
-- pedir de nuevo con el comentario por el chat), actualizar estando aprobada (sigue aprobada con lo anterior) y los
-- avisos de tiempo (programar_avisos_carsitting, con solo_practica). Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_carsitting.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261108_carsitting_app.sql \
--     --migracion supabase/migraciones/20261108_carsitting_app_DESHACER.sql \
--     --migracion supabase/migraciones/20261108_carsitting_app.sql supabase/pruebas/fase1_carsitting.sql
-- Los avisos de tiempo se prueban con p_ahora en fechas fijas. Todo termina en rollback.
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;
-- El mensaje del error que tira la sentencia (con la pista, si tiene: "mensaje|pista"), o null si no falla.
create function pg_temp.error_de(sentencia text) returns text language plpgsql as $$
declare v_pista text;
begin
  execute sentencia;
  return null;
exception when others then
  get stacked diagnostics v_pista = pg_exception_hint;
  return sqlerrm || case when coalesce(v_pista, '') <> '' then '|' || v_pista else '' end;
end $$;
create function pg_temp.hay_aviso(p_clave text) returns boolean language sql as $$
  select exists (select 1 from public.avisos where clave = p_clave)
$$;
-- Los campos completos (sin la libreta, que es opcional).
create function pg_temp.datos(extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('nombre_completo', 'Ana Ficticia Prueba', 'cedula', '1.234.567-8', 'numero_licencia', '0001234',
    'anio_licencia', '2019', 'modelo_auto', 'Auto Inventado', 'anio_fabricacion', '2018', 'color_auto', 'Gris', 'matricula', 'AAA 0001',
    'padron', '000111', 'compania_seguro', 'Seguros de Prueba', 'tipo_seguro', 'Total', 'cantidad_asientos', '5', 'cantidad_cinturones', '5') || extra
$$;
-- Las 7 fotos de Ana, con un sufijo (cada envío sube archivos nuevos).
create function pg_temp.fotos(sufijo text) returns jsonb language sql as $$
  select jsonb_object_agg(f, 'carsitting/e2800000-0000-4000-8000-000000000001/' || f || '_' || sufijo || '.jpg')
    from unnest(array['licencia_frente', 'licencia_dorso', 'libreta_frente', 'libreta_dorso', 'asientos', 'auto_dentro', 'auto_fuera']) f
$$;

-- ---------------------------------------------------------------------------
-- Está todo (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('las columnas nuevas de carsitting_datos',
  (select count(*) = 9 from information_schema.columns where table_schema = 'public' and table_name = 'carsitting_datos'
    and column_name in ('fotos', 'enviado_en', 'revision', 'revisado_en', 'revisado_por', 'comentario', 'aprobado_en', 'aprobado_por', 'aprobado_datos')));
select pg_temp.verificar('una fila por niñera desde la app, el trigger y la política de las fotos',
  to_regclass('public.carsitting_datos_app_ninera') is not null
  and exists (select 1 from pg_trigger where tgrelid = 'public.carsitting_datos'::regclass and tgname = 'carsitting_al_revisar')
  and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ninieras_privado_carsitting'));
select pg_temp.verificar('las de la niñera: authenticated sí, anon no',
  has_function_privilege('authenticated', 'public.ninera_mi_carsitting()', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_guardar_carsitting(jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_mi_carsitting()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_guardar_carsitting(jsonb, jsonb)', 'execute'));
select pg_temp.verificar('las internas y la regla: ni authenticated ni anon',
  not has_function_privilege('authenticated', 'public.carsitting_campos()', 'execute')
  and not has_function_privilege('authenticated', 'public.carsitting_fotos()', 'execute')
  and not has_function_privilege('authenticated', 'public.carsitting_puede_avisar(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.carsitting_al_revisar()', 'execute')
  and not has_function_privilege('authenticated', 'public.programar_avisos_carsitting(timestamp with time zone)', 'execute')
  and not has_function_privilege('anon', 'public.programar_avisos_carsitting(timestamp with time zone)', 'execute'));
select pg_temp.verificar('programar_avisos llama a la regla del carsitting (y siguen las otras)',
  pg_get_functiondef('public.programar_avisos'::regproc) like '%programar_avisos_carsitting()%'
  and pg_get_functiondef('public.programar_avisos'::regproc) like '%programar_avisos_el_dia()%'
  and pg_get_functiondef('public.programar_avisos'::regproc) like '%programar_avisos_temporada()%');

-- ---------------------------------------------------------------------------
-- Datos inventados: una admin; Ana (Traslados), Bruno (Niñera) y Carla (Ambas) con app; Eva (Traslados) sin app y
-- Lola (práctica) con app. Una fila vieja del formulario de Google, de Carla. solo_practica apagado (se prende al
-- final).
-- ---------------------------------------------------------------------------
insert into app_config (id, valor) values ('pedidos_app', '{"solo_practica": false}')
  on conflict (id) do update set valor = app_config.valor || '{"solo_practica": false}';
insert into auth.users (id, email) values
  ('e1800000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('e1800000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid'),
  ('e1800000-0000-4000-8000-000000000002', '59899000002@ninieras.parentsbreak.invalid'),
  ('e1800000-0000-4000-8000-000000000003', '59899000003@ninieras.parentsbreak.invalid'),
  ('e1800000-0000-4000-8000-000000000006', '59899000006@ninieras.parentsbreak.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('e1800000-0000-4000-8000-0000000000a1', 'desarrollo');
insert into ninieras (id, nombre, telefono, user_id, activa, zona, tipo, app_activada_en) values
  ('e2800000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'e1800000-0000-4000-8000-000000000001', true, 'Pocitos', 'Traslados', now()),
  ('e2800000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', 'e1800000-0000-4000-8000-000000000002', true, 'Pocitos', 'Niñera', now()),
  ('e2800000-0000-4000-8000-000000000003', 'Carla Inventada', '099000003', 'e1800000-0000-4000-8000-000000000003', true, 'Pocitos', 'Ambas', now()),
  ('e2800000-0000-4000-8000-000000000005', 'Eva Sinapp', '099000005', null, true, 'Pocitos', 'Traslados', null),
  ('e2800000-0000-4000-8000-000000000006', 'Lola (práctica)', '099000006', 'e1800000-0000-4000-8000-000000000006', true, 'Pocitos', 'Traslados', now());
insert into carsitting_datos (ninera_id, ninera_nombre, nombre_completo, modelo_auto) values
  ('e2800000-0000-4000-8000-000000000003', 'Carla Inventada', 'Carla Inventada', 'Del formulario');

-- ---------------------------------------------------------------------------
-- Ana: lo que ve y las fotos
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1800000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('es Ana', public.ninera_actual() = 'e2800000-0000-4000-8000-000000000001');
select pg_temp.verificar('sin enviar: hace traslados y nada cargado',
  (select (r->>'hace_traslados')::boolean and r->'datos' = 'null'::jsonb and r->>'revision' is null from public.ninera_mi_carsitting() r));
select pg_temp.verificar('no lee carsitting_datos (la de Carla tampoco) ni escribe directo',
  (select count(*) = 0 from carsitting_datos)
  and pg_temp.error_de($$insert into carsitting_datos (ninera_id, nombre_completo) values ('e2800000-0000-4000-8000-000000000001', 'x')$$) is not null);
select pg_temp.verificar('sube las 7 fotos a su carpeta, con el nombre de cada una y 8 hex',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name)
    select 'ninieras-privado', value #>> '{}' from jsonb_each(pg_temp.fotos('0a1b2c3d'))$$) is null);
select pg_temp.verificar('ni a otra carpeta, ni otro nombre, ni png, ni sin los 8 hex, ni a otro bucket',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'carsitting/e2800000-0000-4000-8000-000000000003/asientos_0a1b2c3d.jpg')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'carsitting/e2800000-0000-4000-8000-000000000001/cedula_0a1b2c3d.jpg')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'carsitting/e2800000-0000-4000-8000-000000000001/asientos_0a1b2c3d.png')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'carsitting/e2800000-0000-4000-8000-000000000001/asientos.jpg')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'carsitting/e2800000-0000-4000-8000-000000000001/x/asientos_0a1b2c3d.jpg')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('comprobantes', 'carsitting/e2800000-0000-4000-8000-000000000001/asientos_0a1b2c3d.jpg')$$) like '%row-level security%');

-- ---------------------------------------------------------------------------
-- Ana: lo que manda (errores)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('datos inválidos: no es un objeto, un campo que no existe, un número',
  pg_temp.error_de($$select public.ninera_guardar_carsitting('[]'::jsonb, pg_temp.fotos('0a1b2c3d'))$$) = 'datos_invalidos'
  and pg_temp.error_de($$select public.ninera_guardar_carsitting(pg_temp.datos('{"telefono": "099"}'), pg_temp.fotos('0a1b2c3d'))$$) = 'datos_invalidos'
  and pg_temp.error_de($$select public.ninera_guardar_carsitting(pg_temp.datos('{"cantidad_asientos": 5}'), pg_temp.fotos('0a1b2c3d'))$$) = 'datos_invalidos');
select pg_temp.verificar('un dato de más de 120 caracteres, uno obligatorio vacío o que falta (con la clave)',
  pg_temp.error_de(format('select public.ninera_guardar_carsitting(pg_temp.datos(%L), pg_temp.fotos(%L))', jsonb_build_object('color_auto', repeat('a', 121)), '0a1b2c3d')) = 'dato_largo|color_auto'
  and pg_temp.error_de($$select public.ninera_guardar_carsitting(pg_temp.datos('{"cedula": "   "}'), pg_temp.fotos('0a1b2c3d'))$$) = 'faltan_datos|cedula'
  and pg_temp.error_de($$select public.ninera_guardar_carsitting(pg_temp.datos() - 'padron', pg_temp.fotos('0a1b2c3d'))$$) = 'faltan_datos|padron');
select pg_temp.verificar('fotos: una que no subió, de otra carpeta o de otra foto (con la clave); sin todas, faltan',
  pg_temp.error_de($$select public.ninera_guardar_carsitting(pg_temp.datos(), pg_temp.fotos('ffffffff'))$$) like 'foto_invalida|%'
  and pg_temp.error_de($$select public.ninera_guardar_carsitting(pg_temp.datos(), pg_temp.fotos('0a1b2c3d')
        || '{"asientos": "carsitting/e2800000-0000-4000-8000-000000000003/asientos_0a1b2c3d.jpg"}')$$) = 'foto_invalida|asientos'
  and pg_temp.error_de($$select public.ninera_guardar_carsitting(pg_temp.datos(), pg_temp.fotos('0a1b2c3d')
        || '{"asientos": "carsitting/e2800000-0000-4000-8000-000000000001/auto_fuera_0a1b2c3d.jpg"}')$$) = 'foto_invalida|asientos'
  and pg_temp.error_de($$select public.ninera_guardar_carsitting(pg_temp.datos(), pg_temp.fotos('0a1b2c3d') - 'auto_fuera')$$) = 'faltan_fotos|auto_fuera');
reset role;
select pg_temp.verificar('nada de eso guardó ni avisó',
  (select count(*) = 1 from carsitting_datos) and (select count(*) = 0 from avisos where tipo = 'carsitting'));

-- Bruno no hace traslados.
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1800000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Bruno (solo sittings): no_hace_traslados, y lo ve en su estado',
  pg_temp.error_de($$select public.ninera_guardar_carsitting(pg_temp.datos(), '{}'::jsonb)$$) = 'no_hace_traslados'
  and (select not (r->>'hace_traslados')::boolean from public.ninera_mi_carsitting() r));
-- Una admin no es niñera.
set local request.jwt.claims = '{"sub": "e1800000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('una admin: no_autorizada y sin estado',
  pg_temp.error_de($$select public.ninera_guardar_carsitting(pg_temp.datos(), '{}'::jsonb)$$) = 'no_autorizada'
  and public.ninera_mi_carsitting() is null);
reset role;

-- ---------------------------------------------------------------------------
-- Ana manda todo; la admin pide de nuevo; Ana corrige; la admin aprueba
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1800000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('manda: devuelve cuándo',
  public.ninera_guardar_carsitting(pg_temp.datos('{"color_auto": "  Gris oscuro  ", "libreta_propiedad": ""}'), pg_temp.fotos('0a1b2c3d')) is not null);
select pg_temp.verificar('ahora ve lo suyo: pendiente, los datos (sin espacios, la libreta vacía) y sus 7 fotos',
  (select r->>'revision' = 'pendiente' and r->'datos'->>'color_auto' = 'Gris oscuro' and r->'datos'->'libreta_propiedad' = 'null'::jsonb
          and r->'fotos' = pg_temp.fotos('0a1b2c3d') and r->>'aprobado_en' is null from public.ninera_mi_carsitting() r));
reset role;
select pg_temp.verificar('la fila de la app: una sola, con su nombre de la ficha, pendiente',
  (select count(*) = 1 from carsitting_datos where ninera_id = 'e2800000-0000-4000-8000-000000000001')
  and (select ninera_nombre = 'Ana Ficticia' and nombre_completo = 'Ana Ficticia Prueba' and revision = 'pendiente' and enviado_en is not null
         from carsitting_datos where ninera_id = 'e2800000-0000-4000-8000-000000000001'));
select pg_temp.verificar('el aviso a las admins: completó el carsitting',
  (select count(*) = 1 from avisos where clave like 'admin:carsitting:e2800000-0000-4000-8000-000000000001:%'
     and para_admin = 'todas' and tipo = 'carsitting' and titulo = 'Ana Ficticia completó el carsitting' and cuerpo = 'Revisalo.' and url = '?ir=hoy'));

set local role authenticated;
set local request.jwt.claims = '{"sub": "e1800000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('la admin ve las dos filas (la del formulario y la de la app)', (select count(*) = 2 from carsitting_datos));
select pg_temp.verificar('pedir de nuevo sin comentario no deja',
  pg_temp.error_de($$update carsitting_datos set revision = 'rehacer', revisado_por = 'Paula Prueba', comentario = '  '
                     where ninera_id = 'e2800000-0000-4000-8000-000000000001' and revision = 'pendiente'$$) = 'falta_comentario');
update carsitting_datos set revision = 'rehacer', revisado_por = 'Paula Prueba', comentario = 'La foto del dorso de la licencia está borrosa.'
 where ninera_id = 'e2800000-0000-4000-8000-000000000001' and enviado_en is not null and revision = 'pendiente';
reset role;
select pg_temp.verificar('pedir de nuevo: revisado, sin aprobar, y el comentario le llega por el chat con el nombre de la admin',
  (select revision = 'rehacer' and revisado_en is not null and aprobado_en is null from carsitting_datos where ninera_id = 'e2800000-0000-4000-8000-000000000001' and enviado_en is not null)
  and (select count(*) = 1 from chat_mensajes where ninera_id = 'e2800000-0000-4000-8000-000000000001' and de = 'admin' and autor = 'Paula Prueba'
         and texto = 'Hay que corregir algo de tus datos de carsitting: La foto del dorso de la licencia está borrosa.')
  and not exists (select 1 from avisos where clave like 'carsitting:e2800000-0000-4000-8000-000000000001:aprobado:%'));

set local role authenticated;
set local request.jwt.claims = '{"sub": "e1800000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Ana ve el comentario', (select r->>'revision' = 'rehacer' and r->>'comentario' = 'La foto del dorso de la licencia está borrosa.' from public.ninera_mi_carsitting() r));
insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'carsitting/e2800000-0000-4000-8000-000000000001/licencia_dorso_1b2c3d4e.jpg');
select pg_temp.verificar('corrige solo la foto',
  public.ninera_guardar_carsitting(pg_temp.datos('{"color_auto": "Gris oscuro"}'),
    '{"licencia_dorso": "carsitting/e2800000-0000-4000-8000-000000000001/licencia_dorso_1b2c3d4e.jpg"}') is not null);
select pg_temp.verificar('las otras fotos quedan y vuelve a pendiente, sin el comentario',
  (select r->>'revision' = 'pendiente' and r->>'comentario' is null
          and r->'fotos'->>'licencia_dorso' = 'carsitting/e2800000-0000-4000-8000-000000000001/licencia_dorso_1b2c3d4e.jpg'
          and r->'fotos'->>'asientos' = 'carsitting/e2800000-0000-4000-8000-000000000001/asientos_0a1b2c3d.jpg'
     from public.ninera_mi_carsitting() r));
reset role;
select pg_temp.verificar('dos avisos a las admins (dos envíos), los dos de "completó"',
  (select count(*) = 2 from avisos where clave like 'admin:carsitting:e2800000-0000-4000-8000-000000000001:%' and titulo = 'Ana Ficticia completó el carsitting'));

set local role authenticated;
set local request.jwt.claims = '{"sub": "e1800000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
update carsitting_datos set revision = 'aprobado', revisado_por = 'Paula Prueba'
 where ninera_id = 'e2800000-0000-4000-8000-000000000001' and enviado_en is not null and revision = 'pendiente';
reset role;
select pg_temp.verificar('aprobado: cuándo y quién, lo aprobado guardado (con las fotos) y el aviso neutro a Ana',
  (select revision = 'aprobado' and aprobado_en is not null and aprobado_en = revisado_en and aprobado_por = 'Paula Prueba'
          and aprobado_datos->>'modelo_auto' = 'Auto Inventado' and aprobado_datos->'fotos'->>'licencia_dorso' like '%1b2c3d4e.jpg'
     from carsitting_datos where ninera_id = 'e2800000-0000-4000-8000-000000000001' and enviado_en is not null)
  and (select count(*) = 1 from avisos where clave like 'carsitting:e2800000-0000-4000-8000-000000000001:aprobado:%'
         and para_ninera_id = 'e2800000-0000-4000-8000-000000000001' and tipo = 'carsitting'
         and titulo = 'Tu carsitting quedó aprobado' and cuerpo = 'Gracias por completar los datos.' and url = '#carsitting'));
update carsitting_datos set revision = 'aprobado', revisado_por = 'Otra Admin' where ninera_id = 'e2800000-0000-4000-8000-000000000001'
   and enviado_en is not null and revision = 'pendiente';
select pg_temp.verificar('la condición de la revisión: aprobar otra vez una que ya no está pendiente no hace nada',
  (select aprobado_por = 'Paula Prueba' from carsitting_datos where ninera_id = 'e2800000-0000-4000-8000-000000000001' and enviado_en is not null)
  and (select count(*) = 1 from avisos where clave like 'carsitting:e2800000-0000-4000-8000-000000000001:aprobado:%'));

-- Cambió de auto: actualiza estando aprobada.
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1800000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('actualiza el auto',
  public.ninera_guardar_carsitting(pg_temp.datos('{"modelo_auto": "Otro Auto Inventado"}'), '{}'::jsonb) is not null);
select pg_temp.verificar('vuelve a revisión y sigue aprobada con lo anterior',
  (select r->>'revision' = 'pendiente' and r->>'aprobado_en' is not null and r->'datos'->>'modelo_auto' = 'Otro Auto Inventado' from public.ninera_mi_carsitting() r));
reset role;
select pg_temp.verificar('lo aprobado sigue siendo el auto de antes, y el aviso a las admins dice que actualizó',
  (select aprobado_datos->>'modelo_auto' = 'Auto Inventado' and modelo_auto = 'Otro Auto Inventado'
     from carsitting_datos where ninera_id = 'e2800000-0000-4000-8000-000000000001' and enviado_en is not null)
  and (select count(*) = 1 from avisos where clave like 'admin:carsitting:e2800000-0000-4000-8000-000000000001:%' and titulo = 'Ana Ficticia actualizó los datos del auto'));
select pg_temp.verificar('la fila del formulario de Carla quedó como estaba',
  (select modelo_auto = 'Del formulario' and enviado_en is null and revision is null from carsitting_datos where ninera_id = 'e2800000-0000-4000-8000-000000000003'));

-- ---------------------------------------------------------------------------
-- Los avisos de tiempo
-- ---------------------------------------------------------------------------
-- Domingo 07/11/2027 a las 21:30: fuera de hora. A las 15: el primero a Carla (Ambas, sin fila de la app: la del
-- formulario no cuenta) y a Lola; ni a Ana (pendiente), ni a Bruno (Niñera), ni a Eva (sin app).
select pg_temp.verificar('de noche, nada', public.programar_avisos_carsitting('2027-11-07 21:30-03') = 0);
select pg_temp.verificar('a las 15: dos', public.programar_avisos_carsitting('2027-11-07 15:00-03') = 2);
select pg_temp.verificar('el primero a Carla y a Lola',
  (select titulo = 'Completa tus datos de carsitting' and cuerpo = 'Marcaste que realizas traslados. Necesitamos estos datos una sola vez.'
              and url = '#carsitting' and tipo = 'carsitting'
         from avisos where clave = 'carsitting:e2800000-0000-4000-8000-000000000003:completar')
  and pg_temp.hay_aviso('carsitting:e2800000-0000-4000-8000-000000000006:completar')
  and not pg_temp.hay_aviso('carsitting:e2800000-0000-4000-8000-000000000001:completar')
  and not pg_temp.hay_aviso('carsitting:e2800000-0000-4000-8000-000000000002:completar')
  and not pg_temp.hay_aviso('carsitting:e2800000-0000-4000-8000-000000000005:completar'));
select pg_temp.verificar('no se repite', public.programar_avisos_carsitting('2027-11-07 16:00-03') = 0);
-- Un lunes a las 10 antes de que le llegara el primero (el de hoy, con la hora real): todavía no.
select pg_temp.verificar('el lunes de antes del primero, nada', public.programar_avisos_carsitting('2026-10-26 10:30-03') = 0);
-- Ana pasa a 'rehacer' (revisada antes del lunes): le llega el de los lunes, aunque nunca recibió el primero.
update carsitting_datos set revision = 'rehacer', revisado_por = 'Paula Prueba', comentario = 'Falta la matrícula en la foto.'
 where ninera_id = 'e2800000-0000-4000-8000-000000000001' and enviado_en is not null;
select pg_temp.verificar('el lunes 08/11/2027 a las 10: tres', public.programar_avisos_carsitting('2027-11-08 10:05-03') = 3);
select pg_temp.verificar('el recordatorio a Carla, a Lola y a Ana (la que tiene que corregir)',
  (select titulo = 'Te faltan tus datos de carsitting' and cuerpo = 'Los necesitamos para tus traslados. Complétalos en la app.'
         from avisos where clave = 'carsitting:e2800000-0000-4000-8000-000000000003:semana:2027-11-08')
  and pg_temp.hay_aviso('carsitting:e2800000-0000-4000-8000-000000000001:semana:2027-11-08'));
select pg_temp.verificar('el mismo lunes a las 11 o un martes a las 10, nada',
  public.programar_avisos_carsitting('2027-11-08 11:00-03') = 0 and public.programar_avisos_carsitting('2027-11-09 10:00-03') = 0);
-- Con solo_practica prendido: solo Lola; la aprobación a una real tampoco avisa.
update app_config set valor = valor || '{"solo_practica": true}' where id = 'pedidos_app';
select pg_temp.verificar('con solo_practica: el lunes siguiente, uno', public.programar_avisos_carsitting('2027-11-15 10:00-03') = 1);
select pg_temp.verificar('con solo_practica: solo a Lola',
  pg_temp.hay_aviso('carsitting:e2800000-0000-4000-8000-000000000006:semana:2027-11-15'));
update carsitting_datos set revision = 'pendiente' where ninera_id = 'e2800000-0000-4000-8000-000000000001' and enviado_en is not null;
update carsitting_datos set revision = 'aprobado', revisado_en = null, revisado_por = 'Paula Prueba'
 where ninera_id = 'e2800000-0000-4000-8000-000000000001' and enviado_en is not null;
select pg_temp.verificar('con solo_practica: se aprueba, pero a Ana (real) no le llega el aviso',
  (select revision = 'aprobado' from carsitting_datos where ninera_id = 'e2800000-0000-4000-8000-000000000001' and enviado_en is not null)
  and (select count(*) = 1 from avisos where clave like 'carsitting:e2800000-0000-4000-8000-000000000001:aprobado:%'));

rollback;
