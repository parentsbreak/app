-- Deshace 20261026_cuentas_ninieras.sql: borra la política push_propias, las funciones de las
-- cuentas de niñeras, la tabla de invitaciones (con los links que tenga), las columnas
-- ninieras.user_id / app_activada_en y push_subscriptions.user_id, y la fila 'ninieras_app' de
-- app_config. No toca auth.users: las cuentas que haya creado ninera-cuenta siguen existiendo,
-- pero sin ficha vinculada no ven nada (borrarlas a mano desde Authentication si hace falta).
-- La app de las admins sigue andando igual.
--
-- Suscripciones push de las niñeras (las que tienen user_id): se copian a
-- respaldo_push_ninieras_20261026 (con RLS y sin políticas: no la ve la app) y se borran. Sin la
-- columna quedarían como filas de nadie que enviar-push-urgentes podría mandarles a las niñeras
-- como si fueran de una admin.
--
-- La guardia de admin de generar_previstos_fijos() (26/10/2026) se deja: sin cuentas de niñeras
-- no frena a nadie (las admins y el cron pasan igual), y volver al cuerpo viejo sería reabrir el
-- agujero si después se vuelve a aplicar solo una parte.
--
-- Orden para volver atrás:
--   1. Correr este DESHACER en el SQL Editor.
--   2. Volver a publicar enviar-push-urgentes V10 (la de antes de las cuentas de niñeras). La V11
--      lee push_subscriptions.user_id: solo puede quedar publicada si la columna vuelve a
--      existir (si se vuelve a aplicar la migración).
begin;
create table public.respaldo_push_ninieras_20261026 as
  select * from public.push_subscriptions where user_id is not null;
alter table public.respaldo_push_ninieras_20261026 enable row level security;
delete from public.push_subscriptions where user_id is not null;

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
