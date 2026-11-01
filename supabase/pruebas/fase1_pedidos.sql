-- ============================================================================
-- Prueba de 20261102_pedidos_app.sql en un Postgres LOCAL (nunca en producción): mandar un pedido
-- por la app (enviar_pedido_app), lo que ve y responde la niñera (ninera_mis_pedidos,
-- responder_pedido, ninera_marcar_no_disponible), lo que lee el panel para ordenar las sugeridas
-- (sugeridas_datos) y los avisos. Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_pedidos.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261102_pedidos_app.sql \
--     --migracion supabase/migraciones/20261102_pedidos_app_DESHACER.sql \
--     --migracion supabase/migraciones/20261102_pedidos_app.sql supabase/pruebas/fase1_pedidos.sql
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
create function pg_temp.error_de(sentencia text) returns text language plpgsql as $$
begin
  execute sentencia;
  return null;
exception when others then
  return sqlerrm;
end $$;
-- "código|hint" del error.
create function pg_temp.error_hint_de(sentencia text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute sentencia;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlerrm || '|' || coalesce(v_hint, '');
end $$;

-- ---------------------------------------------------------------------------
-- Está todo (también después de aplicar → deshacer → aplicar)
-- ---------------------------------------------------------------------------
select pg_temp.verificar('columnas nuevas de solicitudes',
  (select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'solicitudes'
    and column_name in ('ninera_pedida_id', 'notas_para_ninera', 'enviado_app_en', 'responder_hasta')));
select pg_temp.verificar('columnas nuevas de solicitud_ninieras',
  (select count(*) = 6 from information_schema.columns where table_schema = 'public' and table_name = 'solicitud_ninieras'
    and column_name in ('origen', 'precio_hora', 'enviado_en', 'respondido_en', 'motivo_no', 'motivo_texto')));
select pg_temp.verificar('familias.solo_conocidas y pedidos_whatsapp.ninera_pedida',
  (select count(*) = 2 from information_schema.columns where table_schema = 'public'
    and ((table_name = 'familias' and column_name = 'solo_conocidas') or (table_name = 'pedidos_whatsapp' and column_name = 'ninera_pedida'))));
select pg_temp.verificar('ninera_no_disponible con RLS y dos políticas de lectura',
  (select relrowsecurity from pg_class where oid = 'public.ninera_no_disponible'::regclass)
  and (select count(*) = 2 from pg_policies where schemaname = 'public' and tablename = 'ninera_no_disponible' and cmd = 'SELECT')
  and (select count(*) = 2 from pg_policies where schemaname = 'public' and tablename = 'ninera_no_disponible'));
select pg_temp.verificar('los dos índices de solicitud_ninieras',
  (select count(*) = 2 from pg_indexes where schemaname = 'public'
    and indexname in ('solicitud_ninieras_app_unica', 'solicitud_ninieras_ninera_estado')));
select pg_temp.verificar('app_config pedidos_app con los cuatro tiempos y solo práctica prendido',
  (select valor ?& array['min_mismo_dia', 'min_otro_dia', 'recordatorio_min_antes', 'aviso_sin_ninera_horas']
          and (valor->>'solo_practica')::boolean
     from app_config where id = 'pedidos_app'));
select pg_temp.verificar('las cinco funciones security definer con search_path fijo',
  (select count(*) = 5 from pg_proc
    where pronamespace = 'public'::regnamespace and prosecdef
      and proname in ('enviar_pedido_app', 'ninera_mis_pedidos', 'responder_pedido', 'ninera_marcar_no_disponible',
                      'pedidos_whatsapp_aviso_nuevo')
      and exists (select 1 from unnest(proconfig) c where c = 'search_path=public')));
select pg_temp.verificar('sugeridas_datos es invoker (corre con la RLS de quien llama)',
  (select not prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname = 'sugeridas_datos'));
select pg_temp.verificar('anon no ejecuta ninguna',
  not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('enviar_pedido_app', 'ninera_mis_pedidos', 'responder_pedido', 'ninera_marcar_no_disponible', 'sugeridas_datos')
    and has_function_privilege('anon', oid, 'execute')));
select pg_temp.verificar('el trigger del aviso solo lo dispara la base',
  not has_function_privilege('authenticated', 'public.pedidos_whatsapp_aviso_nuevo()', 'execute'));

-- Ayudas
select pg_temp.verificar('pesos_texto', public.pesos_texto(300) = '$300' and public.pesos_texto(1250) = '$1.250'
  and public.pesos_texto(1250000) = '$1.250.000');
select pg_temp.verificar('normaliza_nombre como normaliza() de comun.js',
  public.normaliza_nombre('Ána Fíctícia ÑANDÚ') = 'ana ficticia nandu' and public.normaliza_nombre(null) = '');
select pg_temp.verificar('dia_corto_texto', public.dia_corto_texto('2026-11-07') = 'sáb 07/11'
  and public.dia_corto_texto('2026-11-08') = 'dom 08/11');

-- ---------------------------------------------------------------------------
-- Datos inventados: una admin; Ana y Bruno con app; Carla con app pero solo traslados; Dora sin app;
-- Eva con app pero dada de baja; Pía (práctica) con app. Familia Prueba Uno con dos chicos, Familia
-- Sin Chicos sin hijos ni texto, Familia (práctica) con un chico.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d1000000-0000-4000-8000-0000000000a1', 'admin.prueba@ejemplo.invalid'),
  ('d1000000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid'),
  ('d1000000-0000-4000-8000-000000000002', '59899000002@ninieras.parentsbreak.invalid'),
  ('d1000000-0000-4000-8000-000000000003', '59899000003@ninieras.parentsbreak.invalid'),
  ('d1000000-0000-4000-8000-000000000005', '59899000005@ninieras.parentsbreak.invalid'),
  ('d1000000-0000-4000-8000-000000000006', '59899000006@ninieras.parentsbreak.invalid');
insert into usuarias_autorizadas (user_id, rol) values ('d1000000-0000-4000-8000-0000000000a1', 'desarrollo');
insert into ninieras (id, nombre, telefono, user_id, activa, zona, tipo) values
  ('d2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'd1000000-0000-4000-8000-000000000001', true, 'Pocitos', 'Niñera'),
  ('d2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', 'd1000000-0000-4000-8000-000000000002', true, 'Pocitos', 'Ambas'),
  ('d2000000-0000-4000-8000-000000000003', 'Carla Prueba', '099000003', 'd1000000-0000-4000-8000-000000000003', true, 'Pocitos', 'Traslados'),
  ('d2000000-0000-4000-8000-000000000004', 'Dora Sinapp', '099000004', null, true, 'Pocitos', 'Niñera'),
  ('d2000000-0000-4000-8000-000000000005', 'Eva Debaja', '099000005', 'd1000000-0000-4000-8000-000000000005', false, 'Pocitos', 'Niñera'),
  ('d2000000-0000-4000-8000-000000000006', 'Pía (practica)', '099000006', 'd1000000-0000-4000-8000-000000000006', true, 'Pocitos', 'Niñera');
insert into familias (id, nombre, zona, cobro_hora, pago_hora, direccion) values
  ('d3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'Pocitos', 500, 250, 'Calle Inventada 123'),
  -- sin hijos cargados uno por uno, pero con el texto libre viejo (puede traer nombres): no alcanza
  ('d3000000-0000-4000-8000-000000000002', 'Familia Sin Chicos', 'Centro', 500, 250, null),
  ('d3000000-0000-4000-8000-000000000003', 'Familia (práctica)', 'Pocitos', 500, 250, null);
update familias set ninos = 'Juan Inventado de 3' where id = 'd3000000-0000-4000-8000-000000000002';
insert into hijos_familia (familia_id, nombre, edad_declarada, edad_declarada_en, orden) values
  ('d3000000-0000-4000-8000-000000000001', 'Uno', 4, public.hoy_mvd(), 0),
  ('d3000000-0000-4000-8000-000000000001', 'Dos', 7, public.hoy_mvd(), 1),
  ('d3000000-0000-4000-8000-000000000003', 'Tres', 2, public.hoy_mvd(), 0);
insert into solicitudes (id, familia_id, familia_nombre, tipo, zona, fecha, hora_inicio, hora_fin, estado, notas_para_ninera) values
  -- para mañana, con fin (termina al día siguiente: se marca abajo)
  ('d4000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting', null,
   public.hoy_mvd() + 1, '20:00', '00:30', 'sin_asignar', 'Alergia al maní (nota interna de prueba)'),
  -- para hoy, sin fin
  ('d4000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting', 'Punta Carretas',
   public.hoy_mvd(), '23:00', null, 'sin_asignar', null),
  ('d4000000-0000-4000-8000-000000000003', 'd3000000-0000-4000-8000-000000000002', 'Familia Sin Chicos', 'sitting', null,
   public.hoy_mvd() + 2, '10:00', '12:00', 'sin_asignar', null),
  ('d4000000-0000-4000-8000-000000000004', 'd3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'traslado', null,
   public.hoy_mvd() + 2, '10:00', null, 'sin_asignar', null),
  ('d4000000-0000-4000-8000-000000000005', 'd3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting', null,
   public.hoy_mvd() + 3, '10:00', '12:00', 'cancelada', null),
  ('d4000000-0000-4000-8000-000000000006', 'd3000000-0000-4000-8000-000000000003', 'Familia (práctica)', 'sitting', null,
   public.hoy_mvd() + 1, '18:00', '20:00', 'sin_asignar', null),
  ('d4000000-0000-4000-8000-000000000007', 'd3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting', null,
   public.hoy_mvd() - 1, '18:00', '20:00', 'sin_asignar', null);
update solicitudes set termina_dia_siguiente = true where id = 'd4000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- enviar_pedido_app: quién puede, qué valida y qué deja
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('una niñera no puede mandar pedidos',
  pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001', '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 300}]')$$) = 'no_autorizada');

set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('con solo_practica prendido, un pedido real no sale',
  pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001', '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 300}]')$$) = 'solo_practica');
select pg_temp.verificar('con solo_practica prendido, el de práctica sí (familia con tilde, niñera sin tilde)',
  public.enviar_pedido_app('d4000000-0000-4000-8000-000000000006', '[{"ninera_id": "d2000000-0000-4000-8000-000000000006", "precio_hora": 200}]') = 1);
reset role;
update app_config set valor = valor || '{"solo_practica": false}'::jsonb where id = 'pedidos_app';
set local role authenticated;
select pg_temp.verificar('sin niñeras', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001', '[]')$$) = 'sin_ninieras');
select pg_temp.verificar('pedido que no existe', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-0000000000ff', '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 300}]')$$) = 'no_existe');
select pg_temp.verificar('pedido cancelado', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000005', '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 300}]')$$) = 'cerrado');
select pg_temp.verificar('traslado', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000004', '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 300}]')$$) = 'solo_sittings');
select pg_temp.verificar('día que ya pasó', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000007', '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 300}]')$$) = 'pasado');
select pg_temp.verificar('familia sin chicos cargados (el texto libre viejo no alcanza)', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000003', '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 300}]')$$) = 'sin_chicos');
select pg_temp.verificar('niñera que ya no está en la base: el id en el hint',
  pg_temp.error_hint_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001', '[{"ninera_id": "d2000000-0000-4000-8000-0000000000ff", "precio_hora": 300}]')$$)
    = 'ninera_no_existe|d2000000-0000-4000-8000-0000000000ff');
select pg_temp.verificar('niñera sin app', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001', '[{"ninera_id": "d2000000-0000-4000-8000-000000000004", "precio_hora": 300}]')$$) = 'ninera_sin_app');
select pg_temp.verificar('niñera dada de baja', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001', '[{"ninera_id": "d2000000-0000-4000-8000-000000000005", "precio_hora": 300}]')$$) = 'ninera_inactiva');
select pg_temp.verificar('niñera que solo hace traslados', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001', '[{"ninera_id": "d2000000-0000-4000-8000-000000000003", "precio_hora": 300}]')$$) = 'ninera_solo_traslados');
select pg_temp.verificar('precio en cero', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001', '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 0}]')$$) = 'precio_invalido');
select pg_temp.verificar('envío mal armado', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001', '[{"ninera_id": "no-es-un-id", "precio_hora": 300}]')$$) = 'envio_invalido');
select pg_temp.verificar('niñera de práctica en un pedido real', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001', '[{"ninera_id": "d2000000-0000-4000-8000-000000000006", "precio_hora": 300}]')$$) = 'practica_mezclada');
select pg_temp.verificar('niñera real en un pedido de práctica', pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000006', '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 300}]')$$) = 'practica_mezclada');
select pg_temp.verificar('una niñera que falla no deja nada a medias (todo en una transacción)',
  pg_temp.error_de($$select public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001', '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 300}, {"ninera_id": "d2000000-0000-4000-8000-000000000004", "precio_hora": 300}]')$$) = 'ninera_sin_app'
  and not exists (select 1 from solicitud_ninieras where solicitud_id = 'd4000000-0000-4000-8000-000000000001'));

select pg_temp.verificar('manda a dos y devuelve 2',
  public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001',
    '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 300}, {"ninera_id": "d2000000-0000-4000-8000-000000000002", "precio_hora": 1250}]') = 2);
select pg_temp.verificar('mandar de nuevo a la misma no la repite',
  public.enviar_pedido_app('d4000000-0000-4000-8000-000000000001', '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 300}]') = 0);
select pg_temp.verificar('práctica con práctica, de nuevo: no la repite',
  public.enviar_pedido_app('d4000000-0000-4000-8000-000000000006', '[{"ninera_id": "d2000000-0000-4000-8000-000000000006", "precio_hora": 200}]') = 0);
select pg_temp.verificar('pedido de hoy sin fin',
  public.enviar_pedido_app('d4000000-0000-4000-8000-000000000002', '[{"ninera_id": "d2000000-0000-4000-8000-000000000001", "precio_hora": 300}]') = 1);
reset role;

select pg_temp.verificar('las filas quedan invitadas, por la app, con su precio y la hora de envío',
  (select count(*) = 2 and bool_and(estado = 'invitada' and origen = 'app' and enviado_en is not null)
     from solicitud_ninieras where solicitud_id = 'd4000000-0000-4000-8000-000000000001')
  and (select precio_hora = 1250 from solicitud_ninieras where solicitud_id = 'd4000000-0000-4000-8000-000000000001'
         and ninera_id = 'd2000000-0000-4000-8000-000000000002'));
select pg_temp.verificar('el pedido queda pendiente de confirmar, con 30 minutos para responder (otro día)',
  (select estado = 'pendiente_confirmar' and enviado_app_en is not null
          and responder_hasta between now() + interval '29 minutes' and now() + interval '31 minutes'
     from solicitudes where id = 'd4000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('pedido para hoy: 15 minutos',
  (select responder_hasta between now() + interval '14 minutes' and now() + interval '16 minutes'
     from solicitudes where id = 'd4000000-0000-4000-8000-000000000002'));
select pg_temp.verificar('un aviso por niñera, con el formato lista y sin la familia ni las notas',
  (select count(*) = 2 from avisos a join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':nuevo'
    where sn.solicitud_id = 'd4000000-0000-4000-8000-000000000001')
  and (select a.titulo = 'Sitting ' || to_char(public.hoy_mvd() + 1, 'DD/MM')
          -- Sin la marca de horario aproximado, sin "(aproximada, se puede extender)" (etapa 6, Diego 01/11/2026).
          and a.cuerpo = E'20:00 – 00:30 del día siguiente\nZona: Pocitos\n2 chicos (4 y 7 años)\nPrecio por hora: $1.250'
          and a.para_ninera_id = 'd2000000-0000-4000-8000-000000000002' and a.url = '#pedido/' || sn.id and a.tipo = 'pedido'
         from avisos a join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':nuevo'
        where sn.ninera_id = 'd2000000-0000-4000-8000-000000000002')
  and not exists (select 1 from avisos where cuerpo ilike '%Familia%' or cuerpo ilike '%maní%' or titulo ilike '%Familia Prueba%' and para_ninera_id is not null));
select pg_temp.verificar('sin hora de fin y con la zona del pedido',
  (select a.cuerpo = E'23:00, sin hora de fin\nZona: Punta Carretas\n2 chicos (4 y 7 años)\nPrecio por hora: $300'
     from avisos a join solicitud_ninieras sn on a.clave = 'pedido:' || sn.id || ':nuevo'
    where sn.solicitud_id = 'd4000000-0000-4000-8000-000000000002'));

-- ---------------------------------------------------------------------------
-- La niñera: lo que ve y cómo responde
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Ana ve sus dos pedidos, sin la familia',
  (select count(*) = 2 from public.ninera_mis_pedidos())
  and (select bool_and(estado = 'invitada' and chicos = '2 chicos (4 y 7 años)' and precio_hora = 300) from public.ninera_mis_pedidos()));
select pg_temp.verificar('ninera_mis_pedidos no tiene columnas de familia, dirección, notas ni cobro',
  not exists (select 1 from pg_proc p, unnest(p.proargnames) a
               where p.proname = 'ninera_mis_pedidos' and a ~ '(familia|madre|direccion|nota|cobro|pago)'));
select pg_temp.verificar('Ana no lee solicitudes ni solicitud_ninieras directo',
  (select count(*) = 0 from solicitudes) and (select count(*) = 0 from solicitud_ninieras));
select pg_temp.verificar('respuesta inválida', pg_temp.error_de($$select public.responder_pedido((select id from public.ninera_mis_pedidos() limit 1), 'tal_vez')$$) = 'respuesta_invalida');
select pg_temp.verificar('no puedo sin motivo', pg_temp.error_de($$select public.responder_pedido((select id from public.ninera_mis_pedidos() limit 1), 'no_puedo')$$) = 'motivo_invalido');
select pg_temp.verificar('motivo otro de más de 200', pg_temp.error_de($$select public.responder_pedido((select id from public.ninera_mis_pedidos() limit 1), 'no_puedo', 'otro', repeat('x', 201))$$) = 'motivo_largo');

-- Bruno no puede responder el de Ana (y no se dice si existe).
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
reset role;
create temp table sn_ana as
  select id from solicitud_ninieras where ninera_id = 'd2000000-0000-4000-8000-000000000001' and solicitud_id = 'd4000000-0000-4000-8000-000000000001';
grant select on sn_ana to authenticated;
set local role authenticated;
select pg_temp.verificar('Bruno no responde el pedido de Ana',
  pg_temp.error_de($$select public.responder_pedido((select id from sn_ana), 'acepto')$$) = 'no_existe');

set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Ana dice que puede', public.responder_pedido((select id from sn_ana), 'acepto') = 'ok');
select pg_temp.verificar('el segundo toque no responde dos veces', public.responder_pedido((select id from sn_ana), 'no_puedo', 'lejos') = 'ya_respondido');
select pg_temp.verificar('queda en "Esperando confirmación"',
  (select estado = 'acepto' and respondido_en is not null from public.ninera_mis_pedidos() where id = (select id from sn_ana)));
reset role;
select pg_temp.verificar('a las admins les llega "aceptó" con la familia y el link a la Agenda',
  (select para_admin = 'todas' and tipo = 'pedidos' and titulo = 'Ana Ficticia aceptó el pedido de Familia Prueba Uno'
          and url = '?ir=agenda&solicitud=d4000000-0000-4000-8000-000000000001'
     from avisos where clave = 'admin:pedido:' || (select id from sn_ana) || ':acepto'));

set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Bruno no puede, con otro motivo escrito',
  public.responder_pedido((select id from public.ninera_mis_pedidos() limit 1), 'no_puedo', 'otro', '  Tengo un cumpleaños  ') = 'ok');
reset role;
select pg_temp.verificar('el motivo queda guardado sin espacios y sin aviso a las admins',
  (select motivo_no = 'otro' and motivo_texto = 'Tengo un cumpleaños' and estado = 'no_puedo'
     from solicitud_ninieras where ninera_id = 'd2000000-0000-4000-8000-000000000002')
  and not exists (select 1 from avisos a join solicitud_ninieras sn on a.clave = 'admin:pedido:' || sn.id || ':acepto'
                   where sn.ninera_id = 'd2000000-0000-4000-8000-000000000002'));
set local role authenticated;
select pg_temp.verificar('un "No puedo" ya no aparece en sus pedidos', (select count(*) = 0 from public.ninera_mis_pedidos()));

-- Un pedido que se asigna o se cancela deja de verse y ya no se responde.
reset role;
update solicitudes set estado = 'confirmada' where id = 'd4000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('el pedido asignado no aparece',
  not exists (select 1 from public.ninera_mis_pedidos() p join pg_temp.sn_ana a on false) and (select count(*) = 1 from public.ninera_mis_pedidos()));
reset role;
create temp table sn_hoy as select id from solicitud_ninieras where solicitud_id = 'd4000000-0000-4000-8000-000000000002';
grant select on sn_hoy to authenticated;
set local role authenticated;
select pg_temp.verificar('responder un pedido ya asignado da cerrado', public.responder_pedido((select id from sn_hoy), 'acepto') = 'cerrado');

-- Días que no puede
select pg_temp.verificar('marca dos días', public.ninera_marcar_no_disponible(array[public.hoy_mvd() + 5, public.hoy_mvd() + 6]) = 2);
select pg_temp.verificar('marcarlos de nuevo no duplica', public.ninera_marcar_no_disponible(array[public.hoy_mvd() + 5]) = 0);
select pg_temp.verificar('ve los suyos', (select count(*) = 2 from ninera_no_disponible));
select pg_temp.verificar('día pasado', pg_temp.error_de($$select public.ninera_marcar_no_disponible(array[public.hoy_mvd() - 1])$$) = 'fecha_fuera_de_rango');
select pg_temp.verificar('a más de 90 días', pg_temp.error_de($$select public.ninera_marcar_no_disponible(array[public.hoy_mvd() + 91])$$) = 'fecha_fuera_de_rango');
select pg_temp.verificar('no escribe directo', pg_temp.error_de($$insert into ninera_no_disponible (ninera_id, fecha) values ('d2000000-0000-4000-8000-000000000001', current_date + 9)$$) is not null);
select pg_temp.verificar('desmarca uno', public.ninera_marcar_no_disponible(array[public.hoy_mvd() + 6], true) = 1);
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "email": "59899000002@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('Bruno no ve los días de Ana', (select count(*) = 0 from ninera_no_disponible));
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
select pg_temp.verificar('la admin no marca días como niñera', pg_temp.error_de($$select public.ninera_marcar_no_disponible(array[public.hoy_mvd() + 5])$$) = 'no_autorizada');
select pg_temp.verificar('la admin ve los días de todas', (select count(*) = 1 from ninera_no_disponible));
reset role;

-- ---------------------------------------------------------------------------
-- sugeridas_datos
-- ---------------------------------------------------------------------------
insert into sittings_traslados (tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin, cobro_familia, pago_ninera, estado) values
  ('sitting', 'd3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'd2000000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd() - 30, '10:00', '12:00', 1000, 500, 'confirmado'),
  ('sitting', 'd3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'd2000000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd() - 20, '10:00', '12:00', 1000, 500, 'confirmado'),
  -- registro viejo sin ids, con tildes distintas: cuenta para la misma familia por el nombre
  ('sitting', null, 'familia prueba uno', null, 'Dóra Sinapp', public.hoy_mvd() - 40, '10:00', '12:00', 1000, 500, 'confirmado'),
  ('sitting', 'd3000000-0000-4000-8000-000000000002', 'Familia Sin Chicos', 'd2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', public.hoy_mvd() - 10, '10:00', '12:00', 1000, 500, 'confirmado'),
  ('traslado', 'd3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'd2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', public.hoy_mvd() + 1, '10:00', null, 1000, 500, 'confirmado'),
  -- un día de un fijo ya cargado como previsto: cuenta para la semana, no para el total
  ('sitting', 'd3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'd2000000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd() + 1, '08:00', '10:00', 1000, 500, 'previsto');
update sittings_traslados set cancelado = true where ninera_nombre = 'Bruno Ejemplo' and tipo = 'sitting';
insert into incidentes (ninera_id, ninera_nombre, familia_id, familia_nombre, descripcion) values
  ('d2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', 'd3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'Incidente inventado');

set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
create temp table sd as select public.sugeridas_datos('d3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', public.hoy_mvd() + 1) as d;
select pg_temp.verificar('Ana: 2 con la familia, 2 en total (sin el previsto), 1 esa semana, edades de 4 y 7 años',
  (select (h->>'veces_familia')::int = 2 and (h->>'total')::int = 2 and (h->>'semana')::int = 1
          and h->'edades' @> '[4, 7]'::jsonb and (h->>'max_chicos')::int = 2
     from sd, jsonb_array_elements(d->'historial') h where h->>'ninera_id' = 'd2000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('Dora sin id: cuenta por el nombre normalizado, y la familia (con sus chicos) por el nombre',
  (select h->>'ninera_id' is null and (h->>'veces_familia')::int = 1 and h->'edades' @> '[4, 7]'::jsonb
          and (h->>'max_chicos')::int = 2
     from sd, jsonb_array_elements(d->'historial') h where h->>'ninera_clave' = 'dora sinapp'));
select pg_temp.verificar('Bruno: lo cancelado no cuenta y el traslado no suma sittings ni a la semana',
  (select (h->>'total')::int = 0 and (h->>'semana')::int = 0
     from sd, jsonb_array_elements(d->'historial') h where h->>'ninera_id' = 'd2000000-0000-4000-8000-000000000002'));
select pg_temp.verificar('Bruno: un "No puedo" seguido y un incidente con esa familia',
  (select (p->>'no_puedo_seguidos')::int = 1 and (p->>'incidente_familia')::boolean
     from sd, jsonb_array_elements(d->'por_ninera') p where p->>'ninera_id' = 'd2000000-0000-4000-8000-000000000002'));
select pg_temp.verificar('Ana: después de su "Puedo" no tiene "No puedo" seguidos ni incidentes',
  (select (p->>'no_puedo_seguidos')::int = 0 and not (p->>'incidente_familia')::boolean
     from sd, jsonb_array_elements(d->'por_ninera') p where p->>'ninera_id' = 'd2000000-0000-4000-8000-000000000001'));
select pg_temp.verificar('Ana: no disponible el día que marcó',
  (select (p->>'no_disponible')::boolean
     from jsonb_array_elements(public.sugeridas_datos('d3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', public.hoy_mvd() + 5)->'por_ninera') p
    where p->>'ninera_id' = 'd2000000-0000-4000-8000-000000000001'));
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('una niñera no saca nada de sugeridas_datos',
  (select d->'historial' = '[]'::jsonb and d->'por_ninera' = '[]'::jsonb
     from (select public.sugeridas_datos('d3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', public.hoy_mvd() + 1) as d) x));
reset role;

-- "No puedo" seguidos después de un "Puedo" que terminó asignado (revisión final, 02/11/2026): "Asignar"
-- pasa el "Puedo" a 'confirmada' y eso no tiene que borrarlo. Pía: tres "No puedo", después "Puedo" y
-- la asignan; Eva: un "No puedo" y después la asignan sin que haya respondido (no es un "Puedo").
insert into solicitud_ninieras (solicitud_id, ninera_id, ninera_nombre, estado, origen, precio_hora, enviado_en, respondido_en, motivo_no) values
  ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000006', 'Pía (practica)', 'no_puedo', 'app', 300, now() - interval '6 days', now() - interval '5 days', 'lejos'),
  ('d4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000006', 'Pía (practica)', 'no_puedo', 'app', 300, now() - interval '5 days', now() - interval '4 days', 'lejos'),
  ('d4000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000006', 'Pía (practica)', 'no_puedo', 'app', 300, now() - interval '4 days', now() - interval '3 days', 'tarde'),
  ('d4000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000006', 'Pía (practica)', 'confirmada', 'app', 300, now() - interval '3 days', now() - interval '2 days', null),
  ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000005', 'Eva Debaja', 'no_puedo', 'app', 300, now() - interval '4 days', now() - interval '3 days', 'lejos'),
  ('d4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000005', 'Eva Debaja', 'confirmada', 'app', 300, now() - interval '2 days', null, null);
-- Traslados (revisión final, 02/11/2026): Bruno tiene uno con Familia Prueba Uno (arriba); suma uno con
-- otra familia, uno cancelado y uno previsto (los dos últimos no cuentan).
insert into sittings_traslados (tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin, cobro_familia, pago_ninera, estado, cancelado) values
  ('traslado', 'd3000000-0000-4000-8000-000000000002', 'Familia Sin Chicos', 'd2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', public.hoy_mvd() - 3, '10:00', null, 1000, 500, 'confirmado', false),
  ('traslado', 'd3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'd2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', public.hoy_mvd() - 4, '10:00', null, 1000, 500, 'confirmado', true),
  ('traslado', 'd3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'd2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', public.hoy_mvd() + 3, '10:00', null, 1000, 500, 'previsto', false);
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-0000000000a1", "email": "admin.prueba@ejemplo.invalid"}';
create temp table sd2 as select public.sugeridas_datos('d3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', public.hoy_mvd() + 1) as d;
select pg_temp.verificar('Pía: los "No puedo" de antes de un "Puedo" que terminó asignado no cuentan',
  (select (p->>'no_puedo_seguidos')::int = 0
     from sd2, jsonb_array_elements(d->'por_ninera') p where p->>'ninera_id' = 'd2000000-0000-4000-8000-000000000006'));
select pg_temp.verificar('Eva: asignada sin responder no es un "Puedo": su "No puedo" sigue contando',
  (select (p->>'no_puedo_seguidos')::int = 1
     from sd2, jsonb_array_elements(d->'por_ninera') p where p->>'ninera_id' = 'd2000000-0000-4000-8000-000000000005'));
select pg_temp.verificar('Bruno: 1 traslado con la familia y 2 en total (sin cancelados ni previstos), y 0 sittings',
  (select (h->>'veces_familia_traslado')::int = 1 and (h->>'total_traslado')::int = 2
          and (h->>'veces_familia')::int = 0 and (h->>'total')::int = 0
     from sd2, jsonb_array_elements(d->'historial') h where h->>'ninera_id' = 'd2000000-0000-4000-8000-000000000002'));
select pg_temp.verificar('Ana: sus sittings no suman traslados',
  (select (h->>'veces_familia_traslado')::int = 0 and (h->>'total_traslado')::int = 0 and (h->>'total')::int = 2
     from sd2, jsonb_array_elements(d->'historial') h where h->>'ninera_id' = 'd2000000-0000-4000-8000-000000000001'));
reset role;

-- ---------------------------------------------------------------------------
-- Aviso "Pedido nuevo" al pasar un pedido de WhatsApp a la Agenda
-- ---------------------------------------------------------------------------
insert into pedidos_whatsapp (id, texto, creado_por, estado) values
  ('d5000000-0000-4000-8000-000000000001', 'Hola, ¿alguien para mañana? (inventado)', 'admin.prueba@ejemplo.invalid', 'borrador');
update pedidos_whatsapp set estado = 'confirmado', solicitud_id = 'd4000000-0000-4000-8000-000000000001'
 where id = 'd5000000-0000-4000-8000-000000000001';
select pg_temp.verificar('le llega a las otras admins, no a la que lo pegó',
  (select para_admin = 'todas' and datos->>'excepto' = 'admin.prueba@ejemplo.invalid' and tipo = 'pedidos'
          and titulo = 'Pedido nuevo de Familia Prueba Uno'
          and cuerpo = public.dia_corto_texto(public.hoy_mvd() + 1) || ', 20:00 a 00:30. Revisalo.'
     from avisos where clave = 'admin:pedido:d4000000-0000-4000-8000-000000000001:nuevo'));
update pedidos_whatsapp set notas = 'otra cosa' where id = 'd5000000-0000-4000-8000-000000000001';
select pg_temp.verificar('editar el pedido después no lo repite',
  (select count(*) = 1 from avisos where clave like 'admin:pedido:%:nuevo'));

rollback;
