-- ============================================================================
-- Prueba de 20261110_dia_traslados.sql en un Postgres LOCAL (nunca en producción): el día y el cierre de los
-- traslados en la app de niñeras (decisiones.md 6.10). Lo que ve (ninera_mi_dia con los traslados, las zonas de
-- origen y destino), lo que marca ("Ya los busqué", "Ya los dejé", "No están los chicos"; los de la otra clase,
-- no), el cierre sin hora con el gasto (ninera_cerrar_traslado, que no toca gastos_extra ni el registro), que
-- ninera_cerrar_sitting no cierre un traslado, la foto del comprobante y los avisos de tiempo (programar_avisos_el_dia:
-- "no marcó que salió" y los 30 min después de "Ya los dejé"). Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_dia_traslados.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261110_dia_traslados.sql \
--     --migracion supabase/migraciones/20261110_dia_traslados_DESHACER.sql \
--     --migracion supabase/migraciones/20261110_dia_traslados.sql supabase/pruebas/fase1_dia_traslados.sql
-- (<schema de main>: git show origin/main:supabase/schema.sql guardado en una carpeta temporal.)
-- Las funciones de la niñera usan la hora real (now()): sus traslados son de hoy y de ayer. Los avisos de tiempo
-- se prueban con programar_avisos_el_dia(p_ahora) sobre fechas fijas de 2030. Todo termina en rollback.
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
create function pg_temp.hay_aviso(p_clave text) returns boolean language sql as $$
  select exists (select 1 from public.avisos where clave = p_clave)
$$;

-- ---------------------------------------------------------------------------
-- Está todo (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('los tipos de evento nuevos',
  pg_get_constraintdef((select oid from pg_constraint where conname = 'sitting_eventos_tipo_check')) like '%busque%deje%no_estan%');
select pg_temp.verificar('hora_fin del cierre puede ir vacía, pero no con "al día siguiente"',
  (select not attnotnull from pg_attribute where attrelid = 'public.sitting_cierres'::regclass and attname = 'hora_fin')
  and exists (select 1 from pg_constraint where conname = 'sitting_cierres_sin_hora_check'));
select pg_temp.verificar('la configuración: no_salio_min 0 y las de antes',
  (select (valor->>'no_salio_min')::int = 0 and (valor->>'no_llego_min')::int = 15 and (valor->>'cierre_recordatorio_min')::int = 30
     from app_config where id = 'el_dia'));
select pg_temp.verificar('ninera_cerrar_traslado: authenticated sí, anon no',
  has_function_privilege('authenticated', 'public.ninera_cerrar_traslado(uuid, text, numeric, text)', 'execute')
  and not has_function_privilege('anon', 'public.ninera_cerrar_traslado(uuid, text, numeric, text)', 'execute')
  and has_function_privilege('authenticated', 'public.ninera_mi_dia()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_mi_dia()', 'execute')
  and not has_function_privilege('authenticated', 'public.sitting_del_dia_ninera(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.programar_avisos_el_dia(timestamp with time zone)', 'execute'));
select pg_temp.verificar('ninera_mi_dia no devuelve plata, notas ni direcciones',
  pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%cobro%'
  and pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%pago%'
  and pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%notas%'
  and pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%direccion%'
  and pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%origen%'
  and pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%s.destino%'
  and pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%km%'
  and pg_get_functiondef('public.ninera_mi_dia'::regproc) not like '%precio%');

-- ---------------------------------------------------------------------------
-- Datos inventados: una admin; Ana y Bruno con app. Familia Prueba Uno (casa en Malvín); un pedido de traslado de
-- Pocitos a Centro asignado a Ana; un fijo de traslado de Ana. Los registros de Ana:
--   tHoy   traslado de hoy a las 00:00, del pedido (zonas del pedido);
--   tFijo  traslado de hoy a las 00:01 del fijo (sin pedido: la zona de la casa, sin destino);
--   tAyer  traslado de ayer a las 10:00, sin cerrar;
--   tRev   traslado de ayer, ya revisado;
--   sHoy   sitting de hoy a las 00:00 (para los de la otra clase);
-- y tBruno, un traslado de Bruno de hoy.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e1b00000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('e1b00000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid'),
  ('e1b00000-0000-4000-8000-000000000002', '59899000002@ninieras.parentsbreak.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('e1b00000-0000-4000-8000-0000000000a1', 'desarrollo');
insert into ninieras (id, nombre, telefono, user_id, activa, zona, tipo, app_activada_en) values
  ('e2b00000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'e1b00000-0000-4000-8000-000000000001', true, 'Pocitos', 'Ambos', now()),
  ('e2b00000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', 'e1b00000-0000-4000-8000-000000000002', true, 'Pocitos', 'Ambos', now());
insert into familias (id, nombre, zona, direccion, notas) values
  ('e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'Malvín', 'Calle Inventada 123', 'nota interna');
insert into asignaciones (id, familia_id, ninera_id, ninera_nombre, hora_inicio, hora_fin, tipo, cobro_traslado, pago_traslado) values
  ('e4b00000-0000-4000-8000-000000000001', 'e3b00000-0000-4000-8000-000000000001', 'e2b00000-0000-4000-8000-000000000001', 'Ana Ficticia',
   '00:01', '00:30', 'traslado', 400, 250);
insert into solicitudes (id, familia_id, familia_nombre, tipo, zona, fecha, hora_inicio, estado, origen, destino, destino_zona, km) values
  ('e6b00000-0000-4000-8000-000000000001', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'traslado', 'Pocitos',
   public.hoy_mvd(), '00:00', 'confirmada', 'Origen Inventado 1', 'Destino Inventado 2', 'Centro', 5);
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin,
                                cobro_familia, pago_ninera, cancelado, estado, revisado_at, asignacion_id, solicitud_id, origen, destino) values
  ('e5b00000-0000-4000-8000-000000000001', 'traslado', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000001', 'Ana Ficticia',
   public.hoy_mvd(), '00:00', null, 450, 250, false, 'confirmado', null, null, 'e6b00000-0000-4000-8000-000000000001', 'Origen Inventado 1', 'Destino Inventado 2'),
  ('e5b00000-0000-4000-8000-000000000002', 'traslado', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000001', 'Ana Ficticia',
   public.hoy_mvd(), '00:01', '00:30', 400, 250, false, 'confirmado', null, 'e4b00000-0000-4000-8000-000000000001', null, null, null),
  ('e5b00000-0000-4000-8000-000000000003', 'traslado', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000001', 'Ana Ficticia',
   public.hoy_mvd() - 1, '10:00', null, 450, 250, false, 'confirmado', null, null, null, null, null),
  ('e5b00000-0000-4000-8000-000000000004', 'traslado', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000001', 'Ana Ficticia',
   public.hoy_mvd() - 1, '10:00', null, 450, 250, false, 'confirmado', now(), null, null, null, null),
  ('e5b00000-0000-4000-8000-000000000005', 'sitting', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000001', 'Ana Ficticia',
   public.hoy_mvd(), '00:00', '23:59', 1000, 600, false, 'confirmado', null, null, null, null, null),
  ('e5b00000-0000-4000-8000-000000000006', 'traslado', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000002', 'Bruno Ejemplo',
   public.hoy_mvd(), '00:00', null, 450, 250, false, 'confirmado', null, null, null, null, null);
delete from avisos; -- los avisos por día de la etapa 8 ("Tienes un traslado"): acá se miran solo los del día

-- ---------------------------------------------------------------------------
-- Ana: lo que ve
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1b00000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('es Ana', public.ninera_actual() = 'e2b00000-0000-4000-8000-000000000001');
select pg_temp.verificar('ninera_mi_dia: el de ayer sin cerrar y los de hoy (traslados y el sitting); ni el revisado ni el de Bruno',
  (select array_agg(id order by id) from public.ninera_mi_dia())
    = array['e5b00000-0000-4000-8000-000000000001', 'e5b00000-0000-4000-8000-000000000002', 'e5b00000-0000-4000-8000-000000000003',
            'e5b00000-0000-4000-8000-000000000005']::uuid[]);
select pg_temp.verificar('el traslado del pedido: tipo, zona de origen y de destino del pedido (no la de la casa)',
  (select tipo = 'traslado' and zona = 'Pocitos' and destino_zona = 'Centro' and not es_fijo and eventos = '[]'::jsonb and cerrado_en is null
     from public.ninera_mi_dia() where id = 'e5b00000-0000-4000-8000-000000000001'));
select pg_temp.verificar('el fijo de traslado sin pedido: la zona de la casa y sin destino',
  (select tipo = 'traslado' and zona = 'Malvín' and destino_zona is null and es_fijo
     from public.ninera_mi_dia() where id = 'e5b00000-0000-4000-8000-000000000002'));
select pg_temp.verificar('el sitting: tipo sitting, sin destino',
  (select tipo = 'sitting' and zona = 'Malvín' and destino_zona is null from public.ninera_mi_dia() where id = 'e5b00000-0000-4000-8000-000000000005'));

-- ---------------------------------------------------------------------------
-- Ana: lo que marca
-- ---------------------------------------------------------------------------
select pg_temp.verificar('en un traslado no van los del sitting; en un sitting no van los del traslado',
  pg_temp.error_de($$select public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000001', 'entre')$$) = 'evento_invalido'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000001', 'no_abren')$$) = 'evento_invalido'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000001', 'no_encuentro')$$) = 'evento_invalido'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000005', 'busque')$$) = 'evento_invalido'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000005', 'deje')$$) = 'evento_invalido'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000005', 'no_estan')$$) = 'evento_invalido');
select pg_temp.verificar('ajenos: el de Bruno y uno que no existe',
  pg_temp.error_de($$select public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000006', 'busque')$$) = 'no_existe'
  and pg_temp.error_de($$select public.ninera_marcar_evento('e5b00000-0000-4000-8000-0000000000ff', 'busque')$$) = 'no_existe');
select pg_temp.verificar('"Estoy saliendo" y "Ya los busqué" quedan anotados',
  public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000001', 'saliendo') is not null
  and public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000001', 'busque') is not null);
select pg_temp.verificar('"Voy a llegar tarde" y "No están los chicos" quedan anotados',
  public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000001', 'tarde', 20) is not null
  and public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000001', 'no_estan') is not null);
select pg_temp.verificar('"Ya los dejé" queda anotado (y un segundo toque devuelve la misma hora)',
  public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000001', 'deje')
    = public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000001', 'deje'));
select pg_temp.verificar('ninera_mi_dia trae los cinco eventos del traslado',
  (select jsonb_agg(e->>'tipo' order by e->>'tipo') = '["busque", "deje", "no_estan", "saliendo", "tarde"]'::jsonb
     from public.ninera_mi_dia() d, jsonb_array_elements(d.eventos) e where d.id = 'e5b00000-0000-4000-8000-000000000001'));
reset role;
select pg_temp.verificar('avisos: tarde con "Al traslado de", "No están los chicos"; saliendo, busqué y dejé no avisan',
  (select titulo = 'Ana Ficticia va a llegar 20 min tarde' and cuerpo = 'Al traslado de Familia Prueba Uno.' and tipo = 'el_dia'
          and url = '?ir=hoy&sitting=e5b00000-0000-4000-8000-000000000001'
     from avisos where clave = 'admin:sitting:e5b00000-0000-4000-8000-000000000001:tarde:20')
  and (select titulo = 'Ana Ficticia llegó y no están los chicos' and cuerpo = 'Traslado de Familia Prueba Uno.' and tipo = 'el_dia'
          and para_admin = 'todas' and para_ninera_id is null and url = '?ir=hoy&sitting=e5b00000-0000-4000-8000-000000000001'
          and datos = '{"sitting_id": "e5b00000-0000-4000-8000-000000000001", "ninera_id": "e2b00000-0000-4000-8000-000000000001"}'::jsonb
     from avisos where clave = 'admin:sitting:e5b00000-0000-4000-8000-000000000001:no_estan')
  and (select count(*) = 2 from avisos where clave like 'admin:sitting:e5b00000-0000-4000-8000-000000000001:%'));

-- ---------------------------------------------------------------------------
-- Ana: la foto del comprobante y el cierre
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1b00000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('sube la foto de un traslado suyo abierto; no la de Bruno',
  pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('comprobantes', 'ninieras/e2b00000-0000-4000-8000-000000000001/e5b00000-0000-4000-8000-000000000001.jpg')$$) is null
  and pg_temp.error_de($$insert into storage.objects (bucket_id, name) values ('comprobantes', 'ninieras/e2b00000-0000-4000-8000-000000000001/e5b00000-0000-4000-8000-000000000006.jpg')$$) like '%row-level security%');
select pg_temp.verificar('cada cierre por su función: un sitting no se cierra como traslado ni un traslado como sitting',
  pg_temp.error_de($$select public.ninera_cerrar_traslado('e5b00000-0000-4000-8000-000000000005', null)$$) = 'no_existe'
  and pg_temp.error_de($$select public.ninera_cerrar_sitting('e5b00000-0000-4000-8000-000000000001', '12:00', false, null, null, null, null, null)$$) = 'no_existe');
select pg_temp.verificar('ajenos: el de Bruno y uno que no existe',
  pg_temp.error_de($$select public.ninera_cerrar_traslado('e5b00000-0000-4000-8000-000000000006', null)$$) = 'no_existe'
  and pg_temp.error_de($$select public.ninera_cerrar_traslado('e5b00000-0000-4000-8000-0000000000ff', null)$$) = 'no_existe');
select pg_temp.verificar('el revisado por una admin no se cierra',
  pg_temp.error_de($$select public.ninera_cerrar_traslado('e5b00000-0000-4000-8000-000000000004', null)$$) = 'ya_revisado');
select pg_temp.verificar('validaciones: comentario largo, monto 0 o enorme, gasto sin concepto, gasto sin la foto subida',
  pg_temp.error_de(format('select public.ninera_cerrar_traslado(%L, %L)', 'e5b00000-0000-4000-8000-000000000001', repeat('x', 2001))) = 'texto_largo'
  and pg_temp.error_de($$select public.ninera_cerrar_traslado('e5b00000-0000-4000-8000-000000000001', null, 0, 'Peaje')$$) = 'gasto_invalido'
  and pg_temp.error_de($$select public.ninera_cerrar_traslado('e5b00000-0000-4000-8000-000000000001', null, 100000, 'Peaje')$$) = 'gasto_invalido'
  and pg_temp.error_de($$select public.ninera_cerrar_traslado('e5b00000-0000-4000-8000-000000000001', null, 120, '   ')$$) = 'gasto_sin_concepto'
  and pg_temp.error_de($$select public.ninera_cerrar_traslado('e5b00000-0000-4000-8000-000000000003', null, 120, 'Peaje')$$) = 'falta_comprobante');
select pg_temp.verificar('cierra con el gasto y el comentario',
  public.ninera_cerrar_traslado('e5b00000-0000-4000-8000-000000000001', '  Había mucho tránsito  ', 120, '  Peaje   de   la ruta ') is not null);
select pg_temp.verificar('el cierre: sin hora, con el gasto (concepto limpio, la ruta de la base) y el comentario',
  (select hora_fin is null and not termina_dia_siguiente and comentarios = 'Había mucho tránsito' and calificacion is null
          and volveria is null and gasto_monto = 120 and gasto_concepto = 'Peaje de la ruta'
          and gasto_comprobante = 'ninieras/e2b00000-0000-4000-8000-000000000001/e5b00000-0000-4000-8000-000000000001.jpg'
          and gasto_id is null and revisado_en is null and ninera_id = 'e2b00000-0000-4000-8000-000000000001'
     from sitting_cierres where sitting_id = 'e5b00000-0000-4000-8000-000000000001'));
select pg_temp.verificar('un segundo envío devuelve la hora del primero sin cambiar nada',
  public.ninera_cerrar_traslado('e5b00000-0000-4000-8000-000000000001', 'otro', null, null)
    = (select creado_en from sitting_cierres where sitting_id = 'e5b00000-0000-4000-8000-000000000001'));
select pg_temp.verificar('sigue el comentario del primero',
  (select comentarios = 'Había mucho tránsito' and gasto_monto = 120 from sitting_cierres where sitting_id = 'e5b00000-0000-4000-8000-000000000001'));
select pg_temp.verificar('ya cerrado: no marca más y ya no ve la foto',
  pg_temp.error_de($$select public.ninera_marcar_evento('e5b00000-0000-4000-8000-000000000001', 'saliendo')$$) = 'ya_cerrado'
  and pg_temp.error_de($$update storage.objects set name = name where bucket_id = 'comprobantes' and name like 'ninieras/%'$$) is null
  and (select count(*) = 0 from storage.objects where bucket_id = 'comprobantes'));
select pg_temp.verificar('ninera_mi_dia lo trae cerrado',
  (select cerrado_en is not null from public.ninera_mi_dia() where id = 'e5b00000-0000-4000-8000-000000000001'));
select pg_temp.verificar('el fijo se cierra sin gasto ni comentario y sin haber marcado nada',
  public.ninera_cerrar_traslado('e5b00000-0000-4000-8000-000000000002', '   ') is not null);
reset role;
select pg_temp.verificar('el cierre del fijo, vacío',
  (select hora_fin is null and comentarios is null and gasto_monto is null and gasto_concepto is null and gasto_comprobante is null
     from sitting_cierres where sitting_id = 'e5b00000-0000-4000-8000-000000000002'));
select pg_temp.verificar('avisos del cierre: cerró, gasto y comentario; del fijo solo cerró',
  (select titulo = 'Ana Ficticia cerró el traslado de Familia Prueba Uno' and cuerpo = 'Revisalo en Hoy.' and tipo = 'cierres' and url = '?ir=hoy'
     from avisos where clave = 'admin:sitting:e5b00000-0000-4000-8000-000000000001:cerro')
  and (select titulo = 'Ana Ficticia cargó un gasto de ' || public.pesos_texto(120) and cuerpo = 'Con comprobante. Elegí quién lo paga.'
     from avisos where clave = 'admin:sitting:e5b00000-0000-4000-8000-000000000001:gasto')
  and (select titulo = 'Ana Ficticia dejó un comentario del traslado de Familia Prueba Uno'
     from avisos where clave = 'admin:sitting:e5b00000-0000-4000-8000-000000000001:comentario')
  and pg_temp.hay_aviso('admin:sitting:e5b00000-0000-4000-8000-000000000002:cerro')
  and not pg_temp.hay_aviso('admin:sitting:e5b00000-0000-4000-8000-000000000002:gasto')
  and not pg_temp.hay_aviso('admin:sitting:e5b00000-0000-4000-8000-000000000002:comentario'));
select pg_temp.verificar('el cierre no toca el registro ni gastos_extra',
  (select hora_fin is null and cobro_familia = 450 and pago_ninera = 250 and revisado_at is null
     from sittings_traslados where id = 'e5b00000-0000-4000-8000-000000000001')
  and not exists (select 1 from gastos_extra where sitting_id = 'e5b00000-0000-4000-8000-000000000001'));
select pg_temp.verificar('la tabla no acepta "al día siguiente" sin hora',
  pg_temp.error_de($$insert into sitting_cierres (sitting_id, ninera_id, hora_fin, termina_dia_siguiente) values ('e5b00000-0000-4000-8000-000000000003', 'e2b00000-0000-4000-8000-000000000001', null, true)$$)
    like '%sitting_cierres_sin_hora_check%');
-- La admin revisa: las mismas columnas que un sitting.
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1b00000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('la admin lee el cierre del traslado y lo marca revisado',
  (select count(*) = 1 from sitting_cierres where sitting_id = 'e5b00000-0000-4000-8000-000000000001')
  and pg_temp.error_de($$update sitting_cierres set revisado_en = now(), revisado_por = 'Admin' where sitting_id = 'e5b00000-0000-4000-8000-000000000001'$$) is null);
select pg_temp.verificar('la admin no cierra por la niñera',
  pg_temp.error_de($$select public.ninera_cerrar_traslado('e5b00000-0000-4000-8000-000000000003', null)$$) = 'no_autorizada');
reset role;

-- ---------------------------------------------------------------------------
-- Los avisos de tiempo (fechas fijas: jueves 10/01/2030), con solo_practica apagado. De Bruno:
--   T1 puntual a las 08:00 sin ningún toque; T2 puntual a las 08:00 con "Estoy saliendo"; T3 fijo a las 08:00 sin
--   toques; T4 puntual a las 12:00 con "Ya los dejé" a las 13:00; T5 fijo a las 12:00 con "Ya los dejé" a las 13:00;
--   T6 puntual a las 12:00 con "Ya los dejé" a las 13:00 y cerrado; T7 puntual a las 12:00 sin "Ya los dejé".
-- ---------------------------------------------------------------------------
update app_config set valor = valor || '{"solo_practica": false}'::jsonb where id = 'pedidos_app';
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin, asignacion_id, estado) values
  ('e5b00000-0000-4000-8000-000000000101', 'traslado', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '2030-01-10', '08:00', null, null, 'confirmado'),
  ('e5b00000-0000-4000-8000-000000000102', 'traslado', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '2030-01-10', '08:00', null, null, 'confirmado'),
  ('e5b00000-0000-4000-8000-000000000103', 'traslado', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '2030-01-10', '08:00', null, 'e4b00000-0000-4000-8000-000000000001', 'confirmado'),
  ('e5b00000-0000-4000-8000-000000000104', 'traslado', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '2030-01-10', '12:00', null, null, 'confirmado'),
  ('e5b00000-0000-4000-8000-000000000105', 'traslado', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '2030-01-10', '12:00', null, 'e4b00000-0000-4000-8000-000000000001', 'confirmado'),
  ('e5b00000-0000-4000-8000-000000000106', 'traslado', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '2030-01-10', '12:00', null, null, 'confirmado'),
  ('e5b00000-0000-4000-8000-000000000107', 'traslado', 'e3b00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'e2b00000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '2030-01-10', '12:00', null, null, 'confirmado');
insert into sitting_eventos (sitting_id, ninera_id, tipo, creado_en) values
  ('e5b00000-0000-4000-8000-000000000102', 'e2b00000-0000-4000-8000-000000000002', 'saliendo', '2030-01-10 07:40-03'),
  ('e5b00000-0000-4000-8000-000000000104', 'e2b00000-0000-4000-8000-000000000002', 'deje', '2030-01-10 13:00-03'),
  ('e5b00000-0000-4000-8000-000000000105', 'e2b00000-0000-4000-8000-000000000002', 'deje', '2030-01-10 13:00-03'),
  ('e5b00000-0000-4000-8000-000000000106', 'e2b00000-0000-4000-8000-000000000002', 'deje', '2030-01-10 13:00-03');
insert into sitting_cierres (sitting_id, ninera_id, hora_fin) values ('e5b00000-0000-4000-8000-000000000106', 'e2b00000-0000-4000-8000-000000000002', null);
delete from avisos;

select pg_temp.verificar('jueves 07:59: todavía no "no marcó que salió"',
  public.programar_avisos_el_dia('2030-01-10 07:59-03') >= 0
  and not exists (select 1 from avisos where clave like 'admin:%no_salio'));
select pg_temp.verificar('jueves 08:00: "no marcó que salió" (corre)', public.programar_avisos_el_dia('2030-01-10 08:00-03') >= 1);
select pg_temp.verificar('jueves 08:00: "no marcó que salió" del que no tocó nada; no del que salió ni del fijo',
  (select titulo = 'Bruno Ejemplo no marcó que salió' and cuerpo = 'El traslado de Familia Prueba Uno salía a las 08:00.'
          and para_admin = 'todas' and tipo = 'el_dia' and url = '?ir=hoy&sitting=e5b00000-0000-4000-8000-000000000101'
     from avisos where clave = 'admin:sitting:e5b00000-0000-4000-8000-000000000101:no_salio')
  and not pg_temp.hay_aviso('admin:sitting:e5b00000-0000-4000-8000-000000000102:no_salio')
  and not pg_temp.hay_aviso('admin:sitting:e5b00000-0000-4000-8000-000000000103:no_salio'));
select pg_temp.verificar('nunca "no marcó que llegó" ni los de fin de un sitting en un traslado',
  not exists (select 1 from avisos where clave like '%:no_llego' or clave like '%:fin'));
select pg_temp.verificar('una vez por traslado: correr de nuevo no repite',
  public.programar_avisos_el_dia('2030-01-10 08:01-03') = 0);
delete from avisos;
select pg_temp.verificar('un traslado asignado tarde no avisa atrasado (jueves 10:00, 2 h después)',
  public.programar_avisos_el_dia('2030-01-10 10:00-03') = 0);
select pg_temp.verificar('jueves 13:29: todavía no el del cierre (solo "no marcó que salió" de T7, que no tocó nada) (corre)',
  public.programar_avisos_el_dia('2030-01-10 13:29-03') = 1);
select pg_temp.verificar('jueves 13:29: todavía no el del cierre (solo "no marcó que salió" de T7, que no tocó nada)',
  pg_temp.hay_aviso('admin:sitting:e5b00000-0000-4000-8000-000000000107:no_salio')
  and (select count(*) = 1 from avisos));
select pg_temp.verificar('jueves 13:30: los del cierre (corre)', public.programar_avisos_el_dia('2030-01-10 13:30-03') = 4);
select pg_temp.verificar('jueves 13:30: a Bruno "Te falta cerrar el traslado" y a las admins "no cerró el traslado", también del fijo',
  (select titulo = 'Te falta cerrar el traslado' and cuerpo = 'Cuéntanos si hubo algún gasto.' and tipo = 'sitting'
          and para_ninera_id = 'e2b00000-0000-4000-8000-000000000002' and url = '#sitting/e5b00000-0000-4000-8000-000000000104/cierre'
     from avisos where clave = 'sitting:e5b00000-0000-4000-8000-000000000104:fin30')
  and (select titulo = 'Bruno Ejemplo no cerró el traslado' and cuerpo = 'Dejó a los chicos de Familia Prueba Uno a las 13:00.'
          and para_admin = 'todas' and tipo = 'cierres' and url = '?ir=hoy'
     from avisos where clave = 'admin:sitting:e5b00000-0000-4000-8000-000000000104:sin_cierre')
  and pg_temp.hay_aviso('sitting:e5b00000-0000-4000-8000-000000000105:fin30')
  and pg_temp.hay_aviso('admin:sitting:e5b00000-0000-4000-8000-000000000105:sin_cierre'));
select pg_temp.verificar('ni del cerrado ni del que no marcó "Ya los dejé"',
  not exists (select 1 from avisos where clave like '%e5b00000-0000-4000-8000-000000000106%')
  and not exists (select 1 from avisos where clave like '%e5b00000-0000-4000-8000-000000000107%:fin30')
  and not exists (select 1 from avisos where clave like '%e5b00000-0000-4000-8000-000000000107%:sin_cierre'));
delete from avisos;
select pg_temp.verificar('jueves 16:00 (3 h después de "Ya los dejé"): ya no', public.programar_avisos_el_dia('2030-01-10 16:00-03') = 0);

-- Con solo_practica prendido: solo traslados de práctica.
update app_config set valor = valor || '{"solo_practica": true}'::jsonb where id = 'pedidos_app';
select pg_temp.verificar('solo_practica: nada de un traslado real',
  public.programar_avisos_el_dia('2030-01-10 08:00-03') = 0 and public.programar_avisos_el_dia('2030-01-10 13:30-03') = 0);
update ninieras set nombre = 'Bruno (práctica)' where id = 'e2b00000-0000-4000-8000-000000000002';
update familias set nombre = 'Familia (práctica)' where id = 'e3b00000-0000-4000-8000-000000000001';
select pg_temp.verificar('solo_practica: el de práctica sí (corre)', public.programar_avisos_el_dia('2030-01-10 08:00-03') >= 1);
select pg_temp.verificar('solo_practica: el de práctica sí',
  pg_temp.hay_aviso('admin:sitting:e5b00000-0000-4000-8000-000000000101:no_salio'));

rollback;
