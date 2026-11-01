-- ============================================================================
-- Datos para probar 20261102_pedidos_app_DESHACER.sql (revisión final, 02/11/2026). NO es una prueba
-- suelta: se pasa como --migracion entre la migración y el DESHACER, para que haya algo que respaldar
-- (una familia "No acepta nuevas", un pedido de WhatsApp con la niñera pedida, un "Puedo" por la app y
-- un día que la niñera no puede). Después corre 20261102_pedidos_app.sql de esta carpeta, que
-- verifica el respaldo. Comando y explicación ahí. Datos inventados.
-- ============================================================================
insert into ninieras (id, nombre, telefono) values
  ('e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001');
insert into familias (id, nombre, solo_conocidas) values
  ('e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', true),
  ('e3000000-0000-4000-8000-000000000002', 'Familia Prueba Dos', false);
insert into solicitudes (id, familia_id, familia_nombre, tipo, fecha, hora_inicio, estado, enviado_app_en) values
  ('e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'sitting',
   '2026-11-10', '20:00', 'pendiente_confirmar', '2026-11-02 10:00-03');
insert into solicitud_ninieras (solicitud_id, ninera_id, ninera_nombre, estado, origen, precio_hora, enviado_en, respondido_en) values
  ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Ana Ficticia', 'acepto', 'app', 300,
   '2026-11-02 10:00-03', '2026-11-02 10:05-03');
insert into ninera_no_disponible (ninera_id, fecha) values ('e2000000-0000-4000-8000-000000000001', '2026-11-12');
insert into pedidos_whatsapp (id, texto, creado_por, estado, ninera_pedida) values
  ('e5000000-0000-4000-8000-000000000001', 'Hola, ¿puede venir Ana? (inventado)', 'admin.prueba@ejemplo.invalid', 'borrador', 'Ana'),
  ('e5000000-0000-4000-8000-000000000002', 'Hola, ¿alguien para el martes? (inventado)', 'admin.prueba@ejemplo.invalid', 'borrador', null);
