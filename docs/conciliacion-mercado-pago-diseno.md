# Conciliación automática con Mercado Pago: diseño

Fecha: 1 de noviembre de 2026. Estado: investigación, pendiente de validar con un reporte real.
Este documento propone traer movimientos y conciliarlos; no habilita transferencias, cobros,
credenciales, tareas programadas ni cambios en producción. No incluye datos reales.

## 1. Conclusión y condición para construir

La API de reportes permite automatizar la descarga. Lo que todavía no está probado es que los
reportes de la cuenta uruguaya incluyan todas las transferencias bancarias habituales y una
identidad de contraparte suficiente para asignarlas a una familia o niñera.

Recomendación: comparar **Liberaciones (`release_report`)**, **Todas las transacciones / Dinero en
cuenta (`settlement_report`)** y los nuevos **reportes de actividades** sobre la misma semana.
Elegir una fuente principal para contabilizar los movimientos; usar las demás como complemento
de identidad y control, nunca sumar el mismo dinero dos veces.

La primera implementación debería descargar y proponer automáticamente, con confirmación de las
admins. El pendiente de `CLAUDE.md` aspira a marcar automáticamente los casos seguros: se puede
llegar a eso después del piloto, con aprobación explícita de las dueñas y reglas medibles. Los
casos dudosos siempre requieren resolución humana. Leer reportes tampoco ejecuta pagos a niñeras.

## 2. Punto de partida del sistema

Revisión de `js/finanzas.js` y del pendiente «Mercado Pago automático» de `CLAUDE.md`:

- `LECTORES_EXTRACTO` separa el formato bancario del conciliador. Hoy sólo tiene Itaú y produce
  movimientos `{fecha, concepto, cuenta, credito, debito}`. Un lector MP manual puede conservar
  ese contrato, pero el almacenamiento automático necesita además IDs estables, moneda, tipo,
  estado, fechas e importes brutos/netos.
- `mapaPorCuenta` reconoce cuentas guardadas en fichas y permite que una ficha tenga varias.
  La comparación actual extrae dígitos de texto libre y elimina ceros iniciales: no debe heredarse
  como identificador bancario universal. Una cuenta debe distinguir institución, país y tipo.
- `proponerCoincidencias` preselecciona cuando una única ficha y un único período coinciden en
  monto, o cuando coincide la suma de todos sus períodos pendientes. Monto ambiguo, cuenta
  compartida o desconocida y diferencia de importe quedan dudosos, sin tildar. La tolerancia
  actual es menor a un peso; para el nuevo registro monetario se propone igualdad en centésimos.
- Los créditos se agrupan por familia y período; los débitos identificados como niñeras, por día.
  Los débitos desconocidos se descartan de esa pantalla actual. El importador automático debe
  conservarlos y permitir clasificarlos como gasto, retiro propio u otro movimiento.
- `combinacionExacta` existe en el flujo «¿Cuánto pagó?»: busca subconjuntos de unidades, aplica
  `totalParcial`, prioriza las más viejas y abandona si supera 200.000 sumas alcanzables. **El
  conciliador de extractos todavía no la usa**; actualmente prueba períodos individuales o la
  suma de todos, no cualquier subconjunto.
- `totalParcial` y `registrarAplicacionAjustes` gestionan saldo a favor en Por cobrar / Por pagar.
  El pendiente B10 de `CLAUDE.md` advierte que la conciliación de extractos no descuenta/aplica bien
  ese saldo y podría reutilizarlo. Es un requisito previo a cualquier conciliación automática.
- La confirmación actual marca booleanos `cobrado` / `pagado` y luego gastos relacionados. Para
  soportar parciales, duplicados y reversos hace falta un registro de aplicaciones de dinero,
  conservando compatibilidad con esas marcas durante la transición.

## 3. Qué reportes evaluar y qué datos prometen

### Todas las transacciones / Dinero en cuenta: `settlement_report`

El glosario documenta `SOURCE_ID`, `EXTERNAL_REFERENCE`, `TRANSACTION_TYPE`, fechas de creación y
aprobación, moneda, `TRANSACTION_AMOUNT` bruto, `SETTLEMENT_NET_AMOUNT` neto, `FEE_AMOUNT` y datos de
liberación. Distingue pagos, devoluciones, contracargos, reclamos y retiros. La referencia externa
puede estar vacía en envíos de dinero.

Atención: `PAY_BANK_TRANSFER_ID`, pese al rótulo de número de cuenta, está definido como ID único
de una **transferencia**; no prueba ser una cuenta bancaria reutilizable. `POI_BANK_NAME` describe
el banco de origen de pagos QR, no garantiza datos del ordenante de una transferencia común.
`USER_ID` identifica al vendedor, no a la madre.

Fuente: [MP Uruguay: campos de Todas las transacciones](https://www.mercadopago.com.uy/developers/es/docs/reports/account-money/report-fields).

### Liberaciones: `release_report`

Es candidato para controlar el saldo disponible: fecha de impacto (`DATE`), `SOURCE_ID`, tipo de
registro, descripción, `NET_CREDIT_AMOUNT`, `NET_DEBIT_AMOUNT`, bruto, comisiones e impuestos.
Incluye filas de saldo y total que no deben importarse como cobros/pagos. Un mismo ID puede tener
varios eventos financieros; no deduplicar todas sus filas sólo por `SOURCE_ID`.

El glosario no garantiza nombre ni cuenta bancaria del ordenante. Que una fila diga `payment`,
`payout` o `withdrawal` tampoco demuestra que sea un cobro familiar o un pago a una niñera.

Fuente: [MP Uruguay: campos de Liberaciones](https://www.mercadopago.com.uy/developers/es/docs/reports/released-money/report-fields).

Una transferencia fallida puede devolver dinero mediante una nueva línea de crédito: el diseño
debe relacionar ambos eventos. [MP: usos de Liberaciones](https://www.mercadopago.com.uy/developers/en/docs/reports/released-money/how%20to%20use).

### Otras operaciones: reportes de actividades

MP documenta `activities_collection` para cobros, `activities_after_collection` para devoluciones,
contracargos y ajustes, y `activities_withdraw` para retiros/transferencias de salida. Son una
alternativa para obtener detalles adicionales. Su disponibilidad efectiva y cobertura de
transferencias desde/hacia bancos en esta cuenta MLU se validan antes de elegirlos.
[MP Uruguay: introducción a actividades](https://www.mercadopago.com.uy/developers/es/docs/salesforce-commerce-cloud/additional-content/reports/activities-reports/introduction).

Campos especialmente útiles: `operation_id`, `operation_type`, `status`, fechas, bruto, neto,
comisión y `counterpart_name`. Para retiros, `bank_account` representa datos de cuenta de
**destino**. Para cobros, nombre, correo y documento pueden excluirse por protección de datos,
y el correo puede llegar parcialmente oculto. **No hay garantía de nombre o cuenta de origen para
cada transferencia desde otro banco.**
[MP Uruguay: campos de actividades](https://www.mercadopago.com.uy/developers/es/docs/subscriptions/additional-content/reports/activities-reports/report-fields).

La documentación anterior está publicada bajo secciones de productos, pero describe reportes de
cuenta. No se necesita integrar suscripciones, QR o checkout para este diseño. Se usaron estas
páginas porque los enlaces equivalentes de la sección general de actividades no devolvieron
contenido en esta revisión.

### Qué no usar como sustituto

Payments Search no debe asumirse como un extracto universal de la billetera. Puede complementar
operaciones que efectivamente sean pagos consultables, pero no se ha verificado que cubra toda
transferencia bancaria o salida. No basar el proyecto en un webhook de pagos para movimientos de
cuenta que podrían no producir ese evento. El reporte antiguo «Dinero retirado» está deprecado;
MP indica usar Liberaciones.
[MP: aviso de deprecación](https://www.mercadopago.com.uy/developers/es/docs/woocommerce/additional-content/reports/available-money/generate).

## 4. Autenticación, generación y costos

### Acceso a la cuenta del negocio

Para una sola cuenta propia: aplicación en Tus integraciones, credenciales de producción de esa
cuenta y `Authorization: Bearer` en llamadas desde el servidor. Access Token sólo en Secrets de
Supabase; nunca en GitHub Pages, archivos del repo ni logs. Su renovación invalida la credencial
anterior y debe coordinarse con las integraciones que ya la usan.
[MP Uruguay: credenciales](https://www.mercadopago.com.uy/developers/es/docs/checkout-api-payments/additional-content/your-integrations/credentials).

Si la aplicación está a nombre de un tercero y accede a la cuenta del negocio, usar OAuth
Authorization Code, con consentimiento de la titular, `state`, PKCE y renovación del token en
backend. No elegir Client Credentials de una cuenta ajena esperando ver la cuenta del negocio.
Para este proyecto se recomienda que cuenta y aplicación pertenezcan al negocio.
[MP: OAuth](https://www.mercadopago.com.uy/developers/es/docs/security/oauth/introduction),
[obtención y vigencia de tokens](https://www.mercadopago.com.uy/developers/es/docs/security/oauth/creation?scope=prod).

### Reportes de cuenta

Para cada familia de reportes `settlement_report` / `release_report`, MP ofrece configuración,
generación, consulta/listado y descarga bajo `/v1/account/`. Configurar `frequency` no activa el
cron de MP: se debe habilitar `schedule`. La configuración puede ser compartida con otros usos de
la cuenta; leerla y respaldarla antes de modificarla. No sobrescribir columnas o notificaciones
que las dueñas ya usan.

Fuentes: [API settlement](https://www.mercadopago.com.uy/developers/es/docs/checkout-pro-preferences/additional-content/reports/account-money/api),
[API release](https://www.mercadopago.com.uy/developers/es/docs/checkout-api-payments/additional-content/reports/released-money/api),
[referencia de reportes](https://www.mercadopago.com.uy/developers/es/reference/reports/overview).

En actividades, `/v1/reporting/operations/{reportId}` permite configurar, generar `statements`,
consultar estado y descargar por `uid`; la generación es asíncrona. Los estados documentados son
`pending`, `available`, `failed` y `empty`. Puede programarse diaria, semanal o mensualmente.
[MP: API de actividades](https://www.mercadopago.com.uy/developers/es/docs/vtex/additional-content/reports/activities-reports/api).

### Costos y frecuencia recomendada

Las páginas oficiales de reportes consultadas no publican una tarifa por solicitud, archivo ni
abono de la API. **No se verificó un precio contractual de USD 0**: confirmar en la cuenta o con MP
que estos reportes estén incluidos antes de presupuestar. Las comisiones de cobros, transferencias,
impuestos y retiros son un asunto distinto, y deben leerse del reporte/condiciones de la cuenta;
no inferir que todo es gratuito ni descontar comisiones a la deuda de la familia.

Propuesta inicial: generación diaria del día anterior cerrado en Montevideo y descarga mediante
una Edge Function. `pg_cron` revisa trabajos pendientes cada 15 minutos, sólo llama si hay trabajo
y usa espera creciente ante límites/errores. No pedir un nuevo archivo cada minuto. Mostrar última
sincronización exitosa y cobertura de fechas; «sin movimientos» no equivale a «falló la descarga».

Con 30 días, el orden de magnitud es 30 reportes al mes por tipo, más consultas/descargas. El costo
propio será ejecución, almacenamiento y transferencia de Supabase según el plan: medir tamaño y
duración con la semana real, sin comprometer una cifra antes. Si luego hace falta intradía,
evaluar dos a cuatro ventanas al día tras confirmar límites con MP.

Los reportes de actividades permiten configurar zona horaria y fechas ISO con offset. Para todos
los formatos, conservar el timestamp original y normalizar instantes a UTC, mostrando fechas de
negocio en `America/Montevideo`. Probar límites de intervalo para evitar huecos o doble conteo en
medianoche. [MP: características de actividades](https://www.mercadopago.com.uy/developers/es/docs/qr-code/resources/reports/activities-reports/generate?scope=prod).

## 5. Flujo y tablas propuestas

Los nombres siguientes son propuestas, sin SQL ni migraciones. La bandeja y los reportes sólo
serían visibles a admins autorizadas. Los archivos originales estarían en Storage privado; el
worker escribe con credenciales de servidor y las confirmaciones validan a la admin.

1. `mp_reportes`: cuenta interna, tipo, intervalo, ID/tarea/archivo del proveedor, estado,
   próximo intento, intentos, checksum, ruta privada y versión de configuración/parser. Se registra
   desde la solicitud hasta la validación; no avanzar el punto de sincronización si queda un hueco.
2. `mp_filas_reporte`: reporte, ordinal, datos originales protegidos, clave de evento propuesta,
   estado de interpretación y error. Conserva trazabilidad y permite reprocesar sin fabricar otro
   ingreso de dinero.
3. `movimientos_financieros`: cuenta/proveedor, ID de operación y de evento cuando exista,
   tipo/dirección/estado, moneda, bruto/neto/comisión/impuestos, fechas de creación/impacto,
   contraparte observada, referencia y movimiento de reversión. Estados de conciliación:
   `nuevo`, `propuesto`, `parcial`, `conciliado`, `sin_identificar`, `excluido`, `revisar_reverso`.
4. `movimiento_fuentes`: vínculo entre movimiento normalizado y filas/reportes que lo prueban.
   Evita contabilizar dos veces el mismo hecho al importarlo de release, settlement y actividades.
5. `contrapartes_financieras`: identificador estable de MP o banco+cuenta verificados, familia o
   niñera asociada, origen y confirmación por admin. Un nombre semejante sólo propone, nunca crea
   un vínculo permanente. Una cuenta compartida entre fichas queda explícitamente ambigua.
6. `conciliaciones`: propuesta/confirmación/reversión, versión de reglas, evidencia, admin o regla
   automática autorizada y momento. Registra también exclusiones justificadas y no borra auditoría.
7. `aplicaciones_movimiento`: movimiento + conciliación + sitting de `sittings_traslados`, lado
   `cobro_familia` / `pago_ninera` e importe aplicado. Relación muchos a muchos: una transferencia
   puede cubrir varios sittings; un sitting puede recibir varias transferencias.
8. Aplicaciones separadas y tipadas para `gastos_extra` y `ajustes_saldo`, relacionadas con la
   misma conciliación. Nunca sumar un gasto dos veces al incluirlo en el sitting y de nuevo aparte.
   Los ajustes originados por excedente deben conservar vínculo con el movimiento que los financió.

El contrato simple de `LECTORES_EXTRACTO` puede mantenerse como vista de compatibilidad para
propuestas existentes. El original conserva toda la información: no truncar un ID a número ni
reducir una fila financiera a fecha/monto/concepto como única identidad.

### Importación y deduplicación

Solicitar un reporte, guardar su tarea, esperar disponibilidad y descargarlo son pasos separados
con reintentos recuperables. Validar encabezados, moneda, estado, cantidad de filas y totales
antes de promover datos. Los CSV se leen como datos, sin ejecutar fórmulas ni contenido adjunto.

Duplicar una descarga no debe duplicar movimientos. La clave financiera final se decide con el
reporte real: cuenta + ID de evento estable, o una combinación de operación/tipo/fecha/identificador
adicional. Hash del archivo y ordinal sólo deduplican una misma descarga; un hash basado sólo en
fecha, nombre y monto puede colapsar dos transferencias reales iguales. Si el proveedor no permite
distinguirlas, se bloquea la aplicación automática.

Para llegadas tardías, generar una revisión semanal del período reciente —propuesta: siete días—
y control mensual. No anexar sin más un reporte solapado: comparar versiones, asociar fuentes y
registrar eventos nuevos/reversos. Los resúmenes de apertura/cierre sirven para control de saldo,
no son transacciones. Investigar cualquier diferencia con el panel antes de conciliar.

## 6. Reglas para asignar el dinero

### Cobros de familias

Primero identificar contraparte; después buscar deuda. Nunca recorrer todas las familias buscando
un monto igual y llamarlo seguro. Un comprobante recibido por WhatsApp sólo aporta evidencia para
investigar: no sustituye el movimiento acreditado en la cuenta.

Con identidad única confirmada y moneda coincidente, formar unidades de deuda exigible usando las
reglas de Por cobrar (tarifa, redondeo, gastos y saldo disponible). Probar total de período y
subconjuntos mediante la lógica de `combinacionExacta`, mostrando cada sitting. La prioridad de
antigüedad resuelve la selección de interfaz, pero si existen varias combinaciones válidas se
propone una y se indica la ambigüedad; no se aplica automáticamente sólo porque el algoritmo pudo
elegir la más vieja. Fechas y frecuencia ayudan a proponer, no demuestran qué quiso pagar la familia.

- Pago menor: aplicar un parcial confirmado, dejar visible el remanente y conservar el sitting
  como no cobrado completo. No marcar su booleano en `true`.
- Pago de varias deudas: repartir importe entre los sittings elegidos y mostrar el detalle.
- Varias transferencias para una deuda: conservar movimientos separados y sumar aplicaciones,
  sin perder la identidad original al agrupar en pantalla.
- Pago mayor: cubrir lo confirmado y proponer el excedente como saldo a favor; no crearlo de modo
  silencioso ni confundirlo con ingresos por un servicio inexistente.
- Dos movimientos reales iguales: ambos se importan. Si uno ya cubrió la deuda, el otro queda
  «posible pago duplicado/excedente» para revisar, sin volver a marcar ni generar crédito duplicado.
- Cuenta conocida sin deuda: dejar anticipo/saldo sin aplicar hasta confirmar su destino.

Ejemplo inventado: deuda de 1.000 y 500; transferencia de 1.500 permite proponer ambos sittings.
Si había saldo a favor de 200 y entran 1.300, aplicar 200 de saldo y 1.300 de dinero cancela 1.500.
No registrar un ingreso de 1.500 ni volver a consumir esos 200 en otra conciliación.

### Pagos a niñeras

Identificar la beneficiaria mediante contraparte/cuenta de destino verificadas y estado final;
comparar contra Por pagar con su calendario de liquidación, precios, reintegros y ajustes. Un
retiro a una cuenta del propio negocio o un débito desconocido no es pago a niñera. Conservarlo en
la bandeja para clasificar, sin borrarlo por no encontrar ficha.

El sistema detecta pagos ya realizados fuera del panel. Ejecutar una transferencia por API es
otra tarea y queda fuera de esta propuesta. Ningún movimiento ni aviso financiero se expone en la
app de niñeras.

### Bruto, neto, saldo y reversos

Si una familia pagó 1.000 y MP retuvo 20 de comisión, el efectivo recibido es 980 y la comisión 20;
no queda automáticamente una deuda familiar de 20. Registrar las dos magnitudes y clasificar la
comisión como costo del negocio según la política aprobada. Para transferencias sin comisión,
bruto y neto pueden coincidir: verificar, no suponer.

El dinero importado mantiene centésimos exactos. Las reglas actuales de redondeo de cobro/pago
siguen fijando la deuda del servicio; no redondear de nuevo el reporte ni mezclar UYU con USD.

Una cancelación, devolución o contracargo es un nuevo evento relacionado: proponer revertir las
aplicaciones afectadas y revisar deuda/saldo utilizado. No borrar el movimiento original ni
desmarcar silenciosamente un período entero que contiene otros cobros legítimos.

### Confirmación consistente y futura automatización

La confirmación debe ser una única transacción en servidor: bloquear movimiento, deuda y ajustes;
recalcular saldos pendientes; registrar aplicaciones y saldo utilizado; actualizar marcas
compatibles; guardar auditoría. Dos admins o una importación repetida no pueden gastar dos veces
el mismo dinero ni el mismo saldo. Deshacer crea la operación inversa y libera sólo lo que esa
conciliación aplicó. Deudas antiguas ya marcadas manualmente necesitan una fecha de corte y una
base inicial identificada para que un histórico MP no se aplique de nuevo.

Para habilitar luego el marcado automático: identidad estable y única, evento final no aplicado,
moneda correcta, una única asignación exacta, sin reverso ni saldo/importe ambiguo, reglas
versionadas y trazabilidad. Primero comparar propuestas durante un cierre semanal y uno mensual.
La decisión de activarlo y su alcance queda en manos de las dueñas; un fallo de sincronización
deja el caso pendiente y visible.

## 7. Verificación obligatoria con un reporte real

Antes de escribir el lector o las migraciones, una titular exporta una semana representativa desde
la cuenta del negocio: mismas fechas y todas las columnas de los reportes que estén disponibles.
Se revisa sólo localmente en una carpeta privada fuera del repo; este documento, el PR, los tests
y los logs no incorporan nombres, cuentas, teléfonos, documentos ni importes reales.

1. Comparar contra la actividad del panel cada transferencia desde otro banco y cada envío a
   niñera ya ocurrido. Contar filas, IDs e importes; comprobar transferencias MP a MP también.
2. Ver qué llega realmente para el ordenante y beneficiario: nombre completo/parcial, ID MP,
   banco, cuenta de origen/destino, documento y referencias. Anotar campos vacíos u ocultos por
   cada canal. Confirmar si `bank_account` corresponde al destino y si algún campo identifica de
   forma estable al pagador. No tratar IDs de transferencia como cuentas.
3. Contrastar `SOURCE_ID` y `operation_id` entre formatos; buscar operaciones con varias filas,
   importes iguales legítimos, retiro propio y reversión. Demostrar deduplicación sin perder filas.
4. Verificar comisiones, impuestos, signo crédito/débito, bruto/neto, moneda y si el formato cambia
   entre cobro, transferencia, retiro y devolución. Usar un caso histórico si esa semana no lo tiene;
   no generar movimientos de prueba reales por este documento.
5. Revisar timestamps cerca de medianoche, inclusividad de límites, estados y demora entre
   movimiento en panel, disponibilidad y reporte. Reconstruir el saldo con las filas que impactan
   dinero, sin contar apertura/subtotales como ingresos.
6. Confirmar con la cuenta autorizada qué APIs permiten configurar/generar/listar/descargar,
   costo aplicable, límites de frecuencia y plazo de retención/descarga. Un ejemplo de la
   documentación o un reporte vacío de sandbox no prueba cobertura real.
7. Comparar contra un cierre conocido de Finanzas: selección de varios sittings, parcial, exceso,
   saldo a favor, reintegros y pago a niñera. Documentar las diferencias y el plan para B10 antes
   de permitir cualquier marcado automático.

**Criterio para avanzar:** todas las entradas y salidas relevantes aparecen, sus estados e IDs
son interpretables y los totales cuadran. Si falta identidad de origen, la descarga puede ser
automática, pero el vínculo a familia seguirá siendo humano. Si faltan movimientos enteros, se
evalúa un extracto manual complementario o se consulta a MP; no se promete conciliación completa.

## 8. Secuencia propuesta

1. Validar la semana real y elegir fuente principal/complementos; confirmar acceso y costo.
2. Aprobar política de aplicación manual/automática, fecha de corte y tratamiento de excedentes,
   comisiones y reversos.
3. Futuro PR de importación y almacenamiento: sólo lectura de MP, con bandeja de cobertura y
   movimientos; ninguna marca de cobrado/pagado todavía.
4. Futuro PR de aplicaciones atómicas y corrección del saldo a favor B10, con pruebas de
   concurrencia, parciales, doble importación y deshacer. Adaptar Por cobrar / Por pagar para no
   mantener dos saldos que se contradigan.
5. Piloto con confirmación de admins y contraste con cierres. Activar automatismo seguro sólo
   después de aceptar los resultados. Mantener descarga manual como recuperación.

Esta investigación sólo entrega documentación. Los archivos ejecutables, Finanzas, pedidos,
Agenda, app de niñeras y migraciones quedan para tareas posteriores expresamente autorizadas.
