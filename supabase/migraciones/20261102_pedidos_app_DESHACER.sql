-- Deshace 20261102_pedidos_app.sql: se sacan las funciones, el trigger del aviso "Pedido nuevo", la
-- tabla ninera_no_disponible, la configuración 'pedidos_app' y las columnas nuevas.
--
-- Lo cargado no se pierde: antes de borrar, las filas de solicitud_ninieras mandadas por la app
-- (con su precio, respuesta y motivo), las columnas nuevas de solicitudes que tengan algo y los días
-- que marcaron las niñeras se copian a respaldo_pedidos_app_20261102_* (RLS sin políticas: solo se
-- ven con la clave de servicio o desde el SQL Editor). Las filas de la app quedan en
-- solicitud_ninieras como 'invitada' (un "Puedo" o "No puedo" vuelve a 'invitada' y se ve
-- "Pendiente" en la Agenda, como antes), así el check viejo de estados se puede volver a poner. Los
-- avisos de pedidos que todavía no salieron se borran (abrirían una pantalla que ya no está).
begin;

do $$
begin
  if to_regclass('public.respaldo_pedidos_app_20261102_sn') is null then
    create table public.respaldo_pedidos_app_20261102_sn as
      select sn.*, now() as respaldado_en from public.solicitud_ninieras sn where sn.origen = 'app';
    alter table public.respaldo_pedidos_app_20261102_sn enable row level security;
  end if;
  if to_regclass('public.respaldo_pedidos_app_20261102_sol') is null then
    create table public.respaldo_pedidos_app_20261102_sol as
      select s.id, s.ninera_pedida_id, s.notas_para_ninera, s.enviado_app_en, s.responder_hasta, now() as respaldado_en
        from public.solicitudes s
       where s.ninera_pedida_id is not null or s.notas_para_ninera is not null or s.enviado_app_en is not null;
    alter table public.respaldo_pedidos_app_20261102_sol enable row level security;
  end if;
  if to_regclass('public.respaldo_pedidos_app_20261102_dias') is null then
    create table public.respaldo_pedidos_app_20261102_dias as
      select d.*, now() as respaldado_en from public.ninera_no_disponible d;
    alter table public.respaldo_pedidos_app_20261102_dias enable row level security;
  end if;
end $$;

delete from public.avisos
 where enviado_en is null and (clave like 'pedido:%' or clave like 'admin:pedido:%');

drop trigger if exists pedidos_whatsapp_aviso_nuevo on public.pedidos_whatsapp;
drop function if exists public.pedidos_whatsapp_aviso_nuevo();
drop function if exists public.sugeridas_datos(uuid, text, date);
drop function if exists public.ninera_marcar_no_disponible(date[], boolean);
drop function if exists public.responder_pedido(uuid, text, text, text);
drop function if exists public.ninera_mis_pedidos();
drop function if exists public.enviar_pedido_app(uuid, jsonb);
drop function if exists public.dia_corto_texto(date);
drop function if exists public.normaliza_nombre(text);
drop function if exists public.pesos_texto(numeric);

delete from public.app_config where id = 'pedidos_app';
drop table if exists public.ninera_no_disponible;

alter table public.pedidos_whatsapp drop constraint if exists pedidos_whatsapp_ninera_pedida_check;
alter table public.pedidos_whatsapp drop column if exists ninera_pedida;
alter table public.familias drop column if exists solo_conocidas;

update public.solicitud_ninieras set estado = 'invitada' where estado in ('acepto', 'no_puedo');
alter table public.solicitud_ninieras drop constraint solicitud_ninieras_estado_check;
alter table public.solicitud_ninieras add constraint solicitud_ninieras_estado_check
  check (estado in ('invitada', 'confirmada', 'rechazada'));
drop index if exists public.solicitud_ninieras_app_unica;
drop index if exists public.solicitud_ninieras_ninera_estado;
alter table public.solicitud_ninieras
  drop constraint if exists solicitud_ninieras_origen_check,
  drop constraint if exists solicitud_ninieras_precio_hora_check,
  drop constraint if exists solicitud_ninieras_motivo_no_check,
  drop constraint if exists solicitud_ninieras_motivo_texto_check,
  drop column if exists origen,
  drop column if exists precio_hora,
  drop column if exists enviado_en,
  drop column if exists respondido_en,
  drop column if exists motivo_no,
  drop column if exists motivo_texto;

alter table public.solicitudes
  drop constraint if exists solicitudes_notas_para_ninera_check,
  drop column if exists ninera_pedida_id,
  drop column if exists notas_para_ninera,
  drop column if exists enviado_app_en,
  drop column if exists responder_hasta;

commit;
