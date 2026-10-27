# Fase 1: app de niñeras + asistente de pedidos

Aprobada por las dueñas (23/10/2026, cambios 25/10/2026). Se lee junto con `reglas-del-negocio.md` (manda sobre esto si hay conflicto) y `textos.md` (textos finales). La guía original está en `guia-original.html` (artifact de una de las dueñas; hoy guarda el avance solo en el celular).

Repo público: nada de nombres reales, teléfonos, cuentas ni datos de familias o niñeras en código, tests, fixtures, commits ni PRs. Datos ficticios siempre.

## Arquitectura
- Misma web app, mismo repo, mismo Supabase, GitHub Pages, JS vanilla sin build (como hoy).
- Dos puertas: admins (la actual) y niñeras (`/ninera/`, con su manifest, ícono y service worker propios). Familias: después.
- Mismo Supabase Auth. Rol por usuario (admin / niñera). RLS por rol: la niñera solo lee y escribe lo suyo (sus pedidos, sus sittings, su perfil, su chat). Una niñera que entra a la puerta de admins va a la suya. `es_usuaria_autorizada()` sigue siendo la regla de admins.
- La niñera NO puede leer columnas de cobro a la familia, márgenes, pagos acumulados ni datos de otras niñeras. Para ella se expone una vista/función con solo lo permitido (precio por hora, madre nombre + inicial, dirección solo después de quedar seleccionada).
- Push: reutilizar VAPID y las Edge Functions de push existentes. iPhone: la PWA tiene que estar en la pantalla de inicio.
- Asistente: Edge Function `pedido-whatsapp` (Haiku) ya existe; se usa para armar el pedido desde el texto pegado.
- Horarios en hora de Uruguay (America/Montevideo). Recordatorios y relojes con cron de Supabase (pg_cron) o Edge Function programada.

## Niñera
1. Invitación: la admin genera un link único (vale 7 días) y lo manda por WhatsApp (único mensaje por WhatsApp). La niñera crea usuario y contraseña, instala la app, activa avisos.
2. Perfil (una vez): servicios (Sittings / Carsittings / Ambos), zonas, datos bancarios. Se vincula con su fila existente en `ninieras`.
3. Guía obligatoria: Protocolos + RCP y primeros auxilios (todas las lecciones leídas y repaso aprobado) con fecha guardada en la base. Sin terminarla no recibe pedidos. A las que ya trabajan: 1 semana de plazo desde que activan la app. Firma anual (declaración + nombre + firma + versión de la guía); sin firma del año no recibe pedidos. RCP presencial Sí/No, foto del certificado opcional. Contenido de la guía como datos (tablas o JSON), no hardcodeado en HTML. La lección "Higiene y cambio de pañales" (id b2) va en Bebés, no en Protocolos.
4. Pedido: push + tarjeta en formato lista (ver textos). Acepto / No puedo (motivo) / marcar otros días que no puede.
5. Elección: la elige la madre (ver flujo admins). La elegida recibe "¡Quedaste seleccionada!" con los datos; las demás que aceptaron, "ya se cubrió".
6. Cambio de horario: Ok / "A esa hora no puedo" (avisa a admins).
7. El día: recordatorios 24 h y 1 h antes. Estoy saliendo / Voy a llegar tarde (10/20/30+). Al llegar: Ya entré / Estoy afuera y no me abren / No encuentro la casa. Ficha de la familia (de la guía), ligada al sitting y a la familia; la próxima niñera la ve en "¡Quedaste seleccionada!"; las admins en la ficha de la familia.
8. Al final: "Llegaron los padres" con hora real (a la hora de fin prevista llega el aviso; si a los 30 min no cerró, recordatorio con "Se extendió el sitting"). Gasto extra con monto + foto. Comentarios extras. Calificación 1–5, ¿volverías?, ¿a qué jugaron?, comentario al equipo. Una admin revisa el registro con un toque y queda en `sittings_traslados` como hoy.
9. Chat con el equipo (lo leen todas las admins).
10. Carsitting dentro de la app para las que hacen Carsittings: campos de `carsitting_datos` (nombre completo, cédula, modelo, padrón, compañía y tipo de seguro, asientos, cinturones, año, color, matrícula, número y año de licencia, libreta de propiedad) + fotos de licencia, libreta, asientos y del auto por dentro y por fuera. Va todo junto en una sola pantalla. Recordatorio semanal si falta. Las admins lo revisan y habilitan traslados. Reemplaza el formulario de Google (ver PR viejo #60, rebasar o rehacer).
11. Temporada: se manda sola cada 1/10; recordatorio cada 15 días si no completó. Por quincena: Punta del Este / Montevideo / La Paloma / Fuera del país / Otro. Reemplaza el formulario actual (`temporada.html`). A las admins no se les pide más la
    temporada (27/10/2026): la niñera la completa en su app.
12. Nunca ve plata acumulada ni pagos (ver reglas, sección 3).

## Admins
1. Pegar el mensaje de la madre → `pedido-whatsapp` arma el pedido. La familia se propone por nombre/teléfono y la admin la confirma con un toque. Todo editable; dudas marcadas "a confirmar".
2. Sugeridas en el orden de las reglas (sección 5), con el porqué. Seleccionar y enviar a varias.
3. Precio niñera+familia: sale de lo guardado; solo se pide si nunca se cargó, y se guarda.
4. Avisos: instantáneo en cada "Acepto"; a los 15 min (pedido para hoy) o 30 min (otro día) "mándale los perfiles a la madre"; sin respuestas a los 30 min "¿se lo mandas a otras?"; pedido de hoy sin niñera 3 h antes; llegar tarde / no marcó que llegó / problema al llegar con botón "Contactarla"; comentarios extras; carsitting a revisar; chat.
5. Mensaje con los perfiles para la madre: texto listo para copiar con los CV (links o imágenes) de las que aceptaron. La admin marca la que eligió la madre.
6. Plantillas para la madre con [corchetes] completados solos (ver textos, sección 9).
7. Chat por niñera.

## Prueba
Con 3 a 5 niñeras reales elegidas por las dueñas; dos semanas o 10 pedidos. Antes, un pedido inventado de práctica. Durante, el resto sigue por WhatsApp.

## Fuera de la fase 1
Chat de ayuda para admins; panel de control por admin; niñeras de Argentina; opiniones de padres en el CV; juegos en la app; detección de suciedad/choques en fotos del auto; WhatsApp Meta; cruce con Mercado Pago; App Store; app de familias.

## Cómo se trabaja
- Primero brainstorming con Diego para cerrar dudas que surjan del código real; después plan escrito (writing-plans) en `docs/fase1/plan-implementacion.md`, dividido en etapas que se puedan probar y mergear por separado (ej.: 1 roles + RLS + login niñera; 2 perfil + invitación + push; 3 guía; 4 pedido → acepto → elección; 5 el día y cierre; 6 carsitting + temporada; 7 asistente y plantillas).
- Orden de las etapas (Diego, 27/10/2026): 1, 2, 3, 9 y después 4, 5, 6, 7, 8, 10, 11. La 9
  (temporada) se adelanta porque la temporada de verano ya empieza y el aviso del 1/10 ya pasó;
  va después de la 3 porque depende de su cola de avisos.
- Cada etapa en su worktree/rama, PR con CI verde y tests de Playwright con datos ficticios.
- Migraciones: archivo en `supabase/migrations/`, nunca aplicadas a producción sin OK de Diego. Si la confirmación del MCP vence, pasarle el SQL a Diego para el SQL Editor.
- Nada se manda a madres ni a niñeras reales sin confirmación de una admin.
