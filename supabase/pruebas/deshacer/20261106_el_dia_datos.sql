-- ============================================================================
-- Datos para probar 20261106_el_dia_DESHACER.sql (02/11/2026). NO es una prueba suelta: se pasa como
-- --migracion entre la migración y el DESHACER, para que haya eventos, un cierre con gasto (ya pasado a
-- gastos_extra por la admin) y avisos del día (enviados y pendientes, de la niñera y de las admins). Después
-- corre 20261106_el_dia.sql de esta carpeta, que verifica el respaldo. Comando y explicación ahí. Datos
-- inventados.
-- ============================================================================
insert into auth.users (id, email) values
  ('f1700000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid');
insert into ninieras (id, nombre, telefono, user_id) values
  ('f2700000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'f1700000-0000-4000-8000-000000000001');
insert into sittings_traslados (id, tipo, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin) values
  ('f5700000-0000-4000-8000-000000000001', 'sitting', 'Familia Prueba Uno', 'f2700000-0000-4000-8000-000000000001', 'Ana Ficticia', '2026-11-01', '16:00', '19:00');
insert into gastos_extra (id, sitting_id, concepto, monto, pagado_por, comprobante) values
  ('f6700000-0000-4000-8000-000000000001', 'f5700000-0000-4000-8000-000000000001', 'Taxi', 350, 'ninera',
   'ninieras/f2700000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000001.jpg');
insert into sitting_eventos (sitting_id, ninera_id, tipo, minutos, creado_en) values
  ('f5700000-0000-4000-8000-000000000001', 'f2700000-0000-4000-8000-000000000001', 'tarde', 10, '2026-11-01 15:50-03'),
  ('f5700000-0000-4000-8000-000000000001', 'f2700000-0000-4000-8000-000000000001', 'entre', null, '2026-11-01 16:08-03');
insert into sitting_cierres (sitting_id, ninera_id, hora_fin, comentarios, calificacion, volveria, gasto_monto, gasto_concepto,
                             gasto_comprobante, gasto_id, creado_en, revisado_en, revisado_por) values
  ('f5700000-0000-4000-8000-000000000001', 'f2700000-0000-4000-8000-000000000001', '19:20', 'Todo bien', 5, true, 350, 'Taxi',
   'ninieras/f2700000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000001.jpg',
   'f6700000-0000-4000-8000-000000000001', '2026-11-01 19:25-03', '2026-11-02 09:00-03', 'Admin Prueba');
insert into avisos (clave, para_ninera_id, para_admin, tipo, titulo, url, enviado_en) values
  ('sitting:f5700000-0000-4000-8000-000000000001:24h', 'f2700000-0000-4000-8000-000000000001', null, 'sitting', 'x', '#inicio', now()),
  ('sitting:f5700000-0000-4000-8000-000000000001:fin30', 'f2700000-0000-4000-8000-000000000001', null, 'sitting', 'x', '#sitting/x/cierre', null),
  ('sitting:f5700000-0000-4000-8000-000000000001:cambio:1', 'f2700000-0000-4000-8000-000000000001', null, 'sitting', 'x', '#inicio', null),
  ('admin:sitting:f5700000-0000-4000-8000-000000000001:tarde:10', null, 'todas', 'el_dia', 'x', '?ir=hoy', null),
  ('admin:sitting:f5700000-0000-4000-8000-000000000001:cerro', null, 'todas', 'cierres', 'x', '?ir=hoy', now()),
  ('chat:prueba', 'f2700000-0000-4000-8000-000000000001', null, 'chat', 'x', '#chat', null);
