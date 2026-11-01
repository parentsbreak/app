# Fase 1: decisiones de diseño (25/10/2026)

Cierra el brainstorming entre Diego y Claude del 25/10/2026. Se lee con `reglas-del-negocio.md`
(manda sobre todo), `plan-fase1.md` (alcance aprobado por las dueñas) y `textos.md` (textos
finales). El plan de construcción, etapa por etapa, está en `plan-implementacion.md`.
Si algo de acá choca con las reglas del negocio, ganan las reglas y se corrige este archivo.

Repo público: en este documento, en el plan, en el código, en los tests, en los commits y en
los PRs no van nombres, celulares, cuentas ni montos reales de familias, niñeras o candidatas.

## 1. Para qué

Hoy cada pedido de una madre es una cadena de mensajes de WhatsApp: la admin lo lee, piensa a
quién mandárselo, escribe a varias niñeras, espera, le manda perfiles a la madre, confirma,
y el día del sitting vuelve a preguntar si llegó, hasta qué hora estuvo y si gastó algo.
La fase 1 pasa esa cadena al sistema: la admin pega el mensaje, la app arma el pedido, sugiere
a quién mandarlo y se lo manda por su app a las niñeras; ellas aceptan, marcan cuándo llegaron
y cierran el sitting desde el celular; las admins solo confirman. Con las madres no cambia
nada: siguen por WhatsApp, con plantillas listas para copiar.

Pregunta guía de CLAUDE.md: si una admin se va tres semanas, el negocio sigue con el sistema.

## 2. Objetivos, no objetivos y anti-objetivos

Objetivos de la fase 1 (lo que tiene que andar para la prueba con 3 a 5 niñeras):
- La niñera tiene su app instalada en el celular, con avisos, y hace todo lo suyo desde ahí:
  perfil, guía, pedidos, el día del sitting, el cierre, chat, temporada y carsitting.
- La admin pega el mensaje de la madre, confirma el pedido, manda a las sugeridas, ve quién
  aceptó, marca la elegida y confirma el cierre con un toque.
- Nada de plata acumulada llega a la niñera, y eso lo garantiza la base, no la pantalla.

No objetivos (quedan fuera, ver `plan-fase1.md`, "Fuera de la fase 1"): App Store, app de
familias, WhatsApp por la API de Meta, Mercado Pago automático, panel por admin, chat de ayuda
para admins, niñeras de Argentina, juegos de la guía, opiniones de padres en el CV, detección
en fotos. Pedidos de traslado por la app: solo como última etapa opcional (ver 4.2).

Anti-objetivos (si pasa, la fase 1 fracasó aunque "funcione"):
- Una niñera ve un monto que no es su precio por hora, o datos de otra niñera.
- Un mensaje le llega a una madre o a una niñera real sin que una admin lo haya confirmado.
- Las admins tienen más pasos que hoy para un pedido.
- Se rompe algo de lo que ya usan todos los días (Agenda, Sittings, Finanzas, fijos).
- Un dato real termina en el repo.

## 3. Restricciones

- Mismo stack: HTML/CSS/JS vanilla, sin build, scripts clásicos con handlers inline, GitHub
  Pages desde `main`, mismo Supabase. Fondo blanco siempre; nada de modo oscuro ni rediseño.
- Celular primero: las dos puertas se diseñan para iPhone (390 px) y se prueban también a 1280.
- Un PR por etapa, CI verde, tests de Playwright contra el simulador con datos ficticios.
- Migraciones en `supabase/migraciones/AAAAMMDD_descripcion.sql` + `_DESHACER.sql`, probadas en
  Postgres local (PGlite), reflejadas en `schema.sql`. Diego las corre él en el SQL Editor
  cuando da el OK; Claude le pasa el SQL listo y le dice exactamente qué verificar después.
- Edge Functions: se publican solo con el OK de Diego y el repo queda igual a lo publicado.
- Todo texto de datos se escapa (`escaparHtml`, `argJs`, `urlSegura`). Nunca `toISOString()`
  para una fecha; "hoy" sale de `todayISO()`. Montos: nunca `Math.round`.

## 4. Decisiones de producto (Diego, 25/10/2026)

4.1 **Cuenta de la niñera.** Usuario = su celular + contraseña. Sin mail y sin SMS. Por dentro, la
cuenta de Supabase Auth usa un mail sintético armado con el celular normalizado
(`59899123456@ninieras.parentsbreak.invalid`; `.invalid` es un dominio reservado que nunca va a
existir); la niñera nunca lo ve. La cuenta la crea una Edge Function con la clave de servicio al
abrir el link de invitación, y queda vinculada a su ficha (`ninieras.user_id`). Olvidó la
contraseña: la admin le genera un link nuevo desde la ficha, igual que la invitación. Las niñeras
sin celular cargado no se pueden invitar hasta que la admin lo cargue.

4.2 **Solo sittings.** Los pedidos por la app son de sittings. Los traslados siguen por WhatsApp.
El formulario de carsitting sí se hace en la app (datos y fotos). Pedidos de traslado por la app:
última etapa, opcional, solo si todo lo demás anda estable (tarjeta "Traslado", precio por viaje,
a las aprobadas).

4.3 **Una cuenta, un rol.** Las cuentas de admin son solo admin (`usuarias_autorizadas`, sin
tocar). Una socia que además cuida chicos se invita como cualquier niñera, con su celular y su
propia contraseña, y entra a `/ninera/` con ese usuario. Ningún texto de la app de niñeras
supone que quien lo lee es admin.

4.4 **PRs viejos.** #63 (borrador de la entrevista en la base) se rebasa y mergea primero (etapa
0), con su migración corrida por Diego. #60 (car sitting) se cierra sin mergear: el formulario
de Google y el webhook quedan reemplazados; lo que sirve (la lista "Completaron / Faltan" en
Niñeras) se rehace en la etapa de carsitting. El plan dice qué se apaga y cuándo (sección 10),
sin apagar nada todavía.

4.5 **Temporada, por quincena marcada** (regla configurable, nunca hardcodeada):
- Punta del Este: solo recibe pedidos de Punta.
- Montevideo: los de siempre.
- La Paloma: solo pedidos de La Paloma si esa zona existe en el sistema; si no, ninguno.
- Fuera del país: ninguno.
- Otro (con un campo de texto para escribir dónde): no recibe pedidos esa quincena, y en su
  ficha las admins ven la marca para decidir a mano.
- Sin temporada cargada: la regla actual de `reglas-del-negocio.md`, sección 1.

4.6 **Guía.** Lecciones y repasos en un archivo JSON del repo con número de versión; cambiar un
texto es un PR de Claude. Sin editor para las admins en la fase 1. Un repaso se aprueba con todas
las respuestas bien, reintentos libres y la explicación al instante, como en la guía original.

4.7 **Firma anual.** Casilla con la declaración ("Leí y entendí la guía de Protocolos y RCP y
primeros auxilios de Parents' Break"), nombre completo tipeado y firma dibujada con el dedo,
guardada como imagen en un bucket privado (solo admins la ven), con la versión de la guía y la
fecha. Sin firma del año vigente no recibe pedidos.

4.8 **Plazo de la guía.** Las que ya trabajan tienen un plazo (configurable, por defecto 7 días)
desde que activan la app antes de que la falta de guía o de firma les frene los pedidos; ven
"Tienes hasta el [fecha] para completarla". Las nuevas (sin sittings registrados antes de activar
la app) la necesitan antes del primer pedido.

4.9 **Vencimiento anual.** Al año de la firma le llega "Repasa la guía"; tiene 7 días
(configurable) para volver a leer Protocolos y RCP, aprobar esos dos repasos y firmar de nuevo.
Pasados los 7 días no recibe pedidos hasta hacerlo.

4.10 **Fijos en la app de niñeras.** Sin recordatorios de 24 h y 1 h. Solo "Ya entré" (opcional)
y el cierre "¿Hasta qué hora estuviste?" a la hora de fin, con el recordatorio a los 30 minutos.

4.11 **Después de la hora límite de respuesta.** La niñera puede seguir aceptando hasta que el
pedido se cubra o se cancele; el límite solo marca urgencia y dispara el recordatorio.

4.12 **Dónde queda lo nuevo en el panel** (sin rediseño, mismo sistema de diseño): en la Agenda,
"Pegar mensaje de WhatsApp" al lado de "+ Nueva solicitud"; en Hoy, tarjetas "Pedidos en curso",
"Mensajes de niñeras" y "Carsitting para revisar"; en la ficha de cada niñera, el chat completo,
"Invitar a la app" y el estado de la guía. Sin sección nueva en el menú.

4.13 **Niñeras sin app en las sugeridas.** Las sugeridas muestran a todas en su orden. Las que
tienen app se tildan y reciben el pedido por la app; las que no, muestran el botón de WhatsApp
con el mensaje armado (el que ya existe en la Agenda) y la admin las asigna a mano como siempre.

4.14 **Inicio de la niñera.** Arriba los pedidos por responder; abajo "Próximos sittings" (hoy y lo
que viene, fijos incluidos, sin plata). Sin sittings pasados en la fase 1.

4.15 **La prueba** con 3 a 5 niñeras arranca después de la etapa 7 (pedido, elección, el día y
cierre de punta a punta). La etapa 8 puede entrar durante la prueba. En las etapas 5 y 6 se
prueba con pedidos de práctica inventados entre Diego y las admins.

4.17 **Datos de práctica en producción.** Para probar las etapas 5 a 7 con pedidos inventados, una
admin carga filas reales con "(práctica)" en el nombre: una niñera con el celular de Diego y una
familia inventada. Condiciones: (a) un pedido de práctica se manda solo a la niñera de práctica,
nunca a las reales: la pantalla de sugeridas avisa si hay una real tildada junto con una de
práctica; (b) los sittings de práctica no se marcan como cobrados ni pagados; (c) al terminar la
prueba, Diego las borra con respaldo previo y su OK. La regla va a CLAUDE.md en la etapa 1.

4.18 **De dónde sale el pago por hora de la niñera.** `precios_ninera_familia` es la fuente del
pago de todo sitting puntual (registro en Sittings, pedido por la app, confirmación del cierre)
cuando existe una fila para esa niñera con esa familia; si no, `familias.pago_hora` como hoy.
Los fijos (`asignaciones`) y los registros ya cargados no cambian. Se implementa con una sola
función de búsqueda (`precioHoraNinera(familia, nineraId, precios)` en JS y `pago_hora_ninera()`
en SQL), sin tocar fórmulas ni redondeos, con tests nuevos contra el oráculo de la red de plata.
Las variantes de precio de la familia se aplican después, sobre esa base, como hoy.

4.19 **Pedido resuelto por otro lado o cancelado.** Si se asigna a mano a otra niñera (con o sin
app), las que aceptaron reciben "Gracias por responder / Este sitting ya quedó cubierto". Si se
cancela el pedido con respuestas abiertas, reciben "Se canceló el pedido del [día]. Gracias por
responder." (texto nuevo; Diego lo suma a `textos.md` para las dueñas).

4.20 **Contraseñas.** Supabase Auth tiene largo mínimo 6 y sin caracteres obligatorios (verificado
por Diego el 25/10/2026): no hay que cambiar nada. La regla de la app para niñeras es mínimo 8
letras o números. Las admins siguen con su regla fuerte en el panel.

4.21 **Mail sintético, verificado.** Supabase Auth acepta `...@ninieras.parentsbreak.invalid`:
Diego creó y borró un usuario de prueba con ese dominio desde el panel (Authentication → Users →
Add user) el 26/10/2026. Es el dominio definitivo. Vive en una sola constante por capa (`MAIL_DOMINIO_NINERA` en `js/comun.js`, en la Edge Function y en la función
SQL `mail_sintetico_ninera`).

4.16 Decisiones chicas, aceptadas:
- "Madre: nombre + inicial" sale de `familias.nombre`: primera palabra + inicial de la última
  (49 de 68 familias son "Nombre Apellido"). Si el nombre tiene una sola palabra, esa palabra.
- Al mandar un pedido, si faltan la dirección o los chicos de la familia, la app pide completarlos
  ("Falta [dato]") antes de enviar.
- "Prefiero otros perfiles" (calificación de la niñera) baja a la niñera dentro de su bloque y
  queda visible para las admins; no la saca.
- "No acepta nuevas" es una casilla nueva en la ficha de la familia (`familias.solo_conocidas`).
- El precio de la primera vez se pide en una sola lista con todas las elegidas, precargado, en vez
  de una pregunta por niñera.
- La ficha de la familia (de la guía) es opcional y se precarga con la última de esa familia.
- "Agregar al calendario" baja un archivo `.ics`.
- Lo que la niñera manda al cerrar (hora real, gasto, comentarios) cae en Hoy, en "Cierre de los
  fijos", que ya existe, y la admin lo confirma con un toque; vale para puntuales y fijos.
- El gasto que carga la niñera entra como gasto extra pagado por ella; la admin elige quién lo
  paga (familia o Parents Break), como hoy.
- Una niñera invitada que no activó los avisos recibe igual los pedidos en la app; en Niñeras se
  ve la marca "sin avisos".

## 5. Arquitectura

### 5.1 Dos puertas, un repo
- Admins: `index.html` + `js/*` (sin cambios de navegación).
- Niñeras: `ninera/index.html`, `ninera/manifest.json`, `ninera/sw.js`, `ninera/estilos.css`,
  `ninera/js/*.js` y `ninera/guia/contenido.json`. URL publicada:
  `https://parentsbreak.github.io/app/ninera/` (desde la mudanza del 27/10/2026; antes
  `diegomarin28.github.io/sistema-parents-break/ninera/`).
- `js/comun.js` (nuevo): helpers puros que usan las dos puertas, sacados de `core.js`:
  `escaparHtml`, `argJs`, `urlSegura`, `normaliza`, `todayISO` / `fechaNegocioISO`,
  `sumarDiasISO`, `diaSemanaDeISO`, `calcularEdad`, `toast`, `conGuardado`, `sbGuardar`,
  `copiarAlPortapapeles`. Se carga primero en `index.html` (antes de `core.js`) y en
  `ninera/index.html`. Cambia el orden de carga de la regla 4 de CLAUDE.md (consultado el
  25/10/2026); `tests/support/fuentes.js` pasa a tener dos órdenes, uno por puerta. Nada de
  funciones de plata en `comun.js`: la app de niñeras no calcula plata.
- Scripts de la niñera, clásicos y en este orden: `../vendor/supabase-js-2.117.2.umd.js`,
  `../js/comun.js`, `ninera/js/base.js` (cliente, sesión, navegación, pantalla de carga),
  `cuenta.js` (invitación, login, instalar, avisos), `inicio.js` (pedidos y próximos sittings),
  `perfil.js`, `guia.js`, `dia.js`, `chat.js`, `temporada.js`, `carsitting.js`, `arranque.js`
  (último). Cada etapa suma su archivo; `arranque.js` siempre al final.
- El cliente de la niñera usa otra clave de sesión: `createClient(..., { auth: { storageKey:
  'sb-ninera-auth' } })`. Las dos puertas comparten origen y `localStorage`: sin esto, la socia
  que entra al panel y después abre `/ninera/` en el mismo navegador encontraría la sesión de
  admin (y al revés).
- Service workers: el de admins (`sw.js`, alcance `./`) cubre todo el sitio; el de niñeras
  (`ninera/sw.js`, alcance `./ninera/`) es más específico y gana en su carpeta. Cada registro
  tiene su propia suscripción push. iOS no muestra botones en las notificaciones web: Acepto /
  No puedo viven en la tarjeta de la app y el push abre el pedido.
- Manifest de niñeras: nombre "Parents' Break", `start_url` y `scope` `./`, íconos y splash
  reutilizando los archivos de la raíz (`../icon-192.png`, `../splash/*`).
- Una niñera que entra al panel de admins con su cuenta: después del login, si
  `es_usuaria_autorizada()` es falso y `ninera_actual()` devuelve su id, `auth.js` cierra esa
  sesión local y muestra "Esta cuenta es de niñera. Entrá por la app de niñeras" con el link a
  `ninera/` (no se la redirige sola: la sesión vive bajo otra clave y tendría que entrar igual);
  si tampoco es niñera, "Esta cuenta no tiene acceso".

### 5.2 Cuentas, invitación y roles
- `ninieras.user_id uuid unique references auth.users(id) on delete set null`.
- `ninera_actual()`: `security definer`, estable, devuelve el id de la niñera activa cuya
  `user_id = auth.uid()`, o null. `es_ninera()` = `ninera_actual() is not null`. Mismo patrón
  que `es_usuaria_autorizada()`: `revoke from public`, `grant to authenticated`.
- `ninera_invitaciones (id, ninera_id, token text unique, creada_por, creada_en, vence_en
  default now() + 7 días, usada_en)`. El token es aleatorio y largo (dos `gen_random_uuid()` pegados sin
  guiones, 64 hex, sin pgcrypto), nunca el id de la niñera. RLS: solo admins. Un link nuevo invalida los anteriores de
  esa niñera. La vigencia (7 días) sale de `app_config 'ninieras_app'`.
- Celular normalizado (una sola regla en SQL, Deno y JS, probada con los mismos 11 casos): solo
  dígitos; se quita un `00` inicial; si empieza en 598, la parte local es el resto; de la parte
  local se quita un 0 inicial; tiene que quedar 8 dígitos que empiecen en 9 → `598` + local
  (`+598 99 123 456`, `099123456`, `00598 99 123 456` y `+598 099 123 456` dan lo mismo). El
  mail sintético es `<normalizado>@ninieras.parentsbreak.invalid`. Si el
  celular no normaliza a un número uruguayo válido, no se puede invitar (la admin lo corrige).
- Edge Function `ninera-cuenta` (verify_jwt = false, CORS solo al origen publicado):
  - `POST {token}` → `{nombre (solo el primer nombre), celular_mascarado, es_reset}` o
    `{error: 'vencido'}`. Para la pantalla de bienvenida.
  - `POST {token, password}` → valida token (no vencido, no usado), lee el celular de la ficha,
    arma el mail sintético; si `user_id` está vacío, `auth.admin.createUser({email, password,
    email_confirm: true, user_metadata: {ninera_id}})` y guarda `user_id`; si ya existe (reset),
    `auth.admin.updateUserById(user_id, {password})`. Marca `usada_en`. Devuelve el celular
    normalizado para que la app entre sola con `signInWithPassword`.
  - `user_metadata` (nombre, ninera_id) lo puede cambiar la propia niñera desde su sesión
    (`auth.updateUser`): sirve solo para saludarla, nunca para autorizar ni para buscar su ficha;
    la identidad es `ninieras.user_id` + `ninera_actual()` (26/10/2026).
  - Contraseña: mínimo 8 letras o números (textos, sección 3). Sin passkeys en la fase 1.
- Login diario: la niñera escribe su celular (cualquier formato) y la contraseña; la app
  normaliza y entra con el mail sintético. "Olvidé mi contraseña" muestra "Pídele un link nuevo
  al equipo por WhatsApp" (sin mails).
- En la ficha de la niñera (admins): "Invitar a la app" genera el link y abre el mensaje de
  WhatsApp de `textos.md` sección 2 para copiar o abrir; si ya tiene cuenta, el mismo botón dice
  "Link para cambiar la contraseña". Se ve si tiene app, desde cuándo (`ninieras.app_activada_en`,
  primer login) y si activó avisos.
- Cambio de celular de una niñera con cuenta: el mail sintético queda viejo. La admin cambia el
  celular en la ficha → la app avisa que la niñera va a necesitar un link nuevo, y `ninera-cuenta`
  al usarlo actualiza el mail de la cuenta (`updateUserById({email})`). Baja de una niñera
  (`activa = false`): `ninera_actual()` devuelve null y la app le muestra "Tu cuenta no está
  activa. Escríbenos por WhatsApp."

### 5.3 Seguridad en la base (lo más delicado del proyecto)
Principio: las políticas actuales siguen pidiendo `es_usuaria_autorizada()`. La niñera no suma
políticas sobre las tablas compartidas (`sittings_traslados`, `solicitudes`, `familias`,
`ninieras`, `gastos_extra`...): todo lo que lee o escribe ahí pasa por funciones SQL
`security definer` con `set search_path = public` que filtran por `ninera_actual()` y devuelven
solo las columnas permitidas. Sus tablas propias (eventos del día, cierres, chat, progreso de
la guía, avisos, días no disponibles, fichas de familia) llevan RLS directa:
`ninera_id = (select public.ninera_actual())`, con `with check` en las escrituras.

Funciones de lectura (`stable`, `revoke from public`, `grant to authenticated`; devuelven vacío
si `ninera_actual()` es null):
- `ninera_mi_perfil()`: nombre, celular, servicios (`tipo`), zonas, cuenta bancaria, estado de la
  guía y de la firma, temporada, carsitting (estado), `app_activada_en`.
- `ninera_mis_sittings()`: de `sittings_traslados` con `ninera_id = ninera_actual()`, no
  cancelados, fecha >= hoy (Montevideo) y hasta +60 días: id, tipo, fecha, hora_inicio, hora_fin,
  termina_dia_siguiente, zona, madre (nombre + inicial), dirección, chicos (texto), notas para la
  niñera, estado del día (eventos y cierre propios), si hay ficha de la familia. Sin precio: el
  precio por hora se ve solo en el pedido y en "¡Quedaste seleccionada!" (4.14 y reglas, sección
  3), desde `solicitud_ninieras.precio_hora`. Los fijos aparecen 14 días adelante (los previstos
  automáticos están activos en producción) y los puntuales hasta +60. Nunca `cobro_familia`,
  `pago_ninera`, `cobrado`, `pagado`, `notas` internas ni nada de Finanzas.
- `ninera_mis_pedidos()`: de `solicitud_ninieras` suyas con `estado in ('invitada', 'acepto')`
  y la solicitud no cancelada: fecha, horas (y "aproximada"), zona, chicos, `precio_hora`,
  `responder_hasta`, estado. Sin familia (ni nombre ni inicial) hasta quedar seleccionada.
- `ninera_ficha_familia(p_sitting_id)`: la última ficha de esa familia, solo si el sitting es
  suyo y está confirmado.
Funciones de escritura (`volatile`, mismas restricciones; validan que lo tocado sea suyo y
devuelven el error en texto claro): `ninera_guardar_perfil`, `responder_pedido`,
`ninera_marcar_evento`, `ninera_cerrar_sitting`, `ninera_cargar_gasto`,
`ninera_guardar_ficha_familia`, `ninera_guardar_temporada`, `ninera_guardar_carsitting`,
`ninera_marcar_no_disponible`.

Qué NUNCA puede ver la niñera (lista para el revisor de cada PR):
- `cobro_familia`, `pago_ninera`, `cobrado`, `pagado`, totales, saldos, ajustes, Finanzas,
  intermediaciones, márgenes, `precios_ninera_familia` de otras, `asignaciones.cobro_hora` /
  `pago_hora`, `cobro_traslado` / `pago_traslado`.
- El apellido completo de la madre, `familias.notas`, `familias.telefono` (salvo lo que la
  propia ficha de la familia de la guía trae, que llenó una niñera con los padres),
  `familias.cuenta_bancaria`, `ninieras.notas`, candidatas, entrevistas, incidentes.
- Datos de otras niñeras (nombre, celular, cuenta, si aceptaron o no un pedido).
- Nada que diga cuándo se paga, cuánto se acumuló ni que parezca un recibo.
Cada etapa que agregue una función de lectura trae una prueba SQL (PGlite) que, con el rol
`authenticated` y el `sub` de una niñera ficticia, verifica que las columnas prohibidas no
están en la salida y que las tablas compartidas devuelven 0 filas en lectura directa.

Storage:
- Bucket privado nuevo `ninieras-privado` (se crea en la etapa 2, 5 MB, solo imágenes; en la 2 lleva
  `fotos/<ninera_id>/propuesta.jpg`, la foto propuesta que la admin aprueba antes de que reemplace la del CV): firmas (`firmas/<ninera_id>/...`), certificados de
  RCP (`rcp/<ninera_id>/...`) y fotos de carsitting (`carsitting/<ninera_id>/...`). Políticas:
  la niñera lee y escribe solo rutas exactas suyas: en la etapa 2, `name = 'fotos/' ||
  ninera_actual() || '/propuesta.jpg'` (27/10/2026, revisión final: "bajo su carpeta" la dejaba
  subir archivos sin límite a cualquier carpeta con su id); las etapas 4 y 10 amplían la política
  para sus rutas y deciden ahí si la niñera puede borrar. Admins leen y borran; nadie lista
  público. Se ven con `createSignedUrl`.
- Bucket `comprobantes` (existe): la niñera puede subir bajo `ninieras/<ninera_id>/...` para el
  ticket de un gasto; no puede listar ni leer.
- `push_subscriptions`: columna nueva `user_id uuid`; política para que una cuenta autenticada
  lea, escriba y borre solo sus filas (`user_id = auth.uid()`); la admin sigue con `usuario`
  (mail) y su política actual. La Edge Function de envío manda a una niñera por `user_id`.

### 5.4 Avisos (push + lista en la app)
Una sola cola en la base, `avisos`:
```
id uuid, clave text unique,          -- idempotencia: 'pedido:<sn>:nuevo', 'sitting:<id>:fin30'
para_ninera_id uuid,                 -- destinataria niñera (una de las dos)
para_admin text,                     -- 'todas' o el mail de una admin
tipo text, titulo text, cuerpo text, url text, datos jsonb,
enviar_desde timestamptz default now(), enviado_en, error text, intentos int default 0,
leido_en timestamptz, creado_en timestamptz default now()
```
- RLS: la niñera lee y marca leído solo lo suyo; admins leen lo suyo (`para_admin`) y escriben
  (por ejemplo, el aviso "pedido nuevo" a las otras). Las inserciones de reglas de tiempo las hace
  la base. `para_admin = 'todas'` es una sola fila: la Edge Function la reparte entre las cuentas
  activas de `usuarias_autorizadas` al enviar (la clave de servicio lee sus mails en `auth.users`),
  y lo leído se anota por admin en `notificaciones_leidas`, como la campanita de hoy. "Pedido
  nuevo" va a `'todas'` con `datos.excepto = <mail de quien pegó>`. El "[nombre de la admin]" del
  chat sale de `chat_mensajes.autor` (el nombre para mostrar de la cuenta, `nombreUsuario()`).
- `programar_avisos()`: función SQL que corre cada minuto (pg_cron) y, a partir del estado actual,
  inserta los avisos que tocan con `on conflict (clave) do nothing`. Es idempotente y se recalcula
  del estado: si un sitting se cancela o cambia de hora antes de que toque el aviso, no se manda.
  Cada etapa le suma sus reglas (sección 7). Horas en Montevideo (offset fijo -03:00).
- Envío: Edge Function `enviar-avisos` (nueva; `enviar-push-urgentes` queda como está): el cron
  la llama cada minuto con `x-cron-secret`; reclama filas con una función atómica
  (`reclamar_avisos()`: `update ... set enviado_en = now() where enviado_en is null and
  enviar_desde <= now() returning *`, de a 50), manda con web-push y las claves VAPID de
  `app_secrets`, y anota `error` si falló (una suscripción vencida se borra). Para lo
  instantáneo (pedido nuevo, aceptó, chat, problema al llegar), un trigger `after insert` en
  `avisos` dispara `net.http_post` a la misma función cuando `enviar_desde <= now()`; como el
  reclamo es atómico, el cron y el trigger no mandan dos veces.
- Admins: el push respeta `notif_push_preferencias` por `tipo` (tipos nuevos, con su default) y
  la campanita (`cargarNotificaciones`) suma los avisos de `para_admin` con lo leído por usuaria
  (`notificaciones_leidas`, como hoy).
- Niñera: su lista "Avisos" en la app sale de la misma tabla; el push es un atajo. Sin avisos
  activados ve igual todo en la app.
- Catálogo de avisos: sección 7.

### 5.5 Datos nuevos (resumen; el detalle de cada migración va en el plan)
- Etapa 1: `ninieras.user_id`, `ninieras.app_activada_en`, `ninera_invitaciones`, `ninera_actual()`,
  `es_ninera()`, `normalizar_celular()`, `push_subscriptions.user_id` y su política,
  `app_config 'ninieras_app'` (vigencia del link en días).
- Etapa 2: funciones `ninera_mi_perfil`, `ninera_guardar_perfil`, `ninera_mis_sittings`,
  `madre_nombre_inicial(nombre)`, `chicos_texto(familia_id)`, `hoy_mvd()`; columnas `ninieras.perfil_app_en`,
  `perfil_actualizado_en`, `foto_propuesta_ruta`, `foto_propuesta_en`; bucket `ninieras-privado` (5 MB,
  imágenes) con la foto propuesta.
- Etapa 3 (migración `20261029_avisos_chat`): tablas `avisos` y `chat_mensajes`; funciones internas
  `encolar_aviso`, `reclamar_avisos`, `programar_avisos` (las reglas van en `programar_avisos_<regla>()`),
  `admins_activas_mails`, `llamar_enviar_avisos`, `correr_cron_avisos`; de la niñera
  `ninera_enviar_mensaje`, `ninera_marcar_chat_leido`, `ninera_marcar_avisos_leidos`; trigger por sentencia
  que llama a la Edge Function una vez, y cron de cada minuto que solo llama si hay pendientes. Las admins
  insertan solo `ninera_id, de, autor, texto` y actualizan solo `leido_admin_en`.
- Etapa 4: `guia_progreso`, `guia_repasos`, `guia_firmas`, `ninieras.rcp_presencial`,
  `ninieras.rcp_certificado_ruta`, `ninera_puede_recibir_pedidos()`,
  `app_config 'guia'` (plazo_dias, gracia_anual_dias, version_vigente).
- Etapa 5: `solicitudes` (+ `pedido_id`, `chicos_texto`, `ninera_pedida`, `notas_para_ninera`,
  `enviado_app_en`, `responder_hasta`), `solicitud_ninieras` (+ `enviado_en`, `visto_en`,
  `respondido_en`, `motivo_no`, `motivo_texto`, `precio_hora`, `origen`; estados nuevos
  `acepto`, `no_puedo`, `cubierto`), `precios_ninera_familia`, `ninera_no_disponible`,
  `familias.solo_conocidas`, `app_config 'pedidos_app'` y `'temporada_reglas'`, funciones
  `ninera_mis_pedidos`, `responder_pedido`, `ninera_marcar_no_disponible`, `enviar_pedido_app`
  (admin: crea las filas y los avisos en una transacción).
  Como quedó (02/11/2026, respuestas de Diego del 31/10; detalle en `plan-implementacion.md`, etapa 5): migración
  `20261102_pedidos_app`. Sin `solicitudes.pedido_id` (ya existe `pedidos_whatsapp.solicitud_id`), sin `chicos_texto`
  (los chicos salen de `chicos_texto(familia_id)`), sin `app_config 'temporada_reglas'` (la regla 4.5 vive en
  `nineraPresenteEnZona`), sin `visto_en` ni el estado `cubierto` (son de la etapa 6). Sí: `ninera_pedida` en
  `pedidos_whatsapp`, `ninera_pedida_id` en `solicitudes`, y `app_config 'pedidos_app'` con `solo_practica` (hasta la
  etapa 4 y la prueba real, solo pedidos de práctica; lo apaga Diego por SQL), `pedidos_whatsapp.dudas` y
  `sugeridas_datos` (invoker). Una solicitud mandada pasa a `pendiente_confirmar`.
- Etapa 6: `elegir_ninera(p_sn_id)` (admin, atómica: elegida → `confirmada`, las demás con
  `acepto` o `invitada` → `cubierto`), reglas de tiempo de pedidos en `programar_avisos()`.
- Etapa 7: `sitting_eventos`, `sitting_cierres`, políticas de `comprobantes` para la niñera,
  funciones `ninera_marcar_evento`, `ninera_cerrar_sitting`, `ninera_cargar_gasto`, reglas del
  día en `programar_avisos()`.
- Etapa 8: `fichas_familia`, `ninera_guardar_ficha_familia`, `ninera_ficha_familia`, avisos de
  cambio de horario y cancelación (trigger sobre `sittings_traslados` y `solicitudes`),
  `ninera_responder_cambio`.
- Etapa 9: `ninieras.temporada_lugares jsonb`, `ninera_guardar_temporada`, reglas de temporada en
  `programar_avisos()`.
- Etapa 10: `carsitting_datos` (+ `foto_auto_dentro_ruta`, `foto_auto_fuera_ruta`, rutas en vez
  de URLs públicas para las fotos nuevas, `enviado_en`, `aprobado_en`, `aprobado_por`, `fuente`),
  `ninera_guardar_carsitting`, recordatorio semanal.

Todo `timestamptz`; las fechas y horas de sittings siguen `date` + `time` en hora de Montevideo,
como hoy. Índices nuevos en lo que se filtra seguido: `solicitud_ninieras (ninera_id, estado)`,
`avisos (enviado_en, enviar_desde)`, `avisos (para_ninera_id, creado_en)`,
`chat_mensajes (ninera_id, creado_en)`, `sitting_eventos (sitting_id)`.

## 6. Flujos

### 6.1 Invitar, entrar, instalar (etapa 1)
1. Admin, ficha de la niñera → "Invitar a la app" → link + mensaje de WhatsApp (textos, sección
   2). Si no tiene celular válido, el botón explica qué cargar.
2. Niñera abre `/ninera/?i=<token>`: "Te invitamos a Parents' Break. [nombre], desde ahora los
   pedidos te llegarán por aquí en vez de por WhatsApp." → crea la contraseña (dos veces; "Las
   contraseñas no coinciden") → la Edge Function crea la cuenta → entra sola.
3. Si no está instalada como app: pantalla "Instala la app para recibir los pedidos" con los 4
   pasos de iPhone y la nota de Android (textos, sección 3). Detecta `display-mode: standalone`.
4. "Activa los avisos" → permiso + suscripción push con `user_id`. Si los apaga después: "Avisos
   apagados. No te van a llegar los pedidos. Actívalos en Ajustes." (en el inicio).
5. Inicio: "No tienes pedidos por ahora." Sin conexión: "No pudimos cargar tus pedidos. Revisa tu
   conexión a internet y vuelve a intentar."
`app_activada_en` se guarda en el primer login (desde ahí corre el plazo de la guía).

### 6.2 Perfil (etapa 2)
"Completa esto una sola vez": servicios (Sittings / Carsittings / Ambos → `ninieras.tipo`
'Niñera' / 'Traslados' / 'Ambas'), zonas (casillas con los grupos de `zona_grupos` → se guarda
en `ninieras.zona` con el formato de hoy, nombres separados por "/"), datos bancarios (→
`ninieras.cuenta_bancaria`, mismo formato que la ficha). Editable después desde "Mi perfil".
Marcar Carsittings dispara el aviso "Completa el formulario de carsitting" (etapa 10; hasta
entonces, un texto "pronto vas a poder cargar los datos del auto acá").

### 6.3 Pedido (etapas 5 y 6)
Cambios del 31/10/2026 (Diego), ya construidos en la etapa 5 (02/11/2026; detalle en `plan-implementacion.md`, etapa 5):
- Una sola pantalla: "Elegir niñeras" reemplaza el cuerpo de "Asignar niñera" para toda solicitud; "Asignar" (la asignación
  directa) queda en cada fila, para cualquiera.
- Botones "Puedo" / "No puedo" (no "Acepto"); después de "Puedo", "¡Gracias! Te confirmamos a la brevedad." y el pedido pasa a
  "Esperando confirmación", aparte de "Pedidos por responder". Sin "Aceptar no es quedar seleccionada".
- El precio por hora de cada tildada se puede editar, también el guardado; si cambia sale la casilla de siempre "Guardar como
  precio de [niñera] con esta familia".
- Chicos cargados uno por uno obligatorios para mandar. La dirección se pide con "Guardar" / "Después": la exige la etapa 6, al elegir.
- Etapas 5 y 6 separadas: en la 5 las respuestas se ven en el modal de la solicitud de la Agenda y la elegida se asigna con "Asignar".
  La regla del CV (4, reglas del negocio) y "Mensaje con los perfiles" van en la etapa 6.
- Sin emojis de color en lo que produce el código ("Zona: Pocitos" en vez del pin).
- Hasta la etapa 4 (guía), solo pedidos de práctica (`app_config 'pedidos_app'`, `solo_practica`).
1. Admin, Agenda → "Pegar mensaje de WhatsApp" → textarea ("Pega uno o varios mensajes
   seguidos") → llama a `pedido-whatsapp` (ya publicada; se extiende para devolver `ninera_pedida`
   y para aceptar `familia_id` confirmada). La respuesta se muestra como ticket editable: familia
   (propuesta, "confirmar con un toque"; buscador si no es esa), día, horas (con "aproximada"),
   chicos, zona, precio esperado para la madre, dudas "A confirmar: [dato]". Lo que tiene dudas no
   bloquea el guardado del pedido pero sí el envío a niñeras (hay que resolverlo o marcarlo
   "igual mandar"). Pedidos que son cambio / cancelación / otra cosa: el ticket lo dice y ofrece
   abrir la solicitud existente; no crea una nueva.
2. "Revisar y elegir niñeras": se crea la `solicitud` (estado `sin_asignar`, con `pedido_id`,
   `chicos_texto`, `notas_para_ninera`) y se abre la pantalla de sugeridas. Si a la familia le
   falta la dirección o los chicos, "Falta [dato]" con el campo ahí mismo (guarda en `familias`
   y `hijos_familia`).
3. Sugeridas (orden de `reglas-del-negocio.md`, sección 5, calculado en el panel con datos que la
   admin ya puede leer; función pura `ordenarSugeridas(pedido, datos)` en `js/pedidos.js`, con
   tests propios):
   - Se sacan: inactivas van al fondo; no hace sittings; ya tiene un sitting o fijo que se
     superpone ese día; fuera por temporada (sección 4.5); la guía o la firma la frenan
     (`ninera_puede_recibir_pedidos`, con el plazo).
   - Bloque 1 (ya fue a esa casa): 1) la pidió la madre (`ninera_pedida`), 2) más sittings con
     esa familia (en la fase 1 "mejores comentarios" no se puede calcular: `resenas_ninieras` no
     tiene familia; queda anotado), 3) el resto por cantidad.
   - Bloque 2 (nunca fue, de la zona del pedido): más sittings en general, experiencia con esa
     edad (sittings con familias que tienen hijos de esa edad), si son 3 o más chicos las que
     cuidaron a varios.
   - Bloque 3 (nunca fue, de otra zona): mismo orden.
   - Bajan dentro de su bloque, sin salir: marcó ese día como que no puede (se le manda igual, con
     la marca), 3 o más "No puedo" seguidos, incidente o queja con esa familia, "Prefiero otros
     perfiles" con esa familia, 4 o más sittings esa semana.
   - Familia con `solo_conocidas`: se muestran solo las del bloque 1; si todas dicen que no, un
     botón "Mostrar las que nunca fueron" abre los bloques 2 y 3.
   - Cada fila: nombre, el porqué en una línea, marcas (sin app, sin avisos, guía pendiente, no
     puede ese día, Otro en temporada), casilla si tiene app, botón WhatsApp si no.
   - Botones: "Marcar las 10 primeras", "Ninguna", "Enviar a [cantidad]".
4. Precio: para cada tildada, `precios_ninera_familia`; si no hay fila, una lista "Primera vez de
   [niñera] con esta familia: ¿cuánto cobra por hora?" precargada con el último sitting de esa
   niñera con esa familia (pago / horas, `redondearPago`) o, si no hubo, `familias.pago_hora`.
   Al enviar se guardan las filas nuevas. El precio por hora a la familia es `familias.cobro_hora`
   (no cambia por niñera).
5. "Enviar a N" → `enviar_pedido_app(solicitud_id, [{ninera_id, precio_hora}])`: inserta
   `solicitud_ninieras` (`invitada`, `origen 'app'`, `enviado_en`, `precio_hora`), fija
   `responder_hasta` (ahora + 15 min si el pedido es de hoy, + 30 si no; `app_config
   'pedidos_app'`) y un aviso por niñera (`pedido:<sn>:nuevo`, push "Sitting [dd/mm]" con el
   formato lista de textos, sección 1). Aviso a las otras admins "Pedido nuevo de [madre]
   ([familia])". Todo en una transacción.
6. Niñera: push → tarjeta (textos, sección 4) con "Responde antes de las [hora límite]", Acepto /
   No puedo. Debajo: "Aceptar no es quedar seleccionada...". `responder_pedido(sn_id, 'acepto' |
   'no_puedo', motivo, motivo_texto)` con la condición del estado anterior (regla de dos a la
   vez). Acepto → "¡Gracias! Te avisaremos a la brevedad si quedaste seleccionada." y aviso
   instantáneo a las admins. No puedo → motivo (lista de textos) → "¿Quieres marcar otros días en
   los que no puedes?" → `ninera_no_disponible`. Puede responder después de `responder_hasta`
   mientras el pedido siga abierto (4.11).
7. Admin, Hoy → "Pedidos en curso" (construido el 01/11/2026, etapa 6; una tarjeta por solicitud mandada por la app y
   sin elegida, también en el modal de la solicitud): "Pueden 2, no puede 1, falta responder 1. Mandado a 4 a las
   14:05." y una fila por niñera (Puede / No puede: motivo / Sin responder) con "$250 por hora. Ya fue 5 veces." o
   "Nueva para esta familia.". Sin separadores "·" en ningún texto nuevo (Diego, 01/11/2026). Dos caminos válidos:
   "Asignar" en cada fila que dijo "Puede" (más el atajo "Asignar y confirmar a la madre" si la que pidió la madre
   dijo "Puedo": va primera, "La pidió la madre y puede") o "Perfiles para la madre". Botones: "Preguntar a más
   niñeras" (antes "Mandar a más niñeras"; es "Elegir niñeras"), "Todavía buscando", "No conseguimos" (solo arman
   el mensaje) y "Cancelar el pedido" (condicionado al estado que tenía la pantalla).
   - "Perfiles para la madre" (el CV es un PDF que se arma aparte en Canva; ninguna tiene `cv_url`): las que ya
     fueron a esa casa van tildadas, solo con el nombre; una nueva entra cuando la admin tilda "Revisé su perfil",
     con "(te paso su CV)", y abajo "Adjuntá en WhatsApp el CV de [niñera]." (o, si `cv_generado_en` está vacío,
     "[niñera] todavía no tiene CV: generalo desde su ficha."). La admin adjunta el PDF a mano. "CV automático en el
     sistema" es una tarea aparte, justo después de esta etapa.
   - Nunca confirma sola ninguna niñera (las dueñas, 01/11/2026): elige la madre o una admin y la admin la marca.
8. "Asignar" (decisión técnica 01/11/2026: no hay RPC `elegir_ninera` ni `cerrar_envios_pedido`; son triggers sobre
   las escrituras de siempre, así avisa cualquier camino que asigne o cancele, en la misma transacción y sin cambiar
   la regla de dos admins a la vez). `asignarNineraAlPedido` (agenda.js) es la única asignación: toma la solicitud con
   la condición del estado, la dirección es obligatoria para un sitting (se guarda en `familias` antes), mira la doble
   reserva en la base, escribe la fila de la niñera (la de la app conserva lo ofrecido; la del panel lleva
   `precio_hora` = `redondearPago(pago / horas)`) y el registro con `sittings_traslados.solicitud_id`. El pago se
   precarga con `precio_hora` × horas. Si falla la fila, la solicitud vuelve atrás y no sale ningún aviso; si falla
   el registro, queda asignada y el aviso dice qué faltó. El trigger `solicitud_ninieras_al_confirmar` (fila a
   `confirmada`): a la elegida con app "¡Quedaste seleccionada!" y `seleccionada_en`; las demás filas de la app
   abiertas pasan a `cubierto` y a las que dijeron "Puedo", "Gracias por responder". `solicitudes_al_cancelar`: las
   abiertas pasan a `cancelado` y a las que dijeron "Puedo", "Se canceló el pedido del [día]". Solo sittings; a las que
   no respondieron no les llega nada. `pedido_puede_avisar`: con `solo_practica` prendido, ningún aviso de pedidos a
   una niñera real, aunque se la asigne a mano (familia y niñera de práctica). Después, la confirmación para la
   madre (plantilla `confirmacion`), con "Copiar" y "Abrir WhatsApp"; "Guardar como plantilla" muestra antes cómo
   queda y deja el texto para las tres admins (`app_config 'plantilla_<clave>'`, `valor: {texto}`, el texto por
   defecto vive en el código). Corchetes: `[madre]`, `[día]`, `[hora inicio]`, `[niñeras]`, `[niñera]`, `[cuándo]`.
   Mandar sin abrir WhatsApp depende de la API de Meta: pendiente.
9. Niñera: tarjeta "¡Quedaste seleccionada!" arriba del inicio hasta que toca "Ver los datos" (`seleccionada_en` sin
   `visto_en`, `ninera_marcar_pedido_visto`); abre el detalle de siempre del sitting (también desde "Próximos
   sittings", con título "Sitting"): día, horas, dirección, madre con inicial, chicos, "Indicaciones" (solo
   `notas_para_ninera`, nunca las notas internas), "Precio por hora" y "(aproximada, se puede extender)" solo si
   `solicitudes.horario_aproximado`. "Cómo llegar" deja elegir Google Maps, Waze o Mapas. Las otras: "Este pedido ya se
   cubrió: [día]. Gracias por responder. ¡Te tendremos en cuenta para el próximo!" o "Se canceló el pedido del [día].
   Gracias por responder." una sola vez (hasta `visto_en`). Toda niñera con app que queda asignada a un sitting recibe
   "¡Quedaste seleccionada!", también si la asignaron con "Asignar" sin haber recibido el pedido por la app.
   Pendientes: "Repasa la guía de [edad]" espera la etapa 4 y la ficha de la familia la etapa 8.
Textos de las plantillas "Todavía buscando" y "No conseguimos": botones en la tarjeta de
"Pedidos en curso".

Mensaje con los perfiles (construido el 01/11/2026; los textos de las cuatro plantillas están en `textos-provisorios.md`):
"¡Hola [madre]! Te paso las niñeras disponibles para el [día] a las [hora inicio]:
[niñeras]
Avísame cuál preferís y te la confirmo." Cada plantilla se guarda en `app_config 'plantilla_perfiles'`,
`'plantilla_confirmacion'`, `'plantilla_buscando'` y `'plantilla_no_conseguimos'` (no en una sola fila `plantillas`).

### 6.4 El día (etapa 7)
- Antes: "Estoy saliendo" (evento `saliendo`) / "Voy a llegar tarde" → 10 / 20 / 30 min o más
  (evento `tarde`, minutos) → aviso a admins con "Contactarla" (abre WhatsApp al celular de la
  niñera, que sí ven las admins).
- Al llegar: "Ya entré" (`entre`, hora real) / "Estoy afuera y no me abren" (`no_abren`) / "No
  encuentro la casa" (`no_encuentro`): los dos últimos avisan al instante.
- Si a los 15 minutos del inicio previsto (puntuales, configurable) no marcó "Ya entré": aviso a
  admins "no marcó que llegó" con "Contactarla". Los fijos no disparan este aviso (4.10).
- A la hora de fin prevista: push "¿Ya te retiraste del hogar?"; a los 30 min sin cierre, "Te
  falta cerrar el sitting" con "Se extendió el sitting" (abre el cierre con la hora actual).
- Cierre (`ninera_cerrar_sitting`): "¿Hasta qué hora estuviste?" (hora real, con la diferencia
  con lo previsto, sin montos; si pasa de medianoche, marca "al día siguiente"), "¿Hubo algún
  gasto extra?" (monto + foto del comprobante → `ninera_cargar_gasto`: sube al bucket
  `comprobantes` bajo su carpeta e inserta `gastos_extra` con `pagado_por 'ninera'`; "Te lo
  reintegramos junto al pago" es el único texto permitido sobre reintegro), comentarios extras
  (campo libre → aviso instantáneo a admins), calificación de la familia (1 a 5, ¿volverías?
  Sí / Prefiero otros perfiles, ¿a qué jugaron?, comentarios para el equipo). "¡Gracias,
  [niñera]! Ya quedó registrado." Se guarda en `sitting_cierres` y avisa a admins "[niñera]
  terminó en [familia] a las [hora]".
- Admin, Hoy → "Cierre de los fijos" (existente) pasa a listar también los puntuales con cierre
  de la niñera sin revisar: muestra la hora real que mandó, el gasto (con "Elige quién lo paga")
  y los comentarios; "Sí, terminó" confirma con la hora de la niñera (recalcula cobro y pago con
  la tarifa, los términos y las variantes, como hoy) y marca `revisado_en`; "Otra hora" deja
  corregir. El registro final sigue viviendo en `sittings_traslados`.

### 6.5 Ficha de la familia, cambios y cancelaciones (etapa 8)
- Ficha: los 18 campos y las 6 casillas de la guía original, en `fichas_familia (id, familia_id,
  sitting_id, ninera_id, datos jsonb, creada_en)`. En el sitting del día: "Repásala con los
  padres antes de que se vayan", precargada con la última ficha de esa familia (cualquier
  niñera). La siguiente niñera la ve en "¡Quedaste seleccionada!"; las admins, en la ficha de
  la familia (con "Copiar para la próxima niñera").
- Cambio de horario: cuando una admin cambia `hora_inicio` / `hora_fin` de un sitting futuro de
  una niñera con app (trigger en `sittings_traslados`), aviso "Cambió el horario de tu sitting
  del [día]" con Ok / "A esa hora no puedo" (`ninera_responder_cambio`; "No puedo" avisa a las
  admins "Busca a otra" y deja el registro como está: la admin decide).
- Cancelación (`cancelado = true` o solicitud `cancelada`): aviso "Se canceló tu sitting del
  [día] / Con [madre: nombre + inicial]". Es el único aviso que nombra a la madre.

### 6.6 Temporada (etapa 9)
Detalle y respuestas de Diego del 31/10/2026 en `etapa9-temporada.md`.
- Pantalla por quincena: Punta del Este / Montevideo / La Paloma / Fuera del país / Otro (con texto, hasta 80
  caracteres). De diciembre a marzo (8 quincenas, vacías hasta que las elige) y el resto del año plegado, en
  Montevideo. Atajo "Todo el verano en Punta" (2da de diciembre a 2da de febrero). No se guarda con alguna de
  las 8 vacía.
- Se guarda en `ninieras.temporada_lugares` (`{"0": "montevideo", "8": "punta", "9": {"otro": "texto"}}`) con
  `temporada_lugares_en`, y a la vez se escribe `ninieras.temporada` en el formato de hoy (`{<id grupo
  Punta>: [quincenas en Punta]}`) con `temporada_fuente = 'app'` y `temporada_actualizada_en`: el filtro de
  Niñeras y el panel siguen andando. Las quincenas no tienen año: la temporada empieza el 1/9 a las 0:00 de
  Montevideo (Diego pidió el 1/10; quedó el 1/9 como el panel porque el formulario sale a fin de setiembre), y
  una temporada de un año anterior se ve como "sin temporada cargada" (filtro, ficha y panel).
- El filtro, la ficha y el panel de temporadas leen también los lugares nuevos ("Fuera del país", "Otro" con su
  texto, "La Paloma"). La regla de qué pedidos recibe cada respuesta vive en `app_config 'temporada_reglas'`
  (sección 4.5) y la leen las sugeridas: va en la etapa 5.
- Avisos: primer aviso apenas se publica la etapa (1/10 en adelante, de 9 a 21 h) a las activas con app sin
  la temporada al día; recordatorio cada 15 días desde su primer aviso, hasta el 31/12. Desde 2027, el 1/10 a
  las 9. Los avisos pasan a ser obligatorios al entrar a la app (sin "Ahora no"), para que la app la persiga sola.
- La página actual de temporada (Cloudflare) y `temporada-ninera` siguen como están para las niñeras sin app
  (sección 10).
- A las admins no se les pide nada por las niñeras con app (Diego, 31/10/2026, cambia lo del 27/10): sin paso
  previo al editar, sin "Pedirle por WhatsApp" ("Se la pide la app"), sin badge ni aviso anual por ellas. Para
  las que no tienen app, el paso previo, "Pedirle por WhatsApp" y el aviso anual del 1/10 siguen igual
  (`enviar-push-urgentes` no cambia, no se republica). No se apagan globalmente.
- Va después de la etapa 3 y antes de la 4 (orden del 27/10/2026): necesita la cola de avisos.

### 6.7 Carsitting (etapa 10)
- Una pantalla: los campos de `carsitting_datos` + fotos de licencia, libreta, asientos, auto por
  dentro y por fuera (bucket privado, comprimidas en el celular como las fotos de niñeras).
  "¡Listo! Gracias." Aviso a admins "[niñera] completó el carsitting / Revísalo".
- Admin: "Carsitting para revisar" en Hoy (ver fotos con links firmados, Aprobar / Pedir de
  nuevo con un comentario que le llega por chat). Aprobar → `aprobado_en` y "Ya puedes recibir
  solicitudes de traslados". En Niñeras, panel plegable "Car sitting" con "Completaron / Faltan"
  (de las que hacen traslados) y "Sin app" con el botón de WhatsApp.
- Recordatorio semanal (lunes 10:00) a las que marcaron Carsittings y no completaron.

### 6.8 Chat (etapa 3)
Un hilo por niñera, lo leen y contestan las tres admins (cada mensaje con el nombre de quien lo
escribió). `chat_mensajes (id, ninera_id, de 'ninera' | 'admin', autor text, texto text, creado_en,
leido_ninera_en, leido_admin_en)`. Realtime en las dos puertas (RLS filtra). Push "[nombre de la
admin] / [mensaje]" a la niñera y "[niñera] / [mensaje]" a las admins. En Hoy, "Mensajes de
niñeras" con los no leídos; en la ficha de la niñera, el hilo completo. Niñera: "Contáctate con
una operadora de Parents' Break."

Decisiones de Diego (29/10/2026): (1) una admin puede escribirle a cualquier niñera que tenga la app (la
regla de "solo con un pedido" se lee como "nada de mensajes masivos ni publicidad"); (2) el chat es solo
de texto en esta etapa, las fotos van después; (3) el aviso del chat llega siempre, también de noche.

## 7. Catálogo de avisos (clave, cuándo, a quién, etapa)
Niñera (todos con los textos de `textos.md`, sección 1; cuerpo en "tú"):
| clave | cuándo | etapa |
|---|---|---|
| `pedido:<sn>:nuevo` | al enviar el pedido (inmediato) | 5 |
| `pedido:<sn>:recordatorio` | 10 min antes de `responder_hasta`, si sigue `invitada` (`programar_avisos_pedidos`, cron) | 6 |
| `pedido:<sn>:seleccionada` | al pasar su fila a `confirmada`, trigger `solicitud_ninieras_al_confirmar` (inmediato, url `#pedido/<sn>`) | 6 |
| `pedido:<sn>:cubierto` | a las que dijeron "Puedo" y no fueron elegidas, también si se asignó a mano (mismo trigger, url `#inicio`) | 6 |
| `pedido:<sn>:cancelado` | a las que dijeron "Puedo", si el pedido se cancela (trigger `solicitudes_al_cancelar`, url `#inicio`; 4.19) | 6 |
| `sitting:<id>:24h` / `:1h` | puntuales con niñera con app (no fijos) | 7 |
| `sitting:<id>:fin` | a la hora de fin prevista, sin cierre | 7 |
| `sitting:<id>:fin30` | 30 min después, sin cierre | 7 |
| `sitting:<id>:cambio:<n>` | al cambiar el horario de un sitting futuro | 8 |
| `sitting:<id>:cancelado` | al cancelar | 8 |
| `chat:<msg>` | mensaje de una admin | 3 |
| `carsitting:<ninera>:completar` | al marcar Carsittings en el perfil | 10 |
| `carsitting:<ninera>:semana:<lunes>` | lunes 10:00 si falta | 10 |
| `temporada:<año>:<ninera>` / `:q<n>` | 1/10 9:00 y cada 15 días si no completó | 9 |
| `guia:<ninera>:falta` | al activar la app si la guía frena pedidos (y a mitad del plazo) | 4 |
| `guia:<ninera>:anual:<año>` | al cumplirse el año de la firma | 4 |

Admins (`para_admin = 'todas'`, salvo "pedido nuevo", que va a las otras; textos de la sección
7; tipos nuevos en `notif_push_preferencias` con default activado):
| clave | cuándo | etapa |
|---|---|---|
| `admin:pedido:<sol>:nuevo` | al pegar un pedido | 5 |
| `admin:pedido:<sn>:acepto` | cada "Acepto" (inmediato) | 5 |
| `admin:pedido:<sol>:perfiles` | 15 min (hoy) / 30 min (otro día) después de enviar, si hay al menos una que aceptó y no hay elegida | 6 |
| `admin:pedido:<sol>:nadie` | 30 min después de enviar sin ninguna respuesta | 6 |
| `admin:pedido:<sol>:3h` | pedido de hoy sin elegida (por la app o no, sitting o traslado), 3 h antes del inicio; con `solo_practica` prendido, solo familias de práctica (url `?ir=agenda&solicitud=<id>`) | 6 |
| `admin:sitting:<id>:tarde` | "Voy a llegar tarde" (inmediato, con "Contactarla") | 7 |
| `admin:sitting:<id>:no_llego` | 15 min después del inicio sin "Ya entré" (puntuales) | 7 |
| `admin:sitting:<id>:problema` | no me abren / no encuentro (inmediato) | 7 |
| `admin:sitting:<id>:cerro` | la niñera cerró | 7 |
| `admin:sitting:<id>:gasto` | cargó un gasto | 7 |
| `admin:sitting:<id>:comentario` | comentarios extras | 7 |
| `admin:sitting:<id>:no_puede` | "A esa hora no puedo" | 8 |
| `admin:chat:<msg>` | mensaje de una niñera | 3 |
| `admin:carsitting:<ninera>` | completó el carsitting | 10 |

Los avisos con `url` abren la pantalla correspondiente (`?ir=...` en el panel; `#pedido/<id>`,
`#sitting/<id>` en la app de niñeras). Las reglas de tiempo (minutos y horas) viven en
`app_config 'pedidos_app'` y `'el_dia'`, con los defaults de arriba; sin interfaz para editarlos
en la fase 1 (SQL).

## 8. Guía (etapa 4)
- `ninera/guia/contenido.json`: `{ version, modulos: [{ id, nombre, grupo, edad, obligatorio,
  lecciones: [{ id, titulo, subtitulo, html }], repaso: [{ q, o, a, e }] }] }`. Se arma a partir
  de `guia-original.html` con un script (`scripts/guia-desde-html.mjs`, se corre una vez y queda
  para rearmarla si cambia la fuente): 14 módulos menos "Inicio", "Ficha de la familia" (pasa a
  ser el formulario de la etapa 8) y "Fichas recibidas" (admins); la lección "Higiene y cambio
  de pañales" (`b2`) va en Bebés; los juegos (`.kit`) no se incluyen. Obligatorios: Protocolos
  y RCP y primeros auxilios. El HTML de cada lección es el de la guía (sin scripts ni estilos
  inline); se pinta con `innerHTML` porque es contenido del repo, no de datos.
- Progreso: `guia_progreso (ninera_id, leccion_id, version, leido_en)` (upsert: releer pisa la
  fecha), `guia_repasos (ninera_id, modulo_id, version, aprobado_en)`, `guia_firmas (id,
  ninera_id, version, nombre, firma_ruta, firmado_en)`.
- "Guía completa" = todas las lecciones de los módulos obligatorios con `leido_en` posterior a la
  última firma (o cualquiera si nunca firmó) y los dos repasos aprobados después de esa firma.
  "Firma vigente" = última firma hace menos de 365 días.
- `ninera_puede_recibir_pedidos(p_ninera_id)` devuelve `(puede boolean, motivo text,
  hasta date)`: activa y con cuenta; y (guía completa y firma vigente) o (dentro del plazo:
  `app_activada_en + plazo_dias` para las que tenían sittings antes de activar la app; `hasta`
  es esa fecha) o (firma vencida hace menos de `gracia_anual_dias`). Las sugeridas y
  `enviar_pedido_app` la usan; la app de niñeras muestra el motivo ("Tienes hasta el [fecha]
  para completarla" / "Hasta que lo termines no te llegarán pedidos").
- RCP presencial Sí / No y foto del certificado (opcional) en "Mi perfil" → `ninieras.rcp_presencial`,
  `ninieras.rcp_certificado_ruta`.
- Admin: en la ficha de la niñera, "Guía: completa el [fecha], firmada el [fecha] (v[versión])" o
  qué falta; link firmado a la firma y al certificado.

## 9. Tests
- Simulador (`tests/support/app.js`): `abrirAppNinera(page, { datos, ninera, ruta: '/ninera/',
  ... })` con otro usuario ficticio (`sub` distinto) y la clave de sesión `sb-ninera-auth`. Las
  funciones RPC de la niñera se simulan una sola vez en `tests/support/rpc-ninera.js` (leen el
  `db` ficticio y aplican la misma regla de columnas), y cada test puede pisarlas con
  `estado.rpc`. Las llamadas a `functions/v1/ninera-cuenta` y `enviar-avisos` se simulan como
  hoy las demás.
- Estáticos (`tests/estatico.spec.js` y `fuentes.js`): dos órdenes de carga (panel y niñera),
  globales duplicadas por puerta, handlers inline, emojis y `node --check` sobre `ninera/js/*`
  y `ninera/sw.js`; nombres de funciones repetidos entre `js/comun.js` y el resto.
- Cada etapa: su `tests/ninera-<etapa>.spec.js` y, si toca el panel, `tests/<etapa>.spec.js`,
  con caso feliz, base que falla, sin conexión, doble toque, datos raros, base sin la migración,
  390 px y 1280 px (capturas).
- SQL (PGlite, `scripts/probar-sql.mjs`): cada migración aplica sobre el schema de main, se
  deshace y se vuelve a aplicar; cada función nueva tiene casos; las de lectura de la niñera se
  prueban con `set local role authenticated` y `request.jwt.claims` de una niñera ficticia:
  columnas prohibidas ausentes, 0 filas en lectura directa de tablas compartidas, no puede leer
  lo de otra niñera. Si `probar-sql.mjs` no arma `auth.uid()` o el rol, se le suma.
- `tests/red-plata.spec.js` sigue pasando: la fase 1 no cambia ninguna regla de plata.

## 10. Lo viejo: qué se apaga y cuándo (sin apagar nada todavía)
- PR #63: se mergea en la etapa 0. PR #60: se cierra en la etapa 0 con un comentario que apunta
  a la etapa 10.
- Temporada: la página de Cloudflare, `temporada.html` (redirección), la Edge Function
  `temporada-ninera`, `TEMPORADA_URL` y el mensaje de difusión en `ninieras.js` siguen hasta que
  todas las niñeras activas tengan la app. Recién ahí (PR aparte, con OK): borrar la función, la
  página y el mensaje. El aviso anual "Pedir la temporada de Punta", el paso previo al editar y "Pedirle por
  WhatsApp" se apagan solo para las niñeras con app (etapa 9, Diego, 31/10/2026): a las admins no se les pide
  nada por ellas; las sin app siguen igual. La temporada cargada desde la app y desde la página se guarda en
  el mismo campo (`temporada`); la de la app suma `temporada_lugares`.
- Carsitting: el formulario de Google, el Apps Script, `carsitting-webhook`,
  `carsitting-recordatorio` y `carsitting_mail_enviado_at` siguen hasta que las 20 niñeras que
  hacen traslados tengan la app y hayan cargado el carsitting ahí. Después (PR aparte, con OK):
  borrar las dos funciones y el código del mail; el formulario de Google se cierra desde Google.
- `pedido-whatsapp`: sigue; se extiende en la etapa 5 (republicar con OK).
- `enviar-push-urgentes`: sigue con sus avisos de hoy (sin asignar, sin registrar, CV,
  temporada). Más adelante sus reglas pueden pasar a `programar_avisos()`; no en la fase 1.

## 11. Lo que queda al constructor
- Pantallas de la niñera: diseño dentro del sistema actual (tipografías, colores, botones de
  `index.html`), una sola columna, botones grandes, textos en "tú" de `textos.md`.
- Nombres exactos de columnas, índices y funciones mientras respeten esta sección y las
  convenciones de CLAUDE.md; firmas de las funciones RPC.
- Cómo se arma el `.ics` y el link de "Cómo llegar".
- Cómo se comprimen las fotos (reutilizar lo de fotos de niñeras).
- Detalle de los tests y de las pruebas SQL.
- Orden interno de tareas dentro de cada etapa.
