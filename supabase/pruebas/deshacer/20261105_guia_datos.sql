-- ============================================================================
-- Datos para probar 20261105_guia_DESHACER.sql (02/11/2026). NO es una prueba suelta: se pasa como
-- --migracion entre la migración y el DESHACER, para que haya progreso, repasos, una firma, RCP y avisos
-- de la guía (uno enviado y uno pendiente). Después corre 20261105_guia.sql de esta carpeta, que verifica
-- el respaldo. Comando y explicación ahí. Datos inventados.
-- ============================================================================
insert into auth.users (id, email) values
  ('f1000000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid');
insert into ninieras (id, nombre, telefono, user_id, rcp_presencial, rcp_certificado_ruta) values
  ('f2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'f1000000-0000-4000-8000-000000000001',
   true, 'rcp/f2000000-0000-4000-8000-000000000001/certificado.jpg'),
  ('f2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', null, null, null);
insert into guia_progreso (ninera_id, leccion_id, version, leido_en) values
  ('f2000000-0000-4000-8000-000000000001', 'pr1', '2026.10', '2026-11-01 10:00-03'),
  ('f2000000-0000-4000-8000-000000000001', 'x1', '2026.10', '2026-11-01 10:05-03');
insert into guia_repasos (ninera_id, modulo_id, version, aprobado_en) values
  ('f2000000-0000-4000-8000-000000000001', 'protocolos', '2026.10', '2026-11-01 10:10-03');
insert into guia_firmas (ninera_id, version, nombre, firma_ruta, firmado_en) values
  ('f2000000-0000-4000-8000-000000000001', '2026.10', 'Ana Ficticia', 'firmas/f2000000-0000-4000-8000-000000000001/2026-11-01.png', '2026-11-01 10:20-03');
insert into avisos (clave, para_ninera_id, tipo, titulo, url, enviado_en) values
  ('guia:f2000000-0000-4000-8000-000000000001:falta', 'f2000000-0000-4000-8000-000000000001', 'guia', 'x', '#guia', now()),
  ('guia:f2000000-0000-4000-8000-000000000001:anual:2025-10-28', 'f2000000-0000-4000-8000-000000000001', 'guia', 'x', '#guia', null),
  ('chat:prueba', 'f2000000-0000-4000-8000-000000000001', 'chat', 'x', '#chat', null);
