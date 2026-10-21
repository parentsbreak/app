-- Deshace 20261021_borradores.sql: borra la tabla de borradores (con lo que tenga; son copias de
-- lo que se estaba escribiendo y no se guardó: si hay alguno que importe, respaldarlo antes).
-- La app sigue andando sin la tabla, con el borrador del dispositivo.
begin;
drop table if exists public.borradores;
commit;
