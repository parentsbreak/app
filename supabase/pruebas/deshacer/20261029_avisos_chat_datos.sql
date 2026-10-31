-- ============================================================================
-- Datos para probar 20261029_avisos_chat_DESHACER.sql (29/10/2026). NO es una prueba suelta: se
-- pasa como --migracion entre la migración y el DESHACER, para que haya mensajes que respaldar.
-- Después corre 20261029_avisos_chat.sql de esta carpeta, que verifica el respaldo. Comando y
-- explicación ahí. Datos inventados. Está en una subcarpeta para que no entre en
-- supabase/pruebas/*.sql.
-- ============================================================================
insert into auth.users (id, email) values
  ('f1000000-0000-4000-8000-000000000001', '59899000001@ninieras.parentsbreak.invalid');
insert into ninieras (id, nombre, telefono, user_id) values
  ('f2000000-0000-4000-8000-000000000001', 'Ana Ficticia', '099000001', 'f1000000-0000-4000-8000-000000000001');
insert into chat_mensajes (id, ninera_id, de, autor, texto) values
  ('f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'admin', 'Paula Prueba', 'Hola Ana'),
  ('f3000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'ninera', 'Ana Ficticia', 'Hola equipo'),
  ('f3000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000001', 'admin', 'Dora Prueba', '<b>sin</b> perder nada');
update chat_mensajes set leido_ninera_en = '2026-10-29 10:00-03' where id = 'f3000000-0000-4000-8000-000000000001';
