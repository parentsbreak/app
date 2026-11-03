-- ============================================================================
-- Prueba de 20261111_guia_sitting.sql en un Postgres LOCAL (nunca en producción): las columnas de "Para este sitting"
-- en ninera_mis_sittings (docs/fase1/etapa12-guia-sitting.md), como niñera. edades_meses por mes calendario (dos chicos
-- nacidos el 1 y el último día del mismo mes dan lo mismo en 61 días seguidos de sittings: nunca se deduce el día),
-- edades_anios (la edad cargada a mano), necesidades (solo autismo, tdah y discapacidad, con textos tramposos; la
-- ficha de este sitting gana a la última de la familia), nada en un traslado y nada de tipo date. Datos inventados.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/fase1_guia_sitting.sql
-- Sobre el schema de main con la migración, y aplicar → deshacer → aplicar (tiene que quedar igual):
--   PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema <schema de main> \
--     --migracion supabase/migraciones/20261111_guia_sitting.sql \
--     --migracion supabase/migraciones/20261111_guia_sitting_DESHACER.sql \
--     --migracion supabase/migraciones/20261111_guia_sitting.sql supabase/pruebas/fase1_guia_sitting.sql
-- Todo termina en rollback.
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;
-- Meses por mes calendario, calculado aparte de la función (la regla escrita).
create function pg_temp.meses(p_sitting date, p_nac date) returns int language sql as $$
  select (extract(year from p_sitting)::int * 12 + extract(month from p_sitting)::int)
       - (extract(year from p_nac)::int * 12 + extract(month from p_nac)::int)
$$;

-- ---------------------------------------------------------------------------
-- La función: quién la puede llamar y qué devuelve
-- ---------------------------------------------------------------------------
select pg_temp.verificar('ninera_mis_sittings: authenticated sí, anon no',
  has_function_privilege('authenticated', 'public.ninera_mis_sittings()', 'execute')
  and not has_function_privilege('anon', 'public.ninera_mis_sittings()', 'execute'));
select pg_temp.verificar('las tres columnas nuevas, al final',
  (select r like '%precio_viaje numeric, edades_meses integer[], edades_anios integer[], necesidades text[])'
     from (select pg_get_function_result('public.ninera_mis_sittings'::regproc) as r) x));
select pg_temp.verificar('nada de tipo date salvo la fecha del sitting, ni la fecha de nacimiento ni la edad declarada',
  (select replace(r, 'fecha date', '') not like '%date%' and r not like '%nacimiento%' and r not like '%declarada%'
     from (select pg_get_function_result('public.ninera_mis_sittings'::regproc) as r) x));

-- ---------------------------------------------------------------------------
-- Datos inventados: Ana (niñera con cuenta), Bruno (otra niñera), familias con hijos y fichas
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e1000000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid'),
  ('e1000000-0000-4000-8000-000000000002', '59899000002@ninieras.parentsbreak.invalid');
insert into ninieras (id, nombre, telefono, user_id, tipo) values
  ('e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'e1000000-0000-4000-8000-000000000001', 'Ambas'),
  ('e2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', 'e1000000-0000-4000-8000-000000000002', 'Ambas');
insert into familias (id, nombre, zona, cobro_hora, pago_hora)
  select ('e3000000-0000-4000-8000-00000000000' || n)::uuid, 'Familia Prueba ' || n, 'Pocitos', 300, 200
    from generate_series(1, 9) n;
-- Familia 1: nacidos el 1 y el último día del mismo mes (hace 2 años), uno sin fecha con 4 años declarados hace
-- un año (5), uno con la fecha mal cargada en el futuro (no va), un bebé nacido este mes y uno sin nada.
insert into hijos_familia (familia_id, nombre, fecha_nacimiento, edad_declarada, edad_declarada_en, orden) values
  ('e3000000-0000-4000-8000-000000000001', 'Primero Ficticio', date_trunc('month', public.hoy_mvd() - interval '2 years')::date, null, null, 0),
  ('e3000000-0000-4000-8000-000000000001', 'Ultimo Ficticio', (date_trunc('month', public.hoy_mvd() - interval '2 years') + interval '1 month - 1 day')::date, null, null, 1),
  ('e3000000-0000-4000-8000-000000000001', 'Declarado Ficticio', null, 4, (public.hoy_mvd() - interval '1 year')::date, 2),
  ('e3000000-0000-4000-8000-000000000001', 'Futuro Ficticio', public.hoy_mvd() + 400, null, null, 3),
  ('e3000000-0000-4000-8000-000000000001', 'Bebe Ficticio', date_trunc('month', public.hoy_mvd())::date, null, null, 4),
  ('e3000000-0000-4000-8000-000000000001', 'Sin Nada', null, null, null, 5);
-- 61 sittings seguidos de Ana con la Familia 1 (hoy a hoy + 60), y un traslado mañana.
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin,
                                cobro_familia, pago_ninera, estado, cancelado)
  select ('e5000000-0000-4000-8000-' || lpad(d::text, 12, '0'))::uuid, 'sitting', 'e3000000-0000-4000-8000-000000000001',
         'Familia Prueba 1', 'e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd() + d, '10:00', '12:00',
         600, 400, case when d > 10 then 'previsto' else 'confirmado' end, false
    from generate_series(0, 60) d;
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin,
                                origen, destino, cobro_familia, pago_ninera, estado, cancelado) values
  ('e5100000-0000-4000-8000-000000000001', 'traslado', 'e3000000-0000-4000-8000-000000000001', 'Familia Prueba 1',
   'e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd() + 1, '17:00', '17:30', 'A', 'B', 500, 300, 'confirmado', false);
-- Un sitting de Ana por familia de las fichas (mañana), uno más de la Familia 2 pasado mañana y uno de Bruno.
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin,
                                cobro_familia, pago_ninera, estado, cancelado)
  select ('e5200000-0000-4000-8000-00000000000' || n)::uuid, 'sitting', ('e3000000-0000-4000-8000-00000000000' || n)::uuid,
         'Familia Prueba ' || n, 'e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd() + 1, '18:00', '20:00',
         600, 400, 'confirmado', false
    from generate_series(2, 9) n;
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin,
                                cobro_familia, pago_ninera, estado, cancelado) values
  ('e5300000-0000-4000-8000-000000000001', 'sitting', 'e3000000-0000-4000-8000-000000000002', 'Familia Prueba 2',
   'e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', public.hoy_mvd() + 2, '18:00', '20:00', 600, 400, 'confirmado', false),
  ('e5300000-0000-4000-8000-000000000002', 'sitting', 'e3000000-0000-4000-8000-000000000003', 'Familia Prueba 3',
   'e2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', public.hoy_mvd() + 1, '18:00', '20:00', 600, 400, 'confirmado', false);
-- Las fichas ("salud"). Familia 2: la de su sitting de mañana dice TEA (vieja) y una más nueva de otro sitting no dice
-- nada: mañana gana la suya; pasado mañana, la última.
insert into fichas_familia (familia_id, sitting_id, ninera_id, datos, actualizada_en) values
  ('e3000000-0000-4000-8000-000000000002', 'e5200000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001',
   '{"salud": "Tiene TEA, se calma con música"}', now() - interval '10 days'),
  ('e3000000-0000-4000-8000-000000000002', null, 'e2000000-0000-4000-8000-000000000002',
   '{"salud": "Nada para destacar"}', now() - interval '1 day'),
  ('e3000000-0000-4000-8000-000000000003', null, 'e2000000-0000-4000-8000-000000000002',
   '{"salud": "TDAH leve; también Síndrome de Down"}', now()),
  ('e3000000-0000-4000-8000-000000000004', null, 'e2000000-0000-4000-8000-000000000002',
   '{"salud": "AUTISTA, DÉFICIT DE ATENCIÓN y usa silla de ruedas"}', now()),
  ('e3000000-0000-4000-8000-000000000005', null, 'e2000000-0000-4000-8000-000000000002',
   '{"salud": "Le encanta el teatro y el té con leche"}', now()),
  ('e3000000-0000-4000-8000-000000000006', null, 'e2000000-0000-4000-8000-000000000002',
   '{"salud": "<script>alert(1)</script> Asperger''; drop table familias; -- hiperactividad, parálisis"}', now()),
  ('e3000000-0000-4000-8000-000000000007', null, 'e2000000-0000-4000-8000-000000000002', '{"salud": "   "}', now()),
  ('e3000000-0000-4000-8000-000000000008', null, 'e2000000-0000-4000-8000-000000000002', '{"alergias": "no tiene"}', now()),
  -- La Familia 1 también tiene una ficha que menciona discapacidad: el traslado igual va vacío.
  ('e3000000-0000-4000-8000-000000000001', null, 'e2000000-0000-4000-8000-000000000002', '{"salud": "discapacidad intelectual"}', now());
-- Familia 9: sin ficha.
-- Familia 10 (sin sittings): para chicos_texto, nacidos el 1 y el último día del mismo mes hace 3 años y un bebé de 2 meses.
insert into familias (id, nombre, zona, cobro_hora, pago_hora) values
  ('e3000000-0000-4000-8000-000000000010', 'Familia Prueba 10', 'Pocitos', 300, 200);
insert into hijos_familia (familia_id, nombre, fecha_nacimiento, orden) values
  ('e3000000-0000-4000-8000-000000000010', 'Primero Ficticio', date_trunc('month', public.hoy_mvd() - interval '3 years')::date, 0),
  ('e3000000-0000-4000-8000-000000000010', 'Ultimo Ficticio', (date_trunc('month', public.hoy_mvd() - interval '3 years') + interval '1 month - 1 day')::date, 1),
  ('e3000000-0000-4000-8000-000000000010', 'Bebe Ficticio', (date_trunc('month', public.hoy_mvd() - interval '2 months') + interval '1 month - 1 day')::date, 2);

-- ---------------------------------------------------------------------------
-- Sin ser niñera: nada
-- ---------------------------------------------------------------------------
select pg_temp.verificar('sin sesión de niñera: ninguna fila', (select count(*) = 0 from public.ninera_mis_sittings()));
-- chicos_texto por mes calendario: el del último día del mes ya cuenta los 3 años desde el 1.º del mes del cumpleaños (por día
-- daría 2 hasta ese día, y mirando cada día se sabría cuál es).
select pg_temp.verificar('chicos_texto: los nacidos el 1 y el último día del mismo mes dicen la misma edad',
  public.chicos_texto('e3000000-0000-4000-8000-000000000010') = '3 chicos (3 años, 3 años y menos de 1 año)');

-- ---------------------------------------------------------------------------
-- Desde la cuenta de Ana
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000001", "email": "59899000001@ninieras.parentsbreak.invalid"}';
select pg_temp.verificar('es Ana', public.ninera_actual() = 'e2000000-0000-4000-8000-000000000001');
select pg_temp.verificar('sus 61 + 1 + 8 + 1, nunca el de Bruno',
  (select count(*) = 71 and bool_and(id <> 'e5300000-0000-4000-8000-000000000002') from public.ninera_mis_sittings()));
select pg_temp.verificar('ninguna columna nueva es null',
  (select bool_and(edades_meses is not null and edades_anios is not null and necesidades is not null) from public.ninera_mis_sittings()));

-- Edades (Familia 1, 61 días seguidos).
select pg_temp.verificar('edades_meses: el del 1 y el del último día del mes dan lo mismo, por mes calendario; el bebé de este mes; sin la fecha futura',
  (select count(*) = 61
          and bool_and(cardinality(edades_meses) = 3
                       and edades_meses[1] = edades_meses[2]
                       and edades_meses[1] = pg_temp.meses(fecha, date_trunc('month', public.hoy_mvd() - interval '2 years')::date)
                       and edades_meses[3] = pg_temp.meses(fecha, date_trunc('month', public.hoy_mvd())::date))
     from public.ninera_mis_sittings() where id::text like 'e5000000-%'));
select pg_temp.verificar('edades_meses no cambia dentro de un mes: un solo valor por mes calendario',
  (select bool_and(n = 1) from (select count(distinct edades_meses) as n from public.ninera_mis_sittings()
                                  where id::text like 'e5000000-%' group by date_trunc('month', fecha)) x));
select pg_temp.verificar('edades_meses cambia justo el 1.º de cada mes (hay al menos un cambio en 61 días)',
  (select count(*) >= 1 and bool_and(extract(day from fecha) = 1)
     from (select fecha, edades_meses, lag(edades_meses) over (order by fecha) as antes
             from public.ninera_mis_sittings() where id::text like 'e5000000-%') x
    where antes is not null and antes is distinct from edades_meses));
select pg_temp.verificar('edades_anios: solo el declarado, 4 + 1 = 5',
  (select bool_and(edades_anios = array[5]) from public.ninera_mis_sittings() where id::text like 'e5000000-%'));
select pg_temp.verificar('el traslado: edades y necesidades vacías',
  (select edades_meses = '{}' and edades_anios = '{}' and necesidades = '{}'
     from public.ninera_mis_sittings() where id = 'e5100000-0000-4000-8000-000000000001'));
select pg_temp.verificar('familias sin hijos cargados: edades vacías',
  (select bool_and(edades_meses = '{}' and edades_anios = '{}') from public.ninera_mis_sittings() where id::text like 'e52%'));

-- Necesidades.
select pg_temp.verificar('necesidades: solo autismo, tdah y discapacidad, en ese orden y sin repetir',
  (select bool_and(necesidades <@ array['autismo', 'tdah', 'discapacidad']
                   and necesidades = array(select x from unnest(array['autismo', 'tdah', 'discapacidad']) x where x = any (necesidades)))
     from public.ninera_mis_sittings()));
select pg_temp.verificar('Familia 1: la ficha dice discapacidad en todos sus sittings',
  (select bool_and(necesidades = array['discapacidad']) from public.ninera_mis_sittings() where id::text like 'e5000000-%'));
select pg_temp.verificar('Familia 2 mañana: gana la ficha de su sitting ("TEA" → autismo)',
  (select necesidades = array['autismo'] from public.ninera_mis_sittings() where id = 'e5200000-0000-4000-8000-000000000002'));
select pg_temp.verificar('Familia 2 pasado mañana: la última de la familia (nada)',
  (select necesidades = '{}' from public.ninera_mis_sittings() where id = 'e5300000-0000-4000-8000-000000000001'));
select pg_temp.verificar('"TDAH leve; también Síndrome de Down" → tdah y discapacidad',
  (select necesidades = array['tdah', 'discapacidad'] from public.ninera_mis_sittings() where id = 'e5200000-0000-4000-8000-000000000003'));
select pg_temp.verificar('en mayúsculas y con tildes ("AUTISTA, DÉFICIT DE ATENCIÓN, silla de ruedas") → las tres',
  (select necesidades = array['autismo', 'tdah', 'discapacidad'] from public.ninera_mis_sittings() where id = 'e5200000-0000-4000-8000-000000000004'));
select pg_temp.verificar('"teatro" y "té" no son TEA',
  (select necesidades = '{}' from public.ninera_mis_sittings() where id = 'e5200000-0000-4000-8000-000000000005'));
select pg_temp.verificar('texto tramposo con Asperger, hiperactividad y parálisis → las tres, nada más',
  (select necesidades = array['autismo', 'tdah', 'discapacidad'] from public.ninera_mis_sittings() where id = 'e5200000-0000-4000-8000-000000000006'));
select pg_temp.verificar('"salud" con espacios, sin "salud" o sin ficha → vacío',
  (select bool_and(necesidades = '{}') from public.ninera_mis_sittings()
    where id in ('e5200000-0000-4000-8000-000000000007', 'e5200000-0000-4000-8000-000000000008', 'e5200000-0000-4000-8000-000000000009')));
select pg_temp.verificar('el texto de "salud" nunca sale: ninguna columna lo trae',
  (select bool_and(coalesce(chicos, '') not like '%Asperger%' and coalesce(notas_para_ninera, '') not like '%Asperger%')
     from public.ninera_mis_sittings()));

rollback;
