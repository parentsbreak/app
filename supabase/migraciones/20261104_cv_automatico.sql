-- ============================================================================
-- Migración 01/11/2026: CV automático de la niñera (pendiente "CV automático en el sistema").
--
-- El CV se dejaba de armar a mano en Canva desde un chat: ahora lo dibuja la app sobre el fondo de
-- la plantilla (img/cv/fondo-cv.png), lo sube a ninieras-fotos y guarda el link en cv_url (columna
-- que ya existía y nunca se usó) y la fecha en cv_generado_en (también existía). Hacen falta dos
-- columnas nuevas en ninieras:
--   cv_datos         las líneas del CV que escribe una admin en "CV de [nombre]", una por clave:
--                    edad (solo si no hay fecha de nacimiento: con fecha se calcula sola al
--                    generar), estudios, experiencia, panales, idiomas, certificaciones y
--                    diferenciales. Línea vacía = no va. Null = nunca se guardó (la app precarga
--                    desde la ficha).
--   cv_generado_con  con qué se dibujó el último CV: { nombre, foto, lineas: [...] } (las líneas
--                    ya con la edad calculada). La app lo compara con lo de hoy para avisar que el
--                    CV quedó viejo (cambió el nombre, la foto, una línea o cumplió años).
-- Nunca van al CV ni a estas columnas teléfono, mail, zona, patologías ni nada de salud.
--
-- La fecha del nombre (20261104) es para que ordene después de 20261103_eleccion_pedidos; no
-- depende de ella.
--
-- Compatible con la app publicada: columnas nuevas y vacías que la app de hoy no lee. No toca
-- filas, así que no hace falta respaldo. Sin cambios de RLS ni de storage: las admins ya suben y
-- borran en ninieras-fotos, y la niñera no lee ninieras directo (sus funciones devuelven columnas
-- puntuales, ninguna de estas). Se puede correr dos veces. Se deshace con
-- 20261104_cv_automatico_DESHACER.sql.
-- ============================================================================
begin;

alter table public.ninieras add column if not exists cv_datos jsonb;
alter table public.ninieras add column if not exists cv_generado_con jsonb;

alter table public.ninieras drop constraint if exists ninieras_cv_datos_objeto;
alter table public.ninieras add constraint ninieras_cv_datos_objeto
  check (cv_datos is null or jsonb_typeof(cv_datos) = 'object');
alter table public.ninieras drop constraint if exists ninieras_cv_generado_con_objeto;
alter table public.ninieras add constraint ninieras_cv_generado_con_objeto
  check (cv_generado_con is null or jsonb_typeof(cv_generado_con) = 'object');

comment on column public.ninieras.cv_datos is
  'Líneas del CV que carga una admin (edad sin fecha de nacimiento, estudios, experiencia, panales, idiomas, certificaciones, diferenciales). Vacía = no va. Nunca teléfono, mail, zona ni salud.';
comment on column public.ninieras.cv_generado_con is
  'Nombre, foto y líneas con que se dibujó el último CV (cv_url): si difieren de los de hoy, el CV quedó viejo.';

commit;
