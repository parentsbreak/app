# WhatsApp Business Platform: diseño para Parents' Break

**Estado:** investigación y diseño; no es una implementación ni una autorización para conectar el
número.
**Fecha de revisión:** 1 de noviembre de 2026.
**Alcance:** mensajes entre Parents' Break y madres. Nunca se usa esta integración para hablar con
niñeras: los pedidos y avisos a niñeras siguen saliendo por su app y por push.

Este documento parte de una regla que no cambia: **ningún mensaje a una madre se envía solo**.
La API puede quitar el paso de abrir WhatsApp y copiar, pero el último toque de una administradora
es obligatorio y queda registrado.

## Resumen de la decisión recomendada

Usar **WhatsApp Business Platform Cloud API con Coexistence** sobre el número actual, no migrarlo
fuera de la app. Así, el equipo conserva la app de WhatsApp Business como canal humano y suma al
panel dos cosas controladas: una bandeja para transformar mensajes entrantes en tickets y un botón
para enviar borradores aprobados.

Primero se implementaría la recepción y revisión de mensajes; luego el envío de cuatro clases de
borrador: perfiles, confirmación, todavía buscando y no conseguimos. No se programa ningún envío
automático ni se reemplaza WhatsApp Web en la primera salida.

## 1. Coexistence: qué conserva y qué cambia

Coexistence es el alta específica de Meta para conectar un número que **ya está en WhatsApp
Business App** a la Cloud API sin sacar ese número de la app. La app del celular y la API pueden
usarse a la vez para conversaciones individuales. Es distinto de migrar el número de forma
tradicional a la API.

### Respuesta corta para el equipo

- Sí, se puede seguir respondiendo desde la app de WhatsApp Business en el celular.
- Al conectar, Meta desvincula los dispositivos complementarios. Después se vuelven a vincular los
  compatibles. Por eso los dos celulares adicionales y las sesiones de WhatsApp Web deben tratarse
  como una puesta en marcha planificada, no como un cambio transparente.
- La app conserva el número y su uso humano. Los mensajes enviados desde la API también aparecen
  en la app; los enviados desde la app deben llegar como eventos de eco para que el panel no pierda
  el contexto.
- Los grupos siguen siendo para usar desde la app, pero no forman parte de la conversación que
  procesa la API ni de la importación de historial. La API no debe intentar automatizarlos.
- Las listas de difusión pasan a solo lectura y no se pueden reconstruir en la plataforma. No usar
  esta integración hasta que las dueñas acepten perder la capacidad de crear o editar nuevas listas
  desde ese número.

### Qué hacer con los dispositivos actuales

| Hoy | Al habilitar Coexistence | Decisión práctica |
|---|---|---|
| App Business en el teléfono principal | Se mantiene y se puede seguir usando. | No desinstalarla ni cambiar de número durante el alta. |
| Segundo celular y tercer celular como vinculados | Se desvinculan durante el alta y hay que volver a vincular los compatibles. | Hacer el alta con las tres admins disponibles y volver a entrar antes de darla por terminada. |
| WhatsApp Web de las tres admins | También se corta al alta; se vuelve a vincular manualmente. | Tener QR, teléfono principal y cada computadora a mano; probar envío y recepción desde cada una. |
| WhatsApp para Windows / Wear OS | Meta los lista como no compatibles en Coexistence. Los mensajes pueden no llegar al webhook. | No usarlos como puesto de trabajo para este flujo; preferir Web en navegador y la app móvil. |
| Grupos | La app puede conservarlos, pero no se sincronizan como conversaciones API. | Seguir manejándolos exclusivamente desde la app. |
| Historial individual | Se puede elegir compartir hasta seis meses; no incluye historial de grupos. | Hacer copia local antes; compartirlo solo si se acepta que esos datos entren a Supabase. |
| Listas de difusión | Quedan de solo lectura y no se pueden crear/recrear. | Inventariar las listas antes y acordar una alternativa manual o campañas API con consentimiento. |

### Historial y privacidad

En el alta se ofrece compartir contactos e historial individual o arrancar sin compartirlo. Compartir
no es necesario para que funcionen los mensajes nuevos. Para Parents' Break se recomienda **no
importar el historial al primer lanzamiento**: ya existe información de familias en la base, se
reduce la copia de datos personales y se prueba con mensajes nuevos. Si las dueñas necesitan el
contexto anterior en el panel, se hace una segunda decisión explícita, con copia previa y período de
retención definido. El historial de grupos no se importa.

La documentación de alta de Meta describe el uso simultáneo de la app y la plataforma, la
desvinculación de los dispositivos complementarios, la elección de historial y el límite de hasta
seis meses. [Meta: Onboard WhatsApp Business app users](https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users).

## 2. Ventana de 24 horas, plantillas y CV

La ventana de atención al cliente dura 24 horas desde el último mensaje entrante de la madre. Cada
mensaje nuevo de ella reinicia el reloj. El panel debe mostrar siempre: **"Ventana abierta hasta
[hora]"** o **"Necesita plantilla"**; nunca intentar adivinarlo al enviar.

### Qué puede salir en cada caso

| Mensaje que hoy arma el panel | Si la madre escribió hace menos de 24 h | Si la ventana cerró |
|---|---|---|
| Perfiles disponibles | Mensaje libre y adjuntos de CV. Sigue necesitando el toque de la admin. | Plantilla de utilidad, solo si es respuesta a su pedido concreto; si no encaja como utilidad, pedirle que vuelva a escribir o usar la plantilla aprobada que corresponda. |
| Confirmación de la niñera | Mensaje libre. | Plantilla de utilidad de confirmación de servicio. |
| Todavía buscando | Mensaje libre. | Plantilla de utilidad de actualización del pedido. |
| No conseguimos | Mensaje libre. | Plantilla de utilidad de cierre/actualización del pedido. |
| Saludo, promoción o reactivación no ligada a un pedido | No corresponde a este flujo. | Plantilla de marketing y consentimiento previo; queda fuera de esta primera integración. |

"Libre" significa un mensaje no basado en plantilla enviado por la API dentro de la ventana; no
significa automático. Fuera de la ventana, una conversación iniciada por el negocio exige una
plantilla aprobada. Las plantillas se clasifican como utilidad, autenticación o marketing; para los
cuatro mensajes operativos de Parents' Break se debe proponer **utilidad**, con el pedido concreto
y variables mínimas. Meta puede reclasificar o rechazar una plantilla si mezcla promoción.

### Adjuntar CV en PDF o imagen

Dentro de la ventana, la Cloud API permite enviar un mensaje de tipo `document` (PDF) o `image`
(imagen) junto con el texto libre. El envío correcto es: el panel prepara el borrador, la admin ve
qué archivo adjuntará, confirma, la función sube/usa el medio y luego envía el mensaje. El archivo
debe salir del almacenamiento privado actual, no de un enlace público permanente ni de la URL
antigua guardada como texto.

Fuera de la ventana hay dos alternativas a decidir antes de construir:

1. **Plantilla de utilidad con encabezado de documento o imagen.** Es la mejor experiencia, pero
   requiere que Meta apruebe la plantilla y que el formato del CV sea compatible con ese encabezado.
2. **Plantilla de utilidad sólo de texto que pide a la madre responder.** Cuando ella responde,
   se abre una nueva ventana y la admin confirma el envío del PDF. Es menos automática, pero evita
   atar la plantilla a un CV que puede cambiar.

No se adjunta CV por el solo hecho de que una niñera haya aceptado. El borrador de perfiles consulta
el historial familia--niñera: si ya trabajó con esa familia, lista su nombre sin reenviar CV; si es
nueva, ofrece adjuntar su CV. Una admin puede corregirlo antes de enviar.

Fuentes: [Meta: envío de mensajes Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages),
[Meta: plantillas](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates) y
[Meta: guías de categorías](https://developers.facebook.com/docs/whatsapp/updates-to-pricing/new-template-guidelines).

## 3. Costos para Uruguay

Meta cobra por mensaje **entregado**, no por intento, según el país del destinatario y la categoría.
Para madres con número de Uruguay corresponde la tarifa regional **Rest of Latin America**. La
tarifa de referencia del rate card efectivo el 1 de octubre de 2026 es:

| Tipo | USD por mensaje entregado a Uruguay | Uso probable aquí |
|---|---:|---|
| Servicio (mensaje libre dentro de la ventana) | 0,0113 después de los 1.000 de servicio gratuitos mensuales por número | Respuestas y perfiles cuando la madre escribió. |
| Utilidad (plantilla) | 0,0113 | Confirmación, aún buscando y no conseguimos fuera de ventana. |
| Autenticación | 0,0113 | No se usa. |
| Marketing (plantilla) | 0,0740 | No se usa en este flujo. |
| Mensaje entrante de la madre | 0 | Entrada del pedido. |

Para 10 a 30 pedidos por semana son aproximadamente 43 a 130 pedidos por mes. Si se envían dos
mensajes operativos por pedido a madres uruguayas (por ejemplo, perfiles y confirmación/cierre),
el techo simple es 86 a 260 mensajes al mes: **USD 0,97 a USD 2,94** si todos fueran cobrados a
la tarifa de utilidad/servicio. En la práctica será menor si predominan respuestas dentro de la
franquicia de 1.000 mensajes de servicio, y mayor sólo si se usan más mensajes o marketing. No
incluye el costo de un proveedor/BSP: la recomendación es usar Cloud API directa de Meta, por lo
que no habría abono de intermediario.

Las tarifas cambian y el país relevante es el de la madre, no el de Parents' Break. Antes de cargar
un medio de pago hay que volver a mirar el selector y el rate card de Meta y guardar una captura
interna con fecha. Fuentes oficiales: [Pricing](https://developers.facebook.com/docs/whatsapp/pricing),
[rate cards y tiers](https://developers.facebook.com/docs/whatsapp/pricing/rate-cards) y
[página de precios de WhatsApp Business](https://whatsappbusiness.com/products/platform-pricing/?lang=en).

## 4. Alta y requisitos

### Lo que hace falta antes de producción

1. Un **Meta Business Portfolio** controlado por Parents' Break, con dos administradoras como
   administradoras y Diego como desarrollador; no una cuenta personal de una sola persona.
2. Una app de Meta en modo Live, con el producto WhatsApp, una WhatsApp Business Account (WABA) y
   el alta de Coexistence para el número que ya está en WhatsApp Business App.
3. El acceso de la app a la WABA, permisos mínimos de WhatsApp, token de sistema con vencimiento y
   rotación documentada. Los tokens y el App Secret van sólo en Secrets de Supabase.
4. Webhook público HTTPS configurado en Meta para mensajes y estados, con el verify token y el
   App Secret cargados en Secrets. La función actual ya tiene el esqueleto de ambos chequeos.
5. Método de pago y límites de mensajería revisados en WhatsApp Manager antes de depender de
   plantillas o mensajes facturables.
6. Nombre, categoría y perfil del negocio revisados antes del alta. La verificación del negocio no
   debe confundirse con Meta Verified: la primera es el proceso de Business Manager y puede ser
   necesaria para límites/nombre; la insignia de suscripción de la app no es un requisito de este
   diseño ni debe tomarse como equivalente.

La verificación, revisión de nombre, elegibilidad del número y aprobación de plantillas no tienen
un plazo garantizado por Meta. Para planificar: crear la estructura de Meta y pedir verificación
primero; pedir las tres o cuatro plantillas de utilidad luego; recién conectar el número en una
franja en la que estén disponibles las admins para volver a vincular dispositivos. No prometer una
fecha de salida hasta que Meta muestre el número habilitado y al menos una plantilla aprobada.

Fuentes: [Meta: getting started Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started),
[Meta: administración de cuentas de negocio](https://developers.facebook.com/docs/whatsapp/business-management-api/get-started) y
[Meta: webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks).

## 5. Arquitectura propuesta sobre lo que ya existe

### Principios

- La API no reemplaza la revisión humana ni el ticket editable de `pedido-whatsapp`.
- `avisos` sigue siendo la cola de **push interno** a admins/niñeras. No se debe reutilizar como
  cola de mensajes a madres: son obligaciones, estados y reintentos diferentes.
- Las llamadas a Meta salen únicamente de Edge Functions con secretos. El navegador nunca recibe
  token de Meta, teléfono de una madre que no ya esté autorizado a ver ni URLs de media privadas.
- Todo evento es idempotente: Meta puede reintentar webhooks; una admin puede tocar dos veces;
  un estado de entrega puede llegar tarde o repetido.

### Punto de partida comprobado

- `whatsapp-webhook` ya valida el handshake GET y la firma `X-Hub-Signature-256` de Meta, limita
  el cuerpo y guarda el payload crudo en `whatsapp_eventos_raw`. Mientras falte
  `WHATSAPP_APP_SECRET`, rechaza los POST: es la conducta correcta hasta el alta real.
- `pedido-whatsapp` ya recibe texto pegado, valida a la admin, llama a Haiku y guarda un borrador
  en `pedidos_whatsapp` con tope diario de uso. La nueva entrada debe reutilizar su lógica de
  validación/ticket, no crear un segundo intérprete de pedidos.
- `avisos` + `encolar_aviso` + `enviar-avisos` + `pg_cron` ya resuelven push, exclusión mutua y
  reintentos de avisos internos. Un mensaje entrante puede encolar un push a las admins para que
  revisen el ticket, pero el envío WhatsApp requiere su propia outbox.

### Tablas nuevas a proponer en un PR posterior

Los nombres son de diseño, no SQL definitivo. Todas quedarían con RLS: las admins autorizadas leen
lo necesario; escrituras de ingreso y envío sólo por funciones con clave de servicio. No se expone
ninguna por una API pública.

| Entidad | Datos mínimos | Propósito |
|---|---|---|
| `whatsapp_conversaciones` | id, `wa_id`/teléfono normalizado protegido, `familia_id` nullable, estado de identificación, `ultima_entrada_en`, `ventana_hasta`, `ultimo_mensaje_meta_id` | Una conversación individual por número; calcula la ventana y conserva el vínculo humano confirmado. |
| `familia_contactos_whatsapp` | familia, teléfono E.164 protegido, nombre/rol opcional, origen, confirmado_por/en, activo | Permite varios adultos por familia y no obliga a sobrecargar un único campo de teléfono en `familias`. |
| `whatsapp_mensajes` | conversación, dirección, id único de Meta, tipo, texto o referencia segura al medio, recibido/enviado, payload raw, `estado_procesamiento` | Bitácora normalizada de entrada, salida y eco de la app; deduplica reintentos. |
| `whatsapp_lotes_entrada` | conversación, mensajes incluidos, abre/cierra, estado `esperando/revisar/procesado/descartado`, `pedido_whatsapp_id` nullable | Agrupa varios textos, fotos y audios antes de llamar a Haiku una sola vez. |
| `whatsapp_envios` | conversación/familia/pedido, clase de mensaje, borrador, adjuntos, plantilla/categoría, `confirmado_por/en`, estado Meta, id de Meta, error sanitizado, clave idempotente | Outbox auditable: separar redactar, confirmar, enviar, entregar, leer o fallar. |
| `whatsapp_medios` | mensaje, media id Meta, tipo, tamaño, ruta privada, vencimiento/retención, transcripción y estado | Traza PDFs, imágenes y audios sin dejar URLs públicas ni bajar el archivo repetidamente. |

`whatsapp_eventos_raw` se conserva como registro forense de corta retención, no como fuente para la
pantalla. Debe sumar ID/hash del evento y estado de procesamiento para poder reprocesar con
seguridad. Definir antes una retención: por ejemplo, raw 30 días y medios sólo el tiempo necesario
para el ticket, salvo que una administradora los vincule a una ficha o gasto legítimo.

### A. Entrada: madre -> ticket para revisar

1. Meta hace POST al webhook. La función valida la firma sobre el cuerpo original, guarda el evento
   crudo de forma idempotente y responde 200 rápido.
2. Un procesador separado lee eventos nuevos, extrae sólo mensajes 1:1, crea/actualiza la
   conversación y guarda cada mensaje con su ID de Meta. Los cambios de estado de mensajes
   enviados actualizan `whatsapp_envios`, no crean un pedido.
3. Identificación de familia, en este orden:
   - coincidencia exacta del teléfono normalizado con un contacto previamente confirmado;
   - coincidencia exacta con el teléfono existente de una familia, marcada como **propuesta**;
   - si no hay una sola coincidencia clara, queda **sin identificar** y la admin elige familia o
     crea/asocia el contacto desde el ticket.
   No usar nombre, texto o IA para vincular automáticamente una familia; hay homónimos, teléfonos
   compartidos y números nuevos. Después del toque de confirmación se guarda el vínculo para la
   próxima vez.
4. Agrupación: cada mensaje nuevo reinicia una espera corta de dos minutos. Al pasar dos minutos
   sin otro mensaje, o diez minutos desde el primero del lote, el lote queda "Listo para revisar".
   La admin también tiene "Procesar ahora". Así un "Hola", fecha, horario y dirección enviados en
   mensajes separados no consumen varias llamadas a Haiku ni generan varios tickets.
5. Texto: se concatena en orden con hora y tipo para `pedido-whatsapp`. Foto/PDF puede quedar como
   adjunto visible; no se envía al modelo por defecto. Audio queda como "audio pendiente" hasta
   obtener transcripción y mostrarla para corregir. Sólo entonces se llama a la lógica existente
   de `pedido-whatsapp`, que crea el borrador editable conocido.
6. Al haber lote listo o ticket creado se encola un aviso interno a las admins. Nunca se crea una
   `solicitud` ni se manda nada a niñeras sin la revisión que ya exige la etapa 5.

#### Audios: decisión necesaria

Haiku se usa hoy para texto estructurado; este diseño no presupone que sea el transcriptor de voz.
Hay dos alternativas válidas:

| Alternativa | Ventaja | Costo/riesgo |
|---|---|---|
| Primera versión: audio adjunto + transcripción manual de admin | Sin proveedor ni dato de voz adicional; lanzamiento simple. | No elimina el trabajo de escuchar. |
| Transcripción por servicio elegido y aprobado | El ticket puede incorporar el texto de audio. | Nuevo proveedor, datos sensibles, costo y necesidad de mostrar/editar la transcripción antes de usarla. |

Recomendación: lanzar primero texto, PDF e imagen; sumar audio sólo después de elegir proveedor y
retención. Nunca mandar audio ni transcripción directamente a Haiku sin esa decisión.

### B. Salida: borrador del panel -> madre

1. La etapa 6 ya arma el contenido de perfiles, confirmación, todavía buscando y no conseguimos.
   En vez de "Copiar"/"Abrir WhatsApp", un adaptador crea un **borrador de WhatsApp** en
   `whatsapp_envios`. No envía todavía.
2. La pantalla muestra destinatario, familia identificada, texto final, adjuntos, si la ventana
   está abierta, plantilla/categoría si hace falta, y la regla de CV nueva/conocida.
3. El botón dice **"Enviar por WhatsApp"**. Abre una confirmación explícita: "Se enviará ahora a
   [contacto confirmado]" con botón final "Confirmar y enviar". Ese toque graba admin, fecha,
   contenido y adjuntos que vio. Cancelar no cambia nada.
4. Una Edge Function de envío reclama sólo ese registro confirmado, valida que siga siendo enviable
   (ventana o plantilla aprobada), manda a Meta con clave de idempotencia y guarda el ID devuelto.
5. Los callbacks `sent`, `delivered`, `read` y `failed` actualizan la outbox. Si hay error no se
   reintenta a ciegas ni se vuelve a abrir la ventana: el panel muestra "Falló, revisar y reenviar".
   Un reenvío es un nuevo acto de confirmación, vinculado al anterior para auditoría.
6. El mensaje también será visible en la app Business por Coexistence. El panel muestra su estado
   pero no presume que fue leído hasta recibir el estado correspondiente de Meta.

## 6. Decisiones y riesgos antes de construir

| Decisión | Alternativas | Recomendación |
|---|---|---|
| Tipo de conexión | Coexistence / número nuevo API / migración tradicional | Coexistence: conserva canal humano y el número. Aceptar previamente desvinculación de dispositivos y listas de difusión de solo lectura. |
| Importar historial | Hasta seis meses de 1:1 / no importarlo | No importarlo al inicio. Menos datos sensibles y menos confusión; el panel arranca con eventos nuevos. |
| Fuente de verdad para las admins | App Business solamente / panel solamente / ambos sincronizados | Ambos, con el panel como historial operativo de lo que procesó/envió por API. La app sigue para conversación humana y grupos. |
| Familias sin teléfono | Inferir por IA / pedir selección cada vez / contactos confirmados | Tabla de contactos confirmados; nunca inferir ni sobrescribir una familia de forma automática. |
| Espera entre mensajes | Procesar cada mensaje / lote corto / esperar manualmente | Lote de 2 min, máximo 10, con botón "Procesar ahora". |
| Audio | Manual / transcriptor externo | Manual en la primera versión; evaluar proveedor antes de automatizar. |
| Fuera de 24 h | Intentar libre / plantilla de utilidad / pedir respuesta | Plantillas de utilidad para los tres estados operativos; si hay duda de categoría, pedir respuesta y usar mensaje libre después. |
| CV | Link público / documento API privado / no adjuntar | Documento API desde Storage privado; sólo para niñera nueva y después de la confirmación de la admin. |
| Reintentos | Automáticos indefinidos / outbox controlada | Outbox con idempotencia y reenvío humano confirmado. Evita dobles mensajes a una madre. |
| Pago | Proveedor/BSP / Cloud API directa | Directa a Meta para este volumen; deja costos transparentes y evita abono extra. Evaluar BSP sólo si se necesita soporte contratado o bandeja de atención externa. |

### Riesgos que bloquean el alta si no se resuelven

1. **Operación:** la desvinculación inicial puede dejar temporalmente sin Web a las tres admins.
   Mitigación: alta en horario tranquilo, copia previa, checklist de reconexión y prueba desde cada
   dispositivo antes de cerrar.
2. **Datos personales:** número, conversación, CV, fotos y audios son datos sensibles. Mitigación:
   RLS estricta, Storage privado, secretos fuera del repo, retención corta, logs sin cuerpos y
   acceso sólo para admins autorizadas.
3. **Duplicados:** webhooks y estados pueden repetirse. Mitigación: IDs de Meta únicos y outbox
   idempotente; el "Confirmar y enviar" no llama dos veces si se toca de nuevo.
4. **Plantillas rechazadas o reclasificadas:** no basar el lanzamiento en que una plantilla será
   aprobada rápido. Mitigación: pedirlas con antelación y conservar la opción actual de enviar
   manualmente desde la app mientras estén pendientes.
5. **Canales en paralelo:** un mensaje contestado por WhatsApp Web debe verse como eco o puede
   dejar al panel desactualizado. Mitigación: prueba de ecos durante piloto y aviso visible
   "conversación continuada desde la app" si Meta no entrega un tipo de evento.
6. **Costos y límites:** Meta cambia rate cards, límites y condiciones. Mitigación: presupuesto
   mensual de USD 10, medio de pago con alerta y verificación trimestral de la tabla oficial.

## 7. Orden de trabajo propuesto (cuando termine la etapa 6)

No hacer el alta de Coexistence antes de que las niñeras reciban los pedidos por la app (prueba con niñeras reales de la fase 1): hoy las admins usan las listas de difusión para consultar a las niñeras y Coexistence las deja de solo lectura.

1. Las dueñas deciden los puntos de la sección 6 y aprueban los textos finales de las plantillas.
2. Crear/ordenar Business Portfolio, permisos, app, WABA, verificación y pago; solicitar
   plantillas, sin conectar aún el número operativo.
3. Hacer piloto de Coexistence con checklist de dispositivos y prueba de webhook, sólo con una
   conversación de prueba autorizada. Confirmar que la app, Web, eco, estados y firma funcionan.
4. PR de base y Edge Functions para ingreso: conversaciones, mensajes, lote, identificación manual
   y ticket revisable. Sin envío saliente todavía.
5. PR de outbox y botón de confirmación para un único tipo de mensaje, empezando por la
   confirmación. Medir una semana.
6. Sumar perfiles con CV, todavía buscando y no conseguimos, y recién entonces retirar los botones
   manuales si las dueñas lo piden.

Cada paso de producción requiere el OK explícito de Diego: involucra secretos, webhooks, datos de
familias y/o Edge Functions. Nada de este documento autoriza a subir secretos, conectar el número,
mandar una plantilla ni alterar datos reales.

## Fuentes oficiales de Meta consultadas

- [Onboard WhatsApp Business app users / Coexistence](https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users)
- [Cloud API: envío de mensajes](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages)
- [Cloud API: webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks)
- [Message templates](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates)
- [Pricing on the WhatsApp Business Platform](https://developers.facebook.com/docs/whatsapp/pricing)
- [Rate cards and volume tiers](https://developers.facebook.com/docs/whatsapp/pricing/rate-cards)
- [WhatsApp Business Platform pricing](https://whatsappbusiness.com/products/platform-pricing/?lang=en)

La documentación de Meta y sus rate cards cambian. Al ejecutar el alta, volver a consultar estas
fuentes con la sesión de Business Manager de Parents' Break y dejar fecha/captura de las condiciones
vigentes fuera del repositorio.
