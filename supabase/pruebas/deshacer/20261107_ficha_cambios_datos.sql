-- ============================================================================
-- Datos para probar 20261107_ficha_cambios_DESHACER.sql (02/11/2026). NO es una prueba suelta: se pasa como
-- --migracion entre la migración y el DESHACER, para que haya una ficha, un cambio de horario respondido y avisos de
-- esta etapa (enviados y pendientes, de un día y de un fijo) y de otras. Después corre 20261107_ficha_cambios.sql de
-- esta carpeta, que verifica el respaldo. Comando y explicación ahí. Datos inventados.
-- ============================================================================
insert into ninieras (id, nombre, telefono) values ('f2800000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001');
insert into familias (id, nombre, zona) values ('f3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'Pocitos');
insert into sittings_traslados (id, tipo, familia_id, familia_nombre, ninera_id, ninera_nombre, fecha, hora_inicio, hora_fin, cancelado, cobro_familia, pago_ninera, notas) values
  ('f5800000-0000-4000-8000-000000000001', 'sitting', 'f3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'f2800000-0000-4000-8000-000000000001', 'Ana Ficticia', '2020-11-01', '16:00', '19:00', true, 0, 0, 'Pedido cancelado');
insert into fichas_familia (familia_id, sitting_id, ninera_id, datos, creada_en) values
  ('f3800000-0000-4000-8000-000000000001', 'f5800000-0000-4000-8000-000000000001', 'f2800000-0000-4000-8000-000000000001', '{"alergias": "maní"}', '2026-11-01 18:00-03');
insert into cambios_horario (ninera_id, familia_id, familia_nombre, sitting_id, desde, hora_inicio, hora_fin, respuesta, respondido_en) values
  ('f2800000-0000-4000-8000-000000000001', 'f3800000-0000-4000-8000-000000000001', 'Familia Prueba Uno', 'f5800000-0000-4000-8000-000000000001', '2020-11-01', '17:00', '20:00', false, '2026-11-01 12:00-03');
insert into avisos (clave, para_ninera_id, para_admin, tipo, titulo, url, enviado_en) values
  ('sitting:f5800000-0000-4000-8000-000000000001:cancelado:1', 'f2800000-0000-4000-8000-000000000001', null, 'sitting', 'x', '#inicio', now()),
  ('sitting:f5800000-0000-4000-8000-000000000001:cambio:2020-11-01:1700-2000', 'f2800000-0000-4000-8000-000000000001', null, 'sitting', 'x', '#cambio/x', null),
  ('fijo:f3800000-0000-4000-8000-000000000001:f2800000-0000-4000-8000-000000000001:horario:9', 'f2800000-0000-4000-8000-000000000001', null, 'sitting', 'x', '#cambio/y', null),
  ('admin:cambio:x:no_puede', null, 'todas', 'el_dia', 'x', '?ir=agenda', null),
  ('sitting:f5800000-0000-4000-8000-000000000001:fin', 'f2800000-0000-4000-8000-000000000001', null, 'sitting', 'x', '#sitting/x/cierre', null),
  ('chat:prueba', 'f2800000-0000-4000-8000-000000000001', null, 'chat', 'x', '#chat', null);
