# Implementación de WhatsApp en Parents: YCloud, audios y Haiku

Fecha: 04/11/2026. Estado: propuesta para implementar por etapas. Investigación documental y lectura de `main`; sin pruebas de cuentas, cambios de código, migraciones aplicadas ni conexión del número real.

Documento de planificación. W1 está preparado en esta rama con código y pruebas; sigue sin publicar ni aplicar. Su guía concreta es `docs/ycloud-receptor.md`. Este plan no autoriza el despliegue, los secretos ni la conexión del número. Para arrancar las cuentas y conexión, seguir la sección 13; para construir el sistema, seguir W0–W7 en la sección 14. Lectura contrastada con `main` en `fa1216a5`, incluyendo `docs/fase1/prueba-iphone.md`: la condición es terminar la sesión de iPhone y el piloto real de niñeras antes de conectar el número operativo.

## 1. Decisión y resultado esperado

YCloud será la conexión de WhatsApp. Para audios, Groq con `whisper-large-v3` es el candidato inicial por costo y controles de datos; se comparará con ElevenLabs Scribe v2 antes de elegir el proveedor de producción (sección 12). Haiku reutiliza la lógica que ya arma los tickets en Parents. Las administradoras siguen trabajando en Parents y pueden continuar las conversaciones manualmente desde WhatsApp Business mediante Coexistence, si Meta admite el número.

Flujo completo:

1. La madre o el padre escribe o manda uno o varios audios al número habitual.
2. Parents recibe y guarda los mensajes, incluso si la IA está caída.
3. Los audios se transcriben; los mensajes relacionados se reúnen.
4. Haiku clasifica el intercambio y prepara un borrador con los datos y dudas.
5. Una admin confirma la familia y revisa el pedido. Nada se envía por esta recepción.
6. Continúa el motor existente de sugeridas, invitaciones por la app de niñeras y selección.
7. La admin puede enviar perfiles, confirmación, «Todavía buscando» y «No conseguimos» directamente desde Parents, después de revisar y confirmar el envío concreto.

Ni confirmar una niñera, ni enviar mensajes, ni marcar cobros se delega a la IA. La lectura de comprobantes no sustituye la conciliación bancaria; Mercado Pago automático sigue en espera.

## 2. Lo que existe y lo que falta

Se consultaron en GitHub las versiones actuales de `CLAUDE.md`, reglas y decisiones de fase 1 y las funciones `whatsapp-webhook`, `pedido-whatsapp/index.ts` y `ticket.ts`. Referencias de contenido: CLAUDE `38f3a381`, webhook `3f0479e6`, entrada de pedidos `211c217b`, ticket `ff621adb`. Son versiones de archivos, no una comprobación de los secretos o despliegues efectivos.

- El sistema es HTML/JS con Supabase; no requiere montar otra aplicación ni cambiar de framework.
- `whatsapp-webhook` valida la firma de Meta y guarda crudo. No entiende la firma ni el formato propios de YCloud. Además, responde éxito aunque falle la escritura: ese patrón no sirve para garantizar la recepción nueva.
- `pedido-whatsapp` ya valida la sesión de una admin, limita el gasto y guarda borradores. Su acceso interno actual permite solamente pruebas sin guardar: no se puede usar como acceso de producción para un procesador automático.
- `ticket.ts` usa actualmente `claude-haiku-5-5`, salida estructurada, 6.000 caracteres máximos de entrada, hasta 4.000 tokens de salida y 100 llamadas diarias compartidas. Reconoce pedido nuevo, cambio, cancelación y otra cosa. El precio sale de `precio_sitting`, no del modelo.
- El contexto temporal actual usa el día del procesamiento. Para mensajes retrasados hay que tomar el momento original del mensaje en Montevideo; un «mañana» recibido antes de medianoche no puede cambiar por procesarse después.

Reutilizar esa lógica con un procesador interno autorizado, conservando la entrada manual existente. No abrir el endpoint actual ni simular que el sistema es una admin. La implementación futura de esa adaptación y las pantallas se coordina con quien trabaje en pedidos y Agenda; este documento no los modifica.

Fuentes del proyecto: [CLAUDE](https://github.com/parentsbreak/app/blob/main/CLAUDE.md), [reglas](https://github.com/parentsbreak/app/blob/main/docs/fase1/reglas-del-negocio.md), [webhook](https://github.com/parentsbreak/app/blob/main/supabase/functions/whatsapp-webhook/index.ts), [entrada de pedidos](https://github.com/parentsbreak/app/blob/main/supabase/functions/pedido-whatsapp/index.ts), [lógica del ticket](https://github.com/parentsbreak/app/blob/main/supabase/functions/pedido-whatsapp/ticket.ts).

## 3. Recepción segura y recuperación

Crear un receptor separado `ycloud-webhook`; mantener el de Meta sin mezclar firmas. Suscribirse a mensajes entrantes y estados de envío. Incorporar los eventos de sincronización de Business App e historial como contexto, identificados por su origen: nunca como nuevos pedidos por defecto.

El receptor valida la firma `YCloud-Signature` con el secreto del endpoint, el cuerpo exacto y la protección temporal documentada. También comprueba que el número/WABA pertenece al negocio. Guarda evento y trabajo pendiente en una operación durable; solo después responde `2xx`. Si la base falla, devuelve error para activar reintentos. No espera a Groq ni Anthropic dentro de esa respuesta.

YCloud documenta hasta siete reintentos con intervalos de 10 s, 30 s, 5 min, 30 min, 1 h, 2 h y 2 h. Los reintentos no son una garantía de recuperación indefinida. Deduplicar por identificador de evento y por identificador de mensaje, dentro del ámbito de la cuenta/número.

Fuente: [configuración y seguridad de webhooks](https://nndocs.ycloud.com/reference/configure-webhooks). Para formato de firma y tiempos: [guía de integración](https://nndocs.ycloud.com/reference/webhook-integration-guide).

Procesar mediante trabajos persistentes en Postgres y un despachador periódico con pg_cron. Reclamo atómico, vencimiento del bloqueo y reintentos con espera para sobrevivir a una caída. No depender de una espera en memoria o de una tarea de fondo aislada. Alertar por trabajos atrasados y eventos rechazados sin incluir mensajes o números en logs. No prometer recuperar mensajes nunca entregados sin verificar antes qué mecanismo de reproducción ofrece la cuenta de YCloud.

Supabase permite disparar funciones desde Cron, y las Edge Functions tienen límites de ejecución: [Cron](https://supabase.com/docs/guides/cron), [límites](https://supabase.com/docs/guides/functions/limits).

## 4. Audios: proveedor y comportamiento propuesto

**Candidato inicial: Groq, Whisper Large V3 completo; alternativa a comparar: ElevenLabs Scribe v2.** Groq recomienda el modelo completo para casos sensibles a errores; el Turbo es más económico. Para nuestros volúmenes priorizaría precisión. La elección final depende del ensayo descrito en la sección 12: soporte multilingüe y cifras generales publicadas no prueban precisión rioplatense.

YCloud entrega el audio mediante un enlace. La descarga autenticada debe hacerse desde el servidor y copiarse pronto a almacenamiento privado; no depender de que ese enlace dure. Su documentación describe acceso autenticado durante 30 días. No pasar la clave de YCloud a Groq ni al navegador. Fuente: [recepción de audios y archivos](https://nndocs.ycloud.com/reference/whatsapp-inbound-message-webhook-examples).

Propuesta de procesamiento:

- Descargar con clave de YCloud solo desde destinos oficiales permitidos, validando redirecciones, tamaño y tipo; impedir peticiones a destinos internos.
- Subir los bytes directamente al transcriptor. Usar transcripción en español, no traducción al inglés. Probar `ogg/opus` real de WhatsApp en iPhone y Android.
- Conservar texto transcrito y audio privado, con identificación de cuál mensaje originó cada uno. Mostrar «Transcripción automática», escuchar, corregir y reintentar.
- Proponer para el piloto un máximo de 10 minutos y 20 MB por audio; excedidos, quedan para escucha manual. Son límites nuestros pendientes de validar, no límites anunciados de WhatsApp.
- Ruido, silencio, transcripción vacía, fallo o cuota agotada: «Audio pendiente de revisar». No inventar datos ni generar un ticket que parezca completo omitiendo ese audio.
- Una vez transcrito, no volver a pagar la transcripción en cada reprocesamiento. Reintentos acotados; una nueva versión conserva su trazabilidad.

Groq publica compatibilidad con OGG, máximo de archivo de 25 MB en Free y facturación mínima de 10 segundos por solicitud. [Especificaciones y precios de transcripción](https://console.groq.com/docs/speech-to-text).

El nivel Free publica para Whisper 20 solicitudes/minuto, 2.000/día, 7.200 segundos de audio/hora y 28.800/día. Son límites compartidos por organización y deben confirmarse en la cuenta; no constituyen una garantía de disponibilidad. [Límites de Groq](https://console.groq.com/docs/rate-limits).

Antes de procesar audios reales, habilitar Zero Data Retention y verificar su alcance en la cuenta. Groq documenta ese control para transcripción; retiene metadatos de uso y describe almacenamiento de contenido en EE. UU. cuando corresponde. No equivale a ausencia de procesamiento por terceros. [Tratamiento de datos](https://console.groq.com/docs/your-data).

## 5. Agrupar, identificar e interpretar

### Un intercambio, un borrador revisable

Propuesta inicial: esperar 60 segundos sin mensajes nuevos para formar un lote. Si quedan audios pendientes, no considerarlo completo. Tras tres minutos mostrar que sigue procesando; permitir revisión parcial con una advertencia visible. Estos tiempos son parámetros propuestos para el piloto.

Un mensaje tardío se agrega como novedad. Si la admin está editando, no pisa su trabajo: ofrece «Llegaron mensajes nuevos». Un pedido confirmado recibe una propuesta de cambio o cancelación, nunca una modificación automática. Dos servicios distintos del mismo chat se separan para revisión; el esquema actual representa un servicio y no se debe guardar solo uno omitiendo el otro.

Ordenar por fecha original y usar el contexto de respuesta cuando exista. Mantener el ancla temporal de cada mensaje al interpretar «hoy», «mañana» y horarios que cruzan medianoche. Respuestas como «sí» o «ella» se interpretan con contexto acotado, nunca como pedidos independientes. Un cambio ambiguo entre varios pedidos abiertos requiere elegir cuál.

### Reconocer a la familia

Guardar una agenda de contactos vinculados a familias, confirmada por una admin. Normalizar teléfonos en formato internacional y permitir varios contactos por familia. No adjudicar una familia solo por el nombre público de WhatsApp, ni fusionar automáticamente contactos si el número está compartido o cambió de dueño.

Los eventos de YCloud también contemplan identificadores de usuario: puede faltar el teléfono. Guardarlos sin fabricar números y ofrecer «Identificar familia» cuando no haya una asociación segura. Una sugerencia por nombre permanece como sugerencia. Fuente: [identidad en mensajes entrantes](https://nndocs.ycloud.com/reference/webhook-events-payloads).

### Haiku

Reutilizar el modelo configurado y el validador del ticket. Enviarle solamente mensajes relevantes, transcripciones, el instante de origen y el contexto mínimo autorizado. Revisar la actual lista completa de familias para no transmitir más información de la necesaria. No mandar el historial completo ni los CV al clasificador de pedidos.

Conservar salida estructurada, campos dudosos sin completar y referencias a los mensajes fuente. Las tarifas y sugeridas se calculan con las reglas existentes. Nunca ejecutar instrucciones contenidas en mensajes o transcripciones. Excluir ecos propios, estados e importaciones históricas del disparador de interpretación. No ocultar conversaciones «otra cosa»: quedan visibles para atención humana, incluyendo comprobantes.

No recortar silenciosamente un intercambio de más de 6.000 caracteres: ofrecer separar servicios o seleccionar mensajes. Contabilizar clasificación, extracción y reintentos dentro de los límites de gasto. No usar una llamada extra de clasificación por cada burbuja; una interpretación por lote como punto de partida.

El modelo actual y su tarifa están confirmados en [Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview) y [precios de Anthropic](https://platform.claude.com/docs/en/about-claude/pricing). Que el código use ese modelo no acredita el saldo ni el acceso efectivo de la clave actual.

## 6. Revisión en Parents y salida con confirmación

Proponer una entrada «WhatsApp por revisar» dentro del panel actual, sin rediseñar toda la navegación. Una tarjeta muestra mensajes, audio, transcripción, familia propuesta, borrador y dudas. Una admin puede tomar la revisión; guardar con control de versión evita que otra confirme una versión vieja. El borrador se vincula a una sola solicitud mediante una operación atómica y una clave única de origen. Conservar «Pegar WhatsApp» como alternativa y advertir posibles duplicados entre entrada manual y automática.

Las sugeridas se calculan al revisar, con disponibilidad actual. Enviar invitaciones y elegir niñera sigue pasando por las acciones actuales de una admin. Los mensajes y push a niñeras conservan la app y sus frenos de práctica.

Para cada mensaje a la madre:

1. «Enviar por WhatsApp» abre la vista previa con destinataria, texto final, archivos y posible cargo.
2. La admin confirma ese contenido exacto. Se registra quién, cuándo y qué versión aprobó.
3. El servidor comprueba autorización, destinataria, vigencia del pedido y ventana de envío; crea una salida única.
4. El envío registra estados pendiente, aceptado por proveedor, entregado, leído si se informa, fallido o resultado desconocido. Aceptado no significa entregado.

Revisar nuevamente si cambian el texto, la niñera o los adjuntos. Caducar una aprobación demorada si cambia el pedido o las condiciones del envío. No dejar aprobaciones genéricas para que un agente conteste después. Desactivar respuestas automáticas de YCloud y revisar las ya configuradas en WhatsApp Business durante el alta.

La ventana permite texto libre durante las 24 horas desde el último mensaje de la usuaria; fuera requiere plantilla aprobada. Mandar una plantilla no habilita por sí solo un PDF libre posterior: se necesita respuesta de la madre o una plantilla de medios aprobada que corresponda. Las categorías y aprobación no las decide Parents. Fuente: [guía de envío](https://nndocs.ycloud.com/reference/whatsapp-message-sending-guide).

CV: si ya trabajó con esa familia, solo su nombre. Si es nueva, el archivo entra únicamente después de «Revisé su perfil». Lectura adicional de `main`: `generarCv` en `js/ninieras.js` ya genera un PNG, lo sube a `ninieras-fotos/cv/` y guarda su enlace público en `ninieras.cv_url`, junto con `cv_generado_en` y `cv_generado_con`. `abrirPerfilesMadre` en `js/pedidos.js` ya distingue conocidas, nuevas y CV externos que todavía se adjuntan a mano. Reutilizar el PNG vigente y controlar si está desactualizado; para una nueva sin archivo accesible, bloquear el envío directo de perfiles hasta generarlo o adjuntarlo con validación. No basta la marca `cv_generado_en`. No cambiar la visibilidad del bucket actual dentro de esta tarea; los nuevos audios y adjuntos entrantes sí van a almacenamiento privado. Preferir subir los bytes al proveedor y usar su identificador de medio. Texto y cada archivo son partes separadas: si falla un CV, reintentar solo la parte fallida, sin repetir todo. [Envío de medios](https://nndocs.ycloud.com/reference/whatsapp_message-send), [ejemplos PDF](https://nndocs.ycloud.com/reference/whatsapp-messaging-examples).

Ante una respuesta de red incierta, marcar «Resultado por verificar»; no reenviar a ciegas. Usar correlación y consulta de estado cuando exista identificador. No asumir que un campo externo garantiza idempotencia del proveedor. Verificarlo expresamente antes de habilitar reintentos de envíos ambiguos.

## 7. Datos propuestos y controles

Nombres orientativos, a contrastar con el esquema al implementar:

- `whatsapp_contactos`: identificadores y teléfonos normalizados, familia vinculada, verificación por admin y fecha.
- `whatsapp_conversaciones`: cuenta, contacto, última entrada real, ventana, responsable y revisión actual.
- `whatsapp_mensajes`: evento y mensaje del proveedor, dirección, origen, instante original, texto, medio privado y estados.
- `whatsapp_transcripciones`: mensaje, modelo, resultado, versión, estado, duración facturable y corrección humana.
- `whatsapp_lotes`: mensajes incluidos, versión, estado de interpretación y vínculo al borrador existente `pedidos_whatsapp`. Un lote puede originar varios borradores si contiene servicios distintos; cada vínculo se registra sin duplicarlo.
- `whatsapp_trabajos`: procesamiento durable, intentos, próxima ejecución y bloqueo con vencimiento.
- `whatsapp_salidas`: contenido aprobado inmutable, admin, versión del pedido, partes del envío, correlación, estados y costo reportado.

Adaptar o reutilizar `whatsapp_eventos_raw` con proveedor e identificador único sin romper la recepción de Meta. Las nuevas tablas y archivos solo son accesibles para admins autorizadas y procesos internos. No para niñeras ni usuarios autenticados en general. Claves de YCloud, firma, Groq y Anthropic únicamente en secretos del servidor. No incluir teléfonos, conversaciones, CV, URLs firmadas ni credenciales en logs, tests o PR.

La cola `avisos` sigue dedicada a notificar a las admins; puede avisar «Mensaje por revisar» sin contenido sensible. No mezclar sus estados push con los de entrega WhatsApp. Puede reutilizarse su patrón de cola, no suponer que `enviar-avisos` ya envía WhatsApp.

Proponer purgar audios y eventos crudos a los 30 días y conservar el pedido y la trazabilidad mínima mientras sean necesarios, con política aprobada antes del piloto. La limpieza local no elimina automáticamente las copias del proveedor. YCloud publica seis meses de chat en Free y describe servidores principales en Singapur: verificar borrado, contrato de tratamiento y uso de contenido antes de cargar datos reales. [Plan](https://www.ycloud.com/pricing), [privacidad](https://www.ycloud.com/privacy-policy).

## 8. Costos: presupuesto de prueba

YCloud publica abono Free de US$0, API/webhooks y una cuenta de usuario. No contratar IA, traducción ni bandeja multiusuario adicional: las admins trabajan en Parents. Validar que este uso desde nuestro panel queda cubierto por el plan. Los cargos de Meta van aparte, sin recargo anunciado de YCloud. [Precios de YCloud](https://www.ycloud.com/pricing).

Groq puede quedar en US$0 dentro de su nivel gratuito y sus límites efectivos. Si se contrata pago por uso, Whisper Large V3 publica US$0,111 por hora: 100 minutos serían aproximadamente US$0,185 y 300 minutos US$0,555, antes de mínimos por solicitud e impuestos. Turbo publica US$0,04/h; el ahorro absoluto no justifica elegirlo sin comparar precisión. [Tarifas de audio](https://console.groq.com/docs/speech-to-text).

Haiku 5.5 publica US$0,10 por millón de tokens de entrada y US$0,50 de salida para entradas de hasta 100.000 tokens. Ejemplo presupuestario inventado: 130 interpretaciones de 3.000 tokens de entrada y 1.000 de salida suman US$0,104. Dos pasadas por cada una: US$0,208. Son supuestos, no mediciones; contar también contexto, razonamiento facturable y reintentos. [Tarifa oficial](https://platform.claude.com/docs/en/about-claude/pricing).

No cotizar Meta como «2.000 mensajes gratis». YCloud documenta desde octubre una franquicia mensual de 1.000 mensajes de servicio entregados por número y cobro separado de plantillas utility dentro de la ventana. La tarifa aplicable a Uruguay y los cargos reales se verifican en la cuenta y los estados de entrega antes de habilitar salida. [Facturación de mensajes](https://nndocs.ycloud.com/reference/whatsapp-message-pricing-integration-guide).

Propuesta: comparar primero Groq y ElevenLabs con grabaciones ficticias; usar Groq Free como punto de partida si supera la evaluación. Sin recargas automáticas y con contador propio de audio/tokens. Reservar un presupuesto técnico pequeño, por ejemplo US$1/mes para IA, sujeto a medición; no incluye Meta ni infraestructura. Al llegar al límite, se conserva y muestra todo mensaje, se pausa la IA y se ofrece revisión manual. No afirmar que el saldo antiguo de Anthropic alcanza sin consultar el saldo efectivo.

## 9. Etapas y condiciones para avanzar

### Etapa 0 — cuentas y prueba aislada

Preparar cuentas de propiedad del negocio, acceso a Business Portfolio, número de prueba y las claves fuera del repo. Verificar YCloud Free + Coexistence + panel propio, cuotas Groq, datos y bajas/migración de proveedor. No conectar aún el número operativo. La elegibilidad de un número de prueba no prueba la del número habitual.

**Salida:** texto, audio OGG de iPhone/Android, imagen y PDF recibidos con estados y firma; prueba registrada de los costos y controles efectivos.

### Etapa 1 — recepción durable

PR separado de receptor, almacenamiento y trabajos, con salida a madres desactivada. Solo datos ficticios y esquema de pruebas. Migraciones incluidas para revisión; no aplicarlas sin la autorización correspondiente.

**Salida:** firmas inválidas rechazadas; caída de la base provoca reintento; duplicados y reinicios no pierden ni multiplican mensajes; historial y ecos no crean pedidos.

### Etapa 2 — audios y Haiku en sombra

Transcribir y generar borradores con acceso interno seguro a la lógica compartida. Sin crear solicitudes, asignar ni enviar. Comparar transcripción/modelos con grabaciones ficticias en español rioplatense, incluyendo ruido y correcciones.

**Salida:** preservar audios fallidos; horarios, negaciones y fechas dudosas marcados; mensajes tardíos no pisan ediciones; gastos medidos. Proponer al menos 30 escenarios escritos/audio, todos inventados.

### Etapa 3 — revisión y conexión al flujo existente

PR coordinado con pedidos/Agenda para la entrada por revisar y su confirmación. Una sola solicitud por servicio, control entre admins y advertencia de duplicados con pegado manual. Sin cambios funcionales en `/ninera/` para esta integración.

**Salida:** revisión completa desde iPhone; sugeridas e invitaciones siguen la lógica existente; confirmaciones nunca ocurren por acción del modelo.

### Etapa 4 — salida aprobada

PR aparte para los cuatro mensajes, plantillas, CV y estados. Pruebas solo hacia destinatarios de prueba permitidos; salida real sigue apagada.

**Salida:** doble toque produce una sola salida local; texto aceptado no se muestra como entregado; CV nuevo/conocido correcto; falla parcial no repite archivos; timeout incierto requiere verificación; ventana vencida bloquea texto libre aunque se hubiera aprobado antes.

### Etapa 5 — alta del número real y piloto

**No hacer el alta de Coexistence antes de que las niñeras reciban los pedidos por la app (prueba con niñeras reales de la fase 1): hoy las admins usan las listas de difusión para consultar a las niñeras y Coexistence las deja de solo lectura.**

Ambos usos del celular/API pueden coexistir, pero cambian funciones de la app y no se sincronizan los grupos. Verificar en el alta los dos celulares y las tres sesiones Web: no prometer que se conservarán exactamente ni que bastará con volver a vincular todas. YCloud no lista Uruguay entre las exclusiones de su página, pero la elegibilidad efectiva depende de Meta. [Coexistence](https://www.ycloud.com/whatsapp-business-app-coexistence).

Tras cumplir el piloto de niñeras y con autorización de Diego: respaldo, plan de reconexión de dispositivos, verificación del número y un piloto propuesto de una semana. Empezar recibiendo con salida API desactivada; luego habilitar envío aprobado. Si falla la IA se sigue desde WhatsApp/pegado manual. Si falla el proveedor, pausar trabajos y usar Business App cuando siga disponible. No desconectar o migrar el número como primer recurso: acordar antes cómo liberar la línea de crédito y cambiar de proveedor sin perder control del negocio.

## 10. Pruebas que definen si está listo

- «El sábado de 20 a 2» y «mañana» antes de medianoche, procesado al otro día.
- «No, a las nueve no; a las diez», audio con «no tiene alergias» y nombres poco habituales.
- Texto + dos audios, un audio fallido y una corrección diez minutos después.
- Dos pedidos en un chat, dos familiares distintos y contacto sin teléfono.
- Cambio/cancelación con varios pedidos abiertos; jamás modificar automáticamente.
- Doble evento, eventos fuera de orden, replay, caída tras guardar antes de responder y trabajo interrumpido.
- Dos admins confirmando; pegado manual del mismo contenido.
- Un CV conocido y uno nuevo; texto entregado con PDF fallido; ventana que cierra mientras se envía el lote.
- Cuota gratuita agotada, saldo cero, caída Groq/Haiku/YCloud y mensaje de medio no soportado.
- Mensaje con instrucciones maliciosas, URL externa y archivo demasiado grande.
- Comprobante bancario recibido: queda para revisión, nunca marca «cobrado» por una imagen.

No considerar terminado hasta probar el recorrido completo con cuentas y números de prueba: WhatsApp → receptor → audio → borrador → revisión → flujo existente → envío aprobado → estado real. La lectura de documentación no reemplaza esa prueba.

## 11. Qué hace falta de Diego al implementar

Acceso de la titular al negocio de Meta, un número de prueba independiente, cuenta de YCloud y cuenta de Groq. La clave de Anthropic existente se reutiliza si tiene acceso y saldo. Los secretos se cargan en el servidor; no pegarlos en el chat. Las aprobaciones pendientes son para activar servicios y conectar el número, no para investigar ni preparar los PR de implementación.

Siguiente paso recomendado: Etapa 0 con número separado; después, primer PR solo de recepción durable. Así podemos construir en paralelo sin intervenir el flujo operativo hasta la integración coordinada.

## 12. Revisión ampliada de la transcripción: Groq y ElevenLabs

Actualización del 04/11/2026 a pedido de Diego. «Groq» es el servicio de inferencia propuesto; no es Grok, el modelo de xAI. «Level Labs» se interpreta aquí como ElevenLabs. No se corrieron transcripciones contra cuentas de los proveedores: la comparación siguiente es documental y el ensayo queda como condición para elegir.

### Qué cambia de la propuesta original

No dar por aprobado Whisper por ser barato. Preparar una interfaz de transcripción que permita cambiar de proveedor sin cambiar la lógica de pedidos. Comparar Groq Whisper Large V3 completo y ElevenLabs Scribe v2 con el mismo material, y elegir por errores relevantes para el negocio, no por marca ni por velocidad publicitada.

Scribe v2 soporta español, marcas de tiempo y vocabulario orientativo. Eso lo convierte en un candidato válido, pero las cifras de precisión anunciadas por ElevenLabs no son una medición de nuestras notas de voz ni son comparables directamente con las cifras publicadas por Groq. [Capacidades de Scribe](https://elevenlabs.io/docs/overview/capabilities/speech-to-text).

### API, suscripción y costo

La página de ElevenAPI publica Starter de US$6/mes y también modalidad por consumo sin compromiso mensual. Para Scribe v2 publica US$0,22 por hora; Realtime US$0,39/h. No necesitamos Realtime: recibimos un archivo completo de WhatsApp. No confundir los minutos de la interfaz web, los créditos de generación de voz y el consumo de transcripción por API. Verificar al crear la cuenta qué prueba gratuita, saldo mínimo, recarga e impuestos aplican; no asumir una bolsa gratuita renovable concreta. [Precios de ElevenAPI](https://elevenlabs.io/pricing/api?price.section=speech_to_text).

Ejemplo propio, a tarifa de uso y sin mínimos, impuestos ni franquicias: 100 minutos serían unos US$0,37 en Scribe frente a US$0,19 en Whisper Large V3 de Groq. La diferencia es de unos US$0,18; si Scribe resuelve mejor los horarios y negaciones, esa diferencia no debería decidir la elección. Si Groq Free funciona con la calidad requerida, sigue siendo la opción de menor gasto.

### Método propuesto para que un error no se convierta en un pedido incorrecto

1. Transcribir el archivo original sin resumirlo ni eliminar las correcciones de la persona. No aplicar reducción agresiva de ruido de entrada: puede borrar palabras breves como «no». Cualquier conversión conserva el original y debe demostrar que mejora los resultados.
2. Pedir marcas de tiempo y señales de calidad. Groq expone metadatos por segmento; son indicadores para revisión, no probabilidades calibradas de que una hora sea correcta. Calibrar umbrales con el ensayo, sin inventar un «95% seguro». [Metadatos de Groq](https://console.groq.com/docs/speech-to-text).
3. Mostrar junto a fecha, hora, cantidad de chicos o indicación de salud la frase de origen y un acceso al tramo de audio. Haiku extrae y marca dudas; no puede recuperar con certeza un «no» que el transcriptor omitió.
4. Con silencio, repeticiones, señales anómalas o discrepancias con texto escrito, dejar el campo pendiente. Whisper documenta la posibilidad de generar texto no pronunciado: no basta con que la salida sea una frase bien escrita. [Limitaciones del modelo](https://huggingface.co/openai/whisper-large-v3).
5. Si el ensayo muestra que ayuda, usar el segundo proveedor solo en casos dudosos y bajo un presupuesto acotado. Si difieren en un dato crítico, pedir escucha humana; no elegir al más convincente ni promediar horarios. Que coincidan tampoco garantiza que ambos estén bien.
6. Mantener siempre edición y escucha antes de confirmar. No hacer una corrección silenciosa del ticket a partir de una nueva transcripción.

La alternativa de mandar audio directamente a un modelo general para que devuelva solo el pedido elimina una transcripción intermedia visible y dificulta distinguir el origen del error. No la propongo como primera implementación. Tampoco montar Whisper en un servidor propio para este volumen: añade operación antes de demostrar una ventaja.

### Configuración y datos de ElevenLabs

La API admite archivo, código de idioma y palabras clave. Probar primero sin listas de familias o niñeras; introducir nombres esperados puede sesgar la transcripción. Los keyterms tienen un recargo del 20%. No activar edición de transcripción, detección de entidades o servicios médicos por defecto. [API de Scribe](https://elevenlabs.io/docs/api-reference/speech-to-text/convert).

Una diferencia relevante: el modo de retención cero de ElevenLabs está documentado para clientes Enterprise; no asumir que se obtiene con Starter ni con `enable_logging=false` en cualquier cuenta. Su documentación describe retención habitual y posibles copias de respaldo tras borrar. Antes de enviar audios reales, verificar la política efectiva del plan, tratamiento contractual y borrado; desactivar el uso para entrenamiento donde corresponda, sin confundir ese ajuste con retención cero. [Retención](https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode), [política y alcance](https://elevenlabs.io/privacy-policy). En Groq, verificar los controles de retención descritos en la sección 4.

### Ensayo que decide el proveedor

Preparar 40 notas de voz de prueba con información inventada, grabadas por al menos cuatro personas con habla rioplatense y enviadas realmente por WhatsApp desde iPhone y Android. Usar exactamente los mismos archivos descargados para ambos motores. No basar la decisión exclusivamente en voces sintéticas.

- Diez con fechas, horas, correcciones y cruces de medianoche: «a las nueve no, a las diez», «hasta las dos de la mañana».
- Diez con negaciones, edades e indicaciones: «no tiene alergias», «no puede comer maní», «uno de dos y otro de cinco».
- Diez con nombres ficticios, barrios, audios cortos, habla rápida y servicios múltiples.
- Diez con ruido, interrupciones, pausas, silencio y frases incompletas.

Escribir la transcripción humana de referencia y la respuesta esperada del ticket antes de ver los resultados. Evaluar por separado transcriptor y flujo transcripción → Haiku. Medir datos críticos correctos, omisiones, texto inventado, errores que llegaron sin advertencia, tiempo de corrección de la admin, latencia y gasto. No resumir todo en un único porcentaje de palabras correctas.

Condición propuesta de avance: ningún dato crítico incorrecto debe pasar sin quedar señalado para revisión dentro de este conjunto. Un fallo obliga a ajustar el proceso y repetir los casos afectados junto con un conjunto nuevo. Superar 40 audios no garantiza precisión universal: mantener seguimiento en el piloto y la revisión humana. Elegir Scribe si muestra una mejora útil; elegir Groq si la calidad es equivalente y conserva la ventaja de costo y controles de datos.

**Resultado actual:** ElevenLabs merece estar en la prueba y no hace falta comprar todavía la suscripción de US$6. Groq sigue como candidato inicial; ninguno queda declarado «funciona bien para Parents» antes del ensayo.

## 13. Guía de arranque fuera del sistema

Esta es la secuencia operativa para la persona que tiene acceso al negocio. Los nombres exactos de botones pueden cambiar: al ejecutarla se contrastan con la pantalla, sin inventar opciones. No se han completado altas ni se han inspeccionado sesiones privadas de Meta/YCloud. La documentación directa de Meta de Coexistence devolvió un límite de acceso durante esta revisión; los pasos de conexión se contrastaron con la guía pública de YCloud, no con una sesión de Meta.

### A. Revisar propiedad y acceso a Meta, sin conectar el número

1. Abrir [Meta Business Suite](https://business.facebook.com/) con la cuenta personal de Facebook autorizada por el negocio. No crear una cuenta personal compartida.
2. Seleccionar el portafolio de Parents. Si no existe, preparar su creación a nombre del negocio. Evitar duplicar uno existente por no encontrarlo.
3. Revisar quién tiene control suficiente sobre el negocio y sus activos de WhatsApp; una titular debe conservar la propiedad y la recuperación. El acceso del desarrollador se limita a lo necesario para configurar.
4. Revisar información comercial, sitio público, estado de restricciones y verificaciones pendientes. Si Meta pide verificación, la titular aporta los documentos que solicite el flujo. No cargar documentos ni datos legales en GitHub.
5. Verificar que el nombre y los datos comerciales coincidan con los documentos del negocio. No prometer aprobación ni fecha; el alta puede quedar esperando a Meta.
6. Separar verificación del negocio, verificación del número y una eventual insignia paga: no contratar una insignia como supuesto requisito de la API.

Preparar una ficha privada de control, fuera del repo, con la titular responsable, estado del portafolio, WABA si ya existe, proveedor anterior si lo hay y quién tiene el celular principal. Nunca registrar claves o códigos en esa ficha.

Referencia sobre datos y verificaciones: [guía de alta de YCloud](https://www.ycloud.com/blog/how-to-get-whatsapp-api). Los datos exactos a aportar los determina Meta en el flujo de la cuenta.

### B. Crear o revisar la cuenta de YCloud

1. Abrir [YCloud](https://www.ycloud.com/console/#/entry/register), o iniciar sesión si ya existe cuenta.
2. Usar una dirección controlada por el negocio y comprobar la recuperación. La titular completa el alta y acepta los términos; no crear la cuenta con una dirección inventada.
3. Seleccionar el plan gratuito y confirmar que API/webhooks y nuestro uso desde Parents están incluidos. No contratar IA, campañas ni usuarios adicionales para empezar.
4. Identificar la sección de WhatsApp/WhatsApp Manager y la opción Coexistence. Todavía no escanear el QR del número operativo.
5. Revisar modo de facturación y saldo. Elegir la modalidad disponible en esa cuenta; no agregar pago directo a Meta y saldo de YCloud como si siempre fueran necesarios los dos. Registrar la tarifa Uruguay, el mínimo de recarga y los topes antes de cualquier gasto.
6. Revisar que no haya agentes, campañas o respuestas automáticas activas. El receptor de Parents no envía acuses ni respuestas por sí solo.

La cuenta gratuita del panel no representa tres cuentas de admins en YCloud: las admins usan sus sesiones actuales de Parents. [Plan oficial](https://www.ycloud.com/pricing).

### C. Preparar un número separado para pruebas

1. Usar un número bajo control del negocio, separado del que usan hoy las familias y niñeras. Si se va a ensayar Coexistence, debe ser un número de WhatsApp Business elegible; no asumir que un número nuevo lo será.
2. Conectarlo por la opción que corresponda a su estado. Una conexión API nueva prueba la integración, pero no prueba las restricciones de Coexistence del número habitual.
3. Si no se dispone de número elegible, continuar con pruebas firmadas/simuladas y dejar explícitamente pendiente la prueba de WhatsApp real. No presentar simulación como recorrido completo.
4. Registrar una lista privada de destinatarios de prueba permitidos. En pruebas, el servidor bloquea cualquier otro destinatario, aunque alguien lo cambie en el navegador.

### D. Preparar transcripción y Anthropic

1. Crear o revisar Groq y ElevenLabs bajo control del negocio; comprobar los límites y el precio efectivo antes de activar pago. No comprar la suscripción de ElevenLabs solo para comparar.
2. Ejecutar el ensayo de la sección 12 con contenido ficticio. No usar audios de familias para explorar cuentas gratis.
3. Elegir el proveedor con los resultados; configurar sus controles de datos y presupuesto.
4. Comprobar que la clave de Anthropic existente tiene acceso al modelo configurado y saldo. No reutilizar claves encontradas en historiales ni pedirlas por chat.

### E. Conectar YCloud al receptor de Parents, después del PR de recepción

1. Aplicar en el entorno de prueba la migración revisada y publicar `ycloud-webhook` únicamente tras la autorización de despliegue. Su ruta prevista es `https://<proyecto>.supabase.co/functions/v1/ycloud-webhook`.
2. En YCloud, ir a Developers → API Keys para preparar la clave de servidor, con el menor alcance disponible. Guardarla directamente como secreto de Supabase `YCLOUD_API_KEY`; nunca dentro del HTML/JS publicado.
3. En Developers → Webhooks crear el endpoint HTTPS con la URL del receptor publicado.
4. Seleccionar `whatsapp.inbound_message.received` y `whatsapp.message.updated`; sumar los eventos exactos de sincronización/historial y plantillas que se validen con la cuenta. No adivinar sus nombres al implementarlos.
5. Guardar el secreto propio del endpoint en Supabase como `YCLOUD_WEBHOOK_SECRET`; exigir firma. Este secreto no es `WHATSAPP_APP_SECRET`, ni la API key de YCloud.
6. Preparar el secreto del transcriptor elegido y conservar `ANTHROPIC_API_KEY` en el servidor. Los nombres nuevos son convenciones propuestas para la implementación.
7. Configurar el proceso interno y el despachador de trabajos con autenticación propia. No reutilizar la clave de prueba de `pedido-whatsapp` para guardar pedidos.
8. Verificar un texto y un audio del número de prueba, el rechazo de firma falsa, el reintento tras un fallo y la ausencia de envíos salientes.

Fuente de pasos y firma: [configuración de webhooks de YCloud](https://nndocs.ycloud.com/reference/configure-webhooks). La URL prevista no existe hasta publicar el receptor.

### F. Alta del número operativo: solo después del piloto de niñeras

1. Cumplir la condición sobre listas de difusión de la sección 9 y acordar una franja de baja actividad con las admins.
2. Respaldar y comprobar la recuperación de la app; inventariar los dos celulares y las sesiones Web, sin publicar números ni capturas privadas.
3. En YCloud elegir WhatsApp Business App Coexistence, iniciar el flujo oficial de Meta y seleccionar el portafolio correcto del negocio.
4. Verificar qué WABA se crea o selecciona y que queda bajo el portafolio del negocio. Detenerse si se propone un activo de otra empresa o una migración que no conserva el uso esperado.
5. Introducir el número internacional y completar las verificaciones que muestre el flujo. La titular maneja códigos, permisos y aceptación de condiciones. No borrar la cuenta de WhatsApp para forzar el alta.
6. Completar el QR o la confirmación desde WhatsApp Business según la pantalla oficial. La guía de YCloud describe un enlace mediante QR; revisar el paso exacto en la app actual, no tratar cualquier QR como equivalente a Coexistence.
7. Elegir conscientemente qué historial compartir. Todo historial importado queda como contexto; nunca dispara pedidos atrasados.
8. Verificar conversación entrante, respuesta manual, ecos y estados desde el celular principal, el segundo celular y las sesiones Web que sean admitidas. Registrar cualquier desvinculación y completar la reconexión permitida antes de dar por terminada el alta.
9. Empezar con recepción real únicamente. Habilitar la salida API de a un tipo de mensaje después de probar revisión y entrega.

Referencia: [flujo de conexión publicado por YCloud](https://www.ycloud.com/blog/integrate-ycloud-with-n8n), [cambios de Coexistence](https://www.ycloud.com/whatsapp-business-app-coexistence). No instalar n8n: en este proyecto la orquestación queda en Supabase. No es necesario crear una app propia de desarrolladores de Meta para consumir la API de YCloud en este diseño; seguir su alta oficial y confirmar cualquier requisito adicional que aparezca.

### G. Plantillas y lanzamiento

1. Preparar textos operativos sin promociones: confirmación, todavía buscando y no conseguimos. Para perfiles, contemplar tanto el resumen como cada CV nuevo.
2. Hacer que las dueñas revisen textos y ejemplos ficticios; presentarlos en el WABA correcto desde Templates de YCloud. La categoría es una propuesta: Meta puede cambiarla.
3. Esperar estado aprobado antes de habilitar cada plantilla. No fijar una fecha de lanzamiento basada en un plazo de aprobación supuesto.
4. Revalidar plantilla, destinataria, pedido y ventana al enviar. Fuera de ventana, no mandar un CV libre detrás de una plantilla sin respuesta de la madre; usar el medio aprobado correspondiente o continuar desde la app manualmente.
5. Piloto propuesto de una semana, con revisión diaria de pendientes, errores, costos y tiempos de corrección; ampliar tras corregir fallos. Conservar el camino manual.

Fuente: [revisión y estados de plantillas](https://www.ycloud.com/blog/whatsapp-api-message-template-mechanics).

### Qué puede hacer el asistente y qué requiere a una persona

El asistente puede leer el proyecto, preparar los PR, documentar la configuración, comparar resultados, revisar las pantallas compartidas y completar ajustes técnicos autorizados. Puede acompañar el registro y dejar cada configuración lista para revisión, sin pedir contraseñas por chat. No necesita que Diego copie manualmente todo este plan.

La titular realiza inicio/recuperación de credenciales cuando corresponda, manejo del celular/QR y códigos, aceptación de contratos, permisos sobre el negocio y decisiones de pago. Al llegar a cada paso se explica la acción concreta y se pide la intervención que realmente corresponda. No se conecta el número operativo ni se modifican secretos, permisos, datos o funciones publicadas por el solo hecho de aprobar este documento.

## 14. Secuencia concreta de PR y activaciones

La numeración W0–W7 es propia de WhatsApp; no renumera ni reemplaza las etapas existentes de fase 1. Rama nueva por PR, solo datos ficticios. Leer el `main` y revisar otros PR antes de tocar archivos compartidos. Las migraciones se escriben y prueban en el PR; Diego revisa/aplica o autoriza su aplicación. Cada despliegue de Edge Function tiene su autorización separada.

1. **W0 — este documento.** Solo `docs/whatsapp-ycloud-plan-implementacion.md`. No activa nada. Mantiene el diseño anterior como antecedente: se reemplaza su recomendación de conexión directa por la decisión actual de usar YCloud.
2. **W1 — ingreso durable.** Nueva función `supabase/functions/ycloud-webhook/`, configuración de función, migración de mensajes/eventos/trabajos y `supabase/schema.sql`. Tests Deno y SQL de firma, repetición, acceso y fallo de almacenamiento. Con `verify_jwt=false` solamente para el webhook público, la firma sigue siendo obligatoria. Publicación inicial en entorno/número de prueba; salida bloqueada en servidor.
3. **W2 — transcripción intercambiable.** Procesador de audios con almacenamiento privado y caché por mensaje/proveedor/modelo; test de formatos, tiempos, límites, falla y repetición. Archivos de prueba inventados. Informe del ensayo y decisión de proveedor antes de recibir audio real.
4. **W3 — interpretación en sombra.** Extraer/reutilizar la lógica de `pedido-whatsapp/ticket.ts` y validación del servidor, sin romper la entrada manual. Incorporar origen, instante original, versión, trazabilidad y vínculo de lotes/borradores. Tests de fechas y múltiples servicios, cuota y reinicio tras respuesta de IA. No tomar sesiones de admins ni abrir autorización del endpoint actual.
5. **W4 — revisión integrada.** Enlace desde Hoy/panel a pendientes y uso de `pintarTicket`, `elegirFamiliaTicket` y `crearSolicitudDesdeTicket` de `js/pedidos.js` como puntos de integración revisables. Transacción/clave de origen para confirmar una sola vez; control de versión y permiso de admin en servidor. Coordinado con pedidos/Agenda; no cambiar sus reglas ni `/ninera/`. Playwright a 390 y 1280 px, dos admins, error y alternativa manual.
6. **W5 — una salida operativa.** `ycloud-enviar` y cola de salidas separada de push. Primer botón en `abrirMensajeMadre`, limitado a confirmación con aprobación exacta. Tests de sesión, contenido alterado, doble toque, pedido cancelado, ventana expirada, timeout desconocido y estados repetidos. API key solo en servidor; apagado por configuración.
7. **W6 — perfiles y restantes mensajes.** Reutilizar `abrirPerfilesMadre`, sus marcas de revisión e historial; incluir PNG existente de `cv_url` o adjunto revisado para el CV externo. Congelar la versión aprobada para que una regeneración no cambie lo enviado. Sumar todavía buscando/no conseguimos, medios y plantillas. Tests de conocida/nueva, archivo faltante/viejo, fallo parcial y bloqueo fuera de ventana. Coordinar cualquier ajuste de `js/ninieras.js`, sin rehacer el generador de CV.
8. **W7 — operación y piloto.** Configuración de conexión/salida/IA independiente, panel de salud con pendientes y errores, retención, costos y alertas a admins mediante la infraestructura existente. Prueba completa con número separado; luego alta operativa según 13.F y despliegue gradual. Desactivar salida no borra trabajos ni desconecta el número.

Antes de cada PR de pantalla o SQL, verificar el estado actual del código y el esquema; estos nombres describen los puntos de integración encontrados, no firmas nuevas ya implementadas. La lectura adicional de `main` cubrió `js/pedidos.js` (`4f114ece`), `js/ninieras.js` (`b77a5e80`), esquema (`7f509f1d`), `enviar-avisos/index.ts` (`0abe9ef4`) y plan de fase 1 (`5a86a050`). No se consultó la base real.

### Entrega y reversión de cada etapa

Cada PR indica alcance, dependencias, pruebas y qué verá una admin. El CI documental no acredita que una integración externa funcione. Para activar una etapa hacen falta evidencia de su prueba, secretos presentes sin exponerlos y configuración efectiva del entorno.

Usar interruptores independientes para conexión aceptada, recepción visible, procesamiento IA y salida. Los interruptores de salida y lista de destinatarios se aplican en servidor. Si falla una etapa, apagar solo esa capacidad, preservar mensajes y mantener pegado/manual; no cambiar `solo_practica` de niñeras ni borrar datos como reversión. Registrar último estado conocido antes de reintentar un envío incierto.

Orden de dependencia: cuentas y lectura de Meta pueden prepararse ahora; W1–W3 y el ensayo avanzan con pruebas aisladas; W4 espera coordinación del flujo de pedidos; W5–W6 se prueban sin madres reales; el alta del número habitual espera el piloto de niñeras. Esto permite avanzar en paralelo sin adelantar el cambio operativo.
