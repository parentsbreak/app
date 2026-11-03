-- ============================================================================
-- Lista permitida de funciones security definer (26/10/2026, fase 1). En un Postgres LOCAL
-- (nunca en producción), sobre schema.sql o sobre el schema de main con las migraciones nuevas.
-- Uso: PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs supabase/pruebas/catalogo_seguridad.sql
--
-- Por qué: hasta las cuentas de niñeras, todo JWT "authenticated" era de una admin. Desde
-- 20261026_cuentas_ninieras.sql una niñera también entra como authenticated, y una función
-- security definer corre con los permisos de su dueña: se saltea la RLS. Si authenticated la
-- puede ejecutar, una niñera también, salvo que la función se frene sola.
--
-- Toda función security definer nueva que authenticated (o anon) pueda ejecutar se suma acá A
-- PROPÓSITO, con su guardia: de admin (es_usuaria_autorizada(), como generar_previstos_fijos y
-- crear_invitacion_ninera) o de niñera (filtra por ninera_actual(), como ninera_activar_app). Si
-- esta prueba falla por una función nueva, primero revisar su guardia; recién después sumarla.
-- ============================================================================
begin;

create function pg_temp.verificar(caso text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', caso; end if;
  raise notice 'ok: %', caso;
end $$;

-- Las security definer de public que un rol puede ejecutar, como "nombre(argumentos)".
create function pg_temp.definer_ejecutables(rol text) returns text[] language sql as $$
  select coalesce(array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by 1), '{}')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and has_function_privilege(rol, p.oid, 'execute')
$$;
-- Lo que sobra o falta respecto de la lista, para que el error diga qué función es.
create function pg_temp.diferencia(hay text[], lista text[]) returns text language sql as $$
  select 'sobran: ' || coalesce((select string_agg(x, ', ') from unnest(hay) x where x <> all (lista)), '-')
      || ' | faltan: ' || coalesce((select string_agg(x, ', ') from unnest(lista) x where x <> all (hay)), '-')
$$;

do $$
declare
  -- authenticated (admins y niñeras). Cada una con su guardia:
  lista_authenticated text[] := array[
    'crear_invitacion_ninera(p_ninera_id uuid)', -- admin: raise 'no_autorizada' si no es_usuaria_autorizada()
    'es_ninera()',                               -- solo lee: dice si la sesión es de una niñera
    'es_usuaria_autorizada()',                   -- solo lee: dice si la sesión es de una admin
    'generar_previstos_fijos(p_dias integer)',   -- admin o sin sesión (cron): raise 'no_autorizada'
    'ninera_activar_app()',                      -- niñera: solo su ficha (ninera_actual())
    'ninera_actual()',                           -- solo lee: la ficha de la sesión, o null
    -- Etapa 2 (27/10/2026): perfil y próximos sittings, todas por ninera_actual().
    'ninera_guardar_perfil(p_tipo text, p_zonas text[], p_cuenta text[], p_foto_ruta text)', -- niñera: raise 'no_autorizada' si ninera_actual() es null; solo su ficha
    'ninera_mi_perfil()',                        -- niñera: solo su fila; vacío si no es niñera
    'ninera_mis_sittings()',                     -- niñera: solo los suyos, sin plata; vacío si no es niñera
    'ninera_zonas_disponibles()',                -- niñera: zona_grupos; vacío si no es niñera
    -- Etapa 3 (29/10/2026): chat y avisos, todas por ninera_actual(). encolar_aviso,
    -- reclamar_avisos, programar_avisos, admins_activas_mails, llamar_enviar_avisos y
    -- correr_cron_avisos NO van: solo la base y la clave de servicio.
    'ninera_enviar_mensaje(p_texto text)',       -- niñera: raise 'no_autorizada' si ninera_actual() es null; escribe solo en su hilo, de y autor fijos
    'ninera_marcar_avisos_leidos()',             -- niñera: solo sus avisos; 0 si no es niñera
    'ninera_marcar_chat_leido()',                -- niñera: solo su hilo; 0 si no es niñera
    -- Etapa 9 (01/11/2026): la temporada, por ninera_actual(). programar_avisos_temporada NO va.
    'ninera_guardar_temporada(p_lugares jsonb)', -- niñera: raise 'no_autorizada' si ninera_actual() es null; solo su ficha
    'ninera_mi_temporada()',                     -- niñera: solo su fila; null si no es niñera
    -- Etapa 5 (02/11/2026): el pedido por la app. sugeridas_datos es invoker (no va);
    -- pedidos_whatsapp_aviso_nuevo NO va: solo el trigger.
    'enviar_pedido_app(p_solicitud_id uuid, p_envios jsonb)', -- admin: raise 'no_autorizada' si no es_usuaria_autorizada()
    'ninera_marcar_no_disponible(p_fechas date[], p_quitar boolean)', -- niñera: raise 'no_autorizada' si ninera_actual() es null; solo sus días
    'ninera_mis_pedidos()',                      -- niñera: solo los suyos, sin familia ni plata salvo su precio por hora; vacío si no es niñera
    'responder_pedido(p_sn_id uuid, p_respuesta text, p_motivo text, p_motivo_texto text)', -- niñera: raise 'no_autorizada' / 'no_existe' si no es suyo
    -- Etapa 6 (01/11/2026): elegir y avisar. Los triggers, pedido_puede_avisar y programar_avisos_pedidos NO van.
    'ninera_marcar_pedido_visto(p_sn_id uuid)',  -- niñera: raise 'no_autorizada' si ninera_actual() es null; solo sus filas
    -- Etapa 4 (02/11/2026): la guía. guia_estado (interna) y programar_avisos_guia NO van.
    'guia_estado_ninieras()',                    -- admin: raise 'no_autorizada' si no es_usuaria_autorizada()
    'ninera_puede_recibir_pedidos(p_ninera_id uuid)', -- admin, o la niñera solo sobre sí misma: raise 'no_autorizada'
    'ninera_estado_guia()',                      -- niñera: solo lo suyo; vacío si no es niñera
    'ninera_marcar_leida(p_leccion_id text, p_version text)', -- niñera: raise 'no_autorizada' si ninera_actual() es null; solo su progreso
    'ninera_aprobar_repaso(p_modulo_id text, p_version text)', -- niñera: ídem
    'ninera_firmar_guia(p_nombre text, p_version text)', -- niñera: ídem; la ruta de la firma la arma la base
    'ninera_guardar_rcp(p_presencial boolean, p_con_certificado boolean)', -- niñera: ídem; solo su ficha
    -- Etapa 7 (02/11/2026): el día y el cierre, por ninera_actual(). sitting_del_dia_ninera y
    -- programar_avisos_el_dia NO van.
    'ninera_mi_dia()',                           -- niñera: solo sus sittings de hoy y de ayer, sin plata; vacío si no es niñera
    'ninera_marcar_evento(p_sitting_id uuid, p_tipo text, p_minutos integer)', -- niñera: raise 'no_autorizada' si ninera_actual() es null; solo sus sittings
    'ninera_cerrar_sitting(p_sitting_id uuid, p_hora_fin time without time zone, p_dia_siguiente boolean, p_comentarios text, p_calificacion integer, p_volveria boolean, p_jugaron text, p_comentario_equipo text, p_gasto_monto numeric, p_gasto_concepto text)', -- niñera: ídem; la ruta del comprobante la arma la base
    'ninera_ruta_comprobante(p_nombre text)',    -- niñera: solo lee; true solo para su ruta de un sitting suyo abierto (la política del bucket)
    -- Etapa 8 (02/11/2026): la ficha y los cambios de horario, por ninera_actual(). Los avisos (sittings_avisos_cambios,
    -- aviso_sitting_ninera, avisar_cambios_previstos, sitting_puede_avisar) y ficha_familia_campos NO van.
    'ninera_guardar_ficha_familia(p_sitting_id uuid, p_datos jsonb)', -- niñera: raise 'no_autorizada' si ninera_actual() es null; solo su sitting del día
    'ninera_ficha_familia(p_sitting_id uuid)',   -- niñera: solo de su sitting, hasta que termina; sin datos de la niñera que la cargó
    'ninera_mis_cambios()',                      -- niñera: solo los suyos; vacío si no es niñera
    'ninera_responder_cambio(p_cambio_id uuid, p_ok boolean)', -- niñera: raise 'no_autorizada' si ninera_actual() es null; solo los suyos
    -- Etapa 10 (20261108_carsitting_app): el carsitting desde la app.
    'ninera_mi_carsitting()',                    -- niñera: solo lo suyo; null si no es niñera
    'ninera_guardar_carsitting(p_datos jsonb, p_fotos jsonb)' -- niñera: raise 'no_autorizada' si ninera_actual() es null; solo su fila y sus fotos
  ];
  -- anon (sin sesión): solo las que usan las políticas "to public" y devuelven false / null.
  lista_anon text[] := array['es_ninera()', 'es_usuaria_autorizada()', 'ninera_actual()'];
  hay text[];
begin
  hay := pg_temp.definer_ejecutables('authenticated');
  perform pg_temp.verificar('security definer ejecutables por authenticated: la lista permitida ('
    || pg_temp.diferencia(hay, lista_authenticated) || ')',
    hay @> lista_authenticated and hay <@ lista_authenticated);
  hay := pg_temp.definer_ejecutables('anon');
  perform pg_temp.verificar('security definer ejecutables por anon: la lista permitida ('
    || pg_temp.diferencia(hay, lista_anon) || ')',
    hay @> lista_anon and hay <@ lista_anon);
end $$;

-- Una security definer sin search_path fijo se puede engañar con una tabla o función del mismo
-- nombre en otro schema.
select pg_temp.verificar('toda security definer de public tiene search_path fijo',
  not exists (select 1 from pg_proc p
               where p.pronamespace = 'public'::regnamespace and p.prosecdef
                 and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')));

rollback;
