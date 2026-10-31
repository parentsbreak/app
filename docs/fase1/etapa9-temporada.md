# Etapa 9: temporada en la app (diseño, 31/10/2026)

Detalle de `decisiones.md` 6.6 con las respuestas de Diego del 31/10/2026. Lo que no está acá sigue
como dicen `decisiones.md` 4.5, 6.6 y 10.

## Para qué
Saber dónde está cada niñera cada quincena del verano, sin que las admins tengan que pedirlo. Hoy
lo piden por WhatsApp con la página de Cloudflare (`temporada.html` → `temporada-ninera`), una vez por
año, y después persiguen a las que no contestaron. Con la app, se lo pide la app y le recuerda sola.

Éxito: una niñera con app marca su temporada en un minuto desde el celular, el panel la ve igual que
hoy (filtro de Niñeras, panel de temporadas, ficha) y a las admins no se les pide nada por ella.

## Cómo está hoy (código y base, leído el 31/10/2026)
- `ninieras.temporada` = `{<id de zona_grupos>: [quincenas]}`; quincena 0..23 desde enero (q = mes*2,
  +1 la segunda). Solo guarda las quincenas en un grupo "de afuera"; el único es Punta del Este.
- `temporada_actualizada_en` (cargada esta temporada si es ≥ 1/9), `temporada_fuente` ('ninera' = la
  página, 'formulario' = postulación, 'sistema' = las admins), `temporada_comentario` (texto libre de
  la página), `temporada_token` (link personal de la página).
- 93 niñeras activas, 1 con app (la de práctica). 26 con la temporada de este año. Las que veranean
  marcan de la 2da de diciembre a febrero; 8 marcaron Punta todo el año (viven allá).
- La Paloma no existe en `zona_grupos`.
- `programar_avisos()` (etapa 3, migración y `enviar-avisos` en producción desde el 31/10/2026) no tiene
  reglas todavía; la corre el cron cada minuto.
- La ficha de la niñera (`verNinera`) hoy no muestra la temporada; solo "Editar" y el panel de temporadas.
- "Activa los avisos" (`ninera/js/cuenta.js`) sale una vez por celular y tiene "Ahora no".

## Respuestas de Diego (31/10/2026)
1. **Apagar lo de las admins solo para las niñeras con app.** Para las que tienen app (`user_id`) no se
   pide nada a las admins: el paso de temporada al editar no sale, "Pedirle por WhatsApp" no aparece y
   el aviso anual "Pedir la temporada de Punta" no las cuenta. Para las que no tienen app todo sigue
   igual (página de Cloudflare, aviso anual del 1/10, paso previo, "Pedirle por WhatsApp"). A medida
   que entran a la app, se apaga solo para ellas. `enviar-push-urgentes` no cambia (su aviso del 1/10
   sigue para las que no tienen app): no se republica.
2. **Primer aviso enseguida.** Al publicar la etapa, a las niñeras con app sin la temporada al día les
   llega el aviso del 1/10 ese mismo día; después el recordatorio cada 15 días hasta el 31/12. Desde
   2027, el 1/10 a las 9.
3. **Pantalla: diciembre a marzo primero, el resto plegado.** Las 8 quincenas de diciembre a marzo,
   con el atajo "Todo el verano en Punta". "Ver el resto del año" despliega las otras 16. El detalle
   está en "La app de la niñera".
4. **El filtro de Niñeras lee lo nuevo.** "Fuera del país", "Otro" y "La Paloma" sacan a la niñera de
   Montevideo esas quincenas; la ficha y el panel de temporadas muestran dónde está, y "Otro" con su
   texto.
5. **La temporada de las que tienen app la persigue solo la app** (Diego, 31/10/2026): a las admins no se
   les muestra nada de ellas, aunque no contesten. Para eso los avisos pasan a ser obligatorios al
   entrar (ver "Avisos obligatorios"); si después los apaga desde Ajustes, es cosa de ella.

## Respuestas de Diego al diseño (31/10/2026)
1. **Precarga:** las 8 quincenas de diciembre a marzo vienen vacías y hay que elegir cada una (o el atajo);
   no se puede guardar con alguna vacía. Si ya cargó esta temporada, viene lo que cargó. El resto del año
   (plegado) viene en Montevideo.
2. **Quincenas sin año**, con tres condiciones: la columna nueva guarda cuándo la cargó
   (`temporada_lugares_en`), "ya cargó esta temporada" se calcula desde el inicio de cada temporada, y el
   filtro y la ficha del panel no toman como vigente lo cargado en una temporada anterior (se ve como "sin
   temporada cargada").
   - Diego pidió el corte en el 1/10. Lo dejamos en el **1/9**, como el panel de hoy: 18 de las 26 niñeras
     al día cargaron su temporada el 29 y el 30/9/2026 (el formulario sale a fin de setiembre) y con el 1/10
     quedarían como "temporada anterior". Hoy ninguna activa tiene una temporada de un año anterior, así que
     el cambio del filtro no esconde a nadie el día que se publica. (Para que Diego lo confirme.)
3. "Todo el verano en Punta", de la 2da de diciembre a la 2da de febrero: OK.
4. Avisos obligatorios sin "Ahora no", con "Seguir sin avisos" y el aviso rojo: OK.
5. Decisiones 2, 3 y 5 del constructor: OK.

## La base (migración `20261101_temporada_app.sql`)
- `ninieras.temporada_lugares jsonb` (nula). Claves "0".."23" (mismas quincenas que `temporada`),
  valores `"montevideo" | "punta" | "la_paloma" | "fuera_pais" | {"otro": "<texto>"}`. Siempre las 24.
- `ninieras.temporada_lugares_en timestamptz`: cuándo la cargó ella en la app. Una corrección de una
  admin no lo cambia.
- **Inicio de la temporada:** el 1/9 a las 0:00 de Montevideo (de setiembre a agosto), igual que
  `inicioTemporadaActual` del panel. En la base, `inicio_temporada_mvd()`.
- **Cuál manda (lugares vigentes):** `temporada_lugares` vale si no es nula, `temporada_lugares_en` es de
  esta temporada y la última carga NO fue de la página ni del formulario (`temporada_fuente` 'app' o
  'sistema'). Si después la carga la página ('ninera'), manda lo que mandó ahí (su respuesta más nueva) y
  `temporada_lugares` se ignora (no se borra).
- **Correcciones de las admins** (panel de temporadas, paso previo, "Repetir lo del año pasado"): si los
  lugares están vigentes, el panel los actualiza junto con `temporada`: las quincenas que la admin marca en
  Punta pasan a "punta", las que desmarca y estaban en "punta" pasan a "montevideo" y el resto (Fuera del
  país, Otro, La Paloma) queda como estaba; `temporada_lugares_en` no cambia. Si no están vigentes (de otra
  temporada, o la última carga fue de la página), la corrección los borra (`temporada_lugares` y
  `temporada_lugares_en` nulos): así no vuelven a valer viejos. Fuente 'sistema' (o la que tenía, al
  repetir). Así una corrección de Punta no borra lo demás que marcó ella.
- `ninera_guardar_temporada(p_lugares jsonb)` (security definer, solo `ninera_actual()`, en la lista de
  `catalogo_seguridad.sql`):
  - valida: las 24 claves, valores de la lista, "otro" con texto de 1 a 80 caracteres (recortado);
    si no, error claro (`temporada_invalida`).
  - escribe `temporada_lugares`, `temporada` en el formato de hoy (`{<id grupo Punta>: [quincenas
    "punta"]}`; el grupo es el de `zona_grupos` "de afuera" llamado Punta del Este, buscado por
    nombre normalizado; si un día existe un grupo La Paloma, lo mismo con "la_paloma"),
    `temporada_lugares_en = now()`, `temporada_actualizada_en = now()`, `temporada_fuente = 'app'`,
    `temporada_propuesta = null`, `temporada_propuesta_en = null`.
  - si marcó Punta y su zona no tiene ninguna zona de ese grupo, le agrega "Punta del Este" a `zona`,
    igual que la página y el panel (`zonaConTemporada`).
  - no toca `temporada_comentario` ni `temporada_token`.
- `ninera_mi_temporada()` (security definer, solo la suya): `{lugares, al_dia, solo_afuera}`.
  `al_dia`: `temporada_actualizada_en` ≥ `inicio_temporada_mvd()`. `lugares`: solo si está al día; si los
  lugares están vigentes, esos; si no, armados de `temporada`: "punta" en sus quincenas de Punta ("la_paloma"
  si un día hay ese grupo) y "montevideo" en el resto. Sin estar al día, `lugares` es null y la app arma la
  precarga (ver "La app de la niñera"). `solo_afuera`: todas sus zonas son de grupos de afuera. Nada de
  plata ni de otras niñeras.
- Regla de avisos `programar_avisos_temporada()`, sumada a `programar_avisos()`:
  - Para cada niñera activa con app (`user_id`) y sin la temporada al día, entre el 1/10 y el 31/12 de
    la temporada, solo de 9:00 a 21:00 de Montevideo:
  - primer aviso, clave `temporada:<año>:<id>`: "¿Vas a estar en Punta del Este esta temporada?" /
    "Marca dónde vas a estar cada quincena." (textos.md), url `#temporada` (como el chat: se resuelve contra el alcance de `ninera/`).
  - recordatorio, clave `temporada:<año>:<id>:q<n>` (n = 1, 2...): "Todavía no marcaste tu ubicación en
    la temporada" / "Te lleva un minuto.", cuando pasaron 15·n días desde que se creó SU primer aviso
    (no desde el 1/10: si entra a la app en noviembre, recibe el primero ese día y el recordatorio 15
    días después; al publicar la etapa no salen de golpe los atrasados).
  - Si la completa (desde la app, la página o una admin), no se encola nada más.
  - Liviano: una sola consulta por corrida, que no hace nada fuera del 1/10 al 31/12.
- `temporada_fuente` acepta 'app' (si tiene un check, se amplía).
- `schema.sql`, DESHACER (saca la columna, las dos funciones y la regla; antes guarda una copia de
  `temporada_lugares` de las que tienen) y pruebas SQL como niñera (`supabase/pruebas/fase1_temporada.sql`):
  guardar válido e inválido, el formato viejo que queda escrito, la zona con Punta, otra niñera no
  puede, admin no puede por esta vía, `ninera_mi_temporada` con fuente app y con fuente vieja, la
  regla de avisos (fechas, horas, al día, sin app, recordatorios a los 15 días del primero, no
  duplica), ida y vuelta de la migración, catálogo de seguridad.

## La app de la niñera (`ninera/js/temporada.js`, antes de `arranque.js`)
- Ruta `#temporada`: se suma a las rutas que `arranque.js` respeta al abrir, al `hashchange` de `chat.js`
  (push con la app abierta), a `irA` de `base.js` y a los avisos de "Avisos" (`chat.js`, solo enlaza lo
  que empieza con `#`).
- En el inicio, una tarjeta: sin la temporada al día, "¿Dónde vas a estar esta temporada?" con botón
  "Marcar"; al día, "Tu temporada" con un resumen corto y "Cambiar". Fuera de setiembre a marzo la
  tarjeta no se muestra (se puede entrar igual por el link del aviso).
- Pantalla: título "¿Dónde vas a estar esta temporada?". Una fila por quincena, de la 1ra de diciembre
  a la 2da de marzo (8), cada una con 5 opciones (Punta del Este / Montevideo / La Paloma / Fuera del
  país / Otro); "Otro" abre un campo "¿Dónde?". Arriba, el atajo "Todo el verano en Punta": marca Punta
  de la 2da de diciembre a la 2da de febrero (las quincenas en que veranean hoy) y deja el resto como
  estaba. Abajo, "Ver el resto del año" despliega las otras 16 quincenas (de abril a noviembre, en
  orden de calendario empezando en abril), sin año, como el panel: las quincenas no tienen año en
  ningún lado del sistema. Botón "Guardar".
- Precarga (Diego, 31/10/2026): si está al día, lo que devuelve `ninera_mi_temporada`. Si no, las 8 de
  diciembre a marzo vacías (ninguna opción marcada) y las 16 del resto del año en Montevideo ("punta" si vive
  solo en zonas de afuera: decisión del constructor, para que las que viven en Punta no desaparezcan del
  filtro de Punta de abril a noviembre). "Guardar" con alguna de diciembre a marzo vacía no guarda: marca las
  que faltan y dice "Te falta marcar X quincenas". Estando al día, guardar sin cambios cuenta como
  confirmada.
- Pensada primero para 390 px: las 5 opciones como botones grandes en una fila que se ajusta (no un
  select), con la elegida marcada. Textos en "tú", de `textos.md` 6; los que falten van a
  `textos-provisorios.md`.
- Errores: la base que falla, sin conexión o el texto de "Otro" vacío dicen qué pasó y no pierden lo
  marcado; doble toque guarda una vez (`conGuardado`). Base sin la migración: la tarjeta y la pantalla
  no aparecen (como las etapas anteriores con `baseSinMigrar`).

## Avisos obligatorios (`ninera/js/cuenta.js`, `arranque.js`, `inicio.js`)
- "Activa los avisos" sin "Ahora no": solo "Activar avisos". Sale cada vez que entra con los avisos
  apagados en ese celular (no una sola vez por celular).
- Si el permiso queda bloqueado (lo rechazó, o el navegador no pregunta más): pantalla con los pasos para
  activarlos en Ajustes (iPhone y Android) y "Ya los activé" (vuelve a probar). Abajo, chico, "Seguir sin
  avisos": pasa al inicio, que muestra un aviso rojo fijo, sin cerrar, con "Activar avisos".
- Si el celular no puede recibir avisos (`avisosSoportados()` falso, por ejemplo Safari sin instalar), pasa
  como hoy (el paso de instalar ya lo empuja a instalarla).
- Textos en "tú"; los nuevos van a `textos-provisorios.md`.

## El panel
- **Niñeras con app** (`user_id`): sin paso de temporada al editar (`editarNinera` / `abrirPasoTemporada`),
  sin "Pedirle por WhatsApp" en su fila del panel de temporadas (en su lugar, "Se la pide la app"), y
  fuera de la cuenta "Hoy hay X sin temporada al día" del aviso anual. Las admins pueden seguir
  corrigiéndola desde el panel de temporadas como hoy (queda con fuente 'sistema').
- **Fuente:** `textoFuenteTemporada` dice "la cargó ella en la app" para 'app'.
- **Filtro de Niñeras** (`nineraPresenteEnZona`): solo cuenta la temporada de esta temporada
  (`estadoTemporada` 'ok'); una de una temporada anterior se trata como "sin temporada cargada" (Diego,
  31/10/2026), para todas, con app o sin app. Con los lugares vigentes, una quincena con "fuera_pais",
  "otro", "la_paloma" o "punta" la saca de las zonas de Montevideo; Punta sigue saliendo de `temporada`
  como hoy. Sin lugares vigentes, igual que hoy.
- **Ficha de la niñera** (sección nueva y chica "Temporada", hoy no muestra nada; una temporada anterior se
  ve como "Sin temporada cargada") **y panel de temporadas:**
  las quincenas en Punta (`textoQuincenas`) y, si `temporada_lugares` manda, una línea por lugar distinto de
  Montevideo: "Fuera del país: 1ra de marzo", "Otro (Rocha): 2da de marzo",
  "La Paloma: enero" (`textoQuincenas` para las fechas). Escapado.
- Nada de plata, ningún cambio de Edge Function.

## Docs que se actualizan en el PR
`decisiones.md` 6.6 y 10, `plan-implementacion.md` (etapa 9 al detalle, sin `ordenarSugeridas` ni el
apagado del aviso anual), `textos-provisorios.md` y CLAUDE.md (convención, tests, pendientes; se borra
el pendiente ya hecho "Publicar `enviar-avisos` junto con la migración").

## No se hace en esta etapa
- `ordenarSugeridas` y `app_config 'temporada_reglas'`: van en la etapa 5, junto con lo único que los
  lee (las sugeridas de un pedido). Esta etapa guarda el dato; qué pedidos recibe cada lugar se aplica
  ahí con la regla de `decisiones.md` 4.5.
- Apagar la página de Cloudflare, `temporada-ninera`, `TEMPORADA_URL` y el mensaje de difusión: cuando
  todas las activas tengan la app (PR aparte, con OK; `decisiones.md` 10). Se anota en CLAUDE.md.
- Endurecer `temporada-ninera` (pendiente de seguridad de noviembre): aparte.

## Tests
- `tests/ninera-temporada.spec.js`: tarjeta del inicio (sin cargar, al día, fuera de temporada), la
  pantalla (precarga, atajo, Otro con texto y sin texto, ver el resto, guardar, base que falla, sin
  conexión, doble toque, base sin migrar, push que abre `#temporada`, 390 y 1280 px, sin montos).
- `tests/temporada-app-panel.spec.js` (panel): niñera con app sin paso previo ni "Pedirle por
  WhatsApp", cuenta del aviso anual, fuente "en la app", filtro con Fuera del país / Otro / La Paloma,
  ficha y panel con los lugares, fuente vieja igual que hoy, escape del texto de "Otro".
- `tests/ninera-cuenta.spec.js` cambia a propósito (los avisos ya no se saltean con "Ahora no"): el PR lo
  dice. Casos nuevos: bloqueado → pasos y "Ya los activé", "Seguir sin avisos" con el aviso rojo, celular
  que no puede.
- `tests/filtro-punta.spec.js` y el resto de la suite siguen igual.

## Decisiones del constructor (Claude, para revisar)
- El resto del año (abril a noviembre) precargado en "punta" para las que viven solo en zonas de afuera.
- El corte de la temporada queda en el 1/9 (ver "Respuestas de Diego al diseño", 2).
- `temporada_lugares` manda salvo que la última carga sea de la página; las admins la corrigen sin borrar lo que no es Punta.
- Recordatorios contados desde el primer aviso de cada niñera; avisos de temporada solo de 9 a 21.
- La tarjeta del inicio solo de setiembre a marzo.
- `temporada_reglas` y las sugeridas pasan a la etapa 5.
