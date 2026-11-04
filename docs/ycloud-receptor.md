# W1: receptor de YCloud, preparado sin activar

## Alcance

Recibe `whatsapp.inbound_message.received` y `whatsapp.message.updated`, verifica la firma
de YCloud y deja el evento y su trabajo en Postgres. No crea pedidos, no llama a Haiku ni
al transcriptor y no envía WhatsApp ni push. No modifica pedidos, Agenda o `/ninera/`.

Una admin todavía no ve cambios en pantalla: es la primera parte de la integración. Después
se construyen transcripción, interpretación, revisión y envío aprobado. La cola queda pendiente;
no hay procesador ni cron activados en este PR. No conectar el número operativo con este PR solo.

## Garantías y límites

- Firma HMAC-SHA256 sobre el timestamp y los bytes exactos del cuerpo. Cuerpo máximo: 1 MiB,
  también sin Content-Length. Solo POST; no usa el handshake de Meta.
- Apagado por defecto. Sin secreto y lista de WABA permitidas no guarda nada. No necesita la
  API key de YCloud para recibir: esa clave se incorporará para descargas y envíos posteriores.
- Acepta una firma de hasta 8 horas atrás y un adelanto de hasta 5 minutos. Es una tolerancia
  local deliberada: los reintentos publicados duran varias horas y no se presupone que cada
  intento renueve la firma. Confirmar con la cuenta de prueba antes de activar. La deduplicación
  de Postgres impide reprocesar eventos dentro de esa tolerancia.
- La RPC inserta evento y trabajo en una transacción. Solo un trabajo por WABA + ID de mensaje
  de YCloud y, cuando está presente, también por WABA + wamid. Cambios de estado conservan
  el evento pero no crean trabajo de interpretación.
- Las dos tablas y la RPC son solo de servicio: ni una niñera ni una sesión admin acceden a
  los cuerpos crudos por la API de datos. La RPC es SECURITY INVOKER.
- Los estados sin `wabaId`, admitidos por los ejemplos oficiales, quedan sin asociación. No
  se inventa la cuenta: una etapa de salida deberá correlacionarlos con mensajes propios
  antes de cambiar cualquier estado de negocio.
- Solo responde éxito después del guardado. Un fallo o timeout devuelve 503; repetir el evento
  es seguro incluso si el primer guardado sí terminó. No imprime excepciones ni contenido.
- Otros eventos firmados se ignoran explícitamente, incluidos ecos/historial. No suscribirlos
  todavía: su conservación como contexto se incorpora en otra etapa. Revisar eventos admitidos
  antes de ampliar suscripciones.
- No es una garantía de recuperación infinita: después de los reintentos de YCloud un evento
  puede quedar sin entregar. Falta monitoreo y recuperación operativa para el piloto real.

## Revisión y activación futura, en este orden

1. Revisar el PR y la migración `20261104194824_ycloud_recepcion.sql`, con pruebas locales.
   `schema.sql` contiene la misma estructura para bases nuevas. El DESHACER se niega a borrar
   tablas con datos. Ninguna migración fue aplicada por este PR.
2. Con autorización explícita de Diego, aplicar primero la migración y publicar únicamente
   `ycloud-webhook`. `supabase/config.toml` desactiva JWT solo para este receptor: la firma sigue
   siendo obligatoria. No desplegar todas las Edge Functions ni cambiar el webhook existente.
3. Dejar `YCLOUD_RECEPCION_ACTIVA` sin definir o en `false` mientras se prepara la conexión.
4. En YCloud → Developers → Webhooks → Add Endpoints, poner la URL HTTPS real de la función
   recién publicada. Suscribir solo los dos tipos del alcance. No usar la web pública ni la
   página de GitHub Pages como receptor.
5. Guardar el secreto del endpoint directamente en Supabase como `YCLOUD_WEBHOOK_SECRET`, y
   los IDs de WABA de prueba separados por coma en `YCLOUD_WABA_IDS`. No son el número de
   teléfono. No pegarlos en el chat ni el repo. No usar `WHATSAPP_APP_SECRET` para YCloud.
6. Con la firma configurada y las WABA de prueba revisadas, autorizar el cambio de
   `YCLOUD_RECEPCION_ACTIVA=true`. Antes de eso, el receptor responde 503 intencionalmente;
   no crear un endpoint que reciba tráfico real mientras se termina la preparación.
7. Enviar eventos de prueba y confirmar respuesta 200, filas y una sola tarea por mensaje;
   repetir entrega, comprobar firma falsa y simular fallo de guardado en entorno aislado.
   No forzar caídas en producción. Para mensajes reales de WhatsApp sigue haciendo falta
   un número conectado: una simulación no prueba la entrega de Meta/YCloud.
8. Antes de recibir conversaciones reales: completar transcripción, revisión, alertas y limpieza
   de datos con su política acordada. No configurar todavía envíos ni conectar el número
   habitual. Primero se necesita el piloto de niñeras por su app y revisar elegibilidad.

La versión de Supabase CLI debe comprobarse antes de publicar: el changelog de noviembre cambia
el comportamiento de comandos remotos en v3. No actualizar ni desplegar implícitamente.

## Pruebas reproducibles, sin red de negocio

La función no importa dependencias externas. Desde el repo, con Deno 2:

```sh
deno check --no-config --no-lock supabase/functions/ycloud-webhook/index.ts
deno test --no-config --no-lock supabase/functions/ycloud-webhook/recepcion_test.ts
```

SQL con PGlite instalado fuera del repo, como explica `scripts/probar-sql.mjs`:

```sh
PGLITE_DIR=/ruta/herramientas node scripts/probar-sql.mjs supabase/pruebas/ycloud_recepcion.sql
```

Probar también la migración sobre el esquema base del PR y aplicar → deshacer → aplicar,
antes de correr esa prueba. El chequeo del PR automatiza función y SQL sin credenciales de negocio.

## Fuentes

- [Firma, cuerpo, tolerancia y reintentos de YCloud](https://nndocs.ycloud.com/reference/configure-webhooks).
- [Eventos de YCloud](https://nndocs.ycloud.com/reference/webhook-events-payloads).
- [Ejemplos de estados, incluidos mensajes sin WABA](https://nndocs.ycloud.com/reference/whatsapp-message-updated-webhook-examples).
- [Supabase: configuración de funciones](https://supabase.com/docs/guides/functions/function-configuration).
