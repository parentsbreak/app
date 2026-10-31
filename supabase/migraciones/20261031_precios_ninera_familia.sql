-- ============================================================================
-- Migración 31/10/2026: precio por hora de cada niñera con cada familia.
--
-- Regla 2 de docs/fase1/reglas-del-negocio.md: lo que cobra la niñera cambia según la cantidad de
-- chicos, la antigüedad de la familia y si es fuera de Montevideo, y se guarda por niñera +
-- familia. Hasta hoy el único lugar era la tarifa de la familia (familias.pago_hora, una sola para
-- todas las niñeras) o un fijo, que pide días y hora. Las dueñas necesitan guardar "esta niñera con
-- esta familia cobra X por hora" sin días fijos.
--
-- Suma:
--   - precios_ninera_familia: una fila por par familia + niñera con el pago por hora. Sin cobro: la
--     familia paga siempre su tarifa (familias.cobro_hora), no cambia según la niñera (regla 2).
--     Es la tabla que la etapa 5 (pedidos por la app) ya tenía prevista con este nombre
--     (decisiones 4.18): la reutiliza tal cual.
--   - pago_hora_ninera(familia, niñera): el pago por hora de esa niñera con esa familia o, si no
--     hay fila, la tarifa de la familia. La misma regla que precioHoraNinera() en el panel.
--   - El historial de cambios va a finanzas_historial con el trigger de siempre (es plata).
--
-- Quién la ve: solo las admins (es_usuaria_autorizada). La niñera nunca lee esta tabla: en la etapa
-- 5 recibe su precio por hora dentro del pedido, por una función que filtra por ninera_actual().
-- pago_hora_ninera() es invoker: con la sesión de una niñera la RLS no le muestra nada y devuelve
-- null.
--
-- Compatible con la app publicada: tabla y función nuevas; el check de finanzas_historial solo
-- suma un valor permitido. No modifica filas existentes: no hace falta respaldo. Se deshace con
-- 20261031_precios_ninera_familia_DESHACER.sql.
-- ============================================================================
begin;

create table public.precios_ninera_familia (
  id uuid default gen_random_uuid() not null,
  familia_id uuid not null,
  ninera_id uuid not null,
  -- Lo que se le paga a esa niñera por hora con esa familia (el pago de un sitting = horas reales
  -- por esto, con redondearPago / redondear_pago, como hoy).
  pago_hora numeric not null,
  -- Por qué ese precio, si hace falta ("3 chicos", "Carrasco, fuera de su zona").
  nota text,
  creado_por text,
  creado_en timestamp with time zone default now() not null,
  -- Lo pone el trigger en cada cambio: el panel guarda con la condición del valor que vio al abrir
  -- (dos admins editando a la vez, CLAUDE.md).
  actualizado_en timestamp with time zone default now() not null,
  constraint precios_ninera_familia_pkey primary key (id),
  constraint precios_ninera_familia_par_key unique (familia_id, ninera_id),
  constraint precios_ninera_familia_pago_check check (pago_hora > 0 and pago_hora < 100000),
  constraint precios_ninera_familia_nota_check check (nota is null or char_length(nota) <= 200)
);
comment on table public.precios_ninera_familia is
  'Pago por hora de una niñera con una familia (regla 2). Manda sobre familias.pago_hora en los sittings puntuales; los fijos siguen con lo suyo. Solo admins.';

-- Un precio no sirve sin su familia o su niñera: se borra con ellas.
alter table public.precios_ninera_familia add constraint precios_ninera_familia_familia_id_fkey
  foreign key (familia_id) references public.familias(id) on delete cascade;
alter table public.precios_ninera_familia add constraint precios_ninera_familia_ninera_id_fkey
  foreign key (ninera_id) references public.ninieras(id) on delete cascade;
-- (familia_id, ninera_id) ya tiene índice por el unique; este es para la ficha de la niñera.
create index idx_precios_ninera_familia_ninera on public.precios_ninera_familia using btree (ninera_id);

alter table public.precios_ninera_familia enable row level security;
create policy solo_autorizadas_todo on public.precios_ninera_familia as permissive for all to public
  using ((select public.es_usuaria_autorizada())) with check ((select public.es_usuaria_autorizada()));

-- actualizado_en en cada cambio (no depende de que la app lo mande).
create or replace function public.precios_ninera_familia_tocar()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  new.actualizado_en := now();
  return new;
end;
$function$;
revoke execute on function public.precios_ninera_familia_tocar() from public, anon, authenticated;
create trigger precios_ninera_familia_tocar_trg
  before update on public.precios_ninera_familia
  for each row execute function public.precios_ninera_familia_tocar();

-- Historial: alta, cambio y baja, con quién, como los gastos y los saldos.
alter table public.finanzas_historial drop constraint finanzas_historial_tabla_check;
alter table public.finanzas_historial add constraint finanzas_historial_tabla_check
  check (tabla = any (array['gastos_generales'::text, 'ajustes_saldo'::text, 'gastos_extra'::text, 'precios_ninera_familia'::text]));
create trigger precios_ninera_familia_historial_trg
  after insert or update or delete on public.precios_ninera_familia
  for each row execute function public.registrar_historial_finanzas();

-- El pago por hora de una niñera con una familia: su fila o, si no hay, la tarifa de la familia.
-- Null si no hay ninguno de los dos (o si quien pregunta no las puede ver). La misma regla que
-- precioHoraNinera() en js/core.js: si cambia una, cambian las dos.
create or replace function public.pago_hora_ninera(p_familia_id uuid, p_ninera_id uuid)
 returns numeric
 language sql
 stable
 set search_path to 'public'
as $function$
  select coalesce(
    (select p.pago_hora from public.precios_ninera_familia p
      where p.familia_id = p_familia_id and p.ninera_id = p_ninera_id),
    (select nullif(f.pago_hora, 0) from public.familias f where f.id = p_familia_id)
  )
$function$;
revoke execute on function public.pago_hora_ninera(uuid, uuid) from public, anon;
grant execute on function public.pago_hora_ninera(uuid, uuid) to authenticated;

alter publication supabase_realtime add table public.precios_ninera_familia;

commit;
