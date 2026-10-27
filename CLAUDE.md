# Parents Break: sistema operativo

Sistema real de Parents Break (cuidado infantil y traslados, Montevideo). Lo usan todos los
días sus dueñas, Paulina y Delfina. Desarrollador: Diego. Cualquier bug llega a producción y
a las familias y niñeras. Son tres administradoras: Paulina, Delfina y Fede (socia, con cuenta
propia; además hace sittings como niñera).

Antes de empezar cualquier tarea leé "Para qué es esto", "Cómo trabajamos", "Worktrees",
"Datos sensibles" y "Calidad": valen para todas las sesiones y todos los worktrees.

## Para qué es esto
El objetivo es facilitarles la vida a Paulina y Delfina y automatizar todo lo posible. El
sistema empezó como una herramienta para registrar; lo que buscamos ahora es que diga qué
hacer, que haga solo lo repetitivo y que les saque trabajo manual antes de que pase el
sitting. La pregunta guía: si una de ellas se va tres semanas, ¿el negocio sigue con el
sistema o se para?
- En cada tarea, preferí la versión que les ahorra pasos: que se precargue, que se calcule
  sola, que avise a tiempo, que se haga en un toque desde el celular.
- Si ves algo que se podría automatizar o un paso manual que sobra, proponelo en una línea
  al final del reporte. No lo construyas sin el OK de Diego.
- Lo que sale hacia familias o niñeras (mensajes, cobros, recordatorios) pasa por una
  confirmación de ellas, salvo que decidan lo contrario para ese caso puntual.
- Lo usan sobre todo desde el iPhone: pensá cada pantalla primero para el celular.
- Siempre con fondo blanco, nunca modo oscuro (21/10/2026), aunque el celular o la compu estén
  en oscuro: `color-scheme: only light` en `index.html`. Nada de colores para `prefers-color-scheme: dark`.

## Stack
- HTML/CSS/JS vanilla, sin build ni framework. GitHub Pages publica desde `main`.
- `index.html` = head + CSS + `<div id="app">` (con la pantalla de carga inicial) + scripts.
  Todo el HTML de la app lo genera JS. supabase-js se carga de `vendor/`, justo antes de comun.js.
- App de niñeras (fase 1, 26/10/2026): segunda puerta en `ninera/` (`index.html`, `estilos.css`,
  `manifest.json`, `sw.js` con alcance `ninera/`, `js/`). Comparte `js/comun.js` con el panel.
- Supabase (proyecto "Parents-break", ref `wvewzamdohrpfhpccvcz`): Postgres + Auth (contraseña
  y passkeys) + RLS + Realtime + Storage + Edge Functions.
- Acceso (11/10/2026): el registro público está apagado y las políticas RLS solo dejan entrar a
  las cuentas de `usuarias_autorizadas` (activas), con `(select public.es_usuaria_autorizada())`.
  Una política nueva usa eso, nunca "authenticated" a secas. Sumar o sacar a alguien es un
  insert/update en esa tabla (por id, con OK de Diego).
- PWA: `manifest.json` + `sw.js`. El service worker solo maneja push y notificationclick: NO
  hay modo offline (no tiene listener de fetch). Agregar offline es un pendiente aparte.
  En iPhone, la pantalla de inicio de la app instalada son las `splash/*.png` (una por tamaño
  de pantalla, `apple-touch-startup-image`); si cambia el logo, `node scripts/splash-ios.js`.
- Estructura de la base (sin datos): `supabase/schema.sql`. Si un PR cambia la estructura,
  actualizarlo en el mismo PR.

## Scripts y orden de carga (index.html y ninera/index.html)
15 archivos en `js/`: comun → core → auth → app-shell → finanzas → juguetes → agenda → contratos →
marketing → postulantes → ninieras → familias → sittings → intermediaciones → bootstrap
(último).
- `ninera/index.html`: `../vendor/supabase-js` → `../js/comun.js` → `js/base.js` → `cuenta` →
  `perfil` → `inicio` → `arranque` (último). Cada etapa de la fase 1 suma su archivo antes de `arranque.js`.
  `tests/support/fuentes.js` tiene los dos órdenes (`ORDEN_SCRIPTS`, `ORDEN_SCRIPTS_NINERA`).
- `js/comun.js` (26/10/2026): lo que usan las dos puertas, sacado de core.js: `SUPABASE_URL` /
  `SUPABASE_KEY`, escape, fechas (`todayISO()`, `currentMonthStr()`, `sumarDiasISO()`...),
  `normaliza`, `calcularEdad`, `toast`, `conGuardado`, `sbGuardar`, `copiarAlPortapapeles`. El
  cliente `sb` lo crea cada puerta (core.js en el panel).
- Son scripts clásicos, NO `type="module"`: hay ~335 handlers inline (onclick, onchange,
  oninput...) dentro del HTML que arma el JS, y llaman funciones globales por nombre.
- Utilidades que viven fuera de lugar y se usan desde otros archivos: `renderModulo()` y la
  capa Realtime están en `agenda.js`; `shiftMes()` y `monthLabel()` están en `sittings.js`.
  Solo se pueden llamar en tiempo de ejecución, nunca desde el nivel superior de un archivo
  que carga antes.

## Reglas fijas
1. Nunca hacer commit directo a `main`. Cada tarea va en su propio worktree, con una rama
   nueva y su Pull Request (ver "Worktrees"). Cuándo mergeás vos y cuándo espera el OK de
   Diego está en "Cómo trabajamos".
2. No afirmar que algo funciona sin probarlo: `node --check` de cada archivo tocado y, cuando
   aplique, prueba en navegador headless con evidencia (capturas o salida de tests).
3. No agregar emojis nuevos en el código (textos, títulos, mensajes, carteles). Los que ya
   existen, incluidos los de los mensajes de WhatsApp, se quedan por ahora. Los símbolos
   ✕, ✓ y ★ están permitidos. `tests/estatico.spec.js` controla la lista.
4. No convertir los scripts a módulos ni cambiar el orden de carga sin consultar.
5. Si una decisión es de producto o de diseño, preguntar antes de elegir.
6. Nunca usar las cuentas reales de Paulina, Delfina o Fede, tampoco en tests.
7. `temporada.html` está EN USO (formulario de disponibilidad de verano que se manda a las
   niñeras cada octubre): no tocarlo ni romperlo. La página real la sirve Cloudflare, que es
   configuración externa: no auditarla.

## Cómo trabajamos
- Quién decide: Paulina y Delfina son las dueñas y deciden lo de producto (qué se cobra, cómo
  se ve, qué va primero); Fede es administradora pero no decide lo de producto. Diego
  desarrolla, les responde a ellas y es quien habla con vos. A veces te pega mensajes armados
  en otro chat: tratalos igual que si los escribiera él.
- Diego estudia ingeniería y tiene buen criterio, pero no es desarrollador profesional:
  cuando él tenga que hacer algo fuera del código (GitHub, panel de Supabase, Cloudflare,
  instalar algo), dale los pasos numerados y en simple.
- Reporte al terminar una tarea: máximo 10 líneas. Qué hiciste, qué falló o quedó
  pendiente, y qué tiene que decidir o hacer Diego. Sin repetir el diff ni contar cada paso.
  Si el cambio se ve en la app, cerrá el reporte con 1 a 3 líneas para mandarles a Paulina y
  Delfina por WhatsApp: qué cambió y dónde, sin palabras técnicas. Recordales actualizar
  (Cmd+Shift+R en la compu, cerrar y abrir la app en el celular).
- Preguntas: todas juntas y una sola vez, cada una con opciones y tu recomendación primero.
  Si la respuesta no cambia lo que vas a hacer, no preguntes: elegí lo razonable y avisalo.
- Si encontrás un bug o una mejora fuera de la tarea, anotalo en el reporte y no lo
  arregles en el mismo PR, salvo que sea chico y del mismo archivo y tema.
- Pruebas: en tu entorno corré los tests de lo que tocaste (`npx playwright test
  tests/<archivo>.spec.js`) y `npm run test:static`. El resto lo corre el CI en el PR.
- No releas archivos grandes enteros (sittings.js, finanzas.js, agenda.js, core.js): buscá
  la función con grep y leé ese tramo.
- Merge del PR: siempre con "merge commit" (no "squash" ni "rebase and merge"):
  - Lo mergeás vos cuando el CI queda en verde, si el PR solo cambia código, tests o docs.
  - Espera el OK explícito de Diego si lleva una migración, escribe datos en producción,
    publica o cambia una Edge Function, o toca secretos o permisos (RLS, storage).
- Las confirmaciones del conector de Supabase (DELETE, migraciones con DROP) le aparecen a
  Diego en pantalla y vencen en ~60 segundos: avisale justo antes de lanzarlas para que esté
  mirando. Si se cancela o vence, no reintentes en loop: pasale el SQL exacto para que lo
  corra él en el SQL Editor, y después verificá el resultado con una consulta de lectura.

## Worktrees
Forma de trabajo desde el 20/10/2026:
- Diego trabaja en el worktree principal (`main`), una tarea por vez, un chat por tarea. No
  crea worktrees aparte salvo que lo pida.
- Al empezar: actualizá main (`git pull`), creá la rama de la tarea y explicale a Diego en 3 a
  5 líneas simples qué vas a hacer, qué archivos tocás y si hay algo en producción. Esperá su OK.
- Al terminar: después del merge, volvé a main, actualizalo y cerrá con "Listo, mergeado" más
  el reporte de 10 líneas.

Si Diego pide trabajar con worktrees aparte (a veces con otra sesión tuya en paralelo en otro
worktree), la regla es: **un worktree = una tarea = una rama = un PR**.
- Al empezar: confirmá en qué rama estás (`git status`) y que salga del `main` actualizado
  (`git fetch origin` y, si está atrás, `git rebase origin/main` antes de tocar nada). Si el
  worktree está en `main`, creá la rama de la tarea antes del primer cambio.
- Nombre de la rama: `claude/<tarea-corta>` en minúsculas y con guiones (por ejemplo
  `claude/gastos-total`). Es la convención de todos los PRs anteriores.
- No uses una rama ya mergeada para una tarea nueva, aunque el worktree siga abierto: rama
  nueva desde `origin/main`.
- Trabajá solo dentro de tu worktree. No edites, borres ni hagas checkout en las carpetas de
  otros worktrees.
- Archivos compartidos: antes de cambiar `comun.js`, `core.js`, `sittings.js`, `finanzas.js`,
  `agenda.js`, `index.html`, `supabase/schema.sql` o este `CLAUDE.md`, mirá si hay otro PR
  abierto que los toque (`gh pr list` y `gh pr diff <n> --name-only`; si no tenés `gh`,
  `git fetch origin` y `git diff --name-only origin/main...origin/<rama>` para cada rama
  abierta). Si lo hay, avisale a Diego antes de seguir: dos tareas en paralelo sobre el
  mismo archivo terminan en conflicto.
- Tests con otro worktree trabajando (21/10/2026): Playwright reutiliza el servidor que ya esté
  en el puerto 4173, aunque sea el de otro worktree, y prueba el código de esa carpeta (o se corta
  a la mitad si el otro lo apaga). Corré con un puerto propio: `PUERTO_TESTS=4191 npx playwright test`.
- Migraciones en paralelo: el nombre lleva la fecha y una descripción única, así dos worktrees
  no generan el mismo archivo. Si al rebasar choca `schema.sql`, resolvelo vos dejando los dos
  cambios, y volvé a probar la migración.
- Antes de mergear, rebasá tu rama sobre `origin/main` si `main` avanzó, y esperá el CI de
  nuevo. Nunca `push --force` a `main`; en tu propia rama, solo `--force-with-lease`.
- Sesión larga: si la conversación se alarga o Diego abre un chat nuevo en el mismo worktree,
  el estado de la tarea tiene que estar en la descripción del PR (qué está hecho, qué falta,
  decisiones tomadas), no solo en la conversación. Actualizala cada vez que cerrás un tramo.
- Al terminar (PR mergeado): decile a Diego que ese worktree ya se puede borrar.
- Si aprendés algo que vale para todas las tareas (una regla, una trampa del código), sumalo
  a este archivo en el mismo PR, en la sección que corresponda y en pocas líneas.

## Datos sensibles
El repo es público: lo que entra al repo lo puede leer cualquiera.
- Nunca van al repo (código, tests, comentarios, commits, descripción del PR, este archivo):
  claves, tokens, secretos de webhook, cadenas de conexión, números de cuenta, mails,
  teléfonos, ni nombres o montos reales de familias, niñeras o candidatas.
- Dónde viven los secretos: Supabase (Edge Functions > Secrets, y la tabla `app_secrets`),
  los secrets de GitHub Actions del repo de backups, y datos de la empresa en `app_config`
  (por ejemplo la cuenta para transferir del PDF, 'cuenta_cobro'). El código los lee de ahí.
- Si para una tarea necesitás un dato sensible (un secreto, una cuenta, un dato personal
  real), frená y pedíselo a Diego diciendo cuál y para qué. Él decide cómo dártelo: lo carga
  él donde corresponde, o te lo pasa para que lo guardes directo en la base o en un secreto.
  Nunca lo escribas en un archivo del repo, ni de forma temporal.
- Archivos locales con datos reales (extractos, exportaciones, `.env`): solo en una carpeta
  fuera del repo o en una ignorada por `.gitignore`. Antes de cada commit revisá `git status`
  y `git diff --cached`.
- En tus reportes a Diego podés nombrar familias y niñeras (el chat no es público), pero si
  una herramienta te muestra un secreto, no lo copies al reporte.

## Base de producción
- **Esto es producción.** En la base real nunca se escriben datos de prueba: los tests corren
  solo contra el simulador.
- **El repo es público** (GitHub Pages publica desde `main`). En el repo, los tests, los
  comentarios, los commits y las descripciones de PR no van nombres, ids, cuentas,
  teléfonos ni montos reales de familias, niñeras o candidatas. Los datos de los tests son
  inventados ("Familia Prueba Uno", "Ana Ficticia", cuentas 0001234567...). Los extractos
  bancarios reales se usan solo en una carpeta temporal y nunca se commitean, ni recortados.
  Una migración que necesita tocar filas puntuales las nombra solo por id.
- Datos de práctica (26/10/2026): para probar la app de niñeras en producción una admin carga filas
  reales con "(práctica)" en el nombre (una niñera con el celular de Diego, una familia inventada).
  Un pedido de práctica se manda solo a la niñera de práctica (la pantalla avisa si hay una real
  tildada); sus sittings nunca se marcan cobrados ni pagados; al terminar la prueba Diego las borra
  con respaldo previo y su OK (`docs/fase1/decisiones.md` 4.17).
- Para diagnosticar se pueden LEER datos de producción (solo lectura).
- Escribir en producción solo para corregir datos rotos por un bug, y nunca desde tests:
  1. Primero mostrarle a Diego las filas afectadas, cómo quedan antes y después, y el SQL
     exacto.
  2. Antes de modificar, guardar una copia de esas filas (tabla de respaldo o archivo).
  3. Ejecutar recién cuando Diego diga OK explícitamente.
- Los cambios de estructura (migraciones) también se proponen primero y se aplican con OK.
  Van en `supabase/migraciones/AAAAMMDD_descripcion.sql` (en una transacción, con respaldo
  previo y compatibles con la app que está publicada), junto a un `..._DESHACER.sql`, y se
  reflejan en `supabase/schema.sql`. Se prueban antes en un Postgres local.

## Tests
```bash
npm ci
npx playwright install chromium   # una vez
npm test                          # todo
npm run test:static               # solo los chequeos estáticos (segundos)
```
- `tests/estatico.spec.js`: `node --check`, orden de scripts de las dos puertas, globales duplicadas, emojis,
  redirección de temporada.html.
- `tests/humo.spec.js`: Chromium headless; login, todos los módulos, modales, formularios
  principales (verifica lo que se manda a la base).
- `tests/fijos.spec.js`: vigencia de los fijos, cambio de niñera desde una fecha, registros
  vinculados a la asignación, historial de sittings, app nueva con base sin migrar.
- `tests/fechas.spec.js`: "hoy" a las 22:30, fin de mes y de año, semanas que cruzan de mes,
  celular con otra zona horaria.
- `tests/finanzas.spec.js`: resumen del mes (facturado, cobrado, por cobrar, por pagar,
  resultado).
- `tests/guardados.spec.js`: doble toque, base que falla o sin conexión, cerrar el modal a mitad
  del guardado, terminar un fijo desde una fecha.
- `tests/red-plata.spec.js`: red de plata del rediseño (21/10/2026): con una semilla fija compara la
  app con el oráculo (`tests/support/oraculo-plata.js`, copia congelada de las funciones de plata) y
  con la regla escrita: ~2.000 horarios (con barridos minuto a minuto), 1.600 montos y precios, 400
  meses de resumen y 400 bases chicas de Por cobrar / Por pagar en miércoles, sábado, domingo y lunes,
  60 pantallas de Finanzas, 400 cobros parciales (lo tildado con saldo y "¿Cuánto pagó?" contra probar
  todas las combinaciones) y 600 casos de variantes de precio. La base, contra el mismo oráculo: `supabase/pruebas/paridad_plata.sql`
  (2.880 minutos, 800 montos, 450 días de fijos, 300 precios de `precio_sitting` y 400 de
  `precio_con_variantes`; Postgres local).
- `supabase/pruebas/pedidos_whatsapp.sql`: la tabla del pedido desde WhatsApp (estados, límites,
  política), `precio_sitting()` con casos a mano y el tope diario (`reservar_llamada_pedido`: la
  101 no pasa, lo de ayer no cuenta). `supabase/functions/pedido-whatsapp/ticket_test.ts`: la Edge
  Function con el modelo simulado, tope y techo de tokens incluidos (Deno, desde una copia fuera
  del repo: `npx deno@2 test --allow-env <copia>/pedido-whatsapp/`).
- `tests/errores-plata.spec.js`: errores de plata de la auditoría del 21/10/2026: "Termina al día
  siguiente" mal marcado (Sittings, Agenda, día de un fijo y reemplazo), editar un movimiento sin
  pisar cobrado / pagado de la otra, asignar un pedido que ya asignó otra o cuando falla guardar,
  pedido sin hora de fin (sin total, registro en $0, traslados con su cobro) y precio puesto a mano
  que no se pisa al tocar la hora.
- `tests/pagos.spec.js`: confirmación al marcar pagado y Por pagar sin sittings futuros.
- `tests/tarjetas-pendientes.spec.js`: una tarjeta por familia que cobra "diario", registro con solo el
  nombre, botones cerrada / abierta con el monto, "¿Cuánto pagó?" en todos los días, gasto debajo de su
  sitting y saldo al final, Por pagar con semanas y puntuales, y capturas a 390 y 1280 px.
- `tests/variantes-precio.spec.js`: variantes de precio (ajuste libre con motivo, "Guardar como botón", varias a
  la vez, editar con la base, variante borrada que el registro conserva, ficha: ver / editar / borrar / programar,
  fijo que cambia de niñera, Cierre de los fijos, Por cobrar / Por pagar y PDF, base sin migrar, escape, 390 y
  1280 px). En la base: `supabase/pruebas/variantes_precio.sql` (la regla, la tabla y las programadas en la carga).
- `tests/cobro-parcial.spec.js`: marcar solo una parte en Por cobrar / Por pagar (1 de 3, "¿Cuánto
  pagó?" exacto y sin combinación, gasto extra con su sitting, saldo a favor, "Deshacer", Realtime con
  el detalle abierto, fallas, escape y 390 px).
- `tests/por-pagar-en-curso.spec.js`: semana en curso de las fijas en Por pagar (cuándo cierra,
  sin botón, fija con finde, saldo a favor, 390px) y el pago el mismo día que cierra: sábado
  desde temprano, sábado después del último fijo, fijo que pasa la medianoche, día registrado
  más largo, día sin registrar, resumen del mes, aparato en otra zona horaria, lo del domingo (fijo
  o puntual) pagado ese domingo y el margen un sábado.
- `tests/arranque.spec.js`: pantalla de carga (símbolo latiendo), error si no carga supabase-js,
  "Entrando…", carga entre el login y Hoy, símbolo chico al cambiar de sección (> 300 ms).
- `tests/alta-ninera.spec.js`: alta de niñera con nombre y celular (solo el nombre si hace traslados).
- `tests/celular-ninera.spec.js`: celular obligatorio de la niñera en el alta y al editar (salvo tipo
  'Traslados'), celular mal escrito, se guarda como se escribió, niñera vieja sin celular, la regla
  caso por caso (`problemaCelularNinera`) y 390 px.
- `tests/familia-desde-registro.spec.js`: familia nueva desde el registro de un sitting (ficha ahí mismo sin
  perder lo cargado, precio con su tarifa, base que falla, doble toque, nombre parecido, sin términos, 390 px).
- `tests/escape.spec.js`: todos los campos de texto con datos tramposos (comillas, HTML, URLs
  `javascript:`) en cada módulo y ficha; nada se ejecuta y los handlers siguen válidos.
- `tests/gastos-total.spec.js`: "Traslado $X + gastos $Y = $Z" en el registro y en Sittings,
  editar un gasto cargado, gasto que absorbe Parents Break, fijos que no se crean incompletos
  ni repetidos, y precio de un día de traslado fijo.
- `tests/mejoras-hoy.spec.js`: en Hoy, aviso si la carga de fijos de las 03:00 no anduvo y
  "Datos que faltan"; fotos más livianas al subirlas.
- `tests/entrevista.spec.js`: bloques del formulario en la entrevista y datos corregidos en la
  ficha de la niñera.
- `tests/entrevista-sin-perdidas.spec.js`: lo escrito en la entrevista vuelve después de recargar,
  cerrar y abrir la pestaña, quedarse sin internet, sesión cerrada, "Actualizar", cambiar de pestaña
  o de sección y Realtime; el borrador (seguir, descartar, no pisarlo, se borra al guardar) y
  "Vaciar"; fichas y registro de sitting que preguntan antes de cerrar y se recuperan al recargar.
- `tests/borrador-en-base.spec.js`: la copia del borrador de la entrevista en la base (al salir de
  un campo, cada 5 s como mucho, desde otro dispositivo, el más nuevo gana, se borra al guardar,
  base sin la tabla y base que falla). En la base: `supabase/pruebas/borradores.sql`.
- `tests/entrevista-en-curso.spec.js`: guardar la entrevista a medias, retomarla desde
  Candidatas guardadas o desde la candidata, completarla en la misma fila, base sin migrar.
- `tests/sin-aviso-itau.spec.js`: sin aviso del extracto (Finanzas, campanita, puntito y preferencias)
  hasta el lector de Mercado Pago; la conciliación sigue a mano.
- `tests/conciliacion.spec.js`: conciliación con el extracto (tildadas, dudosas, confirmar) y
  lectores por formato. Los extractos de los tests son inventados: nunca uno real, ni recortado.
- `tests/exploratorio.spec.js`: punta a punta, celular 390px, datos raros, base vacía, navegar
  rápido, dos usuarias a la vez (Realtime simulado: `estado.emitirRealtime`), totales.
- `tests/fijos-automaticos.spec.js`: previstos solo en la Agenda, cambios de un día sobre el
  previsto, cambios del fijo que recalculan, pausas, revisión en Hoy, Finanzas sin previstos, y
  todo apagado sin la marca. La función de la base se prueba aparte en Postgres local:
  `supabase/pruebas/fijos_automaticos.sql` y, con el "hoy" fijado a mano (fin de mes y de
  año, pausas entre semanas, cambios desde una fecha), `fijos_automaticos_bordes.sql`
  (nunca en producción). Si no hay Postgres instalado: PGlite, con `scripts/probar-sql.mjs`
  (instrucciones adentro): `PGLITE_DIR=<carpeta con pglite> node scripts/probar-sql.mjs
  supabase/pruebas/*.sql`. Arma lo mínimo de Supabase de mentira y una base nueva por archivo;
  con `--schema` y `--migracion` prueba una migración sobre el schema de main.
- `tests/saldo.spec.js`: saldo a favor (ajustes) en Por pagar / Por cobrar, al marcar pagado o
  cobrado, en la ficha, en el PDF y con la base sin la tabla.
- `tests/gastos-extra.spec.js`: gastos extra con ticket en el formulario, en Por cobrar / Por
  pagar (cobrar y reintegrar), saldo a favor si lo pagó la familia, PDF y base sin la tabla.
- `tests/revisar-meses.spec.js`: Finanzas → Revisar meses (sospechas de la app y del histórico,
  Revisado, editar sittings, gastos extra, gastos generales y saldos, historial, base sin migrar).
- `tests/intermediaciones.spec.js`: colocación de Enrique con una persona externa (sin
  `ninera_id`) o con una niñera de la lista, errores, doble toque, historial y ficha.
- `tests/finanzas-arreglos.spec.js`: copiar cuenta y monto en Por pagar, "Falta la cuenta", resumen
  sin semanas en curso y con meses anteriores, puntito rojo por eventos, error y Reintentar.
- `tests/intermediaciones-lista.spec.js`: Intermediaciones en una pantalla (lista con tipo, fecha, monto y
  cobrada / pendiente, chips, "+ Nueva" en un modal, base que falla, "Niñeras de Enrique" plegable, 390 y 1280 px).
- `tests/intermediaciones-finanzas.spec.js`: intermediaciones en el resumen del mes, el balance,
  Movimientos y Por cobrar / Por pagar (confirmación, ya marcado, falla, doble toque, escape, 390px).
- `tests/terminos.spec.js`: términos y condiciones: casilla en la ficha y en el alta, bordes del redondeo
  (17:05, 17:06, 17:35, 17:36, medianoche), registro, Agenda, historial y PDF, base sin migrar.
  En la base: `supabase/pruebas/terminos_redondeo.sql`.
- `tests/redondeo-montos.spec.js`: montos sin centavos (,4 ,5 ,6 y enteros para el pago y el cobro)
  en el registro, la Agenda, Por pagar / Por cobrar, "Copiar monto", saldo a favor, PDF y montos
  tipeados a mano. En la
  base: `supabase/pruebas/redondeo_montos.sql`.
- `tests/filtro-punta.spec.js`: filtro de Niñeras por Punta del Este y por meses (vive en Punta sin
  temporada, temporada por quincenas, "Dijo que no va", Montevideo sin temporada aparte, la zona
  escrita en el buscador, 390 px).
- `tests/modo-claro.spec.js`: con el aparato en modo oscuro, Hoy, Postulantes y Finanzas se ven claros.
- `tests/cierre-fijos.spec.js`: "Cierre de los fijos" en Hoy (Sí, terminó / Otra hora con entrada y fin que
  recalcula con la tarifa y los términos, medianoche, ya cobrado, otra admin, base que falla, traslado, 390 px).
- `tests/ninieras-lista.spec.js`: lista de Niñeras por fecha de entrevista (sin entrevista al
  final), sittings y traslados de cada una en su fila, una sola fecha de nacimiento al editar.
- `tests/parpadeo-ninieras.spec.js`: guardar en Niñeras repinta Utilización y Temporadas a lo sumo
  una vez aunque vuelva el eco por Realtime (y no vuelve a armar el gráfico si el panel no cambió),
  un cambio de otra admin después sí se refleja, y la base que falla al recargar (aviso, sin loop).
- `tests/precio-a-mano.spec.js`: precio puesto a mano con motivo en el registro (pide el motivo, lo
  conserva, "Usar estos montos" lo saca, editar lo muestra, base sin migrar) y en "Editar
  movimiento"; "Revisar meses" no marca los que tienen motivo. En la base: `supabase/pruebas/precio_a_mano.sql`.
- `tests/precio-a-mano-horario.spec.js`: cambio de horario con precio a mano ("Usar el nuevo monto ($X)" /
  "Mantener el precio a mano", sin elegir no guarda), casillas de 24 px en el celular y el texto de los
  botones de confirmar ("Sí, no fue", "Quitar la pausa").
- `tests/busquedas-entrevisto.spec.js`: "Entrevistó" con el nombre de la cuenta, editable y con los ya usados
  (entrevistas viejas intactas, borrador); los buscadores de "+ Asignar niñera" (ficha de la familia) y del
  nombre en Contratos con el autocompletar de la app (sin tildes, id de la niñera, 390 px).
- `tests/solicitud-un-paso.spec.js`: "+ Nueva solicitud" con niñera opcional y los dos precios por hora
  (precargados, cambiados a mano, sin hora de fin, traslado por viaje, lista según el tipo, fallas al
  cargar la niñera o el registro, doble reserva, doble toque, 390 px) y el pago por hora en las tarjetas.
- `tests/ninera-cuenta.spec.js`: puerta de niñeras (`ninera/`): el simulador, invitación (bienvenida,
  errores de la función, link para cambiar la contraseña), login con el celular escrito de cualquier
  forma, instalar, avisos, inicio vacío, sesiones separadas de las dos puertas, cuenta inactiva, que
  no se vean montos, 390 y 1280 px.
- `tests/invitar-app.spec.js`: ficha de la niñera: "Invitar a la app" (link y mensaje, link vigente,
  errores, doble toque), estado de la app, link para cambiar la contraseña, aviso de celular cambiado
  y login del panel con una cuenta de niñera o sin acceso.
- `tests/ninera-perfil.spec.js`: "Completa esto una sola vez" y "Mi perfil" de la app de niñeras (servicios,
  zonas, datos bancarios, foto opcional solo JPG / PNG / WEBP, fallas al subir o guardar sin perder lo
  escrito, base sin migrar, sin montos, 390 px).
- `tests/ninera-sittings.spec.js`: "Próximos sittings" en el inicio de la niñera (sin montos, dirección solo
  confirmado, "Cómo llegar", `.ics`, sitting que cruza la medianoche, familia sin hijos cargados, base sin migrar).
- `tests/foto-propuesta.spec.js`: ficha de la niñera en el panel: "Perfil completado en la app", foto
  propuesta con "Usar como foto del CV" / "Descartar" (condicionados a `foto_propuesta_en`, fallas, 390 px).
- `supabase/pruebas/fase1_perfil.sql`: las 4 funciones de la etapa 2 como niñera (sin columnas prohibidas,
  dirección solo confirmada, tope de 10 cuentas), `madre_nombre_inicial`, `chicos_texto`, el bucket
  `ninieras-privado` (solo `fotos/<su id>/propuesta.jpg`; otro nombre, otra carpeta o ruta ajena
  rechazados) e ida y vuelta de la migración.
- `supabase/pruebas/fase1_cuentas_ninieras.sql`: celular normalizado y mail sintético, invitaciones
  (solo la última sirve, una vez), `ninera_actual()` (una admin nunca es niñera), RLS y push como
  niñera, `generar_previstos_fijos` solo para admins y el cron, e ida y vuelta de la migración
  (aplicar, deshacer, aplicar). `supabase/pruebas/catalogo_seguridad.sql`: la lista permitida de
  funciones `security definer` que pueden ejecutar `authenticated` y `anon`.
- `tests/regresiones.spec.js`: bugs conocidos. Los que tienen `test.fail()` todavía no están
  arreglados; cuando el arreglo se mergea, el test empieza a pasar y hay que sacarle la marca.
- Supabase está simulado en `tests/support/app.js` con datos ficticios (`tests/support/datos.js`).
  Ningún test llega a la base real: un pedido sin simular hace fallar el test.
  `abrirAppNinera(page, { datos, ninera, sesion, instalada, consulta, funciones })` abre `ninera/`
  con una niñera ficticia (su sesión bajo `sb-ninera-auth`); `estado.funciones[nombre]` simula una
  Edge Function por nombre; las RPC de la niñera se simulan en `tests/support/rpc-ninera.js`
  (`errorRpc(msg)` responde como Supabase, 400 P0001). `abrirAppNinera(..., { baseSinMigrar })`
  simula la base sin la migración de la etapa 2 (las RPC dan 404 `PGRST202`); `e.fallar` y
  `demoraEscrituras` también valen para RPC y storage.
- `scripts/probar-sql.mjs` (26/10/2026): `--migracion` se puede repetir (aplicar → deshacer →
  aplicar) y una prueba "es" una cuenta con `set local role authenticated` y
  `set local request.jwt.claims` (de ahí salen `auth.uid()`, `auth.jwt()` y `auth.email()`).
- supabase-js 2.117.2 está en el repo (`vendor/`, desde el 05/10/2026): la app y los tests lo
  cargan de ahí, sin CDN. `tests/estatico.spec.js` controla la versión y el sha256.
- El CI corre todo en cada PR (`.github/workflows/tests.yml`).
- Más adelante: tests de integración contra un proyecto de Supabase gratis aparte (nunca
  producción).

## Calidad: cada cambio, bien hecho y probado
Antes de abrir el PR, cada tarea tiene que cumplir esto. Si algo no se pudo, decilo en el
reporte.
- Tests: todo cambio de comportamiento lleva su test en `tests/` (contra el simulador). No
  alcanza con el caso feliz: probá también los fallos (la base devuelve error, sin conexión,
  doble toque, datos vacíos o raros, base sin la migración nueva, celular de 390px) y que el
  usuario vea un aviso claro y no un éxito falso.
- Bug arreglado: primero un test que lo reproduce y falla, después el arreglo.
- Plata (21/10/2026): todo cambio que toque un cálculo de plata pasa `tests/red-plata.spec.js`. Si la
  regla cambia a propósito, en el mismo PR se vuelve a congelar el oráculo (`node
  scripts/congelar-oraculo-plata.js`) y la prueba SQL (`node scripts/paridad-plata-sql.js`), y la
  descripción del PR lo dice. Una función de plata nueva se suma a la lista del script del oráculo.
- Consultas a la base, lo más livianas posible:
  - pedí solo las columnas que usás (nada de `select('*')` en tablas grandes) y filtrá en
    la base (fecha, familia, estado), no en el navegador;
  - nunca una consulta por fila dentro de un loop: traé todo junto (`.in(...)`) o con un
    join, y las consultas independientes en paralelo (`Promise.all`);
  - si una consulta nueva filtra u ordena por una columna sin índice en una tabla que crece
    (sittings_traslados, sittings_historial, candidatas, gastos_extra), proponé el índice en
    una migración;
  - en políticas RLS y funciones, `(select ...)` para que no se evalúe fila por fila;
  - si cambiaste estructura o consultas pesadas, mirá los avisos de rendimiento y seguridad
    de Supabase (advisors) y contá en el reporte si apareció algo nuevo.
- Velocidad: que la pantalla muestre algo enseguida y no espere datos que no necesita. Si una
  vista tarda más de un segundo con datos reales, investigá por qué antes de dar la tarea por
  terminada.
- Antes del PR, releé tu propio diff completo como si fueras otra persona revisándolo: la
  solución más simple que resuelve el problema, sin código duplicado (si ya existe una
  función en core.js que lo hace, usala), sin restos de pruebas, con nombres claros y
  comentarios que expliquen el porqué.
- Si encontrás una forma claramente mejor de hacer lo que se pidió, proponela en una línea
  antes de construir la otra.

## Edge Functions
- El código está en `supabase/functions/<nombre>/` desde el 06/10/2026. Todas con
  verify_jwt = false. Se publican con el OK de Diego y el repo tiene que quedar igual a lo
  publicado.
- Los webhooks de formularios piden `x-webhook-secret` (WEBHOOK_SECRET), enviar-push-urgentes
  pide `x-cron-secret` (app_secrets 'cron_push_secret', lo manda el cron) y whatsapp-webhook
  verifica la firma de Meta (WHATSAPP_APP_SECRET).
- Para revisarlas: `npx deno@2 check` desde una carpeta fuera del repo (el package.json de la
  raíz confunde a Deno).
- pedido-whatsapp (21/10/2026) es la primera que llama la app: valida adentro la sesión de la
  admin y `es_usuaria_autorizada()` (sin eso, 401/403), responde CORS solo a la app publicada
  (`ORIGENES_PERMITIDOS` si cambia el dominio) y usa `ANTHROPIC_API_KEY` (Secrets) con
  `claude-haiku-5-5`. La lógica va en `ticket.ts`, sin red, para poder probarla con el modelo
  simulado; `index.ts` solo conecta la base y la API. Frenos de gasto: 100 llamadas por día entre
  todas las cuentas, pruebas incluidas (`pedidos_whatsapp_uso` + `reservar_llamada_pedido()`;
  al llegar, "Llegaste al máximo de pedidos de hoy, avisale a Diego") y `max_tokens` 4.000 (lo
  que piensa el modelo cuenta; el peor caso medido fue 2.109). Para probar la publicada sin la
  cuenta de nadie: `net.http_post` desde el SQL Editor con `x-cron-secret` (app_secrets
  'cron_push_secret') y `probar: true` (no guarda nada; con esa clave no se puede sin probar);
  la respuesta queda en `net._http_response`. Solo mensajes inventados.
- `ninera-cuenta` (26/10/2026): pública por diseño (verify_jwt = false, el token del link es la
  credencial), CORS solo al origen publicado. `POST {token}` → bienvenida (nombre, celular
  enmascarado, `es_reset`); `POST {token, password}` → crea o resetea la cuenta con la clave de
  servicio y la vincula. Errores: 400 `token`, 404 `no_existe`, 410 `vencido`, 403 `inactiva`, 400
  `password_corta` (también si Auth no acepta la contraseña, `weak_password`), 409
  `celular_invalido`. Si vincular la cuenta nueva falla, la borra de Auth (sin huérfanas) y da 500.
  Nunca devuelve el celular entero ni loguea la contraseña. La lógica en `cuenta.ts`, con tests de
  Deno (`cuenta_test.ts`).
- `enviar-push-urgentes` V11 (26/10/2026) manda solo a `push_subscriptions` con `user_id` nulo
  (admins). Se publica después de la migración `cuentas_ninieras` y antes de `ninera-cuenta`.

## Convenciones
- UI y comentarios en español rioplatense (voseo). Los comentarios explican el porqué y
  fechan los incidentes reales; mantener ese estilo.
- Todo texto que venga de datos (nombres, notas, URLs) y vaya a innerHTML o a un handler
  inline se tiene que escapar. Las candidatas llegan desde un formulario público.
- Fechas: Montevideo es UTC-3. "Hoy" sale siempre de `todayISO()` (comun.js, fijado a
  America/Montevideo aunque el celular tenga otra zona). Nunca `toISOString().slice(0,10)`
  para una fecha: es UTC y de 21:00 a 24:00 ya da mañana. Para sumar días a "AAAA-MM-DD",
  `sumarDiasISO()`; para el mes siguiente, `shiftMes()`.
- Guardados: usar `sbGuardar()` o chequear `error`; nunca mostrar éxito sin verificarlo (si
  un paso secundario falla, el aviso dice qué faltó). Todo botón que escribe en la base va
  con `conGuardado(this, ()=>guardarX())` (comun.js): deshabilitado y con ruedita mientras
  guarda, sin doble insert por doble toque. Lo controla `tests/estatico.spec.js`.
- Lo que dos admins pueden cambiar a la vez (21/10/2026): el estado de un pedido y las marcas de
  cobrado / pagado se escriben con la condición del valor que tenían al abrir (`.eq(campo, antes)`
  y `.select('id')`); si no se actualizó ninguna fila, se avisa que lo cambió alguien más y no se
  guarda nada. Modelo: `marcarGrupoResuelto`, `guardarMovimientoSitting`, `guardarAsignacionDirecta`.
- "Termina al día siguiente" (21/10/2026): con la casilla, el fin va antes que el inicio (o igual:
  24 h). Si no, `cruceMedianocheMalMarcado()` (core.js) avisa y no deja guardar, y `horasSitting()`
  devuelve null; antes se sumaban 24 h y se cobraban 26 horas.
- Precio a mano con motivo (21/10/2026): si el precio de un sitting no es el de la tarifa, el
  registro pide por qué (`precio_motivo`: descuento, extra, sin_servicio, otro); "Editar
  movimiento" lo pide si se cambia el monto. Sin la columna se guarda igual y se avisa
  (`esFaltaColumnaMotivo`). "Revisar meses" no marca como sospechoso lo que tiene motivo.
- Precio de un sitting (21/10/2026): lo tipeado a mano no se pisa al cambiar la hora o la familia;
  se muestra el calculado con "Usar estos montos" (`precioSegunHorario`, sittings.js). Al editar,
  un precio igual a horas × tarifa se sigue recalculando. Un pedido sin hora de fin no tiene total
  (`cobro_familia` vacío) y su registro va en $0 hasta que se carga la hora de fin. Al cambiar el
  horario o la familia con un precio a mano, primero se elige (25/10/2026): "Usar el nuevo monto ($X)"
  (aplica cobro y pago y saca la marca) o "Mantener el precio a mano" (recién ahí pide el motivo);
  sin elegir no se guarda (`pintarSugerenciaPrecioSit`, sittings.js).
- Celular (25/10/2026, regla de Paulina y Delfina): toda casilla mide 24 px (regla global en
  `index.html`, `@media (max-width:760px)`); nada de `width:auto` inline en un checkbox. El botón
  de `confirmarAccion` dice lo que hace: el 'Eliminar' por defecto solo si de verdad borra.
- Solicitud en un paso (25/10/2026): "+ Nueva solicitud" lleva la niñera (opcional, solo las que hacen
  ese tipo: `nineraHaceTipo`), "Precio por hora a la familia" y "Precio por hora a la niñera"
  precargados con la tarifa. Con niñera, la solicitud nace `confirmada` y `cargarNineraYRegistro`
  (agenda.js, el mismo que usa "Asignar niñera") carga la niñera y el registro en Sittings; si falla
  la niñera, vuelve a `sin_asignar`. Sin niñera, el precio por hora a la niñera no se guarda (no hay
  columna): al asignar se vuelve a sugerir con la tarifa. En las tarjetas de la Agenda el pago de un
  sitting se ve por hora (`textoPagoAgenda`); los traslados, por viaje.
- Fijos: nunca se borran. "Terminar desde [fecha]" completa `vigente_hasta` con el día
  anterior (`abrirModalTerminarFijo`, agenda.js).
- Registro cancelado (25/10/2026): "Reactivar" (modal del registro en la Agenda) lo deja como
  estaba antes de cancelarlo leyendo `sittings_historial` (`estadoAntesDeCancelar`, agenda.js):
  cancelar es siempre un UPDATE de la misma fila, nunca borrar y volver a crear. Sin historial
  queda en $0 y abre el registro para cargar los montos. Las filas de la lista de Sittings se
  tocan para editar, como las del historial: en el celular los botones quedan fuera de la vista.
- No repintar la app entera ante eventos de auth ni al volver de segundo plano: ya causó
  pérdida de entrevistas (ver comentarios en auth.js y bootstrap.js).
- Que no se pierda lo escrito (21/10/2026): la entrevista y los modales largos guardan un borrador
  en el dispositivo en cada cambio (core.js, `leerBorrador` / `programarBorrador`) y, al volver a
  abrirlos, preguntan antes de ponerlo. Un modal largo nuevo llama a `protegerModal(clave)` después
  de abrirse y precargarse; así también pregunta antes de cerrarse con cambios (fondo, ×,
  "Cancelar"). Toda recarga que dispare la app pregunta si `hayCambiosSinGuardar()`. `signOut`
  siempre con `{ scope: 'local' }`: sin eso cierra la cuenta en todos los dispositivos. La
  entrevista además copia el borrador en la base (tabla `borradores`, una fila por usuaria y por
  clave, `programarBorradorEnBase`): es una red de seguridad, sin avisos si falla o no está.
- Realtime tampoco repinta lo que se está escribiendo: RR.HH. en Entrevista y Finanzas usan
  recarga liviana (`RT_RECARGA_LIVIANA`, agenda.js); con un modal abierto el cambio se aplica al
  cerrarlo.
- Eco del propio guardado (27/10/2026): una recarga liviana avisa cuándo empieza y termina con
  `marcarRecargaLiviana(modulo, enCurso)` (agenda.js; hoy la llama `cargarNinieras`, que además
  nunca corre dos veces a la vez) y Realtime ignora el evento que llega con esa recarga en curso o
  hasta 1,5 s después (`esEcoDeRecargaPropia`); un cambio de otra admin después recarga igual. Un
  panel que se repinta en cada recarga va con `pintarSiCambio(wrap, html)` (core.js): con el mismo
  HTML no vuelve a crear la tarjeta ni su fundido.
- Una función global nueva no puede repetir el nombre de otra en ningún archivo, de ninguna de las
  dos puertas. Una función de `js/comun.js` no se redefine en ningún otro archivo; `comun.js` no
  lleva nada de plata.
- Dos puertas, una sesión cada una (26/10/2026): el cliente de `ninera/` usa
  `storageKey: 'sb-ninera-auth'` (`ninera/js/base.js`); el panel sigue con la clave por defecto.
  Comparten origen y `localStorage`: sin eso, una socia con las dos cuentas vería la sesión
  equivocada. Una cuenta nunca tiene los dos roles.
- Perfil y foto propuesta de la niñera (27/10/2026): la foto que sube la niñera NO reemplaza `foto` (la ven
  las madres): queda en el bucket PRIVADO `ninieras-privado` (5 MB, JPG / PNG / WEBP; la niñera solo lee y
  escribe `fotos/<su id>/propuesta.jpg`, y las etapas 4 y 10 amplían la política para sus rutas; la admin ve
  y borra todo) como `foto_propuesta_ruta` y la admin la aprueba o descarta desde la ficha; las dos
  acciones se escriben con la condición de `foto_propuesta_en` (si la niñera mandó otra mientras se miraba,
  no se pisa). La niñera sube con `achicarFoto(file, 1600, 0.8)` (ahora en `js/comun.js`; el panel sigue con
  800). `ninera_mis_sittings()` nunca devuelve plata ni notas y la dirección solo si el sitting está
  `confirmado`. La ficha muestra cuándo completó y editó el perfil (`perfil_app_en`, `perfil_actualizado_en`)
  porque ahí carga su cuenta bancaria: una cuenta por renglón, como la ficha y Por pagar, hasta 10
  (`demasiadas_cuentas`).
- Cuentas de niñeras (26/10/2026): usuario = celular + contraseña; por dentro, Auth usa el mail
  sintético `<celular normalizado>@ninieras.parentsbreak.invalid` (`MAIL_DOMINIO_NINERA` en
  `js/comun.js`, `mail_sintetico_ninera()` en SQL y la constante de `ninera-cuenta`: los tres
  iguales). La normalización es una sola regla en SQL (`normalizar_celular`), Deno y JS
  (`normalizarCelular`), con los mismos 11 casos en las tres pruebas. La cuenta la crea la Edge
  Function `ninera-cuenta` desde el link de invitación (`crear_invitacion_ninera`, 7 días salvo
  `app_config` 'ninieras_app'.vigencia_dias, un link nuevo invalida el anterior); reset de
  contraseña = otro link desde la ficha, sin mails. El rol es
  `ninieras.user_id` + `ninera_actual()`; `usuarias_autorizadas` no se toca.
  `user_metadata` de la cuenta (nombre, ninera_id) lo puede editar la propia niñera desde su
  sesión (`auth.updateUser`): sirve solo para saludar, nunca para autorizar ni para buscar su
  ficha; la identidad es `ninieras.user_id` + `ninera_actual()` (26/10/2026).
- Lo que la niñera nunca ve (26/10/2026): plata acumulada, pagos, márgenes, el apellido completo de
  la madre, notas internas ni datos de otras niñeras (lista completa en `docs/fase1/decisiones.md`
  5.3). Lo garantiza la base: nada de políticas nuevas sobre tablas compartidas; la niñera lee por
  funciones `security definer` que filtran por `ninera_actual()` y devuelven solo columnas
  permitidas; sus tablas propias llevan RLS por `ninera_actual()`. Cada función nueva trae su
  prueba SQL como niñera. Toda función `security definer` ejecutable por `authenticated` está en la
  lista permitida de `supabase/pruebas/catalogo_seguridad.sql` con su guardia de admin o de niñera:
  `authenticated` ya no significa admin.
- Login del panel con cuenta de niñera (26/10/2026): `login()` consulta `es_usuaria_autorizada()`;
  solo si devuelve exactamente `false` mira `ninera_actual()` y cierra la sesión local: si es
  niñera, muestra el link a `ninera/`; si no, que la cuenta no tiene acceso
  (`frenarCuentaSinAccesoAlPanel`, auth.js). Un error de la RPC sigue como siempre: nunca dejar
  afuera a una admin por una consulta fallida.
- Push y niñeras (26/10/2026): `push_subscriptions.user_id` identifica los dispositivos de niñeras
  (política `push_propias`); `enviar-push-urgentes` V11 manda solo a las filas con `user_id` nulo
  (admins). Los avisos a niñeras van por la cola de la etapa 3.
- Buscadores (25/10/2026): nunca `<datalist>` nativo (en el iPhone no ignora tildes): siempre
  `attachAutocomplete` (sittings.js), que compara con `normaliza()`; con `{sinCoincidencias:''}` no
  avisa nada cuando el nombre es libre. "Entrevistó" viene con `registradoPorUsuario()` y sugiere los
  ya usados (`cargarEntrevistadores`, postulantes.js): nada de nombres reales en el código.
- Escape (05/10/2026): helpers únicos en comun.js. `escaparHtml()` para texto y atributos,
  `argJs()` para pasar un dato a un handler inline (`f(${argJs(x)})`, nunca `'${x}'`) y
  `urlSegura()` para href/src. `tests/escape.spec.js` recorre todo con datos tramposos y
  `estatico.spec.js` controla los handlers.
- Fijos (asignaciones): tienen vigencia (`vigente_desde`/`vigente_hasta`, inclusive) y tipo.
  Nunca pisar la niñera de una asignación con historia: cerrarla y abrir otra desde una
  fecha. Lo que se registra desde un fijo lleva `asignacion_id`. Para saber si un fijo
  corre un día, usar `asignacionVigenteEn(a, fecha)` (core.js).
- Celular de niñera (27/10/2026): obligatorio en el alta y al editar salvo tipo 'Traslados', validado
  con `problemaCelularNinera` (core.js) y la regla de `normalizarCelular`; se guarda como se escribió.
  Contratar desde Postulantes y el alta rápida del registro no lo exigen todavía.
- Lista de Niñeras (21/10/2026): ordenada por la fecha de la entrevista, de la más nueva a la más
  vieja, y las de antes de la app (sin entrevista) al final (`ordenarNinierasPorEntrevista`). Cada
  fila dice cuántos sittings y traslados hizo (sin cancelados ni previstos), de la misma lectura
  que el panel de utilización.
- Temporada en el filtro de Niñeras (21/10/2026, regla de Paulina y Delfina): quien tiene solo
  zonas de afuera (Punta del Este) y no cargó temporada está ahí todo el año; con temporada, solo
  en las quincenas marcadas. "Dijo que no va" (temporada sin quincenas): sin meses aparece con esa
  marca, con meses no. Con un mes elegido, las que no cargaron temporada van aparte ("sin
  temporada cargada"), nunca escondidas. Escribir una zona de afuera en el buscador es igual que
  marcarla (`zonasDelFiltroNin`, ninieras.js).
- Fijos que empezaron antes de la app (10/10/2026): la fecha real va en `inicio_real` (solo se
  muestra, "empezó el"); `vigente_desde` es desde cuándo se registra en la app. Nunca llevar
  `vigente_desde` hacia atrás a meses que están en los Docs.
- Finanzas: el resultado del mes se calcula sobre lo facturado; cobrado/pagado solo dicen si
  la plata ya entró o salió (error E1, 05/10/2026).
- Fijos automáticos (06/10/2026): la base carga sola los próximos 14 días de cada fijo como
  sittings `estado='previsto'` (`generar_previstos_fijos`, pg_cron 03:00) y el día que llegan
  pasan a `confirmado`. Rige solo con `app_config` 'fijos_automaticos' activo (lo prende
  `..._ACTIVAR.sql`); apagado, todo funciona como antes. Previstos solo en la Agenda: toda
  consulta de sittings que muestra "lo que pasó" va con `sinPrevistos()` (core.js). Un
  cambio de un solo día corrige la fila prevista (y la marca `generado_automatico=false`);
  un cambio del fijo (niñera, horario, vigencia, pausa, tarifa) llama a
  `sincronizarPrevistosFijos()`. Los cambios de horario también van "desde [fecha]".
  Si el cambio (niñera, horario, precio o tarifa) rige desde hoy, el sitting de hoy ya
  confirmado sigue al fijo, y pausarlo o terminarlo desde hoy lo cancela en $0
  (`alinearRegistroDeHoy`, agenda.js); solo si es automático y nadie lo tocó (sin editar,
  cobrar ni pagar): si no, se avisa.
- Entrevista a medias (09/10/2026): `entrevistas.estado` 'en_curso' / 'completa'. A medias la
  candidata sigue en 'intake'; al completarla se actualiza la misma fila (`entrevistaState.entrevistaId`).
- Candidatas: lo corregido en la entrevista vive en `notas_ficha` y pisa la respuesta del
  formulario; para mostrar datos de una candidata/niñera usar `datosFichaCandidata()` (core.js).
- Extractos (05/10/2026): leer y conciliar están separados. Cada banco o billetera es un lector
  en `LECTORES_EXTRACTO` (finanzas.js) que devuelve movimientos `{fecha, concepto, cuenta,
  credito, debito}`; hoy está Itaú. Para Mercado Pago se agrega un lector, sin tocar el matching.
- Saldo a favor (07/10/2026): `ajustes_saldo` (positivo suma, negativo descuenta) se aplica
  al grupo más viejo de esa persona en Por pagar / Por cobrar (`aplicarAjustesAGrupos`,
  finanzas.js) y al marcar pagado/cobrado queda anotado en `aplicado`. No toca facturado ni
  resultado del mes.
- Gastos extra (08/10/2026): `gastos_extra`, ticket obligatorio en el bucket PRIVADO
  `comprobantes` (se abre con `createSignedUrl`, nunca URL pública). Si lo pagó la niñera va
  aparte en Por cobrar / Por pagar (`cobrado` / `reintegrado`); si lo pagó la familia genera
  un ajuste de saldo a favor. Nunca suma al facturado ni al margen. Con `absorbe_pb`
  (14/10/2026) lo absorbe Parents Break: no se cobra a la familia ni va a su PDF, se reintegra
  a la niñera y resta del resultado del mes. Los gastos van SIEMPRE aparte del precio: la app
  muestra "Traslado $X + gastos $Y = $Z" (`textoTotalConGastos`, core.js) y el PDF un único
  "Total a pagar" con la cuenta para transferir (app_config 'cuenta_cobro').
- Fijos (13/10/2026): no se crean sin hora de inicio (no se generan solos) ni, si son de
  traslado, sin `cobro_traslado` y `pago_traslado` (`problemaFijoNuevo`, core.js); al crear uno
  se avisa si ya hay uno vigente igual (`avisarSiFijoDuplicado`).
- Revisar meses (15/10/2026): Finanzas tiene la vista "Revisar meses" para corregir cualquier mes
  (incluido `fuente='historico'`) con los modales de siempre. Las sospechas salen de
  `sospechasDelMes()` (finanzas.js); en el histórico solo cuentan pago >= cobro (con los dos montos)
  y la misma línea repetida. "Revisado" es `sittings_traslados.revisado_at`. Los cambios de gastos
  generales, gastos extra y saldos quedan en `finanzas_historial` (trigger), como los de sittings
  en `sittings_historial`.
- Colocaciones de Enrique (19/10/2026): `intermediaciones_enrique.ninera_id` puede venir vacío
  (persona externa, empleada de Enrique): se guarda solo `ninera_nombre`, no se crea niñera ni
  entra a `intermediaciones_enrique_pool`. Lo que lea esa tabla no puede suponer `ninera_id`.
- Intermediaciones (23/10/2026): una sola pantalla, sin pestañas. La lista de colocaciones y eventos con
  chips Todas / Colocaciones / Eventos; "+ Nueva" pregunta qué y abre el formulario en un modal
  (`abrirFormInterEnrique` / `abrirFormInterEvento`); "Niñeras de Enrique" plegable debajo.
- Intermediaciones en Finanzas (20/10/2026): suman al facturado y al resultado del mes (colocación:
  `monto`; evento: `cobro_total`, y los pagos de sus niñeras van a pagos a niñeras), con la línea
  aparte "Intermediaciones" (`resumenIntermediaciones`, finanzas.js). Se cobran y pagan desde Por
  cobrar / Por pagar con sus columnas `cobrado` / `pagado` (`intermediacionesPendientes`), sin saldo
  a favor ni conciliación; el pago pasa por `confirmarPagoSittings(..., otros)`. No van al margen.
- Términos y condiciones (20/10/2026): `familias.terminos_aceptados_el` (lo marca la admin en la
  ficha o en el alta). Desde ese día el fin de cada sitting se COBRA a la media hora siguiente con 5 min de
  tolerancia (17:05 → 17:00, 17:36 → 18:00); el inicio no se redondea y el pago a la niñera va
  siempre con la hora real. Todo cobro por hora pasa por `horasSitting()` (core.js); en la base,
  por `minutos_fin_cobro()` (generar_previstos_fijos y `precio_sitting()`): si cambia la regla,
  cambian todas (las prueba `supabase/pruebas/paridad_plata.sql`). Las
  familias que se usan para cobrar se leen con `leerFamiliasConTerminos()` (anda sin la columna).
- Montos sin centavos (21/10/2026): todo pago a una niñera que sale de una cuenta (horas por
  tarifa, total de Por pagar, "Copiar monto", confirmación) pasa por `redondearPago()`: ,5 o menos
  baja (600,5 → 600; 600,6 → 601). Todo cobro a una familia (registro, Agenda, Por cobrar, PDF),
  por `redondearCobro()`: ,5 o más sube (600,5 → 601; 600,4 → 600). Las dos en core.js; en la
  base, `redondear_pago()` y `redondear_cobro()` (generar_previstos_fijos): si cambia una regla,
  cambian las dos. Nunca `Math.round` para calcular lo que se cobra o se paga. El saldo a favor
  se aplica completo; solo se redondea el total que queda. Lo tipeado a mano también se guarda
  sin centavos (registro, Agenda, editar en Finanzas).
- Por cobrar / Por pagar en tarjetas (23/10/2026): una sola tarjeta por familia o niñera con todos sus
  pendientes (`armarTarjetasPendientes`, finanzas.js; lo que trae solo el nombre va a la de esa
  persona), aunque cobre "diario". El saldo a favor se aplica sobre la tarjeta entera y el total se
  redondea una vez. Cerrada: el total y "Marcar todo cobrado / pagado". Abierta: el detalle en un
  recuadro, agrupado por fecha, con nada tildado; abajo "Marcar cobrado lo tildado ($X)" (gris hasta que
  haya algo tildado) y "Marcar todo cobrado ($Y)". El saldo a favor se tilda solo con el primer sitting y
  "¿Cuánto pagó?" prueba primero con el saldo y después sin él.
  La semana en curso de las fijas y las intermediaciones siguen aparte. `calcularPendientesAgrupados`
  sigue por período (la usa la conciliación).
- Cobro parcial (23/10/2026): en Por cobrar / Por pagar, tocar la tarjeta abre el detalle (un renglón
  por registro, gasto extra y saldo, con casilla) y el botón marca solo lo tildado.
  El gasto va con su sitting; el saldo a favor se aplica a lo que se marca (`totalParcial`, finanzas.js)
  y lo que sobra queda para lo pendiente. "¿Cuánto pagó?" (solo Por cobrar) tilda la combinación exacta
  que usa los más viejos (`combinacionExacta`) o avisa y no deja nada tildado. El detalle se lee al
  abrirlo. Después de marcar, `toast(msg, tipo, {deshacer})` (comun.js) muestra "Deshacer" 8 s:
  desmarca solo lo que marcó ese toque y devuelve el saldo usado (`deshacerMarca`).
- Variantes de precio (23/10/2026): los casos especiales de una familia ya no van en las notas. Al
  registrar (y en el Cierre de los fijos) hay botones con las variantes de esa familia y un ajuste
  libre con motivo (`precio_motivo`), que con "Guardar como botón" pasa a ser variante. Se ven,
  editan y borran en la ficha (`variantes_precio`); pueden ser solo de un fijo y programarse desde una
  fecha y en ciertos días (las aplica `generar_previstos_fijos`; siguen al fijo cuando cambia desde
  una fecha). Efectos: sumar, total fijo o porcentaje; de cada lado primero el total, después los
  porcentajes y al final las sumas, sin centavos (`aplicarVariantes`, core.js; en la base,
  `precio_con_variantes`). Los campos de cobro y pago del registro son la base; se guarda con las
  variantes y en `precio_variantes` la base y cuáles se aplicaron, copiadas tal cual.
- Pagos a niñeras: "Por pagar" no muestra sittings con fecha futura (E7) y marcar pagado
  siempre pasa por `confirmarPagoSittings()` con el detalle y el total (E3). La semana de una
  fija va de lunes a sábado y se paga el sábado; lo que se trabaja un domingo, fijo o puntual, se
  paga ese mismo domingo (23/10/2026, regla de Paulina y Delfina; `inicioSemanaPago` /
  `finSemanaPago`). Se paga cuando terminó el último fijo de ese día (de sus fijos vigentes o de
  lo registrado ese día, lo que termine más tarde; `cierreSemanaFijo`, 21/10/2026). Antes se ve aparte como "Semana en curso,
  cierra hoy a las HH:MM" con lo que lleva hasta hoy, sin botón y sin saldo a favor
  (`porPagarEnCursoHtml`, 20/10/2026). El margen del mes usa la misma regla (`esEnCurso`). El
  cobro semanal de una familia sigue de lunes a domingo. El "Por pagar a niñeras" del resumen tampoco la cuenta: va
  aparte ("Más $X de semanas que todavía no cierran"), y en el mes actual se aclara cuánto de la
  lista es de meses anteriores (21/10/2026). Pagan de a una desde el celular: cada fila tiene
  "Copiar" (la cuenta) y "Copiar monto" (`copiarAlPortapapeles`, comun.js).

## Pendientes
Esta lista es la fuente de verdad de lo que falta en el sistema, para todas las sesiones y
worktrees.
- Cuando aparece algo pendiente (lo pide Diego, queda a medias en una tarea, encontrás un bug
  que no arreglás ahora), sumalo acá en el mismo PR: una o dos líneas, con fecha y lo mínimo
  para retomarlo.
- Cuando se hace, borralo en el PR que lo resuelve. No se marca como "hecho" ni se acumula: si
  dejó una regla que vale a futuro, esa regla va a "Convenciones".
- Antes de arrancar una tarea, mirá si toca algo de esta lista.
- Acá van solo pendientes del sistema. Los operativos con datos reales (cobros de una familia,
  casos para revisar con nombres) no van al repo: los maneja Diego aparte.

### Proyecto grande: apps y flujo de pedidos (19/10/2026, visión, sin fecha)
La visión completa está en la skill `proyecto-grande` (`.claude/skills/proyecto-grande/SKILL.md`):
leela antes de proponer o tocar algo de apps, niñeras con usuario, WhatsApp o el agente, cobros
o pagos automáticos. Va por etapas y Diego decide. El pago automático a niñeras quedó
descartado (19/10/2026): no proponerlo de nuevo.
- Niñeras que dicen que no (20/10/2026): va a la app de niñeras, como un contador.

### Fase 1: app de niñeras + asistente de pedidos (26/10/2026)
En curso. Todo está en `docs/fase1/`: las reglas del negocio en `reglas-del-negocio.md` (leerlas
antes de tocar algo de la fase, obligatorio), el alcance en `plan-fase1.md`, los textos en
`textos.md`, las decisiones de diseño en `decisiones.md` y el plan por etapas en
`plan-implementacion.md`. Etapas 1 (puerta `ninera/`, cuentas, invitación, instalar, avisos) y 2 (perfil, foto
propuesta, próximos sittings) hechas; etapas 3 a 11 pendientes, cada una se detalla antes de arrancarla. Orden (27/10/2026): 2, 3, 9
(temporada, adelantada; usa la cola de avisos de la 3), 4, 5, 6, 7, 8, 10, 11. Los textos
provisorios para las dueñas están en `textos-provisorios.md`.
- Perfil de la niñera (27/10/2026): un segmento de zona que no es un grupo de `zona_grupos` se pierde cuando
  ella guarda desde la app. Pregunta de producto para Diego: ¿se conserva o se descarta?
- `.ics` de "Próximos sittings" (27/10/2026): falta probar la descarga en la app instalada en un iPhone real.
- "Editar" en la ficha de la niñera (panel, 27/10/2026) puede pisar un cambio que ella acaba de hacer desde
  la app (cuenta bancaria, zonas, tipo): condicionar el guardado a `perfil_actualizado_en`, como la foto.
- "Madre:" en los próximos sittings de la niñera (27/10/2026) muestra el nombre del padre en algunas
  familias: confirmar el texto con las dueñas (¿"Familia:"?).
- `ninera-cuenta`: con `email_exists` (cuenta huérfana de un alta anterior, por ejemplo si falló
  borrarla) buscar el usuario por mail y vincularlo; hoy da 500 en cada reintento.
- `ninera-cuenta`: en un reset con dos pedidos en paralelo gana el último `updateUserById`; conviene
  marcar el link usado antes de actuar y liberarlo si falla.
- Push al cerrar sesión (antes de la etapa 3, que manda avisos): al cerrar sesión en la app de
  niñeras, borrar la suscripción de ese dispositivo (`push_subscriptions` por `endpoint`) y
  desuscribirlo. Hoy un celular compartido por dos niñeras deja la fila con el `user_id` de la
  primera y la segunda ve un error de conexión engañoso.
- Un reset de contraseña no cierra las sesiones viejas de la niñera en otros dispositivos.
- `eliminarNinera` con cuenta deja el usuario de Auth y sus suscripciones push.
- Simulador: las llamadas de auth (`/auth/v1/token`, `/logout`) van a `estado.escrituras` y pasan
  por `estado.fallar`; separarlas en `estado.auth` cuando moleste.
- `resolverCambioTelefono` (celular aceptado desde la página de temporada) no avisa que una niñera
  con app necesita un link nuevo ni refresca la fila "App" de la ficha.
- `copiarAlPortapapeles` en el panel: si el portapapeles falla, el modal de copia a mano reemplaza
  la ficha abierta.
- Los textos provisorios de `textos-provisorios.md` esperan la confirmación de las dueñas.
- Celular obligatorio (27/10/2026): si Diego lo pide, exigirlo también con `problemaCelularNinera` en
  `contratar` (postulantes.js), `crearNineraRapida` (sittings.js) y `resolverCambioTelefono`
  (ninieras.js); hoy solo lo exigen el alta y la edición de Niñeras.

### Próximas tareas (pedidas por Paulina y Delfina)
- Rediseño del panel: EN PAUSA (21/10/2026, Paulina y Delfina después de ver las maquetas). No se
  hace el PR 0 ni la barra de abajo: prefieren la navegación actual. Lo que sirve del rediseño se
  mete de a una pieza en las pantallas actuales, sin cambiar la navegación. Auditoría y plan
  original en `docs/rediseno-panel.md`; lo que sigue abajo vale para cuando se retome.
  Orden original: errores de plata → PR 0 base de componentes → Pedido desde WhatsApp → Hoy →
  Plata → Registros → Agenda → Familias y Niñeras → Más.
  No se migra sin red de tests (21/10/2026, `docs/rediseno-panel.md` 4.10): ningún test se borra ni
  se debilita (si mira algo que se mueve, se adapta y el PR lo dice); la red de plata
  (`tests/red-plata.spec.js`, 21/10/2026) compara las funciones nuevas con las actuales; cada PR de pantalla trae sus
  tests (cada acción, vacío / cargando / error, 390 y 1280 px); la versión nueva va detrás de
  `?nuevo=1` hasta que Paulina y Delfina la aprueben, y la vieja se apaga en un PR aparte.
  Fidelidad a las maquetas (21/10/2026): la app nueva replica las maquetas de `docs/maquetas/`
  lo más fiel posible, en celular y en compu: mismos textos,
  orden, componentes, espaciado y comportamiento. Si algo no se puede hacer o choca con un test, no
  se cambia por cuenta propia: se le avisa a Diego antes. Cada PR de pantalla trae capturas a 390 y
  a 1280 px al lado de la maqueta. Lo que las maquetas piden y la app no tiene está en
  `docs/rediseno-panel.md`, 4.9.
- Cobros atrasados en Hoy (19/10/2026), EN PAUSA (20/10/2026: la propuesta no convenció a las
  chicas, retomar con sus cambios): lista de familias que deben, con días de atraso y monto, y
  un botón que abra WhatsApp con el recordatorio ya escrito (link de WhatsApp, sin la API).
- Términos y condiciones (20/10/2026): falta el texto del documento que se les manda a las
  madres nuevas. Más adelante, que la madre los acepte desde un link (hoy los marca la admin).
- Pedido desde WhatsApp (20/10/2026): botón "Nuevo pedido desde WhatsApp": se pegan uno o varios
  mensajes de la madre y Claude Haiku arma la solicitud (familia, día, horario, chicos, zona,
  precio según tarifa). Distingue pedido nuevo / cambio / cancelación / otra cosa y marca los
  horarios aproximados ("sin hora de fin, no antes de las 2"). La admin revisa y confirma. Lo más
  importante: niñeras sugeridas en orden, con el porqué en una línea. Se filtran las no
  disponibles (fijo o sitting que se superpone), en Punta del Este (temporada) o inactivas. Orden
  por defecto: 1) ya fue a esa casa, 2) la madre la pidió antes, 3) cuidó chicos de esa edad,
  4) puede en esa zona, 5) favorita (estrella que marcan las admin), 6) cuidó varios chicos a la
  vez; el orden se cambia desde la app. Botón "Copiar mensaje para niñeras" (lista de difusión).
  Son 4 a 6 pedidos por semana: por ahora no hace falta la API de WhatsApp. Va después del PR 0
  del rediseño, como tarjeta de Hoy y en el "+" (`docs/rediseno-panel.md`, 4.3 y 5).
  Hecha la parte de atrás (21/10/2026): Edge Function `pedido-whatsapp` (texto pegado → ticket con
  Claude Haiku, precio con `precio_sitting()`) y tabla `pedidos_whatsapp` (borrador, confirmado,
  descartado). Falta: la pantalla, las niñeras sugeridas, el mensaje para niñeras y que confirmar
  cree la solicitud.
- Mensajes editables (20/10/2026): todo mensaje que se copia o abre WhatsApp tiene "Editar" antes
  de mandarlo y la opción de guardarlo como plantilla.
- Mercado Pago automático (20/10/2026): van a usar todo Mercado Pago (cobros y pagos). Objetivo:
  que nadie marque nada a mano. Con la API de reportes (settlement_report / release_report,
  programables por día o semana), bajar solos los movimientos de entrada y salida y marcar solos
  los cobros a familias y los pagos a niñeras. Lo que no cierre, con aviso claro: pagó de menos,
  de más, dos veces, o un monto que no coincide con ninguna deuda. Si no coincide, buscar si cubre
  varias deudas juntas de esa familia (debía $1.500 y pagó $3.500: ¿suma dos o más pendientes?) o
  si dejó saldo a favor, y proponerlo para confirmar. Sin links de pago ni QR. Primer paso, antes
  de construir: revisar un reporte real de una semana (en `local/`, nunca en el repo) para ver si
  trae las transferencias que entran desde otros bancos y el nombre de quien paga.
- Formulario de car sitting para niñeras (20/10/2026, va último): las que quieren hacer traslados
  tienen que completarlo. En la base hay 0 respuestas (`carsitting_datos` vacía) de 90 niñeras
  activas y ningún mail enviado: revisar el flujo completo (formulario de Google → Apps Script →
  carsitting-webhook → `carsitting_datos`) y ver si las respuestas no llegan o si nadie lo
  completó. Después: en la app, la lista de niñeras que no lo completaron, con un botón que abre
  WhatsApp con el mensaje y el link al formulario (editable); cuando llega la respuesta, sale sola
  de la lista. Jubilar el recordatorio por mail (Apps Script recordatorio_carsitting +
  carsitting-recordatorio). El PR #60 (pantalla de car sitting) se cerró el 25/10/2026 sin mergear:
  el formulario de Google y el webhook se reemplazan por el carsitting dentro de la app de niñeras
  (fase 1, etapa 10).

### Errores encontrados en la auditoría (21/10/2026)
- "Editar horarios futuros" (`guardarHorarioAsignacionFija`) no permite fijos que cruzan medianoche.
- Finanzas: el balance termina siempre en el mes actual aunque se navegue a otro, y el subtítulo
  del margen no cambia de mes.
- Solicitudes: nadie escribe el estado `pendiente_confirmar`; sobran la leyenda, el botón "Agregar
  otra niñera" y la notificación.
- `chequearFijoNuevoContraTodo` corre dentro de un loop por día (fijo con horario por día);
  `abrirModalAsignar` lee toda la historia de registros cada vez que se abre.
- Editar un registro de una niñera inactiva deja `ninera_id` nulo (`cargarSitBase` trae solo activas).
- Borrar una familia borra sus fijos en cascada (FK `ON DELETE CASCADE`): conviene baja lógica.
  "Descartar" una candidata es un DELETE físico: decidido (21/10/2026) que pase al estado
  `descartada`; va en el PR de Postulantes del rediseño.
- `asignaciones.cobro_hora/pago_hora` se guardan pero solo `sospechasDelMes` las usa: decidir una
  sola fuente del precio del fijo.
- Sittings no está en `RT_RECARGA_LIVIANA` (agenda.js): el propio guardado reconstruye el módulo y
  pierde los filtros del historial.
- `reescribirZonasConTexto` / `refrescarTrasCambioDeZonas` (core.js, 27/10/2026): al corregir una zona
  hace un UPDATE por ficha en un loop (cada evento vuelve por Realtime); conviene una sola escritura.
- Niñeras baja toda la historia de `sittings_traslados` en cada recarga (`cargarUtilizacionNinieras`,
  27/10/2026): conviene una vista o RPC con los conteos por niñera (30 días, total, última fecha).

### WhatsApp y automatización de mensajes
- Línea de WhatsApp Business + API de Meta (Coexistence): bloqueado. Es la base del flujo de
  pedidos del proyecto grande. Antes de construir, evaluar opciones (la API oficial, un agente
  que lea y redacte, o plantillas que ellas mandan con un toque), con costos y riesgos.
- Dependen de WhatsApp: cumpleaños de la niñera a las 9:00, mensaje a la familia poco
  activa (cada 4 semanas, 5% de descuento; falta el texto). El recordatorio de cobros
  atrasados ya no espera a la API: va con el link de WhatsApp (ver "Próximas tareas").
- whatsapp-webhook ya publicado exige la firma de Meta y hoy rechaza todo. Cuando arranquemos,
  cargar `WHATSAPP_APP_SECRET` (App Secret de la app de Meta) en Supabase > Edge Functions >
  Secrets.

### Seguridad
- `carsitting-recordatorio`: pausada desde el 13/09/2026 (mails de carsitting apagados).
  Lo publicado no pide secreto, pero devuelve siempre la lista vacía y no lee la base, así
  que hoy no expone nada. El código original, comentado en el mismo archivo, ya pide
  `x-webhook-secret`: al reactivar los mails se vuelve a ese código y hay que confirmar que
  el Apps Script mande el secreto. Mientras tanto no tocarla sin que Diego lo pida.
- `temporada-ninera` (S3): no pide el link con token y acepta nombre + celular nuevo. Se
  endurece en noviembre, cuando termine la temporada (el formulario está en uso todo octubre).
  Tiene además un error de tipos (TS18046) que ya traía la versión publicada.

### Plata y bancos
- Cambio de banco: está decidido pasar de Itaú a Mercado Pago, pero por ahora se sigue con
  Itaú (13/10/2026). El día del cambio: (1) lector de Mercado Pago en `LECTORES_EXTRACTO`
  (finanzas.js); (2) volver a prender el aviso de "Falta subir el extracto", con el texto de
  Mercado Pago: está apagado desde el 23/10/2026 porque ya no usan Itaú (`AVISO_EXTRACTO_ACTIVO` en
  app-shell.js para Finanzas, campanita, puntito y preferencias, y la misma marca en
  enviar-push-urgentes, que hay que publicar); (3) cambiar la cuenta para transferir del PDF (app_config
  'cuenta_cobro', se edita desde la vista previa del PDF; el dato no va al repo).
- Conciliación con el extracto + saldo a favor (B10, 06/10/2026), para cuando se retome la
  conciliación (está en pausa): hoy busca el total sin descontar el saldo a favor (un pago
  neto no aparece o queda como dudoso) y al marcar cobrado/pagado desde ahí no anota el saldo
  como usado (`registrarAplicacionAjustes`), así que se volvería a descontar. Mientras tanto,
  con saldo a favor se marca desde Por cobrar / Por pagar.
- Probar la conciliación de punta a punta con el extracto de un mes ya cerrado.

### Funciones nuevas pedidas
- "Deshacer" al marcar cobrada o pagada una intermediación (23/10/2026, más adelante): hoy solo lo
  tienen los sittings en Por cobrar / Por pagar (`toast` con `{deshacer}` y `deshacerMarca`, finanzas.js).
- Guía "Cómo se hace" dentro de la app (13/10/2026), BAJA PRIORIDAD (20/10/2026: saben hacer
  todo, el problema es el tiempo; priorizar que las tareas sean más rápidas): guía de uso que
  incluya cómo activar Face ID / Touch ID (una passkey por dispositivo, en Safari).
- Niñeras de Argentina: una sección igual a la de Uruguay que traiga las respuestas de su
  propio formulario (ya existe) con el mismo flujo de postulantes.
- Car sitting: queda como está por ahora. Los mails automáticos están apagados hasta
  reescribir el texto del mail.
- Web pública: sumar reseñas de padres e historias de influencers y sacar "Somos Paulina y
  Delfina". Confirmar con Diego dónde vive la web antes de tocar nada.
- Modo offline (hoy no hay): pendiente aparte, sin fecha.

### Cierre
- Auditoría final módulo por módulo en el celular, antes de dar el sistema por terminado.
