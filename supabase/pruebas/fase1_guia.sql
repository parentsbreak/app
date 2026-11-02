-- ============================================================================
-- Prueba de 20261105_guia.sql en un Postgres LOCAL (nunca en producción): la guía obligatoria y la
-- firma anual (decisiones.md 8). Quién puede recibir pedidos (nueva, plazo de las que ya trabajaban,
-- firma vigente, gracia, vencida), lo que la niñera anota (lecciones, repasos, firma, RCP), lo que ve y
-- lo que no, el bucket, el freno en enviar_pedido_app y sugeridas_datos, y los avisos. Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_guia.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261105_guia.sql \
--     --migracion supabase/migraciones/20261105_guia_DESHACER.sql \
--     --migracion supabase/migraciones/20261105_guia.sql supabase/pruebas/fase1_guia.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- Para "ser" una cuenta: set local role authenticated + set local request.jwt.claims; reset role
-- vuelve a postgres. Las reglas con tiempo se prueban con guia_estado(id, p_ahora) y
-- programar_avisos_guia(p_ahora). Todo termina en rollback.
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
-- hint|detail del error que tira la sentencia.
create function pg_temp.hint_detalle(sentencia text) returns text language plpgsql as $$
declare v_hint text; v_detalle text;
begin
  execute sentencia;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_detalle = pg_exception_detail;
  return v_hint || '|' || v_detalle;
end $$;
-- El estado de una niñera a una hora dada, como texto "puede/motivo/hasta" para comparar fácil.
create function pg_temp.estado(p_id uuid, p_ahora timestamptz) returns text language sql as $$
  select e.puede || '/' || coalesce(e.motivo, '-') || '/' || coalesce(e.hasta::text, '-')
    from public.guia_estado(p_id, p_ahora) e
$$;
-- Las 20 lecciones obligatorias (Protocolos sin b2 y RCP), escritas acá: la niñera no lee app_config.
create function pg_temp.obligatorias() returns text[] language sql as $$
  select array['pr1', 'pr2', 'pr3', 'pr4', 'pr5', 'pr6', 'pr7',
               'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9', 'x10', 'x11', 'x12', 'x13']
$$;

-- ---------------------------------------------------------------------------
-- Todo lo de la migración está (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('tres tablas nuevas con RLS',
  (select count(*) = 3 from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
    and relname in ('guia_progreso', 'guia_repasos', 'guia_firmas')));
select pg_temp.verificar('dos columnas de RCP en ninieras',
  (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'ninieras'
    and column_name in ('rcp_presencial', 'rcp_certificado_ruta')));
select pg_temp.verificar('la configuración: plazo 7, gracia 7, versión 2026.10, dos módulos y 20 lecciones',
  (select (valor->>'plazo_dias')::int = 7 and (valor->>'gracia_anual_dias')::int = 7 and valor->>'version_vigente' = '2026.10'
          and valor->'modulos_obligatorios' = '["protocolos", "auxilios"]'::jsonb
          and valor->'lecciones_obligatorias' = to_jsonb(pg_temp.obligatorias())
     from app_config where id = 'guia'));
select pg_temp.verificar('las de la niñera y las del panel: authenticated sí, anon no',
  has_function_privilege('authenticated', 'public.ninera_estado_guia()', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_marcar_leida(text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_aprobar_repaso(text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_firmar_guia(text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_guardar_rcp(boolean, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_puede_recibir_pedidos(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.guia_estado_ninieras()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_estado_guia()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_firmar_guia(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_puede_recibir_pedidos(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_mi_perfil()', 'execute'));
select pg_temp.verificar('guia_estado y la regla de avisos: ni authenticated ni anon',
  not has_function_privilege('authenticated', 'public.guia_estado(uuid, timestamp with time zone)', 'execute')
  and not has_function_privilege('anon', 'public.guia_estado(uuid, timestamp with time zone)', 'execute')
  and not has_function_privilege('authenticated', 'public.programar_avisos_guia(timestamp with time zone)', 'execute'));
select pg_temp.verificar('programar_avisos llama a la regla de la guía',
  pg_get_functiondef('public.programar_avisos'::regproc) like '%programar_avisos_guia()%');
select pg_temp.verificar('ninera_estado_guia no devuelve plata',
  pg_get_functiondef('public.ninera_estado_guia'::regproc) not like '%cobro%'
  and pg_get_functiondef('public.ninera_estado_guia'::regproc) not like '%pago%');

-- ---------------------------------------------------------------------------
-- Datos inventados (la app se activó el 01/11/2026 a las 10:00 de Montevideo):
--   Ana: nueva (sin sittings antes de activar la app);
--   Bruno: ya trabajaba (un sitting con su id el 15/10);
--   Carla: ya trabajaba, pero la historia vieja solo tiene su nombre (con espacios y en mayúsculas);
--   Dora: solo un sitting cancelado antes: cuenta como nueva;
--   Eva: sin app; Fabi: dada de baja.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e1000000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('e1000000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid'),
  ('e1000000-0000-4000-8000-000000000002', '59899000002@ninieras.parentsbreak.invalid'),
  ('e1000000-0000-4000-8000-000000000003', '59899000003@ninieras.parentsbreak.invalid'),
  ('e1000000-0000-4000-8000-000000000004', '59899000004@ninieras.parentsbreak.invalid'),
  ('e1000000-0000-4000-8000-000000000006', '59899000006@ninieras.parentsbreak.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('e1000000-0000-4000-8000-0000000000a1', 'desarrollo');
insert into ninieras (id, nombre, telefono, user_id, activa, zona, tipo, app_activada_en) values
  ('e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'e1000000-0000-4000-8000-000000000001', true, 'Pocitos', 'Niñera', '2026-11-01 10:00-03'),
  ('e2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', 'e1000000-0000-4000-8000-000000000002', true, 'Pocitos', 'Niñera', '2026-11-01 10:00-03'),
  ('e2000000-0000-4000-8000-000000000003', 'Carla Prueba', '099000003', 'e1000000-0000-4000-8000-000000000003', true, 'Pocitos', 'Niñera', '2026-11-01 10:00-03'),
  ('e2000000-0000-4000-8000-000000000004', 'Dora Inventada', '099000004', 'e1000000-0000-4000-8000-000000000004', true, 'Pocitos', 'Niñera', '2026-11-01 10:00-03'),
  ('e2000000-0000-4000-8000-000000000005', 'Eva Sinapp', '099000005', null, true, 'Pocitos', 'Niñera', null),
  ('e2000000-0000-4000-8000-000000000006', 'Fabi Debaja', '099000006', 'e1000000-0000-4000-8000-000000000006', false, 'Pocitos', 'Niñera', '2026-11-01 10:00-03');
insert into sittings_traslados (tipo, familia_nombre, ninera_id, ninera_nombre, fecha, cancelado) values
  ('sitting', 'Familia Prueba Uno', 'e2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '2026-10-15', false),
  ('sitting', 'Familia Prueba Uno', null, '  CARLA prueba ', '2026-10-20', false),
  ('sitting', 'Familia Prueba Uno', 'e2000000-0000-4000-8000-000000000004', 'Dora Inventada', '2026-10-20', true),
  -- el mismo día que activó la app no cuenta como "antes"
  ('sitting', 'Familia Prueba Uno', 'e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '2026-11-01', false);

-- ---------------------------------------------------------------------------
-- Quién puede recibir pedidos, sin guía
-- ---------------------------------------------------------------------------
select pg_temp.verificar('Ana, nueva: no puede, le falta la guía',
  pg_temp.estado('e2000000-0000-4000-8000-000000000001', '2026-11-02 12:00-03') = 'false/sin_guia/-');
select pg_temp.verificar('Bruno, ya trabajaba: puede hasta el 08/11 (7 días desde que activó la app)',
  pg_temp.estado('e2000000-0000-4000-8000-000000000002', '2026-11-02 12:00-03') = 'true/plazo/2026-11-08');
select pg_temp.verificar('Bruno el 08/11 a las 09:59 todavía puede; a las 10:00 ya no',
  pg_temp.estado('e2000000-0000-4000-8000-000000000002', '2026-11-08 09:59-03') = 'true/plazo/2026-11-08'
  and pg_temp.estado('e2000000-0000-4000-8000-000000000002', '2026-11-08 10:00-03') = 'false/sin_guia/-');
select pg_temp.verificar('Carla, con la historia vieja solo por nombre: también tiene el plazo',
  pg_temp.estado('e2000000-0000-4000-8000-000000000003', '2026-11-02 12:00-03') = 'true/plazo/2026-11-08');
select pg_temp.verificar('Dora, solo con un cancelado: es nueva',
  pg_temp.estado('e2000000-0000-4000-8000-000000000004', '2026-11-02 12:00-03') = 'false/sin_guia/-');
select pg_temp.verificar('Eva sin app y Fabi dada de baja',
  pg_temp.estado('e2000000-0000-4000-8000-000000000005', '2026-11-02 12:00-03') = 'false/sin_app/-'
  and pg_temp.estado('e2000000-0000-4000-8000-000000000006', '2026-11-02 12:00-03') = 'false/inactiva/-');

-- ---------------------------------------------------------------------------
-- Ana lee, aprueba y firma
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('es Ana', public.ninera_actual() = 'e2000000-0000-4000-8000-000000000001');
select pg_temp.verificar('su estado sin nada: no completa, no puede, sin_guia, sin lecciones',
  (select not completa and not firma_vigente and not puede and motivo = 'sin_guia' and lecciones_leidas = '{}' and repasos_aprobados = '{}'
     from public.ninera_estado_guia()));
select pg_temp.verificar('inválidos: lección vacía, con mayúsculas, con espacios, larga; versión mala',
  pg_temp.error_de($$select public.ninera_marcar_leida('', '2026.10')$$) = 'leccion_invalida'
  and pg_temp.error_de($$select public.ninera_marcar_leida('PR1', '2026.10')$$) = 'leccion_invalida'
  and pg_temp.error_de($$select public.ninera_marcar_leida('pr 1', '2026.10')$$) = 'leccion_invalida'
  and pg_temp.error_de($$select public.ninera_marcar_leida(repeat('a', 21), '2026.10')$$) = 'leccion_invalida'
  and pg_temp.error_de($$select public.ninera_marcar_leida('pr1', '2026')$$) = 'version_invalida'
  and pg_temp.error_de($$select public.ninera_aprobar_repaso('Protocolos', '2026.10')$$) = 'modulo_invalido');
select pg_temp.verificar('no escribe directo en sus tablas',
  pg_temp.error_de($$insert into guia_progreso (ninera_id, leccion_id, version) values ('e2000000-0000-4000-8000-000000000001', 'pr1', '2026.10')$$) like '%permission denied%'
  and pg_temp.error_de($$insert into guia_firmas (ninera_id, version, nombre, firma_ruta) values ('e2000000-0000-4000-8000-000000000001', '2026.10', 'Ana', 'x')$$) like '%permission denied%');
select public.ninera_marcar_leida(l, '2026.10') from unnest(pg_temp.obligatorias()) l;
select public.ninera_marcar_leida('e1', '2026.10'); -- una de Bebés: se anota, no cuenta para la obligatoria
select public.ninera_aprobar_repaso('protocolos', '2026.10');
select pg_temp.verificar('con las 20 lecciones y un solo repaso: todavía no está completa',
  (select not completa from public.ninera_estado_guia()));
select pg_temp.verificar('firmar sin la guía completa: no',
  pg_temp.error_de($$select public.ninera_firmar_guia('Ana Ficticia', '2026.10')$$) = 'guia_incompleta');
select public.ninera_aprobar_repaso('auxilios', '2026.10');
select pg_temp.verificar('con los dos repasos: completa, pero sin firma todavía no puede',
  (select completa and not puede and motivo = 'sin_guia' and cardinality(lecciones_leidas) = 21 and repasos_aprobados = '{auxilios,protocolos}'
     from public.ninera_estado_guia()));
select pg_temp.verificar('firmar sin haber subido la imagen: no',
  pg_temp.error_de($$select public.ninera_firmar_guia('Ana Ficticia', '2026.10')$$) = 'falta_firma');
select pg_temp.verificar('nombre de menos de 3 letras: no',
  pg_temp.error_de($$select public.ninera_firmar_guia('  A ', '2026.10')$$) = 'nombre_invalido');

-- El bucket: la firma solo con la ruta del día; el certificado, uno solo; nada en carpetas ajenas.
select pg_temp.verificar('sube su firma de hoy',
  pg_temp.error_de(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'ninieras-privado',
    'firmas/e2000000-0000-4000-8000-000000000001/' || to_char(public.hoy_mvd(), 'YYYY-MM-DD') || '.png')) is null);
select pg_temp.verificar('no puede subir una firma con otra fecha, otro nombre, ni en la carpeta de otra',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'firmas/e2000000-0000-4000-8000-000000000001/2020-01-01.png')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'firmas/e2000000-0000-4000-8000-000000000001/otra.png')$$) like '%row-level security%'
  and pg_temp.error_de(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'ninieras-privado',
    'firmas/e2000000-0000-4000-8000-000000000002/' || to_char(public.hoy_mvd(), 'YYYY-MM-DD') || '.png')) like '%row-level security%');
select pg_temp.verificar('el certificado solo en rcp/<su id>/certificado.jpg',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'rcp/e2000000-0000-4000-8000-000000000001/certificado.jpg')$$) is null
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'rcp/e2000000-0000-4000-8000-000000000001/otro.jpg')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'rcp/e2000000-0000-4000-8000-000000000002/certificado.jpg')$$) like '%row-level security%');
select pg_temp.verificar('la foto propuesta sigue andando',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'fotos/e2000000-0000-4000-8000-000000000001/propuesta.jpg')$$) is null);

select pg_temp.verificar('firma con el nombre sin espacios de más',
  pg_temp.error_de($$select public.ninera_firmar_guia('  Ana    Ficticia  ', '2026.10')$$) is null);
select pg_temp.verificar('un segundo toque el mismo día: la misma firma, sin otra fila',
  (select public.ninera_firmar_guia('Ana Ficticia', '2026.10')) = (select firmado_en from guia_firmas)
  and (select count(*) = 1 from guia_firmas));
select pg_temp.verificar('ya firmó: firma vigente y puede; el ciclo nuevo arranca vacío (completa vuelve a false)',
  (select firma_vigente and puede and motivo is null and not completa and lecciones_ciclo = '{}' and repasos_ciclo = '{}'
          and cardinality(lecciones_leidas) = 21 and version_firma = '2026.10'
     from public.ninera_estado_guia()));
select pg_temp.verificar('ve su firma (y solo la suya)',
  (select count(*) = 1 and bool_and(nombre = 'Ana Ficticia' and version = '2026.10'
          and firma_ruta = 'firmas/e2000000-0000-4000-8000-000000000001/' || to_char(public.hoy_mvd(), 'YYYY-MM-DD') || '.png')
     from guia_firmas));

-- RCP presencial
select pg_temp.verificar('RCP: null no',
  pg_temp.error_de($$select public.ninera_guardar_rcp(null, false)$$) = 'rcp_invalido');
-- (cada escritura en su sentencia: una lectura en la misma no ve el cambio)
select pg_temp.verificar('presencial con el certificado ya subido: se guarda',
  pg_temp.error_de($$select public.ninera_guardar_rcp(true, true)$$) is null);
select pg_temp.verificar('su perfil lo muestra',
  (select rcp_presencial and rcp_certificado from public.ninera_mi_perfil()));
select pg_temp.verificar('sin curso presencial: se guarda',
  pg_temp.error_de($$select public.ninera_guardar_rcp(false, true)$$) is null);
select pg_temp.verificar('y no queda certificado',
  (select rcp_presencial = false and not rcp_certificado from public.ninera_mi_perfil()));
reset role;
select pg_temp.verificar('en la ficha: presencial false y sin ruta',
  (select rcp_presencial = false and rcp_certificado_ruta is null from ninieras where id = 'e2000000-0000-4000-8000-000000000001'));

-- ---------------------------------------------------------------------------
-- Bruno: no ve lo de Ana; no puede firmar sin la guía; no puede preguntar por otra
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Bruno no ve el progreso, los repasos ni la firma de Ana',
  (select count(*) = 0 from guia_progreso) and (select count(*) = 0 from guia_repasos) and (select count(*) = 0 from guia_firmas));
select pg_temp.verificar('Bruno: presencial con certificado sin haber subido la foto: no',
  pg_temp.error_de($$select public.ninera_guardar_rcp(true, true)$$) = 'falta_certificado');
select pg_temp.verificar('Bruno no puede preguntar por Ana, ni ver la lista del panel',
  pg_temp.error_de($$select * from public.ninera_puede_recibir_pedidos('e2000000-0000-4000-8000-000000000001')$$) = 'no_autorizada'
  and pg_temp.error_de($$select * from public.guia_estado_ninieras()$$) = 'no_autorizada'
  and pg_temp.error_de($$select * from public.guia_estado('e2000000-0000-4000-8000-000000000001')$$) like '%permission denied%');
select pg_temp.verificar('Bruno sí puede preguntar por sí mismo',
  pg_temp.error_de($$select * from public.ninera_puede_recibir_pedidos('e2000000-0000-4000-8000-000000000002')$$) is null);
reset role;

-- Sin sesión de niñera: nada
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000ff", "email": "otra@ejemplo.invalid"}';
select pg_temp.verificar('una cuenta sin ficha: estado vacío y no anota nada',
  (select count(*) = 0 from public.ninera_estado_guia())
  and pg_temp.error_de($$select public.ninera_marcar_leida('pr1', '2026.10')$$) = 'no_autorizada'
  and pg_temp.error_de($$select public.ninera_firmar_guia('Alguien', '2026.10')$$) = 'no_autorizada');
reset role;

-- ---------------------------------------------------------------------------
-- El año de la firma: gracia, vencida y el ciclo nuevo
-- ---------------------------------------------------------------------------
update guia_firmas set firmado_en = '2025-10-28 10:00-03' where ninera_id = 'e2000000-0000-4000-8000-000000000001';
update guia_progreso set leido_en = '2025-10-27 10:00-03' where ninera_id = 'e2000000-0000-4000-8000-000000000001';
update guia_repasos set aprobado_en = '2025-10-27 10:00-03' where ninera_id = 'e2000000-0000-4000-8000-000000000001';
select pg_temp.verificar('a los 364 días de la firma, vigente',
  pg_temp.estado('e2000000-0000-4000-8000-000000000001', '2026-10-27 10:00-03') = 'true/-/-');
select pg_temp.verificar('a los 370 días, en la gracia (hasta el 04/11)',
  pg_temp.estado('e2000000-0000-4000-8000-000000000001', '2026-11-02 10:00-03') = 'true/gracia/2026-11-04');
select pg_temp.verificar('a los 380 días, vencida',
  pg_temp.estado('e2000000-0000-4000-8000-000000000001', '2026-11-12 10:00-03') = 'false/firma_vencida/-');
select pg_temp.verificar('lo leído antes de la firma vieja no cuenta para el ciclo nuevo',
  not (select completa from public.guia_estado('e2000000-0000-4000-8000-000000000001', '2026-11-12 10:00-03')));
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select public.ninera_marcar_leida(l, '2026.10') from unnest(pg_temp.obligatorias()) l;
select public.ninera_aprobar_repaso(m, '2026.10') from unnest(array['protocolos', 'auxilios']) m;
select pg_temp.verificar('releer y volver a aprobar después de la firma vieja: completa para firmar de nuevo',
  (select completa and cardinality(lecciones_ciclo) = 20 and repasos_ciclo = '{auxilios,protocolos}' from public.ninera_estado_guia()));
reset role;

-- ---------------------------------------------------------------------------
-- El panel: la lista, sugeridas_datos y enviar_pedido_app
-- ---------------------------------------------------------------------------
insert into familias (id, nombre, zona, cobro_hora, pago_hora, direccion) values
  ('e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'Pocitos', 500, 250, 'Calle Inventada 123');
insert into hijos_familia (familia_id, nombre, edad_declarada, edad_declarada_en, orden) values
  ('e3000000-0000-4000-8000-000000000001', 'Uno', 4, public.hoy_mvd(), 0);
insert into solicitudes (id, familia_id, familia_nombre, tipo, zona, fecha, hora_inicio, hora_fin, estado) values
  ('e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting', null,
   public.hoy_mvd() + 3, '20:00', '23:00', 'sin_asignar');
update app_config set valor = valor || '{"solo_practica": false}'::jsonb where id = 'pedidos_app';
-- Dora (nueva, sin guía) y Ana con la firma de hoy (vigente).
insert into guia_firmas (ninera_id, version, nombre, firma_ruta)
values ('e2000000-0000-4000-8000-000000000001', '2026.10', 'Ana Ficticia', 'firmas/e2000000-0000-4000-8000-000000000001/hoy.png');

set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('la lista del panel: las activas con app (ni Eva sin app ni Fabi de baja)',
  (select array_agg(ninera_id::text order by ninera_id) from public.guia_estado_ninieras())
  = array['e2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000004']);
select pg_temp.verificar('la admin pregunta por cualquiera',
  (select puede from public.ninera_puede_recibir_pedidos('e2000000-0000-4000-8000-000000000001'))
  and not (select puede from public.ninera_puede_recibir_pedidos('e2000000-0000-4000-8000-000000000004')));
select pg_temp.verificar('sugeridas_datos: la guía de cada una con app; null la que no tiene app',
  (select (p->>'guia_puede')::boolean and p->>'guia_motivo' is null
     from jsonb_array_elements(public.sugeridas_datos('e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', public.hoy_mvd() + 3)->'por_ninera') p
    where p->>'ninera_id' = 'e2000000-0000-4000-8000-000000000001')
  and (select (p->>'guia_puede')::boolean = false and p->>'guia_motivo' = 'sin_guia'
     from jsonb_array_elements(public.sugeridas_datos('e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', public.hoy_mvd() + 3)->'por_ninera') p
    where p->>'ninera_id' = 'e2000000-0000-4000-8000-000000000004')
  and (select p->'guia_puede' = 'null'::jsonb
     from jsonb_array_elements(public.sugeridas_datos('e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', public.hoy_mvd() + 3)->'por_ninera') p
    where p->>'ninera_id' = 'e2000000-0000-4000-8000-000000000005'));
select pg_temp.verificar('enviar_pedido_app frena a Dora (sin guía) y no manda a nadie (todo o nada)',
  pg_temp.error_de($$select public.enviar_pedido_app('e4000000-0000-4000-8000-000000000001',
    '[{"ninera_id": "e2000000-0000-4000-8000-000000000001", "precio_hora": 300}, {"ninera_id": "e2000000-0000-4000-8000-000000000004", "precio_hora": 300}]')$$) = 'ninera_sin_guia'
  and (select count(*) = 0 from solicitud_ninieras));
select pg_temp.verificar('el error trae el nombre en hint y el motivo en detail',
  pg_temp.hint_detalle($$select public.enviar_pedido_app('e4000000-0000-4000-8000-000000000001',
    '[{"ninera_id": "e2000000-0000-4000-8000-000000000004", "precio_hora": 300}]')$$) = 'Dora Inventada|sin_guia');
select pg_temp.verificar('a Ana (firma vigente) sí',
  public.enviar_pedido_app('e4000000-0000-4000-8000-000000000001', '[{"ninera_id": "e2000000-0000-4000-8000-000000000001", "precio_hora": 300}]') = 1);
reset role;


-- ---------------------------------------------------------------------------
-- Avisos (programar_avisos_guia)
-- ---------------------------------------------------------------------------
delete from avisos;
delete from guia_firmas where firma_ruta like '%/hoy.png';
select pg_temp.verificar('de noche no avisa',
  public.programar_avisos_guia('2026-11-02 08:59-03') = 0);
-- (cada corrida en su sentencia: leer avisos en la misma no vería lo que encoló)
select pg_temp.verificar('el 02/11 a las 10 encola dos (Bruno y Carla están en el plazo)',
  public.programar_avisos_guia('2026-11-02 10:00-03') = 2);
select pg_temp.verificar('"Te falta la guía" a Dora (nueva), con sus textos',
  (select titulo = 'Te falta la guía para empezar' and cuerpo = 'Lee Protocolos y RCP antes de tu primer sitting.'
          and url = '#guia' and tipo = 'guia' and para_ninera_id = 'e2000000-0000-4000-8000-000000000004'
     from avisos where clave = 'guia:e2000000-0000-4000-8000-000000000004:falta'));
select pg_temp.verificar('"Repasa la guía" a Ana: se cumplió el año de su firma (está en los 7 días de gracia)',
  (select titulo = 'Repasa la guía' and cuerpo = 'Hace un año que hiciste Protocolos y RCP. Repásalos para seguir recibiendo pedidos.'
          and para_ninera_id = 'e2000000-0000-4000-8000-000000000001'
     from avisos where clave = 'guia:e2000000-0000-4000-8000-000000000001:anual:2025-10-28'));
select pg_temp.verificar('repetir no duplica',
  public.programar_avisos_guia('2026-11-02 10:05-03') = 0);
select pg_temp.verificar('a mitad del plazo (el 05/11 a las 9) encola dos',
  public.programar_avisos_guia('2026-11-05 09:00-03') = 2);
select pg_temp.verificar('son a Bruno y a Carla',
  (select array_agg(clave order by clave) from avisos where clave like '%:falta:mitad')
    = array['guia:e2000000-0000-4000-8000-000000000002:falta:mitad', 'guia:e2000000-0000-4000-8000-000000000003:falta:mitad']);
select pg_temp.verificar('el 12/11 encola dos: a Bruno y Carla se les venció el plazo (a Ana no le repite el anual)',
  public.programar_avisos_guia('2026-11-12 10:00-03') = 2);
select pg_temp.verificar('son "Te falta" a Bruno y a Carla',
  (select count(*) = 2 from avisos where clave in ('guia:e2000000-0000-4000-8000-000000000002:falta', 'guia:e2000000-0000-4000-8000-000000000003:falta')));
select pg_temp.verificar('al día siguiente, nada repetido',
  public.programar_avisos_guia('2026-11-13 10:00-03') = 0);
select pg_temp.verificar('a Eva (sin app) y a Fabi (de baja) nunca les llega nada',
  not exists (select 1 from avisos where para_ninera_id in ('e2000000-0000-4000-8000-000000000005', 'e2000000-0000-4000-8000-000000000006')));

rollback;
