-- ============================================================================
-- Migración 29/10/2026 (fase 1, etapa 3): cola de avisos y chat entre cada niñera y las admins.
--
-- Avisos: una sola cola en la base (avisos) que manda push a niñeras y a admins y que cada etapa
-- siguiente usa para sus reglas (docs/fase1, decisiones 5.4 y 7). La clave es única: encolar dos
-- veces lo mismo no duplica (encolar_aviso devuelve si insertó). Lo manda la Edge Function
-- enviar-avisos, que reclama las filas con reclamar_avisos(): el reclamo es atómico (for update
-- skip locked), así el trigger de disparo inmediato y el cron de cada minuto nunca mandan dos
-- veces lo mismo. programar_avisos() es donde las etapas 4 a 10 suman sus reglas de tiempo; hoy no
-- programa nada.
--
-- Chat: un hilo por niñera que leen y contestan las tres admins (decisiones 6.8). Solo texto en
-- esta etapa (Diego, 29/10/2026). La niñera escribe solo con ninera_enviar_mensaje (no elige de,
-- autor ni ninera_id) y lee solo su hilo; las admins escriben con insert directo (de = 'admin', solo
-- a una niñera activa con la app) y solo pueden cambiar leido_admin_en. Cada mensaje encola su aviso: a la niñera "[admin] /
-- [mensaje]" y a las admins "[niñera] / [mensaje]", con el texto recortado a 120 y siempre, también
-- de noche (Diego, 29/10/2026). Ningún aviso lleva plata.
--
-- Suma:
--   - las tablas avisos y chat_mensajes, con RLS: la niñera lee solo lo suyo por
--     (select public.ninera_actual()); las admins, con (select public.es_usuaria_autorizada());
--   - encolar_aviso, reclamar_avisos, programar_avisos, admins_activas_mails, llamar_enviar_avisos
--     y correr_cron_avisos: internas, no las ejecuta authenticated ni anon (solo los triggers, el
--     cron y la clave de servicio);
--   - las de la niñera (en la lista permitida de catalogo_seguridad.sql): ninera_enviar_mensaje,
--     ninera_marcar_chat_leido y ninera_marcar_avisos_leidos;
--   - los triggers chat_mensajes_aviso (cada mensaje encola su aviso) y avisos_enviar_ya (una vez por
--     sentencia: si entró algún aviso para ya, llama enseguida a enviar-avisos);
--   - el cron enviar-avisos cada minuto (correr_cron_avisos) y las dos tablas en Realtime.
--
-- Compatible con la app publicada: todo es nuevo y no modifica filas existentes, no hace falta
-- respaldo. Se deshace con 20261029_avisos_chat_DESHACER.sql.
-- ============================================================================
begin;

-- La cola. Un aviso va a una niñera (para_ninera_id) o a las admins (para_admin: 'todas' o el mail
-- de una), nunca a las dos ni a ninguna. 'todas' es una sola fila: enviar-avisos la reparte entre
-- las cuentas activas al mandar, y lo leído por cada admin va en notificaciones_leidas (como la
-- campanita). enviado_en lo pone reclamar_avisos; si el envío falla, enviar-avisos lo vuelve a
-- dejar en null con un enviar_desde más tarde (hasta 3 intentos) y anota error.
create table public.avisos (
  id uuid default gen_random_uuid() not null,
  clave text not null,
  para_ninera_id uuid,
  para_admin text,
  tipo text not null,
  titulo text not null,
  cuerpo text,
  url text,
  datos jsonb default '{}'::jsonb not null,
  enviar_desde timestamp with time zone default now() not null,
  enviado_en timestamp with time zone,
  error text,
  intentos integer default 0 not null,
  leido_en timestamp with time zone,
  creado_en timestamp with time zone default now() not null,
  constraint avisos_pkey PRIMARY KEY (id),
  constraint avisos_clave_key UNIQUE (clave),
  constraint avisos_un_destinatario CHECK (((para_ninera_id IS NULL) <> (para_admin IS NULL))),
  constraint avisos_para_ninera_id_fkey FOREIGN KEY (para_ninera_id) REFERENCES public.ninieras(id) ON DELETE CASCADE
);
-- Lo pendiente (reclamar_avisos y el cron) y la lista de avisos de cada niñera.
CREATE INDEX idx_avisos_pendientes ON public.avisos USING btree (enviado_en, enviar_desde);
CREATE INDEX idx_avisos_ninera ON public.avisos USING btree (para_ninera_id, creado_en DESC);
-- Los avisos de las admins, los más nuevos primero: los lee la campanita todo el tiempo (30/10/2026).
CREATE INDEX idx_avisos_admins ON public.avisos USING btree (creado_en DESC) WHERE (para_admin IS NOT NULL);

-- El chat. El texto no puede quedar vacío (ni solo espacios o renglones en blanco) ni pasar de
-- 2.000 caracteres: lo frena la base también para el insert directo de las admins.
create table public.chat_mensajes (
  id uuid default gen_random_uuid() not null,
  ninera_id uuid not null,
  de text not null,
  autor text not null,
  texto text not null,
  creado_en timestamp with time zone default now() not null,
  leido_ninera_en timestamp with time zone,
  leido_admin_en timestamp with time zone,
  constraint chat_mensajes_pkey PRIMARY KEY (id),
  constraint chat_mensajes_de_check CHECK ((de = ANY (ARRAY['ninera'::text, 'admin'::text]))),
  constraint chat_mensajes_texto_check CHECK (((char_length(btrim(texto, E' \t\r\n')) >= 1) AND (char_length(btrim(texto, E' \t\r\n')) <= 2000))),
  constraint chat_mensajes_ninera_id_fkey FOREIGN KEY (ninera_id) REFERENCES public.ninieras(id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_mensajes_ninera ON public.chat_mensajes USING btree (ninera_id, creado_en);
-- Los mensajes de niñeras sin leer por las admins: los leen Hoy y la campanita todo el tiempo (30/10/2026).
CREATE INDEX idx_chat_mensajes_sin_leer_admin ON public.chat_mensajes USING btree (creado_en DESC)
  WHERE ((de = 'ninera'::text) AND (leido_admin_en IS NULL));

alter table public.avisos enable row level security;
alter table public.chat_mensajes enable row level security;

-- avisos: solo lectura desde la app. Lo escribe la base (triggers, programar_avisos) y lo marca
-- enviar-avisos con la clave de servicio; la niñera marca leído con ninera_marcar_avisos_leidos.
create policy avisos_ninera_leer on public.avisos as permissive for select to authenticated
  using ((para_ninera_id = ( SELECT public.ninera_actual() AS ninera_actual)));
create policy avisos_admins_leer on public.avisos as permissive for select to public
  using (((para_admin IS NOT NULL) AND ( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada)));

-- chat_mensajes: la niñera solo lee su hilo (escribe y marca leído por sus funciones). Las admins
-- leen todo, escriben solo como admin y marcan leido_admin_en (también en los de la niñera). Nadie
-- borra. Una admin le escribe a cualquier niñera activa que tenga la app (Diego, 29/10/2026): a una
-- sin cuenta el mensaje no le llegaría nunca.
create policy chat_ninera_leer on public.chat_mensajes as permissive for select to authenticated
  using ((ninera_id = ( SELECT public.ninera_actual() AS ninera_actual)));
create policy chat_admins_leer on public.chat_mensajes as permissive for select to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy chat_admins_marcar on public.chat_mensajes as permissive for update to public
  using (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada))
  with check (( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada));
create policy chat_admins_escribir on public.chat_mensajes as permissive for insert to public
  with check ((( SELECT public.es_usuaria_autorizada() AS es_usuaria_autorizada) AND (de = 'admin'::text)
    AND (EXISTS ( SELECT 1 FROM public.ninieras n
                   WHERE ((n.id = chat_mensajes.ninera_id) AND n.activa AND (n.user_id IS NOT NULL))))));
-- Desde la app, un mensaje nuevo trae solo ninera_id, de, autor y texto (id, creado_en y lo leído
-- salen de la base), y lo único que se actualiza después es leido_admin_en: así nadie cambia el
-- texto, el autor ni lo leído por la niñera (las políticas solas no lo frenan).
revoke insert, update on public.chat_mensajes from anon, authenticated;
grant insert (ninera_id, de, autor, texto) on public.chat_mensajes to authenticated;
grant update (leido_admin_en) on public.chat_mensajes to authenticated;

-- Encola un aviso; si la clave ya está no hace nada (devuelve false). Es la única forma de
-- escribir en avisos fuera de la clave de servicio: la usan los triggers y programar_avisos.
create or replace function public.encolar_aviso(p_clave text, p_para_ninera uuid, p_para_admin text, p_tipo text,
  p_titulo text, p_cuerpo text, p_url text, p_datos jsonb default '{}'::jsonb,
  p_enviar_desde timestamp with time zone default now())
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  insert into public.avisos (clave, para_ninera_id, para_admin, tipo, titulo, cuerpo, url, datos, enviar_desde)
  values (p_clave, p_para_ninera, p_para_admin, p_tipo, p_titulo, p_cuerpo, p_url,
          coalesce(p_datos, '{}'::jsonb), coalesce(p_enviar_desde, now()))
  on conflict (clave) do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end
$function$;
revoke execute on function public.encolar_aviso(text, uuid, text, text, text, text, text, jsonb, timestamp with time zone) from public, anon, authenticated;

-- Reclama hasta p_max avisos pendientes (los más viejos primero) y los marca como enviados en el
-- mismo update. "for update skip locked": si el trigger y el cron llaman a la vez a enviar-avisos,
-- cada fila la devuelve uno solo. Solo la clave de servicio (enviar-avisos).
create or replace function public.reclamar_avisos(p_max integer default 50)
returns setof public.avisos
language sql
volatile
security definer
set search_path to 'public'
as $function$
  update public.avisos a
     set enviado_en = now(), intentos = a.intentos + 1
   where a.id in (select p.id from public.avisos p
                   where p.enviado_en is null and p.enviar_desde <= now()
                   order by p.enviar_desde
                   limit coalesce(p_max, 50)
                   for update skip locked)
  returning a.*
$function$;
revoke execute on function public.reclamar_avisos(integer) from public, anon, authenticated;
grant execute on function public.reclamar_avisos(integer) to service_role;

-- Las reglas de tiempo de los avisos (decisiones 5.4 y 7). La corre el cron cada minuto, antes de
-- llamar a enviar-avisos. Cada regla es una función programar_avisos_<regla>() que encola con
-- encolar_aviso (idempotente por clave, recalculada del estado actual: si el sitting se canceló o
-- cambió de hora antes de que toque, no se manda) y devuelve cuántos encoló; acá se suman. En esta
-- etapa no hay ninguna; las etapas 4 a 10 agregan las suyas, por ejemplo:
--   v_total := v_total + public.programar_avisos_pedidos();    -- etapa 6
--   v_total := v_total + public.programar_avisos_el_dia();     -- etapa 7
create or replace function public.programar_avisos()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_total integer := 0;
begin
  return v_total;
end
$function$;
revoke execute on function public.programar_avisos() from public, anon, authenticated;
grant execute on function public.programar_avisos() to service_role;

-- Los mails de las admins activas: a quién reparte enviar-avisos un aviso para 'todas'. Una admin
-- dada de baja (activa = false) no recibe push. Solo la clave de servicio.
create or replace function public.admins_activas_mails()
returns setof text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select u.email::text
    from auth.users u
    join public.usuarias_autorizadas ua on ua.user_id = u.id
   where ua.activa and u.email is not null
   order by 1
$function$;
revoke execute on function public.admins_activas_mails() from public, anon, authenticated;
grant execute on function public.admins_activas_mails() to service_role;

-- La niñera de la sesión le escribe al equipo. Guarda el texto sin espacios ni renglones en blanco
-- alrededor, de = 'ninera' y el nombre de su ficha como autor (no los elige ella). Devuelve la
-- fila, así la app la agrega al hilo y no la repite cuando llega por Realtime (mismo id).
create or replace function public.ninera_enviar_mensaje(p_texto text)
returns public.chat_mensajes
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_texto text := btrim(coalesce(p_texto, ''), E' \t\r\n');
  v_fila public.chat_mensajes;
begin
  if v_id is null then
    raise exception 'no_autorizada';
  end if;
  if v_texto = '' then
    raise exception 'mensaje_vacio';
  end if;
  if char_length(v_texto) > 2000 then
    raise exception 'mensaje_largo';
  end if;
  insert into public.chat_mensajes (ninera_id, de, autor, texto)
  select v_id, 'ninera', n.nombre, v_texto from public.ninieras n where n.id = v_id
  returning * into v_fila;
  return v_fila;
end
$function$;
revoke execute on function public.ninera_enviar_mensaje(text) from public, anon;
grant execute on function public.ninera_enviar_mensaje(text) to authenticated;

-- Marca leídos los mensajes del equipo en el hilo de la niñera de la sesión; devuelve cuántos. 0 si
-- no es niñera.
create or replace function public.ninera_marcar_chat_leido()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_n integer;
begin
  if v_id is null then
    return 0;
  end if;
  update public.chat_mensajes set leido_ninera_en = now()
   where ninera_id = v_id and de = 'admin' and leido_ninera_en is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;
revoke execute on function public.ninera_marcar_chat_leido() from public, anon;
grant execute on function public.ninera_marcar_chat_leido() to authenticated;

-- Marca leídos los avisos de la niñera de la sesión; devuelve cuántos. 0 si no es niñera.
create or replace function public.ninera_marcar_avisos_leidos()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := public.ninera_actual();
  v_n integer;
begin
  if v_id is null then
    return 0;
  end if;
  update public.avisos set leido_en = now()
   where para_ninera_id = v_id and leido_en is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;
revoke execute on function public.ninera_marcar_avisos_leidos() from public, anon;
grant execute on function public.ninera_marcar_avisos_leidos() to authenticated;

-- Cada mensaje encola su aviso (clave por mensaje: nunca dos veces). De una admin, a la niñera:
-- título el autor y "#chat" abre el hilo en su app. De la niñera, a 'todas': título su nombre de
-- la ficha y el link abre su ficha en el panel.
create or replace function public.chat_mensajes_encolar_aviso()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.de = 'admin' then
    perform public.encolar_aviso('chat:' || new.id, new.ninera_id, null, 'chat', new.autor,
      left(new.texto, 120), '#chat', jsonb_build_object('mensaje_id', new.id));
  else
    perform public.encolar_aviso('admin:chat:' || new.id, null, 'todas', 'chat',
      coalesce((select n.nombre from public.ninieras n where n.id = new.ninera_id), new.autor),
      left(new.texto, 120), '?ir=ninieras&ninera=' || new.ninera_id,
      jsonb_build_object('mensaje_id', new.id, 'ninera_id', new.ninera_id));
  end if;
  return null;
end
$function$;
revoke execute on function public.chat_mensajes_encolar_aviso() from public, anon, authenticated;
create trigger chat_mensajes_aviso after insert on public.chat_mensajes
  for each row execute function public.chat_mensajes_encolar_aviso();

-- Llama a enviar-avisos con la URL fija y la clave del cron de enviar-push-urgentes (app_secrets
-- 'cron_push_secret'). Si no está la clave o el post falla, no hace nada: los avisos quedan en la
-- cola y los manda el cron en el próximo minuto. Nunca frena a quien la llama (ni el mensaje del
-- chat que encoló el aviso). La usan el trigger avisos_enviar_ya y correr_cron_avisos.
create or replace function public.llamar_enviar_avisos()
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_secreto text;
begin
  select s.valor into v_secreto from public.app_secrets s where s.clave = 'cron_push_secret';
  if v_secreto is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://wvewzamdohrpfhpccvcz.supabase.co/functions/v1/enviar-avisos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb,
    -- pg_net corta a los 5 s por defecto; enviar-avisos tarda hasta su plazo total de un minuto
    -- (PLAZO_TOTAL_MS en envio.ts, 30/10/2026). Si no espera, la respuesta queda como timeout.
    timeout_milliseconds := 60000
  );
exception when others then
  raise warning 'llamar_enviar_avisos: no se pudo llamar a enviar-avisos (%); lo manda el cron', sqlerrm;
end
$function$;
revoke execute on function public.llamar_enviar_avisos() from public, anon, authenticated;

-- Un aviso para ya (chat, y en las etapas siguientes pedido nuevo, aceptó...) llama enseguida a
-- enviar-avisos, sin esperar al cron. Una vez por sentencia, no por fila (29/10/2026, revisión):
-- un pedido a varias niñeras o programar_avisos encolan muchos de una vez y una sola llamada los
-- reclama todos. Si la sentencia no insertó ninguno para ya (solo para más tarde, o "on conflict do
-- nothing" que no insertó nada), no llama.
create or replace function public.avisos_disparar_envio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (select 1 from nuevos where nuevos.enviar_desde <= now()) then
    perform public.llamar_enviar_avisos();
  end if;
  return null;
end
$function$;
revoke execute on function public.avisos_disparar_envio() from public, anon, authenticated;
create trigger avisos_enviar_ya after insert on public.avisos
  referencing new table as nuevos
  for each statement execute function public.avisos_disparar_envio();

-- Lo que corre el cron cada minuto: programa los avisos que tocan y, si hay alguno pendiente, llama
-- a enviar-avisos. Sin pendientes no la llama: así no son 1.440 llamadas por día que no hacen nada.
-- En una función (y no en el texto del cron) para poder probarla.
create or replace function public.correr_cron_avisos()
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
begin
  perform public.programar_avisos();
  if exists (select 1 from public.avisos a where a.enviado_en is null and a.enviar_desde <= now()) then
    perform public.llamar_enviar_avisos();
  end if;
end
$function$;
revoke execute on function public.correr_cron_avisos() from public, anon, authenticated;
grant execute on function public.correr_cron_avisos() to service_role;

-- Cada minuto (enviar-push-urgentes corre cada 10; este va cada minuto para que los avisos programados
-- salgan a tiempo). Deja 1.440 filas por día en cron.job_run_details: ver Pendientes en CLAUDE.md.
-- En otro proyecto, cambiar la URL en llamar_enviar_avisos.
select cron.schedule('enviar-avisos', '* * * * *', $$select public.correr_cron_avisos();$$);

-- Realtime: el hilo y los avisos llegan solos a las dos puertas (la RLS filtra qué ve cada una).
alter publication supabase_realtime add table public.chat_mensajes, public.avisos;

commit;
