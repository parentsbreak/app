-- Deshace 20261104_cv_automatico.sql: saca cv_datos y cv_generado_con de ninieras.
--
-- Lo escrito no se pierde: antes de borrar, las filas con algo en esas columnas se copian a
-- respaldo_cv_automatico_20261104 (RLS sin políticas: solo se ve con la clave de servicio o desde el
-- SQL Editor). cv_url y cv_generado_en ya existían antes de la migración y quedan como están (los CV
-- generados siguen en ninieras-fotos y la ficha sigue mostrando "Ver CV").
begin;

do $$
begin
  if to_regclass('public.respaldo_cv_automatico_20261104') is null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ninieras' and column_name = 'cv_datos') then
    create table public.respaldo_cv_automatico_20261104 as
      select n.id, n.cv_datos, n.cv_generado_con, n.cv_url, n.cv_generado_en, now() as respaldado_en
        from public.ninieras n
       where n.cv_datos is not null or n.cv_generado_con is not null;
    alter table public.respaldo_cv_automatico_20261104 enable row level security;
  end if;
end $$;

alter table public.ninieras drop constraint if exists ninieras_cv_datos_objeto;
alter table public.ninieras drop constraint if exists ninieras_cv_generado_con_objeto;
alter table public.ninieras drop column if exists cv_datos;
alter table public.ninieras drop column if exists cv_generado_con;

commit;
