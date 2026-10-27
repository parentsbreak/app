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
    'ninera_actual()'                            -- solo lee: la ficha de la sesión, o null
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
