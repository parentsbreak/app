# Mudanza de la app a parentsbreak.github.io/app (27/10/2026)

**Nada de esto se ejecuta hasta el "dale" de Diego.** Este documento es el plan: qué cambia, qué
depende de la dirección vieja, el paso a paso por quién, el texto para las admins y los dos SQL
exactos (con respaldo) para el SQL Editor.

- Hasta hoy: `https://diegomarin28.github.io/sistema-parents-break/` (panel) y `.../ninera/` (niñeras).
- Desde la mudanza: `https://parentsbreak.github.io/app/` y `https://parentsbreak.github.io/app/ninera/`.
- Cómo: el repo se transfiere a la organización de GitHub `parentsbreak` con el nombre `app`.
  Cambian el host y la carpeta; el proyecto de Supabase, los crons, Cloudflare y los secretos quedan
  donde están.

## Decisiones tomadas (Diego, 27/10/2026)
- Sí al repo de redirección en el nombre viejo (`docs/mudanza-redireccion/`), para que el ícono viejo
  y los links viejos no caigan en un 404.
- El aviso "La app se mudó" va solo en el panel (login y Hoy), no en `ninera/`: la única cuenta de
  niñera hoy es la de práctica.
- Las passkeys viejas se borran por SQL la noche de la mudanza, con respaldo (Diego corre el SQL
  exacto de abajo). Cada admin vuelve a activar Face ID como la primera vez.
- El PR `claude/mudanza-pages` se mergea justo después de la transferencia: el primer build en la
  dirección nueva ya sale con el aviso y los valores por defecto nuevos.
- El tope del CI sube a 25 minutos (dos corridas del 27/10 se cancelaron instalando Chromium).

## 1. Qué depende de la dirección vieja

### Se rompe al mudar (hay que tocar algo)
1. **CORS de las Edge Functions `ninera-cuenta` y `pedido-whatsapp`**: valor por defecto
   `https://diegomarin28.github.io` en el `index.ts` de cada una. Sin el origen nuevo, la niñera no
   puede crear su cuenta desde el link y el pedido desde WhatsApp no responde. Arreglo: el secret
   `ORIGENES_PERMITIDOS` con las dos direcciones (toma efecto sin republicar) y el valor por defecto
   con las dos en el PR (el nuevo primero: es el que se responde a un pedido de otro lado).
2. **Passkeys (Face ID / Touch ID del panel)**: Supabase las ata al Relying Party ID, hoy
   `diegomarin28.github.io`. Al cambiarlo a `parentsbreak.github.io` (obligatorio: tiene que coincidir
   con el host) todas quedan inservibles, y el login entraría en "Confirmá con Face ID" sin salida.
   Arreglo: borrarlas con respaldo (SQL A) y que cada admin entre con contraseña; la app le pide
   "Activar Face ID" como la primera vez.
3. **Supabase Auth > URL Configuration**: Site URL y Redirect URLs. Las usan "Acceso temporal por
   mail" y "recuperar contraseña". Hay que sumar la dirección nueva.
4. **TomTom**: la clave está restringida al dominio viejo. Sin agregar el nuevo, el autocompletar de
   direcciones y los km automáticos del traslado dejan de andar (el geocoding cae a Nominatim).
5. **Push**: las suscripciones de las admins quedan ligadas al service worker viejo. Siguen vivas: el
   aviso llega al ícono viejo y al tocarlo abre la dirección vieja, y se duplican cuando activan en la
   nueva. Cuando las tres activaron avisos en la nueva: borrar las filas viejas (SQL B).
6. **Apps instaladas y sesiones**: el ícono viejo deja de abrir la app; la dirección nueva arranca sin
   sesión (localStorage es por origen). Se pierden borradores locales sin guardar (los de la
   entrevista tienen copia en la base desde el 21/10). Reinstalar e iniciar sesión de nuevo: las 3
   admins y la niñera de práctica.
7. **Links ya mandados**: invitaciones a la app de niñeras vigentes (hoy hay 0) y links viejos a
   `temporada.html` del repo (bit.ly y personales; los de ahora van directo a parentsbreak.pages.dev).
   Los cubre el repo de redirección.
8. **GitHub Pages** no redirige la dirección vieja. En el repo transferido hay que verificar
   Settings > Pages (rama `main`, carpeta `/`, Enforce HTTPS) y el primer build. La organización
   `parentsbreak` (plan free) permite Pages públicas.
9. **Remote local** del checkout de Diego: apunta al nombre viejo. GitHub redirige, pero se actualiza.
   El repo de backups no nombra a este repo: no se toca.

### Solo texto (ya cambiado en el PR)
`README.md` (Live), `docs/fase1/decisiones.md` (dirección de `ninera/`), `docs/rediseno-panel.md`
(maquetas), el comentario de la clave de TomTom en `js/sittings.js` y `CLAUDE.md` (Stack y
Pendientes). `package.json` `name` queda. Los comentarios de `sw.js` y `ninera/sw.js` no nombran el
dominio: quedan.

### Sigue andando sin tocar (verificado)
Manifests (`start_url` y `scope` "./"), registro de los service workers (relativo), notificationclick
(resuelve contra el scope), `index.html` y `ninera/index.html` (todo relativo, splash incluidas), link
de invitación (se arma con `location.href`), payload de push (urls relativas), VAPID, crons (URL de
Supabase), temporada (Cloudflare y Edge Function con CORS *), CI (`tests.yml` no nombra el repo),
tests (localhost), Realtime, Storage. La página de Cloudflare no referencia github.io y no se
despliega desde este repo. Carsitting (Google Forms, Apps Script, webhook) no pasa por github.io.

## 2. Qué trae el PR `claude/mudanza-pages`
- Valor por defecto de `ORIGENES` con las dos direcciones en las dos Edge Functions (el repo queda
  distinto de lo publicado hasta republicar con OK).
- `timeout-minutes: 25` en el CI.
- Aviso "La app se mudó" en el panel, solo en `parentsbreak.github.io` y hasta tocar "Entendido"
  (`hayQueAvisarMudanza`, app-shell.js): caja arriba del login y tarjeta con los 5 pasos arriba de
  Hoy. Se saca en un PR aparte un mes después.
- Textos y comentarios con la dirección nueva; este documento; las páginas del repo de redirección
  (`docs/mudanza-redireccion/`); `tests/mudanza.spec.js`.

## 3. Paso a paso

### A. Antes de la noche (sin tocar producción)
| Quién | Qué |
|---|---|
| Claude | PR `claude/mudanza-pages` con CI verde, sin mergear. |
| Diego, Supabase > Edge Functions > Secrets | `ORIGENES_PERMITIDOS` = `https://parentsbreak.github.io,https://diegomarin28.github.io`. No cambia nada hoy (el viejo sigue). |
| Diego, TomTom | Agregar `parentsbreak.github.io` a los dominios de la clave (se pueden tener los dos). |
| Diego, Supabase > Authentication > URL Configuration | Sumar a Redirect URLs `https://parentsbreak.github.io/app/**`. Site URL se cambia la noche (B5). |
| Claude | Verificar con un OPTIONS que las dos funciones respondan el origen nuevo. |
| Diego | Avisar a las admins (texto en la sección 4): la noche X la app está fuera unos minutos y después hay que reinstalar el ícono. |

### B. La noche, en este orden
| Paso | Quién | Qué |
|---|---|---|
| B1 | Diego, GitHub | Repo Settings > General > Danger Zone > Transfer ownership: a `parentsbreak`, nombre nuevo `app` (como owner de la org se puede renombrar en el mismo paso). |
| B2 | Diego, repo nuevo | Settings > Pages: Source "Deploy from a branch", `main`, `/ (root)`, "Enforce HTTPS". |
| B3 | Claude (`gh`) | `git remote set-url origin https://github.com/parentsbreak/app`, verificar con `gh repo view`, rebasar el PR si hace falta y esperar el CI. |
| B4 | Claude, con OK | Mergear el PR (merge commit). Pages construye con el push. Verificar que `https://parentsbreak.github.io/app/` y `/app/ninera/` cargan (curl y Chromium headless). |
| B5 | Diego, Supabase > Authentication | Site URL: `https://parentsbreak.github.io/app/`. Passkeys: Relying Party ID `parentsbreak.github.io`, Origins `https://parentsbreak.github.io`. |
| B6 | Diego, SQL Editor | SQL A (passkeys): respaldo, borrado y verificación. |
| B7 | Admins, en el celular | Los 5 pasos de la sección 4 (la app también los muestra en el login y en Hoy). La niñera de práctica (Diego): lo mismo en `/app/ninera/`. |
| B8 | Diego, GitHub | Repo de redirección en el nombre viejo: `docs/mudanza-redireccion/README.md` tiene los pasos. |
| B9 | Claude | Verificación final: login del panel, link de invitación generado con la dirección nueva, login de la niñera de práctica, avisos activados, TomTom en una dirección. |
| B10 | Diego, SQL Editor, cuando las 3 activaron avisos | SQL B (suscripciones push viejas). |

### C. Después
| Cuándo | Quién | Qué |
|---|---|---|
| A la semana | Diego | Sacar `https://diegomarin28.github.io` del secret `ORIGENES_PERMITIDOS`. |
| Con OK | Claude | Republicar `ninera-cuenta` y `pedido-whatsapp` con el valor por defecto nuevo, y sacar el origen viejo del valor por defecto. |
| Al mes | Claude | PR que saca el aviso "La app se mudó" (login y Hoy, `tests/mudanza.spec.js`). |
| Cuando quiera | Diego | Actualizar el remote del checkout local (B3 lo hace Claude si trabaja ahí). |

## 4. Texto de WhatsApp para las admins
Lo manda Diego antes de la noche (y de nuevo cuando la app ya está en la dirección nueva):

> Hola! Esta noche la app cambia de dirección: pasa a parentsbreak.github.io/app. Va a estar fuera
> unos minutos. Después hay que reinstalar el ícono en el celular, lleva dos minutos:
> 1. Borrá el ícono viejo de Parents' Break del celular.
> 2. Abrí parentsbreak.github.io/app en Safari (en Android, en Chrome).
> 3. Tocá Compartir y después Agregar a pantalla de inicio.
> 4. Abrí la app desde el ícono nuevo y entrá con tu mail y contraseña. Te va a pedir activar Face ID
> de nuevo, como la primera vez.
> 5. Activá los avisos desde la campanita.
> Si el ícono viejo te abre una página que dice "La app se mudó", es eso mismo: seguí esos pasos.
> Cualquier cosa me escribís.

## 5. SQL para el SQL Editor (lo corre Diego, con el "dale")
Los dos hacen primero una copia en una tabla `respaldo_20261027_...` dentro de `public`, y después
borran. Las tablas de respaldo se dejan unas semanas y se borran a mano cuando ya no hagan falta.

### SQL A: passkeys viejas (la noche, después de cambiar el Relying Party ID, paso B6)
```sql
begin;
create table public.respaldo_20261027_webauthn_credentials as select * from auth.webauthn_credentials;
-- Con RLS y sin políticas: la app no la ve (como los demás respaldos del repo).
alter table public.respaldo_20261027_webauthn_credentials enable row level security;
delete from auth.webauthn_credentials;
commit;
```
Verificación (tiene que dar 0):
```sql
select count(*) from auth.webauthn_credentials;
```
Y el respaldo tiene que tener las filas que había (hoy, 5):
```sql
select count(*) from public.respaldo_20261027_webauthn_credentials;
```

### SQL B: suscripciones push viejas (recién cuando las 3 admins activaron avisos en la dirección nueva, paso B10)
`push_subscriptions` no guarda el origen: las viejas se reconocen por `created_at` anterior a la
mudanza. Reemplazar el marcador por la fecha y hora de la mudanza en UTC (Montevideo es UTC-3: las
22:00 del 27/10 son `2026-10-28 01:00:00+00`). Las filas de niñeras (`user_id` no nulo) no se tocan.
```sql
begin;
create table public.respaldo_20261027_push_subscriptions as select * from public.push_subscriptions;
-- Con RLS y sin políticas: guarda endpoints y claves, la app no la tiene que ver.
alter table public.respaldo_20261027_push_subscriptions enable row level security;
delete from public.push_subscriptions
 where user_id is null
   and created_at < '<fecha y hora de la mudanza, por ejemplo 2026-10-28 01:00:00+00>';
commit;
```
Verificación (tiene que dar las que activaron en la dirección nueva: una por admin y dispositivo):
```sql
select count(*) from public.push_subscriptions where user_id is null;
```
Antes de correrlo conviene mirar qué se va a borrar, con la misma condición:
```sql
select id, created_at from public.push_subscriptions
 where user_id is null and created_at < '<fecha y hora de la mudanza>'
 order by created_at;
```
