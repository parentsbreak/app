# Rediseño del panel de administración

> **EN PAUSA (21/10/2026, decisión de Paulina y Delfina después de ver las maquetas).** No se hace
> el rediseño completo: ni el PR 0 (base de componentes) ni la barra de pestañas de abajo. Prefieren
> la navegación actual, y la app se sigue viendo parecida a la de hoy. Lo que sirve de este documento
> (pedido desde WhatsApp, tarjetas de Hoy, errores de plata, consultas más livianas, etc.) se mete de
> a una pieza en las pantallas actuales, sin cambiar la navegación. Regla nueva del mismo día: la app
> siempre con fondo blanco, nunca modo oscuro (las maquetas tienen modo oscuro: eso no se hace).

Auditoría y propuesta, 21/10/2026. Sin código todavía. Las decisiones ya están tomadas (sección 6,
21/10/2026) y el orden de trabajo está en la sección 5. No tiene datos reales (el repo es público): los nombres de los ejemplos son los
ficticios de los tests y las cifras son conteos o porcentajes, nunca montos de una familia o niñera.

## Resumen en 10 líneas

1. El sistema registra bien; lo que falla es el orden: lo accionable queda debajo de números decorativos (Hoy) o de un gráfico y una conciliación en pausa (Finanzas, 15 pantallas de alto en el celular).
2. Las "correcciones" del historial son dos cosas distintas: marcar cobrado/pagado (63 marcas, flujo normal, de a una) y corregir precio u horario (unas 25, los errores reales). Cero marcas se deshicieron: el problema no es el toque equivocado sino el precio que se guarda sin verlo.
3. El precio sale mal porque se corrige a mano sin tocar las horas (Finanzas → Editar movimiento), porque cosas que no tenían lugar se metían en el precio (gastos, hasta el 13/10) y porque el día de un fijo se carga con el horario previsto y la realidad fue otra. Nadie usa "Fijos confirmados automáticamente" (0 revisados): hay que preguntar la hora real de fin, no pedir un "Bien".
4. La base responde en menos de 5 ms; cada pedido tarda 200 a 350 ms por la distancia (Canadá). Hoy hace 33 pedidos al entrar, Finanzas 32 y cada "Marcar pagado" unos 65 (se recarga todo dos veces). La cura es menos viajes: caché de sesión, dos funciones de la base (`resumen_hoy`, `finanzas_pendientes`) y no repintar por el Realtime propio.
5. Navegación nueva en celular: barra de 5 pestañas abajo (Hoy, Agenda, Registros, Plata, Más). El menú lateral sigue en la compu. Las claves de módulo y `setModulo()` no cambian: los tests siguen andando.
6. Hoy nuevo: una lista de tarjetas de acción, cada una con un botón que resuelve en un toque (elegir niñera, cerrar el día de ayer, registrar tal cual, ver cobros, pagar). Deja lugar al pedido que llega por WhatsApp, con las niñeras sugeridas en orden.
7. Un sistema de componentes chico (tarjeta, fila, chip, botón de 44 px, hoja, estado vacío/cargando/error, toast con Deshacer) en `core.js` e `index.html`, con clases alias para no romper los 629 selectores por id de los tests.
8. Analytics que deciden, con datos que ya existen: concentración de facturado por familia (3 familias = 60 %), niñeras que trabajan de verdad (20 de 92), pedidos que no se concretan (7 confirmados de 22), días de cobro (hace falta `cobrado_at`/`pagado_at`), familias que dejaron de pedir.
9. Orden decidido: errores de plata (PR aparte) → red de tests de plata → base de componentes → Pedido desde WhatsApp → Hoy → Plata → Registros → Agenda → Familias y Niñeras → el resto. La base espera a que Paulina y Delfina vean las maquetas, y nada se migra sin la red de tests de 4.10 (la versión nueva va detrás de `?nuevo=1` hasta que la aprueben). Riesgo alto en Plata y Registros (plata y muchos tests); bajo en lo demás.
10. Decisiones tomadas el 21/10/2026 en la sección 6: todas las recomendadas, salvo la campanita, que se mantiene en el celular. Maquetas en `local/maquetas/` (hoy, sittings, finanzas), para abrir en el celular.

## 1. Cómo se hizo

- Código: los 14 archivos de `js/`, el CSS de `index.html`, `supabase/schema.sql` y los tests. Cuatro auditorías paralelas por módulo, cada afirmación citada con archivo y línea y verificada después.
- Simulador: un harness aparte (no está en el repo) abre cada módulo con los datos ficticios de los tests, a 390×844 y a 1280×900, anota todos los pedidos a Supabase, mide el alto de la pantalla, los botones menores a 40 px y saca capturas. Los números de "pedidos por módulo" salen de ahí.
- Producción, solo lectura: `sittings_historial` (qué cambian las administradoras), conteos por tabla, los logs de 24 h de PostgREST (qué consultas, cuántas, cuánto tardan), `pg_stat_statements`, `pg_indexes` y los advisors de Supabase.
- Lo que no se midió: tiempos reales en un iPhone (la demora de red se infirió de los logs) y el uso real de cada pantalla (no hay analytics de uso; se propone una mínima más abajo).

## 2. Lo que dicen los datos de producción

### 2.1 Tamaño y ritmo

| Qué | Cuánto |
|---|---|
| Registros de sittings y traslados | 626 en total; ~70 por mes desde que se cargan en la app (septiembre y octubre) |
| En octubre, cómo se cargaron | 26 a mano, 23 generados por los fijos automáticos, 3 cancelados, 17 previstos |
| Familias | 68 cargadas; 19 con algún sitting en 90 días; 14 en los últimos 30 |
| Niñeras | 92 activas; 20 con algún sitting en 90 días; 3 de ellas hacen un tercio de los sittings |
| Concentración | 3 familias son el 60 % de lo facturado en 90 días |
| Sin hora de fin | 13 de 95 sittings de 90 días no tienen hora de fin: el precio no se puede verificar |
| Datos que faltan | 30 familias sin tarifa por hora, 46 sin cuenta; 69 niñeras activas sin cuenta, 9 sin teléfono; 0 familias con términos marcados |
| Pedidos (solicitudes) | 22 en total: 7 confirmados, 15 cancelados. Ningún código escribe el estado "pendiente de confirmar": ese flujo (leyenda, botón "Agregar otra niñera", notificación) está muerto |
| Candidatas | 137: 37 en intake, 3 entrevistadas, 97 contratadas |
| Cuándo trabajan | 45 % de las escrituras entre las 20:00 y las 07:00, 38 % de tarde, 16 % de mañana |

### 2.2 Qué corrigen a mano, de verdad

`sittings_historial` tiene 230 filas desde el 05/10. Separando quién escribe (las cuatro cuentas de
administradoras contra el proceso nocturno y las migraciones de Diego) y qué cambia:

| Cambio | Filas | Quién | Lectura |
|---|---|---|---|
| `pagado` false → true | 36 | administradoras, 22 en 13 minutos distintos | Flujo normal: pagan de a una desde el celular. No es un error |
| `cobrado` false → true | 27 | administradoras, 11 en 3 minutos | Flujo normal, en tandas |
| true → false (deshacer una marca) | 0 | | Nadie se equivoca al marcar; el deshacer no es el problema principal |
| `estado` previsto → confirmado | 25 | proceso de las 03:00 | Automático |
| `ninera_id` + `asignacion_id` | 15 en un minuto | migración (06/10) | Arreglo de datos, no uso |
| `cobro_familia` y `pago_ninera` juntos | 24 | 11 en un minuto por migración (13/10); 5 en dos minutos por una administradora (11/10); el resto sueltos | **El error real.** Ver abajo |
| `cobro_familia` solo | 6 | una administradora, 5 días distintos | Ajustes de cobro sin tocar el pago ni las horas |
| `pago_ninera` solo | 2 | | Ídem |
| `hora_fin` / `hora_inicio` | 5 | | La hora real difirió de la prevista |
| Niñera, familia, notas, tipo, cancelado | 1 a 4 cada uno | | Marginal |

Patrones detrás de las correcciones de precio (sin montos; las filas se miraron de a una):

1. **Una regla mal aplicada se corrige fila por fila.** El 11/10 una administradora subió cobro y pago de 5 días de un fijo por el mismo importe; el 13/10 una migración los devolvió. Era un gasto (taxi, compra) metido adentro del precio porque todavía no existía "gastos aparte" (se arregló ese día). Cuando la regla cambia, la corrección masiva no debería ser a mano.
2. **Precio corregido sin tocar las horas.** De los 17 cambios de cobro+pago, solo 3 vinieron con un cambio de `hora_fin`. Los otros guardaron un precio que no coincide con las horas del registro: queda un sitting de 3 horas con precio de 2,25. El camino que lo permite es Finanzas → Movimientos → Editar (dos campos numéricos sueltos, `editarMovimientoSitting`, finanzas.js:1274) y el formulario de Sittings con el precio editable.
3. **El número se calcula de memoria, a prueba y error.** Un mismo registro cambió de cobro cuatro veces en un día (por ejemplo: sube, baja, baja, baja). No hay un desglose "horas × tarifa + gastos" para apoyarse.
4. **El día de un fijo se carga con el horario previsto y la realidad fue otra.** El 18 y el 20/10 el cambio fue media hora más o menos de lo previsto. La lista "Fijos confirmados automáticamente" de Hoy pide un "Bien" por cada día (18 acumulados, 0 revisados en la base): nadie lo usa porque no pregunta lo único que importa, a qué hora terminó.

### 2.3 Consultas: cuántas y cuánto tardan

- Logs de 24 h (solo el navegador, sin las Edge Functions): 376 GET a `sittings_traslados`, 171 a `solicitudes`, 127 a `app_config` (112 son la misma lectura de `ultima_conciliacion_cobros`), 123 a `ninieras`, 111 a `asignaciones` (92 con `select=*,familias(nombre)`), 111 a `familias`, 51 a `asignaciones_pausas` con `select=*`.
- Tiempo por pedido: promedio 200 a 350 ms, p90 500 a 700 ms, máximos de 1,5 s. En la base, `pg_stat_statements` muestra que esas mismas consultas tardan 0,2 a 4 ms. Toda la demora es el viaje a Canadá (`ca-central-1`): **la mejora es hacer menos viajes, no consultas más rápidas.** Los índices de `sittings_traslados` ya están bien (fecha, familia, niñera, pendientes de cobro y pago, previstos).
- Por módulo, al entrar (simulador, 390 px): Hoy 33 pedidos en tres tandas en serie; Finanzas 32 (dos repetidas idénticas); Sittings 13; Familias 11; Agenda 10 (4 más por cada flecha de semana); Niñeras 8; Postulantes 9.
- En cada cambio de módulo, `renderSidebar()` dispara 4 pedidos solo para los puntitos del menú (`app_config`, `sittings_traslados` sin pagar, `intermediaciones_eventos_ninieras`, `solicitudes`). Es la fuente de los 112 GET diarios a `app_config`.
- Cada "Marcar pagado" en Finanzas: 1 lectura del detalle + 1 a 3 updates + `refrescarFinanzasCompleto()` (~31 pedidos) y, 600 ms después, el Realtime de la propia escritura vuelve a disparar lo mismo: **60 a 70 pedidos por pago**. Con 22 pagos en un día son unos 1.400 pedidos.
- Dentro de Hoy, `sittings_traslados` se lee hasta 9 veces, `asignaciones` 3, `asignaciones_pausas` 2, `ninieras` 3 y `familias` 2 (con columnas distintas cada vez). `familias` se lee en total 5 veces con 5 selects distintos entre Hoy, Finanzas, Sittings y Agenda.
- `abrirModalAsignar` (agenda.js:665) lee **toda la historia** de `sittings_traslados` (de a 1.000) cada vez que se abre "Asignar niñera", para contar cuántas veces fue cada una.
- Advisors de Supabase: nada nuevo de rendimiento (claves foráneas sin índice en tablas chicas y vacías); de seguridad, lo ya conocido (`es_usuaria_autorizada` y `generar_previstos_fijos` ejecutables, protección de contraseñas filtradas apagada). Las 13 tablas `respaldo_*` tienen RLS sin políticas: inaccesibles, correcto.

## 3. Auditoría por módulo

Convención: "entrar" en celular = abrir el menú + tocar el módulo (2 toques). Los botones chicos son los
de menos de 40 px de alto (iOS recomienda 44).

### 3.1 Hoy (`app-shell.js`)

Qué muestra, de arriba a abajo: 3 tarjetas de conteo (en proceso, niñeras activas, familias), un gráfico de 6 meses (el mismo de Finanzas), aviso de la carga nocturna, banner "sin registrar", "Fijos confirmados automáticamente" (hasta 14 días), "Datos que faltan", "Sin resolver hoy y mañana". A 390 px lo accionable arranca en la segunda pantalla.

| Tarea | Toques | Problema |
|---|---|---|
| Ver qué falta hoy | 0, más 1 a 2 pantallas de scroll | Los conteos y el gráfico ocupan la primera pantalla y no cambian ninguna decisión del día |
| Asignar niñera al pedido de hoy | la fila solo navega a la Agenda; después 4 toques más | `abrirModalAsignar(id)` existe y podría abrirse desde Hoy |
| Revisar un fijo cargado solo | 1 por día ("Bien") o "Todo bien" | Cada "Bien" dispara un update, el Realtime repinta Hoy entero y la campanita: ~30 pedidos por toque. 0 revisados en producción |
| Cargar un sitting sin registrar | "Ver" + "Cargar sitting" + Guardar en Sittings = 3 | Si tiene horas y la familia tiene tarifa, podría guardarse en un toque con el cálculo de `registrarSittingFijoDeHoy` |
| Completar un dato que falta | 1 + espera de hasta 5 s de polling | Correcto, pero el módulo destino tarda en cargar su lista |
| Ver plata pendiente | no está | Solo prende el puntito de Finanzas |

Errores y confirmaciones: `marcarAutoNoFue` chequea cobrado/pagado del caché y no de la base (app-shell.js:534); "Fue otra" acepta texto libre sin `confirmarNombreNuevo` (572) y deja `ninera_id` nulo. Hoy traga errores en `try{}catch(e){}` vacíos (258, 303, 375) y muestra "—" o 0 como si fuera dato.

Consultas: 8 en paralelo (bien) y después 2 tandas en serie (solicitud_ninieras; asignaciones + pausas) que podrían ir en la primera. `cargarConfirmadosAutomaticos` usa `select('*')`. Tres lecturas del mismo rango de 14 días de `sittings_traslados` con columnas distintas (207, 345, 500). La campanita (`cargarNotificaciones`) hace 6 a 7 pedidos más y repite las de "Sin resolver" y del badge de Agenda: tres listas de "lo urgente" calculadas por separado.

Celular: todos los botones de acción son `.smallbtn` (~30 px). Textos de 10 a 11 px en la tendencia de las tarjetas, el gráfico y el timeline. La línea vertical del timeline está fija en 108 px y el texto "Mañana · 18:30–22:00" mide más: se pisan (a verificar en iPhone).

### 3.2 Agenda (`agenda.js`)

| Tarea | Toques | A mano pudiendo precargarse |
|---|---|---|
| Solicitud puntual | 8 mínimo, ~12 típico (familia 2, hora inicio 2 selects, hora fin 2, Guardar) | Hora de fin sin sugerencia; cobro de traslado solo si cargan km |
| Fijo nuevo | 11 a 14; traslado suma cobro y pago a mano | El traslado fijo no usa `tarifas_traslado_config` como sí hace el puntual |
| Asignar niñera | 6 + 0 a 2 confirmaciones + espera de 3 consultas | Pago sugerido = 0 si la familia no tiene `pago_hora` o el pedido no tiene fin, y se guarda sin aviso (745, 759) |
| Registrar el fijo de hoy (sin automáticos) | 4, pero el bloque está al final de un modal de 3 pantallas | |
| Reemplazo | 8 | Texto libre sin confirmar nombre (1183) |
| Pausar / terminar / cambiar niñera | 5 a 7 | Hasta 2 diálogos seguidos (doble reserva + familia cubierta) |

Errores de plata: un puntual **sin hora de fin** guarda la tarifa por hora como cobro total (`cobroFinal = Number(tarifa)`, agenda.js:596-598) y `guardarAsignacionDirecta` la copia al registro real sin recalcular (774). Un traslado puntual sin "Cobro total" queda con cobro nulo → registro en $0. Un fijo con familia sin tarifa registra $0 y el toast dice "Sitting registrado".

Horario: "Editar horarios futuros" rechaza fin ≤ inicio y no tiene "termina al día siguiente" (965): un fijo nocturno no se puede editar por ahí. La fecha de la solicitud nueva se precarga con el ancla de la semana visible, no con hoy (513).

Dos usuarias: `guardarAsignacionDirecta` no verifica que la solicitud siga sin asignar (747-782) y escribe 3 tablas en serie sin transacción; con un modal abierto el Realtime espera, así que la segunda sigue viendo el pedido libre. `cambiarNineraAsignacionFija` y `guardarHorarioAsignacionFija` trabajan sobre el objeto cacheado: si la otra ya cerró el fijo, se crean dos asignaciones superpuestas. `alinearRegistroDeHoy` (1609) hace el update condicional correcto: es el modelo a copiar.

Sin deshacer: cancelar solicitud, "No fue" (queda cancelado, cobrado y pagado en $0), "Bien", borrar previstos editados, eliminar registro.

Consultas: `cargarAgendaBase` va en serie antes de las solicitudes (117-118) sin necesidad; cada flecha de semana relee asignaciones y pausas, que no dependen de la semana; los modales de vigencia, terminar y pausar releen la asignación que ya tienen; `chequearFijoNuevoContraTodo` corre 3 consultas **por cada día** del fijo con horario por día (loop en 640-645); `avisarSiFijoDuplicado` es la cuarta lectura de asignaciones en el mismo guardado.

Celular: la grilla móvil arma las filas con estilos inline, distintos de la vista de compu ("Sin asignar" es texto en una y badge en la otra); textos de 10 y 11 px en encabezados de día, badges, niñera y cobro/pago; el modal del fijo tiene 8 o 9 botones de ancho completo; el dropdown de autocompletar se recorta dentro del modal con scroll (a verificar).

### 3.3 Sittings y traslados (`sittings.js`)

Qué muestra: botón "+ Agregar", mes, 3 tarjetas (cobrado, pagado, margen: son sumas de lo facturado, no de la plata que entró, al revés de la convención de Finanzas), tabla del mes (8 columnas, scroll horizontal, los botones Editar/Eliminar/Incidente en la última), "Historial con filtros" (otra tabla de 9 columnas, fila tocable), incidentes. A 390 px: 2,6 pantallas sin abrir nada.

| Tarea | Toques | A mano pudiendo precargarse |
|---|---|---|
| Sitting puntual | 12 a 16 (familia 2, niñera 2, hora inicio 2 a 4, hora fin 2 a 4, Guardar al fondo) + 0 a 4 confirmaciones seguidas (nombre parecido ×2, mismo día, doble reserva, familia cubierta) | "Registró" (ya viene con el nombre; no debería ser campo); niñera y horario (no se sugiere la última niñera ni el último horario de esa familia); cobro y pago si la familia no tiene tarifa (no se reutiliza el último precio) |
| Traslado | 13 a 17 | destino; km si falla el mapa |
| Editar | 2 + scroll horizontal hasta "Editar" (8.ª columna) o tocar la fila del historial + Guardar | |
| Corregir precio | 4 toques + 2 números, sin aviso de "la tarifa daría $X" | |
| Gasto con ticket | 9 a 10 (editar, scroll, agregar, concepto, monto, foto, guardar) | |
| Borrar | 4, sin deshacer; no existe en el modal de edición | |
| Exportar PDF | 5 a 7; la familia se elige en el filtro de arriba, no en el modal | |

Orden del formulario (18 bloques): tipo, **Registró**, familia, niñera, fecha, hora inicio (hh y mm), hora fin (hh y mm), "termina al día siguiente", aviso "se cobra hasta", "¿es fijo?" + días, "no hubo servicio", cobro, pago total + "poner pago por hora", caja "sin tarifa", gastos, notas, Guardar + margen, historial. En el celular: 1.115 px de alto medidos (1,3 pantallas) con 15 campos; Guardar y el margen al fondo sin pie fijo.

**Por qué el precio sale mal** (verificado línea por línea):

1. `actualizarCobroPagoPorHorario` (1315-1360) **nunca mira `tocadoManual`**: si la administradora puso un precio a mano y después corrige un minuto de la hora de fin o retoca la familia, vuelve a tarifa × horas sin aviso. Solo el camino de traslado respeta la marca (1225-1226). Al editar un registro guardado, `abrirModalSitForm` marca los campos como manuales (684-687) justamente para que no se pisen, pero para sittings no sirve.
2. **Sin señal visual**: `marcarCampoSugerido` (borde punteado) solo se usa en traslados. En un sitting el valor calculado se ve igual que uno tipeado; no se muestra "3 h × $400 = $1.200". Nadie sabe si el número lo puso ella, la tarifa, o quedó viejo.
3. **Queda viejo**: si `sitFamiliaSel` es null (nombre a medio tipear, familia nueva) sale sin tocar nada (1321) y queda el precio de la familia anterior. Con cobro pero sin pago (o al revés) solo se actualiza el que existe (1354-1356).
4. **$0 silencioso**: sin hora de fin, sin tarifa o sin familia que coincida, cobro y pago quedan en 0 y `guardarSitting` solo valida negativos (1495). La caja para cargar la tarifa aparece solo con las dos horas puestas.
5. **La tarifa de una vez queda para siempre**: "Guardar tarifa y calcular" (1416-1434) y el modo por hora al guardar (1452-1463) escriben en `familias` sin preguntar: un precio pactado para ese día con esa niñera queda como tarifa de la familia.
6. **Medianoche**: con la casilla marcada y fin > inicio se suman 24 h (`horasSitting`, core.js:1346): 20:00 a 22:00 "al día siguiente" son 26 horas, sin aviso.
7. **Dos definiciones de precio esperado**: `asignaciones.cobro_hora/pago_hora` existen y el fijo las guarda (agenda.js:990, 1288), pero ni el formulario ni `generar_previstos_fijos` las usan (calculan con la familia), mientras `sospechasDelMes` (finanzas.js:1722) les da prioridad.
8. Al **editar** un registro de una niñera que ya no está activa, `sitNinieras` solo trae activas (495) y el update manda `ninera_id: null` (1469); igual `familia_id` si el nombre no coincide exacto: pérdida silenciosa de vínculos.

Otros errores: dos selects por hora (24 + 60 opciones, cuatro ruedas por sitting; minutos en blanco pasan a :00 sin decirlo); el autocompletar muestra 8 nombres alfabéticos, no los recientes, y "se puede cargar como nueva" invita a duplicar; `crearFamiliaRapida` crea sin confirmar parecidos; "Es otro, continuar" es un botón rojo igual que borrar; cobro y pago son `type=number` sin `inputmode`, así que iOS no da el teclado numérico.

Consultas: 10 pedidos al entrar en 5 rondas en serie (familias y niñeras → tarifa → config → mes, 3 del historial e incidentes → gastos); el historial lee `resenas_ninieras` entera y `familia_nombre` de **toda** la tabla solo para el select de familias; `pintarGastosExtraForm` consulta `gastos_extra` en cada apertura del formulario aunque sea un alta; al guardar, `chequearFamiliaYaCubierta` repite la misma consulta que `chequearRegistroExistenteMismoDia`; y como Sittings no tiene recarga liviana en `RT_RECARGA_LIVIANA`, el propio guardado reconstruye el módulo 600 ms después (otros 9 pedidos, y se pierden los filtros del historial y "Mostrar más").

Componentes: tres markups para el mismo registro (tabla del mes, historial, vista previa del PDF) con las columnas familia y niñera invertidas entre sí y sin el horario en la lista del mes (lo que más se corrige); badge "Cancelado" copiado tres veces; `new Date(f+'T00:00:00')` repetido 7 veces; 4 textos de vacío distintos; el historial no muestra errores (una falla se ve como "No hay registros").

### 3.4 Finanzas (`finanzas.js`)

Es una sola página larga: helper, mes, "+ Registrar gasto", Resumen/Revisar, 5 tarjetas, balance de 6 meses (gráfico), conciliación con el extracto (en pausa), **Por cobrar**, **Por pagar**, composición de gastos (donut), margen por familia/zona/tipo (tabla con scroll horizontal), gastos fijos, movimientos del mes (2 filas por registro). Con los datos de octubre son 15 a 18 pantallas en el iPhone; Por pagar, lo que más usan, empieza en la cuarta o quinta.

| Tarea | Toques | Scroll |
|---|---|---|
| Marcar cobrado a una familia | 1, **sin confirmación** (solo se confirma pagado, 1157) y con frecuencia mensual marca todos los registros del mes de esa familia sin mostrarlos | 2 pantallas |
| Pagar a una niñera desde el celular | Copiar cuenta → ir a Mercado Pago → volver → Copiar monto → ir → volver → Marcar pagado → Confirmar = 4 toques + 2 idas y vueltas, y cada marca repinta toda la lista | 4 a 5 pantallas |
| Corregir un monto | Movimientos → Editar → Guardar (2 + tipear); no recalcula horas × tarifa aunque `sospechasDelMes` ya sabe el esperado (1711) | 9 a 10 pantallas |
| Cargar saldo a favor | no está en Finanzas: ficha de la familia o niñera, ~6 toques en otro módulo | |
| Gasto fijo | 2 + 3 campos | 8 a 9 pantallas |
| Ver historial de cambios de un sitting | no se ve en Finanzas (solo gastos, ajustes y saldos) | |

Dónde se equivocan: `guardarMovimientoSitting` pisa `cobrado`/`pagado` con el estado del modal sin `.eq(campo,false)` (1312): si la otra marcó mientras tanto, se desmarca. Deshacer una marca es Movimientos → Editar → destildar, de a un sitting, y no revierte el saldo a favor ya aplicado. La conciliación marca sin guard y sin anotar el saldo (pendiente B10 ya conocido). El margen cierra la semana siempre en domingo (`filtrarFijosSemanaIncompleta`, 340) mientras el resumen y Por pagar cierran sábado o domingo según la niñera: un sábado los números no cuadran entre sí. La tarjeta "Por cobrar" es del mes y la lista junta todos los meses: nunca coinciden. El balance termina siempre en el mes actual aunque se navegue a otro; el subtítulo del margen no cambia al cambiar de mes.

Consultas (28 a 32 al entrar, 3 o 4 tandas en serie): `sittings_traslados` del mes con `select('*')` y la de 6 meses se superponen; `gastos_generales`, `gastos_fijos`, `ajustes_saldo`, `familias` y `asignaciones` se leen dos veces cada una; `cargarRevisarMes` se dispara siempre aunque no se abra la pestaña (491, 3 pedidos); `confirmarPagoSittings` relee lo que la lista ya tenía; los ajustes se aplican con una lectura y un update por ajuste en loop (797-803). `actualizarFinanzasBadge` podría salir de los pendientes ya cargados.

Analytics que muestra: facturado, cobrado, por cobrar, por pagar, resultado, intermediaciones, previsto, balance, donut, margen por familia/zona/tipo, movimientos. Sirven para decidir: resultado, por cobrar/por pagar y margen por familia. Sueltos: el donut (siempre casi todo niñeras), los totales del período sin tendencia, "cobrado" como cifra aparte.

Componentes repetidos: 11 filas `agendarow` con el mismo `style="border-bottom..."` inline que pisa el borde punteado por defecto; `fmt` de plata definido 4 veces más `plata`, `plataFin`, `textoMontoAjuste` y 27 `toLocaleString('es-UY')` sueltos; botón activo pintado a mano con `#666EAE` en tres lugares; tres overlays de confirmación con la misma plomería (pago, conciliación, ajuste); saldo a favor con dos formularios distintos (ficha y Revisar meses); "Cobrado / Pagado" en la tabla de margen significa lo facturado, en la tarjeta significa lo marcado.

Celular: ningún botón llega a 44 px ("Marcar cobrado" ~30 px); la tabla de margen obliga a scroll horizontal; las tarjetas de resumen se apilan y ocupan media pantalla antes de ver algo accionable.

### 3.5 Familias (`familias.js`)

| Tarea | Toques | Observación |
|---|---|---|
| Alta | 2 + 1 campo (solo el nombre es obligatorio); completa con 2 hijos y cuenta: ~14 campos + ~8 toques | La frecuencia de cobro no está en el alta (solo en editar); la dirección no usa el autocompletado que ya existe en Sittings; teléfono crudo |
| Editar | 2 + lo que cambie; al guardar hace 6 pedidos y recarga el módulo entero | Alta y edición son dos modales distintos (`fam-*` / `ed-fam-*`) con distinto orden de campos |
| Crear fijo desde la ficha | 8 a 10 (datalist de niñera, 4 selects de hora, días) | El datalist carga niñeras con solo `nombre` (105): el fijo queda con `ninera_id` nulo (497-498) y no filtra inactivas |
| Marcar términos | 3 | Bien |
| Borrar | tacho de 26 px + confirmación genérica | `ON DELETE CASCADE` borra fijos e hijos (schema.sql:662, 666), contra la regla "los fijos nunca se borran"; los sittings quedan con `familia_id` nulo. No hay baja lógica |

Tarifa: `cobro_hora`/`pago_hora` se guardan sin validar (uno solo, o pago mayor que cobro, que solo se pinta rojo). Cambiarla recalcula previstos y el de hoy, pero no lo ya registrado, y el modal no lo dice. El historial de la ficha se une **por nombre normalizado**: renombrar una familia la desconecta de sus sittings sin aviso (para zonas existe "renombrar en fichas", para personas no). `nombreParecido` descarta el nombre exacto: "García" dos veces no avisa, y solo corre en el alta.

Consultas: 7 al entrar, incluida **toda la historia** de `sittings_traslados` (de a 1.000) solo para contar y ver la última actividad, y `resenas_ninieras` entera (también la leen Niñeras y Sittings). Cada ficha lee todos los incidentes y filtra en el navegador. Por Realtime, Familias escucha `sittings_traslados`, `resenas_ninieras` y `ninieras`: cada sitting que guarda la otra administradora recarga la lista completa.

### 3.6 Niñeras (`ninieras.js`)

| Tarea | Toques | Observación |
|---|---|---|
| Alta | 2 + 1 campo | Bien |
| Editar | 3 a 4 (si no tiene la temporada al día, antes se abre "Temporada de X" y hay que "Omitir") | Categorías extra en un segundo overlay (4 toques); la foto se sube al bucket al elegirla, antes de Guardar: si cancela queda huérfana |
| Ficha | 1 toque, 7 a 8 pedidos en dos tandas | Lee `carsitting_datos` entera (tabla vacía) y `juguetes` (0 filas) en cada apertura |
| Temporada | 12 botones de mes + 24 celdas de ~13 px de ancho en el celular | El CSS de la temporada se inyecta desde JS |
| CV, WhatsApp | 2 a 3 | Textos fijos en el código, no editables antes de mandar |
| Borrar | tacho | Si tiene intermediaciones o saldo falla por clave foránea y muestra el error crudo de Postgres. No hay "dar de baja": la única forma de poner `activa=false` es colocarla con Enrique, sin confirmación |

Consultas: `cargarNinieras` lee `*, candidatas(*)` (24 + 37 columnas por 92 filas: foto, temporada, tokens, todas las respuestas del formulario) y después toda la historia de registros para la utilización. `ninieras` se lee en la app con **10 juegos de columnas distintos** y `familias` con 7: son 92 y 68 filas, cabe todo en memoria una vez por sesión.

Celular: `person-row` se parte en tres renglones (~125 px por fila): 92 niñeras son unas 14 pantallas. La ficha ronda 4 a 6 pantallas dentro del modal.

### 3.7 Postulantes (`postulantes.js`)

Candidata nueva: 2 toques + 1 campo, pero pide la edad en texto y después la fecha de nacimiento en la entrevista (dos veces el mismo dato). Entrevista: mínimo ~11 toques, completa 40+ campos, ~8 pantallas de alto en el iPhone (los bloques se pliegan pero arrancan abiertos); "Guardar candidata" queda deshabilitado hasta los 7 puntajes sin decir cuáles faltan; **"Vaciar formulario" limpia sin confirmar y está al lado de Guardar**; cambiar de pestaña reconstruye todo sin avisar; "Descartar" en Intake es un DELETE físico aunque exista el estado `descartada`. Contratar: foto como URL de texto mientras en Niñeras se sube un archivo. Consultas: los 3 pedidos de carsitting se repiten en **cada** cambio de pestaña; Guardadas trae todas las entrevistas con las 37 columnas de cada candidata.

### 3.8 Intermediaciones, Contratos, Marketing, Juguetes

Intermediaciones: 5 pedidos por cada cambio de pestaña; el detalle relee lo que ya está en memoria; el monto se tipea sin tarifa configurada. Contratos (0 filas): 7 campos a mano aunque familias tiene dirección y tarifa y carsitting tiene cédula; 3 pedidos al entrar. Marketing (9 filas): recarga la lista por cada casilla "Publicado". Juguetes (0 filas): es el único módulo con **un solo modal para alta y edición**, el modelo a seguir. Contratos y Juguetes siguen en el menú principal y la ficha de niñera los consulta en cada apertura.

### 3.9 Notificaciones (campanita y push)

Cinco tipos (`TIPOS_NOTIF`): sin asignar hoy, sin registrar hoy, CV desactualizado, extracto sin subir, temporada de Punta. La campanita se recalcula con 6 a 7 pedidos al entrar y a cada cambio en tres tablas; "leído" es por usuaria. Lo que avisa la campanita es lo mismo que "Sin resolver" en Hoy y que el puntito de Agenda, calculado tres veces por separado. Con Hoy rediseñado como lista de acciones, la campanita repite lo de Hoy, pero se mantiene también en el celular (decisión 10): pasa a leer de la misma `cargarAccionesHoy()` que las tarjetas, así deja de calcularse aparte.

### 3.10 Transversal: componentes e inconsistencias

Conteo en `js/`: 856 atributos `style="..."` inline (202 en finanzas.js, 124 en agenda.js, 116 en sittings.js y ninieras.js); 49 `abrirModal(` más 3 overlays propios; 31 `confirmarAccion(`; 254 `toast(`; 13 `class="empty"` con 4 textos de "Cargando" distintos; 21 `errBox(` en agenda.js contra 1 en ninieras.js. Siete nombres de fila para el mismo patrón "texto a la izquierda, botones a la derecha, borde abajo": `agendarow`, `autoconf-fila`, `pago-fila`, `agenda-ninerarow`, `notifcfg-row`, `conc-fila`, `person-row`. Tres patrones de confirmación: `confirmarAccion`, modales con Cancelar/Guardar, modales con un solo botón ancho donde la X es el único cancelar. Dos sistemas de "número grande": `.statcard` (Hoy) y `.summarycard` + `.statnum` con tamaño inline (Finanzas).

Listas de personas con cuatro markups (`person-row`, `candlist .item`, filas inline en Intermediaciones, cards en Marketing, grilla en Juguetes); `.pcard` es CSS muerto salvo su botón de borrar, forzado con `position:static` en 4 lugares; alta y edición duplicadas en Familias, Niñeras y Marketing; el mail de carsitting está dos veces, idéntico; "Eliminar", "Descartar" y "Quitar" para la misma acción.

Lo que ya está bien y se conserva: paleta y tipografías (Baloo 2, Inter, IBM Plex Mono), `conGuardado` y `sbGuardar`, los helpers de escape, `confirmarPagoSittings`, `copiarAlPortapapeles`, `cardHeaderConColapso`, `abrirModal`/`cerrarModal`, inputs a 16 px (sin zoom en iOS), toasts abajo en el celular.

## 4. Propuesta

### 4.1 Principios

1. **Primero lo que hay que hacer, después los números.** Cada pantalla abre con la acción pendiente más urgente y un botón que la resuelve.
2. **El precio no se tipea: se ve cómo se calcula.** Horas × tarifa + gastos, con desglose. Cambiarlo a mano es posible pero explícito, con motivo y marca.
3. **Un toque, 44 px.** Todo lo que se toca mide 44 px de alto; lo que más se repite (pagar, cobrar, cerrar el día) está a un toque desde Hoy.
4. **Menos viajes.** Una pantalla = una tanda de pedidos (idealmente uno). Lo que no cambia en la sesión (familias, niñeras, fijos, config) se lee una vez.
5. **Deshacer antes que confirmar.** Para lo reversible (marcar cobrado/pagado, revisar), un toast con "Deshacer" 8 segundos en vez de un diálogo previo. Confirmación previa solo para lo que no se puede volver (borrar, cancelar un pedido, terminar un fijo) y para la plata que sale (pagar).
6. **Un solo componente por patrón.** Una fila, una tarjeta, un chip, una hoja, un estado vacío. Los ids y las clases que usan los tests se conservan.
7. **Pensado para el celular, no adaptado.** Barra de pestañas abajo, hojas que suben, filtros en chips con scroll horizontal, nada de tablas anchas.

### 4.2 Navegación nueva

Celular y tablet (hasta 1023 px): barra fija abajo con 5 pestañas. Compu (desde 1024 px): la barra
de arriba ocupa todo el ancho y debajo, a la izquierda, un menú lateral fijo con las **mismas 5
secciones** (no los 12 módulos de hoy), en el mismo orden. Es un solo menú: el CSS lo pone abajo o al
costado según el ancho.

| Pestaña | Contiene | Clave actual |
|---|---|---|
| Hoy | lista de acciones + agenda del día + esta semana | `null` |
| Agenda | semana / día, pedidos, fijos | `agenda` |
| Registros | sittings y traslados del mes, historial, incidentes | `sittings` |
| Plata | Pagar · Cobrar · Números (incluye gastos, revisar meses, conciliar) | `finanzas` |
| Más | Familias, Niñeras, Postulantes, Intermediaciones, Notificaciones, Marketing, Contratos, Juguetes, ajustes (Face ID, zonas, tarifa de traslado, cerrar sesión) | el resto |

Puntitos de aviso en Hoy (urgente del día) y Plata (hay para pagar o cobrar). La campanita sigue arriba a la derecha, en el celular y en la compu (decisión 10). En el celular, un botón "+" flotante en Hoy, Agenda y Registros abre una hoja con tres opciones: nuevo registro, nuevo pedido desde WhatsApp (entra justo después de la base), nuevo fijo. En la compu el "+" no flota (tapaba el panel de Registros y los botones de la columna derecha de Hoy): es un botón "+ Nuevo" arriba del menú lateral, con las mismas tres opciones. El menú se arma en `renderApp()` con los mismos `MODULOS` y `setModulo(k)`; `renderSidebar()` pasa a pintar ese menú único en vez de la lista de 12 módulos. Contratos y Juguetes tienen 0 filas y Marketing 9: van al final de "Más" (decisión 5).

### 4.3 Hoy nuevo

Una lista de **tarjetas de acción**, ordenadas por urgencia, cada una con una franja de color (rojo urgente, ámbar atención, violeta rutina, verde plata) y **un** botón principal. Debajo, "Hoy en la agenda" (timeline del día con estado) y "Esta semana" (3 datos). Al final, "Datos que faltan" plegado. Sin tarjetas de conteo ni gráfico (viven en Plata → Números).

| Tarjeta | Cuándo aparece | Botón principal (un toque) | Reutiliza |
|---|---|---|---|
| Pedido de hoy/mañana sin niñera | hay solicitud sin asignar con fecha ≤ mañana | "Elegir niñera" abre el modal de asignar sin pasar por la Agenda; secundario "Copiar mensaje para niñeras" | `abrirModalAsignar`, `waLink`/`mensajeWA` |
| Pedido nuevo por WhatsApp | cuando exista esa función | "Revisar y confirmar pedido"; muestra ticket (familia, día, horario aproximado, chicos, zona, precio según tarifa) y las niñeras sugeridas en orden con el porqué en una línea | el diseño deja el espacio y el componente (`chip-elegir`) desde ahora |
| Cierre de ayer | fijo generado solo, de ayer, sin revisar | "Sí, terminó 19:00" / "Otra hora" (hoja con reloj) / "No fue". Al confirmar queda `revisado_at` y, si cambió la hora, recalcula con `horasSitting` | `marcarAutoRevisados`, `marcarAutoNoFue`, `abrirReemplazoAuto`, `horasSitting` |
| Sin registrar | puntual confirmado ya pasado sin registro | "Registrar así" guarda directo con el precio calculado (si hay horas y tarifa); "Cambiar horario" abre la hoja | `cargarSittingDesdePendiente`, cálculo de `registrarSittingFijoDeHoy` |
| Cobros | hay familias con cobro vencido | "Ver cobros" (Plata → Cobrar); secundario "Recordar por WhatsApp a las N" (cuando se retome esa tarea) | `calcularPendientesAgrupados` |
| Pagos | sábado y domingo, o semana cerrada sin pagar | "Pagar ahora" (Plata → Pagar); entre semana solo informa cuánto llevan | `porPagarEnCursoHtml` |
| La carga nocturna no anduvo | solo si pasó | "Cargarlos ahora" | `cargarFijosAhora` |
| Datos que faltan | siempre que haya, plegado | "Completar" | `abrirFichaDesdeHoy` |

En la compu (desde 1024 px), Hoy va en dos columnas: las tarjetas de acción a la izquierda (`1,3fr`) y
"Hoy en la agenda", "Esta semana" (sus datos en 2 columnas) y "Datos que faltan" a la derecha (`1fr`),
pegajosa al hacer scroll para que la agenda del día quede a la vista mientras se resuelven las
tarjetas.

Reemplaza la revisión de 14 días por **el cierre de ayer** (y, a la mañana, el de hoy si ya terminó): una pregunta concreta en vez de un "Bien" sin consecuencia. "Sí a todos" para los días que ya quedaron atrás. Lo que no se cierra en 7 días se da por revisado solo (decisión 3).

Una sola función `cargarAccionesHoy()` alimenta las tarjetas, el puntito de Hoy, la campanita y el push. Los datos salen de una función de la base `resumen_hoy()` (un pedido) que devuelve: pedidos sin asignar hasta mañana, fijos de ayer sin revisar, puntuales sin registrar, cobros vencidos (conteo y total), pagos listos (conteo y total), datos que faltan, estado de la carga nocturna. Hoy pasa de 33 pedidos a 4 o 5.

### 4.4 Sistema de componentes

Vive en `core.js` (helpers que devuelven HTML) e `index.html` (CSS). Scripts clásicos y handlers inline como hoy; nada de módulos. Nombres en español como el resto del código.

Regla de nombres (21/10/2026): **una clase es de un solo componente.** Las variantes llevan el nombre
del componente como prefijo (`chip-aviso`, `aviso-atencion`, `btn-primario`, `fila-pasado`,
`accion-urgente`), nunca una palabra suelta. En la primera maqueta el chip "aviso" (`.chip.aviso`)
heredaba el padding y el tamaño del bloque `.aviso`, porque `aviso` era a la vez un componente y una
variante de otro. `tests/estatico.spec.js` controla que ningún nombre de componente se use como
variante de otro.

Tokens (CSS en `:root`, los colores de siempre): `--sp-1..6` (4 a 32 px), `--r-sm/md/lg` (8/12/16), `--tap: 44px`, `--f-display/body/mono`. Sin modo oscuro por ahora (la paleta tiene contraste suficiente; se puede sumar después con las mismas variables).

| Componente | Helper | Reemplaza a |
|---|---|---|
| Tarjeta | `uiTarjeta({titulo, cuerpo, acciones, plegable})` | `.card` con headers a mano, `cardHeaderConColapso` |
| Tarjeta de acción | `uiAccion({nivel, eyebrow, titulo, detalle, botones})` | tarjetas de Hoy, `pendbanner`, `warnbox` con botón |
| Fila | `uiFila({izquierda, principal, meta, derecha, botones, onclick})`. En el celular los botones bajan a una segunda línea; en la compu van en la misma línea que el monto | `agendarow`, `autoconf-fila`, `pago-fila`, `agenda-ninerarow`, `notifcfg-row`, `conc-fila`, `person-row`, `candlist .item`, filas de movimientos y fijos |
| Lista | `uiLista(filas, {grupos})` con encabezados de grupo pegajosos | tablas `asigtable` (lista del mes, historial, margen) |
| Chip | `uiChip(texto, 'ok'/'aviso'/'mal'/'neutro'/'marca'/'sin')`, que emite `class="chip chip-ok"` | `.badge` con 5 variantes y estilos inline |
| Aviso | `uiAviso(texto, 'atencion'/'ok'/'info'/'error')`: bloque de texto de ancho completo, emite `class="aviso aviso-atencion"` | `.warnbox`, `.okbox`, `.helper` coloreados a mano |
| Botón | `.btn` (44 px) con `.btn-primario/-suave/-bueno/-peligro/-chico` (36 px, solo en listas densas) y `.btn-ancho` | `.btn.primary`, `.smallbtn`, `.btn.ghost`, `.btn.danger`, `.createbtn`, `.extratoggle`, `.durbtn`, `.pillbtn`, `.tipobtn`, `.daybtn` |
| Segmentos y filtros | `uiSegmentos([...])`, `uiFiltros([...])` | `subtab`, `pillfilters`, `tiporow`, `fin-vistas` pintado a mano |
| Lista con panel | `uiListaPanel(lista, panel)`: en el celular la hoja sube desde abajo; en la compu va al costado de la lista, pegajosa y con su propio scroll. La usan Registros, Niñeras y Postulantes | el modal encima de la lista |
| Buscador | `uiBuscar({placeholder})`: campo con lupa, filtra en la base | los `input` de filtro sueltos de Familias y Niñeras |
| Bloque plegable | `uiBloque({titulo, estado, abierto})`: `details` con un chip de estado (Completo, Faltan 2, Opcional) | `cardHeaderConColapso` y los bloques de la Entrevista |
| Puntaje | `uiPuntaje(nombre, valor)`: escala de 1 a 5 en botones de 36 px; si falta, el nombre en ámbar | `.scorebar` / `.scorebtn` |
| Hoja | `abrirHoja(html, {titulo, pie, panel})`: en el celular sube desde abajo con pie pegajoso (Cancelar/Guardar). En la compu, si la pantalla tiene panel lateral (`panel: true`, Registros) se abre al costado de la lista sin tapar nada; si no, como el modal centrado de hoy | `abrirModal` (se mantiene como alias) |
| Estados | `uiVacio(texto, accion)`, `uiCargando()`, `uiError(e, reintentar)` | 13 `.empty`, 4 "Cargando", `errBox`, `errorConReintentoHtml` |
| Toast con deshacer | `toast(msg, tipo, {deshacer: fn})` | `toast` de hoy (se extiende) |
| Plata y fechas | `fmtPlata(n)`, `fmtFechaCorta(iso)`, `fmtHorario(ini, fin, cruza)` | `fmt` ×4, `plata`, `plataFin`, `fmtF` ×2, 27 `toLocaleString` sueltos |
| Desglose de precio | `uiDesglosePrecio({horas, tarifaCobro, tarifaPago, gastos, ajuste})` | los dos inputs numéricos del formulario y de Editar movimiento |

Cómo migrar sin romper los tests:

1. Los tests usan 629 selectores por id (`#editmodal`, `#sit-cobro`, `#fin-porpagar-wrap`, `#confirm-si`…) y 149 por clase (`.toast`, `.agendarow` ×29, `.autocomplete-item`, `.daybtn`, `.fin-semana-en-curso`, `.statnum`, `.spinner`, `.autoconf-card`). **Los ids se conservan todos.** Las clases que miran los tests quedan como alias en el componente nuevo (`uiFila` emite `class="fila agendarow"`, el spinner conserva `.spinner`, el toast `.toast .good/.bad`).
2. `abrirModal` sigue existiendo y sigue creando `#editmodal` con `.confirmoverlay.show` (el Realtime y `esperarQuieta` dependen de eso); `abrirHoja` es la misma función con otra presentación. El panel lateral de Registros en la compu también es `#editmodal` con `.confirmoverlay.show` y una clase de panel que lo pone al costado sin fondo oscuro: los tests (que corren a 1280 px) lo siguen encontrando igual, y el Realtime sigue esperando a que se cierre.
3. Los tests corren con un solo proyecto, `escritorio` a 1280×900: con el diseño nuevo ven la versión de compu. El PR 0 suma un proyecto `celular` (390×844) que corre `humo` y `exploratorio`, para que la barra de abajo, el "+" flotante y las hojas también tengan test.
4. `tests/estatico.spec.js` suma tres controles: que ningún archivo nuevo use `style="` inline salvo una lista blanca que se achica PR a PR, que las clases alias no desaparezcan y que ningún nombre de componente se use como variante de otro.
5. Cada PR corre `humo`, `exploratorio` y los del módulo tocado, y saca capturas a 390 px y a 1280 px con el harness para comparar antes y después.
6. Orden: primero el PR de base (CSS + helpers, sin cambiar pantallas), después cada módulo migra sus filas y botones al componente. No se borra CSS viejo hasta que `grep` diga que nadie lo usa.

### 4.5 Analytics que sirven para decidir

En Plata → Números, 4 cifras del mes (facturado, resultado, por cobrar, por pagar) y una lista "Qué decidir" con frases, no gráficos. Todo sale de datos que ya existen, salvo donde se indica.

| Indicador | Para decidir qué | Datos |
|---|---|---|
| Concentración: las 3 familias que más facturan y su porcentaje | si una se va, cuánto cambia el mes; a quién cuidar | `cobro_familia` por `familia_id`, 90 días |
| Familias que dejaron de pedir (sin sitting en 6 semanas, con historial) | a quién escribir (ya existe `renderFamiliasEnRiesgo`) | última `fecha` por familia |
| Niñeras que trabajan: cuántas de las activas tuvieron sitting en 90 días y cuánto concentran las 3 primeras | repartir, dar de baja, a quién sugerir primero | `ninera_id` en registros |
| Pedidos que se concretan: confirmados / total y motivo de cancelación | por qué se pierden pedidos | `solicitudes.estado`; falta un campo `motivo_cancelacion` (chip al cancelar) |
| Días de cobro promedio, por frecuencia | cuándo mandar el recordatorio | **faltan `cobrado_at` y `pagado_at`** en `sittings_traslados` (hoy son booleanos); migración con trigger, y relleno desde `sittings_historial` para octubre |
| Margen por tipo y por familia, contra el promedio | precios que no acompañan | ya se calcula (`renderMargen`) |
| Sittings sin hora de fin y precios ajustados a mano | registros a revisar antes de cobrar | `hora_fin` nulo; nueva marca `precio_manual` (ver 4.6) |
| Fijos: cuántos días generados, cuántos cambiados, cuántos "no fue" | si los fijos están bien cargados | `generado_automatico`, `revisado_at`, `cancelado` |
| Embudo de candidatas: intake → entrevistada → contratada y días entre pasos | cuánto tarda contratar | `created_at` de candidatas y entrevistas |

Además, una analítica mínima de uso de la app (qué pantalla se abre, cuántas veces, desde qué dispositivo), en una tabla `uso_app` con una fila por sesión y módulo, para que la próxima auditoría no tenga que inferir.

### 4.6 Cómo evitar los errores más comunes

| Error | Cómo se evita |
|---|---|
| Precio que no coincide con las horas | El formulario muestra el desglose (`uiDesglosePrecio`) y recalcula al cambiar horas; los campos de cobro y pago dejan de ser inputs libres. "Ajustar precio" abre un paso con motivo (tabla de abajo) y marca el registro (`precio_manual = true` y `precio_motivo`, columnas nuevas) con un chip "precio a mano" en la lista. Editar movimiento en Plata reutiliza la misma hoja (horas + desglose), no dos números sueltos |
| Hora real distinta de la prevista en fijos | Cierre de ayer en Hoy pregunta la hora de fin; la hoja de "Otra hora" usa el reloj nativo del iPhone (`<input type="time">`) y atajos "+30 min", "+1 h" |
| Registro sin hora de fin | Hora de fin obligatoria para sittings al guardar como hecho; se permite vacía solo con "todavía no terminó" |
| Tarifa de familia vacía → $0 en silencio | Al asignar, registrar o generar: aviso bloqueante "esta familia no tiene tarifa" con el campo ahí mismo (ya existe `guardarTarifaFamiliaDesdeSitting`); el proceso nocturno deja esos días marcados "sin precio" y Hoy los lista |
| Pedido sin hora de fin guarda la tarifa como total | `guardarSolicitudPuntual` guarda `cobro_familia` nulo y la asignación lo calcula al confirmar con la hora real |
| Marcar cobrado el grupo equivocado | Confirmación con detalle (reusar la de pagos) + toast "Deshacer" 8 s. Deshacer revierte la marca y la aplicación del saldo a favor |
| Dos usuarias sobre lo mismo | Todo update de estado va con la condición del estado anterior (`.eq('estado','sin_asignar')`, `.eq('pagado', false)`) y avisa "ya lo hizo alguien más", como ya hace `marcarGrupoResuelto` |
| Nombre tipeado libre (reemplazo, "fue otra") | Siempre elegir de la lista o pasar por `confirmarNombreNuevo` |
| Campos a mano que sobran | "Registró" desaparece (lo pone el sistema); fecha con chips Hoy/Ayer/Otra; familia y niñera con chips de recientes y de "ya fue a esta casa"; hora con el reloj nativo (dos selects de 24 y 60 opciones pasan a uno) |
| Confirmaciones que molestan | Quitar la de "quitar pausa" y las dobles (doble reserva + familia cubierta se juntan en un aviso) |
| Acciones sin vuelta | "No fue" y cancelar pedido con Deshacer; terminar fijo y borrar con confirmación previa, como hoy |
| Borrar familia o niñera con historia | Baja lógica (`activa = false` + motivo) en vez de DELETE; el aviso dice cuántos sittings y fijos tiene; el tacho solo para fichas sin historial |
| Renombrar desconecta el historial | Al renombrar, actualizar `familia_nombre`/`ninera_nombre` en los registros (como ya hace `renombrarZonaEnFichas` para zonas); a futuro, unir por id |
| Tarifa pactada para un día queda para siempre | "Guardar tarifa y calcular" pregunta "¿solo para este sitting o para la familia?" |
| Vínculo perdido al editar | Al editar, conservar `familia_id`/`ninera_id` si el nombre no cambió; cargar también las inactivas para la edición |
| Entrevista que se pierde | Confirmar "Vaciar formulario" y el cambio de pestaña con cambios sin guardar; autoguardado de borrador (ya ofrecido) |
| Duplicados exactos | `nombreParecido` avisa también el nombre idéntico, y corre al editar y en el alta rápida desde Sittings |

Motivos de "Ajustar precio" (decisión 4a, 21/10/2026). El desglose calculado queda a la vista y el
ajuste se suma como una línea más, con su motivo:

| Motivo | Qué cambia | Cómo se carga |
|---|---|---|
| Extra por llevarla a casa | sube el cobro y el pago | dos montos: cuánto más se cobra y cuánto más se le paga a la niñera |
| Descuento | solo el cobro (el pago a la niñera no cambia) | un monto o un porcentaje |
| Se cobra sin servicio | se cobra a la familia y a la niñera se le paga una parte | cobro a la familia (por defecto el del horario previsto) y la parte para la niñera (monto) |
| Otro | lo que se ponga | texto obligatorio y los dos montos |

"Se cobra sin servicio" es distinto de "no hubo servicio" (hoy `cancelado` deja todo en $0). En el
PR 3 hay que definir cómo se guarda (cancelado con montos, o un estado propio) y revisar que
Finanzas, el PDF y la Agenda lo traten como cobrable: hoy un registro cancelado no se cobra.

### 4.7 Consultas: menos viajes

1. **Caché de sesión** en `core.js` para `familias`, `ninieras` activas, `asignaciones` + `asignaciones_pausas`, `app_config` (una lectura de todas las claves) y `zona_grupos` (ya está). Un solo select ancho por tabla, invalidado por el Realtime que ya está suscripto y después de cada escritura propia. Quita unas 15 lecturas repetidas por sesión y las 5 variantes de `familias`.
2. **`resumen_hoy()`** (función SQL, `security invoker`, RLS como siempre): todo lo que Hoy, el puntito de Hoy, la campanita y el push necesitan, en un pedido.
3. **`finanzas_pendientes()`**: grupos de Por cobrar y Por pagar ya armados (frecuencia, semana cerrada o en curso, cuentas, saldos, gastos extra, intermediaciones). El criterio de cierre de semana ya es JS puro (`lunesDeSemana`, `finDeSemanaDesde`) y se porta a SQL como se hizo con `minutos_fin_cobro()`, con sus pruebas en `supabase/pruebas/`. Alimenta también el badge y "de meses anteriores". De 12 pedidos a 1.
4. **Una lectura de registros de 6 meses** con columnas fijas que alimente resumen, balance, margen, movimientos y revisar; `cargarRevisarMes` solo al abrir la pestaña. Después de un pago, refrescar solo listas y resumen, e ignorar el Realtime de la propia escritura (`rtIgnorarHasta` en `marcarGrupoResuelto`): de ~65 pedidos a ~10.
5. **Agenda**: base y semana en paralelo; asignaciones y pausas desde la caché; el conteo de "ya fue a esta casa" para sugerir niñeras pasa a una vista `v_ninieras_por_familia` (conteo por familia y niñera) en vez de leer toda la historia; `chequearFijoNuevoContraTodo` una sola vez por fijo.
6. **`select('*')` fuera** de `sittings_traslados` (Finanzas, Agenda, Sittings, Hoy) y de `asignaciones`: columnas nombradas.
7. Regla nueva para CLAUDE.md (cuando se haga): "una pantalla pide sus datos en una sola tanda; lo que no cambia en la sesión se lee de la caché".

### 4.8 Maquetas

En `docs/maquetas/` (datos ficticios; hasta el 21/10/2026 estaban en `local/`, fuera del repo). Como
GitHub Pages publica el repo, también se ven en el celular en
`https://parentsbreak.github.io/app/docs/maquetas/hoy.html` (y las demás):

| Archivo | Pantalla |
|---|---|
| `hoy.html` | Hoy: tarjetas de acción, pedido de WhatsApp con sugeridas, agenda del día, semana, datos que faltan |
| `sittings.html` | Registros: lista por día con filtros y la hoja de registro nuevo con el desglose de precio |
| `finanzas.html` | Plata: Pagar, Cobrar y Números, con el toast "Deshacer" |
| `mas.html` | Más: Personas, Operación, Se usa poco y Ajustes |
| `ninieras.html` | Niñeras: reparto de quién trabajó, buscador, filtros, lista y ficha al costado |
| `postulantes.html` | Postulantes: Por revisar / Entrevistas / Guardadas y la entrevista por bloques con puntajes |
| `celular.html` | solo para mirar: cualquier maqueta dentro de un marco de 390 px (`celular.html#ninieras.html`) |
| `maquetas.css` | los tokens y componentes que comparten todas |

Se abren directo en el navegador: hasta 599 px ocupan la pantalla, de 600 a 1023 px se ven como un
teléfono centrado y desde 1024 px muestran la versión de compu (4.9). En la compu, arriba a la
derecha, "Ver cómo queda en el celular" abre la misma pantalla en `celular.html`. Lo que se ve
debajo de un separador ("Al tocar una niñera: su ficha") es una anotación de la maqueta: muestra la
hoja que en la app sube al tocar.

**Fidelidad (regla de Diego, 21/10/2026).** La app nueva replica las maquetas de `docs/maquetas/` lo más fiel posible,
en celular y en compu: mismos textos, orden, componentes, espaciado y comportamiento. Si algo de una
maqueta no se puede hacer o choca con un test, no se cambia por cuenta propia: se le avisa a Diego
antes. Cada PR de pantalla trae capturas a 390 px y a 1280 px al lado de la maqueta.

### 4.9 Celular y compu, pantalla por pantalla

Decidido el 21/10/2026. Las maquetas muestran las dos versiones.

| Pantalla | Celular (hasta 1023 px) | Compu (desde 1024 px) |
|---|---|---|
| Marco | barra de arriba con el nombre y la campanita; barra de 5 pestañas abajo; "+" flotante | barra de arriba a todo el ancho; menú lateral fijo con las mismas 5 secciones y "+ Nuevo" arriba; contenido hasta 1.240 px de ancho |
| Hoy | una columna: tarjetas de acción, después agenda del día, semana y datos que faltan | dos columnas: acciones a la izquierda (`1,3fr`); agenda del día, "Esta semana" (en 2 columnas) y "Datos que faltan" a la derecha (`1fr`), pegajosa al hacer scroll |
| Registros | lista por día con filtros; el registro nuevo o editado se abre en una hoja que sube desde abajo | la lista a la izquierda y la hoja de registro como panel al costado (420 px, pegajoso, con su propio scroll y el pie Cancelar/Guardar fijo abajo), no un modal encima: se puede mirar la lista mientras se carga |
| Plata | Pagar · Cobrar · Números en segmentos; cada fila con el monto a la derecha y los botones en una segunda línea | una sola columna ancha (hasta 920 px); cada fila con monto, Copiar cuenta, Copiar monto y Pagado en la misma línea; "Semana en curso" plegada abajo |
| Más | cuatro grupos: Personas (Familias, Niñeras, Postulantes y entrevistas), Operación (Intermediaciones, Notificaciones), Se usa poco (Marketing, Contratos, Juguetes) y Ajustes (Zonas y tarifa de traslado, Face ID, Cerrar sesión en rojo con la versión). Cada fila: ícono, nombre, un dato y flecha; un chip avisa lo que falta ("30 sin tarifa", "69 sin cuenta") | los mismos cuatro grupos en dos columnas: Personas y Operación a la izquierda, Se usa poco y Ajustes a la derecha |
| Niñeras | "‹ Más", título con activas e inactivas y "+ Niñera nueva". Arriba, el reparto "Trabajaron en los últimos 3 meses: 20 de 92" (barra con las 3 que hacen 1 de cada 3 sittings, las demás que trabajaron y las que no), que reemplaza la tarjeta de conteo. Buscador por nombre, zona o teléfono; filtros Trabajaron hace poco, Todas, Sin cuenta, Sin teléfono, Inactivas. Cada fila: zona, sittings en 3 meses y el último, chip Activa o Sin cuenta. La ficha sube como hoja: edad y desde cuándo, chips (cuida bebés, tiene auto, idiomas), datos en dos columnas (teléfono, zona, cuenta, semana de pago, disponibilidad, cédula con "Falta" en ámbar), sittings en 3 meses y lo que se le pagó en el mes, "Familias a las que fue" (fijo, veces, reseña), pie WhatsApp / Editar | lista con panel: la lista a la izquierda (la niñera elegida resaltada) y la ficha al costado |
| Postulantes | "‹ Más", título con el total y las que ya trabajan. Segmentos Por revisar (37) · Entrevistas (3) · Guardadas. Lista agrupada: Entrevista agendada (botón "Empezar"), Postularon esta semana y Esperando hace más de 15 días (botón "Agendar"). La entrevista sube como hoja: "Abrir el Meet" y "Se guarda sola mientras escribís", progreso "4 de 7 bloques completos", bloques plegables con su chip de estado (Datos personales, Experiencia con chicos, Disponibilidad y zonas, Referencias, Primeros auxilios y situaciones, Puntajes, Notas opcional), puntajes de 1 a 5 con los que faltan en ámbar, el aviso "Para guardarla faltan…", "Descartar candidata" (queda en Guardadas como descartada, no se borra) y el pie Guardar y seguir después / Contratar | lista con panel: la lista a la izquierda y la entrevista al costado |
| Agenda y Familias | todavía sin maqueta: se dibujan antes de su PR, con estas mismas reglas (listas con `uiFila`; formulario al lado de una lista, panel al costado en la compu) | |

Lo que muestran las maquetas de Más, Niñeras y Postulantes y la app hoy no tiene. Decidido por Diego
el 21/10/2026; cada punto entra en el PR de su pantalla:

| Qué pide la maqueta | Decisión |
|---|---|
| "Abrir el Meet" en la entrevista | Un campo con el link del Meet en la candidata, que se pega al agendar. El botón abre ese link. Lleva una columna nueva en `candidatas` (migración en el PR de Postulantes) |
| "Se guarda sola mientras escribís" | Sí: borrador guardado mientras escriben, para que no se pierda nada al cambiar de pestaña o cerrar (ya se borró una entrevista dos veces). Usa la entrevista a medias que ya existe (`entrevistas.estado = 'en_curso'`) |
| "Descartar candidata" | Usa el estado `descartada` que ya existe. Nunca un DELETE |
| "94 activas" en Familias | Familia activa = con algún sitting o traslado en los últimos 90 días, el mismo criterio que las niñeras |
| Cédula de la niñera | Columna nueva `ninieras.cedula`, propuesta en una migración aparte que espera el OK de Diego. La de `carsitting_datos` no sirve como lugar principal: es solo para quienes hacen traslados, va una fila por formulario y está vacía. En la entrevista se carga en la ficha de la candidata (`notas_ficha`, como los demás datos corregidos) y pasa a la niñera al contratarla |
| Subtítulo de Intermediaciones ("Animación, limpieza y eventos") | Queda como en la maqueta. Diego lo confirma con Paulina y Delfina |

### 4.10 Red de tests antes de migrar

Condición de Diego (21/10/2026): **no se migra a la versión nueva hasta tener una red de tests
grande.** Lo que manda es que cada flujo esté cubierto, no el número; la meta orientativa es más de
2.500 casos contando los generados.

1. **Ningún test existente se borra ni se debilita** durante el rediseño. Si un test mira algo que
   cambia de lugar (un id, una clase, un texto, una pantalla), se adapta para comprobar lo mismo en
   el lugar nuevo, y la descripción del PR lo lista: qué test, qué miraba, qué mira ahora.
2. **Equivalencia de plata con un generador de casos.** Antes de tocar una función que calcula
   plata, su versión actual se congela como oráculo (`tests/support/oraculo-plata.js`, copia exacta
   con fecha). Un generador con semilla fija arma miles de combinaciones y compara la función nueva
   con el oráculo: tienen que dar exactamente lo mismo, salvo donde una regla cambia a propósito
   (el redondeo de montos), y ahí el oráculo es la regla escrita. Un caso que falla imprime sus
   datos para reproducirlo. Datos ficticios, nunca reales. Va en su propio PR, antes del PR 0 y
   después de que entren redondeo-montos y los errores de plata, para que el oráculo ya tenga las
   reglas nuevas.
3. **Cada PR de pantalla trae su lista de tests**: cada acción (caso normal, base que falla, sin
   conexión, doble toque, datos raros), los estados vacío, cargando y error, y todo en 390 px y en
   1280 px. El PR 0 suma el proyecto `celular` (390×844) a la configuración de Playwright.
4. **La versión nueva convive con la vieja detrás de un interruptor** hasta que Paulina y Delfina
   la aprueben. `?nuevo=1` la prende en ese dispositivo (queda guardado) y `?nuevo=0` la apaga; más
   adelante, un ajuste por usuaria en Más. Las dos leen y escriben las mismas tablas con las mismas
   funciones: solo cambia la pantalla. La vieja se apaga en un PR aparte, y en ese PR cada test de la
   vieja se adapta a la nueva (regla 1), ninguno se borra.

Cuántos tests hay y cuántos casos suma cada punto (estimación del 21/10/2026):

| | Qué | Casos |
|---|---|---|
| Hoy | Playwright: 421 tests en 26 archivos. En curso: 10 de errores de plata y 15 de redondeo-montos (PR #52). Además 3 pruebas SQL en Postgres local | ~446 |
| 1 | Los existentes se conservan; se adaptan los que miran algo que se mueve | ~446 (no suma, no resta) |
| 2 | **Hecho (PR T, 21/10/2026).** En la app (`tests/red-plata.spec.js`, 12 tests, 8 s): 1.960 horarios (barridos minuto a minuto de una tarde y de la madrugada, y 1.000 al azar), 1.600 montos y precios, 400 meses de resumen y 400 bases chicas de Por cobrar / Por pagar (miércoles, sábado, domingo y lunes), y 60 pantallas de Finanzas. En la base (`supabase/pruebas/paridad_plata.sql`, Postgres local): 2.880 minutos de `minutos_fin_cobro`, 800 montos en `redondear_pago` y `redondear_cobro`, y 450 días creados por `generar_previstos_fijos` | ~4.400 en la app y ~4.900 en la base |
| 3 | Listas por pantalla: PR 0 ~25, Pedido desde WhatsApp ~35, Hoy ~40, Plata ~60, Registros ~50, Agenda ~35, Familias y Niñeras ~20, Más ~15 | ~280 |
| 4 | Interruptor: ~5 tests propios, y `humo` y `exploratorio` corridos también con la versión nueva y a 390 px | ~140 corridas más |
| Total | | ~10.000 casos: ~870 tests y corridas de pantalla (estimado) y ~9.300 generados (hechos) |

Cómo se sabe que la red atrapa errores: se metieron a propósito ocho errores chicos en la app (el
cobro con ,5 hacia abajo, 6 minutos de tolerancia, la semana que cierra un día después, las fijas
sin finde que cierran el domingo, por cobrar mirando "pagado", un descuento sin tope, pagos de días
futuros, un gasto absorbido que se cobra) y tres en la prueba SQL. Cada uno hizo fallar al menos un
test. El de la semana recién se atrapó al sumar el lunes como "hoy". La app, la base y el oráculo
coinciden en todos los casos generados.

## 5. Plan por etapas

Un PR por módulo, en el orden que decidió Diego el 21/10/2026. Cada uno con sus tests nuevos, capturas a 390 px, y la descripción del PR con el estado. Los que llevan migración esperan el OK de Diego para aplicarla.

Antes de todo, en un PR aparte: los cinco errores de plata de la auditoría (CLAUDE.md → Pendientes → "Errores encontrados en la auditoría"), con un test que reproduce cada uno. Después, el PR T con la red de plata (4.10, punto 2). El PR 0 no arranca hasta que Paulina y Delfina vean las maquetas. Cada pantalla nueva entra detrás del interruptor (4.10, punto 4) y trae su lista de tests (punto 3).

| # | PR | Qué entra | Riesgo | Tests que toca | Base |
|---|---|---|---|---|---|
| T | `claude/red-plata` (hecho) | oráculo de las funciones de plata actuales y generador de casos (4.10, punto 2). No cambia nada de la app | **Bajo**: solo tests | nuevos (~9.300 casos) | prueba SQL en Postgres local, nunca en producción |
| 0 | `claude/base-componentes` | tokens, componentes de 4.4, interruptor `?nuevo=1`, menú nuevo (barra abajo en el celular, lateral en la compu) solo con el interruptor prendido, caché de sesión, proyecto de tests a 390 px, control estático de estilos inline. Con el interruptor apagado no cambia nada | **Medio**: CSS global; se verifica con capturas de todos los módulos antes y después | `estatico`, `humo`, `arranque`, `exploratorio` | no |
| W | Pedido desde WhatsApp | la tarea de CLAUDE.md → Próximas tareas, con el diseño nuevo: tarjeta de Hoy (`uiAccion`) con el ticket y las niñeras sugeridas (`chip-elegir`), y hoja "Nuevo pedido" en el "+" | **Medio**: llamada a Claude Haiku y lógica de sugerencias; se define en su propia propuesta | nuevos | a definir |
| 1 | `claude/hoy-acciones` | Hoy nuevo (4.3), cierre de ayer, registrar tal cual, asignar desde Hoy; `resumen_hoy()`; campanita alimentada por lo mismo | **Medio**: lógica nueva y una función SQL; el test de fijos automáticos y mejoras-hoy cambian | `mejoras-hoy`, `fijos-automaticos`, `humo`, `fechas` | migración: función `resumen_hoy()`, índice `solicitudes(estado, fecha)` |
| 2 | `claude/plata` | Plata con Pagar/Cobrar/Números, `finanzas_pendientes()`, confirmación en cobrar, Deshacer, editar movimiento con desglose, refresco liviano tras pagar, `cobrado_at`/`pagado_at` | **Alto**: es la plata y son 9 archivos de tests; se hace en dos PRs si crece (2a listas y pagos, 2b números y migración) | `finanzas`, `pagos`, `saldo`, `gastos-extra`, `revisar-meses`, `por-pagar-en-curso`, `intermediaciones-finanzas`, `finanzas-arreglos`, `conciliacion` | migración: `cobrado_at`, `pagado_at`, `marcado_por` + trigger; función `finanzas_pendientes()` |
| 3 | `claude/registros` | lista por día con filtros, hoja de registro nuevo con desglose, sin "Registró", reloj nativo, `precio_manual` con motivo, hora de fin obligatoria | **Alto**: formulario central; los ids `#sit-*` se conservan, los selects de hora cambian a `<input type="time">` (los tests que los llenan se adaptan) | `gastos-total`, `terminos`, `escape`, `guardados`, `regresiones`, `humo`, `fijos` | migración: `precio_manual` boolean + `precio_motivo` |
| 4 | `claude/agenda-movil` | lista móvil con `uiFila`, pedido nuevo con menos campos, fin de semana en paralelo, sugeridas desde la vista, modal del fijo reordenado (lo frecuente arriba), updates condicionales, sin estado "pendiente" | **Medio** | `fijos`, `fijos-automaticos`, `exploratorio` | vista `v_ninieras_por_familia`; campo `motivo_cancelacion` |
| 5 | `claude/personas` | Familias y Niñeras con la misma lista y ficha, alta con menos campos, saldo a favor desde la misma hoja que Plata | **Bajo-medio** | `alta-ninera`, `terminos`, `escape` | no |
| 6 | `claude/mas` | Postulantes, Intermediaciones, Notificaciones, Marketing, Contratos, Juguetes en "Más"; Contratos y Juguetes al fondo | **Bajo** | `entrevista*`, `intermediaciones` | no |
| 7 | `claude/uso-app` | tabla `uso_app` y la lista "Qué decidir" completa (embudo, días de cobro) | Bajo | `finanzas` | migración: `uso_app` |
| 8 | `claude/apagar-version-vieja` | cuando Paulina y Delfina aprueban: la versión nueva pasa a ser la única; se borra el código viejo y cada test de la vieja se adapta a la nueva | **Medio**: muchos tests se adaptan; ninguno se borra | todos | no |

Relación con lo que viene:

- **Pedido desde WhatsApp** (decidido: va después del PR 0 y antes del PR 1): entra como una tarjeta de Hoy (ya diseñada en 4.3) y una hoja "Nuevo pedido" en el "+" flotante. Usa los componentes del PR 0 (`uiAccion`, `chip-elegir`). Mientras no exista el Hoy nuevo, la tarjeta se muestra arriba del Hoy actual; el PR 1 la integra a la lista de acciones y a `resumen_hoy`.
- **Capacitor**: nada del plan lo dificulta. Lo que ayuda: barra de pestañas y hojas (se sienten nativas), `env(safe-area-inset-*)` ya contemplado en el CSS de la maqueta, un solo `index.html`, sin `window.location` para navegar. Lo que hay que mirar al empaquetar: el service worker de push (en la app nativa es push nativo), `createSignedUrl` de los tickets y el login con passkeys dentro del WebView.
- **Mercado Pago automático**: `cobrado_at`/`pagado_at` y `marcado_por` del PR 2 son la base para marcar solo y para auditar qué marcó la API.

## 6. Decisiones tomadas (21/10/2026)

Las tomó Diego sobre esta propuesta. Todas las recomendadas, salvo la 10.

| # | Tema | Decisión |
|---|---|---|
| 1 | Navegación en celular | Barra de 5 pestañas abajo. Menú lateral solo en la compu |
| 2 | Hoy | Lista de acciones. Las 3 tarjetas de conteo y el gráfico pasan a Plata → Números |
| 3 | Revisión de fijos automáticos | "Cierre de ayer" con hora de fin; lo que no se cierra en 7 días se da por revisado solo |
| 4 | Precio a mano | Desglose calculado y "Ajustar precio" con motivo y marca. Motivos: extra por llevarla a casa, descuento, se cobra sin servicio, otro con texto (detalle en 4.6) |
| 5 | Contratos, Juguetes y Marketing | Al fondo de "Más" |
| 6 | `cobrado_at`, `pagado_at`, `marcado_por` | Sí, con relleno desde el historial (PR 2) |
| 7 | Orden | Errores de plata → PR 0 base → Pedido desde WhatsApp → PR 1 Hoy → PR 2 Plata → PR 3 Registros → Agenda → Personas → Más → uso de la app |
| 8 | Selector de hora | Reloj nativo del iPhone (`<input type="time">`) |
| 9 | Deshacer | Toast con "Deshacer" 8 s para cobrado, pagado, revisado, "no fue" y cancelar pedido |
| 10 | Campanita en celular | **Se mantiene** también en el celular, alimentada por lo mismo que Hoy |
| 11 | Red de tests | No se migra a la versión nueva sin la red de 4.10: ningún test se borra ni se debilita, generador de plata, lista de tests por pantalla en 390 y 1280 px, versión nueva detrás de un interruptor hasta que la aprueben |
| 12 | Fidelidad a las maquetas | La app nueva replica las maquetas (textos, orden, componentes, espaciado, comportamiento) en celular y compu; lo que no se pueda o choque con un test se consulta antes; cada PR de pantalla con capturas a 390 y 1280 px al lado de la maqueta |

Pendiente antes del PR 0: que Paulina y Delfina vean las maquetas.

## 7. Fuera de alcance y pendientes detectados

Los errores que encontró la auditoría y no son del rediseño pasaron a `CLAUDE.md` → Pendientes →
"Errores encontrados en la auditoría (21/10/2026)". Esa lista es la fuente de verdad: cada uno se
borra de ahí en el PR que lo arregla.
