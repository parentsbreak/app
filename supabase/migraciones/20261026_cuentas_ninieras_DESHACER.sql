-- Deshace 20261026_cuentas_ninieras.sql: borra la política push_propias, las funciones de las
-- cuentas de niñeras, la tabla de invitaciones (con los links que tenga), las columnas
-- ninieras.user_id / app_activada_en y push_subscriptions.user_id, y la fila 'ninieras_app' de
-- app_config. Las suscripciones push de las niñeras quedan sin user_id (respaldarlas antes si
-- importan). No toca auth.users: las cuentas que haya creado ninera-cuenta siguen existiendo,
-- pero sin ficha vinculada no ven nada (borrarlas a mano desde Authentication si hace falta).
-- La app de las admins sigue andando igual.
begin;
drop policy if exists push_propias on public.push_subscriptions;
drop function if exists public.crear_invitacion_ninera(uuid);
drop function if exists public.ninera_activar_app();
drop function if exists public.es_ninera();
drop function if exists public.ninera_actual();
drop function if exists public.mail_sintetico_ninera(text);
drop function if exists public.normalizar_celular(text);
drop table if exists public.ninera_invitaciones;
alter table public.push_subscriptions drop column if exists user_id;
alter table public.ninieras drop column if exists app_activada_en;
alter table public.ninieras drop column if exists user_id;
delete from public.app_config where id = 'ninieras_app';
commit;
