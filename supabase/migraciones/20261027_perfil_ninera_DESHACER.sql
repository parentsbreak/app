-- Deshace 20261027_perfil_ninera.sql: borra las funciones del perfil y de los próximos sittings,
-- los ayudantes, las dos políticas y el bucket ninieras-privado, y las columnas
-- ninieras.perfil_app_en / perfil_actualizado_en / foto_propuesta_ruta / foto_propuesta_en. La app de las admins sigue
-- andando igual; la de niñeras, sin estas funciones (404 PGRST202), sigue sin la pantalla de
-- perfil ni la sección de sittings, y el panel sin el bloque de la foto.
--
-- El bucket solo se borra si está vacío: si tiene archivos (fotos propuestas que todavía no se
-- aprobaron), frena sin tocar nada y dice cuáles son, para que nadie pierda fotos. Se bajan o se
-- borran desde Storage en el panel de Supabase y después se vuelve a correr este archivo.
begin;

do $$
declare
  v_n integer;
  v_lista text;
begin
  select count(*), string_agg(o.name, ', ' order by o.name)
    into v_n, v_lista
    from storage.objects o where o.bucket_id = 'ninieras-privado';
  if v_n > 0 then
    raise exception 'El bucket ninieras-privado tiene % archivo(s): %. Bajalos o borralos desde Storage antes de deshacer. No se cambió nada.', v_n, v_lista;
  end if;
end $$;

drop policy if exists ninieras_privado_propio on storage.objects;
drop policy if exists ninieras_privado_admins on storage.objects;
-- Supabase frena los DELETE directos sobre las tablas de storage salvo con esta marca (solo vale
-- para esta transacción). El bucket ya está vacío: se comprobó arriba.
set local storage.allow_delete_query = 'true';
delete from storage.buckets where id = 'ninieras-privado';

drop function if exists public.ninera_mis_sittings();
drop function if exists public.ninera_guardar_perfil(text, text[], text[], text);
drop function if exists public.ninera_zonas_disponibles();
drop function if exists public.ninera_mi_perfil();
drop function if exists public.chicos_texto(uuid);
drop function if exists public.madre_nombre_inicial(text);
drop function if exists public.hoy_mvd();

alter table public.ninieras drop column if exists foto_propuesta_en;
alter table public.ninieras drop column if exists foto_propuesta_ruta;
alter table public.ninieras drop column if exists perfil_actualizado_en;
alter table public.ninieras drop column if exists perfil_app_en;
commit;
