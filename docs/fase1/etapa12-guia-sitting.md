# Etapa 12: la guía según el sitting y los juegos (03/11/2026)

Pedido de Paulina y Delfina. Respuestas de Diego del 03/11/2026: la edad cargada a mano vale si no hay fecha
de nacimiento, 911 y 1722 llaman con un toque, autismo / TDAH / discapacidad salen de palabras clave en "salud"
(sin casilla en el panel) y "Para este sitting" es un botón con su propia pantalla.

## Para qué

La guía hoy solo se lee para firmarla. La niñera tiene que tener a mano, en el sitting que le toca, lo que
sirve para esos chicos: lo de su edad, los juegos de su edad, lo de autismo / TDAH / discapacidad si la familia
lo dijo, y siempre los teléfonos de emergencia y qué hacer si pasa algo. Además, los juegos de la guía original
(el "kit") no se pasaron a la app.

## Qué ve la niñera

- **Tarjeta del día** (solo sittings de hoy, nunca traslados ni el de ayer sin cerrar): botón "Para este
  sitting" debajo de "Ficha de la familia".
- **Detalle de "Próximos sittings"** (solo sittings): el mismo botón.
- **Pantalla `#sitting/<id>/guia`**, "Para este sitting":
  1. Emergencias, arriba y siempre (aunque no cargue la guía ni el sitting): "Llamar al 911" y "CIAT,
     intoxicaciones: 1722" (`tel:`) y "Si pasa algo: a quién avisar y en qué orden" (lección `x3`).
  2. Por edad: un bloque por módulo de edad que tenga al menos un chico ("Bebés, para el de 8 meses"), con
     sus lecciones. Sin nombres de los chicos (hoy la niñera no los ve).
  3. Juegos: los del kit cuyo rango (el del original) incluye la edad en años de algún chico.
  4. Necesidades especiales: los módulos `autismo`, `tdah`, `discapacidad` que diga la base.
  5. Sin edades ni necesidades: "No tenemos las edades de los chicos." y el botón a toda la guía.
- Una lección o un juego abierto desde ahí vuelve a "Para este sitting". "Ya lo leí" sigue marcando la lección
  (como en la guía) y vuelve a "Para este sitting".
- **Juegos dentro de la guía**: en las lecciones de actividades (`act-t`, `act-p`, `act-s`, `act-y`), con el
  "Para jugar acá" del original y las pestañas por juego, iguales al original. No guardan nada, ni en el
  celular (en el original tampoco): se borran al salir de la pantalla. Sin el modo oscuro del original (la app
  es siempre clara).

### Cortes de edad (decisión de Claude, aprobada por Diego)

| Edad (meses cumplidos en el mes del sitting) | Módulo |
|---|---|
| 0 a 2 | `recien` (Recién nacidos) |
| 3 a 11 | `bebes` (Bebés) |
| 12 a 35 | `toddlers` |
| 36 a 59 | `preescolares` |
| 60 a 107 | `escolar` (5 a 8 años) |
| 108 o más | `preteens` (también 13 o más) |

Edad cargada a mano (años, sin fecha): 0 años → `recien` y `bebes`; 1 y 2 → `toddlers`; 3 y 4 →
`preescolares`; 5 a 8 → `escolar`; 9 o más → `preteens`. Para los juegos cuenta la edad en años.

Juegos (rangos del original): emociones 2 a 6, tesoro 3 a 8, diario 3 a 10, bingo 4 a 10, laberinto 4 a 8,
tateti 5 a 12, sopa 6 a 10.

## La base: migración `20261111_guia_sitting`

`ninera_mis_sittings()` suma tres columnas al final (drop y create en la misma transacción, con sus grants;
la app publicada lee por nombre, así que las columnas de más no la rompen):

- `edades_meses int[]`: por cada chico con `fecha_nacimiento`, los meses entre el mes de nacimiento y el mes
  del sitting (`(año_s*12+mes_s) - (año_n*12+mes_n)`), en el orden de `hijos_familia`. Por mes calendario y
  no por día: así dos chicos nacidos el mismo mes dan siempre lo mismo y el valor solo cambia el 1.º de cada
  mes, y la niñera nunca puede deducir el día de nacimiento mirando sittings de días seguidos. Negativos
  (fecha futura) no van.
- `edades_anios int[]`: los chicos sin fecha con `edad_declarada`: `edad_declarada + años desde
  edad_declarada_en` al día del sitting (la regla de `chicos_texto`, a la fecha del sitting).
- `necesidades text[]`: subconjunto ordenado de `{autismo, tdah, discapacidad}`, nunca otra cosa. Sale de
  `datos->>'salud'` de la ficha que la niñera vería (`fichas_familia`: la de este sitting primero, si no la
  última de la familia), en minúsculas y sin tildes:
  - autismo: `autis`, `asperger`, la palabra `tea`
  - tdah: `tdah`, `hiperactiv`, `deficit de atencion`
  - discapacidad: `discapacid`, `sindrome de down`, `paralisis`, `silla de ruedas`
  Solo en sittings (en un traslado, vacío). La niñera ya lee esa ficha en cada sitting próximo
  (`ninera_ficha_familia`): las marcas no le muestran nada nuevo.

`ninera_mi_dia` no cambia: la tarjeta del día usa la fila de `ninera_mis_sittings` ya cargada (como "Cómo
llegar").

Prueba `supabase/pruebas/fase1_guia_sitting.sql` (como niñera): las tres columnas; dos chicos nacidos el 1 y
el 31 del mismo mes dan lo mismo en 60 días seguidos de sittings; el valor no cambia dentro de un mes; nada de
tipo `date` en el resultado; `necesidades` solo con esos tres valores (con textos tramposos), vacía sin ficha,
con "salud" vacío y en un traslado; la de este sitting gana a la última; ida y vuelta de la migración.

## Sin la migración

Sin las columnas (`edades_meses` indefinida), "Para este sitting" muestra Emergencias y "No tenemos las
edades de los chicos." con el botón a toda la guía. El simulador: `abrirAppNinera(..., { baseSinMigrar:
'etapa12' })`.

## Plan

1. Migración, DESHACER, `schema.sql`, prueba SQL (PGlite).
2. Simulador: las tres columnas en `ninera_mis_sittings` (`tests/support/rpc-ninera.js`, misma regla) y
   `baseSinMigrar: 'etapa12'`.
3. `scripts/guia-desde-html.mjs`: deja el "Para jugar acá" y su párrafo en el HTML de la lección y anota
   `juegos: [...]` (del `data-games`) en la lección; rearmar `contenido.json` (versión sin cambiar: el texto
   obligatorio no cambia). `tests/estatico.spec.js`: los cuatro `juegos`, nombres conocidos.
4. `ninera/js/juegos.js` (nuevo, antes de `arranque.js`): `JUEGOS_GUIA` (los 7, iguales al original),
   `htmlKitJuegos` / `montarKitJuegos(contenedor, nombres)` y `pantallaJuegoGuia(nombre, sittingId)`. Estilos en
   `ninera/estilos.css`. Las lecciones con `juegos` montan el kit debajo del texto.
5. `ninera/js/para-sitting.js` (nuevo, antes de `arranque.js`): reglas puras (`modulosPorEdad`,
   `juegosPorEdad`) y `pantallaParaSitting(id)`; botones en `dia.js` / `ficha.js` e `inicio.js`; la ruta en
   `abrirRutaSittingNinera`; `pantallaLeccionGuia(moduloId, leccionId, { sittingId })`.
6. Tests: `tests/ninera-para-sitting.spec.js` y `tests/ninera-juegos.spec.js` (reglas, pantalla, rutas,
   fallas, sin migrar, escape, 390 px, que nada se guarde). Docs: CLAUDE.md, `decisiones.md`,
   `prueba-iphone.md`, `fuentes.js`.
