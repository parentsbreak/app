-- ============================================================================
-- Datos para probar 20261101_temporada_app_DESHACER.sql (01/11/2026). NO es una prueba suelta: se
-- pasa como --migracion entre la migración y el DESHACER, para que haya lugares que respaldar y
-- avisos de la temporada (uno enviado y uno pendiente). Después corre 20261101_temporada_app.sql de
-- esta carpeta, que verifica el respaldo. Comando y explicación ahí. Datos inventados.
-- ============================================================================
insert into auth.users (id, email) values
  ('f1000000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid');
insert into ninieras (id, nombre, telefono, user_id, temporada, temporada_fuente, temporada_actualizada_en,
                      temporada_lugares, temporada_lugares_en) values
  ('f2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'f1000000-0000-4000-8000-000000000001',
   '{"f6000000-0000-4000-8000-000000000003": [0, 1]}', 'app', '2026-10-20 10:00-03',
   '{"0": "punta", "1": "punta", "5": {"otro": "Rocha"}}', '2026-10-20 10:00-03'),
  ('f2000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', '099000002', null, null, null, null, null, null);
insert into avisos (clave, para_ninera_id, tipo, titulo, url, enviado_en) values
  ('temporada:2026:f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'temporada', 'x', '#temporada', now()),
  ('temporada:2026:f2000000-0000-4000-8000-000000000001:q1', 'f2000000-0000-4000-8000-000000000001', 'temporada', 'x', '#temporada', null),
  ('chat:prueba', 'f2000000-0000-4000-8000-000000000001', 'chat', 'x', '#chat', null);
