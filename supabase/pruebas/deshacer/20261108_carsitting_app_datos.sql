-- ============================================================================
-- Datos para probar 20261108_carsitting_app_DESHACER.sql (02/11/2026). NO es una prueba suelta: se pasa como
-- --migracion entre la migración y el DESHACER, para que haya un carsitting de la app aprobado, uno del formulario de
-- Google y avisos de esta etapa (enviados y pendientes) y de otras. Después corre 20261108_carsitting_app.sql de esta
-- carpeta, que verifica el respaldo. Comando y explicación ahí. Datos inventados.
-- ============================================================================
insert into ninieras (id, nombre, telefono, tipo) values
  ('f2900000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'Traslados'),
  ('f2900000-0000-4000-8000-000000000002', 'Carla Inventada', '099000002', 'Ambas');
insert into carsitting_datos (ninera_id, ninera_nombre, nombre_completo, modelo_auto, fotos, enviado_en, revision, aprobado_en, aprobado_por, aprobado_datos) values
  ('f2900000-0000-4000-8000-000000000001', 'Ana Ficticia', 'Ana Ficticia Prueba', 'Auto Inventado',
   '{"asientos": "carsitting/f2900000-0000-4000-8000-000000000001/asientos_0a1b2c3d.jpg"}', '2026-11-02 12:00-03', 'pendiente',
   '2026-11-01 12:00-03', 'Paula Prueba', '{"modelo_auto": "Auto Viejo"}');
insert into carsitting_datos (ninera_id, ninera_nombre, nombre_completo, modelo_auto) values
  ('f2900000-0000-4000-8000-000000000002', 'Carla Inventada', 'Carla Inventada', 'Del formulario');
insert into avisos (clave, para_ninera_id, para_admin, tipo, titulo, url, enviado_en) values
  ('carsitting:f2900000-0000-4000-8000-000000000001:aprobado:1', 'f2900000-0000-4000-8000-000000000001', null, 'carsitting', 'x', '#carsitting', now()),
  ('carsitting:f2900000-0000-4000-8000-000000000002:completar', 'f2900000-0000-4000-8000-000000000002', null, 'carsitting', 'x', '#carsitting', null),
  ('admin:carsitting:f2900000-0000-4000-8000-000000000001:1', null, 'todas', 'carsitting', 'x', '?ir=hoy', null),
  ('guia:f2900000-0000-4000-8000-000000000002:falta', 'f2900000-0000-4000-8000-000000000002', null, 'guia', 'x', '#guia', null);
