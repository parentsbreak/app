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

Rama `claude/fase1-perfil`. Migración `AAAAMMDD_perfil_ninera.sql`.

### Tarea 2.1: funciones de lectura y escritura del perfil y de los sittings (SQL + pruebas)
- `madre_nombre_inicial(p_nombre text) returns text` (puro): primera palabra + inicial de la última
  ("María Pérez" → "María P."; una palabra → la palabra; vacío → "la familia").
- `chicos_texto(p_familia_id uuid) returns text`: de `hijos_familia` con `edadHijo` traducido a SQL
  (`edad_declarada` + años pasados desde `edad_declarada_en`, o `fecha_nacimiento`): "2 chicos
  (3 y 5 años)", "1 chico (8 meses)"; sin hijos → `familias.ninos` recortado a 80; si nada → null.
- `ninera_mi_perfil() returns table (id, nombre, telefono, tipo, zona, barrios, cuenta_bancaria,
  app_activada_en, rcp_presencial, rcp_certificado_ruta)` y `ninera_guardar_perfil(p_tipo text,
  p_zonas text[], p_cuenta text[]) returns void` (`p_tipo` solo 'Niñera' | 'Traslados' | 'Ambas';
  zonas solo nombres de `zona_grupos`; guarda `zona = array_to_string(p_zonas, '/')`).
- `ninera_mis_sittings() returns table (id, tipo, fecha, hora_inicio, hora_fin,
  termina_dia_siguiente, zona, madre, direccion, chicos, notas_para_ninera)` sobre
  `sittings_traslados` no cancelados, `ninera_id = ninera_actual()`, `fecha between hoy_mvd() and
  hoy_mvd() + 60`, `estado in ('previsto','confirmado')`. `hoy_mvd()` = `(now() at time zone
  'America/Montevideo')::date`. Sin precio (el precio por hora solo se ve en el pedido y en
  "¡Quedaste seleccionada!"). `notas_para_ninera` de `solicitudes` vía el registro (null hasta la
  etapa 5).
- Pruebas: como niñera, la salida no tiene `cobro_familia` ni `pago_ninera` (`select * from
  ninera_mis_sittings()` con las columnas listadas), no ve sittings de otra ni cancelados ni de hace
  un mes, `madre_nombre_inicial` con 4 casos, `chicos_texto` con 3 casos (declarada vieja,
  nacimiento, sin hijos), `ninera_guardar_perfil` rechaza tipo inválido y zona desconocida.

### Tarea 2.2: pantalla "Completa esto una sola vez" y "Mi perfil" (`ninera/js/perfil.js`)
- Primer ingreso con `tipo` por defecto y sin zonas → la pantalla, con casillas por grupo
  (`zona_grupos` leída por RPC `ninera_zonas_disponibles()` o incluida en `ninera_mi_perfil`),
  servicios (Sittings / Carsittings / Ambos), datos bancarios (texto libre por línea como la ficha).
  Guardar con `conGuardado`; error de base → aviso sin éxito falso. Marcar Carsittings: texto
  "Pronto vas a poder cargar los datos del auto desde aquí" (hasta la etapa 10).
- Tests: `tests/ninera-perfil.spec.js` (feliz, zonas sin elegir, base que falla, doble toque,
  390 px).

### Tarea 2.3: "Próximos sittings" en el inicio (`ninera/js/inicio.js`)
- Lista por fecha: día (hoy / mañana / "jue 30/10"), horas, zona, madre, chicos; al tocar, detalle
  con dirección, "Cómo llegar" (`https://maps.apple.com/?q=` / `https://www.google.com/maps/search/?api=1&query=` con `encodeURIComponent`), "Agregar al calendario" (`.ics` armado en JS con `DTSTART;TZID=America/Montevideo`). Sin precio. Sin nada: "No tienes sittings próximos."
- Tests: fijos y puntuales, uno que cruza medianoche, sin sittings, base que falla; búsqueda de
  cualquier `$` o "pago" en el HTML renderizado (regla dura).

### Tarea 2.4: panel: ver el perfil que cargó la niñera
- En la ficha de la niñera (`verNinera`), las zonas y la cuenta ya se ven; agregar "Perfil completado
  en la app el dd/mm" (de un campo `ninieras.perfil_app_en` que fija `ninera_guardar_perfil`).

### Tarea 2.5: PR, migración (OK) y merge.

---

## Etapa 3: avisos y chat

Rama `claude/fase1-avisos-chat`. Migración `AAAAMMDD_avisos_chat.sql`. Edge Function nueva
`enviar-avisos`.

### Tarea 3.1: tabla `avisos`, `chat_mensajes`, `programar_avisos()`, `reclamar_avisos()`, cron y trigger (SQL + pruebas)
- `avisos` como `decisiones.md` 5.4, con `check` de que exactamente uno de `para_ninera_id` /
  `para_admin` no es null; índices `(enviado_en, enviar_desde)`, `(para_ninera_id, creado_en desc)`.
- `encolar_aviso(p_clave text, p_para_ninera uuid, p_para_admin text, p_tipo text, p_titulo text,
  p_cuerpo text, p_url text, p_datos jsonb, p_enviar_desde timestamptz) returns boolean`
  (`security definer`, lo usan las otras funciones y los triggers; `on conflict (clave) do nothing`;
  devuelve si insertó).
- `reclamar_avisos(p_max int) returns setof avisos` (`security definer`, solo `service_role`:
  `revoke from public, anon, authenticated`): `update ... where enviado_en is null and
  enviar_desde <= now() ... for update skip locked returning *`.
- `programar_avisos() returns int` (vacía en esta etapa: el chat encola directo): la estructura
  (una función por regla, `programar_avisos` las llama y suma) para que cada etapa agregue las suyas.
- `chat_mensajes` con RLS: niñera `select` donde `ninera_id = ninera_actual()`, `insert` con
  `de = 'ninera'` y su id; admins todo. Trigger `after insert`: encola `chat:<id>` a la niñera si
  `de = 'admin'` (título = `autor`, cuerpo = texto recortado a 120) o `admin:chat:<id>` a `'todas'`
  si `de = 'ninera'`.
- Trigger `after insert on avisos`: si `enviar_desde <= now()`, `net.http_post` a `enviar-avisos`
  con `x-cron-secret` (misma clave que el cron). Cron `enviar-avisos` cada minuto: `select
  public.programar_avisos(); select net.http_post(...)`.
- Realtime: `alter publication supabase_realtime add table chat_mensajes, avisos`.
- Pruebas: idempotencia de `encolar_aviso`, `reclamar_avisos` no devuelve dos veces la misma fila,
  RLS del chat (la niñera no lee el hilo de otra ni inserta como admin), el trigger encola al
  destinatario correcto.

### Tarea 3.2: Edge Function `enviar-avisos` (`index.ts` + `envio.ts` + tests)
- Con `x-cron-secret`; `reclamar_avisos(50)`; para cada aviso resuelve suscripciones: niñera →
  `push_subscriptions where user_id = (select user_id from ninieras where id = para_ninera_id)`;
  admins → todas las de `usuarias_autorizadas` activas (por `usuario` = mail, como hoy) filtradas por
  `notif_push_preferencias` del `tipo`; manda con `web-push` (`payload {id, titulo, mensaje, url}`
  igual que hoy, así `sw.js` no cambia); 404/410 → borra la suscripción; error → `avisos.error`,
  `intentos + 1`, y si `intentos < 3` vuelve a dejar `enviado_en = null` con `enviar_desde = now() +
  2 min`. Responde `{enviados, fallidos}`.
- Tests de Deno con `webpush` simulado.

### Tarea 3.3: chat en la app de niñeras (`ninera/js/chat.js`) y lista de avisos
- Pestaña "Equipo" con el hilo (Realtime por `ninera_id`), campo de texto, "Enviar" con
  `conGuardado`; marca `leido_ninera_en` al abrir. Lista "Avisos" (de `avisos` propias, marca
  `leido_en`). `sw.js` de niñeras: el click abre `url` del payload.
- Tests: `tests/ninera-chat.spec.js` (enviar, recibir por Realtime simulado, sin conexión, 390 px,
  escape de texto tramposo).

### Tarea 3.4: panel: "Mensajes de niñeras" en Hoy, hilo en la ficha, tipos nuevos en Notificaciones
- Tarjeta en Hoy con no leídos por niñera (`chat_mensajes where de = 'ninera' and leido_admin_en is
  null`, agrupado); al tocar abre la ficha en el hilo. En `verNinera`, sección "Chat" con Realtime
  (`RT_RECARGA_LIVIANA`: no repinta lo que se escribe). Tipos `chat` (y los de etapas siguientes) en
  `NOTIF_TIPOS` con default `true`. La campanita suma los `avisos` con `para_admin`.
- Tests: `tests/chat-admin.spec.js`.

### Tarea 3.5: PR, migración + publicación (OK), merge.

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

Rama `claude/fase1-temporada`. Migración `AAAAMMDD_temporada_app.sql`.
- 9.1 `ninieras.temporada_lugares`, `ninera_guardar_temporada(p_lugares jsonb)` (escribe también
  `temporada` en el formato de hoy, `temporada_fuente 'app'`), reglas `temporada:<año>:<id>` (1/10
  9:00) y `:q<n>` (cada 15 días hasta el 31/12); pruebas.
- 9.2 App: pantalla por quincena, atajo, "Otro" con texto.
- 9.3 Panel: marca "Otro" en la ficha; `ordenarSugeridas` lee `temporada_lugares` y
  `temporada_reglas`; el panel de temporadas muestra la fuente "app".
- 9.4 Plan de apagado anotado en CLAUDE.md (nada se apaga). PR, migración (OK), merge.

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
