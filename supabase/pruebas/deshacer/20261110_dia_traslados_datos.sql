-- ============================================================================
-- Datos para probar 20261110_dia_traslados_DESHACER.sql (03/11/2026). NO es una prueba suelta: se pasa como
-- --migracion entre la migración y el DESHACER, para que haya un traslado con eventos ("Estoy saliendo", "Ya los
-- busqué", "Ya los dejé") y su cierre sin hora con gasto, y un sitting con su evento y su cierre (que no se tocan).
-- Después corre 20261110_dia_traslados.sql de esta carpeta, que verifica el respaldo. Comando y explicación ahí.
-- Datos inventados.
-- ============================================================================
insert into ninieras (id, nombre, telefono, tipo) values
  ('f2a00000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'Ambos');
insert into familias (id, nombre, zona) values ('f3a00000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'Pocitos');
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin, estado) values
  ('f5a00000-0000-4000-8000-000000000001', 'traslado', 'f3a00000-0000-4000-8000-000000000001', 'Familia Prueba Uno',
   'f2a00000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-10', '08:00', null, 'confirmado'),
  ('f5a00000-0000-4000-8000-000000000002', 'sitting', 'f3a00000-0000-4000-8000-000000000001', 'Familia Prueba Uno',
   'f2a00000-0000-4000-8000-000000000001', 'Ana Ficticia', '2030-01-10', '16:00', '19:00', 'confirmado');
insert into sitting_eventos (sitting_id, ninera_id, tipo) values
  ('f5a00000-0000-4000-8000-000000000001', 'f2a00000-0000-4000-8000-000000000001', 'saliendo'),
  ('f5a00000-0000-4000-8000-000000000001', 'f2a00000-0000-4000-8000-000000000001', 'busque'),
  ('f5a00000-0000-4000-8000-000000000001', 'f2a00000-0000-4000-8000-000000000001', 'deje'),
  ('f5a00000-0000-4000-8000-000000000002', 'f2a00000-0000-4000-8000-000000000001', 'entre');
insert into sitting_cierres (sitting_id, ninera_id, hora_fin, comentarios, gasto_monto, gasto_concepto, gasto_comprobante) values
  ('f5a00000-0000-4000-8000-000000000001', 'f2a00000-0000-4000-8000-000000000001', null, 'Mucho tránsito', 120, 'Peaje',
   'ninieras/f2a00000-0000-4000-8000-000000000001/f5a00000-0000-4000-8000-000000000001.jpg'),
  ('f5a00000-0000-4000-8000-000000000002', 'f2a00000-0000-4000-8000-000000000001', '19:00', null, null, null, null);
