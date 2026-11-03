-- ============================================================================
-- Prueba de 20261106_el_dia.sql en un Postgres LOCAL (nunca en producción): el día del sitting y el cierre
-- de la niñera (decisiones.md 6.4). Lo que ve (ninera_mi_dia), lo que marca (ninera_marcar_evento), el
-- cierre con el gasto (ninera_cerrar_sitting, que no toca gastos_extra ni el registro), la foto del
-- comprobante, lo que la admin puede cambiar del cierre, "Prefiero otros perfiles" en sugeridas_datos y
-- los avisos de tiempo (programar_avisos_el_dia). Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_el_dia.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261106_el_dia.sql \
--     --migracion supabase/migraciones/20261106_el_dia_DESHACER.sql \
--     --migracion supabase/migraciones/20261106_el_dia.sql supabase/pruebas/fase1_el_dia.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- Las funciones de la niñera usan la hora real (now()): sus sittings son de hoy y de ayer. Los avisos de
-- tiempo se prueban con programar_avisos_el_dia(p_ahora) sobre fechas fijas de 2030. Todo termina en
-- rollback.
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
create function pg_temp.hay_aviso(p_clave text) returns boolean language sql as $$
  select exists (select 1 from public.avisos where clave = p_clave)
$$;
-- Cierre de Ana con lo mínimo (sin gasto ni textos), para probar las validaciones de la hora.
create function pg_temp.cerrar(p_id uuid, p_fin time, p_dia boolean) returns text language sql as $$
  select pg_temp.error_de(format('select public.ninera_cerrar_sitting(%L, %L, %L, null, null, null, null, null)', p_id, p_fin, p_dia))
$$;

-- ---------------------------------------------------------------------------
-- Está todo (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('dos tablas nuevas con RLS',
  (select count(*) = 2 from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
    and relname in ('sitting_eventos', 'sitting_cierres')));
select pg_temp.verificar('la configuración: 15 y 30 minutos',
  (select (valor->>'no_llego_min')::int = 15 and (valor->>'cierre_recordatorio_min')::int = 30 from app_config where id = 'el_dia'));
select pg_temp.verificar('las de la niñera: authenticated sí, anon no',
  has_function_privilege('authenticated', 'public.ninera_mi_dia()', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_marcar_evento(uuid, text, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_cerrar_sitting(uuid, time without time zone, boolean, text, integer, boolean, text, text, numeric, text)', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_ruta_comprobante(text)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_mi_dia()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_marcar_evento(uuid, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_cerrar_sitting(uuid, time without time zone, boolean, text, integer, boolean, text, text, numeric, text)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_ruta_comprobante(text)', 'execute'));
select pg_temp.verificar('la interna y la regla de avisos: ni authenticated ni anon',
  not has_function_privilege('authenticated', 'public.sitting_del_dia_ninera(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.sitting_del_dia_ninera(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.programar_avisos_el_dia(timestamp with time zone)', 'execute'));
select pg_temp.verificar('programar_avisos llama a la regla del día (y siguen las otras)',
  pg_get_functiondef('public.programar_avisos'::regproc) like '%programar_avisos_el_dia()%'
  and pg_get_functiondef('public.programar_avisos'::regproc) like '%programar_avisos_guia()%');
select pg_temp.verificar('ninera_mi_dia no devuelve plata, notas ni dirección',
  pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%cobro%'
  and pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%pago%'
  and pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%notas%'
  and pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%direccion%');
select pg_temp.verificar('la política del comprobante existe',
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'comprobantes_ninera_gasto'));

-- ---------------------------------------------------------------------------
-- Datos inventados: una admin; Ana y Bruno con app; Eva sin app. Familia Prueba Uno (Pocitos) y un fijo de
-- Ana con ella. Los sittings de Ana:
--   sAyer   ayer de 10:00 a 14:00, puntual (lo cierra con gasto);
--   sNoche  ayer de 22:00 a 02:00 de hoy (lo cierra pasada la medianoche);
--   sHoy    hoy de 00:00 a 23:59, puntual (los eventos);
--   sRev    ayer, ya revisado por una admin;
--   sViejo  hace 2 días; sTras un traslado de hoy; sCanc cancelado; sPrev previsto de hoy;
-- y sBruno, de Bruno, hoy.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e1700000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('e1700000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid'),
  ('e1700000-0000-4000-8000-000000000002', '59899000002@ninieras.parentsbreak.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('e1700000-0000-4000-8000-0000000000a1', 'desarrollo');
insert into ninieras (id, nombre, telefono, user_id, activa, zona, tipo, app_activada_en) values
  ('e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'e1700000-0000-4000-8000-000000000001', true, 'Pocitos', 'Niñera', now()),
  ('e2700000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', 'e1700000-0000-4000-8000-000000000002', true, 'Pocitos', 'Niñera', now()),
  ('e2700000-0000-4000-8000-000000000005', 'Eva Sinapp', '099000005', null, true, 'Pocitos', 'Niñera', null);
insert into familias (id, nombre, zona, direccion, notas) values
  ('e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'Pocitos', 'Calle Inventada 123', 'nota interna');
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, hora_inicio, hora_fin) values
  ('e4700000-0000-4000-8000-000000000001', 'e3700000-0000-4000-8000-000000000001', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', '16:00', '19:00');
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin,
                                cobro_familia, pago_ninera, cancelado, estado, revisado_at) values
  ('e5700000-0000-4000-8000-000000000001', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd() - 1, '10:00', '14:00', 1000, 600, false, 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000002', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd(), '00:00', '23:59', 1000, 600, false, 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000003', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd() - 1, '10:00', '14:00', 1000, 600, false, 'confirmado', now()),
  ('e5700000-0000-4000-8000-000000000004', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd() - 2, '10:00', '14:00', 1000, 600, false, 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000005', 'traslado', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd(), '08:00', null, 450, 250, false, 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000006', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd(), '10:00', '14:00', 0, 0, true, 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000007', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd(), '10:00', '14:00', 1000, 600, false, 'previsto', null),
  ('e5700000-0000-4000-8000-000000000009', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd() - 1, '22:00', '02:00', 1000, 600, false, 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000008', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000002', 'Bruno Ejemplo', public.hoy_mvd(), '00:00', '23:59', 1000, 600, false, 'confirmado', null);

update sittings_traslados set termina_dia_siguiente = true where id = 'e5700000-0000-4000-8000-000000000009';
-- Un comprobante de una admin (de un gasto del panel): la niñera no lo ve.
insert into storage.objects (bucket_id, name) values ('comprobantes', 'gastos/otro.jpg');

-- ---------------------------------------------------------------------------
-- Ana: lo que ve
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1700000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('es Ana', public.ninera_actual() = 'e2700000-0000-4000-8000-000000000001');
-- (desde la etapa 11b, 03/11/2026, también el traslado de hoy: fase1_dia_traslados.sql)
select pg_temp.verificar('ninera_mi_dia: los de ayer sin cerrar y los de hoy, en orden; ni el revisado, ni el viejo, ni el cancelado, ni el previsto, ni el de Bruno',
  (select array_agg(id) from public.ninera_mi_dia())
    = array['e5700000-0000-4000-8000-000000000001', 'e5700000-0000-4000-8000-000000000009', 'e5700000-0000-4000-8000-000000000002',
            'e5700000-0000-4000-8000-000000000005']::uuid[]);
select pg_temp.verificar('ninera_mi_dia: puntual, la zona y la madre con la inicial, sin eventos ni cierre',
  (select not es_fijo and zona = 'Pocitos' and madre = public.madre_nombre_inicial('Familia Prueba Uno')
          and eventos = '[]'::jsonb and cerrado_en is null
     from public.ninera_mi_dia() where id = 'e5700000-0000-4000-8000-000000000002'));
select pg_temp.verificar('no escribe directo en sus tablas',
  pg_temp.error_de($$insert into sitting_eventos (sitting_id, ninera_id, tipo) values ('e5700000-0000-4000-8000-000000000002', 'e2700000-0000-4000-8000-000000000001', 'entre')$$) is not null
  and pg_temp.error_de($$insert into sitting_cierres (sitting_id, ninera_id, hora_fin) values ('e5700000-0000-4000-8000-000000000002', 'e2700000-0000-4000-8000-000000000001', '12:00')$$) is not null);

-- ---------------------------------------------------------------------------
-- Ana: lo que marca durante el día
-- ---------------------------------------------------------------------------
select pg_temp.verificar('inválidos: tipo raro, tarde sin minutos o con 15',
  pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', 'llegue')$$) = 'evento_invalido'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', null)$$) = 'evento_invalido'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', 'tarde')$$) = 'minutos_invalidos'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', 'tarde', 15)$$) = 'minutos_invalidos');
select pg_temp.verificar('ajenos o fuera del día: el de Bruno, el cancelado, el previsto, el viejo, uno que no existe; "Ya entré" en el traslado no',
  pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000008', 'saliendo')$$) = 'no_existe'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000005', 'entre')$$) = 'evento_invalido'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000006', 'saliendo')$$) = 'no_existe'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000007', 'saliendo')$$) = 'no_existe'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000004', 'saliendo')$$) = 'no_existe'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-0000000000ff', 'saliendo')$$) = 'no_existe');
select pg_temp.verificar('"Estoy saliendo": queda anotado', public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', 'saliendo') is not null);
reset role;
select pg_temp.verificar('"Estoy saliendo": sin aviso a las admins',
  not exists (select 1 from public.avisos where clave like 'admin:sitting:e5700000-0000-4000-8000-000000000002:%'));
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1700000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('"Voy a llegar tarde" 10 min: aviso a todas las admins con el link a la tarjeta del día',
  public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', 'tarde', 10) is not null);
reset role;
select pg_temp.verificar('el aviso de tarde: título, cuerpo, tipo, url y datos',
  (select para_admin = 'todas' and para_ninera_id is null and tipo = 'el_dia'
          and titulo = 'Ana Ficticia va a llegar 10 min tarde' and cuerpo = 'A lo de Familia Prueba Uno.'
          and url = '?ir=hoy&sitting=e5700000-0000-4000-8000-000000000002'
          and datos = '{"sitting_id": "e5700000-0000-4000-8000-000000000002", "ninera_id": "e2700000-0000-4000-8000-000000000001"}'::jsonb
     from avisos where clave = 'admin:sitting:e5700000-0000-4000-8000-000000000002:tarde:10'));
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1700000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('el mismo toque otra vez: la misma hora, sin otra fila ni otro aviso',
  public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', 'tarde', 10)
    = (select creado_en from sitting_eventos where sitting_id = 'e5700000-0000-4000-8000-000000000002' and tipo = 'tarde'));
-- (lo que escribe una función no se ve en la misma sentencia: se mira en la siguiente)
select pg_temp.verificar('cambia a 30', public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', 'tarde', 30) is not null);
select pg_temp.verificar('se actualizaron los minutos, sin otra fila',
  (select minutos = 30 from sitting_eventos where sitting_id = 'e5700000-0000-4000-8000-000000000002' and tipo = 'tarde')
  and (select count(*) = 1 from sitting_eventos where sitting_id = 'e5700000-0000-4000-8000-000000000002' and tipo = 'tarde'));
select pg_temp.verificar('"Estoy afuera y no me abren" y "No encuentro la casa" avisan; "Ya entré" no',
  public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', 'no_abren') is not null
  and public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', 'no_encuentro') is not null
  and public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', 'entre') is not null);
select pg_temp.verificar('ninera_mi_dia trae los eventos en orden, con los minutos de tarde',
  -- (en la prueba todos tienen la misma hora: la de la transacción; se comparan ordenados)
  (select jsonb_agg(e->>'tipo' order by e->>'tipo') = '["entre", "no_abren", "no_encuentro", "saliendo", "tarde"]'::jsonb
          and (select (x->>'minutos')::int from jsonb_array_elements(d.eventos) x where x->>'tipo' = 'tarde') = 30
     from public.ninera_mi_dia() d, jsonb_array_elements(d.eventos) e where d.id = 'e5700000-0000-4000-8000-000000000002' group by d.eventos));
select pg_temp.verificar('lee solo sus eventos (5 de este sitting)',
  (select count(*) = 5 from sitting_eventos));
reset role;
select pg_temp.verificar('los avisos de los problemas',
  (select titulo = 'Ana Ficticia va a llegar 30 min o más tarde' from avisos where clave = 'admin:sitting:e5700000-0000-4000-8000-000000000002:tarde:30')
  and (select titulo = 'Ana Ficticia está afuera y no le abren' and cuerpo = 'Familia Prueba Uno.' and tipo = 'el_dia'
         from avisos where clave = 'admin:sitting:e5700000-0000-4000-8000-000000000002:no_abren')
  and (select titulo = 'Ana Ficticia no encuentra la casa' from avisos where clave = 'admin:sitting:e5700000-0000-4000-8000-000000000002:no_encuentro')
  and (select count(*) = 4 from avisos where clave like 'admin:sitting:e5700000-0000-4000-8000-000000000002:%'));

-- ---------------------------------------------------------------------------
-- Ana: la foto del comprobante
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1700000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('sube solo la ruta de un sitting suyo abierto',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('comprobantes', 'ninieras/e2700000-0000-4000-8000-000000000001/e5700000-0000-4000-8000-000000000001.jpg')$$) is null);
select pg_temp.verificar('ni de Bruno, ni del viejo, ni otro nombre, ni otra carpeta, ni a otro bucket',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('comprobantes', 'ninieras/e2700000-0000-4000-8000-000000000001/e5700000-0000-4000-8000-000000000008.jpg')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('comprobantes', 'ninieras/e2700000-0000-4000-8000-000000000002/e5700000-0000-4000-8000-000000000008.jpg')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('comprobantes', 'ninieras/e2700000-0000-4000-8000-000000000001/e5700000-0000-4000-8000-000000000004.jpg')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('comprobantes', 'ninieras/e2700000-0000-4000-8000-000000000001/e5700000-0000-4000-8000-000000000001.png')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('comprobantes', 'ninieras/e2700000-0000-4000-8000-000000000001/x/e5700000-0000-4000-8000-000000000001.jpg')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('comprobantes', 'otra/e5700000-0000-4000-8000-000000000001.jpg')$$) like '%row-level security%'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('ninieras-privado', 'ninieras/e2700000-0000-4000-8000-000000000001/e5700000-0000-4000-8000-000000000001.jpg')$$) like '%row-level security%');
select pg_temp.verificar('ve su comprobante y ningún otro del bucket',
  (select count(*) = 1 from storage.objects where bucket_id = 'comprobantes'));

-- ---------------------------------------------------------------------------
-- Ana: el cierre
-- ---------------------------------------------------------------------------
select pg_temp.verificar('la hora: antes del inicio sin "al día siguiente", o después del inicio con la marca',
  pg_temp.cerrar('e5700000-0000-4000-8000-000000000001', '09:00', false) = 'hora_invalida'
  and pg_temp.cerrar('e5700000-0000-4000-8000-000000000001', '10:00', false) = 'hora_invalida'
  and pg_temp.cerrar('e5700000-0000-4000-8000-000000000001', '11:00', true) = 'hora_invalida'
  and pg_temp.cerrar('e5700000-0000-4000-8000-000000000001', null, false) = 'hora_invalida');
select pg_temp.verificar('ajeno, revisado o fuera del día',
  pg_temp.cerrar('e5700000-0000-4000-8000-000000000008', '12:00', false) = 'no_existe'
  and pg_temp.cerrar('e5700000-0000-4000-8000-000000000004', '12:00', false) = 'no_existe'
  and pg_temp.cerrar('e5700000-0000-4000-8000-000000000005', '12:00', false) = 'no_existe'
  and pg_temp.cerrar('e5700000-0000-4000-8000-000000000003', '12:00', false) = 'ya_revisado');
do $$ begin
  -- La hora no puede estar más de 15 minutos en el futuro (fin de hoy a las 23:59). Cerca de la medianoche
  -- no se prueba: ya no sería futura.
  if (now() at time zone 'America/Montevideo')::time < '23:40' then
    perform pg_temp.verificar('una hora en el futuro: hora_futura',
      pg_temp.cerrar('e5700000-0000-4000-8000-000000000002', '23:59', false) = 'hora_futura');
  end if;
end $$;
select pg_temp.verificar('calificación fuera de 1 a 5, texto largo',
  pg_temp.error_de($$select public.ninera_cerrar_sitting('e5700000-0000-4000-8000-000000000001', '14:30', false, null, 6, null, null, null)$$) = 'calificacion_invalida'
  and pg_temp.error_de($$select public.ninera_cerrar_sitting('e5700000-0000-4000-8000-000000000001', '14:30', false, null, 0, null, null, null)$$) = 'calificacion_invalida'
  and pg_temp.error_de(format('select public.ninera_cerrar_sitting(%L, %L, false, %L, null, null, null, null)', 'e5700000-0000-4000-8000-000000000001', '14:30', repeat('a', 2001))) = 'texto_largo');
select pg_temp.verificar('el gasto: monto en 0 o enorme, sin "en qué", sin la foto (en el de hoy no subió ninguna)',
  pg_temp.error_de($$select public.ninera_cerrar_sitting('e5700000-0000-4000-8000-000000000001', '14:30', false, null, null, null, null, null, 0, 'Taxi')$$) = 'gasto_invalido'
  and pg_temp.error_de($$select public.ninera_cerrar_sitting('e5700000-0000-4000-8000-000000000001', '14:30', false, null, null, null, null, null, 100000, 'Taxi')$$) = 'gasto_invalido'
  and pg_temp.error_de($$select public.ninera_cerrar_sitting('e5700000-0000-4000-8000-000000000001', '14:30', false, null, null, null, null, null, 350, '   ')$$) = 'gasto_sin_concepto'
  and pg_temp.error_de($$select public.ninera_cerrar_sitting('e5700000-0000-4000-8000-000000000002', '00:30', false, null, null, null, null, null, 350, 'Taxi')$$) = 'falta_comprobante');
select pg_temp.verificar('ningún intento fallido dejó cierre',
  (select count(*) = 0 from sitting_cierres));
select pg_temp.verificar('cierra el de ayer a las 14:30 con gasto, comentarios y "Prefiero otros perfiles"',
  public.ninera_cerrar_sitting('e5700000-0000-4000-8000-000000000001', '14:30', false, '  Se lastimó la rodilla, nada grave.  ', 4,
    false, 'Legos', 'Todo bien', 350, '  Taxi   de vuelta ') is not null);
select pg_temp.verificar('el cierre quedó como se mandó (textos sin espacios de más, la ruta la armó la base)',
  (select hora_fin = '14:30' and not termina_dia_siguiente and comentarios = 'Se lastimó la rodilla, nada grave.' and calificacion = 4
          and volveria = false and jugaron = 'Legos' and comentario_equipo = 'Todo bien' and gasto_monto = 350
          and gasto_concepto = 'Taxi de vuelta'
          and gasto_comprobante = 'ninieras/e2700000-0000-4000-8000-000000000001/e5700000-0000-4000-8000-000000000001.jpg'
          and gasto_id is null and revisado_en is null
     from sitting_cierres where sitting_id = 'e5700000-0000-4000-8000-000000000001'));
select pg_temp.verificar('un segundo envío devuelve la misma hora y no cambia nada',
  public.ninera_cerrar_sitting('e5700000-0000-4000-8000-000000000001', '18:00', false, 'otra cosa', 1, true, null, null)
    = (select creado_en from sitting_cierres where sitting_id = 'e5700000-0000-4000-8000-000000000001')
  and (select hora_fin = '14:30' and calificacion = 4 from sitting_cierres where sitting_id = 'e5700000-0000-4000-8000-000000000001'));
select pg_temp.verificar('ya cerrado: no marca eventos ni toca la foto; ya no aparece mañana',
  pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000001', 'entre')$$) = 'ya_cerrado'
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('comprobantes', 'ninieras/e2700000-0000-4000-8000-000000000001/e5700000-0000-4000-8000-000000000001.jpg')$$) like '%row-level security%'
  and not exists (select 1 from public.ninera_mi_dia() where id = 'e5700000-0000-4000-8000-000000000001'));
do $$ begin
  -- Pasada la medianoche con "al día siguiente" (hoy a la 01:30) y el de hoy a las 00:01, sin gasto: "en qué"
  -- no se guarda. Antes de la 01:15 la hora todavía sería futura: no se prueba.
  if (now() at time zone 'America/Montevideo')::time >= '01:15' then
    perform public.ninera_cerrar_sitting('e5700000-0000-4000-8000-000000000009', '01:30', true, null, null, null, null, null);
    perform public.ninera_cerrar_sitting('e5700000-0000-4000-8000-000000000002', '00:01', false, null, null, null, null, null, null, 'Taxi');
    perform pg_temp.verificar('pasada la medianoche, con "al día siguiente"',
      (select termina_dia_siguiente and hora_fin = '01:30' from sitting_cierres where sitting_id = 'e5700000-0000-4000-8000-000000000009'));
    perform pg_temp.verificar('sin gasto, "en qué" no se guarda',
      (select not termina_dia_siguiente and gasto_concepto is null and gasto_monto is null
             from sitting_cierres where sitting_id = 'e5700000-0000-4000-8000-000000000002'));
    perform pg_temp.verificar('ninera_mi_dia: el de hoy dice cerrado y el de anoche ya no está',
      (select cerrado_en is not null from public.ninera_mi_dia() where id = 'e5700000-0000-4000-8000-000000000002')
      and not exists (select 1 from public.ninera_mi_dia() where id = 'e5700000-0000-4000-8000-000000000009'));
  end if;
end $$;
reset role;
select pg_temp.verificar('el cierre no tocó el registro ni creó un gasto extra',
  (select cobro_familia = 1000 and pago_ninera = 600 and hora_fin = '14:00' and revisado_at is null
     from sittings_traslados where id = 'e5700000-0000-4000-8000-000000000001')
  and (select count(*) = 0 from gastos_extra));
select pg_temp.verificar('avisos del cierre: terminó, gasto y comentario',
  (select titulo = 'Ana Ficticia terminó en Familia Prueba Uno a las 14:30' and cuerpo = 'Revisá el registro.' and tipo = 'cierres'
          and para_admin = 'todas' and url = '?ir=hoy'
     from avisos where clave = 'admin:sitting:e5700000-0000-4000-8000-000000000001:cerro')
  and (select titulo = 'Ana Ficticia cargó un gasto de $350' and cuerpo = 'Con comprobante. Elegí quién lo paga.'
         from avisos where clave = 'admin:sitting:e5700000-0000-4000-8000-000000000001:gasto')
  and (select titulo = 'Ana Ficticia dejó un comentario del sitting con Familia Prueba Uno' and cuerpo = 'Leelo ahora.'
         from avisos where clave = 'admin:sitting:e5700000-0000-4000-8000-000000000001:comentario'));
select pg_temp.verificar('sin gasto ni comentario, solo "terminó"',
  not pg_temp.hay_aviso('admin:sitting:e5700000-0000-4000-8000-000000000002:gasto')
  and not pg_temp.hay_aviso('admin:sitting:e5700000-0000-4000-8000-000000000002:comentario'));

-- ---------------------------------------------------------------------------
-- Bruno no ve lo de Ana
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1700000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Bruno: solo su sitting, ningún evento ni cierre de Ana, ningún comprobante',
  (select array_agg(id) from public.ninera_mi_dia()) = array['e5700000-0000-4000-8000-000000000008']::uuid[]
  and (select count(*) = 0 from sitting_eventos) and (select count(*) = 0 from sitting_cierres)
  and (select count(*) = 0 from storage.objects where bucket_id = 'comprobantes'));
select pg_temp.verificar('Bruno no cierra ni marca lo de Ana',
  pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', 'entre')$$) = 'no_existe');

-- ---------------------------------------------------------------------------
-- La admin
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "e1700000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('lee todos los eventos y cierres',
  (select count(*) >= 5 from sitting_eventos) and (select count(*) >= 1 from sitting_cierres));
select pg_temp.verificar('no es niñera: ninera_mi_dia vacío y no marca',
  not exists (select 1 from public.ninera_mi_dia())
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5700000-0000-4000-8000-000000000002', 'entre')$$) = 'no_autorizada'
  and pg_temp.error_de($$select public.ninera_cerrar_sitting('e5700000-0000-4000-8000-000000000002', '12:00', false, null, null, null, null, null)$$) = 'no_autorizada');
select pg_temp.verificar('del cierre cambia solo revisado_en, revisado_por y gasto_id',
  pg_temp.error_de($$update sitting_cierres set revisado_en = now(), revisado_por = 'Admin Prueba' where sitting_id = 'e5700000-0000-4000-8000-000000000001'$$) is null
  and pg_temp.error_de($$update sitting_cierres set hora_fin = '18:00' where sitting_id = 'e5700000-0000-4000-8000-000000000001'$$) like '%permission denied%'
  and pg_temp.error_de($$update sitting_cierres set gasto_monto = 1 where sitting_id = 'e5700000-0000-4000-8000-000000000001'$$) like '%permission denied%'
  and pg_temp.error_de($$delete from sitting_cierres where sitting_id = 'e5700000-0000-4000-8000-000000000001'$$) like '%permission denied%'
  and pg_temp.error_de($$insert into sitting_eventos (sitting_id, ninera_id, tipo) values ('e5700000-0000-4000-8000-000000000008', 'e2700000-0000-4000-8000-000000000002', 'entre')$$) like '%permission denied%');
select pg_temp.verificar('"Prefiero otros perfiles" en sugeridas_datos: Ana sí, Bruno no',
  (select (x->>'prefiere_otros')::boolean from jsonb_array_elements(public.sugeridas_datos('e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', public.hoy_mvd())->'por_ninera') x
    where x->>'ninera_id' = 'e2700000-0000-4000-8000-000000000001')
  and not (select (x->>'prefiere_otros')::boolean from jsonb_array_elements(public.sugeridas_datos('e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', public.hoy_mvd())->'por_ninera') x
    where x->>'ninera_id' = 'e2700000-0000-4000-8000-000000000002'));
select pg_temp.verificar('con otra familia no cuenta',
  not (select (x->>'prefiere_otros')::boolean from jsonb_array_elements(public.sugeridas_datos(null, 'Familia Prueba Dos', public.hoy_mvd())->'por_ninera') x
    where x->>'ninera_id' = 'e2700000-0000-4000-8000-000000000001'));
reset role;
-- Si después dijo "Sí" con esa familia, vuelve a su lugar (cuenta la última respuesta).
insert into sitting_cierres (sitting_id, ninera_id, hora_fin, volveria, creado_en)
values ('e5700000-0000-4000-8000-000000000004', 'e2700000-0000-4000-8000-000000000001', '14:00', true, now() + interval '1 minute');
select pg_temp.verificar('la última respuesta manda: después dijo "Sí"',
  not (select (x->>'prefiere_otros')::boolean from jsonb_array_elements(public.sugeridas_datos('e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', public.hoy_mvd())->'por_ninera') x
    where x->>'ninera_id' = 'e2700000-0000-4000-8000-000000000001'));

-- ---------------------------------------------------------------------------
-- Los avisos de tiempo (fechas fijas: jueves 10/01/2030). Con solo_practica apagado:
--   P1 puntual de Ana de 16:00 a 19:00; F1 el fijo de Ana igual; P2 puntual de Ana a las 16:00 con "Ya
--   entré"; P3 puntual de Ana cerrado; P4 puntual de Ana de 22:00 a 02:00 del día siguiente; P5 sin hora
--   de fin; X1 de Eva (sin app) y R1 revisado.
-- ---------------------------------------------------------------------------
delete from avisos;
update app_config set valor = valor || '{"solo_practica": false}'::jsonb where id = 'pedidos_app';
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin,
                                termina_dia_siguiente, asignacion_id, estado, revisado_at) values
  ('e5700000-0000-4000-8000-000000000101', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-10', '16:00', '19:00', false, null, 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000102', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-10', '16:00', '19:00', false, 'e4700000-0000-4000-8000-000000000001', 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000103', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-10', '16:00', '19:00', false, null, 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000104', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-10', '16:00', '19:00', false, null, 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000105', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-10', '22:00', '02:00', true, null, 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000106', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-10', '16:00', null, false, null, 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000107', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000005', 'Eva Sinapp', '2030-01-10', '16:00', '19:00', false, null, 'confirmado', null),
  ('e5700000-0000-4000-8000-000000000108', 'sitting', 'e3700000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2700000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-10', '16:00', '19:00', false, null, 'confirmado', '2030-01-10 12:00-03');
insert into sitting_eventos (sitting_id, ninera_id, tipo) values ('e5700000-0000-4000-8000-000000000103', 'e2700000-0000-4000-8000-000000000001', 'entre');
insert into sitting_cierres (sitting_id, ninera_id, hora_fin) values ('e5700000-0000-4000-8000-000000000104', 'e2700000-0000-4000-8000-000000000001', '19:00');
-- Desde la etapa 8, cargar estos sittings le avisa a Ana "Tienes un sitting": acá se miran solo los del cron.
delete from avisos;

select pg_temp.verificar('miércoles 16:30, 23 h 30 antes: "Mañana tienes un sitting" a los puntuales, no al fijo (corre)', public.programar_avisos_el_dia('2030-01-09 16:30-03') >= 1);
select pg_temp.verificar('miércoles 16:30, 23 h 30 antes: "Mañana tienes un sitting" a los puntuales, no al fijo',
  (select titulo = '¡Hola! Mañana tienes un sitting' and cuerpo = 'Jueves 10/01 a las 16:00, en Pocitos.' and tipo = 'sitting'
          and para_ninera_id = 'e2700000-0000-4000-8000-000000000001' and url = '#inicio'
     from avisos where clave = 'sitting:e5700000-0000-4000-8000-000000000101:24h')
  and not pg_temp.hay_aviso('sitting:e5700000-0000-4000-8000-000000000102:24h')
  and not pg_temp.hay_aviso('sitting:e5700000-0000-4000-8000-000000000107:24h')
  and not pg_temp.hay_aviso('sitting:e5700000-0000-4000-8000-000000000108:24h'));
select pg_temp.verificar('el de las 22:00 todavía no tiene el de 24 h (le faltan más de 24 h)',
  not pg_temp.hay_aviso('sitting:e5700000-0000-4000-8000-000000000105:24h'));
select pg_temp.verificar('miércoles 22:30 (corre)', public.programar_avisos_el_dia('2030-01-09 22:30-03') >= 1);
select pg_temp.verificar('miércoles 22:30: el de 24 h del de las 22:00',
  pg_temp.hay_aviso('sitting:e5700000-0000-4000-8000-000000000105:24h'));
select pg_temp.verificar('una vez por sitting: correr de nuevo no repite',
  public.programar_avisos_el_dia('2030-01-09 16:31-03') = 0);
select pg_temp.verificar('jueves 15:10: "Tu sitting empieza en 1 hora", no al fijo (corre)', public.programar_avisos_el_dia('2030-01-10 15:10-03') >= 1);
select pg_temp.verificar('jueves 15:10: "Tu sitting empieza en 1 hora", no al fijo',
  (select titulo = 'Tu sitting empieza en 1 hora' and cuerpo = '16:00, en Pocitos.'
     from avisos where clave = 'sitting:e5700000-0000-4000-8000-000000000101:1h')
  and not pg_temp.hay_aviso('sitting:e5700000-0000-4000-8000-000000000102:1h'));
select pg_temp.verificar('jueves 16:10: todavía no "no marcó que llegó"',
  public.programar_avisos_el_dia('2030-01-10 16:10-03') = 0);
select pg_temp.verificar('jueves 16:20: "no marcó que llegó" a las admins, no del que entró, del cerrado ni del fijo (corre)', public.programar_avisos_el_dia('2030-01-10 16:20-03') >= 1);
select pg_temp.verificar('jueves 16:20: "no marcó que llegó" a las admins, no del que entró, del cerrado ni del fijo',
  (select titulo = 'Ana Ficticia no marcó que llegó' and cuerpo = 'El sitting con Familia Prueba Uno empezaba a las 16:00.'
          and para_admin = 'todas' and tipo = 'el_dia' and url = '?ir=hoy&sitting=e5700000-0000-4000-8000-000000000101'
     from avisos where clave = 'admin:sitting:e5700000-0000-4000-8000-000000000101:no_llego')
  and not pg_temp.hay_aviso('admin:sitting:e5700000-0000-4000-8000-000000000103:no_llego')
  and not pg_temp.hay_aviso('admin:sitting:e5700000-0000-4000-8000-000000000104:no_llego')
  and not pg_temp.hay_aviso('admin:sitting:e5700000-0000-4000-8000-000000000102:no_llego'));
select pg_temp.verificar('jueves 19:00: "¿Ya te retiraste del hogar?" al puntual y al fijo, no al cerrado ni al sin hora de fin (corre)', public.programar_avisos_el_dia('2030-01-10 19:00-03') >= 2);
select pg_temp.verificar('jueves 19:00: "¿Ya te retiraste del hogar?" al puntual y al fijo, no al cerrado ni al sin hora de fin',
  (select titulo = '¿Ya te retiraste del hogar?' and cuerpo = 'Cuéntanos hasta qué hora estuviste.'
          and url = '#sitting/e5700000-0000-4000-8000-000000000101/cierre'
     from avisos where clave = 'sitting:e5700000-0000-4000-8000-000000000101:fin')
  and pg_temp.hay_aviso('sitting:e5700000-0000-4000-8000-000000000102:fin')
  and not pg_temp.hay_aviso('sitting:e5700000-0000-4000-8000-000000000104:fin')
  and not exists (select 1 from avisos where clave like 'sitting:e5700000-0000-4000-8000-000000000106:fin%'));
select pg_temp.verificar('jueves 19:30: "Te falta cerrar el sitting" (corre)', public.programar_avisos_el_dia('2030-01-10 19:30-03') >= 2);
select pg_temp.verificar('jueves 19:30: "Te falta cerrar el sitting"',
  (select titulo = 'Te falta cerrar el sitting' from avisos where clave = 'sitting:e5700000-0000-4000-8000-000000000101:fin30')
  and pg_temp.hay_aviso('sitting:e5700000-0000-4000-8000-000000000102:fin30'));
select pg_temp.verificar('el que pasa la medianoche todavía no tiene el de fin',
  not pg_temp.hay_aviso('sitting:e5700000-0000-4000-8000-000000000105:fin'));
select pg_temp.verificar('viernes 02:00 (corre)', public.programar_avisos_el_dia('2030-01-11 02:00-03') >= 1);
select pg_temp.verificar('el que pasa la medianoche: el fin es el viernes a las 02:00',
  pg_temp.hay_aviso('sitting:e5700000-0000-4000-8000-000000000105:fin'));
select pg_temp.verificar('a nadie sin app ni del revisado',
  not exists (select 1 from avisos where clave like '%e5700000-0000-4000-8000-000000000107%')
  and not exists (select 1 from avisos where clave like '%e5700000-0000-4000-8000-000000000108%'));
select pg_temp.verificar('un sitting asignado tarde no recibe avisos atrasados de golpe (viernes 12:00: nada)',
  public.programar_avisos_el_dia('2030-01-11 12:00-03') = 0);

-- Con solo_practica prendido: solo sittings de práctica.
delete from avisos;
update app_config set valor = valor || '{"solo_practica": true}'::jsonb where id = 'pedidos_app';
select pg_temp.verificar('solo_practica: ningún aviso de tiempo de un sitting real (corre)', public.programar_avisos_el_dia('2030-01-09 16:30-03') = 0);
select pg_temp.verificar('solo_practica: ningún aviso de tiempo de un sitting real',
  public.programar_avisos_el_dia('2030-01-10 16:20-03') = 0
  and public.programar_avisos_el_dia('2030-01-10 19:00-03') = 0);
update ninieras set nombre = 'Ana (práctica)' where id = 'e2700000-0000-4000-8000-000000000001';
update familias set nombre = 'Familia (práctica)' where id = 'e3700000-0000-4000-8000-000000000001';
select pg_temp.verificar('solo_practica: la de práctica con la familia de práctica sí (corre)', public.programar_avisos_el_dia('2030-01-09 16:30-03') >= 1);
select pg_temp.verificar('solo_practica: la de práctica con la familia de práctica sí',
  pg_temp.hay_aviso('sitting:e5700000-0000-4000-8000-000000000101:24h'));

rollback;
