# Fase 1: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** app de niñeras (`/ninera/`) + asistente de pedidos en el panel, en 11 etapas que se
prueban y mergean por separado, para la prueba con 3 a 5 niñeras después de la etapa 7.

**Arquitectura:** misma web app, mismo repo y mismo Supabase. Dos puertas (panel y `/ninera/`) que
comparten `js/comun.js`. La niñera lee tablas compartidas solo a través de funciones SQL
`security definer` que devuelven las columnas permitidas; sus tablas propias llevan RLS por
`ninera_actual()`. Los avisos salen de una cola en la base (`avisos`) que un cron de un minuto y un
trigger inmediato mandan por push con la Edge Function `enviar-avisos`.

**Stack:** HTML/CSS/JS vanilla sin build (scripts clásicos), supabase-js 2.117.2 de `vendor/`,
Supabase (Postgres + RLS + Auth + Storage + Realtime + pg_cron + pg_net + Edge Functions en Deno),
GitHub Pages, Playwright contra el simulador de `tests/support/`, PGlite para el SQL.

**Spec:** `docs/fase1/decisiones.md` (y, por encima, `reglas-del-negocio.md`, `plan-fase1.md`,
`textos.md`). Cada tarea se argumenta desde ahí; quien ejecuta lee los dos.

## Cómo se usa este plan
- Una etapa = un worktree, una rama `claude/fase1-<etapa>`, un PR con merge commit, CI verde.
- Las etapas 0 y 1 están al detalle (paso a paso). Las etapas 2 a 11 tienen sus tareas, archivos,
  interfaces y tests definidos; justo antes de arrancar cada una, se baja al mismo detalle que la
  1 (en este archivo, en un PR de docs o en el primer commit de la etapa) y se vuelve a revisar
  con un lector fresco. Así cada etapa incorpora lo que se aprendió en la anterior.
- Migraciones: siempre `supabase/migraciones/AAAAMMDD_<nombre>.sql` + `_DESHACER.sql`, en una
  transacción, con respaldo si tocan filas, probadas con `scripts/probar-sql.mjs` sobre el schema
  de `main` (`--schema` + `--migracion`) y reflejadas en `supabase/schema.sql`. Antes de pedir el
  OK, Claude le pasa a Diego el SQL listo para el SQL Editor y la consulta de verificación.
- Edge Functions: código en `supabase/functions/<nombre>/`, lógica sin red en un `.ts` aparte con
  tests de Deno (`npx deno@2 test --allow-env` desde una copia fuera del repo), publicación con OK.
- Al cerrar una etapa: descripción del PR con qué quedó hecho, qué falta y las decisiones; CLAUDE.md
  actualizado en el mismo PR (convenciones nuevas y pendientes).
- Orden de ejecución (Diego, 27/10/2026): 1 → 2 → 3 → 9 → 4 → 5 → 6 → 7 → 8 → 10 → 11. La etapa 9
  (temporada) se adelanta porque la temporada de verano ya empieza y el aviso del 1/10 ya pasó; va
  después de la 3 porque usa su cola de avisos. Los números de las etapas no cambian: los cruzan
  `decisiones.md` y el catálogo de avisos.

## Restricciones globales (valen para toda tarea)
- Repo público: cero nombres, celulares, cuentas, mails o montos reales. Datos ficticios siempre
  ("Ana Ficticia", "Familia Prueba Uno", celulares `099000001`, cuentas `0001234567`).
- La niñera nunca ve plata acumulada, pagos ni márgenes; solo precio por hora. Lista completa de lo
  prohibido: `decisiones.md` 5.3. Lo garantiza la base (funciones y RLS), nunca solo la pantalla.
- Ninguna migración ni Edge Function se aplica o publica sin el OK de Diego. Si la confirmación del
  conector vence, SQL exacto para el SQL Editor.
- Nada se manda a madres ni niñeras reales sin confirmación de una admin.
- Scripts clásicos, sin `type="module"`, sin cambiar el orden de carga salvo lo acordado (comun.js
  primero; cada archivo nuevo de la niñera en el orden de `decisiones.md` 5.1).
- Fondo blanco, `color-scheme: only light`, nada de `prefers-color-scheme: dark`.
- Sin emojis nuevos en código ni textos (✕ ✓ ★ permitidos). Los textos de la app de niñeras en
  "tú", copiados de `textos.md`; los del panel en voseo.
- Todo dato a `innerHTML` o a un handler inline pasa por `escaparHtml` / `argJs` / `urlSegura`.
  Todo botón que escribe pasa por `conGuardado(this, ()=>...)`. Fechas con `todayISO()` y
  `sumarDiasISO()`, nunca `toISOString().slice(0,10)`. Montos nunca con `Math.round`.
- Consultas livianas: columnas explícitas, filtros en la base, nada por fila en un loop, índices
  en lo que crece.
- Cada cambio de comportamiento lleva su test en `tests/` (caso feliz, base que falla, sin
  conexión, doble toque, datos raros, base sin la migración, 390 px y 1280 px).
- Los textos a la niñera nunca suponen que quien los lee es admin (una socia puede tener las dos
  cuentas, separadas).

## Review Focus (lo que la spec implica y ningún test de tarea cubre por sí solo)
1. La socia con cuenta de admin y cuenta de niñera en el mismo navegador: cada puerta tiene que
   ver solo su sesión (`storageKey` distinta). Test en la tarea 1.6.
2. Celulares escritos de todas las formas (`+598 99 123 456`, `099123456`, `99123456`, con
   guiones): el mismo mail sintético siempre, y un número no uruguayo no se invita. Test en 1.2
   (SQL), 1.4 (Deno) y 1.6 (login).
3. Un link de invitación usado dos veces, o uno viejo después de generar otro: solo el último
   vigente sirve, una sola vez. Test en 1.2 y 1.4.
4. Cuenta de niñera dada de baja (`activa = false`) o sin ficha: la app no muestra nada de otra
   persona y dice "Tu cuenta no está activa". Test en 1.2 (RLS) y 1.6.
5. Una niñera que entra al panel de admins con su cuenta: no ve datos (RLS ya lo frena) y recibe el
   mensaje con el link a su app, sin quedar en una pantalla vacía. Test en 1.7.

## Estructura de archivos (fase 1 completa)
```
js/comun.js                      helpers compartidos (etapa 1; sacados de core.js)
js/pedidos.js                    panel: pegar mensaje, sugeridas, enviar, pedidos en curso (5 y 6)
ninera/index.html                head + CSS link + <div id="app"> + scripts
ninera/estilos.css               tokens y componentes base, copiados del panel
ninera/manifest.json             PWA de niñeras
ninera/sw.js                     push + notificationclick
ninera/guia/contenido.json       lecciones y repasos (etapa 4)
ninera/js/base.js                cliente (storageKey propia), sesión, navegación, carga, errores
ninera/js/cuenta.js              invitación, login, instalar, avisos
ninera/js/inicio.js              pedidos por responder + próximos sittings
ninera/js/perfil.js              (2)   ninera/js/guia.js (4)   ninera/js/dia.js (7)
ninera/js/chat.js                (3)   ninera/js/temporada.js (9)   ninera/js/carsitting.js (10)
ninera/js/arranque.js            último: boot
supabase/functions/ninera-cuenta/   (1)   supabase/functions/enviar-avisos/   (3)
supabase/migraciones/AAAAMMDD_*.sql     una por etapa (ver cada etapa)
supabase/pruebas/fase1_*.sql            pruebas SQL por etapa
tests/support/app.js                    abrirAppNinera, simulación de funciones por nombre
tests/support/rpc-ninera.js             simulación compartida de las RPC de la niñera
tests/support/fuentes.js                dos órdenes de carga
tests/ninera-*.spec.js, tests/<etapa>.spec.js
scripts/guia-desde-html.mjs             arma contenido.json desde guia-original.html (4)
```

---

## Etapa 0: cerrar lo viejo

### Tarea 0.1: PR #63 rebasado, probado y mergeado

**Archivos:** rama `claude/borrador-en-base` (sin cambios de código nuevos).

- [ ] **Paso 1:** en un worktree aparte, `git fetch origin && git checkout claude/borrador-en-base && git rebase origin/main`. Esperado: sin conflictos (verificado el 25/10/2026 con `git merge-tree`).
- [ ] **Paso 2:** `npm run test:static` y `PUERTO_TESTS=4191 npx playwright test tests/borrador-en-base.spec.js tests/entrevista-sin-perdidas.spec.js`. Esperado: todo en verde.
- [ ] **Paso 3:** `PGLITE_DIR=<carpeta> node scripts/probar-sql.mjs --schema <schema de main> --migracion supabase/migraciones/20261021_borradores.sql supabase/pruebas/borradores.sql`. Esperado: `OK`.
- [ ] **Paso 4:** `git push --force-with-lease`, esperar el CI.
- [ ] **Paso 5:** pasarle a Diego el contenido de `20261021_borradores.sql` para el SQL Editor y la verificación: `select count(*) from public.borradores;` (0 filas, sin error) y `select policyname from pg_policies where tablename = 'borradores';` (las políticas de la migración). Esperar su OK.
- [ ] **Paso 6:** merge del PR con merge commit; `git checkout main && git pull`.

### Tarea 0.2: cerrar PR #60

- [ ] **Paso 1:** `gh pr close 60 --comment "Se cierra sin mergear: el formulario de Google y el webhook quedan reemplazados por el carsitting en la app de niñeras (fase 1, etapa 10; docs/fase1/decisiones.md 4.4 y 10). La lista Completaron / Faltan se rehace ahí."`
- [ ] **Paso 2:** anotar en el PR de la etapa 1 (CLAUDE.md, Pendientes) que #60 se cerró y por qué.

---

## Etapa 1: puerta de niñeras (cuenta, invitación, app instalable)

Rama `claude/fase1-puerta-ninieras`. Migración `20261026_cuentas_ninieras.sql`. Edge Function
nueva `ninera-cuenta`. Lleva `docs/fase1/` entero.

### Tarea 1.0: probar el mail sintético en Supabase Auth (Diego, 2 minutos)
- [ ] **Paso 1:** pedirle a Diego: panel de Supabase → Authentication → Users → "Add user" → "Create new user", mail `prueba@ninieras.parentsbreak.invalid`, cualquier contraseña de 8 letras, "Auto confirm user" prendido. Esperado: el usuario se crea. Después borrarlo desde la misma lista.
- [ ] **Paso 2:** si lo rechaza, el dominio pasa a `ninieras.parentsbreak.example.com` en los tres lugares (`decisiones.md` 4.21) antes de escribir la migración.

### Tarea 1.1: `js/comun.js` y los dos órdenes de carga

**Archivos:**
- Crear: `js/comun.js`
- Modificar: `js/core.js` (sacar lo que se mueve), `index.html:580-594`, `tests/support/fuentes.js`, `tests/estatico.spec.js`, `CLAUDE.md` ("Stack", "Scripts y orden de carga")
- Test: `tests/estatico.spec.js`

**Interfaces:**
- Produce en `js/comun.js` (mismas firmas y cuerpos que hoy en `core.js`): `SUPABASE_URL`,
  `SUPABASE_KEY`, `escaparHtml(t)`, `argJs(v)`, `urlSegura(u)`, `normaliza(s)`,
  `fechaNegocioISO(d)`, `todayISO()`, `currentMonthStr()`, `diaSemanaDeISO(f)`,
  `sumarDiasISO(f, n)`, `calcularEdad(nac, ref)`, `toast(msg, type, opciones)`,
  `conGuardado(btn, accion)`, `sbGuardar(consulta, queCosa)`, `copiarAlPortapapeles(texto)`, y
  lo que esas funciones usen entre sí (por ejemplo lo de `toast` con `{deshacer}`). `sb` sigue en
  `core.js`. Nada de plata.
- Produce en `fuentes.js`: `ORDEN_SCRIPTS` (con `'js/comun.js'` primero), `ORDEN_SCRIPTS_NINERA`
  (`['js/comun.js', 'ninera/js/base.js', 'ninera/js/cuenta.js', 'ninera/js/inicio.js',
  'ninera/js/arranque.js']`, crece por etapa), `scriptsDeIndexNinera()` (lee `ninera/index.html`,
  acepta `../js/comun.js`), `TODOS_LOS_SCRIPTS` (unión sin repetir) y `declaracionesTopLevel(lista)`
  / `handlersInline(lista)` con la lista como parámetro (default `TODOS_LOS_SCRIPTS`).

- [ ] **Paso 1:** en `tests/estatico.spec.js`, cambiar el test del orden para que espere `ORDEN_SCRIPTS` con `js/comun.js` primero y agregar: `test('ninera/index.html carga los scripts en el orden acordado (arranque.js último)', ...)` con `expect(scriptsDeIndexNinera()).toEqual(ORDEN_SCRIPTS_NINERA)` y que `ninera/index.html` cargue `../vendor/supabase-js-2.117.2.umd.js` antes de `../js/comun.js`. Extender el loop de `node --check` a `TODOS_LOS_SCRIPTS` más `ninera/sw.js`, y `emojisPorArchivo()` a `ninera/index.html`, `ninera/sw.js`, `ninera/manifest.json`.
- [ ] **Paso 2:** `npm run test:static`. Esperado: fallan el orden y `node --check ninera/...` (archivos inexistentes).
- [ ] **Paso 3:** crear `js/comun.js` moviendo las funciones (cortar de `core.js`, sin copiar: el test de globales duplicadas lo controla) con un encabezado que explique que lo cargan las dos puertas y que no lleva plata. Agregar `<script src="js/comun.js"></script>` antes de `js/core.js` en `index.html`.
- [ ] **Paso 4:** crear `ninera/index.html` mínimo (head con `color-scheme: only light`, `<link rel="stylesheet" href="estilos.css">`, `<div id="app">` con la pantalla de carga del panel, los 5 scripts) y `ninera/js/{base,cuenta,inicio,arranque}.js` vacíos salvo un comentario; `ninera/sw.js` como copia de `sw.js` con `icon: '../icon-192.png'`; `ninera/manifest.json` (`decisiones.md` 5.1); `ninera/estilos.css` con los tokens `:root` y las clases `btn`, `btn.primary`, `field`, `helper`, `warnbox`, `toast`, `pantallacarga*`, `spinner` copiadas de `index.html`.
- [ ] **Paso 5:** `npm run test:static` y `PUERTO_TESTS=4191 npx playwright test tests/humo.spec.js tests/arranque.spec.js`. Esperado: verde (el panel no cambió de comportamiento).
- [ ] **Paso 6:** actualizar CLAUDE.md: 15 archivos en `js/` con `comun.js` primero; la puerta `ninera/` con su orden; regla: una función de `comun.js` no se redefine en ningún otro archivo. Commit: `Fase 1: js/comun.js compartido y esqueleto de /ninera/`.

### Tarea 1.2: migración `cuentas_ninieras` y sus pruebas SQL

**Archivos:**
- Crear: `supabase/migraciones/20261026_cuentas_ninieras.sql`, `..._DESHACER.sql`, `supabase/pruebas/fase1_cuentas_ninieras.sql`
- Modificar: `supabase/schema.sql`, `scripts/probar-sql.mjs:29` (auth.uid() de mentira)

**Interfaces (produce):**
- `ninieras.user_id uuid unique references auth.users(id) on delete set null`,
  `ninieras.app_activada_en timestamptz`.
- `ninera_invitaciones (id uuid pk default gen_random_uuid(), ninera_id uuid not null references
  ninieras(id) on delete cascade, token text not null unique, creada_por text, creada_en timestamptz
  not null default now(), vence_en timestamptz not null, usada_en timestamptz, reemplazada_en
  timestamptz)`; RLS: `for all to public using ((select es_usuaria_autorizada()))`.
- `normalizar_celular(p text) returns text` (`immutable`): solo dígitos; se quita un `00` inicial
  (prefijo internacional); si empieza en `598`, la parte local es el resto, si no, todo; de la
  parte local se quita un 0 inicial (troncal); la parte local tiene que ser 8 dígitos que
  empiecen en 9 → `'598' || local`; cualquier otra cosa → null. Casos: `'+598 99 123 456'`,
  `'099123456'`, `'99123456'`, `'099-123-456'`, `'59899123456'`, `'00598 99 123 456'`,
  `'+598 099 123 456'` → `'59899123456'`; `'123'`, `'+54 11 5555 5555'`, `''`, null → null.
- `mail_sintetico_ninera(p_celular text) returns text`: `normalizar_celular(p) || '@ninieras.parentsbreak.invalid'`, null si no normaliza.
- `ninera_actual() returns uuid` (`security definer`, `stable`, `set search_path = public`):
  `select id from ninieras where user_id = auth.uid() and activa limit 1`. `es_ninera()`.
  `revoke ... from public; grant execute to authenticated`.
- `ninera_activar_app() returns timestamptz` (`security definer`): pone `app_activada_en =
  coalesce(app_activada_en, now())` en la niñera actual y la devuelve; null si no es niñera.
- `crear_invitacion_ninera(p_ninera_id uuid) returns table (token text, vence_en timestamptz,
  es_reset boolean)` (`security definer`): solo si `es_usuaria_autorizada()`; falla con
  `raise exception 'celular_invalido'` si `mail_sintetico_ninera(telefono)` es null; marca
  `reemplazada_en = now()` en las vigentes de esa niñera; inserta con `token =
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')` (64 hex; sin pgcrypto, que PGlite
  no tiene; mismo patrón que `cron_push_secret`), `vence_en = now() + (app_config 'ninieras_app'
  ->> 'vigencia_dias', default 7) días`, `creada_por = auth.email()` (o `auth.jwt()->>'email'`);
  `es_reset = (user_id is not null)`.
- `push_subscriptions.user_id uuid references auth.users(id) on delete cascade`; política
  `push_propias`: `for all to authenticated using (user_id = auth.uid()) with check (user_id =
  auth.uid())` (se suma a la de admins).
- `app_config` fila `'ninieras_app'`: `{"vigencia_dias": 7}` (`on conflict do nothing`).
- DESHACER: borra políticas, funciones, tabla, columnas y la fila de config (sin tocar `auth.users`).

- [ ] **Paso 1:** en `scripts/probar-sql.mjs`, reemplazar `auth.uid()` de mentira por `select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'` (cast a uuid) y `auth.jwt()` por el mismo `jsonb`; agregar `create function auth.email() returns text` que lea `->> 'email'`. Comentar que así las pruebas pueden "ser" una usuaria con `set local request.jwt.claims`.
- [ ] **Paso 2:** escribir `supabase/pruebas/fase1_cuentas_ninieras.sql` (estilo de `supabase/pruebas/borradores.sql`: bloques `do $$ ... raise exception ... $$` por caso): `normalizar_celular` con los 11 casos de la regla (7 válidos → `'59899123456'`, 4 → null); `mail_sintetico_ninera('099123456') = '59899123456@ninieras.parentsbreak.invalid'`; con `set local role authenticated` y claims de un `auth.users` ficticio vinculado a una niñera activa: `ninera_actual()` es su id, `select * from sittings_traslados` devuelve 0 filas, `ninera_activar_app()` fija la fecha una vez y no la pisa; con la niñera `activa = false`, `ninera_actual()` es null; `crear_invitacion_ninera` como admin (claims de una fila de `usuarias_autorizadas`): devuelve token de 64 hex, `vence_en` ≈ 7 días, la segunda llamada deja la primera con `reemplazada_en`; como niñera, falla; niñera sin celular válido, `celular_invalido`; `push_subscriptions`: la niñera inserta con su `user_id`, no ve las filas de otra; DESHACER y volver a aplicar deja todo igual.
- [ ] **Paso 3:** `PGLITE_DIR=<carpeta> node scripts/probar-sql.mjs --migracion supabase/migraciones/20261026_cuentas_ninieras.sql supabase/pruebas/fase1_cuentas_ninieras.sql`. Esperado: `FALLA` (la migración no existe).
- [ ] **Paso 4:** escribir la migración (en `begin; ... commit;`, con comentarios del porqué y fecha) y el DESHACER; reflejar en `schema.sql`.
- [ ] **Paso 5:** correr el paso 3 de nuevo sobre `--schema <schema de main>` y sobre `supabase/schema.sql` actualizado (sin `--migracion`). Esperado: `OK` en los dos; y las demás pruebas de `supabase/pruebas/*.sql` siguen `OK`.
- [ ] **Paso 6:** commit: `Fase 1: migración cuentas_ninieras (user_id, invitaciones, ninera_actual)`.

### Tarea 1.3: simulador de tests para la puerta de niñeras

**Archivos:**
- Modificar: `tests/support/app.js` (`abrirApp`, ruteo de `functions/v1`), `tests/support/datos.js`
- Crear: `tests/support/rpc-ninera.js`

**Interfaces (produce):**
- `abrirAppNinera(page, { datos, ninera = ID.nAna, sesion = true, ahora, ruta = '/ninera/',
  instalada = true, consulta = '' })` → mismo `estado` que `abrirApp`. Inyecta la sesión bajo la
  clave `sb-ninera-auth` con el usuario `USUARIO_NINERA` (`id '00000000-0000-4000-8000-000000000002'`,
  `email '59900000001@ninieras.parentsbreak.invalid'`), pone `user_id` en la niñera elegida,
  simula `display-mode: standalone` según `instalada` (`page.emulateMedia` no alcanza: se inyecta
  `window.matchMedia` para `(display-mode: standalone)` con `addInitScript`), y registra las RPC de
  `rpc-ninera.js` en `estado.rpc`.
- `estado.funciones[nombre] = (cuerpo, req) => ({ status, json })` para `functions/v1/<nombre>`;
  sin simulación, respuesta genérica como hoy. Toda llamada queda en `estado.escrituras`.
- `rpc-ninera.js`: `rpcNinera(db, nineraId)` devuelve `{ ninera_actual: () => nineraId,
  es_ninera: () => true, ninera_activar_app: () => '2026-10-04T15:00:00+00:00', crear_invitacion_ninera: ... }`
  (las de etapas siguientes se suman acá).
- `datos.js`: `ID.uNinera`, y a `nAna` le suma `user_id: null, app_activada_en: null`; tabla
  `ninera_invitaciones: []`; `app_config` con `ninieras_app`.

- [ ] **Paso 1:** escribir `tests/ninera-cuenta.spec.js` con un primer test: `abrirAppNinera` con sesión → ve el texto `No tienes pedidos por ahora.`; `verificarLimpio(estado)` al final.
- [ ] **Paso 2:** correrlo: `PUERTO_TESTS=4191 npx playwright test tests/ninera-cuenta.spec.js`. Esperado: FALLA (no existe `abrirAppNinera`).
- [ ] **Paso 3:** implementar lo de "Interfaces" en `app.js`, `datos.js` y `rpc-ninera.js`, reusando el ruteo de `abrirApp` (sacar lo común a una función interna `prepararPagina(page, estado, opciones)`).
- [ ] **Paso 4:** correr `tests/humo.spec.js` y el test nuevo. Esperado: humo verde; el nuevo sigue fallando solo porque la app de niñeras todavía no pinta nada (se completa en 1.5).
- [ ] **Paso 5:** commit: `Tests: abrirAppNinera y simulación de Edge Functions por nombre`.

### Tarea 1.4: Edge Function `ninera-cuenta` (y filtro en `enviar-push-urgentes`)

**Archivos:**
- Crear: `supabase/functions/ninera-cuenta/index.ts`, `cuenta.ts`, `cuenta_test.ts`
- Modificar: `supabase/functions/enviar-push-urgentes/index.ts` (V11: solo suscripciones de admins)

**Interfaces (produce):**
- `cuenta.ts`: `normalizarCelular(s: string): string | null` (mismos casos que la SQL),
  `mailSintetico(celular: string): string | null`, `MIN_PASSWORD = 8`,
  `type Deps = { buscarInvitacion(token): Promise<Invitacion | null>; crearUsuario(email,
  password, nineraId): Promise<string>; actualizarUsuario(userId, { password, email }): Promise<void>;
  vincular(nineraId, userId): Promise<void>; marcarUsada(invitacionId): Promise<void>; ahora(): Date }`,
  `type Invitacion = { id, ninera_id, nombre, telefono, user_id, vence_en, usada_en, reemplazada_en }`,
  `procesarCuenta(deps, entrada: { token?: unknown; password?: unknown }): Promise<{ status: number;
  cuerpo: object }>`: sin token → 400; token inexistente → 404 `{error:'no_existe'}`; vencido,
  usado o reemplazado → 410 `{error:'vencido'}`; sin password → 200 `{nombre: primer nombre,
  celular_mascarado: '••• ' + últimos 3, es_reset}`; password < 8 → 400 `{error:'password_corta'}`;
  celular que no normaliza → 409 `{error:'celular_invalido'}`; alta → `crearUsuario` + `vincular`
  + `marcarUsada` → 200 `{celular}`; reset (user_id presente) → `actualizarUsuario(user_id,
  {password, email: mailSintetico})` + `marcarUsada` → 200 `{celular}`.
- `index.ts`: verify_jwt = false; CORS con `ORIGENES_PERMITIDOS` como `pedido-whatsapp`; cliente con
  clave de servicio; `crearUsuario` = `sb.auth.admin.createUser({ email, password, email_confirm:
  true, user_metadata: { ninera_id } })`; `actualizarUsuario` = `sb.auth.admin.updateUserById`;
  `buscarInvitacion` hace join con `ninieras (nombre, telefono, user_id)`.

- [ ] **Paso 1:** escribir `cuenta_test.ts` (Deno, `Deno.test`) con un caso por cada rama de arriba más: el mismo token dos veces (la segunda 410), `normalizarCelular` con los mismos 11 casos de la prueba SQL.
- [ ] **Paso 2:** desde una copia fuera del repo: `cp -r supabase/functions/ninera-cuenta /tmp/pb-fn/ && cd /tmp/pb-fn && npx deno@2 test --allow-env ninera-cuenta/`. Esperado: fallan (no existe `cuenta.ts`).
- [ ] **Paso 3:** implementar `cuenta.ts` e `index.ts`.
- [ ] **Paso 4:** `npx deno@2 test --allow-env` y `npx deno@2 check ninera-cuenta/index.ts` desde la copia. Esperado: todo OK.
- [ ] **Paso 5:** `enviar-push-urgentes/index.ts`: la lectura de `push_subscriptions` pasa a `.is('user_id', null)` (solo dispositivos de admins; las filas con `user_id` son de niñeras y nunca reciben los avisos urgentes del panel, que nombran familias), con el comentario V11 fechado. `npx deno@2 check` desde la copia. Hallado en la tarea 1.2 (26/10/2026).
- [ ] **Paso 6:** commit: `Edge Function ninera-cuenta: alta y reset de la cuenta desde el link de invitación`. (Publicación: recién con el OK, ver 1.9.)

### Tarea 1.5: app de niñeras: invitación, login, instalar, avisos, inicio vacío

**Archivos:**
- Modificar: `ninera/js/base.js`, `ninera/js/cuenta.js`, `ninera/js/inicio.js`, `ninera/js/arranque.js`, `ninera/estilos.css`
- Test: `tests/ninera-cuenta.spec.js`

**Interfaces (produce):**
- `base.js`: `const sbn = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession:
  true, autoRefreshToken: true, storage: window.localStorage, storageKey: 'sb-ninera-auth' } })`;
  `let sesionNinera = null;` `pintar(html)` (reemplaza `#app`), `mostrarCargaNinera(msg)`,
  `mostrarErrorNinera(titulo, detalle)`, `irA(hash)` / `rutaActual()` (hash routing: `#inicio`,
  `#login`, `#invitacion`, `#instalar`, `#avisos`), `NINERA_URL_BASE` (la URL de `ninera/` resuelta
  desde `location`), `leerSesionNineraGuardada()` (clave `sb-ninera-auth`, mismo criterio que
  `leerSesionGuardada` del panel).
- `cuenta.js`: `pantallaInvitacion(token)`, `crearCuentaDesdeInvitacion(token)`,
  `pantallaLogin()`, `entrarNinera()`, `olvideContrasena()` (solo el texto "Pídele un link nuevo al
  equipo por WhatsApp"), `esAppInstalada()` (`matchMedia('(display-mode: standalone)').matches ||
  navigator.standalone`), `pantallaInstalar()`, `pantallaAvisos()`, `activarAvisosNinera()`
  (permiso + `pushManager.subscribe` con `VAPID_PUBLIC_KEY` movida a `comun.js` + upsert en
  `push_subscriptions` con `user_id: sesionNinera.user.id`, `usuario: email`, `onConflict: 'endpoint'`),
  `avisosActivados()`, `cerrarSesionNinera()` (`signOut({ scope: 'local' })`).
- `inicio.js`: `renderInicio()` → cabecera con el primer nombre, aviso "Avisos apagados..." si
  corresponde, `No tienes pedidos por ahora.`, link "Mi cuenta" (cerrar sesión). Sin conexión o error
  → "No pudimos cargar tus pedidos. Revisa tu conexión a internet y vuelve a intentar." con Reintentar.
- `arranque.js`: `bootNinera()`: si `?i=<token>` → `pantallaInvitacion`; si hay sesión → `ninera_actual`
  por RPC (null → "Tu cuenta no está activa. Escríbenos por WhatsApp." con cerrar sesión) →
  `ninera_activar_app` → si no instalada, `pantallaInstalar` (con "Ya la instalé" que sigue) → si
  push soportado y no activado, `pantallaAvisos` una vez por dispositivo (`localStorage
  'pb-ninera-avisos-vistos'`) → `renderInicio`. Sin sesión → `pantallaLogin`. Los eventos de auth
  siguen la regla del panel: no repintar en `TOKEN_REFRESHED` ni en `SIGNED_IN` repetido.
- Textos exactos: `textos.md` secciones 3 y 2.

- [ ] **Paso 1:** completar `tests/ninera-cuenta.spec.js`: (a) invitación válida: `estado.funciones['ninera-cuenta']` devuelve `{nombre:'Ana', celular_mascarado:'••• 001', es_reset:false}` sin password y `{celular:'59900000001'}` con password; la pantalla dice `Te invitamos a Parents' Break` y `Ana, desde ahora los pedidos te llegarán por aquí`; `1234567` → `Mínimo 8 letras o números`; dos distintas → `Las contraseñas no coinciden`; OK → la llamada lleva `{token, password}` y el POST a `/auth/v1/token` lleva `email: '59900000001@ninieras.parentsbreak.invalid'`; termina en `No tienes pedidos por ahora.`; (b) vencido (410) → `Este link venció. Solicítale uno nuevo al equipo por WhatsApp.`; (c) login con `+598 99 000 001`, `099000001` y `99 000 001` → el mismo email en el token; contraseña mal (simulado 400) → mensaje claro sin éxito falso; sin conexión (`estado.fallar = () => 'red'`) → mensaje; (d) `instalada:false` → los 4 pasos y `Instala la app para recibir los pedidos`; (e) avisos: permiso concedido (inyectar `Notification.requestPermission` y `pushManager`) → upsert en `push_subscriptions` con `user_id` del usuario ficticio; denegado → `Avisos apagados. No te van a llegar los pedidos. Actívalos en Ajustes.` en el inicio; (f) `ninera_actual` null → `Tu cuenta no está activa`; (g) `ninera_activar_app` se llama al entrar; (h) captura a 390 px del inicio y de la invitación; (i) ningún texto de la app contiene `$` seguido de dígitos.
- [ ] **Paso 2:** correr el spec. Esperado: fallan todos salvo el esqueleto.
- [ ] **Paso 3:** implementar `base.js`, `cuenta.js`, `inicio.js`, `arranque.js` y las clases que falten en `estilos.css` (botones a ancho completo, campos grandes, 16 px de margen lateral).
- [ ] **Paso 4:** correr el spec y `tests/estatico.spec.js`. Esperado: verde. Revisar en el navegador headless (captura) que no haya scroll horizontal a 390 px.
- [ ] **Paso 5:** commit: `App de niñeras: invitación, login con celular, instalar, avisos e inicio vacío`.

### Tarea 1.6: aislamiento de sesiones y cuentas inactivas

**Archivos:** `tests/ninera-cuenta.spec.js`, `tests/support/app.js`

- [ ] **Paso 1:** test `las dos puertas no comparten sesión`: abrir el panel con `abrirApp` (sesión admin en `sb-wvewzamdohrpfhpccvcz-auth-token`) y, en la misma página, navegar a `/ninera/`: tiene que mostrar el login (no la sesión de admin); y al revés (sesión solo en `sb-ninera-auth`, `/` muestra el login del panel).
- [ ] **Paso 2:** test `celular con formato raro entra igual` (si no quedó en 1.5) y `cuenta dada de baja`: `ninera_actual` → null → texto y botón "Cerrar sesión" que hace `signOut` (`/auth/v1/logout` en `estado.escrituras`).
- [ ] **Paso 3:** correr; corregir lo que falle; commit `Tests: sesiones separadas por puerta y cuenta inactiva`.

### Tarea 1.7: panel: "Invitar a la app" y aviso a cuentas de niñera

**Archivos:**
- Modificar: `js/ninieras.js` (`verNinera`: fila "App" + botón; funciones nuevas), `js/auth.js` (`login()`), `js/app-shell.js` (nada, salvo `nombreUsuario` si hace falta)
- Test: `tests/invitar-app.spec.js`, `tests/humo.spec.js` (sin cambios esperados)

**Interfaces (produce):**
- `ninieras.js`: `estadoAppNinera(n, invitacion, pushs)` → `{ texto, puedeInvitar, motivo }` (puro):
  sin `user_id` y sin invitación vigente → "Sin app"; invitación vigente → "Invitada el dd/mm, el
  link vence el dd/mm"; con `user_id` → "App activa desde dd/mm · avisos activados" o "· sin
  avisos" (según `push_subscriptions` con ese `user_id`); sin celular válido → `puedeInvitar false`,
  `motivo 'Cargá un celular uruguayo válido para invitarla'`. `cargarEstadoAppNinera(id)` lee
  `ninera_invitaciones (vence_en, usada_en, reemplazada_en)` de esa niñera y `push_subscriptions
  (id)` por `user_id`, en paralelo, y pinta en `#vn-app`. `abrirInvitacionApp(id)` → RPC
  `crear_invitacion_ninera` → modal con el link `${location.origin}${location.pathname}ninera/?i=${token}`
  (resuelto con `new URL('ninera/', location.href)`), el mensaje de `textos.md` sección 2 con el
  primer nombre y "Vale por 7 días" (días desde la respuesta), botones "Copiar mensaje"
  (`copiarAlPortapapeles`) y "Abrir WhatsApp" (`waLink(n.telefono, mensaje)`); si `es_reset`, el
  título es "Link para cambiar la contraseña" y el mensaje empieza "¡Hola [niñera]! Con este link
  puedes crear una contraseña nueva: [link]. Vale por 7 días."
- `ninieras.js` `guardarEdicionNinera`: si la niñera tiene `user_id` y cambia el celular, después de
  guardar `toast('Cambió el celular: va a necesitar un link nuevo para entrar (Invitar a la app)')`.
- `auth.js` `login()`: después de `signInWithPassword` OK, `const { data } = await sb.rpc('es_usuaria_autorizada')`;
  si es `false`, `sb.rpc('ninera_actual')`; si devuelve un id → `signOut({ scope: 'local' })` y en el
  login el aviso "Esta cuenta es de niñera. Entrá por la app de niñeras: [link a ninera/]"; si no,
  "Esta cuenta no tiene acceso". Sin RPC extra cuando ya había sesión guardada.

- [ ] **Paso 1:** escribir `tests/invitar-app.spec.js`: ficha de Ana → fila "App: Sin app" y botón "Invitar a la app" → RPC simulada devuelve `{token:'a'.repeat(48), vence_en, es_reset:false}` → modal con el link que termina en `/ninera/?i=aaaa…` y el texto `Desde ahora los pedidos de Parents' Break te van a llegar por nuestra app`; "Copiar mensaje" deja el texto en el portapapeles (inyectar `navigator.clipboard.writeText`); niñera sin celular → botón deshabilitado con el motivo; con `user_id` → "App activa desde" y "Link para cambiar la contraseña"; invitación vigente → "vence el"; RPC falla → aviso, sin modal; doble toque → una sola RPC; 390 px. Y en `auth.js`: login con `es_usuaria_autorizada` → `false` y `ninera_actual` → id: aviso con link `ninera/` y `/auth/v1/logout` llamado.
- [ ] **Paso 2:** correr. Esperado: fallan.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** correr `tests/invitar-app.spec.js tests/humo.spec.js tests/ninieras-lista.spec.js tests/escape.spec.js`. Esperado: verde.
- [ ] **Paso 5:** commit: `Niñeras: "Invitar a la app" en la ficha y aviso a cuentas de niñera en el login`.

### Tarea 1.8: documentación y limpieza

**Archivos:** `CLAUDE.md`, `docs/fase1/*`, `README.md` (una línea sobre `/ninera/`)

- [ ] **Paso 1:** CLAUDE.md: sección nueva "Fase 1: app de niñeras" en Pendientes que apunta a `docs/fase1/` (reglas, plan, decisiones, estado por etapa); en "Convenciones": `js/comun.js`, dos puertas con `storageKey` distinta, mail sintético (`mail_sintetico_ninera`), lo que la niñera nunca ve (link a `decisiones.md` 5.3), `abrirAppNinera`; en "Base de producción": la regla de los datos de práctica (`decisiones.md` 4.17: "(práctica)" en el nombre, solo a la niñera de práctica, nunca cobrados ni pagados, Diego los borra con respaldo y OK); sacar de "Errores encontrados" la línea "falta revisar en producción cuántas asignaciones quedaron así" (revisado el 25/10/2026: 0); anotar el cierre de #60.
- [ ] **Paso 2:** `npm run test:static` (emojis: `docs/` no entra en la lista; igual, sin emojis nuevos en CLAUDE.md).
- [ ] **Paso 3:** commit `Docs: fase 1 (reglas, plan, decisiones) y CLAUDE.md`.

### Tarea 1.9: PR, migración y publicación (con OK)

- [ ] **Paso 1:** releer el diff completo como revisor (simple, sin duplicados, sin restos). `npx playwright test` completo con `PUERTO_TESTS=4191`. Esperado: verde.
- [ ] **Paso 2:** abrir el PR `claude/fase1-puerta-ninieras` con la descripción: qué hace, la migración, la Edge Function, qué verificar, y la nota "No mergear sin el OK de Diego: migración + Edge Function".
- [ ] **Paso 3:** pasarle a Diego: (a) el SQL de `20261026_cuentas_ninieras.sql` para el SQL Editor; (b) la verificación: `select column_name from information_schema.columns where table_name = 'ninieras' and column_name in ('user_id','app_activada_en');` (2 filas), `select proname from pg_proc where proname in ('ninera_actual','es_ninera','normalizar_celular','mail_sintetico_ninera','crear_invitacion_ninera','ninera_activar_app');` (6 filas), `select public.normalizar_celular('099123456');` → `59899123456`, `select count(*) from public.ninera_invitaciones;` → 0; (c) publicar PRIMERO `enviar-push-urgentes` V11 (filtro `user_id is null`; sin eso, una niñera que active avisos recibiría los urgentes del panel) y DESPUÉS `ninera-cuenta` (Supabase > Edge Functions, verify_jwt apagado) o con el conector, y probarla con un token inventado de 64 hex (`'a'` repetida 64 veces): `POST` con `{token}` → 404 `no_existe` (con `'x'` da 400 `token`). Recién con las dos publicadas se mergea.
- [ ] **Paso 4:** con el OK y el CI verde, merge con merge commit; `git checkout main && git pull`; avisar que el worktree se puede borrar. Reporte de 10 líneas + mensaje para Paulina y Delfina.

---

## Etapa 2: perfil y próximos sittings

Rama `claude/fase1-perfil` (worktree `.claude/worktrees/perfil`). Migración
`20261027_perfil_ninera.sql` + `_DESHACER.sql`. Detallada el 27/10/2026 con el OK de Diego al
resumen y sus ajustes: la foto que sube la niñera NO reemplaza la del CV (la ven las madres): queda
como "foto propuesta" en un bucket privado propio y la admin la aprueba con un toque desde la ficha.

**Objetivo:** la niñera completa su perfil una sola vez (servicios, zonas, datos bancarios, foto
opcional) y ve en el inicio sus próximos sittings sin ningún monto; la admin ve en la ficha cuándo
completó el perfil y aprueba o descarta la foto propuesta.

**Restricciones de la etapa (además de las globales):**
- Datos bancarios: solo los devuelve `ninera_mi_perfil()` (la propia niñera) y la ficha del panel.
- `ninera_mis_sittings()`: nunca `cobro_familia`, `pago_ninera`, `cobrado`, `pagado`, `notas`,
  `precio_*`; la dirección (y origen / destino de un traslado) solo si `estado = 'confirmado'`.
- Ningún HTML de la app de niñeras contiene `$` seguido de un dígito ni la palabra "pago" (test).
- Fotos: `achicarFoto(file, 1600, 0.8)` antes de subir, desde `js/comun.js` (se muda desde core.js).
- Base sin migrar (las RPC nuevas dan 404 `PGRST202`): la app de niñeras sigue andando sin la
  pantalla de perfil ni la sección de sittings; el panel sin el bloque de la foto.
- Textos nuevos en "tú" a `docs/fase1/textos-provisorios.md` (sección "Etapa 2"); los del panel en voseo.

**Review Focus de la etapa** (cada línea tiene su test en la tarea que la cubre):
1. Sitting que cruza la medianoche (`termina_dia_siguiente`): las horas se ven como "22:00 a
   02:00 (termina al día siguiente)" y el `.ics` termina al otro día (2.4).
2. Familia sin filas en `hijos_familia` pero con texto en `familias.ninos`: ese texto, recortado a
   80 (2.1 y 2.4).
3. `madre_nombre_inicial`: "María Pérez" → "María P.", "Pérez" → "Pérez", "Familia Pérez" →
   "Familia P.", vacío o null → "la familia" (2.1).
4. Falla al subir la foto o al guardar el perfil: aviso claro, nada guardado a medias, el
   formulario sigue con lo escrito (2.3). La foto va siempre a la misma ruta
   `fotos/<ninera_id>/propuesta.jpg` con `upsert`: nunca quedan huérfanas.
5. Una niñera no puede subir fuera de su carpeta ni ver la de otra; la admin ve y borra todo;
   `ninera_guardar_perfil` rechaza una ruta de foto ajena (2.1).

### Tarea 2.1: migración `perfil_ninera`, funciones y pruebas SQL

**Archivos:**
- Crear: `supabase/migraciones/20261027_perfil_ninera.sql`, `..._DESHACER.sql`,
  `supabase/pruebas/fase1_perfil.sql`
- Modificar: `supabase/schema.sql`, `supabase/pruebas/catalogo_seguridad.sql`,
  `scripts/probar-sql.mjs` (sumar `storage.foldername(name text) returns text[]` al Supabase de
  mentira: `string_to_array` sin el último tramo, como el real)

**Interfaces (produce):**
- Columnas: `ninieras.perfil_app_en timestamptz`, `ninieras.foto_propuesta_ruta text`,
  `ninieras.foto_propuesta_en timestamptz`.
- Bucket privado `ninieras-privado` (`public = false`). Políticas sobre `storage.objects`:
  `ninieras_privado_propio` (`for all to authenticated`, using y with check: `bucket_id =
  'ninieras-privado' and (storage.foldername(name))[2] = (select public.ninera_actual())::text`) y
  `ninieras_privado_admins` (`for all to public`, `bucket_id = 'ninieras-privado' and (select
  public.es_usuaria_autorizada())`). Rutas: `fotos/<ninera_id>/propuesta.jpg` (la etapa 4 suma
  `firmas/`, `rcp/` y la 10 `carsitting/` con el mismo criterio).
- `hoy_mvd() returns date` (`language sql stable`, sin security definer):
  `(now() at time zone 'America/Montevideo')::date`.
- `madre_nombre_inicial(p_nombre text) returns text` (`immutable`): primera palabra + inicial de la
  última con punto; una palabra → la palabra; vacío o null → `'la familia'`.
- `chicos_texto(p_familia_id uuid) returns text` (`stable`, invoker: llamada desde una security
  definer corre como su dueña; llamada directa por una niñera ve 0 filas y da null): de
  `hijos_familia` por `orden`, edad = años enteros desde `fecha_nacimiento` (`age(hoy_mvd(), …)`)
  o `edad_declarada + años enteros desde edad_declarada_en` (la misma regla que `edadHijo` en
  core.js); "1 chico (5 años)", "2 chicos (3 y 5 años)", "3 chicos (2, 4 y 7 años)", edad 0 →
  "menos de 1 año", sin ninguna edad → "2 chicos"; sin filas → `left(trim(familias.ninos), 80)`;
  nada → null.
- `ninera_mi_perfil() returns table (id uuid, nombre text, telefono text, tipo text, zona text,
  barrios text, cuenta_bancaria text[], foto text, foto_propuesta_ruta text, foto_propuesta_en
  timestamptz, perfil_app_en timestamptz, app_activada_en timestamptz)` (`stable`, security
  definer): la fila de `ninera_actual()`; vacío si null.
- `ninera_zonas_disponibles() returns table (id uuid, nombre text, orden integer,
  fuera_de_montevideo boolean)` (`stable`, security definer): `zona_grupos` por `orden`; vacío si
  no es niñera.
- `ninera_guardar_perfil(p_tipo text, p_zonas text[], p_cuenta text[], p_foto_ruta text default
  null) returns void` (`volatile`, security definer): `raise 'no_autorizada'` si `ninera_actual()`
  es null; `'tipo_invalido'` si `p_tipo` no está en ('Niñera', 'Traslados', 'Ambas');
  `'sin_zonas'` si `p_zonas` viene vacío; `'zona_desconocida'` si alguna no es un
  `zona_grupos.nombre`; `'foto_invalida'` si `p_foto_ruta` no es null y no empieza con
  `'fotos/' || v_id || '/'`. Guarda `tipo`, `zona = array_to_string(p_zonas, '/')`,
  `cuenta_bancaria` = las líneas de `p_cuenta` sin vacíos (null si no queda ninguna),
  `perfil_app_en = coalesce(perfil_app_en, now())` y, con `p_foto_ruta`, `foto_propuesta_ruta` y
  `foto_propuesta_en = now()`.
- `ninera_mis_sittings() returns table (id uuid, tipo text, fecha date, hora_inicio time,
  hora_fin time, termina_dia_siguiente boolean, estado text, zona text, madre text, direccion
  text, origen text, destino text, chicos text, notas_para_ninera text)` (`stable`, security
  definer): `sittings_traslados s left join familias f on f.id = s.familia_id` con `s.ninera_id =
  ninera_actual()`, `not s.cancelado`, `s.estado in ('previsto', 'confirmado')`, `s.fecha between
  hoy_mvd() and hoy_mvd() + 60`, orden `fecha, hora_inicio`. `zona = f.zona`, `madre =
  madre_nombre_inicial(coalesce(f.nombre, s.familia_nombre))`, `direccion / origen / destino` solo
  con `estado = 'confirmado'` (si no, null), `chicos = chicos_texto(f.id)`, `notas_para_ninera =
  null::text` (la columna de `solicitudes` llega en la etapa 5).
- Permisos como en la etapa 1: `revoke execute ... from public, anon; grant execute ... to
  authenticated` en las cuatro security definer. `catalogo_seguridad.sql` suma a
  `lista_authenticated`: `ninera_guardar_perfil(p_tipo text, p_zonas text[], p_cuenta text[],
  p_foto_ruta text)`, `ninera_mi_perfil()`, `ninera_mis_sittings()`, `ninera_zonas_disponibles()`,
  cada una con su comentario de guardia.
- Compatible con la app publicada: columnas nuevas vacías, bucket y políticas nuevas, funciones
  nuevas. Sin respaldo (no toca filas). El DESHACER borra funciones, políticas, el bucket (solo si
  está vacío: si tiene objetos, los lista y frena, para no perder fotos propuestas) y las columnas.

- [x] **Paso 1:** escribir `supabase/pruebas/fase1_perfil.sql` (mismo esqueleto que
  `fase1_cuentas_ninieras.sql`: `pg_temp.verificar`, `pg_temp.error_de`, datos inventados con una
  admin, dos niñeras con cuenta, dos familias con hijos (una con `fecha_nacimiento`, otra con
  `edad_declarada` vieja, una tercera solo con `ninos`) y sittings: 2 de Ana en los próximos
  días (uno `previsto` y uno `confirmado` con dirección), 1 cancelado, 1 de hace un mes, 1 a 70
  días, 1 de Bruno; "ser" cada cuenta con `set local role authenticated` + `request.jwt.claims`).
  Casos: lo de la migración está (3 columnas, bucket, 2 políticas, 7 funciones);
  `madre_nombre_inicial` 4 casos; `chicos_texto` 4 casos (nacimiento, declarada vieja, solo
  `ninos`, nada → null); como Ana: `ninera_mi_perfil()` devuelve solo su fila con la cuenta;
  `ninera_zonas_disponibles()` las zonas por orden; `ninera_mis_sittings()` devuelve exactamente
  sus 2 (ids), el previsto con `direccion` null y el confirmado con la dirección, y
  `pg_get_function_result('public.ninera_mis_sittings'::regproc)` no contiene `cobro`, `pago`,
  `notas` (salvo `notas_para_ninera`) ni `precio`; `select count(*) from sittings_traslados`
  directo como Ana = 0; `ninera_guardar_perfil` rechaza `'Chofer'`, zonas vacías, `'Narnia'` y
  `'fotos/<id de Bruno>/propuesta.jpg'`, y acepta ('Ambas', {'Pocitos','Carrasco'}, {'Banco X',
  '', 'cuenta 0001234567'}, 'fotos/<id de Ana>/propuesta.jpg') dejando `zona =
  'Pocitos/Carrasco'`, `cuenta_bancaria = {'Banco X','cuenta 0001234567'}`, `perfil_app_en` puesto
  una vez (segunda llamada no lo mueve) y `foto_propuesta_ruta` puesta; como la admin,
  `ninera_guardar_perfil` da `no_autorizada` y `ninera_mi_perfil()` vacío; storage: como Ana
  `insert into storage.objects (bucket_id, name)` bajo su carpeta anda, bajo la de Bruno falla
  (RLS), `select` ve solo la suya; como admin ve las dos y borra.
- [x] **Paso 2:** correr `PGLITE_DIR=<pglite> node scripts/probar-sql.mjs --schema
  <schema de main> --migracion supabase/migraciones/20261027_perfil_ninera.sql
  supabase/pruebas/fase1_perfil.sql`. Esperado: falla (la migración no existe).
- [x] **Paso 3:** escribir la migración (encabezado con qué suma y por qué, en una transacción),
  el DESHACER, sumar `storage.foldername` a `probar-sql.mjs` y reflejar todo en `schema.sql`
  (columnas en la tabla, bucket en el insert de buckets, políticas junto a las de `comprobantes`,
  funciones después de `crear_invitacion_ninera`).
- [x] **Paso 4:** correr el paso 2, más aplicar → deshacer → aplicar (`--migracion` tres veces),
  más `catalogo_seguridad.sql` y `fase1_cuentas_ninieras.sql` con la migración, más todos los
  `supabase/pruebas/*.sql` sobre `schema.sql`. Esperado: todo OK.
- [x] **Paso 5:** commit: `Etapa 2: migración perfil_ninera (perfil, foto propuesta, próximos
  sittings) y pruebas SQL`.

### Tarea 2.2: `achicarFoto` compartida y simulador de la etapa

**Archivos:**
- Modificar: `js/comun.js` (recibe `achicarFoto` tal cual desde `js/core.js`, con su
  comentario), `js/core.js` (la saca), `tests/support/rpc-ninera.js`, `tests/support/app.js`,
  `tests/support/fuentes.js` (`ORDEN_SCRIPTS_NINERA` con `perfil` entre `cuenta` e `inicio`),
  `ninera/index.html` (`<script src="js/perfil.js">` antes de `inicio.js`), crear
  `ninera/js/perfil.js` vacío con su comentario de cabecera.
- Test: `tests/estatico.spec.js` (ya controla el orden y las globales), `tests/mejoras-hoy.spec.js`
  (las fotos livianas del panel siguen igual).

**Interfaces (produce):**
- `rpcNinera(db, nineraId)` suma: `ninera_mi_perfil` (la fila de `db.ninieras` con las columnas
  de 2.1), `ninera_zonas_disponibles` (`db.zona_grupos` por `orden`), `ninera_guardar_perfil`
  (`cuerpo = {p_tipo, p_zonas, p_cuenta, p_foto_ruta}`: valida como la SQL y escribe en la fila;
  devuelve null), `ninera_mis_sittings` (filtra `db.sittings_traslados` con las mismas reglas,
  `madre` y `chicos` calculados desde `db.familias` y `db.hijos_familia`, dirección solo en
  confirmados). Un test pisa cualquiera con `e.rpc.nombre = () => …` o la hace fallar con
  `e.fallar`.
- `app.js`, storage: `POST /storage/v1/object/sign/<bucket>/<ruta>` responde `{ signedURL:
  '/object/sign/<bucket>/<ruta>?token=ficticio' }`; `GET /storage/v1/object/...` (descarga o la
  URL firmada) responde un PNG de 1×1 con `content-type: image/png`; `POST/PUT
  /storage/v1/object/<bucket>/<ruta>` sigue anotándose en `e.escrituras` con la ruta. Con
  `baseSinMigrar`, las RPC nuevas ya dan 404 `PGRST202` (genérico).
- Datos ficticios (`datos.js`): Ana sin `zona` ni `perfil_app_en` (primer ingreso), Carla con
  `zona 'Pocitos/Carrasco'`, `perfil_app_en` y `foto_propuesta_ruta 'fotos/<id>/propuesta.jpg'`;
  `hijos_familia` de la familia Prueba Uno con dos hijos; sittings futuros de Ana: hoy
  confirmado 18:00 a 22:00, mañana previsto 22:00 a 02:00 (`termina_dia_siguiente`), uno a 70
  días (no sale). Nada de eso rompe los tests que ya existen (correrlos).

- [x] **Paso 1:** mover `achicarFoto` a `comun.js`; `npm run test:static` y `PUERTO_TESTS=4195
  npx playwright test tests/mejoras-hoy.spec.js tests/ninera-cuenta.spec.js`. Esperado: pasan.
- [x] **Paso 2:** simulador y datos; correr `tests/ninera-cuenta.spec.js`, `tests/humo.spec.js`,
  `tests/ninieras-lista.spec.js`, `tests/fijos.spec.js`, `tests/finanzas.spec.js` (los datos nuevos
  no cambian totales: los sittings nuevos de Ana van en $0 y a más de 30 días de los meses que
  miran esos tests, o se ajustan sus expectativas con el porqué). Esperado: pasan.
- [x] **Paso 3:** commit: `Etapa 2: achicarFoto en comun.js, perfil.js en el orden de carga y
  simulador de perfil y sittings`.

### Tarea 2.3: "Completa esto una sola vez" y "Mi perfil" (`ninera/js/perfil.js`)

**Archivos:**
- Modificar: `ninera/js/perfil.js`, `ninera/js/arranque.js` (`continuarDespuesDeInstalar`),
  `ninera/js/inicio.js` (link "Mi perfil" en el pie, junto a "Mi cuenta"), `ninera/estilos.css`,
  `docs/fase1/textos-provisorios.md`
- Test: `tests/ninera-perfil.spec.js`

**Interfaces (produce):**
- `cargarPerfilNinera()` → `{ perfil, sinMigrar }`: RPC `ninera_mi_perfil`; 404 `PGRST202` →
  `sinMigrar: true`; otro error → lanza.
- `perfilIncompleto(perfil)` (pura): true si `!perfil.zona` (sin zonas = nunca lo completó).
- `pantallaPerfil(modo, perfil)` con `modo` `'primera'` (título "Completa esto una sola vez") o
  `'editar'` (título "Mi perfil"), ruta `#perfil`. Campos: "¿Qué servicios realizas?" con tres
  botones de radio Sittings / Carsittings / Ambos (valores `'Niñera'` / `'Traslados'` / `'Ambas'`,
  precargado desde `perfil.tipo`); "Zonas donde puedes tomar servicios" con una casilla por grupo
  (`ninera_zonas_disponibles`, marcadas las de `perfil.zona` partido por "/"); "Datos bancarios
  para pagarte" `textarea` (una cuenta por línea, precargado con `perfil.cuenta_bancaria`) y
  helper "Banco, tipo y número de cuenta, uno por línea."; "Tu foto (opcional)" `input
  type=file accept="image/*"` con vista previa y helper "La ve el equipo y, si la aprueban, pasa a
  tu perfil."; si `perfil.foto_propuesta_ruta`, debajo "Foto enviada el dd/mm, el equipo la va a
  revisar."; al marcar Carsittings o Ambos, "Pronto vas a poder cargar los datos del auto desde
  aquí."; botón "Guardar" con `conGuardado(this, ()=>guardarPerfilNinera(modo))`.
- `guardarPerfilNinera(modo)`: sin zona marcada → "Elige al menos una zona." (sin llamar a nada);
  con foto elegida → `achicarFoto(file, 1600, 0.8)` → `sbn.storage.from('ninieras-privado')
  .upload('fotos/<id>/propuesta.jpg', archivo, { upsert: true, contentType: 'image/jpeg' })`; si
  falla → "No pudimos subir tu foto. Revisa tu conexión a internet y vuelve a intentar." y no
  sigue; después RPC `ninera_guardar_perfil` con `p_foto_ruta` (o null); error → "No pudimos
  guardar tu perfil. Revisa tu conexión a internet y vuelve a intentar." con lo escrito intacto;
  OK → toast "¡Listo! Tu perfil quedó guardado." y `renderInicio()`.
- `arranque.js`: en `continuarDespuesDeInstalar`, después de los avisos:
  `const { perfil, sinMigrar } = await cargarPerfilNinera()`; si no `sinMigrar` y
  `perfilIncompleto(perfil)` → `pantallaPerfil('primera', perfil)`; si no → `renderInicio()`. Un
  error de red ahí → `mostrarErrorCargaInicio()`.
- `inicio.js`: en el pie, "Mi perfil" → `abrirMiPerfil()` (carga el perfil y abre
  `pantallaPerfil('editar', perfil)`); con `sinMigrar` el link no se muestra.
- Textos nuevos (en "tú") a `textos-provisorios.md`, sección "Etapa 2: perfil".

- [x] **Paso 1:** escribir `tests/ninera-perfil.spec.js`: (a) Ana entra por primera vez → la
  pantalla "Completa esto una sola vez" con los tres servicios, las zonas de `zona_grupos` y los
  datos bancarios; sin marcar zona, "Guardar" → "Elige al menos una zona." y ninguna RPC; (b)
  marcar Ambos + Pocitos + dos líneas de cuenta → RPC `ninera_guardar_perfil` con `{p_tipo:
  'Ambas', p_zonas: ['Pocitos'], p_cuenta: ['Banco Ficticio', 'CA 0001234567'], p_foto_ruta:
  null}` y después el inicio; el texto "Pronto vas a poder cargar los datos del auto" aparece al
  marcar Ambos; (c) con una foto (un PNG de 300×200 inyectado con `setInputFiles`) → una
  escritura a `/storage/v1/object/ninieras-privado/fotos/<id de Ana>/propuesta.jpg` y la RPC con
  esa `p_foto_ruta`; (d) la subida falla (`e.fallar` sobre `/storage/v1/`) → mensaje de la foto y
  ninguna RPC; (e) la RPC falla (`e.fallar`) → mensaje de guardar, el formulario sigue con lo
  escrito; (f) doble toque en "Guardar" con `e.demoraEscrituras = 400` → una sola RPC; (g) Carla
  (perfil completo) entra directo al inicio y "Mi perfil" abre la edición precargada (Ambas,
  Pocitos y Carrasco marcadas, cuenta en el textarea, "Foto enviada el dd/mm"); (h)
  `baseSinMigrar` → inicio sin "Mi perfil" ni pantalla de perfil; (i) 390 px: la pantalla sin
  scroll horizontal, casillas de 24 px, captura; (j) el HTML de la pantalla no contiene `/\$\d/`
  ni `/\bpago/i`. Todos con `verificarLimpio(e)`.
- [x] **Paso 2:** correr `PUERTO_TESTS=4195 npx playwright test tests/ninera-perfil.spec.js`.
  Esperado: fallan todos.
- [x] **Paso 3:** implementar `perfil.js`, los cambios de `arranque.js` e `inicio.js`, las clases
  que falten en `estilos.css` (radios y casillas grandes, vista previa de la foto, `textarea`) y
  los textos provisorios.
- [x] **Paso 4:** correr el spec nuevo más `tests/ninera-cuenta.spec.js` y `npm run test:static`.
  Esperado: pasan.
- [x] **Paso 5:** commit: `Etapa 2: perfil de la niñera (servicios, zonas, datos bancarios, foto
  propuesta)`.

### Tarea 2.4: "Próximos sittings" en el inicio (`ninera/js/inicio.js`)

**Archivos:**
- Modificar: `ninera/js/inicio.js`, `ninera/estilos.css`, `docs/fase1/textos-provisorios.md`
- Test: `tests/ninera-sittings.spec.js`

**Interfaces (produce):**
- `renderInicio()` pinta primero lo de hoy (saludo, avisos, "No tienes pedidos por ahora.") y
  debajo `<section id="proximos-sittings">` con el título "Próximos sittings" y "Cargando…";
  después `cargarProximosSittings()`.
- `cargarProximosSittings()`: RPC `ninera_mis_sittings`; 404 `PGRST202` → saca la sección; otro
  error → "No pudimos cargar tus sittings. Revisa tu conexión a internet y vuelve a intentar." con
  "Reintentar"; vacío → "No tienes sittings próximos."; con datos → `htmlSittingsNinera(filas)`.
- `htmlSittingsNinera(filas)` (pura): agrupadas por fecha con `textoDiaNinera(fecha, hoy)`
  ("Hoy", "Mañana", "jue 30/10": día abreviado en minúscula y dd/mm), cada una un botón-tarjeta
  con `horasSittingNinera(s)` ("18:00 a 22:00"; sin fin: "desde las 18:00"; cruza: "22:00 a
  02:00, termina al día siguiente"), tipo ("Sitting" / "Traslado"), zona, "Madre: …" y
  "Chicos: …" (solo si vienen), `onclick="abrirDetalleSittingNinera(${argJs(id)})"`.
- `abrirDetalleSittingNinera(id)`: `abrirModalNinera` con día, horas, tipo, zona, madre, chicos
  y: si `direccion` (confirmado) → la dirección (y origen / destino en un traslado), botón "Cómo
  llegar" (`https://maps.apple.com/?q=` en iPhone (`/iPhone|iPad/.test(navigator.userAgent)`),
  si no `https://www.google.com/maps/search/?api=1&query=`, con `encodeURIComponent` y
  `urlSegura`, `target=_blank rel=noopener`); si no → "La dirección aparece el día del sitting.";
  botón "Agregar al calendario" → `descargarIcsSitting(s)`.
- `armarIcsSitting(s, hoyISO)` (pura, devuelve el texto): `BEGIN:VCALENDAR`, `VERSION:2.0`,
  `PRODID:-//Parents Break//App ninieras//ES`, `BEGIN:VEVENT`, `UID:<id>@parentsbreak`,
  `DTSTAMP` en UTC, `DTSTART;TZID=America/Montevideo:AAAAMMDDTHHMMSS`, `DTEND` igual (si
  `termina_dia_siguiente`, con `sumarDiasISO(fecha, 1)`; sin `hora_fin`, DTEND = inicio + 1 h),
  `SUMMARY:Sitting Parents' Break` (o Traslado), `LOCATION:` solo con dirección, `DESCRIPTION:`
  con madre y chicos. Sin montos. `descargarIcsSitting` arma un `Blob` `text/calendar` y lo baja
  con un `<a download="sitting-AAAA-MM-DD.ics">`.
- Textos nuevos a `textos-provisorios.md`, sección "Etapa 2: próximos sittings".

- [x] **Paso 1:** escribir `tests/ninera-sittings.spec.js`: (a) Ana (hoy 04/10/2026 en el
  simulador) ve "Hoy" con "18:00 a 22:00", "Mañana" con "22:00 a 02:00, termina al día
  siguiente", madre "Madre: Prueba U." o la inicial que corresponda a `datos.js`, chicos "2
  chicos (…)", y NO el sitting a 70 días; (b) tocar el de hoy (confirmado) → la dirección y "Cómo
  llegar" con la dirección codificada en el `href`; el de mañana (previsto) → "La dirección
  aparece el día del sitting." sin botón; (c) "Agregar al calendario" → `armarIcsSitting` del de
  mañana tiene `DTSTART;TZID=America/Montevideo:20261005T220000` y `DTEND;TZID=America/Montevideo:20261006T020000`,
  y el click dispara una descarga `sitting-2026-10-05.ics` (`page.waitForEvent('download')`);
  (d) `e.rpc.ninera_mis_sittings = () => []` → "No tienes sittings próximos."; (e) `e.fallar`
  en la RPC → el mensaje y "Reintentar" que vuelve a pedir; (f) `baseSinMigrar` → sin la
  sección, el inicio intacto; (g) el HTML del inicio y del detalle no contiene `/\$\d/` ni
  `/\bpago/i`, y el `.ics` tampoco; (h) 390 px: captura, sin scroll horizontal. `verificarLimpio(e)`.
- [x] **Paso 2:** correr el spec. Esperado: fallan todos salvo los que miran lo de la etapa 1.
- [x] **Paso 3:** implementar en `inicio.js` y `estilos.css`, y los textos provisorios.
- [x] **Paso 4:** correr el spec nuevo, `tests/ninera-cuenta.spec.js`, `tests/ninera-perfil.spec.js`
  y `npm run test:static`. Esperado: pasan.
- [x] **Paso 5:** commit: `Etapa 2: próximos sittings en el inicio de la niñera (sin montos, dirección
  solo confirmada, cómo llegar y calendario)`.

### Tarea 2.5: panel: perfil completado y foto propuesta en la ficha

**Archivos:**
- Modificar: `js/ninieras.js` (`verNinera`, `estadoAppNinera` / `cargarEstadoAppNinera`, y la
  lectura de `ninieras` si pide columnas explícitas)
- Test: `tests/foto-propuesta.spec.js`

**Interfaces (produce):**
- En la fila "App" de la ficha, después del estado: "Perfil completado en la app el dd/mm"
  (`fechaCortaApp(n.perfil_app_en)`) o nada.
- Bloque `#vn-foto-propuesta` debajo de la foto, solo si `n.foto_propuesta_ruta`: "Foto propuesta
  por la niñera el dd/mm", la imagen con `sb.storage.from('ninieras-privado').createSignedUrl(ruta,
  600)` (si falla, "No se pudo mostrar la foto" y los botones igual), botones "Usar como foto del
  CV" (`conGuardado(this, ()=>aprobarFotoPropuesta(id))`) y "Descartar" (`confirmarAccion` con el
  botón "Descartar la foto" → `descartarFotoPropuesta(id)`).
- `aprobarFotoPropuesta(id)`: descarga la propuesta (`.download(ruta)`), la sube a
  `ninieras-fotos` con el mismo nombre que usa `subirFotoNinera` para esa niñera (`upsert`),
  `update ninieras set foto = <URL pública>, foto_propuesta_ruta = null, foto_propuesta_en =
  null` con `sbGuardar`, borra la propuesta del bucket privado (si falla, solo se anota en
  consola: ya no se muestra) y repinta la ficha; toast "Foto del CV actualizada.". Si falla la
  descarga, la subida o el update → toast con qué falló, nada a medias (el update va último).
- `descartarFotoPropuesta(id)`: borra el objeto y limpia las dos columnas; toast "Foto propuesta
  descartada.".

- [x] **Paso 1:** escribir `tests/foto-propuesta.spec.js`: (a) la ficha de Carla muestra "Perfil
  completado en la app el …", "Foto propuesta por la niñera el …", una imagen con la URL firmada
  y los dos botones; la de Ana, nada de eso; (b) "Usar como foto del CV" → descarga desde
  `ninieras-privado`, subida a `ninieras-fotos` (escritura con la ruta), PATCH a `ninieras` con
  `foto` y las dos columnas en null, borrado de la propuesta, y la ficha repintada sin el bloque;
  (c) falla la subida → toast de error y ningún PATCH; (d) falla el PATCH → toast y la ficha sigue
  mostrando la propuesta; (e) doble toque → una sola subida; (f) "Descartar" → confirmación,
  borrado y PATCH con null; (g) `baseSinMigrar` (la fila sin las columnas) → la ficha sin el
  bloque; (h) 390 px. `verificarLimpio(e)`.
- [x] **Paso 2:** correr el spec. Esperado: fallan.
- [x] **Paso 3:** implementar en `ninieras.js`.
- [x] **Paso 4:** correr el spec nuevo más `tests/invitar-app.spec.js`, `tests/ninieras-lista.spec.js`,
  `tests/escape.spec.js` y `npm run test:static`. Esperado: pasan.
- [x] **Paso 5:** commit: `Etapa 2: la ficha muestra el perfil completado y aprueba o descarta la foto
  propuesta`.

### Tarea 2.6: documentación, revisión final, PR y migración (con OK)

- [x] **Paso 1:** `CLAUDE.md`: orden de carga de `ninera/index.html` (perfil antes de inicio), la lista
  de tests (los tres specs y `fase1_perfil.sql`), "Convenciones": la foto propuesta (bucket privado
  `ninieras-privado` con carpeta por niñera, la admin aprueba desde la ficha; nunca pisa `foto`
  sola), `achicarFoto` en comun.js (la niñera sube con 1600 y 0,8; el panel sigue con 800) y
  `ninera_mis_sittings` sin plata y con dirección solo confirmada; "Fase 1": etapa 2 hecha.
  `docs/fase1/decisiones.md` 5.3 y 5.5: la foto propuesta y el bucket ya en la etapa 2;
  `plan-implementacion.md`: casillas tildadas.
- [ ] **Paso 2:** revisión final de toda la rama con un revisor fresco (Opus), con la lista de 5.3 de
  lo que la niñera nunca ve; arreglar lo que encuentre.
- [ ] **Paso 3:** rebase sobre `origin/main`, `npm test` completo, push, PR con: qué quedó hecho, las
  decisiones, el SQL de la migración listo para el SQL Editor y la verificación (`select count(*)
  from pg_proc where proname like 'ninera_%'` = 6: las 2 de la etapa 1 más las 4 nuevas, `select id, public from storage.buckets where id
  = 'ninieras-privado'`, las 2 políticas en `pg_policies`). Diego revisa el archivo contra la base
  y la aplica él.
- [ ] **Paso 4:** con la migración aplicada y verificada, y el CI verde: merge con merge commit.
  Después, Diego prueba con la niñera de práctica (perfil, foto, sittings) y aprueba la foto desde
  la ficha.

---

## Etapa 3: avisos y chat

Rama `claude/fase1-avisos-chat` (worktree `.claude/worktrees/avisos-chat`). Migración
`20261029_avisos_chat.sql` + `_DESHACER.sql`. Edge Function nueva `enviar-avisos`. Detallada el
29/10/2026. Nada se aplica ni se publica hasta después de la mudanza (#85) y con OK de Diego.

**Objetivo:** una cola de avisos en la base (`avisos`) que manda push a niñeras y a admins y que
cada etapa siguiente usa para sus reglas, y un chat por niñera entre ella y las tres admins, en las
dos puertas.

**Decisiones de Diego (29/10/2026):**
- Una admin le puede escribir a cualquier niñera que tenga la app. La regla "solo recibe mensajes
  si tiene un pedido" (reglas, sección 3) se lee como "nada de mensajes masivos ni publicidad".
- El chat es solo de texto en esta etapa; las fotos van después.
- El aviso del chat llega siempre, también de noche.

**Restricciones de la etapa (además de las globales):**
- La niñera no toca `chat_mensajes` ni `avisos` de otra: RLS por `(select public.ninera_actual())`;
  escribe solo por funciones `security definer` (no puede elegir `de`, `autor` ni `ninera_id`).
- `encolar_aviso`, `reclamar_avisos`, `programar_avisos` y `admins_activas_mails` no las ejecuta
  `authenticated` ni `anon` (solo triggers, el cron y la clave de servicio): no entran en la lista
  permitida. Las de la niñera sí, con su prueba.
- El push nunca lleva plata. El del chat lleva el texto recortado a 120 caracteres.
- Textos de la niñera en "tú" (`textos.md` 1 y 6: "Contáctate con una operadora de Parents'
  Break.", "[nombre de la admin] / [mensaje]"); los del panel en voseo ("[niñera] / [mensaje]").
- Base sin migrar: la app de niñeras sin "Mensajes" ni "Avisos"; el panel sin la tarjeta, el chat de
  la ficha ni los avisos nuevos en la campanita, sin errores.
- Una Edge Function nueva: la lógica en `envio.ts` sin red, con tests de Deno; `index.ts` conecta.

**Review Focus de la etapa:**
1. Dos admins contestan a la vez, o la niñera escribe mientras la admin tiene el hilo abierto: los
   mensajes aparecen por Realtime en orden, sin duplicarse y sin perder lo que se está escribiendo
   (3.4 y 3.5).
2. Un aviso que se manda dos veces (el trigger y el cron al mismo tiempo): `reclamar_avisos` lo
   entrega una sola vez (3.1, prueba SQL con dos reclamos seguidos).
3. Una suscripción vencida (404/410) se borra y no frena las demás; un error de push reintenta hasta
   3 veces cada 2 minutos y después queda con `error` (3.2).
4. Texto vacío, solo espacios, de más de 2.000 caracteres o con HTML: no se guarda lo vacío ni lo
   largo, y todo se muestra como texto (3.1, 3.4, 3.5).
5. Una admin dada de baja (`usuarias_autorizadas.activa = false`) no recibe push; la que escribió un
   aviso con `datos.excepto` tampoco (3.2).

### Tarea 3.1: migración `avisos_chat`, funciones y pruebas SQL

**Archivos:**
- Crear: `supabase/migraciones/20261029_avisos_chat.sql`, `..._DESHACER.sql`,
  `supabase/pruebas/fase1_avisos_chat.sql`
- Modificar: `supabase/schema.sql`, `supabase/pruebas/catalogo_seguridad.sql`

**Interfaces (produce):**
- `avisos` como `decisiones.md` 5.4 (`id, clave unique, para_ninera_id, para_admin, tipo, titulo,
  cuerpo, url, datos jsonb, enviar_desde default now(), enviado_en, error, intentos default 0,
  leido_en, creado_en default now()`), `check` de que exactamente uno de `para_ninera_id` /
  `para_admin` no es null, FK `para_ninera_id → ninieras(id) on delete cascade`, índices
  `(enviado_en, enviar_desde)` y `(para_ninera_id, creado_en desc)`. RLS: `avisos_ninera_leer`
  (`select to authenticated using para_ninera_id = (select public.ninera_actual())`) y
  `avisos_admins_leer` (`select to public using para_admin is not null and (select
  public.es_usuaria_autorizada())`). Sin políticas de escritura.
- `chat_mensajes (id uuid pk, ninera_id uuid not null → ninieras on delete cascade, de text check
  in ('ninera','admin'), autor text not null, texto text not null check (char_length(btrim(texto))
  between 1 and 2000), creado_en default now(), leido_ninera_en, leido_admin_en)`, índice
  `(ninera_id, creado_en)`. RLS: `chat_ninera_leer` (select, `ninera_id = (select
  ninera_actual())`), `chat_admins_leer` y `chat_admins_marcar` (select y update,
  `(select es_usuaria_autorizada())`: marcan `leido_admin_en` también en los de la niñera) y
  `chat_admins_escribir` (insert, `with check ((select es_usuaria_autorizada()) and de = 'admin')`).
  Sin delete.
- `encolar_aviso(p_clave text, p_para_ninera uuid, p_para_admin text, p_tipo text, p_titulo text,
  p_cuerpo text, p_url text, p_datos jsonb default '{}', p_enviar_desde timestamptz default now())
  returns boolean` (`security definer`; `on conflict (clave) do nothing`; devuelve si insertó;
  `revoke ... from public, anon, authenticated`).
- `reclamar_avisos(p_max int default 50) returns setof avisos` (`security definer`, solo
  `service_role`): `update avisos set enviado_en = now(), intentos = intentos + 1 where id in
  (select id from avisos where enviado_en is null and enviar_desde <= now() order by enviar_desde
  limit p_max for update skip locked) returning *`.
- `programar_avisos() returns int` (`security definer`, solo `service_role` y el cron): en esta
  etapa devuelve 0; comentario con la estructura (una función `programar_avisos_<regla>()` por
  regla, sumadas acá) para que las etapas 4 a 10 le agreguen las suyas.
- `admins_activas_mails() returns setof text` (`security definer`, solo `service_role`): los mails de
  `auth.users` de las filas activas de `usuarias_autorizadas`.
- Niñera (`security definer`, `authenticated`, guardia `ninera_actual()`; en la lista permitida):
  `ninera_enviar_mensaje(p_texto text) returns chat_mensajes` (`'no_autorizada'` si no es niñera,
  `'mensaje_vacio'` / `'mensaje_largo'`; guarda `de = 'ninera'`, `autor` = nombre de la ficha,
  el texto con `btrim`), `ninera_marcar_chat_leido() returns int` (pone `leido_ninera_en` a los de
  `de = 'admin'` sin leer; devuelve cuántos) y `ninera_marcar_avisos_leidos() returns int` (pone
  `leido_en` a sus avisos sin leer).
- Trigger `chat_mensajes_aviso` (`after insert`, función `security definer` interna): `de =
  'admin'` → `encolar_aviso('chat:' || id, ninera_id, null, 'chat', autor, left(texto, 120),
  '#chat', jsonb_build_object('mensaje_id', id))`; `de = 'ninera'` → `encolar_aviso('admin:chat:'
  || id, null, 'todas', 'chat', <nombre de la niñera>, left(texto, 120), '?ir=ninieras&ninera=' ||
  ninera_id, jsonb_build_object('mensaje_id', id, 'ninera_id', ninera_id))`.
- Trigger `avisos_enviar_ya` (`after insert on avisos`, `for each row when (new.enviar_desde <=
  now())`): `net.http_post` a `<SUPABASE_URL>/functions/v1/enviar-avisos` con `x-cron-secret` de
  `app_secrets 'cron_push_secret'` (misma URL fija que el cron de `enviar-push-urgentes`). Si
  falla el post, el aviso queda para el cron (sin `raise`).
- Cron `enviar-avisos` cada minuto: `select public.programar_avisos(); select net.http_post(...)`
  como el de `enviar-push-urgentes`.
- Realtime: `alter publication supabase_realtime add table public.chat_mensajes, public.avisos`.
- Compatible con la app publicada (todo nuevo, no toca filas). El DESHACER saca el cron, la
  publicación, triggers, funciones, políticas y las dos tablas (los mensajes se copian antes a
  `respaldo_chat_<fecha>` con RLS y sin políticas, si hay alguno).

- [x] **Paso 1:** `supabase/pruebas/fase1_avisos_chat.sql` (esqueleto de `fase1_perfil.sql`; una
  admin, dos niñeras con cuenta). Casos: lo de la migración está (2 tablas con RLS, 6 políticas: 2 de avisos y 4 de chat,
  las funciones, 2 triggers, el cron, la publicación); `encolar_aviso` dos veces con la misma clave
  inserta una sola fila y devuelve `true` / `false`; el `check` de un solo destinatario;
  `reclamar_avisos(50)` dos veces seguidas no devuelve dos veces la misma fila, no devuelve una con
  `enviar_desde` en el futuro y suma `intentos`; como Ana: `ninera_enviar_mensaje('  hola  ')`
  guarda `'hola'`, `de = 'ninera'`, `autor` de su ficha, y encola `admin:chat:<id>` para `'todas'`
  con su nombre; vacío / solo espacios → `mensaje_vacio`; 2.001 caracteres → `mensaje_largo`;
  `select` directo de `chat_mensajes` y `avisos` ve solo lo suyo (0 de Bruno); `insert` directo
  en `chat_mensajes` falla (RLS); `ninera_marcar_chat_leido` y `ninera_marcar_avisos_leidos` tocan
  solo lo suyo; como la admin: `insert` con `de = 'admin'` encola `chat:<id>` para Ana con
  `titulo = autor` y el texto recortado a 120; `insert` con `de = 'ninera'` falla; lee los avisos
  de `'todas'` y no los de Ana; anon no ejecuta nada ni lee nada; `encolar_aviso`,
  `reclamar_avisos`, `programar_avisos` y `admins_activas_mails` no las ejecuta `authenticated`;
  `admins_activas_mails()` no devuelve una admin con `activa = false`.
- [x] **Paso 2:** correrla sobre el schema de main con la migración. Esperado: falla.
- [x] **Paso 3:** migración, DESHACER, `schema.sql` y `catalogo_seguridad.sql` (las 3 de la niñera
  con su guardia).
- [x] **Paso 4:** la prueba nueva, aplicar → deshacer → aplicar, `catalogo_seguridad.sql`, las de la
  fase 1 con la migración y todas las de `supabase/pruebas/*.sql` sobre `schema.sql`. Esperado: OK.
- [x] **Paso 5:** commit `Etapa 3: migración avisos_chat (cola de avisos, chat y funciones de la
  niñera) y pruebas SQL`.

### Tarea 3.2: Edge Function `enviar-avisos`

**Archivos:**
- Crear: `supabase/functions/enviar-avisos/index.ts`, `envio.ts`, `envio_test.ts`

**Interfaces (produce):**
- `envio.ts` sin red: `procesarAvisos(deps, ahora)` con `deps = { reclamar(max), suscripciones
  NineraPorId(nineraIds), suscripcionesAdmins(), mailsAdminsActivas(), preferencias(usuarios),
  mandar(sub, payload), borrarSuscripcion(id), marcarError(id, error, reintentarDesde | null) }`.
  Por cada aviso: niñera → las suscripciones con `user_id` de su ficha; `'todas'` → las de
  `user_id is null` cuyo `usuario` está en `mailsAdminsActivas`, sin `datos.excepto`, filtradas por
  `notif_push_preferencias` del `tipo` (sin fila: activado). Payload `{id, titulo, mensaje: cuerpo,
  url}` (el formato de hoy: `sw.js` no cambia). 404/410 → `borrarSuscripcion`. Sin ninguna
  suscripción: no es error (la niñera lo ve en su lista). Si todas las entregas fallan por otro
  motivo: `marcarError` con reintento a `ahora + 2 min` si `intentos < 3`, si no `null` (queda con
  `error`). Devuelve `{reclamados, enviados, fallidos, borradas}`.
- `index.ts`: `x-cron-secret` contra `app_secrets 'cron_push_secret'` (comparación en tiempo
  constante, como `enviar-push-urgentes`), VAPID de `app_secrets`, `web-push@3.6.7`, la base con la
  clave de servicio; `reclamar` = RPC `reclamar_avisos(50)`, `mailsAdminsActivas` = RPC
  `admins_activas_mails`, `marcarError` = update de `avisos` (`error`, y `enviado_en = null,
  enviar_desde = <reintento>` si hay reintento). Sin secreto: 401.
- Tests de Deno (copia fuera del repo, `npx deno@2 test --allow-env`): niñera con dos dispositivos;
  admins con una inactiva, una con la preferencia apagada y la que está en `excepto`; 410 borra y
  sigue; error de push reintenta y al tercero no; aviso sin suscripciones; payload sin campos de
  más. `npx deno@2 check` de `index.ts`.
- [x] Pasos: tests rojos → `envio.ts` → verdes → `index.ts` + check → commit `Etapa 3: Edge Function
  enviar-avisos (cola de avisos por push)`. Publicación: después de la mudanza, con OK.

### Tarea 3.3: simulador de la etapa

**Archivos:** `tests/support/rpc-ninera.js`, `tests/support/app.js`, `tests/support/datos.js`,
`tests/support/fuentes.js`, `ninera/index.html` (`<script src="js/chat.js">` después de `inicio.js`,
antes de `arranque.js`), crear `ninera/js/chat.js` con su cabecera.

**Interfaces (produce):** `rpcNinera` suma `ninera_enviar_mensaje` (valida como la SQL, inserta en
`db.chat_mensajes` con `autor` de la ficha y devuelve la fila), `ninera_marcar_chat_leido`,
`ninera_marcar_avisos_leidos`; las lecturas de `chat_mensajes` y `avisos` de la niñera filtran por
su `ninera_id` como la RLS; `baseSinMigrar` hace 404 en esas RPC y en las dos tablas. Datos: un
hilo de Ana (dos de una admin "Paula Prueba", uno de Ana, el último sin leer por Ana) y un aviso
sin leer para Ana; un mensaje sin leer de Carla para las admins. `estado.emitirRealtime` ya sirve
para las dos puertas (comprobarlo con la de niñeras). Correr toda la suite: los datos nuevos no
pueden romper otros tests (si alguno cuenta filas, se ajusta con el porqué).
- [x] Commit `Etapa 3: simulador de chat y avisos`.

### Tarea 3.4: app de niñeras: chat y lista de avisos (`ninera/js/chat.js`)

**Interfaces (produce):**
- Inicio: debajo de "Próximos sittings", dos botones grandes: "Mensajes" (con la cantidad sin leer
  si hay) → `#chat`, y "Avisos" (con la cantidad sin leer) → `#mis-avisos`. Sin migrar, no están.
- `pantallaChatNinera()` (`#chat`): título "Equipo de Parents' Break", debajo "Contáctate con una
  operadora de Parents' Break.", el hilo (los suyos a la derecha; los del equipo a la izquierda con
  el `autor` arriba; fecha y hora cortas), un `textarea` y "Enviar" con `conGuardado` →
  `ninera_enviar_mensaje`; vacío → no manda; error → "No pudimos enviar tu mensaje. Revisa tu
  conexión a internet y vuelve a intentar." y el texto queda; al abrir, `ninera_marcar_chat_leido`.
  Realtime: canal `chat-ninera` sobre `chat_mensajes` con `filter: ninera_id=eq.<id>`; un mensaje
  nuevo se agrega al hilo sin repintar el `textarea` (no se pierde lo escrito) y sin duplicar el que
  ella misma acaba de mandar (por `id`). Al salir, se quita el canal. "Volver" al inicio.
- `pantallaAvisosNinera()` (`#mis-avisos`): lista de sus avisos (los últimos 50, el más nuevo
  arriba), cada uno con título, texto y fecha; tocar uno con `url` va ahí; al abrir,
  `ninera_marcar_avisos_leidos`. Vacía: "No tienes avisos."
- `irA` suma `#chat` y `#mis-avisos`. Un push con `url '#chat'` abre directo el hilo.
- Textos nuevos a `textos-provisorios.md` ("Etapa 3: chat y avisos"), en "tú".
- Test `tests/ninera-chat.spec.js`: el hilo con autor y orden; mandar (RPC con el texto, aparece una
  vez aunque llegue también por Realtime); recibir por Realtime con algo escrito en el `textarea`
  (queda); marcar leído al abrir; vacío no manda; falla con aviso y texto intacto; doble toque una
  sola RPC; HTML tramposo en el texto y en el autor se ve como texto; avisos: lista, vacía, marcar
  leídos, tocar uno con url; base sin migrar; abrir con `#chat` en la URL; 390 px; ni `$\d` ni
  "pago".
- [x] Commit `Etapa 3: chat con el equipo y lista de avisos en la app de niñeras`.

### Tarea 3.5: panel: chat en la ficha, "Mensajes de niñeras" en Hoy y la campanita

**Interfaces (produce):**
- Ficha (`verNinera`): sección "Chat" (`#vn-chat`) debajo de "App". Con app (`n.user_id`): el hilo
  (los del equipo con el autor; los de ella a la izquierda), `textarea` "Escribile a [nombre]" y
  "Enviar" (`conGuardado` → `insert` con `de: 'admin'`, `autor: nombreUsuario()`, `texto` con trim;
  vacío no manda; error con `toast` y el texto queda). Al abrir, marca `leido_admin_en` de los de
  ella sin leer. Sin app: "Todavía no tiene la app: escribile por WhatsApp." Realtime: canal propio
  del hilo mientras la ficha está abierta (se quita al cerrar el modal), que agrega mensajes sin
  tocar el `textarea` y sin duplicar.
- Hoy: tarjeta "Mensajes de niñeras" (`#dash-chat`, junto a `#dash-faltan`) con una fila por niñera
  con mensajes sin leer (nombre, cantidad, el último recortado); tocar abre su ficha en el chat.
  Sin mensajes, no se muestra.
- `?ir=ninieras&ninera=<id>` (el `url` del push a admins): abre Niñeras y la ficha de esa niñera
  en el chat.
- Campanita: `TIPOS_NOTIF` suma `{tipo: 'chat', label: 'Mensajes de niñeras', sub: 'Cuando una
  niñera escribe por el chat de la app', icono: 'ninieras', defaultPush: true}`;
  `cargarNotificaciones` suma los `avisos` con `para_admin` de los últimos 3 días (`id 'aviso:' ||
  id`, título, cuerpo, destino de su `url`), y los de tipo `chat` cuyo mensaje ya está leído no se
  muestran (se resolvió, como los otros ítems de la campanita).
- Test `tests/chat-admin.spec.js`: ficha con hilo y envío (cuerpo del insert), sin app, marcar
  leído, Realtime con texto escrito, dos admins (un mensaje de otra admin aparece con su nombre),
  vacío, falla, doble toque, escape; Hoy con la tarjeta y sin mensajes sin la tarjeta; `?ir=`; la
  campanita con el aviso y sin él cuando se leyó; preferencias con el tipo nuevo; base sin migrar;
  390 px.
- [x] Commit `Etapa 3: chat con las niñeras en la ficha, mensajes en Hoy y avisos en la campanita`.

### Tarea 3.6: documentación, revisión final y PR (sin merge hasta después de la mudanza)

- [x] CLAUDE.md (orden de carga con `chat.js`, tests, convenciones de la cola de avisos y del chat,
  Edge Function `enviar-avisos`, "Fase 1": etapa 3 hecha), `decisiones.md` 5.5 y el plan.
- [ ] Revisión final de toda la rama (Opus), una ola de arreglos.
- [ ] PR con el CI en verde, la migración y la verificación para Diego, y el orden después de la
  mudanza: (1) migración, (2) publicar `enviar-avisos`, (3) merge. Sin merge hasta el "dale" del
  #85 y el OK de la migración.

---

## Etapa 4: guía obligatoria y firma anual

Rama `claude/fase1-guia`. Migración `AAAAMMDD_guia.sql`. Bucket `ninieras-privado`.

### Tarea 4.1: `scripts/guia-desde-html.mjs` y `ninera/guia/contenido.json`
- Script sin dependencias (regex como el análisis del 25/10/2026): módulos `<section class="module">`
  salvo `inicio`, `ficha`, `recibidas`; lecciones `<details class="lesson" data-id>` con título
  (`summary > b`), subtítulo y el HTML interno sin el `summary` ni el botón `.mark`; `b2` pasa a
  `bebes` en segundo lugar; `data-quiz` → `repaso` desde `QUIZ`; sin `.kit`. `version: "2026.10"`.
  Test estático: el JSON es válido, tiene 11 módulos, `protocolos` y `auxilios` con
  `obligatorio: true`, 49 lecciones (50 menos ninguna: `b2` se mueve, no se borra), ningún `<script`
  ni `on[a-z]+=` en el HTML, sin emojis nuevos (los de la guía original se congelan en una lista).

### Tarea 4.2: migración `guia` (tablas, bucket, `ninera_puede_recibir_pedidos`, config) + pruebas
- `guia_progreso`, `guia_repasos`, `guia_firmas` (`decisiones.md` 8), `ninieras.rcp_presencial
  boolean`, `ninieras.rcp_certificado_ruta text`; bucket `ninieras-privado` (privado) con las
  políticas de 5.3; `app_config 'guia'`: `{"plazo_dias": 7, "gracia_anual_dias": 7,
  "version_vigente": "2026.10", "modulos_obligatorios": ["protocolos", "auxilios"]}`.
- RPC: `ninera_marcar_leida(p_leccion_id, p_version)`, `ninera_aprobar_repaso(p_modulo_id,
  p_version)`, `ninera_firmar_guia(p_nombre, p_firma_ruta, p_version)`, `ninera_estado_guia()`
  → `(completa boolean, firma_vigente boolean, puede boolean, motivo text, hasta date,
  lecciones_leidas text[], repasos_aprobados text[], ultima_firma timestamptz)`.
- `ninera_puede_recibir_pedidos(p_ninera_id uuid) returns table (puede boolean, motivo text,
  hasta date)` según `decisiones.md` 8 ("nueva" = sin filas en `sittings_traslados` no canceladas
  con fecha < `app_activada_en`).
- Pruebas SQL: nueva sin guía → no puede; con historia dentro del plazo → puede con `hasta`; plazo
  vencido → no; completa y firmada → sí; firma de hace 370 días → puede (gracia) y de 380 → no;
  releer después de firmar cuenta para el ciclo nuevo; la niñera no lee progreso de otra.

### Tarea 4.3: pantallas de la guía (`ninera/js/guia.js`)
- Índice por grupo con progreso, lección (HTML del JSON + "Ya lo leí"), repaso (opciones, "Bien." /
  "No es esa." + explicación, aprobado con todas bien), firma (declaración, nombre, canvas con el
  dedo → PNG → `ninieras-privado/firmas/<id>/<fecha>.png`), RCP presencial + certificado. Cartel en
  el inicio con el motivo y "Tienes hasta el [fecha] para completarla" o "Hasta que lo termines no te
  llegarán pedidos"; "¡Listo! Ya puedes recibir pedidos..." al terminar.
- Tests: `tests/ninera-guia.spec.js` (leer, repaso mal y bien, firma con canvas simulado, subida que
  falla, plazo, 390 px, el HTML de la lección se pinta sin ejecutar nada raro).

### Tarea 4.4: panel: estado de la guía en la ficha y avisos "Te falta" / "Repasa"
- `verNinera`: "Guía: ..." con links firmados; reglas en `programar_avisos()`: `guia:<id>:falta`
  (al activar la app si frena pedidos, y a mitad del plazo), `guia:<id>:anual:<año>`.

### Tarea 4.5: PR, migración + bucket (OK), merge.

---

## Etapa 5: pedido: pegar, sugerir, mandar, aceptar

Rama `claude/fase1-pedido`. Migración `AAAAMMDD_pedidos_app.sql`. Republicar `pedido-whatsapp`
si cambia. Archivo nuevo del panel `js/pedidos.js` (después de `intermediaciones.js`, antes de
`bootstrap.js`).

### Tarea 5.1: migración `pedidos_app` + pruebas
- Columnas de `solicitudes` y `solicitud_ninieras` y estados nuevos (`decisiones.md` 5.5);
  `precios_ninera_familia`; `ninera_no_disponible`; `familias.solo_conocidas`; `app_config
  'pedidos_app'` (`{"min_mismo_dia": 15, "min_otro_dia": 30, "recordatorio_min_antes": 10,
  "aviso_sin_ninera_horas": 3}`) y `'temporada_reglas'` (4.5); índices `solicitud_ninieras
  (ninera_id, estado)`, `precios_ninera_familia (familia_id)`.
- RPC admin: `enviar_pedido_app(p_solicitud_id uuid, p_envios jsonb) returns int` (transacción:
  valida `ninera_puede_recibir_pedidos` y que la niñera tenga `user_id`, inserta `solicitud_ninieras`,
  upsert `precios_ninera_familia`, fija `responder_hasta`, encola `pedido:<sn>:nuevo` con el texto
  de `textos.md` 1 armado en SQL con `chicos_texto`, zona y precio; devuelve cuántos mandó).
- RPC niñera: `ninera_mis_pedidos()`, `responder_pedido(p_sn_id uuid, p_respuesta text, p_motivo
  text, p_motivo_texto text) returns text` (`'ok'` | `'ya_respondido'` | `'cerrado'`; con `.eq`
  del estado anterior; encola `admin:pedido:<sn>:acepto`), `ninera_marcar_no_disponible(p_fechas
  date[], p_quitar boolean)`.
- `pago_hora_ninera(p_familia_id uuid, p_ninera_id uuid) returns numeric`: `precios_ninera_familia`
  si hay fila, si no `familias.pago_hora`. `precio_sitting()` no cambia; quien registra un puntual
  (panel) usa la función JS equivalente.
- Pruebas: la niñera no ve el nombre de la familia en `ninera_mis_pedidos`, no responde un pedido de
  otra, no responde dos veces, `responder_hasta` con las dos reglas, `enviar_pedido_app` rechaza
  a una sin app o frenada por la guía, `pago_hora_ninera` con y sin fila.

### Tarea 5.1b: `precioHoraNinera` en el panel (plata, con la red de plata)
- `precioHoraNinera(familia, nineraId, precios)` en `core.js` (puro): la fila de
  `precios_ninera_familia` de esa niñera con esa familia o `familia.pago_hora`. `precioSegunHorario`
  (`sittings.js`) y `otraHoraAutoElegida` (`app-shell.js`) la usan para sittings puntuales cuando
  hay niñera elegida; fijos y registros ya guardados no cambian (`decisiones.md` 4.18). Se suma a
  la lista del oráculo (`scripts/congelar-oraculo-plata.js`) con casos nuevos en
  `tests/red-plata.spec.js` (con fila, sin fila, niñera sin id, familia sin `pago_hora`); las
  fórmulas y los redondeos no se tocan y el resto de la red tiene que seguir igual.

### Tarea 5.2: `pedido-whatsapp`: `ninera_pedida` y `familia_id` confirmada
- `ticket.ts`: campo `ninera_pedida` (texto libre, 80) en el esquema y el `SISTEMA`; si llega
  `familia_id` la usa como elegida (ya existe); tests en `ticket_test.ts`. Republicar con OK.

### Tarea 5.3: panel: "Pegar mensaje de WhatsApp" → ticket → solicitud (`js/pedidos.js`)
- Botón en la Agenda junto a "+ Nueva solicitud"; modal con textarea; llamada a la función con la
  sesión (`sb.functions.invoke('pedido-whatsapp', { body })`); ticket editable con "Confirmar
  familia" (un toque, o buscador `attachAutocomplete`), dudas como `warnbox`, tipo cambio /
  cancelación → abre la solicitud existente; "Revisar y elegir niñeras" crea la solicitud
  (`estado 'sin_asignar'`, `pedido_id`, `chicos_texto`, `notas_para_ninera`) y abre 5.4. Si faltan
  dirección o chicos: campos ahí mismo.
- Tests: `tests/pedido-pegar.spec.js` (feliz, dudas, familia nueva, función que falla con cada
  status, tope diario, doble toque, 390 px).

### Tarea 5.4: sugeridas (`ordenarSugeridas`) y envío
- `ordenarSugeridas(pedido, datos) → [{ninera, bloque, puntaje, porque, marcas, enviable}]` pura;
  `datos` = `{ninieras, historial (sittings por niñera y familia), hijos, zonasGrupos, reglasTemporada,
  noDisponibles, cierres (prefiero otros), incidentes, solicitudesSemana, estadoGuia}`. Pantalla con
  bloques, "Marcar las 10 primeras", "Ninguna", lista de precios de primera vez, "Enviar a N" →
  `enviar_pedido_app`. Sin app → botón WhatsApp (`waLink` + `mensajeWA`). Práctica (`decisiones.md`
  4.17): si la familia o alguna tildada tiene "(práctica)" en el nombre y hay tildada alguna real,
  `warnbox` "Hay niñeras reales tildadas junto con una de práctica" y "Enviar" no sigue hasta
  destildarlas.
- Tests: unitarios de `ordenarSugeridas` (un caso por regla de `reglas-del-negocio.md` 5 y por
  regla de temporada 4.5) y de pantalla (`tests/pedido-sugeridas.spec.js`), incluido el aviso de
  práctica.

### Tarea 5.5: app de niñeras: tarjeta del pedido, Acepto / No puedo / días (`ninera/js/inicio.js`)
- Textos de `textos.md` 4; `#pedido/<id>` desde el push; "Responde antes de las HH:MM"; después
  de responder, estado en la tarjeta. Tests: `tests/ninera-pedido.spec.js` (aceptar, no puedo con
  motivo, días, ya respondido por otro lado, pedido cerrado, sin conexión, 390 px, ningún `$` que
  no sea el precio por hora).

### Tarea 5.6: PR, migración + republicación (OK), merge.

---

## Etapa 6: respuestas, elección y plantillas

Rama `claude/fase1-eleccion`. Migración chica `AAAAMMDD_eleccion.sql`.

### Tarea 6.1: `elegir_ninera(p_sn_id)` y reglas de tiempo de pedidos en `programar_avisos()`
- Elegida → `confirmada`, las demás `acepto` / `invitada` → `cubierto`, solicitud → `confirmada`,
  encola `pedido:<sn>:seleccionada` y `:cubierto`; falla si ya hay elegida (dos admins a la vez).
  `cerrar_envios_pedido(p_solicitud_id, p_motivo 'cubierto' | 'cancelado')`: la usan
  `guardarAsignacionDirecta` (asignación a mano, con o sin app) y `cancelarSolicitud`; con
  `'cancelado'` encola `pedido:<sn>:cancelado` ("Se canceló el pedido del [día]. Gracias por
  responder.") a las que aceptaron y marca a todas `cubierto` (`decisiones.md` 4.19).
  Reglas: `pedido:<sn>:recordatorio`, `admin:pedido:<sol>:perfiles`, `:nadie`, `:3h` (tiempos de
  `app_config 'pedidos_app'`). Pruebas SQL de cada regla con `now()` fijado vía un parámetro
  `p_ahora` opcional.

### Tarea 6.2: panel: "Pedidos en curso" en Hoy y en el modal de la Agenda; plantillas
- Tarjeta por solicitud; "Mensaje con los perfiles para la madre" (`app_config 'plantillas'`
  con el texto propuesto, links `cv_url`, "Falta el CV de X"); "Marcar la que eligió la madre" →
  `elegir_ninera` + `cargarNineraYRegistro` (con `pago_ninera = redondearPago(precio_hora × horas)`);
  "Confirmada: ..." con la plantilla (textos 9) y "Falta [dato]"; "Mandar a más niñeras"; "Todavía
  buscando" / "No conseguimos" / "Cancelar el pedido". Tests `tests/pedidos-en-curso.spec.js`.

### Tarea 6.3: app de niñeras: "¡Quedaste seleccionada!" y "Ya se cubrió"
- Pantalla con dirección, madre, chicos, notas, precio por hora, "Cómo llegar", `.ics`, "Repasa la
  guía de [edad]" (edades → módulos: 0–3 m recién, 3–12 m bebés, 1–3 toddlers, 3–5 preescolares,
  5–8 escolar, 9–12 preteens). Tests `tests/ninera-seleccionada.spec.js`.

### Tarea 6.4: PR, migración (OK), merge. Prueba con pedidos inventados entre Diego y las admins.

---

## Etapa 7: el día y el cierre

Rama `claude/fase1-el-dia`. Migración `AAAAMMDD_el_dia.sql`.

### Tarea 7.1: `sitting_eventos`, `sitting_cierres`, RPC y reglas del día + pruebas
- Tablas de `decisiones.md` 6.4; `ninera_marcar_evento(p_sitting_id, p_tipo, p_minutos, p_hora)`,
  `ninera_cerrar_sitting(p_sitting_id, p_hora_fin, p_dia_siguiente, p_comentarios, p_calificacion,
  p_volveria, p_jugaron, p_comentario_equipo)`, `ninera_cargar_gasto(p_sitting_id, p_monto,
  p_concepto, p_ruta)`; políticas de `comprobantes` para la niñera; `app_config 'el_dia'`
  (`{"no_llego_min": 15, "cierre_recordatorio_min": 30}`); reglas `sitting:<id>:24h`, `:1h`,
  `:fin`, `:fin30`, `admin:sitting:<id>:no_llego`. Avisos inmediatos desde las RPC (`tarde`,
  `problema`, `cerro`, `gasto`, `comentario`).
- Pruebas: la niñera no cierra un sitting de otra ni uno ya revisado; el gasto queda `pagado_por
  'ninera'` y sin tocar `cobro_familia`; los fijos no reciben 24h/1h ni `no_llego`.

### Tarea 7.2: app de niñeras: el día (`ninera/js/dia.js`)
- Botones del día según la hora y los eventos ya marcados; cierre con hora real, diferencia con lo
  previsto, gasto con foto (comprimida), comentarios, calificación; "¡Gracias, [niñera]! Ya quedó
  registrado." Tests `tests/ninera-dia.spec.js`.

### Tarea 7.3: panel: "Cierre de los fijos" recibe los cierres de la niñera; avisos con "Contactarla"
- Extender `cargarConfirmadosAutomaticos` y su tarjeta a los sittings con `sitting_cierres` sin
  `revisado_en`; precargar la hora real; mostrar gasto ("Elige quién lo paga": familia / Parents
  Break → `absorbe_pb`) y comentarios; "Sí, terminó" confirma y marca `revisado_en`. Notificaciones
  con botón "Contactarla" (`waLink` al celular de la niñera). Tests `tests/cierre-ninera.spec.js`
  (reutiliza lo de `cierre-fijos.spec.js`).

### Tarea 7.4: PR, migración (OK), merge. **Arranca la prueba con 3 a 5 niñeras.**

---

## Etapa 8: ficha de la familia, cambios y cancelaciones

Rama `claude/fase1-ficha-cambios`. Migración `AAAAMMDD_ficha_cambios.sql`.
- 8.1 `fichas_familia` + `ninera_guardar_ficha_familia` + `ninera_ficha_familia`; triggers de cambio
  de horario (`sitting:<id>:cambio:<n>`) y cancelación (`sitting:<id>:cancelado`, solicitud
  `cancelada`); `ninera_responder_cambio(p_sitting_id, p_ok boolean)` → `admin:sitting:<id>:no_puede`.
- 8.2 App: formulario de la ficha (18 campos + 6 casillas, precargada), ficha en "Quedaste
  seleccionada" y en el sitting del día; respuesta al cambio de horario.
- 8.3 Panel: fichas en la ficha de la familia con "Copiar para la próxima niñera".
- 8.4 PR, migración (OK), merge.

## Etapa 9: temporada en la app

Rama `claude/fase1-temporada` (worktree `.claude/worktrees/fase1-temporada`). Migración
`20261101_temporada_app.sql` + `_DESHACER.sql`. Sin Edge Functions. Detallada el 31/10/2026.
**Spec:** `docs/fase1/etapa9-temporada.md` (diseño aprobado por Diego el 31/10/2026, con sus cambios).
Manda sobre este plan: si algo choca, vale el diseño.

**Objetivo:** la niñera con app marca dónde va a estar cada quincena y la app se lo pide y se lo
recuerda sola; el panel lo lee igual que hoy, más los lugares nuevos, y deja de pedirles nada a las
admins por las que tienen app. Además, los avisos pasan a ser obligatorios al entrar a la app.

**Restricciones de la etapa (además de las globales):**
- `temporada.html`, `temporada-ninera` y `enviar-push-urgentes` no se tocan ni se republican. Para
  las niñeras sin app (`user_id` nulo) el panel sigue exactamente igual (paso previo, "Pedirle por
  WhatsApp", aviso anual).
- La niñera lee y escribe su temporada solo por `ninera_mi_temporada()` y
  `ninera_guardar_temporada(p_lugares)`; nada de políticas nuevas sobre `ninieras`.
- Lugares: `montevideo | punta | la_paloma | fuera_pais | {otro: texto}`, siempre las 24 claves
  "0".."23"; "Otro" de 1 a 80 caracteres. Quincena q = mes*2 (+1 la segunda), sin año.
- Inicio de la temporada: 1/9 a las 0:00 de Montevideo (`inicio_temporada_mvd()` en la base,
  `inicioTemporadaActual()` en el panel). Lugares vigentes = no nulos, `temporada_lugares_en` ≥ inicio
  y `temporada_fuente` 'app' o 'sistema'.
- Textos de la niñera en "tú" (`textos.md` 6); los que no estén van a `textos-provisorios.md`
  ("Etapa 9: temporada y avisos"). Los del panel en voseo. Todo texto de "Otro" escapado.
- Base sin la migración: la app sin tarjeta ni pantalla de temporada (las RPC dan 404) y el panel
  como hoy (sin `temporada_lugares` todo cae en la regla vieja).

**Review Focus de la etapa:**
1. Un push de la temporada que abre la app cerrada (`#temporada` en la URL) con los avisos o el perfil
   todavía pendientes: pasa primero por esas pantallas y después llega a la temporada, no al inicio
   (test en 9.4).
2. Lugares de la temporada pasada, o una respuesta posterior por la página: ni la app ni el panel los
   toman como vigentes (SQL en 9.1, panel en 9.5).
3. Una admin corrige las quincenas de Punta de una niñera que cargó "Fuera del país" y "Otro": eso no se
   borra; y si los lugares no estaban vigentes, la corrección los borra (9.5).
4. "Otro" con HTML, comillas o 81 caracteres: la app no deja pasar más de 80 y todo se ve como texto en
   la app, la ficha y el panel (9.4, 9.5).
5. Un celular que no puede recibir avisos (Safari sin instalar) o con el permiso bloqueado nunca queda
   atrapado en la pantalla de avisos: siempre hay una salida (9.3).

### Tarea 9.1: migración `temporada_app`, funciones y pruebas SQL

**Archivos:** `supabase/migraciones/20261101_temporada_app.sql` y `_DESHACER.sql`,
`supabase/pruebas/fase1_temporada.sql`, `supabase/pruebas/deshacer/20261101_temporada_app.sql` (+
`_datos.sql`), `supabase/schema.sql`, `supabase/pruebas/catalogo_seguridad.sql`,
`supabase/pruebas/fase1_avisos_chat.sql` (con la temporada cargada, `programar_avisos()` sigue en 0).

**Interfaces (produce):**
- `ninieras.temporada_lugares jsonb`, `ninieras.temporada_lugares_en timestamptz`.
- `inicio_temporada_mvd(p_ahora timestamptz default now()) → timestamptz`.
- `ninera_mi_temporada() → jsonb {lugares: jsonb|null, al_dia: boolean, solo_afuera: boolean}` (null si
  no es niñera). `lugares` solo si `al_dia`.
- `ninera_guardar_temporada(p_lugares jsonb) → void`; errores `no_autorizada`, `temporada_invalida`,
  `sin_grupo_punta`. Escribe `temporada_lugares`, `temporada_lugares_en`, `temporada` (`{<id grupo Punta
  del Este>: [quincenas]}`), `zona` (+ "Punta del Este" si no la tenía), `temporada_actualizada_en`,
  `temporada_fuente = 'app'` y vacía `temporada_propuesta(_en)`.
- `programar_avisos_temporada(p_ahora)`: claves `temporada:<año>:<id>` y `temporada:<año>:<id>:q<n>`, tipo
  `temporada`, url `#temporada`, textos de `textos.md` 1. `programar_avisos()` la suma.
- [x] Migración, DESHACER, pruebas (aplicar → deshacer → aplicar, y el DESHACER con datos) y
  `schema.sql`. Todas las pruebas de `supabase/pruebas/*.sql` pasan con PGlite.
- [x] Commit `Etapa 9: migración de la temporada en la app y sus pruebas`.
- [ ] Diego revisa la migración (SQL y consulta de verificación). Se aplica recién con su OK, el día del
  merge (ver 9.6).

### Tarea 9.2: simulador de la etapa

**Archivos:** `tests/support/rpc-ninera.js`, `tests/support/app.js`, `tests/support/datos.js`,
`tests/support/fuentes.js`, `ninera/index.html` (`<script src="js/temporada.js">` después de `chat.js`, antes
de `arranque.js`), crear `ninera/js/temporada.js` con su cabecera; CLAUDE.md (orden de carga).

**Interfaces (produce):**
- `rpcNinera` suma `ninera_mi_temporada` y `ninera_guardar_temporada` con la regla de la SQL (mismas
  validaciones y mismos errores con `errorRpc(...)`; guardar escribe en la fila de `db.ninieras` las mismas
  columnas que la SQL). "Ahora" es el del reloj de la página (`page.clock` cuando el test lo fija).
- `baseSinMigrar: 'etapa9'`: esas dos RPC dan 404 `PGRST202`; lo de las etapas 2 y 3 anda.
- Datos: Ana sin temporada; en el panel, una niñera con app y lugares vigentes ("Fuera del país" la 1ra de
  marzo, `{otro: 'Rocha'}` la 2da) y otra con temporada de la temporada anterior.
- Correr toda la suite: los datos nuevos no pueden romper otros tests (si alguno cuenta filas, se ajusta
  y se dice por qué).
- [x] Commit `Etapa 9: simulador de la temporada`.

### Tarea 9.3: avisos obligatorios (`ninera/js/cuenta.js`, `arranque.js`, `inicio.js`)

**Interfaces (produce):**
- `pantallaAvisos()`: sin "Ahora no"; solo "Activar avisos". Se deja de usar la marca
  `pb-ninera-avisos-vistos`: `continuarDespuesDeInstalar()` la muestra cada vez que entra con
  `avisosSoportados()` y `!(await avisosActivados())`, salvo que en esta apertura ya eligió "Seguir sin
  avisos" (variable en memoria `avisosSalteadosEstaVez`, no en `localStorage`).
- Si al tocar "Activar avisos" el permiso queda en `denied`, o ya estaba en `denied` al entrar:
  `pantallaAvisosBloqueados()` (ruta `#avisos`) con los pasos para activarlos en Ajustes (iPhone y
  Android, texto en `textos-provisorios.md`), "Ya los activé" (`conGuardado`, vuelve a probar
  `suscribirAvisosNinera()`; si siguen apagados, lo dice y se queda) y abajo, como link chico, "Seguir sin
  avisos" (pone `avisosSalteadosEstaVez` y sigue al perfil o al inicio).
- Inicio: el aviso rojo de hoy ("Avisos apagados...") sigue fijo y sin cerrar; su "Activar avisos" con el
  permiso en `denied` va a `#avisos` (los pasos) en lugar de pedir el permiso.
- `avisosSoportados()` falso: pasa como hoy (sin pantalla de avisos).
- Tests: `tests/ninera-cuenta.spec.js` cambia a propósito (los casos que tocaban "Ahora no" pasan por
  "Activar avisos" o "Seguir sin avisos"; el PR lo dice) y suma: sale cada vez que entra con los avisos
  apagados; permiso bloqueado → pasos, "Ya los activé" con el permiso todavía bloqueado (se queda) y ya
  concedido (sigue); "Seguir sin avisos" → inicio con el aviso rojo, cuyo botón lleva a los pasos; celular
  que no puede → sin pantalla; 390 px.
- [x] Commit `Etapa 9: avisos obligatorios al entrar a la app de niñeras`.

### Tarea 9.4: app: la temporada (`ninera/js/temporada.js`)

**Interfaces (consume):** `ninera_mi_temporada`, `ninera_guardar_temporada` (9.1, simuladas en 9.2);
`textoQuincenas(qs)` y `TEMP_MESES_LARGO`, que pasan de `js/ninieras.js` a `js/comun.js` sin cambios
(las usan las dos puertas; mirar antes con `gh pr list` que ningún PR abierto toque `comun.js`).

**Interfaces (produce):**
- `LUGARES_TEMPORADA` (comun.js): `{montevideo: 'Montevideo', punta: 'Punta del Este', la_paloma: 'La
  Paloma', fuera_pais: 'Fuera del país', otro: 'Otro'}`.
- `resumenLugaresTemporada(lugares) → Array<{etiqueta: string, quincenas: number[]}>` (comun.js): un
  renglón por lugar distinto de Montevideo, en el orden punta, la_paloma, fuera_pais y cada "Otro" por
  texto (`Otro (Rocha)`), con sus quincenas. Sin escapar: escapa quien lo pinta. Vacío si todo es
  Montevideo.
- `cargarTemporadaNinera() → Promise<{lugares, al_dia, solo_afuera} | null>`: null con la base sin migrar
  (404 `PGRST202`); un error de red tira.
- Tarjeta en el inicio (`#inicio-temporada`, debajo de `#inicio-avisos`), solo de setiembre a marzo
  (mes de `todayISO()`), sin esperar a pintar el resto: sin estar al día, "¿Dónde vas a estar esta
  temporada?" y "Marcar"; al día, "Tu temporada", el resumen (`resumenLugaresTemporada` +
  `textoQuincenas`, o "Toda la temporada en Montevideo.") y "Cambiar". Sin migrar o si falla la
  lectura: no aparece (sin aviso).
- `pantallaTemporadaNinera()` (`#temporada`): título "¿Dónde vas a estar esta temporada?"; el atajo "Todo
  el verano en Punta" (marca `punta` en 23, 0, 1, 2 y 3 y deja el resto como estaba); 8 filas (22, 23, 0,
  1, 2, 3, 4, 5) con "1ra quincena de diciembre"... y 5 botones por fila (`aria-pressed`), "Otro" abre
  "¿Dónde?" (`maxlength="80"`); "Ver el resto del año" despliega las 16 de abril (6) a noviembre (21).
  Precarga: al día, sus `lugares`; si no, las 8 vacías y las 16 en `montevideo` (o `punta` si
  `solo_afuera`). "Guardar" (`conGuardado`): con alguna de las 8 vacía no llama a la base, las marca y dice
  "Te falta marcar N quincenas."; "Otro" vacío: "Escribe dónde vas a estar." y no guarda. Bien: "¡Listo!
  Guardamos tu temporada." y vuelve al inicio. Falla o sin conexión: "No pudimos guardar tu temporada.
  Revisa tu conexión a internet y vuelve a intentar." y lo marcado queda. "Volver" al inicio. Sin migrar:
  la ruta va al inicio.
- Rutas: `#temporada` en `rutaPedidaAlAbrir` (arranque.js), en el `hashchange` de chat.js (lista de rutas
  de las dos condiciones) y en `irA` (base.js). Los avisos con `url '#temporada'` ya se enlazan solos.
- Test `tests/ninera-temporada.spec.js`: tarjeta sin cargar, al día con resumen (incluido "Otro" con
  HTML tramposo, visto como texto) y en mayo (no está); pantalla: las 8 vacías sin estar al día, las 16 en
  Montevideo (en Punta si vive en Punta), al día con lo suyo; el atajo; guardar con vacías (no llama a la
  RPC), "Otro" vacío, "Otro" con 80 (no deja escribir el 81); guardar bien (cuerpo exacto de la RPC con las
  24 claves) y la tarjeta pasa a "Tu temporada"; falla y sin conexión sin perder lo marcado; doble toque
  una sola RPC; base sin migrar; abrir con `#temporada` en la URL con avisos apagados (pasa por avisos y
  llega a la temporada) y un push con la app abierta; 390 y 1280 px; ni `$\d` ni "pago".
- [x] Commit `Etapa 9: la temporada en la app de niñeras`.

### Tarea 9.5: panel (`js/ninieras.js`)

**Interfaces (produce):**
- `lugaresTemporadaVigentes(n) → object|null`: los lugares si están vigentes (regla de las
  restricciones), si no null.
- `estadoTemporada(n)` sin cambios; `nineraPresenteEnZona(n, zonaKey, q)`: con `estadoTemporada(n) !==
  'ok'` se comporta como sin temporada cargada (para todas, con app o sin app: Diego, 31/10/2026); con
  lugares vigentes, una zona de Montevideo o Canelones la excluye en las quincenas con un lugar distinto de
  `montevideo`; Punta sigue saliendo de `temporada`.
- `textoFuenteTemporada`: 'app' → "la cargó ella en la app".
- Correcciones (`guardarTemporadaEnBase`, la usan el panel, el paso previo y "Repetir lo del año
  pasado"): con lugares vigentes, los manda junto con `temporada` mezclados (lo que queda en Punta →
  `punta`, lo que estaba en `punta` y ya no → `montevideo`, el resto igual; `temporada_lugares_en` no se
  manda); sin lugares vigentes pero con `temporada_lugares` no nulo, manda los dos en null.
- Niñera con app (`n.user_id`): `editarNinera` no abre `abrirPasoTemporada`; en su fila del panel de
  temporadas, en lugar de "Pedirle por WhatsApp", el texto "Se la pide la app"; `abrirRecordatorioTemporada`
  y el contador del panel de temporadas ("X sin temporada") no la cuentan entre las que hay que pedir (en
  el panel aparece igual, con su estado, para poder corregirla).
- Ficha (`verNinera`): sección chica "Temporada" (`#vn-temporada`, después de los datos y antes del
  chat): "Sin temporada cargada" si no está al día (también si es de la temporada anterior); si no, "En
  Punta del Este: …" (`textoQuincenas`) y un renglón por cada lugar de `resumenLugaresTemporada`, más la
  fuente (`textoFuenteTemporada`). En el panel de temporadas, los mismos renglones debajo del estado.
  Todo escapado.
- Lo que lea `ninieras` para la lista ya trae `user_id`, `temporada_lugares` y `temporada_lugares_en`
  (comprobar el `select` de `cargarNinieras`; si no las trae, sumarlas).
- Test `tests/temporada-app-panel.spec.js`: con app sin paso previo y con "Se la pide la app", sin app
  como hoy; el recordatorio anual cuenta solo a las sin app; fuente "en la app"; filtro con Fuera del país,
  Otro y La Paloma (no está en Pocitos esas quincenas; sí en las de Montevideo); temporada anterior como
  "sin temporada cargada" en el filtro y en la ficha; ficha y panel con los renglones; corregir Punta
  conserva Fuera del país y Otro (cuerpo del update) y, con lugares no vigentes, los borra; escape de
  "Otro"; base sin migrar (sin las columnas) como hoy; 390 px. `tests/filtro-punta.spec.js` sigue
  pasando; si un dato suyo es de una temporada anterior, se ajusta y el PR lo dice.
- [x] Commit `Etapa 9: el panel lee la temporada de la app`.

### Tarea 9.6: documentación, revisión final y PR (sin merge hasta el OK)

- [x] CLAUDE.md: orden de carga con `temporada.js`, tests nuevos, convención "Temporada desde la app"
  (cuál manda, inicio 1/9, correcciones de las admins, avisos obligatorios), el filtro de Niñeras con la
  temporada anterior; pendientes: apagar la página y `temporada-ninera` cuando todas tengan la app; borrar
  "Publicar `enviar-avisos` junto con la migración" (ya hecho).
- [x] `decisiones.md` 6.6 y 10 y este plan; `textos-provisorios.md`.
- [ ] Revisión final de toda la rama (Opus), una ola de arreglos.
- [ ] PR con el CI en verde, sin merge. Orden con el OK de Diego: (1) migración por el SQL Editor y la
  consulta de verificación, (2) merge en seguida (el aviso de la temporada sale apenas se aplica la
  migración: si llega antes de que la app nueva esté publicada, abre el inicio).

## Etapa 10: carsitting en la app

Rama `claude/fase1-carsitting`. Migración `AAAAMMDD_carsitting_app.sql`.
- 10.1 Columnas nuevas en `carsitting_datos`, `ninera_guardar_carsitting(p_datos jsonb, p_fotos
  jsonb)`, `aprobar_carsitting(p_id, p_ok, p_comentario)` (admin; si no OK manda el comentario por
  chat), regla `carsitting:<id>:completar` y `:semana:<lunes>`; pruebas.
- 10.2 App: una pantalla con los campos y las 5 fotos (bucket privado), "¡Listo! Gracias.",
  "Ya puedes recibir solicitudes de traslados" al aprobarse.
- 10.3 Panel: "Carsitting para revisar" en Hoy (fotos con links firmados), lista "Completaron /
  Faltan / Sin app" en Niñeras (rehecha de #60), ficha lee por `ninera_id`.
- 10.4 Plan de apagado de Google Forms / Apps Script / webhooks en CLAUDE.md. PR, migración (OK), merge.

## Etapa 11 (opcional): pedidos de traslado por la app
- Solo si todo lo anterior anda estable: `enviar_pedido_app` acepta `tipo 'traslado'` con
  `precio_viaje`; tarjeta "Traslado [dd/mm]" con "Precio: $X por viaje"; solo a las que tienen
  `carsitting_datos.aprobado_en`; `ordenarSugeridas` filtra por tipo. Migración chica, PR, OK, merge.
