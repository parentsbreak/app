-- ============================================================================
-- Migración 21/10/2026: borradores en la base (entrevista que se va escribiendo).
--
-- A Paulina y Delfina se les borró muchas veces la entrevista. Desde el 21/10/2026 la app guarda
-- un borrador en el dispositivo en cada cambio (localStorage). Esta tabla suma una copia en la
-- base, cada pocos segundos y al salir de cada campo: sirve si se pierde el dispositivo, se
-- borran los datos del navegador o se sigue la entrevista desde otro (de la compu al celular).
-- Una fila por usuaria y por formulario (clave 'entrevista:<id de la candidata>' o
-- 'entrevista:nueva'). Cada usuaria ve y escribe solo sus borradores, y solo si está
-- autorizada (es_usuaria_autorizada), como el resto de las tablas.
--
-- Compatible con la app publicada: es una tabla nueva que la app de hoy no usa (sin la tabla, la
-- app nueva sigue solo con el borrador del dispositivo). No modifica filas: no hace falta
-- respaldo. Se deshace con 20261021_borradores_DESHACER.sql.
-- ============================================================================
begin;

create table public.borradores (
  id uuid default gen_random_uuid() not null,
  usuaria uuid default auth.uid() not null,
  clave text not null,
  datos jsonb not null,
  actualizado_at timestamp with time zone default now() not null,
  constraint borradores_pkey PRIMARY KEY (id),
  constraint borradores_usuaria_clave_key UNIQUE (usuaria, clave),
  constraint borradores_clave_check CHECK ((char_length(clave) between 1 and 200)),
  -- Una entrevista entera pesa unos pocos KB: el tope frena un borrador roto que crece sin fin.
  constraint borradores_datos_check CHECK ((pg_column_size(datos) <= 500000))
);
alter table public.borradores add constraint borradores_usuaria_fkey FOREIGN KEY (usuaria) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.borradores enable row level security;
create policy borradores_propios on public.borradores as permissive for all to authenticated
  using ((select public.es_usuaria_autorizada()) and usuaria = (select auth.uid()))
  with check ((select public.es_usuaria_autorizada()) and usuaria = (select auth.uid()));

commit;
