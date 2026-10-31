# Precio por hora de cada niñera con cada familia (propuesta, 31/10/2026)

Estado: propuesta para que Diego la revise. La migración está escrita y probada en local; no se aplicó
ni se construyó la parte del panel.

## Para qué
Regla 2 de `docs/fase1/reglas-del-negocio.md`: lo que cobra la niñera cambia según la cantidad de
chicos, la antigüedad de la familia y si es fuera de Montevideo, y se guarda por niñera + familia.
Hoy hay una sola tarifa por familia (`familias.pago_hora`, igual para todas las niñeras) y la única
forma de guardar otro precio es crear un fijo, que pide días y hora. Las dueñas necesitan guardar
"esta niñera con esta familia cobra X por hora" sin días fijos, y que el sistema lo use solo.

## Qué cambia en la base (`supabase/migraciones/20261031_precios_ninera_familia.sql`)
- Tabla `precios_ninera_familia`: una fila por par familia + niñera con el pago por hora, una nota
  opcional ("3 chicos"), quién la cargó y cuándo se cambió por última vez. El par no se repite. El
  pago tiene que ser mayor que 0. Se borra sola si se borra la familia o la niñera.
- Sin cobro por niñera: la familia paga siempre su tarifa (`familias.cobro_hora`), no cambia según
  la niñera (regla 2). Si algún día hace falta, se suma una columna.
- Solo la ven y la escriben las admins. La niñera nunca la lee: en la etapa 5 su precio por hora le
  llega dentro del pedido, por una función que filtra por ella.
- Cada alta, cambio o baja queda en `finanzas_historial`, como los gastos y los saldos a favor (es
  plata), con quién lo hizo.
- Función `pago_hora_ninera(familia, niñera)`: el precio de esa niñera con esa familia o, si no hay,
  la tarifa de la familia. La usa la etapa 5 en la base; en el panel va la misma regla en JS.
- Está en Realtime, así dos admins ven el mismo precio.
- Es la tabla que la etapa 5 (pedidos por la app) ya tenía prevista con este nombre
  (`decisiones.md` 4.18): la reutiliza tal cual.
- Compatible con la app publicada: todo nuevo, no toca filas. Tiene su DESHACER (guarda una copia
  de los precios y de su historial antes de borrar). Prueba SQL: `supabase/pruebas/precios_ninera_familia.sql`.

En producción hoy ningún fijo tiene un pago por hora propio (los 8 cobran con la tarifa de la
familia), así que no hay nada para pasar a la tabla nueva: arranca vacía.

## Qué cambia en el panel (a construir después del OK)
1. **Ficha de la familia, sección "Precio por niñera"** (debajo de la tarifa):
   - Lista: niñera, $/h, nota y "cambiado el dd/mm". Con la tarifa de la familia como referencia:
     "Las demás niñeras: $X/h (tarifa de la familia)".
   - "+ Agregar": niñera (buscador `attachAutocomplete`, sin tildes), pago por hora y nota. El pago
     viene precargado con lo que cobró esa niñera en su último sitting con esa familia (pago / horas,
     sin centavos) o, si no hubo, con la tarifa de la familia.
   - Editar y borrar (con confirmación "Borrar el precio"). Guardar con la condición de la última
     fecha de cambio, como lo que dos admins pueden tocar a la vez.
2. **Ficha de la niñera**: la misma lista al revés ("Precio por familia"), solo para mirar.
3. **De dónde sale el pago al registrar** (una sola función, `precioHoraNinera(familia, nineraId,
   precios)` en `core.js`, la misma regla que `pago_hora_ninera`):
   - Sittings, registro puntual: con niñera elegida, el pago por hora es el suyo con esa familia o la
     tarifa de la familia. Cambiar la niñera recalcula, igual que cambiar la hora (lo puesto a mano no
     se pisa: se ofrece "Usar estos montos", como hoy).
   - Agenda, "+ Nueva solicitud" con niñera y "Asignar niñera": "Precio por hora a la niñera" viene
     precargado con el suyo.
   - Si la admin tipea otro pago por hora para una niñera que no tiene precio con esa familia, aparece
     "Guardar como precio de [niñera] con esta familia" (ver la pregunta 3).
   - Las fórmulas, los redondeos y las variantes de precio no cambian: las variantes se aplican
     después, sobre esta base, como hoy.
4. **Red de plata**: `precioHoraNinera` se suma al oráculo (`scripts/congelar-oraculo-plata.js`) con
   casos nuevos en `tests/red-plata.spec.js` (con fila, sin fila, sin niñera, familia sin tarifa); el
   resto de la red tiene que dar igual.
5. **Tests**: un spec nuevo con la sección de la ficha (agregar, editar, borrar, par repetido, base
   que falla, doble toque, otra admin lo cambió, base sin la migración, 390 px) y el registro tomando
   el precio de la niñera.

## Cómo lo reutiliza la etapa 5
Al mandar un pedido, cada niñera tildada sale con su precio de esta tabla; si no tiene, la pantalla
pide "Primera vez de [niñera] con esta familia: ¿cuánto cobra por hora?" y al enviar se guarda acá
(`decisiones.md` 6.3, paso 4). La función `enviar_pedido_app` hace ese upsert y `pago_hora_ninera`
da el precio. No hace falta otra migración para la tabla.

## Preguntas para Diego
1. **Fijos**: hoy los días de un fijo pagan con la tarifa de la familia (ningún fijo tiene precio
   propio). Si esa niñera tiene precio con esa familia, ¿los días del fijo lo usan?
   Recomiendo **sí**: el fijo usa su precio propio si algún día lo tiene, si no el de la niñera con
   esa familia, si no la tarifa. Cambia también la carga automática de los fijos en la base
   (`generar_previstos_fijos`) y su prueba de paridad; va en el mismo PR del panel. Si preferís que no,
   los fijos quedan exactamente como hoy.
2. **Reemplazo de un día de fijo con otra niñera**: ¿ese día se le paga a la reemplazante su precio
   con esa familia? Recomiendo **sí** (es otra niñera, con su precio).
3. **Guardar al registrar**: si la admin pone a mano otro pago por hora para una niñera sin precio
   con esa familia, ¿la casilla "Guardar como precio de [niñera] con esta familia" viene tildada?
   Recomiendo **sí, tildada** (ahorra el paso de ir a la ficha; se puede destildar si fue algo de un
   día).
4. **Ficha de la niñera**: ¿suma la lista "Precio por familia", solo para mirar? Recomiendo **sí**.

## Respuestas de Diego (31/10/2026) y plan de construcción
1. Fijos: sí. Orden del pago por hora de un día de fijo: el precio del fijo (`asignaciones.pago_hora`
   si está cargado), si no el de la niñera con esa familia, si no la tarifa de la familia. El
   comentario de la tabla se corrige.
2. Reemplazo de un día de fijo: la reemplazante cobra su propio precio con esa familia (sin el
   precio del fijo, que es de la titular).
3. Casilla "Guardar como precio de [niñera] con esta familia": tildada solo si esa niñera no tiene
   precio con esa familia; si ya tiene y se tipea otro, destildada (un precio especial de un día no
   pisa el guardado).
4. Ficha de la niñera: lista "Precio por familia", solo para mirar.

La regla, una sola en las dos puntas:
- JS (`core.js`, puro): `precioHoraNinera(familia, nineraId, precios, pagoFijo)` → `pagoFijo` si es
  mayor que 0; si no, `pago_hora` de la fila de `precios` con esa `familia_id` y ese `nineraId`; si
  no, `familia.pago_hora`; si no, null. `precioSegunHorario` no cambia: se le pasa la familia con
  `pago_hora` reemplazado por eso.
- SQL: `generar_previstos_fijos` usa `coalesce(nullif(asignacion.pago_hora, 0), pago de la fila de
  precios_ninera_familia, familia.pago_hora)`. Migración aparte `20261101_previstos_precio_ninera.sql`
  (con DESHACER que vuelve a la función de antes): **Diego la revisa antes de aplicarla**.

Tareas:
- A. La regla: `precioHoraNinera` + oráculo congelado de nuevo + casos en `tests/red-plata.spec.js`;
  migración de `generar_previstos_fijos` + su DESHACER + `schema.sql`; casos en
  `supabase/pruebas/fijos_automaticos.sql` y la paridad (`scripts/paridad-plata-sql.js` con fijos con
  precio propio y con precio de niñera, `paridad_plata.sql` regenerada).
- B. Dónde se usa: Sittings (registro puntual; cambiar la niñera recalcula; la casilla de la regla 3),
  Agenda ("+ Nueva solicitud" con niñera, "Asignar niñera", registrar el día de un fijo, reemplazo de
  un día, alinear el registro de hoy) y "Cierre de los fijos" en Hoy. Los precios se leen con una
  consulta por pantalla (por familia o con `.in`), nunca una por fila. Base sin la tabla: todo como
  hoy.
- C. Fichas: sección "Precio por niñera" en la ficha de la familia (agregar, editar, borrar, con la
  condición de `actualizado_en`) y lista "Precio por familia" en la de la niñera.
- D. CLAUDE.md, revisión final de toda la rama, CI verde y aviso a Diego antes de mergear.
