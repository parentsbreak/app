-- ============================================================================
-- Datos para probar 20261104_cv_automatico_DESHACER.sql (01/11/2026). NO es una prueba suelta: se
-- pasa como --migracion entre la migración y el DESHACER, para que haya líneas del CV que respaldar.
-- Después corre 20261104_cv_automatico.sql de esta carpeta, que verifica el respaldo. Comando y
-- explicación ahí. Datos inventados.
-- ============================================================================
insert into ninieras (id, nombre, cv_datos, cv_generado_con, cv_url, cv_generado_en) values
  ('f4000000-0000-4000-8000-000000000001', 'Ana Ficticia',
   '{"estudios": "Estudiante de Medicina", "panales": "Cambia pañales"}',
   '{"nombre": "Ana Ficticia", "foto": null, "lineas": ["Estudiante de Medicina", "Cambia pañales"]}',
   'https://ejemplo.invalid/cv-ana.png', '2026-11-01'),
  ('f4000000-0000-4000-8000-000000000002', 'Bruno Ejemplo', null, null, null, null);
